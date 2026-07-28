/**
 * ONE RULE, ONE FILE (DN-GP-9): take off the topmost piece of armour and put it
 * in the inventory.
 *
 * Ported from `interaction-item-use-handler/unequip-armor.ts`, which is 18 lines
 * and whose whole body is a loop over four slot names and a rollback.
 *
 * ---------------------------------------------------------------------------
 * FILED AS UNWRITABLE, AND WRONG FOR THE THIRD TIME
 * ---------------------------------------------------------------------------
 *
 * The triage recorded this as blocked because `../item-vocabulary.ts` has no
 * armour items — no `helmet`, no `chestplate`, none of the sixteen the
 * reference's `ARMOR_DEFENSE_POINTS` names.
 *
 * THE RULE NEVER LOOKS AT THE ITEM. It iterates SLOTS, takes whatever is in the
 * first occupied one, and hands it to the inventory. `helmet` here is a place
 * on the body, not a thing in the vocabulary, and the `ItemType` it holds is
 * passed through without a single comparison.
 *
 * That is the same discovery `./till-soil` and `./interaction-intent` made, and
 * `./draw-bow` stated first. Three of the five "vocabulary-blocked" verdicts in
 * the triage have now dissolved on inspection; the pattern is reliable enough
 * to be the first question rather than the last: **does the rule need the name,
 * or only what the name refers to?**
 *
 * ---------------------------------------------------------------------------
 * THE ROLLBACK IS THE RULE
 * ---------------------------------------------------------------------------
 *
 * Unequipping is two steps that can each fail independently: take it off, put
 * it away. If the inventory is full, the second fails — and the reference
 * RE-EQUIPS rather than dropping the piece or leaving it nowhere
 * (`unequip-armor.ts`: on failure, `equipmentService.equip(removed)`).
 *
 * That is the whole reason this file is not one line. Armour that vanished
 * because a player's inventory happened to be full would be the most expensive
 * bug in the game and would reproduce only under a condition nobody thinks to
 * test. `UnequipOutcome` names the case so a caller cannot ignore it.
 */
import { Effect } from 'effect'
import type { ItemType } from '../item-vocabulary'

/**
 * Where armour sits, in the order it comes off.
 *
 * HEAD FIRST, matching the reference's literal `['HELMET','CHESTPLATE',
 * 'LEGGINGS','BOOTS']`. The order is a rule, not a detail: a player pressing
 * the key repeatedly expects a stable sequence, and iterating a record's keys
 * instead would make it depend on insertion order.
 *
 * These are PLACES ON THE BODY and not entries in `../item-vocabulary.ts`. See
 * the header — that distinction is why this file exists.
 */
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'] as const
export type ArmorSlot = (typeof ARMOR_SLOTS)[number]

/** What is worn. An absent slot is an empty one. */
export type Equipment = Partial<Readonly<Record<ArmorSlot, ItemType>>>

/** Nothing worn. */
export const NO_ARMOR: Equipment = {}

/** What one unequip attempt did. */
export type UnequipOutcome =
  | { readonly _tag: 'unequipped'; readonly slot: ArmorSlot; readonly item: ItemType }
  /** Nothing is worn. */
  | { readonly _tag: 'nothingWorn' }
  /**
   * The piece came off and would not fit, so it was put back on.
   *
   * NAMED rather than folded into `nothingWorn`, because the two call for
   * different feedback: one is "you are not wearing anything", the other is
   * "your inventory is full" — and a caller that could not tell them apart
   * would show the wrong message at the moment the player most needs the right
   * one.
   */
  | { readonly _tag: 'inventoryFull'; readonly slot: ArmorSlot; readonly item: ItemType }

/**
 * The first occupied slot, in `ARMOR_SLOTS` order.
 *
 * PURE, so the order can be tested without an inventory. Returns `undefined`
 * for a bare player.
 */
export const firstWornSlot = (equipment: Equipment): ArmorSlot | undefined =>
  ARMOR_SLOTS.find((slot) => equipment[slot] !== undefined)

/** What the rule needs of an inventory and a body. */
export type UnequipPort = {
  /**
   * Take the piece off. The caller is responsible for the slot being occupied.
   */
  readonly unequip: (slot: ArmorSlot) => Effect.Effect<unknown>
  /** Put it back on, after a failed stow. */
  readonly equip: (slot: ArmorSlot, item: ItemType) => Effect.Effect<unknown>
  /**
   * Stow one item. Returns HOW MANY were accepted — 0 when the inventory is
   * full, matching `../inventory-port.ts`'s `add`, which returns a count rather
   * than a boolean because a partial accept is a real answer for a stack.
   */
  readonly add: (item: ItemType, count: number) => Effect.Effect<number>
}

/**
 * Take off the topmost piece, or say why not.
 *
 * THE ORDER OF OPERATIONS IS THE CORRECTNESS. Off, then stow, then put back on
 * failure. Stowing first would need a slot the item is not in yet; checking
 * capacity first would be a TOCTOU against anything else writing the inventory
 * in the same frame, and `../inventory-port.ts` offers no such query anyway.
 */
export const unequipTopmost = (
  port: UnequipPort,
  equipment: Equipment,
): Effect.Effect<UnequipOutcome> =>
  Effect.gen(function* () {
    const slot = firstWornSlot(equipment)
    if (slot === undefined) {
      return { _tag: 'nothingWorn' as const }
    }

    const item = equipment[slot]
    if (item === undefined) {
      // Unreachable while `firstWornSlot` is the only way in, and narrowed
      // rather than asserted: a non-null assertion here would be the one place
      // in this file a future change could make lie.
      return { _tag: 'nothingWorn' as const }
    }

    yield* port.unequip(slot)
    const accepted = yield* port.add(item, 1)

    if (accepted < 1) {
      // THE ROLLBACK. See the header: armour that vanished into a full
      // inventory would reproduce only under a condition nobody tests.
      yield* port.equip(slot, item)
      return { _tag: 'inventoryFull' as const, slot, item }
    }

    return { _tag: 'unequipped' as const, slot, item }
  })
