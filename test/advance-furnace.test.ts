import { describe, expect, it } from '@effect/vitest'
import { emptyFurnaceState, itemStack } from '@nerima-games/mc-sim'
import {
  applyFurnaceAdvance,
  MAX_FURNACE_ADVANCE_SECS,
  planFurnaceAdvance,
} from '../src/domain/interactions/advance-furnace'

describe('furnace advance planning', () => {
  const loaded = () => ({
    ...emptyFurnaceState(),
    input: itemStack('raw_iron', 2),
    fuel: itemStack('coal', 1),
  })

  it('bounds one plan and reports deferred time', () => {
    const plan = planFurnaceAdvance(loaded(), 25)

    expect(plan.advancedSecs).toBe(MAX_FURNACE_ADVANCE_SECS)
    expect(plan.deferredSecs).toBe(15)
    expect(plan.smelted).toBe(1)
    expect(plan.after.output).toStrictEqual(itemStack('iron_ingot', 1))
  })

  it('applies against the planned snapshot and rejects stale host state', () => {
    const state = loaded()
    const plan = planFurnaceAdvance(state, 10)

    expect(applyFurnaceAdvance(state, plan)).toStrictEqual({ _tag: 'Applied', state: plan.after })
    expect(applyFurnaceAdvance({ ...state, cookElapsedSecs: 1 }, plan)).toStrictEqual({
      _tag: 'Stale',
      state: { ...state, cookElapsedSecs: 1 },
    })
  })

  it('treats invalid time as a deterministic no-op', () => {
    const state = loaded()
    expect(planFurnaceAdvance(state, Number.NaN)).toMatchObject({
      before: state,
      after: state,
      advancedSecs: 0,
      deferredSecs: 0,
      smelted: 0,
      fuelConsumed: 0,
    })
  })
})
