/**
 * Player movement resolved against solid blocks.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A SECOND IMPLEMENTATION OF SOMETHING mc-physics ALREADY OWNS
 * ---------------------------------------------------------------------------
 *
 * `mc-physics/domain/resolve.ts` has `resolveBody` — the same sweep, better
 * tested (133 tests in that repository), and the declared owner: the dependency
 * graph gives mc-physics to mc-sim, and mc-sim owns `PlayerService.moveTo`, so
 * a player stopped by a wall is mc-sim's answer computed with mc-physics'
 * resolver. That is where this belongs and it is not here.
 *
 * It is here because nothing in the roster is published, so mc-sim cannot take
 * its mc-physics edge, mx-gameplay cannot take its mc-sim edge, and mc-compose
 * may take neither. Every route to a player who cannot walk through walls ends
 * at the publish sequence.
 *
 * SO THIS FILE IS A KNOWN DUPLICATE, WRITTEN DELIBERATELY, AND IT SAYS SO:
 *
 *   - It is a PORT of `resolveBody`, not an invention. The axis order, the
 *     reach tests, the ground clamp and the two-layer support scan are that
 *     file's; the comments below cite what each one is for so that a reader
 *     comparing them is comparing shapes rather than deriving algebra.
 *   - It handles ONE body — the player — and full cubes only. mc-physics'
 *     takes any body and an injected `BlockShapeAt` for slabs and stairs. The
 *     narrowing is what keeps this small enough to be honest about.
 *   - IT IS DELETED WHEN mc-sim PUBLISHES, on the same commit that deletes
 *     `./player-port.ts`'s mirror. `docs/` should carry that as a row rather
 *     than this header being the only record.
 *
 * The cost of the duplicate is stated rather than hidden: two implementations
 * of one algorithm drift, and the drift is invisible because each repository's
 * tests only see its own. `test/player-collision.test.ts` pins the behaviours
 * mc-physics' own suite names, so a divergence shows up as a failure here
 * rather than as a player who falls through a floor in one build and not the
 * other.
 *
 * ---------------------------------------------------------------------------
 * WHY Y FIRST, THEN X, THEN Z
 * ---------------------------------------------------------------------------
 *
 * Each axis is resolved against the box the PREVIOUS axis left behind, and the
 * order is not arbitrary. Y first means the ground clamp happens before the
 * horizontal phases, so a player walking along a floor is already standing on
 * it when X and Z run — resolve X first and the same player is momentarily
 * inside the floor, and a wall at head height stops them for a frame.
 */
import type { BlockPosition } from './chunk-store-port'
import type { Position } from './entity-manager-port'
import { PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH } from './interactions/place-block'

/**
 * The contact skin, transcribed from `mc-physics/domain/coordinates.ts`.
 *
 * 1e-9 — "roughly seven orders of magnitude above the observed error and seven
 * below any distance a player can perceive". It is what stops a body resting
 * exactly on a face from being re-resolved every frame by float residue.
 */
export const CONTACT_EPSILON = 1e-9

/** Is the block at this cell something a body cannot pass through? */
export type IsBlockSolid = (position: BlockPosition) => boolean

/** A body in flight: where it is, and how fast. */
export type PlayerBody = {
  /** CENTRE position, not feet. See `./player-port.ts` on why the name matters. */
  readonly centre: Position
  readonly velocity: Position
}

/** What the resolver decided. */
export type PlayerResolution = {
  readonly body: PlayerBody
  /** Is something holding it up, AFTER resolution? */
  readonly isGrounded: boolean
}

type Box = {
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
}

const boxAt = (x: number, y: number, z: number): Box => ({
  minX: x - PLAYER_HALF_WIDTH,
  maxX: x + PLAYER_HALF_WIDTH,
  minY: y - PLAYER_HALF_HEIGHT,
  maxY: y + PLAYER_HALF_HEIGHT,
  minZ: z - PLAYER_HALF_WIDTH,
  maxZ: z + PLAYER_HALF_WIDTH,
})

/**
 * Every solid cell overlapping the box, as unit cubes.
 *
 * COLLECTED INTO AN ARRAY rather than folded in place, which is mc-physics'
 * choice and its reason is worth carrying: each phase below is a `reduce` over
 * a set, and `min`/`max` do not care what order they see their arguments in —
 * so the resolver is scan-order independent by construction rather than by
 * inspection.
 */
const collidingCells = (box: Box, isBlockSolid: IsBlockSolid): ReadonlyArray<Box> => {
  const found: Array<Box> = []
  for (let bx = Math.floor(box.minX); bx <= Math.floor(box.maxX); bx += 1) {
    for (let by = Math.floor(box.minY); by <= Math.floor(box.maxY); by += 1) {
      for (let bz = Math.floor(box.minZ); bz <= Math.floor(box.maxZ); bz += 1) {
        if (!isBlockSolid({ x: bx, y: by, z: bz })) {
          continue
        }
        const cell: Box = {
          minX: bx,
          minY: by,
          minZ: bz,
          maxX: bx + 1,
          maxY: by + 1,
          maxZ: bz + 1,
        }
        // Beyond the contact skin, so a body resting exactly on a face is not
        // colliding with it.
        const overlaps =
          box.minX < cell.maxX - CONTACT_EPSILON &&
          box.maxX > cell.minX + CONTACT_EPSILON &&
          box.minY < cell.maxY - CONTACT_EPSILON &&
          box.maxY > cell.minY + CONTACT_EPSILON &&
          box.minZ < cell.maxZ - CONTACT_EPSILON &&
          box.maxZ > cell.minZ + CONTACT_EPSILON
        if (overlaps) {
          found.push(cell)
        }
      }
    }
  }
  return found
}

type Axis = { readonly position: number; readonly velocity: number }

/** Clamp one horizontal axis to the nearest face it is moving into. */
const clampAxis = (
  state: Axis,
  bodyMin: number,
  bodyMax: number,
  cells: ReadonlyArray<Box>,
  nearFace: (cell: Box) => number,
  farFace: (cell: Box) => number,
): Axis => {
  if (state.velocity > 0) {
    const face = cells.reduce(
      (nearest, cell) => (nearFace(cell) >= bodyMin ? Math.min(nearest, nearFace(cell)) : nearest),
      Number.POSITIVE_INFINITY,
    )
    return face < Number.POSITIVE_INFINITY
      ? { position: face - PLAYER_HALF_WIDTH, velocity: 0 }
      : state
  }
  if (state.velocity < 0) {
    const face = cells.reduce(
      (nearest, cell) => (farFace(cell) <= bodyMax ? Math.max(nearest, farFace(cell)) : nearest),
      Number.NEGATIVE_INFINITY,
    )
    return face > Number.NEGATIVE_INFINITY
      ? { position: face + PLAYER_HALF_WIDTH, velocity: 0 }
      : state
  }
  return state
}

/**
 * The Y phase, including the ground clamp.
 *
 * FALLING and RISING are exclusive, which is mc-physics' correction to the
 * reference rather than a simplification: a body cannot move up and down in one
 * step, and the reference applies both and lets the ceiling win — putting a
 * body in a gap narrower than itself at the ceiling rather than at the floor,
 * for no stated reason.
 *
 * `y = floorTop + halfHeight` is EXACT, with no epsilon added. The residual of
 * that and the `- halfHeight` a caller does to get back to the feet is a few
 * ulp, which is what `CONTACT_EPSILON` is sized for.
 */
const resolveVertical = (
  box: Box,
  state: Axis,
  deltaSecs: number,
  isBlockSolid: IsBlockSolid,
): Axis => {
  const cells = collidingCells(box, isBlockSolid)
  if (cells.length === 0) {
    return state
  }

  if (state.velocity <= 0) {
    const reach = -state.velocity * deltaSecs + CONTACT_EPSILON
    const floorTop = cells.reduce(
      (highest, cell) => (cell.maxY - box.minY <= reach ? Math.max(highest, cell.maxY) : highest),
      Number.NEGATIVE_INFINITY,
    )
    return floorTop > Number.NEGATIVE_INFINITY
      ? { position: floorTop + PLAYER_HALF_HEIGHT, velocity: 0 }
      : state
  }

  const reach = state.velocity * deltaSecs + CONTACT_EPSILON
  const ceiling = cells.reduce(
    (lowest, cell) => (box.maxY - cell.minY <= reach ? Math.min(lowest, cell.minY) : lowest),
    Number.POSITIVE_INFINITY,
  )
  return ceiling < Number.POSITIVE_INFINITY
    ? { position: ceiling - PLAYER_HALF_HEIGHT, velocity: 0 }
    : state
}

/**
 * Is anything holding this body up?
 *
 * TWO CELL LAYERS ONLY — the cell the feet are in and the one below it. A block
 * two cells down cannot reach whatever its shape, because shapes live inside
 * the unit cube. mc-physics states this and it is worth carrying: scanning
 * further is not more correct, it is slower and finds nothing.
 */
const isSupported = (box: Box, isBlockSolid: IsBlockSolid): boolean => {
  const feetCell = Math.floor(box.minY - CONTACT_EPSILON)
  for (let bx = Math.floor(box.minX); bx <= Math.floor(box.maxX); bx += 1) {
    for (let bz = Math.floor(box.minZ); bz <= Math.floor(box.maxZ); bz += 1) {
      for (let by = feetCell - 1; by <= feetCell; by += 1) {
        if (isBlockSolid({ x: bx, y: by, z: bz }) && by + 1 <= box.minY + CONTACT_EPSILON) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Move the player by one step, stopped by whatever is solid.
 *
 * Y, THEN X, THEN Z, each against the box the previous phase left. See the
 * header on why the order is load-bearing.
 *
 * A NON-FINITE DELTA OR VELOCITY ADVANCES NOTHING rather than producing NaN.
 * mc-physics' `delta-time.ts` and this repository's `./frame-rolls` both take
 * that direction: a NaN position propagates into the projection matrix, where
 * every vertex projects to nothing and the screen goes black with no error
 * anywhere.
 */
export const resolvePlayerMovement = (
  body: PlayerBody,
  deltaSecs: number,
  isBlockSolid: IsBlockSolid,
): PlayerResolution => {
  const finite =
    Number.isFinite(deltaSecs) &&
    Number.isFinite(body.centre.x) &&
    Number.isFinite(body.centre.y) &&
    Number.isFinite(body.centre.z) &&
    Number.isFinite(body.velocity.x) &&
    Number.isFinite(body.velocity.y) &&
    Number.isFinite(body.velocity.z)

  if (!finite) {
    return { body, isGrounded: isSupported(boxAt(body.centre.x, body.centre.y, body.centre.z), isBlockSolid) }
  }

  const step = Math.max(0, deltaSecs)
  const wanted = {
    x: body.centre.x + body.velocity.x * step,
    y: body.centre.y + body.velocity.y * step,
    z: body.centre.z + body.velocity.z * step,
  }

  const vertical = resolveVertical(
    boxAt(wanted.x, wanted.y, wanted.z),
    { position: wanted.y, velocity: body.velocity.y },
    step,
    isBlockSolid,
  )

  const boxAfterY = boxAt(wanted.x, vertical.position, wanted.z)
  const alongX = clampAxis(
    { position: wanted.x, velocity: body.velocity.x },
    boxAfterY.minX,
    boxAfterY.maxX,
    collidingCells(boxAfterY, isBlockSolid),
    (cell) => cell.minX,
    (cell) => cell.maxX,
  )

  const boxAfterX = boxAt(alongX.position, vertical.position, wanted.z)
  const alongZ = clampAxis(
    { position: wanted.z, velocity: body.velocity.z },
    boxAfterX.minZ,
    boxAfterX.maxZ,
    collidingCells(boxAfterX, isBlockSolid),
    (cell) => cell.minZ,
    (cell) => cell.maxZ,
  )

  const resolved: PlayerBody = {
    centre: { x: alongX.position, y: vertical.position, z: alongZ.position },
    velocity: { x: alongX.velocity, y: vertical.velocity, z: alongZ.velocity },
  }

  return {
    body: resolved,
    isGrounded: isSupported(
      boxAt(resolved.centre.x, resolved.centre.y, resolved.centre.z),
      isBlockSolid,
    ),
  }
}

/** Gravity, in m/s². Vanilla's, and the only force this file applies. */
export const GRAVITY_M_PER_S2 = 32

/** Terminal fall speed, so a long drop cannot tunnel through a floor. */
export const TERMINAL_VELOCITY_M_PER_S = 78.4

/**
 * Apply gravity to a velocity, clamped at terminal.
 *
 * SEPARATE FROM THE RESOLVER because it is a force and the resolver is a
 * constraint — mc-physics keeps `integrate.ts` and `resolve.ts` apart for the
 * same reason. The clamp is what stops a body falling far enough in one step to
 * pass through a floor before `resolveVertical` ever sees it.
 */
export const applyGravity = (velocityY: number, deltaSecs: number): number => {
  if (!Number.isFinite(velocityY) || !Number.isFinite(deltaSecs)) {
    return 0
  }
  return Math.max(-TERMINAL_VELOCITY_M_PER_S, velocityY - GRAVITY_M_PER_S2 * Math.max(0, deltaSecs))
}
