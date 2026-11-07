import { Effect, Ref } from 'effect'
import {
  getPlayerMovementSpeedMultiplier,
  requestStatusEffect,
} from '../../../src/stages/registration.js'
import { STONE } from '../../preview-mining-site/world.js'
import { mountGameplayScenario, type ScenarioDefinition } from '../contract.js'

const floor = Array.from({ length: 8 }, (_, x) => [x, 63, STONE] as const)

const unsupported = [
  'Melee combat has no reachable target: this Site does not expose player movement or the entity-owner coordinator.',
  'Player position is unavailable: Site does not expose its preview player pose; the common snapshot currently substitutes a static preview-spawn string.',
  'Sleep is unavailable: the Site does not expose its real player or TimeService; its timeOfDay ref is only a compatibility inbox.',
  'Fishing is unavailable: gameplayStages receives no fishingService in this Site, so CastFishing is rejected as OwnerRegistrationUnavailable.',
  'Brewing is unavailable: the brewing owner receives an initial empty player-storage snapshot, and later inventory changes do not update it.',
  'Enchantment is unavailable: gameplayStages has no enchantment request path.',
  'Villager trade is unavailable: the Site starts with no trade offers and does not expose the trade-owner setup.',
  'Item metadata is unavailable: its store is not attached to Site and has no observation field in the scenario contract.',
  'Only the derived movement-speed multiplier is observable for status effects; the active effect list and remaining time are not exposed.',
]

export const playerSystemScenarios: ReadonlyArray<ScenarioDefinition> = [
  {
    id: 'player-systems-state',
    title: 'Player state, effects, and inventory',
    area: 'player-systems',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, {
      world: { cells: floor, loadedChunks: ['0,0'], z: 0 },
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
          id: 'inventory-add-bread',
          label: 'Add 3 bread',
          perform: (site) => Effect.runSync(site.inventoryService.api.add('bread', 3)),
        },
        {
          id: 'inventory-remove-bread',
          label: 'Remove 1 bread',
          perform: (site) => Effect.runSync(site.inventoryService.api.remove('bread', 1)),
        },
      ],
      unsupported,
      observe: (site) => ({
        statusEffects: {
          pendingApplications: Effect.runSync(Ref.get(site.state.pendingStatusEffects)),
          movementSpeedMultiplier: Effect.runSync(getPlayerMovementSpeedMultiplier(site.state)),
        },
      }),
    }),
  },
]
