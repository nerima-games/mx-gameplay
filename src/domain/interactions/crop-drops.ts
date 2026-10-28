/**
 * ONE RULE, ONE FILE (DN-GP-9): what a crop drops when it is broken.
 *
 * The other end of `./plant-crop`. Together they are the part of the crop
 * lifecycle this vocabulary can express: plant a seed on its soil, break the
 * crop, get seeds or produce back.
 *
 * Ported from `interaction-break-handler.crop-drops.config.ts`, whose whole
 * content is one `Map` of three rules — and the shape of that map is the design
 * worth carrying over, not the numbers.
 *
 * ---------------------------------------------------------------------------
 * RIPENESS IS AN ARGUMENT, NOT A LOOKUP
 * ---------------------------------------------------------------------------
 *
 * The reference reads the crop's age from `CropGrowthService`, a
 * `Ref<HashMap<"x,y,z", number>>` keyed by block position. That service is
 * mc-sim-shaped state and does not exist here, and inventing one would put the
 * growth clock in the rule file that consumes it.
 *
 * So `ripe` is a parameter. The rule is a function of (crop, ripe, roll) and
 * nothing else, which is what lets the whole table be enumerated in a test
 * without a store, a clock or a position. Whoever owns the age map answers the
 * question; this file only knows what each answer implies.
 *
 * ---------------------------------------------------------------------------
 * RIPE WHEAT HAS BOTH A FIXED AND A ROLLED DROP
 * ---------------------------------------------------------------------------
 *
 * Wheat differs from potato and nether wart: its produce and seed are separate
 * items. A ripe wheat crop therefore drops one wheat plus 1-4 wheat seeds. The
 * injected roll controls only the seed count; the produce count stays fixed.
 *
 * The unripe and ripe tables share a required crop-key type, so a known crop
 * cannot be added to one table without its counterpart.
 */
import type { ItemType } from '@nerima-games/mc-kernel'
import type { BlockType } from '@nerima-games/mc-kernel'

/** An item and how many of it. */
export type CropDrop = {
  readonly item: ItemType
  readonly count: number
}

type CropBlockType = 'wheat_crop' | 'potato_crop' | 'nether_wart_crop'

const CROP_BLOCK_TYPES: ReadonlyArray<CropBlockType> = [
  'wheat_crop',
  'potato_crop',
  'nether_wart_crop',
]

const isCropBlockType = (block: BlockType): block is CropBlockType =>
  CROP_BLOCK_TYPES.some((crop) => crop === block)

/**
 * Every crop this rule knows, and what an UNRIPE one drops.
 *
 * Unripe is the simple half and is the same for all three: one of the thing you
 * planted, back. Breaking an immature crop is a mistake the player made, and
 * vanilla returns the seed rather than punishing it.
 */
export const UNRIPE_CROP_DROP: Readonly<Record<CropBlockType, CropDrop>> = {
  wheat_crop: { item: 'wheat_seeds', count: 1 },
  potato_crop: { item: 'potato', count: 1 },
  nether_wart_crop: { item: 'nether_wart', count: 1 },
}

/**
 * The produce a RIPE crop yields, and how the roll scales it.
 *
 * `span` and `floor` are the reference's `Math.floor(randomValue * span) + floor`
 * written as data instead of as three closures, so a test can check the RANGE
 * of each rule rather than sampling it. The reference's own comment on nether
 * wart —「Vanilla mature nether wart: 2-4 warts」— is a statement about this
 * pair, and as data it is checkable rather than quotable.
 *
 * Wheat uses `fixedDrops` for its produce because only its seed count is rolled.
 */
type CropYieldRule = {
  readonly item: ItemType
  readonly span: number
  readonly floor: number
  readonly fixedDrops?: ReadonlyArray<CropDrop>
}

export const RIPE_CROP_YIELD: Readonly<Record<CropBlockType, CropYieldRule>> = {
  wheat_crop: {
    item: 'wheat_seeds',
    span: 4,
    floor: 1,
    fixedDrops: [{ item: 'wheat', count: 1 }],
  },
  potato_crop: { item: 'potato', span: 4, floor: 2 },
  nether_wart_crop: { item: 'nether_wart', span: 3, floor: 2 },
}

/** What breaking a crop yields. */
export type CropDropOutcome =
  | { readonly _tag: 'drops'; readonly drops: ReadonlyArray<CropDrop> }
  /** Not a crop this rule knows. The caller falls through to the block's own loot. */
  | { readonly _tag: 'notACrop'; readonly block: BlockType }

/**
 * Break a crop.
 *
 * `roll` is a `[0, 1)` value the caller draws — `./frame-rolls` is where this
 * repository's rolls come from, and taking the number rather than the generator
 * keeps this pure and keeps the seed's ownership with the frame.
 *
 * A roll outside `[0, 1)` is CLAMPED rather than rejected. The reference's
 * `Math.floor(randomValue * 4) + 2` with a roll of 1 gives 6 where the range is
 * 2-5, and with a negative roll gives less than the floor — both are silent
 * off-by-ones in a drop count, which is the kind of thing that reads as luck.
 */
export const cropDrops = (block: BlockType, ripe: boolean, roll: number): CropDropOutcome => {
  if (!isCropBlockType(block)) {
    return { _tag: 'notACrop', block }
  }

  const unripe = UNRIPE_CROP_DROP[block]
  if (!ripe) {
    return { _tag: 'drops', drops: [unripe] }
  }

  const yieldRule = RIPE_CROP_YIELD[block]
  const safeRoll = Number.isFinite(roll) ? Math.min(0.999_999, Math.max(0, roll)) : 0
  const rolledDrop = {
    item: yieldRule.item,
    count: Math.floor(safeRoll * yieldRule.span) + yieldRule.floor,
  }
  return {
    _tag: 'drops',
    drops: [...(yieldRule.fixedDrops ?? []), rolledDrop],
  }
}

/**
 * The inclusive count range a ripe crop can yield.
 *
 * Derived from the same two numbers the rule uses, so a test can assert
 * "nether wart yields 2-4" without sampling — and so the reference's prose
 * comment becomes arithmetic. Returns `undefined` for a block outside this crop
 * rule.
 */
export const ripeYieldRange = (
  block: BlockType,
): { readonly min: number; readonly max: number } | undefined => {
  if (!isCropBlockType(block)) return undefined
  const yieldRule = RIPE_CROP_YIELD[block]
  return { min: yieldRule.floor, max: yieldRule.floor + yieldRule.span - 1 }
}
