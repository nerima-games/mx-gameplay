/**
 * `domain/in-memory-inventory.ts`.
 *
 * THE POLARITY TESTS ARE THE POINT. `add` and `restore` both resolve to the
 * LEFTOVER — the number that did NOT fit — and `remove` resolves to the number
 * that DID come out. Three numbers, two conventions, one type; the mirror warns
 * about it ("NOT A SUCCESS FLAG") and the first cut of the implementation got
 * both leftovers backwards anyway.
 *
 * Inverted, a full inventory reads as a perfect pickup and a perfect pickup
 * reads as total failure. Both type-check, and every other test in this file
 * passes either way — which is why these are stated as their own cases with
 * their own names.
 */
import { describe, expect, it } from '@effect/vitest'
import { InventoryService, STARTER_RECIPES, craftGrid, type Slot } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import {
  INVENTORY_SLOT_COUNT,
  InMemoryInventoryLayer,
  addToSlots,
  emptySlots,
  makeInMemoryInventory,
  normaliseInventory,
  removeFromSlots,
  totalOf,
} from '../src/domain/in-memory-inventory'
import { MAX_STACK_COUNT, StackCount, type ItemType } from '@nerima-games/mc-kernel'

const STONE: ItemType = 'stone'
const DIRT: ItemType = 'dirt'
const OAK_LOG: ItemType = 'oak_log'
const OAK_PLANKS: ItemType = 'oak_planks'

const stack = (item: ItemType, count: number): Slot => ({ item, count: StackCount(count) })

/**
 * A slot as an UNTRUSTED SAVE FILE contains one.
 *
 * `StackCount` is a refined brand and refuses anything outside [0, 64] — so a
 * malformed stack cannot be built through it, and that is the point: `restore`
 * exists for values that never went through the constructor. A save read back
 * from JSON is a plain object, and the brand is erased by then.
 */
const savedStack = (item: ItemType, count: number): Slot =>
  ({ item, count }) as unknown as Slot

describe('add resolves to the LEFTOVER', () => {
  it.effect('a pickup that fits resolves to 0', () =>
    Effect.gen(function* () {
      // "0 means everything landed" — the mirror's words. A version returning
      // the accepted count would answer 5 here and read as a failure.
      const inventory = yield* makeInMemoryInventory()

      expect(yield* inventory.add(STONE, 5)).toBe(0)
      expect(yield* inventory.countOf(STONE)).toBe(5)
    }),
  )

  it.effect('a pickup that does not fit resolves to what is left over', () =>
    Effect.gen(function* () {
      // A one-slot inventory, already full of dirt, with one free stack of room.
      const full: ReadonlyArray<Slot> = Array.from({ length: INVENTORY_SLOT_COUNT }, (_, at) =>
        at === 0 ? undefined : stack(DIRT, MAX_STACK_COUNT),
      )
      const inventory = yield* makeInMemoryInventory(full)

      const leftover = yield* inventory.add(STONE, MAX_STACK_COUNT + 7)

      expect(leftover).toBe(7)
      expect(yield* inventory.countOf(STONE)).toBe(MAX_STACK_COUNT)
    }),
  )

  it.effect('REGRESSION: a completely full inventory resolves to the whole count', () =>
    Effect.gen(function* () {
      // The case the inverted version answers 0 to — indistinguishable from a
      // perfect pickup, and the mined block silently disappears.
      const full = Array.from({ length: INVENTORY_SLOT_COUNT }, () => stack(DIRT, MAX_STACK_COUNT))
      const inventory = yield* makeInMemoryInventory(full)

      expect(yield* inventory.add(STONE, 3)).toBe(3)
      expect(yield* inventory.countOf(STONE)).toBe(0)
    }),
  )

  it.effect('remove has the OPPOSITE polarity, and resolves to what came out', () =>
    Effect.gen(function* () {
      const inventory = yield* makeInMemoryInventory()
      yield* inventory.add(STONE, 4)

      expect(yield* inventory.remove(STONE, 10)).toBe(4)
      expect(yield* inventory.countOf(STONE)).toBe(0)
    }),
  )
})

describe('the two slot rules', () => {
  it.effect('partial stacks are topped up before empty slots are opened', () =>
    Effect.sync(() => {
      // Opening a fresh slot per pickup fills all 36 while the player holds
      // barely any material — "my inventory is full" over a nearly empty grid.
      const slots: ReadonlyArray<Slot> = [stack(STONE, 1), undefined, undefined]

      const result = addToSlots(slots, STONE, 5)

      expect(result.slots[0]).toStrictEqual(stack(STONE, 6))
      expect(result.slots[1]).toBeUndefined()
    }),
  )

  it.effect('a stack caps at MAX_STACK_COUNT and overflows into the next slot', () =>
    Effect.sync(() => {
      // Without the cap nothing ever overflows, `add` always answers 0, and the
      // path that decides whether a mined block is kept is never taken.
      const result = addToSlots(emptySlots(), STONE, MAX_STACK_COUNT + 1)

      expect(result.slots[0]).toStrictEqual(stack(STONE, MAX_STACK_COUNT))
      expect(result.slots[1]).toStrictEqual(stack(STONE, 1))
      expect(result.accepted).toBe(MAX_STACK_COUNT + 1)
    }),
  )

  it.effect('pass two skips a slot pass one already left occupied', () =>
    Effect.sync(() => {
      // Slot 0 holds dirt (a different item, so pass one's top-up skips it
      // too) and is still occupied when pass two goes looking for empty
      // slots to open — it must skip over it rather than overwrite it.
      const slots: ReadonlyArray<Slot> = [stack(DIRT, 5), undefined]

      const result = addToSlots(slots, STONE, 3)

      expect(result.slots[0]).toStrictEqual(stack(DIRT, 5))
      expect(result.slots[1]).toStrictEqual(stack(STONE, 3))
      expect(result.accepted).toBe(3)
    }),
  )

  it.effect('removing skips slots holding a different item', () =>
    Effect.sync(() => {
      const result = removeFromSlots([stack(DIRT, 3), stack(STONE, 2)], STONE, 2)

      expect(result.slots[0]).toStrictEqual(stack(DIRT, 3))
      expect(result.slots[1]).toBeUndefined()
      expect(result.removed).toBe(2)
    }),
  )

  it.effect('removing empties a slot rather than leaving a zero stack', () =>
    Effect.sync(() => {
      // A zero-count stack still occupies a slot and still matches `item`,
      // so the inventory would fill with invisible empties.
      const result = removeFromSlots([stack(STONE, 2)], STONE, 2)

      expect(result.slots[0]).toBeUndefined()
      expect(result.removed).toBe(2)
    }),
  )

  it.effect('a partial removal leaves the remainder behind in the slot', () =>
    Effect.sync(() => {
      const result = removeFromSlots([stack(STONE, 5)], STONE, 2)

      expect(result.slots[0]).toStrictEqual(stack(STONE, 3))
      expect(result.removed).toBe(2)
    }),
  )

  it.effect('totalOf sums across slots', () =>
    Effect.sync(() => {
      expect(totalOf([stack(STONE, 3), undefined, stack(STONE, 4)], STONE)).toBe(7)
      expect(totalOf([stack(DIRT, 3)], STONE)).toBe(0)
    }),
  )
})

describe('restore re-establishes the invariant', () => {
  it.effect('a short save is padded to the full slot count', () =>
    Effect.sync(() => {
      // The recorded defect: a two-slot save turned a 36-slot player into a
      // two-slot one, and the next 872 mined blocks went on the floor with no
      // symptom but a full inventory.
      const result = normaliseInventory({ slots: [stack(STONE, 1)] })

      expect(result.slots).toHaveLength(INVENTORY_SLOT_COUNT)
      expect(result.discarded).toBe(0)
    }),
  )

  it.effect('a long save is truncated, and the lost ITEMS are reported', () =>
    Effect.sync(() => {
      const overlong = [
        ...Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined),
        stack(STONE, 5),
      ]

      const result = normaliseInventory({ slots: overlong })

      expect(result.slots).toHaveLength(INVENTORY_SLOT_COUNT)
      expect(result.discarded).toBe(5)
    }),
  )

  it.effect('an over-full stack is clamped and the excess counted', () =>
    Effect.sync(() => {
      const result = normaliseInventory({ slots: [savedStack(STONE, MAX_STACK_COUNT + 9)] })

      expect(result.slots[0]?.count).toBe(MAX_STACK_COUNT)
      expect(result.discarded).toBe(9)
    }),
  )

  it.effect('a save with a negative count clamps to an empty slot, not a negative discard', () =>
    Effect.sync(() => {
      // A corrupted save cannot go negative through Math.max(0, ...) — the
      // slot drops out entirely and the malformed count is not tallied as a
      // loss, since there was never a real item there to lose.
      const result = normaliseInventory({ slots: [savedStack(STONE, -5)] })

      expect(result.slots[0]).toBeUndefined()
      expect(result.discarded).toBe(0)
    }),
  )

  it.effect('a hole past the slot boundary costs nothing', () =>
    Effect.sync(() => {
      // Longer than INVENTORY_SLOT_COUNT, but the overflow itself is empty —
      // distinct from the case above where the overflow holds a real stack.
      const overlong = [...Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined), undefined]

      const result = normaliseInventory({ slots: overlong })

      expect(result.slots).toHaveLength(INVENTORY_SLOT_COUNT)
      expect(result.discarded).toBe(0)
    }),
  )

  it.effect('REGRESSION: restore reports the LEFTOVER, not a repair count', () =>
    Effect.gen(function* () {
      // Two different quantities in the same `number`. A padded 2-slot save
      // repairs 34 slots and discards nothing; answering 34 would tell a host
      // it lost 34 items it still has.
      const inventory = yield* makeInMemoryInventory()

      expect(yield* inventory.restore({ slots: [stack(STONE, 1)] })).toBe(0)
      expect(yield* inventory.countOf(STONE)).toBe(1)
    }),
  )
})

describe('crafting delegates to mc-sim', () => {
  it.effect('previews and crafts oak planks against the same inventory state', () =>
    Effect.gen(function* () {
      const inventory = yield* makeInMemoryInventory()
      const grid = craftGrid(1, 1, [OAK_LOG])

      expect(yield* inventory.recipes).toStrictEqual(STARTER_RECIPES)
      yield* inventory.add(OAK_LOG, 1)

      const beforePreview = yield* inventory.snapshot
      expect((yield* inventory.previewCraft(grid))._tag).toBe('Match')
      expect(yield* inventory.snapshot).toStrictEqual(beforePreview)

      expect((yield* inventory.craft(grid))._tag).toBe('Crafted')
      expect(yield* inventory.countOf(OAK_LOG)).toBe(0)
      expect(yield* inventory.countOf(OAK_PLANKS)).toBe(4)
    }),
  )
})

describe('InMemoryInventoryLayer', () => {
  it.effect('provides InventoryService to a host that composes gameplayModule', () =>
    Effect.gen(function* () {
      const service = yield* InventoryService

      expect(yield* service.add(STONE, 5)).toBe(0)
      expect(yield* service.countOf(STONE)).toBe(5)
    }).pipe(Effect.provide(InMemoryInventoryLayer())),
  )

  it.effect('accepts an initial slot layout', () =>
    Effect.gen(function* () {
      const service = yield* InventoryService

      expect(yield* service.countOf(DIRT)).toBe(3)
    }).pipe(
      Effect.provide(
        InMemoryInventoryLayer([stack(DIRT, 3), ...Array.from({ length: INVENTORY_SLOT_COUNT - 1 }, () => undefined)]),
      ),
    ),
  )
})

describe('snapshot and reset', () => {
  it.effect('snapshot does not alias the live slots', () =>
    Effect.gen(function* () {
      const inventory = yield* makeInMemoryInventory()
      yield* inventory.add(STONE, 1)

      const before = yield* inventory.snapshot
      yield* inventory.add(DIRT, 1)

      expect(totalOf(before.slots, DIRT)).toBe(0)
    }),
  )

  it.effect('reset empties every slot', () =>
    Effect.gen(function* () {
      const inventory = yield* makeInMemoryInventory()
      yield* inventory.add(STONE, 10)

      yield* inventory.reset

      expect(yield* inventory.countOf(STONE)).toBe(0)
      expect((yield* inventory.snapshot).slots).toHaveLength(INVENTORY_SLOT_COUNT)
    }),
  )
})
