/**
 * A REAL INVENTORY for the preview, typed by this repository's mirror of
 * mc-sim's `InventoryService` (`domain/inventory-port.ts`).
 *
 * ---------------------------------------------------------------------------
 * `./roster.ts` REFUSES TO DO THIS, AND THE DIFFERENCE IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 *
 * That file states the test and then applies it: `./world.ts` implements a real
 * store 「because the rules under test read and write blocks and a store that
 * refused would test nothing」, while the roster refuses because 「nothing here
 * is under test: this preview never spawns, never sets a target and never
 * offers a spawn candidate, so a working roster would be A SECOND
 * IMPLEMENTATION OF MC-SIM'S SERVICE living in mx-gameplay」.
 *
 * The inventory is on `./world.ts`'s side of that line, and only since
 * `stages/registration.ts` started depositing. `gameplay:interactions` calls
 * `add` for every mined stack and READS THE NUMBER BACK, so a refusing
 * inventory would kill the preview on the first swing and an always-`0` one
 * would make the leftover path — the path that loses items — invisible. This is
 * the preview playing mc-sim, exactly as `./world.ts` plays mc-worldgen, and it
 * is deleted the day mc-sim is published and `InventoryServiceLayer()` replaces
 * it.
 *
 * ---------------------------------------------------------------------------
 * It is a SECOND transcription of mc-sim's `addItem`, and that is deliberate
 * ---------------------------------------------------------------------------
 *
 * `test/support/inventory-service-double.ts` holds the first, and the two do
 * not share a file for the reason `./world.ts` and
 * `test/support/chunk-store-double.ts` do not: `tsconfig.build.json` proves the
 * shipped rules are platform-free and `tsconfig.preview.json` deliberately does
 * NOT include `test/**`, so a preview that imported a test double would be
 * reaching across a boundary that exists to keep Node types out of `domain/`.
 * Putting either implementation in `domain/` would be far worse — it would be
 * mx-gameplay shipping an inventory.
 *
 * What the duplication buys is that the two are INDEPENDENT witnesses of the
 * same rule: the tests and the screen agree about what a full inventory does
 * because both copied mc-sim, not because both copied each other.
 *
 * ---------------------------------------------------------------------------
 * What it refuses
 * ---------------------------------------------------------------------------
 *
 * The four crafting members die, following `./roster.ts`'s rule exactly: there
 * is no crafting rule in this repository and no crafting screen in this
 * preview, so a `matchRecipe` here would be the second implementation
 * `./roster.ts` is about, arriving through the one member nobody would check.
 * `restore` dies because the world-load path is a host's and this preview loads
 * no world.
 */
import { Effect, Ref } from 'effect'
import { MAX_STACK_COUNT, StackCount } from '../../domain/frame-contract'
import type { MinedItem } from '../../domain/interactions/block-loot'
import type { Inventory, InventoryServiceApi, Slot } from '../../domain/inventory-port'
import type { ItemType } from '../../domain/item-vocabulary'

/** mc-sim's `INVENTORY_SLOT_COUNT`. The number that makes overflow reachable. */
export const INVENTORY_SLOT_COUNT = 36

const emptySlots = (): ReadonlyArray<Slot> =>
  Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined)

/**
 * `mc-sim/domain/inventory.ts`'s `addItem`, transcribed.
 *
 * Partial stacks are topped up before empty slots are opened, a stack caps at
 * `MAX_STACK_COUNT`, and a `count` that is not a positive integer is reported
 * as leftover unless it is not finite — in which case nothing is left behind,
 * because a `NaN` leftover is a number every caller downstream would believe.
 * The test double carries the same three paragraphs at length.
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

  for (let index = 0; index < next.length && remaining > 0; index += 1) {
    const slot = next[index]
    if (slot === undefined || slot.item !== item || slot.count >= MAX_STACK_COUNT) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT - slot.count, remaining)
    next[index] = { item, count: StackCount(slot.count + accepted) }
    remaining -= accepted
  }

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

/** `mc-sim/domain/inventory.ts`'s `removeItem`, transcribed. LAST-FIRST. */
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

const refuse = <A>(what: string): Effect.Effect<A> =>
  Effect.dieMessage(
    `preview-mining-site: ${what} — this preview has no crafting screen, and mx-gameplay must not implement mc-sim's recipe resolution. See apps/preview-mining-site/inventory.ts.`,
  )

export type PreviewInventory = {
  /** Handed to `gameplayStages`, which takes the API rather than the tag. */
  readonly api: InventoryServiceApi
  /**
   * Held totals, item name to count, for the HUD.
   *
   * A PROJECTION OF `snapshot`, not a tally this preview keeps. `./site.ts`
   * used to add up the outbox itself and its comment said so — 「This is the
   * preview playing mc-sim's `InventoryService.add` / `.remove` pair」. It is
   * playing the service for real now, so the number on screen is the number
   * mc-sim would answer, arrived at by mc-sim's stacking rule.
   */
  readonly held: Effect.Effect<ReadonlyMap<string, number>>
  /**
   * The `add` calls made since the last drain, as `{ item, count }`.
   *
   * `./world.ts`'s `takeWriteLog` in a different currency, and it exists for
   * the same reason: the frame tape reports what HAPPENED in a frame, and after
   * the wiring there is no outbox left to read that from. What the tape shows
   * is now the argument list of a call to mc-sim.
   */
  readonly takeDepositLog: Effect.Effect<ReadonlyArray<MinedItem>>
}

type State = {
  slots: ReadonlyArray<Slot>
  deposits: ReadonlyArray<MinedItem>
}

export const makePreviewInventory = (): Effect.Effect<PreviewInventory> =>
  Effect.map(Ref.make<State>({ slots: emptySlots(), deposits: [] }), (state) => {
    const api: InventoryServiceApi = {
      add: (item, count) =>
        Ref.modify(state, (current) => {
          const outcome = addTo(current.slots, item, count)
          return [
            outcome.leftover,
            { slots: outcome.slots, deposits: [...current.deposits, { item, count }] },
          ] as const
        }),

      remove: (item, count) =>
        Ref.modify(state, (current) => {
          const outcome = removeFrom(current.slots, item, count)
          return [outcome.removed, { ...current, slots: outcome.slots }] as const
        }),

      countOf: (item) =>
        Effect.map(Ref.get(state), (current) =>
          current.slots.reduce(
            (running, slot) => (slot?.item === item ? running + slot.count : running),
            0,
          ),
        ),

      snapshot: Effect.map(Ref.get(state), (current): Inventory => ({ slots: current.slots })),

      reset: Ref.update(state, (current) => ({ ...current, slots: emptySlots() })),

      restore: () => refuse('restore'),
      recipes: refuse('recipes'),
      previewCraft: () => refuse('previewCraft'),
      craft: () => refuse('craft'),
    }

    return {
      api,
      held: Effect.map(Ref.get(state), (current) => {
        const totals = new Map<string, number>()
        for (const slot of current.slots) {
          if (slot !== undefined) {
            totals.set(slot.item, (totals.get(slot.item) ?? 0) + slot.count)
          }
        }
        return totals
      }),
      takeDepositLog: Ref.modify(state, (current) => [
        current.deposits,
        { ...current, deposits: [] },
      ]),
    }
  })
