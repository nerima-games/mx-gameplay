import {
  Effect,
  GAMEPLAY_STAGE_IDS,
} from './registration-core.js'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeEnderDragonStage = (context: GameplayStageContext): StageRegistration => {
  const { state, player } = context
  return {
    id: GAMEPLAY_STAGE_IDS.enderDragon,
    after: [GAMEPLAY_STAGE_IDS.entities],
    run: (dt) =>
      Effect.flatMap(player.dimension, (dimension) =>
        dimension === 'end' ? state.enderDragonEncounter.stage.run(dt) : Effect.void,
      ),
  }
}
