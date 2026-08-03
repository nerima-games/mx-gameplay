import { Effect, Ref } from 'effect'
import type { DeltaTimeSecs, StageRegistration } from '../domain/frame-contract'
import {
  advanceEnderDragonEncounter,
  damageEnderDragonByPlayer,
  decodeEnderDragonEncounterSnapshot,
  initialEnderDragonEncounter,
  type EnderDragonDamageResult,
  type EnderDragonEncounterEvent,
  type EnderDragonEncounterSnapshot,
} from '../domain/mob/ender-dragon-encounter'
import { GAMEPLAY_STAGE_IDS } from './stage-ids'

/** Stage id for the optional End-only dragon encounter. */
export const ENDER_DRAGON_STAGE_ID = GAMEPLAY_STAGE_IDS.enderDragon

type RuntimeState = {
  readonly encounter: EnderDragonEncounterSnapshot
  readonly events: ReadonlyArray<EnderDragonEncounterEvent>
}

export type EnderDragonEncounterStageApi = {
  readonly stage: StageRegistration
  readonly damageByPlayer: (damage: unknown) => Effect.Effect<EnderDragonDamageResult>
  readonly snapshot: Effect.Effect<EnderDragonEncounterSnapshot>
  readonly restore: (snapshot: unknown) => Effect.Effect<boolean>
  readonly drainEvents: Effect.Effect<ReadonlyArray<EnderDragonEncounterEvent>>
}

/** Allocate encounter state for a host that gates the stage by the active dimension. */
export const makeEnderDragonEncounterRuntime: Effect.Effect<EnderDragonEncounterStageApi> =
  Effect.gen(function* () {
    const runtime = yield* Ref.make<RuntimeState>({ encounter: initialEnderDragonEncounter(), events: [] })
    const stage: StageRegistration = {
      id: ENDER_DRAGON_STAGE_ID,
      after: [GAMEPLAY_STAGE_IDS.entities],
      run: (dt: DeltaTimeSecs) =>
        Ref.update(runtime, (current) => {
          const [encounter, events] = advanceEnderDragonEncounter(current.encounter, dt)
          return { encounter, events: [...current.events, ...events] }
        }),
    }

    return {
      stage,
      damageByPlayer: (damage) =>
        Ref.modify<RuntimeState, EnderDragonDamageResult>(runtime, (current) => {
          const result = damageEnderDragonByPlayer(current.encounter, damage)
          if (result._tag === 'Rejected') return [result, current]
          return [result, { encounter: result.state, events: [...current.events, ...result.events] }]
        }),
      snapshot: Effect.map(Ref.get(runtime), ({ encounter }) => ({ ...encounter })),
      restore: (input) => {
        const encounter = decodeEnderDragonEncounterSnapshot(input)
        return encounter === undefined
          ? Effect.succeed(false)
          : Effect.as(Ref.set(runtime, { encounter: { ...encounter }, events: [] }), true)
      },
      drainEvents: Ref.modify(runtime, (current) => [current.events, { ...current, events: [] }]),
    }
  })

/** The standalone encounter exists only in the End; other dimensions are rejected. */
export const makeEnderDragonEncounterStage = (
  dimension: unknown,
): Effect.Effect<EnderDragonEncounterStageApi | undefined> =>
  dimension === 'end' ? makeEnderDragonEncounterRuntime : Effect.succeed(undefined)
