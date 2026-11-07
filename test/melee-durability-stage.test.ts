import { describe, expect, it } from '@effect/vitest'
import { EntityHealthPoints, EntityId, EntityKind, EntitySerial, ItemDamage, StackCount, itemComponents, itemStack, weaponComponent, type BlockId, type EntityRoster, type ItemType } from '@nerima-games/mc-kernel'
import { PlayerStorageSnapshotSchema, damageAt, equipFromInventory, makeReplicatedOwnerId, makeTimeService, storageFromInventory, type PlayerStorage, type ReplicatedOwnerId, type StorageLocation, type WorldCommitCoordinatorApi } from '@nerima-games/mc-sim'
import { Effect, Ref, Result } from 'effect'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { meleeDamageForItem } from '../src/domain/interactions/melee-attack'
import {
  makeGameplayFrameStateForOwner,
  gameplayStages,
  requestTargetedPrimaryAttack,
} from '../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import type { GameplayTargetingSnapshotContext } from '../src/stages/registration'
import type { GameplayStageCommitServices } from '../src/stages/registration-core'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../src/stages/gameplay-owner-registrations'
import { makeChunkStoreDouble } from './support/chunk-store-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makeGameplayCommitServices } from './support/transactional-stage-doubles'
import { makePlayerServiceDouble } from './support/player-service-double'
import { runFrame } from './support/frame-runner'
import { position as atPosition } from './support/coordinate-fixtures'

const HELD_SLOT: StorageLocation = { _tag: 'Inventory', slotIndex: 0 }
const EMPTY_HELD_SLOT: StorageLocation = { _tag: 'Inventory', slotIndex: 1 }
const OFFHAND_SLOT: StorageLocation = { _tag: 'Equipment', slot: 'offhand' }
const WEAPON_WEAR = Result.getOrThrow(weaponComponent()).itemDamagePerAttack

const MELEE_TARGETS: EntityRoster<MobBehaviour> = {
  entities: [{
    id: EntityId('melee-durability-target'),
    kind: EntityKind('creeper'),
    feetPosition: atPosition(0, 64.72, -2.5),
    healthPoints: EntityHealthPoints(20),
    behaviour: undefined,
  }],
  nextSerial: EntitySerial(1),
}

const storageWith = (item?: ItemType): PlayerStorage => {
  const slots = [...emptySlots()]
  if (item !== undefined) slots[0] = Result.getOrThrow(itemStack(item, StackCount(1)))
  return storageFromInventory({ slots })
}

const storageWithEquipmentSword = (): PlayerStorage => {
  const slots = [...emptySlots()]
  slots[0] = Result.getOrThrow(itemStack('iron_sword', StackCount(1)))
  const equipped = equipFromInventory(storageFromInventory({ slots }), 0, 'offhand')
  if (equipped.result._tag !== 'Equipped') throw new Error('The test sword must equip in the offhand slot.')
  return equipped.storage
}

const storageWithZeroWearSword = (): PlayerStorage => {
  const weapon = Result.getOrThrow(weaponComponent({ itemDamagePerAttack: ItemDamage(0) }))
  const components = Result.getOrThrow(itemComponents('iron_sword', { weapon }))
  const slots = [...emptySlots()]
  slots[0] = Result.getOrThrow(itemStack('iron_sword', StackCount(1), { components }))
  return storageFromInventory({ slots })
}

const storageWithOneDurability = (item: ItemType): PlayerStorage => {
  const storage = storageWith(item)
  const initialDurability = storage.inventoryDurability[0]
  if (initialDurability === null || initialDurability === undefined) {
    throw new Error('The test weapon must have kernel durability data.')
  }
  return damageAt(storage, HELD_SLOT, initialDurability.max - 1).storage
}

const interleaveStorageCommitAfterPlayerSnapshot = (
  coordinator: WorldCommitCoordinatorApi,
  shouldInterleave: () => boolean,
): WorldCommitCoordinatorApi => {
  let interleaved = false
  let entitySnapshotSeen = false
  return {
    ...coordinator,
    snapshot: (ownerId, schema) => Effect.gen(function* () {
      const observed = yield* coordinator.snapshot(ownerId, schema)
      if (ownerId === GAMEPLAY_ENTITIES_OWNER_ID && shouldInterleave() && !interleaved) {
        entitySnapshotSeen = true
      }
      if (ownerId === GAMEPLAY_PLAYER_OWNER_ID && entitySnapshotSeen && !interleaved) {
        interleaved = true
        entitySnapshotSeen = false
        const storage = yield* coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)
        yield* Effect.orDie(coordinator.commit({
          expectedRevision: storage.revision,
          expectedDimensions: [],
          changes: [{ ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: storage.state }],
        }))
      }
      return observed
    }),
  }
}

const scene = (
  playerStorage: PlayerStorage,
  playerStorageOwnerId: ReplicatedOwnerId = GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  wrapCoordinator: (coordinator: WorldCommitCoordinatorApi) => WorldCommitCoordinatorApi = (coordinator) => coordinator,
) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(new Map<string, BlockId>(), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>(MELEE_TARGETS)
    const player = yield* makePlayerServiceDouble()
    const inventory = yield* makeInventoryDouble(playerStorage.inventory.slots)
    const time = yield* makeTimeService()
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      entities: MELEE_TARGETS,
      playerPose: { feetPosition: atPosition(0, 64, 0), yawRadians: 0, pitchRadians: 0 },
      playerStorage,
    })
    const scenarioCommit = {
      ...commit,
      playerStorageOwnerId,
      coordinator: wrapCoordinator(commit.coordinator),
    }
    const targeting: GameplayTargetingSnapshotContext = {
      coordinator: scenarioCommit.coordinator,
      playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
      entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
    }
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: scenarioCommit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    return {
      state,
      commit: scenarioCommit,
      store,
      targeting,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time, undefined, undefined, {}, scenarioCommit),
    }
  })

const ownerStorage = (commit: GameplayStageCommitServices) =>
  Effect.map(
    commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
    ({ state }) => state,
  )

const ownerRoster = (commit: GameplayStageCommitServices) =>
  Effect.map(
    commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
    ({ state }) => state,
  )

const runInteractions = (stages: ReturnType<typeof gameplayStages>) =>
  runFrame(stages.filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions))

describe('gameplay melee durability stage', () => {
  it.effect('wears a sword by the kernel weapon component amount in the hit commit', () =>
    Effect.gen(function* () {
      // Catches sword hits that damage the target without wearing the held sword.
      const initialStorage = storageWith('iron_sword')
      const initialDurability = initialStorage.inventoryDurability[0]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test sword must have kernel durability data.')
      }
      const { state, commit, stages, store, targeting } = yield* scene(initialStorage)
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        meleeDamage: meleeDamageForItem('iron_sword'),
        toolLocation: HELD_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      expect(yield* Ref.get(state.operationFailures)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toStrictEqual([])
      const storage = yield* ownerStorage(commit)
      expect(storage.inventoryDurability[0]).toStrictEqual({
        current: initialDurability.current - WEAPON_WEAR,
        max: initialDurability.max,
      })
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBeLessThan(20)
    }),
  )

  it.effect('wears an axe by the kernel weapon component amount', () =>
    Effect.gen(function* () {
      // Catches axe hits that damage the target without wearing the held axe.
      const initialStorage = storageWith('iron_axe')
      const initialDurability = initialStorage.inventoryDurability[0]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test axe must have kernel durability data.')
      }
      const { state, commit, stages, store, targeting } = yield* scene(initialStorage)
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        toolLocation: HELD_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      const storage = yield* ownerStorage(commit)
      expect(storage.inventoryDurability[0]).toStrictEqual({
        current: initialDurability.current - WEAPON_WEAR,
        max: initialDurability.max,
      })
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBeLessThan(20)
    }),
  )

  it.effect('breaks a sword with one durability on a successful hit', () =>
    Effect.gen(function* () {
      // Catches a last-point sword hit that leaves a broken weapon in PlayerStorage.
      const { state, commit, stages, store, targeting } = yield* scene(storageWithOneDurability('iron_sword'))
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        meleeDamage: meleeDamageForItem('iron_sword'),
        toolLocation: HELD_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      const storage = yield* ownerStorage(commit)
      expect(storage.inventory.slots[0]).toBeUndefined()
      expect(storage.inventoryDurability[0]).toBeNull()
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBeLessThan(20)
    }),
  )

  it.effect('does not wear inventory when an unarmed swing hits', () =>
    Effect.gen(function* () {
      // Catches bare-hand attacks scanning inventory and wearing an unheld sword.
      const initialStorage = storageWith('iron_sword')
      const { state, commit, stages, store, targeting } = yield* scene(initialStorage)
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        meleeDamage: meleeDamageForItem(null),
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      const storage = yield* ownerStorage(commit)
      expect(storage.inventory).toStrictEqual(initialStorage.inventory)
      expect(storage.inventoryDurability).toStrictEqual(initialStorage.inventoryDurability)
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBeLessThan(20)
    }),
  )

  it.effect('requeues a hit when the player storage owner is unknown', () =>
    Effect.gen(function* () {
      // Catches attacks that proceed without a readable storage owner snapshot.
      const { state, commit, stages, store, targeting } = yield* scene(
        storageWith('iron_sword'),
        makeReplicatedOwnerId('missing-melee-storage-owner'),
      )
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        toolLocation: HELD_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      expect(yield* Ref.get(state.operationFailures)).toHaveLength(1)
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toHaveLength(1)
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
    }),
  )

  it.effect('requeues a hit when storage changes after the player snapshot', () =>
    Effect.gen(function* () {
      // Catches melee commits that mix player and entity snapshots from different revisions.
      let interleaveNow = false
      const initialStorage = storageWith('iron_sword')
      const initialDurability = initialStorage.inventoryDurability[0]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test sword must have kernel durability data.')
      }
      const { state, commit, stages, store, targeting } = yield* scene(
        initialStorage,
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        (coordinator) => interleaveStorageCommitAfterPlayerSnapshot(coordinator, () => interleaveNow),
      )
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        toolLocation: HELD_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      interleaveNow = true
      yield* runInteractions(stages)

      const failures = yield* Ref.get(state.operationFailures)
      expect(failures).toMatchObject([{
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        error: { _tag: 'WorldRevisionConflict' },
      }])
      const failure = failures[0]
      if (failure === undefined || failure.error._tag !== 'WorldRevisionConflict') {
        throw new Error('Expected the owner snapshots to have different revisions.')
      }
      expect(failure.error.actual).toBeGreaterThan(failure.error.expected)
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toHaveLength(1)
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
      expect((yield* ownerStorage(commit)).inventoryDurability[0]).toStrictEqual(initialDurability)
    }),
  )

  it.effect('wears a sword held in the Equipment offhand slot', () =>
    Effect.gen(function* () {
      // Catches Equipment-held swords that bypass the inventory lookup path.
      const initialStorage = storageWithEquipmentSword()
      const initialDurability = initialStorage.equipment.slots.offhand?.durability
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test offhand sword must have kernel durability data.')
      }
      const { state, commit, stages, store, targeting } = yield* scene(initialStorage)
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        toolLocation: OFFHAND_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      const storage = yield* ownerStorage(commit)
      expect(storage.equipment.slots.offhand?.durability).toStrictEqual({
        current: initialDurability.current - WEAPON_WEAR,
        max: initialDurability.max,
      })
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBeLessThan(20)
    }),
  )

  it.effect('does not wear a sword when the declared slot is empty', () =>
    Effect.gen(function* () {
      // Catches attacks that scan inventory after the declared held slot is empty.
      const initialStorage = storageWith('iron_sword')
      const initialDurability = initialStorage.inventoryDurability[0]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test sword must have kernel durability data.')
      }
      const { state, commit, stages, store, targeting } = yield* scene(initialStorage)
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        toolLocation: EMPTY_HELD_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      const storage = yield* ownerStorage(commit)
      expect(storage.inventoryDurability[0]).toStrictEqual(initialDurability)
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBeLessThan(20)
    }),
  )

  it.effect('does not wear a valid weapon whose component sets wear to zero', () =>
    Effect.gen(function* () {
      // Catches zero wear values that are replaced by a default durability amount.
      const initialStorage = storageWithZeroWearSword()
      const initialDurability = initialStorage.inventoryDurability[0]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test sword must have kernel durability data.')
      }
      const { state, commit, stages, store, targeting } = yield* scene(initialStorage)
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        toolLocation: HELD_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      const storage = yield* ownerStorage(commit)
      expect(storage.inventoryDurability[0]).toStrictEqual(initialDurability)
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBeLessThan(20)
    }),
  )
})
