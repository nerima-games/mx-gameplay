import {
  Effect,
  GAMEPLAY_STAGE_IDS,
  UPSTREAM_STAGE_IDS,
  advanceVehicles,
} from './registration-core.js'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeVehiclesStage = (context: GameplayStageContext): StageRegistration => {
  const { store, vehicleService, vehicleEnvironment } = context
  return {
    id: GAMEPLAY_STAGE_IDS.vehicles,
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    run: (dt: Parameters<StageRegistration['run']>[0]) =>
      vehicleService === undefined
        ? Effect.void
        : advanceVehicles(store, vehicleService, dt, vehicleEnvironment),
  }
}
