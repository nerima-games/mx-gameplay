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
import * as gameplay from '../src/index'
import {
  applyArmorToDamage,
  armorDurabilityWearFromPreMitigationDamage,
  armorPointsForEquipment,
} from '../src/domain/combat/armor'
import { applyDamage } from '../src/domain/death-cause'
import { planFallingBlockMoves, takeBatch } from '../src/domain/falling-block'
import { resolveFoodUse } from '../src/domain/interactions/eat-food'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'

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
        'setPlayerDead',
        'setPortalCandidates',
        'drainPortalTravels',
        'drainFluidUpdates',
        'DEFAULT_MELEE_DAMAGE',
        'DEFAULT_MELEE_REACH',
        'meleeDamageForItem',
        'requestMobSpawn',
        'requestMeleeAttack',
        'drainMeleeAttackResults',
        'requestTargetedPrimaryAttack',
        'drainMobDrops',
        'drainMobExperience',
        'spawnDroppedItem',
        'spawnDroppedItems',
        'requestBucketUse',
        'requestFishingCast',
        'requestFishingAdvance',
        'requestFishingCancel',
        'requestFishingReel',
        'GAMEPLAY_STAGE_IDS',
        'UPSTREAM_STAGE_IDS',
        'isPlaceableItem',
      ]

      for (const name of contract) {
        expect(Object.keys(gameplay)).toContain(name)
      }
    }),
  )

  it.effect('re-exports host-facing targeted right-click routing', () =>
    Effect.sync(() => {
      expect(Object.keys(gameplay)).toContain('targetedRightClickRoute')
    }),
  )

  it.effect('re-exports host-facing falling-block planning', () =>
    Effect.sync(() => {
      expect(Object.keys(gameplay)).toContain('planFallingBlockMoves')
    }),
  )

  it.effect('re-exports gameplay-owned session snapshot validators', () =>
    Effect.sync(() => {
      for (const name of [
        'isValidBrewingStandState',
        'isValidStatusEffectState',
        'isValidVillagerTradeState',
      ]) {
        expect(Object.keys(gameplay)).toContain(name)
      }
    }),
  )

  // REGRESSION: this repository carried six local mirrors, all now repointed
  // and deleted — `domain/frame-contract.ts`, `domain/position-key.ts`,
  // `domain/item-vocabulary.ts`, `domain/block-position-key.ts` and
  // `domain/block-vocabulary.ts` for @nerima-games/mc-kernel, and
  // `domain/chunk-store-port.ts` / `domain/portal-frame-port.ts` for
  // mc-worldgen and mc-kernel respectively (see `src/index.ts`'s "Formerly
  // provisional" note for the full history). The barrel must still not
  // republish kernel's vocabulary as its own — that would make `StageId`,
  // `DeltaTimeSecs`, `BlockPositionKey` and the rest API of a package that
  // does not own them, a breaking change for every consumer the day kernel's
  // own shape moves. mc-sim, mc-render and mc-playground-kit mention their
  // mirrors in an `index.ts` comment and re-export nothing; this repository
  // matches.
  it.effect('REGRESSION: does not republish mc-kernel’s vocabulary as its own', () =>
    Effect.sync(() => {
      // `ITEM_TYPES` joined this list when the creeper's drop needed a name for
      // gunpowder — kernel's item roster.
      //
      // `BLOCK_TYPES`, `blockTypeOfId`, `itemOfBlock`, `dropOfBlockId`, the
      // harvest vocabulary and the capability/support-rule predicates joined it
      // when `domain/block-vocabulary.ts` (three of kernel's files) was
      // repointed and deleted; publishing any of them would put kernel's block
      // registry on this package's surface, and `blockTypeOfId` in particular
      // is the one function a consumer would most plausibly reach for from the
      // wrong repository.
      //
      // `AIR_BLOCK_ID` and the portal-frame family (`detectNetherPortal`,
      // `generatePortalLayout`, `MIN`/`MAX_PORTAL_WIDTH`,
      // `MIN`/`MAX_PORTAL_HEIGHT`) joined it when `domain/chunk-store-port.ts`
      // and `domain/portal-frame-port.ts` were repointed and deleted: both are
      // kernel's now, not mc-worldgen's — `domain/portal-frame-port.ts`'s
      // header named mc-worldgen as its repoint target, but by the time it was
      // removed mc-worldgen no longer carried the portal-frame family at all.
      const kernelsToOwn = [
        'StageId',
        'DeltaTimeSecs',
        'StackCount',
        'MAX_STACK_COUNT',
        'ClockPort',
        'BlockPositionKey',
        'blockPositionKeyOf',
        'blockPositionOfKey',
        'isBlockPositionKey',
        'ITEM_TYPES',
        'isItemType',
        'BLOCK_TYPES',
        'BLOCK_DROP_REGISTRY',
        'BLOCK_REGISTRY',
        'blockTypeOfId',
        'blockIdOf',
        'dropOfBlockId',
        'resolveDrop',
        'satisfiesHarvestTier',
        'HARVEST_TIERS',
        'DEFAULT_BLOCK_DROP',
        'capabilityOfBlockId',
        'capabilitiesOfBlockId',
        'supportRuleOfBlockId',
        'canBlockStaySupported',
        'isSupportSensitiveBlockId',
        'resistsExplosion',
        'AIR_BLOCK_ID',
        'detectNetherPortal',
        'generatePortalLayout',
        'MIN_PORTAL_WIDTH',
        'MAX_PORTAL_WIDTH',
        'MIN_PORTAL_HEIGHT',
        'MAX_PORTAL_HEIGHT',
      ]
      for (const name of kernelsToOwn) {
        expect(Object.keys(gameplay)).not.toContain(name)
      }
      expect(gameplay.blockOfPlaceableItem('redstone_dust')).toBe('redstone_wire')
      expect(gameplay.itemOfBlock('redstone_wire')).toBe('redstone_dust')
      expect(gameplay.isPlaceableItem('redstone_dust')).toBe(true)
    }),
  )

  // The same rule for mc-worldgen's CHUNK-STORE vocabulary, which arrived with
  // `domain/chunk-store-port.ts`'s repoint. `blockIndex` in particular is
  // mc-worldgen's memory layout, and a consumer reading it from here would be
  // indexing a buffer through a repository that does not own one.
  //
  // `domain/chunk-window.ts` IS published, and that is the opposite call for
  // the opposite reason: it is this repository's own bridge from an
  // `Effect`-shaped store to the synchronous accessor mc-worldgen's portal
  // rule takes, it survives the repoint, and `apps/preview-mining-site` and
  // the tests drive it directly.
  it.effect('REGRESSION: does not republish mc-worldgen’s chunk-store vocabulary as its own', () =>
    Effect.sync(() => {
      const worldgensToOwn = ['ChunkStore', 'blockIndex', 'readBlock', 'CHUNK_SIZE_XZ', 'CHUNK_HEIGHT']
      for (const name of worldgensToOwn) {
        expect(Object.keys(gameplay)).not.toContain(name)
      }

      // ...and the bridge over them is ours, so it IS here.
      expect(Object.keys(gameplay)).toContain('openChunkWindow')
      expect(Object.keys(gameplay)).toContain('UNREADABLE_BLOCK')
    }),
  )

  // The same rule for mc-sim's vocabulary, which arrived with the mob wiring.
  // Re-exporting it here would create a second owner for entity identifiers and
  // make future mc-sim API changes a breaking change for this package.
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
      expect(Object.keys(gameplay)).toContain('DROPPED_ITEM_KIND')
      expect(Object.keys(gameplay)).toContain('spawnMobDrops')
      expect(Object.keys(gameplay)).toContain('meleeTargetBeforeBlock')
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
        'enqueueFluidDisturbance',
        'splitBudget',
        'carryOver',
        // bucket use — atomic world/inventory exchange plus fluid disturbance
        'BUCKET_ITEM_TYPES',
        'isBucketItem',
        'useBucket',
        // death — the cause travels to the message
        'DEATH_MESSAGES',
        'describeDeath',
        'MAX_HEALTH_POINTS',
        'fullHealth',
        'isDead',
        'applyDamage',
        'deathMessage',
        // armour — pure protection rules over equipment owned by mc-sim
        'armorPointsForEquipment',
        'applyArmorToDamage',
        'armorDurabilityWearFromPreMitigationDamage',
        // food use — a pure verdict; inventory and vitals remain host-owned
        'FOOD_PROPERTIES',
        'resolveFoodUse',
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
        'ZOMBIE_XP_REWARD',
        'ENDERMAN_XP_REWARD',
        'GHAST_DROPS',
        'GHAST_XP_REWARD',
        'BLAZE_DROPS',
        'BLAZE_XP_REWARD',
        'dropPasses',
        'rollMobDrop',
        'rollMobDrops',
        'mobXpReward',
        'xpRewardOfKind',
        'experienceOfCasualties',
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
        // enchantments — registry, deterministic table, codec and derivations
        'ENCHANTMENT_REGISTRY',
        'enchantmentOffers',
        'applyEnchantmentOffer',
        'encodeEnchantedItem',
        'decodeEnchantedItemSnapshot',
        'meleeDamageWithEnchantments',
        'bowDamageWithEnchantments',
        'armorDamageWithEnchantments',
        'miningSpeedWithEnchantments',
        'durabilityWearWithEnchantments',
        'fortuneDropCountWithEnchantments',
        // weather
        'WEATHERS',
        'advanceWeather',
        'weatherExpires',
        'resolveNextWeatherState',
        'resolveWeatherDurationSecs',
        'createWeatherState',
        'isWeather',
        'isWeatherState',
        'applyWeatherState',
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
      expect(gameplay.armorPointsForEquipment).toBe(armorPointsForEquipment)
      expect(gameplay.applyArmorToDamage).toBe(applyArmorToDamage)
      expect(gameplay.armorDurabilityWearFromPreMitigationDamage).toBe(
        armorDurabilityWearFromPreMitigationDamage,
      )
      expect(gameplay.takeBatch).toBe(takeBatch)
      expect(gameplay.resolveFoodUse).toBe(resolveFoodUse)
      expect(gameplay.planFallingBlockMoves).toBe(planFallingBlockMoves)
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
