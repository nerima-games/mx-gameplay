/**
 * mx-gameplay's contribution to the frame (plan.md §4.1).
 *
 * Shared gameplay frame state and request APIs used by the public
 * stage-registration facade. The facade exposes these APIs alongside stage
 * registration. This package publishes no service for another repository to
 * call, because a rule is not a service — anything another repository would
 * want to ask mx-gameplay is really a question about state, and state lives in
 * mc-sim or mc-worldgen (plan.md §2.3-1). See docs/public-api.md.
 *
 * ---------------------------------------------------------------------------
 * The stages read and write the world through mc-worldgen's `ChunkStore`
 * ---------------------------------------------------------------------------
 *
 * The store is acquired ONCE, in `makeGameplayStages` — that is, in
 * `GameModule.frameStages`, whose `RRegister` parameter exists for exactly this
 * (kernel's `domain/frame.ts`). It is not acquired in `run`, because
 * `StageRegistration.run` has `FrameServices` as its context and `FrameServices`
 * is kernel's, not this repository's: a stage that demanded `ChunkStore` there
 * would be asking kernel to name mc-worldgen's services, which the tier model
 * (plan.md §2.2) forbids. `RIn` stays `never`; this repository BUILDS nothing
 * that another has to supply, it CALLS what mc-worldgen supplies.
 *
 * The tag comes from `@nerima-games/mc-worldgen` directly; the provisional local
 * mirror this repository carried before worldgen published (`domain/chunk-store-port.ts`,
 * kept honest by `test/chunk-store-mirror.test.ts`) is gone.
 *
 * ---------------------------------------------------------------------------
 * ...and the mobs through mc-sim's `EntityManager`
 * ---------------------------------------------------------------------------
 *
 * The second service, acquired at the same moment and for the same reason. It is
 * the roster this file spent a headed paragraph explaining why it could not
 * invent, and mc-sim has now built it; `@nerima-games/mc-sim` is the
 * mirror, `test/entity-manager-mirror.test.ts` keeps it honest, and
 * `domain/entities/mob-frame.ts` is the loop.
 *
 * ---------------------------------------------------------------------------
 * State ownership in this file
 * ---------------------------------------------------------------------------
 *
 * The `Ref`s in `GameplayFrameState` are frame-local scratch: work queues,
 * inboxes, outboxes, a counter and a seed. They are NOT game state. The blocks
 * that fall, the fluid that flows, the items in the inventory, the mobs that
 * exist and the time of day are all mc-sim's and mc-worldgen's to hold; a
 * frontier is a note about what to look at next, and it is legitimately private
 * to the stage that consumes it.
 *
 * The distinction is worth policing, because "just one more Ref" is how the
 * reference implementation ended up with 13k LOC of rules in its composition
 * layer (plan.md §3.15). The test for whether a Ref belongs here: would a save
 * file need it? If yes, it belongs to mc-save via mc-sim.
 *
 * That test had already been failed once, and the failure is instructive. This
 * file used to hold `timeOfDaySecs` and `dayLengthSecs` `Ref`s and advance them
 * in the `gameplay:time-weather` stage, with a `DEFAULT_DAY_LENGTH_SECS` of
 * 1200 against mc-sim's 400. A save file certainly needs the time of day, so by
 * the rule stated two paragraphs above it was never this repository's — and
 * mc-sim already owned it, in `domain/time-of-day.ts` behind
 * `application/time-service.ts`, ordering hazard and all. Two owners of one
 * noun is two answers to "what time is it", and only one of them gets saved.
 * The rule that remains here — what the world DOES about the hour — is
 * `domain/day-night.ts`, and it holds nothing.
 *
 * Note what the block writes did NOT add: a copy of the world. The stages below
 * hold no blocks. Every read and every write goes to the store, and the only
 * thing kept between ticks is which POSITIONS are worth looking at again.
 *
 * ---------------------------------------------------------------------------
 * Why a factory rather than a constant
 * ---------------------------------------------------------------------------
 *
 * `makeGameplayFrameState` is an Effect, so two playgrounds, or a test and the
 * game, can each hold their own. plan.md §3.8 records that app-scope singletons
 * were among the reference's worst bug sources: a second world load inherited
 * the first world's fibers and refs and deadlocked. Re-entrant initialisation
 * from the start is cheaper than retrofitting it.
 */
import {
  adjacentBlockPosition,
  AIR_BLOCK_ID,
  BlockAxis,
  BlockAddressSchema,
  BlockId,
  DomainEventSchema,
  EntityIdSchema,
  blockIdOf,
  ProjectileIdSchema,
  SimulationTickSchema,
  WorldWriteBatchSchema,
  type WorldWriteBatch,
  blockPosition as kernelBlockPosition,
  blockPositionKeyOf,
  blockPositionOfKey,
  blockTypeOfId,
  capabilityOfBlockId,
  decodeBlockPositionKey,
  horizontalBlockNeighbours,
  PositionAxis,
  position as kernelPosition,
  type BlockPosition,
  type BlockPositionKey,
  type BlockAddress,
  type BlockType,
  type DeltaTimeSecs,
  type GameModule,
  type ItemType,
  type PlaceableItemType,
  type Position,
  type ProjectileId,
  type SimulationTick,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import {
  EYE_LEVEL_OFFSET,
  InventoryService,
  TimeService,
  addItem as addInventoryItem,
  forwardVector,
  removeItem as removeInventoryItem,
  targetBlockFromPlayerPose,
  type BlockTarget,
  type BlockTargetInputError,
  type CameraPoseError,
  type EquipmentItem,
  type FurnaceFailure,
  type FurnaceState,
  type InventoryServiceApi,
  PlayerServiceSnapshotSchema,
  BrewingServiceStateSchema,
  BrewingServicePlanSnapshotSchema,
  BrewingBottleIndexSchema,
  FishingStateSchema,
  FishingServicePlanSnapshotSchema,
  FishingCastIntentSchema,
  FishingAdvanceIntentSchema,
  FishingCancelIntentSchema,
  FishingReelIntentSchema,
  FishingServiceReelSuccessSchema,
  FishingProgressOutcomeSchema,
  FishingCancelOutcomeSchema,
  FishingLootSampleSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  launchProjectile,
  mergeWorldCommitPlans,
  WorldCommitPlanMergeResultSchema,
  WorldCommitPlanRequestSchema,
  worldCommitPlanFragmentSchema,
  worldCommitPlanSnapshotSchema,
  type BrewingServiceApi,
  type FishingServiceApi,
  type DomainEventBusApi,
  type ProjectileProfile,
  type WorldCommitPlanFragment,
  type TimeServiceApi,
  type VehicleServiceApi,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Equal, Option, Ref, Result, Schema, Semaphore } from 'effect'
import {
  PlayerStorageSnapshotSchema,
  damageAt as damagePlayerStorageAt,
  validatePlayerStorageSnapshot,
  withInventory,
  type PlayerStorage,
  type ReplicatedOwnerCandidate,
  type ReplicatedOwnerId,
  type ReplicatedWorldDelta,
  type ReplicatedOwnerChange,
  type StorageLocation,
  type ReplicatedSnapshot,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
} from '@nerima-games/mc-sim'
export {
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
} from './gameplay-owner-registrations.js'
import { useVillagerOffer } from '../domain/villager-trade.js'
import {
  PLAYER_MAXIMUM_HEALTH_POINTS,
  POISON_DAMAGE_POINTS,
  POISON_MINIMUM_HEALTH_POINTS,
  REGENERATION_HEAL_POINTS,
  SPEED_MOVEMENT_MULTIPLIER,
  applyStatusEffect,
  copyStatusEffectState,
  emptyStatusEffectState,
  tickStatusEffects,
  type PlayerHealingEvent,
  type StatusEffectApplication,
  type StatusEffectState,
} from '../domain/status-effect.js'
import { targetabilityFromStore } from '../domain/in-memory-world.js'
import type { BrewingBottle, BrewingIngredient } from '../domain/brewing.js'
import { ChunkStore, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import {
  chunkCoordsAround,
  openChunkWindow,
  UNREADABLE_BLOCK,
} from '../domain/chunk-window.js'
import {
  advanceFireLifecycle,
  FIRE_FRAME_TICK_BUDGET,
  FIRE_TICK_INTERVAL_SECS,
  FIRE_UNAVAILABLE_BLOCK,
  FIRE_WORK_BUDGET,
  extinguishFire,
  isFireLifecycleSnapshot,
  makeFireLifecycleSnapshot,
  makeFireLifecycleState,
  restoreFireLifecycleSnapshot,
  type FireActorContact,
  type FireCell,
  type FireLifecycleSnapshot,
  type FireLifecycleState,
  type FirePosition,
} from '../domain/fire-lifecycle.js'
import { applyFallingBlocks } from '../domain/entities/falling-block-move.js'
import {
  applySpawnAttempts,
  experienceOfCasualties,
  resolveBlasts,
  resolveBowHits,
  resolveEndermanTeleportProbes,
  resolveMeleeHits,
  rollCasualtyDrops,
  rollSelfDestructDrops,
  sweepMobs,
  ENDERMITE_KIND,
  ENDERMITE_MAX_HEALTH,
  PRIMED_TNT_KIND,
  type BowHit,
  type MobDropEvent,
  type MobExperienceEvent,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../domain/entities/mob-frame.js'
import { FRESH_PRIMED_TNT } from '../domain/mob/primed-tnt.js'
import {
  DROPPED_ITEM_PICKUP_RADIUS,
  pickupDroppedItems,
  spawnDroppedItems,
  type DroppedItemPickupFailure,
  type DroppedItemPickupRequest,
  type DroppedItemPickupResult,
  type DroppedItemSpawnError,
  type DroppedItemSpawn,
} from '../domain/entities/dropped-item.js'
import {
  type ExperienceOrbAbsorption,
  type ExperienceOrbAbsorptionContext,
  type ExperienceOrbAbsorptionError,
} from '../domain/entities/xp-orb.js'
import { searchSpawnCandidates } from '../domain/entities/mob-spawn-search.js'
import { hostileSpawnsAllowed } from '../domain/day-night.js'
import {
  entityManagerTag,
  type EntityId,
  type EntityManager,
  type EntityManagerApi,
} from '@nerima-games/mc-sim'
import type { Damage } from '../domain/death-cause.js'
import { prepareArmorHit } from '../domain/combat/armor.js'
import {
  resolveHostileContacts,
  resolvePlayerBlastDamage,
  type PlayerDamageEvent,
} from '../domain/mob/hostile-combat.js'
import {
  disturb,
  emptyFallingBlockQueue,
  settled,
  takeBatch,
  type FallingBlockQueue,
} from '../domain/falling-block.js'
import {
  carryOver,
  DEFAULT_FLUID_HORIZONTAL_RANGE,
  enqueueFluidDisturbance,
  MAX_FLUID_DEFERRED_ATTEMPTS,
  splitBudget,
  transitionFluidCell,
  type FluidCell,
  type FluidProbe,
  type FluidWorkItem,
} from '../domain/fluid-frontier.js'
import { DEFAULT_ROLL_SEED, drawRolls, rollAt } from '../domain/frame-rolls.js'
import type { Dimension, PortalTravelPlan } from '@nerima-games/mc-worldgen'
import { OUTSIDE_PORTAL, type PortalDwell, stepPortalDwell } from '../domain/portal-dwell.js'
import { PlayerService, type PlayerServiceApi } from '@nerima-games/mc-sim'
import {
  isEndPortalBlock,
  type EndPortalTravelEvent,
} from '../domain/end-portal-travel.js'
import { breakBlock } from '../domain/interactions/break-block.js'
import type { BreakTransactionFailure } from '../domain/interactions/break-block.js'
import { doorUpperBreakCell } from '../domain/interactions/place-door-upper.js'
import {
  BLOCK_LOOT_ROLLS,
  blockLoot,
  NO_TOOL,
  type BlockLootContext,
} from '../domain/interactions/block-loot.js'
import type { PlaceOutcome } from '../domain/interactions/place-block.js'
import { cropDrops, type CropDropOutcome } from '../domain/interactions/crop-drops.js'
import { applyBoneMeal, type BoneMealOutcome } from '../domain/interactions/bone-meal.js'
import { resolveFoodUse, type FoodUseOutcome, type FoodUseRequest } from '../domain/interactions/eat-food.js'
import {
  makeSurvivalHungerRuntime,
  makeReplicatedSurvivalHungerRuntime,
  type SurvivalHungerError,
  type SurvivalHungerRuntimeApi,
} from '../domain/survival-hunger.js'
import {
  furnaceAdvanceChanged,
  planFurnaceAdvance,
  type FurnaceAdvancePlan,
} from '../domain/interactions/advance-furnace.js'
import { plantCrop, type PlantOutcome } from '../domain/interactions/plant-crop.js'
import { tillSoil, type TillOutcome } from '../domain/interactions/till-soil.js'
import {
  isSuccessfulBlockUse,
  resolveBlockUse,
  type BlockUseOutcome,
} from '../domain/interactions/use-block.js'
import {
  bowCharge,
  bowDamage,
  canFireBow,
  BOW_MAX_RANGE,
} from '../domain/interactions/draw-bow.js'
import { shotBlockedByTerrain, shotTarget, type ShotHit } from '../domain/interactions/bow-shot.js'
import { knockbackDirection, type KnockbackDirection } from '../domain/interactions/knockback.js'
import {
  DEFAULT_MELEE_DAMAGE,
  DEFAULT_MELEE_REACH,
  meleeTarget,
  meleeTargetBeforeBlock,
  type MeleeAttackRequest,
  type MeleeAttackResult as ResolvedMeleeAttackResult,
} from '../domain/interactions/melee-attack.js'
import {
  enderPearlDisplacement,
  shouldSpawnEndermite,
  ENDER_PEARL_DAMAGE,
  ENDER_PEARL_DEATH_CAUSE,
  type EnderPearlDisplacement,
} from '../domain/interactions/throw-ender-pearl.js'
import {
  useFlintAndSteel,
  type IgnitionOutcome,
  type IgnitionItemType,
} from '../domain/interactions/use-flint-and-steel.js'
import {
  useBucket,
  type BucketItemType,
  type BucketUseOutcome,
} from '../domain/interactions/use-bucket.js'
import {
  advanceFishing,
  cancelFishing,
  castFishing,
  reelFishing,
  type AdvanceFishingResult,
  type CancelFishingResult,
  type CastFishingResult,
  type FishingEnvironment,
  type FishingSession,
  type ReelFishingResult,
} from '../domain/interactions/fishing.js'
import {
  advanceWeather,
  INITIAL_WEATHER,
  LOWEST_WEATHER_ROLLS,
  weatherExpires,
  WEATHER_TRANSITION_ROLLS,
  type WeatherState,
} from '../domain/weather.js'
import {
  advanceWeatherGameplay,
  makeWeatherGameplayState,
  type WeatherGameplayEvent,
  type WeatherGameplayInput,
  type WeatherGameplayState,
} from '../domain/weather-gameplay.js'
import {
  makeEnderDragonEncounterRuntime,
  type EnderDragonEncounterStageApi,
} from './ender-dragon-encounter-stage.js'
import { GAMEPLAY_STAGE_IDS, UPSTREAM_STAGE_IDS } from './stage-ids.js'
import { advanceVehicles, type VehicleFrameEnvironment } from '../domain/vehicle/vehicle-frame.js'

/**
 * Historically a lift from `domain/chunk-store-port.ts`'s local, unbranded
 * `BlockPosition` into kernel's branded one, for the coordinate-vocabulary
 * calls below. Now that the mirror is deleted and `BlockPosition` throughout
 * this file IS kernel's branded type, the lift is the identity — kept as a
 * named function rather than removed, so the ~20 call sites below need no
 * change.
 */
const toKernelPosition = (position: BlockPosition): BlockPosition => position

// Stage algorithms use plain numbers; kernel requires each coordinate to pass BlockAxis validation.
const blockPosition = (x: number, y: number, z: number): BlockPosition =>
  kernelBlockPosition(BlockAxis(x + 0), BlockAxis(y + 0), BlockAxis(z + 0))

/** Preserve the stage's infallible interface while keeping validation failures as defects. */
export const resultOrDie = <A, E>(result: Result.Result<A, E>): Effect.Effect<A> =>
  Effect.orDie(Effect.fromResult(result))

export const blockTypeOrDie = (id: BlockId): Effect.Effect<BlockType | undefined> =>
  resultOrDie(blockTypeOfId(id))

export const blockPositionForKey = (key: BlockPositionKey): Effect.Effect<BlockPosition> =>
  resultOrDie(blockPositionOfKey(key))

export const resolveArmoredPlayerDamages = (
  inventory: InventoryServiceApi,
  damages: ReadonlyArray<PlayerDamageEvent>,
): Effect.Effect<ReadonlyArray<PlayerDamageEvent>> =>
  Effect.forEach(damages, (event) =>
    Effect.gen(function* () {
      if (event.damage.amount === 0) return event
      const resolved = yield* resultOrDie(prepareArmorHit(yield* inventory.equipmentSnapshot, event.damage))
      if (resolved.durabilityWear > 0) {
        yield* Effect.forEach(resolved.wornSlots, (slot) =>
          inventory.damageAt({ _tag: 'Equipment', slot }, resolved.durabilityWear),
        )
      }
      return { ...event, damage: resolved.damage }
    }),
  )

type PreparedFirePlayerDamage = Readonly<{
  readonly damages: ReadonlyArray<PlayerDamageEvent>
  readonly changes: ReadonlyArray<ReplicatedOwnerCandidate>
}>

type FirePlayerDamagePreparationFailure =
  | Readonly<{
      _tag: 'OwnerSnapshotFailed'
      error: WorldCommitCoordinatorError | Schema.SchemaError
    }>
  | Readonly<{
      _tag: 'OwnerRevisionChanged'
      expectedRevision: WorldWriteBatch['expectedWorldRevision']
      observedRevision: WorldWriteBatch['expectedWorldRevision']
    }>
  | Readonly<{
      _tag: 'InvalidStorageCandidate'
      validation: Exclude<ReturnType<typeof validatePlayerStorageSnapshot>, { _tag: 'Valid' }>
    }>

const prepareFirePlayerDamage = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
  expectedRevision: WorldWriteBatch['expectedWorldRevision'],
  damages: ReadonlyArray<PlayerDamageEvent>,
): Effect.Effect<Result.Result<PreparedFirePlayerDamage, FirePlayerDamagePreparationFailure>> => Effect.gen(function* () {
  const observed = yield* Effect.result(coordinator.snapshot(ownerId, PlayerStorageSnapshotSchema))
  if (Result.isFailure(observed)) {
    return Result.fail({ _tag: 'OwnerSnapshotFailed', error: observed.failure })
  }
  if (observed.success.revision !== expectedRevision) {
    return Result.fail({
      _tag: 'OwnerRevisionChanged',
      expectedRevision,
      observedRevision: observed.success.revision,
    })
  }

  let storage = observed.success.state
  const resolvedDamages: PlayerDamageEvent[] = []
  for (const event of damages) {
    if (event.damage.amount === 0) {
      resolvedDamages.push(event)
      continue
    }
    const resolved = yield* resultOrDie(prepareArmorHit(storage.equipment, event.damage))
    resolvedDamages.push({ ...event, damage: resolved.damage })
    if (resolved.durabilityWear === 0) continue

    for (const slot of resolved.wornSlots) {
      const damaged = damagePlayerStorageAt(storage, { _tag: 'Equipment', slot }, resolved.durabilityWear)
      if (damaged.result._tag === 'Damaged' || damaged.result._tag === 'Broken') {
        storage = damaged.storage
      }
    }
  }

  const validation = validatePlayerStorageSnapshot(storage)
  if (validation._tag !== 'Valid') {
    return Result.fail({ _tag: 'InvalidStorageCandidate', validation })
  }
  return Result.succeed({
    damages: resolvedDamages,
    changes: Equal.equals(observed.success.state, validation.storage)
      ? []
      : [{ ownerId, state: validation.storage }],
  })
})

/**
 * How many gameplay ticks pass between two active lava ticks.
 *
 * Vanilla lava spreads several times more slowly than water. Provisional: the
 * shipped value comes out of the fluid preview, not out of a guess made here.
 */
export const LAVA_TICK_INTERVAL = 4

/**
 * Seconds between two runs of the hostile spawn search.
 *
 * `<reference-impl>/packages/entity/domain/mob/spawner-config.ts`'s
 * `SPAWN_INTERVAL_SECS`, and `domain/mob/hostile-spawn.ts`'s header lists it
 * among the things that rule does not decide — 「HOW OFTEN (`SPAWN_INTERVAL_SECS
 * = 0.3`)」. This is where it arrives.
 *
 * IN SECONDS AND NOT IN TICKS, unlike `LAVA_TICK_INTERVAL` above. The lava
 * cadence is a ratio between two rules that both run per tick, so counting ticks
 * is the honest unit for it. This one is a real-time budget for a fixed amount
 * of work, so a frame-rate change must not change how often the world spawns
 * mobs — which is precisely the divergence `domain/mob/enderman-teleport.ts`
 * records as the known defect of the reference's tick-counted lanes.
 */
export const HOSTILE_SPAWN_INTERVAL_SECS = 0.3

/** Shared empty list, so a frame that searches nothing allocates nothing. */
const NO_ATTEMPTS: ReadonlyArray<never> = []

/**
 * Frame-local scratch, and nothing else.
 *
 * Every `Ref` here fails the save-file test in the module header. Two of them
 * are QUEUES of work (disturbed columns, fluid cells still to evaluate) and one
 * is the tick counter that paces lava; losing all three on a reload costs
 * nothing but a frame of catch-up.
 *
 * The remaining two are a stand-in for services that are not published yet, and
 * they are the ones to watch:
 *
 *   - `pendingBreaks` is an INBOX. Input belongs to mc-render (plan.md §4.2's
 *     `input` slot) and reaches the rules as a request to act on a position.
 *     Nothing needs it after the frame that services it, so it is scratch by
 *     the save-file test — a save file records that a block is gone, never that
 *     a mouse button was down.
 *   - `pendingPlacements` is `pendingBreaks`' twin and arrived with
 *     `domain/interactions/place-block.ts`. It carries one more field than the
 *     break inbox — WHICH ITEM — and that field is the reason it is a second
 *     inbox rather than a tagged union inside the first: the held item is read
 *     from mc-sim's `InventoryService` by whoever fills the inbox, and a break
 *     request that had to carry an item field it never uses would invite one.
 *
 *   - Mining overflow is not frame state. Each successful break carries its
 *     source position through the inventory deposit, and only the remainder
 *     returned by `InventoryService.add` is spawned as a dropped-item entity at
 *     that position. The entity stage's pickup rule retries it on later frames.
 *
 *   - `consumedItems` is the OUTBOX POINTING THE OTHER WAY: one entry per block
 *     successfully placed, which is one item to take off the stack.
 *
 *     IT IS STILL AN OUTBOX ALTHOUGH THE SERVICE IS NOW IN HAND, and that is a
 *     deliberate stop rather than an oversight. `InventoryService.remove`
 *     answers with the number ACTUALLY TAKEN, so calling it here would mean
 *     asking to be charged for a block that is ALREADY IN THE WORLD:
 *     `placeBlock` has written the cell by the time this list is appended to,
 *     and a `remove` that came back `0` would leave the player a block they
 *     never had. Doing it correctly means consulting the inventory BEFORE the
 *     write — a placement rule that reads what the player is carrying — and
 *     that is a change to `domain/interactions/place-block.ts`'s contract, not
 *     a call added here. The mining direction has no such asymmetry, which is
 *     why it went first: `add` cannot fail, it can only report a remainder.
 *
 *     It was never folded into the mining list as a negative count either, and
 *     the reason survives: mc-sim's `InventoryService` has TWO verbs —
 *     `add(item, count)` and `remove(item, count)`
 *     (`mc-sim/application/inventory-service.ts:49,51`) — so a signed list would
 *     make the host decide which verb each entry means, from a convention this
 *     file invented. Two lists name the two calls.
 *
 *     IT CARRIES NO COUNT, because one placement consumes exactly one item and
 *     there is no rule in this repository that consumes two. A count field would
 *     be a number that is always 1, which is the kind of member kernel's
 *     `./block-definition` warns is the cheapest way to get a freeze wrong.
 *
 *   - `pendingItemUses` is an INBOX. Ignition retains `usedItems` as its legacy
 *     durability/consumption outbox, while every use also emits a correlated
 *     `itemUseResults` entry. Farming adds discriminated requests for tilling,
 *     planting, harvesting, and eating without changing the tagless ignition
 *     request shape.
 *
 *     The ignition member remains `pendingPlacements`' twin down to its shape:
 *     a cell and the item in hand. Farming members carry only the host-owned
 *     facts their rule needs; crop age remains in mc-sim rather than this frame
 *     state.
 *
 *     The outbox is NOT `consumedItems`, and that distinction is the one worth
 *     stating: a placement takes the item off the stack, while lighting a portal
 *     DAMAGES a flint and steel by one point and consumes a fire charge whole.
 *     Those are two different `InventoryService` verbs — `damageSlot` against
 *     `remove` (`use-flint-and-steel.ts`) — and a host draining one merged list
 *     could not tell which to call. It stays an outbox for `consumedItems`'
 *     reason and one of its own: mc-sim's published api has no `damageSlot` at
 *     all, so half of this list has no method to become a call to.
 *
 * The inboxes disappear when their service exists: they become mc-render's input
 * events. The outboxes become calls inside the interactions stage. None of them
 * grows a query, a lookup or a second reader in the meantime.
 *
 * FOUR MORE ARRIVED WITH THE MOB WIRING, and each is one of the same two shapes.
 *
 *   - `targetPosition` is a compatibility inbox retained for hosts that still
 *     write or inspect it. Gameplay stages never consume it: player position is
 *     authoritative in mc-sim and is read from `PlayerService.pose` after the
 *     simulation physics stage has completed.
 *
 *   - `spawnAttempts` is an INBOX of candidate cells. It used to be the ONLY way
 *     a candidate could arrive, because 「the SEARCH that produces them is not
 *     here and cannot be」. The search is here now
 *     (`domain/entities/mob-spawn-search.ts`), and the inbox stays: a host, a
 *     preview or a test may still offer a cell directly, exactly as
 *     `pendingBreaks` lets one offer a break. What changed is that an empty
 *     inbox no longer means no spawns.
 *
 *   - `timeOfDay` is the matching compatibility inbox. Gameplay stages never
 *     consume it: hostile-spawn decisions read `TimeService.timeOfDay`, whose
 *     value has already been advanced by mc-sim's time stage in the same frame.
 *
 *   - `mobDrops` is an OUTBOX because mob death and dropped-item spawning are
 *     separate frame seams. Mining overflow does not use it: its source cell is
 *     known in the interactions stage and is spawned directly.
 *
 *   - `rollSeed` is neither. It is the frame's source of randomness, and
 *     `domain/frame-rolls.ts` is a whole file about why it is a seed here rather
 *     than a `Math.random()` in the rules, an `Effect.Random` in `run`'s context,
 *     or a generator on mc-sim's entity.
 *
 * THREE MORE ARRIVED WITH PLACEMENT, LOOT AND WEATHER, and two of the three are
 * the shapes above with nothing new to argue.
 *
 *   - `heldTool` is an INBOX and `timeOfDay`'s twin in every respect. What the
 *     player is swinging is mc-sim's `InventoryService` — the selected hotbar
 *     slot and its enchantments — and this Ref does not advance, answers no
 *     question, is overwritten rather than accumulated, and is read within the
 *     frame that wrote it. It exists because without it kernel's tool gate is
 *     unreachable: every swing would be bare-handed, and the whole
 *     `harvestTool` column would be a table nothing consults.
 *
 *     IT DEFAULTS TO BARE HANDS, which is the RESTRICTIVE direction and the
 *     opposite of `timeOfDay`'s choice. The reasoning is the same and the answer
 *     differs because the failure looks different: a host that forgets to write
 *     the hour gets a world that spawns mobs, visible in the first minute,
 *     whereas a host that forgets to write the tool and got `diamond` would get
 *     a world where a wooden pickaxe is never needed — invisible, and it makes
 *     the gate look implemented when nothing is testing it.
 *
 *   - `weather` is an INBOX and `weatherAdvanced` is its OUTBOX, and this PAIR is
 *     the one new shape. `domain/weather.ts`'s header argues it at length and the
 *     short version is that weather fails the save-file test AND has no owner:
 *     mc-sim has a `TimeService` and no weather service at all, so a `Ref` here
 *     would not be a duplicate of somebody's state, it would be the FIRST copy of
 *     it, in the repository plan.md §2.3-1 says holds no state. A duplicate
 *     announces itself the day the two disagree; a sole owner in the wrong
 *     repository never does.
 *
 *     So the stage READS this frame's weather and WRITES what it should become,
 *     and the host does the round trip — exactly what a host already does for
 *     `minedItems`, which is why this needed no new machinery. Neither Ref
 *     advances by itself: nothing in this file writes `weather`, and
 *     `weatherAdvanced` is overwritten rather than accumulated because a
 *     countdown's last value subsumes every earlier one.
 *
 * ---------------------------------------------------------------------------
 * ...and the inventory through mc-sim's `InventoryService`
 * ---------------------------------------------------------------------------
 *
 * THE THIRD SERVICE, acquired in `makeGameplayStages` beside the other two and
 * for the same reason. The service now comes directly from mc-sim, and it closes
 * plan.md §2.3-1's worked example — 「mining a block puts an item in your
 * inventory」 — which was the last of this repository's three verbs whose
 * effect stopped at a `Ref`.
 *
 * Note what it did NOT add: an inventory. Nothing in `GameplayFrameState` holds
 * a slot, a count or an item the player owns, and `test/stage-registration.test.ts`
 * asserts that there is no key called `inventory`. The stage ASKS; mc-sim
 * answers and remembers.
 */
export type BlockBreakRequestContext = Readonly<{
  /** Dimension captured when the mining action is requested. */
  readonly dimension: Dimension
  /** Exact storage slot captured when the mining action is requested. */
  readonly toolLocation: StorageLocation | undefined
}>

type PendingBlockBreakRequest = {
  readonly requestId: number
  readonly publicQueueIndex: number
  readonly positionKey: BlockPositionKey
  readonly lootContext: BlockLootContext | undefined
  readonly dimension: Dimension | undefined
  readonly toolLocation: StorageLocation | undefined
}

type PendingBlockBreakRequestState = {
  readonly nextRequestId: number
  readonly requests: ReadonlyArray<PendingBlockBreakRequest>
}

type PendingBlockBreakRequestQueue = {
  readonly state: Ref.Ref<PendingBlockBreakRequestState>
  readonly mutex: Semaphore.Semaphore
}

type FluidRuntimeState = {
  readonly frontier: ReadonlyArray<FluidWorkItem>
  readonly updates: ReadonlyArray<FluidWorkItem>
  readonly cells: ReadonlyMap<BlockPositionKey, FluidCell>
}

const makeFluidStateRef = (
  state: Ref.Ref<FluidRuntimeState>,
  field: 'frontier' | 'updates',
): Ref.Ref<ReadonlyArray<FluidWorkItem>> => {
  const ref = Ref.makeUnsafe(state.ref.current[field])
  // `Ref.makeUnsafe` supplies the Effect 4 identity and variance witness. The
  // accessor keeps both projections backed by the same runtime state.
  // The factory keeps state and field in a closure rather than parameter
  // properties, which would emit assignments under `erasableSyntaxOnly`.
  Object.defineProperty(ref.ref, 'current', {
    configurable: true,
    enumerable: true,
    get: () => state.ref.current[field],
    set: (value: ReadonlyArray<FluidWorkItem>) => {
      state.ref.current = { ...state.ref.current, [field]: value }
    },
  })
  return ref
}

const fluidRuntimeStates = new WeakMap<
  Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  Ref.Ref<FluidRuntimeState>
>()

const fluidRuntimeSemaphores = new WeakMap<
  Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  Semaphore.Semaphore
>()

const fireTickAccumulators = new WeakMap<Ref.Ref<FireLifecycleState>, Ref.Ref<number>>()

const fireTickAccumulatorFor = (
  fireLifecycle: Ref.Ref<FireLifecycleState>,
): Effect.Effect<Ref.Ref<number>> => {
  const accumulator = fireTickAccumulators.get(fireLifecycle)
  if (accumulator === undefined) {
    return Effect.die(new Error('fire lifecycle is not owned by a gameplay frame state'))
  }
  return Effect.succeed(accumulator)
}

const fluidRuntimeStateFor = (
  frontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
): Effect.Effect<Ref.Ref<FluidRuntimeState>> => {
  const state = fluidRuntimeStates.get(frontier)
  if (state === undefined) {
    return Effect.die(new Error('fluid frontier is not owned by a gameplay frame state'))
  }
  return Effect.succeed(state)
}

const fluidRuntimeSemaphoreFor = (
  frontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
): Effect.Effect<Semaphore.Semaphore> => {
  const semaphore = fluidRuntimeSemaphores.get(frontier)
  /* v8 ignore start -- `fluidRuntimeStates` and `fluidRuntimeSemaphores` are
   * populated together, in the same synchronous step of `makeGameplayFrameState`
   * (see below), for every `fluidFrontier` ref that exists. The one call site
   * that reaches this function — the fluids stage's `run` — always calls
   * `fluidRuntimeStateFor` on the same ref FIRST, and that dies before this
   * function is ever reached whenever the ref is foreign. Test coverage of the
   * "foreign ref" case lives on `fluidRuntimeStateFor`, in
   * `test/stage-registration.test.ts`; there is no path that reaches this guard
   * with it unregistered while `fluidRuntimeStateFor`'s twin registration is not
   * also missing. */
  if (semaphore === undefined) {
    return Effect.die(new Error('fluid frontier is not owned by a gameplay frame state'))
  }
  /* v8 ignore stop */
  return Effect.succeed(semaphore)
}

/** Narrow decoded fluid work positions to values accepted by kernel's BlockAxis. */
const validFluidPosition = (
  position: { readonly x: number; readonly y: number; readonly z: number },
): position is BlockPosition =>
  Number.isSafeInteger(position.x) &&
  Number.isSafeInteger(position.y) &&
  Number.isSafeInteger(position.z)

const fluidWorkItemOf = (cell: FluidCell, deferred?: number): FluidWorkItem => ({
  key: cell.key,
  kind: cell.kind,
  level: cell.level,
  source: cell.source,
  ...(cell.parent === undefined ? {} : { parent: cell.parent }),
  falling: cell.falling,
  ...(deferred === undefined ? {} : { deferred }),
})

const fluidProbeAt = (
  store: ChunkStoreApi,
  position: BlockPosition,
  kind: FluidCell['kind'],
  cells: ReadonlyMap<BlockPositionKey, FluidCell>,
): Effect.Effect<FluidProbe> => {
  const key = blockPositionKeyOf(toKernelPosition(position))
  return Effect.gen(function* () {
    const reading = yield* store.getBlock(position)
    if (reading._tag === 'ChunkNotLoaded') {
      return { key, state: 'unloaded' } satisfies FluidProbe
    }
    if (reading._tag === 'OutOfWorld') {
      return { key, state: 'out-of-world' } satisfies FluidProbe
    }

    const block = yield* blockTypeOrDie(reading.block)
    if (block === 'air') {
      return { key, state: 'air' } satisfies FluidProbe
    }
    if (block === kind) {
      return {
        key,
        state: 'same-fluid',
        source: cells.get(key)?.source ?? true,
      } satisfies FluidProbe
    }
    if (block === (kind === 'water' ? 'lava' : 'water')) {
      return {
        key,
        state: 'opposite-fluid',
        source: cells.get(key)?.source ?? true,
      } satisfies FluidProbe
    }
    return { key, state: 'blocked' } satisfies FluidProbe
  })
}

const maximumFluidLevel = (kind: FluidCell['kind'], dimension: Dimension): number =>
  kind === 'water'
    ? DEFAULT_FLUID_HORIZONTAL_RANGE.water
    : DEFAULT_FLUID_HORIZONTAL_RANGE.lava[dimension]

type GameplayBlockCommitResult = Result.Result<
  ReplicatedWorldDelta<ReplicatedOwnerChange>,
  WorldCommitCoordinatorError
>

const commitBlockEdits: (
  context: Readonly<{
    coordinator: WorldCommitCoordinatorApi
    dimension: Dimension
    changes: ReadonlyArray<ReplicatedOwnerCandidate>
  }>,
  expectedRevision: WorldWriteBatch['expectedWorldRevision'],
  expectedDimensionRevision: WorldWriteBatch['expectedDimensionRevision'],
  edits: WorldWriteBatch['edits'],
) => Effect.Effect<GameplayBlockCommitResult> = (
  context,
  expectedRevision,
  expectedDimensionRevision,
  edits,
) => Effect.gen(function* () {
    const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
      world: context.coordinator.worldId,
      expectedWorldRevision: expectedRevision,
      dimension: context.dimension,
      expectedDimensionRevision,
      edits,
    }).pipe(Effect.orDie)
    return yield* Effect.result(context.coordinator.commit({
      expectedRevision,
      expectedDimensions: [{ dimension: context.dimension, expectedRevision: expectedDimensionRevision }],
      changes: context.changes,
      blockWrite,
    }))
  })

const runFluidPropagation = (
  store: ChunkStoreApi,
  runtime: Ref.Ref<FluidRuntimeState>,
  work: ReadonlyArray<FluidWorkItem>,
  context: Readonly<{
    coordinator: WorldCommitCoordinatorApi
    dimension: Dimension
    changes: ReadonlyArray<ReplicatedOwnerCandidate>
  }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const snapshot = yield* Ref.get(runtime)
    const cells = new Map(snapshot.cells)
    let generated: ReadonlyArray<FluidWorkItem> = []

    const enqueue = (item: FluidWorkItem): void => {
      generated = enqueueFluidDisturbance(generated, item)
    }
    const enqueueDependents = (parent: BlockPositionKey): void => {
      for (const candidate of cells.values()) {
        if (candidate.parent === parent) enqueue(fluidWorkItemOf(candidate))
      }
    }

    for (const item of work) {
      // Legacy callers have historically used opaque diagnostic keys. Decode
      // through the non-throwing API so malformed work is still recorded as
      // evaluated without turning an invalid position into world IO.
      const position: { readonly x: number; readonly y: number; readonly z: number } =
        decodeBlockPositionKey(item.key) ?? { x: Number.NaN, y: Number.NaN, z: Number.NaN }
      if (!validFluidPosition(position)) continue

      const expectedRevision = yield* context.coordinator.revision
      const expectedDimensionRevision = yield* context.coordinator.dimensionRevision(context.dimension)
      const cell: FluidCell = cells.get(item.key) ?? {
        key: item.key,
        kind: item.kind,
        level: Math.max(0, Math.trunc(item.level ?? 0)),
        source: item.source ?? true,
        ...(item.parent === undefined ? {} : { parent: item.parent }),
        falling: item.falling ?? false,
      }
      const current = yield* fluidProbeAt(store, position, cell.kind, cells)
      const belowPosition = yield* resultOrDie(
        adjacentBlockPosition(toKernelPosition(position), 'down'),
      )
      const horizontalPositions = yield* resultOrDie(
        horizontalBlockNeighbours(toKernelPosition(position)),
      )
      let belowProbe: FluidProbe = { key: blockPositionKeyOf(toKernelPosition(belowPosition)), state: 'blocked' }
      let horizontalProbes: ReadonlyArray<FluidProbe> = horizontalPositions.map((candidate) => ({
        key: blockPositionKeyOf(toKernelPosition(candidate)),
        state: 'blocked' as const,
      }))

      if (current.state === 'same-fluid') {
        cells.set(cell.key, cell)
        belowProbe = yield* fluidProbeAt(store, belowPosition, cell.kind, cells)
        horizontalProbes = yield* Effect.forEach(horizontalPositions, (candidate) =>
          fluidProbeAt(store, candidate, cell.kind, cells),
        )
      }

      const transition = transitionFluidCell({
        cell,
        current,
        below: belowProbe,
        horizontal: horizontalProbes,
        supported:
          cell.source ||
          (cell.parent !== undefined && cells.get(cell.parent)?.kind === cell.kind),
        maximumHorizontalLevel: maximumFluidLevel(cell.kind, context.dimension),
      })
      let deferCurrent = transition.defer
      const pending = new Map<string, {
        readonly change: (typeof transition.changes)[number]
        readonly position: BlockPosition
        readonly block: BlockId
      }>()

      for (const change of transition.changes) {
        if (change._tag === 'ForgetFluid') {
          cells.delete(change.key)
          enqueueDependents(change.key)
          continue
        }

        const changePosition = yield* resultOrDie(
          blockPositionOfKey(change._tag === 'PlaceFluid' ? change.cell.key : change.key),
        )
        /* v8 ignore start -- derived positions are adjacent neighbours of a validated finite input. */
        if (!validFluidPosition(changePosition)) continue
        /* v8 ignore stop */

        const block = change._tag === 'PlaceFluid'
          ? Option.getOrUndefined(blockIdOf(change.cell.kind))
          : change._tag === 'RemoveFluid'
            ? AIR_BLOCK_ID
            : Option.getOrUndefined(blockIdOf(change.block))
        if (block === undefined) continue
        const key = blockPositionKeyOf(toKernelPosition(changePosition))
        pending.set(key, { change, position: changePosition, block })
      }

      if (pending.size > 0) {
        const operations = [...pending.values()]
        const committed = yield* commitBlockEdits(
          context,
          expectedRevision,
          expectedDimensionRevision,
          operations.map(({ position: operationPosition, block }) => ({ position: operationPosition, block })),
        )
        if (Result.isFailure(committed)) {
          const tag = committed.failure._tag
          deferCurrent = deferCurrent || tag === 'WorldWriteChunkUnavailable' ||
            tag === 'WorldWriteStale' || tag === 'WorldRevisionConflict' ||
            tag === 'DimensionRevisionConflict' || tag === 'WorldCommitChunkStoreUnavailable'
          if (!deferCurrent) {
            for (const { change } of operations) {
              if (change._tag === 'PlaceFluid') continue
              cells.delete(change.key)
              enqueueDependents(change.key)
            }
          }
        } else {
          for (const { change } of operations) {
            if (change._tag === 'PlaceFluid') {
              cells.set(change.cell.key, change.cell)
              enqueue(fluidWorkItemOf(change.cell))
            } else {
              cells.delete(change.key)
              enqueueDependents(change.key)
            }
          }
        }
      }

      const deferred = item.deferred ?? 0
      if (
        deferCurrent &&
        deferred < MAX_FLUID_DEFERRED_ATTEMPTS &&
        (current.state === 'unloaded' || cells.has(cell.key))
      ) {
        enqueue(fluidWorkItemOf(cell, deferred + 1))
      }
    }

    yield* Ref.update(runtime, (current) => {
      let frontier = current.frontier
      for (const item of generated) frontier = enqueueFluidDisturbance(frontier, item)
      return {
        frontier,
        updates: [...current.updates, ...work],
        cells,
      }
    })
  })

export type GameplayFrameState = {
  readonly enderDragonEncounter: EnderDragonEncounterStageApi
  readonly survivalHunger: SurvivalHungerRuntimeApi
  readonly operationFailures: Ref.Ref<ReadonlyArray<GameplayStageOperationFailure>>
  readonly pendingBreaks: Ref.Ref<ReadonlyArray<BlockPositionKey>>
  readonly pendingPlacements: Ref.Ref<ReadonlyArray<PlacementRequest>>
  readonly pendingBlockUses: Ref.Ref<ReadonlyArray<BlockUseRequest>>
  readonly pendingItemUses: Ref.Ref<ReadonlyArray<ItemUseRequest>>
  readonly pendingBowShots: Ref.Ref<ReadonlyArray<BowShotRequest>>
  readonly pendingMeleeAttacks: Ref.Ref<ReadonlyArray<MeleeAttackRequest>>
  readonly pendingPearlThrows: Ref.Ref<ReadonlyArray<EnderPearlThrowRequest>>
  readonly pendingDroppedItemPickups: Ref.Ref<ReadonlyArray<DroppedItemPickupRequest>>
  readonly droppedItemPickupExecutions: Ref.Ref<ReadonlyArray<DroppedItemPickupExecution>>
  readonly pendingExperienceOrbAbsorptions: Ref.Ref<ReadonlyArray<ExperienceOrbAbsorptionContext>>
  readonly experienceOrbAbsorptionExecutions: Ref.Ref<ReadonlyArray<ExperienceOrbAbsorptionExecution>>
  readonly unsupportedOperations: Ref.Ref<ReadonlyArray<GameplayUnsupportedOperation>>
  readonly pendingVillagerTrades: Ref.Ref<ReadonlyArray<VillagerTradeRequest>>
  readonly pendingStatusEffects: Ref.Ref<ReadonlyArray<StatusEffectApplication>>
  readonly consumedItems: Ref.Ref<ReadonlyArray<PlaceableItemType>>
  readonly usedItems: Ref.Ref<ReadonlyArray<IgnitionItemType>>
  readonly blockUseResults: Ref.Ref<ReadonlyArray<BlockUseResult>>
  readonly itemUseResults: Ref.Ref<ReadonlyArray<ItemUseResult>>
  /** Live cast state only; the host owns the rod and any awarded loot. */
  readonly fishingSession: Ref.Ref<FishingSession | undefined>
  readonly bowShotResults: Ref.Ref<ReadonlyArray<BowShotResult>>
  readonly meleeAttackResults: Ref.Ref<ReadonlyArray<GameplayMeleeAttackResult>>
  readonly handledBowShotRequestIds: Ref.Ref<ReadonlySet<BowShotRequestId>>
  readonly bowKnockbacks: Ref.Ref<ReadonlyArray<BowKnockback>>
  readonly enderPearlOutcomes: Ref.Ref<ReadonlyArray<EnderPearlOutcome>>
  readonly playerDamages: Ref.Ref<ReadonlyArray<PlayerDamageEvent>>
  readonly playerHeals: Ref.Ref<ReadonlyArray<PlayerHealingEvent>>
  readonly playerMovementSpeedMultiplier: Ref.Ref<number>
  readonly statusEffects: Ref.Ref<StatusEffectState>
  readonly fireLifecycle: Ref.Ref<FireLifecycleState>
  readonly hostileContactCooldowns: Ref.Ref<ReadonlyMap<EntityId, number>>
  readonly mobDrops: Ref.Ref<ReadonlyArray<MobDropEvent>>
  readonly mobExperience: Ref.Ref<ReadonlyArray<MobExperienceEvent>>
  readonly villagerTradeResults: Ref.Ref<ReadonlyArray<VillagerTradeResult>>
  readonly spawnAttempts: Ref.Ref<ReadonlyArray<MobSpawnAttempt>>
  readonly targetPosition: Ref.Ref<Position | undefined>
  readonly timeOfDay: Ref.Ref<number>
  readonly heldTool: Ref.Ref<BlockLootContext>
  readonly weather: Ref.Ref<WeatherState>
  readonly weatherAdvanced: Ref.Ref<WeatherState | undefined>
  readonly weatherGameplayInput: Ref.Ref<WeatherGameplayInput>
  readonly weatherGameplay: Ref.Ref<WeatherGameplayState>
  readonly weatherGameplayEvents: Ref.Ref<ReadonlyArray<WeatherGameplayEvent>>
  /** Seconds accumulated towards the next spawn search. Scratch: losing it costs one interval. */
  readonly spawnClockSecs: Ref.Ref<number>
  readonly rollSeed: Ref.Ref<number>
  readonly fallingBlocks: Ref.Ref<FallingBlockQueue>
  readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>
  readonly fluidUpdates: Ref.Ref<ReadonlyArray<FluidWorkItem>>
  readonly tickCount: Ref.Ref<number>
  /** Destination-dimension portal snapshots supplied by the host. */
  readonly portalCandidates: Ref.Ref<ReadonlyMap<Dimension, ReadonlyArray<BlockPosition>>>
  /** Completed dimension crossings waiting for host-side world generation. */
  readonly portalTravels: Ref.Ref<ReadonlyArray<PortalTravelEvent>>
  /** Completed End crossings waiting for destination-world materialization. */
  readonly endPortalTravels: Ref.Ref<ReadonlyArray<EndPortalTravelEvent>>
  /**
   * How long the player has stood in a portal block, or how long until one may
   * fire again.
   *
   * STATE, AND IT IS THIS REPOSITORY'S rather than mc-sim's, which is the
   * distinction `domain/portal-dwell.ts` draws: the four-second timer is a RULE
   * about when a transition fires, and it does not survive a save. The thing
   * that does survive — which dimension the player ended up in — is mc-sim's and
   * is reached through `PlayerServiceApi.setDimension`.
   */
  readonly portalDwell: Ref.Ref<PortalDwell>
}

/** A completed crossing and the source context needed to apply its world changes. */
export type PortalTravelEvent = {
  readonly sourceDimension: Dimension
  readonly sourcePosition: BlockPosition
  readonly plan: PortalTravelPlan
}

export type VillagerTradeRequest = {
  readonly requestId: string
  readonly villagerId: string
  readonly offerId: string
}

export type VillagerTradeResult =
  | (VillagerTradeRequest & { readonly _tag: 'Traded' })
  | (VillagerTradeRequest & {
      readonly _tag: 'Rejected'
      readonly reason:
        | 'UnknownOffer'
        | 'OutOfStock'
        | 'InsufficientItems'
        | 'InventoryFull'
        | 'PlayerDead'
    })

const pendingBlockBreakRequests = new WeakMap<GameplayFrameState, PendingBlockBreakRequestQueue>()
const blockPlacementRuntimes = new WeakMap<GameplayFrameState, BlockPlacementRuntime>()

const breakRequestQueueFor = (state: GameplayFrameState): PendingBlockBreakRequestQueue => {
  const existing = pendingBlockBreakRequests.get(state)
  if (existing !== undefined) {
    return existing
  }

  // Compatibility for structurally-created frame states. WeakMap creation is
  // synchronous, so concurrent callers cannot observe two different queues.
  const created: PendingBlockBreakRequestQueue = {
    state: Ref.makeUnsafe<PendingBlockBreakRequestState>({ nextRequestId: 0, requests: [] }),
    mutex: Semaphore.makeUnsafe(1),
  }
  pendingBlockBreakRequests.set(state, created)
  return created
}

const blockPlacementRuntimeFor = (state: GameplayFrameState): BlockPlacementRuntime => {
  const existing = blockPlacementRuntimes.get(state)
  if (existing !== undefined) {
    return existing
  }

  const created: BlockPlacementRuntime = {
    state: Ref.makeUnsafe<BlockPlacementRuntimeState>({ handled: new Map(), results: [] }),
    mutex: Semaphore.makeUnsafe(1),
  }
  blockPlacementRuntimes.set(state, created)
  return created
}

/**
 * One request to put a block down.
 *
 * The position is a `BlockPositionKey` rather than a `BlockPosition` so that the
 * inbox matches `pendingBreaks` exactly — one encoding, one place
 * (kernel's `domain/coordinate-keys.ts`), and a host that can queue a break can queue
 * a placement the same way.
 *
 * `heldItem` is a `PlaceableItemType`, so "you cannot place a stick" is a type
 * error where the request is BUILT rather than a refusal where it is serviced.
 * The proof obligation is kernel's `isPlaceableItem` and it
 * belongs to whoever reads the hotbar, which is the same repository that would
 * have had to read it anyway.
 */
export type PlacementRequest = {
  readonly positionKey: BlockPositionKey
  readonly heldItem: PlaceableItemType
}

export type BlockPlacementRequestId = string

export type BlockPlacementMode = 'survival' | 'creative'

/** A correlated placement command. Omitted mode preserves survival semantics. */
export type BlockPlacementCommand = PlacementRequest & {
  readonly requestId: BlockPlacementRequestId
  readonly mode?: BlockPlacementMode
}

export type BlockPlacementCommandOutcome =
  | PlaceOutcome
  | { readonly _tag: 'InventoryUnavailable' }
  | { readonly _tag: 'RequestIdConflict' }
  | { readonly _tag: 'PlayerDead' }
  | { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError | Schema.SchemaError }
  | {
      readonly _tag: 'Unsupported'
      readonly reason: 'WorldCommitCoordinatorUnavailable' | 'OwnerRegistrationUnavailable'
    }

/** One drainable answer for a correlated placement command. */
export type BlockPlacementResult = {
  readonly requestId: BlockPlacementRequestId
  readonly success: boolean
  readonly consumed: boolean
  readonly replayed: boolean
  readonly outcome: BlockPlacementCommandOutcome
}

type NormalizedBlockPlacementCommand = PlacementRequest & {
  readonly requestId: BlockPlacementRequestId
  readonly mode: BlockPlacementMode
}

type HandledBlockPlacementCommand = {
  readonly command: NormalizedBlockPlacementCommand
  readonly result: BlockPlacementResult
}

type BlockPlacementRuntimeState = {
  readonly handled: ReadonlyMap<BlockPlacementRequestId, HandledBlockPlacementCommand>
  readonly results: ReadonlyArray<BlockPlacementResult>
}

type BlockPlacementRuntime = {
  readonly state: Ref.Ref<BlockPlacementRuntimeState>
  readonly mutex: Semaphore.Semaphore
}

/** Host-provided correlation key for one targeted block-use request. */
export type BlockUseRequestId = string

/** A request to use the block in a cell without transferring its state here. */
export type BlockUseRequest = {
  readonly requestId: BlockUseRequestId
  readonly positionKey: BlockPositionKey
}

/** The drainable answer that tells the host whether to toggle its lever state. */
export type BlockUseResult =
  | {
      readonly requestId: BlockUseRequestId
      readonly success: boolean
      readonly outcome: BlockUseOutcome
    }
  | {
      readonly requestId: BlockUseRequestId
      readonly success: false
      readonly outcome: 'PlayerDead'
    }

/**
 * One use of an igniting item on a cell.
 *
 * `PlacementRequest`'s twin, and deliberately identical in shape: the position
 * is a `BlockPositionKey` so that a host which can queue a break can queue a
 * placement and an item use the same way, through one encoding
 * (kernel's `domain/coordinate-keys.ts`).
 *
 * `heldItem` is an `IgnitionItemType`, so "you cannot light a portal with a
 * stick" is a type error where the request is BUILT rather than a refusal where
 * it is serviced. The proof obligation is
 * `domain/interactions/use-flint-and-steel.ts`'s `isIgnitionItem` and it belongs
 * to whoever reads the hotbar — the same division `PlacementRequest` makes with
 * `isPlaceableItem`.
 *
 * THE CELL IS THE ONE TO LIGHT, not the one that was clicked. `adjacentToHit`
 * turns a raycast hit and a face normal into the cell one step along the normal,
 * and that is mc-render's raycast and mc-sim's pose; every rule in this
 * repository is handed a cell.
 */
export type IgnitionItemUseRequest = {
  readonly requestId: ItemUseRequestId
  readonly positionKey: BlockPositionKey
  readonly heldItem: IgnitionItemType
}

/** Hoe names supplied by mc-kernel 0.2.4. Tilling behaviour is tier-independent. */
export const HOE_ITEM_TYPES = ['wooden_hoe', 'stone_hoe', 'iron_hoe', 'diamond_hoe'] as const
// Compile-time-only validation, kept off the declaration above: `HoeItemType`
// below reads `(typeof HOE_ITEM_TYPES)[number]` for its narrow 4-member union,
// and an explicit `: ReadonlyArray<ItemType>` annotation would widen it to
// `ItemType` instead.
HOE_ITEM_TYPES satisfies ReadonlyArray<ItemType>

export type HoeItemType = (typeof HOE_ITEM_TYPES)[number]

export const isHoeItem = (item: ItemType): item is HoeItemType =>
  (HOE_ITEM_TYPES as ReadonlyArray<ItemType>).includes(item)

export type FarmingItemUseRequest =
  | {
      readonly action: 'TillSoil'
      readonly requestId: ItemUseRequestId
      readonly positionKey: BlockPositionKey
      readonly heldItem: HoeItemType
    }
  | {
      readonly action: 'ApplyBoneMeal'
      readonly requestId: ItemUseRequestId
      readonly positionKey: BlockPositionKey
      readonly heldItem: 'bone_meal'
    }
  | {
      readonly action: 'PlantPotato'
      readonly requestId: ItemUseRequestId
      readonly positionKey: BlockPositionKey
      readonly heldItem: 'potato'
    }
  | {
      readonly action: 'HarvestPotato'
      readonly requestId: ItemUseRequestId
      readonly positionKey: BlockPositionKey
      readonly roll: number
    }
  | {
      readonly action: 'EatPotato'
      readonly requestId: ItemUseRequestId
      readonly heldItem: 'potato'
      readonly vitals: FoodUseRequest['vitals']
    }
  | {
      readonly action: 'EatFood'
      readonly requestId: ItemUseRequestId
      readonly heldItem: ItemType
      readonly vitals: FoodUseRequest['vitals']
      readonly effectRoll: number
    }

export type FurnaceItemUseRequest = {
  readonly action: 'AdvanceFurnace'
  readonly requestId: ItemUseRequestId
  readonly state: FurnaceState
  readonly deltaTimeSecs: number
}

export type BucketItemUseRequest = {
  readonly action: 'UseBucket'
  readonly requestId: ItemUseRequestId
  readonly positionKey: BlockPositionKey
  readonly heldItem: BucketItemType
  readonly activeDimension: Dimension
  readonly targetDimension: Dimension
}

export type FishingItemUseRequest =
  | {
      readonly action: 'CastFishing'
      readonly requestId: ItemUseRequestId
      readonly rod: EquipmentItem | null
      readonly environment: FishingEnvironment
    }
  | {
      readonly action: 'AdvanceFishing'
      readonly requestId: ItemUseRequestId
      readonly deltaTimeSecs: number
      readonly environment: Pick<FishingEnvironment, 'hasWater'>
    }
  | {
      readonly action: 'CancelFishing' | 'ReelFishing'
      readonly requestId: ItemUseRequestId
    }

export type ItemUseRequest =
  | IgnitionItemUseRequest
  | FarmingItemUseRequest
  | FurnaceItemUseRequest
  | BucketItemUseRequest
  | FishingItemUseRequest

/** Host-provided correlation key for one item-use request. */
export type ItemUseRequestId = string

/** The complete, drainable answer for one item-use request. */
export type IgnitionItemUseResult = {
  readonly requestId: ItemUseRequestId
  readonly heldItem: IgnitionItemType
  readonly success: boolean
  readonly outcome: IgnitionOutcome
}

export type FarmingItemUseResult =
  | {
      readonly action: 'TillSoil'
      readonly requestId: ItemUseRequestId
      readonly heldItem: HoeItemType
      readonly success: boolean
      readonly durabilityDamage: 0 | 1
      readonly outcome: TillOutcome
    }
  | {
      readonly action: 'ApplyBoneMeal'
      readonly requestId: ItemUseRequestId
      readonly heldItem: 'bone_meal'
      readonly success: boolean
      readonly consumedCount: 0 | 1
      readonly outcome: BoneMealOutcome
    }
  | {
      readonly action: 'PlantPotato'
      readonly requestId: ItemUseRequestId
      readonly heldItem: 'potato'
      readonly success: boolean
      readonly consumedCount: 0 | 1
      readonly outcome: PlantOutcome
    }
  | {
      readonly action: 'HarvestPotato'
      readonly requestId: ItemUseRequestId
      readonly positionKey: BlockPositionKey
      readonly success: boolean
      readonly outcome: CropDropOutcome
    }
  | {
      readonly action: 'EatPotato'
      readonly requestId: ItemUseRequestId
      readonly heldItem: 'potato'
      readonly success: boolean
      readonly consumedCount: 0 | 1
      readonly outcome: FoodUseOutcome | { readonly _tag: 'missingItem' }
    }
  | {
      readonly action: 'EatFood'
      readonly requestId: ItemUseRequestId
      readonly heldItem: ItemType
      readonly success: boolean
      readonly consumedCount: 0 | 1
      readonly outcome: FoodUseOutcome | { readonly _tag: 'missingItem' }
    }

export type FurnaceItemUseResult =
  | {
      readonly action: 'AdvanceFurnace'
      readonly requestId: ItemUseRequestId
      readonly success: boolean
      readonly plan: FurnaceAdvancePlan
    }
  | {
      readonly action: 'AdvanceFurnace'
      readonly requestId: ItemUseRequestId
      readonly success: false
      readonly failure: FurnaceFailure
    }

type SuccessfulBucketUseOutcome = Extract<BucketUseOutcome, { readonly _tag: 'Collected' | 'Placed' }>
type FailedBucketUseOutcome = Exclude<BucketUseOutcome, SuccessfulBucketUseOutcome>

export type BucketItemUseResult =
  | {
      readonly action: 'UseBucket'
      readonly requestId: ItemUseRequestId
      readonly heldItem: BucketItemType
      readonly success: true
      readonly outcome: SuccessfulBucketUseOutcome
    }
  | {
      readonly action: 'UseBucket'
      readonly requestId: ItemUseRequestId
      readonly heldItem: BucketItemType
      readonly success: false
      readonly outcome: FailedBucketUseOutcome
    }

type SuccessfulFishingCast = Extract<CastFishingResult, { readonly _tag: 'Cast' }>
type FailedFishingCast = Exclude<CastFishingResult, SuccessfulFishingCast>
type AdvancedFishingResult = Extract<
  AdvanceFishingResult,
  { readonly _tag: 'Waiting' | 'Bite' | 'Escaped' }
>
type FailedFishingAdvance = Exclude<AdvanceFishingResult, AdvancedFishingResult>

/**
 * Correlated fishing outcomes. The host applies returned rod/loot changes to
 * its inventory atomically; gameplay only owns the active cast between frames.
 */
export type FishingItemUseResult =
  | {
      readonly action: 'CastFishing'
      readonly requestId: ItemUseRequestId
      readonly success: true
      readonly outcome: SuccessfulFishingCast
    }
  | {
      readonly action: 'CastFishing'
      readonly requestId: ItemUseRequestId
      readonly success: false
      readonly outcome: FailedFishingCast | 'AlreadyFishing'
    }
  | {
      readonly action: 'AdvanceFishing'
      readonly requestId: ItemUseRequestId
      readonly success: true
      readonly outcome: AdvancedFishingResult
    }
  | {
      readonly action: 'AdvanceFishing'
      readonly requestId: ItemUseRequestId
      readonly success: false
      readonly outcome: FailedFishingAdvance | 'NoActiveFishingSession'
    }
  | {
      readonly action: 'CancelFishing'
      readonly requestId: ItemUseRequestId
      readonly success: true
      readonly outcome: CancelFishingResult
    }
  | {
      readonly action: 'ReelFishing'
      readonly requestId: ItemUseRequestId
      readonly success: true
      readonly outcome: ReelFishingResult
    }
  | {
      readonly action: 'CancelFishing' | 'ReelFishing'
      readonly requestId: ItemUseRequestId
      readonly success: false
      readonly outcome: 'NoActiveFishingSession'
    }

export type PlayerDeadItemUseResult = {
  readonly requestId: ItemUseRequestId
  readonly success: false
  readonly outcome: 'PlayerDead'
}

export type ItemUseResult =
  | IgnitionItemUseResult
  | FarmingItemUseResult
  | FurnaceItemUseResult
  | BucketItemUseResult
  | FishingItemUseResult
  | PlayerDeadItemUseResult

/**
 * One shot from a drawn bow. The host supplies the held slot and game mode;
 * survival settlement consumes one arrow and damages the bow atomically before
 * combat, while creative settlement is skipped.
 *
 * `origin` is the EYE and not the feet, which is why it is not read from
 * `targetPosition`: that Ref holds where the player stands, the shot leaves from
 * where they look, and the offset between them is a pose mc-sim owns.
 */
export type BowShotRequest = {
  /** Host correlation key. Legacy uncorrelated requests remain supported. */
  readonly requestId?: BowShotRequestId
  /** Where the shot starts. The eye, in world space. */
  readonly origin: Position
  /** Where it is aimed. NEED NOT BE A UNIT VECTOR — see `shotTarget`. */
  readonly dirX: number
  readonly dirY: number
  readonly dirZ: number
  /** How long the bow was drawn, in seconds. */
  readonly chargeSecs: number
  /** Level of Power on the bow. Absent = none. See `BowDrawContext`. */
  readonly powerLevel?: number
  /** The held slot and game mode used for the atomic bow settlement. */
  readonly inventory: InteractionInventoryContext
}

/** Inventory context supplied by the host for an item interaction. */
export type InteractionInventoryContext = {
  readonly mode: BlockPlacementMode
  readonly slotIndex: number
}

/** Host-provided correlation key for one bow release. */
export type BowShotRequestId = string

/** Whether a correlated release crossed the draw gate and therefore spent an arrow. */
export type BowShotResult =
  | {
      readonly requestId: BowShotRequestId
      readonly success: true
      readonly outcome: 'Fired'
    }
  | {
      readonly requestId: BowShotRequestId
      readonly success: false
      readonly outcome:
        | 'Undercharged'
        | 'DuplicateRequest'
        | 'PlayerDead'
        | 'InventoryUnavailable'
    }

export type GameplayMeleeAttackResult =
  | ResolvedMeleeAttackResult
  | { readonly requestId: string; readonly success: false; readonly outcome: 'PlayerDead' }

/**
 * One ender pearl thrown.
 *
 * The host supplies the held slot and game mode. Survival throws consume one
 * ender pearl; creative throws do not.
 *
 * `hitDistance` is how far along the aim a raycast struck something, and
 * `undefined` means it struck nothing within its range. THE RAYCAST IS THE HOST'S
 * — it is the same hit that decides which cell a block is placed against, which
 * is why `ItemUseRequest`'s comment can say 「every rule in this repository is
 * handed a cell」 — and the reference takes it the same way, as a `TargetRayHit`
 * parameter (`ender-pearl.ts:8,45`).
 */
export type EnderPearlThrowRequest = {
  /** Where the throw starts. The eye, in world space. */
  readonly origin: Position
  readonly dirX: number
  readonly dirY: number
  readonly dirZ: number
  /** Distance to what the aim ray struck, in blocks. Absent = it struck nothing. */
  readonly hitDistance?: number
  /** The held slot and game mode used for pearl consumption. */
  readonly inventory: InteractionInventoryContext
}

/**
 * Which way one bow hit shoved what it struck.
 *
 * AN OUTBOX WITH NO CONSUMER IN THIS REPOSITORY, and that is deliberate rather
 * than unfinished. `domain/interactions/knockback.ts` §3 records why the impulse
 * itself is not built: mc-sim's `EntityState` has no velocity field to receive
 * one, exactly as it has none for the minecart (docs/responsibility.md §5-5). The
 * DIRECTION is a rule and is decided here; turning it into a shove needs a field
 * that does not exist.
 *
 * Parking it in a Ref rather than dropping it is the choice `consumedItems` made
 * for the same situation. A host that has its own physics can act on it today; the
 * day mc-sim grows a velocity, this Ref is what the impulse is built from and the
 * rule above it does not change.
 */
export type BowKnockback = {
  readonly id: EntityId
  readonly direction: KnockbackDirection
}

/**
 * What one ender pearl throw did to the thrower.
 *
 * AN OUTBOX, and for a sharper reason than `BowKnockback`'s: both halves are about
 * the PLAYER, and this repository holds no player. The displacement wants
 * mc-sim's `setPlayerPosition` and the damage wants its health service; the
 * `targetPosition` Ref is an INBOX the host writes and reading a teleport back out
 * of it would make two owners of one noun — the failure this file's header
 * records for `timeOfDaySecs`.
 *
 * The damage is a `Damage` and not a bare number, so the CAUSE travels with it.
 * `domain/death-cause.ts`'s `applyDamage` requires one, and a pearl that killed
 * you saying 「You teleported too hard.」 rather than 「You died.」 is the entire
 * point of that type.
 *
 * Creative throws omit damage, matching the same mode gate as consumption.
 */
export type EnderPearlOutcome = {
  /** How far and which way the thrower moves, in blocks, from where they stood. */
  readonly displacement: EnderPearlDisplacement
  /** What the throw costs them. See the note above on creative mode. */
  readonly damage: Damage | undefined
}

export type DroppedItemPickupExecution = Readonly<{
  request: DroppedItemPickupRequest
  outcome:
    | Readonly<{ _tag: 'Completed'; result: DroppedItemPickupResult }>
    | Readonly<{ _tag: 'Failed'; error: DroppedItemPickupFailure }>
    | Readonly<{
        _tag: 'Unsupported'
        reason: 'WorldCommitCoordinatorUnavailable'
      }>
    | Readonly<{
        _tag: 'Unsupported'
        reason: 'OwnerRegistrationUnavailable'
      }>
}>

export type ExperienceOrbAbsorptionExecution = Readonly<{
  request: ExperienceOrbAbsorptionContext
  outcome:
    | Readonly<{ _tag: 'Completed'; result: ExperienceOrbAbsorption }>
    | Readonly<{ _tag: 'Failed'; error: ExperienceOrbAbsorptionError }>
    | Readonly<{
        _tag: 'Unsupported'
        reason: 'WorldCommitCoordinatorUnavailable'
      }>
    | Readonly<{
        _tag: 'Unsupported'
        reason: 'OwnerRegistrationUnavailable'
      }>
}>

export type GameplayUnsupportedAction =
  | 'MineBlock'
  | 'PlaceBlock'
  | 'VillagerTrade'
  | 'UseBucket'
  | 'Fishing'
  | 'ApplyBoneMeal'
  | 'TillSoil'
  | 'PlantPotato'
  | 'HarvestPotato'
  | 'Brewing'
  | 'EnchantItem'
  | 'PlayerDamage'
  | 'MobDrop'
  | 'ExperienceOrbCreation'
  | 'PortalTravel'
  | 'MobSimulation'
  | 'FireEntityDamage'
  | 'EatFood'
  | 'BowShot'
  | 'EnderPearl'
  | 'IgniteTnt'
  | 'MeleeAttack'

export type GameplayUnsupportedReason =
  | 'WorldCommitCoordinatorUnavailable'
  | 'OwnerRegistrationUnavailable'
  | 'CropOwnerStateUnavailable'
  | 'McSimPlanFragmentUnavailable'
  | 'EntityRosterOwnerUnavailable'

export type GameplayUnsupportedOperation = Readonly<{
  _tag: 'Unsupported'
  action: GameplayUnsupportedAction
  requestId?: string
  reason: GameplayUnsupportedReason
}>

export type GameplayFrameStateOptions = Readonly<{
  coordinator: WorldCommitCoordinatorApi
  vitalsOwnerId: ReplicatedOwnerId
}>

export type GameplayStageOperationFailure = Readonly<{
  _tag: 'Failed'
  operation: 'OwnerSnapshot' | 'WorldCommit' | 'VitalsOperation' | 'CandidateBuild'
  subject: 'Player' | 'Vitals' | 'Mining' | 'ItemUse' | 'Fire'
  error:
    | WorldCommitCoordinatorError
    | Schema.SchemaError
    | Brand.BrandError
    | SurvivalHungerError
    | DroppedItemSpawnError
    | BreakTransactionFailure
    | FirePlayerDamagePreparationFailure
}>

export const recordGameplayStageFailure = (
  state: GameplayFrameState,
  failure: GameplayStageOperationFailure,
): Effect.Effect<void> =>
  Ref.update(state.operationFailures, (failures) => [...failures, failure])

export const readGameplayPlayer = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
): Effect.Effect<
  ReplicatedSnapshot<typeof PlayerServiceSnapshotSchema>,
  WorldCommitCoordinatorError | Schema.SchemaError
> =>
  coordinator.snapshot(ownerId, PlayerServiceSnapshotSchema)

export const makeGameplayFrameState = (
  options?: GameplayFrameStateOptions,
): Effect.Effect<GameplayFrameState> => Effect.gen(function* () {
  const enderDragonEncounter = yield* makeEnderDragonEncounterRuntime
  const survivalHunger = options === undefined
    ? yield* makeSurvivalHungerRuntime()
    : yield* makeReplicatedSurvivalHungerRuntime(options.coordinator, options.vitalsOwnerId)
  const operationFailures = yield* Ref.make<ReadonlyArray<GameplayStageOperationFailure>>([])
  const pendingBreaks = yield* Ref.make<ReadonlyArray<BlockPositionKey>>([])
  const breakRequests = yield* Ref.make<PendingBlockBreakRequestState>({
    nextRequestId: 0,
    requests: [],
  })
  const breakRequestMutex = yield* Semaphore.make(1)
  const pendingPlacements = yield* Ref.make<ReadonlyArray<PlacementRequest>>([])
  const pendingBlockUses = yield* Ref.make<ReadonlyArray<BlockUseRequest>>([])
  const pendingItemUses = yield* Ref.make<ReadonlyArray<ItemUseRequest>>([])
  const pendingBowShots = yield* Ref.make<ReadonlyArray<BowShotRequest>>([])
  const pendingMeleeAttacks = yield* Ref.make<ReadonlyArray<MeleeAttackRequest>>([])
  const pendingPearlThrows = yield* Ref.make<ReadonlyArray<EnderPearlThrowRequest>>([])
  const pendingDroppedItemPickups = yield* Ref.make<ReadonlyArray<DroppedItemPickupRequest>>([])
  const droppedItemPickupExecutions = yield* Ref.make<ReadonlyArray<DroppedItemPickupExecution>>([])
  const pendingExperienceOrbAbsorptions = yield* Ref.make<ReadonlyArray<ExperienceOrbAbsorptionContext>>([])
  const experienceOrbAbsorptionExecutions = yield* Ref.make<ReadonlyArray<ExperienceOrbAbsorptionExecution>>([])
  const unsupportedOperations = yield* Ref.make<ReadonlyArray<GameplayUnsupportedOperation>>([])
  const pendingVillagerTrades = yield* Ref.make<ReadonlyArray<VillagerTradeRequest>>([])
  const pendingStatusEffects = yield* Ref.make<ReadonlyArray<StatusEffectApplication>>([])
  const consumedItems = yield* Ref.make<ReadonlyArray<PlaceableItemType>>([])
  const usedItems = yield* Ref.make<ReadonlyArray<IgnitionItemType>>([])
  const blockUseResults = yield* Ref.make<ReadonlyArray<BlockUseResult>>([])
  const itemUseResults = yield* Ref.make<ReadonlyArray<ItemUseResult>>([])
  const fishingSession = yield* Ref.make<FishingSession | undefined>(undefined)
  const bowShotResults = yield* Ref.make<ReadonlyArray<BowShotResult>>([])
  const meleeAttackResults = yield* Ref.make<ReadonlyArray<GameplayMeleeAttackResult>>([])
  const handledBowShotRequestIds = yield* Ref.make<ReadonlySet<BowShotRequestId>>(new Set())
  // Both are empty in the ordinary state. An entry means something happened
  // that this repository computed and cannot itself deliver.
  // computed and cannot itself deliver. See the two types.
  const bowKnockbacks = yield* Ref.make<ReadonlyArray<BowKnockback>>([])
  const enderPearlOutcomes = yield* Ref.make<ReadonlyArray<EnderPearlOutcome>>([])
  const playerDamages = yield* Ref.make<ReadonlyArray<PlayerDamageEvent>>([])
  const playerHeals = yield* Ref.make<ReadonlyArray<PlayerHealingEvent>>([])
  const playerMovementSpeedMultiplier = yield* Ref.make(1)
  const statusEffects = yield* Ref.make<StatusEffectState>(emptyStatusEffectState())
  const fireLifecycle = yield* Ref.make<FireLifecycleState>(makeFireLifecycleState([], DEFAULT_ROLL_SEED))
  const fireTickAccumulator = yield* Ref.make(0)
  fireTickAccumulators.set(fireLifecycle, fireTickAccumulator)
  const hostileContactCooldowns = yield* Ref.make<ReadonlyMap<EntityId, number>>(new Map())
  const mobDrops = yield* Ref.make<ReadonlyArray<MobDropEvent>>([])
  const mobExperience = yield* Ref.make<ReadonlyArray<MobExperienceEvent>>([])
  const villagerTradeResults = yield* Ref.make<ReadonlyArray<VillagerTradeResult>>([])
  const spawnAttempts = yield* Ref.make<ReadonlyArray<MobSpawnAttempt>>([])
  const targetPosition = yield* Ref.make<Position | undefined>(undefined)
  // Midnight, which `domain/day-night.ts` reads as night. See the module header
  // on why the permissive default is the right one to be wrong with.
  const timeOfDay = yield* Ref.make(0)
  // Bare hands. The RESTRICTIVE default, unlike the hour's — see the header.
  const heldTool = yield* Ref.make<BlockLootContext>(NO_TOOL)
  // Clear, for the shortest legal stretch, from a LITERAL roll. The reference
  // seeds this with `Math.random()` (`weather-service.ts:13`), so two runs of
  // one scenario disagree about when the first rain arrives.
  const weather = yield* Ref.make<WeatherState>(INITIAL_WEATHER)
  const weatherAdvanced = yield* Ref.make<WeatherState | undefined>(undefined)
  const weatherGameplayInput = yield* Ref.make<WeatherGameplayInput>({
    dimension: 'overworld',
    difficulty: 'normal',
    blocks: [],
    entities: [],
  })
  const weatherGameplay = yield* Ref.make(makeWeatherGameplayState(DEFAULT_ROLL_SEED))
  const weatherGameplayEvents = yield* Ref.make<ReadonlyArray<WeatherGameplayEvent>>([])
  const spawnClockSecs = yield* Ref.make(0)
  // A LITERAL, not a clock reading: two runs of one scenario must draw the same
  // numbers (plan.md §5.1-3). A world seed is mc-worldgen's noun and this is
  // where it lands when that repository publishes one.
  const rollSeed = yield* Ref.make(DEFAULT_ROLL_SEED)
  const fallingBlocks = yield* Ref.make<FallingBlockQueue>(emptyFallingBlockQueue)
  const fluidState = yield* Ref.make<FluidRuntimeState>({
    frontier: [],
    updates: [],
    cells: new Map(),
  })
  const fluidFrontier = makeFluidStateRef(fluidState, 'frontier')
  const fluidUpdates = makeFluidStateRef(fluidState, 'updates')
  fluidRuntimeStates.set(fluidFrontier, fluidState)
  fluidRuntimeSemaphores.set(fluidFrontier, yield* Semaphore.make(1))
  const tickCount = yield* Ref.make(0)
  const portalCandidates = yield* Ref.make<
    ReadonlyMap<Dimension, ReadonlyArray<BlockPosition>>
  >(new Map())
  const portalTravels = yield* Ref.make<ReadonlyArray<PortalTravelEvent>>([])
  const endPortalTravels = yield* Ref.make<ReadonlyArray<EndPortalTravelEvent>>([])
  // OUTSIDE, which is the only honest starting state: a fresh world has nobody
  // standing in a portal, and a `Cooling` default would swallow the first
  // crossing of a session.
  const portalDwell = yield* Ref.make<PortalDwell>(OUTSIDE_PORTAL)

  const state: GameplayFrameState = {
    enderDragonEncounter,
    survivalHunger,
    operationFailures,
    pendingBreaks,
    pendingPlacements,
    pendingBlockUses,
    pendingItemUses,
    pendingBowShots,
    pendingMeleeAttacks,
    pendingPearlThrows,
    pendingDroppedItemPickups,
    droppedItemPickupExecutions,
    pendingExperienceOrbAbsorptions,
    experienceOrbAbsorptionExecutions,
    unsupportedOperations,
    pendingVillagerTrades,
    pendingStatusEffects,
    consumedItems,
    usedItems,
    blockUseResults,
    itemUseResults,
    fishingSession,
    bowShotResults,
    meleeAttackResults,
    handledBowShotRequestIds,
    bowKnockbacks,
    enderPearlOutcomes,
    playerDamages,
    playerHeals,
    playerMovementSpeedMultiplier,
    statusEffects,
    fireLifecycle,
    hostileContactCooldowns,
    mobDrops,
    mobExperience,
    villagerTradeResults,
    spawnAttempts,
    targetPosition,
    timeOfDay,
    heldTool,
    weather,
    weatherAdvanced,
    weatherGameplayInput,
    weatherGameplay,
    weatherGameplayEvents,
    spawnClockSecs,
    rollSeed,
    fallingBlocks,
    fluidFrontier,
    fluidUpdates,
    tickCount,
    portalCandidates,
    portalTravels,
    endPortalTravels,
    portalDwell,
  }
  pendingBlockBreakRequests.set(state, {
    state: breakRequests,
    mutex: breakRequestMutex,
  })
  return state
})

/** Set death by changing authoritative vitals, without a second frame-owned flag. */
export const setPlayerDead = (
  state: GameplayFrameState,
  playerDead: boolean,
): Effect.Effect<void, SurvivalHungerError> =>
  Effect.gen(function* () {
    if (!playerDead) return
    const vitals = (yield* state.survivalHunger.snapshot).vitals
    if (vitals.healthPoints > 0) {
      yield* state.survivalHunger.damage({ amount: vitals.healthPoints, cause: 'generic' })
    }
  })

/**
 * The stages mx-gameplay registers.
 *
 * Note what is NOT here: any resolution of a total order. Each registration
 * carries `after` constraints and nothing more; mc-compose topologically sorts
 * the union of every module's registrations (plan.md §2.3-3, §4.2). The array
 * order below is for human reading only — a consumer that relied on it would be
 * relying on a coincidence, and `test/stage-registration.test.ts` asserts that
 * the declared constraints, not the array order, are what carry the meaning.
 *
 * `store` is passed in rather than acquired per stage so that all stages share
 * one service instance and so that `run` keeps kernel's signature exactly; see
 * the module header. `roster` and `inventory` arrived the same way and for the
 * same reason.
 */
/**
 * The join: WHEN (dwell) -> WHERE (mc-worldgen) -> APPLY (mc-sim).
 *
 * Extracted from the stage body rather than inlined because it is the one place
 * in this repository where three repositories' pieces meet, and burying it in a
 * 200-line stage is how it would come to be edited without anyone noticing which
 * of the three they had changed.
 *
 * THE PLAYER'S CELL IS FLOORED, and that is the coordinate convention rather
 * than a rounding preference. `PlayerPose.feetPosition` is a floating-point
 * entity position; `resolveNetherTravel` takes a `BlockPosition`, which is a
 * cell. `Math.floor` is the same conversion mc-worldgen's header says vanished
 * from the reference's `detectNetherPortal` once its parameter was branded, and
 * it has to happen somewhere — here, at the boundary between an entity and a
 * grid, is that somewhere.
 *
 * A CHUNK THAT IS NOT LOADED READS AS "NOT IN A PORTAL", which is the permissive
 * answer and the right one to be wrong with: the alternative is a player who
 * streams into an unloaded chunk being counted as dwelling in a portal they
 * cannot be standing in. `ChunkNotLoaded` and `OutOfWorld` both take that arm.
 */
const stepPortalTravel = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  playerState: Schema.Schema.Type<typeof PlayerServiceSnapshotSchema> | undefined,
  dt: DeltaTimeSecs,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (playerState === undefined) return
    const pose = playerState.pose
    const cell = blockPosition(
      Math.floor(pose.feetPosition.x),
      Math.floor(pose.feetPosition.y),
      Math.floor(pose.feetPosition.z),
    )

    const reading = yield* store.getBlock(cell)
    const blockId = reading._tag === 'Block' ? reading.block : undefined
    const block = blockId !== undefined
      ? yield* resultOrDie(blockTypeOfId(blockId))
      : undefined
    const inPortal =
      block !== undefined &&
      (block === 'nether_portal' || (blockId !== undefined && isEndPortalBlock(blockId)))

    const step = stepPortalDwell(yield* Ref.get(state.portalDwell), inPortal, dt)
    yield* Ref.set(state.portalDwell, step.dwell)

    if (!step.travels) {
      return
    }

    yield* recordGameplayUnsupportedOperation(state, {
      _tag: 'Unsupported',
      action: 'PortalTravel',
      reason: 'McSimPlanFragmentUnavailable',
    })
  })

/**
 * Ask for a block to be broken on the next frame.
 *
 * THE INBOX'S ONLY PUBLIC DOOR, and it exists so the key encoding does not
 * leave this repository. `blockPositionKeyOf` is kernel's
 * (`domain/coordinate-keys.ts`), so this repository does no encoding of its
 * own — a host that encoded the key itself would be a second, hand-written
 * copy of kernel's format.
 *
 * A host calls this from its input handler; `gameplay:interactions` drains the
 * inbox next frame. Deliberately NOT a direct `breakBlock` call: the stage
 * services breaks before placements for a stated reason, and a caller that went
 * straight to the rule would get neither that ordering nor the drop/inventory
 * handling around it.
 */
export const requestBlockBreak = (
  state: GameplayFrameState,
  position: BlockPosition,
  lootContext?: BlockLootContext,
  context?: BlockBreakRequestContext,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const queue = breakRequestQueueFor(state)
    return queue.mutex.withPermits(1)(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const positionKey = blockPositionKeyOf(toKernelPosition(position))
          const publicQueueIndex = yield* Ref.modify(state.pendingBreaks, (pending) => [
            pending.length,
            [...pending, positionKey],
          ])
          yield* Ref.update(queue.state, (pending) => ({
            nextRequestId: pending.nextRequestId + 1,
            requests: [
              ...pending.requests,
              {
                requestId: pending.nextRequestId,
                publicQueueIndex,
                positionKey,
                lootContext: lootContext === undefined ? undefined : { ...lootContext },
                dimension: context?.dimension,
                toolLocation: context?.toolLocation === undefined ? undefined : { ...context.toolLocation },
              },
            ],
          }))
        }),
      ),
    )
  })

/** Vanilla-style survival reach, measured from the player's eye position. */
export const DEFAULT_BLOCK_REACH = 5

/** Resolve the block under the crosshair and enqueue its break for the interaction stage. */
export const requestTargetedBlockBreak = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  maxDistance: number = DEFAULT_BLOCK_REACH,
  toolLocation?: StorageLocation,
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const target = yield* resultOrDie(
      targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store)),
    )
    if (Option.isSome(target)) {
      const dimension = yield* player.dimension
      const lootContext = yield* Ref.get(state.heldTool)
      yield* requestBlockBreak(
        state,
        blockPosition(target.value.position.x, target.value.position.y, target.value.position.z),
        lootContext,
        { dimension, toolLocation },
      )
    }
    return target
  })

/** The placement twin. Carries WHICH ITEM, which is why it is a second inbox. */
export const requestBlockPlacement = (
  state: GameplayFrameState,
  request: PlacementRequest,
): Effect.Effect<void> =>
  Ref.update(state.pendingPlacements, (pending) => [...pending, request])

/** Enqueue one correlated placement through the same ordered placement inbox. */
export const requestBlockPlacementCommand = (
  state: GameplayFrameState,
  command: BlockPlacementCommand,
): Effect.Effect<void> =>
  Ref.update(state.pendingPlacements, (pending) => [...pending, command])

/** Atomically drain correlated placement answers exactly once. */
export const drainBlockPlacementResults = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<BlockPlacementResult>> =>
  Ref.modify(blockPlacementRuntimeFor(state).state, (runtime) => [
    runtime.results,
    { ...runtime, results: [] },
  ])

/** Enqueue one correlated use of the block occupying a cell. */
export const requestBlockUse = (
  state: GameplayFrameState,
  requestId: BlockUseRequestId,
  position: BlockPosition,
): Effect.Effect<void> =>
  Ref.update(state.pendingBlockUses, (pending) => [
    ...pending,
    { requestId, positionKey: blockPositionKeyOf(toKernelPosition(position)) },
  ])

/** Atomically drain completed block-use results exactly once, preserving order. */
export const drainBlockUseResults = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<BlockUseResult>> => Ref.getAndSet(state.blockUseResults, [])

/** Enqueue one igniting-item use without exposing the internal position encoding. */
export const requestItemUse = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  position: BlockPosition,
  heldItem: IgnitionItemType,
): Effect.Effect<void> =>
  Ref.update(state.pendingItemUses, (pending) => [
    ...pending,
    { requestId, positionKey: blockPositionKeyOf(toKernelPosition(position)), heldItem },
  ])

/** Enqueue one atomic bucket use with an explicitly declared dimension boundary. */
export const requestBucketUse = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  position: BlockPosition,
  heldItem: BucketItemType,
  activeDimension: Dimension,
  targetDimension: Dimension = activeDimension,
): Effect.Effect<void> => {
  const request: BucketItemUseRequest = {
    action: 'UseBucket',
    requestId,
    positionKey: blockPositionKeyOf(toKernelPosition(position)),
    heldItem,
    activeDimension,
    targetDimension,
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Start a cast; the caller retains ownership of the supplied equipment item. */
export const requestFishingCast = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  rod: EquipmentItem | null,
  environment: FishingEnvironment,
): Effect.Effect<void> => {
  const request: FishingItemUseRequest = {
    action: 'CastFishing',
    requestId,
    rod,
    environment: { ...environment },
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Advance the active cast by host-measured time without transferring inventory ownership. */
export const requestFishingAdvance = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  deltaTimeSecs: number,
  environment: Pick<FishingEnvironment, 'hasWater'>,
): Effect.Effect<void> => {
  const request: FishingItemUseRequest = {
    action: 'AdvanceFishing',
    requestId,
    deltaTimeSecs,
    environment: { ...environment },
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Cancel the active cast and return its unchanged rod through the result inbox. */
export const requestFishingCancel = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
): Effect.Effect<void> => {
  const request: FishingItemUseRequest = { action: 'CancelFishing', requestId }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Reel the active cast; the result carries any loot and durability update for the host to settle. */
export const requestFishingReel = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
): Effect.Effect<void> => {
  const request: FishingItemUseRequest = { action: 'ReelFishing', requestId }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Enqueue a hoe use against the targeted ground cell. */
export const requestSoilTill = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  position: BlockPosition,
  heldItem: HoeItemType,
): Effect.Effect<void> => {
  const request: FarmingItemUseRequest = {
    action: 'TillSoil',
    requestId,
    positionKey: blockPositionKeyOf(toKernelPosition(position)),
    heldItem,
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Enqueue bone meal against the targeted crop cell. */
export const requestBoneMeal = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  position: BlockPosition,
): Effect.Effect<void> => {
  const request: FarmingItemUseRequest = {
    action: 'ApplyBoneMeal',
    requestId,
    positionKey: blockPositionKeyOf(toKernelPosition(position)),
    heldItem: 'bone_meal',
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Enqueue planting a potato into the soil cell. */
export const requestPotatoPlanting = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  position: BlockPosition,
): Effect.Effect<void> => {
  const request: FarmingItemUseRequest = {
    action: 'PlantPotato',
    requestId,
    positionKey: blockPositionKeyOf(toKernelPosition(position)),
    heldItem: 'potato',
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Resolve host-owned crop maturity into drops that the host can add to inventory. */
export const requestPotatoHarvest = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  position: BlockPosition,
  roll: number,
): Effect.Effect<void> => {
  const request: FarmingItemUseRequest = {
    action: 'HarvestPotato',
    requestId,
    positionKey: blockPositionKeyOf(toKernelPosition(position)),
    roll,
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Resolve eating for any kernel item, drawing one deterministic status-effect roll. */
export const requestFoodUse = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  heldItem: ItemType,
  vitals: FoodUseRequest['vitals'],
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const seed = yield* Ref.get(state.rollSeed)
    const batch = drawRolls(seed, 1)
    yield* Ref.set(state.rollSeed, batch.seed)

    const request: FarmingItemUseRequest = {
      action: 'EatFood',
      requestId,
      heldItem,
      vitals,
      // `?? 1` is a `noUncheckedIndexedAccess` formality: `drawRolls(seed, 1)`
      // always returns exactly one roll (frame-rolls.ts's `drawRolls` pushes
      // `Math.floor(count)` times for a finite, positive `count`), so
      // `batch.rolls[0]` is never `undefined` here — the same shape as
      // mob-spawn-search.ts's `HOSTILE_KINDS[index]` fallback (vitest.config.ts's
      // coverage-gap note).
      /* v8 ignore next */
      effectRoll: batch.rolls[0] ?? 1,
    }
    yield* Ref.update(state.pendingItemUses, (pending) => [...pending, request])
  })

export const requestPotatoFoodUse = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  vitals: FoodUseRequest['vitals'],
): Effect.Effect<void> => {
  const request: FarmingItemUseRequest = {
    action: 'EatPotato',
    requestId,
    heldItem: 'potato',
    vitals,
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Plan bounded progress for a host-owned furnace snapshot. */
export const requestFurnaceAdvance = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  furnace: FurnaceState,
  deltaTimeSecs: number,
): Effect.Effect<void> => {
  const request: FurnaceItemUseRequest = {
    action: 'AdvanceFurnace',
    requestId,
    state: furnace,
    deltaTimeSecs,
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Drain completed item-use results exactly once, preserving request order. */
export const drainItemUseResults = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<ItemUseResult>> => Ref.getAndSet(state.itemUseResults, [])

/** Replace one destination dimension's known-portal snapshot for subsequent crossings. */
export const setPortalCandidates = (
  state: GameplayFrameState,
  dimension: Dimension,
  candidates: ReadonlyArray<BlockPosition>,
): Effect.Effect<void> =>
  Ref.update(state.portalCandidates, (current) => {
    const next = new Map(current)
    next.set(dimension, [...candidates])
    return next
  })

/** Atomically drain completed portal crossings exactly once, preserving order. */
export const drainPortalTravels = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<PortalTravelEvent>> => Ref.getAndSet(state.portalTravels, [])

/** Atomically drain completed End crossings exactly once. */
export const drainEndPortalTravels = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<EndPortalTravelEvent>> => Ref.getAndSet(state.endPortalTravels, [])

/**
 * Destructively drain evaluated fluid cells at most once, preserving order.
 *
 * This is not end-to-end exactly-once delivery: entries are removed when this
 * Effect returns them, even if the caller subsequently fails to process them.
 */
export const drainFluidUpdates = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<FluidWorkItem>> => Ref.getAndSet(state.fluidUpdates, [])

/** Enqueue one legacy, uncorrelated bow release for the interaction stage. */
export function requestBowShot(
  state: GameplayFrameState,
  request: BowShotRequest,
): Effect.Effect<void>
/** Enqueue one correlated release whose result tells the host whether to spend an arrow. */
export function requestBowShot(
  state: GameplayFrameState,
  requestId: BowShotRequestId,
  request: Omit<BowShotRequest, 'requestId'>,
): Effect.Effect<void>
export function requestBowShot(
  state: GameplayFrameState,
  requestOrId: BowShotRequest | BowShotRequestId,
  correlatedRequest?: Omit<BowShotRequest, 'requestId'>,
): Effect.Effect<void> {
  if (typeof requestOrId !== 'string') {
    return Ref.update(state.pendingBowShots, (pending) => [...pending, requestOrId])
  }
  if (correlatedRequest === undefined) {
    return Effect.die(new Error('requestBowShot: a correlated request requires shot geometry'))
  }

  const request: BowShotRequest = { ...correlatedRequest, requestId: requestOrId }

  return Ref.update(state.pendingBowShots, (pending) => [...pending, request])
}

/** Atomically drain completed bow releases exactly once, preserving request order. */
export const drainBowShotResults = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<BowShotResult>> => Ref.getAndSet(state.bowShotResults, [])

/** Atomically drain queued bow knockbacks exactly once, preserving hit order. */
export const drainBowKnockbacks = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<BowKnockback>> => Ref.getAndSet(state.bowKnockbacks, [])

/** Atomically drain completed correlated melee attacks exactly once, preserving request order. */
export const drainMeleeAttackResults = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<GameplayMeleeAttackResult>> =>
  Ref.getAndSet(state.meleeAttackResults, [])

/** Enqueue one melee swing for the next interaction stage. */
export const requestMeleeAttack = (
  state: GameplayFrameState,
  request: MeleeAttackRequest,
): Effect.Effect<void> =>
  Ref.update(state.pendingMeleeAttacks, (pending) => [...pending, request])

export type TargetedPrimaryAttackResult =
  | { readonly _tag: 'Melee'; readonly target: ShotHit }
  | { readonly _tag: 'Block'; readonly target: BlockTarget }
  | { readonly _tag: 'None' }

export type TargetedPrimaryAttackResolution =
  | {
      readonly _tag: 'Melee'
      readonly target: ShotHit
      readonly request: MeleeAttackRequest
    }
  | { readonly _tag: 'Block'; readonly target: BlockTarget }
  | { readonly _tag: 'None' }

export type TargetedPrimaryAttackOptions = {
  readonly meleeReach?: number
  readonly meleeDamage?: number
  readonly blockReach?: number
  readonly toolLocation?: StorageLocation
}

/** Resolve one primary click without mutating either gameplay inbox. */
export const resolveTargetedPrimaryAttack = (
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  player: PlayerServiceApi,
  options: TargetedPrimaryAttackOptions = {},
): Effect.Effect<
  TargetedPrimaryAttackResolution,
  CameraPoseError | RangeError | BlockTargetInputError
> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const blockTarget = yield* Effect.fromResult(
      targetBlockFromPlayerPose(
        pose,
        options.blockReach ?? DEFAULT_BLOCK_REACH,
        targetabilityFromStore(store),
      ),
    )
    const snapshot = yield* roster.snapshot
    const direction = yield* Effect.fromResult(forwardVector(pose))
    const request: MeleeAttackRequest = {
      origin: {
        ...pose.feetPosition,
        y: PositionAxis(pose.feetPosition.y + EYE_LEVEL_OFFSET),
      },
      direction,
      reach: options.meleeReach ?? DEFAULT_MELEE_REACH,
      damage: options.meleeDamage ?? DEFAULT_MELEE_DAMAGE,
      ...(Option.isSome(blockTarget) ? { hitDistance: blockTarget.value.distance } : {}),
    }
    const meleeHit = meleeTargetBeforeBlock(
      snapshot.entities,
      request,
      Option.isSome(blockTarget) ? blockTarget.value.distance : undefined,
    )

    if (meleeHit !== undefined) {
      return { _tag: 'Melee' as const, target: meleeHit, request }
    }
    if (Option.isSome(blockTarget)) {
      return { _tag: 'Block' as const, target: blockTarget.value }
    }
    return { _tag: 'None' as const }
  })

/** Resolve one primary click and enqueue exactly one kind of interaction, if any. */
export const requestTargetedPrimaryAttack = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  player: PlayerServiceApi,
  options: TargetedPrimaryAttackOptions = {},
): Effect.Effect<
  TargetedPrimaryAttackResult,
  CameraPoseError | RangeError | BlockTargetInputError
> =>
  Effect.gen(function* () {
    const resolution = yield* resolveTargetedPrimaryAttack(store, roster, player, options)

    switch (resolution._tag) {
      case 'Melee':
        yield* requestMeleeAttack(state, resolution.request)
        return { _tag: 'Melee' as const, target: resolution.target }
      case 'Block': {
        const dimension = yield* player.dimension
        const lootContext = yield* Ref.get(state.heldTool)
        yield* requestBlockBreak(
          state,
          blockPosition(resolution.target.position.x, resolution.target.position.y, resolution.target.position.z),
          lootContext,
          { dimension, toolLocation: options.toolLocation },
        )
        return resolution
      }
      case 'None':
        return resolution
      // exhaustiveness arm over TargetedPrimaryAttackResult's `_tag`, a closed
      // three-tag union; all three tags are handled above, so no input can
      // reach this arm.
      /* v8 ignore start */
      default: {
        const exhaustive: never = resolution
        return exhaustive
      }
      /* v8 ignore stop */
    }
  })

/** Enqueue one deterministic mob spawn candidate for the entities stage. */
export const requestMobSpawn = (
  state: GameplayFrameState,
  attempt: MobSpawnAttempt,
): Effect.Effect<void> =>
  Ref.update(state.spawnAttempts, (pending) => [...pending, attempt])

/** Drain player damage computed by hostile contact and explosions. */
export const drainPlayerDamages = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<PlayerDamageEvent>> => Ref.getAndSet(state.playerDamages, [])

export const requestStatusEffect = (
  state: GameplayFrameState,
  application: StatusEffectApplication,
): Effect.Effect<void> =>
  Ref.update(state.pendingStatusEffects, (pending) => [...pending, application])

export const drainPlayerHeals = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<PlayerHealingEvent>> => Ref.getAndSet(state.playerHeals, [])

export const getPlayerMovementSpeedMultiplier = (
  state: GameplayFrameState,
): Effect.Effect<number> => Ref.get(state.playerMovementSpeedMultiplier)

export const snapshotStatusEffects = (
  state: GameplayFrameState,
): Effect.Effect<StatusEffectState> =>
  Ref.get(state.statusEffects).pipe(Effect.map(copyStatusEffectState))

export const restoreStatusEffects = (
  state: GameplayFrameState,
  snapshot: StatusEffectState,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const restored = copyStatusEffectState(snapshot)
    yield* Ref.set(state.statusEffects, restored)
    yield* Ref.set(
      state.playerMovementSpeedMultiplier,
      restored.effects.some((effect) => effect.type === 'speed')
        ? SPEED_MOVEMENT_MULTIPLIER
        : 1,
    )
  })

export type BrewingOperationUnsupported = Readonly<{
  _tag: 'Unsupported'
  action: 'Brewing'
  reason: 'McSimPlanFragmentUnavailable'
}>

const unsupportedBrewingOperation = (
  state: GameplayFrameState,
): Effect.Effect<BrewingOperationUnsupported> =>
  Effect.as(
    recordGameplayUnsupportedOperation(state, {
      _tag: 'Unsupported',
      action: 'Brewing',
      reason: 'McSimPlanFragmentUnavailable',
    }),
    { _tag: 'Unsupported', action: 'Brewing', reason: 'McSimPlanFragmentUnavailable' },
  )

export const insertBrewingFuel = (
  state: GameplayFrameState,
): Effect.Effect<BrewingOperationUnsupported> => unsupportedBrewingOperation(state)

export const insertBrewingBottle = (
  state: GameplayFrameState,
  _bottle: BrewingBottle,
): Effect.Effect<BrewingOperationUnsupported> => unsupportedBrewingOperation(state)

export const insertBrewingIngredient = (
  state: GameplayFrameState,
  _ingredient: BrewingIngredient,
): Effect.Effect<BrewingOperationUnsupported> => unsupportedBrewingOperation(state)

export const collectBrewingPotion = (
  state: GameplayFrameState,
): Effect.Effect<BrewingOperationUnsupported> => unsupportedBrewingOperation(state)

export const useBrewingPotion = (
  state: GameplayFrameState,
): Effect.Effect<BrewingOperationUnsupported> => unsupportedBrewingOperation(state)

const stepStatusEffects = (
  state: GameplayFrameState,
  dt: DeltaTimeSecs,
): Effect.Effect<void, Brand.BrandError | SurvivalHungerError> =>
  Effect.gen(function* () {
    const applications = yield* Ref.getAndSet(state.pendingStatusEffects, [])
    const current = yield* Ref.get(state.statusEffects)
    const applied = applications.reduce(applyStatusEffect, current)
    const tick = tickStatusEffects(applied, dt)

    yield* Ref.set(state.statusEffects, tick.state)
    yield* Ref.set(state.playerMovementSpeedMultiplier, tick.movementSpeedMultiplier)
    if (tick.hungerExhaustion > 0) {
      yield* state.survivalHunger.addExhaustion(tick.hungerExhaustion)
    }
    if (tick.poisonPulses > 0) {
      const damages: ReadonlyArray<PlayerDamageEvent> = Array.from(
        { length: tick.poisonPulses },
        () => ({
          _tag: 'StatusEffect' as const,
          effect: 'poison' as const,
          damage: { amount: POISON_DAMAGE_POINTS, cause: 'poison' as const },
          minimumHealthPoints: POISON_MINIMUM_HEALTH_POINTS,
        }),
      )
      yield* Ref.update(state.playerDamages, (pending) => [...pending, ...damages])
    }
    if (tick.regenerationPulses > 0) {
      const heals: ReadonlyArray<PlayerHealingEvent> = Array.from(
        { length: tick.regenerationPulses },
        () => ({
          _tag: 'StatusEffect' as const,
          effect: 'regeneration' as const,
          amount: REGENERATION_HEAL_POINTS,
          maximumHealthPoints: PLAYER_MAXIMUM_HEALTH_POINTS,
        }),
      )
      yield* Ref.update(state.playerHeals, (pending) => [...pending, ...heals])
    }
  })

export const requestVillagerTrade = (
  state: GameplayFrameState,
  request: VillagerTradeRequest,
): Effect.Effect<void> =>
  Ref.update(state.pendingVillagerTrades, (pending) => [...pending, request])

export const drainVillagerTradeResults = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<VillagerTradeResult>> =>
  Ref.getAndSet(state.villagerTradeResults, [])

const recordVillagerTradeResult = (
  state: GameplayFrameState,
  result: VillagerTradeResult,
): Effect.Effect<void> =>
  Ref.update(state.villagerTradeResults, (results) => [...results, result])

/** Snapshot the deterministic fire state for host persistence. */
export const snapshotFireLifecycle = (
  state: GameplayFrameState,
): Effect.Effect<FireLifecycleSnapshot> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(state.fireLifecycle)
    const accumulatorRef = yield* fireTickAccumulatorFor(state.fireLifecycle)
    const accumulator = yield* Ref.get(accumulatorRef)
    return makeFireLifecycleSnapshot(current, accumulator)
  })

/** Restore a previously persisted fire state without retaining host-owned references. */
export const restoreFireLifecycle = (
  state: GameplayFrameState,
  snapshot: FireLifecycleSnapshot,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!isFireLifecycleSnapshot(snapshot)) {
      return yield* Effect.die(new Error('Unsupported fire lifecycle snapshot'))
    }
    const restored = restoreFireLifecycleSnapshot(snapshot)
    yield* Ref.set(state.fireLifecycle, restored.state)
    const accumulatorRef = yield* fireTickAccumulatorFor(state.fireLifecycle)
    yield* Ref.set(
      accumulatorRef,
      restored.tickAccumulatorSecs,
    )
  })

/** Replace the host-observed weather exposure snapshot for the next frame. */
export const submitWeatherGameplayInput = (
  state: GameplayFrameState,
  input: WeatherGameplayInput,
): Effect.Effect<void> => Ref.set(state.weatherGameplayInput, input)

/** Atomically drain weather consequences exactly once in production order. */
export const drainWeatherGameplayEvents = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<WeatherGameplayEvent>> =>
  Ref.getAndSet(state.weatherGameplayEvents, [])

export const snapshotWeatherGameplay = (
  state: GameplayFrameState,
): Effect.Effect<WeatherGameplayState> =>
  Ref.get(state.weatherGameplay).pipe(
    Effect.map((snapshot) => ({
      seed: snapshot.seed,
      lastProcessedTick: snapshot.lastProcessedTick,
      chargedCreepers: [...snapshot.chargedCreepers],
    })),
  )

export const restoreWeatherGameplay = (
  state: GameplayFrameState,
  snapshot: WeatherGameplayState,
): Effect.Effect<void> =>
  Ref.set(state.weatherGameplay, {
    seed: snapshot.seed >>> 0,
    lastProcessedTick: snapshot.lastProcessedTick,
    chargedCreepers: [...snapshot.chargedCreepers],
  })

const firePositionKey = (position: FirePosition): string =>
  `${position.x},${position.y},${position.z}`

const FIRE_SNAPSHOT_OFFSETS = [
  [0, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 0, -1],
  [0, 0, 1],
] as const

/** Extinguish a loaded fire cell, committing logical state only after the world write succeeds. */
export const requestFireExtinguish = (
  state: GameplayFrameState,
  position: FirePosition,
  context: Readonly<{
    coordinator: WorldCommitCoordinatorApi
    dimension: Dimension
    changes: ReadonlyArray<ReplicatedOwnerCandidate>
  }>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(state.fireLifecycle)
    if (!current.fires.some((active) => firePositionKey(active.position) === firePositionKey(position))) {
      return false
    }
    const air = blockIdOf('air')
    /* v8 ignore start -- `air` is a registered BlockType. */
    if (Option.isNone(air)) return false
    /* v8 ignore stop */

    const revisionResult = yield* Effect.result(Effect.all([
      context.coordinator.revision,
      context.coordinator.dimensionRevision(context.dimension),
    ]))
    if (Result.isFailure(revisionResult)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'WorldCommit',
        subject: 'Fire',
        error: revisionResult.failure,
      })
      return false
    }
    const [expectedRevision, expectedDimensionRevision] = revisionResult.success
    const committed = yield* commitBlockEdits(
      context,
      expectedRevision,
      expectedDimensionRevision,
      [{ position: blockPosition(position.x, position.y, position.z), block: air.value }],
    )
    if (Result.isFailure(committed)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'WorldCommit',
        subject: 'Fire',
        error: committed.failure,
      })
      return false
    }

    yield* Ref.set(state.fireLifecycle, extinguishFire(current, position))
    const disturbed = committed.success.blockChanges.map((change) =>
      blockPositionKeyOf(change.position),
    )
    if (disturbed.length > 0) {
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
    }
    return true
  })

const stepFireTick = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  playerState: Schema.Schema.Type<typeof PlayerServiceSnapshotSchema>,
  context: Readonly<{
    coordinator: WorldCommitCoordinatorApi
    dimension: Dimension
    changes: ReadonlyArray<ReplicatedOwnerCandidate>
    playerStorageOwnerId: ReplicatedOwnerId
  }>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(state.fireLifecycle)
    // Redundant with the caller's own gate: `stepFireLifecycle` (below) checks
    // this identical predicate before ever entering the loop that calls
    // `stepFireTick`, and again after every call before looping again — so
    // every call this function receives already has at least one of
    // `fires`/`burningActors` non-empty. `stepFireTick` has no other caller.
    /* v8 ignore start */
    if (current.fires.length === 0 && (current.burningActors?.length ?? 0) === 0) return true
    /* v8 ignore stop */

    const revisionResult = yield* Effect.result(Effect.all([
      context.coordinator.revision,
      context.coordinator.dimensionRevision(context.dimension),
    ]))
    if (Result.isFailure(revisionResult)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'WorldCommit',
        subject: 'Fire',
        error: revisionResult.failure,
      })
      return false
    }
    const [expectedRevision, expectedDimensionRevision] = revisionResult.success
    const activeKeys = new Set(current.fires.map((fire) => firePositionKey(fire.position)))
    const burningIds = new Set((current.burningActors ?? []).map((actor) => actor.id))
    const survivalResult = yield* Effect.result(state.survivalHunger.snapshot)
    if (Result.isFailure(survivalResult)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Vitals',
        error: survivalResult.failure,
      })
      return false
    }
    const survival = survivalResult.success
    const feet = playerState.pose.feetPosition
    const playerContactPosition = {
      x: Math.floor(feet.x),
      y: Math.floor(feet.y),
      z: Math.floor(feet.z),
    }
    const rosterEntities = [...(yield* roster.entities)]
    const entityById = new Map(rosterEntities.map((entity) => [String(entity.id), entity]))
    const burningEntityContacts = [...burningIds]
      .filter((id) => id !== 'player')
      .sort((a, b) => a.localeCompare(b))
      .map((id): FireActorContact => {
        const entity = entityById.get(id)
        // `id` is drawn from `burningIds`, which is built two lines up from
        // `(current.burningActors ?? []).map(actor => actor.id)` — so by the
        // time this callback runs for a given `id`, `current.burningActors`
        // is proven non-undefined (it produced `id`) and proven to contain an
        // actor whose `.id === id` (the same map produced `id` from it). Both
        // fallbacks below are for a caller who could see `id` without that
        // provenance; none exists.
        /* v8 ignore start */
        const previous = (current.burningActors ?? []).find((actor) => actor.id === id)
        /* v8 ignore stop */
        if (entity === undefined) {
          return {
            id,
            kind: 'entity',
            /* v8 ignore next */
            position: previous?.position ?? { x: 0, y: 0, z: 0 },
            alive: false,
          }
        }
        return {
          id,
          kind: 'entity',
          position: {
            x: Math.floor(entity.feetPosition.x),
            y: Math.floor(entity.feetPosition.y),
            z: Math.floor(entity.feetPosition.z),
          },
          alive: entity.healthPoints > 0,
        }
      })
    const newEntityContacts = rosterEntities
      .filter((entity) => !burningIds.has(String(entity.id)))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((entity): FireActorContact => ({
        id: String(entity.id),
        kind: 'entity',
        position: {
          x: Math.floor(entity.feetPosition.x),
          y: Math.floor(entity.feetPosition.y),
          z: Math.floor(entity.feetPosition.z),
        },
        alive: entity.healthPoints > 0,
      }))
    const contacts: FireActorContact[] = [
      {
        id: 'player',
        kind: 'player',
        position: playerContactPosition,
        alive: survival.vitals.healthPoints > 0,
      },
      ...[...burningEntityContacts, ...newEntityContacts].slice(0, FIRE_WORK_BUDGET),
    ]
    const positions = new Map<string, FirePosition>()
    for (const fire of current.fires) {
      for (const [dx, dy, dz] of FIRE_SNAPSHOT_OFFSETS) {
        const position = {
          x: fire.position.x + dx,
          y: fire.position.y + dy,
          z: fire.position.z + dz,
        }
        positions.set(firePositionKey(position), position)
      }
    }
    for (const contact of contacts) positions.set(firePositionKey(contact.position), contact.position)

    const weather = (yield* Ref.get(state.weather)).weather
    const cells: FireCell[] = []
    for (const position of positions.values()) {
      const reading = yield* store.getBlock(blockPosition(position.x, position.y, position.z))
      const block = reading._tag === 'Block'
        ? (yield* resultOrDie(blockTypeOfId(reading.block))) ?? '__unknown_fire_block__'
        : reading._tag === 'ChunkNotLoaded'
          ? FIRE_UNAVAILABLE_BLOCK
          : 'air'
      let exposedToSky = false
      if (weather !== 'clear' &&
        (activeKeys.has(firePositionKey(position)) || contacts.some((contact) =>
          firePositionKey(contact.position) === firePositionKey(position)))) {
        const light = yield* store.getLight(blockPosition(position.x, position.y, position.z))
        exposedToSky = light._tag === 'Light' && light.sky === 15
      }
      cells.push({ position, block, exposedToSky })
    }

    const cellByPosition = new Map(cells.map((cell) => [firePositionKey(cell.position), cell]))
    const hydratedContacts = contacts.map((contact) => {
      const cell = cellByPosition.get(firePositionKey(contact.position))
      return {
        ...contact,
        inWater: cell?.block === 'water',
        exposedToSky: cell?.exposedToSky === true,
      }
    })
    const step = advanceFireLifecycle(current, cells, weather, hydratedContacts, survival.difficulty)
    if (step.entityDamages.length > 0) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported',
        action: 'FireEntityDamage',
        reason: 'EntityRosterOwnerUnavailable',
      })
      return false
    }
    const air = blockIdOf('air')
    const fire = blockIdOf('fire')
    // Same totality argument as `requestFireExtinguish`'s `air` check above:
    // `'air'` and `'fire'` are both registered BlockTypes, so `blockIdOf`
    // returns `Some` for both registered types.
    /* v8 ignore start */
    if (Option.isNone(air) || Option.isNone(fire)) return true
    /* v8 ignore stop */
    const airBlock = air.value
    const fireBlock = fire.value
    const playerDamages: ReadonlyArray<PlayerDamageEvent> = step.damages
      .map((damage) => ({
        ...damage,
        at: kernelPosition(
          PositionAxis(damage.at.x),
          PositionAxis(damage.at.y),
          PositionAxis(damage.at.z),
        ),
      }))
    const fireDamageResult = playerDamages.length === 0
      ? Result.succeed({ damages: playerDamages, changes: [] } satisfies PreparedFirePlayerDamage)
      : yield* prepareFirePlayerDamage(
        context.coordinator,
        context.playerStorageOwnerId,
        expectedRevision,
        playerDamages,
      )
    if (Result.isFailure(fireDamageResult)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: fireDamageResult.failure._tag === 'OwnerSnapshotFailed'
          ? 'OwnerSnapshot'
          : 'CandidateBuild',
        subject: 'Fire',
        error: fireDamageResult.failure,
      })
      return false
    }
    const fireDamage = fireDamageResult.success

    const changes = fireDamage.changes.length === 0
      ? context.changes
      : [
          ...context.changes.filter((candidate) => candidate.ownerId !== context.playerStorageOwnerId),
          ...fireDamage.changes,
        ]
    const fireCommitContext = { ...context, changes }
    const disturbed: BlockPositionKey[] = []
    let committed: GameplayBlockCommitResult | undefined
    if (step.mutations.length > 0) {
      committed = yield* commitBlockEdits(
        fireCommitContext,
        expectedRevision,
        expectedDimensionRevision,
        step.mutations.map((mutation) => ({
          position: blockPosition(mutation.position.x, mutation.position.y, mutation.position.z),
          block: mutation.block === 'air' ? airBlock : fireBlock,
        })),
      )
    } else if (changes.length > 0) {
      committed = yield* Effect.result(context.coordinator.commit({
        expectedRevision,
        expectedDimensions: [{ dimension: context.dimension, expectedRevision: expectedDimensionRevision }],
        changes,
      }))
    }
    if (committed !== undefined) {
      if (Result.isFailure(committed)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed',
          operation: 'WorldCommit',
          subject: 'Fire',
          error: committed.failure,
        })
        return false
      }
      disturbed.push(...committed.success.blockChanges.map((change) =>
        blockPositionKeyOf(change.position),
      ))
    }

    yield* Ref.set(state.fireLifecycle, {
      ...step.state,
      fires: [...step.state.fires].sort((a, b) =>
        a.position.x - b.position.x || a.position.y - b.position.y || a.position.z - b.position.z),
      burningActors: step.state.burningActors ?? [],
    })
    if (fireDamage.damages.length > 0) {
      yield* Ref.update(state.playerDamages, (damages) => [...damages, ...fireDamage.damages])
    }
    if (disturbed.length > 0) {
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
    }
    return true
  })

const stepFireLifecycle = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  playerState: Schema.Schema.Type<typeof PlayerServiceSnapshotSchema>,
  dt: DeltaTimeSecs,
  context: Readonly<{
    coordinator: WorldCommitCoordinatorApi
    dimension: Dimension
    changes: ReadonlyArray<ReplicatedOwnerCandidate>
    playerStorageOwnerId: ReplicatedOwnerId
  }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(state.fireLifecycle)
    const accumulator = yield* fireTickAccumulatorFor(state.fireLifecycle)
    if (current.fires.length === 0 && (current.burningActors?.length ?? 0) === 0) {
      yield* Ref.set(accumulator, 0)
      return
    }

    const elapsed = Math.min(
      (yield* Ref.get(accumulator)) + Math.max(0, dt),
      FIRE_TICK_INTERVAL_SECS * FIRE_FRAME_TICK_BUDGET,
    )
    const ticks = Math.floor((elapsed + 1e-12) / FIRE_TICK_INTERVAL_SECS)
    yield* Ref.set(accumulator, elapsed - ticks * FIRE_TICK_INTERVAL_SECS)

    for (let index = 0; index < ticks; index += 1) {
      const advanced = yield* stepFireTick(state, store, roster, playerState, context)
      if (!advanced) {
        yield* Ref.update(accumulator, (remaining) => Math.min(
          FIRE_TICK_INTERVAL_SECS * FIRE_FRAME_TICK_BUDGET,
          remaining + (ticks - index) * FIRE_TICK_INTERVAL_SECS,
        ))
        return
      }
      const next = yield* Ref.get(state.fireLifecycle)
      // `stepFireTick`'s only early returns are the two proven-dead guards
      // above (both pragma'd), so any call that reaches back here ran all the
      // way to `stepFireTick`'s own `Ref.set`, which always writes a defined
      // `burningActors` array (possibly empty, never omitted). `next.burningActors`
      // is therefore never `undefined` at this point, and neither is `?.`'s or
      // `?? 0`'s fallback ever consulted. Asserted (`!`, `next.burningActors!`)
      // rather than kept as a branch a coverage gate cannot reach.
      if (next.fires.length === 0 && next.burningActors!.length === 0) {
        yield* Ref.set(accumulator, 0)
        return
      }
    }
  })

/** Drain mob drops emitted by casualties during the entities stage. */
export const drainMobDrops = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<MobDropEvent>> => Ref.getAndSet(state.mobDrops, [])

/** Atomically drain experience emitted by player-caused mob casualties. */
export const drainMobExperience = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<MobExperienceEvent>> => Ref.getAndSet(state.mobExperience, [])

export const requestDroppedItemPickup = (
  state: GameplayFrameState,
  request: DroppedItemPickupRequest,
): Effect.Effect<void> =>
  Ref.update(state.pendingDroppedItemPickups, (pending) => [...pending, request])

export const drainDroppedItemPickupExecutions = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<DroppedItemPickupExecution>> =>
  Ref.getAndSet(state.droppedItemPickupExecutions, [])

export const requestExperienceOrbAbsorption = (
  state: GameplayFrameState,
  request: ExperienceOrbAbsorptionContext,
): Effect.Effect<void> =>
  Ref.update(state.pendingExperienceOrbAbsorptions, (pending) => [...pending, request])

export const drainExperienceOrbAbsorptionExecutions = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<ExperienceOrbAbsorptionExecution>> =>
  Ref.getAndSet(state.experienceOrbAbsorptionExecutions, [])

export const drainGameplayUnsupportedOperations = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<GameplayUnsupportedOperation>> =>
  Ref.getAndSet(state.unsupportedOperations, [])

export const recordGameplayUnsupportedOperation = (
  state: GameplayFrameState,
  operation: GameplayUnsupportedOperation,
): Effect.Effect<void> =>
  Ref.update(state.unsupportedOperations, (current) => [...current, operation])

/** Resolve the block under the crosshair and enqueue placement in its adjacent cell. */
export const requestTargetedBlockPlacement = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  heldItem: PlaceableItemType,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const target = yield* resultOrDie(
      targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store)),
    )
    if (Option.isSome(target)) {
      yield* requestBlockPlacement(state, {
        positionKey: blockPositionKeyOf(blockPosition(target.value.adjacentPosition.x, target.value.adjacentPosition.y, target.value.adjacentPosition.z)),
        heldItem,
      })
    }
    return target
  })

/**
 * Prefer using the targeted block over placement. Lever state remains owned by
 * mx-redstone/the host; gameplay only emits a correlated toggle intent.
 */
export const requestTargetedBlockUse = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  requestId: BlockUseRequestId,
  heldItem: PlaceableItemType,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const target = yield* resultOrDie(
      targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store)),
    )
    if (Option.isNone(target)) {
      return target
    }

    const targetPosition = blockPosition(target.value.position.x, target.value.position.y, target.value.position.z)
    const outcome = resolveBlockUse(
      targetPosition,
      yield* store.getBlock(targetPosition),
    )
    switch (outcome._tag) {
      case 'ToggleLever':
        yield* requestBlockUse(state, requestId, targetPosition)
        break
      case 'NotLever':
        yield* requestBlockPlacement(state, {
          positionKey: blockPositionKeyOf(blockPosition(target.value.adjacentPosition.x, target.value.adjacentPosition.y, target.value.adjacentPosition.z)),
          heldItem,
        })
        break
      case 'ChunkNotLoaded':
      case 'OutOfWorld':
        break
      // exhaustiveness arm over BlockUseOutcome, a closed four-tag union
      // (use-block.ts's own exhaustiveness arm pins the same fact); all four
      // tags are handled above, so no input can reach this arm.
      /* v8 ignore start */
      default: {
        const exhaustive: never = outcome
        void exhaustive
        break
      }
      /* v8 ignore stop */
    }
    return target
  })

/** Resolve the block currently under the crosshair. */
export const resolveTargetedBlock = (
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    return yield* resultOrDie(
      targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store)),
    )
  })

/** Resolve the block under the crosshair and enqueue an item use in its adjacent cell. */
export const requestTargetedItemUse = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  requestId: ItemUseRequestId,
  heldItem: IgnitionItemType,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const target = yield* resolveTargetedBlock(store, player, maxDistance)
    if (Option.isSome(target)) {
      yield* requestItemUse(state, requestId, blockPosition(target.value.adjacentPosition.x, target.value.adjacentPosition.y, target.value.adjacentPosition.z), heldItem)
    }
    return target
  })

/** Resolve the block under the crosshair and enqueue a hoe use against it. */
export const requestTargetedSoilTill = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  requestId: ItemUseRequestId,
  heldItem: HoeItemType,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const target = yield* resultOrDie(
      targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store)),
    )
    if (Option.isSome(target)) {
      yield* requestSoilTill(state, requestId, blockPosition(target.value.position.x, target.value.position.y, target.value.position.z), heldItem)
    }
    return target
  })

/** Resolve the block under the crosshair and enqueue potato planting on it. */
export const requestTargetedPotatoPlanting = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  requestId: ItemUseRequestId,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const target = yield* resultOrDie(
      targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store)),
    )
    if (Option.isSome(target)) {
      yield* requestPotatoPlanting(state, requestId, blockPosition(target.value.position.x, target.value.position.y, target.value.position.z))
    }
    return target
  })

const normalizedBlockPlacementCommand = (
  command: BlockPlacementCommand,
): NormalizedBlockPlacementCommand => ({ ...command, mode: command.mode ?? 'survival' })

const sameBlockPlacementCommand = (
  left: NormalizedBlockPlacementCommand,
  right: NormalizedBlockPlacementCommand,
): boolean =>
  left.positionKey === right.positionKey &&
  left.heldItem === right.heldItem &&
  left.mode === right.mode

export const processBlockPlacementCommand = (
  state: GameplayFrameState,
  command: BlockPlacementCommand,
  execute: () => Effect.Effect<BlockPlacementResult>,
): Effect.Effect<BlockPlacementResult> => {
  const runtime = blockPlacementRuntimeFor(state)
  const normalized = normalizedBlockPlacementCommand(command)
  return runtime.mutex.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(runtime.state)
      const previous = current.handled.get(normalized.requestId)
      const result: BlockPlacementResult = previous === undefined
        ? yield* execute()
        : sameBlockPlacementCommand(previous.command, normalized)
          ? { ...previous.result, replayed: true }
          : {
              requestId: normalized.requestId,
              success: false,
              consumed: false,
              replayed: true,
              outcome: { _tag: 'RequestIdConflict' },
            }
      yield* Ref.update(runtime.state, (latest) => ({
        handled: previous === undefined
          ? new Map(latest.handled).set(normalized.requestId, { command: normalized, result })
          : latest.handled,
        results: [...latest.results, result],
      }))
      return result
    }),
  )
}

export const recordUnsupportedBlockPlacement = (
  state: GameplayFrameState,
  command: BlockPlacementCommand,
  reason: 'WorldCommitCoordinatorUnavailable' | 'OwnerRegistrationUnavailable',
): Effect.Effect<BlockPlacementResult> =>
  processBlockPlacementCommand(state, command, () => Effect.succeed({
    requestId: command.requestId,
    success: false,
    consumed: false,
    replayed: false,
    outcome: { _tag: 'Unsupported', reason },
  }))

export interface GameplayStageOptions {
  /** Whether this frame owns local Mob simulation and spawning. */
  readonly mobSimulation?: boolean
  /**
   * Whether this frame runs its own dropped-item pickup sweep.
   *
   * A consumer that runs a richer pickup loop of its own (preserving
   * metadata, durability or custom names this stage's `pickupDroppedItems`
   * does not carry) sets this `false` to avoid double-consuming the same
   * dropped item. Defaults to `true`, unchanged from every other caller.
   */
  readonly droppedItemPickup?: boolean
}
export type GameplayStageCommitServices = Readonly<{
  readonly coordinator: WorldCommitCoordinatorApi
  readonly playerOwnerId: ReplicatedOwnerId
  readonly playerStorageOwnerId: ReplicatedOwnerId
  readonly cropOwnerId?: ReplicatedOwnerId
  readonly droppedItemsOwnerId?: ReplicatedOwnerId
  readonly vitalsOwnerId?: ReplicatedOwnerId
  readonly experienceOrbsOwnerId?: ReplicatedOwnerId
  readonly villagerTradesOwnerId?: ReplicatedOwnerId
}>

export const gameplayPlayerStateForStage = (
  state: GameplayFrameState,
  commit: GameplayStageCommitServices | undefined,
): Effect.Effect<Schema.Schema.Type<typeof PlayerServiceSnapshotSchema> | undefined> =>
  Effect.gen(function* () {
    if (commit === undefined) return undefined
    const observed = yield* Effect.result(readGameplayPlayer(commit.coordinator, commit.playerOwnerId))
    if (Result.isFailure(observed)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Player',
        error: observed.failure,
      })
      return undefined
    }
    return observed.success.state
  })

export const candidateForPlayerStorageItemUse = (
  ownerId: ReplicatedOwnerId,
  storage: PlayerStorage,
  item: ItemType,
  operation: 'consume' | 'damage',
): Result.Result<ReplicatedOwnerCandidate | undefined, Schema.SchemaError> => {
  let candidate: PlayerStorage | undefined
  if (operation === 'consume') {
    const removed = Result.getOrUndefined(removeInventoryItem(storage.inventory, item, 1))
    if (removed === undefined || removed.removed !== 1) return Result.succeed(undefined)
    const updated = Result.getOrUndefined(withInventory(storage, removed.inventory))
    if (updated === undefined) return Result.succeed(undefined)
    candidate = updated
  } else {
    const slotIndex = storage.inventory.slots.findIndex((slot) => slot?.item === item)
    if (slotIndex < 0) return Result.succeed(undefined)
    const damaged = damagePlayerStorageAt(storage, { _tag: 'Inventory', slotIndex }, 1)
    if (damaged.result._tag !== 'Damaged' && damaged.result._tag !== 'Broken') return Result.succeed(undefined)
    candidate = damaged.storage
  }

  const validation = validatePlayerStorageSnapshot(candidate)
  if (validation._tag !== 'Valid') return Result.succeed(undefined)
  return Result.succeed({ ownerId, state: validation.storage })
}

export const candidateForItemUse: (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
  item: ItemType,
  operation: 'consume' | 'damage',
) => Effect.Effect<
  Result.Result<ReplicatedOwnerCandidate | undefined, WorldCommitCoordinatorError | Schema.SchemaError>
> = (
  coordinator,
  ownerId,
  item,
  operation,
) => Effect.gen(function* () {
    const committed = yield* Effect.result(coordinator.snapshot(ownerId, PlayerStorageSnapshotSchema))
    if (Result.isFailure(committed)) return Result.fail(committed.failure)
    return candidateForPlayerStorageItemUse(ownerId, committed.success.state, item, operation)
  })

export interface GameplayStageContext {
  readonly state: GameplayFrameState
  readonly store: ChunkStoreApi
  readonly roster: EntityManagerApi<MobBehaviour>
  readonly time: TimeServiceApi
  readonly vehicleService: VehicleServiceApi | undefined
  readonly vehicleEnvironment: VehicleFrameEnvironment | undefined
  readonly options: GameplayStageOptions
  readonly commit: GameplayStageCommitServices | undefined
}
// Internal dependencies for the stage adapters. The public facade re-exports only the package API.
export {
  AIR_BLOCK_ID,
  BLOCK_LOOT_ROLLS,
  BOW_MAX_RANGE,
  BlockId,
  ChunkStore,
  DROPPED_ITEM_PICKUP_RADIUS,
  ENDERMITE_KIND,
  ENDERMITE_MAX_HEALTH,
  ENDER_PEARL_DAMAGE,
  ENDER_PEARL_DEATH_CAUSE,
  Effect,
  FRESH_PRIMED_TNT,
  GAMEPLAY_STAGE_IDS,
  InventoryService,
  LOWEST_WEATHER_ROLLS,
  NO_ATTEMPTS,
  NO_TOOL,
  PRIMED_TNT_KIND,
  PlayerService,
  Ref,
  TimeService,
  UNREADABLE_BLOCK,
  UPSTREAM_STAGE_IDS,
  WEATHER_TRANSITION_ROLLS,
  addInventoryItem,
  adjacentBlockPosition,
  advanceFishing,
  advanceVehicles,
  advanceWeather,
  advanceWeatherGameplay,
  applyBoneMeal,
  applyFallingBlocks,
  applySpawnAttempts,
  blockLoot,
  blockPlacementRuntimeFor,
  blockPositionKeyOf,
  blockPositionOfKey,
  blockTypeOfId,
  bowCharge,
  bowDamage,
  breakBlock,
  breakRequestQueueFor,
  canFireBow,
  cancelFishing,
  capabilityOfBlockId,
  carryOver,
  castFishing,
  chunkCoordsAround,
  cropDrops,
  disturb,
  doorUpperBreakCell,
  drawRolls,
  enderPearlDisplacement,
  enqueueFluidDisturbance,
  entityManagerTag,
  experienceOfCasualties,
  firePositionKey,
  fluidRuntimeSemaphoreFor,
  fluidRuntimeStateFor,
  furnaceAdvanceChanged,
  hostileSpawnsAllowed,
  isSuccessfulBlockUse,
  knockbackDirection,
  meleeTarget,
  openChunkWindow,
  pickupDroppedItems,
  planFurnaceAdvance,
  plantCrop,
  recordVillagerTradeResult,
  reelFishing,
  removeInventoryItem,
  resolveBlasts,
  resolveBlockUse,
  resolveBowHits,
  resolveEndermanTeleportProbes,
  resolveFoodUse,
  resolveHostileContacts,
  resolveMeleeHits,
  resolvePlayerBlastDamage,
  rollAt,
  rollCasualtyDrops,
  rollSelfDestructDrops,
  runFluidPropagation,
  searchSpawnCandidates,
  settled,
  shotBlockedByTerrain,
  shotTarget,
  shouldSpawnEndermite,
  spawnDroppedItems,
  splitBudget,
  stepFireLifecycle,
  stepPortalTravel,
  stepStatusEffects,
  sweepMobs,
  takeBatch,
  tillSoil,
  toKernelPosition,
  useBucket,
  useFlintAndSteel,
  useVillagerOffer,
  weatherExpires,
  type BlockPositionKey,
  type BlockLootContext,
  type BowHit,
  type ChunkStoreApi,
  type DroppedItemSpawn,
  type EntityManager,
  type EntityManagerApi,
  type FluidWorkItem,
  type GameModule,
  type IgnitionItemType,
  type InventoryServiceApi,
  type MeleeAttackRequest,
  type MobBehaviour,
  type MobSpawnAttempt,
  type PendingBlockBreakRequest,
  type PlaceableItemType,
  type PlayerServiceApi,
  type Position,
  type StageRegistration,
  type TimeServiceApi,
  type VehicleFrameEnvironment,
  type VehicleServiceApi,
}
