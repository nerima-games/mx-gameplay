import { describe, expect, it } from '@effect/vitest'
import { AttackRangeDistance, DamageAmountSchema, EntityHealthPoints, EntityId, EntityKind, EntitySerial, ItemDamage, SimulationTickSchema, StackCount, itemComponents, itemStack, weaponComponent, type BlockId, type EntityRoster, type ItemType } from '@nerima-games/mc-kernel'
import { PlayerStorageSnapshotSchema, damageAt, equipFromInventory, makeReplicatedOwnerId, makeTimeService, storageFromInventory, type PlayerStorage, type ReplicatedOwnerId, type StorageLocation, type WorldCommitCoordinatorApi } from '@nerima-games/mc-sim'
import { Effect, Ref, Result, Schema } from 'effect'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { meleeDamageForItem, type MeleeAttackRequest } from '../src/domain/interactions/melee-attack'
import {
  makeGameplayFrameStateForOwner,
  gameplayStages,
  drainMeleeAttackResults,
  requestMeleeAttack,
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
import { expectedMeleeAttack } from './support/melee-attack-oracle'

const HELD_SLOT: StorageLocation = { _tag: 'Inventory', slotIndex: 0 }
const EMPTY_HELD_SLOT: StorageLocation = { _tag: 'Inventory', slotIndex: 1 }
const OFFHAND_SLOT: StorageLocation = { _tag: 'Equipment', slot: 'offhand' }
const WEAPON_WEAR = Result.getOrThrow(weaponComponent()).itemDamagePerAttack
const simulationTick = (tick: number) => Schema.decodeUnknownSync(SimulationTickSchema)(tick)

const forgedMeleeRequest = (requestId: string): MeleeAttackRequest => ({
  requestId,
  origin: atPosition(80, 64, 80),
  direction: atPosition(1, 0, 0),
  reach: AttackRangeDistance(64),
  damage: 999,
  toolLocation: HELD_SLOT,
  hitDistance: 64,
  critical: true,
} as unknown as MeleeAttackRequest)

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
        meleeDamage: Result.getOrThrow(meleeDamageForItem('iron_sword')),
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
        meleeDamage: Result.getOrThrow(meleeDamageForItem('iron_sword')),
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
        meleeDamage: Result.getOrThrow(meleeDamageForItem(null)),
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

  it.effect('does not treat an Equipment offhand slot as the selected hotbar weapon', () =>
    Effect.gen(function* () {
      // Catches offhand weapons being accepted without a server-owned selected hotbar slot.
      const initialStorage = storageWithEquipmentSword()
      const { state, commit, stages, store, targeting } = yield* scene(initialStorage)
      const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
        toolLocation: OFFHAND_SLOT,
      })
      expect(queued._tag).toBe('Melee')

      yield* runFrame(stages)

      const storage = yield* ownerStorage(commit)
      expect(storage.equipment).toStrictEqual(initialStorage.equipment)
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
      expect(yield* Ref.get(state.meleeLastAttackTick)).toBeNull()
    }),
  )

  it.effect('uses server pose, hotbar snapshot, cooldown and hurt resistance instead of request claims', () =>
    Effect.gen(function* () {
      const initialStorage = storageWith('iron_sword')
      const initialDurability = initialStorage.inventoryDurability[0]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test sword must have kernel durability data.')
      }
      const { state, commit, stages } = yield* scene(initialStorage)
      const tick = simulationTick(40)
      yield* Ref.set(state.tickCount, tick)
      yield* Ref.set(state.meleeLastAttackTick, simulationTick(35))
      const expected = expectedMeleeAttack({
        heldItem: 'iron_sword',
        ticksSinceLastAttack: 5,
        critical: false,
        tick: 40,
        targetDamageState: null,
      })
      if (expected === null) throw new Error('The valid server melee input must produce oracle damage.')
      yield* requestMeleeAttack(state, forgedMeleeRequest('forged-melee-damage'))

      yield* runFrame(stages)

      expect(yield* Ref.get(state.operationFailures)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toStrictEqual([])
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20 - expected.appliedAmount)
      const damageState = (yield* Ref.get(state.meleeTargetDamageStates)).get(MELEE_TARGETS.entities[0]!.id)
      expect(damageState?.lastDamageTick).toBe(expected.targetDamageState.lastDamageTick)
      expect(damageState?.lastDamageAmount).toBeCloseTo(expected.targetDamageState.lastDamageAmount, 12)
      expect(yield* Ref.get(state.meleeLastAttackTick)).toBe(tick)
      expect((yield* ownerStorage(commit)).inventoryDurability[0]).toStrictEqual({
        current: initialDurability.current - WEAPON_WEAR,
        max: initialDurability.max,
      })
    }),
  )

  it.effect('accepts pickaxes, shovels and hoes as melee weapons but treats a bow as unarmed', () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{ readonly item: ItemType; readonly heldItem: ItemType | null }> = [
        { item: 'diamond_pickaxe', heldItem: 'diamond_pickaxe' },
        { item: 'iron_shovel', heldItem: 'iron_shovel' },
        { item: 'netherite_hoe', heldItem: 'netherite_hoe' },
        { item: 'bow', heldItem: null },
      ]

      for (const { item, heldItem } of cases) {
        const initialStorage = storageWith(item)
        const initialDurability = initialStorage.inventoryDurability[0]
        const { state, commit, stages } = yield* scene(initialStorage)
        const expected = expectedMeleeAttack({
          heldItem,
          ticksSinceLastAttack: 25,
          critical: false,
          tick: 0,
          targetDamageState: null,
        })
        if (expected === null) throw new Error('The test melee input must produce oracle damage.')
        yield* requestMeleeAttack(state, forgedMeleeRequest(`weapon-${item}`))
        yield* runInteractions(stages)

        expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20 - expected.appliedAmount)
        expect((yield* Ref.get(state.meleeTargetDamageStates)).get(MELEE_TARGETS.entities[0]!.id)).toStrictEqual(
          expected.targetDamageState,
        )
        if (heldItem === null) {
          expect((yield* ownerStorage(commit)).inventoryDurability[0]).toStrictEqual(initialDurability)
        } else {
          if (initialDurability === null || initialDurability === undefined) {
            throw new Error(`The test ${item} must have kernel durability data.`)
          }
          expect((yield* ownerStorage(commit)).inventoryDurability[0]).toStrictEqual({
            current: initialDurability.current - WEAPON_WEAR,
            max: initialDurability.max,
          })
        }
      }
    }),
  )

  it.effect('rejects an attack when its stage tick precedes the last attack tick', () =>
    Effect.gen(function* () {
      const initialStorage = storageWith('iron_sword')
      const { state, commit, stages } = yield* scene(initialStorage)
      const tick = simulationTick(40)
      const lastAttackTick = simulationTick(41)
      yield* Ref.set(state.tickCount, tick)
      yield* Ref.set(state.meleeLastAttackTick, lastAttackTick)
      yield* requestMeleeAttack(state, forgedMeleeRequest('stale-attack-tick'))

      yield* runFrame(stages)

      expect(yield* Ref.get(state.meleeAttackResults)).toStrictEqual([{
        requestId: 'stale-attack-tick',
        success: false,
      }])
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toStrictEqual([])
      expect(yield* Ref.get(state.meleeLastAttackTick)).toBe(lastAttackTick)
      expect(yield* Ref.get(state.meleeTargetDamageStates)).toStrictEqual(new Map())
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
      expect(yield* ownerStorage(commit)).toStrictEqual(initialStorage)
    }),
  )

  it.effect('rejects melee attacks when the stage tick is malformed', () =>
    Effect.gen(function* () {
      const initialStorage = storageWith('iron_sword')
      const { state, commit, stages } = yield* scene(initialStorage)
      yield* Ref.set(state.tickCount, Number.NaN as never)
      yield* requestMeleeAttack(state, forgedMeleeRequest('malformed-attack-tick'))

      yield* runInteractions(stages)

      expect(yield* Ref.get(state.meleeAttackResults)).toStrictEqual([{
        requestId: 'malformed-attack-tick',
        success: false,
      }])
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toStrictEqual([])
      expect(yield* Ref.get(state.meleeLastAttackTick)).toBeNull()
      expect(yield* Ref.get(state.meleeTargetDamageStates)).toStrictEqual(new Map())
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
      expect(yield* ownerStorage(commit)).toStrictEqual(initialStorage)
    }),
  )

  it.effect('does not consume attack cooldown for an invalid target damage state', () =>
    Effect.gen(function* () {
      const initialStorage = storageWith('iron_sword')
      const { state, commit, stages } = yield* scene(initialStorage)
      const tick = simulationTick(40)
      const lastAttackTick = simulationTick(35)
      const futureDamageState = {
        lastDamageTick: simulationTick(41),
        lastDamageAmount: Schema.decodeUnknownSync(DamageAmountSchema)(5),
      }
      yield* Ref.set(state.tickCount, tick)
      yield* Ref.set(state.meleeLastAttackTick, lastAttackTick)
      yield* Ref.set(state.meleeTargetDamageStates, new Map([
        [MELEE_TARGETS.entities[0]!.id, futureDamageState],
      ]))
      yield* requestMeleeAttack(state, forgedMeleeRequest('future-damage-tick'))

      yield* runInteractions(stages)

      expect(yield* Ref.get(state.meleeAttackResults)).toStrictEqual([{
        requestId: 'future-damage-tick',
        success: false,
      }])
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toStrictEqual([])
      expect(yield* Ref.get(state.meleeLastAttackTick)).toBe(lastAttackTick)
      expect(yield* Ref.get(state.meleeTargetDamageStates)).toStrictEqual(new Map([
        [MELEE_TARGETS.entities[0]!.id, futureDamageState],
      ]))
      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
      expect(yield* ownerStorage(commit)).toStrictEqual(initialStorage)
    }),
  )

  it.effect('consumes cooldown without committing damage or wear when target hurt resistance suppresses a hit', () =>
    Effect.gen(function* () {
      const initialStorage = storageWith('iron_sword')
      const initialDurability = initialStorage.inventoryDurability[0]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test sword must have kernel durability data.')
      }
      const { state, commit, stages } = yield* scene(initialStorage)
      const tick = simulationTick(40)
      const previousDamageState = {
        lastDamageTick: simulationTick(39),
        lastDamageAmount: Schema.decodeUnknownSync(DamageAmountSchema)(5),
      }
      yield* Ref.set(state.tickCount, tick)
      yield* Ref.set(state.meleeLastAttackTick, simulationTick(35))
      yield* Ref.set(state.meleeTargetDamageStates, new Map([
        [MELEE_TARGETS.entities[0]!.id, previousDamageState],
      ]))
      const expected = expectedMeleeAttack({
        heldItem: 'iron_sword',
        ticksSinceLastAttack: 5,
        critical: false,
        tick: 40,
        targetDamageState: { lastDamageTick: 39, lastDamageAmount: 5 },
      })
      expect(expected).toBeNull()
      yield* requestMeleeAttack(state, forgedMeleeRequest('hurt-resistant-target'))

      yield* runFrame(stages)

      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
      expect((yield* ownerStorage(commit)).inventoryDurability[0]).toStrictEqual(initialDurability)
      expect(yield* Ref.get(state.meleeTargetDamageStates)).toStrictEqual(new Map([
        [MELEE_TARGETS.entities[0]!.id, previousDamageState],
      ]))
      expect(yield* Ref.get(state.meleeLastAttackTick)).toBe(tick)
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toStrictEqual([])

      const nextTick = simulationTick(41)
      expect(expectedMeleeAttack({
        heldItem: 'iron_sword',
        ticksSinceLastAttack: 1,
        critical: false,
        tick: 41,
        targetDamageState: { lastDamageTick: 39, lastDamageAmount: 5 },
      })).toBeNull()
      yield* Ref.set(state.tickCount, nextTick)
      yield* requestMeleeAttack(state, forgedMeleeRequest('hurt-resistant-follow-up'))
      yield* runInteractions(stages)

      expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
      expect((yield* ownerStorage(commit)).inventoryDurability[0]).toStrictEqual(initialDurability)
      expect(yield* Ref.get(state.meleeTargetDamageStates)).toStrictEqual(new Map([
        [MELEE_TARGETS.entities[0]!.id, previousDamageState],
      ]))
      expect(yield* Ref.get(state.meleeLastAttackTick)).toBe(nextTick)
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

  it.effect('returns correlated typed failures for invalid targeted melee slots', () =>
    Effect.gen(function* () {
      const initialStorage = storageWith('iron_sword')
      const initialDurability = initialStorage.inventoryDurability[0]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test sword must have kernel durability data.')
      }
      const { state, commit, stages, store, targeting } = yield* scene(initialStorage)
      const requestIds = new Set<string>()

      for (const slotIndex of [-1, 9, 1.5]) {
        const queued = yield* requestTargetedPrimaryAttack(state, store.api, targeting, {
          toolLocation: { _tag: 'Inventory', slotIndex },
        })
        expect(queued._tag).toBe('Melee')
        if (queued._tag !== 'Melee') throw new Error('Expected the targeted request to queue a melee attack.')
        expect(requestIds.has(queued.requestId)).toBe(false)
        requestIds.add(queued.requestId)

        yield* runFrame(stages)

        expect(yield* drainMeleeAttackResults(state)).toStrictEqual([{
          requestId: queued.requestId,
          success: false,
          outcome: 'InvalidToolLocation',
        }])
        expect((yield* ownerRoster(commit)).entities[0]?.healthPoints).toBe(20)
        expect((yield* ownerStorage(commit)).inventoryDurability[0]).toStrictEqual(initialDurability)
      }
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toStrictEqual([])
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
