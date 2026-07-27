/**
 * The barrel is pinned explicitly.
 *
 * `index.ts` is what mc-compose imports. A re-export dropped from it is
 * invisible to every other test in this repository — they all import the
 * modules directly — while breaking the only consumer that matters. Same
 * reasoning as `mc-kernel/test/public-api.test.ts`.
 *
 * Note what this test does NOT say: that everything listed here is a CONTRACT.
 * mx-gameplay's contract is stage registration (docs/public-api.md); the domain
 * modules are exported because the previews and tests drive them. Pinning them
 * here keeps the barrel honest, not the API frozen.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as gameplay from '../index'
import { applyDamage } from '../domain/death-cause'
import { takeBatch } from '../domain/falling-block'
import { GAMEPLAY_STAGE_IDS } from '../stages/stage-ids'

describe('public API surface', () => {
  it.effect('re-exports the stage registration contract — the part mc-compose actually consumes', () =>
    Effect.sync(() => {
      const contract = [
        'gameplayStages',
        'makeGameplayStages',
        // the full plan.md §4.1 module — Layer plus an Effect-valued
        // `frameStages`. Expressible only since the vertical-slice spike; see
        // `stages/registration.ts` on why the array was the obstacle.
        'gameplayModule',
        'makeGameplayFrameState',
        'GAMEPLAY_STAGE_IDS',
        'UPSTREAM_STAGE_IDS',
      ]

      for (const name of contract) {
        expect(Object.keys(gameplay)).toContain(name)
      }
    }),
  )

  // REGRESSION: `domain/frame-contract.ts` and `domain/position-key.ts` are
  // stand-ins for @nerima-games/mc-kernel with a deletion date written into
  // their headers. The barrel used to `export *` from both, which published
  // `StageId` and `DeltaTimeSecs` as API of a package that does not own them —
  // and therefore turned the promised deletion into a breaking change for every
  // consumer. mc-sim, mc-render and mc-playground-kit mention their mirrors in
  // an `index.ts` comment and re-export nothing; this repository now matches.
  it.effect('REGRESSION: does not republish mc-kernel’s vocabulary as its own', () =>
    Effect.sync(() => {
      // `ITEM_TYPES` joined this list when the creeper's drop needed a name for
      // gunpowder. `domain/item-vocabulary.ts` mirrors kernel's item roster the
      // way `domain/frame-contract.ts` mirrors its frame types, and it carries
      // the same deletion date — so publishing it here would turn that promised
      // deletion into a breaking change, and would give the organisation a
      // second place to look up what an item is called.
      //
      // `BLOCK_TYPES`, `blockTypeOfId`, `itemOfBlock`, `dropOfBlockId` and the
      // harvest vocabulary joined it when the block loot table needed the
      // number-to-item bridge. `domain/block-vocabulary.ts` mirrors THREE of
      // kernel's files and carries the same deletion date; publishing any of
      // them would put kernel's block registry on this package's surface, and
      // `blockTypeOfId` in particular is the one function a consumer would most
      // plausibly reach for from the wrong repository.
      const kernelsToOwn = [
        'StageId',
        'DeltaTimeSecs',
        'ITEM_TYPES',
        'isItemType',
        'BLOCK_TYPES',
        'BLOCK_DROP_REGISTRY',
        'blockTypeOfId',
        'blockIdOf',
        'itemOfBlock',
        'isPlaceableItem',
        'dropOfBlockId',
        'resolveDrop',
        'satisfiesHarvestTier',
        'HARVEST_TIERS',
        'DEFAULT_BLOCK_DROP',
      ]
      for (const name of kernelsToOwn) {
        expect(Object.keys(gameplay)).not.toContain(name)
      }
    }),
  )

  // The same rule for mc-sim's, which arrived with the mob wiring.
  // `domain/entity-manager-port.ts` is a mirror with a deletion date, exactly as
  // `domain/chunk-store-port.ts` is, so publishing the roster's vocabulary here
  // would make that deletion a breaking change AND would give the organisation a
  // second place to look up what an entity id is.
  it.effect('REGRESSION: does not republish mc-sim’s roster vocabulary as its own', () =>
    Effect.sync(() => {
      const simsToOwn = [
        'EntityId',
        'EntityKind',
        'entityManagerTag',
        'ENTITY_MANAGER_TAG_KEY',
        'UNCHANGED',
        'DESPAWNED',
        'changed',
      ]
      for (const name of simsToOwn) {
        expect(Object.keys(gameplay)).not.toContain(name)
      }

      // `MobBehaviour` and `repairMobBehaviour` ARE published, and that is the
      // opposite call for the opposite reason: they are this repository's own
      // answer to mc-sim's type parameter, and a host has to import them by name
      // because `EntityManagerLayer<S>()` returns a Layer in which `S` appears
      // nowhere for a compiler to check.
      expect(Object.keys(gameplay)).toContain('repairMobBehaviour')
      expect(Object.keys(gameplay)).toContain('CREEPER_KIND')
    }),
  )

  it.effect('re-exports the rule domain, which the previews and scenario tests drive directly', () =>
    Effect.sync(() => {
      const internal = [
        // falling blocks — event-driven, budgeted
        'FALLING_BLOCK_MOVES_PER_TICK',
        'emptyFallingBlockQueue',
        'disturb',
        'takeBatch',
        'settled',
        // fluids — frontier with a per-tick budget
        'DEFAULT_FLUID_FRONTIER_BUDGET',
        'splitBudget',
        'carryOver',
        // death — the cause travels to the message
        'DEATH_MESSAGES',
        'describeDeath',
        'MAX_HEALTH_POINTS',
        'fullHealth',
        'isDead',
        'applyDamage',
        'deathMessage',
        // day/night — a rule over the hour mc-sim owns, holding nothing
        'DAWN_FRACTION',
        'NOON_FRACTION',
        'DUSK_FRACTION',
        'TWILIGHT_BAND',
        'isNight',
        'dayPhase',
        'hostileSpawnsAllowed',
        // the creeper — a fuse, a blast, a spawn condition and a drop
        'CREEPER_IGNITION_RANGE_BLOCKS',
        'CREEPER_FUSE_SECS',
        'DORMANT_FUSE',
        'stepCreeperFuse',
        'CREEPER_EXPLOSION_POWER',
        'explosionRadius',
        'explosionDamageAmount',
        'explosionDamageAt',
        'HOSTILE_SPAWN_MAX_BLOCK_LIGHT',
        'MIN_SPAWN_DISTANCE_BLOCKS',
        'MAX_SPAWN_DISTANCE_BLOCKS',
        'canHostileSpawnAt',
        'CREEPER_DROPS',
        'CREEPER_XP_REWARD',
        'GHAST_DROPS',
        'GHAST_XP_REWARD',
        'BLAZE_DROPS',
        'BLAZE_XP_REWARD',
        'dropPasses',
        'rollMobDrop',
        'rollMobDrops',
        'mobXpReward',
        // the enderman — a decision and an offset, and no position anywhere
        'ENDERMAN_TELEPORT_MIN_BLOCKS',
        'ENDERMAN_TELEPORT_MAX_BLOCKS',
        'ENDERMAN_TELEPORT_ATTEMPTS',
        'ENDERMAN_DAMAGE_TELEPORT_CHANCE',
        'ENDERMAN_CHASE_TELEPORT_CHANCE',
        'ENDERMAN_STUCK_TELEPORT_TICKS',
        'endermanTeleportUrge',
        'endermanTeleportOffset',
        // the shulker — the fuse's shape, with an armour report rather than a flag
        'SHULKER_OPENING_TICKS',
        'SHULKER_CLOSED_ARMOR_POINTS',
        'CLOSED_SHELL',
        'stepShulkerShell',
        'shulkerShellArmorPoints',
        'shulkerWantsToTeleport',
        // the sweep — the other end of the spawn rule's budget
        'DESPAWN_DISTANCE_BLOCKS',
        'despawnVerdict',
        // the join — the rules above, run over mc-sim's roster
        'CREEPER_KIND',
        'CREEPER_MAX_HEALTH',
        // the enderman's half of the join: a kind, the two flinch values a host
        // spawns and restores with, and the search budget one teleport draws
        'ENDERMAN_KIND',
        'STEADY_ENDERMAN',
        'STRUCK_ENDERMAN',
        'ENDERMAN_TELEPORT_ROLLS',
        'MAX_HOSTILE_COUNT',
        'repairMobBehaviour',
        'dropRulesOfKind',
        'dropRollsNeeded',
        'rollDropsOfKind',
        'rollCasualtyDrops',
        'rollSelfDestructDrops',
        'distanceBetween',
        'cellOf',
        'sweepMobs',
        'resolveBlasts',
        'applySpawnAttempts',
        // the crater — the OTHER explosion radius, and a ChunkStore write
        'craterRadius',
        'craterCells',
        'carveExplosionCrater',
        // placement — the counterpart to break-block
        'placeBlock',
        'placementVerdict',
        'blockOverlapsPlayer',
        'isSupportSensitiveOfBlock',
        'PLAYER_HALF_WIDTH',
        'PLAYER_HALF_HEIGHT',
        // the block loot table — the random half kernel refuses to hold
        'blockLoot',
        'rollFortuneExtraDrops',
        'FORTUNE_MULTIPLIERS',
        'BLOCK_LOOT_ROLLS',
        'NO_TOOL',
        // weather
        'WEATHERS',
        'advanceWeather',
        'weatherExpires',
        'resolveNextWeatherState',
        'resolveWeatherDurationSecs',
        'createWeatherState',
        'INITIAL_WEATHER',
        'isPrecipitating',
        'isThunderstorm',
        'weatherLightScale',
        'WEATHER_TRANSITION_ROLLS',
        // where randomness enters a frame
        'DEFAULT_ROLL_SEED',
        'normaliseSeed',
        'nextRoll',
        'drawRolls',
        'rollAt',
        // stage helpers
        'LAVA_TICK_INTERVAL',
        'EXPERIENCE_MODULE_STAGE_PREFIXES',
        'OWN_STAGE_PREFIX',
      ]

      for (const name of internal) {
        expect(Object.keys(gameplay)).toContain(name)
      }
    }),
  )

  // REGRESSION: the time of day is mc-sim's — it survives save/load, so it is a
  // noun (plan.md §2.3-1). This repository used to export a second
  // `DEFAULT_DAY_LENGTH_SECS` (1200, against mc-sim's 400) and an
  // `advanceTimeOfDay` that moved a local `Ref`. Re-adding either would put a
  // second answer to "what time is it" on the public surface of a package that
  // does not own the question.
  it.effect('REGRESSION: exports no day-length default and no way to advance the clock', () =>
    Effect.sync(() => {
      const forbidden = [
        'DEFAULT_DAY_LENGTH_SECS',
        'MAX_DAY_LENGTH_SECS',
        'MIN_DAY_LENGTH_SECS',
        'advanceTimeOfDay',
        'setDayLength',
        'setTimeOfDay',
        'timeOfDay',
      ]
      for (const name of forbidden) {
        expect(Object.keys(gameplay)).not.toContain(name)
      }
    }),
  )

  // The same rule, asked of the noun that arrived WITH a rule and no owner.
  //
  // `domain/weather.ts` is exported and `WeatherState` is a saved value, so the
  // temptation this pins away is a `WeatherService`, a `setWeather` or a
  // `getWeather` on this package's surface — the reference has all three
  // (`packages/game/application/weather-service.ts`) and they are the state half,
  // not the rule half. What IS exported is a pure transition function; what must
  // not be is a way to ASK this repository what the weather is, because a
  // consumer that could ask would have found its owner.
  it.effect('REGRESSION: exports the weather RULE and no way to store the weather', () =>
    Effect.sync(() => {
      const forbidden = [
        'WeatherService',
        'weatherService',
        'setWeather',
        'getWeather',
        'currentWeather',
        'makeWeatherState',
      ]
      for (const name of forbidden) {
        expect(Object.keys(gameplay)).not.toContain(name)
      }
    }),
  )

  it.effect('exposes the same implementations through the barrel as through the modules', () =>
    Effect.sync(() => {
      expect(gameplay.applyDamage).toBe(applyDamage)
      expect(gameplay.takeBatch).toBe(takeBatch)
      expect(gameplay.GAMEPLAY_STAGE_IDS).toBe(GAMEPLAY_STAGE_IDS)
    }),
  )

  it.effect('REGRESSION: exports nothing that would let a consumer resolve a total stage order', () =>
    Effect.sync(() => {
      // plan.md §2.3-3. A `sortStages`, `stageOrder` or `framePipeline` export
      // here would be this repository claiming a decision that belongs to
      // mc-compose — and it would be claimed without being able to see the
      // other three modules' registrations.
      const forbidden = ['sortStages', 'stageOrder', 'totalOrder', 'framePipeline', 'runFrame']
      for (const name of forbidden) {
        expect(Object.keys(gameplay)).not.toContain(name)
      }
    }),
  )
})
