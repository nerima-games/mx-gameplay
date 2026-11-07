import { OccupantId, VehicleId, type Vehicle } from '@nerima-games/mc-sim'
import { AngleRadians, PositionAxis, VehicleVelocityComponent } from '@nerima-games/mc-kernel'
import * as FastCheck from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BOARDING_MAX_DISTANCE, boardVehicle, exitVehicle } from '../../src/domain/vehicle/vehicle-motion'
import { isAscendingAhead } from '../../src/domain/vehicle/rail-ascent'
import {
  projectMinecartVelocity,
  resolveRailShape,
  type RailShape,
} from '../../src/domain/vehicle/rail-shape'

const RAIL_SHAPES: ReadonlyArray<RailShape> = [
  'ns',
  'ew',
  'curve_north_east',
  'curve_north_west',
  'curve_south_east',
  'curve_south_west',
  'curve',
  'isolated',
]

type OrientedRailCurve =
  | 'curve_north_east'
  | 'curve_north_west'
  | 'curve_south_east'
  | 'curve_south_west'

const CURVE_LEG_SIGNS: Readonly<Record<OrientedRailCurve, { x: -1 | 1; z: -1 | 1 }>> = {
  curve_north_east: { x: 1, z: -1 },
  curve_north_west: { x: -1, z: -1 },
  curve_south_east: { x: 1, z: 1 },
  curve_south_west: { x: -1, z: 1 },
}

const NEIGHBOURS = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
] as const

const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

const railsAt = (
  mask: number,
  verticalOffsets: readonly [number, number, number, number],
) => {
  const cells = new Set<string>()
  NEIGHBOURS.forEach(([dx, dz], index) => {
    if (Math.floor(mask / 2 ** index) % 2 === 1) {
      cells.add(cellKey(dx, 60 + verticalOffsets[index]!, dz))
    }
  })
  return (x: number, y: number, z: number): boolean => cells.has(cellKey(x, y, z))
}

const emptyMinecart = (): Vehicle => ({
  id: VehicleId('property-minecart'),
  type: 'minecart',
  dimension: 'overworld',
  position: { x: PositionAxis(0), y: PositionAxis(60), z: PositionAxis(0) },
  velocity: {
    x: VehicleVelocityComponent(0),
    y: VehicleVelocityComponent(0),
    z: VehicleVelocityComponent(0),
  },
  yawRadians: AngleRadians(0),
})

describe('vehicle and rail properties', () => {
  // If ±1-block neighbor tolerance regresses, changing the four rail heights changes the resolved shape.
  it('keeps each neighbor layout shape when rails vary within the vertical tolerance', () => {
    const offsets = FastCheck.tuple(
      FastCheck.integer({ min: -1, max: 1 }),
      FastCheck.integer({ min: -1, max: 1 }),
      FastCheck.integer({ min: -1, max: 1 }),
      FastCheck.integer({ min: -1, max: 1 }),
    )

    for (let mask = 0; mask < 16; mask += 1) {
      const expected = resolveRailShape(railsAt(mask, [0, 0, 0, 0]), 0, 60, 0)
      FastCheck.assert(
        FastCheck.property(offsets, (verticalOffsets) => {
          expect(resolveRailShape(railsAt(mask, verticalOffsets), 0, 60, 0)).toBe(expected)
        }),
      )
    }
  })

  // If heading magnitude affects the probe or reverse travel misses its higher rail, this property fails.
  it('finds one-block ascents in both directions regardless of positive heading scale', () => {
    const headingAndScale = FastCheck.tuple(
      FastCheck.constantFrom<'x' | 'z'>('x', 'z'),
      FastCheck.integer({ min: 21, max: 100 }),
      FastCheck.integer({ min: -20, max: 20 }),
      FastCheck.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
    )

    FastCheck.assert(
      FastCheck.property(headingAndScale, ([axis, magnitude, minor, scale]) => {
        const positiveHeading: readonly [number, number] =
          axis === 'x' ? [magnitude, minor] : [minor, magnitude]

        for (const sign of [1, -1] as const) {
          const headingX = positiveHeading[0] * sign
          const headingZ = positiveHeading[1] * sign
          const higherRail = axis === 'x' ? [sign, 61, 0] : [0, 61, sign]
          const higherRailKey = cellKey(higherRail[0]!, higherRail[1]!, higherRail[2]!)
          const isRailAt = (x: number, y: number, z: number): boolean =>
            cellKey(x, y, z) === higherRailKey
          const ascending = isAscendingAhead(isRailAt, 0, 60, 0, headingX, headingZ)

          expect(ascending).toBe(true)
          expect(isAscendingAhead(isRailAt, 0, 60, 0, headingX * scale, headingZ * scale)).toBe(ascending)
        }
      }),
    )
  })

  // If projection loses speed, points off a rail, or flips on a repeated curve tick, this fails.
  it('preserves projected speed and direction on a repeated projection for every RailShape', () => {
    const signedNonZeroVelocity = FastCheck.oneof(
      FastCheck.integer({ min: -100, max: -1 }),
      FastCheck.integer({ min: 1, max: 100 }),
    )
    const velocity = FastCheck.tuple(signedNonZeroVelocity, signedNonZeroVelocity)

    for (const shape of RAIL_SHAPES) {
      FastCheck.assert(
        FastCheck.property(velocity, ([vx, vz]) => {
          const once = projectMinecartVelocity(shape, vx, vz)
          const twice = projectMinecartVelocity(shape, once.vx, once.vz)
          const towardX = Math.abs(vx) >= Math.abs(vz)

          expect(Math.hypot(once.vx, once.vz)).toBeCloseTo(Math.hypot(vx, vz), 12)
          expect(twice).toStrictEqual(once)

          if (shape === 'ns') {
            expect(once.vx).toBe(0)
            expect(Math.sign(once.vz)).toBe(Math.sign(vz))
          } else if (shape === 'ew') {
            expect(once.vz).toBe(0)
            expect(Math.sign(once.vx)).toBe(Math.sign(vx))
          } else if (shape === 'curve') {
            if (towardX) {
              expect(once.vz).toBe(0)
              expect(Math.sign(once.vx)).toBe(Math.sign(vx))
            } else {
              expect(once.vx).toBe(0)
              expect(Math.sign(once.vz)).toBe(Math.sign(vz))
            }
          } else if (shape === 'isolated') {
            expect(once).toStrictEqual({ vx, vz })
          } else {
            const curveSigns = CURVE_LEG_SIGNS[shape]
            if (towardX) {
              expect(once.vx).toBe(0)
              expect(Math.sign(once.vz)).toBe(curveSigns.z)
            } else {
              expect(once.vz).toBe(0)
              expect(Math.sign(once.vx)).toBe(curveSigns.x)
            }
          }
        }),
      )
    }
  })

  // If boarding drops the rider or requested exit leaves one attached, the round trip fails.
  it('round-trips a nearby rider through boarding and requested exit', () => {
    const distance = FastCheck.integer({ min: 0, max: BOARDING_MAX_DISTANCE * 1000 }).map(
      (milliBlocks) => milliBlocks / 1000,
    )

    FastCheck.assert(
      FastCheck.property(distance, FastCheck.integer({ min: 0, max: 1_000_000 }), (boardingDistance, riderNumber) => {
        const cart = emptyMinecart()
        const rider = OccupantId(`property-rider:${String(riderNumber)}`)
        const boarded = boardVehicle(cart, rider, boardingDistance)

        expect(boarded.occupant).toBe(rider)
        expect(exitVehicle(boarded)).toStrictEqual({
          vehicle: cart,
          exited: { occupant: rider, reason: 'requested' },
        })
      }),
    )
  })
})
