import { propertyOfBlockId } from '@nerima-games/mc-kernel'
import type { Vehicle, VehicleServiceApi } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import type { BlockPosition, BlockReading, ChunkStoreApi } from '../chunk-store-port'
import type { Dimension } from '../nether-travel-port'
import { isAscendingAhead } from './rail-ascent'
import { resolveRailShape } from './rail-shape'
import { stepBoat, stepMinecart } from './vehicle-motion'

export type VehicleFrameEnvironment = Readonly<{
  isActiveDimension?: (dimension: Dimension) => boolean
  isPoweredRailAt?: (dimension: Dimension, position: BlockPosition) => boolean
}>

const blockKey = (position: BlockPosition): string => `${position.x},${position.y},${position.z}`
const elapsedFor = (dt: number): number => Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0))
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
): Effect.Effect<Vehicle> => Effect.gen(function* () {
  const position = { x: Math.floor(vehicle.position.x), y: Math.floor(vehicle.position.y), z: Math.floor(vehicle.position.z) }
  const readings = yield* readNeighbourhood(store, position)
  if (vehicle.type === 'boat') {
    return integrate(stepBoat(vehicle, {
      throttle: 0,
      steering: 0,
      inWater: waterAt(readings, position),
      collided: false,
    }, dt).vehicle, dt)
  }

  const kind = railKindAt(readings, position)
  const isRailAt = (x: number, y: number, z: number): boolean => railKindAt(readings, { x, y, z }) !== 'none'
  const transition = stepMinecart(vehicle, {
    kind,
    shape: resolveRailShape(isRailAt, position.x, position.y, position.z),
    ascendingAhead: isAscendingAhead(isRailAt, position.x, position.y, position.z, vehicle.velocity.x, vehicle.velocity.z),
    powered: kind === 'powered' && (environment.isPoweredRailAt?.(vehicle.dimension, position) ?? false),
  }, { collided: false }, dt)
  return integrate(transition.vehicle, dt)
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
      Effect.flatMap((next) => vehicleService.updateState(vehicle.id, {
        dimension: next.dimension,
        position: next.position,
        velocity: next.velocity,
        yawRadians: next.yawRadians,
      })),
      Effect.catchAll(() => Effect.void),
    )
  })
})
