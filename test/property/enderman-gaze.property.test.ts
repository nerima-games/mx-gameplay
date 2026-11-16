import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import fc from 'fast-check'
import { isLookingAtEnderman } from '../../src/domain/mob/enderman-gaze'

const feet = (x: number, y: number, z: number) => ({ x, y, z })

const numericPosition = fc.record({ x: fc.double(), y: fc.double(), z: fc.double() })
const finiteAngle = fc.double({ noNaN: true, noDefaultInfinity: true })
const nonFinite = fc.constantFrom(Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
const blockOffset = fc.integer({ min: -64, max: 64 })
const blockCoordinate = fc.integer({ min: -30_000_000, max: 30_000_000 })
const yaw = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true })
const pitch = fc.double({ min: -Math.PI / 2, max: Math.PI / 2, noNaN: true, noDefaultInfinity: true })

describe('enderman gaze properties', () => {
  it('returns a boolean result or a typed failure for unrestricted numeric inputs', () => {
    fc.assert(
      fc.property(numericPosition, fc.double(), fc.double(), numericPosition, (player, yawValue, pitchValue, mob) => {
        const result = isLookingAtEnderman(
          feet(player.x, player.y, player.z),
          yawValue,
          pitchValue,
          feet(mob.x, mob.y, mob.z),
        )

        if (Result.isFailure(result)) expect(result.failure).toBe('invalid-gaze-input')
        else expect(typeof result.success).toBe('boolean')
      }),
    )
  })

  it('rejects nonfinite angles and coordinates on either entity', () => {
    fc.assert(
      fc.property(nonFinite, fc.constantFrom('x', 'y', 'z'), fc.boolean(), (invalid, axis, invalidPlayer) => {
        const player = feet(0, 64, 0)
        const mob = feet(0, 64, 8)
        const invalidPosition = { ...(invalidPlayer ? player : mob), [axis]: invalid }

        expect(isLookingAtEnderman(player, invalid, 0, mob)).toEqual(Result.fail('invalid-gaze-input'))
        expect(isLookingAtEnderman(player, 0, invalid, mob)).toEqual(Result.fail('invalid-gaze-input'))
        expect(isLookingAtEnderman(
          invalidPlayer ? invalidPosition : player,
          0,
          0,
          invalidPlayer ? mob : invalidPosition,
        )).toEqual(Result.fail('invalid-gaze-input'))
      }),
    )
  })

  it('sees a head directly ahead but not after turning sideways or backwards', () => {
    fc.assert(
      fc.property(blockCoordinate, blockCoordinate, fc.integer({ min: 1, max: 64 }), (x, z, distance) => {
        const player = feet(x, 64, z)
        const mob = feet(x, 64, z + distance)
        const upwardPitch = -Math.atan2(0.93, distance)

        expect(isLookingAtEnderman(player, 0, upwardPitch, mob)).toEqual(Result.succeed(true))
        expect(isLookingAtEnderman(player, Math.PI / 2, upwardPitch, mob)).toEqual(Result.succeed(false))
        expect(isLookingAtEnderman(player, Math.PI, upwardPitch, mob)).toEqual(Result.succeed(false))
      }),
    )
  })

  it('never acquires an enderman beyond the maximum distance in any direction', () => {
    const outsideRange = fc.double({ min: 64.000_000_000_000_01, noNaN: true, noDefaultInfinity: true })
    fc.assert(
      fc.property(outsideRange, finiteAngle, finiteAngle, (distance, yawValue, pitchValue) => {
        expect(isLookingAtEnderman(feet(0, 0, 0), yawValue, pitchValue, feet(distance, 0, 0)))
          .toEqual(Result.succeed(false))
      }),
    )
  })

  it('preserves the decision under horizontal translations', () => {
    fc.assert(
      fc.property(blockOffset, blockOffset, blockOffset, blockCoordinate, blockCoordinate, yaw, pitch,
        (x, y, z, shiftX, shiftZ, yawValue, pitchValue) => {
          const original = isLookingAtEnderman(feet(0, 0, 0), yawValue, pitchValue, feet(x, y, z))
          const translated = isLookingAtEnderman(
            feet(shiftX, 0, shiftZ),
            yawValue,
            pitchValue,
            feet(x + shiftX, y, z + shiftZ),
          )

          expect(translated).toEqual(original)
        }),
    )
  })

  it('preserves the decision when the scene and view rotate a quarter turn', () => {
    fc.assert(
      fc.property(blockOffset, blockOffset, blockOffset, yaw, pitch, (x, y, z, yawValue, pitchValue) => {
        const original = isLookingAtEnderman(feet(0, 0, 0), yawValue, pitchValue, feet(x, y, z))
        const rotated = isLookingAtEnderman(feet(0, 0, 0), yawValue + Math.PI / 2, pitchValue, feet(-z, y, x))

        expect(rotated).toEqual(original)
      }),
    )
  })
})
