import {
  Effect,
  GAMEPLAY_STAGE_IDS,
  recordGameplayStageFailure,
} from './registration-core.js'
import { Result } from 'effect'
import { WorldRevisionConflict } from '@nerima-games/mc-sim'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeSurvivalHungerStage = (context: GameplayStageContext): StageRegistration => {
  const { state } = context
  return {
    id: GAMEPLAY_STAGE_IDS.survivalHunger,
    after: [GAMEPLAY_STAGE_IDS.fire],
    run: (dt) =>
      Effect.gen(function* () {
        const tick = yield* Effect.result(state.survivalHunger.tick(dt))
        if (Result.isFailure(tick) && !(tick.failure instanceof WorldRevisionConflict)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed',
            operation: 'VitalsOperation',
            subject: 'Vitals',
            error: tick.failure,
          })
        }
      }),
  }
}
