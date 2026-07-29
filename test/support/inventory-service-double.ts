/**
 * A test double typed directly by mc-sim's `InventoryService`.
 *
 * ---------------------------------------------------------------------------
 * Why a double at all, and what makes it meaningful
 * ---------------------------------------------------------------------------
 *
 * The argument `chunk-store-double.ts` and `entity-manager-double.ts` make:
 * nothing is published (plan.md §6 Step 3 is bottom-up publish-then-pin), so
 * mx-gameplay cannot import mc-sim's implementation today, but it CAN be typed
 * by mc-sim's interface — and the mirror is pinned against that interface in
 * both directions by `test/inventory-mirror.test.ts`. The same scenarios
 * against the REAL service are mc-sim's `test/inventory.test.ts` and its own
 * vertical slice; between the two the whole path is covered, and when mc-sim is
 * published this file is deleted and its Layer is replaced by
 * `InventoryServiceLayer()`.
 *
 * ---------------------------------------------------------------------------
 * IT IS A REAL INVENTORY, AND `./roster.ts`'s REFUSAL IS THE REASON IT MAY BE
 * ---------------------------------------------------------------------------
 *
 * `apps/preview-mining-site/roster.ts` refuses to implement mc-sim's roster and
 * states the test it applied: a working one would be A SECOND IMPLEMENTATION OF
 * MC-SIM'S SERVICE living in mx-gameplay, and nothing there is under test. The
 * store double answers the same question the other way — it implements a real
 * store 「because the rules under test read and write blocks and a store that
 * refused would test nothing」.
 *
 * The inventory is now on the second side of that line. `gameplay:interactions`
 * deposits every mined item through `add` and READS THE NUMBER BACK, so a
 * double that refused, or that always answered `0`, would make the leftover
 * path untestable — and the leftover path is the one that loses items.
 *
 * ---------------------------------------------------------------------------
 * THE THREE PROPERTIES IT REPRODUCES, AND WHY IT MUST
 * ---------------------------------------------------------------------------
 *
 * All three are `mc-sim/domain/inventory.ts`'s `addItem`, transcribed, and all
 * three change the LEFTOVER — which is the only number this repository reads:
 *
 *   - PARTIAL STACKS ARE TOPPED UP BEFORE EMPTY SLOTS ARE OPENED. Filling empty
 *     slots first fragments an inventory into many partial stacks of one item
 *     and the player finds 36 slots full while holding barely any material. A
 *     double that opened a new slot per `add` would report leftover 0 for a
 *     working inventory and for a broken one alike.
 *   - A STACK CAPS AT `MAX_STACK_COUNT`, and a full inventory is 36 x 64 of one
 *     item and not 36 x infinity. Without the cap nothing ever overflows and
 *     `stages/registration.ts`'s leftover branch is dead code no test reaches.
 *   - A QUANTITY THAT IS NOT A QUANTITY LEAVES NOTHING BEHIND. mc-sim reports a
 *     rejected `count` as leftover — 2.5 items asked for is 2.5 not placed —
 *     EXCEPT when it is not finite, because a `NaN` leftover is a number every
 *     caller downstream would believe. That asymmetry is transcribed rather
 *     than simplified: it is the preview's finding F5 in mc-sim's handwriting.
 *
 * ---------------------------------------------------------------------------
 * What it counts, and what it refuses
 * ---------------------------------------------------------------------------
 *
 * `deposits` is the log of `add` calls, in order, each with what came back.
 * That is not decoration: 「one `add` per mined stack, and the loot folded into
 * ONE stack rather than emitted twice」 is a claim about the number of CALLS,
 * and asserting it on the resulting slots instead would pass for a stage that
 * called `add(item, 1)` three times.
 *
 * The four crafting members die rather than answering plausibly, following the
 * store double's rule for `load`: no rule in this repository crafts, mc-sim's
 * recipe resolution is pinned by mc-sim's own tests, and a double that
 * half-implemented `matchRecipe` would let a test here assert a match nobody
 * computes. `restore` dies for the same reason the roster double's does — the
 * world-load path is the host's.
 */
import { Effect, Layer, Ref } from 'effect'
import { MAX_STACK_COUNT, StackCount } from '../../domain/frame-contract'
import {
  InventoryService,
  type Inventory,
  type InventoryServiceApi,
  type Slot,
} from '@nerima-games/mc-sim'
import type { ItemType } from '../../domain/item-vocabulary'

/** mc-sim's `INVENTORY_SLOT_COUNT`, transcribed. The number that makes overflow reachable. */
export const INVENTORY_SLOT_COUNT = 36

/** One `add` call and the number that came back. */
export type Deposit = {
  readonly item: ItemType
  readonly count: number
  /** What did NOT fit. `0` is the ordinary answer. */
  readonly leftover: number
}

/** One `remove` call and the number that came back. */
export type Withdrawal = {
  readonly item: ItemType
  readonly count: number
  /** What was ACTUALLY TAKEN — the opposite polarity to `Deposit.leftover`. */
  readonly removed: number
}

export type InventoryDouble = {
  /** Handed straight to `gameplayStages`, which takes the API rather than the tag. */
  readonly api: InventoryServiceApi
  /** For the `makeGameplayStages` path, which acquires the tag itself. */
  readonly layer: Layer.Layer<InventoryService>
  readonly deposits: Effect.Effect<ReadonlyArray<Deposit>>
  readonly withdrawals: Effect.Effect<ReadonlyArray<Withdrawal>>
}

type Doubles = {
  slots: ReadonlyArray<Slot>
  deposits: ReadonlyArray<Deposit>
  withdrawals: ReadonlyArray<Withdrawal>
}

/** An empty inventory of the right width. mc-sim's `emptyInventory`. */
export const emptySlots = (): ReadonlyArray<Slot> =>
  Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined)

/**
 * `mc-sim/domain/inventory.ts`'s `addItem`, transcribed, minus the repair
 * helpers.
 *
 * `heldCount` and `derivedStackCount` are NOT reproduced. They guard an
 * inventory this module did not build — a slot restored from another build's
 * save holding 200, or a fraction, or `NaN` — and no such slot can reach here:
 * `restore` dies, and every slot below was written by this function. Copying
 * them would be copying a repair for a case this double cannot represent, which
 * is the direction that makes a double MORE permissive than the service.
 */
const addTo = (
  slots: ReadonlyArray<Slot>,
  item: ItemType,
  count: number,
): { readonly slots: ReadonlyArray<Slot>; readonly leftover: number } => {
  if (!Number.isInteger(count) || count <= 0) {
    return { slots, leftover: Number.isFinite(count) ? Math.max(0, count) : 0 }
  }

  const next = [...slots]
  let remaining = count

  // Top up partial stacks of the same item first. See the module header.
  for (let index = 0; index < next.length && remaining > 0; index += 1) {
    const slot = next[index]
    if (slot === undefined || slot.item !== item || slot.count >= MAX_STACK_COUNT) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT - slot.count, remaining)
    next[index] = { item, count: StackCount(slot.count + accepted) }
    remaining -= accepted
  }

  // Only then open empty ones.
  for (let index = 0; index < next.length && remaining > 0; index += 1) {
    if (next[index] !== undefined) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT, remaining)
    next[index] = { item, count: StackCount(accepted) }
    remaining -= accepted
  }

  return { slots: next, leftover: remaining }
}

/**
 * `mc-sim/domain/inventory.ts`'s `removeItem`, transcribed.
 *
 * LAST-FIRST, which is vanilla's consumption order and, more usefully, makes
 * `add` followed by `remove` of the same amount restore the original slot
 * layout rather than leaving a hole earlier in the inventory.
 */
const removeFrom = (
  slots: ReadonlyArray<Slot>,
  item: ItemType,
  count: number,
): { readonly slots: ReadonlyArray<Slot>; readonly removed: number } => {
  if (!Number.isInteger(count) || count <= 0) {
    return { slots, removed: 0 }
  }

  const next = [...slots]
  let remaining = count

  for (let index = next.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const slot = next[index]
    if (slot === undefined || slot.item !== item) {
      continue
    }
    const taken = Math.min(slot.count, remaining)
    const left = slot.count - taken
    next[index] = left === 0 ? undefined : { item, count: StackCount(left) }
    remaining -= taken
  }

  return { slots: next, removed: count - remaining }
}

const totalOf = (slots: ReadonlyArray<Slot>, item: ItemType): number =>
  slots.reduce((running, slot) => (slot?.item === item ? running + slot.count : running), 0)

const refuse = <A>(what: string): Effect.Effect<A> =>
  Effect.dieMessage(
    `inventory-service-double: ${what} — not exercised by this repository's slice. See test/support/inventory-service-double.ts.`,
  )

export const makeInventoryDouble = (
  initial: ReadonlyArray<Slot> = emptySlots(),
): Effect.Effect<InventoryDouble> =>
  Effect.map(
    Ref.make<Doubles>({ slots: initial, deposits: [], withdrawals: [] }),
    (state) => {
      const api: InventoryServiceApi = {
        // `Ref.modify` and not get-then-set, which is mc-sim's own convention
        // and its reason (DN-07): two mining stages, a network item-sync and an
        // autosave read can all be in flight at once, and a read-modify-write
        // split across two Effects loses one of them.
        add: (item, count) =>
          Ref.modify(state, (doubles) => {
            const outcome = addTo(doubles.slots, item, count)
            return [
              outcome.leftover,
              {
                ...doubles,
                slots: outcome.slots,
                deposits: [...doubles.deposits, { item, count, leftover: outcome.leftover }],
              },
            ] as const
          }),

        remove: (item, count) =>
          Ref.modify(state, (doubles) => {
            const outcome = removeFrom(doubles.slots, item, count)
            return [
              outcome.removed,
              {
                ...doubles,
                slots: outcome.slots,
                withdrawals: [...doubles.withdrawals, { item, count, removed: outcome.removed }],
              },
            ] as const
          }),

        countOf: (item) => Effect.map(Ref.get(state), (doubles) => totalOf(doubles.slots, item)),

        snapshot: Effect.map(Ref.get(state), (doubles): Inventory => ({ slots: doubles.slots })),

        reset: Ref.update(state, (doubles) => ({ ...doubles, slots: emptySlots() })),

        // Not exercised by this repository's slice. See the module header.
        restore: () => refuse('restore'),
        recipes: refuse('recipes'),
        previewCraft: () => refuse('previewCraft'),
        craft: () => refuse('craft'),
      }

      return {
        api,
        layer: Layer.succeed(InventoryService, api),
        deposits: Effect.map(Ref.get(state), (doubles) => doubles.deposits),
        withdrawals: Effect.map(Ref.get(state), (doubles) => doubles.withdrawals),
      }
    },
  )

/**
 * An empty inventory as a Layer, for the tests that are about the SHAPE of the
 * registration rather than about any item.
 *
 * Declared after the factory it calls because it evaluates at module load — the
 * same note `chunk-store-double.ts`'s `emptyWorldStoreLayer` carries.
 */
export const emptyInventoryLayer: Layer.Layer<InventoryService> = Layer.effect(
  InventoryService,
  Effect.map(makeInventoryDouble(), (double) => double.api),
)

/**
 * Slots pre-filled so that ONE more of `item` will not fit.
 *
 * Every slot holds a full stack, which is the only arrangement in which `add`
 * overflows — 36 x 64 of one item. Built through `addTo` rather than written
 * out, so that the "full" this returns is the same "full" the service means.
 */
export const brimming = (item: ItemType): ReadonlyArray<Slot> =>
  addTo(emptySlots(), item, INVENTORY_SLOT_COUNT * MAX_STACK_COUNT).slots
