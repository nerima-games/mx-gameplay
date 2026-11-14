import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Result } from 'effect'
import {
  DEFAULT_ROLL_SEED,
  drawRolls,
  nextRoll,
  normaliseSeed,
  rollAt,
} from '../src/domain/frame-rolls'

const MODULUS = 2_147_483_647
const anyNumber = FastCheck.double({ noNaN: false, noDefaultInfinity: false })

describe('normaliseSeed and nextRoll', () => {
  it.effect('returns a typed failure for every non-finite seed and legal states for every finite seed', () =>
    Effect.sync(() => {
      FastCheck.assert(FastCheck.property(anyNumber, (seed) => {
        const result = normaliseSeed(seed)
        expect(Result.isFailure(result)).toBe(!Number.isFinite(seed))
        if (Result.isSuccess(result)) {
          expect(Number.isInteger(result.success)).toBe(true)
          expect(result.success).toBeGreaterThanOrEqual(1)
          expect(result.success).toBeLessThan(MODULUS)
          const draw = nextRoll(seed)
          expect(Result.isSuccess(draw)).toBe(true)
          if (Result.isSuccess(draw)) {
            expect(draw.success.roll).toBeGreaterThanOrEqual(0)
            expect(draw.success.roll).toBeLessThan(1)
            expect(draw.success.seed).toBeGreaterThanOrEqual(1)
            expect(draw.success.seed).toBeLessThan(MODULUS)
          }
        } else {
          expect(Result.isFailure(nextRoll(seed))).toBe(true)
        }
      }))

      expect(Result.isFailure(normaliseSeed(Number.NaN))).toBe(true)
      expect(Result.isFailure(normaliseSeed(Number.POSITIVE_INFINITY))).toBe(true)
      expect(Result.isFailure(normaliseSeed(Number.NEGATIVE_INFINITY))).toBe(true)
      expect(normaliseSeed(0)).toStrictEqual(Result.succeed(1))
      expect(normaliseSeed(-MODULUS)).toStrictEqual(Result.succeed(1))
      expect(normaliseSeed(DEFAULT_ROLL_SEED)).toStrictEqual(Result.succeed(DEFAULT_ROLL_SEED))
      expect(Result.isFailure(normaliseSeed(undefined as unknown as number))).toBe(true)
    }),
  )
})

describe('drawRolls', () => {
  it.effect('preserves the seed for a zero batch and replays a non-empty sequence', () =>
    Effect.sync(() => {
      const empty = drawRolls(DEFAULT_ROLL_SEED, 0)
      expect(Result.isSuccess(empty)).toBe(true)
      if (Result.isFailure(empty)) return
      expect(empty.success.rolls).toStrictEqual([])
      expect(empty.success.seed).toBe(DEFAULT_ROLL_SEED)

      const next = drawRolls(empty.success.seed, 2)
      const repeated = drawRolls(DEFAULT_ROLL_SEED, 2)
      expect(next).toStrictEqual(repeated)
      expect(drawRolls(0, 0)).toStrictEqual(Result.succeed({ rolls: empty.success.rolls, seed: 0 }))
    }),
  )

  it.effect('accepts safe integer counts and rejects invalid counts without throwing', () =>
    Effect.sync(() => {
      const countInput = FastCheck.oneof(
        FastCheck.integer({ min: 0, max: 256 }),
        anyNumber.filter((count) => !Number.isSafeInteger(count) || count < 0),
      )
      FastCheck.assert(FastCheck.property(countInput, (count) => {
        const result = drawRolls(DEFAULT_ROLL_SEED, count)
        const valid = Number.isSafeInteger(count) && count >= 0
        expect(Result.isFailure(result)).toBe(!valid)
        if (Result.isSuccess(result)) {
          expect(result.success.rolls).toHaveLength(count)
          expect(Number.isFinite(result.success.seed)).toBe(true)
        }
      }))

      expect(Result.isSuccess(drawRolls(DEFAULT_ROLL_SEED, 0))).toBe(true)
      expect(Result.isSuccess(drawRolls(DEFAULT_ROLL_SEED, 256))).toBe(true)
      expect(Result.isSuccess(drawRolls(DEFAULT_ROLL_SEED, 1_024))).toBe(true)
      for (const invalid of [
        -Number.MIN_VALUE,
        -1,
        0.5,
        Number.MAX_SAFE_INTEGER + 1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        undefined,
      ]) {
        expect(Result.isFailure(drawRolls(DEFAULT_ROLL_SEED, invalid as number))).toBe(true)
      }
      expect(Result.isFailure(drawRolls(Number.NaN, 0))).toBe(true)
    }),
  )
})

describe('rollAt', () => {
  it.effect('returns only an existing roll and rejects every invalid index', () =>
    Effect.sync(() => {
      const batch = drawRolls(DEFAULT_ROLL_SEED, 3)
      expect(Result.isSuccess(batch)).toBe(true)
      if (Result.isFailure(batch)) return

      FastCheck.assert(FastCheck.property(anyNumber, (index) => {
        const result = rollAt(batch.success, index)
        const valid = Number.isInteger(index) && index >= 0 && index < batch.success.rolls.length
        expect(Result.isFailure(result)).toBe(!valid)
        if (Result.isSuccess(result)) expect(result.success).toBe(batch.success.rolls[index])
      }))

      const empty = drawRolls(DEFAULT_ROLL_SEED, 0)
      expect(Result.isSuccess(empty)).toBe(true)
      if (Result.isSuccess(empty)) {
        expect(Result.isFailure(rollAt(empty.success, 0))).toBe(true)
        expect(Result.isFailure(rollAt(empty.success, 41))).toBe(true)
      }
      for (const invalid of [-1, 0.5, 3, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
        expect(Result.isFailure(rollAt(batch.success, invalid as number))).toBe(true)
      }
      for (const invalid of [undefined, null, {}, { rolls: undefined }]) {
        expect(Result.isFailure(rollAt(invalid as never, 0))).toBe(true)
      }
    }),
  )
})
