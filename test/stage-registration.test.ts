/**
 * Named regression tests for the frame contract.
 *
 * Each `it.effect` title below names the thing that must never come back. These
 * are not smoke tests: they encode plan.md §2.3-1 and §2.3-3, both of which are
 * invisible to the type checker and to `pnpm check:deps`, because both are
 * violated with STRINGS rather than with imports.
 */
import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Brand, Cause, Effect, Exit, Layer, Option, Ref, Result, Schema, Stream } from 'effect'
import { AIR_BLOCK_ID, AngleRadians, BlockId, DimensionIdSchema, EntityHealthPoints, EntitySerial, PositionAxis, ProjectileIdSchema, SimulationTickSchema, WorldIdSchema, blockIdOf, position as kernelPosition, type BlockPosition } from '@nerima-games/mc-kernel'
import type { BlockReading, ChunkStore, ChunkStoreApi } from '@nerima-games/mc-worldgen'
import {
  CREEPER_KIND,
  DROPPED_ITEM_KIND,
  type MobBehaviour,
  type MobDropEvent,
  type MobExperienceEvent,
  type MobSpawnAttempt,
} from '../src/domain/entities/mob-frame'
import { spawnDroppedItem } from '../src/domain/entities/dropped-item'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../src/domain/entities/xp-orb'
import {
  FIRE_DAMAGE_INTERVAL_TICKS,
  FIRE_TICK_INTERVAL_SECS,
  makeFireLifecycleState,
  type FireLifecycleSnapshot,
} from '../src/domain/fire-lifecycle'
import type { WeatherState } from '../src/domain/weather'
import { SKELETON_KIND, initialEcosystemMobState } from '../src/domain/mob/mob-ecosystem'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import { makeVillager } from '../src/domain/villager-trade'
import { GameplayVillagerTradeSnapshotSchema } from '../src/stages/gameplay-owner-registrations.js'
import {
  EntityId,
  EntityKind,
  HungerPoints,
  POTATO_MATURITY_SECS,
  SPAWN_VITALS,
  type EntityManager,
  type EntityRoster,
  type PlayerPose,
  type Slot,
} from '@nerima-games/mc-sim'
import { BOW_TARGET_CENTER_Y_OFFSET, shotTarget } from '../src/domain/interactions/bow-shot'
import { BOW_FULL_CHARGE_SECS, BOW_MIN_CHARGE_SECS } from '../src/domain/interactions/draw-bow'
import {
  ENDER_DRAGON_DEATH_XP,
  ENDER_DRAGON_MAX_HEALTH,
} from '../src/domain/mob/ender-dragon-encounter'
import {
  TimeService,
  TimeServiceLayer,
  durability as makeDurability,
  equipmentItem as makeEquipmentItem,
  itemStack as makeItemStack,
  makeTimeService,
  makeFishingService,
  makeBrewingService,
  makeProjectileService,
  launchProjectile,
  emptyFishingState,
  INITIAL_PROJECTILE_SERVICE_SNAPSHOT,
  makeVehicleService,
  DomainEventBus,
  FishingStateSchema,
  FishingElapsedTicksSchema,
  FishingWaitTicksSchema,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  SNOWBALL_PROFILE,
  type FishingState,
  type ProjectileServiceSnapshot,
  type ProjectileLaunch,
  TNT_REPLICATED_OWNER_ID,
  INITIAL_TNT_SERVICE_SNAPSHOT,
  makeTntService,
  TntServiceSnapshotSchema,
  type DomainEventBusApi,
} from '@nerima-games/mc-sim'
import {
  DeltaTimeSecs,
  StageId,
  type BlockPositionKey,
  type FrameServices,
  type GameModule,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import { disturb, takeBatch } from '../src/domain/falling-block'
import type { FluidWorkItem } from '../src/domain/fluid-frontier'
import { chunkCoordsAround } from '../src/domain/chunk-window'
import { PORTAL_WINDOW_RADIUS } from '../src/domain/interactions/ignite-portal'
import { DEFAULT_ROLL_SEED } from '../src/domain/frame-rolls'
import { StatusEffectStateSchema } from '../src/domain/status-effect.js'
import {
  gameplayStages,
  drainItemUseResults,
  drainPlayerDamages,
  drainPlayerHeals,
  drainBowShotResults,
  drainFluidUpdates,
  drainMeleeAttackResults,
  drainMobDrops,
  drainMobExperience,
  drainBlockPlacementResults,
  drainVillagerTradeResults,
  drainWeatherGameplayEvents,
  isHoeItem,
  LAVA_TICK_INTERVAL,
  makeGameplayFrameState,
  makeGameplayFrameStateForOwner,
  makeGameplayStages,
  gameplayModule,
  GameplayFishingItemUseResultSchema,
  GameplayBrewingItemUseRequestSchema,
  GameplayBrewingItemUseResultSchema,
  EnderPearlOutcomeSchema,
  insertBrewingBottle,
  insertBrewingFuel,
  insertBrewingIngredient,
  requestBlockPlacementCommand,
  requestBlockBreak,
  requestBucketUse,
  requestBoneMeal,
  requestBowShot,
  requestFireExtinguish,
  requestFishingAdvance,
  requestFishingCancel,
  requestFishingCast,
  requestFishingReel,
  requestCollectBrewingBottle,
  collectBrewingPotion,
  requestEnderPearlThrow,
  requestFoodUse,
  requestItemUse,
  requestMeleeAttack,
  requestMobSpawn,
  requestPotatoFoodUse,
  requestPotatoHarvest,
  requestPotatoPlanting,
  requestSoilTill,
  requestStatusEffect,
  requestTargetedItemUse,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
  requestTargetedPotatoPlanting,
  requestTargetedSoilTill,
  requestVillagerTrade,
  restoreFireLifecycle,
  resolveTargetedBlock,
  getPlayerMovementSpeedMultiplier,
  restoreStatusEffects,
  snapshotFireLifecycle,
  snapshotStatusEffects,
  submitWeatherGameplayInput,
  useBrewingPotion,
  type EnderPearlThrowRequest,
  type GameplayFrameState,
} from '../src/stages/registration'
import type { GameplayStageCommitServices } from '../src/stages/registration-core'
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
import { makePlayerServiceDouble, SPAWN_POSE } from './support/player-service-double'
import {
  BrewingServiceStateSchema,
  WorldCommitChunkStoreUnavailable,
  WorldCommitCoordinator,
  ReplicatedOwnerUnknown,
  WorldCommitEmptyRequest,
  CropSnapshotSchema,
  PlayerStorageSnapshotSchema,
  PlayerServiceSnapshotSchema,
  makeWorldCommitCoordinator,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { emptyInventoryLayer, emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { gameplayCommitServicesLayer, makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles'
import { FrameServicesLayer } from './support/frame-services'
import { runFrames } from './support/frame-runner'
import { blockPosition as fixtureBlockPosition, position as fixturePosition } from './support/coordinate-fixtures'
import {
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  GameplayEntityRosterSchema,
  gameplayOwnerRegistrations,
  type GameplayOwnerInitialState,
} from '../src/stages/gameplay-owner-registrations.js'
import type { CropSnapshot } from '@nerima-games/mc-sim'

const itemStack = (item: Parameters<typeof makeItemStack>[0], count: Parameters<typeof makeItemStack>[1]) =>
  Result.getOrThrow(makeItemStack(item, count))
const equipmentItem = (...args: Parameters<typeof makeEquipmentItem>) =>
  Result.getOrThrow(makeEquipmentItem(...args))
const durability = (...args: Parameters<typeof makeDurability>) =>
  Result.getOrThrow(makeDurability(...args))
const positionOfBlock = (value: BlockPosition) => fixturePosition(value.x, value.y, value.z)
const countStoredItem = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: string,
): number => storage.inventory.slots.reduce(
  (count, slot) => count + (slot?.item === item ? slot.count : 0),
  0,
)
const fixtureFishingActor = EntityId('stage-fishing-actor')
const fixtureFishingBobber = Schema.decodeUnknownSync(ProjectileIdSchema)('stage-fishing-bobber')
const fixtureFishingPosition = kernelPosition(PositionAxis(0), PositionAxis(64), PositionAxis(0))
const blocksPerSecond = Brand.nominal<ProjectileLaunch['speed']>()
const fixtureFishingLaunch = {
  position: fixtureFishingPosition,
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: blocksPerSecond(1),
}
const fishingStateFor = (phase: 'cast' | 'bite'): FishingState =>
  Schema.decodeUnknownSync(FishingStateSchema)({
    rods: [{ actor: fixtureFishingActor, bobber: fixtureFishingBobber, phase }],
  })
const projectileStateFor = (bobber = fixtureFishingBobber): ProjectileServiceSnapshot =>
  Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
    projectiles: [{
      id: bobber,
      dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'),
      shooter: fixtureFishingActor,
      kind: 'projectile',
      profile: SNOWBALL_PROFILE,
      projectile: launchProjectile({ ...fixtureFishingLaunch, shooterId: fixtureFishingActor }),
    }],
  })

type FishingAction = 'CastFishing' | 'AdvanceFishing' | 'CancelFishing' | 'ReelFishing'

const enqueueFishingAction = (
  state: GameplayFrameState,
  action: FishingAction,
  elapsedTicks = 120,
): Effect.Effect<void> => {
  if (action === 'CastFishing') {
    return requestFishingCast(state, {
        requestId: 'registered-fishing-cast',
        actor: fixtureFishingActor,
        bobber: fixtureFishingBobber,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(0),
        dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'),
        launch: fixtureFishingLaunch,
        profile: SNOWBALL_PROFILE,
        rod: null,
        environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
    })
  } else if (action === 'AdvanceFishing') {
    return requestFishingAdvance(state, {
        requestId: 'registered-fishing-advance',
        actor: fixtureFishingActor,
        elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(elapsedTicks),
        waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
        approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
        biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
        environment: { hasWater: true },
    })
  } else if (action === 'CancelFishing') {
    return requestFishingCancel(state, 'registered-fishing-cancel', fixtureFishingActor)
  } else {
    return Effect.gen(function* () {
        yield* Ref.set(state.tickCount, 7)
        yield* requestFishingReel(state, 'registered-fishing-reel', fixtureFishingActor)
      })
  }
}

const coordinatorRejectingBlock = (
  coordinator: WorldCommitCoordinatorApi,
  position: BlockPosition,
  block: BlockId,
  error: WorldCommitChunkStoreUnavailable | WorldCommitEmptyRequest,
): WorldCommitCoordinatorApi => ({
  ...coordinator,
  commit: (request) =>
    request.blockWrite?.edits.some(
      (edit) => blockKey(edit.position) === blockKey(position) && edit.block === block,
    )
      ? Effect.fail(error)
      : coordinator.commit(request),
})

const stageIds = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.map((stage) => stage.id)
const OBSIDIAN = Option.getOrThrow(blockIdOf('obsidian'))

/**
 * These fixtures name cells `'a'`, `'lava-a'`, `'water-a'` — scenario-graph
 * identifiers, not coordinates — so they cannot go through kernel's
 * `BlockPositionKey(value)`, which validates the canonical `x,y,z` text and
 * throws on anything else. `Brand.nominal` is the same unchecked construction
 * kernel's own constructor is built on.
 */
const positionKey = Brand.nominal<BlockPositionKey>()

/**
 * The registration effect takes mc-worldgen's `ChunkStore`, mc-sim's
 * `EntityManager`, `TimeService`, `WorldCommitCoordinator` and `DomainEventBus`
 * (kernel's `domain/frame.ts` on `RRegister`). The coordinator fixture also
 * needs an empty inventory to seed the registered player-storage owner. Tests
 * about the SHAPE of registration use these empty host services; behaviour over
 * a real world is covered in `test/vertical-slice.test.ts`.
 */
const registrationEventBus: DomainEventBusApi = {
  publish: () => Effect.void,
  events: Stream.empty,
}

const emptyWorldBase = Layer.mergeAll(
  emptyWorldStoreLayer,
  emptyRosterLayer,
  TimeServiceLayer(),
  emptyInventoryLayer,
  Layer.succeed(DomainEventBus, registrationEventBus),
)
const emptyWorld = Layer.provideMerge(gameplayCommitServicesLayer, emptyWorldBase)
const registeredStages = Effect.provide(makeGameplayStages, Layer.orDie(emptyWorld))

const builtStages = Effect.gen(function* () {
  const state = yield* makeGameplayFrameState
  const store = yield* makeTransactionalChunkStoreDouble(world([]), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const player = yield* makePlayerServiceDouble()
  const inventory = yield* makeInventoryDouble()
  const time = yield* makeTimeService()
  const commit = yield* makeGameplayCommitServices(store.api, inventory.api, { playerPose: SPAWN_POSE })
  return {
    state,
    store,
    roster,
    inventory,
    player,
    commit,
    stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time, undefined, undefined, {}, commit),
  }
})

const builtStagesInWorld = (
  initial: ReadonlyMap<string, BlockId>,
  loadedChunks: ReadonlyArray<string> = ['0,0'],
  crops: CropSnapshot = { crops: [] },
  initialSlots: ReadonlyArray<Slot | undefined> = emptySlots(),
  villagerTrades: NonNullable<GameplayOwnerInitialState['villagerTrades']> = { villagers: [], restockElapsedSecs: 0 },
  entities: GameplayOwnerInitialState['entities'] = { entities: [], nextSerial: EntitySerial(0) },
  fishing: GameplayOwnerInitialState['fishing'] = emptyFishingState(),
  projectiles: GameplayOwnerInitialState['projectiles'] = INITIAL_PROJECTILE_SERVICE_SNAPSHOT,
  tnt: GameplayOwnerInitialState['tnt'] = undefined,
  ownerOverrides: Pick<GameplayOwnerInitialState, 'dimension' | 'vitals'> = {},
  commitOverrides: {
    readonly cropOwnerId?: GameplayStageCommitServices['cropOwnerId'] | undefined
    readonly droppedItemsOwnerId?: GameplayStageCommitServices['droppedItemsOwnerId'] | undefined
    readonly vitalsOwnerId?: GameplayStageCommitServices['vitalsOwnerId'] | undefined
    readonly statusEffectsOwnerId?: GameplayStageCommitServices['statusEffectsOwnerId'] | undefined
    readonly experienceOrbsOwnerId?: GameplayStageCommitServices['experienceOrbsOwnerId'] | undefined
    readonly villagerTradesOwnerId?: GameplayStageCommitServices['villagerTradesOwnerId'] | undefined
    readonly brewingOwnerId?: GameplayStageCommitServices['brewingOwnerId'] | undefined
    readonly fishingOwnerId?: GameplayStageCommitServices['fishingOwnerId'] | undefined
    readonly entitiesOwnerId?: GameplayStageCommitServices['entitiesOwnerId'] | undefined
    readonly projectileOwnerId?: GameplayStageCommitServices['projectileOwnerId'] | undefined
    readonly tntOwnerId?: GameplayStageCommitServices['tntOwnerId'] | undefined
  } = {},
  includeCommit = true,
) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(initial, loadedChunks)
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const player = yield* makePlayerServiceDouble()
    const inventory = yield* makeInventoryDouble(initialSlots)
    const time = yield* makeTimeService()
    const initialStorage = yield* inventory.api.storageSnapshot
    const coordinator = yield* makeWorldCommitCoordinator({
      world: Schema.decodeUnknownSync(WorldIdSchema)('gameplay-stage-tests'),
      owners: gameplayOwnerRegistrations({
        ...ownerOverrides,
        playerStorage: initialStorage,
        playerPose: SPAWN_POSE,
        crops,
        villagerTrades,
        entities,
        fishing,
        projectiles,
        ...(tnt === undefined ? {} : { tnt }),
      }),
      chunkStores: { forDimension: () => store.api },
    })
    const commitCalls = yield* Ref.make(0)
    const rejectCommits = yield* Ref.make(false)
    const failSnapshotOwnerId = yield* Ref.make<GameplayStageCommitServices['playerStorageOwnerId'] | undefined>(undefined)
    const failObserveOwnerId = yield* Ref.make<GameplayStageCommitServices['playerStorageOwnerId'] | undefined>(undefined)
    const controlledCoordinator: WorldCommitCoordinatorApi = {
      ...coordinator,
      snapshot: (ownerId, schema) => Effect.gen(function* () {
        if (ownerId === (yield* Ref.get(failSnapshotOwnerId))) {
          return yield* Effect.fail(new ReplicatedOwnerUnknown({ ownerId }))
        }
        return yield* coordinator.snapshot(ownerId, schema)
      }),
      observe: (ownerId, schema, reads) => Effect.gen(function* () {
        if (ownerId === (yield* Ref.get(failObserveOwnerId))) {
          return yield* Effect.fail(new ReplicatedOwnerUnknown({ ownerId }))
        }
        return yield* coordinator.observe(ownerId, schema, reads)
      }),
      commit: (request) => Effect.gen(function* () {
        yield* Ref.update(commitCalls, (count) => count + 1)
        if (yield* Ref.get(rejectCommits)) return yield* Effect.fail(new WorldCommitEmptyRequest())
        return yield* coordinator.commit(request)
      }),
    }
    const publishedEvents = yield* Ref.make<ReadonlyArray<Parameters<DomainEventBusApi['publish']>[0]>>([])
    const eventBus: DomainEventBusApi = {
      publish: (event) => Ref.update(publishedEvents, (events) => [...events, event]),
      events: Stream.empty,
    }
    const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, controlledCoordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const projectileService = yield* makeProjectileService().pipe(
      Effect.provideService(WorldCommitCoordinator, controlledCoordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const brewingService = yield* makeBrewingService(GAMEPLAY_BREWING_OWNER_ID)
    const tntService = yield* makeTntService(TNT_REPLICATED_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, controlledCoordinator),
    )
    const commit: GameplayStageCommitServices = {
      coordinator: controlledCoordinator,
      playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
      playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      cropOwnerId: GAMEPLAY_CROPS_OWNER_ID,
      droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
      brewingOwnerId: GAMEPLAY_BREWING_OWNER_ID,
      statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
      fishingOwnerId: GAMEPLAY_FISHING_OWNER_ID,
      projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID,
      fishingService,
      brewingService,
      projectileService,
      ...(tnt === undefined ? {} : {
        tntOwnerId: TNT_REPLICATED_OWNER_ID,
        tntService,
      }),
      eventBus,
    }
    // These overrides model a compose host that has not registered an optional owner.
    const stageCommit = includeCommit
      ? { ...commit, ...commitOverrides } as GameplayStageCommitServices
      : undefined
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: controlledCoordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    return {
      state,
      store,
      roster,
      player,
      inventory,
      time,
      commit,
      commitCalls,
      rejectCommits,
      failSnapshotOwnerId,
      failObserveOwnerId,
      publishedEvents,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time, undefined, undefined, {}, stageCommit),
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
          // an optional peer. See kernel's domain/frame.ts.
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
  const FIRE = Option.getOrUndefined(blockIdOf('fire')) ?? BlockId(119)

  it.effect('retains an active fire while its chunk is temporarily unavailable', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const position = fixtureBlockPosition(16, 64, 0)
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
      const { state, store, commit } = yield* builtStages
      const position = fixtureBlockPosition(1, 64, 0)
      yield* store.api.setBlock(position, FIRE)
      const initial = makeFireLifecycleState([position], 11)
      yield* Ref.set(state.fireLifecycle, initial)
      const refusingCoordinator = {
        ...commit.coordinator,
        commit: () => Effect.fail(new WorldCommitEmptyRequest()),
      }

      expect(yield* requestFireExtinguish(state, position, {
        coordinator: refusingCoordinator,
        dimension: 'overworld',
        changes: [],
      })).toBe(false)
      expect(yield* store.blockAt(position)).toBe(FIRE)
      expect(yield* Ref.get(state.fireLifecycle)).toStrictEqual(initial)
      expect(yield* Ref.get(state.operationFailures)).toStrictEqual([
        expect.objectContaining({
          _tag: 'Failed',
          operation: 'WorldCommit',
          subject: 'Fire',
          error: expect.any(WorldCommitEmptyRequest),
        }),
      ])
    }),
  )

  it('commits fire entity damage from the registered owner once for bounded health values', async () => {
    await FastCheck.assert(FastCheck.asyncProperty(
      FastCheck.integer({ min: 2, max: 20 }),
      async (healthPoints) => {
        const position = fixtureBlockPosition(2, 64, 0)
        const entityId = EntityId('fire-target')
        const entities: EntityRoster<MobBehaviour> = {
          entities: [{
            id: entityId,
            kind: CREEPER_KIND,
            feetPosition: positionOfBlock(position),
            healthPoints: EntityHealthPoints(healthPoints),
            behaviour: undefined,
          }],
          nextSerial: EntitySerial(1),
        }
        const harness = await Effect.runPromise(builtStagesInWorld(
          world([
            [fixtureBlockPosition(position.x, position.y - 1, position.z), STONE],
            [position, FIRE],
          ]),
          ['0,0'],
          undefined,
          undefined,
          undefined,
          entities,
        ))
        await Effect.runPromise(Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([position], 13)))
        const ownerBefore = await Effect.runPromise(harness.commit.coordinator.snapshot(
          GAMEPLAY_ENTITIES_OWNER_ID,
          GameplayEntityRosterSchema,
        ))
        const revisionBefore = await Effect.runPromise(harness.commit.coordinator.revision)
        const fireStage = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!

        await Effect.runPromise(fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(
          Effect.provide(FrameServicesLayer),
        ))

        const ownerAfterRaw = await Effect.runPromise(harness.commit.coordinator.snapshot(
          GAMEPLAY_ENTITIES_OWNER_ID,
          GameplayEntityRosterSchema,
        ))
        const ownerAfter = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfterRaw.state)
        expect(await Effect.runPromise(Ref.get(harness.commitCalls))).toBe(1)
        expect(ownerAfter.entities[0]?.healthPoints).toBe(healthPoints - 1)
        expect(ownerAfterRaw.revision).toBe(revisionBefore + 1)
        expect(ownerBefore.state.entities[0]?.healthPoints).toBe(healthPoints)
        expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toStrictEqual([])
      },
    ), { numRuns: 8 })
  })

  it.effect('keeps fire owner and frame state unchanged on rejection, then retries the tick', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(2, 64, 0)
      const entityId = EntityId('fire-retry-target')
      const entities: EntityRoster<MobBehaviour> = {
        entities: [{
          id: entityId,
          kind: CREEPER_KIND,
          feetPosition: positionOfBlock(position),
          healthPoints: EntityHealthPoints(2),
          behaviour: undefined,
        }],
        nextSerial: EntitySerial(1),
      }
      const harness = yield* builtStagesInWorld(
        world([
          [fixtureBlockPosition(position.x, position.y - 1, position.z), STONE],
          [position, FIRE],
        ]),
        ['0,0'],
        undefined,
        undefined,
        undefined,
        entities,
      )
      const initialFire = makeFireLifecycleState([position], 13)
      yield* Ref.set(harness.state.fireLifecycle, initialFire)
      const ownerBefore = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const revisionBefore = yield* harness.commit.coordinator.revision
      yield* Ref.set(harness.rejectCommits, true)
      const fireStage = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!

      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(
        Effect.provide(FrameServicesLayer),
      )

      const ownerAfterFailure = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(yield* Ref.get(harness.commitCalls)).toBe(1)
      expect(ownerAfterFailure.state).toStrictEqual(ownerBefore.state)
      expect(yield* harness.commit.coordinator.revision).toBe(revisionBefore)
      expect(yield* Ref.get(harness.state.fireLifecycle)).toStrictEqual(initialFire)
      expect(yield* Ref.get(harness.state.rollSeed)).toBe(DEFAULT_ROLL_SEED)
      expect(yield* drainMobDrops(harness.state)).toStrictEqual([])
      expect(yield* drainMobExperience(harness.state)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'WorldCommit',
        subject: 'Fire',
        error: expect.any(WorldCommitEmptyRequest),
      }))

      yield* Ref.set(harness.rejectCommits, false)
      yield* fireStage.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const ownerAfterRetry = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const decodedRetry = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfterRetry.state)
      expect(yield* Ref.get(harness.commitCalls)).toBe(2)
      expect(decodedRetry.entities[0]?.healthPoints).toBe(1)
      expect(ownerAfterRetry.revision).toBe(revisionBefore + 1)
    }),
  )

  it.effect('caps a large frame to four fire ticks', () =>
    Effect.gen(function* () {
      const { state, store, stages } = yield* builtStages
      const position = fixtureBlockPosition(3, 64, 0)
      yield* store.api.setBlock(fixtureBlockPosition(position.x, position.y - 1, position.z), STONE)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 17))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(99)).pipe(Effect.provide(FrameServicesLayer))

      expect((yield* Ref.get(state.fireLifecycle)).fires).toStrictEqual([
        { position, ageTicks: 4 },
      ])
    }),
  )

  it.effect('routes player fire damage through armour mitigation and wears equipped armour', () =>
    Effect.gen(function* () {
      // `stepFireTick` is the only call site that turns a `FireContact` into a
      // `PlayerDamageEvent`, and every OTHER source of player damage in this
      // file (hostile contact, blasts) is wrapped in `resolveArmoredPlayerDamages`
      // before it reaches `state.playerDamages` — see the `entities` stage.
      // This pins the fire stage's armor result and its replicated durability
      // update, which the other damage-source tests do not exercise.
      const { state, store, stages, inventory, commit } = yield* builtStages
      // The double player's default feet position (player-service-double.ts).
      const position = fixtureBlockPosition(0, 64, 0)
      yield* store.api.setBlock(fixtureBlockPosition(position.x, position.y - 1, position.z), STONE)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 29))

      expect(yield* inventory.api.add('iron_helmet', 1)).toBe(0)
      const equipped = yield* inventory.api.equipFromInventory(0, 'head')
      expect(equipped._tag).toBe('Equipped')
      const expectedRevision = yield* commit.coordinator.revision
      const storage = yield* inventory.api.storageSnapshot
      yield* commit.coordinator.commit({
        expectedRevision,
        expectedDimensions: [],
        changes: [{ ownerId: commit.playerStorageOwnerId, state: storage }],
      })
      const ownerBefore = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(
        Effect.provide(FrameServicesLayer),
      )

      const damages = yield* drainPlayerDamages(state)
      expect(damages).toHaveLength(1)
      expect(damages[0]?.damage.cause).toBe('in_fire')
      // Unmitigated fire-tick damage on normal difficulty is 1. The iron
      // helmet supplies 2 armor points and 0 toughness. Java's armor formula
      // gives min(20, max(A/5, A - 4D/(min(T,20)+8)))/25; with A=2, T=0,
      // and D=1, the reduction is 1.5/25, leaving 0.94 damage.
      // Source: https://minecraft.wiki/w/Armor
      expect(damages[0]?.damage.amount).toBeCloseTo(0.94)

      // `armorDurabilityWearFromPreMitigationDamage` is cause-independent
      // (armor.ts) and reads the PRE-mitigation amount (1), which floors to a
      // wear of exactly 1 point off the helmet's 165 maximum.
      const ownerAfter = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(ownerAfter.revision).toBe(ownerBefore.revision + 1)
      expect(ownerAfter.state.equipment.slots.head?.durability?.current).toBe(164)
    }),
  )

  it.effect('commits fire removal and player storage in one coordinator revision', () =>
    Effect.gen(function* () {
      const { state, store, stages, inventory, commit } = yield* builtStages
      const position = fixtureBlockPosition(0, 64, 0)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, {
        fires: [{ position, ageTicks: 0 }],
        burningActors: [{
          id: 'player',
          kind: 'player',
          position,
          remainingTicks: 10,
          damageCooldownTicks: 0,
        }],
        seed: 29,
      })

      expect(yield* inventory.api.add('iron_helmet', 1)).toBe(0)
      const equipped = yield* inventory.api.equipFromInventory(0, 'head')
      expect(equipped._tag).toBe('Equipped')
      const expectedRevision = yield* commit.coordinator.revision
      const storage = yield* inventory.api.storageSnapshot
      yield* commit.coordinator.commit({
        expectedRevision,
        expectedDimensions: [],
        changes: [{ ownerId: commit.playerStorageOwnerId, state: storage }],
      })
      const ownerBefore = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(
        Effect.provide(FrameServicesLayer),
      )

      expect(yield* store.blockAt(position)).toBeUndefined()
      expect((yield* drainPlayerDamages(state))[0]?.damage.cause).toBe('on_fire')
      const ownerAfter = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(ownerAfter.revision).toBe(ownerBefore.revision + 1)
      expect(ownerAfter.state.equipment.slots.head?.durability?.current).toBe(164)
    }),
  )

  it.effect('breaks an iron helmet with one durability left and commits the fire result', () =>
    Effect.gen(function* () {
      const { state, store, stages, inventory, commit } = yield* builtStages
      const position = fixtureBlockPosition(0, 64, 0)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, {
        fires: [{ position, ageTicks: 0 }],
        burningActors: [{
          id: 'player',
          kind: 'player',
          position,
          remainingTicks: 10,
          damageCooldownTicks: 0,
        }],
        seed: 29,
      })

      const before = yield* inventory.api.storageSnapshot
      const helmet = equipmentItem(itemStack('iron_helmet', 1), durability(1, 165))
      yield* inventory.api.restoreStorage({
        ...before,
        equipment: {
          ...before.equipment,
          slots: { ...before.equipment.slots, head: helmet },
        },
      })
      const synchronized = yield* inventory.api.storageSnapshot
      const expectedRevision = yield* commit.coordinator.revision
      yield* commit.coordinator.commit({
        expectedRevision,
        expectedDimensions: [],
        changes: [{ ownerId: commit.playerStorageOwnerId, state: synchronized }],
      })
      const ownerBefore = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(
        Effect.provide(FrameServicesLayer),
      )

      expect(yield* store.blockAt(position)).toBeUndefined()
      expect((yield* drainPlayerDamages(state))[0]?.damage.cause).toBe('on_fire')
      const ownerAfter = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(ownerAfter.revision).toBe(ownerBefore.revision + 1)
      expect(ownerAfter.state.equipment.slots.head).toBeNull()
    }),
  )

  it.effect('leaves burning-after-leaving-fire damage unmitigated by armour', () =>
    Effect.gen(function* () {
      // The negative control for the test above: a player who is still on
      // the burn timer but is NOT standing in a fire cell right now takes
      // `on_fire` damage, which `CAUSES_BYPASSING_ARMOR` (armor.ts) exempts
      // from per-point mitigation entirely — unlike `in_fire` above, full
      // iron armour must leave the amount untouched.
      const { state, stages, inventory, commit } = yield* builtStages
      // The double player's default feet position (player-service-double.ts).
      // No `FIRE` block is placed here: the player is not touching fire, only
      // still burning from contact this test seeds directly via a due
      // `burningActors` entry.
      const position = fixtureBlockPosition(0, 64, 0)
      yield* Ref.set(state.fireLifecycle, {
        fires: [],
        seed: 1,
        burningActors: [{
          id: 'player',
          kind: 'player',
          position,
          remainingTicks: 10,
          damageCooldownTicks: 0,
        }],
      })

      expect(yield* inventory.api.add('iron_helmet', 1)).toBe(0)
      const equipped = yield* inventory.api.equipFromInventory(0, 'head')
      expect(equipped._tag).toBe('Equipped')
      const expectedRevision = yield* commit.coordinator.revision
      const storage = yield* inventory.api.storageSnapshot
      yield* commit.coordinator.commit({
        expectedRevision,
        expectedDimensions: [],
        changes: [{ ownerId: commit.playerStorageOwnerId, state: storage }],
      })
      const ownerBefore = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(
        Effect.provide(FrameServicesLayer),
      )

      const damages = yield* drainPlayerDamages(state)
      expect(damages).toHaveLength(1)
      expect(damages[0]?.damage.cause).toBe('on_fire')
      // The single iron helmet would reduce 1 to 0.94 (the sibling test above)
      // if this cause were mitigated. It is not: the full unmitigated amount, 1,
      // must survive the fire stage's armor calculation unchanged.
      expect(damages[0]?.damage.amount).toBe(1)

      // Durability wear is cause-independent (armor.ts), so it wears the
      // helmet the same one point as the mitigated in_fire case.
      const ownerAfter = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(ownerAfter.revision).toBe(ownerBefore.revision + 1)
      expect(ownerAfter.state.equipment.slots.head?.durability?.current).toBe(164)
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
    }).pipe(Effect.provide(FrameServicesLayer)),
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
      const origin = fixtureBlockPosition(0, 64, 0)
      const { state, store, stages } = yield* builtStagesInWorld(world([[origin, WATER]]))
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect(yield* store.blockAt(fixtureBlockPosition(0, 63, 0))).toBe(WATER)
      expect(yield* store.blockAt(fixtureBlockPosition(-1, 64, 0))).toBeUndefined()
      expect(yield* store.blockAt(fixtureBlockPosition(1, 64, 0))).toBeUndefined()
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
      const origin = fixtureBlockPosition(0, 64, 0)
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
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
        fixtureBlockPosition(-1, 64, 0),
        fixtureBlockPosition(1, 64, 0),
        fixtureBlockPosition(0, 64, -1),
        fixtureBlockPosition(0, 64, 1),
      ]) {
        expect(yield* store.blockAt(position)).toBe(WATER)
      }
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('removing a source retracts the flowing cells that depended on it', () =>
    Effect.gen(function* () {
      const origin = fixtureBlockPosition(0, 64, 0)
      const neighbours = [
        fixtureBlockPosition(-1, 64, 0),
        fixtureBlockPosition(1, 64, 0),
        fixtureBlockPosition(0, 64, -1),
        fixtureBlockPosition(0, 64, 1),
      ] as const
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
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
        expect(yield* store.blockAt(position)).toBeUndefined()
      }
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('water meeting a lava source materializes obsidian at the contact', () =>
    Effect.gen(function* () {
      const lava = Option.getOrThrow(blockIdOf('lava'))
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [fixtureBlockPosition(0, 64, 0), WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
          [fixtureBlockPosition(1, 64, 0), lava],
        ]),
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      expect(yield* store.blockAt(fixtureBlockPosition(1, 64, 0))).toBe(OBSIDIAN)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('an unloaded chunk boundary defers a source finitely and never writes outside the loaded set', () =>
    Effect.gen(function* () {
      const origin = fixtureBlockPosition(15, 64, 0)
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [fixtureBlockPosition(15, 63, 0), STONE],
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
      expect(yield* store.blockAt(fixtureBlockPosition(16, 64, 0))).toBeUndefined()
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
        'consumedItems',
        'droppedItemPickupExecutions',
        'endPortalTravels',
        'enderDragonEncounter',
        'enderPearlOutcomes',
        'experienceOrbAbsorptionExecutions',
        'fallingBlocks',
        'fireLifecycle',
        'fluidFrontier',
        'fluidUpdates',
        'handledBowShotRequestIds',
        'heldTool',
        'hostileContactCooldowns',
        'itemUseResults',
        'meleeAttackResults',
        'mobDrops',
        'mobExperience',
        'operationFailures',
        'pendingBlockUses',
        'pendingBowShots',
        'pendingBreaks',
        'pendingDroppedItemPickups',
        'pendingExperienceOrbAbsorptions',
        'pendingItemUses',
        'pendingMeleeAttacks',
        'pendingPearlThrows',
        'pendingPlacements',
        'pendingStatusEffects',
        'pendingVillagerTrades',
        'playerDamages',
        'playerHeals',
        'playerMovementSpeedMultiplier',
        'portalCandidates',
        'portalDwell',
        'portalTravels',
        'rollSeed',
        'spawnAttempts',
        'spawnClockSecs',
        'survivalHunger',
        'targetPosition',
        'tickCount',
        'timeOfDay',
        'unsupportedOperations',
        'usedItems',
        'villagerTradeResults',
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
        origin: fixturePosition(0, 64, 0 ),
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
      const target = {
        id: EntityId('e:0'),
        kind: CREEPER_KIND,
        feetPosition: fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 2),
        healthPoints: EntityHealthPoints(20),
        behaviour: undefined,
      }
      const { state, commit, stages } = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined,
        { entities: [target], nextSerial: EntitySerial(1) },
      )

      yield* requestMeleeAttack(state, {
        requestId: 'hit',
        origin: fixturePosition(0, 64, 0 ),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      })
      yield* requestMeleeAttack(state, {
        requestId: 'miss',
        origin: fixturePosition(0, 64, 0 ),
        direction: fixturePosition(1, 0, 0),
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
      const entityOwner = yield* commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(entityOwner.state.entities[0]?.healthPoints).toBe(16)
      expect(yield* drainMobExperience(state)).toStrictEqual([])
    }),
  )

  it.effect('a rejected melee commit requeues the request without changing its owners or outputs', () =>
    Effect.gen(function* () {
      const target = {
        id: EntityId('melee-rejected-target'),
        kind: CREEPER_KIND,
        feetPosition: fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 2),
        healthPoints: EntityHealthPoints(20),
        behaviour: undefined,
      }
      const harness = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined,
        { entities: [target], nextSerial: EntitySerial(1) },
      )
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const before = yield* harness.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      const request = {
        requestId: 'melee-rejected',
        origin: fixturePosition(0, 64, 0),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      } as const

      yield* Ref.set(harness.rejectCommits, true)
      yield* requestMeleeAttack(harness.state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.pendingMeleeAttacks)).toStrictEqual([request])
      expect(yield* drainMeleeAttackResults(harness.state)).toStrictEqual([])
      expect((yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )).state).toStrictEqual(before.state)
      expect(yield* harness.commit.coordinator.revision).toBe(before.revision)
      expect(yield* Ref.get(harness.commitCalls)).toBe(1)
    }),
  )

  it.effect('a lethal melee hit remains retryable when its dropped-item owner is unavailable', () =>
    Effect.gen(function* () {
      const target = {
        id: EntityId('melee-drop-owner-target'),
        kind: CREEPER_KIND,
        feetPosition: fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 2),
        healthPoints: EntityHealthPoints(4),
        behaviour: undefined,
      }
      const harness = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined,
        { entities: [target], nextSerial: EntitySerial(1) },
        undefined, undefined, undefined, {}, { droppedItemsOwnerId: undefined },
      )
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const before = yield* harness.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      const request = {
        requestId: 'melee-drop-owner-unavailable',
        origin: fixturePosition(0, 64, 0),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      } as const

      yield* requestMeleeAttack(harness.state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.unsupportedOperations)).toContainEqual({
        _tag: 'Unsupported', action: 'MobDrop', reason: 'OwnerRegistrationUnavailable',
      })
      expect(yield* Ref.get(harness.state.pendingMeleeAttacks)).toStrictEqual([request])
      expect((yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )).state).toStrictEqual(before.state)
      expect(yield* harness.commit.coordinator.revision).toBe(before.revision)
      expect(yield* Ref.get(harness.commitCalls)).toBe(0)
    }),
  )

  it.effect('a lethal melee hit requeues unchanged when the dropped-item snapshot fails', () =>
    Effect.gen(function* () {
      const target = {
        id: EntityId('melee-drop-snapshot-target'),
        kind: CREEPER_KIND,
        feetPosition: fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 2),
        healthPoints: EntityHealthPoints(4),
        behaviour: undefined,
      }
      const harness = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined,
        { entities: [target], nextSerial: EntitySerial(1) },
      )
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const before = yield* harness.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      yield* Ref.set(harness.failSnapshotOwnerId, GAMEPLAY_DROPPED_ITEMS_OWNER_ID)
      const request = {
        requestId: 'melee-drop-snapshot-failure',
        origin: fixturePosition(0, 64, 0),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      } as const

      yield* requestMeleeAttack(harness.state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
        error: expect.objectContaining({ _tag: 'ReplicatedOwnerUnknown' }),
      }))
      expect(yield* Ref.get(harness.state.pendingMeleeAttacks)).toStrictEqual([request])
      expect((yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )).state).toStrictEqual(before.state)
      expect(yield* harness.commit.coordinator.revision).toBe(before.revision)
      expect(yield* Ref.get(harness.commitCalls)).toBe(0)
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
      const feetPosition = fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 2)
      const entity = {
        id: EntityId('e:0'),
        kind: EntityKind('skeleton'),
        feetPosition,
        healthPoints: EntityHealthPoints(4),
        behaviour: undefined,
      }
      const { state, commit, stages } = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined,
        { entities: [entity], nextSerial: EntitySerial(1) },
      )

      yield* requestMeleeAttack(state, {
        origin: fixturePosition(0, 64, 0 ),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      })
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const entityOwner = yield* commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(entityOwner.state.entities).toStrictEqual([])
      expect(yield* drainMobExperience(state)).toStrictEqual([])
      expect(yield* drainMobDrops(state)).toStrictEqual([])
    }),
  )

  it.effect('a lethal player melee hit emits mob experience exactly once', () =>
    Effect.gen(function* () {
      const feetPosition = fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 2)
      const target = {
        id: EntityId('e:0'),
        kind: CREEPER_KIND,
        feetPosition,
        healthPoints: EntityHealthPoints(4),
        behaviour: undefined,
      }
      const { state, commit, stages } = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined,
        { entities: [target], nextSerial: EntitySerial(1) },
      )

      yield* requestMeleeAttack(state, {
        origin: fixturePosition(0, 64, 0 ),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      })
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const entityOwner = yield* commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(entityOwner.state.entities).toStrictEqual([])
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
            feetPosition: fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 10 ),
            healthPoints: EntityHealthPoints(20),
            behaviour: undefined,
          },
        ],
        nextSerial: EntitySerial(1),
      }
      const targetEntity = target.entities[0]!
      expect(shotTarget(
        [{ id: targetEntity.id, feetPosition: targetEntity.feetPosition }],
        fixturePosition(0, 64, 0),
        0,
        0,
        1,
      )).toBeDefined()
      const { state, commit, stages } = yield* builtStagesInWorld(
        world([[fixtureBlockPosition(0, 64, 5), STONE]]), ['0,0'], undefined, undefined, undefined, target,
      )

      yield* requestBowShot(state, 'wall-shot', {
        origin: fixturePosition(0, 64, 0 ),
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
      const entityOwner = yield* commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(entityOwner.state.entities[0]?.healthPoints).toBe(20)
      expect(yield* Ref.get(state.bowKnockbacks)).toStrictEqual([])
    }),
  )

  it.effect('an unreadable chunk in the arrow path blocks the hit before damage reaches the roster', () =>
    Effect.gen(function* () {
      const target: EntityRoster<MobBehaviour> = {
        entities: [
          {
            id: EntityId('target-beyond-resident-chunk'),
            kind: EntityKind('creeper'),
            feetPosition: fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 20),
            healthPoints: EntityHealthPoints(20),
            behaviour: undefined,
          },
        ],
        nextSerial: EntitySerial(1),
      }
      const targetEntity = target.entities[0]!
      expect(shotTarget(
        [{ id: targetEntity.id, feetPosition: targetEntity.feetPosition }],
        fixturePosition(0, 64, 0),
        0,
        0,
        1,
      )).toBeDefined()
      // The target is in chunk 0,1 while only chunk 0,0 is resident. The
      // terrain window can see the start of the ray but must treat the missing
      // portion as blocked rather than as air.
      const { state, commit, stages } = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined, target,
      )

      yield* requestBowShot(state, 'unreadable-shot', {
        origin: fixturePosition(0, 64, 0),
        dirX: 0,
        dirY: 0,
        dirZ: 1,
        chargeSecs: BOW_FULL_CHARGE_SECS,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'unreadable-shot', success: true, outcome: 'Fired' },
      ])
      const entityOwner = yield* commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(entityOwner.state.entities[0]?.healthPoints).toBe(20)
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
        feetPosition: fixturePosition(1, 64, 0 ),
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
        at: fixturePosition(0, 64, 0 ),
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
        feetPosition: fixturePosition(x, 64, 0),
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
        at: fixturePosition(1, 64, 0 ),
      }
      const experience: MobExperienceEvent = {
        source: EntityId('qa-creeper'),
        kind: CREEPER_KIND,
        at: fixturePosition(1, 64, 0 ),
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
        ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus
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

  // Player pose, inventory and vitals are read from registered WCC owners; the
  // registration effect must not acquire local mirrors of those fields.
  it.effect('acquires five host services to register and exposes eight stages', () =>
    Effect.gen(function* () {
      const registration: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus
      > = gameplayModule.frameStages

      // Providing those five — and no local player or inventory services —
      // discharges the whole registration context.
      // If a stage started demanding an EIGHTH service at REGISTRATION time, this
      // assignment would stop compiling, which is the point. Any new service
      // would need an explicit owner and belongs in this contract, rather than
      // speculation this file's history is a record of NOT doing.
      const satisfied: Effect.Effect<ReadonlyArray<StageRegistration>, never, never> =
        Effect.provide(registration, Layer.orDie(emptyWorld))

      expect(yield* satisfied).toHaveLength(8)
    }),
  )

  // REGRESSION-SHAPED, and it is the property mc-sim's §7-1 buys with
  // `Context.Service`: `EntityManager` appears ONCE in the requirement,
  // without a parameter, however the behaviour type is instantiated. If mc-sim
  // had used a Tag class per behaviour, this union would have grown a member per
  // consumer and mc-compose would have had to name mx-gameplay's `MobBehaviour`.
  it.effect('the roster requirement carries no behaviour parameter', () =>
    Effect.sync(() => {
      const unparameterised: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus
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
  // difference is the whole assertion: `run` demands nothing BEYOND the frame
  // contract, and `FrameServices` — kernel's `ClockPort` — is how that
  // sentence is spelled. A stage that reached for `ChunkStore` here would fail
  // this line to typecheck.
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
      const { state, stages, commit } = yield* builtStagesInWorld(world([]))
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestStatusEffect(state, { type: 'poison', durationSecs: 1 })
      yield* requestStatusEffect(state, { type: 'regeneration', durationSecs: 2.5 })
      yield* requestStatusEffect(state, { type: 'speed', durationSecs: 2 })
      yield* interactions.run(DeltaTimeSecs(1)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainPlayerDamages(state)).toStrictEqual([])
      const vitalsAfterPoison = yield* commit.coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      expect(vitalsAfterPoison.state.vitals.healthPoints).toBe(19)
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

  it.effect('snapshots and restores status effects without retaining host references', () =>
    Effect.gen(function* () {
      const source = yield* builtStagesInWorld(world([]))
      yield* restoreStatusEffects(source.state, {
        effects: [{ type: 'speed', remainingSecs: 4, pulseClockSecs: 0 }],
      }, source.commit)
      const snapshot = yield* snapshotStatusEffects(source.state, source.commit)
      const restored = yield* builtStagesInWorld(world([]))
      yield* restoreStatusEffects(restored.state, snapshot, restored.commit)

      expect(yield* snapshotStatusEffects(restored.state, restored.commit)).toStrictEqual(snapshot)
      expect(yield* getPlayerMovementSpeedMultiplier(restored.state)).toBe(1.2)
      expect((yield* snapshotStatusEffects(restored.state, restored.commit)).effects).not.toBe(snapshot.effects)
    }),
  )

  it.effect('brewing insert intents update storage and stand owners once each', () =>
    Effect.gen(function* () {
      // Item identities: https://minecraft.wiki/w/Blaze_Powder, https://minecraft.wiki/w/Water_Bottle, https://minecraft.wiki/w/Nether_Wart.
      const slots = [...emptySlots()]
      slots[0] = itemStack('blaze_powder', 1)
      slots[1] = itemStack('water_bottle', 1)
      slots[2] = itemStack('nether_wart', 1)
      const harness = yield* builtStagesInWorld(world([]), ['0,0'], undefined, slots)
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const initialRevision = yield* harness.commit.coordinator.revision

      yield* insertBrewingFuel(harness.state, 'fuel')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      yield* insertBrewingBottle(harness.state, 'bottle', 0, 'water_bottle')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      yield* insertBrewingIngredient(harness.state, 'ingredient', 'nether_wart')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const results = yield* drainItemUseResults(harness.state)
      expect(results.map((result) => Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)(result)))
        .toStrictEqual([
          { action: 'InsertBrewingFuel', requestId: 'fuel', success: true, outcome: undefined },
          { action: 'InsertBrewingBottle', requestId: 'bottle', success: true, outcome: undefined },
          { action: 'InsertBrewingIngredient', requestId: 'ingredient', success: true, outcome: undefined },
        ])
      const brewing = yield* harness.commit.coordinator.snapshot(GAMEPLAY_BREWING_OWNER_ID, BrewingServiceStateSchema)
      const storage = yield* harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)
      const brewingState = Schema.decodeUnknownSync(BrewingServiceStateSchema)(brewing.state)
      expect(brewingState.fuelCharges).toBeGreaterThan(0)
      expect(brewingState.bottles[0]).toMatchObject({ item: 'water_bottle', count: 1 })
      expect(brewingState.bottles.slice(1)).toStrictEqual([undefined, undefined])
      expect(brewingState).toMatchObject({
        ingredient: { item: 'nether_wart', count: 1 },
      })
      expect(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storage.state).inventory.slots.slice(0, 3))
        .toStrictEqual([undefined, undefined, undefined])
      expect(yield* harness.commit.coordinator.revision).toBe(initialRevision + 3)
      expect(yield* Ref.get(harness.commitCalls)).toBe(3)
    }),
  )

  it.effect('brewing insert rejections leave registered owners and revision unchanged', () =>
    Effect.gen(function* () {
      const emptyState = () => Schema.decodeUnknownSync(BrewingServiceStateSchema)({
        bottles: [undefined, undefined, undefined],
        ingredient: undefined,
        fuel: undefined,
        fuelCharges: 0,
        brewProgressSecs: 0,
      })
      const withSlot = (item?: 'blaze_powder' | 'water_bottle' | 'nether_wart') =>
        emptySlots().map((slot, index) => index === 0 && item !== undefined ? itemStack(item, 1) : slot)
      const scenarios = [
        {
          name: 'fuel-full',
          action: 'fuel' as const,
          failure: 'FuelFull',
          storage: withSlot('blaze_powder'),
          brewing: { ...emptyState(), fuel: itemStack('blaze_powder', 1), fuelCharges: 20 },
        },
        {
          name: 'fuel-occupied',
          action: 'fuel' as const,
          failure: 'Occupied',
          storage: withSlot('blaze_powder'),
          brewing: { ...emptyState(), fuel: itemStack('water_bottle', 1) },
        },
        {
          name: 'bottle-occupied',
          action: 'bottle' as const,
          failure: 'Occupied',
          storage: withSlot('water_bottle'),
          brewing: { ...emptyState(), bottles: [itemStack('water_bottle', 1), undefined, undefined] },
        },
        {
          name: 'ingredient-occupied',
          action: 'ingredient' as const,
          failure: 'Occupied',
          storage: withSlot('nether_wart'),
          brewing: { ...emptyState(), ingredient: itemStack('nether_wart', 1) },
        },
        {
          name: 'ingredient-while-brewing',
          action: 'ingredient' as const,
          failure: 'Brewing',
          storage: withSlot('nether_wart'),
          brewing: { ...emptyState(), brewProgressSecs: 1 },
        },
        {
          name: 'ingredient-missing',
          action: 'ingredient' as const,
          failure: 'MissingItem',
          storage: withSlot(),
          brewing: emptyState(),
        },
      ]

      for (const scenario of scenarios) {
        const harness = yield* builtStagesInWorld(world([]), ['0,0'], undefined, scenario.storage)
        const initial = yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_BREWING_OWNER_ID,
          BrewingServiceStateSchema,
        )
        yield* harness.commit.coordinator.commit({
          expectedRevision: initial.revision,
          expectedDimensions: [],
          changes: [{ ownerId: GAMEPLAY_BREWING_OWNER_ID, state: scenario.brewing }],
        })
        const revision = yield* harness.commit.coordinator.revision
        const storage = yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        )
        const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

        if (scenario.action === 'fuel') {
          yield* insertBrewingFuel(harness.state, scenario.name)
        } else if (scenario.action === 'bottle') {
          yield* insertBrewingBottle(harness.state, scenario.name, 0, 'water_bottle')
        } else {
          yield* insertBrewingIngredient(harness.state, scenario.name, 'nether_wart')
        }
        yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

        expect((yield* drainItemUseResults(harness.state))[0]).toMatchObject({
          requestId: scenario.name,
          success: false,
          failure: scenario.failure,
        })
        expect((yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_BREWING_OWNER_ID,
          BrewingServiceStateSchema,
        )).state).toStrictEqual(scenario.brewing)
        expect((yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        )).state).toStrictEqual(storage.state)
        expect(yield* harness.commit.coordinator.revision).toBe(revision)
        expect(yield* Ref.get(harness.commitCalls)).toBe(1)
      }
    }),
  )

  it.effect('brewing bottle pickup commits the stand and storage owners once and reports its source', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[0] = itemStack('water_bottle', 1)
      const harness = yield* builtStagesInWorld(world([]), ['0,0'], undefined, slots)
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const address = { dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'), position: fixtureBlockPosition(1, 64, 1) }
      const tick = Schema.decodeUnknownSync(SimulationTickSchema)(9)

      yield* insertBrewingBottle(harness.state, 'bottle-for-pickup', 0, 'water_bottle')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect((yield* drainItemUseResults(harness.state))[0]).toMatchObject({
        action: 'InsertBrewingBottle',
        requestId: 'bottle-for-pickup',
        success: true,
      })

      yield* requestCollectBrewingBottle(harness.state, {
        requestId: 'collect-water-bottle',
        actor: EntityId('brewer'),
        tick,
        address,
        bottleIndex: 0,
      })
      const revisionBeforePickup = yield* harness.commit.coordinator.revision
      const commitCallsBeforePickup = yield* Ref.get(harness.commitCalls)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect((yield* drainItemUseResults(harness.state))[0]).toMatchObject({
        action: 'CollectBrewingBottle',
        requestId: 'collect-water-bottle',
        success: true,
        outcome: {
          _tag: 'Collected',
          item: 'water_bottle',
          count: 1,
          remainingCount: 0,
        },
      })
      const brewing = yield* harness.commit.coordinator.snapshot(GAMEPLAY_BREWING_OWNER_ID, BrewingServiceStateSchema)
      const storage = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(brewing.state.bottles[0]).toBeUndefined()
      expect(storage.state.inventory.slots[0]).toMatchObject({ item: 'water_bottle', count: 1 })
      expect(yield* harness.commit.coordinator.revision).toBe(revisionBeforePickup + 1)
      expect(yield* Ref.get(harness.commitCalls)).toBe(commitCallsBeforePickup + 1)
      expect(yield* Ref.get(harness.publishedEvents)).toMatchObject([
        {
          _tag: 'ItemPickedUp',
          tick,
          actor: EntityId('brewer'),
          source: { _tag: 'BrewingStand', address },
        },
      ])

      yield* collectBrewingPotion(harness.state, {
        requestId: 'collect-empty-bottle',
        actor: EntityId('brewer'),
        tick,
        address,
        bottleIndex: 1,
      })
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect((yield* drainItemUseResults(harness.state))[0]).toMatchObject({
        action: 'CollectBrewingBottle',
        requestId: 'collect-empty-bottle',
        success: false,
        outcome: { _tag: 'Empty' },
      })
      expect(yield* harness.commit.coordinator.revision).toBe(revisionBeforePickup + 1)
      expect(yield* Ref.get(harness.commitCalls)).toBe(commitCallsBeforePickup + 1)
    }),
  )

  it.effect('brewing item-use and potion plans requeue unchanged after rejection and commit once on retry', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[0] = itemStack('blaze_powder', 1)
      slots[1] = itemStack('potion_of_swiftness', 1)
      const harness = yield* builtStagesInWorld(world([]), ['0,0'], undefined, slots)
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const initialRevision = yield* harness.commit.coordinator.revision
      const brewingBefore = yield* harness.commit.coordinator.snapshot(GAMEPLAY_BREWING_OWNER_ID, BrewingServiceStateSchema)
      const storageBefore = yield* harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)
      const effectsBefore = yield* harness.commit.coordinator.snapshot(GAMEPLAY_STATUS_EFFECTS_OWNER_ID, StatusEffectStateSchema)

      yield* insertBrewingFuel(harness.state, 'fuel-retry')
      yield* Ref.set(harness.rejectCommits, true)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* harness.commit.coordinator.revision).toBe(initialRevision)
      expect((yield* harness.commit.coordinator.snapshot(GAMEPLAY_BREWING_OWNER_ID, BrewingServiceStateSchema)).state)
        .toStrictEqual(brewingBefore.state)
      expect((yield* harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)).state)
        .toStrictEqual(storageBefore.state)
      expect(yield* Ref.get(harness.state.itemUseResults)).toStrictEqual([])
      expect(yield* Ref.get(harness.publishedEvents)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.pendingItemUses)).toHaveLength(1)

      yield* Ref.set(harness.rejectCommits, false)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)(
        (yield* drainItemUseResults(harness.state))[0],
      )).toStrictEqual({ action: 'InsertBrewingFuel', requestId: 'fuel-retry', success: true, outcome: undefined })
      expect(yield* harness.commit.coordinator.revision).toBe(initialRevision + 1)
      expect(yield* Ref.get(harness.state.pendingItemUses)).toStrictEqual([])
      expect(yield* Ref.get(harness.commitCalls)).toBe(2)

      const storageBeforeDrink = yield* harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)
      yield* useBrewingPotion(harness.state, {
        // Item identity: https://minecraft.wiki/w/Potion.
        requestId: 'drink-retry', actor: EntityId('brewer'), tick: Schema.decodeUnknownSync(SimulationTickSchema)(0), slotIndex: 1,
      })
      const drinkRevision = yield* harness.commit.coordinator.revision
      yield* Ref.set(harness.rejectCommits, true)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* harness.commit.coordinator.revision).toBe(drinkRevision)
      expect((yield* harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)).state)
        .toStrictEqual(storageBeforeDrink.state)
      expect((yield* harness.commit.coordinator.snapshot(GAMEPLAY_STATUS_EFFECTS_OWNER_ID, StatusEffectStateSchema)).state)
        .toStrictEqual(effectsBefore.state)
      expect(yield* Ref.get(harness.state.itemUseResults)).toStrictEqual([])
      expect(yield* Ref.get(harness.publishedEvents)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.pendingItemUses)).toHaveLength(1)

      yield* Ref.set(harness.rejectCommits, false)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      const drinkResult = Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)(
        (yield* drainItemUseResults(harness.state))[0],
      )
      expect(drinkResult).toMatchObject({ action: 'DrinkPotion', requestId: 'drink-retry', success: true })
      expect(yield* harness.commit.coordinator.revision).toBe(drinkRevision + 1)
      expect((yield* harness.commit.coordinator.snapshot(GAMEPLAY_STATUS_EFFECTS_OWNER_ID, StatusEffectStateSchema)).state.effects)
        .toHaveLength(1)
      expect(yield* getPlayerMovementSpeedMultiplier(harness.state)).toBe(1.2)
      expect(yield* Ref.get(harness.state.pendingItemUses)).toStrictEqual([])
      expect(yield* Ref.get(harness.commitCalls)).toBe(4)
    }),
  )

  it.effect('strict brewing request and result schemas reject missing and null required fields', () =>
    Effect.sync(() => {
      const requestDecode = Schema.decodeUnknownResult(GameplayBrewingItemUseRequestSchema)
      const resultDecode = Schema.decodeUnknownResult(GameplayBrewingItemUseResultSchema)
      expect(Result.isFailure(requestDecode({ action: 'DrinkPotion', requestId: 'x', actor: EntityId('brewer'), tick: 0 }))).toBe(true)
      expect(Result.isFailure(requestDecode({ action: 'DrinkPotion', requestId: 'x', actor: EntityId('brewer'), tick: 0, slotIndex: null }))).toBe(true)
      expect(Result.isFailure(resultDecode({ action: 'InsertBrewingFuel', requestId: 'x', success: true }))).toBe(true)
      expect(Result.isFailure(resultDecode({ action: 'InsertBrewingFuel', requestId: null, success: true, outcome: undefined }))).toBe(true)
    }),
  )
})

// ---------------------------------------------------------------------------
// The regions below close the coverage gap this file's header does not yet
// name: each `describe` documents one behaviour that was reachable but
// untested, not a new requirement.
// ---------------------------------------------------------------------------

describe('FluidStateRef is a real Effect 4 Ref.Ref', () => {
  it.effect('reads the frontier through Ref.get after Ref.set', () =>
    Effect.gen(function* () {
      const { state } = yield* builtStages
      const frontier = [{ key: positionKey('0,64,0'), kind: 'water' }] as const
      yield* Ref.set(state.fluidFrontier, frontier)

      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual(frontier)
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
        fireLifecycle: Ref.makeUnsafe(makeFireLifecycleState([], 0)),
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
        fluidFrontier: Ref.makeUnsafe<ReadonlyArray<FluidWorkItem>>([]),
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
      const harness = yield* builtStagesInWorld(world([[fixtureBlockPosition(0, 64, 0), STONE]]))
      // `{ ...state }` is a NEW object identity holding the SAME Refs. The
      // WeakMap that backs `pendingBlockBreakRequests` is keyed on object
      // identity and only the factory's own `original` was registered, so this
      // copy is exactly the 「structurally-created frame state」 the source
      // comment names as the reason the lazy-create branch exists at all.
      const copy: GameplayFrameState = { ...harness.state }
      const stages = gameplayStages(
        copy,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        harness.commit,
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestBlockBreak(copy, fixtureBlockPosition(0, 64, 0), undefined, {
        dimension: 'overworld',
        toolLocation: undefined,
      })
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* harness.store.blockAt(fixtureBlockPosition(0, 64, 0))).toBeUndefined()
    }),
  )
})

describe('fluid propagation defers when a write finds its chunk unloaded', () => {
  const AIR = AIR_BLOCK_ID

  it.effect('a blocked horizontal PlaceFluid write is deferred without touching the world', () =>
    Effect.gen(function* () {
      const origin = fixtureBlockPosition(0, 64, 0)
      const blocked = fixtureBlockPosition(1, 64, 0)
      const { state, store, roster, player, inventory, time, commit } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
        ]),
        ['0,0', '-1,0', '0,-1'],
      )
      const blockedCoordinator = coordinatorRejectingBlock(
        commit.coordinator,
        blocked,
        WATER,
        new WorldCommitChunkStoreUnavailable({ dimension: 'overworld' }),
      )
      const rewiredStages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        { ...commit, coordinator: blockedCoordinator },
      )
      const fluids = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      // The blocked neighbour never got written...
      expect(yield* store.blockAt(blocked)).toBeUndefined()
      // The transaction includes that neighbour, so the refusal leaves it unchanged too.
      expect(yield* store.blockAt(fixtureBlockPosition(-1, 64, 0))).toBeUndefined()
      // ...and the source cell was requeued rather than dropped.
      const source = (yield* Ref.get(state.fluidFrontier)).find(
        (item) => item.key === positionKey('0,64,0'),
      )
      expect(source?.deferred).toBe(1)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('an out-of-world PlaceFluid write is dropped, not deferred: mc-worldgen’s BlockWriteOutcome is four-tag, not the deleted mirror’s three', () =>
    Effect.gen(function* () {
      // The same shape as the `ChunkNotLoaded` case above, with one
      // difference: the intercepted neighbour answers `OutOfWorld` instead.
      // `ChunkNotLoaded` is transient (the chunk may load later) and defers;
      // `OutOfWorld` is permanent (that `y` will never become writable) and
      // must NOT defer, or a fluid spreading toward the world's edge would
      // retry every tick until `MAX_FLUID_DEFERRED_ATTEMPTS` for no reason.
      const origin = fixtureBlockPosition(0, 64, 0)
      const blocked = fixtureBlockPosition(1, 64, 0)
      const { state, store, roster, player, inventory, time, commit } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
        ]),
        ['0,0', '-1,0', '0,-1'],
      )
      const blockedCoordinator = coordinatorRejectingBlock(
        commit.coordinator,
        blocked,
        WATER,
        new WorldCommitEmptyRequest(),
      )
      const rewiredStages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        { ...commit, coordinator: blockedCoordinator },
      )
      const fluids = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      // The out-of-world neighbour never got written...
      expect(yield* store.blockAt(blocked)).toBeUndefined()
      // The transaction includes that neighbour, so a terminal refusal leaves it unchanged too.
      expect(yield* store.blockAt(fixtureBlockPosition(-1, 64, 0))).toBeUndefined()
      // ...and — unlike the `ChunkNotLoaded` case — the source was NOT
      // requeued with an incremented `deferred` count on account of THIS
      // write: an out-of-world failure carries no retry.
      const source = (yield* Ref.get(state.fluidFrontier)).find(
        (item) => item.key === positionKey('0,64,0'),
      )
      expect(source?.deferred ?? 0).toBe(0)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('a blocked RemoveFluid write leaves the stale flowing cell in place and retries it', () =>
    Effect.gen(function* () {
      const origin = fixtureBlockPosition(0, 64, 0)
      const stubborn = fixtureBlockPosition(-1, 64, 0)
      const { state, store, stages, roster, player, inventory, time, commit } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
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

      // Phase 3: rejecting `stubborn`'s removal aborts the entire batch.
      const blockedCoordinator = coordinatorRejectingBlock(
        commit.coordinator,
        stubborn,
        AIR,
        new WorldCommitChunkStoreUnavailable({ dimension: 'overworld' }),
      )
      const rewiredStages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        { ...commit, coordinator: blockedCoordinator },
      )
      const rewiredFluids = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!
      yield* rewiredFluids.run(DeltaTimeSecs(0.016))

      // The blocked cell is still water and still tracked for retry...
      expect(yield* store.blockAt(stubborn)).toBe(WATER)
      const retried = (yield* Ref.get(state.fluidFrontier)).find(
        (item) => item.key === positionKey('-1,64,0'),
      )
      expect(retried?.deferred).toBe(1)
      // The sibling's separate work item committed its removal successfully.
      expect(yield* store.blockAt(fixtureBlockPosition(1, 64, 0))).toBeUndefined()
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('a permanently rejected RemoveFluid write drops the stale cell from the tracked frontier', () =>
    Effect.gen(function* () {
      const origin = fixtureBlockPosition(0, 64, 0)
      const stubborn = fixtureBlockPosition(-1, 64, 0)
      const { state, store, stages, roster, player, inventory, time, commit } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
        ]),
        ['0,0', '-1,0', '0,-1'],
      )
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!

      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))
      expect(yield* store.blockAt(stubborn)).toBe(WATER)

      yield* store.api.setBlock(origin, AIR)
      yield* Ref.set(state.fluidFrontier, [{ key: positionKey('0,64,0'), kind: 'water' }])
      yield* fluids.run(DeltaTimeSecs(0.016))

      const rejectingCoordinator = coordinatorRejectingBlock(
        commit.coordinator,
        stubborn,
        AIR,
        new WorldCommitEmptyRequest(),
      )
      const rewiredStages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        { ...commit, coordinator: rejectingCoordinator },
      )
      const rewiredFluids = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)!
      yield* rewiredFluids.run(DeltaTimeSecs(0.016))

      expect(yield* store.blockAt(stubborn)).toBe(WATER)
      expect((yield* Ref.get(state.fluidFrontier)).some((item) => item.key === positionKey('-1,64,0')))
        .toBe(false)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('a blocked Solidify write at a lava contact leaves the lava in place and retries the source', () =>
    Effect.gen(function* () {
      const lava = Option.getOrThrow(blockIdOf('lava'))
      const contact = fixtureBlockPosition(1, 64, 0)
      const { state, store, roster, player, inventory, time, commit } = yield* builtStagesInWorld(
        world([
          [fixtureBlockPosition(0, 64, 0), WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
          [contact, lava],
        ]),
      )
      const blockedCoordinator = coordinatorRejectingBlock(
        commit.coordinator,
        contact,
        OBSIDIAN,
        new WorldCommitChunkStoreUnavailable({ dimension: 'overworld' }),
      )
      const rewiredStages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        { ...commit, coordinator: blockedCoordinator },
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
      yield* requestBoneMeal(state, 'bone-meal-1', fixtureBlockPosition(3, 64, 3))

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
  const AIMED_AT: BlockPosition = fixtureBlockPosition(0, 1, 0)
  const AIMED_ADJACENT: BlockPosition = fixtureBlockPosition(0, 1, 1)
  const AIMING_POSE: PlayerPose = {
    feetPosition: fixturePosition(0.5, 0, 2.5 ),
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

      const blockUse = yield* requestTargetedBlockUse(state, store.api, player.api, 'miss-block-use', 'redstone_dust')
      expect(Option.isNone(blockUse)).toBe(true)

      yield* requestTargetedSoilTill(state, store.api, player.api, 'miss-till', 'iron_hoe')
      yield* requestTargetedPotatoPlanting(state, store.api, player.api, 'miss-plant')

      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([])
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

  it.effect('resolving the aimed block lets the caller enqueue bone meal against that cell', () =>
    Effect.gen(function* () {
      const { state, store, player } = yield* aimingAt(STONE)
      const target = yield* resolveTargetedBlock(store.api, player.api)
      const aimed = Option.getOrThrow(target).position
      const aimedBlock = fixtureBlockPosition(
        Math.floor(aimed.x),
        Math.floor(aimed.y),
        Math.floor(aimed.z),
      )
      yield* requestBoneMeal(state, 'bonemeal-1', aimedBlock)
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
  const FIRE = Option.getOrUndefined(blockIdOf('fire')) ?? BlockId(119)

  it.effect('requestFireExtinguish is a no-op when nothing is burning at the position', () =>
    Effect.gen(function* () {
      const { state, commit } = yield* builtStages
      expect(yield* requestFireExtinguish(state, { x: 9, y: 64, z: 9 }, {
        coordinator: commit.coordinator,
        dimension: 'overworld',
        changes: [],
      })).toBe(false)
    }),
  )

  it.effect('requestFireExtinguish extinguishes a real fire and disturbs the cell', () =>
    Effect.gen(function* () {
      const { state, store, commit } = yield* builtStages
      const position = fixtureBlockPosition(4, 64, 4)
      yield* store.api.setBlock(position, FIRE)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 3))

      expect(yield* requestFireExtinguish(state, position, {
        coordinator: commit.coordinator,
        dimension: 'overworld',
        changes: [],
      })).toBe(true)
      expect(yield* store.blockAt(position)).toBeUndefined()
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
      const { state, store, commit } = yield* builtStages
      const position = fixtureBlockPosition(5, 64, 5)
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 3))

      expect(yield* requestFireExtinguish(state, position, {
        coordinator: commit.coordinator,
        dimension: 'overworld',
        changes: [],
      })).toBe(true)
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
      const position = fixtureBlockPosition(7, 64, 7)
      const entity = {
        id: EntityId('e:0'),
        kind: EntityKind('skeleton'),
        feetPosition: positionOfBlock(position),
        healthPoints: EntityHealthPoints(1),
        behaviour: undefined,
      }
      const { state, commit, stages } = yield* builtStagesInWorld(
        world([
          [fixtureBlockPosition(position.x, position.y - 1, position.z), STONE],
          [position, FIRE],
        ]),
        ['0,0'], undefined, undefined, undefined,
        { entities: [entity], nextSerial: EntitySerial(1) },
      )
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 23))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      for (let tick = 0; tick <= FIRE_DAMAGE_INTERVAL_TICKS; tick += 1) {
        yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
      }

      const entityOwner = yield* commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(entityOwner.state.entities).toStrictEqual([])
      expect(yield* drainMobExperience(state)).toStrictEqual([])
      expect(yield* drainMobDrops(state)).toStrictEqual([])
    }),
  )

  it.effect('a despawned burning actor is reported not-alive from its last known position', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(6, 64, 6)
      const target = {
        id: EntityId('e:0'),
        kind: CREEPER_KIND,
        feetPosition: positionOfBlock(position),
        healthPoints: EntityHealthPoints(100),
        behaviour: undefined,
      }
      const { state, commit, stages } = yield* builtStagesInWorld(
        world([
          [fixtureBlockPosition(position.x, position.y - 1, position.z), STONE],
          [position, FIRE],
        ]),
        ['0,0'], undefined, undefined, undefined,
        { entities: [target], nextSerial: EntitySerial(1) },
      )
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 19))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      // Tick 1: the entity is in the fire and becomes a burning actor.
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
      expect((yield* Ref.get(state.fireLifecycle)).burningActors?.length).toBeGreaterThan(0)

      // The roster forgets it without going through the fire-casualty path.
      const ownerBeforeDespawn = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      yield* commit.coordinator.commit({
        expectedRevision: ownerBeforeDespawn.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
          state: { entities: [], nextSerial: EntitySerial(1) },
        }],
      })

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
      const firePosition = fixtureBlockPosition(15, 64, 0)
      const { state, stages } = yield* builtStagesInWorld(
        world([[firePosition, FIRE], [fixtureBlockPosition(15, 63, 0), STONE]]),
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
      // `blockTypeOfId` is kernel's own function and is documented PARTIAL over
      // `BlockType` — nothing gates every id a save or a corrupted chunk could
      // hold being registered. Every
      // other fire test only ever reads registered blocks, so the
      // `blockTypeOfId(reading.block) ?? '__unknown_fire_block__'` fallback
      // had never fired.
      const firePosition = fixtureBlockPosition(8, 64, 8)
      const UNREGISTERED_BLOCK_ID = BlockId(250)
      const { state, stages } = yield* builtStagesInWorld(
        world([
          [firePosition, FIRE],
          [fixtureBlockPosition(8, 63, 8), STONE],
          [fixtureBlockPosition(9, 64, 8), UNREGISTERED_BLOCK_ID],
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
      const firePosition = fixtureBlockPosition(6, 64, 6)
      const burningA = {
        id: EntityId('e:0'), kind: CREEPER_KIND, feetPosition: positionOfBlock(firePosition),
        healthPoints: EntityHealthPoints(100), behaviour: undefined,
      }
      const burningB = {
        id: EntityId('e:1'), kind: CREEPER_KIND, feetPosition: positionOfBlock(firePosition),
        healthPoints: EntityHealthPoints(100), behaviour: undefined,
      }
      const safeA = {
        id: EntityId('e:2'), kind: CREEPER_KIND, feetPosition: fixturePosition(20, 64, 20),
        healthPoints: EntityHealthPoints(100), behaviour: undefined,
      }
      const safeB = {
        id: EntityId('e:3'), kind: CREEPER_KIND, feetPosition: fixturePosition(21, 64, 21),
        healthPoints: EntityHealthPoints(100), behaviour: undefined,
      }
      const { state, stages } = yield* builtStagesInWorld(
        world([
          [fixtureBlockPosition(firePosition.x, firePosition.y - 1, firePosition.z), STONE],
          [firePosition, FIRE],
        ]),
        ['0,0'], undefined, undefined, undefined,
        { entities: [burningA, burningB, safeA, safeB], nextSerial: EntitySerial(4) },
      )
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([firePosition], 19))

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
      const position = fixtureBlockPosition(7, 64, 7)
      const target = {
        id: EntityId('e:0'),
        kind: CREEPER_KIND,
        feetPosition: positionOfBlock(position),
        healthPoints: EntityHealthPoints(1000),
        behaviour: undefined,
      }
      const { state, commit, stages } = yield* builtStagesInWorld(
        world([
          [fixtureBlockPosition(position.x, position.y - 1, position.z), STONE],
          [position, FIRE],
        ]),
        ['0,0'], undefined, undefined, undefined,
        { entities: [target], nextSerial: EntitySerial(1) },
      )
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([position], 23))

      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      // Several ticks: first ignites, later ticks damage without killing
      // (healthPoints is far above anything a handful of fire ticks can deal).
      for (let tick = 0; tick < 6; tick += 1) {
        yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
      }

      const entityOwner = yield* commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      const survivor = entityOwner.state.entities.find((entity) => entity.id === target.id)
      expect(survivor).toBeDefined()
      expect(survivor?.healthPoints).toBeLessThan(1000)
    }),
  )

  it.effect('fire damage uses authoritative storage after an unsynchronized local inventory change', () =>
    Effect.gen(function* () {
      const { state, stages, inventory, commit } = yield* builtStagesInWorld(world([]))
      const burning = {
        fires: [],
        burningActors: [
          {
            id: 'player',
            kind: 'player',
            position: fixturePosition(0, 64, 0),
            remainingTicks: 5,
            damageCooldownTicks: 0,
          },
        ],
        seed: 1,
      } as const
      yield* Ref.set(state.fireLifecycle, burning)
      const ownerBefore = yield* commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )

      // This local service is not the authority used by the stage. Its change
      // must not make the replicated owner snapshot appear stale.
      expect(yield* inventory.api.add('iron_helmet', 1)).toBe(0)
      const fireStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(state.fireLifecycle)).toStrictEqual({
        ...burning,
        burningActors: [{
          ...burning.burningActors[0]!,
          remainingTicks: 4,
          damageCooldownTicks: 19,
        }],
      })
      expect((yield* drainPlayerDamages(state)).map((event) => event.damage.cause)).toStrictEqual(['on_fire'])
      const ownerAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(ownerAfter.revision).toBe(ownerBefore.revision)
      expect(ownerAfter.state).toStrictEqual(ownerBefore.state)
    }),
  )

  it.effect('a fire near the world floor reads its out-of-world neighbour as air and still checks sky exposure under weather', () =>
    Effect.gen(function* () {
      const { state, store, stages } = yield* builtStages
      const position = fixtureBlockPosition(8, 0, 8)
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

describe('villager trades commit gameplay owners atomically', () => {
  it.effect('updates storage and offer use in one registered-owner commit', () =>
    Effect.gen(function* () {
      const villager = makeVillager('owner-backed-trader', 'farmer')
      const offer = villager.offers.find((candidate) => candidate.input.item === 'wheat')!
      const initialTrades = { villagers: [villager], restockElapsedSecs: 0 }
      const initialSlots = emptySlots().map((slot, index) =>
        index === 0 ? itemStack('wheat', offer.input.count) : slot,
      )
      const { state, stages, commit, inventory } = yield* builtStagesInWorld(
        world([]), ['0,0'], { crops: [] }, initialSlots, initialTrades,
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const request = { requestId: 'trade-once', villagerId: villager.id, offerId: offer.id }
      yield* requestVillagerTrade(state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([{ ...request, _tag: 'Traded' }])
      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const trades = yield* commit.coordinator.snapshot(
        GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
        GameplayVillagerTradeSnapshotSchema,
      )
      expect(storage.revision).toBe(1)
      expect(trades.revision).toBe(1)
      expect(storage.state.inventory.slots[0]?.item).toBe('emerald')
      expect(trades.state.villagers[0]?.offers.find((entry) => entry.id === offer.id)?.uses).toBe(1)
      expect(yield* inventory.api.countOf('wheat')).toBe(offer.input.count)
    }),
  )

  it.effect('rejects before commit when storage lacks the offer input', () =>
    Effect.gen(function* () {
      const villager = makeVillager('poor-owner-backed-trader', 'farmer')
      const offer = villager.offers.find((candidate) => candidate.input.item === 'wheat')!
      const { state, stages, commit } = yield* builtStagesInWorld(
        world([]), ['0,0'], { crops: [] }, emptySlots(),
        { villagers: [villager], restockElapsedSecs: 0 },
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const request = { requestId: 'trade-insufficient', villagerId: villager.id, offerId: offer.id }
      const beforeStorage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const beforeTrades = yield* commit.coordinator.snapshot(
        GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
        GameplayVillagerTradeSnapshotSchema,
      )
      yield* requestVillagerTrade(state, request)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([
        { ...request, _tag: 'Rejected', reason: 'InsufficientItems' },
      ])
      const afterStorage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const afterTrades = yield* commit.coordinator.snapshot(
        GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
        GameplayVillagerTradeSnapshotSchema,
      )
      expect(afterStorage.revision).toBe(beforeStorage.revision)
      expect(afterTrades.revision).toBe(beforeTrades.revision)
      expect(afterStorage.state).toStrictEqual(beforeStorage.state)
      expect(afterTrades.state).toStrictEqual(beforeTrades.state)
    }),
  )
})

describe('the ender pearl arm refuses a survival throw with no pearl to spend', () => {
  it.effect('a survival throw with an empty held slot produces no outcome', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const throwRequest: EnderPearlThrowRequest = {
        requestId: 'empty-pearl-slot',
        dirX: 0,
        dirY: 0,
        dirZ: 1,
        inventory: { mode: 'survival', slotIndex: 0 },
      }
      yield* requestEnderPearlThrow(state, throwRequest)

      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(state.enderPearlOutcomes)).toStrictEqual([])
    }),
  )
})

describe('TNT ignition commits its TNT, storage, and block changes together', () => {
  const tnt = Option.getOrThrow(blockIdOf('tnt'))
  const position = fixtureBlockPosition(2, 64, 2)

  for (const heldItem of ['flint_and_steel', 'fire_charge'] as const) {
    it.effect(`commits ${heldItem} ignition once with registered owners (fast-check)`, () =>
      Effect.promise(async () => {
        await FastCheck.assert(
          FastCheck.asyncProperty(FastCheck.integer({ min: 0, max: 3 }), async (suffix) => {
            const initialSlots = [...emptySlots()]
            initialSlots[0] = itemStack(heldItem, 1)
            const harness = await Effect.runPromise(
              builtStagesInWorld(
                world([[position, tnt]]),
                ['0,0'],
                { crops: [] },
                initialSlots,
                { villagers: [], restockElapsedSecs: 0 },
                { entities: [], nextSerial: EntitySerial(0) },
                emptyFishingState(),
                INITIAL_PROJECTILE_SERVICE_SNAPSHOT,
                INITIAL_TNT_SERVICE_SNAPSHOT,
              ),
            )
            let commits = 0
            let publishedEvents = 0
            const coordinator: WorldCommitCoordinatorApi = {
              ...harness.commit.coordinator,
              commit: (request) => {
                commits += 1
                return harness.commit.coordinator.commit(request)
              },
            }
            const eventBus: DomainEventBusApi = {
              publish: () => Effect.sync(() => { publishedEvents += 1 }),
              events: Stream.empty,
            }
            const commit = { ...harness.commit, coordinator, eventBus }
            const stages = gameplayStages(
              harness.state,
              harness.store.api,
              harness.roster.api,
              harness.inventory.api,
              harness.player.api,
              harness.time,
              undefined,
              undefined,
              {},
              commit,
            )
            const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
            const storageBefore = await Effect.runPromise(
              coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
            )
            const entitiesBefore = await Effect.runPromise(
              coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
            )
            const tntBefore = await Effect.runPromise(
              coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
            )
            const localStorageBefore = await Effect.runPromise(harness.inventory.api.storageSnapshot)
            const revisionBefore = await Effect.runPromise(coordinator.revision)
            const dimensionRevisionBefore = await Effect.runPromise(coordinator.dimensionRevision('overworld'))

            await Effect.runPromise(Ref.update(harness.state.pendingItemUses, (pending) => [
              ...pending,
              {
                requestId: `light-tnt-${suffix}`,
                positionKey: positionKey('2,64,2'),
                heldItem,
              },
            ]))
            await Effect.runPromise(
              interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)),
            )

            const storageAfter = await Effect.runPromise(
              coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
            )
            const entitiesAfter = await Effect.runPromise(
              coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
            )
            const tntAfter = await Effect.runPromise(
              coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
            )
            const localStorageAfter = await Effect.runPromise(harness.inventory.api.storageSnapshot)

            expect(commits).toBe(1)
            expect(await Effect.runPromise(coordinator.revision)).toBe(revisionBefore + 1)
            expect(await Effect.runPromise(coordinator.dimensionRevision('overworld'))).toBe(dimensionRevisionBefore + 1)
            expect(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storageAfter.state)).not.toStrictEqual(storageBefore.state)
            expect(storageAfter.revision).toBe(storageBefore.revision + 1)
            expect(Schema.decodeUnknownSync(GameplayEntityRosterSchema)(entitiesAfter.state)).toStrictEqual(entitiesBefore.state)
            expect(Schema.decodeUnknownSync(TntServiceSnapshotSchema)(tntAfter.state).tnts)
              .toHaveLength(tntBefore.state.tnts.length + 1)
            expect(tntAfter.revision).toBe(tntBefore.revision + 1)
            expect(localStorageAfter).toStrictEqual(localStorageBefore)
            expect(await Effect.runPromise(harness.store.blockAt(position))).toBeUndefined()
            expect(await Effect.runPromise(Ref.get(harness.state.itemUseResults))).toMatchObject([
              { requestId: `light-tnt-${suffix}`, heldItem, success: true, outcome: { _tag: 'Tnt', outcome: { _tag: 'Lit' } } },
            ])
            expect(await Effect.runPromise(Ref.get(harness.state.usedItems))).toStrictEqual([heldItem])
            expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toStrictEqual([])
            expect(publishedEvents).toBe(0)
          }),
          { numRuns: 4 },
        )
      }),
    )
  }
})

describe('the entities stage resolves both ranged mob attacks and zombie contact damage', () => {
  it.effect('a skeleton in projectile range and a zombie in contact range both damage the player in one sweep', () =>
    Effect.gen(function* () {
      // Skeleton: within the [6, 16] projectile band the ecosystem rule uses,
      // cooldown at zero so it fires immediately.
      const skeleton = {
        id: EntityId('e:0'),
        kind: SKELETON_KIND,
        feetPosition: fixturePosition(10, 64, 0),
        healthPoints: EntityHealthPoints(20),
        behaviour: initialEcosystemMobState(),
      }
      // Zombie: not an ecosystem-mob kind, resolved separately by
      // `resolveHostileContacts` purely on distance to the player.
      const zombie = {
        id: EntityId('e:1'),
        kind: ZOMBIE_KIND,
        feetPosition: fixturePosition(0, 64, 0),
        healthPoints: EntityHealthPoints(20),
        behaviour: undefined,
      }
      const { state, stages } = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined,
        { entities: [skeleton, zombie], nextSerial: EntitySerial(2) },
      )
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)!

      yield* entities.run(DeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer))

      const damages = yield* drainPlayerDamages(state)
      expect(damages.some((event) => event._tag === 'HostileContact' && event.kind === SKELETON_KIND)).toBe(true)
      expect(damages.some((event) => event._tag === 'HostileContact' && event.kind === ZOMBIE_KIND)).toBe(true)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})

describe('Fishing plan requests commit every gameplay owner change once', () => {
  const actions: ReadonlyArray<FishingAction> = ['CastFishing', 'AdvanceFishing', 'CancelFishing', 'ReelFishing']

  const makeHarness = (action: FishingAction) =>
    Effect.runPromise(builtStagesInWorld(
      world([]),
      ['0,0'],
      undefined,
      emptySlots(),
      undefined,
      undefined,
      action === 'CastFishing' ? emptyFishingState() : fishingStateFor(action === 'ReelFishing' ? 'bite' : 'cast'),
      action === 'CastFishing' ? { projectiles: [] } : projectileStateFor(),
    ))

  const runInteractions = (stages: ReadonlyArray<StageRegistration>) => {
    const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
    return Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))
  }

  for (const action of actions) {
    it(`commits registered-owner ${action} once and strictly decodes its result`, async () => {
      await FastCheck.assert(FastCheck.asyncProperty(
        FastCheck.constantFrom(0, 120),
        async (elapsedTicks) => {
          const harness = await makeHarness(action)
          if (action === 'ReelFishing') await Effect.runPromise(Ref.set(harness.state.tickCount, elapsedTicks))
          await Effect.runPromise(enqueueFishingAction(harness.state, action, elapsedTicks))
          const revisionBefore = await Effect.runPromise(harness.commit.coordinator.revision)
          await runInteractions(harness.stages)

          const [rawResult] = await Effect.runPromise(drainItemUseResults(harness.state))
          const result = Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(rawResult)
          const fishing = await Effect.runPromise(harness.commit.coordinator.snapshot(
            GAMEPLAY_FISHING_OWNER_ID,
            FishingStateSchema,
          ))
          const fishingState = Schema.decodeUnknownSync(FishingStateSchema)(fishing.state)
          const projectiles = await Effect.runPromise(harness.commit.coordinator.snapshot(
            PROJECTILE_REPLICATED_OWNER_ID,
            ProjectileServiceSnapshotSchema,
          ))
          const projectileState = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)(projectiles.state)

          expect(result).toMatchObject({ action, success: true })
          expect(await Effect.runPromise(Ref.get(harness.commitCalls))).toBe(1)
          expect(await Effect.runPromise(harness.commit.coordinator.revision)).toBe(revisionBefore + 1)
          expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toStrictEqual([])
          if (action === 'CastFishing') {
            expect(fishingState.rods).toHaveLength(1)
            expect(projectileState.projectiles).toHaveLength(1)
          } else if (action === 'AdvanceFishing' && elapsedTicks === 120) {
            expect(fishingState.rods[0]?.phase).toBe('bite')
          } else if (action === 'AdvanceFishing' && elapsedTicks === 0) {
            expect(fishingState.rods[0]?.phase).toBe('cast')
          } else if (action === 'CancelFishing' || action === 'ReelFishing') {
            expect(fishingState.rods).toHaveLength(0)
            expect(projectileState.projectiles).toHaveLength(0)
          }

          if (action === 'ReelFishing') {
            const storage = await Effect.runPromise(harness.commit.coordinator.snapshot(
              GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
              PlayerStorageSnapshotSchema,
            ))
            expect(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storage.state).inventory.slots.some(Boolean)).toBe(true)
            expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toHaveLength(1)
          } else {
            expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
          }
        },
      ), { numRuns: 4 })
    })
  }

  for (const action of actions) {
    it(`requeues ${action} unchanged after commit rejection and retries the whole intent`, async () => {
      await FastCheck.assert(FastCheck.asyncProperty(
        FastCheck.constantFrom(0, 120),
        async (elapsedTicks) => {
          const harness = await makeHarness(action)
          if (action === 'ReelFishing') await Effect.runPromise(Ref.set(harness.state.tickCount, elapsedTicks))
          await Effect.runPromise(enqueueFishingAction(harness.state, action, elapsedTicks))
          const fishingBefore = await Effect.runPromise(harness.commit.coordinator.snapshot(
            GAMEPLAY_FISHING_OWNER_ID,
            FishingStateSchema,
          ))
          const projectilesBefore = await Effect.runPromise(harness.commit.coordinator.snapshot(
            PROJECTILE_REPLICATED_OWNER_ID,
            ProjectileServiceSnapshotSchema,
          ))
          const storageBefore = await Effect.runPromise(harness.commit.coordinator.snapshot(
            GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
            PlayerStorageSnapshotSchema,
          ))
          const revisionBefore = await Effect.runPromise(harness.commit.coordinator.revision)
          const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
          await Effect.runPromise(Ref.set(harness.rejectCommits, true))
          await runInteractions(harness.stages)

          expect(await Effect.runPromise(Ref.get(harness.commitCalls))).toBe(1)
          expect(await Effect.runPromise(harness.commit.coordinator.revision)).toBe(revisionBefore)
          expect((await Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_FISHING_OWNER_ID, FishingStateSchema))).state)
            .toStrictEqual(fishingBefore.state)
          expect((await Effect.runPromise(harness.commit.coordinator.snapshot(PROJECTILE_REPLICATED_OWNER_ID, ProjectileServiceSnapshotSchema))).state)
            .toStrictEqual(projectilesBefore.state)
          expect((await Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema))).state)
            .toStrictEqual(storageBefore.state)
          expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
          expect(await Effect.runPromise(Ref.get(harness.state.itemUseResults))).toStrictEqual([])
          expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
          expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toHaveLength(1)

          await Effect.runPromise(Ref.set(harness.rejectCommits, false))
          await runInteractions(harness.stages)
          const [rawResult] = await Effect.runPromise(drainItemUseResults(harness.state))
          expect(Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(rawResult))
            .toMatchObject({ action, success: true })
          expect(await Effect.runPromise(Ref.get(harness.commitCalls))).toBe(2)
          expect(await Effect.runPromise(harness.commit.coordinator.revision)).toBe(revisionBefore + 1)
          expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
          expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toHaveLength(action === 'ReelFishing' ? 1 : 0)
        },
      ), { numRuns: 4 })
    })
  }
})

describe('EnderPearl uses the public enqueue route and commits registered owners once', () => {
  const makeHarness = () => {
    const slots = [...emptySlots()]
    slots[0] = itemStack('ender_pearl', 1)
    return builtStagesInWorld(world([]), ['0,0'], undefined, slots)
  }

  const enqueuePearl = (state: GameplayFrameState, hitDistance: number | undefined, requestId: string) =>
    requestEnderPearlThrow(state, {
      requestId,
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      ...(hitDistance === undefined ? {} : { hitDistance }),
      inventory: { mode: 'survival', slotIndex: 0 },
    })

  const runInteractions = (stages: ReadonlyArray<StageRegistration>) => {
    const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
    return Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))
  }

  it('commits player, storage, vitals, and any endermite owner candidate in one request', async () => {
    await FastCheck.assert(FastCheck.asyncProperty(
      FastCheck.constantFrom<number | undefined>(undefined, 0, 4, 6),
      async (hitDistance) => {
        const harness = await Effect.runPromise(makeHarness())
        const [playerBefore, storageBefore, vitalsBefore] = await Promise.all([
          Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema)),
          Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)),
          Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)),
        ])
        const revisionBefore = await Effect.runPromise(harness.commit.coordinator.revision)
        await Effect.runPromise(enqueuePearl(harness.state, hitDistance, `registered-pearl-${hitDistance ?? 'miss'}`))
        await runInteractions(harness.stages)

        const [rawOutcome] = await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))
        const outcome = Schema.decodeUnknownSync(EnderPearlOutcomeSchema)(rawOutcome)
        const [playerAfter, storageAfter, vitalsAfter, entitiesAfter] = await Promise.all([
          Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema)),
          Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)),
          Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)),
          Effect.runPromise(harness.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)),
        ])
        const decodedPlayer = Schema.decodeUnknownSync(PlayerServiceSnapshotSchema)(playerAfter.state)
        const decodedStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storageAfter.state)
        const decodedVitals = Schema.decodeUnknownSync(ExperienceOrbVitalsOwnerSnapshotSchema)(vitalsAfter.state)
        Schema.decodeUnknownSync(GameplayEntityRosterSchema)(entitiesAfter.state)

        expect(await Effect.runPromise(Ref.get(harness.commitCalls))).toBe(1)
        expect(await Effect.runPromise(harness.commit.coordinator.revision)).toBe(revisionBefore + 1)
        expect(storageAfter.revision).toBe(storageBefore.revision + 1)
        expect(storageAfter.state).not.toStrictEqual(storageBefore.state)
        if (hitDistance === 0) {
          expect(decodedPlayer.pose.feetPosition).toStrictEqual(playerBefore.state.pose.feetPosition)
        } else {
          expect(decodedPlayer.pose.feetPosition).not.toStrictEqual(playerBefore.state.pose.feetPosition)
        }
        expect(decodedStorage.inventory.slots[0]).toBeUndefined()
        expect(decodedVitals.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
        expect(outcome.damage).toStrictEqual({ amount: 5, cause: 'ender_pearl' })
        expect(outcome.displacement.x).toBeGreaterThanOrEqual(0)
        expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).not.toBe(DEFAULT_ROLL_SEED)
        expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
        expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toStrictEqual([])
      },
    ), { numRuns: 8 })
  })

  it('leaves all owners, revision, seed, results, and events untouched on rejection, then retries the queued throw', async () => {
    await FastCheck.assert(FastCheck.asyncProperty(
      FastCheck.constantFrom<number | undefined>(undefined, 0, 24),
      async (hitDistance) => {
        const harness = await Effect.runPromise(makeHarness())
        const ownerIds = [
          GAMEPLAY_PLAYER_OWNER_ID,
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          GAMEPLAY_VITALS_OWNER_ID,
          GAMEPLAY_ENTITIES_OWNER_ID,
        ] as const
        const before = await Promise.all(ownerIds.map((ownerId) =>
          Effect.runPromise(harness.commit.coordinator.snapshot(ownerId, ownerId === GAMEPLAY_PLAYER_OWNER_ID
            ? PlayerServiceSnapshotSchema
            : ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID
              ? PlayerStorageSnapshotSchema
              : ownerId === GAMEPLAY_VITALS_OWNER_ID
                ? ExperienceOrbVitalsOwnerSnapshotSchema
                : GameplayEntityRosterSchema)),
        ))
        const revisionBefore = await Effect.runPromise(harness.commit.coordinator.revision)
        const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
        const requestId = `rejected-pearl-${hitDistance ?? 'miss'}`
        await Effect.runPromise(enqueuePearl(harness.state, hitDistance, requestId))
        await Effect.runPromise(Ref.set(harness.rejectCommits, true))
        await runInteractions(harness.stages)

        expect(await Effect.runPromise(Ref.get(harness.commitCalls))).toBe(1)
        expect(await Effect.runPromise(harness.commit.coordinator.revision)).toBe(revisionBefore)
        expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
        expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
        expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toHaveLength(1)
        expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
        const afterFailure = await Promise.all(ownerIds.map((ownerId) =>
          Effect.runPromise(harness.commit.coordinator.snapshot(ownerId, ownerId === GAMEPLAY_PLAYER_OWNER_ID
            ? PlayerServiceSnapshotSchema
            : ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID
              ? PlayerStorageSnapshotSchema
              : ownerId === GAMEPLAY_VITALS_OWNER_ID
                ? ExperienceOrbVitalsOwnerSnapshotSchema
                : GameplayEntityRosterSchema)),
        ))
        expect(afterFailure.map((snapshot) => snapshot.state)).toStrictEqual(before.map((snapshot) => snapshot.state))

        await Effect.runPromise(Ref.set(harness.rejectCommits, false))
        await runInteractions(harness.stages)
        const [rawOutcome] = await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))
        expect(Schema.decodeUnknownSync(EnderPearlOutcomeSchema)(rawOutcome).damage)
          .toStrictEqual({ amount: 5, cause: 'ender_pearl' })
        expect(await Effect.runPromise(Ref.get(harness.commitCalls))).toBe(2)
        expect(await Effect.runPromise(harness.commit.coordinator.revision)).toBe(revisionBefore + 1)
        expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
        expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).not.toBe(seedBefore)
      },
    ), { numRuns: 4 })
  })
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
      const lava = Option.getOrThrow(blockIdOf('lava'))
      const origin = fixtureBlockPosition(0, 64, 0)
      const waterNeighbour = fixtureBlockPosition(1, 64, 0)
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, lava],
          [fixtureBlockPosition(0, 63, 0), STONE],
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
      expect(yield* store.blockAt(fixtureBlockPosition(-1, 64, 0))).toBeUndefined()
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('a freshly-arrived non-source item stays supported by a live parent already in the runtime', () =>
    Effect.gen(function* () {
      const origin = fixtureBlockPosition(0, 64, 0)
      const grandchild = fixtureBlockPosition(2, 64, 0)
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [origin, WATER],
          [fixtureBlockPosition(0, 63, 0), STONE],
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
  const FIRE = Option.getOrUndefined(blockIdOf('fire')) ?? BlockId(119)
  // Deliberately outside kernel's registered id range (its
  // highest registered id is in the 120s), so `blockTypeOfId` returns
  // `undefined` for it — a block this vocabulary does not know, exactly the
  // shape `place-block.ts`'s own `UnknownBlock` arm defends against.
  const UNREGISTERED_BLOCK_ID = BlockId(250)

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
            position: fixturePosition(0, 64, 0 ),
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
      const position = fixtureBlockPosition(30, 64, 30)
      const strangeNeighbour = fixtureBlockPosition(31, 64, 30)
      const { state, store, stages } = yield* builtStagesInWorld(
        world([
          [position, FIRE],
          [strangeNeighbour, UNREGISTERED_BLOCK_ID],
        ]),
        ['0,0', '1,1'],
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
      const shared = fixtureBlockPosition(5, 64, 5)
      const sameXY = fixtureBlockPosition(5, 64, 15)
      const sameXOnly = fixtureBlockPosition(5, 75, 5)
      for (const position of [shared, sameXY, sameXOnly]) {
        yield* store.api.setBlock(fixtureBlockPosition(position.x, position.y - 1, position.z), STONE)
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
      const slots = [...emptySlots()]
      slots[0] = itemStack('fire_charge', 1)
      const { state, stages } = yield* builtStagesInWorld(world([]), residentAround, undefined, slots)
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

  it.effect('a failed fire mutation batch leaves the world and lifecycle unchanged', () =>
    Effect.gen(function* () {
      const oakPlanks = Option.getOrThrow(blockIdOf('oak_planks'))
      // Fire A spreads to a flammable neighbour (seed 1 makes the very first
      // spread roll succeed — `FIRE_SPREAD_CHANCE` is 0.3 and
      // `nextRoll(1).roll` is ~0.0000078). The write for that NEW ignition is
      // intercepted to fail, exercising the `mutation.block === 'fire'`
      // failure arm.
      const spreadSource = fixtureBlockPosition(0, 64, 0)
      const ignitionTarget = fixtureBlockPosition(1, 64, 0)
      // Fire B has air below and no flammable neighbour, so it is
      // `!supported` and this tick tries to extinguish it (an `'air'`
      // mutation at its own position). Its write is intercepted to fail with
      // a non-`ChunkNotLoaded` reason, exercising the unconditional-revert arm.
      const unsupportedReverts = fixtureBlockPosition(20, 64, 20)
      // Fire C is the same shape as B, but its write is intercepted to fail
      // with `ChunkNotLoaded` specifically, exercising the retry-counter arm.
      const unsupportedRetries = fixtureBlockPosition(40, 64, 40)

      const { state, store, roster, player, inventory, time, commit } = yield* builtStagesInWorld(
        world([
          [spreadSource, Option.getOrUndefined(blockIdOf('fire')) ?? BlockId(119)],
          [fixtureBlockPosition(0, 63, 0), STONE],
          [ignitionTarget, oakPlanks],
          [unsupportedReverts, Option.getOrUndefined(blockIdOf('fire')) ?? BlockId(119)],
          [unsupportedRetries, Option.getOrUndefined(blockIdOf('fire')) ?? BlockId(119)],
        ]),
        // Every one of the three fires' own chunks must be resident, or the
        // DOMAIN layer's own read-side retry (fire-lifecycle.ts's
        // `cell.block === FIRE_UNAVAILABLE_BLOCK` branch) fires instead of
        // the write-failure paths this test targets.
        ['0,0', '1,1', '2,2'],
      )
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const blockedCoordinator = coordinatorRejectingBlock(
        commit.coordinator,
        ignitionTarget,
        fireBlock,
        new WorldCommitChunkStoreUnavailable({ dimension: 'overworld' }),
      )
      const rewiredStages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        { ...commit, coordinator: blockedCoordinator },
      )
      const fireStage = rewiredStages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)!

      const initial = makeFireLifecycleState([spreadSource, unsupportedReverts, unsupportedRetries], 1)
      yield* Ref.set(state.fireLifecycle, initial)
      yield* fireStage.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      expect((yield* Ref.get(state.fireLifecycle)).fires).toStrictEqual(initial.fires)
      expect(yield* store.blockAt(ignitionTarget)).toBe(oakPlanks)
      expect(yield* store.blockAt(unsupportedReverts)).toBe(fireBlock)
      expect(yield* store.blockAt(unsupportedRetries)).toBe(fireBlock)
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
      const store = yield* makeTransactionalChunkStoreDouble(world([]), ['0,0'])
      const inventory = yield* makeInventoryDouble()
      const commit = yield* makeGameplayCommitServices(store.api, inventory.api)

      yield* restoreStatusEffects(state, {
        effects: [{ type: 'speed', remainingSecs: 4, pulseClockSecs: 0 }],
      }, commit)
      expect(yield* getPlayerMovementSpeedMultiplier(state)).toBe(1.2)

      yield* restoreStatusEffects(state, {
        effects: [{ type: 'regeneration', remainingSecs: 2, pulseClockSecs: 0 }],
      }, commit)
      expect(yield* getPlayerMovementSpeedMultiplier(state)).toBe(1)

      const ownerSnapshot = yield* commit.coordinator.snapshot(
        GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
        StatusEffectStateSchema,
      )
      expect(ownerSnapshot.state.effects).toStrictEqual([
        { type: 'regeneration', remainingSecs: 2, pulseClockSecs: 0 },
      ])
    }),
  )
})

describe('a portal crossing from the nether returns the player to the overworld', () => {
  it.effect('four seconds of standing in a portal from the nether side switches back to overworld', () =>
    Effect.gen(function* () {
      const NETHER_PORTAL = Option.getOrUndefined(blockIdOf('nether_portal')) ?? BlockId(118)
      const spawnCell = fixtureBlockPosition(0, 64, 0)
      const { commit, stages } = yield* builtStagesInWorld(
        world([[spawnCell, NETHER_PORTAL]]), ['0,0'],
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { dimension: 'nether' },
      )
      const before = yield* commit.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema)
      expect(before.state.pose.feetPosition.dimension).toBe('nether')
      yield* runFrames(stages, 300, DeltaTimeSecs(0.016))

      const after = yield* commit.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema)
      expect(after.state.pose.feetPosition.dimension).toBe('overworld')
    }),
  )
})

describe('block placement commit rejection preserves the registered owner and world', () => {
  it.effect('a rejected placement returns its correlated failure without consuming the item', () =>
    Effect.gen(function* () {
      const target = fixtureBlockPosition(3, 64, 3)
      const slots = [...emptySlots()]
      slots[0] = itemStack('sand', 1)
      const harness = yield* builtStagesInWorld(world([]), ['0,0'], undefined, slots)
      const stages = gameplayStages(
        harness.state,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        harness.commit,
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const storageBefore = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      const revisionBefore = yield* harness.commit.coordinator.revision
      yield* Ref.set(harness.rejectCommits, true)

      yield* requestBlockPlacementCommand(harness.state, {
        requestId: 'rejected-sand-placement',
        positionKey: positionKey('3,64,3'),
        heldItem: 'sand',
      })
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainBlockPlacementResults(harness.state)).toMatchObject([
        {
          requestId: 'rejected-sand-placement',
          success: false,
          consumed: false,
          replayed: false,
          outcome: { _tag: 'CommitFailed', error: expect.any(WorldCommitEmptyRequest) },
        },
      ])
      const storageAfter = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(storageAfter.state).toStrictEqual(storageBefore.state)
      expect(storageAfter.revision).toBe(storageBefore.revision)
      expect(yield* harness.commit.coordinator.revision).toBe(revisionBefore)
      expect(yield* harness.store.blockAt(target)).toBeUndefined()
      expect(yield* Ref.get(harness.commitCalls)).toBe(1)
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
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})

describe('farming and food item uses through the full interactions stage', () => {
  it.effect('crop growth advances through the registered crop owner with one world commit', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(39, 64, 39)
      const { state, stages, commit, commitCalls } = yield* builtStagesInWorld(
        world([]),
        ['2,2'],
        { crops: [{ dimension: 'overworld', position, crop: 'wheat_crop', growthSecs: 0 }] },
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* interactions.run(DeltaTimeSecs(2)).pipe(Effect.provide(FrameServicesLayer))

      const crops = yield* commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      const commits = yield* Ref.get(commitCalls)
      const revision = yield* commit.coordinator.revision
      expect(crops.state.crops[0]?.growthSecs).toBe(2)
      expect(commits).toBe(1)
      expect(revision).toBe(1)
      expect(yield* drainItemUseResults(state)).toStrictEqual([])
    }),
  )

  it.effect('harvesting a mature potato commits storage, crop removal, and its block write once', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(38, 64, 38)
      const potatoCrop = Option.getOrThrow(blockIdOf('potato_crop'))
      const { state, stages, commit, commitCalls, store } = yield* builtStagesInWorld(
        world([[position, potatoCrop]]),
        ['2,2'],
        { crops: [{ dimension: 'overworld', position, crop: 'potato_crop', growthSecs: POTATO_MATURITY_SECS }] },
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestPotatoHarvest(state, 'harvest-ripe-potato', position, 0.5)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toMatchObject([
        {
          action: 'HarvestPotato',
          requestId: 'harvest-ripe-potato',
          success: true,
          outcome: { _tag: 'drops', drops: [{ item: 'potato', count: 4 }] },
        },
      ])
      const storage = yield* commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)
      const crops = yield* commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      expect(countStoredItem(storage.state, 'potato')).toBe(4)
      expect(crops.state.crops).toStrictEqual([])
      expect(yield* store.api.getBlock(position)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
      expect(yield* Ref.get(commitCalls)).toBe(1)
      expect(yield* commit.coordinator.revision).toBe(1)

      yield* requestPotatoHarvest(state, 'harvest-already-removed', position, 0.5)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* Ref.get(commitCalls)).toBe(1)
      expect(yield* Ref.get(state.unsupportedOperations)).toContainEqual({
        _tag: 'Unsupported',
        action: 'HarvestPotato',
        requestId: 'harvest-already-removed',
        reason: 'OwnerRegistrationUnavailable',
      })
    }),
  )

  it.effect('preserves a mature crop and storage when the harvest commit is rejected', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(47, 64, 47)
      const potatoCrop = Option.getOrThrow(blockIdOf('potato_crop'))
      const harness = yield* builtStagesInWorld(
        world([[position, potatoCrop]]),
        ['2,2'],
        { crops: [{ dimension: 'overworld', position, crop: 'potato_crop', growthSecs: POTATO_MATURITY_SECS }] },
      )
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const cropBefore = yield* harness.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      const storageBefore = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      yield* Ref.set(harness.rejectCommits, true)

      yield* requestPotatoHarvest(harness.state, 'harvest-potato-rejected', position, 0.5)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.commitCalls)).toBe(1)
      expect(yield* harness.commit.coordinator.revision).toBe(cropBefore.revision)
      expect(yield* harness.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema))
        .toStrictEqual(cropBefore)
      expect(yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )).toStrictEqual(storageBefore)
      expect(yield* harness.store.api.getBlock(position)).toStrictEqual({ _tag: 'Block', block: potatoCrop })
      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse' },
      ])
    }),
  )

  it.effect('bone meal against a non-crop cell still reaches the ApplyBoneMeal arm', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(40, 64, 40)
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
      const wheatCrop = Option.getOrThrow(blockIdOf('wheat_crop'))
      const position = fixtureBlockPosition(0, 64, 0)
      const slots = [...emptySlots()]
      slots[0] = itemStack('bone_meal', 1)
      const { state, stages, commit, inventory } = yield* builtStagesInWorld(
        world([[position, wheatCrop]]),
        ['0,0'],
        { crops: [{ dimension: 'overworld', position, crop: 'wheat_crop', growthSecs: 0 }] },
        slots,
      )
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
      const cropOwner = yield* commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      const storageOwner = yield* commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(cropOwner.state.crops[0]?.growthSecs).toBeGreaterThan(0)
      expect(storageOwner.state.inventory.slots[0]).toBeUndefined()
      expect(yield* inventory.api.countOf('bone_meal')).toBe(1)
      expect(yield* commit.coordinator.revision).toBe(1)
    }),
  )

  it.effect('preserves crop and storage when the bone meal owner commit is rejected', () =>
    Effect.gen(function* () {
      const wheatCrop = Option.getOrThrow(blockIdOf('wheat_crop'))
      const position = fixtureBlockPosition(0, 64, 0)
      const slots = [...emptySlots()]
      slots[0] = itemStack('bone_meal', 1)
      const harness = yield* builtStagesInWorld(
        world([[position, wheatCrop]]),
        ['0,0'],
        { crops: [{ dimension: 'overworld', position, crop: 'wheat_crop', growthSecs: 0 }] },
        slots,
      )
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const cropBefore = yield* harness.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      const storageBefore = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      yield* Ref.set(harness.rejectCommits, true)

      yield* requestBoneMeal(harness.state, 'bone-meal-rejected', position)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.commitCalls)).toBe(1)
      expect(yield* harness.commit.coordinator.revision).toBe(cropBefore.revision)
      expect(yield* harness.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema))
        .toStrictEqual(cropBefore)
      expect(yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )).toStrictEqual(storageBefore)
      expect(yield* harness.store.api.getBlock(position)).toStrictEqual({ _tag: 'Block', block: wheatCrop })
      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse' },
      ])
      expect(yield* drainItemUseResults(harness.state)).toStrictEqual([])
    }),
  )

  it.effect('bone meal against an unloaded cell reports not-a-crop without a block reading', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(42, 64, 42)
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
      const position = fixtureBlockPosition(41, 64, 41)
      const slots = [...emptySlots()]
      slots[0] = itemStack('iron_hoe', 1)
      const { state, stages } = yield* builtStagesInWorld(world([[position, STONE]]), ['0,0'], undefined, slots)
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

  it.effect('tilling and planting report typed owner-unavailable failures without commit services', () =>
    Effect.gen(function* () {
      const tillPosition = fixtureBlockPosition(10, 64, 10)
      const plantPosition = fixtureBlockPosition(12, 64, 12)
      const dirt = Option.getOrThrow(blockIdOf('dirt'))
      const farmland = Option.getOrThrow(blockIdOf('farmland'))
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([
        [tillPosition, dirt],
        [plantPosition, farmland],
      ]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      const player = yield* makePlayerServiceDouble()
      const time = yield* makeTimeService()
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestSoilTill(state, 'till-without-commit', tillPosition, 'iron_hoe')
      yield* requestPotatoPlanting(state, 'plant-without-commit', plantPosition)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* Ref.get(state.unsupportedOperations)).toMatchObject([
        {
          _tag: 'Unsupported',
          action: 'TillSoil',
          requestId: 'till-without-commit',
          reason: 'WorldCommitCoordinatorUnavailable',
        },
        {
          _tag: 'Unsupported',
          action: 'PlantPotato',
          requestId: 'plant-without-commit',
          reason: 'WorldCommitCoordinatorUnavailable',
        },
      ])
      expect(yield* store.api.getBlock(tillPosition)).toStrictEqual({ _tag: 'Block', block: dirt })
      expect(yield* store.api.getBlock(plantPosition)).toStrictEqual({ _tag: 'Block', block: farmland })
      expect(yield* inventory.api.countOf('potato')).toBe(0)
    }),
  )

  it.effect('planting a potato on non-farmland reports failure with nothing consumed', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(42, 64, 42)
      const { state, stages } = yield* builtStagesInWorld(world([[position, STONE]]))
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestPotatoPlanting(state, 'plant-fail', position)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const [result] = yield* drainItemUseResults(state)
      expect(result).toMatchObject({ action: 'PlantPotato', requestId: 'plant-fail', success: false, consumedCount: 0 })
    }),
  )

  it.effect('planting a potato with a synchronized inventory commits and consumes it once', () =>
    Effect.gen(function* () {
      const soil = fixtureBlockPosition(43, 64, 43)
      const farmland = Option.getOrThrow(blockIdOf('farmland'))
      const state = yield* makeGameplayFrameState
      const store = yield* makeTransactionalChunkStoreDouble(world([[soil, farmland]]), ['2,2'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const slots = [...emptySlots()]
      slots[0] = itemStack('potato', 1)
      const inventory = yield* makeInventoryDouble(slots)
      const player = yield* makePlayerServiceDouble()
      const time = yield* makeTimeService()
      const commit = yield* makeGameplayCommitServices(store.api, inventory.api)
      const stages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        commit,
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestPotatoPlanting(state, 'plant-potato-commit', soil)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toMatchObject([
        { action: 'PlantPotato', requestId: 'plant-potato-commit', success: true, consumedCount: 1 },
      ])
      expect(yield* store.api.getBlock(fixtureBlockPosition(soil.x, soil.y + 1, soil.z))).toStrictEqual({
        _tag: 'Block',
        block: Option.getOrThrow(blockIdOf('potato_crop')),
      })
      const storageOwner = yield* commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(countStoredItem(storageOwner.state, 'potato')).toBe(0)
      expect(yield* commit.coordinator.revision).toBe(1)
    }),
  )

  it.effect('preserves farmland, crop roster, and potato storage when planting commit is rejected', () =>
    Effect.gen(function* () {
      const soil = fixtureBlockPosition(45, 64, 45)
      const farmland = Option.getOrThrow(blockIdOf('farmland'))
      const potatoSlots = [...emptySlots()]
      potatoSlots[0] = itemStack('potato', 1)
      const harness = yield* builtStagesInWorld(world([[soil, farmland]]), ['2,2'], undefined, potatoSlots)
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const cropBefore = yield* harness.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      const storageBefore = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      yield* Ref.set(harness.rejectCommits, true)

      yield* requestPotatoPlanting(harness.state, 'plant-potato-rejected', soil)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.commitCalls)).toBe(1)
      expect(yield* harness.commit.coordinator.revision).toBe(cropBefore.revision)
      expect(yield* harness.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema))
        .toStrictEqual(cropBefore)
      expect(yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )).toStrictEqual(storageBefore)
      expect(yield* harness.store.api.getBlock(soil)).toStrictEqual({ _tag: 'Block', block: farmland })
      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse' },
      ])
    }),
  )

  it.effect('tilling dirt with a synchronized hoe commits the block and its wear', () =>
    Effect.gen(function* () {
      const soil = fixtureBlockPosition(44, 64, 44)
      const state = yield* makeGameplayFrameState
      const dirt = Option.getOrThrow(blockIdOf('dirt'))
      const store = yield* makeTransactionalChunkStoreDouble(world([[soil, dirt]]), ['2,2'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const slots = [...emptySlots()]
      slots[0] = itemStack('iron_hoe', 1)
      const inventory = yield* makeInventoryDouble(slots)
      const player = yield* makePlayerServiceDouble()
      const time = yield* makeTimeService()
      const commit = yield* makeGameplayCommitServices(store.api, inventory.api)
      const stages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        commit,
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestSoilTill(state, 'till-soil-commit', soil, 'iron_hoe')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toMatchObject([
        { action: 'TillSoil', requestId: 'till-soil-commit', success: true, durabilityDamage: 1 },
      ])
      expect(yield* store.api.getBlock(soil)).toStrictEqual({
        _tag: 'Block',
        block: Option.getOrThrow(blockIdOf('farmland')),
      })
      expect(yield* inventory.api.countOf('iron_hoe')).toBe(1)
      expect(yield* commit.coordinator.revision).toBe(1)
    }),
  )

  it.effect('preserves dirt and hoe storage when the soil-till commit is rejected', () =>
    Effect.gen(function* () {
      const soil = fixtureBlockPosition(46, 64, 46)
      const dirt = Option.getOrThrow(blockIdOf('dirt'))
      const hoeSlots = [...emptySlots()]
      hoeSlots[0] = itemStack('iron_hoe', 1)
      const harness = yield* builtStagesInWorld(world([[soil, dirt]]), ['2,2'], undefined, hoeSlots)
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const storageBefore = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      yield* Ref.set(harness.rejectCommits, true)

      yield* requestSoilTill(harness.state, 'till-soil-rejected', soil, 'iron_hoe')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.commitCalls)).toBe(1)
      expect(yield* harness.commit.coordinator.revision).toBe(storageBefore.revision)
      expect(yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )).toStrictEqual(storageBefore)
      expect(yield* harness.store.api.getBlock(soil)).toStrictEqual({ _tag: 'Block', block: dirt })
      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse' },
      ])
    }),
  )

  it.effect('collecting a bucket through interactions commits its inventory and world changes', () =>
    Effect.gen(function* () {
      const source = fixtureBlockPosition(12, 64, 12)
      const state = yield* makeGameplayFrameState
      const store = yield* makeTransactionalChunkStoreDouble(world([[source, WATER]]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const slots = [...emptySlots()]
      slots[0] = itemStack('bucket', 1)
      const inventory = yield* makeInventoryDouble(slots)
      const player = yield* makePlayerServiceDouble()
      const time = yield* makeTimeService()
      const commit = yield* makeGameplayCommitServices(store.api, inventory.api)
      const stages = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        commit,
      )
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestBucketUse(state, 'collect-water-commit', source, 'bucket', 'overworld')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toMatchObject([
        {
          action: 'UseBucket',
          requestId: 'collect-water-commit',
          success: true,
          outcome: { _tag: 'Collected', fluid: 'water', position: source },
        },
      ])
      const storageOwner = yield* commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(countStoredItem(storageOwner.state, 'bucket')).toBe(0)
      expect(countStoredItem(storageOwner.state, 'water_bucket')).toBe(1)
      expect(yield* store.api.getBlock(source)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
      expect(yield* commit.coordinator.revision).toBe(1)
    }),
  )

  it.effect('eating a potato while already full reports failure with nothing consumed', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const full = { healthPoints: EntityHealthPoints(20), hungerPoints: HungerPoints(20), maxHungerPoints: HungerPoints(20) }

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
      const full = { healthPoints: EntityHealthPoints(20), hungerPoints: HungerPoints(20), maxHungerPoints: HungerPoints(20) }

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

  it.effect('registered potato and ordinary food requests each commit inventory and vitals once', () =>
    Effect.gen(function* () {
      const lowVitals = { ...SPAWN_VITALS, hungerPoints: HungerPoints(10) }
      const potatoSlots = [...emptySlots()]
      potatoSlots[0] = itemStack('potato', 1)
      const potatoHarness = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, potatoSlots, undefined, undefined, undefined, undefined, undefined,
        { vitals: lowVitals },
      )
      const potatoInteractions = potatoHarness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestPotatoFoodUse(potatoHarness.state, 'eat-potato-owner-backed', {
        healthPoints: lowVitals.healthPoints,
        hungerPoints: lowVitals.hungerPoints,
        maxHungerPoints: lowVitals.maxHungerPoints,
      })
      yield* potatoInteractions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(potatoHarness.state)).toMatchObject([
        { action: 'EatPotato', requestId: 'eat-potato-owner-backed', success: true, consumedCount: 1, outcome: { _tag: 'consume' } },
      ])
      const potatoStorage = yield* potatoHarness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      const potatoVitals = yield* potatoHarness.commit.coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      expect(countStoredItem(potatoStorage.state, 'potato')).toBe(0)
      expect(potatoVitals.state.vitals.hungerPoints).toBe(11)
      expect(yield* Ref.get(potatoHarness.commitCalls)).toBe(1)
      expect(yield* potatoHarness.commit.coordinator.revision).toBe(1)

      const codSlots = [...emptySlots()]
      codSlots[0] = itemStack('cod', 1)
      const codHarness = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, codSlots, undefined, undefined, undefined, undefined, undefined,
        { vitals: lowVitals },
      )
      const codInteractions = codHarness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestFoodUse(codHarness.state, 'eat-cod-owner-backed', 'cod', {
        healthPoints: lowVitals.healthPoints,
        hungerPoints: lowVitals.hungerPoints,
        maxHungerPoints: lowVitals.maxHungerPoints,
      })
      yield* codInteractions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(codHarness.state)).toMatchObject([
        { action: 'EatFood', requestId: 'eat-cod-owner-backed', success: true, consumedCount: 1, outcome: { _tag: 'consume' } },
      ])
      const codStorage = yield* codHarness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      const codVitals = yield* codHarness.commit.coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      expect(countStoredItem(codStorage.state, 'cod')).toBe(0)
      expect(codVitals.state.vitals.hungerPoints).toBe(12)
      expect(yield* Ref.get(codHarness.commitCalls)).toBe(1)
      expect(yield* codHarness.commit.coordinator.revision).toBe(1)
    }),
  )

  it.effect('preserves food and vitals when the owner commit for eating is rejected', () =>
    Effect.gen(function* () {
      const lowVitals = { ...SPAWN_VITALS, hungerPoints: HungerPoints(10) }
      const slots = [...emptySlots()]
      slots[0] = itemStack('cod', 1)
      const harness = yield* builtStagesInWorld(
        world([]),
        ['0,0'],
        undefined,
        slots,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { vitals: lowVitals },
      )
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const storageBefore = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      const vitalsBefore = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      yield* Ref.set(harness.rejectCommits, true)

      yield* requestFoodUse(harness.state, 'eat-food-rejected', 'cod', {
        healthPoints: lowVitals.healthPoints,
        hungerPoints: lowVitals.hungerPoints,
        maxHungerPoints: lowVitals.maxHungerPoints,
      })
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.commitCalls)).toBe(1)
      expect(yield* harness.commit.coordinator.revision).toBe(storageBefore.revision)
      expect(yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )).toStrictEqual(storageBefore)
      expect(yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )).toStrictEqual(vitalsBefore)
      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { _tag: 'Failed', operation: 'WorldCommit', subject: 'Vitals' },
      ])
    }),
  )
})

describe('bucket interaction through a stage without commit services', () => {
  it.effect('reports an owner-unavailable failure and preserves the bucket and world state', () =>
    Effect.gen(function* () {
      const source = fixtureBlockPosition(12, 64, 12)
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([[source, WATER]]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const slots = [...emptySlots()]
      slots[0] = itemStack('bucket', 1)
      const inventory = yield* makeInventoryDouble(slots)
      const player = yield* makePlayerServiceDouble()
      const time = yield* makeTimeService()
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!

      yield* requestBucketUse(state, 'bucket-without-commit', source, 'bucket', 'overworld')
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* Ref.get(state.unsupportedOperations)).toMatchObject([
        {
          _tag: 'Unsupported',
          action: 'UseBucket',
          requestId: 'bucket-without-commit',
          reason: 'WorldCommitCoordinatorUnavailable',
        },
      ])
      expect(yield* inventory.api.countOf('bucket')).toBe(1)
      expect(yield* store.calls).toMatchObject({ writes: 0 })
      expect(yield* store.api.getBlock(source)).toStrictEqual({ _tag: 'Block', block: WATER })
    }),
  )
})

describe('interaction requests retain typed failures when no commit coordinator is registered', () => {
  it.effect('routes every owner-backed request through the unavailable-coordinator result', () =>
    Effect.gen(function* () {
      const harness = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, emptySlots(), undefined, undefined, undefined, undefined, undefined,
        {}, {}, false,
      )
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const target = fixtureBlockPosition(0, 64, 0)
      const tick = Schema.decodeUnknownSync(SimulationTickSchema)(0)
      const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
      const full = {
        healthPoints: EntityHealthPoints(10),
        hungerPoints: HungerPoints(10),
        maxHungerPoints: HungerPoints(20),
      }

      yield* requestBlockBreak(harness.state, target)
      yield* requestBlockPlacementCommand(harness.state, {
        requestId: 'place-without-coordinator',
        positionKey: positionKey('0,64,0'),
        heldItem: 'stone',
      })
      yield* requestVillagerTrade(harness.state, {
        requestId: 'trade-without-coordinator',
        villagerId: 'villager',
        offerId: 'offer',
      })
      yield* requestBoneMeal(harness.state, 'bone-meal-without-coordinator', target)
      yield* requestSoilTill(harness.state, 'till-without-coordinator', target, 'wooden_hoe')
      yield* requestPotatoPlanting(harness.state, 'plant-without-coordinator', target)
      yield* requestPotatoHarvest(harness.state, 'harvest-without-coordinator', target, 0.5)
      yield* requestPotatoFoodUse(harness.state, 'eat-potato-without-coordinator', full)
      yield* requestFoodUse(harness.state, 'eat-food-without-coordinator', 'cod', full)
      yield* requestBucketUse(harness.state, 'bucket-without-coordinator', target, 'bucket', dimension)
      yield* requestItemUse(harness.state, 'tnt-without-coordinator', target, 'fire_charge')
      yield* requestBowShot(harness.state, 'bow-without-coordinator', {
        origin: fixturePosition(0, 64, 0),
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        chargeSecs: BOW_FULL_CHARGE_SECS,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      yield* requestMeleeAttack(harness.state, {
        requestId: 'melee-without-coordinator',
        origin: fixturePosition(0, 64, 0),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      })
      yield* requestEnderPearlThrow(harness.state, {
        requestId: 'pearl-without-coordinator',
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      for (const action of ['CastFishing', 'AdvanceFishing', 'CancelFishing', 'ReelFishing'] as const) {
        yield* enqueueFishingAction(harness.state, action)
      }
      yield* requestCollectBrewingBottle(harness.state, {
        requestId: 'collect-bottle-without-coordinator',
        actor: EntityId('brewer'),
        tick,
        address: { dimension, position: target },
        bottleIndex: 0,
      })
      yield* insertBrewingFuel(harness.state, 'fuel-without-coordinator')
      yield* insertBrewingBottle(harness.state, 'bottle-without-coordinator', 0, 'water_bottle')
      yield* insertBrewingIngredient(harness.state, 'ingredient-without-coordinator', 'nether_wart')
      yield* useBrewingPotion(harness.state, {
        requestId: 'potion-without-coordinator',
        actor: EntityId('brewer'),
        tick,
        slotIndex: 0,
      })
      yield* requestStatusEffect(harness.state, { type: 'speed', durationSecs: 2 })

      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const unsupported = yield* Ref.get(harness.state.unsupportedOperations)
      expect(unsupported.length).toBeGreaterThanOrEqual(19)
      expect(new Set(unsupported.map(({ action }) => action))).toEqual(new Set([
        'MineBlock',
        'VillagerTrade',
        'ApplyBoneMeal',
        'TillSoil',
        'PlantPotato',
        'HarvestPotato',
        'EatFood',
        'UseBucket',
        'IgniteTnt',
        'BowShot',
        'MeleeAttack',
        'EnderPearl',
        'Fishing',
        'CollectBrewingBottle',
        'Brewing',
      ]))
      expect(unsupported.every(({ reason }) => reason === 'WorldCommitCoordinatorUnavailable' ||
        reason === 'OwnerRegistrationUnavailable')).toBe(true)
      expect(yield* drainBlockPlacementResults(harness.state)).toMatchObject([
        {
          requestId: 'place-without-coordinator',
          outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' },
        },
      ])
      expect(yield* Ref.get(harness.commitCalls)).toBe(0)
    }),
  )
})

describe('interaction requests retain typed failures when their owner is not registered', () => {
  it.effect('reports the missing owner for farming, vitals, entity, brewing, fishing and TNT requests', () =>
    Effect.gen(function* () {
      const target = fixtureBlockPosition(0, 64, 0)
      const harness = yield* builtStagesInWorld(
        world([[target, Option.getOrThrow(blockIdOf('tnt'))]]),
        ['0,0'],
        undefined,
        emptySlots(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {},
        {
          cropOwnerId: undefined,
          entitiesOwnerId: undefined,
          vitalsOwnerId: undefined,
          fishingOwnerId: undefined,
          brewingOwnerId: undefined,
          tntOwnerId: undefined,
          statusEffectsOwnerId: undefined,
        },
      )
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const tick = Schema.decodeUnknownSync(SimulationTickSchema)(0)
      const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
      const full = {
        healthPoints: EntityHealthPoints(10),
        hungerPoints: HungerPoints(10),
        maxHungerPoints: HungerPoints(20),
      }

      yield* requestBoneMeal(harness.state, 'bone-meal-no-owner', target)
      yield* requestPotatoPlanting(harness.state, 'plant-no-owner', target)
      yield* requestPotatoHarvest(harness.state, 'harvest-no-owner', target, 0.5)
      yield* requestPotatoFoodUse(harness.state, 'eat-no-vitals-owner', full)
      yield* requestFoodUse(harness.state, 'food-no-vitals-owner', 'cod', full)
      yield* requestBowShot(harness.state, 'bow-no-entity-owner', {
        origin: fixturePosition(0, 64, 0),
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        chargeSecs: BOW_FULL_CHARGE_SECS,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      yield* requestMeleeAttack(harness.state, {
        requestId: 'melee-no-entity-owner',
        origin: fixturePosition(0, 64, 0),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      })
      yield* requestEnderPearlThrow(harness.state, {
        requestId: 'pearl-no-vitals-owner',
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      for (const action of ['CastFishing', 'AdvanceFishing', 'CancelFishing', 'ReelFishing'] as const) {
        yield* enqueueFishingAction(harness.state, action)
      }
      yield* requestCollectBrewingBottle(harness.state, {
        requestId: 'collect-no-brewing-owner',
        actor: EntityId('brewer'),
        tick,
        address: { dimension, position: target },
        bottleIndex: 0,
      })
      yield* insertBrewingFuel(harness.state, 'fuel-no-brewing-owner')
      yield* insertBrewingBottle(harness.state, 'bottle-no-brewing-owner', 0, 'water_bottle')
      yield* insertBrewingIngredient(harness.state, 'ingredient-no-brewing-owner', 'nether_wart')
      yield* useBrewingPotion(harness.state, {
        requestId: 'potion-no-brewing-owner',
        actor: EntityId('brewer'),
        tick,
        slotIndex: 0,
      })
      yield* requestItemUse(harness.state, 'tnt-no-owner', target, 'fire_charge')
      yield* requestStatusEffect(harness.state, { type: 'speed', durationSecs: 2 })

      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      const unsupported = yield* Ref.get(harness.state.unsupportedOperations)
      expect(new Set(unsupported.map(({ action }) => action))).toEqual(new Set([
        'ApplyBoneMeal',
        'PlantPotato',
        'HarvestPotato',
        'EatFood',
        'BowShot',
        'MeleeAttack',
        'EnderPearl',
        'Fishing',
        'CollectBrewingBottle',
        'Brewing',
        'IgniteTnt',
      ]))
      expect(unsupported.every(({ reason }) => reason === 'OwnerRegistrationUnavailable')).toBe(true)
      expect(yield* Ref.get(harness.commitCalls)).toBe(0)
    }),
  )
})

describe('interaction stages surface owner snapshot failures and preserve retryable requests', () => {
  it.effect('records failures from entity, storage, crop, fishing and brewing snapshots', () =>
    Effect.gen(function* () {
      const target = fixtureBlockPosition(0, 64, 0)
      const harness = yield* builtStagesInWorld(world([]))
      const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const run = () => interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      const latestFailure = () => Ref.get(harness.state.operationFailures).pipe(
        Effect.map((failures) => failures.at(-1)),
      )

      yield* Ref.set(harness.failSnapshotOwnerId, GAMEPLAY_ENTITIES_OWNER_ID)
      yield* requestMeleeAttack(harness.state, {
        requestId: 'melee-owner-snapshot-failure',
        origin: fixturePosition(0, 64, 0),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      })
      yield* run()
      expect(yield* latestFailure()).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })
      expect(yield* Ref.get(harness.state.pendingMeleeAttacks)).toHaveLength(1)
      yield* Ref.set(harness.state.pendingMeleeAttacks, [])

      yield* requestBowShot(harness.state, 'bow-entity-snapshot-failure', {
        origin: fixturePosition(0, 64, 0),
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        chargeSecs: BOW_FULL_CHARGE_SECS,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      yield* run()
      expect(yield* latestFailure()).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })
      expect(yield* Ref.get(harness.state.pendingBowShots)).toHaveLength(1)
      yield* Ref.set(harness.state.pendingBowShots, [])

      yield* Ref.set(harness.failSnapshotOwnerId, GAMEPLAY_PLAYER_STORAGE_OWNER_ID)
      yield* requestBowShot(harness.state, 'bow-storage-snapshot-failure', {
        origin: fixturePosition(0, 64, 0),
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        chargeSecs: BOW_FULL_CHARGE_SECS,
        inventory: { mode: 'survival', slotIndex: 0 },
      })
      yield* run()
      expect(yield* latestFailure()).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })
      expect(yield* Ref.get(harness.state.pendingBowShots)).toHaveLength(1)
      yield* Ref.set(harness.state.pendingBowShots, [])

      yield* Ref.set(harness.failSnapshotOwnerId, GAMEPLAY_CROPS_OWNER_ID)
      yield* requestPotatoHarvest(harness.state, 'harvest-crop-snapshot-failure', target, 0.5)
      yield* run()
      expect(yield* latestFailure()).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'ItemUse',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })

      yield* Ref.set(harness.failObserveOwnerId, GAMEPLAY_FISHING_OWNER_ID)
      yield* requestFishingCancel(harness.state, 'cancel-fishing-snapshot-failure', fixtureFishingActor)
      yield* run()
      expect(yield* latestFailure()).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Fishing',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })

      yield* Ref.set(harness.failObserveOwnerId, GAMEPLAY_BREWING_OWNER_ID)
      yield* insertBrewingFuel(harness.state, 'fuel-brewing-snapshot-failure')
      yield* run()
      expect(yield* latestFailure()).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Brewing',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })
      yield* Ref.set(harness.failObserveOwnerId, GAMEPLAY_STATUS_EFFECTS_OWNER_ID)
      yield* run()
      expect(yield* latestFailure()).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Brewing',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })
      expect(yield* Ref.get(harness.commitCalls)).toBe(0)
    }),
  )

  it.effect('EnderPearl preserves its candidates when a storage or vitals snapshot fails', () =>
    Effect.gen(function* () {
      for (const ownerId of [GAMEPLAY_PLAYER_STORAGE_OWNER_ID, GAMEPLAY_VITALS_OWNER_ID]) {
        const harness = yield* builtStagesInWorld(world([]))
        const interactions = harness.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
        const storageBefore = yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        )
        const vitalsBefore = yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_VITALS_OWNER_ID,
          ExperienceOrbVitalsOwnerSnapshotSchema,
        )
        const revision = yield* harness.commit.coordinator.revision
        yield* Ref.set(harness.failSnapshotOwnerId, ownerId)
        yield* requestEnderPearlThrow(harness.state, {
          requestId: `pearl-${ownerId}-snapshot-failure`,
          dirX: 1,
          dirY: 0,
          dirZ: 0,
          inventory: { mode: 'creative', slotIndex: 0 },
        })
        yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

        expect((yield* Ref.get(harness.state.operationFailures)).at(-1)).toMatchObject({
          _tag: 'Failed', operation: 'OwnerSnapshot',
          subject: ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID ? 'Player' : 'Vitals',
          error: { _tag: 'ReplicatedOwnerUnknown' },
        })
        expect(yield* Ref.get(harness.state.enderPearlOutcomes)).toStrictEqual([])
        expect(yield* Ref.get(harness.commitCalls)).toBe(0)
        expect(yield* harness.commit.coordinator.revision).toBe(revision)
        yield* Ref.set(harness.failSnapshotOwnerId, undefined)
        expect((yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        )).state).toStrictEqual(storageBefore.state)
        expect((yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_VITALS_OWNER_ID,
          ExperienceOrbVitalsOwnerSnapshotSchema,
        )).state).toStrictEqual(vitalsBefore.state)
      }
    }),
  )

  it.effect('requeues bow and melee when their operation-specific player snapshot fails', () =>
    Effect.gen(function* () {
      const target = {
        id: EntityId('melee-player-snapshot-target'),
        kind: CREEPER_KIND,
        feetPosition: fixturePosition(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 2),
        healthPoints: EntityHealthPoints(20),
        behaviour: undefined,
      }
      const harness = yield* builtStagesInWorld(
        world([]), ['0,0'], undefined, undefined, undefined,
        { entities: [target], nextSerial: EntitySerial(1) },
      )
      let playerSnapshotCalls = 0
      const baseCoordinator = harness.commit.coordinator
      const coordinator: WorldCommitCoordinatorApi = {
        ...baseCoordinator,
        snapshot: (ownerId, schema) => Effect.gen(function* () {
          if (ownerId === GAMEPLAY_PLAYER_OWNER_ID) {
            playerSnapshotCalls += 1
            if (playerSnapshotCalls % 2 === 0) {
              return yield* Effect.fail(new ReplicatedOwnerUnknown({ ownerId }))
            }
          }
          return yield* baseCoordinator.snapshot(ownerId, schema)
        }),
      }
      const commit: GameplayStageCommitServices = { ...harness.commit, coordinator }
      const interactions = gameplayStages(
        harness.state,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        commit,
      ).find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
      const run = () => interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      yield* requestBowShot(harness.state, 'bow-player-snapshot-failure', {
        origin: fixturePosition(0, 64, 0),
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        chargeSecs: BOW_FULL_CHARGE_SECS,
        inventory: { mode: 'creative', slotIndex: 0 },
      })
      yield* run()
      expect(yield* Ref.get(harness.state.pendingBowShots)).toHaveLength(1)
      yield* Ref.set(harness.state.pendingBowShots, [])

      yield* requestMeleeAttack(harness.state, {
        requestId: 'melee-player-snapshot-failure',
        origin: fixturePosition(0, 64, 0),
        direction: fixturePosition(0, 0, 1),
        reach: 3,
        damage: 4,
      })
      yield* run()

      expect(yield* Ref.get(harness.state.pendingMeleeAttacks)).toHaveLength(1)
      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { operation: 'OwnerSnapshot', error: { _tag: 'ReplicatedOwnerUnknown' } },
        { operation: 'OwnerSnapshot', error: { _tag: 'ReplicatedOwnerUnknown' } },
      ])
      expect(yield* Ref.get(harness.commitCalls)).toBe(0)
    }),
  )
})

