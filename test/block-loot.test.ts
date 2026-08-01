/**
 * `domain/interactions/block-loot.ts` and the kernel table it reads —
 * `domain/block-vocabulary.ts`.
 *
 * ---------------------------------------------------------------------------
 * The two things this file exists to stop coming back
 * ---------------------------------------------------------------------------
 *
 * Until this rule existed, `stages/registration.ts` pushed `outcome.yielded` —
 * the raw byte the write returned — into the outbox. That produced two wrong
 * answers at once and only the first is the one anybody notices:
 *
 *   BREAKING STONE GAVE YOU STONE. There was no drop table, so "the item" was
 *   "the block that was there". `docs/testing.md` §3-2 recorded it as
 *   「掘って出るのは「そこにあったブロック」そのもの」.
 *   BARE HANDS HARVESTED STONE. There was no tool gate either, so kernel's whole
 *   `harvestTool` column was unreachable from the only rule that reads it.
 *
 * Both are asserted below, and the second is the one worth having a test for at
 * all: a drop table with no gate looks completely correct from the outside until
 * somebody wonders why a pickaxe is worth crafting.
 *
 * ---------------------------------------------------------------------------
 * Where the numbers come from
 * ---------------------------------------------------------------------------
 *
 * The DETERMINISTIC half is kernel's `BLOCK_REGISTRY`, transcribed in
 * `domain/block-vocabulary.ts` row by row. The RANDOM half is the reference
 * implementation's, and audit §6-9 is why it is on this side of the line
 * (「`drops` では表現できない」):
 *
 *   fortune   `enchantment.ts:107-111` + `enchantment.config.ts:46`
 *   leaves    `block-service.config.ts:221-233` (`rollLeafDrops`)
 *
 * docs/porting.md §4 makes the reference the specification, which is why
 * vanilla's gravel-to-flint is NOT here: the reference has no such rule, and a
 * "fix" to a drop rate is the kind of change that should arrive with a
 * measurement.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  blockIdOf,
  blockTypeOfId,
  BLOCK_TYPES,
  dropOfBlockId,
  HARVEST_TIERS,
  itemOfBlock,
  satisfiesHarvestTier,
  UNITEMISED_BLOCK_TYPES,
  type BlockType,
  type HarvestTier,
} from '../src/domain/block-vocabulary'
import {
  BLOCK_LOOT_ROLLS,
  blockLoot,
  FORTUNE_MULTIPLIERS,
  GRASS_SEED_DROP_CHANCE,
  LEAF_APPLE_DROP_CHANCE,
  LEAF_SAPLING_DROP_CHANCE,
  LEAF_STICK_DROP_CHANCE,
  NO_TOOL,
  rollFortuneExtraDrops,
  type MinedItem,
} from '../src/domain/interactions/block-loot'
import { ITEM_TYPES } from '../src/domain/item-vocabulary'

const AIR = 0
const STONE = 2
const DIRT = 3
const GRASS_BLOCK = 4
const SAND = 5
const WATER = 6
const SNOW = 7
const GRAVEL = 8
const OAK_LEAVES = 10
const LAVA = 11
const GLASS = 13
const GLOWSTONE = 15
const TALL_GRASS = 25
const FERN = 26

/** Rolls that fail every chance gate: nothing bonus, no fortune remainder. */
const NO_LUCK: ReadonlyArray<number> = [0.999, 0.999, 0.999, 0.999]

/** Rolls that pass every chance gate. */
const ALL_LUCK: ReadonlyArray<number> = [0, 0, 0, 0]

describe('the kernel bridge — domain/block-vocabulary.ts', () => {
  // The number-to-string hop mc-compose's `docs/e2e-triage.md` §4.3 recorded as
  // an open question it could not answer from one repository: `breakBlock`
  // yields a `BlockId` and `InventoryService.add` takes an item.
  it.effect('turns a chunk buffer byte into a block name', () =>
    Effect.sync(() => {
      expect(blockTypeOfId(STONE)).toBe('stone')
      expect(blockTypeOfId(GLOWSTONE)).toBe('glowstone')
    }),
  )

  // An unrecognised byte is NOT smoothed into air. kernel's own note: an
  // ordinary-cube fallback for a DROP would mean minting an item out of a byte
  // this build cannot name, so a save from a newer build would print items into
  // inventories.
  it.effect('REGRESSION: an unknown byte has no name and no drop, rather than a default one', () =>
    Effect.sync(() => {
      expect(blockTypeOfId(200)).toBeUndefined()
      expect(dropOfBlockId(200)).toBeUndefined()
      expect(blockLoot(200)).toStrictEqual([])
    }),
  )

  // The item roster and the block roster are two unions that must not silently
  // interconvert, which is what kernel's `test/item-drops.test.ts` pins with
  // `Exclude`. Here it is asserted as data, because the mirror is what can drift.
  it.effect('blocks with no item form are data, not a comment', () =>
    Effect.sync(() => {
      expect(UNITEMISED_BLOCK_TYPES).toContain('air')
      expect(UNITEMISED_BLOCK_TYPES).toContain('water')
      expect(UNITEMISED_BLOCK_TYPES).toContain('lava')
      expect(UNITEMISED_BLOCK_TYPES).toContain('bedrock')
      // `snow` is still here, and its reason CHANGED. It used to be a roster gap
      // — vanilla yields snowballs and `snowball` was not in kernel's
      // `ITEM_TYPES`. The item exists now, so `snow` is unitemised for the
      // ordinary reason instead: its drop is an OVERRIDE pointing at `snowball`,
      // and a block whose drop is an override needs no item form of its own.
      expect(UNITEMISED_BLOCK_TYPES).toContain('snow')
      expect(dropOfBlockId(SNOW, { heldTier: 'diamond' })?.item).toBe('snowball')

      // Support-sensitive plants now have explicit placement rules, so kernel
      // can expose their item forms without making placement overly permissive.
      expect(UNITEMISED_BLOCK_TYPES).not.toContain('sapling')
      expect(itemOfBlock('sapling')).toBe('sapling')

      // The other seven of the eighteen kernel corrected DID get item forms,
      // because none of them has a per-block `SUPPORT_RULES` entry and so none
      // of them wakes F7. `ladder` is the plainest: it used to break into
      // nothing.
      expect(UNITEMISED_BLOCK_TYPES).not.toContain('ladder')
      expect(itemOfBlock('ladder')).toBe('ladder')

      expect(itemOfBlock('air')).toBeUndefined()
      expect(itemOfBlock('stone')).toBe('stone')
    }),
  )

  // Kernel's transcription is only useful if it is a SUBSET of kernel's own
  // rosters; a name here that kernel does not have would typecheck (the mirror
  // declares its own union) and would be a fork.
  it.effect('every drop this table can produce is a name the item roster has', () =>
    Effect.sync(() => {
      const items: ReadonlySet<string> = new Set<string>(ITEM_TYPES)
      const produced = ([AIR, STONE, DIRT, GRASS_BLOCK, SAND, GRAVEL, GLASS, GLOWSTONE] as const)
        .flatMap((id) => [...blockLoot(id, { heldTier: 'diamond', silkTouch: true })])
        .map((drop) => drop.item)

      expect(produced.length).toBeGreaterThan(0)
      for (const item of produced) {
        expect(items.has(item)).toBe(true)
      }
    }),
  )

  it.effect('the tier ladder orders wooden below stone below iron below diamond', () =>
    Effect.sync(() => {
      const needsWooden = { category: 'pickaxe', minTier: 'wooden' } as const
      expect(satisfiesHarvestTier(needsWooden, 'none')).toBe(false)
      expect(satisfiesHarvestTier(needsWooden, 'wooden')).toBe(true)
      expect(satisfiesHarvestTier(needsWooden, 'diamond')).toBe(true)
    }),
  )

  /*
   * PORTED ORACLE.
   * `<reference-impl>/packages/world/test/harvestable-blocks.test.ts:33-37`
   * (「stone tier is a superset of wooden tier」), `:50-54` (「iron tier is a
   * superset of stone tier」), `:67-71` (「diamond tier is a superset of iron
   * tier」) and `:78-88` (「tier sizes are strictly increasing」), read against
   * `packages/world/domain/harvestable-blocks.ts:14-67`.
   *
   * The reference spells its ladder as four HashSets and its oracle as the chain
   * of inclusions between them. This repository spells the same ladder as an
   * ORDER — `HARVEST_TIERS` and `satisfiesHarvestTier`, one comparison — so the
   * reference's four set claims become one claim about that order, and the
   * reference's 「strictly increasing」 becomes: each rung admits at least one
   * block the rung below refuses.
   *
   * THE SHAPES ARE DIFFERENT AND THE CLAIM IS THE SAME. That is worth stating
   * because the reference's individual rows — 「stone tier adds iron ore and
   * lapis ore」, 「only the diamond pickaxe harvests obsidian」 — are NOT ported
   * and cannot be: they name blocks (docs/porting.md §6) and this build's roster
   * has no `iron_ore`, `diamond_ore` or `obsidian` row for them to name. What
   * survives the roster gap is the ladder's SHAPE, and the shape is the half
   * that was untested.
   *
   * FOUND BY A MUTATION. Transposing `stone` and `iron` in `HARVEST_TIERS` left
   * all 409 tests in this repository green — an iron pickaxe that cannot harvest
   * a stone-tier block, and a stone pickaxe that can harvest an iron-tier one.
   * The test above could not see it: it drives ONE requirement (`wooden`) with
   * three tiers, and `wooden` sits below both of the transposed rungs. Any
   * mutation confined to the middle of the ladder is invisible to it.
   */
  it.effect('is a superset chain, and STRICTLY so — the reference’s four rungs, all four now real', () =>
    Effect.sync(() => {
      // Which blocks a tier can harvest AT ALL, asked through the rule rather
      // than read off the table: `dropOfBlockId` returns `undefined` when the
      // tier gate refuses, and the gate is the thing under test.
      //
      // `silkTouch` is on so that the SILK gate cannot be mistaken for the TIER
      // gate — glass would otherwise drop out of every rung alike and make the
      // sets agree for the wrong reason.
      const harvestedBy = (tier: HarvestTier): ReadonlySet<BlockType> =>
        new Set(
          BLOCK_TYPES.filter((block) => {
            const id = blockIdOf(block)
            return id !== undefined && dropOfBlockId(id, { heldTier: tier, silkTouch: true }) !== undefined
          }),
        )

      for (const [index, lower] of HARVEST_TIERS.entries()) {
        const higher = HARVEST_TIERS[index + 1]
        if (higher === undefined) {
          continue
        }

        const below = harvestedBy(lower)
        const above = harvestedBy(higher)

        // THE SUPERSET, which is the reference's `for (const block of LOWER)
        // expect(HashSet.has(HIGHER, block)).toBe(true)`, three times over. A
        // tool cannot get worse by being better made.
        for (const block of below) {
          expect(above.has(block)).toBe(true)
        }

        // ...and STRICTLY, which is `:78-88`. Without this half a ladder whose
        // five rungs all meant the same thing would pass: every set would equal
        // every other and every inclusion would hold, and `harvestTool` would be
        // a column nothing reads.
        //
        // THIS HALF ONLY BECAME PORTABLE WHEN KERNEL FINISHED ITS ROSTER.
        // docs/porting.md §4-2 declined the reference's `canHarvestBlock` rows
        // on the grounds that 「kernel の表に `iron_ore` / `diamond_ore` /
        // `obsidian` の行が無い」. All three exist now, so each of the four
        // pickaxe rungs gates at least one block and the chain is strict.
        expect(above.size).toBeGreaterThan(below.size)
      }
    }),
  )

  /*
   * PORTED ORACLE.
   * `<reference-impl>/packages/world/test/block-utils.test.ts:68-86` — the four
   * rows docs/porting.md §4-2 declined («個々の段（石つるはし→鉄鉱石、鉄→ダイヤ
   * 鉱石、ダイヤ→黒曜石）は roster ギャップ»), read against
   * `packages/world/domain/harvestable-blocks.ts:14-67`.
   *
   * THE DECLINE HAS EXPIRED, and that is the reason to write this down rather
   * than quietly port it. The reason given was a roster gap in kernel and not a
   * boundary or a divergence, so it was always a decline WITH AN END CONDITION;
   * kernel's roster completion supplied `iron_ore` (51), `diamond_ore` (53) and
   * `obsidian` (40), and the condition is met. A decline whose stated reason
   * stops being true and is never revisited is indistinguishable from a decision
   * nobody made.
   *
   * ONE ROW IS NOT THE REFERENCE'S. Its 「stone pickaxe harvests iron ore but not
   * diamond ore」 and 「iron pickaxe harvests diamond ore」 put diamond ore at the
   * IRON rung, and kernel agrees (`diamond_ore` is `NEEDS_IRON_PICKAXE`). Its
   * 「wooden tier does NOT include iron ore」 puts iron ore above wooden, and
   * kernel puts it at STONE. The two agree everywhere they overlap and the
   * transcription is kernel's, since kernel owns the table and this file mirrors
   * it.
   */
  it.effect('each rung of the ladder gates a real block, exactly as the reference’s rows say', () =>
    Effect.sync(() => {
      const yields = (block: BlockType, tier: HarvestTier): boolean => {
        const id = blockIdOf(block)
        return id !== undefined && blockLoot(id, { heldTier: tier }).length > 0
      }

      // `block-utils.test.ts:68` — 「wooden pickaxe harvests stone but not iron ore」.
      expect(yields('stone', 'wooden')).toBe(true)
      expect(yields('iron_ore', 'wooden')).toBe(false)

      // `:73` — 「stone pickaxe harvests iron ore but not diamond ore」.
      expect(yields('iron_ore', 'stone')).toBe(true)
      expect(yields('diamond_ore', 'stone')).toBe(false)

      // `:78` — 「iron pickaxe harvests diamond ore but not obsidian」.
      expect(yields('diamond_ore', 'iron')).toBe(true)
      expect(yields('obsidian', 'iron')).toBe(false)

      // `:83` — 「only the diamond pickaxe harvests obsidian」.
      expect(yields('obsidian', 'diamond')).toBe(true)
      for (const tier of ['none', 'wooden', 'stone', 'iron'] as const) {
        expect(yields('obsidian', tier)).toBe(false)
      }

      // ...and `:58` — 「bare hand cannot harvest pickaxe-required blocks」.
      for (const block of ['stone', 'iron_ore', 'diamond_ore', 'obsidian'] as const) {
        expect(yields(block, 'none')).toBe(false)
      }
    }),
  )

  // The CATEGORY is a speed axis and never a gate. Conflating the two is the bug
  // kernel's `block-harvest.ts` is shaped to prevent, and the reference gates on
  // tier alone at `block-service-break-helpers.ts:65,158`.
  it.effect('REGRESSION: the wrong tool FAMILY is slow, not fruitless', () =>
    Effect.sync(() => {
      // A wooden SHOVEL against a block that wants a pickaxe: the tier is what
      // is asked, and a wooden shovel is a wooden tier.
      expect(blockLoot(STONE, { heldTier: 'wooden' })).toStrictEqual([
        { item: 'cobblestone', count: 1 },
      ])
    }),
  )
})

describe('blockLoot — the deterministic half', () => {
  // The headline failure, and the one docs/testing.md §3-1 recorded.
  it.effect('REGRESSION: stone yields COBBLESTONE, not the block that was there', () =>
    Effect.sync(() => {
      expect(blockLoot(STONE, { heldTier: 'wooden' })).toStrictEqual([
        { item: 'cobblestone', count: 1 },
      ])
    }),
  )

  // The other half of the same failure, and the one nobody would notice.
  it.effect('REGRESSION: bare hands do not harvest stone', () =>
    Effect.sync(() => {
      expect(blockLoot(STONE, NO_TOOL)).toStrictEqual([])
      // ...and the default context is bare hands, so a caller that forgets is
      // refused rather than granted.
      expect(blockLoot(STONE)).toStrictEqual([])
    }),
  )

  it.effect('grass yields dirt, with no tool at all — a different drop is not a tool gate', () =>
    Effect.sync(() => {
      expect(blockLoot(GRASS_BLOCK, NO_TOOL)).toStrictEqual([{ item: 'dirt', count: 1 }])
    }),
  )

  it.effect('sand and gravel yield themselves, which is what the cascade’s mass check counts', () =>
    Effect.sync(() => {
      expect(blockLoot(SAND, NO_TOOL)).toStrictEqual([{ item: 'sand', count: 1 }])
      expect(blockLoot(GRAVEL, NO_TOOL)).toStrictEqual([{ item: 'gravel', count: 1 }])
    }),
  )

  // kernel's `count: 0` rows. The comment on `BlockDropRule` names ICE as the
  // reference's example; this build has none, and it has six others.
  it.effect('the count-zero rows yield nothing to anyone, whatever the tool', () =>
    Effect.sync(() => {
      const best = { heldTier: 'diamond', silkTouch: true, fortuneLevel: 3 } as const
      for (const id of [AIR, WATER, LAVA, OAK_LEAVES]) {
        expect(blockLoot(id, best, ALL_LUCK).filter((drop) => drop.item === blockTypeOfId(id))).toStrictEqual(
          [],
        )
      }
    }),
  )

  it.effect('glass needs silk touch, and yields itself when it has it', () =>
    Effect.sync(() => {
      expect(blockLoot(GLASS, { heldTier: 'diamond' })).toStrictEqual([])
      expect(blockLoot(GLASS, { silkTouch: true })).toStrictEqual([{ item: 'glass', count: 1 }])
    }),
  )

  it.effect('silk touch substitutes the harvested block for its normal drop', () =>
    Effect.sync(() => {
      expect(blockLoot(STONE, { heldTier: 'wooden', silkTouch: true })).toStrictEqual([
        { item: 'stone', count: 1 },
      ])
      expect(blockLoot(GRASS_BLOCK, { silkTouch: true })).toStrictEqual([
        { item: 'grass_block', count: 1 },
      ])
      expect(blockLoot(GLOWSTONE, { silkTouch: true }, NO_LUCK)).toStrictEqual([
        { item: 'glowstone', count: 1 },
      ])
    }),
  )

  it.effect('silk-touch substitution leaves normal drops unchanged', () =>
    Effect.sync(() => {
      expect(blockLoot(STONE, { heldTier: 'wooden' })).toStrictEqual([
        { item: 'cobblestone', count: 1 },
      ])
      expect(blockLoot(GRASS_BLOCK, NO_TOOL)).toStrictEqual([{ item: 'dirt', count: 1 }])
      expect(blockLoot(GLOWSTONE, NO_TOOL, NO_LUCK)).toStrictEqual([
        { item: 'glowstone_dust', count: 2 },
      ])
    }),
  )
})

describe('blockLoot — fortune', () => {
  // `<reference-impl>/packages/inventory/domain/enchantment.config.ts:46`.
  it.effect('carries the reference’s multipliers, including the two that repeat', () =>
    Effect.sync(() => {
      expect(FORTUNE_MULTIPLIERS.get(1)).toBe(1.33)
      expect(FORTUNE_MULTIPLIERS.get(2)).toBe(1.75)
      expect(FORTUNE_MULTIPLIERS.get(3)).toBe(2.5)
      // Levels 4 and 5 repeat level 3 in the reference. Trimming them would
      // silently change what an over-levelled tool does.
      expect(FORTUNE_MULTIPLIERS.get(4)).toBe(2.5)
      expect(FORTUNE_MULTIPLIERS.get(5)).toBe(2.5)
    }),
  )

  // `enchantment.ts:107-111`, and its comment is the specification: the
  // multiplier is the EXPECTED total, so the integer part is guaranteed and the
  // fractional part is the chance of one more. Fortune I must be a bonus about a
  // third of the time rather than `Math.round(1.33)` rounding to zero.
  it.effect('REGRESSION: fortune I is stochastic, not a rounded-down no-op', () =>
    Effect.sync(() => {
      // expectedExtra = 0.33, guaranteed = 0.
      expect(rollFortuneExtraDrops(1, 0.32)).toBe(1)
      expect(rollFortuneExtraDrops(1, 0.34)).toBe(0)
      expect(rollFortuneExtraDrops(1, 0.99)).toBe(0)

      // THE BOUNDARY IS NOT AT 0.33, and that is a fact about the reference's
      // arithmetic rather than about this port: `1.33 - 1` is
      // 0.33000000000000007 in a double, so a roll of exactly 0.33 is UNDER the
      // threshold and grants the bonus. Pinned rather than rounded away —
      // "fix" it to `Math.round(x * 100) / 100` and the drop rate moves by a
      // ten-thousandth for a reason nobody would find later.
      expect(1.33 - 1).toBeGreaterThan(0.33)
      expect(rollFortuneExtraDrops(1, 0.33)).toBe(1)
    }),
  )

  it.effect('fortune III guarantees one and rolls for the second', () =>
    Effect.sync(() => {
      // expectedExtra = 1.5, guaranteed = 1.
      expect(rollFortuneExtraDrops(3, 0.49)).toBe(2)
      expect(rollFortuneExtraDrops(3, 0.5)).toBe(1)
    }),
  )

  it.effect('level 0, a level with no row and a NaN roll all add nothing', () =>
    Effect.sync(() => {
      expect(rollFortuneExtraDrops(0, 0)).toBe(0)
      expect(rollFortuneExtraDrops(9, 0)).toBe(0)
      expect(rollFortuneExtraDrops(3, Number.NaN)).toBe(0)
    }),
  )

  // Glowstone is the ONE row in this build with `affectedByFortune`, so without
  // it the flag would be unreachable. Its base is 2 dust.
  it.effect('glowstone is the row fortune can act on, and it is folded into one stack', () =>
    Effect.sync(() => {
      expect(blockLoot(GLOWSTONE, NO_TOOL, NO_LUCK)).toStrictEqual([
        { item: 'glowstone_dust', count: 2 },
      ])
      // Fortune III: +1 guaranteed, +1 more on a roll under 0.5.
      expect(blockLoot(GLOWSTONE, { fortuneLevel: 3 }, [0])).toStrictEqual([
        { item: 'glowstone_dust', count: 4 },
      ])
    }),
  )

  it.effect('a block with no fortune flag is untouched by a fortune tool', () =>
    Effect.sync(() => {
      expect(blockLoot(SAND, { fortuneLevel: 3 }, ALL_LUCK)).toStrictEqual([
        { item: 'sand', count: 1 },
      ])
    }),
  )

  // Vanilla makes the two enchantments mutually exclusive and the reference
  // enforces it at the BREAK site rather than at the enchanting table
  // (`interaction-break-handler.execute.ts:131-134`: `!hasSilkTouch && fortune`).
  it.effect('REGRESSION: silk touch suppresses fortune — they are mutually exclusive', () =>
    Effect.sync(() => {
      expect(blockLoot(GLOWSTONE, { fortuneLevel: 3, silkTouch: true }, [0])).toStrictEqual([
        { item: 'glowstone', count: 1 },
      ])
    }),
  )
})

describe('blockLoot — bonus lines', () => {
  // `block-service.config.ts:222`. Two per cent.
  it.effect('leaves yield a stick 2% of the time and nothing else', () =>
    Effect.sync(() => {
      expect(LEAF_STICK_DROP_CHANCE).toBe(0.02)
      // The bonus line reads `rolls[1]`; `rolls[0]` is the fortune slot.
      expect(blockLoot(OAK_LEAVES, NO_TOOL, [0.5, 0.019, 0.5, 0.5])).toStrictEqual([
        { item: 'stick', count: 1 },
      ])
      expect(blockLoot(OAK_LEAVES, NO_TOOL, [0.5, 0.02, 0.5, 0.5])).toStrictEqual([])
    }),
  )

  // kernel's leaves row is `DROPS_NOTHING`, so a rule that gated the bonus on
  // the base drop would make the one shipped bonus entry unreachable. The
  // reference has the same independence: leaves and grass seeds are handled
  // outside the drop path, at `:114` and `:119`.
  it.effect('REGRESSION: the bonus runs even though the block itself drops nothing', () =>
    Effect.sync(() => {
      expect(dropOfBlockId(OAK_LEAVES)).toBeUndefined()
      expect(blockLoot(OAK_LEAVES, NO_TOOL, ALL_LUCK)).toStrictEqual([{ item: 'stick', count: 1 }])
    }),
  )

  // `!hasSilkTouch` at both of the reference's sites (`:106`, `:114`).
  it.effect('silk touch takes the block and shakes nothing loose', () =>
    Effect.sync(() => {
      expect(blockLoot(OAK_LEAVES, { silkTouch: true }, ALL_LUCK)).toStrictEqual([])
    }),
  )

  it.effect('a block with no bonus row yields only its base drop, however lucky', () =>
    Effect.sync(() => {
      expect(blockLoot(DIRT, NO_TOOL, ALL_LUCK)).toStrictEqual([{ item: 'dirt', count: 1 }])
    }),
  )

  it.effect('carries all four of the reference’s bonus rates', () =>
    Effect.sync(() => {
      expect(LEAF_APPLE_DROP_CHANCE).toBe(0.005)
      expect(LEAF_STICK_DROP_CHANCE).toBe(0.02)
      expect(LEAF_SAPLING_DROP_CHANCE).toBe(0.05)
      expect(GRASS_SEED_DROP_CHANCE).toBe(0.125)

      // ...and the fractions they are written as, which is how the reference
      // words its own assertion (`:139-141`: 1/200, 2%, 5%; `:163`: 1/8).
      expect(LEAF_APPLE_DROP_CHANCE).toBe(1 / 200)
      expect(LEAF_SAPLING_DROP_CHANCE).toBe(1 / 20)
      expect(GRASS_SEED_DROP_CHANCE).toBe(1 / 8)
    }),
  )

  it.effect('tall grass and fern yield one wheat seed below the one-in-eight boundary', () =>
    Effect.sync(() => {
      expect(ITEM_TYPES).toContain('wheat_seeds')
      expect(UNITEMISED_BLOCK_TYPES).not.toContain('tall_grass')
      expect(UNITEMISED_BLOCK_TYPES).not.toContain('fern')
      expect(blockLoot(TALL_GRASS, NO_TOOL, [0.5, GRASS_SEED_DROP_CHANCE - Number.EPSILON])).toStrictEqual([
        { item: 'wheat_seeds', count: 1 },
      ])
      expect(blockLoot(FERN, NO_TOOL, [0.5, GRASS_SEED_DROP_CHANCE - Number.EPSILON])).toStrictEqual([
        { item: 'wheat_seeds', count: 1 },
      ])
      expect(blockLoot(TALL_GRASS, NO_TOOL, [0.5, GRASS_SEED_DROP_CHANCE])).toStrictEqual([])
      expect(blockLoot(FERN, NO_TOOL, [0.5, GRASS_SEED_DROP_CHANCE])).toStrictEqual([])
    }),
  )

  it.effect('silk touch suppresses grass and fern seed bonuses', () =>
    Effect.sync(() => {
      expect(blockLoot(TALL_GRASS, { silkTouch: true }, ALL_LUCK)).toStrictEqual([])
      expect(blockLoot(FERN, { silkTouch: true }, ALL_LUCK)).toStrictEqual([])
    }),
  )
})

describe('blockLoot — the roll budget', () => {
  // FOUR, and a constant rather than a function of the block. See the rule's
  // header: a budget that varied would make each break's loot depend on which
  // blocks preceded it, so mining one extra dirt would change your glowstone.
  // The width is the reference's `rollLeafDrops`, which takes THREE rolls, so
  // restoring the apple and sapling lines the day kernel has the items is a
  // change to the table and NOT to this number.
  it.effect('is four rolls per broken block, whatever the block', () =>
    Effect.sync(() => {
      expect(BLOCK_LOOT_ROLLS).toBe(4)
    }),
  )

  // A short array reads as zeros, which PASS a chance gate. The rule's header
  // argues that direction deliberately: the only caller draws its budget, so an
  // all-zeros array means a test wrote one on purpose.
  it.effect('a missing roll reads as zero, which is the luckiest answer', () =>
    Effect.sync(() => {
      expect(blockLoot(OAK_LEAVES, NO_TOOL, [])).toStrictEqual([{ item: 'stick', count: 1 }])
    }),
  )

  // A count that is not a number must never reach an inventory. This is the
  // preview's finding F5 asked of a second arithmetic path.
  it.effect('REGRESSION: a NaN roll cannot produce a stack whose size is not a number', () =>
    Effect.sync(() => {
      const drops: ReadonlyArray<MinedItem> = blockLoot(
        GLOWSTONE,
        { fortuneLevel: 3 },
        [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
      )
      for (const drop of drops) {
        expect(Number.isInteger(drop.count)).toBe(true)
        expect(drop.count).toBeGreaterThan(0)
      }
    }),
  )
})

describe('the rule names no block, which is the point of the table', () => {
  // plan.md §3.1: the reference asked `blockTypeToIndex('SAND')` in 229 places
  // across 51 files, and that scatter is what made engine/content separation
  // impossible. `blockLoot` reads a byte and asks kernel; the ONE table it holds
  // of its own is the bonus lines, which kernel's `drops` field cannot express.
  it.effect('every block in kernel’s table resolves without a special case here', () =>
    Effect.sync(() => {
      const named: ReadonlyArray<BlockType> = ['stone', 'dirt', 'grass_block', 'glowstone', 'glass']
      for (const type of named) {
        const id = blockIdOf(type)
        expect(id).toBeDefined()
        // Every gate open — the best tool in the build — so the answer is the
        // table's and nothing else. `silkTouch` is part of "open": glass is the
        // one row that needs it.
        expect(
          blockLoot(id ?? 0, { heldTier: 'diamond', silkTouch: true }, NO_LUCK).length,
        ).toBeGreaterThan(0)
      }
    }),
  )
})
