import type { StageRegistration } from '@nerima-games/mc-kernel'
import { WorldCommitCoordinator, type DomainEventBus } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import { makeGameplayFrameStateForOwner } from './registration-core.js'
import type { ChunkStore, EntityManager, GameplayFrameState, TimeService } from './registration-core.js'
import { GameplayBlockStateWorld } from './gameplay-block-state-world.js'
import { makeGameplayStagesWithState } from './gameplay-stage-composition.js'
import { GAMEPLAY_VITALS_OWNER_ID } from './gameplay-owner-registrations.js'

export type GameplayComposition = Readonly<{
  state: GameplayFrameState
  stages: ReadonlyArray<StageRegistration>
}>

/**
 * Build the module's state and its stages together.
 *
 * `makeGameplayStages` in `stages/registration.ts` keeps only the stages. The
 * stage list itself, and the `MobBehaviour` caveat that comes with it, live in
 * `stages/gameplay-stage-composition.ts`.
 */
export const makeGameplayComposition: Effect.Effect<
  GameplayComposition,
  never,
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus | GameplayBlockStateWorld
> = Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const blockStateWorld = yield* GameplayBlockStateWorld
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const stages = yield* makeGameplayStagesWithState(state, blockStateWorld)
  return { state, stages }
})
