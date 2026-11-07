import {
  BlockAxis,
  InterpolationFraction,
  blockIdOf,
  blockPosition,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { Effect, Option, Ref } from 'effect'
import { attemptBedSleep, type BedSleepPlayer } from '../../../src/domain/bed-sleep.js'
import {
  getPlayerMovementSpeedMultiplier,
  requestStatusEffect,
} from '../../../src/stages/registration.js'
import type { Site } from '../../preview-mining-site/site.js'
import { STONE } from '../../preview-mining-site/world.js'
import { mountGameplayScenario, type ScenarioDefinition } from '../contract.js'

const TICKS_PER_DAY = 24_000
const BED = Option.getOrThrow(blockIdOf('bed'))
const BED_POSITION = blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(0))
const floor = Array.from({ length: 8 }, (_, x) => [x, 63, STONE] as const)
const previewSleepPlayer: BedSleepPlayer = { dimension: Effect.succeed('overworld') }

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

const unsupported = [
  'Melee combat has no reachable target: this Site does not expose player movement or the entity-owner coordinator.',
  'Player position is unavailable: Site does not expose its preview player pose; the common snapshot currently substitutes a static preview-spawn string.',
  'Sleep uses the preview player’s fixed overworld dimension and a no-danger fixture; Site does not expose live dimension or hostile-proximity checks.',
  'Fishing is unavailable: gameplayStages receives no fishingService in this Site, so CastFishing is rejected as OwnerRegistrationUnavailable.',
  'Brewing is unavailable: this Site synchronizes player storage but passes no brewingService to gameplayStages.',
  'Enchantment is unavailable: gameplayStages has no enchantment request path.',
  'Villager trade is unavailable: the Site starts with no trade offers and does not expose the trade-owner setup.',
  'Item metadata is unavailable: its store is not attached to Site and has no observation field in the scenario contract.',
  'Only the derived movement-speed multiplier is observable for status effects; the active effect list and remaining time are not exposed.',
]

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
]
