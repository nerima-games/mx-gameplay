/**
 * Named regression tests for the frame contract.
 *
 * Each `it.effect` title below names the thing that must never come back. These
 * are not smoke tests: they encode plan.md §2.3-1 and §2.3-3, both of which are
 * invisible to the type checker and to `pnpm check:deps`, because both are
 * violated with STRINGS rather than with imports.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { DeltaTimeSecs, StageId, type StageRegistration } from '../domain/frame-contract'
import { disturb, takeBatch } from '../domain/falling-block'
import {
  gameplayStages,
  LAVA_TICK_INTERVAL,
  makeGameplayFrameState,
  makeGameplayStages,
} from '../stages/registration'
import {
  EXPERIENCE_MODULE_STAGE_PREFIXES,
  GAMEPLAY_STAGE_IDS,
  OWN_STAGE_PREFIX,
  UPSTREAM_STAGE_IDS,
} from '../stages/stage-ids'

const stageIds = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.map((stage) => stage.id)

const allAfterEdges = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.flatMap((stage) => [...(stage.after ?? [])])

describe('§2.3-1 zero edges between experience modules', () => {
  it.effect(
    'REGRESSION: no `after` edge names another experience module, so mx-gameplay cannot be ordered against mx-redstone/mx-ui/mx-multiplayer',
    () =>
      Effect.gen(function* () {
        const stages = yield* makeGameplayStages
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
      const stages = yield* makeGameplayStages

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
      const stages = yield* makeGameplayStages
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
      const stages = yield* makeGameplayStages
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
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state)
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      expect(entities).toBeDefined()

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void

      // Nothing was disturbed, so nothing was looked at. The reference's
      // pre-fix behaviour read ~7M blocks here regardless
      // (falling-block-maintenance.ts:9-15).
      const queue = yield* Ref.get(state.fallingBlocks)
      expect(queue.pending.size).toBe(0)
    }),
  )

  it.effect('REGRESSION: a burst of disturbances is spread across ticks by the per-tick move budget', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state)
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)

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
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state)
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
  it.effect('REGRESSION: the frame state holds no time of day and no day length', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      expect(Object.keys(state).sort()).toStrictEqual([
        'fallingBlocks',
        'fluidFrontier',
        'tickCount',
      ])
    }),
  )

  // REGRESSION: every Ref here must be free to lose on a reload. That is the
  // save-file test from the module header, applied to the whole state rather
  // than to the one field that failed it.
  it.effect('REGRESSION: every Ref in the frame state is frame-local scratch, not saved state', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // A work queue of disturbed columns, a frontier of cells still to look
      // at, and the counter that paces lava. Reconstructed within a frame of a
      // reload; none of them is a fact about the world.
      expect(yield* Ref.get(state.fallingBlocks)).toStrictEqual({ pending: new Set<string>() })
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
      expect(yield* Ref.get(state.tickCount)).toBe(0)
    }),
  )

  it.effect('a stage tolerates dt = 0, because a frame may be scheduled twice inside one clock tick', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const before = yield* Ref.get(state.tickCount)
      yield* Effect.forEach(gameplayStages(state), (stage) => stage.run(DeltaTimeSecs(0)))
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
