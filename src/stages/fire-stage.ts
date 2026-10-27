import {
  GAMEPLAY_STAGE_IDS,
  stepFireLifecycle,
} from './registration-core.js'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeFireStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, roster, inventory, player } = context
  return {
    id: GAMEPLAY_STAGE_IDS.fire,
    after: [GAMEPLAY_STAGE_IDS.interactions],
    run: (dt) => stepFireLifecycle(state, store, roster, inventory, player, dt),
  }
}
