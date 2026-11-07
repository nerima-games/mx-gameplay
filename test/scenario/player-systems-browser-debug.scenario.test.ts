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
  playerSystemsMeleeSetup,
  playerSystemScenarios,
  playerSystemsVillagerTradeSetup,
} from '../../apps/browser-debug/scenarios/player-systems.js'
import { meleeDamageForItem } from '../../src/domain/interactions/melee-attack.js'
import { ZOMBIE_KIND } from '../../src/domain/mob/hostile-combat.js'

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

const expectLivePlayerPose = (mount: ReturnType<typeof mountGameplayScenario>): void => {
  const pose = Effect.runSync(mount.site.observePlayerPose())
  expect(mount.snapshot()).toMatchObject({
    playerPose: pose,
    playerPosition: `${pose.dimension} ${String(pose.position.x)}, ${String(pose.position.y)}, ${String(pose.position.z)}`,
  })
}

describe('player-system browser debug scenarios', () => {
  it('casts, reaches a bite, reels, and observes the catch in player storage', () => {
    const mount = mountGameplayScenario(context('player-systems-fishing-test'), playerSystemsFishingSetup)
    try {
      expectLivePlayerPose(mount)
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

  it('brews an awkward potion through real frames and consumes its fuel and ingredient', () => {
    const mount = mountGameplayScenario(context('player-systems-brewing-test'), playerSystemsBrewingSetup)
    try {
      expectLivePlayerPose(mount)
      perform(mount, 'brewing-load-supplies')
      perform(mount, 'brewing-insert-fuel')
      perform(mount, 'brewing-insert-bottle')
      perform(mount, 'brewing-insert-ingredient')
      const setupState = Effect.runSync(mount.site.observeBrewingState())
      expect(setupState.fuelCharges).toBeGreaterThan(0)
      expect(setupState.bottles[0]).toMatchObject({ item: 'water_bottle', count: 1 })
      expect(setupState.ingredient).toMatchObject({ item: 'nether_wart', count: 1 })

      perform(mount, 'brewing-advance')

      const after = Effect.runSync(mount.site.observeBrewingState())
      expect(after.bottles[0]).toMatchObject({ item: 'awkward_potion', count: 1 })
      expect(after.ingredient).toBeUndefined()
      expect(after.fuelCharges).toBe(setupState.fuelCharges - 1)
      expect(mount.snapshot().unsupported).toStrictEqual([])
      expect(mount.snapshot().equipment).toMatchObject({
        lastBrew: {
          brewed: 1,
          state: {
            fuelCharges: setupState.fuelCharges - 1,
            ingredient: undefined,
          },
        },
      })
    } finally {
      mount.dispose()
    }
  })

  it('applies Efficiency I and observes the enchanted book and consumed lapis', () => {
    const mount = mountGameplayScenario(context('player-systems-enchanting-test'), playerSystemsEnchantingSetup)
    try {
      expectLivePlayerPose(mount)
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
      expectLivePlayerPose(mount)
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

  it('spawns a Mob, attacks it through the targeted primary request, and observes sword wear', () => {
    const mount = mountGameplayScenario(context('player-systems-melee-test'), playerSystemsMeleeSetup)
    try {
      expectLivePlayerPose(mount)
      perform(mount, 'melee-spawn-target')
      const beforeMob = Effect.runSync(mount.site.observeMobs()).find(({ kind }) => kind === ZOMBIE_KIND)
      if (beforeMob === undefined) throw new Error('melee scenario did not spawn a zombie')
      const beforeStorage = Effect.runSync(mount.site.observePlayerStorage())
      const sword = beforeStorage.inventory.slots[0]
      const beforeDurability = beforeStorage.inventoryDurability[0]
      if (
        sword?.item !== 'iron_sword' ||
        beforeDurability === null ||
        beforeDurability === undefined
      ) {
        throw new Error('melee scenario did not seed an observable iron sword')
      }
      const expectedDamage = meleeDamageForItem(sword.item)

      perform(mount, 'melee-attack-target')

      const afterMob = Effect.runSync(mount.site.observeMobs()).find(({ id }) => id === beforeMob.id)
      const afterStorage = Effect.runSync(mount.site.observePlayerStorage())
      const afterDurability = afterStorage.inventoryDurability[0]
      if (afterDurability === null || afterDurability === undefined) {
        throw new Error('melee scenario did not retain iron sword durability')
      }
      expect(afterMob?.healthPoints).toBe(beforeMob.healthPoints - expectedDamage)
      expect(afterDurability.current).toBeLessThan(beforeDurability.current)
      expect(afterDurability.max).toBe(beforeDurability.max)
      const observedWear = beforeDurability.current - afterDurability.current
      expect(mount.snapshot().unsupported).toStrictEqual([])
      expect(mount.snapshot().equipment).toMatchObject({
        lastMeleeAttack: {
          health: { damage: expectedDamage },
          swordDurability: { wear: observedWear },
        },
      })
    } finally {
      mount.dispose()
    }
  })

  it('shows the live player dimension and position in the state scenario snapshot', () => {
    const scenario = playerSystemScenarios.find(({ id }) => id === 'player-systems-state')
    if (scenario === undefined) throw new Error('player state scenario is not registered')
    const mount = scenario.mount(context('player-systems-state-pose-test'))
    try {
      expectLivePlayerPose(mount)
      expect(mount.snapshot().unsupported).toStrictEqual([])
    } finally {
      mount.dispose()
    }
  })
})
