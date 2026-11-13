import { describe, expect, it } from '@effect/vitest'
import {
  AIR_BLOCK_ID,
  AngleRadians,
  AttackRangeDistance,
  DeltaTimeSecs,
  DimensionIdSchema,
  EntityHealthPoints,
  EntitySerial,
  ProjectileIdSchema,
  blockIdOf,
  enchantmentsComponent,
  itemComponents,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  EntityId,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  FishingElapsedTicksSchema,
  FishingStateSchema,
  FishingWaitTicksSchema,
  InventoryService,
  PlayerStorageSnapshotSchema,
  PlayerServiceSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  ReplicatedOwnerUnknown,
  SNOWBALL_PROFILE,
  TimeService,
  WorldCommitCoordinator,
  type WorldCommitCoordinatorApi,
  durabilityForItem,
  itemStack,
  launchProjectile,
  makeTimeService,
  type DomainEventBusApi,
  type ProjectileLaunch,
  type Slot,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Layer, Option, Ref, Result, Schema, Stream } from 'effect'
import { ChunkStore } from '@nerima-games/mc-worldgen'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../src/stages/gameplay-owner-registrations.js'
import {
  drainItemUseResults,
  drainMeleeAttackResults,
  getMiningProgressFraction,
  makeGameplayFrameStateForOwner,
  requestBlockMining,
  requestEnchantmentTableApply,
  requestEnchantmentTableOffers,
  requestFishingReel,
  requestFishingAdvance,
  requestMeleeAttack,
  drainEnchantmentTableResults,
  gameplayStages,
} from '../src/stages/registration.js'
import {
  drainGameplayUnsupportedOperations,
  entityManagerTag,
} from '../src/stages/registration-core.js'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { makeGameplayStagesWithState } from '../src/stages/gameplay-stage-composition.js'
import { SPIDER_KIND } from '../src/domain/mob/mob-ecosystem.js'
import { emptyWorldStoreLayer, world } from './support/chunk-store-double.js'
import { emptyRosterLayer } from './support/entity-manager-double.js'
import { emptyInventoryLayer } from './support/inventory-service-double.js'
import {
  gameplayCommitServicesLayer,
  makeGameplayCommitServices,
  makeTransactionalChunkStoreDouble,
} from './support/transactional-stage-doubles.js'
import { blockPosition, position as fixturePosition } from './support/coordinate-fixtures.js'
import { runFrame } from './support/frame-runner.js'

const FISHING_ACTOR = EntityId('coverage-fisher')
const FISHING_BOBBER = Schema.decodeUnknownSync(ProjectileIdSchema)('coverage-fishing-bobber')
const FISHING_DIMENSION = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const FISHING_LAUNCH: ProjectileLaunch = {
  position: fixturePosition(0, 64, 0),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: Brand.nominal<ProjectileLaunch['speed']>()(1),
}

const eventBus: DomainEventBusApi = {
  publish: () => Effect.void,
  events: Stream.empty,
}

const productionWorld = Layer.provideMerge(
  gameplayCommitServicesLayer,
  Layer.mergeAll(
    emptyWorldStoreLayer,
    emptyRosterLayer,
    Layer.effect(TimeService, makeTimeService()),
    emptyInventoryLayer,
    Layer.succeed(DomainEventBus, eventBus),
  ),
)

const productionWorldWithStore = (storeLayer: Layer.Layer<ChunkStore>) => Layer.provideMerge(
  gameplayCommitServicesLayer,
  Layer.mergeAll(
    storeLayer,
    emptyRosterLayer,
    Layer.effect(TimeService, makeTimeService()),
    emptyInventoryLayer,
    Layer.succeed(DomainEventBus, eventBus),
  ),
)

const storageWithSlots = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  slots: ReadonlyArray<Slot>,
) => Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)({
  ...storage,
  inventory: { ...storage.inventory, slots },
  inventoryDurability: slots.map((slot) => slot === undefined ? null : durabilityForItem(slot.item)),
})

const MELEE_TARGET_ID = EntityId('coverage-spider')
const meleeTarget = {
  id: MELEE_TARGET_ID,
  kind: SPIDER_KIND,
  feetPosition: fixturePosition(0, 64.72, -2),
  healthPoints: EntityHealthPoints(20),
  behaviour: undefined,
  dimension: 'overworld',
} as const
const meleeEnchantments = Result.getOrThrow(enchantmentsComponent({
  'minecraft:bane_of_arthropods': 2,
  'minecraft:fire_aspect': 2,
  'minecraft:unbreaking': 3,
}))
const meleeComponents = Result.getOrThrow(itemComponents('diamond_sword', { enchantments: meleeEnchantments }))
const meleePlayerPose = {
  feetPosition: fixturePosition(0, 64, 0),
  yawRadians: 0,
  pitchRadians: 0,
} as const

// Match the passing scenario's owner initialization while exercising the
// production stage builder below.
const productionMeleeWorld = Layer.provideMerge(
  Layer.effect(
    WorldCommitCoordinator,
    Effect.gen(function* () {
      const store = yield* ChunkStore
      const inventory = yield* InventoryService
      const initialStorage = yield* inventory.storageSnapshot
      const slots: Array<Slot> = [...initialStorage.inventory.slots]
      slots[0] = Result.getOrThrow(itemStack('diamond_sword', 1, { components: meleeComponents }))
      const services = yield* makeGameplayCommitServices(store, inventory, {
        entities: { entities: [meleeTarget], nextSerial: EntitySerial(1) },
        playerPose: meleePlayerPose,
        playerStorage: storageWithSlots(initialStorage, slots),
      })
      return services.coordinator
    }),
  ),
  Layer.mergeAll(
    emptyWorldStoreLayer,
    emptyRosterLayer,
    Layer.effect(TimeService, makeTimeService()),
    emptyInventoryLayer,
    Layer.succeed(DomainEventBus, eventBus),
  ),
)

describe('production interactions-stage coverage', () => {
  it.effect('routes arthropod damage, Unbreaking preservation, and Fire Aspect through a melee request', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      const [entitiesBeforeAttack, playerBeforeAttack, storageBeforeAttack] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
        coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
      ])
      expect(entitiesBeforeAttack.state.entities).toMatchObject([{
        id: MELEE_TARGET_ID,
        feetPosition: fixturePosition(0, 64.72, -2),
      }])
      expect(playerBeforeAttack.state.pose).toMatchObject({
        feetPosition: { dimension: 'overworld', ...fixturePosition(0, 64, 0) },
        yawRadians: 0,
        pitchRadians: 0,
      })
      const initialSeed = yield* Ref.get(state.rollSeed)
      const stages = yield* makeGameplayStagesWithState(state)

      yield* requestMeleeAttack(state, {
        requestId: 'arthropod-enchanted-melee',
        origin: fixturePosition(0, 64, 0),
        direction: fixturePosition(0, 0, 1),
        reach: AttackRangeDistance(3),
        damage: 7,
        toolLocation: { _tag: 'Inventory', slotIndex: 0 },
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainMeleeAttackResults(state)).toStrictEqual([{
        requestId: 'arthropod-enchanted-melee',
        success: true,
        target: { id: MELEE_TARGET_ID, distance: 2 },
      }])
      const entitiesAfter = yield* coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      // Vanilla: diamond sword base damage 7 plus Bane II's 2.5 × 2 = 12 total.
      expect(Number(entitiesAfter.state.entities[0]?.healthPoints)).toBe(8)
      expect((yield* Ref.get(state.fireLifecycle)).burningActors).toMatchObject([
        { id: MELEE_TARGET_ID, remainingTicks: 160 },
      ])

      const storageAfterAttack = yield* coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(storageAfterAttack.state.inventoryDurability[0])
        .toStrictEqual(storageBeforeAttack.state.inventoryDurability[0])
      expect(yield* Ref.get(state.rollSeed)).not.toBe(initialSeed)
    }).pipe(Effect.provide(Layer.orDie(productionMeleeWorld))),
  )

  it.effect('uses an inventory-held fishing rod for a production reel request', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      const storage = yield* coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      const enchantments = Result.getOrThrow(enchantmentsComponent({
        'minecraft:lure': 1,
        'minecraft:luck_of_the_sea': 3,
      }))
      const components = Result.getOrThrow(itemComponents('fishing_rod', { enchantments }))
      const slots: Array<Slot> = [...storage.state.inventory.slots]
      slots[0] = Result.getOrThrow(itemStack('fishing_rod', 1, { components }))
      const storageWithRod = storageWithSlots(storage.state, slots)
      const fishingCandidate = Schema.decodeUnknownSync(FishingStateSchema)({
        rods: [{ actor: FISHING_ACTOR, bobber: FISHING_BOBBER, phase: 'bite' }],
      })
      const projectileCandidate = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [{
          id: FISHING_BOBBER,
          dimension: FISHING_DIMENSION,
          shooter: FISHING_ACTOR,
          kind: 'projectile',
          profile: SNOWBALL_PROFILE,
          projectile: launchProjectile({ ...FISHING_LAUNCH, shooterId: FISHING_ACTOR }),
        }],
      })
      yield* coordinator.commit({
        expectedRevision: storage.revision,
        expectedDimensions: [],
        changes: [
          { ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: storageWithRod },
          { ownerId: GAMEPLAY_FISHING_OWNER_ID, state: fishingCandidate },
          { ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectileCandidate },
        ],
      })
      const stages = yield* makeGameplayStagesWithState(state)
      yield* Ref.set(state.rollSeed, 113_335)

      yield* requestFishingReel(state, 'inventory-rod-reel', FISHING_ACTOR, {
        _tag: 'Inventory',
        slotIndex: 0,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainItemUseResults(state)).toMatchObject([{
        action: 'ReelFishing',
        requestId: 'inventory-rod-reel',
        success: true,
        outcome: { _tag: 'Caught', item: 'name_tag' },
      }])
      const storageAfter = yield* coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(storageAfter.state.inventoryDurability[0]?.current).toBe(63)
      expect(storageAfter.state.inventory.slots[0]?.item).toBe('fishing_rod')
      expect(storageAfter.state.inventory.slots.some((slot) => slot?.item === 'name_tag')).toBe(true)
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('reports an invalid fishing wait from the queued public request through production stages', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      const stages = yield* makeGameplayStagesWithState(state)

      yield* requestFishingAdvance(state, {
        requestId: 'invalid-fishing-wait',
        actor: FISHING_ACTOR,
        elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(0),
        waitTicks: Brand.nominal<Schema.Schema.Type<typeof FishingWaitTicksSchema>>()(-1),
        approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
        biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
        environment: { hasWater: true },
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing',
      }))
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('uses the no-tool mining path for a breakable block, then clears progress when the target is air', () =>
    Effect.gen(function* () {
      const position = blockPosition(1, 64, 1)
      const torch = Option.getOrThrow(blockIdOf('torch'))
      const transactionalStore = yield* makeTransactionalChunkStoreDouble(
        world([[position, torch]]),
        ['0,0'],
      )

      return yield* Effect.gen(function* () {
        const coordinator = yield* WorldCommitCoordinator
        const store = yield* ChunkStore
        const state = yield* makeGameplayFrameStateForOwner({
          coordinator,
          vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
        })
        const storage = yield* coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        )
        const slots: Array<Slot> = [...storage.state.inventory.slots]
        slots[0] = undefined
        yield* coordinator.commit({
          expectedRevision: storage.revision,
          expectedDimensions: [],
          changes: [{ ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: storageWithSlots(storage.state, slots) }],
        })
        const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
        const stages = yield* makeGameplayStagesWithState(state)
        const emptySlot = { _tag: 'Inventory' as const, slotIndex: 0 }

        yield* requestBlockMining(state, { position, dimension, toolLocation: emptySlot })
        yield* runFrame(stages, DeltaTimeSecs(1 / 20))
        expect(yield* getMiningProgressFraction(state)).toBeGreaterThan(0)

        yield* requestBlockMining(state, {
          position,
          dimension,
          toolLocation: emptySlot,
        })
        // Torch hardness is 1 and its default no-tool requirement permits hand mining: 30 ticks / 20 = 1.5 s.
        yield* runFrame(stages, DeltaTimeSecs(1.45))

        expect(yield* store.getBlock(position)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })

        const after = yield* coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        )
        expect(after.state.inventory.slots[0]?.item).toBe('torch')
        expect(after.state.inventory.slots.reduce(
          (count, slot) => count + (slot?.item === 'torch' ? slot.count : 0),
          0,
        )).toBe(1)
        expect(yield* Ref.get(state.operationFailures)).toStrictEqual([])

        yield* requestBlockMining(state, { position, dimension, toolLocation: emptySlot })
        yield* runFrame(stages, DeltaTimeSecs(1 / 20))

        expect(yield* getMiningProgressFraction(state)).toBe(0)
        expect(yield* Ref.get(state.pendingBlockMiningAttempt)).toBeNull()
      }).pipe(Effect.provide(Layer.orDie(productionWorldWithStore(transactionalStore.layer))))
    }),
  )

  it.effect('keeps the target block and reports a storage snapshot failure in production mining', () =>
    Effect.gen(function* () {
      const position = blockPosition(1, 64, 1)
      const torch = Option.getOrThrow(blockIdOf('torch'))
      const transactionalStore = yield* makeTransactionalChunkStoreDouble(
        world([[position, torch]]),
        ['0,0'],
      )

      return yield* Effect.gen(function* () {
        const coordinator = yield* WorldCommitCoordinator
        const store = yield* ChunkStore
        const state = yield* makeGameplayFrameStateForOwner({
          coordinator,
          vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
        })
        let failStorageSnapshot = true
        const snapshotFailingCoordinator: WorldCommitCoordinatorApi = {
          ...coordinator,
          snapshot: (ownerId, schema) => {
            if (ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID && failStorageSnapshot) {
              failStorageSnapshot = false
              return Effect.fail(new ReplicatedOwnerUnknown({ ownerId }))
            }
            return coordinator.snapshot(ownerId, schema)
          },
        }
        const stages = yield* makeGameplayStagesWithState(state).pipe(
          Effect.provideService(WorldCommitCoordinator, snapshotFailingCoordinator),
        )
        const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')

        yield* requestBlockMining(state, { position, dimension })
        yield* runFrame(stages, DeltaTimeSecs(1.5))

        expect(yield* store.getBlock(position)).toStrictEqual({ _tag: 'Block', block: torch })
        expect(yield* Ref.get(state.pendingBlockMiningAttempt)).toBeNull()
        const failure = (yield* Ref.get(state.operationFailures)).find((entry) =>
          entry._tag === 'Failed' && entry.operation === 'OwnerSnapshot' && entry.subject === 'Mining',
        )
        expect(failure?._tag).toBe('Failed')
        expect(failure?.error._tag).toBe('ReplicatedOwnerUnknown')
      }).pipe(Effect.provide(Layer.orDie(productionWorldWithStore(transactionalStore.layer))))
    }),
  )

  it.effect('reports unsupported operations when lower-level gameplay services are omitted', () =>
    Effect.gen(function* () {
      const position = blockPosition(1, 64, 1)
      const torch = Option.getOrThrow(blockIdOf('torch'))
      const transactionalStore = yield* makeTransactionalChunkStoreDouble(
        world([[position, torch]]),
        ['0,0'],
      )

      return yield* Effect.gen(function* () {
        const coordinator = yield* WorldCommitCoordinator
        const store = yield* ChunkStore
        const roster = yield* entityManagerTag<MobBehaviour>()
        const time = yield* TimeService
        const state = yield* makeGameplayFrameStateForOwner({
          coordinator,
          vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
        })
        const stages = gameplayStages(state, store, roster, undefined, undefined, time)
        const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')

        yield* requestBlockMining(state, { position, dimension })
        yield* runFrame(stages, DeltaTimeSecs(1 / 20))
        expect(yield* drainGameplayUnsupportedOperations(state)).toContainEqual(expect.objectContaining({
          _tag: 'Unsupported', action: 'MineBlock', reason: 'WorldCommitCoordinatorUnavailable',
        }))

        const commit = {
          coordinator,
          playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
          playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
        }
        const stagesWithoutTableService = gameplayStages(
          state,
          store,
          roster,
          undefined,
          undefined,
          time,
          undefined,
          undefined,
          {},
          commit,
        )
        yield* requestEnchantmentTableOffers(state, {
          requestId: 'missing-table-offers', itemSlot: 0, lapisSlot: 1, bookshelfCount: 0,
        })
        yield* requestEnchantmentTableApply(state, {
          requestId: 'missing-table-apply', tableSlot: 0,
        })
        yield* runFrame(stagesWithoutTableService, DeltaTimeSecs(0))

        expect(yield* drainEnchantmentTableResults(state)).toEqual([
          { _tag: 'Rejected', requestId: 'missing-table-offers', reason: 'service-unavailable' },
          { _tag: 'Rejected', requestId: 'missing-table-apply', reason: 'service-unavailable' },
        ])
      }).pipe(Effect.provide(Layer.orDie(productionWorldWithStore(transactionalStore.layer))))
    }),
  )

  it.effect('applies Silk Touch from an inventory pickaxe through production mining and block commit', () =>
    Effect.gen(function* () {
      const position = blockPosition(2, 64, 1)
      const stone = Option.getOrThrow(blockIdOf('stone'))
      const transactionalStore = yield* makeTransactionalChunkStoreDouble(
        world([[position, stone]]),
        ['0,0'],
      )

      return yield* Effect.gen(function* () {
        const coordinator = yield* WorldCommitCoordinator
        const store = yield* ChunkStore
        const state = yield* makeGameplayFrameStateForOwner({
          coordinator,
          vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
        })
        const storage = yield* coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        )
        const slots: Array<Slot> = [...storage.state.inventory.slots]
        const enchantments = Result.getOrThrow(enchantmentsComponent({ 'minecraft:silk_touch': 1 }))
        const components = Result.getOrThrow(itemComponents('diamond_pickaxe', { enchantments }))
        slots[0] = Result.getOrThrow(itemStack('diamond_pickaxe', 1, { components }))
        yield* coordinator.commit({
          expectedRevision: storage.revision,
          expectedDimensions: [],
          changes: [{ ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: storageWithSlots(storage.state, slots) }],
        })

        const stages = yield* makeGameplayStagesWithState(state)
        const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
        // The pinned stone hardness is 25; diamond speed 8 takes ceil(25 * 30 / 8) server ticks.
        for (let frame = 0; frame < 94; frame += 1) {
          yield* requestBlockMining(state, {
            position,
            dimension,
            toolLocation: { _tag: 'Inventory', slotIndex: 0 },
          })
          yield* runFrame(stages, DeltaTimeSecs(1 / 20))
        }

        expect(yield* store.getBlock(position)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
        const after = yield* coordinator.snapshot(
          GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
          PlayerStorageSnapshotSchema,
        )
        expect(after.state.inventory.slots[0]?.item).toBe('diamond_pickaxe')
        expect(after.state.inventoryDurability[0]?.current).toBe(1_560)
        expect(after.state.inventory.slots.reduce(
          (count, slot) => count + (slot?.item === 'stone' ? slot.count : 0),
          0,
        )).toBe(1)
        expect(yield* Ref.get(state.operationFailures)).toStrictEqual([])
      }).pipe(Effect.provide(Layer.orDie(productionWorldWithStore(transactionalStore.layer))))
    }),
  )
})
