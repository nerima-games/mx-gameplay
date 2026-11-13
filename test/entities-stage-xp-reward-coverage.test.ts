import { describe, expect, it } from '@effect/vitest'
import {
  AttackRangeDistance,
  DeltaTimeSecs,
  SimulationTickSchema,
  WorldPositionSchema,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  TimeService,
  WorldCommitCoordinator,
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

const makeZombieRewardFrame = (initialOrbs: ReadonlyArray<unknown>) => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const entities = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
    entities: [{
      id: mobId,
      kind: ZOMBIE_KIND,
      dimension: INITIAL_DIMENSION,
      feetPosition: mobPosition,
      healthPoints: 1,
      behaviour: undefined,
    }],
    nextSerial: 1,
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
  yield* Ref.set(state.rollSeed, 3)
  const observedCommits: Array<WorldCommitRequest> = []
  const observedCoordinator: WorldCommitCoordinatorApi = {
    ...coordinator,
    commit: (request) => Effect.tap(coordinator.commit(request), () => Effect.sync(() => {
      observedCommits.push(request)
    })),
  }
  const stages = yield* makeGameplayStagesWithState(state).pipe(
    Effect.provideService(WorldCommitCoordinator, observedCoordinator),
  )
  yield* requestMeleeAttack(state, {
    requestId: `kill-${mobId}`,
    origin: fixturePosition(0, 0, 0),
    direction: fixturePosition(0, 0, 1),
    reach: AttackRangeDistance(3),
    damage: 4,
  })
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
})
