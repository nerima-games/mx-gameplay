import { describe, expect, it } from 'vitest'
import { Brand, Effect, Ref, Result, Schema, Stream } from 'effect'
import * as FastCheck from 'fast-check'
import {
  AngleRadians,
  BlockAxis,
  DimensionIdSchema,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTickSchema,
  StackCount,
  WorldIdSchema,
  blockPosition,
  position,
  DeltaTimeSecs,
} from '@nerima-games/mc-kernel'
import {
  BrewingServiceStateSchema,
  DomainEventBus,
  EntityId,
  FishingStateSchema,
  PlayerStorageSnapshotSchema,
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
  itemStack as makeItemStack,
  launchProjectile,
  type DomainEventBusApi,
  type PlayerStorage,
  type ProjectileLaunch,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
} from '@nerima-games/mc-sim'
import {
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestCollectBrewingBottle,
  requestFishingCancel,
  requestFishingCast,
  requestFishingReel,
  type GameplayFrameState,
} from '../src/stages/registration.js'
import {
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import { INITIAL_DIMENSION, INITIAL_PLAYER_POSE } from '../src/domain/in-memory-player.js'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'
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

const makeHarness = (options: Readonly<{
  readonly fishing?: Schema.Schema.Type<typeof FishingStateSchema>
  readonly projectiles?: Schema.Schema.Type<typeof ProjectileServiceSnapshotSchema>
  readonly brewing?: Schema.Schema.Type<typeof BrewingServiceStateSchema>
  readonly playerStorage?: PlayerStorage
  readonly omitProjectileOwnerId?: boolean
}> = {}) => Effect.gen(function* () {
  const store = yield* makeTransactionalChunkStoreDouble(world([]), ['0,0'])
  const owners = gameplayOwnerRegistrations({
    playerPose: INITIAL_PLAYER_POSE,
    ...(options.fishing === undefined ? {} : { fishing: options.fishing }),
    ...(options.projectiles === undefined ? {} : { projectiles: options.projectiles }),
    ...(options.brewing === undefined ? {} : { brewing: options.brewing }),
    ...(options.playerStorage === undefined ? {} : { playerStorage: options.playerStorage }),
  })
  const baseCoordinator = yield* makeWorldCommitCoordinator({
    world: WORLD_ID,
    owners,
    chunkStores: { forDimension: () => store.api },
  })
  let commitCalls = 0
  let rejectCommit = false
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
    publish: (event) => Ref.update(publishedEvents, (events) => [...events, event]),
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
    droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
    villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
    entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
    brewingOwnerId: GAMEPLAY_BREWING_OWNER_ID,
    statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    fishingOwnerId: GAMEPLAY_FISHING_OWNER_ID,
    ...(options.omitProjectileOwnerId ? {} : { projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID }),
    fishingService,
    brewingService,
    projectileService,
    eventBus,
  }
  const interactions = gameplayStages(
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
  ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)!

  return {
    state,
    coordinator,
    interactions,
    publishedEvents,
    commitCalls: () => commitCalls,
    lastRequest: () => lastRequest,
    rejectCommits: (reject: boolean) => { rejectCommit = reject },
    run: () => Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    )),
  }
})

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
})
