/**
 * Vanilla mob loot and XP rules. Item IDs come from kernel; the frame layer
 * supplies rolls and casualty context.
 */
import { Brand } from 'effect'
import type { ItemType } from '@nerima-games/mc-kernel'
import type { EntityKind } from '@nerima-games/mc-sim'

/**
 * One line of a mob's loot, in kernel's vocabulary.
 *
 * Shaped after the reference's `EntityDrop`
 * (`packages/entity/domain/mob/drop.ts:3-13`) with one substitution: `item` is
 * an `ItemType`, where the reference had `blockType: InventoryItem`. That is the
 * same correction kernel made to `BlockDropRule` when `ItemType` arrived —
 * "the old spelling could express 'different block', never 'not a block'" — and
 * gunpowder is exactly a not-a-block.
 *
 * Without `chance`, a line always passes. Without `maxCount`, it uses `count`.
 */
export type MobDropRule = {
  readonly item: ItemType
  /** Base count. The whole count unless `maxCount` says otherwise. */
  readonly count: number
  /** Probability in `(0, 1]`. ABSENT means "always", not "never". */
  readonly chance?: number
  /** Upper end of a uniform inclusive roll over `[count, maxCount]`. */
  readonly maxCount?: number
  readonly playerKillOnly?: boolean
  readonly adultOnly?: boolean
  readonly babyOnly?: boolean
  readonly burningItem?: ItemType
  readonly size?: MobSize
  readonly minimumSize?: MobSize
  readonly chargedCreeperOnly?: boolean
}

/** What actually lands: a name and a number, and nothing that needs resolving. */
export type MobDrop = {
  readonly item: ItemType
  readonly count: number
}

/**
 * How the mob died, because it changes the answer.
 *
 * A creeper that detonates leaves NOTHING — no gunpowder and no experience. In
 * the reference that is not written down anywhere; it falls out of the order of
 * two files. `entity-manager-combat.ts:56-64` removes the detonating creeper
 * from the entity map and returns before the melee-and-drops path runs, so the
 * drop code never sees it. The behaviour is right (a creeper that blows itself
 * up drops nothing in vanilla either) and the mechanism is an accident: move the
 * removal three lines down and the rule changes with no test to notice.
 *
 * Here it is a case of the argument, so it is stated, and `test/mob.test.ts`
 * pins it next to the fuse test that produces the detonation.
 */
export type MobKill =
  /**
   * Killed by damage. `lootingLevel` is the enchantment level on the killing
   * weapon, 0 for none.
   */
  | {
      readonly _tag: 'Slain'
      readonly lootingLevel: number
      readonly playerKill?: boolean
      readonly age?: MobAge
      readonly size?: MobSize
      readonly burning?: boolean
      readonly killedByChargedCreeper?: boolean
    }
  /** The mob destroyed itself — a creeper that reached the end of its fuse. */
  | { readonly _tag: 'SelfDestruct' }

/** The two rolls one drop line can need, both in `[0, 1)`. */
export type DropRolls = {
  /** Tested against `chance`. Unused when the rule has no `chance`. */
  readonly chance: number
  /** Spreads the count over `[count, maxCount]`. Unused without a `maxCount`. */
  readonly count: number
}

export type MobAge = 'adult' | 'baby'
export type MobSize = 'small' | 'medium' | 'large'

type MobDropChoice = Readonly<{
  readonly item: ItemType
  readonly weight: number
  readonly count: number
  readonly maxCount?: number
  readonly burningItem?: ItemType
}>

type MobDropPool = Readonly<{
  readonly minSelections: number
  readonly maxSelections: number
  readonly chance?: number
  readonly playerKillOnly?: boolean
  readonly choices: ReadonlyArray<MobDropChoice>
}>

type MobDropTable = Readonly<{
  readonly rules: ReadonlyArray<MobDropRule>
  readonly pools?: ReadonlyArray<MobDropPool>
}>

export type MobExperienceRange = Readonly<{ readonly min: number; readonly max: number }>
export type MobExperienceRule = Readonly<{
  readonly adult: MobExperienceRange
  readonly baby?: MobExperienceRange
  readonly sizes?: Readonly<Partial<Record<MobSize, MobExperienceRange>>>
  readonly equipmentBonus?: MobExperienceRange
  readonly playerKillRequired?: boolean
  readonly dragonRespawn?: MobExperienceRange
}>

export type MobExperienceContext = Readonly<{
  readonly age?: MobAge
  readonly size?: MobSize
  readonly undroppedEquipmentCount?: number
  readonly equipmentRolls?: ReadonlyArray<number>
  readonly firstDragonDeath?: boolean
}>

export type MobDropRollSequence = ReadonlyArray<number> & Brand.Brand<'MobDropRollSequence'>
export type MobDropRollCount = number & Brand.Brand<'MobDropRollCount'>

const makeMobDropRollCount = Brand.nominal<MobDropRollCount>()

/** Rolls that take every "always" branch and the smallest count. */
export const LOWEST_ROLLS: DropRolls = { chance: 0, count: 0 }

/** A creeper drops zero to two gunpowder unless it self-destructs. */
export const CREEPER_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'gunpowder', count: 0, maxCount: 2 }]

/** A slain zombie drops zero to two rotten flesh. */
export const ZOMBIE_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'rotten_flesh', count: 0, maxCount: 2 },
]

const ZOMBIE_RARE_DROPS: MobDropPool = {
  minSelections: 1,
  maxSelections: 1,
  chance: 0.025,
  playerKillOnly: true,
  choices: [
    { item: 'iron_ingot', weight: 1, count: 1 },
    { item: 'carrot', weight: 1, count: 1 },
    { item: 'potato', weight: 1, count: 1, burningItem: 'baked_potato' },
  ],
}

/** Experience for killing a zombie. */
export const ZOMBIE_XP_REWARD = 5

/** A slain enderman drops zero or one ender pearl. */
export const ENDERMAN_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'ender_pearl', count: 0, maxCount: 1 },
]

/** Experience for killing an enderman. */
export const ENDERMAN_XP_REWARD = 5

/**
 * Experience for killing a creeper. `mobs/creeper.ts:17`.
 *
 * The AMOUNT is a rule and lives here; the player's experience TOTAL is state
 * and is mc-sim's (plan.md §7 puts 戦闘・体力・空腹・XP at sim for the state and
 * gameplay for the rules).
 */
export const CREEPER_XP_REWARD = 5

/** Supported ghast drops; the vanilla music disc drop has no kernel item ID. */
export const GHAST_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'ghast_tear', count: 0, maxCount: 1 },
  { item: 'gunpowder', count: 0, maxCount: 2 },
]

/** `mobs/ghast.ts:17`. */
export const GHAST_XP_REWARD = 5

/** Blaze rods are absent from kernel, so there is no supported blaze item drop. */
export const BLAZE_DROPS: ReadonlyArray<MobDropRule> = []

/** `mobs/blaze.ts:18`. Double a creeper's, for a mob half as common. */
export const BLAZE_XP_REWARD = 10

const COW_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'leather', count: 0, maxCount: 2, adultOnly: true },
  { item: 'beef', count: 1, maxCount: 3, adultOnly: true, burningItem: 'cooked_beef' },
]
const PIG_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'porkchop', count: 1, maxCount: 3, adultOnly: true, burningItem: 'cooked_porkchop' },
]
const SHEEP_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'wool', count: 1, adultOnly: true },
  { item: 'mutton', count: 1, maxCount: 2, adultOnly: true, burningItem: 'cooked_mutton' },
]
const CHICKEN_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'feather', count: 0, maxCount: 2, adultOnly: true },
  { item: 'chicken', count: 1, adultOnly: true, burningItem: 'cooked_chicken' },
]
const SKELETON_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'bone', count: 0, maxCount: 2 },
  { item: 'arrow', count: 0, maxCount: 2 },
]
const SPIDER_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'string', count: 0, maxCount: 2 },
  { item: 'spider_eye', count: 1, chance: 1 / 3, playerKillOnly: true },
]
const ZOMBIFIED_PIGLIN_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'rotten_flesh', count: 0, maxCount: 1 },
  { item: 'gold_nugget', count: 0, maxCount: 1 },
]
const BOGGED_DROPS = SKELETON_DROPS
const STRAY_DROPS = SKELETON_DROPS
const CAVE_SPIDER_DROPS = SPIDER_DROPS
const COW_LIKE_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'leather', count: 0, maxCount: 2, adultOnly: true },
  { item: 'beef', count: 1, maxCount: 3, adultOnly: true, burningItem: 'cooked_beef' },
]
const RABBIT_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'rabbit', count: 1, adultOnly: true, burningItem: 'cooked_rabbit' },
]
const COD_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'cod', count: 1, burningItem: 'cooked_cod' },
  { item: 'bone_meal', count: 1, chance: 0.05 },
]
const SALMON_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'salmon', count: 1, burningItem: 'cooked_salmon' },
  { item: 'bone_meal', count: 1, chance: 0.05 },
]
const MOOSHROOM_DROPS = COW_LIKE_DROPS
const STRIDER_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'string', count: 0, maxCount: 5 }]
const PARROT_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'feather', count: 1, maxCount: 2 }]
const SNOW_GOLEM_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'snowball', count: 0, maxCount: 15 }]
const TURTLE_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'seagrass', count: 0, maxCount: 2 }]
const ZOMBIE_HORSE_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'rotten_flesh', count: 2, maxCount: 3 },
]
const SKELETON_HORSE_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'bone', count: 0, maxCount: 2 }]
const IRON_GOLEM_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'iron_ingot', count: 3, maxCount: 5 },
  { item: 'poppy', count: 0, maxCount: 2 },
]
const LLAMA_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'leather', count: 0, maxCount: 2 }]
const VINDICATOR_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'emerald', count: 0, maxCount: 1, playerKillOnly: true },
]
const EVOKER_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'emerald', count: 0, maxCount: 1, playerKillOnly: true },
]
const HOGLIN_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'porkchop', count: 2, maxCount: 4, adultOnly: true, burningItem: 'cooked_porkchop' },
  { item: 'leather', count: 0, maxCount: 1, adultOnly: true },
]
const HUSK_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'rotten_flesh', count: 0, maxCount: 2 }]
const WITHER_SKELETON_DROPS: ReadonlyArray<MobDropRule> = [
  { item: 'coal', count: 0, maxCount: 1 },
  { item: 'bone', count: 0, maxCount: 2 },
  { item: 'wither_skeleton_skull', count: 1, chance: 0.025, playerKillOnly: true, chargedCreeperOnly: true },
]
const ZOGLIN_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'rotten_flesh', count: 1, maxCount: 3 }]
const WITCH_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'redstone_dust', count: 4, maxCount: 8 }]
const WITCH_POOL: MobDropPool = {
  minSelections: 1,
  maxSelections: 3,
  choices: [
    { item: 'glass_bottle', weight: 1, count: 0, maxCount: 2 },
    { item: 'glowstone_dust', weight: 1, count: 0, maxCount: 2 },
    { item: 'gunpowder', weight: 1, count: 0, maxCount: 2 },
    { item: 'spider_eye', weight: 1, count: 0, maxCount: 2 },
    { item: 'stick', weight: 2, count: 0, maxCount: 2 },
    { item: 'sugar', weight: 1, count: 0, maxCount: 2 },
  ],
}
const WITHER_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'nether_star', count: 1 }]

const FISH_CHOICES: ReadonlyArray<MobDropChoice> = [
  { item: 'cod', weight: 60, count: 0, maxCount: 1, burningItem: 'cooked_cod' },
  { item: 'salmon', weight: 25, count: 0, maxCount: 1, burningItem: 'cooked_salmon' },
  { item: 'pufferfish', weight: 13, count: 0, maxCount: 1 },
  { item: 'tropical_fish', weight: 2, count: 0, maxCount: 1 },
]
const GUARDIAN_FISH_POOL: MobDropPool = {
  minSelections: 1,
  maxSelections: 1,
  chance: 0.4,
  choices: FISH_CHOICES,
}
const ELDER_GUARDIAN_FISH_POOL: MobDropPool = { ...GUARDIAN_FISH_POOL, chance: 0.5 }
const POLAR_BEAR_FISH_POOL: MobDropPool = {
  minSelections: 1,
  maxSelections: 1,
  choices: [
    { item: 'cod', weight: 3, count: 0, maxCount: 2, burningItem: 'cooked_cod' },
    { item: 'salmon', weight: 1, count: 0, maxCount: 2, burningItem: 'cooked_salmon' },
  ],
}
const ZOMBIFIED_PIGLIN_RARE_POOL: MobDropPool = {
  minSelections: 1,
  maxSelections: 1,
  chance: 0.025,
  playerKillOnly: true,
  choices: [{ item: 'gold_ingot', weight: 1, count: 1 }],
}

export const MOB_DROP_TABLES: Readonly<Record<string, MobDropTable>> = {
  allay: { rules: [] },
  armadillo: { rules: [] },
  axolotl: { rules: [] },
  bat: { rules: [] },
  camel: { rules: [] },
  cat: { rules: [{ item: 'string', count: 0, maxCount: 2 }] },
  chicken: { rules: CHICKEN_DROPS },
  cod: { rules: COD_DROPS },
  cow: { rules: COW_DROPS },
  dolphin: { rules: [{ item: 'cod', count: 0, maxCount: 1, burningItem: 'cooked_cod' }] },
  donkey: { rules: [{ item: 'leather', count: 0, maxCount: 2, adultOnly: true }] },
  fox: { rules: [] },
  frog: { rules: [] },
  glow_squid: { rules: [] },
  horse: { rules: [{ item: 'leather', count: 0, maxCount: 2, adultOnly: true }] },
  mooshroom: { rules: MOOSHROOM_DROPS },
  mule: { rules: [{ item: 'leather', count: 0, maxCount: 2, adultOnly: true }] },
  ocelot: { rules: [] },
  parrot: { rules: PARROT_DROPS },
  pig: { rules: PIG_DROPS },
  pufferfish: { rules: [{ item: 'pufferfish', count: 1 }] },
  rabbit: { rules: RABBIT_DROPS },
  salmon: { rules: SALMON_DROPS },
  sheep: { rules: SHEEP_DROPS },
  skeleton_horse: { rules: SKELETON_HORSE_DROPS },
  sniffer: { rules: [] },
  squid: { rules: [] },
  strider: { rules: STRIDER_DROPS },
  tadpole: { rules: [] },
  tropical_fish: { rules: [{ item: 'tropical_fish', count: 1 }] },
  turtle: { rules: TURTLE_DROPS },
  villager: { rules: [] },
  wandering_trader: { rules: [] },
  zombie_horse: { rules: ZOMBIE_HORSE_DROPS },
  bee: { rules: [] },
  cave_spider: { rules: CAVE_SPIDER_DROPS },
  enderman: { rules: ENDERMAN_DROPS },
  goat: { rules: [] },
  iron_golem: { rules: IRON_GOLEM_DROPS },
  llama: { rules: LLAMA_DROPS },
  trader_llama: { rules: LLAMA_DROPS },
  panda: { rules: [] },
  piglin: { rules: [] },
  polar_bear: { rules: [], pools: [POLAR_BEAR_FISH_POOL] },
  snow_golem: { rules: SNOW_GOLEM_DROPS },
  spider: { rules: SPIDER_DROPS },
  wolf: { rules: [] },
  zombified_piglin: { rules: ZOMBIFIED_PIGLIN_DROPS, pools: [ZOMBIFIED_PIGLIN_RARE_POOL] },
  blaze: { rules: BLAZE_DROPS },
  bogged: { rules: BOGGED_DROPS },
  breeze: { rules: [] },
  creeper: { rules: CREEPER_DROPS },
  drowned: { rules: [{ item: 'rotten_flesh', count: 0, maxCount: 2 }] },
  elder_guardian: { rules: [], pools: [ELDER_GUARDIAN_FISH_POOL] },
  endermite: { rules: [] },
  evoker: { rules: EVOKER_DROPS },
  ghast: { rules: GHAST_DROPS },
  giant: { rules: [] },
  guardian: { rules: [], pools: [GUARDIAN_FISH_POOL] },
  hoglin: { rules: HOGLIN_DROPS },
  husk: { rules: HUSK_DROPS, pools: [ZOMBIE_RARE_DROPS] },
  magma_cube: { rules: [] },
  phantom: { rules: [] },
  piglin_brute: { rules: [] },
  pillager: { rules: [] },
  ravager: { rules: [] },
  shulker: { rules: [] },
  silverfish: { rules: [] },
  skeleton: { rules: SKELETON_DROPS },
  slime: { rules: [] },
  stray: { rules: STRAY_DROPS },
  vex: { rules: [] },
  vindicator: { rules: VINDICATOR_DROPS },
  warden: { rules: [] },
  witch: { rules: WITCH_DROPS, pools: [WITCH_POOL] },
  wither_skeleton: { rules: WITHER_SKELETON_DROPS },
  zoglin: { rules: ZOGLIN_DROPS },
  zombie: { rules: ZOMBIE_DROPS, pools: [ZOMBIE_RARE_DROPS] },
  zombie_villager: { rules: ZOMBIE_DROPS, pools: [ZOMBIE_RARE_DROPS] },
  ender_dragon: { rules: [] },
  wither: { rules: WITHER_DROPS },
}

const range = (min: number, max = min): MobExperienceRange => ({ min, max })
const ANIMAL_EXPERIENCE: MobExperienceRule = { adult: range(1, 3), baby: range(0) }
const HOSTILE_EXPERIENCE: MobExperienceRule = { adult: range(5), equipmentBonus: range(1, 3) }
const NO_EXPERIENCE: MobExperienceRule = { adult: range(0), baby: range(0) }

export const MOB_EXPERIENCE_RULES: Readonly<Record<string, MobExperienceRule>> = {
  allay: NO_EXPERIENCE,
  armadillo: ANIMAL_EXPERIENCE,
  axolotl: ANIMAL_EXPERIENCE,
  bat: NO_EXPERIENCE,
  camel: ANIMAL_EXPERIENCE,
  cat: ANIMAL_EXPERIENCE,
  chicken: ANIMAL_EXPERIENCE,
  cod: ANIMAL_EXPERIENCE,
  cow: ANIMAL_EXPERIENCE,
  dolphin: ANIMAL_EXPERIENCE,
  donkey: ANIMAL_EXPERIENCE,
  fox: ANIMAL_EXPERIENCE,
  frog: ANIMAL_EXPERIENCE,
  glow_squid: ANIMAL_EXPERIENCE,
  horse: ANIMAL_EXPERIENCE,
  mooshroom: ANIMAL_EXPERIENCE,
  mule: ANIMAL_EXPERIENCE,
  ocelot: ANIMAL_EXPERIENCE,
  parrot: ANIMAL_EXPERIENCE,
  pig: ANIMAL_EXPERIENCE,
  pufferfish: ANIMAL_EXPERIENCE,
  rabbit: ANIMAL_EXPERIENCE,
  salmon: ANIMAL_EXPERIENCE,
  sheep: ANIMAL_EXPERIENCE,
  skeleton_horse: ANIMAL_EXPERIENCE,
  sniffer: ANIMAL_EXPERIENCE,
  squid: ANIMAL_EXPERIENCE,
  strider: ANIMAL_EXPERIENCE,
  tadpole: NO_EXPERIENCE,
  tropical_fish: ANIMAL_EXPERIENCE,
  turtle: ANIMAL_EXPERIENCE,
  villager: NO_EXPERIENCE,
  wandering_trader: NO_EXPERIENCE,
  zombie_horse: ANIMAL_EXPERIENCE,
  bee: ANIMAL_EXPERIENCE,
  cave_spider: HOSTILE_EXPERIENCE,
  enderman: { adult: range(5) },
  goat: ANIMAL_EXPERIENCE,
  iron_golem: NO_EXPERIENCE,
  llama: ANIMAL_EXPERIENCE,
  trader_llama: ANIMAL_EXPERIENCE,
  panda: ANIMAL_EXPERIENCE,
  piglin: { adult: range(5), baby: range(5), equipmentBonus: range(1, 3) },
  polar_bear: ANIMAL_EXPERIENCE,
  snow_golem: NO_EXPERIENCE,
  spider: { adult: range(5) },
  wolf: ANIMAL_EXPERIENCE,
  zombified_piglin: { adult: range(5), baby: range(12), equipmentBonus: range(1, 3) },
  blaze: { adult: range(10) },
  bogged: HOSTILE_EXPERIENCE,
  breeze: { adult: range(10) },
  creeper: { adult: range(5) },
  drowned: { adult: range(5), baby: range(12), equipmentBonus: range(1, 3) },
  elder_guardian: { adult: range(10) },
  endermite: { adult: range(3) },
  evoker: { adult: range(10), equipmentBonus: range(1, 3) },
  ghast: { adult: range(5) },
  giant: { adult: range(5) },
  guardian: { adult: range(10) },
  hoglin: { adult: range(5), baby: range(5) },
  husk: { adult: range(5), baby: range(12), equipmentBonus: range(1, 3) },
  magma_cube: { adult: range(4), sizes: { small: range(1), medium: range(2), large: range(4) } },
  phantom: { adult: range(5) },
  piglin_brute: { adult: range(20), equipmentBonus: range(1, 3) },
  pillager: HOSTILE_EXPERIENCE,
  ravager: { adult: range(20), equipmentBonus: range(1, 3) },
  shulker: { adult: range(5) },
  silverfish: { adult: range(5) },
  skeleton: HOSTILE_EXPERIENCE,
  slime: { adult: range(4), sizes: { small: range(1), medium: range(2), large: range(4) } },
  stray: HOSTILE_EXPERIENCE,
  vex: HOSTILE_EXPERIENCE,
  vindicator: HOSTILE_EXPERIENCE,
  warden: { adult: range(5) },
  witch: HOSTILE_EXPERIENCE,
  wither_skeleton: HOSTILE_EXPERIENCE,
  zoglin: { adult: range(5), baby: range(5) },
  zombie: { adult: range(5), baby: range(12), equipmentBonus: range(1, 3) },
  zombie_villager: { adult: range(5), baby: range(12), equipmentBonus: range(1, 3) },
  ender_dragon: { adult: range(12000), dragonRespawn: range(500), playerKillRequired: false },
  wither: { adult: range(50) },
}

export const mobDropTableOfKind = (kind: EntityKind): MobDropTable =>
  MOB_DROP_TABLES[kind] ?? { rules: [] }

export const mobDropRulesOfKind = (kind: EntityKind): ReadonlyArray<MobDropRule> =>
  mobDropTableOfKind(kind).rules

export const mobExperienceRuleOfKind = (kind: EntityKind): MobExperienceRule =>
  MOB_EXPERIENCE_RULES[kind] ?? NO_EXPERIENCE

const experienceRangeFor = (
  reward: MobExperienceRule,
  context: MobExperienceContext,
): MobExperienceRange => context.firstDragonDeath === false && reward.dragonRespawn !== undefined
  ? reward.dragonRespawn
  : context.size === undefined
    ? context.age === 'baby' && reward.baby !== undefined ? reward.baby : reward.adult
    : reward.sizes?.[context.size] ??
      (context.age === 'baby' && reward.baby !== undefined ? reward.baby : reward.adult)

/** Random rolls a mob's selected experience range needs from the frame seed. */
export const mobExperienceRollBudgetOfKind = (
  kind: EntityKind,
  context: MobExperienceContext = {},
): Readonly<{ readonly base: boolean; readonly equipment: number }> => {
  const rule = mobExperienceRuleOfKind(kind)
  const selectedRange = experienceRangeFor(rule, context)
  const equipmentCount = rule.equipmentBonus === undefined
    ? 0
    : Math.max(0, Math.floor(context.undroppedEquipmentCount ?? 0))
  return {
    base: selectedRange.min < selectedRange.max,
    equipment: rule.equipmentBonus !== undefined && rule.equipmentBonus.min < rule.equipmentBonus.max
      ? equipmentCount
      : 0,
  }
}

/**
 * Clamp a roll into `[0, 1)`.
 *
 * A roll outside the interval is a caller bug, and this rule answers it with the
 * LEAST loot rather than with a count off the end of the range or a `NaN`. That
 * direction is chosen and not accidental: the preview's finding F5 is about a
 * `NaN` travelling through arithmetic that had no opinion about it, and a `NaN`
 * roll here would otherwise produce a `NaN` count — an item stack whose size is
 * not a number, arriving in mc-sim's inventory.
 */
const clampRoll = (roll: number): number =>
  Number.isFinite(roll) ? Math.min(0.999_999_999, Math.max(0, roll)) : 0

/**
 * Does a chance-gated drop pass?
 *
 * `packages/entity/domain/mob/drop.ts:14-16`, verbatim including the STRICT
 * comparison, which its oracle pins on both sides
 * (`packages/entity/test/mob/drop.test.ts`: `chance: 0.025` passes at 0.024 and
 * fails at exactly 0.025). An absent `chance` always passes — the reference
 * asserts that even at a roll of 1.
 */
export const dropPasses = (rule: MobDropRule, roll: number): boolean =>
  rule.chance === undefined || roll < rule.chance

/**
 * How many, before looting.
 *
 * `packages/app/application/frame/stages/interaction-mob-drops.ts:16-19`: a uniform INCLUSIVE
 * integer over `[count, maxCount]`, and the plain `count` when there is no
 * range. Reproduced with the roll passed in instead of read from the global
 * generator.
 */
const rollCount = (rule: MobDropRule, roll: number): number =>
  rule.maxCount !== undefined && rule.maxCount > rule.count
    ? rule.count + Math.floor(clampRoll(roll) * (rule.maxCount - rule.count + 1))
    : rule.count

/**
 * Looting stays on the kill input so GP8 can apply it without changing callers.
 * GP2 intentionally resolves only the base vanilla loot rule.
 */
export const rollMobDrop = (
  rule: MobDropRule,
  kill: MobKill,
  rolls: DropRolls,
): MobDrop | undefined => {
  if (kill._tag === 'SelfDestruct') {
    return undefined
  }

  const chargedCreeperDrop = rule.chargedCreeperOnly && kill.killedByChargedCreeper === true
  if (
    (rule.playerKillOnly && !kill.playerKill && !chargedCreeperDrop) ||
    (rule.adultOnly && kill.age === 'baby') ||
    (rule.babyOnly && kill.age !== 'baby') ||
    (rule.size !== undefined && kill.size !== rule.size) ||
    (rule.minimumSize !== undefined &&
      (kill.size === undefined || SIZE_ORDER[kill.size] < SIZE_ORDER[rule.minimumSize]))
  ) {
    return undefined
  }

  // The finiteness guard is INSIDE the `chance !== undefined` branch on
  // purpose. A roll that is not a number fails a gate — the inert direction,
  // since `NaN < 0.025` is already `false` and this only makes it deliberate —
  // but it must not affect a drop that never consults a roll at all. The
  // creeper's does not, so its gunpowder survives a caller with a broken
  // generator, which is the behaviour `test/mob.test.ts` enumerates.
  if (
    !chargedCreeperDrop &&
    rule.chance !== undefined &&
    (!Number.isFinite(rolls.chance) || !dropPasses(rule, rolls.chance))
  ) {
    return undefined
  }

  const count = rollCount(rule, rolls.count)

  return count <= 0
    ? undefined
    : { item: kill.burning && rule.burningItem !== undefined ? rule.burningItem : rule.item, count }
}

const SIZE_ORDER: Readonly<Record<MobSize, number>> = { small: 0, medium: 1, large: 2 }

/** Every line of a mob's loot at once. Drops that yield nothing are absent. */
export const rollMobDrops = (
  rules: ReadonlyArray<MobDropRule>,
  kill: MobKill,
  rollsFor: (index: number) => DropRolls,
): ReadonlyArray<MobDrop> =>
  rules.flatMap((rule, index) => {
    const drop = rollMobDrop(rule, kill, rollsFor(index))
    return drop === undefined ? [] : [drop]
  })

const rollWeightedChoice = (
  choices: ReadonlyArray<MobDropChoice>,
  roll: number,
): MobDropChoice | undefined => {
  const totalWeight = choices.reduce((total, choice) => total + choice.weight, 0)
  if (choices.length === 0 || totalWeight <= 0) return undefined

  let selected = clampRoll(roll) * totalWeight
  for (const choice of choices) {
    selected -= choice.weight
    if (selected < 0) return choice
  }
  return choices[choices.length - 1]
}

/** Resolves fixed drop lines and weighted selections from one mob table. */
export const rollMobTable = (
  table: MobDropTable,
  kill: MobKill,
  rolls: MobDropRollSequence,
): ReadonlyArray<MobDrop> => {
  const drops = [...rollMobDrops(table.rules, kill, (index) => ({
    chance: rolls[index * 2] ?? 0,
    count: rolls[index * 2 + 1] ?? 0,
  }))]
  let cursor = table.rules.length * 2

  for (const pool of table.pools ?? []) {
    const chanceRoll = pool.chance === undefined ? 0 : rolls[cursor++] ?? 0
    const countRoll = pool.maxSelections === pool.minSelections ? 0 : rolls[cursor++] ?? 0
    const selections = pool.minSelections + Math.floor(
      clampRoll(countRoll) * (pool.maxSelections - pool.minSelections + 1),
    )
    const eligible =
      kill._tag === 'Slain' &&
      (!pool.playerKillOnly || kill.playerKill === true) &&
      (pool.chance === undefined || (Number.isFinite(chanceRoll) && chanceRoll < pool.chance))

    for (let index = 0; index < pool.maxSelections; index += 1) {
      const choiceRoll = rolls[cursor++] ?? 0
      const itemCountRoll = rolls[cursor++] ?? 0
      if (!eligible || index >= selections) continue

      const choice = rollWeightedChoice(pool.choices, choiceRoll)
      if (choice === undefined) continue
      const count = rollCount(choice, itemCountRoll)
      if (count > 0) {
        drops.push({
          item: kill.burning && choice.burningItem !== undefined ? choice.burningItem : choice.item,
          count,
        })
      }
    }
  }

  return drops
}

export const dropRollsNeededForTable = (table: MobDropTable): MobDropRollCount =>
  makeMobDropRollCount(table.rules.length * 2 +
  (table.pools ?? []).reduce((total, pool) =>
    total +
      (pool.chance === undefined ? 0 : 1) +
      (pool.maxSelections === pool.minSelections ? 0 : 1) +
      pool.maxSelections * 2,
  0))

/**
 * Experience for a kill. `roll` is shared by the base range; callers that know
 * how many spawned equipment items survived may supply one roll per item.
 */
export const mobXpReward = (
  kill: MobKill,
  reward: number | MobExperienceRule,
  roll = 0,
  context: MobExperienceContext = {},
): number => {
  if (kill._tag === 'SelfDestruct') return 0
  if (typeof reward === 'number') {
    return Number.isFinite(reward) ? Math.max(0, reward) : 0
  }

  const selectedRange = experienceRangeFor(reward, context)
  const amount = rollRange(selectedRange, roll)
  const equipmentBonus = reward.equipmentBonus
  const equipmentCount = equipmentBonus === undefined
    ? 0
    : Math.max(0, Math.floor(context.undroppedEquipmentCount ?? 0))
  const equipmentXp = equipmentBonus === undefined
    ? 0
    : Array.from({ length: equipmentCount }, (_, index) =>
      rollRange(equipmentBonus, context.equipmentRolls?.[index] ?? roll),
    ).reduce((total, value) => total + value, 0)
  return amount + equipmentXp
}

const rollRange = (value: MobExperienceRange, roll: number): number =>
  value.min + Math.floor(clampRoll(roll) * (value.max - value.min + 1))
