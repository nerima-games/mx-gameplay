import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { normalizeDirection2, normalizeDirection3 } from '../../src/domain/math/direction'

const signedMantissa = fc.tuple(
  fc.boolean(),
  fc.double({ min: 0.25, max: 1, noNaN: true, noDefaultInfinity: true }),
).map(([negative, magnitude]) => negative ? -magnitude : magnitude)

const binaryScale = fc.integer({ min: -1022, max: 1023 }).map((exponent) => 2 ** exponent)

describe('direction normalization properties', () => {
  it('normalizes finite 2D directions across very small and very large scales', () => {
    // Catches a norm that rounds to zero or infinity before division, leaving a non-unit direction.
    fc.assert(
      fc.property(binaryScale, signedMantissa, signedMantissa, (scale, unitX, unitZ) => {
        const x = unitX * scale
        const z = unitZ * scale
        const output = { x: 0, z: 0 }
        const result = normalizeDirection2(x, z, output)

        expect(result).toBe(output)
        expect(Math.hypot(output.x, output.z)).toBeCloseTo(1, 12)
        expect(Math.sign(output.x)).toBe(Math.sign(x))
        expect(Math.sign(output.z)).toBe(Math.sign(z))
        expect(output.x / output.z).toBeCloseTo(unitX / unitZ, 12)
      }),
    )
  })

  it('normalizes finite 3D directions across very small and very large scales', () => {
    // Catches scale-dependent unit vectors when all three input components share an extreme scale.
    fc.assert(
      fc.property(binaryScale, signedMantissa, signedMantissa, signedMantissa, (scale, unitX, unitY, unitZ) => {
        const x = unitX * scale
        const y = unitY * scale
        const z = unitZ * scale
        const output = { x: 0, y: 0, z: 0 }
        const result = normalizeDirection3(x, y, z, output)

        expect(result).toBe(output)
        expect(Math.hypot(output.x, output.y, output.z)).toBeCloseTo(1, 12)
        expect(Math.sign(output.x)).toBe(Math.sign(x))
        expect(Math.sign(output.y)).toBe(Math.sign(y))
        expect(Math.sign(output.z)).toBe(Math.sign(z))
        expect(output.x / output.y).toBeCloseTo(unitX / unitY, 12)
        expect(output.x / output.z).toBeCloseTo(unitX / unitZ, 12)
      }),
    )
  })

  it('normalizes a diagonal made from the smallest subnormal components', () => {
    // Catches Math.hypot rounding a subnormal diagonal so division produces a vector of length √2.
    const output = { x: 0, z: 0 }
    const result = normalizeDirection2(Number.MIN_VALUE, -Number.MIN_VALUE, output)

    expect(result).toBe(output)
    expect(output.x).toBeCloseTo(1 / Math.sqrt(2), 15)
    expect(output.z).toBeCloseTo(-1 / Math.sqrt(2), 15)
    expect(Math.hypot(output.x, output.z)).toBeCloseTo(1, 15)
  })

  it('normalizes near-zero nonzero and maximum finite directions without changing their ratio', () => {
    // Catches zero-length underflow and infinite-length overflow while preserving represented direction.
    const directions: ReadonlyArray<readonly [number, number]> = [
      [3e-300, -4e-300],
      [Number.MAX_VALUE, -Number.MAX_VALUE / 2],
    ]
    for (const [x, z] of directions) {
      const output = { x: 0, z: 0 }
      const result = normalizeDirection2(x, z, output)

      expect(result).toBe(output)
      expect(Math.hypot(output.x, output.z)).toBeCloseTo(1, 12)
      expect(output.x / output.z).toBeCloseTo(x / z, 12)
    }
  })

  it('normalizes subnormal, near-zero, and maximum finite 3D directions with a zero component', () => {
    // Catches loss of unit length or direction when scaling extremes in the 3D path.
    const directions: ReadonlyArray<readonly [number, number, number]> = [
      [Number.MIN_VALUE, -Number.MIN_VALUE, Number.MIN_VALUE],
      [3e-300, -4e-300, 0],
      [Number.MAX_VALUE, -Number.MAX_VALUE / 2, 0],
    ]
    for (const [x, y, z] of directions) {
      const output = { x: 0, y: 0, z: 0 }
      const result = normalizeDirection3(x, y, z, output)

      expect(result).toBe(output)
      expect(Math.hypot(output.x, output.y, output.z)).toBeCloseTo(1, 12)
      expect(Math.sign(output.x)).toBe(Math.sign(x))
      expect(Math.sign(output.y)).toBe(Math.sign(y))
      expect(Math.sign(output.z)).toBe(Math.sign(z))
      expect(output.x / output.y).toBeCloseTo(x / y, 12)
      if (z === 0) expect(output.z).toBe(0)
      else expect(output.x / output.z).toBeCloseTo(x / z, 12)
    }
  })

  it('preserves a zero component and the sign of the other component', () => {
    // Catches a zero axis becoming NaN or a nonzero axis losing its direction during normalization.
    const output = { x: 1, z: 1 }
    const result = normalizeDirection2(0, -7, output)

    expect(result).toBe(output)
    expect(output).toStrictEqual({ x: 0, z: -1 })
  })

  it('returns undefined for zero vectors in both dimensions', () => {
    // Catches dividing a zero vector and returning NaNs instead of the documented absence of direction.
    expect(normalizeDirection2(0, 0, { x: 0, z: 0 })).toBeUndefined()
    expect(normalizeDirection3(0, 0, 0, { x: 0, y: 0, z: 0 })).toBeUndefined()
  })
})
