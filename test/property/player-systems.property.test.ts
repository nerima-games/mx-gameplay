import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { DeltaTimeSecs, type ItemType } from '@nerima-games/mc-kernel'
import { durabilityForItem } from '@nerima-games/mc-sim'
import {
  BREWING_DURATION_SECS,
  tickBrewingStand,
  type BrewingBottle,
  type BrewingIngredient,
  type PotionType,
} from '../../src/domain/brewing'
import {
  ENCHANTMENT_IDS,
  ENCHANTMENT_REGISTRY,
  decodeEnchantedItem,
  type EnchantedItem,
  type EnchantmentId,
} from '../../src/domain/enchantment'
import { createItemMetadataStore } from '../../src/domain/item-metadata'
import {
  applyStatusEffect,
  emptyStatusEffectState,
  tickStatusEffects,
} from '../../src/domain/status-effect'
import {
  advanceVillagerRestock,
  makeVillager,
  useVillagerOffer,
  VILLAGER_RESTOCK_INTERVAL_SECS,
  type VillagerTradeState,
} from '../../src/domain/villager-trade'

const supportedBrewingRecipes: ReadonlyArray<{
  readonly bottle: BrewingBottle
  readonly ingredient: BrewingIngredient
  readonly output: PotionType
}> = [
  { bottle: 'water_bottle', ingredient: 'nether_wart', output: 'awkward' },
  { bottle: { potion: 'awkward' }, ingredient: 'sugar', output: 'speed' },
  { bottle: { potion: 'awkward' }, ingredient: 'spider_eye', output: 'poison' },
  { bottle: { potion: 'awkward' }, ingredient: 'ghast_tear', output: 'regeneration' },
]

const itemForEnchantment: Readonly<Record<EnchantmentId, ItemType>> = {
  protection: 'iron_helmet',
  sharpness: 'iron_sword',
  efficiency: 'iron_pickaxe',
  unbreaking: 'flint_and_steel',
  fortune: 'diamond_pickaxe',
  power: 'bow',
}

const ironPickaxeWith = (
  id: 'efficiency' | 'unbreaking',
  level: number,
): EnchantedItem => ({
  item: 'iron_pickaxe',
  durability: durabilityForItem('iron_pickaxe'),
  enchantments: [{ id, level }],
})

describe('player systems properties', () => {
  it('does not let a weaker effect replace the active amplifier or its pulse clock', () => {
    // Fails if a weaker reapplication lowers strength, shortens duration, or resets poison cadence.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 8 }),
        FastCheck.integer({ min: 1, max: 300 }),
        FastCheck.integer({ min: 0, max: 300 }),
        (amplifier, durationSecs, extraSecs) => {
          const state = {
            effects: [{
              type: 'poison' as const,
              remainingSecs: durationSecs,
              pulseClockSecs: 0.25,
              amplifier,
            }],
          }
          const refreshed = applyStatusEffect(state, {
            type: 'poison',
            durationSecs: durationSecs + extraSecs,
            amplifier: amplifier - 1,
          })
          const effect = refreshed.effects[0]

          return refreshed.effects.length === 1 &&
            effect?.amplifier === amplifier &&
            effect.remainingSecs === durationSecs &&
            effect.pulseClockSecs === 0.25
        },
      ),
    )
  })

  it('expires a speed effect at its remaining-time boundary', () => {
    // Fails if speed remains active after its full duration or expires before the boundary.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 600 }),
        FastCheck.integer({ min: 0, max: 600 }),
        (durationSecs, elapsedSecs) => {
          const active = applyStatusEffect(emptyStatusEffectState(), {
            type: 'speed',
            durationSecs,
          })
          const tick = tickStatusEffects(active, DeltaTimeSecs(elapsedSecs))
          const shouldRemain = elapsedSecs < durationSecs

          return shouldRemain
            ? tick.state.effects[0]?.remainingSecs === durationSecs - elapsedSecs &&
                tick.movementSpeedMultiplier > 1
            : tick.state.effects.length === 0 && tick.movementSpeedMultiplier === 1
        },
      ),
    )
  })

  it('consumes one fuel and completes every supported brewing recipe', () => {
    // Fails if a valid ingredient produces the wrong potion, skips fuel use, or leaves brewing unfinished.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.constantFrom(...supportedBrewingRecipes),
        FastCheck.integer({ min: 1, max: 10 }),
        ({ bottle, ingredient, output }, fuelUnits) => {
          const loaded = { fuelUnits, bottle, ingredient, brewing: undefined }
          const started = tickBrewingStand(loaded, DeltaTimeSecs(0))
          const finished = tickBrewingStand(started, DeltaTimeSecs(BREWING_DURATION_SECS))

          return started.fuelUnits === fuelUnits - 1 &&
            started.ingredient === undefined &&
            started.brewing?.output === output &&
            finished.bottle !== undefined &&
            finished.bottle !== 'water_bottle' &&
            finished.bottle.potion === output &&
            finished.brewing === undefined
        },
      ),
    )
  })

  it('accepts only registered enchantment levels up to each registry cap', () => {
    // Fails if the item codec admits an over-cap level or rejects a valid compatible level.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.constantFrom(...ENCHANTMENT_IDS),
        FastCheck.integer({ min: 1, max: 6 }),
        (id, level) => {
          const item = itemForEnchantment[id]
          const decoded = decodeEnchantedItem({
            item,
            durability: durabilityForItem(item),
            enchantments: [{ id, level }],
          })

          return decoded.ok === (level <= ENCHANTMENT_REGISTRY[id].maxLevel)
        },
      ),
    )
  })

  it('canonicalizes compatible pickaxe enchantments regardless of input order', () => {
    // Fails if equivalent enchantment sets serialize differently when callers provide a different order.
    const enchantments = [
      { id: 'efficiency', level: 4 },
      { id: 'unbreaking', level: 2 },
      { id: 'fortune', level: 3 },
    ] as const
    const orderings = [
      enchantments,
      [enchantments[0], enchantments[2], enchantments[1]],
      [enchantments[1], enchantments[0], enchantments[2]],
      [enchantments[1], enchantments[2], enchantments[0]],
      [enchantments[2], enchantments[0], enchantments[1]],
      [enchantments[2], enchantments[1], enchantments[0]],
    ] as const

    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: orderings.length - 1 }), (index) => {
        const decoded = decodeEnchantedItem({
          item: 'diamond_pickaxe',
          durability: durabilityForItem('diamond_pickaxe'),
          enchantments: orderings[index],
        })

        return decoded.ok &&
          decoded.value.enchantments.map(({ id }) => id).join(',') ===
            'efficiency,unbreaking,fortune'
      }),
    )
  })

  it('copies item names and enchantments onto a stale target without altering the source', () => {
    // Fails if a slot copy preserves stale target metadata or loses metadata from the source slot.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.string({ maxLength: 20 }),
        FastCheck.string({ maxLength: 20 }),
        FastCheck.integer({ min: 1, max: 3 }),
        FastCheck.integer({ min: 1, max: 5 }),
        (sourceName, targetName, sourceLevel, targetLevel) => {
          const store = createItemMetadataStore()
          const source = ironPickaxeWith('unbreaking', sourceLevel)
          store.customNames.set('source', sourceName)
          store.customNames.set('target', targetName)
          store.customNames.set('other', 'untouched')
          store.enchantedItems.set('source', source)
          store.enchantedItems.set('target', ironPickaxeWith('efficiency', targetLevel))

          store.copyItemMetadata('source', 'target')

          const target = store.enchantedItems.get('target')
          return store.customNames.get('source') === sourceName &&
            store.customNames.get('target') === sourceName &&
            store.customNames.get('other') === 'untouched' &&
            store.enchantedItems.get('source')?.enchantments[0]?.level === sourceLevel &&
            target?.enchantments.length === 1 &&
            target.enchantments[0]?.id === 'unbreaking' &&
            target.enchantments[0]?.level === sourceLevel
        },
      ),
    )
  })

  it('increments one available villager offer without changing its neighbor', () => {
    // Fails if a trade uses the wrong boundary, changes another offer, or mutates the original snapshot.
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: 15 }), (usesSeed) => {
        const villager = makeVillager('property-farmer', 'farmer')
        const [firstOffer, secondOffer] = villager.offers
        if (firstOffer === undefined || secondOffer === undefined) return false
        const uses = usesSeed % firstOffer.maxUses
        const state: VillagerTradeState = {
          villagers: [{
            ...villager,
            offers: [{ ...firstOffer, uses }, secondOffer],
          }],
          restockElapsedSecs: 0,
        }

        const after = useVillagerOffer(state, villager.id, firstOffer.id)
        const updated = after?.villagers[0]
        if (updated === undefined) return false

        return updated?.offers[0]?.uses === uses + 1 &&
          updated.offers[1]?.id === secondOffer.id &&
          updated.offers[1]?.uses === secondOffer.uses &&
          state.villagers[0]?.offers[0]?.uses === uses
      }),
    )
  })

  it('restocks every exhausted offer only after the interval and keeps the remainder', () => {
    // Fails if partial time resets stock early, a completed interval keeps exhausted offers, or excess time is lost.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: VILLAGER_RESTOCK_INTERVAL_SECS - 1 }),
        FastCheck.integer({ min: 0, max: VILLAGER_RESTOCK_INTERVAL_SECS * 3 }),
        FastCheck.integer({ min: 0, max: 16 }),
        (elapsedSecs, deltaSecs, usesSeed) => {
          const villager = makeVillager('property-restock-farmer', 'farmer')
          const offers = villager.offers.map((offer) => ({
            ...offer,
            uses: usesSeed % (offer.maxUses + 1),
          }))
          const state: VillagerTradeState = {
            villagers: [{ ...villager, offers }],
            restockElapsedSecs: elapsedSecs,
          }
          const totalElapsedSecs = elapsedSecs + deltaSecs
          const crossedInterval = totalElapsedSecs >= VILLAGER_RESTOCK_INTERVAL_SECS
          const expectedElapsedSecs = crossedInterval
            ? totalElapsedSecs % VILLAGER_RESTOCK_INTERVAL_SECS
            : totalElapsedSecs
          const after = advanceVillagerRestock(state, deltaSecs)
          const afterOffers = after.villagers.flatMap(({ offers: current }) => current)

          return after.restockElapsedSecs === expectedElapsedSecs &&
            after.restockElapsedSecs >= 0 &&
            after.restockElapsedSecs < VILLAGER_RESTOCK_INTERVAL_SECS &&
            (crossedInterval
              ? afterOffers.every((offer) => offer.uses === 0)
              : afterOffers.every((offer, index) => offer.uses === offers[index]?.uses)) &&
            state.villagers[0]?.offers[0]?.uses === offers[0]?.uses
        },
      ),
    )
  })
})
