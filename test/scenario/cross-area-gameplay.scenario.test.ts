import { describe, expect, it } from '@effect/vitest'
import {
  AngleRadians,
  AIR_BLOCK_ID,
  DeltaTimeSecs,
  EntityHealthPoints,
  SimulationTick,
  InterpolationFraction,
  DimensionIdSchema,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTickSchema,
  StackCount,
  blockIdOf,
  itemStack as makeItemStack,
  position as kernelPosition,
  type BlockPosition,
  type ItemType,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  FishingElapsedTicksSchema,
  FishingStateSchema,
  FishingWaitTicksSchema,
  PlayerStorageSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  SNOWBALL_PROFILE,
  WorldCommitCoordinator,
  EntityId,
  EntitySerial,
  type EntityManagerApi,
  makeFishingService,
  makeTimeService,
  HungerPoints,
  type DomainEventBusApi,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Brand, Option, Ref, Result, Schema, Stream } from 'effect'
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  initialBehaviourOfKind,
  hostileMobSnapshot,
  maxHealthOfKind,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../../src/domain/entities/mob-frame'
import { CREEPER_FUSE_SECS } from '../../src/domain/mob/creeper-fuse'
import { ZOMBIE_KIND } from '../../src/domain/mob/hostile-combat'
import { DroppedItemOwnerSnapshotSchema } from '../../src/domain/entities/dropped-item'
import { FIRE_TICK_INTERVAL_SECS } from '../../src/domain/fire-lifecycle'
import { SPAWN_PLAYER_VITALS, type PlayerVitals } from '../../src/domain/in-memory-vitals'
import { PORTAL_ACTIVATION_SECS, PORTAL_REENTRY_COOLDOWN_SECS } from '../../src/domain/portal-dwell'
import { GAMEPLAY_FISHING_OWNER_ID, GAMEPLAY_STATUS_EFFECTS_OWNER_ID, GAMEPLAY_VITALS_OWNER_ID, GameplayEntityRosterSchema, GAMEPLAY_DROPPED_ITEMS_OWNER_ID, GAMEPLAY_ENTITIES_OWNER_ID } from '../../src/stages/gameplay-owner-registrations'
import {
  drainItemUseResults,
  drainPortalTravels,
  GameplayFishingItemUseResultSchema,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestBlockBreak,
  requestBucketUse,
  requestDroppedItemPickup,
  requestFishingAdvance,
  requestFishingCast,
  requestFishingReel,
  requestMobSpawn,
  requestStatusEffect,
  requestFoodUse,
  restoreFireLifecycle,
  snapshotFireLifecycle,
  snapshotStatusEffects,
} from '../../src/stages/registration'
import type { GameplayStageCommitServices } from '../../src/stages/registration-core'
import {
  makeGameplayCommitServices,
  makeTransactionalChunkStoreDouble,
} from '../support/transactional-stage-doubles'
import { emptySlots, makeInventoryDouble } from '../support/inventory-service-double'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { makePlayerServiceDouble } from '../support/player-service-double'
import { runFrame, runFrames } from '../support/frame-runner'
import { blockPosition, position } from '../support/coordinate-fixtures'
import { SAND, STONE, world } from '../support/chunk-store-double'
import type { WeatherState } from '../../src/domain/weather'

const itemStack = (item: ItemType, count = 1) => Result.getOrThrow(makeItemStack(item, StackCount(count)))
const oneItem = (item: ItemType) => emptySlots().map((_, index) => (index === 0 ? itemStack(item) : undefined))
const registeredBlock = (name: Parameters<typeof blockIdOf>[0]) => Option.getOrThrow(blockIdOf(name))
const countItem = (slots: ReadonlyArray<{ readonly item: ItemType; readonly count: number } | undefined>, item: ItemType) =>
  slots.reduce((count, slot) => count + (slot?.item === item ? slot.count : 0), 0)

const makeSlice = (
  blocks: ReadonlyArray<readonly [BlockPosition, ReturnType<typeof registeredBlock>]>,
  options: Readonly<{
    readonly inventorySlots?: ReadonlyArray<ReturnType<typeof itemStack> | undefined>
    readonly playerPosition?: Position
    readonly loadedChunks?: ReadonlyArray<string>
    readonly vitals?: PlayerVitals
  }> = {},
) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(world(blocks), options.loadedChunks ?? ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(options.inventorySlots)
    const player = yield* makePlayerServiceDouble({
      feetPosition: options.playerPosition ?? position(0.5, 64, 2.5),
      yawRadians: 0,
      pitchRadians: 0,
    })
    const time = yield* makeTimeService()
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      playerPose: yield* player.api.pose,
      dimension: yield* player.api.dimension,
      ...(options.vitals === undefined ? {} : { vitals: options.vitals }),
    })
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
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
      {},
      { ...commit, statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID },
    )
    return { commit, inventory, player, roster, stages, state, store, time }
  })

const syncEntityOwner = (
  coordinator: WorldCommitCoordinatorApi,
  roster: Readonly<{ api: EntityManagerApi<MobBehaviour> }>,
) =>
  Effect.gen(function* () {
    const entities = yield* roster.api.entities
    const current = yield* coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
    yield* coordinator.commit({
      expectedRevision: current.revision,
      expectedDimensions: [],
      changes: [{
        ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
        state: {
          entities: entities.map((entity) => ({ ...entity, dimension: 'overworld' as const })),
          nextSerial: EntitySerial(entities.length),
        },
      }],
    })
  })

const storageSnapshot = (commit: GameplayStageCommitServices) =>
  commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)

const fishingActor = Brand.nominal<Parameters<typeof requestFishingCast>[1]['actor']>()('x06-angler')
const fishingBobber = Schema.decodeUnknownSync(ProjectileIdSchema)('x06-bobber')

describe('cross-area gameplay scenarios through gameplayStages', () => {
  it.effect('X-01 mines support, creates a drop, picks it up, and settles sand before the craft stage boundary', () =>
    Effect.gen(function* () {
      const floor = blockPosition(0, 62, 0)
      const support = blockPosition(0, 63, 0)
      const sandAt = blockPosition(0, 64, 0)
      const inventorySlots = emptySlots().map((_, index) =>
        index === 0 ? itemStack('wooden_pickaxe') : itemStack('stone', 64),
      )
      const rig = yield* makeSlice([[floor, STONE], [support, registeredBlock('dirt')], [sandAt, SAND]], {
        inventorySlots,
        playerPosition: position(0.5, 63, 0.5),
      })

      yield* requestBlockBreak(rig.state, support, { heldTier: 'wooden' }, {
        dimension: 'overworld',
        toolLocation: { _tag: 'Inventory', slotIndex: 0 },
      })
      yield* runFrames(rig.stages, 3)
      const dropped = yield* rig.commit.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema)
      expect(yield* rig.store.blockAt(support)).toBe(SAND)
      expect(yield* rig.store.blockAt(sandAt)).toBeUndefined()
      expect(dropped.state.items).toHaveLength(1)
      expect(dropped.state.items[0]?.behaviour.item).toBe('dirt')

      yield* rig.inventory.api.remove('stone', 64)
      const currentStorage = yield* storageSnapshot(rig.commit)
      const inventoryStorage = yield* rig.inventory.api.storageSnapshot
      yield* rig.commit.coordinator.commit({
        expectedRevision: currentStorage.revision,
        expectedDimensions: [],
        changes: [{ ownerId: rig.commit.playerStorageOwnerId, state: inventoryStorage }],
      })
      const playerPose = yield* rig.player.api.pose
      yield* requestDroppedItemPickup(rig.state, {
        actor: EntityId('x01-player'),
        tick: SimulationTick(0),
        position: playerPose.feetPosition,
      })
      yield* runFrames(rig.stages, 4)
      const storage = yield* storageSnapshot(rig.commit)
      const finalDrops = yield* rig.commit.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema)
      expect(yield* rig.store.blockAt(support)).toBe(SAND)
      expect(yield* rig.store.blockAt(sandAt)).toBeUndefined()
      expect(countItem(storage.state.inventory.slots, 'dirt')).toBe(1)
      expect(finalDrops.state.items).toStrictEqual([])
    }),
  )

  it.effect('X-02 blasts sand support, drops mob loot, and settles sand through gameplay stages', () =>
    Effect.gen(function* () {
      const blast = blockPosition(5, 64, 5)
      const sandAt = blockPosition(8, 65, 5)
      const sandSupport = blockPosition(8, 64, 5)
      const floor = blockPosition(8, 62, 5)
      const settledSand = blockPosition(8, 63, 5)
      const store = yield* makeTransactionalChunkStoreDouble(
        world([[blast, STONE], [sandAt, SAND], [sandSupport, STONE], [floor, STONE]]),
        ['0,0'],
      )
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble(emptySlots())
      const player = yield* makePlayerServiceDouble({
        feetPosition: position(blast.x, blast.y, blast.z),
        yawRadians: 0,
        pitchRadians: 0,
      })
      const time = yield* makeTimeService()
      const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
        playerPose: yield* player.api.pose,
        dimension: yield* player.api.dimension,
      })
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator: commit.coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
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
        {},
        commit,
      )
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: position(blast.x, blast.y, blast.z),
        healthPoints: EntityHealthPoints(CREEPER_MAX_HEALTH),
        behaviour: { _tag: 'Lit', burnedSecs: CREEPER_FUSE_SECS - 0.01 },
      })
      yield* roster.api.spawn({
        kind: ZOMBIE_KIND,
        feetPosition: position(blast.x + 1, blast.y, blast.z),
        healthPoints: EntityHealthPoints(1),
        behaviour: hostileMobSnapshot(undefined),
      })
      yield* syncEntityOwner(commit.coordinator, roster)
      yield* Ref.set(state.rollSeed, 3)

      yield* runFrame(stages, DeltaTimeSecs(0.02))
      const dropped = yield* commit.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema)
      const entities = yield* commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(yield* store.blockAt(blast)).toBeUndefined()
      expect(yield* store.blockAt(sandSupport)).toBe(SAND)
      expect(yield* store.blockAt(sandAt)).toBeUndefined()
      expect(entities.state.entities.some(({ kind }) => kind === ZOMBIE_KIND)).toBe(false)
      expect(dropped.state.items).toHaveLength(1)
      expect(dropped.state.items[0]?.behaviour).toMatchObject({ item: 'rotten_flesh', count: 1 })

      yield* runFrames(stages, 3)
      expect(yield* store.blockAt(floor)).toBe(STONE)
      expect(yield* store.blockAt(settledSand)).toBe(SAND)
    }),
  )

  it.effect('X-03 places water from a bucket, reacts with lava in that frame, and keeps lava in a no-input control', () =>
    Effect.gen(function* () {
      const waterAt = blockPosition(0, 64, 0)
      const lavaAt = blockPosition(1, 64, 0)
      const lava = registeredBlock('lava')
      const bucket = yield* makeSlice([[lavaAt, lava]], { inventorySlots: oneItem('water_bucket') })
      yield* requestBucketUse(bucket.state, 'x03-bucket', waterAt, 'water_bucket', 'overworld')
      yield* runFrame(bucket.stages)
      expect(yield* bucket.store.blockAt(waterAt)).toBe(registeredBlock('water'))
      expect(yield* bucket.store.blockAt(lavaAt)).toBe(registeredBlock('obsidian'))
      expect(countItem((yield* storageSnapshot(bucket.commit)).state.inventory.slots, 'bucket')).toBe(1)

      yield* runFrame(bucket.stages)
      expect(yield* bucket.store.blockAt(lavaAt)).toBe(registeredBlock('obsidian'))
      expect(yield* bucket.store.blockAt(blockPosition(0, 63, 0))).toBe(registeredBlock('water'))

      const control = yield* makeSlice([[lavaAt, lava]])
      yield* runFrames(control.stages, 2)
      expect(yield* control.store.blockAt(waterAt)).toBeUndefined()
      expect(yield* control.store.blockAt(lavaAt)).toBe(lava)
    }),
  )

  it.effect('X-04 damages a mob in active fire and spreads through adjacent fuel across frames', () =>
    Effect.gen(function* () {
      const fireAt = blockPosition(0, 64, 0)
      const fuelAt = blockPosition(1, 64, 0)
      const secondFuelAt = blockPosition(2, 64, 0)
      const fire = registeredBlock('fire')
      const fuel = registeredBlock('oak_planks')
      const rig = yield* makeSlice([[fireAt, fire], [fuelAt, fuel], [secondFuelAt, fuel]])
      const mobKind = CREEPER_KIND
      yield* rig.roster.api.spawn({
        kind: mobKind,
        feetPosition: position(fireAt.x, fireAt.y, fireAt.z),
        healthPoints: EntityHealthPoints(maxHealthOfKind(mobKind)),
        behaviour: initialBehaviourOfKind(mobKind),
      })
      yield* syncEntityOwner(rig.commit.coordinator, rig.roster)
      const before = yield* rig.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      const initialFire = yield* snapshotFireLifecycle(rig.state)
      yield* restoreFireLifecycle(rig.state, {
        ...initialFire,
        fires: [{ position: fireAt, ageTicks: 0 }],
        seed: 1,
      })

      yield* runFrame(rig.stages, DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS))
      const lit = yield* rig.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(yield* rig.store.blockAt(fireAt)).toBe(fire)
      expect(lit.state.entities[0]?.healthPoints).toBeLessThan(Number(before.state.entities[0]?.healthPoints))
      expect(yield* rig.store.blockAt(fuelAt)).toBe(fire)

      yield* runFrame(rig.stages, DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS))
      const final = yield* rig.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(final.state.entities).toHaveLength(1)
      expect(yield* rig.store.blockAt(secondFuelAt)).toBe(fire)
    }),
  )

  it.effect('X-05 spawns a hostile mob at night and observes that daylight does not trigger the absent despawn rule', () =>
    Effect.gen(function* () {
      const rig = yield* makeSlice([[blockPosition(20, 63, 0), STONE]], { loadedChunks: ['0,0', '1,0'] })
      yield* rig.time.setTimeOfDay(InterpolationFraction(0))
      const attempt: MobSpawnAttempt = {
        candidate: {
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          timeOfDay: 0,
          distanceToPlayerBlocksXZ: 20,
          dimension: 'overworld',
        },
        kind: CREEPER_KIND,
        feetPosition: position(20.5, 64, 0.5),
      }
      yield* requestMobSpawn(rig.state, attempt)
      yield* runFrame(rig.stages, DeltaTimeSecs(0))
      const night = yield* rig.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(night.state.entities).toHaveLength(1)
      expect(night.state.entities[0]?.kind).toBe(CREEPER_KIND)

      yield* rig.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* runFrame(rig.stages, DeltaTimeSecs(0))
      const daylight = yield* rig.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(daylight.state.entities).toHaveLength(1)
      expect(daylight.state.entities[0]?.id).toBe(night.state.entities[0]?.id)
    }),
  )

  it.effect('X-06 catches a fish during rain through the registered fishing stages', () =>
    Effect.gen(function* () {
      const worldState = yield* makeSlice([])
      const eventBus: DomainEventBusApi = { publish: () => Effect.void, events: Stream.empty }
      const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
        Effect.provideService(DomainEventBus, eventBus),
        Effect.provideService(WorldCommitCoordinator, worldState.commit.coordinator),
      )
      const commit = { ...worldState.commit, fishingOwnerId: GAMEPLAY_FISHING_OWNER_ID, fishingService, eventBus }
      const stages = gameplayStages(
        worldState.state,
        worldState.store.api,
        worldState.roster.api,
        worldState.inventory.api,
        worldState.player.api,
        worldState.time,
        undefined,
        undefined,
        {},
        commit,
      )
      yield* Ref.set(worldState.state.weather, { weather: 'rain', remainingSecs: 600 } satisfies WeatherState)
      const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
      yield* requestFishingCast(worldState.state, {
        requestId: 'x06-cast',
        actor: fishingActor,
        bobber: fishingBobber,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(0),
        dimension,
        launch: {
          position: kernelPosition(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
          yawRadians: AngleRadians(0),
          pitchRadians: AngleRadians(0),
          speed: Brand.nominal<Parameters<typeof requestFishingCast>[1]['launch']['speed']>()(1),
        },
        profile: SNOWBALL_PROFILE,
        rod: null,
        environment: { hasWater: true, hasSkyAccess: true, isRaining: true, isOpenWater: true },
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      const cast = yield* commit.coordinator.snapshot(GAMEPLAY_FISHING_OWNER_ID, FishingStateSchema)
      expect(cast.state.rods).toMatchObject([{ actor: fishingActor, bobber: fishingBobber, phase: 'cast' }])

      yield* requestFishingAdvance(worldState.state, {
        requestId: 'x06-advance',
        actor: fishingActor,
        elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(120),
        waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
        approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
        biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
        environment: { hasWater: true },
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      const bite = yield* commit.coordinator.snapshot(GAMEPLAY_FISHING_OWNER_ID, FishingStateSchema)
      expect(bite.state.rods[0]?.phase).toBe('bite')

      yield* requestFishingReel(worldState.state, 'x06-reel', fishingActor)
      yield* runFrame(stages, DeltaTimeSecs(0))
      const results = (yield* drainItemUseResults(worldState.state)).map((result) =>
        Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(result),
      )
      const reel = results.find((result) => result.action === 'ReelFishing')
      expect(reel).toMatchObject({ action: 'ReelFishing', success: true, outcome: { _tag: 'Caught' } })
      const projectiles = yield* commit.coordinator.snapshot(PROJECTILE_REPLICATED_OWNER_ID, ProjectileServiceSnapshotSchema)
      expect(projectiles.state.projectiles.map(({ id }) => id)).not.toContain(fishingBobber)
    }),
  )

  it.effect('X-07 round-trips through Nether portals while keeping both portal cells readable', () =>
    Effect.gen(function* () {
      // Portal travel does not register a travel-time chunk-window refresh.
      const overworldCell = blockPosition(8, 64, 8)
      const netherCell = blockPosition(1, 64, 1)
      const netherPortal = registeredBlock('nether_portal')
      const rig = yield* makeSlice([[overworldCell, netherPortal], [netherCell, netherPortal]], {
        playerPosition: position(overworldCell.x, overworldCell.y, overworldCell.z),
      })
      const delta = DeltaTimeSecs(0.1)
      const framesFor = (seconds: number) => Math.ceil(seconds / 0.1)
      const activationFrames = framesFor(PORTAL_ACTIVATION_SECS) + 1
      const cooldownFrames = framesFor(PORTAL_REENTRY_COOLDOWN_SECS)
      const probeFrames = Math.max(0, cooldownFrames - 1)
      const returnFrames = cooldownFrames - probeFrames + framesFor(PORTAL_ACTIVATION_SECS)

      expect(yield* rig.store.blockAt(overworldCell)).toBe(netherPortal)
      yield* runFrames(rig.stages, activationFrames, delta)
      const outbound = yield* rig.commit.coordinator.snapshot(rig.commit.playerOwnerId, Schema.Unknown)
      expect(outbound.state).toMatchObject({ pose: { feetPosition: { dimension: 'nether', x: 1, y: 64, z: 1 } } })
      expect((yield* drainPortalTravels(rig.state))[0]?.plan.toDimension).toBe('nether')

      yield* runFrames(rig.stages, probeFrames, delta)
      const cooling = yield* rig.commit.coordinator.snapshot(rig.commit.playerOwnerId, Schema.Unknown)
      expect(cooling.state).toMatchObject({ pose: { feetPosition: { dimension: 'nether', x: 1, y: 64, z: 1 } } })
      expect(yield* rig.store.blockAt(netherCell)).toBe(netherPortal)

      yield* runFrames(rig.stages, returnFrames, delta)
      const returned = yield* rig.commit.coordinator.snapshot(rig.commit.playerOwnerId, Schema.Unknown)
      expect(returned.state).toMatchObject({ pose: { feetPosition: { dimension: 'overworld', x: 8, y: 64, z: 8 } } })
      expect((yield* drainPortalTravels(rig.state))[0]?.plan.toDimension).toBe('overworld')
      expect(yield* rig.store.blockAt(overworldCell)).toBe(netherPortal)
      expect(yield* rig.store.blockAt(netherCell)).toBe(netherPortal)
    }),
  )

  it.effect('X-08 eats food while poisoned, then observes the remaining poison pulse in player vitals', () =>
    Effect.gen(function* () {
      const vitals: PlayerVitals = {
        ...SPAWN_PLAYER_VITALS,
        hungerPoints: HungerPoints(10),
      }
      const rig = yield* makeSlice([], { inventorySlots: oneItem('cod'), vitals })
      yield* requestStatusEffect(rig.state, { type: 'poison', durationSecs: 5 })
      yield* runFrame(rig.stages, DeltaTimeSecs(0))
      expect((yield* snapshotStatusEffects(rig.state, { ...rig.commit, statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID })).effects)
        .toMatchObject([{ type: 'poison', remainingSecs: 5 }])

      yield* requestFoodUse(rig.state, 'x08-eat', 'cod', {
        healthPoints: vitals.healthPoints,
        hungerPoints: vitals.hungerPoints,
        maxHungerPoints: vitals.maxHungerPoints,
      })
      yield* runFrame(rig.stages, DeltaTimeSecs(0))
      const afterEating = yield* storageSnapshot(rig.commit)
      expect(countItem(afterEating.state.inventory.slots, 'cod')).toBe(0)
      expect((yield* snapshotStatusEffects(rig.state, { ...rig.commit, statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID })).effects)
        .toMatchObject([{ type: 'poison' }])

      yield* runFrame(rig.stages, DeltaTimeSecs(1))
      const vitalsAfterPulse = yield* rig.commit.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, Schema.Unknown)
      expect(vitalsAfterPulse.state).toMatchObject({ vitals: { hungerPoints: 12 } })
      expect(Number((vitalsAfterPulse.state as { vitals: PlayerVitals }).vitals.healthPoints))
        .toBeLessThan(Number(vitals.healthPoints))
      expect((yield* snapshotStatusEffects(rig.state, { ...rig.commit, statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID })).effects)
        .toMatchObject([{ type: 'poison' }])
    }),
  )
})
