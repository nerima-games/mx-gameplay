import {
  GAMEPLAY_STAGE_IDS,
  stepFireLifecycle,
} from './registration-core.js'
import { Effect } from 'effect'
import type {
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeFireStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, roster, inventory, player, commit } = context
  return {
    id: GAMEPLAY_STAGE_IDS.fire,
    after: [GAMEPLAY_STAGE_IDS.interactions],
    run: (dt) => {
      if (commit === undefined) return Effect.void
      return Effect.flatMap(player.dimension, (dimension) =>
        stepFireLifecycle(state, store, roster, inventory, player, dt, {
          coordinator: commit.coordinator,
          dimension,
          changes: [],
          playerStorageOwnerId: commit.playerStorageOwnerId,
        }),
      )
    },
  }
}
