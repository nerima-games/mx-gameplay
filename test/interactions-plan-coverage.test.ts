import { describe, expect, it } from 'vitest'
import { Brand, Effect, Option, Ref, Result, Schema, Stream } from 'effect'
import * as FastCheck from 'fast-check'
import {
  AngleRadians,
  BlockAxis,
  BlockId,
  DimensionIdSchema,
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
  DomainEventBus,
  EntityId,
  EntityKind,
  FishingStateSchema,
  FishingElapsedTicksSchema,
  FishingWaitTicksSchema,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  PlayerStorageSnapshotSchema,
  PlayerServiceSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
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
  type ReplicatedOwnerUnknown,
  type ReplicatedSnapshot,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
  SPAWN_VITALS,
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
  requestBlockPlacementCommand,
  requestBlockUse,
  requestBowShot,
  requestEnderPearlThrow,
  requestMeleeAttack,
  requestVillagerTrade,
  requestCollectBrewingBottle,
  requestFishingAdvance,
  requestFishingCancel,
  requestFishingCast,
  requestFishingReel,
  requestBlockPlacement,
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
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  gameplayOwnerRegistrations,
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
}> = {}) => Effect.gen(function* () {
  const store = yield* makeTransactionalChunkStoreDouble(world(options.blocks ?? []), ['0,0'])
  const registrations = gameplayOwnerRegistrations({
    playerPose: INITIAL_PLAYER_POSE,
    ...(options.fishing === undefined ? {} : { fishing: options.fishing }),
    ...(options.projectiles === undefined ? {} : { projectiles: options.projectiles }),
    ...(options.brewing === undefined ? {} : { brewing: options.brewing }),
    ...(options.playerStorage === undefined ? {} : { playerStorage: options.playerStorage }),
    ...(options.vitals === undefined ? {} : { vitals: options.vitals }),
    ...(options.villagerTrades === undefined ? {} : { villagerTrades: options.villagerTrades }),
    ...(options.entities === undefined ? {} : { entities: options.entities }),
  })
  const owners = registrations.filter(({ ownerId }) =>
    !(options.omitVillagerTradesRegistration && ownerId === GAMEPLAY_VILLAGER_TRADES_OWNER_ID) &&
    !(options.omitDroppedItemsRegistration && ownerId === GAMEPLAY_DROPPED_ITEMS_OWNER_ID) &&
    !(options.omitPlayerStorageRegistration && ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID) &&
    !(options.omitBrewingRegistration && ownerId === GAMEPLAY_BREWING_OWNER_ID) &&
    !(options.omitStatusEffectsRegistration && ownerId === GAMEPLAY_STATUS_EFFECTS_OWNER_ID) &&
    !(options.omitProjectileRegistration && ownerId === PROJECTILE_REPLICATED_OWNER_ID),
  )
  const baseCoordinator = yield* makeWorldCommitCoordinator({
    world: WORLD_ID,
    owners,
    chunkStores: { forDimension: () => store.api },
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
  const brewingService = yield* makeBrewingService(GAMEPLAY_BREWING_OWNER_ID)
  const projectileService = yield* makeProjectileService().pipe(
    Effect.provideService(WorldCommitCoordinator, coordinator),
    Effect.provideService(DomainEventBus, eventBus),
  )
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const roster = yield* makeEntityManager<MobBehaviour>()
  const time = yield* makeTimeService()
  const commit = {
    coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    cropOwnerId: GAMEPLAY_CROPS_OWNER_ID,
    ...(options.omitDroppedItemsOwnerId ? {} : { droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID }),
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
    villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
    entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
    brewingOwnerId: GAMEPLAY_BREWING_OWNER_ID,
    ...(options.omitStatusEffectsOwnerId ? {} : { statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID }),
    fishingOwnerId: GAMEPLAY_FISHING_OWNER_ID,
    ...(options.omitProjectileOwnerId ? {} : { projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID }),
    fishingService,
    brewingService,
    projectileService,
    ...(options.omitInteractionEventBus ? {} : { eventBus }),
  }
  const interactionsWithCoordinator = (selectedCoordinator: WorldCommitCoordinatorApi) =>
    gameplayStages(
      state,
      store.api,
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
    store.api,
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
    store.api,
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

    for (const scenario of scenarios) {
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
    }
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

    for (const scenario of scenarios) {
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
    }
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

    for (const scenario of scenarios) {
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
    }
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
      reach: 3,
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

    for (const scenario of scenarios) {
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
    }
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

  it('rejects a trade when storage and trade snapshots span a concurrent owner revision', async () => {
    const villager = makeVillager('revision-coverage-trader', 'farmer')
    const offer = villager.offers.find(({ input }) => input.item === 'wheat')!
    const harness = await Effect.runPromise(makeHarness({
      playerStorage: playerStorageWithItem('wheat', 64),
      villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
    }))
    const baseCoordinator = harness.baseCoordinator
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
    await Effect.runPromise(requestVillagerTrade(harness.state, {
      requestId: 'trade-revision-conflict',
      villagerId: villager.id,
      offerId: offer.id,
    }))

    await Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)))

    const tradesAfter = await Effect.runPromise(baseCoordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))
    expect(injected).toBe(true)
    expect(harness.commitCalls()).toBe(0)
    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([])
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
      reach: 3,
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
      reach: 3,
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
      reach: 3,
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
      reach: 3,
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
      reach: 3,
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
      reach: 3,
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
      reach: 3,
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
      reach: 3,
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
      reach: 3,
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
      reach: 3,
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
