import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  DomainEventSchema,
  EntityId,
  WorldRevisionSchema,
  WorldId,
} from '@nerima-games/mc-kernel'
import {
  ExperienceDelta,
  ExperienceLevel,
  SPAWN_VITALS,
  TotalExperience,
  addExperience,
  experienceCostOfLevel,
  levelForTotalExperience,
  makeReplicatedOwnerId,
  makeWorldCommitCoordinator,
  totalExperienceAtLevel,
  type ReplicatedOwnerUnknown,
  type ReplicatedSnapshot,
  type Vitals,
  type WorldCommitCoordinatorApi,
  WorldRevisionConflict,
} from '@nerima-games/mc-sim'
import {
  EXPERIENCE_ORB_ATTRACTION_RADIUS_BLOCKS,
  EXPERIENCE_ORB_LIFETIME_TICKS,
  EXPERIENCE_ORB_PICKUP_RADIUS_BLOCKS,
  EXPERIENCE_ORB_PICKUP_INTERVAL_TICKS,
  ExperienceOrbAbsorptionSchema,
  ExperienceOrbAbsorptionCommitResultInvalidSchema,
  ExperienceOrbAbsorptionFailureSchema,
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbValueSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
  applyMendingRepair,
  absorbExperienceOrb,
  canCollectExperienceOrbAtTick,
  createExperienceOrbValue,
  experienceOrbOwnerRegistration,
  isExperienceOrbExpiredAtTick,
  isExperienceOrbWithinAttractionRange,
  isExperienceOrbWithinPickupRange,
  mergeSameValueExperienceOrbStacks,
  pullExperienceOrbTowardPlayer,
  splitExperienceOrbReward,
  type ExperienceOrbAbsorptionContext,
  type ExperienceOrbOwnerSnapshot,
  vitalsOwnerRegistration,
} from '../src/domain/entities/xp-orb.js'

const VANILLA_XP_FIXTURE = {
  source: 'https://minecraft.wiki/w/Experience',
  edition: 'Java Edition 26.3',
  nextLevelCosts: [
    { level: 0, points: 7 },
    { level: 15, points: 37 },
    { level: 16, points: 42 },
    { level: 30, points: 112 },
    { level: 31, points: 121 },
  ],
  totalAtLevel: [
    { level: 16, points: 352 },
    { level: 17, points: 394 },
    { level: 31, points: 1507 },
    { level: 32, points: 1628 },
  ],
} as const

const VANILLA_XP_ORB_FIXTURE = {
  sources: [
    'https://minecraft.wiki/w/Experience',
    'https://minecraft.wiki/w/Drops',
  ],
  edition: 'Java Edition 26.3',
  ticksPerSecond: 20,
  attractionRadiusBlocks: 7.25,
  lifetimeTicks: 6000,
  maximumOrbPickupsPerSecond: 10,
  naturalOrbValues: [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 37, 73, 149, 307, 617, 1237, 2477,
  ],
  splitValues: [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1],
  splitExamples: [
    { total: 0, values: [] },
    { total: 1, values: [1] },
    { total: 11, values: [7, 3, 1] },
    { total: 12, values: [7, 3, 1, 1] },
    { total: 17, values: [17] },
    { total: 18, values: [17, 1] },
    { total: 1000, values: [617, 307, 73, 3] },
    { total: 2478, values: [2477, 1] },
  ],
} as const

const CONFLICT_OWNER_SCHEMA = Schema.Struct({ version: Schema.Number })

const PICKUP_CONTEXT = {
  actor: EntityId('player:1'),
  orb: EntityId('xp-orb:1'),
  tick: 4,
  position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
} satisfies ExperienceOrbAbsorptionContext

describe('experience orb values', () => {
  const OWNER_IDS = {
    vitals: makeReplicatedOwnerId('xp-orb-test-vitals'),
    orbs: makeReplicatedOwnerId('xp-orb-test-orbs'),
    conflict: makeReplicatedOwnerId('xp-orb-test-conflict'),
  } as const

  const makeCoordinator = (
    vitals: Vitals,
    orbs: ExperienceOrbOwnerSnapshot,
  ) =>
    makeWorldCommitCoordinator({
      world: WorldId('xp-orb-test-world'),
      owners: [
        vitalsOwnerRegistration(OWNER_IDS.vitals, { vitals }),
        experienceOrbOwnerRegistration(OWNER_IDS.orbs, orbs),
        {
          ownerId: OWNER_IDS.conflict,
          schema: CONFLICT_OWNER_SCHEMA,
          initialState: { version: 0 },
        },
      ],
    })

  it('decodes generated positive XP as finite nonnegative values', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 1_000_000 }),
        (points) => {
          const created = createExperienceOrbValue(points)
          if (Result.isFailure(created)) return false

          const decoded = Schema.decodeUnknownResult(ExperienceOrbValueSchema)(created.success)
          return Result.isSuccess(decoded) &&
            Number.isFinite(decoded.success) &&
            decoded.success >= 0 &&
            Number.isSafeInteger(decoded.success)
        },
      ),
      { numRuns: 250 },
    )

    FastCheck.assert(
      FastCheck.property(FastCheck.double(), (points) => {
        const decoded = Schema.decodeUnknownResult(ExperienceOrbValueSchema)(points)
        return Result.isFailure(decoded) ||
          (Number.isFinite(decoded.success) &&
            decoded.success >= 0 &&
            Number.isSafeInteger(decoded.success))
      }),
      { numRuns: 250 },
    )
  })

  it('rejects zero, negative, fractional, and non-finite XP values', () => {
    for (const points of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Result.isFailure(createExperienceOrbValue(points))).toBe(true)
    }
  })

  it('matches the vanilla level cost and total XP fixture through mc-sim', () => {
    expect(VANILLA_XP_FIXTURE.source).toBe('https://minecraft.wiki/w/Experience')
    expect(VANILLA_XP_FIXTURE.edition).toBe('Java Edition 26.3')

    for (const { level, points } of VANILLA_XP_FIXTURE.nextLevelCosts) {
      expect(experienceCostOfLevel(ExperienceLevel(level))).toBe(points)
    }

    for (const { level, points } of VANILLA_XP_FIXTURE.totalAtLevel) {
      const total = totalExperienceAtLevel(ExperienceLevel(level))
      expect(total).toBe(points)
      expect(levelForTotalExperience(TotalExperience(points))).toBe(level)
    }
  })

  it('keeps the host owner schemas strict', () => {
    expect(Result.isFailure(Schema.decodeUnknownResult(ExperienceOrbOwnerSnapshotSchema)({
      orbs: [],
      unexpected: true,
    }))).toBe(true)
  })

  it('rejects missing required fields and null for every public XP result and owner schema', () => {
    const validOwner = { orbs: [{ id: PICKUP_CONTEXT.orb, value: 1 }] }
    const validVitals = { vitals: SPAWN_VITALS }
    const validFailure = {
      _tag: 'ExperienceOrbUnavailable' as const,
      orb: PICKUP_CONTEXT.orb,
      reason: 'missing-orb' as const,
    }
    const validCommitFailure = {
      _tag: 'ExperienceOrbAbsorptionCommitResultInvalid' as const,
      reason: 'missing-owner-change' as const,
      owners: [OWNER_IDS.vitals],
    }
    const validEvent = [{
      _tag: 'ExperienceCollected' as const,
      tick: PICKUP_CONTEXT.tick,
      player: PICKUP_CONTEXT.actor,
      orb: PICKUP_CONTEXT.orb,
      amount: 1,
    }]
    const schemas = [
      ExperienceOrbValueSchema,
      ExperienceOrbAbsorptionSchema,
      ExperienceOrbOwnerSnapshotSchema,
      ExperienceOrbVitalsOwnerSnapshotSchema,
      ExperienceOrbAbsorptionFailureSchema,
      ExperienceOrbAbsorptionCommitResultInvalidSchema,
    ] as const

    for (const schema of schemas) {
      expect(Result.isFailure(Schema.decodeUnknownResult(schema)(null))).toBe(true)
    }
    expect(Result.isFailure(Schema.decodeUnknownResult(ExperienceOrbOwnerSnapshotSchema)({}))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(ExperienceOrbVitalsOwnerSnapshotSchema)({}))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(ExperienceOrbAbsorptionFailureSchema)({
      _tag: validFailure._tag,
      orb: validFailure.orb,
    }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(ExperienceOrbAbsorptionCommitResultInvalidSchema)({
      _tag: validCommitFailure._tag,
      reason: validCommitFailure.reason,
    }))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(ExperienceOrbAbsorptionSchema)(validEvent))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(ExperienceOrbOwnerSnapshotSchema)(validOwner))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(ExperienceOrbVitalsOwnerSnapshotSchema)(validVitals))).toBe(true)
  })

  it.effect('commits vitals and orb consumption together before returning strict event candidates', () =>
    Effect.gen(function* () {
      const threshold = totalExperienceAtLevel(ExperienceLevel(16))
      const initialExperience = yield* Effect.fromResult(ExperienceDelta.result(threshold))
      const initialVitals = addExperience(SPAWN_VITALS, initialExperience)
      const orb = yield* Effect.fromResult(createExperienceOrbValue(42))
      const coordinator = yield* makeCoordinator(initialVitals, {
        orbs: [{ id: PICKUP_CONTEXT.orb, value: orb }],
      })
      const revisionBefore = yield* coordinator.revision

      const events = yield* absorbExperienceOrb(coordinator, OWNER_IDS, PICKUP_CONTEXT)
      const revisionAfter = yield* coordinator.revision
      const vitals = yield* coordinator.snapshot(
        OWNER_IDS.vitals,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      const orbs = yield* coordinator.snapshot(OWNER_IDS.orbs, ExperienceOrbOwnerSnapshotSchema)

      expect(revisionAfter - revisionBefore).toBe(1)
      expect(vitals['state'].vitals.totalExperience).toBe(394)
      expect(orbs['state'].orbs).toEqual([])
      expect(events.map(({ _tag }) => _tag)).toEqual(['ExperienceCollected', 'LevelUp'])
      expect(events[1]).toMatchObject({
        _tag: 'LevelUp',
        entity: PICKUP_CONTEXT.actor,
        position: PICKUP_CONTEXT.position,
        level: 17,
      })

      for (const event of events) {
        expect(Result.isSuccess(Schema.decodeUnknownResult(DomainEventSchema)(event))).toBe(true)
      }
      expect(Result.isSuccess(
        Schema.decodeUnknownResult(ExperienceOrbAbsorptionSchema)(events),
      )).toBe(true)

      const withExtraField = {
        _tag: 'ExperienceCollected',
        tick: PICKUP_CONTEXT.tick,
        player: PICKUP_CONTEXT.actor,
        orb: PICKUP_CONTEXT.orb,
        amount: orb,
        unexpected: true,
      }
      expect(Result.isFailure(Schema.decodeUnknownResult(DomainEventSchema)(withExtraField))).toBe(true)
    }),
  )

  it.effect('commits absorption without a LevelUp candidate when the level stays the same', () =>
    Effect.gen(function* () {
      const orb = yield* Effect.fromResult(createExperienceOrbValue(1))
      const coordinator = yield* makeCoordinator(SPAWN_VITALS, {
        orbs: [{ id: PICKUP_CONTEXT.orb, value: orb }],
      })

      const events = yield* absorbExperienceOrb(coordinator, OWNER_IDS, PICKUP_CONTEXT)
      const vitals = yield* coordinator.snapshot(
        OWNER_IDS.vitals,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )

      expect(vitals['state'].vitals.totalExperience).toBe(1)
      expect(events.map(({ _tag }) => _tag)).toEqual(['ExperienceCollected'])
    }),
  )

  it.effect('consumes one count from a merged orb and preserves its XP value', () =>
    Effect.gen(function* () {
      const orb = yield* Effect.fromResult(createExperienceOrbValue(7))
      const coordinator = yield* makeCoordinator(SPAWN_VITALS, {
        orbs: [{ id: PICKUP_CONTEXT.orb, value: orb, count: 2 }],
      })

      const events = yield* absorbExperienceOrb(coordinator, OWNER_IDS, PICKUP_CONTEXT)
      const vitals = yield* coordinator.snapshot(
        OWNER_IDS.vitals,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      const orbs = yield* coordinator.snapshot(OWNER_IDS.orbs, ExperienceOrbOwnerSnapshotSchema)

      expect(vitals['state'].vitals.totalExperience).toBe(7)
      expect(orbs['state'].orbs).toEqual([{ id: PICKUP_CONTEXT.orb, value: orb, count: 1 }])
      expect(events[0]).toMatchObject({ _tag: 'ExperienceCollected', amount: 7 })
    }),
  )

  it.effect('returns no event candidates when the WCC commit fails', () =>
    Effect.gen(function* () {
      const orb = yield* Effect.fromResult(createExperienceOrbValue(1))
      const coordinator = yield* makeCoordinator(SPAWN_VITALS, {
        orbs: [{ id: PICKUP_CONTEXT.orb, value: orb }],
      })
      const conflictingCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        commit: (request) => Effect.gen(function* () {
          yield* coordinator.commit({
            expectedRevision: request.expectedRevision,
            expectedDimensions: [],
            changes: [{ ownerId: OWNER_IDS.conflict, state: { version: 1 } }],
          })
          return yield* coordinator.commit(request)
        }),
      }

      const failure = yield* Effect.flip(
        absorbExperienceOrb(conflictingCoordinator, OWNER_IDS, PICKUP_CONTEXT),
      )
      const vitals = yield* coordinator.snapshot(
        OWNER_IDS.vitals,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      const orbs = yield* coordinator.snapshot(OWNER_IDS.orbs, ExperienceOrbOwnerSnapshotSchema)

      expect(failure._tag).toBe('WorldRevisionConflict')
      expect(vitals['state'].vitals.totalExperience).toBe(0)
      expect(orbs['state'].orbs).toHaveLength(1)
    }),
  )

  it.effect('fails when the requested orb is absent from the registered owner', () =>
    Effect.gen(function* () {
      const coordinator = yield* makeCoordinator(SPAWN_VITALS, { orbs: [] })

      const failure = yield* Effect.flip(
        absorbExperienceOrb(coordinator, OWNER_IDS, PICKUP_CONTEXT),
      )

      expect(failure._tag).toBe('ExperienceOrbUnavailable')
      expect(failure).toMatchObject({ reason: 'missing-orb' })
    }),
  )

  it.effect('rejects duplicate ids instead of choosing one XP value', () =>
    Effect.gen(function* () {
      const firstValue = yield* Effect.fromResult(createExperienceOrbValue(1))
      const secondValue = yield* Effect.fromResult(createExperienceOrbValue(2))
      const coordinator = yield* makeCoordinator(SPAWN_VITALS, {
        orbs: [
          { id: PICKUP_CONTEXT.orb, value: firstValue },
          { id: PICKUP_CONTEXT.orb, value: secondValue },
        ],
      })

      const failure = yield* Effect.flip(
        absorbExperienceOrb(coordinator, OWNER_IDS, PICKUP_CONTEXT),
      )

      expect(failure).toMatchObject({
        _tag: 'ExperienceOrbUnavailable',
        orb: PICKUP_CONTEXT.orb,
        reason: 'duplicate-orb-id',
      })
    }),
  )

  it.effect('refuses to combine owner snapshots from different revisions', () =>
    Effect.gen(function* () {
      const value = yield* Effect.fromResult(createExperienceOrbValue(1))
      const coordinator = yield* makeCoordinator(SPAWN_VITALS, {
        orbs: [{ id: PICKUP_CONTEXT.orb, value }],
      })
      type SnapshotCodec = Parameters<WorldCommitCoordinatorApi['snapshot']>[1]
      type SnapshotOwnerId = Parameters<WorldCommitCoordinatorApi['snapshot']>[0]
      const mismatchedCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        snapshot: <Codec extends SnapshotCodec>(
          ownerId: SnapshotOwnerId,
          schema: Codec,
        ): Effect.Effect<
          ReplicatedSnapshot<Codec>,
          Schema.SchemaError | ReplicatedOwnerUnknown,
          Schema.Codec.DecodingServices<Codec>
        > => Effect.map(coordinator.snapshot(ownerId, schema), (snapshot) =>
          ownerId === OWNER_IDS.orbs
            ? { ...snapshot, revision: Schema.decodeUnknownSync(WorldRevisionSchema)(1) }
            : snapshot,
        ),
      }

      const failure = yield* Effect.flip(
        absorbExperienceOrb(mismatchedCoordinator, OWNER_IDS, PICKUP_CONTEXT),
      )

      expect(failure._tag).toBe('WorldRevisionConflict')
    }),
  )

  it.effect('reports whichever owner change the commit response omitted', () =>
    Effect.gen(function* () {
      const value = yield* Effect.fromResult(createExperienceOrbValue(1))

      for (const omittedOwner of [OWNER_IDS.vitals, OWNER_IDS.orbs]) {
        const coordinator = yield* makeCoordinator(SPAWN_VITALS, {
          orbs: [{ id: PICKUP_CONTEXT.orb, value }],
        })
        const incompleteCoordinator: WorldCommitCoordinatorApi = {
          ...coordinator,
          commit: (request) => Effect.map(coordinator.commit(request), (delta) => ({
            ...delta,
            changes: delta.changes.filter((change) => change.owner !== omittedOwner),
          })),
        }

        const failure = yield* Effect.flip(
          absorbExperienceOrb(incompleteCoordinator, OWNER_IDS, PICKUP_CONTEXT),
        )

        expect(failure).toMatchObject({
          _tag: 'ExperienceOrbAbsorptionCommitResultInvalid',
          reason: 'missing-owner-change',
          owners: [omittedOwner],
        })
      }
    }),
  )

  it.effect('reports when the committed owner state still contains the absorbed orb', () =>
    Effect.gen(function* () {
      const value = yield* Effect.fromResult(createExperienceOrbValue(1))
      const coordinator = yield* makeCoordinator(SPAWN_VITALS, {
        orbs: [{ id: PICKUP_CONTEXT.orb, value }],
      })
      const incompleteCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        commit: (request) => Effect.map(coordinator.commit(request), (delta) => ({
          ...delta,
          changes: delta.changes.map((change) => change.owner === OWNER_IDS.orbs
            ? { ...change, state: { orbs: [{ id: PICKUP_CONTEXT.orb, value }] } }
            : change),
        })),
      }

      const failure = yield* Effect.flip(
        absorbExperienceOrb(incompleteCoordinator, OWNER_IDS, PICKUP_CONTEXT),
      )

      expect(failure).toMatchObject({
        _tag: 'ExperienceOrbAbsorptionCommitResultInvalid',
        reason: 'orb-not-consumed',
        owners: [OWNER_IDS.orbs],
      })
    }),
  )

  it('commits successful absorption once for generated XP values', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 1000 }),
        (points) => {
          const value = createExperienceOrbValue(points)
          if (Result.isFailure(value)) return false
          const coordinator = Effect.runSync(makeCoordinator(SPAWN_VITALS, {
            orbs: [{ id: PICKUP_CONTEXT.orb, value: value.success }],
          }))
          let commitCalls = 0
          let ownerChanges = 0
          let requestHasBlockWrite = true
          const countingCoordinator: WorldCommitCoordinatorApi = {
            ...coordinator,
            commit: (request) => {
              commitCalls += 1
              ownerChanges = request.changes.length
              requestHasBlockWrite = request.blockWrite !== undefined
              return coordinator.commit(request)
            },
          }
          const outcome = Effect.runSync(Effect.result(
            absorbExperienceOrb(countingCoordinator, OWNER_IDS, PICKUP_CONTEXT),
          ))
          const vitals = Effect.runSync(coordinator.snapshot(
            OWNER_IDS.vitals,
            ExperienceOrbVitalsOwnerSnapshotSchema,
          ))
          const orbs = Effect.runSync(coordinator.snapshot(
            OWNER_IDS.orbs,
            ExperienceOrbOwnerSnapshotSchema,
          ))

          return Result.isSuccess(outcome) &&
            Result.isSuccess(Schema.decodeUnknownResult(ExperienceOrbAbsorptionSchema)(outcome.success)) &&
            commitCalls === 1 &&
            ownerChanges === 2 &&
            !requestHasBlockWrite &&
            vitals.revision === 1 &&
            orbs.revision === 1 &&
            vitals.state.vitals.totalExperience === points &&
            orbs.state.orbs.length === 0
        },
      ),
      { numRuns: 100, seed: 90101 },
    )
  })

  it('keeps both owners and revision unchanged when absorption commit fails', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 1000 }),
        (points) => {
          const value = createExperienceOrbValue(points)
          if (Result.isFailure(value)) return false
          const coordinator = Effect.runSync(makeCoordinator(SPAWN_VITALS, {
            orbs: [{ id: PICKUP_CONTEXT.orb, value: value.success }],
          }))
          const vitalsBefore = Effect.runSync(coordinator.snapshot(
            OWNER_IDS.vitals,
            ExperienceOrbVitalsOwnerSnapshotSchema,
          ))
          const orbsBefore = Effect.runSync(coordinator.snapshot(
            OWNER_IDS.orbs,
            ExperienceOrbOwnerSnapshotSchema,
          ))
          let commitCalls = 0
          let ownerChanges = 0
          let requestHasBlockWrite = true
          const rejectingCoordinator: WorldCommitCoordinatorApi = {
            ...coordinator,
            commit: (request) => {
              commitCalls += 1
              ownerChanges = request.changes.length
              requestHasBlockWrite = request.blockWrite !== undefined
              return Effect.fail(new WorldRevisionConflict({
                expected: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
                actual: Schema.decodeUnknownSync(WorldRevisionSchema)(1),
              }))
            },
          }
          const outcome = Effect.runSync(Effect.result(
            absorbExperienceOrb(rejectingCoordinator, OWNER_IDS, PICKUP_CONTEXT),
          ))
          const vitalsAfter = Effect.runSync(coordinator.snapshot(
            OWNER_IDS.vitals,
            ExperienceOrbVitalsOwnerSnapshotSchema,
          ))
          const orbsAfter = Effect.runSync(coordinator.snapshot(
            OWNER_IDS.orbs,
            ExperienceOrbOwnerSnapshotSchema,
          ))

          return Result.isFailure(outcome) &&
            commitCalls === 1 &&
            ownerChanges === 2 &&
            !requestHasBlockWrite &&
            vitalsAfter.revision === vitalsBefore.revision &&
            orbsAfter.revision === orbsBefore.revision &&
            JSON.stringify(vitalsAfter.state) === JSON.stringify(vitalsBefore.state) &&
            JSON.stringify(orbsAfter.state) === JSON.stringify(orbsBefore.state)
        },
      ),
      { numRuns: 100, seed: 90102 },
    )
  })
})

describe('experience orb decisions', () => {
  const origin = { dimension: 'overworld', x: 0, y: 64, z: 0 }

  it('matches fixed Java Edition 26.3 orb, movement, and pickup fixtures', () => {
    expect(VANILLA_XP_ORB_FIXTURE.sources).toEqual([
      'https://minecraft.wiki/w/Experience',
      'https://minecraft.wiki/w/Drops',
    ])
    expect(VANILLA_XP_ORB_FIXTURE.edition).toBe('Java Edition 26.3')
    expect(EXPERIENCE_ORB_ATTRACTION_RADIUS_BLOCKS).toBe(
      VANILLA_XP_ORB_FIXTURE.attractionRadiusBlocks,
    )
    expect(EXPERIENCE_ORB_LIFETIME_TICKS).toBe(VANILLA_XP_ORB_FIXTURE.lifetimeTicks)
    expect(EXPERIENCE_ORB_PICKUP_INTERVAL_TICKS).toBe(
      VANILLA_XP_ORB_FIXTURE.ticksPerSecond /
        VANILLA_XP_ORB_FIXTURE.maximumOrbPickupsPerSecond,
    )

    for (const { total, values } of VANILLA_XP_ORB_FIXTURE.splitExamples) {
      const result = splitExperienceOrbReward(total)
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) expect(result.success).toEqual(values)
    }

    expect(VANILLA_XP_ORB_FIXTURE.naturalOrbValues).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 37, 73, 149, 307, 617, 1237, 2477,
    ])
    expect(VANILLA_XP_ORB_FIXTURE.splitValues).toEqual([
      2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1,
    ])
  })

  it('splits valid integer rewards into descending vanilla base orb values', () => {
    const baseValues = new Set<number>(VANILLA_XP_ORB_FIXTURE.splitValues)
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: 100_000 }), (points) => {
        const result = splitExperienceOrbReward(points)
        if (Result.isFailure(result)) return false
        const values = result.success
        return values.reduce((sum, value) => sum + value, 0) === points &&
          values.every((value) => baseValues.has(value)) &&
          values.every((value, index) => index === 0 || values[index - 1]! >= value)
      }),
      { numRuns: 250, seed: 81301 },
    )

    for (const invalid of [-1, 1.25, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Result.isFailure(splitExperienceOrbReward(invalid))).toBe(true)
    }
  })

  it('carries a Mending storage candidate forward and bounds the XP remainder', () => {
    const repair = {
      repairedStorage: { revision: 1 },
      experienceRemaining: 3,
      repairedDurability: { current: 10, max: 100 },
      selectedLocation: 'main_hand',
    } as const
    expect(applyMendingRepair(7, repair)).toEqual(Result.succeed(repair))
    expect(applyMendingRepair(7, { ...repair, experienceRemaining: 0 })).toEqual(Result.succeed({
      ...repair,
      experienceRemaining: 0,
    }))
    expect(applyMendingRepair(7, { ...repair, experienceRemaining: 8 })).toEqual(Result.fail({
      _tag: 'ExperienceOrbMendingInvalid',
      reason: 'remaining-exceeds-orb-value',
      orbExperience: 7,
      experienceRemaining: 8,
    }))
    expect(Result.isFailure(applyMendingRepair(7, { ...repair, experienceRemaining: 1.5 }))).toBe(true)

    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 1000 }),
        FastCheck.integer({ min: 0, max: 1000 }),
        (orbExperience, proposedRemaining) => {
          const experienceRemaining = Math.min(orbExperience, proposedRemaining)
          const storage = { marker: orbExperience }
          const applied = applyMendingRepair(orbExperience, {
            repairedStorage: storage,
            experienceRemaining,
            repairedDurability: null,
            selectedLocation: 'slot:0',
          })
          return Result.isSuccess(applied) &&
            applied.success.repairedStorage === storage &&
            applied.success.experienceRemaining === experienceRemaining &&
            applied.success.selectedLocation === 'slot:0'
        },
      ),
      { numRuns: 250, seed: 81306 },
    )
  })

  it('includes the attraction boundary and excludes just-outside positions', () => {
    expect(Result.isSuccess(isExperienceOrbWithinAttractionRange(
      origin,
      { ...origin, x: 7.25 },
    ))).toBe(true)
    expect(isExperienceOrbWithinAttractionRange(
      origin,
      { ...origin, x: 7.250001 },
    )).toEqual(Result.succeed(false))
    expect(isExperienceOrbWithinAttractionRange(origin, origin)).toEqual(Result.succeed(true))
    expect(isExperienceOrbWithinAttractionRange(origin, {
      ...origin,
      dimension: 'the_nether',
    })).toEqual(Result.succeed(false))
    expect(Result.isFailure(isExperienceOrbWithinAttractionRange(origin, {
      ...origin,
      x: Number.NaN,
    }))).toBe(true)
  })

  it('pulls attracted orbs toward the player with a stronger pull at close range', () => {
    const player = { dimension: 'overworld', x: 0, y: 0, z: 0 }
    const farPulled = pullExperienceOrbTowardPlayer(
      { dimension: 'overworld', x: 3, y: 0, z: 0 },
      player,
      0.5,
    )
    const nearPulled = pullExperienceOrbTowardPlayer(
      { dimension: 'overworld', x: 1, y: 0, z: 0 },
      player,
      0.5,
    )
    expect(Result.isSuccess(farPulled)).toBe(true)
    expect(Result.isSuccess(nearPulled)).toBe(true)
    if (Result.isFailure(farPulled) || Result.isFailure(nearPulled)) return

    const expectedFarTravel = 2 * (1 - 3 / 7.25) ** 2 * 0.5
    expect(farPulled.success.x).toBeCloseTo(3 - expectedFarTravel)
    expect(3 - farPulled.success.x).toBeGreaterThan(0)
    expect(1 - nearPulled.success.x).toBeGreaterThan(3 - farPulled.success.x)
    expect(pullExperienceOrbTowardPlayer(
      { dimension: 'nether', x: 3, y: 0, z: 0 },
      player,
      0.5,
    )).toEqual(Result.succeed({ dimension: 'nether', x: 3, y: 0, z: 0 }))
    expect(pullExperienceOrbTowardPlayer(
      { dimension: 'overworld', x: 3, y: 0, z: 0 },
      player,
      0,
    )).toEqual(Result.succeed({ dimension: 'overworld', x: 3, y: 0, z: 0 }))
    expect(Result.isFailure(pullExperienceOrbTowardPlayer(
      { dimension: 'overworld', x: 3, y: 0, z: 0 },
      player,
      -0.1,
    ))).toBe(true)
  })

  it('collects only within the player contact radius', () => {
    expect(EXPERIENCE_ORB_PICKUP_RADIUS_BLOCKS).toBe(1)
    expect(isExperienceOrbWithinPickupRange(origin, { ...origin, x: 1 })).toEqual(Result.succeed(true))
    expect(isExperienceOrbWithinPickupRange(origin, { ...origin, x: 1.0001 })).toEqual(Result.succeed(false))
    expect(isExperienceOrbWithinPickupRange(origin, { ...origin, dimension: 'the_nether' }))
      .toEqual(Result.succeed(false))
  })

  it('agrees with Euclidean distance and is symmetric over valid positions', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.tuple(
          FastCheck.integer({ min: -10, max: 10 }),
          FastCheck.integer({ min: -10, max: 10 }),
          FastCheck.integer({ min: -10, max: 10 }),
        ),
        ([x, y, z]) => {
          const first = { dimension: 'overworld', x: 0, y: 0, z: 0 }
          const second = { dimension: 'overworld', x, y, z }
          const forward = isExperienceOrbWithinAttractionRange(first, second)
          const reverse = isExperienceOrbWithinAttractionRange(second, first)
          const expected = Math.hypot(x, y, z) <= EXPERIENCE_ORB_ATTRACTION_RADIUS_BLOCKS
          return Result.isSuccess(forward) &&
            Result.isSuccess(reverse) &&
            forward.success === expected &&
            reverse.success === expected
        },
      ),
      { numRuns: 250, seed: 81302 },
    )
  })

  it('expires at 6000 ticks, keeps legacy orbs, and rejects malformed ticks', () => {
    expect(isExperienceOrbExpiredAtTick(100, 6099)).toEqual(Result.succeed(false))
    expect(isExperienceOrbExpiredAtTick(100, 6100)).toEqual(Result.succeed(true))
    expect(isExperienceOrbExpiredAtTick(100, 6101)).toEqual(Result.succeed(true))
    expect(isExperienceOrbExpiredAtTick(101, 100)).toEqual(Result.succeed(false))
    expect(isExperienceOrbExpiredAtTick(undefined, 6100)).toEqual(Result.succeed(false))
    expect(Result.isFailure(isExperienceOrbExpiredAtTick(-1, 6000))).toBe(true)
    expect(Result.isFailure(isExperienceOrbExpiredAtTick(0, -1))).toBe(true)

    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 1_000_000 }),
        FastCheck.integer({ min: 0, max: 10_000 }),
        (spawnedAt, age) => {
          const expired = isExperienceOrbExpiredAtTick(spawnedAt, spawnedAt + age)
          return Result.isSuccess(expired) && expired.success === (age >= 6000)
        },
      ),
      { numRuns: 250, seed: 81303 },
    )
  })

  it('enforces the two-tick pickup interval and permits the first pickup', () => {
    expect(canCollectExperienceOrbAtTick(10, undefined)).toEqual(Result.succeed(true))
    expect(canCollectExperienceOrbAtTick(10, 10)).toEqual(Result.succeed(false))
    expect(canCollectExperienceOrbAtTick(11, 10)).toEqual(Result.succeed(false))
    expect(canCollectExperienceOrbAtTick(12, 10)).toEqual(Result.succeed(true))
    expect(canCollectExperienceOrbAtTick(9, 10)).toEqual(Result.succeed(false))
    expect(Result.isFailure(canCollectExperienceOrbAtTick(-1, undefined))).toBe(true)
    expect(Result.isFailure(canCollectExperienceOrbAtTick(2, -1))).toBe(true)

    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 1_000_000 }),
        FastCheck.integer({ min: 0, max: 4 }),
        (lastCollectedTick, elapsedTicks) => {
          const eligible = canCollectExperienceOrbAtTick(
            lastCollectedTick + elapsedTicks,
            lastCollectedTick,
          )
          return Result.isSuccess(eligible) &&
            eligible.success === (elapsedTicks >= EXPERIENCE_ORB_PICKUP_INTERVAL_TICKS)
        },
      ),
      { numRuns: 250, seed: 81304 },
    )
  })

  it('merges equal values by count while preserving the XP value', () => {
    expect(mergeSameValueExperienceOrbStacks(
      { value: 7, count: 2 },
      { value: 7 },
    )).toEqual(Result.succeed({ value: 7, count: 3 }))
    expect(mergeSameValueExperienceOrbStacks(
      { value: 7, count: 2 },
      { value: 8, count: 3 },
    )).toEqual(Result.succeed(undefined))
    expect(Result.isFailure(mergeSameValueExperienceOrbStacks(
      { value: 7, count: 0 },
      { value: 7 },
    ))).toBe(true)

    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 1000 }),
        FastCheck.integer({ min: 1, max: 1000 }),
        FastCheck.integer({ min: 1, max: 1000 }),
        FastCheck.integer({ min: 1, max: 1000 }),
        (leftValue, rightValue, leftCount, rightCount) => {
          const merged = mergeSameValueExperienceOrbStacks(
            { value: leftValue, count: leftCount },
            { value: rightValue, count: rightCount },
          )
          if (Result.isFailure(merged)) return false
          if (leftValue !== rightValue) return merged.success === undefined
          return merged.success?.value === leftValue &&
            merged.success.count === leftCount + rightCount
        },
      ),
      { numRuns: 250, seed: 81305 },
    )
  })

  it('accepts optional orb position and spawn ticks in strict snapshots', () => {
    expect(Result.isSuccess(Schema.decodeUnknownResult(ExperienceOrbOwnerSnapshotSchema)({
      orbs: [{
        id: PICKUP_CONTEXT.orb,
        value: 7,
        count: 2,
        position: origin,
        spawnedAt: 100,
      }],
    }))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(ExperienceOrbOwnerSnapshotSchema)({
      orbs: [{ id: PICKUP_CONTEXT.orb, value: 7 }],
    }))).toBe(true)
    for (const invalidRecord of [
      { id: PICKUP_CONTEXT.orb, value: 7, count: 0 },
      { id: PICKUP_CONTEXT.orb, value: 7, position: { ...origin, x: Number.NaN } },
      { id: PICKUP_CONTEXT.orb, value: 7, spawnedAt: -1 },
      { id: PICKUP_CONTEXT.orb, value: 7, unexpected: true },
    ]) {
      expect(Result.isFailure(Schema.decodeUnknownResult(ExperienceOrbOwnerSnapshotSchema)({
        orbs: [invalidRecord],
      }))).toBe(true)
    }
  })
})
