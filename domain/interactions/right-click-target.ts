/**
 * ONE RULE, ONE FILE (DN-GP-9): which block did the player right-click, and
 * what kind of thing is it.
 *
 * The ROUTING half of right-clicking, and deliberately only that half. It
 * answers "this is a chest" and stops; opening the chest, placing on the block,
 * or toggling the door is each its own rule, and each needs state this file
 * does not touch.
 *
 * Ported from `interaction-right-click-target-routing.ts`, which is the purest
 * file in the reference's interaction set — type-only imports, so not even
 * `effect` at runtime, and its entire body is eight comparisons.
 *
 * ---------------------------------------------------------------------------
 * WHY A ROUTE AND NOT A BOOLEAN PER BLOCK
 * ---------------------------------------------------------------------------
 *
 * The alternative shape is `isChest(block)`, `isFurnace(block)`, one predicate
 * each, and the caller asking them in order. That is the same information and a
 * worse arrangement for one reason: THE ORDER WOULD LIVE AT EVERY CALL SITE.
 * Two callers asking in different orders disagree about a block that matches
 * two predicates, and nothing would report it.
 *
 * Here the order is in one place and is total: every block yields at most one
 * route. `chest` is checked first because it is the only SET rather than a
 * single literal, and a set is the thing most likely to grow.
 *
 * ---------------------------------------------------------------------------
 * THE DOOR CARRIES ITS STATE AND THE OTHERS DO NOT
 * ---------------------------------------------------------------------------
 *
 * `door` is the one route with a payload beyond the position, because `door`
 * and `door_open` are two block types for one object and the rule that toggles
 * it needs to know which it is looking at. Every other route's block type is
 * recoverable from the route's own tag.
 *
 * That asymmetry is the reference's and is kept. Adding `blockType` to every
 * route "for consistency" would make the payload a copy of the tag everywhere
 * except one place, and a reader would have to check whether the two ever
 * disagree.
 */
import type { BlockType } from '../block-vocabulary'
import type { BlockPosition } from '../chunk-store-port'

/**
 * Blocks that open a storage screen.
 *
 * A SET AND NOT A PAIR OF COMPARISONS, matching the reference — this is the one
 * route whose membership is expected to grow (barrels, ender chests, trapped
 * chests all belong here), and a set is where a reader looks for that.
 */
export const STORAGE_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>(['chest', 'shulker_box'])

/** The two block types that are the same door. */
export const DOOR_BLOCKS = ['door', 'door_open'] as const
export type DoorBlock = (typeof DOOR_BLOCKS)[number]

/** What kind of thing the player right-clicked. */
export type RightClickRoute =
  | { readonly kind: 'storage'; readonly at: BlockPosition }
  | { readonly kind: 'craftingTable'; readonly at: BlockPosition }
  | { readonly kind: 'furnace'; readonly at: BlockPosition }
  | { readonly kind: 'bed'; readonly at: BlockPosition }
  | { readonly kind: 'enchantingTable'; readonly at: BlockPosition }
  | { readonly kind: 'anvil'; readonly at: BlockPosition }
  /** The only route with a payload; see the header. */
  | { readonly kind: 'door'; readonly at: BlockPosition; readonly block: DoorBlock }

/** Single-literal routes, as data, so the dispatch below cannot drift from them. */
const SINGLE_BLOCK_ROUTES: ReadonlyArray<readonly [BlockType, RightClickRoute['kind']]> = [
  ['crafting_table', 'craftingTable'],
  ['furnace', 'furnace'],
  ['bed', 'bed'],
  ['enchanting_table', 'enchantingTable'],
  ['anvil', 'anvil'],
]

/** Every block type this rule routes. Derived; used by tests to prove totality. */
export const ROUTED_BLOCKS: ReadonlyArray<BlockType> = [
  ...STORAGE_BLOCKS,
  ...SINGLE_BLOCK_ROUTES.map(([block]) => block),
  ...DOOR_BLOCKS,
]

const isDoor = (block: BlockType): block is DoorBlock =>
  (DOOR_BLOCKS as ReadonlyArray<BlockType>).includes(block)

/**
 * Route a right-click, or `undefined` for a block with no screen and no toggle.
 *
 * `undefined` RATHER THAN A `'none'` ROUTE. Most blocks are not routable, so
 * `'none'` would be the common answer and every caller would have to name it
 * before getting to the cases it cares about. `undefined` is what a lookup that
 * found nothing returns everywhere else in this repository.
 *
 * The position is PASSED THROUGH AND NEVER READ. This file does no coordinate
 * arithmetic — it is a classification of a block type that happens to carry
 * where the block was, so the caller does not have to thread it separately.
 */
export const rightClickRoute = (
  at: BlockPosition,
  block: BlockType | undefined,
): RightClickRoute | undefined => {
  if (block === undefined) {
    return undefined
  }

  if (STORAGE_BLOCKS.has(block)) {
    return { kind: 'storage', at }
  }

  if (isDoor(block)) {
    return { kind: 'door', at, block }
  }

  const single = SINGLE_BLOCK_ROUTES.find(([routed]) => routed === block)
  return single === undefined
    ? undefined
    : ({ kind: single[1], at } as RightClickRoute)
}
