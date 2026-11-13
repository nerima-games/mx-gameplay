import { describe, expect, it } from '@effect/vitest'
import {
  AttackRangeDistance,
  DeltaTimeSecs,
  SimulationTickSchema,
  WorldRevisionSchema,
  WorldPositionSchema,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  ReplicatedOwnerUnknown,
  TimeService,
  WorldCommitCoordinator,
  WorldRevisionConflict,
  type DomainEventBusApi,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
  makeTimeService,
} from '@nerima-games/mc-sim'
import { Effect, Layer, Ref, Schema, Stream } from 'effect'
import {
  ExperienceOrbOwnerSnapshotSchema,
  type ExperienceOrbOwnerSnapshot,
} from '../src/domain/entities/xp-orb.js'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat.js'
import {
  drainMeleeAttackResults,
  makeGameplayFrameStateForOwner,
  requestMeleeAttack,
} from '../src/stages/registration.js'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../src/stages/gameplay-owner-registrations.js'
import { makeGameplayStagesWithState } from '../src/stages/gameplay-stage-composition.js'
import { emptyRosterLayer } from './support/entity-manager-double.js'
import { emptyWorldStoreLayer } from './support/chunk-store-double.js'
import { emptyInventoryLayer } from './support/inventory-service-double.js'
import { gameplayCommitServicesLayer } from './support/transactional-stage-doubles.js'
import { runFrame } from './support/frame-runner.js'
import { position as fixturePosition } from './support/coordinate-fixtures.js'
import { INITIAL_DIMENSION } from '../src/domain/in-memory-player.js'

const eventBus: DomainEventBusApi = {
  publish: () => Effect.void,
  events: Stream.empty,
}

const productionWorld = Layer.provideMerge(
  gameplayCommitServicesLayer,
  Layer.mergeAll(
    emptyWorldStoreLayer,
    emptyRosterLayer,
    Layer.effect(TimeService, makeTimeService()),
    emptyInventoryLayer,
    Layer.succeed(DomainEventBus, eventBus),
  ),
)

const mobId = 'xp-reward-zombie'
const mobPosition: Position = fixturePosition(0, 0.72, -2)
const worldPosition = (position: Position) => Schema.decodeUnknownSync(WorldPositionSchema)({
  dimension: INITIAL_DIMENSION,
  ...position,
})

const orbRecord = (
  id: string,
  value: number,
  position: Position,
  count = 1,
) => ({
  id,
  value,
  count,
  position: worldPosition(position),
  spawnedAt: 0,
})

type CoordinatorFault =
  | 'queued-orb-snapshot-failure'
  | 'queued-orb-revision-conflict'
  | 'orb-commit-conflict'
  | 'attraction-orb-snapshot-failure'
  | 'attraction-player-snapshot-failure'
  | 'attraction-revision-conflict'
  | 'expired-cleanup-commit-conflict'

type FrameOptions = Readonly<{
  readonly fault?: CoordinatorFault
  readonly withZombie?: boolean
  readonly initialTick?: number
}>

const nextRevision = (revision: number) =>
  Schema.decodeUnknownSync(WorldRevisionSchema)(Number(revision) + 1)

const makeZombieRewardFrame = (
  initialOrbs: ReadonlyArray<unknown>,
  options: FrameOptions = {},
) => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const withZombie = options.withZombie ?? true
  const entities = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
    entities: withZombie ? [{
        id: mobId,
        kind: ZOMBIE_KIND,
        dimension: INITIAL_DIMENSION,
        feetPosition: mobPosition,
        healthPoints: 1,
        behaviour: undefined,
      }] : [],
    nextSerial: withZombie ? 1 : 0,
  })
  const orbs: ExperienceOrbOwnerSnapshot = Schema.decodeUnknownSync(ExperienceOrbOwnerSnapshotSchema)({
    orbs: initialOrbs,
  })
  const entitiesSnapshot = yield* coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
  yield* coordinator.commit({
    expectedRevision: entitiesSnapshot.revision,
    expectedDimensions: [],
    changes: [
      { ownerId: GAMEPLAY_ENTITIES_OWNER_ID, state: entities },
      { ownerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, state: orbs },
    ],
  })

  // Hold collection for this tick so the test observes the newly written stacks.
  yield* Ref.set(state.lastExperienceOrbPickupTick, Schema.decodeUnknownSync(SimulationTickSchema)(0))
  if (options.initialTick !== undefined) {
    yield* Ref.set(state.tickCount, Schema.decodeUnknownSync(SimulationTickSchema)(options.initialTick))
  }
  yield* Ref.set(state.rollSeed, 3)
  const observedCommits: Array<WorldCommitRequest> = []
  let experienceOrbSnapshotCalls = 0
  let attractionPlayerSnapshotFailureUsed = false
  let attractionRevisionConflictUsed = false
  const observedCoordinator: WorldCommitCoordinatorApi = {
    ...coordinator,
    snapshot: (ownerId, schema) => {
      if (ownerId === GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID) {
        experienceOrbSnapshotCalls += 1
        if (options.fault === 'attraction-orb-snapshot-failure' && experienceOrbSnapshotCalls === 1) {
          return Effect.fail(new ReplicatedOwnerUnknown({ ownerId }))
        }
        if (
          (options.fault === 'queued-orb-snapshot-failure' ||
            options.fault === 'queued-orb-revision-conflict') &&
          experienceOrbSnapshotCalls === 2
        ) {
          return Effect.gen(function* () {
            const pending = yield* Ref.get(state.mobExperience)
            const snapshot = yield* coordinator.snapshot(ownerId, schema)
            if (pending.length === 0) return snapshot
            if (options.fault === 'queued-orb-snapshot-failure') {
              return yield* Effect.fail(new ReplicatedOwnerUnknown({ ownerId }))
            }
            const revision = yield* coordinator.revision
            return { ...snapshot, revision: nextRevision(revision) }
          })
        }
        return coordinator.snapshot(ownerId, schema)
      }
      if (ownerId === GAMEPLAY_PLAYER_OWNER_ID && experienceOrbSnapshotCalls > 0) {
        if (
          options.fault === 'attraction-player-snapshot-failure' &&
          !attractionPlayerSnapshotFailureUsed
        ) {
          attractionPlayerSnapshotFailureUsed = true
          return Effect.fail(new ReplicatedOwnerUnknown({ ownerId }))
        }
        if (options.fault === 'attraction-revision-conflict' && !attractionRevisionConflictUsed) {
          attractionRevisionConflictUsed = true
          return Effect.gen(function* () {
            const snapshot = yield* coordinator.snapshot(ownerId, schema)
            const revision = yield* coordinator.revision
            return { ...snapshot, revision: nextRevision(revision) }
          })
        }
      }
      return coordinator.snapshot(ownerId, schema)
    },
    commit: (request) => {
      const changesExperienceOrbs = request.changes.some(
        ({ ownerId }) => ownerId === GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      )
      if (changesExperienceOrbs && (
        options.fault === 'orb-commit-conflict' ||
        options.fault === 'expired-cleanup-commit-conflict'
      )) {
        return Effect.fail(new WorldRevisionConflict({
          expected: request.expectedRevision,
          actual: nextRevision(request.expectedRevision),
        }))
      }
      return Effect.tap(coordinator.commit(request), () => Effect.sync(() => {
        observedCommits.push(request)
      }))
    },
  }
  const stages = yield* makeGameplayStagesWithState(state).pipe(
    Effect.provideService(WorldCommitCoordinator, observedCoordinator),
  )
  if (withZombie) {
    yield* requestMeleeAttack(state, {
      requestId: `kill-${mobId}`,
      origin: fixturePosition(0, 0, 0),
      direction: fixturePosition(0, 0, 1),
      reach: AttackRangeDistance(3),
      damage: 4,
    })
  }
  return { coordinator, state, stages, observedCommits }
}).pipe(Effect.provide(productionWorld))

const orbOwnerWrites = (requests: ReadonlyArray<WorldCommitRequest>) => requests.filter(({ changes }) =>
  changes.some(({ ownerId }) => ownerId === GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID),
)

describe('XP rewards through production gameplay composition', () => {
  it.effect('splits a zombie reward, merges equal-value stacks, and drains the reward queue', () =>
    Effect.gen(function* () {
      const { coordinator, state, stages, observedCommits } = yield* makeZombieRewardFrame([
        orbRecord('existing-three-point-orb', 3, mobPosition),
      ])
      expect(stages).toHaveLength(9)

      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainMeleeAttackResults(state)).toMatchObject([{
        requestId: `kill-${mobId}`,
        success: true,
        target: { id: mobId },
      }])
      expect((yield* coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)).state.entities)
        .toStrictEqual([])
      const orbs = yield* coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema)
      // A player-killed adult zombie leaves 5 XP; the vanilla denominations are 3 + 1 + 1.
      expect(orbs.state.orbs.map(({ value, count }) => [Number(value), count ?? 1]))
        .toStrictEqual([[3, 2], [1, 2]])
      expect(orbs.state.orbs.every(({ position }) => position?.x === mobPosition.x &&
        position.y === mobPosition.y && position.z === mobPosition.z)).toBe(true)
      expect(yield* Ref.get(state.mobExperience)).toStrictEqual([])
      expect(orbOwnerWrites(observedCommits)).toHaveLength(1)
    }),
  )

  it.effect('keeps the valid reward queued when merging would exceed the orb-count boundary', () =>
    Effect.gen(function* () {
      const maxCountOrb = orbRecord('full-three-point-orb-stack', 3, mobPosition, Number.MAX_SAFE_INTEGER)
      const { coordinator, state, stages, observedCommits } = yield* makeZombieRewardFrame([maxCountOrb])
      expect(stages).toHaveLength(9)

      yield* runFrame(stages, DeltaTimeSecs(0))

      const orbs = yield* coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema)
      expect(orbs.state.orbs.map(({ value, count }) => [Number(value), count]))
        .toStrictEqual([[3, Number.MAX_SAFE_INTEGER]])
      expect(yield* drainMeleeAttackResults(state)).toMatchObject([{
        requestId: `kill-${mobId}`,
        success: true,
        target: { id: mobId },
      }])
      expect(yield* Ref.get(state.mobExperience)).toMatchObject([{
        source: mobId,
        kind: ZOMBIE_KIND,
        amount: 5,
      }])
      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'ExperienceOrb',
      }))
      expect(orbOwnerWrites(observedCommits)).toStrictEqual([])
    }),
  )

  it.effect('deduplicates a replayed reward by its deterministic orb IDs and drains the queue', () =>
    Effect.gen(function* () {
      const replayedRewards = ([
        { value: 3, index: 0 },
        { value: 1, index: 1 },
        { value: 1, index: 2 },
      ] as const).map(({ value, index }) => orbRecord(
        `mx-gameplay:experience-orb/${mobId}/0/0/${index}`,
        value,
        fixturePosition(100 + index * 2, 0.72, -2),
      ))
      const { coordinator, state, stages } = yield* makeZombieRewardFrame(replayedRewards)
      expect(stages).toHaveLength(9)
      const before = yield* coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema)

      yield* runFrame(stages, DeltaTimeSecs(0))

      const after = yield* coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema)
      expect(yield* drainMeleeAttackResults(state)).toMatchObject([{
        requestId: `kill-${mobId}`,
        success: true,
        target: { id: mobId },
      }])
      expect(after.state).toStrictEqual(before.state)
      expect(yield* Ref.get(state.mobExperience)).toStrictEqual([])
    }),
  )

  it.effect('retains a killed mob reward when the orb owner snapshot fails', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeZombieRewardFrame([], {
        fault: 'queued-orb-snapshot-failure',
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainMeleeAttackResults(state)).toMatchObject([{
        requestId: `kill-${mobId}`,
        success: true,
      }])
      expect(yield* Ref.get(state.mobExperience)).toMatchObject([{ source: mobId, amount: 5 }])
      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
        error: expect.objectContaining({ _tag: 'ReplicatedOwnerUnknown' }),
      }))
    }),
  )

  it.effect('retains a killed mob reward when orb and player snapshots have different revisions', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeZombieRewardFrame([], {
        fault: 'queued-orb-revision-conflict',
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* Ref.get(state.mobExperience)).toMatchObject([{ source: mobId, amount: 5 }])
      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
    }),
  )

  it.effect('retains a killed mob reward when the orb owner commit conflicts', () =>
    Effect.gen(function* () {
      const { coordinator, state, stages } = yield* makeZombieRewardFrame([], {
        fault: 'orb-commit-conflict',
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect((yield* coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema))
        .state.orbs).toStrictEqual([])
      expect(yield* Ref.get(state.mobExperience)).toMatchObject([{ source: mobId, amount: 5 }])
      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'WorldCommit', subject: 'ExperienceOrb',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
    }),
  )

  it.effect('records an orb snapshot failure while attracting existing orbs', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeZombieRewardFrame([
        orbRecord('attraction-snapshot-orb', 1, fixturePosition(100, 0.72, -2)),
      ], {
        withZombie: false,
        fault: 'attraction-orb-snapshot-failure',
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
        error: expect.objectContaining({ _tag: 'ReplicatedOwnerUnknown' }),
      }))
    }),
  )

  it.effect('records a player snapshot failure after reading existing orbs for attraction', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeZombieRewardFrame([
        orbRecord('attraction-player-snapshot-orb', 1, fixturePosition(100, 0.72, -2)),
      ], {
        withZombie: false,
        fault: 'attraction-player-snapshot-failure',
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
        error: expect.objectContaining({ _tag: 'ReplicatedOwnerUnknown' }),
      }))
    }),
  )

  it.effect('records a player and orb revision conflict during attraction', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeZombieRewardFrame([
        orbRecord('attraction-revision-orb', 1, fixturePosition(100, 0.72, -2)),
      ], {
        withZombie: false,
        fault: 'attraction-revision-conflict',
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
    }),
  )

  it.effect('reports a conflict while committing expired legacy orbs without a position', () =>
    Effect.gen(function* () {
      const expiredOrb = { id: 'expired-legacy-orb', value: 1, spawnedAt: 0 }
      const { coordinator, state, stages } = yield* makeZombieRewardFrame([expiredOrb], {
        withZombie: false,
        initialTick: 6_001,
        fault: 'expired-cleanup-commit-conflict',
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      const orbs = yield* coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema)
      expect(orbs.state.orbs).toHaveLength(1)
      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'WorldCommit', subject: 'ExperienceOrb',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
    }),
  )
})
