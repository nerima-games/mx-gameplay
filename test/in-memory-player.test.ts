/**
 * `domain/in-memory-player.ts`.
 *
 * The fourth and last service `gameplayModule` needs. Two things here are not
 * in `test/support/player-service-double.ts` and are the reason this is an
 * implementation rather than a promoted double:
 *
 *   THE PITCH CLAMP. The double adds the delta and clamps nothing, though
 *   `../@nerima-games/mc-sim` says 「Pitch is clamped」. Nothing in this
 *   repository's slice looks up far enough to notice.
 *
 *   `cameraPose`. The double DIES on it deliberately — a rule here reaching it
 *   has found a rule reading a clock. A host's renderer is exactly who should
 *   call it, so a service a host composes has to answer.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  EYE_LEVEL_OFFSET,
  INITIAL_DIMENSION,
  INITIAL_PLAYER_POSE,
  InMemoryPlayerLayer,
  PITCH_MAX_RADIANS,
  PITCH_MIN_RADIANS,
  applyLook,
  clampPitch,
  makeInMemoryPlayer,
} from '../src/domain/in-memory-player'
import { ClockPort, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import { PlayerService, type PlayerPose } from '@nerima-games/mc-sim'

const pose = (overrides: Partial<PlayerPose> = {}): PlayerPose => ({
  feetPosition: { x: 1, y: 64, z: 2 },
  yawRadians: 0,
  pitchRadians: 0,
  ...overrides,
})

/** A clock that always reads the same instant. */
const fixedClock = Layer.succeed(ClockPort, {
  monotonicSecs: Effect.succeed(MonotonicTimeSecs(12.5)),
  wallClockEpochMillis: Effect.succeed(0 as never),
})

describe('the pitch clamp the double does not have', () => {
  it.effect('looking up past vertical stops at the limit', () =>
    Effect.gen(function* () {
      // Unclamped, the world turns upside down; past that the yaw basis
      // degenerates and the view rolls on its own.
      const player = yield* makeInMemoryPlayer(pose())

      const looked = yield* player.look(0, 10)

      expect(looked.pitchRadians).toBe(PITCH_MAX_RADIANS)
    }),
  )

  it.effect('and looking down does too', () =>
    Effect.gen(function* () {
      const player = yield* makeInMemoryPlayer(pose())

      expect((yield* player.look(0, -10)).pitchRadians).toBe(PITCH_MIN_RADIANS)
    }),
  )

  it.effect('REGRESSION: the limit is short of a right angle, not equal to it', () =>
    Effect.sync(() => {
      // The epsilon is load-bearing. At exactly ±π/2 the forward vector is
      // parallel to the up axis and the basis is undefined — a clamp to exactly
      // π/2 looks correct and produces the same failure it was added to stop.
      expect(PITCH_MAX_RADIANS).toBeLessThan(Math.PI / 2)
      expect(clampPitch(Math.PI / 2)).toBeLessThan(Math.PI / 2)
    }),
  )

  it.effect('YAW IS NOT WRAPPED, which is the mirror’s word', () =>
    Effect.gen(function* () {
      // Wrapping into [0, 2π) looks tidier and breaks interpolation: a camera
      // easing from 6.2 to 0.1 takes the long way and spins through a turn.
      const player = yield* makeInMemoryPlayer(pose())

      const looked = yield* player.look(Math.PI * 4, 0)

      expect(looked.yawRadians).toBeCloseTo(Math.PI * 4, 10)
    }),
  )

  it.effect('a non-finite delta leaves the pose alone', () =>
    Effect.sync(() => {
      // NaN in a pose propagates into the projection matrix, where every vertex
      // projects to nothing — a black screen with no error anywhere.
      const start = pose({ yawRadians: 1, pitchRadians: 0.5 })

      expect(applyLook(start, Number.NaN, Number.NaN)).toStrictEqual(start)
    }),
  )

  it.effect('REGRESSION: clampPitch itself falls back to 0 for a non-finite pitch', () =>
    Effect.sync(() => {
      // `applyLook` never calls `clampPitch` with a non-finite value — its own
      // `Number.isFinite` guard substitutes 0 for the delta first — so this is
      // the only path that reaches `clampPitch`'s own fallback directly.
      expect(clampPitch(Number.NaN)).toBe(0)
      expect(clampPitch(Number.POSITIVE_INFINITY)).toBe(0)
    }),
  )
})

describe('moveTo and setDimension stay separate', () => {
  it.effect('moveTo changes position and nothing else', () =>
    Effect.gen(function* () {
      const player = yield* makeInMemoryPlayer(pose({ yawRadians: 1.5 }))

      yield* player.moveTo({ x: 9, y: 70, z: -3 })
      const after = yield* player.pose

      expect(after.feetPosition).toStrictEqual({ x: 9, y: 70, z: -3 })
      expect(after.yawRadians).toBe(1.5)
    }),
  )

  it.effect('REGRESSION: moving does NOT change dimension', () =>
    Effect.gen(function* () {
      // The hazard the mirror is emphatic about: a destination resolved by
      // `resolveNetherTravel` is in the other world's frame, so `moveTo` alone
      // moves the player without moving the world. Fusing them here would make
      // "move without switching" — the common case — inexpressible.
      const player = yield* makeInMemoryPlayer(pose(), 'nether')

      yield* player.moveTo({ x: 0, y: 0, z: 0 })

      expect(yield* player.dimension).toBe('nether')
    }),
  )

  it.effect('setDimension changes dimension and nothing else', () =>
    Effect.gen(function* () {
      const player = yield* makeInMemoryPlayer(pose())

      yield* player.setDimension('end')

      expect(yield* player.dimension).toBe('end')
      expect((yield* player.pose).feetPosition).toStrictEqual(pose().feetPosition)
    }),
  )
})

describe('cameraPose', () => {
  it.effect('is the FEET position raised by the eye offset', () =>
    Effect.gen(function* () {
      // The distinction `feetPosition`'s name exists to carry: a camera placed
      // at the feet renders from inside the floor.
      const player = yield* makeInMemoryPlayer(pose({ feetPosition: { x: 1, y: 64, z: 2 } }))

      const camera = yield* player.cameraPose

      expect(camera.position).toStrictEqual({ x: 1, y: 64 + EYE_LEVEL_OFFSET, z: 2 })
    }).pipe(Effect.provide(fixedClock)),
  )

  it.effect('takes its instant from the injected clock, never a global', () =>
    Effect.gen(function* () {
      // The signature carries `ClockPort` in `R` precisely so that
      // "simplifying" this into a `Date.now()` call does not typecheck — and
      // DN-GP-8 bans that call outright.
      const player = yield* makeInMemoryPlayer(pose())

      expect((yield* player.cameraPose).capturedAtSecs).toBe(12.5)
    }).pipe(Effect.provide(fixedClock)),
  )

  it.effect('carries the pose’s own rotation through unchanged', () =>
    Effect.gen(function* () {
      const player = yield* makeInMemoryPlayer(pose({ yawRadians: 0.7, pitchRadians: -0.2 }))

      const camera = yield* player.cameraPose

      expect(camera.yawRadians).toBe(0.7)
      expect(camera.pitchRadians).toBe(-0.2)
    }).pipe(Effect.provide(fixedClock)),
  )
})

describe('restore and reset', () => {
  it.effect('restore installs both halves together', () =>
    Effect.gen(function* () {
      const player = yield* makeInMemoryPlayer()

      yield* player.restore(pose({ yawRadians: 2 }), 'nether')

      expect((yield* player.pose).yawRadians).toBe(2)
      expect(yield* player.dimension).toBe('nether')
    }),
  )

  it.effect('REGRESSION: a saved pitch past the limit is RE-CLAMPED on load', () =>
    Effect.gen(function* () {
      // A save is untrusted — written by a build whose clamp differed, or
      // edited by hand. Installing a vertical pitch reproduces the degenerate
      // basis on the first frame after a load, which is the hardest place to
      // attribute it.
      const player = yield* makeInMemoryPlayer()

      yield* player.restore(pose({ pitchRadians: 99 }), 'overworld')

      expect((yield* player.pose).pitchRadians).toBe(PITCH_MAX_RADIANS)
    }),
  )

  it.effect('reset returns BOTH halves to spawn', () =>
    Effect.gen(function* () {
      // "A NEW world, not a reloaded one." A reset that left the dimension
      // would spawn the player in the nether with an overworld position.
      const player = yield* makeInMemoryPlayer(pose(), 'end')

      yield* player.reset

      expect(yield* player.pose).toStrictEqual(INITIAL_PLAYER_POSE)
      expect(yield* player.dimension).toBe(INITIAL_DIMENSION)
    }),
  )
})

describe('InMemoryPlayerLayer', () => {
  it.effect('provides a PlayerService a host can compose gameplayModule against', () =>
    Effect.gen(function* () {
      // Every other test in this file builds the service directly through
      // `makeInMemoryPlayer`; this is the only path that exercises the `Layer`
      // wrapper a real host actually provides.
      const player = yield* PlayerService

      expect(yield* player.pose).toStrictEqual(INITIAL_PLAYER_POSE)
      expect(yield* player.dimension).toBe(INITIAL_DIMENSION)
    }).pipe(Effect.provide(InMemoryPlayerLayer())),
  )

  it.effect('honours the initial pose and dimension it is built with', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService

      expect(yield* player.dimension).toBe('nether')
    }).pipe(Effect.provide(InMemoryPlayerLayer(pose(), 'nether'))),
  )
})
