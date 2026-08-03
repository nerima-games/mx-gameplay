/**
 * ONE RULE, ONE FILE (DN-GP-9): which way a blow shoves what it hit.
 *
 * Ported from `<reference-impl>/packages/entity/domain/combat-resolution.ts:111-119`
 * (`computeKnockback`) — the HALF of it that is a rule. The other half is a
 * velocity and is not here; §2 below is the argument, and it is the argument
 * docs/responsibility.md §5-1 made for `packages/game/domain/rail-shape.ts`,
 * applied a second time to a second file that had two concerns in it.
 *
 * ---------------------------------------------------------------------------
 * 1. WHAT THE REFERENCE'S FUNCTION ACTUALLY DOES
 * ---------------------------------------------------------------------------
 *
 *     export const computeKnockback = (dirX: number, dirZ: number): Vector3 => {
 *       const mag = Math.hypot(dirX, dirZ)
 *       if (mag === 0) return { x: 0, y: KNOCKBACK_VERTICAL_SPEED, z: 0 }
 *       return {
 *         x: (dirX / mag) * KNOCKBACK_HORIZONTAL_SPEED,
 *         y: KNOCKBACK_VERTICAL_SPEED,
 *         z: (dirZ / mag) * KNOCKBACK_HORIZONTAL_SPEED,
 *       }
 *     }
 *
 * Three decisions and two constants. The decisions: knockback is horizontal and
 * away from the attacker, its vertical part does not depend on the geometry at
 * all, and a point-blank hit — attacker and target on one vertical line — pops
 * straight up rather than dividing by zero. The constants are `5` and `4.2`
 * (`combat.config.ts:57-58`), both speeds.
 *
 * ---------------------------------------------------------------------------
 * 2. THE OWNERSHIP TEST, AND WHERE THIS FILE FALLS ON EACH SIDE OF IT
 * ---------------------------------------------------------------------------
 *
 * docs/responsibility.md §5-1 decides a symbol by asking 「速度の『大きさ』が
 * 答えに届くか」 — does the MAGNITUDE of a velocity reach the answer. Run the
 * table's rows against `computeKnockback` and it splits down the middle:
 *
 *   the DIRECTION      Its arguments are a difference of POSITIONS at the only
 *                      call site (`interaction-bow-handler.ts:122-125`,
 *                      `entity.position − camera.position`), not a velocity at
 *                      all — and the magnitude is destroyed on the first line by
 *                      `Math.hypot` and the division that follows. Scale the pair
 *                      by any positive factor and the answer is identical. That
 *                      is `isAscendingAhead`'s row exactly: velocity-SHAPED
 *                      arguments whose size does not reach the answer, so the
 *                      parameter is a heading and the result is a fact about
 *                      geometry. **mx-gameplay's, and written below.**
 *
 *   the two SPEEDS     `KNOCKBACK_HORIZONTAL_SPEED = 5` and
 *                      `KNOCKBACK_VERTICAL_SPEED = 4.2` are velocities outright.
 *                      That is `RAIL_CLIMB_SPEED = 3.5`'s row. **mx-gameplay's by
 *                      ownership, and NOT carried** — see §3.
 *
 * As with the rails, the split is not a split between repositories.
 * docs/responsibility.md §5-2 disposes of 「速度を出す側は mc-physics」 in three
 * ways that all apply here unchanged: mc-physics' own scope table hands combat
 * rules away, mc-physics cannot be imported from here at all (transitive closure),
 * and 「blocks/秒 だから物理」 points the wrong way in this organisation — a
 * tuning value in speed units is evidence for LEAVING mc-physics, not for
 * entering it. The line that exists is not ownership but REACH.
 *
 * ---------------------------------------------------------------------------
 * 3. WHY THE IMPULSE ITSELF IS NOT WRITTEN
 * ---------------------------------------------------------------------------
 *
 * Two reasons, and they are `projectMinecartVelocity`'s two (§5-3) with the nouns
 * changed.
 *
 * THERE IS NOWHERE TO PUT IT. An impulse needs something that accumulates one.
 * mc-sim's `EntityState` has three fields — `feetPosition`, `healthPoints`,
 * `behaviour` (`@nerima-games/mc-sim`) — and none of them is a velocity, the
 * same three-field observation §5-5 makes for the cart. The reference has a
 * dedicated `entityManager.applyKnockback` (`interaction-bow-handler.ts:128`) and
 * this repository's mirror of that service has no such member, because mc-sim has
 * no such member. Writing a displaced `feetPosition` instead is not the same rule:
 * that is a teleport, it has no duration, and deciding how a shove decays over
 * time is integration.
 *
 * THE TWO SPEEDS WOULD BE TRANSCRIPTION AND NOT MEASUREMENT, which
 * docs/responsibility.md §5-4 makes a reason on its own. `combat.config.ts:57-58`
 * carries no derivation for `5` or `4.2`, and unlike `RAIL_CLIMB_SPEED` — whose
 * claim was at least checkable in principle — there is not even a claim to check.
 * Carrying them would add two numbers that read as measured to a repository whose
 * §5-4 exists because it already has that problem.
 *
 * PUNCH GOES WITH THEM, and that is the finding worth recording. The reference
 * scales knockback for the Punch enchantment like this
 * (`interaction-bow-handler.ts:126-128`):
 *
 *     const punchBonus = getPunchKnockbackBonus(opts.hasPunch.level)  // 3 * level
 *     const mult = 1 + punchBonus / 5
 *
 * That `5` is `KNOCKBACK_HORIZONTAL_SPEED`, written as a bare literal. So the
 * "multiplier" is a bonus in SPEED units divided by a speed — it only looks
 * dimensionless, and it cannot be computed without the constant this file
 * declines to carry. Punch therefore belongs to the impulse and not to the
 * direction, and putting it here would have meant importing the speed through the
 * back door. `./draw-bow`'s `powerLevel` is the contrast: Power multiplies a
 * DAMAGE, damage is in health points, and health points are `../death-cause.ts`'s
 * and this repository's.
 *
 * ---------------------------------------------------------------------------
 * 4. WHAT ARRIVES ON THE DAY THE IMPULSE CAN BE WRITTEN
 * ---------------------------------------------------------------------------
 *
 * `knockbackImpulse(direction, punchLevel)` returning `{x, y, z}`, in this file,
 * built from the value below and the two constants — the direction does not
 * change shape. What has to exist first is a velocity field on mc-sim's roster,
 * which is the same missing thing §5-5's first row names for the cart. One row,
 * two rules.
 */

/**
 * Below this, an attacker and its target are on one vertical line.
 *
 * The reference tests `mag === 0` exactly (`combat-resolution.ts:113`), which is
 * true only for a difference of exactly zero and false for a target a
 * ten-thousandth of a block to the north — where the normalisation then produces a
 * full-strength shove in a direction that is pure floating-point noise. A deadband
 * is the same repair `../vehicle/rail-ascent.ts`'s `RAIL_HEADING_EPSILON` makes to
 * the same shape of comparison, and this is a DIVERGENCE FROM THE REFERENCE,
 * stated as one; `test/bow.test.ts` pins the band rather than the exact zero.
 *
 * TRANSCRIBED FROM A SIBLING, NOT MEASURED: it is `RAIL_HEADING_EPSILON`'s value,
 * chosen so that this repository has one deadband rather than two, and it is
 * stated on the resultant because that is what the comparison it replaces used.
 */
export const KNOCKBACK_EPSILON = 1e-9

/**
 * Which way a hit shoves, as a direction and nothing else.
 *
 * `Away` carries a UNIT horizontal vector: no speed, no `y`. The vertical part of
 * the reference's knockback is a constant that does not depend on the geometry,
 * so there is nothing for this rule to decide about it and it travels with the
 * speeds (see the header, §3).
 *
 * `StraightUp` is the degenerate case, kept as a TAG rather than as a zero vector.
 * A caller handed `{x: 0, z: 0}` has to rediscover that the two zeroes mean "pop
 * upwards" rather than "do not shove", and those are different instructions — the
 * reference's own comment calls it 「a straight-up pop so a point-blank hit still
 * produces feedback」, which is a decision, and a decision that reads as an
 * absence is one nobody will preserve.
 */
export type KnockbackDirection =
  /** Horizontally away from the attacker. `x` and `z` are a unit vector. */
  | { readonly _tag: 'Away'; readonly x: number; readonly z: number }
  /** Attacker and target on one vertical line: the shove is purely upward. */
  | { readonly _tag: 'StraightUp' }

const STRAIGHT_UP: KnockbackDirection = { _tag: 'StraightUp' }

/**
 * Which way to shove a target that was hit from `(dx, dz)` away.
 *
 * `dx` and `dz` are the horizontal offset FROM the attacker TO the target — the
 * direction the target should travel. At the reference's only call site that is
 * `entity.position − camera.position` (`interaction-bow-handler.ts:122-125`), so
 * the sign convention below is the reference's and not an inversion.
 *
 * PURE, TOTAL and deterministic. SCALE-INVARIANT under positive factors, which is
 * the ownership argument in executable form (docs/responsibility.md §5-1): the
 * magnitude is discarded, so a caller passing metres, blocks or a normalised pair
 * gets one answer. `test/bow.test.ts` runs the same offset at several positive
 * multiples and requires it, the way `test/rail.test.ts` does for
 * `isAscendingAhead`. Add a term that reads the magnitude — knockback resistance
 * scaled by distance, say — and that test goes red before the code lands, which is
 * the point of writing it this way.
 *
 * NON-FINITE OFFSETS POP STRAIGHT UP rather than producing a `NaN` direction. This
 * is the inert direction here: a shove with no horizontal part is a shove that
 * cannot fling a mob to an unpredictable place, and `Math.hypot(NaN, 0)` is `NaN`,
 * which fails the deadband comparison and would otherwise fall through to a
 * division producing `NaN` on both axes. `../mob/enderman-teleport`'s finding-F5
 * shape once more.
 */
export const knockbackDirection = (dx: number, dz: number): KnockbackDirection => {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
    return STRAIGHT_UP
  }

  const magnitude = Math.hypot(dx, dz)
  if (magnitude < KNOCKBACK_EPSILON) {
    return STRAIGHT_UP
  }

  return { _tag: 'Away', x: dx / magnitude, z: dz / magnitude }
}
