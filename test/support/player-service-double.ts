/**
 * A `PlayerServiceApi` double, for stages that must be driven without mc-sim.
 *
 * mc-sim is not a `dependencies` edge yet (plan.md §6 Step 3 publishes
 * bottom-up), so the real service cannot be constructed in this repository's
 * tests. `domain/player-port.ts` mirrors the interface; this builds a working
 * instance of it over plain `Ref`s.
 *
 * IT IS A REAL IMPLEMENTATION, NOT A STUB THAT RETURNS CONSTANTS, and that is
 * the point for the portal tests: `stepPortalTravel` reads `pose`, writes
 * through `moveTo`, and writes again through `setDimension`, so a double whose
 * `moveTo` did nothing would let a broken wiring pass. The pose and the
 * dimension here behave as mc-sim's do — `mc-sim/test/player-service.test.ts`
 * pins the same behaviours on the other side.
 *
 * `cameraPose` DIES rather than returning a value. Nothing in this repository
 * may call it (`domain/player-port.ts` says so and `pnpm check:deps` enforces
 * the reason), so a test that reaches it has found a rule reading a clock, and
 * failing loudly is the useful answer.
 */
import { Effect, Layer, Ref } from 'effect'
import type { Dimension } from '../../src/domain/nether-travel-port'
import { PlayerService, type PlayerPose, type PlayerServiceApi } from '../../src/domain/player-port'
import type { Position } from '../../src/domain/entity-manager-port'

/** mc-sim's `INITIAL_PLAYER_POSE`, restated. */
export const SPAWN_POSE: PlayerPose = {
  feetPosition: { x: 0, y: 64, z: 0 },
  yawRadians: 0,
  pitchRadians: 0,
}

export type PlayerServiceDouble = {
  readonly api: PlayerServiceApi
  /** Every `moveTo`, in order. Empty means the placement half never ran. */
  readonly moves: Ref.Ref<ReadonlyArray<Position>>
  /** Every `setDimension`, in order. Empty means the switch half never ran. */
  readonly switches: Ref.Ref<ReadonlyArray<Dimension>>
}

export const makePlayerServiceDouble = (
  initialPose: PlayerPose = SPAWN_POSE,
  initialDimension: Dimension = 'overworld',
): Effect.Effect<PlayerServiceDouble> =>
  Effect.gen(function* () {
    const pose = yield* Ref.make<PlayerPose>(initialPose)
    const dimension = yield* Ref.make<Dimension>(initialDimension)
    const moves = yield* Ref.make<ReadonlyArray<Position>>([])
    const switches = yield* Ref.make<ReadonlyArray<Dimension>>([])

    const api: PlayerServiceApi = {
      pose: Ref.get(pose),
      dimension: Ref.get(dimension),
      look: (deltaYaw, deltaPitch) =>
        Ref.updateAndGet(pose, (current) => ({
          ...current,
          yawRadians: current.yawRadians + deltaYaw,
          pitchRadians: current.pitchRadians + deltaPitch,
        })),
      moveTo: (feetPosition) =>
        Effect.zipRight(
          Ref.update(pose, (current) => ({ ...current, feetPosition })),
          Ref.update(moves, (seen) => [...seen, feetPosition]),
        ),
      setDimension: (next) =>
        Effect.zipRight(
          Ref.set(dimension, next),
          Ref.update(switches, (seen) => [...seen, next]),
        ),
      cameraPose: Effect.die('cameraPose is mc-render’s; mx-gameplay must not read a clock'),
      restore: (next, nextDimension) =>
        Effect.zipRight(Ref.set(pose, next), Ref.set(dimension, nextDimension)),
      reset: Effect.zipRight(Ref.set(pose, SPAWN_POSE), Ref.set(dimension, 'overworld')),
    }

    return { api, moves, switches }
  })

/**
 * The double as a `Layer`, for the tag-based `makeGameplayStages` path.
 *
 * PROVIDING mc-sim's TAG FROM A TEST IS SAFE HERE AND WOULD NOT BE IN `domain/`.
 * `domain/player-port.ts` deliberately omits `PlayerServiceLayer` because this
 * repository must never build a second authority for the player's pose. A test
 * fixture is not that: it exists to satisfy a requirement the host would
 * satisfy with mc-sim's own layer, and nothing outside `test/` can reach it.
 */
export const playerDoubleLayer: Layer.Layer<PlayerService> = Layer.effect(
  PlayerService,
  Effect.map(makePlayerServiceDouble(), (double) => double.api),
)
