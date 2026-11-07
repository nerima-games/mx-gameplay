import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'
import {
  DomainEventBus,
  TNT_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  PlayerStorageSnapshotSchema,
  makeBrewingService,
  makeFishingService,
  makeProjectileService,
  makeTimeService,
  makeTntService,
  makeVehicleService,
  type DomainEventBusApi,
} from '@nerima-games/mc-sim'
import type { StageRegistration } from '@nerima-games/mc-kernel'
import { Effect, Ref, Schema, Stream } from 'effect'
import { gameplayStages } from '../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import {
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  gameplayOwnerRegistrations,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import {
  blockPlacementRuntimeFor,
  breakRequestQueueFor,
  fluidRuntimeStateFor,
  makeGameplayFrameStateForOwner,
  requestBlockBreak,
  snapshotFireLifecycle,
  snapshotWeatherGameplay,
} from '../src/stages/registration-core'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makePlayerServiceDouble } from './support/player-service-double'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles'
import { GRAVEL, SAND, STONE, world } from './support/chunk-store-double'
import { runFrames, schedule } from './support/frame-runner'
import { hashGameplayState } from './support/state-hash'
import {
  blockPosition as fixtureBlockPosition,
  position as fixturePosition,
} from './support/coordinate-fixtures'

const randomControl = vi.hoisted(() => ({
  constant: false,
  draws: 0,
  lootBatches: 0,
}))

vi.mock('../src/domain/frame-rolls.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/frame-rolls.js')>()
  return {
    ...actual,
    drawRolls: (seed: number, count: number) => {
      const batch = actual.drawRolls(seed, count)
      if (count === 4) randomControl.lootBatches += 1
      if (!randomControl.constant) return batch
      randomControl.draws += batch.rolls.length
      return { ...batch, rolls: batch.rolls.map(() => 0) }
    },
    nextRoll: (seed: number) => {
      const draw = actual.nextRoll(seed)
      if (!randomControl.constant) return draw
      randomControl.draws += 1
      return { ...draw, roll: 0 }
    },
  }
})

const REPLAY_FRAMES = 60
const FLOOR = fixtureBlockPosition(2, 63, 3)
const SUPPORT = fixtureBlockPosition(2, 64, 3)
const SAND_CELL = fixtureBlockPosition(2, 65, 3)
const GRAVEL_CELL = fixtureBlockPosition(4, 64, 3)

const withoutProperty = (value: object, excluded: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== excluded))

const storedItemCount = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: string,
): number => storage.inventory.slots.reduce((count, slot) => count + (slot?.item === item ? slot.count : 0), 0)

const orderEntitiesBeforeInteractions = (
  stages: ReadonlyArray<StageRegistration>,
): ReadonlyArray<StageRegistration> => stages.map((stage) => {
  if (stage.id === GAMEPLAY_STAGE_IDS.entities) return { ...stage, after: [] }
  if (stage.id === GAMEPLAY_STAGE_IDS.interactions) {
    return { ...stage, after: [GAMEPLAY_STAGE_IDS.entities] }
  }
  return stage
})

const replay = (seed: number, frames = REPLAY_FRAMES, reorder = false) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(
      world([[FLOOR, STONE], [SUPPORT, STONE], [SAND_CELL, SAND], [GRAVEL_CELL, GRAVEL]]),
      ['0,0'],
    )
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(emptySlots())
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const vehicles = yield* makeVehicleService()
    yield* vehicles.spawn('boat', 'overworld', fixturePosition(8, 64, 8))
    const commitServices = yield* makeGameplayCommitServices(store.api, inventory.api)
    const publishedEvents = yield* Ref.make<ReadonlyArray<Parameters<DomainEventBusApi['publish']>[0]>>([])
    const eventBus: DomainEventBusApi = {
      publish: (event) => Ref.update(publishedEvents, (events) => [...events, event]),
      events: Stream.empty,
    }
    const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, commitServices.coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const projectileService = yield* makeProjectileService().pipe(
      Effect.provideService(WorldCommitCoordinator, commitServices.coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const brewingService = yield* makeBrewingService(GAMEPLAY_BREWING_OWNER_ID)
    const tntService = yield* makeTntService(TNT_REPLICATED_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, commitServices.coordinator),
    )
    const commit = {
      ...commitServices,
      fishingService,
      projectileService,
      brewingService,
      tntService,
      eventBus,
    }
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    yield* Ref.set(state.rollSeed, seed)
    const registered = gameplayStages(
      state,
      store.api,
      roster.api,
      inventory.api,
      player.api,
      time,
      vehicles,
      undefined,
      {},
      commit,
    )
    const stages = reorder ? orderEntitiesBeforeInteractions(registered) : registered
    const scheduledStageIds = schedule(stages).map((stage) => stage.id)

    yield* requestBlockBreak(state, GRAVEL_CELL)
    yield* requestBlockBreak(state, SUPPORT)
    yield* runFrames(stages, frames)

    const chunkCoords = [...(yield* store.api.loadedCoords)].sort(
      (left, right) => left.cx - right.cx || left.cz - right.cz,
    )
    const chunks = yield* Effect.forEach(chunkCoords, (coord) =>
      Effect.map(store.api.snapshot(coord), (chunk) => [`${String(coord.cx)},${String(coord.cz)}`, chunk] as const),
    )
    const owners = yield* Effect.forEach(gameplayOwnerRegistrations(), ({ ownerId, schema }) =>
      Effect.map(commit.coordinator.snapshot(ownerId, schema), (snapshot) => [ownerId, snapshot] as const),
    )
    const worldRevision = yield* commit.coordinator.revision
    const dimensionRevisions = yield* Effect.forEach(
      ['overworld', 'nether', 'end'] as const,
      (dimension) => Effect.map(commit.coordinator.dimensionRevision(dimension), (revision) => [dimension, revision] as const),
    )
    const fluidState = yield* fluidRuntimeStateFor(state.fluidFrontier)
    const fluidSnapshot = yield* Ref.get(fluidState)
    const entitySnapshot = yield* roster.api.snapshot
    const playerPose = yield* player.api.pose
    const playerDimension = yield* player.api.dimension
    const timeSnapshot = yield* time.snapshot
    const playerStorageSnapshot = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(
      owners.find(([ownerId]) => ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID)?.[1].state,
    )
    const frameValues = yield* Effect.all({
      enderDragonEncounter: state.enderDragonEncounter.snapshot,
      survivalHunger: state.survivalHunger.snapshot,
      operationFailures: Ref.get(state.operationFailures),
      pendingBlockBreakRequests: Ref.get(breakRequestQueueFor(state).state),
      blockPlacementRuntime: Ref.get(blockPlacementRuntimeFor(state).state),
      pendingBreaks: Ref.get(state.pendingBreaks),
      pendingPlacements: Ref.get(state.pendingPlacements),
      pendingBlockUses: Ref.get(state.pendingBlockUses),
      pendingItemUses: Ref.get(state.pendingItemUses),
      pendingBowShots: Ref.get(state.pendingBowShots),
      pendingMeleeAttacks: Ref.get(state.pendingMeleeAttacks),
      pendingPearlThrows: Ref.get(state.pendingPearlThrows),
      pendingDroppedItemPickups: Ref.get(state.pendingDroppedItemPickups),
      droppedItemPickupExecutions: Ref.get(state.droppedItemPickupExecutions),
      pendingExperienceOrbAbsorptions: Ref.get(state.pendingExperienceOrbAbsorptions),
      experienceOrbAbsorptionExecutions: Ref.get(state.experienceOrbAbsorptionExecutions),
      unsupportedOperations: Ref.get(state.unsupportedOperations),
      pendingVillagerTrades: Ref.get(state.pendingVillagerTrades),
      pendingStatusEffects: Ref.get(state.pendingStatusEffects),
      consumedItems: Ref.get(state.consumedItems),
      usedItems: Ref.get(state.usedItems),
      blockUseResults: Ref.get(state.blockUseResults),
      itemUseResults: Ref.get(state.itemUseResults),
      bowShotResults: Ref.get(state.bowShotResults),
      meleeAttackResults: Ref.get(state.meleeAttackResults),
      handledBowShotRequestIds: Ref.get(state.handledBowShotRequestIds),
      bowKnockbacks: Ref.get(state.bowKnockbacks),
      enderPearlOutcomes: Ref.get(state.enderPearlOutcomes),
      playerDamages: Ref.get(state.playerDamages),
      playerHeals: Ref.get(state.playerHeals),
      playerMovementSpeedMultiplier: Ref.get(state.playerMovementSpeedMultiplier),
      fireLifecycle: snapshotFireLifecycle(state),
      hostileContactCooldowns: Ref.get(state.hostileContactCooldowns),
      mobDrops: Ref.get(state.mobDrops),
      mobExperience: Ref.get(state.mobExperience),
      villagerTradeResults: Ref.get(state.villagerTradeResults),
      spawnAttempts: Ref.get(state.spawnAttempts),
      targetPosition: Ref.get(state.targetPosition),
      timeOfDay: Ref.get(state.timeOfDay),
      heldTool: Ref.get(state.heldTool),
      weather: Ref.get(state.weather),
      weatherAdvanced: Ref.get(state.weatherAdvanced),
      weatherGameplayInput: Ref.get(state.weatherGameplayInput),
      weatherGameplay: snapshotWeatherGameplay(state),
      weatherGameplayEvents: Ref.get(state.weatherGameplayEvents),
      spawnClockSecs: Ref.get(state.spawnClockSecs),
      rollSeed: Ref.get(state.rollSeed),
      fallingBlocks: Ref.get(state.fallingBlocks),
      tickCount: Ref.get(state.tickCount),
      portalCandidates: Ref.get(state.portalCandidates),
      portalTravels: Ref.get(state.portalTravels),
      endPortalTravels: Ref.get(state.endPortalTravels),
      portalDwell: Ref.get(state.portalDwell),
    })
    const snapshot = {
      world: new Map(chunks),
      entities: entitySnapshot,
      playerService: {
        pose: playerPose,
        dimension: playerDimension,
      },
      owners: new Map(owners),
      transactionRevisions: { worldRevision, dimensions: new Map(dimensionRevisions) },
      time: timeSnapshot,
      vehicles: yield* vehicles.snapshot,
      frame: { ...frameValues, fluidRuntime: fluidSnapshot },
      publishedEvents: yield* Ref.get(publishedEvents),
    }
    const resultFrame = {
      ...withoutProperty(frameValues, 'rollSeed'),
      fireLifecycle: withoutProperty(frameValues.fireLifecycle, 'seed'),
      weatherGameplay: withoutProperty(frameValues.weatherGameplay, 'seed'),
      fluidRuntime: fluidSnapshot,
    }
    const resultSnapshot = { ...snapshot, frame: resultFrame }

    return {
      hash: hashGameplayState(snapshot),
      resultHash: hashGameplayState(resultSnapshot),
      playerStorage: playerStorageSnapshot,
      scheduledStageIds,
    }
  })

describe('deterministic gameplay replay', () => {
  it.effect('produces the same state hash when the same seed is replayed', () =>
    Effect.gen(function* () {
      const first = yield* replay(0x1a2b3c4d)
      const second = yield* replay(0x1a2b3c4d)
      expect(second.hash).toBe(first.hash)
      expect(second.resultHash).toBe(first.resultHash)
    }),
  )

  it.effect('produces a different result-only state hash for a different seed', () =>
    Effect.gen(function* () {
      randomControl.lootBatches = 0
      const first = yield* replay(0x1a2b3c4d)
      const second = yield* replay(0x5e6f7081)
      expect(randomControl.lootBatches).toBeGreaterThan(0)
      expect(second.playerStorage).not.toStrictEqual(first.playerStorage)
      expect(storedItemCount(first.playerStorage, 'flint')).toBe(1)
      expect(storedItemCount(second.playerStorage, 'gravel')).toBe(1)
      expect(second.resultHash).not.toBe(first.resultHash)
    }),
  )

  it.effect('detects running entities before the interaction that queues a falling block', () =>
    Effect.gen(function* () {
      const declaredOrder = yield* replay(0x1a2b3c4d, 1)
      const reordered = yield* replay(0x1a2b3c4d, 1, true)
      expect(reordered.scheduledStageIds.indexOf(GAMEPLAY_STAGE_IDS.entities)).toBeLessThan(
        reordered.scheduledStageIds.indexOf(GAMEPLAY_STAGE_IDS.interactions),
      )
      expect(reordered.hash).not.toBe(declaredOrder.hash)
    }),
  )

  it.effect('runs every gameplay stage ID', () =>
    Effect.gen(function* () {
      const result = yield* replay(0x1a2b3c4d, 1)
      expect(result.scheduledStageIds).toHaveLength(8)
      expect(new Set(result.scheduledStageIds)).toStrictEqual(new Set(Object.values(GAMEPLAY_STAGE_IDS)))
    }),
  )

  it.effect('the different-seed result comparison fails when every random roll is constant', () =>
    Effect.gen(function* () {
      randomControl.constant = true
      randomControl.draws = 0
      randomControl.lootBatches = 0
      try {
        const first = yield* replay(0x1a2b3c4d)
        const second = yield* replay(0x5e6f7081)
        expect(randomControl.draws).toBeGreaterThan(0)
        expect(randomControl.lootBatches).toBeGreaterThan(0)
        expect(() => expect(second.resultHash).not.toBe(first.resultHash)).toThrow()
      } finally {
        randomControl.constant = false
      }
    }),
  )

  it('canonicalizes Map and Set order and preserves floating-point distinctions', () => {
    const forward = {
      blocks: new Map([['2,64,0', 'stone'], ['1,64,0', 'water']]),
      flags: new Set(['burning', 'wet']),
    }
    const reverse = {
      blocks: new Map([['1,64,0', 'water'], ['2,64,0', 'stone']]),
      flags: new Set(['wet', 'burning']),
    }

    expect(hashGameplayState(reverse)).toBe(hashGameplayState(forward))
    expect(hashGameplayState(-0)).not.toBe(hashGameplayState(0))
    expect(hashGameplayState(Number.POSITIVE_INFINITY)).not.toBe(hashGameplayState(Number.NEGATIVE_INFINITY))
    expect(hashGameplayState(new Error('first'))).not.toBe(hashGameplayState(new Error('second')))

    const hiddenProperty = Object.defineProperty({}, 'state', { value: 'hidden' })
    expect(hashGameplayState(hiddenProperty)).not.toBe(hashGameplayState({}))
    expect(() => hashGameplayState({ [Symbol('state')]: 'hidden' })).toThrow(TypeError)
  })
})
