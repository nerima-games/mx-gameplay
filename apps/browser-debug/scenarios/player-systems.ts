import {
  AngleRadians,
  BlockAxis,
  DimensionIdSchema,
  InterpolationFraction,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTickSchema,
  blockIdOf,
  blockPosition,
  type ItemType,
  position,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  FishingElapsedTicksSchema,
  FishingWaitTicksSchema,
  SNOWBALL_PROFILE,
  type EnchantmentTableApplyResult,
  type ProjectileLaunch,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Option, Ref, Result, Schema } from 'effect'
import { attemptBedSleep, type BedSleepPlayer } from '../../../src/domain/bed-sleep.js'
import { createExperienceOrbValue } from '../../../src/domain/entities/xp-orb.js'
import { makeVillager } from '../../../src/domain/villager-trade.js'
import {
  getPlayerMovementSpeedMultiplier,
  GameplayBrewingItemUseResultSchema,
  GameplayFishingItemUseResultSchema,
  requestExperienceOrbAbsorption,
  requestStatusEffect,
} from '../../../src/stages/registration.js'
import { stepFrame, type Site } from '../../preview-mining-site/site.js'
import { STONE } from '../../preview-mining-site/world.js'
import { mountGameplayScenario, type ScenarioDefinition, type ScenarioSetup } from '../contract.js'

const TICKS_PER_DAY = 24_000
const BED = Option.getOrThrow(blockIdOf('bed'))
const WATER = Option.getOrThrow(blockIdOf('water'))
const BREWING_STAND = Option.getOrThrow(blockIdOf('brewing_stand'))
const ENCHANTING_TABLE = Option.getOrThrow(blockIdOf('enchanting_table'))
const BED_POSITION = blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(0))
const floor = Array.from({ length: 8 }, (_, x) => [x, 63, STONE] as const)
const previewSleepPlayer: BedSleepPlayer = { dimension: Effect.succeed('overworld') }
const fishingActor = EntityId('browser-debug:player-systems-fisher')
const fishingBobber = Schema.decodeUnknownSync(ProjectileIdSchema)('browser-debug:player-systems-bobber')
const fishingLaunch: ProjectileLaunch = {
  position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: Brand.nominal<ProjectileLaunch['speed']>()(1),
}
const fishingTick = Schema.decodeUnknownSync(SimulationTickSchema)(0)
const fishingWater = { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true } as const
const enchantmentActor = EntityId('browser-debug:player-systems-enchanter')
const enchantmentOrb = EntityId('browser-debug:player-systems-enchantment-xp')
const farmer = makeVillager('browser-debug:player-systems-farmer', 'farmer')
const wheatOffer = farmer.offers.find((offer) => offer.input.item === 'wheat')
if (wheatOffer === undefined) throw new Error('Farmer fixture must expose a wheat offer')
const enchantmentResults = new WeakMap<Site, EnchantmentTableApplyResult>()
const fishingCatchResults = new WeakMap<Site, unknown>()
const villagerTradeResults = new WeakMap<Site, unknown>()
const setGameplayTime = (site: Site, ticks: number): void => {
  const fraction = InterpolationFraction(ticks / TICKS_PER_DAY)
  Effect.runSync(site.time.setTimeOfDay(fraction))
  Effect.runSync(Ref.set(site.state.timeOfDay, fraction))
}

const inventoryItems = (site: Site): ReadonlyArray<readonly [ItemType, number]> => {
  const items: Array<readonly [ItemType, number]> = []
  for (const slot of Effect.runSync(site.inventoryService.api.snapshot).slots) {
    if (slot !== undefined) items.push([slot.item, slot.count])
  }
  return items
}

const syncPlayerStorage = (site: Site): void => {
  Effect.runSync(site.setInventory(inventoryItems(site)))
}

const frame = (site: Site): void => {
  Effect.runSync(stepFrame(site))
}

const fishingResult = (site: Site, requestId: string) => {
  const result = Effect.runSync(site.drainItemUseResults())
    .map((entry) => Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(entry))
    .find((entry) => entry.requestId === requestId)
  if (result === undefined) throw new Error(`missing fishing result for ${requestId}`)
  return result
}

const brewingResult = (
  site: Site,
  requestId: string,
  action: 'InsertBrewingFuel' | 'InsertBrewingBottle' | 'InsertBrewingIngredient',
): void => {
  const result = Effect.runSync(site.drainItemUseResults())
    .map((entry) => Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)(entry))
    .find((entry) => entry.requestId === requestId)
  if (result === undefined || result.action !== action || !result.success) {
    throw new Error(`brewing operation ${requestId} did not succeed`)
  }
}

const inventoryCount = (site: Site, item: ItemType): number => site.inventory.get(item) ?? 0

const unsupported = [
  'Melee combat has no reachable target: this Site does not expose player movement or the entity-owner coordinator.',
  'Player position is unavailable: Site does not expose its preview player pose; the common snapshot currently substitutes a static preview-spawn string.',
]

export const playerSystemsFishingSetup: ScenarioSetup = {
  world: {
    cells: [...floor, [2, 64, WATER] as const],
    loadedChunks: ['0,0'],
    z: 0,
  },
  bounds: { width: 8, height: 66 },
  actions: [
    {
      id: 'fishing-cast',
      label: 'Cast into open water',
      perform: (site) => {
        Effect.runSync(site.setInventory([['fishing_rod', 1]]))
        Effect.runSync(site.requestFishingCast({
          requestId: 'player-systems-fishing-cast',
          actor: fishingActor,
          bobber: fishingBobber,
          tick: fishingTick,
          dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'),
          launch: fishingLaunch,
          profile: SNOWBALL_PROFILE,
          rod: null,
          environment: fishingWater,
        }))
        frame(site)
        const result = fishingResult(site, 'player-systems-fishing-cast')
        if (result.action !== 'CastFishing' || !result.success) {
          throw new Error('fishing cast did not succeed')
        }
        const rod = Effect.runSync(site.observeFishingState()).rods.find((entry) => entry.actor === fishingActor)
        if (rod?.bobber !== fishingBobber || rod.phase !== 'cast') {
          throw new Error('fishing cast was not observed in the Site fishing state')
        }
      },
    },
    {
      id: 'fishing-advance-to-bite',
      label: 'Wait for a bite',
      perform: (site) => {
        Effect.runSync(site.requestFishingAdvance({
          requestId: 'player-systems-fishing-bite',
          actor: fishingActor,
          elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(120),
          waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
          approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
          biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
          environment: { hasWater: true },
        }))
        frame(site)
        const result = fishingResult(site, 'player-systems-fishing-bite')
        if (result.action !== 'AdvanceFishing' || !result.success || result.outcome._tag !== 'Bite') {
          throw new Error('fishing did not reach a bite')
        }
        const rod = Effect.runSync(site.observeFishingState()).rods.find((entry) => entry.actor === fishingActor)
        if (rod?.bobber !== fishingBobber || rod.phase !== 'bite') {
          throw new Error('fishing bite was not observed in the Site fishing state')
        }
      },
    },
    {
      id: 'fishing-reel-catch',
      label: 'Reel in the catch',
      perform: (site) => {
        Effect.runSync(site.requestFishingReel('player-systems-fishing-reel', fishingActor))
        frame(site)
        const result = fishingResult(site, 'player-systems-fishing-reel')
        if (result.action !== 'ReelFishing' || !result.success || result.outcome._tag !== 'Caught') {
          throw new Error('fishing reel did not catch an item')
        }
        const caughtCount = inventoryCount(site, result.outcome.item)
        if (caughtCount < 1) throw new Error(`caught ${result.outcome.item} was not added to player storage`)
        fishingCatchResults.set(site, { result, item: result.outcome.item, count: caughtCount })
        if (Effect.runSync(site.observeFishingState()).rods.length !== 0) {
          throw new Error('fishing rod remained active after a successful catch')
        }
      },
    },
  ],
  observe: (site) => ({
    equipment: {
      fishing: Effect.runSync(site.observeFishingState()),
      lastCatch: fishingCatchResults.get(site),
    },
  }),
}

export const playerSystemsBrewingSetup: ScenarioSetup = {
  world: {
    cells: [...floor, [1, 64, BREWING_STAND] as const],
    loadedChunks: ['0,0'],
    z: 0,
  },
  bounds: { width: 8, height: 66 },
  actions: [
    {
      id: 'brewing-load-supplies',
      label: 'Load blaze powder, water bottle, and nether wart',
      perform: (site) => {
        Effect.runSync(site.setInventory([
          ['blaze_powder', 1],
          ['water_bottle', 1],
          ['nether_wart', 1],
        ]))
        frame(site)
      },
    },
    {
      id: 'brewing-insert-fuel',
      label: 'Insert blaze powder fuel',
      perform: (site) => {
        Effect.runSync(site.insertBrewingFuel('player-systems-brewing-fuel'))
        frame(site)
        brewingResult(site, 'player-systems-brewing-fuel', 'InsertBrewingFuel')
      },
    },
    {
      id: 'brewing-insert-bottle',
      label: 'Insert water bottle',
      perform: (site) => {
        Effect.runSync(site.insertBrewingBottle('player-systems-brewing-bottle', 0, 'water_bottle'))
        frame(site)
        brewingResult(site, 'player-systems-brewing-bottle', 'InsertBrewingBottle')
      },
    },
    {
      id: 'brewing-insert-ingredient',
      label: 'Insert nether wart',
      perform: (site) => {
        Effect.runSync(site.insertBrewingIngredient('player-systems-brewing-ingredient', 'nether_wart'))
        frame(site)
        brewingResult(site, 'player-systems-brewing-ingredient', 'InsertBrewingIngredient')
      },
    },
  ],
  unsupported: [
    'Brewing completion is unavailable: this mounted Site exposes BrewingService but no coordinator-bound frame advance helper.',
  ],
  observe: (site) => ({
    equipment: { brewingStand: Effect.runSync(site.observeBrewingState()) },
  }),
}

export const playerSystemsEnchantingSetup: ScenarioSetup = {
  world: {
    cells: [...floor, [1, 64, ENCHANTING_TABLE] as const],
    loadedChunks: ['0,0'],
    z: 0,
  },
  bounds: { width: 8, height: 66 },
  actions: [
    {
      id: 'enchanting-prepare-table',
      label: 'Prepare table, book, lapis, and experience',
      perform: (site) => {
        Effect.runSync(site.setInventory([['book', 1], ['lapis_lazuli', 1]]))
        Effect.runSync(site.seedExperienceOrbs([{
          id: enchantmentOrb,
          value: Result.getOrThrow(createExperienceOrbValue(1_000)),
        }]))
        Effect.runSync(requestExperienceOrbAbsorption(site.state, {
          actor: enchantmentActor,
          orb: enchantmentOrb,
          tick: 0,
          position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
        }))
        frame(site)
      },
    },
    {
      id: 'enchanting-apply-efficiency',
      label: 'Apply Efficiency I',
      perform: (site) => {
        const result = Effect.runSync(site.requestEnchantmentTableApply({
          itemSlot: 0,
          lapisSlot: 1,
          tableSlot: 0,
          offer: { levelCost: 1, lapisCost: 1, enchantments: [{ id: 'efficiency', level: 1 }] },
        }))
        enchantmentResults.set(site, result)
        frame(site)
        if (
          result.item.item !== 'enchanted_book' ||
          result.item.components?.storedEnchantments?.['minecraft:efficiency'] !== 1
        ) {
          throw new Error('enchantment table did not produce an Efficiency I enchanted book')
        }
        if (inventoryCount(site, 'lapis_lazuli') !== 0) {
          throw new Error('enchantment table did not consume the lapis lazuli')
        }
      },
    },
  ],
  observe: (site) => {
    const result = enchantmentResults.get(site)
    return result === undefined ? {} : { equipment: { lastEnchantment: result } }
  },
}

export const playerSystemsVillagerTradeSetup: ScenarioSetup = {
  world: { cells: floor, loadedChunks: ['0,0'], z: 0 },
  bounds: { width: 8, height: 66 },
  actions: [
    {
      id: 'villager-trade-setup',
      label: 'Set up farmer wheat offer',
      perform: (site) => {
        Effect.runSync(site.setInventory([['wheat', wheatOffer.input.count]]))
        Effect.runSync(site.setVillagerTrades({ villagers: [farmer], restockElapsedSecs: 0 }))
        frame(site)
      },
    },
    {
      id: 'villager-trade-execute',
      label: 'Trade wheat for emerald',
      perform: (site) => {
        Effect.runSync(site.requestVillagerTrade({
          requestId: 'player-systems-farmer-trade',
          villagerId: farmer.id,
          offerId: wheatOffer.id,
        }))
        frame(site)
        const trade = Effect.runSync(site.drainVillagerTradeResults())
          .find((entry) => entry.requestId === 'player-systems-farmer-trade')
        if (trade?._tag !== 'Traded') throw new Error('farmer wheat offer was not traded')
        const usedOffer = Effect.runSync(site.observeVillagerTrades()).villagers
          .find((villager) => villager.id === farmer.id)?.offers
          .find((offer) => offer.id === wheatOffer.id)
        if (usedOffer?.uses !== 1) throw new Error('farmer wheat offer use count did not advance')
        const traded = {
          result: trade,
          wheat: { before: wheatOffer.input.count, after: inventoryCount(site, 'wheat') },
          emerald: { before: 0, after: inventoryCount(site, 'emerald') },
          uses: usedOffer.uses,
        }
        if (
          traded.wheat.before - traded.wheat.after !== wheatOffer.input.count ||
          traded.emerald.after - traded.emerald.before !== wheatOffer.output.count
        ) {
          throw new Error('farmer trade did not settle the expected items')
        }
        villagerTradeResults.set(site, traded)
      },
    },
  ],
  observe: (site) => ({
    equipment: {
      villagerTrades: Effect.runSync(site.observeVillagerTrades()),
      lastTrade: villagerTradeResults.get(site),
    },
  }),
}

export const playerSystemScenarios: ReadonlyArray<ScenarioDefinition> = [
  {
    id: 'player-systems-state',
    title: 'Player state, effects, sleep, and inventory',
    area: 'player-systems',
    isDefault: false,
    mount: (context) => {
      return mountGameplayScenario(context, {
        world: {
          cells: [...floor, [1, 64, BED] as const],
          loadedChunks: ['0,0'],
          z: 0,
        },
        bounds: { width: 8, height: 66 },
        actions: [
          {
            id: 'player-damage',
            label: 'Apply 4 damage (mob cause)',
            perform: (site) => Effect.runSync(
              site.state.survivalHunger.damage({ amount: 4, cause: 'mob' }),
            ),
          },
          {
            id: 'player-heal',
            label: 'Heal 2 health',
            perform: (site) => Effect.runSync(site.state.survivalHunger.heal(2)),
          },
          {
            id: 'player-speed-effect',
            label: 'Request speed effect',
            perform: (site) => Effect.runSync(requestStatusEffect(site.state, { type: 'speed', durationSecs: 30 })),
          },
          {
            id: 'sleep-set-night',
            label: 'Set night for sleep',
            perform: (site) => setGameplayTime(site, 21_600),
          },
          {
            id: 'sleep-until-dawn',
            label: 'Sleep until dawn',
            perform: (site) => {
              const decision = Effect.runSync(attemptBedSleep(previewSleepPlayer, site.time, {
                bedPosition: BED_POSITION,
                dangerNearby: false,
                weather: site.weather.weather,
              }))
              if (decision._tag === 'SleepRejected') {
                throw new Error(`sleep rejected: ${decision.reason}`)
              }
              Effect.runSync(Ref.set(site.state.timeOfDay, decision.morningTimeOfDay))
            },
          },
          {
            id: 'inventory-add-bread',
            label: 'Add 3 bread',
            perform: (site) => {
              const leftover = Effect.runSync(site.inventoryService.api.add('bread', 3))
              if (leftover !== 0) throw new Error(`inventory rejected ${String(leftover)} bread`)
              syncPlayerStorage(site)
            },
          },
          {
            id: 'inventory-remove-bread',
            label: 'Remove 1 bread',
            perform: (site) => {
              Effect.runSync(site.inventoryService.api.remove('bread', 1))
              syncPlayerStorage(site)
            },
          },
        ],
        unsupported,
        observe: (site) => ({
          statusEffects: {
            pendingApplications: Effect.runSync(Ref.get(site.state.pendingStatusEffects)),
            movementSpeedMultiplier: Effect.runSync(getPlayerMovementSpeedMultiplier(site.state)),
          },
        }),
      })
    },
  },
  {
    id: 'player-systems-fishing',
    title: 'Fishing: cast, bite, and catch',
    area: 'player-systems',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, playerSystemsFishingSetup),
  },
  {
    id: 'player-systems-brewing',
    title: 'Brewing: water bottle to awkward potion',
    area: 'player-systems',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, playerSystemsBrewingSetup),
  },
  {
    id: 'player-systems-enchanting',
    title: 'Enchanting: Efficiency I book',
    area: 'player-systems',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, playerSystemsEnchantingSetup),
  },
  {
    id: 'player-systems-villager-trade',
    title: 'Villager trade: wheat for emerald',
    area: 'player-systems',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, playerSystemsVillagerTradeSetup),
  },
]
