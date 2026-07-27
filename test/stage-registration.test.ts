/**
 * Named regression tests for the frame contract.
 *
 * Each `it.effect` title below names the thing that must never come back. These
 * are not smoke tests: they encode plan.md §2.3-1 and §2.3-3, both of which are
 * invisible to the type checker and to `pnpm check:deps`, because both are
 * violated with STRINGS rather than with imports.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import type { ChunkStore } from '../domain/chunk-store-port'
import type { MobBehaviour } from '../domain/entities/mob-frame'
import type { EntityManager } from '../domain/entity-manager-port'
import { DeltaTimeSecs, StageId, type GameModule, type StageRegistration } from '../domain/frame-contract'
import { disturb, takeBatch } from '../domain/falling-block'
import { DEFAULT_ROLL_SEED } from '../domain/frame-rolls'
import {
  gameplayStages,
  LAVA_TICK_INTERVAL,
  makeGameplayFrameState,
  makeGameplayStages,
  gameplayModule,
} from '../stages/registration'
import {
  EXPERIENCE_MODULE_STAGE_PREFIXES,
  GAMEPLAY_STAGE_IDS,
  OWN_STAGE_PREFIX,
  UPSTREAM_STAGE_IDS,
} from '../stages/stage-ids'
import { emptyWorldStoreLayer, makeChunkStoreDouble, world } from './support/chunk-store-double'
import { emptyRosterLayer, makeEntityManagerDouble } from './support/entity-manager-double'

const stageIds = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.map((stage) => stage.id)

/**
 * The stages read and write blocks and iterate mobs, so building them takes
 * mc-worldgen's `ChunkStore` AND mc-sim's `EntityManager` (in `frameStages` —
 * see `domain/frame-contract.ts` on `RRegister`). Tests about the SHAPE of the
 * registration provide an empty resident world and an empty roster: these
 * assertions are about ordering and contract, and the behaviour over a real
 * world is `test/vertical-slice.test.ts`.
 */
const emptyWorld = Layer.merge(emptyWorldStoreLayer, emptyRosterLayer)

const registeredStages = Effect.provide(makeGameplayStages, emptyWorld)

/** The same, for the tests that need to reach into the frame state. */
const builtStages = Effect.gen(function* () {
  const state = yield* makeGameplayFrameState
  const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  return { state, store, roster, stages: gameplayStages(state, store.api, roster.api) }
})

const allAfterEdges = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.flatMap((stage) => [...(stage.after ?? [])])

describe('§2.3-1 zero edges between experience modules', () => {
  it.effect(
    'REGRESSION: no `after` edge names another experience module, so mx-gameplay cannot be ordered against mx-redstone/mx-ui/mx-multiplayer',
    () =>
      Effect.gen(function* () {
        const stages = yield* registeredStages
        const foreign = allAfterEdges(stages).filter((edge) =>
          EXPERIENCE_MODULE_STAGE_PREFIXES.some(
            (prefix) => prefix !== OWN_STAGE_PREFIX && edge.startsWith(prefix),
          ),
        )

        // A StageId is a string, so `pnpm check:deps` cannot see this: an
        // `after: [StageId('ui:hud-sync')]` imports nothing while still making
        // mx-gameplay's frame position depend on mx-ui existing. plan.md §4.2
        // puts redstone between gameplay's fluids and its time/weather stage —
        // that ordering is mc-compose's to state, not ours.
        expect(foreign).toStrictEqual([])
      }),
  )

  it.effect('REGRESSION: every declared upstream stage belongs to a foundation repository, never to a sibling', () =>
    Effect.sync(() => {
      for (const id of Object.values(UPSTREAM_STAGE_IDS)) {
        const isSibling = EXPERIENCE_MODULE_STAGE_PREFIXES.some(
          (prefix) => prefix !== OWN_STAGE_PREFIX && id.startsWith(prefix),
        )
        expect(isSibling).toBe(false)
      }
    }),
  )
})

describe('§2.3-3 the total order belongs to mc-compose', () => {
  it.effect('REGRESSION: this repository exposes no way to resolve a total order — only `after` constraints', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages

      // Every stage declares constraints and nothing else. If a future commit
      // adds a `priority`, an `index`, or a `sortStages()` export, this
      // assertion is the thing that should stop it: those are all ways of
      // claiming a position in a sequence this repository cannot see.
      for (const stage of stages) {
        expect(Object.keys(stage).sort()).toStrictEqual(['after', 'id', 'run'])
      }
    }),
  )

  it.effect('the declared constraints form the §4.2 skeleton fragment gameplay is responsible for', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages
      const byId = new Map(stages.map((stage) => [stage.id, stage]))

      expect(stageIds(stages)).toStrictEqual([
        GAMEPLAY_STAGE_IDS.interactions,
        GAMEPLAY_STAGE_IDS.entities,
        GAMEPLAY_STAGE_IDS.fluids,
        GAMEPLAY_STAGE_IDS.timeWeather,
      ])

      expect(byId.get(GAMEPLAY_STAGE_IDS.interactions)?.after).toStrictEqual([
        UPSTREAM_STAGE_IDS.simPhysics,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.entities)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.interactions,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.fluids)?.after).toStrictEqual([GAMEPLAY_STAGE_IDS.entities])
      expect(byId.get(GAMEPLAY_STAGE_IDS.timeWeather)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.fluids,
      ])
    }),
  )

  it.effect('a consumer that ignores the array order and honours only `after` still gets a legal schedule', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages
      // Reversed on purpose: mc-compose merges four modules' arrays, so the
      // order mx-gameplay happened to write them in is never what it sees.
      const shuffled = [...stages].reverse()

      const position = new Map(stageIds(shuffled).map((id, index) => [id, index]))
      const satisfied = shuffled.every((stage) =>
        (stage.after ?? []).every((edge) => {
          const edgePosition = position.get(edge)
          // A dangling edge (a stage nobody registered) is scheduled as if the
          // edge were absent — that is what lets a module order itself against
          // an optional peer. See domain/frame-contract.ts.
          return edgePosition === undefined || edgePosition < (position.get(stage.id) ?? 0)
        }),
      )

      // The REVERSED array violates the constraints, which is the point: the
      // array order is not the schedule. A real consumer must sort.
      expect(satisfied).toBe(false)
    }),
  )

  it.effect('StageId rejects a blank id, so a stage cannot register itself as an unnameable vertex', () =>
    Effect.sync(() => {
      expect(() => StageId('   ')).toThrow()
      expect(StageId('gameplay:interactions')).toBe('gameplay:interactions')
    }),
  )
})

describe('stage behaviour', () => {
  it.effect('REGRESSION: an idle tick does no falling-block work at all (the O(chunks × blocks) scan is gone)', () =>
    Effect.gen(function* () {
      const { state, store, stages } = yield* builtStages
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      expect(entities).toBeDefined()

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void

      // Nothing was disturbed, so nothing was looked at. The reference's
      // pre-fix behaviour read ~7M blocks here regardless
      // (falling-block-maintenance.ts:9-15). Now that the stage really holds a
      // store, "did no work" is checkable directly: zero calls, not merely zero
      // changes.
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0 })
      const queue = yield* Ref.get(state.fallingBlocks)
      expect(queue.pending.size).toBe(0)
    }),
  )

  it.effect('REGRESSION: a burst of disturbances is spread across ticks by the per-tick move budget', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)

      // A TNT blast under a desert. The world is empty, so none of these
      // positions produces a move — the assertion is about the BUDGET, which
      // bounds how many positions are examined rather than how many move.
      const blast = Array.from({ length: 100 }, (_, index) => `0,${String(index)},0`)
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, blast))

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(100 - 32)

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(100 - 64)
    }),
  )

  it.effect('REGRESSION: lava keys survive the ticks on which lava is not scheduled', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)

      yield* Ref.set(state.fluidFrontier, [
        { key: 'lava-a', kind: 'lava' },
        { key: 'lava-b', kind: 'lava' },
      ])

      // Tick 1: lava's tick is inactive (1 % 4 !== 0), so nothing is evaluated
      // and BOTH keys must still be there next tick. Dropping them is the
      // straight-edged-lava-lake bug.
      yield* fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fluidFrontier)).map((item) => item.key)).toStrictEqual([
        'lava-a',
        'lava-b',
      ])

      for (let tick = 2; tick <= LAVA_TICK_INTERVAL; tick += 1) {
        yield* fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      }

      // On the active tick they are consumed.
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }),
  )

  // REGRESSION: the time of day is mc-sim's. It survives save/load, which is
  // the very test the module header names for whether a Ref belongs here, so it
  // is a noun and lives in `mc-sim/domain/time-of-day.ts` behind
  // `application/time-service.ts` (plan.md §2.3-1). This file used to hold
  // `timeOfDaySecs` and `dayLengthSecs` Refs and advance them, with a
  // `DEFAULT_DAY_LENGTH_SECS` of 1200 against mc-sim's 400 — two owners of one
  // noun, disagreeing, with only mc-sim's copy reaching the save file.
  //
  // ---------------------------------------------------------------------------
  // THIS TEST WAS CALLED 「holds no time of day and no day length」 AND IS NOT
  // ---------------------------------------------------------------------------
  //
  // A `timeOfDay` Ref now exists, and renaming a regression test to accommodate
  // the thing it was built to prevent deserves the paragraph rather than a
  // shrug. Two facts settle it.
  //
  // FIRST, the deleted failure was not "a field named timeOfDay". It was
  // OWNERSHIP: this file computed the hour, advanced it every frame from its own
  // day length, and disagreed with mc-sim about how long a day was. The new Ref
  // does none of those three. Nothing in `stages/registration.ts` increments it,
  // there is no day length anywhere in this repository, and the value is
  // overwritten by the host every frame rather than accumulated.
  //
  // SECOND, the property that actually matters is now asserted DIRECTLY, in the
  // test below, instead of being inferred from the absence of a key: running
  // frames must not change the hour. That is a strictly stronger statement than
  // "there is no field called this", because a field called something else that
  // advanced the clock would have passed the old test and fails the new one.
  //
  // What survives here unchanged is the exact-list gate, which is the part that
  // makes an addition reviewable.
  it.effect('REGRESSION: the frame state holds no day length, and every Ref is scratch', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // The list is exact on purpose: another answer to "what does mx-gameplay
      // remember between frames" has to be argued for in a diff. Two arrived
      // with the block-write wiring, four with the mob wiring, two with the
      // spawn search and FIVE with placement, loot and weather, and every one of
      // the sixteen passes the save-file test — see the paragraph on
      // `GameplayFrameState` in `stages/registration.ts`, which argues
      // `targetPosition`, `timeOfDay` and the weather pair at length because
      // they are the ones that most look like second owners of a noun.
      //
      // `spawnClockSecs` is the least interesting of the sixteen and the easiest
      // to justify: it is a countdown to the next search, and losing it on a
      // reload costs at most one 0.3s interval.
      //
      // `weather` / `weatherAdvanced` ARE THE PAIR TO WATCH, and they are the
      // reason this list is worth keeping exact. A save file does need the
      // weather, and no repository owns it — so the temptation is a single
      // advancing `Ref`, which would be `timeOfDaySecs` all over again except
      // that nothing would ever disagree with it and nobody would find out. The
      // two keys are an inbox and an outbox, and the test below asserts that
      // running frames does not change the inbox.
      //
      // WHAT IS STILL NOT HERE is the thing this list exists to keep out: there
      // is no `Ref<Map<MobId, CreeperFuse>>`, no mob position, no mob health, no
      // entity id, no INVENTORY — and no DAY LENGTH, which is the half of the
      // original failure that has no stand-in and never will, because nothing in
      // this repository needs to know how long a day is.
      expect(Object.keys(state).sort()).toStrictEqual([
        'consumedItems',
        'fallingBlocks',
        'fluidFrontier',
        'heldTool',
        'minedItems',
        'mobDrops',
        'pendingBreaks',
        'pendingPlacements',
        'rollSeed',
        'spawnAttempts',
        'spawnClockSecs',
        'targetPosition',
        'tickCount',
        'timeOfDay',
        'weather',
        'weatherAdvanced',
      ])

      expect(Object.keys(state)).not.toContain('dayLength')
      expect(Object.keys(state)).not.toContain('dayLengthSecs')
      expect(Object.keys(state)).not.toContain('timeOfDaySecs')
      // The inventory is mc-sim's. `minedItems` and `consumedItems` are lists
      // the host drains, and a Ref named for the noun would be this repository
      // becoming its second owner — the mistake `stages/registration.ts`'s
      // header records having made once already with the hour.
      expect(Object.keys(state)).not.toContain('inventory')
    }),
  )

  // REGRESSION, and the one that replaces what the rename above gave up: this
  // repository READS the hour and never ADVANCES it.
  //
  // The deleted `timeOfDaySecs` Ref was advanced by the `gameplay:time-weather`
  // stage, which is why that stage is still deliberately empty and says so.
  // Anything that ticked the clock — there, or in the entities stage that now
  // reads it — would recreate the two-owners failure under a different name, and
  // the key-list test above could not see it.
  it.effect('REGRESSION: no stage advances the clock, whatever the frame does', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages

      // A value no default could produce, so that "unchanged" cannot be
      // satisfied by a stage resetting it to zero.
      const written = 0.375
      yield* Ref.set(state.timeOfDay, written)

      // Every stage, many times, with a delta large enough that the spawn
      // search's 0.3s cadence fires repeatedly. If anything ticked the clock —
      // by dt, by a day length, or by a tick count — twenty frames would show
      // it.
      for (let frame = 0; frame < 20; frame += 1) {
        for (const stage of stages) {
          yield* stage.run(DeltaTimeSecs(0.25))
        }
      }

      // EXACTLY what the host wrote. This is the property the deleted
      // `timeOfDaySecs` Ref violated, and it is asserted rather than inferred
      // from a missing key.
      expect(yield* Ref.get(state.timeOfDay)).toBe(written)
    }),
  )

  // REGRESSION-SHAPED: the paragraph in `stages/registration.ts` that this file
  // has enforced since the day-length deletion says a `Ref<Map<MobId,
  // CreeperFuse>>` here would be 「the same mistake as the `timeOfDaySecs` Ref
  // this file used to hold」. The roster now exists in mc-sim, so the temptation
  // is gone — but the way it would come back is a stage that CACHES what it read
  // from the roster, which looks like an optimisation rather than like ownership.
  it.effect('REGRESSION: the frame state holds no mob, no mob position and no mob health', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // Nothing here is a Map, which is the shape a mob cache takes, and nothing
      // is an entity. The two mob-shaped fields hold a target the frame is
      // handed and candidate cells offered to a rule; both are emptied or
      // overwritten within the frame that reads them.
      expect(yield* Ref.get(state.targetPosition)).toBeUndefined()
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
    }),
  )

  it.effect('the seed is a literal, so two frame states start from the same one', () =>
    Effect.gen(function* () {
      // `domain/frame-rolls.ts` is a whole file about why randomness enters here
      // and nowhere else. The property that matters to plan.md §5.1-3 is this
      // one: two runs of one scenario draw the same numbers.
      const first = yield* makeGameplayFrameState
      const second = yield* makeGameplayFrameState

      expect(yield* Ref.get(first.rollSeed)).toBe(DEFAULT_ROLL_SEED)
      expect(yield* Ref.get(second.rollSeed)).toBe(DEFAULT_ROLL_SEED)
    }),
  )

  // REGRESSION: every Ref here must be free to lose on a reload. That is the
  // save-file test from the module header, applied to the whole state rather
  // than to the one field that failed it.
  it.effect('REGRESSION: every Ref in the frame state is frame-local scratch, not saved state', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // A work queue of disturbed columns, a frontier of cells still to look
      // at, the counter that paces lava, an inbox of this frame's requests and
      // an outbox of items on their way to mc-sim. Reconstructed within a frame
      // of a reload; none of them is a fact about the world. In particular the
      // outbox is not an inventory — it answers no question about what anyone
      // is carrying, and it is emptied by whoever drains it.
      expect(yield* Ref.get(state.fallingBlocks)).toStrictEqual({ pending: new Set<string>() })
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
      expect(yield* Ref.get(state.tickCount)).toBe(0)
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
      expect(yield* Ref.get(state.minedItems)).toStrictEqual([])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
      expect(yield* Ref.get(state.targetPosition)).toBeUndefined()
      expect(yield* Ref.get(state.rollSeed)).toBe(DEFAULT_ROLL_SEED)
    }),
  )

  it.effect('a stage tolerates dt = 0, because a frame may be scheduled twice inside one clock tick', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const before = yield* Ref.get(state.tickCount)
      yield* Effect.forEach(stages, (stage) => stage.run(DeltaTimeSecs(0)))
      // The fluid stage counts ticks rather than seconds, so a zero delta still
      // advances it by one — what must not happen is a crash or a divide by dt.
      expect(yield* Ref.get(state.tickCount)).toBe(before + 1)
    }),
  )

  it.effect('each call to makeGameplayFrameState yields independent state (re-entrant initialisation)', () =>
    Effect.gen(function* () {
      // plan.md §3.8: app-scope singletons were among the reference's worst bug
      // sources — a second world load inherited the first world's refs and
      // deadlocked. Two playgrounds in one process must not share a frontier.
      const first = yield* makeGameplayFrameState
      const second = yield* makeGameplayFrameState

      yield* Ref.update(first.fallingBlocks, (queue) => disturb(queue, ['1,2,3']))

      expect((yield* Ref.get(first.fallingBlocks)).pending.size).toBe(1)
      expect((yield* Ref.get(second.fallingBlocks)).pending.size).toBe(0)
    }),
  )

  it.effect('takeBatch preserves disturbance order, which is what makes a scenario test an oracle', () =>
    Effect.sync(() => {
      const queue = disturb({ pending: new Set<string>() }, ['c', 'a', 'b', 'a'])
      const { batch, rest } = takeBatch(queue, 2)
      expect(batch).toStrictEqual(['c', 'a'])
      expect([...rest.pending]).toStrictEqual(['b'])
    }),
  )
})

describe('the mirrored DeltaTimeSecs brand is kernel’s', () => {
  /*
   * REGRESSION. `domain/frame-contract.ts` restates kernel's `DeltaTimeSecs`
   * (`mc-kernel/domain/quantities.ts:37-42`), and a brand is keyed by its
   * STRING: `Brand.Brand<'DeltaTimeSecs'>` here and in kernel are ONE TYPE to
   * TypeScript, however differently the two constructors validate. So a mirror
   * that refined differently would be a false guarantee the compiler could
   * never contradict — which is exactly what mc-physics had, refining to the
   * frame-loop clamp [0.001, 0.05] while kernel refines to "finite and
   * non-negative". A kernel-built `DeltaTimeSecs(30)` satisfied its parameter
   * types while breaking the invariant its comments claimed.
   *
   * Kernel's is the agreed refinement and it is deliberately LOOSE: a zero
   * delta is legal, because a frame may be scheduled twice inside one clock
   * tick, and the clamp of plan.md §3.4 is a frame-loop concern applied at the
   * boundary by whoever PRODUCES the delta — mc-sim's `frame-timing.ts`,
   * mc-physics' `clampDeltaTime` — never a property of the quantity itself.
   * A stage receives whatever the loop produced and must cope.
   */
  it.effect('accepts zero and any finite non-negative delta, and rejects nothing else', () =>
    Effect.sync(() => {
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(0.0001)).toBe(0.0001)
      // Out of the integrator's safe range, and still a valid quantity: this is
      // what a tab that was backgrounded for thirty seconds produces.
      expect(DeltaTimeSecs(30)).toBe(30)

      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )
})


describe('the module contract has caught up with this file’s shape', () => {
  /*
   * REGRESSION — the change the vertical-slice spike forced on mc-kernel.
   *
   * `stages/registration.ts` used to carry a comment saying it was "NOT yet a
   * `GameModule`" because the service set could not be named until mc-sim
   * published. That diagnosis was half wrong, and the wrong half is what the
   * spike found: mx-gameplay publishes no service for another repository to call — a rule is not a
 * service (plan.md §2.3-1) — so its Layer is empty and always was.
   *
   * The real obstacle was that `GameModule.frameStages` was an ARRAY. These
   * stages are built from `Ref`s allocated in an Effect, so there was no way to
   * put them in a field typed `ReadonlyArray` — and, worse, an array gave NO
   * module anywhere a context in which to acquire a service in order to build a
   * stage, which forced every service any stage touched into `FrameServices`
   * and would have made kernel name mc-sim's and mc-render's services.
   *
   * kernel's `frameStages` is now an Effect. This test is what says the
   * repository actually took the shape, rather than the comment merely changing.
   */
  it.effect('REGRESSION: exports a real GameModule, not "stages alone, the Layer comes later"', () =>
    Effect.gen(function* () {
      const module: GameModule<never, never, never, ChunkStore | EntityManager> = gameplayModule
      const stages = yield* Effect.provide(module.frameStages, emptyWorld)

      expect(stageIds(stages)).toStrictEqual(Object.values(GAMEPLAY_STAGE_IDS))
    }),
  )

  it.effect('its frameStages IS the registration Effect this file already exported', () =>
    Effect.gen(function* () {
      expect(gameplayModule.frameStages).toBe(makeGameplayStages)

      // ...and it is re-entrant: two builds share no state, which is why it was
      // an Effect in the first place (plan.md §3.8 on app-scope singletons).
      const first = yield* registeredStages
      const second = yield* registeredStages
      expect(first).not.toBe(second)
    }),
  )

  // This used to read "needs nothing to register today, and says so in the
  // type", with a note predicting that a service would arrive in `frameStages`
  // — the `RRegister` parameter — rather than in the Layer. Two have: the stages
  // write blocks, so registering them takes mc-worldgen's `ChunkStore`, and they
  // iterate mobs, so they take mc-sim's `EntityManager`.
  //
  // `RIn` is still `never` and that is the distinction `RRegister` exists for.
  // This repository BUILDS nothing another repository has to supply; it CALLS
  // what mc-worldgen and mc-sim supply. Either service leaking into `RIn` would
  // be mx-gameplay claiming to construct part of somebody else's repository.
  it.effect('acquires exactly two services to register — the store and the roster, in frameStages', () =>
    Effect.gen(function* () {
      const registration: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        ChunkStore | EntityManager
      > = gameplayModule.frameStages

      // Providing those two — and nothing else — discharges the whole context.
      // If a stage started demanding a THIRD service at REGISTRATION time, this
      // assignment would stop compiling, which is the point. The candidate for
      // the third is mc-sim's `InventoryService`, and until it can be mirrored
      // whole the mob drops go to an outbox instead; see `GameplayFrameState`.
      const satisfied: Effect.Effect<ReadonlyArray<StageRegistration>, never, never> =
        Effect.provide(registration, emptyWorld)

      expect(yield* satisfied).toHaveLength(4)
    }),
  )

  // REGRESSION-SHAPED, and it is the property mc-sim's §7-1 buys with
  // `Context.GenericTag`: `EntityManager` appears ONCE in the requirement,
  // without a parameter, however the behaviour type is instantiated. If mc-sim
  // had used a Tag class per behaviour, this union would have grown a member per
  // consumer and mc-compose would have had to name mx-gameplay's `MobBehaviour`.
  it.effect('the roster requirement carries no behaviour parameter', () =>
    Effect.sync(() => {
      const unparameterised: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        ChunkStore | EntityManager
      > = makeGameplayStages

      expect(typeof unparameterised).toBe('object')
    }),
  )

  // The `run` side must stay free of it. `StageRegistration.run` is typed by
  // kernel's `FrameServices`, and a stage that demanded `ChunkStore` there
  // would be asking kernel to name mc-worldgen's services — which the tier
  // model (plan.md §2.2) forbids, and which no amount of local testing would
  // reveal until mc-compose tried to build a frame.
  it.effect('REGRESSION: the store is acquired at registration, never demanded by `run`', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages

      for (const stage of stages) {
        const runnable: Effect.Effect<void, never, never> = stage.run(DeltaTimeSecs(0.016))
        yield* runnable
      }
    }),
  )
})
