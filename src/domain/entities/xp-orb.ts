import { Brand, Effect, Result, Schema, SchemaParser } from 'effect'
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
  ReplicatedOwnerIdSchema,
  WorldRevisionConflict,
  addExperience,
  experienceLevel,
  type ReplicatedOwnerId,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
  type Vitals,
  VitalsSchema,
} from '@nerima-games/mc-sim'

const strictCodec = <A, I>(schema: Schema.Codec<A, I>): Schema.Codec<A, I> =>
  Schema.declareConstructor<A, I>()([schema], ([inner]) =>
    (input, _ast, options) =>
      SchemaParser.decodeUnknownEffect(inner)(input, {
        ...options,
        onExcessProperty: 'error',
      }),
  )

const isSingleElement = <A>(values: ReadonlyArray<A>): values is readonly [A] => values.length === 1

export const ExperienceOrbValueSchema: typeof ExperienceAmountSchema = ExperienceAmountSchema
export type ExperienceOrbValue = Schema.Schema.Type<typeof ExperienceOrbValueSchema>

export const ExperienceOrbAbsorptionSchema: Schema.ConstraintDecoder<ReadonlyArray<DomainEvent>> =
  Schema.Array(DomainEventSchema)
export type ExperienceOrbAbsorption = Schema.Schema.Type<typeof ExperienceOrbAbsorptionSchema>

const ExperienceOrbAbsorptionContextSchema: Schema.Codec<
  DecodedExperienceOrbAbsorptionContext,
  ExperienceOrbAbsorptionContext
> = strictCodec(
  Schema.Struct({
    actor: EntityIdSchema,
    orb: EntityIdSchema,
    tick: SimulationTickSchema,
    position: WorldPositionSchema,
  }),
)

export type ExperienceOrbAbsorptionContext = Readonly<{
  actor: Schema.Codec.Encoded<typeof EntityIdSchema>
  orb: Schema.Codec.Encoded<typeof EntityIdSchema>
  tick: Schema.Codec.Encoded<typeof SimulationTickSchema>
  position: Schema.Codec.Encoded<typeof WorldPositionSchema>
}>
type DecodedExperienceOrbAbsorptionContext = Readonly<{
  actor: Schema.Schema.Type<typeof EntityIdSchema>
  orb: Schema.Schema.Type<typeof EntityIdSchema>
  tick: Schema.Schema.Type<typeof SimulationTickSchema>
  position: Schema.Schema.Type<typeof WorldPositionSchema>
}>

export type ExperienceOrbAbsorptionOwners = Readonly<{
  vitals: ReplicatedOwnerId
  orbs: ReplicatedOwnerId
}>

export type ExperienceOrbVitalsOwnerSnapshot = Readonly<{ vitals: Vitals }>
const vitalsCodec = Schema.revealCodec(VitalsSchema as Schema.Codec<Vitals, unknown>)
const strictVitalsCodec: Schema.Codec<Vitals, unknown> =
  Schema.declareConstructor<Vitals, unknown>()(
    [],
    () => (input, _ast, options) =>
      SchemaParser.decodeUnknownEffect(vitalsCodec)(input, {
        ...options,
        onExcessProperty: 'error',
      }),
  )
export const ExperienceOrbVitalsOwnerSnapshotSchema: Schema.Codec<
  ExperienceOrbVitalsOwnerSnapshot,
  unknown
> = strictCodec(
  Schema.Struct({
    vitals: strictVitalsCodec,
  }),
)

export type ExperienceOrbRecord = Readonly<{
  id: Schema.Schema.Type<typeof EntityIdSchema>
  value: ExperienceOrbValue
}>
const ExperienceOrbRecordSchema = strictCodec(
  Schema.Struct({
    id: EntityIdSchema,
    value: ExperienceOrbValueSchema,
  }),
)

export type ExperienceOrbOwnerSnapshot = Readonly<{ orbs: ReadonlyArray<ExperienceOrbRecord> }>
export const ExperienceOrbOwnerSnapshotSchema: Schema.Codec<
  ExperienceOrbOwnerSnapshot,
  unknown
> = strictCodec(
  Schema.Struct({
    orbs: Schema.Array(ExperienceOrbRecordSchema),
  }),
)

export type ExperienceOrbAbsorptionFailure = Readonly<{
  _tag: 'ExperienceOrbUnavailable'
  orb: Schema.Schema.Type<typeof EntityIdSchema>
  reason: 'missing-orb' | 'duplicate-orb-id'
}>
export const ExperienceOrbAbsorptionFailureSchema: Schema.Codec<
  ExperienceOrbAbsorptionFailure,
  unknown
> = strictCodec(
  Schema.Struct({
    _tag: Schema.Literal('ExperienceOrbUnavailable'),
    orb: EntityIdSchema,
    reason: Schema.Literals(['missing-orb', 'duplicate-orb-id']),
  }),
)

export type ExperienceOrbAbsorptionCommitResultInvalid = Readonly<{
  _tag: 'ExperienceOrbAbsorptionCommitResultInvalid'
  reason: 'missing-owner-change' | 'orb-not-consumed'
  owners: ReadonlyArray<ReplicatedOwnerId>
}>
export const ExperienceOrbAbsorptionCommitResultInvalidSchema: Schema.Codec<
  ExperienceOrbAbsorptionCommitResultInvalid,
  unknown
> = strictCodec(
  Schema.Struct({
    _tag: Schema.Literal('ExperienceOrbAbsorptionCommitResultInvalid'),
    reason: Schema.Literals(['missing-owner-change', 'orb-not-consumed']),
    owners: Schema.Array(ReplicatedOwnerIdSchema),
  }),
)

export const vitalsOwnerRegistration = (
  ownerId: ReplicatedOwnerId,
  initialState: ExperienceOrbVitalsOwnerSnapshot,
): ReplicatedOwnerRegistration<typeof ExperienceOrbVitalsOwnerSnapshotSchema> => ({
  ownerId,
  schema: ExperienceOrbVitalsOwnerSnapshotSchema,
  initialState,
})

export const experienceOrbOwnerRegistration = (
  ownerId: ReplicatedOwnerId,
  initialState: ExperienceOrbOwnerSnapshot = { orbs: [] },
): ReplicatedOwnerRegistration<typeof ExperienceOrbOwnerSnapshotSchema> => ({
  ownerId,
  schema: ExperienceOrbOwnerSnapshotSchema,
  initialState,
})

export const createExperienceOrbValue = (
  value: number,
): Result.Result<ExperienceOrbValue, Schema.SchemaError> =>
  Schema.decodeUnknownResult(ExperienceOrbValueSchema)(value)

export type ExperienceOrbAbsorptionError =
  | Brand.BrandError
  | ExperienceOrbAbsorptionFailure
  | ExperienceOrbAbsorptionCommitResultInvalid
  | Schema.SchemaError
  | WorldCommitCoordinatorError

/**
 * Commits against host-registered WCC owners. This does not synchronize the
 * existing VitalsService or EntityManager Ref state.
 */
export const absorbExperienceOrb: (
  coordinator: WorldCommitCoordinatorApi,
  owners: ExperienceOrbAbsorptionOwners,
  context: ExperienceOrbAbsorptionContext,
) => Effect.Effect<
  ExperienceOrbAbsorption,
  ExperienceOrbAbsorptionError
> = (coordinator, owners, context) =>
  Effect.gen(function* () {
    const decodedContext = yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionContextSchema)(context)
    const vitalsSnapshot = yield* coordinator.snapshot(
      owners.vitals,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    )
    const orbsSnapshot = yield* coordinator.snapshot(
      owners.orbs,
      ExperienceOrbOwnerSnapshotSchema,
    )

    if (vitalsSnapshot.revision !== orbsSnapshot.revision) {
      return yield* Effect.fail(new WorldRevisionConflict({
        expected: vitalsSnapshot.revision,
        actual: orbsSnapshot.revision,
      }))
    }

    const matchingOrbs = orbsSnapshot.state.orbs.filter(({ id }) => id === decodedContext.orb)
    if (!isSingleElement(matchingOrbs)) {
      const failure = yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionFailureSchema)({
        _tag: 'ExperienceOrbUnavailable',
        orb: decodedContext.orb,
        reason: matchingOrbs.length === 0 ? 'missing-orb' : 'duplicate-orb-id',
      })
      return yield* Effect.fail(failure)
    }

    const [orb] = matchingOrbs

    const experience = yield* Schema.decodeUnknownEffect(ExperienceOrbValueSchema)(orb.value)
    const experienceDelta = yield* Effect.fromResult(ExperienceDelta.result(experience))
    const before = vitalsSnapshot.state.vitals
    const after = addExperience(before, experienceDelta)
    const levelBefore = experienceLevel(before)
    const nextOrbs: ExperienceOrbOwnerSnapshot = {
      orbs: orbsSnapshot.state.orbs.filter(({ id }) => id !== decodedContext.orb),
    }

    const delta = yield* coordinator.commit({
      expectedRevision: vitalsSnapshot.revision,
      expectedDimensions: [],
      changes: [
        { ownerId: owners.vitals, state: { vitals: after } },
        { ownerId: owners.orbs, state: nextOrbs },
      ],
    })
    const committedVitalsChange = delta.changes.find(({ owner }) => owner === owners.vitals)
    const committedOrbChange = delta.changes.find(({ owner }) => owner === owners.orbs)
    if (committedVitalsChange === undefined || committedOrbChange === undefined) {
      const failure = yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionCommitResultInvalidSchema)({
        _tag: 'ExperienceOrbAbsorptionCommitResultInvalid',
        reason: 'missing-owner-change',
        owners: [
          ...(committedVitalsChange === undefined ? [owners.vitals] : []),
          ...(committedOrbChange === undefined ? [owners.orbs] : []),
        ],
      })
      return yield* Effect.fail(failure)
    }

    const committedVitals = yield* Schema.decodeUnknownEffect(
      ExperienceOrbVitalsOwnerSnapshotSchema,
    )(committedVitalsChange.state)
    const committedOrbs = yield* Schema.decodeUnknownEffect(
      ExperienceOrbOwnerSnapshotSchema,
    )(committedOrbChange.state)
    const committedLevel = experienceLevel(committedVitals.vitals)
    if (committedOrbs.orbs.some(({ id }) => id === decodedContext.orb)) {
      const failure = yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionCommitResultInvalidSchema)({
        _tag: 'ExperienceOrbAbsorptionCommitResultInvalid',
        reason: 'orb-not-consumed',
        owners: [owners.orbs],
      })
      return yield* Effect.fail(failure)
    }

    const events: Array<DomainEvent> = [
      yield* Schema.decodeUnknownEffect(DomainEventSchema)({
        _tag: 'ExperienceCollected',
        tick: decodedContext.tick,
        player: decodedContext.actor,
        orb: decodedContext.orb,
        amount: experience,
      }),
    ]

    if (committedLevel > levelBefore) {
      events.push(yield* Schema.decodeUnknownEffect(DomainEventSchema)({
        _tag: 'LevelUp',
        tick: decodedContext.tick,
        entity: decodedContext.actor,
        position: decodedContext.position,
        level: committedLevel,
      }))
    }

    return yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionSchema)(events)
  })
