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
 * This repository had a second copy of all of it: `timeOfDaySecs` and
 * `dayLengthSecs` `Ref`s advanced by the `gameplay:time-weather` stage, plus a
 * `DEFAULT_DAY_LENGTH_SECS` of 1200 against mc-sim's 400. Two owners of one
 * noun is two answers to "what time is it", and the one that gets saved is
 * mc-sim's — so the divergence would have surfaced as the sky jumping on world
 * load. The file header of `stages/registration.ts` and docs/architecture.md
 * both already said mc-sim owned it; only the code disagreed.
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
 * deciding the phase. ZERO IS MIDNIGHT: 0.25 is dawn, 0.5 noon, 0.75 dusk.
 * That is the reference implementation's convention, and mc-sim carries it —
 * `mc-sim/domain/time-of-day.ts:117-120` computes night as
 * `fraction < 0.25 || fraction > 0.75`, and the same file records why a
 * fresh world starts at 0.30 rather than 0: a midnight spawn put the
 * night-mob roster on top of a brand-new player and daylight-immune hostiles
 * camped the respawn point, an unrecoverable death loop on world creation.
 *
 * `isNight` below uses mc-sim's predicate after canonicalising its finite
 * input. The spawn rule and the state that feeds it must agree about when night
 * is, and they are in different repositories, so the agreement is written down
 * twice and pinned by a test in each rather than assumed.
 */

/** Dawn: the sun clears the horizon. */
export const DAWN_FRACTION = 0.25

/** Noon: the sun is highest. */
export const NOON_FRACTION = 0.5

/** Dusk: the sun touches the horizon. */
export const DUSK_FRACTION = 0.75

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

/**
 * Map finite day counts to the one-day phase consumed by gameplay rules.
 *
 * Quantising far below the clock's tick resolution removes transport noise
 * such as `0.3` becoming `0.2999999999999998` after adding a whole day.
 */
const canonicalTimeOfDay = (timeOfDay: number): number => {
  if (!Number.isFinite(timeOfDay) || (timeOfDay >= 0 && timeOfDay < 1)) {
    return timeOfDay
  }

  const fraction = ((timeOfDay % 1) + 1) % 1
  return Math.round(fraction * 1_000_000_000_000) / 1_000_000_000_000
}

/**
 * Is it night?
 *
 * The comparison is identical to `mc-sim/domain/time-of-day.ts` after finite
 * input is reduced to the current day's fraction. This keeps a rewound or
 * manually advanced clock from changing the phase merely because it crossed a
 * day boundary.
 */
export const isNight = (timeOfDay: number): boolean => {
  const fraction = canonicalTimeOfDay(timeOfDay)
  return fraction < DAWN_FRACTION || fraction > DUSK_FRACTION
}

/**
 * Which phase a given time of day falls in.
 *
 * Consistent with `isNight` by construction: the two twilight bands sit inside
 * daylight, so nothing that this reports as `dawn` or `dusk` is also night.
 */
export const dayPhase = (timeOfDay: number): DayPhase => {
  const fraction = canonicalTimeOfDay(timeOfDay)
  if (isNight(fraction)) {
    return 'night'
  }
  if (fraction < DAWN_FRACTION + TWILIGHT_BAND) {
    return 'dawn'
  }
  if (fraction > DUSK_FRACTION - TWILIGHT_BAND) {
    return 'dusk'
  }
  return 'day'
}

/**
 * May daylight-sensitive hostiles spawn?
 *
 * A named alias for `isNight` rather than a second predicate. The two are the
 * same question today, and the reference's death-loop bug (see the module
 * header) is what happens when a caller answers it by inlining a comparison of
 * its own. When mob-specific rosters arrive they take a `DayPhase`, and this
 * stays the coarse gate.
 */
export const hostileSpawnsAllowed = (timeOfDay: number): boolean => isNight(timeOfDay)
