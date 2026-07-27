/**
 * ONE RULE, ONE FILE (DN-GP-9): what a loosed arrow hits.
 *
 * Ported from `<reference-impl>/packages/app/application/frame/stages/attack-targeting.ts`
 * (the search) and `interaction-bow-handler.ts:67-94` (the terrain check), which
 * is where the reference's bow does its aiming. `./draw-bow` is how hard the shot
 * lands; this is whether it lands at all.
 *
 * ---------------------------------------------------------------------------
 * A CYLINDER AROUND THE CROSSHAIR, WHICH IS NOT WHAT THE COMMENTS SAY
 * ---------------------------------------------------------------------------
 *
 * The search is `attack-targeting.ts:29-46` unchanged: project each entity onto
 * the aim ray, reject anything behind the player or past the reach, reject
 * anything further than a fixed radius from the ray, and keep the nearest of what
 * is left. That is a CYLINDER of radius `BOW_TARGET_RADIUS` and length
 * `BOW_MAX_RANGE`, capped at each end — not a cone, so a mob 40 blocks away is
 * hit only within 0.9 blocks of the line, which at that distance is a far finer
 * aim than the crosshair suggests.
 *
 * NO BOUNDING BOX IS CONSULTED, by the reference or here. An entity is a point
 * plus `BOW_TARGET_CENTER_Y_OFFSET`, so a shot passes through a creeper's shoulder
 * and hits the skeleton behind it. mc-sim's `EntityState` carries no extent to do
 * better with (`../entity-manager-port.ts`: `feetPosition` / `healthPoints` /
 * `behaviour`), so this is a limit of the roster rather than of the rule, and it
 * is recorded rather than guessed around.
 *
 * ---------------------------------------------------------------------------
 * `BOW_ATTACK_RADIUS = 0.9` IS DEAD IN THE REFERENCE, AND ITS DEATH IS INVISIBLE
 * ---------------------------------------------------------------------------
 *
 * `<reference-impl>/packages/entity/domain/bow.config.ts:6` declares
 *
 *     export const BOW_ATTACK_RADIUS = 0.9 // cylinder radius for crosshair targeting
 *
 * and **nothing reads it.** The bow's own handler calls `findAttackableEntity`,
 * which closes over `PLAYER_ATTACK_RADIUS` (`attack-targeting.ts:25`) — the MELEE
 * radius, from a different config file. The bow's radius is passed nowhere and the
 * function takes no parameter for it.
 *
 * The reason nobody noticed is that both constants are `0.9`
 * (`frame-handler.config.ts:62` and `bow.config.ts:6`), so the dead one and the
 * live one agree and the defect has no symptom whatever. Change either and the
 * bow keeps the melee number.
 *
 * This is the same shape as `../mob/enderman-teleport.ts`'s
 * `ENDERMAN_DAMAGE_TELEPORT_CHANCE` — a constant that documents an intention
 * rather than a behaviour, because its only would-be caller bypasses it — and it
 * is the second one found in the reference. The name below is `BOW_TARGET_RADIUS`
 * rather than either of the reference's, because it is neither: it is the number
 * the bow ACTUALLY uses, cited to the line that supplies it, and `test/bow.test.ts`
 * pins that this repository's bow and melee radii are free to differ.
 */
import type { EntityId, Position } from '../entity-manager-port'
import { BOW_MAX_RANGE } from './draw-bow'

/**
 * Radius of the targeting cylinder, in blocks.
 *
 * `<reference-impl>/packages/app/application/frame-handler.config.ts:62`
 * (`PLAYER_ATTACK_RADIUS`), which is the value the bow's search actually closes
 * over — NOT `bow.config.ts:6`'s identically-valued `BOW_ATTACK_RADIUS`, which
 * nothing reads. See the module header.
 *
 * TRANSCRIBED, NOT JUSTIFIED. Neither declaration carries a measurement.
 */
export const BOW_TARGET_RADIUS = 0.9

/**
 * How far above its feet an entity is aimed at, in blocks.
 *
 * `<reference-impl>/packages/app/application/frame-handler.config.ts:64`
 * (`ENTITY_CENTER_Y_OFFSET`). TRANSCRIBED.
 *
 * THE REFERENCE DECLARES THIS THREE TIMES — the config above, plus private copies
 * at `interaction-bow-handler.ts:63` and `redstone-dispenser-world-effects.ts:28`,
 * all `0.9`. Three declarations of one number is three places for it to drift, and
 * this file is the one place it exists here.
 *
 * IT IS NOT `BOW_TARGET_RADIUS`, although both are `0.9`. One is a height above
 * the feet and the other is a distance from a line; they are equal by coincidence
 * and giving them one name would make a change to either a change to both.
 */
export const BOW_TARGET_CENTER_Y_OFFSET = 0.9

/**
 * The least an aim direction may measure before it is no direction at all.
 *
 * Not the reference's — it normalises with `THREE.Vector3.normalize()`, which
 * divides by a zero length and yields `(0, 0, 0)`, after which every entity's
 * `alongRay` is `0` and the nearest one within the radius is hit regardless of
 * where the player is looking. This repository refuses instead; see `shotTarget`.
 *
 * The bound is on the SQUARED length, so it is `RAIL_HEADING_EPSILON` squared —
 * `../vehicle/rail-ascent.ts` states its deadband per axis for the reference's
 * reasons, and this one is stated on the resultant because a direction's length
 * is the only thing this rule asks of it.
 */
export const BOW_AIM_EPSILON_SQUARED = 1e-18

/**
 * Anything with a place in the world that an arrow could hit.
 *
 * Structurally a subset of `../entity-manager-port.ts`'s `Entity<S>`, so a roster
 * read passes straight in with no projection and no copy — which matters because
 * `EntityManagerApi.entities` resolves to the roster's OWN array and this rule
 * runs on the shot path.
 */
export type ShotCandidate = {
  readonly id: EntityId
  readonly feetPosition: Position
}

/**
 * Does a block stop an arrow at this cell?
 *
 * INJECTED, exactly as `../vehicle/rail-shape.ts`'s `IsRailAt` is, and for the
 * three reasons that file gives: the rule stays pure and totally testable, the
 * caller decides how to batch the reads, and this repository never names a block
 * id (plan.md §3.4). The reference instead calls `isPassableBlockType` on a value
 * it fetches per step from the chunk manager
 * (`interaction-bow-handler.ts:83-88`), which is the per-cell store call
 * `../chunk-window.ts`'s header records this repository having already rejected
 * once — 「セル単位＝右クリック 1 回あたり 3,872 回のストア呼び出し」.
 *
 * THE POLARITY IS POSITIVE — "blocked", not "passable" — because the answer this
 * rule wants is "did something stop it", and a predicate whose `true` means
 * "nothing happened" is the shape `../inventory-port.ts`'s header records as
 * having cost this organisation a reversed `add`/`remove` pair.
 *
 * Coordinates are CELL coordinates, already floored by the caller of the
 * predicate — see `shotBlockedByTerrain`.
 */
export type IsArrowBlockedAt = (wx: number, wy: number, wz: number) => boolean

/** Where a shot landed, and how far away that was. */
export type ShotHit = {
  readonly id: EntityId
  /** Distance ALONG THE AIM RAY, in blocks — not the straight-line distance. */
  readonly distance: number
}

/**
 * The nearest entity in the crosshair, or `undefined`.
 *
 * PURE and TOTAL. `origin` is the eye, `dirX/dirY/dirZ` the direction it looks;
 * neither is this repository's to hold (mc-sim owns the pose), so both arrive as
 * arguments the way `../vehicle/rail-ascent.ts` takes a heading.
 *
 * THE DIRECTION NEED NOT BE A UNIT VECTOR. It is normalised here, so a caller
 * passing a velocity or an unnormalised look vector gets the same answer as one
 * passing a unit vector — the magnitude does not reach the answer, which is
 * `docs/responsibility.md` §5-1's test and the reason this whole rule is
 * mx-gameplay's rather than mc-physics'. `test/bow.test.ts` asserts the invariance
 * by running one shot at several positive multiples of one direction, the same
 * way `test/rail.test.ts` asserts it for `isAscendingAhead`.
 *
 * A DEGENERATE AIM HITS NOTHING, which the reference cannot say: its
 * `normalize()` of a zero vector yields zero, every projection collapses to zero,
 * and the nearest entity within `BOW_TARGET_RADIUS` of the player is struck no
 * matter where the bow was pointed. Refusing is the inert direction.
 *
 * NON-FINITE INPUTS HIT NOTHING, for the reason `../mob/enderman-teleport`'s
 * header calls finding F5: a `NaN` fails every comparison below, so an entity
 * would be neither rejected nor accepted but simply never nearest — which is the
 * right answer arrived at by luck. It is made explicit instead.
 *
 * TIES GO TO THE FIRST IN THE ROSTER, because the comparison is strict `<`
 * (`attack-targeting.ts:42`). Two mobs at exactly one distance is not a
 * hypothetical in a game with spawn stacks; the reference does not record which
 * wins and `test/bow.test.ts` pins it.
 */
export const shotTarget = (
  candidates: ReadonlyArray<ShotCandidate>,
  origin: Position,
  dirX: number,
  dirY: number,
  dirZ: number,
  reach: number = BOW_MAX_RANGE,
): ShotHit | undefined => {
  if (
    !Number.isFinite(origin.x) ||
    !Number.isFinite(origin.y) ||
    !Number.isFinite(origin.z) ||
    !Number.isFinite(dirX) ||
    !Number.isFinite(dirY) ||
    !Number.isFinite(dirZ) ||
    !Number.isFinite(reach)
  ) {
    return undefined
  }

  const lengthSquared = dirX * dirX + dirY * dirY + dirZ * dirZ
  // Not aiming anywhere. Not "nothing in the way" — there is no way.
  if (lengthSquared < BOW_AIM_EPSILON_SQUARED) {
    return undefined
  }

  const length = Math.sqrt(lengthSquared)
  const unitX = dirX / length
  const unitY = dirY / length
  const unitZ = dirZ / length
  const radiusSquared = BOW_TARGET_RADIUS * BOW_TARGET_RADIUS

  let nearest: ShotHit | undefined
  for (const candidate of candidates) {
    const toX = candidate.feetPosition.x - origin.x
    const toY = candidate.feetPosition.y + BOW_TARGET_CENTER_Y_OFFSET - origin.y
    const toZ = candidate.feetPosition.z - origin.z

    // Scalar projection rather than a vector one, which is the reference's own
    // optimisation (`attack-targeting.ts:30-31`) and its stated reason: this
    // runs per entity on every shot and a temporary per candidate is a
    // per-shot allocation proportional to the roster.
    const alongRay = toX * unitX + toY * unitY + toZ * unitZ
    // Behind the player, or past the reach. `alongRay < 0` is the half of this
    // that is easy to drop, and dropping it lets a bow shoot backwards.
    if (!(alongRay >= 0) || alongRay > reach) {
      continue
    }

    const perpendicularSquared = Math.max(0, toX * toX + toY * toY + toZ * toZ - alongRay * alongRay)
    if (!(perpendicularSquared <= radiusSquared)) {
      continue
    }

    if (nearest === undefined || alongRay < nearest.distance) {
      nearest = { id: candidate.id, distance: alongRay }
    }
  }

  return nearest
}

/**
 * How finely the terrain between shooter and target is sampled, in blocks.
 *
 * `<reference-impl>/packages/app/application/frame/stages/interaction-bow-handler.ts:64`
 * (`BOW_LOS_STEP`). TRANSCRIBED, NOT JUSTIFIED — the reference states `0.1` and
 * explains nothing.
 *
 * IT IS A SAMPLING RATE AND THEREFORE IT MISSES THINGS, which the reference does
 * not say. Ten samples per block is not a traversal: a shot that clips the corner
 * of a block passes through a cell for less than a tenth of a block and the walk
 * never lands in it, so the arrow goes through the corner. An exact
 * cell-by-cell traversal (a DDA) has no such gap and mc-physics has one, but
 * mc-physics cannot be imported here — docs/responsibility.md §5-2 records the
 * transitive-closure ban and the reason it is not worked around — so the
 * reference's sampling is transcribed and its limitation is stated rather than
 * silently inherited. `test/bow.test.ts` pins a corner-clipping shot as passing,
 * so the day a DDA arrives the test goes red and this paragraph has to be
 * rewritten rather than quietly becoming false.
 */
export const BOW_LINE_OF_SIGHT_STEP = 0.1

/**
 * Nudge applied before flooring a sample, in blocks.
 *
 * `interaction-bow-handler.ts:65` (`BOW_LOS_COORD_EPSILON`). TRANSCRIBED. It
 * biases a sample that lands exactly on a cell boundary into the HIGHER cell, so
 * a shot travelling along a wall face reads the open side rather than the wall.
 */
export const BOW_LINE_OF_SIGHT_EPSILON = 1e-6

/**
 * Is there terrain between the shooter and the point aimed at?
 *
 * `interaction-bow-handler.ts:67-94`, with the store read replaced by an injected
 * predicate (see `IsArrowBlockedAt`).
 *
 * THE ENDPOINTS ARE EXCLUDED AS POINTS, WHICH IS NOT THE SAME AS EXCLUDING THEIR
 * CELLS, and the difference is worth stating because it is easy to assume the
 * stronger claim. The walk runs from step 1 to step `n − 1` (`:80-82`), so
 * neither endpoint is itself sampled — but the step is a tenth of a block, so the
 * first several samples of any shot longer than that still floor into the cell
 * the SHOOTER is standing in.
 *
 * The consequence is real and is the reference's too: A PLAYER WHOSE EYE IS
 * INSIDE A BLOCKING CELL CANNOT FIRE AT ALL. Whether that is right depends on a
 * table this repository does not have — if tall grass and torches are passable,
 * as they are in the reference's `PASSABLE_BLOCK_IDS`, the case barely arises.
 * It is pinned in `test/bow.test.ts` as observed behaviour rather than repaired,
 * because repairing it means skipping the shooter's cell, and "the shooter's
 * cell" is a cell-wise notion that a sampling walk does not have.
 *
 * PURE and TOTAL. A non-finite endpoint is NOT BLOCKED rather than blocked, which
 * is worth pausing on because it is the permissive direction and this file
 * otherwise takes the inert one. The reason is that the alternative is worse in a
 * way the player can see: `shotTarget` has already refused every non-finite input
 * above, so a non-finite value reaching here means the two functions were called
 * with different arguments — and answering "blocked" would silently delete a hit
 * the search had already found. Answering "not blocked" delivers it. The
 * reference reaches the same behaviour by a different route, swallowing every
 * error into `false` (`:92-94`).
 *
 * ZERO DISTANCE IS NOT BLOCKED (`:77`): a target at the eye has nothing between.
 */
export const shotBlockedByTerrain = (
  isArrowBlockedAt: IsArrowBlockedAt,
  from: Position,
  to: Position,
): boolean => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z

  if (
    !Number.isFinite(from.x) ||
    !Number.isFinite(from.y) ||
    !Number.isFinite(from.z) ||
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    !Number.isFinite(dz)
  ) {
    return false
  }

  const distance = Math.hypot(dx, dy, dz)
  if (distance <= 0) {
    return false
  }

  // THE REFERENCE'S `if (t >= 1) break` (`:81`) IS NOT HERE, and it is left out
  // rather than transcribed because it cannot run. With
  // `steps = max(1, ceil(distance / STEP))` the loop's last index is `steps - 1`,
  // and `ceil(d / s) - 1 < d / s` for every positive `d` — so the largest `t` the
  // body ever sees is strictly below 1. When `distance <= STEP` the loop does not
  // execute at all. Either way the guard is dead.
  //
  // `../frame-rolls.ts`'s `rollAt` is the precedent for deleting rather than
  // keeping it: four unreachable fallbacks, 「none reachable at its own site, each
  // one a branch permanently red in the coverage report」. A guard that cannot
  // fire is not free — it reads as a case somebody considered, and the next person
  // has to redo this arithmetic to find out that nobody did.
  const steps = Math.max(1, Math.ceil(distance / BOW_LINE_OF_SIGHT_STEP))
  for (let step = 1; step < steps; step += 1) {
    const t = (step * BOW_LINE_OF_SIGHT_STEP) / distance
    const blocked = isArrowBlockedAt(
      Math.floor(from.x + dx * t + BOW_LINE_OF_SIGHT_EPSILON),
      Math.floor(from.y + dy * t + BOW_LINE_OF_SIGHT_EPSILON),
      Math.floor(from.z + dz * t + BOW_LINE_OF_SIGHT_EPSILON),
    )
    if (blocked) {
      return true
    }
  }

  return false
}
