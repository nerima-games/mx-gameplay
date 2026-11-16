import { Brand } from 'effect'
import {
  GameplayBrewingBottleItemUseResultSchema,
  GameplayBrewingItemUseResultSchema,
  GameplayFishingItemUseResultSchema,
  BLOCK_LOOT_ROLLS,
  Effect,
  GAMEPLAY_STAGE_IDS,
  Ref,
  UPSTREAM_STAGE_IDS,
  addInventoryItem,
  blockLoot,
  blockPositionKeyOf,
  blockPositionForKey,
  breakRequestQueueFor,
  requeueBlockBreak,
  rollCasualtyExperience,
  requestBlockBreak,
  requestBlockStateRule,
  candidateForPlayerStorageItemUse,
  EnderPearlOutcomeSchema,
  disturb,
  drawRolls,
  firePositionKey,
  furnaceAdvanceChanged,
  gameplayPlayerStateForStage,
  recordGameplayStageFailure,
  recordGameplayRequestFault,
  recordGameplayEntityWorldDataFault,
  recordGameplayEntityStageFault,
  recordGameplayUnsupportedOperation,
  validateBlockPlacementCommand,
  recordMobRuleIssues,
  rollAt,
  isSuccessfulBlockUse,
  planFurnaceAdvance,
  processBlockPlacementCommand,
  isRetryableWorldCommitFailure,
  resolveBlockUse,
  stepPortalTravel,
  stepStatusEffects,
  useBucket,
} from './registration-core.js'
import {
  AttackRangeDistance,
  EnchantmentLevel,
  EntityHealthPoints,
  BlockAxis,
  EntityId,
  PositionAxis,
  RandomSeed,
  blockPosition,
  weaponComponent,
  type EnchantmentLevel as EnchantmentLevelValue,
} from '@nerima-games/mc-kernel'
import { position as kernelPosition } from '@nerima-games/mc-kernel'
import type { BlockId, BlockType, ItemType } from '@nerima-games/mc-kernel'
import { Equal, Option, Result, Schema } from 'effect'
import {
  DamageAmount,
  DamageCause,
  PlayerServiceSnapshotSchema,
  applyDamage as applyVitalsDamage,
  damageAt as damagePlayerStorageAt,
  removeItemAt,
  removeItem as removeInventoryItem,
  withInventory,
  type PlayerStorage,
  type StorageLocation,
  type EquipmentItem,
  type WorldBlockRead,
} from '@nerima-games/mc-sim'
import type { BlockPosition, DeltaTimeSecs, Dimension, ProjectileId, WorldRevision } from '@nerima-games/mc-kernel'
import { planBreakBlock } from '../domain/interactions/break-block.js'
import { TNT_BLOCK_ID } from '../domain/interactions/ignite-tnt.js'
import { igniteFire } from '../domain/interactions/ignite-fire.js'
import { ignitePortal } from '../domain/interactions/ignite-portal.js'
import type { IgnitionOutcome } from '../domain/interactions/use-flint-and-steel.js'
import {
  DroppedItemOwnerSnapshotSchema,
  appendDroppedItemSpawns,
} from '../domain/entities/dropped-item.js'
import type {
  BlockPositionKey,
  BlockUseRequest,
  BlockLootContext,
  BlockUseResult,
  CollectBrewingBottleRequest,
  BrewingItemUseRequest,
  GameplayFrameState,
  BowShotRequest,
  DroppedItemSpawn,
  GameplayStageContext,
  BrewingItemUseResult,
  IgnitionItemType,
  ItemUseRequest,
  ItemUseResult,
  ItemUseWorldReadRefusal,
  FishingItemUseRequest,
  MeleeAttackRequest,
  PendingBlockBreakRequest,
  PlacementRequest,
  StageRegistration,
  VillagerTradeRequest,
  EnderPearlThrowRequest,
  BlockPlacementCommand,
} from './registration-core.js'
import type {
  GameplayStageBlockTypeDecodeFailure,
  GameplayStageItemUseWorldFailure,
} from './gameplay-stage-faults.js'
import { enchantmentTableRandomForSeed } from '../domain/enchantment-seed.js'

import {
  AIR_BLOCK_ID,
  BlockPositionSchema,
  adjacentBlockPosition,
  EntityIdSchema,
  DomainEventSchema,
  SimulationTickSchema,
  WorldPositionSchema,
  StackCount,
  itemStack,
  type WorldWriteBatch,
  itemIdOf,
  WorldWriteBatchSchema,
  FoodNutrition,
  blockIdOf,
  blockOfPlaceableItem,
  blockTypeOfId,
} from '@nerima-games/mc-kernel'
import {
  PlayerStorageSnapshotSchema,
  TntServiceSnapshotSchema,
  BrewingServiceStateSchema,
  BrewingBottleIndexSchema,
  PotionDrinkFailureSchema,
  PotionDrinkSlotIndexSchema,
  BREWING_FUEL_ITEM,
  BREWING_MAX_FUEL_CHARGES,
  FishingStateSchema,
  FishingLootSampleSchema,
  FishingWaitTicksSchema,
  EnchantmentTableInventorySlotSchema,
  EnchantmentTableOfferSchema as SimEnchantmentTableOfferSchema,
  ItemStackSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  launchProjectile,
  mergeWorldCommitPlans,
  addStoredStack,
  type WorldCommitPlanFragment,
  CropSnapshotSchema,
  advanceCrop,
  maturitySecsFor,
  isMatureCrop,
  isCropType,
  SaturationModifier,
  WorldRevisionConflict,
  eat as eatVitals,
  type ReplicatedOwnerCandidate,
  type CropSnapshot,
  type CropState,
  primeTnt,
  spawnEntity,
  type EnchantmentTableApplyFailure,
  type EnchantmentTableApplyResult,
  type EnchantmentTableBookshelfFailure,
  type EnchantmentTableFailure,
  type EnchantmentTableServiceError,
  type EnchantmentTableBlockIdAt,
  type EnchantmentTableBookshelfCount,
  type EnchantmentTableGenerateOffersResult,
  type EnchantmentTableInventorySlot,
  type ItemStack,
  type EnchantmentTableServiceApi,
} from '@nerima-games/mc-sim'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, type BlockReading, type ReadonlyChunk } from '@nerima-games/mc-worldgen'
import {
  applyStatusEffectToValidatedState,
  persistentStatusEffectApplicationFromValidatedFields,
  statusEffectModifiers,
  ValidatedStatusEffectStateSchema,
  type AttackDamageBonus,
  type ValidatedStatusEffectState,
} from '../domain/status-effect.js'
import { applyBoneMeal } from '../domain/interactions/bone-meal.js'
import {
  BlockStateRandomRollSchema,
  CropGrowthSpeedLevelSchema,
  applyBlockStateRule,
  blockStateWorldPortForChunkStore,
  type BlockStateRuleRequest,
  type BlockStateRuleOutcome,
  type SaplingTreeSpaceResult,
} from '../domain/interactions/block-state-rules.js'
import { cropDrops } from '../domain/interactions/crop-drops.js'
import {
  resolveFoodUse,
  type InvalidFoodItemId,
  type FoodUseOutcome,
} from '../domain/interactions/eat-food.js'
import { plantingVerdict, cropCellAbove } from '../domain/interactions/plant-crop.js'
import { TILLED_BLOCK, tillingVerdict, cellAbove } from '../domain/interactions/till-soil.js'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../domain/entities/xp-orb.js'
import {
  GAMEPLAY_FISHING_ENCHANTMENTS_OWNER_ID,
  GameplayEntityRosterSchema,
  GameplayFishingEnchantmentsSnapshotSchema,
  GameplayTntSourcesSnapshotSchema,
  GameplayVillagerTradeSnapshotSchema,
  restoreGameplayEntityMetadata,
} from './gameplay-owner-registrations.js'
import { planPlaceBlock } from '../domain/interactions/place-block.js'
import {
  shotBlockedByTerrain,
  shotTargetWithCandidate,
} from '../domain/interactions/bow-shot.js'
import { bowCharge, bowDamage, canFireBow } from '../domain/interactions/draw-bow.js'
import {
  bowDamageWithEnchantments,
  durabilityWearWithEnchantments,
  enchantmentLevel,
  fireAspectDurationTicks,
  flameDurationTicks,
  infinityPreventsArrowConsumption,
  lootingLevel,
  meleeDamageWithEnchantments,
  knockbackLevel,
  type KnockbackStrength,
  punchKnockbackBonus,
  silkTouchEnabled,
  type EnchantmentSource,
} from '../domain/enchantment.js'
import {
  advanceMiningProgress,
  miningLootContextForItem,
} from '../domain/interactions/mining-progress.js'
import {
  FISHING_MAX_ENCHANTMENT_LEVEL,
  fishingLootSampleWithLuckOfTheSea,
  fishingWaitTicksWithLure,
} from '../domain/interactions/fishing-enchantment.js'
import {
  fishingOpenWaterAt,
} from '../domain/interactions/fishing-open-water.js'
import {
  MeleeCooldownTicksSchema,
  prepareMeleeAttack,
  type MeleeTargetInputFailure,
  type MeleeAttackIntent,
} from '../domain/interactions/melee-attack.js'
import { knockbackDirection, type KnockbackDirection } from '../domain/interactions/knockback.js'
import { directionComponent, normalizeDirection3 } from '../domain/math/direction.js'
import {
  ENDER_PEARL_DAMAGE,
  enderPearlDisplacement,
  shouldSpawnEndermite,
} from '../domain/interactions/throw-ender-pearl.js'
import {
  ENDERMITE_KIND,
  ENDERMITE_MAX_HEALTH,
  initialBehaviourOfKind,
  planMobDamageRoster,
  rollCasualtyDrops,
  type MobKillCredit,
} from '../domain/entities/mob-frame.js'
import type { Damage } from '../domain/death-cause.js'
import { solidityFromStore } from '../domain/in-memory-world.js'
import type { EntityWorldQueryFailure } from '../domain/entities/entity-world-cell.js'

const blockPositionForRequest = (
  state: GameplayStageContext['state'],
  key: BlockPositionKey,
  source: 'Mining' | 'BlockUse' | 'ItemUse' | 'Tnt',
  requestId?: string,
): Effect.Effect<BlockPosition | undefined> => Effect.gen(function* () {
  const result = blockPositionForKey(key)
  if (Result.isFailure(result)) {
    yield* recordGameplayRequestFault(state, source, requestId, 'InvalidBlockPositionKey', key)
    return undefined
  }
  return result.success
})

const invalidBlockLootContextReason = (
  context: unknown,
): 'InvalidBlockLootContext' | 'InvalidBlockLootFortuneLevel' | undefined => {
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    return 'InvalidBlockLootContext'
  }
  const prototype = Object.getPrototypeOf(context)
  if (prototype !== Object.prototype && prototype !== null) return 'InvalidBlockLootContext'
  if (Object.hasOwn(context, 'fortuneLevel')) {
    const fortuneLevel = (context as Record<string, unknown>)['fortuneLevel']
    if (typeof fortuneLevel !== 'number' || !Number.isSafeInteger(fortuneLevel) || fortuneLevel < 0) {
      return 'InvalidBlockLootFortuneLevel'
    }
  }
  return undefined
}

const cropAt = (
  snapshot: CropSnapshot,
  dimension: string,
  position: BlockPosition,
): CropState | undefined =>
  snapshot.crops.find((crop) =>
    crop.dimension === dimension &&
    crop.position.x === position.x &&
    crop.position.y === position.y &&
    crop.position.z === position.z,
  )

const cropCandidate = (
  ownerId: import('@nerima-games/mc-sim').ReplicatedOwnerId,
  crops: ReadonlyArray<CropState>,
): ReplicatedOwnerCandidate => ({ ownerId, state: { crops } })

const applyGameplayBlockStateRule = (
  state: GameplayStageContext['state'],
  world: GameplayStageContext['blockStateWorld'],
  dimension: Dimension,
  request: BlockStateRuleRequest,
  ownerChanges?: ReadonlyArray<ReplicatedOwnerCandidate>,
  expectedWorldRevision?: WorldRevision,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    const port = world?.forDimension(dimension, ownerChanges, expectedWorldRevision)
    const outcome = port === undefined
      ? { _tag: 'PortUnavailable' as const, position: request.position }
      : yield* applyBlockStateRule(port, request)
    yield* Ref.update(state.blockStateRuleResults, (results) => [...results, {
      requestId: request.requestId,
      outcome,
    }])
    return outcome
  })

// Projecting CropOwner progress advances one age per request, so each request
// uses the fastest speed level and a roll that always grows.
const CROP_PROJECTION_TICK: BlockStateRuleRequest['operation'] = {
  _tag: 'CropRandomTick',
  speedLevel: Schema.decodeUnknownSync(CropGrowthSpeedLevelSchema)(10),
  roll: Schema.decodeUnknownSync(BlockStateRandomRollSchema)(0),
}

const cropTargetAge = (crop: CropState): number => {
  const maximumAge = crop.crop === 'nether_wart_crop' ? 3 : 7
  return Math.min(maximumAge, Math.floor((crop.growthSecs / maturitySecsFor(crop.crop)) * maximumAge))
}

// CropOwner remains the clock; the block state's age only projects its progress.
const projectCropAge = (
  state: GameplayStageContext['state'],
  world: GameplayStageContext['blockStateWorld'],
  crop: CropState,
  onOwnerApplied: () => void,
  ownerChanges?: ReadonlyArray<ReplicatedOwnerCandidate>,
  expectedWorldRevision?: WorldRevision,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const targetAge = cropTargetAge(crop)
    if (targetAge === 0) return
    const requestId = `crop-growth:${crop.dimension}:${crop.position.x}:${crop.position.y}:${crop.position.z}:${targetAge}`
    const port = world?.forDimension(crop.dimension)
    if (port === undefined) {
      yield* applyGameplayBlockStateRule(state, world, crop.dimension, {
        requestId,
        position: crop.position,
        operation: CROP_PROJECTION_TICK,
      })
      return
    }

    const current = yield* port.read(crop.position)
    if (current._tag !== 'Found') {
      const outcome = yield* applyGameplayBlockStateRule(state, world, crop.dimension, {
        requestId,
        position: crop.position,
        operation: CROP_PROJECTION_TICK,
      }, ownerChanges, expectedWorldRevision)
      if (outcome._tag === 'Applied') onOwnerApplied()
      return
    }
    if (current.cell.state.age !== undefined && current.cell.state.age >= targetAge) {
      return
    }

    let ownerWritePending = ownerChanges
    for (let age = current.cell.state.age ?? -1; age < targetAge; age += 1) {
      const outcome = yield* applyGameplayBlockStateRule(state, world, crop.dimension, {
        requestId,
        position: crop.position,
        operation: CROP_PROJECTION_TICK,
      }, ownerWritePending, ownerWritePending === undefined ? undefined : expectedWorldRevision)
      if (outcome._tag !== 'Applied') return
      if (ownerWritePending !== undefined) {
        ownerWritePending = undefined
        onOwnerApplied()
      }
    }
  })

type IndexedSaplingChunk = Readonly<{
  blocks: ReadonlyChunk['blocks']
  positions: ReadonlyArray<BlockPosition>
}>

const SAPLING_TICK_INTERVAL_SECS = 1
const SAPLING_TICK_FRAME_BUDGET = 8
const SAPLING_BLOCK_ID = Option.getOrThrow(blockIdOf('sapling'))

// ChunkStore publishes replacement block buffers, so unchanged chunks need no
// full scan on each interactions-stage tick.
const indexSaplingsInChunk = (
  coord: Readonly<{ cx: number; cz: number }>,
  chunk: ReadonlyChunk,
): IndexedSaplingChunk => {
  const positions: Array<BlockPosition> = []
  for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
    for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
      for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
        if (chunk.blocks[blockIndex(x, y, z)] === SAPLING_BLOCK_ID) {
          positions.push(blockPosition(
            BlockAxis(coord.cx * CHUNK_SIZE_XZ + x),
            BlockAxis(y),
            BlockAxis(coord.cz * CHUNK_SIZE_XZ + z),
          ))
        }
      }
    }
  }
  return { blocks: chunk.blocks, positions }
}

const saplingTreeSpaceForBlock = (
  position: BlockPosition,
  reading: BlockReading,
): SaplingTreeSpaceResult => {
  if (reading._tag === 'ChunkNotLoaded') return { _tag: 'ChunkNotLoaded' }
  if (reading._tag === 'OutOfWorld') return { _tag: 'OutOfWorld' }

  // The store returns validated BlockIds; blockTypeOfId fails only when the fixed
  // registry itself cannot be built, which would fail every id alike.
  const type = Result.getOrThrow(blockTypeOfId(reading.block))
  if (type === undefined) {
    return {
      _tag: 'BlockTypeDecodeFailed',
      position,
      block: reading.block,
      failure: { _tag: 'UnregisteredBlockId' },
    }
  }
  return type === 'air' ? { _tag: 'Available' } : { _tag: 'Blocked' }
}

const treeSpaceAt = (
  store: GameplayStageContext['store'],
  position: BlockPosition,
): Effect.Effect<SaplingTreeSpaceResult> =>
  Effect.gen(function* () {
    // Sapling positions are indexed from the world's 0..CHUNK_HEIGHT Y range.
    // BlockPosition neighbours remain numerically valid above the world, so the
    // store's OutOfWorld result is the authoritative boundary check.
    const first = blockPosition(position.x, BlockAxis(position.y + 1), position.z)
    const second = blockPosition(position.x, BlockAxis(position.y + 2), position.z)
    const firstResult = saplingTreeSpaceForBlock(first, yield* store.getBlock(first))
    if (firstResult._tag !== 'Available') return firstResult
    return saplingTreeSpaceForBlock(second, yield* store.getBlock(second))
  })

const makeSaplingGrowthTick = (
  state: GameplayStageContext['state'],
  store: GameplayStageContext['store'],
  blockStateWorld: GameplayStageContext['blockStateWorld'],
): ((dimension: Dimension, dt: number) => Effect.Effect<void>) => {
  const indexedChunks = new Map<string, IndexedSaplingChunk>()
  let elapsedSecs = 0

  const candidates = (): Effect.Effect<ReadonlyArray<BlockPosition>> =>
    Effect.gen(function* () {
      const loaded = yield* store.loadedCoords
      const loadedKeys = new Set<string>()
      const positions: Array<BlockPosition> = []
      for (const coord of loaded) {
        const key = `${coord.cx},${coord.cz}`
        loadedKeys.add(key)
        const chunk = yield* store.peek(coord)
        if (chunk === undefined) {
          indexedChunks.delete(key)
          continue
        }
        const cached = indexedChunks.get(key)
        const indexed = cached?.blocks === chunk.blocks ? cached : indexSaplingsInChunk(coord, chunk)
        indexedChunks.set(key, indexed)
        positions.push(...indexed.positions)
      }
      for (const key of indexedChunks.keys()) {
        if (!loadedKeys.has(key)) indexedChunks.delete(key)
      }
      return positions
    })

  return (dimension, dt) =>
    Effect.gen(function* () {
      if (blockStateWorld === undefined) return
      // Frame rate only affects the remainder; saplings get at most one attempt
      // per accumulated gameplay second.
      const elapsed = Math.min(
        SAPLING_TICK_INTERVAL_SECS * SAPLING_TICK_FRAME_BUDGET,
        elapsedSecs + Math.max(0, dt),
      )
      const ticks = Math.floor(elapsed / SAPLING_TICK_INTERVAL_SECS)
      elapsedSecs = elapsed - ticks * SAPLING_TICK_INTERVAL_SECS
      if (ticks === 0) return

      const saplings = yield* candidates()
      if (saplings.length === 0) return
      let seed = yield* Ref.get(state.rollSeed)
      for (let tick = 0; tick < ticks; tick += 1) {
        // state.rollSeed holds a normalised seed and saplings.length is a valid count.
        const batch = Result.getOrThrow(drawRolls(seed, saplings.length))
        seed = batch.seed
        for (const [index, position] of saplings.entries()) {
          const lightResult = yield* Effect.result(store.getLight(position))
          if (Result.isFailure(lightResult)) {
            yield* recordGameplayEntityStageFault(state, {
              _tag: 'WorldDataFailure',
              source: 'SaplingGrowth',
              operation: 'ReadLight',
              position,
              reason: lightResult.failure,
            })
            continue
          }
          const light = lightResult.success
          if (light._tag !== 'Light' || Math.max(light.sky, light.block) < 9) continue
          const treeSpace = yield* treeSpaceAt(store, position)
          yield* applyGameplayBlockStateRule(state, blockStateWorld, dimension, {
            requestId: `sapling-growth:${position.x}:${position.y}:${position.z}:${tick}`,
            position,
            operation: {
              _tag: 'SaplingGrowthAttempt',
              // index enumerates saplings, which is the batch length, and frame
              // rolls lie in [0, 1).
              roll: Schema.decodeUnknownSync(BlockStateRandomRollSchema)(Result.getOrThrow(rollAt(batch, index))),
              treeSpace,
            },
          })
        }
      }
      yield* Ref.set(state.rollSeed, seed)
    })
}

// Callers hold schema-decoded item types, and every registered item admits a stack of one.
const singleItemStack = (item: Parameters<typeof itemStack>[0]) =>
  Result.getOrThrow(itemStack(item, StackCount(1)))

const DEFAULT_WEAPON_ITEM_DAMAGE = Result.getOrThrow(weaponComponent()).itemDamagePerAttack
const FISHING_ROD_REEL_WEAR = 1
const VALIDATED_FISHING_ROD_LOCATION = Symbol('ValidatedFishingRodLocation')

type FishingEnchantments = Readonly<{
  lureLevel: EnchantmentLevelValue
  luckOfTheSeaLevel: EnchantmentLevelValue
  openWater: boolean
}>

const fishingEnchantmentsForRod = (
  rod: Pick<EquipmentItem, 'components'> | null,
  openWater: boolean,
): FishingEnchantments => {
  const enchantments = rod?.components.enchantments ?? []
  return {
    lureLevel: Result.getOrThrow(EnchantmentLevel.result(
      Math.min(FISHING_MAX_ENCHANTMENT_LEVEL, enchantmentLevel(enchantments, 'lure')),
    )),
    luckOfTheSeaLevel: Result.getOrThrow(EnchantmentLevel.result(
      Math.min(
        FISHING_MAX_ENCHANTMENT_LEVEL,
        enchantmentLevel(enchantments, 'luck_of_the_sea'),
      ),
    )),
    openWater,
  }
}

type ValidatedFishingRodLocation = Readonly<{
  storage: PlayerStorage
  location: StorageLocation
  rod: Pick<EquipmentItem, 'components'>
  [VALIDATED_FISHING_ROD_LOCATION]: true
}>

const validatedFishingRodAt = (
  storage: PlayerStorage,
  location: StorageLocation,
): ValidatedFishingRodLocation | undefined => {
  const heldStack = location._tag === 'Inventory'
    ? storage.inventory.slots[location.slotIndex]
    : storage.equipment.slots[location.slot]
  return heldStack?.item === 'fishing_rod'
    ? { storage, location, rod: heldStack, [VALIDATED_FISHING_ROD_LOCATION]: true }
    : undefined
}

// Kernel and docs/responsibility.md define no reel wear amount; mirror `wearRod` from src/domain/interactions/fishing.ts.
const damageValidatedFishingRodAt = (rod: ValidatedFishingRodLocation): PlayerStorage =>
  damagePlayerStorageAt(rod.storage, rod.location, FISHING_ROD_REEL_WEAR).storage

/**
 * Recovers cast-time modifiers for an active cast that has no record, e.g. one
 * restored from a save written before the record owner existed or cast through
 * `castFishingWithService`. Enchantments come from the rod the request holds and
 * open water from the world around the bobber, in the bobber's dimension, now;
 * nothing is assumed. Returns undefined after recording why the rebuild failed.
 */
const rebuildFishingEnchantments = (
  state: GameplayStageContext['state'],
  context: NonNullable<GameplayStageContext['commit']>,
  request: FishingItemUseRequest,
  bobber: ProjectileId,
  heldRod: Pick<EquipmentItem, 'components'> | undefined,
): Effect.Effect<FishingEnchantments | undefined> =>
  Effect.gen(function* () {
    if (heldRod === undefined) {
      yield* recordGameplayRequestFault(state, 'ItemUse', request.requestId, 'FishingRodNotHeld')
      return undefined
    }
    const projectileOwnerId = context.projectileOwnerId ?? PROJECTILE_REPLICATED_OWNER_ID
    const projectiles = yield* Effect.result(context.coordinator.observe(
      projectileOwnerId,
      ProjectileServiceSnapshotSchema,
      [],
    ))
    if (Result.isFailure(projectiles)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: projectiles.failure,
      })
      return undefined
    }
    const record = projectiles.success.state.projectiles.find((projectile) => projectile.id === bobber)
    if (record === undefined) {
      yield* recordGameplayEntityStageFault(state, { _tag: 'FishingBobberUnavailable', actor: request.actor, bobber })
      return undefined
    }
    const openWater = yield* Effect.result(fishingOpenWaterAt(
      (positions) => Effect.map(
        context.coordinator.observe(
          projectileOwnerId,
          ProjectileServiceSnapshotSchema,
          positions.map((position) => ({ dimension: record.dimension, position })),
        ),
        (observed) => observed.blocks.map(({ reading }) => reading),
      ),
      record.projectile.position,
    ))
    if (Result.isSuccess(openWater)) return fishingEnchantmentsForRod(heldRod, openWater.success)
    const failure = openWater.failure
    if (failure._tag !== 'FishingOpenWaterReadFailure') {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: failure,
      })
    } else if (failure.reason === 'InvalidPosition') {
      yield* recordGameplayEntityWorldDataFault(state, 'Fishing', {
        _tag: 'EntityWorldInvalidCell',
        reason: 'not-block-coordinate',
        position: kernelPosition(
          PositionAxis(failure.position.x),
          PositionAxis(failure.position.y),
          PositionAxis(failure.position.z),
        ),
      })
    } else {
      yield* recordGameplayEntityStageFault(state, {
        _tag: 'WorldDataFailure',
        source: 'Fishing',
        operation: 'ReadBlock',
        position: failure.position,
        reason: { _tag: failure.reason, position: failure.position },
      })
    }
    return undefined
  })

type PlayerStorageCommitSnapshot = Readonly<{
  world: WorldCommitPlanFragment<unknown>['world']
  expectedRevision: WorldCommitPlanFragment<unknown>['expectedRevision']
  expectedDimensions: WorldCommitPlanFragment<unknown>['expectedDimensions']
  state: PlayerStorage
}>

const isMeleeWeaponItem = (item: ItemType): boolean =>
  item.endsWith('_sword') || item.endsWith('_axe') || item.endsWith('_pickaxe') ||
  item.endsWith('_shovel') || item.endsWith('_hoe')

const VALIDATED_MELEE_WEAPON_LOCATION = Symbol('ValidatedMeleeWeaponLocation')

type ValidatedMeleeWeaponLocation = Readonly<{
  storage: PlayerStorage
  location: StorageLocation
  item: ItemType | null
  wear: number
  [VALIDATED_MELEE_WEAPON_LOCATION]: true
}>

const isMeleeToolLocation = (location: unknown): location is Extract<StorageLocation, { _tag: 'Inventory' }> =>
  typeof location === 'object' && location !== null &&
    '_tag' in location && location._tag === 'Inventory' &&
    'slotIndex' in location && typeof location.slotIndex === 'number' && Number.isSafeInteger(location.slotIndex) &&
    location.slotIndex >= 0 && location.slotIndex < 9

const validatedMeleeWeaponAt = (
  storage: PlayerStorage,
  location: Extract<StorageLocation, { readonly _tag: 'Inventory' }>,
): ValidatedMeleeWeaponLocation => {
  const heldStack = storage.inventory.slots[location.slotIndex]
  const item = heldStack !== undefined && heldStack !== null && isMeleeWeaponItem(heldStack.item)
    ? heldStack.item
    : null
  return {
    storage,
    location,
    item,
    wear: item === null ? 0 : heldStack?.components?.weapon?.itemDamagePerAttack ?? DEFAULT_WEAPON_ITEM_DAMAGE,
    [VALIDATED_MELEE_WEAPON_LOCATION]: true,
  }
}

const damageValidatedMeleeWeaponAt = (
  weapon: ValidatedMeleeWeaponLocation,
  wear = weapon.wear,
): PlayerStorage => damagePlayerStorageAt(weapon.storage, weapon.location, wear).storage

const UNDEAD_MOB_KINDS = new Set([
  'bogged', 'drowned', 'husk', 'phantom', 'skeleton', 'skeleton_horse', 'stray', 'wither',
  'wither_skeleton', 'zoglin', 'zombie', 'zombie_horse', 'zombie_villager', 'zombified_piglin',
])
const ARTHROPOD_MOB_KINDS = new Set(['bee', 'cave_spider', 'endermite', 'silverfish', 'spider'])

const meleeEnchantmentTarget = (kind: string): 'undead' | 'arthropod' | 'other' =>
  UNDEAD_MOB_KINDS.has(kind) ? 'undead' : ARTHROPOD_MOB_KINDS.has(kind) ? 'arthropod' : 'other'

const igniteMobAfterCommit = (
  state: GameplayStageContext['state'],
  id: import('@nerima-games/mc-kernel').EntityId,
  position: Readonly<{ x: number; y: number; z: number }>,
  durationTicks: number,
): Effect.Effect<void> =>
  Ref.update(state.fireLifecycle, (current) => {
    const actors = current.burningActors ?? []
    const existing = actors.find((actor) => actor.id === id)
    return {
      ...current,
      burningActors: [
        ...actors.filter((actor) => actor.id !== id),
        {
          id,
          kind: 'entity' as const,
          position,
          remainingTicks: Math.max(existing?.remainingTicks ?? 0, durationTicks),
          damageCooldownTicks: existing?.damageCooldownTicks ?? 0,
        },
      ],
    }
  })

const commitMobDamage = (
  state: GameplayStageContext['state'],
  context: NonNullable<GameplayStageContext['commit']>,
  entitySnapshot: Readonly<{
    revision: WorldWriteBatch['expectedWorldRevision']
    state: Schema.Schema.Type<typeof GameplayEntityRosterSchema>
  }>,
  dimension: Dimension,
  hit: Readonly<{
    id: import('@nerima-games/mc-kernel').EntityId
    damage: Damage
    killCredit: Exclude<MobKillCredit, 'player-triggered-tnt'>
    lootingLevel: EnchantmentLevelValue
    burning?: boolean
  }> | undefined,
  storageCandidate?: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  event?: Schema.Schema.Type<typeof DomainEventSchema>,
  rollSeedOverride?: number,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const ownerId = Option.getOrThrow(Option.fromNullishOr(context.entitiesOwnerId))
    const tick = Schema.decodeUnknownSync(SimulationTickSchema)(yield* Ref.get(state.tickCount))
    const damage = planMobDamageRoster(
      entitySnapshot.state,
      hit === undefined ? [] : [{
        id: hit.id,
        damage: hit.damage,
        killCredit: hit.killCredit,
        lastHitTick: tick,
        lootingLevel: hit.lootingLevel,
        ...(hit.burning === undefined ? {} : { burning: hit.burning }),
      }],
      tick,
    )
    // Damage planning preserves the validated roster and adds only validated hit metadata.
    const roster = Result.getOrThrow(restoreGameplayEntityMetadata(
      damage.roster,
      entitySnapshot.state,
      dimension,
    ))

    const seed = rollSeedOverride ?? (yield* Ref.get(state.rollSeed))
    // The frame seed, the wear-roll seed override, and generated casualties contain no external roll counts.
    const drops = damage.casualties.length === 0
      ? undefined
      : Result.getOrThrow(rollCasualtyDrops(damage.casualties, seed))
    const casualtyExperience = drops === undefined
      ? undefined
      : Result.getOrThrow(rollCasualtyExperience(damage.casualties, drops.seed))
    const nextRollSeed = casualtyExperience?.seed
    const changes: Array<ReplicatedOwnerCandidate> = []
    if (damage.roster !== entitySnapshot.state) {
      changes.push({ ownerId, state: roster })
    }
    if (storageCandidate !== undefined && context.playerStorageOwnerId !== undefined) {
      changes.push({ ownerId: context.playerStorageOwnerId, state: storageCandidate })
    }
    if ((drops?.drops.length ?? 0) > 0) {
      const droppedItemsOwnerId = context.droppedItemsOwnerId
      if (droppedItemsOwnerId === undefined) {
        yield* recordGameplayUnsupportedOperation(state, {
          _tag: 'Unsupported', action: 'MobDrop', reason: 'OwnerRegistrationUnavailable',
        })
        return false
      }
      const droppedSnapshot = yield* Effect.result(context.coordinator.snapshot(
        droppedItemsOwnerId,
        DroppedItemOwnerSnapshotSchema,
      ))
      if (Result.isFailure(droppedSnapshot)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: droppedSnapshot.failure,
        })
        return false
      }
      if (droppedSnapshot.success.revision !== entitySnapshot.revision) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
          error: new WorldRevisionConflict({
            expected: entitySnapshot.revision,
            actual: droppedSnapshot.success.revision,
          }),
        })
        return false
      }
      const appended = Result.getOrThrow(appendDroppedItemSpawns(
        droppedSnapshot.success.state,
        drops!.drops.map(({ item, count, at }) => ({ item, count, at })),
        entitySnapshot.revision,
      ))
      changes.push({ ownerId: droppedItemsOwnerId, state: appended })
    }
    if (changes.length === 0) return true

    const committed = yield* Effect.result(context.coordinator.commit({
      expectedRevision: entitySnapshot.revision,
      expectedDimensions: [],
      changes,
    }))
    if (Result.isFailure(committed)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'WorldCommit', subject: 'Player', error: committed.failure,
      })
      return false
    }
    if (drops?._tag === 'Unsupported') {
      yield* recordMobRuleIssues(state, 'MobDrop', drops.issues)
    }
    if (casualtyExperience?._tag === 'Unsupported') {
      yield* recordMobRuleIssues(state, 'MobExperience', casualtyExperience.issues)
    }
    if (damage.casualties.length > 0 && nextRollSeed !== undefined) yield* Ref.set(state.rollSeed, nextRollSeed)
    else if (rollSeedOverride !== undefined) yield* Ref.set(state.rollSeed, rollSeedOverride)
    if ((drops?.drops.length ?? 0) > 0) {
      yield* Ref.update(state.mobDrops, (pending) => [...pending, ...drops!.drops])
    }
    if ((casualtyExperience?.experience.length ?? 0) > 0) {
      yield* Ref.update(state.mobExperience, (pending) => [...pending, ...casualtyExperience!.experience])
    }
    if (event !== undefined && context.eventBus !== undefined) {
      const published = yield* Effect.result(context.eventBus.publish(event))
      if (Result.isFailure(published)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'EventPublish', subject: 'Player', error: published.failure,
        })
      }
    }
    return true
  })

const processBowShot = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  store: GameplayStageContext['store'],
  request: BowShotRequest,
  playerDead: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!Number.isFinite(request.chargeSecs) || request.chargeSecs < 0) {
      yield* recordGameplayRequestFault(state, 'ItemUse', request.requestId, 'InvalidBowChargeSecs')
      return
    }
    let powerLevel: EnchantmentLevelValue | undefined
    if (Object.hasOwn(request, 'powerLevel')) {
      const decoded = Schema.decodeUnknownResult(
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })).pipe(Schema.brand('EnchantmentLevel')),
      )(request.powerLevel)
      if (Result.isFailure(decoded)) {
        yield* recordGameplayRequestFault(state, 'ItemUse', request.requestId, 'InvalidBowPowerLevel')
        return
      }
      powerLevel = decoded.success
    }
    const result = (outcome: 'Fired' | 'Undercharged' | 'DuplicateRequest' | 'PlayerDead' | 'InventoryUnavailable') => {
      if (request.requestId === undefined) return Effect.void
      const entry: import('./registration-core.js').BowShotResult = outcome === 'Fired'
        ? { requestId: request.requestId, success: true, outcome }
        : { requestId: request.requestId, success: false, outcome }
      return Ref.update(state.bowShotResults, (results) => [...results, entry])
    }
    if (request.requestId !== undefined) {
      const handled = yield* Ref.get(state.handledBowShotRequestIds)
      if (handled.has(request.requestId)) {
        yield* result('DuplicateRequest')
        return
      }
    }
    if (!canFireBow(request.chargeSecs)) {
      yield* result('Undercharged')
      return
    }
    if (playerDead) {
      yield* result('PlayerDead')
      return
    }
    if (context === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'BowShot',
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        reason: 'WorldCommitCoordinatorUnavailable',
      })
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }
    if (
      context.entitiesOwnerId === undefined || context.playerOwnerId === undefined ||
      context.playerStorageOwnerId === undefined
    ) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'BowShot',
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        reason: 'OwnerRegistrationUnavailable',
      })
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }
    const player = yield* Effect.result(context.coordinator.snapshot(context.playerOwnerId, PlayerServiceSnapshotSchema))
    if (Result.isFailure(player)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player', error: player.failure,
      })
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }
    const entities = yield* Effect.result(context.coordinator.snapshot(context.entitiesOwnerId, GameplayEntityRosterSchema))
    if (Result.isFailure(entities)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player', error: entities.failure,
      })
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }
    if (player.success.revision !== entities.success.revision) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
        error: new WorldRevisionConflict({ expected: player.success.revision, actual: entities.success.revision }),
      })
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }

    const storage = yield* Effect.result(context.coordinator.snapshot(
      context.playerStorageOwnerId,
      PlayerStorageSnapshotSchema,
    ))
    if (Result.isFailure(storage)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player', error: storage.failure,
      })
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }
    if (storage.success.revision !== entities.success.revision) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
        error: new WorldRevisionConflict({ expected: entities.success.revision, actual: storage.success.revision }),
      })
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }
    const heldBow = storage.success.state.inventory.slots[request.inventory.slotIndex]
    if (heldBow?.item !== 'bow') {
      yield* result('InventoryUnavailable')
      return
    }
    const bowEnchantments: EnchantmentSource = heldBow.components?.enchantments ?? []
    const infinity = infinityPreventsArrowConsumption(bowEnchantments)
    let storageCandidate: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema> | undefined
    let seedAfterWear: number | undefined
    if (request.inventory.mode === 'survival') {
      const arrows = removeInventoryItem(storage.success.state.inventory, 'arrow', 1)
      if (Result.isFailure(arrows) || arrows.success.removed !== 1) {
        yield* result('InventoryUnavailable')
        return
      }
      const inventory = infinity
        ? storage.success.state
        : Result.getOrThrow(withInventory(storage.success.state, arrows.success.inventory))
      const currentSeed = yield* Ref.get(state.rollSeed)
      const unbreaking = enchantmentLevel(bowEnchantments, 'unbreaking')
      // The internal frame seed and fixed one-roll batch are valid roll inputs.
      const wearRolls = unbreaking > 0 ? Result.getOrThrow(drawRolls(currentSeed, 1)) : undefined
      const appliedWear = durabilityWearWithEnchantments(
        1,
        bowEnchantments,
        wearRolls?.rolls ?? [],
        'tool',
      )
      storageCandidate = appliedWear === 0
        ? inventory
        : damagePlayerStorageAt(inventory, {
          _tag: 'Inventory', slotIndex: request.inventory.slotIndex,
        }, appliedWear).storage
      if (wearRolls !== undefined) seedAfterWear = wearRolls.seed
    }

    const target = shotTargetWithCandidate(
      entities.success.state.entities,
      request.origin,
      {
        x: request.dirX,
        y: request.dirY,
        z: request.dirZ,
      },
    )
    let hit: Readonly<{
      id: import('@nerima-games/mc-kernel').EntityId
      damage: Damage
    lootingLevel: EnchantmentLevelValue
      burning?: boolean
    }> | undefined
    let knockback: KnockbackDirection | undefined
    if (target !== undefined) {
      const unitAim = { x: directionComponent(0), y: directionComponent(0), z: directionComponent(0) }
      normalizeDirection3(
        directionComponent(request.dirX),
        directionComponent(request.dirY),
        directionComponent(request.dirZ),
        unitAim,
      )
      const end = kernelPosition(
        PositionAxis(request.origin.x + unitAim.x * target.hit.distance),
        PositionAxis(request.origin.y + unitAim.y * target.hit.distance),
        PositionAxis(request.origin.z + unitAim.z * target.hit.distance),
      )
      const isBlockedAt = solidityFromStore(store)
      let terrainFailure: EntityWorldQueryFailure | undefined
      const blocked = shotBlockedByTerrain((x, y, z) => {
        const blockResult = isBlockedAt({ x, y, z })
        if (Result.isFailure(blockResult)) {
          terrainFailure ??= blockResult.failure
          return true
        }
        return blockResult.success
      }, request.origin, end)
      if (terrainFailure !== undefined) {
        yield* recordGameplayEntityWorldDataFault(state, 'ProjectileLineOfSight', terrainFailure)
        yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
        return
      }
      if (!blocked) {
        const damageEnchantments: EnchantmentSource = powerLevel === undefined
          ? bowEnchantments
          : [{ id: 'power', level: powerLevel }]
        // The request decoder bounds charge and enchantment levels before this finite calculation.
        const amount = DamageAmount(bowDamageWithEnchantments(
          bowDamage(bowCharge(request.chargeSecs)),
          damageEnchantments,
        ))
        const flame = flameDurationTicks(bowEnchantments) > 0
        const pose = player.success.state.pose.feetPosition
        const direction = knockbackDirection(
          target.candidate.feetPosition.x - pose.x,
          target.candidate.feetPosition.z - pose.z,
        )
        if (Result.isFailure(direction)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'CandidateBuild', subject: 'Entities', error: direction.failure,
          })
        } else {
          hit = {
            id: target.hit.id,
            damage: { amount, cause: 'projectile' },
            lootingLevel: lootingLevel(bowEnchantments),
            ...(flame ? { burning: true } : {}),
          }
          knockback = direction.success
        }
      }
    }

    let damageEvent: Schema.Schema.Type<typeof DomainEventSchema> | undefined
    if (hit !== undefined && target !== undefined) {
      const tick = yield* Ref.get(state.tickCount)
      const position = Schema.decodeUnknownSync(WorldPositionSchema)({
        dimension: player.success.state.pose.feetPosition.dimension,
        x: target.candidate.feetPosition.x,
        y: target.candidate.feetPosition.y,
        z: target.candidate.feetPosition.z,
      })
      const event = Schema.decodeUnknownSync(DomainEventSchema)({
        _tag: 'EntityDamaged', tick, entity: hit.id,
        position, amount: hit.damage.amount, cause: 'projectile',
      })
      damageEvent = event
    }

    const committed = yield* commitMobDamage(
      state,
      context,
      entities.success,
      player.success.state.pose.feetPosition.dimension,
      hit === undefined ? undefined : { ...hit, killCredit: 'player' },
      storageCandidate,
      damageEvent,
      seedAfterWear,
    )
    if (!committed) {
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }
    if (hit !== undefined && knockback !== undefined) {
      const punchStrength = punchKnockbackBonus(bowEnchantments)
      yield* Ref.update(state.bowKnockbacks, (pending) => [...pending, {
        id: hit.id,
        direction: knockback,
        ...(punchStrength === 0 ? {} : { strength: punchStrength }),
      }])
      if (flameDurationTicks(bowEnchantments) > 0 && target !== undefined &&
        Number(target.candidate.healthPoints) > hit.damage.amount) {
        yield* igniteMobAfterCommit(
          state,
          hit.id,
          target.candidate.feetPosition,
          flameDurationTicks(bowEnchantments),
        )
      }
    }
    if (request.requestId !== undefined) {
      yield* Ref.update(state.handledBowShotRequestIds, (handled) => new Set(handled).add(request.requestId!))
    }
    yield* result('Fired')
  })

const processMeleeAttack = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  request: MeleeAttackRequest,
  playerDead: boolean,
): Effect.Effect<void> => Effect.gen(function* () {
    const recordFailure = (outcome?: 'InvalidToolLocation') => {
      const requestId = request.requestId
      if (requestId === undefined) return Effect.void
      const failure: import('./registration-core.js').GameplayMeleeAttackResult = {
        requestId,
        success: false,
        ...(outcome === undefined ? {} : { outcome }),
      }
      return Ref.update(state.meleeAttackResults, (results) => [...results, failure])
    }
    if (playerDead) {
      if (request.requestId !== undefined) {
        const result: import('./registration-core.js').GameplayMeleeAttackResult = {
          requestId: request.requestId,
          success: false,
          outcome: 'PlayerDead',
        }
        yield* Ref.update(state.meleeAttackResults, (results) => [...results, result])
      }
      return
    }
    let blockDistance: AttackRangeDistance | undefined
    if (Object.hasOwn(request, 'hitDistance')) {
      const rawDistance = request.hitDistance
      const validatedDistance = typeof rawDistance === 'number'
        ? AttackRangeDistance.result(rawDistance)
        : undefined
      if (validatedDistance === undefined || Result.isFailure(validatedDistance)) {
        const failure: MeleeTargetInputFailure = { _tag: 'InvalidMeleeTargetInput', field: 'hitDistance' }
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Entities', error: failure,
        })
        yield* recordFailure()
        return
      }
      blockDistance = validatedDistance.success
    }
    const storageOwnerId = context?.playerStorageOwnerId
    if (
      context === undefined || context.entitiesOwnerId === undefined || context.playerOwnerId === undefined ||
      (request.toolLocation !== undefined && storageOwnerId === undefined)
    ) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'MeleeAttack',
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        reason: context === undefined ? 'WorldCommitCoordinatorUnavailable' : 'OwnerRegistrationUnavailable',
      })
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    const toolLocation = request.toolLocation
    if (toolLocation !== undefined && !isMeleeToolLocation(toolLocation)) {
      yield* recordFailure('InvalidToolLocation')
      return
    }
    const entities = yield* Effect.result(context.coordinator.snapshot(context.entitiesOwnerId, GameplayEntityRosterSchema))
    if (Result.isFailure(entities)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player', error: entities.failure,
      })
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    const player = yield* Effect.result(context.coordinator.snapshot(context.playerOwnerId, PlayerServiceSnapshotSchema))
    if (Result.isFailure(player)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player', error: player.failure,
      })
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    if (player.success.revision !== entities.success.revision) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
        error: new WorldRevisionConflict({ expected: entities.success.revision, actual: player.success.revision }),
      })
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    const decodedTick = Schema.decodeUnknownResult(SimulationTickSchema)(yield* Ref.get(state.tickCount))
    if (Result.isFailure(decodedTick)) {
      yield* recordFailure()
      return
    }
    const tick = decodedTick.success
    const lastAttackTick = yield* Ref.get(state.meleeLastAttackTick)
    const ticksSinceLastAttack = Schema.decodeUnknownResult(MeleeCooldownTicksSchema)(
      lastAttackTick === null ? 25 : tick - lastAttackTick,
    )
    if (Result.isFailure(ticksSinceLastAttack)) {
      yield* recordFailure()
      return
    }
    let heldItem: ItemType | null = null
    let heldEnchantments: EnchantmentSource = []
    let storageCandidate: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema> | undefined
    let seedAfterWear: number | undefined
    if (toolLocation !== undefined) {
      const storage = yield* Effect.result(context.coordinator.snapshot(
        storageOwnerId!,
        PlayerStorageSnapshotSchema,
      ))
      if (Result.isFailure(storage)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player', error: storage.failure,
        })
        yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
        return
      }
      if (storage.success.revision !== entities.success.revision) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player',
          error: new WorldRevisionConflict({ expected: entities.success.revision, actual: storage.success.revision }),
        })
        yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
        return
      }
      const weapon = validatedMeleeWeaponAt(storage.success.state, toolLocation)
      heldItem = weapon.item
      const heldStack = storage.success.state.inventory.slots[toolLocation.slotIndex]
      heldEnchantments = heldStack?.components?.enchantments ?? []
      if (weapon.wear > 0) {
        const unbreaking = enchantmentLevel(heldEnchantments, 'unbreaking')
        const currentSeed = yield* Ref.get(state.rollSeed)
        // The internal frame seed and the snapshot's branded ItemDamage wear are valid roll inputs.
        const wearRolls = unbreaking > 0 ? Result.getOrThrow(drawRolls(currentSeed, weapon.wear)) : undefined
        const appliedWear = durabilityWearWithEnchantments(
          weapon.wear,
          heldEnchantments,
          wearRolls?.rolls ?? [],
          'tool',
        )
        storageCandidate = appliedWear === 0
          ? storage.success.state
          : damageValidatedMeleeWeaponAt(weapon, appliedWear)
        if (wearRolls !== undefined) seedAfterWear = wearRolls.seed
      }
    }
    const intent: MeleeAttackIntent = {
      _tag: 'MeleeAttack',
      actor: EntityId('mx-gameplay:player-avatar'),
    }
    const preparationInput = {
      tick,
      dimension: player.success.state.pose.feetPosition.dimension,
      pose: player.success.state.pose,
      entities: entities.success.state.entities,
      heldItem,
      critical: false,
      ticksSinceLastAttack: ticksSinceLastAttack.success,
      targetDamageState: null,
      ...(blockDistance === undefined ? {} : { blockDistance }),
    }
    const targetDamageStates = yield* Ref.get(state.meleeTargetDamageStates)
    const initialPreparation = prepareMeleeAttack(intent, preparationInput)
    if (Result.isFailure(initialPreparation)) {
      yield* recordFailure()
      return
    }
    // `prepareMeleeAttack` selected this ID from the same unchanged roster.
    const targetEntity = entities.success.state.entities.find(
      (entity) => entity.id === initialPreparation.success.target.id,
    )!
    const statusModifiers = yield* Ref.get(state.playerStatusEffectModifiers)
    // Both operands are finite: enchantment levels come from decoded storage,
    // and status modifiers are computed from validated effect state.
    const damageBonus = Brand.nominal<AttackDamageBonus>()(
      meleeDamageWithEnchantments(
        0,
        heldEnchantments,
        meleeEnchantmentTarget(targetEntity.kind),
      ) + statusModifiers.attackDamageBonus,
    )
    const previousTargetDamageState = targetDamageStates.get(initialPreparation.success.target.id) ?? null
    const preparation = prepareMeleeAttack(intent, {
      ...preparationInput,
      damageBonus,
      targetDamageState: previousTargetDamageState,
    })
    if (Result.isFailure(preparation)) {
      if (preparation.failure === 'target-invulnerable') {
        yield* Ref.set(state.meleeLastAttackTick, tick)
      }
      yield* recordFailure()
      return
    }
    const committed = yield* commitMobDamage(
      state,
      context,
      entities.success,
      player.success.state.pose.feetPosition.dimension,
      {
        id: preparation.success.target.id,
        damage: { amount: preparation.success.event.amount, cause: 'mob' },
        killCredit: 'player',
        lootingLevel: lootingLevel(heldEnchantments),
        ...(fireAspectDurationTicks(heldEnchantments) > 0 ? { burning: true } : {}),
      },
      storageCandidate,
      preparation.success.event,
      seedAfterWear,
    )
    if (!committed) {
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    yield* Ref.set(state.meleeLastAttackTick, tick)
    yield* Ref.set(state.meleeTargetDamageStates, new Map(targetDamageStates).set(
      preparation.success.target.id,
      preparation.success.targetDamageState,
    ))
    const knockback = knockbackLevel(heldEnchantments)
    if (knockback > 0) {
      // The decoded enchantment table bounds this level before multiplication.
      const strength = Brand.nominal<KnockbackStrength>()(3 * knockback)
      yield* Ref.update(state.meleeKnockbacks, (pending) => [...pending, {
        id: preparation.success.target.id,
        direction: preparation.success.knockback,
        strength,
      }])
    }
    const fireDuration = fireAspectDurationTicks(heldEnchantments)
    if (fireDuration > 0 && targetEntity !== undefined &&
      Number(targetEntity.healthPoints) > preparation.success.event.amount) {
      yield* igniteMobAfterCommit(
        state,
        preparation.success.target.id,
        targetEntity.feetPosition,
        fireDuration,
      )
    }
    if (request.requestId !== undefined) {
      const result: import('./registration-core.js').GameplayMeleeAttackResult = {
        requestId: request.requestId,
        success: true,
        target: preparation.success.target,
      }
      yield* Ref.update(state.meleeAttackResults, (results) => [...results, result])
    }
  })

const advanceCropLifecycle = (
  state: GameplayStageContext['state'],
  commit: GameplayStageContext['commit'],
  blockStateWorld: GameplayStageContext['blockStateWorld'],
  dt: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (dt === 0 || commit === undefined || commit.cropOwnerId === undefined) return
    const snapshot = yield* Effect.result(commit.coordinator.snapshot(commit.cropOwnerId, CropSnapshotSchema))
    if (Result.isFailure(snapshot)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'ItemUse',
        error: snapshot.failure,
      })
      return
    }
    const previousCrops = snapshot.success.state.crops
    const progress = previousCrops.map((previous) => ({ previous, next: advanceCrop(previous, dt) }))
    const crops = progress.map(({ next }) => next)
    const changed = progress.some(({ previous, next }) => next.growthSecs !== previous.growthSecs)
    const stageAdvanced = progress.some(({ previous, next }) => cropTargetAge(next) > cropTargetAge(previous))
    const candidate = cropCandidate(commit.cropOwnerId, crops)
    let ownerWritePending = changed && stageAdvanced
    const commitOwner = () => Effect.result(commit.coordinator.commit({
      expectedRevision: snapshot.success.revision,
      expectedDimensions: [],
      changes: [candidate],
    }))
    const onOwnerApplied = () => {
      ownerWritePending = false
    }
    if (changed && !stageAdvanced) {
      const committed = yield* commitOwner()
      if (Result.isFailure(committed)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed',
          operation: 'WorldCommit',
          subject: 'ItemUse',
          error: committed.failure,
        })
        return
      }
    }
    for (const crop of crops) {
      yield* projectCropAge(
        state,
        blockStateWorld,
        crop,
        onOwnerApplied,
        ownerWritePending ? [candidate] : undefined,
        ownerWritePending ? snapshot.success.revision : undefined,
      )
    }
    if (ownerWritePending) {
      const committed = yield* commitOwner()
      if (Result.isFailure(committed)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed',
          operation: 'WorldCommit',
          subject: 'ItemUse',
          error: committed.failure,
        })
      }
    }
  })

const commitPlanFragments = (
  state: GameplayStageContext['state'],
  context: NonNullable<GameplayStageContext['commit']>,
  subject: 'Fishing' | 'Brewing',
  action: 'Fishing' | 'Brewing' | 'CollectBrewingBottle',
  requestId: string,
  plans: ReadonlyArray<WorldCommitPlanFragment<unknown>>,
  onCommitted: () => Effect.Effect<void>,
  onRetry: () => Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const merged = mergeWorldCommitPlans(plans)
    if (Result.isFailure(merged)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'PlanBuild',
        subject,
        error: merged.failure,
      })
      yield* onRetry()
      return
    }
    const events = plans.flatMap((plan) => plan.postCommitEvents)
    if (events.length > 0 && context.eventBus === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported',
        action,
        requestId,
        reason: 'OwnerRegistrationUnavailable',
      })
      return
    }
    const committed = yield* Effect.result(context.coordinator.commit(merged.success))
    if (Result.isFailure(committed)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'WorldCommit',
        subject,
        error: committed.failure,
      })
      yield* onRetry()
      return
    }
    if (context.eventBus !== undefined) {
      for (const event of events) {
        const published = yield* Effect.result(context.eventBus.publish(event))
        if (Result.isFailure(published)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed',
            operation: 'EventPublish',
            subject,
            error: published.failure,
          })
        }
      }
    }
    yield* onCommitted()
  })

const processFishingItemUse = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  request: FishingItemUseRequest,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (context === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'Fishing', requestId: request.requestId,
        reason: 'WorldCommitCoordinatorUnavailable',
      })
      return
    }
    if (
      context.fishingOwnerId === undefined ||
      context.fishingService === undefined ||
      context.playerStorageOwnerId === undefined
    ) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'Fishing', requestId: request.requestId,
        reason: 'OwnerRegistrationUnavailable',
      })
      return
    }
    const observed = yield* Effect.result(context.coordinator.observe(
      context.fishingOwnerId,
      FishingStateSchema,
      [],
    ))
    if (Result.isFailure(observed)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: observed.failure,
      })
      return
    }
    const snapshot = {
      world: observed.success.world,
      expectedRevision: observed.success.revision,
      expectedDimensions: [],
      state: observed.success.state,
    }
    const enchantmentsOwnerId = context.fishingEnchantmentsOwnerId ?? GAMEPLAY_FISHING_ENCHANTMENTS_OWNER_ID
    const enchantmentsObserved = yield* Effect.result(context.coordinator.observe(
      enchantmentsOwnerId,
      GameplayFishingEnchantmentsSnapshotSchema,
      [],
    ))
    if (Result.isFailure(enchantmentsObserved)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: enchantmentsObserved.failure,
      })
      return
    }
    const enchantmentRecords = enchantmentsObserved.success.state.records
    const recordedEnchantments = enchantmentRecords.find((record) => record.actor === request.actor)
    const enchantmentsPlan = (
      records: typeof enchantmentRecords,
    ): WorldCommitPlanFragment<unknown> => ({
      world: enchantmentsObserved.success.world,
      expectedRevision: enchantmentsObserved.success.revision,
      expectedDimensions: [],
      changes: [{ ownerId: enchantmentsOwnerId, state: { records } }],
      result: undefined,
      postCommitEvents: [],
    })

    let plans: Array<WorldCommitPlanFragment<unknown>> = []
    let outcome: import('@nerima-games/mc-sim').FishingProgressOutcome |
      import('@nerima-games/mc-sim').FishingCancelOutcome |
      import('@nerima-games/mc-sim').FishingReelOutcome |
      undefined
    let nextSeed: number | undefined
    let projectilePlan: WorldCommitPlanFragment<unknown> | undefined
    let heldRod: Pick<EquipmentItem, 'components'> | undefined
    const activeRod = snapshot.state.rods.find((rod) => rod.actor === request.actor)
    let removeBobber: import('@nerima-games/mc-kernel').ProjectileId | undefined
    let playerStoragePlan: PlayerStorageCommitSnapshot | undefined
    if (request.action === 'ReelFishing' && request.toolLocation !== undefined) {
      const storageObserved = yield* Effect.result(context.coordinator.observe(
        context.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
        [],
      ))
      if (Result.isFailure(storageObserved)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: storageObserved.failure,
        })
        return
      }
      const rod = validatedFishingRodAt(storageObserved.success.state, request.toolLocation)
      if (rod === undefined) {
        const result = Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)({
          action: 'ReelFishing',
          requestId: request.requestId,
          success: false,
          failure: 'InvalidHeldItem',
        })
        yield* Ref.update(state.itemUseResults, (results) => [...results, result])
        return
      }
      heldRod = rod.rod
      playerStoragePlan = {
        world: storageObserved.success.world,
        expectedRevision: storageObserved.success.revision,
        expectedDimensions: [],
        state: damageValidatedFishingRodAt(rod),
      }
    }
    let enchantments: FishingEnchantments | undefined = recordedEnchantments
    if (
      enchantments === undefined &&
      activeRod !== undefined &&
      (request.action === 'AdvanceFishing' || request.action === 'ReelFishing')
    ) {
      const rebuilt = yield* rebuildFishingEnchantments(state, context, request, activeRod.bobber, heldRod)
      if (rebuilt === undefined) return
      enchantments = rebuilt
    }
    if (request.action === 'CastFishing') {
        const cast = yield* Effect.result(context.fishingService.planCast(snapshot, {
          actor: request.actor,
          bobber: request.bobber,
        }))
        if (Result.isFailure(cast)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: cast.failure,
          })
          return
        }
        plans = [cast.success]
        outcome = undefined

        const projectileOwnerId = context.projectileOwnerId ?? PROJECTILE_REPLICATED_OWNER_ID
        const projectileObserved = yield* Effect.result(context.coordinator.observe(
          projectileOwnerId,
          ProjectileServiceSnapshotSchema,
          [],
        ))
        if (Result.isFailure(projectileObserved)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: projectileObserved.failure,
          })
          return
        }
        const projectile = launchProjectile({ ...request.launch, shooterId: request.actor })
        const projectileCandidate = Schema.decodeUnknownResult(ProjectileServiceSnapshotSchema.check(
          Schema.makeFilter((candidate) => {
            const ids = candidate.projectiles.map((entry) => entry.id)
            return new Set(ids).size === ids.length
          }),
        ))({
          projectiles: [...projectileObserved.success.state.projectiles, {
            id: request.bobber,
            dimension: request.dimension,
            shooter: request.actor,
            kind: 'projectile',
            profile: request.profile,
            projectile,
          }],
        })
        if (Result.isFailure(projectileCandidate)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'CandidateBuild', subject: 'Fishing', error: projectileCandidate.failure,
          })
          return
        }
        const projectileSnapshot = {
          world: projectileObserved.success.world,
          expectedRevision: projectileObserved.success.revision,
          expectedDimensions: [],
          state: projectileObserved.success.state,
        }
        const projectileFragment = {
          world: projectileSnapshot.world,
          expectedRevision: projectileSnapshot.expectedRevision,
          expectedDimensions: projectileSnapshot.expectedDimensions,
          changes: [{ ownerId: projectileOwnerId, state: projectileCandidate.success }],
          result: undefined,
          postCommitEvents: [],
        }
        projectilePlan = projectileFragment
        plans.push(projectilePlan)
        plans.push(enchantmentsPlan([
          ...enchantmentRecords.filter((record) => record.actor !== request.actor),
          { actor: request.actor, ...fishingEnchantmentsForRod(request.rod, request.environment.isOpenWater) },
        ]))
    } else if (request.action === 'AdvanceFishing') {
        const requestedWaitTicks = Schema.decodeUnknownResult(FishingWaitTicksSchema)(request.waitTicks)
        if (Result.isFailure(requestedWaitTicks)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: requestedWaitTicks.failure,
          })
          return
        }
        // Without an active cast planAdvance rejects the request, so there is no wait to adjust.
        const adjustedWaitTicks = enchantments === undefined
          ? requestedWaitTicks.success
          : fishingWaitTicksWithLure(requestedWaitTicks.success, enchantments.lureLevel)
        const intent = {
          actor: request.actor,
          elapsedTicks: request.elapsedTicks,
          waitTicks: adjustedWaitTicks,
          approachTicks: request.approachTicks,
          biteWindowTicks: request.biteWindowTicks,
          hasWater: request.environment.hasWater,
        }
        const advance = yield* Effect.result(context.fishingService.planAdvance(snapshot, intent))
        if (Result.isFailure(advance)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: advance.failure,
          })
          return
        }
        plans = [advance.success]
        outcome = advance.success.result
        if (outcome._tag === 'Cancelled') removeBobber = outcome.bobber
    } else if (request.action === 'CancelFishing') {
        const cancel = yield* Effect.result(context.fishingService.planCancel(snapshot, { actor: request.actor }))
        if (Result.isFailure(cancel)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: cancel.failure,
          })
          return
        }
        plans = [cancel.success]
        outcome = cancel.success.result
        removeBobber = cancel.success.result.bobber
    } else {
        const tick = Schema.decodeUnknownSync(SimulationTickSchema)(yield* Ref.get(state.tickCount))
        const seed = yield* Ref.get(state.rollSeed)
        // The internal frame seed and fixed one-roll batch guarantee an existing sample.
        const sampled = Result.getOrThrow(Result.flatMap(drawRolls(seed, 1), (batch) =>
          Result.map(rollAt(batch, 0), (roll) => ({ seed: batch.seed, roll })),
        ))
        const baseSample = Schema.decodeUnknownSync(FishingLootSampleSchema)(sampled.roll)
        // Without an active cast planReel rejects the request, so there is no sample to adjust.
        const sample = enchantments === undefined
          ? baseSample
          : Schema.decodeUnknownSync(FishingLootSampleSchema)(
            fishingLootSampleWithLuckOfTheSea(
              baseSample,
              enchantments.luckOfTheSeaLevel,
              enchantments.openWater,
            ),
          )
        const intent = {
          actor: request.actor,
          tick,
          sample,
        }
        const reel = yield* Effect.result(context.fishingService.planReel(snapshot, intent))
        if (Result.isFailure(reel)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: reel.failure,
          })
          return
        }
        plans = [reel.success]
        outcome = reel.success.result
        removeBobber = activeRod?.bobber
        if (request.toolLocation !== undefined || reel.success.result._tag === 'Caught') {
          if (playerStoragePlan === undefined) {
            const storageObserved = yield* Effect.result(context.coordinator.observe(
              context.playerStorageOwnerId,
              PlayerStorageSnapshotSchema,
              [],
            ))
            if (Result.isFailure(storageObserved)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: storageObserved.failure,
              })
              return
            }
            playerStoragePlan = {
              world: storageObserved.success.world,
              expectedRevision: storageObserved.success.revision,
              expectedDimensions: [],
              state: storageObserved.success.state,
            }
          }
          let playerStorage = playerStoragePlan.state

          if (reel.success.result._tag === 'Caught') {
            const caughtStack = singleItemStack(reel.success.result.item)
            const stored = addStoredStack(playerStorage, {
              ...caughtStack,
              durability: null,
            })
            if (stored.result._tag !== 'Added' || stored.result.added !== 1) {
              yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
              return
            }
            playerStorage = stored.storage
          }

          const storagePlan = {
            world: playerStoragePlan.world,
            expectedRevision: playerStoragePlan.expectedRevision,
            expectedDimensions: playerStoragePlan.expectedDimensions,
            changes: [{ ownerId: context.playerStorageOwnerId, state: playerStorage }],
            result: undefined,
            postCommitEvents: [],
          }
          plans.push(storagePlan)
        }
        nextSeed = sampled.seed
    }

    const castEnds = request.action === 'CancelFishing' ||
      request.action === 'ReelFishing' ||
      (request.action === 'AdvanceFishing' && outcome?._tag === 'Cancelled')
    if (castEnds && recordedEnchantments !== undefined) {
      plans.push(enchantmentsPlan(enchantmentRecords.filter((record) => record.actor !== request.actor)))
    }

    if (removeBobber !== undefined) {
      const projectileOwnerId = context.projectileOwnerId ?? PROJECTILE_REPLICATED_OWNER_ID
      const projectiles = yield* Effect.result(context.coordinator.observe(
        projectileOwnerId,
        ProjectileServiceSnapshotSchema,
        [],
      ))
      if (Result.isFailure(projectiles)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fishing', error: projectiles.failure,
        })
        return
      }
      const before = projectiles.success.state.projectiles
      const after = before.filter((projectile) => projectile.id !== removeBobber)
      if (before.length === after.length) {
        yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
        return
      }
      const candidate = { projectiles: after }
      const projectileSnapshot = {
        world: projectiles.success.world,
        expectedRevision: projectiles.success.revision,
        expectedDimensions: [],
        state: projectiles.success.state,
      }
      const fragment = {
        world: projectileSnapshot.world,
        expectedRevision: projectileSnapshot.expectedRevision,
        expectedDimensions: projectileSnapshot.expectedDimensions,
        changes: [{ ownerId: projectileOwnerId, state: candidate }],
        result: undefined,
        postCommitEvents: [],
      }
      plans.push(fragment)
    }

    const result = Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)({
      action: request.action,
      requestId: request.requestId,
      success: true,
      outcome,
    })
    yield* commitPlanFragments(
      state,
      context,
      'Fishing',
      'Fishing',
      request.requestId,
      plans,
      () => Effect.gen(function* () {
        if (nextSeed !== undefined) yield* Ref.set(state.rollSeed, nextSeed)
        yield* Ref.update(state.itemUseResults, (results) => [...results, result])
      }),
      () => Ref.update(state.pendingItemUses, (pending) => [request, ...pending]),
    )
  })

const processBrewingBottleCollection = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  request: CollectBrewingBottleRequest,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (context === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'CollectBrewingBottle', requestId: request.requestId,
        reason: 'WorldCommitCoordinatorUnavailable',
      })
      return
    }
    if (
      context.brewingOwnerId === undefined ||
      context.playerStorageOwnerId === undefined ||
      context.brewingService === undefined
    ) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'CollectBrewingBottle', requestId: request.requestId,
        reason: 'OwnerRegistrationUnavailable',
      })
      return
    }
    const brewingObserved = yield* Effect.result(context.coordinator.observe(
      context.brewingOwnerId,
      BrewingServiceStateSchema,
      [],
    ))
    if (Result.isFailure(brewingObserved)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing', error: brewingObserved.failure,
      })
      return
    }
    const storageObserved = yield* Effect.result(context.coordinator.observe(
      context.playerStorageOwnerId,
      PlayerStorageSnapshotSchema,
      [],
    ))
    if (Result.isFailure(storageObserved)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing', error: storageObserved.failure,
      })
      return
    }
    const brewingSnapshot = {
      world: brewingObserved.success.world,
      expectedRevision: brewingObserved.success.revision,
      expectedDimensions: [],
      state: brewingObserved.success.state,
    }
    const bottleIndex = Schema.decodeUnknownSync(BrewingBottleIndexSchema)(request.bottleIndex)
    const bottle = brewingSnapshot.state.bottles[bottleIndex]
    if (bottle === undefined) {
      const emptyResult = Schema.decodeUnknownSync(GameplayBrewingBottleItemUseResultSchema)({
        action: 'CollectBrewingBottle', requestId: request.requestId, success: false,
        outcome: { _tag: 'Empty' },
      })
      yield* Ref.update(state.itemUseResults, (results) => [...results, emptyResult])
      return
    }
    const inserted = addStoredStack(storageObserved.success.state, {
      ...bottle,
      durability: null,
    })
    if (inserted.result._tag === 'InvalidStack' || inserted.result._tag === 'ItemStackFailure') {
      const invalidResult = Schema.decodeUnknownSync(GameplayBrewingBottleItemUseResultSchema)({
        action: 'CollectBrewingBottle', requestId: request.requestId, success: false,
        outcome: { _tag: 'InvalidStack' },
      })
      yield* Ref.update(state.itemUseResults, (results) => [...results, invalidResult])
      return
    }
    if (inserted.result.added === 0) {
      const fullResult = Schema.decodeUnknownSync(GameplayBrewingBottleItemUseResultSchema)({
        action: 'CollectBrewingBottle', requestId: request.requestId, success: false,
        outcome: { _tag: 'InventoryFull', item: bottle.item, count: bottle.count },
      })
      yield* Ref.update(state.itemUseResults, (results) => [...results, fullResult])
      return
    }
    const pickupCount = Result.getOrThrow(StackCount.result(inserted.result.added))
    const event = Schema.decodeUnknownSync(DomainEventSchema)({
      _tag: 'ItemPickedUp',
      tick: request.tick,
      actor: request.actor,
      source: { _tag: 'BrewingStand', address: request.address },
      item: itemIdOf(bottle.item),
      count: pickupCount,
    })
    const remaining = inserted.result.leftover
    const bottlePlan = yield* Effect.result(context.brewingService.planSetBottle(
      brewingSnapshot,
      bottleIndex,
      remaining ?? undefined,
    ))
    if (Result.isFailure(bottlePlan)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: bottlePlan.failure,
      })
      return
    }
    const storagePlan = {
      world: storageObserved.success.world,
      expectedRevision: storageObserved.success.revision,
      expectedDimensions: [],
      changes: [{ ownerId: context.playerStorageOwnerId, state: inserted.storage }],
      result: undefined,
      postCommitEvents: [event],
    }
    const result = Schema.decodeUnknownSync(GameplayBrewingBottleItemUseResultSchema)({
      action: 'CollectBrewingBottle', requestId: request.requestId, success: true,
      outcome: {
        _tag: 'Collected',
        item: bottle.item,
        count: inserted.result.added,
        remainingCount: remaining?.count ?? 0,
      },
    })
    yield* commitPlanFragments(
      state,
      context,
      'Brewing',
      'CollectBrewingBottle',
      request.requestId,
      [bottlePlan.success, storagePlan],
      () => Ref.update(state.itemUseResults, (results) => [...results, result]),
      () => Ref.update(state.pendingItemUses, (pending) => [request, ...pending]),
    )
  })

const recordBrewingItemUseResult = (
  state: GameplayStageContext['state'],
  result: BrewingItemUseResult,
): Effect.Effect<void> =>
  Ref.update(state.itemUseResults, (results) => [...results, result])

const processBrewingItemUse = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  request: BrewingItemUseRequest,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (context === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'Brewing', requestId: request.requestId,
        reason: 'WorldCommitCoordinatorUnavailable',
      })
      return
    }
    if (context.brewingService === undefined || context.playerStorageOwnerId === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'Brewing', requestId: request.requestId,
        reason: 'OwnerRegistrationUnavailable',
      })
      return
    }

    const retry = () => Ref.update(state.pendingItemUses, (pending) => [request, ...pending])

    if (request.action === 'DrinkPotion') {
      const storageOwnerId = context.playerStorageOwnerId
      const storage = yield* Effect.result(context.coordinator.observe(
        storageOwnerId,
        PlayerStorageSnapshotSchema,
        [],
      ))
      if (Result.isFailure(storage)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing', error: storage.failure,
        })
        return
      }
      const planSnapshot = {
        world: storage.success.world,
        expectedRevision: storage.success.revision,
        expectedDimensions: [],
        state: storage.success.state,
      }
      const slotIndex = Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(request.slotIndex)
      const intent = {
        inventoryOwnerId: storageOwnerId,
        actor: request.actor,
        slotIndex,
        tick: request.tick,
      }
      const planned = yield* Effect.result(context.brewingService.planDrinkPotion(
        planSnapshot,
        intent,
      ))
      if (Result.isFailure(planned)) {
        const drinkFailure = Schema.decodeUnknownResult(PotionDrinkFailureSchema)(planned.failure)
        if (Result.isSuccess(drinkFailure)) {
          yield* recordBrewingItemUseResult(state, {
            action: 'DrinkPotion', requestId: request.requestId,
            success: false, failure: drinkFailure.success,
          })
        } else {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: planned.failure,
          })
        }
        return
      }
      const drinkPlan = planned.success
      const plans: Array<WorldCommitPlanFragment<unknown>> = [drinkPlan]
      let statusCandidate: Schema.Schema.Type<typeof ValidatedStatusEffectStateSchema> | undefined
      if (drinkPlan.result._tag === 'Consumed') {
        if (context.statusEffectsOwnerId === undefined) {
          yield* recordGameplayUnsupportedOperation(state, {
            _tag: 'Unsupported', action: 'Brewing', requestId: request.requestId,
            reason: 'OwnerRegistrationUnavailable',
          })
          return
        }
        const observedEffects = yield* Effect.result(context.coordinator.observe(
          context.statusEffectsOwnerId,
          ValidatedStatusEffectStateSchema,
          [],
        ))
        if (Result.isFailure(observedEffects)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing', error: observedEffects.failure,
            requestId: request.requestId,
          })
          return
        }
        const validatedApplication = persistentStatusEffectApplicationFromValidatedFields(
          drinkPlan.result.effect,
        )
        const applied = applyStatusEffectToValidatedState(
          observedEffects.success.state,
          validatedApplication,
        )
        const nextEffects = applied.state
        const effectSnapshot = {
          world: observedEffects.success.world,
          expectedRevision: observedEffects.success.revision,
          expectedDimensions: [],
          state: observedEffects.success.state,
        }
        const effectPlan = {
          world: effectSnapshot.world,
          expectedRevision: effectSnapshot.expectedRevision,
          expectedDimensions: effectSnapshot.expectedDimensions,
          changes: [{ ownerId: context.statusEffectsOwnerId, state: nextEffects }],
          result: undefined,
          postCommitEvents: [],
        }
        statusCandidate = nextEffects
        plans.push(effectPlan)
      }
      const result = Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)({
        action: 'DrinkPotion', requestId: request.requestId,
        success: true, outcome: drinkPlan.result,
      })
      yield* commitPlanFragments(
        state,
        context,
        'Brewing',
        'Brewing',
        request.requestId,
        plans,
        () => Effect.gen(function* () {
          if (statusCandidate !== undefined) {
            const modifiers = statusEffectModifiers(statusCandidate)
            yield* Ref.set(state.playerMovementSpeedMultiplier, modifiers.movementSpeedMultiplier)
            yield* Ref.set(state.playerStatusEffectModifiers, modifiers)
          }
          yield* Ref.update(state.itemUseResults, (results) => [...results, result])
        }),
        retry,
      )
      return
    }

    if (context.brewingOwnerId === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'Brewing', requestId: request.requestId,
        reason: 'OwnerRegistrationUnavailable',
      })
      return
    }
    const brewingOwnerId = context.brewingOwnerId
    const [brewing, storage] = yield* Effect.all([
      Effect.result(context.coordinator.observe(brewingOwnerId, BrewingServiceStateSchema, [])),
      Effect.result(context.coordinator.observe(context.playerStorageOwnerId, PlayerStorageSnapshotSchema, [])),
    ])
    if (Result.isFailure(brewing)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing', error: brewing.failure,
      })
      return
    }
    if (Result.isFailure(storage)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing', error: storage.failure,
      })
      return
    }
    if (brewing.success.revision !== storage.success.revision) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing',
        error: new WorldRevisionConflict({
          expected: brewing.success.revision,
          actual: storage.success.revision,
        }),
      })
      yield* retry()
      return
    }
    const brewingSnapshot = {
      world: brewing.success.world,
      expectedRevision: brewing.success.revision,
      expectedDimensions: [],
      state: brewing.success.state,
    }

    const recordRejected = (failure: 'MissingItem' | 'Occupied' | 'InvalidRecipe' | 'Brewing' | 'FuelFull') =>
      recordBrewingItemUseResult(state, {
        action: request.action,
        requestId: request.requestId,
        success: false,
        failure,
      })

    let requestedItem: import('@nerima-games/mc-kernel').ItemType
    let fragments: Array<WorldCommitPlanFragment<unknown>> = []
    if (request.action === 'InsertBrewingFuel') {
      if (brewing.success.state.fuelCharges >= BREWING_MAX_FUEL_CHARGES) {
        yield* recordRejected('FuelFull')
        return
      }
      if (brewing.success.state.fuel !== undefined && brewing.success.state.fuel.item !== BREWING_FUEL_ITEM) {
        yield* recordRejected('Occupied')
        return
      }
      requestedItem = BREWING_FUEL_ITEM
      const fuelCount = (brewing.success.state.fuel?.count ?? 0) + 1
      const fuel = itemStack(BREWING_FUEL_ITEM, StackCount(fuelCount))
      if (Result.isFailure(fuel)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Brewing', error: fuel.failure,
        })
        return
      }
      const setFuel = yield* Effect.result(context.brewingService.planSetFuel(brewingSnapshot, fuel.success))
      if (Result.isFailure(setFuel)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: setFuel.failure,
        })
        return
      }
      const intermediate = {
        world: setFuel.success.world,
        expectedRevision: setFuel.success.expectedRevision,
        expectedDimensions: setFuel.success.expectedDimensions,
        state: setFuel.success.result,
      }
      const addFuel = yield* Effect.result(context.brewingService.planAddFuel(intermediate))
      if (Result.isFailure(addFuel)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: addFuel.failure,
        })
        return
      }
      fragments.push(addFuel.success)
    } else if (request.action === 'InsertBrewingBottle') {
      const bottleIndex = Schema.decodeUnknownSync(BrewingBottleIndexSchema)(request.bottleIndex)
      if (brewing.success.state.bottles[bottleIndex] !== undefined) {
        yield* recordRejected('Occupied')
        return
      }
      const potionItems = {
        awkward: 'awkward_potion',
        speed: 'potion_of_swiftness',
        poison: 'potion_of_poison',
        regeneration: 'potion_of_regeneration',
      } as const
      requestedItem = request.bottle === 'water_bottle'
        ? request.bottle
        : potionItems[request.bottle.potion]
      const bottle = singleItemStack(requestedItem)
      const plan = yield* Effect.result(context.brewingService.planSetBottle(
        brewingSnapshot,
        bottleIndex,
        bottle,
      ))
      if (Result.isFailure(plan)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: plan.failure,
        })
        return
      }
      fragments.push(plan.success)
    } else {
      if (brewing.success.state.ingredient !== undefined) {
        yield* recordRejected('Occupied')
        return
      }
      if (brewing.success.state.brewProgressSecs > 0) {
        yield* recordRejected('Brewing')
        return
      }
      requestedItem = request.ingredient
      const ingredient = singleItemStack(requestedItem)
      const plan = yield* Effect.result(context.brewingService.planSetIngredient(
        brewingSnapshot,
        ingredient,
      ))
      if (Result.isFailure(plan)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: plan.failure,
        })
        return
      }
      fragments.push(plan.success)
    }

    const storageCandidate = candidateForPlayerStorageItemUse(
      context.playerStorageOwnerId,
      storage.success.state,
      requestedItem,
      'consume',
    )
    if (storageCandidate === undefined) {
      yield* recordRejected('MissingItem')
      return
    }
    const storagePlan = {
      world: storage.success.world,
      expectedRevision: storage.success.revision,
      expectedDimensions: [],
      changes: [storageCandidate],
      result: undefined,
      postCommitEvents: [],
    }
    fragments.push(storagePlan)
    const result = Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)({
      action: request.action, requestId: request.requestId, success: true, outcome: undefined,
    })
    yield* commitPlanFragments(
      state,
      context,
      'Brewing',
      'Brewing',
      request.requestId,
      fragments,
      () => Ref.update(state.itemUseResults, (results) => [...results, result]),
      retry,
    )
  })

const processPlacement = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  blockStateWorld: GameplayStageContext['blockStateWorld'],
  store: GameplayStageContext['store'],
  playerState: Schema.Schema.Type<typeof PlayerServiceSnapshotSchema> | undefined,
  playerDead: boolean,
  request: PlacementRequest | BlockPlacementCommand,
  disturbed: Array<BlockPositionKey>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const command = 'requestId' in request ? request : undefined
    if (command !== undefined) {
      const validated = validateBlockPlacementCommand(command)
      if (Result.isFailure(validated)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'ItemUse', error: validated.failure,
        })
        return
      }
    }
    const responseRequestId = command === undefined ? '' : command.requestId
    const execute = (): Effect.Effect<import('./registration-core.js').BlockPlacementResult> =>
      Effect.gen(function* () {
        const unsupported = (
          reason: 'WorldCommitCoordinatorUnavailable' | 'OwnerRegistrationUnavailable',
        ): import('./registration-core.js').BlockPlacementResult => ({
          requestId: responseRequestId,
          success: false,
          consumed: false,
          replayed: false,
          outcome: { _tag: 'Unsupported', reason },
        })
        if (playerDead) {
          return {
            requestId: responseRequestId,
            success: false,
            consumed: false,
            replayed: false,
            outcome: { _tag: 'PlayerDead' },
          }
        }
        if (context === undefined) return unsupported('WorldCommitCoordinatorUnavailable')
        if (playerState === undefined) {
          return unsupported('OwnerRegistrationUnavailable')
        }
        const position = yield* blockPositionForRequest(
          state,
          request.positionKey,
          'ItemUse',
          command === undefined ? undefined : responseRequestId,
        )
        if (position === undefined) {
          return {
            requestId: responseRequestId,
            success: false,
            consumed: false,
            replayed: false,
            outcome: { _tag: 'InvalidPosition' },
          }
        }
        const dimension = playerState.pose.feetPosition.dimension
        const observed = yield* Effect.result(context.coordinator.observe(
          context.playerStorageOwnerId,
          PlayerStorageSnapshotSchema,
          [{ dimension, position }],
        ))
        if (Result.isFailure(observed)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: observed.failure,
          })
          return {
            requestId: responseRequestId, success: false, consumed: false, replayed: false,
            outcome: { _tag: 'CommitFailed', error: observed.failure },
          }
        }

        const plannedResult = yield* Effect.result(planPlaceBlock(store, {
          position,
          heldItem: request.heldItem,
          playerFeet: kernelPosition(
            PositionAxis(playerState.pose.feetPosition.x),
            PositionAxis(playerState.pose.feetPosition.y),
            PositionAxis(playerState.pose.feetPosition.z),
          ),
        }))
        if (Result.isFailure(plannedResult)) {
          const reason = plannedResult.failure
          yield* recordGameplayEntityStageFault(state, {
            _tag: 'WorldDataFailure',
            source: 'ItemUse',
            operation: 'ReadLight',
            position,
            reason,
          })
          return {
            requestId: command?.requestId ?? '',
            success: false,
            consumed: false,
            replayed: false,
            outcome: { _tag: 'WorldDataFailed', reason },
          }
        }
        const planned = plannedResult.success
        if (planned.outcome._tag === 'WorldDataFault') {
          yield* recordGameplayEntityWorldDataFault(state, 'ItemUse', planned.outcome.failure)
        }
        if (planned.outcome._tag !== 'Placed') {
          return {
            requestId: responseRequestId,
            success: false,
            consumed: false,
            replayed: false,
            outcome: planned.outcome,
          }
        }

        const mode = command === undefined || !Object.hasOwn(command, 'mode')
          ? 'survival'
          : command.mode as 'survival' | 'creative'
        let storageCandidate: ReplicatedOwnerCandidate | undefined
        if (mode === 'survival') {
          const slotIndex = observed.success.state.inventory.slots.findIndex(
            (slot) => slot?.item === request.heldItem,
          )
          if (slotIndex < 0) {
            return {
              requestId: responseRequestId,
              success: false,
              consumed: false,
              replayed: false,
              outcome: { _tag: 'InventoryUnavailable' },
            }
          }
          const removed = Result.getOrThrow(removeItemAt(observed.success.state.inventory, slotIndex, request.heldItem, 1))
          const updated = Result.getOrThrow(withInventory(observed.success.state, removed.inventory))
          storageCandidate = { ownerId: context.playerStorageOwnerId, state: updated }
        }

        // planned.outcome.block is the held item's block, so take its type from the
        // item rather than decoding the id back through the registry.
        const blockType = blockOfPlaceableItem(request.heldItem)
        const targeting = request.targeting
        const requiresStateRule = blockType === 'door' ||
          blockType === 'oak_stairs' ||
          blockType === 'purpur_stairs'
        if (requiresStateRule && request.targeting === undefined) {
          return {
            requestId: responseRequestId,
            success: false,
            consumed: false,
            replayed: false,
            outcome: { _tag: 'StateRuleTargetingUnavailable' },
          }
        }
        if (requiresStateRule && blockStateWorld === undefined) {
          return {
            requestId: responseRequestId,
            success: false,
            consumed: false,
            replayed: false,
            outcome: { _tag: 'StateRuleUnavailable' },
          }
        }
        const ruleOperation: BlockStateRuleRequest['operation'] | undefined =
          blockType === 'door' && targeting !== undefined
            ? {
                _tag: 'PlaceDoor',
                facing: targeting.facing,
                hinge: 'left',
              }
            : (blockType === 'oak_stairs' || blockType === 'purpur_stairs') && targeting !== undefined
              ? {
                  _tag: 'PlaceStairs',
                  block: blockType,
                  facing: targeting.facing,
                  hitFace: targeting.hitFace,
                  hitY: targeting.hitY,
                }
              : undefined

        let committedEdits: ReadonlyArray<Readonly<{ position: BlockPosition; block: BlockId }>> = planned.edits
        let placementOutcome: typeof planned.outcome = planned.outcome
        if (ruleOperation !== undefined) {
          const ruleOutcome = yield* applyGameplayBlockStateRule(
            state,
            blockStateWorld,
            dimension,
            {
              requestId: command?.requestId ?? `placement:${dimension}:${position.x}:${position.y}:${position.z}`,
              position,
              operation: ruleOperation,
            },
            storageCandidate === undefined ? undefined : [storageCandidate],
            observed.success.revision,
          )
          if (ruleOutcome._tag !== 'Applied') {
            return {
              requestId: responseRequestId,
              success: false,
              consumed: false,
              replayed: false,
              outcome: { _tag: 'StateRuleFailed', outcome: ruleOutcome },
            }
          }
          committedEdits = ruleOutcome.edits
          placementOutcome = {
            ...planned.outcome,
            alsoPlaced: ruleOperation._tag === 'PlaceDoor'
              ? ruleOutcome.edits.filter((edit) =>
                  edit.position.x !== position.x ||
                  edit.position.y !== position.y ||
                  edit.position.z !== position.z,
                ).map((edit) => edit.position)
              : [],
          }
        } else {
          const expectedDimensionRevision = yield* context.coordinator.dimensionRevision(dimension)
          const blockWrite: WorldWriteBatch = {
            world: observed.success.world,
            expectedWorldRevision: observed.success.revision,
            dimension,
            expectedDimensionRevision,
            edits: planned.edits,
          }
          const committed = yield* Effect.result(context.coordinator.commit({
            expectedRevision: observed.success.revision,
            expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
            changes: storageCandidate === undefined ? [] : [storageCandidate],
            blockWrite,
          }))
          if (Result.isFailure(committed)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse', error: committed.failure,
            })
            return {
              requestId: responseRequestId,
              success: false,
              consumed: false,
              replayed: false,
              outcome: { _tag: 'CommitFailed', error: committed.failure },
            }
          }
        }
        for (const edit of committedEdits) {
          // Successful placement edits are loaded world cells, so y - 1 is representable.
          const below = Result.getOrThrow(adjacentBlockPosition(edit.position, 'down'))
          disturbed.push(blockPositionKeyOf(below))
        }
        if (storageCandidate !== undefined) {
          yield* Ref.update(state.consumedItems, (items) => [...items, request.heldItem])
        }
        return {
          requestId: responseRequestId,
          success: true,
          consumed: storageCandidate !== undefined,
          replayed: false,
          outcome: placementOutcome,
        }
      })

    if (command === undefined) {
      const result = yield* execute()
      if (result.outcome._tag === 'CommitFailed' && isRetryableWorldCommitFailure(result.outcome.error)) {
        yield* Ref.update(state.pendingPlacements, (pending) => [request, ...pending])
      }
      if (!result.success && result.outcome._tag === 'Unsupported' && 'reason' in result.outcome) {
        yield* recordGameplayUnsupportedOperation(state, {
          _tag: 'Unsupported',
          action: 'PlaceBlock',
          reason: result.outcome.reason,
        })
      }
      if (!result.success && result.outcome._tag === 'StateRuleUnavailable') {
        yield* recordGameplayUnsupportedOperation(state, {
          _tag: 'Unsupported',
          action: 'PlaceBlock',
          reason: 'StateRuleUnavailable',
        })
      }
      if (!result.success && result.outcome._tag === 'StateRuleTargetingUnavailable') {
        yield* recordGameplayUnsupportedOperation(state, {
          _tag: 'Unsupported',
          action: 'PlaceBlock',
          reason: 'StateRuleTargetingUnavailable',
        })
      }
      if (!result.success && result.outcome._tag === 'StateRuleFailed') {
        yield* recordGameplayUnsupportedOperation(state, {
          _tag: 'Unsupported',
          action: 'PlaceBlock',
          reason: 'StateRuleFailed',
          stateRuleOutcome: result.outcome.outcome,
        })
      }
      return
    }
    const result = yield* processBlockPlacementCommand(state, command, execute)
    if (result.outcome._tag === 'CommitFailed' && isRetryableWorldCommitFailure(result.outcome.error)) {
      yield* Ref.update(state.pendingPlacements, (pending) => [request, ...pending])
    }
  })

const processEnderPearlThrow = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  request: EnderPearlThrowRequest,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const unsupported = (reason: 'WorldCommitCoordinatorUnavailable' | 'OwnerRegistrationUnavailable') =>
      recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'EnderPearl', reason,
      })
    if (context === undefined) {
      yield* unsupported('WorldCommitCoordinatorUnavailable')
      return
    }
    if (
      context.playerOwnerId === undefined ||
      context.playerStorageOwnerId === undefined ||
      context.vitalsOwnerId === undefined
    ) {
      yield* unsupported('OwnerRegistrationUnavailable')
      return
    }

    const displacement = enderPearlDisplacement(
      request.dirX,
      request.dirY,
      request.dirZ,
      request.hitDistance,
    )
    if (displacement === undefined) return

    const seed = yield* Ref.get(state.rollSeed)
    // The internal frame seed and fixed one-roll batch guarantee an existing sample.
    const sampled = Result.getOrThrow(Result.flatMap(drawRolls(seed, 1), (batch) =>
      Result.map(rollAt(batch, 0), (roll) => ({ seed: batch.seed, roll })),
    ))
    const spawnEndermite = shouldSpawnEndermite(sampled.roll)
    const entitiesOwnerId = spawnEndermite ? context.entitiesOwnerId : undefined
    if (spawnEndermite && entitiesOwnerId === undefined) {
      yield* unsupported('OwnerRegistrationUnavailable')
      return
    }

    const playerSnapshot = yield* Effect.result(context.coordinator.snapshot(context.playerOwnerId, PlayerServiceSnapshotSchema))
    if (Result.isFailure(playerSnapshot)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        error: playerSnapshot.failure,
      })
      return
    }
    const storageSnapshot = yield* Effect.result(context.coordinator.snapshot(context.playerStorageOwnerId, PlayerStorageSnapshotSchema))
    if (Result.isFailure(storageSnapshot)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player', error: storageSnapshot.failure,
      })
      return
    }
    const vitalsSnapshot = yield* Effect.result(context.coordinator.snapshot(context.vitalsOwnerId, ExperienceOrbVitalsOwnerSnapshotSchema))
    if (Result.isFailure(vitalsSnapshot)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Vitals', error: vitalsSnapshot.failure,
      })
      return
    }
    const revision = playerSnapshot.success.revision
    if (storageSnapshot.success.revision !== revision || vitalsSnapshot.success.revision !== revision) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        error: new WorldRevisionConflict({
          expected: revision,
          actual: storageSnapshot.success.revision !== revision
            ? storageSnapshot.success.revision
            : vitalsSnapshot.success.revision,
        }),
      })
      return
    }

    let changes: Array<ReplicatedOwnerCandidate> = []
    if (request.inventory.mode === 'survival') {
      const removed = removeItemAt(
        storageSnapshot.success.state.inventory,
        request.inventory.slotIndex,
        'ender_pearl',
        1,
      )
      if (
        Result.isFailure(removed) ||
        removed.success.result._tag !== 'Removed' ||
        removed.success.result.removed !== 1
      ) return
      const updated = Result.getOrThrow(withInventory(storageSnapshot.success.state, removed.success.inventory))
      changes.push({ ownerId: context.playerStorageOwnerId, state: updated })
    }

    const currentPose = playerSnapshot.success.state.pose
    const destination = Schema.decodeUnknownSync(WorldPositionSchema)({
      dimension: currentPose.feetPosition.dimension,
      x: currentPose.feetPosition.x + displacement.x,
      y: currentPose.feetPosition.y + displacement.y,
      z: currentPose.feetPosition.z + displacement.z,
    })
    const playerCandidate = Schema.decodeUnknownSync(PlayerServiceSnapshotSchema)({
      pose: { ...currentPose, feetPosition: destination },
    })
    changes.push({ ownerId: context.playerOwnerId, state: playerCandidate })

    let damage: { readonly amount: number; readonly cause: 'ender_pearl' } | undefined
    if (request.inventory.mode === 'survival') {
      const amount = Result.getOrThrow(DamageAmount.result(ENDER_PEARL_DAMAGE))
      const cause = Result.getOrThrow(DamageCause.result('ender_pearl'))
      const nextVitals = applyVitalsDamage(vitalsSnapshot.success.state.vitals, {
        amount,
        cause,
      })
      const decodedVitals = Schema.decodeUnknownSync(ExperienceOrbVitalsOwnerSnapshotSchema)({
        vitals: nextVitals,
      })
      changes.push({ ownerId: context.vitalsOwnerId, state: decodedVitals })
      damage = { amount: ENDER_PEARL_DAMAGE, cause: 'ender_pearl' }
    } else {
      changes.push({ ownerId: context.vitalsOwnerId, state: vitalsSnapshot.success.state })
    }

    if (entitiesOwnerId !== undefined) {
      const entities = yield* Effect.result(context.coordinator.snapshot(
        entitiesOwnerId,
        GameplayEntityRosterSchema,
      ))
      if (Result.isFailure(entities)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player', error: entities.failure,
        })
        return
      }
      if (entities.success.revision !== revision) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed',
          operation: 'OwnerSnapshot',
          subject: 'Player',
          error: new WorldRevisionConflict({ expected: revision, actual: entities.success.revision }),
        })
        return
      }
      const spawned = spawnEntity(entities.success.state, {
        kind: ENDERMITE_KIND,
        feetPosition: kernelPosition(
          PositionAxis(destination.x),
          PositionAxis(destination.y),
          PositionAxis(destination.z),
        ),
        healthPoints: EntityHealthPoints(ENDERMITE_MAX_HEALTH),
        behaviour: initialBehaviourOfKind(ENDERMITE_KIND),
      })
      if (Result.isFailure(spawned)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: spawned.failure,
        })
        return
      }
      // Pearl spawning constructs every new field from validated values.
      const entityCandidate = Result.getOrThrow(restoreGameplayEntityMetadata(
        spawned.success.roster,
        entities.success.state,
        currentPose.feetPosition.dimension,
      ))
      changes.push({
        ownerId: entitiesOwnerId,
        state: entityCandidate,
      })
    }

    const outcome = Schema.decodeUnknownSync(EnderPearlOutcomeSchema)({ displacement, damage })
    const committed = yield* Effect.result(context.coordinator.commit({
      expectedRevision: revision,
      expectedDimensions: [],
      changes,
    }))
    if (Result.isFailure(committed)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'WorldCommit', subject: 'Player', error: committed.failure,
      })
      yield* Ref.update(state.pendingPearlThrows, (pending) => [request, ...pending])
      return
    }
    yield* Ref.set(state.rollSeed, sampled.seed)
    yield* Ref.update(state.enderPearlOutcomes, (outcomes) => [...outcomes, outcome])
  })

const advanceBlockMiningAttempt = (
  state: GameplayStageContext['state'],
  commit: GameplayStageContext['commit'],
  store: GameplayStageContext['store'],
  dt: DeltaTimeSecs,
  playerDead: boolean,
): Effect.Effect<void> => Effect.gen(function* () {
  const attempt = yield* Ref.getAndSet(state.pendingBlockMiningAttempt, null)
  if (attempt === null || playerDead) {
    yield* Ref.set(state.miningProgress, null)
    return
  }
  if (commit === undefined) {
    yield* Ref.set(state.miningProgress, null)
    yield* recordGameplayUnsupportedOperation(state, {
      _tag: 'Unsupported',
      action: 'MineBlock',
      reason: 'WorldCommitCoordinatorUnavailable',
    })
    return
  }
  const reading = yield* store.getBlock(attempt.position)
  if (reading._tag !== 'Block' || reading.block === AIR_BLOCK_ID) {
    yield* Ref.set(state.miningProgress, null)
    return
  }
  const snapshot = yield* Effect.result(commit.coordinator.snapshot(
    commit.playerStorageOwnerId,
    PlayerStorageSnapshotSchema,
  ))
  if (Result.isFailure(snapshot)) {
    yield* Ref.set(state.miningProgress, null)
    yield* recordGameplayStageFailure(state, {
      _tag: 'Failed',
      operation: 'OwnerSnapshot',
      subject: 'Mining',
      error: snapshot.failure,
    })
    return
  }
  const heldStack = attempt.toolLocation?._tag === 'Inventory'
    ? snapshot.success.state.inventory.slots[attempt.toolLocation.slotIndex]
    : undefined
  const item = heldStack?.item ?? null
  const enchantments: EnchantmentSource = heldStack?.components?.enchantments ?? []
  const modifiers = yield* Ref.get(state.playerStatusEffectModifiers)
  const progress = advanceMiningProgress({
    current: yield* Ref.get(state.miningProgress),
    target: { position: attempt.position, blockId: reading.block },
    isMining: true,
    selectedItem: item,
    efficiencyLevel: enchantmentLevel(enchantments, 'efficiency'),
    miningSpeedMultiplier: modifiers.miningSpeedMultiplier,
    deltaSecs: dt,
  })
  yield* Ref.set(state.miningProgress, progress.nextProgress)
  if (progress.shouldBreak) {
    const lootContext = attempt.toolLocation === undefined
      ? yield* Ref.get(state.heldTool)
      : miningLootContextForItem(item)
    yield* requestBlockBreak(state, attempt.position, lootContext, {
      dimension: attempt.dimension,
      toolLocation: attempt.toolLocation,
    })
  }
})

type GameplayEnchantmentTableRequestId = string
type GameplayEnchantmentTableOffer = Schema.Schema.Type<typeof SimEnchantmentTableOfferSchema>
// mc-sim's offer generation reads only the bookshelf ring, never the table
// block, so the stage owns the check that the position still holds a table.
const ENCHANTING_TABLE_BLOCK_ID: BlockId = Option.getOrThrow(blockIdOf('enchanting_table'))
type GameplayEnchantmentTableOffers = readonly [
  GameplayEnchantmentTableOffer | undefined,
  GameplayEnchantmentTableOffer | undefined,
  GameplayEnchantmentTableOffer | undefined,
]
// Same brand as mc-sim's count, so the service result needs no re-decode.
const EnchantmentTableBookshelfCountSchema: Schema.Codec<EnchantmentTableBookshelfCount, number> = Schema.Int
  .check(Schema.isBetween({ minimum: 0, maximum: 15 }))
  .pipe(Schema.brand('EnchantmentTableBookshelfCount'))
const EnchantmentTableRequestIdSchema: Schema.Codec<GameplayEnchantmentTableRequestId, string> = Schema.String.check(
  Schema.makeFilter((requestId) => requestId.length > 0),
)

export type GameplayEnchantmentTableOffersRequest = Readonly<{
  readonly requestId: GameplayEnchantmentTableRequestId
  readonly itemSlot: EnchantmentTableInventorySlot
  readonly lapisSlot: EnchantmentTableInventorySlot
  readonly tablePosition: BlockPosition
}>
export const GameplayEnchantmentTableOffersRequestSchema: Schema.Codec<
  GameplayEnchantmentTableOffersRequest,
  unknown
> = Schema.Struct({
  requestId: EnchantmentTableRequestIdSchema,
  itemSlot: EnchantmentTableInventorySlotSchema,
  lapisSlot: EnchantmentTableInventorySlotSchema,
  tablePosition: BlockPositionSchema,
}).check(Schema.makeFilter(({ itemSlot, lapisSlot }) => itemSlot !== lapisSlot))

export type GameplayEnchantmentTableApplyRequest = Readonly<{
  readonly requestId: GameplayEnchantmentTableRequestId
  readonly tableSlot: 0 | 1 | 2
}>
export const GameplayEnchantmentTableApplyRequestSchema: Schema.Codec<
  GameplayEnchantmentTableApplyRequest,
  unknown
> = Schema.Struct({
  requestId: EnchantmentTableRequestIdSchema,
  tableSlot: Schema.Literals([0, 1, 2]),
})

type EnchantmentTableOfferEntry = Readonly<{
  readonly slot: 0 | 1 | 2
  readonly offer: GameplayEnchantmentTableOffer
}>
const EnchantmentTableOfferEntrySchema: Schema.Codec<EnchantmentTableOfferEntry, unknown> = Schema.Struct({
  slot: Schema.Literals([0, 1, 2]),
  offer: SimEnchantmentTableOfferSchema,
})
type EnchantmentTableRejectionReason =
  | 'service-unavailable'
  | 'player-dead'
  | 'no-item'
  | 'already-enchanted'
  | 'invalid-seed'
  | 'offer-generation-failed'
  | 'duplicate-session'
  | 'session-not-found'
  | 'item-changed'
  | 'invalid-offer'
  | 'empty-item-slot'
  | 'invalid-item'
  | 'not-enchantable'
  | 'insufficient-level'
  | 'insufficient-lapis'
  | 'invalid-storage'
  | 'item-stack-failure'
  | 'transaction-failed'
  | 'table-missing'
  | 'table-area-unloaded'
const EnchantmentTableRejectionReasonSchema: Schema.Codec<EnchantmentTableRejectionReason, string> = Schema.Literals([
  'service-unavailable', 'player-dead', 'no-item', 'already-enchanted', 'invalid-seed',
  'offer-generation-failed', 'duplicate-session', 'session-not-found', 'item-changed',
  'invalid-offer', 'empty-item-slot', 'invalid-item', 'not-enchantable', 'insufficient-level',
  'insufficient-lapis', 'invalid-storage', 'item-stack-failure', 'transaction-failed', 'table-missing',
  'table-area-unloaded',
])
export type GameplayEnchantmentTableResult =
  | Readonly<{
      readonly _tag: 'OffersGenerated'
      readonly requestId: GameplayEnchantmentTableRequestId
      readonly bookshelfCount: EnchantmentTableBookshelfCount
      readonly offers: ReadonlyArray<EnchantmentTableOfferEntry>
    }>
  | Readonly<{
      readonly _tag: 'Applied'
      readonly requestId: GameplayEnchantmentTableRequestId
      readonly tableSlot: 0 | 1 | 2
      readonly offer: GameplayEnchantmentTableOffer
      readonly item: ItemStack
    }>
  | Readonly<{
      readonly _tag: 'Rejected'
      readonly requestId: GameplayEnchantmentTableRequestId
      readonly reason: EnchantmentTableRejectionReason
    }>
export const GameplayEnchantmentTableResultSchema: Schema.Codec<
  GameplayEnchantmentTableResult,
  unknown
> = Schema.Union([
  Schema.TaggedStruct('OffersGenerated', {
    requestId: EnchantmentTableRequestIdSchema,
    bookshelfCount: EnchantmentTableBookshelfCountSchema,
    offers: Schema.Array(EnchantmentTableOfferEntrySchema),
  }),
  Schema.TaggedStruct('Applied', {
    requestId: EnchantmentTableRequestIdSchema,
    tableSlot: Schema.Literals([0, 1, 2]),
    offer: SimEnchantmentTableOfferSchema,
    item: ItemStackSchema,
  }),
  Schema.TaggedStruct('Rejected', {
    requestId: EnchantmentTableRequestIdSchema,
    reason: EnchantmentTableRejectionReasonSchema,
  }),
])

type EnchantmentTableQueuedRequest =
  | { readonly _tag: 'GenerateOffers'; readonly request: GameplayEnchantmentTableOffersRequest }
  | { readonly _tag: 'ApplyOffer'; readonly request: GameplayEnchantmentTableApplyRequest }

type EnchantmentTableOfferSession = Readonly<{
  readonly itemSlot: EnchantmentTableInventorySlot
  readonly lapisSlot: EnchantmentTableInventorySlot
  readonly tablePosition: BlockPosition
  readonly sourceStack: ItemStack
  readonly offers: GameplayEnchantmentTableOffers
}>

type EnchantmentTableMailbox = {
  readonly requests: Array<EnchantmentTableQueuedRequest>
  readonly results: Array<GameplayEnchantmentTableResult>
  readonly sessions: Map<string, EnchantmentTableOfferSession>
}

const enchantmentTableMailboxes = new WeakMap<GameplayFrameState, EnchantmentTableMailbox>()
const enchantmentTableServices = new WeakMap<GameplayFrameState, EnchantmentTableServiceApi>()

const enchantmentTableMailboxFor = (state: GameplayFrameState): EnchantmentTableMailbox => {
  let mailbox = enchantmentTableMailboxes.get(state)
  if (mailbox === undefined) {
    mailbox = { requests: [], results: [], sessions: new Map() }
    enchantmentTableMailboxes.set(state, mailbox)
  }
  return mailbox
}

/** Internal composition hook; the public module binds the mc-sim service before building stages. */
export const bindEnchantmentTableService = (
  state: GameplayFrameState,
  service: EnchantmentTableServiceApi,
): void => {
  enchantmentTableServices.set(state, service)
}

export const requestEnchantmentTableOffers = (
  state: GameplayFrameState,
  input: unknown,
): Effect.Effect<void, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(GameplayEnchantmentTableOffersRequestSchema)(input).pipe(
    Effect.flatMap((request) => Effect.sync(() => {
      enchantmentTableMailboxFor(state).requests.push({ _tag: 'GenerateOffers', request })
    })),
  )

export const requestEnchantmentTableApply = (
  state: GameplayFrameState,
  input: unknown,
): Effect.Effect<void, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(GameplayEnchantmentTableApplyRequestSchema)(input).pipe(
    Effect.flatMap((request) => Effect.sync(() => {
      enchantmentTableMailboxFor(state).requests.push({ _tag: 'ApplyOffer', request })
    })),
  )

export const drainEnchantmentTableResults = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<GameplayEnchantmentTableResult>> =>
  Effect.sync(() => enchantmentTableMailboxFor(state).results.splice(0))

const sameItemStack = (left: ItemStack, right: ItemStack): boolean =>
  Equal.equals(left, right)

const publishGeneratedEnchantmentOffers = (
  mailbox: EnchantmentTableMailbox,
  request: GameplayEnchantmentTableOffersRequest,
  sourceStack: ItemStack,
  generated: EnchantmentTableGenerateOffersResult,
): void => {
  mailbox.sessions.set(request.requestId, {
    itemSlot: request.itemSlot,
    lapisSlot: request.lapisSlot,
    tablePosition: request.tablePosition,
    sourceStack,
    offers: generated.offers,
  })
  mailbox.results.push({
    _tag: 'OffersGenerated',
    requestId: request.requestId,
    bookshelfCount: generated.bookshelfCount,
    offers: generated.offers.flatMap((offer, slot) => offer === undefined
      ? []
      : [{ slot: slot as 0 | 1 | 2, offer }]),
  })
}

const isEnchantingTableAt = (
  store: GameplayStageContext['store'],
  position: BlockPosition,
): Effect.Effect<boolean> =>
  Effect.map(store.getBlock(position), (reading) =>
    reading._tag === 'Block' && reading.block === ENCHANTING_TABLE_BLOCK_ID)

const applyEnchantmentTableRequest = (
  state: GameplayFrameState,
  mailbox: EnchantmentTableMailbox,
  store: GameplayStageContext['store'],
  commit: GameplayStageContext['commit'],
  service: EnchantmentTableServiceApi | undefined,
  request: GameplayEnchantmentTableApplyRequest,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (
      commit === undefined ||
      commit.vitalsOwnerId === undefined ||
      service === undefined
    ) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'service-unavailable' })
      return
    }
    const session = mailbox.sessions.get(request.requestId)
    if (session === undefined) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'session-not-found' })
      return
    }
    // Vanilla closes the table screen when the table is removed.
    if (!(yield* isEnchantingTableAt(store, session.tablePosition))) {
      mailbox.sessions.delete(request.requestId)
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'table-missing' })
      return
    }
    const storage = yield* Effect.result(commit.coordinator.snapshot(
      commit.playerStorageOwnerId,
      PlayerStorageSnapshotSchema,
    ))
    if (Result.isFailure(storage)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: storage.failure,
      })
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'transaction-failed' })
      return
    }
    const currentStack = storage.success.state.inventory.slots[session.itemSlot]
    if (currentStack === undefined || !sameItemStack(currentStack, session.sourceStack)) {
      mailbox.sessions.delete(request.requestId)
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'item-changed' })
      return
    }
    const offer = session.offers[request.tableSlot]
    if (offer === undefined) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'invalid-offer' })
      return
    }
    const applied = yield* Effect.result(service.apply({
      playerStorageOwnerId: commit.playerStorageOwnerId,
      vitalsOwnerId: commit.vitalsOwnerId,
      itemSlot: session.itemSlot,
      lapisSlot: session.lapisSlot,
      tableSlot: request.tableSlot,
      offer,
    }))
    if (Result.isFailure(applied)) {
      if ('_tag' in applied.failure && applied.failure._tag === 'EnchantmentTableApplyFailure') {
        mailbox.results.push({
          _tag: 'Rejected', requestId: request.requestId, reason: applied.failure.reason,
        })
      } else {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse', error: applied.failure,
        })
        mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'transaction-failed' })
      }
      return
    }
    mailbox.sessions.delete(request.requestId)
    const result: EnchantmentTableApplyResult = applied.success.result
    mailbox.results.push({
      _tag: 'Applied',
      requestId: request.requestId,
      tableSlot: request.tableSlot,
      offer,
      item: result.item,
    })
  })

// mc-sim counts bookshelves per direction and height by reading the gap cell
// and, only when the gap is air, the shelf cell behind it. Both cells for all
// eight directions and both heights are every position it can ask for.
const ENCHANTMENT_TABLE_RING_DIRECTIONS: ReadonlyArray<Readonly<{ dx: number; dz: number }>> = [
  { dx: -2, dz: -2 }, { dx: -2, dz: 0 }, { dx: -2, dz: 2 },
  { dx: 0, dz: -2 }, { dx: 0, dz: 2 },
  { dx: 2, dz: -2 }, { dx: 2, dz: 0 }, { dx: 2, dz: 2 },
]

const ringCell = (x: number, y: number, z: number): Result.Result<BlockPosition, Brand.BrandError> =>
  Result.map(
    Result.all([BlockAxis.result(x), BlockAxis.result(y), BlockAxis.result(z)] as const),
    ([cellX, cellY, cellZ]) => blockPosition(cellX, cellY, cellZ),
  )

const enchantmentTableRingPositions = (
  table: BlockPosition,
): Result.Result<ReadonlyArray<BlockPosition>, Brand.BrandError> =>
  Result.all(ENCHANTMENT_TABLE_RING_DIRECTIONS.flatMap(({ dx, dz }) =>
    [table.y, table.y + 1].flatMap((y) => [
      ringCell(table.x + dx / 2, y, table.z + dz / 2),
      ringCell(table.x + dx, y, table.z + dz),
    ])))

/**
 * Reads every ring position up front because mc-sim's `blockIdAt` is
 * synchronous. An unreadable position is not air: it records a fault and the
 * request is refused, so the result never counts a chunk the stage cannot see.
 */
const readEnchantmentTableRing = (
  state: GameplayFrameState,
  store: GameplayStageContext['store'],
  ring: ReadonlyArray<BlockPosition>,
): Effect.Effect<EnchantmentTableBlockIdAt | undefined> => Effect.gen(function* () {
  const blocks = new Map<BlockPositionKey, BlockId>()
  let unreadable = false
  for (const position of ring) {
    const reading = yield* store.getBlock(position)
    if (reading._tag === 'Block') {
      blocks.set(blockPositionKeyOf(position), reading.block)
    } else {
      unreadable = true
      yield* recordGameplayEntityStageFault(state, {
        _tag: 'WorldDataFailure',
        source: 'EnchantmentTable',
        operation: 'ReadBlock',
        position,
        reason: { _tag: reading._tag, position },
      })
    }
  }
  if (unreadable) return undefined
  // The ring covers every position mc-sim's bookshelf count reads, so a miss is a
  // defect in the ring geometry; it must not fall back to a default block.
  return (position) => Option.getOrThrowWith(
    Option.fromNullishOr(blocks.get(blockPositionKeyOf(position))),
    () => new Error(`Enchanting table ring was not pre-read at ${position.x},${position.y},${position.z}`),
  )
})

type EnchantmentTableDomainFailure =
  | EnchantmentTableFailure
  | EnchantmentTableBookshelfFailure
  | EnchantmentTableApplyFailure
// generateOffers fails with mc-sim's table-rule failures or with Schema/coordinator
// errors; the error union it declares also carries the apply failure, which the
// stage reports the same way as the other rule failures.
const ENCHANTMENT_TABLE_DOMAIN_FAILURE_TAGS: ReadonlySet<EnchantmentTableServiceError['_tag']> = new Set<
  EnchantmentTableDomainFailure['_tag']
>(['EnchantmentTableFailure', 'EnchantmentTableBookshelfFailure', 'EnchantmentTableApplyFailure'])
const isEnchantmentTableDomainFailure = (
  failure: EnchantmentTableServiceError,
): failure is EnchantmentTableDomainFailure => ENCHANTMENT_TABLE_DOMAIN_FAILURE_TAGS.has(failure._tag)

const generateEnchantmentTableOffersRequest = (
  state: GameplayFrameState,
  mailbox: EnchantmentTableMailbox,
  store: GameplayStageContext['store'],
  commit: GameplayStageContext['commit'],
  service: EnchantmentTableServiceApi | undefined,
  request: GameplayEnchantmentTableOffersRequest,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (commit === undefined || service === undefined) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'service-unavailable' })
      return
    }
    if (mailbox.sessions.has(request.requestId)) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'duplicate-session' })
      return
    }
    if (!(yield* isEnchantingTableAt(store, request.tablePosition))) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'table-missing' })
      return
    }
    const storage = yield* Effect.result(commit.coordinator.snapshot(
      commit.playerStorageOwnerId,
      PlayerStorageSnapshotSchema,
    ))
    if (Result.isFailure(storage)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: storage.failure,
      })
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'transaction-failed' })
      return
    }
    const sourceStack = storage.success.state.inventory.slots[request.itemSlot]
    if (sourceStack === undefined) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'no-item' })
      return
    }
    if (sourceStack.components.enchantments !== undefined || sourceStack.components.storedEnchantments !== undefined) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'already-enchanted' })
      return
    }
    const ring = enchantmentTableRingPositions(request.tablePosition)
    if (Result.isFailure(ring)) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'offer-generation-failed' })
      return
    }
    const blockIdAt = yield* readEnchantmentTableRing(state, store, ring.success)
    if (blockIdAt === undefined) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'table-area-unloaded' })
      return
    }
    const seedValue = yield* Ref.get(state.rollSeed)
    const seed = RandomSeed.result(seedValue)
    if (Result.isFailure(seed)) {
      mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'invalid-seed' })
      return
    }
    // RandomSeed accepted this frame seed, and the batch is a fixed single roll.
    yield* Ref.set(state.rollSeed, Result.getOrThrow(drawRolls(seedValue, 1)).seed)
    const generated = yield* Effect.result(service.generateOffers({
      item: sourceStack.item,
      tablePosition: request.tablePosition,
      blockIdAt,
      random: enchantmentTableRandomForSeed(seed.success),
    }))
    if (Result.isFailure(generated)) {
      if (isEnchantmentTableDomainFailure(generated.failure)) {
        mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'offer-generation-failed' })
      } else {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed',
          operation: 'CandidateBuild',
          subject: 'ItemUse',
          requestId: request.requestId,
          error: generated.failure,
        })
        mailbox.results.push({ _tag: 'Rejected', requestId: request.requestId, reason: 'transaction-failed' })
      }
      return
    }
    publishGeneratedEnchantmentOffers(mailbox, request, sourceStack, generated.success)
  })

const processEnchantmentTableRequests = (
  state: GameplayFrameState,
  mailbox: EnchantmentTableMailbox,
  store: GameplayStageContext['store'],
  commit: GameplayStageContext['commit'],
  service: EnchantmentTableServiceApi | undefined,
  playerDead: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const requests = yield* Effect.sync(() => mailbox.requests.splice(0))
    for (const queued of requests) {
      if (playerDead) {
        mailbox.results.push({
          _tag: 'Rejected',
          requestId: queued.request.requestId,
          reason: 'player-dead',
        })
        continue
      }
      if (queued._tag === 'GenerateOffers') {
        yield* generateEnchantmentTableOffersRequest(state, mailbox, store, commit, service, queued.request)
      } else {
        yield* applyEnchantmentTableRequest(state, mailbox, store, commit, service, queued.request)
      }
    }
  })

type ItemUseBlockRead =
  | Readonly<{ _tag: 'Block'; blockType: BlockType }>
  | Readonly<{ _tag: 'ChunkNotLoaded' }>
  | Readonly<{ _tag: 'Failure'; failure: GameplayStageItemUseWorldFailure | ItemUseWorldReadRefusal }>

const itemUseBlockTypeAt = (
  state: GameplayStageContext['state'],
  position: BlockPosition,
  blockRead: WorldBlockRead | undefined,
): Effect.Effect<ItemUseBlockRead> => Effect.gen(function* () {
  if (blockRead === undefined) {
    const reason = { _tag: 'MissingBlockReadResult' as const, position }
    yield* recordGameplayEntityStageFault(state, {
      _tag: 'WorldDataFailure',
      source: 'ItemUse',
      operation: 'ReadBlock',
      position,
      reason,
    })
    return { _tag: 'Failure', failure: { _tag: 'WorldDataFailed', reason } }
  }

  if (blockRead.reading._tag === 'ChunkNotLoaded') return { _tag: 'ChunkNotLoaded' }
  if (blockRead.reading._tag === 'OutOfWorld') {
    return {
      _tag: 'Failure',
      failure: {
        _tag: 'OutOfWorld',
        position,
      },
    }
  }

  // Observed blocks carry branded ids and this build's fixed registry is already resolved.
  const decoded = Result.getOrThrow(blockTypeOfId(blockRead.reading.block))
  if (decoded === undefined) {
    const reason: GameplayStageBlockTypeDecodeFailure = {
      _tag: 'BlockTypeDecodeFailed',
      position,
      block: blockRead.reading.block,
      failure: { _tag: 'UnregisteredBlockId' },
    }
    yield* recordGameplayEntityStageFault(state, {
      _tag: 'WorldDataFailure',
      source: 'ItemUse',
      operation: 'DecodeBlockType',
      position,
      reason,
    })
    return { _tag: 'Failure', failure: { _tag: 'WorldDataFailed', reason } }
  }

  return { _tag: 'Block', blockType: decoded }
})

export const makeInteractionsStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, commit } = context
  const enchantmentTableMailbox = enchantmentTableMailboxFor(state)
  const enchantmentTableService = enchantmentTableServices.get(state)
  const runSaplingGrowthTick = makeSaplingGrowthTick(state, store, context.blockStateWorld)
  return {
    id: GAMEPLAY_STAGE_IDS.interactions,
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    // BREAKS ARE SERVICED BEFORE PLACEMENTS, and the order is a decision. A
    // player who breaks a cell and places into it in the same frame gets the
    // sequence they asked for; the other order silently drops the placement,
    // because `place-block` would read the cell as occupied by a block that is
    // about to stop existing. It is the same argument that puts `entities`
    // after `interactions` one stage down.
    run: (dt) =>
      Effect.gen(function* () {
        const vitalsSnapshot = yield* Effect.result(state.survivalHunger.snapshot)
        if (Result.isFailure(vitalsSnapshot)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed',
            operation: 'OwnerSnapshot',
            subject: 'Vitals',
            error: vitalsSnapshot.failure,
          })
          return
        }
        const playerDead = vitalsSnapshot.success.vitals.healthPoints <= 0
        yield* processEnchantmentTableRequests(
          state,
          enchantmentTableMailbox,
          store,
          commit,
          enchantmentTableService,
          playerDead,
        )
        const playerState = yield* gameplayPlayerStateForStage(state, commit)
        const portalTravel = commit !== undefined && playerState !== undefined
          ? { commit, playerState }
          : undefined
        if (commit !== undefined && playerState === undefined) {
          const placements = yield* Ref.getAndSet<ReadonlyArray<PlacementRequest | BlockPlacementCommand>>(
            state.pendingPlacements,
            [],
          )
          const blockUses = yield* Ref.getAndSet<ReadonlyArray<BlockUseRequest>>(
            state.pendingBlockUses,
            [],
          )
          const disturbed: Array<BlockPositionKey> = []
          for (const request of placements) {
            yield* processPlacement(state, commit, context.blockStateWorld, store, playerState, playerDead, request, disturbed)
          }
          const blockUseResults: Array<BlockUseResult> = []
          for (const request of blockUses) {
            if (playerDead) {
              blockUseResults.push({
                requestId: request.requestId,
                success: false,
                outcome: 'PlayerDead',
              })
              continue
            }
            // requestBlockUse is the only producer of pendingBlockUses and builds every
            // key with blockPositionKeyOf, so the key always parses.
            const position = Result.getOrThrow(blockPositionForKey(request.positionKey))
            const outcome = resolveBlockUse(position, yield* store.getBlock(position))
            blockUseResults.push(outcome._tag === 'ToggleDoor'
              ? {
                  requestId: request.requestId,
                  success: false,
                  outcome: 'PlayerStateUnavailable',
                }
              : {
                  requestId: request.requestId,
                  success: isSuccessfulBlockUse(outcome),
                  outcome,
                })
          }
          if (blockUseResults.length > 0) {
            yield* Ref.update(state.blockUseResults, (items) => [...items, ...blockUseResults])
          }
          return
        }

        yield* advanceCropLifecycle(state, commit, context.blockStateWorld, dt)
        if (playerState !== undefined) {
          yield* runSaplingGrowthTick(playerState.pose.feetPosition.dimension, dt)
        }

        // Advance portal dwell on idle frames, before the early return below.
        if (portalTravel !== undefined) {
          yield* stepPortalTravel(
            state,
            store,
            portalTravel.playerState,
            portalTravel.commit,
            dt,
          )
        }
        yield* stepStatusEffects(state, commit, dt)
        yield* advanceBlockMiningAttempt(state, commit, store, dt, playerDead)

        // `getAndSet` rather than get-then-set: whoever fills the inboxes is not
        // this fiber, and a request that arrived between the two steps would be
        // dropped without a trace (DN-GP-10). Both are drained UP FRONT, so a
        // placement queued while the breaks are being serviced waits for the
        // next frame rather than being serviced out of order.
        const breakRequestQueue = breakRequestQueueFor(state)
        const { breaks, snapshots } = yield* breakRequestQueue.mutex.withPermits(1)(
          Effect.uninterruptible(
            Effect.gen(function* () {
              const drainedBreaks = yield* Ref.getAndSet<ReadonlyArray<BlockPositionKey>>(
                state.pendingBreaks,
                [],
              )
              const requests = yield* Ref.modify(breakRequestQueue.state, (pending) => [
                pending.requests,
                { ...pending, requests: [] },
              ])
              const requestSnapshots = new Map<number, PendingBlockBreakRequest>()
              for (const request of requests) {
                if (drainedBreaks[request.publicQueueIndex] === request.positionKey) {
                  requestSnapshots.set(request.publicQueueIndex, request)
                }
              }
              return { breaks: drainedBreaks, snapshots: requestSnapshots }
            }),
          ),
        )
        const placements = yield* Ref.getAndSet<ReadonlyArray<PlacementRequest>>(
          state.pendingPlacements,
          [],
        )
        const blockUses = yield* Ref.getAndSet<ReadonlyArray<BlockUseRequest>>(
          state.pendingBlockUses,
          [],
        )
        const itemUses = yield* Ref.getAndSet<ReadonlyArray<ItemUseRequest>>(
          state.pendingItemUses,
          [],
        )
        const requeueItemUsesFrom = (start: number) =>
          Ref.update(state.pendingItemUses, (pending) => [...itemUses.slice(start), ...pending])
        const requeueItemUse = (request: ItemUseRequest) =>
          Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
        const bowShots = yield* Ref.getAndSet<ReadonlyArray<BowShotRequest>>(
          state.pendingBowShots,
          [],
        )
        const meleeAttacks = yield* Ref.getAndSet<ReadonlyArray<MeleeAttackRequest>>(
          state.pendingMeleeAttacks,
          [],
        )
        const pearlThrows = yield* Ref.getAndSet<ReadonlyArray<EnderPearlThrowRequest>>(
          state.pendingPearlThrows,
          [],
        )
        const villagerTrades = yield* Ref.getAndSet<ReadonlyArray<VillagerTradeRequest>>(
          state.pendingVillagerTrades,
          [],
        )
        if (
          breaks.length === 0 &&
          placements.length === 0 &&
          blockUses.length === 0 &&
          itemUses.length === 0 &&
          bowShots.length === 0 &&
          meleeAttacks.length === 0 &&
          pearlThrows.length === 0 &&
          villagerTrades.length === 0
        ) {
          return
        }

        const used: Array<IgnitionItemType> = []
        const blockUseResults: Array<BlockUseResult> = []
        const itemUseResults: Array<ItemUseResult> = []
        const disturbed: Array<BlockPositionKey> = []

        villagerTradeRequests: for (const [index, request] of villagerTrades.entries()) {
          if (playerDead) {
            yield* Ref.update(state.villagerTradeResults, (results) => [
              ...results,
              { ...request, _tag: 'Rejected' as const, reason: 'PlayerDead' as const },
            ])
            continue
          }
          if (commit === undefined) {
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'VillagerTrade',
              requestId: request.requestId,
              reason: 'WorldCommitCoordinatorUnavailable',
            })
            continue
          }
          const tradesOwnerId = commit.villagerTradesOwnerId
          if (tradesOwnerId === undefined) {
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'VillagerTrade',
              requestId: request.requestId,
              reason: 'OwnerRegistrationUnavailable',
            })
            continue
          }
          const storageSnapshot = yield* Effect.result(commit.coordinator.snapshot(
            commit.playerStorageOwnerId,
            PlayerStorageSnapshotSchema,
          ))
          if (Result.isFailure(storageSnapshot)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: storageSnapshot.failure,
            })
            continue
          }
          const tradesSnapshot = yield* Effect.result(commit.coordinator.snapshot(
            tradesOwnerId,
            GameplayVillagerTradeSnapshotSchema,
          ))
          if (Result.isFailure(tradesSnapshot)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: tradesSnapshot.failure,
            })
            continue
          }
          if (storageSnapshot.success.revision !== tradesSnapshot.success.revision) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed',
              operation: 'OwnerSnapshot',
              subject: 'ItemUse',
              error: new WorldRevisionConflict({
                expected: storageSnapshot.success.revision,
                actual: tradesSnapshot.success.revision,
              }),
            })
            yield* Ref.update(state.pendingVillagerTrades, (pending) => [
              ...villagerTrades.slice(index),
              ...pending,
            ])
            break villagerTradeRequests
          }
          const villager = tradesSnapshot.success.state.villagers.find((entry) => entry.id === request.villagerId)
          const offer = villager?.offers.find((entry) => entry.id === request.offerId)
          const reject = (reason: 'UnknownOffer' | 'OutOfStock' | 'InsufficientItems' | 'InventoryFull') =>
            Ref.update(state.villagerTradeResults, (results) => [
              ...results,
              { ...request, _tag: 'Rejected' as const, reason },
            ])
          if (offer === undefined) {
            yield* reject('UnknownOffer')
            continue
          }
          if (offer.uses >= offer.maxUses) {
            yield* reject('OutOfStock')
            continue
          }
          const removed = Result.getOrUndefined(removeInventoryItem(
            storageSnapshot.success.state.inventory,
            offer.input.item,
            offer.input.count,
          ))
          if (removed === undefined || removed.removed !== offer.input.count) {
            yield* reject('InsufficientItems')
            continue
          }
          const added = Result.getOrThrow(addInventoryItem(
            removed.inventory,
            offer.output.item,
            offer.output.count,
          ))
          if (added.leftover > 0) {
            yield* reject('InventoryFull')
            continue
          }
          const candidateStorage = Result.getOrThrow(withInventory(
            storageSnapshot.success.state,
            added.inventory,
          ))
          const candidateTrades = Schema.decodeUnknownSync(GameplayVillagerTradeSnapshotSchema)({
            ...tradesSnapshot.success.state,
            villagers: tradesSnapshot.success.state.villagers.map((entry) =>
              entry.id !== request.villagerId
                ? entry
                : {
                    ...entry,
                    offers: entry.offers.map((candidateOffer) =>
                      candidateOffer.id === request.offerId
                        ? { ...candidateOffer, uses: candidateOffer.uses + 1 }
                        : candidateOffer,
                    ),
                  },
            ),
          })
          const committed = yield* Effect.result(commit.coordinator.commit({
            expectedRevision: storageSnapshot.success.revision,
            expectedDimensions: [],
            changes: [
              { ownerId: commit.playerStorageOwnerId, state: candidateStorage },
              { ownerId: tradesOwnerId, state: candidateTrades },
            ],
          }))
          if (Result.isFailure(committed)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse', error: committed.failure,
            })
            yield* Ref.update(state.pendingVillagerTrades, (pending) => [
              ...villagerTrades.slice(index),
              ...pending,
            ])
            break villagerTradeRequests
          }
          yield* Ref.update(state.villagerTradeResults, (results) => [
            ...results,
            { ...request, _tag: 'Traded' as const },
          ])
        }

        // Legacy key-only requests have no completion-time snapshot, so they
        // retain the old batch-level fallback. Requests made through the public
        // helper use the context captured when mining completed.
        const plannedDropsForBrokenBlock = (
          seed: number,
          yielded: BlockId,
          tool: BlockLootContext,
          breakPosition: BlockPosition,
        ): Readonly<{ seed: number; drops: ReadonlyArray<DroppedItemSpawn> }> => {
          // The frame seed and loot-roll count are internal validated values.
          const batch = Result.getOrThrow(drawRolls(seed, BLOCK_LOOT_ROLLS))
          // planBreakBlock already validated this id against the same immutable registry.
          const loot = Result.getOrThrow(blockLoot(yielded, tool, batch.rolls))
          return {
            seed: batch.seed,
            drops: loot.map((item) => ({
              ...item,
              at: {
                x: PositionAxis(breakPosition.x),
                y: PositionAxis(breakPosition.y),
                z: PositionAxis(breakPosition.z),
              },
            })),
          }
        }

        const batchHeldTool = yield* Ref.get(state.heldTool)
        for (const [index, positionKey] of breaks.entries()) {
          const request = snapshots.get(index)
          const tool = request !== undefined && request.lootContext !== undefined
            ? request.lootContext
            : batchHeldTool
          const invalidLootContext = invalidBlockLootContextReason(tool)
          if (invalidLootContext !== undefined) {
            yield* recordGameplayRequestFault(
              state,
              'Mining',
              request === undefined ? positionKey : String(request.requestId),
              invalidLootContext,
            )
            continue
          }
          if (playerDead) continue
          const breakPosition = yield* blockPositionForRequest(
            state, positionKey, 'Mining', request === undefined ? undefined : String(request.requestId),
          )
          if (breakPosition === undefined) continue
          if (commit === undefined) {
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'MineBlock',
              ...(request === undefined ? {} : { requestId: String(request.requestId) }),
              reason: 'WorldCommitCoordinatorUnavailable',
            })
            continue
          }
          const activePlayerState = Option.getOrThrow(Option.fromNullishOr(playerState))
          const miningDimension = request?.dimension ?? activePlayerState.pose.feetPosition.dimension
          {
            const plan = yield* planBreakBlock(breakPosition, {
              coordinator: commit.coordinator,
              dimension: miningDimension,
              ownerId: commit.playerStorageOwnerId,
              toolLocation: request?.toolLocation,
            })
            if (plan._tag === 'PlannedCascade') {
              const toolLocation = request?.toolLocation
              const heldStack = toolLocation?._tag === 'Inventory'
                ? plan.ownerSnapshot.state.inventory.slots[toolLocation.slotIndex]
                : undefined
              const heldEnchantments: EnchantmentSource = heldStack?.components?.enchantments ?? []
              const lootContext = toolLocation === undefined
                ? tool
                : {
                    ...miningLootContextForItem(heldStack?.item ?? null),
                    fortuneLevel: enchantmentLevel(heldEnchantments, 'fortune'),
                    silkTouch: silkTouchEnabled(heldEnchantments),
                  }
              const seed = yield* Ref.get(state.rollSeed)
              const unbreaking = toolLocation === undefined
                ? 0
                : enchantmentLevel(heldEnchantments, 'unbreaking')
              // The internal frame seed and fixed one-roll batch are valid roll inputs.
              const wearRolls = unbreaking > 0 ? Result.getOrThrow(drawRolls(seed, 1)) : undefined
              const wear = toolLocation === undefined
                ? 0
                : durabilityWearWithEnchantments(
                    1,
                    heldEnchantments,
                    wearRolls?.rolls ?? [],
                    'tool',
                  )
              const candidateStorage = toolLocation === undefined || wear === 0
                ? plan.ownerSnapshot.state
                : damagePlayerStorageAt(plan.ownerSnapshot.state, toolLocation, wear).storage
              const lootSeed = wearRolls?.seed ?? seed
              const plannedLoot = plannedDropsForBrokenBlock(lootSeed, plan.yielded, lootContext, breakPosition)
              const drops = plannedLoot.drops
              let candidate: PlayerStorage = candidateStorage
              const leftovers: Array<DroppedItemSpawn> = []
              for (const item of drops) {
                const added = Result.getOrThrow(addInventoryItem(candidate.inventory, item.item, item.count))
                candidate = Result.getOrThrow(withInventory(candidate, added.inventory))
                if (added.leftover > 0) {
                  leftovers.push({ ...item, count: added.leftover })
                }
              }

              let changes: Array<ReplicatedOwnerCandidate> = [
                { ownerId: commit.playerStorageOwnerId, state: candidate },
              ]
              if (leftovers.length > 0) {
                const droppedItemsOwnerId = commit.droppedItemsOwnerId
                if (droppedItemsOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'MineBlock',
                    ...(request === undefined ? {} : { requestId: String(request.requestId) }),
                    reason: 'OwnerRegistrationUnavailable',
                  })
                  continue
                }
                const droppedSnapshotResult = yield* Effect.result(commit.coordinator.snapshot(
                  droppedItemsOwnerId,
                  DroppedItemOwnerSnapshotSchema,
                ))
                if (Result.isFailure(droppedSnapshotResult)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'Mining',
                    error: droppedSnapshotResult.failure,
                  })
                  continue
                }
                const droppedSnapshot = droppedSnapshotResult.success
                const eligibleFromFrame = (yield* Ref.get(state.tickCount)) + 1
                const droppedItems = appendDroppedItemSpawns(
                  droppedSnapshot.state,
                  leftovers.map((item) => ({ ...item, eligibleFromFrame })),
                  plan.request.expectedRevision,
                )
                if (Result.isFailure(droppedItems)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'Mining',
                    error: droppedItems.failure,
                  })
                  continue
                }
                changes = [
                  ...changes,
                  {
                    ownerId: droppedItemsOwnerId,
                    state: droppedItems.success,
                  },
                ]
              }

              const committed = yield* Effect.result(
                commit.coordinator.commit({ ...plan.request, changes }),
              )
              if (Result.isFailure(committed)) {
                yield* recordGameplayStageFailure(state, {
                  _tag: 'Failed',
                  operation: 'WorldCommit',
                  subject: 'Mining',
                  error: committed.failure,
                })
                if (request === undefined) {
                  yield* requestBlockBreak(state, breakPosition, tool, {
                    dimension: miningDimension,
                    toolLocation: undefined,
                  })
                } else {
                  yield* requeueBlockBreak(state, request)
                }
                continue
              }
              yield* Ref.set(state.rollSeed, plannedLoot.seed)
              // planBreakBlock already validated this id against the same immutable registry.
              const yieldedType = Result.getOrThrow(blockTypeOfId(plan.yielded))
              if (yieldedType === 'oak_stairs' || yieldedType === 'purpur_stairs') {
                yield* requestBlockStateRule(state, miningDimension, {
                  requestId: `${request?.requestId ?? positionKey}:refresh-stair-shapes`,
                  position: breakPosition,
                  operation: { _tag: 'RefreshStairShapes' },
                })
              }
              for (const removed of plan.removed) {
                disturbed.push(blockPositionKeyOf(removed))
              }
            } else {
              if (plan.failure._tag === 'WorldDataFault') {
                yield* recordGameplayEntityWorldDataFault(state, 'Mining', plan.failure.failure)
              } else {
                yield* recordGameplayStageFailure(state, {
                  _tag: 'Failed',
                  operation: 'CandidateBuild',
                  subject: 'Mining',
                  error: plan.failure,
                })
              }
              if (plan.failure._tag === 'ObservationChanged' || plan.failure._tag === 'WorldDataFault') {
                if (request === undefined) {
                  yield* requestBlockBreak(state, breakPosition, tool, {
                    dimension: miningDimension,
                    toolLocation: undefined,
                  })
                } else {
                  yield* requeueBlockBreak(state, request)
                }
              }
            }
            continue
          }
        }

        for (const request of blockUses) {
          if (playerDead) {
            blockUseResults.push({
              requestId: request.requestId,
              success: false,
              outcome: 'PlayerDead',
            })
            continue
          }
          const position = yield* blockPositionForRequest(state, request.positionKey, 'BlockUse', request.requestId)
          if (position === undefined) continue
          const outcome = resolveBlockUse(position, yield* store.getBlock(position))
          if (outcome._tag === 'ToggleDoor') {
            const dimension = playerState?.pose.feetPosition.dimension
            if (dimension === undefined) {
              blockUseResults.push({
                requestId: request.requestId,
                success: false,
                outcome: 'PlayerStateUnavailable',
              })
              continue
            }
            yield* requestBlockStateRule(state, dimension, {
              requestId: request.requestId,
              position,
              operation: { _tag: 'ToggleDoor' },
            })
            continue
          }
          blockUseResults.push({
            requestId: request.requestId,
            success: isSuccessfulBlockUse(outcome),
            outcome,
          })
        }

        for (const request of placements) {
          yield* processPlacement(state, commit, context.blockStateWorld, store, playerState, playerDead, request, disturbed)
        }

        // ITEM USES ARE SERVICED LAST, after breaks and placements, and the
        // order is the same decision the break-before-place one is: a player who
        // builds the last block of an obsidian frame and lights it in the same
        // frame gets the sequence they asked for. The other order asks
        // `detectNetherPortal` about a ring that is one block short.
        itemUseRequests: for (const [itemUseIndex, request] of itemUses.entries()) {
          if (
            'action' in request &&
            request.action === 'HarvestPotato' &&
            (!Number.isFinite(request.roll) || request.roll < 0 || request.roll >= 1)
          ) {
            yield* recordGameplayRequestFault(state, 'ItemUse', request.requestId, 'InvalidCropRoll')
            continue itemUseRequests
          }
          if (playerDead && (!('action' in request) || request.action !== 'AdvanceFurnace')) {
            itemUseResults.push({
              requestId: request.requestId,
              success: false,
              outcome: 'PlayerDead',
            })
            continue
          }
          if ('action' in request) {
            itemUseAction: {
              if (request.action === 'ApplyBoneMeal') {
                if (commit === undefined || commit.cropOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'ApplyBoneMeal',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break itemUseAction
                }
                const position = yield* blockPositionForRequest(state, request.positionKey, 'ItemUse', request.requestId)
                if (position === undefined) break itemUseAction
                const activePlayerState = Option.getOrThrow(Option.fromNullishOr(playerState))
                const dimension = activePlayerState.pose.feetPosition.dimension
                const observed = yield* Effect.result(commit.coordinator.observe(
                  commit.playerStorageOwnerId,
                  PlayerStorageSnapshotSchema,
                  [{ dimension, position }],
                ))
                if (Result.isFailure(observed)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: observed.failure,
                  })
                  break itemUseAction
                }
                const blockRead = yield* itemUseBlockTypeAt(state, position, observed.success.blocks[0])
                if (blockRead._tag === 'ChunkNotLoaded') {
                  yield* requeueItemUse(request)
                  continue itemUseRequests
                }
                if (blockRead._tag === 'Failure') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    consumedCount: 0,
                    outcome: blockRead.failure,
                  })
                  break itemUseAction
                }
                const outcome = yield* applyBoneMeal(
                  () => Effect.succeed(blockRead.blockType),
                  position,
                )
                if (outcome._tag !== 'applied') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    consumedCount: 0,
                    outcome,
                  })
                  break itemUseAction
                }
                const candidate = candidateForPlayerStorageItemUse(
                  commit.playerStorageOwnerId,
                  observed.success.state,
                  request.heldItem,
                  'consume',
                )
                if (candidate === undefined) {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    consumedCount: 0,
                    outcome,
                  })
                  break itemUseAction
                }
                const stateRead = yield* blockStateWorldPortForChunkStore(store).read(position)
                const stateOutcome = stateRead._tag === 'Unsupported'
                  ? {
                      _tag: 'stateUnsupported' as const,
                      at: position,
                      block: blockRead.blockType,
                      operation: stateRead.operation,
                    }
                  : {
                      _tag: 'stateUnavailable' as const,
                      at: position,
                      reason: stateRead.reason,
                    }
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success: false,
                  consumedCount: 0,
                  outcome: stateOutcome,
                })
                break itemUseAction
              }
              else if (request.action === 'TillSoil') {
                const ground = yield* blockPositionForRequest(state, request.positionKey, 'ItemUse', request.requestId)
                if (ground === undefined) break itemUseAction
                const aboveResult = cellAbove(ground)
                if (Result.isFailure(aboveResult)) {
                  yield* recordGameplayRequestFault(state, 'ItemUse', request.requestId, 'NeighbourPositionOverflow')
                  break itemUseAction
                }
                const above = aboveResult.success
                if (commit === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'TillSoil',
                    requestId: request.requestId,
                    reason: 'WorldCommitCoordinatorUnavailable',
                  })
                  break itemUseAction
                }
                const activePlayerState = Option.getOrThrow(Option.fromNullishOr(playerState))
                const dimension = activePlayerState.pose.feetPosition.dimension
                const observed = yield* Effect.result(commit.coordinator.observe(
                  commit.playerStorageOwnerId,
                  PlayerStorageSnapshotSchema,
                  [{ dimension, position: ground }, { dimension, position: above }],
                ))
                if (Result.isFailure(observed)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: observed.failure,
                  })
                  break itemUseAction
                }
                const groundRead = yield* itemUseBlockTypeAt(state, ground, observed.success.blocks[0])
                const aboveRead = yield* itemUseBlockTypeAt(state, above, observed.success.blocks[1])
                if (groundRead._tag === 'ChunkNotLoaded') {
                  yield* requeueItemUse(request)
                  continue itemUseRequests
                }
                if (groundRead._tag === 'Failure') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    durabilityDamage: 0,
                    outcome: groundRead.failure,
                  })
                  break itemUseAction
                }
                if (aboveRead._tag === 'ChunkNotLoaded') {
                  yield* requeueItemUse(request)
                  continue itemUseRequests
                }
                if (aboveRead._tag === 'Failure') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    durabilityDamage: 0,
                    outcome: aboveRead.failure,
                  })
                  break itemUseAction
                }
                const groundBlock = groundRead.blockType
                const aboveBlock = aboveRead.blockType
                const candidate = candidateForPlayerStorageItemUse(
                  commit.playerStorageOwnerId,
                  observed.success.state,
                  request.heldItem,
                  'damage',
                )
                const outcome = tillingVerdict(
                  { tills: candidate !== undefined },
                  ground,
                  groundBlock,
                  aboveBlock,
                )
                const success = outcome._tag === 'tilled' && candidate !== undefined
                if (outcome._tag === 'tilled' && candidate !== undefined) {
                  const candidateChange = candidate
                  const committed = yield* Effect.result(Effect.gen(function* () {
                    const expectedDimensionRevision = yield* commit.coordinator.dimensionRevision(dimension)
                    const farmland = Option.getOrThrow(blockIdOf(TILLED_BLOCK))
                    const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
                      world: observed.success.world,
                      expectedWorldRevision: observed.success.revision,
                      dimension,
                      expectedDimensionRevision,
                      edits: [{ position: ground, block: farmland }],
                    })
                    return yield* commit.coordinator.commit({
                      expectedRevision: observed.success.revision,
                      expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
                      changes: [candidateChange],
                      blockWrite,
                    })
                  }))
                  if (Result.isFailure(committed)) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'WorldCommit',
                      subject: 'ItemUse',
                      error: committed.failure,
                    })
                    yield* requeueItemUsesFrom(itemUseIndex)
                    break itemUseRequests
                  }
                  disturbed.push(request.positionKey)
                }
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success,
                  durabilityDamage: success ? 1 : 0,
                  outcome,
                })
                break itemUseAction
              }
              else if (request.action === 'PlantPotato') {
                const soil = yield* blockPositionForRequest(state, request.positionKey, 'ItemUse', request.requestId)
                if (soil === undefined) break itemUseAction
                const above = Result.getOrUndefined(cropCellAbove(soil))
                if (commit === undefined || commit.cropOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'PlantPotato',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break itemUseAction
                }
                if (above === undefined) {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    consumedCount: 0,
                    outcome: { _tag: 'invalidPosition' },
                  })
                  break itemUseAction
                }
                const activePlayerState = Option.getOrThrow(Option.fromNullishOr(playerState))
                const dimension = activePlayerState.pose.feetPosition.dimension
                const observed = yield* Effect.result(commit.coordinator.observe(
                  commit.playerStorageOwnerId,
                  PlayerStorageSnapshotSchema,
                  [{ dimension, position: soil }, { dimension, position: above }],
                ))
                if (Result.isFailure(observed)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: observed.failure,
                  })
                  break itemUseAction
                }
                const cropSnapshot = yield* Effect.result(commit.coordinator.snapshot(
                  commit.cropOwnerId,
                  CropSnapshotSchema,
                ))
                if (Result.isFailure(cropSnapshot)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: cropSnapshot.failure,
                  })
                  break itemUseAction
                }
                if (cropSnapshot.success.revision !== observed.success.revision) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: new WorldRevisionConflict({
                      expected: observed.success.revision,
                      actual: cropSnapshot.success.revision,
                    }),
                  })
                  yield* requeueItemUsesFrom(itemUseIndex)
                  break itemUseRequests
                }
                const soilRead = yield* itemUseBlockTypeAt(state, soil, observed.success.blocks[0])
                const aboveRead = yield* itemUseBlockTypeAt(state, above, observed.success.blocks[1])
                if (soilRead._tag === 'ChunkNotLoaded') {
                  yield* requeueItemUse(request)
                  continue itemUseRequests
                }
                if (soilRead._tag === 'Failure') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    consumedCount: 0,
                    outcome: soilRead.failure,
                  })
                  break itemUseAction
                }
                if (aboveRead._tag === 'ChunkNotLoaded') {
                  yield* requeueItemUse(request)
                  continue itemUseRequests
                }
                if (aboveRead._tag === 'Failure') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    consumedCount: 0,
                    outcome: aboveRead.failure,
                  })
                  break itemUseAction
                }
                const soilBlock = soilRead.blockType
                const aboveBlock = aboveRead.blockType
                const candidate = candidateForPlayerStorageItemUse(
                  commit.playerStorageOwnerId,
                  observed.success.state,
                  request.heldItem,
                  'consume',
                )
                const outcome = candidate === undefined
                  ? { _tag: 'notASeed' as const, held: request.heldItem }
                  : plantingVerdict({ held: request.heldItem, soil }, soilBlock, aboveBlock)
                const success = outcome._tag === 'planted' && candidate !== undefined
                if (outcome._tag === 'planted' && candidate !== undefined) {
                  const existingCrop = cropAt(cropSnapshot.success.state, dimension, outcome.at)
                  if (existingCrop !== undefined) {
                    itemUseResults.push({
                      action: request.action,
                      requestId: request.requestId,
                      heldItem: request.heldItem,
                      success: false,
                      consumedCount: 0,
                      outcome: {
                        _tag: 'cropOwnerMismatch',
                        crop: outcome.crop,
                        at: outcome.at,
                      },
                    })
                    break itemUseAction
                  }
                  const cropChange = cropCandidate(commit.cropOwnerId, [
                    ...cropSnapshot.success.state.crops,
                    { dimension, position: outcome.at, crop: outcome.crop, growthSecs: 0 },
                  ])
                  const candidateChange = candidate
                  const committed = yield* Effect.result(Effect.gen(function* () {
                    const expectedDimensionRevision = yield* commit.coordinator.dimensionRevision(dimension)
                    const crop = Option.getOrThrow(blockIdOf(outcome.crop))
                    const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
                      world: observed.success.world,
                      expectedWorldRevision: observed.success.revision,
                      dimension,
                      expectedDimensionRevision,
                      edits: [{ position: outcome.at, block: crop }],
                    })
                    return yield* commit.coordinator.commit({
                      expectedRevision: observed.success.revision,
                      expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
                      changes: [candidateChange, cropChange],
                      blockWrite,
                    })
                  }))
                  if (Result.isFailure(committed)) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'WorldCommit',
                      subject: 'ItemUse',
                      error: committed.failure,
                    })
                    yield* requeueItemUsesFrom(itemUseIndex)
                    break itemUseRequests
                  }
                }
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success,
                  consumedCount: success ? 1 : 0,
                  outcome,
                })
                break itemUseAction
              }
              else if (request.action === 'HarvestPotato') {
                if (commit === undefined || commit.cropOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'HarvestPotato',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break itemUseAction
                }
                const position = yield* blockPositionForRequest(state, request.positionKey, 'ItemUse', request.requestId)
                if (position === undefined) break itemUseAction
                const activePlayerState = Option.getOrThrow(Option.fromNullishOr(playerState))
                const dimension = activePlayerState.pose.feetPosition.dimension
                const observed = yield* Effect.result(commit.coordinator.observe(
                  commit.playerStorageOwnerId,
                  PlayerStorageSnapshotSchema,
                  [{ dimension, position }],
                ))
                if (Result.isFailure(observed)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: observed.failure,
                  })
                  break itemUseAction
                }
                const cropSnapshot = yield* Effect.result(commit.coordinator.snapshot(
                  commit.cropOwnerId,
                  CropSnapshotSchema,
                ))
                if (Result.isFailure(cropSnapshot)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: cropSnapshot.failure,
                  })
                  break itemUseAction
                }
                if (cropSnapshot.success.revision !== observed.success.revision) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: new WorldRevisionConflict({
                      expected: observed.success.revision,
                      actual: cropSnapshot.success.revision,
                    }),
                  })
                  yield* requeueItemUsesFrom(itemUseIndex)
                  break itemUseRequests
                }
                const crop = cropAt(cropSnapshot.success.state, dimension, position)
                const blockRead = yield* itemUseBlockTypeAt(state, position, observed.success.blocks[0])
                if (blockRead._tag === 'ChunkNotLoaded') {
                  yield* requeueItemUse(request)
                  continue itemUseRequests
                }
                if (blockRead._tag === 'Failure') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    positionKey: request.positionKey,
                    success: false,
                    outcome: blockRead.failure,
                  })
                  break itemUseAction
                }
                const cropType = blockRead.blockType
                if (crop === undefined || crop.crop !== cropType) {
                  const outcome = crop === undefined && !isCropType(cropType)
                    ? cropDrops(cropType, false, request.roll)
                    : {
                        _tag: 'cropOwnerMismatch' as const,
                        block: cropType,
                        registeredCrop: crop?.crop,
                      }
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    positionKey: request.positionKey,
                    success: false,
                    outcome,
                  })
                  break itemUseAction
                }
                const outcome = cropDrops(crop.crop, isMatureCrop(crop), request.roll)
                let storage = observed.success.state
                const leftovers: Array<DroppedItemSpawn> = []
                for (const drop of outcome.drops) {
                  const added = Result.getOrThrow(addInventoryItem(storage.inventory, drop.item, drop.count))
                  const updated = Result.getOrThrow(withInventory(storage, added.inventory))
                  storage = updated
                  if (added.leftover > 0) {
                    leftovers.push({
                      item: drop.item,
                      count: added.leftover,
                      at: {
                        x: PositionAxis(position.x),
                        y: PositionAxis(position.y),
                        z: PositionAxis(position.z),
                      },
                    })
                  }
                }
                const cropChange = cropCandidate(
                  commit.cropOwnerId,
                  cropSnapshot.success.state.crops.filter((entry) => entry !== crop),
                )
                let changes: Array<ReplicatedOwnerCandidate> = [
                  { ownerId: commit.playerStorageOwnerId, state: storage },
                  cropChange,
                ]
                if (leftovers.length > 0) {
                  const droppedItemsOwnerId = commit.droppedItemsOwnerId
                  if (droppedItemsOwnerId === undefined) {
                    yield* recordGameplayUnsupportedOperation(state, {
                      _tag: 'Unsupported',
                      action: 'HarvestPotato',
                      requestId: request.requestId,
                      reason: 'OwnerRegistrationUnavailable',
                    })
                    break itemUseAction
                  }
                  const droppedSnapshot = yield* Effect.result(commit.coordinator.snapshot(
                    droppedItemsOwnerId,
                    DroppedItemOwnerSnapshotSchema,
                  ))
                  if (Result.isFailure(droppedSnapshot)) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'OwnerSnapshot',
                      subject: 'ItemUse',
                      error: droppedSnapshot.failure,
                    })
                    break itemUseAction
                  }
                  if (droppedSnapshot.success.revision !== observed.success.revision) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'OwnerSnapshot',
                      subject: 'ItemUse',
                      error: new WorldRevisionConflict({
                        expected: observed.success.revision,
                        actual: droppedSnapshot.success.revision,
                      }),
                    })
                    yield* requeueItemUsesFrom(itemUseIndex)
                    break itemUseRequests
                  }
                  const eligibleFromFrame = (yield* Ref.get(state.tickCount)) + 1
                  const droppedItems = appendDroppedItemSpawns(
                    droppedSnapshot.success.state,
                    leftovers.map((drop) => ({ ...drop, eligibleFromFrame })),
                    observed.success.revision,
                  )
                  if (Result.isFailure(droppedItems)) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'CandidateBuild',
                      subject: 'ItemUse',
                      error: droppedItems.failure,
                    })
                    break itemUseAction
                  }
                  changes = [
                    ...changes,
                    { ownerId: droppedItemsOwnerId, state: droppedItems.success },
                  ]
                }
                const committed = yield* Effect.result(Effect.gen(function* () {
                  const expectedDimensionRevision = yield* commit.coordinator.dimensionRevision(dimension)
                  const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
                    world: observed.success.world,
                    expectedWorldRevision: observed.success.revision,
                    dimension,
                    expectedDimensionRevision,
                    edits: [{ position, block: AIR_BLOCK_ID }],
                  })
                  return yield* commit.coordinator.commit({
                    expectedRevision: observed.success.revision,
                    expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
                    changes,
                    blockWrite,
                  })
                }))
                if (Result.isFailure(committed)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'WorldCommit',
                    subject: 'ItemUse',
                    error: committed.failure,
                  })
                  yield* requeueItemUsesFrom(itemUseIndex)
                  break itemUseRequests
                }
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  positionKey: request.positionKey,
                  success: true,
                  outcome,
                })
                disturbed.push(request.positionKey)
                break itemUseAction
              }
              else if (request.action === 'EatPotato' || request.action === 'EatFood') {
                if (commit === undefined || commit.vitalsOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'EatFood',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break itemUseAction
                }
                const heldItem = request.action === 'EatPotato' ? 'potato' : request.heldItem
                const effectRoll = request.action === 'EatPotato' ? 1 : request.effectRoll
                const storageSnapshot = yield* Effect.result(commit.coordinator.snapshot(
                  commit.playerStorageOwnerId,
                  PlayerStorageSnapshotSchema,
                ))
                if (Result.isFailure(storageSnapshot)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: storageSnapshot.failure,
                  })
                  break itemUseAction
                }
                const eatenVitalsSnapshot = yield* Effect.result(commit.coordinator.snapshot(
                  commit.vitalsOwnerId,
                  ExperienceOrbVitalsOwnerSnapshotSchema,
                ))
                if (Result.isFailure(eatenVitalsSnapshot)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'Vitals',
                    error: eatenVitalsSnapshot.failure,
                  })
                  break itemUseAction
                }
                if (storageSnapshot.success.revision !== eatenVitalsSnapshot.success.revision) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'Vitals',
                    error: new WorldRevisionConflict({
                      expected: storageSnapshot.success.revision,
                      actual: eatenVitalsSnapshot.success.revision,
                    }),
                  })
                  yield* requeueItemUsesFrom(itemUseIndex)
                  break itemUseRequests
                }
                const vitals = eatenVitalsSnapshot.success.state.vitals
                const foodResolution = resolveFoodUse({
                  held: heldItem,
                  vitals: {
                    healthPoints: vitals.healthPoints,
                    hungerPoints: vitals.hungerPoints,
                    maxHungerPoints: vitals.maxHungerPoints,
                  },
                  effectRoll,
                })
                const publishFoodResult = (
                  success: boolean,
                  consumedCount: 0 | 1,
                  finalOutcome:
                    | FoodUseOutcome
                    | InvalidFoodItemId
                    | { readonly _tag: 'missingItem' },
                ) => {
                  if (request.action === 'EatPotato') {
                    itemUseResults.push({
                      action: 'EatPotato',
                      requestId: request.requestId,
                      heldItem: 'potato',
                      success,
                      consumedCount,
                      outcome: finalOutcome,
                    })
                  } else {
                    itemUseResults.push({
                      action: 'EatFood',
                      requestId: request.requestId,
                      heldItem: request.heldItem,
                      success,
                      consumedCount,
                      outcome: finalOutcome,
                    })
                  }
                }
                if (Result.isFailure(foodResolution)) {
                  publishFoodResult(false, 0, foodResolution.failure)
                  break itemUseAction
                }
                const outcome = foodResolution.success
                if (outcome._tag !== 'consume') {
                  publishFoodResult(false, 0, outcome)
                  break itemUseAction
                }
                const storageCandidate = candidateForPlayerStorageItemUse(
                  commit.playerStorageOwnerId,
                  storageSnapshot.success.state,
                  heldItem,
                  'consume',
                )
                if (storageCandidate === undefined) {
                  publishFoodResult(false, 0, { _tag: 'missingItem' })
                  break itemUseAction
                }
                let statusEffectCandidate: ReplicatedOwnerCandidate | undefined
                let nextStatusEffectState: ValidatedStatusEffectState | undefined
                if (outcome.effects.length > 0) {
                  const statusEffectsOwnerId = commit.statusEffectsOwnerId
                  if (statusEffectsOwnerId === undefined) {
                    yield* recordGameplayUnsupportedOperation(state, {
                      _tag: 'Unsupported',
                      action: 'EatFood',
                      requestId: request.requestId,
                      reason: 'OwnerRegistrationUnavailable',
                    })
                    break itemUseAction
                  }
                  const statusEffectsSnapshot = yield* Effect.result(commit.coordinator.snapshot(
                    statusEffectsOwnerId,
                    ValidatedStatusEffectStateSchema,
                  ))
                  if (Result.isFailure(statusEffectsSnapshot)) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'OwnerSnapshot',
                      subject: 'ItemUse',
                      requestId: request.requestId,
                      error: statusEffectsSnapshot.failure,
                    })
                    break itemUseAction
                  }
                  if (statusEffectsSnapshot.success.revision !== storageSnapshot.success.revision) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'OwnerSnapshot',
                      subject: 'ItemUse',
                      requestId: request.requestId,
                      error: new WorldRevisionConflict({
                        expected: storageSnapshot.success.revision,
                        actual: statusEffectsSnapshot.success.revision,
                      }),
                    })
                    yield* requeueItemUsesFrom(itemUseIndex)
                    break itemUseRequests
                  }
                  let nextStatusEffects = statusEffectsSnapshot.success.state
                  for (const effect of outcome.effects) {
                    const applied = applyStatusEffectToValidatedState(nextStatusEffects, effect)
                    nextStatusEffects = applied.state
                  }
                  statusEffectCandidate = {
                    ownerId: statusEffectsOwnerId,
                    state: nextStatusEffects,
                  }
                  nextStatusEffectState = nextStatusEffects
                }
                const nutrition = Result.getOrThrow(FoodNutrition.result(outcome.foodPoints))
                const saturation = Result.getOrThrow(SaturationModifier.result(outcome.saturationModifier))
                const nextVitals = eatVitals(vitals, nutrition, saturation)
                const committed = yield* Effect.result(commit.coordinator.commit({
                  expectedRevision: storageSnapshot.success.revision,
                  expectedDimensions: [],
                  changes: [
                    storageCandidate,
                    {
                      ownerId: commit.vitalsOwnerId,
                      state: { vitals: nextVitals },
                    },
                    ...(statusEffectCandidate === undefined ? [] : [statusEffectCandidate]),
                  ],
                }))
                if (Result.isFailure(committed)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'WorldCommit',
                    subject: 'Vitals',
                    requestId: request.requestId,
                    error: committed.failure,
                  })
                  yield* requeueItemUsesFrom(itemUseIndex)
                  break itemUseRequests
                }
                publishFoodResult(true, 1, outcome)
                if (nextStatusEffectState !== undefined) {
                  const nextModifiers = statusEffectModifiers(nextStatusEffectState)
                  yield* Ref.set(state.playerMovementSpeedMultiplier, nextModifiers.movementSpeedMultiplier)
                  yield* Ref.set(state.playerStatusEffectModifiers, nextModifiers)
                }
                break itemUseAction
              }
              else if (request.action === 'UseBucket') {
                if (commit === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'UseBucket',
                    requestId: request.requestId,
                    reason: 'WorldCommitCoordinatorUnavailable',
                  })
                  break itemUseAction
                }
                const position = yield* blockPositionForRequest(state, request.positionKey, 'ItemUse', request.requestId)
                if (position === undefined) break itemUseAction
                const bucketResult = yield* Effect.result(useBucket(
                  commit.coordinator,
                  state.fluidFrontier,
                  {
                    activeDimension: request.activeDimension,
                    targetDimension: request.targetDimension,
                    position,
                    heldItem: request.heldItem,
                    playerStorageOwnerId: commit.playerStorageOwnerId,
                  },
                ))
                if (Result.isFailure(bucketResult)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'WorldCommit',
                    subject: 'ItemUse',
                    error: bucketResult.failure,
                  })
                  if (isRetryableWorldCommitFailure(bucketResult.failure)) {
                    yield* requeueItemUsesFrom(itemUseIndex)
                    break itemUseRequests
                  }
                  break itemUseAction
                }
                const outcome = bucketResult.success
                if (outcome._tag === 'Collected' || outcome._tag === 'Placed') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: true,
                    outcome,
                  })
                } else {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    outcome,
                  })
                }
                break itemUseAction
              }
              else if (request.action === 'CastFishing' || request.action === 'AdvanceFishing' || request.action === 'CancelFishing' || request.action === 'ReelFishing') {
                yield* processFishingItemUse(state, commit, request)
                break itemUseAction
              }
              else if (request.action === 'CollectBrewingBottle') {
                yield* processBrewingBottleCollection(state, commit, request)
                break itemUseAction
              }
              else if (request.action === 'InsertBrewingFuel' || request.action === 'InsertBrewingBottle' || request.action === 'InsertBrewingIngredient' || request.action === 'DrinkPotion') {
                yield* processBrewingItemUse(state, commit, request)
                break itemUseAction
              }
              else {
                const planned = planFurnaceAdvance(request.state, request.deltaTimeSecs)
                if (Result.isFailure(planned)) {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: false,
                    failure: planned.failure,
                  })
                } else {
                  const plan = planned.success
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: furnaceAdvanceChanged(plan),
                    plan,
                  })
                }
                break itemUseAction
              }
            }
            continue
          }

          if (commit === undefined) {
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'IgniteTnt',
              requestId: String(request.requestId),
              reason: 'WorldCommitCoordinatorUnavailable',
            })
            continue
          }
          const activePlayerState = Option.getOrThrow(Option.fromNullishOr(playerState))
          const ignitionPosition = yield* blockPositionForRequest(state, request.positionKey, 'Tnt', String(request.requestId))
          if (ignitionPosition === undefined) continue
          const targetBlock = yield* store.getBlock(ignitionPosition)
          if (targetBlock._tag === 'Block' && targetBlock.block === TNT_BLOCK_ID) {
            const dimension = activePlayerState.pose.feetPosition.dimension
            const tntOwnerId = commit.tntOwnerId
            const tntSourcesOwnerId = commit.tntSourcesOwnerId
            const playerStorageOwnerId = commit.playerStorageOwnerId
            if (tntOwnerId === undefined || tntSourcesOwnerId === undefined) {
              yield* recordGameplayUnsupportedOperation(state, {
                _tag: 'Unsupported',
                action: 'IgniteTnt',
                requestId: String(request.requestId),
                reason: 'OwnerRegistrationUnavailable',
              })
              continue
            }
            const observedTnt = yield* Effect.result(commit.coordinator.observe(
              tntOwnerId,
              TntServiceSnapshotSchema,
              [{ dimension, position: ignitionPosition }],
            ))
            const observedStorage = yield* Effect.result(commit.coordinator.observe(
              playerStorageOwnerId,
              PlayerStorageSnapshotSchema,
              [],
            ))
            const observedTntSources = yield* Effect.result(commit.coordinator.snapshot(
              tntSourcesOwnerId,
              GameplayTntSourcesSnapshotSchema,
            ))
            if (Result.isFailure(observedTnt)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: observedTnt.failure,
              })
              continue
            }
            if (Result.isFailure(observedStorage)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: observedStorage.failure,
              })
              continue
            }
            if (Result.isFailure(observedTntSources)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse', error: observedTntSources.failure,
              })
              continue
            }
            if (observedTnt.success.revision !== observedStorage.success.revision ||
              observedTnt.success.revision !== observedTntSources.success.revision) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
                error: new WorldRevisionConflict({
                  expected: observedTnt.success.revision,
                  actual: observedStorage.success.revision !== observedTnt.success.revision
                    ? observedStorage.success.revision
                    : observedTntSources.success.revision,
                }),
              })
              yield* requeueItemUsesFrom(itemUseIndex)
              break itemUseRequests
            }
            if (observedTnt.success.blocks[0]?.reading._tag !== 'Block' ||
              observedTnt.success.blocks[0].reading.block !== TNT_BLOCK_ID) {
              continue
            }
            const storageCandidate = candidateForPlayerStorageItemUse(
              playerStorageOwnerId,
              observedStorage.success.state,
              request.heldItem,
              request.heldItem === 'fire_charge' ? 'consume' : 'damage',
            )
            if (storageCandidate === undefined) {
              itemUseResults.push({
                requestId: request.requestId,
                heldItem: request.heldItem,
                success: false,
                outcome: { _tag: 'Tnt', outcome: { _tag: 'NotTnt' } },
              })
              continue
            }
            const tntId = Schema.decodeUnknownSync(EntityIdSchema)(`gameplay:tnt:${request.requestId}`)
            const primed = Result.getOrThrow(primeTnt())
            const tntCandidate = Schema.decodeUnknownSync(TntServiceSnapshotSchema)({
              tnts: [...observedTnt.success.state.tnts, {
                id: tntId,
                dimension,
                center: {
                  x: ignitionPosition.x + 0.5,
                  y: ignitionPosition.y + 0.5,
                  z: ignitionPosition.z + 0.5,
                },
                state: primed,
              }],
            })
            const tntSourcesCandidate = Schema.decodeUnknownSync(GameplayTntSourcesSnapshotSchema)({
              sources: [
                ...observedTntSources.success.state.sources,
                { tntId, killCredit: 'player-triggered-tnt' },
              ],
            })
            const storageChange = storageCandidate
            const tntState = tntCandidate
            const coordinator = commit.coordinator
            const committed = yield* Effect.result(Effect.gen(function* () {
              const expectedDimensionRevision = yield* coordinator.dimensionRevision(dimension)
              const blockWrite = Schema.decodeUnknownSync(WorldWriteBatchSchema)({
                world: observedTnt.success.world,
                expectedWorldRevision: observedTnt.success.revision,
                dimension,
                expectedDimensionRevision,
                edits: [{ position: ignitionPosition, block: AIR_BLOCK_ID }],
              })
              return yield* commit.coordinator.commit({
                expectedRevision: observedTnt.success.revision,
                expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
                changes: [
                  { ownerId: tntOwnerId, state: tntState },
                  { ownerId: tntSourcesOwnerId, state: tntSourcesCandidate },
                  storageChange,
                ],
                blockWrite,
              })
            }))
            if (Result.isFailure(committed)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse', error: committed.failure,
              })
              yield* requeueItemUsesFrom(itemUseIndex)
              break itemUseRequests
            }
            used.push(request.heldItem)
            itemUseResults.push({
              requestId: request.requestId,
              heldItem: request.heldItem,
              success: true,
              outcome: { _tag: 'Tnt', outcome: { _tag: 'Lit' } },
            })
            continue
          }
          const ignitionDimension = activePlayerState.pose.feetPosition.dimension
          const storageSnapshot = yield* Effect.result(
            commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema),
          )
          if (Result.isFailure(storageSnapshot)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed',
              operation: 'OwnerSnapshot',
              subject: 'ItemUse',
              error: storageSnapshot.failure,
            })
            continue
          }
          const ignitionCandidateResult = candidateForPlayerStorageItemUse(
            commit.playerStorageOwnerId,
            storageSnapshot.success.state,
            request.heldItem,
            request.heldItem === 'fire_charge' ? 'consume' : 'damage',
          )
          const ignitionCandidate = ignitionCandidateResult
          if (ignitionCandidate === undefined) {
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'IgniteTnt',
              requestId: String(request.requestId),
              reason: 'OwnerRegistrationUnavailable',
            })
            continue
          }
          const expectedDimensionRevision = yield* commit.coordinator.dimensionRevision(ignitionDimension)
          const portal = yield* ignitePortal(store, ignitionPosition)
          let ignition: IgnitionOutcome
          if (portal._tag === 'Ready') {
            const portalBlock = Option.getOrThrow(blockIdOf('nether_portal'))
            const blockWrite = Schema.decodeUnknownSync(WorldWriteBatchSchema)({
              world: commit.coordinator.worldId,
              expectedWorldRevision: storageSnapshot.success.revision,
              dimension: ignitionDimension,
              expectedDimensionRevision,
              edits: portal.cells.map((position) => ({ position, block: portalBlock })),
            })
            const committed = yield* Effect.result(commit.coordinator.commit({
              expectedRevision: storageSnapshot.success.revision,
              expectedDimensions: [{
                dimension: ignitionDimension,
                expectedRevision: expectedDimensionRevision,
              }],
              changes: [ignitionCandidate],
              blockWrite,
            }))
            if (Result.isFailure(committed)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed',
                operation: 'WorldCommit',
                subject: 'ItemUse',
                error: committed.failure,
              })
              yield* requeueItemUsesFrom(itemUseIndex)
              break itemUseRequests
            } else {
              ignition = {
                _tag: 'Portal',
                outcome: { _tag: 'Lit', frame: portal.frame, cells: portal.cells },
              }
            }
          } else if (portal._tag === 'ChunkNotLoaded') {
            ignition = { _tag: 'Portal', outcome: portal }
          } else {
            ignition = {
              _tag: 'Fire',
              outcome: yield* igniteFire(store, ignitionPosition, {
                coordinator: commit.coordinator,
                dimension: ignitionDimension,
                changes: [ignitionCandidate],
                expectedRevision: storageSnapshot.success.revision,
                expectedDimensionRevision,
              }),
            }
          }
          const success = ignition.outcome._tag === 'Lit'
          if (ignition.outcome._tag === 'CommitFailed') {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed',
              operation: 'WorldCommit',
              subject: 'ItemUse',
              error: ignition.outcome.error,
            })
            if (isRetryableWorldCommitFailure(ignition.outcome.error)) {
              yield* requeueItemUsesFrom(itemUseIndex)
              break itemUseRequests
            }
            continue itemUseRequests
          }
          if (ignition._tag === 'Fire' && ignition.outcome._tag === 'Lit') {
            const position = ignition.outcome.position
            yield* Ref.update(state.fireLifecycle, (current) => {
              if (current.fires.some((fire) => firePositionKey(fire.position) === firePositionKey(position))) {
                return current
              }
              return {
                ...current,
                fires: [...current.fires, { position, ageTicks: 0 }],
              }
            })
          }
          itemUseResults.push({
            requestId: request.requestId,
            heldItem: request.heldItem,
            success,
            outcome: ignition,
          })

          // THE ITEM IS SPENT ONLY WHEN SOMETHING LIT, which is the reference's
          // rule (`interaction-flint-steel-handler.ts` damages the held item
          // inside each successful arm, not around the dispatch). A flint and
          // steel clicked at a stone wall loses no durability.
          //
          // ONE TEST FOR BOTH ARMS. `IgnitePortalOutcome` and `IgniteFireOutcome`
          // both spell success `Lit`, deliberately, so this reads the answer
          // without first asking which rule gave it — the `_tag` on the pair is
          // for a caller that wants to REPORT which one ran, which this stage
          // does not.
          if (success) {
            used.push(request.heldItem)
          }

          // NOTHING IS DISTURBED by either arm, and both rules say why: every
          // cell they write was air, and filling a hole cannot start a fall.
        }

        for (const shot of bowShots) {
          yield* processBowShot(state, commit, store, shot, playerDead)
        }
        for (const attack of meleeAttacks) {
          yield* processMeleeAttack(state, commit, attack, playerDead)
        }

        // ---- THE ENDER PEARL -----------------------------------------------
        //
        // ONE ROLL PER THROW, drawn as a BATCH up front rather than one at a time
        // inside the loop, which is `domain/interactions/block-loot.ts`'s
        // convention and `domain/frame-rolls.ts`'s: the budget is a function of
        // how many throws there were and not of what happened to them, so two runs
        // of one scenario draw the same numbers whatever the endermites do.
        for (const thrown of pearlThrows) {
          yield* processEnderPearlThrow(state, commit, thrown)
        }

        if (used.length > 0) {
          yield* Ref.update(state.usedItems, (items) => [...items, ...used])
        }
        if (blockUseResults.length > 0) {
          yield* Ref.update(state.blockUseResults, (items) => [...items, ...blockUseResults])
        }
        if (itemUseResults.length > 0) {
          yield* Ref.update(state.itemUseResults, (items) => [...items, ...itemUseResults])
        }
        // Both are outboxes with no consumer in this repository; the types say
        // which missing noun each is waiting for.
        if (disturbed.length > 0) {
          yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
        }
      }),
  }
}
