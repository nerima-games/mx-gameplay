import { describe, expect, it } from '@effect/vitest'
import {
  AIR_BLOCK_ID,
  BlockAxis,
  BlockId,
  blockIdOf,
  blockPosition,
  DeltaTimeSecs,
  enchantmentsComponent,
  itemComponents,
  type ItemType,
  RandomSeed,
  type StageRegistration,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  PlayerStorageSnapshotSchema,
  ReplicatedOwnerUnknown,
  TimeService,
  TotalExperience,
  WorldCommitCoordinator,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
  WorldRevisionConflict,
  itemStack as makeItemStack,
  makeTimeService,
  durabilityForItem,
  type DomainEventBusApi,
  type EnchantmentTableServiceApi,
  type Slot,
  countEnchantmentTableBookshelves,
  generateEnchantmentTableOffers,
  makeEnchantmentTableService,
} from '@nerima-games/mc-sim'
import { ChunkStore, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { Cause, Effect, Exit, Layer, Option, Ref, Result, Schema, Stream } from 'effect'
import * as FastCheck from 'fast-check'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../src/domain/entities/xp-orb.js'
import { enchantmentTableRandomForSeed } from '../src/domain/enchantment-seed.js'
import { bindEnchantmentTableService } from '../src/stages/interactions-stage.js'
import { gameplayStages } from '../src/stages/gameplay-stages.js'
import { entityManagerTag, type MobBehaviour } from '../src/stages/registration-core.js'
import {
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations.js'
import {
  drainEnchantmentTableResults,
  drainGameplayEntityStageFaults,
  gameplayModule,
  makeGameplayFrameState,
  makeGameplayFrameStateForOwner,
  makeGameplayStages,
  requestEnchantmentTableApply,
  requestEnchantmentTableOffers,
  GameplayEnchantmentTableApplyRequestSchema,
  GameplayEnchantmentTableOffersRequestSchema,
  GameplayEnchantmentTableResultSchema,
} from '../src/stages/registration.js'
import { makeGameplayStagesWithState } from '../src/stages/gameplay-stage-composition.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import { emptyRosterLayer } from './support/entity-manager-double.js'
import { blockKey, chunkKeyOf, makeChunkStoreDouble, STONE, world } from './support/chunk-store-double.js'
import { emptyInventoryLayer } from './support/inventory-service-double.js'
import { gameplayCommitServicesLayer } from './support/transactional-stage-doubles.js'
import { runFrame } from './support/frame-runner.js'

const eventBus: DomainEventBusApi = {
  publish: () => Effect.void,
  events: Stream.empty,
}

const ENCHANTMENT_TABLE_POSITION = { x: 0, y: 64, z: 0 } as const
const TABLE_BLOCK_POSITION = blockPosition(
  BlockAxis(ENCHANTMENT_TABLE_POSITION.x),
  BlockAxis(ENCHANTMENT_TABLE_POSITION.y),
  BlockAxis(ENCHANTMENT_TABLE_POSITION.z),
)
const ENCHANTING_TABLE = Option.getOrThrow(blockIdOf('enchanting_table'))
// The table at the origin has its two-block ring in the four chunks around it.
const TABLE_RING_CHUNKS = ['-1,-1', '-1,0', '0,-1', '0,0']

// Suspended because the double's Ref captures the map it is first given: an
// eagerly built double would carry one test's block writes into the next build.
const tableWorldStoreLayer = Layer.effect(
  ChunkStore,
  Effect.suspend(() => Effect.map(
    makeChunkStoreDouble(world([[TABLE_BLOCK_POSITION, ENCHANTING_TABLE]]), TABLE_RING_CHUNKS),
    (double) => double.api,
  )),
)

const productionWorld = Layer.provideMerge(
  gameplayCommitServicesLayer,
  Layer.mergeAll(
    tableWorldStoreLayer,
    emptyRosterLayer,
    Layer.effect(TimeService, makeTimeService()),
    emptyInventoryLayer,
    Layer.succeed(DomainEventBus, eventBus),
  ),
)

const stack = (item: ItemType, count: number) =>
  Result.getOrThrow(makeItemStack(item, count))

const ENCHANTMENT_TABLE_SEED = 1
const MULTI_ENCHANTMENT_SLOT = 2
// Fixed mc-sim Java table vector for a diamond sword, seed 1, and no shelves.
// Kept independent of the production generator so the stage adapter is checked
// against a stable result rather than its own expected-value calculation.
const PINNED_DIAMOND_SWORD_OFFERS = [
  { slot: 0, offer: { levelCost: 4, lapisCost: 1, enchantments: [{ id: 'sharpness', level: 1 }] } },
  { slot: 1, offer: { levelCost: 7, lapisCost: 2, enchantments: [{ id: 'smite', level: 1 }] } },
  { slot: MULTI_ENCHANTMENT_SLOT, offer: { levelCost: 6, lapisCost: 3, enchantments: [{ id: 'sharpness', level: 1 }] } },
] as const
const PINNED_MULTI_ENCHANTMENT_OFFER = PINNED_DIAMOND_SWORD_OFFERS[MULTI_ENCHANTMENT_SLOT]!.offer

describe('generated enchantment offers result', () => {
  it('carries the counted bookshelf count with the generated offers', () => {
    const offerEntryArbitrary = FastCheck.constantFrom(...PINNED_DIAMOND_SWORD_OFFERS)

    FastCheck.assert(FastCheck.property(
      FastCheck.string({ minLength: 1 }),
      FastCheck.integer({ min: 0, max: 15 }),
      FastCheck.array(offerEntryArbitrary, { maxLength: 3 }),
      (requestId, bookshelfCount, offers) => {
        const generated = { _tag: 'OffersGenerated', requestId, bookshelfCount, offers }
        expect(Schema.decodeUnknownSync(GameplayEnchantmentTableResultSchema)(generated)).toStrictEqual(generated)
      },
    ))

    const result = {
      _tag: 'OffersGenerated',
      requestId: 'counted-bookshelves',
      bookshelfCount: 0,
      offers: PINNED_DIAMOND_SWORD_OFFERS,
    } as const
    for (const bookshelfCount of [-1, 16, 1.5]) {
      expect(Schema.is(GameplayEnchantmentTableResultSchema)({ ...result, bookshelfCount })).toBe(false)
    }
    expect(Schema.is(GameplayEnchantmentTableResultSchema)({
      _tag: 'OffersGenerated', requestId: result.requestId, offers: result.offers,
    })).toBe(false)
    expect(Schema.is(GameplayEnchantmentTableResultSchema)({
      ...result,
      _tag: 'OffersGeneratedWithoutBookshelfCount',
    })).toBe(false)
    expect(Schema.is(GameplayEnchantmentTableResultSchema)({ ...result, requestId: '' })).toBe(false)
    for (const slot of [-1, 3]) {
      expect(Schema.is(GameplayEnchantmentTableResultSchema)({
        ...result,
        offers: [{ slot, offer: PINNED_DIAMOND_SWORD_OFFERS[0]!.offer }],
      })).toBe(false)
    }
    for (const slot of [0, 2]) {
      expect(Schema.is(GameplayEnchantmentTableResultSchema)({
        ...result,
        offers: [{ slot, offer: PINNED_DIAMOND_SWORD_OFFERS[0]!.offer }],
      })).toBe(true)
    }
  })
})

const countItem = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: ItemType,
): number => storage.inventory.slots.reduce(
  (count, slot) => count + (slot?.item === item ? slot.count : 0),
  0,
)

const countEnchantedItem = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: ItemType,
): number => storage.inventory.slots.reduce(
  (count, slot) => count + (slot?.item === item && slot.components.enchantments !== undefined ? slot.count : 0),
  0,
)

const storageWithSlots = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  slots: ReadonlyArray<Slot>,
) => Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)({
  ...storage,
  inventory: { ...storage.inventory, slots },
  inventoryDurability: slots.map((slot) => slot === undefined ? null : durabilityForItem(slot.item)),
})

const seedTableInputs = (
  item: ItemType | null = 'diamond_sword',
  lapisCount = 64,
) => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const storage = yield* coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)
  const vitals = yield* coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)
  const slots: Array<Slot> = [...storage.state.inventory.slots]
  slots[0] = item === null ? undefined : stack(item, 1)
  slots[1] = stack('lapis_lazuli', lapisCount)
  const storageState = storageWithSlots(storage.state, slots)
  const vitalsState = Schema.decodeUnknownSync(ExperienceOrbVitalsOwnerSnapshotSchema)({
    vitals: {
      ...vitals.state.vitals,
      // Java Edition level 30 starts at 1,395 XP; seven points give 7/112 progress.
      totalExperience: Result.getOrThrow(TotalExperience.result(1_402)),
    },
  })
  yield* coordinator.commit({
    expectedRevision: storage.revision,
    expectedDimensions: [],
    changes: [
      { ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: storageState },
      { ownerId: GAMEPLAY_VITALS_OWNER_ID, state: vitalsState },
    ],
  })
})

const assertRejected = (
  state: Parameters<typeof drainEnchantmentTableResults>[0],
  requestId: string,
  reason: string,
) => Effect.gen(function* () {
  expect(yield* drainEnchantmentTableResults(state)).toContainEqual({
    _tag: 'Rejected', requestId, reason,
  })
})

describe('production enchanting table orchestration', () => {
  it.effect('rejects an offer request when the production random seed is invalid', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()
      const stages = yield* makeGameplayStagesWithState(state)
      const interactions = stages.filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)
      expect(interactions).toHaveLength(1)
      yield* Ref.set(state.rollSeed, Number.NaN)

      yield* requestEnchantmentTableOffers(state, {
        requestId: 'invalid-random-seed', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(interactions, DeltaTimeSecs(0))

      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([{
        _tag: 'Rejected', requestId: 'invalid-random-seed', reason: 'invalid-seed',
      }])
      expect(yield* Ref.get(state.rollSeed)).toBeNaN()
      expect(yield* Ref.get(state.operationFailures)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('uses gameplayModule’s frame-stage builder and applies a multi-enchantment offer atomically', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()

      expect(gameplayModule.frameStages).toBe(makeGameplayStages)
      const commits: Array<Readonly<{ request: WorldCommitRequest; revision: number }>> = []
      const observedCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        commit: (request) => Effect.map(coordinator.commit(request), (delta) => {
          commits.push({ request, revision: Number(delta.revision) })
          return delta
        }),
      }
      const stages = yield* makeGameplayStagesWithState(state).pipe(
        Effect.provideService(WorldCommitCoordinator, observedCoordinator),
      )
      expect(stages).toHaveLength(9)
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)
      const expectedSlot = MULTI_ENCHANTMENT_SLOT
      const expectedOffer = PINNED_MULTI_ENCHANTMENT_OFFER

      const offerRequest: unknown = {
        requestId: 'table-success',
        itemSlot: 0,
        lapisSlot: 1,
        tablePosition: ENCHANTMENT_TABLE_POSITION,
        bookshelfCount: 15,
      }
      yield* requestEnchantmentTableOffers(state, offerRequest)
      yield* runFrame(stages, DeltaTimeSecs(0))
      const generated = yield* drainEnchantmentTableResults(state)
      expect(generated).toStrictEqual([{
        _tag: 'OffersGenerated',
        requestId: 'table-success',
        bookshelfCount: 0,
        offers: PINNED_DIAMOND_SWORD_OFFERS,
      }])

      const [beforeStorage, beforeVitals] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      expect(Number(beforeVitals.state.vitals.totalExperience)).toBe(1_402)
      // Java Edition level 27 starts at 1,089 XP; its next-level span is 97 XP.
      const expectedExperience = 1_089 + (7 / 112) * 97
      const commitsBeforeApply = commits.length

      yield* requestEnchantmentTableApply(state, {
        requestId: 'table-success',
        tableSlot: expectedSlot,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      const applied = yield* drainEnchantmentTableResults(state)
      expect(applied).toContainEqual(expect.objectContaining({
        _tag: 'Applied',
        requestId: 'table-success',
        tableSlot: expectedSlot,
        offer: expectedOffer,
      }))
      const applyCommits = commits.slice(commitsBeforeApply)
      const transactionCommits = applyCommits.filter(({ request }) => {
        const changedOwners = request.changes.map(({ ownerId }) => ownerId)
        return changedOwners.includes(GAMEPLAY_PLAYER_STORAGE_OWNER_ID) &&
          changedOwners.includes(GAMEPLAY_VITALS_OWNER_ID)
      })
      expect(transactionCommits).toHaveLength(1)
      const transactionCommit = transactionCommits[0]!
      expect(Number(transactionCommit.request.expectedRevision)).toBe(Number(beforeStorage.revision))
      expect(transactionCommit.revision).toBe(Number(transactionCommit.request.expectedRevision) + 1)
      expect(transactionCommit.request.changes.map(({ ownerId }) => ownerId)).toEqual([
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        GAMEPLAY_VITALS_OWNER_ID,
      ])
      expect(transactionCommit.request.changes.find(({ ownerId }) => ownerId === GAMEPLAY_VITALS_OWNER_ID)?.state)
        .toMatchObject({ vitals: { totalExperience: expectedExperience } })

      const [afterStorage, afterVitals] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      expect(countItem(afterStorage.state, 'lapis_lazuli')).toBe(64 - expectedOffer.lapisCost)
      expect(countItem(afterStorage.state, 'diamond_sword')).toBe(1)
      expect(countEnchantedItem(afterStorage.state, 'diamond_sword')).toBe(1)
      const enchanted = afterStorage.state.inventory.slots.find(
        (slot) => slot?.item === 'diamond_sword' && slot.components.enchantments !== undefined,
      )
      expect(enchanted?.components.enchantments).toEqual(
        Object.fromEntries(expectedOffer.enchantments.map(({ id, level }) => [`minecraft:${id}`, level])),
      )
      expect(Number(afterVitals.state.vitals.totalExperience)).toBe(expectedExperience)
      expect(afterStorage.revision).toBe(afterVitals.revision)
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('rejects missing sessions, stale items and insufficient lapis without apply-side mutation', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()
      const stages = yield* makeGameplayStagesWithState(state)
      const seed = ENCHANTMENT_TABLE_SEED
      const slot = MULTI_ENCHANTMENT_SLOT

      yield* requestEnchantmentTableApply(state, { requestId: 'missing-session', tableSlot: slot })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* assertRejected(state, 'missing-session', 'session-not-found')

      yield* Ref.set(state.rollSeed, seed)
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'stale-session', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* drainEnchantmentTableResults(state)
      const storageBeforeChange = yield* coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      const changedSlots: Array<Slot> = [...storageBeforeChange.state.inventory.slots]
      changedSlots[0] = stack('iron_sword', 1)
      const changedStorage = storageWithSlots(storageBeforeChange.state, changedSlots)
      yield* coordinator.commit({
        expectedRevision: storageBeforeChange.revision,
        expectedDimensions: [],
        changes: [{ ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: changedStorage }],
      })
      const [staleStorageBeforeApply, staleVitalsBeforeApply] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      yield* requestEnchantmentTableApply(state, { requestId: 'stale-session', tableSlot: slot })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* assertRejected(state, 'stale-session', 'item-changed')
      const [staleStorageAfterApply, staleVitalsAfterApply] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      expect(staleStorageAfterApply.state).toEqual(staleStorageBeforeApply.state)
      expect(staleVitalsAfterApply.state).toEqual(staleVitalsBeforeApply.state)

      const restoredSlots: Array<Slot> = [...staleStorageAfterApply.state.inventory.slots]
      restoredSlots[0] = stack('diamond_sword', 1)
      restoredSlots[1] = undefined
      const noLapisStorage = storageWithSlots(staleStorageAfterApply.state, restoredSlots)
      yield* coordinator.commit({
        expectedRevision: staleStorageAfterApply.revision,
        expectedDimensions: [],
        changes: [{ ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: noLapisStorage }],
      })
      yield* Ref.set(state.rollSeed, seed)
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'insufficient-lapis', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* drainEnchantmentTableResults(state)
      const [beforeApplyStorage, beforeApplyVitals] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      yield* requestEnchantmentTableApply(state, { requestId: 'insufficient-lapis', tableSlot: slot })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* assertRejected(state, 'insufficient-lapis', 'insufficient-lapis')
      const [afterApplyStorage, afterApplyVitals] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      expect(afterApplyStorage.state).toEqual(beforeApplyStorage.state)
      expect(afterApplyVitals.state).toEqual(beforeApplyVitals.state)
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('routes empty slots, duplicate sessions, and pre-enchanted items through the complete production stage list', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      const stages = yield* makeGameplayStagesWithState(state)

      yield* seedTableInputs(null)
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'empty-table-slot', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* assertRejected(state, 'empty-table-slot', 'no-item')

      yield* seedTableInputs('apple')
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'no-table-offers', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([{
        _tag: 'OffersGenerated', requestId: 'no-table-offers', bookshelfCount: 0, offers: [],
      }])
      yield* requestEnchantmentTableApply(state, { requestId: 'no-table-offers', tableSlot: 0 })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* assertRejected(state, 'no-table-offers', 'invalid-offer')

      yield* seedTableInputs()
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)
      const duplicateRequest = {
        requestId: 'duplicate-table-session', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      } as const
      yield* requestEnchantmentTableOffers(state, duplicateRequest)
      yield* requestEnchantmentTableOffers(state, duplicateRequest)
      yield* runFrame(stages, DeltaTimeSecs(0))
      const duplicateResults = yield* drainEnchantmentTableResults(state)
      expect(duplicateResults).toContainEqual({
        _tag: 'OffersGenerated',
        requestId: duplicateRequest.requestId,
        bookshelfCount: 0,
        offers: PINNED_DIAMOND_SWORD_OFFERS,
      })
      expect(duplicateResults).toContainEqual({
        _tag: 'Rejected', requestId: duplicateRequest.requestId, reason: 'duplicate-session',
      })

      const storage = yield* coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema)
      const existingEnchantments = Result.getOrThrow(enchantmentsComponent({ 'minecraft:sharpness': 1 }))
      const components = Result.getOrThrow(itemComponents('diamond_sword', { enchantments: existingEnchantments }))
      const slots: Array<Slot> = [...storage.state.inventory.slots]
      slots[0] = Result.getOrThrow(makeItemStack('diamond_sword', 1, { components }))
      yield* coordinator.commit({
        expectedRevision: storage.revision,
        expectedDimensions: [],
        changes: [{ ownerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID, state: storageWithSlots(storage.state, slots) }],
      })
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'already-enchanted-sword', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* assertRejected(state, 'already-enchanted-sword', 'already-enchanted')
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('rejects queued enchanting requests for a dead player through the complete production stage list', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()
      const vitals = yield* coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)
      const deadVitals = Schema.decodeUnknownSync(ExperienceOrbVitalsOwnerSnapshotSchema)({
        vitals: { ...vitals.state.vitals, healthPoints: 0 },
      })
      yield* coordinator.commit({
        expectedRevision: vitals.revision,
        expectedDimensions: [],
        changes: [{ ownerId: GAMEPLAY_VITALS_OWNER_ID, state: deadVitals }],
      })
      const stages = yield* makeGameplayStagesWithState(state)
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'dead-player-offers', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* requestEnchantmentTableApply(state, {
        requestId: 'dead-player-apply', tableSlot: MULTI_ENCHANTMENT_SLOT,
      })

      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([
        { _tag: 'Rejected', requestId: 'dead-player-offers', reason: 'player-dead' },
        { _tag: 'Rejected', requestId: 'dead-player-apply', reason: 'player-dead' },
      ])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('reports an authoritative revision conflict from the production enchanting transaction', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()
      const rejectingCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        commit: (request) => {
          const owners = request.changes.map(({ ownerId }) => ownerId)
          if (
            owners.includes(GAMEPLAY_PLAYER_STORAGE_OWNER_ID) &&
            owners.includes(GAMEPLAY_VITALS_OWNER_ID)
          ) {
            const actual = Result.getOrThrow(Schema.decodeUnknownResult(WorldRevisionSchema)(
              Number(request.expectedRevision) + 1,
            ))
            return Effect.fail(new WorldRevisionConflict({ expected: request.expectedRevision, actual }))
          }
          return coordinator.commit(request)
        },
      }
      const stages = yield* makeGameplayStagesWithState(state).pipe(
        Effect.provideService(WorldCommitCoordinator, rejectingCoordinator),
      )
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'transaction-conflict', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* drainEnchantmentTableResults(state)
      const [storageBeforeApply, vitalsBeforeApply] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      yield* requestEnchantmentTableApply(state, {
        requestId: 'transaction-conflict', tableSlot: MULTI_ENCHANTMENT_SLOT,
      })

      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainEnchantmentTableResults(state)).toContainEqual({
        _tag: 'Rejected', requestId: 'transaction-conflict', reason: 'transaction-failed',
      })
      expect(yield* coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema))
        .toMatchObject({ state: storageBeforeApply.state })
      expect(yield* coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema))
        .toMatchObject({ state: vitalsBeforeApply.state })
      expect(yield* Ref.get(state.operationFailures)).toMatchObject([{
        _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse',
        error: { _tag: 'WorldRevisionConflict' },
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('reports owner snapshot failures for production offers and apply requests', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()
      let failStorageSnapshot = true
      const snapshotFailingCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        snapshot: (ownerId, schema) => {
          if (ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID && failStorageSnapshot) {
            failStorageSnapshot = false
            return Effect.fail(new ReplicatedOwnerUnknown({ ownerId }))
          }
          return coordinator.snapshot(ownerId, schema)
        },
      }
      const failedOffersStages = yield* makeGameplayStagesWithState(state).pipe(
        Effect.provideService(WorldCommitCoordinator, snapshotFailingCoordinator),
      )
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'offer-snapshot-failure', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(failedOffersStages, DeltaTimeSecs(0))
      yield* assertRejected(state, 'offer-snapshot-failure', 'transaction-failed')
      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      }))

      const stages = yield* makeGameplayStagesWithState(state)
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'apply-snapshot-failure', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      yield* drainEnchantmentTableResults(state)

      failStorageSnapshot = true
      const failedApplyStages = yield* makeGameplayStagesWithState(state).pipe(
        Effect.provideService(WorldCommitCoordinator, snapshotFailingCoordinator),
      )
      yield* requestEnchantmentTableApply(state, {
        requestId: 'apply-snapshot-failure', tableSlot: MULTI_ENCHANTMENT_SLOT,
      })
      yield* runFrame(failedApplyStages, DeltaTimeSecs(0))
      yield* assertRejected(state, 'apply-snapshot-failure', 'transaction-failed')
      expect(yield* Ref.get(state.operationFailures)).toContainEqual(expect.objectContaining({
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
      }))
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('rejects offers without advancing the roll seed when no enchanting table is at the position', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const store = yield* ChunkStore
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()
      // Other stages draw from the roll seed, so only interactions runs here.
      const stages = (yield* makeGameplayStagesWithState(state))
        .filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)
      yield* store.setBlock(TABLE_BLOCK_POSITION, AIR_BLOCK_ID)
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)

      yield* requestEnchantmentTableOffers(state, {
        requestId: 'no-table', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([{
        _tag: 'Rejected', requestId: 'no-table', reason: 'table-missing',
      }])
      expect(yield* Ref.get(state.rollSeed)).toBe(ENCHANTMENT_TABLE_SEED)
      expect(yield* Ref.get(state.operationFailures)).toStrictEqual([])

      yield* requestEnchantmentTableApply(state, { requestId: 'no-table', tableSlot: MULTI_ENCHANTMENT_SLOT })
      yield* runFrame(stages, DeltaTimeSecs(0))
      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([{
        _tag: 'Rejected', requestId: 'no-table', reason: 'session-not-found',
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('rejects offers when a different block occupies the table position', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const store = yield* ChunkStore
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()
      // Other stages draw from the roll seed, so only interactions runs here.
      const stages = (yield* makeGameplayStagesWithState(state))
        .filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)
      yield* store.setBlock(TABLE_BLOCK_POSITION, STONE)
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)

      yield* requestEnchantmentTableOffers(state, {
        requestId: 'stone-table', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([{
        _tag: 'Rejected', requestId: 'stone-table', reason: 'table-missing',
      }])
      expect(yield* Ref.get(state.rollSeed)).toBe(ENCHANTMENT_TABLE_SEED)
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('closes the session without applying when the table is removed before apply', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const store = yield* ChunkStore
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      yield* seedTableInputs()
      const stages = yield* makeGameplayStagesWithState(state)
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)

      yield* requestEnchantmentTableOffers(state, {
        requestId: 'table-removed', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))
      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([{
        _tag: 'OffersGenerated',
        requestId: 'table-removed',
        bookshelfCount: 0,
        offers: PINNED_DIAMOND_SWORD_OFFERS,
      }])

      yield* store.setBlock(TABLE_BLOCK_POSITION, AIR_BLOCK_ID)
      const [storageBeforeApply, vitalsBeforeApply] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      yield* requestEnchantmentTableApply(state, { requestId: 'table-removed', tableSlot: MULTI_ENCHANTMENT_SLOT })
      yield* runFrame(stages, DeltaTimeSecs(0))
      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([{
        _tag: 'Rejected', requestId: 'table-removed', reason: 'table-missing',
      }])
      const [storageAfterApply, vitalsAfterApply] = yield* Effect.all([
        coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      expect(storageAfterApply.state).toEqual(storageBeforeApply.state)
      expect(vitalsAfterApply.state).toEqual(vitalsBeforeApply.state)

      // Restoring the table shows the session itself was closed, not merely blocked.
      yield* store.setBlock(TABLE_BLOCK_POSITION, ENCHANTING_TABLE)
      yield* requestEnchantmentTableApply(state, { requestId: 'table-removed', tableSlot: MULTI_ENCHANTMENT_SLOT })
      yield* runFrame(stages, DeltaTimeSecs(0))
      expect(yield* drainEnchantmentTableResults(state)).toStrictEqual([{
        _tag: 'Rejected', requestId: 'table-removed', reason: 'session-not-found',
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('validates public requests for block positions and adjacent boundaries', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      yield* Effect.promise(() => FastCheck.assert(
        FastCheck.asyncProperty(
          FastCheck.tuple(
            FastCheck.integer({ min: -30_000_000, max: 30_000_000 }),
            FastCheck.integer({ min: -2048, max: 2048 }),
            FastCheck.integer({ min: -30_000_000, max: 30_000_000 }),
          ),
          FastCheck.integer({ min: 0, max: 35 }),
          FastCheck.integer({ min: 1, max: 35 }),
          async ([x, y, z], itemSlot, offset) => {
            const lapisSlot = (itemSlot + offset) % 36
            const tablePosition = { x, y, z }
            const result = await Effect.runPromiseExit(requestEnchantmentTableOffers(state, {
              requestId: `property-${x}-${y}-${z}-${itemSlot}-${offset}`,
              itemSlot,
              lapisSlot,
              tablePosition,
            }))
            expect(Exit.isSuccess(result)).toBe(true)
            expect(Schema.is(GameplayEnchantmentTableOffersRequestSchema)({
              requestId: 'property-schema', itemSlot, lapisSlot, tablePosition,
            })).toBe(true)
          },
        ),
      ))
      yield* Effect.promise(() => FastCheck.assert(
        FastCheck.asyncProperty(FastCheck.anything(), async (input: unknown) => {
          const exit = await Effect.runPromiseExit(requestEnchantmentTableOffers(state, input))
          return Exit.isSuccess(exit)
            ? Schema.is(GameplayEnchantmentTableOffersRequestSchema)(input)
            : Exit.hasFails(exit)
        }),
      ))
      yield* Effect.promise(() => FastCheck.assert(
        FastCheck.asyncProperty(FastCheck.integer({ min: 0, max: 2 }), async (tableSlot) => {
          const exit = await Effect.runPromiseExit(requestEnchantmentTableApply(state, {
            requestId: `apply-property-${tableSlot}`,
            tableSlot,
          }))
          expect(Exit.isSuccess(exit)).toBe(true)
          expect(Schema.is(GameplayEnchantmentTableApplyRequestSchema)({
            requestId: 'apply-property-schema', tableSlot,
          })).toBe(true)
        }),
      ))
      yield* Effect.promise(() => FastCheck.assert(
        FastCheck.asyncProperty(FastCheck.anything(), async (input: unknown) => {
          const exit = await Effect.runPromiseExit(requestEnchantmentTableApply(state, input))
          return Exit.isSuccess(exit)
            ? Schema.is(GameplayEnchantmentTableApplyRequestSchema)(input)
            : Exit.hasFails(exit)
        }),
      ))
      const invalidTablePosition = FastCheck.oneof(
        FastCheck.constant({ x: 0.5, y: 64, z: 0 }),
        FastCheck.constant({ x: 0, y: Number.NaN, z: 0 }),
        FastCheck.constant({ x: 0, y: 64, z: Number.POSITIVE_INFINITY }),
        FastCheck.constant({ x: '0', y: 64, z: 0 }),
      )
      const invalidInventorySlot = FastCheck.oneof(
        FastCheck.integer({ min: -1_000, max: -1 }),
        FastCheck.integer({ min: 36, max: 1_000 }),
      )
      const invalidOffersRequest = FastCheck.oneof(
        invalidTablePosition.map((tablePosition) => ({
          requestId: 'invalid-position-property', itemSlot: 0, lapisSlot: 1, tablePosition,
        })),
        invalidInventorySlot.map((itemSlot) => ({
          requestId: 'invalid-item-slot-property', itemSlot, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
        })),
        invalidInventorySlot.map((lapisSlot) => ({
          requestId: 'invalid-lapis-slot-property', itemSlot: 0, lapisSlot, tablePosition: ENCHANTMENT_TABLE_POSITION,
        })),
      )
      yield* Effect.promise(() => FastCheck.assert(
        FastCheck.asyncProperty(invalidOffersRequest, async (request) => {
          const exit = await Effect.runPromiseExit(requestEnchantmentTableOffers(state, request))
          expect(Exit.isFailure(exit)).toBe(true)
          expect(Schema.is(GameplayEnchantmentTableOffersRequestSchema)(request)).toBe(false)
        }),
      ))
      const invalidTableSlot = FastCheck.oneof(
        FastCheck.integer({ min: -1_000, max: -1 }),
        FastCheck.integer({ min: 3, max: 1_000 }),
      )
      yield* Effect.promise(() => FastCheck.assert(
        FastCheck.asyncProperty(invalidTableSlot, async (tableSlot) => {
          const request = { requestId: 'invalid-table-slot-property', tableSlot }
          const exit = await Effect.runPromiseExit(requestEnchantmentTableApply(state, request))
          expect(Exit.isFailure(exit)).toBe(true)
          expect(Schema.is(GameplayEnchantmentTableApplyRequestSchema)(request)).toBe(false)
        }),
      ))
      for (const coordinate of [0, Number.MAX_SAFE_INTEGER]) {
        const exit = yield* Effect.exit(requestEnchantmentTableOffers(state, {
          requestId: `position-boundary-${coordinate}`,
          itemSlot: 0,
          lapisSlot: 1,
          tablePosition: { x: coordinate, y: 0, z: 0 },
        }))
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      for (const coordinate of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const exit = yield* Effect.exit(requestEnchantmentTableOffers(state, {
          requestId: `position-outside-${coordinate}`,
          itemSlot: 0,
          lapisSlot: 1,
          tablePosition: { x: coordinate, y: 0, z: 0 },
        }))
        expect(Exit.isFailure(exit)).toBe(true)
      }
      for (const [itemSlot, lapisSlot] of [[0, 35], [35, 0]] as const) {
        const exit = yield* Effect.exit(requestEnchantmentTableOffers(state, {
          requestId: `slot-boundary-${itemSlot}-${lapisSlot}`,
          itemSlot,
          lapisSlot,
          tablePosition: ENCHANTMENT_TABLE_POSITION,
        }))
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      for (const [itemSlot, lapisSlot] of [[-1, 0], [36, 0], [0, -1], [0, 36]] as const) {
        const exit = yield* Effect.exit(requestEnchantmentTableOffers(state, {
          requestId: `slot-outside-${itemSlot}-${lapisSlot}`,
          itemSlot,
          lapisSlot,
          tablePosition: ENCHANTMENT_TABLE_POSITION,
        }))
        expect(Exit.isFailure(exit)).toBe(true)
      }
      for (const tableSlot of [0, 2]) {
        const exit = yield* Effect.exit(requestEnchantmentTableApply(state, {
          requestId: `table-slot-boundary-${tableSlot}`,
          tableSlot,
        }))
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      for (const tableSlot of [-1, 3]) {
        const exit = yield* Effect.exit(requestEnchantmentTableApply(state, {
          requestId: `table-slot-outside-${tableSlot}`,
          tableSlot,
        }))
        expect(Exit.isFailure(exit)).toBe(true)
      }
    }),
  )
})

const BOOKSHELF = Option.getOrThrow(blockIdOf('bookshelf'))
// Not in the kernel registry, so mc-sim cannot map it to an enchanting power.
const UNREGISTERED_BLOCK = BlockId(4_000)
const TABLE_Y = ENCHANTMENT_TABLE_POSITION.y
const RING_DIRECTIONS = [[-2, -2], [-2, 0], [-2, 2], [0, -2], [0, 2], [2, -2], [2, 0], [2, 2]] as const
const cellAt = (x: number, y: number, z: number) => blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))
const shelvesAt = (directions: ReadonlyArray<readonly [number, number]>, scale: number) =>
  directions.flatMap(([dx, dz]) => [TABLE_Y, TABLE_Y + 1].map((y) =>
    [cellAt((dx / 2) * scale, y, (dz / 2) * scale), BOOKSHELF] as const))
const gapsOf = ([dx, dz]: readonly [number, number], block: BlockId) =>
  [TABLE_Y, TABLE_Y + 1].map((y) => [cellAt(dx / 2, y, dz / 2), block] as const)

const offerEntriesFor = (bookshelfCount: number, seed = ENCHANTMENT_TABLE_SEED) =>
  Result.getOrThrow(generateEnchantmentTableOffers({
    item: 'diamond_sword',
    bookshelfCount,
    random: enchantmentTableRandomForSeed(Result.getOrThrow(RandomSeed.result(seed))),
  })).flatMap((offer, slot) => offer === undefined ? [] : [{ slot, offer }])

const interactionsOnly = (stages: ReadonlyArray<StageRegistration>) =>
  stages.filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)

const requestTableOffers = (
  state: Parameters<typeof drainEnchantmentTableResults>[0],
  stages: Parameters<typeof runFrame>[0],
  requestId: string,
  tablePosition: Readonly<{ x: number; y: number; z: number }> = ENCHANTMENT_TABLE_POSITION,
) => Effect.gen(function* () {
  yield* requestEnchantmentTableOffers(state, { requestId, itemSlot: 0, lapisSlot: 1, tablePosition })
  yield* runFrame(stages, DeltaTimeSecs(0))
  return yield* drainEnchantmentTableResults(state)
})

const offersForLayout = (
  layout: ReadonlyArray<readonly [ReturnType<typeof cellAt>, BlockId]>,
  requestId: string,
) => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const store = yield* ChunkStore
  for (const [position, block] of layout) yield* store.setBlock(position, block)
  const state = yield* makeGameplayFrameStateForOwner({ coordinator, vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID })
  yield* seedTableInputs()
  // Other stages draw from the roll seed, so only interactions runs here.
  const stages = interactionsOnly(yield* makeGameplayStagesWithState(state))
  yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)
  return yield* requestTableOffers(state, stages, requestId)
})

const interactionsWithService = (
  state: Parameters<typeof drainEnchantmentTableResults>[0],
  override: (real: EnchantmentTableServiceApi) => Partial<EnchantmentTableServiceApi>,
) => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const store = yield* ChunkStore
  const roster = yield* entityManagerTag<MobBehaviour>()
  const time = yield* TimeService
  const real = yield* makeEnchantmentTableService()
  bindEnchantmentTableService(state, { ...real, ...override(real) })
  return interactionsOnly(gameplayStages(state, store, roster, undefined, undefined, time, undefined, undefined, {}, {
    coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  }))
})

describe('enchanting table bookshelves counted from the world', () => {
  it.effect('counts no bookshelves around a bare table', () =>
    Effect.gen(function* () {
      expect(yield* offersForLayout([], 'bare-table')).toStrictEqual([{
        _tag: 'OffersGenerated', requestId: 'bare-table', bookshelfCount: 0, offers: offerEntriesFor(0),
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('caps sixteen ring bookshelves at fifteen', () =>
    Effect.gen(function* () {
      expect(yield* offersForLayout(shelvesAt(RING_DIRECTIONS, 2), 'full-ring')).toStrictEqual([{
        _tag: 'OffersGenerated', requestId: 'full-ring', bookshelfCount: 15, offers: offerEntriesFor(15),
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('skips both shelves of a direction whose gap holds stone', () =>
    Effect.gen(function* () {
      const layout = [...shelvesAt(RING_DIRECTIONS, 2), ...gapsOf(RING_DIRECTIONS[6], STONE)]
      expect(yield* offersForLayout(layout, 'blocked-direction')).toStrictEqual([{
        _tag: 'OffersGenerated', requestId: 'blocked-direction', bookshelfCount: 14, offers: offerEntriesFor(14),
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('does not count bookshelves three blocks from the table', () =>
    Effect.gen(function* () {
      expect(yield* offersForLayout(shelvesAt(RING_DIRECTIONS, 3), 'distant-shelves')).toStrictEqual([{
        _tag: 'OffersGenerated', requestId: 'distant-shelves', bookshelfCount: 0, offers: offerEntriesFor(0),
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('generates the same offers for the same seed and layout', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const store = yield* ChunkStore
      for (const [position, block] of shelvesAt(RING_DIRECTIONS.slice(0, 3), 2)) yield* store.setBlock(position, block)
      const state = yield* makeGameplayFrameStateForOwner({ coordinator, vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID })
      yield* seedTableInputs()
      const stages = interactionsOnly(yield* makeGameplayStagesWithState(state))
      const results = []
      for (const requestId of ['repeat-first', 'repeat-second']) {
        yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)
        results.push(yield* requestTableOffers(state, stages, requestId))
      }
      const expected = (requestId: string) => [{
        _tag: 'OffersGenerated', requestId, bookshelfCount: 6, offers: offerEntriesFor(6),
      }]
      expect(results).toStrictEqual([expected('repeat-first'), expected('repeat-second')])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('pre-reads every position the bookshelf counting rule can ask for', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const store = yield* ChunkStore
      const reads = new Set<string>()
      const recordingStore: ChunkStoreApi = {
        ...store,
        getBlock: (position) => {
          reads.add(blockKey(position))
          return store.getBlock(position)
        },
      }
      const state = yield* makeGameplayFrameStateForOwner({ coordinator, vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID })
      yield* seedTableInputs()
      const stages = interactionsOnly(yield* makeGameplayStagesWithState(state).pipe(
        Effect.provideService(ChunkStore, recordingStore),
      ))
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)
      expect(yield* requestTableOffers(state, stages, 'recorded-reads')).toMatchObject([{ _tag: 'OffersGenerated' }])

      // Air gaps make mc-sim's rule ask for every shelf cell as well.
      const asked = new Set<string>()
      Result.getOrThrow(countEnchantmentTableBookshelves({
        tablePosition: TABLE_BLOCK_POSITION,
        blockIdAt: (position) => {
          asked.add(blockKey(position))
          return AIR_BLOCK_ID
        },
      }))
      expect(asked.size).toBe(32)
      expect([...asked].filter((key) => !reads.has(key))).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('refuses offers without advancing the seed when a ring position is unreadable', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const store = yield* ChunkStore
      const unreadable = cellAt(2, TABLE_Y + 1, 2)
      const partialStore: ChunkStoreApi = {
        ...store,
        getBlock: (position) => blockKey(position) === blockKey(unreadable)
          ? Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
          : store.getBlock(position),
      }
      const state = yield* makeGameplayFrameStateForOwner({ coordinator, vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID })
      yield* seedTableInputs()
      const stages = interactionsOnly(yield* makeGameplayStagesWithState(state).pipe(
        Effect.provideService(ChunkStore, partialStore),
      ))
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)

      for (const requestId of ['unloaded-first', 'unloaded-second']) {
        expect(yield* requestTableOffers(state, stages, requestId)).toStrictEqual([{
          _tag: 'Rejected', requestId, reason: 'table-area-unloaded',
        }])
      }

      expect(yield* Ref.get(state.rollSeed)).toBe(ENCHANTMENT_TABLE_SEED)
      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual([{
        _tag: 'WorldDataFailure',
        source: 'EnchantmentTable',
        operation: 'ReadBlock',
        position: unreadable,
        reason: { _tag: 'ChunkNotLoaded', position: unreadable },
      }])
      expect(yield* Ref.get(state.operationFailures)).toStrictEqual([])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('refuses offers without advancing the seed when the ring leaves the safe integer range', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const farTable = { x: Number.MAX_SAFE_INTEGER - 1, y: TABLE_Y, z: 0 } as const
      const farTablePosition = cellAt(farTable.x, farTable.y, farTable.z)
      const farStore = yield* makeChunkStoreDouble(
        world([[farTablePosition, ENCHANTING_TABLE]]),
        [chunkKeyOf(farTablePosition)],
      )
      const state = yield* makeGameplayFrameStateForOwner({ coordinator, vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID })
      yield* seedTableInputs()
      const stages = interactionsOnly(yield* makeGameplayStagesWithState(state).pipe(
        Effect.provideService(ChunkStore, farStore.api),
      ))
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)

      expect(yield* requestTableOffers(state, stages, 'unsafe-ring', farTable)).toStrictEqual([{
        _tag: 'Rejected', requestId: 'unsafe-ring', reason: 'offer-generation-failed',
      }])
      expect(yield* Ref.get(state.rollSeed)).toBe(ENCHANTMENT_TABLE_SEED)
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('rejects offers mc-sim cannot count without recording a stage failure', () =>
    Effect.gen(function* () {
      const results = yield* offersForLayout(gapsOf(RING_DIRECTIONS[0], UNREGISTERED_BLOCK), 'unregistered-gap')
      expect(results).toStrictEqual([{
        _tag: 'Rejected', requestId: 'unregistered-gap', reason: 'offer-generation-failed',
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('records a non-rule service failure and reports the transaction as failed', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({ coordinator, vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID })
      yield* seedTableInputs()
      const revision = Result.getOrThrow(Schema.decodeUnknownResult(WorldRevisionSchema)(1))
      const stages = yield* interactionsWithService(state, () => ({
        generateOffers: () => Effect.fail(new WorldRevisionConflict({ expected: revision, actual: revision })),
      }))
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)

      expect(yield* requestTableOffers(state, stages, 'service-conflict')).toStrictEqual([{
        _tag: 'Rejected', requestId: 'service-conflict', reason: 'transaction-failed',
      }])
      expect(yield* Ref.get(state.operationFailures)).toMatchObject([{
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'ItemUse',
        requestId: 'service-conflict',
        error: { _tag: 'WorldRevisionConflict' },
      }])
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )

  it.effect('treats a service read outside the pre-read ring as a defect, not as a default block', () =>
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const state = yield* makeGameplayFrameStateForOwner({ coordinator, vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID })
      yield* seedTableInputs()
      const outsideRing = cellAt(3, TABLE_Y, 0)
      const stages = yield* interactionsWithService(state, (real) => ({
        generateOffers: (request) => Effect.flatMap(
          Effect.sync(() => request.blockIdAt(outsideRing)),
          () => real.generateOffers(request),
        ),
      }))
      yield* Ref.set(state.rollSeed, ENCHANTMENT_TABLE_SEED)
      yield* requestEnchantmentTableOffers(state, {
        requestId: 'outside-ring', itemSlot: 0, lapisSlot: 1, tablePosition: ENCHANTMENT_TABLE_POSITION,
      })

      const exit = yield* Effect.exit(runFrame(stages, DeltaTimeSecs(0)))
      expect(Exit.hasDies(exit)).toBe(true)
      const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(defect).toBeInstanceOf(Error)
      expect(defect).toMatchObject({ message: expect.stringContaining('not pre-read at 3,64,0') })
    }).pipe(Effect.provide(Layer.orDie(productionWorld))),
  )
})
