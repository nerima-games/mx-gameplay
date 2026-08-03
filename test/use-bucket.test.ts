import { describe, expect, it } from '@effect/vitest'
import type { InventoryServiceApi, Slot } from '@nerima-games/mc-sim'
import { Effect, Ref } from 'effect'
import { positionKeyOf } from '../src/domain/block-position-key'
import { positionKey } from '../src/domain/position-key'
import type { BlockId, BlockPosition, ChunkStoreApi } from '../src/domain/chunk-store-port'
import {
  enqueueFluidDisturbance,
  type FluidKind,
  type FluidWorkItem,
} from '../src/domain/fluid-frontier'
import { StackCount } from '../src/domain/frame-contract'
import {
  useBucket,
  type BucketItemType,
  type BucketUseRequest,
} from '../src/domain/interactions/use-bucket'
import { makeChunkStoreDouble, STONE, WATER, world } from './support/chunk-store-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'

type ItemType = Parameters<InventoryServiceApi['add']>[0]

const LAVA: BlockId = 11
const POSITION: BlockPosition = { x: 1, y: 64, z: 1 }
const LOADED_CHUNKS = ['0,0']

const stack = (item: ItemType, count: number): Slot => ({ item, count: StackCount(count) })

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
  ...overrides,
})

describe('bucket interaction', () => {
  for (const scenario of [
    { fluid: 'water', source: WATER, filled: 'water_bucket' },
    { fluid: 'lava', source: LAVA, filled: 'lava_bucket' },
  ] as const) {
    it.effect(`collects a ${scenario.fluid} source atomically and schedules fluid work`, () =>
      Effect.gen(function* () {
        const store = yield* makeChunkStoreDouble(
          world([[POSITION, scenario.source]]),
          LOADED_CHUNKS,
        )
        const inventory = yield* makeInventoryDouble(inventoryWith([0, stack('bucket', 1)]))
        const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([
          { key: positionKey('9,64,9'), kind: 'water' },
        ])

        const outcome = yield* useBucket(store.api, inventory.api, frontier, request('bucket'))

        expect(outcome).toMatchObject({
          _tag: 'Collected',
          fluid: scenario.fluid,
          position: POSITION,
        })
        expect(yield* store.blockAt(POSITION)).toBe(0)
        expect((yield* inventory.api.snapshot).slots).toStrictEqual(
          inventoryWith([0, stack(scenario.filled, 1)]),
        )
        expect(yield* Ref.get(frontier)).toStrictEqual([
          { key: '9,64,9', kind: 'water' },
          { key: positionKeyOf(POSITION), kind: scenario.fluid },
        ])
        expect(yield* store.calls).toMatchObject({ reads: 1, writes: 1 })
      }),
    )

    it.effect(`places ${scenario.fluid} into air atomically and schedules fluid work`, () =>
      Effect.gen(function* () {
        const store = yield* makeChunkStoreDouble(world([]), LOADED_CHUNKS)
        const inventory = yield* makeInventoryDouble(
          inventoryWith([0, stack(scenario.filled, 1)]),
        )
        const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])

        const outcome = yield* useBucket(
          store.api,
          inventory.api,
          frontier,
          request(scenario.filled),
        )

        expect(outcome).toMatchObject({
          _tag: 'Placed',
          fluid: scenario.fluid,
          position: POSITION,
        })
        expect(yield* store.blockAt(POSITION)).toBe(scenario.source)
        expect((yield* inventory.api.snapshot).slots).toStrictEqual(
          inventoryWith([0, stack('bucket', 1)]),
        )
        expect(yield* Ref.get(frontier)).toStrictEqual([
          { key: positionKeyOf(POSITION), kind: scenario.fluid },
        ])
        expect(yield* store.calls).toMatchObject({ reads: 1, writes: 1 })
      }),
    )
  }

  it.effect('rejects a target in another dimension before reading or mutating state', () =>
    Effect.gen(function* () {
      const initialInventory = inventoryWith([0, stack('bucket', 1)])
        const initialFrontier = [{ key: positionKey('9,64,9'), kind: 'lava' }] as const
      const store = yield* makeChunkStoreDouble(world([[POSITION, WATER]]), LOADED_CHUNKS)
      const inventory = yield* makeInventoryDouble(initialInventory)
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>(initialFrontier)

      const outcome = yield* useBucket(
        store.api,
        inventory.api,
        frontier,
        request('bucket', { targetDimension: 'nether' }),
      )

      expect(outcome).toStrictEqual({
        _tag: 'WrongDimension',
        activeDimension: 'overworld',
        targetDimension: 'nether',
      })
      expect(yield* store.blockAt(POSITION)).toBe(WATER)
      expect((yield* inventory.api.snapshot).slots).toStrictEqual(initialInventory)
      expect(yield* Ref.get(frontier)).toStrictEqual(initialFrontier)
      expect(yield* store.calls).toMatchObject({ reads: 0, writes: 0 })
    }),
  )

  for (const scenario of [
    { name: 'an empty bucket used on a non-fluid block', held: 'bucket', tag: 'WrongTarget' },
    { name: 'a filled bucket used on an occupied block', held: 'water_bucket', tag: 'Occupied' },
  ] as const) {
    it.effect(`rejects ${scenario.name} without a partial mutation`, () =>
      Effect.gen(function* () {
        const initialInventory = inventoryWith([0, stack(scenario.held, 1)])
        const initialFrontier = [{ key: positionKey('9,64,9'), kind: 'water' }] as const
        const store = yield* makeChunkStoreDouble(world([[POSITION, STONE]]), LOADED_CHUNKS)
        const inventory = yield* makeInventoryDouble(initialInventory)
        const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>(initialFrontier)

        const outcome = yield* useBucket(store.api, inventory.api, frontier, request(scenario.held))

        expect(outcome).toStrictEqual({ _tag: scenario.tag, block: STONE })
        expect(yield* store.blockAt(POSITION)).toBe(STONE)
        expect((yield* inventory.api.snapshot).slots).toStrictEqual(initialInventory)
        expect(yield* Ref.get(frontier)).toStrictEqual(initialFrontier)
        expect(yield* store.calls).toMatchObject({ reads: 1, writes: 0 })
      }),
    )
  }

  it.effect('rejects collection when the filled bucket cannot fit', () =>
    Effect.gen(function* () {
      const initialInventory = emptySlots().map((_, index) =>
        index === 0 ? stack('bucket', 2) : stack('stone', 64),
      )
        const initialFrontier = [{ key: positionKey('9,64,9'), kind: 'water' }] as const
      const store = yield* makeChunkStoreDouble(world([[POSITION, WATER]]), LOADED_CHUNKS)
      const inventory = yield* makeInventoryDouble(initialInventory)
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>(initialFrontier)

      const outcome = yield* useBucket(store.api, inventory.api, frontier, request('bucket'))

      expect(outcome).toStrictEqual({ _tag: 'InventoryFull', item: 'water_bucket' })
      expect(yield* store.blockAt(POSITION)).toBe(WATER)
      expect((yield* inventory.api.snapshot).slots).toStrictEqual(initialInventory)
      expect(yield* Ref.get(frontier)).toStrictEqual(initialFrontier)
      expect(yield* store.calls).toMatchObject({ reads: 1, writes: 0 })
    }),
  )

  it.effect('rejects a missing held item without reading the world', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[POSITION, WATER]]), LOADED_CHUNKS)
      const inventory = yield* makeInventoryDouble()
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])

      expect(yield* useBucket(store.api, inventory.api, frontier, request('bucket'))).toStrictEqual({
        _tag: 'MissingItem',
        item: 'bucket',
      })
      expect(yield* store.calls).toMatchObject({ reads: 0, writes: 0 })
      expect(yield* Ref.get(frontier)).toStrictEqual([])
    }),
  )

  it.effect('keeps inventory and frontier unchanged when the world rejects the write', () =>
    Effect.gen(function* () {
      const initialInventory = inventoryWith([0, stack('bucket', 1)])
      const store = yield* makeChunkStoreDouble(world([[POSITION, WATER]]), LOADED_CHUNKS)
      const refusingStore: ChunkStoreApi = {
        ...store.api,
        setBlock: () => Effect.succeed({ _tag: 'ChunkNotLoaded' } as const),
      }
      const inventory = yield* makeInventoryDouble(initialInventory)
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])

      const outcome = yield* useBucket(refusingStore, inventory.api, frontier, request('bucket'))

      expect(outcome).toStrictEqual({ _tag: 'ChunkNotLoaded' })
      expect(yield* store.blockAt(POSITION)).toBe(WATER)
      expect((yield* inventory.api.snapshot).slots).toStrictEqual(initialInventory)
      expect(yield* Ref.get(frontier)).toStrictEqual([])
    }),
  )

  it.effect('restores a concurrently changed block after detecting the stale read', () =>
    Effect.gen(function* () {
      const initialInventory = inventoryWith([0, stack('bucket', 1)])
      const store = yield* makeChunkStoreDouble(world([[POSITION, WATER]]), LOADED_CHUNKS)
      let writes = 0
      const racingStore: ChunkStoreApi = {
        ...store.api,
        setBlock: (position, block) =>
          Effect.gen(function* () {
            writes += 1
            if (writes === 1) yield* store.api.setBlock(position, STONE)
            return yield* store.api.setBlock(position, block)
          }),
      }
      const inventory = yield* makeInventoryDouble(initialInventory)
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])

      const outcome = yield* useBucket(racingStore, inventory.api, frontier, request('bucket'))

      expect(outcome).toStrictEqual({ _tag: 'WorldChanged' })
      expect(yield* store.blockAt(POSITION)).toBe(STONE)
      expect((yield* inventory.api.snapshot).slots).toStrictEqual(initialInventory)
      expect(yield* Ref.get(frontier)).toStrictEqual([])
      expect(writes).toBe(2)
    }),
  )

  it.effect('reports a failed world rollback after detecting the stale read', () =>
    Effect.gen(function* () {
      const initialInventory = inventoryWith([0, stack('bucket', 1)])
      const store = yield* makeChunkStoreDouble(world([[POSITION, WATER]]), LOADED_CHUNKS)
      let writes = 0
      const racingStore: ChunkStoreApi = {
        ...store.api,
        setBlock: (position, block) =>
          Effect.gen(function* () {
            writes += 1
            if (writes === 2) return { _tag: 'ChunkNotLoaded' } as const
            yield* store.api.setBlock(position, STONE)
            return yield* store.api.setBlock(position, block)
          }),
      }
      const inventory = yield* makeInventoryDouble(initialInventory)
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])

      const outcome = yield* useBucket(racingStore, inventory.api, frontier, request('bucket'))

      expect(outcome).toStrictEqual({
        _tag: 'RollbackFailed',
        trigger: 'WorldChanged',
        world: 'ChunkNotLoaded',
        inventory: 'Unchanged',
      })
      expect(yield* store.blockAt(POSITION)).toBe(0)
      expect((yield* inventory.api.snapshot).slots).toStrictEqual(initialInventory)
      expect(yield* Ref.get(frontier)).toStrictEqual([])
    }),
  )

  it.effect('restores world and inventory when installing the prepared inventory fails', () =>
    Effect.gen(function* () {
      const initialInventory = inventoryWith([0, stack('bucket', 1)])
      const store = yield* makeChunkStoreDouble(world([[POSITION, WATER]]), LOADED_CHUNKS)
      const inventory = yield* makeInventoryDouble(initialInventory)
      let restores = 0
      const refusingInventory: InventoryServiceApi = {
        ...inventory.api,
        restoreStorage: (snapshot) => {
          restores += 1
          return restores === 1
            ? Effect.dieMessage('injected inventory update failure')
            : inventory.api.restoreStorage(snapshot)
        },
      }
      const frontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])

      const outcome = yield* useBucket(store.api, refusingInventory, frontier, request('bucket'))

      expect(outcome).toStrictEqual({ _tag: 'InventoryUpdateFailed' })
      expect(yield* store.blockAt(POSITION)).toBe(WATER)
      expect((yield* inventory.api.snapshot).slots).toStrictEqual(initialInventory)
      expect(yield* Ref.get(frontier)).toStrictEqual([])
      expect(restores).toBe(2)
    }),
  )
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
