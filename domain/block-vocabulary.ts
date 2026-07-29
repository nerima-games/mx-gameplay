/**
 * PROVISIONAL LOCAL MIRROR of `@nerima-games/mc-kernel`'s `domain/block-type.ts`,
 * `domain/block-item.ts`, `domain/block-harvest.ts`, `domain/block-capabilities.ts`
 * and the DROP and CAPABILITY columns of `domain/block-registry.ts`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * WHEN mc-kernel IS PUBLISHED:
 *   1. add `@nerima-games/mc-kernel` to `package.json#dependencies`;
 *   2. delete this file and `./item-vocabulary` together;
 *   3. repoint every `from './block-vocabulary'` at `'@nerima-games/mc-kernel'`.
 *
 * It is not re-exported wholesale from `index.ts`, for the reason
 * `./frame-contract`, `./position-key`, `./chunk-store-port` and
 * `./item-vocabulary` are not: re-exporting somebody else's vocabulary would
 * make the promised deletion a breaking change for every consumer of
 * mx-gameplay. The barrel exposes only `isPlaceableItem`, the guard consumers
 * need before requesting gameplay placement. `test/public-api.test.ts` pins
 * that narrow exception and the absence of the remaining vocabulary.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE IS WHERE EVERY KERNEL-SOURCED BLOCK FACT LIVES, AND IT WAS NOT
 * ---------------------------------------------------------------------------
 *
 * The four capability predicates at the bottom of this file used to sit in
 * `./chunk-store-port`, under a heading that said in as many words that they
 * mirrored `mc-kernel/domain/block-registry.ts`. That file mirrors MC-WORLDGEN,
 * and its header promises that deleting it and repointing every import at
 * `@nerima-games/mc-worldgen` will typecheck. For these four the promise was
 * false: mc-worldgen has never exported `fallsWhenUnsupported`, `isReplaceable`,
 * `validSpawnSurface` or `canSupportAttachments`, and on the day of the repoint
 * they would simply have vanished. One mirror file was mirroring two sources.
 *
 * They live here now because a mirror's home is decided by WHOSE BARREL REPLACES
 * IT, not by which rule reads it. `capabilityOfBlockId(id, flag)` is kernel's,
 * this file is the mirror kernel's barrel replaces, so this is the file whose
 * deletion step makes them appear. The move changes no membership and no
 * polarity; the sets below are the same sets, comments and all.
 *
 * The split that remains is still kernel's own. Kernel keeps the two STRUCT-
 * valued columns in their own file (`mc-kernel/domain/block-harvest.ts`, audit
 * §7: 「struct のため最も揺れやすい […] この 2 フィールドを別ファイルに切り出して
 * 差分レビューを容易にすること」) and the boolean CAPABILITY columns in
 * `domain/block-capabilities.ts`. Both are kernel's, both are transcribed here,
 * and the sections below are ordered as kernel orders them.
 *
 * ---------------------------------------------------------------------------
 * Why `BlockId` is still imported from `./chunk-store-port`
 * ---------------------------------------------------------------------------
 *
 * It is kernel's type, so by the rule above it belongs here — and it is NOT
 * moved, deliberately. `./chunk-store-port` needs the alias for the service's
 * own signatures and mc-worldgen's barrel re-exports kernel's `BlockId`, so the
 * one spelling in this repository survives either repoint intact. A second local
 * alias would be a second spelling of one concept, which is the defect this move
 * exists to undo rather than to repeat.
 *
 * ---------------------------------------------------------------------------
 * `blockTypeOfId` IS THE BRIDGE THE MINING PATH WAS MISSING
 * ---------------------------------------------------------------------------
 *
 * `./interactions/break-block` yields a `BlockId` — a number out of a
 * `Uint8Array` — and mc-sim's `InventoryService.add` takes an `ItemId`, a
 * STRING. Nothing joined the two, so `stages/registration.ts` parked raw block
 * ids in an outbox and mc-compose's `docs/e2e-triage.md` §4.3 recorded the
 * mismatch as an open question that 「1 リポジトリからは立てられない」.
 *
 * Kernel answered it: `blockTypeOfId` (`domain/block-registry.ts:994`) turns the
 * byte into a name, `itemOfBlock` (`domain/block-item.ts`) turns the name into an
 * item, and `dropOfBlockId` (`:1043`) folds both together with the tool gate. All
 * three are below. What is STILL missing is only the service to hand the answer
 * to; see `stages/registration.ts` on `minedItems`.
 *
 * ---------------------------------------------------------------------------
 * Why whole rosters are transcribed when a handful of literals are used
 * ---------------------------------------------------------------------------
 *
 * `./item-vocabulary`'s header states the rule and it is repeated here because
 * this file has several rosters rather than one: a transcription that is a
 * SUBSET cannot be compared mechanically. `pnpm check:mirrors` caught `lava`
 * missing from `REPLACEABLE_IDS` below by diffing a whole set against kernel's,
 * and "is it a subset?" is true of a stale mirror too.
 *
 * The drift direction is one-way and worth stating: kernel ADDING a block or an
 * item leaves this file stale and nothing else, while kernel CHANGING a drop rule
 * this repository's tests pin breaks on deletion day — which is the day it should
 * break, loudly, with the mirror still present to diff against.
 */
import { ITEM_TYPES, type ItemType } from './item-vocabulary'
import type { BlockId } from './chunk-store-port'

// ---------------------------------------------------------------------------
// The block roster — mirrors mc-kernel/domain/block-type.ts
// ---------------------------------------------------------------------------

/**
 * kernel's `BLOCK_TYPES`, transcribed. Order, spelling and grouping are
 * kernel's, so that a reviewer can diff the two files rather than read them.
 *
 * ALL 120 NOW. This file said "THIRTY-SIX, and kernel's own header explains why
 * it is not 120" for as long as kernel's roster was partial. Kernel completed it
 * in one change, and a mirror that follows only part of the way is not a smaller
 * mirror — a closed literal union's member set IS the type, so a partial
 * transcription is a DIFFERENT type that happens to compile.
 *
 * `pnpm check:mirrors` in mc-dev-meta imports both this file and kernel's and
 * compares them, so the two cannot drift silently. It is also what found the
 * missing `lava` in `REPLACEABLE_IDS` and, once a `validSpawnSurface` probe
 * existed, the missing `oak_log` in `NON_SPAWN_SURFACE_IDS`.
 */
export const BLOCK_TYPES = [
  'air',
  'stone',
  'cobblestone',
  'dirt',
  'grass_block',
  'sand',
  'gravel',
  'water',
  'lava',
  'oak_log',
  'oak_planks',
  'oak_leaves',
  'glass',
  'torch',
  'glowstone',
  'bedrock',
  'piston',
  'snow',
  'ladder',
  'cobweb',
  'sapling',
  'dandelion',
  'poppy',
  'brown_mushroom',
  'red_mushroom',
  'tall_grass',
  'fern',
  'sugar_cane',
  'lily_pad',
  'kelp',
  'seagrass',
  'rail',
  'powered_rail',
  'cactus',
  'pressure_plate',
  'stone_slab',
  'granite',
  'diorite',
  'andesite',
  'deepslate',
  'obsidian',
  'smooth_basalt',
  'calcite',
  'amethyst_block',
  'amethyst_cluster',
  'sandstone',
  'prismarine',
  'soul_sand',
  'ice',
  'farmland',
  'coal_ore',
  'iron_ore',
  'gold_ore',
  'diamond_ore',
  'redstone_ore',
  'lapis_ore',
  'emerald_ore',
  'deepslate_coal_ore',
  'deepslate_iron_ore',
  'deepslate_gold_ore',
  'deepslate_diamond_ore',
  'deepslate_redstone_ore',
  'deepslate_lapis_ore',
  'deepslate_emerald_ore',
  'coal_block',
  'iron_block',
  'gold_block',
  'diamond_block',
  'redstone_block',
  'lapis_block',
  'emerald_block',
  'wheat_crop',
  'potato_crop',
  'nether_wart_crop',
  'redstone_wire',
  'redstone_torch',
  'lever',
  'stone_button',
  'repeater',
  'redstone_lamp',
  'redstone_lamp_lit',
  'observer',
  'comparator',
  'dispenser',
  'hopper',
  'piston_head',
  'end_stone',
  'end_portal_frame',
  'end_portal_frame_filled',
  'end_portal',
  'chorus_flower',
  'chorus_plant',
  'dragon_egg',
  'end_crystal',
  'end_gateway',
  'end_rod',
  'end_stone_bricks',
  'ender_chest',
  'purpur_block',
  'purpur_pillar',
  'purpur_slab',
  'purpur_stairs',
  'shulker_box',
  'crafting_table',
  'furnace',
  'chest',
  'door',
  'door_open',
  'oak_stairs',
  'anvil',
  'cauldron',
  'water_cauldron',
  'bed',
  'enchanting_table',
  'brewing_stand',
  'tnt',
  'nether_brick',
  'netherrack',
  'nether_portal',
  'fire',
] as const

export type BlockType = (typeof BLOCK_TYPES)[number]

// ---------------------------------------------------------------------------
// Block <-> item — mirrors mc-kernel/domain/block-item.ts
// ---------------------------------------------------------------------------

/**
 * An item that can be put back into the world as a block: kernel's audit §6-8
 * intersection, solved at the type level.
 *
 * DERIVED AND NOT WRITTEN DOWN, which is kernel's whole point about this file.
 * The reference kept a hand-written `BLOCK_ITEMS` list
 * (`first-person-held-item.ts:58-76`) and the audit rejected it because 「KELP /
 * SEAGRASS / AMETHYST_* / RAIL などの新しい型が漏れている手書きの重複リスト」.
 * Adding a block or an item here cannot make this wrong; it can only make it
 * longer.
 *
 * This is what `./interactions/place-block` takes: proving an item is placeable
 * is the caller's job, and having proved it there is nothing left to fail.
 */
export type PlaceableItemType = ItemType & BlockType

const BLOCK_NAMES: ReadonlySet<string> = new Set<string>(BLOCK_TYPES)
const ITEM_NAMES: ReadonlySet<string> = new Set<string>(ITEM_TYPES)

/** Does this item name a block that can be placed? */
export const isPlaceableItem = (item: ItemType): item is PlaceableItemType => BLOCK_NAMES.has(item)

const isItemisedBlock = (block: BlockType): block is PlaceableItemType => ITEM_NAMES.has(block)

/** Every item that is also a block, in `ITEM_TYPES` order. */
export const PLACEABLE_ITEM_TYPES: ReadonlyArray<PlaceableItemType> = ITEM_TYPES.filter(isPlaceableItem)

/**
 * Every block with no item form.
 *
 * Data a test can assert on rather than a comment. A block landing here says
 * that breaking it yields nothing you can carry — correct and permanent for
 * `air` and the fluids, a ROSTER GAP for `snow` (vanilla yields snowballs and
 * `snowball` is not in this build's `ITEM_TYPES`) and for every plant.
 * `./interactions/block-loot` names the gaps its own rules run into.
 */
export const UNITEMISED_BLOCK_TYPES: ReadonlyArray<BlockType> = BLOCK_TYPES.filter(
  (block) => !ITEM_NAMES.has(block),
)

/**
 * Block -> the item it becomes in an inventory. PARTIAL.
 *
 * `undefined` is a real answer and not a failure: `air` is a sentinel rather
 * than a thing (kernel audit §6-6), and `water` / `lava` / `bedrock` / `snow`
 * have no item form in this build. A rule resolving a MINED block should call
 * `dropOfBlockId` below instead, which folds this together with the tool gate
 * and the drop rule.
 */
export const itemOfBlock = (block: BlockType): PlaceableItemType | undefined =>
  isItemisedBlock(block) ? block : undefined

/**
 * Item -> the block it places. TOTAL, but only on the intersection.
 *
 * The identity function, which is the point: the work is in the type and the
 * caller had to prove placeability before it could get here. Kernel
 * deliberately offers no `blockOfItem(item: ItemType)` overload, because
 * answering `blockOfItem('stick')` means either a partial result nobody checks
 * or a lie.
 */
export const blockOfPlaceableItem = (item: PlaceableItemType): BlockType => item

// ---------------------------------------------------------------------------
// harvestTool — mirrors mc-kernel/domain/block-harvest.ts (audit §4.5)
// ---------------------------------------------------------------------------

/**
 * Tool categories, from the reference's `isEffectiveTool` (`block-utils.ts:32-63`).
 *
 * The category decides the SPEED bonus and NOTHING ELSE. It is a different axis
 * from `minTier`, which decides whether anything drops at all — the reference
 * keeps them in two unrelated files (`harvestable-blocks.ts` for the tier gate,
 * `block-utils.ts` for the category), which is why kernel makes them one struct.
 */
export const HARVEST_TOOL_CATEGORIES = [
  'none',
  'pickaxe',
  'axe',
  'shovel',
  'hoe',
  'shears',
  'sword',
] as const
export type HarvestToolCategory = (typeof HARVEST_TOOL_CATEGORIES)[number]

/**
 * Material tiers, from the four-stage ladder at `harvestable-blocks.ts:14-67`.
 * `'none'` means bare hands suffice, which is the default and the majority case.
 */
export const HARVEST_TIERS = ['none', 'wooden', 'stone', 'iron', 'diamond'] as const
export type HarvestTier = (typeof HARVEST_TIERS)[number]

export type HarvestToolRequirement = {
  /** Which tool family mines this fastest. Speed only; never gates the drop. */
  readonly category: HarvestToolCategory
  /** The minimum tier that makes this block drop anything at all. */
  readonly minTier: HarvestTier
}

/** kernel's `DEFAULT_HARVEST_TOOL`: bare hands are enough and nothing is faster. */
export const DEFAULT_HARVEST_TOOL: HarvestToolRequirement = { category: 'none', minTier: 'none' }

/**
 * Ordering used by the tier gate. Higher index satisfies every lower one.
 *
 * A `Record` and not a `Map`, which is kernel's shape and kernel's argument: the
 * `Map` spelling forced a `?? 0` on both reads, and index 0 is `'none'`, so an
 * unrecognised REQUIRED `minTier` would have read as "no tool needed" and OPENED
 * the gate. A guard that fails open on the side that grants access is worse than
 * no guard.
 */
const TIER_ORDER = Object.fromEntries(HARVEST_TIERS.map((tier, index) => [tier, index])) as Readonly<
  Record<HarvestTier, number>
>

/**
 * Does a held tool of `heldTier` satisfy `requirement.minTier`?
 *
 * The category is deliberately NOT consulted: in the reference, using the wrong
 * category is slow but still drops the block
 * (`block-service-break-helpers.ts:65,158` gates on tier alone), and conflating
 * the two axes is precisely the bug this struct is shaped to prevent.
 */
export const satisfiesHarvestTier = (
  requirement: HarvestToolRequirement,
  heldTier: HarvestTier,
): boolean => TIER_ORDER[heldTier] >= TIER_ORDER[requirement.minTier]

// ---------------------------------------------------------------------------
// drops — mirrors mc-kernel/domain/block-harvest.ts (audit §4.5)
// ---------------------------------------------------------------------------

/**
 * What a block yields when broken.
 *
 * `item: 'self'` is a sentinel meaning "an item of this same block type", which
 * is what the overwhelming majority of blocks do — the reference's
 * `blockDropsBaseItem` (`block-service.config.ts:192-197`) is true for every
 * block except ICE, and `INVENTORY_DROP_OVERRIDES` (:151-187, 24 entries) names
 * the exceptions. Writing the block's own type instead would make the DEFAULT
 * un-writable, since a default cannot know which block it is attached to.
 *
 * `item` is an `ItemType` and not a `BlockType`, which is a correction kernel
 * made deliberately: `glowstone` yields `glowstone_dust`, and there is no block
 * called `glowstone_dust`. The old spelling could express "different block",
 * never "not a block".
 */
export type BlockDropRule = {
  readonly item: ItemType | 'self'
  /** Base count before fortune. `0` = drops nothing to anyone, ever. */
  readonly count: number
  /** Only drops at all when mined with a silk-touch tool. */
  readonly requiresSilkTouch: boolean
  /** Fortune multiplies `count` (`FORTUNE_ORE_BLOCKS`, `block-service.config.ts:270-276`). */
  readonly affectedByFortune: boolean
}

/** kernel's `DEFAULT_BLOCK_DROP`: one of itself, no gate, no fortune. */
export const DEFAULT_BLOCK_DROP: BlockDropRule = {
  item: 'self',
  count: 1,
  requiresSilkTouch: false,
  affectedByFortune: false,
}

/**
 * Resolve the `'self'` sentinel against the block actually being broken.
 *
 * PARTIAL: once the answer is an ITEM, "the block itself" can fail to exist.
 * Deliberately does NOT consult the tool gate or silk touch — it answers "which
 * item", not "does anything drop". `resolveDrop` answers both.
 */
export const resolveDropItem = (rule: BlockDropRule, brokenBlock: BlockType): ItemType | undefined =>
  rule.item === 'self' ? itemOfBlock(brokenBlock) : rule.item

/**
 * What the player is swinging, as far as the drop is concerned.
 *
 * Every member is OPTIONAL, and omitting one means the boring answer ("bare
 * hands", "no silk touch"). kernel's `docs/versioning.md` §5-2 states the rule
 * this shape enforces: this struct is a PARAMETER, so a new REQUIRED member
 * would break every call site in fourteen repositories while a new optional one
 * breaks none.
 */
export type HarvestContext = {
  /** Tier of the held tool. Gates the drop; see `satisfiesHarvestTier`. */
  readonly heldTier?: HarvestTier
  /** Whether the held tool carries silk touch. */
  readonly silkTouch?: boolean
}

/** The empty context, spelled. Bare hands, no enchantments. */
export const BARE_HANDED: HarvestContext = {}

/**
 * What breaking a block actually yields.
 *
 * `affectedByFortune` is carried OUT rather than applied, and that is the seam
 * this whole file exists to hand mx-gameplay: fortune multiplies the count
 * through a random function, kernel's audit §6-9 puts random drop rules HERE
 * (「`drops` では表現できない」), and kernel is pure — `StageRegistration.run`
 * has error channel `never` and no source of randomness. So kernel reports the
 * base count and the fact that fortune applies, and
 * `./interactions/block-loot` does the multiplication with a roll from
 * `./frame-rolls`.
 */
export type BlockDrop = {
  readonly item: ItemType
  /** Base count, before fortune. Always >= 1; "nothing" is `undefined`, not zero. */
  readonly count: number
  readonly affectedByFortune: boolean
}

/**
 * The whole deterministic drop decision for one broken block. TOTAL, returning
 * `undefined` for "nothing drops".
 *
 * The three ways to get nothing, in the order checked:
 *
 *   1. `count <= 0` — the block yields nothing to anyone (`water`, `lava`,
 *      `bedrock`, `snow`, `oak_leaves`, `air`; the reference's ICE row is the
 *      case kernel's comment names, and this build has no ice).
 *   2. The tool tier is below `harvestTool.minTier` — mining stone bare-handed.
 *      The CATEGORY is not consulted: the wrong family of tool is slow, not
 *      fruitless.
 *   3. `requiresSilkTouch` and the tool has none — breaking glass.
 *
 * ...and a fourth that is not a denial but an absence: the rule says `'self'`
 * and the block has no item form.
 *
 * KNOWN LIMITATION, kernel's and transcribed rather than repaired here: silk
 * touch is a GATE, not a SUBSTITUTION. Vanilla's "stone drops itself instead of
 * cobblestone under silk touch" needs a second item on the rule, and the
 * additive fix is one optional member on kernel's `BlockDropRule`.
 */
export const resolveDrop = (
  requirement: HarvestToolRequirement,
  rule: BlockDropRule,
  brokenBlock: BlockType,
  context: HarvestContext = BARE_HANDED,
): BlockDrop | undefined => {
  if (rule.count <= 0) {
    return undefined
  }
  if (!satisfiesHarvestTier(requirement, context.heldTier ?? 'none')) {
    return undefined
  }
  if (rule.requiresSilkTouch && context.silkTouch !== true) {
    return undefined
  }

  const item = resolveDropItem(rule, brokenBlock)

  return item === undefined
    ? undefined
    : { item, count: rule.count, affectedByFortune: rule.affectedByFortune }
}

// ---------------------------------------------------------------------------
// The registry's two drop columns — mirrors mc-kernel/domain/block-registry.ts
// ---------------------------------------------------------------------------

/** Drops nothing, to anyone, ever. kernel's `DROPS_NOTHING`. */
const DROPS_NOTHING: BlockDropRule = { ...DEFAULT_BLOCK_DROP, count: 0 }

/**
 * The tier gate that separates "mined stone" from "wasted a swing".
 *
 * Four constants for the four stages of the reference's union ladder
 * (`harvestable-blocks.ts:14-67`), transcribed from kernel's table of the same
 * name. A block belongs to exactly one, by the tier at which it FIRST becomes
 * mineable — so `iron_ore` is `stone` and `obsidian` is the sole `diamond`.
 *
 * The three beyond `wooden` arrived with kernel's ore rows. Nothing in
 * mx-gameplay reads the tier directly: it reaches `resolveDrop` through
 * `dropOfBlockId`, which is the point of transcribing the columns rather than
 * the decisions.
 */
const NEEDS_WOODEN_PICKAXE: HarvestToolRequirement = {
  ...DEFAULT_HARVEST_TOOL,
  category: 'pickaxe',
  minTier: 'wooden',
}
const NEEDS_STONE_PICKAXE: HarvestToolRequirement = {
  ...DEFAULT_HARVEST_TOOL,
  category: 'pickaxe',
  minTier: 'stone',
}
const NEEDS_IRON_PICKAXE: HarvestToolRequirement = {
  ...DEFAULT_HARVEST_TOOL,
  category: 'pickaxe',
  minTier: 'iron',
}
const NEEDS_DIAMOND_PICKAXE: HarvestToolRequirement = {
  ...DEFAULT_HARVEST_TOOL,
  category: 'pickaxe',
  minTier: 'diamond',
}

/**
 * Category-only requirements: faster with the named tool, but NOT gated.
 *
 * `satisfiesHarvestTier` never reads `category`, so these rows change break
 * SPEED and nothing else. They are transcribed rather than collapsed into the
 * default precisely because forgetting that the two axes are independent is the
 * bug the struct is shaped to prevent.
 */
const FASTER_WITH_SHOVEL: HarvestToolRequirement = { ...DEFAULT_HARVEST_TOOL, category: 'shovel' }
const FASTER_WITH_AXE: HarvestToolRequirement = { ...DEFAULT_HARVEST_TOOL, category: 'axe' }
const FASTER_WITH_SHEARS: HarvestToolRequirement = { ...DEFAULT_HARVEST_TOOL, category: 'shears' }

/** One row: the permanent id, the name it denotes, and its two drop columns. */
export type BlockDropRegistryEntry = {
  readonly id: BlockId
  readonly type: BlockType
  readonly harvestTool: HarvestToolRequirement
  readonly drops: BlockDropRule
}

/**
 * THE drop table, transcribed from kernel's `BLOCK_REGISTRY`.
 *
 * Ids 0-10 reproduce mc-worldgen's `BLOCK` constant exactly; 11+ are appended in
 * the order the blocks were needed. THAT IS THE FACT `REPLACEABLE_IDS` below got
 * wrong — its transcription was written when the table stopped at 10 and did not
 * follow the append, so `lava` was missing from the replaceable set for as long
 * as it existed. Every row below is present, including the boring ones, so the
 * same omission cannot hide here.
 *
 * A row states only its differences from kernel's two defaults, which is why
 * most of them are `DEFAULT_HARVEST_TOOL` and `DEFAULT_BLOCK_DROP`: a row with
 * no overrides is not an omission, it is the statement that the block drops one
 * of itself to bare hands.
 */
export const BLOCK_DROP_REGISTRY: ReadonlyArray<BlockDropRegistryEntry> = [
  { id: 0, type: 'air', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 1, type: 'bedrock', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 2, type: 'stone', harvestTool: NEEDS_WOODEN_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'cobblestone' } },
  { id: 3, type: 'dirt', harvestTool: FASTER_WITH_SHOVEL, drops: DEFAULT_BLOCK_DROP },
  { id: 4, type: 'grass_block', harvestTool: FASTER_WITH_SHOVEL, drops: { ...DEFAULT_BLOCK_DROP, item: 'dirt' } },
  { id: 5, type: 'sand', harvestTool: FASTER_WITH_SHOVEL, drops: DEFAULT_BLOCK_DROP },
  { id: 6, type: 'water', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 7, type: 'snow', harvestTool: FASTER_WITH_SHOVEL, drops: { ...DEFAULT_BLOCK_DROP, item: 'snowball', count: 4 } },
  { id: 8, type: 'gravel', harvestTool: FASTER_WITH_SHOVEL, drops: DEFAULT_BLOCK_DROP },
  { id: 9, type: 'oak_log', harvestTool: FASTER_WITH_AXE, drops: DEFAULT_BLOCK_DROP },
  { id: 10, type: 'oak_leaves', harvestTool: FASTER_WITH_SHEARS, drops: DROPS_NOTHING },
  { id: 11, type: 'lava', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 12, type: 'oak_planks', harvestTool: FASTER_WITH_AXE, drops: DEFAULT_BLOCK_DROP },
  { id: 13, type: 'glass', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, requiresSilkTouch: true } },
  { id: 14, type: 'torch', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 15, type: 'glowstone', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, item: 'glowstone_dust', count: 2, affectedByFortune: true } },
  { id: 16, type: 'piston', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 17, type: 'cobblestone', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 18, type: 'ladder', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 19, type: 'cobweb', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, item: 'string' } },
  { id: 20, type: 'sapling', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 21, type: 'dandelion', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 22, type: 'poppy', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 23, type: 'brown_mushroom', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 24, type: 'red_mushroom', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 25, type: 'tall_grass', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 26, type: 'fern', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 27, type: 'sugar_cane', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 28, type: 'lily_pad', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 29, type: 'kelp', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 30, type: 'seagrass', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 31, type: 'rail', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 32, type: 'powered_rail', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 33, type: 'cactus', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 34, type: 'pressure_plate', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 35, type: 'stone_slab', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 36, type: 'granite', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 37, type: 'diorite', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 38, type: 'andesite', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 39, type: 'deepslate', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 40, type: 'obsidian', harvestTool: NEEDS_DIAMOND_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 41, type: 'smooth_basalt', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 42, type: 'calcite', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 43, type: 'amethyst_block', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 44, type: 'amethyst_cluster', harvestTool: NEEDS_WOODEN_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'amethyst_shard', count: 4 } },
  { id: 45, type: 'sandstone', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 46, type: 'prismarine', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 47, type: 'soul_sand', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 48, type: 'ice', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 49, type: 'farmland', harvestTool: FASTER_WITH_SHOVEL, drops: { ...DEFAULT_BLOCK_DROP, item: 'dirt' } },
  { id: 50, type: 'coal_ore', harvestTool: NEEDS_WOODEN_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'coal', affectedByFortune: true } },
  { id: 51, type: 'iron_ore', harvestTool: NEEDS_STONE_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'raw_iron' } },
  { id: 52, type: 'gold_ore', harvestTool: NEEDS_IRON_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'raw_gold' } },
  { id: 53, type: 'diamond_ore', harvestTool: NEEDS_IRON_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'diamond', affectedByFortune: true } },
  { id: 54, type: 'redstone_ore', harvestTool: NEEDS_IRON_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'redstone_dust', count: 4, affectedByFortune: true } },
  { id: 55, type: 'lapis_ore', harvestTool: NEEDS_STONE_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'lapis_lazuli', count: 4, affectedByFortune: true } },
  { id: 56, type: 'emerald_ore', harvestTool: NEEDS_IRON_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'emerald', affectedByFortune: true } },
  { id: 57, type: 'deepslate_coal_ore', harvestTool: NEEDS_WOODEN_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'coal', affectedByFortune: true } },
  { id: 58, type: 'deepslate_iron_ore', harvestTool: NEEDS_STONE_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'raw_iron' } },
  { id: 59, type: 'deepslate_gold_ore', harvestTool: NEEDS_IRON_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'raw_gold' } },
  { id: 60, type: 'deepslate_diamond_ore', harvestTool: NEEDS_IRON_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'diamond', affectedByFortune: true } },
  { id: 61, type: 'deepslate_redstone_ore', harvestTool: NEEDS_IRON_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'redstone_dust', count: 4, affectedByFortune: true } },
  { id: 62, type: 'deepslate_lapis_ore', harvestTool: NEEDS_STONE_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'lapis_lazuli', count: 4, affectedByFortune: true } },
  { id: 63, type: 'deepslate_emerald_ore', harvestTool: NEEDS_IRON_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'emerald', affectedByFortune: true } },
  { id: 64, type: 'coal_block', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 65, type: 'iron_block', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 66, type: 'gold_block', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 67, type: 'diamond_block', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 68, type: 'redstone_block', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 69, type: 'lapis_block', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 70, type: 'emerald_block', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 71, type: 'wheat_crop', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, item: 'wheat_seeds' } },
  { id: 72, type: 'potato_crop', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, item: 'potato' } },
  { id: 73, type: 'nether_wart_crop', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, item: 'nether_wart' } },
  { id: 74, type: 'redstone_wire', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, item: 'redstone_dust' } },
  { id: 75, type: 'redstone_torch', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 76, type: 'lever', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 77, type: 'stone_button', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 78, type: 'repeater', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 79, type: 'redstone_lamp', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 80, type: 'redstone_lamp_lit', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, item: 'redstone_lamp' } },
  { id: 81, type: 'observer', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 82, type: 'comparator', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 83, type: 'dispenser', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 84, type: 'hopper', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 85, type: 'piston_head', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 86, type: 'end_stone', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 87, type: 'end_portal_frame', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 88, type: 'end_portal_frame_filled', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 89, type: 'end_portal', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 90, type: 'chorus_flower', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 91, type: 'chorus_plant', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 92, type: 'dragon_egg', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 93, type: 'end_crystal', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 94, type: 'end_gateway', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 95, type: 'end_rod', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 96, type: 'end_stone_bricks', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 97, type: 'ender_chest', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 98, type: 'purpur_block', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 99, type: 'purpur_pillar', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 100, type: 'purpur_slab', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 101, type: 'purpur_stairs', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 102, type: 'shulker_box', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 103, type: 'crafting_table', harvestTool: FASTER_WITH_AXE, drops: DEFAULT_BLOCK_DROP },
  { id: 104, type: 'furnace', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 105, type: 'chest', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 106, type: 'door', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 107, type: 'door_open', harvestTool: DEFAULT_HARVEST_TOOL, drops: { ...DEFAULT_BLOCK_DROP, item: 'door' } },
  { id: 108, type: 'oak_stairs', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 109, type: 'anvil', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 110, type: 'cauldron', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 111, type: 'water_cauldron', harvestTool: NEEDS_WOODEN_PICKAXE, drops: { ...DEFAULT_BLOCK_DROP, item: 'cauldron' } },
  { id: 112, type: 'bed', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 113, type: 'enchanting_table', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 114, type: 'brewing_stand', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 115, type: 'tnt', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 116, type: 'nether_brick', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 117, type: 'netherrack', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 118, type: 'nether_portal', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 119, type: 'fire', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
]

const REGISTRY_BY_ID: ReadonlyMap<BlockId, BlockDropRegistryEntry> = new Map(
  BLOCK_DROP_REGISTRY.map((entry) => [entry.id, entry] as const),
)

const ID_BY_TYPE: ReadonlyMap<BlockType, BlockId> = new Map(
  BLOCK_DROP_REGISTRY.map((entry) => [entry.type, entry.id] as const),
)

/**
 * id -> `BlockType`. `undefined` for a byte this build does not recognise.
 *
 * THE number-to-string bridge. Note that "unrecognised" is a real answer here
 * and is not smoothed into `'air'`: a corrupt chunk or a save from a newer build
 * must not be readable as a block this build can name.
 */
export const blockTypeOfId = (id: number): BlockType | undefined => REGISTRY_BY_ID.get(id)?.type

/**
 * `BlockType` -> id.
 *
 * PARTIAL here, where kernel's is total with a `?? AIR_BLOCK_ID` fallback.
 * kernel can be total because `test/block-registry.test.ts` forbids an
 * unregistered type from ever landing; this mirror carries no such gate, and
 * kernel's own note records what the fallback costs — 「an unregistered type
 * silently becomes AIR, so the block does not merely misread, it VANISHES」.
 * A mirror is exactly the place that guarantee does not hold, so the failure is
 * `undefined` rather than a disappearing block.
 */
export const blockIdOf = (type: BlockType): BlockId | undefined => ID_BY_TYPE.get(type)

/**
 * Chunk buffer byte -> the item that lands in the inventory. THE mining bridge.
 *
 * One call, with no block name on the read side, exactly as
 * `fallsWhenUnsupported` below is for the falling-block rule.
 * `./interactions/block-loot` is its only caller and adds the random half.
 *
 * TOTAL, and `undefined` is a first-class answer meaning "nothing drops": the
 * bare-handed swing at stone, the pane of glass without silk touch, the block
 * that yields nothing to anyone.
 *
 * AN UNKNOWN ID ALSO YIELDS `undefined`, which is a DIFFERENT rule from
 * `capabilityOfBlockId`'s (that one falls back to the defaults, i.e. to an
 * ordinary cube). kernel states why the two are consistent on the principle
 * rather than on the mechanism: the inert reading is the safe one, and for a
 * drop, "an ordinary cube" would mean MINTING AN ITEM out of a byte this build
 * cannot name.
 */
export const dropOfBlockId = (
  id: number,
  context: HarvestContext = BARE_HANDED,
): BlockDrop | undefined => {
  const entry = REGISTRY_BY_ID.get(id)

  return entry === undefined
    ? undefined
    : resolveDrop(entry.harvestTool, entry.drops, entry.type, context)
}

// ---------------------------------------------------------------------------
// The registry's capability columns — mirrors mc-kernel/domain/block-capabilities.ts
// ---------------------------------------------------------------------------

/**
 * The block ids this repository's rules ask about, as CAPABILITY membership.
 *
 * Restated from kernel's `BLOCK_REGISTRY` rather than derived here. Note what
 * the rules do NOT do: name a block. The reference implementation asked
 * `blockTypeToIndex('SAND')` in 229 places across 51 files (plan.md §3.1), and
 * that scatter is what made engine/content separation impossible. Adding a
 * falling block should be one row in kernel's table and no change here at all —
 * which is exactly what `test/vertical-slice.test.ts` checks by running the
 * same rule over gravel.
 *
 * When mc-kernel is published these collapse into
 * `capabilityOfBlockId(id, 'fallsWhenUnsupported')`,
 * `capabilityOfBlockId(id, 'replaceable')`,
 * `capabilityOfBlockId(id, 'validSpawnSurface')` and
 * `capabilityOfBlockId(id, 'canSupportAttachments')` — which is a step this file
 * can promise and `./chunk-store-port`, where they used to live, could not.
 */
const FALLS_WHEN_UNSUPPORTED_IDS: ReadonlySet<BlockId> = new Set<BlockId>([
  5, // sand
  8, // gravel
])

const REPLACEABLE_IDS: ReadonlySet<BlockId> = new Set<BlockId>([
  0, // air
  6, // water
  // Lava was MISSING here until mc-dev-meta's `pnpm check:mirrors` compared this
  // set against mc-kernel's `capabilityOfBlockId(id, 'replaceable')` and found
  // the disagreement. kernel's registry says ids 0-10 reproduce mc-worldgen's
  // BLOCK constant and 11+ are appended as blocks are needed — this transcription
  // was written when the table stopped at 10 and did not follow the append.
  //
  // The consequence was not cosmetic: falling sand and gravel did not displace
  // lava, and placement treated a lava cell as occupied. The mirror test passed
  // throughout, because it pins the transcription rather than the source.
  // That is the whole reason the cross-repository check exists.
  11, // lava
])

/**
 * The blocks a mob may NOT stand on. A NEGATIVE list, and that is kernel's shape
 * rather than a preference of this file.
 *
 * `validSpawnSurface` is one of kernel's three flags that default to `true`
 * (`BLOCK_CAPABILITY_DEFAULTS`, `TRUE_BY_DEFAULT_CAPABILITY_FLAGS`), because for
 * an ordinary opaque cube the true answer IS true and the reference
 * implementation correspondingly stored `NON_SPAWN_SURFACE_BLOCK_IDS`
 * (`spawn-selection-search.ts:41-60`) rather than the complement. Transcribing
 * the negative set keeps two properties for free that the positive set would
 * have to remember:
 *
 *   - an id this build cannot name resolves to `true`, exactly as kernel's
 *     `capabilityOfBlockId` does (an unknown byte reads as an ordinary cube);
 *   - adding an ordinary block to kernel's registry needs no edit here.
 *
 * DO NOT collapse this into a general `solid` test. kernel's audit §4.9 is
 * explicit that `passable`, `suffocates`, `canSupportAttachments`,
 * `validSpawnSurface` and `collisionShape` are five INDEPENDENT capabilities
 * with different membership, and it names the disagreements: glass is solid for
 * collision but is not a spawn surface, leaves are solid for collision but are
 * not a spawn surface, snow is non-supporting but not passable. The reference
 * kept two near-duplicate negative lists (`spawn-selection-search.ts:41-60` and
 * `village-placement-surface.ts:6-12`) that DISAGREED with each other; a spawn
 * rule that re-derives the answer from "is it solid" is how a third one starts.
 */
const NON_SPAWN_SURFACE_IDS: ReadonlySet<BlockId> = new Set<BlockId>([
  0, // air
  6, // water
  9, // oak_log
  10, // oak_leaves
  11, // lava
  13, // glass
  14, // torch
  16, // piston
  18, // ladder
  19, // cobweb
  20, // sapling
  21, // dandelion
  22, // poppy
  23, // brown_mushroom
  24, // red_mushroom
  25, // tall_grass
  26, // fern
  27, // sugar_cane
  28, // lily_pad
  33, // cactus
  34, // pressure_plate
  71, // wheat_crop
  72, // potato_crop
  73, // nether_wart_crop
  74, // redstone_wire
  75, // redstone_torch
  76, // lever
  77, // stone_button
  78, // repeater
  89, // end_portal
  90, // chorus_flower
  91, // chorus_plant
  93, // end_crystal
  94, // end_gateway
  95, // end_rod
  106, // door
  107, // door_open
  112, // bed
  118, // nether_portal
])

/**
 * The blocks nothing may be ATTACHED TO. A NEGATIVE list, and kernel's shape for
 * the same reason `NON_SPAWN_SURFACE_IDS` is one: `canSupportAttachments` is the
 * second of kernel's three flags that default to `true`
 * (`BLOCK_CAPABILITY_DEFAULTS`), because for an ordinary opaque cube the true
 * answer IS true and the reference correspondingly stores
 * `NON_SUPPORTING_BLOCK_TYPES` (`block-support.ts:47-61`) rather than the
 * complement.
 *
 * THIS IS NOT `NON_SPAWN_SURFACE_IDS` AND MUST NOT BE COLLAPSED INTO IT, even
 * though the two lists overlap heavily. kernel's audit §4.9 names the
 * disagreement in this very pair: SNOW is NON-SUPPORTING but IS a valid spawn
 * surface — a mob may stand on snow and a torch may not be planted in it — and
 * `oak_log` / `oak_leaves` / `glass` are the mirror image, valid supports that
 * are not ground. Five independent capabilities with different membership is
 * exactly what the audit measured, and it measured it by finding five
 * near-duplicate lists in the reference that DISAGREED.
 *
 * Read about the block BELOW a placement, by `./interactions/place-block`.
 */
const NON_SUPPORTING_IDS: ReadonlySet<BlockId> = new Set<BlockId>([
  0, // air
  6, // water
  7, // snow
  11, // lava
  14, // torch
  20, // sapling
  21, // dandelion
  22, // poppy
  23, // brown_mushroom
  24, // red_mushroom
  25, // tall_grass
  26, // fern
  27, // sugar_cane
  28, // lily_pad
  31, // rail
  32, // powered_rail
  33, // cactus
  34, // pressure_plate
  71, // wheat_crop
  72, // potato_crop
  73, // nether_wart_crop
  74, // redstone_wire
  75, // redstone_torch
])

export const fallsWhenUnsupported = (block: BlockId): boolean => FALLS_WHEN_UNSUPPORTED_IDS.has(block)

export const isReplaceable = (block: BlockId): boolean => REPLACEABLE_IDS.has(block)

/** Total, like kernel's: an id outside the transcription reads as ordinary ground. */
export const validSpawnSurface = (block: BlockId): boolean => !NON_SPAWN_SURFACE_IDS.has(block)

/** Total, like kernel's: an id outside the transcription reads as an ordinary support. */
export const canSupportAttachments = (block: BlockId): boolean => !NON_SUPPORTING_IDS.has(block)

// ---------------------------------------------------------------------------
// supportRule — mirrors mc-kernel/domain/block-support.ts and the registry column
// ---------------------------------------------------------------------------

/**
 * What a block requires in the cell directly BELOW it. kernel's `SupportRule`.
 *
 * THIS IS THE COLUMN `./interactions/place-block` WAS MISSING, and the reason
 * its absence was tolerable for so long is worth stating before the type: no
 * block that needs it could be held. `PlaceableItemType` is `ItemType &
 * BlockType`, and kernel deliberately withholds an item form from the ten
 * blocks whose rule differs from the fallback — so `placeBlock` could not reach
 * the wrong answer even while the wrong answer was what it would have given.
 * That was recorded as F7 in `test/place-block.test.ts` and it is fixed here.
 *
 * The three arms are kernel's and the collapse is kernel's argument: the
 * reference implementation answers `canBlockStaySupported` out of THREE tables
 * (`block-support.ts:22-32` sensitivity, `:75-91` the per-block map, `:47-61`
 * the negative list) and kernel carries the first two as one column, deriving
 * sensitivity as `kind !== 'none'`. The third is `canSupportAttachments` above,
 * which this file already mirrored.
 */
export type SupportRule =
  | { readonly kind: 'none' }
  | { readonly kind: 'anySupporting' }
  | { readonly kind: 'oneOf'; readonly blocks: ReadonlyArray<BlockType> }

/** kernel's `NEEDS_NO_SUPPORT`. The default: an ordinary cube needs no floor. */
export const NEEDS_NO_SUPPORT: SupportRule = { kind: 'none' }

/** kernel's `NEEDS_ANY_SUPPORT`. The reference's fallback arm, named. */
export const NEEDS_ANY_SUPPORT: SupportRule = { kind: 'anySupporting' }

/** kernel's `needsOneOf`. Variadic so a row reads like the reference's set literal. */
export const needsOneOf = (...blocks: ReadonlyArray<BlockType>): SupportRule => ({
  kind: 'oneOf',
  blocks,
})

/**
 * kernel's `isSupportSensitive`, over a rule rather than over an id.
 *
 * Named EXACTLY as kernel names it, and that costs something: this repository
 * also has an `isSupportSensitive` over a `BlockId`, on its published surface,
 * so the two collide and the local one had to move (it is
 * `isSupportSensitiveOfBlock` in `domain/interactions/place-block.ts`).
 *
 * The collision was resolved the other way first -- this one was called
 * `isSupportSensitive` -- and `pnpm check:mirrors` rejected it. It was right
 * to. A mirror that renames a symbol still typechecks, still passes every local
 * test, and produces a name that DOES NOT EXIST on the day the import is
 * repointed. Renaming is the quietest way to break the promise this file's
 * header makes, because nothing local can tell that a name is not the source's.
 *
 * So the rule is: when a mirrored name collides with a local one, the LOCAL name
 * moves. The mirror has no freedom; it is a transcription.
 */
export const isSupportSensitive = (rule: SupportRule): boolean => rule.kind !== 'none'

/**
 * kernel's `satisfiesSupportRule` — `canBlockStaySupported` (`block-support.ts:
 * 96-101`) with the tables it reads passed in.
 *
 * The `undefined` asymmetry is kernel's and is transcribed rather than
 * simplified: an unnameable block below DOES hold up a torch (an unknown byte
 * reads as an ordinary cube, so it supports attachments) and does NOT float a
 * lily pad (no unnameable block is a member of a list of names).
 */
export const satisfiesSupportRule = (
  rule: SupportRule,
  blockBelow: BlockType | undefined,
  belowSupportsAttachments: boolean,
): boolean => {
  switch (rule.kind) {
    case 'none':
      return true

    case 'anySupporting':
      return belowSupportsAttachments

    case 'oneOf':
      return blockBelow !== undefined && rule.blocks.includes(blockBelow)
  }
}

/**
 * The five per-block lists, named as kernel names them.
 *
 * Transcribed from `mc-kernel/domain/block-registry.ts`, which transcribed them
 * from `block-support.ts:63-69,78-88`. The reference's `GRASS` is the grass
 * BLOCK and is `grass_block` here; its `TALL_GRASS` is one of the seven plants
 * the surface rule applies TO, not one of the three blocks it names.
 */
const NEEDS_FARMLAND: SupportRule = needsOneOf('farmland')
const NEEDS_PLANTABLE_GROUND: SupportRule = needsOneOf('dirt', 'grass_block', 'farmland')
const NEEDS_SUGAR_CANE_GROUND: SupportRule = needsOneOf('dirt', 'grass_block', 'sand', 'sugar_cane')
const NEEDS_SAND_OR_CACTUS: SupportRule = needsOneOf('sand', 'cactus')
const NEEDS_WATER: SupportRule = needsOneOf('water')

/**
 * EVERY row of kernel's `supportRule` column that is not the default. All
 * nineteen, and the completeness is the point rather than a courtesy.
 *
 * This file's header states the rule: a transcription that is a SUBSET cannot
 * be compared mechanically, because "is it a subset?" is true of a stale mirror
 * too. The closed set here is "the blocks with a non-default support rule",
 * `test/block-vocabulary-mirror.test.ts` pins its membership as a list of names,
 * and the 101 rows that are absent are absent because kernel's table states
 * OVERRIDES only — an absent row is the statement "requires nothing below",
 * which is exactly what `supportRuleOfBlockId` returns for it.
 *
 * SIX OF THE NINETEEN TAKE THE FALLBACK ARM, and they are the ones the
 * reference gives NO per-block entry: `torch`, `redstone_torch`,
 * `redstone_wire`, `pressure_plate`, `rail`, `powered_rail`. Their arm is an
 * ABSENCE in the source, so `NEEDS_ANY_SUPPORT` is that absence written down —
 * and inventing a list for them (they all plausibly want "dirt or stone") would
 * be this repository fabricating content, which is the failure kernel's audit
 * §4.9.1(c) names.
 */
const SUPPORT_RULE_OVERRIDES: ReadonlyMap<BlockId, SupportRule> = new Map<BlockId, SupportRule>([
  [14, NEEDS_ANY_SUPPORT], // torch — block-support.ts:23, no entry at :75-89
  [20, NEEDS_PLANTABLE_GROUND], // sapling
  [21, NEEDS_PLANTABLE_GROUND], // dandelion
  [22, NEEDS_PLANTABLE_GROUND], // poppy
  [23, NEEDS_PLANTABLE_GROUND], // brown_mushroom
  [24, NEEDS_PLANTABLE_GROUND], // red_mushroom
  [25, NEEDS_PLANTABLE_GROUND], // tall_grass
  [26, NEEDS_PLANTABLE_GROUND], // fern
  [27, NEEDS_SUGAR_CANE_GROUND], // sugar_cane — block-support.ts:82
  [28, NEEDS_WATER], // lily_pad — block-support.ts:84
  [31, NEEDS_ANY_SUPPORT], // rail — block-support.ts:27, no entry at :75-89
  [32, NEEDS_ANY_SUPPORT], // powered_rail — block-support.ts:28, no entry at :75-89
  [33, NEEDS_SAND_OR_CACTUS], // cactus — block-support.ts:83
  [34, NEEDS_ANY_SUPPORT], // pressure_plate — block-support.ts:26, no entry at :75-89
  [71, NEEDS_FARMLAND], // wheat_crop — block-support.ts:78-81
  [72, NEEDS_FARMLAND], // potato_crop — block-support.ts:78-81
  [73, NEEDS_FARMLAND], // nether_wart_crop — block-support.ts:78-81
  [74, NEEDS_ANY_SUPPORT], // redstone_wire — block-support.ts:25, no entry at :75-89
  [75, NEEDS_ANY_SUPPORT], // redstone_torch — block-support.ts:24, no entry at :75-89
])

/**
 * The support rule of a chunk buffer byte. kernel's `supportRuleOfBlockId`.
 *
 * TOTAL: an id outside the transcription requires nothing below, which is
 * kernel's default and the inert reading — an unknown block sits where it was
 * put rather than popping off.
 */
export const supportRuleOfBlockId = (block: BlockId): SupportRule =>
  SUPPORT_RULE_OVERRIDES.get(block) ?? NEEDS_NO_SUPPORT

/**
 * Does this byte care what is under it? kernel's `isSupportSensitiveBlockId`.
 *
 * `false` for an unknown id, which is the permissive direction: an unnameable
 * block is not refused for a reason nobody can state.
 */
export const isSupportSensitiveBlockId = (block: BlockId): boolean =>
  isSupportSensitive(supportRuleOfBlockId(block))

/**
 * `canBlockStaySupported` (`block-support.ts:96-101`) on two chunk buffer bytes.
 * kernel's function of the same name.
 *
 * THE PRECEDENCE IS THE PART THAT GOES WRONG, and it is why this is one call
 * rather than two predicates a caller ANDs. The per-block list WINS over the
 * negative set, so a rule that asks `canSupportAttachments` first refuses a lily
 * pad on water before the rule that permits it can run. That is precisely what
 * this repository did until `supportRule` existed to consult.
 */
export const canBlockStaySupported = (block: BlockId, supportBelow: BlockId): boolean =>
  satisfiesSupportRule(
    supportRuleOfBlockId(block),
    blockTypeOfId(supportBelow),
    canSupportAttachments(supportBelow),
  )
