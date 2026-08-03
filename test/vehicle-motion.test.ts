import { describe, expect, it } from '@effect/vitest'
import { OccupantId, VehicleId, type Vehicle } from '@nerima-games/mc-sim'
import {
  boardVehicle,
  COLLISION_EXIT_SPEED,
  exitVehicle,
  stepBoat,
  stepMinecart,
} from '../src/domain/vehicle/vehicle-motion'

const rider = OccupantId('player:one')
const vehicle = (type: Vehicle['type'], overrides: Partial<Vehicle> = {}): Vehicle => ({
  id: VehicleId(`${type}:one`),
  type,
  dimension: 'overworld',
  position: { x: 0, y: 64, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  yawRadians: 0,
  ...overrides,
})

describe('vehicle occupancy', () => {
  it('boards only an empty nearby vehicle and supports requested exit', () => {
    const boat = vehicle('boat')
    expect(boardVehicle(boat, rider, 2.01)).toBe(boat)
    const boarded = boardVehicle(boat, rider, 2)
    expect(boarded.occupant).toBe(rider)
    expect(boardVehicle(boarded, OccupantId('player:two'), 0)).toBe(boarded)
    expect(exitVehicle(boarded)).toStrictEqual({
      vehicle: boat,
      exited: { occupant: rider, reason: 'requested' },
    })
  })
})

describe('boat motion', () => {
  it('steers in radians and accelerates forward on water with water drag', () => {
    const result = stepBoat(
      vehicle('boat', { occupant: rider }),
      { throttle: 1, steering: 1, inWater: true },
      0.1,
    ).vehicle
    expect(result.yawRadians).toBeCloseTo(0.18)
    expect(result.velocity.x).toBeLessThan(0)
    expect(result.velocity.z).toBeLessThan(0)
  })

  it('ignores controls without a rider and applies stronger resistance out of water', () => {
    const moving = vehicle('boat', { velocity: { x: 4, y: 0, z: 0 } })
    const water = stepBoat(moving, { throttle: 1, steering: 1, inWater: true }, 0.1).vehicle
    const land = stepBoat(moving, { throttle: 1, steering: 1, inWater: false }, 0.1).vehicle
    expect(water.yawRadians).toBe(0)
    expect(Math.abs(land.velocity.x)).toBeLessThan(Math.abs(water.velocity.x))
  })
})

describe('minecart motion', () => {
  it('projects onto rails, climbs slopes, and suppresses lateral derailment', () => {
    const cart = vehicle('minecart', { velocity: { x: 3, y: 0, z: 4 } })
    const next = stepMinecart(cart, { kind: 'normal', shape: 'ew', ascendingAhead: true }, {}, 0.05).vehicle
    expect(next.velocity.z).toBe(0)
    expect(next.velocity.x).toBeGreaterThan(4.9)
    expect(next.velocity.y).toBe(2)
  })

  it('accelerates on an active powered rail, caps speed, and brakes when unpowered', () => {
    const cart = vehicle('minecart', { velocity: { x: 7.9, y: 0, z: 0 } })
    const powered = stepMinecart(cart, { kind: 'powered', shape: 'ew', powered: true }, {}, 0.1).vehicle
    expect(powered.velocity.x).toBe(8)
    const braking = stepMinecart(cart, { kind: 'powered', shape: 'ew', powered: false }, {}, 0.1).vehicle
    expect(braking.velocity.x).toBeCloseTo(1.58)
  })
})

describe('vehicle collision lifecycle', () => {
  it('ejects on a strong collision and stops/ejects when destroyed', () => {
    const occupied = vehicle('minecart', { occupant: rider, velocity: { x: 7, y: 1, z: 0 } })
    const collision = stepMinecart(
      occupied,
      { kind: 'none', shape: 'isolated' },
      { collided: true, impactSpeed: COLLISION_EXIT_SPEED },
      0.05,
    )
    expect(collision.exited).toStrictEqual({ occupant: rider, reason: 'collision' })
    expect(collision.vehicle.occupant).toBeUndefined()

    const destroyed = stepBoat(vehicle('boat', {
      occupant: rider,
      velocity: { x: 7, y: 1, z: 0 },
    }), {
      throttle: 0,
      steering: 0,
      inWater: true,
      destroyed: true,
    }, 0.05)
    expect(destroyed.exited).toStrictEqual({ occupant: rider, reason: 'destroyed' })
    expect(destroyed.vehicle.velocity).toStrictEqual({ x: 0, y: 0, z: 0 })
  })
})
