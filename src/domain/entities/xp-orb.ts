import { Brand, Effect, Result, Schema } from 'effect'
import {
  DomainEventSchema,
  EntityIdSchema,
  ExperienceAmountSchema,
  SimulationTickSchema,
  WorldPositionSchema,
  type DomainEvent,
} from '@nerima-games/mc-kernel'
import {
  ExperienceDelta,
  experienceLevel,
  type VitalsServiceApi,
} from '@nerima-games/mc-sim'

export const ExperienceOrbValueSchema: typeof ExperienceAmountSchema = ExperienceAmountSchema
export type ExperienceOrbValue = Schema.Schema.Type<typeof ExperienceOrbValueSchema>

export const ExperienceOrbAbsorptionSchema: Schema.ConstraintDecoder<ReadonlyArray<DomainEvent>> =
  Schema.Array(DomainEventSchema)
export type ExperienceOrbAbsorption = Schema.Schema.Type<typeof ExperienceOrbAbsorptionSchema>

export type ExperienceOrbAbsorptionContext = Readonly<{
  actor: Schema.Codec.Encoded<typeof EntityIdSchema>
  orb: Schema.Codec.Encoded<typeof EntityIdSchema>
  tick: Schema.Codec.Encoded<typeof SimulationTickSchema>
  position: Schema.Codec.Encoded<typeof WorldPositionSchema>
}>

export const createExperienceOrbValue = (
  value: number,
): Result.Result<ExperienceOrbValue, Schema.SchemaError> =>
  Schema.decodeUnknownResult(ExperienceOrbValueSchema)(value)

export const absorbExperienceOrb: (
  vitals: VitalsServiceApi,
  experience: ExperienceOrbValue,
  context: ExperienceOrbAbsorptionContext,
) => Effect.Effect<ExperienceOrbAbsorption, Brand.BrandError | Schema.SchemaError> = (
  vitals,
  experience,
  context,
) =>
  Effect.gen(function* () {
    const experienceValue = yield* Schema.decodeUnknownEffect(ExperienceOrbValueSchema)(experience)
    const position = yield* Schema.decodeUnknownEffect(WorldPositionSchema)(context.position)
    const before = yield* vitals.snapshot
    const collectedEvent = yield* Schema.decodeUnknownEffect(DomainEventSchema)({
      _tag: 'ExperienceCollected',
      tick: context.tick,
      player: context.actor,
      orb: context.orb,
      amount: experienceValue,
    })
    const delta = yield* Effect.fromResult(ExperienceDelta.result(experienceValue))
    const after = yield* vitals.addExperience(delta)
    const events: Array<DomainEvent> = [collectedEvent]
    const levelBefore = experienceLevel(before)
    const levelAfter = experienceLevel(after)

    if (levelAfter > levelBefore) {
      const levelUpEvent = yield* Schema.decodeUnknownEffect(DomainEventSchema)({
        _tag: 'LevelUp',
        tick: context.tick,
        entity: context.actor,
        position,
        level: levelAfter,
      })
      events.push(levelUpEvent)
    }

    return yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionSchema)(events)
  })
