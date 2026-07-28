/**
 * A COMPLETE in-memory `InventoryService`, typed by this repository's mirror.
 *
 * The second of the three services `gameplayModule` requires. `./in-memory-chunk-store`
 * is the first and its header carries the argument for why these exist, why
 * they are not test doubles, and when they are deleted — read it rather than
 * having it repeated here.
 *
 * ---------------------------------------------------------------------------
 * IT HAS NO RECIPES, AND THAT IS AN ANSWER RATHER THAN A GAP
 * ---------------------------------------------------------------------------
 *
 * `recipes`, `previewCraft` and `craft` are implemented and return,
 * respectively, an empty table, `no-match`, and `no-match`. That is NOT the
 * `Effect.dieMessage` the test double answers with, and it is not a lie either:
 * **this inventory genuinely carries no recipes.**
 *
 * The recipe TABLE is mc-sim's data — `STARTER_RECIPES`, and the matching
 * (`matchRecipe`, `craftFromGrid`, `conflictsIn`) lives there too.
 * `./inventory-port.ts` mirrors the recipe TYPES and says so at length:
 * 「DEAD WEIGHT ON PURPOSE. No rule in this repository reads any of it」.
 * Implementing matching here would be writing mc-sim's algorithm in
 * mx-gameplay, which is the ownership error, not the missing feature.
 *
 * So a caller gets a truthful "nothing matches" instead of a crash, and the day
 * mc-sim publishes it gets real recipes with no call site changing. A player
 * can mine, carry and place; they cannot craft, and the reason is written down.
 *
 * ---------------------------------------------------------------------------
 * TWO SLOT RULES THAT LOOK LIKE DETAILS AND ARE NOT
 * ---------------------------------------------------------------------------
 *
 * Both transcribed from the double, which states them and their consequences:
 *
 *   PARTIAL STACKS ARE TOPPED UP BEFORE EMPTY SLOTS ARE OPENED. Opening a fresh
 *   slot per pickup fills all 36 while the player is holding barely any
 *   material, and the symptom is "my inventory is full" with a nearly empty
 *   grid.
 *
 *   A STACK CAPS AT `MAX_STACK_COUNT`. Without the cap nothing ever overflows,
 *   `add` always returns the full count, and the overflow path — the one that
 *   decides whether a mined block is kept or dropped — is never taken.
 */
import { Effect, Layer, Ref } from 'effect'
import { MAX_STACK_COUNT, StackCount } from './frame-contract'
import {
  InventoryService,
  type Inventory,
  type InventoryServiceApi,
  type CraftResult,
  type RecipeMatch,
  type RecipeTable,
  type Slot,
} from './inventory-port'
import type { ItemType } from './item-vocabulary'

/**
 * mc-sim's `INVENTORY_SLOT_COUNT`, transcribed.
 *
 * The number that makes overflow reachable. `./inventory-port.ts`'s header
 * records that the constants are deliberately NOT mirrored — only the types are
 * — so this is transcribed with its source named rather than imported.
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
 * into `[0, MAX_STACK_COUNT]`. `./inventory-port.ts` records the defect this
 * exists for: a two-slot save turned a 36-slot player into a two-slot one, and
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

/** An inventory with no recipes loaded. See the header. */
export const NO_RECIPES: RecipeTable = []

/** Build an inventory over the given slots. */
export const makeInMemoryInventory = (
  initial: ReadonlyArray<Slot> = emptySlots(),
): Effect.Effect<InventoryServiceApi> =>
  Effect.map(Ref.make<ReadonlyArray<Slot>>([...initial]), (state): InventoryServiceApi => ({
    /**
     * THE LEFTOVER, NOT THE ACCEPTED COUNT.
     *
     * `./inventory-port.ts` is explicit — "Resolves to the number that did NOT
     * fit ... NOT A SUCCESS FLAG. `0` means everything landed" — and the first
     * cut of this file returned the opposite. Inverted, a full inventory reads
     * as a perfect pickup and a perfect pickup reads as total failure, and both
     * type-check.
     */
    add: (item, count) =>
      Ref.modify(state, (slots) => {
        const result = addToSlots(slots, item, count)
        const leftover = Math.max(0, Math.floor(count)) - result.accepted
        return [leftover, result.slots] as const
      }),

    remove: (item, count) =>
      Ref.modify(state, (slots) => {
        const result = removeFromSlots(slots, item, count)
        return [result.removed, result.slots] as const
      }),

    countOf: (item) => Effect.map(Ref.get(state), (slots) => totalOf(slots, item)),

    snapshot: Effect.map(Ref.get(state), (slots): Inventory => ({ slots: [...slots] })),

    /**
     * ALSO THE LEFTOVER, in `add`'s currency — not the repair count.
     *
     * The mirror says so and warns that "the sibling mirror's `restore` sets
     * the opposite expectation". A normalised inventory drops nothing, so this
     * is 0 unless clamping discarded items — which it reports rather than
     * swallowing.
     */
    restore: (inventory) =>
      Ref.modify(state, () => {
        const result = normaliseInventory(inventory)
        return [result.discarded, result.slots] as const
      }),

    reset: Ref.set(state, emptySlots()),

    // Implemented and truthful: this inventory carries no recipes. See the
    // header on why matching is not written here.
    recipes: Effect.succeed(NO_RECIPES),
    previewCraft: () => Effect.succeed<RecipeMatch>({ _tag: 'NoMatch' }),
    craft: () => Effect.succeed<CraftResult>({ _tag: 'NoMatch' }),
  }))

/** The inventory as a Layer, for a host that composes `gameplayModule`. */
export const InMemoryInventoryLayer = (
  initial: ReadonlyArray<Slot> = emptySlots(),
): Layer.Layer<InventoryService> =>
  Layer.effect(InventoryService, makeInMemoryInventory(initial))
