import { describe, expect, it } from '@effect/vitest'
import {
  DeltaTimeSecs,
  EntityHealthPoints,
  EntitySerial,
  PositionAxis,
  SimulationTickSchema,
  WorldRevisionSchema,
  AIR_BLOCK_ID,
  StackCount,
  enchantmentsComponent,
  itemComponents,
  position,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  DamageAmount,
  EntityId,
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  TNT_REPLICATED_OWNER_ID,
  TntServiceSnapshotSchema,
  TimeService,
  WorldCommitCoordinator,
  makeReplicatedOwnerId,
  type ReplicatedOwnerUnknown,
  type ReplicatedSnapshot,
  durability,
  emptyPlayerStorage,
  equipmentItem,
  itemStack,
  makeTimeService,
  withInventory,
  type DomainEventBusApi,
  type ReplicatedOwnerId,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { ChunkStore } from '@nerima-games/mc-worldgen'
import { Effect, Layer, Ref, Result, Schema, Stream } from 'effect'
import {
  drawRolls,
  rollAt,
} from '../src/domain/frame-rolls.js'
import { SPAWN_SEARCH_ROLLS } from '../src/domain/entities/mob-spawn-search.js'
import {
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
} from '../src/domain/entities/xp-orb.js'
import { DroppedItemOwnerSnapshotSchema } from '../src/domain/entities/dropped-item.js'
import {
  CREEPER_KIND,
  hostileMobSnapshot,
} from '../src/domain/entities/mob-frame.js'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat.js'
import { MOB_DROP_TABLES } from '../src/domain/mob/mob-drop.js'
import { type MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { SkyLightLevel } from '../src/domain/mob/hostile-spawn.js'
import {
  applyStatusEffect,
  emptyStatusEffectState,
  StatusEffectStateSchema,
  type StatusEffectState,
} from '../src/domain/status-effect.js'
import { makeGameplayStagesWithState } from '../src/stages/gameplay-stage-composition.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../src/stages/gameplay-owner-registrations.js'
import {
  makeGameplayFrameStateForOwner,
  drainDroppedItemPickupExecutions,
  drainExperienceOrbAbsorptionExecutions,
  drainGameplayStageFailures,
  requestDroppedItemPickup,
  requestMobSpawn,
  requestExperienceOrbAbsorption,
  gameplayStages,
} from '../src/stages/registration.js'
import { drainGameplayUnsupportedOperations, entityManagerTag, type GameplayStageCommitServices } from '../src/stages/registration-core.js'
import { emptyWorldStoreLayer, STONE, world } from './support/chunk-store-double.js'
import { emptyRosterLayer } from './support/entity-manager-double.js'
import { emptyInventoryLayer } from './support/inventory-service-double.js'
import {
  gameplayCommitServicesLayer,
  makeTransactionalChunkStoreDouble,
} from './support/transactional-stage-doubles.js'
import { runFrame } from './support/frame-runner.js'

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

const productionWorldWithStore = (storeLayer: Layer.Layer<ChunkStore>) => Layer.provideMerge(
  gameplayCommitServicesLayer,
  Layer.mergeAll(
    storeLayer,
    emptyRosterLayer,
    Layer.effect(TimeService, makeTimeService()),
    emptyInventoryLayer,
    Layer.succeed(DomainEventBus, eventBus),
  ),
)

const productionTntWorld = productionWorldWithStore(Layer.effect(
  ChunkStore,
  Effect.map(
    makeTransactionalChunkStoreDouble(world([]), ['0,0']),
    (store) => store.api,
  ),
))

const enchantedHelmetStorage = (
  enchantmentId: 'minecraft:unbreaking' | 'minecraft:thorns',
  currentDurability = 100,
) => {
  const enchantments = enchantmentId === 'minecraft:unbreaking'
    ? Result.getOrThrow(enchantmentsComponent({ 'minecraft:unbreaking': 1 }))
    : Result.getOrThrow(enchantmentsComponent({ 'minecraft:thorns': 1 }))
  const components = Result.getOrThrow(itemComponents('iron_helmet', { enchantments }))
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1), { components })),
    Result.getOrThrow(durability(currentDurability, 165)),
  ))
  const storage = emptyPlayerStorage()
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const vanishingCurseStorage = () => {
  const curse = Result.getOrThrow(enchantmentsComponent({ 'minecraft:vanishing_curse': 1 }))
  const components = Result.getOrThrow(itemComponents('iron_helmet', { enchantments: curse }))
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1), { components })),
    Result.getOrThrow(durability(165, 165)),
  ))
  const bread = Result.getOrThrow(itemStack('bread', StackCount(2)))
  const mending = Result.getOrThrow(enchantmentsComponent({ 'minecraft:mending': 1 }))
  const pickaxeComponents = Result.getOrThrow(itemComponents('diamond_pickaxe', { enchantments: mending }))
  const pickaxe = Result.getOrThrow(itemStack('diamond_pickaxe', StackCount(1), { components: pickaxeComponents }))
  const emptyStorage = emptyPlayerStorage()
  const storage = Result.getOrThrow(withInventory(emptyStorage, {
    slots: [bread, pickaxe, ...emptyStorage.inventory.slots.slice(2)],
  }))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const outOfRangeEnchantmentStorage = () => {
  const storage = emptyPlayerStorage()
  const enchantments = Result.getOrThrow(enchantmentsComponent({ 'minecraft:sharpness': 6 }))
  const components = Result.getOrThrow(itemComponents('diamond_sword', { enchantments }))
  const sword = Result.getOrThrow(itemStack('diamond_sword', StackCount(1), { components }))
  return Result.getOrThrow(withInventory(storage, {
    slots: [sword, ...storage.inventory.slots.slice(1)],
  }))
}

const vanishingOnlyStorage = () => {
  const enchantments = Result.getOrThrow(enchantmentsComponent({ 'minecraft:vanishing_curse': 1 }))
  const components = Result.getOrThrow(itemComponents('diamond_pickaxe', { enchantments }))
  const pickaxe = Result.getOrThrow(itemStack('diamond_pickaxe', StackCount(1), { components }))
  const storage = emptyPlayerStorage()
  return Result.getOrThrow(withInventory(storage, {
    slots: [pickaxe, ...storage.inventory.slots.slice(1)],
  }))
}

const zombieRoster = (health: number) => Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
  entities: [{
    id: EntityId('test:thorns-target'),
    kind: ZOMBIE_KIND,
    feetPosition: position(PositionAxis(1), PositionAxis(64), PositionAxis(0)),
    healthPoints: EntityHealthPoints(health),
    behaviour: hostileMobSnapshot(undefined),
    dimension: 'overworld',
  }],
  nextSerial: EntitySerial(1),
})

const makeProductionScenario = (options: Readonly<{
  storage: ReturnType<typeof emptyPlayerStorage>
  statusEffects: StatusEffectState
  zombieHealth: number
  mobRoster?: Schema.Schema.Type<typeof GameplayEntityRosterSchema>
  tnt?: Schema.Schema.Type<typeof TntServiceSnapshotSchema>
}>) => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const storageSnapshot = yield* coordinator.snapshot(
    GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    PlayerStorageSnapshotSchema,
  )
  const playerSnapshot = yield* coordinator.snapshot(
    GAMEPLAY_PLAYER_OWNER_ID,
    PlayerServiceSnapshotSchema,
  )
  const player = Schema.decodeUnknownSync(PlayerServiceSnapshotSchema)({
    ...playerSnapshot.state,
    pose: {
      ...playerSnapshot.state.pose,
      feetPosition: {
        ...playerSnapshot.state.pose.feetPosition,
        ...position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
    },
  })
  const roster = options.mobRoster ?? zombieRoster(options.zombieHealth)
  yield* coordinator.commit({
    expectedRevision: storageSnapshot.revision,
    expectedDimensions: [],
    changes: [
      { ownerId: GAMEPLAY_PLAYER_OWNER_ID, state: player },
      { ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: options.storage },
      { ownerId: GAMEPLAY_ENTITIES_OWNER_ID, state: roster },
      { ownerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID, state: options.statusEffects },
      ...(options.tnt === undefined ? [] : [{ ownerId: TNT_REPLICATED_OWNER_ID, state: options.tnt }]),
    ],
  })
  const stages = yield* makeGameplayStagesWithState(state)
  return { coordinator, stages, state }
})

const withSnapshotRevision = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
): WorldCommitCoordinatorApi => {
  let injected = false
  const snapshot: WorldCommitCoordinatorApi['snapshot'] = <Codec extends Schema.Codec<any, any>>(
    requestedOwnerId: ReplicatedOwnerId,
    schema: Codec,
  ): Effect.Effect<
    ReplicatedSnapshot<Codec>,
    Schema.SchemaError | ReplicatedOwnerUnknown,
    Schema.Codec.DecodingServices<Codec>
  > => Effect.gen(function* () {
    const observed = yield* coordinator.snapshot(requestedOwnerId, schema)
    if (requestedOwnerId !== ownerId || injected) return observed
    injected = true
    const currentRevision = yield* coordinator.revision
    return {
      ...observed,
      revision: Schema.decodeUnknownSync(WorldRevisionSchema)(currentRevision + 1),
    }
  })
  return { ...coordinator, snapshot }
}

const withCommitConflict = (coordinator: WorldCommitCoordinatorApi): WorldCommitCoordinatorApi => {
  let interleaved = false
  const commit: WorldCommitCoordinatorApi['commit'] = (request) => Effect.gen(function* () {
    if (!interleaved && request.changes.some(({ ownerId }) => ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID)) {
      interleaved = true
      const statusEffects = yield* coordinator.snapshot(
        GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
        StatusEffectStateSchema,
      )
      const updated = Result.getOrThrow(applyStatusEffect(statusEffects.state, {
        type: 'speed',
        durationSecs: 1,
      }))
      yield* coordinator.commit({
        expectedRevision: statusEffects.revision,
        expectedDimensions: [],
        changes: [{ ownerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID, state: updated.state }],
      })
    }
    return yield* coordinator.commit(request)
  })
  return { ...coordinator, commit }
}

const withSnapshotFailure = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
): WorldCommitCoordinatorApi => {
  const unavailableOwnerId = makeReplicatedOwnerId('coverage:unavailable-snapshot-owner')
  const snapshot: WorldCommitCoordinatorApi['snapshot'] = <Codec extends Schema.Codec<any, any>>(
    requestedOwnerId: ReplicatedOwnerId,
    schema: Codec,
  ): Effect.Effect<
    ReplicatedSnapshot<Codec>,
    Schema.SchemaError | ReplicatedOwnerUnknown,
    Schema.Codec.DecodingServices<Codec>
  > => coordinator.snapshot(requestedOwnerId === ownerId ? unavailableOwnerId : requestedOwnerId, schema)
  return { ...coordinator, snapshot }
}

const makeDeadPlayerEntityScenario = (
  storage: ReturnType<typeof emptyPlayerStorage>,
  options: Readonly<{
    droppedItemsOwnerId?: ReplicatedOwnerId | null
    wrapCoordinator?: (coordinator: WorldCommitCoordinatorApi) => WorldCommitCoordinatorApi
  }> = {},
) => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const state = yield* makeGameplayFrameStateForOwner({ coordinator, vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID })
  const [storageSnapshot, vitalsSnapshot] = yield* Effect.all([
    coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
    coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
  ])
  yield* coordinator.commit({
    expectedRevision: storageSnapshot.revision,
    expectedDimensions: [],
    changes: [
      { ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: storage },
      { ownerId: GAMEPLAY_VITALS_OWNER_ID, state: {
        vitals: { ...vitalsSnapshot.state.vitals, healthPoints: EntityHealthPoints(0) },
      } },
    ],
  })
  const store = yield* ChunkStore
  const roster = yield* entityManagerTag<MobBehaviour>()
  const time = yield* TimeService
  const commit: GameplayStageCommitServices = {
    coordinator: options.wrapCoordinator?.(coordinator) ?? coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
    ...(options.droppedItemsOwnerId === null
      ? {}
      : { droppedItemsOwnerId: options.droppedItemsOwnerId ?? GAMEPLAY_DROPPED_ITEMS_OWNER_ID }),
  }
  const stages = gameplayStages(
    state,
    store,
    roster,
    undefined,
    undefined,
    time,
    undefined,
    undefined,
    { mobSimulation: false },
    commit,
  )
    .filter(({ id }) => id === GAMEPLAY_STAGE_IDS.entities)
  return { coordinator, state, stages }
})

describe('full-composition enchantment coverage', () => {
  it.effect('drops a dead player inventory through Entities and removes Vanishing Curse gear', () =>
    Effect.gen(function* () {
      const { coordinator, stages } = yield* makeProductionScenario({
        storage: vanishingCurseStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      const vitalsBefore = yield* coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      yield* coordinator.commit({
        expectedRevision: vitalsBefore.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_VITALS_OWNER_ID,
          state: {
            vitals: {
              ...vitalsBefore.state.vitals,
              healthPoints: EntityHealthPoints(1),
            },
          },
        }],
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))
      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [vitalsAfter, storageAfter, droppedItems] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
      ])
      expect(vitalsAfter.state.vitals.healthPoints).toBe(0)
      expect(storageAfter.state).toStrictEqual(emptyPlayerStorage())
      expect(droppedItems.state.items.map(({ behaviour }) => behaviour.item)).toContain('bread')
      expect(droppedItems.state.items.map(({ behaviour }) => behaviour.item)).toContain('diamond_pickaxe')
      expect(droppedItems.state.items.map(({ behaviour }) => behaviour.item)).not.toContain('iron_helmet')
      expect(droppedItems.state.items.filter(({ behaviour }) => behaviour.item === 'bread')).toHaveLength(1)
      expect(droppedItems.state.items.find(({ behaviour }) => behaviour.item === 'diamond_pickaxe')?.behaviour.enchantments)
        .toStrictEqual([{ id: 'mending', level: 1 }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records invalid death-drop enchantment data and preserves the player storage', () =>
    Effect.gen(function* () {
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: outOfRangeEnchantmentStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      const vitalsBefore = yield* coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      yield* coordinator.commit({
        expectedRevision: vitalsBefore.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_VITALS_OWNER_ID,
          state: {
            vitals: {
              ...vitalsBefore.state.vitals,
              healthPoints: EntityHealthPoints(0),
            },
          },
        }],
      })

      yield* runFrame(stages.filter(({ id }) => id === GAMEPLAY_STAGE_IDS.entities), DeltaTimeSecs(0.25))

      const [storage, failures] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayStageFailures(state),
      ])
      expect(storage.state).toStrictEqual(outOfRangeEnchantmentStorage())
      expect(failures).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'Player',
        requestId: 'player-death-drops',
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records a death-drop owner snapshot failure and leaves storage intact', () =>
    Effect.gen(function* () {
      const storage = vanishingCurseStorage()
      const { coordinator, stages, state } = yield* makeDeadPlayerEntityScenario(storage, {
        wrapCoordinator: (current) => withSnapshotFailure(current, GAMEPLAY_VITALS_OWNER_ID),
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [storageAfter, failures] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayStageFailures(state),
      ])
      expect(storageAfter.state).toStrictEqual(storage)
      expect(failures).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        requestId: 'player-death-drops',
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records a death-drop revision conflict when the vitals snapshot is stale', () =>
    Effect.gen(function* () {
      const storage = vanishingCurseStorage()
      const { coordinator, stages, state } = yield* makeDeadPlayerEntityScenario(storage, {
        wrapCoordinator: (current) => withSnapshotRevision(current, GAMEPLAY_VITALS_OWNER_ID),
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [storageAfter, failures] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayStageFailures(state),
      ])
      expect(storageAfter.state).toStrictEqual(storage)
      expect(failures).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        requestId: 'player-death-drops',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records a death-drop revision conflict when the storage snapshot is stale', () =>
    Effect.gen(function* () {
      const storage = vanishingCurseStorage()
      const { coordinator, stages, state } = yield* makeDeadPlayerEntityScenario(storage, {
        wrapCoordinator: (current) => withSnapshotRevision(current, GAMEPLAY_PLAYER_STORAGE_OWNER_ID),
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [storageAfter, failures] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayStageFailures(state),
      ])
      expect(storageAfter.state).toStrictEqual(storage)
      expect(failures).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        requestId: 'player-death-drops',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('clears inventory when Vanishing Curse removes every death drop', () =>
    Effect.gen(function* () {
      const { coordinator, stages, state } = yield* makeDeadPlayerEntityScenario(vanishingOnlyStorage(), {
        droppedItemsOwnerId: null,
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [storageAfter, unsupported] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayUnsupportedOperations(state),
      ])
      expect(storageAfter.state).toStrictEqual(emptyPlayerStorage())
      expect(unsupported).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('keeps storage and records unsupported when death drops have no registered owner', () =>
    Effect.gen(function* () {
      const storage = vanishingCurseStorage()
      const { coordinator, stages, state } = yield* makeDeadPlayerEntityScenario(storage, {
        droppedItemsOwnerId: null,
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [storageAfter, unsupported] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayUnsupportedOperations(state),
      ])
      expect(storageAfter.state).toStrictEqual(storage)
      expect(unsupported).toContainEqual(expect.objectContaining({
        _tag: 'Unsupported',
        action: 'MobSimulation',
        reason: 'OwnerRegistrationUnavailable',
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records a dropped-item owner snapshot failure and keeps storage intact', () =>
    Effect.gen(function* () {
      const storage = vanishingCurseStorage()
      const { coordinator, stages, state } = yield* makeDeadPlayerEntityScenario(storage, {
        droppedItemsOwnerId: makeReplicatedOwnerId('coverage:missing-dropped-owner'),
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [storageAfter, failures] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayStageFailures(state),
      ])
      expect(storageAfter.state).toStrictEqual(storage)
      expect(failures).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'DroppedItem',
        requestId: 'player-death-drops',
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records a dropped-item revision conflict and keeps storage intact', () =>
    Effect.gen(function* () {
      const storage = vanishingCurseStorage()
      const { coordinator, stages, state } = yield* makeDeadPlayerEntityScenario(storage, {
        wrapCoordinator: (current) => withSnapshotRevision(current, GAMEPLAY_DROPPED_ITEMS_OWNER_ID),
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [storageAfter, failures] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayStageFailures(state),
      ])
      expect(storageAfter.state).toStrictEqual(storage)
      expect(failures).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'DroppedItem',
        requestId: 'player-death-drops',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records a death-drop commit conflict and retains player storage', () =>
    Effect.gen(function* () {
      const storage = vanishingCurseStorage()
      const { coordinator, stages, state } = yield* makeDeadPlayerEntityScenario(storage, {
        wrapCoordinator: withCommitConflict,
      })

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [storageAfter, failures, statusEffects] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        drainGameplayStageFailures(state),
        coordinator.snapshot(GAMEPLAY_STATUS_EFFECTS_OWNER_ID, StatusEffectStateSchema),
      ])
      expect(storageAfter.state).toStrictEqual(storage)
      expect(failures).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'WorldCommit',
        subject: 'Player',
        requestId: 'player-death-drops',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
      expect(statusEffects.state.effects).toContainEqual(expect.objectContaining({ type: 'speed' }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('applies mob-contact damage through active Fire Resistance and Unbreaking armor', () =>
    Effect.gen(function* () {
      const status = Result.getOrThrow(applyStatusEffect(emptyStatusEffectState(), {
        type: 'fire_resistance',
        durationSecs: 20,
      })).state
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: enchantedHelmetStorage('minecraft:unbreaking'),
        statusEffects: status,
        zombieHealth: 20,
      })
      const seed = 61
      const armorRollWithoutSpawnSearch = rollAt(drawRolls(seed, 1), 0)
      const armorRollAfterInitialPassiveSearch = rollAt(
        drawRolls(seed, SPAWN_SEARCH_ROLLS + 1),
        SPAWN_SEARCH_ROLLS,
      )
      // Unbreaking I preserves armor on 20% of rolls: 0.4 * 1 / (1 + 1).
      // The frame either performs no search (night) or consumes 65 passive
      // search rolls (day) before this single armor wear roll.
      expect(SPAWN_SEARCH_ROLLS).toBe(65)
      expect(armorRollWithoutSpawnSearch).toBeCloseTo(0.00047740805916367474, 14)
      expect(armorRollAfterInitialPassiveSearch).toBeCloseTo(0.13257778348986887, 14)
      expect(armorRollWithoutSpawnSearch).toBeLessThan(0.2)
      expect(armorRollAfterInitialPassiveSearch).toBeLessThan(0.2)
      yield* Ref.set(state.rollSeed, seed)
      const before = yield* coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [after, storage, damages, modifiers] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        Ref.get(state.playerDamages),
        Ref.get(state.playerStatusEffectModifiers),
      ])
      expect(modifiers.fireResistance).toBe(true)
      expect(damages).toContainEqual(expect.objectContaining({
        _tag: 'HostileContact',
        damage: expect.objectContaining({ cause: 'mob' }),
      }))
      expect(after.state.vitals.healthPoints).toBeLessThan(before.state.vitals.healthPoints)
      expect(storage.state.equipment.slots.head?.durability?.current).toBe(100)
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('applies Resistance V before mob-contact damage reaches player vitals', () =>
    Effect.gen(function* () {
      const resistance = Result.getOrThrow(applyStatusEffect(emptyStatusEffectState(), {
        type: 'resistance',
        durationSecs: 20,
        amplifier: 4,
      })).state
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: enchantedHelmetStorage('minecraft:unbreaking'),
        statusEffects: resistance,
        zombieHealth: 20,
      })
      const before = yield* coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [after, storage, modifiers, cooldowns] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        Ref.get(state.playerStatusEffectModifiers),
        Ref.get(state.hostileContactCooldowns),
      ])
      expect(modifiers.damageTakenMultiplier).toBe(0)
      expect(cooldowns.has(EntityId('test:thorns-target'))).toBe(true)
      expect(after.state.vitals.healthPoints).toBe(before.state.vitals.healthPoints)
      expect(after.state.vitals.lastDamageCause).toBe(before.state.vitals.lastDamageCause)
      expect(storage.state.equipment.slots.head?.durability?.current).toBe(100)
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('suppresses TNT blast damage through Resistance V in the production entity stage', () =>
    Effect.gen(function* () {
      const resistance = Result.getOrThrow(applyStatusEffect(emptyStatusEffectState(), {
        type: 'resistance',
        durationSecs: 20,
        amplifier: 4,
      })).state
      const tnt = Schema.decodeUnknownSync(TntServiceSnapshotSchema)({
        tnts: [{
          id: EntityId('test:resisted-tnt'),
          dimension: 'overworld',
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.05 },
        }],
      })
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: emptyPlayerStorage(),
        statusEffects: resistance,
        zombieHealth: 20,
        tnt,
      })
      const before = yield* coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [after, tntAfter, modifiers, damages] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
        Ref.get(state.playerStatusEffectModifiers),
        Ref.get(state.playerDamages),
      ])
      expect(tntAfter.state.tnts[0]?.state).toStrictEqual({ kind: 'detonated' })
      expect(modifiers.damageTakenMultiplier).toBe(0)
      expect(after.state.vitals.healthPoints).toBe(before.state.vitals.healthPoints)
      expect(damages).toContainEqual(expect.objectContaining({ _tag: 'Explosion' }))
    }).pipe(Effect.provide(Layer.orDie(productionTntWorld))),
  )

  it.effect('faults malformed Thorns drops and continues XP rewards through production stages', () => {
    const table = MOB_DROP_TABLES[ZOMBIE_KIND]
    if (table === undefined) throw new Error('Zombie loot rules must exist.')
    const originalRules = table.rules
    const originalPools = table.pools
    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        if (!Reflect.set(table, 'rules', [{ item: 'rotten_flesh', count: 1000 }])) {
          throw new Error('The test must be able to install malformed loot data.')
        }
        if (!Reflect.set(table, 'pools', [])) {
          throw new Error('The test must be able to clear the zombie loot pools.')
        }
      })
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: enchantedHelmetStorage('minecraft:thorns', 1),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 1,
      })
      const seed = 61
      const thornsRollWithoutSpawnSearch = rollAt(drawRolls(seed, 1), 0)
      const thornsRollAfterInitialPassiveSearch = rollAt(
        drawRolls(seed, SPAWN_SEARCH_ROLLS + 1),
        SPAWN_SEARCH_ROLLS,
      )
      expect(thornsRollWithoutSpawnSearch).toBeLessThan(0.15)
      expect(thornsRollAfterInitialPassiveSearch).toBeLessThan(0.15)
      yield* Ref.set(state.rollSeed, seed)

      yield* runFrame(stages, DeltaTimeSecs(0.25))

      const [faults, roster, storage, droppedItems, orbs] = yield* Effect.all([
        drainGameplayStageFailures(state),
        coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema),
      ])
      expect(faults).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'DroppedItem',
        requestId: 'test:thorns-target',
        error: { _tag: 'InvalidStack' },
      }))
      expect(roster.state.entities).toStrictEqual([])
      expect(storage.state.equipment.slots.head).toBeNull()
      expect(droppedItems.state.items).toStrictEqual([])
      expect(orbs.state.orbs.reduce(
        (total, orb) => total + Number(orb.value) * (orb.count ?? 1),
        0,
      )).toBe(5)
      expect(orbs.state.orbs.every(({ position: orbPosition }) => orbPosition?.dimension === 'overworld')).toBe(true)
      expect(yield* drainGameplayUnsupportedOperations(state)).toContainEqual(expect.objectContaining({
        _tag: 'Unsupported',
        action: 'MobDrop',
        reason: 'UnsupportedDropItemIds',
        mobKind: ZOMBIE_KIND,
      }))
    }).pipe(
      Effect.ensuring(Effect.sync(() => {
        if (originalPools === undefined) Reflect.deleteProperty(table, 'pools')
        else Reflect.set(table, 'pools', originalPools)
        Reflect.set(table, 'rules', originalRules)
      })),
      Effect.provide(Layer.orDie(productionWorld)),
    )
  })

  it.effect('uses Mending on an inventory pickaxe while collecting an XP orb through production stages', () =>
    Effect.gen(function* () {
      const storage = emptyPlayerStorage()
      const components = Result.getOrThrow(itemComponents('iron_pickaxe', {
        enchantments: Result.getOrThrow(enchantmentsComponent({ 'minecraft:mending': 1 })),
      }))
      const pickaxe = Result.getOrThrow(itemStack('iron_pickaxe', StackCount(1), { components }))
      const inventoryDurability = [...storage.inventoryDurability]
      inventoryDurability[0] = Result.getOrThrow(durability(244, 250))
      const unenchantedHelmet = Result.getOrThrow(equipmentItem(
        Result.getOrThrow(itemStack('iron_helmet', StackCount(1))),
        Result.getOrThrow(durability(150, 165)),
      ))
      const mendingStorage = {
        ...storage,
        inventory: {
          ...storage.inventory,
          slots: [pickaxe, ...storage.inventory.slots.slice(1)],
        },
        inventoryDurability,
        equipment: {
          ...storage.equipment,
          slots: { ...storage.equipment.slots, head: unenchantedHelmet },
        },
      }
      const { coordinator, stages } = yield* makeProductionScenario({
        storage: mendingStorage,
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      const orbSnapshot = yield* coordinator.snapshot(
        GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
        ExperienceOrbOwnerSnapshotSchema,
      )
      const orbs = Schema.decodeUnknownSync(ExperienceOrbOwnerSnapshotSchema)({
        orbs: [{
          id: EntityId('test:production-mending-orb'),
          value: 3,
          position: { dimension: 'overworld', x: 1.02, y: 64, z: 0 },
          spawnedAt: 0,
        }],
      })
      yield* coordinator.commit({
        expectedRevision: orbSnapshot.revision,
        expectedDimensions: [],
        changes: [{ ownerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, state: orbs }],
      })

      yield* runFrame(stages, DeltaTimeSecs(0.05))

      const [storageAfter, vitalsAfter, orbsAfter] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema),
      ])
      expect(storageAfter.state.inventoryDurability[0]).toStrictEqual({ current: 250, max: 250 })
      expect(vitalsAfter.state.vitals.totalExperience).toBe(0)
      expect(orbsAfter.state.orbs).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records repeated missing-orb faults and continues to absorb the next orb through production stages', () =>
    Effect.gen(function* () {
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: emptyPlayerStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      const orbSnapshot = yield* coordinator.snapshot(
        GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
        ExperienceOrbOwnerSnapshotSchema,
      )
      const validOrbId = EntityId('test:production-valid-orb-after-fault')
      const missingOrbId = EntityId('test:production-missing-orb')
      yield* coordinator.commit({
        expectedRevision: orbSnapshot.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
          state: Schema.decodeUnknownSync(ExperienceOrbOwnerSnapshotSchema)({
            orbs: [{ id: validOrbId, value: 3, spawnedAt: 0 }],
          }),
        }],
      })
      const request = (orb: EntityId) => ({
        actor: EntityId('test:production-player'),
        orb,
        tick: 1,
        position: { dimension: 'overworld' as const, x: 0, y: 64, z: 0 },
      })
      yield* requestExperienceOrbAbsorption(state, request(missingOrbId))
      yield* requestExperienceOrbAbsorption(state, request(missingOrbId))
      yield* requestExperienceOrbAbsorption(state, request(validOrbId))

      yield* runFrame(stages, DeltaTimeSecs(0))

      const [faults, executions, vitals, orbs] = yield* Effect.all([
        drainGameplayStageFailures(state),
        drainExperienceOrbAbsorptionExecutions(state),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema),
      ])
      expect(faults).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'PlanBuild',
        subject: 'ExperienceOrb',
        requestId: String(missingOrbId),
        occurrences: 2,
        error: expect.objectContaining({ _tag: 'ExperienceOrbUnavailable', reason: 'missing-orb' }),
      }))
      expect(executions.map(({ outcome }) => outcome._tag)).toStrictEqual(['Failed', 'Failed', 'Completed'])
      expect(vitals.state.vitals.totalExperience).toBe(3)
      expect(orbs.state.orbs).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records an invalid pickup request and continues valid dropped-item pickup through production stages', () =>
    Effect.gen(function* () {
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: emptyPlayerStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      const droppedSnapshot = yield* coordinator.snapshot(
        GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        DroppedItemOwnerSnapshotSchema,
      )
      yield* coordinator.commit({
        expectedRevision: droppedSnapshot.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
          state: Schema.decodeUnknownSync(DroppedItemOwnerSnapshotSchema)({
            items: [{
              id: EntityId('test:pickup-after-invalid-request'),
              feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
              behaviour: { _tag: 'DroppedItem', item: 'gunpowder', count: StackCount(1), durability: null },
            }],
          }),
        }],
      })
      const invalidRequest = {
        actor: EntityId('test:invalid-pickup-request'),
        tick: -1,
        position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      } as unknown as Parameters<typeof requestDroppedItemPickup>[1]
      const validRequest = {
        actor: EntityId('test:valid-pickup-request'),
        tick: 1,
        position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      }
      yield* requestDroppedItemPickup(state, invalidRequest)
      yield* requestDroppedItemPickup(state, validRequest)

      yield* runFrame(stages, DeltaTimeSecs(0))

      const [faults, executions, storage, droppedItems] = yield* Effect.all([
        drainGameplayStageFailures(state),
        drainDroppedItemPickupExecutions(state),
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
      ])
      expect(faults).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'PlanBuild',
        subject: 'DroppedItem',
        requestId: String(invalidRequest.actor),
        occurrences: 1,
        error: expect.any(Object),
      }))
      expect(executions.map(({ outcome }) => outcome._tag)).toStrictEqual(['Failed', 'Completed'])
      expect(storage.state.inventory.slots.some((slot) => slot?.item === 'gunpowder' && slot.count === 1)).toBe(true)
      expect(droppedItems.state.items).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('continues mob contact damage after a valid spawn attempt exhausts the roster serial', () =>
    Effect.gen(function* () {
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: emptyPlayerStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      const roster = yield* coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
      yield* coordinator.commit({
        expectedRevision: roster.revision,
        expectedDimensions: [],
        changes: [{
          ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
          state: { ...roster.state, nextSerial: EntitySerial(Number.MAX_SAFE_INTEGER) },
        }],
      })
      const attempt = {
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
        kind: ZOMBIE_KIND,
        feetPosition: position(PositionAxis(30), PositionAxis(64), PositionAxis(0)),
      }
      yield* requestMobSpawn(state, attempt)
      const vitalsBefore = yield* coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )

      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* runFrame(stages, DeltaTimeSecs(0))

      const [faults, vitalsAfter, cooldowns, pendingAttempts] = yield* Effect.all([
        drainGameplayStageFailures(state),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        Ref.get(state.hostileContactCooldowns),
        Ref.get(state.spawnAttempts),
      ])
      expect(faults).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'EntityRoster',
        requestId: JSON.stringify([
          'mob-spawn',
          attempt.kind,
          'overworld',
          attempt.feetPosition.x,
          attempt.feetPosition.y,
          attempt.feetPosition.z,
        ]),
        occurrences: 2,
        error: expect.objectContaining({
          _tag: 'GameplayStageExecutionFailure',
          cause: { _tag: 'EntitySerialExhausted' },
        }),
      }))
      expect(vitalsAfter.state.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
      expect(cooldowns.has(EntityId('test:thorns-target'))).toBe(true)
      expect(pendingAttempts).toStrictEqual([attempt])
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records an invalid hostile damage state and continues queued XP spawning through production stages', () =>
    Effect.gen(function* () {
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: emptyPlayerStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      const futureDamageState = {
        lastDamageTick: Schema.decodeUnknownSync(SimulationTickSchema)(100),
        lastDamageAmount: DamageAmount(1),
      }
      yield* Ref.set(state.damageImmunity, futureDamageState)
      yield* Ref.update(state.mobExperience, (pending) => [...pending, {
        source: EntityId('test:queued-xp-after-damage-fault'),
        kind: ZOMBIE_KIND,
        at: position(PositionAxis(2), PositionAxis(64), PositionAxis(0)),
        amount: 3,
      }])
      const vitalsBefore = yield* coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )

      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* runFrame(stages, DeltaTimeSecs(0))

      const [faults, vitalsAfter, orbs, immunityAfter, contactCooldowns] = yield* Effect.all([
        drainGameplayStageFailures(state),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema),
        Ref.get(state.damageImmunity),
        Ref.get(state.hostileContactCooldowns),
      ])
      expect(faults).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'Player',
        requestId: JSON.stringify(['player-damage', 'HostileContact', 'test:thorns-target']),
        occurrences: 2,
        error: expect.objectContaining({
          _tag: 'GameplayStageExecutionFailure',
          cause: 'invalid-damage-state',
        }),
      }))
      expect(vitalsAfter.state.vitals).toStrictEqual(vitalsBefore.state.vitals)
      expect(immunityAfter).toStrictEqual(futureDamageState)
      expect(contactCooldowns.has(EntityId('test:thorns-target'))).toBe(false)
      expect(orbs.state.orbs).toContainEqual(expect.objectContaining({
        id: EntityId('mx-gameplay:experience-orb/test:queued-xp-after-damage-fault/0/0/0'),
        value: 3,
      }))
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records a creeper blast damage fault and continues the production entity tick', () =>
    Effect.gen(function* () {
      const mobRoster = Schema.decodeUnknownSync(GameplayEntityRosterSchema)({
        entities: [{
          id: EntityId('test:blast-creeper'),
          kind: CREEPER_KIND,
          feetPosition: position(PositionAxis(1), PositionAxis(64), PositionAxis(0)),
          healthPoints: EntityHealthPoints(20),
          behaviour: hostileMobSnapshot({ _tag: 'Lit', burnedSecs: 1.49 }),
          dimension: 'overworld',
        }],
        nextSerial: EntitySerial(1),
      })
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: emptyPlayerStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
        mobRoster,
      })
      const futureDamageState = {
        lastDamageTick: Schema.decodeUnknownSync(SimulationTickSchema)(100),
        lastDamageAmount: DamageAmount(1),
      }
      yield* Ref.set(state.damageImmunity, futureDamageState)

      yield* runFrame(stages, DeltaTimeSecs(0.02))

      const [faults, roster, vitals] = yield* Effect.all([
        drainGameplayStageFailures(state),
        coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      expect(faults).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'Player',
        requestId: JSON.stringify(['player-damage', 'Explosion', 'test:blast-creeper']),
        error: expect.objectContaining({
          _tag: 'GameplayStageExecutionFailure',
          cause: 'invalid-damage-state',
        }),
      }))
      expect(roster.state.entities).toStrictEqual([])
      expect(vitals.state.vitals.healthPoints).toBe(20)
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('skips an invalid hostile spawn cadence while continuing mob contacts through production stages', () =>
    Effect.gen(function* () {
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: emptyPlayerStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      yield* Ref.set(state.lastHostileSpawnTick, Schema.decodeUnknownSync(SimulationTickSchema)(2))
      const vitalsBefore = yield* coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )

      yield* runFrame(stages, DeltaTimeSecs(0))

      const [faults, vitalsAfter, damages, lastHostileSpawnTick] = yield* Effect.all([
        drainGameplayStageFailures(state),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        Ref.get(state.playerDamages),
        Ref.get(state.lastHostileSpawnTick),
      ])
      expect(faults).toContainEqual(expect.objectContaining({
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'EntityRoster',
        requestId: JSON.stringify(['hostile-spawn-search', 'overworld']),
        error: expect.objectContaining({
          _tag: 'GameplayStageExecutionFailure',
          cause: { _tag: 'InvalidSpawnTick' },
        }),
      }))
      expect(lastHostileSpawnTick).toBe(2)
      expect(damages).toContainEqual(expect.objectContaining({
        _tag: 'HostileContact',
        source: EntityId('test:thorns-target'),
      }))
      expect(vitalsAfter.state.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('uses the player dimension for a queued XP event without an explicit dimension', () =>
    Effect.gen(function* () {
      const { coordinator, stages, state } = yield* makeProductionScenario({
        storage: emptyPlayerStorage(),
        statusEffects: emptyStatusEffectState(),
        zombieHealth: 20,
      })
      yield* Ref.update(state.mobExperience, (pending) => [...pending, {
        source: EntityId('test:dimensionless-xp-event'),
        kind: ZOMBIE_KIND,
        at: position(PositionAxis(2), PositionAxis(64), PositionAxis(0)),
        amount: 3,
      }])

      yield* runFrame(stages, DeltaTimeSecs(0))

      const orbs = yield* coordinator.snapshot(
        GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
        ExperienceOrbOwnerSnapshotSchema,
      )
      expect(orbs.state.orbs).toHaveLength(1)
      expect(orbs.state.orbs[0]?.position?.dimension).toBe('overworld')
      expect(yield* Ref.get(state.mobExperience)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )
})
