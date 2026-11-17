export {
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  resolveArmoredPlayerDamages,
  LAVA_TICK_INTERVAL,
  HOSTILE_SPAWN_INTERVAL_SECS,
  type GameplayFrameState,
  type PortalTravelEvent,
  type VillagerTradeRequest,
  type VillagerTradeResult,
  type PlacementRequest,
  type BlockBreakRequestContext,
  type BlockMiningAttempt,
  type BlockPlacementRequestId,
  type BlockPlacementMode,
  type BlockPlacementCommand,
  type BlockPlacementCommandFailure,
  type BlockPlacementCommandOutcome,
  type BlockPlacementResult,
  type BlockUseRequestId,
  type BlockUseRequest,
  type BlockUseResult,
  type IgnitionItemUseRequest,
  HOE_ITEM_TYPES,
  type HoeItemType,
  isHoeItem,
  type FarmingItemUseRequest,
  type FurnaceItemUseRequest,
  type BucketItemUseRequest,
  type FishingItemUseRequest,
  type ItemUseRequest,
  type ItemUseRequestId,
  type IgnitionItemUseResult,
  type FarmingItemUseResult,
  type FurnaceItemUseResult,
  type BucketItemUseResult,
  type FishingItemUseResult,
  type PlayerDeadItemUseResult,
  type ItemUseResult,
  type BowShotRequest,
  type InteractionInventoryContext,
  type BowShotRequestId,
  type BowShotResult,
  type GameplayMeleeAttackResult,
  type EnderPearlThrowRequest,
  EnderPearlThrowRequestSchema,
  type BowKnockback,
  type MeleeKnockback,
  type EnderPearlOutcome,
  EnderPearlOutcomeSchema,
  makeGameplayFrameState,
  makeGameplayFrameStateForOwner,
  type EntityStageFault,
  drainGameplayEntityStageFaults,
  requestCollectBrewingBottle,
  type CollectBrewingBottleRequest,
  CollectBrewingBottleRequestSchema,
  type BrewingBottleItemUseResult,
  GameplayBrewingBottleItemUseResultSchema,
  type BrewingItemUseRequest,
  GameplayBrewingItemUseRequestSchema,
  type BrewingItemUseResult,
  GameplayBrewingItemUseResultSchema,
  GameplayFishingItemUseResultSchema,
  setPlayerDead,
  requestBlockBreak,
  requestBlockMining,
  getMiningProgressFraction,
  DEFAULT_BLOCK_REACH,
  requestTargetedBlockBreak,
  requestBlockPlacement,
  requestBlockPlacementCommand,
  validateBlockPlacementCommand,
  drainBlockPlacementResults,
  requestBlockUse,
  drainBlockUseResults,
  drainBlockStateRuleResults,
  requestBlockStateRule,
  requestItemUse,
  requestDropSelectedItem,
  requestPickBlock,
  type DropSelectedItemRequest,
  type PickBlockRequest,
  type HotbarItemUseResult,
  type DropSelectedItemResult,
  type PickBlockResult,
  GameplayDropSelectedItemResultSchema,
  GameplayPickBlockResultSchema,
  GameplayHotbarItemUseResultSchema,
  GameplayPickBlockTargetSchema,
  type PickBlockTarget,
  requestBucketUse,
  requestFishingCast,
  requestFishingAdvance,
  requestFishingCancel,
  requestFishingReel,
  requestSoilTill,
  requestBoneMeal,
  requestPotatoPlanting,
  requestPotatoHarvest,
  requestFoodUse,
  requestPotatoFoodUse,
  requestFurnaceAdvance,
  drainItemUseResults,
  setPortalCandidates,
  drainPortalTravels,
  drainEndPortalTravels,
  drainFluidUpdates,
  requestBowShot,
  drainBowShotResults,
  drainBowKnockbacks,
  drainMeleeKnockbacks,
  drainMeleeAttackResults,
  requestMeleeAttack,
  requestShieldBlocking,
  requestEnderPearlThrow,
  type TargetedPrimaryAttackResult,
  type TargetedPrimaryAttackResolution,
  type TargetedPrimaryAttackOptions,
  type GameplayTargetingSnapshotContext,
  resolveTargetedPrimaryAttack,
  requestTargetedPrimaryAttack,
  requestMobSpawn,
  drainPlayerDamages,
  type GameplayStageOperationFailure,
  requestStatusEffect,
  drainPlayerHeals,
  getPlayerMovementSpeedMultiplier,
  getPlayerStatusEffectModifiers,
  snapshotStatusEffects,
  restoreStatusEffects,
  insertBrewingFuel,
  insertBrewingBottle,
  insertBrewingIngredient,
  collectBrewingPotion,
  useBrewingPotion,
  requestVillagerTrade,
  drainVillagerTradeResults,
  snapshotFireLifecycle,
  restoreFireLifecycle,
  submitWeatherGameplayInput,
  drainWeatherGameplayEvents,
  snapshotWeatherGameplay,
  restoreWeatherGameplay,
  requestFireExtinguish,
  drainMobDrops,
  drainMobExperience,
  requestDroppedItemPickup,
  drainDroppedItemPickupExecutions,
  drainDroppedItemMotionEvents,
  requestExperienceOrbAbsorption,
  drainExperienceOrbAbsorptionExecutions,
  type DroppedItemPickupExecution,
  type ExperienceOrbAbsorptionExecution,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
  resolveTargetedBlock,
  requestTargetedItemUse,
  requestTargetedSoilTill,
  requestTargetedPotatoPlanting,
  type BlockStateRuleRequest,
  type BlockStateRuleResult,
  type GameplayStageOptions,
} from './registration-core.js'
import type { ChunkStore, EntityManager, TimeService } from './registration-core.js'
import type { DomainEventBus, WorldCommitCoordinator } from '@nerima-games/mc-sim'
import type { GameModule, StageRegistration } from '@nerima-games/mc-kernel'
import { Effect, Layer } from 'effect'
export type {
  GameplayStageBlockTypeDecodeFailure,
  GameplayStageMissingBlockReadFailure,
  GameplayStageUnavailableBlockReadFailure,
  GameplayStageItemUseWorldFailure,
  GameplayStageWorldFaultReason,
} from './gameplay-stage-faults.js'
import { makeGameplayComposition } from './gameplay-composition.js'
import type { GameplayBlockStateWorld } from './gameplay-block-state-world.js'
export { gameplayStages } from './gameplay-stages.js'
export {
  GameplayEnchantmentTableApplyRequestSchema,
  GameplayEnchantmentTableOffersRequestSchema,
  GameplayEnchantmentTableResultSchema,
  drainEnchantmentTableResults,
  requestEnchantmentTableApply,
  requestEnchantmentTableOffers,
  type GameplayEnchantmentTableApplyRequest,
  type GameplayEnchantmentTableOffersRequest,
  type GameplayEnchantmentTableResult,
} from './interactions-stage.js'

/** Build the production stage list from `makeGameplayComposition`. */
export const makeGameplayStages: Effect.Effect<
  ReadonlyArray<StageRegistration>,
  never,
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus | GameplayBlockStateWorld
> = Effect.map(makeGameplayComposition, (composition) => composition.stages)

/**
 * mx-gameplay as a `GameModule` (plan.md §4.1).
 *
 * ---------------------------------------------------------------------------
 * This used not to be expressible, and the reason is worth keeping
 * ---------------------------------------------------------------------------
 *
 * The original `makeGameplayStages` implementation carried a comment saying it
 * was "NOT yet a `GameModule`" because a `GameModule` carried a
 * `Layer.Layer<ROut, E, RIn>`
 * and the service set could not be named until mc-sim's public API existed.
 *
 * That diagnosis was half right. The Layer was never the obstacle — mx-gameplay
 * PROVIDES no service at all (a rule is not a service; anything another
 * repository would want to ask this repository is really a question about
 * state, and state lives in mc-sim or mc-worldgen, plan.md §2.3-1), so its
 * Layer is empty and always was. The obstacle was that `frameStages` was an
 * ARRAY: this module's stages are built from `Ref`s allocated in an Effect, so
 * there was no way to put them in a field typed `ReadonlyArray`. Publishing
 * mc-sim would not have fixed that.
 *
 * The vertical-slice spike changed `frameStages` to an Effect, and the shape
 * this repository had already been forced into became the contract.
 *
 * `RRegister` names `ChunkStore | EntityManager | TimeService |
 * WorldCommitCoordinator | DomainEventBus | GameplayBlockStateWorld`.
 * `RIn` remains `never` because `layers` is empty. These services are
 * required to build the stage list: the store and roster support gameplay
 * stages, the coordinator commits owner state, the event bus publishes plan
 * events, and `GameplayBlockStateWorld` supplies state reads and C7 writes.
 * Player pose and inventory still come from gameplay owner snapshots.
 *
 * A host provides six services when it builds the stages. The state adapter
 * must bind its `BlockStateWorldPort` to the C7 `WorldWritePort` and commit
 * optional owner changes with state edits. The host must also register the
 * published gameplay and simulation owners with its coordinator.
 *
 * A host supplies mc-sim's entity and time layers. The host's line is
 *
 *     Layer.mergeAll(
 *       simModule.layers,
 *       EntityManagerLayer<MobBehaviour>(undefined, repairMobBehaviour),
 *     )
 */

export const gameplayModule: GameModule<
  never,
  never,
  never,
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus | GameplayBlockStateWorld
> = {
  layers: Layer.empty,
  frameStages: makeGameplayStages,
}
