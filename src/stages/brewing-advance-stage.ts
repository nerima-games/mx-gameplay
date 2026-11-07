import { Effect, Ref, Result, Schema } from 'effect'
import type { StageRegistration } from '@nerima-games/mc-kernel'
import {
  BrewingElapsedSecsSchema,
  WorldCommitCoordinator,
  type BrewingOutcome,
  type BrewingServiceApi,
  type BrewingServiceError,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { BREWING_ADVANCE_STAGE_ID, GAMEPLAY_STAGE_IDS } from './stage-ids.js'

const BrewingAdvanceRequestSchema = Schema.Struct({
  requestId: Schema.String,
  elapsedSecs: BrewingElapsedSecsSchema,
})

type BrewingAdvanceRequest = Schema.Schema.Type<typeof BrewingAdvanceRequestSchema>

export type BrewingAdvanceExecution = Readonly<{
  readonly requestId: string
  readonly result: Result.Result<BrewingOutcome, BrewingServiceError>
}>

export type BrewingAdvanceStageApi = Readonly<{
  readonly stage: StageRegistration
  /** Replaces the automatic frame delta for a frame when one or more requests are queued. */
  readonly requestAdvance: (requestId: string, elapsedSecs: number) => Effect.Effect<void, Schema.SchemaError>
  readonly drainResults: Effect.Effect<ReadonlyArray<BrewingAdvanceExecution>>
}>

/** Advance brewing after interactions, using queued elapsed time only when explicitly requested. */
export const makeBrewingAdvanceStage = (
  brewingService: BrewingServiceApi,
  coordinator: WorldCommitCoordinatorApi,
): Effect.Effect<BrewingAdvanceStageApi> =>
  Effect.gen(function* () {
    const pending = yield* Ref.make<ReadonlyArray<BrewingAdvanceRequest>>([])
    const results = yield* Ref.make<ReadonlyArray<BrewingAdvanceExecution>>([])
    const stage: StageRegistration = {
      id: BREWING_ADVANCE_STAGE_ID,
      after: [GAMEPLAY_STAGE_IDS.interactions],
      run: (dt) => Effect.gen(function* () {
        const requests = yield* Ref.getAndSet(pending, [])
        if (requests.length === 0) {
          yield* Effect.orDie(
            brewingService.advance(dt).pipe(
              Effect.provideService(WorldCommitCoordinator, coordinator),
            ),
          )
          return
        }

        const executions: Array<BrewingAdvanceExecution> = []
        for (const request of requests) {
          const result = yield* Effect.result(
            brewingService.advance(request.elapsedSecs).pipe(
              Effect.provideService(WorldCommitCoordinator, coordinator),
            ),
          )
          executions.push({ requestId: request.requestId, result })
        }
        yield* Ref.update(results, (current) => [...current, ...executions])
      }),
    }

    return {
      stage,
      requestAdvance: (requestId, elapsedSecs) =>
        Schema.decodeUnknownEffect(BrewingAdvanceRequestSchema)({ requestId, elapsedSecs }).pipe(
          Effect.flatMap((request) => Ref.update(pending, (current) => [...current, request])),
        ),
      drainResults: Ref.getAndSet(results, []),
    }
  })
