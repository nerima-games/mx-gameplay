import { Effect, Ref } from 'effect'
import { describe, expect, it } from 'vitest'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { VehicleId, makeTimeService, type VehicleServiceApi } from '@nerima-games/mc-sim'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { gameplayStages } from '../src/stages/registration.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import { makeGameplayFrameState } from '../src/stages/registration-core.js'
import { FrameServicesLayer } from './support/frame-services.js'
import { makeEntityManagerDouble } from './support/entity-manager-double.js'
import { makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { world } from './support/chunk-store-double.js'

describe('vehicles stage fault recording', () => {
  it('records a typed WorldCommit vehicle failure and retains it after a successful later tick', async () => {
    const vehicle = {
      id: VehicleId('test:broken-minecart'),
      type: 'minecart' as const,
      dimension: 'overworld' as const,
      position: { x: 0, y: 64, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      yawRadians: 0,
    }
    const failure = { _tag: 'VehicleOperationError' as const, reason: 'not-found' as const }
    let rejectUpdate = true
    let updateAttempts = 0
    const vehicleService = {
      vehicles: Effect.succeed([vehicle]),
      updateState: () => {
        updateAttempts += 1
        return rejectUpdate ? Effect.fail(failure) : Effect.void
      },
    } as unknown as VehicleServiceApi
    const state = await Effect.runPromise(makeGameplayFrameState)
    const store = await Effect.runPromise(makeTransactionalChunkStoreDouble(world([]), ['0,0']))
    const roster = await Effect.runPromise(makeEntityManagerDouble<MobBehaviour>())
    const time = await Effect.runPromise(makeTimeService())
    const stage = gameplayStages(
      state,
      store.api,
      roster.api,
      undefined,
      undefined,
      time,
      vehicleService,
    ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.vehicles)

    if (stage === undefined) throw new Error('vehicles stage was not registered')
    const firstExit = await Effect.runPromiseExit(stage.run(DeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)))

    expect(firstExit._tag).toBe('Success')
    expect(updateAttempts).toBe(1)
    expect(await Effect.runPromise(Ref.get(state.operationFailures))).toStrictEqual([{
      _tag: 'Failed',
      operation: 'WorldCommit',
      subject: 'Vehicle',
      error: failure,
    }])

    rejectUpdate = false
    const retryExit = await Effect.runPromiseExit(stage.run(DeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)))

    expect(retryExit._tag).toBe('Success')
    expect(updateAttempts).toBe(2)
    expect(await Effect.runPromise(Ref.get(state.operationFailures))).toStrictEqual([{
      _tag: 'Failed',
      operation: 'WorldCommit',
      subject: 'Vehicle',
      error: failure,
    }])
  })
})
