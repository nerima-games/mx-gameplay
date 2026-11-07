import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Result } from 'effect'
import { emptyFurnaceState, itemStack, type FurnaceState } from '@nerima-games/mc-sim'
import { planFurnaceAdvance } from '../../src/domain/interactions/advance-furnace'

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const stackCount = (slot: FurnaceState['input']): number => slot?.count ?? 0

const makeFurnace = (inputCount: number, outputCount: number, fuelCount: number): FurnaceState => ({
  ...unwrap(emptyFurnaceState()),
  input: unwrap(itemStack('raw_iron', inputCount)),
  output: outputCount === 0 ? undefined : unwrap(itemStack('iron_ingot', outputCount)),
  fuel: unwrap(itemStack('coal', fuelCount)),
})

describe('furnace advancement properties', () => {
  it('preserves requested time across the bounded advance and deferred remainder', () => {
    // Fails if a capped frame loses time or reports more work than its per-call budget.
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: 120 }), (requestedSecs) => {
        const result = planFurnaceAdvance(makeFurnace(8, 0, 2), requestedSecs)
        if (Result.isFailure(result)) return false

        const expectedProgress = requestedSecs < 10 ? requestedSecs : 10
        return result.success.advancedSecs === expectedProgress &&
          result.success.advancedSecs + result.success.deferredSecs === requestedSecs &&
          result.success.advancedSecs <= 10 &&
          result.success.deferredSecs >= 0
      }),
    )
  })

  it('moves exactly the smelted count from input to output and reports consumed fuel', () => {
    // Fails if a completed recipe duplicates or loses an item, or fuel accounting drifts from its slot.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.tuple(
          FastCheck.integer({ min: 1, max: 8 }),
          FastCheck.integer({ min: 0, max: 10 }),
          FastCheck.integer({ min: 1, max: 2 }),
        ),
        ([inputCount, outputCount, fuelCount]) => {
          const before = makeFurnace(inputCount, outputCount, fuelCount)
          const result = planFurnaceAdvance(before, 10)
          if (Result.isFailure(result)) return false

          const { after, smeltedCount, fuelConsumed } = result.success
          return stackCount(before.input) - stackCount(after.input) === smeltedCount &&
            stackCount(after.output) - stackCount(before.output) === smeltedCount &&
            stackCount(before.fuel) - stackCount(after.fuel) === fuelConsumed &&
            smeltedCount === 1 &&
            fuelConsumed === 1 &&
            after.fuelTimeRemainingSecs === 70
        },
      ),
    )
  })
})
