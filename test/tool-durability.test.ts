import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Result, Schema } from 'effect'
import {
  BlockPositionSchema,
  DimensionIdSchema,
  WorldIdSchema,
  blockIdOf,
  itemStack,
  StackCount,
  type Dimension,
} from '@nerima-games/mc-kernel'
import {
  PlayerStorageSnapshotSchema,
  ReplicatedOwnerIdSchema,
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  playerStorageOwnerRegistration,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import type { ChunkStoreApi, ChunkStoreRegistryApi } from '@nerima-games/mc-worldgen'
import { cellKey, chunkKey, chunkOf, makeInMemoryWorld } from '../src/domain/in-memory-world.js'
import {
  BreakTransactionFailureSchema,
  BreakTransactionResultSchema,
  breakBlock,
  type BreakTransactionContext,
} from '../src/domain/interactions/break-block.js'

const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const ownerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('break-tool-durability-player')
const primary = Schema.decodeUnknownSync(BlockPositionSchema)({ x: 4, y: 60, z: 4 })
const cascade = [
  primary,
  Schema.decodeUnknownSync(BlockPositionSchema)({ x: 4, y: 61, z: 4 }),
  Schema.decodeUnknownSync(BlockPositionSchema)({ x: 4, y: 62, z: 4 }),
]
const sand = Option.getOrThrow(blockIdOf('sand'))
const cactus = Option.getOrThrow(blockIdOf('cactus'))

const makeDurabilityFixture = Effect.gen(function* () {
  const tool = Result.getOrThrow(itemStack('iron_pickaxe', StackCount(1)))
  const slots = Array.from({ length: 36 }, (_, index) => index === 0 ? tool : undefined)
  const world = yield* makeInMemoryWorld({
    inventory: slots,
    world: {
      blocks: new Map(cascade.map((position, index) => [cellKey(position), index === 0 ? sand : cactus])),
      loaded: [chunkKey(chunkOf(primary))],
    },
  })
  const initialStorage = yield* world.inventory.storageSnapshot
  const registry: ChunkStoreRegistryApi = { forDimension: (_dimension: Dimension) => world.chunkStore }
  const coordinatorLayer = WorldCommitCoordinatorLayer({
    world: Schema.decodeUnknownSync(WorldIdSchema)('break-tool-durability-world'),
    owners: [playerStorageOwnerRegistration(ownerId, initialStorage)],
    dimensions: [dimension],
    chunkStores: registry,
  })
  const coordinator = yield* Effect.gen(function* () {
    return yield* WorldCommitCoordinator
  }).pipe(Effect.provide(coordinatorLayer))
  const context: BreakTransactionContext = {
    coordinator,
    dimension,
    ownerId,
    inventory: world.inventory,
    toolLocation: { _tag: 'Inventory', slotIndex: 0 },
  }
  return { world, coordinator, context, initialStorage }
})

const getBlocks = (store: ChunkStoreApi) =>
  Effect.all(cascade.map((position) => store.getBlock(position)))

describe('mining tool durability transaction', () => {
  it.effect('commits tool wear and the full support cascade together', () =>
    Effect.gen(function* () {
      const fixture = yield* makeDurabilityFixture
      const beforeDurability = fixture.initialStorage.inventoryDurability[0]
      if (beforeDurability == null) throw new Error('the iron pickaxe has no durability')
      const beforeDimensionRevision = yield* fixture.coordinator.dimensionRevision(dimension)
      const coordinator: WorldCommitCoordinatorApi = {
        ...fixture.coordinator,
        commit: (request) => Effect.gen(function* () {
          const committed = yield* fixture.coordinator.commit(request)
          const interveningDimensionRevision = yield* fixture.coordinator.dimensionRevision(dimension)
          // Model a later commit before the caller receives the first result.
          yield* fixture.coordinator.commit({
            expectedRevision: committed.revision,
            expectedDimensions: [{ dimension, expectedRevision: interveningDimensionRevision }],
            changes: request.changes,
          })
          return committed
        }),
      }

      const raw = yield* breakBlock(fixture.world.chunkStore, primary, {
        ...fixture.context,
        coordinator,
      })
      const result = Schema.decodeUnknownSync(BreakTransactionResultSchema)(raw)
      expect(result._tag).toBe('CommittedCascade')
      if (result._tag !== 'CommittedCascade') return
      expect(result.removed).toEqual(cascade)
      expect(result.yielded).toBe(sand)
      expect(result.dimensionRevision).toBe(beforeDimensionRevision + 1)
      expect(yield* fixture.coordinator.dimensionRevision(dimension)).toBe(beforeDimensionRevision + 2)

      const owner = yield* fixture.coordinator.snapshot(ownerId, PlayerStorageSnapshotSchema)
      const mirrored = yield* fixture.world.inventory.storageSnapshot
      const afterDurability = owner.state.inventoryDurability[0]
      if (afterDurability == null) throw new Error('the iron pickaxe disappeared')
      expect(afterDurability.current).toBe(beforeDurability.current - 1)
      expect(mirrored).toEqual(owner.state)
      expect(yield* getBlocks(fixture.world.chunkStore)).toEqual(cascade.map(() => ({ _tag: 'Block', block: 0 })))
    }),
  )

  it.effect('preserves state on duplicate-edit C7 validation rejection', () =>
    Effect.gen(function* () {
      const fixture = yield* makeDurabilityFixture
      const beforeBlocks = yield* getBlocks(fixture.world.chunkStore)
      const beforeOwner = yield* fixture.coordinator.snapshot(ownerId, PlayerStorageSnapshotSchema)
      const beforeMirror = yield* fixture.world.inventory.storageSnapshot
      const beforeWorldRevision = yield* fixture.coordinator.revision
      const beforeDimensionRevision = yield* fixture.coordinator.dimensionRevision(dimension)
      const coordinator: WorldCommitCoordinatorApi = {
        ...fixture.coordinator,
        commit: (request) => {
          const blockWrite = request.blockWrite
          const firstEdit = blockWrite?.edits[0]
          if (blockWrite === undefined || firstEdit === undefined) {
            return fixture.coordinator.commit(request)
          }
          return fixture.coordinator.commit({
            ...request,
            blockWrite: { ...blockWrite, edits: [...blockWrite.edits, firstEdit] },
          })
        },
      }
      const raw = yield* breakBlock(fixture.world.chunkStore, primary, {
        ...fixture.context,
        coordinator,
      })
      const result = Schema.decodeUnknownSync(BreakTransactionResultSchema)(raw)
      expect(result._tag).toBe('TransactionFailure')
      if (result._tag !== 'TransactionFailure') return
      const failure = Schema.decodeUnknownSync(BreakTransactionFailureSchema)(result.failure)
      expect(failure._tag).toBe('CommitFailed')
      if (failure._tag !== 'CommitFailed') return
      expect(failure.error._tag).toBe('WorldWriteInvalidBatch')

      expect(yield* getBlocks(fixture.world.chunkStore)).toEqual(beforeBlocks)
      expect((yield* fixture.coordinator.snapshot(ownerId, PlayerStorageSnapshotSchema)).state).toEqual(beforeOwner.state)
      expect(yield* fixture.world.inventory.storageSnapshot).toEqual(beforeMirror)
      expect(yield* fixture.coordinator.revision).toBe(beforeWorldRevision)
      expect(yield* fixture.coordinator.dimensionRevision(dimension)).toBe(beforeDimensionRevision)
    }),
  )

  it.effect('rejects an invalid runtime dimension before observing or mutating state', () =>
    Effect.gen(function* () {
      const fixture = yield* makeDurabilityFixture
      const beforeBlocks = yield* getBlocks(fixture.world.chunkStore)
      const beforeOwner = yield* fixture.coordinator.snapshot(ownerId, PlayerStorageSnapshotSchema)
      const beforeMirror = yield* fixture.world.inventory.storageSnapshot
      const beforeWorldRevision = yield* fixture.coordinator.revision
      const beforeDimensionRevision = yield* fixture.coordinator.dimensionRevision(dimension)
      const runtimeBreakBlock: Function = breakBlock
      const rawEffect: Effect.Effect<unknown> = runtimeBreakBlock.apply(undefined, [
        fixture.world.chunkStore,
        primary,
        { ...fixture.context, dimension: 'invalid-dimension' },
      ])
      const raw = yield* rawEffect
      const result = Schema.decodeUnknownSync(BreakTransactionResultSchema)(raw)
      expect(result._tag).toBe('TransactionFailure')
      if (result._tag !== 'TransactionFailure') return
      const failure = Schema.decodeUnknownSync(BreakTransactionFailureSchema)(result.failure)
      expect(failure._tag).toBe('InvalidDimension')

      expect(yield* getBlocks(fixture.world.chunkStore)).toEqual(beforeBlocks)
      expect((yield* fixture.coordinator.snapshot(ownerId, PlayerStorageSnapshotSchema)).state).toEqual(beforeOwner.state)
      expect(yield* fixture.world.inventory.storageSnapshot).toEqual(beforeMirror)
      expect(yield* fixture.coordinator.revision).toBe(beforeWorldRevision)
      expect(yield* fixture.coordinator.dimensionRevision(dimension)).toBe(beforeDimensionRevision)
    }),
  )
})
