import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import { FixedDurationSecs } from '@nerima-games/mc-kernel'
import { emptyFurnaceState, itemStack, type FurnaceState } from '@nerima-games/mc-sim'
import {
  advanceFurnaceRuntime,
  applyFurnaceAdvance,
  MAX_FURNACE_ADVANCE_SECS,
  type FurnaceAdvancePlan,
  planFurnaceAdvance,
} from '../src/domain/interactions/advance-furnace'

const success = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const plan = (state: FurnaceState, elapsedSecs: number): FurnaceAdvancePlan =>
  success(planFurnaceAdvance(state, elapsedSecs))

describe('furnace advance planning', () => {
  const loaded = (): FurnaceState => ({
    ...success(emptyFurnaceState()),
    input: success(itemStack('raw_iron', 2)),
    fuel: success(itemStack('coal', 1)),
  })

  it('bounds one plan and reports deferred time', () => {
    const result = planFurnaceAdvance(loaded(), 25)
    expect(Result.isSuccess(result)).toBe(true)
    const advance = success(result)

    expect(advance.advancedSecs).toBe(MAX_FURNACE_ADVANCE_SECS)
    expect(advance.deferredSecs).toBe(15)
    expect(advance.smeltedCount).toBe(1)
    const expectedOutput = success(itemStack('iron_ingot', 1))
    expect(advance.after.output).toStrictEqual({
      ...expectedOutput,
      components: { ...expectedOutput.components },
    })
  })

  it('applies against the planned snapshot and rejects stale host state', () => {
    const state = loaded()
    const advance = plan(state, 10)
    const driftedState = {
      ...state,
      cookProgressSecs: success(FixedDurationSecs.result(1)),
    }

    expect(applyFurnaceAdvance(state, advance)).toStrictEqual({ _tag: 'Applied', state: advance.after })
    expect(applyFurnaceAdvance(driftedState, advance)).toStrictEqual({
      _tag: 'Stale',
      state: driftedState,
    })
  })

  it('treats invalid time as a deterministic no-op', () => {
    const state = loaded()
    expect(plan(state, Number.NaN)).toMatchObject({
      before: state,
      after: state,
      advancedSecs: 0,
      deferredSecs: 0,
      smeltedCount: 0,
      fuelConsumed: 0,
    })
  })

  it('reports an invalid furnace snapshot as the exact Result failure', () => {
    const state = loaded()
    const invalid = {
      ...state,
      fuelTimeRemainingSecs: success(FixedDurationSecs.result(1)),
    }

    expect(planFurnaceAdvance(invalid, 1)).toStrictEqual(Result.fail({
      _tag: 'FurnaceStateValidationFailure',
      path: 'fuelTimeRemainingSecs',
      reason: 'cannot exceed fuelTimeTotalSecs',
    }))
  })
})

describe('advanceFurnaceRuntime', () => {
  const loaded = (): FurnaceState => ({
    ...success(emptyFurnaceState()),
    input: success(itemStack('raw_iron', 2)),
    fuel: success(itemStack('coal', 1)),
  })

  it('reports the plan applied, changed, and its own advanced/deferred split', () => {
    const state = loaded()
    const advance = plan(state, 25)

    expect(advanceFurnaceRuntime(state, advance)).toStrictEqual({
      _tag: 'Applied',
      state: advance.after,
      changed: true,
      advancedSecs: advance.advancedSecs,
      deferredSecs: advance.deferredSecs,
    })
  })

  it('reports no change for a plan that advanced nothing', () => {
    const state = loaded()
    const advance = plan(state, 0)

    expect(advanceFurnaceRuntime(state, advance)).toStrictEqual({
      _tag: 'Applied',
      state: advance.after,
      changed: false,
      advancedSecs: 0,
      deferredSecs: 0,
    })
  })

  it('folds a stale plan\'s ENTIRE time budget — advanced and already-deferred — into deferred, since none of it happened', () => {
    const state = loaded()
    const advance = plan(state, 25)
    const driftedState = {
      ...state,
      cookProgressSecs: success(FixedDurationSecs.result(1)),
    }

    expect(advanceFurnaceRuntime(driftedState, advance)).toStrictEqual({
      _tag: 'Stale',
      state: driftedState,
      changed: false,
      advancedSecs: 0,
      deferredSecs: advance.advancedSecs + advance.deferredSecs,
    })
  })
})
