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
  drainBlockPlacementResults,
  requestBlockUse,
  drainBlockUseResults,
  requestItemUse,
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
  type GameplayStageOptions,
} from './registration-core.js'

import {
  makeGameplayFrameStateForOwner,
} from './registration-core.js'
import type { ChunkStore, EntityManager, TimeService } from './registration-core.js'
import { WorldCommitCoordinator } from '@nerima-games/mc-sim'
import type { DomainEventBus } from '@nerima-games/mc-sim'
import type { GameModule, StageRegistration } from '@nerima-games/mc-kernel'
import { Effect, Layer } from 'effect'
import { makeGameplayStagesWithState } from './gameplay-stage-composition.js'
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

import { GAMEPLAY_VITALS_OWNER_ID } from './gameplay-owner-registrations.js'

/**
 * Build the module's state and its stages together.
 *
 * This is exactly `GameModule.frameStages` — see `gameplayModule` below. The
 * registration services are the reason that field is an Effect: this is the
 * one moment at which a module may acquire services in order to BUILD stages,
 * rather than in order to run them.
 *
 * ---------------------------------------------------------------------------
 * `MobBehaviour` IS NAMED HERE, AND THAT IS THE POINT OF FAILURE TO KNOW ABOUT
 * ---------------------------------------------------------------------------
 *
 * `entityManagerTag<MobBehaviour>()` and `EntityManagerLayer<MobBehaviour>()`
 * must agree, and NO COMPILER CAN CHECK THAT THEY DO: mc-sim's Layer has result
 * type `Layer.Layer<EntityManager>` with the behaviour parameter appearing
 * nowhere in it, because the context identity is unparameterised while the
 * service value type is not (`docs/public-api.md` §7-1 of that repository). A
 * host that instantiates the roster at some other `S` gets a Layer that
 * satisfies this requirement and a `behaviour` field that is not what the line
 * below says it is.
 *
 * The mitigation is that exactly one repository names the type and the host
 * imports that name: `MobBehaviour` and `repairMobBehaviour` are both exported
 * from `index.ts` for this reason. The host's two lines are
 *
 *     const world = Layer.merge(
 *       simModule.layers,
 *       EntityManagerLayer<MobBehaviour>(undefined, repairMobBehaviour),
 *     )
 *
 * and taking `gameplayModule.frameStages` from inside that same `Effect.provide`.
 * See `docs/public-api.md` for why `simModule` should not grow a type parameter
 * to try to do this for the host.
 */

export const makeGameplayStages: Effect.Effect<
  ReadonlyArray<StageRegistration>,
  never,
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus
> = Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  return yield* makeGameplayStagesWithState(state)
})

/**
 * mx-gameplay as a `GameModule` (plan.md §4.1).
 *
 * ---------------------------------------------------------------------------
 * This used not to be expressible, and the reason is worth keeping
 * ---------------------------------------------------------------------------
 *
 * `makeGameplayStages` above carried a comment saying it was "NOT yet a
 * `GameModule`" because a `GameModule` carried a `Layer.Layer<ROut, E, RIn>`
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
 * `RRegister` is now `ChunkStore | EntityManager | TimeService |
 * WorldCommitCoordinator | DomainEventBus` and
 * `RIn`
 * is still `never`, which is the distinction that parameter was added for: this
 * repository needs mc-worldgen's store in order to REGISTER stages that write
 * blocks, mc-sim's roster in order to register the stage that iterates mobs,
 * a commit coordinator for atomic owner and block writes, and an event bus for
 * post-commit plan events. Player pose and inventory are read from gameplay
 * owner snapshots. It
 * needs nothing to build a Layer.
 *
 * The registration contract has five services. `RIn` remains `never`, so
 * mx-gameplay still BUILDS nothing another repository has to supply. A host
 * must provide a coordinator registered with the published gameplay and
 * simulation owners before it can build the stages.
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
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus
> = {
  layers: Layer.empty,
  frameStages: makeGameplayStages,
}
