import { describe, it } from 'vitest'
import fc from 'fast-check'
import { craterRadius } from '../../src/domain/interactions/explosion-crater'

describe('explosion crater properties', () => {
  it('keeps every fractional power below its next radius boundary', () => {
    // Catches rounding fractional blast power upward and destroying blocks beyond floor(power).
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 999 }),
        (wholePower, fractionalThousandths) =>
          craterRadius(wholePower + fractionalThousandths / 1000) === wholePower,
      ),
    )
  })
})
