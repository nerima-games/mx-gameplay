import { describe, expect, it } from '@effect/vitest'
import { SkyLightLevel } from '../../src/domain/mob/hostile-spawn'
import {
  AIR_BLOCK_ID,
  DeltaTimeSecs,
  EntityHealthPoints,
  InterpolationFraction,
  blockIdOf,
  ProjectileIdSchema,
  WorldPositionSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import {
  ARROW_PROFILE,
  DomainEventBus,
  EntityId,
  PlayerServiceSnapshotSchema,
  MobMovementStateSchema,
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
import { Cause, Effect, Exit, Option, Ref, Schema, Stream } from 'effect'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  DROPPED_ITEM_KIND,
  isHostileMobSnapshot,
  repairMobBehaviour,
  maxHealthOfKind,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../../src/domain/entities/mob-frame'
import {
  BLAZE_KIND,
  CHICKEN_KIND,
  COW_KIND,
  ENDERMAN_KIND,
  initialEcosystemMobState,
  PASSIVE_MOB_KINDS,
  PIG_KIND,
  SKELETON_KIND,
  SHEEP_KIND,
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
// Keep the stage's private fireball profile in persisted projectile fixtures without exposing a test-only production API.
const BLAZE_FIREBALL_PROFILE_FIXTURE = {
  ...ARROW_PROFILE,
  gravity: 0,
  airDrag: 1,
  waterDrag: 1,
  maxLifetimeSeconds: 3,
} as const

const makeHarness = (
  playerPosition = position(0.5, 64, 0.5),
  initialWorld = world([[blockPosition(5, 63, 5), STONE]]),
  loadedChunks: ReadonlyArray<string> = ['0,0'],
  dimension: 'overworld' | 'nether' = 'overworld',
  decorateCoordinator?: (coordinator: WorldCommitCoordinatorApi) => WorldCommitCoordinatorApi,
  adaptStore?: (store: ChunkStoreApi) => ChunkStoreApi,
) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(initialWorld, loadedChunks)
    const gameplayStore = adaptStore?.(store.api) ?? store.api
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble()
    const player = yield* makePlayerServiceDouble({
      ...SPAWN_POSE,
      feetPosition: playerPosition,
    }, dimension)
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    const commit = yield* makeGameplayCommitServices(gameplayStore, inventory.api, {
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
      gameplayStore,
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

const withShortChunkBuffer = (store: ChunkStoreApi): ChunkStoreApi => ({
  ...store,
  peek: (coord) => Effect.map(store.peek(coord), (chunk) =>
    chunk === undefined || Number(coord.cx) !== 0 || Number(coord.cz) !== 0
      ? chunk
      : { ...chunk, blocks: Uint16Array.from(chunk.blocks).subarray(0, 1) },
  ),
})

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

const flyingMobArrow = (
  rawId: string,
  shooter: ReturnType<typeof EntityId>,
  at = position(8.5, 65.62, 0.5),
) => ({
  id: Schema.decodeUnknownSync(ProjectileIdSchema)(rawId),
  dimension: 'overworld' as const,
  shooter,
  kind: 'projectile' as const,
  profile: ARROW_PROFILE,
  projectile: {
    state: 'flying' as const,
    position: at,
    velocity: { x: -60, y: 0, z: 0 },
    ageSeconds: 0,
    shooterId: shooter,
  },
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

  it.effect('uses the fixed SM3 ground profile for each passive mob kind', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 passive mobs wander when no threat is nearby.
      // https://minecraft.wiki/w/Animal#Behavior
      const start = position(20.5, 64, 0.5)
      const cases = [
        { kind: COW_KIND, profile: { kind: 'ground', width: 0.9, height: 1.4, canJump: true } },
        { kind: PIG_KIND, profile: { kind: 'ground', width: 0.9, height: 0.9, canJump: true } },
        { kind: SHEEP_KIND, profile: { kind: 'ground', width: 0.9, height: 1.4, canJump: true } },
        { kind: CHICKEN_KIND, profile: { kind: 'ground', width: 0.4, height: 0.7, canJump: true } },
      ] as const

      for (const { kind, profile } of cases) {
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
          kind,
          feetPosition: start,
        })
        yield* runFrame(harness.stages, DeltaTimeSecs(0))

        const spawned = yield* mobEntities(harness.commit.coordinator)
        const initial = spawned.find((entity) => entity.kind === kind)
        expect(initial?.feetPosition).toStrictEqual(start)

        for (let tick = 0; tick < 12; tick += 1) {
          yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
        }

        const advanced = yield* mobEntities(harness.commit.coordinator)
        const moved = advanced.find((entity) => entity.id === initial?.id)
        expect(moved?.feetPosition).not.toStrictEqual(start)
        expect(moved?.behaviour).toMatchObject({ movement: { profile } })
      }
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

      let latestMobs = yield* mobEntities(harness.commit.coordinator)
      for (let tick = 0; tick < 96; tick += 1) {
        yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
        if ((tick + 1) % 8 === 0) {
          latestMobs = yield* mobEntities(harness.commit.coordinator)
        }
      }

      const zombie = latestMobs.find(({ kind }) => kind === ZOMBIE_KIND)
      expect(zombie).toBeDefined()
      const distanceToPlayer = zombie === undefined
        ? undefined
        : Math.hypot(zombie.feetPosition.x - playerPosition.x, zombie.feetPosition.z - playerPosition.z)
      expect(distanceToPlayer).toBeLessThanOrEqual(2)
      expect(zombie?.feetPosition).not.toStrictEqual(start)
    }),
  )

  it.effect('keeps a zombie inside the loaded chunk while the composed gameplay tick succeeds', () =>
    Effect.gen(function* () {
      const start = position(15.5, 64, 0.5)
      const harness = yield* makeHarness(
        position(20.5, 64, 0.5),
        floorWorld(0, 15),
        ['0,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, start))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const before = (yield* mobEntities(harness.commit.coordinator)).find(({ kind }) => kind === ZOMBIE_KIND)
      expect(before?.feetPosition).toStrictEqual(start)

      const tick = yield* Effect.exit(runFrame(harness.stages, DeltaTimeSecs(1 / 20)))
      expect(Exit.isSuccess(tick)).toBe(true)
      const after = (yield* mobEntities(harness.commit.coordinator)).find(({ id }) => id === before?.id)
      expect(after?.feetPosition).toStrictEqual(start)
      expect(after?.feetPosition.x).toBeLessThan(16)
    }),
  )

  it.effect('returns a typed movement failure for a short chunk buffer through the gameplay stage', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 8),
        ['0,0'],
        'overworld',
        undefined,
        withShortChunkBuffer,
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* requestMobSpawn(harness.state, spawnAttempt(PASSIVE_MOB_KINDS[0]!, position(5.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const tick = yield* Effect.exit(runFrame(harness.stages, DeltaTimeSecs(1 / 20)))
      expect(Exit.isFailure(tick)).toBe(true)
      if (!Exit.isFailure(tick)) return
      expect(Cause.squash(tick.cause)).toMatchObject({
        _tag: 'MobMovementRosterFailure',
        reason: 'world-query-failed',
        worldFailure: { _tag: 'EntityWorldCorruptBuffer' },
      })
    }),
  )

  it.effect('holds a saved arrow when its next tick reaches an unloaded chunk', () =>
    Effect.gen(function* () {
      const start = position(15.5, 65.62, 0.5)
      const rawId = 'mx-gameplay:mob:arrow:unloaded-boundary:0'
      const source = EntityId('scenario:unloaded-boundary-arrow')
      const savedArrow = flyingMobArrow(rawId, source, start)
      const projectileSnapshot = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [{
          ...savedArrow,
          projectile: {
            ...savedArrow.projectile,
            velocity: { x: 60, y: 0, z: 0 },
          },
        }],
      })
      const harness = yield* makeHarness(
        position(20.5, 64, 0.5),
        floorWorld(0, 15),
        ['0,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* harness.commit.coordinator.commit({
        expectedRevision: yield* harness.commit.coordinator.revision,
        expectedDimensions: [],
        changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectileSnapshot }],
      })

      const tick = yield* Effect.exit(runFrame(harness.stages, DeltaTimeSecs(1 / 20)))
      expect(Exit.isSuccess(tick)).toBe(true)
      const after = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(after.state.projectiles).toHaveLength(1)
      expect(after.state.projectiles[0]?.projectile).toMatchObject({
        state: 'flying',
        position: start,
        ageSeconds: 0,
      })
    }),
  )

  it.effect('stops SM3 movement after a zombie reaches its melee goal', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 zombies attack players at close range.
      // https://minecraft.wiki/w/Zombie#Behavior
      const playerPosition = position(0.5, 64, 0.5)
      const harness = yield* makeHarness(playerPosition, floorWorld(0, 8), ['0,0'])
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, position(2.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))
      const initial = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const zombie = initial.state.entities.find(({ kind }) => kind === ZOMBIE_KIND)
      expect(zombie).toBeDefined()
      const movement = Schema.decodeUnknownSync(MobMovementStateSchema)({
        id: zombie!.id,
        body: { kind: 'dynamic', x: 2, y: 64.975, z: 0.5, vx: 0, vy: 0, vz: 0 },
        profile: { kind: 'ground', width: 0.6, height: 1.95, canJump: true },
        goal: { x: 0, y: 64, z: 0 },
        path: [],
        pathIndex: 0,
        stuckTicks: 0,
        isGrounded: true,
        movementSpeed: 2.5,
      })
      const entities = initial.state.entities.map((entity) => entity.id === zombie!.id
        ? {
          ...entity,
          feetPosition: position(2, 64, 0.5),
          behaviour: {
            ...initialEcosystemMobState(),
            movementGoal: playerPosition,
            movement,
          },
        }
        : entity)
      yield* harness.commit.coordinator.commit({
        expectedRevision: initial.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
          state: Schema.decodeUnknownSync(GameplayEntityRosterSchema)({ ...initial.state, entities }),
        }],
      })
      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const advanced = (yield* mobEntities(harness.commit.coordinator)).find(({ id }) => id === zombie!.id)
      expect(advanced?.feetPosition).toStrictEqual(position(2, 64, 0.5))
      expect(yield* Ref.get(harness.state.playerDamages)).toContainEqual(expect.objectContaining({
        _tag: 'HostileContact',
        kind: ZOMBIE_KIND,
        damage: { amount: 3, cause: 'mob' },
      }))
    }),
  )

  it.effect('reports an out-of-world persisted movement body through the gameplay stage', () =>
    Effect.gen(function* () {
      const playerPosition = position(0.5, 64, 0.5)
      const harness = yield* makeHarness(playerPosition, floorWorld(0, 8), ['0,0'])
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, position(2.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))
      const initial = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const zombie = initial.state.entities.find(({ kind }) => kind === ZOMBIE_KIND)
      expect(zombie).toBeDefined()
      const movement = Schema.decodeUnknownSync(MobMovementStateSchema)({
        id: zombie!.id,
        body: { kind: 'dynamic', x: Number.MAX_SAFE_INTEGER + 1, y: 64.975, z: 0.5, vx: 0, vy: 0, vz: 0 },
        profile: { kind: 'ground', width: 0.6, height: 1.95, canJump: true },
        goal: { x: 0, y: 64, z: 0 },
        path: [],
        pathIndex: 0,
        stuckTicks: 0,
        isGrounded: false,
        movementSpeed: 2.5,
      })
      const entities = initial.state.entities.map((entity) => entity.id === zombie!.id
        ? {
          ...entity,
          behaviour: {
            ...initialEcosystemMobState(),
            movementGoal: playerPosition,
            movement,
          },
        }
        : entity)
      yield* harness.commit.coordinator.commit({
        expectedRevision: initial.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
          state: Schema.decodeUnknownSync(GameplayEntityRosterSchema)({ ...initial.state, entities }),
        }],
      })

      const result = yield* Effect.exit(runFrame(harness.stages, DeltaTimeSecs(1 / 20)))
      expect(Exit.hasDies(result)).toBe(true)
      if (!Exit.isFailure(result)) return
      expect(Cause.squash(result.cause)).toMatchObject({
        _tag: 'MobMovementRosterFailure',
        reason: 'step-failed',
        entityId: zombie!.id,
        failure: { _tag: 'MobMovementPhysicsFailure', reason: 'invalid-body' },
      })
    }),
  )

  it.effect('keeps undead unburned when the daylight head coordinate is outside BlockAxis', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 16),
        ['0,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, position(10.5, 64, 0.5)))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const initial = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const zombie = initial.state.entities.find(({ kind }) => kind === ZOMBIE_KIND)
      expect(zombie).toBeDefined()
      const entities = initial.state.entities.map((entity) => entity.id === zombie!.id
        ? {
          ...entity,
          feetPosition: position(100.5, Number.MAX_SAFE_INTEGER, 0.5),
          behaviour: {
            _tag: 'HostileMob' as const,
            behaviour: initialEcosystemMobState(),
            ageTicks: 1,
            persistent: true,
            named: false,
            tamed: false,
          },
        }
        : entity)
      yield* harness.commit.coordinator.commit({
        expectedRevision: initial.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
          state: Schema.decodeUnknownSync(GameplayEntityRosterSchema)({ ...initial.state, entities }),
        }],
      })
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))

      const entitiesStage = harness.stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.entities)!
      const tick = yield* Effect.exit(runFrame([entitiesStage], DeltaTimeSecs(1 / 20)))
      expect(Exit.isSuccess(tick)).toBe(true)
      const after = (yield* mobEntities(harness.commit.coordinator)).find(({ id }) => id === zombie!.id)
      expect(after?.healthPoints).toBe(20)
      const behaviour = after?.behaviour
      const ecosystem = isHostileMobSnapshot(behaviour) ? behaviour.behaviour : behaviour
      expect(ecosystem).toMatchObject({ _tag: 'EcosystemMob', burningTicks: 0 })
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

  it.effect('hits a same-dimension mob while skipping dropped-item and other-dimension colliders', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 skeleton arrows can damage other mobs.
      // https://minecraft.wiki/w/Arrow
      const targetStart = position(4.5, 64, 0.5)
      const otherDimensionStart = position(6.5, 64, 0.5)
      const droppedItemStart = position(8.5, 64, 0.5)
      const harness = yield* makeHarness(position(0.5, 64, 0.5), floorWorld(0, 12), ['0,0'])
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
              id: EntityId('scenario:world-dropped-item'),
              feetPosition: droppedItemStart,
              behaviour: { _tag: 'DroppedItem', item: 'dirt', count: 1, durability: null },
            }],
          },
        }],
      })
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, position(10.5, 64, 0.5)))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, targetStart))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, otherDimensionStart))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const initial = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const target = initial.state.entities.find(({ kind, feetPosition }) =>
        kind === ZOMBIE_KIND && feetPosition.x === targetStart.x,
      )
      const otherDimensionTarget = initial.state.entities.find(({ kind, feetPosition }) =>
        kind === ZOMBIE_KIND && feetPosition.x === otherDimensionStart.x,
      )
      expect(target).toBeDefined()
      expect(otherDimensionTarget).toBeDefined()
      const entities = [
        ...initial.state.entities.map((entity) => entity.id === otherDimensionTarget?.id
          ? { ...entity, dimension: 'nether' as const }
          : entity),
        {
          id: EntityId('scenario:legacy-dropped-item'),
          kind: DROPPED_ITEM_KIND,
          feetPosition: droppedItemStart,
          dimension: 'overworld' as const,
          healthPoints: EntityHealthPoints(1),
          behaviour: { _tag: 'DroppedItem' as const, item: 'dirt', count: 1, durability: null },
        },
      ]
      yield* harness.commit.coordinator.commit({
        expectedRevision: initial.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
          state: Schema.decodeUnknownSync(GameplayEntityRosterSchema)({ ...initial.state, entities }),
        }],
      })

      for (let tick = 0; tick < 5; tick += 1) {
        yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))
      }

      const after = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const hitTarget = after.state.entities.find(({ id }) => id === target!.id)
      const skippedTarget = after.state.entities.find(({ id }) => id === otherDimensionTarget!.id)
      const skippedItem = after.state.entities.find(({ id }) => id === EntityId('scenario:legacy-dropped-item'))
      expect(hitTarget?.healthPoints).toBe(17)
      expect(skippedTarget?.healthPoints).toBe(20)
      expect(skippedItem?.healthPoints).toBe(1)
      expect(skippedItem?.behaviour).toMatchObject({ _tag: 'DroppedItem', item: 'dirt' })
      expect(after.state.pendingMobProjectileImpacts).toStrictEqual([])
      expect((yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )).state.projectiles).toStrictEqual([])
      expect((yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        DroppedItemOwnerSnapshotSchema,
      )).state.items).toHaveLength(1)
      expect(yield* Ref.get(harness.state.playerDamages)).toStrictEqual([])
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

  it.effect('turns a persisted stuck mob projectile into a pending impact', () =>
    Effect.gen(function* () {
      const source = EntityId('scenario:stuck-skeleton')
      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)('mx-gameplay:mob:arrow:stuck-skeleton:0')
      const hitPoint = Schema.decodeUnknownSync(WorldPositionSchema)({
        dimension: 'overworld',
        x: 0.5,
        y: 65.62,
        z: 0.5,
      })
      const capturedPending: Array<ReadonlyArray<unknown>> = []
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 12),
        ['0,0'],
        'overworld',
        (coordinator) => ({
          ...coordinator,
          commit: (request) => {
            const candidate = request.changes.find(({ ownerId }) => ownerId === GAMEPLAY_ENTITIES_OWNER_ID)?.state
            if (typeof candidate === 'object' && candidate !== null) {
              const pending = (candidate as { pendingMobProjectileImpacts?: unknown }).pendingMobProjectileImpacts
              if (Array.isArray(pending) && pending.length > 0) capturedPending.push(pending)
            }
            return coordinator.commit(request)
          },
        }),
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      const projectileSnapshot = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [{
          id: projectileId,
          dimension: 'overworld',
          shooter: source,
          kind: 'projectile',
          profile: ARROW_PROFILE,
          projectile: {
            state: 'stuck',
            position: position(0.5, 65.62, 0.5),
            velocity: { x: 0, y: 0, z: 0 },
            ageSeconds: 0.1,
            shooterId: source,
            hit: {
              kind: 'entity',
              entityId: EntityId('mx-gameplay:player-avatar'),
              point: { x: 0.5, y: 65.62, z: 0.5 },
              normal: { x: 0, y: 0, z: 1 },
              flightTimeSeconds: 0.1,
            },
            recoverable: true,
          },
        }],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: yield* harness.commit.coordinator.revision,
        expectedDimensions: [],
        changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectileSnapshot }],
      })

      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      expect(capturedPending).toContainEqual([{
        id: projectileId,
        source,
        kind: SKELETON_KIND,
        hit: { kind: 'entity', entityId: EntityId('mx-gameplay:player-avatar'), point: hitPoint },
      }])
      const entities = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(entities.state.pendingMobProjectileImpacts).toStrictEqual([])
      expect(entities.state.resolvedMobProjectileIds).toStrictEqual([projectileId])
      const projectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(projectiles.state.projectiles).toStrictEqual([])
      const vitals = yield* harness.commit.coordinator.snapshot(
        harness.commit.vitalsOwnerId!,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      expect(vitals.state.vitals.healthPoints).toBe(17)
    }),
  )

  it.effect('reports a despawned entity-hit projectile with no recovered pending impact', () =>
    Effect.gen(function* () {
      const source = EntityId('scenario:missing-impact-skeleton')
      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)('mx-gameplay:mob:arrow:missing-impact:0')
      const harness = yield* makeHarness(position(0.5, 64, 0.5), floorWorld(0, 12), ['0,0'])
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
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
        }],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: yield* harness.commit.coordinator.revision,
        expectedDimensions: [],
        changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectileSnapshot }],
      })

      const result = yield* Effect.exit(runFrame(harness.stages, DeltaTimeSecs(1 / 20)))
      expect(Exit.hasDies(result)).toBe(true)
      if (!Exit.isFailure(result)) return
      expect(Cause.squash(result.cause)).toMatchObject({
        _tag: 'MobProjectileImpactOutcomeUnavailable',
        projectileId,
      })
    }),
  )

  it.effect('skips malformed launch ticks and persisted projectiles launched in the current tick', () =>
    Effect.gen(function* () {
      const malformedId = 'mx-gameplay:mob:arrow:malformed-launch:tick'
      const sameTickId = 'mx-gameplay:mob:arrow:persisted-same-tick:1'
      const harness = yield* makeHarness(position(0.5, 64, 0.5), floorWorld(0, 12), ['0,0'])
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      const projectileSnapshot = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [
          flyingMobArrow(malformedId, EntityId('scenario:bad-tick-skeleton')),
          flyingMobArrow(sameTickId, EntityId('scenario:same-tick-skeleton')),
        ],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: yield* harness.commit.coordinator.revision,
        expectedDimensions: [],
        changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectileSnapshot }],
      })

      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const after = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(after.state.projectiles.map(({ id }) => String(id))).toStrictEqual([malformedId, sameTickId])
      expect(after.state.projectiles.map(({ projectile }) => ({
        state: projectile.state,
        position: projectile.position,
        ageSeconds: projectile.ageSeconds,
      }))).toStrictEqual([
        { state: 'flying', position: position(8.5, 65.62, 0.5), ageSeconds: 0 },
        { state: 'flying', position: position(8.5, 65.62, 0.5), ageSeconds: 0 },
      ])
    }),
  )

  it.effect('does not launch duplicate or already-resolved mob projectile IDs', () =>
    Effect.gen(function* () {
      const firstStart = position(10.5, 64, 0.5)
      const secondStart = position(12.5, 64, 0.5)
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 16),
        ['0,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, firstStart))
      yield* requestMobSpawn(harness.state, spawnAttempt(SKELETON_KIND, secondStart))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const entities = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const duplicateSource = entities.state.entities.find(({ kind, feetPosition }) =>
        kind === SKELETON_KIND && feetPosition.x === firstStart.x,
      )
      const resolvedSource = entities.state.entities.find(({ kind, feetPosition }) =>
        kind === SKELETON_KIND && feetPosition.x === secondStart.x,
      )
      expect(duplicateSource).toBeDefined()
      expect(resolvedSource).toBeDefined()
      const duplicateId = `mx-gameplay:mob:arrow:${String(duplicateSource!.id)}:2`
      const resolvedId = Schema.decodeUnknownSync(ProjectileIdSchema)(
        `mx-gameplay:mob:arrow:${String(resolvedSource!.id)}:2`,
      )
      const projectileSnapshot = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [flyingMobArrow(duplicateId, duplicateSource!.id, position(firstStart.x, 65.62, firstStart.z))],
      })
      const resolvedCandidate = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
        ...entities.state,
        resolvedMobProjectileIds: [resolvedId],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: entities.revision,
        expectedDimensions: [],
        changes: [
          { ownerId: GAMEPLAY_ENTITIES_OWNER_ID, state: resolvedCandidate },
          { ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectileSnapshot },
        ],
      })

      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

      const afterProjectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(afterProjectiles.state.projectiles).toHaveLength(1)
      expect(String(afterProjectiles.state.projectiles[0]?.id)).toBe(duplicateId)
      expect(afterProjectiles.state.projectiles[0]?.projectile.ageSeconds).toBe(0)
      const afterEntities = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(afterEntities.state.resolvedMobProjectileIds).toStrictEqual([resolvedId])
      expect(yield* Ref.get(harness.state.playerDamages)).toStrictEqual([])
    }),
  )

  it.effect('uses slab, cactus, and pressure-plate collision boxes for saved arrows', () =>
    Effect.gen(function* () {
      const stoneSlab = Option.getOrThrow(blockIdOf('stone_slab'))
      const cactus = Option.getOrThrow(blockIdOf('cactus'))
      const pressurePlate = Option.getOrThrow(blockIdOf('pressure_plate'))
      const cases = [
        {
          id: 'mx-gameplay:mob:arrow:slab-collision:0',
          source: EntityId('scenario:slab-arrow'),
          block: stoneSlab,
          obstacle: blockPosition(6, 65, 0),
          start: position(8.5, 65.25, 0.5),
        },
        {
          id: 'mx-gameplay:mob:arrow:pressure-plate-collision:0',
          source: EntityId('scenario:pressure-plate-arrow'),
          block: pressurePlate,
          obstacle: blockPosition(6, 65, 2),
          start: position(8.5, 65.07, 2.5),
        },
        {
          id: 'mx-gameplay:mob:arrow:cactus-collision:0',
          source: EntityId('scenario:cactus-arrow'),
          block: cactus,
          obstacle: blockPosition(6, 65, 4),
          start: position(8.5, 65.5, 4.5),
        },
      ] as const

      for (const scenario of cases) {
        const harness = yield* makeHarness(
          position(0.5, 64, 0.5),
          new Map([
            ...floorWorld(0, 12, 0, 4),
            ...world([[scenario.obstacle, scenario.block]]),
          ]),
          ['0,0'],
        )
        yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))
        const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)(scenario.id)
        const projectiles = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
          projectiles: [flyingMobArrow(scenario.id, scenario.source, scenario.start)],
        })
        yield* harness.commit.coordinator.commit({
          expectedRevision: yield* harness.commit.coordinator.revision,
          expectedDimensions: [],
          changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectiles }],
        })

        yield* runFrame(harness.stages, DeltaTimeSecs(1 / 20))

        const afterProjectiles = yield* harness.commit.coordinator.snapshot(
          PROJECTILE_REPLICATED_OWNER_ID,
          ProjectileServiceSnapshotSchema,
        )
        expect(afterProjectiles.state.projectiles).toStrictEqual([])
        const afterEntities = yield* harness.commit.coordinator.snapshot(
          GAMEPLAY_ENTITIES_OWNER_ID,
          GameplayEntityRosterSchema,
        )
        expect(afterEntities.state.resolvedMobProjectileIds).toStrictEqual([projectileId])
      }
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

  it.effect('resolves a saved Blaze fireball hit against a mob and preserves existing fire actors', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 Blaze small fireballs set hit mobs on fire.
      // https://minecraft.wiki/w/Small_fireball
      const targetStart = position(8.5, 64, 0.5)
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 20),
        ['0,0', '1,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* requestMobSpawn(harness.state, spawnAttempt(ZOMBIE_KIND, targetStart))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const initial = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const target = initial.state.entities.find(({ kind, feetPosition }) =>
        kind === ZOMBIE_KIND && feetPosition.x === targetStart.x,
      )
      expect(target).toBeDefined()
      const source = EntityId('scenario:stuck-blaze')
      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)(
        `mx-gameplay:mob:fireball:${String(source)}:0`,
      )
      const projectiles = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [{
          id: projectileId,
          dimension: 'overworld',
          shooter: source,
          kind: 'projectile',
          profile: BLAZE_FIREBALL_PROFILE_FIXTURE,
          projectile: {
            state: 'stuck',
            position: position(8.5, 64.5, 0.5),
            velocity: { x: 0, y: 0, z: 0 },
            ageSeconds: 0.1,
            shooterId: source,
            hit: {
              kind: 'entity',
              entityId: target!.id,
              point: { x: 8.5, y: 64.5, z: 0.5 },
              normal: { x: 1, y: 0, z: 0 },
              flightTimeSeconds: 0.1,
            },
            recoverable: true,
          },
        }],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: initial.revision,
        expectedDimensions: [],
        changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectiles }],
      })
      // The persisted hit represents a collision from the preceding physics frame.
      expect((yield* Ref.get(harness.state.fireLifecycle)).burningActors ?? []).toStrictEqual([])
      const preExistingActor = {
        id: 'zz-existing-burning-actor',
        kind: 'entity' as const,
        position: { x: 50, y: 64, z: 0 },
        remainingTicks: 40,
        damageCooldownTicks: 10,
      }
      yield* Ref.update(harness.state.fireLifecycle, (current) => ({
        ...current,
        burningActors: [preExistingActor],
      }))
      const entitiesStage = harness.stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.entities)!
      yield* runFrame([entitiesStage], DeltaTimeSecs(1 / 20))

      const after = yield* mobEntities(harness.commit.coordinator)
      const hitTarget = after.find(({ id }) => id === target!.id)
      expect(hitTarget?.healthPoints).toBe(14)
      const afterProjectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(afterProjectiles.state.projectiles).toStrictEqual([])
      const afterRoster = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(afterRoster.state.resolvedMobProjectileIds).toStrictEqual([projectileId])
      const fireState = yield* Ref.get(harness.state.fireLifecycle)
      expect(fireState.burningActors?.map(({ id }) => id)).toStrictEqual([
        String(target!.id),
        preExistingActor.id,
      ])
      expect(fireState.burningActors?.[0]).toMatchObject({
        id: String(target!.id),
        kind: 'entity',
        remainingTicks: 100,
        damageCooldownTicks: 20,
      })
      expect(fireState.burningActors?.[1]).toStrictEqual(preExistingActor)
    }),
  )

  it.effect('includes every supported mob body size while stepping a saved projectile', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 arrows can damage mobs other than their shooter.
      // https://minecraft.wiki/w/Arrow
      const cases = [
        { kind: SPIDER_KIND, start: position(7.5, 64, 0.5) },
        { kind: CHICKEN_KIND, start: position(10.5, 64, 3.5) },
        { kind: COW_KIND, start: position(12.5, 64, 3.5) },
        { kind: SHEEP_KIND, start: position(14.5, 64, 3.5) },
        { kind: PIG_KIND, start: position(16.5, 64, 3.5) },
        { kind: ENDERMAN_KIND, start: position(20.5, 64, 6.5) },
      ] as const
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 24, 0, 6),
        ['0,0', '1,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      for (const { kind, start } of cases) {
        yield* requestMobSpawn(harness.state, spawnAttempt(kind, start))
      }
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const initial = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const spawned = cases.map(({ kind, start }) => {
        const entity = initial.state.entities.find(({ kind: actualKind, feetPosition }) =>
          actualKind === kind && feetPosition.x === start.x && feetPosition.z === start.z,
        )
        expect(entity).toBeDefined()
        return { kind, entity: entity! }
      })
      const spider = spawned.find(({ kind }) => kind === SPIDER_KIND)!.entity
      const entities = initial.state.entities.map((entity) => entity.id === spider.id
        ? { ...entity, healthPoints: EntityHealthPoints(16) }
        : entity)
      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)(
        'mx-gameplay:mob:arrow:sized-body-fixture:0',
      )
      const source = EntityId('scenario:sized-body-arrow')
      const projectiles = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [{
          id: projectileId,
          dimension: 'overworld',
          shooter: source,
          kind: 'projectile',
          profile: ARROW_PROFILE,
          projectile: {
            state: 'flying',
            position: position(10.5, 64.5, 0.5),
            velocity: { x: -60, y: 0, z: 0 },
            ageSeconds: 0,
            shooterId: source,
          },
        }],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: initial.revision,
        expectedDimensions: [],
        changes: [
          {
            ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
            state: Schema.decodeUnknownSync(GameplayEntityRosterSchema)({ ...initial.state, entities }),
          },
          { ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectiles },
        ],
      })

      const entitiesStage = harness.stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.entities)!
      yield* runFrame([entitiesStage], DeltaTimeSecs(1 / 20))

      const after = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(after.state.entities.find(({ id }) => id === spider.id)?.healthPoints).toBe(13)
      for (const { kind, entity } of spawned) {
        const remaining = after.state.entities.find(({ id }) => id === entity.id)
        expect(remaining).toBeDefined()
        if (kind !== SPIDER_KIND) expect(remaining?.healthPoints).toBe(entity.healthPoints)
      }
      expect(after.state.resolvedMobProjectileIds).toStrictEqual([projectileId])
      const remainingProjectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(remainingProjectiles.state.projectiles).toStrictEqual([])
    }),
  )

  it.effect('retires a fast saved projectile against fail-closed world bounds', () =>
    Effect.gen(function* () {
      const capturedPending: Array<ReadonlyArray<unknown>> = []
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        floorWorld(0, 20),
        ['0,0', '1,0'],
        'overworld',
        (coordinator) => ({
          ...coordinator,
          commit: (request) => {
            const candidate = request.changes.find(({ ownerId }) => ownerId === GAMEPLAY_ENTITIES_OWNER_ID)?.state
            if (typeof candidate === 'object' && candidate !== null) {
              const pending = (candidate as { pendingMobProjectileImpacts?: unknown }).pendingMobProjectileImpacts
              if (Array.isArray(pending) && pending.length > 0) capturedPending.push(pending)
            }
            return coordinator.commit(request)
          },
        }),
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)(
        'mx-gameplay:mob:arrow:span-overflow:0',
      )
      const source = EntityId('scenario:span-overflow-arrow')
      const projectiles = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [{
          id: projectileId,
          dimension: 'overworld',
          shooter: source,
          kind: 'projectile',
          profile: ARROW_PROFILE,
          projectile: {
            state: 'flying',
            position: position(10.5, 65.5, 0.5),
            velocity: { x: 1000, y: 0, z: 0 },
            ageSeconds: 0,
            shooterId: source,
          },
        }],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: yield* harness.commit.coordinator.revision,
        expectedDimensions: [],
        changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectiles }],
      })

      const entitiesStage = harness.stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.entities)!
      yield* runFrame([entitiesStage], DeltaTimeSecs(1 / 20))

      expect(capturedPending).toContainEqual([{
        id: projectileId,
        source,
        kind: SKELETON_KIND,
        hit: {
          kind: 'block',
          point: {
            dimension: 'overworld',
            x: 10.5,
            y: 65.5,
            z: 0.5,
          },
        },
      }])
      const roster = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(roster.state.pendingMobProjectileImpacts).toStrictEqual([])
      expect(roster.state.resolvedMobProjectileIds).toStrictEqual([projectileId])
      const remainingProjectiles = yield* harness.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(remainingProjectiles.state.projectiles).toStrictEqual([])
      expect(yield* Ref.get(harness.state.playerDamages)).toStrictEqual([])
    }),
  )

  it.effect('resolves a stuck skeleton arrow killing an adult pig into a fixed porkchop drop', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 adult pigs drop 1–3 porkchops when killed without fire.
      // https://minecraft.wiki/w/Pig#Drops
      const pigStart = position(8.5, 64, 0.5)
      const cage = [
        ...[64, 65, 66].flatMap((y) => [
          ...[-1, 0, 1].flatMap((z) => [
            [blockPosition(7, y, z), STONE] as const,
            [blockPosition(9, y, z), STONE] as const,
          ]),
          ...[7, 8, 9].flatMap((x) => [
            [blockPosition(x, y, -1), STONE] as const,
            [blockPosition(x, y, 1), STONE] as const,
          ]),
        ]),
        [blockPosition(8, 67, 0), STONE] as const,
      ]
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        new Map([
          ...floorWorld(7, 9, -1, 1),
          ...world(cage),
        ]),
        ['0,0', '0,-1'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* requestMobSpawn(harness.state, spawnAttempt(PIG_KIND, pigStart))
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const initial = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const pig = initial.state.entities.find(({ kind }) => kind === PIG_KIND)
      expect(pig?.feetPosition).toStrictEqual(pigStart)
      expect(pig).toBeDefined()
      const entities = initial.state.entities.map((entity) => entity.id === pig!.id
        ? { ...entity, healthPoints: EntityHealthPoints(3) }
        : entity)
      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)(
        'mx-gameplay:mob:arrow:stuck-skeleton-pig:0',
      )
      const source = EntityId('scenario:stuck-skeleton-pig-kill')
      const projectiles = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
        projectiles: [{
          id: projectileId,
          dimension: 'overworld',
          shooter: source,
          kind: 'projectile',
          profile: ARROW_PROFILE,
          projectile: {
            state: 'stuck',
            position: position(8.5, 65.5, 0.5),
            velocity: { x: 0, y: 0, z: 0 },
            ageSeconds: 0.1,
            shooterId: source,
            hit: {
              kind: 'entity',
              entityId: pig!.id,
              point: { x: 8.5, y: 64.5, z: 0.5 },
              normal: { x: -1, y: 0, z: 0 },
              flightTimeSeconds: 0.1,
            },
            recoverable: true,
          },
        }],
      })
      yield* harness.commit.coordinator.commit({
        expectedRevision: initial.revision,
        expectedDimensions: [],
        changes: [
          {
            ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
            state: Schema.decodeUnknownSync(GameplayEntityRosterSchema)({ ...initial.state, entities }),
          },
          { ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectiles },
        ],
      })
      yield* Ref.set(harness.state.rollSeed, 1)
      const entitiesStage = harness.stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.entities)!
      yield* runFrame([entitiesStage], DeltaTimeSecs(1 / 20))

      const after = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(after.state.entities.some(({ id }) => id === pig!.id)).toBe(false)
      expect(after.state.resolvedMobProjectileIds).toStrictEqual([projectileId])
      expect(yield* Ref.get(harness.state.mobDrops)).toStrictEqual([{
        source: pig!.id,
        kind: PIG_KIND,
        at: pigStart,
        item: 'porkchop',
        count: 1,
      }])
      const dropped = yield* harness.commit.coordinator.snapshot(
        GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        DroppedItemOwnerSnapshotSchema,
      )
      expect(dropped.state.items.map(({ feetPosition, behaviour }) => ({
        feetPosition,
        behaviour: { item: behaviour.item, count: behaviour.count },
      }))).toStrictEqual([{
        feetPosition: pigStart,
        behaviour: { item: 'porkchop', count: 1 },
      }])
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
