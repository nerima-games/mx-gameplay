import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Option, Ref } from 'effect'
import {
  BlockAxis,
  DeltaTimeSecs,
  MAX_PORTAL_HEIGHT,
  MAX_PORTAL_WIDTH,
  MIN_PORTAL_HEIGHT,
  MIN_PORTAL_WIDTH,
  PortalHeight,
  PortalWidth,
  blockIdOf,
  blockPosition,
  type PortalAxis,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import {
  generatePortalLayout,
  NETHER_HORIZONTAL_RATIO,
  type Dimension,
} from '@nerima-games/mc-worldgen'
import { makeChunkStoreDouble, world } from '../support/chunk-store-double'
import { chunkCoordsAround } from '../../src/domain/chunk-window'
import { PORTAL_WINDOW_RADIUS, ignitePortal } from '../../src/domain/interactions/ignite-portal'
import { applyEndPortalTravel } from '../../src/domain/end-portal-travel'
import {
  advanceEyeOfEnder,
  EYE_OF_ENDER_ARC_HEIGHT,
  EYE_OF_ENDER_FLIGHT_SECS,
  EYE_OF_ENDER_MAX_HORIZONTAL_DISTANCE,
  initialEyeOfEnderRuntimeState,
  launchEyeOfEnder,
} from '../../src/domain/interactions/use-eye-of-ender'
import {
  OUTSIDE_PORTAL,
  PORTAL_ACTIVATION_SECS,
  stepPortalDwell,
  type PortalDwell,
} from '../../src/domain/portal-dwell'
import { applyPortalTravel } from '../../src/domain/portal-travel'
import { makePlayerServiceDouble, SPAWN_POSE } from '../support/player-service-double'

const atBlockPosition = (x: number, y: number, z: number): BlockPosition =>
  blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

const coordinate = FastCheck.integer({ min: -1_024, max: 1_024 })
const blockPositionArbitrary = FastCheck.tuple(coordinate, coordinate, coordinate).map(
  ([x, y, z]) => atBlockPosition(x, y, z),
)

const runNetherRoundTrip = (
  initialDimension: Dimension,
  source: BlockPosition,
) =>
  Effect.runSync(Effect.orDie(Effect.gen(function* () {
    const player = yield* makePlayerServiceDouble(SPAWN_POSE, initialDimension)
    const outbound = yield* applyPortalTravel(player.api, source)
    const inbound = yield* applyPortalTravel(player.api, outbound.destination)

    return {
      finalDimension: yield* player.api.dimension,
      inbound,
      moves: yield* Ref.get(player.moves),
      outbound,
      switches: yield* Ref.get(player.switches),
    }
  })))

const runEndPortalTravel = (dimension: Dimension, source: BlockPosition) =>
  Effect.runSync(Effect.orDie(Effect.gen(function* () {
    const player = yield* makePlayerServiceDouble(SPAWN_POSE, dimension)
    const event = yield* applyEndPortalTravel(player.api, source)

    return {
      dimension: yield* player.api.dimension,
      event,
      moves: yield* Ref.get(player.moves),
      switches: yield* Ref.get(player.switches),
    }
  })))

const deltaTime = (seconds: number): DeltaTimeSecs => DeltaTimeSecs(seconds)

// A maximum-size frame still fits inside PORTAL_WINDOW_RADIUS on either axis from this origin.
const PORTAL_ORIGIN = atBlockPosition(4, 64, 20)
const OBSIDIAN = Option.getOrThrow(blockIdOf('obsidian'))

const portalEntries = (frame: ReadonlyArray<BlockPosition>) =>
  frame.map((cell) => [cell, OBSIDIAN] as const)

const blockPositionKeys = (positions: ReadonlyArray<BlockPosition>) =>
  positions.map(({ x, y, z }) => `${String(x)},${String(y)},${String(z)}`).sort()

const residentPortalChunks = (): ReadonlyArray<string> =>
  chunkCoordsAround(PORTAL_ORIGIN, PORTAL_WINDOW_RADIUS).map(
    (coord) => `${String(coord.cx)},${String(coord.cz)}`,
  )

describe('portal travel properties', () => {
  // A wrong dimension branch or a non-inverse Nether scale breaks this round trip.
  it.effect('Nether to Overworld and back preserves every cell', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(blockPositionArbitrary, (source) => {
          const roundTrip = runNetherRoundTrip('nether', source)

          expect(roundTrip.outbound.toDimension).toBe('overworld')
          expect(roundTrip.inbound.toDimension).toBe('nether')
          expect(roundTrip.inbound.destination).toStrictEqual(source)
          expect(roundTrip.finalDimension).toBe('nether')
          expect(roundTrip.switches).toStrictEqual(['overworld', 'nether'])
          expect(roundTrip.moves.map(({ x, y, z }) => [x, y, z])).toStrictEqual([
            [roundTrip.outbound.destination.x, roundTrip.outbound.destination.y, roundTrip.outbound.destination.z],
            [roundTrip.inbound.destination.x, roundTrip.inbound.destination.y, roundTrip.inbound.destination.z],
          ])
        }),
      )
    }),
  )

  // Truncating negative coordinates instead of flooring moves the return point above its start.
  it.effect('Overworld round trips land on the lower Nether-aligned cell', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(blockPositionArbitrary, (source) => {
          const roundTrip = runNetherRoundTrip('overworld', source)
          const { destination } = roundTrip.inbound
          const xRemainder = source.x - destination.x
          const zRemainder = source.z - destination.z

          expect(roundTrip.outbound.toDimension).toBe('nether')
          expect(roundTrip.inbound.toDimension).toBe('overworld')
          expect(Math.abs(destination.x % NETHER_HORIZONTAL_RATIO)).toBe(0)
          expect(Math.abs(destination.z % NETHER_HORIZONTAL_RATIO)).toBe(0)
          expect(xRemainder).toBeGreaterThanOrEqual(0)
          expect(xRemainder).toBeLessThan(NETHER_HORIZONTAL_RATIO)
          expect(zRemainder).toBeGreaterThanOrEqual(0)
          expect(zRemainder).toBeLessThan(NETHER_HORIZONTAL_RATIO)
          expect(destination.y).toBe(source.y)
          expect(roundTrip.finalDimension).toBe('overworld')
        }),
      )
    }),
  )

  // If cooldown consults occupancy or carries its expiry frame into dwell, the sequence fails.
  it.effect('cooldown ignores portal occupancy and discards the expiry frame', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 1, max: 32 }),
          FastCheck.array(FastCheck.integer({ min: 0, max: 16 }), { minLength: 1, maxLength: 8 }),
          (cooldownQuarters, frameQuarters) => {
            let dwell: PortalDwell = { _tag: 'Cooling', remainingSecs: cooldownQuarters / 4 }
            let elapsedQuarters = 0
            let expired = false

            for (const frame of frameQuarters) {
              const stepDelta = deltaTime(frame / 4)
              const inside = stepPortalDwell(dwell, true, stepDelta)
              const outside = stepPortalDwell(dwell, false, stepDelta)

              expect(inside).toStrictEqual(outside)
              expect(inside.travels).toBe(false)
              elapsedQuarters += frame

              if (cooldownQuarters > elapsedQuarters) {
                expect(inside.dwell).toStrictEqual({
                  _tag: 'Cooling',
                  remainingSecs: (cooldownQuarters - elapsedQuarters) / 4,
                })
                dwell = inside.dwell
                continue
              }

              expect(inside.dwell).toStrictEqual(OUTSIDE_PORTAL)
              dwell = inside.dwell
              expired = true
              break
            }

            if (expired) {
              const nextFrame = PORTAL_ACTIVATION_SECS / 2
              expect(stepPortalDwell(dwell, true, deltaTime(nextFrame))).toStrictEqual({
                dwell: { _tag: 'Standing', dwelledSecs: nextFrame },
                travels: false,
              })
            }
          },
        ),
      )
    }),
  )

  // A frame-specific destination or a missing dimension switch breaks this transition invariant.
  it.effect('End portal travel maps both dimensions and applies the selected destination', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<Dimension>('overworld', 'end'),
          blockPositionArbitrary,
          (sourceDimension, source) => {
            const result = runEndPortalTravel(sourceDimension, source)

            expect(result.event.sourceDimension).toBe(sourceDimension)
            expect(result.event.sourcePosition).toStrictEqual(source)
            expect(result.dimension).toBe(result.event.toDimension)
            expect(result.switches).toStrictEqual([result.event.toDimension])
            expect(result.moves.map(({ x, y, z }) => [x, y, z])).toStrictEqual([
              [result.event.destination.x, result.event.destination.y, result.event.destination.z],
            ])

            if (sourceDimension === 'overworld') {
              expect(result.event.toDimension).toBe('end')
              const endArrival = atBlockPosition(0, 61, 0)
              expect(result.event.destination).toStrictEqual(endArrival)
              expect(result.event.arrival?.spawn).toStrictEqual(endArrival)
            } else {
              expect(result.event.toDimension).toBe('overworld')
              expect(result.event.destination).toStrictEqual(atBlockPosition(0, 64, 0))
              expect(result.event.arrival).toBeUndefined()
            }
          },
        ),
      )
    }),
  )

  // If ignition misses a valid size or axis, or returns ring cells instead of the interior, this fails.
  it.effect('Nether portal ignition returns every generated interior for valid frame sizes and axes', () =>
    Effect.sync(() => {
      const verifyGeneratedLayout = (axis: PortalAxis, width: number, height: number) => {
        const layout = generatePortalLayout(
          PORTAL_ORIGIN,
          axis,
          PortalWidth(width),
          PortalHeight(height),
        )
        const outcome = Effect.runSync(Effect.gen(function* () {
          const store = yield* makeChunkStoreDouble(
            world(portalEntries(layout.frame)),
            residentPortalChunks(),
          )

          return yield* ignitePortal(store.api, PORTAL_ORIGIN)
        }))

        expect(outcome._tag).toBe('Ready')
        if (outcome._tag !== 'Ready') return
        expect(outcome.frame.axis).toBe(axis)
        expect(outcome.frame.width).toBe(width)
        expect(outcome.frame.height).toBe(height)
        expect(blockPositionKeys(outcome.cells)).toStrictEqual(blockPositionKeys(layout.interior))
      }

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<PortalAxis>('x', 'z'),
          FastCheck.integer({ min: MIN_PORTAL_WIDTH, max: MAX_PORTAL_WIDTH }),
          FastCheck.integer({ min: MIN_PORTAL_HEIGHT, max: MAX_PORTAL_HEIGHT }),
          verifyGeneratedLayout,
        ),
      )

      for (const axis of ['x', 'z'] as const) {
        for (const width of [MIN_PORTAL_WIDTH, MAX_PORTAL_WIDTH]) {
          for (const height of [MIN_PORTAL_HEIGHT, MAX_PORTAL_HEIGHT]) {
            verifyGeneratedLayout(axis, width, height)
          }
        }
      }
    }),
  )
})

describe('Ender eye properties', () => {
  // A reversed bearing or uncapped horizontal travel breaks the generated trajectory.
  it.effect('throws toward the target while respecting its horizontal distance cap', () =>
    Effect.sync(() => {
      const position = FastCheck.record({ x: coordinate, y: coordinate, z: coordinate })
      const input = FastCheck.record({
        dimension: FastCheck.constantFrom<Dimension>('overworld', 'nether', 'end'),
        position,
        target: position,
        breaks: FastCheck.boolean(),
      })

      FastCheck.assert(
        FastCheck.property(input, (thrown) => {
          const state = launchEyeOfEnder(initialEyeOfEnderRuntimeState(), thrown)
          const eye = state.eyes[0]!
          const targetDx = thrown.target.x - thrown.position.x
          const targetDz = thrown.target.z - thrown.position.z
          const eyeDx = eye.destination.x - thrown.position.x
          const eyeDz = eye.destination.z - thrown.position.z
          const targetDistance = Math.hypot(targetDx, targetDz)

          expect(Math.hypot(eyeDx, eyeDz)).toBeCloseTo(
            Math.min(targetDistance, EYE_OF_ENDER_MAX_HORIZONTAL_DISTANCE),
            8,
          )
          expect(eyeDx * targetDz - eyeDz * targetDx).toBeCloseTo(0, 8)
          expect(eyeDx * targetDx + eyeDz * targetDz).toBeGreaterThanOrEqual(0)
          expect(eye.destination.y - thrown.position.y).toBe(EYE_OF_ENDER_ARC_HEIGHT)
          expect(eye.dimension).toBe(thrown.dimension)
          expect(eye.breaks).toBe(thrown.breaks)
        }),
      )
    }),
  )

  // If subdivision changes endpoint settlement or leaves a completed eye active, this fails.
  it.effect('settles once at the same endpoint after split or whole flight time', () =>
    Effect.sync(() => {
      const position = FastCheck.record({ x: coordinate, y: coordinate, z: coordinate })
      const input = FastCheck.record({
        dimension: FastCheck.constantFrom<Dimension>('overworld', 'nether', 'end'),
        position,
        target: position,
        breaks: FastCheck.boolean(),
      })

      FastCheck.assert(
        FastCheck.property(input, (thrown) => {
          const launched = launchEyeOfEnder(initialEyeOfEnderRuntimeState(), thrown)
          const eye = launched.eyes[0]!
          const halfFlight = EYE_OF_ENDER_FLIGHT_SECS / 2
          const wholeHalf = advanceEyeOfEnder(launched, thrown.dimension, halfFlight)
          const firstHalf = advanceEyeOfEnder(launched, thrown.dimension, halfFlight / 2)
          const split = advanceEyeOfEnder(firstHalf.state, thrown.dimension, halfFlight / 2)

          expect(split.state.eyes).toStrictEqual(wholeHalf.state.eyes)
          expect(split.settlements).toStrictEqual(wholeHalf.settlements)

          const splitToSettlement = advanceEyeOfEnder(split.state, thrown.dimension, halfFlight)
          const settled = advanceEyeOfEnder(launched, thrown.dimension, eye.flightSeconds)
          expect(splitToSettlement.state.eyes).toStrictEqual(settled.state.eyes)
          expect(splitToSettlement.settlements).toStrictEqual(settled.settlements)
          expect(settled.state.eyes).toStrictEqual([])
          expect(settled.settlements).toStrictEqual([{
            eyeId: eye.id,
            dimension: thrown.dimension,
            position: eye.destination,
            breaks: thrown.breaks,
          }])
          expect(advanceEyeOfEnder(settled.state, thrown.dimension, eye.flightSeconds).settlements).toStrictEqual([])
        }),
      )
    }),
  )
})
