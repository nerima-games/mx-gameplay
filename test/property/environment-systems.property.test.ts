import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { Result } from 'effect'
import { CHUNK_SIZE_XZ, blockPositionKeyOf } from '@nerima-games/mc-kernel'
import {
  advanceFireLifecycle,
  FIRE_UNAVAILABLE_BLOCK,
  FIRE_UNLOADED_RETRY_LIMIT,
  type FirePosition,
} from '../../src/domain/fire-lifecycle'
import {
  dayPhase as dayPhaseResult,
  hostileSpawnsAllowed as hostileSpawnsAllowedResult,
  isNight as isNightResult,
} from '../../src/domain/day-night'
import { chunkCoordsAround } from '../../src/domain/chunk-window'
import {
  disturb,
  emptyFallingBlockQueue,
  takeBatch,
} from '../../src/domain/falling-block'
import {
  resolveNextWeatherState as resolveNextWeatherStateResult,
  WEATHER_DURATION_RANGES,
  WEATHERS,
} from '../../src/domain/weather'
import { blockPosition } from '../support/coordinate-fixtures'

const dayPhase = (timeOfDay: number) => Result.getOrThrow(dayPhaseResult(timeOfDay))
const hostileSpawnsAllowed = (timeOfDay: number) => Result.getOrThrow(hostileSpawnsAllowedResult(timeOfDay))
const isNight = (timeOfDay: number) => Result.getOrThrow(isNightResult(timeOfDay))

const positionKey = (id: number) => blockPositionKeyOf(blockPosition(0, id, 0))

describe('environment state properties', () => {
  it('keeps falling-block disturbances in first-seen order without duplicates', () => {
    // Catches repeated disturbances reordering work or growing the queue without bound.
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -32, max: 32 }), { maxLength: 96 }), (ids) => {
        const keys = ids.map(positionKey)
        const queue = disturb(emptyFallingBlockQueue, keys)

        expect([...queue.pending]).toStrictEqual([...new Set(keys)])
      }),
    )
  })

  it('takes a bounded falling-block prefix and leaves every other position queued once', () => {
    // Catches a batch that exceeds its budget or drops/reorders deferred positions.
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -64, max: 64 }), { maxLength: 64 }),
        fc.integer({ min: 0, max: 80 }),
        (ids, budget) => {
          const keys = ids.map(positionKey)
          const { batch, rest } = takeBatch(disturb(emptyFallingBlockQueue, keys), budget)
          const splitAt = Math.min(budget, keys.length)

          expect(batch.length).toBeLessThanOrEqual(budget)
          expect(batch).toStrictEqual(keys.slice(0, splitAt))
          expect([...rest.pending]).toStrictEqual(keys.slice(splitAt))
          expect(new Set([...batch, ...rest.pending]).size).toBe(keys.length)
        },
      ),
    )
  })

  it('increments an unloaded fire retry only until its configured limit', () => {
    // Catches an off-by-one that loses an unloaded fire early or retains it forever.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FIRE_UNLOADED_RETRY_LIMIT + 1 }),
        (unloadedRetries) => {
          const position: FirePosition = { x: 0, y: 64, z: 0 }
          const step = Result.getOrThrow(advanceFireLifecycle(
            { fires: [{ position, ageTicks: 0, unloadedRetries }], seed: 1 },
            [{ position, block: FIRE_UNAVAILABLE_BLOCK }],
            'clear',
          ))

          expect(step.mutations).toStrictEqual([])
          if (unloadedRetries < FIRE_UNLOADED_RETRY_LIMIT) {
            expect(step.state.fires).toStrictEqual([
              { position, ageTicks: 0, unloadedRetries: unloadedRetries + 1 },
            ])
          } else {
            expect(step.state.fires).toStrictEqual([])
          }
        },
      ),
    )
  })

  it('extinguishes every exposed fire during rain or thunder', () => {
    // Catches weather changes that leave exposed active fire burning.
    fc.assert(
      fc.property(fc.constantFrom('rain', 'thunder'), (weather) => {
        const position: FirePosition = { x: 3, y: 64, z: -2 }
        const below: FirePosition = { ...position, y: position.y - 1 }
        const step = Result.getOrThrow(advanceFireLifecycle(
          { fires: [{ position, ageTicks: 1 }], seed: 7 },
          [
            { position, block: 'fire', exposedToSky: true },
            { position: below, block: 'stone' },
          ],
          weather,
        ))

        expect(step.mutations).toContainEqual({ position, block: 'air' })
        expect(step.state.fires).toStrictEqual([])
      }),
    )
  })

  it('preserves day phase and hostile-spawn gating when the clock shifts whole days', () => {
    // Catches day-boundary arithmetic that changes the same time-of-day's gameplay phase.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999 }),
        fc.integer({ min: -32, max: 32 }),
        (fractionalMillionths, dayOffset) => {
          const timeOfDay = fractionalMillionths / 1_000_000
          const shifted = timeOfDay + dayOffset

          expect(dayPhase(shifted)).toBe(dayPhase(timeOfDay))
          expect(isNight(shifted)).toBe(isNight(timeOfDay))
          expect(hostileSpawnsAllowed(shifted)).toBe(hostileSpawnsAllowed(timeOfDay))
        },
      ),
    )
  })

  it('moves weather to another legal state with a duration inside its range', () => {
    // Catches self-transitions and countdowns outside the selected weather's legal interval.
    fc.assert(
      fc.property(
        fc.constantFrom(...WEATHERS),
        fc.double({ min: 0, max: 1 }),
        fc.double({ min: 0, max: 1 }),
        (current, transitionRoll, durationRoll) => {
          const nextResult = resolveNextWeatherStateResult(current, {
            transition: transitionRoll,
            duration: durationRoll,
          })
          const invalidField = !Number.isFinite(transitionRoll)
            ? 'transition'
            : !Number.isFinite(durationRoll)
              ? 'duration'
              : undefined
          if (invalidField !== undefined) {
            expect(nextResult).toStrictEqual(Result.fail({
              _tag: 'InvalidWeatherInput',
              field: invalidField,
            }))
            return
          }
          const next = Result.getOrThrow(nextResult)
          const range = WEATHER_DURATION_RANGES[next.weather]

          expect(next.weather).not.toBe(current)
          expect(next.remainingSecs).toBeGreaterThanOrEqual(range.min)
          expect(next.remainingSecs).toBeLessThanOrEqual(range.max)
        },
      ),
    )
  })

  it('translates chunk windows by whole chunks across negative and positive boundaries', () => {
    // Catches truncation or edge loss when a chunk window crosses a negative boundary.
    fc.assert(
      fc.property(
        fc.integer({ min: -96, max: 96 }),
        fc.integer({ min: -96, max: 96 }),
        fc.integer({ min: 0, max: 40 }),
        (x, z, radius) => {
          const window = chunkCoordsAround({ x, y: 64, z }, radius)
          const shifted = chunkCoordsAround(
            { x: x + CHUNK_SIZE_XZ, y: 64, z: z - 2 * CHUNK_SIZE_XZ },
            radius,
          )
          const key = (cx: number, cz: number): string => `${String(cx)},${String(cz)}`
          const normalize = (coords: ReadonlyArray<{ readonly cx: number; readonly cz: number }>) =>
            coords.map(({ cx, cz }) => key(cx, cz)).sort()
          const expected: Array<string> = []
          const minCx = Math.floor((x - radius) / CHUNK_SIZE_XZ)
          const maxCx = Math.floor((x + radius) / CHUNK_SIZE_XZ)
          const minCz = Math.floor((z - radius) / CHUNK_SIZE_XZ)
          const maxCz = Math.floor((z + radius) / CHUNK_SIZE_XZ)
          for (let cx = minCx; cx <= maxCx; cx += 1) {
            for (let cz = minCz; cz <= maxCz; cz += 1) expected.push(key(cx, cz))
          }

          expect(new Set(normalize(window)).size).toBe(window.length)
          expect(normalize(window)).toStrictEqual(expected.sort())
          expect(normalize(shifted)).toStrictEqual(
            normalize(window.map(({ cx, cz }) => ({ cx: cx + 1, cz: cz - 2 }))),
          )
        },
      ),
    )
  })
})
