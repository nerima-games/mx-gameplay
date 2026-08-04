import { describe, expect, it } from 'vitest'
import {
  emptyVillagerTradeState,
  isValidVillagerTradeState,
  makeVillager,
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
})
