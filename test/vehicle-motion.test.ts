import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import * as FastCheck from 'fast-check'
import { OccupantId, VehicleId, type Vehicle } from '@nerima-games/mc-sim'
import { AngleRadians, PositionAxis, VehicleVelocityComponent } from '@nerima-games/mc-kernel'
import {
  boardVehicle,
  COLLISION_EXIT_SPEED,
  exitVehicle,
  MINECART_POWERED_ACCELERATION,
  stepBoat,
  stepMinecart,
  type BoatControl,
  type VehicleCollision,
  type VehicleTransition,
} from '../src/domain/vehicle/vehicle-motion'

const rider = OccupantId('player:one')
const transitionOrThrow = <E>(result: Result.Result<VehicleTransition, E>): VehicleTransition =>
  Result.getOrThrow(result)

type VehicleFixtureOverrides = Omit<
  Partial<Vehicle>,
  'id' | 'type' | 'dimension' | 'position' | 'velocity' | 'yawRadians'
> & {
  position?: Readonly<{ x: number; y: number; z: number }>
  velocity?: Readonly<{ x: number; y: number; z: number }>
  yawRadians?: number
}

const vehicle = (type: Vehicle['type'], overrides: VehicleFixtureOverrides = {}): Vehicle => {
  const {
    position: fixturePosition,
    velocity: fixtureVelocity,
    yawRadians,
    ...vehicleOverrides
  } = overrides
  return {
    id: VehicleId(`${type}:one`),
    type,
    dimension: 'overworld',
    position: {
      x: PositionAxis(fixturePosition?.x ?? 0),
      y: PositionAxis(fixturePosition?.y ?? 64),
      z: PositionAxis(fixturePosition?.z ?? 0),
    },
    velocity: {
      x: VehicleVelocityComponent(fixtureVelocity?.x ?? 0),
      y: VehicleVelocityComponent(fixtureVelocity?.y ?? 0),
      z: VehicleVelocityComponent(fixtureVelocity?.z ?? 0),
    },
    yawRadians: AngleRadians(yawRadians ?? 0),
    ...vehicleOverrides,
  }
}

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

  it('exiting an unoccupied vehicle is a no-op', () => {
    const empty = vehicle('boat')
    expect(exitVehicle(empty)).toStrictEqual({ vehicle: empty })
  })
})

describe('boat motion', () => {
  it('steers in radians and accelerates forward on water with water drag', () => {
    const result = transitionOrThrow(stepBoat(
      vehicle('boat', { occupant: rider }),
      { throttle: 1, steering: 1, inWater: true },
      0.1,
    )).vehicle
    expect(result.yawRadians).toBeCloseTo(0.18)
    expect(result.velocity.x).toBeLessThan(0)
    expect(result.velocity.z).toBeLessThan(0)
  })

  it('ignores controls without a rider and applies stronger resistance out of water', () => {
    const moving = vehicle('boat', { velocity: { x: 4, y: 0, z: 0 } })
    const water = transitionOrThrow(stepBoat(moving, { throttle: 1, steering: 1, inWater: true }, 0.1)).vehicle
    const land = transitionOrThrow(stepBoat(moving, { throttle: 1, steering: 1, inWater: false }, 0.1)).vehicle
    expect(water.yawRadians).toBe(0)
    expect(Math.abs(land.velocity.x)).toBeLessThan(Math.abs(water.velocity.x))
  })

  it('treats a non-finite delta time as zero elapsed time rather than throwing or freezing', () => {
    const boat = vehicle('boat', { occupant: rider, velocity: { x: 1, y: 0, z: 0 } })
    const result = transitionOrThrow(stepBoat(boat, { throttle: 1, steering: 1, inWater: true }, Number.NaN)).vehicle
    expect(result.yawRadians).toBe(0)
    expect(result.velocity.x).toBeCloseTo(1)
    expect(result.velocity.z).toBeCloseTo(0)
  })

  it('is a no-op for a non-boat vehicle', () => {
    const cart = vehicle('minecart')
    expect(transitionOrThrow(stepBoat(cart, { throttle: 1, steering: 1, inWater: true }, 0.1))).toStrictEqual({ vehicle: cart })
  })
})

describe('minecart motion', () => {
  it('projects onto rails, climbs slopes, and suppresses lateral derailment', () => {
    const cart = vehicle('minecart', { velocity: { x: 3, y: 0, z: 4 } })
    const next = transitionOrThrow(stepMinecart(cart, { kind: 'normal', shape: 'ew', ascendingAhead: true }, {}, 0.05)).vehicle
    expect(next.velocity.z).toBe(0)
    expect(next.velocity.x).toBeGreaterThan(4.9)
    expect(next.velocity.y).toBe(2)
  })

  it('accelerates on an active powered rail, caps speed, and brakes when unpowered', () => {
    const cart = vehicle('minecart', { velocity: { x: 7.9, y: 0, z: 0 } })
    const powered = transitionOrThrow(stepMinecart(cart, { kind: 'powered', shape: 'ew', powered: true }, {}, 0.1)).vehicle
    expect(powered.velocity.x).toBe(8)
    const braking = transitionOrThrow(stepMinecart(cart, { kind: 'powered', shape: 'ew', powered: false }, {}, 0.1)).vehicle
    expect(braking.velocity.x).toBeCloseTo(1.58)
  })

  it('keeps a powered minecart unit speed when its direction is subnormal', () => {
    const tiny = Number.MIN_VALUE
    const cart = vehicle('minecart', { velocity: { x: tiny, y: 0, z: tiny } })
    const result = transitionOrThrow(stepMinecart(cart, { kind: 'powered', shape: 'isolated', powered: true }, {}, 0.1)).vehicle

    // Math.hypot rounds this subnormal pair to Number.MIN_VALUE, so dividing
    // each component by it yields (1, 1) and boosts the powered speed by √2.
    expect(Math.hypot(result.velocity.x, result.velocity.z)).toBeCloseTo(
      MINECART_POWERED_ACCELERATION * 0.1,
      12,
    )
  })

  it('a stationary cart on a freshly powered rail accelerates along the way it is facing', () => {
    const stationary = vehicle('minecart', { velocity: { x: 0, y: 0, z: 0 }, yawRadians: 0 })
    const result = transitionOrThrow(stepMinecart(stationary, { kind: 'powered', shape: 'ew', powered: true }, {}, 0.1)).vehicle
    // currentSpeed is 0, so direction comes from facing (yaw 0 faces -z) rather
    // than from normalising the (zero) velocity vector.
    expect(result.velocity.x).toBeCloseTo(0)
    expect(result.velocity.z).toBeCloseTo(-0.5)
  })

  it('is a no-op for a non-minecart vehicle', () => {
    const boat = vehicle('boat')
    expect(transitionOrThrow(stepMinecart(boat, { kind: 'none', shape: 'isolated' }, {}, 0.1))).toStrictEqual({ vehicle: boat })
  })
})

describe('vehicle collision lifecycle', () => {
  it('ejects on a strong collision and stops/ejects when destroyed', () => {
    const occupied = vehicle('minecart', { occupant: rider, velocity: { x: 7, y: 1, z: 0 } })
    const collision = transitionOrThrow(stepMinecart(
      occupied,
      { kind: 'none', shape: 'isolated' },
      { collided: true, impactSpeed: COLLISION_EXIT_SPEED },
      0.05,
    ))
    expect(collision.exited).toStrictEqual({ occupant: rider, reason: 'collision' })
    expect(collision.vehicle.occupant).toBeUndefined()

    const destroyed = transitionOrThrow(stepBoat(vehicle('boat', {
      occupant: rider,
      velocity: { x: 7, y: 1, z: 0 },
    }), {
      throttle: 0,
      steering: 0,
      inWater: true,
      destroyed: true,
    }, 0.05))
    expect(destroyed.exited).toStrictEqual({ occupant: rider, reason: 'destroyed' })
    expect(destroyed.vehicle.velocity).toStrictEqual({ x: 0, y: 0, z: 0 })
  })

  it('stops a destroyed vehicle with no occupant to eject', () => {
    const empty = vehicle('boat', { velocity: { x: 5, y: 2, z: 0 } })
    const result = transitionOrThrow(stepBoat(empty, { throttle: 0, steering: 0, inWater: true, destroyed: true }, 0.05))
    expect(result.exited).toBeUndefined()
    expect(result.vehicle.velocity).toStrictEqual({ x: 0, y: 0, z: 0 })
    expect(result.vehicle.occupant).toBeUndefined()
  })

  it('uses the vehicle\'s derived speed when impactSpeed is omitted, and does not eject below the exit threshold', () => {
    const slow = vehicle('minecart', { occupant: rider, velocity: { x: 1, y: 0, z: 0 } })
    const result = transitionOrThrow(stepMinecart(slow, { kind: 'none', shape: 'isolated' }, { collided: true }, 0.05))
    expect(result.exited).toBeUndefined()
    expect(result.vehicle.occupant).toBe(rider)
    // speed(vehicle) = hypot(1, 0, 0) = 1, well under COLLISION_EXIT_SPEED, so
    // the occupant stays and only the usual collision drag applies.
    expect(result.vehicle.velocity.x).toBeCloseTo(0.2)
  })

  it('rejects an explicitly undefined or non-finite impact speed', () => {
    const cart = vehicle('minecart', { occupant: rider })
    const track = { kind: 'none' as const, shape: 'isolated' as const }
    const explicitUndefined = { collided: true, impactSpeed: undefined } as VehicleCollision
    const destroyedWithUndefinedSpeed = { destroyed: true, impactSpeed: undefined } as VehicleCollision

    expect(stepMinecart(cart, track, explicitUndefined, 0.05)).toStrictEqual(Result.fail({
      _tag: 'InvalidImpactSpeed',
    }))
    expect(stepMinecart(cart, track, destroyedWithUndefinedSpeed, 0.05)).toStrictEqual(Result.fail({
      _tag: 'InvalidImpactSpeed',
    }))
    expect(stepMinecart(cart, track, { collided: true, impactSpeed: Number.NaN }, 0.05)).toStrictEqual(Result.fail({
      _tag: 'InvalidImpactSpeed',
    }))
    expect(stepMinecart(cart, track, { collided: true, impactSpeed: Number.POSITIVE_INFINITY }, 0.05)).toStrictEqual(Result.fail({
      _tag: 'InvalidImpactSpeed',
    }))
    expect(stepBoat(vehicle('boat'), {
      destroyed: true,
      impactSpeed: Number.NaN,
      throttle: 0,
      steering: 0,
      inWater: true,
    }, 0.05)).toStrictEqual(Result.fail({ _tag: 'InvalidImpactSpeed' }))
  })

  it('propagates invalid minecart velocity as a typed motion failure even without a rail', () => {
    const base = vehicle('minecart')
    const cart = {
      ...base,
      velocity: { ...base.velocity, x: Number.NaN },
    } as unknown as Vehicle
    expect(stepMinecart(cart, { kind: 'none', shape: 'isolated' }, {}, 0.05)).toStrictEqual(Result.fail({
      _tag: 'InvalidMinecartVelocityInput',
      field: 'vx',
    }))
  })

  it('returns a typed result across the full impact-speed input domain', () => {
    const cart = vehicle('minecart', { occupant: rider })
    const boat = vehicle('boat', { occupant: rider })
    const track = { kind: 'none' as const, shape: 'isolated' as const }
    const impactSpeed = FastCheck.oneof(FastCheck.double(), FastCheck.constant(undefined))

    FastCheck.assert(
      FastCheck.property(impactSpeed, (value) => {
        const expectedFailure = value === undefined || !Number.isFinite(value)
        const collision = { collided: true, impactSpeed: value } as VehicleCollision
        const cartResult = stepMinecart(cart, track, collision, 0.05)
        const boatResult = stepBoat(boat, {
          collided: true,
          impactSpeed: value,
          throttle: 0,
          steering: 0,
          inWater: true,
        } as BoatControl, 0.05)
        return expectedFailure
          ? Result.isFailure(cartResult) && cartResult.failure._tag === 'InvalidImpactSpeed' &&
            Result.isFailure(boatResult) && boatResult.failure._tag === 'InvalidImpactSpeed'
          : Result.isSuccess(cartResult) && Result.isSuccess(boatResult)
      }),
      { numRuns: 100, seed: 70401 },
    )
  })
})
