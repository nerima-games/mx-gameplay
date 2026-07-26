/**
 * ONE RULE, ONE FILE (DN-GP-9): the player breaks the block they are looking at.
 *
 * This is the first of the ~40 interaction handlers plan.md §3.11 keeps at
 * one-rule-per-file granularity. They are many files and ONE stage
 * (`gameplay:interactions`): the granularity that matters for review is the
 * rule, the granularity that matters for composition is the stage.
 *
 * ---------------------------------------------------------------------------
 * Why there is no read here
 * ---------------------------------------------------------------------------
 *
 * "Put the mined block in the inventory" reads like get-then-set: look at what
 * is there, then replace it with air. That is a TOCTOU, and plan.md §3.8 lists
 * it among the reference's recurring mistakes. `setBlock` returns the block it
 * replaced (`mc-worldgen/docs/public-api.md` §6-3), so this rule performs
 * exactly one store call and the item it yields comes out of the write itself.
 *
 * ---------------------------------------------------------------------------
 * Where the item goes
 * ---------------------------------------------------------------------------
 *
 * `Broken.yielded` travels to mc-sim's `InventoryService` — plan.md §2.3-1's
 * worked example, and the one part of this path the move of the block API into
 * mc-worldgen did not change. mc-sim is not published, so the stage parks the
 * item in frame-local scratch instead; see `stages/registration.ts`.
 */
import { Effect } from 'effect'
import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type ChunkCoord,
  type ChunkStoreApi,
} from '../chunk-store-port'

/**
 * TOTAL, mirroring `BlockWriteOutcome`. There is no error channel here because
 * there is none in `StageRegistration.run` (`domain/frame-contract.ts`), so a
 * failure would have nowhere to go but a `catchAll` that drops it.
 */
export type BreakOutcome =
  /** The block was removed. `yielded` is what the player now holds. */
  | { readonly _tag: 'Broken'; readonly yielded: BlockId; readonly chunk: ChunkCoord }
  /** The cell was already air. Nothing mined, nothing dirtied, nothing to fall. */
  | { readonly _tag: 'NothingThere' }
  /** Out of the resident area. NOT air — the world there is unknown, not empty. */
  | { readonly _tag: 'ChunkNotLoaded' }
  /** Below bedrock or above the build limit. */
  | { readonly _tag: 'OutOfWorld' }

export const breakBlock = (
  store: ChunkStoreApi,
  position: BlockPosition,
): Effect.Effect<BreakOutcome> =>
  Effect.map(store.setBlock(position, AIR_BLOCK_ID), (outcome): BreakOutcome => {
    switch (outcome._tag) {
      case 'Written':
        return { _tag: 'Broken', yielded: outcome.previous, chunk: outcome.chunk }

      // `Unchanged` means air was already there: the write did not dirty the
      // chunk, and this rule must not invent an item or a disturbance out of
      // it. A player swinging at empty space is a legal thing to do, and
      // treating it as a break would drop air into the inventory and re-mesh
      // the chunk on every frame the button is held.
      case 'Unchanged':
        return { _tag: 'NothingThere' }

      // The store refused because it does not know that cell. Answering "there
      // was air there" would be the two-valued read that drops sand out of the
      // world one file over.
      case 'ChunkNotLoaded':
        return { _tag: 'ChunkNotLoaded' }

      case 'OutOfWorld':
        return { _tag: 'OutOfWorld' }
    }
  })
