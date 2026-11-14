import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Option } from 'effect'
import * as FastCheck from 'fast-check'
import { BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import { VehicleId, type VehicleServiceApi } from '@nerima-games/mc-sim'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { advanceVehicles, type VehicleControlInput } from '../src/domain/vehicle/vehicle-frame'

const AIR = Option.getOrThrow(blockIdOf('air'))

describe('vehicle frame', () => {
  it('integrates active vehicles and writes the result atomically', async () => {
    const vehicle = {
      id: VehicleId('v:frame'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    const updates: Array<{ id: string; x: number }> = []
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (id: VehicleId, state: { readonly position: { readonly x: number } }) =>
        Effect.sync(() => {
          updates.push({ id: String(id), x: state.position.x })
        }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'Block' as const, block: AIR }),
    } as unknown as ChunkStoreApi

    const result = await Effect.runPromiseExit(advanceVehicles(store, service, 1))

    expect(Exit.isSuccess(result)).toBe(true)
    expect(updates).toStrictEqual([{ id: 'v:frame', x: 0.2 }])
  })

  it('does not update vehicles outside the active dimension', async () => {
    const vehicle = {
      id: VehicleId('v:nether'),
      type: 'boat' as const,
      dimension: 'nether' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    let updateCount = 0
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: () => Effect.sync(() => {
        updateCount += 1
      }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'OutOfWorld' as const }),
    } as unknown as ChunkStoreApi

    await Effect.runPromise(advanceVehicles(store, service, 0.05, {
      isActiveDimension: (dimension) => dimension === 'overworld',
    }))

    expect(updateCount).toBe(0)
  })

  it('returns a per-vehicle update failure and continues the remaining vehicles', async () => {
    const vehicle = {
      id: VehicleId('v:broken'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    const nextVehicle = { ...vehicle, id: VehicleId('v:next') }
    const updated: Array<VehicleId> = []
    const service = {
      vehicles: Effect.succeed([vehicle, nextVehicle]),
      updateState: (id: VehicleId) => id === vehicle.id
        ? Effect.fail({ _tag: 'VehicleOperationError' as const, reason: 'not-found' as const })
        : Effect.sync(() => { updated.push(id) }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'Block' as const, block: AIR }),
    } as unknown as ChunkStoreApi

    const result = await Effect.runPromise(advanceVehicles(store, service, 1))

    expect(result).toMatchObject([{ _tag: 'VehicleUpdateFailure', vehicleId: vehicle.id }])
    expect(updated).toEqual([nextVehicle.id])
  })

  it('returns a world-data fault and does not step the vehicle across an unknown block id', async () => {
    const vehicle = {
      id: VehicleId('v:unknown-terrain'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    let updateCount = 0
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: () => Effect.sync(() => { updateCount += 1 }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'Block' as const, block: BlockId(65_535) }),
    } as unknown as ChunkStoreApi

    const result = await Effect.runPromise(advanceVehicles(store, service, 1))

    expect(result).toMatchObject([{
      _tag: 'VehicleWorldDataFault',
      vehicleId: vehicle.id,
      failure: { _tag: 'EntityWorldUnregisteredBlockId', blockId: BlockId(65_535) },
    }])
    expect(updateCount).toBe(0)
  })

  it('passes boat controls into the vehicle motion step', async () => {
    const vehicle = {
      id: VehicleId('v:boat'),
      type: 'boat' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yawRadians: 0,
      occupant: 'player:local',
    }
    let next: Record<string, unknown> | undefined
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (_id: VehicleId, state: Record<string, unknown>) => Effect.sync(() => { next = state }),
    } as unknown as VehicleServiceApi
    const water = Option.getOrThrow(blockIdOf('water'))
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'Block' as const, block: water }),
    } as unknown as ChunkStoreApi

    await Effect.runPromise(advanceVehicles(store, service, 0.05, {
      controlsForVehicle: () => ({ throttle: 1, steering: 0 }),
    }))

    expect(next?.['position']).toEqual({ x: 0, y: 64, z: -0.009000000000000001 })
    expect(next?.['occupant']).toBe('player:local')
  })

  it('returns typed failures for malformed host boat controls and continues other vehicles', async () => {
    const badThrottle = {
      id: VehicleId('v:bad-throttle'),
      type: 'boat' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yawRadians: 0,
      occupant: 'player:local',
    }
    const badSteering = {
      ...badThrottle,
      id: VehicleId('v:bad-steering'),
      position: { x: 10, y: 64, z: 0 },
    }
    const undefinedThrottle = {
      ...badThrottle,
      id: VehicleId('v:undefined-throttle'),
      position: { x: 20, y: 64, z: 0 },
    }
    const good = {
      ...badThrottle,
      id: VehicleId('v:good-controls'),
      position: { x: 30, y: 64, z: 0 },
    }
    const updated: Array<VehicleId> = []
    const service = {
      vehicles: Effect.succeed([badThrottle, badSteering, undefinedThrottle, good]),
      updateState: (id: VehicleId) => Effect.sync(() => { updated.push(id) }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'Block' as const, block: AIR }),
    } as unknown as ChunkStoreApi

    const failures = await Effect.runPromise(advanceVehicles(store, service, 0.05, {
      controlsForVehicle: (vehicle) => vehicle.id === badThrottle.id
        ? { throttle: Number.NaN, steering: 0 }
        : vehicle.id === badSteering.id
          ? { throttle: 0, steering: Number.POSITIVE_INFINITY }
          : vehicle.id === undefinedThrottle.id
            ? { throttle: undefined, steering: 0 } as unknown as VehicleControlInput
          : { throttle: 1, steering: 0 },
    }))

    expect(failures).toMatchObject([
      { _tag: 'VehicleMotionFailure', vehicleId: badThrottle.id, failure: { _tag: 'InvalidBoatControl', field: 'throttle' } },
      { _tag: 'VehicleMotionFailure', vehicleId: badSteering.id, failure: { _tag: 'InvalidBoatControl', field: 'steering' } },
      { _tag: 'VehicleMotionFailure', vehicleId: undefinedThrottle.id, failure: { _tag: 'InvalidBoatControl', field: 'throttle' } },
    ])
    expect(updated).toStrictEqual([good.id])
  })

  it('rejects an explicitly undefined controls callback while preserving the omitted callback default', async () => {
    const vehicle = {
      id: VehicleId('v:explicit-undefined-controls'),
      type: 'boat' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yawRadians: 0,
      occupant: 'player:local',
    }
    const updated: Array<VehicleId> = []
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (id: VehicleId) => Effect.sync(() => { updated.push(id) }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'Block' as const, block: AIR }),
    } as unknown as ChunkStoreApi

    const explicitUndefined = await Effect.runPromise(advanceVehicles(store, service, 0.05, {
      controlsForVehicle: undefined,
    } as unknown as Parameters<typeof advanceVehicles>[3]))
    expect(explicitUndefined).toStrictEqual([{ _tag: 'VehicleMotionFailure', vehicleId: vehicle.id, failure: {
      _tag: 'InvalidBoatControl', field: 'controls',
    } }])
    expect(updated).toStrictEqual([])

    const callbackReturnsUndefined = await Effect.runPromise(advanceVehicles(store, service, 0.05, {
      controlsForVehicle: () => undefined,
    } as unknown as Parameters<typeof advanceVehicles>[3]))
    expect(callbackReturnsUndefined).toStrictEqual([{ _tag: 'VehicleMotionFailure', vehicleId: vehicle.id, failure: {
      _tag: 'InvalidBoatControl', field: 'controls',
    } }])
    expect(updated).toStrictEqual([])

    const omittedCallback = await Effect.runPromise(advanceVehicles(store, service, 0.05))
    expect(omittedCallback).toStrictEqual([])
    expect(updated).toStrictEqual([vehicle.id])
  })

  it('does not treat an unloaded cell as water for boat movement', async () => {
    const vehicle = {
      id: VehicleId('v:boat-unloaded-water'),
      type: 'boat' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yawRadians: 0,
      occupant: 'player:local',
    }
    let next: Record<string, unknown> | undefined
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (_id: VehicleId, state: Record<string, unknown>) => Effect.sync(() => { next = state }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'ChunkNotLoaded' as const }),
    } as unknown as ChunkStoreApi

    const result = await Effect.runPromise(advanceVehicles(store, service, 0.05, {
      controlsForVehicle: () => ({ throttle: 1, steering: 0 }),
    }))

    expect(result).toMatchObject([{
      _tag: 'VehicleWorldUnavailable',
      vehicleId: vehicle.id,
      reading: { _tag: 'ChunkNotLoaded' },
    }])
    expect(next).toBeUndefined()
  })

  it('returns a typed refusal for every unavailable BlockReading state', async () => {
    const vehicle = {
      id: VehicleId('v:unavailable-property'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }

    await FastCheck.assert(
      FastCheck.asyncProperty(
        FastCheck.constantFrom(
          { _tag: 'ChunkNotLoaded' as const },
          { _tag: 'OutOfWorld' as const },
        ),
        async (reading) => {
          let updates = 0
          const service = {
            vehicles: Effect.succeed([vehicle]),
            updateState: () => Effect.sync(() => { updates += 1 }),
          } as unknown as VehicleServiceApi
          const store = { getBlock: () => Effect.succeed(reading) } as unknown as ChunkStoreApi
          const failures = await Effect.runPromise(advanceVehicles(store, service, 0.1))
          const failure = failures[0]
          return failures.length === 1 &&
            failure?._tag === 'VehicleWorldUnavailable' &&
            failure.reading._tag === reading._tag &&
            updates === 0
        },
      ),
      { numRuns: 100, seed: 70404 },
    )
  })

  it('refuses an out-of-world vehicle and continues other vehicles', async () => {
    const unavailableVehicle = {
      id: VehicleId('v:out-of-world'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    const nextVehicle = {
      ...unavailableVehicle,
      id: VehicleId('v:loaded'),
      position: { x: 10, y: 64, z: 0 },
    }
    const updated: Array<VehicleId> = []
    const service = {
      vehicles: Effect.succeed([unavailableVehicle, nextVehicle]),
      updateState: (id: VehicleId) => Effect.sync(() => { updated.push(id) }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => position.x < 2
        ? Effect.succeed({ _tag: 'OutOfWorld' as const })
        : Effect.succeed({ _tag: 'Block' as const, block: AIR }),
    } as unknown as ChunkStoreApi

    const result = await Effect.runPromise(advanceVehicles(store, service, 0.1))

    expect(result).toMatchObject([{
      _tag: 'VehicleWorldUnavailable',
      vehicleId: unavailableVehicle.id,
      reading: { _tag: 'OutOfWorld' },
    }])
    expect(updated).toStrictEqual([nextVehicle.id])
  })

  it('preserves minecart momentum on a block without rail metadata', async () => {
    const vehicle = {
      id: VehicleId('v:non-rail-block'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    let next: Record<string, unknown> | undefined
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (_id: VehicleId, state: Record<string, unknown>) => Effect.sync(() => { next = state }),
    } as unknown as VehicleServiceApi
    const air = Option.getOrThrow(blockIdOf('air'))
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'Block' as const, block: air }),
    } as unknown as ChunkStoreApi

    await Effect.runPromise(advanceVehicles(store, service, 0.1))

    const velocity = next?.['velocity'] as { x: number; y: number; z: number }
    expect(velocity.x).toBeCloseTo(2, 12)
  })

  it('stops a vehicle before a solid block and reports collision exits', async () => {
    const vehicle = {
      id: VehicleId('v:collision'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 8, y: 0, z: 0 },
      yawRadians: 0,
      occupant: 'player:local',
    }
    let next: Record<string, unknown> | undefined
    let exit: string | undefined
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (_id: VehicleId, state: Record<string, unknown>) => Effect.sync(() => { next = state }),
    } as unknown as VehicleServiceApi
    const stone = Option.getOrThrow(blockIdOf('stone'))
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : { _tag: 'Block' as const, block: AIR },
      ),
    } as unknown as ChunkStoreApi

    await Effect.runPromise(advanceVehicles(store, service, 0.1, {
      onVehicleExit: (_vehicle, reason) => { exit = reason },
    }))

    expect(next?.['position']).toEqual({ x: 0, y: 64, z: 0 })
    expect(next?.['occupant']).toBeUndefined()
    expect(exit).toBe('collision')
  })

  it('stops a boat before a solid block and reports collision exits', async () => {
    const vehicle = {
      id: VehicleId('v:boat-collision'),
      type: 'boat' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 8, y: 0, z: 0 },
      yawRadians: 0,
      occupant: 'player:local',
    }
    let next: Record<string, unknown> | undefined
    let exit: string | undefined
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (_id: VehicleId, state: Record<string, unknown>) => Effect.sync(() => { next = state }),
    } as unknown as VehicleServiceApi
    const stone = Option.getOrThrow(blockIdOf('stone'))
    const water = Option.getOrThrow(blockIdOf('water'))
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : { _tag: 'Block' as const, block: water },
      ),
    } as unknown as ChunkStoreApi

    await Effect.runPromise(advanceVehicles(store, service, 0.1, {
      onVehicleExit: (_vehicle, reason) => { exit = reason },
    }))

    expect(next?.['position']).toEqual({ x: 0, y: 64, z: 0 })
    expect(next?.['occupant']).toBeUndefined()
    expect(exit).toBe('collision')
  })

  it('does not collide with a solid block that only touches the AABB’s edge', () => {
    // Every collision test above puts the solid block fully inside the AABB,
    // so `collidesAt`'s exact per-axis check (`maxX > x && minX < x + 1 &&
    // ...`) only ever saw its all-TRUE case — the geometric candidate range
    // (`Math.floor(minX)..Math.floor(maxX)`, inclusive) always includes the
    // boundary cell whose edge merely TOUCHES the AABB, and the strict `>`/`<`
    // comparisons are what correctly exclude a touch from counting as a
    // collision. A stationary minecart (velocity zero, so `integrate` leaves
    // its position untouched) whose AABB's right edge lands on EXACTLY an
    // integer boundary reaches that boundary cell without ever overlapping it.
    const vehicle = {
      id: VehicleId('v:edge-touch'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      // halfWidth is 0.45 for a minecart, so maxX = 0.55 + 0.45 = 1.0 exactly.
      position: { x: 0.55, y: 64, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yawRadians: 0,
      occupant: 'player:local',
    }
    let next: Record<string, unknown> | undefined
    let exit: string | undefined
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (_id: VehicleId, state: Record<string, unknown>) => Effect.sync(() => { next = state }),
    } as unknown as VehicleServiceApi
    const stone = Option.getOrThrow(blockIdOf('stone'))
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : { _tag: 'Block' as const, block: AIR },
      ),
    } as unknown as ChunkStoreApi

    return Effect.runPromise(advanceVehicles(store, service, 0.1, {
      onVehicleExit: (_vehicle, reason) => { exit = reason },
    })).then(() => {
      expect(next?.['position']).toEqual({ x: 0.55, y: 64, z: 0 })
      expect(next?.['occupant']).toBe('player:local')
      expect(exit).toBeUndefined()
    })
  })

  it('samples powered track state once and reuses it for collision resolution', async () => {
    const vehicle = {
      id: VehicleId('v:powered'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 8, y: 0, z: 0 },
      yawRadians: 0,
    }
    let next: Record<string, unknown> | undefined
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (_id: VehicleId, state: Record<string, unknown>) => Effect.sync(() => { next = state }),
    } as unknown as VehicleServiceApi
    const stone = Option.getOrThrow(blockIdOf('stone'))
    const poweredRail = Option.getOrThrow(blockIdOf('powered_rail'))
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : position.x === 0 && position.y === 64 && position.z === 0
            ? { _tag: 'Block' as const, block: poweredRail }
            : { _tag: 'Block' as const, block: AIR },
      ),
    } as unknown as ChunkStoreApi
    let poweredQueries = 0

    await Effect.runPromise(advanceVehicles(store, service, 0.1, {
      isPoweredRailAt: () => {
        poweredQueries += 1
        return true
      },
    }))

    // Track is built once and reused when the collision resolves the step.
    expect(poweredQueries).toBe(1)
    expect(next?.['position']).toEqual({ x: 0, y: 64, z: 0 })
  })

  it('falls back to unpowered when no isPoweredRailAt hook is provided', async () => {
    const vehicle = {
      id: VehicleId('v:no-power-hook'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      // Deliberately far beyond a realistic minecart speed: braking (rather
      // than the powered acceleration) cuts it to a fifth, and that reduced
      // speed still needs to reach the block one cell away within a single
      // (dt-clamped) frame, so the collision-resolved re-step also runs.
      velocity: { x: 50, y: 0, z: 0 },
      yawRadians: 0,
    }
    let next: Record<string, unknown> | undefined
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: (_id: VehicleId, state: Record<string, unknown>) => Effect.sync(() => { next = state }),
    } as unknown as VehicleServiceApi
    const stone = Option.getOrThrow(blockIdOf('stone'))
    const poweredRail = Option.getOrThrow(blockIdOf('powered_rail'))
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : position.x === 0 && position.y === 64 && position.z === 0
            ? { _tag: 'Block' as const, block: poweredRail }
            : { _tag: 'Block' as const, block: AIR },
      ),
    } as unknown as ChunkStoreApi

    await Effect.runPromise(advanceVehicles(store, service, 0.1))

    // Braked (not accelerated) despite standing on a powered rail, because no
    // `isPoweredRailAt` hook means the track can never be reported "powered".
    const velocity = next?.['velocity'] as { x: number; y: number; z: number }
    expect(velocity.x).toBeCloseTo(2)
    expect(velocity.y).toBe(0)
    expect(velocity.z).toBe(0)
  })

  it('records malformed delta time per active vehicle without reading terrain or updating state', async () => {
    const vehicle = {
      id: VehicleId('v:frozen'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    let updateCount = 0
    const inactive = { ...vehicle, id: VehicleId('v:inactive'), dimension: 'nether' as const }
    const service = {
      vehicles: Effect.succeed([vehicle, inactive]),
      updateState: () => Effect.sync(() => {
        updateCount += 1
      }),
    } as unknown as VehicleServiceApi
    let reads = 0
    const store = {
      getBlock: () => Effect.sync(() => {
        reads += 1
        return { _tag: 'OutOfWorld' as const }
      }),
    } as unknown as ChunkStoreApi

    const results = await Promise.all([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.05]
      .map((dt) => Effect.runPromise(advanceVehicles(store, service, dt, {
        isActiveDimension: (dimension) => dimension === 'overworld',
      }))))
    for (const result of results) {
      expect(result).toStrictEqual([{
        _tag: 'VehicleMotionFailure', vehicleId: vehicle.id,
        failure: { _tag: 'InvalidVehicleDeltaTime' },
      }])
    }

    expect(updateCount).toBe(0)
    expect(reads).toBe(0)
  })
})
