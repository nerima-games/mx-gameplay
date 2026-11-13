import { describe, expect, it } from '@effect/vitest'
import {
  DeltaTimeSecs,
  EntityHealthPoints,
  EntitySerial,
  PositionAxis,
  StackCount,
  enchantmentsComponent,
  itemComponents,
  position,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  EntityId,
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  TNT_REPLICATED_OWNER_ID,
  TntServiceSnapshotSchema,
  TimeService,
  WorldCommitCoordinator,
  durability,
  emptyPlayerStorage,
  equipmentItem,
  itemStack,
  makeTimeService,
  type DomainEventBusApi,
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
import {
  hostileMobSnapshot,
} from '../src/domain/entities/mob-frame.js'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat.js'
import {
  applyStatusEffect,
  emptyStatusEffectState,
  type StatusEffectState,
} from '../src/domain/status-effect.js'
import { makeGameplayStagesWithState } from '../src/stages/gameplay-stage-composition.js'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../src/stages/gameplay-owner-registrations.js'
import {
  makeGameplayFrameStateForOwner,
} from '../src/stages/registration.js'
import { drainGameplayUnsupportedOperations } from '../src/stages/registration-core.js'
import { emptyWorldStoreLayer, world } from './support/chunk-store-double.js'
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
  const roster = zombieRoster(options.zombieHealth)
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

describe('full-composition enchantment coverage', () => {
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

  it.effect('resolves Thorns retaliation through zombie drops and experience rewards', () =>
    Effect.gen(function* () {
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

      const [roster, storage, orbs, unsupported] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema),
        drainGameplayUnsupportedOperations(state),
      ])
      expect(roster.state.entities).toStrictEqual([])
      expect(storage.state.equipment.slots.head).toBeNull()
      expect(orbs.state.orbs.reduce(
        (total, orb) => total + Number(orb.value) * (orb.count ?? 1),
        0,
      )).toBe(5)
      expect(orbs.state.orbs.every(({ position: orbPosition }) => orbPosition?.dimension === 'overworld')).toBe(true)
      expect(unsupported).toContainEqual(expect.objectContaining({
        _tag: 'Unsupported',
        action: 'MobDrop',
        reason: 'UnsupportedDropItemIds',
        mobKind: ZOMBIE_KIND,
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

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
