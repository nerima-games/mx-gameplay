import { advanceFurnace, type FurnaceState } from '@nerima-games/mc-sim'

/** One request may consume at most one recipe interval, keeping stage work bounded. */
export const MAX_FURNACE_ADVANCE_SECS = 10

export type FurnaceAdvancePlan = {
  readonly before: FurnaceState
  readonly after: FurnaceState
  readonly advancedSecs: number
  readonly deferredSecs: number
  readonly smelted: number
  readonly fuelConsumed: number
}

export type FurnaceAdvanceApplyResult =
  | { readonly _tag: 'Applied'; readonly state: FurnaceState }
  | { readonly _tag: 'Stale'; readonly state: FurnaceState }

const sameStack = (left: FurnaceState['input'], right: FurnaceState['input']): boolean =>
  left === right ||
  (left !== null && right !== null && left.item === right.item && left.count === right.count)

const sameFurnace = (left: FurnaceState, right: FurnaceState): boolean =>
  sameStack(left.input, right.input) &&
  sameStack(left.fuel, right.fuel) &&
  sameStack(left.output, right.output) &&
  left.cookElapsedSecs === right.cookElapsedSecs &&
  left.burnRemainingSecs === right.burnRemainingSecs

/** Whether the bounded simulation produced a host-visible furnace change. */
export const furnaceAdvanceChanged = (plan: FurnaceAdvancePlan): boolean =>
  !sameFurnace(plan.before, plan.after)

export const planFurnaceAdvance = (
  state: FurnaceState,
  requestedSecs: number,
): FurnaceAdvancePlan => {
  const validRequestedSecs = Number.isFinite(requestedSecs) && requestedSecs > 0 ? requestedSecs : 0
  const advancedSecs = Math.min(validRequestedSecs, MAX_FURNACE_ADVANCE_SECS)
  const outcome = advanceFurnace(state, advancedSecs)
  return {
    before: state,
    after: outcome.state,
    advancedSecs,
    deferredSecs: validRequestedSecs - advancedSecs,
    smelted: outcome.smelted,
    fuelConsumed: outcome.fuelConsumed,
  }
}

/** Apply only to the exact host-owned snapshot for which the plan was produced. */
export const applyFurnaceAdvance = (
  current: FurnaceState,
  plan: FurnaceAdvancePlan,
): FurnaceAdvanceApplyResult =>
  sameFurnace(current, plan.before)
    ? { _tag: 'Applied', state: plan.after }
    : { _tag: 'Stale', state: current }

export type FurnaceRuntimeOutcome = {
  readonly _tag: FurnaceAdvanceApplyResult['_tag']
  readonly state: FurnaceState
  readonly changed: boolean
  readonly advancedSecs: number
  readonly deferredSecs: number
}

/**
 * `applyFurnaceAdvance` alone answers whether a plan still matches its host's
 * furnace; it says nothing about what to do with the plan's time budget when it
 * does not. A stale plan means every second the plan accounted for — both what
 * it thought it advanced and what it had already deferred — went into a
 * simulation the host discarded, so none of it happened: all of it becomes
 * deferred time for the caller to re-request, rather than the `advancedSecs`
 * portion being silently lost.
 */
export const advanceFurnaceRuntime = (
  current: FurnaceState,
  plan: FurnaceAdvancePlan,
): FurnaceRuntimeOutcome => {
  const applied = applyFurnaceAdvance(current, plan)

  return {
    _tag: applied._tag,
    state: applied.state,
    changed: applied._tag === 'Applied' && furnaceAdvanceChanged(plan),
    advancedSecs: applied._tag === 'Applied' ? plan.advancedSecs : 0,
    deferredSecs: applied._tag === 'Applied'
      ? plan.deferredSecs
      : plan.advancedSecs + plan.deferredSecs,
  }
}
