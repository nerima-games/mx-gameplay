/**
 * `domain/interactions/unequip-armor.ts`.
 *
 * The reference's four cases are here, and the one worth the file is the
 * rollback: armour that comes off and will not fit must go back on. That case
 * reproduces only when the inventory is full, which is why it is stated as its
 * own outcome rather than left as a boolean.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import {
  ARMOR_SLOTS,
  NO_ARMOR,
  firstWornSlot,
  unequipTopmost,
  type Equipment,
  type UnequipPort,
} from '../src/domain/interactions/unequip-armor'
import type { ItemType } from '../src/domain/item-vocabulary'

/**
 * A body and an inventory, recording every call.
 *
 * `capacity` is how many more items the inventory will accept. 0 is the full
 * case the rollback exists for.
 */
const makeBody = (capacity: number) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const remaining = yield* Ref.make(capacity)
    const port: UnequipPort = {
      unequip: (slot) => Ref.update(calls, (all) => [...all, `unequip:${slot}`]),
      equip: (slot, item) => Ref.update(calls, (all) => [...all, `equip:${slot}:${item}`]),
      // Returns the LEFTOVER, matching `../inventory-port.ts`'s `add`. The
      // first cut of this fake returned the accepted count, which agreed with
      // a wrong comment in the port and hid an inverted check.
      add: (item, count) =>
        Effect.gen(function* () {
          const left = yield* Ref.get(remaining)
          const accepted = Math.min(left, count)
          yield* Ref.set(remaining, left - accepted)
          const leftover = count - accepted
          yield* Ref.update(calls, (all) => [...all, `add:${item}:${String(leftover)}`])
          return leftover
        }),
    }
    return { port, calls }
  })

// The rule never inspects the item, so any `ItemType` stands in for a piece of
// armour — which is the whole reason this file could be written before the
// vocabulary has armour in it.
const WORN: ItemType = 'stone'

describe('firstWornSlot', () => {
  it.effect('is undefined for a bare player', () =>
    Effect.sync(() => {
      expect(firstWornSlot(NO_ARMOR)).toBeUndefined()
    }),
  )

  it.effect('comes off head first, whatever order the record was built in', () =>
    Effect.sync(() => {
      // The order is a rule: a player pressing the key repeatedly expects a
      // stable sequence. Building the record boots-first would give a
      // key-iteration order that disagrees.
      const bootsFirst: Equipment = { boots: WORN, helmet: WORN }

      expect(firstWornSlot(bootsFirst)).toBe('helmet')
    }),
  )

  it.effect('finds each slot when it is the only one worn', () =>
    Effect.sync(() => {
      for (const slot of ARMOR_SLOTS) {
        expect(firstWornSlot({ [slot]: WORN } as Equipment)).toBe(slot)
      }
    }),
  )

  it.effect('REGRESSION: the slot order is the reference’s', () =>
    Effect.sync(() => {
      expect([...ARMOR_SLOTS]).toStrictEqual(['helmet', 'chestplate', 'leggings', 'boots'])
    }),
  )
})

describe('unequipTopmost', () => {
  it.effect('takes the piece off and stows it', () =>
    Effect.gen(function* () {
      const { port, calls } = yield* makeBody(1)

      const outcome = yield* unequipTopmost(port, { chestplate: WORN })

      expect(outcome).toStrictEqual({ _tag: 'unequipped', slot: 'chestplate', item: WORN })
      expect(yield* Ref.get(calls)).toStrictEqual(['unequip:chestplate', `add:${WORN}:0`])
    }),
  )

  it.effect('a bare player touches nothing', () =>
    Effect.gen(function* () {
      const { port, calls } = yield* makeBody(1)

      expect(yield* unequipTopmost(port, NO_ARMOR)).toStrictEqual({ _tag: 'nothingWorn' })
      expect(yield* Ref.get(calls)).toStrictEqual([])
    }),
  )

  it.effect('takes ONE piece per call, not the whole set', () =>
    Effect.gen(function* () {
      // Holding the key strips one layer per press. A version that looped would
      // empty the whole body on one keystroke.
      const { port, calls } = yield* makeBody(4)

      yield* unequipTopmost(port, { helmet: WORN, boots: WORN })

      expect((yield* Ref.get(calls)).filter((call) => call.startsWith('unequip:'))).toStrictEqual([
        'unequip:helmet',
      ])
    }),
  )
})

describe('the rollback, which is why this file is not one line', () => {
  it.effect('a full inventory puts the piece BACK ON', () =>
    Effect.gen(function* () {
      // Armour that vanished because the inventory happened to be full would be
      // the most expensive bug in the game, and reproduces only under a
      // condition nobody thinks to test.
      const { port, calls } = yield* makeBody(0)

      const outcome = yield* unequipTopmost(port, { helmet: WORN })

      expect(outcome).toStrictEqual({ _tag: 'inventoryFull', slot: 'helmet', item: WORN })
      expect(yield* Ref.get(calls)).toStrictEqual([
        'unequip:helmet',
        `add:${WORN}:1`,
        `equip:helmet:${WORN}`,
      ])
    }),
  )

  it.effect('the piece goes back into the SAME slot', () =>
    Effect.gen(function* () {
      // Re-equipping a helmet into the boots slot would pass any test that only
      // checked "equip was called".
      const { port, calls } = yield* makeBody(0)

      yield* unequipTopmost(port, { leggings: WORN })

      expect(yield* Ref.get(calls)).toContain(`equip:leggings:${WORN}`)
    }),
  )

  it.effect('REGRESSION: full and bare are DIFFERENT outcomes', () =>
    Effect.gen(function* () {
      // Folding both into `nothingWorn` would show "you are not wearing
      // anything" at the moment the player most needs "your inventory is full".
      const { port: fullPort } = yield* makeBody(0)
      const { port: emptyPort } = yield* makeBody(1)

      const full = yield* unequipTopmost(fullPort, { boots: WORN })
      const bare = yield* unequipTopmost(emptyPort, NO_ARMOR)

      expect(full._tag).not.toBe(bare._tag)
    }),
  )

  it.effect('the order is off, stow, then put back — never stow first', () =>
    Effect.gen(function* () {
      // Stowing first would need a slot the item is not in yet; checking
      // capacity first would be a TOCTOU against anything else writing the
      // inventory this frame.
      const { port, calls } = yield* makeBody(0)

      yield* unequipTopmost(port, { helmet: WORN })
      const recorded = yield* Ref.get(calls)

      expect(recorded[0]).toBe('unequip:helmet')
      expect(recorded[1]?.startsWith('add:')).toBe(true)
      expect(recorded[2]?.startsWith('equip:')).toBe(true)
    }),
  )
})
