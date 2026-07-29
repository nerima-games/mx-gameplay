import { describe, expect, it } from '@effect/vitest'
import type { Slot } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import { StackCount } from '../domain/frame-contract'
import type { ItemType } from '../domain/item-vocabulary'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'

const stack = (item: ItemType, count: number): Slot => ({ item, count: StackCount(count) })

const inventoryWith = (...entries: ReadonlyArray<readonly [number, Slot]>): ReadonlyArray<Slot> => {
  const slots = [...emptySlots()]
  for (const [index, slot] of entries) {
    slots[index] = slot
  }
  return slots
}

describe('inventory service double clicks', () => {
  it.effect('left click picks up, places, merges, and swaps whole stacks', () =>
    Effect.gen(function* () {
      const inventory = yield* makeInventoryDouble(
        inventoryWith([0, stack('stone', 10)], [1, stack('stone', 60)], [2, stack('dirt', 5)]),
      )

      expect(
        yield* inventory.api.click({ _tag: 'LeftClick', slotIndex: 0, carried: undefined }),
      ).toStrictEqual({ _tag: 'PickedUp', carried: stack('stone', 10) })
      expect(
        yield* inventory.api.click({ _tag: 'LeftClick', slotIndex: 1, carried: stack('stone', 10) }),
      ).toStrictEqual({ _tag: 'Merged', carried: stack('stone', 6) })
      expect(
        yield* inventory.api.click({ _tag: 'LeftClick', slotIndex: 2, carried: stack('stone', 6) }),
      ).toStrictEqual({ _tag: 'Swapped', carried: stack('dirt', 5) })
      expect(
        yield* inventory.api.click({ _tag: 'LeftClick', slotIndex: 0, carried: stack('dirt', 5) }),
      ).toStrictEqual({ _tag: 'Placed', carried: undefined })

      const snapshot = yield* inventory.api.snapshot
      expect(snapshot.slots[0]).toStrictEqual(stack('dirt', 5))
      expect(snapshot.slots[1]).toStrictEqual(stack('stone', 64))
      expect(snapshot.slots[2]).toStrictEqual(stack('stone', 6))
    }),
  )

  it.effect('right click picks up half and places one item at a time', () =>
    Effect.gen(function* () {
      const inventory = yield* makeInventoryDouble(inventoryWith([0, stack('stone', 5)]))

      expect(
        yield* inventory.api.click({ _tag: 'RightClick', slotIndex: 0, carried: undefined }),
      ).toStrictEqual({ _tag: 'PickedUp', carried: stack('stone', 3) })
      expect(
        yield* inventory.api.click({ _tag: 'RightClick', slotIndex: 1, carried: stack('stone', 3) }),
      ).toStrictEqual({ _tag: 'Placed', carried: stack('stone', 2) })
      expect(
        yield* inventory.api.click({ _tag: 'RightClick', slotIndex: 1, carried: stack('stone', 2) }),
      ).toStrictEqual({ _tag: 'Merged', carried: stack('stone', 1) })

      const snapshot = yield* inventory.api.snapshot
      expect(snapshot.slots[0]).toStrictEqual(stack('stone', 2))
      expect(snapshot.slots[1]).toStrictEqual(stack('stone', 2))
    }),
  )

  it.effect('rejects an invalid slot without changing inventory or carried stack', () =>
    Effect.gen(function* () {
      const initial = inventoryWith([0, stack('stone', 4)])
      const inventory = yield* makeInventoryDouble(initial)
      const carried = stack('dirt', 2)

      expect(
        yield* inventory.api.click({ _tag: 'LeftClick', slotIndex: -1, carried }),
      ).toStrictEqual({ _tag: 'InvalidSlot', carried })
      expect((yield* inventory.api.snapshot).slots).toStrictEqual(initial)
    }),
  )
})
