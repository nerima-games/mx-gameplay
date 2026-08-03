import { propertyOfBlockId } from '@nerima-games/mc-kernel'
import type { Vehicle, VehicleServiceApi } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import type { BlockPosition, BlockReading, ChunkStoreApi } from '../chunk-store-port'
import type { Dimension } from '../nether-travel-port'
import { isAscendingAhead } from './rail-ascent'
import { resolveRailShape } from './rail-shape'
import { stepBoat, stepMinecart, type VehicleExitReason } from './vehicle-motion'

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

const blockKey = (position: BlockPosition): string => `${position.x},${position.y},${position.z}`
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
  return reading !== undefined && isBlock(reading) ? propertyOfBlockId(reading.block, 'railKind') : 'none'
}

const waterAt = (readings: ReadonlyMap<string, BlockReading>, position: BlockPosition): boolean => {
  const cells = [position, { ...position, y: position.y + 1 }]
  return cells.some((cell) => {
    const reading = blockAt(readings, cell)
    return reading !== undefined && isBlock(reading) && propertyOfBlockId(reading.block, 'fluid') === 'water'
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
        const reading = blockAt(readings, { x, y, z })
        if (reading === undefined || !isBlock(reading)) continue
        if (propertyOfBlockId(reading.block, 'collisionShape') === 'none') continue
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
      for (let x = centre.x - 1; x <= centre.x + 1; x += 1) cells.push({ x, y, z })
    }
  }
  return cells
}

const readNeighbourhood = (store: ChunkStoreApi, position: BlockPosition): Effect.Effect<ReadonlyMap<string, BlockReading>> => {
  const cells = neighbourhood(position)
  return Effect.forEach(cells, (cell) => store.getBlock(cell)).pipe(
    Effect.map((readings) => new Map(readings.map((reading, index) => [blockKey(cells[index]!), reading]))),
  )
}

const integrate = (vehicle: Vehicle, dt: number): Vehicle => ({
  ...vehicle,
  position: {
    x: vehicle.position.x + vehicle.velocity.x * dt,
    y: vehicle.position.y + vehicle.velocity.y * dt,
    z: vehicle.position.z + vehicle.velocity.z * dt,
  },
})

const stepVehicle = (
  store: ChunkStoreApi,
  vehicle: Vehicle,
  environment: VehicleFrameEnvironment,
  dt: number,
): Effect.Effect<Readonly<{ vehicle: Vehicle; exited?: Readonly<{ reason: VehicleExitReason }> }>> => Effect.gen(function* () {
  const position = { x: Math.floor(vehicle.position.x), y: Math.floor(vehicle.position.y), z: Math.floor(vehicle.position.z) }
  const readings = yield* readNeighbourhood(store, position)
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
      ? { vehicle: result }
      : { vehicle: result, exited: { reason: resolved.exited.reason } }
  }

  const kind = railKindAt(readings, position)
  const isRailAt = (x: number, y: number, z: number): boolean => railKindAt(readings, { x, y, z }) !== 'none'
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
    ? { vehicle: result }
    : { vehicle: result, exited: { reason: resolved.exited.reason } }
})

export const advanceVehicles = (
  store: ChunkStoreApi,
  vehicleService: VehicleServiceApi,
  dt: number,
  environment: VehicleFrameEnvironment = {},
): Effect.Effect<void> => Effect.gen(function* () {
  const elapsed = elapsedFor(dt)
  if (elapsed === 0) return
  const vehicles = yield* vehicleService.vehicles
  yield* Effect.forEach(vehicles, (vehicle) => {
    if (environment.isActiveDimension !== undefined && !environment.isActiveDimension(vehicle.dimension)) return Effect.void
    return stepVehicle(store, vehicle, environment, elapsed).pipe(
      Effect.flatMap((transition) => Effect.sync(() => {
        if (transition.exited !== undefined) environment.onVehicleExit?.(vehicle, transition.exited.reason)
      }).pipe(Effect.zipRight(vehicleService.updateState(vehicle.id, {
        dimension: transition.vehicle.dimension,
        position: transition.vehicle.position,
        velocity: transition.vehicle.velocity,
        yawRadians: transition.vehicle.yawRadians,
        occupant: transition.vehicle.occupant,
      })))),
      Effect.catchAll(() => Effect.void),
    )
  })
})
