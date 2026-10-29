import {
  GAMEPLAY_STAGE_IDS,
  gameplayPlayerStateForStage,
  stepFireLifecycle,
} from './registration-core.js'
import { Effect } from 'effect'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeFireStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, commit } = context
  return {
    id: GAMEPLAY_STAGE_IDS.fire,
    after: [GAMEPLAY_STAGE_IDS.interactions],
    run: (dt) => {
      if (commit === undefined) return Effect.void
      return Effect.gen(function* () {
        const playerState = yield* gameplayPlayerStateForStage(state, commit)
        if (playerState === undefined) return
        yield* stepFireLifecycle(state, store, playerState, dt, {
          coordinator: commit.coordinator,
          dimension: playerState.pose.feetPosition.dimension,
          playerStorageOwnerId: commit.playerStorageOwnerId,
          entitiesOwnerId: commit.entitiesOwnerId,
          droppedItemsOwnerId: commit.droppedItemsOwnerId,
        })
      })
    },
  }
}
