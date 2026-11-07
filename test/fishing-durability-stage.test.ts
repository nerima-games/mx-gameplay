import { describe, expect, it } from '@effect/vitest'
import { AngleRadians, DimensionIdSchema, EntityId, ProjectileIdSchema, StackCount, itemStack, type BlockId } from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  FishingStateSchema,
  PlayerStorageSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  SNOWBALL_PROFILE,
  WorldCommitCoordinator,
  damageAt,
  equipFromInventory,
  launchProjectile,
  makeReplicatedOwnerId,
  makeFishingService,
  storageFromInventory,
  type DomainEventBusApi,
  type PlayerStorage,
  type ProjectileLaunch,
  type StorageLocation,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Ref, Result, Schema, Stream } from 'effect'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import {
  drainItemUseResults,
  GameplayFishingItemUseResultSchema,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestFishingReel,
} from '../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import type { GameplayStageCommitServices } from '../src/stages/registration-core'
import {
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations'
import { makeChunkStoreDouble } from './support/chunk-store-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makeGameplayCommitServices } from './support/transactional-stage-doubles'
import { makePlayerServiceDouble } from './support/player-service-double'
import { runFrame } from './support/frame-runner'
import { position as atPosition } from './support/coordinate-fixtures'
import { makeTimeService } from '@nerima-games/mc-sim'

const HELD_ROD_SLOT: StorageLocation = { _tag: 'Inventory', slotIndex: 0 }
const OFFHAND_SLOT: StorageLocation = { _tag: 'Equipment', slot: 'offhand' }
// Source: `wearRod` in `src/domain/interactions/fishing.ts` decrements current durability by one.
const EXPECTED_REEL_WEAR = 1
const FISHER = EntityId('fishing-durability-actor')
const BOBBER = Schema.decodeUnknownSync(ProjectileIdSchema)('fishing-durability-bobber')
const DIMENSION = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const FISHING_LAUNCH: ProjectileLaunch = {
  position: atPosition(0, 64, 0),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: Brand.nominal<ProjectileLaunch['speed']>()(1),
}

const playerStorageWithRod = (): PlayerStorage => {
  const slots = [...emptySlots()]
  slots[HELD_ROD_SLOT.slotIndex] = Result.getOrThrow(itemStack('fishing_rod', StackCount(1)))
  return storageFromInventory({ slots })
}

const playerStorageWithEquipmentSword = (): PlayerStorage => {
  const slots = [...emptySlots()]
  slots[HELD_ROD_SLOT.slotIndex] = Result.getOrThrow(itemStack('iron_sword', StackCount(1)))
  const equipped = equipFromInventory(storageFromInventory({ slots }), HELD_ROD_SLOT.slotIndex, 'offhand')
  if (equipped.result._tag !== 'Equipped') throw new Error('The test sword must equip in the offhand slot.')
  return equipped.storage
}

const playerStorageWithNonRod = (): PlayerStorage => {
  const slots = [...emptySlots()]
  slots[HELD_ROD_SLOT.slotIndex] = Result.getOrThrow(itemStack('stone', StackCount(1)))
  return storageFromInventory({ slots })
}

const playerStorageWithOneRodDurability = (): PlayerStorage => {
  const storage = playerStorageWithRod()
  const durability = storage.inventoryDurability[HELD_ROD_SLOT.slotIndex]
  if (durability === null || durability === undefined) {
    throw new Error('The test fishing rod must have kernel durability data.')
  }
  return damageAt(storage, HELD_ROD_SLOT, durability.max - 1).storage
}

const scene = (
  playerStorage: PlayerStorage,
  fishingPhase: 'bite' | 'cast' = 'bite',
  playerStorageOwnerId = GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(new Map<string, BlockId>(), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(playerStorage.inventory.slots)
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const fishing = Schema.decodeUnknownSync(FishingStateSchema)({
      rods: [{ actor: FISHER, bobber: BOBBER, phase: fishingPhase }],
    })
    const projectiles = Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
      projectiles: [{
        id: BOBBER,
        dimension: DIMENSION,
        shooter: FISHER,
        kind: 'projectile',
        profile: SNOWBALL_PROFILE,
        projectile: launchProjectile({ ...FISHING_LAUNCH, shooterId: FISHER }),
      }],
    })
    const baseCommit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      fishing,
      playerStorage,
      projectiles,
    })
    const publishedEvents = yield* Ref.make<ReadonlyArray<Parameters<DomainEventBusApi['publish']>[0]>>([])
    const eventBus: DomainEventBusApi = {
      publish: (event) => Ref.update(publishedEvents, (events) => [...events, event]),
      events: Stream.empty,
    }
    const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, baseCommit.coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const commit = { ...baseCommit, fishingService, eventBus, playerStorageOwnerId }
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    return {
      state,
      commit,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time, undefined, undefined, {}, commit),
    }
  })

const ownerStorage = (commit: GameplayStageCommitServices) =>
  Effect.map(
    commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
    ({ state }) => state,
  )

const runInteractions = (stages: ReturnType<typeof gameplayStages>) =>
  runFrame(stages.filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions))

describe('gameplay fishing durability stage', () => {
  it.effect('wears the rod by the local one-point reel rule in the catch commit', () =>
    Effect.gen(function* () {
      // Catches successful reels that store the catch without wearing the held rod.
      const initialStorage = playerStorageWithRod()
      const initialDurability = initialStorage.inventoryDurability[HELD_ROD_SLOT.slotIndex]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test fishing rod must have kernel durability data.')
      }
      const { state, commit, stages } = yield* scene(initialStorage)
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestFishingReel(state, 'reel-wear', FISHER, HELD_ROD_SLOT)
      yield* runInteractions(stages)

      const [rawResult] = yield* drainItemUseResults(state)
      if (rawResult === undefined) throw new Error('Expected a fishing result.')
      const result = Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(rawResult)
      if (result.action !== 'ReelFishing' || !result.success || result.outcome._tag !== 'Caught') {
        throw new Error('Expected a successful fishing catch.')
      }
      const caughtItem = result.outcome.item
      const storage = yield* ownerStorage(commit)
      expect(storage.inventoryDurability[HELD_ROD_SLOT.slotIndex]).toStrictEqual({
        current: initialDurability.current - EXPECTED_REEL_WEAR,
        max: initialDurability.max,
      })
      expect(storage.inventory.slots.some((slot) => slot?.item === caughtItem)).toBe(true)
      expect(yield* commit.coordinator.revision).toBe(revisionBefore + 1)
    }),
  )

  it.effect('breaks a rod with one durability on a successful reel', () =>
    Effect.gen(function* () {
      // Catches successful reels that leave a one-durability rod unbroken.
      const initialStorage = playerStorageWithOneRodDurability()
      const { state, commit, stages } = yield* scene(initialStorage)
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestFishingReel(state, 'reel-break', FISHER, HELD_ROD_SLOT)
      yield* runInteractions(stages)

      const [rawResult] = yield* drainItemUseResults(state)
      if (rawResult === undefined) throw new Error('Expected a fishing result.')
      const result = Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(rawResult)
      if (result.action !== 'ReelFishing' || !result.success || result.outcome._tag !== 'Caught') {
        throw new Error('Expected a successful fishing catch.')
      }
      const caughtItem = result.outcome.item
      const storage = yield* ownerStorage(commit)
      expect(storage.inventoryDurability[HELD_ROD_SLOT.slotIndex]).toBeNull()
      expect(storage.inventory.slots.some((slot) => slot?.item === caughtItem)).toBe(true)
      expect(yield* commit.coordinator.revision).toBe(revisionBefore + 1)
    }),
  )

  it.effect('rejects an Equipment item that is not a fishing rod', () =>
    Effect.gen(function* () {
      // Catches fishing-rod lookup failures for Equipment locations.
      const { state, commit, stages } = yield* scene(playerStorageWithEquipmentSword())
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestFishingReel(state, 'reel-equipment-nonrod', FISHER, OFFHAND_SLOT)
      yield* runInteractions(stages)

      const [result] = yield* drainItemUseResults(state)
      expect(result).toStrictEqual({
        action: 'ReelFishing',
        requestId: 'reel-equipment-nonrod',
        success: false,
        failure: 'InvalidHeldItem',
      })
      const storage = yield* ownerStorage(commit)
      expect(storage.equipment.slots.offhand?.item).toBe('iron_sword')
      expect(yield* commit.coordinator.revision).toBe(revisionBefore)
    }),
  )

  it.effect('rejects a non-rod request without reprocessing it next frame', () =>
    Effect.gen(function* () {
      // Catches invalid held rods that would otherwise be retried on every frame.
      const { state, commit, stages } = yield* scene(playerStorageWithNonRod())
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestFishingReel(state, 'reel-invalid-rod', FISHER, HELD_ROD_SLOT)
      yield* runInteractions(stages)

      const [result] = yield* drainItemUseResults(state)
      expect(result).toStrictEqual({
        action: 'ReelFishing',
        requestId: 'reel-invalid-rod',
        success: false,
        failure: 'InvalidHeldItem',
      })
      expect(yield* commit.coordinator.revision).toBe(revisionBefore)

      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* commit.coordinator.revision).toBe(revisionBefore)
    }),
  )

  it.effect('wears the rod for a reel result without a catch', () =>
    Effect.gen(function* () {
      // Catches non-Caught reels that skip rod wear or add a nonexistent catch.
      const initialStorage = playerStorageWithRod()
      const initialDurability = initialStorage.inventoryDurability[HELD_ROD_SLOT.slotIndex]
      if (initialDurability === null || initialDurability === undefined) {
        throw new Error('The test fishing rod must have kernel durability data.')
      }
      const { state, commit, stages } = yield* scene(initialStorage, 'cast')
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestFishingReel(state, 'reel-no-bite', FISHER, HELD_ROD_SLOT)
      yield* runInteractions(stages)

      const [rawResult] = yield* drainItemUseResults(state)
      if (rawResult === undefined) throw new Error('Expected a fishing result.')
      const result = Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(rawResult)
      if (result.action !== 'ReelFishing' || !result.success || result.outcome._tag !== 'NoBite') {
        throw new Error('Expected a reel without a catch.')
      }
      const storage = yield* ownerStorage(commit)
      expect(storage.inventoryDurability[HELD_ROD_SLOT.slotIndex]).toStrictEqual({
        current: initialDurability.current - EXPECTED_REEL_WEAR,
        max: initialDurability.max,
      })
      expect(storage.inventory.slots.filter((slot) => slot !== undefined).map((slot) => slot.item))
        .toStrictEqual(['fishing_rod'])
      expect(yield* commit.coordinator.revision).toBe(revisionBefore + 1)
    }),
  )

  it.effect('records a player storage owner snapshot failure without requeueing the request', () =>
    Effect.gen(function* () {
      // Catches reel processing that misses a player-storage snapshot failure before planning.
      const { state, commit, stages } = yield* scene(
        playerStorageWithRod(),
        'bite',
        makeReplicatedOwnerId('missing-fishing-storage-owner'),
      )
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestFishingReel(state, 'reel-owner-missing', FISHER, HELD_ROD_SLOT)
      yield* runInteractions(stages)

      expect(yield* Ref.get(state.operationFailures)).toHaveLength(1)
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* commit.coordinator.revision).toBe(revisionBefore)
    }),
  )
})
