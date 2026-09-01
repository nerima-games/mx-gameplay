/**
 * Multi-angle verification for minecart rail physics, run through the real
 * `advanceVehicles` frame function against a real `ChunkStoreApi`
 * (`makeInMemoryChunkStore`) and a real `VehicleServiceApi`
 * (`@nerima-games/mc-sim`'s `makeVehicleService`) — not doubles, and not
 * `stepMinecart` called once with hand-picked arguments the way
 * `test/vehicle-motion.test.ts` and `test/vehicle-frame.test.ts` do.
 *
 * Per-function coverage on `stepMinecart` is 100% (`vitest.config.ts`'s
 * thresholds) and still cannot see three properties that only exist across
 * MANY ticks of the same rule:
 *
 *   - DRIFT: floating-point position error compounding tick over tick on a
 *     track that should return the cart to where it started;
 *   - FRAME-RATE DEPENDENCE: the same elapsed wall time, split into a
 *     different number of frames, landing at a different position;
 *   - UNBOUNDED SPEED: an accumulation bug that lets the powered-rail
 *     acceleration term walk past its own cap over a long run.
 *
 * A single-call unit test cannot fail any of these even when the rule is
 * broken, because there is no "across many ticks" for it to be wrong over.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOOP IS OUT-AND-BACK, NOT A RECTANGLE WITH CORNERS
 * ---------------------------------------------------------------------------
 *
 * `resolveRailShape` never reads `railKind`, so the rule is direction- and
 * kind-agnostic: running it backwards over the same cells is the same rule,
 * not a special case, which is what makes an out-and-back trip a legitimate
 * closed loop for this property (start state == end state) rather than a
 * weaker substitute for one.
 *
 * A true 90-degree corner was deliberately NOT used to close the loop the
 * other way (four straight legs joined by `'curve'` cells). Tracing it
 * through `projectMinecartVelocity` (`domain/vehicle/rail-shape.ts`) shows
 * why: at a grid corner the join cell always sees rail on BOTH axes, so it
 * always resolves to `'curve'`, and `projectMinecartVelocity('curve', vx,
 * vz)` keeps whichever axis already dominates the incoming velocity
 * (`towardX`) rather than steering onto the other one. A cart arriving
 * axis-aligned — which is the only way a preceding straight segment ever
 * hands one off, since `'ns'`/`'ew'` zero the other axis outright — carries
 * that same axis straight through the corner cell and off the end of the
 * track instead of turning. `test/rail.test.ts`'s pinned cases for `'curve'`
 * (`projectMinecartVelocity('curve', 3, 4)` etc.) only ever exercise inputs
 * that already have a large component on both axes, which never arises from
 * this physics, so the gap is invisible to that oracle. This is a real
 * finding, reported rather than silently patched: fixing it would mean
 * inventing corner-steering behaviour with no reference oracle behind it,
 * which is the opposite of this repository's "port the spec, do not
 * reinvent it" rule (docs/testing.md §2-2).
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { blockIdOf, blockPosition, type BlockPosition } from '@nerima-games/mc-kernel'
import { makeVehicleService, type Vehicle, type VehicleServiceApi } from '@nerima-games/mc-sim'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import {
  cellKey,
  chunkKey,
  chunkOf,
  makeInMemoryChunkStore,
  type WorldContents,
} from '../src/domain/in-memory-chunk-store'
import { advanceVehicles, type VehicleFrameEnvironment } from '../src/domain/vehicle/vehicle-frame'
import { MINECART_MAX_SPEED } from '../src/domain/vehicle/vehicle-motion'

const POWERED_RAIL = blockIdOf('powered_rail')

/** A straight east-west powered-rail strip at y=64, z=0, covering `[-margin, length + margin]` on x. */
const straightPoweredTrack = (length: number, margin = 5): WorldContents => {
  const cells: Array<readonly [BlockPosition, typeof POWERED_RAIL]> = []
  for (let x = -margin; x <= length + margin; x += 1) {
    cells.push([blockPosition(x, 64, 0), POWERED_RAIL])
  }
  return {
    blocks: new Map(cells.map(([position, block]) => [cellKey(position), block])),
    loaded: [...new Set(cells.map(([position]) => chunkKey(chunkOf(position))))],
  }
}

const makeRig = (world: WorldContents) =>
  Effect.gen(function* () {
    const store: ChunkStoreApi = yield* makeInMemoryChunkStore(world)
    const vehicles = yield* makeVehicleService()
    return { store, vehicles }
  })

// Every rig in this file holds exactly one vehicle: dying on an empty roster
// is louder than a `!` that could quietly read `undefined` as a vehicle.
const soleVehicle = (vehicles: VehicleServiceApi): Effect.Effect<Vehicle> =>
  Effect.flatMap(vehicles.vehicles, (roster) => {
    const found = roster[0]
    return found === undefined
      ? Effect.dieMessage('expected exactly one vehicle in the roster')
      : Effect.succeed(found)
  })

const alwaysPowered: VehicleFrameEnvironment = { isPoweredRailAt: () => true }

describe('vehicle rail simulation: multi-angle integration', () => {
  it.effect('REGRESSION-GUARD: a powered-rail out-and-back returns to its start position across repeated round trips', () =>
    Effect.gen(function* () {
      const { store, vehicles } = yield* makeRig(straightPoweredTrack(30))
      const start = { x: 1, y: 64, z: 0 }
      const vehicle = yield* vehicles.spawn('minecart', 'overworld', start, 0)
      yield* vehicles.updateVelocity(vehicle.id, { x: MINECART_MAX_SPEED, y: 0, z: 0 })

      const dt = 0.1
      const legSteps = 25 // 2.5s at MINECART_MAX_SPEED covers 20 blocks, inside the 30-block track
      const roundTrips = 3
      const returnedPositions: number[] = []

      for (let trip = 0; trip < roundTrips; trip += 1) {
        for (let i = 0; i < legSteps; i += 1) {
          yield* advanceVehicles(store, vehicles, dt, alwaysPowered)
        }
        const outbound = yield* soleVehicle(vehicles)
        // Reverse direction for the return leg. `resolveRailShape` reads no
        // `railKind` (see module header), so running the straight rule
        // backwards over the same cells is the same rule, not a special case.
        yield* vehicles.updateVelocity(vehicle.id, {
          x: -outbound.velocity.x,
          y: outbound.velocity.y,
          z: outbound.velocity.z,
        })
        for (let i = 0; i < legSteps; i += 1) {
          yield* advanceVehicles(store, vehicles, dt, alwaysPowered)
        }
        const returned = yield* soleVehicle(vehicles)
        returnedPositions.push(returned.position.x)
        yield* vehicles.updateVelocity(vehicle.id, { x: MINECART_MAX_SPEED, y: 0, z: 0 })
      }

      // Each lap is independently this close to `start.x` — not merely the
      // last one — so a bug that drifts a little further on every lap cannot
      // hide behind an end-of-run-only assertion.
      for (const x of returnedPositions) {
        expect(Math.abs(x - start.x)).toBeLessThan(1e-6)
      }
    }))

  it.effect('the same elapsed time at three different frame rates lands at the same position', () =>
    Effect.gen(function* () {
      const totalSeconds = 2
      // 1/30 does not divide 2s evenly, so its last frame straddles the
      // boundary rather than landing exactly on it — the case a convenient
      // dt of 0.1 or 0.05 can never exercise.
      const rates = [0.1, 0.05, 1 / 30]

      const finalPositions: number[] = []
      for (const dt of rates) {
        const { store, vehicles } = yield* makeRig(straightPoweredTrack(40))
        const vehicle = yield* vehicles.spawn('minecart', 'overworld', { x: 1, y: 64, z: 0 }, 0)
        yield* vehicles.updateVelocity(vehicle.id, { x: MINECART_MAX_SPEED, y: 0, z: 0 })

        let elapsed = 0
        while (elapsed < totalSeconds) {
          const step = Math.min(dt, totalSeconds - elapsed)
          yield* advanceVehicles(store, vehicles, step, alwaysPowered)
          elapsed += step
        }
        const final = yield* soleVehicle(vehicles)
        finalPositions.push(final.position.x)
      }

      const [first, ...rest] = finalPositions
      const reference = first === undefined
        ? yield* Effect.dieMessage('expected at least one frame rate to compare')
        : first
      for (const x of rest) {
        expect(x).toBeCloseTo(reference, 6)
      }
    }))

  it.effect('a frame slower than the physics clamp advances no further than the clamp', () =>
    Effect.gen(function* () {
      // `advanceVehicles`'s internal `elapsedFor` clamps to 0.1s of simulated
      // time per call regardless of the caller's `dt` — so a 0.2s frame must
      // move the cart exactly as far as a 0.1s frame did. That is a
      // frame-rate-independence claim at the one boundary a family of small,
      // evenly-divided dt values (0.1 / 0.05 / 0.025 …) can never reach.
      const atClampRig = yield* makeRig(straightPoweredTrack(10))
      const atClampVehicle = yield* atClampRig.vehicles.spawn('minecart', 'overworld', { x: 1, y: 64, z: 0 }, 0)
      yield* atClampRig.vehicles.updateVelocity(atClampVehicle.id, { x: 0, y: 0, z: 0 })
      yield* advanceVehicles(atClampRig.store, atClampRig.vehicles, 0.1, alwaysPowered)
      const atClamp = yield* soleVehicle(atClampRig.vehicles)

      const overLongRig = yield* makeRig(straightPoweredTrack(10))
      const overLongVehicle = yield* overLongRig.vehicles.spawn('minecart', 'overworld', { x: 1, y: 64, z: 0 }, 0)
      yield* overLongRig.vehicles.updateVelocity(overLongVehicle.id, { x: 0, y: 0, z: 0 })
      yield* advanceVehicles(overLongRig.store, overLongRig.vehicles, 0.2, alwaysPowered)
      const overLong = yield* soleVehicle(overLongRig.vehicles)

      expect(overLong.position).toStrictEqual(atClamp.position)
      expect(overLong.velocity).toStrictEqual(atClamp.velocity)
    }))

  it.effect('speed on a powered rail stays bounded at MINECART_MAX_SPEED over a long run', () =>
    Effect.gen(function* () {
      const { store, vehicles } = yield* makeRig(straightPoweredTrack(2500))
      const vehicle = yield* vehicles.spawn('minecart', 'overworld', { x: 1, y: 64, z: 0 }, 0)
      yield* vehicles.updateVelocity(vehicle.id, { x: 1, y: 0, z: 0 })

      const dt = 0.1
      const steps = 3000 // 300 simulated seconds, ~2400 blocks at top speed

      for (let i = 0; i < steps; i += 1) {
        yield* advanceVehicles(store, vehicles, dt, alwaysPowered)
        const current = yield* soleVehicle(vehicles)
        const speed = Math.hypot(current.velocity.x, current.velocity.y, current.velocity.z)
        // Bounded on EVERY sampled tick, not only at the end of the run — an
        // accumulation bug that overshoots for a few ticks and then
        // self-corrects would still pass an end-of-run-only assertion.
        expect(speed).toBeLessThanOrEqual(MINECART_MAX_SPEED + 1e-9)
      }
      const settled = yield* soleVehicle(vehicles)
      const finalSpeed = Math.hypot(settled.velocity.x, settled.velocity.y, settled.velocity.z)
      expect(finalSpeed).toBeCloseTo(MINECART_MAX_SPEED, 6)
    }))
})
