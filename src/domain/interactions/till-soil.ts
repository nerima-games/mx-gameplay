/**
 * ONE RULE, ONE FILE (DN-GP-9): the player tills ground into farmland.
 *
 * The step BEFORE `./plant-crop`. Together with `./crop-drops` the three make
 * the whole loop this vocabulary can express: till the ground, plant a seed on
 * it, break the crop, get produce back.
 *
 * Ported from the tilling third of `interaction-farming-handler.ts`.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE WAS FILED AS UNWRITABLE AND THE FILING WAS WRONG
 * ---------------------------------------------------------------------------
 *
 * `./plant-crop`'s header says tilling "cannot be WRITTEN here, let alone be
 * wrong", because the reference keys it on `HOE_ITEM_TYPES` — five literals
 * (`WOODEN_HOE` … `DIAMOND_HOE`) and kernel's `ITEM_TYPES` has none of them.
 *
 * That was a statement about the reference's implementation, not about the
 * rule. THE RULE DOES NOT NEED TO KNOW WHAT THE TOOL IS CALLED. It needs to
 * know whether the held thing tills, which is one boolean, and every block it
 * touches — `dirt`, `grass_block`, `farmland` — is already in the vocabulary.
 *
 * `./interaction-intent` reached the same conclusion from the same wall, and
 * `./draw-bow` got there first and stated the principle:
 *
 *   「a rule keyed on the item's name would be unwritable today; a rule keyed on
 *    the item's PROPERTIES is writable, testable and complete.」
 *
 * So `tills` is a capability the caller supplies. Five hoe tiers collapse to
 * one boolean, and a sixth tier added later needs no change here — which is the
 * same argument `HeldItemCapabilities` makes about crossbows.
 *
 * ---------------------------------------------------------------------------
 * THE REFERENCE DOES NOT CHECK WHAT IS ABOVE, AND VANILLA DOES
 * ---------------------------------------------------------------------------
 *
 * `handleFarmingInteraction` tests `TILLABLE_BLOCK_TYPES.has(targetBlock)` and
 * writes `FARMLAND`. It never looks at the cell above.
 *
 * In vanilla you cannot till ground with a solid block resting on it, and the
 * reason is not decoration: farmland is a partial-height block, so a block
 * placed on it sits with a gap underneath, and a crop cannot grow there anyway.
 * The reference's omission means a player can till the floor of a cave, under
 * stone, and get farmland that nothing can ever be planted on — `./plant-crop`
 * would then refuse with `occupied`, which is correct and is a confusing place
 * to learn it.
 *
 * So `blockAbove` is a parameter here and `obstructed` is an outcome. This is a
 * DIVERGENCE FROM THE REFERENCE, stated rather than silent, and the test that
 * pins it says which behaviour is vanilla's.
 */
import { Effect } from 'effect'
import { blockIdOf, blockTypeOfId, type BlockType } from '../block-vocabulary.js'
import { adjacentBlockPosition, blockPosition } from '@nerima-games/mc-kernel'
import type { BlockPosition } from '../chunk-store-port.js'

/**
 * Ground that a hoe turns into farmland.
 *
 * The published kernel API does not yet expose the next capability-table
 * revision, so this package keeps the current two-entry mirror until that
 * release is consumed. The source list is the same as the kernel registry.
 */
export const TILLABLE_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>(['dirt', 'grass_block'])

/** What tilling produces. */
export const TILLED_BLOCK: BlockType = 'farmland'

/**
 * What the held item can do, as far as this rule cares.
 *
 * ONE BOOLEAN AND NO NAME. See the header: the reference's five hoe tiers are
 * five names for one capability, and the rule never distinguishes them —
 * a wooden hoe and a diamond hoe till identically in vanilla and in the
 * reference alike. Tier matters for durability, which is not this rule's.
 */
export type TillingCapability = {
  readonly tills: boolean
}

/** Nothing in hand, or something that does not till. */
export const CANNOT_TILL: TillingCapability = { tills: false }

/** Why tilling did or did not happen. */
export type TillOutcome =
  | { readonly _tag: 'tilled'; readonly at: BlockPosition }
  /** The held item does not till. Nothing was read. */
  | { readonly _tag: 'noHoe' }
  /** A hoe, but this ground is not tillable. */
  | { readonly _tag: 'notTillable'; readonly found: BlockType }
  /**
   * Tillable ground with something resting on it.
   *
   * NOT IN THE REFERENCE. See the header — vanilla refuses, and allowing it
   * produces farmland nothing can ever be planted on.
   */
  | { readonly _tag: 'obstructed'; readonly blockedBy: BlockType }

/** The cell a hoe must find clear. */
export const cellAbove = (ground: BlockPosition): BlockPosition =>
  adjacentBlockPosition(blockPosition(ground.x, ground.y, ground.z), 'up')

/**
 * Decide, given what is already known about the two cells.
 *
 * PURE, and the same shape as `./plant-crop`'s `plantingVerdict` so the two can
 * be read side by side — they are consecutive steps and their refusals should
 * look alike.
 */
export const tillingVerdict = (
  held: TillingCapability,
  ground: BlockPosition,
  groundBlock: BlockType,
  blockAbove: BlockType,
): TillOutcome => {
  if (!held.tills) {
    return { _tag: 'noHoe' }
  }
  if (!TILLABLE_BLOCKS.has(groundBlock)) {
    return { _tag: 'notTillable', found: groundBlock }
  }
  if (blockAbove !== 'air') {
    return { _tag: 'obstructed', blockedBy: blockAbove }
  }
  return { _tag: 'tilled', at: ground }
}

/** The two reads and one write this rule needs of a world. */
export type TillPort = {
  readonly blockAt: (position: BlockPosition) => Effect.Effect<number | undefined>
  readonly setBlock: (position: BlockPosition, block: number) => Effect.Effect<unknown>
}

/**
 * Read the two cells, decide, and write farmland if the decision says so.
 *
 * Reads before it writes, and an unloaded cell refuses — both for the reasons
 * `./plant-crop`'s `plantCrop` sets out at length. The two functions are
 * deliberately the same shape.
 */
export const tillSoil = (
  port: TillPort,
  held: TillingCapability,
  ground: BlockPosition,
): Effect.Effect<TillOutcome> =>
  Effect.gen(function* () {
    if (!held.tills) {
      // Answered without reading, which is the point of checking first: a
      // player swinging a sword should not cost two chunk reads per frame.
      return { _tag: 'noHoe' as const }
    }

    const groundId = yield* port.blockAt(ground)
    const aboveId = yield* port.blockAt(cellAbove(ground))

    const groundBlock = groundId === undefined ? undefined : blockTypeOfId(groundId)
    const aboveBlock = aboveId === undefined ? undefined : blockTypeOfId(aboveId)

    if (groundBlock === undefined || aboveBlock === undefined) {
      return { _tag: 'notTillable' as const, found: 'air' as BlockType }
    }

    const verdict = tillingVerdict(held, ground, groundBlock, aboveBlock)
    if (verdict._tag === 'tilled') {
      // `TILLED_BLOCK` is the literal `'farmland'`, which carries a
      // `BLOCK_DROP_REGISTRY` row (id 49 in `../block-vocabulary.ts`), so
      // `blockIdOf` cannot return `undefined` here. Asserted rather than
      // branched on, for the same reason `./plant-crop.ts` asserts its own
      // three crop ids: a vocabulary defect that removed that row would be
      // caught by `test/block-vocabulary-mirror.test.ts`, not by a runtime
      // fallback that tills nothing and reports success.
      yield* port.setBlock(verdict.at, blockIdOf(TILLED_BLOCK)!)
    }
    return verdict
  })
