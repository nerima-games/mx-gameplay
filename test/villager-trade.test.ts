import { describe, expect, it } from 'vitest'
import {
  addVillager,
  emptyVillagerTradeState,
  isValidVillagerTradeState,
  makeVillager,
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
