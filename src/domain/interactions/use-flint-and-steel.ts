/**
 * ONE RULE, ONE FILE (DN-GP-9): what happens when a player uses an igniting
 * item on a cell.
 *
 * The reference implementation's
 * `<reference-impl>/packages/app/application/frame/stages/interaction-flint-steel-handler.ts`,
 * including its TNT-first ordering. `./ignite-tnt`, `./ignite-portal`, and
 * `./ignite-fire` are the rules; this file only decides which one is asked first.
 *
 * ---------------------------------------------------------------------------
 * PORTAL BEFORE FIRE, AND IT IS NOT ARBITRARY
 * ---------------------------------------------------------------------------
 *
 * The two rules WANT THE SAME CELL. `./ignite-portal` lights a frame whose
 * interior is air; `./ignite-fire` puts fire in a cell that is air. Every cell a
 * portal could be lit in is a cell fire could be lit in, so fire-first would
 * mean a player standing in front of a finished obsidian frame gets a small
 * flame in the middle of it and never a portal — and the flame LOOKS like the
 * item working, which is why the reference's own comment order is worth
 * preserving rather than rediscovering.
 *
 * The converse costs nothing: `./ignite-portal` answers `NoFrame` for every cell
 * that is not inside a ring, which is almost all of them, and it answers it
 * after between one and a few hundred pure array reads over an already-fetched
 * chunk window.
 *
 * ---------------------------------------------------------------------------
 * TNT GOES FIRST
 * ---------------------------------------------------------------------------
 *
 * A TNT block is removed and converted to a primed entity before either rule
 * can treat the target as portal interior or an ordinary fire cell.
 *
 * ---------------------------------------------------------------------------
 * WHICH ITEMS IGNITE IS A RULE; WHAT THEY ARE CALLED IS KERNEL'S
 * ---------------------------------------------------------------------------
 *
 * `../mob/mob-drop.ts` draws that line for `gunpowder` and it is drawn
 * again here: `flint_and_steel` and `fire_charge` are kernel's NAMES, arrived
 * with a kernel-side reason, and 「a flint and steel lights a portal」 is a RULE
 * and lives in this repository. `IGNITION_ITEM_TYPES` below is therefore a
 * subset of kernel's roster and not a second roster — it names two literals that
 * exist, which is the opposite of the eight the header of `./ignite-portal`
 * refuses to invent.
 */
import { Effect } from 'effect'
import type { BlockPosition, ChunkStoreApi } from '../chunk-store-port.js'
import type { ItemType } from '@nerima-games/mc-kernel'
import { igniteFire, type IgniteFireOutcome } from './ignite-fire.js'
import { ignitePortal, type IgnitePortalOutcome } from './ignite-portal.js'
import { igniteTnt, type IgniteTntOutcome } from './ignite-tnt.js'

/**
 * The items that light things, out of kernel's `ITEM_TYPES`.
 *
 * TWO, and both arrived in the same batch kernel's `ITEM_TYPES` — 「`flint_and_steel` / `fire_charge` […] each arrived with a
 * kernel-side reason」. This is the rule that makes them mean something.
 *
 * THEY BEHAVE IDENTICALLY BELOW, which is deliberate and is not the end state.
 * Vanilla spends them differently — a flint and steel loses one point of
 * durability, a fire charge is consumed whole — and that difference is about an
 * inventory SLOT, so it belongs to mc-sim's `InventoryService` and not to a rule
 * about blocks. `stages/registration.ts` parks which item was used so that the
 * distinction is not lost on the way out.
 */
export const IGNITION_ITEM_TYPES = ['flint_and_steel', 'fire_charge'] as const
export type IgnitionItemType = (typeof IGNITION_ITEM_TYPES)[number]

const IGNITION_ITEM_NAMES: ReadonlySet<string> = new Set<string>(IGNITION_ITEM_TYPES)

/**
 * Does this item light things?
 *
 * The proof obligation for `useFlintAndSteel`'s parameter, and it belongs to
 * whoever reads the hotbar — the same shape and the same argument as
 * `../block-vocabulary`'s `isPlaceableItem`, so that "you cannot light a portal
 * with a stick" is a TYPE ERROR where the request is built rather than a refusal
 * where it is serviced.
 */
export const isIgnitionItem = (item: ItemType): item is IgnitionItemType =>
  IGNITION_ITEM_NAMES.has(item)

/**
 * What one use of an igniting item did.
 *
 * A DISCRIMINATED PAIR rather than a flattened union of the two rules' outcomes,
 * so that a caller can tell WHICH rule answered. `Fire` carrying an
 * `IgniteFireOutcome` of `Occupied` and `Portal` carrying `NoFrame` are the two
 * halves of one ordinary refusal — the player pointed at a solid block — and
 * collapsing them would make the log of a working item look like a log of two
 * failures.
 */
export type IgnitionOutcome =
  | { readonly _tag: 'Tnt'; readonly outcome: IgniteTntOutcome }
  /** The portal arm answered, and its answer was not `NoFrame`. */
  | { readonly _tag: 'Portal'; readonly outcome: IgnitePortalOutcome }
  /** The portal arm found no frame, so the fire arm answered. */
  | { readonly _tag: 'Fire'; readonly outcome: IgniteFireOutcome }

/**
 * Use an igniting item on `position`, and report which rule answered.
 *
 * `item` is carried through unread, and that is on purpose: nothing about the
 * two ignitions differs by item today (see `IGNITION_ITEM_TYPES`), and a
 * parameter the rule ignores is cheaper to keep than a signature change on the
 * day durability arrives. The type still does the work — the parameter is the
 * proof that the caller checked.
 *
 * FALLS THROUGH ON `NoFrame` AND ON NOTHING ELSE. `ChunkNotLoaded` from the
 * portal arm is reported as-is rather than retried as fire: the window could not
 * be read, so the fire arm would be asked about a cell nobody could see, and it
 * would answer `ChunkNotLoaded` a second time after another store call. An
 * `UnknownBlock` is likewise a fact about this build's registry and trying the
 * other arm cannot change it.
 */
export const useFlintAndSteel = (
  store: ChunkStoreApi,
  position: BlockPosition,
  item: IgnitionItemType,
): Effect.Effect<IgnitionOutcome> =>
  Effect.gen(function* () {
    void item

    const tnt = yield* igniteTnt(store, position)
    if (
      tnt._tag !== 'NotTnt' &&
      tnt._tag !== 'ChunkNotLoaded' &&
      tnt._tag !== 'OutOfWorld'
    ) {
      return { _tag: 'Tnt', outcome: tnt }
    }

    const portal = yield* ignitePortal(store, position)
    if (portal._tag !== 'NoFrame') {
      return { _tag: 'Portal', outcome: portal }
    }

    return { _tag: 'Fire', outcome: yield* igniteFire(store, position) }
  })
