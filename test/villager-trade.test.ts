import { describe, expect, it } from 'vitest'
import {
  addVillager,
  advanceVillagerRestock,
  copyVillagerTradeState,
  emptyVillagerTradeState,
  isValidVillagerTradeState,
  makeVillager,
  VILLAGER_RESTOCK_INTERVAL_SECS,
  useVillagerOffer,
} from '../src/domain/villager-trade'

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
