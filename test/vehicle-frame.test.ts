import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
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
})
