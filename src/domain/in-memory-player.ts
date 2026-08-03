/**
 * A COMPLETE in-memory `PlayerService`, typed by this repository's mirror.
 *
 * The FOURTH service `gameplayModule` requires — `./in-memory-chunk-store`,
 * `./in-memory-inventory` and `./in-memory-entity-manager` are the other three,
 * and the first of them carries the argument for why these exist and when they
 * are deleted.
 *
 * ---------------------------------------------------------------------------
 * IT CLAMPS PITCH, AND THE TEST DOUBLE DOES NOT
 * ---------------------------------------------------------------------------
 *
 * `@nerima-games/mc-sim` says of `look`: 「Pitch is clamped; yaw is not wrapped.」
 * `test/support/player-service-double.ts` adds both deltas and clamps neither:
 *
 *     pitchRadians: current.pitchRadians + deltaPitch,
 *
 * That is not a bug in the double — nothing in this repository's slice looks up
 * far enough to notice — but it IS the difference between a double and an
 * implementation. Unclamped, a player who keeps looking up passes vertical and
 * the world turns upside down; past that the yaw basis degenerates and the view
 * spins on its own.
 *
 * THE CLAMP VALUE IS TRANSCRIBED, NOT MIRRORED. `@nerima-games/mc-sim`'s header
 * lists `PITCH_MAX_RADIANS`, `PITCH_MIN_RADIANS` and `clampPitch` among the
 * things it deliberately does NOT carry, so the number below names its source
 * rather than importing it — the same treatment `./in-memory-inventory`'s
 * `INVENTORY_SLOT_COUNT` gets.
 *
 * YAW IS NOT WRAPPED, and that is the mirror's word too. Wrapping into
 * `[0, 2π)` looks tidier and breaks interpolation: a camera easing from 6.2 to
 * 0.1 takes the long way round and the view spins through a full turn.
 *
 * ---------------------------------------------------------------------------
 * `moveTo` AND `setDimension` STAY SEPARATE
 * ---------------------------------------------------------------------------
 *
 * The mirror is emphatic that this is the hazard rather than the fix: a
 * destination resolved by mc-worldgen's `resolveNetherTravel` is in the other
 * world's frame, so `moveTo` alone moves the player without moving the world.
 * Pairing them is the CALLER's responsibility and belongs to the rule that
 * knows a portal was used — `./portal-travel.ts`. This file does not fuse them
 * to be helpful, because fusing them would make "move without switching"
 * inexpressible, and that is the common case.
 */
import { Effect, Layer, Ref } from 'effect'
import { PlayerService, type PlayerPose, type PlayerServiceApi } from '@nerima-games/mc-sim'
import { ClockPort, type CameraPoseSnapshot } from './frame-contract'
import type { Position } from '@nerima-games/mc-kernel'
import type { Dimension } from '@nerima-games/mc-worldgen'

/**
 * How far the view may pitch, in radians.
 *
 * mc-sim's `PITCH_MAX_RADIANS`, transcribed: a right angle less an epsilon.
 * The epsilon is load-bearing rather than cosmetic — at exactly ±π/2 the
 * forward vector is parallel to the up axis and the yaw basis is undefined, so
 * the view's roll becomes whatever the arithmetic happens to produce.
 */
export const PITCH_MAX_RADIANS = Math.PI / 2 - 0.001
export const PITCH_MIN_RADIANS = -PITCH_MAX_RADIANS

/** Hold the pitch inside the range the basis is defined on. */
export const clampPitch = (pitchRadians: number): number =>
  Number.isFinite(pitchRadians)
    ? Math.min(PITCH_MAX_RADIANS, Math.max(PITCH_MIN_RADIANS, pitchRadians))
    : 0

/**
 * Apply a look delta to a pose.
 *
 * PURE and exported, so the clamp can be tested without a service — and so the
 * one rule this file adds over the double is visible on its own.
 */
export const applyLook = (
  pose: PlayerPose,
  deltaYaw: number,
  deltaPitch: number,
): PlayerPose => ({
  feetPosition: pose.feetPosition,
  // Not wrapped. See the header: wrapping breaks interpolation across the seam.
  yawRadians: Number.isFinite(deltaYaw) ? pose.yawRadians + deltaYaw : pose.yawRadians,
  pitchRadians: clampPitch(pose.pitchRadians + (Number.isFinite(deltaPitch) ? deltaPitch : 0)),
})

/** Where a player starts when nobody says otherwise. */
export const INITIAL_PLAYER_POSE: PlayerPose = {
  feetPosition: { x: 0, y: 0, z: 0 },
  yawRadians: 0,
  pitchRadians: 0,
}

/** The world a player is in when nobody says otherwise. */
export const INITIAL_DIMENSION: Dimension = 'overworld'

/**
 * How far the eye sits above the feet, in metres.
 *
 * mc-sim's `EYE_LEVEL_OFFSET`, transcribed — `@nerima-games/mc-sim`'s header lists
 * it among the constants deliberately not mirrored. 1.62 is vanilla's, and the
 * distinction it encodes is the one `feetPosition`'s name exists to carry: a
 * camera placed at the feet renders from inside the floor.
 */
export const EYE_LEVEL_OFFSET = 1.62

/** Build a player. */
export const makeInMemoryPlayer = (
  initialPose: PlayerPose = INITIAL_PLAYER_POSE,
  initialDimension: Dimension = INITIAL_DIMENSION,
): Effect.Effect<PlayerServiceApi> =>
  Effect.map(
    Ref.make<{ readonly pose: PlayerPose; readonly dimension: Dimension }>({
      pose: initialPose,
      dimension: initialDimension,
    }),
    (state): PlayerServiceApi => ({
      pose: Effect.map(Ref.get(state), (current) => current.pose),

      dimension: Effect.map(Ref.get(state), (current) => current.dimension),

      look: (deltaYaw, deltaPitch) =>
        Ref.modify(state, (current) => {
          const pose = applyLook(current.pose, deltaYaw, deltaPitch)
          return [pose, { ...current, pose }] as const
        }),

      // POSITION ONLY. Pairing it with `setDimension` is the caller's, and the
      // mirror explains why fusing them here would be the wrong help.
      moveTo: (feetPosition: Position) =>
        Ref.update(state, (current) => ({
          ...current,
          pose: { ...current.pose, feetPosition },
        })),

      setDimension: (dimension) => Ref.update(state, (current) => ({ ...current, dimension })),

      /**
       * The pose a renderer mirrors, with the eye offset applied and the
       * instant it was taken.
       *
       * IT TAKES `ClockPort` IN `R`, which is the whole point of the signature.
       * `@nerima-games/mc-sim` quotes the reason: 「making the clock dependency
       * visible in the type is what stops someone "simplifying" this into a
       * `Date.now()` call」 — and DN-GP-8 bans that call here outright, with
       * `pnpm check:deps` enforcing it.
       *
       * `test/support/player-service-double.ts` DIES on this member on purpose,
       * because a rule in this repository reaching it has found a rule reading
       * a clock. That is right for a double and wrong for a service a host
       * composes: the host's renderer is exactly who should call it.
       */
      cameraPose: Effect.flatMap(ClockPort, (clock) =>
        Effect.map(
          Effect.zip(Ref.get(state), clock.monotonicSecs),
          ([current, capturedAtSecs]): CameraPoseSnapshot => ({
            position: {
              x: current.pose.feetPosition.x,
              y: current.pose.feetPosition.y + EYE_LEVEL_OFFSET,
              z: current.pose.feetPosition.z,
            },
            yawRadians: current.pose.yawRadians,
            pitchRadians: current.pose.pitchRadians,
            capturedAtSecs,
          }),
        ),
      ),

      /**
       * Install a saved pose and dimension.
       *
       * THE PITCH IS RE-CLAMPED. A save is untrusted — it may have been written
       * by a build whose clamp differed, or edited by hand — and installing a
       * vertical pitch would reproduce the degenerate basis on the first frame
       * after a load, where it is hardest to attribute.
       */
      restore: (pose, dimension) =>
        Ref.set(state, {
          pose: { ...pose, pitchRadians: clampPitch(pose.pitchRadians) },
          dimension,
        }),

      // A NEW world, not a reloaded one — both halves back to spawn.
      reset: Ref.set(state, { pose: INITIAL_PLAYER_POSE, dimension: INITIAL_DIMENSION }),
    }),
  )

/** The player as a Layer, for a host that composes `gameplayModule`. */
export const InMemoryPlayerLayer = (
  initialPose: PlayerPose = INITIAL_PLAYER_POSE,
  initialDimension: Dimension = INITIAL_DIMENSION,
): Layer.Layer<PlayerService> =>
  Layer.effect(PlayerService, makeInMemoryPlayer(initialPose, initialDimension))
