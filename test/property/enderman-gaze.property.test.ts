import { describe, expect, it } from '@effect/vitest'
import { PositionAxis, position, type Position } from '@nerima-games/mc-kernel'
import fc from 'fast-check'
import { ENDERMAN_DIMENSIONS, PLAYER_DIMENSIONS } from '../../src/domain/entities/entity-dimensions.js'
import { isLookingAtEnderman } from '../../src/domain/mob/enderman-gaze.js'

const feet = (x: number, y: number, z: number): Position =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))
const coordinate = fc.double({ min: -30_000_000, max: 30_000_000, noNaN: true, noDefaultInfinity: true })
const anchor = fc.tuple(coordinate, coordinate, coordinate).map(([x, y, z]) => feet(x, y, z))
const yaw = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true })
const pitch = fc.double({ min: -Math.PI / 2, max: Math.PI / 2, noNaN: true, noDefaultInfinity: true })
const eyeOffset = ENDERMAN_DIMENSIONS.eyeHeight - PLAYER_DIMENSIONS.eyeHeight

const aim = (player: Position, mob: Position) => ({
  yaw: Math.atan2(player.x - mob.x, mob.z - player.z),
  pitch: -Math.atan2(mob.y - player.y + eyeOffset, Math.hypot(mob.x - player.x, mob.z - player.z)),
})

const scene = fc.record({
  player: anchor,
  distance: fc.double({ min: 1, max: 60, noNaN: true, noDefaultInfinity: true }),
  bearing: yaw,
  elevation: pitch,
  away: fc.boolean(),
}).map(({ player, distance, bearing, elevation, away }) => {
  const mob = feet(
    player.x - Math.sin(bearing) * Math.cos(elevation) * distance,
    player.y - Math.sin(elevation) * distance,
    player.z + Math.cos(bearing) * Math.cos(elevation) * distance,
  )
  const view = aim(player, mob)
  return { player, mob, yaw: view.yaw + (away ? Math.PI : 0), pitch: away ? -view.pitch : view.pitch, away }
})

describe('enderman gaze properties', () => {
  it('distinguishes both sides of the 64-block sphere at fractional coordinates in arbitrary directions', () => {
    fc.assert(fc.property(anchor, yaw, pitch, (player, bearing, elevation) => {
      // The offset exceeds accumulated coordinate rounding; the exact boundary is covered separately.
      const margin = 128 * Number.EPSILON * Math.max(64, Math.abs(player.x), Math.abs(player.y), Math.abs(player.z))
      for (const [distance, expected] of [[64 - margin, true], [64 + margin, false]] as const) {
        const mob = feet(
          player.x - Math.sin(bearing) * Math.cos(elevation) * distance,
          player.y - Math.sin(elevation) * distance,
          player.z + Math.cos(bearing) * Math.cos(elevation) * distance,
        )
        const view = aim(player, mob)
        expect(isLookingAtEnderman(player, view.yaw, view.pitch, mob)).toBe(expected)
      }
    }))
  })

  it('distinguishes the inside and outside of the gaze cone across eye distances and bearings', () => {
    // Keep the angular case inside the feet-range sphere after floating-point construction.
    // At d = 1/80 the cone reaches pi; that exact endpoint is covered by a fixed test.
    const eyeDistance = fc.double({
      min: 1 / 80 + 128 * Number.EPSILON,
      max: Math.sqrt(64 * 64 - eyeOffset * eyeOffset) - 1024 * Number.EPSILON * 64,
      noNaN: true,
      noDefaultInfinity: true,
    })
    fc.assert(fc.property(eyeDistance, yaw, (distance, bearing) => {
      const player = feet(0, 0, 0)
      const mob = feet(-Math.sin(bearing) * distance, -eyeOffset, Math.cos(bearing) * distance)
      // The specification gives cos(halfAngle) = 1 - 1/(40*d); expected sides are fixed booleans.
      const halfAngle = Math.acos(1 - 1 / (40 * distance))
      const margin = 1e-7 + 64 * Number.EPSILON * 64 / distance
      const inside = Math.max(0, halfAngle - margin)
      const outside = Math.min(Math.PI, halfAngle + margin)
      expect(isLookingAtEnderman(player, bearing + inside, 0, mob)).toBe(true)
      expect(isLookingAtEnderman(player, bearing + outside, 0, mob)).toBe(false)
    }))
  })

  it('accepts every viewing direction when the nonzero eye distance makes the cone cover the sphere', () => {
    const eyeDistance = fc.double({ min: Number.MIN_VALUE, max: 1 / 80 - 128 * Number.EPSILON,
      noNaN: true, noDefaultInfinity: true })
    fc.assert(fc.property(eyeDistance, yaw, pitch, (distance, bearing, elevation) => {
      expect(isLookingAtEnderman(feet(0, 0, 0), bearing, elevation, feet(0, -eyeOffset, distance))).toBe(true)
    }))
  })

  it('preserves looking toward or away from the head under fractional three-dimensional translations', () => {
    fc.assert(fc.property(scene, anchor, (original, shift) => {
      const player = feet(original.player.x + shift.x, original.player.y + shift.y, original.player.z + shift.z)
      const mob = feet(original.mob.x + shift.x, original.mob.y + shift.y, original.mob.z + shift.z)
      // These views point at the cone center or its antipode, away from rounding-sensitive angular boundaries.
      expect(isLookingAtEnderman(original.player, original.yaw, original.pitch, original.mob)).toBe(!original.away)
      expect(isLookingAtEnderman(player, original.yaw, original.pitch, mob)).toBe(!original.away)
    }))
  })

  it('preserves looking toward or away from the head under arbitrary horizontal rotations', () => {
    fc.assert(fc.property(scene, yaw, (original, rotation) => {
      const rotate = (point: Position) => feet(
        Math.cos(rotation) * point.x - Math.sin(rotation) * point.z,
        point.y,
        Math.sin(rotation) * point.x + Math.cos(rotation) * point.z,
      )
      expect(isLookingAtEnderman(original.player, original.yaw, original.pitch, original.mob)).toBe(!original.away)
      expect(isLookingAtEnderman(rotate(original.player), original.yaw + rotation, original.pitch, rotate(original.mob)))
        .toBe(!original.away)
    }))
  })
})
