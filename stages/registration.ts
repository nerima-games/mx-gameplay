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
 * The stages read and write the world through mc-worldgen's `ChunkStore`
 * ---------------------------------------------------------------------------
 *
 * The store is acquired ONCE, in `makeGameplayStages` — that is, in
 * `GameModule.frameStages`, whose `RRegister` parameter exists for exactly this
 * (`domain/frame-contract.ts`). It is not acquired in `run`, because
 * `StageRegistration.run` has `FrameServices` as its context and `FrameServices`
 * is kernel's, not this repository's: a stage that demanded `ChunkStore` there
 * would be asking kernel to name mc-worldgen's services, which the tier model
 * (plan.md §2.2) forbids. `RIn` stays `never`; this repository BUILDS nothing
 * that another has to supply, it CALLS what mc-worldgen supplies.
 *
 * Until mc-worldgen is published the tag comes from `domain/chunk-store-port.ts`,
 * a mirror with a deletion date; `test/chunk-store-mirror.test.ts` is what keeps
 * the mirror honest, and the repoint is three lines in that file's header.
 *
 * ---------------------------------------------------------------------------
 * ...and the mobs through mc-sim's `EntityManager`
 * ---------------------------------------------------------------------------
 *
 * The second service, acquired at the same moment and for the same reason. It is
 * the roster this file spent a headed paragraph explaining why it could not
 * invent, and mc-sim has now built it; `domain/entity-manager-port.ts` is the
 * mirror, `test/entity-manager-mirror.test.ts` keeps it honest, and
 * `domain/entities/mob-frame.ts` is the loop.
 *
 * ---------------------------------------------------------------------------
 * State ownership in this file
 * ---------------------------------------------------------------------------
 *
 * The `Ref`s in `GameplayFrameState` are frame-local scratch: work queues,
 * inboxes, outboxes, a counter and a seed. They are NOT game state. The blocks
 * that fall, the fluid that flows, the items in the inventory, the mobs that
 * exist and the time of day are all mc-sim's and mc-worldgen's to hold; a
 * frontier is a note about what to look at next, and it is legitimately private
 * to the stage that consumes it.
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
 * Note what the block writes did NOT add: a copy of the world. The stages below
 * hold no blocks. Every read and every write goes to the store, and the only
 * thing kept between ticks is which POSITIONS are worth looking at again.
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
import { positionOfKey } from '../domain/block-position-key'
import { ChunkStore, type BlockId, type ChunkStoreApi } from '../domain/chunk-store-port'
import { applyFallingBlocks } from '../domain/entities/falling-block-move'
import {
  applySpawnAttempts,
  resolveBlasts,
  rollCasualtyDrops,
  rollSelfDestructDrops,
  sweepMobs,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../domain/entities/mob-frame'
import {
  entityManagerTag,
  type EntityManager,
  type EntityManagerApi,
  type Position,
} from '../domain/entity-manager-port'
import {
  disturb,
  emptyFallingBlockQueue,
  settled,
  takeBatch,
  type FallingBlockQueue,
} from '../domain/falling-block'
import {
  carryOver,
  splitBudget,
  type FluidWorkItem,
} from '../domain/fluid-frontier'
import type { GameModule, StageRegistration } from '../domain/frame-contract'
import { DEFAULT_ROLL_SEED } from '../domain/frame-rolls'
import { breakBlock } from '../domain/interactions/break-block'
import type { MobDrop } from '../domain/mob/mob-drop'
import type { PositionKey } from '../domain/position-key'
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
 * Every `Ref` here fails the save-file test in the module header. Two of them
 * are QUEUES of work (disturbed columns, fluid cells still to evaluate) and one
 * is the tick counter that paces lava; losing all three on a reload costs
 * nothing but a frame of catch-up.
 *
 * The remaining two are a stand-in for services that are not published yet, and
 * they are the ones to watch:
 *
 *   - `pendingBreaks` is an INBOX. Input belongs to mc-render (plan.md §4.2's
 *     `input` slot) and reaches the rules as a request to act on a position.
 *     Nothing needs it after the frame that services it, so it is scratch by
 *     the save-file test — a save file records that a block is gone, never that
 *     a mouse button was down.
 *   - `minedItems` is an OUTBOX. What a broken block yields belongs to mc-sim's
 *     `InventoryService`, which is plan.md §2.3-1's worked example and is NOT
 *     this repository's to hold. Until mc-sim is published there is no
 *     `InventoryService.add` to call, and inventing a local port would make
 *     this repository a second owner of the inventory — the exact mistake the
 *     day-length paragraph above records. A list the host drains is not an
 *     owner: it holds items for the width of one frame and answers no
 *     questions about them.
 *
 * Both disappear when their service exists: the inbox becomes mc-render's input
 * events and the outbox becomes a call inside the interactions stage. Neither
 * grows a query, a lookup or a second reader in the meantime.
 *
 * FOUR MORE ARRIVED WITH THE MOB WIRING, and each is one of the same two shapes.
 *
 *   - `targetPosition` is an INBOX and the one that most looks like a mistake, so
 *     it is argued rather than asserted. The player's pose is saved state and it
 *     is mc-sim's `PlayerService`; a second owner of it here would be exactly the
 *     `timeOfDaySecs` failure this file records. It is not one, for the reason
 *     `minedItems` is not an inventory: the frame WRITES it and the stage READS
 *     it within the same frame, it answers no question about where anybody is,
 *     nothing reads it after the frame that filled it, and it is overwritten
 *     rather than accumulated. What it stands in for is `(yield* player.pose)
 *     .feetPosition`, which mc-sim's §7-5 spells out as the host's second line —
 *     and which cannot be written yet, because `PlayerService.cameraPose`
 *     requires `ClockPort` and `domain/frame-contract.ts` names restating
 *     `ClockPort` locally as 「a far worse failure than a narrower type」. So the
 *     port that would carry it cannot be mirrored whole, and a narrow mirror of a
 *     `Context.Tag` is the hazard `domain/chunk-store-port.ts` exists to refuse.
 *
 *   - `spawnAttempts` is an INBOX of candidate cells. The SEARCH that produces
 *     them is not here and cannot be; see `MobSpawnAttempt` in
 *     `domain/entities/mob-frame.ts`, which names the two measurements it is
 *     missing and where each comes from.
 *
 *   - `mobDrops` is an OUTBOX, `minedItems`'s twin, and separate from it because
 *     the two carry different things: a broken block yields a `BlockId` and a dead
 *     mob yields an `ItemType` and a count. Both become `InventoryService.add`
 *     calls together. mc-sim IS now mirrored — `domain/entity-manager-port.ts` —
 *     so the obvious question is why the inventory is not mirrored beside it, and
 *     the answer is the whole-api rule: `InventoryServiceApi` names `Inventory`,
 *     `RecipeTable`, `CraftGrid`, `RecipeMatch` and `CraftResult`, so mirroring it
 *     honestly means restating mc-sim's crafting vocabulary in a repository that
 *     has no crafting rule to justify it. The roster was worth that price because
 *     the stage cannot iterate mobs without it; the outbox works today.
 *
 *   - `rollSeed` is neither. It is the frame's source of randomness, and
 *     `domain/frame-rolls.ts` is a whole file about why it is a seed here rather
 *     than a `Math.random()` in the rules, an `Effect.Random` in `run`'s context,
 *     or a generator on mc-sim's entity.
 */
export type GameplayFrameState = {
  readonly pendingBreaks: Ref.Ref<ReadonlyArray<PositionKey>>
  readonly minedItems: Ref.Ref<ReadonlyArray<BlockId>>
  readonly mobDrops: Ref.Ref<ReadonlyArray<MobDrop>>
  readonly spawnAttempts: Ref.Ref<ReadonlyArray<MobSpawnAttempt>>
  readonly targetPosition: Ref.Ref<Position | undefined>
  readonly rollSeed: Ref.Ref<number>
  readonly fallingBlocks: Ref.Ref<FallingBlockQueue>
  readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>
  readonly tickCount: Ref.Ref<number>
}

export const makeGameplayFrameState: Effect.Effect<GameplayFrameState> = Effect.gen(function* () {
  const pendingBreaks = yield* Ref.make<ReadonlyArray<PositionKey>>([])
  const minedItems = yield* Ref.make<ReadonlyArray<BlockId>>([])
  const mobDrops = yield* Ref.make<ReadonlyArray<MobDrop>>([])
  const spawnAttempts = yield* Ref.make<ReadonlyArray<MobSpawnAttempt>>([])
  const targetPosition = yield* Ref.make<Position | undefined>(undefined)
  // A LITERAL, not a clock reading: two runs of one scenario must draw the same
  // numbers (plan.md §5.1-3). A world seed is mc-worldgen's noun and this is
  // where it lands when that repository publishes one.
  const rollSeed = yield* Ref.make(DEFAULT_ROLL_SEED)
  const fallingBlocks = yield* Ref.make<FallingBlockQueue>(emptyFallingBlockQueue)
  const fluidFrontier = yield* Ref.make<ReadonlyArray<FluidWorkItem>>([])
  const tickCount = yield* Ref.make(0)

  return {
    pendingBreaks,
    minedItems,
    mobDrops,
    spawnAttempts,
    targetPosition,
    rollSeed,
    fallingBlocks,
    fluidFrontier,
    tickCount,
  }
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
 *
 * `store` is passed in rather than acquired per stage so that all four share
 * one service instance and so that `run` keeps kernel's signature exactly; see
 * the module header.
 */
export const gameplayStages = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
): ReadonlyArray<StageRegistration> => [
  {
    id: GAMEPLAY_STAGE_IDS.interactions,
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    // FIRST CUT: `domain/interactions/break-block.ts` is one of the ~40
    // one-rule-per-file handlers of plan.md §3.11 (break, place, bucket, flint
    // & steel, bow, farming, shears, ender pearl, feed, shear, melee, …). They
    // are deliberately many small files and ONE stage: the granularity that
    // matters for review is the rule, the granularity that matters for
    // composition is the stage (DN-GP-9).
    run: () =>
      Effect.gen(function* () {
        // `getAndSet` rather than get-then-set: whoever fills the inbox is not
        // this fiber, and a request that arrived between the two steps would be
        // dropped without a trace (DN-GP-10).
        const requests = yield* Ref.getAndSet<ReadonlyArray<PositionKey>>(state.pendingBreaks, [])
        if (requests.length === 0) {
          return
        }

        const mined: Array<BlockId> = []
        const disturbed: Array<PositionKey> = []

        for (const positionKey of requests) {
          const outcome = yield* breakBlock(store, positionOfKey(positionKey))
          switch (outcome._tag) {
            case 'Broken': {
              // The write already told us what was there, so there is no
              // read-then-write race for the drop (mc-worldgen §6-3).
              mined.push(outcome.yielded)
              // The ONLY entry point for falling-block work. Whatever rested on
              // the block just removed may now be unsupported.
              disturbed.push(positionKey)
              break
            }

            // Air was already there: `Unchanged` did not dirty the chunk, so
            // nothing here may either. Queueing a disturbance for a write that
            // changed nothing is how a held mouse button becomes a permanent
            // per-tick workload.
            case 'NothingThere':
            // The cell is not this session's to touch. Not an error — the
            // player aimed at the edge of the world, or at a chunk that has
            // not finished loading — and `run` has no error channel to put one
            // in anyway.
            case 'ChunkNotLoaded':
            case 'OutOfWorld': {
              break
            }
          }
        }

        if (mined.length > 0) {
          yield* Ref.update(state.minedItems, (items) => [...items, ...mined])
        }
        if (disturbed.length > 0) {
          yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
        }
      }),
  },
  {
    id: GAMEPLAY_STAGE_IDS.entities,
    after: [GAMEPLAY_STAGE_IDS.interactions],
    // Entities run after interactions because a mob's reaction is to the world
    // as the player just left it — reversing the two makes a creeper respond to
    // last frame's block placement, which reads as lag rather than as a bug.
    // It is also what lets a block broken this frame start falling this frame.
    //
    // THE CREEPER IS RUN HERE NOW, AND THE REASON IS STILL THE POINT. This
    // comment used to say the opposite, at length: `domain/mob/` held finished
    // rules that this stage called none of, because running them needs 「a roster
    // of mobs with positions and health」, a roster is state, state survives a
    // save/load round trip, and by the test in this file's header it is therefore
    // mc-sim's. The alternative on offer — a local `Ref<Map<MobId, CreeperFuse>>`
    // — would have run that day and would have been the same mistake as the
    // `timeOfDaySecs` Ref this file used to hold: a second owner of a noun,
    // diverging from the one that gets saved.
    //
    // mc-sim built it (`domain/entity.ts`, `application/entity-manager.ts`, and
    // §7 of that repository's `docs/public-api.md`, which quotes the paragraph
    // back). The prediction that came with the refusal was that 「this stage
    // grows a loop and nothing in `domain/mob/` changes」. The loop is
    // `domain/entities/mob-frame.ts` and NOT ONE FILE IN `domain/mob/` CHANGED.
    //
    // The order below is the frame's, and the two halves are not independent: a
    // creeper's crater writes blocks, which `disturb`s them, which the
    // falling-block pass then picks up IN THE SAME FRAME. That is the
    // event-driven discipline `domain/falling-block.ts` is about, reached from a
    // new direction — the blast never scans, it reports the cells it actually
    // emptied.
    run: (dt) =>
      Effect.gen(function* () {
        // ---- mobs ----------------------------------------------------------
        //
        // One sweep: despawn what is out of range, burn every creeper's fuse,
        // collect the blasts. A mob this repository has no rule for costs one
        // closure call and a shared object; see `mob-frame.ts` on why the step
        // record is the allocation only this side can remove.
        const targetPosition = yield* Ref.get(state.targetPosition)
        const blasts = yield* sweepMobs(roster, { target: targetPosition, dt })

        if (blasts.length > 0) {
          const { casualties, disturbed } = yield* resolveBlasts(roster, store, blasts)

          // What the creeper itself leaves: nothing, and the RULE says so rather
          // than this stage assuming it (`domain/mob/mob-drop.ts` on why the
          // reference gets the same answer by accident of statement order).
          const selfDestruct = blasts.flatMap((blast) => rollSelfDestructDrops(blast.kind))

          // `Ref.modify`, so the seed is read, advanced and written in one step.
          // A split read/write here would let two frames draw the same rolls,
          // which is worse than a non-deterministic generator: it is a
          // deterministic wrong one.
          const drops = yield* Ref.modify(state.rollSeed, (seed) => {
            const rolled = rollCasualtyDrops(casualties, seed)
            return [rolled.drops, rolled.seed] as const
          })

          if (selfDestruct.length > 0 || drops.length > 0) {
            yield* Ref.update(state.mobDrops, (items) => [...items, ...selfDestruct, ...drops])
          }

          // THE ONLY WAY BLOCK WORK ENTERS FROM A BLAST. `disturbed` holds the
          // cells whose write came back `Written` and nothing else, so a blast
          // in open sky enqueues nothing — the same rule the interactions stage
          // applies to a break that changed nothing.
          if (disturbed.length > 0) {
            yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
          }
        }

        // `getAndSet` rather than get-then-set, for `pendingBreaks`' reason: a
        // candidate offered between the two steps would be dropped silently.
        const attempts = yield* Ref.getAndSet<ReadonlyArray<MobSpawnAttempt>>(
          state.spawnAttempts,
          [],
        )
        if (attempts.length > 0) {
          // The outcomes — a `Refused` reason per cell, or `AtCapacity` — are
          // returned by `applySpawnAttempts` and dropped HERE, because `run`
          // returns void and there is nowhere in the frame to report a
          // diagnostic to. They are not dropped by the rule: whoever offers
          // candidates is who wants to know why they were refused, and when the
          // search that offers them lands in this repository it will call this
          // function directly and read them. `apps/preview-mining-site`'s arena
          // screen already prints the word.
          yield* applySpawnAttempts(roster, attempts)
        }

        // ---- falling blocks ------------------------------------------------
        //
        // `Ref.modify` rather than get-then-set: plan.md §3.8 lists TOCTOU on a
        // Ref among the reference's recurring Effect-level mistakes.
        // Read-modify-write as two steps is a race the moment anything else
        // forks — and something else always does, because `disturb` is called
        // by every rule that writes a block, including the crater above.
        const batch = yield* Ref.modify(state.fallingBlocks, (queue) => {
          const { batch: taken, rest } = takeBatch(queue)
          return [taken, rest] as const
        })

        // An idle tick stops HERE, without touching the store. This is the
        // whole of DN-GP-1: the reference implementation read ~7M blocks at
        // this point whether or not anything had moved. The mob half above is
        // held to the same standard by the same test — an idle frame's sweep
        // returns the roster it was given, hands every mob the SAME step object,
        // and makes no store call at all.
        if (batch.length === 0) {
          return
        }

        const { destinations } = yield* applyFallingBlocks(store, batch)

        // `update`, not `set`: the store writes above may have caused other
        // rules to disturb positions while this tick was running, and a `set`
        // would erase them.
        if (destinations.length > 0) {
          yield* Ref.update(state.fallingBlocks, (queue) => settled(queue, destinations))
        }
      }),
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
 * This is exactly `GameModule.frameStages` — see `gameplayModule` below. The two
 * services in the context are the whole reason that field is an Effect: this is
 * the one moment at which a module may acquire a service in order to BUILD a
 * stage, rather than in order to run one.
 *
 * ---------------------------------------------------------------------------
 * `MobBehaviour` IS NAMED HERE, AND THAT IS THE POINT OF FAILURE TO KNOW ABOUT
 * ---------------------------------------------------------------------------
 *
 * `entityManagerTag<MobBehaviour>()` and `EntityManagerLayer<MobBehaviour>()`
 * must agree, and NO COMPILER CAN CHECK THAT THEY DO: mc-sim's Layer has result
 * type `Layer.Layer<EntityManager>` with the behaviour parameter appearing
 * nowhere in it, because the context identity is unparameterised while the
 * service value type is not (`docs/public-api.md` §7-1 of that repository). A
 * host that instantiates the roster at some other `S` gets a Layer that
 * satisfies this requirement and a `behaviour` field that is not what the line
 * below says it is.
 *
 * The mitigation is that exactly one repository names the type and the host
 * imports that name: `MobBehaviour` and `repairMobBehaviour` are both exported
 * from `index.ts` for this reason. The host's two lines are
 *
 *     const world = Layer.merge(
 *       simModule.layers,
 *       EntityManagerLayer<MobBehaviour>(undefined, repairMobBehaviour),
 *     )
 *
 * and taking `gameplayModule.frameStages` from inside that same `Effect.provide`.
 * See `docs/public-api.md` for why `simModule` should not grow a type parameter
 * to try to do this for the host.
 */
export const makeGameplayStages: Effect.Effect<
  ReadonlyArray<StageRegistration>,
  never,
  ChunkStore | EntityManager
> = Effect.gen(function* () {
  const store = yield* ChunkStore
  const roster = yield* entityManagerTag<MobBehaviour>()
  const state = yield* makeGameplayFrameState

  return gameplayStages(state, store, roster)
})

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
 * `RRegister` is now `ChunkStore | EntityManager` and `RIn` is still `never`,
 * which is the distinction that parameter was added for: this repository needs
 * mc-worldgen's store in order to REGISTER stages that write blocks and mc-sim's
 * roster in order to register the stage that iterates mobs, and needs nothing at
 * all in order to build a Layer it does not have.
 *
 * The union growing from one service to two is the shape `RRegister` predicted
 * and is not a widening of anything a consumer relies on: `RIn` is untouched, so
 * mx-gameplay still BUILDS nothing another repository has to supply. What it
 * does mean is that a host which was providing only the store now fails to
 * compile, which is the correct failure — the alternative is a stage that
 * iterates a roster nobody built.
 */
export const gameplayModule: GameModule<never, never, never, ChunkStore | EntityManager> = {
  layers: Layer.empty,
  frameStages: makeGameplayStages,
}
