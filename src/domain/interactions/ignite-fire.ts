/**
 * ONE RULE, ONE FILE (DN-GP-9): a flint and steel used on an empty cell puts
 * fire in it.
 *
 * The reference implementation's
 * `<reference-impl>/packages/app/application/frame/stages/interaction-flint-steel-fire.ts`,
 * and the second arm of `./use-flint-and-steel` — the one that runs when
 * `./ignite-portal` finds no frame.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `./place-block` WITH `fire` AS THE HELD ITEM
 * ---------------------------------------------------------------------------
 *
 * It cannot be, and the reason is kernel's rather than a preference: `fire` is
 * in `BLOCK_TYPES` and is NOT in `ITEM_TYPES`, so it is not a member of
 * `PlaceableItemType` and `placeBlock` could not be handed it if one wanted to.
 * That is the correct roster — you cannot carry a stack of fire — and it is what
 * makes an item USE a different verb from a placement rather than a special case
 * of one: the item consumed and the block written are two different things.
 *
 * The same fact is why `./ignite-portal` writes `nether_portal` directly.
 *
 * ---------------------------------------------------------------------------
 * AIR, NOT REPLACEABLE, AND THE DIFFERENCE IS DELIBERATE
 * ---------------------------------------------------------------------------
 *
 * `./place-block` asks `isReplaceable`, which is kernel's capability and admits
 * `water` and `lava` as well as `air`. This rule asks for AIR and nothing else,
 * which is the reference's test (`current !== 'AIR'`) transcribed rather than
 * improved. The two disagree on exactly the cells where the improvement would be
 * wrong: fire in a water cell is a fire that goes out on the tick nothing has
 * written yet, and fire in a lava cell is a keystroke that deletes a lava
 * source. Both would be regressions dressed as consistency.
 *
 * There is no `isFlammable` test either, and its absence is kernel's roster
 * rather than an omission here: vanilla requires the cell below or behind to be
 * a burnable block, kernel's capability audit §4.9 lists five independent
 * capabilities and `flammable` is not among them, and inventing a block list
 * would be the scatter plan.md §3.1 measured. The reference does not check it
 * either. It arrives as one column in kernel's table and no edit here.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RULE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * BURN. Fire that spreads, consumes its fuel and goes out is the reference's
 * `packages/world/domain/fire-lifecycle.ts` and `application/fire-maintenance.ts`
 * — a per-tick sweep over the fire blocks in the world. That is a MAINTENANCE
 * pass, DN-GP-1 is about exactly that shape of workload, and the event-driven
 * version of it is a `disturb`-shaped queue whose consumer does not exist yet.
 * Writing the block is this rule; making it behave is another one, and it would
 * have its own file.
 *
 * HURT ANYBODY. A player or a mob standing in fire takes damage, which reads a
 * roster of things with positions and health. mc-sim owns the roster and
 * `../mob/` owns none of the player's half.
 *
 * SPEND THE ITEM or PLAY THE SOUND. See `./ignite-portal`'s header; the same two
 * services own them and neither is published.
 */
import { Effect } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition, type ChunkStoreApi } from '../chunk-store-port.js'

/**
 * TOTAL, mirroring `./place-block`'s `PlaceOutcome` and `./ignite-portal`'s.
 * Every refusal is named; see those two files on why `boolean` is the answer
 * that makes two different bugs indistinguishable.
 */
export type IgniteFireOutcome =
  /** Fire went in. */
  | { readonly _tag: 'Lit'; readonly position: BlockPosition }
  /** Something is already there. Not air — see the header on why not replaceable. */
  | { readonly _tag: 'Occupied'; readonly existing: BlockId }
  /** Out of the resident area. NOT air — the world there is unknown, not empty. */
  | { readonly _tag: 'ChunkNotLoaded' }
  /** Below bedrock or above the build limit. */
  | { readonly _tag: 'OutOfWorld' }
  /**
   * This build has no id for `fire`.
   *
   * UNREACHABLE TODAY, and kept for `./place-block`'s `UnknownBlock` reason.
   */
  | { readonly _tag: 'UnknownBlock' }

/**
 * Put fire in the cell, and report what happened.
 *
 * ONE READ AND AT MOST ONE WRITE. It reads first for `./place-block`'s reason
 * rather than out of habit: `setBlock` returns the block it replaced, so by the
 * time it could answer "was that air?" the fire is already burning where a lava
 * source used to be, and putting it back is a compensating write that can itself
 * fail. The window between the read and the write is the same one that file's
 * header is about, and it closes the same day — mc-worldgen's `ChunkStore`
 * growing `setBlockIf`.
 *
 * NOTHING IS DISTURBED, for `./ignite-portal`'s reason: the cell was air, and
 * filling a hole cannot start a fall.
 */
export const igniteFire = (
  store: ChunkStoreApi,
  position: BlockPosition,
): Effect.Effect<IgniteFireOutcome> =>
  Effect.gen(function* () {
    const fireBlock = blockIdOf('fire')
    /* v8 ignore start -- UnknownBlock is unreachable in a green tree: `fire` is one
     * of the 120 `BlockType`s kernel's own type declaration pins `blockIdOf`
     * total over, so `blockIdOf('fire')` never returns `undefined`. Kept for the
     * reason `./place-block.ts`'s own `UnknownBlock` arm is: it fails toward a NAMED
     * refusal rather than a fire block silently vanishing. Named in
     * `vitest.config.ts`'s coverage-threshold comment as one of the five
     * documented-unreachable branches the 99% gate accounts for. */
    if (fireBlock === undefined) {
      return { _tag: 'UnknownBlock' }
    }
    /* v8 ignore stop */

    const target = yield* store.getBlock(position)
    if (target._tag === 'ChunkNotLoaded') {
      return { _tag: 'ChunkNotLoaded' }
    }
    if (target._tag === 'OutOfWorld') {
      return { _tag: 'OutOfWorld' }
    }
    if (target.block !== AIR_BLOCK_ID) {
      return { _tag: 'Occupied', existing: target.block }
    }

    const outcome = yield* store.setBlock(position, fireBlock)
    switch (outcome._tag) {
      case 'Written':
        return { _tag: 'Lit', position }

      // The cell already held fire. `target` has just said it held air, so this
      // is the store changing its mind between the read and the write — the
      // window named above. Reporting `Occupied` is the same answer the read
      // would have given had it happened one instruction later.
      case 'Unchanged':
        return { _tag: 'Occupied', existing: outcome.previous }

      case 'ChunkNotLoaded':
        return { _tag: 'ChunkNotLoaded' }

      case 'OutOfWorld':
        return { _tag: 'OutOfWorld' }
      // exhaustiveness arm over BlockWriteOutcome, a closed four-tag union
      // (chunk-store-port.ts's BlockWriteOutcome); 'Written', 'Unchanged',
      // 'ChunkNotLoaded' and 'OutOfWorld' are the only reachable tags and all
      // four are handled above, so no input can reach this arm.
      /* v8 ignore start */
      default: {
        const exhaustive: never = outcome
        return exhaustive
      }
      /* v8 ignore stop */
    }
  })
