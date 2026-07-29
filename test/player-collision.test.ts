/**
 * `domain/player-collision.ts` — the resolver that duplicates mc-physics'.
 *
 * THESE TESTS EXIST BECAUSE THE FILE IS A DUPLICATE. Two implementations of one
 * algorithm drift, and the drift is invisible when each repository's tests only
 * see its own. The cases below are the behaviours `mc-physics/domain/resolve.ts`
 * names in its own comments, so a divergence fails here rather than showing up
 * as a player who falls through a floor in one build and not the other.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  CONTACT_EPSILON,
  GRAVITY_M_PER_S2,
  TERMINAL_VELOCITY_M_PER_S,
  applyGravity,
  resolvePlayerMovement,
  type IsBlockSolid,
  type PlayerBody,
} from '../domain/player-collision'
import { PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH } from '../domain/interactions/place-block'

/** A floor filling y = 0, air everywhere else. */
const floorAtZero: IsBlockSolid = (position) => position.y === 0

/** Nothing anywhere. */
const emptyWorld: IsBlockSolid = () => false

const body = (overrides: Partial<PlayerBody> = {}): PlayerBody => ({
  centre: { x: 0.5, y: 5, z: 0.5 },
  velocity: { x: 0, y: 0, z: 0 },
  ...overrides,
})

describe('falling and standing', () => {
  it.effect('a body in empty space keeps falling', () =>
    Effect.sync(() => {
      const result = resolvePlayerMovement(
        body({ velocity: { x: 0, y: -10, z: 0 } }),
        0.1,
        emptyWorld,
      )

      expect(result.body.centre.y).toBeCloseTo(4, 6)
      expect(result.isGrounded).toBe(false)
    }),
  )

  it.effect('THE GROUND CLAMP: a body lands exactly on the floor top', () =>
    Effect.sync(() => {
      // `y = floorTop + halfHeight`, exact, no epsilon added. The floor at
      // y = 0 has its top at y = 1.
      // Starts ABOVE the floor (feet at 3.5 - 0.9 = 2.6, floor top is 1) and
      // falls into it within one step. Starting with the feet already inside
      // is a different case — the reach test declines it, because a body that
      // was already inside did not arrive there this step.
      const result = resolvePlayerMovement(
        body({ centre: { x: 0.5, y: 3.5, z: 0.5 }, velocity: { x: 0, y: -20, z: 0 } }),
        0.1,
        floorAtZero,
      )

      expect(result.body.centre.y).toBeCloseTo(1 + PLAYER_HALF_HEIGHT, 9)
      expect(result.body.velocity.y).toBe(0)
      expect(result.isGrounded).toBe(true)
    }),
  )

  it.effect('a body resting on the floor stays put and stays grounded', () =>
    Effect.sync(() => {
      // The fixed point. A resolver that moved a resting body would jitter it
      // every frame, which is the failure `CONTACT_EPSILON` is sized for.
      const resting = body({ centre: { x: 0.5, y: 1 + PLAYER_HALF_HEIGHT, z: 0.5 } })

      const once = resolvePlayerMovement(resting, 0.016, floorAtZero)
      const twice = resolvePlayerMovement(once.body, 0.016, floorAtZero)

      expect(once.body.centre.y).toBeCloseTo(resting.centre.y, 9)
      expect(twice.body.centre.y).toBeCloseTo(resting.centre.y, 9)
      expect(twice.isGrounded).toBe(true)
    }),
  )

  it.effect('a terminal-velocity fall is caught at a frame-sized step', () =>
    Effect.sync(() => {
      // 78.4 m/s over one 60Hz frame is 1.3 m — less than the body's height, so
      // the box at the resolved position still overlaps the floor and the reach
      // test still sees it.
      let current = body({ centre: { x: 0.5, y: 6, z: 0.5 }, velocity: { x: 0, y: -TERMINAL_VELOCITY_M_PER_S, z: 0 } })
      for (let frame = 0; frame < 20; frame += 1) {
        current = resolvePlayerMovement(current, 0.016, floorAtZero).body
      }

      expect(current.centre.y).toBeCloseTo(1 + PLAYER_HALF_HEIGHT, 6)
    }),
  )

  it.effect('THE LIMIT, STATED: one huge step tunnels, and that is the caller’s to prevent', () =>
    Effect.sync(() => {
      // mc-physics resolves the box at the FINAL position only — it is a
      // resolver, not a swept-volume test — so a step that jumps clean past a
      // block sees nothing. That repository exports `maxSpeedWithoutTunnelling`
      // for exactly this and puts the duty on whoever produces the delta;
      // `apps/web/main.ts` already clamps its frame delta to 0.05s.
      //
      // Asserted rather than hidden: a reader who does not know this would
      // otherwise discover it as a player falling through the world.
      const tunnelled = resolvePlayerMovement(
        body({ centre: { x: 0.5, y: 40, z: 0.5 }, velocity: { x: 0, y: -TERMINAL_VELOCITY_M_PER_S, z: 0 } }),
        1,
        floorAtZero,
      )

      expect(tunnelled.body.centre.y).toBeLessThan(0)
    }),
  )
})

describe('walls', () => {
  /** A wall filling x = 2, plus the floor. */
  const wallAtX2: IsBlockSolid = (position) => position.y === 0 || position.x === 2

  it.effect('walking into a wall stops at its face', () =>
    Effect.sync(() => {
      const result = resolvePlayerMovement(
        body({ centre: { x: 1.4, y: 1 + PLAYER_HALF_HEIGHT, z: 0.5 }, velocity: { x: 10, y: 0, z: 0 } }),
        0.05,
        wallAtX2,
      )

      // The wall's near face is x = 2; the body's centre stops a half-width off.
      expect(result.body.centre.x).toBeCloseTo(2 - PLAYER_HALF_WIDTH, 9)
      expect(result.body.velocity.x).toBe(0)
    }),
  )

  it.effect('REGRESSION: a wall stops X and leaves Z alone', () =>
    Effect.sync(() => {
      // The axes are resolved separately so that sliding along a wall works. A
      // resolver that zeroed both would make a player walking diagonally into a
      // wall stop dead instead of sliding.
      const result = resolvePlayerMovement(
        body({ centre: { x: 1.4, y: 1 + PLAYER_HALF_HEIGHT, z: 0.5 }, velocity: { x: 10, y: 0, z: 3 } }),
        0.05,
        wallAtX2,
      )

      expect(result.body.velocity.x).toBe(0)
      expect(result.body.velocity.z).toBe(3)
      expect(result.body.centre.z).toBeGreaterThan(0.5)
    }),
  )

  it.effect('a ceiling stops a rising body', () =>
    Effect.sync(() => {
      const ceilingAtY5: IsBlockSolid = (position) => position.y === 5

      const result = resolvePlayerMovement(
        body({ centre: { x: 0.5, y: 3, z: 0.5 }, velocity: { x: 0, y: 20, z: 0 } }),
        0.06,
        ceilingAtY5,
      )

      expect(result.body.centre.y).toBeCloseTo(5 - PLAYER_HALF_HEIGHT, 9)
      expect(result.body.velocity.y).toBe(0)
    }),
  )
})

describe('the axis order', () => {
  it.effect('Y IS RESOLVED FIRST, so a walk along a floor is not blocked by it', () =>
    Effect.sync(() => {
      // Resolve X first and the body is momentarily inside the floor, so the
      // floor's own cells become horizontal obstacles and the player stops dead
      // on flat ground. This is the case that ordering exists for.
      const result = resolvePlayerMovement(
        body({ centre: { x: 0.5, y: 1 + PLAYER_HALF_HEIGHT, z: 0.5 }, velocity: { x: 5, y: -1, z: 0 } }),
        0.1,
        floorAtZero,
      )

      expect(result.body.centre.x).toBeGreaterThan(0.5)
      expect(result.isGrounded).toBe(true)
    }),
  )

  it.effect('REGRESSION: crossing a floor-block boundary does not hit the floor as a wall', () =>
    Effect.sync(() => {
      // The destination overlaps this floor block, but the starting box does
      // not. Y must therefore resolve at the destination X/Z before Z resolves;
      // otherwise the slight downward motion leaves the floor to stop Z at its
      // side face.
      const floorAhead: IsBlockSolid = (position) => position.y === 59 && position.z === -1
      const result = resolvePlayerMovement(
        body({ centre: { x: 0.5, y: 60 + PLAYER_HALF_HEIGHT, z: 0.5 }, velocity: { x: 0, y: -1, z: -5 } }),
        0.1,
        floorAhead,
      )

      expect(result.body.centre.y).toBeCloseTo(60 + PLAYER_HALF_HEIGHT, 9)
      expect(result.body.centre.z).toBeCloseTo(0, 9)
      expect(result.body.velocity.z).toBe(-5)
      expect(result.isGrounded).toBe(true)
    }),
  )
})

describe('non-finite inputs advance nothing', () => {
  it.effect('a NaN velocity leaves the body where it was', () =>
    Effect.sync(() => {
      // A NaN position propagates into the projection matrix, where every vertex
      // projects to nothing — a black screen with no error anywhere.
      const start = body({ velocity: { x: Number.NaN, y: 0, z: 0 } })

      expect(resolvePlayerMovement(start, 0.1, emptyWorld).body).toStrictEqual(start)
    }),
  )

  it.effect('a NaN delta does too', () =>
    Effect.sync(() => {
      const start = body({ velocity: { x: 1, y: 0, z: 0 } })

      expect(resolvePlayerMovement(start, Number.NaN, emptyWorld).body).toStrictEqual(start)
    }),
  )

  it.effect('no finite input produces a non-finite position', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -100, max: 100, noNaN: true }),
          FastCheck.double({ min: -100, max: 100, noNaN: true }),
          FastCheck.double({ min: 0, max: 0.05, noNaN: true }),
          (velocityX, velocityY, deltaSecs) => {
            const result = resolvePlayerMovement(
              body({ velocity: { x: velocityX, y: velocityY, z: 0 } }),
              deltaSecs,
              floorAtZero,
            )
            return (
              Number.isFinite(result.body.centre.x) &&
              Number.isFinite(result.body.centre.y) &&
              Number.isFinite(result.body.centre.z)
            )
          },
        ),
        { numRuns: 400 },
      )
    }),
  )
})

describe('gravity', () => {
  it.effect('accumulates downward', () =>
    Effect.sync(() => {
      expect(applyGravity(0, 0.5)).toBeCloseTo(-GRAVITY_M_PER_S2 * 0.5, 9)
    }),
  )

  it.effect('REGRESSION: it is clamped at terminal velocity', () =>
    Effect.sync(() => {
      // Unclamped, a long fall reaches a speed that covers more than the body's
      // own height in one step, and the reach test in `resolveVertical` stops
      // seeing the floor. The clamp is what makes tunnelling unreachable rather
      // than merely unlikely.
      expect(applyGravity(-TERMINAL_VELOCITY_M_PER_S, 10)).toBe(-TERMINAL_VELOCITY_M_PER_S)
      expect(applyGravity(-1000, 0.1)).toBe(-TERMINAL_VELOCITY_M_PER_S)
    }),
  )

  it.effect('a non-finite velocity resets to rest rather than propagating', () =>
    Effect.sync(() => {
      expect(applyGravity(Number.NaN, 0.1)).toBe(0)
    }),
  )
})

describe('the contact skin', () => {
  it.effect('is small enough to be imperceptible and large enough to matter', () =>
    Effect.sync(() => {
      // mc-physics' words: "roughly seven orders of magnitude above the observed
      // error and seven below any distance a player can perceive". Pinned so a
      // "tidy" change to 0 or to 0.001 fails here.
      expect(CONTACT_EPSILON).toBeGreaterThan(0)
      expect(CONTACT_EPSILON).toBeLessThan(1e-6)
    }),
  )
})
