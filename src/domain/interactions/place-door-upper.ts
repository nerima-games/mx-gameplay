/**
 * ONE RULE, ONE FILE (DN-GP-9): a door is two cells tall, so the cell above the
 * one being placed into must be empty and becomes the door's upper half.
 *
 * The fourth of the four per-block placement rules `./place-block`'s header
 * defers by name, and the ONLY one of the four that anything can reach today:
 * `door` is in kernel's `ITEM_TYPES` as well as its `BLOCK_TYPES`, so it is a
 * `PlaceableItemType` and a player can hold one. `./place-mushroom-light`'s
 * header records why the other three are written anyway.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONE THAT WRITES A SECOND BLOCK, AND THAT IS WHY IT IS DIFFERENT
 * ---------------------------------------------------------------------------
 *
 * Its three siblings answer a question and refuse. This one refuses AND, when it
 * does not, hands back a cell that `./place-block` must also write — which is
 * the reference's shape too: `applyDoorPlacementRule` is the only member of
 * `PLACEMENT_RULES` that returns a longer `placedBlocks` array
 * (`block-service-place-plan.ts`'s `buildDoorPlacedBlocks`).
 *
 * The cell is RETURNED rather than written here, and that is the same discipline
 * `./explosion-crater` states about the falling-block queue: a rule that reached
 * past its caller to write would be a second writer of the store within one
 * placement, and the caller could no longer report what it did in one answer.
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
 * OPEN OR CLOSE. `door_open` is a separate row in kernel's registry and toggling
 * between the two is an item-free interaction — a right-click on a block, not on
 * a cell with an item in hand. It is another rule and it would be another file;
 * nothing routes a bare right-click to the rules yet, so it would have no caller.
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
import { Effect } from 'effect'
import { adjacentBlockPosition, blockPosition } from '@nerima-games/mc-kernel'
import { blockIdOf, blockTypeOfId } from '@nerima-games/mc-kernel'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition, type ChunkStoreApi } from '../chunk-store-port.js'

/**
 * Is this byte a door?
 *
 * `door` ONLY, and not `door_open`. Asked of kernel's registry; see
 * `./place-mushroom-light`. The open form has an item form of `door` in kernel's
 * drop column and is never the block being PLACED — a player carries `door` and
 * what goes into the world is `door`.
 */
export const isDoorBlock = (block: BlockId): boolean => blockTypeOfId(block) === 'door'

/**
 * What the cell above says about a door placement.
 *
 * THREE ARMS AND NOT A BOOLEAN, because the affirmative answer carries something
 * — the cell to write — and a `boolean` would make the caller recompute it. The
 * `NotADoor` arm is what every other block gets and is why this can be asked
 * unconditionally.
 */
export type DoorUpperCell =
  /** Not a door. Nothing was read and nothing more is required. */
  | { readonly _tag: 'NotADoor' }
  /** A door, and the cell above is free. Write it too. */
  | { readonly _tag: 'Clear'; readonly cell: BlockPosition }
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
 * INTO, and a door at the build limit and a door at the edge of the loaded area
 * are refused for the same reason — there is no cell up there that this rule may
 * write. The reference reaches the same answer through `y + 1 >= CHUNK_HEIGHT`
 * and cannot express the other case at all.
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

    const cell = adjacentBlockPosition(blockPosition(position.x, position.y, position.z), 'up')
    const reading = yield* store.getBlock(cell)

    if (reading._tag !== 'Block' || reading.block !== AIR_BLOCK_ID) {
      return { _tag: 'NoRoomAbove' }
    }

    return { _tag: 'Clear', cell }
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

    const cell = adjacentBlockPosition(blockPosition(position.x, position.y, position.z), 'up')
    const reading = yield* store.getBlock(cell)
    if (reading._tag !== 'Block' || !isDoorBlock(reading.block)) {
      return { _tag: 'NoDoorAbove' }
    }

    return { _tag: 'DoorAbove', cell }
  })

/** The id this rule is about, for a caller that wants to demonstrate it. */
export const DOOR_BLOCK_ID: BlockId | undefined = blockIdOf('door')
