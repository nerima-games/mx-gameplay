import {
  Effect,
  GAMEPLAY_STAGE_IDS,
  LAVA_TICK_INTERVAL,
  Ref,
  carryOver,
  enqueueFluidDisturbance,
  fluidRuntimeSemaphoreFor,
  fluidRuntimeStateFor,
  runFluidPropagation,
  splitBudget,
} from './registration-core.js'
import type {
  FluidWorkItem,
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

export const makeFluidsStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, player, commit } = context
  return {
    id: GAMEPLAY_STAGE_IDS.fluids,
    after: [GAMEPLAY_STAGE_IDS.enderDragon],
    run: () =>
      Effect.gen(function* () {
        const runtime = yield* fluidRuntimeStateFor(state.fluidFrontier)
        const semaphore = yield* fluidRuntimeSemaphoreFor(state.fluidFrontier)
        if (commit === undefined) return
        yield* semaphore.withPermits(1)(
          Effect.gen(function* () {
            const tick = yield* Ref.updateAndGet(state.tickCount, (value) => value + 1)
            const lavaTickActive = tick % LAVA_TICK_INTERVAL === 0
            const work = yield* Ref.modify(runtime, (fluidState) => {
              let uniqueFrontier: ReadonlyArray<FluidWorkItem> = []
              for (const item of fluidState.frontier) {
                uniqueFrontier = enqueueFluidDisturbance(uniqueFrontier, item)
              }
              const split = splitBudget(uniqueFrontier, { lavaTickActive })
              return [
                split.work,
                {
                  ...fluidState,
                  // Reserve work before asynchronous store access. New
                  // disturbances can append to the remaining frontier.
                  frontier: carryOver(uniqueFrontier, split),
                },
              ] as const
            })

            if (work.length === 0) return

            const dimension = yield* player.dimension
            yield* runFluidPropagation(store, runtime, work, {
              coordinator: commit.coordinator,
              dimension,
              changes: [],
            })
          }),
        )
      }),
  }
}
