/**
 * ONE RULE, ONE FILE (DN-GP-9): what a broken block actually leaves behind.
 *
 * ---------------------------------------------------------------------------
 * THE HALF KERNEL REFUSED TO HOLD, AND WHY THE SPLIT IS THERE
 * ---------------------------------------------------------------------------
 *
 * `../block-vocabulary`'s `dropOfBlockId` answers the DETERMINISTIC question —
 * which item, how many, does the tool gate open, does silk touch apply — and
 * carries `affectedByFortune` OUT as a flag rather than applying it. kernel's
 * `domain/block-harvest.ts` says why in a sentence that names this file's job:
 *
 *     Kernel is pure and deterministic — `StageRegistration.run` has error
 *     channel `never` and no source of randomness — so it reports the base count
 *     and the fact that fortune applies, and lets the rule that owns the RNG do
 *     the multiplication.
 *
 * kernel's capability-flag audit §6-9 draws the same line for every random drop:
 * 「`drops` では表現できない」. `../mob/mob-drop` is the mob-side twin of exactly
 * this paragraph, and this file is the block-side one. The two are separate
 * because a mob's loot is chosen by a KIND and a block's by a chunk buffer BYTE,
 * and neither table can answer the other's question.
 *
 * ---------------------------------------------------------------------------
 * WHAT MINING USED TO YIELD, AND WHY THAT WAS NOT A LOOT TABLE
 * ---------------------------------------------------------------------------
 *
 * `stages/registration.ts` used to push `outcome.yielded` — the raw `BlockId`
 * the write returned — straight into the outbox. Two things were wrong with it
 * and only the second is obvious:
 *
 *   - Breaking diamond ore gave you the ORE BLOCK, breaking stone gave you
 *     STONE rather than cobblestone, and grass gave you grass. There was no drop
 *     table, so "the item" was "the block that was there".
 *   - BARE HANDS HARVESTED STONE. There was no tool gate either, so the whole of
 *     kernel's `harvestTool` column — the one that makes a pickaxe worth
 *     crafting — was unreachable from the only rule that would ever read it.
 *
 * `docs/testing.md` §3-2 recorded the first as 「掘って出るのは「そこにあった
 * ブロック」そのもの」. Both are gone: `blockLoot` below is the only thing the
 * interactions stage pushes, and every item in it came out of kernel's table.
 *
 * ---------------------------------------------------------------------------
 * THE ROLLS ARE ARGUMENTS, AND THE BUDGET IS FIXED
 * ---------------------------------------------------------------------------
 *
 * Every function here takes its randomness as a flat array of numbers in
 * `[0, 1)`, exactly as `../mob/mob-drop` and `../mob/enderman-teleport` do, and
 * `test/mob.test.ts` already fails the build on a `Math.random` anywhere in
 * `domain/`. The reference reads the global generator at all four of its sites
 * (`interaction-break-handler.execute.ts:111,119,135`), which is why its block
 * drops cannot be replayed.
 *
 * `BLOCK_LOOT_ROLLS` is drawn PER BROKEN BLOCK whether or not the block has
 * anything to roll for. That over-draw is the point rather than the cost, and it
 * is `../entities/mob-frame`'s `ENDERMAN_TELEPORT_ROLLS` argument applied to a
 * second consumer: advancing the seed by however many a particular block needed
 * would make the NEXT block's loot depend on which block this one was, so a
 * player who mined one extra dirt would get different glowstone. Drawing a fixed
 * budget makes the sequence depend only on HOW MANY blocks were broken, which is
 * `../frame-rolls`' rule that it depend on what happened.
 */
import {
  dropOfBlockId,
  blockTypeOfId,
  type BlockDrop,
  type BlockType,
  type HarvestContext,
} from '../block-vocabulary'
import type { BlockId } from '../chunk-store-port'
import type { ItemType } from '../item-vocabulary'

/**
 * What actually lands: a name and a number, and nothing that needs resolving.
 *
 * STRUCTURALLY IDENTICAL TO `../mob/mob-drop`'s `MobDrop`, and that is worth
 * saying out loud rather than leaving to be noticed. `stages/registration.ts`
 * argues that `minedItems` and `mobDrops` are two outboxes 「because the two
 * carry different things: a broken block yields a `BlockId` and a dead mob
 * yields an `ItemType` and a count」. That sentence stops being true the moment
 * this file exists — both now carry an item and a count — and the two outboxes
 * stay separate for a different reason, stated where they are declared.
 *
 * They are NOT unified into one type here. `MobDrop` is a mob's loot and this is
 * a block's; giving them one name would make a change to either a change to
 * both, which is the coupling kernel avoided by keeping `BlockDropRule` and the
 * mob tables in different repositories entirely.
 */
export type MinedItem = {
  readonly item: ItemType
  readonly count: number
}

/**
 * Everything about the tool, as far as the loot is concerned.
 *
 * kernel's `HarvestContext` plus the one member kernel deliberately does not
 * carry. `heldTier` and `silkTouch` gate the deterministic drop and are
 * kernel's; `fortuneLevel` MULTIPLIES it through a random function, which audit
 * §6-9 puts here — so it is added on this side of the boundary rather than
 * pushed back across it.
 *
 * Optional for kernel's stated reason (`docs/versioning.md` §5-2): this struct is
 * a PARAMETER, so a new required member breaks every call site and a new
 * optional one breaks none. Absent means level 0, which means no fortune.
 */
export type BlockLootContext = HarvestContext & {
  /** Enchantment level of Fortune on the held tool. 0, absent or negative = none. */
  readonly fortuneLevel?: number
}

/** Bare hands, no enchantments — the context a player starts a world with. */
export const NO_TOOL: BlockLootContext = {}

// ---------------------------------------------------------------------------
// Fortune
// ---------------------------------------------------------------------------

/**
 * Expected TOTAL drops at each Fortune level.
 *
 * `<reference-impl>/packages/inventory/domain/enchantment.config.ts:46`:
 * `{ 1: 1.33, 2: 1.75, 3: 2.5, 4: 2.5, 5: 2.5 }`. Levels 4 and 5 repeat level
 * 3's value in the reference and are transcribed rather than trimmed — the cap
 * is `MAX_LEVEL` in a table this repository does not own, and dropping the two
 * rows would silently change what an over-levelled tool does.
 */
export const FORTUNE_MULTIPLIERS: ReadonlyMap<number, number> = new Map([
  [1, 1.33],
  [2, 1.75],
  [3, 2.5],
  [4, 2.5],
  [5, 2.5],
])

/**
 * Extra drops beyond the base count, given one roll in `[0, 1)`.
 *
 * `<reference-impl>/packages/inventory/domain/enchantment.ts:107-111`, verbatim,
 * and its comment is the part worth keeping: the multiplier is the EXPECTED
 * total, so the extra is its fractional expectation realised probabilistically —
 * the integer part is guaranteed and the fractional part is the chance of one
 * more. Fortune I is therefore a bonus about a third of the time rather than
 * `Math.round(1.33)` rounding down to a flat no-op.
 *
 * TOTAL: a level with no row, a level that is not a number, and a roll that is
 * not a number all yield zero extra. That is the direction `../mob/mob-drop`'s
 * `clampRoll` takes and for the identical reason — the preview's finding F5 is a
 * `NaN` travelling through arithmetic that had no opinion about it, and a `NaN`
 * count is an item stack whose size is not a number arriving in mc-sim's
 * inventory.
 */
export const rollFortuneExtraDrops = (level: number, roll: number): number => {
  const multiplier = FORTUNE_MULTIPLIERS.get(Math.floor(level))
  if (multiplier === undefined || !Number.isFinite(roll)) {
    return 0
  }

  const expectedExtra = multiplier - 1
  const guaranteed = Math.floor(expectedExtra)

  return guaranteed + (roll < expectedExtra - guaranteed ? 1 : 0)
}

// ---------------------------------------------------------------------------
// Bonus drops — the lines that are not the block itself
// ---------------------------------------------------------------------------

/**
 * `<reference-impl>/packages/world/application/block-service.config.ts:221-223`.
 * One in two hundred, one in fifty, one in twenty.
 */
export const LEAF_APPLE_DROP_CHANCE = 0.005
export const LEAF_STICK_DROP_CHANCE = 0.02
export const LEAF_SAPLING_DROP_CHANCE = 0.05

/** `block-service.config.ts:235`. One in eight, from tall grass and ferns. */
export const GRASS_SEED_DROP_CHANCE = 0.125

/**
 * One line of a block's bonus loot: an item, and the roll it has to beat.
 *
 * A COUNT IS ALWAYS ONE. Every bonus line the reference has
 * (`rollLeafDrops` :225-233, `rollGrassSeedDrop` :245-246) yields exactly one
 * item or none, so there is no range to roll over and adding a `maxCount` here
 * would be inventing the other end of a rule — which is what
 * `../mob/shulker-shell` declines to do with `SHULKER_FORCED_CLOSED_TICKS`.
 */
type BonusDropLine = {
  readonly item: ItemType
  readonly chance: number
}

/**
 * THE bonus table: block -> the extra lines breaking it can yield.
 *
 * ONE TABLE IN ONE FILE, keyed by `BlockType` rather than by an id, which is the
 * property that distinguishes it from the scatter plan.md §3.1 measured. It is
 * the same shape as `../entities/mob-frame`'s `dropRulesOfKind` — a rules-tier
 * table naming things, because naming things is what the rules tier is for and
 * kernel's registry deliberately cannot express a random line.
 *
 * ---------------------------------------------------------------------------
 * TWO OF THE REFERENCE'S FOUR LINES ARE ROSTER GAPS, AND THEY ARE RECORDED
 * ---------------------------------------------------------------------------
 *
 * `rollLeafDrops` yields APPLE, STICKS and SAPLING, and `rollGrassSeedDrop`
 * yields WHEAT_SEEDS. Of those four items this build has exactly one:
 *
 *   `stick`         in `../item-vocabulary`. Shipped below.
 *   `apple`         NOT an `ItemType`. One row in kernel's roster, no edit here.
 *   `sapling`       a `BlockType` and NOT an `ItemType` — so it is in
 *                   `../block-vocabulary`'s `UNITEMISED_BLOCK_TYPES`, which is
 *                   the list that exists so this gap is data rather than a
 *                   comment. Breaking leaves cannot yield a sapling you can
 *                   carry until kernel itemises it.
 *   `wheat_seeds`   NOT an `ItemType`, and farming is not ported at all.
 *
 * The three absent lines are NOT written with a substitute item. `../mob/mob-drop`
 * records the one place this repository did substitute (`blaze_rod` ->
 * `blaze_powder`) and the paragraph justifying it is four times the length of
 * the line — because kernel had already decided that name. Nothing has decided
 * that an apple is a `glowstone_dust`.
 */
const BONUS_DROPS: ReadonlyMap<BlockType, ReadonlyArray<BonusDropLine>> = new Map<
  BlockType,
  ReadonlyArray<BonusDropLine>
>([['oak_leaves', [{ item: 'stick', chance: LEAF_STICK_DROP_CHANCE }]]])

/**
 * How many rolls `blockLoot` consumes for ONE broken block, whatever block it is.
 *
 * FOUR, and a constant rather than a function of the block. See the module
 * header: a budget that varied with the block would make each break's loot
 * depend on which blocks preceded it. The four are, in order:
 *
 *   [0] fortune
 *   [1] bonus line 0
 *   [2] bonus line 1
 *   [3] bonus line 2
 *
 * THREE BONUS SLOTS AND ONE TABLE ENTRY THAT USES ONE. The width is the
 * reference's `rollLeafDrops`, which takes three rolls, so restoring the apple
 * and sapling lines the day kernel has the items is a change to `BONUS_DROPS`
 * and NOT to this number — which is the whole reason it is not `1`. A budget
 * that grew when a table row grew would reshuffle every later draw in every
 * existing scenario test.
 */
export const BLOCK_LOOT_ROLLS = 4

/** The most bonus lines any one block may declare. Enforced by the budget above. */
const MAX_BONUS_LINES = BLOCK_LOOT_ROLLS - 1

const NO_LOOT: ReadonlyArray<never> = []

/**
 * Is the Fortune level on this tool worth consulting?
 *
 * Vanilla makes Fortune and Silk Touch MUTUALLY EXCLUSIVE and the reference
 * enforces it at the break site rather than at the enchanting table
 * (`interaction-break-handler.execute.ts:131-134`: `!hasSilkTouch && fortune`),
 * so the gate is here. A silk-touch tool that somehow carries Fortune gets no
 * multiplication rather than both.
 */
const fortuneApplies = (context: BlockLootContext): boolean =>
  context.silkTouch !== true && Number.isFinite(context.fortuneLevel ?? 0)

/**
 * The base drop with fortune folded in, or `undefined` for nothing.
 *
 * FOLDED INTO ONE STACK rather than emitted as a second line, which is a
 * deliberate divergence in SHAPE and not in behaviour. The reference calls
 * `spawnBlockDrop` twice with the same item (`:110`, `:136`) because it is
 * spawning item ENTITIES in the world and two of them is two things to pick up.
 * This outbox is a list of `InventoryService.add` calls, and two adds of one
 * item are one add of the sum — so folding loses nothing and stops the inventory
 * seeing a stack of 2 and a stack of 1 where a player sees three glowstone dust.
 */
const withFortune = (
  drop: BlockDrop,
  context: BlockLootContext,
  roll: number,
): MinedItem | undefined => {
  const extra =
    drop.affectedByFortune && fortuneApplies(context)
      ? rollFortuneExtraDrops(context.fortuneLevel ?? 0, roll)
      : 0

  const count = drop.count + extra

  return count <= 0 ? undefined : { item: drop.item, count }
}

/**
 * What breaking this block yields, base drop and bonus lines together.
 *
 * TOTAL. Every failure mode is an EMPTY LIST rather than a throw or a
 * zero-count stack, because `StageRegistration.run` has no error channel to put
 * a fifth answer in and a stack of zero is an item that exists and weighs
 * nothing:
 *
 *   - a byte this build cannot name yields nothing (`../block-vocabulary`'s
 *     rule: minting an item out of an unknown id is how a save from a newer
 *     build prints items into inventories);
 *   - stone swung at bare-handed yields nothing (the tool gate);
 *   - glass without silk touch yields nothing (the silk gate);
 *   - air, water, lava, bedrock, snow and leaves yield nothing to anyone
 *     (`count: 0` in kernel's table).
 *
 * `rolls` shorter than `BLOCK_LOOT_ROLLS` reads as zeros, which is the
 * every-"always"-branch answer `../mob/mob-drop`'s `LOWEST_ROLLS` documents —
 * and a zero roll PASSES a chance gate, so a caller that forgets to draw gets
 * the most generous loot rather than the least. That is the opposite of the
 * inert direction and it is chosen: the only caller draws its budget from
 * `../frame-rolls`, so an all-zeros array means a test wrote one on purpose, and
 * a test that means "every bonus line fires" should be able to say so by passing
 * nothing.
 */
export const blockLoot = (
  block: BlockId,
  context: BlockLootContext = NO_TOOL,
  rolls: ReadonlyArray<number> = NO_LOOT,
): ReadonlyArray<MinedItem> => {
  const drop = dropOfBlockId(block, context)
  const type = blockTypeOfId(block)

  const items: Array<MinedItem> = []

  if (drop !== undefined) {
    const base = withFortune(drop, context, rolls[0] ?? 0)
    if (base !== undefined) {
      items.push(base)
    }
  }

  // The bonus lines run even when the base drop yielded nothing, and leaves are
  // the reason: kernel's row is `DROPS_NOTHING`, so a rule that gated the bonus
  // on the base would make the one shipped table entry unreachable. The
  // reference has the same independence — its leaf and grass-seed blocks are
  // handled before and after the drop path, not inside it.
  //
  // SILK TOUCH SUPPRESSES THEM, which the reference states at both of its sites
  // (`:106`, `:114`: `!hasSilkTouch`). A silk-touch tool takes the block itself
  // and nothing shakes loose.
  const bonus = type === undefined || context.silkTouch === true ? undefined : BONUS_DROPS.get(type)
  if (bonus !== undefined) {
    bonus.slice(0, MAX_BONUS_LINES).forEach((line, index) => {
      if ((rolls[index + 1] ?? 0) < line.chance) {
        items.push({ item: line.item, count: 1 })
      }
    })
  }

  return items.length === 0 ? NO_LOOT : items
}
