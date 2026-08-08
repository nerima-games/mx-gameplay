import type { OccupantId, Vehicle } from '@nerima-games/mc-sim'
import { projectMinecartVelocity, type RailShape } from './rail-shape'

export type VehicleExitReason = 'requested' | 'collision' | 'destroyed'

export type VehicleTransition = Readonly<{
  vehicle: Vehicle
  exited?: Readonly<{ occupant: OccupantId; reason: VehicleExitReason }>
}>

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

const withoutOccupant = (vehicle: Vehicle): Vehicle => {
  const { occupant, ...unoccupied } = vehicle
  void occupant
  return unoccupied
}

const applyCollision = (vehicle: Vehicle, collision: VehicleCollision): VehicleTransition => {
  const occupant = vehicle.occupant
  if (collision.destroyed) {
    const stopped = withoutOccupant({ ...vehicle, velocity: { x: 0, y: 0, z: 0 } })
    return occupant === undefined
      ? { vehicle: stopped }
      : { vehicle: stopped, exited: { occupant, reason: 'destroyed' } }
  }
  if (!collision.collided) return { vehicle }

  // The non-null assertion, not `?? 0`, is deliberate: `impactSpeed?: number`
  // is not narrowed to `number` by `Number.isFinite`, but the guard above still
  // forbids `undefined` here (`Number.isFinite(undefined)` is `false`), so a
  // runtime fallback can never fire and would be dead code purely to satisfy
  // the type checker.
  const impactSpeed = Number.isFinite(collision.impactSpeed)
    ? Math.max(0, collision.impactSpeed!)
    : speed(vehicle)
  const collided: Vehicle = {
    ...vehicle,
    velocity: {
      x: vehicle.velocity.x * 0.2,
      y: Math.min(0, vehicle.velocity.y),
      z: vehicle.velocity.z * 0.2,
    },
  }
  return occupant !== undefined && impactSpeed >= COLLISION_EXIT_SPEED
    ? { vehicle: withoutOccupant(collided), exited: { occupant, reason: 'collision' } }
    : { vehicle: collided }
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

export const stepBoat = (vehicle: Vehicle, control: BoatControl, dt: number): VehicleTransition => {
  if (vehicle.type !== 'boat') return { vehicle }
  const elapsed = safeDt(dt)
  const steering = vehicle.occupant === undefined ? 0 : clamp(control.steering, -1, 1)
  const throttle = vehicle.occupant === undefined ? 0 : clamp(control.throttle, -1, 1)
  const yawRadians = vehicle.yawRadians + steering * BOAT_TURN_RATE * elapsed
  const acceleration = control.inWater ? BOAT_ACCELERATION : BOAT_ACCELERATION * 0.15
  const drag = Math.pow(control.inWater ? 0.9 : 0.55, elapsed * 20)
  const vx = (vehicle.velocity.x - Math.sin(yawRadians) * throttle * acceleration * elapsed) * drag
  const vz = (vehicle.velocity.z - Math.cos(yawRadians) * throttle * acceleration * elapsed) * drag
  const next: Vehicle = {
    ...vehicle,
    yawRadians,
    velocity: { x: vx, y: control.inWater ? vehicle.velocity.y * drag : vehicle.velocity.y, z: vz },
  }
  return applyCollision(next, control)
}

export const stepMinecart = (
  vehicle: Vehicle,
  track: MinecartTrack,
  collision: VehicleCollision,
  dt: number,
): VehicleTransition => {
  if (vehicle.type !== 'minecart') return { vehicle }
  const elapsed = safeDt(dt)
  let { vx, vz } = track.kind === 'none'
    ? { vx: vehicle.velocity.x, vz: vehicle.velocity.z }
    : projectMinecartVelocity(track.shape, vehicle.velocity.x, vehicle.velocity.z)

  if (track.kind === 'powered') {
    const currentSpeed = Math.hypot(vx, vz)
    if (track.powered) {
      const directionX = currentSpeed > 0 ? vx / currentSpeed : -Math.sin(vehicle.yawRadians)
      const directionZ = currentSpeed > 0 ? vz / currentSpeed : -Math.cos(vehicle.yawRadians)
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

  const next: Vehicle = {
    ...vehicle,
    velocity: {
      x: vx,
      y: track.kind !== 'none' && track.ascendingAhead && Math.hypot(vx, vz) > 0
        ? Math.max(vehicle.velocity.y, MINECART_CLIMB_SPEED)
        : vehicle.velocity.y,
      z: vz,
    },
  }
  return applyCollision(next, collision)
}
