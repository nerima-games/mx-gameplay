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
    expect(resolveFallDamage(fallDistance)).toStrictEqual(expected)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an invalid fall distance of %s',
    (fallDistance) => {
      expect(resolveFallDamage(fallDistance)).toBeUndefined()
    },
  )

  it('property: fall damage is absent for invalid distances or decodes as finite non-negative damage', () => {
    FastCheck.assert(
      FastCheck.property(numericInputs, (fallDistance) => {
        const damage = resolveFallDamage(fallDistance)
        if (damage === undefined) {
          return !Number.isFinite(fallDistance) || fallDistance <= 3
        }

        const decoded = Schema.decodeUnknownResult(FallDamageSchema)(damage)
        return Result.isSuccess(decoded) &&
          Number.isFinite(decoded.success.amount) &&
          decoded.success.amount >= 0 &&
          decoded.success.cause === 'fall'
      }),
      { numRuns: 200 },
    )
  })
})
