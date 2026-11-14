import { describe, expect, it } from '@effect/vitest'
import {
  AngleRadians,
  blockIdOf,
  DeltaTimeSecs,
  VehicleVelocityComponent,
  type BlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import {
  makeTimeService,
  makeVehicleService,
  OccupantId,
  type Vehicle,
  type VehicleServiceApi,
} from '@nerima-games/mc-sim'
import { Effect, Option, Result } from 'effect'
import {
  cellKey,
  chunkKey,
  chunkOf,
  makeInMemoryWorld,
  type WorldContents,
} from '../../src/domain/in-memory-world.js'
import { type MobBehaviour } from '../../src/domain/entities/mob-frame'
import { type VehicleFrameEnvironment } from '../../src/domain/vehicle/vehicle-frame'
import { gameplayStages, makeGameplayFrameState } from '../../src/stages/registration'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { runFrame } from '../support/frame-runner'
import { makeInventoryDouble } from '../support/inventory-service-double'
import { blockPosition, position } from '../support/coordinate-fixtures'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'

const RAIL = Option.getOrThrow(blockIdOf('rail'))
const WATER = Option.getOrThrow(blockIdOf('water'))

const worldWith = (entries: ReadonlyArray<readonly [BlockPosition, BlockId]>): WorldContents => {
  const blocks = new Map(entries.map(([cell, block]) => [cellKey(cell), block] as const))
  const loaded = new Set<string>()
  for (const [cell] of entries) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        loaded.add(chunkKey(chunkOf(blockPosition(cell.x + dx, cell.y, cell.z + dz))))
      }
    }
  }
  return { blocks, loaded: [...loaded] }
}

const vehicleVelocity = (x: number, y: number, z: number): Vehicle['velocity'] => ({
  x: Result.getOrThrow(VehicleVelocityComponent.result(x)),
  y: Result.getOrThrow(VehicleVelocityComponent.result(y)),
  z: Result.getOrThrow(VehicleVelocityComponent.result(z)),
})

const makeScenarioRig = (
  contents: WorldContents,
  vehicleEnvironment: VehicleFrameEnvironment,
) => Effect.gen(function* () {
  const world = yield* makeInMemoryWorld({ world: contents })
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const inventory = yield* makeInventoryDouble()
  const commit = yield* makeGameplayCommitServices(world.chunkStore, inventory.api)
  const time = yield* makeTimeService()
  const state = yield* makeGameplayFrameState
  const vehicles = yield* makeVehicleService()
  const stages = gameplayStages(
    state,
    world.chunkStore,
    roster.api,
    inventory.api,
    undefined,
    time,
    vehicles,
    vehicleEnvironment,
    {},
    commit,
  )

  return { stages, vehicles }
})

const soleVehicle = (vehicles: VehicleServiceApi) =>
  Effect.flatMap(vehicles.vehicles, (all) => {
    const vehicle = all[0]
    return vehicle === undefined
      ? Effect.die('expected one vehicle after the frame')
      : Effect.succeed(vehicle)
  })

describe('vehicle scenarios through gameplayStages', () => {
  it.effect('a mounted minecart follows a north-east rail corner through scheduled frames', () =>
    Effect.gen(function* () {
      const track: Array<readonly [BlockPosition, BlockId]> = []
      for (let z = -5; z <= 0; z += 1) track.push([blockPosition(0, 64, z), RAIL])
      for (let x = 0; x <= 8; x += 1) track.push([blockPosition(x, 64, 0), RAIL])

      const rig = yield* makeScenarioRig(worldWith(track), {})
      const cart = yield* rig.vehicles.spawn('minecart', 'overworld', position(0.5, 64, -5), AngleRadians(0))
      const rider = OccupantId('scenario:minecart-rider')
      yield* rig.vehicles.mount(cart.id, rider)
      yield* rig.vehicles.updateVelocity(cart.id, vehicleVelocity(0, 0, 4))

      const trackCells = new Set(track.map(([cell]) => `${String(cell.x)},${String(cell.z)}`))
      let maximumX = Number.NEGATIVE_INFINITY
      let maximumZ = Number.NEGATIVE_INFINITY

      for (let frame = 0; frame < 50; frame += 1) {
        yield* runFrame(rig.stages, DeltaTimeSecs(0.05))
        const current = yield* soleVehicle(rig.vehicles)
        const cell = `${String(Math.floor(current.position.x))},${String(Math.floor(current.position.z))}`
        expect(trackCells.has(cell)).toBe(true)
        maximumX = Math.max(maximumX, current.position.x)
        maximumZ = Math.max(maximumZ, current.position.z)
      }

      const cartAfterRoute = yield* soleVehicle(rig.vehicles)
      expect(maximumZ).toBeGreaterThan(0)
      expect(maximumX).toBeGreaterThan(1)
      expect(cartAfterRoute.position.x).toBeGreaterThan(1)
      expect(Math.floor(cartAfterRoute.position.z)).toBe(0)
      expect(cartAfterRoute.occupant).toBe(rider)
    }),
  )

  it.effect('a minecart climbs and descends between track levels when physics supplies downward velocity', () =>
    Effect.gen(function* () {
      const slope: Array<readonly [BlockPosition, BlockId]> = []
      for (let z = -3; z <= -1; z += 1) slope.push([blockPosition(0, 64, z), RAIL])
      slope.push([blockPosition(0, 65, 0), RAIL])
      for (let z = 1; z <= 5; z += 1) slope.push([blockPosition(0, 64, z), RAIL])
      const trackCells = new Set(slope.map(([cell]) => cellKey(cell)))

      const rig = yield* makeScenarioRig(worldWith(slope), {})
      const cart = yield* rig.vehicles.spawn('minecart', 'overworld', position(0.5, 64, -3), AngleRadians(0))
      yield* rig.vehicles.updateVelocity(cart.id, vehicleVelocity(0, 0, 2))

      let cartOnSlope = yield* soleVehicle(rig.vehicles)
      for (let frame = 0; frame < 40; frame += 1) {
        yield* runFrame(rig.stages, DeltaTimeSecs(0.05))
        cartOnSlope = yield* soleVehicle(rig.vehicles)
        if (cartOnSlope.position.y >= 65 && cartOnSlope.position.z >= 0) break
      }

      expect(cartOnSlope.position.y).toBeGreaterThanOrEqual(65)
      expect(cartOnSlope.position.z).toBeGreaterThanOrEqual(0)
      expect(cartOnSlope.velocity.y).toBeGreaterThan(0)

      // The host supplies gravity; hold the cart on the crest until the descending leg starts.
      yield* rig.vehicles.updateVelocity(
        cart.id,
        vehicleVelocity(cartOnSlope.velocity.x, 0, cartOnSlope.velocity.z),
      )
      for (let frame = 0; frame < 16 && cartOnSlope.position.z < 0.8; frame += 1) {
        yield* runFrame(rig.stages, DeltaTimeSecs(0.05))
        cartOnSlope = yield* soleVehicle(rig.vehicles)
        const cell = blockPosition(
          Math.floor(cartOnSlope.position.x),
          Math.floor(cartOnSlope.position.y),
          Math.floor(cartOnSlope.position.z),
        )
        expect(trackCells.has(cellKey(cell))).toBe(true)
      }
      expect(Math.floor(cartOnSlope.position.y)).toBe(65)
      expect(cartOnSlope.position.z).toBeGreaterThanOrEqual(0.8)
      expect(cartOnSlope.position.z).toBeLessThan(1)

      yield* rig.vehicles.updateVelocity(cart.id, vehicleVelocity(cartOnSlope.velocity.x, -2, 4.5))
      let previous = cartOnSlope
      for (let frame = 0; frame < 8; frame += 1) {
        yield* runFrame(rig.stages, DeltaTimeSecs(0.05))
        const current = yield* soleVehicle(rig.vehicles)
        const cell = blockPosition(
          Math.floor(current.position.x),
          Math.floor(current.position.y),
          Math.floor(current.position.z),
        )
        expect(trackCells.has(cellKey(cell))).toBe(true)
        expect(current.position.y).toBeLessThan(previous.position.y)
        expect(current.position.z).toBeGreaterThan(previous.position.z)
        previous = current
      }

      expect(Math.floor(previous.position.y)).toBe(64)
      expect(previous.position.z).toBeGreaterThanOrEqual(1)
      expect(previous.velocity.y).toBeLessThan(0)
    }),
  )

  it.effect('a ridden boat steers and advances over water through scheduled frames', () =>
    Effect.gen(function* () {
      const water: Array<readonly [BlockPosition, BlockId]> = []
      for (let x = -3; x <= 3; x += 1) {
        for (let z = -3; z <= 3; z += 1) water.push([blockPosition(x, 64, z), WATER])
      }

      const rig = yield* makeScenarioRig(worldWith(water), {
        controlsForVehicle: () => ({ throttle: 1, steering: 1 }),
      })
      const boat = yield* rig.vehicles.spawn('boat', 'overworld', position(0.5, 64, 0.5), AngleRadians(0))
      const rider = OccupantId('scenario:boat-rider')
      yield* rig.vehicles.mount(boat.id, rider)

      for (let frame = 0; frame < 5; frame += 1) {
        yield* runFrame(rig.stages, DeltaTimeSecs(0.1))
      }

      const boatAfterTravel = yield* soleVehicle(rig.vehicles)
      expect(boatAfterTravel.yawRadians).toBeGreaterThan(0)
      expect(boatAfterTravel.position.x).toBeLessThan(0.5)
      expect(boatAfterTravel.position.z).toBeLessThan(0.5)
      expect(boatAfterTravel.velocity.x).toBeLessThan(0)
      expect(boatAfterTravel.velocity.z).toBeLessThan(0)
      expect(boatAfterTravel.occupant).toBe(rider)
    }),
  )
})
