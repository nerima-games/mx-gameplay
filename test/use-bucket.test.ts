import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import {
  makeReplicatedOwnerId,
  makeWorldCommitCoordinator,
  playerStorageOwnerRegistration,
  PlayerStorageSnapshotSchema,
  WorldCommitCoordinatorErrorSchema,
  WorldRevisionConflict,
  type InventoryServiceApi,
  type PlayerStorage,
  type ReplicatedOwnerId,
  type Slot,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
} from '@nerima-games/mc-sim'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import {
  AIR_BLOCK_ID,
  blockIdOf,
  blockPositionKeyOf,
  BlockPositionKey as makeBlockPositionKey,
  itemStack,
  StackCount,
  WorldIdSchema,
  WorldRevisionSchema,
  type BlockId,
  type BlockPositionKey,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import type { ChunkStoreRegistryApi } from '@nerima-games/mc-worldgen'
import {
  enqueueFluidDisturbance,
  type FluidKind,
  type FluidWorkItem,
} from '../src/domain/fluid-frontier'
import {
  isBucketItem,
  useBucket,
  type BucketItemType,
  type BucketUseRequest,
} from '../src/domain/interactions/use-bucket'
import {
  makeInMemoryWorld,
  cellKey,
  chunkKey,
  chunkOf,
  type InMemoryWorld,
} from '../src/domain/in-memory-world'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makeChunkStoreDouble, world as sparseWorld } from './support/chunk-store-double'
import { blockPosition as atBlockPosition } from './support/coordinate-fixtures'

type ItemType = Parameters<InventoryServiceApi['add']>[0]

const STONE = Option.getOrThrow(blockIdOf('stone'))
const WATER = Option.getOrThrow(blockIdOf('water'))
const LAVA = Option.getOrThrow(blockIdOf('lava'))
const POSITION: BlockPosition = atBlockPosition(1, 64, 1)
const PLAYER_STORAGE_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('gameplay-test-storage')
const WORLD_ID = Schema.decodeUnknownSync(WorldIdSchema)('gameplay-bucket-tests')

const positionKey = (value: string): BlockPositionKey => Result.getOrThrow(makeBlockPositionKey(value))
const stack = (item: ItemType, count: number): Slot =>
  Result.getOrThrow(itemStack(item, StackCount(count)))

const inventoryWith = (...entries: ReadonlyArray<readonly [number, Slot]>): ReadonlyArray<Slot> => {
  const slots = [...emptySlots()]
  for (const [index, slot] of entries) slots[index] = slot
  return slots
}

const request = (
  heldItem: BucketItemType,
  overrides: Partial<BucketUseRequest> = {},
): BucketUseRequest => ({
  activeDimension: 'overworld',
  targetDimension: 'overworld',
  position: POSITION,
  heldItem,
  playerStorageOwnerId: PLAYER_STORAGE_OWNER_ID,
  ...overrides,
})

type BucketHarness = {
  readonly world: InMemoryWorld<unknown>
  readonly inventory: InventoryServiceApi
  readonly coordinator: WorldCommitCoordinatorApi
  readonly ownerId: ReplicatedOwnerId
  readonly initialStorage: PlayerStorage
}

const makeBucketHarness = (
  block: BlockId | undefined,
  loaded: boolean,
  slots: ReadonlyArray<Slot>,
): Effect.Effect<BucketHarness, WorldCommitCoordinatorError> =>
  Effect.gen(function* () {
    const initialBlocks =
      block === undefined ? new Map<string, BlockId>() : new Map([[cellKey(POSITION), block]])
    const world = yield* makeInMemoryWorld({
      world: {
        blocks: initialBlocks,
        loaded: loaded ? [chunkKey(chunkOf(POSITION))] : [],
      },
    })
    const inventory = yield* makeInventoryDouble(slots)
    const initialStorage = yield* inventory.api.storageSnapshot
    const chunkStores: ChunkStoreRegistryApi = { forDimension: () => world.chunkStore }
    const coordinator = yield* makeWorldCommitCoordinator({
      world: WORLD_ID,
      owners: [playerStorageOwnerRegistration(PLAYER_STORAGE_OWNER_ID, initialStorage)],
      chunkStores,
    })
    return {
      world,
      inventory: inventory.api,
      coordinator,
      ownerId: PLAYER_STORAGE_OWNER_ID,
      initialStorage,
    }
  })

const assertUnchangedAfterFailure = (
  scenario:
    | 'wrong-dimension'
    | 'missing-item'
    | 'wrong-target'
    | 'occupied'
    | 'inventory-full'
    | 'chunk-not-loaded'
    | 'commit-failed',
  stackCount: number,
  frontierSeeds: ReadonlyArray<readonly [number, FluidKind]>,
) =>
  Effect.gen(function* () {
    const initialInventory =
      scenario === 'missing-item'
        ? inventoryWith([0, stack('stone', stackCount)])
        : scenario === 'occupied'
          ? inventoryWith([0, stack('water_bucket', 1)])
          : scenario === 'inventory-full'
            ? [
                stack('bucket', Math.max(2, stackCount)),
                ...emptySlots().slice(1).map(() => stack('stone', 64)),
              ]
            : inventoryWith([0, stack('bucket', 1)])
    const initialBlock =
      scenario === 'wrong-target' || scenario === 'occupied' ? STONE : WATER
    const loaded = scenario !== 'chunk-not-loaded'
    const harness = yield* makeBucketHarness(initialBlock, loaded, initialInventory)
    const initialFrontier = frontierSeeds.map(([x, kind], index) => ({
      key: positionKey(`${String(x)},64,${String(index)}`),
      kind,
    }))
    const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>(initialFrontier)
    let commitCount = 0
    const coordinator: WorldCommitCoordinatorApi = {
      ...harness.coordinator,
      commit: (...args) => {
        commitCount += 1
        return scenario === 'commit-failed'
          ? Effect.fail(new WorldRevisionConflict({
              expected: Schema.decodeUnknownSync(WorldRevisionSchema)(1),
              actual: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
            }))
          : harness.coordinator.commit(...args)
      },
    }
    const outcome = yield* Effect.result(
      useBucket(
        coordinator,
        frontier,
        request(scenario === 'occupied' ? 'water_bucket' : 'bucket', {
          targetDimension: scenario === 'wrong-dimension' ? 'nether' : 'overworld',
        }),
      ),
    )

    if (scenario === 'commit-failed') {
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(Schema.decodeUnknownSync(WorldCommitCoordinatorErrorSchema)(outcome.failure)._tag).toBe(
          'WorldRevisionConflict',
        )
      }
    } else {
      expect(Result.isSuccess(outcome)).toBe(true)
      if (Result.isSuccess(outcome)) {
        expect(outcome.success._tag).not.toBe('Collected')
        expect(outcome.success._tag).not.toBe('Placed')
      }
    }
    expect(commitCount).toBe(scenario === 'commit-failed' ? 1 : 0)

    const blockAfter = yield* harness.world.chunkStore.getBlock(POSITION)
    expect(blockAfter).toStrictEqual(
      loaded ? { _tag: 'Block', block: initialBlock } : { _tag: 'ChunkNotLoaded' },
    )
    expect(yield* harness.inventory.storageSnapshot).toStrictEqual(harness.initialStorage)
    const ownerAfter = yield* harness.coordinator.snapshot(
      harness.ownerId,
      PlayerStorageSnapshotSchema,
    )
    expect(ownerAfter.revision).toBe(0)
    expect(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(ownerAfter.state)).toStrictEqual(
      harness.initialStorage,
    )
    expect(yield* Ref.get(frontier)).toStrictEqual(initialFrontier)

    return true
  })

describe('bucket interaction', () => {
  for (const scenario of [
    { fluid: 'water', source: WATER, filled: 'water_bucket' },
    { fluid: 'lava', source: LAVA, filled: 'lava_bucket' },
  ] as const) {
    it.effect(`collects a ${scenario.fluid} source in one owner and block commit`, () =>
      Effect.gen(function* () {
        const harness = yield* makeBucketHarness(
          scenario.source,
          true,
          inventoryWith([0, stack('bucket', 1)]),
        )
        const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([
          { key: positionKey('9,64,9'), kind: 'water' },
        ])

        const outcome = yield* useBucket(
          harness.coordinator,
          frontier,
          request('bucket'),
        )

        expect(outcome).toMatchObject({
          _tag: 'Collected',
          fluid: scenario.fluid,
          position: POSITION,
        })
        expect(yield* harness.world.chunkStore.getBlock(POSITION)).toStrictEqual({
          _tag: 'Block',
          block: AIR_BLOCK_ID,
        })
        const localStorage = yield* harness.inventory.storageSnapshot
        expect(localStorage).toStrictEqual(harness.initialStorage)
        const owner = yield* harness.coordinator.snapshot(
          harness.ownerId,
          PlayerStorageSnapshotSchema,
        )
        const committedStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(owner.state)
        expect(committedStorage.inventory.slots).toStrictEqual(
          inventoryWith([0, stack(scenario.filled, 1)]),
        )
        expect(owner.revision).toBe(1)
        expect(yield* Ref.get(frontier)).toStrictEqual([
          { key: '9,64,9', kind: 'water' },
          {
            key: blockPositionKeyOf(atBlockPosition(POSITION.x, POSITION.y, POSITION.z)),
            kind: scenario.fluid,
          },
        ])
      }),
    )

    it.effect(`places ${scenario.fluid} into air in one owner and block commit`, () =>
      Effect.gen(function* () {
        const harness = yield* makeBucketHarness(
          undefined,
          true,
          inventoryWith([0, stack(scenario.filled, 1)]),
        )
        const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])

        const outcome = yield* useBucket(
          harness.coordinator,
          frontier,
          request(scenario.filled),
        )

        expect(outcome).toMatchObject({
          _tag: 'Placed',
          fluid: scenario.fluid,
          position: POSITION,
        })
        expect(yield* harness.world.chunkStore.getBlock(POSITION)).toStrictEqual({
          _tag: 'Block',
          block: scenario.source,
        })
        const localStorage = yield* harness.inventory.storageSnapshot
        expect(localStorage).toStrictEqual(harness.initialStorage)
        const owner = yield* harness.coordinator.snapshot(
          harness.ownerId,
          PlayerStorageSnapshotSchema,
        )
        const committedStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(owner.state)
        expect(committedStorage.inventory.slots).toStrictEqual(
          inventoryWith([0, stack('bucket', 1)]),
        )
        expect(yield* Ref.get(frontier)).toStrictEqual([
          {
            key: blockPositionKeyOf(atBlockPosition(POSITION.x, POSITION.y, POSITION.z)),
            kind: scenario.fluid,
          },
        ])
      }),
    )
  }

  it.effect(
    'property: each successful bucket operation commits once without updating the local inventory mirror',
    () =>
      Effect.sync(() => {
        FastCheck.assert(
          FastCheck.property(
            FastCheck.constantFrom<FluidKind>('water', 'lava'),
            FastCheck.boolean(),
            (fluid, collecting) => {
              const source = fluid === 'water' ? WATER : LAVA
              const heldItem: BucketItemType = collecting ? 'bucket' : `${fluid}_bucket`
              const nextItem: BucketItemType = collecting ? `${fluid}_bucket` : 'bucket'
              let commitCount = 0

              return Effect.runSync(Effect.orDie(Effect.gen(function* () {
                const harness = yield* makeBucketHarness(
                  collecting ? source : undefined,
                  true,
                  inventoryWith([0, stack(heldItem, 1)]),
                )
                const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])
                const coordinator: WorldCommitCoordinatorApi = {
                  ...harness.coordinator,
                  commit: (...args) => {
                    commitCount += 1
                    return harness.coordinator.commit(...args)
                  },
                }
                const outcome = yield* useBucket(
                  coordinator,
                  frontier,
                  request(heldItem),
                )
                const localStorage = yield* harness.inventory.storageSnapshot
                const owner = yield* harness.coordinator.snapshot(
                  harness.ownerId,
                  PlayerStorageSnapshotSchema,
                )
                const committedStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(owner.state)
                const world = yield* harness.world.chunkStore.getBlock(POSITION)
                const expectedBlock = collecting ? AIR_BLOCK_ID : source
                const frontierAfter = yield* Ref.get(frontier)

                return outcome._tag === (collecting ? 'Collected' : 'Placed') &&
                  commitCount === 1 &&
                  owner.revision === 1 &&
                  JSON.stringify(localStorage) === JSON.stringify(harness.initialStorage) &&
                  JSON.stringify(committedStorage.inventory.slots) ===
                    JSON.stringify(inventoryWith([0, stack(nextItem, 1)])) &&
                  world._tag === 'Block' && world.block === expectedBlock &&
                  frontierAfter.length === 1 &&
                  frontierAfter[0]?.key === blockPositionKeyOf(atBlockPosition(POSITION.x, POSITION.y, POSITION.z)) &&
                  frontierAfter[0]?.kind === fluid
              })))
            },
          ),
          { numRuns: 35 },
        )
      }),
  )

  it.effect('rejects a target in another dimension without mutation', () =>
    Effect.gen(function* () {
      expect(
        yield* assertUnchangedAfterFailure('wrong-dimension', 1, [[9, 'lava']]),
      ).toBe(true)
    }),
  )

  it.effect('rejects a missing bucket from the observed owner storage', () =>
    Effect.gen(function* () {
      expect(yield* assertUnchangedAfterFailure('missing-item', 3, [[9, 'water']])).toBe(true)
    }),
  )

  it.effect('rejects a non-fluid target and an occupied placement target unchanged', () =>
    Effect.gen(function* () {
      expect(yield* assertUnchangedAfterFailure('wrong-target', 1, [[9, 'water']])).toBe(true)
      expect(yield* assertUnchangedAfterFailure('occupied', 1, [[8, 'lava']])).toBe(true)
    }),
  )

  it.effect('rejects collection when the filled bucket cannot fit', () =>
    Effect.gen(function* () {
      expect(yield* assertUnchangedAfterFailure('inventory-full', 2, [[9, 'water']])).toBe(true)
    }),
  )

  it.effect('returns ChunkNotLoaded when the target cell is unavailable', () =>
    Effect.gen(function* () {
      expect(yield* assertUnchangedAfterFailure('chunk-not-loaded', 1, [[9, 'water']])).toBe(true)
    }),
  )

  it.effect('uses registered owner storage when the local inventory mirror differs', () =>
    Effect.gen(function* () {
      const harness = yield* makeBucketHarness(
        WATER,
        true,
        inventoryWith([0, stack('bucket', 1)]),
      )
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])
      const initialOwnerStorage = harness.initialStorage

      expect(yield* harness.inventory.add('stone', 1)).toBe(0)
      const localStorageAfterChange = yield* harness.inventory.storageSnapshot
      expect(localStorageAfterChange).not.toStrictEqual(initialOwnerStorage)

      expect(yield* useBucket(
        harness.coordinator,
        frontier,
        request('bucket'),
      )).toMatchObject({ _tag: 'Collected', fluid: 'water' })

      expect(yield* harness.world.chunkStore.getBlock(POSITION)).toStrictEqual({
        _tag: 'Block',
        block: AIR_BLOCK_ID,
      })
      expect(yield* harness.inventory.storageSnapshot).toStrictEqual(localStorageAfterChange)
      const owner = yield* harness.coordinator.snapshot(
        harness.ownerId,
        PlayerStorageSnapshotSchema,
      )
      const ownerStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(owner.state)
      expect(ownerStorage.inventory.slots).toStrictEqual(inventoryWith([0, stack('water_bucket', 1)]))
      expect(yield* Ref.get(frontier)).toStrictEqual([{
        key: blockPositionKeyOf(atBlockPosition(POSITION.x, POSITION.y, POSITION.z)),
        kind: 'water',
      }])
    }),
  )

  it.effect('treats an observation that omits the requested cell as a changed world', () =>
    Effect.gen(function* () {
      const harness = yield* makeBucketHarness(
        WATER,
        true,
        inventoryWith([0, stack('bucket', 1)]),
      )
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])
      const coordinator: WorldCommitCoordinatorApi = {
        ...harness.coordinator,
        observe: (...args) => Effect.map(
          harness.coordinator.observe(...args),
          (snapshot) => ({ ...snapshot, blocks: [] }),
        ),
      }

      expect(yield* useBucket(
        coordinator,
        frontier,
        request('bucket'),
      )).toStrictEqual({ _tag: 'WorldChanged' })
      expect(yield* harness.world.chunkStore.getBlock(POSITION)).toStrictEqual({
        _tag: 'Block',
        block: WATER,
      })
      expect(yield* harness.inventory.storageSnapshot).toStrictEqual(harness.initialStorage)
      expect(yield* Ref.get(frontier)).toStrictEqual([])
    }),
  )

  it.effect('leaves world, owner, local inventory, and frontier unchanged when commit fails', () =>
    Effect.gen(function* () {
      expect(yield* assertUnchangedAfterFailure('commit-failed', 1, [[9, 'lava']])).toBe(true)
    }),
  )

  it.effect('requires commit context for legacy callers without reading or writing state', () =>
    Effect.gen(function* () {
      const initialInventory = inventoryWith([0, stack('bucket', 1)])
      const initialFrontier = [{ key: positionKey('9,64,9'), kind: 'lava' }] as const
      const store = yield* makeChunkStoreDouble(sparseWorld([[POSITION, WATER]]), ['0,0'])
      const unreadableStore = {
        ...store.api,
        getBlock: () => Effect.die('legacy bucket call read the world'),
        setBlock: () => Effect.die('legacy bucket call wrote the world'),
      }
      const inventory = yield* makeInventoryDouble(initialInventory)
      const unreadableInventory = {
        ...inventory.api,
        storageSnapshot: Effect.die('legacy bucket call read inventory'),
      }
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>(initialFrontier)

      const outcome = yield* useBucket(unreadableStore, unreadableInventory, frontier, {
        activeDimension: 'overworld',
        targetDimension: 'overworld',
        position: POSITION,
        heldItem: 'bucket',
      })

      expect(outcome).toStrictEqual({ _tag: 'CommitContextMissing' })
      expect(yield* useBucket(unreadableStore, unreadableInventory, frontier, {
        activeDimension: 'overworld',
        targetDimension: 'nether',
        position: POSITION,
        heldItem: 'bucket',
      })).toStrictEqual({
        _tag: 'WrongDimension',
        activeDimension: 'overworld',
        targetDimension: 'nether',
      })
      expect(yield* store.blockAt(POSITION)).toBe(WATER)
      expect((yield* inventory.api.storageSnapshot).inventory.slots).toStrictEqual(initialInventory)
      expect(yield* Ref.get(frontier)).toStrictEqual(initialFrontier)
      expect(yield* store.calls).toMatchObject({ reads: 0, writes: 0 })
    }),
  )

  it.effect('property: every failed bucket operation preserves all four state holders', () =>
    Effect.sync(() => {
      const scenarios = [
        'wrong-dimension',
        'missing-item',
        'wrong-target',
        'occupied',
        'inventory-full',
        'chunk-not-loaded',
        'commit-failed',
      ] as const
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(...scenarios),
          FastCheck.integer({ min: 1, max: 16 }),
          FastCheck.array(
            FastCheck.tuple(
              FastCheck.integer({ min: -64, max: 64 }),
              FastCheck.constantFrom<FluidKind>('water', 'lava'),
            ),
            { maxLength: 5 },
          ),
          (scenario, count, seeds) =>
            Effect.runSync(Effect.orDie(assertUnchangedAfterFailure(scenario, count, seeds))),
        ),
        { numRuns: 35 },
      )
    }),
  )
})

describe('isBucketItem', () => {
  it('accepts exactly the three bucket item names', () => {
    expect(isBucketItem('bucket')).toBe(true)
    expect(isBucketItem('water_bucket')).toBe(true)
    expect(isBucketItem('lava_bucket')).toBe(true)
  })

  it('rejects an item that is not a bucket', () => {
    expect(isBucketItem('stone')).toBe(false)
  })
})

describe('fluid disturbance enqueue', () => {
  it('keeps exactly one current fluid kind per position across varied frontiers', () => {
    for (let size = 0; size < 80; size += 1) {
      const frontier: ReadonlyArray<FluidWorkItem> = Array.from({ length: size }, (_, index) => ({
        key: positionKey(`${String(index % 9)},64,0`),
        kind: index % 2 === 0 ? 'water' : 'lava',
      }))
      const key = positionKey(`${String(size % 9)},64,0`)
      const kind: FluidKind = size % 2 === 0 ? 'lava' : 'water'

      const next = enqueueFluidDisturbance(frontier, { key, kind })

      expect(next.filter((item) => item.key === key)).toStrictEqual([{ key, kind }])
      expect(next.slice(0, -1)).toStrictEqual(frontier.filter((item) => item.key !== key))
    }
  })
})
