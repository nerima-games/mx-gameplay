import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { Cause, Effect, Option, Ref, Result, Schema, Stream } from 'effect'
import { MIN_SPAWN_DISTANCE_BLOCKS, SkyLightLevel } from '../src/domain/mob/hostile-spawn'
import { SPAWN_RING_ANGLES, SPAWN_RING_RADIUS_INSET_BLOCKS } from '../src/domain/entities/mob-spawn-search'
import {
  BlockAxis,
  AIR_BLOCK_ID,
  DamageAmountSchema,
  DeltaTimeSecs as makeDeltaTimeSecs,
  DimensionIdSchema,
  EntityHealthPoints,
  EntitySerial,
  InterpolationFraction,
  PositionAxis,
  ProjectileIdSchema,
  RandomSeed,
  SimulationTick,
  StackCount,
  WorldRevisionSchema,
  WorldIdSchema,
  WorldPositionSchema,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  position,
  type DeltaTimeSecs,
  type BlockId,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  EntityKind,
  emptyPlayerStorage,
  equipmentItem,
  ARROW_PROFILE,
  makeEntityManager,
  makeProjectileService,
  makeReplicatedOwnerId,
  makeTntService,
  makeTimeService,
  makeWorldCommitCoordinator,
  DomainEventBus,
  durability,
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  MobMovementStateSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  TntServiceSnapshotSchema,
  TNT_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  WorldRevisionConflict,
  SPAWN_VITALS,
  itemStack,
  type PlayerPose,
  type PlayerStorage,
  type DomainEventBusApi,
  type TntServiceSnapshot,
  type Vitals,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
} from '@nerima-games/mc-sim'
import { makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { SAND, STONE, world } from './support/chunk-store-double.js'
import { disturb } from '../src/domain/falling-block.js'
import {
  drainGameplayUnsupportedOperations,
  makeGameplayFrameState,
  requestShieldBlocking,
  requestDroppedItemPickup,
  requestExperienceOrbAbsorption,
  HOSTILE_SPAWN_INTERVAL_TICKS,
  requestMobSpawn,
} from '../src/stages/registration-core.js'
import { INITIAL_DIMENSION, INITIAL_PLAYER_POSE } from '../src/domain/in-memory-player.js'
import {
  DroppedItemOwnerSnapshotSchema,
  type DroppedItemOwnerSnapshot,
} from '../src/domain/entities/dropped-item.js'
import {
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
  createExperienceOrbValue,
  type ExperienceOrbOwnerSnapshot,
} from '../src/domain/entities/xp-orb.js'
import { makeEntitiesStage } from '../src/stages/entities-stage.js'
import { nextRoll } from '../src/domain/frame-rolls.js'
import {
  CREEPER_KIND,
  initialBehaviourOfKind,
  hostileMobSnapshot,
  type MobBehaviour,
  type MobEntity,
  planMobBlastRoster,
  planMobRosterSweep,
  rollCasualtyDrops,
} from '../src/domain/entities/mob-frame.js'
import { BLAZE_KIND, initialEcosystemMobState, SKELETON_KIND, SPIDER_KIND } from '../src/domain/mob/mob-ecosystem.js'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat.js'
import { COW_KIND } from '../src/domain/mob/mob-ecosystem.js'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_TNT_SOURCES_OWNER_ID,
  GameplayEntityRosterSchema,
  GameplayTntSourcesSnapshotSchema,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'
import type { GameplayStageContext } from '../src/stages/registration-core.js'
import { FrameServicesLayer } from './support/frame-services.js'

const worldId = Schema.decodeUnknownSync(WorldIdSchema)('entities-stage-owner-tests')

const creeperAt = (x: number, y = 0): MobEntity => ({
  id: EntityId('test:creeper'),
  kind: CREEPER_KIND,
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: { _tag: 'Dormant' as const },
})

const zombieAt = (x: number, y: number): MobEntity => ({
  id: EntityId('test:zombie'),
  kind: ZOMBIE_KIND,
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: hostileMobSnapshot(undefined),
})

const beeAt = (x: number, y: number, health: number): MobEntity => ({
  id: EntityId('test:bee'),
  kind: EntityKind('bee'),
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(health),
  behaviour: undefined,
})

const ecosystemMobAt = (id: string, kind: typeof BLAZE_KIND | typeof SKELETON_KIND, x: number, y: number): MobEntity => ({
  id: EntityId(id),
  kind,
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: hostileMobSnapshot(initialEcosystemMobState()),
})

const equippedIronHelmetStorage = (): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1))),
  ))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const nearlyBrokenIronHelmetStorage = (): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1))),
    Result.getOrThrow(durability(1, 165)),
  ))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const makeHarness = (options: Readonly<{
  readonly entity?: MobEntity | null
  readonly entities?: ReadonlyArray<MobEntity>
  readonly onLightRead?: (position: Readonly<{ x: number; y: number; z: number }>) => void
  readonly tntSources?: Schema.Schema.Type<typeof GameplayTntSourcesSnapshotSchema>
  readonly block?: Readonly<{ position: ReturnType<typeof blockPosition>; id: BlockId }>
  readonly blocks?: ReadonlyArray<readonly [ReturnType<typeof blockPosition>, BlockId]>
  readonly loadedChunks?: ReadonlyArray<string>
  readonly dimension?: Schema.Schema.Type<typeof DimensionIdSchema>
  readonly rejectCommit?: boolean
  readonly rejectTntSnapshotCommit?: boolean
  readonly provideTntService?: boolean
  readonly playerPose?: PlayerPose
  readonly playerStorage?: PlayerStorage
  readonly synthesizeShieldStorageSnapshot?: boolean
  readonly shieldDurability?: number
  readonly droppedItems?: DroppedItemOwnerSnapshot
  readonly vitals?: Vitals
  readonly experienceOrbs?: ExperienceOrbOwnerSnapshot
  readonly tnt?: TntServiceSnapshot
  readonly projectileService?: boolean
  readonly armSnapshotMismatchAfterProjectileSnapshot?: Readonly<{
    readonly snapshotNumber: number
    readonly ownerId: ReturnType<typeof makeReplicatedOwnerId>
    readonly count?: number
  }>
  readonly mismatchSnapshotAt?: Readonly<{
    readonly snapshotNumber: number
    readonly ownerId: ReturnType<typeof makeReplicatedOwnerId>
    readonly count?: number
  }>
}> = {}) => Effect.gen(function* () {
  const entities = options.entities ?? (options.entity === null ? [] : [options.entity ?? creeperAt(3)])
  const playerPose = options.playerPose ?? (entities[0]?.feetPosition.y === 64
    ? { ...INITIAL_PLAYER_POSE, feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)) }
    : INITIAL_PLAYER_POSE)
  const entries = options.blocks ?? (options.block === undefined
    ? []
    : [[options.block.position, options.block.id] as const])
  const store = yield* makeTransactionalChunkStoreDouble(world(entries), options.loadedChunks ?? ['0,0'])
  const observedStoreApi = options.onLightRead === undefined
    ? store.api
    : {
        ...store.api,
        getLight: (lightPosition: Parameters<typeof store.api.getLight>[0]) => {
          options.onLightRead?.(lightPosition)
          return store.api.getLight(lightPosition)
        },
      }
  const baseCoordinator = yield* makeWorldCommitCoordinator({
    world: worldId,
    owners: gameplayOwnerRegistrations({
      playerPose,
      ...(options.dimension === undefined ? {} : { dimension: options.dimension }),
      ...(options.playerStorage === undefined ? {} : { playerStorage: options.playerStorage }),
      ...(options.droppedItems === undefined ? {} : { droppedItems: options.droppedItems }),
      ...(options.vitals === undefined ? {} : { vitals: options.vitals }),
      ...(options.experienceOrbs === undefined ? {} : { experienceOrbs: options.experienceOrbs }),
      entities: { entities, nextSerial: EntitySerial(entities.length) },
      ...(options.tntSources === undefined ? {} : { tntSources: options.tntSources }),
      ...(options.tnt === undefined ? {} : { tnt: options.tnt }),
    }),
    chunkStores: { forDimension: () => observedStoreApi },
  })
  let commits = 0
  let rejectCommits = options.rejectCommit === true
  let tntCommits = 0
  let tntSnapshotCommits = 0
  let lastRequest: WorldCommitRequest | undefined
  let mismatchNextSnapshotOwnerId: ReturnType<typeof makeReplicatedOwnerId> | undefined
  let mismatchSnapshotsRemaining = 0
  let mismatchedSnapshots = 0
  const snapshotsByOwner = new Map<ReturnType<typeof makeReplicatedOwnerId>, number>()
  const coordinator: WorldCommitCoordinatorApi = {
    ...baseCoordinator,
    snapshot: <Codec extends Schema.Codec<any, any>>(ownerId: ReturnType<typeof makeReplicatedOwnerId>, schema: Codec) => {
      const snapshotNumber = (snapshotsByOwner.get(ownerId) ?? 0) + 1
      snapshotsByOwner.set(ownerId, snapshotNumber)
      return baseCoordinator.snapshot(ownerId, schema).pipe(Effect.flatMap((snapshot) => {
        if (
          options.synthesizeShieldStorageSnapshot === true &&
          ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID &&
          schema === PlayerStorageSnapshotSchema &&
          'state' in snapshot
        ) {
          // Installed mc-sim/mc-kernel catalogs cannot represent shield equipment yet.
          const shield = {
            ...Result.getOrThrow(itemStack('shield', StackCount(1))),
            durability: { current: options.shieldDurability ?? 336, max: 336 },
          }
          const storage = snapshot.state as PlayerStorage
          return Effect.succeed({
            ...snapshot,
            state: {
              ...storage,
              equipment: {
                ...storage.equipment,
                slots: { ...storage.equipment.slots, offhand: shield },
              },
            } as typeof snapshot.state,
          })
        }
        const armedMismatch = ownerId === mismatchNextSnapshotOwnerId && mismatchSnapshotsRemaining > 0
        const scheduledMismatch = options.mismatchSnapshotAt?.ownerId === ownerId &&
          snapshotNumber >= options.mismatchSnapshotAt.snapshotNumber &&
          snapshotNumber < options.mismatchSnapshotAt.snapshotNumber + (options.mismatchSnapshotAt.count ?? 1)
        if (!armedMismatch && !scheduledMismatch) {
          return Effect.succeed(snapshot)
        }
        mismatchedSnapshots += 1
        if (armedMismatch) {
          mismatchSnapshotsRemaining -= 1
          if (mismatchSnapshotsRemaining === 0) mismatchNextSnapshotOwnerId = undefined
        }
        const snapshotSchema = Schema.Struct({
          world: WorldIdSchema,
          revision: WorldRevisionSchema,
          state: schema,
        })
        return baseCoordinator.revision.pipe(Effect.map((revision) =>
          Schema.decodeUnknownSync(snapshotSchema)({
            ...snapshot,
            revision: revision + 1,
          }),
        ))
      }))
    },
    commit: (request) => {
      commits += 1
      lastRequest = request
      return rejectCommits
        ? Effect.fail(new WorldRevisionConflict({
            expected: request.expectedRevision,
            actual: request.expectedRevision,
          }))
        : baseCoordinator.commit(request)
    },
    commitFromSnapshot: (ownerId, schema, buildRequest) => {
      tntSnapshotCommits += 1
      return options.rejectTntSnapshotCommit === true
        ? Effect.fail(new WorldRevisionConflict({ expected: revision, actual: revision }))
        : baseCoordinator.commitFromSnapshot(ownerId, schema, buildRequest)
    },
  }
  const state = yield* makeGameplayFrameState
  const roster = yield* makeEntityManager<MobBehaviour>()
  const time = yield* makeTimeService()
  yield* time.setTimeOfDay(InterpolationFraction(0.9))
  const tntServiceBase = yield* makeTntService(TNT_REPLICATED_OWNER_ID).pipe(
    Effect.provideService(WorldCommitCoordinator, coordinator),
  )
  const revision = yield* coordinator.revision
  const tntService = {
    ...tntServiceBase,
    commitDetonation: (
      reference: Parameters<typeof tntServiceBase.commitDetonation>[0],
      affectedEntityChanges?: Parameters<typeof tntServiceBase.commitDetonation>[1],
    ) => {
      tntCommits += 1
      return tntServiceBase.commitDetonation(reference, affectedEntityChanges)
    },
  }
  const eventBus: DomainEventBusApi = {
    publish: () => Effect.void,
    events: Stream.empty,
  }
  const baseProjectileService = options.projectileService === true
    ? yield* makeProjectileService().pipe(
      Effect.provideService(WorldCommitCoordinator, coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    : undefined
  let projectileSnapshotReads = 0
  const projectileService = baseProjectileService === undefined
    ? undefined
    : {
        ...baseProjectileService,
        get snapshot() {
          projectileSnapshotReads += 1
          const snapshotEffect = baseProjectileService.snapshot
          const mismatch = options.armSnapshotMismatchAfterProjectileSnapshot
          if (mismatch?.snapshotNumber !== projectileSnapshotReads) return snapshotEffect
          return snapshotEffect.pipe(Effect.map((snapshot) => {
            mismatchNextSnapshotOwnerId = mismatch.ownerId
            mismatchSnapshotsRemaining = mismatch.count ?? 1
            return snapshot
          }))
        },
      }
  const context: GameplayStageContext = {
    state,
    store: observedStoreApi,
    roster,
    time,
    vehicleService: undefined,
    vehicleEnvironment: undefined,
    options: {},
    commit: {
      coordinator,
      playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
      playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
      tntSourcesOwnerId: GAMEPLAY_TNT_SOURCES_OWNER_ID,
      tntOwnerId: TNT_REPLICATED_OWNER_ID,
      ...(projectileService === undefined ? {} : {
        projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID,
        projectileService,
        eventBus,
      }),
      ...(options.provideTntService === false ? {} : { tntService }),
    },
  }
  return {
    context,
    state,
    store,
    coordinator,
    time,
    stage: makeEntitiesStage(context),
    commits: () => commits,
    rejectCommits: (reject: boolean) => { rejectCommits = reject },
    mismatchNextSnapshot: (ownerId: ReturnType<typeof makeReplicatedOwnerId>, count = 1) => {
      mismatchNextSnapshotOwnerId = ownerId
      mismatchSnapshotsRemaining = count
    },
    mismatchedSnapshots: () => mismatchedSnapshots,
    tntCommits: () => tntCommits,
    tntSnapshotCommits: () => tntSnapshotCommits,
    lastRequest: () => lastRequest,
    run: (dt: DeltaTimeSecs) =>
      Effect.runPromise(makeEntitiesStage(context).run(dt).pipe(Effect.provide(FrameServicesLayer))),
  }
})

const makeMobBlastHarness = async () => {
  const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
  const creeper = {
    ...creeperAt(0, 64),
    behaviour: { _tag: 'Lit' as const, burnedSecs: 1.49 },
  }
  const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
  const playerPose = {
    ...INITIAL_PLAYER_POSE,
    feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
  }
  const harness = await Effect.runPromise(makeHarness({
    entity: null,
    entities: [creeper, zombie],
    playerPose,
    block: { position: centre, id: STONE },
  }))
  await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
  return { harness, zombie, centre }
}

const strictRoster = (coordinator: WorldCommitCoordinatorApi) =>
  coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)

const seedPendingMobProjectileImpact = async (
  coordinator: WorldCommitCoordinatorApi,
  impact: Readonly<{
    readonly kind?: typeof BLAZE_KIND | typeof SKELETON_KIND
    readonly entityId?: ReturnType<typeof EntityId>
    readonly point?: ReturnType<typeof position>
  }> = {},
) => {
  const snapshot = await Effect.runPromise(strictRoster(coordinator))
  const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)(
    'mx-gameplay:mob:arrow:test:skeleton:1',
  )
  const point = Schema.decodeUnknownSync(WorldPositionSchema)({
    dimension: 'overworld',
    x: impact.point?.x ?? 0,
    y: impact.point?.y ?? 64,
    z: impact.point?.z ?? 0,
  })
  const state = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
    ...snapshot.state,
    pendingMobProjectileImpacts: [{
      id: projectileId,
      source: EntityId(impact.kind === BLAZE_KIND ? 'test:blaze' : 'test:skeleton'),
      kind: impact.kind ?? SKELETON_KIND,
      hit: {
        kind: 'entity',
        entityId: impact.entityId ?? EntityId('mx-gameplay:player-avatar'),
        point,
      },
    }],
  })
  await Effect.runPromise(coordinator.commit({
    expectedRevision: snapshot.revision,
    expectedDimensions: [],
    changes: [{ ownerId: GAMEPLAY_ENTITIES_OWNER_ID, state }],
  }))
  return projectileId
}

const seedExpiredMobProjectile = async (
  coordinator: WorldCommitCoordinatorApi,
  withExplicitEmptyPending: boolean,
  markResolved = false,
) => {
  const entities = await Effect.runPromise(strictRoster(coordinator))
  const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)(
    'mx-gameplay:mob:arrow:test:0',
  )
  const source = EntityId('test:skeleton')
  const state = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
    ...entities.state,
    ...(withExplicitEmptyPending
      ? {
          resolvedMobProjectileIds: markResolved ? [projectileId] : [],
          pendingMobProjectileImpacts: [],
        }
      : {}),
  })
  const projectiles = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
    projectiles: [{
      id: projectileId,
      dimension: 'overworld',
      shooter: source,
      kind: 'projectile',
      profile: ARROW_PROFILE,
      projectile: {
        state: 'despawned',
        reason: 'lifetime',
        position: position(PositionAxis(8), PositionAxis(64), PositionAxis(0)),
        velocity: { x: 0, y: 0, z: 0 },
        ageSeconds: 3,
        shooterId: source,
      },
    }],
  })
  await Effect.runPromise(coordinator.commit({
    expectedRevision: entities.revision,
    expectedDimensions: [],
    changes: [
      { ownerId: GAMEPLAY_ENTITIES_OWNER_ID, state },
      { ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectiles },
    ],
  }))
  return projectileId
}

const seedFlyingMobProjectile = async (
  coordinator: WorldCommitCoordinatorApi,
  id: string,
  at: ReturnType<typeof position>,
  velocity: Readonly<{ x: number; y: number; z: number }>,
) => {
  const entities = await Effect.runPromise(strictRoster(coordinator))
  const source = EntityId('test:skeleton')
  const projectiles = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
    projectiles: [{
      id: Schema.decodeUnknownSync(ProjectileIdSchema)(id),
      dimension: 'overworld',
      shooter: source,
      kind: 'projectile',
      profile: ARROW_PROFILE,
      projectile: {
        state: 'flying',
        position: at,
        velocity,
        ageSeconds: 0,
        shooterId: source,
      },
    }],
  })
  await Effect.runPromise(coordinator.commit({
    expectedRevision: entities.revision,
    expectedDimensions: [],
    changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: projectiles }],
  }))
}

const unsafeMovementX = 2 ** 53

const spiderAtUnsafeMovementX = (movement?: Schema.Schema.Type<typeof MobMovementStateSchema>): MobEntity => ({
  id: EntityId('test:spider'),
  kind: SPIDER_KIND,
  feetPosition: position(PositionAxis(unsafeMovementX), PositionAxis(64), PositionAxis(0)),
  healthPoints: EntityHealthPoints(16),
  behaviour: hostileMobSnapshot({
    ...initialEcosystemMobState(),
    attackCooldownTicks: 2,
  }, movement === undefined ? {} : { movement }),
})

describe('entities stage owner-backed MobSimulation', () => {
  it.each([
    ['invalid-state', undefined],
    ['invalid-goal', 'previous-movement'],
  ] as const)('rejects a real movement tick with %s at an unsafe finite goal', async (reason, previousMovement) => {
    const spider = spiderAtUnsafeMovementX()
    const movement = previousMovement === undefined
      ? undefined
      : Schema.decodeUnknownSync(MobMovementStateSchema)({
          id: spider.id,
          body: {
            kind: 'dynamic',
            x: unsafeMovementX,
            y: 64.45,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
          },
          profile: { kind: 'spider', width: 1.4, height: 0.9 },
          goal: { x: 0, y: 64, z: 0 },
          path: [],
          pathIndex: 0,
          stuckTicks: 0,
          isGrounded: false,
          movementSpeed: 3,
        })
    const entity = spiderAtUnsafeMovementX(movement)
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(unsafeMovementX), PositionAxis(66), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({ entity, playerPose }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    expect(Number.isFinite(unsafeMovementX)).toBe(true)
    expect(Number.isSafeInteger(unsafeMovementX)).toBe(false)
    expect(rosterBefore.state.entities[0]?.feetPosition.x).toBe(unsafeMovementX)
    expect(playerBefore.state.pose.feetPosition.x).toBe(unsafeMovementX)
    expect(playerBefore.state.pose.feetPosition.y).toBe(66)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    if (exit._tag !== 'Failure') throw new Error('Expected the movement planner to reject the unsafe goal')
    expect(Cause.squash(exit.cause)).toMatchObject({
      _tag: 'MobMovementRosterFailure',
      reason,
      entityId: EntityId('test:spider'),
    })
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('commits the registered entity owner exactly once across generated frame deltas', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (ticks) => {
        const harness = await Effect.runPromise(makeHarness())
        const before = await Effect.runPromise(strictRoster(harness.coordinator))
        const initial = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(before.state)
        const dt = (ticks * 0.05) as Parameters<typeof harness.stage.run>[0]
        await harness.run(dt)
        const after = await Effect.runPromise(strictRoster(harness.coordinator))
        const decoded = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(after.state)

        expect(harness.commits()).toBe(1)
        expect(decoded.entities[0]?.behaviour).not.toStrictEqual(initial.entities[0]?.behaviour)
        expect(after.revision).toBe(before.revision + 1)
      }),
      { numRuns: 12 },
    )
  })

  it('commits registered mob-contact damage and the mob roster in one owner request', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
    }))
    const beforeVitals = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
    )
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(0.25 as DeltaTimeSecs)

    const afterRoster = await Effect.runPromise(strictRoster(harness.coordinator))
    const afterVitals = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
    )
    const decodedRoster = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(afterRoster.state)
    const decodedVitals = Schema.decodeUnknownSync(ExperienceOrbVitalsOwnerSnapshotSchema)(afterVitals.state)
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))

    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_ENTITIES_OWNER_ID)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_VITALS_OWNER_ID)
    expect(afterRoster.revision).toBe(revisionBefore + 1)
    expect(decodedRoster.entities[0]?.behaviour).toMatchObject({ ageTicks: 1 })
    expect(decodedVitals.vitals.healthPoints).toBeLessThan(beforeVitals.state.vitals.healthPoints)
    expect(damages).toMatchObject([{
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      damage: { amount: 3, cause: 'mob' },
    }])
  })

  it('routes AI attacks, contact, and explosions through Peaceful damage resolution', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const creeper = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit' as const, burnedSecs: 1.49 },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, zombieAt(1, 64), ecosystemMobAt('test:skeleton', SKELETON_KIND, 8, 64)],
      playerPose,
      block: { position: blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0)), id: STONE },
    }))
    await Effect.runPromise(harness.state.survivalHunger.setDifficulty('peaceful'))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(0.25 as DeltaTimeSecs)

    const after = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    expect(after.state.vitals.healthPoints).toBe(before.state.vitals.healthPoints)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toEqual([])
  })

  it('applies Hard difficulty to an AI attack before storing hurt resistance', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [zombieAt(1, 64)],
      playerPose,
    }))
    await Effect.runPromise(harness.state.survivalHunger.setDifficulty('hard'))

    await harness.run(0.05 as DeltaTimeSecs)

    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toMatchObject([{
      damage: { amount: 4.5, cause: 'mob' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.damageImmunity))).toMatchObject({
      lastDamageAmount: 4.5,
    })
  })

  it('routes shielded contact through the stage-held shield state', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      yawRadians: -Math.PI / 2 as typeof INITIAL_PLAYER_POSE.yawRadians,
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      synthesizeShieldStorageSnapshot: true,
    }))
    await Effect.runPromise(harness.state.survivalHunger.setDifficulty('easy'))
    await Effect.runPromise(Ref.set(harness.state.hostileContactCooldowns, new Map([
      [EntityId('test:zombie'), SimulationTick(0)],
    ])))
    const actor = EntityId('mx-gameplay:player-avatar')
    await Effect.runPromise(requestShieldBlocking(harness.state, {
      _tag: 'SetShieldBlocking',
      actor,
      blocking: true,
    }))

    await Effect.runPromise(Effect.forEach(
      Array.from({ length: 20 }, (_, index) => index + 1),
      (tick) => Effect.gen(function* () {
        yield* Ref.set(harness.state.tickCount, SimulationTick(tick))
        yield* Effect.promise(() => harness.run(0.05 as DeltaTimeSecs))
      }),
      { concurrency: 1 },
    ))

    expect(await Effect.runPromise(Ref.get(harness.state.shieldBlocking))).toMatchObject({ actor })
    expect(await Effect.runPromise(Ref.get(harness.state.damageImmunity))).toBeNull()
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toEqual([])
    const contactCooldowns = await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))
    expect(contactCooldowns.get(EntityId('test:zombie'))).toBe(SimulationTick(20))
  })

  it('damages or breaks a shield after a blocked hard contact', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      yawRadians: -Math.PI / 2 as typeof INITIAL_PLAYER_POSE.yawRadians,
    }
    const runBlockedContact = async (shieldDurability: number) => {
      const harness = await Effect.runPromise(makeHarness({
        entity: zombieAt(1, 64),
        playerPose,
        synthesizeShieldStorageSnapshot: true,
        shieldDurability,
      }))
      await Effect.runPromise(harness.state.survivalHunger.setDifficulty('hard'))
      await Effect.runPromise(Ref.set(harness.state.hostileContactCooldowns, new Map([
        [EntityId('test:zombie'), SimulationTick(0)],
      ])))
      await Effect.runPromise(requestShieldBlocking(harness.state, {
        _tag: 'SetShieldBlocking',
        actor: EntityId('mx-gameplay:player-avatar'),
        blocking: true,
      }))

      await Effect.runPromise(Effect.forEach(
        Array.from({ length: 19 }, (_, index) => index + 1),
        (tick) => Effect.gen(function* () {
          yield* Ref.set(harness.state.tickCount, SimulationTick(tick))
          yield* Effect.promise(() => harness.run(0.05 as DeltaTimeSecs))
        }),
        { concurrency: 1 },
      ))
      await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(20)))
      harness.rejectCommits(true)
      const exit = await Effect.runPromiseExit(
        harness.stage.run(0.05 as DeltaTimeSecs).pipe(Effect.provide(FrameServicesLayer)),
      )
      const storageChange = harness.lastRequest()?.changes.find(({ ownerId }) =>
        ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID
      )
      return { exit, storageCandidate: storageChange?.state }
    }

    const damaged = await runBlockedContact(336)
    const broken = await runBlockedContact(1)

    expect(damaged.exit._tag).toBe('Failure')
    expect(damaged.storageCandidate).toMatchObject({
      equipment: { slots: { offhand: { durability: { current: 331 } } } },
    })
    expect(broken.exit._tag).toBe('Failure')
    expect(broken.storageCandidate).toMatchObject({
      equipment: { slots: { offhand: null } },
    })
  })

  it('rejects shield-block requests from the wrong actor and without a shield', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    await Effect.runPromise(requestShieldBlocking(harness.state, {
      _tag: 'SetShieldBlocking',
      actor: EntityId('test:zombie'),
      blocking: true,
    }))
    await Effect.runPromise(requestShieldBlocking(harness.state, {
      _tag: 'SetShieldBlocking',
      actor: EntityId('mx-gameplay:player-avatar'),
      blocking: true,
    }))
    await Effect.runPromise(requestShieldBlocking(harness.state, {
      _tag: 'SetShieldBlocking',
      actor: EntityId('mx-gameplay:player-avatar'),
      blocking: false,
    }))

    await harness.run(0.05 as DeltaTimeSecs)

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toContainEqual(
      expect.objectContaining({
        operation: 'CandidateBuild',
        subject: 'Player',
        error: { _tag: 'ShieldBlockingPreparation', reason: 'invalid-authoritative-state' },
      }),
    )
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toContainEqual(
      expect.objectContaining({
        operation: 'CandidateBuild',
        subject: 'Player',
        error: { _tag: 'ShieldBlockingPreparation', reason: 'shield-not-equipped' },
      }),
    )
  })

  it('suppresses weaker contact during the ten-tick hurt-resistance window', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [zombieAt(1, 64)],
      playerPose,
    }))
    await Effect.runPromise(Ref.set(harness.state.damageImmunity, {
      lastDamageTick: SimulationTick(0),
      lastDamageAmount: Schema.decodeUnknownSync(DamageAmountSchema)(6),
    }))
    await harness.run(0.05 as DeltaTimeSecs)
    expect(await Effect.runPromise(Ref.get(harness.state.damageImmunity))).toMatchObject({
      lastDamageTick: 0,
      lastDamageAmount: 6,
    })
    expect((await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))).size).toBe(1)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])

    await Effect.runPromise(Effect.forEach(
      Array.from({ length: 9 }, (_, index) => index + 1),
      (tick) => Effect.gen(function* () {
        yield* Ref.set(harness.state.tickCount, SimulationTick(tick))
        yield* Ref.set(harness.state.hostileContactCooldowns, new Map())
        yield* Effect.promise(() => harness.run(0.05 as DeltaTimeSecs))
      }),
      { concurrency: 1 },
    ))

    expect(await Effect.runPromise(Ref.get(harness.state.damageImmunity))).toMatchObject({
      lastDamageTick: 0,
      lastDamageAmount: 6,
    })
    expect((await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))).size).toBe(1)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('keeps same logical tick contact counts and cooldown ticks independent of dt', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const runSchedule = async (secondDeltaSecs: number) => {
      const zombieId = EntityId('test:zombie')
      const harness = await Effect.runPromise(makeHarness({
        entity: zombieAt(1, 64),
        playerPose,
      }))

      await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(0)))
      await harness.run(makeDeltaTimeSecs(0.05))
      const firstDamages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
      const firstCooldowns = await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))
      await Effect.runPromise(Ref.set(harness.state.playerDamages, []))

      await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(10)))
      // A recent hostile search keeps this contact-cooldown check independent of spawn cadence.
      await Effect.runPromise(Ref.set(harness.state.lastHostileSpawnTick, SimulationTick(10)))
      await harness.run(makeDeltaTimeSecs(secondDeltaSecs))
      const secondDamages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
      const secondCooldowns = await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))

      return {
        firstDamage: firstDamages[0],
        damageCounts: [firstDamages.length, secondDamages.length],
        contactCounts: [firstCooldowns.size, secondCooldowns.size],
        contactTicks: [firstCooldowns.get(zombieId), secondCooldowns.get(zombieId)],
      }
    }

    const shortDelta = await runSchedule(0.05)
    const longDelta = await runSchedule(1)

    expect(shortDelta.firstDamage).toMatchObject({
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      kind: ZOMBIE_KIND,
      damage: { amount: 3, cause: 'mob' },
    })
    expect(longDelta.firstDamage).toMatchObject({
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      kind: ZOMBIE_KIND,
      damage: { amount: 3, cause: 'mob' },
    })
    expect(shortDelta.damageCounts).toStrictEqual([1, 0])
    expect(longDelta.damageCounts).toStrictEqual([1, 0])
    expect(shortDelta.contactCounts).toStrictEqual([1, 1])
    expect(longDelta.contactCounts).toStrictEqual([1, 1])
    expect(shortDelta.contactTicks).toStrictEqual([SimulationTick(0), SimulationTick(0)])
    expect(longDelta.contactTicks).toStrictEqual([SimulationTick(0), SimulationTick(0)])
  })

  it('fails closed when the entities stage tick is behind a stored contact tick', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: zombieAt(1, 64) }))
    const previousCooldowns = new Map([[EntityId('test:zombie'), SimulationTick(10)]])
    await Effect.runPromise(Ref.set(harness.state.hostileContactCooldowns, previousCooldowns))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(9)))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))).toStrictEqual(previousCooldowns)
  })

  it('keeps dead-player vitals unchanged while recording a valid mob-contact hit', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      vitals: { ...SPAWN_VITALS, healthPoints: EntityHealthPoints(0) },
    }))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.25))

    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
    expect(harness.commits()).toBe(1)
    expect(vitalsAfter.state).toStrictEqual(vitalsBefore.state)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).not.toContain(
      GAMEPLAY_VITALS_OWNER_ID,
    )
    expect(damages).toMatchObject([{
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      damage: { amount: 3, cause: 'mob' },
    }])
  })

  it('commits equipped armor wear with mob-contact damage', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      playerStorage: equippedIronHelmetStorage(),
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.25))

    const after = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    )
    expect(after.state.equipment.slots.head?.durability?.current).toBeLessThan(
      before.state.equipment.slots.head?.durability?.current ?? Number.MAX_SAFE_INTEGER,
    )
  })

  it('breaks the last armor point with mob-contact damage', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      playerStorage: nearlyBrokenIronHelmetStorage(),
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.25))

    const after = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    )
    expect(before.state.equipment.slots.head?.durability?.current).toBe(1)
    expect(after.state.equipment.slots.head).toBeNull()
    expect(damages).toMatchObject([{
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      damage: { cause: 'mob' },
    }])
    expect(damages[0]?.damage.amount).toBeGreaterThan(0)
  })

  it('commits mob blast casualties, loot, damage, and block edits together', async () => {
    const { harness, zombie, centre } = await makeMobBlastHarness()

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedItems = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const outputs = await Effect.runPromise(Effect.all({
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      damages: Ref.get(harness.state.playerDamages),
    }))
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(
      GAMEPLAY_ENTITIES_OWNER_ID,
    )
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    )
    expect(harness.lastRequest()?.blockWrite?.edits.length).toBeGreaterThan(0)
    expect(roster.state.entities.some(({ id }) => id === zombie.id)).toBe(false)
    expect(droppedItems.state.items[0]?.behaviour).toMatchObject({
      _tag: 'DroppedItem',
      item: 'rotten_flesh',
      count: 1,
    })
    expect(outputs.drops).toMatchObject([{ item: 'rotten_flesh', count: 1 }])
    expect(outputs.experience).toStrictEqual([])
    expect(outputs.damages.length).toBeGreaterThan(0)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBeUndefined()
  })

  it('reports unknown mob loot and XP after a successful mob blast commit', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const creeper = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit' as const, burnedSecs: 1.49 },
    }
    const unknownMob = {
      ...zombieAt(1, 64),
      id: EntityId('test:unknown-blast-casualty'),
      kind: EntityKind('unregistered'),
      healthPoints: EntityHealthPoints(1),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, unknownMob],
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
      block: { position: centre, id: STONE },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))

    await harness.run(makeDeltaTimeSecs(0.02))

    expect(harness.commits()).toBe(1)
    expect((await Effect.runPromise(strictRoster(harness.coordinator))).state.entities).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toEqual(expect.arrayContaining([
      {
        _tag: 'Unsupported',
        action: 'MobDrop',
        reason: 'UnknownMobKind',
        mobKind: 'unregistered',
      },
      {
        _tag: 'Unsupported',
        action: 'MobExperience',
        reason: 'UnknownMobKind',
        mobKind: 'unregistered',
      },
    ]))
    expect(await Effect.runPromise(Ref.get(harness.state.mobDrops))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.mobExperience))).toStrictEqual([])
  })

  it('queues XP after a successful mob blast commit when the casualty has recent player credit', async () => {
    const creeper: MobEntity = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
    }
    const zombie: MobEntity = {
      ...zombieAt(1, 64),
      healthPoints: EntityHealthPoints(1),
      killCredit: 'player',
      lastHitTick: SimulationTick(0),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, zombie],
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const experience = await Effect.runPromise(Ref.get(harness.state.mobExperience))
    expect(harness.commits()).toBe(1)
    expect(roster.state.entities).toStrictEqual([])
    expect(experience).toMatchObject([{ source: zombie.id, amount: 5 }])
  })

  it('does not commit mob blast casualties when the dropped-item owner revision differs', async () => {
    const { harness, centre } = await makeMobBlastHarness()
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const outputsBefore = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      damages: Ref.get(harness.state.playerDamages),
      fallingBlocks: Ref.get(harness.state.fallingBlocks),
    }))
    harness.mismatchNextSnapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.02)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      damages: Ref.get(harness.state.playerDamages),
      fallingBlocks: Ref.get(harness.state.fallingBlocks),
    }))).toStrictEqual(outputsBefore)
  })

  it('deduplicates block edits shared by overlapping mob blasts', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const harness = await Effect.runPromise(makeHarness({
      entities: [
        {
          ...creeperAt(0, 64),
          id: EntityId('test:creeper-first-blast'),
          behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
        },
        {
          ...creeperAt(1, 64),
          id: EntityId('test:creeper-second-blast'),
          behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
        },
      ],
      block: { position: centre, id: STONE },
    }))

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const edits = harness.lastRequest()?.blockWrite?.edits ?? []
    expect(harness.commits()).toBe(1)
    expect(roster.state.entities).toStrictEqual([])
    const centreKey = blockPositionKeyOf(centre)
    expect(edits.filter(({ position: editPosition }) =>
      blockPositionKeyOf(editPosition) === centreKey,
    )).toHaveLength(1)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBeUndefined()
  })

  it('keeps mob casualty drops unsupported when their owner is not registered', async () => {
    const { harness, centre } = await makeMobBlastHarness()
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const { droppedItemsOwnerId: _omittedDroppedOwner, ...commitWithoutDroppedOwner } = harness.context.commit!
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutDroppedOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.02)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('fails without committing when the player snapshot revision differs from the entity roster', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: zombieAt(1, 64) }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_PLAYER_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.25)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))).toStrictEqual(playerBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('fails without committing mob damage when the vitals snapshot revision differs', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
    }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_VITALS_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.25)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('fails without committing mob damage when the storage snapshot revision differs', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
    }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.25)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('rejects mob projectile preparation when entity and projectile revisions differ', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      projectileService: true,
      armSnapshotMismatchAfterProjectileSnapshot: {
        snapshotNumber: 2,
        ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
      },
    }))
    await seedPendingMobProjectileImpact(harness.coordinator)
    const entitiesBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const commitsBefore = harness.commits()

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    if (exit._tag !== 'Failure') throw new Error('Expected the stage to reject mismatched owner revisions')
    expect(Cause.squash(exit.cause)).toBeInstanceOf(WorldRevisionConflict)
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(commitsBefore)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(entitiesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toStrictEqual(projectilesBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('rejects mob projectile resolution when projectile and entity revisions differ', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      projectileService: true,
      armSnapshotMismatchAfterProjectileSnapshot: {
        snapshotNumber: 2,
        ownerId: PROJECTILE_REPLICATED_OWNER_ID,
        count: 3,
      },
    }))
    await seedPendingMobProjectileImpact(harness.coordinator)
    const entitiesBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const projectilesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const commitsBefore = harness.commits()

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    if (exit._tag !== 'Failure') throw new Error('Expected the stage to reject mismatched owner revisions')
    expect(Cause.squash(exit.cause)).toBeInstanceOf(WorldRevisionConflict)
    expect(harness.mismatchedSnapshots()).toBe(3)
    expect(harness.commits()).toBe(commitsBefore)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(entitiesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))).toStrictEqual(projectilesBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('consumes a saved projectile impact after its target has left the roster', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, projectileService: true }))
    const staleTarget = EntityId('test:despawned-target')
    const projectileId = await seedPendingMobProjectileImpact(harness.coordinator, {
      kind: BLAZE_KIND,
      entityId: staleTarget,
    })

    await harness.run(makeDeltaTimeSecs(0.05))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    expect(roster.state.entities.map(({ id }) => id)).not.toContain(staleTarget)
    expect(roster.state.pendingMobProjectileImpacts ?? []).toStrictEqual([])
    expect(roster.state.resolvedMobProjectileIds).toContain(projectileId)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.fireLifecycle))).toMatchObject({ fires: [] })
  })

  it('keeps undead protected when their chunk and skylight are unavailable', async () => {
    const lightReads: Array<Readonly<{ x: number; y: number; z: number }>> = []
    const skeleton: MobEntity = {
      ...ecosystemMobAt('test:unloaded-skeleton', SKELETON_KIND, 8, 64),
      dimension: 'overworld',
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [skeleton],
      loadedChunks: [],
      onLightRead: (at) => lightReads.push(at),
    }))
    await Effect.runPromise(harness.time.setTimeOfDay(InterpolationFraction(0.5)))

    await harness.run(makeDeltaTimeSecs(0.05))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    expect(lightReads).toContainEqual({ x: 8, y: 65, z: 0 })
    expect(roster.state.entities[0]?.healthPoints).toBe(20)
    expect(roster.state.entities[0]?.behaviour).toMatchObject({
      behaviour: { burningTicks: 0 },
    })
  })

  it('records an unavailable projectile owner when its registration is unknown', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        projectileOwnerId: makeReplicatedOwnerId('test:unknown-projectile-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('propagates a non-unknown projectile owner snapshot failure', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        projectileOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      },
    }

    const exit = await Effect.runPromiseExit(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(exit._tag).toBe('Failure')
  })

  it('does not report a resolved projectile as outstanding without its service', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, projectileService: true }))
    await seedExpiredMobProjectile(harness.coordinator, true, true)
    const { projectileService: registeredService, eventBus: registeredEventBus, ...commitWithoutService } =
      harness.context.commit!
    void registeredService
    void registeredEventBus
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutService,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
  })

  it('fails closed when projectile support has no dropped item owner', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, projectileService: true }))
    await seedPendingMobProjectileImpact(harness.coordinator, { entityId: EntityId('test:despawned-target') })
    const { droppedItemsOwnerId: omittedOwner, ...commitWithoutDroppedItemsOwner } = harness.context.commit!
    void omittedOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutDroppedItemsOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('records an unknown preflight owner as unsupported projectile simulation', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, projectileService: true }))
    await seedPendingMobProjectileImpact(harness.coordinator, { entityId: EntityId('test:despawned-target') })
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        droppedItemsOwnerId: makeReplicatedOwnerId('test:unknown-dropped-items-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('propagates a non-unknown projectile preflight failure', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, projectileService: true }))
    await seedPendingMobProjectileImpact(harness.coordinator, { entityId: EntityId('test:despawned-target') })
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        droppedItemsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      },
    }

    const exit = await Effect.runPromiseExit(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(exit._tag).toBe('Failure')
  })

  it('retires expired mob projectiles with omitted and explicit empty pending lists', async () => {
    for (const withExplicitEmptyPending of [false, true]) {
      const harness = await Effect.runPromise(makeHarness({ entity: null, projectileService: true }))
      const projectileId = await seedExpiredMobProjectile(harness.coordinator, withExplicitEmptyPending)

      await harness.run(makeDeltaTimeSecs(0.05))

      const projectiles = await Effect.runPromise(harness.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      ))
      const roster = await Effect.runPromise(strictRoster(harness.coordinator))
      expect(projectiles.state.projectiles).toStrictEqual([])
      expect(roster.state.resolvedMobProjectileIds ?? []).not.toContain(projectileId)
      if (withExplicitEmptyPending) {
        expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
          PROJECTILE_REPLICATED_OWNER_ID,
        ])
      }
    }
  })

  it('does not launch an arrow from a skeleton killed by a same-tick creeper blast', async () => {
    const creeper: MobEntity = {
      ...creeperAt(3, 64),
      behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
    }
    const skeleton: MobEntity = {
      ...ecosystemMobAt('test:blast-killed-skeleton', SKELETON_KIND, 8, 64),
      healthPoints: EntityHealthPoints(1),
    }
    const spider: MobEntity = {
      id: EntityId('test:movement-tick-spider'),
      kind: SPIDER_KIND,
      feetPosition: position(PositionAxis(12), PositionAxis(64), PositionAxis(0)),
      healthPoints: EntityHealthPoints(16),
      behaviour: hostileMobSnapshot(initialEcosystemMobState()),
    }
    const loadedChunks = [-2, -1, 0, 1, 2].flatMap((chunkX) =>
      [-2, -1, 0, 1, 2].map((chunkZ) => `${String(chunkX)},${String(chunkZ)}`),
    )
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, skeleton, spider],
      loadedChunks,
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
      projectileService: true,
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, RandomSeed(3)))

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const projectiles = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const afterSpider = roster.state.entities.find(({ id }) => id === spider.id)
    expect(roster.state.entities.map(({ id }) => id)).not.toContain(skeleton.id)
    expect(projectiles.state.projectiles).toStrictEqual([])
    expect(afterSpider?.behaviour).toMatchObject({ _tag: 'HostileMob', movement: expect.any(Object) })
  })

  it('fails the projectile world build for finite coordinates outside the chunk range', async () => {
    const far = 2 ** 60
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(far), PositionAxis(64), PositionAxis(0)),
      },
      loadedChunks: [],
      projectileService: true,
    }))
    await seedFlyingMobProjectile(
      harness.coordinator,
      'mx-gameplay:mob:arrow:empty-world:0',
      position(PositionAxis(far), PositionAxis(65), PositionAxis(0)),
      { x: 1, y: 0, z: 0 },
    )

    const exit = await Effect.runPromiseExit(harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(exit._tag).toBe('Failure')
    if (exit._tag !== 'Failure') return
    expect(Cause.squash(exit.cause)).toMatchObject({ _tag: 'ProjectileWorldUnavailable' })
  })

  it('rejects a block hit outside the safe block-coordinate range', async () => {
    const edge = 2 ** 53
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(edge - 20), PositionAxis(64), PositionAxis(0)),
      },
      loadedChunks: [],
      projectileService: true,
    }))
    await seedFlyingMobProjectile(
      harness.coordinator,
      'mx-gameplay:mob:arrow:unsafe-block:0',
      position(PositionAxis(edge), PositionAxis(65.5), PositionAxis(0)),
      { x: 1000, y: 0, z: 0 },
    )

    const exit = await Effect.runPromiseExit(harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(exit._tag).toBe('Failure')
    if (exit._tag !== 'Failure') return
    expect(Cause.squash(exit.cause)).toMatchObject({
      _tag: 'ProjectileServiceFailure',
      reason: 'block-address-unavailable',
    })
  })

  it('reports when the projectile service disagrees with the stage preview', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      block: { position: blockPosition(BlockAxis(8), BlockAxis(65), BlockAxis(0)), id: STONE },
      projectileService: true,
    }))
    await seedFlyingMobProjectile(
      harness.coordinator,
      'mx-gameplay:mob:arrow:preview-mismatch:0',
      position(PositionAxis(10.5), PositionAxis(65.5), PositionAxis(0.5)),
      { x: -60, y: 0, z: 0 },
    )

    const commit = harness.context.commit!
    const service = commit.projectileService!
    const projectileService = {
      ...service,
      step: (request: Parameters<typeof service.step>[0]) => service.step(request).pipe(
        Effect.map((outcome) => {
          const { hit, ...withoutHit } = outcome
          void hit
          return withoutHit
        }),
      ),
    }
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...commit, projectileService },
    }
    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    if (exit._tag !== 'Failure') return
    expect(Cause.squash(exit.cause)).toMatchObject({ _tag: 'MobProjectilePreviewMismatch' })
  })

  it('treats an unrepresentable ranged ray as blocked at the stage boundary', async () => {
    const edge = 2 ** 53
    const sourceChunkX = Math.floor(Number.MAX_SAFE_INTEGER / 16)
    const targetChunkX = Math.floor((edge + 8) / 16)
    const loadedChunks = []
    for (let chunkX = sourceChunkX - 2; chunkX <= targetChunkX + 2; chunkX += 1) {
      for (let chunkZ = -2; chunkZ <= 2; chunkZ += 1) {
        loadedChunks.push(`${String(chunkX)},${String(chunkZ)}`)
      }
    }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(edge + 8), PositionAxis(64), PositionAxis(0)),
    }
    const skeleton: MobEntity = {
      ...ecosystemMobAt('test:unrepresentable-ray-skeleton', SKELETON_KIND, Number.MAX_SAFE_INTEGER, 64),
      dimension: 'overworld',
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [skeleton],
      playerPose,
      loadedChunks,
      projectileService: true,
    }))

    await harness.run(makeDeltaTimeSecs(0.05))

    const projectiles = await Effect.runPromise(harness.coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    ))
    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const afterSkeleton = roster.state.entities.find(({ id }) => id === skeleton.id)
    expect(projectiles.state.projectiles).toStrictEqual([])
    const hostileSnapshot = afterSkeleton?.behaviour
    expect(hostileSnapshot?._tag).toBe('HostileMob')
    if (hostileSnapshot?._tag !== 'HostileMob') return
    const ecosystemState = hostileSnapshot.behaviour
    expect(ecosystemState?._tag).toBe('EcosystemMob')
    if (ecosystemState?._tag !== 'EcosystemMob') return
    expect(ecosystemState.attackCooldownTicks).toBeGreaterThan(0)
  })

  it('applies saved mob projectile damage and wear to equipped player armor', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      playerStorage: equippedIronHelmetStorage(),
      projectileService: true,
    }))
    const beforeVitals = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    await seedPendingMobProjectileImpact(harness.coordinator, {
      point: position(PositionAxis(1), PositionAxis(64), PositionAxis(0)),
    })

    await harness.run(makeDeltaTimeSecs(0.05))

    const afterVitals = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const storageChange = harness.lastRequest()?.changes.find(({ ownerId }) =>
      ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    )?.state as PlayerStorage | undefined
    expect(afterVitals.state.vitals.healthPoints).toBeLessThan(beforeVitals.state.vitals.healthPoints)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toMatchObject([{
      _tag: 'HostileContact',
      kind: SKELETON_KIND,
      damage: { cause: 'projectile' },
    }])
    expect(storageChange?.equipment.slots.head?.durability?.current).toBeLessThan(165)
  })

  it('blocks a saved Blaze fireball with a ready shield and records shield wear', async () => {
    const runBlockedFireball = async (shieldDurability: number) => {
      const playerPose = {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
        yawRadians: -Math.PI / 2 as typeof INITIAL_PLAYER_POSE.yawRadians,
      }
      const harness = await Effect.runPromise(makeHarness({
        entity: null,
        playerPose,
        projectileService: true,
        synthesizeShieldStorageSnapshot: true,
        shieldDurability,
      }))
      await Effect.runPromise(Ref.set(harness.state.shieldBlocking, {
        actor: EntityId('mx-gameplay:player-avatar'),
        raisedAt: SimulationTick(1),
      }))
      await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(15)))
      await seedPendingMobProjectileImpact(harness.coordinator, {
        kind: BLAZE_KIND,
        point: position(PositionAxis(1), PositionAxis(64), PositionAxis(0)),
      })
      if (shieldDurability > 1) harness.rejectCommits(true)

      const exit = await Effect.runPromiseExit(
        harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
      )
      if (shieldDurability > 1) {
        expect(exit._tag).toBe('Failure')
      } else {
        expect(exit._tag).toBe('Success')
      }
      if (exit._tag === 'Failure') {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(WorldRevisionConflict)
      }
      const storageChange = harness.lastRequest()?.changes.find(({ ownerId }) =>
        ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      )?.state as PlayerStorage | undefined
      return {
        offhand: storageChange?.equipment.slots.offhand,
        fires: (await Effect.runPromise(Ref.get(harness.state.fireLifecycle))).burningActors ?? [],
      }
    }

    const durable = await runBlockedFireball(336)
    const broken = await runBlockedFireball(1)

    expect(durable.offhand?.item).toBe('shield')
    expect(durable.offhand?.durability?.current).toBeLessThan(336)
    expect(broken.offhand).toBeNull()
    expect(broken.fires).toStrictEqual([])
  })

  it('rejects a saved projectile impact when player-side owner revisions diverge', async () => {
    for (const ownerId of [
      GAMEPLAY_PLAYER_OWNER_ID,
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_VITALS_OWNER_ID,
    ]) {
      const harness = await Effect.runPromise(makeHarness({
        entity: null,
        projectileService: true,
        mismatchSnapshotAt: {
          ownerId,
          snapshotNumber: ownerId === GAMEPLAY_PLAYER_OWNER_ID ? 3 : 2,
          count: 3,
        },
      }))
      await seedPendingMobProjectileImpact(harness.coordinator, {
        point: position(PositionAxis(1), PositionAxis(64), PositionAxis(0)),
      })

      const exit = await Effect.runPromiseExit(
        harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
      )

      expect(exit._tag).toBe('Failure')
      if (exit._tag !== 'Failure') continue
      expect(Cause.squash(exit.cause)).toBeInstanceOf(WorldRevisionConflict)
      expect(harness.mismatchedSnapshots()).toBe(3)
    }
  })

  it('rejects saved projectile casualty drops when the dropped-item revision changes', async () => {
    const pig: MobEntity = {
      id: EntityId('test:pig'),
      kind: EntityKind('pig'),
      feetPosition: position(PositionAxis(8), PositionAxis(64), PositionAxis(0)),
      healthPoints: EntityHealthPoints(3),
      behaviour: undefined,
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [pig],
      projectileService: true,
      mismatchSnapshotAt: {
        snapshotNumber: 2,
        ownerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        count: 3,
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, RandomSeed(1)))
    await seedPendingMobProjectileImpact(harness.coordinator, { entityId: pig.id })

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    if (exit._tag !== 'Failure') return
    expect(Cause.squash(exit.cause)).toBeInstanceOf(WorldRevisionConflict)
    expect(harness.mismatchedSnapshots()).toBe(3)
    expect(await Effect.runPromise(Ref.get(harness.state.mobDrops))).toStrictEqual([])
  })

  it('records unavailable player damage owners without committing a mob contact candidate', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: zombieAt(1, 64) }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const { vitalsOwnerId: omittedVitalsOwner, ...commitWithoutVitalsOwner } = harness.context.commit!
    void omittedVitalsOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutVitalsOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.25)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).state).toStrictEqual(vitalsBefore.state)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('leaves registered mob owners and frame outputs unchanged when the owner commit is rejected', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      rejectCommit: true,
    }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const localBefore = await Effect.runPromise(Effect.all({
      damages: Ref.get(harness.state.playerDamages),
      cooldowns: Ref.get(harness.state.hostileContactCooldowns),
      lastHostileSpawnTick: Ref.get(harness.state.lastHostileSpawnTick),
      lastPassiveSpawnTick: Ref.get(harness.state.lastPassiveSpawnTick),
      passiveInitialSpawnPending: Ref.get(harness.state.passiveInitialSpawnPending),
    }))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(0.25 as DeltaTimeSecs).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_ENTITIES_OWNER_ID,
      GAMEPLAY_VITALS_OWNER_ID,
    ])
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Effect.all({
      damages: Ref.get(harness.state.playerDamages),
      cooldowns: Ref.get(harness.state.hostileContactCooldowns),
      lastHostileSpawnTick: Ref.get(harness.state.lastHostileSpawnTick),
      lastPassiveSpawnTick: Ref.get(harness.state.lastPassiveSpawnTick),
      passiveInitialSpawnPending: Ref.get(harness.state.passiveInitialSpawnPending),
    }))).toStrictEqual(localBefore)
  })

  it('pins the fuse ignition threshold at 3 blocks, including the just-outside case', async () => {
    const boundary = await Effect.runPromise(makeHarness({ entity: creeperAt(3) }))
    await boundary.run(0 as DeltaTimeSecs)
    const lit = await Effect.runPromise(strictRoster(boundary.coordinator))
    expect(lit.state.entities[0]?.behaviour).toMatchObject({ _tag: 'Lit', burnedSecs: 0.05 })
    expect(boundary.commits()).toBe(1)

    const outside = await Effect.runPromise(makeHarness({ entity: creeperAt(3.0001) }))
    const before = await Effect.runPromise(strictRoster(outside.coordinator))
    await outside.run(0 as DeltaTimeSecs)
    const after = await Effect.runPromise(strictRoster(outside.coordinator))
    expect(after.state.entities[0]?.behaviour).toMatchObject({
      _tag: 'HostileMob',
      behaviour: { _tag: 'Dormant' },
    })
    expect(after.state.entities[0]?.feetPosition).toStrictEqual(before.state.entities[0]?.feetPosition)
    expect(outside.commits()).toBe(1)
  })

  it('runs passive and hostile spawn searches on the cadence with their distinct seed rules', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const initialSeed = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.5)))

    await harness.run(makeDeltaTimeSecs(0))

    const passiveSeed = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    const initialPending = await Effect.runPromise(Ref.get(harness.state.passiveInitialSpawnPending))
    const passiveCalls = await Effect.runPromise(harness.store.calls)
    expect(passiveSeed).not.toBe(initialSeed)
    expect(initialPending).toBe(false)
    expect(passiveCalls.peeks).toBeGreaterThan(0)

    await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.9)))
    await Effect.runPromise(Ref.set(harness.state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS - 1))
    await harness.run(makeDeltaTimeSecs(0))

    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).not.toBe(passiveSeed)
    expect(await Effect.runPromise(Ref.get(harness.state.lastHostileSpawnTick))).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
  })

  it('commits casualty drops and XP with a passive spawn in the same simulation tick', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const creeper: MobEntity = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
    }
    const zombie: MobEntity = {
      ...zombieAt(1, 64),
      healthPoints: EntityHealthPoints(1),
      killCredit: 'player',
      lastHitTick: SimulationTick(0),
    }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, zombie],
      playerPose,
      block: { position: centre, id: STONE },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
    await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.5)))
    await Effect.runPromise(requestMobSpawn(harness.state, {
      candidate: {
        groundBlock: STONE,
        footBlock: AIR_BLOCK_ID,
        headBlock: AIR_BLOCK_ID,
        blockLight: 0,
        skyLight: SkyLightLevel(0),
        biome: 'PLAINS',
        timeOfDay: 0.5,
        distanceToPlayerBlocksXZ: 30,
      },
      kind: COW_KIND,
      feetPosition: position(PositionAxis(30), PositionAxis(64), PositionAxis(0)),
    }))

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const outputs = await Effect.runPromise(Effect.all({
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      lastPassiveSpawnTick: Ref.get(harness.state.lastPassiveSpawnTick),
      passiveInitialSpawnPending: Ref.get(harness.state.passiveInitialSpawnPending),
    }))
    expect(harness.commits()).toBe(1)
    expect(roster.state.entities.some(({ kind }) =>
      kind === 'cow' || kind === 'pig' || kind === 'sheep' || kind === 'chicken',
    )).toBe(true)
    expect(roster.state.entities.some(({ id }) => id === zombie.id)).toBe(false)
    expect(outputs.drops).toMatchObject([{ item: 'rotten_flesh', count: 1 }])
    expect(outputs.experience).toMatchObject([{ source: zombie.id, amount: 5 }])
    expect(outputs.lastPassiveSpawnTick).toBe(1)
    expect(outputs.passiveInitialSpawnPending).toBe(false)
  })

  it('feeds a variable casualty XP roll into the same-tick hostile spawn seed', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const detonatingCreeper: MobEntity = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
    }
    const bee = {
      ...beeAt(3, 64, 1),
      killCredit: 'player' as const,
      lastHitTick: SimulationTick(0),
    }
    const deadSearchLightPositions: Array<string> = []
    const livingSearchLightPositions: Array<string> = []
    const spawnFloor = Array.from({ length: 16 * 16 }, (_, index) => {
      const x = 16 + index % 16
      const z = Math.floor(index / 16)
      return [blockPosition(BlockAxis(x), BlockAxis(63), BlockAxis(z)), STONE] as const
    })
    const creditedDeath = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [detonatingCreeper, bee],
      playerPose,
      blocks: spawnFloor,
      loadedChunks: ['1,0'],
      onLightRead: ({ x, y, z }) => deadSearchLightPositions.push(`${String(x)},${String(y)},${String(z)}`),
    }))
    const survivingBee = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [detonatingCreeper, { ...bee, healthPoints: EntityHealthPoints(20) }],
      playerPose,
      blocks: spawnFloor,
      loadedChunks: ['1,0'],
      onLightRead: ({ x, y, z }) => livingSearchLightPositions.push(`${String(x)},${String(y)},${String(z)}`),
    }))
    const initialRoster = await Effect.runPromise(strictRoster(creditedDeath.coordinator))
    const expectedHostileSearchPosition = (seed: number): string => {
      const rotation = nextRoll(seed).roll
      const firstRadius = MIN_SPAWN_DISTANCE_BLOCKS + SPAWN_RING_RADIUS_INSET_BLOCKS
      const angle = rotation / SPAWN_RING_ANGLES * 2 * Math.PI
      const x = Math.floor(playerPose.feetPosition.x + firstRadius * Math.cos(angle))
      const z = Math.floor(playerPose.feetPosition.z + firstRadius * Math.sin(angle))
      return `${String(x)},64,${String(z)}`
    }
    const expectedSeedFlowFor = (frameSeed: number) => {
      const sweep = planMobRosterSweep(initialRoster.state, {
        target: playerPose.feetPosition,
        dt: makeDeltaTimeSecs(0.02),
      }, RandomSeed(frameSeed))
      const blast = planMobBlastRoster(
        sweep.roster,
        sweep.blasts,
        SimulationTick(HOSTILE_SPAWN_INTERVAL_TICKS),
      )
      const drops = rollCasualtyDrops(blast.casualties, sweep.seed)
      const experienceRoll = nextRoll(drops.seed)
      return {
        frameSeed,
        casualties: blast.casualties,
        experienceRoll,
        expectedSearchPosition: expectedHostileSearchPosition(experienceRoll.seed),
        searchPositionWithoutExperienceRoll: expectedHostileSearchPosition(drops.seed),
      }
    }
    let seedFixture: ReturnType<typeof expectedSeedFlowFor> | undefined
    for (let frameSeed = 3; frameSeed < 131; frameSeed += 1) {
      const candidate = expectedSeedFlowFor(frameSeed)
      if (
        candidate.casualties.length === 1 && candidate.casualties[0]?.id === bee.id &&
        candidate.expectedSearchPosition !== candidate.searchPositionWithoutExperienceRoll
      ) {
        seedFixture = candidate
        break
      }
    }
    expect(seedFixture).toBeDefined()
    if (seedFixture === undefined) return
    const {
      frameSeed,
      casualties,
      experienceRoll: expectedExperienceRoll,
      expectedSearchPosition,
      searchPositionWithoutExperienceRoll,
    } = seedFixture
    expect(casualties.map(({ id }) => id)).toStrictEqual([bee.id])
    const runHostileSearchTick = async (harness: typeof creditedDeath) => {
      await Effect.runPromise(Ref.set(harness.state.rollSeed, frameSeed))
      await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.9)))
      await Effect.runPromise(Ref.set(harness.state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS - 1))
      await harness.run(makeDeltaTimeSecs(0.02))
    }
    await runHostileSearchTick(creditedDeath)
    await runHostileSearchTick(survivingBee)

    const deadRoster = await Effect.runPromise(strictRoster(creditedDeath.coordinator))
    const livingRoster = await Effect.runPromise(strictRoster(survivingBee.coordinator))
    const outputs = await Effect.runPromise(Effect.all({
      deadExperience: Ref.get(creditedDeath.state.mobExperience),
      livingExperience: Ref.get(survivingBee.state.mobExperience),
      deadSeed: Ref.get(creditedDeath.state.rollSeed),
      livingSeed: Ref.get(survivingBee.state.rollSeed),
      deadHostileTick: Ref.get(creditedDeath.state.lastHostileSpawnTick),
      livingHostileTick: Ref.get(survivingBee.state.lastHostileSpawnTick),
    }))
    const deadSearchCalls = await Effect.runPromise(creditedDeath.store.calls)
    const livingSearchCalls = await Effect.runPromise(survivingBee.store.calls)

    expect(outputs.deadExperience).toStrictEqual([{
      source: bee.id,
      kind: EntityKind('bee'),
      amount: 1 + Math.floor(expectedExperienceRoll.roll * 3),
      at: bee.feetPosition,
    }])
    expect(outputs.livingExperience).toStrictEqual([])
    expect(outputs.deadSeed).toBe(nextRoll(outputs.livingSeed).seed)
    expect(outputs.deadHostileTick).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
    expect(outputs.livingHostileTick).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
    expect(deadSearchCalls.peeks).toBeGreaterThan(0)
    expect(livingSearchCalls.peeks).toBeGreaterThan(0)
    expect(deadSearchLightPositions[0]).toBe(expectedSearchPosition)
    expect(deadSearchLightPositions[0]).not.toBe(searchPositionWithoutExperienceRoll)
    expect(livingSearchLightPositions[0]).toBeDefined()
    expect(deadRoster.state.entities.some(({ id }) => id === bee.id)).toBe(false)
    expect(livingRoster.state.entities.some(({ id }) => id === bee.id)).toBe(true)
  })

  it('merges an offered spawn ahead of the cadence search and drains the offered attempt', async () => {
    const ground: Array<readonly [ReturnType<typeof blockPosition>, BlockId]> = []
    const loadedChunks = new Set<string>()
    // The stage advances the seed as it sweeps the roster; floor the full 24-to-40
    // band so the search result does not depend on the cursor's resulting angle.
    for (let x = -48; x <= 47; x += 1) {
      for (let z = -48; z <= 47; z += 1) {
        ground.push([blockPosition(BlockAxis(x), BlockAxis(63), BlockAxis(z)), STONE])
      }
    }
    for (let chunkX = -3; chunkX <= 2; chunkX += 1) {
      for (let chunkZ = -3; chunkZ <= 2; chunkZ += 1) {
        loadedChunks.add(`${String(chunkX)},${String(chunkZ)}`)
      }
    }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      blocks: ground,
      loadedChunks: [...loadedChunks],
    }))
    const offered = {
      candidate: {
        groundBlock: STONE,
        footBlock: AIR_BLOCK_ID,
        headBlock: AIR_BLOCK_ID,
        blockLight: 0,
        skyLight: SkyLightLevel(0),
        biome: 'PLAINS' as const,
        timeOfDay: 0.9,
        distanceToPlayerBlocksXZ: 30,
      },
      kind: CREEPER_KIND,
      feetPosition: position(PositionAxis(30), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.9)))
    await Effect.runPromise(requestMobSpawn(harness.state, offered))

    await Effect.runPromise(Ref.set(harness.state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS - 1))
    await harness.run(makeDeltaTimeSecs(0))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    expect(roster.state.entities).toHaveLength(2)
    expect(roster.state.entities[0]?.feetPosition).toStrictEqual(offered.feetPosition)
    expect(await Effect.runPromise(Ref.get(harness.state.spawnAttempts))).toStrictEqual([])
    expect(harness.commits()).toBe(1)
  })

  it('keeps an offered spawn queued when the valid owner serial is exhausted', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    await Effect.runPromise(harness.coordinator.commit({
      expectedRevision: rosterBefore.revision,
      expectedDimensions: [],
      changes: [{
        ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
        state: { ...rosterBefore.state, nextSerial: EntitySerial(Number.MAX_SAFE_INTEGER) },
      }],
    }))
    const exhaustedRoster = await Effect.runPromise(strictRoster(harness.coordinator))
    const offered = {
      candidate: {
        groundBlock: STONE,
        footBlock: AIR_BLOCK_ID,
        headBlock: AIR_BLOCK_ID,
        blockLight: 0,
        skyLight: SkyLightLevel(0),
        biome: 'PLAINS' as const,
        timeOfDay: 0.9,
        distanceToPlayerBlocksXZ: 30,
      },
      kind: CREEPER_KIND,
      feetPosition: position(PositionAxis(30), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestMobSpawn(harness.state, offered))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(1)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(exhaustedRoster)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(exhaustedRoster.revision)
    expect(await Effect.runPromise(Ref.get(harness.state.spawnAttempts))).toStrictEqual([offered])
    expect(await Effect.runPromise(Ref.get(harness.state.lastHostileSpawnTick))).toBe(0)
  })

  it('skips block edits when a valid finite mob position exceeds the block-axis range', async () => {
    const outsideSafeInteger = Number.MAX_SAFE_INTEGER + 1
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(outsideSafeInteger), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: {
        ...creeperAt(outsideSafeInteger, 64),
        behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
      },
      playerPose,
    }))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.02))

    const rosterAfter = await Effect.runPromise(strictRoster(harness.coordinator))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
    expect(harness.commits()).toBe(1)
    expect(rosterAfter.state.entities).toStrictEqual([])
    expect(vitalsAfter.state.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
    expect(damages).toMatchObject([{ _tag: 'Explosion', source: EntityId('test:creeper') }])
    expect(harness.lastRequest()?.blockWrite).toBeUndefined()
    expect((await Effect.runPromise(harness.store.calls)).reads).toBe(0)
  })

  it('requeues the lower destination after a falling block moves', async () => {
    const target = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const source = blockPosition(BlockAxis(0), BlockAxis(65), BlockAxis(0))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      block: { position: source, id: SAND },
    }))
    await Effect.runPromise(Ref.update(harness.state.fallingBlocks, (queue) =>
      disturb(queue, [blockPositionKeyOf(target)]),
    ))

    await harness.run(makeDeltaTimeSecs(0))

    expect(await Effect.runPromise(harness.store.blockAt(target))).toBe(SAND)
    expect(await Effect.runPromise(harness.store.api.getBlock(source))).toStrictEqual({
      _tag: 'Block',
      block: AIR_BLOCK_ID,
    })
    expect([...((await Effect.runPromise(Ref.get(harness.state.fallingBlocks))).pending)]).toStrictEqual([
      blockPositionKeyOf(blockPosition(BlockAxis(0), BlockAxis(63), BlockAxis(0))),
      blockPositionKeyOf(source),
    ])
  })

  it('keeps entity, block, revision, and output state unchanged when a combined blast commit fails', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const harness = await Effect.runPromise(makeHarness({
      entity: { ...creeperAt(0, 64), behaviour: { _tag: 'Lit', burnedSecs: 1.49 } },
      block: { position: centre, id: STONE },
      rejectCommit: true,
    }))
    const ownerBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const playerBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const localBefore = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      cooldowns: Ref.get(harness.state.hostileContactCooldowns),
      attempts: Ref.get(harness.state.spawnAttempts),
    }))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(0.02 as DeltaTimeSecs).pipe(Effect.provide(FrameServicesLayer)),
    )
    const ownerAfter = await Effect.runPromise(strictRoster(harness.coordinator))
    const revisionAfter = await Effect.runPromise(harness.coordinator.revision)
    const playerAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const localAfter = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      cooldowns: Ref.get(harness.state.hostileContactCooldowns),
      attempts: Ref.get(harness.state.spawnAttempts),
    }))

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.blockWrite?.edits.length).toBeGreaterThan(0)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_ENTITIES_OWNER_ID)
    expect(ownerAfter).toStrictEqual(ownerBefore)
    expect(playerAfter.state).toStrictEqual(playerBefore.state)
    expect(revisionAfter).toBe(revisionBefore)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(localAfter).toStrictEqual(localBefore)
  })

  it('detonates registered TNT through one service commit with entity, player, and block candidates', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (fuseTicks) => {
        const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
        const tntId = EntityId('test:tnt')
        const harness = await Effect.runPromise(makeHarness({
          entity: creeperAt(0, 64),
          block: { position: centre, id: STONE },
          tnt: {
            tnts: [{
              id: tntId,
              dimension: INITIAL_DIMENSION,
              center: { x: 0, y: 64, z: 0 },
              state: { kind: 'primed', remainingFuseSecs: fuseTicks / 100 },
            }],
          },
        }))
        const tntBefore = await Effect.runPromise(
          harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
        )
        const entityBefore = await Effect.runPromise(strictRoster(harness.coordinator))
        const vitalsBefore = await Effect.runPromise(
          harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        )
        const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

        await harness.run(0.05 as DeltaTimeSecs)

        const tntAfter = await Effect.runPromise(
          harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
        )
        const entityAfter = await Effect.runPromise(strictRoster(harness.coordinator))
        const vitalsAfter = await Effect.runPromise(
          harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        )
        const decodedTnt = Schema.decodeUnknownSync(TntServiceSnapshotSchema)(tntAfter.state)
        const decodedEntity = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(entityAfter.state)
        const revisionAfter = await Effect.runPromise(harness.coordinator.revision)
        const outputs = await Effect.runPromise(Effect.all({
          damages: Ref.get(harness.state.playerDamages),
          drops: Ref.get(harness.state.mobDrops),
          experience: Ref.get(harness.state.mobExperience),
        }))

        expect(harness.commits()).toBe(0)
        expect(harness.tntCommits()).toBe(1)
        expect(revisionAfter).toBe(revisionBefore + 1)
        expect(decodedTnt.tnts[0]?.state).toStrictEqual({ kind: 'detonated' })
        expect(decodedEntity.entities).toStrictEqual([])
        expect(vitalsAfter.state.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
        expect(await Effect.runPromise(harness.store.blockAt(centre))).toBeUndefined()
        expect(outputs.damages).toHaveLength(1)
        expect(Schema.decodeUnknownSync(GameplayEntityRosterSchema)(entityBefore.state).entities).toHaveLength(1)
        expect(Schema.decodeUnknownSync(TntServiceSnapshotSchema)(tntBefore.state).tnts[0]?.state.kind).toBe('primed')
      }),
      { numRuns: 8 },
    )
  })

  it('rolls player-triggered TNT cow experience from the frame seed and replays it', async () => {
    const tntId = EntityId('test:tnt-cow-xp')
    const cowId = EntityId('test:cow-xp')
    const run = async () => {
      const harness = await Effect.runPromise(makeHarness({
        entity: null,
        entities: [{
          id: cowId,
          kind: COW_KIND,
          feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
          healthPoints: EntityHealthPoints(1),
          behaviour: initialBehaviourOfKind(COW_KIND),
        }],
        block: { position: blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0)), id: STONE },
        tntSources: { sources: [{ tntId, killCredit: 'player-triggered-tnt' }] },
        tnt: {
          tnts: [{
            id: tntId,
            dimension: INITIAL_DIMENSION,
            center: { x: 0, y: 64, z: 0 },
            state: { kind: 'primed', remainingFuseSecs: 0.01 },
          }],
        },
      }))
      await Effect.runPromise(Ref.set(harness.state.rollSeed, 133))
      await harness.run(0.05 as DeltaTimeSecs)
      return Effect.runPromise(Effect.all({
        drops: Ref.get(harness.state.mobDrops),
        experience: Ref.get(harness.state.mobExperience),
        seed: Ref.get(harness.state.rollSeed),
      }))
    }

    const first = await run()
    const replay = await run()
    expect(first.drops).toContainEqual(expect.objectContaining({
      source: cowId,
      kind: COW_KIND,
      item: 'beef',
    }))
    expect(first.experience).toStrictEqual([
      expect.objectContaining({ source: cowId, kind: COW_KIND, amount: 3 }),
    ])
    expect(replay).toStrictEqual(first)
    expect(first.seed).not.toBe(133)
  })

  it('wears equipped armor in the same owner revision as TNT blast damage', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      playerStorage: equippedIronHelmetStorage(),
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-armor-wear'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(makeDeltaTimeSecs(0.05))

    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(harness.tntCommits()).toBe(1)
    expect(storageAfter.revision).toBe(revisionBefore + 1)
    expect(storageAfter.state.equipment.slots.head?.durability?.current).toBeLessThan(
      storageBefore.state.equipment.slots.head?.durability?.current ?? Number.MAX_SAFE_INTEGER,
    )
  })

  it('breaks the final helmet point and applies a TNT blast with z-only knockback', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(63.1), PositionAxis(2)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      playerStorage: nearlyBrokenIronHelmetStorage(),
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-z-knockback'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.05))

    const playerAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    expect(harness.tntCommits()).toBe(1)
    expect(playerAfter.state.pose.feetPosition).toMatchObject({ x: 0, y: 63.1 })
    expect(playerAfter.state.pose.feetPosition.z).toBeGreaterThan(2)
    expect(storageBefore.state.equipment.slots.head?.durability?.current).toBe(1)
    expect(storageAfter.state.equipment.slots.head).toBeNull()
    expect(vitalsAfter.state.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
  })

  it('keeps a player at the blast center and preserves depleted vitals', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(63.1), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      vitals: { ...SPAWN_VITALS, healthPoints: EntityHealthPoints(0) },
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-centered-on-depleted-player'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.05))

    const playerAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
    expect(harness.tntCommits()).toBe(1)
    expect(playerAfter.state).toStrictEqual(playerBefore.state)
    expect(vitalsAfter.state).toStrictEqual(vitalsBefore.state)
    expect(damages).toMatchObject([{
      _tag: 'Explosion',
      damage: { cause: 'explosion' },
    }])
    expect(damages[0]?.damage.amount).toBeGreaterThan(0)
  })

  it('leaves the falling-block queue alone when a TNT blast destroys no blocks', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const bedrock = Option.getOrThrow(blockIdOf('bedrock'))
    const blocks: Array<readonly [ReturnType<typeof blockPosition>, BlockId]> = []
    for (let x = -3; x <= 3; x += 1) {
      for (let y = 61; y <= 67; y += 1) {
        for (let z = -3; z <= 3; z += 1) {
          blocks.push([blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z)), bedrock])
        }
      }
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      blocks,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-no-destroyed-blocks'),
          dimension: INITIAL_DIMENSION,
          center: { x: centre.x, y: centre.y, z: centre.z },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const fallingBefore = await Effect.runPromise(Ref.get(harness.state.fallingBlocks))

    await harness.run(makeDeltaTimeSecs(0.05))

    const current = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const calls = await Effect.runPromise(harness.store.calls)
    expect(harness.tntCommits()).toBe(1)
    expect(current.state.tnts[0]?.state).toStrictEqual({ kind: 'detonated' })
    expect(calls.writes).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.fallingBlocks))).toStrictEqual(fallingBefore)
  })

  it('fails TNT planning at either unsafe block-axis boundary before committing', async () => {
    const assertBoundaryFailure = async (x: number) => {
      const harness = await Effect.runPromise(makeHarness({
        entity: null,
        tnt: {
          tnts: [{
            id: EntityId(`test:tnt-boundary-${x}`),
            dimension: INITIAL_DIMENSION,
            center: { x, y: 64, z: 0 },
            state: { kind: 'primed', remainingFuseSecs: 0 },
          }],
        },
      }))
      const before = await Effect.runPromise(harness.coordinator.snapshot(
        TNT_REPLICATED_OWNER_ID,
        TntServiceSnapshotSchema,
      ))

      const exit = await Effect.runPromiseExit(
        harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
      )

      expect(exit._tag).toBe('Failure')
      expect(harness.commits()).toBe(0)
      expect(harness.tntCommits()).toBe(0)
      expect(await Effect.runPromise(harness.coordinator.snapshot(
        TNT_REPLICATED_OWNER_ID,
        TntServiceSnapshotSchema,
      ))).toStrictEqual(before)
    }
    await Promise.all([
      Number.MAX_SAFE_INTEGER + 10,
      Number.MAX_SAFE_INTEGER,
    ].map(assertBoundaryFailure))
  })

  it('does not include or damage a player in a different dimension during TNT detonation', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      dimension: Schema.decodeUnknownSync(DimensionIdSchema)('nether'),
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-other-dimension'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(makeDeltaTimeSecs(0.05))

    expect(harness.tntCommits()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).state).toStrictEqual(vitalsBefore.state)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('does not damage a mob in another dimension at the same coordinates during TNT detonation', async () => {
    const overworldDimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
    const netherDimension = Schema.decodeUnknownSync(DimensionIdSchema)('nether')
    const overworldMob: MobEntity = {
      ...zombieAt(1, 64),
      id: EntityId('test:overworld-mob'),
      healthPoints: EntityHealthPoints(100),
      dimension: overworldDimension,
    }
    const netherMob: MobEntity = {
      ...zombieAt(1, 64),
      id: EntityId('test:nether-mob'),
      healthPoints: EntityHealthPoints(100),
      dimension: netherDimension,
    }
    const harness = await Effect.runPromise(makeHarness({
      entities: [overworldMob, netherMob],
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(20), PositionAxis(64), PositionAxis(0)),
      },
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-dimension-filter'),
          dimension: overworldDimension,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))

    await harness.run(makeDeltaTimeSecs(0.05))

    const final = await Effect.runPromise(strictRoster(harness.coordinator))
    const sameDimensionMob = final.state.entities.find(({ id }) => id === overworldMob.id)
    const otherDimensionMob = final.state.entities.find(({ id }) => id === netherMob.id)
    expect(sameDimensionMob?.healthPoints).toBeLessThan(EntityHealthPoints(100))
    expect(otherDimensionMob?.healthPoints).toBe(EntityHealthPoints(100))
    expect(otherDimensionMob?.dimension).toBe(netherDimension)
  })

  it('keeps a schema-valid blast-immune block intact during TNT detonation', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const bedrock = Option.getOrThrow(blockIdOf('bedrock'))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      block: { position: centre, id: bedrock },
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-bedrock'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))

    await harness.run(makeDeltaTimeSecs(0.05))

    expect(harness.tntCommits()).toBe(1)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(bedrock)
  })

  it('fails TNT detonation before planning when the owner snapshots have different revisions', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-revision-mismatch'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_PLAYER_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(tntBefore)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('uses the entity observation revision when that snapshot races another owner transaction', async () => {
    const tntId = EntityId('test:tnt-roster-observation-race')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    let injected = false
    const coordinator: WorldCommitCoordinatorApi = {
      ...harness.coordinator,
      observe: (...args) => Effect.gen(function* () {
        if (!injected) {
          injected = true
          const player = yield* harness.coordinator.snapshot(
            GAMEPLAY_PLAYER_OWNER_ID,
            PlayerServiceSnapshotSchema,
          )
          yield* Effect.orDie(harness.coordinator.commit({
            expectedRevision: player.revision,
            expectedDimensions: [],
            changes: [{
              ownerId: GAMEPLAY_PLAYER_OWNER_ID,
              state: {
                ...player.state,
                pose: {
                  ...player.state.pose,
                  feetPosition: {
                    ...player.state.pose.feetPosition,
                    x: player.state.pose.feetPosition.x + 1,
                  },
                },
              },
            }],
          }))
        }
        return yield* harness.coordinator.observe(...args)
      }),
    }
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, coordinator },
    }

    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(injected).toBe(true)
    expect(harness.commits()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).state).toStrictEqual(tntBefore.state)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))).state.pose.feetPosition.x).toBe(playerBefore.state.pose.feetPosition.x + 1)
  })

  it.each([
    ['player storage', GAMEPLAY_PLAYER_STORAGE_OWNER_ID],
    ['vitals', GAMEPLAY_VITALS_OWNER_ID],
  ] as const)('does not commit TNT when the %s snapshot revision differs', async (_label, ownerId) => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-owner-revision-mismatch'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(ownerId)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).state).toStrictEqual(tntBefore.state)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('uses the observed revision when a valid player transaction races TNT owner observation', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-observation-race'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    let injected = false
    const coordinator: WorldCommitCoordinatorApi = {
      ...harness.coordinator,
      dimensionRevision: (dimension) => Effect.orDie(Effect.gen(function* () {
        const dimensionRevision = yield* harness.coordinator.dimensionRevision(dimension)
        if (!injected) {
          injected = true
          const player = yield* harness.coordinator.snapshot(
            GAMEPLAY_PLAYER_OWNER_ID,
            PlayerServiceSnapshotSchema,
          )
          yield* harness.coordinator.commit({
            expectedRevision: player.revision,
            expectedDimensions: [],
            changes: [{
              ownerId: GAMEPLAY_PLAYER_OWNER_ID,
              state: {
                ...player.state,
                pose: {
                  ...player.state.pose,
                  feetPosition: {
                    ...player.state.pose.feetPosition,
                    x: player.state.pose.feetPosition.x + 1,
                  },
                },
              },
            }],
          })
        }
        return dimensionRevision
      })),
    }
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, coordinator },
    }

    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(injected).toBe(true)
    expect(harness.commits()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))).state.pose.feetPosition.x).toBe(playerBefore.state.pose.feetPosition.x + 1)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).state).toStrictEqual(tntBefore.state)
  })

  it('records TNT as unsupported when its blast affects a player without a registered vitals owner', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-missing-vitals-owner'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const { vitalsOwnerId: _omittedVitalsOwner, ...commitWithoutVitalsOwner } = harness.context.commit!
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutVitalsOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(tntBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('commits blast loot without XP when TNT has no player ignition credit', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const tntId = EntityId('test:tnt-with-loot')
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const unknownMob = {
      ...zombieAt(1, 64),
      id: EntityId('test:tnt-unknown-mob'),
      kind: EntityKind('unregistered'),
      healthPoints: EntityHealthPoints(1),
    }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(2), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [zombie, unknownMob],
      playerPose,
      block: { position: centre, id: STONE },
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))

    await harness.run(0.02 as DeltaTimeSecs)

    const entities = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedItems = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
    )
    const player = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const outputs = await Effect.runPromise(Effect.all({
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      unsupported: Ref.get(harness.state.unsupportedOperations),
    }))

    expect(harness.tntCommits()).toBe(1)
    expect(entities.state.entities).toStrictEqual([])
    expect(droppedItems.state.items).toHaveLength(1)
    expect(droppedItems.state.items[0]?.behaviour).toMatchObject({
      _tag: 'DroppedItem',
      item: 'rotten_flesh',
      count: 1,
    })
    expect(player.state.pose.feetPosition.x).not.toBe(playerPose.feetPosition.x)
    expect(outputs.drops).toMatchObject([{ item: 'rotten_flesh', count: 1 }])
    expect(outputs.experience).toStrictEqual([])
    expect(outputs.unsupported).toContainEqual({
      _tag: 'Unsupported',
      action: 'MobExperience',
      reason: 'UnknownMobKind',
      mobKind: 'unregistered',
    })
  })

  it('awards XP only for TNT with player ignition provenance and consumes that provenance', async () => {
    const tntId = EntityId('test:player-triggered-tnt')
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombie,
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(20), PositionAxis(64), PositionAxis(0)),
      },
      tntSources: {
        sources: [{ tntId, killCredit: 'player-triggered-tnt' }],
      },
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))

    await harness.run(makeDeltaTimeSecs(0.05))

    const outputs = await Effect.runPromise(Ref.get(harness.state.mobExperience))
    const sources = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_TNT_SOURCES_OWNER_ID,
      GameplayTntSourcesSnapshotSchema,
    ))
    expect(outputs).toMatchObject([{ source: zombie.id, amount: 5 }])
    expect(sources.state.sources).toStrictEqual([])
    expect(harness.tntCommits()).toBe(1)
  })

  it('keeps TNT casualty loot unsupported when the dropped-item owner is absent', async () => {
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(20), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombie,
      playerPose,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-with-unregistered-loot-owner'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const { droppedItemsOwnerId: _omittedOwner, ...commitWithoutDroppedOwner } = harness.context.commit!
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutDroppedOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.02)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).not.toContain(
      TNT_REPLICATED_OWNER_ID,
    )
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).state).toStrictEqual(tntBefore.state)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('does not commit TNT loot when the dropped-item owner snapshot revision differs', async () => {
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(2), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombie,
      playerPose,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-dropped-owner-revision-mismatch'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const outputsBefore = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
    }))
    harness.mismatchNextSnapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.02)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(tntBefore)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
    }))).toStrictEqual(outputsBefore)
  })

  it('advances a live TNT fuse with the service-owned single commit', async () => {
    const tntId = EntityId('test:tnt')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 1 },
        }],
      },
    }))
    const before = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(0.1 as DeltaTimeSecs)

    const after = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const decoded = Schema.decodeUnknownSync(TntServiceSnapshotSchema)(after.state)
    expect(harness.commits()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(after.revision).toBe(revisionBefore + 1)
    expect(decoded.tnts[0]?.state).toStrictEqual({ kind: 'primed', remainingFuseSecs: 0.9 })
    expect(Schema.decodeUnknownSync(TntServiceSnapshotSchema)(before.state).tnts[0]?.state.kind).toBe('primed')
  })

  it('does not report a missing TNT service when its registered owner has no primed record', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      provideTntService: false,
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.05))

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(before)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
    expect(harness.commits()).toBe(0)
  })

  it('reports an unregistered TNT service owner as unsupported', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const tntService = await Effect.runPromise(makeTntService(
      makeReplicatedOwnerId('test:unregistered-tnt-service-owner'),
    ).pipe(Effect.provideService(WorldCommitCoordinator, harness.coordinator)))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, tntService },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('propagates a schema mismatch when the registered TNT owner id names another owner', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, provideTntService: false }))
    const { tntService: _tntService, ...commitWithoutService } = harness.context.commit!
    void _tntService
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...commitWithoutService,
        tntOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
      },
    }

    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
  })

  it('propagates a schema mismatch from a TNT service bound to another registered owner', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const tntService = await Effect.runPromise(makeTntService(
      GAMEPLAY_ENTITIES_OWNER_ID,
    ).pipe(Effect.provideService(WorldCommitCoordinator, harness.coordinator)))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, tntService },
    }

    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
  })

  it('skips a primed TNT record already advanced by another owner transaction', async () => {
    const tntId = EntityId('test:tnt-raced-detonation')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    const tntService = harness.context.commit!.tntService!
    let snapshotReads = 0
    const interleavedService = {
      ...tntService,
      snapshot: Effect.suspend(() => Effect.gen(function* () {
        const snapshot = yield* tntService.snapshot
        snapshotReads += 1
        if (snapshotReads === 1) {
          const state: TntServiceSnapshot = {
            tnts: snapshot.state.tnts.map((record) => record.id === tntId
              ? { ...record, state: { kind: 'detonated' as const } }
              : record),
          }
          yield* harness.coordinator.commit({
            expectedRevision: snapshot.revision,
            expectedDimensions: [],
            changes: [{ ownerId: TNT_REPLICATED_OWNER_ID, state }],
          })
        }
        return snapshot
      })),
    }
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, tntService: interleavedService },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.02)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    const current = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    expect(snapshotReads).toBe(2)
    expect(current.state.tnts[0]?.state).toStrictEqual({ kind: 'detonated' })
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      TNT_REPLICATED_OWNER_ID,
    ])
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
  })

  it('reports the missing TNT service when the registered TNT owner has a primed record', async () => {
    const tntId = EntityId('test:tnt')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      provideTntService: false,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 1 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )

    await harness.run(0.1 as DeltaTimeSecs)

    const tntAfter = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const unsupported = await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))

    expect(unsupported).toContainEqual(expect.objectContaining({
      action: 'MobSimulation',
      reason: 'TntServiceUnavailable',
    }))
    expect(tntAfter).toStrictEqual(tntBefore)
    expect(harness.commits()).toBe(0)
  })

  it('records an unavailable TNT owner when the host supplies an unknown owner id', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, provideTntService: false }))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        tntOwnerId: makeReplicatedOwnerId('test:unknown-tnt-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.1)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('reports a missing TNT owner id before advancing a registered primed TNT', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-without-owner-id'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 1 },
        }],
      },
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const { tntOwnerId: omittedTntOwner, ...commitWithoutTntOwner } = harness.context.commit!
    void omittedTntOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutTntOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.1)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(before)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('requires the TNT provenance owner before planning a due detonation', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-without-provenance-owner'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const { tntSourcesOwnerId: omittedTntSourcesOwner, ...commitWithoutTntSourcesOwner } =
      harness.context.commit!
    void omittedTntSourcesOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutTntSourcesOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(before)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('does not plan TNT detonation without a registered entity roster owner', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-without-roster-owner'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const { entitiesOwnerId: omittedEntitiesOwner, ...commitWithoutEntitiesOwner } = harness.context.commit!
    void omittedEntitiesOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutEntitiesOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(before)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'EntityRosterOwnerUnavailable' }),
    )
  })

  it('keeps owners, blocks, revision, and output queues unchanged when TNT commit fails', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const tntId = EntityId('test:tnt')
    const harness = await Effect.runPromise(makeHarness({
      entity: creeperAt(0, 64),
      block: { position: centre, id: STONE },
      rejectTntSnapshotCommit: true,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const entityBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const playerBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const storageBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
    )
    const vitalsBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
    )
    const droppedBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
    )
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const outputsBefore = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      fallingBlocks: Ref.get(harness.state.fallingBlocks),
      unsupported: Ref.get(harness.state.unsupportedOperations),
    }))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(0.02 as DeltaTimeSecs).pipe(Effect.provide(FrameServicesLayer)),
    )

    const tntAfter = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const entityAfter = await Effect.runPromise(strictRoster(harness.coordinator))
    const playerAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const storageAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
    )
    const vitalsAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
    )
    const droppedAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
    )
    const revisionAfter = await Effect.runPromise(harness.coordinator.revision)
    const outputsAfter = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      fallingBlocks: Ref.get(harness.state.fallingBlocks),
      unsupported: Ref.get(harness.state.unsupportedOperations),
    }))

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(0)
    expect(harness.tntCommits()).toBe(1)
    expect(harness.tntSnapshotCommits()).toBe(1)
    expect(tntAfter).toStrictEqual(tntBefore)
    expect(entityAfter).toStrictEqual(entityBefore)
    expect(playerAfter).toStrictEqual(playerBefore)
    expect(storageAfter).toStrictEqual(storageBefore)
    expect(vitalsAfter).toStrictEqual(vitalsBefore)
    expect(droppedAfter).toStrictEqual(droppedBefore)
    expect(revisionAfter).toBe(revisionBefore)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(outputsAfter).toStrictEqual(outputsBefore)
  })

  it('commits registered dropped-item pickup owners once and publishes its event afterward', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item'),
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(3),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 1,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const beforeStorage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const beforeDropped = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))

    await harness.run(0 as DeltaTimeSecs)

    const afterStorage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const afterDropped = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const executions = await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))

    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    ])
    expect(harness.lastRequest()?.blockWrite).toBeUndefined()
    expect(afterStorage.revision).toBe(beforeStorage.revision + 1)
    expect(afterDropped.revision).toBe(beforeDropped.revision + 1)
    expect(afterStorage.state.inventory.slots.some(
      (slot) => slot?.item === 'gunpowder' && slot.count === 3,
    )).toBe(true)
    expect(afterDropped.state.items).toStrictEqual([])
    expect(executions).toHaveLength(1)
    expect(executions[0]?.outcome).toMatchObject({
      _tag: 'Completed',
      result: [{
        event: {
          _tag: 'ItemPickedUp',
          source: { _tag: 'DroppedItem', id: droppedItem.id },
          count: 3,
        },
      }],
    })
  })

  it('records an unknown registered dropped-item snapshot as a typed failure without committing', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item-missing-owner'),
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(2),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 10,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        droppedItemsOwnerId: makeReplicatedOwnerId('test:unknown-dropped-items-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Failed', error: { _tag: 'ReplicatedOwnerUnknown' } } },
    ])
  })

  it('keeps dropped-item pickup typed when its host owner is not registered', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const request = {
      actor: EntityId('test:player'),
      tick: 1,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const { droppedItemsOwnerId: omittedOwner, ...commitWithoutDroppedOwner } = harness.context.commit!
    void omittedOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutDroppedOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' } },
    ])
  })

  it('keeps queued pickup and XP requests typed when the host has no commit coordinator', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const pickupRequest = {
      actor: EntityId('test:player'),
      tick: 11,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const absorptionRequest = {
      actor: EntityId('test:player'),
      orb: EntityId('test:xp-orb-without-coordinator'),
      tick: 12,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, pickupRequest))
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, absorptionRequest))
    const context: GameplayStageContext = { ...harness.context, commit: undefined }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request: pickupRequest, outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' } },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request: absorptionRequest, outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' } },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
  })

  it('completes a registered dropped-item pickup with no nearby eligible item without committing', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item-out-of-range'),
      feetPosition: position(PositionAxis(10), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(2),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 4,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Completed', result: [] } },
    ])
  })

  it('requeues the complete dropped-item pickup after commit rejection without changing owners or output', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item-retry'),
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(2),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      rejectCommit: true,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 2,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(0 as DeltaTimeSecs)

    const storageAfterFailure = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedAfterFailure = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    expect(harness.commits()).toBe(1)
    expect(storageAfterFailure).toStrictEqual(storageBefore)
    expect(droppedAfterFailure).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toHaveLength(1)
    expect((await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups)))[0]).toBe(request)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toStrictEqual([])

    harness.rejectCommits(false)
    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(2)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Completed' } },
    ])
  })

  it('requeues dropped-item pickup after a valid snapshot revision mismatch', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item-revision-mismatch'),
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(2),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 8,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID)

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toStrictEqual([])
  })

  it('commits registered XP-orb absorption once and requeues after an atomic rejection', async () => {
    const orbId = EntityId('test:xp-orb')
    const orbValue = Result.getOrThrow(createExperienceOrbValue(5))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      rejectCommit: true,
      experienceOrbs: { orbs: [{ id: orbId, value: orbValue }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 3,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(1)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).toStrictEqual(orbsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toStrictEqual([])

    harness.rejectCommits(false)
    await harness.run(0 as DeltaTimeSecs)

    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const executions = await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))
    expect(harness.commits()).toBe(2)
    expect(vitalsAfter.state.vitals.totalExperience).toBe(5)
    expect(orbsAfter.state.orbs).toStrictEqual([])
    expect(vitalsAfter.revision).toBe(revisionBefore + 1)
    expect(orbsAfter.revision).toBe(revisionBefore + 1)
    expect(executions).toMatchObject([{
      request,
      outcome: {
        _tag: 'Completed',
        result: [{ _tag: 'ExperienceCollected', amount: 5, orb: orbId }],
      },
    }])
  })

  it('requeues XP-orb absorption after a valid snapshot revision mismatch', async () => {
    const orbId = EntityId('test:xp-orb-revision-mismatch')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: Result.getOrThrow(createExperienceOrbValue(4)) }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 9,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID)

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).toStrictEqual(orbsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toStrictEqual([])
  })

  it('keeps XP-orb absorption typed when its owner is not registered', async () => {
    const orbId = EntityId('test:xp-orb-unregistered')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: Result.getOrThrow(createExperienceOrbValue(3)) }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 5,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const { experienceOrbsOwnerId: _omittedOwner, ...commitWithoutOrbOwner } = harness.context.commit!
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutOrbOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' } },
    ])
  })

  it('records an unknown registered-orb snapshot as a typed failure without consuming the request', async () => {
    const orbId = EntityId('test:xp-orb-missing-owner')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: Result.getOrThrow(createExperienceOrbValue(3)) }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 6,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        experienceOrbsOwnerId: makeReplicatedOwnerId('test:unknown-experience-orbs-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Failed', error: { _tag: 'ReplicatedOwnerUnknown' } } },
    ])
  })

  it('reports a requested XP orb missing from the registered owner without committing', async () => {
    const orbId = EntityId('test:xp-orb-not-in-owner')
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 7,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).toStrictEqual(orbsBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Failed', error: { _tag: 'ExperienceOrbUnavailable', reason: 'missing-orb', orb: orbId } } },
    ])
  })
})
