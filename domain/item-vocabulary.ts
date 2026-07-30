/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-kernel`'s `domain/item-type.ts`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * `ItemType` is kernel's, and kernel's header says why in the sentence that
 * matters most to this repository: the seven items it added last
 * (`coal` / `iron_ingot` / `flint` / `gunpowder` / `blaze_powder` /
 * `flint_and_steel` / `fire_charge`) each arrived with a kernel-side reason, and
 * two of them arrived with THIS one —
 *
 *     `gunpowder` / `blaze_powder`   mob drops (plan.md §3.11 gives the rules
 *                                    to mx-gameplay; the vocabulary is kernel's)
 *
 * So the split is already drawn and this file does not redraw it. `gunpowder`
 * is a NAME, and names belong to kernel; "a creeper drops nought to two of
 * them, more with looting" is a RULE, and rules are `domain/mob/mob-drop.ts`.
 *
 * WHEN mc-kernel IS PUBLISHED:
 *   1. add `@nerima-games/mc-kernel` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './item-vocabulary'` at `'@nerima-games/mc-kernel'`.
 *
 * It is NOT re-exported from `index.ts`, for the same reason `./frame-contract`,
 * `./position-key` and `./chunk-store-port` are not: re-exporting somebody
 * else's vocabulary would make the promised deletion a breaking change for
 * every consumer of mx-gameplay. `test/public-api.test.ts` pins that absence.
 *
 * ---------------------------------------------------------------------------
 * Why the whole roster is transcribed when one literal is used
 * ---------------------------------------------------------------------------
 *
 * A narrower mirror would still typecheck — `'gunpowder'` is assignable to
 * kernel's `ItemType` whatever else is in it, so this is a subset rather than a
 * fork, and step 3 above narrows rather than widens. The full list is here
 * because a transcription that is a SUBSET cannot be compared mechanically:
 * mc-dev-meta's `pnpm check:mirrors` is what caught `lava` missing from this
 * repository's `REPLACEABLE_IDS` (`./block-vocabulary`), and it caught it by
 * diffing a whole set against kernel's. A partial mirror answers "is it a
 * subset?", which is true of a stale mirror too.
 *
 * The direction the drift can hurt is one-way and worth stating: kernel ADDING
 * an item leaves this file stale and nothing else (a smaller union is still
 * assignable), while kernel REMOVING one this repository's rules name breaks on
 * deletion day — which is exactly the day it should break, loudly, with the
 * mirror still present to diff against.
 */

/**
 * kernel's `ITEM_TYPES`, transcribed. Order and spelling are kernel's, down to
 * the grouping, so that a reviewer can diff the two files rather than read them.
 */
export const ITEM_TYPES = [
  'stone',
  'cobblestone',
  'dirt',
  'grass_block',
  'sand',
  'gravel',
  'oak_log',
  'oak_planks',
  'oak_leaves',
  'glass',
  'torch',
  'glowstone',
  'piston',
  'stick',
  'bow',
  'arrow',
  'glowstone_dust',
  'wooden_pickaxe',
  'stone_pickaxe',
  'iron_pickaxe',
  'diamond_pickaxe',
  'wooden_hoe',
  'stone_hoe',
  'iron_hoe',
  'diamond_hoe',
  'coal',
  'iron_ingot',
  'flint',
  'gunpowder',
  'blaze_powder',
  'flint_and_steel',
  'fire_charge',
  'iron_helmet',
  'iron_chestplate',
  'iron_leggings',
  'iron_boots',
  'granite',
  'diorite',
  'andesite',
  'deepslate',
  'obsidian',
  'smooth_basalt',
  'calcite',
  'amethyst_block',
  'sandstone',
  'prismarine',
  'soul_sand',
  'coal_block',
  'iron_block',
  'gold_block',
  'diamond_block',
  'redstone_block',
  'lapis_block',
  'emerald_block',
  'redstone_torch',
  'lever',
  'stone_button',
  'repeater',
  'redstone_lamp',
  'observer',
  'comparator',
  'dispenser',
  'hopper',
  'end_stone',
  'end_portal_frame',
  'end_portal_frame_filled',
  'chorus_flower',
  'chorus_plant',
  'dragon_egg',
  'end_crystal',
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
  'oak_stairs',
  'anvil',
  'cauldron',
  'bed',
  'enchanting_table',
  'brewing_stand',
  'tnt',
  'nether_brick',
  'netherrack',
  'raw_iron',
  'raw_gold',
  'diamond',
  'emerald',
  'lapis_lazuli',
  'redstone_dust',
  'amethyst_shard',
  'wheat_seeds',
  'potato',
  'nether_wart',
  'ladder',
  'kelp',
  'seagrass',
  'rail',
  'powered_rail',
  'pressure_plate',
  'stone_slab',
  'string',
  'snowball',
  'sapling',
  'dandelion',
  'poppy',
  'brown_mushroom',
  'red_mushroom',
  'tall_grass',
  'fern',
  'sugar_cane',
  'cactus',
  'lily_pad',
] as const

export type ItemType = (typeof ITEM_TYPES)[number]
