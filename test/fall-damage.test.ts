import { describe, expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { DamageAmountSchema, DamageCauseSchema } from '@nerima-games/mc-kernel'
import { resolveFallDamage } from '../src/domain/fall-damage'

const FallDamageSchema = Schema.Struct({
  amount: DamageAmountSchema,
  cause: DamageCauseSchema,
})

const numericInputs = FastCheck.oneof(
  FastCheck.double({ min: -Number.MAX_VALUE, max: Number.MAX_VALUE }),
  FastCheck.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
)

describe('fall damage', () => {
  it.each([
    [0, undefined],
    [3, undefined],
    [3.01, { amount: 1, cause: 'fall' }],
    [4, { amount: 1, cause: 'fall' }],
    [4.01, { amount: 2, cause: 'fall' }],
    [20, { amount: 17, cause: 'fall' }],
  ] as const)('resolves a fall distance of %s', (fallDistance, expected) => {
    expect(resolveFallDamage(fallDistance)).toStrictEqual(Result.succeed(expected))
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an invalid fall distance of %s',
    (fallDistance) => {
      expect(Result.isFailure(resolveFallDamage(fallDistance))).toBe(true)
    },
  )

  it.each([3 - Number.EPSILON, 3 + Number.EPSILON])('handles the boundary neighbour %s', (fallDistance) => {
    const result = resolveFallDamage(fallDistance)
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success).toStrictEqual(fallDistance <= 3 ? undefined : { amount: 1, cause: 'fall' })
    }
  })

  it('property: invalid distances fail and valid damage decodes as finite and non-negative', () => {
    FastCheck.assert(
      FastCheck.property(numericInputs, (fallDistance) => {
        const result = resolveFallDamage(fallDistance)
        if (!Number.isFinite(fallDistance) || fallDistance < 0) {
          return Result.isFailure(result)
        }
        if (fallDistance <= 3) return Result.isSuccess(result) && result.success === undefined
        if (Result.isFailure(result) || result.success === undefined) return false

        const decoded = Schema.decodeUnknownResult(FallDamageSchema)(result.success)
        return Result.isSuccess(decoded) &&
          Number.isFinite(decoded.success.amount) &&
          decoded.success.amount >= 0 &&
          decoded.success.cause === 'fall'
      }),
      { numRuns: 200 },
    )
  })
})
