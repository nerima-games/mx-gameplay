import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { VehicleId, type VehicleServiceApi } from '@nerima-games/mc-sim'
import type { ChunkStoreApi } from '../src/domain/chunk-store-port'
import { advanceVehicles } from '../src/domain/vehicle/vehicle-frame'

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
      getBlock: () => Effect.succeed({ _tag: 'OutOfWorld' as const }),
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
    const water = blockIdOf('water')!
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'Block' as const, block: water }),
    } as unknown as ChunkStoreApi

    await Effect.runPromise(advanceVehicles(store, service, 0.05, {
      controlsForVehicle: () => ({ throttle: 1, steering: 0 }),
    }))

    expect(next?.['position']).toEqual({ x: 0, y: 64, z: -0.009000000000000001 })
    expect(next?.['occupant']).toBe('player:local')
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
    const stone = blockIdOf('stone')!
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : { _tag: 'OutOfWorld' as const },
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
    const stone = blockIdOf('stone')!
    const water = blockIdOf('water')!
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

  it('reads track power for both the free step and the collision-resolved re-step', async () => {
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
    const stone = blockIdOf('stone')!
    const poweredRail = blockIdOf('powered_rail')!
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : position.x === 0 && position.y === 64 && position.z === 0
            ? { _tag: 'Block' as const, block: poweredRail }
            : { _tag: 'OutOfWorld' as const },
      ),
    } as unknown as ChunkStoreApi
    let poweredQueries = 0

    await Effect.runPromise(advanceVehicles(store, service, 0.1, {
      isPoweredRailAt: () => {
        poweredQueries += 1
        return true
      },
    }))

    // Queried once building the track for the initial, uncollided step and once
    // more building the track the collision forces `stepVehicle` to re-run with.
    expect(poweredQueries).toBe(2)
    expect(next?.['position']).toEqual({ x: 0, y: 64, z: 0 })
  })

  it('falls back to unpowered on both steps when no isPoweredRailAt hook is provided', async () => {
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
    const stone = blockIdOf('stone')!
    const poweredRail = blockIdOf('powered_rail')!
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : position.x === 0 && position.y === 64 && position.z === 0
            ? { _tag: 'Block' as const, block: poweredRail }
            : { _tag: 'OutOfWorld' as const },
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

  it('treats a non-finite delta time as no elapsed time and performs no updates', async () => {
    const vehicle = {
      id: VehicleId('v:frozen'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
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

    await Effect.runPromise(advanceVehicles(store, service, Number.NaN))

    expect(updateCount).toBe(0)
  })
})
