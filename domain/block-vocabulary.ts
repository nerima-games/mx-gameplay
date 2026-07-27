/**
 * PROVISIONAL LOCAL MIRROR of `@nerima-games/mc-kernel`'s `domain/block-type.ts`,
 * `domain/block-item.ts`, `domain/block-harvest.ts` and the two DROP columns of
 * `domain/block-registry.ts`.
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
 * It is NOT re-exported from `index.ts`, for the reason `./frame-contract`,
 * `./position-key`, `./chunk-store-port` and `./item-vocabulary` are not:
 * re-exporting somebody else's vocabulary would make the promised deletion a
 * breaking change for every consumer of mx-gameplay. `test/public-api.test.ts`
 * pins that absence.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all, when `./chunk-store-port` already mirrors the registry
 * ---------------------------------------------------------------------------
 *
 * It mirrors DIFFERENT COLUMNS of the same kernel table, and the split is along
 * the line kernel itself drew. `./chunk-store-port`'s "Capability lookups"
 * section transcribes CAPABILITY membership — `fallsWhenUnsupported`,
 * `replaceable`, `validSpawnSurface`, `canSupportAttachments` — every one of
 * which is a boolean that `capabilityOfBlockId` answers and that
 * mc-dev-meta's `pnpm check:mirrors` probes as a SET. This file transcribes the
 * two STRUCT-valued columns, `harvestTool` and `drops`, which kernel keeps in
 * their own file for exactly this reason (`mc-kernel/domain/block-harvest.ts`,
 * quoting its audit §7: 「struct のため最も揺れやすい […] この 2 フィールドを別
 * ファイルに切り出して差分レビューを容易にすること」).
 *
 * Putting them in `./chunk-store-port` would have meant a mirror of
 * mc-worldgen's SERVICE growing a mirror of kernel's DROP TABLE, and the two
 * have different publication dates and different deletion steps.
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
 * this file has three rosters rather than one: a transcription that is a SUBSET
 * cannot be compared mechanically. `pnpm check:mirrors` caught `lava` missing
 * from `./chunk-store-port`'s `REPLACEABLE_IDS` by diffing a whole set against
 * kernel's, and "is it a subset?" is true of a stale mirror too.
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
 * THIRTY-SIX, and kernel's own header explains why it is not 120: the roster
 * grows by CLOSED REFERENCE TABLES rather than by count, because importing HALF
 * a membership set produces a set that disagrees with its source.
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

  // The reference's `PASSABLE_BLOCK_IDS` (`block-collision-predicates.ts:22-42`),
  // completed. Fifteen of its nineteen members; the other four are above.
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

  // The three non-`full` collision shapes, so kernel's `COLLISION_SHAPES` is
  // inhabited by real rows rather than by enum members nothing produces.
  'cactus',
  'pressure_plate',
  'stone_slab',
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

/** The tier gate that separates "mined stone" from "wasted a swing". */
const NEEDS_WOODEN_PICKAXE: HarvestToolRequirement = {
  ...DEFAULT_HARVEST_TOOL,
  category: 'pickaxe',
  minTier: 'wooden',
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
 * the order the blocks were needed. THAT IS THE FACT `./chunk-store-port`'s
 * `REPLACEABLE_IDS` got wrong — its transcription was written when the table
 * stopped at 10 and did not follow the append, so `lava` was missing from the
 * replaceable set for as long as the file existed. Every row below is present,
 * including the boring ones, so the same omission cannot hide here.
 *
 * A row states only its differences from kernel's two defaults, which is why
 * most of them are `DEFAULT_HARVEST_TOOL` and `DEFAULT_BLOCK_DROP`: a row with
 * no overrides is not an omission, it is the statement that the block drops one
 * of itself to bare hands.
 */
export const BLOCK_DROP_REGISTRY: ReadonlyArray<BlockDropRegistryEntry> = [
  // Swinging at empty space must not manufacture an item, and the table must not
  // depend on the caller getting that right: `./interactions/break-block` already
  // refuses to reach here (`Unchanged` -> `NothingThere`), but `air` is a
  // sentinel and not a thing (kernel audit §6-6).
  { id: 0, type: 'air', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 1, type: 'bedrock', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  // THE tool-gated row, and the reason the two columns are one decision rather
  // than two: stone mined bare-handed yields nothing, and stone mined with a
  // pickaxe yields something that is not stone.
  {
    id: 2,
    type: 'stone',
    harvestTool: NEEDS_WOODEN_PICKAXE,
    drops: { ...DEFAULT_BLOCK_DROP, item: 'cobblestone' },
  },
  { id: 3, type: 'dirt', harvestTool: FASTER_WITH_SHOVEL, drops: DEFAULT_BLOCK_DROP },
  // Different-drop with NO tool gate — the row that keeps the two axes visibly
  // separate. Grass yields dirt to bare hands.
  {
    id: 4,
    type: 'grass_block',
    harvestTool: FASTER_WITH_SHOVEL,
    drops: { ...DEFAULT_BLOCK_DROP, item: 'dirt' },
  },
  { id: 5, type: 'sand', harvestTool: FASTER_WITH_SHOVEL, drops: DEFAULT_BLOCK_DROP },
  { id: 6, type: 'water', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  // Vanilla yields snowballs to a shovel. `snowball` is not in `ITEM_TYPES`, and
  // kernel declined to invent it; the gap is `UNITEMISED_BLOCK_TYPES`.
  { id: 7, type: 'snow', harvestTool: FASTER_WITH_SHOVEL, drops: DROPS_NOTHING },
  // Vanilla's 10% flint is a RANDOM drop and audit §6-9 places those in this
  // repository. It is NOT in `./interactions/block-loot` either, and the reason
  // is docs/porting.md §4: the reference implementation has no such rule, and
  // the reference is the specification. The deterministic half — gravel yields
  // gravel — is this row.
  { id: 8, type: 'gravel', harvestTool: FASTER_WITH_SHOVEL, drops: DEFAULT_BLOCK_DROP },
  { id: 9, type: 'oak_log', harvestTool: FASTER_WITH_AXE, drops: DEFAULT_BLOCK_DROP },
  // Nothing from the block itself; the apple / stick / sapling rolls are the
  // reference's `rollLeafDrops` and live in `./interactions/block-loot`.
  { id: 10, type: 'oak_leaves', harvestTool: FASTER_WITH_SHEARS, drops: DROPS_NOTHING },
  { id: 11, type: 'lava', harvestTool: DEFAULT_HARVEST_TOOL, drops: DROPS_NOTHING },
  { id: 12, type: 'oak_planks', harvestTool: FASTER_WITH_AXE, drops: DEFAULT_BLOCK_DROP },
  // THE silk-touch row, and the only one in the table.
  {
    id: 13,
    type: 'glass',
    harvestTool: DEFAULT_HARVEST_TOOL,
    drops: { ...DEFAULT_BLOCK_DROP, requiresSilkTouch: true },
  },
  { id: 14, type: 'torch', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  // THE fortune row, and the only one in the table — this build has no ore, so
  // `affectedByFortune` would be an unreachable flag without it. It is also the
  // row that forced `item` to be an `ItemType`: there is no block called
  // `glowstone_dust`.
  {
    id: 15,
    type: 'glowstone',
    harvestTool: DEFAULT_HARVEST_TOOL,
    drops: { ...DEFAULT_BLOCK_DROP, item: 'glowstone_dust', count: 2, affectedByFortune: true },
  },
  { id: 16, type: 'piston', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 17, type: 'cobblestone', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 18, type: 'ladder', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 19, type: 'cobweb', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 20, type: 'sapling', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 21, type: 'dandelion', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 22, type: 'poppy', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 23, type: 'brown_mushroom', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 24, type: 'red_mushroom', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 25, type: 'tall_grass', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 26, type: 'fern', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 27, type: 'sugar_cane', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 28, type: 'lily_pad', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 29, type: 'kelp', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 30, type: 'seagrass', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 31, type: 'rail', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 32, type: 'powered_rail', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 33, type: 'cactus', harvestTool: DEFAULT_HARVEST_TOOL, drops: DEFAULT_BLOCK_DROP },
  { id: 34, type: 'pressure_plate', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
  { id: 35, type: 'stone_slab', harvestTool: NEEDS_WOODEN_PICKAXE, drops: DEFAULT_BLOCK_DROP },
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
 * `./chunk-store-port`'s `fallsWhenUnsupported` is for the falling-block rule.
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
