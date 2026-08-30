/**
 * ONE RULE, ONE FILE (DN-GP-9): a rail one block up along the heading is a rail
 * the cart climbs onto.
 *
 * Ported from `<reference-impl>/packages/game/domain/rail-shape.ts:64-79`, whose
 * oracle is `packages/game/test/rail-shape.test.ts:60-71`.
 *
 * ---------------------------------------------------------------------------
 * THIS IS TOPOLOGY, AND THE SIGNATURE IS WHY IT DOES NOT LOOK LIKE IT
 * ---------------------------------------------------------------------------
 *
 * This is the symbol in the reference's `rail-shape.ts` that is hardest to
 * place, because it takes what the reference calls `vx, vz` — a VELOCITY — and
 * this repository holds no velocities (docs/responsibility.md §5). Read for what
 * it does with them:
 *
 *     const stepX = Math.abs(vx) >= Math.abs(vz) ? Math.sign(vx) : 0
 *     const stepZ = stepX === 0 ? Math.sign(vz) : 0
 *     return isRailAt(wx + stepX, wy + 1, wz + stepZ)
 *
 * `Math.sign` and one comparison of magnitudes. **The magnitude is discarded on
 * the first line and never reaches the answer.** Scale the pair by any positive
 * factor and the probe lands on the same cell, so the parameter is a HEADING,
 * not a speed, and what comes back is a fact about BLOCKS — `isRailAt` is the
 * only observation in the function and its result is returned unmodified.
 *
 * The parameters are named `headingX` / `headingZ` for that reason. A caller
 * passing a velocity is passing a legal heading and loses nothing; a caller with
 * only a facing direction can also call it, which against the reference's names
 * would have looked like a type error.
 *
 * SCALE INVARIANCE IS ASSERTED RATHER THAN CLAIMED. `test/rail.test.ts` runs the
 * same rail world at several positive multiples of one heading and requires one
 * answer. That test is the ownership argument in executable form: the day
 * somebody adds a term that reads the magnitude — a minimum speed to mount a
 * slope, say — it goes red, and the rule has to move or the term has to go.
 * mc-meshing's docs/responsibility.md §3.4 decided `lod-simplification.ts` by
 * asking which half took a distance; this is that question with a test behind it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DECIDE
 * ---------------------------------------------------------------------------
 *
 * HOW FAST THE CART CLIMBS. The reference answers that one line after this one —
 * `physVel.y = Math.max(physVel.y, RAIL_CLIMB_SPEED)`
 * (`game-state-update-orchestration.ts:300`) — and `RAIL_CLIMB_SPEED` is NOT in
 * this repository. docs/responsibility.md §5 records where it goes and why it
 * did not travel with the rule that triggers it.
 *
 * WHETHER THE CART IS ON A RAIL AT ALL, and whether it may leave. Both are the
 * caller's, for `./rail-shape.ts`'s stated precondition.
 *
 * DESCENDING. There is no `isDescendingAhead`, and there is none in the
 * reference either: a cart running off the top of a ramp falls, and falling is
 * gravity, which is mc-physics' `GRAVITY_Y` reached through mc-sim. Only the
 * climb needs a rule, because climbing is the direction gravity will not
 * produce.
 */
import type { IsRailAt } from './rail-shape.js'

/**
 * Below this, a heading is no heading at all and the cart does not climb.
 *
 * TRANSCRIBED, NOT JUSTIFIED. `rail-shape.ts:74` is the source and it carries no
 * measurement — the reference states `1e-9` and explains nothing. It is named
 * here rather than inlined twice so that the day somebody measures a real
 * deadband there is one line to change and one name to search for, and so that
 * the label on it is visible instead of being a bare literal that reads as
 * considered.
 *
 * It is stated as a magnitude on EACH AXIS, not on the resultant, which is the
 * reference's shape: a heading of `(9e-10, 9e-10)` is refused although its
 * length is larger than the bound. Pinned in `test/rail.test.ts` rather than
 * quietly improved, for docs/porting.md §4's reason.
 */
export const RAIL_HEADING_EPSILON = 1e-9

/**
 * Is there a rail one block UP, in the cell the heading points at?
 *
 * `wx, wy, wz` is the cart's current rail cell; the probe is the neighbour one
 * step along the dominant axis of the heading and one block higher.
 *
 * PURE, TOTAL and deterministic. Exactly ONE call to `isRailAt`, or none when
 * the guards refuse — a rule on the per-frame per-cart path should not probe the
 * world to answer a question about its own arguments.
 *
 * THE DOMINANT AXIS, AND TIES GO TO X. A heading of `(-3, 3)` probes west, not
 * south, because the test is `>=` and not `>` (`rail-shape.ts:75`). Nothing in
 * the reference records that a diagonal resolves at all, let alone which way, so
 * `test/rail.test.ts` pins it: a cart entering a bend at 45 degrees climbs the
 * east-west ramp and not the north-south one, and that is a decision somebody
 * can now disagree with rather than rediscover.
 *
 * NON-FINITE INPUTS DO NOT CLIMB — one guard the reference is missing, and the
 * direction it is missing in is the wrong one. `Math.abs(NaN) < 1e-9` is
 * `false`, so a `NaN` heading passes the reference's deadband; then
 * `Math.abs(NaN) >= Math.abs(vz)` is also `false`, so the rule silently decides
 * the cart is travelling along z and probes a cell it was never aimed at. That
 * is `domain/mob/enderman-teleport.ts`'s finding-F5 shape once more — a
 * non-number travelling through arithmetic that has no opinion about it — and
 * here it makes a broken measurement CLIMB. Refusing is the inert direction: a
 * cart that does not climb is visibly stuck, a cart that climbs a ramp it is not
 * on is a bug somewhere else entirely.
 */
export const isAscendingAhead = (
  isRailAt: IsRailAt,
  wx: number,
  wy: number,
  wz: number,
  headingX: number,
  headingZ: number,
): boolean => {
  if (
    !Number.isFinite(wx) ||
    !Number.isFinite(wy) ||
    !Number.isFinite(wz) ||
    !Number.isFinite(headingX) ||
    !Number.isFinite(headingZ)
  ) {
    return false
  }

  const alongX = Math.abs(headingX)
  const alongZ = Math.abs(headingZ)

  // Standing still. Not "no rail ahead" — there is no ahead.
  if (alongX < RAIL_HEADING_EPSILON && alongZ < RAIL_HEADING_EPSILON) {
    return false
  }

  const stepX = alongX >= alongZ ? Math.sign(headingX) : 0
  const stepZ = stepX === 0 ? Math.sign(headingZ) : 0

  return isRailAt(wx + stepX, wy + 1, wz + stepZ)
}
