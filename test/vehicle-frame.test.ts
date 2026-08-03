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
})
