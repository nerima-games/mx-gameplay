import { describe, expect, it } from '@effect/vitest'
import { emptyFurnaceState, itemStack, makeTimeService, type FurnaceState } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import {
  applyFurnaceAdvance,
  MAX_FURNACE_ADVANCE_SECS,
  type FurnaceAdvancePlan,
} from '../src/domain/interactions/advance-furnace'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import {
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameState,
  requestFurnaceAdvance,
} from '../src/stages/registration'
import { makeChunkStoreDouble, world } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makeInventoryDouble } from './support/inventory-service-double'
import { makePlayerServiceDouble } from './support/player-service-double'
import { runFrame } from './support/frame-runner'

const loadedFurnace = (): FurnaceState => ({
  ...emptyFurnaceState(),
  input: itemStack('raw_iron', 3),
  fuel: itemStack('coal', 1),
})

const furnaceSlice = Effect.gen(function* () {
  const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const inventory = yield* makeInventoryDouble()
  const player = yield* makePlayerServiceDouble()
  const time = yield* makeTimeService()
  const state = yield* makeGameplayFrameState
  const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)
  return { state, stages }
})

const requestPlan = (
  slice: Effect.Effect.Success<typeof furnaceSlice>,
  requestId: string,
  furnace: FurnaceState,
  requestedSecs: number,
): Effect.Effect<FurnaceAdvancePlan> =>
  Effect.gen(function* () {
    yield* requestFurnaceAdvance(slice.state, requestId, furnace, requestedSecs)
    yield* runFrame(slice.stages)
    const results = yield* drainItemUseResults(slice.state)
    const result = results[0]
    expect(results).toHaveLength(1)
    expect(result).toMatchObject({ action: 'AdvanceFurnace', requestId })
    if (result === undefined || !('action' in result) || result.action !== 'AdvanceFurnace') {
      return yield* Effect.die(`missing furnace plan for ${requestId}`)
    }
    return result.plan
  })

describe('furnace plan lifecycle through the registered interaction stage', () => {
  it.effect('applies bounded plans across frames until all requested time is consumed', () =>
    Effect.gen(function* () {
      const slice = yield* furnaceSlice
      let furnace = loadedFurnace()
      let remainingSecs = 25
      const plans: Array<FurnaceAdvancePlan> = []

      for (let frame = 0; frame < 3 && remainingSecs > 0; frame += 1) {
        const previousRemainingSecs = remainingSecs
        const plan = yield* requestPlan(slice, `frame-${String(frame)}`, furnace, remainingSecs)
        const applied = applyFurnaceAdvance(furnace, plan)
        expect(applied._tag).toBe('Applied')
        furnace = applied.state
        remainingSecs = plan.deferredSecs
        expect(remainingSecs).toBeLessThan(previousRemainingSecs)
        plans.push(plan)
      }

      expect(remainingSecs).toBe(0)
      expect(plans.map((plan) => plan.advancedSecs)).toStrictEqual([
        MAX_FURNACE_ADVANCE_SECS,
        MAX_FURNACE_ADVANCE_SECS,
        5,
      ])
      expect(plans.map((plan) => plan.deferredSecs)).toStrictEqual([15, 5, 0])
      expect(furnace.input).toStrictEqual(itemStack('raw_iron', 1))
      expect(furnace.output).toStrictEqual(itemStack('iron_ingot', 2))
      expect(furnace.cookElapsedSecs).toBe(5)
    }),
  )

  it.effect('rejects a plan when the host snapshot changed before application', () =>
    Effect.gen(function* () {
      const slice = yield* furnaceSlice
      const requestedSnapshot = loadedFurnace()
      const plan = yield* requestPlan(slice, 'stale-plan', requestedSnapshot, 10)
      const current = { ...requestedSnapshot, input: itemStack('raw_iron', 2) }

      expect(applyFurnaceAdvance(current, plan)).toStrictEqual({
        _tag: 'Stale',
        state: current,
      })
    }),
  )

  it.effect('carries deferred time into the next frame without advancing it implicitly', () =>
    Effect.gen(function* () {
      const slice = yield* furnaceSlice
      const initial = loadedFurnace()
      const first = yield* requestPlan(slice, 'deferred-1', initial, 25)
      const firstApplied = applyFurnaceAdvance(initial, first)
      expect(firstApplied._tag).toBe('Applied')
      expect(first.deferredSecs).toBe(15)

      yield* runFrame(slice.stages)
      expect(yield* drainItemUseResults(slice.state)).toStrictEqual([])

      const second = yield* requestPlan(
        slice,
        'deferred-2',
        firstApplied.state,
        first.deferredSecs,
      )
      expect(second.advancedSecs).toBe(MAX_FURNACE_ADVANCE_SECS)
      expect(second.deferredSecs).toBe(5)
      expect(second.before).toStrictEqual(first.after)
    }),
  )
})
