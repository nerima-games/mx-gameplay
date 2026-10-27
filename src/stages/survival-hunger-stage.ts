import {
  Effect,
  GAMEPLAY_STAGE_IDS,
} from './registration-core.js'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeSurvivalHungerStage = (context: GameplayStageContext): StageRegistration => {
  const { state } = context
  return {
    id: GAMEPLAY_STAGE_IDS.survivalHunger,
    after: [GAMEPLAY_STAGE_IDS.fire],
    run: (dt) => Effect.asVoid(state.survivalHunger.tick(dt)),
  }
}
