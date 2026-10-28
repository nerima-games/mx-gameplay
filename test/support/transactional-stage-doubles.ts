import {
  BucketService,
  BucketServiceLayer,
  InventoryService,
  makeBucketService,
  makeWorldCommitCoordinator,
  PROJECTILE_REPLICATED_OWNER_ID,
  TNT_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  type InventoryServiceApi,
  type WorldCommitCoordinatorError,
} from '@nerima-games/mc-sim'
import { AIR_BLOCK_ID, WorldIdSchema, type BlockId, type BlockPosition } from '@nerima-games/mc-kernel'
import { ChunkStore, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { Effect, Layer, Ref, Schema } from 'effect'
import { makeInMemoryWorld } from '../../src/domain/in-memory-world.js'
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
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  gameplayOwnerRegistrations,
  type GameplayOwnerInitialState,
} from '../../src/stages/gameplay-owner-registrations.js'
import type { GameplayStageCommitServices } from '../../src/stages/registration-core.js'
import type { ChunkStoreDouble, StoreCalls } from './chunk-store-double.js'

const WORLD_ID = Schema.decodeUnknownSync(WorldIdSchema)('gameplay-stage-tests')

export const makeTransactionalChunkStoreDouble = (
  initial: ReadonlyMap<string, BlockId>,
  loaded: ReadonlyArray<string>,
): Effect.Effect<ChunkStoreDouble> =>
  Effect.gen(function* () {
    const world = yield* makeInMemoryWorld({
      world: { blocks: initial, loaded: new Set(loaded) },
    })
    const calls = yield* Ref.make<StoreCalls>({ reads: 0, writes: 0, peeks: 0 })
    const backing = world.chunkStore
    const api: ChunkStoreApi = {
      ...backing,
      getBlock: (position) =>
        Effect.flatMap(
          Ref.update(calls, (current) => ({ ...current, reads: current.reads + 1 })),
          () => backing.getBlock(position),
        ),
      getLight: (position) =>
        Effect.flatMap(
          Ref.update(calls, (current) => ({ ...current, reads: current.reads + 1 })),
          () => backing.getLight(position),
        ),
      peek: (coord) =>
        Effect.flatMap(
          Ref.update(calls, (current) => ({ ...current, peeks: current.peeks + 1 })),
          () => backing.peek(coord),
        ),
      setBlock: (position, block) =>
        Effect.flatMap(
          Ref.update(calls, (current) => ({ ...current, writes: current.writes + 1 })),
          () => backing.setBlock(position, block),
        ),
      publish: (prepared) =>
        Effect.flatMap(
          Ref.update(calls, (current) => ({ ...current, writes: current.writes + 1 })),
          () => backing.publish(prepared),
        ),
    }

    return {
      api,
      layer: Layer.succeed(ChunkStore, api),
      calls: Ref.get(calls),
      blockAt: (position: BlockPosition) =>
        Effect.map(backing.getBlock(position), (reading) =>
          reading._tag === 'Block' && reading.block !== AIR_BLOCK_ID ? reading.block : undefined,
        ),
    }
  })

export const makeGameplayCommitServices = (
  store: ChunkStoreApi,
  inventory: InventoryServiceApi,
  initial: GameplayOwnerInitialState = {},
): Effect.Effect<GameplayStageCommitServices, WorldCommitCoordinatorError> =>
  Effect.gen(function* () {
    const initialStorage = yield* inventory.storageSnapshot
    const coordinator = yield* makeWorldCommitCoordinator({
      world: WORLD_ID,
      owners: gameplayOwnerRegistrations({
        ...initial,
        playerStorage: initial.playerStorage ?? initialStorage,
      }),
      chunkStores: { forDimension: () => store },
    })
    const bucketService = yield* makeBucketService().pipe(
      Effect.provideService(WorldCommitCoordinator, coordinator),
    )
    return {
      coordinator,
      bucketService,
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
      statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
      projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID,
      tntOwnerId: TNT_REPLICATED_OWNER_ID,
    }
  })


export const gameplayCommitServicesLayer: Layer.Layer<
  BucketService | WorldCommitCoordinator,
  WorldCommitCoordinatorError,
  ChunkStore | InventoryService
> = Layer.provideMerge(
  BucketServiceLayer,
  Layer.effect(
    WorldCommitCoordinator,
    Effect.gen(function* () {
      const store = yield* ChunkStore
      const inventory = yield* InventoryService
      const initialStorage = yield* inventory.storageSnapshot
      return yield* makeWorldCommitCoordinator({
        world: WORLD_ID,
        owners: gameplayOwnerRegistrations({ playerStorage: initialStorage }),
        chunkStores: { forDimension: () => store },
      })
    }),
  ),
)
