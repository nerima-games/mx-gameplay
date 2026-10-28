import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { WorldIdSchema } from '@nerima-games/mc-kernel'
import {
  EntityId,
  EntityKind,
  EntityHealthPoints,
  makeTntService,
  makeWorldCommitCoordinator,
  PROJECTILE_REPLICATED_OWNER_ID,
  TNT_REPLICATED_OWNER_ID,
  TntServiceSnapshotSchema,
  WorldCommitCoordinator,
} from '@nerima-games/mc-sim'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_OWNER_REGISTRATIONS,
  GameplayEntityRosterSchema,
} from '../src/stages/gameplay-owner-registrations.js'

describe('gameplay replicated owner registrations', () => {
  it.effect('publishes unique gameplay owners including projectile and TNT state', () =>
    Effect.sync(() => {
      const ownerIds = GAMEPLAY_OWNER_REGISTRATIONS.map((owner) => owner.ownerId)

      expect(ownerIds).toContain(GAMEPLAY_ENTITIES_OWNER_ID)
      expect(ownerIds).toContain(GAMEPLAY_FISHING_OWNER_ID)
      expect(ownerIds).toContain(PROJECTILE_REPLICATED_OWNER_ID)
      expect(ownerIds).toContain(TNT_REPLICATED_OWNER_ID)
      expect(new Set(ownerIds).size).toBe(ownerIds.length)
    }),
  )

  it.effect('commits a TNT prime through the registered owner', () =>
    Effect.gen(function* () {
      const coordinator = yield* makeWorldCommitCoordinator({
        world: Schema.decodeUnknownSync(WorldIdSchema)('gameplay-owner-registration-tests'),
        owners: GAMEPLAY_OWNER_REGISTRATIONS,
      })

      const tntService = yield* Effect.provideService(
        makeTntService(TNT_REPLICATED_OWNER_ID),
        WorldCommitCoordinator,
        coordinator,
      )
      const expectedRevision = yield* coordinator.revision
      const expectedDimensionRevision = yield* coordinator.dimensionRevision('overworld')
      const tntId = EntityId('registered-tnt-0')
      const outcome = yield* tntService.prime({
        id: tntId,
        dimension: 'overworld',
        center: { x: 0.5, y: 64.5, z: 0.5 },
        expectedRevision,
        expectedDimensionRevision,
      })
      const snapshot = yield* coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema)

      expect(outcome.revision).toBe(expectedRevision + 1)
      expect(snapshot.state.tnts).toHaveLength(1)
      expect(snapshot.state.tnts[0]).toMatchObject({
        id: tntId,
        dimension: 'overworld',
        center: { x: 0.5, y: 64.5, z: 0.5 },
        state: { kind: 'primed' },
      })
    }),
  )

  it.effect('decodes the entity roster through its public strict schema', () =>
    Effect.sync(() => {
      const valid = Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [{
          id: EntityId('creeper-0'),
          kind: EntityKind('creeper'),
          feetPosition: { x: 0, y: 64, z: 0 },
          healthPoints: EntityHealthPoints(20),
          behaviour: {
            _tag: 'HostileMob',
            behaviour: { _tag: 'Dormant' },
            ageTicks: 0,
            persistent: false,
            named: false,
            tamed: false,
          },
        }],
        nextSerial: 1,
      })

      expect(Result.isSuccess(valid)).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({ entities: [] }))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [],
        nextSerial: null,
      }))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: null,
        nextSerial: 1,
      }))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [],
        nextSerial: 1,
        extra: true,
      }))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [{
          id: EntityId('creeper-0'),
          kind: EntityKind('creeper'),
          feetPosition: { x: 0, y: 64, z: 0 },
          healthPoints: EntityHealthPoints(20),
          behaviour: null,
        }],
        nextSerial: 1,
      }))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [{
          id: EntityId('creeper-0'),
          kind: EntityKind('creeper'),
          feetPosition: { x: 0, y: 64, z: 0 },
          healthPoints: EntityHealthPoints(20),
        }],
        nextSerial: 1,
      }))).toBe(true)
    }),
  )
})
