/**
 * The day/night RULE. It holds nothing.
 *
 * ---------------------------------------------------------------------------
 * Why this file has no `Ref` and no default day length
 * ---------------------------------------------------------------------------
 *
 * plan.md §2.3-1: foundation repositories hold state, experience repositories
 * hold rules. The time of day is unambiguously state — it has to survive a
 * save/load round trip, which is the test `stages/registration.ts` names for
 * whether a value belongs here — so mc-sim owns it, in
 * `mc-sim/domain/time-of-day.ts` behind `mc-sim/application/time-service.ts`.
 * That includes the tick counter, the day-length denominator, the advance, and
 * the `setDayLength -> setTimeOfDay` ordering hazard those two create.
 *
 * Before mc-sim 0.10.0, this repository had a second copy of that state:
 * `timeOfDaySecs` and `dayLengthSecs` `Ref`s advanced by the
 * `gameplay:time-weather` stage, with a 1200-second default against mc-sim's
 * former 400-second default. mc-sim 0.10.0 owns a 24000-tick day at 20 ticks
 * per second (1200 seconds). This module stays a fraction-based rule and does
 * not own the clock.
 *
 * What is left here is the part that really is a rule: given the time of day,
 * what does the world do about it. Every function below is a total function of
 * its argument, so there is nothing to keep in sync, nothing to persist, and no
 * ordering constraint of any kind. `test/day-night.test.ts` asserts that.
 *
 * ---------------------------------------------------------------------------
 * The cycle, and where the boundaries come from
 * ---------------------------------------------------------------------------
 *
 * `timeOfDay` is a fraction in [0, 1) supplied by mc-sim's
 * `TimeService.timeOfDay`. Finite values outside that range still denote the
 * same phase on an adjacent day, so this rule canonicalises them before
 * deciding the phase. Hostile spawning uses the balance window 0.55 through
 * 0.95; the daytime span wraps through zero.
 *
 * `isNight` below is mx-gameplay's hostile-spawn window after canonicalising
 * its finite input. mc-sim's `TimeService.isNight` has a separate clock
 * predicate; callers must not assume the spawn and simulation-night windows
 * are coupled.
 */
import { Result } from 'effect'


/** Start of the hostile-spawn night window. */
export const NIGHT_START_FRACTION = 0.55

/** End of the hostile-spawn night window. */
export const NIGHT_END_FRACTION = 0.95

/** Dawn: the sun clears the horizon. */
export const DAWN_FRACTION: number = NIGHT_END_FRACTION

/** Noon: the sun is highest. */
export const NOON_FRACTION = 0.25

/** Dusk: the sun touches the horizon. */
export const DUSK_FRACTION: number = NIGHT_START_FRACTION

/**
 * Width of the twilight bands, as a fraction of the day.
 *
 * Twilight is a PRESENTATION distinction (sky tint, fog colour, the moment the
 * torches look worth placing) and not a spawn distinction: `isNight` does not
 * consult it. Keeping the two apart is what stops a sky-gradient tweak from
 * quietly changing when mobs appear.
 */
export const TWILIGHT_BAND = 0.05

/** The four phases a renderer or a HUD may want to distinguish. */
export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk'

export type DayNightInputFailure = Readonly<{
  _tag: 'InvalidDayNightInput'
  field: 'timeOfDay'
}>

/**
 * Map finite day counts to the one-day phase consumed by gameplay rules.
 *
 * Quantising far below the clock's tick resolution removes transport noise
 * such as `0.3` becoming `0.2999999999999998` after adding a whole day.
 */
const canonicalTimeOfDay = (
  timeOfDay: number,
): Result.Result<number, DayNightInputFailure> => {
  if (!Number.isFinite(timeOfDay)) {
    return Result.fail({ _tag: 'InvalidDayNightInput', field: 'timeOfDay' })
  }
  if (timeOfDay >= 0 && timeOfDay < 1) return Result.succeed(timeOfDay)

  const fraction = ((timeOfDay % 1) + 1) % 1
  return Result.succeed(Math.round(fraction * 1_000_000_000_000) / 1_000_000_000_000)
}

/**
 * Is it in the hostile-spawn night window?
 *
 * The inclusive bounds are balance values. This keeps a rewound or manually
 * advanced clock from changing the phase merely because it crossed a day
 * boundary.
 */
const isNightFraction = (fraction: number): boolean =>
  fraction >= NIGHT_START_FRACTION && fraction <= NIGHT_END_FRACTION

export const isNight = (timeOfDay: number): Result.Result<boolean, DayNightInputFailure> => {
  const fraction = canonicalTimeOfDay(timeOfDay)
  return Result.isFailure(fraction)
    ? Result.fail(fraction.failure)
    : Result.succeed(isNightFraction(fraction.success))
}

/**
 * Which phase a given time of day falls in.
 *
 * Consistent with `isNight` by construction: the two twilight bands sit inside
 * daylight, so nothing that this reports as `dawn` or `dusk` is also night.
 */
export const dayPhase = (timeOfDay: number): Result.Result<DayPhase, DayNightInputFailure> => {
  const canonical = canonicalTimeOfDay(timeOfDay)
  if (Result.isFailure(canonical)) return Result.fail(canonical.failure)
  const fraction = canonical.success
  if (isNightFraction(fraction)) {
    return Result.succeed('night')
  }
  if (fraction > NIGHT_END_FRACTION || fraction < TWILIGHT_BAND) {
    return Result.succeed('dawn')
  }
  if (fraction > DUSK_FRACTION - TWILIGHT_BAND) {
    return Result.succeed('dusk')
  }
  return Result.succeed('day')
}

/**
 * May daylight-sensitive hostiles spawn?
 *
 * A named alias for the configured hostile night window. Surface hostiles use
 * it together with raw sky light; cave hostiles may spawn outside this window.
 * Passive spawning uses the daylight result to avoid competing with the
 * hostile night cycle.
 */
export const hostileSpawnsAllowed = (timeOfDay: number): Result.Result<boolean, DayNightInputFailure> => isNight(timeOfDay)
