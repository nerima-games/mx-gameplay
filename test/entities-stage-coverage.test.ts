import { Effect, Ref, Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  DeltaTimeSecs,
  EntityHealthPoints,
  EntitySerial,
  PositionAxis,
  StackCount,
  WorldIdSchema,
  position,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  PlayerStorageSnapshotSchema,
  makeTimeService,
  makeWorldCommitCoordinator,
  type Entity,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
} from '@nerima-games/mc-sim'
import {
  createExperienceOrbValue,
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
} from '../src/domain/entities/xp-orb.js'
import {
  DroppedItemOwnerSnapshotSchema,
  type DroppedItemOwnerSnapshot,
} from '../src/domain/entities/dropped-item.js'
import { CREEPER_KIND, type MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { INITIAL_PLAYER_POSE } from '../src/domain/in-memory-player.js'
import {
  drainGameplayUnsupportedOperations,
  makeGameplayFrameState,
  requestDroppedItemPickup,
  requestExperienceOrbAbsorption,
  type GameplayStageContext,
} from '../src/stages/registration-core.js'
import {
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'
import { makeEntitiesStage } from '../src/stages/entities-stage.js'
import { FrameServicesLayer } from './support/frame-services.js'
import { makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { world } from './support/chunk-store-double.js'
import { makeEntityManagerDouble } from './support/entity-manager-double.js'

const worldId = Schema.decodeUnknownSync(WorldIdSchema)('entities-stage-coverage')

const makeCreeper = (): Entity<MobBehaviour> => ({
  id: EntityId('test:creeper'),
  kind: CREEPER_KIND,
  feetPosition: position(PositionAxis(3), PositionAxis(0), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: { _tag: 'Dormant' },
})

const makeHarness = (options: Readonly<{
  readonly entity?: Entity<MobBehaviour> | null
  readonly droppedItems?: DroppedItemOwnerSnapshot
  readonly orb?: Readonly<{ id: ReturnType<typeof EntityId>; amount: number }>
  readonly withoutCoordinator?: boolean
  readonly withoutEntitiesOwner?: boolean
}> = {}) => Effect.gen(function* () {
  const entities = options.entity === null ? [] : [options.entity ?? makeCreeper()]
  const store = yield* makeTransactionalChunkStoreDouble(world([]), ['0,0'])
  const coordinatorBase = yield* makeWorldCommitCoordinator({
    world: worldId,
    owners: gameplayOwnerRegistrations({
      playerPose: INITIAL_PLAYER_POSE,
      entities: { entities, nextSerial: EntitySerial(entities.length) },
      ...(options.droppedItems === undefined ? {} : { droppedItems: options.droppedItems }),
      ...(options.orb === undefined
        ? {}
        : { experienceOrbs: { orbs: [{ id: options.orb.id, value: Result.getOrThrow(createExperienceOrbValue(options.orb.amount)) }] } }),
    }),
    chunkStores: { forDimension: () => store.api },
  })
  const requests: WorldCommitRequest[] = []
  const coordinator: WorldCommitCoordinatorApi = {
    ...coordinatorBase,
    commit: (request) => {
      requests.push(request)
      return coordinatorBase.commit(request)
    },
  }
  const state = yield* makeGameplayFrameState
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const time = yield* makeTimeService()
  const commit: GameplayStageContext['commit'] = options.withoutCoordinator === true
    ? undefined
    : {
        coordinator,
        playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
        playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
        experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
        ...(options.withoutEntitiesOwner === true ? {} : { entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID }),
      }
  const context: GameplayStageContext = {
    state,
    store: store.api,
    roster: roster.api,
    time,
    vehicleService: undefined,
    vehicleEnvironment: undefined,
    options: {},
    commit,
  }
  return {
    state,
    context,
    coordinator,
    requests,
    run: (dt: number = 0) => Effect.runPromise(
      makeEntitiesStage(context).run(DeltaTimeSecs(dt)).pipe(Effect.provide(FrameServicesLayer)),
    ),
  }
})

describe('entities-stage owner-backed coverage', () => {
  it('reports queued pickups and orb absorption as unavailable when the host has no coordinator', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, withoutCoordinator: true }))
    const itemRequest = {
      actor: EntityId('test:player'),
      tick: 1,
      position: position(PositionAxis(0), PositionAxis(0), PositionAxis(0)),
    }
    const orbRequest = {
      actor: EntityId('test:player'),
      orb: EntityId('test:orphaned-orb'),
      tick: 2,
      position: { dimension: 'overworld' as const, x: 0, y: 0, z: 0 },
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, itemRequest))
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, orbRequest))

    await harness.run()

    expect(harness.requests).toHaveLength(0)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request: itemRequest, outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' } },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request: orbRequest, outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' } },
    ])
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual({
      _tag: 'Unsupported',
      action: 'MobSimulation',
      reason: 'WorldCommitCoordinatorUnavailable',
    })
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
  })

  it('commits a registered dropped-item pickup and XP absorption in one request per operation', async () => {
    const droppedItemId = EntityId('test:dropped-item')
    const orbId = EntityId('test:xp-orb')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: {
        items: [{
          id: droppedItemId,
          feetPosition: position(PositionAxis(0), PositionAxis(0), PositionAxis(0)),
          behaviour: { _tag: 'DroppedItem', item: 'gunpowder', count: StackCount(3), durability: null },
        }],
      },
      orb: { id: orbId, amount: 5 },
    }))
    const itemRequest = {
      actor: EntityId('test:player'),
      tick: 1,
      position: position(PositionAxis(0), PositionAxis(0), PositionAxis(0)),
    }
    const orbRequest = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 2,
      position: { dimension: 'overworld' as const, x: 0, y: 0, z: 0 },
    }
    const initialRevision = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(requestDroppedItemPickup(harness.state, itemRequest))
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, orbRequest))

    await harness.run()

    expect(harness.requests.map(({ changes, blockWrite }) => ({
      owners: changes.map(({ ownerId }) => ownerId),
      blockWrite,
    }))).toStrictEqual([
      {
        owners: [GAMEPLAY_PLAYER_STORAGE_OWNER_ID, GAMEPLAY_DROPPED_ITEMS_OWNER_ID],
        blockWrite: undefined,
      },
      {
        owners: [GAMEPLAY_VITALS_OWNER_ID, GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID],
        blockWrite: undefined,
      },
    ])
    expect(harness.requests).toHaveLength(2)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toMatchObject({ state: { inventory: { slots: expect.arrayContaining([
      expect.objectContaining({ item: 'gunpowder', count: 3 }),
    ]) } } })
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).state.items).toStrictEqual([])
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).state.vitals.totalExperience).toBe(5)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).state.orbs).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(initialRevision + 2)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { outcome: { _tag: 'Completed', result: [{ event: {
        _tag: 'ItemPickedUp',
        source: { _tag: 'DroppedItem', id: droppedItemId },
        count: 3,
      } }] } },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { outcome: { _tag: 'Completed', result: [{ _tag: 'ExperienceCollected', amount: 5, orb: orbId }] } },
    ])
  })

  it('keeps mob simulation closed without its roster owner and opens it with the registered owner', async () => {
    const entity = makeCreeper()
    const missing = await Effect.runPromise(makeHarness({ entity, withoutEntitiesOwner: true }))
    await missing.run()
    expect(missing.requests).toHaveLength(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(missing.state))).toContainEqual({
      _tag: 'Unsupported',
      action: 'MobSimulation',
      reason: 'EntityRosterOwnerUnavailable',
    })

    const registered = await Effect.runPromise(makeHarness({ entity }))
    const before = await Effect.runPromise(registered.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))
    await registered.run()
    const after = await Effect.runPromise(registered.coordinator.snapshot(
      GAMEPLAY_ENTITIES_OWNER_ID,
      GameplayEntityRosterSchema,
    ))

    expect(registered.requests).toHaveLength(1)
    expect(registered.requests[0]?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_ENTITIES_OWNER_ID,
    ])
    expect(after.revision).toBe(before.revision + 1)
    expect(after.state.entities[0]?.behaviour).toMatchObject({ _tag: 'Lit', burnedSecs: 0 })
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(registered.state))).toStrictEqual([])
  })
})
