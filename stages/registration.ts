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
 * counter. They are NOT game state. The blocks that fall, the fluid that flows
 * and the time of day are all mc-sim's and mc-worldgen's to hold; a frontier is
 * a note about what to look at next, and it is legitimately private to the
 * stage that consumes it.
 *
 * The distinction is worth policing, because "just one more Ref" is how the
 * reference implementation ended up with 13k LOC of rules in its composition
 * layer (plan.md §3.15). The test for whether a Ref belongs here: would a save
 * file need it? If yes, it belongs to mc-save via mc-sim.
 *
 * That test had already been failed once, and the failure is instructive. This
 * file used to hold `timeOfDaySecs` and `dayLengthSecs` `Ref`s and advance them
 * in the `gameplay:time-weather` stage, with a `DEFAULT_DAY_LENGTH_SECS` of
 * 1200 against mc-sim's 400. A save file certainly needs the time of day, so by
 * the rule stated two paragraphs above it was never this repository's — and
 * mc-sim already owned it, in `domain/time-of-day.ts` behind
 * `application/time-service.ts`, ordering hazard and all. Two owners of one
 * noun is two answers to "what time is it", and only one of them gets saved.
 * The rule that remains here — what the world DOES about the hour — is
 * `domain/day-night.ts`, and it holds nothing.
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
import { Effect, Layer, Ref } from 'effect'
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
import type { GameModule, StageRegistration } from '../domain/frame-contract'
import { GAMEPLAY_STAGE_IDS, UPSTREAM_STAGE_IDS } from './stage-ids'

/**
 * How many gameplay ticks pass between two active lava ticks.
 *
 * Vanilla lava spreads several times more slowly than water. Provisional: the
 * shipped value comes out of the fluid preview, not out of a guess made here.
 */
export const LAVA_TICK_INTERVAL = 4

/**
 * Frame-local scratch, and nothing else.
 *
 * Every `Ref` here fails the save-file test in the module header: a work queue
 * of disturbed columns, a frontier of cells still to evaluate, and the tick
 * counter that paces lava. Losing all three on a reload costs nothing but a
 * frame of catch-up. Anything that would NOT be free to lose belongs to mc-sim.
 */
export type GameplayFrameState = {
  readonly fallingBlocks: Ref.Ref<FallingBlockQueue>
  readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>
  readonly tickCount: Ref.Ref<number>
}

export const makeGameplayFrameState: Effect.Effect<GameplayFrameState> = Effect.gen(function* () {
  const fallingBlocks = yield* Ref.make<FallingBlockQueue>(emptyFallingBlockQueue)
  const fluidFrontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])
  const tickCount = yield* Ref.make(0)

  return { fallingBlocks, fluidFrontier, tickCount }
})

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
    // FIRST CUT, and deliberately empty rather than "advance the clock".
    //
    // ADVANCING the clock is mc-sim's: `TimeService.advance(dt)` over
    // `mc-sim/domain/time-of-day.ts`, which owns the absolute tick counter, the
    // day-length denominator, the `setDayLength -> setTimeOfDay` ordering rule
    // and the value that reaches the save file. This stage held a second copy
    // of that state until it was deleted; see the module header.
    //
    // What this stage grows into is the CONSEQUENCES of the hour — weather
    // transitions, and gating hostile spawns on `domain/day-night.ts`'s
    // `hostileSpawnsAllowed` — each applied as a write through mc-sim, in the
    // same shape as `interactions` above. It stays empty until mc-sim is
    // published and there is a service to read the hour from and write the
    // consequences to: plan.md §6 Step 3 is bottom-up publish-then-pin, and an
    // invented local port would be a third answer to "who owns the time of
    // day". The registration is here now because the frame POSITION is what
    // mc-compose needs, and that is settled.
    run: () => Effect.void,
  },
]

/**
 * Build the module's state and its stages together.
 *
 * This is exactly `GameModule.frameStages` — see `gameplayModule` below, and
 * the note there on why that sentence is new.
 */
export const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>> = Effect.map(
  makeGameplayFrameState,
  gameplayStages,
)

/**
 * mx-gameplay as a `GameModule` (plan.md §4.1).
 *
 * ---------------------------------------------------------------------------
 * This used not to be expressible, and the reason is worth keeping
 * ---------------------------------------------------------------------------
 *
 * `makeGameplayStages` above carried a comment saying it was "NOT yet a
 * `GameModule`" because a `GameModule` carried a `Layer.Layer<ROut, E, RIn>`
 * and the service set could not be named until mc-sim's public API existed.
 *
 * That diagnosis was half right. The Layer was never the obstacle — mx-gameplay
 * PROVIDES no service at all (a rule is not a service; anything another
 * repository would want to ask this repository is really a question about
 * state, and state lives in mc-sim or mc-worldgen, plan.md §2.3-1), so its
 * Layer is empty and always was. The obstacle was that `frameStages` was an
 * ARRAY: this module's stages are built from `Ref`s allocated in an Effect, so
 * there was no way to put them in a field typed `ReadonlyArray`. Publishing
 * mc-sim would not have fixed that.
 *
 * The vertical-slice spike changed `frameStages` to an Effect, and the shape
 * this repository had already been forced into became the contract.
 *
 * `RIn` is `never` and stays `never`. When mx-gameplay starts writing through
 * mc-sim's services, those are acquired in `frameStages` — the `RRegister`
 * parameter — not in the Layer: this repository builds nothing that mc-sim has
 * to supply, it CALLS things mc-sim supplies.
 */
export const gameplayModule: GameModule<never, never, never> = {
  layers: Layer.empty,
  frameStages: makeGameplayStages,
}
