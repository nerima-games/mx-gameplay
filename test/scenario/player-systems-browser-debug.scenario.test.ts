/// <reference lib="dom" />
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  mountGameplayScenario,
  type ScenarioMountContext,
  type ScenarioSnapshot,
} from '../../apps/browser-debug/contract.js'
import {
  playerSystemsBrewingSetup,
  playerSystemsEnchantingSetup,
  playerSystemsFishingSetup,
  playerSystemsVillagerTradeSetup,
} from '../../apps/browser-debug/scenarios/player-systems.js'

const context = (scenarioId: string): ScenarioMountContext => ({
  root: { replaceChildren: () => undefined } as unknown as HTMLElement,
  scenarioId,
  seed: 1,
  time: 6_000,
  weather: 'clear',
})

const perform = (mount: ReturnType<typeof mountGameplayScenario>, actionId: string): void => {
  const action = mount.actions.find((entry) => entry.id === actionId)
  if (action === undefined) throw new Error(`missing scenario action ${actionId}`)
  action.perform(mount.site)
}

const itemCount = (inventory: ScenarioSnapshot['inventory'], item: string): number =>
  inventory.reduce((count, [candidate, amount]) => count + (candidate === item ? amount : 0), 0)

describe('player-system browser debug scenarios', () => {
  it('casts, reaches a bite, reels, and observes the catch in player storage', () => {
    const mount = mountGameplayScenario(context('player-systems-fishing-test'), playerSystemsFishingSetup)
    try {
      perform(mount, 'fishing-cast')
      expect(Effect.runSync(mount.site.observeFishingState()).rods[0]?.phase).toBe('cast')

      perform(mount, 'fishing-advance-to-bite')
      expect(Effect.runSync(mount.site.observeFishingState()).rods[0]?.phase).toBe('bite')

      perform(mount, 'fishing-reel-catch')
      const snapshot = mount.snapshot()
      expect(Effect.runSync(mount.site.observeFishingState()).rods).toStrictEqual([])
      expect(snapshot.equipment).toMatchObject({
        lastCatch: {
          result: { action: 'ReelFishing', success: true, outcome: { _tag: 'Caught' } },
          count: 1,
        },
      })
      const catchResult = (snapshot.equipment as {
        readonly lastCatch?: { readonly item: string }
      }).lastCatch
      if (catchResult === undefined) throw new Error('fishing scenario did not observe its catch')
      expect(itemCount(snapshot.inventory, catchResult.item)).toBe(1)
    } finally {
      mount.dispose()
    }
  })

  it('sets up the real brewing stand with consumed fuel and ingredients', () => {
    const mount = mountGameplayScenario(context('player-systems-brewing-test'), playerSystemsBrewingSetup)
    try {
      perform(mount, 'brewing-load-supplies')
      perform(mount, 'brewing-insert-fuel')
      perform(mount, 'brewing-insert-bottle')
      perform(mount, 'brewing-insert-ingredient')
      const brewing = Effect.runSync(mount.site.observeBrewingState())
      expect(brewing.fuelCharges).toBeGreaterThan(0)
      expect(brewing.bottles[0]).toMatchObject({ item: 'water_bottle', count: 1 })
      expect(brewing.ingredient).toMatchObject({ item: 'nether_wart', count: 1 })
      expect(mount.snapshot().unsupported).toContain(
        'Brewing completion is unavailable: this mounted Site exposes BrewingService but no coordinator-bound frame advance helper.',
      )
    } finally {
      mount.dispose()
    }
  })

  it('applies Efficiency I and observes the enchanted book and consumed lapis', () => {
    const mount = mountGameplayScenario(context('player-systems-enchanting-test'), playerSystemsEnchantingSetup)
    try {
      perform(mount, 'enchanting-prepare-table')
      const before = mount.snapshot()
      expect(itemCount(before.inventory, 'lapis_lazuli')).toBe(1)

      perform(mount, 'enchanting-apply-efficiency')
      const after = mount.snapshot()
      expect(after.equipment).toMatchObject({
        lastEnchantment: {
          item: {
            item: 'enchanted_book',
            count: 1,
            components: { storedEnchantments: { 'minecraft:efficiency': 1 } },
          },
          offer: { levelCost: 1, lapisCost: 1 },
        },
      })
      expect(itemCount(after.inventory, 'lapis_lazuli')).toBe(0)
      expect(itemCount(after.inventory, 'book')).toBe(0)
      expect(itemCount(after.inventory, 'enchanted_book')).toBe(1)
    } finally {
      mount.dispose()
    }
  })

  it('settles a villager offer into player storage and increments its use count', () => {
    const mount = mountGameplayScenario(context('player-systems-villager-trade-test'), playerSystemsVillagerTradeSetup)
    try {
      perform(mount, 'villager-trade-setup')
      const before = mount.snapshot()
      const wheatBefore = itemCount(before.inventory, 'wheat')

      perform(mount, 'villager-trade-execute')
      const after = mount.snapshot()
      expect(itemCount(after.inventory, 'wheat')).toBe(0)
      expect(wheatBefore - itemCount(after.inventory, 'wheat')).toBeGreaterThan(0)
      expect(itemCount(after.inventory, 'emerald')).toBe(1)
      expect(after.equipment).toMatchObject({
        lastTrade: {
          result: { _tag: 'Traded' },
          wheat: { before: wheatBefore, after: 0 },
          emerald: { before: 0, after: 1 },
          uses: 1,
        },
      })
      expect(Effect.runSync(mount.site.observeVillagerTrades()).villagers[0]?.offers
        .find((offer) => offer.input.item === 'wheat')?.uses).toBe(1)
    } finally {
      mount.dispose()
    }
  })
})
