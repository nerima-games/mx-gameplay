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
import {
  MendingExperiencePointsSchema,
  type MendingExperiencePoints,
} from '../enchantment.js'
import {
  isExperienceOrbWithinAttractionRangeForPositions,
  isExperienceOrbWithinPickupRangeForPositions,
  pullExperienceOrbTowardPlayerForPositions,
} from './xp-orb-position.js'

export {
  EXPERIENCE_ORB_ATTRACTION_RADIUS_BLOCKS,
  EXPERIENCE_ORB_PICKUP_RADIUS_BLOCKS,
} from './xp-orb-position.js'

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

const ExperienceOrbRewardPointsSchema = MendingExperiencePointsSchema
const DeltaTimeSecsSchema = Schema.Finite
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('DeltaTimeSecs'))

/** Java Edition drops integer rewards as the largest fitting orb values first. */
const EXPERIENCE_ORB_VALUE_DENOMINATIONS = [
  2477,
  1237,
  617,
  307,
  149,
  73,
  37,
  17,
  7,
  3,
  1,
] as const
const asExperienceOrbValue = (value: number): ExperienceOrbValue => value as ExperienceOrbValue

export const EXPERIENCE_ORB_LIFETIME_TICKS = 6000
export const EXPERIENCE_ORB_PICKUP_INTERVAL_TICKS = 2

type SimulationTick = Schema.Schema.Type<typeof SimulationTickSchema>

export const hasExperienceOrbExpiredAtValidatedTick = (
  spawnedAt: SimulationTick | undefined,
  currentTick: SimulationTick,
): boolean =>
  spawnedAt !== undefined && currentTick >= spawnedAt &&
  currentTick - spawnedAt >= EXPERIENCE_ORB_LIFETIME_TICKS

export const canCollectExperienceOrbAtValidatedTick = (
  currentTick: SimulationTick,
  lastCollectedTick: SimulationTick | undefined,
): boolean => lastCollectedTick === undefined ||
  currentTick >= lastCollectedTick + EXPERIENCE_ORB_PICKUP_INTERVAL_TICKS

/** Splits a validated mob reward into vanilla orb values, largest first. */
export const splitExperienceOrbReward = (
  totalPoints: unknown,
): Result.Result<ReadonlyArray<ExperienceOrbValue>, Schema.SchemaError> => {
  const decoded = Schema.decodeUnknownResult(ExperienceOrbRewardPointsSchema)(totalPoints)
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure)

  let remaining: number = decoded.success
  const values: Array<ExperienceOrbValue> = []
  for (const denomination of EXPERIENCE_ORB_VALUE_DENOMINATIONS) {
    const count = Math.floor(remaining / denomination)
    for (let index = 0; index < count; index += 1) values.push(asExperienceOrbValue(denomination))
    remaining %= denomination
  }
  return Result.succeed(values)
}

export type ExperienceOrbMendingInput<Storage, Durability, Location extends string> = Readonly<{
  repairedStorage: Storage
  experienceRemaining: MendingExperiencePoints
  repairedDurability: Durability
  selectedLocation: Location
}>

export type ExperienceOrbMendingInvalid = Readonly<{
  _tag: 'ExperienceOrbMendingInvalid'
  reason: 'remaining-exceeds-orb-value'
  orbExperience: ExperienceOrbValue
  experienceRemaining: MendingExperiencePoints
}>

/** Validates the Mending remainder while carrying the stage's storage candidate forward. */
export const applyMendingRepair = <Storage, Durability, Location extends string>(
  orbExperience: unknown,
  repair: Readonly<{
    repairedStorage: Storage
    experienceRemaining: unknown
    repairedDurability: Durability
    selectedLocation: Location
  }>,
): Result.Result<
  ExperienceOrbMendingInput<Storage, Durability, Location>,
  Schema.SchemaError | ExperienceOrbMendingInvalid
> => {
  const decodedOrbExperience = Schema.decodeUnknownResult(ExperienceOrbValueSchema)(orbExperience)
  if (Result.isFailure(decodedOrbExperience)) return Result.fail(decodedOrbExperience.failure)
  const decodedRemaining = Schema.decodeUnknownResult(ExperienceOrbRewardPointsSchema)(
    repair.experienceRemaining,
  )
  if (Result.isFailure(decodedRemaining)) return Result.fail(decodedRemaining.failure)
  if (decodedRemaining.success > decodedOrbExperience.success) {
    return Result.fail({
      _tag: 'ExperienceOrbMendingInvalid',
      reason: 'remaining-exceeds-orb-value',
      orbExperience: decodedOrbExperience.success,
      experienceRemaining: decodedRemaining.success,
    })
  }
  return Result.succeed({
    ...repair,
    experienceRemaining: decodedRemaining.success,
  })
}

/** True when an orb is in the same dimension and within vanilla's pull range. */
export const isExperienceOrbWithinAttractionRange = (
  orbPosition: unknown,
  playerPosition: unknown,
): Result.Result<boolean, Schema.SchemaError> => {
  const orb = Schema.decodeUnknownResult(WorldPositionSchema)(orbPosition)
  if (Result.isFailure(orb)) return Result.fail(orb.failure)
  const player = Schema.decodeUnknownResult(WorldPositionSchema)(playerPosition)
  if (Result.isFailure(player)) return Result.fail(player.failure)
  return Result.succeed(isExperienceOrbWithinAttractionRangeForPositions(orb.success, player.success))
}

export const isExperienceOrbWithinPickupRange = (
  orbPosition: unknown,
  playerPosition: unknown,
): Result.Result<boolean, Schema.SchemaError> => {
  const orb = Schema.decodeUnknownResult(WorldPositionSchema)(orbPosition)
  if (Result.isFailure(orb)) return Result.fail(orb.failure)
  const player = Schema.decodeUnknownResult(WorldPositionSchema)(playerPosition)
  if (Result.isFailure(player)) return Result.fail(player.failure)
  return Result.succeed(isExperienceOrbWithinPickupRangeForPositions(orb.success, player.success))
}

/**
 * Moves an attracted orb toward the player. The owner snapshot stores position,
 * not velocity, so this preserves the documented range and increasing pull as
 * distance closes without inventing persisted motion state.
 */
export const pullExperienceOrbTowardPlayer = (
  orbPosition: unknown,
  playerPosition: unknown,
  dtSeconds: unknown,
): Result.Result<Schema.Schema.Type<typeof WorldPositionSchema>, Schema.SchemaError> => {
  const orb = Schema.decodeUnknownResult(WorldPositionSchema)(orbPosition)
  if (Result.isFailure(orb)) return Result.fail(orb.failure)
  const player = Schema.decodeUnknownResult(WorldPositionSchema)(playerPosition)
  if (Result.isFailure(player)) return Result.fail(player.failure)
  const elapsed = Schema.decodeUnknownResult(DeltaTimeSecsSchema)(dtSeconds)
  if (Result.isFailure(elapsed)) return Result.fail(elapsed.failure)
  const pulled = pullExperienceOrbTowardPlayerForPositions(orb.success, player.success, elapsed.success)
  if (!pulled.movementAttempted) return Result.succeed(orb.success)
  return Schema.decodeUnknownResult(WorldPositionSchema)(pulled.position)
}

/** Legacy records without a spawn tick have no known age and remain eligible. */
export const isExperienceOrbExpiredAtTick = (
  spawnedAt: unknown | undefined,
  currentTick: unknown,
): Result.Result<boolean, Schema.SchemaError> => {
  const current = Schema.decodeUnknownResult(SimulationTickSchema)(currentTick)
  if (Result.isFailure(current)) return Result.fail(current.failure)
  if (spawnedAt === undefined) return Result.succeed(false)
  const spawned = Schema.decodeUnknownResult(SimulationTickSchema)(spawnedAt)
  if (Result.isFailure(spawned)) return Result.fail(spawned.failure)
  return Result.succeed(hasExperienceOrbExpiredAtValidatedTick(spawned.success, current.success))
}

/** Vanilla collects at most one orb every two simulation ticks (10 per second). */
export const canCollectExperienceOrbAtTick = (
  currentTick: unknown,
  lastCollectedTick: unknown | undefined,
): Result.Result<boolean, Schema.SchemaError> => {
  const current = Schema.decodeUnknownResult(SimulationTickSchema)(currentTick)
  if (Result.isFailure(current)) return Result.fail(current.failure)
  if (lastCollectedTick === undefined) return Result.succeed(canCollectExperienceOrbAtValidatedTick(current.success, undefined))
  const last = Schema.decodeUnknownResult(SimulationTickSchema)(lastCollectedTick)
  if (Result.isFailure(last)) return Result.fail(last.failure)
  return Result.succeed(canCollectExperienceOrbAtValidatedTick(current.success, last.success))
}

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
  /** Number of same-value orbs represented by this record; omitted means one. */
  count?: ExperienceOrbCount | undefined
  /** Omitted on snapshots written before orb movement state was introduced. */
  position?: Schema.Schema.Type<typeof WorldPositionSchema> | undefined
  /** Omitted on snapshots written before orb spawn time was tracked. */
  spawnedAt?: Schema.Schema.Type<typeof SimulationTickSchema> | undefined
}>
export type ExperienceOrbCount = number & Brand.Brand<'ExperienceOrbCount'>
export const ExperienceOrbCountSchema: Schema.Codec<ExperienceOrbCount, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
).pipe(Schema.brand('ExperienceOrbCount'))
const SINGLE_EXPERIENCE_ORB_COUNT = 1 as ExperienceOrbCount
const ExperienceOrbMergeCandidateSchema = strictCodec(
  Schema.Struct({
    value: ExperienceOrbValueSchema,
    count: Schema.optional(ExperienceOrbCountSchema),
  }),
)

export type ExperienceOrbMergedStack = Readonly<{
  value: ExperienceOrbValue
  count: ExperienceOrbCount
}>

/** Merges only equal-valued stacks and adds entity count, never XP value. */
export const mergeSameValueExperienceOrbStacks = (
  left: unknown,
  right: unknown,
): Result.Result<ExperienceOrbMergedStack | undefined, Schema.SchemaError> => {
  const decodedLeft = Schema.decodeUnknownResult(ExperienceOrbMergeCandidateSchema)(left)
  if (Result.isFailure(decodedLeft)) return Result.fail(decodedLeft.failure)
  const decodedRight = Schema.decodeUnknownResult(ExperienceOrbMergeCandidateSchema)(right)
  if (Result.isFailure(decodedRight)) return Result.fail(decodedRight.failure)
  if (decodedLeft.success.value !== decodedRight.success.value) return Result.succeed(undefined)

  const mergedCount = Schema.decodeUnknownResult(ExperienceOrbCountSchema)(
    (decodedLeft.success.count ?? 1) + (decodedRight.success.count ?? 1),
  )
  if (Result.isFailure(mergedCount)) return Result.fail(mergedCount.failure)
  return Result.succeed({ value: decodedLeft.success.value, count: mergedCount.success })
}

const ExperienceOrbRecordSchema = strictCodec(
  Schema.Struct({
    id: EntityIdSchema,
    value: ExperienceOrbValueSchema,
    count: Schema.optional(ExperienceOrbCountSchema),
    position: Schema.optional(WorldPositionSchema),
    spawnedAt: Schema.optional(SimulationTickSchema),
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
  value: unknown,
): Result.Result<ExperienceOrbValue, Schema.SchemaError> =>
  Schema.decodeUnknownResult(ExperienceOrbValueSchema)(value)

export type ExperienceOrbAbsorptionError =
  | Brand.BrandError
  | ExperienceOrbAbsorptionFailure
  | ExperienceOrbAbsorptionCommitResultInvalid
  | ExperienceOrbMendingInvalid
  | Schema.SchemaError
  | WorldCommitCoordinatorError

export type ExperienceOrbAbsorptionPlan = Readonly<{
  context: DecodedExperienceOrbAbsorptionContext
  vitals: ExperienceOrbVitalsOwnerSnapshot
  orbs: ExperienceOrbOwnerSnapshot
  experience: ExperienceOrbValue
  levelBefore: number
  orbCountBefore: ExperienceOrbCount
}>

/** Calculates the vitals and orb owner candidates without committing them. */
export const planExperienceOrbAbsorption = (
  context: ExperienceOrbAbsorptionContext,
  vitals: ExperienceOrbVitalsOwnerSnapshot,
  orbs: ExperienceOrbOwnerSnapshot,
): Effect.Effect<ExperienceOrbAbsorptionPlan, ExperienceOrbAbsorptionError> =>
  Effect.gen(function* () {
    const decodedContext = yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionContextSchema)(context)
    const matchingOrbs = orbs.orbs.filter(({ id }) => id === decodedContext.orb)
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
    const levelBefore = experienceLevel(vitals.vitals)
    const orbCountBefore = orb.count ?? SINGLE_EXPERIENCE_ORB_COUNT
    const remainingOrbs = orbCountBefore === 1
      ? orbs.orbs.filter(({ id }) => id !== decodedContext.orb)
      : orbs.orbs.map((entry) => entry.id === decodedContext.orb
        ? { ...entry, count: (orbCountBefore - 1) as ExperienceOrbCount }
        : entry)
    return {
      context: decodedContext,
      vitals: { vitals: addExperience(vitals.vitals, experienceDelta) },
      orbs: { orbs: remainingOrbs },
      experience,
      levelBefore,
      orbCountBefore,
    }
  })

export const experienceOrbAbsorptionResultAfterCommit = (
  plan: ExperienceOrbAbsorptionPlan,
  committedVitals: ExperienceOrbVitalsOwnerSnapshot,
  committedOrbs: ExperienceOrbOwnerSnapshot,
  owners: ExperienceOrbAbsorptionOwners,
): Effect.Effect<ExperienceOrbAbsorption, ExperienceOrbAbsorptionError> =>
  Effect.gen(function* () {
    const committedOrb = committedOrbs.orbs.find(({ id }) => id === plan.context.orb)
    const expectedCount = plan.orbCountBefore - 1
    const orbWasNotConsumed = expectedCount === 0
      ? committedOrb !== undefined
      : committedOrb === undefined || (committedOrb.count ?? 1) !== expectedCount
    if (orbWasNotConsumed) {
      const failure = yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionCommitResultInvalidSchema)({
        _tag: 'ExperienceOrbAbsorptionCommitResultInvalid',
        reason: 'orb-not-consumed',
        owners: [owners.orbs],
      })
      return yield* Effect.fail(failure)
    }

    const committedLevel = experienceLevel(committedVitals.vitals)
    const events: Array<DomainEvent> = [
      yield* Schema.decodeUnknownEffect(DomainEventSchema)({
        _tag: 'ExperienceCollected',
        tick: plan.context.tick,
        player: plan.context.actor,
        orb: plan.context.orb,
        amount: plan.experience,
      }),
    ]

    if (committedLevel > plan.levelBefore) {
      events.push(yield* Schema.decodeUnknownEffect(DomainEventSchema)({
        _tag: 'LevelUp',
        tick: plan.context.tick,
        entity: plan.context.actor,
        position: plan.context.position,
        level: committedLevel,
      }))
    }

    return yield* Schema.decodeUnknownEffect(ExperienceOrbAbsorptionSchema)(events)
  })

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

    const plan = yield* planExperienceOrbAbsorption(
      context,
      vitalsSnapshot.state,
      orbsSnapshot.state,
    )

    const delta = yield* coordinator.commit({
      expectedRevision: vitalsSnapshot.revision,
      expectedDimensions: [],
      changes: [
        { ownerId: owners.vitals, state: plan.vitals },
        { ownerId: owners.orbs, state: plan.orbs },
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
    return yield* experienceOrbAbsorptionResultAfterCommit(plan, committedVitals, committedOrbs, owners)
  })
