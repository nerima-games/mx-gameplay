/**
 * The kernel capability mirror is pinned against mc-kernel's real table.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists, and why it is not `chunk-store-mirror.test.ts`
 * ---------------------------------------------------------------------------
 *
 * `domain/block-vocabulary.ts` is a temporary local copy of declarations that
 * live in mc-kernel, and its header promises that deleting it and repointing
 * every import at `@nerima-games/mc-kernel` will typecheck. Every mirror in the
 * organisation has a `*-mirror.test.ts` that pins its transcription; this is
 * that file for the kernel-sourced block vocabulary, and mc-dev-meta's
 * `MIRROR_SPECS` now lists the module it covers.
 *
 * The assertions below were in `./chunk-store-mirror.test.ts` until the four
 * predicates moved. That was the wrong home and the wrongness was not cosmetic:
 * `domain/chunk-store-port.ts` mirrors MC-WORLDGEN, mc-worldgen exports none of
 * `fallsWhenUnsupported`, `isReplaceable`, `validSpawnSurface` or
 * `canSupportAttachments`, and so the repoint that file promises would have
 * deleted all four rather than repointing them. A test sitting in that file
 * looked like coverage of a promise it was not able to check.
 *
 * ---------------------------------------------------------------------------
 * What these assertions can and cannot see
 * ---------------------------------------------------------------------------
 *
 * They pin THE TRANSCRIPTION, not the source. mc-kernel is not a dependency of
 * this repository and cannot be until it is published, so nothing here can
 * compare a set against `capabilityOfBlockId`. That comparison is
 * mc-dev-meta's `pnpm check:mirrors`, which imports both packages and diffs the
 * accepted sets over every representable id — and it is the check that found
 * `lava` missing from `REPLACEABLE_IDS` while this repository stayed green.
 *
 * So the value of the assertions below is narrow and worth stating: they catch a
 * careless local edit, and they record WHY each membership is what it is, so
 * that the next person to "tidy" a negative list has to argue with a comment
 * first.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  BLOCK_TYPES,
  blockIdOf,
  blockOfPlaceableItem,
  canBlockStaySupported,
  canSupportAttachments,
  fallsWhenUnsupported,
  isReplaceable,
  isSupportSensitiveBlockId,
  NEEDS_ANY_SUPPORT,
  NEEDS_NO_SUPPORT,
  needsOneOf,
  supportRuleOfBlockId,
  validSpawnSurface,
  DEFAULT_BLOCK_DROP,
  DEFAULT_HARVEST_TOOL,
  itemOfBlock,
  PLACEABLE_ITEM_TYPES,
  resolveDrop,
  type BlockType,
} from '../src/domain/block-vocabulary'
import { ITEM_TYPES } from '../src/domain/item-vocabulary'

describe('the kernel capability mirror', () => {
  it.effect('does not leak into this package\'s published surface', () =>
    Effect.gen(function* () {
      // `index.ts` deliberately omits this module, exactly as it omits
      // `domain/chunk-store-port.ts` and `domain/frame-contract.ts`.
      // Re-exporting another repository's vocabulary would make deleting the
      // stand-in a breaking change for every consumer of mx-gameplay.
      const barrel = yield* Effect.promise(() => import('../src/index'))
      expect(Object.keys(barrel)).not.toContain('fallsWhenUnsupported')
      expect(Object.keys(barrel)).not.toContain('canSupportAttachments')
    }),
    30_000,
  )

  it.effect('reads capabilities, and knows about exactly the ids kernel says carry them', () =>
    Effect.sync(() => {
      // Transcribed from mc-kernel's `BLOCK_REGISTRY`: sand is 5, gravel is 8,
      // and they are the only two rows with `fallsWhenUnsupported`.
      expect(fallsWhenUnsupported(5)).toBe(true)
      expect(fallsWhenUnsupported(8)).toBe(true)
      expect(fallsWhenUnsupported(2)).toBe(false)
      expect(fallsWhenUnsupported(0)).toBe(false)

      // air, water AND lava. Not stone, and not glass — `replaceable` is not
      // "non-solid", which kernel's audit §4.9 spends a section on.
      //
      // Lava is here because it was MISSING, and this assertion could not see
      // that: it pins what the mirror transcribes, not what mc-kernel's registry
      // says. mc-dev-meta's `pnpm check:mirrors` found the disagreement by
      // importing both and diffing all 256 ids — that check is the one that
      // guards this set, and this one only guards against a careless local edit.
      expect(isReplaceable(0)).toBe(true)
      expect(isReplaceable(6)).toBe(true)
      expect(isReplaceable(11)).toBe(true)
      expect(isReplaceable(2)).toBe(false)
    }),
  )

  it.effect('validSpawnSurface is a NEGATIVE set, so it defaults to true like kernel’s', () =>
    Effect.sync(() => {
      // The capability whose kernel default is `true`
      // (`TRUE_BY_DEFAULT_CAPABILITY_FLAGS` — the reference stored
      // `NON_SPAWN_SURFACE_BLOCK_IDS` rather than the complement). Transcribing
      // the negative set is what makes the two properties below hold without a
      // second line of code.
      expect(validSpawnSurface(2)).toBe(true) // stone
      expect(validSpawnSurface(5)).toBe(true) // sand — falling, and still ground
      expect(validSpawnSurface(0)).toBe(false) // air
      expect(validSpawnSurface(6)).toBe(false) // water
      expect(validSpawnSurface(11)).toBe(false) // lava

      // kernel's audit §4.9: SOLID FOR COLLISION and still not a spawn surface.
      // If a future edit collapses this into a `solid` test, these two flip and
      // mobs start spawning in the canopy — the bug
      // `block-collision-predicates.ts:18-21` records from the other direction.
      expect(validSpawnSurface(10)).toBe(false) // oak_leaves
      expect(validSpawnSurface(13)).toBe(false) // glass

      // oak_log. This one was WRONG in both the mirror and kernel until the
      // reference was re-read: `NON_SPAWN_SURFACE_BLOCK_IDS` lists WOOD, and
      // `VILLAGE_NON_GROUND_IDS` lists it again. Nothing caught it because the
      // mirror check probed only `fallsWhenUnsupported` and `replaceable` — two
      // agreeing transcriptions of a third capability are not evidence.
      expect(validSpawnSurface(9)).toBe(false)

      // The blocks kernel's roster added that the reference's negative list
      // names. Spot-checked across the groups rather than exhaustively: the
      // exhaustive comparison is `pnpm check:mirrors`, which now probes this
      // capability over every representable id.
      expect(validSpawnSurface(18)).toBe(false) // ladder
      expect(validSpawnSurface(19)).toBe(false) // cobweb
      expect(validSpawnSurface(21)).toBe(false) // dandelion
      expect(validSpawnSurface(28)).toBe(false) // lily_pad
      expect(validSpawnSurface(33)).toBe(false) // cactus — collides, still not ground
      expect(validSpawnSurface(34)).toBe(false) // pressure_plate

      // ...and the ones the reference's list OMITS, which must stay `true`.
      // These are the assertions that fail if someone "completes" the negative
      // set by intuition: a rail is passable and is still, per the reference, a
      // legal place for a mob to stand.
      expect(validSpawnSurface(29)).toBe(true) // kelp
      expect(validSpawnSurface(30)).toBe(true) // seagrass
      expect(validSpawnSurface(31)).toBe(true) // rail
      expect(validSpawnSurface(32)).toBe(true) // powered_rail
      expect(validSpawnSurface(35)).toBe(true) // stone_slab
      expect(validSpawnSurface(120)).toBe(true) // soul_soil
      expect(validSpawnSurface(121)).toBe(false) // wither_skeleton_skull

      // Total, and defaulting to "ordinary opaque cube" exactly as kernel's
      // `capabilityOfBlockId` does for an id it cannot name.
      expect(validSpawnSurface(200)).toBe(true)
    }),
  )

  it.effect('canSupportAttachments is a SECOND negative set, and not the spawn one', () =>
    Effect.sync(() => {
      // The fourth capability, and the one whose absence from `MIRROR_SPECS`
      // exposed the whole defect: it had no probe row, so it was the only one of
      // the four that `pnpm check:mirrors` compared against mc-worldgen's barrel
      // rather than exempting — and mc-worldgen does not export it.
      //
      // kernel's second `true`-by-default flag (`BLOCK_CAPABILITY_DEFAULTS`),
      // transcribed as `NON_SUPPORTING_IDS` because the reference stores
      // `NON_SUPPORTING_BLOCK_TYPES` (`block-support.ts:47-61`).
      expect(canSupportAttachments(2)).toBe(true) // stone
      expect(canSupportAttachments(0)).toBe(false) // air — nothing to attach to
      expect(canSupportAttachments(6)).toBe(false) // water
      expect(canSupportAttachments(11)).toBe(false) // lava

      // THE ROW WHERE THE TWO NEGATIVE SETS PART, and the reason collapsing them
      // is forbidden. kernel's audit §4.9 names this pair: a mob may stand on
      // snow, and a torch may not be planted in it.
      expect(validSpawnSurface(7)).toBe(true)
      expect(canSupportAttachments(7)).toBe(false)

      // ...and the mirror image. Leaves, a log and glass are valid supports and
      // are not ground, so a `solid` test would get both columns wrong in
      // opposite directions.
      expect(canSupportAttachments(9)).toBe(true) // oak_log
      expect(canSupportAttachments(10)).toBe(true) // oak_leaves
      expect(canSupportAttachments(13)).toBe(true) // glass

      // The reference's `NON_SUPPORTING_BLOCK_TYPES` DOES contain rails and
      // cactus, where `NON_SPAWN_SURFACE_BLOCK_IDS` does not contain the rails.
      // Two lists, two memberships, transcribed rather than reasoned about.
      expect(canSupportAttachments(31)).toBe(false) // rail
      expect(canSupportAttachments(32)).toBe(false) // powered_rail
      expect(validSpawnSurface(31)).toBe(true) // ...and still legal ground

      // DELIBERATELY ABSENT from the negative set, so these stay `true`:
      // passable blocks the reference's list does not name.
      expect(canSupportAttachments(18)).toBe(true) // ladder
      expect(canSupportAttachments(19)).toBe(true) // cobweb
      expect(canSupportAttachments(29)).toBe(true) // kelp
      expect(canSupportAttachments(30)).toBe(true) // seagrass
      expect(canSupportAttachments(120)).toBe(true) // soul_soil
      expect(canSupportAttachments(121)).toBe(false) // wither_skeleton_skull

      // Total, defaulting to "ordinary opaque cube" for a byte this build cannot
      // name, exactly as `capabilityOfBlockId` does.
      expect(canSupportAttachments(200)).toBe(true)
    }),
  )
})

// ---------------------------------------------------------------------------
// supportRule — the fifth column, and the one that is NOT a boolean
// ---------------------------------------------------------------------------

/**
 * The twenty blocks with a non-default support rule, in kernel's registry
 * order. THE COMPLETE OVERRIDE SET, and completeness is the requirement rather
 * than thoroughness.
 *
 * This file's header and `domain/block-vocabulary.ts`'s both state why: a
 * transcription that is a SUBSET cannot be compared mechanically, because "is it
 * a subset?" is true of a stale mirror too. The 102 rows NOT here are absent
 * because kernel's table states overrides only, and their absence is itself the
 * assertion `supportRuleOfBlockId` returns `NEEDS_NO_SUPPORT` for them — which
 * the second test below checks over the whole roster rather than by sampling.
 */
const SUPPORT_SENSITIVE_NAMES: ReadonlyArray<BlockType> = [
  'torch',
  'sapling',
  'dandelion',
  'poppy',
  'brown_mushroom',
  'red_mushroom',
  'tall_grass',
  'fern',
  'sugar_cane',
  'lily_pad',
  'rail',
  'powered_rail',
  'cactus',
  'pressure_plate',
  'wheat_crop',
  'potato_crop',
  'nether_wart_crop',
  'redstone_wire',
  'redstone_torch',
  'wither_skeleton_skull',
]

describe('the supportRule mirror', () => {
  it.effect('transcribes kernel’s whole override set — all twenty, and nothing else', () =>
    Effect.sync(() => {
      const sensitive = BLOCK_TYPES.filter((type) => {
        const id = blockIdOf(type)
        return id !== undefined && isSupportSensitiveBlockId(id)
      })
      expect(sensitive).toStrictEqual(SUPPORT_SENSITIVE_NAMES)
      expect(sensitive.length).toBe(20)
    }),
  )

  it.effect('the other 102 blocks require nothing below, which is what an override table means', () =>
    Effect.sync(() => {
      const indifferent = BLOCK_TYPES.filter((type) => {
        const id = blockIdOf(type)
        return id !== undefined && !isSupportSensitiveBlockId(id)
      })
      expect(indifferent.length).toBe(102)
      expect(indifferent.length + SUPPORT_SENSITIVE_NAMES.length).toBe(BLOCK_TYPES.length)

      for (const type of indifferent) {
        expect(supportRuleOfBlockId(blockIdOf(type) ?? -1)).toStrictEqual(NEEDS_NO_SUPPORT)
        // "requires nothing" means it stays up over ANYTHING, air included.
        expect(canBlockStaySupported(blockIdOf(type) ?? -1, 0)).toBe(true)
      }
    }),
  )

  it.effect('the five per-block lists are transcribed with the reference’s exact membership', () =>
    Effect.sync(() => {
      const ruleOf = (type: BlockType) => supportRuleOfBlockId(blockIdOf(type) ?? -1)

      // `block-support.ts:78-81` — the three crops, farmland and nothing else.
      for (const crop of ['wheat_crop', 'potato_crop', 'nether_wart_crop'] as const) {
        expect(ruleOf(crop)).toStrictEqual(needsOneOf('farmland'))
      }
      // `block-support.ts:63-67,85-88` — the seven surface plants, one rule.
      for (const plant of [
        'sapling',
        'dandelion',
        'poppy',
        'brown_mushroom',
        'red_mushroom',
        'tall_grass',
        'fern',
      ] as const) {
        expect(ruleOf(plant)).toStrictEqual(needsOneOf('dirt', 'grass_block', 'farmland'))
      }
      // The three waterside plants, three different rules (`:68`, `:69`, `:84`).
      expect(ruleOf('sugar_cane')).toStrictEqual(needsOneOf('dirt', 'grass_block', 'sand', 'sugar_cane'))
      expect(ruleOf('cactus')).toStrictEqual(needsOneOf('sand', 'cactus'))
      expect(ruleOf('lily_pad')).toStrictEqual(needsOneOf('water'))
    }),
  )

  it.effect('the seven with NO reference rule take the fallback arm, and no list was invented for them', () =>
    Effect.sync(() => {
      // Their arm is an ABSENCE in the source — no entry between
      // `block-support.ts:75` and :89 — so `NEEDS_ANY_SUPPORT` is that absence
      // written down. All seven plausibly want "dirt or stone" and the reference
      // says only "anything that supports"; inventing the narrower rule would be
      // this repository fabricating content.
      for (const type of ['torch', 'redstone_torch', 'redstone_wire', 'pressure_plate', 'rail', 'powered_rail', 'wither_skeleton_skull'] as const) {
        expect(supportRuleOfBlockId(blockIdOf(type) ?? -1)).toStrictEqual(NEEDS_ANY_SUPPORT)
        // The defining property of the arm: it tracks `canSupportAttachments`.
        expect(canBlockStaySupported(blockIdOf(type) ?? -1, 2)).toBe(true) // stone
        expect(canBlockStaySupported(blockIdOf(type) ?? -1, 7)).toBe(false) // snow
      }
    }),
  )

  it.effect('every block a rule names has a row, so no rule is unsatisfiable', () =>
    Effect.sync(() => {
      const named = BLOCK_TYPES.flatMap((type) => {
        const rule = supportRuleOfBlockId(blockIdOf(type) ?? -1)
        return rule.kind === 'oneOf' ? [...rule.blocks] : []
      })
      for (const block of named) {
        // `blockIdOf` is PARTIAL in this mirror, so a rule naming a block with no
        // registry row would silently never be satisfiable.
        expect(blockIdOf(block)).toBeDefined()
      }
      expect([...new Set(named)].sort()).toStrictEqual([
        'cactus',
        'dirt',
        'farmland',
        'grass_block',
        'sand',
        'sugar_cane',
        'water',
      ])
    }),
  )

  it.effect('canBlockStaySupported is total in both bytes, with kernel’s asymmetry intact', () =>
    Effect.sync(() => {
      // An unknown block above requires nothing and stays.
      expect(canBlockStaySupported(200, 0)).toBe(true)
      expect(isSupportSensitiveBlockId(200)).toBe(false)
      expect(supportRuleOfBlockId(200)).toStrictEqual(NEEDS_NO_SUPPORT)

      // An unknown block BELOW reads as an ordinary cube, so it holds a torch —
      // and is a member of no list, so it floats no lily pad. Kernel states the
      // asymmetry and this mirror transcribes it rather than smoothing it.
      expect(canBlockStaySupported(blockIdOf('torch') ?? -1, 200)).toBe(true)
      expect(canBlockStaySupported(blockIdOf('lily_pad') ?? -1, 200)).toBe(false)
    }),
  )

  it.effect('does not leak into this package’s published surface either', () =>
    Effect.gen(function* () {
      const barrel = yield* Effect.promise(() => import('../src/index'))
      expect(Object.keys(barrel)).not.toContain('canBlockStaySupported')
      expect(Object.keys(barrel)).not.toContain('supportRuleOfBlockId')
    }),
  )
})

describe('the item form of a block, in both directions', () => {
  it.effect('`blockOfPlaceableItem` and `itemOfBlock` round-trip every placeable item', () =>
    Effect.sync(() => {
      // The function has no arithmetic in it at all — the work is in the type,
      // and the reason to assert on it is that the type is the claim. kernel
      // deliberately publishes no `blockOfItem(item: ItemType)` overload,
      // because answering `blockOfItem('stick')` means either a partial result
      // nobody checks or a lie; the caller has to prove placeability first, and
      // once it has, the answer cannot fail.
      //
      // So the assertion is the ROUND TRIP over the whole intersection rather
      // than a spot check: every placeable item is the block it places, and that
      // block's item form is the item again. A day when the two tables drift
      // apart is a day when a player places a block and gets a different one
      // back on breaking it.
      expect(PLACEABLE_ITEM_TYPES.length).toBeGreaterThan(0)

      for (const item of PLACEABLE_ITEM_TYPES) {
        const block = blockOfPlaceableItem(item)
        expect(block).toBe(item === 'redstone_dust' ? 'redstone_wire' : item)
        expect(itemOfBlock(block)).toBe(item)
        // And it is a block this build can actually put in the world.
        expect(blockIdOf(block)).toBeDefined()
      }

      expect(blockOfPlaceableItem('redstone_dust')).toBe('redstone_wire')
      expect(itemOfBlock('redstone_wire')).toBe('redstone_dust')
      expect(blockIdOf('soul_soil')).toBe(120)
      expect(blockIdOf('wither_skeleton_skull')).toBe(121)
      expect(PLACEABLE_ITEM_TYPES).toContain('soul_soil')
      expect(PLACEABLE_ITEM_TYPES).toContain('wither_skeleton_skull')
      expect(PLACEABLE_ITEM_TYPES).not.toContain('nether_star')
      expect(ITEM_TYPES.indexOf('soul_soil')).toBe(152)
      expect(ITEM_TYPES.indexOf('wither_skeleton_skull')).toBe(153)
      expect(ITEM_TYPES.indexOf('nether_star')).toBe(154)
      expect(resolveDrop(DEFAULT_HARVEST_TOOL, DEFAULT_BLOCK_DROP, 'soul_soil')).toStrictEqual({
        item: 'soul_soil',
        count: 1,
        affectedByFortune: false,
      })
      expect(resolveDrop(DEFAULT_HARVEST_TOOL, DEFAULT_BLOCK_DROP, 'wither_skeleton_skull')).toStrictEqual({
        item: 'wither_skeleton_skull',
        count: 1,
        affectedByFortune: false,
      })
    }),
  )

  it.effect('a `self` rule over a block with NO item form drops nothing, rather than a nameless item', () =>
    Effect.sync(() => {
      // The fourth way to get nothing, and the only one that is an ABSENCE
      // rather than a denial — `resolveDrop`'s own header lists it and nothing
      // asked for it. `'self'` is a sentinel meaning "whatever was broken", and
      // for `water`, `lava`, `bedrock`, `snow` and the rest of the 45
      // non-itemised blocks there is no whatever: kernel's audit §6-6 has `air`
      // as a sentinel rather than a thing, and the others simply have no item
      // form in this build.
      //
      // The failure this refuses is specific. `resolveDrop` returns
      // `{ item, count, affectedByFortune }`, so passing the absence through
      // would mint a `MinedItem` whose `item` is `undefined` — an inventory
      // stack of one nothing, which mc-sim would accept and a player would see.
      // Answering `undefined` makes it the same non-event as mining air.
      const nonItemised = BLOCK_TYPES.filter((block) => itemOfBlock(block) === undefined)
      expect(nonItemised.length).toBeGreaterThan(0)

      for (const block of nonItemised) {
        expect(resolveDrop(DEFAULT_HARVEST_TOOL, DEFAULT_BLOCK_DROP, block)).toBeUndefined()
      }

      // The control: the SAME rule over a block that does have an item form
      // yields that item, so the assertion above is about the block and not
      // about the rule.
      expect(resolveDrop(DEFAULT_HARVEST_TOOL, DEFAULT_BLOCK_DROP, 'dirt')).toStrictEqual({
        item: 'dirt',
        count: 1,
        affectedByFortune: false,
      })
    }),
  )
})
