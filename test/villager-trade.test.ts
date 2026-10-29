import { describe, expect, it } from 'vitest'
import { Effect, Ref, Result, Schema } from 'effect'
import { DeltaTimeSecs, EntityHealthPoints, StackCount, WorldIdSchema, type ItemType } from '@nerima-games/mc-kernel'
import {
  durabilityForItem,
  emptyPlayerStorage,
  itemStack as makeItemStack,
  makeEntityManager,
  makeTimeService,
  makeWorldCommitCoordinator,
  PlayerStorageSnapshotSchema,
  SPAWN_VITALS,
  type PlayerStorage,
  type Vitals,
} from '@nerima-games/mc-sim'
import {
  addVillager,
  advanceVillagerRestock,
  copyVillagerTradeState,
  emptyVillagerTradeState,
  isValidVillagerTradeState,
  makeVillager,
  VILLAGER_RESTOCK_INTERVAL_SECS,
  useVillagerOffer,
  type VillagerTradeState,
} from '../src/domain/villager-trade'
import {
  drainVillagerTradeResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestVillagerTrade,
} from '../src/stages/registration.js'
import {
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayVillagerTradeSnapshotSchema,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { FrameServicesLayer } from './support/frame-services.js'
import { makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { world } from './support/chunk-store-double.js'

const TRADE_STAGE_WORLD = Schema.decodeUnknownSync(WorldIdSchema)('villager-trade-stage-tests')

const storageFilledWith = (items: ReadonlyArray<ItemType>): PlayerStorage => {
  const empty = emptyPlayerStorage()
  const slots = empty.inventory.slots.map((_, index) => {
    const item = items[index]
    return item === undefined
      ? undefined
      : Result.getOrThrow(makeItemStack(item, StackCount(64)))
  })
  return {
    ...empty,
    inventory: { ...empty.inventory, slots },
    inventoryDurability: slots.map((slot) => slot === undefined ? null : durabilityForItem(slot.item)),
  }
}

const makeTradeStageHarness = (options: Readonly<{
  readonly trades: VillagerTradeState
  readonly storage?: PlayerStorage
  readonly vitals?: Vitals
  readonly withCommit?: boolean
}>) => Effect.gen(function* () {
  const store = yield* makeTransactionalChunkStoreDouble(world([]), ['0,0'])
  const coordinator = yield* makeWorldCommitCoordinator({
    world: TRADE_STAGE_WORLD,
    owners: gameplayOwnerRegistrations({
      villagerTrades: options.trades,
      ...(options.storage === undefined ? {} : { playerStorage: options.storage }),
      ...(options.vitals === undefined ? {} : { vitals: options.vitals }),
    }),
    chunkStores: { forDimension: () => store.api },
  })
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const roster = yield* makeEntityManager<MobBehaviour>()
  const time = yield* makeTimeService()
  const commit = options.withCommit === false
    ? undefined
    : {
        coordinator,
        playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
        playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
        villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      }
  const interactions = gameplayStages(
    state,
    store.api,
    roster,
    undefined,
    undefined,
    time,
    undefined,
    undefined,
    {},
    commit,
  ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)!
  return {
    state,
    coordinator,
    run: () => Effect.runPromise(interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))),
  }
})

describe('villager trade state validation', () => {
  it('accepts generated snapshots and rejects broken trade invariants', () => {
    const villager = makeVillager('farmer-1', 'farmer')

    expect(isValidVillagerTradeState(emptyVillagerTradeState())).toBe(true)
    expect(isValidVillagerTradeState({
      villagers: [villager],
      restockElapsedSecs: 0,
    })).toBe(true)
    expect(isValidVillagerTradeState({
      villagers: [villager, villager],
      restockElapsedSecs: 0,
    })).toBe(false)
    expect(isValidVillagerTradeState({
      villagers: [{
        ...villager,
        offers: [{
          ...villager.offers[0]!,
          input: { item: 'not_an_item', count: 1 },
        }],
      }],
      restockElapsedSecs: 0,
    })).toBe(false)
    expect(isValidVillagerTradeState({
      villagers: [villager],
      restockElapsedSecs: 300,
    })).toBe(false)
  })

  it('checks the second profession clause and rejects an unknown one', () => {
    // The farmer case alone short-circuits the `||` before it evaluates the
    // toolsmith clause. A toolsmith villager forces the right side, and an
    // invalid profession forces it to fail too.
    const toolsmith = makeVillager('toolsmith-1', 'toolsmith')
    expect(isValidVillagerTradeState({ villagers: [toolsmith], restockElapsedSecs: 0 })).toBe(true)

    const farmer = makeVillager('farmer-1', 'farmer')
    expect(isValidVillagerTradeState({
      villagers: [{ ...farmer, profession: 'wizard' }],
      restockElapsedSecs: 0,
    })).toBe(false)
  })
})

describe('useVillagerOffer', () => {
  it('refuses an unknown villager, an unknown offer, and an offer at max uses', () => {
    const villager = makeVillager('farmer-1', 'farmer')
    const offer = villager.offers[0]!
    const state = addVillager(emptyVillagerTradeState(), villager)

    expect(useVillagerOffer(state, 'no-such-villager', offer.id)).toBeUndefined()
    expect(useVillagerOffer(state, villager.id, 'no-such-offer')).toBeUndefined()

    let exhausted = state
    for (let used = 0; used < offer.maxUses; used += 1) {
      exhausted = useVillagerOffer(exhausted, villager.id, offer.id)!
    }
    expect(useVillagerOffer(exhausted, villager.id, offer.id)).toBeUndefined()
  })

  it('leaves every OTHER villager untouched when one trades', () => {
    // With only one villager in state the "not this villager" arm of the
    // update never fires. A second villager forces it.
    const traded = makeVillager('farmer-1', 'farmer')
    const bystander = makeVillager('farmer-2', 'farmer')
    const offer = traded.offers[0]!
    const state = addVillager(addVillager(emptyVillagerTradeState(), traded), bystander)

    const after = useVillagerOffer(state, traded.id, offer.id)!

    const untouched = after.villagers.find((candidate) => candidate.id === bystander.id)
    expect(untouched).toStrictEqual(bystander)
  })
})

describe('villager restocking and snapshots', () => {
  it('waits for the restock interval, then resets every offer and keeps the remainder', () => {
    const first = makeVillager('farmer-1', 'farmer')
    const second = makeVillager('toolsmith-1', 'toolsmith')
    const firstOffer = first.offers[0]!
    const secondOffer = second.offers[0]!
    const tradedFirst = useVillagerOffer(
      { villagers: [first, second], restockElapsedSecs: 250 },
      first.id,
      firstOffer.id,
    )!
    const tradedBoth = useVillagerOffer(tradedFirst, second.id, secondOffer.id)!

    const waiting = advanceVillagerRestock(tradedBoth, 49)
    expect(waiting.restockElapsedSecs).toBe(299)
    expect(waiting.villagers[0]?.offers[0]?.uses).toBe(1)
    expect(waiting.villagers[1]?.offers[0]?.uses).toBe(1)

    const restocked = advanceVillagerRestock(tradedBoth, 55)
    expect(restocked.restockElapsedSecs).toBe(5)
    expect(restocked.villagers.flatMap((villager) => villager.offers).every((offer) => offer.uses === 0)).toBe(true)
    expect(tradedBoth.villagers[0]?.offers[0]?.uses).toBe(1)
  })

  it('copies the nested offers and their stacks without sharing references', () => {
    const villager = makeVillager('farmer-1', 'farmer')
    const state = { villagers: [villager], restockElapsedSecs: 20 }

    const copied = copyVillagerTradeState(state)

    expect(copied).not.toBe(state)
    expect(copied.villagers).not.toBe(state.villagers)
    expect(copied.villagers[0]).not.toBe(villager)
    expect(copied.villagers[0]?.offers).not.toBe(villager.offers)
    expect(copied.villagers[0]?.offers[0]?.input).not.toBe(villager.offers[0]?.input)
    expect(copied.villagers[0]?.offers[0]?.output).not.toBe(villager.offers[0]?.output)
    expect(copied.restockElapsedSecs).toBe(VILLAGER_RESTOCK_INTERVAL_SECS - 280)
  })
})

describe('villager trade execution in the interactions stage', () => {
  const villager = makeVillager('stage-farmer', 'farmer')
  const offer = villager.offers[0]!
  const trades: VillagerTradeState = { villagers: [villager], restockElapsedSecs: 0 }

  const queueTrade = (state: Parameters<typeof requestVillagerTrade>[0], requestId: string) =>
    requestVillagerTrade(state, { requestId, villagerId: villager.id, offerId: offer.id })

  it('rejects a queued trade when authoritative vitals say the player is dead', async () => {
    const harness = await Effect.runPromise(makeTradeStageHarness({
      trades,
      vitals: { ...SPAWN_VITALS, healthPoints: EntityHealthPoints(0) },
    }))
    const tradesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(queueTrade(harness.state, 'trade-player-dead'))

    await harness.run()

    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([{
      requestId: 'trade-player-dead',
      villagerId: villager.id,
      offerId: offer.id,
      _tag: 'Rejected',
      reason: 'PlayerDead',
    }])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))).toStrictEqual(tradesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingVillagerTrades))).toStrictEqual([])
  })

  it('records an unsupported request when the stage has no commit coordinator', async () => {
    const harness = await Effect.runPromise(makeTradeStageHarness({ trades, withCommit: false }))
    const tradesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(queueTrade(harness.state, 'trade-no-coordinator'))

    await harness.run()

    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toContainEqual({
      _tag: 'Unsupported',
      action: 'VillagerTrade',
      requestId: 'trade-no-coordinator',
      reason: 'WorldCommitCoordinatorUnavailable',
    })
    expect(await Effect.runPromise(Ref.get(harness.state.pendingVillagerTrades))).toStrictEqual([])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))).toStrictEqual(tradesBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('rejects InsufficientItems without committing either owner', async () => {
    const harness = await Effect.runPromise(makeTradeStageHarness({ trades }))
    const tradesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(queueTrade(harness.state, 'trade-insufficient-input'))

    await harness.run()

    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([{
      requestId: 'trade-insufficient-input',
      villagerId: villager.id,
      offerId: offer.id,
      _tag: 'Rejected',
      reason: 'InsufficientItems',
    }])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))).toStrictEqual(tradesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('rejects InventoryFull when the output cannot fit after removing the input', async () => {
    const empty = emptyPlayerStorage()
    const fullInventoryItems = empty.inventory.slots.map((_, index): ItemType =>
      index === 0 ? offer.input.item : 'stone',
    )
    const harness = await Effect.runPromise(makeTradeStageHarness({
      trades,
      storage: storageFilledWith(fullInventoryItems),
    }))
    const tradesBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    await Effect.runPromise(queueTrade(harness.state, 'trade-output-no-space'))

    await harness.run()

    expect(await Effect.runPromise(drainVillagerTradeResults(harness.state))).toStrictEqual([{
      requestId: 'trade-output-no-space',
      villagerId: villager.id,
      offerId: offer.id,
      _tag: 'Rejected',
      reason: 'InventoryFull',
    }])
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
      GameplayVillagerTradeSnapshotSchema,
    ))).toStrictEqual(tradesBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })
})
