/**
 * ONE RULE, ONE FILE (DN-GP-9): what a dead mob leaves behind.
 *
 * plan.md §7 gives mx-gameplay the mob row's 「AI・スポーン条件・ドロップ」, and
 * kernel's capability-flag audit §6-9 draws the same line one level down: random
 * drop rules belong with the RULES and not in the registry, because 「`drops`
 * では表現できない」. Kernel's own `BlockDrop` is built to that rule — it carries
 * `affectedByFortune` OUT as a flag rather than applying it, and says why:
 *
 *     Kernel is pure and deterministic — `StageRegistration.run` has error
 *     channel `never` and no source of randomness — so it reports the base count
 *     and the fact that fortune applies, and lets the rule that owns the RNG do
 *     the multiplication.
 *
 * This file is the mob-side twin of that sentence. `gunpowder` is a NAME and
 * names are kernel's (`../item-vocabulary`, mirroring `mc-kernel`'s
 * `domain/item-type.ts`, where the literal arrived with the note "mob drops —
 * plan.md §3.11 gives the rules to mx-gameplay; the vocabulary is kernel's").
 * "One, always, unless it blew itself up" is a RULE and it is here.
 *
 * ---------------------------------------------------------------------------
 * THE RULE OWNS THE ROLL AND STILL HAS NO RNG
 * ---------------------------------------------------------------------------
 *
 * Every function below takes its randomness as an ARGUMENT — a number in
 * `[0, 1)` — the way mc-worldgen threads a seed. There is no `Math.random()` in
 * `domain/`, and `test/mob.test.ts` asserts that by reading the source rather
 * than by trusting this paragraph, in the same spirit as DN-GP-8's ban on
 * `Date.now()`.
 *
 * The reference splits it the same way and is worth quoting as evidence that the
 * split survives contact: its domain layer is pure (`dropPasses(drop, roll)`,
 * `packages/entity/domain/mob/drop.ts:14-16`) and `Math.random()` appears only
 * in the application layer that calls it
 * (`interaction-melee-handler.ts:185`, `interaction-mob-drops.ts:16-19`). What
 * it does NOT have is a seed: those calls read the global generator, so its
 * drop behaviour cannot be replayed. Threading the roll all the way out is what
 * makes a scenario test an oracle (plan.md §5.1-3), and it costs one parameter.
 *
 * For the creeper specifically the parameter is never even consulted: one
 * gunpowder, always, no `chance` and no `maxCount`
 * (`packages/entity/domain/mob/mobs/creeper.ts:15`). Nothing about this mob is
 * random — not the fuse, not the blast, not the drop. The rolls exist for the
 * seven roster entries that do have a `chance`, and taking them now is cheaper
 * than retrofitting determinism onto a signature later.
 */
import type { ItemType } from '../item-vocabulary'

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
 * Both optional members are absent for the creeper, and an absent one means the
 * boring answer, so its rule reads as the two fields that carry information.
 */
export type MobDropRule = {
  readonly item: ItemType
  /** Base count. The whole count unless `maxCount` says otherwise. */
  readonly count: number
  /** Probability in `(0, 1]`. ABSENT means "always", not "never". */
  readonly chance?: number
  /** Upper end of a uniform inclusive roll over `[count, maxCount]`. */
  readonly maxCount?: number
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
  | { readonly _tag: 'Slain'; readonly lootingLevel: number }
  /** The mob destroyed itself — a creeper that reached the end of its fuse. */
  | { readonly _tag: 'SelfDestruct' }

/** The two rolls one drop line can need, both in `[0, 1)`. */
export type DropRolls = {
  /** Tested against `chance`. Unused when the rule has no `chance`. */
  readonly chance: number
  /** Spreads the count over `[count, maxCount]`. Unused without a `maxCount`. */
  readonly count: number
}

/** Rolls that take every "always" branch and the smallest count. */
export const LOWEST_ROLLS: DropRolls = { chance: 0, count: 0 }

/**
 * What a creeper drops.
 *
 * `packages/entity/domain/mob/mobs/creeper.ts:15`:
 * `drops: [{ blockType: 'GUNPOWDER', count: 1 }]` — exactly one, always, with
 * no chance gate and no count range.
 */
export const CREEPER_DROPS: ReadonlyArray<MobDropRule> = [{ item: 'gunpowder', count: 1 }]

/**
 * Experience for killing a creeper. `mobs/creeper.ts:17`.
 *
 * The AMOUNT is a rule and lives here; the player's experience TOTAL is state
 * and is mc-sim's (plan.md §7 puts 戦闘・体力・空腹・XP at sim for the state and
 * gameplay for the rules).
 */
export const CREEPER_XP_REWARD = 5

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
 * Extra items from Looting.
 *
 * The reference re-spawns each already-rolled drop a second time with
 * `count = lootingEnchant.level` (`interaction-melee-handler.ts:180-200`), so
 * the total is base + level. That is not vanilla's rule (vanilla rolls an extra
 * `0..level`), and it is ported rather than corrected because docs/porting.md §4
 * says the reference is the specification and a silent "fix" to a drop rate is
 * the kind of change that should arrive with a measurement.
 *
 * A negative or non-finite level adds nothing.
 */
const lootingBonus = (kill: MobKill): number =>
  kill._tag === 'Slain' && Number.isFinite(kill.lootingLevel)
    ? Math.max(0, Math.floor(kill.lootingLevel))
    : 0

/**
 * Resolve one drop line. TOTAL, with `undefined` meaning "nothing from this
 * line" — the same convention kernel's `resolveDrop` uses for blocks, and for
 * the same reason: nothing is an answer, not a count of zero.
 */
export const rollMobDrop = (
  rule: MobDropRule,
  kill: MobKill,
  rolls: DropRolls,
): MobDrop | undefined => {
  if (kill._tag === 'SelfDestruct') {
    return undefined
  }

  // The finiteness guard is INSIDE the `chance !== undefined` branch on
  // purpose. A roll that is not a number fails a gate — the inert direction,
  // since `NaN < 0.025` is already `false` and this only makes it deliberate —
  // but it must not affect a drop that never consults a roll at all. The
  // creeper's does not, so its gunpowder survives a caller with a broken
  // generator, which is the behaviour `test/mob.test.ts` enumerates.
  if (
    rule.chance !== undefined &&
    (!Number.isFinite(rolls.chance) || !dropPasses(rule, rolls.chance))
  ) {
    return undefined
  }

  const count = rollCount(rule, rolls.count) + lootingBonus(kill)

  return count <= 0 ? undefined : { item: rule.item, count }
}

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

/**
 * Experience for a kill.
 *
 * Zero for a self-destruct, for the reason `MobKill` records: the reference's
 * detonating creeper is removed before the path that awards it, so it grants
 * none. A mob killed with Looting still grants its plain reward — looting is a
 * loot enchantment and the reference does not apply it to experience.
 */
export const mobXpReward = (kill: MobKill, reward: number): number =>
  kill._tag === 'SelfDestruct' || !Number.isFinite(reward) ? 0 : Math.max(0, reward)
