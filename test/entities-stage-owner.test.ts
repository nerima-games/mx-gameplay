import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { Effect, Ref, Result, Schema } from 'effect'
import {
  BlockAxis,
  EntityHealthPoints,
  EntitySerial,
  PositionAxis,
  StackCount,
  WorldIdSchema,
  blockPosition,
  position,
  type DeltaTimeSecs,
  type BlockId,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  makeEntityManager,
  makeReplicatedOwnerId,
  makeTntService,
  makeTimeService,
  makeWorldCommitCoordinator,
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  TntServiceSnapshotSchema,
  TNT_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  WorldRevisionConflict,
  type Entity,
  type PlayerPose,
  type PlayerStorage,
  type TntServiceSnapshot,
  type Vitals,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
} from '@nerima-games/mc-sim'
import { makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { STONE, world } from './support/chunk-store-double.js'
import {
  drainGameplayUnsupportedOperations,
  makeGameplayFrameState,
  requestDroppedItemPickup,
  requestExperienceOrbAbsorption,
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
import { CREEPER_KIND, hostileMobSnapshot, type MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat.js'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GameplayEntityRosterSchema,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'
import type { GameplayStageContext } from '../src/stages/registration-core.js'
import { FrameServicesLayer } from './support/frame-services.js'

const worldId = Schema.decodeUnknownSync(WorldIdSchema)('entities-stage-owner-tests')

const creeperAt = (x: number, y = 0): Entity<MobBehaviour> => ({
  id: EntityId('test:creeper'),
  kind: CREEPER_KIND,
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: { _tag: 'Dormant' as const },
})

const zombieAt = (x: number, y: number): Entity<MobBehaviour> => ({
  id: EntityId('test:zombie'),
  kind: ZOMBIE_KIND,
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: hostileMobSnapshot(undefined),
})

const makeHarness = (options: Readonly<{
  readonly entity?: Entity<MobBehaviour> | null
  readonly block?: Readonly<{ position: ReturnType<typeof blockPosition>; id: BlockId }>
  readonly rejectCommit?: boolean
  readonly rejectTntSnapshotCommit?: boolean
  readonly provideTntService?: boolean
  readonly playerPose?: PlayerPose
  readonly playerStorage?: PlayerStorage
  readonly droppedItems?: DroppedItemOwnerSnapshot
  readonly vitals?: Vitals
  readonly experienceOrbs?: ExperienceOrbOwnerSnapshot
  readonly tnt?: TntServiceSnapshot
}> = {}) => Effect.gen(function* () {
  const entities = options.entity === null ? [] : [options.entity ?? creeperAt(3)]
  const playerPose = options.playerPose ?? (entities[0]?.feetPosition.y === 64
    ? { ...INITIAL_PLAYER_POSE, feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)) }
    : INITIAL_PLAYER_POSE)
  const entries = options.block === undefined ? [] : [[options.block.position, options.block.id] as const]
  const store = yield* makeTransactionalChunkStoreDouble(world(entries), ['0,0'])
  const baseCoordinator = yield* makeWorldCommitCoordinator({
    world: worldId,
    owners: gameplayOwnerRegistrations({
      playerPose,
      ...(options.playerStorage === undefined ? {} : { playerStorage: options.playerStorage }),
      ...(options.droppedItems === undefined ? {} : { droppedItems: options.droppedItems }),
      ...(options.vitals === undefined ? {} : { vitals: options.vitals }),
      ...(options.experienceOrbs === undefined ? {} : { experienceOrbs: options.experienceOrbs }),
      entities: { entities, nextSerial: EntitySerial(entities.length) },
      ...(options.tnt === undefined ? {} : { tnt: options.tnt }),
    }),
    chunkStores: { forDimension: () => store.api },
  })
  let commits = 0
  let rejectCommits = options.rejectCommit === true
  let tntCommits = 0
  let tntSnapshotCommits = 0
  let lastRequest: WorldCommitRequest | undefined
  const coordinator: WorldCommitCoordinatorApi = {
    ...baseCoordinator,
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
  const context: GameplayStageContext = {
    state,
    store: store.api,
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
      tntOwnerId: TNT_REPLICATED_OWNER_ID,
      ...(options.provideTntService === false ? {} : { tntService }),
    },
  }
  return {
    context,
    state,
    store,
    coordinator,
    stage: makeEntitiesStage(context),
    commits: () => commits,
    rejectCommits: (reject: boolean) => { rejectCommits = reject },
    tntCommits: () => tntCommits,
    tntSnapshotCommits: () => tntSnapshotCommits,
    lastRequest: () => lastRequest,
    run: (dt: DeltaTimeSecs) =>
      Effect.runPromise(makeEntitiesStage(context).run(dt).pipe(Effect.provide(FrameServicesLayer))),
  }
})

const strictRoster = (coordinator: WorldCommitCoordinatorApi) =>
  coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)

describe('entities stage owner-backed MobSimulation', () => {
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
    expect(decodedRoster.entities[0]?.behaviour).toMatchObject({ ageTicks: 5 })
    expect(decodedVitals.vitals.healthPoints).toBeLessThan(beforeVitals.state.vitals.healthPoints)
    expect(damages).toMatchObject([{
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      damage: { amount: 3, cause: 'mob' },
    }])
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
      spawnClock: Ref.get(harness.state.spawnClockSecs),
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
      spawnClock: Ref.get(harness.state.spawnClockSecs),
    }))).toStrictEqual(localBefore)
  })

  it('pins the fuse ignition threshold at 3 blocks, including the just-outside case', async () => {
    const boundary = await Effect.runPromise(makeHarness({ entity: creeperAt(3) }))
    await boundary.run(0 as DeltaTimeSecs)
    const lit = await Effect.runPromise(strictRoster(boundary.coordinator))
    expect(lit.state.entities[0]?.behaviour).toMatchObject({ _tag: 'Lit', burnedSecs: 0 })
    expect(boundary.commits()).toBe(1)

    const outside = await Effect.runPromise(makeHarness({ entity: creeperAt(3.0001) }))
    const before = await Effect.runPromise(strictRoster(outside.coordinator))
    await outside.run(0 as DeltaTimeSecs)
    const after = await Effect.runPromise(strictRoster(outside.coordinator))
    expect(after.state).toStrictEqual(before.state)
    expect(outside.commits()).toBe(0)
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

  it('commits blast knockback, experience, and generated loot for a slain hostile mob', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const tntId = EntityId('test:tnt-with-loot')
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(2), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombie,
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
    expect(outputs.experience).toMatchObject([{ amount: 5, source: zombie.id }])
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
