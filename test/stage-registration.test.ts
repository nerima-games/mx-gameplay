/**
 * Named regression tests for the frame contract.
 *
 * Each `it.effect` title below names the thing that must never come back. These
 * are not smoke tests: they encode plan.md §2.3-1 and §2.3-3, both of which are
 * invisible to the type checker and to `pnpm check:deps`, because both are
 * violated with STRINGS rather than with imports.
 */
import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Exit, Layer, Option, Ref } from 'effect'
import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type BlockReading,
  type ChunkStore,
  type ChunkStoreApi,
} from '../src/domain/chunk-store-port'
import { blockIdOf } from '../src/domain/block-vocabulary'
import {
  CREEPER_KIND,
  DROPPED_ITEM_KIND,
  PRIMED_TNT_KIND,
  rollCasualtyDrops,
  type MobBehaviour,
  type MobDropEvent,
  type MobExperienceEvent,
  type MobSpawnAttempt,
} from '../src/domain/entities/mob-frame'
import { spawnDroppedItem } from '../src/domain/entities/dropped-item'
import {
  FIRE_DAMAGE_INTERVAL_TICKS,
  FIRE_TICK_INTERVAL_SECS,
  makeFireLifecycleState,
  type FireLifecycleSnapshot,
} from '../src/domain/fire-lifecycle'
import type { WeatherState } from '../src/domain/weather'
import { SKELETON_KIND, initialEcosystemMobState } from '../src/domain/mob/mob-ecosystem'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import {
  addVillager,
  emptyVillagerTradeState,
  makeVillager,
} from '../src/domain/villager-trade'
import {
  EntityId,
  EntityKind,
  type EntityManager,
  type EntityRoster,
  type PlayerPose,
  type Slot,
} from '@nerima-games/mc-sim'
import { BOW_TARGET_CENTER_Y_OFFSET } from '../src/domain/interactions/bow-shot'
import { BOW_FULL_CHARGE_SECS, BOW_MIN_CHARGE_SECS } from '../src/domain/interactions/draw-bow'
import {
  ENDER_DRAGON_DEATH_XP,
  ENDER_DRAGON_MAX_HEALTH,
} from '../src/domain/mob/ender-dragon-encounter'
import {
  TimeService,
  TimeServiceLayer,
  durability,
  equipmentItem,
  itemStack,
  makeTimeService,
  makeVehicleService,
  type InventoryService,
  type InventoryServiceApi,
} from '@nerima-games/mc-sim'
import {
  DeltaTimeSecs,
  MAX_STACK_COUNT,
  StackCount,
  StageId,
  type FrameServices,
  type GameModule,
  type StageRegistration,
} from '../src/domain/frame-contract'
import { disturb, takeBatch } from '../src/domain/falling-block'
import type { FluidWorkItem } from '../src/domain/fluid-frontier'
import { positionKey } from '../src/domain/position-key'
import { chunkCoordsAround } from '../src/domain/chunk-window'
import { PORTAL_WINDOW_RADIUS } from '../src/domain/interactions/ignite-portal'
import { DEFAULT_ROLL_SEED } from '../src/domain/frame-rolls'
import {
  gameplayStages,
  collectBrewingPotion,
  drainItemUseResults,
  drainPlayerDamages,
  drainPlayerHeals,
  drainBowShotResults,
  drainFluidUpdates,
  drainMeleeAttackResults,
  drainMobDrops,
  drainMobExperience,
  drainVillagerTradeResults,
  drainWeatherGameplayEvents,
  isHoeItem,
  LAVA_TICK_INTERVAL,
  makeGameplayFrameState,
  makeGameplayStages,
  gameplayModule,
  insertBrewingBottle,
  insertBrewingFuel,
  insertBrewingIngredient,
  requestBlockPlacement,
  requestBoneMeal,
  requestBowShot,
  requestFireExtinguish,
  requestFishingAdvance,
  requestFishingCancel,
  requestFishingCast,
  requestFoodUse,
  requestMeleeAttack,
  requestMobSpawn,
  requestPotatoFoodUse,
  requestPotatoPlanting,
  requestSoilTill,
  requestStatusEffect,
  requestTargetedBoneMeal,
  requestTargetedItemUse,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
  requestTargetedPotatoPlanting,
  requestTargetedSoilTill,
  requestVillagerTrade,
  restoreFireLifecycle,
  resolveTargetedBlock,
  getPlayerMovementSpeedMultiplier,
  restoreBrewingStand,
  restoreStatusEffects,
  snapshotBrewingStand,
  snapshotFireLifecycle,
  snapshotStatusEffects,
  submitWeatherGameplayInput,
  useBrewingPotion,
  type EnderPearlThrowRequest,
  type GameplayFrameState,
} from '../src/stages/registration'
import {
  EXPERIENCE_MODULE_STAGE_PREFIXES,
  GAMEPLAY_STAGE_IDS,
  OWN_STAGE_PREFIX,
  UPSTREAM_STAGE_IDS,
} from '../src/stages/stage-ids'
import {
  blockKey,
  emptyWorldStoreLayer,
  makeChunkStoreDouble,
  STONE,
  WATER,
  world,
} from './support/chunk-store-double'
import { emptyRosterLayer, makeEntityManagerDouble } from './support/entity-manager-double'
import { makePlayerServiceDouble, playerDoubleLayer } from './support/player-service-double'
import { PlayerService } from '@nerima-games/mc-sim'
import { emptySlots, emptyInventoryLayer, makeInventoryDouble } from './support/inventory-service-double'
import { FrameServicesLayer } from './support/frame-services'
import { runFrames } from './support/frame-runner'

const stageIds = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.map((stage) => stage.id)
const OBSIDIAN = blockIdOf('obsidian')!

/**
 * The stages read and write blocks, iterate mobs and deposit mined items, so
 * building them takes mc-worldgen's `ChunkStore` AND mc-sim's `EntityManager`
 * AND mc-sim's `InventoryService` (in `frameStages` — see
 * `domain/frame-contract.ts` on `RRegister`). Tests about the SHAPE of the
 * registration provide an empty resident world, an empty roster and an empty
 * inventory: these assertions are about ordering and contract, and the
 * behaviour over a real world is `test/vertical-slice.test.ts`.
 */
const emptyWorld = Layer.mergeAll(
  emptyWorldStoreLayer,
  emptyRosterLayer,
  emptyInventoryLayer,
  // mc-sim's PlayerService, which `stepPortalTravel` reads every frame.
  playerDoubleLayer,
  TimeServiceLayer(),
)

const registeredStages = Effect.provide(makeGameplayStages, emptyWorld)

/** The same, for the tests that need to reach into the frame state. */
const builtStages = Effect.gen(function* () {
  const state = yield* makeGameplayFrameState
  const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const player = yield* makePlayerServiceDouble()
  const inventory = yield* makeInventoryDouble()
  const time = yield* makeTimeService()
  return {
    state,
    store,
    roster,
    inventory,
    player,
    stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time),
  }
})

const builtStagesInWorld = (
  initial: ReadonlyMap<string, BlockId>,
  loadedChunks: ReadonlyArray<string> = ['0,0'],
) =>
  Effect.gen(function* () {
    const state = yield* makeGameplayFrameState
    const store = yield* makeChunkStoreDouble(initial, loadedChunks)
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const player = yield* makePlayerServiceDouble()
    const inventory = yield* makeInventoryDouble()
    const time = yield* makeTimeService()
    return {
      state,
      store,
      player,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time),
    }
  })

const allAfterEdges = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.flatMap((stage) => [...(stage.after ?? [])])

describe('§2.3-1 zero edges between experience modules', () => {
  it.effect(
    'REGRESSION: no `after` edge names another experience module, so mx-gameplay cannot be ordered against mx-redstone/mx-ui/mx-multiplayer',
    () =>
      Effect.gen(function* () {
        const stages = yield* registeredStages
        const foreign = allAfterEdges(stages).filter((edge) =>
          EXPERIENCE_MODULE_STAGE_PREFIXES.some(
            (prefix) => prefix !== OWN_STAGE_PREFIX && edge.startsWith(prefix),
          ),
        )

        // A StageId is a string, so `pnpm check:deps` cannot see this: an
        // `after: [StageId('ui:hud-sync')]` imports nothing while still making
        // mx-gameplay's frame position depend on mx-ui existing. plan.md §4.2
        // puts redstone between gameplay's fluids and its time/weather stage —
        // that ordering is mc-compose's to state, not ours.
        expect(foreign).toStrictEqual([])
      }),
  )

  it.effect('REGRESSION: every declared upstream stage belongs to a foundation repository, never to a sibling', () =>
    Effect.sync(() => {
      for (const id of Object.values(UPSTREAM_STAGE_IDS)) {
        const isSibling = EXPERIENCE_MODULE_STAGE_PREFIXES.some(
          (prefix) => prefix !== OWN_STAGE_PREFIX && id.startsWith(prefix),
        )
        expect(isSibling).toBe(false)
      }
    }),
  )
})

describe('§2.3-3 the total order belongs to mc-compose', () => {
  it.effect('REGRESSION: this repository exposes no way to resolve a total order — only `after` constraints', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages

      // Every stage declares constraints and nothing else. If a future commit
      // adds a `priority`, an `index`, or a `sortStages()` export, this
      // assertion is the thing that should stop it: those are all ways of
      // claiming a position in a sequence this repository cannot see.
      for (const stage of stages) {
        expect(Object.keys(stage).sort()).toStrictEqual(['after', 'id', 'run'])
      }
    }),
  )

  it.effect('the declared constraints form the §4.2 skeleton fragment gameplay is responsible for', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages
      const byId = new Map(stages.map((stage) => [stage.id, stage]))

      expect(stageIds(stages)).toStrictEqual([
        GAMEPLAY_STAGE_IDS.vehicles,
        GAMEPLAY_STAGE_IDS.interactions,
        GAMEPLAY_STAGE_IDS.fire,
        GAMEPLAY_STAGE_IDS.survivalHunger,
        GAMEPLAY_STAGE_IDS.entities,
        GAMEPLAY_STAGE_IDS.enderDragon,
        GAMEPLAY_STAGE_IDS.fluids,
        GAMEPLAY_STAGE_IDS.timeWeather,
      ])

      expect(byId.get(GAMEPLAY_STAGE_IDS.vehicles)?.after).toStrictEqual([
        UPSTREAM_STAGE_IDS.simPhysics,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.interactions)?.after).toStrictEqual([
        UPSTREAM_STAGE_IDS.simPhysics,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.fire)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.interactions,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.survivalHunger)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.fire,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.entities)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.survivalHunger,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.enderDragon)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.entities,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.fluids)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.enderDragon,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.timeWeather)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.fluids,
      ])
    }),
  )

  it.effect('a consumer that ignores the array order and honours only `after` still gets a legal schedule', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages
      // Reversed on purpose: mc-compose merges four modules' arrays, so the
      // order mx-gameplay happened to write them in is never what it sees.
      const shuffled = [...stages].reverse()

      const position = new Map(stageIds(shuffled).map((id, index) => [id, index]))
      const satisfied = shuffled.every((stage) =>
        (stage.after ?? []).every((edge) => {
          const edgePosition = position.get(edge)
          // A dangling edge (a stage nobody registered) is scheduled as if the
          // edge were absent — that is what lets a module order itself against
          // an optional peer. See domain/frame-contract.ts.
          return edgePosition === undefined || edgePosition < (position.get(stage.id) ?? 0)
        }),
      )

      // The REVERSED array violates the constraints, which is the point: the
      // array order is not the schedule. A real consumer must sort.
      expect(satisfied).toBe(false)
    }),
  )

  it.effect('StageId rejects a blank id, so a stage cannot register itself as an unnameable vertex', () =>
    Effect.sync(() => {
      expect(() => StageId('   ')).toThrow()
      expect(StageId('gameplay:interactions')).toBe('gameplay:interactions')
    }),
  )
})

describe('fire lifecycle stage integration', () => {
  const FIRE = blockIdOf('fire') ?? 119

  it.effect('retains an active fire while its chunk is temporarily unavailable', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const position = { x: 16, y: 64, z: 0 }
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 7))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(
        Effect.provide(FrameServicesLayer),
      )

      expect((yield* Ref.get(state.fireLifecycle)).fires).toStrictEqual([
        { position, ageTicks: 0, unloadedRetries: 1 },
      ])
    }),
  )

  it.effect('does not drift logical or world state when a manual extinguish write fails', () =>
    Effect.gen(function* () {
      const { state, store } = yield* builtStages
      const position = { x: 1, y: 64, z: 0 }
      yield* store.api.setBlock(position, FIRE)
      const initial = makeFireLifecycleState([position], 11)
      yield* Ref.set(state.fireLifecycle, initial)
      const refusingStore: ChunkStoreApi = {
        ...store.api,
        setBlock: () => Effect.succeed({ _tag: 'OutOfWorld' }),
      }

      expect(yield* requestFireExtinguish(state, refusingStore, position)).toBe(false)
      expect(yield* store.blockAt(position)).toBe(FIRE)
      expect(yield* Ref.get(state.fireLifecycle)).toStrictEqual(initial)
    }),
  )

  it.effect('routes lethal entity fire damage through the existing casualty and drop path', () =>
    Effect.gen(function* () {
      const { state, store, roster, stages } = yield* builtStages
      const position = { x: 2, y: 64, z: 0 }
      yield* store.api.setBlock({ ...position, y: position.y - 1 }, STONE)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 13))
      const target = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: position,
        healthPoints: 1,
        behaviour: undefined,
      })
      const expected = rollCasualtyDrops([
        { id: target.id, kind: target.kind, at: target.feetPosition },
      ], DEFAULT_ROLL_SEED)

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(
        Effect.provide(FrameServicesLayer),
      )

      expect((yield* roster.api.snapshot).entities).toStrictEqual([])
      expect(yield* drainMobDrops(state)).toStrictEqual(expected.drops)
      expect(yield* drainMobDrops(state)).toStrictEqual([])
      expect(yield* Ref.get(state.rollSeed)).toBe(expected.seed)
      expect((yield* Ref.get(state.fireLifecycle)).burningActors).toStrictEqual([])
    }),
  )

  it.effect('caps a large frame to four fire ticks', () =>
    Effect.gen(function* () {
      const { state, store, stages } = yield* builtStages
      const position = { x: 3, y: 64, z: 0 }
      yield* store.api.setBlock({ ...position, y: position.y - 1 }, STONE)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 17))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(99)).pipe(Effect.provide(FrameServicesLayer))

      expect((yield* Ref.get(state.fireLifecycle)).fires).toStrictEqual([
        { position, ageTicks: 4 },
      ])
    }),
  )
})

describe('Ender Dragon normal frame lifecycle', () => {
  it.effect('does not advance outside the End and is deterministic across frame chunking', () =>
    Effect.gen(function* () {
      const once = yield* builtStages
      const chunked = yield* builtStages
      const onceStage = once.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.enderDragon)!
      const chunkedStage = chunked.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.enderDragon)!

      const initial = yield* once.state.enderDragonEncounter.snapshot
      yield* onceStage.run(DeltaTimeSecs(14))
      expect(yield* once.state.enderDragonEncounter.snapshot).toStrictEqual(initial)
      expect(yield* once.state.enderDragonEncounter.drainEvents).toStrictEqual([])

      yield* once.player.api.setDimension('end')
      yield* chunked.player.api.setDimension('end')
      yield* onceStage.run(DeltaTimeSecs(14))
      yield* chunkedStage.run(DeltaTimeSecs(7))
      yield* chunkedStage.run(DeltaTimeSecs(7))

      expect(yield* chunked.state.enderDragonEncounter.snapshot).toStrictEqual(
        yield* once.state.enderDragonEncounter.snapshot,
      )
      expect(yield* chunked.state.enderDragonEncounter.drainEvents).toStrictEqual(
        yield* once.state.enderDragonEncounter.drainEvents,
      )
    }),
  )

  it.effect('exposes attacks, terminal world events, and exactly-once rewards across restore', () =>
    Effect.gen(function* () {
      const { state } = yield* builtStages
      const result = yield* state.enderDragonEncounter.damageByPlayer(ENDER_DRAGON_MAX_HEALTH)
      expect(result._tag).toBe('Applied')

      const events = yield* state.enderDragonEncounter.drainEvents
      expect(events).toContainEqual({ _tag: 'ExperienceRewarded', amount: ENDER_DRAGON_DEATH_XP })
      expect(events.filter((event) => event._tag === 'ExperienceRewarded')).toHaveLength(1)
      expect(events.filter((event) => event._tag === 'ExitPortalMaterializationRequested')).toHaveLength(1)
      expect(events.filter((event) => event._tag === 'DragonEggRewarded')).toHaveLength(1)

      const dead = yield* state.enderDragonEncounter.snapshot
      expect(yield* state.enderDragonEncounter.restore(dead)).toBe(true)
      yield* state.enderDragonEncounter.damageByPlayer(1)
      expect(yield* state.enderDragonEncounter.drainEvents).toStrictEqual([])
    }),
  )
})

describe('stage behaviour', () => {
  it.effect('REGRESSION: an idle tick does no falling-block work at all (the O(chunks × blocks) scan is gone)', () =>
    Effect.gen(function* () {
      const { state, store, stages } = yield* builtStages
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      expect(entities).toBeDefined()

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void

      // Nothing was disturbed, so nothing was looked at. The reference's
      // pre-fix behaviour read ~7M blocks here regardless
      // (falling-block-maintenance.ts:9-15). Now that the stage really holds a
      // store, "did no work" is checkable directly: zero calls, not merely zero
      // changes.
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 0 })
      const queue = yield* Ref.get(state.fallingBlocks)
      expect(queue.pending.size).toBe(0)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('REGRESSION: a burst of disturbances is spread across ticks by the per-tick move budget', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)

      // A TNT blast under a desert. The world is empty, so none of these
      // positions produces a move — the assertion is about the BUDGET, which
      // bounds how many positions are examined rather than how many move.
      const blast = Array.from({ length: 100 }, (_, index) => positionKey(`0,${String(index)},0`))
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, blast))

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(100 - 32)

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(100 - 64)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('REGRESSION: lava keys survive the ticks on which lava is not scheduled', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)

      yield* Ref.set(state.fluidFrontier, [
        { key: positionKey('lava-a'), kind: 'lava' },
        { key: positionKey('lava-b'), kind: 'lava' },
      ])

      // Tick 1: lava's tick is inactive (1 % 4 !== 0), so nothing is evaluated
      // and BOTH keys must still be there next tick. Dropping them is the
      // straight-edged-lava-lake bug.
      yield* fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fluidFrontier)).map((item) => item.key)).toStrictEqual([
        'lava-a',
        'lava-b',
      ])

      for (let tick = 2; tick <= LAVA_TICK_INTERVAL; tick += 1) {
        yield* fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      }

      // On the active tick they are consumed.
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('fluid updates are destructively drained without consuming inactive lava', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)
      const water = { key: positionKey('water-a'), kind: 'water' } as const
      const lava = { key: positionKey('lava-a'), kind: 'lava' } as const

      yield* Ref.set(state.fluidFrontier, [water, lava])
      yield* fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void

      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([lava])

      for (let tick = 2; tick <= LAVA_TICK_INTERVAL; tick += 1) {
        yield* fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      }

      expect(yield* drainFluidUpdates(state)).toStrictEqual([water, lava])
      expect(yield* drainFluidUpdates(state)).toStrictEqual([])
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('REGRESSION: concurrent fluid stage runs drain each work item at most once', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)
      const work = Array.from({ length: 8 }, (_, index) => ({
        key: positionKey(`water-${String(index)}`),
        kind: 'water' as const,
      }))

      yield* Ref.set(state.fluidFrontier, work)
      yield* Effect.all(
        [
          fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void,
          fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void,
        ],
        { concurrency: 2 },
      )

      expect(yield* drainFluidUpdates(state)).toStrictEqual(work)
      expect(yield* drainFluidUpdates(state)).toStrictEqual([])
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('deduplicates direct frontier writes by position before spending budget', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!
      const latest = { key: positionKey('water-a'), kind: 'water' as const, deferred: 2 }

      yield* Ref.set(state.fluidFrontier, [
        { key: positionKey('water-a'), kind: 'water' },
        latest,
      ])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect(yield* drainFluidUpdates(state)).toStrictEqual([latest])
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('fluid propagation writes downward before considering horizontal air', () =>
    Effect.gen(function* () {
      const origin = { x: 0, y: 64, z: 0 }
      const { state, store, stages } = yield* builtStagesInWorld(world([[origin, WATER]]))
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect(yield* store.blockAt({ x: 0, y: 63, z: 0 })).toBe(WATER)
      expect(yield* store.blockAt({ x: -1, y: 64, z: 0 })).toBeUndefined()
      expect(yield* store.blockAt({ x: 1, y: 64, z: 0 })).toBeUndefined()
      expect(yield* Ref.get(state.fluidFrontier)).toContainEqual({
        key: '0,63,0',
        kind: 'water',
        level: 0,
        source: false,
        parent: '0,64,0',
        falling: true,
      })
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('blocked fluid spreads to the four horizontal neighbours in deterministic order', () =>
    Effect.gen(function* () {
      const origin = { x: 0, y: 64, z: 0 }
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [{ x: 0, y: 63, z: 0 }, STONE],
        ]),
        ['0,0', '-1,0', '0,-1'],
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect((yield* Ref.get(state.fluidFrontier)).map((item) => item.key)).toStrictEqual([
        '-1,64,0',
        '1,64,0',
        '0,64,-1',
        '0,64,1',
      ])
      for (const position of [
        { x: -1, y: 64, z: 0 },
        { x: 1, y: 64, z: 0 },
        { x: 0, y: 64, z: -1 },
        { x: 0, y: 64, z: 1 },
      ]) {
        expect(yield* store.blockAt(position)).toBe(WATER)
      }
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('removing a source retracts the flowing cells that depended on it', () =>
    Effect.gen(function* () {
      const origin = { x: 0, y: 64, z: 0 }
      const neighbours = [
        { x: -1, y: 64, z: 0 },
        { x: 1, y: 64, z: 0 },
        { x: 0, y: 64, z: -1 },
        { x: 0, y: 64, z: 1 },
      ] as const
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [{ x: 0, y: 63, z: 0 }, STONE],
        ]),
        ['0,0', '-1,0', '0,-1'],
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))
      yield* store.api.setBlock(origin, AIR_BLOCK_ID)
      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))
      yield* fluids.run(DeltaTimeSecs(0.016))

      for (const position of neighbours) {
        expect(yield* store.blockAt(position)).toBe(AIR_BLOCK_ID)
      }
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('water meeting a lava source materializes obsidian at the contact', () =>
    Effect.gen(function* () {
      const lava = blockIdOf('lava')!
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [{ x: 0, y: 64, z: 0 }, WATER],
          [{ x: 0, y: 63, z: 0 }, STONE],
          [{ x: 1, y: 64, z: 0 }, lava],
        ]),
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect(yield* store.blockAt({ x: 1, y: 64, z: 0 })).toBe(OBSIDIAN)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('an unloaded chunk boundary defers a source finitely and never writes outside the loaded set', () =>
    Effect.gen(function* () {
      const origin = { x: 15, y: 64, z: 0 }
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [{ x: 15, y: 63, z: 0 }, STONE],
        ]),
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!
      let source: FluidWorkItem = { key: positionKey('15,64,0'), kind: 'water' }

      for (let attempt = 1; attempt <= 8; attempt += 1) {
        yield* Ref.set(state.fluidFrontier, [source])
        yield* fluids.run(DeltaTimeSecs(0.016))
        const sourceKey = source.key
        const deferred = (yield* Ref.get(state.fluidFrontier)).find(
          (item) => item.key === sourceKey,
        )!
        expect(deferred.deferred).toBe(attempt)
        source = deferred
      }

      yield* Ref.set(state.fluidFrontier, [source])
      yield* fluids.run(DeltaTimeSecs(0.016))
      expect((yield* Ref.get(state.fluidFrontier)).some((item) => item.key === source.key)).toBe(
        false,
      )
      expect(yield* store.blockAt({ x: 16, y: 64, z: 0 })).toBeUndefined()
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  // REGRESSION: the time of day is mc-sim's. It survives save/load, which is
  // the very test the module header names for whether a Ref belongs here, so it
  // is a noun and lives in `mc-sim/domain/time-of-day.ts` behind
  // `application/time-service.ts` (plan.md §2.3-1). This file used to hold
  // `timeOfDaySecs` and `dayLengthSecs` Refs and advance them, with a
  // `DEFAULT_DAY_LENGTH_SECS` of 1200 against mc-sim's 400 — two owners of one
  // noun, disagreeing, with only mc-sim's copy reaching the save file.
  //
  // ---------------------------------------------------------------------------
  // THIS TEST WAS CALLED 「holds no time of day and no day length」 AND IS NOT
  // ---------------------------------------------------------------------------
  //
  // A `timeOfDay` Ref now exists, and renaming a regression test to accommodate
  // the thing it was built to prevent deserves the paragraph rather than a
  // shrug. Two facts settle it.
  //
  // FIRST, the deleted failure was not "a field named timeOfDay". It was
  // OWNERSHIP: this file computed the hour, advanced it every frame from its own
  // day length, and disagreed with mc-sim about how long a day was. The new Ref
  // does none of those three. Nothing in `stages/registration.ts` increments it,
  // there is no day length anywhere in this repository, and the value is
  // overwritten by the host every frame rather than accumulated.
  //
  // SECOND, the property that actually matters is now asserted DIRECTLY, in the
  // test below, instead of being inferred from the absence of a key: running
  // frames must not change the hour. That is a strictly stronger statement than
  // "there is no field called this", because a field called something else that
  // advanced the clock would have passed the old test and fails the new one.
  //
  // What survives here unchanged is the exact-list gate, which is the part that
  // makes an addition reviewable.
  it.effect('REGRESSION: the frame state holds no day length or host-owned state', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // The list is exact on purpose: another answer to "what does mx-gameplay
      // remember between frames" has to be argued for in a diff. Two arrived
      // with the block-write wiring, four with the mob wiring, two with the
      // spawn search and FIVE with placement, loot and weather, and every one of
      // the sixteen passes the save-file test — see the paragraph on
      // `GameplayFrameState` in `stages/registration.ts`, which argues
      // `targetPosition`, `timeOfDay` and the weather pair at length because
      // they are the ones that most look like second owners of a noun.
      //
      // `spawnClockSecs` is the least interesting of the sixteen and the easiest
      // to justify: it is a countdown to the next search, and losing it on a
      // reload costs at most one 0.3s interval.
      //
      // `weather` / `weatherAdvanced` ARE THE PAIR TO WATCH, and they are the
      // reason this list is worth keeping exact. A save file does need the
      // weather, and no repository owns it — so the temptation is a single
      // advancing `Ref`, which would be `timeOfDaySecs` all over again except
      // that nothing would ever disagree with it and nobody would find out. The
      // two keys are an inbox and an outbox, and the test below asserts that
      // running frames does not change the inbox.
      //
      // `pendingItemUses` / `usedItems` ARE THE THIRD INBOX AND THE THIRD
      // OUTBOX, and they pass the same test the other five do: a save file
      // records that a portal is lit, never that a flint and steel was clicked,
      // and never that one point of durability is owed to a slot mc-sim owns.
      // The outbox is separate from `consumedItems` because the two name
      // different `InventoryService` verbs — see the header.
      //
      // `pendingBowShots` / `bowKnockbacks` AND `pendingPearlThrows` /
      // `enderPearlOutcomes` are the fourth and fifth inbox/outbox pairs, and
      // they pass the same test: a save file records where a mob is and how much
      // health it has left — both mc-sim's — never that a bow was loosed, and
      // never which way a hit shoved something. THE TWO OUTBOXES ARE HERE FOR A
      // DIFFERENT REASON FROM THE OTHER THREE, though, and it is worth the
      // distinction: `consumedItems` and `usedItems` wait on an inventory verb
      // this repository could call wrongly, while these two wait on a noun that
      // does not exist anywhere — a velocity field on the roster, and a player.
      // See their types in `stages/registration.ts`.
      //
      // `portalDwell` IS THE SEVENTEENTH AND IT IS NOT AN INBOX OR AN OUTBOX,
      // which makes it the one most worth arguing. It holds how long the player
      // has stood in a portal block, and it passes the save-file test cleanly: a
      // save records WHICH DIMENSION the player is in — mc-sim's, reached
      // through `PlayerServiceApi.setDimension` — and never that they were two
      // seconds into a crossing. Losing it on a reload costs at most one dwell,
      // which is the same trade `spawnClockSecs` makes.
      //
      // It is emphatically NOT a second owner of the dimension. The union is
      // mc-worldgen's word and the current value is mc-sim's state; this Ref
      // holds neither, only a timer and a cooldown.
      //
      // WHAT IS STILL NOT HERE is the thing this list exists to keep out: there
      // is no `Ref<Map<MobId, CreeperFuse>>`, no mob position, no mob health, no
      // entity roster, no INVENTORY, no PLAYER POSITION and no GAME MODE — and no DAY
      // LENGTH, which is the half of the original failure that has no stand-in
      // and never will, because nothing in this repository needs to know how long
      // a day is.
      expect(Object.keys(state).sort()).toStrictEqual([
        'blockUseResults',
        'bowKnockbacks',
        'bowShotResults',
        'brewingStand',
        'consumedItems',
        'endPortalTravels',
        'enderDragonEncounter',
        'enderPearlOutcomes',
        'fallingBlocks',
        'fireLifecycle',
        'fishingSession',
        'fluidFrontier',
        'fluidUpdates',
        'handledBowShotRequestIds',
        'heldTool',
        'hostileContactCooldowns',
        'itemUseResults',
        'meleeAttackResults',
        'mobDrops',
        'mobExperience',
        'pendingBlockUses',
        'pendingBowShots',
        'pendingBreaks',
        'pendingItemUses',
        'pendingMeleeAttacks',
        'pendingPearlThrows',
        'pendingPlacements',
        'pendingStatusEffects',
        'pendingVillagerTrades',
        'playerDamages',
        'playerDead',
        'playerHeals',
        'playerMovementSpeedMultiplier',
        'portalCandidates',
        'portalDwell',
        'portalTravels',
        'rollSeed',
        'spawnAttempts',
        'spawnClockSecs',
        'statusEffects',
        'survivalHunger',
        'targetPosition',
        'tickCount',
        'timeOfDay',
        'usedItems',
        'villagerTradeResults',
        'villagerTrades',
        'weather',
        'weatherAdvanced',
        'weatherGameplay',
        'weatherGameplayEvents',
        'weatherGameplayInput',
      ])

      // The pearl teleports the player and the game mode decides whether it
      // hurts. NEITHER IS HERE, and both are named because the pearl is the first
      // rule in this repository that wanted them: a `playerPosition` Ref would be
      // a second owner of `targetPosition`'s noun, and a `gameMode` Ref would be
      // a second owner of a save-file fact. Both leave through
      // `enderPearlOutcomes` instead.
      expect(Object.keys(state)).not.toContain('playerPosition')
      expect(Object.keys(state)).not.toContain('gameMode')

      expect(Object.keys(state)).not.toContain('dayLength')
      expect(Object.keys(state)).not.toContain('dayLengthSecs')
      expect(Object.keys(state)).not.toContain('timeOfDaySecs')
      // Inventory contents and mining overflow are both owned outside frame
      // state: mc-sim owns carried stacks, while refused deposits become
      // dropped-item entities in its roster.
      expect(Object.keys(state)).not.toContain('inventory')
      expect(Object.keys(state)).not.toContain('slots')
      expect(Object.keys(state)).not.toContain('heldItems')
    }),
  )

  it.effect('bow results correlate successful and refused requests and drain exactly once', () =>
    Effect.gen(function* () {
      const { state, inventory, stages } = yield* builtStages
      const shot = {
        origin: { x: 0, y: 64, z: 0 },
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        chargeSecs: BOW_FULL_CHARGE_SECS,
        inventory: { mode: 'creative', slotIndex: 0 },
      } as const

      yield* requestBowShot(state, 'fired', shot)
      yield* requestBowShot(state, 'undercharged', {
        ...shot,
        chargeSecs: BOW_MIN_CHARGE_SECS / 2,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      yield* requestBowShot(state, 'duplicate', shot)
      yield* requestBowShot(state, 'duplicate', shot)

      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'fired', success: true, outcome: 'Fired' },
        { requestId: 'undercharged', success: false, outcome: 'Undercharged' },
        { requestId: 'duplicate', success: true, outcome: 'Fired' },
        { requestId: 'duplicate', success: false, outcome: 'DuplicateRequest' },
      ])
      expect(yield* drainBowShotResults(state)).toStrictEqual([])
      expect(yield* inventory.withdrawals).toStrictEqual([])

      yield* requestBowShot(state, 'duplicate', shot)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'duplicate', success: false, outcome: 'DuplicateRequest' },
      ])
      expect(yield* inventory.withdrawals).toStrictEqual([])
    }),
  )

  it.effect('melee results reflect actual stage hits and misses in request order and drain once', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* builtStages
      const target = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: 0, y: 64 - BOW_TARGET_CENTER_Y_OFFSET, z: 2 },
        healthPoints: 20,
        behaviour: undefined,
      })

      yield* requestMeleeAttack(state, {
        requestId: 'hit',
        origin: { x: 0, y: 64, z: 0 },
        direction: { x: 0, y: 0, z: 1 },
        reach: 3,
        damage: 4,
      })
      yield* requestMeleeAttack(state, {
        requestId: 'miss',
        origin: { x: 0, y: 64, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        reach: 3,
        damage: 7,
      })

      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const results = yield* drainMeleeAttackResults(state)
      expect(results).toHaveLength(2)
      expect(results[0]).toStrictEqual({
        requestId: 'hit',
        success: true,
        target: { id: target.id, distance: 2 },
      })
      expect(results[1]).toStrictEqual({ requestId: 'miss', success: false })
      expect(yield* drainMeleeAttackResults(state)).toStrictEqual([])
      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(16)
      expect(yield* drainMobExperience(state)).toStrictEqual([])
    }),
  )

  it.effect('a lethal melee hit on a kind with no XP reward or drop table emits neither', () =>
    Effect.gen(function* () {
      // Every other lethal-hit test in this file kills a `CREEPER_KIND`, which
      // has both an XP reward and a drop table, so `experience.length > 0` and
      // `drops.length > 0` had only ever been taken. `skeleton` is a
      // `HOSTILE_KINDS` member (melee can target it) for which
      // `xpRewardOfKind` and `dropRulesOfKind` both fall through to their
      // zero/empty default, so a lethal hit on it takes neither.
      const { state, roster, stages } = yield* builtStages
      const feetPosition = { x: 0, y: 64 - BOW_TARGET_CENTER_Y_OFFSET, z: 2 }
      yield* roster.api.spawn({
        kind: EntityKind('skeleton'),
        feetPosition,
        healthPoints: 4,
        behaviour: undefined,
      })

      yield* requestMeleeAttack(state, {
        origin: { x: 0, y: 64, z: 0 },
        direction: { x: 0, y: 0, z: 1 },
        reach: 3,
        damage: 4,
      })
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect((yield* roster.api.snapshot).entities).toStrictEqual([])
      expect(yield* drainMobExperience(state)).toStrictEqual([])
      expect(yield* drainMobDrops(state)).toStrictEqual([])
    }),
  )

  it.effect('a lethal player melee hit emits mob experience exactly once', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* builtStages
      const feetPosition = { x: 0, y: 64 - BOW_TARGET_CENTER_Y_OFFSET, z: 2 }
      const target = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition,
        healthPoints: 4,
        behaviour: undefined,
      })

      yield* requestMeleeAttack(state, {
        origin: { x: 0, y: 64, z: 0 },
        direction: { x: 0, y: 0, z: 1 },
        reach: 3,
        damage: 4,
      })
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect((yield* roster.api.snapshot).entities).toStrictEqual([])
      expect(yield* drainMobExperience(state)).toStrictEqual([
        { source: target.id, kind: CREEPER_KIND, at: feetPosition, amount: 5 },
      ])
      expect(yield* drainMobExperience(state)).toStrictEqual([])
    }),
  )

  it.effect('terrain occludes entity damage before a fired shot reaches the roster', () =>
    Effect.gen(function* () {
      const target: EntityRoster<MobBehaviour> = {
        entities: [
          {
            id: EntityId('target-behind-wall'),
            kind: EntityKind('creeper'),
            feetPosition: { x: 0, y: 64 - BOW_TARGET_CENTER_Y_OFFSET, z: 10 },
            healthPoints: 20,
            behaviour: undefined,
          },
        ],
        nextSerial: 1,
      }
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([[{ x: 0, y: 64, z: 5 }, STONE]]), [
        '0,0',
      ])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>(target)
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)

      yield* requestBowShot(state, 'wall-shot', {
        origin: { x: 0, y: 64, z: 0 },
        dirX: 0,
        dirY: 0,
        dirZ: 1,
        chargeSecs: BOW_FULL_CHARGE_SECS,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'wall-shot', success: true, outcome: 'Fired' },
      ])
      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20)
      expect(yield* Ref.get(state.bowKnockbacks)).toStrictEqual([])
    }),
  )

  // REGRESSION, and the one that replaces what the rename above gave up: this
  // repository READS the hour and never ADVANCES it.
  //
  // The deleted `timeOfDaySecs` Ref was advanced by the `gameplay:time-weather`
  // stage, which is why that stage is still deliberately empty and says so.
  // Anything that ticked the clock — there, or in the entities stage that now
  // reads it — would recreate the two-owners failure under a different name, and
  // the key-list test above could not see it.
  it.effect('REGRESSION: no stage advances the clock, whatever the frame does', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages

      // A value no default could produce, so that "unchanged" cannot be
      // satisfied by a stage resetting it to zero.
      const written = 0.375
      yield* Ref.set(state.timeOfDay, written)

      // Every stage, many times, with a delta large enough that the spawn
      // search's 0.3s cadence fires repeatedly. If anything ticked the clock —
      // by dt, by a day length, or by a tick count — twenty frames would show
      // it.
      for (let frame = 0; frame < 20; frame += 1) {
        for (const stage of stages) {
          yield* stage.run(DeltaTimeSecs(0.25))
        }
      }

      // EXACTLY what the host wrote. This is the property the deleted
      // `timeOfDaySecs` Ref violated, and it is asserted rather than inferred
      // from a missing key.
      expect(yield* Ref.get(state.timeOfDay)).toBe(written)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('multiplayer authority leaves local Mob simulation disabled', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const offered: MobSpawnAttempt = {
        candidate: {
          groundBlock: AIR_BLOCK_ID,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          timeOfDay: 0,
          distanceToPlayerBlocksXZ: 24,
        },
        kind: CREEPER_KIND,
        feetPosition: { x: 1, y: 64, z: 0 },
      }
      yield* Ref.set(state.spawnAttempts, [offered])
      yield* Ref.set(state.spawnClockSecs, 0.2)

      const stages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        { mobSimulation: false },
      )
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      yield* entities!.run(DeltaTimeSecs(1))

      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([offered])
      expect(yield* Ref.get(state.spawnClockSecs)).toBe(0.2)
      expect(yield* roster.api.count).toBe(0)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('droppedItemPickup: false leaves a dropped item at the player\'s feet untouched', () =>
    Effect.gen(function* () {
      // A consumer that runs its own richer pickup loop (preserving metadata,
      // durability or custom names this stage's `pickupDroppedItems` does not
      // carry) sets `droppedItemPickup: false` to avoid double-consuming the
      // same dropped item. Spawned AT the player's feet — distance zero, well
      // inside `DROPPED_ITEM_PICKUP_RADIUS` — so the only thing that could be
      // keeping it on the ground is the option, not range.
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const spawned = yield* spawnDroppedItem(roster.api, {
        item: 'gunpowder',
        count: 1,
        at: { x: 0, y: 64, z: 0 },
      })

      const stages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        { droppedItemPickup: false },
      )
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      yield* entities!.run(DeltaTimeSecs(1))

      expect(yield* roster.api.count).toBe(1)
      const [remaining] = yield* roster.api.entities
      expect(remaining).toStrictEqual(spawned)
      expect(remaining?.kind).toBe(DROPPED_ITEM_KIND)
      expect(yield* inventory.deposits).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  // REGRESSION-SHAPED: the paragraph in `stages/registration.ts` that this file
  // has enforced since the day-length deletion says a `Ref<Map<MobId,
  // CreeperFuse>>` here would be 「the same mistake as the `timeOfDaySecs` Ref
  // this file used to hold」. The roster now exists in mc-sim, so the temptation
  // is gone — but the way it would come back is a stage that CACHES what it read
  // from the roster, which looks like an optimisation rather than like ownership.
  it.effect('REGRESSION: the frame state holds no mob, no mob position and no mob health', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // Nothing here is a Map, which is the shape a mob cache takes, and nothing
      // is an entity. The two mob-shaped fields hold a target the frame is
      // handed and candidate cells offered to a rule; both are emptied or
      // overwritten within the frame that reads them.
      expect(yield* Ref.get(state.targetPosition)).toBeUndefined()
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
    }),
  )

  it.effect('host mob boundaries preserve spawn order and atomically drain drops', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const spawn = (x: number): MobSpawnAttempt => ({
        candidate: {
          groundBlock: AIR_BLOCK_ID,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          timeOfDay: 0,
          distanceToPlayerBlocksXZ: 24,
        },
        kind: CREEPER_KIND,
        feetPosition: { x, y: 64, z: 0 },
      })
      const first = spawn(1)
      const second = spawn(2)

      yield* requestMobSpawn(state, first)
      yield* requestMobSpawn(state, second)
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([first, second])

      const drop: MobDropEvent = {
        item: 'gunpowder',
        count: 1,
        source: EntityId('qa-creeper'),
        kind: CREEPER_KIND,
        at: { x: 1, y: 64, z: 0 },
      }
      const experience: MobExperienceEvent = {
        source: EntityId('qa-creeper'),
        kind: CREEPER_KIND,
        at: { x: 1, y: 64, z: 0 },
        amount: 5,
      }
      yield* Ref.set(state.mobDrops, [drop])
      yield* Ref.set(state.mobExperience, [experience])

      expect(yield* drainMobDrops(state)).toStrictEqual([drop])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
      expect(yield* drainMobDrops(state)).toStrictEqual([])
      expect(yield* drainMobExperience(state)).toStrictEqual([experience])
      expect(yield* Ref.get(state.mobExperience)).toStrictEqual([])
      expect(yield* drainMobExperience(state)).toStrictEqual([])
    }),
  )

  it.effect('the seed is a literal, so two frame states start from the same one', () =>
    Effect.gen(function* () {
      // `domain/frame-rolls.ts` is a whole file about why randomness enters here
      // and nowhere else. The property that matters to plan.md §5.1-3 is this
      // one: two runs of one scenario draw the same numbers.
      const first = yield* makeGameplayFrameState
      const second = yield* makeGameplayFrameState

      expect(yield* Ref.get(first.rollSeed)).toBe(DEFAULT_ROLL_SEED)
      expect(yield* Ref.get(second.rollSeed)).toBe(DEFAULT_ROLL_SEED)
    }),
  )

  // REGRESSION: host-owned state stays outside this object. Fire is the one
  // gameplay-owned world process and has an explicit snapshot/restore boundary;
  // every queue and outbox below remains disposable frame-local scratch.
  it.effect('REGRESSION: frame-local queues start empty and deterministic state starts seeded', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // A work queue of disturbed columns, a frontier of cells still to look
      // at, the counter that paces lava, and this frame's request inboxes are
      // reconstructed within a frame of a reload.
      expect(yield* Ref.get(state.fallingBlocks)).toStrictEqual({ pending: new Set<string>() })
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
      expect(yield* Ref.get(state.tickCount)).toBe(0)
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
      expect(yield* Ref.get(state.targetPosition)).toBeUndefined()
      expect(yield* Ref.get(state.rollSeed)).toBe(DEFAULT_ROLL_SEED)
      expect(yield* Ref.get(state.fireLifecycle)).toStrictEqual({
        fires: [],
        seed: DEFAULT_ROLL_SEED,
      })
    }),
  )

  it.effect('a stage tolerates dt = 0, because a frame may be scheduled twice inside one clock tick', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const before = yield* Ref.get(state.tickCount)
      yield* Effect.forEach(stages, (stage) => stage.run(DeltaTimeSecs(0)))
      // The fluid stage counts ticks rather than seconds, so a zero delta still
      // advances it by one — what must not happen is a crash or a divide by dt.
      expect(yield* Ref.get(state.tickCount)).toBe(before + 1)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('each call to makeGameplayFrameState yields independent state (re-entrant initialisation)', () =>
    Effect.gen(function* () {
      // plan.md §3.8: app-scope singletons were among the reference's worst bug
      // sources — a second world load inherited the first world's refs and
      // deadlocked. Two playgrounds in one process must not share a frontier.
      const first = yield* makeGameplayFrameState
      const second = yield* makeGameplayFrameState

      yield* Ref.update(first.fallingBlocks, (queue) => disturb(queue, [positionKey('1,2,3')]))

      expect((yield* Ref.get(first.fallingBlocks)).pending.size).toBe(1)
      expect((yield* Ref.get(second.fallingBlocks)).pending.size).toBe(0)
    }),
  )

  it.effect('takeBatch preserves disturbance order, which is what makes a scenario test an oracle', () =>
    Effect.sync(() => {
      const queue = disturb({ pending: new Set<ReturnType<typeof positionKey>>() }, [positionKey('c'), positionKey('a'), positionKey('b'), positionKey('a')])
      const { batch, rest } = takeBatch(queue, 2)
      expect(batch).toStrictEqual(['c', 'a'])
      expect([...rest.pending]).toStrictEqual(['b'])
    }),
  )
})

describe('the mirrored DeltaTimeSecs brand is kernel’s', () => {
  /*
   * REGRESSION. `domain/frame-contract.ts` restates kernel's `DeltaTimeSecs`
   * (`mc-kernel/domain/quantities.ts:37-42`), and a brand is keyed by its
   * STRING: `Brand.Brand<'DeltaTimeSecs'>` here and in kernel are ONE TYPE to
   * TypeScript, however differently the two constructors validate. So a mirror
   * that refined differently would be a false guarantee the compiler could
   * never contradict — which is exactly what mc-physics had, refining to the
   * frame-loop clamp [0.001, 0.05] while kernel refines to "finite and
   * non-negative". A kernel-built `DeltaTimeSecs(30)` satisfied its parameter
   * types while breaking the invariant its comments claimed.
   *
   * Kernel's is the agreed refinement and it is deliberately LOOSE: a zero
   * delta is legal, because a frame may be scheduled twice inside one clock
   * tick, and the clamp of plan.md §3.4 is a frame-loop concern applied at the
   * boundary by whoever PRODUCES the delta — mc-sim's `frame-timing.ts`,
   * mc-physics' `clampDeltaTime` — never a property of the quantity itself.
   * A stage receives whatever the loop produced and must cope.
   */
  it.effect('accepts zero and any finite non-negative delta, and rejects nothing else', () =>
    Effect.sync(() => {
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(0.0001)).toBe(0.0001)
      // Out of the integrator's safe range, and still a valid quantity: this is
      // what a tab that was backgrounded for thirty seconds produces.
      expect(DeltaTimeSecs(30)).toBe(30)

      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )
})

describe('the mirrored StackCount brand is kernel’s too', () => {
  /*
   * The same regression shape as `DeltaTimeSecs` above, one module over and one
   * commit later. `StackCount` arrived in `domain/frame-contract.ts` with
   * the inventory integration, which needs it for mc-sim's `ItemStack`, and it
   * is in THAT file because `mc-kernel/domain/quantities.ts` is one of the
   * three kernel modules it already mirrors — the file's header argues the
   * placement and names the alternative it rejected.
   *
   * A brand is keyed by its string, so a mirror that refined `[1, 64]` instead
   * of `[0, 64]` would reject the empty stack kernel accepts, in a repository
   * where every value it touches came from mc-sim and is therefore already
   * believed to be valid. That is the mc-physics defect exactly.
   *
   * The bounds are NOT symmetrical and both ends matter: 0 is legal because
   * `removeItem` writes the count left in a slot before deciding whether the
   * slot is empty, and 64 is `MAX_STACK_COUNT` — the cap that makes an
   * inventory able to be FULL, which is what makes `add`'s leftover reachable
   * at all (`test/inventory-mirror.test.ts`).
   */
  it.effect('accepts integers in [0, MAX_STACK_COUNT] and nothing else', () =>
    Effect.sync(() => {
      expect(MAX_STACK_COUNT).toBe(64)
      expect(StackCount(0)).toBe(0)
      expect(StackCount(1)).toBe(1)
      expect(StackCount(MAX_STACK_COUNT)).toBe(64)

      expect(() => StackCount(65)).toThrow()
      expect(() => StackCount(-1)).toThrow()
      // An integer, not a quantity: half a block is not a thing a slot holds.
      expect(() => StackCount(2.5)).toThrow()
      expect(() => StackCount(Number.NaN)).toThrow()
      expect(() => StackCount(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )
})


describe('the module contract has caught up with this file’s shape', () => {
  /*
   * REGRESSION — the change the vertical-slice spike forced on mc-kernel.
   *
   * `stages/registration.ts` used to carry a comment saying it was "NOT yet a
   * `GameModule`" because the service set could not be named until mc-sim
   * published. That diagnosis was half wrong, and the wrong half is what the
   * spike found: mx-gameplay publishes no service for another repository to call — a rule is not a
 * service (plan.md §2.3-1) — so its Layer is empty and always was.
   *
   * The real obstacle was that `GameModule.frameStages` was an ARRAY. These
   * stages are built from `Ref`s allocated in an Effect, so there was no way to
   * put them in a field typed `ReadonlyArray` — and, worse, an array gave NO
   * module anywhere a context in which to acquire a service in order to build a
   * stage, which forced every service any stage touched into `FrameServices`
   * and would have made kernel name mc-sim's and mc-render's services.
   *
   * kernel's `frameStages` is now an Effect. This test is what says the
   * repository actually took the shape, rather than the comment merely changing.
   */
  it.effect('REGRESSION: exports a real GameModule, not "stages alone, the Layer comes later"', () =>
    Effect.gen(function* () {
      const module: GameModule<
        never,
        never,
        never,
        ChunkStore | EntityManager | InventoryService | PlayerService | TimeService
      > = gameplayModule
      const stages = yield* Effect.provide(module.frameStages, emptyWorld)

      expect(stageIds(stages)).toStrictEqual(Object.values(GAMEPLAY_STAGE_IDS))
    }),
  )

  it.effect('its frameStages IS the registration Effect this file already exported', () =>
    Effect.gen(function* () {
      expect(gameplayModule.frameStages).toBe(makeGameplayStages)

      // ...and it is re-entrant: two builds share no state, which is why it was
      // an Effect in the first place (plan.md §3.8 on app-scope singletons).
      const first = yield* registeredStages
      const second = yield* registeredStages
      expect(first).not.toBe(second)
    }),
  )

  // This has now read TWO, then THREE, then FOUR, and reads FIVE. Each step discharged a
  // prediction the previous comment had written down by name, which is why the
  // history is kept rather than overwritten:
  //
  //   TWO   -> THREE: 「The candidate for the third is mc-sim's
  //          `InventoryService`, and until it can be mirrored whole the mob
  //          drops go to an outbox instead」. Integrated whole from mc-sim; the
  //          stage deposits through it.
  //   THREE -> FOUR:  「The candidate for the fourth is mc-sim's
  //          `PlayerService`, and it cannot be mirrored whole … `cameraPose`
  //          requires `ClockPort`, and restating `ClockPort` locally is 『a far
  //          worse failure than a narrower type』」.
  //   FOUR  -> FIVE:  `TimeService` became the authoritative clock so gameplay
  //          consumes the time advanced by mc-sim earlier in the same frame.
  //
  // THAT SECOND PREDICTION WAS RIGHT ABOUT THE CANDIDATE AND WRONG ABOUT THE
  // OBSTACLE. `domain/frame-contract.ts` carries `ClockPort` in the kernel
  // mirror where kernel's barrel replaces it, so `cameraPose` is transcribed
  // whole WITH its requirement and nothing was narrowed. What actually blocked
  // the fourth service was a noun with no owner — `Dimension` — and mc-worldgen
  // taking the word is what let `stepPortalTravel` call `PlayerService` every
  // frame.
  //
  // `RIn` is still `never` and that is the distinction `RRegister` exists for.
  // This repository BUILDS nothing another repository has to supply; it CALLS
  // what mc-worldgen and mc-sim supply. Any registration service leaking into `RIn`
  // would be mx-gameplay claiming to construct part of somebody else's
  // repository.
  it.effect('acquires exactly five services to register and exposes eight stages', () =>
    Effect.gen(function* () {
      const registration: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        ChunkStore | EntityManager | InventoryService | PlayerService | TimeService
      > = gameplayModule.frameStages

      // Providing those five — and nothing else — discharges the whole context.
      // If a stage started demanding a SIXTH service at REGISTRATION time, this
      // assignment would stop compiling, which is the point. There is no named
      // candidate for a sixth today, and inventing one here would be the
      // speculation this file's history is a record of NOT doing.
      const satisfied: Effect.Effect<ReadonlyArray<StageRegistration>, never, never> =
        Effect.provide(registration, emptyWorld)

      expect(yield* satisfied).toHaveLength(8)
    }),
  )

  // REGRESSION-SHAPED, and it is the property mc-sim's §7-1 buys with
  // `Context.GenericTag`: `EntityManager` appears ONCE in the requirement,
  // without a parameter, however the behaviour type is instantiated. If mc-sim
  // had used a Tag class per behaviour, this union would have grown a member per
  // consumer and mc-compose would have had to name mx-gameplay's `MobBehaviour`.
  it.effect('the roster requirement carries no behaviour parameter', () =>
    Effect.sync(() => {
      const unparameterised: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        ChunkStore | EntityManager | InventoryService | PlayerService | TimeService
      > = makeGameplayStages

      expect(typeof unparameterised).toBe('object')
    }),
  )

  // The `run` side must stay free of it. `StageRegistration.run` is typed by
  // kernel's `FrameServices`, and a stage that demanded `ChunkStore` there
  // would be asking kernel to name mc-worldgen's services — which the tier
  // model (plan.md §2.2) forbids, and which no amount of local testing would
  // reveal until mc-compose tried to build a frame.
  //
  // The annotation below says `FrameServices` and NOT `never`, and the
  // difference is the whole assertion. `never` says 「`run` demands nothing」,
  // which is true only by the accident that this repository's mirror aliases
  // `FrameServices` to `never` while kernel aliases it to `ClockPort`. What
  // this test means — and what the paragraph above claims — is 「`run` demands
  // nothing BEYOND the frame contract」, and `FrameServices` is how that
  // sentence is spelled. It is the same assertion today, because the alias is
  // `never` today; it is still the right assertion after the repoint, when a
  // stage that reached for `ChunkStore` would fail this line exactly as it
  // would have before.
  it.effect('REGRESSION: the store is acquired at registration, never demanded by `run`', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages

      for (const stage of stages) {
        const runnable: Effect.Effect<void, never, FrameServices> = stage.run(DeltaTimeSecs(0.016))
        yield* runnable
      }
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('routes status effect pulses and speed through host-facing frame contracts', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestStatusEffect(state, { type: 'poison', durationSecs: 1 })
      yield* requestStatusEffect(state, { type: 'regeneration', durationSecs: 2.5 })
      yield* requestStatusEffect(state, { type: 'speed', durationSecs: 2 })
      yield* interactions.run(DeltaTimeSecs(1)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainPlayerDamages(state)).toStrictEqual([
        {
          _tag: 'StatusEffect',
          effect: 'poison',
          damage: { amount: 1, cause: 'poison' },
          minimumHealthPoints: 1,
        },
      ])
      expect(yield* drainPlayerHeals(state)).toStrictEqual([])
      expect(yield* getPlayerMovementSpeedMultiplier(state)).toBe(1.2)

      yield* interactions.run(DeltaTimeSecs(1.5)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* drainPlayerHeals(state)).toStrictEqual([
        {
          _tag: 'StatusEffect',
          effect: 'regeneration',
          amount: 1,
          maximumHealthPoints: 20,
        },
      ])
      expect(yield* getPlayerMovementSpeedMultiplier(state)).toBe(1)
    }),
  )

  it.effect('useBrewingPotion on an empty stand requests no status effect', () =>
    Effect.gen(function* () {
      // Every other `useBrewingPotion` call in this file drinks a real potion,
      // so its `result._tag === 'Consumed'` guard had only ever taken that
      // branch. A freshly-built state's brewing stand is empty.
      const state = yield* makeGameplayFrameState

      expect(yield* useBrewingPotion(state)).toStrictEqual({ _tag: 'Rejected', reason: 'Empty' })
      expect(yield* drainPlayerHeals(state)).toStrictEqual([])
      expect(yield* getPlayerMovementSpeedMultiplier(state)).toBe(1)
    }),
  )

  it.effect('snapshots and restores status effects without retaining host references', () =>
    Effect.gen(function* () {
      const source = yield* makeGameplayFrameState
      yield* restoreStatusEffects(source, {
        effects: [{ type: 'speed', remainingSecs: 4, pulseClockSecs: 0 }],
      })
      const snapshot = yield* snapshotStatusEffects(source)
      const restored = yield* makeGameplayFrameState
      yield* restoreStatusEffects(restored, snapshot)

      expect(yield* snapshotStatusEffects(restored)).toStrictEqual(snapshot)
      expect(yield* getPlayerMovementSpeedMultiplier(restored)).toBe(1.2)
      expect((yield* snapshotStatusEffects(restored)).effects).not.toBe(snapshot.effects)
    }),
  )

  it.effect('brews and uses a speed potion through the existing status-effect pipeline', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      expect(yield* insertBrewingBottle(state, 'water_bottle')).toMatchObject({ _tag: 'Accepted' })
      expect(yield* insertBrewingFuel(state)).toMatchObject({ _tag: 'Accepted' })
      expect(yield* insertBrewingIngredient(state, 'nether_wart')).toMatchObject({
        _tag: 'Accepted',
      })
      yield* interactions.run(DeltaTimeSecs(20)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* insertBrewingFuel(state)).toMatchObject({ _tag: 'Accepted' })
      expect(yield* insertBrewingIngredient(state, 'sugar')).toMatchObject({ _tag: 'Accepted' })
      yield* interactions.run(DeltaTimeSecs(20)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* useBrewingPotion(state)).toStrictEqual({
        _tag: 'Consumed',
        consumed: { item: 'potion_of_swiftness', count: 1 },
        effect: { type: 'speed', durationSecs: 180 },
      })
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* getPlayerMovementSpeedMultiplier(state)).toBe(1.2)
      expect(yield* collectBrewingPotion(state)).toStrictEqual({
        _tag: 'Rejected',
        reason: 'Empty',
      })
    }),
  )

  it.effect('snapshots and restores an in-progress brew without retaining host references', () =>
    Effect.gen(function* () {
      const source = yield* makeGameplayFrameState
      yield* restoreBrewingStand(source, {
        fuelUnits: 0,
        bottle: { potion: 'awkward' },
        ingredient: undefined,
        brewing: { output: 'speed', remainingSecs: 7 },
      })
      const snapshot = yield* snapshotBrewingStand(source)
      const restored = yield* makeGameplayFrameState
      yield* restoreBrewingStand(restored, snapshot)
      const restoredSnapshot = yield* snapshotBrewingStand(restored)

      expect(restoredSnapshot).toStrictEqual(snapshot)
      expect(restoredSnapshot.brewing).not.toBe(snapshot.brewing)
    }),
  )
})

// ---------------------------------------------------------------------------
// The regions below close the coverage gap this file's header does not yet
// name: each `describe` documents one behaviour that was reachable but
// untested, not a new requirement.
// ---------------------------------------------------------------------------

describe('FluidStateRef is a real Ref.Ref, including the Effect protocol it inherits', () => {
  it.effect('yielding the frontier ref directly (not through Ref.get) reads the same value', () =>
    Effect.gen(function* () {
      const { state } = yield* builtStages
      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])

      // `Ref.Ref<A>` extends `Effect.Effect<A>`, so a caller holding the ref may
      // `yield*` it directly instead of going through `Ref.get`. That path
      // dispatches through `Effectable.Class`'s `commit()`, which `Ref.get`
      // itself never touches (`Ref.get = self => self.get`). Both must answer
      // the same question.
      const direct = yield* state.fluidFrontier
      const throughRefGet = yield* Ref.get(state.fluidFrontier)
      expect(direct).toStrictEqual(throughRefGet)
    }),
  )
})

describe('frame-state refs not produced by makeGameplayFrameState fail loudly', () => {
  it.effect('snapshotting fire lifecycle through a foreign ref dies with a named invariant message', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      // A structurally-valid GameplayFrameState whose `fireLifecycle` was never
      // registered by the factory's WeakMap — the shape a hand-rolled state
      // object (or a copy that swapped one field) would have.
      const foreign: GameplayFrameState = {
        ...state,
        fireLifecycle: Ref.unsafeMake(makeFireLifecycleState([], 0)),
      }

      const exit = yield* Effect.exit(snapshotFireLifecycle(foreign))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect((Cause.squash(exit.cause) as Error).message).toBe(
          'fire lifecycle is not owned by a gameplay frame state',
        )
      }
    }),
  )

  it.effect('running the fluids stage over a foreign fluid-frontier ref dies with a named invariant message', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const foreign: GameplayFrameState = {
        ...state,
        fluidFrontier: Ref.unsafeMake<ReadonlyArray<FluidWorkItem>>([]),
      }
      const stages = gameplayStages(foreign, store.api, roster.api, inventory.api, player.api, time)
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      // `fluids.run(dt)` throws SYNCHRONOUSLY, while the closure is still being
      // evaluated to produce an Effect value — before `Effect.exit` has anything
      // to wrap. `Effect.suspend` defers that call until it is itself running
      // inside the Effect runtime, which is what lets the throw land as a
      // defect rather than escape as a raw exception.
      const exit = yield* Effect.exit(Effect.suspend(() => fluids.run(DeltaTimeSecs(0.016))))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect((Cause.squash(exit.cause) as Error).message).toBe(
          'fluid frontier is not owned by a gameplay frame state',
        )
      }
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('a structurally-copied frame state gets its own lazily-created break-request queue', () =>
    Effect.gen(function* () {
      const original = yield* makeGameplayFrameState
      // `{ ...state }` is a NEW object identity holding the SAME Refs. The
      // WeakMap that backs `pendingBlockBreakRequests` is keyed on object
      // identity and only the factory's own `original` was registered, so this
      // copy is exactly the 「structurally-created frame state」 the source
      // comment names as the reason the lazy-create branch exists at all.
      const copy: GameplayFrameState = { ...original }
      const store = yield* makeChunkStoreDouble(world([[{ x: 0, y: 64, z: 0 }, STONE]]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const stages = gameplayStages(copy, store.api, roster.api, inventory.api, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* Ref.set(copy.pendingBreaks, [positionKey('0,64,0')])
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* store.blockAt({ x: 0, y: 64, z: 0 })).toBe(AIR_BLOCK_ID)
    }),
  )
})

describe('fluid propagation defers when a write finds its chunk unloaded', () => {
  const AIR = AIR_BLOCK_ID

  it.effect('a blocked horizontal PlaceFluid write is deferred without touching the world', () =>
    Effect.gen(function* () {
      const origin = { x: 0, y: 64, z: 0 }
      const blocked = { x: 1, y: 64, z: 0 }
      const { state, store } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [{ x: 0, y: 63, z: 0 }, STONE],
        ]),
        ['0,0', '-1,0', '0,-1'],
      )
      const blockedStore: ChunkStoreApi = {
        ...store.api,
        setBlock: (position, block) =>
          blockKey(position) === blockKey(blocked) && block === WATER
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
            : store.api.setBlock(position, block),
      }
      const rewiredStages = gameplayStages(
        state,
        blockedStore,
        (yield* makeEntityManagerDouble<MobBehaviour>()).api,
        (yield* makeInventoryDouble()).api,
        (yield* makePlayerServiceDouble()).api,
        yield* makeTimeService(),
      )
      const fluids = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      // The blocked neighbour never got written...
      expect(yield* store.blockAt(blocked)).toBeUndefined()
      // ...while an unblocked one did, proving only the intercepted write failed.
      expect(yield* store.blockAt({ x: -1, y: 64, z: 0 })).toBe(WATER)
      // ...and the source cell was requeued rather than dropped.
      const source = (yield* Ref.get(state.fluidFrontier)).find(
        (item) => item.key === positionKey('0,64,0'),
      )
      expect(source?.deferred).toBe(1)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('a blocked RemoveFluid write leaves the stale flowing cell in place and retries it', () =>
    Effect.gen(function* () {
      const origin = { x: 0, y: 64, z: 0 }
      const stubborn = { x: -1, y: 64, z: 0 }
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [{ x: 0, y: 63, z: 0 }, STONE],
        ]),
        ['0,0', '-1,0', '0,-1'],
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      // Phase 1: spread water to the four horizontal neighbours, `stubborn`
      // among them.
      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))
      expect(yield* store.blockAt(stubborn)).toBe(WATER)

      // Phase 2: the source is gone. Re-evaluating it forgets it and enqueues
      // its dependents (this tick), which are then processed on the next.
      yield* store.api.setBlock(origin, AIR)
      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      // Phase 3: `stubborn`'s removal write is intercepted; the other three
      // neighbours are not.
      const blockedStore: ChunkStoreApi = {
        ...store.api,
        setBlock: (position, block) =>
          blockKey(position) === blockKey(stubborn) && block === AIR
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
            : store.api.setBlock(position, block),
      }
      const rewiredStages = gameplayStages(
        state,
        blockedStore,
        (yield* makeEntityManagerDouble<MobBehaviour>()).api,
        (yield* makeInventoryDouble()).api,
        (yield* makePlayerServiceDouble()).api,
        yield* makeTimeService(),
      )
      const rewiredFluids = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!
      yield* rewiredFluids.run(DeltaTimeSecs(0.016))

      // The blocked cell is still water and still tracked for retry...
      expect(yield* store.blockAt(stubborn)).toBe(WATER)
      const retried = (yield* Ref.get(state.fluidFrontier)).find(
        (item) => item.key === positionKey('-1,64,0'),
      )
      expect(retried?.deferred).toBe(1)
      // ...while an unblocked sibling was actually retracted to air.
      expect(yield* store.blockAt({ x: 1, y: 64, z: 0 })).toBe(AIR)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('a blocked Solidify write at a lava contact leaves the lava in place and retries the source', () =>
    Effect.gen(function* () {
      const lava = blockIdOf('lava')!
      const contact = { x: 1, y: 64, z: 0 }
      const { state, store } = yield* builtStagesInWorld(
        world([
          [{ x: 0, y: 64, z: 0 }, WATER],
          [{ x: 0, y: 63, z: 0 }, STONE],
          [contact, lava],
        ]),
      )
      const blockedStore: ChunkStoreApi = {
        ...store.api,
        setBlock: (position, block) =>
          blockKey(position) === blockKey(contact) && block === OBSIDIAN
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
            : store.api.setBlock(position, block),
      }
      const rewiredStages = gameplayStages(
        state,
        blockedStore,
        (yield* makeEntityManagerDouble<MobBehaviour>()).api,
        (yield* makeInventoryDouble()).api,
        (yield* makePlayerServiceDouble()).api,
        yield* makeTimeService(),
      )
      const fluids = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect(yield* store.blockAt(contact)).toBe(lava)
      const source = (yield* Ref.get(state.fluidFrontier)).find(
        (item) => item.key === positionKey('0,64,0'),
      )
      expect(source?.deferred).toBe(1)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})

describe('isHoeItem', () => {
  it('is true for every HOE_ITEM_TYPES member and false for a non-hoe item', () => {
    expect(isHoeItem('wooden_hoe')).toBe(true)
    expect(isHoeItem('stone_hoe')).toBe(true)
    expect(isHoeItem('iron_hoe')).toBe(true)
    expect(isHoeItem('diamond_hoe')).toBe(true)
    expect(isHoeItem('diamond_pickaxe')).toBe(false)
  })
})

describe('requestBoneMeal enqueues a farming item use directly', () => {
  it.effect('queues an ApplyBoneMeal request at the given position', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      yield* requestBoneMeal(state, 'bone-meal-1', { x: 3, y: 64, z: 3 })

      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([
        {
          action: 'ApplyBoneMeal',
          requestId: 'bone-meal-1',
          positionKey: positionKey('3,64,3'),
          heldItem: 'bone_meal',
        },
      ])
    }),
  )
})

describe('weather gameplay input and events', () => {
  const RAIN: WeatherState = { weather: 'rain', remainingSecs: 100 }

  it.effect('submitWeatherGameplayInput replaces the host-observed exposure snapshot', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const input = {
        dimension: 'overworld' as const,
        difficulty: 'normal' as const,
        blocks: [],
        entities: [],
      }
      yield* submitWeatherGameplayInput(state, input)
      expect(yield* Ref.get(state.weatherGameplayInput)).toStrictEqual(input)
    }),
  )

  it.effect('an exposed fire block under active weather emits FireExtinguished through the time-weather stage', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const timeWeather = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.timeWeather)!
      yield* Ref.set(state.weather, RAIN)
      yield* submitWeatherGameplayInput(state, {
        dimension: 'overworld',
        difficulty: 'normal',
        blocks: [{ position: positionKey('0,64,0'), block: 'fire', exposedToSky: true }],
        entities: [],
      })

      yield* timeWeather.run(DeltaTimeSecs(0.016)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainWeatherGameplayEvents(state)).toStrictEqual([
        { _tag: 'FireExtinguished', position: positionKey('0,64,0') },
      ])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})

describe('the targeted-block family resolves through the same raycast as placement and use', () => {
  const AIMED_AT: BlockPosition = { x: 0, y: 1, z: 0 }
  const AIMED_ADJACENT: BlockPosition = { x: 0, y: 1, z: 1 }
  const AIMING_POSE: PlayerPose = {
    feetPosition: { x: 0.5, y: 0, z: 2.5 },
    yawRadians: 0,
    pitchRadians: 0,
  }

  const aimingAt = (block: BlockId) =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([[AIMED_AT, block]]), ['0,0'])
      const player = yield* makePlayerServiceDouble(AIMING_POSE)
      return { state, store, player }
    })

  it.effect('resolveTargetedBlock finds the block under the crosshair', () =>
    Effect.gen(function* () {
      const { store, player } = yield* aimingAt(STONE)
      const target = yield* resolveTargetedBlock(store.api, player.api)
      expect(Option.getOrUndefined(target)?.position).toStrictEqual(AIMED_AT)
    }),
  )

  it.effect('resolveTargetedBlock is None when nothing is within reach', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const player = yield* makePlayerServiceDouble()
      void state
      const target = yield* resolveTargetedBlock(store.api, player.api)
      expect(Option.isNone(target)).toBe(true)
    }),
  )

  it.effect('the Targeted* request family enqueues nothing when nothing is within reach', () =>
    Effect.gen(function* () {
      // Every other test in this describe block aims at a real block, so each
      // Targeted* wrapper's `if (Option.isSome(target))` guard had only ever
      // seen `Some`. An empty, loaded world and the default spawn pose (the
      // same setup `resolveTargetedBlock is None...` above uses) reaches None
      // for all five wrappers at once.
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const player = yield* makePlayerServiceDouble()

      const placement = yield* requestTargetedBlockPlacement(state, store.api, player.api, 'sand')
      expect(Option.isNone(placement)).toBe(true)
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])

      const itemUse = yield* requestTargetedItemUse(state, store.api, player.api, 'miss-ignite', 'fire_charge')
      expect(Option.isNone(itemUse)).toBe(true)

      yield* requestTargetedSoilTill(state, store.api, player.api, 'miss-till', 'iron_hoe')
      yield* requestTargetedPotatoPlanting(state, store.api, player.api, 'miss-plant')
      yield* requestTargetedBoneMeal(state, store.api, player.api, 'miss-bonemeal')

      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
    }),
  )

  it.effect('requestTargetedItemUse enqueues an ignition use against the adjacent cell', () =>
    Effect.gen(function* () {
      const { state, store, player } = yield* aimingAt(STONE)
      const target = yield* requestTargetedItemUse(state, store.api, player.api, 'ignite-1', 'fire_charge')
      expect(Option.getOrUndefined(target)?.adjacentPosition).toStrictEqual(AIMED_ADJACENT)
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([
        {
          requestId: 'ignite-1',
          positionKey: positionKey('0,1,1'),
          heldItem: 'fire_charge',
        },
      ])
    }),
  )

  it.effect('requestTargetedSoilTill enqueues a hoe use against the targeted cell itself', () =>
    Effect.gen(function* () {
      const { state, store, player } = yield* aimingAt(STONE)
      yield* requestTargetedSoilTill(state, store.api, player.api, 'till-1', 'iron_hoe')
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([
        {
          action: 'TillSoil',
          requestId: 'till-1',
          positionKey: positionKey('0,1,0'),
          heldItem: 'iron_hoe',
        },
      ])
    }),
  )

  it.effect('requestTargetedPotatoPlanting enqueues planting against the targeted cell', () =>
    Effect.gen(function* () {
      const { state, store, player } = yield* aimingAt(STONE)
      yield* requestTargetedPotatoPlanting(state, store.api, player.api, 'plant-1')
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([
        {
          action: 'PlantPotato',
          requestId: 'plant-1',
          positionKey: positionKey('0,1,0'),
          heldItem: 'potato',
        },
      ])
    }),
  )

  it.effect('requestTargetedBoneMeal enqueues bone meal against the targeted cell', () =>
    Effect.gen(function* () {
      const { state, store, player } = yield* aimingAt(STONE)
      yield* requestTargetedBoneMeal(state, store.api, player.api, 'bonemeal-1')
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([
        {
          action: 'ApplyBoneMeal',
          requestId: 'bonemeal-1',
          positionKey: positionKey('0,1,0'),
          heldItem: 'bone_meal',
        },
      ])
    }),
  )

  it.effect('requestTargetedBlockUse resolves to None and enqueues nothing when nothing is aimed at', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const player = yield* makePlayerServiceDouble()

      const target = yield* requestTargetedBlockUse(state, store.api, player.api, 'nothing', 'redstone_dust')

      expect(Option.isNone(target)).toBe(true)
      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([])
    }),
  )

  const secondReadOf = (store: ChunkStoreApi, position: BlockPosition, outcome: BlockReading): ChunkStoreApi => {
    const seen = new Set<string>()
    return {
      ...store,
      getBlock: (candidate) => {
        const key = blockKey(candidate)
        if (blockKey(position) === key && seen.has(key)) return Effect.succeed(outcome)
        seen.add(key)
        return store.getBlock(candidate)
      },
    }
  }

  it.effect('requestTargetedBlockUse takes no action when the target chunk unloaded between aim and use', () =>
    Effect.gen(function* () {
      const { state, store, player } = yield* aimingAt(STONE)
      const racy = secondReadOf(store.api, AIMED_AT, { _tag: 'ChunkNotLoaded' })

      const target = yield* requestTargetedBlockUse(state, racy, player.api, 'raced-use', 'redstone_dust')

      expect(Option.getOrUndefined(target)?.position).toStrictEqual(AIMED_AT)
      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([])
    }),
  )

  it.effect('requestTargetedBlockUse takes no action when the target reads out of world between aim and use', () =>
    Effect.gen(function* () {
      const { state, store, player } = yield* aimingAt(STONE)
      const racy = secondReadOf(store.api, AIMED_AT, { _tag: 'OutOfWorld' })

      const target = yield* requestTargetedBlockUse(state, racy, player.api, 'raced-use-2', 'redstone_dust')

      expect(Option.getOrUndefined(target)?.position).toStrictEqual(AIMED_AT)
      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([])
    }),
  )
})

describe('fire lifecycle: extinguish, restore, and burning-actor bookkeeping', () => {
  const FIRE = blockIdOf('fire') ?? 119

  it.effect('requestFireExtinguish is a no-op when nothing is burning at the position', () =>
    Effect.gen(function* () {
      const { state, store } = yield* builtStages
      expect(yield* requestFireExtinguish(state, store.api, { x: 9, y: 64, z: 9 })).toBe(false)
    }),
  )

  it.effect('requestFireExtinguish extinguishes a real fire and disturbs the cell', () =>
    Effect.gen(function* () {
      const { state, store } = yield* builtStages
      const position = { x: 4, y: 64, z: 4 }
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 3))

      expect(yield* requestFireExtinguish(state, store.api, position)).toBe(true)
      expect(yield* store.blockAt(position)).toBe(AIR_BLOCK_ID)
      expect((yield* Ref.get(state.fireLifecycle)).fires).toStrictEqual([])
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(1)
    }),
  )

  it.effect('requestFireExtinguish clears stale tracking without disturbing falling blocks when the world was already air', () =>
    Effect.gen(function* () {
      // The only other extinguish test writes `FIRE` first, so `setBlock`
      // there always returns `'Written'` — its `'Unchanged'` sibling (the
      // fireLifecycle Ref tracks a position the world already reads as air)
      // had never fired.
      const { state, store } = yield* builtStages
      const position = { x: 5, y: 64, z: 5 }
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 3))

      expect(yield* requestFireExtinguish(state, store.api, position)).toBe(true)
      // Sparse storage: a cell nobody ever wrote reads `undefined`, the same
      // "air" answer as an explicit `AIR_BLOCK_ID` write — see "writing air
      // deletes the cell rather than storing it" in
      // test/in-memory-chunk-store.test.ts.
      expect(yield* store.blockAt(position)).toBeUndefined()
      expect((yield* Ref.get(state.fireLifecycle)).fires).toStrictEqual([])
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)
    }),
  )

  it.effect('restoreFireLifecycle dies on a snapshot that fails validation', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const invalid = { version: 999 } as unknown as FireLifecycleSnapshot

      const exit = yield* Effect.exit(restoreFireLifecycle(state, invalid))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect((Cause.squash(exit.cause) as Error).message).toBe('Unsupported fire lifecycle snapshot')
      }
    }),
  )

  it.effect('a fire-killed actor with no XP reward or drop table yields neither', () =>
    Effect.gen(function* () {
      // Every other fire-casualty path in this file leaves the entity alive,
      // so `drops.length > 0` (fed by `rollCasualtyDrops` over fire deaths,
      // not weapon kills) had never fired. `skeleton` has no entry in
      // `xpRewardOfKind` / `dropRulesOfKind` (see the melee equivalent above),
      // so a fire death yields empty drops the same way a fire death yields
      // no mob-frame test's `MobDropRule` output.
      const { state, store, roster, stages } = yield* builtStages
      const position = { x: 7, y: 64, z: 7 }
      yield* store.api.setBlock({ ...position, y: position.y - 1 }, STONE)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 23))
      yield* roster.api.spawn({
        kind: EntityKind('skeleton'),
        feetPosition: position,
        healthPoints: 1,
        behaviour: undefined,
      })

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      for (let tick = 0; tick <= FIRE_DAMAGE_INTERVAL_TICKS; tick += 1) {
        yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
      }

      expect((yield* roster.api.snapshot).entities).toStrictEqual([])
      expect(yield* drainMobExperience(state)).toStrictEqual([])
      expect(yield* drainMobDrops(state)).toStrictEqual([])
    }),
  )

  it.effect('a despawned burning actor is reported not-alive from its last known position', () =>
    Effect.gen(function* () {
      const { state, store, roster, stages } = yield* builtStages
      const position = { x: 6, y: 64, z: 6 }
      yield* store.api.setBlock({ ...position, y: position.y - 1 }, STONE)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 19))
      const target = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: position,
        healthPoints: 100,
        behaviour: undefined,
      })

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      // Tick 1: the entity is in the fire and becomes a burning actor.
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
      expect((yield* Ref.get(state.fireLifecycle)).burningActors?.length).toBeGreaterThan(0)

      // The roster forgets it without going through the fire-casualty path.
      yield* roster.api.despawn(target.id)

      // Tick 2: the id is still remembered as burning, but the roster no
      // longer has it — the `entity === undefined` bookkeeping branch.
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      // Nothing crashed, and the vanished actor was dropped rather than kept
      // forever as a phantom burning entity at a stale position.
      expect(
        (yield* Ref.get(state.fireLifecycle)).burningActors?.some((actor) => actor.id === String(target.id)),
      ).toBe(false)
    }),
  )

  it.effect('classifies a fire-spread neighbour in an unloaded chunk as unavailable rather than air', () =>
    Effect.gen(function* () {
      // Every other fire test reads only loaded cells, so the block
      // classification ternary's `reading._tag === 'ChunkNotLoaded'` arm had
      // never fired. A fire at the x=15 edge of the only loaded chunk has an
      // x+1 snapshot neighbour in chunk `1,0`, which is not loaded.
      const firePosition = { x: 15, y: 64, z: 0 }
      const { state, stages } = yield* builtStagesInWorld(
        world([[firePosition, FIRE], [{ x: 15, y: 63, z: 0 }, STONE]]),
        ['0,0'],
      )
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([firePosition], 19))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      // Nothing crashed reading past the loaded edge; the fire itself is
      // unaffected by its own unloaded neighbour.
      const fires = (yield* Ref.get(state.fireLifecycle)).fires
      expect(fires).toHaveLength(1)
      expect(fires[0]?.position).toStrictEqual(firePosition)
    }),
  )

  it.effect('classifies an unregistered block id near a fire as unknown rather than crashing', () =>
    Effect.gen(function* () {
      // `blockTypeOfId` is documented PARTIAL over `BlockType`
      // (`domain/block-vocabulary.ts`) — a mirror carries no gate proving
      // every id a save or a corrupted chunk could hold is registered. Every
      // other fire test only ever reads registered blocks, so the
      // `blockTypeOfId(reading.block) ?? '__unknown_fire_block__'` fallback
      // had never fired.
      const firePosition = { x: 8, y: 64, z: 8 }
      const UNREGISTERED_BLOCK_ID = 999_999 as BlockId
      const { state, stages } = yield* builtStagesInWorld(
        world([
          [firePosition, FIRE],
          [{ x: 8, y: 63, z: 8 }, STONE],
          [{ x: 9, y: 64, z: 8 }, UNREGISTERED_BLOCK_ID],
        ]),
        ['0,0'],
      )
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([firePosition], 29))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      // Nothing crashed reading the unregistered neighbour; the fire itself
      // is unaffected by it.
      const fires = (yield* Ref.get(state.fireLifecycle)).fires
      expect(fires).toHaveLength(1)
      expect(fires[0]?.position).toStrictEqual(firePosition)
    }),
  )

  it.effect('sorts burning-actor and new-entity fire contacts deterministically with two or more of each', () =>
    Effect.gen(function* () {
      // Every other fire-contact test has at most one burning actor and at
      // most one non-burning entity at a time, so both `.sort(...)` comparator
      // callbacks that order `burningEntityContacts` and `newEntityContacts`
      // had never actually been invoked — `Array.prototype.sort` never calls
      // its comparator for an array of 0 or 1 elements.
      const { state, store, roster, stages } = yield* builtStages
      const firePosition = { x: 6, y: 64, z: 6 }
      yield* store.api.setBlock({ ...firePosition, y: firePosition.y - 1 }, STONE)
      yield* store.api.setBlock(firePosition, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([firePosition], 19))

      const burningA = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: firePosition,
        healthPoints: 100,
        behaviour: undefined,
      })
      const burningB = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: firePosition,
        healthPoints: 100,
        behaviour: undefined,
      })
      const safeA = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: 20, y: 64, z: 20 },
        healthPoints: 100,
        behaviour: undefined,
      })
      const safeB = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: 21, y: 64, z: 21 },
        healthPoints: 100,
        behaviour: undefined,
      })

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      // Tick 1: both entities standing in the fire catch it.
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
      expect((yield* Ref.get(state.fireLifecycle)).burningActors?.length).toBe(2)

      // Tick 2: `current.burningActors` now holds both from tick 1, so this
      // run's `burningEntityContacts` sorts two ids, and its `newEntityContacts`
      // sorts the two entities that never caught fire.
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      const burning = (yield* Ref.get(state.fireLifecycle)).burningActors ?? []
      expect(burning.map((actor) => actor.id).sort()).toStrictEqual(
        [String(burningA.id), String(burningB.id)].sort(),
      )
      // The two safe entities never joined the burning set.
      expect(burning.some((actor) => actor.id === String(safeA.id))).toBe(false)
      expect(burning.some((actor) => actor.id === String(safeB.id))).toBe(false)
    }),
  )

  it.effect('a survivable fire tick damages a burning entity without killing it', () =>
    Effect.gen(function* () {
      const { state, store, roster, stages } = yield* builtStages
      const position = { x: 7, y: 64, z: 7 }
      yield* store.api.setBlock({ ...position, y: position.y - 1 }, STONE)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 23))
      const target = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: position,
        healthPoints: 1000,
        behaviour: undefined,
      })

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      // Several ticks: first ignites, later ticks damage without killing
      // (healthPoints is far above anything a handful of fire ticks can deal).
      for (let tick = 0; tick < 6; tick += 1) {
        yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
      }

      const survivor = (yield* roster.api.snapshot).entities.find((entity) => entity.id === target.id)
      expect(survivor).toBeDefined()
      expect(survivor?.healthPoints).toBeLessThan(1000)
    }),
  )

  it.effect('a fire near the world floor reads its out-of-world neighbour as air and still checks sky exposure under weather', () =>
    Effect.gen(function* () {
      const { state, store, stages } = yield* builtStages
      const position = { x: 8, y: 0, z: 8 }
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 29))
      const rain: WeatherState = { weather: 'rain', remainingSecs: 100 }
      yield* Ref.set(state.weather, rain)

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      // Nothing crashed reading a cell one below the world floor, and the fire
      // is still tracked (this is an assertion that the tick completed).
      expect((yield* Ref.get(state.fireLifecycle)).fires.length).toBeGreaterThanOrEqual(0)
    }),
  )
})

/** Every slot at a full stack of wheat — the only arrangement that leaves no room for a different item. */
const brimmingWheat = (): ReadonlyArray<Slot> =>
  emptySlots().map((): Slot => itemStack('wheat', MAX_STACK_COUNT))

describe('villager trade rejection paths not reached by the vertical slice', () => {
  it.effect('rejects an offerId the villager does not carry', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const villager = makeVillager('unknown-offer-trader', 'farmer')
      yield* Ref.set(state.villagerTrades, addVillager(emptyVillagerTradeState(), villager))

      const request = { requestId: 'bogus', villagerId: villager.id, offerId: 'not-a-real-offer' }
      yield* requestVillagerTrade(state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([
        { ...request, _tag: 'Rejected', reason: 'UnknownOffer' },
      ])
    }),
  )

  it.effect('rejects a trade the player cannot afford', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const villager = makeVillager('poor-player-trader', 'farmer')
      const offer = villager.offers.find((candidate) => candidate.input.item === 'wheat')!
      yield* Ref.set(state.villagerTrades, addVillager(emptyVillagerTradeState(), villager))

      // `builtStages`' inventory is empty, so the wheat this offer needs is not there.
      const request = { requestId: 'broke', villagerId: villager.id, offerId: offer.id }
      yield* requestVillagerTrade(state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([
        { ...request, _tag: 'Rejected', reason: 'InsufficientItems' },
      ])
    }),
  )

  it.effect('rejects a trade whose reward cannot fit before touching the inventory', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      // Every slot is a full stack of wheat: removing the offer's 20 leaves
      // every slot still occupied (one slot drops from 64 to 44), so there is
      // no empty slot and no existing emerald stack for the reward to land in.
      const inventory = yield* makeInventoryDouble(brimmingWheat())
      const time = yield* makeTimeService()
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      const villager = makeVillager('full-inventory-trader', 'farmer')
      const offer = villager.offers.find((candidate) => candidate.input.item === 'wheat')!
      yield* Ref.set(state.villagerTrades, addVillager(emptyVillagerTradeState(), villager))

      const request = { requestId: 'no-room', villagerId: villager.id, offerId: offer.id }
      yield* requestVillagerTrade(state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([
        { ...request, _tag: 'Rejected', reason: 'InventoryFull' },
      ])
      // Nothing was actually removed: the preflight check failed before any
      // real mutation.
      expect(yield* inventory.api.countOf('wheat')).toBe(36 * MAX_STACK_COUNT)
    }),
  )

  it.effect('rolls back and reports the real mismatch when the actual mutation disagrees with the preflight check', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const slots: Array<Slot> = emptySlots().map((slot, index) =>
        index === 0 ? itemStack('wheat', 20) : slot,
      )
      const inventory = yield* makeInventoryDouble(slots)
      // The preflight computation (pure, over a snapshot) says the emerald
      // reward fits — plenty of empty slots remain. The REAL `add` disagrees,
      // simulating a mutation that raced the preflight check. The double's own
      // `restore` permanently refuses (test/support/inventory-service-double.ts
      // says why: it never expected a legitimate caller), but the villager-trade
      // rollback this test is proving IS a legitimate caller, so this wrapper
      // gives it a working `restore` built from the double's own `restoreStorage`.
      const racyInventory: InventoryServiceApi = {
        ...inventory.api,
        add: () => Effect.succeed(1),
        restore: (snapshot) =>
          Effect.gen(function* () {
            const current = yield* inventory.api.storageSnapshot
            yield* inventory.api.restoreStorage({ ...current, inventory: snapshot })
            return 0
          }).pipe(Effect.orDie),
      }
      const time = yield* makeTimeService()
      const stages = gameplayStages(state, store.api, roster.api, racyInventory, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      const villager = makeVillager('racy-trader', 'farmer')
      const offer = villager.offers.find((candidate) => candidate.input.item === 'wheat')!
      yield* Ref.set(state.villagerTrades, addVillager(emptyVillagerTradeState(), villager))

      const request = { requestId: 'raced', villagerId: villager.id, offerId: offer.id }
      yield* requestVillagerTrade(state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([
        { ...request, _tag: 'Rejected', reason: 'InventoryFull' },
      ])
      // The rollback restored what the real (successful) removal took.
      expect(yield* inventory.api.countOf('wheat')).toBe(20)
    }),
  )
})

describe('the ender pearl arm refuses a survival throw with no pearl to spend', () => {
  it.effect('a survival throw with an empty held slot produces no outcome', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const throwRequest: EnderPearlThrowRequest = {
        origin: { x: 0, y: 64, z: 0 },
        dirX: 0,
        dirY: 0,
        dirZ: 1,
        hitDistance: 8,
        inventory: { mode: 'survival', slotIndex: 0 },
      }
      yield* Ref.set(state.pendingPearlThrows, [throwRequest])

      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(state.enderPearlOutcomes)).toStrictEqual([])
    }),
  )
})

describe('flint and steel on TNT spawns a primed entity through the interactions stage', () => {
  it.effect('lighting TNT removes the block and spawns PRIMED_TNT_KIND', () =>
    Effect.gen(function* () {
      const tnt = blockIdOf('tnt')!
      const position = { x: 2, y: 64, z: 2 }
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([[position, tnt]]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* Ref.update(state.pendingItemUses, (pending) => [
        ...pending,
        { requestId: 'light-tnt', positionKey: positionKey('2,64,2'), heldItem: 'flint_and_steel' as const },
      ])
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* store.blockAt(position)).toBe(AIR_BLOCK_ID)
      const spawned = (yield* roster.api.entities).find((entity) => entity.kind === PRIMED_TNT_KIND)
      expect(spawned).toBeDefined()
      expect(spawned?.feetPosition).toStrictEqual({ x: 2.5, y: 64, z: 2.5 })
    }),
  )
})

describe('the entities stage resolves both ranged mob attacks and zombie contact damage', () => {
  it.effect('a skeleton in projectile range and a zombie in contact range both damage the player in one sweep', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* builtStages
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)!

      // Skeleton: within the [6, 16] projectile band the ecosystem rule uses,
      // cooldown at zero so it fires immediately.
      yield* roster.api.spawn({
        kind: SKELETON_KIND,
        feetPosition: { x: 10, y: 64, z: 0 },
        healthPoints: 20,
        behaviour: initialEcosystemMobState(),
      })
      // Zombie: not an ecosystem-mob kind, resolved separately by
      // `resolveHostileContacts` purely on distance to the player.
      yield* roster.api.spawn({
        kind: ZOMBIE_KIND,
        feetPosition: { x: 0, y: 64, z: 0 },
        healthPoints: 20,
        behaviour: undefined,
      })

      yield* entities.run(DeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer))

      const damages = yield* drainPlayerDamages(state)
      expect(damages.some((event) => event._tag === 'HostileContact' && event.kind === SKELETON_KIND)).toBe(true)
      expect(damages.some((event) => event._tag === 'HostileContact' && event.kind === ZOMBIE_KIND)).toBe(true)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})

describe('CancelFishing with no active session', () => {
  it.effect('reports NoActiveFishingSession rather than cancelling nothing', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestFishingCancel(state, 'cancel-nothing')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toStrictEqual([
        { action: 'CancelFishing', requestId: 'cancel-nothing', success: false, outcome: 'NoActiveFishingSession' },
      ])
    }),
  )
})

describe('additional fluid propagation branches', () => {
  it.effect('a work item probing a position below the world is forgotten rather than crashing', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,-1,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('lava spreads within its own horizontal range and solidifies on contact with water', () =>
    Effect.gen(function* () {
      const lava = blockIdOf('lava')!
      const origin = { x: 0, y: 64, z: 0 }
      const waterNeighbour = { x: 1, y: 64, z: 0 }
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, lava],
          [{ x: 0, y: 63, z: 0 }, STONE],
          [waterNeighbour, WATER],
        ]),
        ['0,0', '-1,0'],
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'lava' }])
      // Lava only ticks on every `LAVA_TICK_INTERVAL`th frame (REGRESSION:
      // "lava keys survive the ticks on which lava is not scheduled"), so run
      // until its tick is actually active.
      for (let tick = 1; tick <= LAVA_TICK_INTERVAL; tick += 1) {
        yield* fluids.run(DeltaTimeSecs(0.016))
      }

      // A lava cell that CONTACTS water solidifies ITSELF (real Minecraft:
      // the lava becomes obsidian at its own position), which is the
      // `cell.kind === 'lava' && contacts.length > 0` arm — proving the
      // PROBE recognised water as `'opposite-fluid'` from lava's own
      // perspective (the water-kind half of that check is already covered by
      // the existing "water meeting a lava source" test).
      expect(yield* store.blockAt(origin)).toBe(OBSIDIAN)
      // The water itself is untouched, and no horizontal spread happened —
      // solidifying is the WHOLE transition for that tick, matching
      // `transitionFluidCell`'s early return once `contacts.length > 0` for a
      // lava cell.
      expect(yield* store.blockAt(waterNeighbour)).toBe(WATER)
      expect(yield* store.blockAt({ x: -1, y: 64, z: 0 })).toBeUndefined()
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('a freshly-arrived non-source item stays supported by a live parent already in the runtime', () =>
    Effect.gen(function* () {
      const origin = { x: 0, y: 64, z: 0 }
      const grandchild = { x: 2, y: 64, z: 0 }
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [{ x: 0, y: 63, z: 0 }, STONE],
          // `parent` ({1,64,0}) starts as air, so tick 1's ordinary spread
          // places real water there and registers it in the runtime's
          // `cells` map. `grandchild` starts as real water so its own probe
          // reads `same-fluid` the moment it's evaluated in tick 2.
          [grandchild, WATER],
        ]),
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      // Tick 1: register `origin` (source) and `parent` (flowing, parented on
      // origin) in the runtime's `cells` map by actually propagating one step.
      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))
      expect(
        (yield* Ref.get(state.fluidFrontier)).some((item) => item.key === positionKey('1,64,0')),
      ).toBe(true)

      // Tick 2: `grandchild` arrives FRESH (never in `cells` before) carrying
      // `source: false` and `parent: parent's key`, which IS already
      // registered as `kind: 'water'`. It must survive rather than being
      // retracted as an unsupported flowing cell.
      yield* Ref.set(state.fluidFrontier, [
        {
          key: positionKey('2,64,0'),
          kind: 'water',
          source: false,
          parent: positionKey('1,64,0'),
        },
      ])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect(yield* store.blockAt(grandchild)).toBe(WATER)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})

describe('fire tick budget, unregistered blocks and duplicate ignition', () => {
  const FIRE = blockIdOf('fire') ?? 119
  // Deliberately outside block-vocabulary.ts's registered id range (its
  // highest registered id is in the 120s), so `blockTypeOfId` returns
  // `undefined` for it — a block this vocabulary does not know, exactly the
  // shape `place-block.ts`'s own `UnknownBlock` arm defends against.
  const UNREGISTERED_BLOCK_ID = 250

  it.effect('a fire tick with remaining budget exits early once nothing is left to burn', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!

      // No active fire blocks at all — only a burning "player" actor one tick
      // from finishing. The loop is handed enough delta time for three ticks;
      // after the first, both `fires` and `burningActors` are empty, and the
      // budget-remaining ticks must be skipped rather than re-entering
      // `stepFireTick` on an already-settled state.
      yield* Ref.set(state.fireLifecycle, {
        fires: [],
        burningActors: [
          {
            id: 'player',
            kind: 'player',
            position: { x: 0, y: 64, z: 0 },
            remainingTicks: 1,
            damageCooldownTicks: 0,
          },
        ],
        seed: 0,
      })

      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS * 3)).pipe(Effect.provide(FrameServicesLayer))

      const settled = yield* Ref.get(state.fireLifecycle)
      expect(settled.fires).toStrictEqual([])
      expect(settled.burningActors ?? []).toStrictEqual([])
    }),
  )

  it.effect('an unregistered neighbouring block reads as an unknown fire block rather than crashing', () =>
    Effect.gen(function* () {
      const position = { x: 30, y: 64, z: 30 }
      const strangeNeighbour = { x: 31, y: 64, z: 30 }
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [position, FIRE],
          [strangeNeighbour, UNREGISTERED_BLOCK_ID],
        ]),
      )
      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 41))

      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      // Nothing crashed reading the unregistered id, and the fire itself is
      // still tracked.
      expect(yield* store.blockAt(strangeNeighbour)).toBe(UNREGISTERED_BLOCK_ID)
      expect((yield* Ref.get(state.fireLifecycle)).fires.length).toBeGreaterThanOrEqual(0)
    }),
  )

  it.effect('sorts multiple fires breaking ties on y then z when x is equal', () =>
    Effect.gen(function* () {
      const { state, store, stages } = yield* builtStages
      // Spaced well outside each other's FIRE_SNAPSHOT_OFFSETS neighbourhood
      // so the three fires cannot interact with (ignite, extinguish, or
      // otherwise perturb) one another — this test is only about the final
      // sort's tie-break, not about fire-to-fire spread.
      const shared = { x: 5, y: 64, z: 5 }
      const sameXY = { x: 5, y: 64, z: 15 }
      const sameXOnly = { x: 5, y: 75, z: 5 }
      for (const position of [shared, sameXY, sameXOnly]) {
        yield* store.api.setBlock({ ...position, y: position.y - 1 }, STONE)
        yield* store.api.setBlock(position, FIRE)
      }
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([shared, sameXY, sameXOnly], 43))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      const sorted = (yield* Ref.get(state.fireLifecycle)).fires.map((fire) => fire.position)
      expect(sorted).toStrictEqual([shared, sameXY, sameXOnly].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z))
    }),
  )

  it.effect('igniting a position the tracker already lists as on fire does not duplicate the entry', () =>
    Effect.gen(function* () {
      // A desync a host-side restore can produce: `fireLifecycle` already
      // lists `position` as burning, but the WORLD block there is still air
      // (e.g. the snapshot was restored without the matching world write).
      // `fire_charge` ignites bare air unconditionally (vertical-slice.test.ts:
      // "the same item on ordinary air sets fire instead"), so this reaches a
      // genuine `Lit` outcome at a position the tracker already has.
      const position = { x: 12, y: 64, z: 12 }
      // Ignition probes a whole portal-frame window around the target, not
      // just its own chunk (`ignite-portal.ts`'s `PORTAL_WINDOW_RADIUS`), so
      // every chunk in that window must be resident or the portal arm reads
      // `ChunkNotLoaded` before fire is ever tried.
      const residentAround = chunkCoordsAround(position, PORTAL_WINDOW_RADIUS).map(
        (coord) => `${String(coord.cx)},${String(coord.cz)}`,
      )
      const { state, stages } = yield* builtStagesInWorld(world([]), residentAround)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const seeded = makeFireLifecycleState([position], 47)
      yield* Ref.set(state.fireLifecycle, seeded)

      yield* Ref.update(state.pendingItemUses, (pending) => [
        ...pending,
        { requestId: 'relight', positionKey: positionKey('12,64,12'), heldItem: 'fire_charge' as const },
      ])
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toStrictEqual([
        {
          requestId: 'relight',
          heldItem: 'fire_charge',
          success: true,
          outcome: { _tag: 'Fire', outcome: { _tag: 'Lit', position } },
        },
      ])
      // Still exactly the one entry the tracker started with — the dedup
      // branch returned `current` rather than appending a duplicate.
      expect((yield* Ref.get(state.fireLifecycle)).fires).toStrictEqual(seeded.fires)
    }),
  )

  it.effect('a mutation write that finds its chunk unloaded is retried; one that fails otherwise reverts', () =>
    Effect.gen(function* () {
      const oakPlanks = blockIdOf('oak_planks')!
      // Fire A spreads to a flammable neighbour (seed 1 makes the very first
      // spread roll succeed — `FIRE_SPREAD_CHANCE` is 0.3 and
      // `nextRoll(1).roll` is ~0.0000078). The write for that NEW ignition is
      // intercepted to fail, exercising the `mutation.block === 'fire'`
      // failure arm.
      const spreadSource = { x: 0, y: 64, z: 0 }
      const ignitionTarget = { x: 1, y: 64, z: 0 }
      // Fire B has air below and no flammable neighbour, so it is
      // `!supported` and this tick tries to extinguish it (an `'air'`
      // mutation at its own position). Its write is intercepted to fail with
      // a non-`ChunkNotLoaded` reason, exercising the unconditional-revert arm.
      const unsupportedReverts = { x: 20, y: 64, z: 20 }
      // Fire C is the same shape as B, but its write is intercepted to fail
      // with `ChunkNotLoaded` specifically, exercising the retry-counter arm.
      const unsupportedRetries = { x: 40, y: 64, z: 40 }

      const { state, store } = yield* builtStagesInWorld(
        world([
          [spreadSource, blockIdOf('fire') ?? 119],
          [{ x: 0, y: 63, z: 0 }, STONE],
          [ignitionTarget, oakPlanks],
          [unsupportedReverts, blockIdOf('fire') ?? 119],
          [unsupportedRetries, blockIdOf('fire') ?? 119],
        ]),
        // Every one of the three fires' own chunks must be resident, or the
        // DOMAIN layer's own read-side retry (fire-lifecycle.ts's
        // `cell.block === FIRE_UNAVAILABLE_BLOCK` branch) fires instead of
        // the write-failure paths this test targets.
        ['0,0', '1,1', '2,2'],
      )
      const blockedStore: ChunkStoreApi = {
        ...store.api,
        setBlock: (position, block) => {
          if (blockKey(position) === blockKey(ignitionTarget)) {
            return Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
          }
          if (blockKey(position) === blockKey(unsupportedReverts)) {
            return Effect.succeed({ _tag: 'OutOfWorld' } as const)
          }
          if (blockKey(position) === blockKey(unsupportedRetries)) {
            return Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
          }
          return store.api.setBlock(position, block)
        },
      }
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const rewiredStages = gameplayStages(
        state,
        blockedStore,
        roster.api,
        inventory.api,
        player.api,
        time,
      )
      const fireStage = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!

      yield* Ref.set(
        state.fireLifecycle,
        makeFireLifecycleState([spreadSource, unsupportedReverts, unsupportedRetries], 1),
      )
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      const fires = (yield* Ref.get(state.fireLifecycle)).fires
      // The failed ignition never became a tracked fire, and the world write
      // never landed.
      expect(fires.some((fire) => fire.position.x === 1 && fire.position.z === 0)).toBe(false)
      expect(yield* store.blockAt(ignitionTarget)).toBe(oakPlanks)

      // The OutOfWorld failure reverted to the PREVIOUS fire entry
      // unconditionally — still tracked, no retry counter attached.
      const reverted = fires.find(
        (fire) => fire.position.x === 20 && fire.position.y === 64 && fire.position.z === 20,
      )
      expect(reverted).toStrictEqual({ position: unsupportedReverts, ageTicks: 0 })

      // The ChunkNotLoaded failure kept the fire AND recorded a retry.
      const retried = fires.find(
        (fire) => fire.position.x === 40 && fire.position.y === 64 && fire.position.z === 40,
      )
      expect(retried).toStrictEqual({ position: unsupportedRetries, ageTicks: 0, unloadedRetries: 1 })
    }),
  )
})

describe('requestBowShot dies when a correlated request is missing its shot geometry', () => {
  it.effect('a bare requestId with no geometry object is a defect, not a silent no-op', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      // The public overloads make a correlated call without geometry a type
      // error, which is exactly what stops an ordinary caller from reaching
      // this defect. A caller that goes through a loosely-typed reference (a
      // JS caller, or a `.d.ts` mismatch) is not stopped, so this widens the
      // reference to the general implementation signature to reach it.
      const loose = requestBowShot as unknown as (
        state: GameplayFrameState,
        requestId: string,
      ) => Effect.Effect<void>
      const exit = yield* Effect.exit(Effect.suspend(() => loose(state, 'geometry-missing')))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect((Cause.squash(exit.cause) as Error).message).toBe(
          'requestBowShot: a correlated request requires shot geometry',
        )
      }
    }),
  )
})

describe('restoreStatusEffects resets movement speed when the restored snapshot has no speed effect', () => {
  it.effect('restoring a non-speed snapshot after a speed one resets the multiplier to 1', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      yield* restoreStatusEffects(state, {
        effects: [{ type: 'speed', remainingSecs: 4, pulseClockSecs: 0 }],
      })
      expect(yield* getPlayerMovementSpeedMultiplier(state)).toBe(1.2)

      yield* restoreStatusEffects(state, {
        effects: [{ type: 'regeneration', remainingSecs: 2, pulseClockSecs: 0 }],
      })
      expect(yield* getPlayerMovementSpeedMultiplier(state)).toBe(1)
    }),
  )
})

describe('a portal crossing from the nether returns the player to the overworld', () => {
  it.effect('four seconds of standing in a portal from the nether side switches back to overworld', () =>
    Effect.gen(function* () {
      const NETHER_PORTAL = blockIdOf('nether_portal') ?? 118
      const spawnCell = { x: 0, y: 64, z: 0 }
      const store = yield* makeChunkStoreDouble(world([[spawnCell, NETHER_PORTAL]]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      const player = yield* makePlayerServiceDouble(undefined, 'nether')
      const time = yield* makeTimeService()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)

      expect(yield* player.api.dimension).toBe('nether')
      yield* runFrames(stages, 300, DeltaTimeSecs(0.016))

      expect(yield* player.api.dimension).toBe('overworld')
    }),
  )
})

describe('block placement rolls back and dies loudly when the compensating restore cannot succeed', () => {
  it.effect('a failed placement whose reservation cannot be returned is a defect, not a silent loss', () =>
    Effect.gen(function* () {
      const target = { x: 3, y: 64, z: 3 }
      // Already occupied, so `placeBlock` refuses and the rollback path runs.
      const store = yield* makeChunkStoreDouble(world([[target, STONE]]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble([itemStack('sand', 1)])
      const time = yield* makeTimeService()
      // The reservation succeeds (real `remove`), but the compensating `add`
      // that should return it is intercepted to report it could not fit —
      // the invariant violation this defect exists to catch.
      const jammedInventory: InventoryServiceApi = { ...inventory.api, add: () => Effect.succeed(1) }
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api, jammedInventory, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestBlockPlacement(state, { positionKey: positionKey('3,64,3'), heldItem: 'sand' })

      const exit = yield* Effect.exit(interactions.run(DeltaTimeSecs(0)))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect((Cause.squash(exit.cause) as Error).message).toBe(
          'placement rollback could not restore sand',
        )
      }
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})

describe('the vehicles stage advances real vehicles when a vehicle service is registered', () => {
  it.effect('an idle tick with a registered vehicle service completes without a vehicle to move', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const vehicleService = yield* makeVehicleService()
      const stages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        vehicleService,
      )
      const vehicles = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.vehicles)!

      yield* vehicles.run(DeltaTimeSecs(0.016))

      expect(yield* vehicleService.vehicles).toStrictEqual([])
    }),
  )
})

describe('villager trade: the real removal disagreeing with the preflight check reports InsufficientItems', () => {
  it.effect('rolls back and reports InsufficientItems when the real remove takes less than the preflight promised', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const slots: Array<Slot> = emptySlots().map((slot, index) =>
        index === 0 ? itemStack('wheat', 20) : slot,
      )
      const inventory = yield* makeInventoryDouble(slots)
      const racyInventory: InventoryServiceApi = {
        ...inventory.api,
        // The preflight (pure, over a snapshot) sees 20 wheat and approves.
        // The REAL removal takes only 5 — a race the rollback must catch.
        remove: () => Effect.succeed(5),
        restore: (snapshot) =>
          Effect.gen(function* () {
            const current = yield* inventory.api.storageSnapshot
            yield* inventory.api.restoreStorage({ ...current, inventory: snapshot })
            return 0
          }).pipe(Effect.orDie),
      }
      const time = yield* makeTimeService()
      const stages = gameplayStages(state, store.api, roster.api, racyInventory, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      const villager = makeVillager('shortchanged-trader', 'farmer')
      const offer = villager.offers.find((candidate) => candidate.input.item === 'wheat')!
      yield* Ref.set(state.villagerTrades, addVillager(emptyVillagerTradeState(), villager))

      const request = { requestId: 'shortchanged', villagerId: villager.id, offerId: offer.id }
      yield* requestVillagerTrade(state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([
        { ...request, _tag: 'Rejected', reason: 'InsufficientItems' },
      ])
      expect(yield* inventory.api.countOf('wheat')).toBe(20)
    }),
  )
})

describe('villager trade: the roster changing underneath an already-approved commit', () => {
  it.effect('still reports Traded when the commit finds no villager left to record the use against', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const slots: Array<Slot> = emptySlots().map((slot, index) =>
        index === 0 ? itemStack('wheat', 20) : slot,
      )
      const inventory = yield* makeInventoryDouble(slots)
      const villager = makeVillager('vanishing-trader', 'farmer')
      const offer = villager.offers.find((candidate) => candidate.input.item === 'wheat')!
      // The commit's own `add` (line 3253 of registration.ts, called only after
      // the preflight has already approved this trade) also empties the trade
      // roster as a side effect -- simulating the villager despawning in the
      // window between the preflight's lookup (line 3210-3212) and the commit
      // at line 3266. `useVillagerOffer` then finds no matching villager and
      // returns undefined; the `?? current` fallback must keep the roster as
      // the racy `add` left it rather than throwing or resurrecting the
      // villager.
      const racyInventory: InventoryServiceApi = {
        ...inventory.api,
        add: (item, count) =>
          Ref.set(state.villagerTrades, emptyVillagerTradeState()).pipe(
            Effect.andThen(inventory.api.add(item, count)),
          ),
      }
      const time = yield* makeTimeService()
      const stages = gameplayStages(state, store.api, roster.api, racyInventory, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* Ref.set(state.villagerTrades, addVillager(emptyVillagerTradeState(), villager))

      const request = { requestId: 'vanishing', villagerId: villager.id, offerId: offer.id }
      yield* requestVillagerTrade(state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([{ ...request, _tag: 'Traded' }])
      // The fallback kept the racy `add`'s empty roster rather than crashing
      // or reintroducing a villager `useVillagerOffer` could not find.
      expect((yield* Ref.get(state.villagerTrades)).villagers).toStrictEqual([])
    }),
  )
})

describe('farming and food item uses through the full interactions stage', () => {
  it.effect('bone meal against a non-crop cell still reaches the ApplyBoneMeal arm', () =>
    Effect.gen(function* () {
      const position = { x: 40, y: 64, z: 40 }
      const { state, stages } = yield* builtStagesInWorld(world([[position, STONE]]))
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestBoneMeal(state, 'bone-meal-stage', position)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const [result] = yield* drainItemUseResults(state)
      expect(result).toMatchObject({ action: 'ApplyBoneMeal', requestId: 'bone-meal-stage' })
    }),
  )

  it.effect('bone meal against a real crop applies and consumes one', () =>
    Effect.gen(function* () {
      const wheatCrop = blockIdOf('wheat_crop')!
      const position = { x: 0, y: 64, z: 0 }
      const { state, stages } = yield* builtStagesInWorld(world([[position, wheatCrop]]))
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestBoneMeal(state, 'bone-meal-success', position)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toStrictEqual([
        {
          action: 'ApplyBoneMeal',
          requestId: 'bone-meal-success',
          heldItem: 'bone_meal',
          success: true,
          consumedCount: 1,
          outcome: { _tag: 'applied', at: position },
        },
      ])
    }),
  )

  it.effect('bone meal against an unloaded cell reports not-a-crop without a block reading', () =>
    Effect.gen(function* () {
      const position = { x: 42, y: 64, z: 42 }
      const { state, stages } = yield* builtStagesInWorld(world([]), [])
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestBoneMeal(state, 'bone-meal-unloaded', position)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toStrictEqual([
        {
          action: 'ApplyBoneMeal',
          requestId: 'bone-meal-unloaded',
          heldItem: 'bone_meal',
          success: false,
          consumedCount: 0,
          outcome: { _tag: 'notCrop', at: position, block: undefined },
        },
      ])
    }),
  )

  it.effect('tilling a non-tillable cell reports failure with no durability spent', () =>
    Effect.gen(function* () {
      const position = { x: 41, y: 64, z: 41 }
      const { state, stages } = yield* builtStagesInWorld(world([[position, STONE]]))
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestSoilTill(state, 'till-fail', position, 'iron_hoe')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const [result] = yield* drainItemUseResults(state)
      expect(result).toMatchObject({
        action: 'TillSoil',
        requestId: 'till-fail',
        heldItem: 'iron_hoe',
        success: false,
        durabilityDamage: 0,
        outcome: { _tag: 'notTillable' },
      })
    }),
  )

  it.effect('planting a potato on non-farmland reports failure with nothing consumed', () =>
    Effect.gen(function* () {
      const position = { x: 42, y: 64, z: 42 }
      const { state, stages } = yield* builtStagesInWorld(world([[position, STONE]]))
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestPotatoPlanting(state, 'plant-fail', position)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const [result] = yield* drainItemUseResults(state)
      expect(result).toMatchObject({ action: 'PlantPotato', requestId: 'plant-fail', success: false, consumedCount: 0 })
    }),
  )

  it.effect('eating a potato while already full reports failure with nothing consumed', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const full = { healthPoints: 20, hungerPoints: 20, maxHungerPoints: 20 }

      yield* requestPotatoFoodUse(state, 'eat-potato-full', full)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toStrictEqual([
        {
          action: 'EatPotato',
          requestId: 'eat-potato-full',
          heldItem: 'potato',
          success: false,
          consumedCount: 0,
          outcome: { _tag: 'full' },
        },
      ])
    }),
  )

  it.effect('eating ordinary food while already full reports failure with nothing consumed', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const full = { healthPoints: 20, hungerPoints: 20, maxHungerPoints: 20 }

      yield* requestFoodUse(state, 'eat-food-full', 'cod', full)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const [result] = yield* drainItemUseResults(state)
      expect(result).toMatchObject({
        action: 'EatFood',
        requestId: 'eat-food-full',
        heldItem: 'cod',
        success: false,
        consumedCount: 0,
        outcome: { _tag: 'full' },
      })
    }),
  )
})

describe('CastFishing fails without water rather than starting a session', () => {
  it.effect('casting with hasWater: false reports failure and starts no session', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* Ref.update(state.pendingItemUses, (pending) => [
        ...pending,
        {
          action: 'CastFishing' as const,
          requestId: 'cast-no-water',
          rod: equipmentItem(itemStack('fishing_rod', 1), durability(64, 64)),
          environment: { hasWater: false, hasSkyAccess: true, isRaining: false, isOpenWater: true },
        },
      ])
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toStrictEqual([
        {
          action: 'CastFishing',
          requestId: 'cast-no-water',
          success: false,
          outcome: { _tag: 'NoWater' },
        },
      ])
      expect(yield* Ref.get(state.fishingSession)).toBeUndefined()
    }),
  )
})

describe('AdvanceFishing rejects an invalid duration without discarding the active session', () => {
  it.effect('a negative duration reports InvalidDuration rather than Cancelled, and keeps the session', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const rod = equipmentItem(itemStack('fishing_rod', 1), durability(64, 64))
      const environment = { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true }

      yield* requestFishingCast(state, 'cast', rod, environment)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      yield* drainItemUseResults(state)

      // `advanceFishing` (fishing.ts) checks the duration before it checks
      // water, so a negative duration reports `InvalidDuration` even with
      // `hasWater: true` -- the false side of registration.ts:3622's
      // `outcome._tag === 'Cancelled'` check, which must leave
      // `state.fishingSession` alone for this outcome and clear it only for a
      // real `Cancelled`.
      yield* requestFishingAdvance(state, 'bad-duration', -1, { hasWater: true })
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toMatchObject([
        {
          action: 'AdvanceFishing',
          requestId: 'bad-duration',
          success: false,
          outcome: { _tag: 'InvalidDuration', durationSecs: -1 },
        },
      ])
      expect(yield* Ref.get(state.fishingSession)).not.toBeUndefined()
    }),
  )
})
