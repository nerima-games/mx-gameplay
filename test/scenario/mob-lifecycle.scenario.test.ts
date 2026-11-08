import { describe, expect, it } from '@effect/vitest'
import { SkyLightLevel } from '../../src/domain/mob/hostile-spawn'
import {
  AIR_BLOCK_ID,
  DeltaTimeSecs,
  InterpolationFraction,
  ProjectileIdSchema,
  WorldPositionSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import {
  ARROW_PROFILE,
  DomainEventBus,
  EntityId,
  PlayerServiceSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  EntityKind,
  makeProjectileService,
  makeTimeService,
  WorldRevisionConflict,
  type DomainEventBusApi,
  type PlayerServiceApi,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Ref, Schema, Stream } from 'effect'
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  isHostileMobSnapshot,
  repairMobBehaviour,
  maxHealthOfKind,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../../src/domain/entities/mob-frame'
import {
  BLAZE_KIND,
  initialEcosystemMobState,
  PASSIVE_MOB_KINDS,
  SKELETON_KIND,
  SPIDER_KIND,
} from '../../src/domain/mob/mob-ecosystem'
import { DroppedItemOwnerSnapshotSchema } from '../../src/domain/entities/dropped-item'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../../src/domain/entities/xp-orb'
import { GAMEPLAY_STAGE_IDS } from '../../src/stages/stage-ids'
import {
  gameplayStages,
  makeGameplayFrameState,
  requestMobSpawn,
} from '../../src/stages/registration'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../../src/stages/gameplay-owner-registrations'
import {
  makeGameplayCommitServices,
  makeTransactionalChunkStoreDouble,
} from '../support/transactional-stage-doubles'
import { STONE, WATER, world } from '../support/chunk-store-double'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { makeInventoryDouble } from '../support/inventory-service-double'
import { makePlayerServiceDouble, SPAWN_POSE } from '../support/player-service-double'
import { blockPosition, position } from '../support/coordinate-fixtures'
import { runFrame } from '../support/frame-runner'

const ZOMBIE_KIND = EntityKind('zombie')

const makeHarness = (
  playerPosition = position(0.5, 64, 0.5),
  initialWorld = world([[blockPosition(5, 63, 5), STONE]]),
  loadedChunks: ReadonlyArray<string> = ['0,0'],
  dimension: 'overworld' | 'nether' = 'overworld',
  decorateCoordinator?: (coordinator: WorldCommitCoordinatorApi) => WorldCommitCoordinatorApi,
) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(initialWorld, loadedChunks)
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble()
    const player = yield* makePlayerServiceDouble({
      ...SPAWN_POSE,
      feetPosition: playerPosition,
    }, dimension)
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      playerPose: yield* player.api.pose,
      dimension: yield* player.api.dimension,
    })
    const eventBus: DomainEventBusApi = { publish: () => Effect.void, events: Stream.empty }
    const projectileService = yield* makeProjectileService().pipe(
      Effect.provideService(WorldCommitCoordinator, commit.coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const gameplayCommit = {
      ...commit,
      coordinator: decorateCoordinator?.(commit.coordinator) ?? commit.coordinator,
      projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID,
      projectileService,
      eventBus,
    }
    const stages = gameplayStages(
      state,
      store.api,
      roster.api,
      inventory.api,
      player.api,
      time,
      undefined,
      undefined,
      {},
      gameplayCommit,
    )
    return { commit: gameplayCommit, inventory, player, roster, stages, state, store, time }
  })

const floorWorld = (
  minX: number,
  maxX: number,
  minZ = 0,
  maxZ = 0,
  extras: ReadonlyArray<readonly [ReturnType<typeof blockPosition>, typeof STONE]> = [],
) => world([
  ...Array.from({ length: maxZ - minZ + 1 }, (_z, zIndex) =>
    Array.from({ length: maxX - minX + 1 }, (_x, xIndex) => [blockPosition(minX + xIndex, 63, minZ + zIndex), STONE] as const),
  ).flat(),
  ...extras,
])

const spawnAttempt = (
  kind: MobSpawnAttempt['kind'],
  feetPosition: ReturnType<typeof position>,
  dimension: 'overworld' | 'nether' = 'overworld',
): MobSpawnAttempt => ({
  candidate: {
    groundBlock: STONE,
    footBlock: AIR_BLOCK_ID,
    headBlock: AIR_BLOCK_ID,
    blockLight: 0,
    skyLight: SkyLightLevel(0),
    biome: dimension === 'nether' ? 'NETHER' : 'PLAINS',
    timeOfDay: 0.9,
    distanceToPlayerBlocksXZ: 30,
    dimension,
  },
  kind,
  feetPosition,
})

const mobEntities = (coordinator: WorldCommitCoordinatorApi) =>
  Effect.map(
    coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
    (snapshot) => Schema.decodeUnknownSync(GameplayEntityRosterSchema)(snapshot.state).entities,
  )

const syncPlayerOwner = (coordinator: WorldCommitCoordinatorApi, player: PlayerServiceApi) =>
  Effect.gen(function* () {
    const current = yield* coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema)
    const [pose, dimension] = yield* Effect.all([player.pose, player.dimension])
    const state = Schema.decodeUnknownSync(PlayerServiceSnapshotSchema)({
      ...current.state,
      pose: {
        ...current.state.pose,
        feetPosition: { dimension, ...pose.feetPosition },
        yawRadians: pose.yawRadians,
        pitchRadians: pose.pitchRadians,
      },
    })
    yield* coordinator.commit({
      expectedRevision: current.revision,
      expectedDimensions: [],
      changes: [{ ownerId: GAMEPLAY_PLAYER_OWNER_ID, state }],
    })
  })

describe('mob lifecycle gameplay scenarios', () => {
  it.effect('spawns a queued passive mob and advances it through the SM3 ground step', () =>
    Effect.gen(function* () {
      const mobPosition = position(20.5, 64, 0.5)
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 28),
        ['0,0', '1,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* requestMobSpawn(harness.state, {
        candidate: {
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          skyLight: SkyLightLevel(0),
          biome: 'PLAINS',
          timeOfDay: 0.5,
          distanceToPlayerBlocksXZ: 30,
          dimension: 'overworld',
        },
        kind: PASSIVE_MOB_KINDS[0],
        feetPosition: mobPosition,
      })

      yield* runFrame(harness.stages, DeltaTimeSecs(0))
      const spawned = yield* mobEntities(harness.commit.coordinator)
      expect(spawned).toHaveLength(1)
      expect(PASSIVE_MOB_KINDS).toContain(spawned[0]?.kind)
      expect(spawned[0]?.healthPoints).toBe(maxHealthOfKind(spawned[0]!.kind))
      expect(spawned[0]?.feetPosition).toStrictEqual(mobPosition)

      for (let tick = 0; tick < 12; tick += 1) {
        yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
      }
      const advanced = yield* mobEntities(harness.commit.coordinator)
      expect(advanced).toHaveLength(1)
      expect(advanced[0]?.id).toBe(spawned[0]?.id)
      expect(advanced[0]?.feetPosition).not.toStrictEqual(mobPosition)
    }),
  )

  it.effect('routes a zombie around a wall and over a step through the entities stage', () =>
    Effect.gen(function* () {
      const wall = Array.from({ length: 2 }, (_y, yIndex) =>
        Array.from({ length: 3 }, (_z, zIndex) => [
          blockPosition(4, 64 + yIndex, -1 + zIndex),
          STONE,
        ] as const),
      ).flat()
      const initialWorld = new Map([
        ...floorWorld(0, 8, -4, 4, [
          [blockPosition(2, 64, 0), STONE],
        ]),
        ...world(wall),
      ])
      const playerPosition = position(0.5, 64, 0.5)
      const start = position(6.5, 64, 0.5)
      const harness = yield* makeHarness(playerPosition, initialWorld, ['0,-1', '0,0'])
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, start))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      for (let tick = 0; tick < 96; tick += 1) {
        yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
      }

      const zombie = (yield* mobEntities(harness.commit.coordinator)).find(({ kind }) => kind === ZOMBIE_KIND)
      expect(zombie).toBeDefined()
      const distanceToPlayer = zombie === undefined
        ? undefined
        : Math.hypot(zombie.feetPosition.x - playerPosition.x, zombie.feetPosition.z - playerPosition.z)
      expect(distanceToPlayer).toBeLessThanOrEqual(2)
      expect(zombie?.feetPosition).not.toStrictEqual(start)
    }),
  )

  it.effect('spawns a hostile creeper, then detonates once after the player approaches', () =>
    Effect.gen(function* () {
      const playerStart = position(25.5, 64, 5.5)
      const creeperPosition = position(5.5, 64, 5.5)
      const harness = yield* makeHarness(playerStart)
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))

      const attempt: MobSpawnAttempt = {
        candidate: {
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          skyLight: SkyLightLevel(0),
          biome: 'PLAINS',
          timeOfDay: 0.9,
          distanceToPlayerBlocksXZ: 30,
          dimension: 'overworld',
        },
        kind: CREEPER_KIND,
        feetPosition: creeperPosition,
      }
      yield* requestMobSpawn(harness.state, attempt)
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const spawned = yield* mobEntities(harness.commit.coordinator)
      expect(spawned).toHaveLength(1)
      expect(spawned[0]?.kind).toBe(CREEPER_KIND)
      expect(spawned[0]?.healthPoints).toBe(CREEPER_MAX_HEALTH)
      expect(spawned[0]?.behaviour).toMatchObject({ _tag: 'HostileMob', behaviour: { _tag: 'Dormant' } })

      yield* harness.player.api.moveTo(position(7.5, 64, 5.5))
      yield* syncPlayerOwner(harness.commit.coordinator, harness.player.api)
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      for (let tick = 0; tick < 30; tick += 1) {
        yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
      }

      const damages = yield* Ref.get(harness.state.playerDamages)
      expect(damages).toHaveLength(1)
      expect(damages[0]).toMatchObject({
        _tag: 'Explosion',
        kind: CREEPER_KIND,
        explosion: { source: 'creeper' },
      })
      expect(damages[0]?.damage.amount).toBeGreaterThan(0)
      expect(yield* mobEntities(harness.commit.coordinator)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.mobDrops)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.mobExperience)).toStrictEqual([])
      expect(yield* harness.store.blockAt(blockPosition(5, 63, 5))).toBeUndefined()
    }),
  )

  it.effect('launches a physical skeleton arrow and applies damage when it reaches the player', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 skeletons fire arrow projectile entities.
      // https://minecraft.wiki/w/Arrow
      let impactCommitAttempts = 0
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 12),
        ['0,0'],
        'overworld',
        (coordinator) => ({
          ...coordinator,
          commit: (request) => {
            const entityCandidate = request.changes.find(({ ownerId }) => ownerId === GAMEPLAY_ENTITIES_OWNER_ID)?.state
            const resolvedIds = typeof entityCandidate === 'object' && entityCandidate !== null
              ? (entityCandidate as { resolvedMobProjectileIds?: unknown }).resolvedMobProjectileIds
              : undefined
            const isImpactCommit = Array.isArray(resolvedIds) && resolvedIds.length > 0 &&
              request.changes.some(({ ownerId }) => ownerId === GAMEPLAY_VITALS_OWNER_ID)
            if (isImpactCommit) {
              impactCommitAttempts += 1
              if (impactCommitAttempts === 1) {
                return Effect.fail(new WorldRevisionConflict({
                  expected: request.expectedRevision,
                  actual: Schema.decodeUnknownSync(WorldRevisionSchema)(Number(request.expectedRevision) + 1),
                }))
              }
            }
            return coordinator.commit(request)
          },
        }),
      )
      const droppedItems = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        DroppedItemOwnerSnapshotSchema,
      )
      yield* harness.commit.coordinator.commit({
        expectedRevision: droppedItems.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
          state: {
            items: [{
              id: EntityId('test:dropped-item'),
              feetPosition: position(5.5, 64, 0.5),
              behaviour: { _tag: 'DroppedItem', item: 'dirt', count: 1, durability: null },
            }],
          },
        }],
      })
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, position(10.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      for (let tick = 0; tick < 5; tick += 1) yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const projectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(projectiles.state.projectiles).toStrictEqual([])
      expect(impactCommitAttempts).toBe(2)
      const playerDamages = yield* Ref.get(harness.state.playerDamages)
      expect(playerDamages).toContainEqual(expect.objectContaining({
        _tag: 'HostileContact',
        kind: SKELETON_KIND,
        damage: expect.objectContaining({ cause: 'projectile' }),
      }))
      expect(playerDamages.filter(({ damage }) => damage.cause === 'projectile')).toHaveLength(1)
      const entities = yield* harness.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(entities.state.resolvedMobProjectileIds).toHaveLength(1)
      expect(entities.state.pendingMobProjectileImpacts).toStrictEqual([])
      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
      const nextTickEntities = yield* harness.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      expect(nextTickEntities.state.resolvedMobProjectileIds).toStrictEqual(entities.state.resolvedMobProjectileIds)
      const remainingDroppedItems = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        DroppedItemOwnerSnapshotSchema,
      )
      expect(remainingDroppedItems.state.items).toHaveLength(1)
      const vitals = yield* harness.commit.coordinator.snapshot(
        harness.commit.vitalsOwnerId!,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      expect(vitals.state.vitals.healthPoints).toBe(17)
    }),
  )

  it.effect('recovers a persisted arrow impact and retires resolved projectiles', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(position(0.5, 64, 0.5), floorWorld(0, 12), ['0,0'])
      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)('mx-gameplay:mob:arrow:skeleton-0:0')
      const expiredProjectileId = Schema.decodeUnknownSync(ProjectileIdSchema)('mx-gameplay:mob:arrow:skeleton-expired:0')
      const source = EntityId('skeleton-0')
      const point = Schema.decodeUnknownSync(WorldPositionSchema)({
        dimension: 'overworld',
        x: 0.5,
        y: 65.62,
        z: 0.5,
      })
      const entitySnapshot = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const projectileSnapshot = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [{
          id: projectileId,
          dimension: 'overworld',
          shooter: source,
          kind: 'projectile',
          profile: ARROW_PROFILE,
          projectile: {
            state: 'despawned',
            reason: 'entity-hit',
            position: position(0.5, 65.62, 0.5),
            velocity: { x: 0, y: 0, z: 0 },
            ageSeconds: 0.1,
            shooterId: source,
          },
        }, {
          id: expiredProjectileId,
          dimension: 'overworld',
          shooter: EntityId('skeleton-expired'),
          kind: 'projectile',
          profile: ARROW_PROFILE,
          projectile: {
            state: 'despawned',
            reason: 'lifetime',
            position: position(8, 65, 0.5),
            velocity: { x: 0, y: 0, z: 0 },
            ageSeconds: 3,
            shooterId: EntityId('skeleton-expired'),
          },
        },
        ],
      })
      const entityCandidate = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
        ...entitySnapshot.state,
        resolvedMobProjectileIds: [Schema.decodeUnknownSync(ProjectileIdSchema)('mx-gameplay:mob:arrow:old-skeleton:42')],
        pendingMobProjectileImpacts: [{
          id: projectileId,
          source,
          kind: SKELETON_KIND,
          hit: { kind: 'entity', entityId: EntityId('mx-gameplay:player-avatar'), point },
        }],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: yield* harness.commit.coordinator.revision,
        expectedDimensions: [],
        changes: [
          { ownerId: GAMEPLAY_ENTITIES_OWNER_ID, state: entityCandidate },
          { ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectileSnapshot },
        ],
      })

      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const entities = yield* harness.commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      const projectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      const vitals = yield* harness.commit.coordinator.snapshot(
        harness.commit.vitalsOwnerId!,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      expect(entities.state.pendingMobProjectileImpacts).toStrictEqual([])
      expect(entities.state.resolvedMobProjectileIds).toStrictEqual([projectileId])
      expect(projectiles.state.projectiles).toStrictEqual([])
      expect(vitals.state.vitals.healthPoints).toBe(17)
      expect((yield* Ref.get(harness.state.playerDamages)).filter(({ damage }) => damage.cause === 'projectile')).toHaveLength(1)
    }),
  )

  it.effect('does not step a flying mob projectile twice in one simulation tick', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 12),
        ['0,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, position(10.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))
      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const entitiesStage = harness.stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.entities)!
      yield* runFrame([entitiesStage], DeltaTimeSecs(1 / 20))
      const afterOneStep = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(afterOneStep.state.projectiles).toHaveLength(1)
      expect(afterOneStep.state.projectiles[0]?.projectile.state).toBe('flying')
      const ageAfterOneStep = afterOneStep.state.projectiles[0]!.projectile.ageSeconds

      yield* runFrame([entitiesStage], DeltaTimeSecs(1 / 20))
      const afterSameTickRetry = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(afterSameTickRetry.state.projectiles[0]?.projectile.ageSeconds).toBe(ageAfterOneStep)
    }),
  )

  it.effect('stops an in-flight arrow at a block added after launch', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(position(0.5, 64, 0.5), floorWorld(0, 12), ['0,0'])
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, position(10.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))
      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
      const entitiesStage = harness.stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.entities)!
      const launched = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(launched.state.projectiles).toHaveLength(1)
      expect(launched.state.projectiles[0]?.projectile.state).toBe('flying')

      yield* harness.store.api.setBlock(blockPosition(5, 65, 0), STONE)
      for (let tick = 0; tick < 4; tick += 1) yield* runFrame([entitiesStage], DeltaTimeSecs(1 / 20))

      const afterBlockHit = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(afterBlockHit.state.projectiles).toStrictEqual([])
      expect(yield* Ref.get(harness.state.playerDamages)).toStrictEqual([])
    }),
  )

  it.effect('does not launch a ranged mob projectile through an opaque block', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 12, 0, 0, [[blockPosition(5, 65, 0), STONE]]),
        ['0,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, position(10.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))
      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const projectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(projectiles.state.projectiles).toStrictEqual([])
      expect(yield* Ref.get(harness.state.playerDamages)).toStrictEqual([])
    }),
  )

  it.effect('launches a zero-gravity physical Blaze fireball and ignites a hit player', () =>
    Effect.gen(function* () {
      const blazeStart = position(10.5, 64, 0.5)
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 12),
        ['0,0'],
        'nether',
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* requestMobSpawn(harness.state, spawnAttempt(BLAZE_KIND, blazeStart, 'nether'))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))
      const spawnedBlaze = (yield* mobEntities(harness.commit.coordinator)).find(({ kind }) => kind === BLAZE_KIND)
      expect(spawnedBlaze?.feetPosition).toStrictEqual(blazeStart)
      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
      const advancedBlaze = (yield* mobEntities(harness.commit.coordinator)).find(({ kind }) => kind === BLAZE_KIND)
      const spawnedBlazeBehaviour = advancedBlaze?.behaviour
      const blazeBehaviour = isHostileMobSnapshot(spawnedBlazeBehaviour)
        ? spawnedBlazeBehaviour.behaviour
        : spawnedBlazeBehaviour
      expect(blazeBehaviour?._tag === 'EcosystemMob' ? blazeBehaviour.movementGoal : undefined).toBeDefined()

      for (let tick = 0; tick < 6; tick += 1) yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const flyingFireball = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(flyingFireball.state.projectiles).toHaveLength(1)
      expect(flyingFireball.state.projectiles[0]?.profile.gravity).toBe(0)
      expect(flyingFireball.state.projectiles[0]?.projectile.state).toBe('flying')

      for (let tick = 0; tick < 6; tick += 1) yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const stationaryBlaze = (yield* mobEntities(harness.commit.coordinator)).find(({ kind }) => kind === BLAZE_KIND)
      expect(stationaryBlaze?.feetPosition).toStrictEqual(blazeStart)

      const projectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(projectiles.state.projectiles).toStrictEqual([])
      expect(yield* Ref.get(harness.state.fireLifecycle)).toMatchObject({
        burningActors: [expect.objectContaining({ id: 'player', remainingTicks: expect.any(Number) })],
      })
      expect(yield* Ref.get(harness.state.playerDamages)).toContainEqual(expect.objectContaining({
        damage: expect.objectContaining({ cause: 'in_fire' }),
      }))
    }),
  )

  it.effect('climbs a wall with the SM3 spider profile when the path is blocked', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 spiders climb vertical walls when their path is blocked.
      // https://minecraft.wiki/w/Spider#Behavior
      const wall = Array.from({ length: 6 }, (_y, yIndex) =>
        Array.from({ length: 32 }, (_z, zIndex) => [
          blockPosition(2, 64 + yIndex, -16 + zIndex),
          STONE,
        ] as const),
      ).flat()
      const initialWorld = new Map([...floorWorld(-2, 6, -16, 15), ...world(wall)])
      const harness = yield* makeHarness(
        position(0.5, 70, 0.5),
        initialWorld,
        ['-1,-1', '-1,0', '0,-1', '0,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(SPIDER_KIND, position(0.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      for (let tick = 0; tick < 16; tick += 1) yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const spider = (yield* mobEntities(harness.commit.coordinator)).find(({ kind }) => kind === SPIDER_KIND)
      expect(spider).toBeDefined()
      expect(spider?.feetPosition.y).toBeGreaterThan(64)
    }),
  )

  it.effect('burns exposed undead in daylight but not in water, shade, or head protection', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 burns exposed undead for 8 seconds; water, shade, and head armor protect them.
      // https://minecraft.wiki/w/Sun#Sunlight
      const protectedAt = position(16.5, 64, 0.5)
      const shade = Array.from({ length: 7 }, (_x, xIndex) =>
        Array.from({ length: 7 }, (_z, zIndex) => [
          blockPosition(5 + xIndex, 66, -3 + zIndex),
          STONE,
        ] as const),
      ).flat()
      const initialWorld = floorWorld(0, 20, 0, 0, [
        [blockPosition(5, 64, 0), WATER],
        ...shade,
      ])
      const harness = yield* makeHarness(
        position(100.5, 64, 0.5),
        initialWorld,
        ['0,0', '1,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, position(2.5, 64, 0.5)))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, position(5.5, 64, 0.5)))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, position(8.5, 64, 0.5)))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, protectedAt))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, position(14.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const snapshot = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const entities = snapshot.state.entities.map((entity) => {
        if (entity.feetPosition.x !== protectedAt.x) return entity
        const repaired = repairMobBehaviour(entity.kind, entity.behaviour)
        const previous = isHostileMobSnapshot(repaired) && repaired.behaviour?._tag === 'EcosystemMob'
          ? repaired.behaviour
          : initialEcosystemMobState()
        return {
          ...entity,
          behaviour: {
            _tag: 'HostileMob' as const,
            behaviour: { ...previous, hasHeadProtection: true },
            ageTicks: 0,
            persistent: false,
            named: false,
            tamed: false,
          },
        }
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: snapshot.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
          state: Schema.decodeUnknownSync(GameplayEntityRosterSchema)({ ...snapshot.state, entities }),
        }],
      })
      for (let tick = 0; tick < 20; tick += 1) yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const after = yield* mobEntities(harness.commit.coordinator)
      const entityAt = (x: number, kind: typeof ZOMBIE_KIND | typeof SKELETON_KIND = ZOMBIE_KIND) =>
        after.find((candidate) => candidate.kind === kind && Math.abs(candidate.feetPosition.x - x) < 0.2)
      const stateAt = (x: number, kind: typeof ZOMBIE_KIND | typeof SKELETON_KIND = ZOMBIE_KIND) => {
        const entity = entityAt(x, kind)
        const behaviour = entity?.behaviour
        const inner = isHostileMobSnapshot(behaviour) ? behaviour.behaviour : behaviour
        return inner?._tag === 'EcosystemMob' ? inner : undefined
      }
      expect(entityAt(2.5)?.healthPoints).toBe(19)
      expect(entityAt(5.5)?.healthPoints).toBe(20)
      expect(entityAt(8.5)?.healthPoints).toBe(20)
      expect(entityAt(protectedAt.x)?.healthPoints).toBe(20)
      expect(entityAt(14.5, SKELETON_KIND)?.healthPoints).toBe(19)
      expect(stateAt(2.5)?.burningTicks).toBeGreaterThan(0)
      expect(stateAt(5.5)?.burningTicks).toBe(0)
      expect(stateAt(8.5)?.burningTicks).toBe(0)
      expect(stateAt(protectedAt.x)?.burningTicks).toBe(0)
      expect(stateAt(14.5, SKELETON_KIND)?.burningTicks).toBeGreaterThan(0)
    }),
  )

  it.effect('continues daylight burning for a stationary skeleton in its ranged band', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 20),
        ['0,0', '1,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, position(14.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      for (let tick = 0; tick < 20; tick += 1) {
        yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
      }

      const skeleton = (yield* mobEntities(harness.commit.coordinator)).find(({ kind }) => kind === SKELETON_KIND)
      expect(skeleton?.feetPosition).toStrictEqual(position(14.5, 64, 0.5))
      expect(skeleton?.healthPoints).toBe(19)
    }),
  )
})
