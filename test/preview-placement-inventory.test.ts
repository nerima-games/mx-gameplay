import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { blockPosition } from './support/coordinate-fixtures'
import { makeSite, requestPlace, stepFrame } from '../apps/preview-mining-site/site'
import { AIR, STONE } from '../apps/preview-mining-site/world'

const TARGET = blockPosition(2, 64, 0)

const inventoryItemCount = (
  slots: ReadonlyArray<{ readonly item: string; readonly count: number } | undefined>,
  item: string,
): number => slots.reduce(
  (total, slot) => total + (slot?.item === item ? slot.count : 0),
  0,
)

describe('preview placement inventory bridge', () => {
  it.effect('charges exactly one item for a successful placement', () =>
    Effect.gen(function* () {
      const base = yield* makeSite(
        { cells: [], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )
      yield* base.setInventory([['stone', 2]])

      yield* requestPlace(base, TARGET, 'stone')
      const frame = yield* stepFrame(base)

      expect(base.world.peekBlock(TARGET)).toBe(STONE)
      expect(base.inventory.get('stone')).toBe(1)
      const storage = yield* base.observePlayerStorage()
      expect(inventoryItemCount(storage.inventory.slots, 'stone')).toBe(1)
      expect(frame.spent).toStrictEqual(['stone'])
    }),
  )

  it.effect('does not place when the inventory is empty', () =>
    Effect.gen(function* () {
      const base = yield* makeSite(
        { cells: [], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )
      yield* requestPlace(base, TARGET, 'stone')
      const frame = yield* stepFrame(base)

      expect(base.world.peekBlock(TARGET) ?? AIR).toBe(AIR)
      expect(base.inventory.get('stone') ?? 0).toBe(0)
      const storage = yield* base.observePlayerStorage()
      expect(inventoryItemCount(storage.inventory.slots, 'stone')).toBe(0)
      expect(frame.spent).toStrictEqual([])
    }),
  )

  it.effect('restores the reserved item when placement is refused', () =>
    Effect.gen(function* () {
      const base = yield* makeSite(
        { cells: [[TARGET.x, TARGET.y, STONE]], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )
      yield* base.setInventory([['stone', 1]])

      yield* requestPlace(base, TARGET, 'stone')
      const frame = yield* stepFrame(base)

      expect(base.world.peekBlock(TARGET)).toBe(STONE)
      expect(base.inventory.get('stone')).toBe(1)
      const storage = yield* base.observePlayerStorage()
      expect(inventoryItemCount(storage.inventory.slots, 'stone')).toBe(1)
      expect(frame.spent).toStrictEqual([])
    }),
  )
})
