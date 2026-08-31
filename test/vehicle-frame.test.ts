import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { VehicleId, type VehicleServiceApi } from '@nerima-games/mc-sim'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
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

  it('swallows a per-vehicle update failure rather than failing the whole frame', async () => {
    // Every other test's `updateState` succeeds, so the `Effect.catchAll(() =>
    // Effect.void)` at the end of the per-vehicle pipe had never actually
    // caught anything — one bad vehicle write must not stop the rest of the
    // frame, or a roster of ten carts becomes a roster of one bad write away
    // from none moving at all.
    const vehicle = {
      id: VehicleId('v:broken'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    const service = {
      vehicles: Effect.succeed([vehicle]),
      updateState: () => Effect.fail({ _tag: 'VehicleNotFound' as const, id: vehicle.id }),
    } as unknown as VehicleServiceApi
    const store = {
      getBlock: () => Effect.succeed({ _tag: 'OutOfWorld' as const }),
    } as unknown as ChunkStoreApi

    const result = await Effect.runPromiseExit(advanceVehicles(store, service, 1))

    expect(Exit.isSuccess(result)).toBe(true)
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
    const stone = blockIdOf('stone')!
    const store = {
      getBlock: (position: { x: number; y: number; z: number }) => Effect.succeed(
        position.x === 1 && position.y === 64 && position.z === 0
          ? { _tag: 'Block' as const, block: stone }
          : { _tag: 'OutOfWorld' as const },
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
