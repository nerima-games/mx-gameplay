import {
  Effect,
  GAMEPLAY_STAGE_IDS,
  gameplayPlayerStateForStage,
} from './registration-core.js'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeEnderDragonStage = (context: GameplayStageContext): StageRegistration => {
  const { state, commit } = context
  return {
    id: GAMEPLAY_STAGE_IDS.enderDragon,
    after: [GAMEPLAY_STAGE_IDS.entities],
    run: (dt) => Effect.gen(function* () {
      const playerState = yield* gameplayPlayerStateForStage(state, commit)
      if (playerState?.pose.feetPosition.dimension === 'end') {
        yield* state.enderDragonEncounter.stage.run(dt)
      }
    }),
  }
}
