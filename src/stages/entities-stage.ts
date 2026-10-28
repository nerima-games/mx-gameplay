import {
  Effect,
  GAMEPLAY_STAGE_IDS,
  Ref,
  Result,
  applyFallingBlocks,
  recordGameplayUnsupportedOperation,
  settled,
  takeBatch,
} from './registration-core.js'
import { pickupDroppedItemsCommitted } from '../domain/entities/dropped-item.js'
import { absorbExperienceOrb } from '../domain/entities/xp-orb.js'
import type {
  DroppedItemPickupExecution,
  ExperienceOrbAbsorptionExecution,
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeEntitiesStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, options, commit } = context
  return {
    id: GAMEPLAY_STAGE_IDS.entities,
    after: [GAMEPLAY_STAGE_IDS.survivalHunger],
    // Owner-backed item pickup and XP absorption run here before the deferred
    // falling-block work. Mob simulation remains Unsupported until mc-sim can
    // return plan fragments that join roster and world changes atomically.
    run: () =>
      Effect.orDie(Effect.gen(function* () {
        const pickupRequests = yield* Ref.getAndSet(state.pendingDroppedItemPickups, [])
        const pickupExecutions: Array<DroppedItemPickupExecution> = []
        for (const request of pickupRequests) {
          if (commit === undefined) {
            pickupExecutions.push({
              request,
              outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' },
            } as const)
            continue
          }
          if (commit.playerStorageOwnerId === undefined || commit.droppedItemsOwnerId === undefined) {
            pickupExecutions.push({
              request,
              outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' },
            } as const)
            continue
          }
          const result = yield* Effect.result(pickupDroppedItemsCommitted(
            commit.coordinator,
            {
              playerStorage: commit.playerStorageOwnerId,
              droppedItems: commit.droppedItemsOwnerId,
            },
            request,
          ))
          pickupExecutions.push(
            Result.isFailure(result)
              ? { request, outcome: { _tag: 'Failed', error: result.failure } as const }
              : { request, outcome: { _tag: 'Completed', result: result.success } as const },
          )
        }
        if (pickupExecutions.length > 0) {
          yield* Ref.update(state.droppedItemPickupExecutions, (items) => [
            ...items,
            ...pickupExecutions,
          ])
        }

        const absorptionRequests = yield* Ref.getAndSet(state.pendingExperienceOrbAbsorptions, [])
        const absorptionExecutions: Array<ExperienceOrbAbsorptionExecution> = []
        for (const request of absorptionRequests) {
          if (commit === undefined) {
            absorptionExecutions.push({
              request,
              outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' },
            } as const)
            continue
          }
          if (commit.vitalsOwnerId === undefined || commit.experienceOrbsOwnerId === undefined) {
            absorptionExecutions.push({
              request,
              outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' },
            } as const)
            continue
          }
          const result = yield* Effect.result(absorbExperienceOrb(
            commit.coordinator,
            {
              vitals: commit.vitalsOwnerId,
              orbs: commit.experienceOrbsOwnerId,
            },
            request,
          ))
          absorptionExecutions.push(
            Result.isFailure(result)
              ? { request, outcome: { _tag: 'Failed', error: result.failure } as const }
              : { request, outcome: { _tag: 'Completed', result: result.success } as const },
          )
        }
        if (absorptionExecutions.length > 0) {
          yield* Ref.update(state.experienceOrbAbsorptionExecutions, (items) => [
            ...items,
            ...absorptionExecutions,
          ])
        }

        if (options.mobSimulation !== false) {
          yield* recordGameplayUnsupportedOperation(state, {
            _tag: 'Unsupported',
            action: 'MobSimulation',
            reason: commit === undefined
              ? 'WorldCommitCoordinatorUnavailable'
              : 'McSimPlanFragmentUnavailable',
          })
        }

        // ---- falling blocks ------------------------------------------------
        //
        // `Ref.modify` rather than get-then-set: plan.md §3.8 lists TOCTOU on a
        // Ref among the reference's recurring Effect-level mistakes.
        // Read-modify-write as two steps is a race the moment anything else
        // forks — and something else always does, because `disturb` is called
        // by every rule that writes a block, including the crater above.
        const batch = yield* Ref.modify(state.fallingBlocks, (queue) => {
          const { batch: taken, rest } = takeBatch(queue)
          return [taken, rest] as const
        })

        // An idle tick stops HERE, without touching the store. This is the
        // whole of DN-GP-1: the reference implementation read ~7M blocks at
        // this point whether or not anything had moved. The mob half above is
        // held to the same standard by the same test — an idle frame's sweep
        // returns the roster it was given, hands every mob the SAME step object,
        // and makes no store call at all.
        if (batch.length === 0) {
          return
        }

        const { destinations } = yield* applyFallingBlocks(store, batch)

        // `update`, not `set`: the store writes above may have caused other
        // rules to disturb positions while this tick was running, and a `set`
        // would erase them.
        if (destinations.length > 0) {
          yield* Ref.update(state.fallingBlocks, (queue) => settled(queue, destinations))
        }
      })),
  }
}
