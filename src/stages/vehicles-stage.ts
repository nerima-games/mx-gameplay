import {
  Effect,
  GAMEPLAY_STAGE_IDS,
  UPSTREAM_STAGE_IDS,
  advanceVehicles,
  recordGameplayEntityWorldDataFault,
  recordGameplayStageFailure,
} from './registration-core.js'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeVehiclesStage = (context: GameplayStageContext): StageRegistration => {
  const { store, vehicleService, vehicleEnvironment } = context
  const runVehicles = (dt: Parameters<StageRegistration['run']>[0]) => Effect.gen(function* () {
    if (vehicleService === undefined) return
    const failures = yield* advanceVehicles(store, vehicleService, dt, vehicleEnvironment)
    for (const failure of failures) {
      if (failure._tag === 'VehicleWorldDataFault') {
        yield* recordGameplayEntityWorldDataFault(context.state, 'VehicleMovement', failure.failure)
      } else {
        yield* recordGameplayStageFailure(context.state, {
          _tag: 'Failed', operation: 'WorldCommit', subject: 'Vehicle', error: failure.failure,
        })
      }
    }
  })
  return {
    id: GAMEPLAY_STAGE_IDS.vehicles,
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    run: runVehicles,
  }
}
