import { describe, expect, it } from '@effect/vitest'
import { emptyFurnaceState, itemStack, makeTimeService, type FurnaceState } from '@nerima-games/mc-sim'
import { Effect, Result } from 'effect'
import {
  applyFurnaceAdvance,
  type FurnaceAdvancePlan,
} from '../../src/domain/interactions/advance-furnace'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import {
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameState,
  requestFurnaceAdvance,
} from '../../src/stages/registration'
import { makeChunkStoreDouble, world } from '../support/chunk-store-double'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { makeInventoryDouble } from '../support/inventory-service-double'
import { makePlayerServiceDouble } from '../support/player-service-double'
import { runFrame } from '../support/frame-runner'

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const furnaceSlice = Effect.gen(function* () {
  const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const inventory = yield* makeInventoryDouble()
  const player = yield* makePlayerServiceDouble()
  const time = yield* makeTimeService()
  const state = yield* makeGameplayFrameState
  return {
    state,
    stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time),
  }
})

const loadedFurnace = (): FurnaceState => ({
  ...unwrap(emptyFurnaceState()),
  input: unwrap(itemStack('raw_iron', 3)),
  fuel: unwrap(itemStack('coal', 1)),
})

const requestPlan = (
  slice: Effect.Success<typeof furnaceSlice>,
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
    if (
      result === undefined ||
      !('action' in result) ||
      result.action !== 'AdvanceFurnace' ||
      !('plan' in result)
    ) {
      return yield* Effect.die(`missing furnace plan for ${requestId}`)
    }
    expect(result.requestId).toBe(requestId)
    return result.plan
  })

describe('furnace input through gameplay stages', () => {
  it.effect('carries deferred time forward while conserving fuel and smelted items', () =>
    Effect.gen(function* () {
      const slice = yield* furnaceSlice
      let furnace = loadedFurnace()
      let remainingSecs = 30
      const smelted: Array<number> = []
      const fuelUsed: Array<number> = []

      for (let frame = 0; frame < 3 && remainingSecs > 0; frame += 1) {
        const plan = yield* requestPlan(slice, `furnace-frame-${String(frame)}`, furnace, remainingSecs)
        const applied = applyFurnaceAdvance(furnace, plan)
        expect(applied._tag).toBe('Applied')
        furnace = applied.state
        remainingSecs = plan.deferredSecs
        smelted.push(plan.smeltedCount)
        fuelUsed.push(plan.fuelConsumed)
      }

      expect(remainingSecs).toBe(0)
      expect(smelted).toStrictEqual([1, 1, 1])
      expect(fuelUsed).toStrictEqual([1, 0, 0])
      expect(furnace.input).toBeUndefined()
      expect(furnace.output?.item).toBe('iron_ingot')
      expect(furnace.output?.count).toBe(3)
      expect(furnace.fuel).toBeUndefined()
      expect(furnace.fuelTimeRemainingSecs).toBe(50)
    }),
  )
})
