/**
 * ONE RULE, ONE FILE (DN-GP-9): how hard a bow hits for how long it was held.
 *
 * Ported from `<reference-impl>/packages/entity/domain/bow-resolution.ts`, whose
 * constants are `<reference-impl>/packages/entity/domain/bow.config.ts` and whose
 * oracle is `<reference-impl>/packages/entity/test/bow-resolution.test.ts`.
 * docs/porting.md §4: move the tests first, do not reinvent the specification.
 *
 * ---------------------------------------------------------------------------
 * THE BOW IS NOT A PROJECTILE, AND THAT IS WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md §3-1 row 1 deferred the bow twice over. One of the two reasons
 * was measured and wrong:
 *
 *   > 弓とエンダーパールは**それに加えて**発射体なので mc-sim の名簿と
 *   > mc-physics の速度も要る。
 *
 * The reference spawns no arrow. `interaction-bow-handler.ts:200` says so in its
 * own comment — 「Hitscan: find the nearest entity in the crosshair within bow
 * range」 — and the line under it calls `findAttackableEntity`, the SAME function
 * the melee path calls, with `BOW_MAX_RANGE` in place of the player's reach. No
 * entity is created, nothing is integrated, and no velocity is ever written. The
 * only thing that flies is a decorative particle streak
 * (`interaction-bow-handler.ts:204-231`), drawn AFTER the damage has already been
 * applied and read by nobody.
 *
 * A category — 「発射体」, a thing that moves and therefore needs a roster and a
 * velocity — was checked against instead of a name, and a category cannot be
 * checked. `./throw-ender-pearl` records the same correction for the other half
 * of that sentence, and docs/testing.md §3-2 records two earlier instances.
 *
 * **The other reason was and remains correct**, so this file is a rule that the
 * frame can reach only halfway; see `../../stages/registration.ts` and
 * docs/responsibility.md §7-3 for exactly which halfway.
 *
 * ---------------------------------------------------------------------------
 * SECONDS, NOT TICKS — and that is the reference's shape, not a translation
 * ---------------------------------------------------------------------------
 *
 * Every bound here is in SECONDS, so a bow drawn for one second is fully drawn on
 * any machine. That is worth saying beside `../mob/enderman-teleport`'s
 * `ENDERMAN_STUCK_TELEPORT_TICKS`, which is the one number in `domain/` that is
 * frame-rate dependent and carries a paragraph apologising for it. This rule
 * needed no such apology and did not earn one: the reference already measured the
 * draw in seconds (`interaction-bow-handler.ts:172`, `nowSecs - chargeStartSecs`).
 */

/**
 * Shortest hold that fires at all, in seconds.
 *
 * `<reference-impl>/packages/entity/domain/bow.config.ts:3`, and the comparison
 * is INCLUSIVE — `canFireBow` is `secsHeld >= BOW_MIN_CHARGE_SECS`
 * (`bow-resolution.ts:19`).
 *
 * TRANSCRIBED, NOT JUSTIFIED. The reference's comment is 「must hold at least
 * this long to fire」, which restates the code rather than measuring anything.
 * Named here rather than inlined so that the label is visible instead of a bare
 * literal that reads as considered — `../vehicle/rail-ascent.ts`'s
 * `RAIL_HEADING_EPSILON` carries the same disclosure for the same reason
 * (docs/responsibility.md §5-4 requires it).
 */
export const BOW_MIN_CHARGE_SECS = 0.2

/**
 * Hold at least this long and the bow is fully drawn. `bow.config.ts:4`.
 *
 * TRANSCRIBED, NOT JUSTIFIED, though the reference's comment 「full charge at 1
 * second (vanilla ~1s draw)」 at least names an external source. This repository
 * cannot check that source, so it is recorded as a citation of vanilla and not as
 * a measurement anybody here made.
 */
export const BOW_FULL_CHARGE_SECS = 1.0

/** Damage at zero charge. `bow.config.ts:2`. */
export const BOW_MIN_DAMAGE = 1

/**
 * Damage at full charge. `bow.config.ts:1`.
 *
 * The reference's comment is 「vanilla: max ~4.5 hearts per shot」, and 9 damage
 * against `../death-cause.ts`'s `MAX_HEALTH_POINTS = 20` is indeed 4.5 hearts —
 * the one constant in this file whose comment can be checked from inside this
 * repository, and it checks out.
 */
export const BOW_MAX_DAMAGE = 9

/**
 * How far a shot reaches, in blocks. `bow.config.ts:5`.
 *
 * TRANSCRIBED. It is here rather than in `./bow-shot` because it is a property of
 * the WEAPON and not of the search — the search takes a reach as a parameter and
 * would take any other number just as happily (`./bow-shot`'s `shotTarget`).
 */
export const BOW_MAX_RANGE = 50

/**
 * How far a drawn bow got, in `[0, 1]`.
 *
 * TOTAL, and CLAMPED AT BOTH ENDS — the reference clamps only the top
 * (`bow-resolution.ts:8`, `Math.min(secsHeld / BOW_FULL_CHARGE_SECS, 1.0)`), so a
 * negative hold there yields a negative charge. Nothing downstream of it reads a
 * charge except `computeBowDamage`, which re-clamps to `[0, 1]` on its own line
 * (:13), so the divergence is invisible in the reference and its oracle does not
 * pin it (`test/bow-resolution.test.ts:15-36` tests 0, half, full and beyond, and
 * never a negative). Clamping here means the type of the return value is the
 * interval its name claims, and a caller that wants to display a draw meter
 * cannot be handed a negative one.
 *
 * A hold that is not a number is NO DRAW, which is the inert direction: an
 * unfired bow is visibly a bug, a bow that fires for full damage off a broken
 * clock is a bug somewhere else entirely. That is `../mob/enderman-teleport`'s
 * finding-F5 shape once more.
 */
export const bowCharge = (secsHeld: number): number => {
  if (!Number.isFinite(secsHeld)) {
    return 0
  }

  return Math.max(0, Math.min(1, secsHeld / BOW_FULL_CHARGE_SECS))
}

/**
 * Has it been held long enough to loose at all? `bow-resolution.ts:18-19`.
 *
 * INCLUSIVE at `BOW_MIN_CHARGE_SECS`, and TOTAL: `NaN >= 0.2` is `false`, so a
 * broken clock does not fire.
 *
 * Note that this is NOT `bowCharge(secsHeld) > 0`. The minimum hold and the full
 * draw are two different bounds and a tap between them fires for weak damage;
 * collapsing them would make every touch of the button a shot.
 */
export const canFireBow = (secsHeld: number): boolean =>
  Number.isFinite(secsHeld) && secsHeld >= BOW_MIN_CHARGE_SECS

/**
 * Everything about the bow that the damage depends on, beyond the draw.
 *
 * ONE OPTIONAL FIELD, and the shape is
 * `./block-loot.ts`'s `BlockLootContext` deliberately: a struct that is a
 * PARAMETER takes new members optionally, so a level that arrives later breaks no
 * call site (docs/versioning.md §5-2). Absent means level 0, which means no bonus.
 *
 * IT IS A LEVEL AND NOT AN ITEM. `BlockLootContext.fortuneLevel` already drew
 * this line and it is the line that lets this file exist at all: the rule needs to
 * know how strongly the bow is enchanted, not what the bow is CALLED, and what it
 * is called is the one thing kernel has no word for (`../item-vocabulary.ts` has
 * no `bow`). A rule keyed on the item's name would be unwritable today; a rule
 * keyed on the item's PROPERTIES is writable, testable and complete.
 */
export type BowDrawContext = {
  /** Level of Power on the bow. 0, absent or negative = none. */
  readonly powerLevel?: number
}

/** No enchantments — the bow a player crafts. */
export const PLAIN_BOW: BowDrawContext = {}

/**
 * The Power multiplier at a given level.
 *
 * `<reference-impl>/packages/inventory/domain/enchantment.ts:32-33`:
 * `1.0 + 0.25 * (level + 1)`.
 *
 * NOTE THE `+ 1`, which is not a transcription error on this side. At level 1 the
 * multiplier is 1.5 and at level 0 it is 1.25 — a bonus for an enchantment that
 * is not there. The reference never evaluates the level-0 case because
 * `resolveBowDamage` (`interaction-bow-handler.ts:58`) applies the multiplier only
 * when a `POWER` enchantment object EXISTS, so an absent Power is a skipped
 * multiplication rather than a multiplication by 1.25.
 *
 * That distinction is invisible in the reference and would not survive being
 * ported as a bare formula, so it is preserved structurally instead: level 0,
 * absent and negative all return exactly 1 here, and only a level of 1 or more
 * reaches the reference's expression. `test/bow.test.ts` pins the discontinuity
 * between level 0 (×1) and level 1 (×1.5), because a reader who simplifies this
 * to `1 + 0.25 * (level + 1)` gets a bow that is 25% stronger unenchanted and no
 * test would otherwise say so.
 */
export const bowPowerMultiplier = (powerLevel: number | undefined): number => {
  if (powerLevel === undefined || !Number.isFinite(powerLevel) || powerLevel < 1) {
    return 1
  }

  return 1.0 + 0.25 * (powerLevel + 1)
}

/**
 * What a shot at this draw takes off, in health points.
 *
 * QUADRATIC IN THE CHARGE (`bow-resolution.ts:14`):
 * `round(MIN + charge² · (MAX − MIN))`. Half a draw is a quarter of the way from
 * 1 to 9, which is 3 — not 5 — and that is the whole point of charging a bow. Its
 * oracle pins the arithmetic (`test/bow-resolution.test.ts:57-60`).
 *
 * ROUNDED, AND ROUNDED LAST. The reference rounds the base damage before applying
 * Power (`interaction-bow-handler.ts:58` rounds `computeBowDamage`'s result, then
 * rounds the product again), so a full-draw Power I shot there is
 * `round(round(9) * 1.5)` = 14. Rounding once at the end gives the same 14 here,
 * and differs from the reference only where the base damage is fractional before
 * rounding — which the quadratic makes possible at partial draws. The divergence
 * is at most one point and it is in the direction of the arithmetic the reference
 * meant; `test/bow.test.ts` pins the full-draw agreement rather than papering over
 * the partial-draw difference.
 *
 * TOTAL: a charge that is not a number is no charge, so a broken draw does
 * minimum damage rather than `NaN` damage. `../death-cause.ts`'s `applyDamage`
 * would turn a `NaN` into a health of `NaN`, which `isDead` reads as ALIVE — an
 * immortal mob, and the least debuggable outcome available.
 */
export const bowDamage = (charge: number, context: BowDrawContext = PLAIN_BOW): number => {
  const clamped = Number.isFinite(charge) ? Math.max(0, Math.min(1, charge)) : 0
  const base = BOW_MIN_DAMAGE + clamped * clamped * (BOW_MAX_DAMAGE - BOW_MIN_DAMAGE)

  return Math.round(base * bowPowerMultiplier(context.powerLevel))
}
