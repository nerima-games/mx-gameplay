import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { EnchantmentLevel } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
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
          const atLowRoll = rollFortuneExtraDrops(EnchantmentLevel(level), lowRoll)
          const atHighRoll = rollFortuneExtraDrops(EnchantmentLevel(level), highRoll)
          const atNextLevel = rollFortuneExtraDrops(EnchantmentLevel(level + 1), lowRoll)
          const atZeroRoll = rollFortuneExtraDrops(EnchantmentLevel(level), 0)
          const atHighestRoll = rollFortuneExtraDrops(EnchantmentLevel(level), 1 - Number.EPSILON)

          if (Result.isFailure(atLowRoll) || Result.isFailure(atHighRoll) || Result.isFailure(atNextLevel)
            || Result.isFailure(atZeroRoll) || Result.isFailure(atHighestRoll)) return false

          return [atLowRoll.success, atHighRoll.success, atNextLevel.success].every(
            (count) => Number.isInteger(count) && count >= 0,
          ) && atLowRoll.success <= atHighRoll.success && atNextLevel.success >= atLowRoll.success && atZeroRoll.success === 0 &&
            atHighestRoll.success === level
        },
      ),
    )
  })

  it('returns a typed failure or an integer count within the level bounds for every numeric roll', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 255 }),
        FastCheck.double(),
        (level, roll) => {
          const result = rollFortuneExtraDrops(EnchantmentLevel(level), roll)
          if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
            expect(result).toEqual(Result.fail({ _tag: 'InvalidFortuneRoll' }))
          } else {
            expect(Result.isSuccess(result)).toBe(true)
            if (Result.isFailure(result)) return
            expect(Number.isInteger(result.success)).toBe(true)
            expect(result.success).toBeGreaterThanOrEqual(0)
            expect(result.success).toBeLessThanOrEqual(level)
          }
        },
      ),
    )
  })
})
