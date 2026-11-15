import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { rollFortuneExtraDrops } from '../../src/domain/interactions/block-loot'

describe('block loot properties', () => {
  it('keeps the vanilla Fortune roll monotonic in roll and level', () => {
    // Fails if the integer roll is reversed, a stronger level loses drops, or outputs leave their legal range.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 4 }),
        FastCheck.double({ min: 0, max: 1 - Number.EPSILON, noNaN: true }),
        FastCheck.double({ min: 0, max: 1 - Number.EPSILON, noNaN: true }),
        (level, firstRoll, secondRoll) => {
          const lowRoll = Math.min(firstRoll, secondRoll)
          const highRoll = Math.max(firstRoll, secondRoll)
          const atLowRoll = rollFortuneExtraDrops(level, lowRoll)
          const atHighRoll = rollFortuneExtraDrops(level, highRoll)
          const atNextLevel = rollFortuneExtraDrops(level + 1, lowRoll)
          const atZeroRoll = rollFortuneExtraDrops(level, 0)
          const atHighestRoll = rollFortuneExtraDrops(level, 1 - Number.EPSILON)

          return [atLowRoll, atHighRoll, atNextLevel].every(
            (count) => Number.isInteger(count) && count >= 0,
          ) && atLowRoll <= atHighRoll && atNextLevel >= atLowRoll && atZeroRoll === 0 &&
            atHighestRoll === level
        },
      ),
    )
  })
})
