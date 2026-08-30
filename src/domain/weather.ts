/**
 * The weather RULE. It holds nothing.
 *
 * `./day-night` is the model, and the two are siblings on purpose: both are the
 * `gameplay:time-weather` stage's business, both are total functions of their
 * arguments, and neither owns a `Ref`. plan.md §7 gives 昼夜・天候 to this
 * repository as one row; this is the half that was missing.
 *
 * ---------------------------------------------------------------------------
 * Why this file has no `Ref` when `WeatherState` is obviously stateful
 * ---------------------------------------------------------------------------
 *
 * `./day-night`'s header records the rule and the accident that produced it:
 * this repository once held `timeOfDaySecs` and `dayLengthSecs` `Ref`s and
 * advanced them, mc-sim held the same nouns in `domain/time-of-day.ts`, and two
 * owners of one noun is two answers to "what time is it" — with only one of them
 * reaching the save file.
 *
 * Weather is that question asked again, and it gets a DIFFERENT answer to the
 * same test, which is why it is argued here rather than assumed from the
 * neighbour:
 *
 *   - `WeatherState.remainingSecs` WOULD be in a save file. The reference puts
 *     it there — `world-metadata-model.ts:43` serialises
 *     `Schema.Literal('clear', 'rain', 'thunder')` with the world — so by the
 *     test in `stages/registration.ts`'s header it is not frame-local scratch.
 *   - AND NO REPOSITORY OWNS IT. mc-sim has `TimeService` and nothing else;
 *     `grep -ri weather` over that repository finds three documentation lines
 *     naming the STAGE and no service, no domain module and no state. So there
 *     is no second owner to diverge from, and there is nothing to write to.
 *
 * A `Ref` here would therefore not be a duplicate — it would be a first. That is
 * a worse thing to become by accident than a duplicate is, because a duplicate
 * announces itself the first time the two disagree and a sole owner in the wrong
 * repository never does. So this file stays pure and
 * `stages/registration.ts` carries the value as an INBOX the host writes and an
 * OUTBOX the host drains, in exactly the shape `minedItems` has: the frame reads
 * this frame's weather, the rule says what it should become, and the repository
 * that owns persistence writes it. `advanceWeather` below is a total function
 * from a state to a state and could not hold one if it wanted to.
 *
 * ---------------------------------------------------------------------------
 * The numbers are the reference's, and the rolls are arguments
 * ---------------------------------------------------------------------------
 *
 * `<reference-impl>/packages/game/domain/weather.ts` is already almost the right
 * shape: its three functions take their random values as parameters. What they
 * also do is DEFAULT them to `Math.random()`, which means every production call
 * site reads the global generator and the whole file replays differently every
 * time. The defaults are removed here and nothing else about the arithmetic
 * changed — `test/rules.test.ts` ports that file's own oracle
 * (`packages/game/test/weather.test.ts`, eight assertions) unmodified, which is
 * the check that "nothing else changed" is a fact rather than an intention.
 *
 * ---------------------------------------------------------------------------
 * ONE DIVERGENCE FROM VANILLA THAT IS NOT TAKEN, AND IT IS THE TEMPTING ONE
 * ---------------------------------------------------------------------------
 *
 * In vanilla, rain darkens the sky enough that hostile mobs spawn in DAYLIGHT.
 * It would be one line — `hostileSpawnsAllowed(hour) || isPrecipitating(w)` —
 * and it is not written, because the reference does not do it: nothing in that
 * implementation gates spawning on weather, and docs/porting.md §4 makes the
 * reference the specification. `./day-night`'s `hostileSpawnsAllowed` therefore
 * keeps its one argument, and a weather-aware spawn gate arrives the day
 * somebody measures that the reference has one.
 */

/** The three states. `<reference-impl>/packages/game/domain/weather.ts:1`. */
export type Weather = 'clear' | 'rain' | 'thunder'

/** Every weather, for a sweep. Order is the reference's declaration order. */
export const WEATHERS: ReadonlyArray<Weather> = ['clear', 'rain', 'thunder']

export type WeatherDurationRange = {
  readonly min: number
  readonly max: number
}

/**
 * How long each weather lasts, in seconds. `weather.ts:8-10`.
 *
 * Clear weather's range is fifteen times wider than its floor, which is what
 * makes a world feel like it has weather rather than a metronome. The numbers
 * are vanilla-shaped rather than vanilla-exact and they are the reference's.
 */
export const CLEAR_DURATION_RANGE_SECS: WeatherDurationRange = { min: 600, max: 9000 }
export const RAIN_DURATION_RANGE_SECS: WeatherDurationRange = { min: 600, max: 1200 }
export const THUNDER_DURATION_RANGE_SECS: WeatherDurationRange = { min: 180, max: 780 }

export const WEATHER_DURATION_RANGES: Readonly<Record<Weather, WeatherDurationRange>> = {
  clear: CLEAR_DURATION_RANGE_SECS,
  rain: RAIN_DURATION_RANGE_SECS,
  thunder: THUNDER_DURATION_RANGE_SECS,
}

/**
 * The three transition probabilities. `weather.ts:21-23`.
 *
 * The graph they describe is worth reading off, because it is not the obvious
 * one: clear NEVER stays clear and rain never stays rain. Every expiry moves to
 * a different weather, and the roll only chooses WHICH — so `THUNDER_AFTER_CLEAR`
 * of 0.1 means "one expiry in ten goes straight to thunder", with the other nine
 * going to rain rather than back to clear.
 */
export const THUNDER_AFTER_CLEAR_CHANCE = 0.1
export const THUNDER_AFTER_RAIN_CHANCE = 0.3
export const RAIN_AFTER_THUNDER_CHANCE = 0.4

/** A weather and how long is left of it. `weather.ts:25-28`. */
export type WeatherState = {
  readonly weather: Weather
  readonly remainingSecs: number
}

/** Runtime validation for weather values crossing an untyped host boundary. */
export const isWeather = (value: unknown): value is Weather =>
  typeof value === 'string' && (WEATHERS as ReadonlyArray<string>).includes(value)

/**
 * A persisted weather state must name a known weather and contain a positive,
 * finite countdown. Expired states are advanced before they leave gameplay.
 */
export const isWeatherState = (value: unknown): value is WeatherState => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as { readonly weather?: unknown; readonly remainingSecs?: unknown }
  return (
    isWeather(candidate.weather) &&
    typeof candidate.remainingSecs === 'number' &&
    Number.isFinite(candidate.remainingSecs) &&
    candidate.remainingSecs > 0
  )
}

/**
 * Applies a host-provided state only when it satisfies the persisted boundary.
 * Returning a fresh value prevents later host mutation from changing domain state.
 */
export const applyWeatherState = (current: WeatherState, candidate: unknown): WeatherState =>
  isWeatherState(candidate)
    ? { weather: candidate.weather, remainingSecs: candidate.remainingSecs }
    : current

/** Clamp into `[0, 1]`. `weather.ts:30` — INCLUSIVE of 1, which the oracle pins. */
const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

/**
 * How long a stretch of this weather lasts, from one roll.
 *
 * `weather.ts:32-39`, with the `= Math.random()` default removed. The
 * `Math.min(range.max, ...)` is the reference's and is load-bearing: the offset
 * is over `max - min + 1` so that the range is INCLUSIVE, which means a roll of
 * exactly 1 would otherwise land one second past the end.
 *
 * TOTAL: `clampUnit` maps a roll that is not a number to 0, so a caller with a
 * broken generator gets the SHORTEST legal stretch rather than a `NaN` countdown
 * that never expires. That direction is chosen — a weather with a `NaN` duration
 * is weather that never changes again, and it looks exactly like a working game.
 */
export const resolveWeatherDurationSecs = (weather: Weather, roll: number): number => {
  const range = WEATHER_DURATION_RANGES[weather]
  const offset = Math.floor(clampUnit(roll) * (range.max - range.min + 1))

  return Math.min(range.max, range.min + offset)
}

/** A fresh stretch of the named weather. `weather.ts:41-47`. */
export const createWeatherState = (weather: Weather, durationRoll: number): WeatherState => ({
  weather,
  remainingSecs: resolveWeatherDurationSecs(weather, durationRoll),
})

/**
 * What a world starts with.
 *
 * Clear, for the shortest legal stretch. A LITERAL roll of 0 and not a drawn
 * one, which is the same decision `../domain/frame-rolls`' `DEFAULT_ROLL_SEED`
 * records: the reference seeds this with `Math.random()`
 * (`weather-service.ts:13`), so two runs of one scenario disagree about when the
 * first rain arrives.
 */
export const INITIAL_WEATHER: WeatherState = createWeatherState('clear', 0)

/** The two rolls one transition needs, both in `[0, 1)`. */
export type WeatherRolls = {
  /** Chooses which weather comes next. */
  readonly transition: number
  /** Spreads the new stretch over its range. */
  readonly duration: number
}

/** Rolls that take the first branch of every choice and the shortest stretch. */
export const LOWEST_WEATHER_ROLLS: WeatherRolls = { transition: 0, duration: 0 }

/**
 * How many rolls one transition consumes, for a caller drawing from
 * `./frame-rolls`. Two, in the order `[transition, duration]`.
 */
export const WEATHER_TRANSITION_ROLLS = 2

/**
 * What follows this weather when its stretch runs out. `weather.ts:49-64`.
 *
 * Every arm is written out rather than folded into a table, because the three
 * are not the same rule with different constants: clear chooses between thunder
 * and RAIN, rain chooses between thunder and CLEAR, and thunder chooses between
 * rain and CLEAR. A `Record<Weather, [Weather, Weather]>` would say the same
 * thing today and would hide which of the six edges a future edit moved.
 */
export const resolveNextWeatherState = (current: Weather, rolls: WeatherRolls): WeatherState => {
  if (current === 'clear') {
    return createWeatherState(
      rolls.transition < THUNDER_AFTER_CLEAR_CHANCE ? 'thunder' : 'rain',
      rolls.duration,
    )
  }
  if (current === 'rain') {
    return createWeatherState(
      rolls.transition < THUNDER_AFTER_RAIN_CHANCE ? 'thunder' : 'clear',
      rolls.duration,
    )
  }

  return createWeatherState(
    rolls.transition < RAIN_AFTER_THUNDER_CHANCE ? 'rain' : 'clear',
    rolls.duration,
  )
}

/**
 * Will this stretch run out within `dt`?
 *
 * SEPARATE FROM `advanceWeather`, and that separation is the whole reason the
 * stage can stay deterministic. `./frame-rolls` requires that the generator
 * advance because something HAPPENED rather than because a frame elapsed —
 * `stages/registration.ts` applies the identical discipline to the spawn search,
 * whose seed is untouched on a frame that did not search. A caller asks this
 * first and draws its two rolls only when the answer is yes.
 *
 * TOTAL, and a non-finite remainder expires immediately. That is the recoverable
 * direction: a corrupt countdown resolves itself on the next frame into a fresh
 * legal stretch, where the alternative — `NaN > 0`, which is `false`, read as
 * "not expired" — is weather frozen for the life of the world.
 */
export const weatherExpires = (state: WeatherState, dt: number): boolean =>
  !Number.isFinite(state.remainingSecs) || !(state.remainingSecs - (Number.isFinite(dt) ? dt : 0) > 0)

/**
 * One frame of weather.
 *
 * `<reference-impl>/packages/game/application/weather-service.ts:31-37`'s `tick`,
 * with the `Ref` taken out and the two `Math.random()` calls turned into the
 * argument. What is left is a total function from a state and a delta to a
 * state, which is `../mob/creeper-fuse`'s shape exactly — and for the same
 * reason: the value belongs to whoever stores it, and the rule only says what it
 * becomes.
 *
 * The rolls are IGNORED when the stretch has not run out, so a caller that
 * cannot be bothered to check `weatherExpires` still gets the right answer; what
 * it loses is the seed it burned. The check is cheap and the stage does it.
 *
 * A NON-FINITE `dt` ADVANCES NOTHING rather than poisoning the countdown. The
 * frame's delta comes from mc-compose and is not this repository's to trust
 * (kernel's `DeltaTimeSecs` is a brand, not a refinement), and a
 * single `NaN` frame would otherwise make `remainingSecs` `NaN` for good — the
 * preview's finding F5 in a second place.
 */
export const advanceWeather = (
  state: WeatherState,
  dt: number,
  rolls: WeatherRolls,
): WeatherState => {
  if (weatherExpires(state, dt)) {
    return resolveNextWeatherState(state.weather, rolls)
  }

  // The SAME non-finite guard `weatherExpires` applies, and it has to be applied
  // twice rather than once: that function answers a question about `dt` and this
  // one performs arithmetic with it, so a `dt` the predicate treated as zero
  // would otherwise be subtracted as `NaN` here and the countdown would never
  // recover. Sharing one clamp would be tidier and would put the guard one
  // function further from the subtraction it protects.
  return {
    weather: state.weather,
    remainingSecs: state.remainingSecs - (Number.isFinite(dt) ? dt : 0),
  }
}

// ---------------------------------------------------------------------------
// What the world does about it
// ---------------------------------------------------------------------------

/**
 * Is anything falling out of the sky?
 *
 * `<reference-impl>/packages/world/application/crop-growth-maintenance.ts:28-29`
 * (`hasSnowAccumulationWeather`) and
 * `packages/app/.../stages/lighting-stage-precipitation.ts:31` both ask exactly
 * this question and spell it differently — one as `w === 'rain' || w ===
 * 'thunder'`, the other as `w !== 'clear'`. They agree only because the union
 * has three members; adding a fourth would split them silently. One predicate,
 * asked by everybody, is `./day-night`'s `hostileSpawnsAllowed` argument applied
 * to weather.
 */
export const isPrecipitating = (weather: Weather): boolean => weather !== 'clear'

/**
 * Is lightning possible?
 *
 * A named alias for `weather === 'thunder'` rather than a second predicate, for
 * `hostileSpawnsAllowed`'s reason: the reference's hazard site inlines the
 * comparison (`physics-stage-survival/environment.ts:101`: `weather ===
 * 'thunder' && exposedToSky`), and an inlined comparison is how two callers end
 * up disagreeing about what a thunderstorm is.
 *
 * WHAT IT IS NOT USED FOR HERE: the strike itself. `exposedToSky` is a column
 * scan and the damage is a `Damage` applied to a player, and the player's health
 * is mc-sim's `PlayerService` — the same boundary that keeps `mobXpReward`
 * written and uncalled. The preview's missing list carries the row.
 */
export const isThunderstorm = (weather: Weather): boolean => weather === 'thunder'

/**
 * How much of the sky's light gets through, as a multiplier in `(0, 1]`.
 *
 * `<reference-impl>/packages/app/application/frame/stages/lighting-stage.ts:18`:
 * `const thunderFactor = weather === 'thunder' ? 0.6 : 0.85`, applied to both the
 * directional and the ambient intensity, and skipped entirely for clear weather.
 * Restated as a total function of three cases so that "clear is 1" is a value
 * rather than an early `return`.
 *
 * A NUMBER AND NOT A COLOUR. The reference's same function also sets two HSL
 * triples, and those are not here: a sky tint is mc-render's, exactly as
 * `./day-night`'s `dayPhase` is careful to be a PHASE rather than a colour.
 * What a renderer needs from this repository is the rule; what it does with it
 * is its own.
 */
export const weatherLightScale = (weather: Weather): number => {
  if (weather === 'thunder') {
    return 0.6
  }
  if (weather === 'rain') {
    return 0.85
  }

  return 1
}
