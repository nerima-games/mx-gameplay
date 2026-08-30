/**
 * ONE RULE, ONE FILE (DN-GP-9): where an ender pearl puts you, and what it costs.
 *
 * Ported from
 * `<reference-impl>/packages/app/application/frame/stages/interaction-item-use-handler/ender-pearl.ts`,
 * whose oracle is that file's `.test.ts` sibling. docs/porting.md §4: move the
 * tests first, do not reinvent the specification.
 *
 * ---------------------------------------------------------------------------
 * THE PEARL IS NOT A PROJECTILE EITHER
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md §3-1 row 1 deferred this rule with the bow, in one sentence,
 * for one reason: 「弓とエンダーパールは**それに加えて**発射体なので mc-sim の
 * 名簿と mc-physics の速度も要る」. Read the reference's imports:
 *
 *     ender-pearl.ts:8   import type { TargetRayHit } from '...interaction-types.js'
 *     ender-pearl.ts:11  export const ENDER_PEARL_MAX_DISTANCE = 24
 *
 * A `TargetRayHit` is the result of a raycast the host has ALREADY done — the same
 * hit that decides which cell a block is placed against. The pearl is thrown at
 * whatever that ray struck, capped at 24 blocks, and the player is moved there in
 * the same frame (`ender-pearl.ts:67`, `setPlayerPosition`). Nothing is spawned,
 * nothing is integrated, and there is no arc: a pearl thrown at the sky lands
 * exactly 24 blocks along the line of sight, at whatever altitude that reaches.
 *
 * So the deferral was written from a CATEGORY — 「発射体」, a thing that flies —
 * and the category was never checked against the two files it covered. Neither one
 * flies. `./draw-bow`'s header records the same correction for the bow;
 * docs/testing.md §3-2 records the two earlier occasions this happened, and §3-1
 * row 1 now carries the count.
 *
 * **What that sentence got right was its FIRST clause**, which is a different
 * blocker and is still standing: `../item-vocabulary.ts` has no `ender_pearl`, so
 * this rule can be run but the item that triggers it cannot be named. See
 * `../../stages/registration.ts` and docs/responsibility.md §7-3.
 *
 * ---------------------------------------------------------------------------
 * A DISPLACEMENT, NOT A DESTINATION
 * ---------------------------------------------------------------------------
 *
 * `resolveEnderPearlTeleportTarget` returns an absolute `Position` built as
 * `position + direction · distance` (`ender-pearl.ts:29-33`). This file returns
 * the `direction · distance` part and leaves the addition to the caller, which is
 * `../mob/enderman-teleport`'s shape and it is chosen for that file's reason: the
 * anchor a teleport is measured from is a decision, and a function that performs
 * the addition internally hides which anchor it used. There the reference had two
 * call sites silently disagreeing about the anchor; here there is only one, and
 * the shape is kept anyway so that the two teleports in this repository are read
 * the same way.
 *
 * IT HAS A `y`, unlike the enderman's offset. The enderman's rule copies the
 * anchor's altitude and so has nothing to say about height; the pearl's direction
 * is the player's line of sight and its vertical component is the whole reason a
 * pearl gets you up a cliff.
 */
import type { DeathCause } from '../death-cause.js'

/**
 * Furthest a pearl carries, in blocks.
 *
 * `<reference-impl>/.../ender-pearl.ts:11`. TRANSCRIBED, NOT JUSTIFIED — the
 * reference states 24 and explains nothing. It is used as a cap on the ray hit's
 * distance AND as the distance when nothing was hit (:27), so a pearl thrown at
 * the open sky travels exactly as far as one thrown at a wall 24 blocks away.
 */
export const ENDER_PEARL_MAX_DISTANCE = 24

/**
 * What a pearl costs the thrower, in health points.
 *
 * `ender-pearl.ts:13`, applied at `:69` with the cause below. TRANSCRIBED.
 *
 * IT IS LIVE IN THE REFERENCE, which was worth checking rather than assuming:
 * `handleEnderPearlThrow` is called from `interaction-right-click-handler.ts:63`
 * on the ordinary right-click path, and the damage is inside the one branch that
 * runs whenever the player is not in creative. That distinguishes it from
 * `../mob/enderman-teleport.ts`'s `ENDERMAN_DAMAGE_TELEPORT_CHANCE`, which this
 * repository records as documenting an intention its only caller bypasses, and
 * from `./bow-shot.ts`'s note on `BOW_ATTACK_RADIUS`, which nothing reads at all.
 * Two of the reference's dead constants are on record here; these three are not
 * among them.
 *
 * Five points against `../death-cause.ts`'s `MAX_HEALTH_POINTS = 20` is a quarter
 * of the player's health per throw, so four pearls with no food kill.
 */
export const ENDER_PEARL_DAMAGE = 5

/**
 * How the death screen explains a pearl.
 *
 * `../death-cause.ts` owns the vocabulary and this names the member the pearl
 * uses, so that the rule and the cause cannot drift apart silently — the cause is
 * the one field of a `Damage` that no arithmetic would catch being wrong.
 */
export const ENDER_PEARL_DEATH_CAUSE: DeathCause = 'ender_pearl'

/**
 * Chance a throw also spawns an endermite.
 *
 * `ender-pearl.ts:12`, and the comparison is a HALF-OPEN BAND rather than a bare
 * `<`: `roll >= 0 && roll < 0.05` (`:37`). The lower bound is doing real work — it
 * rejects a negative roll, which a bare `<` would accept — and it is transcribed
 * rather than simplified for that reason.
 *
 * TRANSCRIBED, NOT JUSTIFIED as a number. LIVE, unlike the two dead constants
 * named under `ENDER_PEARL_DAMAGE`: its call site draws a real roll
 * (`ender-pearl.ts:72`) rather than passing a hard-coded one.
 */
export const ENDER_PEARL_ENDERMITE_SPAWN_CHANCE = 0.05

/**
 * A pearl's flight, as a displacement in blocks from where it was thrown.
 */
export type EnderPearlDisplacement = {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * How far along the line of sight the pearl lands, in blocks.
 *
 * `ender-pearl.ts:27`: the ray hit's distance when there was one, the maximum when
 * there was not, clamped into `[0, ENDER_PEARL_MAX_DISTANCE]` either way.
 *
 * `undefined` for `hitDistance` means NOTHING WAS HIT — the ray reached nothing
 * inside its own range — and the pearl flies the full distance. That is the
 * reference's `?? ENDER_PEARL_MAX_DISTANCE` and it is the permissive direction:
 * an unobstructed throw is the ordinary case.
 *
 * A NON-FINITE HIT DISTANCE IS TREATED AS NO HIT rather than clamped. The
 * reference's `Math.max(0, Math.min(NaN, 24))` is `NaN`, which then multiplies
 * every axis and teleports the player to `NaN` — out of the world, unrecoverably,
 * from one broken raycast. `Math.min(Infinity, 24)` is 24, so an infinite distance
 * already meant a full-range throw there; making a `NaN` mean the same thing is
 * the consistent reading and the only one that cannot lose a player.
 */
export const enderPearlDistance = (hitDistance: number | undefined): number => {
  if (hitDistance === undefined || !Number.isFinite(hitDistance)) {
    return ENDER_PEARL_MAX_DISTANCE
  }

  return Math.max(0, Math.min(hitDistance, ENDER_PEARL_MAX_DISTANCE))
}

/**
 * Where a pearl thrown along `(dirX, dirY, dirZ)` puts the thrower, relative to
 * where they stood.
 *
 * PURE and TOTAL. `undefined` means THE THROW DOES NOT MOVE ANYBODY.
 *
 * THE DIRECTION NEED NOT BE A UNIT VECTOR — it is normalised here, so the
 * magnitude does not reach the answer and the rule is scale-invariant under
 * positive factors (docs/responsibility.md §5-1). `test/ender-pearl.test.ts`
 * asserts it, as `test/rail.test.ts` does for `isAscendingAhead`.
 *
 * A DEGENERATE DIRECTION MOVES NOBODY, and this is a DIVERGENCE FROM THE
 * REFERENCE stated as one. `ender-pearl.ts:23-25` falls back to
 * `dz = -1` when the direction has no length:
 *
 *     const dz = length === 0 ? -1 : direction.z / length
 *
 * — so a player whose camera direction reads as zero is teleported 24 blocks due
 * north, having aimed at nothing. The `x` and `y` fallbacks are `0`, so the
 * fallback is not "stay put" but "throw north at full range", which no comment
 * explains and which is almost certainly meant to be a default facing rather than
 * a default throw. Refusing is the inert direction: a pearl that does nothing is a
 * pearl the player throws again.
 *
 * NON-FINITE INPUTS MOVE NOBODY, for the same reason and for
 * `../mob/enderman-teleport`'s finding-F5 one.
 */
export const enderPearlDisplacement = (
  dirX: number,
  dirY: number,
  dirZ: number,
  hitDistance: number | undefined,
): EnderPearlDisplacement | undefined => {
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY) || !Number.isFinite(dirZ)) {
    return undefined
  }

  const length = Math.hypot(dirX, dirY, dirZ)
  if (length <= 0) {
    return undefined
  }

  const distance = enderPearlDistance(hitDistance)

  return {
    x: (dirX / length) * distance,
    y: (dirY / length) * distance,
    z: (dirZ / length) * distance,
  }
}

/**
 * Does this throw also produce an endermite?
 *
 * `ender-pearl.ts:36-37`, transcribed including its lower bound — see
 * `ENDER_PEARL_ENDERMITE_SPAWN_CHANCE`.
 *
 * THE ROLL IS A PARAMETER, as in `../mob/mob-drop` and
 * `../mob/enderman-teleport`: there is no `Math.random()` anywhere in `domain/`,
 * `scripts/check-dependency-whitelist.ts` fails the build on one (DN-GP-8), and
 * `test/rules.test.ts` reads these sources to say so. The reference calls
 * `Math.random()` inline at its one call site (`:72`), which is why its pearls
 * cannot be replayed; `../frame-rolls.ts` is where the number comes from here.
 *
 * TOTAL: a roll that is not a number spawns nothing, which the transcribed lower
 * bound already gives for free (`NaN >= 0` is `false`).
 */
export const shouldSpawnEndermite = (roll: number): boolean =>
  roll >= 0 && roll < ENDER_PEARL_ENDERMITE_SPAWN_CHANCE
