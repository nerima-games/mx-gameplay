import {
  Effect,
  GAMEPLAY_STAGE_IDS,
  LOWEST_WEATHER_ROLLS,
  Ref,
  WEATHER_TRANSITION_ROLLS,
  advanceWeather,
  advanceWeatherGameplay,
  drawRolls,
  rollAt,
  weatherExpires,
} from './registration-core.js'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeTimeWeatherStage = (context: GameplayStageContext): StageRegistration => {
  const { state } = context
  return {
    id: GAMEPLAY_STAGE_IDS.timeWeather,
    after: [GAMEPLAY_STAGE_IDS.fluids],
    // ADVANCING THE CLOCK IS STILL mc-sim's: `TimeService.advance(dt)` over
    // `mc-sim/domain/time-of-day.ts`, which owns the absolute tick counter, the
    // day-length denominator, the `setDayLength -> setTimeOfDay` ordering rule
    // and the value that reaches the save file. This stage held a second copy of
    // that state until it was deleted; see the registration-core.ts header. mc-sim registers
    // its advance inside `sim:physics` rather than a `sim:time-weather`, for a
    // reason that repository documents at length: two stages in one phase are
    // ordered lexicographically, `gameplay:` sorts before `sim:`, and this stage
    // would read an hour the frame had not yet advanced. So by the time this
    // runs, `timeOfDay` is this frame's.
    //
    // WEATHER IS THE PART THAT IS HERE. `domain/weather.ts` holds the rule and
    // holds nothing else; this stage reads the hour's weather out of an inbox,
    // asks the rule what it becomes, and puts the answer in an outbox for
    // whoever owns persistence. See the registration-core.ts header on why weather gets an
    // inbox/outbox pair rather than the `Ref` its countdown looks like it wants.
    //
    // WHAT IS STILL NOT HERE: the CONSEQUENCES that need a service to write to.
    // `weatherLightScale` is mc-render's to read, and the thunderstorm hazard is
    // damage applied to a player whose health is mc-sim's `PlayerService` — the
    // same boundary that keeps `mobXpReward` written and uncalled. Gating
    // hostile spawns on the hour is NOT on that list and never was: it already
    // happens, in `gameplay:entities` above, where the search is.
    run: (dt) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state.weather)
        const weatherGameplayInput = yield* Ref.get(state.weatherGameplayInput)
        const weatherGameplayState = yield* Ref.get(state.weatherGameplay)
        const tick = yield* Ref.get(state.tickCount)
        const weatherGameplayStep = advanceWeatherGameplay(
          weatherGameplayState,
          tick,
          current.weather,
          weatherGameplayInput,
        )
        yield* Ref.set(state.weatherGameplay, weatherGameplayStep.state)
        if (weatherGameplayStep.events.length > 0) {
          yield* Ref.update(state.weatherGameplayEvents, (events) => [
            ...events,
            ...weatherGameplayStep.events,
          ])
        }

        // THE ROLLS ARE DRAWN ONLY WHEN THE STRETCH RUNS OUT, which is
        // `domain/frame-rolls.ts`'s rule that the sequence depend on what
        // happened rather than on how many frames passed — the same discipline
        // the spawn search's cadence follows two stages up. A frame that only
        // decrements a countdown leaves the generator exactly where it found it,
        // so a scenario that runs ten thousand clear frames and then rains draws
        // the same two numbers as one that rains immediately.
        //
        // `weatherExpires` is asked here rather than inside `advanceWeather`
        // because only the caller can decide not to draw; the rule is total
        // either way and ignores the rolls it does not need.
        const next = weatherExpires(current, dt)
          ? yield* Ref.modify(state.rollSeed, (seed) => {
              const batch = drawRolls(seed, WEATHER_TRANSITION_ROLLS)
              return [
                advanceWeather(current, dt, {
                  transition: rollAt(batch, 0),
                  duration: rollAt(batch, 1),
                }),
                batch.seed,
              ] as const
            })
          : advanceWeather(current, dt, LOWEST_WEATHER_ROLLS)

        // `set` and not `update`: the outbox is a countdown and its last value
        // subsumes every earlier one, so a host that drains every other frame
        // loses nothing. Unlike append-only event outboxes, only the newest
        // countdown value matters.
        yield* Ref.set(state.weatherAdvanced, next)
      }),
  }
}
