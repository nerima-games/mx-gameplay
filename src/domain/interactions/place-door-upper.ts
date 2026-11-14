/**
 * ONE RULE, ONE FILE (DN-GP-9): a door is two cells tall, so placement requires
 * an empty cell above the cell being placed into.
 *
 * The fourth of the four per-block placement rules `./place-block`'s header
 * defers by name, and the ONLY one of the four that anything can reach today:
 * `door` is in kernel's `ITEM_TYPES` as well as its `BLOCK_TYPES`, so it is a
 * `PlaceableItemType` and a player can hold one. `./place-mushroom-light`'s
 * header records why the other three are written anyway.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONE THAT CHECKS A SECOND CELL, AND THAT IS WHY IT IS DIFFERENT
 * ---------------------------------------------------------------------------
 *
 * This rule checks that the upper cell is empty and preserves the specific
 * `NoRoomAbove` refusal. A clear upper cell does not authorize an ID-only write
 * for a stateful door: the chunk-store port cannot persist its half, facing, or
 * hinge. The placement caller therefore reports typed state-write failure without
 * writing either cell.
 *
 * ---------------------------------------------------------------------------
 * AIR, AND NOT REPLACEABLE — THE SAME CALL `./ignite-fire` MAKES
 * ---------------------------------------------------------------------------
 *
 * The reference asks `upperExisting !== 'AIR'` and refuses. Widening that to
 * `isReplaceable` would let a door be placed with its top half in water or lava:
 * the first is a door that displaces a fluid source with no rule to put it back,
 * the second is a keystroke that deletes lava. Transcribed as it stands.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RULE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * OPEN OR CLOSE. `door_open` is a separate row in kernel's registry. Toggling
 * between the two is handled by the `ToggleDoor` rule in
 * `./block-state-rules`; `../stages/interactions-stage` routes targeted block
 * use there. This placement rule only checks headroom.
 *
 * HINGE SIDE, OR WHICH WAY IT FACES. Both are block STATE, and kernel's registry
 * carries one row per door rather than per orientation. That is a kernel
 * question and `docs/porting.md` is where it is tracked; a local invention here
 * would be a second block-state vocabulary.
 *
 * TAKE THE UPPER HALF AWAY WHEN THE LOWER IS BROKEN. The break loop asks this
 * module whether the cell above is the matching closed-door half before it
 * removes it. That keeps a malformed world from losing an unrelated block.
 */
import { Effect, Option, Result } from 'effect'
import {
  adjacentBlockPosition,
  AIR_BLOCK_ID,
  blockIdOf,
  blockTypeOfId,
  type BlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'

/**
 * Is this byte a door?
 *
 * `door` ONLY, and not `door_open`. Asked of kernel's registry; see
 * `./place-mushroom-light`. The open form has an item form of `door` in kernel's
 * drop column and is never the block being PLACED — a player carries `door` and
 * what goes into the world is `door`.
 */
export const isDoorBlock = (block: BlockId): boolean => Result.getOrUndefined(blockTypeOfId(block)) === 'door'

/**
 * What the cell above says about a door placement.
 *
 * THREE ARMS AND NOT A BOOLEAN preserve whether this was not a door, had no
 * available upper cell, or had clear headroom. The `NotADoor` arm is what every
 * other block gets and is why this can be asked unconditionally.
 */
export type DoorUpperCell =
  /** Not a door. Nothing was read and nothing more is required. */
  | { readonly _tag: 'NotADoor' }
  /** A door, and the cell above is free. */
  | { readonly _tag: 'Clear' }
  /** A door with something in the way above, or with no world above. */
  | { readonly _tag: 'NoRoomAbove' }

/**
 * Does the cell above admit a door's upper half?
 *
 * READS NOTHING unless the block is a door. ONE READ when it is.
 *
 * `ChunkNotLoaded` and `OutOfWorld` both answer `NoRoomAbove` rather than being
 * reported apart, and that is a deliberate flattening rather than an oversight:
 * this rule's caller already distinguishes those two for the cell it is placing
 * into, and a door at the build limit or the edge of the loaded area has no clear
 * upper cell. The reference reaches the same answer through
 * `y + 1 >= CHUNK_HEIGHT` and cannot express the other case at all.
 */
export const doorUpperCell = (
  store: ChunkStoreApi,
  block: BlockId,
  position: BlockPosition,
): Effect.Effect<DoorUpperCell> =>
  Effect.gen(function* () {
    if (!isDoorBlock(block)) {
      return { _tag: 'NotADoor' }
    }

    const cell = Result.getOrUndefined(adjacentBlockPosition(position, 'up'))
    if (cell === undefined) {
      return { _tag: 'NoRoomAbove' }
    }
    const reading = yield* store.getBlock(cell)

    if (reading._tag !== 'Block' || reading.block !== AIR_BLOCK_ID) {
      return { _tag: 'NoRoomAbove' }
    }

    return { _tag: 'Clear' }
  })

/** What the cell above says about breaking a door's lower half. */
export type DoorUpperBreakCell =
  | { readonly _tag: 'NotADoor' }
  | { readonly _tag: 'NoDoorAbove' }
  | { readonly _tag: 'DoorAbove'; readonly cell: BlockPosition }

/**
 * Finds the closed-door upper half that must be removed with a broken lower
 * half. A non-door or an inconsistent cell above is deliberately left alone.
 */
export const doorUpperBreakCell = (
  store: ChunkStoreApi,
  block: BlockId,
  position: BlockPosition,
): Effect.Effect<DoorUpperBreakCell> =>
  Effect.gen(function* () {
    if (!isDoorBlock(block)) {
      return { _tag: 'NotADoor' }
    }

    const cell = Result.getOrUndefined(adjacentBlockPosition(position, 'up'))
    if (cell === undefined) {
      return { _tag: 'NoDoorAbove' }
    }
    const reading = yield* store.getBlock(cell)
    if (reading._tag !== 'Block' || !isDoorBlock(reading.block)) {
      return { _tag: 'NoDoorAbove' }
    }

    return { _tag: 'DoorAbove', cell }
  })

/** The id this rule is about, for a caller that wants to demonstrate it. */
export const DOOR_BLOCK_ID: BlockId | undefined = Option.getOrUndefined(blockIdOf('door'))
