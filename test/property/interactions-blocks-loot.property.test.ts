import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import {
  FORTUNE_MULTIPLIERS,
  rollFortuneExtraDrops,
} from '../../src/domain/interactions/block-loot'

describe('block loot properties', () => {
  it('makes lower rolls and higher Fortune levels no less rewarding', () => {
    // Fails if Fortune is all-zero or constant-one, reverses its roll comparison, or lowers at higher levels.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 4 }),
        FastCheck.double({ min: 0, max: 1 - Number.EPSILON, noNaN: true }),
        FastCheck.double({ min: 0, max: 1 - Number.EPSILON, noNaN: true }),
        (level, firstRoll, secondRoll) => {
          const multiplier = FORTUNE_MULTIPLIERS.get(level)
          if (multiplier === undefined) return false

          const lowRoll = Math.min(firstRoll, secondRoll)
          const highRoll = Math.max(firstRoll, secondRoll)
          const atLowRoll = rollFortuneExtraDrops(level, lowRoll)
          const atHighRoll = rollFortuneExtraDrops(level, highRoll)
          const atNextLevel = rollFortuneExtraDrops(level + 1, lowRoll)
          const atZeroRoll = rollFortuneExtraDrops(level, 0)
          const guaranteedBonus = Math.floor(multiplier - 1)
          const atHighestRoll = rollFortuneExtraDrops(level, 1 - Number.EPSILON)

          return [atLowRoll, atHighRoll, atNextLevel].every(
            (count) => Number.isInteger(count) && count >= 0,
          ) && atLowRoll >= atHighRoll && atNextLevel >= atLowRoll && atZeroRoll > 0 &&
            atHighestRoll === guaranteedBonus
        },
      ),
    )
  })
})
