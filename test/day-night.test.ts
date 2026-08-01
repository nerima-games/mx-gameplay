/**
 * The day/night rule, and the property that makes it a rule at all.
 *
 * plan.md §2.3-1 splits the roster into nouns and verbs: foundation
 * repositories hold state, experience repositories hold rules. The time of day
 * has to survive a save/load round trip, so it is a noun and it is mc-sim's
 * (`mc-sim/domain/time-of-day.ts`, behind `application/time-service.ts`).
 * mx-gameplay's share is what the world DOES about the hour.
 *
 * This repository held a second copy of the noun until it was deleted —
 * `timeOfDaySecs` and `dayLengthSecs` `Ref`s advanced by the
 * `gameplay:time-weather` stage, and a `DEFAULT_DAY_LENGTH_SECS` of 1200
 * against mc-sim's 400. The first describe block below is the regression that
 * keeps it deleted: it asserts that the rule holds NO STATE OF ITS OWN, which
 * is the structural reason it cannot drift out of agreement with mc-sim again.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as dayNight from '../src/domain/day-night'
import {
  DAWN_FRACTION,
  DUSK_FRACTION,
  dayPhase,
  hostileSpawnsAllowed,
  isNight,
  NOON_FRACTION,
  TWILIGHT_BAND,
} from '../src/domain/day-night'

/** Every fraction the rule is asked about, at a resolution finer than a frame. */
const acrossTheDay = Array.from({ length: 1_000 }, (_, index) => index / 1_000)

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

  // REGRESSION: no day-length constant here. mc-sim's is 400 seconds
  // (INITIAL_TIME_STATE: 24000 ticks at 60 ticks/s); this repository's was
  // 1200, which is in fact mc-sim's MAXIMUM. The rule is expressed over a
  // FRACTION of the day precisely so that the day's length is not its business.
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
  // REGRESSION: mc-sim persists the fraction and this repository decides what
  // it means, so the two are in different packages and must agree about the
  // boundary. `mc-sim/domain/time-of-day.ts:117-120` computes exactly this, and
  // `mc-sim/test/time-of-day.test.ts` pins it there. Zero is MIDNIGHT.
  it.effect('is the half of the day centred on the 0/1 boundary, exactly as mc-sim computes it', () =>
    Effect.sync(() => {
      expect(isNight(0)).toBe(true)
      expect(isNight(0.1)).toBe(true)
      expect(isNight(0.9)).toBe(true)
      // The boundaries themselves are daylight: dawn has broken at 0.25 and
      // the sun has not yet set at 0.75.
      expect(isNight(DAWN_FRACTION)).toBe(false)
      expect(isNight(NOON_FRACTION)).toBe(false)
      expect(isNight(DUSK_FRACTION)).toBe(false)
      expect(isNight(0.75 + Number.EPSILON * 4)).toBe(true)
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
})

describe('the four phases', () => {
  it.effect('names dawn, day, dusk and night at the hours they belong to', () =>
    Effect.sync(() => {
      expect(dayPhase(0)).toBe('night')
      expect(dayPhase(DAWN_FRACTION)).toBe('dawn')
      expect(dayPhase(DAWN_FRACTION + TWILIGHT_BAND / 2)).toBe('dawn')
      expect(dayPhase(NOON_FRACTION)).toBe('day')
      expect(dayPhase(DUSK_FRACTION - TWILIGHT_BAND / 2)).toBe('dusk')
      expect(dayPhase(DUSK_FRACTION)).toBe('dusk')
      expect(dayPhase(0.99)).toBe('night')
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
