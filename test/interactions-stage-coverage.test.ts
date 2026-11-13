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
  FishingStateSchema,
  InventoryService,
  PlayerStorageSnapshotSchema,
  PlayerServiceSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  SNOWBALL_PROFILE,
  TimeService,
  WorldCommitCoordinator,
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
  requestFishingReel,
  requestMeleeAttack,
} from '../src/stages/registration.js'
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
        const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
        const stages = yield* makeGameplayStagesWithState(state)

        yield* requestBlockMining(state, { position, dimension })
        // Torch hardness is 1 and its default no-tool requirement permits hand mining: 30 ticks / 20 = 1.5 s.
        yield* runFrame(stages, DeltaTimeSecs(1.5))

        expect(yield* store.getBlock(position)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })

        yield* requestBlockMining(state, { position, dimension })
        yield* runFrame(stages, DeltaTimeSecs(1 / 20))

        expect(yield* getMiningProgressFraction(state)).toBe(0)
        expect(yield* Ref.get(state.pendingBlockMiningAttempt)).toBeNull()
      }).pipe(Effect.provide(Layer.orDie(productionWorldWithStore(transactionalStore.layer))))
    }),
  )
})
