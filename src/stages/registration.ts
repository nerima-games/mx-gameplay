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
  type BowKnockback,
  type EnderPearlOutcome,
  makeGameplayFrameState,
  setPlayerDead,
  requestBlockBreak,
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
  drainMeleeAttackResults,
  requestMeleeAttack,
  type TargetedPrimaryAttackResult,
  type TargetedPrimaryAttackResolution,
  type TargetedPrimaryAttackOptions,
  resolveTargetedPrimaryAttack,
  requestTargetedPrimaryAttack,
  requestMobSpawn,
  drainPlayerDamages,
  requestStatusEffect,
  drainPlayerHeals,
  getPlayerMovementSpeedMultiplier,
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
  ChunkStore,
  TimeService,
  entityManagerTag,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  makeGameplayFrameState,
} from './registration-core.js'
import type {
  ChunkStoreApi,
  EntityManager,
  EntityManagerApi,
  GameplayFrameState,
  GameplayStageContext,
  GameplayStageCommitServices,
  GameplayStageOptions,
  InventoryServiceApi,
  MobBehaviour,
  PlayerServiceApi,
  TimeServiceApi,
  VehicleFrameEnvironment,
  VehicleServiceApi,
} from './registration-core.js'
import { WorldCommitCoordinator } from '@nerima-games/mc-sim'
import type { GameModule, StageRegistration } from '@nerima-games/mc-kernel'
import { Effect, Layer } from 'effect'
import { makeVehiclesStage } from './vehicles-stage.js'
import { makeInteractionsStage } from './interactions-stage.js'
import { makeFireStage } from './fire-stage.js'
import { makeSurvivalHungerStage } from './survival-hunger-stage.js'
import { makeEntitiesStage } from './entities-stage.js'
import { makeEnderDragonStage } from './ender-dragon-stage.js'
import { makeFluidsStage } from './fluids-stage.js'
import { makeTimeWeatherStage } from './time-weather-stage.js'
import {
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
} from './gameplay-owner-registrations.js'

export const gameplayStages = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  _inventory: InventoryServiceApi | undefined,
  _player: PlayerServiceApi | undefined,
  time: TimeServiceApi,
  vehicleService?: VehicleServiceApi,
  vehicleEnvironment?: VehicleFrameEnvironment,
  options: GameplayStageOptions = {},
  commit?: GameplayStageCommitServices,
): ReadonlyArray<StageRegistration> => {
  const context: GameplayStageContext = {
    state,
    store,
    roster,
    time,
    vehicleService,
    vehicleEnvironment,
    options,
    commit,
  }
  return [
    makeVehiclesStage(context),
    makeInteractionsStage(context),
    makeFireStage(context),
    makeSurvivalHungerStage(context),
    makeEntitiesStage(context),
    makeEnderDragonStage(context),
    makeFluidsStage(context),
    makeTimeWeatherStage(context),
  ]
}

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
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator
> = Effect.gen(function* () {
  const store = yield* ChunkStore
  const roster = yield* entityManagerTag<MobBehaviour>()
  const time = yield* TimeService
  const coordinator = yield* WorldCommitCoordinator
  const state = yield* makeGameplayFrameState({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })

  return gameplayStages(state, store, roster, undefined, undefined, time, undefined, undefined, {}, {
    coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    cropOwnerId: GAMEPLAY_CROPS_OWNER_ID,
    droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
    villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  })
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
 * WorldCommitCoordinator` and
 * `RIn`
 * is still `never`, which is the distinction that parameter was added for: this
 * repository needs mc-worldgen's store in order to REGISTER stages that write
 * blocks, mc-sim's roster in order to register the stage that iterates mobs,
 * and a commit coordinator for atomic owner and block writes. Player pose and
 * inventory are read from gameplay owner snapshots on supported paths. It
 * needs nothing to build a Layer.
 *
 * The registration contract has four services. `RIn` remains `never`, so
 * mx-gameplay still BUILDS nothing another repository has to supply. A host
 * must provide a coordinator registered with the published gameplay owners
 * before it can build the stages.
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
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator
> = {
  layers: Layer.empty,
  frameStages: makeGameplayStages,
}
