import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { ProjectileIdSchema, WorldIdSchema } from '@nerima-games/mc-kernel'
import {
  EntityId,
  EntityKind,
  EntityHealthPoints,
  EntitySerial,
  makeTntService,
  makeWorldCommitCoordinator,
  PROJECTILE_REPLICATED_OWNER_ID,
  TNT_REPLICATED_OWNER_ID,
  TntServiceSnapshotSchema,
  MobMovementStateSchema,
  WorldCommitCoordinator,
} from '@nerima-games/mc-sim'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_OWNER_REGISTRATIONS,
  GameplayEntityRosterSchema,
  GameplayMobBehaviourSchema,
  gameplayOwnerRegistrations,
  restoreGameplayEntityMetadata,
  type GameplayOwnerInitialState,
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
          dimension: 'overworld',
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

  it.effect('strictly decodes every gameplay mob-behaviour family', () =>
    Effect.sync(() => {
      const movement = Schema.decodeUnknownSync(MobMovementStateSchema)({
        id: EntityId('owner-registration-mob'),
        body: { kind: 'dynamic', x: 0, y: 64.9, z: 0, vx: 0, vy: 0, vz: 0 },
        profile: { kind: 'ground', width: 0.6, height: 1.8, canJump: true },
        goal: { x: 2, y: 64, z: 0 },
        path: [],
        pathIndex: 0,
        stuckTicks: 0,
        isGrounded: false,
        movementSpeed: 2.5,
      })
      const valid = [
        undefined,
        { _tag: 'Dormant' },
        { _tag: 'Detonated' },
        { _tag: 'Lit', burnedSecs: 0.5 },
        { _tag: 'Steady' },
        { _tag: 'Struck' },
        { _tag: 'EcosystemMob', attackCooldownTicks: 0, motionPhase: 0.25, provoked: false },
        { _tag: 'EcosystemMob', attackCooldownTicks: 0, motionPhase: 0.25, provoked: false, movement },
        { _tag: 'EcosystemMob', attackCooldownSecs: 0.05, motionPhase: 0.25, provoked: false },
        {
          _tag: 'DroppedItem', item: 'stone', count: 2, durability: null,
          eligibleFromFrame: 3, customName: 'Stone',
        },
        {
          _tag: 'DroppedItem', item: 'bow', count: 1, durability: { current: 384, max: 384 },
          enchantments: [{ id: 'power', level: 1 }],
        },
        { _tag: 'PrimedTnt', burnedSecs: 0 },
        {
          _tag: 'HostileMob', behaviour: { _tag: 'EcosystemMob', attackCooldownTicks: 0, motionPhase: 0, provoked: true },
          ageTicks: 0, persistent: false, named: false, tamed: false,
        },
      ]
      for (const behaviour of valid) {
        expect(Result.isSuccess(Schema.decodeUnknownResult(GameplayMobBehaviourSchema)(behaviour))).toBe(true)
      }

      const invalid = [
        0,
        { _tag: 'Lit', burnedSecs: -1 },
        { _tag: 'Steady', extra: true },
        { _tag: 'EcosystemMob', attackCooldownSecs: 0, motionPhase: 0, provoked: false, extra: true },
        { _tag: 'EcosystemMob', attackCooldownTicks: 0, motionPhase: 0, provoked: false, extra: true },
        { _tag: 'DroppedItem', item: 'stone', count: 1, durability: null, extra: true },
        {
          _tag: 'DroppedItem', item: 'bow', count: 1, durability: { current: 384, max: 384 },
          enchantments: [{ id: 'invalid', level: 1 }],
        },
        { _tag: 'PrimedTnt', burnedSecs: -1 },
        { _tag: 'HostileMob', behaviour: { _tag: 'Dormant', extra: true }, ageTicks: 0, persistent: false, named: false, tamed: false },
        { _tag: 'HostileMob', behaviour: 0, ageTicks: 0, persistent: false, named: false, tamed: false },
        { _tag: 'HostileMob', behaviour: undefined, ageTicks: 0, persistent: false, named: false, tamed: false },
      ]
      for (const behaviour of invalid) {
        expect(Result.isFailure(Schema.decodeUnknownResult(GameplayMobBehaviourSchema)(behaviour))).toBe(true)
      }
    }),
  )

  it.effect('preserves resolved projectile IDs and pending impacts when restoring a narrowed roster', () =>
    Effect.sync(() => {
      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)('mx-gameplay:mob:arrow:zombie-0:20')
      const previous = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
        entities: [],
        nextSerial: 1,
        resolvedMobProjectileIds: [projectileId],
        pendingMobProjectileImpacts: [{
          id: projectileId,
          source: EntityId('zombie-0'),
          kind: 'skeleton',
          hit: {
            kind: 'entity',
            entityId: EntityId('zombie-target'),
            point: { dimension: 'overworld', x: 0.5, y: 64, z: 0.5 },
          },
        }],
      })
      const narrowed = { entities: [], nextSerial: previous.nextSerial }

      const restored = Result.getOrThrow(restoreGameplayEntityMetadata(narrowed, previous, 'overworld'))

      expect(restored.resolvedMobProjectileIds).toStrictEqual([projectileId])
      expect(restored.pendingMobProjectileImpacts).toStrictEqual(previous.pendingMobProjectileImpacts)
    }),
  )

  it.effect('returns typed failures for explicitly undefined persisted metadata and registration fields', () =>
    Effect.sync(() => {
      const previous = Result.getOrThrow(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [],
        nextSerial: EntitySerial(0),
      }))
      const malformed = {
        entities: [],
        nextSerial: previous.nextSerial,
        resolvedMobProjectileIds: undefined,
      } as unknown as typeof previous & { resolvedMobProjectileIds?: ReadonlyArray<never> }
      expect(restoreGameplayEntityMetadata(malformed, previous, 'overworld')).toStrictEqual(Result.fail({
        _tag: 'InvalidGameplayEntityMetadata',
        field: 'resolvedMobProjectileIds',
      }))

      const explicitUndefinedDimension = {
        entities: [{ dimension: undefined }],
        nextSerial: previous.nextSerial,
      } as unknown as typeof previous
      expect(restoreGameplayEntityMetadata(explicitUndefinedDimension, previous, 'overworld')).toStrictEqual(Result.fail({
        _tag: 'InvalidGameplayEntityMetadata',
        field: 'dimension',
      }))

      expect(gameplayOwnerRegistrations({ playerStorage: undefined } as unknown as GameplayOwnerInitialState)).toStrictEqual(Result.fail({
        _tag: 'ExplicitUndefinedGameplayOwnerInitialState',
        field: 'playerStorage',
      }))
    }),
  )

  it.effect('preserves no-state entity behaviour through raw owner registration and JSON restoration', () =>
    Effect.gen(function* () {
      const initial = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
        entities: [{
          id: EntityId('owner-no-state'), kind: EntityKind('pig'),
          feetPosition: { x: 0, y: 64, z: 0 }, dimension: 'overworld',
          healthPoints: EntityHealthPoints(10), behaviour: undefined,
        }],
        nextSerial: EntitySerial(1),
      })
      expect(Object.hasOwn(initial.entities[0]!, 'behaviour')).toBe(true)
      const serialized: unknown = JSON.parse(JSON.stringify(initial))
      const restored = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(serialized)
      expect(restored).toStrictEqual(initial)
      const owners = Result.getOrThrow(gameplayOwnerRegistrations({ entities: initial }))
      const coordinator = yield* makeWorldCommitCoordinator({
        world: Schema.decodeUnknownSync(WorldIdSchema)('gameplay-no-state-roundtrip'),
        owners,
      })
      const snapshot = yield* coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(snapshot.state.entities).toStrictEqual(initial.entities)
      expect(Result.getOrThrow(restoreGameplayEntityMetadata(initial, restored, 'overworld'))).toStrictEqual(initial)
    }),
  )
})
