/**
 * mx-gameplay's contribution to the frame (plan.md §4.1).
 *
 * This module is the whole of this repository's public behaviour surface:
 * mx-gameplay exposes STAGE REGISTRATION and essentially nothing else. It
 * publishes no service for another repository to call, because a rule is not a
 * service — anything another repository would want to ask mx-gameplay is really
 * a question about state, and state lives in mc-sim or mc-worldgen
 * (plan.md §2.3-1). See docs/public-api.md.
 *
 * ---------------------------------------------------------------------------
 * State ownership in this file
 * ---------------------------------------------------------------------------
 *
 * The `Ref`s in `GameplayFrameState` are frame-local scratch: a work queue and a
 * couple of counters. They are NOT game state. The blocks that fall, the fluid
 * that flows and the time of day are all mc-sim's and mc-worldgen's to hold; a
 * frontier is a note about what to look at next, and it is legitimately
 * private to the stage that consumes it.
 *
 * The distinction is worth policing, because "just one more Ref" is how the
 * reference implementation ended up with 13k LOC of rules in its composition
 * layer (plan.md §3.15). The test for whether a Ref belongs here: would a save
 * file need it? If yes, it belongs to mc-save via mc-sim.
 *
 * ---------------------------------------------------------------------------
 * Why a factory rather than a constant
 * ---------------------------------------------------------------------------
 *
 * `makeGameplayFrameState` is an Effect, so two playgrounds, or a test and the
 * game, can each hold their own. plan.md §3.8 records that app-scope singletons
 * were among the reference's worst bug sources: a second world load inherited
 * the first world's fibers and refs and deadlocked. Re-entrant initialisation
 * from the start is cheaper than retrofitting it.
 */
import { Effect, Ref } from 'effect'
import {
  emptyFallingBlockQueue,
  takeBatch,
  type FallingBlockQueue,
} from '../domain/falling-block'
import {
  carryOver,
  splitBudget,
  type FluidWorkItem,
} from '../domain/fluid-frontier'
import type { DeltaTimeSecs, StageRegistration } from '../domain/frame-contract'
import { GAMEPLAY_STAGE_IDS, UPSTREAM_STAGE_IDS } from './stage-ids'

/**
 * How many gameplay ticks pass between two active lava ticks.
 *
 * Vanilla lava spreads several times more slowly than water. Provisional: the
 * shipped value comes out of the fluid preview, not out of a guess made here.
 */
export const LAVA_TICK_INTERVAL = 4

/** Seconds of wall time in one in-game day, at the default day length. */
export const DEFAULT_DAY_LENGTH_SECS = 1_200

export type GameplayFrameState = {
  readonly fallingBlocks: Ref.Ref<FallingBlockQueue>
  readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>
  readonly tickCount: Ref.Ref<number>
  readonly timeOfDaySecs: Ref.Ref<number>
  readonly dayLengthSecs: Ref.Ref<number>
}

export const makeGameplayFrameState: Effect.Effect<GameplayFrameState> = Effect.gen(function* () {
  const fallingBlocks = yield* Ref.make<FallingBlockQueue>(emptyFallingBlockQueue)
  const fluidFrontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])
  const tickCount = yield* Ref.make(0)
  const timeOfDaySecs = yield* Ref.make(0)
  const dayLengthSecs = yield* Ref.make(DEFAULT_DAY_LENGTH_SECS)

  return { fallingBlocks, fluidFrontier, tickCount, timeOfDaySecs, dayLengthSecs }
})

/**
 * Advance the clock, wrapping at the day length.
 *
 * Pure, and exported so the day/night preview's time slider can drive it
 * directly. plan.md §3.8 warns that `setDayLength` changes the tick denominator
 * and must therefore be applied BEFORE `setTimeOfDay`; expressing the advance as
 * a pure function of (now, dt, length) removes the ordering hazard entirely,
 * because there is no stored derived value to be stale.
 */
export const advanceTimeOfDay = (currentSecs: number, dt: number, dayLengthSecs: number): number => {
  if (dayLengthSecs <= 0) {
    return currentSecs
  }
  const advanced = (currentSecs + dt) % dayLengthSecs
  return advanced < 0 ? advanced + dayLengthSecs : advanced
}

/**
 * The four stages mx-gameplay registers.
 *
 * Note what is NOT here: any resolution of a total order. Each registration
 * carries `after` constraints and nothing more; mc-compose topologically sorts
 * the union of every module's registrations (plan.md §2.3-3, §4.2). The array
 * order below is for human reading only — a consumer that relied on it would be
 * relying on a coincidence, and `test/stage-registration.test.ts` asserts that
 * the declared constraints, not the array order, are what carry the meaning.
 */
export const gameplayStages = (state: GameplayFrameState): ReadonlyArray<StageRegistration> => [
  {
    id: GAMEPLAY_STAGE_IDS.interactions,
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    // FIRST CUT: the ~40 one-rule-per-file handlers of plan.md §3.11 (break,
    // place, bucket, flint & steel, bow, farming, shears, ender pearl, feed,
    // shear, melee, …) are ported into `domain/interactions/` and dispatched
    // from here. They are deliberately many small files and ONE stage: the
    // granularity that matters for review is the rule, the granularity that
    // matters for composition is the stage.
    run: () => Effect.void,
  },
  {
    id: GAMEPLAY_STAGE_IDS.entities,
    after: [GAMEPLAY_STAGE_IDS.interactions],
    // Entities run after interactions because a mob's reaction is to the world
    // as the player just left it — reversing the two makes a creeper respond to
    // last frame's block placement, which reads as lag rather than as a bug.
    //
    // `Ref.modify` rather than get-then-set: plan.md §3.8 lists TOCTOU on a Ref
    // among the reference's recurring Effect-level mistakes. Read-modify-write
    // as two steps is a race the moment anything else forks.
    run: () =>
      Ref.modify(state.fallingBlocks, (queue) => {
        const { batch, rest } = takeBatch(queue)
        // FIRST CUT: `batch` is where each position's column is evaluated and
        // the move applied through mc-sim's block service, then the
        // destinations fed back with `settled` to continue the cascade.
        return [batch, rest] as const
      }).pipe(Effect.asVoid),
  },
  {
    id: GAMEPLAY_STAGE_IDS.fluids,
    after: [GAMEPLAY_STAGE_IDS.entities],
    run: () =>
      Effect.gen(function* () {
        const tick = yield* Ref.updateAndGet(state.tickCount, (value) => value + 1)
        const lavaTickActive = tick % LAVA_TICK_INTERVAL === 0
        const frontier = yield* Ref.get(state.fluidFrontier)
        const split = splitBudget(frontier, { lavaTickActive })
        // `carryOver` keeps BOTH the over-budget cells and the lava cells whose
        // tick was not active. Keeping only one of the two is the reference's
        // straight-edged-lava-lake bug; see domain/fluid-frontier.ts.
        yield* Ref.set(state.fluidFrontier, carryOver(frontier, split))
      }),
  },
  {
    id: GAMEPLAY_STAGE_IDS.timeWeather,
    after: [GAMEPLAY_STAGE_IDS.fluids],
    run: (dt: DeltaTimeSecs) =>
      Effect.gen(function* () {
        const dayLengthSecs = yield* Ref.get(state.dayLengthSecs)
        yield* Ref.update(state.timeOfDaySecs, (current) =>
          advanceTimeOfDay(current, dt, dayLengthSecs),
        )
      }),
  },
]

/**
 * Build the module's state and its stages together.
 *
 * This is the shape mc-compose consumes. It is NOT yet a `GameModule` (plan.md
 * §4.1) because a `GameModule` carries a `Layer.Layer<ROut, E, RIn>`, and the
 * service set `RIn` cannot be named until mc-sim's public API exists. Returning
 * the stages alone is the honest subset; the Layer is added when there is
 * something real to require.
 */
export const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>> = Effect.map(
  makeGameplayFrameState,
  gameplayStages,
)
