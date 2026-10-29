import { describe, expect, it } from 'vitest'
import { Brand, Effect, Option, Ref, Result, Schema, Stream } from 'effect'
import * as FastCheck from 'fast-check'
import {
  AngleRadians,
  AttackRangeDistance,
  BlockAxis,
  BlockId,
  DimensionIdSchema,
  type Dimension,
  EntityHealthPoints,
  EntitySerial,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTickSchema,
  StackCount,
  WorldIdSchema,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  itemIdOf,
  position,
  DeltaTimeSecs,
  type BlockPosition,
  type ItemType,
} from '@nerima-games/mc-kernel'
import {
  BrewingServiceStateSchema,
  BrewingServiceErrorSchema,
  DomainEventBus,
  EntityId,
  EntityKind,
  FishingStateSchema,
  FishingElapsedTicksSchema,
  FishingWaitTicksSchema,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  CropSnapshotSchema,
  PlayerStorageSnapshotSchema,
  PlayerServiceSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  TNT_REPLICATED_OWNER_ID,
  SNOWBALL_PROFILE,
  WorldCommitCoordinator,
  WorldCommitEmptyRequest,
  makeBrewingService,
  makeEntityManager,
  makeFishingService,
  makeProjectileService,
  makeTimeService,
  makeWorldCommitCoordinator,
  emptyPlayerStorage,
  durabilityForItem,
  itemStack as makeItemStack,
  launchProjectile,
  type DomainEventBusApi,
  type PlayerStorage,
  type ProjectileLaunch,
  type EntityRoster,
  type ReplicatedOwnerId,
  makeReplicatedOwnerId,
  type ReplicatedOwnerUnknown,
  type ReplicatedSnapshot,
  type WorldReadSnapshot,
  type WorldCommitChunkStoreUnavailable,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
  type BrewingServiceApi,
  SPAWN_VITALS,
  HungerPoints,
  POTATO_MATURITY_SECS,
  type Vitals,
} from '@nerima-games/mc-sim'
import {
  drainItemUseResults,
  drainBlockPlacementResults,
  drainBlockUseResults,
  drainBowShotResults,
  drainMeleeAttackResults,
  drainVillagerTradeResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestBlockBreak,
  requestBoneMeal,
  requestBlockPlacementCommand,
  requestBlockUse,
  requestBowShot,
  requestEnderPearlThrow,
  requestMeleeAttack,
  requestVillagerTrade,
  requestPotatoHarvest,
  requestPotatoPlanting,
  requestSoilTill,
  requestFoodUse,
  requestItemUse,
  requestCollectBrewingBottle,
  requestFishingAdvance,
  requestFishingCancel,
  requestFishingCast,
  requestFishingReel,
  requestBlockPlacement,
  requestBucketUse,
  insertBrewingBottle,
  insertBrewingFuel,
  insertBrewingIngredient,
  useBrewingPotion,
  type GameplayFrameState,
} from '../src/stages/registration.js'
import {
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GameplayEntityRosterSchema,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  GAMEPLAY_TNT_SOURCES_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  gameplayOwnerRegistrations,
  type GameplayOwnerInitialState,
  GameplayVillagerTradeSnapshotSchema,
} from '../src/stages/gameplay-owner-registrations.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import { INITIAL_DIMENSION, INITIAL_PLAYER_POSE } from '../src/domain/in-memory-player.js'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { DroppedItemOwnerSnapshotSchema } from '../src/domain/entities/dropped-item.js'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../src/domain/entities/xp-orb.js'
import { makeVillager, type VillagerTradeState } from '../src/domain/villager-trade.js'
import { BOW_FULL_CHARGE_SECS } from '../src/domain/interactions/draw-bow.js'
import { BOW_TARGET_CENTER_Y_OFFSET } from '../src/domain/interactions/bow-shot.js'
import { StatusEffectStateSchema } from '../src/domain/status-effect.js'
import { FrameServicesLayer } from './support/frame-services.js'
import { makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { world } from './support/chunk-store-double.js'

const WORLD_ID = Schema.decodeUnknownSync(WorldIdSchema)('interaction-plan-coverage')
const DIMENSION = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const PORTAL_WINDOW_CHUNKS = [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((z) => `${x},${z}`))
const FISHER = EntityId('plan-coverage:fisher')
const OTHER_FISHER = EntityId('plan-coverage:other-fisher')
const BOBBER = Schema.decodeUnknownSync(ProjectileIdSchema)('plan-coverage:bobber')
const NEXT_BOBBER = Schema.decodeUnknownSync(ProjectileIdSchema)('plan-coverage:next-bobber')
const FISHING_LAUNCH = {
  position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: Brand.nominal<ProjectileLaunch['speed']>()(1),
}

const fishingStateWithRod = (phase: 'cast' | 'bite' = 'cast') =>
  Schema.decodeUnknownSync(FishingStateSchema)({
    rods: [{ actor: FISHER, bobber: BOBBER, phase }],
  })

const projectileStateWithBobber = () =>
  Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
    projectiles: [{
      id: BOBBER,
      dimension: DIMENSION,
      shooter: FISHER,
      kind: 'projectile',
      profile: SNOWBALL_PROFILE,
      projectile: launchProjectile({ ...FISHING_LAUNCH, shooterId: FISHER }),
    }],
  })

const combatTarget = (id: string, healthPoints = 20) => ({
  id: EntityId(id),
  kind: EntityKind('creeper'),
  dimension: DIMENSION,
  feetPosition: position(
    PositionAxis(0),
    PositionAxis(64 - BOW_TARGET_CENTER_Y_OFFSET),
    PositionAxis(2),
  ),
  healthPoints: EntityHealthPoints(healthPoints),
  behaviour: undefined,
})

const brewingStateWithBottle = (bottleIndex = 0) =>
  Schema.decodeUnknownSync(BrewingServiceStateSchema)({
    bottles: Array.from({ length: 3 }, (_, index) =>
      index === bottleIndex ? Result.getOrThrow(makeItemStack('water_bottle', StackCount(1))) : undefined,
    ),
    ingredient: undefined,
    fuel: undefined,
    fuelCharges: 0,
    brewProgressSecs: 0,
  })

const fullPlayerStorage = (): PlayerStorage => {
  const empty = emptyPlayerStorage()
  const stack = Result.getOrThrow(makeItemStack('stone', StackCount(64)))
  return {
    ...empty,
    inventory: {
      ...empty.inventory,
      slots: empty.inventory.slots.map(() => stack),
    },
  }
}

const playerStorageWithItem = (item: ItemType, count: number): PlayerStorage => {
  const empty = emptyPlayerStorage()
  const stack = Result.getOrThrow(makeItemStack(item, StackCount(count)))
  return {
    ...empty,
    inventory: {
      ...empty.inventory,
      slots: empty.inventory.slots.map((slot, index) => index === 0 ? stack : slot),
    },
  }
}

const playerStorageWithItems = (items: ReadonlyArray<readonly [ItemType, number]>): PlayerStorage => {
  const empty = emptyPlayerStorage()
  const slots = empty.inventory.slots.map((_, index) => {
    const entry = items[index]
    return entry === undefined
      ? undefined
      : Result.getOrThrow(makeItemStack(entry[0], StackCount(entry[1])))
  })
  return {
    ...empty,
    inventory: { ...empty.inventory, slots },
    inventoryDurability: slots.map((slot) => slot === undefined ? null : durabilityForItem(slot.item)),
  }
}

const makeHarness = (options: Readonly<{
  readonly fishing?: Schema.Schema.Type<typeof FishingStateSchema>
  readonly projectiles?: Schema.Schema.Type<typeof ProjectileServiceSnapshotSchema>
  readonly brewing?: Schema.Schema.Type<typeof BrewingServiceStateSchema>
  readonly playerStorage?: PlayerStorage
  readonly vitals?: Vitals
  readonly villagerTrades?: VillagerTradeState
  readonly entities?: EntityRoster<MobBehaviour>
  readonly blocks?: ReadonlyArray<readonly [BlockPosition, BlockId]>
  readonly loadedChunks?: ReadonlyArray<string>
  readonly omitProjectileOwnerId?: boolean
  readonly omitProjectileRegistration?: boolean
  readonly omitDroppedItemsOwnerId?: boolean
  readonly omitDroppedItemsRegistration?: boolean
  readonly omitInteractionEventBus?: boolean
  readonly omitBrewingRegistration?: boolean
  readonly omitPlayerStorageRegistration?: boolean
  readonly omitStatusEffectsOwnerId?: boolean
  readonly omitStatusEffectsRegistration?: boolean
  readonly omitVillagerTradesRegistration?: boolean
  readonly omitCropRegistration?: boolean
  readonly omitVillagerTradesOwnerId?: boolean
  readonly omitEntitiesOwnerId?: boolean
  readonly omitEntitiesRegistration?: boolean
  readonly omitPlayerRegistration?: boolean
  readonly omitVitalsRegistration?: boolean
  readonly omitBrewingService?: boolean
  readonly brewingServiceOverride?: (service: BrewingServiceApi) => BrewingServiceApi
  readonly playerPose?: Schema.Schema.Type<typeof PlayerServiceSnapshotSchema>['pose']
  readonly crops?: GameplayOwnerInitialState['crops']
  readonly droppedItems?: GameplayOwnerInitialState['droppedItems']
  readonly vitalsOwnerIdOverride?: ReplicatedOwnerId
  readonly commitVitalsOwnerIdOverride?: ReplicatedOwnerId
  readonly tntOwnerId?: ReplicatedOwnerId
}> = {}) => Effect.gen(function* () {
  const store = yield* makeTransactionalChunkStoreDouble(
    world(options.blocks ?? []),
    options.loadedChunks ?? ['0,0'],
  )
  const chunkStore = store.api
  const registrations = gameplayOwnerRegistrations({
    playerPose: options.playerPose ?? INITIAL_PLAYER_POSE,
    ...(options.fishing === undefined ? {} : { fishing: options.fishing }),
    ...(options.projectiles === undefined ? {} : { projectiles: options.projectiles }),
    ...(options.brewing === undefined ? {} : { brewing: options.brewing }),
    ...(options.playerStorage === undefined ? {} : { playerStorage: options.playerStorage }),
    ...(options.vitals === undefined ? {} : { vitals: options.vitals }),
    ...(options.villagerTrades === undefined ? {} : { villagerTrades: options.villagerTrades }),
    ...(options.entities === undefined ? {} : { entities: options.entities }),
    ...(options.crops === undefined ? {} : { crops: options.crops }),
    ...(options.droppedItems === undefined ? {} : { droppedItems: options.droppedItems }),
  })
  const owners = registrations.filter(({ ownerId }) =>
    !(options.omitPlayerRegistration && ownerId === GAMEPLAY_PLAYER_OWNER_ID) &&
    !(options.omitVitalsRegistration && ownerId === GAMEPLAY_VITALS_OWNER_ID) &&
    !(options.omitVillagerTradesRegistration && ownerId === GAMEPLAY_VILLAGER_TRADES_OWNER_ID) &&
    !(options.omitCropRegistration && ownerId === GAMEPLAY_CROPS_OWNER_ID) &&
    !(options.omitDroppedItemsRegistration && ownerId === GAMEPLAY_DROPPED_ITEMS_OWNER_ID) &&
    !(options.omitPlayerStorageRegistration && ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID) &&
    !(options.omitBrewingRegistration && ownerId === GAMEPLAY_BREWING_OWNER_ID) &&
    !(options.omitStatusEffectsRegistration && ownerId === GAMEPLAY_STATUS_EFFECTS_OWNER_ID) &&
    !(options.omitEntitiesRegistration && ownerId === GAMEPLAY_ENTITIES_OWNER_ID) &&
    !(options.omitProjectileRegistration && ownerId === PROJECTILE_REPLICATED_OWNER_ID),
  )
  const baseCoordinator = yield* makeWorldCommitCoordinator({
    world: WORLD_ID,
    owners,
    chunkStores: { forDimension: () => chunkStore },
  })
  let commitCalls = 0
  let rejectCommit = false
  let rejectEventPublish = false
  let lastRequest: WorldCommitRequest | undefined
  const coordinator: WorldCommitCoordinatorApi = {
    ...baseCoordinator,
    commit: (request) => {
      commitCalls += 1
      lastRequest = request
      return rejectCommit
        ? Effect.fail(new WorldCommitEmptyRequest())
        : baseCoordinator.commit(request)
    },
  }
  const publishedEvents = yield* Ref.make<ReadonlyArray<Parameters<DomainEventBusApi['publish']>[0]>>([])
  const eventBus: DomainEventBusApi = {
    publish: (event) => {
      if (!rejectEventPublish) return Ref.update(publishedEvents, (events) => [...events, event])
      const invalid = Schema.decodeUnknownResult(Schema.String)(undefined)
      if (Result.isSuccess(invalid)) return Effect.void
      return Effect.fail(invalid.failure)
    },
    events: Stream.empty,
  }
  const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
    Effect.provideService(WorldCommitCoordinator, coordinator),
    Effect.provideService(DomainEventBus, eventBus),
  )
  const baseBrewingService = yield* makeBrewingService(GAMEPLAY_BREWING_OWNER_ID)
  const brewingService = options.brewingServiceOverride?.(baseBrewingService) ?? baseBrewingService
  const projectileService = yield* makeProjectileService().pipe(
    Effect.provideService(WorldCommitCoordinator, coordinator),
    Effect.provideService(DomainEventBus, eventBus),
  )
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: options.vitalsOwnerIdOverride ?? GAMEPLAY_VITALS_OWNER_ID,
  })
  const roster = yield* makeEntityManager<MobBehaviour>()
  const time = yield* makeTimeService()
  const commit = {
    coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    cropOwnerId: GAMEPLAY_CROPS_OWNER_ID,
    ...(options.omitDroppedItemsOwnerId ? {} : { droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID }),
    vitalsOwnerId: options.commitVitalsOwnerIdOverride ?? GAMEPLAY_VITALS_OWNER_ID,
    experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
    ...(options.tntOwnerId === undefined ? {} : { tntOwnerId: options.tntOwnerId }),
    ...(options.omitVillagerTradesOwnerId ? {} : { villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID }),
    ...(options.omitEntitiesOwnerId ? {} : { entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID }),
    tntSourcesOwnerId: GAMEPLAY_TNT_SOURCES_OWNER_ID,
    brewingOwnerId: GAMEPLAY_BREWING_OWNER_ID,
    ...(options.omitStatusEffectsOwnerId ? {} : { statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID }),
    fishingOwnerId: GAMEPLAY_FISHING_OWNER_ID,
    ...(options.omitProjectileOwnerId ? {} : { projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID }),
    fishingService,
    ...(options.omitBrewingService ? {} : { brewingService }),
    projectileService,
    ...(options.omitInteractionEventBus ? {} : { eventBus }),
  }
  const interactionsWithCoordinator = (selectedCoordinator: WorldCommitCoordinatorApi) =>
    gameplayStages(
      state,
      chunkStore,
      roster,
      undefined,
      undefined,
      time,
      undefined,
      undefined,
      {},
      { ...commit, coordinator: selectedCoordinator },
    ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)!
  const interactionsWithoutCommit = gameplayStages(
    state,
    chunkStore,
    roster,
    undefined,
    undefined,
    time,
    undefined,
    undefined,
    {},
    undefined,
  ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)!
  const stages = gameplayStages(
    state,
    chunkStore,
    roster,
    undefined,
    undefined,
    time,
    undefined,
    undefined,
    {},
    commit,
  )
  const interactions = stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)!

  return {
    state,
    coordinator,
    baseCoordinator,
    store,
    stages,
    interactions,
    interactionsWithCoordinator,
    interactionsWithoutCommit,
    publishedEvents,
    commitCalls: () => commitCalls,
    lastRequest: () => lastRequest,
    rejectCommits: (reject: boolean) => { rejectCommit = reject },
    rejectEventPublishes: (reject: boolean) => { rejectEventPublish = reject },
    run: () => Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    )),
  }
})

const bumpVillagerTradeRevision = (coordinator: WorldCommitCoordinatorApi) =>
  Effect.gen(function* () {
    const trades = yield* coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    )
    const changed = Schema.decodeUnknownSync(GameplayVillagerTradeSnapshotSchema)({
      ...trades.state,
      restockElapsedSecs: trades.state.restockElapsedSecs + 1,
    })
    yield* coordinator.commit({
      expectedRevision: trades.revision,
      expectedDimensions: [],
      changes: [{ ownerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID, state: changed }],
    }).pipe(Effect.orDie)
  })

const coordinatorWithRevisionBump = (
  coordinator: WorldCommitCoordinatorApi,
  bumpBeforeOwner: ReplicatedOwnerId,
  timing: 'before' | 'after' = 'before',
): WorldCommitCoordinatorApi => {
  let injected = false
  return {
    ...coordinator,
    snapshot: <Codec extends Schema.Codec<any, any>>(
      ownerId: ReplicatedOwnerId,
      schema: Codec,
    ): Effect.Effect<
      ReplicatedSnapshot<Codec>,
      Schema.SchemaError | ReplicatedOwnerUnknown,
      Schema.Codec.DecodingServices<Codec>
    > => Effect.gen(function* () {
      if (ownerId === bumpBeforeOwner && !injected) {
        injected = true
        if (timing === 'after') {
          const snapshot = yield* coordinator.snapshot(ownerId, schema)
          yield* bumpVillagerTradeRevision(coordinator).pipe(Effect.orDie)
          return snapshot
        }
        yield* bumpVillagerTradeRevision(coordinator).pipe(Effect.orDie)
      }
      return yield* coordinator.snapshot(ownerId, schema)
    }),
  }
}

const coordinatorWithObserveRevisionBump = (
  coordinator: WorldCommitCoordinatorApi,
  bumpBeforeOwner: ReplicatedOwnerId,
  timing: 'before' | 'after' = 'before',
): WorldCommitCoordinatorApi => {
  let injected = false
  const observe: WorldCommitCoordinatorApi['observe'] = <Codec extends Schema.Codec<any, any>>(
    ownerId: ReplicatedOwnerId,
    schema: Codec,
    reads: ReadonlyArray<Readonly<{ dimension: Dimension; position: BlockPosition }>>,
  ): Effect.Effect<
    WorldReadSnapshot<Codec>,
    Schema.SchemaError | ReplicatedOwnerUnknown | WorldCommitChunkStoreUnavailable,
    Schema.Codec.DecodingServices<Codec>
  > => Effect.gen(function* () {
    if (ownerId === bumpBeforeOwner && !injected) {
      injected = true
      if (timing === 'after') {
        const snapshot = yield* coordinator.observe(ownerId, schema, reads)
        yield* bumpVillagerTradeRevision(coordinator).pipe(Effect.orDie)
        return snapshot
      }
      yield* bumpVillagerTradeRevision(coordinator).pipe(Effect.orDie)
    }
    return yield* coordinator.observe(ownerId, schema, reads)
  })
  return { ...coordinator, observe }
}

const coordinatorWithCommitRevisionBump = (
  coordinator: WorldCommitCoordinatorApi,
  revisionCoordinator: WorldCommitCoordinatorApi,
): WorldCommitCoordinatorApi => {
  let injected = false
  return {
    ...coordinator,
    commit: (request) => Effect.gen(function* () {
      if (!injected) {
        injected = true
        yield* bumpVillagerTradeRevision(revisionCoordinator).pipe(Effect.orDie)
      }
      return yield* coordinator.commit(request)
    }),
  }
}

const coordinatorWithFirstCommitFailure = (
  coordinator: WorldCommitCoordinatorApi,
): WorldCommitCoordinatorApi => {
  let injected = false
  return {
    ...coordinator,
    commit: (request) => {
      if (injected) return coordinator.commit(request)
      injected = true
      return Effect.fail(new WorldCommitEmptyRequest())
    },
  }
}

const coordinatorWithSnapshotFailure = (
  coordinator: WorldCommitCoordinatorApi,
  failOwnerId: ReplicatedOwnerId,
  skipMatchingSnapshots = 0,
): WorldCommitCoordinatorApi => {
  const unavailableOwnerId = makeReplicatedOwnerId('coverage:unavailable-snapshot-owner')
  let matchingSnapshots = 0
  return {
    ...coordinator,
    snapshot: <Codec extends Schema.Codec<any, any>>(
      ownerId: ReplicatedOwnerId,
      schema: Codec,
    ): Effect.Effect<
      ReplicatedSnapshot<Codec>,
      Schema.SchemaError | ReplicatedOwnerUnknown,
      Schema.Codec.DecodingServices<Codec>
    > => {
      if (ownerId === failOwnerId && matchingSnapshots++ >= skipMatchingSnapshots) {
        return coordinator.snapshot(unavailableOwnerId, schema)
      }
      return coordinator.snapshot(ownerId, schema)
    },
  }
}

describe('registered Fishing plans in the interactions stage', () => {
  it('uses the registered projectile owner default for Cast and commits both plans once', async () => {
    const harness = await Effect.runPromise(makeHarness({ omitProjectileOwnerId: true }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingCast(harness.state, {
      requestId: 'cast-default-projectile-owner',
      actor: FISHER,
      bobber: NEXT_BOBBER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
      dimension: INITIAL_DIMENSION,
      launch: FISHING_LAUNCH,
      profile: SNOWBALL_PROFILE,
      rod: null,
      environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
    }))

    await harness.run()

    const fishing = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectiles = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const [result] = await Effect.runPromise(drainItemUseResults(harness.state))
    expect(result).toMatchObject({ action: 'CastFishing', requestId: 'cast-default-projectile-owner', success: true })
    expect(fishing.state.rods).toStrictEqual([{ actor: FISHER, bobber: NEXT_BOBBER, phase: 'cast' }])
    expect(projectiles.state.projectiles.map(({ id }) => id)).toStrictEqual([NEXT_BOBBER])
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_FISHING_OWNER_ID,
      PROJECTILE_REPLICATED_OWNER_ID,
    ])
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
  })

  it('requeues a Cast when its fishing and projectile plans observe different owner revisions', async () => {
    const harness = await Effect.runPromise(makeHarness())
    const coordinator = coordinatorWithObserveRevisionBump(
      harness.baseCoordinator,
      PROJECTILE_REPLICATED_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const request = {
      requestId: 'cast-plan-revision-conflict',
      actor: FISHER,
      bobber: NEXT_BOBBER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
      dimension: INITIAL_DIMENSION,
      launch: FISHING_LAUNCH,
      profile: SNOWBALL_PROFILE,
      rod: null,
      environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
    }
    await Effect.runPromise(requestFishingCast(harness.state, request))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([
      { action: 'CastFishing', ...request },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing',
      error: { _tag: 'WorldCommitPlanRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
    }])
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).state.rods).toStrictEqual([])
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).state.projectiles).toStrictEqual([])
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect(harness.commitCalls()).toBe(0)
  })

  it('reports cancellation of an inactive actor as a plan failure without changing either owner', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod(),
      projectiles: projectileStateWithBobber(),
    }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    await Effect.runPromise(requestFishingCancel(harness.state, 'cancel-inactive-actor', OTHER_FISHER))

    await harness.run()

    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).toStrictEqual(fishingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toStrictEqual(projectilesBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'PlanBuild',
      subject: 'Fishing',
      error: { _tag: 'FishingInvalidState', actor: OTHER_FISHER, operation: 'cancel', reason: 'rod-not-active' },
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
  })

  it('cancels an active cast after losing water and commits rod and bobber removal once', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod(),
      projectiles: projectileStateWithBobber(),
    }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingAdvance(harness.state, {
      requestId: 'advance-lost-water',
      actor: FISHER,
      elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(120),
      waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
      approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
      biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
      environment: { hasWater: false },
    }))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'AdvanceFishing',
      requestId: 'advance-lost-water',
      success: true,
      outcome: { _tag: 'Cancelled', reason: 'LostWater', bobber: BOBBER },
    }])
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).state.rods).toStrictEqual([])
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).state.projectiles).toStrictEqual([])
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_FISHING_OWNER_ID,
      PROJECTILE_REPLICATED_OWNER_ID,
    ])
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
  })

  it('commits each valid positive fishing progress outcome and keeps the active bobber', async () => {
    const scenarios: ReadonlyArray<{
      readonly name: string
      readonly elapsedTicks: number
      readonly outcome: Readonly<Record<string, unknown>>
      readonly phase: 'cast' | 'bite'
    }> = [
      {
        name: 'waiting',
        elapsedTicks: 20,
        outcome: { _tag: 'Waiting', remainingTicks: 80 },
        phase: 'cast',
      },
      {
        name: 'approaching',
        elapsedTicks: 110,
        outcome: { _tag: 'Approaching', remainingTicks: 10 },
        phase: 'cast',
      },
      {
        name: 'bite',
        elapsedTicks: 120,
        outcome: { _tag: 'Bite', bobber: BOBBER },
        phase: 'bite',
      },
      {
        name: 'escaped',
        elapsedTicks: 140,
        outcome: { _tag: 'Escaped', bobber: BOBBER },
        phase: 'cast',
      },
    ]

    await Promise.all(scenarios.map(async (scenario) => {
      const harness = await Effect.runPromise(makeHarness({
        fishing: fishingStateWithRod(),
        projectiles: projectileStateWithBobber(),
      }))
      const projectileBefore = await Effect.runPromise(harness.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      ))
      const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
      const requestId = `advance-${scenario.name}`
      await Effect.runPromise(requestFishingAdvance(harness.state, {
        requestId,
        actor: FISHER,
        elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(scenario.elapsedTicks),
        waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
        approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
        biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
        environment: { hasWater: true },
      }))

      await harness.run()

      expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
        action: 'AdvanceFishing',
        requestId,
        success: true,
        outcome: scenario.outcome,
      }])
      expect((await Effect.runPromise(harness.coordinator.snapshot(
        GAMEPLAY_FISHING_OWNER_ID,
        FishingStateSchema,
      ))).state.rods).toStrictEqual([{ actor: FISHER, bobber: BOBBER, phase: scenario.phase }])
      const projectileAfter = await Effect.runPromise(harness.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      ))
      expect(projectileAfter.state).toStrictEqual(projectileBefore.state)
      expect(projectileAfter.revision).toBe(revisionBefore + 1)
      expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
        GAMEPLAY_FISHING_OWNER_ID,
      ])
      expect(harness.commitCalls()).toBe(1)
      expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    }))
  })

  it('commits an event-free fishing advance when no interaction event bus is registered', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod(),
      projectiles: projectileStateWithBobber(),
      omitInteractionEventBus: true,
    }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingAdvance(harness.state, {
      requestId: 'advance-without-event-bus',
      actor: FISHER,
      elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(20),
      waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
      approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
      biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
      environment: { hasWater: true },
    }))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'AdvanceFishing',
      requestId: 'advance-without-event-bus',
      success: true,
      outcome: { _tag: 'Waiting', remainingTicks: 80 },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(1)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
  })

  it('clears a cast when reeling before a bite without adding a catch to storage', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod(),
      projectiles: projectileStateWithBobber(),
    }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingReel(harness.state, 'reel-before-bite', FISHER))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'ReelFishing',
      requestId: 'reel-before-bite',
      success: true,
      outcome: { _tag: 'NoBite' },
    }])
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).state.rods).toStrictEqual([])
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).state.projectiles).toStrictEqual([])
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state.inventory.slots.every((slot) => slot === undefined)).toBe(true)
    expect(harness.commitCalls()).toBe(1)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
  })

  it('uses the registered projectile owner default for Cancel and commits the rod removal once', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod(),
      projectiles: projectileStateWithBobber(),
      omitProjectileOwnerId: true,
    }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingCancel(harness.state, 'cancel-default-projectile-owner', FISHER))

    await harness.run()

    const fishing = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectiles = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const [result] = await Effect.runPromise(drainItemUseResults(harness.state))
    expect(result).toMatchObject({
      action: 'CancelFishing',
      requestId: 'cancel-default-projectile-owner',
      success: true,
      outcome: { _tag: 'Cancelled', actor: FISHER, bobber: BOBBER },
    })
    expect(fishing.state.rods).toStrictEqual([])
    expect(projectiles.state.projectiles).toStrictEqual([])
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_FISHING_OWNER_ID,
      PROJECTILE_REPLICATED_OWNER_ID,
    ])
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
  })

  it('requeues Cancel when the active rod has no projectile entry', async () => {
    const harness = await Effect.runPromise(makeHarness({ fishing: fishingStateWithRod() }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingCancel(harness.state, 'cancel-missing-projectile', FISHER))

    await harness.run()

    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).toStrictEqual(fishingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toStrictEqual(projectilesBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([
      { action: 'CancelFishing', requestId: 'cancel-missing-projectile', actor: FISHER },
    ])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
  })

  it('requeues a caught Reel when the registered player inventory has no capacity', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod('bite'),
      projectiles: projectileStateWithBobber(),
      playerStorage: fullPlayerStorage(),
    }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(requestFishingReel(harness.state, 'reel-full-inventory', FISHER))

    await harness.run()

    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).toStrictEqual(fishingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toStrictEqual(projectilesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([
      { action: 'ReelFishing', requestId: 'reel-full-inventory', actor: FISHER },
    ])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
  })

  it('reports the fishing service rejection when casting for an actor with an active rod', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod(),
      projectiles: projectileStateWithBobber(),
    }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingCast(harness.state, {
      requestId: 'cast-active-actor',
      actor: FISHER,
      bobber: NEXT_BOBBER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(2),
      dimension: DIMENSION,
      launch: FISHING_LAUNCH,
      profile: SNOWBALL_PROFILE,
      rod: null,
      environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
    }))

    await harness.run()

    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).toStrictEqual(fishingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toStrictEqual(projectilesBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'PlanBuild',
      subject: 'Fishing',
      error: { _tag: 'FishingInvalidState' },
    }])
  })

  it('reels a catch into player storage and commits fishing, storage, and bobber removal once', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod('bite'),
      projectiles: projectileStateWithBobber(),
    }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(requestFishingReel(harness.state, 'reel-catch', FISHER))

    await harness.run()

    const fishingAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectilesAfter = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'ReelFishing',
      requestId: 'reel-catch',
      success: true,
      outcome: { _tag: 'Caught' },
    }])
    expect(fishingAfter.state.rods).toStrictEqual([])
    expect(projectilesAfter.state.projectiles).toStrictEqual([])
    expect(storageAfter.state.inventory.slots.some((slot) => slot !== undefined)).toBe(true)
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
      GAMEPLAY_FISHING_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PROJECTILE_REPLICATED_OWNER_ID,
    ]))
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect(fishingAfter.revision).toBe(fishingBefore.revision + 1)
    expect(storageAfter.revision).toBe(storageBefore.revision + 1)
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).not.toBe(seedBefore)
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toHaveLength(1)
  })

  it('requeues a caught Reel when its post-commit event has no interaction event bus', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod('bite'),
      projectiles: projectileStateWithBobber(),
      omitInteractionEventBus: true,
    }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(requestFishingReel(harness.state, 'reel-without-event-bus', FISHER))

    await harness.run()

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).toStrictEqual(fishingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toStrictEqual(projectilesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([
      { action: 'ReelFishing', requestId: 'reel-without-event-bus' },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toMatchObject([{
      _tag: 'Unsupported', action: 'Fishing', reason: 'OwnerRegistrationUnavailable',
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('rejects a cast whose valid projectile ID is already occupied', async () => {
    const harness = await Effect.runPromise(makeHarness({ projectiles: projectileStateWithBobber() }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingCast(harness.state, {
      requestId: 'cast-occupied-projectile-id',
      actor: FISHER,
      bobber: BOBBER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
      dimension: INITIAL_DIMENSION,
      launch: FISHING_LAUNCH,
      profile: SNOWBALL_PROFILE,
      rod: null,
      environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
    }))

    await harness.run()

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).toStrictEqual(fishingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toStrictEqual(projectilesBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'CandidateBuild', subject: 'Fishing', error: { _tag: 'SchemaError' },
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('reports missing projectile registration for Cast and Reel without changing the active rod', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod(),
      omitProjectileOwnerId: true,
      omitProjectileRegistration: true,
    }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingCast(harness.state, {
      requestId: 'cast-without-projectile-registration',
      actor: OTHER_FISHER,
      bobber: NEXT_BOBBER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(2),
      dimension: DIMENSION,
      launch: FISHING_LAUNCH,
      profile: SNOWBALL_PROFILE,
      rod: null,
      environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
    }))
    await Effect.runPromise(requestFishingReel(
      harness.state,
      'reel-without-projectile-registration',
      FISHER,
    ))

    await harness.run()

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).toStrictEqual(fishingBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([
      { _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: { _tag: 'ReplicatedOwnerUnknown' } },
      { _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: { _tag: 'ReplicatedOwnerUnknown' } },
    ])
    expect(harness.commitCalls()).toBe(0)
  })

  it('does not reel a caught item when player storage owner observation fails', async () => {
    const harness = await Effect.runPromise(makeHarness({
      fishing: fishingStateWithRod('bite'),
      projectiles: projectileStateWithBobber(),
      omitPlayerStorageRegistration: true,
    }))
    const fishingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(requestFishingReel(harness.state, 'reel-without-storage-owner', FISHER))

    await harness.run()

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_FISHING_OWNER_ID,
      FishingStateSchema,
    ))).toStrictEqual(fishingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toMatchObject({ state: projectilesBefore.state, revision: projectilesBefore.revision })
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(harness.commitCalls()).toBe(0)
  })
})

describe('registered Brewing bottle collection in the interactions stage', () => {
  const collectBottle = (state: GameplayFrameState, bottleIndex = 0) => requestCollectBrewingBottle(state, {
    requestId: bottleIndex === 0 ? 'collect-brewing-bottle' : `collect-brewing-bottle-${String(bottleIndex)}`,
    actor: FISHER,
    tick: Schema.decodeUnknownSync(SimulationTickSchema)(12),
    address: {
      dimension: DIMENSION,
      position: blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1)),
    },
    bottleIndex,
  })

  it('rejects a schema-valid damageable bottle stack without committing', async () => {
    const brewing = Schema.decodeUnknownSync(BrewingServiceStateSchema)({
      bottles: [Result.getOrThrow(makeItemStack('wooden_sword', StackCount(1))), undefined, undefined],
      ingredient: undefined,
      fuel: undefined,
      fuelCharges: 0,
      brewProgressSecs: 0,
    })
    const harness = await Effect.runPromise(makeHarness({ brewing }))

    await Effect.runPromise(collectBottle(harness.state))
    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'CollectBrewingBottle',
      requestId: 'collect-brewing-bottle',
      success: false,
      outcome: { _tag: 'InvalidStack' },
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('returns InventoryFull without committing or changing the stand and storage owners', async () => {
    const harness = await Effect.runPromise(makeHarness({
      brewing: brewingStateWithBottle(),
      playerStorage: fullPlayerStorage(),
    }))
    const brewingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(collectBottle(harness.state))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'CollectBrewingBottle',
      requestId: 'collect-brewing-bottle',
      success: false,
      outcome: { _tag: 'InventoryFull', item: 'water_bottle', count: 1 },
    }])
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))).toStrictEqual(brewingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
  })

  it('keeps a bottle collection pending when the post-commit event bus is unavailable', async () => {
    const harness = await Effect.runPromise(makeHarness({
      brewing: brewingStateWithBottle(),
      omitInteractionEventBus: true,
    }))
    const brewingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(collectBottle(harness.state))

    await harness.run()

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))).toStrictEqual(brewingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([
      { action: 'CollectBrewingBottle', requestId: 'collect-brewing-bottle' },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toMatchObject([{
      _tag: 'Unsupported', action: 'CollectBrewingBottle', reason: 'OwnerRegistrationUnavailable',
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('keeps the owner commit and successful result when publishing its pickup event fails', async () => {
    const harness = await Effect.runPromise(makeHarness({ brewing: brewingStateWithBottle() }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.rejectEventPublishes(true)
    await Effect.runPromise(collectBottle(harness.state))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'CollectBrewingBottle',
      requestId: 'collect-brewing-bottle',
      success: true,
      outcome: { _tag: 'Collected', item: 'water_bottle', count: 1, remainingCount: 0 },
    }])
    const brewing = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const storage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(brewing.state.bottles[0]).toBeUndefined()
    expect(storage.state.inventory.slots[0]).toMatchObject({ item: 'water_bottle', count: 1 })
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'EventPublish', subject: 'Brewing',
    }])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(1)
  })

  it('requeues bottle pickup after atomic rejection and commits both owners plus its event once on retry', async () => {
    const harness = await Effect.runPromise(makeHarness({ brewing: brewingStateWithBottle() }))
    const brewingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(collectBottle(harness.state))
    harness.rejectCommits(true)

    await harness.run()

    expect(harness.commitCalls()).toBe(1)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))).toStrictEqual(brewingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([
      { action: 'CollectBrewingBottle', requestId: 'collect-brewing-bottle' },
    ])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'WorldCommit',
      subject: 'Brewing',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])

    harness.rejectCommits(false)
    await harness.run()

    const brewingAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'CollectBrewingBottle',
      requestId: 'collect-brewing-bottle',
      success: true,
      outcome: { _tag: 'Collected', item: 'water_bottle', count: 1, remainingCount: 0 },
    }])
    expect(brewingAfter.state.bottles[0]).toBeUndefined()
    expect(storageAfter.state.inventory.slots.some((slot) => slot?.item === 'water_bottle')).toBe(true)
    expect(harness.commitCalls()).toBe(2)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_BREWING_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    ])
    expect(brewingAfter.revision).toBe(revisionBefore + 1)
    expect(storageAfter.revision).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toMatchObject([{
      _tag: 'ItemPickedUp',
      source: { _tag: 'BrewingStand', address: {
        dimension: DIMENSION,
        position: blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1)),
      } },
    }])
  })

  it('collects from each bottle slot with one atomic owner commit (fast-check)', async () => {
    await FastCheck.assert(
      FastCheck.asyncProperty(FastCheck.integer({ min: 0, max: 2 }), async (bottleIndex) => {
        const harness = await Effect.runPromise(makeHarness({ brewing: brewingStateWithBottle(bottleIndex) }))
        const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
        await Effect.runPromise(collectBottle(harness.state, bottleIndex))

        await harness.run()

        const brewing = await Effect.runPromise(harness.coordinator.snapshot(
          GAMEPLAY_BREWING_OWNER_ID,
          BrewingServiceStateSchema,
        ))
        const storage = await Effect.runPromise(harness.coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        ))
        expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
          action: 'CollectBrewingBottle',
          requestId: bottleIndex === 0 ? 'collect-brewing-bottle' : `collect-brewing-bottle-${String(bottleIndex)}`,
          success: true,
          outcome: { _tag: 'Collected', item: 'water_bottle', count: 1, remainingCount: 0 },
        }])
        expect(brewing.state.bottles[bottleIndex]).toBeUndefined()
        expect(storage.state.inventory.slots.some((slot) => slot?.item === 'water_bottle')).toBe(true)
        expect(harness.commitCalls()).toBe(1)
        expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
          GAMEPLAY_BREWING_OWNER_ID,
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        ])
        expect(harness.lastRequest()?.blockWrite).toBeUndefined()
        expect(brewing.revision).toBe(revisionBefore + 1)
        expect(storage.revision).toBe(revisionBefore + 1)
        expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
        expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toMatchObject([{
          _tag: 'ItemPickedUp',
          source: { _tag: 'BrewingStand', address: {
            dimension: DIMENSION,
            position: blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1)),
          } },
        }])
      }),
      { numRuns: 24 },
    )
  })

  it('reports an empty stand slot without changing either registered owner', async () => {
    const harness = await Effect.runPromise(makeHarness())
    const brewingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(collectBottle(harness.state))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'CollectBrewingBottle',
      requestId: 'collect-brewing-bottle',
      success: false,
      outcome: { _tag: 'Empty' },
    }])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))).toStrictEqual(brewingBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
  })

  it('records owner snapshot failures when either collection owner is unregistered', async () => {
    const scenarios: ReadonlyArray<{
      readonly requestId: string
      readonly options: Readonly<{
        readonly omitBrewingRegistration?: boolean
        readonly omitPlayerStorageRegistration?: boolean
      }>
    }> = [
      {
        requestId: 'collect-without-brewing-owner',
        options: { omitBrewingRegistration: true },
      },
      {
        requestId: 'collect-without-storage-owner',
        options: { omitPlayerStorageRegistration: true },
      },
    ]

    await Promise.all(scenarios.map(async (scenario) => {
      const harness = await Effect.runPromise(makeHarness({
        brewing: brewingStateWithBottle(),
        ...scenario.options,
      }))
      const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
      await Effect.runPromise(requestCollectBrewingBottle(harness.state, {
        requestId: scenario.requestId,
        actor: FISHER,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(13),
        address: { dimension: DIMENSION, position: blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1)) },
        bottleIndex: 0,
      }))

      await harness.run()

      expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing', error: { _tag: 'ReplicatedOwnerUnknown' },
      }])
      expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
      expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
      expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
      expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
      expect(harness.commitCalls()).toBe(0)
    }))
  })
})

describe('registered Brewing item plans in the interactions stage', () => {
  it('returns MissingItem for valid fuel and bottle requests when storage has neither item', async () => {
    const scenarios: ReadonlyArray<{
      readonly requestId: string
      readonly action: 'InsertBrewingFuel' | 'InsertBrewingBottle'
      readonly enqueue: (state: GameplayFrameState, requestId: string) => Effect.Effect<void, Schema.SchemaError>
    }> = [
      {
        requestId: 'fuel-without-blaze-powder',
        action: 'InsertBrewingFuel',
        enqueue: insertBrewingFuel,
      },
      {
        requestId: 'bottle-without-water-bottle',
        action: 'InsertBrewingBottle',
        enqueue: (state, requestId) => insertBrewingBottle(state, requestId, 0, 'water_bottle'),
      },
    ]

    await Promise.all(scenarios.map(async (scenario) => {
      const harness = await Effect.runPromise(makeHarness())
      const brewingBefore = await Effect.runPromise(harness.coordinator.snapshot(
        GAMEPLAY_BREWING_OWNER_ID,
        BrewingServiceStateSchema,
      ))
      const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      ))
      const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
      await Effect.runPromise(scenario.enqueue(harness.state, scenario.requestId))

      await harness.run()

      expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
        action: scenario.action,
        requestId: scenario.requestId,
        success: false,
        failure: 'MissingItem',
      }])
      expect(await Effect.runPromise(harness.coordinator.snapshot(
        GAMEPLAY_BREWING_OWNER_ID,
        BrewingServiceStateSchema,
      ))).toStrictEqual(brewingBefore)
      expect(await Effect.runPromise(harness.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      ))).toStrictEqual(storageBefore)
      expect(harness.commitCalls()).toBe(0)
      expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    }))
  })

  it('reports the storage snapshot failure for a valid brewing fuel request', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('blaze_powder', 1),
      omitPlayerStorageRegistration: true,
    }))
    const brewingBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(insertBrewingFuel(harness.state, 'fuel-storage-snapshot-failure'))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))).toStrictEqual(brewingBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(harness.commitCalls()).toBe(0)
  })

  it('returns typed drink failures for an empty slot and a valid non-potion item', async () => {
    const empty = emptyPlayerStorage()
    const stone = Result.getOrThrow(makeItemStack('stone', StackCount(1)))
    const storageWithStone: PlayerStorage = {
      ...empty,
      inventory: {
        ...empty.inventory,
        slots: empty.inventory.slots.map((slot, index) => index === 0 ? stone : slot),
      },
    }
    const scenarios: ReadonlyArray<{
      readonly requestId: string
      readonly playerStorage: PlayerStorage
      readonly failure: Readonly<Record<string, unknown>>
    }> = [
      {
        requestId: 'drink-empty-slot',
        playerStorage: empty,
        failure: { _tag: 'PotionDrinkEmptySlot', slotIndex: 0 },
      },
      {
        requestId: 'drink-stone',
        playerStorage: storageWithStone,
        failure: { _tag: 'PotionDrinkNotDrinkable', slotIndex: 0, item: 'stone' },
      },
    ]

    await Promise.all(scenarios.map(async (scenario) => {
      const harness = await Effect.runPromise(makeHarness({ playerStorage: scenario.playerStorage }))
      const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
      await Effect.runPromise(useBrewingPotion(harness.state, {
        requestId: scenario.requestId,
        actor: FISHER,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
        slotIndex: 0,
      }))

      await harness.run()

      expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
        action: 'DrinkPotion',
        requestId: scenario.requestId,
        success: false,
        failure: scenario.failure,
      }])
      expect(harness.commitCalls()).toBe(0)
      expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
      expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    }))
  })

  it('preserves a valid poison potion when its storage or status-effect owner is unavailable', async () => {
    const scenarios: ReadonlyArray<{
      readonly requestId: string
      readonly options: Readonly<{
        readonly omitPlayerStorageRegistration?: boolean
        readonly omitStatusEffectsOwnerId?: boolean
        readonly omitStatusEffectsRegistration?: boolean
      }>
      readonly failure: 'OwnerSnapshot' | 'Unsupported'
      readonly failureCount: number
    }> = [
      {
        requestId: 'drink-without-storage-registration',
        options: { omitPlayerStorageRegistration: true },
        failure: 'OwnerSnapshot',
        failureCount: 1,
      },
      {
        requestId: 'drink-without-status-owner-id',
        options: { omitStatusEffectsOwnerId: true },
        failure: 'Unsupported',
        failureCount: 0,
      },
      {
        requestId: 'drink-without-status-registration',
        options: { omitStatusEffectsRegistration: true },
        failure: 'OwnerSnapshot',
        failureCount: 2,
      },
    ]

    await Promise.all(scenarios.map(async (scenario) => {
      const harness = await Effect.runPromise(makeHarness({
        playerStorage: playerStorageWithItem('potion_of_poison', 1),
        ...scenario.options,
      }))
      const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
      const storageBefore = scenario.options.omitPlayerStorageRegistration
        ? undefined
        : await Effect.runPromise(harness.coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        ))
      await Effect.runPromise(useBrewingPotion(harness.state, {
        requestId: scenario.requestId,
        actor: FISHER,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(14),
        slotIndex: 0,
      }))

      await harness.run()

      if (scenario.failure === 'Unsupported') {
        expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toMatchObject([{
          _tag: 'Unsupported', action: 'Brewing', requestId: scenario.requestId,
          reason: 'OwnerRegistrationUnavailable',
        }])
      } else {
        expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject(
          Array.from({ length: scenario.failureCount }, () => ({
            _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing',
            error: { _tag: 'ReplicatedOwnerUnknown' },
          })),
        )
      }
      expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
      expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
      expect(await Effect.runPromise(Ref.get(harness.state.playerMovementSpeedMultiplier))).toBe(1)
      if (storageBefore !== undefined) {
        expect(await Effect.runPromise(harness.coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        ))).toStrictEqual(storageBefore)
      }
      expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
      expect(harness.commitCalls()).toBe(0)
    }))
  })

  it('records typed unsupported outcomes when the interaction stage has no commit context', async () => {
    const harness = await Effect.runPromise(makeHarness())
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFishingCancel(harness.state, 'cancel-without-commit', FISHER))
    await Effect.runPromise(requestFishingCast(harness.state, {
      requestId: 'cast-without-commit',
      actor: FISHER,
      bobber: NEXT_BOBBER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
      dimension: DIMENSION,
      launch: FISHING_LAUNCH,
      profile: SNOWBALL_PROFILE,
      rod: null,
      environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
    }))
    await Effect.runPromise(requestFishingAdvance(harness.state, {
      requestId: 'advance-without-commit',
      actor: FISHER,
      elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(120),
      waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
      approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
      biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
      environment: { hasWater: true },
    }))
    await Effect.runPromise(requestFishingReel(harness.state, 'reel-without-commit', FISHER))
    await Effect.runPromise(insertBrewingFuel(harness.state, 'fuel-without-commit'))
    await Effect.runPromise(insertBrewingBottle(harness.state, 'bottle-without-commit', 0, 'water_bottle'))
    await Effect.runPromise(insertBrewingIngredient(harness.state, 'ingredient-without-commit', 'nether_wart'))
    await Effect.runPromise(useBrewingPotion(harness.state, {
      requestId: 'drink-without-commit',
      actor: FISHER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
      slotIndex: 0,
    }))
    await Effect.runPromise(requestCollectBrewingBottle(harness.state, {
      requestId: 'collect-without-commit',
      actor: FISHER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
      address: { dimension: DIMENSION, position: blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1)) },
      bottleIndex: 0,
    }))
    const bowRequest = {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'creative' as const, slotIndex: 0 },
    }
    await Effect.runPromise(requestBowShot(harness.state, 'bow-without-commit', bowRequest))
    const meleeRequest = {
      requestId: 'melee-without-commit',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }
    await Effect.runPromise(requestMeleeAttack(harness.state, meleeRequest))
    await Effect.runPromise(requestBlockBreak(
      harness.state,
      blockPosition(BlockAxis(2), BlockAxis(64), BlockAxis(2)),
      undefined,
      { dimension: DIMENSION, toolLocation: undefined },
    ))
    const placePosition = blockPosition(BlockAxis(3), BlockAxis(64), BlockAxis(3))
    await Effect.runPromise(requestBlockPlacement(harness.state, {
      positionKey: blockPositionKeyOf(placePosition),
      heldItem: 'stone',
    }))
    const commandPosition = blockPosition(BlockAxis(4), BlockAxis(64), BlockAxis(3))
    await Effect.runPromise(requestBlockPlacementCommand(harness.state, {
      requestId: 'place-command-without-commit',
      positionKey: blockPositionKeyOf(commandPosition),
      heldItem: 'stone',
    }))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-without-commit',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'creative', slotIndex: 0 },
    }))

    await Effect.runPromise(harness.interactionsWithoutCommit.run(DeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toEqual(expect.arrayContaining([
      {
        _tag: 'Unsupported',
        action: 'Fishing',
        requestId: 'cancel-without-commit',
        reason: 'WorldCommitCoordinatorUnavailable',
      },
      ...['cast-without-commit', 'advance-without-commit', 'reel-without-commit'].map((requestId) => ({
        _tag: 'Unsupported',
        action: 'Fishing',
        requestId,
        reason: 'WorldCommitCoordinatorUnavailable',
      })),
      {
        _tag: 'Unsupported',
        action: 'Brewing',
        requestId: 'fuel-without-commit',
        reason: 'WorldCommitCoordinatorUnavailable',
      },
      ...['bottle-without-commit', 'ingredient-without-commit', 'drink-without-commit'].map((requestId) => ({
        _tag: 'Unsupported',
        action: 'Brewing',
        requestId,
        reason: 'WorldCommitCoordinatorUnavailable',
      })),
      {
        _tag: 'Unsupported',
        action: 'CollectBrewingBottle',
        requestId: 'collect-without-commit',
        reason: 'WorldCommitCoordinatorUnavailable',
      },
      {
        _tag: 'Unsupported',
        action: 'BowShot',
        requestId: 'bow-without-commit',
        reason: 'WorldCommitCoordinatorUnavailable',
      },
      {
        _tag: 'Unsupported',
        action: 'MeleeAttack',
        requestId: 'melee-without-commit',
        reason: 'WorldCommitCoordinatorUnavailable',
      },
      {
        _tag: 'Unsupported',
        action: 'MineBlock',
        requestId: '0',
        reason: 'WorldCommitCoordinatorUnavailable',
      },
      { _tag: 'Unsupported', action: 'PlaceBlock', reason: 'WorldCommitCoordinatorUnavailable' },
      { _tag: 'Unsupported', action: 'EnderPearl', reason: 'WorldCommitCoordinatorUnavailable' },
    ]))
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toStrictEqual([{
      ...bowRequest,
      requestId: 'bow-without-commit',
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([meleeRequest])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toStrictEqual([{
      requestId: 'place-command-without-commit',
      success: false,
      consumed: false,
      replayed: false,
      outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('requeues a potion plan after its owner commit is rejected and applies it on retry', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('potion_of_swiftness', 1),
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const request = {
      requestId: 'drink-speed-retry',
      actor: FISHER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(6),
      slotIndex: 0,
    }
    await Effect.runPromise(useBrewingPotion(harness.state, request))
    harness.rejectCommits(true)

    await harness.run()

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerMovementSpeedMultiplier))).toBe(1)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([
      { action: 'DrinkPotion', requestId: request.requestId },
    ])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'Brewing',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])
    expect(harness.commitCalls()).toBe(1)

    harness.rejectCommits(false)
    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'DrinkPotion',
      requestId: request.requestId,
      success: true,
      outcome: { _tag: 'Consumed' },
    }])
    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(storageAfter.state.inventory.slots[0]).toMatchObject({ item: 'glass_bottle', count: 1 })
    expect(await Effect.runPromise(Ref.get(harness.state.playerMovementSpeedMultiplier))).toBe(1.2)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect(harness.commitCalls()).toBe(2)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    ]))
  })

  it('consumes a water bottle without effects and applies poison without granting speed', async () => {
    const scenarios: ReadonlyArray<{
      readonly requestId: string
      readonly item: ItemType
      readonly outcome: Readonly<Record<string, unknown>>
      readonly statusEffects: ReadonlyArray<Readonly<Record<string, unknown>>>
      readonly changedOwners: ReadonlyArray<ReplicatedOwnerId>
    }> = [
      {
        requestId: 'drink-water-without-effect',
        item: 'water_bottle',
        outcome: { _tag: 'ConsumedWithoutEffect', item: 'water_bottle' },
        statusEffects: [],
        changedOwners: [GAMEPLAY_PLAYER_STORAGE_OWNER_ID],
      },
      {
        requestId: 'drink-poison-without-speed',
        item: 'potion_of_poison',
        outcome: {
          _tag: 'Consumed',
          item: 'potion_of_poison',
          effect: { type: 'poison', durationSecs: 45, amplifier: 0 },
        },
        statusEffects: [{ type: 'poison', remainingSecs: 45, pulseClockSecs: 0, amplifier: 0 }],
        changedOwners: [GAMEPLAY_PLAYER_STORAGE_OWNER_ID, GAMEPLAY_STATUS_EFFECTS_OWNER_ID],
      },
    ]

    await Promise.all(scenarios.map(async (scenario) => {
      const harness = await Effect.runPromise(makeHarness({
        playerStorage: playerStorageWithItem(scenario.item, 1),
      }))
      const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
      await Effect.runPromise(useBrewingPotion(harness.state, {
        requestId: scenario.requestId,
        actor: FISHER,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(7),
        slotIndex: 0,
      }))

      await harness.run()

      expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
        action: 'DrinkPotion',
        requestId: scenario.requestId,
        success: true,
        outcome: scenario.outcome,
      }])
      const storage = await Effect.runPromise(harness.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      ))
      const status = await Effect.runPromise(harness.coordinator.snapshot(
        GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
        StatusEffectStateSchema,
      ))
      expect(storage.state.inventory.slots[0]).toMatchObject({ item: 'glass_bottle', count: 1 })
      expect(status.state.effects).toStrictEqual(scenario.statusEffects)
      expect(status.revision).toBe(revisionBefore + 1)
      expect(await Effect.runPromise(Ref.get(harness.state.playerMovementSpeedMultiplier))).toBe(1)
      expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual(scenario.changedOwners)
      expect(harness.commitCalls()).toBe(1)
      expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
      expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toMatchObject([{
        _tag: 'ItemConsumed',
        actor: FISHER,
        item: itemIdOf(scenario.item),
        tick: 7,
        use: 'potion',
      }])
    }))
  })

  it('commits fuel, bottle, ingredient, and potion effects with their registered owner candidates', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItems([
        ['blaze_powder', 1],
        ['water_bottle', 1],
        ['nether_wart', 1],
        ['potion_of_swiftness', 1],
      ]),
    }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await Effect.runPromise(insertBrewingFuel(harness.state, 'insert-fuel-success'))
    await harness.run()
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'InsertBrewingFuel',
      requestId: 'insert-fuel-success',
      success: true,
      outcome: undefined,
    }])
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
      GAMEPLAY_BREWING_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    ]))

    await Effect.runPromise(insertBrewingBottle(harness.state, 'insert-bottle-success', 0, 'water_bottle'))
    await harness.run()
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'InsertBrewingBottle',
      requestId: 'insert-bottle-success',
      success: true,
      outcome: undefined,
    }])

    await Effect.runPromise(insertBrewingIngredient(harness.state, 'insert-ingredient-success', 'nether_wart'))
    await harness.run()
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'InsertBrewingIngredient',
      requestId: 'insert-ingredient-success',
      success: true,
      outcome: undefined,
    }])

    await Effect.runPromise(useBrewingPotion(harness.state, {
      requestId: 'drink-speed-potion',
      actor: FISHER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(5),
      slotIndex: 3,
    }))
    await harness.run()
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'DrinkPotion',
      requestId: 'drink-speed-potion',
      success: true,
      outcome: { _tag: 'Consumed' },
    }])

    const brewing = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const storage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(brewing.state.fuelCharges).toBeGreaterThan(0)
    expect(brewing.state.bottles[0]).toMatchObject({ item: 'water_bottle', count: 1 })
    expect(brewing.state.ingredient).toMatchObject({ item: 'nether_wart', count: 1 })
    expect(storage.state.inventory.slots.slice(0, 4)).toMatchObject([
      { item: 'glass_bottle', count: 1 },
      undefined,
      undefined,
      undefined,
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.playerMovementSpeedMultiplier))).toBe(1.2)
    expect(harness.commitCalls()).toBe(4)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 4)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    ]))
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([{
      _tag: 'ItemConsumed',
      actor: FISHER,
      count: 1,
      item: itemIdOf('potion_of_swiftness'),
      tick: 5,
      use: 'potion',
    }])
  })
})

describe('owner-backed mining and villager trade coverage in the interactions stage', () => {
  it('spills mature loot with a full inventory and requeues the same mining intent after commit rejection', async () => {
    const target = blockPosition(BlockAxis(2), BlockAxis(64), BlockAxis(2))
    const dirt = Option.getOrThrow(blockIdOf('dirt'))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[target, dirt]],
      playerStorage: fullPlayerStorage(),
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const dropsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(requestBlockBreak(harness.state, target, undefined, {
      dimension: DIMENSION,
      toolLocation: undefined,
    }))
    harness.rejectCommits(true)

    await harness.run()

    expect(await Effect.runPromise(harness.store.blockAt(target))).toBe(dirt)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(dropsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBreaks))).toHaveLength(1)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'WorldCommit',
      subject: 'Mining',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])

    harness.rejectCommits(false)
    await harness.run()

    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const dropsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    expect(await Effect.runPromise(harness.store.blockAt(target))).toBeUndefined()
    expect(storageAfter.state.inventory.slots.every((slot) => slot?.item === 'stone')).toBe(true)
    expect(dropsAfter.state.items).toMatchObject([{
      feetPosition: { x: 2, y: 64, z: 2 },
      behaviour: { _tag: 'DroppedItem', item: 'dirt', count: 1, eligibleFromFrame: 1 },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBreaks))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(2)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    ])
    expect(harness.lastRequest()?.blockWrite?.edits).toHaveLength(1)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
  })

  it('leaves both trade owners unchanged when the single trade commit is rejected', async () => {
    const villager = makeVillager('coverage-trader', 'farmer')
    const offer = villager.offers.find(({ input }) => input.item === 'wheat')!
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('wheat', 64),
      villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const tradesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestVillagerTrade(harness.state, {
      requestId: 'trade-commit-rejected',
      villagerId: villager.id,
      offerId: offer.id,
    }))
    harness.rejectCommits(true)

    await harness.run()

    expect(harness.commitCalls()).toBe(1)
    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))).toStrictEqual(tradesBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'WorldCommit',
      subject: 'ItemUse',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])
  })

  it('records the owner snapshot failure when the host omitted the villager trade registration', async () => {
    const villager = makeVillager('unregistered-coverage-trader', 'farmer')
    const offer = villager.offers.find(({ input }) => input.item === 'wheat')!
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('wheat', 64),
      villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
      omitVillagerTradesRegistration: true,
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestVillagerTrade(harness.state, {
      requestId: 'trade-owner-not-registered',
      villagerId: villager.id,
      offerId: offer.id,
    }))

    await harness.run()

    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'OwnerSnapshot',
      subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
  })

  it('requeues a trade when storage and trade snapshots span a concurrent owner revision', async () => {
    const villager = makeVillager('revision-coverage-trader', 'farmer')
    const offer = villager.offers.find(({ input }) => input.item === 'wheat')!
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('wheat', 64),
      villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
    }))
    const baseCoordinator = harness.baseCoordinator
    const storageBefore = await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    let injected = false
    const coordinator: WorldCommitCoordinatorApi = {
      ...baseCoordinator,
      snapshot: <Codec extends Schema.Codec<any, any>>(ownerId: ReplicatedOwnerId, schema: Codec) =>
        Effect.gen(function* () {
          if (ownerId === GAMEPLAY_VILLAGER_TRADES_OWNER_ID && !injected) {
            injected = true
            const trades = yield* baseCoordinator.snapshot(ownerId, GameplayVillagerTradeSnapshotSchema)
            const changedTrades = Schema.decodeUnknownSync(GameplayVillagerTradeSnapshotSchema)({
              ...trades.state,
              restockElapsedSecs: trades.state.restockElapsedSecs + 1,
            })
            yield* baseCoordinator.commit({
              expectedRevision: trades.revision,
              expectedDimensions: [],
              changes: [{ ownerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID, state: changedTrades }],
            }).pipe(Effect.orDie)
          }
          return yield* baseCoordinator.snapshot(ownerId, schema)
        }),
    }
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(baseCoordinator.revision)
    const request = {
      requestId: 'trade-revision-conflict',
      villagerId: villager.id,
      offerId: offer.id,
    }
    await Effect.runPromise(requestVillagerTrade(harness.state, request))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    const tradesAfter = await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))
    expect(injected).toBe(true)
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingVillagerTrades))).toStrictEqual([request])
    expect(tradesAfter.state.restockElapsedSecs).toBe(1)
    expect(await Effect.runPromise(baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'OwnerSnapshot',
      subject: 'ItemUse',
      error: {
        _tag: 'WorldRevisionConflict',
        expected: revisionBefore,
        actual: revisionBefore + 1,
      },
    }])

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    const storageAfterRetry = await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const tradesAfterRetry = await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))
    expect(await Effect.runPromise(Ref.get(harness.state.pendingVillagerTrades))).toStrictEqual([])
    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([
      { ...request, _tag: 'Traded' },
    ])
    expect(storageAfterRetry.state.inventory).not.toStrictEqual(storageBefore.state.inventory)
    expect(tradesAfterRetry.state.villagers[0]?.offers.find(({ id }) => id === offer.id)?.uses).toBe(1)
    expect(await Effect.runPromise(baseCoordinator.revision)).toBe(revisionBefore + 2)
  })

  it('preserves unrelated villagers in the committed trade candidate', async () => {
    const villager = makeVillager('candidate-preservation-trader', 'farmer')
    const unrelatedVillager = makeVillager('unrelated-candidate-trader', 'toolsmith')
    const offer = villager.offers.find(({ input }) => input.item === 'wheat')
    if (offer === undefined) throw new Error('Farmer fixture must include a wheat offer')
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('wheat', 64),
      villagerTrades: {
        villagers: [villager, unrelatedVillager],
        restockElapsedSecs: 0,
      },
    }))
    const request = {
      requestId: 'trade-preserves-unrelated-villager',
      villagerId: villager.id,
      offerId: offer.id,
    }
    await Effect.runPromise(requestVillagerTrade(harness.state, request))

    await harness.run()

    const candidateState = harness.lastRequest()?.changes.find(({ ownerId }) =>
      ownerId === GAMEPLAY_VILLAGER_TRADES_OWNER_ID
    )?.state
    const candidate = Schema.decodeUnknownSync(GameplayVillagerTradeSnapshotSchema)(candidateState)
    const committed = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))

    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([
      { ...request, _tag: 'Traded' },
    ])
    expect(candidate.villagers).toContainEqual(unrelatedVillager)
    expect(committed.state.villagers).toContainEqual(unrelatedVillager)
  })

  it('returns a typed UnknownOffer rejection without committing either trade owner', async () => {
    const villager = makeVillager('unknown-offer-trader', 'farmer')
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('wheat', 64),
      villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
    }))
    const request = {
      requestId: 'trade-unknown-offer',
      villagerId: villager.id,
      offerId: 'not-an-offer',
    }
    await Effect.runPromise(requestVillagerTrade(harness.state, request))

    await harness.run()

    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([
      { ...request, _tag: 'Rejected', reason: 'UnknownOffer' },
    ])
    expect(harness.commitCalls()).toBe(0)
  })
})

describe('retrying item-use intents after owner revision conflicts', () => {
  it('commits effectful food consumption with its status effects in one owner revision', async () => {
    const vitals = { ...SPAWN_VITALS, hungerPoints: HungerPoints(10) }
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('pufferfish', 1),
      vitals,
    }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestFoodUse(harness.state, 'pufferfish-atomic-effects', 'pufferfish', {
      healthPoints: vitals.healthPoints,
      hungerPoints: vitals.hungerPoints,
      maxHungerPoints: vitals.maxHungerPoints,
    }))

    await harness.run()

    const storage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const nextVitals = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const status = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
      StatusEffectStateSchema,
    ))
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'EatFood',
      requestId: 'pufferfish-atomic-effects',
      success: true,
      consumedCount: 1,
      outcome: { _tag: 'consume' },
    }])
    expect(storage.state.inventory.slots[0]).toBeUndefined()
    expect(nextVitals.state.vitals.hungerPoints).toBeGreaterThan(vitals.hungerPoints)
    expect(status.state.effects.map(({ type }) => type)).toStrictEqual(['poison', 'hunger', 'nausea'])
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_VITALS_OWNER_ID,
      GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    ])
    expect([storage.revision, nextVitals.revision, status.revision]).toStrictEqual([
      revisionBefore + 1,
      revisionBefore + 1,
      revisionBefore + 1,
    ])
    expect(harness.commitCalls()).toBe(1)
  })

  it('does not consume effectful food when its status-effect owner is unavailable', async () => {
    const vitals = { ...SPAWN_VITALS, hungerPoints: HungerPoints(10) }
    const requestVitals = {
      healthPoints: vitals.healthPoints,
      hungerPoints: vitals.hungerPoints,
      maxHungerPoints: vitals.maxHungerPoints,
    }
    const missingId = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('pufferfish', 1),
      vitals,
      omitStatusEffectsOwnerId: true,
    }))
    const storageBefore = await Effect.runPromise(missingId.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(missingId.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    await Effect.runPromise(requestFoodUse(missingId.state, 'food-status-owner-id-missing', 'pufferfish', requestVitals))

    await missingId.run()

    expect(await Effect.runPromise(Ref.get(missingId.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported',
      action: 'EatFood',
      requestId: 'food-status-owner-id-missing',
      reason: 'OwnerRegistrationUnavailable',
    })
    expect(await Effect.runPromise(drainItemUseResults(missingId.state))).toStrictEqual([])
    expect((await Effect.runPromise(missingId.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(storageBefore.state)
    expect((await Effect.runPromise(missingId.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).state).toStrictEqual(vitalsBefore.state)
    expect(missingId.commitCalls()).toBe(0)

    const missingSnapshot = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('pufferfish', 1),
      vitals,
    }))
    const failedSnapshotInteractions = missingSnapshot.interactionsWithCoordinator(
      coordinatorWithSnapshotFailure(missingSnapshot.baseCoordinator, GAMEPLAY_STATUS_EFFECTS_OWNER_ID),
    )
    const failedStorageBefore = await Effect.runPromise(missingSnapshot.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestFoodUse(
      missingSnapshot.state,
      'food-status-owner-snapshot-failed',
      'pufferfish',
      requestVitals,
    ))

    await Effect.runPromise(failedSnapshotInteractions.run(DeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(Ref.get(missingSnapshot.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(drainItemUseResults(missingSnapshot.state))).toStrictEqual([])
    expect((await Effect.runPromise(missingSnapshot.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(failedStorageBefore.state)
    expect(missingSnapshot.commitCalls()).toBe(0)
  })

  it('requeues effectful food when the status snapshot sees a newer owner revision', async () => {
    const vitals = { ...SPAWN_VITALS, hungerPoints: HungerPoints(10) }
    const requestVitals = {
      healthPoints: vitals.healthPoints,
      hungerPoints: vitals.hungerPoints,
      maxHungerPoints: vitals.maxHungerPoints,
    }
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('pufferfish', 1),
      vitals,
    }))
    const coordinator = coordinatorWithRevisionBump(
      harness.baseCoordinator,
      GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const storageBefore = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestFoodUse(
      harness.state,
      'food-status-revision-conflict',
      'pufferfish',
      requestVitals,
    ))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([{
      action: 'EatFood', requestId: 'food-status-revision-conflict', heldItem: 'pufferfish',
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'WorldRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
    }])
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(storageBefore.state)
    expect(harness.commitCalls()).toBe(0)

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    const storageAfter = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const statusAfter = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
      StatusEffectStateSchema,
    ))
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'EatFood', requestId: 'food-status-revision-conflict', success: true, consumedCount: 1,
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(storageAfter.state.inventory.slots[0]).toBeUndefined()
    expect(statusAfter.state.effects.map(({ type }) => type)).toStrictEqual(['poison', 'hunger', 'nausea'])
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 2)
  })

  it('requeues the current and remaining bucket requests after a concurrent owner commit', async () => {
    const firstTarget = blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1))
    const secondTarget = blockPosition(BlockAxis(2), BlockAxis(64), BlockAxis(1))
    const water = Option.getOrThrow(blockIdOf('water'))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[firstTarget, water], [secondTarget, water]],
      playerStorage: playerStorageWithItems([['bucket', 1], ['bucket', 1]]),
    }))
    const storageBefore = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const interactions = harness.interactionsWithCoordinator(coordinatorWithCommitRevisionBump(
      harness.coordinator,
      harness.baseCoordinator,
    ))
    await Effect.runPromise(requestBucketUse(
      harness.state, 'bucket-revision-conflict-first', firstTarget, 'bucket', DIMENSION,
    ))
    await Effect.runPromise(requestBucketUse(
      harness.state, 'bucket-revision-conflict-second', secondTarget, 'bucket', DIMENSION,
    ))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([
      { action: 'UseBucket', requestId: 'bucket-revision-conflict-first' },
      { action: 'UseBucket', requestId: 'bucket-revision-conflict-second' },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse',
      error: { _tag: 'WorldRevisionConflict' },
    }])
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(storageBefore.state)
    expect(await Effect.runPromise(harness.store.blockAt(firstTarget))).toBe(water)
    expect(await Effect.runPromise(harness.store.blockAt(secondTarget))).toBe(water)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([
      { action: 'UseBucket', requestId: 'bucket-revision-conflict-first', success: true, outcome: { _tag: 'Collected' } },
      { action: 'UseBucket', requestId: 'bucket-revision-conflict-second', success: true, outcome: { _tag: 'Collected' } },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(harness.store.blockAt(firstTarget))).toBeUndefined()
    expect(await Effect.runPromise(harness.store.blockAt(secondTarget))).toBeUndefined()
    const storageAfter = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(storageAfter.state.inventory.slots.slice(0, 2)).toMatchObject([
      { item: 'water_bucket', count: 1 },
      { item: 'water_bucket', count: 1 },
    ])
    expect(harness.commitCalls()).toBe(3)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 3)
  })

  it('continues after a nonretryable bucket commit failure without publishing its result', async () => {
    const firstTarget = blockPosition(BlockAxis(3), BlockAxis(64), BlockAxis(1))
    const secondTarget = blockPosition(BlockAxis(4), BlockAxis(64), BlockAxis(1))
    const water = Option.getOrThrow(blockIdOf('water'))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[firstTarget, water], [secondTarget, water]],
      playerStorage: playerStorageWithItems([['bucket', 1], ['bucket', 1]]),
    }))
    const interactions = harness.interactionsWithCoordinator(
      coordinatorWithFirstCommitFailure(harness.coordinator),
    )
    await Effect.runPromise(requestBucketUse(harness.state, 'bucket-permanent-failure', firstTarget, 'bucket', DIMENSION))
    await Effect.runPromise(requestBucketUse(harness.state, 'bucket-after-permanent-failure', secondTarget, 'bucket', DIMENSION))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'UseBucket', requestId: 'bucket-after-permanent-failure', success: true,
      outcome: { _tag: 'Collected' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])
    expect(await Effect.runPromise(harness.store.blockAt(firstTarget))).toBe(water)
    expect(await Effect.runPromise(harness.store.blockAt(secondTarget))).toBeUndefined()
    expect(harness.commitCalls()).toBe(1)
  })

  it('replans food consumption after a concurrent commit advances the owner revision', async () => {
    const vitals = { ...SPAWN_VITALS, hungerPoints: HungerPoints(10) }
    const foodVitals = {
      healthPoints: vitals.healthPoints,
      hungerPoints: vitals.hungerPoints,
      maxHungerPoints: vitals.maxHungerPoints,
    }
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('cod', 1),
      vitals,
    }))
    const coordinator = coordinatorWithRevisionBump(
      harness.baseCoordinator,
      GAMEPLAY_VITALS_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    await Effect.runPromise(requestFoodUse(
      harness.state,
      'food-revision-conflict-retry',
      'cod',
      foodVitals,
    ))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([{
      action: 'EatFood',
      requestId: 'food-revision-conflict-retry',
      heldItem: 'cod',
    }])
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'OwnerSnapshot',
      subject: 'Vitals',
      error: { _tag: 'WorldRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
    }])

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    const storageAfter = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'EatFood',
      requestId: 'food-revision-conflict-retry',
      success: true,
      consumedCount: 1,
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(storageAfter.state.inventory.slots[0]).toBeUndefined()
    expect(vitalsAfter.state.vitals.hungerPoints).toBeGreaterThan(vitals.hungerPoints)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 2)
  })
})

describe('registered block-use and placement requests in the interactions stage', () => {
  it('reports dead-player refusals for placement, bow, and melee intents', async () => {
    const harness = await Effect.runPromise(makeHarness({
      vitals: { ...SPAWN_VITALS, healthPoints: EntityHealthPoints(0) },
    }))
    await Effect.runPromise(requestBlockPlacementCommand(harness.state, {
      requestId: 'dead-player-placement',
      positionKey: blockPositionKeyOf(blockPosition(BlockAxis(3), BlockAxis(64), BlockAxis(3))),
      heldItem: 'stone',
      mode: 'creative',
    }))
    await Effect.runPromise(requestBowShot(harness.state, 'dead-player-bow', {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 1,
      dirZ: 0,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'creative', slotIndex: 0 },
    }))
    await Effect.runPromise(requestMeleeAttack(harness.state, {
      requestId: 'dead-player-melee',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }))

    await harness.run()

    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toMatchObject([{
      requestId: 'dead-player-placement',
      success: false,
      outcome: { _tag: 'PlayerDead' },
    }])
    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([{
      requestId: 'dead-player-bow', success: false, outcome: 'PlayerDead',
    }])
    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toStrictEqual([{
      requestId: 'dead-player-melee', success: false, outcome: 'PlayerDead',
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('reports lever, non-lever, and unloaded block-use outcomes without committing', async () => {
    const leverPosition = blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1))
    const solidPosition = blockPosition(BlockAxis(2), BlockAxis(64), BlockAxis(1))
    const unloadedPosition = blockPosition(BlockAxis(32), BlockAxis(64), BlockAxis(1))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [
        [leverPosition, Option.getOrThrow(blockIdOf('lever'))],
        [solidPosition, Option.getOrThrow(blockIdOf('stone'))],
      ],
    }))
    await Effect.runPromise(requestBlockUse(harness.state, 'use-lever', leverPosition))
    await Effect.runPromise(requestBlockUse(harness.state, 'use-stone', solidPosition))
    await Effect.runPromise(requestBlockUse(harness.state, 'use-unloaded', unloadedPosition))

    await harness.run()

    expect(await Effect.runPromise(drainBlockUseResults(harness.state))).toMatchObject([
      { requestId: 'use-lever', success: true, outcome: { _tag: 'ToggleLever', position: leverPosition } },
      { requestId: 'use-stone', success: false, outcome: { _tag: 'NotLever', position: solidPosition } },
      { requestId: 'use-unloaded', success: false, outcome: { _tag: 'ChunkNotLoaded', position: unloadedPosition } },
    ])
    expect(harness.commitCalls()).toBe(0)
  })

  it('commits a survival placement block write and inventory consumption once', async () => {
    const target = blockPosition(BlockAxis(3), BlockAxis(64), BlockAxis(3))
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('stone', 1),
    }))
    await Effect.runPromise(requestBlockPlacementCommand(harness.state, {
      requestId: 'place-stone-once',
      positionKey: blockPositionKeyOf(target),
      heldItem: 'stone',
    }))

    await harness.run()

    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toMatchObject([{
      requestId: 'place-stone-once',
      success: true,
      consumed: true,
      replayed: false,
      outcome: { _tag: 'Placed' },
    }])
    expect(await Effect.runPromise(harness.store.blockAt(target))).toStrictEqual(Option.getOrThrow(blockIdOf('stone')))
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state.inventory.slots.every((slot) => slot?.item !== 'stone')).toBe(true)
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.blockWrite?.edits).toHaveLength(1)
  })

  it('does not commit an unavailable survival item but places a creative block without consuming storage', async () => {
    const unavailable = blockPosition(BlockAxis(4), BlockAxis(64), BlockAxis(3))
    const creative = blockPosition(BlockAxis(5), BlockAxis(64), BlockAxis(3))
    const harness = await Effect.runPromise(makeHarness())
    await Effect.runPromise(requestBlockPlacementCommand(harness.state, {
      requestId: 'place-missing-survival-item',
      positionKey: blockPositionKeyOf(unavailable),
      heldItem: 'dirt',
    }))
    await Effect.runPromise(requestBlockPlacementCommand(harness.state, {
      requestId: 'place-creative-stone',
      positionKey: blockPositionKeyOf(creative),
      heldItem: 'stone',
      mode: 'creative',
    }))

    await harness.run()

    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toMatchObject([
      {
        requestId: 'place-missing-survival-item',
        success: false,
        consumed: false,
        outcome: { _tag: 'InventoryUnavailable' },
      },
      {
        requestId: 'place-creative-stone',
        success: true,
        consumed: false,
        outcome: { _tag: 'Placed' },
      },
    ])
    expect(await Effect.runPromise(harness.store.blockAt(unavailable))).toBeUndefined()
    expect(await Effect.runPromise(harness.store.blockAt(creative))).toBe(Option.getOrThrow(blockIdOf('stone')))
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes).toStrictEqual([])
    expect(harness.lastRequest()?.blockWrite?.edits).toHaveLength(1)
  })

  it('returns a correlated failure when the configured player-storage owner is unregistered', async () => {
    const harness = await Effect.runPromise(makeHarness({ omitPlayerStorageRegistration: true }))
    await Effect.runPromise(requestBlockPlacementCommand(harness.state, {
      requestId: 'place-unregistered-storage-owner',
      positionKey: blockPositionKeyOf(blockPosition(BlockAxis(7), BlockAxis(64), BlockAxis(3))),
      heldItem: 'stone',
    }))

    await harness.run()

    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toMatchObject([{
      requestId: 'place-unregistered-storage-owner',
      success: false,
      consumed: false,
      outcome: { _tag: 'CommitFailed', error: { _tag: 'ReplicatedOwnerUnknown' } },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('rejects a placement when the player snapshot is unavailable before dispatch', async () => {
    const harness = await Effect.runPromise(makeHarness({ omitPlayerRegistration: true }))
    const target = blockPosition(BlockAxis(9), BlockAxis(64), BlockAxis(3))
    await Effect.runPromise(requestBlockPlacementCommand(harness.state, {
      requestId: 'place-without-player-snapshot',
      positionKey: blockPositionKeyOf(target),
      heldItem: 'stone',
    }))

    await harness.run()

    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toStrictEqual([{
      requestId: 'place-without-player-snapshot',
      success: false,
      consumed: false,
      replayed: false,
      outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' },
    }])
    expect(await Effect.runPromise(harness.store.blockAt(target))).toBeUndefined()
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPlacements))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('reports a rejected placement commit without changing the block or inventory owner', async () => {
    const target = blockPosition(BlockAxis(8), BlockAxis(64), BlockAxis(3))
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('stone', 1),
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestBlockPlacementCommand(harness.state, {
      requestId: 'place-rejected-commit',
      positionKey: blockPositionKeyOf(target),
      heldItem: 'stone',
    }))
    harness.rejectCommits(true)

    await harness.run()

    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toMatchObject([{
      requestId: 'place-rejected-commit',
      success: false,
      consumed: false,
      replayed: false,
      outcome: { _tag: 'CommitFailed', error: { _tag: 'WorldCommitEmptyRequest' } },
    }])
    expect(await Effect.runPromise(harness.store.blockAt(target))).toBeUndefined()
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.blockWrite?.edits).toMatchObject([{ position: target }])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'WorldCommit',
      subject: 'ItemUse',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])
  })

})

describe('registered combat and teleport requests in the interactions stage', () => {
  it('keeps legacy uncorrelated bow and melee requests pending without synthetic results', async () => {
    const harness = await Effect.runPromise(makeHarness())
    const bowRequest = {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 1,
      dirZ: 0,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'creative' as const, slotIndex: 0 },
    }
    const meleeRequest = {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }
    await Effect.runPromise(requestBowShot(harness.state, bowRequest))
    await Effect.runPromise(requestMeleeAttack(harness.state, meleeRequest))

    await Effect.runPromise(harness.interactionsWithoutCommit.run(DeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toMatchObject([
      { _tag: 'Unsupported', action: 'BowShot', reason: 'WorldCommitCoordinatorUnavailable' },
      { _tag: 'Unsupported', action: 'MeleeAttack', reason: 'WorldCommitCoordinatorUnavailable' },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toStrictEqual([bowRequest])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([meleeRequest])
    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('commits a melee damage owner update once and requeues it after commit rejection', async () => {
    const target = combatTarget('coverage-melee-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
    }))
    const targetBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    const request = {
      requestId: 'melee-damage-retry',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }
    await Effect.runPromise(requestMeleeAttack(harness.state, request))
    harness.rejectCommits(true)

    await harness.run()

    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))).state).toStrictEqual(targetBefore.state)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([request])
    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])

    harness.rejectCommits(false)
    await harness.run()

    const targetAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    expect(targetAfter.state.entities[0]?.healthPoints).toBe(16)
    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toMatchObject([{
      requestId: 'melee-damage-retry',
      success: true,
      target: { id: target.id, distance: 2 },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(2)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_ENTITIES_OWNER_ID,
    ])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toMatchObject([{
      _tag: 'EntityDamaged',
      entity: target.id,
      amount: 4,
      cause: 'mob',
    }])
  })

  it('keeps a lethal melee hit pending when its mob drop owner is not registered', async () => {
    const target = combatTarget('coverage-missing-drop-owner-target', 1)
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      omitDroppedItemsOwnerId: true,
    }))
    const request = {
      requestId: 'melee-missing-drop-owner',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }
    await Effect.runPromise(requestMeleeAttack(harness.state, request))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    expect(entities.state.entities).toStrictEqual([target])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([request])
    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toMatchObject([{
      _tag: 'Unsupported',
      action: 'MobDrop',
      reason: 'OwnerRegistrationUnavailable',
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('commits a lethal melee hit with its dropped item, experience, and damage event', async () => {
    const target = combatTarget('coverage-lethal-drop-target', 1)
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
    }))
    await Effect.runPromise(requestMeleeAttack(harness.state, {
      requestId: 'melee-lethal-drop-commit',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    const droppedItems = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    expect(entities.state.entities).toStrictEqual([])
    expect(droppedItems.state.items).toHaveLength(1)
    expect(droppedItems.state.items[0]?.behaviour).toMatchObject({ _tag: 'DroppedItem', item: 'gunpowder', count: 1 })
    expect(await Effect.runPromise(Ref.get(harness.state.mobDrops))).toHaveLength(1)
    expect(await Effect.runPromise(Ref.get(harness.state.mobExperience))).toMatchObject([{ amount: 5 }])
    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toMatchObject([{ success: true }])
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_ENTITIES_OWNER_ID,
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    ])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toMatchObject([{ _tag: 'EntityDamaged' }])
  })

  it('requeues a lethal hit when the registered dropped-item owner cannot be snapshotted', async () => {
    const target = combatTarget('coverage-drop-snapshot-target', 1)
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      omitDroppedItemsRegistration: true,
    }))
    const request = {
      requestId: 'melee-drop-snapshot-failure',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }
    await Effect.runPromise(requestMeleeAttack(harness.state, request))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    expect(entities.state.entities).toStrictEqual([target])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([request])
    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('requeues a lethal hit when the dropped-item snapshot races another owner revision', async () => {
    const target = combatTarget('coverage-drop-revision-target', 1)
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
    }))
    let injected = false
    const coordinator: WorldCommitCoordinatorApi = {
      ...harness.coordinator,
      snapshot: <Codec extends Schema.Codec<any, any>>(
        ownerId: ReplicatedOwnerId,
        schema: Codec,
      ): Effect.Effect<
        ReplicatedSnapshot<Codec>,
        Schema.SchemaError | ReplicatedOwnerUnknown,
        Schema.Codec.DecodingServices<Codec>
      > => Effect.gen(function* () {
        if (ownerId === GAMEPLAY_DROPPED_ITEMS_OWNER_ID && !injected) {
          injected = true
          const trades = yield* harness.baseCoordinator.snapshot(
            GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
            GameplayVillagerTradeSnapshotSchema,
          )
          yield* harness.baseCoordinator.commit({
            expectedRevision: trades.revision,
            expectedDimensions: [],
            changes: [{ ownerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID, state: trades.state }],
          }).pipe(Effect.orDie)
        }
        return yield* harness.coordinator.snapshot(ownerId, schema)
      }),
    }
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const request = {
      requestId: 'melee-drop-revision-conflict',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }
    await Effect.runPromise(requestMeleeAttack(harness.state, request))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    const entities = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    expect(entities.state.entities).toStrictEqual([target])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'WorldRevisionConflict' },
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('records an event-bus failure after committing melee damage to the entity owner', async () => {
    const target = combatTarget('coverage-event-publish-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
    }))
    harness.rejectEventPublishes(true)
    await Effect.runPromise(requestMeleeAttack(harness.state, {
      requestId: 'melee-event-publish-failed',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    expect(entities.state.entities[0]?.healthPoints).toBe(16)
    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toMatchObject([{
      requestId: 'melee-event-publish-failed',
      success: true,
    }])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'EventPublish', subject: 'Player',
    }])
    expect(harness.commitCalls()).toBe(1)
  })

  it('commits melee damage without an optional event-bus registration', async () => {
    const target = combatTarget('coverage-no-event-bus-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      omitInteractionEventBus: true,
    }))
    await Effect.runPromise(requestMeleeAttack(harness.state, {
      requestId: 'melee-no-event-bus',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    expect(entities.state.entities[0]?.healthPoints).toBe(16)
    expect(harness.commitCalls()).toBe(1)
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toStrictEqual([])
  })

  it('commits a charged survival bow hit with its storage changes and owner damage in one request', async () => {
    const target = combatTarget('coverage-bow-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      playerStorage: playerStorageWithItems([['bow', 1], ['arrow', 1]]),
    }))
    await Effect.runPromise(requestBowShot(harness.state, 'bow-owner-damage', {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    const storage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([{
      requestId: 'bow-owner-damage',
      success: true,
      outcome: 'Fired',
    }])
    expect(entities.state.entities[0]?.healthPoints).toBe(11)
    expect(storage.state.inventory.slots[0]?.item).toBe('bow')
    expect(storage.state.inventory.slots.some((slot) => slot?.item === 'arrow')).toBe(false)
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_ENTITIES_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    ])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toMatchObject([{
      _tag: 'EntityDamaged',
      entity: target.id,
      amount: 9,
      cause: 'projectile',
    }])
  })

  it('requeues a bow shot when player and entity snapshots span different revisions', async () => {
    const target = combatTarget('coverage-bow-player-revision-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      playerStorage: playerStorageWithItems([['bow', 1], ['arrow', 1]]),
    }))
    const coordinator = coordinatorWithRevisionBump(
      harness.baseCoordinator,
      GAMEPLAY_ENTITIES_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const shot = {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'survival' as const, slotIndex: 0 },
    }
    await Effect.runPromise(requestBowShot(harness.state, 'bow-player-revision-conflict', shot))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toHaveLength(1)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
      error: { _tag: 'WorldRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
    }])
    expect(await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))).toMatchObject({ state: { entities: [target] } })
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
  })

  it('requeues a bow shot when its storage snapshot observes a newer revision', async () => {
    const target = combatTarget('coverage-bow-storage-revision-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      playerStorage: playerStorageWithItems([['bow', 1], ['arrow', 1]]),
    }))
    const coordinator = coordinatorWithRevisionBump(
      harness.baseCoordinator,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    await Effect.runPromise(requestBowShot(harness.state, 'bow-storage-revision-conflict', {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toHaveLength(1)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
      error: { _tag: 'WorldRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
    }])
    expect(await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))).toMatchObject({ state: { entities: [target] } })
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
  })

  it('commits a lethal survival bow hit with storage, drop, and experience owners together', async () => {
    const target = combatTarget('coverage-lethal-bow-target', 1)
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      playerStorage: playerStorageWithItems([['bow', 1], ['arrow', 1]]),
    }))
    await Effect.runPromise(requestBowShot(harness.state, 'bow-lethal-owner-damage', {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    const storage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const drops = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([{
      requestId: 'bow-lethal-owner-damage', success: true, outcome: 'Fired',
    }])
    expect(entities.state.entities).toStrictEqual([])
    expect(storage.state.inventory.slots.some((slot) => slot?.item === 'arrow')).toBe(false)
    expect(drops.state.items).toHaveLength(1)
    expect(await Effect.runPromise(Ref.get(harness.state.mobDrops))).toHaveLength(1)
    expect(await Effect.runPromise(Ref.get(harness.state.mobExperience))).toMatchObject([{ amount: 5 }])
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
      GAMEPLAY_ENTITIES_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    ]))
    expect(harness.commitCalls()).toBe(1)
  })

  it('requeues a charged bow shot after a rejected owner commit and then retries it', async () => {
    const target = combatTarget('coverage-bow-commit-retry-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      playerStorage: playerStorageWithItems([['bow', 1], ['arrow', 1]]),
    }))
    const entitiesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const request = {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'survival' as const, slotIndex: 0 },
    }
    await Effect.runPromise(requestBowShot(harness.state, 'bow-owner-commit-retry', request))
    harness.rejectCommits(true)

    await harness.run()

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))).toStrictEqual(entitiesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toHaveLength(1)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'Player',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])
    expect(harness.commitCalls()).toBe(1)

    harness.rejectCommits(false)
    await harness.run()

    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([{
      requestId: 'bow-owner-commit-retry', success: true, outcome: 'Fired',
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect(harness.commitCalls()).toBe(2)
  })

  it('consumes a charged survival bow shot blocked by terrain without damaging the target', async () => {
    const target = combatTarget('coverage-blocked-bow-target')
    const obstacle = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(1))
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      playerStorage: playerStorageWithItems([['bow', 1], ['arrow', 1]]),
      blocks: [[obstacle, Option.getOrThrow(blockIdOf('stone'))]],
    }))
    await Effect.runPromise(requestBowShot(harness.state, 'bow-blocked-by-terrain', {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    const storage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([{
      requestId: 'bow-blocked-by-terrain',
      success: true,
      outcome: 'Fired',
    }])
    expect(entities.state.entities[0]?.healthPoints).toBe(20)
    expect(storage.state.inventory.slots[0]?.item).toBe('bow')
    expect(storage.state.inventory.slots.some((slot) => slot?.item === 'arrow')).toBe(false)
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    ])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
  })

  it('completes a charged creative bow miss without committing owners', async () => {
    const harness = await Effect.runPromise(makeHarness())
    await Effect.runPromise(requestBowShot(harness.state, 'creative-bow-miss', {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 1,
      dirZ: 0,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'creative', slotIndex: 0 },
    }))

    await harness.run()

    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([{
      requestId: 'creative-bow-miss',
      success: true,
      outcome: 'Fired',
    }])
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.bowKnockbacks))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
  })

  it('reports undercharge and duplicate bow request IDs without committing owners twice', async () => {
    const harness = await Effect.runPromise(makeHarness())
    const shot = {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 1,
      dirZ: 0,
      inventory: { mode: 'creative' as const, slotIndex: 0 },
    }
    await Effect.runPromise(requestBowShot(harness.state, 'undercharged-bow', {
      ...shot,
      chargeSecs: 0,
    }))
    await Effect.runPromise(requestBowShot(harness.state, 'duplicate-bow-shot', {
      ...shot,
      chargeSecs: BOW_FULL_CHARGE_SECS,
    }))
    await Effect.runPromise(requestBowShot(harness.state, 'duplicate-bow-shot', {
      ...shot,
      chargeSecs: BOW_FULL_CHARGE_SECS,
    }))

    await harness.run()

    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([
      { requestId: 'undercharged-bow', success: false, outcome: 'Undercharged' },
      { requestId: 'duplicate-bow-shot', success: true, outcome: 'Fired' },
      { requestId: 'duplicate-bow-shot', success: false, outcome: 'DuplicateRequest' },
    ])
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.bowKnockbacks))).toStrictEqual([])
  })

  it('returns InventoryUnavailable when a charged survival bow has no registered arrow', async () => {
    const target = combatTarget('coverage-bow-without-arrow')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
      playerStorage: playerStorageWithItems([['bow', 1]]),
    }))
    const entitiesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestBowShot(harness.state, 'bow-without-arrow', {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([{
      requestId: 'bow-without-arrow',
      success: false,
      outcome: 'InventoryUnavailable',
    }])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))).toStrictEqual(entitiesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toStrictEqual([])
  })

  it('returns an unsuccessful melee result when no target is in reach', async () => {
    const target = combatTarget('coverage-melee-missed-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
    }))
    const entitiesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestMeleeAttack(harness.state, {
      requestId: 'melee-miss',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(1), PositionAxis(0), PositionAxis(0)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }))

    await harness.run()

    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toStrictEqual([{
      requestId: 'melee-miss',
      success: false,
    }])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))).toStrictEqual(entitiesBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
  })

  it('consumes an uncorrelated melee miss without creating a host result', async () => {
    const target = combatTarget('coverage-legacy-melee-miss-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
    }))
    const entitiesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    await Effect.runPromise(requestMeleeAttack(harness.state, {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(1), PositionAxis(0), PositionAxis(0)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }))

    await harness.run()

    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))).toStrictEqual(entitiesBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('requeues a melee attack when the player snapshot observes a newer owner revision', async () => {
    const target = combatTarget('coverage-melee-player-revision-target')
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [target], nextSerial: EntitySerial(1) },
    }))
    const coordinator = coordinatorWithRevisionBump(
      harness.baseCoordinator,
      GAMEPLAY_ENTITIES_OWNER_ID,
      'after',
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const request = {
      requestId: 'melee-player-revision-conflict',
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      direction: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
      reach: AttackRangeDistance(3),
      damage: 4,
    }
    await Effect.runPromise(requestMeleeAttack(harness.state, request))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainMeleeAttackResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingMeleeAttacks))).toStrictEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
      error: { _tag: 'WorldRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
    }])
    expect(await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))).toMatchObject({ state: { entities: [target] } })
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
  })

  it('commits a survival ender-pearl movement, consumption, and vitals update once', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('ender_pearl', 1),
    }))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-owner-move',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toHaveLength(1)
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
      GAMEPLAY_PLAYER_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_VITALS_OWNER_ID,
    ]))
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
  })

  it('commits an endermite spawn with the pearl movement, consumption, and vitals update', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('ender_pearl', 1),
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 1))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-endermite-spawn',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    const entities = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    expect(entities.state.entities).toHaveLength(1)
    expect(entities.state.entities[0]?.kind).toBe(EntityKind('endermite'))
    expect(harness.commitCalls()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
      GAMEPLAY_ENTITIES_OWNER_ID,
      GAMEPLAY_PLAYER_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_VITALS_OWNER_ID,
    ]))
  })

  it('keeps creative pearl movement free of storage consumption and vital damage', async () => {
    const harness = await Effect.runPromise(makeHarness())
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'creative-pearl-no-damage',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'creative', slotIndex: 0 },
    }))

    await harness.run()

    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toMatchObject([{ damage: undefined }])
    expect(vitalsAfter.state).toStrictEqual(vitalsBefore.state)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_VITALS_OWNER_ID)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).not.toContain(GAMEPLAY_PLAYER_STORAGE_OWNER_ID)
    expect(harness.commitCalls()).toBe(1)
  })

  it('reports an unsupported pearl throw when its endermite owner ID is unavailable', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('ender_pearl', 1),
      omitEntitiesOwnerId: true,
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 1))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-without-endermite-owner-id',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toMatchObject([{
      _tag: 'Unsupported', action: 'EnderPearl', reason: 'OwnerRegistrationUnavailable',
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(harness.commitCalls()).toBe(0)
  })

  it('records a typed owner snapshot failure when the endermite entity owner is unregistered', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('ender_pearl', 1),
      omitEntitiesRegistration: true,
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 1))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-unregistered-endermite-owner',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(harness.commitCalls()).toBe(0)
  })

  it('rejects an endermite pearl plan when the entity snapshot races a newer owner revision', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('ender_pearl', 1),
    }))
    const coordinator = coordinatorWithRevisionBump(
      harness.baseCoordinator,
      GAMEPLAY_ENTITIES_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 1))
    const storageBefore = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-entity-revision-conflict',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
      error: { _tag: 'WorldRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
    expect(await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toMatchObject({ state: storageBefore.state })
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect(harness.commitCalls()).toBe(0)
  })

  it('keeps a rejected pearl throw unchanged and retries its queued owner commit', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('ender_pearl', 1),
    }))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const seedBefore = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    const request = {
      requestId: 'pearl-rejected-then-retried',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'survival' as const, slotIndex: 0 },
    }
    await Effect.runPromise(requestEnderPearlThrow(harness.state, request))
    harness.rejectCommits(true)

    await harness.run()

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))).toStrictEqual(playerBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).toBe(seedBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'Player',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(1)

    harness.rejectCommits(false)
    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toHaveLength(1)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).not.toBe(seedBefore)
    expect(harness.commitCalls()).toBe(2)
  })

  it('rejects a pearl throw when its storage snapshot races a newer owner revision', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('ender_pearl', 1),
    }))
    const coordinator = coordinatorWithRevisionBump(harness.baseCoordinator, GAMEPLAY_PLAYER_STORAGE_OWNER_ID)
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const storageBefore = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-storage-revision-conflict',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toMatchObject({ state: storageBefore.state })
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
      error: { _tag: 'WorldRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
    }])
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
  })
})

describe('schema-valid interaction edge paths', () => {
  it('keeps an uncorrelated charged bow request pending when the entity owner ID is unavailable', async () => {
    const harness = await Effect.runPromise(makeHarness({ omitEntitiesOwnerId: true }))
    const request = {
      origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      dirX: 0,
      dirY: 1,
      dirZ: 0,
      chargeSecs: BOW_FULL_CHARGE_SECS,
      inventory: { mode: 'creative' as const, slotIndex: 0 },
    }
    await Effect.runPromise(requestBowShot(harness.state, request))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toMatchObject([{
      _tag: 'Unsupported', action: 'BowShot', reason: 'OwnerRegistrationUnavailable',
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingBowShots))).toStrictEqual([request])
    expect(await Effect.runPromise(drainBowShotResults(harness.state))).toStrictEqual([])
  })

  it('reports brewing as unsupported when the host omits its service', async () => {
    const harness = await Effect.runPromise(makeHarness({ omitBrewingService: true }))
    await Effect.runPromise(insertBrewingFuel(harness.state, 'missing-brewing-service'))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toMatchObject([{
      _tag: 'Unsupported', action: 'Brewing', requestId: 'missing-brewing-service',
      reason: 'OwnerRegistrationUnavailable',
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('records typed brewing service failures for plans that reject valid operations', async () => {
    const failure = Schema.decodeUnknownSync(BrewingServiceErrorSchema)({
      _tag: 'BrewingValidationFailure', path: 'plan', reason: 'deterministic service rejection',
    })
    const scenarios: ReadonlyArray<{
      readonly requestId: string
      readonly options: Readonly<{
        readonly playerStorage?: PlayerStorage
        readonly brewing?: Schema.Schema.Type<typeof BrewingServiceStateSchema>
      }>
      readonly override: (service: BrewingServiceApi) => BrewingServiceApi
      readonly enqueue: (state: GameplayFrameState, requestId: string) => Effect.Effect<void, Schema.SchemaError>
    }> = [
      {
        requestId: 'reject-set-fuel',
        options: { playerStorage: playerStorageWithItem('blaze_powder', 1) },
        override: (service) => ({ ...service, planSetFuel: () => Effect.fail(failure) }),
        enqueue: (state, requestId) => insertBrewingFuel(state, requestId),
      },
      {
        requestId: 'reject-add-fuel',
        options: { playerStorage: playerStorageWithItem('blaze_powder', 1) },
        override: (service) => ({ ...service, planAddFuel: () => Effect.fail(failure) }),
        enqueue: (state, requestId) => insertBrewingFuel(state, requestId),
      },
      {
        requestId: 'reject-set-bottle',
        options: { playerStorage: playerStorageWithItem('water_bottle', 1) },
        override: (service) => ({ ...service, planSetBottle: () => Effect.fail(failure) }),
        enqueue: (state, requestId) => insertBrewingBottle(state, requestId, 0, 'water_bottle'),
      },
      {
        requestId: 'reject-set-ingredient',
        options: { playerStorage: playerStorageWithItem('nether_wart', 1) },
        override: (service) => ({ ...service, planSetIngredient: () => Effect.fail(failure) }),
        enqueue: (state, requestId) => insertBrewingIngredient(state, requestId, 'nether_wart'),
      },
      {
        requestId: 'reject-collect-bottle',
        options: { brewing: brewingStateWithBottle() },
        override: (service) => ({ ...service, planSetBottle: () => Effect.fail(failure) }),
        enqueue: (state, requestId) => requestCollectBrewingBottle(state, {
          requestId,
          actor: FISHER,
          tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
          address: { dimension: DIMENSION, position: blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1)) },
          bottleIndex: 0,
        }),
      },
    ]

    await Promise.all(scenarios.map(async (scenario) => {
      const harness = await Effect.runPromise(makeHarness({
        ...scenario.options,
        brewingServiceOverride: scenario.override,
      }))
      await Effect.runPromise(scenario.enqueue(harness.state, scenario.requestId))

      await harness.run()

      expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: failure,
      }])
      expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
      expect(harness.commitCalls()).toBe(0)
    }))
  })

  it('records a non-drink service failure separately from typed potion refusals', async () => {
    const failure = Schema.decodeUnknownSync(BrewingServiceErrorSchema)({
      _tag: 'BrewingValidationFailure', path: 'drink', reason: 'deterministic service rejection',
    })
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('potion_of_poison', 1),
      brewingServiceOverride: (service) => ({
        ...service,
        planDrinkPotion: () => Effect.fail(failure),
      }),
    }))
    await Effect.runPromise(useBrewingPotion(harness.state, {
      requestId: 'unexpected-potion-plan-failure',
      actor: FISHER,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
      slotIndex: 0,
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: failure,
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('retries a brewing insertion when the two owner snapshots observe different revisions', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('blaze_powder', 1),
    }))
    const coordinator = coordinatorWithObserveRevisionBump(
      harness.baseCoordinator,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    await Effect.runPromise(insertBrewingFuel(harness.state, 'brewing-revision-conflict'))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing',
      error: { _tag: 'WorldRevisionConflict' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([{
      requestId: 'brewing-revision-conflict', action: 'InsertBrewingFuel',
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('rejects a fuel increment that exceeds the valid item stack limit', async () => {
    const maxFuel = Result.getOrThrow(makeItemStack('blaze_powder', StackCount(64)))
    const harness = await Effect.runPromise(makeHarness({
      brewing: Schema.decodeUnknownSync(BrewingServiceStateSchema)({
        bottles: [undefined, undefined, undefined],
        ingredient: undefined,
        fuel: maxFuel,
        fuelCharges: 0,
        brewProgressSecs: 0,
      }),
      playerStorage: playerStorageWithItem('blaze_powder', 1),
    }))
    await Effect.runPromise(insertBrewingFuel(harness.state, 'fuel-stack-at-limit'))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'CandidateBuild', subject: 'Brewing',
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('keeps legacy placement uncorrelated when storage observation fails', async () => {
    const harness = await Effect.runPromise(makeHarness({ omitPlayerStorageRegistration: true }))
    await Effect.runPromise(requestBlockPlacement(harness.state, {
      positionKey: blockPositionKeyOf(blockPosition(BlockAxis(6), BlockAxis(64), BlockAxis(7))),
      heldItem: 'stone',
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toStrictEqual([])
  })

  it('records player and vitals owner snapshot failures for valid pearl throws', async () => {
    const scenarios = [
      { options: { omitPlayerRegistration: true }, subject: 'Player' },
      { options: { omitVitalsRegistration: true }, subject: 'Vitals' },
    ] as const

    await Promise.all(scenarios.map(async (scenario, index) => {
      const harness = await Effect.runPromise(makeHarness({
        playerStorage: playerStorageWithItem('ender_pearl', 1),
        ...scenario.options,
      }))
      await Effect.runPromise(requestEnderPearlThrow(harness.state, {
        requestId: `pearl-owner-snapshot-failure-${index}`,
        dirX: 1,
        dirY: 0,
        dirZ: 0,
        hitDistance: 2,
        inventory: { mode: 'survival', slotIndex: 0 },
      }))

      await harness.run()

      expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: scenario.subject,
        error: { _tag: 'ReplicatedOwnerUnknown' },
      }])
      expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
      expect(harness.commitCalls()).toBe(0)
    }))
  })

  it('records a valid roster serial exhaustion when an endermite would spawn', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entities: { entities: [], nextSerial: EntitySerial(Number.MAX_SAFE_INTEGER) },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 1))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-endermite-serial-exhaustion',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'creative', slotIndex: 0 },
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player',
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('records a pearl vitals snapshot failure when the commit owner is absent', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('ender_pearl', 1),
      commitVitalsOwnerIdOverride: makeReplicatedOwnerId('coverage:missing-vitals'),
    }))
    await Effect.runPromise(requestEnderPearlThrow(harness.state, {
      requestId: 'pearl-missing-vitals-owner',
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      hitDistance: 2,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Vitals',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('records player, storage, and vitals snapshot failures during a pearl plan', async () => {
    const scenarios = [
      { ownerId: GAMEPLAY_PLAYER_OWNER_ID, skip: 1, subject: 'Player' },
      { ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, skip: 0, subject: 'Player' },
      { ownerId: GAMEPLAY_VITALS_OWNER_ID, skip: 0, subject: 'Vitals' },
    ] as const

    await Promise.all(scenarios.map(async (scenario, index) => {
      const harness = await Effect.runPromise(makeHarness({
        playerStorage: playerStorageWithItem('ender_pearl', 1),
      }))
      const interactions = harness.interactionsWithCoordinator(coordinatorWithSnapshotFailure(
        harness.coordinator,
        scenario.ownerId,
        scenario.skip,
      ))
      await Effect.runPromise(requestEnderPearlThrow(harness.state, {
        requestId: `pearl-plan-snapshot-failure-${index}`,
        dirX: 1,
        dirY: 0,
        dirZ: 0,
        hitDistance: 2,
        inventory: { mode: 'survival', slotIndex: 0 },
      }))

      await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

      expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: scenario.subject,
        error: { _tag: 'ReplicatedOwnerUnknown' },
      }])
      expect(await Effect.runPromise(Ref.get(harness.state.enderPearlOutcomes))).toStrictEqual([])
      expect(await Effect.runPromise(Ref.get(harness.state.pendingPearlThrows))).toStrictEqual([])
      expect(harness.commitCalls()).toBe(0)
    }))
  })

  it('reports a missing villager-trade owner ID without observing or mutating trade owners', async () => {
    const villager = makeVillager('missing-trade-owner-id', 'farmer')
    const offer = villager.offers.find(({ input }) => input.item === 'wheat')!
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('wheat', 64),
      villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
      omitVillagerTradesOwnerId: true,
    }))
    await Effect.runPromise(requestVillagerTrade(harness.state, {
      requestId: 'trade-missing-owner-id', villagerId: villager.id, offerId: offer.id,
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported', action: 'VillagerTrade', requestId: 'trade-missing-owner-id',
      reason: 'OwnerRegistrationUnavailable',
    })
    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('records a storage snapshot failure before attempting a villager trade', async () => {
    const villager = makeVillager('trade-storage-snapshot-failure', 'farmer')
    const offer = villager.offers.find(({ input }) => input.item === 'wheat')!
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('wheat', 64),
      villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
      omitPlayerStorageRegistration: true,
    }))
    await Effect.runPromise(requestVillagerTrade(harness.state, {
      requestId: 'trade-storage-snapshot-failure', villagerId: villager.id, offerId: offer.id,
    }))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('rejects a trade whose output cannot fit after consuming its input', async () => {
    const villager = makeVillager('trade-inventory-overflow', 'farmer')
    const offer = villager.offers.find(({ input }) => input.item === 'wheat')!
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItems([
        ['wheat', 64],
        ...Array.from({ length: 35 }, () => ['stone', 64] as const),
      ]),
      villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
    }))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestVillagerTrade(harness.state, {
      requestId: 'trade-inventory-overflow', villagerId: villager.id, offerId: offer.id,
    }))

    await harness.run()

    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([{
      requestId: 'trade-inventory-overflow', villagerId: villager.id, offerId: offer.id,
      _tag: 'Rejected', reason: 'InventoryFull',
    }])
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(harness.commitCalls()).toBe(0)
  })

  it('maps schema-valid unregistered block IDs to air across farming actions', async () => {
    const tillPosition = blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1))
    const plantPosition = blockPosition(BlockAxis(2), BlockAxis(64), BlockAxis(1))
    const harvestPosition = blockPosition(BlockAxis(3), BlockAxis(64), BlockAxis(1))
    const unknownBlock = BlockId(0xffff)
    const harness = await Effect.runPromise(makeHarness({
      blocks: [
        [tillPosition, unknownBlock],
        [blockPosition(BlockAxis(1), BlockAxis(65), BlockAxis(1)), unknownBlock],
        [plantPosition, unknownBlock],
        [blockPosition(BlockAxis(2), BlockAxis(65), BlockAxis(1)), unknownBlock],
        [harvestPosition, unknownBlock],
      ],
      playerStorage: playerStorageWithItems([['iron_hoe', 1], ['potato', 1]]),
      crops: { crops: [{ dimension: 'overworld', position: harvestPosition, crop: 'potato_crop', growthSecs: POTATO_MATURITY_SECS }] },
    }))
    await Effect.runPromise(requestSoilTill(harness.state, 'unknown-till-block', tillPosition, 'iron_hoe'))
    await Effect.runPromise(requestPotatoPlanting(harness.state, 'unknown-plant-block', plantPosition))
    await Effect.runPromise(requestPotatoHarvest(harness.state, 'unknown-harvest-block', harvestPosition, 0.5))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([
      { action: 'TillSoil', requestId: 'unknown-till-block', success: false, durabilityDamage: 0, outcome: { _tag: 'notTillable', found: 'air' } },
      { action: 'PlantPotato', requestId: 'unknown-plant-block', success: false, consumedCount: 0, outcome: { _tag: 'wrongSoil', found: 'air' } },
      {
        action: 'HarvestPotato',
        requestId: 'unknown-harvest-block',
        success: false,
        outcome: { _tag: 'cropOwnerMismatch', block: 'air', registeredCrop: 'potato_crop' },
      },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('rejects planting at an unrepresentable crop cell as an invalid target', async () => {
    const soil = blockPosition(BlockAxis(0), BlockAxis(Number.MAX_SAFE_INTEGER), BlockAxis(0))
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('potato', 1),
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestPotatoPlanting(harness.state, 'plant-invalid-crop-cell', soil))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'PlantPotato',
      requestId: 'plant-invalid-crop-cell',
      heldItem: 'potato',
      success: false,
      consumedCount: 0,
      outcome: { _tag: 'invalidPosition' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toStrictEqual([])
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(storageBefore.state)
    expect(harness.commitCalls()).toBe(0)
  })

  it('handles bone meal crop-owner absence and stale crop registration', async () => {
    const boneMealPosition = blockPosition(BlockAxis(4), BlockAxis(64), BlockAxis(1))
    const plantingPosition = blockPosition(BlockAxis(5), BlockAxis(64), BlockAxis(1))
    const harvestPosition = blockPosition(BlockAxis(6), BlockAxis(64), BlockAxis(1))
    const wheatBlock = Option.getOrThrow(blockIdOf('wheat_crop'))
    const potatoBlock = Option.getOrThrow(blockIdOf('potato_crop'))
    const stale = await Effect.runPromise(makeHarness({
      blocks: [
        [boneMealPosition, wheatBlock],
        [plantingPosition, Option.getOrThrow(blockIdOf('farmland'))],
        [harvestPosition, potatoBlock],
      ],
      playerStorage: playerStorageWithItems([['bone_meal', 1], ['potato', 1]]),
      crops: { crops: [
        { dimension: 'overworld', position: boneMealPosition, crop: 'wheat_crop', growthSecs: 0 },
        { dimension: 'overworld', position: harvestPosition, crop: 'potato_crop', growthSecs: POTATO_MATURITY_SECS },
      ] },
      omitCropRegistration: true,
    }))
    await Effect.runPromise(requestBoneMeal(stale.state, 'bone-meal-crop-owner-missing', boneMealPosition))
    await Effect.runPromise(requestPotatoPlanting(stale.state, 'plant-crop-owner-missing', plantingPosition))
    await Effect.runPromise(requestPotatoHarvest(stale.state, 'harvest-crop-owner-missing', harvestPosition, 0.5))
    await stale.run()

    expect(await Effect.runPromise(Ref.get(stale.state.operationFailures))).toHaveLength(3)
    expect(await Effect.runPromise(Ref.get(stale.state.operationFailures))).toMatchObject(
      Array.from({ length: 3 }, () => ({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })),
    )
    expect(await Effect.runPromise(drainItemUseResults(stale.state))).toStrictEqual([])

    const mismatched = await Effect.runPromise(makeHarness({
      blocks: [[boneMealPosition, wheatBlock]],
      playerStorage: playerStorageWithItem('bone_meal', 1),
      crops: { crops: [] },
    }))
    await Effect.runPromise(requestBoneMeal(mismatched.state, 'bone-meal-crop-not-tracked', boneMealPosition))
    await mismatched.run()
    expect(await Effect.runPromise(drainItemUseResults(mismatched.state))).toMatchObject([{
      action: 'ApplyBoneMeal',
      requestId: 'bone-meal-crop-not-tracked',
      success: false,
      outcome: { _tag: 'cropOwnerMismatch' },
    }])
    expect(await Effect.runPromise(Ref.get(mismatched.state.unsupportedOperations))).toStrictEqual([])
  })

  it('detects crop-owner revision conflicts for bone meal, planting, and harvesting', async () => {
    const wheatPosition = blockPosition(BlockAxis(5), BlockAxis(64), BlockAxis(1))
    const plantPosition = blockPosition(BlockAxis(6), BlockAxis(64), BlockAxis(1))
    const harvestPosition = blockPosition(BlockAxis(7), BlockAxis(64), BlockAxis(1))
    const wheat = Option.getOrThrow(blockIdOf('wheat_crop'))
    const farmland = Option.getOrThrow(blockIdOf('farmland'))
    const potato = Option.getOrThrow(blockIdOf('potato_crop'))
    const scenarios = [
      {
        name: 'bone meal',
        options: {
          blocks: [[wheatPosition, wheat]] as const,
          playerStorage: playerStorageWithItem('bone_meal', 1),
          crops: { crops: [{ dimension: DIMENSION, position: wheatPosition, crop: 'wheat_crop' as const, growthSecs: 0 }] },
        },
        enqueue: (state: GameplayFrameState) => requestBoneMeal(state, 'crop-revision-bone-meal', wheatPosition),
      },
      {
        name: 'planting',
        options: {
          blocks: [[plantPosition, farmland]] as const,
          playerStorage: playerStorageWithItem('potato', 1),
          crops: { crops: [] },
        },
        enqueue: (state: GameplayFrameState) => requestPotatoPlanting(state, 'crop-revision-plant', plantPosition),
      },
      {
        name: 'harvesting',
        options: {
          blocks: [[harvestPosition, potato]] as const,
          crops: { crops: [{ dimension: DIMENSION, position: harvestPosition, crop: 'potato_crop' as const, growthSecs: POTATO_MATURITY_SECS }] },
        },
        enqueue: (state: GameplayFrameState) => requestPotatoHarvest(state, 'crop-revision-harvest', harvestPosition, 0.5),
      },
    ]

    await Promise.all(scenarios.map(async (scenario) => {
      const harness = await Effect.runPromise(makeHarness(scenario.options))
      const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
      const interactions = harness.interactionsWithCoordinator(coordinatorWithRevisionBump(
        harness.baseCoordinator,
        GAMEPLAY_CROPS_OWNER_ID,
      ))
      await Effect.runPromise(scenario.enqueue(harness.state))
      await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

      expect(await Effect.runPromise(Ref.get(harness.state.operationFailures)), scenario.name).toMatchObject([{
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
        error: { _tag: 'WorldRevisionConflict', expected: revisionBefore, actual: revisionBefore + 1 },
      }])
      expect(await Effect.runPromise(drainItemUseResults(harness.state)), scenario.name).toStrictEqual([])
      expect(harness.commitCalls(), scenario.name).toBe(0)
    }))
  })

  it('refuses a planting operation when the crop owner already tracks its target cell', async () => {
    const soil = blockPosition(BlockAxis(8), BlockAxis(64), BlockAxis(1))
    const cropCell = blockPosition(BlockAxis(8), BlockAxis(65), BlockAxis(1))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[soil, Option.getOrThrow(blockIdOf('farmland'))]],
      playerStorage: playerStorageWithItem('potato', 1),
      crops: { crops: [{ dimension: 'overworld', position: cropCell, crop: 'potato_crop', growthSecs: 0 }] },
    }))
    await Effect.runPromise(requestPotatoPlanting(harness.state, 'plant-tracked-cell', soil))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toStrictEqual([])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      action: 'PlantPotato',
      requestId: 'plant-tracked-cell',
      success: false,
      consumedCount: 0,
      outcome: { _tag: 'cropOwnerMismatch', crop: 'potato_crop', at: cropCell },
    }])
    expect(harness.commitCalls()).toBe(0)
  })

  it('rejects a harvest with full storage when the dropped-item owner cannot be observed', async () => {
    const harvestPosition = blockPosition(BlockAxis(9), BlockAxis(64), BlockAxis(1))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[harvestPosition, Option.getOrThrow(blockIdOf('potato_crop'))]],
      crops: { crops: [{ dimension: 'overworld', position: harvestPosition, crop: 'potato_crop', growthSecs: POTATO_MATURITY_SECS }] },
      playerStorage: playerStorageWithItems(Array.from({ length: 36 }, () => ['potato', 64] as const)),
      omitDroppedItemsRegistration: true,
    }))
    await Effect.runPromise(requestPotatoHarvest(harness.state, 'harvest-dropped-owner-missing', harvestPosition, 0.5))

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('covers mining drop-owner omissions, snapshot failures, and legacy retry behavior', async () => {
    const dirt = Option.getOrThrow(blockIdOf('dirt'))
    const omittedIdPosition = blockPosition(BlockAxis(11), BlockAxis(64), BlockAxis(1))
    const omittedId = await Effect.runPromise(makeHarness({
      blocks: [[omittedIdPosition, dirt]],
      playerStorage: fullPlayerStorage(),
      omitDroppedItemsOwnerId: true,
    }))
    await Effect.runPromise(requestBlockBreak(omittedId.state, omittedIdPosition, undefined, {
      dimension: DIMENSION, toolLocation: undefined,
    }))
    await omittedId.run()
    expect(await Effect.runPromise(Ref.get(omittedId.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported', action: 'MineBlock', requestId: expect.any(String),
      reason: 'OwnerRegistrationUnavailable',
    })

    const legacyMissingIdPosition = blockPosition(BlockAxis(12), BlockAxis(64), BlockAxis(1))
    const legacyMissingId = await Effect.runPromise(makeHarness({
      blocks: [[legacyMissingIdPosition, dirt]],
      playerStorage: fullPlayerStorage(),
      omitDroppedItemsOwnerId: true,
    }))
    await Effect.runPromise(Ref.update(legacyMissingId.state.pendingBreaks, (pending) => [
      ...pending,
      blockPositionKeyOf(legacyMissingIdPosition),
    ]))
    await legacyMissingId.run()
    expect(await Effect.runPromise(Ref.get(legacyMissingId.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported', action: 'MineBlock', reason: 'OwnerRegistrationUnavailable',
    })

    const snapshotPosition = blockPosition(BlockAxis(13), BlockAxis(64), BlockAxis(1))
    const snapshotFailure = await Effect.runPromise(makeHarness({
      blocks: [[snapshotPosition, dirt]],
      playerStorage: fullPlayerStorage(),
      omitDroppedItemsRegistration: true,
    }))
    await Effect.runPromise(requestBlockBreak(snapshotFailure.state, snapshotPosition, undefined, {
      dimension: DIMENSION, toolLocation: undefined,
    }))
    await snapshotFailure.run()
    expect(await Effect.runPromise(Ref.get(snapshotFailure.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Mining',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])

    const retryPosition = blockPosition(BlockAxis(14), BlockAxis(64), BlockAxis(1))
    const legacyRetry = await Effect.runPromise(makeHarness({
      blocks: [[retryPosition, dirt]],
      playerStorage: fullPlayerStorage(),
    }))
    await Effect.runPromise(Ref.update(legacyRetry.state.pendingBreaks, (pending) => [
      ...pending,
      blockPositionKeyOf(retryPosition),
    ]))
    legacyRetry.rejectCommits(true)
    await legacyRetry.run()
    expect(await Effect.runPromise(Ref.get(legacyRetry.state.pendingBreaks))).toContain(
      blockPositionKeyOf(retryPosition),
    )
    expect(await Effect.runPromise(Ref.get(legacyRetry.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'Mining',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])

    expect(omittedId.commitCalls()).toBe(0)
    expect(legacyMissingId.commitCalls()).toBe(0)
    expect(snapshotFailure.commitCalls()).toBe(0)
    expect(legacyRetry.commitCalls()).toBe(1)
  })

  it('requeues correlated and legacy breaks when their follow-up observation sees a newer revision', async () => {
    const target = blockPosition(BlockAxis(15), BlockAxis(64), BlockAxis(1))
    const dirt = Option.getOrThrow(blockIdOf('dirt'))
    const assertRevisionRetry = async (requestId: string, correlated: boolean) => {
      const harness = await Effect.runPromise(makeHarness({ blocks: [[target, dirt]] }))
      const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
      const interactions = harness.interactionsWithCoordinator(coordinatorWithObserveRevisionBump(
        harness.baseCoordinator,
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        'after',
      ))
      if (correlated) {
        await Effect.runPromise(requestBlockBreak(harness.state, target, undefined, {
          dimension: DIMENSION,
          toolLocation: undefined,
        }))
      } else {
        await Effect.runPromise(Ref.update(harness.state.pendingBreaks, (pending) => [
          ...pending,
          blockPositionKeyOf(target),
        ]))
      }

      await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

      expect(await Effect.runPromise(harness.store.blockAt(target)), requestId).toBe(dirt)
      expect(await Effect.runPromise(Ref.get(harness.state.pendingBreaks)), requestId).toStrictEqual([
        blockPositionKeyOf(target),
      ])
      expect(await Effect.runPromise(Ref.get(harness.state.operationFailures)), requestId).toMatchObject([{
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Mining',
        error: { _tag: 'ObservationChanged', expectedWorldRevision: revisionBefore, actualWorldRevision: revisionBefore + 1 },
      }])
      expect(await Effect.runPromise(harness.baseCoordinator.revision), requestId).toBe(revisionBefore + 1)
      expect(harness.commitCalls(), requestId).toBe(0)

      await harness.run()

      expect(await Effect.runPromise(harness.store.blockAt(target)), requestId).toBeUndefined()
      expect(await Effect.runPromise(Ref.get(harness.state.pendingBreaks)), requestId).toStrictEqual([])
      expect(harness.commitCalls(), requestId).toBe(1)
      expect(await Effect.runPromise(harness.baseCoordinator.revision), requestId).toBe(revisionBefore + 2)
    }

    await assertRevisionRetry('break-observation-changed-correlated', true)
    await assertRevisionRetry('break-observation-changed-legacy', false)
  })

  it('records food storage and vitals owner snapshot failures', async () => {
    const requestVitals = {
      healthPoints: SPAWN_VITALS.healthPoints,
      hungerPoints: SPAWN_VITALS.hungerPoints,
      maxHungerPoints: SPAWN_VITALS.maxHungerPoints,
    }
    const storageMissing = await Effect.runPromise(makeHarness({ omitPlayerStorageRegistration: true }))
    await Effect.runPromise(requestFoodUse(storageMissing.state, 'food-storage-owner-missing', 'rotten_flesh', requestVitals))
    await storageMissing.run()
    expect(await Effect.runPromise(Ref.get(storageMissing.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])

    const vitalsMissing = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('rotten_flesh', 1),
      commitVitalsOwnerIdOverride: makeReplicatedOwnerId('coverage:food-vitals-missing'),
    }))
    await Effect.runPromise(requestFoodUse(vitalsMissing.state, 'food-vitals-owner-missing', 'rotten_flesh', requestVitals))
    await vitalsMissing.run()
    expect(await Effect.runPromise(Ref.get(vitalsMissing.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Vitals',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(drainItemUseResults(vitalsMissing.state))).toStrictEqual([])
    expect(storageMissing.commitCalls()).toBe(0)
    expect(vitalsMissing.commitCalls()).toBe(0)
  })

  it('reports ignition storage failures, a missing ignition item, and an unloaded portal target', async () => {
    const target = blockPosition(BlockAxis(10), BlockAxis(64), BlockAxis(1))
    const snapshotFailure = await Effect.runPromise(makeHarness({ omitPlayerStorageRegistration: true }))
    await Effect.runPromise(requestItemUse(snapshotFailure.state, 'ignite-storage-owner-missing', target, 'flint_and_steel'))
    await snapshotFailure.run()
    expect(await Effect.runPromise(Ref.get(snapshotFailure.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])

    const missingItem = await Effect.runPromise(makeHarness())
    await Effect.runPromise(requestItemUse(missingItem.state, 'ignite-item-missing', target, 'flint_and_steel'))
    await missingItem.run()
    expect(await Effect.runPromise(Ref.get(missingItem.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported', action: 'IgniteTnt', requestId: 'ignite-item-missing',
      reason: 'OwnerRegistrationUnavailable',
    })

    const unloaded = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItems([['flint_and_steel', 1]]),
    }))
    await Effect.runPromise(requestItemUse(
      unloaded.state,
      'ignite-unloaded-portal-target',
      blockPosition(BlockAxis(32), BlockAxis(64), BlockAxis(1)),
      'flint_and_steel',
    ))
    await unloaded.run()
    expect(await Effect.runPromise(drainItemUseResults(unloaded.state))).toMatchObject([{
      requestId: 'ignite-unloaded-portal-target',
      success: false,
      outcome: { _tag: 'Portal', outcome: { _tag: 'ChunkNotLoaded' } },
    }])
    expect(snapshotFailure.commitCalls()).toBe(0)
    expect(missingItem.commitCalls()).toBe(0)
    expect(unloaded.commitCalls()).toBe(0)
  })

  it('records a TNT-source owner snapshot failure without publishing an ignition result', async () => {
    const target = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const tnt = Option.getOrThrow(blockIdOf('tnt'))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[target, tnt]],
      playerStorage: playerStorageWithItems([['flint_and_steel', 1]]),
      tntOwnerId: TNT_REPLICATED_OWNER_ID,
    }))
    const interactions = harness.interactionsWithCoordinator(coordinatorWithSnapshotFailure(
      harness.baseCoordinator,
      GAMEPLAY_TNT_SOURCES_OWNER_ID,
    ))
    const storageBefore = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestItemUse(harness.state, 'ignite-tnt-sources-snapshot-failed', target, 'flint_and_steel'))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      error: { _tag: 'ReplicatedOwnerUnknown' },
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(harness.store.blockAt(target))).toBe(tnt)
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(storageBefore.state)
    expect(harness.commitCalls()).toBe(0)
  })

  it('requeues TNT ignition when the source snapshot advances the owner revision', async () => {
    const target = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const tnt = Option.getOrThrow(blockIdOf('tnt'))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[target, tnt]],
      playerStorage: playerStorageWithItems([['flint_and_steel', 1]]),
      tntOwnerId: TNT_REPLICATED_OWNER_ID,
    }))
    const coordinator = coordinatorWithRevisionBump(
      harness.coordinator,
      GAMEPLAY_TNT_SOURCES_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const storageBefore = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestItemUse(
      harness.state,
      'ignite-tnt-source-revision-conflict',
      target,
      'flint_and_steel',
    ))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([{
      requestId: 'ignite-tnt-source-revision-conflict',
      heldItem: 'flint_and_steel',
    }])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'OwnerSnapshot',
      subject: 'ItemUse',
      error: {
        _tag: 'WorldRevisionConflict',
        expected: revisionBefore,
        actual: revisionBefore + 1,
      },
    }])
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(harness.store.blockAt(target))).toBe(tnt)
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(storageBefore.state)
    expect(harness.commitCalls()).toBe(1)

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      requestId: 'ignite-tnt-source-revision-conflict',
      heldItem: 'flint_and_steel',
      success: true,
      outcome: { _tag: 'Tnt', outcome: { _tag: 'Lit' } },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.publishedEvents))).toStrictEqual([])
    expect(await Effect.runPromise(harness.store.blockAt(target))).toBeUndefined()
    const storageAfter = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(storageAfter.state.inventoryDurability[0]).not.toStrictEqual(storageBefore.state.inventoryDurability[0])
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 2)
    expect(harness.commitCalls()).toBe(2)
  })

  it('requeues a fire ignition after a concurrent commit and succeeds on the next frame', async () => {
    const target = blockPosition(BlockAxis(8), BlockAxis(64), BlockAxis(8))
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItems([['flint_and_steel', 1]]),
      loadedChunks: PORTAL_WINDOW_CHUNKS,
    }))
    const interactions = harness.interactionsWithCoordinator(coordinatorWithCommitRevisionBump(
      harness.coordinator,
      harness.baseCoordinator,
    ))
    const storageBefore = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const fire = Option.getOrThrow(blockIdOf('fire'))
    await Effect.runPromise(requestItemUse(harness.state, 'fire-revision-conflict', target, 'flint_and_steel'))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toMatchObject([{
      requestId: 'fire-revision-conflict', heldItem: 'flint_and_steel',
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse',
      error: { _tag: 'WorldRevisionConflict' },
    }])
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(harness.store.blockAt(target))).toBeUndefined()
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(storageBefore.state)
    expect(harness.commitCalls()).toBe(1)

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      requestId: 'fire-revision-conflict',
      success: true,
      outcome: { _tag: 'Fire', outcome: { _tag: 'Lit', position: target } },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(harness.store.blockAt(target))).toBe(fire)
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 2)
    expect(harness.commitCalls()).toBe(2)
  })

  it('continues to the next ignition after a nonretryable fire commit failure', async () => {
    const firstTarget = blockPosition(BlockAxis(8), BlockAxis(64), BlockAxis(8))
    const secondTarget = blockPosition(BlockAxis(9), BlockAxis(64), BlockAxis(8))
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItems([['flint_and_steel', 1]]),
      loadedChunks: PORTAL_WINDOW_CHUNKS,
    }))
    const interactions = harness.interactionsWithCoordinator(coordinatorWithFirstCommitFailure(harness.coordinator))
    const fire = Option.getOrThrow(blockIdOf('fire'))
    await Effect.runPromise(requestItemUse(harness.state, 'fire-nonretryable-failure', firstTarget, 'flint_and_steel'))
    await Effect.runPromise(requestItemUse(harness.state, 'fire-after-nonretryable-failure', secondTarget, 'flint_and_steel'))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toMatchObject([{
      requestId: 'fire-after-nonretryable-failure',
      success: true,
      outcome: { _tag: 'Fire', outcome: { _tag: 'Lit', position: secondTarget } },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingItemUses))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])
    expect(await Effect.runPromise(harness.store.blockAt(firstTarget))).toBeUndefined()
    expect(await Effect.runPromise(harness.store.blockAt(secondTarget))).toBe(fire)
    expect(harness.commitCalls()).toBe(1)
  })

  it('maps a potion bottle selection to the registered brewing item', async () => {
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('potion_of_swiftness', 1),
    }))
    await Effect.runPromise(insertBrewingBottle(
      harness.state,
      'insert-swiftness-bottle',
      0,
      { potion: 'speed' },
    ))

    await harness.run()

    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([{
      action: 'InsertBrewingBottle',
      requestId: 'insert-swiftness-bottle',
      success: true,
      outcome: undefined,
    }])
    const brewing = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_BREWING_OWNER_ID,
      BrewingServiceStateSchema,
    ))
    const storage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(brewing.state.bottles[0]).toMatchObject({
      item: 'potion_of_swiftness',
      count: 1,
    })
    expect(storage.state.inventory.slots[0]).toBeUndefined()
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
      GAMEPLAY_BREWING_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    ]))
    expect(harness.commitCalls()).toBe(1)
  })

  it('keeps a legacy placement uncorrelated when its owner commit is rejected', async () => {
    const placementTarget = blockPosition(BlockAxis(5), BlockAxis(64), BlockAxis(7))
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('stone', 1),
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestBlockPlacement(harness.state, {
      positionKey: blockPositionKeyOf(placementTarget),
      heldItem: 'stone',
    }))
    harness.rejectCommits(true)

    await harness.run()

    expect(await Effect.runPromise(harness.store.blockAt(placementTarget))).toBeUndefined()
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'WorldCommit',
      subject: 'ItemUse',
      error: { _tag: 'WorldCommitEmptyRequest' },
    }])
    expect(harness.commitCalls()).toBe(1)
  })

  it('requeues a legacy placement after a concurrent commit advances the owner revision', async () => {
    const placementTarget = blockPosition(BlockAxis(6), BlockAxis(64), BlockAxis(7))
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('stone', 1),
    }))
    const storageBefore = await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.baseCoordinator.revision)
    const interactions = harness.interactionsWithCoordinator(coordinatorWithCommitRevisionBump(
      harness.coordinator,
      harness.baseCoordinator,
    ))
    await Effect.runPromise(requestBlockPlacement(harness.state, {
      positionKey: blockPositionKeyOf(placementTarget),
      heldItem: 'stone',
    }))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingPlacements))).toMatchObject([{
      positionKey: blockPositionKeyOf(placementTarget),
      heldItem: 'stone',
    }])
    expect(await Effect.runPromise(harness.store.blockAt(placementTarget))).toBeUndefined()
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state).toStrictEqual(storageBefore.state)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse',
      error: { _tag: 'WorldRevisionConflict' },
    }])
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect(harness.commitCalls()).toBe(1)

    await harness.run()

    expect(await Effect.runPromise(Ref.get(harness.state.pendingPlacements))).toStrictEqual([])
    expect(await Effect.runPromise(harness.store.blockAt(placementTarget))).toBe(Option.getOrThrow(blockIdOf('stone')))
    expect((await Effect.runPromise(harness.baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).state.inventory.slots[0]).toBeUndefined()
    expect(await Effect.runPromise(harness.baseCoordinator.revision)).toBe(revisionBefore + 2)
    expect(harness.commitCalls()).toBe(2)
  })

  it('keeps a mature crop when its full inventory has no registered drop owner ID', async () => {
    const harvestTarget = blockPosition(BlockAxis(8), BlockAxis(64), BlockAxis(1))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[harvestTarget, Option.getOrThrow(blockIdOf('potato_crop'))]],
      crops: {
        crops: [{
          dimension: DIMENSION,
          position: harvestTarget,
          crop: 'potato_crop',
          growthSecs: POTATO_MATURITY_SECS,
        }],
      },
      playerStorage: fullPlayerStorage(),
      omitDroppedItemsOwnerId: true,
    }))
    const cropBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_CROPS_OWNER_ID,
      CropSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    await Effect.runPromise(requestPotatoHarvest(
      harness.state,
      'harvest-without-drop-owner-id',
      harvestTarget,
      0.5,
    ))

    await harness.run()

    expect(await Effect.runPromise(harness.store.blockAt(harvestTarget))).toBe(
      Option.getOrThrow(blockIdOf('potato_crop')),
    )
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_CROPS_OWNER_ID,
      CropSnapshotSchema,
    ))).toStrictEqual(cropBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported',
      action: 'HarvestPotato',
      requestId: 'harvest-without-drop-owner-id',
      reason: 'OwnerRegistrationUnavailable',
    })
    expect(harness.commitCalls()).toBe(0)
  })

  it('rejects a harvest whose dropped-item snapshot races a newer owner revision', async () => {
    const harvestTarget = blockPosition(BlockAxis(9), BlockAxis(64), BlockAxis(1))
    const harness = await Effect.runPromise(makeHarness({
      blocks: [[harvestTarget, Option.getOrThrow(blockIdOf('potato_crop'))]],
      crops: {
        crops: [{
          dimension: DIMENSION,
          position: harvestTarget,
          crop: 'potato_crop',
          growthSecs: POTATO_MATURITY_SECS,
        }],
      },
      playerStorage: fullPlayerStorage(),
    }))
    const baseCoordinator = harness.baseCoordinator
    const coordinator = coordinatorWithRevisionBump(
      baseCoordinator,
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    )
    const interactions = harness.interactionsWithCoordinator(coordinator)
    const revisionBefore = await Effect.runPromise(baseCoordinator.revision)
    const cropBefore = await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_CROPS_OWNER_ID,
      CropSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedItemsBefore = await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    await Effect.runPromise(requestPotatoHarvest(
      harness.state,
      'harvest-dropped-owner-revision-race',
      harvestTarget,
      0.5,
    ))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(baseCoordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_CROPS_OWNER_ID,
      CropSnapshotSchema,
    )).then(({ state }) => state)).toStrictEqual(cropBefore.state)
    expect(await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    )).then(({ state }) => state)).toStrictEqual(storageBefore.state)
    expect(await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    )).then(({ state }) => state)).toStrictEqual(droppedItemsBefore.state)
    expect(await Effect.runPromise(harness.store.blockAt(harvestTarget))).toBe(
      Option.getOrThrow(blockIdOf('potato_crop')),
    )
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'OwnerSnapshot',
      subject: 'ItemUse',
      error: {
        _tag: 'WorldRevisionConflict',
        expected: revisionBefore,
        actual: revisionBefore + 1,
      },
    }])
    expect(await Effect.runPromise(drainItemUseResults(harness.state))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })
  it('rejects a legacy placement when the player snapshot is unavailable', async () => {
    const target = blockPosition(BlockAxis(10), BlockAxis(64), BlockAxis(2))
    const harness = await Effect.runPromise(makeHarness({
      omitPlayerRegistration: true,
      playerStorage: playerStorageWithItem('stone', 1),
    }))
    await Effect.runPromise(requestBlockPlacement(harness.state, {
      positionKey: blockPositionKeyOf(target),
      heldItem: 'stone',
    }))

    await harness.run()

    expect(await Effect.runPromise(harness.store.blockAt(target))).toBeUndefined()
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported',
      action: 'PlaceBlock',
      reason: 'OwnerRegistrationUnavailable',
    })
    expect(await Effect.runPromise(drainBlockPlacementResults(harness.state))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(0)
  })

  it('reports legacy key-only mining requests when the coordinator is unavailable', async () => {
    const target = blockPosition(BlockAxis(17), BlockAxis(64), BlockAxis(1))
    const harness = await Effect.runPromise(makeHarness({ blocks: [[target, Option.getOrThrow(blockIdOf('dirt'))]] }))
    await Effect.runPromise(Ref.update(harness.state.pendingBreaks, (pending) => [
      ...pending,
      blockPositionKeyOf(target),
    ]))

    await Effect.runPromise(harness.interactionsWithoutCommit.run(DeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported', action: 'MineBlock', reason: 'WorldCommitCoordinatorUnavailable',
    })
    expect(harness.commitCalls()).toBe(0)
  })

  it('places at the lowest writable Y and tracks its lower neighbor', async () => {
    const target = blockPosition(BlockAxis(1), BlockAxis(0), BlockAxis(1))
    const below = blockPosition(BlockAxis(1), BlockAxis(-1), BlockAxis(1))
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('stone', 1),
    }))
    await Effect.runPromise(requestBlockPlacement(harness.state, {
      positionKey: blockPositionKeyOf(target),
      heldItem: 'stone',
    }))

    await harness.run()

    expect(await Effect.runPromise(harness.store.blockAt(target))).toBe(Option.getOrThrow(blockIdOf('stone')))
    expect(harness.lastRequest()?.blockWrite?.edits[0]?.position.y).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.fallingBlocks))).toStrictEqual({
      pending: new Set([blockPositionKeyOf(below)]),
    })
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toStrictEqual([])
    expect(harness.commitCalls()).toBe(1)
  })

  it('records dropped-item candidate failures at the largest valid simulation tick', async () => {
    const minePosition = blockPosition(BlockAxis(15), BlockAxis(64), BlockAxis(1))
    const harvestPosition = blockPosition(BlockAxis(9), BlockAxis(64), BlockAxis(1))
    const dirt = Option.getOrThrow(blockIdOf('dirt'))
    const potatoCrop = Option.getOrThrow(blockIdOf('potato_crop'))
    const mining = await Effect.runPromise(makeHarness({
      blocks: [[minePosition, dirt]],
      playerStorage: fullPlayerStorage(),
    }))
    const harvesting = await Effect.runPromise(makeHarness({
      blocks: [[harvestPosition, potatoCrop]],
      crops: { crops: [{ dimension: DIMENSION, position: harvestPosition, crop: 'potato_crop', growthSecs: POTATO_MATURITY_SECS }] },
      playerStorage: fullPlayerStorage(),
    }))
    await Promise.all([
      Effect.runPromise(Ref.set(mining.state.tickCount, Number.MAX_SAFE_INTEGER)),
      Effect.runPromise(Ref.set(harvesting.state.tickCount, Number.MAX_SAFE_INTEGER)),
      Effect.runPromise(requestBlockBreak(mining.state, minePosition, undefined, {
        dimension: DIMENSION,
        toolLocation: undefined,
      })),
      Effect.runPromise(requestPotatoHarvest(harvesting.state, 'harvest-max-safe-tick', harvestPosition, 0.5)),
    ])
    await Promise.all([mining.run(), harvesting.run()])

    expect(await Effect.runPromise(Ref.get(mining.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'CandidateBuild', subject: 'Mining',
      error: { _tag: 'SchemaError' },
    }])
    expect(await Effect.runPromise(Ref.get(harvesting.state.operationFailures))).toMatchObject([{
      _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse',
      error: { _tag: 'SchemaError' },
    }])
    expect(await Effect.runPromise(mining.store.blockAt(minePosition))).toBe(dirt)
    expect(await Effect.runPromise(harvesting.store.blockAt(harvestPosition))).toBe(potatoCrop)
    expect(mining.commitCalls()).toBe(0)
    expect(harvesting.commitCalls()).toBe(0)
  })
})
