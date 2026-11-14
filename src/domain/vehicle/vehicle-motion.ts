import type { OccupantId, Vehicle } from '@nerima-games/mc-sim'
import { AngleRadians, VehicleVelocityComponent } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import { directionComponent, normalizeDirection2 } from '../math/direction.js'
import {
  projectMinecartVelocity,
  type RailShape,
  type RailShapeFailure,
} from './rail-shape.js'

export type VehicleExitReason = 'requested' | 'collision' | 'destroyed'

export type VehicleTransition = Readonly<{
  vehicle: Vehicle
  exited?: Readonly<{ occupant: OccupantId; reason: VehicleExitReason }>
}>

export type VehicleMotionFailure =
  | Readonly<{ _tag: 'InvalidImpactSpeed' }>
  | RailShapeFailure

export type VehicleCollision = Readonly<{
  collided?: boolean
  impactSpeed?: number
  destroyed?: boolean
}>

export type BoatControl = VehicleCollision & Readonly<{
  throttle: number
  steering: number
  inWater: boolean
}>

export type MinecartTrack = Readonly<{
  kind: 'none' | 'normal' | 'powered'
  shape: RailShape
  ascendingAhead?: boolean
  powered?: boolean
}>

export const BOARDING_MAX_DISTANCE = 2
export const BOAT_ACCELERATION = 4
export const BOAT_TURN_RATE = 1.8
export const MINECART_POWERED_ACCELERATION = 5
export const MINECART_MAX_SPEED = 8
export const MINECART_CLIMB_SPEED = 2
export const COLLISION_EXIT_SPEED = 6

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0))

const safeDt = (dt: number): number => clamp(dt, 0, 0.1)

const speed = (vehicle: Vehicle): number =>
  Math.hypot(vehicle.velocity.x, vehicle.velocity.y, vehicle.velocity.z)

const vehicleVelocity = (x: number, y: number, z: number): Vehicle['velocity'] => ({
  x: VehicleVelocityComponent(x),
  y: VehicleVelocityComponent(y),
  z: VehicleVelocityComponent(z),
})

const withoutOccupant = (vehicle: Vehicle): Vehicle => {
  const { occupant, ...unoccupied } = vehicle
  void occupant
  return unoccupied
}

const applyCollision = (
  vehicle: Vehicle,
  collision: VehicleCollision,
): Result.Result<VehicleTransition, VehicleMotionFailure> => {
  const hasImpactSpeed = Object.hasOwn(collision, 'impactSpeed')
  if (hasImpactSpeed && (collision.impactSpeed === undefined || !Number.isFinite(collision.impactSpeed))) {
    return Result.fail({ _tag: 'InvalidImpactSpeed' })
  }

  const occupant = vehicle.occupant
  if (collision.destroyed) {
    const stopped = withoutOccupant({ ...vehicle, velocity: vehicleVelocity(0, 0, 0) })
    return occupant === undefined
      ? Result.succeed({ vehicle: stopped })
      : Result.succeed({ vehicle: stopped, exited: { occupant, reason: 'destroyed' } })
  }
  if (!collision.collided) return Result.succeed({ vehicle })

  const impactSpeed = hasImpactSpeed ? collision.impactSpeed : speed(vehicle)
  if (impactSpeed === undefined || !Number.isFinite(impactSpeed)) {
    return Result.fail({ _tag: 'InvalidImpactSpeed' })
  }
  const resolvedImpactSpeed = Math.max(0, impactSpeed)
  const collided: Vehicle = {
    ...vehicle,
    velocity: vehicleVelocity(
      vehicle.velocity.x * 0.2,
      Math.min(0, vehicle.velocity.y),
      vehicle.velocity.z * 0.2,
    ),
  }
  return occupant !== undefined && resolvedImpactSpeed >= COLLISION_EXIT_SPEED
    ? Result.succeed({ vehicle: withoutOccupant(collided), exited: { occupant, reason: 'collision' } })
    : Result.succeed({ vehicle: collided })
}

export const boardVehicle = (
  vehicle: Vehicle,
  occupant: OccupantId,
  distance: number,
): Vehicle =>
  vehicle.occupant === undefined && Number.isFinite(distance) && distance >= 0 && distance <= BOARDING_MAX_DISTANCE
    ? { ...vehicle, occupant }
    : vehicle

export const exitVehicle = (vehicle: Vehicle): VehicleTransition => {
  if (vehicle.occupant === undefined) return { vehicle }
  const occupant = vehicle.occupant
  return { vehicle: withoutOccupant(vehicle), exited: { occupant, reason: 'requested' } }
}

export const stepBoat = (
  vehicle: Vehicle,
  control: BoatControl,
  dt: number,
): Result.Result<VehicleTransition, VehicleMotionFailure> => {
  if (vehicle.type !== 'boat') return Result.succeed({ vehicle })
  const elapsed = safeDt(dt)
  const steering = vehicle.occupant === undefined ? 0 : clamp(control.steering, -1, 1)
  const throttle = vehicle.occupant === undefined ? 0 : clamp(control.throttle, -1, 1)
  const yawRadians = AngleRadians(vehicle.yawRadians + steering * BOAT_TURN_RATE * elapsed)
  const acceleration = control.inWater ? BOAT_ACCELERATION : BOAT_ACCELERATION * 0.15
  const drag = Math.pow(control.inWater ? 0.9 : 0.55, elapsed * 20)
  const vx = (vehicle.velocity.x - Math.sin(yawRadians) * throttle * acceleration * elapsed) * drag
  const vz = (vehicle.velocity.z - Math.cos(yawRadians) * throttle * acceleration * elapsed) * drag
  const next: Vehicle = {
    ...vehicle,
    yawRadians,
    velocity: vehicleVelocity(vx, control.inWater ? vehicle.velocity.y * drag : vehicle.velocity.y, vz),
  }
  return applyCollision(next, control)
}

export const stepMinecart = (
  vehicle: Vehicle,
  track: MinecartTrack,
  collision: VehicleCollision,
  dt: number,
): Result.Result<VehicleTransition, VehicleMotionFailure> => {
  if (vehicle.type !== 'minecart') return Result.succeed({ vehicle })
  const elapsed = safeDt(dt)
  const projected = projectMinecartVelocity(
    track.kind === 'none' ? 'isolated' : track.shape,
    vehicle.velocity.x,
    vehicle.velocity.z,
  )
  if (Result.isFailure(projected)) return Result.fail(projected.failure)
  let { vx, vz } = projected.success
  const velocity = {
    x: VehicleVelocityComponent(vx),
    y: VehicleVelocityComponent(vehicle.velocity.y),
    z: VehicleVelocityComponent(vz),
  }

  if (track.kind === 'powered') {
    const currentSpeed = Math.hypot(vx, vz)
    if (track.powered) {
      let directionX = -Math.sin(vehicle.yawRadians)
      let directionZ = -Math.cos(vehicle.yawRadians)
      if (currentSpeed > 0) {
        const unitVelocity = { x: directionComponent(0), z: directionComponent(0) }
        normalizeDirection2(directionComponent(vx), directionComponent(vz), unitVelocity)
        directionX = unitVelocity.x
        directionZ = unitVelocity.z
      }
      const nextSpeed = Math.min(MINECART_MAX_SPEED, currentSpeed + MINECART_POWERED_ACCELERATION * elapsed)
      vx = directionX * nextSpeed
      vz = directionZ * nextSpeed
    } else {
      const braking = Math.max(0, 1 - 8 * elapsed)
      vx *= braking
      vz *= braking
    }
  } else if (track.kind === 'normal') {
    const drag = Math.pow(0.995, elapsed * 20)
    vx *= drag
    vz *= drag
  }

  velocity.x = VehicleVelocityComponent(vx)
  velocity.y = VehicleVelocityComponent(
    track.kind !== 'none' && track.ascendingAhead && Math.hypot(vx, vz) > 0
      ? Math.max(vehicle.velocity.y, MINECART_CLIMB_SPEED)
      : vehicle.velocity.y,
  )
  velocity.z = VehicleVelocityComponent(vz)
  const next: Vehicle = {
    ...vehicle,
    velocity,
  }
  return applyCollision(next, collision)
}
