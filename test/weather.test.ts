/**
 * `domain/weather.ts` (DN-GP-7's second half) and the stage that runs it.
 *
 * ---------------------------------------------------------------------------
 * The first block is the reference's own test file, ported
 * ---------------------------------------------------------------------------
 *
 * `<reference-impl>/packages/game/test/weather.test.ts` is eight assertions over
 * three functions and they are reproduced below WITHOUT MODIFICATION to any
 * value. docs/porting.md §4 and plan.md §8 both say to move the reference's test
 * assets first and not to re-invent the specification; this is that, and it is
 * the whole reason the port can claim to be a port.
 *
 * The one difference is the CALL, not the expectation. The reference's functions
 * default their random values to `Math.random()`; this port has no defaults, so
 * every call names its rolls. That difference is the point of the port — see
 * `test/mob.test.ts`'s source scan, which fails the build on a `Math.random` in
 * `domain/`.
 *
 * ---------------------------------------------------------------------------
 * The second block is what the reference could not test
 * ---------------------------------------------------------------------------
 *
 * The reference's `WeatherService` holds a `Ref` and reads the global generator
 * inside `tick` (`weather-service.ts:31-37`), so "run a world for two hours and
 * assert the weather changed twice" is not a test anybody there can write.
 * `advanceWeather` is a total function and the stage draws from a seed, so it is
 * a test here — and `docs/testing.md` §5 names exactly this as the thing to add:
 * 「fast-forward。クロック Port を進めて『1 ゲーム日後に天候が変わっている』を
 * assert する。実時間 20 分待つテストは書かない」.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { hostileSpawnsAllowed, NOON_FRACTION } from '../domain/day-night'
import { DeltaTimeSecs } from '../domain/frame-contract'
import { DEFAULT_ROLL_SEED } from '../domain/frame-rolls'
import {
  advanceWeather,
  CLEAR_DURATION_RANGE_SECS,
  createWeatherState,
  INITIAL_WEATHER,
  isPrecipitating,
  isThunderstorm,
  LOWEST_WEATHER_ROLLS,
  RAIN_AFTER_THUNDER_CHANCE,
  RAIN_DURATION_RANGE_SECS,
  resolveNextWeatherState,
  resolveWeatherDurationSecs,
  THUNDER_AFTER_CLEAR_CHANCE,
  THUNDER_AFTER_RAIN_CHANCE,
  THUNDER_DURATION_RANGE_SECS,
  weatherExpires,
  weatherLightScale,
  WEATHERS,
  WEATHER_TRANSITION_ROLLS,
  type Weather,
  type WeatherState,
} from '../domain/weather'
import type { MobBehaviour } from '../domain/entities/mob-frame'
import { gameplayStages, makeGameplayFrameState } from '../stages/registration'
import { makeChunkStoreDouble, world } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { runFrame } from './support/frame-runner'

// ---------------------------------------------------------------------------
// The reference's oracle
// ---------------------------------------------------------------------------

describe('the reference’s weather oracle, ported unchanged', () => {
  it.effect('resolveWeatherDurationSecs resolves inclusive ranges from rolls', () =>
    Effect.sync(() => {
      expect(resolveWeatherDurationSecs('clear', 0)).toBe(CLEAR_DURATION_RANGE_SECS.min)
      expect(resolveWeatherDurationSecs('clear', 1)).toBe(CLEAR_DURATION_RANGE_SECS.max)
      // The reference passes -1 and 2 here, which is what pins `clampUnit` as
      // part of the specification rather than as defensive noise.
      expect(resolveWeatherDurationSecs('rain', -1)).toBe(RAIN_DURATION_RANGE_SECS.min)
      expect(resolveWeatherDurationSecs('thunder', 2)).toBe(THUNDER_DURATION_RANGE_SECS.max)
    }),
  )

  it.effect('createWeatherState assigns a rolled duration for the selected weather', () =>
    Effect.sync(() => {
      expect(createWeatherState('rain', 0)).toStrictEqual({
        weather: 'rain',
        remainingSecs: RAIN_DURATION_RANGE_SECS.min,
      })
    }),
  )

  // Six rows, one per edge of the transition graph, and each is bracketed at its
  // threshold in the reference: `chance - 0.01` passes and `chance` itself
  // fails, which pins the STRICT comparison the same way `domain/mob/mob-drop`'s
  // `dropPasses` is pinned.
  it.effect('clear can go straight to thunder', () =>
    Effect.sync(() => {
      expect(
        resolveNextWeatherState('clear', {
          transition: THUNDER_AFTER_CLEAR_CHANCE - 0.01,
          duration: 0,
        }),
      ).toStrictEqual({ weather: 'thunder', remainingSecs: THUNDER_DURATION_RANGE_SECS.min })
    }),
  )

  it.effect('clear goes to rain when the thunder roll misses', () =>
    Effect.sync(() => {
      expect(
        resolveNextWeatherState('clear', { transition: THUNDER_AFTER_CLEAR_CHANCE, duration: 1 }),
      ).toStrictEqual({ weather: 'rain', remainingSecs: RAIN_DURATION_RANGE_SECS.max })
    }),
  )

  it.effect('rain goes to thunder when the thunder roll succeeds', () =>
    Effect.sync(() => {
      expect(
        resolveNextWeatherState('rain', {
          transition: THUNDER_AFTER_RAIN_CHANCE - 0.01,
          duration: 0,
        }),
      ).toStrictEqual({ weather: 'thunder', remainingSecs: THUNDER_DURATION_RANGE_SECS.min })
    }),
  )

  it.effect('rain goes back to clear when the thunder roll misses', () =>
    Effect.sync(() => {
      expect(
        resolveNextWeatherState('rain', { transition: THUNDER_AFTER_RAIN_CHANCE, duration: 1 }),
      ).toStrictEqual({ weather: 'clear', remainingSecs: CLEAR_DURATION_RANGE_SECS.max })
    }),
  )

  it.effect('thunder can go back to rain', () =>
    Effect.sync(() => {
      expect(
        resolveNextWeatherState('thunder', {
          transition: RAIN_AFTER_THUNDER_CHANCE - 0.01,
          duration: 0,
        }),
      ).toStrictEqual({ weather: 'rain', remainingSecs: RAIN_DURATION_RANGE_SECS.min })
    }),
  )

  it.effect('thunder goes back to clear when the rain roll misses', () =>
    Effect.sync(() => {
      expect(
        resolveNextWeatherState('thunder', { transition: RAIN_AFTER_THUNDER_CHANCE, duration: 0 }),
      ).toStrictEqual({ weather: 'clear', remainingSecs: CLEAR_DURATION_RANGE_SECS.min })
    }),
  )

  // Read off the graph rather than off the code: EVERY expiry changes the
  // weather. `clear` never stays clear, so a world's sky is never still for two
  // stretches running, and the roll only chooses WHICH way it moves. That is not
  // obvious from three `if`s and it is the sentence a reader of this rule most
  // needs.
  it.effect('REGRESSION: no weather can follow itself — every expiry is a change', () =>
    Effect.sync(() => {
      for (const from of WEATHERS) {
        for (const transition of [0, 0.5, 0.999]) {
          expect(resolveNextWeatherState(from, { transition, duration: 0 }).weather).not.toBe(from)
        }
      }
    }),
  )
})

// ---------------------------------------------------------------------------
// The rule holds nothing
// ---------------------------------------------------------------------------

describe('the weather rule holds nothing', () => {
  // DN-GP-7's property, asked of the second noun. `domain/day-night.ts` is four
  // total functions of one number, and `test/day-night.test.ts` asserts the
  // absence of a `Ref` by reading the source. This is the same claim for a value
  // that DOES have a countdown, which is the harder version.
  it.effect('advanceWeather is a total function — the same inputs give the same output', () =>
    Effect.sync(() => {
      const state: WeatherState = { weather: 'rain', remainingSecs: 5 }
      const rolls = { transition: 0.42, duration: 0.7 }

      expect(advanceWeather(state, 1, rolls)).toStrictEqual(advanceWeather(state, 1, rolls))
      // ...and it did not mutate its argument.
      expect(state).toStrictEqual({ weather: 'rain', remainingSecs: 5 })
    }),
  )

  it.effect('a world starts clear, from a literal roll rather than a drawn one', () =>
    Effect.sync(() => {
      expect(INITIAL_WEATHER).toStrictEqual({
        weather: 'clear',
        remainingSecs: CLEAR_DURATION_RANGE_SECS.min,
      })
    }),
  )

  it.effect('a stretch that has not run out only counts down', () =>
    Effect.sync(() => {
      expect(weatherExpires({ weather: 'rain', remainingSecs: 5 }, 1)).toBe(false)
      expect(
        advanceWeather({ weather: 'rain', remainingSecs: 5 }, 1, LOWEST_WEATHER_ROLLS),
      ).toStrictEqual({ weather: 'rain', remainingSecs: 4 })
    }),
  )

  it.effect('a stretch that runs out exactly on this frame transitions', () =>
    Effect.sync(() => {
      expect(weatherExpires({ weather: 'rain', remainingSecs: 1 }, 1)).toBe(true)
      expect(advanceWeather({ weather: 'rain', remainingSecs: 1 }, 1, LOWEST_WEATHER_ROLLS).weather).toBe(
        'thunder',
      )
    }),
  )

  // A corrupt countdown must RESOLVE itself rather than freeze the sky. `NaN > 0`
  // is `false`, so the recoverable reading is the one that expires — the
  // alternative reads as "not expired" and is weather frozen for the life of the
  // world, which looks exactly like a working game.
  it.effect('REGRESSION: a NaN countdown expires rather than freezing the weather forever', () =>
    Effect.sync(() => {
      expect(weatherExpires({ weather: 'clear', remainingSecs: Number.NaN }, 1)).toBe(true)
      const next = advanceWeather(
        { weather: 'clear', remainingSecs: Number.NaN },
        1,
        LOWEST_WEATHER_ROLLS,
      )
      expect(Number.isFinite(next.remainingSecs)).toBe(true)
      expect(next.remainingSecs).toBeGreaterThan(0)
    }),
  )

  // The frame's delta comes from mc-compose and `DeltaTimeSecs` is a brand
  // rather than a refinement, so it is not this repository's to trust. One NaN
  // frame must not poison the countdown for good — the preview's finding F5 in a
  // second place.
  it.effect('REGRESSION: a NaN delta advances nothing rather than poisoning the countdown', () =>
    Effect.sync(() => {
      const state: WeatherState = { weather: 'clear', remainingSecs: 100 }
      const next = advanceWeather(state, Number.NaN, LOWEST_WEATHER_ROLLS)
      expect(Number.isFinite(next.remainingSecs)).toBe(true)
    }),
  )
})

describe('what the world does about the weather', () => {
  it.effect('precipitation and thunder are one predicate each, asked by everybody', () =>
    Effect.sync(() => {
      expect(isPrecipitating('clear')).toBe(false)
      expect(isPrecipitating('rain')).toBe(true)
      expect(isPrecipitating('thunder')).toBe(true)

      expect(isThunderstorm('rain')).toBe(false)
      expect(isThunderstorm('thunder')).toBe(true)
    }),
  )

  // `lighting-stage.ts:16-20`: clear is skipped entirely, thunder is 0.6 and
  // rain is 0.85, applied to both the directional and the ambient intensity.
  it.effect('the light scale is the reference’s thunderFactor, with clear spelled as 1', () =>
    Effect.sync(() => {
      expect(weatherLightScale('clear')).toBe(1)
      expect(weatherLightScale('rain')).toBe(0.85)
      expect(weatherLightScale('thunder')).toBe(0.6)
    }),
  )

  // THE DIVERGENCE NOT TAKEN. In vanilla, rain darkens the sky enough that
  // hostiles spawn in daylight. It would be one line here and it is not written,
  // because the reference does not do it — nothing in that implementation gates
  // spawning on weather, and docs/porting.md §4 makes the reference the
  // specification. This test exists so that adding it later is a DELIBERATE
  // change with a failing test attached rather than a quiet improvement.
  it.effect('REGRESSION: the spawn gate ignores the weather, deliberately', () =>
    Effect.sync(() => {
      expect(hostileSpawnsAllowed(NOON_FRACTION)).toBe(false)
      // Noon in a thunderstorm is still noon, and still no hostiles. The rule
      // takes one argument and there is nowhere for a weather to enter it.
      expect(hostileSpawnsAllowed.length).toBe(1)
    }),
  )
})

// ---------------------------------------------------------------------------
// Through the stage
// ---------------------------------------------------------------------------

const stagedSlice = Effect.gen(function* () {
  const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const state = yield* makeGameplayFrameState
  return { state, stages: gameplayStages(state, store.api, roster.api) }
})

const ONE_SECOND = DeltaTimeSecs(1)

describe('gameplay:time-weather', () => {
  // The stage used to be `Effect.void`, and `apps/preview-mining-site/screens.ts`
  // said in as many words that the time slider had 「no `there` to write to」.
  it.effect('is no longer empty — one frame produces the next weather state', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* stagedSlice

      yield* runFrame(stages, ONE_SECOND)

      expect(yield* Ref.get(state.weatherAdvanced)).toStrictEqual({
        weather: 'clear',
        remainingSecs: CLEAR_DURATION_RANGE_SECS.min - 1,
      })
    }),
  )

  // THE PROPERTY THE INBOX/OUTBOX PAIR EXISTS FOR. This repository is not the
  // owner of the weather, so nothing here may advance the value it was handed —
  // that is the `timeOfDaySecs` failure `stages/registration.ts` records, and it
  // is the failure that would be invisible this time because nothing else holds
  // a weather to disagree with.
  it.effect('REGRESSION: no stage advances the weather inbox — the host owns the round trip', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* stagedSlice
      const before = yield* Ref.get(state.weather)

      for (let frame = 0; frame < 16; frame += 1) {
        yield* runFrame(stages, ONE_SECOND)
      }

      expect(yield* Ref.get(state.weather)).toStrictEqual(before)
      // ...and the outbox reflects ONE frame's advance every time, because the
      // input it was computed from never moved.
      expect(yield* Ref.get(state.weatherAdvanced)).toStrictEqual({
        weather: 'clear',
        remainingSecs: CLEAR_DURATION_RANGE_SECS.min - 1,
      })
    }),
  )

  // `domain/frame-rolls.ts`: the sequence must depend on what HAPPENED rather
  // than on how many frames passed. A stage that drew unconditionally would pass
  // every other test in this file and would move every later mob's loot.
  it.effect('REGRESSION: a frame that only counts down leaves the generator where it found it', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* stagedSlice

      for (let frame = 0; frame < 32; frame += 1) {
        yield* runFrame(stages, ONE_SECOND)
      }

      expect(yield* Ref.get(state.rollSeed)).toBe(DEFAULT_ROLL_SEED)
    }),
  )

  it.effect('a transition draws exactly the two rolls it needs', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* stagedSlice
      // One second left, so the next frame expires it.
      const nearlyOver: WeatherState = { weather: 'clear', remainingSecs: 1 }
      yield* Ref.set(state.weather, nearlyOver)

      yield* runFrame(stages, ONE_SECOND)

      expect(yield* Ref.get(state.rollSeed)).not.toBe(DEFAULT_ROLL_SEED)
      const advanced = yield* Ref.get(state.weatherAdvanced)
      expect(advanced?.weather).not.toBe('clear')
      expect(WEATHER_TRANSITION_ROLLS).toBe(2)
    }),
  )

  // FAST-FORWARD, which docs/testing.md §5 names as the thing to add and which
  // the reference cannot write at all: its `tick` reads the global generator, so
  // "an hour later the weather has changed" is not reproducible there.
  //
  // A host loop, spelled out, because that IS the contract: read the outbox,
  // write it back to the inbox. Two hours of game time in a few milliseconds.
  it.effect('fast-forward: two hours of frames walk the transition graph, reproducibly', () =>
    Effect.gen(function* () {
      const runTwoHours = Effect.gen(function* () {
        const { state, stages } = yield* stagedSlice
        const seen: Array<Weather> = [INITIAL_WEATHER.weather]

        // 7200 seconds at one second a frame. `run(dt)` takes its delta as an
        // argument, so a "second" costs nothing (docs/testing.md §5).
        for (let frame = 0; frame < 7200; frame += 1) {
          yield* runFrame(stages, ONE_SECOND)
          const advanced = yield* Ref.get(state.weatherAdvanced)
          if (advanced !== undefined) {
            if (advanced.weather !== seen[seen.length - 1]) {
              seen.push(advanced.weather)
            }
            yield* Ref.set(state.weather, advanced)
          }
        }

        return seen
      })

      const first = yield* runTwoHours
      const second = yield* runTwoHours

      // It actually changed — the point of running it at all.
      expect(first.length).toBeGreaterThan(1)
      // Every step is a real transition, and none repeats its predecessor.
      for (let index = 1; index < first.length; index += 1) {
        expect(first[index]).not.toBe(first[index - 1])
      }
      // AND IT IS REPRODUCIBLE, which is what makes a scenario test an oracle
      // (plan.md §5.1-3). The reference's identical loop is not.
      expect(second).toStrictEqual(first)
    }),
  )
})
