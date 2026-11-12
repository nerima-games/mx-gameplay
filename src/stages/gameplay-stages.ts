import type { StageRegistration } from '@nerima-games/mc-kernel'
import { makeVehiclesStage } from './vehicles-stage.js'
import { makeInteractionsStage } from './interactions-stage.js'
import { makeFireStage } from './fire-stage.js'
import { makeSurvivalHungerStage } from './survival-hunger-stage.js'
import { makeEntitiesStage } from './entities-stage.js'
import { makeEnderDragonStage } from './ender-dragon-stage.js'
import { makeFluidsStage } from './fluids-stage.js'
import { makeTimeWeatherStage } from './time-weather-stage.js'
import type {
  EntityManagerApi,
  GameplayFrameState,
  GameplayStageCommitServices,
  GameplayStageContext,
  GameplayStageOptions,
  InventoryServiceApi,
  MobBehaviour,
  PlayerServiceApi,
  TimeServiceApi,
  VehicleFrameEnvironment,
  VehicleServiceApi,
  ChunkStoreApi,
} from './registration-core.js'

export const gameplayStages = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  _inventory: InventoryServiceApi | undefined,
  _player: PlayerServiceApi | undefined,
  time: TimeServiceApi,
  vehicleService?: VehicleServiceApi,
  vehicleEnvironment?: VehicleFrameEnvironment,
  options: GameplayStageOptions = {},
  commit?: GameplayStageCommitServices,
): ReadonlyArray<StageRegistration> => {
  const context: GameplayStageContext = {
    state,
    store,
    roster,
    time,
    vehicleService,
    vehicleEnvironment,
    options,
    commit,
  }
  return [
    makeVehiclesStage(context),
    makeInteractionsStage(context),
    makeFireStage(context),
    makeSurvivalHungerStage(context),
    makeEntitiesStage(context),
    makeEnderDragonStage(context),
    makeFluidsStage(context),
    makeTimeWeatherStage(context),
  ]
}
