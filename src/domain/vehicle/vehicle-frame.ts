import {
  BlockAxis,
  PositionAxis,
  blockPosition,
  position as kernelPosition,
  propertyOfBlockId,
  type BlockPosition,
  type Position,
} from '@nerima-games/mc-kernel'
import type { Vehicle, VehicleId, VehicleOperationError, VehicleServiceApi } from '@nerima-games/mc-sim'
import { Effect, Result } from 'effect'
import type { BlockReading, ChunkStoreApi } from '@nerima-games/mc-worldgen'
import type { Dimension } from '@nerima-games/mc-worldgen'
import { entityWorldBlockDataAt, type EntityWorldQueryFailure } from '../entities/entity-world-cell.js'
import { isAscendingAhead } from './rail-ascent.js'
import { resolveRailShape } from './rail-shape.js'
import { stepBoat, stepMinecart, type VehicleExitReason } from './vehicle-motion.js'

export type VehicleControlInput = Readonly<{
  throttle: number
  steering: number
}>

export type VehicleFrameEnvironment = Readonly<{
  isActiveDimension?: (dimension: Dimension) => boolean
  isPoweredRailAt?: (dimension: Dimension, position: BlockPosition) => boolean
  controlsForVehicle?: (vehicle: Vehicle) => VehicleControlInput
  onVehicleExit?: (vehicle: Vehicle, reason: VehicleExitReason) => void
}>

export type VehicleFrameFailure =
  | Readonly<{ _tag: 'VehicleWorldDataFault'; vehicleId: VehicleId; failure: EntityWorldQueryFailure }>
  | Readonly<{ _tag: 'VehicleUpdateFailure'; vehicleId: VehicleId; failure: VehicleOperationError }>

const blockKey = (position: BlockPosition): string => `${position.x},${position.y},${position.z}`
const blockPositionAt = (x: number, y: number, z: number): BlockPosition =>
  blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))
const positionAt = (x: number, y: number, z: number): Position =>
  kernelPosition(PositionAxis(x), PositionAxis(y), PositionAxis(z))
const elapsedFor = (dt: number): number => Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0))
const speedOf = (vehicle: Vehicle): number => Math.hypot(
  vehicle.velocity.x,
  vehicle.velocity.y,
  vehicle.velocity.z,
)
const isBlock = (reading: BlockReading): reading is Extract<BlockReading, { readonly _tag: 'Block' }> =>
  reading._tag === 'Block'

const blockAt = (readings: ReadonlyMap<string, BlockReading>, position: BlockPosition): BlockReading | undefined =>
  readings.get(blockKey(position))

const railKindAt = (readings: ReadonlyMap<string, BlockReading>, position: BlockPosition): 'none' | 'normal' | 'powered' => {
  const reading = blockAt(readings, position)
  if (reading === undefined || !isBlock(reading)) return 'none'
  const railKind = propertyOfBlockId(reading.block, 'railKind')
  // `isBlock` narrows `reading.block` to a valid BlockId.
  return Result.getOrThrow(railKind)
}

const waterAt = (readings: ReadonlyMap<string, BlockReading>, position: BlockPosition): boolean => {
  const cells = [position, blockPositionAt(position.x, position.y + 1, position.z)]
  return cells.some((cell) => {
    const reading = blockAt(readings, cell)
    if (reading === undefined || !isBlock(reading)) return false
    const fluid = propertyOfBlockId(reading.block, 'fluid')
    return Result.isSuccess(fluid) && fluid.success === 'water'
  })
}

const collidesAt = (
  readings: ReadonlyMap<string, BlockReading>,
  vehicle: Vehicle,
): boolean => {
  const halfWidth = vehicle.type === 'boat' ? 0.7 : 0.45
  const height = vehicle.type === 'boat' ? 0.6 : 0.7
  const minX = vehicle.position.x - halfWidth
  const maxX = vehicle.position.x + halfWidth
  const minY = vehicle.position.y
  const maxY = vehicle.position.y + height
  const minZ = vehicle.position.z - halfWidth
  const maxZ = vehicle.position.z + halfWidth
  for (let y = Math.floor(minY); y <= Math.floor(maxY); y += 1) {
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z += 1) {
      for (let x = Math.floor(minX); x <= Math.floor(maxX); x += 1) {
        const reading = blockAt(readings, blockPositionAt(x, y, z))
        if (reading === undefined || !isBlock(reading)) continue
        const collisionShape = propertyOfBlockId(reading.block, 'collisionShape')
        if (Result.isSuccess(collisionShape) && collisionShape.success === 'none') continue
        if (maxX > x && minX < x + 1 && maxY > y && minY < y + 1 && maxZ > z && minZ < z + 1) return true
      }
    }
  }
  return false
}

const neighbourhood = (position: BlockPosition): ReadonlyArray<BlockPosition> => {
  const centre = { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) }
  const cells: BlockPosition[] = []
  for (let y = centre.y - 1; y <= centre.y + 1; y += 1) {
    for (let z = centre.z - 1; z <= centre.z + 1; z += 1) {
      for (let x = centre.x - 1; x <= centre.x + 1; x += 1) cells.push(blockPositionAt(x, y, z))
    }
  }
  return cells
}

const readNeighbourhood = (store: ChunkStoreApi, position: BlockPosition): Effect.Effect<
  | Readonly<{ _tag: 'Loaded'; readings: ReadonlyMap<string, BlockReading> }>
  | Readonly<{ _tag: 'WorldDataFault'; failure: EntityWorldQueryFailure }>
> => Effect.gen(function* () {
  const cells = neighbourhood(position)
  const values = yield* Effect.forEach(cells, (cell) => store.getBlock(cell))
  const readings = new Map<string, BlockReading>()
  for (const [index, reading] of values.entries()) {
    const cell = cells[index]!
    if (reading._tag === 'Block') {
      const data = entityWorldBlockDataAt(cell, reading.block)
      if (Result.isFailure(data)) return { _tag: 'WorldDataFault', failure: data.failure }
    }
    readings.set(blockKey(cell), reading)
  }
  return { _tag: 'Loaded', readings }
})

const integrate = (vehicle: Vehicle, dt: number): Vehicle => ({
  ...vehicle,
  position: positionAt(
    vehicle.position.x + vehicle.velocity.x * dt,
    vehicle.position.y + vehicle.velocity.y * dt,
    vehicle.position.z + vehicle.velocity.z * dt,
  ),
})

const stepVehicle = (
  store: ChunkStoreApi,
  vehicle: Vehicle,
  environment: VehicleFrameEnvironment,
  dt: number,
): Effect.Effect<
  | Readonly<{ _tag: 'Stepped'; vehicle: Vehicle; exited?: Readonly<{ reason: VehicleExitReason }> }>
  | Readonly<{ _tag: 'WorldDataFault'; failure: EntityWorldQueryFailure }>
> => Effect.gen(function* () {
  const position = blockPositionAt(
    Math.floor(vehicle.position.x),
    Math.floor(vehicle.position.y),
    Math.floor(vehicle.position.z),
  )
  const vehicleNeighbourhood = yield* readNeighbourhood(store, position)
  if (vehicleNeighbourhood._tag === 'WorldDataFault') return vehicleNeighbourhood
  const readings = vehicleNeighbourhood.readings
  const controls = environment.controlsForVehicle?.(vehicle) ?? { throttle: 0, steering: 0 }
  if (vehicle.type === 'boat') {
    const transition = stepBoat(vehicle, {
      throttle: controls.throttle,
      steering: controls.steering,
      inWater: waterAt(readings, position),
      collided: false,
    }, dt)
    const next = integrate(transition.vehicle, dt)
    const collision = collidesAt(readings, next)
    const resolved = collision ? stepBoat(transition.vehicle, {
      throttle: controls.throttle,
      steering: controls.steering,
      inWater: waterAt(readings, position),
      collided: true,
      impactSpeed: speedOf(transition.vehicle),
    }, dt) : transition
    const result = collision ? resolved.vehicle : next
    return resolved.exited === undefined
      ? { _tag: 'Stepped', vehicle: result }
      : { _tag: 'Stepped', vehicle: result, exited: { reason: resolved.exited.reason } }
  }

  const kind = railKindAt(readings, position)
  const isRailAt = (x: number, y: number, z: number): boolean => railKindAt(readings, blockPositionAt(x, y, z)) !== 'none'
  const transition = stepMinecart(vehicle, {
    kind,
    shape: resolveRailShape(isRailAt, position.x, position.y, position.z),
    ascendingAhead: isAscendingAhead(isRailAt, position.x, position.y, position.z, vehicle.velocity.x, vehicle.velocity.z),
    powered: kind === 'powered' && (environment.isPoweredRailAt?.(vehicle.dimension, position) ?? false),
  }, { collided: false }, dt)
  const next = integrate(transition.vehicle, dt)
  const collision = collidesAt(readings, next)
  const resolved = collision ? stepMinecart(vehicle, {
    kind,
    shape: resolveRailShape(isRailAt, position.x, position.y, position.z),
    ascendingAhead: isAscendingAhead(isRailAt, position.x, position.y, position.z, vehicle.velocity.x, vehicle.velocity.z),
    powered: kind === 'powered' && (environment.isPoweredRailAt?.(vehicle.dimension, position) ?? false),
  }, { collided: true, impactSpeed: speedOf(transition.vehicle) }, dt) : transition
  const result = collision ? resolved.vehicle : next
  return resolved.exited === undefined
    ? { _tag: 'Stepped', vehicle: result }
    : { _tag: 'Stepped', vehicle: result, exited: { reason: resolved.exited.reason } }
})

export const advanceVehicles = (
  store: ChunkStoreApi,
  vehicleService: VehicleServiceApi,
  dt: number,
  environment: VehicleFrameEnvironment = {},
): Effect.Effect<ReadonlyArray<VehicleFrameFailure>> => Effect.gen(function* () {
  const elapsed = elapsedFor(dt)
  if (elapsed === 0) return []
  const vehicles = yield* vehicleService.vehicles
  const failures: Array<VehicleFrameFailure> = []
  for (const vehicle of vehicles) {
    if (environment.isActiveDimension !== undefined && !environment.isActiveDimension(vehicle.dimension)) continue
    const transition = yield* stepVehicle(store, vehicle, environment, elapsed)
    if (transition._tag === 'WorldDataFault') {
      failures.push({ _tag: 'VehicleWorldDataFault', vehicleId: vehicle.id, failure: transition.failure })
      continue
    }
    if (transition.exited !== undefined) environment.onVehicleExit?.(vehicle, transition.exited.reason)
    const updated = yield* Effect.result(vehicleService.updateState(vehicle.id, {
      dimension: transition.vehicle.dimension,
      position: transition.vehicle.position,
      velocity: transition.vehicle.velocity,
      yawRadians: transition.vehicle.yawRadians,
      occupant: transition.vehicle.occupant,
    }))
    if (Result.isFailure(updated)) {
      failures.push({ _tag: 'VehicleUpdateFailure', vehicleId: vehicle.id, failure: updated.failure })
    }
  }
  return failures
})
