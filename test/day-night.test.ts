/**
 * The day/night rule, and the property that makes it a rule at all.
 *
 * plan.md §2.3-1 splits the roster into nouns and verbs: foundation
 * repositories hold state, experience repositories hold rules. The time of day
 * has to survive a save/load round trip, so it is a noun and it is mc-sim's
 * (`mc-sim/domain/time-of-day.ts`, behind `application/time-service.ts`).
 * mx-gameplay's share is what the world DOES about the hour.
 *
 * This repository once held a second copy of the noun — `timeOfDaySecs` and
 * `dayLengthSecs` `Ref`s advanced by the `gameplay:time-weather` stage.
 * mc-sim 0.10.0 now owns the 24,000-tick, 20 Hz day. The first describe block
 * below keeps this module free of clock state; its spawn window stays separate
 * from mc-sim's simulation-night predicate.
 */
import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Result } from 'effect'
import { isNight as isSimulationNight } from '@nerima-games/mc-sim'
import * as dayNight from '../src/domain/day-night'
import {
  DAWN_FRACTION,
  DUSK_FRACTION,
  dayPhase as dayPhaseResult,
  hostileSpawnsAllowed as hostileSpawnsAllowedResult,
  isNight as isNightResult,
  NIGHT_END_FRACTION,
  NIGHT_START_FRACTION,
  NOON_FRACTION,
  TWILIGHT_BAND,
} from '../src/domain/day-night'

/** Every fraction the rule is asked about, at a resolution finer than a frame. */
const acrossTheDay = Array.from({ length: 1_000 }, (_, index) => index / 1_000)
const isNight = (timeOfDay: number) => Result.getOrThrow(isNightResult(timeOfDay))
const dayPhase = (timeOfDay: number) => Result.getOrThrow(dayPhaseResult(timeOfDay))
const hostileSpawnsAllowed = (timeOfDay: number) => Result.getOrThrow(hostileSpawnsAllowedResult(timeOfDay))

describe('the rule holds no state of its own', () => {
  // REGRESSION, and the point of the whole module. A rule that stores anything
  // is a second owner of the thing it stores, and the thing here is the time of
  // day — which mc-sim persists. Two owners means two answers, and only one of
  // them reaches the save file.
  it.effect('exports only functions and plain numbers — no Ref, no factory, no mutable cell', () =>
    Effect.sync(() => {
      for (const [name, value] of Object.entries(dayNight)) {
        expect(
          typeof value === 'function' || typeof value === 'number',
          `${name} is a ${typeof value}; the day/night rule may hold only functions and constants`,
        ).toBe(true)
      }
    }),
  )

  // A stateful rule betrays itself by answering differently the second time.
  it.effect('REGRESSION: every function is a pure function of its argument — repeat calls agree', () =>
    Effect.sync(() => {
      for (const fraction of acrossTheDay) {
        expect(isNight(fraction)).toBe(isNight(fraction))
        expect(dayPhase(fraction)).toBe(dayPhase(fraction))
        expect(hostileSpawnsAllowed(fraction)).toBe(hostileSpawnsAllowed(fraction))
      }
    }),
  )

  // ...and by caring what it was asked before. Walking the day forwards and
  // then backwards must produce the same answers at the same fractions.
  it.effect('REGRESSION: the answer at an hour does not depend on which hours were asked first', () =>
    Effect.sync(() => {
      const forwards = acrossTheDay.map(dayPhase)
      const backwards = [...acrossTheDay].reverse().map(dayPhase).reverse()
      expect(backwards).toStrictEqual(forwards)
    }),
  )

  // REGRESSION: no day-length constant here. mc-sim 0.10.0 owns a 24,000-tick
  // day at 20 ticks/s, and this rule remains expressed over a fraction.
  it.effect('REGRESSION: takes a fraction of the day, so no day length is duplicated here', () =>
    Effect.sync(() => {
      expect(Object.keys(dayNight)).not.toContain('DEFAULT_DAY_LENGTH_SECS')
      expect(Object.keys(dayNight)).not.toContain('TICKS_PER_SECOND')
      // Every exported constant is a fraction of one day, in [0, 1].
      const constants = Object.entries(dayNight).filter(([, value]) => typeof value === 'number')
      expect(constants.length).toBeGreaterThan(0)
      for (const [name, value] of constants) {
        expect(value as number, name).toBeGreaterThanOrEqual(0)
        expect(value as number, name).toBeLessThanOrEqual(1)
      }
    }),
  )
})

describe('when night is', () => {
  it.effect('returns typed failures for the full non-finite input class', () =>
    Effect.sync(() => {
      const nonFinite = FastCheck.double({ noNaN: false, noDefaultInfinity: false })
      FastCheck.assert(FastCheck.property(nonFinite, (timeOfDay) => {
        const night = isNightResult(timeOfDay)
        const phase = dayPhaseResult(timeOfDay)
        const hostile = hostileSpawnsAllowedResult(timeOfDay)
        expect(Result.isFailure(night)).toBe(!Number.isFinite(timeOfDay))
        expect(Result.isFailure(phase)).toBe(!Number.isFinite(timeOfDay))
        expect(Result.isFailure(hostile)).toBe(!Number.isFinite(timeOfDay))
      }))
      for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined]) {
        expect(Result.isFailure(isNightResult(invalid as number))).toBe(true)
        expect(Result.isFailure(dayPhaseResult(invalid as number))).toBe(true)
        expect(Result.isFailure(hostileSpawnsAllowedResult(invalid as number))).toBe(true)
      }
    }),
  )

  it.effect('uses the inclusive 0.55–0.95 hostile spawn window', () =>
    Effect.sync(() => {
      expect(NIGHT_START_FRACTION).toBe(0.55)
      expect(NIGHT_END_FRACTION).toBe(0.95)
      expect(isNight(0)).toBe(false)
      expect(isNight(0.1)).toBe(false)
      expect(isNight(0.9)).toBe(true)
      expect(isNight(NIGHT_START_FRACTION)).toBe(true)
      expect(isNight(NIGHT_END_FRACTION)).toBe(true)
      expect(isNight(NIGHT_START_FRACTION - Number.EPSILON * 4)).toBe(false)
      expect(isNight(NIGHT_END_FRACTION + Number.EPSILON * 4)).toBe(false)
      expect(isNight(NOON_FRACTION)).toBe(false)
    }),
  )

  it.effect('keeps hostile spawning separate from mc-sim clock night', () =>
    Effect.sync(() => {
      const simulationTime = (ticks: number) => ({ ticks, dayLengthTicks: 24_000 })

      expect(isNight(0.6)).toBe(true)
      expect(isSimulationNight(simulationTime(14_400))).toBe(false)
      expect(isSimulationNight(simulationTime(18_000))).toBe(false)
      expect(isSimulationNight(simulationTime(18_001))).toBe(true)
    }),
  )

  // The reference implementation's death loop: a fresh world started at
  // midnight, the night roster spawned on top of a brand-new player, and
  // daylight-immune hostiles camped the respawn point. mc-sim starts a world at
  // 0.30 because of it; the gate itself is this predicate.
  it.effect('gates hostile spawning on exactly the same predicate, never on a re-derived one', () =>
    Effect.sync(() => {
      for (const fraction of acrossTheDay) {
        expect(hostileSpawnsAllowed(fraction)).toBe(isNight(fraction))
      }
    }),
  )

  it.effect('is periodic across whole-day offsets, including a rewound clock', () =>
    Effect.sync(() => {
      for (let step = 0; step < 1_000; step += 1) {
        const fraction = step / 1_000
        for (const days of [-3, -1, 0, 1, 4]) {
          expect(isNight(fraction + days)).toBe(isNight(fraction))
          expect(dayPhase(fraction + days)).toBe(dayPhase(fraction))
          expect(hostileSpawnsAllowed(fraction + days)).toBe(hostileSpawnsAllowed(fraction))
        }
      }
    }),
  )
})

describe('the four phases', () => {
  it.effect('names dawn, day, dusk and night at the hours they belong to', () =>
    Effect.sync(() => {
      expect(dayPhase(0)).toBe('dawn')
      expect(dayPhase(DAWN_FRACTION + TWILIGHT_BAND / 2)).toBe('dawn')
      expect(dayPhase(NOON_FRACTION)).toBe('day')
      expect(dayPhase(DUSK_FRACTION - TWILIGHT_BAND / 2)).toBe('dusk')
      expect(dayPhase(DUSK_FRACTION)).toBe('night')
      expect(dayPhase(0.99)).toBe('dawn')
    }),
  )

  // REGRESSION: twilight is a PRESENTATION band — sky tint, fog colour. If it
  // leaked into `isNight`, widening it to make dusk look better would silently
  // change when mobs appear.
  it.effect('never disagrees with isNight, so widening twilight cannot move the spawn gate', () =>
    Effect.sync(() => {
      for (const fraction of acrossTheDay) {
        expect(dayPhase(fraction) === 'night').toBe(isNight(fraction))
      }
    }),
  )
})
