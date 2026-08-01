/**
 * The gameplay-facing constructor for mc-sim's in-memory inventory.
 *
 * State and crafting must share one service instance: delegating construction
 * to mc-sim keeps slot mutations, recipe previews, and crafting transactions on
 * the same Ref. The pure slot helpers below remain exported for compatibility.
 */
import {
  InventoryService,
  makeInventoryService,
  type Inventory,
  type InventoryServiceApi,
  type RecipeTable,
  type Slot,
} from '@nerima-games/mc-sim'
import { Effect, Layer } from 'effect'
import { MAX_STACK_COUNT, StackCount } from './frame-contract'
import type { ItemType } from './item-vocabulary'

/**
 * mc-sim's `INVENTORY_SLOT_COUNT`, transcribed.
 *
 * Kept as a public compatibility constant; mc-sim applies the same capacity.
 */
export const INVENTORY_SLOT_COUNT = 36

/** An inventory with every slot empty. */
export const emptySlots = (): ReadonlyArray<Slot> =>
  Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined)

/** How many of `item` the slots hold in total. */
export const totalOf = (slots: ReadonlyArray<Slot>, item: ItemType): number =>
  slots.reduce((running, slot: Slot) => (slot?.item === item ? running + slot.count : running), 0)

/**
 * Put items in, topping up partial stacks first.
 *
 * Returns the new slots and how many were ACCEPTED — which is less than
 * requested when the inventory fills, and is the number `add` reports.
 */
export const addToSlots = (
  slots: ReadonlyArray<Slot>,
  item: ItemType,
  count: number,
): { readonly slots: ReadonlyArray<Slot>; readonly accepted: number } => {
  const next = [...slots]
  let remaining = Math.max(0, Math.floor(count))
  const requested = remaining

  // Pass one: top up what is already there. See the header.
  for (let at = 0; at < next.length && remaining > 0; at += 1) {
    const slot = next[at]
    if (slot === undefined || slot.item !== item || slot.count >= MAX_STACK_COUNT) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT - slot.count, remaining)
    next[at] = { item, count: StackCount(slot.count + accepted) }
    remaining -= accepted
  }

  // Pass two: open empty slots, each capped at a full stack.
  for (let at = 0; at < next.length && remaining > 0; at += 1) {
    if (next[at] !== undefined) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT, remaining)
    next[at] = { item, count: StackCount(accepted) }
    remaining -= accepted
  }

  return { slots: next, accepted: requested - remaining }
}

/** Take items out. Returns the new slots and how many were actually removed. */
export const removeFromSlots = (
  slots: ReadonlyArray<Slot>,
  item: ItemType,
  count: number,
): { readonly slots: ReadonlyArray<Slot>; readonly removed: number } => {
  const next = [...slots]
  let remaining = Math.max(0, Math.floor(count))
  const requested = remaining

  for (let at = 0; at < next.length && remaining > 0; at += 1) {
    const slot = next[at]
    if (slot === undefined || slot.item !== item) {
      continue
    }
    const taken = Math.min(slot.count, remaining)
    const left = slot.count - taken
    next[at] = left === 0 ? undefined : { item, count: StackCount(left) }
    remaining -= taken
  }

  return { slots: next, removed: requested - remaining }
}

/**
 * Re-establish the invariant a save file may not have.
 *
 * PADDED AND TRUNCATED TO EXACTLY `INVENTORY_SLOT_COUNT`, and stacks clamped
 * into `[0, MAX_STACK_COUNT]`. This exists because a two-slot save once turned
 * a 36-slot player into a two-slot one, and
 * the next 872 mined blocks went on the floor with no symptom but a full
 * inventory.
 *
 * Returns how many ITEMS were discarded — slots past the count, and the excess
 * of any stack over `MAX_STACK_COUNT`. That is `add`'s currency, which is what
 * `restore` reports; a repair COUNT would be a different quantity in the same
 * `number`, which is the shape a caller cannot tell apart.
 */
export const normaliseInventory = (
  inventory: Inventory,
): { readonly slots: ReadonlyArray<Slot>; readonly discarded: number } => {
  const next = emptySlots().map((_, at): Slot => {
    const slot = inventory.slots[at]
    if (slot === undefined) {
      return undefined
    }
    const clamped = Math.min(MAX_STACK_COUNT, Math.max(0, Math.floor(slot.count)))
    return clamped === 0 ? undefined : { item: slot.item, count: StackCount(clamped) }
  })

  let discarded = 0
  // Slots past the end: everything in them is lost.
  for (let at = INVENTORY_SLOT_COUNT; at < inventory.slots.length; at += 1) {
    discarded += inventory.slots[at]?.count ?? 0
  }
  // Stacks clamped down: the excess is lost.
  for (let at = 0; at < INVENTORY_SLOT_COUNT; at += 1) {
    const before = inventory.slots[at]
    const after = next[at]
    if (before !== undefined) {
      discarded += Math.max(0, before.count - (after?.count ?? 0))
    }
  }

  return { slots: next, discarded }
}

/** A reusable empty recipe table retained for public compatibility. */
export const NO_RECIPES: RecipeTable = []

/** Build mc-sim's recipe-enabled inventory over the given slots. */
export const makeInMemoryInventory = (
  initial: ReadonlyArray<Slot> = emptySlots(),
): Effect.Effect<InventoryServiceApi> =>
  makeInventoryService({ slots: initial })

/** The inventory as a Layer, for a host that composes `gameplayModule`. */
export const InMemoryInventoryLayer = (
  initial: ReadonlyArray<Slot> = emptySlots(),
): Layer.Layer<InventoryService> =>
  Layer.effect(InventoryService, makeInMemoryInventory(initial))
