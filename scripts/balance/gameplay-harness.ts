import { Effect, Layer, Ref, Result, Schema } from 'effect'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  BlockAxis,
  ChunkAxis,
  NonNegativeTickCount,
  PositionAxis,
  WorldIdSchema,
  blockPosition,
  chunkCoord,
  position,
  type BlockPosition,
  type Position,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import { NoiseSeed } from '@nerima-games/mc-worldgen'
import {
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  makeWorldCommitCoordinator,
  type TimeState,
  type PlayerServiceInputError,
  type WorldCommitCoordinatorError,
  type PlayerPose,
} from '@nerima-games/mc-sim'
import {
  HeadlessHarness,
  RandomSeedSchema,
  HeadlessHarnessSessionFactoryLayer,
  HeadlessHarnessTestLayer,
  type HeadlessHarnessStages as TestingHeadlessHarnessStages,
} from '@nerima-games/mc-sim/testing'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame.js'
import type { PlayerDamageEvent } from '../../src/domain/mob/hostile-combat.js'
import type { SurvivalHungerTickOutcome } from '../../src/domain/survival-hunger.js'
import {
  makeGeneratedWorld as makeGameplayGeneratedWorld,
  makeInMemoryWorld,
  type InMemoryWorld,
  type WorldContents,
} from '../../src/domain/in-memory-world.js'
import {
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GameplayEntityRosterSchema,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  GAMEPLAY_TNT_SOURCES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  gameplayOwnerRegistrations,
} from '../../src/stages/gameplay-owner-registrations.js'
import {
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestBlockBreak,
  type GameplayFrameState,
} from '../../src/stages/registration.js'
import type { GameplayStageCommitServices } from '../../src/stages/registration-core.js'

// Harness frames advance at 20 Hz, independently of mc-sim's 60 Hz TimeService clock.
export const BALANCE_HARNESS_TICKS_PER_SECOND = 20
const TICK_SECS = DeltaTimeSecs(1 / BALANCE_HARNESS_TICKS_PER_SECOND)
const SIMULATION_TICK_COUNT = Result.getOrThrow(NonNegativeTickCount.result(1))
const WORLD_ID = Schema.decodeUnknownSync(WorldIdSchema)('balance-simulation')
const EMPTY_CANDIDATE = { changes: [], expectedDimensions: [], events: [] } as const

export type BalanceGameplayRuntime = Readonly<{
  world: InMemoryWorld<MobBehaviour>
  state: GameplayFrameState
  commit: GameplayStageCommitServices
  stages: ReadonlyArray<StageRegistration>
  stageTickCount: Ref.Ref<number>
  damageEventsByTick: Ref.Ref<ReadonlyArray<BalanceRecordedDamage>>
  mobSpawnsByTick: Ref.Ref<ReadonlyArray<BalanceMobSpawnRecord>>
  hungerOutcomesByTick: ReadonlyArray<Readonly<{ tick: number; outcome: SurvivalHungerTickOutcome }>>
  deathTick: Ref.Ref<number | undefined>
  measurementFailure: Ref.Ref<string | undefined>
}>

export type BalanceTimeServiceReading = TimeState & Readonly<{ timeOfDay: number }>

export type BalanceMobSpawnRecord = Readonly<{
  tick: number
  id: string
  kind: string
  position: Readonly<{ x: number; y: number; z: number }>
  timeService: BalanceTimeServiceReading
  candidateBlockLight:
    | Readonly<{ status: 'observed'; block: number }>
    | Readonly<{ status: 'unavailable'; reason: string }>
}>

export type BalanceAttackerProvenance = Readonly<{
  source: string
  mobKind: string
  position: Readonly<{ x: number; y: number; z: number }>
  spawnPosition: Readonly<{ x: number; y: number; z: number }> | null
  spawnTick: number | null
  spawnTimeService: BalanceTimeServiceReading | null
  spawnCandidateBlockLight:
    | Readonly<{ status: 'observed'; block: number }>
    | Readonly<{ status: 'unavailable'; reason: string }>
}>

export type BalanceRecordedDamage = Readonly<{
  tick: number
  event: PlayerDamageEvent
  timeService: BalanceTimeServiceReading
  attacker?: BalanceAttackerProvenance
}>

export const makeBalanceGameplayRuntime = (
  contents: WorldContents,
  spawnPose?: PlayerPose,
  rollSeed = 1,
): Effect.Effect<BalanceGameplayRuntime> => Effect.gen(function* () {
  const world = yield* makeInMemoryWorld<MobBehaviour>({
    world: contents,
    ...(spawnPose === undefined ? {} : { spawnPose }),
  })
  return yield* makeRuntimeFromWorld(world, rollSeed)
})

export const makeGeneratedBalanceGameplayRuntime = (
  seed: number,
  spawn: Readonly<{ x: number; z: number }>,
  rollSeed: number = seed,
): Effect.Effect<BalanceGameplayRuntime> => Effect.gen(function* () {
  const world = yield* makeGameplayGeneratedWorld<MobBehaviour>({
    seed,
    spawnX: spawn.x,
    spawnZ: spawn.z,
  })
  const minimumChunkX = Math.floor((spawn.x - 40) / 16)
  const maximumChunkX = Math.floor((spawn.x + 40) / 16)
  const minimumChunkZ = Math.floor((spawn.z - 40) / 16)
  const maximumChunkZ = Math.floor((spawn.z + 40) / 16)
  for (let chunkZ = minimumChunkZ; chunkZ <= maximumChunkZ; chunkZ += 1) {
    for (let chunkX = minimumChunkX; chunkX <= maximumChunkX; chunkX += 1) {
      yield* Effect.orDie(world.chunkStore.load(chunkCoord(ChunkAxis(chunkX), ChunkAxis(chunkZ))))
    }
  }
  return yield* makeRuntimeFromWorld(world, rollSeed)
})

const makeRuntimeFromWorld = (
  world: InMemoryWorld<MobBehaviour>,
  rollSeed: number,
): Effect.Effect<BalanceGameplayRuntime> => Effect.gen(function* () {
  const playerPose = yield* world.player.pose
  const dimension = yield* world.player.dimension
  const playerStorage = yield* world.inventory.storageSnapshot
  const entities = yield* world.entities.snapshot
  const coordinator = yield* Effect.orDie(makeWorldCommitCoordinator({
    world: WORLD_ID,
    owners: gameplayOwnerRegistrations({ playerPose, dimension, playerStorage, entities }),
    chunkStores: { forDimension: () => world.chunkStore },
  }))
  const commit: GameplayStageCommitServices = {
    coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    cropOwnerId: GAMEPLAY_CROPS_OWNER_ID,
    droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
    villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
    brewingOwnerId: GAMEPLAY_BREWING_OWNER_ID,
    fishingOwnerId: GAMEPLAY_FISHING_OWNER_ID,
    entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
    tntSourcesOwnerId: GAMEPLAY_TNT_SOURCES_OWNER_ID,
    statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  }
  const baseState = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const stageTickCount = yield* Ref.make(0)
  const damageEventsByTick = yield* Ref.make<ReadonlyArray<BalanceRecordedDamage>>([])
  const mobSpawnsByTick = yield* Ref.make<ReadonlyArray<BalanceMobSpawnRecord>>([])
  const hungerOutcomesByTick: Array<Readonly<{ tick: number; outcome: SurvivalHungerTickOutcome }>> = []
  const deathTick = yield* Ref.make<number | undefined>(undefined)
  const measurementFailure = yield* Ref.make<string | undefined>(undefined)
  const survivalHunger = {
    ...baseState.survivalHunger,
    tick: (dt: Parameters<typeof baseState.survivalHunger.tick>[0]) => Effect.gen(function* () {
      const outcome = yield* baseState.survivalHunger.tick(dt)
      const tick = yield* Ref.get(stageTickCount)
      hungerOutcomesByTick.push({ tick, outcome })
      return outcome
    }),
  }
  const state: GameplayFrameState = { ...baseState, survivalHunger }
  yield* Ref.set(state.rollSeed, rollSeed)
  const stages = gameplayStages(
    state,
    world.chunkStore,
    world.entities,
    world.inventory,
    world.player,
    world.time,
    undefined,
    undefined,
    { mobSimulation: true },
    commit,
  )
  return {
    world,
    state,
    commit,
    stages,
    stageTickCount,
    damageEventsByTick,
    mobSpawnsByTick,
    hungerOutcomesByTick,
    deathTick,
    measurementFailure,
  }
})

export const scheduleGameplayStages = (
  stages: ReadonlyArray<StageRegistration>,
): ReadonlyArray<StageRegistration> => {
  const registered = new Set(stages.map((stage) => stage.id))
  const emitted = new Set<string>()
  const ordered: Array<StageRegistration> = []
  while (ordered.length < stages.length) {
    const next = stages.find((stage) =>
      !emitted.has(stage.id) &&
      (stage.after ?? []).every((edge) => !registered.has(edge) || emitted.has(edge)),
    )
    if (next === undefined) throw new Error('gameplay stage after-edges contain a cycle')
    emitted.add(next.id)
    ordered.push(next)
  }
  return ordered
}

const harnessStagesFor = (
  runtime: BalanceGameplayRuntime,
): TestingHeadlessHarnessStages => {
  const ordered = scheduleGameplayStages(runtime.stages)
  const advanceGameplay: TestingHeadlessHarnessStages['intentsAndRules'] = (input) => {
    const tick = Number(input.tick)
    return Effect.gen(function* () {
      yield* Ref.set(runtime.stageTickCount, tick)
      yield* Ref.set(runtime.state.tickCount, tick)
      yield* Effect.orDie(runtime.world.time.advance(SIMULATION_TICK_COUNT))
      const damageStart = (yield* Ref.get(runtime.state.playerDamages)).length
      for (const stage of ordered) {
        const entitiesOwnerId = stage.id === 'gameplay:entities'
          ? runtime.commit.entitiesOwnerId
          : undefined
        const entitiesBefore = entitiesOwnerId === undefined
          ? undefined
          : yield* Effect.orDie(runtime.commit.coordinator.snapshot(
              entitiesOwnerId,
              GameplayEntityRosterSchema,
            ))
        yield* stage.run(TICK_SECS)
        if (entitiesOwnerId !== undefined && entitiesBefore !== undefined) {
          const entitiesAfter = yield* Effect.orDie(runtime.commit.coordinator.snapshot(
            entitiesOwnerId,
            GameplayEntityRosterSchema,
          ))
          const priorIds = new Set(entitiesBefore['state'].entities.map((entity) => entity.id))
          const newEntities = entitiesAfter['state'].entities.filter((entity) => !priorIds.has(entity.id))
          if (newEntities.length > 0) {
            const timeState = yield* runtime.world.time.snapshot
            const timeOfDay = yield* Effect.orDie(runtime.world.time.timeOfDay)
            const timeService = { ...timeState, timeOfDay: Number(timeOfDay) }
            const spawnRecords = yield* Effect.forEach(newEntities, (entity) => Effect.gen(function* () {
              const candidatePosition = blockPosition(
                BlockAxis(Math.floor(entity.feetPosition.x)),
                BlockAxis(Math.floor(entity.feetPosition.y)),
                BlockAxis(Math.floor(entity.feetPosition.z)),
              )
              const light = yield* runtime.world.chunkStore.getLight(candidatePosition)
              return {
                tick,
                id: String(entity.id),
                kind: String(entity.kind),
                position: {
                  x: Number(entity.feetPosition.x),
                  y: Number(entity.feetPosition.y),
                  z: Number(entity.feetPosition.z),
                },
                timeService,
                candidateBlockLight: light._tag === 'Light'
                  ? { status: 'observed' as const, block: light.block }
                  : { status: 'unavailable' as const, reason: light._tag },
              }
            }))
            yield* Ref.update(runtime.mobSpawnsByTick, (current) => [...current, ...spawnRecords])
          }
        }
      }
      const damageEvents = yield* Ref.get(runtime.state.playerDamages)
      if (damageEvents.length > damageStart) {
        const timeState = yield* runtime.world.time.snapshot
        const timeOfDay = yield* Effect.orDie(runtime.world.time.timeOfDay)
        const timeService = { ...timeState, timeOfDay: Number(timeOfDay) }
        const spawnsById = new Map((yield* Ref.get(runtime.mobSpawnsByTick)).map((spawn) => [spawn.id, spawn]))
        yield* Ref.update(runtime.damageEventsByTick, (current) => [
          ...current,
          ...damageEvents.slice(damageStart).map((event) => {
            if (event._tag !== 'HostileContact' && event._tag !== 'Explosion') {
              return { tick, event, timeService }
            }
            const spawn = spawnsById.get(String(event.source))
            return {
              tick,
              event,
              timeService,
              attacker: {
                source: String(event.source),
                mobKind: String(event.kind),
                position: {
                  x: Number(event.at.x),
                  y: Number(event.at.y),
                  z: Number(event.at.z),
                },
                spawnPosition: spawn?.position ?? null,
                spawnTick: spawn?.tick ?? null,
                spawnTimeService: spawn?.timeService ?? null,
                spawnCandidateBlockLight: spawn?.candidateBlockLight ?? {
                  status: 'unavailable' as const,
                  reason: 'attacker did not spawn during the recorded harness run',
                },
              },
            }
          }),
        ])
      }
      const health = yield* Effect.result(runtime.state.survivalHunger.snapshot)
      if (health._tag === 'Failure') {
        yield* Ref.set(runtime.measurementFailure, String(health.failure))
      } else if (health.success.vitals.healthPoints <= 0) {
        yield* Ref.modify(runtime.deathTick, (current) => [
          current ?? tick,
          current ?? tick,
        ])
      }
      return EMPTY_CANDIDATE
    }).pipe(Effect.provide(FixedClockLayer({
      monotonicSecs: MonotonicTimeSecs(tick / BALANCE_HARNESS_TICKS_PER_SECOND),
      wallClockEpochMillis: EpochMillis(0),
    })))
  }
  const idle = () => Effect.succeed(EMPTY_CANDIDATE)
  return {
    intentsAndRules: advanceGameplay,
    stations: idle,
    environment: idle,
    entities: idle,
  }
}

export const runBalanceHarness = <A>(
  runtime: BalanceGameplayRuntime,
  seed: number,
  runEffect: (effect: Effect.Effect<A, unknown, never>) => Promise<A>,
  run: (harness: typeof HeadlessHarness.Service) => Effect.Effect<A, unknown, never>,
): Promise<A> => {
  const program = Effect.gen(function* () {
    const harness = yield* HeadlessHarness
    yield* harness.reset({
      worldSeed: NoiseSeed(seed),
      randomSeed: Schema.decodeUnknownSync(RandomSeedSchema)(seed),
    })
    return yield* run(harness)
  })
  const layer = HeadlessHarnessTestLayer(harnessStagesFor(runtime)).pipe(
    Layer.provide(HeadlessHarnessSessionFactoryLayer),
  )
  return runEffect(Effect.provide(program, layer))
}

export const movePlayer = (
  runtime: BalanceGameplayRuntime,
  target: Position,
): Effect.Effect<
  void,
  PlayerServiceInputError | WorldCommitCoordinatorError | Schema.SchemaError | Readonly<{ _tag: 'ReplicatedOwnerUnknown' }>
> => Effect.gen(function* () {
  const snapshot = yield* runtime.commit.coordinator.snapshot(
    runtime.commit.playerOwnerId,
    PlayerServiceSnapshotSchema,
  )
  const current = snapshot.state.pose.feetPosition
  const next = Schema.decodeUnknownSync(PlayerServiceSnapshotSchema)({
    ...snapshot.state,
    pose: {
      ...snapshot.state.pose,
      feetPosition: {
        ...current,
        x: target.x,
        y: target.y,
        z: target.z,
      },
    },
  })
  yield* runtime.commit.coordinator.commit({
    expectedRevision: snapshot.revision,
    expectedDimensions: [],
    changes: [{ ownerId: runtime.commit.playerOwnerId, state: next }],
  })
  yield* runtime.world.player.moveTo(target)
})

export const setBlockBreakRequest = (
  runtime: BalanceGameplayRuntime,
  target: BlockPosition,
  lootContext?: Parameters<typeof requestBlockBreak>[2],
): Effect.Effect<void> => requestBlockBreak(runtime.state, target, lootContext)

export const targetAtFeet = (x: number, y: number, z: number): Position =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))

export const countPlayerStorageItem = (
  snapshot: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: string,
): number => snapshot.inventory.slots.reduce(
  (count, slot) => count + (slot?.item === item ? slot.count : 0),
  0,
)
