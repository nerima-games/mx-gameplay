import { describe, expect, it } from '@effect/vitest'
import { resolveFallDamage } from '../domain/fall-damage'

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
})
