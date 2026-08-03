/**
 * mx-gameplay's contribution to the frame (plan.md §4.1).
 *
 * This module is the whole of this repository's public behaviour surface:
 * mx-gameplay exposes STAGE REGISTRATION and essentially nothing else. It
 * publishes no service for another repository to call, because a rule is not a
 * service — anything another repository would want to ask mx-gameplay is really
 * a question about state, and state lives in mc-sim or mc-worldgen
 * (plan.md §2.3-1). See docs/public-api.md.
 *
 * ---------------------------------------------------------------------------
 * The stages read and write the world through mc-worldgen's `ChunkStore`
 * ---------------------------------------------------------------------------
 *
 * The store is acquired ONCE, in `makeGameplayStages` — that is, in
 * `GameModule.frameStages`, whose `RRegister` parameter exists for exactly this
 * (`domain/frame-contract.ts`). It is not acquired in `run`, because
 * `StageRegistration.run` has `FrameServices` as its context and `FrameServices`
 * is kernel's, not this repository's: a stage that demanded `ChunkStore` there
 * would be asking kernel to name mc-worldgen's services, which the tier model
 * (plan.md §2.2) forbids. `RIn` stays `never`; this repository BUILDS nothing
 * that another has to supply, it CALLS what mc-worldgen supplies.
 *
 * Until mc-worldgen is published the tag comes from `domain/chunk-store-port.ts`,
 * a mirror with a deletion date; `test/chunk-store-mirror.test.ts` is what keeps
 * the mirror honest, and the repoint is three lines in that file's header.
 *
 * ---------------------------------------------------------------------------
 * ...and the mobs through mc-sim's `EntityManager`
 * ---------------------------------------------------------------------------
 *
 * The second service, acquired at the same moment and for the same reason. It is
 * the roster this file spent a headed paragraph explaining why it could not
 * invent, and mc-sim has now built it; `domain/entity-manager-port.ts` is the
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
import { capabilityOfBlockId } from '@nerima-games/mc-kernel'
import {
  EYE_LEVEL_OFFSET,
  InventoryService,
  TimeService,
  addItem as addInventoryItem,
  forwardVector,
  removeItem as removeInventoryItem,
  targetBlockFromPlayerPose,
  type BlockTarget,
  type FurnaceState,
  type InventoryServiceApi,
  type TimeServiceApi,
} from '@nerima-games/mc-sim'
import { Effect, Effectable, Layer, Option, Readable, Ref } from 'effect'
import {
  below,
  horizontalNeighbours,
  positionKeyOf,
  positionOfKey,
} from '../domain/block-position-key'
import {
  advanceVillagerRestock,
  copyVillagerTradeState,
  emptyVillagerTradeState,
  useVillagerOffer,
  type VillagerTradeState,
} from '../domain/villager-trade'
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
} from '../domain/status-effect'
import {
  collectBrewingBottle as collectBottle,
  copyBrewingStandState,
  drinkBrewingPotion as drinkPotion,
  emptyBrewingStandState,
  acceptBrewingBottle as insertBottle,
  acceptBrewingFuel as insertFuel,
  acceptBrewingIngredient as insertIngredient,
  tickBrewingStand,
  type BrewingBottle,
  type BrewingCollectionResult,
  type BrewingDrinkResult,
  type BrewingIngredient,
  type BrewingStandState,
  type BrewingTransferResult,
} from '../domain/brewing'
import { targetabilityFromStore } from '../domain/in-memory-world'
import {
  AIR_BLOCK_ID,
  ChunkStore,
  type BlockPosition,
  type ChunkStoreApi,
} from '../domain/chunk-store-port'
import {
  chunkCoordsAround,
  openChunkWindow,
  UNREADABLE_BLOCK,
} from '../domain/chunk-window'
import { blockIdOf, blockTypeOfId, type PlaceableItemType } from '../domain/block-vocabulary'
import {
  advanceFireLifecycle,
  FIRE_FRAME_TICK_BUDGET,
  FIRE_TICK_INTERVAL_SECS,
  FIRE_UNAVAILABLE_BLOCK,
  FIRE_UNLOADED_RETRY_LIMIT,
  FIRE_WORK_BUDGET,
  extinguishFire,
  isFireLifecycleSnapshot,
  makeFireLifecycleSnapshot,
  makeFireLifecycleState,
  restoreFireLifecycleSnapshot,
  type FireActorContact,
  type FireCell,
  type FireEntityDamage,
  type FireLifecycleSnapshot,
  type FireLifecycleState,
  type FirePosition,
} from '../domain/fire-lifecycle'
import { applyFallingBlocks } from '../domain/entities/falling-block-move'
import {
  applySpawnAttempts,
  experienceOfCasualties,
  resolveBlasts,
  resolveBowHits,
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
  type MobCasualty,
  type MobSpawnAttempt,
} from '../domain/entities/mob-frame'
import { FRESH_PRIMED_TNT } from '../domain/mob/primed-tnt'
import {
  DROPPED_ITEM_PICKUP_RADIUS,
  pickupDroppedItems,
  spawnDroppedItems,
  type DroppedItemSpawn,
} from '../domain/entities/dropped-item'
import { searchSpawnCandidates } from '../domain/entities/mob-spawn-search'
import { hostileSpawnsAllowed } from '../domain/day-night'
import {
  changed,
  DESPAWNED,
  entityManagerTag,
  UNCHANGED,
  type EntityId,
  type EntityManager,
  type EntityManagerApi,
  type Position,
} from '../domain/entity-manager-port'
import type { Damage } from '../domain/death-cause'
import { resolveArmorHit } from '../domain/combat/armor'
import {
  resolveHostileContacts,
  resolvePlayerBlastDamage,
  type PlayerDamageEvent,
} from '../domain/mob/hostile-combat'
import {
  disturb,
  emptyFallingBlockQueue,
  settled,
  takeBatch,
  type FallingBlockQueue,
} from '../domain/falling-block'
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
} from '../domain/fluid-frontier'
import type { DeltaTimeSecs, GameModule, StageRegistration } from '../domain/frame-contract'
import { DEFAULT_ROLL_SEED, drawRolls, rollAt } from '../domain/frame-rolls'
import type { Dimension, PortalTravelPlan } from '../domain/nether-travel-port'
import { OUTSIDE_PORTAL, type PortalDwell, stepPortalDwell } from '../domain/portal-dwell'
import { applyPortalTravel, NO_KNOWN_PORTALS } from '../domain/portal-travel'
import { PlayerService, type PlayerServiceApi } from '../domain/player-port'
import { breakBlock } from '../domain/interactions/break-block'
import {
  BLOCK_LOOT_ROLLS,
  blockLoot,
  NO_TOOL,
  type BlockLootContext,
} from '../domain/interactions/block-loot'
import { placeBlock, type PlaceOutcome } from '../domain/interactions/place-block'
import { cropDrops, type CropDropOutcome } from '../domain/interactions/crop-drops'
import { applyBoneMeal, type BoneMealOutcome } from '../domain/interactions/bone-meal'
import { resolveFoodUse, type FoodUseOutcome, type FoodUseRequest } from '../domain/interactions/eat-food'
import {
  makeSurvivalHungerRuntime,
  type SurvivalHungerRuntimeApi,
} from '../domain/survival-hunger'
import {
  furnaceAdvanceChanged,
  planFurnaceAdvance,
  type FurnaceAdvancePlan,
} from '../domain/interactions/advance-furnace'
import { plantCrop, type PlantOutcome } from '../domain/interactions/plant-crop'
import { tillSoil, type TillOutcome } from '../domain/interactions/till-soil'
import {
  isSuccessfulBlockUse,
  resolveBlockUse,
  type BlockUseOutcome,
} from '../domain/interactions/use-block'
import {
  bowCharge,
  bowDamage,
  canFireBow,
  BOW_MAX_RANGE,
} from '../domain/interactions/draw-bow'
import { shotBlockedByTerrain, shotTarget, type ShotHit } from '../domain/interactions/bow-shot'
import { knockbackDirection, type KnockbackDirection } from '../domain/interactions/knockback'
import {
  DEFAULT_MELEE_DAMAGE,
  DEFAULT_MELEE_REACH,
  meleeTarget,
  meleeTargetBeforeBlock,
  type MeleeAttackRequest,
  type MeleeAttackResult as ResolvedMeleeAttackResult,
} from '../domain/interactions/melee-attack'
import {
  enderPearlDisplacement,
  shouldSpawnEndermite,
  ENDER_PEARL_DAMAGE,
  ENDER_PEARL_DEATH_CAUSE,
  type EnderPearlDisplacement,
} from '../domain/interactions/throw-ender-pearl'
import {
  useFlintAndSteel,
  type IgnitionOutcome,
  type IgnitionItemType,
} from '../domain/interactions/use-flint-and-steel'
import type { PositionKey } from '../domain/position-key'
import type { ItemType } from '../domain/item-vocabulary'
import {
  advanceWeather,
  INITIAL_WEATHER,
  LOWEST_WEATHER_ROLLS,
  weatherExpires,
  WEATHER_TRANSITION_ROLLS,
  type WeatherState,
} from '../domain/weather'
import {
  advanceWeatherGameplay,
  makeWeatherGameplayState,
  type WeatherGameplayEvent,
  type WeatherGameplayInput,
  type WeatherGameplayState,
} from '../domain/weather-gameplay'
import {
  makeEnderDragonEncounterRuntime,
  type EnderDragonEncounterStageApi,
} from './ender-dragon-encounter-stage'
import { GAMEPLAY_STAGE_IDS, UPSTREAM_STAGE_IDS } from './stage-ids'

export const resolveArmoredPlayerDamages = (
  inventory: InventoryServiceApi,
  damages: ReadonlyArray<PlayerDamageEvent>,
): Effect.Effect<ReadonlyArray<PlayerDamageEvent>> =>
  Effect.forEach(damages, (event) =>
    Effect.gen(function* () {
      const resolved = resolveArmorHit(yield* inventory.equipmentSnapshot, event.damage)
      if (resolved.durabilityWear > 0) {
        yield* Effect.forEach(resolved.wornSlots, (slot) =>
          inventory.damageAt({ _tag: 'Equipment', slot }, resolved.durabilityWear),
        )
      }
      return { ...event, damage: resolved.damage }
    }),
  )

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
 *     frame that wrote it. It exists because without it `domain/block-vocabulary.ts`'s
 *     tool gate is unreachable: every swing would be bare-handed, and the whole
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
type PendingBlockBreakRequest = {
  readonly requestId: number
  readonly publicQueueIndex: number
  readonly positionKey: PositionKey
  readonly lootContext: BlockLootContext | undefined
}

type PendingBlockBreakRequestState = {
  readonly nextRequestId: number
  readonly requests: ReadonlyArray<PendingBlockBreakRequest>
}

type PendingBlockBreakRequestQueue = {
  readonly state: Ref.Ref<PendingBlockBreakRequestState>
  readonly mutex: Effect.Semaphore
}

type FluidRuntimeState = {
  readonly frontier: ReadonlyArray<FluidWorkItem>
  readonly updates: ReadonlyArray<FluidWorkItem>
  readonly cells: ReadonlyMap<PositionKey, FluidCell>
}

class FluidStateRef extends Effectable.Class<ReadonlyArray<FluidWorkItem>>
  implements Ref.Ref<ReadonlyArray<FluidWorkItem>>
{
  readonly [Ref.RefTypeId] = {
    _A: (value: ReadonlyArray<FluidWorkItem>) => value,
  }
  readonly [Readable.TypeId]: Readable.TypeId = Readable.TypeId
  readonly get: Effect.Effect<ReadonlyArray<FluidWorkItem>>

  constructor(
    readonly state: Ref.Ref<FluidRuntimeState>,
    readonly field: 'frontier' | 'updates',
  ) {
    super()
    this.get = Ref.get(state).pipe(Effect.map((current) => current[field]))
  }

  commit(): Effect.Effect<ReadonlyArray<FluidWorkItem>> {
    return this.get
  }

  modify<B>(
    f: (value: ReadonlyArray<FluidWorkItem>) => readonly [B, ReadonlyArray<FluidWorkItem>],
  ): Effect.Effect<B> {
    return Ref.modify(this.state, (current) => {
      const [result, value] = f(current[this.field])
      return [result, { ...current, [this.field]: value }]
    })
  }
}

const fluidRuntimeStates = new WeakMap<
  Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  Ref.Ref<FluidRuntimeState>
>()

const fluidRuntimeSemaphores = new WeakMap<
  Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  Effect.Semaphore
>()

const fireTickAccumulators = new WeakMap<Ref.Ref<FireLifecycleState>, Ref.Ref<number>>()

const fireTickAccumulatorFor = (
  fireLifecycle: Ref.Ref<FireLifecycleState>,
): Ref.Ref<number> => {
  const accumulator = fireTickAccumulators.get(fireLifecycle)
  if (accumulator === undefined) {
    throw new Error('fire lifecycle is not owned by a gameplay frame state')
  }
  return accumulator
}

const fluidRuntimeStateFor = (
  frontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
): Ref.Ref<FluidRuntimeState> => {
  const state = fluidRuntimeStates.get(frontier)
  if (state === undefined) {
    throw new Error('fluid frontier is not owned by a gameplay frame state')
  }
  return state
}

const fluidRuntimeSemaphoreFor = (
  frontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
): Effect.Semaphore => {
  const semaphore = fluidRuntimeSemaphores.get(frontier)
  if (semaphore === undefined) {
    throw new Error('fluid frontier is not owned by a gameplay frame state')
  }
  return semaphore
}

const validFluidPosition = (position: BlockPosition): boolean =>
  Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)

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
  cells: ReadonlyMap<PositionKey, FluidCell>,
): Effect.Effect<FluidProbe> => {
  const key = positionKeyOf(position)
  return Effect.map(store.getBlock(position), (reading): FluidProbe => {
    if (reading._tag === 'ChunkNotLoaded') return { key, state: 'unloaded' }
    if (reading._tag === 'OutOfWorld') return { key, state: 'out-of-world' }

    const block = blockTypeOfId(reading.block)
    if (block === 'air') return { key, state: 'air' }
    if (block === kind) {
      return { key, state: 'same-fluid', source: cells.get(key)?.source ?? true }
    }
    if (block === (kind === 'water' ? 'lava' : 'water')) {
      return { key, state: 'opposite-fluid', source: cells.get(key)?.source ?? true }
    }
    return { key, state: 'blocked' }
  })
}

const maximumFluidLevel = (kind: FluidCell['kind'], dimension: Dimension): number =>
  kind === 'water'
    ? DEFAULT_FLUID_HORIZONTAL_RANGE.water
    : DEFAULT_FLUID_HORIZONTAL_RANGE.lava[dimension]

const runFluidPropagation = (
  store: ChunkStoreApi,
  runtime: Ref.Ref<FluidRuntimeState>,
  work: ReadonlyArray<FluidWorkItem>,
  dimension: Dimension,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const snapshot = yield* Ref.get(runtime)
    const cells = new Map(snapshot.cells)
    let generated: ReadonlyArray<FluidWorkItem> = []

    const enqueue = (item: FluidWorkItem): void => {
      generated = enqueueFluidDisturbance(generated, item)
    }
    const enqueueDependents = (parent: PositionKey): void => {
      for (const candidate of cells.values()) {
        if (candidate.parent === parent) enqueue(fluidWorkItemOf(candidate))
      }
    }

    for (const item of work) {
      const position = positionOfKey(item.key)
      // Legacy callers have historically used opaque diagnostic keys. They are
      // still recorded as evaluated work, but must never turn NaN into a world IO.
      if (!validFluidPosition(position)) continue

      const cell: FluidCell = cells.get(item.key) ?? {
        key: item.key,
        kind: item.kind,
        level: Math.max(0, Math.trunc(item.level ?? 0)),
        source: item.source ?? true,
        ...(item.parent === undefined ? {} : { parent: item.parent }),
        falling: item.falling ?? false,
      }
      const current = yield* fluidProbeAt(store, position, cell.kind, cells)
      const belowPosition = below(position)
      const horizontalPositions = horizontalNeighbours(position)
      let belowProbe: FluidProbe = { key: positionKeyOf(belowPosition), state: 'blocked' }
      let horizontalProbes: ReadonlyArray<FluidProbe> = horizontalPositions.map((candidate) => ({
        key: positionKeyOf(candidate),
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
        maximumHorizontalLevel: maximumFluidLevel(cell.kind, dimension),
      })
      let deferCurrent = transition.defer

      for (const change of transition.changes) {
        if (change._tag === 'ForgetFluid') {
          cells.delete(change.key)
          enqueueDependents(change.key)
          continue
        }

        const changePosition = positionOfKey(
          change._tag === 'PlaceFluid' ? change.cell.key : change.key,
        )
        if (!validFluidPosition(changePosition)) continue

        if (change._tag === 'PlaceFluid') {
          const fluidBlock = blockIdOf(change.cell.kind)
          if (fluidBlock === undefined) continue
          const outcome = yield* store.setBlock(changePosition, fluidBlock)
          if (outcome._tag === 'Written' || outcome._tag === 'Unchanged') {
            cells.set(change.cell.key, change.cell)
            enqueue(fluidWorkItemOf(change.cell))
          } else if (outcome._tag === 'ChunkNotLoaded') {
            deferCurrent = true
          }
          continue
        }

        if (change._tag === 'RemoveFluid') {
          const outcome = yield* store.setBlock(changePosition, AIR_BLOCK_ID)
          if (outcome._tag === 'ChunkNotLoaded') {
            deferCurrent = true
          } else {
            cells.delete(change.key)
            enqueueDependents(change.key)
          }
          continue
        }

        const solidBlock = blockIdOf(change.block)
        if (solidBlock === undefined) continue
        const outcome = yield* store.setBlock(changePosition, solidBlock)
        if (outcome._tag === 'ChunkNotLoaded') {
          deferCurrent = true
        } else {
          cells.delete(change.key)
          enqueueDependents(change.key)
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
  readonly playerDead: Ref.Ref<boolean>
  readonly pendingBreaks: Ref.Ref<ReadonlyArray<PositionKey>>
  readonly pendingPlacements: Ref.Ref<ReadonlyArray<PlacementRequest>>
  readonly pendingBlockUses: Ref.Ref<ReadonlyArray<BlockUseRequest>>
  readonly pendingItemUses: Ref.Ref<ReadonlyArray<ItemUseRequest>>
  readonly pendingBowShots: Ref.Ref<ReadonlyArray<BowShotRequest>>
  readonly pendingMeleeAttacks: Ref.Ref<ReadonlyArray<MeleeAttackRequest>>
  readonly pendingPearlThrows: Ref.Ref<ReadonlyArray<EnderPearlThrowRequest>>
  readonly pendingVillagerTrades: Ref.Ref<ReadonlyArray<VillagerTradeRequest>>
  readonly pendingStatusEffects: Ref.Ref<ReadonlyArray<StatusEffectApplication>>
  readonly consumedItems: Ref.Ref<ReadonlyArray<PlaceableItemType>>
  readonly usedItems: Ref.Ref<ReadonlyArray<IgnitionItemType>>
  readonly blockUseResults: Ref.Ref<ReadonlyArray<BlockUseResult>>
  readonly itemUseResults: Ref.Ref<ReadonlyArray<ItemUseResult>>
  readonly bowShotResults: Ref.Ref<ReadonlyArray<BowShotResult>>
  readonly meleeAttackResults: Ref.Ref<ReadonlyArray<GameplayMeleeAttackResult>>
  readonly handledBowShotRequestIds: Ref.Ref<ReadonlySet<BowShotRequestId>>
  readonly bowKnockbacks: Ref.Ref<ReadonlyArray<BowKnockback>>
  readonly enderPearlOutcomes: Ref.Ref<ReadonlyArray<EnderPearlOutcome>>
  readonly playerDamages: Ref.Ref<ReadonlyArray<PlayerDamageEvent>>
  readonly playerHeals: Ref.Ref<ReadonlyArray<PlayerHealingEvent>>
  readonly playerMovementSpeedMultiplier: Ref.Ref<number>
  readonly statusEffects: Ref.Ref<StatusEffectState>
  readonly brewingStand: Ref.Ref<BrewingStandState>
  readonly fireLifecycle: Ref.Ref<FireLifecycleState>
  readonly hostileContactCooldowns: Ref.Ref<ReadonlyMap<EntityId, number>>
  readonly mobDrops: Ref.Ref<ReadonlyArray<MobDropEvent>>
  readonly mobExperience: Ref.Ref<ReadonlyArray<MobExperienceEvent>>
  readonly villagerTradeResults: Ref.Ref<ReadonlyArray<VillagerTradeResult>>
  readonly villagerTrades: Ref.Ref<VillagerTradeState>
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
    state: Ref.unsafeMake<PendingBlockBreakRequestState>({ nextRequestId: 0, requests: [] }),
    mutex: Effect.unsafeMakeSemaphore(1),
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
    state: Ref.unsafeMake<BlockPlacementRuntimeState>({ handled: new Map(), results: [] }),
    mutex: Effect.unsafeMakeSemaphore(1),
  }
  blockPlacementRuntimes.set(state, created)
  return created
}

/**
 * One request to put a block down.
 *
 * The position is a `PositionKey` rather than a `BlockPosition` so that the
 * inbox matches `pendingBreaks` exactly — one encoding, one place
 * (`domain/block-position-key.ts`), and a host that can queue a break can queue
 * a placement the same way.
 *
 * `heldItem` is a `PlaceableItemType`, so "you cannot place a stick" is a type
 * error where the request is BUILT rather than a refusal where it is serviced.
 * The proof obligation is `domain/block-vocabulary.ts`'s `isPlaceableItem` and it
 * belongs to whoever reads the hotbar, which is the same repository that would
 * have had to read it anyway.
 */
export type PlacementRequest = {
  readonly positionKey: PositionKey
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
  readonly mutex: Effect.Semaphore
}

/** Host-provided correlation key for one targeted block-use request. */
export type BlockUseRequestId = string

/** A request to use the block in a cell without transferring its state here. */
export type BlockUseRequest = {
  readonly requestId: BlockUseRequestId
  readonly positionKey: PositionKey
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
 * is a `PositionKey` so that a host which can queue a break can queue a
 * placement and an item use the same way, through one encoding
 * (`domain/block-position-key.ts`).
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
  readonly positionKey: PositionKey
  readonly heldItem: IgnitionItemType
}

/** Hoe names supplied by mc-kernel 0.2.4. Tilling behaviour is tier-independent. */
export const HOE_ITEM_TYPES = [
  'wooden_hoe',
  'stone_hoe',
  'iron_hoe',
  'diamond_hoe',
] as const satisfies ReadonlyArray<ItemType>

export type HoeItemType = (typeof HOE_ITEM_TYPES)[number]

export const isHoeItem = (item: ItemType): item is HoeItemType =>
  (HOE_ITEM_TYPES as ReadonlyArray<ItemType>).includes(item)

export type FarmingItemUseRequest =
  | {
      readonly action: 'TillSoil'
      readonly requestId: ItemUseRequestId
      readonly positionKey: PositionKey
      readonly heldItem: HoeItemType
    }
  | {
      readonly action: 'ApplyBoneMeal'
      readonly requestId: ItemUseRequestId
      readonly positionKey: PositionKey
      readonly heldItem: 'bone_meal'
    }
  | {
      readonly action: 'PlantPotato'
      readonly requestId: ItemUseRequestId
      readonly positionKey: PositionKey
      readonly heldItem: 'potato'
    }
  | {
      readonly action: 'HarvestPotato'
      readonly requestId: ItemUseRequestId
      readonly positionKey: PositionKey
      readonly ripe: boolean
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

export type ItemUseRequest = IgnitionItemUseRequest | FarmingItemUseRequest | FurnaceItemUseRequest

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
      readonly positionKey: PositionKey
      readonly success: boolean
      readonly outcome: CropDropOutcome
    }
  | {
      readonly action: 'EatPotato'
      readonly requestId: ItemUseRequestId
      readonly heldItem: 'potato'
      readonly success: boolean
      readonly consumedCount: 0 | 1
      readonly outcome: FoodUseOutcome
    }
  | {
      readonly action: 'EatFood'
      readonly requestId: ItemUseRequestId
      readonly heldItem: ItemType
      readonly success: boolean
      readonly consumedCount: 0 | 1
      readonly outcome: FoodUseOutcome
    }

export type FurnaceItemUseResult = {
  readonly action: 'AdvanceFurnace'
  readonly requestId: ItemUseRequestId
  readonly success: boolean
  readonly plan: FurnaceAdvancePlan
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
  | PlayerDeadItemUseResult

/**
 * One shot from a drawn bow.
 *
 * ---------------------------------------------------------------------------
 * IT CARRIES NO `heldItem`, AND THAT IS THE WHOLE STORY OF THIS REQUEST
 * ---------------------------------------------------------------------------
 *
 * `PlacementRequest` and `ItemUseRequest` above both carry one, and both explain
 * why in the same words: the item is 「a type error where the request is BUILT
 * rather than a refusal where it is serviced」, with `isPlaceableItem` and
 * `isIgnitionItem` as the proof obligations. The bow cannot have that field,
 * because `domain/item-vocabulary.ts` has no `bow` — kernel's `ITEM_TYPES` is 97
 * words and `bow`, `arrow` and `ender_pearl` are three of the eight it is missing
 * (docs/testing.md §3-1 row 1). Writing the literal here would make this
 * repository invent kernel's vocabulary, which is the one thing that row refuses.
 *
 * So the request carries the PHYSICAL FACTS of the shot and not the name of the
 * thing that produced it. That is not a workaround invented for the bow: it is
 * `BlockLootContext`'s shape, which takes a `heldTier` and a `fortuneLevel` rather
 * than the name of a pickaxe, and `domain/interactions/draw-bow.ts`'s
 * `BowDrawContext` follows it deliberately.
 *
 * WHAT IS ACTUALLY LOST BY THAT is precise and is not the aiming: it is the
 * INVENTORY traffic. The reference consumes one `ARROW`, damages the `BOW`'s
 * durability slot, and skips both under Infinity and Unbreaking
 * (`interaction-bow-handler.ts:184-198`). Every one of those is a call naming an
 * item, mc-sim's `add` / `remove` take an `ItemType`, and none
 * of the three words exists. A bow wired here therefore fires FOR FREE. That is
 * recorded rather than hidden, and it is the same shape as `consumedItems` — a
 * verb this repository can perform whose bookkeeping it cannot yet do honestly.
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
      readonly outcome: 'Undercharged' | 'DuplicateRequest' | 'PlayerDead'
    }

export type GameplayMeleeAttackResult =
  | ResolvedMeleeAttackResult
  | { readonly requestId: string; readonly success: false; readonly outcome: 'PlayerDead' }

/**
 * One ender pearl thrown.
 *
 * Carries no `heldItem` for `BowShotRequest`'s reason, and loses the same thing by
 * it: the reference consumes one `ENDER_PEARL` outside creative
 * (`ender-pearl.ts:58-64`) and this cannot, so a pearl thrown here is free and
 * infinite.
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
 * THE DAMAGE IS ALWAYS PRESENT, INCLUDING IN CREATIVE, and that is a DIVERGENCE
 * from the reference stated as one. `ender-pearl.ts:57,68` gates both the
 * consumption and the damage on `gameMode.isCreative()`, and there is no game mode
 * in this repository — no port, no mirror, and no Ref. Which mode the player is in
 * is state, state survives a save/load round trip, and by this file's header it is
 * therefore mc-sim's. Emitting the damage unconditionally leaves the exemption to
 * the one party that can know about it: a host in creative drops this field, and a
 * host that ignores the question gets survival's behaviour, which is the inert
 * direction of the two.
 */
export type EnderPearlOutcome = {
  /** How far and which way the thrower moves, in blocks, from where they stood. */
  readonly displacement: EnderPearlDisplacement
  /** What the throw costs them. See the note above on creative mode. */
  readonly damage: Damage
}

export const makeGameplayFrameState: Effect.Effect<GameplayFrameState> = Effect.gen(function* () {
  const enderDragonEncounter = yield* makeEnderDragonEncounterRuntime
  const survivalHunger = yield* makeSurvivalHungerRuntime()
  const playerDead = yield* Ref.make(false)
  const pendingBreaks = yield* Ref.make<ReadonlyArray<PositionKey>>([])
  const breakRequests = yield* Ref.make<PendingBlockBreakRequestState>({
    nextRequestId: 0,
    requests: [],
  })
  const breakRequestMutex = yield* Effect.makeSemaphore(1)
  const pendingPlacements = yield* Ref.make<ReadonlyArray<PlacementRequest>>([])
  const pendingBlockUses = yield* Ref.make<ReadonlyArray<BlockUseRequest>>([])
  const pendingItemUses = yield* Ref.make<ReadonlyArray<ItemUseRequest>>([])
  const pendingBowShots = yield* Ref.make<ReadonlyArray<BowShotRequest>>([])
  const pendingMeleeAttacks = yield* Ref.make<ReadonlyArray<MeleeAttackRequest>>([])
  const pendingPearlThrows = yield* Ref.make<ReadonlyArray<EnderPearlThrowRequest>>([])
  const pendingVillagerTrades = yield* Ref.make<ReadonlyArray<VillagerTradeRequest>>([])
  const pendingStatusEffects = yield* Ref.make<ReadonlyArray<StatusEffectApplication>>([])
  const consumedItems = yield* Ref.make<ReadonlyArray<PlaceableItemType>>([])
  const usedItems = yield* Ref.make<ReadonlyArray<IgnitionItemType>>([])
  const blockUseResults = yield* Ref.make<ReadonlyArray<BlockUseResult>>([])
  const itemUseResults = yield* Ref.make<ReadonlyArray<ItemUseResult>>([])
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
  const brewingStand = yield* Ref.make<BrewingStandState>(emptyBrewingStandState())
  const fireLifecycle = yield* Ref.make<FireLifecycleState>(makeFireLifecycleState([], DEFAULT_ROLL_SEED))
  const fireTickAccumulator = yield* Ref.make(0)
  fireTickAccumulators.set(fireLifecycle, fireTickAccumulator)
  const hostileContactCooldowns = yield* Ref.make<ReadonlyMap<EntityId, number>>(new Map())
  const mobDrops = yield* Ref.make<ReadonlyArray<MobDropEvent>>([])
  const mobExperience = yield* Ref.make<ReadonlyArray<MobExperienceEvent>>([])
  const villagerTradeResults = yield* Ref.make<ReadonlyArray<VillagerTradeResult>>([])
  const villagerTrades = yield* Ref.make<VillagerTradeState>(emptyVillagerTradeState())
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
  const fluidFrontier = new FluidStateRef(fluidState, 'frontier')
  const fluidUpdates = new FluidStateRef(fluidState, 'updates')
  fluidRuntimeStates.set(fluidFrontier, fluidState)
  fluidRuntimeSemaphores.set(fluidFrontier, yield* Effect.makeSemaphore(1))
  const tickCount = yield* Ref.make(0)
  const portalCandidates = yield* Ref.make<
    ReadonlyMap<Dimension, ReadonlyArray<BlockPosition>>
  >(new Map())
  const portalTravels = yield* Ref.make<ReadonlyArray<PortalTravelEvent>>([])
  // OUTSIDE, which is the only honest starting state: a fresh world has nobody
  // standing in a portal, and a `Cooling` default would swallow the first
  // crossing of a session.
  const portalDwell = yield* Ref.make<PortalDwell>(OUTSIDE_PORTAL)

  const state: GameplayFrameState = {
    enderDragonEncounter,
    survivalHunger,
    playerDead,
    pendingBreaks,
    pendingPlacements,
    pendingBlockUses,
    pendingItemUses,
    pendingBowShots,
    pendingMeleeAttacks,
    pendingPearlThrows,
    pendingVillagerTrades,
    pendingStatusEffects,
    consumedItems,
    usedItems,
    blockUseResults,
    itemUseResults,
    bowShotResults,
    meleeAttackResults,
    handledBowShotRequestIds,
    bowKnockbacks,
    enderPearlOutcomes,
    playerDamages,
    playerHeals,
    playerMovementSpeedMultiplier,
    statusEffects,
    brewingStand,
    fireLifecycle,
    hostileContactCooldowns,
    mobDrops,
    mobExperience,
    villagerTradeResults,
    villagerTrades,
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
    portalDwell,
  }
  pendingBlockBreakRequests.set(state, {
    state: breakRequests,
    mutex: breakRequestMutex,
  })
  return state
})

/** Set the host-derived death snapshot consumed by the next interaction stage run. */
export const setPlayerDead = (
  state: GameplayFrameState,
  playerDead: boolean,
): Effect.Effect<void> => Ref.set(state.playerDead, playerDead)

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
  player: PlayerServiceApi,
  dt: DeltaTimeSecs,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const cell = {
      x: Math.floor(pose.feetPosition.x),
      y: Math.floor(pose.feetPosition.y),
      z: Math.floor(pose.feetPosition.z),
    }

    const reading = yield* store.getBlock(cell)
    const inPortal =
      reading._tag === 'Block' && blockTypeOfId(reading.block) === 'nether_portal'

    const step = stepPortalDwell(yield* Ref.get(state.portalDwell), inPortal, dt)
    yield* Ref.set(state.portalDwell, step.dwell)

    if (!step.travels) {
      return
    }

    const sourceDimension = yield* player.dimension
    const destinationDimension: Dimension =
      sourceDimension === 'overworld' ? 'nether' : 'overworld'
    const snapshots = yield* Ref.get(state.portalCandidates)
    const candidates = snapshots.get(destinationDimension) ?? NO_KNOWN_PORTALS
    const plan = yield* applyPortalTravel(player, cell, candidates)

    if (plan.toDimension !== sourceDimension) {
      yield* Ref.update(state.portalTravels, (completed) => [
        ...completed,
        { sourceDimension, sourcePosition: cell, plan },
      ])
    }
  })

/**
 * Ask for a block to be broken on the next frame.
 *
 * THE INBOX'S ONLY PUBLIC DOOR, and it exists so the key encoding does not
 * leave this repository. `positionKeyOf` lives in `domain/block-position-key.ts`,
 * which `index.ts` keeps out of the barrel because it joins two MIRRORED
 * vocabularies — a host that encoded the key itself would be the second
 * hand-written copy of a format, and the first thing to break when the mirrors
 * are deleted.
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
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const queue = breakRequestQueueFor(state)
    return queue.mutex.withPermits(1)(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const positionKey = positionKeyOf(position)
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
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const target = targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store))
    if (Option.isSome(target)) {
      yield* requestBlockBreak(state, target.value.position)
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
    { requestId, positionKey: positionKeyOf(position) },
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
    { requestId, positionKey: positionKeyOf(position), heldItem },
  ])

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
    positionKey: positionKeyOf(position),
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
    positionKey: positionKeyOf(position),
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
    positionKey: positionKeyOf(position),
    heldItem: 'potato',
  }
  return Ref.update(state.pendingItemUses, (pending) => [...pending, request])
}

/** Resolve host-owned crop maturity into drops that the host can add to inventory. */
export const requestPotatoHarvest = (
  state: GameplayFrameState,
  requestId: ItemUseRequestId,
  position: BlockPosition,
  ripe: boolean,
  roll: number,
): Effect.Effect<void> => {
  const request: FarmingItemUseRequest = {
    action: 'HarvestPotato',
    requestId,
    positionKey: positionKeyOf(position),
    ripe,
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
    return Effect.dieMessage('requestBowShot: a correlated request requires shot geometry')
  }

  const request: BowShotRequest = { ...correlatedRequest, requestId: requestOrId }

  return Ref.update(state.pendingBowShots, (pending) => [...pending, request])
}

/** Atomically drain completed bow releases exactly once, preserving request order. */
export const drainBowShotResults = (
  state: GameplayFrameState,
): Effect.Effect<ReadonlyArray<BowShotResult>> => Ref.getAndSet(state.bowShotResults, [])

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
}

/** Resolve one primary click without mutating either gameplay inbox. */
export const resolveTargetedPrimaryAttack = (
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  player: PlayerServiceApi,
  options: TargetedPrimaryAttackOptions = {},
): Effect.Effect<TargetedPrimaryAttackResolution> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const blockTarget = targetBlockFromPlayerPose(
      pose,
      options.blockReach ?? DEFAULT_BLOCK_REACH,
      targetabilityFromStore(store),
    )
    const snapshot = yield* roster.snapshot
    const direction = forwardVector(pose)
    const request: MeleeAttackRequest = {
      origin: {
        ...pose.feetPosition,
        y: pose.feetPosition.y + EYE_LEVEL_OFFSET,
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
): Effect.Effect<TargetedPrimaryAttackResult> =>
  Effect.gen(function* () {
    const resolution = yield* resolveTargetedPrimaryAttack(store, roster, player, options)

    switch (resolution._tag) {
      case 'Melee':
        yield* requestMeleeAttack(state, resolution.request)
        return { _tag: 'Melee' as const, target: resolution.target }
      case 'Block':
        yield* requestBlockBreak(state, resolution.target.position)
        return resolution
      case 'None':
        return resolution
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

export const insertBrewingFuel = (
  state: GameplayFrameState,
): Effect.Effect<BrewingTransferResult> =>
  Ref.modify(state.brewingStand, (current) => {
    const [next, result] = insertFuel(current)
    return [result, next]
  })

export const insertBrewingBottle = (
  state: GameplayFrameState,
  bottle: BrewingBottle,
): Effect.Effect<BrewingTransferResult> =>
  Ref.modify(state.brewingStand, (current) => {
    const [next, result] = insertBottle(current, bottle)
    return [result, next]
  })

export const insertBrewingIngredient = (
  state: GameplayFrameState,
  ingredient: BrewingIngredient,
): Effect.Effect<BrewingTransferResult> =>
  Ref.modify(state.brewingStand, (current) => {
    const [next, result] = insertIngredient(current, ingredient)
    return [result, next]
  })

export const collectBrewingPotion = (
  state: GameplayFrameState,
): Effect.Effect<BrewingCollectionResult> =>
  Ref.modify(state.brewingStand, (current) => {
    const [next, result] = collectBottle(current)
    return [result, next]
  })

export const useBrewingPotion = (
  state: GameplayFrameState,
): Effect.Effect<BrewingDrinkResult> =>
  Effect.gen(function* () {
    const result = yield* Ref.modify(state.brewingStand, (current) => {
      const [next, outcome] = drinkPotion(current)
      return [outcome, next]
    })
    if (result._tag === 'Consumed') yield* requestStatusEffect(state, result.effect)
    return result
  })

export const snapshotBrewingStand = (
  state: GameplayFrameState,
): Effect.Effect<BrewingStandState> =>
  Ref.get(state.brewingStand).pipe(Effect.map(copyBrewingStandState))

export const restoreBrewingStand = (
  state: GameplayFrameState,
  snapshot: BrewingStandState,
): Effect.Effect<void> => Ref.set(state.brewingStand, copyBrewingStandState(snapshot))

const stepBrewing = (
  state: GameplayFrameState,
  dt: DeltaTimeSecs,
): Effect.Effect<void> => Ref.update(state.brewingStand, (current) => tickBrewingStand(current, dt))

const stepStatusEffects = (
  state: GameplayFrameState,
  dt: DeltaTimeSecs,
): Effect.Effect<void> =>
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

export const snapshotVillagerTrades = (
  state: GameplayFrameState,
): Effect.Effect<VillagerTradeState> =>
  Ref.get(state.villagerTrades).pipe(Effect.map(copyVillagerTradeState))

export const restoreVillagerTrades = (
  state: GameplayFrameState,
  snapshot: VillagerTradeState,
): Effect.Effect<void> => Ref.set(state.villagerTrades, copyVillagerTradeState(snapshot))

/** Snapshot the deterministic fire state for host persistence. */
export const snapshotFireLifecycle = (
  state: GameplayFrameState,
): Effect.Effect<FireLifecycleSnapshot> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(state.fireLifecycle)
    const accumulator = yield* Ref.get(fireTickAccumulatorFor(state.fireLifecycle))
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
    yield* Ref.set(
      fireTickAccumulatorFor(state.fireLifecycle),
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
  store: ChunkStoreApi,
  position: FirePosition,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(state.fireLifecycle)
    if (!current.fires.some((active) => firePositionKey(active.position) === firePositionKey(position))) {
      return false
    }
    const air = blockIdOf('air')
    if (air === undefined) return false
    const outcome = yield* store.setBlock(position, air)
    if (outcome._tag !== 'Written' && outcome._tag !== 'Unchanged') return false
    yield* Ref.set(state.fireLifecycle, extinguishFire(current, position))
    if (outcome._tag === 'Written') {
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, [positionKeyOf(position)]))
    }
    return true
  })

const stepFireTick = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  player: PlayerServiceApi,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(state.fireLifecycle)
    if (current.fires.length === 0 && (current.burningActors?.length ?? 0) === 0) return

    const activeKeys = new Set(current.fires.map((fire) => firePositionKey(fire.position)))
    const burningIds = new Set((current.burningActors ?? []).map((actor) => actor.id))
    const survival = yield* state.survivalHunger.snapshot
    const feet = (yield* player.pose).feetPosition
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
        const previous = (current.burningActors ?? []).find((actor) => actor.id === id)
        if (entity === undefined) {
          return {
            id,
            kind: 'entity',
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
      const reading = yield* store.getBlock(position)
      const block = reading._tag === 'Block'
        ? (blockTypeOfId(reading.block) ?? '__unknown_fire_block__')
        : reading._tag === 'ChunkNotLoaded'
          ? FIRE_UNAVAILABLE_BLOCK
          : 'air'
      let exposedToSky = false
      if (weather !== 'clear' &&
        (activeKeys.has(firePositionKey(position)) || contacts.some((contact) =>
          firePositionKey(contact.position) === firePositionKey(position)))) {
        const light = yield* store.getLight(position)
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
    const air = blockIdOf('air')
    const fire = blockIdOf('fire')
    if (air === undefined || fire === undefined) return
    const nextFires = new Map(step.state.fires.map((active) => [firePositionKey(active.position), active]))
    const previousFires = new Map(current.fires.map((active) => [firePositionKey(active.position), active]))
    const failedIgnitions = new Set<string>()
    const disturbed: string[] = []
    for (const mutation of step.mutations) {
      const mutationKey = firePositionKey(mutation.position)
      const outcome = yield* store.setBlock(mutation.position, mutation.block === 'air' ? air : fire)
      if (outcome._tag === 'Written') disturbed.push(positionKeyOf(mutation.position))
      if (outcome._tag === 'Written' || outcome._tag === 'Unchanged') continue
      if (mutation.block === 'fire') {
        nextFires.delete(mutationKey)
        failedIgnitions.add(mutationKey)
        continue
      }
      const previous = previousFires.get(mutationKey)
      if (previous === undefined) continue
      if (outcome._tag !== 'ChunkNotLoaded') {
        nextFires.set(mutationKey, previous)
        continue
      }
      const unloadedRetries = (previous.unloadedRetries ?? 0) + 1
      if (unloadedRetries <= FIRE_UNLOADED_RETRY_LIMIT) {
        nextFires.set(mutationKey, { ...previous, unloadedRetries })
      }
    }

    const previouslyBurningIds = new Set((current.burningActors ?? []).map((actor) => actor.id))
    let burningActors = (step.state.burningActors ?? []).filter(
      (actor) => previouslyBurningIds.has(actor.id) || !failedIgnitions.has(firePositionKey(actor.position)),
    )
    const entityDamages: ReadonlyArray<FireEntityDamage> = step.entityDamages.filter(
      (damage) => previouslyBurningIds.has(damage.actorId) || !failedIgnitions.has(firePositionKey(damage.at)),
    )
    const playerDamages = step.damages.filter(
      (damage) => previouslyBurningIds.has('player') || !failedIgnitions.has(firePositionKey(damage.at)),
    )

    const damageByEntity = new Map(entityDamages.map((damage) => [damage.actorId, damage]))
    const casualties = yield* roster.sweep<MobCasualty>((entity) => {
      const damage = damageByEntity.get(String(entity.id))
      if (damage === undefined) return { transition: UNCHANGED, emit: undefined }
      if (entity.healthPoints <= damage.damage.amount) {
        return {
          transition: DESPAWNED,
          emit: { id: entity.id, kind: entity.kind, at: entity.feetPosition },
        }
      }
      return {
        transition: changed({
          feetPosition: entity.feetPosition,
          healthPoints: entity.healthPoints - damage.damage.amount,
          behaviour: entity.behaviour,
        }),
        emit: undefined,
      }
    })
    if (casualties.length > 0) {
      const casualtyIds = new Set(casualties.map((casualty) => String(casualty.id)))
      burningActors = burningActors.filter((actor) => !casualtyIds.has(actor.id))
      const drops = yield* Ref.modify(state.rollSeed, (seed) => {
        const rolled = rollCasualtyDrops(casualties, seed)
        return [rolled.drops, rolled.seed] as const
      })
      if (drops.length > 0) {
        yield* Ref.update(state.mobDrops, (items) => [...items, ...drops])
      }
    }

    yield* Ref.set(state.fireLifecycle, {
      ...step.state,
      fires: [...nextFires.values()].sort((a, b) =>
        a.position.x - b.position.x || a.position.y - b.position.y || a.position.z - b.position.z),
      burningActors,
    })
    if (playerDamages.length > 0) {
      const armored = yield* resolveArmoredPlayerDamages(inventory, playerDamages)
      yield* Ref.update(state.playerDamages, (damages) => [...damages, ...armored])
    }
    if (disturbed.length > 0) {
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
    }
  })

const stepFireLifecycle = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  player: PlayerServiceApi,
  dt: DeltaTimeSecs,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(state.fireLifecycle)
    const accumulator = fireTickAccumulatorFor(state.fireLifecycle)
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
      yield* stepFireTick(state, store, roster, inventory, player)
      const next = yield* Ref.get(state.fireLifecycle)
      if (next.fires.length === 0 && (next.burningActors?.length ?? 0) === 0) {
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
    const target = targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store))
    if (Option.isSome(target)) {
      yield* requestBlockPlacement(state, {
        positionKey: positionKeyOf(target.value.adjacentPosition),
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
    const target = targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store))
    if (Option.isNone(target)) {
      return target
    }

    const outcome = resolveBlockUse(
      target.value.position,
      yield* store.getBlock(target.value.position),
    )
    switch (outcome._tag) {
      case 'ToggleLever':
        yield* requestBlockUse(state, requestId, target.value.position)
        break
      case 'NotLever':
        yield* requestBlockPlacement(state, {
          positionKey: positionKeyOf(target.value.adjacentPosition),
          heldItem,
        })
        break
      case 'ChunkNotLoaded':
      case 'OutOfWorld':
        break
    }
    return target
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
    const pose = yield* player.pose
    const target = targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store))
    if (Option.isSome(target)) {
      yield* requestItemUse(state, requestId, target.value.adjacentPosition, heldItem)
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
    const target = targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store))
    if (Option.isSome(target)) {
      yield* requestSoilTill(state, requestId, target.value.position, heldItem)
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
    const target = targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store))
    if (Option.isSome(target)) {
      yield* requestPotatoPlanting(state, requestId, target.value.position)
    }
    return target
  })

type BlockPlacementExecution = {
  readonly outcome: BlockPlacementCommandOutcome
  readonly consumed: boolean
  readonly mutated: boolean
}

/** Resolve the block under the crosshair and enqueue bone meal against it. */
export const requestTargetedBoneMeal = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  requestId: ItemUseRequestId,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<Option.Option<BlockTarget>> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const target = targetBlockFromPlayerPose(pose, maxDistance, targetabilityFromStore(store))
    if (Option.isSome(target)) {
      yield* requestBoneMeal(state, requestId, target.value.position)
    }
    return target
  })

const isBlockPlacementCommand = (
  request: PlacementRequest,
): request is BlockPlacementCommand => 'requestId' in request

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

const executeBlockPlacementAtomically = (
  request: PlacementRequest,
  mode: BlockPlacementMode,
  store: ChunkStoreApi,
  inventory: InventoryServiceApi,
  playerFeet: Position,
): Effect.Effect<BlockPlacementExecution> =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      if (mode === 'creative') {
        const outcome = yield* placeBlock(store, {
          position: positionOfKey(request.positionKey),
          heldItem: request.heldItem,
          playerFeet,
        })
        return { outcome, consumed: false, mutated: outcome._tag === 'Placed' }
      }

      const reserved = yield* inventory.remove(request.heldItem, 1)
      if (reserved === 0) {
        return {
          outcome: { _tag: 'InventoryUnavailable' } as const,
          consumed: false,
          mutated: false,
        }
      }

      const outcome = yield* placeBlock(store, {
        position: positionOfKey(request.positionKey),
        heldItem: request.heldItem,
        playerFeet,
      })
      if (outcome._tag === 'Placed') {
        return { outcome, consumed: true, mutated: true }
      }

      const leftover = yield* inventory.add(request.heldItem, reserved)
      if (leftover !== 0) {
        return yield* Effect.dieMessage(
          `placement rollback could not restore ${String(request.heldItem)}`,
        )
      }
      return { outcome, consumed: false, mutated: false }
    }),
  )

const executeBlockPlacementCommand = (
  state: GameplayFrameState,
  command: BlockPlacementCommand,
  store: ChunkStoreApi,
  inventory: InventoryServiceApi,
  playerFeet: Position,
  playerDead: boolean,
): Effect.Effect<BlockPlacementExecution> => {
  const runtime = blockPlacementRuntimeFor(state)
  const normalized = normalizedBlockPlacementCommand(command)

  return runtime.mutex.withPermits(1)(
    Effect.uninterruptible(
      Effect.gen(function* () {
        const current = yield* Ref.get(runtime.state)
        const previous = current.handled.get(normalized.requestId)
        if (previous !== undefined) {
          const replayed: BlockPlacementResult = sameBlockPlacementCommand(
            previous.command,
            normalized,
          )
            ? { ...previous.result, replayed: true }
            : {
                requestId: normalized.requestId,
                success: false,
                consumed: false,
                replayed: true,
                outcome: { _tag: 'RequestIdConflict' },
              }
          yield* Ref.update(runtime.state, (latest) => ({
            ...latest,
            results: [...latest.results, replayed],
          }))
          return { outcome: replayed.outcome, consumed: false, mutated: false }
        }

        if (playerDead) {
          const outcome = { _tag: 'PlayerDead' } as const
          const result: BlockPlacementResult = {
            requestId: normalized.requestId,
            success: false,
            consumed: false,
            replayed: false,
            outcome,
          }
          yield* Ref.update(runtime.state, (latest) => ({
            handled: new Map(latest.handled).set(normalized.requestId, {
              command: normalized,
              result,
            }),
            results: [...latest.results, result],
          }))
          return { outcome, consumed: false, mutated: false }
        }

        const execution = yield* executeBlockPlacementAtomically(
          normalized,
          normalized.mode,
          store,
          inventory,
          playerFeet,
        )
        const result: BlockPlacementResult = {
          requestId: normalized.requestId,
          success: execution.outcome._tag === 'Placed',
          consumed: execution.consumed,
          replayed: false,
          outcome: execution.outcome,
        }
        yield* Ref.update(runtime.state, (latest) => ({
          handled: new Map(latest.handled).set(normalized.requestId, {
            command: normalized,
            result,
          }),
          results: [...latest.results, result],
        }))
        return execution
      }),
    ),
  )
}

export const gameplayStages = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  player: PlayerServiceApi,
  time: TimeServiceApi,
): ReadonlyArray<StageRegistration> => [
  {
    id: GAMEPLAY_STAGE_IDS.interactions,
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    // TWO OF THE ~40 one-rule-per-file handlers of plan.md §3.11 (break, place,
    // bucket, flint & steel, bow, farming, shears, ender pearl, feed, shear,
    // melee, …) now run here. They are deliberately many small files and ONE
    // stage: the granularity that matters for review is the rule, the
    // granularity that matters for composition is the stage (DN-GP-9).
    //
    // BREAKS ARE SERVICED BEFORE PLACEMENTS, and the order is a decision. A
    // player who breaks a cell and places into it in the same frame gets the
    // sequence they asked for; the other order silently drops the placement,
    // because `place-block` would read the cell as occupied by a block that is
    // about to stop existing. It is the same argument that puts `entities`
    // after `interactions` one stage down.
    run: (dt) =>
      Effect.gen(function* () {
        const playerDead = yield* Ref.get(state.playerDead)

        // ---------------------------------------------------------------
        // PORTAL TRAVEL, and it runs BEFORE the inbox drain and its early
        // return.
        // ---------------------------------------------------------------
        //
        // THIS IS THE CALL THAT MAKES THE RULE REACHABLE. `domain/portal-dwell.ts`
        // and `domain/portal-travel.ts` were both complete and callable while
        // nothing called them, which is the 「callable but unreachable」 state
        // this repository has had to correct more than once — a rule with a
        // green test file and no call site passes every test that only checks
        // the rule.
        //
        // It sits above the `return` below deliberately. That early return fires
        // whenever all five inboxes are empty, which is MOST frames, and a
        // dwell timer that only advanced on frames where somebody also broke a
        // block would take four seconds of MINING to cross a portal.
        yield* stepPortalTravel(state, store, player, dt)
        yield* Ref.update(state.villagerTrades, (current) => advanceVillagerRestock(current, dt))
        yield* stepBrewing(state, dt)
        yield* stepStatusEffects(state, dt)

        // `getAndSet` rather than get-then-set: whoever fills the inboxes is not
        // this fiber, and a request that arrived between the two steps would be
        // dropped without a trace (DN-GP-10). Both are drained UP FRONT, so a
        // placement queued while the breaks are being serviced waits for the
        // next frame rather than being serviced out of order.
        const breakRequestQueue = breakRequestQueueFor(state)
        const { breaks, snapshots } = yield* breakRequestQueue.mutex.withPermits(1)(
          Effect.uninterruptible(
            Effect.gen(function* () {
              const breaks = yield* Ref.getAndSet<ReadonlyArray<PositionKey>>(
                state.pendingBreaks,
                [],
              )
              const requests = yield* Ref.modify(breakRequestQueue.state, (pending) => [
                pending.requests,
                { ...pending, requests: [] },
              ])
              const snapshots = new Map<number, PendingBlockBreakRequest>()
              for (const request of requests) {
                if (breaks[request.publicQueueIndex] === request.positionKey) {
                  snapshots.set(request.publicQueueIndex, request)
                }
              }
              return { breaks, snapshots }
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

        const gained: Array<DroppedItemSpawn> = []
        const spent: Array<PlaceableItemType> = []
        const used: Array<IgnitionItemType> = []
        const blockUseResults: Array<BlockUseResult> = []
        const itemUseResults: Array<ItemUseResult> = []
        const bowShotResults: Array<BowShotResult> = []
        const meleeAttackResults: Array<GameplayMeleeAttackResult> = []
        const disturbed: Array<PositionKey> = []

        for (const request of villagerTrades) {
          if (playerDead) {
            yield* recordVillagerTradeResult(state, {
              ...request,
              _tag: 'Rejected',
              reason: 'PlayerDead',
            })
            continue
          }
          const tradeState = yield* Ref.get(state.villagerTrades)
          const villager = tradeState.villagers.find((candidate) => candidate.id === request.villagerId)
          const offer = villager?.offers.find((candidate) => candidate.id === request.offerId)
          if (offer === undefined) {
            yield* recordVillagerTradeResult(state, {
              ...request,
              _tag: 'Rejected',
              reason: 'UnknownOffer',
            })
            continue
          }
          if (offer.uses >= offer.maxUses) {
            yield* recordVillagerTradeResult(state, {
              ...request,
              _tag: 'Rejected',
              reason: 'OutOfStock',
            })
            continue
          }

          const before = yield* inventory.snapshot
          const removed = removeInventoryItem(before, offer.input.item, offer.input.count)
          if (removed.removed !== offer.input.count) {
            yield* recordVillagerTradeResult(state, {
              ...request,
              _tag: 'Rejected',
              reason: 'InsufficientItems',
            })
            continue
          }
          const added = addInventoryItem(removed.inventory, offer.output.item, offer.output.count)
          if (added.leftover !== 0) {
            yield* recordVillagerTradeResult(state, {
              ...request,
              _tag: 'Rejected',
              reason: 'InventoryFull',
            })
            continue
          }

          const actuallyRemoved = yield* inventory.remove(offer.input.item, offer.input.count)
          const leftover =
            actuallyRemoved === offer.input.count
              ? yield* inventory.add(offer.output.item, offer.output.count)
              : offer.output.count
          if (actuallyRemoved !== offer.input.count || leftover !== 0) {
            yield* inventory.restore(before)
            yield* recordVillagerTradeResult(state, {
              ...request,
              _tag: 'Rejected',
              reason:
                actuallyRemoved === offer.input.count ? 'InventoryFull' : 'InsufficientItems',
            })
            continue
          }

          yield* Ref.update(state.villagerTrades, (current) =>
            useVillagerOffer(current, request.villagerId, request.offerId) ?? current,
          )
          yield* recordVillagerTradeResult(state, { ...request, _tag: 'Traded' })
        }

        // Legacy key-only requests have no completion-time snapshot, so they
        // retain the old batch-level fallback. Requests made through the public
        // helper use the context captured when mining completed.
        const fallbackTool = yield* Ref.get(state.heldTool)
        const playerFeet = (yield* player.pose).feetPosition

        for (const [index, positionKey] of breaks.entries()) {
          if (playerDead) continue
          const tool = snapshots.get(index)?.lootContext ?? fallbackTool
          const breakPosition = positionOfKey(positionKey)
          const outcome = yield* breakBlock(store, breakPosition)
          switch (outcome._tag) {
            case 'Broken': {
              // THE LOOT TABLE, and this is the line the mining path was
              // missing. `outcome.yielded` is a chunk buffer BYTE and used to be
              // pushed into the outbox as-is, so breaking stone gave you stone
              // and bare hands harvested it; `domain/interactions/block-loot.ts`
              // is what turns it into kernel's items, and it is asked even when
              // it will answer with nothing.
              //
              // The seed is read, advanced and written in ONE step. A split
              // read/write here would let two frames draw the same rolls, which
              // is worse than a non-deterministic generator: it is a
              // deterministic wrong one. `BLOCK_LOOT_ROLLS` is drawn per broken
              // block whether or not the block has anything to roll for — see
              // that file's header on why the budget is fixed.
              const loot = yield* Ref.modify(state.rollSeed, (seed) => {
                const batch = drawRolls(seed, BLOCK_LOOT_ROLLS)
                return [blockLoot(outcome.yielded, tool, batch.rolls), batch.seed] as const
              })
              gained.push(...loot.map((item) => ({ ...item, at: breakPosition })))

              // The ONLY entry point for falling-block work. Whatever rested on
              // the block just removed may now be unsupported. It is enqueued
              // whether or not the block dropped anything: a bare-handed swing
              // at stone yields no item AND still leaves a hole.
              disturbed.push(positionKey)
              break
            }

            // Air was already there: `Unchanged` did not dirty the chunk, so
            // nothing here may either. Queueing a disturbance for a write that
            // changed nothing is how a held mouse button becomes a permanent
            // per-tick workload.
            case 'NothingThere':
            // The cell is not this session's to touch. Not an error — the
            // player aimed at the edge of the world, or at a chunk that has
            // not finished loading — and `run` has no error channel to put one
            // in anyway.
            case 'ChunkNotLoaded':
            case 'OutOfWorld': {
              break
            }
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
          const position = positionOfKey(request.positionKey)
          const outcome = resolveBlockUse(position, yield* store.getBlock(position))
          blockUseResults.push({
            requestId: request.requestId,
            success: isSuccessfulBlockUse(outcome),
            outcome,
          })
        }

        for (const request of placements) {
          const execution = isBlockPlacementCommand(request)
            ? yield* executeBlockPlacementCommand(
                state,
                request,
                store,
                inventory,
                playerFeet,
                playerDead,
              )
            : playerDead
              ? undefined
              : yield* blockPlacementRuntimeFor(state).mutex.withPermits(1)(
                executeBlockPlacementAtomically(
                  request,
                  'survival',
                  store,
                  inventory,
                  playerFeet,
                ),
              )

          if (execution === undefined) continue
          if (execution.consumed && execution.outcome._tag === 'Placed') {
            spent.push(execution.outcome.consumed)
          }
          if (execution.mutated) {
            disturbed.push(positionKeyOf(below(positionOfKey(request.positionKey))))
          }
        }

        // ITEM USES ARE SERVICED LAST, after breaks and placements, and the
        // order is the same decision the break-before-place one is: a player who
        // builds the last block of an obsidian frame and lights it in the same
        // frame gets the sequence they asked for. The other order asks
        // `detectNetherPortal` about a ring that is one block short.
        for (const request of itemUses) {
          if (playerDead && (!('action' in request) || request.action !== 'AdvanceFurnace')) {
            itemUseResults.push({
              requestId: request.requestId,
              success: false,
              outcome: 'PlayerDead',
            })
            continue
          }
          if ('action' in request) {
            switch (request.action) {
              case 'ApplyBoneMeal': {
                const outcome = yield* applyBoneMeal(
                  (position) =>
                    Effect.map(store.getBlock(position), (reading) =>
                      reading._tag === 'Block' ? blockTypeOfId(reading.block) : undefined,
                    ),
                  positionOfKey(request.positionKey),
                )
                const success = outcome._tag === 'applied'
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success,
                  consumedCount: success ? 1 : 0,
                  outcome,
                })
                break
              }
              case 'TillSoil': {
                const outcome = yield* tillSoil(
                  {
                    blockAt: (position) =>
                      Effect.map(store.getBlock(position), (reading) =>
                        reading._tag === 'Block' ? reading.block : undefined,
                      ),
                    setBlock: store.setBlock,
                  },
                  { tills: true },
                  positionOfKey(request.positionKey),
                )
                const success = outcome._tag === 'tilled'
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success,
                  durabilityDamage: success ? 1 : 0,
                  outcome,
                })
                break
              }
              case 'PlantPotato': {
                const outcome = yield* plantCrop(
                  {
                    blockAt: (position) =>
                      Effect.map(store.getBlock(position), (reading) =>
                        reading._tag === 'Block' ? reading.block : undefined,
                      ),
                    setBlock: store.setBlock,
                  },
                  { held: request.heldItem, soil: positionOfKey(request.positionKey) },
                )
                const success = outcome._tag === 'planted'
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success,
                  consumedCount: success ? 1 : 0,
                  outcome,
                })
                break
              }
              case 'HarvestPotato': {
                const outcome = cropDrops('potato_crop', request.ripe, request.roll)
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  positionKey: request.positionKey,
                  success: outcome._tag === 'drops',
                  outcome,
                })
                break
              }
              case 'EatPotato': {
                const outcome = resolveFoodUse({
                  held: request.heldItem,
                  vitals: request.vitals,
                })
                const success = outcome._tag === 'consume'
                if (success) {
                  yield* state.survivalHunger.eat(outcome.foodPoints, outcome.saturationModifier)
                  yield* Ref.update(
                    state.pendingStatusEffects,
                    (pending) => [...pending, ...outcome.effects],
                  )
                }
                itemUseResults.push({
                  action: 'EatPotato',
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success,
                  consumedCount: success ? 1 : 0,
                  outcome,
                })
                break
              }
              case 'EatFood': {
                const outcome = resolveFoodUse({
                  held: request.heldItem,
                  vitals: request.vitals,
                  effectRoll: request.effectRoll,
                })
                const success = outcome._tag === 'consume'
                if (success) {
                  yield* state.survivalHunger.eat(outcome.foodPoints, outcome.saturationModifier)
                  yield* Ref.update(
                    state.pendingStatusEffects,
                    (pending) => [...pending, ...outcome.effects],
                  )
                }
                itemUseResults.push({
                  action: 'EatFood',
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success,
                  consumedCount: success ? 1 : 0,
                  outcome,
                })
                break
              }
              case 'AdvanceFurnace': {
                const plan = planFurnaceAdvance(request.state, request.deltaTimeSecs)
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  success: furnaceAdvanceChanged(plan),
                  plan,
                })
                break
              }
            }
            continue
          }

          const ignition = yield* useFlintAndSteel(
            store,
            positionOfKey(request.positionKey),
            request.heldItem,
          )
          const success = ignition.outcome._tag === 'Lit'
          if (ignition._tag === 'Tnt' && success) {
            const position = positionOfKey(request.positionKey)
            yield* roster.spawn({
              kind: PRIMED_TNT_KIND,
              feetPosition: { x: position.x + 0.5, y: position.y, z: position.z + 0.5 },
              healthPoints: 1,
              behaviour: FRESH_PRIMED_TNT,
            })
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

        // ---- THE BOW -------------------------------------------------------
        //
        // AFTER THE ITEM USES, and the order matters less than the others in this
        // stage but is still a decision: a shot is aimed at a mob and not at a
        // cell, so nothing above can change what it hits. It is last among the
        // block verbs because it is not one.
        //
        // THE ROSTER IS READ ONCE FOR THE WHOLE BATCH, like `heldTool` above and
        // for a stronger reason: `EntityManagerApi.entities` resolves to the
        // roster's OWN array (mc-sim's contract, not an implementation detail), so
        // re-reading it per shot would return the identical array object.
        const shoves: Array<BowKnockback> = []
        const bowHits: Array<BowHit> = []
        if (bowShots.length > 0) {
          const candidates = playerDead ? [] : yield* roster.entities
          const handledRequestIds = new Set(yield* Ref.get(state.handledBowShotRequestIds))

          for (const shot of bowShots) {
            if (shot.requestId !== undefined) {
              if (handledRequestIds.has(shot.requestId)) {
                bowShotResults.push({
                  requestId: shot.requestId,
                  success: false,
                  outcome: 'DuplicateRequest',
                })
                continue
              }
              handledRequestIds.add(shot.requestId)
            }

            if (playerDead) {
              if (shot.requestId !== undefined) {
                bowShotResults.push({
                  requestId: shot.requestId,
                  success: false,
                  outcome: 'PlayerDead',
                })
              }
              continue
            }

            // A TAP IS NOT A SHOT. `canFireBow` is the gate and it is asked
            // before anything else is computed, so a half-pressed button costs
            // one comparison rather than a scan of the roster.
            if (!canFireBow(shot.chargeSecs)) {
              if (shot.requestId !== undefined) {
                bowShotResults.push({
                  requestId: shot.requestId,
                  success: false,
                  outcome: 'Undercharged',
                })
              }
              continue
            }

            // Inventory belongs to the host. A correlated success means only
            // that the release crossed the draw gate, so misses and wall hits
            // still spend exactly one arrow when the host drains this outbox.
            if (shot.requestId !== undefined) {
              bowShotResults.push({
                requestId: shot.requestId,
                success: true,
                outcome: 'Fired',
              })
            }

            const hit = shotTarget(
              candidates,
              shot.origin,
              shot.dirX,
              shot.dirY,
              shot.dirZ,
              BOW_MAX_RANGE,
            )
            // A MISS IS ORDINARY AND SILENT. It is also where the arrow would
            // have gone, which this repository cannot say: no arrow exists to
            // land, and the reference's own miss draws a particle streak and
            // nothing else.
            if (hit === undefined) {
              continue
            }

            const directionLength = Math.hypot(shot.dirX, shot.dirY, shot.dirZ)
            const hitPoint: Position = {
              x: shot.origin.x + (shot.dirX / directionLength) * hit.distance,
              y: shot.origin.y + (shot.dirY / directionLength) * hit.distance,
              z: shot.origin.z + (shot.dirZ / directionLength) * hit.distance,
            }
            const centre: BlockPosition = {
              x: (shot.origin.x + hitPoint.x) / 2,
              y: (shot.origin.y + hitPoint.y) / 2,
              z: (shot.origin.z + hitPoint.z) / 2,
            }
            const radius =
              Math.max(
                Math.abs(hitPoint.x - shot.origin.x),
                Math.abs(hitPoint.z - shot.origin.z),
              ) /
                2 +
              1
            const terrain = yield* openChunkWindow(store, chunkCoordsAround(centre, radius))
            const blocked = shotBlockedByTerrain(
              (x, y, z) => {
                const block = terrain.blockAt(x, y, z)
                return block === UNREADABLE_BLOCK || !capabilityOfBlockId(block, 'passable')
              },
              shot.origin,
              hitPoint,
            )
            if (blocked) {
              continue
            }

            // THE REQUEST IS ITSELF A `BowDrawContext`, structurally: it carries
            // a `powerLevel` and the context wants nothing else. That is not a
            // coincidence to be tidied away — `BowShotRequest`'s header explains
            // that both types describe the bow by its PROPERTIES rather than by
            // its name, so the day a second enchantment level joins the context
            // the request grows the same field and this line does not change.
            const damage = bowDamage(bowCharge(shot.chargeSecs), shot)
            bowHits.push({ id: hit.id, damage })

            // WHICH WAY IT SHOVES, computed from the shooter to the target and
            // horizontal only. The target is looked up rather than carried out of
            // `shotTarget`, which returns a distance ALONG THE RAY and not a
            // position — and the shove is about where the mob stands, not about
            // how far down the line it was found.
            const target = candidates.find((candidate) => candidate.id === hit.id)
            if (target !== undefined) {
              shoves.push({
                id: hit.id,
                direction: knockbackDirection(
                  target.feetPosition.x - shot.origin.x,
                  target.feetPosition.z - shot.origin.z,
                ),
              })
            }
          }

          yield* Ref.set(state.handledBowShotRequestIds, handledRequestIds)
        }

        // ONE SWEEP FOR EVERY HIT — `resolveBowHits` argues it, and it is
        // `resolveBlasts`' argument with the nouns changed.
        const bowCasualties = yield* resolveBowHits(roster, bowHits)
        const meleeHits: Array<BowHit> = []
        if (meleeAttacks.length > 0) {
          const candidates = playerDead ? [] : yield* roster.entities
          for (const attack of meleeAttacks) {
            if (playerDead) {
              if (attack.requestId !== undefined) {
                meleeAttackResults.push({
                  requestId: attack.requestId,
                  success: false,
                  outcome: 'PlayerDead',
                })
              }
              continue
            }
            const hit = meleeTarget(candidates, attack)
            if (hit !== undefined) {
              meleeHits.push({ id: hit.id, damage: attack.damage })
            }
            if (attack.requestId !== undefined) {
              meleeAttackResults.push(
                hit === undefined
                  ? { requestId: attack.requestId, success: false }
                  : { requestId: attack.requestId, success: true, target: hit },
              )
            }
          }
        }
        const meleeCasualties = yield* resolveMeleeHits(roster, meleeHits)
        const weaponCasualties = [...bowCasualties, ...meleeCasualties]
        if (weaponCasualties.length > 0) {
          const experience = experienceOfCasualties(weaponCasualties)
          if (experience.length > 0) {
            yield* Ref.update(state.mobExperience, (items) => [...items, ...experience])
          }

          // The same atomic seed step the blast path uses, and for the same
          // reason: a split read/write would let two frames draw one sequence.
          const drops = yield* Ref.modify(state.rollSeed, (seed) => {
            const rolled = rollCasualtyDrops(weaponCasualties, seed)
            return [rolled.drops, rolled.seed] as const
          })
          if (drops.length > 0) {
            yield* Ref.update(state.mobDrops, (items) => [...items, ...drops])
          }
        }

        // ---- THE ENDER PEARL -----------------------------------------------
        //
        // ONE ROLL PER THROW, drawn as a BATCH up front rather than one at a time
        // inside the loop, which is `domain/interactions/block-loot.ts`'s
        // convention and `domain/frame-rolls.ts`'s: the budget is a function of
        // how many throws there were and not of what happened to them, so two runs
        // of one scenario draw the same numbers whatever the endermites do.
        const pearlOutcomes: Array<EnderPearlOutcome> = []
        if (!playerDead && pearlThrows.length > 0) {
          const rolls = yield* Ref.modify(state.rollSeed, (seed) => {
            const batch = drawRolls(seed, pearlThrows.length)
            return [batch, batch.seed] as const
          })

          for (const [index, thrown] of pearlThrows.entries()) {
            const displacement = enderPearlDisplacement(
              thrown.dirX,
              thrown.dirY,
              thrown.dirZ,
              thrown.hitDistance,
            )
            // A THROW THAT MOVES NOBODY COSTS NOTHING. The rule refuses a
            // degenerate aim (see its header on the reference's due-north
            // fallback), and a pearl that did not go anywhere must not take five
            // health points or roll for an endermite.
            if (displacement === undefined) {
              continue
            }

            pearlOutcomes.push({
              displacement,
              damage: { amount: ENDER_PEARL_DAMAGE, cause: ENDER_PEARL_DEATH_CAUSE },
            })

            if (!shouldSpawnEndermite(rollAt(rolls, index))) {
              continue
            }

            // WHERE THE ENDERMITE GOES IS WHERE THE PLAYER LANDS
            // (`ender-pearl.ts:73` spawns it at `teleportTarget`), and that is an
            // ABSOLUTE position, which this arm has only as the player's feet
            // plus the displacement it just computed.
            //
            // `behaviour: undefined`, which ticks nothing. `ENDERMITE_KIND`'s
            // header says at length what that means and why no rule is invented
            // to fill it.
            yield* roster.spawn({
              kind: ENDERMITE_KIND,
              feetPosition: {
                x: playerFeet.x + displacement.x,
                y: playerFeet.y + displacement.y,
                z: playerFeet.z + displacement.z,
              },
              healthPoints: ENDERMITE_MAX_HEALTH,
              behaviour: undefined,
            })
          }
        }

        // ---- THE DEPOSIT ---------------------------------------------------
        //
        // plan.md §2.3-1's worked example, as one line of code and a great deal
        // of argument that is in the module header rather than here. Each stack
        // the loot table produced is offered to mc-sim, in the order it was
        // mined.
        //
        // ONE `add` PER STACK, AND NOT ONE PER ITEM. `blockLoot` already folds
        // the base drop and its fortune bonus into a single `MinedItem`
        // (`domain/interactions/block-loot.ts` argues that at length), so three
        // glowstone dust is one call with `count: 3` rather than three calls.
        // That is not only cheaper: `add` tops up partial stacks before opening
        // empty slots, so three separate calls and one call of three can leave
        // an inventory in the same state and report DIFFERENT leftovers at the
        // boundary.
        //
        // THE NUMBER THAT COMES BACK IS WHAT DID NOT FIT — not a success flag,
        // and `0` is the ordinary answer. Ignoring it would be an item the
        // player watched disappear, which is the failure mc-sim's own comment
        // on `add` names this repository as responsible for avoiding.
        const spilled: Array<DroppedItemSpawn> = []
        for (const item of gained) {
          const leftover = yield* inventory.add(item.item, item.count)
          if (leftover > 0) {
            spilled.push({ item: item.item, count: leftover, at: item.at })
          }
        }

        if (spilled.length > 0) {
          const eligibleFromFrame = (yield* Ref.get(state.tickCount)) + 1
          yield* spawnDroppedItems(
            roster,
            spilled.map((drop) => ({ ...drop, eligibleFromFrame })),
          ).pipe(Effect.orDie)
        }
        if (spent.length > 0) {
          yield* Ref.update(state.consumedItems, (items) => [...items, ...spent])
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
        if (bowShotResults.length > 0) {
          yield* Ref.update(state.bowShotResults, (items) => [...items, ...bowShotResults])
        }
        if (meleeAttackResults.length > 0) {
          yield* Ref.update(state.meleeAttackResults, (items) => [...items, ...meleeAttackResults])
        }
        // Both are outboxes with no consumer in this repository; the types say
        // which missing noun each is waiting for.
        if (shoves.length > 0) {
          yield* Ref.update(state.bowKnockbacks, (items) => [...items, ...shoves])
        }
        if (pearlOutcomes.length > 0) {
          yield* Ref.update(state.enderPearlOutcomes, (items) => [...items, ...pearlOutcomes])
        }
        if (disturbed.length > 0) {
          yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
        }
      }),
  },
  {
    id: GAMEPLAY_STAGE_IDS.fire,
    after: [GAMEPLAY_STAGE_IDS.interactions],
    run: (dt) => stepFireLifecycle(state, store, roster, inventory, player, dt),
  },
  {
    id: GAMEPLAY_STAGE_IDS.survivalHunger,
    after: [GAMEPLAY_STAGE_IDS.fire],
    run: (dt) => Effect.asVoid(state.survivalHunger.tick(dt)),
  },
  {
    id: GAMEPLAY_STAGE_IDS.entities,
    after: [GAMEPLAY_STAGE_IDS.survivalHunger],
    // Entities run after interactions because a mob's reaction is to the world
    // as the player just left it — reversing the two makes a creeper respond to
    // last frame's block placement, which reads as lag rather than as a bug.
    // It is also what lets a block broken this frame start falling this frame.
    //
    // THE CREEPER IS RUN HERE NOW, AND THE REASON IS STILL THE POINT. This
    // comment used to say the opposite, at length: `domain/mob/` held finished
    // rules that this stage called none of, because running them needs 「a roster
    // of mobs with positions and health」, a roster is state, state survives a
    // save/load round trip, and by the test in this file's header it is therefore
    // mc-sim's. The alternative on offer — a local `Ref<Map<MobId, CreeperFuse>>`
    // — would have run that day and would have been the same mistake as the
    // `timeOfDaySecs` Ref this file used to hold: a second owner of a noun,
    // diverging from the one that gets saved.
    //
    // mc-sim built it (`domain/entity.ts`, `application/entity-manager.ts`, and
    // §7 of that repository's `docs/public-api.md`, which quotes the paragraph
    // back). The prediction that came with the refusal was that 「this stage
    // grows a loop and nothing in `domain/mob/` changes」. The loop is
    // `domain/entities/mob-frame.ts` and NOT ONE FILE IN `domain/mob/` CHANGED.
    //
    // The order below is the frame's, and the two halves are not independent: a
    // creeper's crater writes blocks, which `disturb`s them, which the
    // falling-block pass then picks up IN THE SAME FRAME. That is the
    // event-driven discipline `domain/falling-block.ts` is about, reached from a
    // new direction — the blast never scans, it reports the cells it actually
    // emptied.
    run: (dt) =>
      Effect.gen(function* () {
        // ---- mobs ----------------------------------------------------------
        //
        // One sweep: despawn what is out of range, burn every creeper's fuse,
        // move every enderman that wants to move, collect the blasts. A mob this
        // repository has no rule for costs one closure call and a shared object;
        // see `mob-frame.ts` on why the step record is the allocation only this
        // side can remove.
        //
        // THE SEED IS READ BEFORE AND WRITTEN AFTER, which is the one place in
        // this stage that is not a `Ref.modify`, and `mob-frame.ts`'s header
        // argues it rather than assuming it: the sweep is an Effect over the
        // roster, so there is no pure function to hand `Ref.modify`, and the
        // window it opens is one in which two frames would already be sweeping a
        // single roster. The drop roll below stays atomic because it can.
        const targetPosition = (yield* player.pose).feetPosition
        const { attacks, blasts, seed: sweptSeed } = yield* sweepMobs(
          roster,
          { target: targetPosition, dt },
          yield* Ref.get(state.rollSeed),
        )
        // Unconditional, and cheaper than testing whether it moved: a sweep that
        // drew nothing hands back the seed it was given, so this writes the same
        // number it read on every idle frame.
        yield* Ref.set(state.rollSeed, sweptSeed)

        if (attacks.length > 0) {
          const playerDamages = yield* resolveArmoredPlayerDamages(
            inventory,
            attacks.map((attack) => ({
              _tag: 'HostileContact' as const,
              source: attack.source,
              kind: attack.attackerKind,
              at: attack.at,
              damage: { amount: attack.damage, cause: 'mob' as const },
            })),
          )
          if (playerDamages.length > 0) {
            yield* Ref.update(state.playerDamages, (items) => [...items, ...playerDamages])
          }
        }

        if (blasts.length > 0) {
          const { casualties, disturbed } = yield* resolveBlasts(roster, store, blasts)

          // What the creeper itself leaves: nothing, and the RULE says so rather
          // than this stage assuming it (`domain/mob/mob-drop.ts` on why the
          // reference gets the same answer by accident of statement order).
          const playerDamages = yield* resolveArmoredPlayerDamages(
            inventory,
            resolvePlayerBlastDamage(blasts, targetPosition),
          )
          if (playerDamages.length > 0) {
            yield* Ref.update(state.playerDamages, (items) => [...items, ...playerDamages])
          }

          const selfDestruct = blasts.flatMap(rollSelfDestructDrops)

          // `Ref.modify`, so the seed is read, advanced and written in one step.
          // A split read/write here would let two frames draw the same rolls,
          // which is worse than a non-deterministic generator: it is a
          // deterministic wrong one.
          const drops = yield* Ref.modify(state.rollSeed, (seed) => {
            const rolled = rollCasualtyDrops(casualties, seed)
            return [rolled.drops, rolled.seed] as const
          })

          if (selfDestruct.length > 0 || drops.length > 0) {
            yield* Ref.update(state.mobDrops, (items) => [...items, ...selfDestruct, ...drops])
          }

          // THE ONLY WAY BLOCK WORK ENTERS FROM A BLAST. `disturbed` holds the
          // cells whose write came back `Written` and nothing else, so a blast
          // in open sky enqueues nothing — the same rule the interactions stage
          // applies to a break that changed nothing.
          if (disturbed.length > 0) {
            yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
          }
        }

        yield* pickupDroppedItems(
          roster,
          inventory,
          targetPosition,
          DROPPED_ITEM_PICKUP_RADIUS,
          yield* Ref.get(state.tickCount),
        )

        const contact = resolveHostileContacts(
          yield* roster.entities,
          targetPosition,
          dt,
          yield* Ref.get(state.hostileContactCooldowns),
        )
        yield* Ref.set(state.hostileContactCooldowns, contact.cooldowns)
        if (contact.damages.length > 0) {
          const playerDamages = yield* resolveArmoredPlayerDamages(inventory, contact.damages)
          yield* Ref.update(state.playerDamages, (items) => [...items, ...playerDamages])
        }

        // ---- the spawn search ----------------------------------------------
        //
        // ON A CADENCE, NOT EVERY FRAME. `domain/entities/mob-spawn-search.ts`
        // makes 256 store calls for a full ring — three blocks and a light per
        // cell — and `domain/chunk-store-port.ts` records that a light read
        // after a block write may relight a whole chunk. Running that at 20 Hz
        // is DN-GP-1 rebuilt: work proportional to the world on every frame
        // whether or not anything changed. The reference paces its spawner at
        // `SPAWN_INTERVAL_SECS = 0.3` for the same reason and this is that
        // number.
        //
        // `Ref.modify` so the accumulator is read, advanced and written in one
        // step. It SUBTRACTS the interval rather than resetting to zero, so a
        // long frame does not silently lose the remainder and the cadence stays
        // 0.3s on average rather than 0.3s-or-more.
        const searchDue = yield* Ref.modify(state.spawnClockSecs, (elapsed) => {
          const next = elapsed + dt
          return next >= HOSTILE_SPAWN_INTERVAL_SECS
            ? ([true, next - HOSTILE_SPAWN_INTERVAL_SECS] as const)
            : ([false, next] as const)
        })

        // `getAndSet` rather than get-then-set, for `pendingBreaks`' reason: a
        // candidate offered between the two steps would be dropped silently.
        const offered = yield* Ref.getAndSet<ReadonlyArray<MobSpawnAttempt>>(
          state.spawnAttempts,
          [],
        )

        let searched: ReadonlyArray<MobSpawnAttempt> = NO_ATTEMPTS
        const hour = yield* time.timeOfDay
        const dimension = yield* player.dimension

        // THREE GATES BEFORE THE 256 READS, and the third is the one that needs
        // defending. In the Overworld, `hostileSpawnsAllowed` is CALLED here as well as inside
        // `canHostileSpawnAt`, and `domain/mob/hostile-spawn.ts`'s header is
        // emphatic that the night gate is the rule's and 「a third opinion in
        // this file would be the second half of that bug」. This is not a third
        // opinion: it is the SAME FUNCTION, short-circuiting a search whose every
        // candidate the rule would refuse with `daylight`. The rule still runs
        // and still decides; what is skipped is 256 store reads to be told so 64
        // times. The Nether bypasses only this time gate because its hostile
        // roster is valid at every hour. Reimplementing the comparison here — `hour > 0.25 && ...` —
        // would be the failure that header describes, and is exactly what is not
        // done.
        //
        const hostileSearch = dimension === 'nether' || hostileSpawnsAllowed(hour)
        const passiveRepopulationSearch = !hostileSearch && (yield* roster.count) === 0
        if (searchDue && (hostileSearch || passiveRepopulationSearch)) {
          const found = yield* searchSpawnCandidates(
            store,
            targetPosition,
            hour,
            yield* Ref.get(state.rollSeed),
            dimension,
          )
          // The seed advanced by exactly `SPAWN_SEARCH_ROLLS`, and only because a
          // search ran. A frame that skipped it leaves the generator where it
          // found it, which is `domain/frame-rolls.ts`'s rule that the sequence
          // depends on what happened rather than on how many frames passed.
          // Daylight repopulation must not perturb the shared combat/weather
          // sequence. Once it succeeds the non-empty roster gates it off.
          if (hostileSearch) yield* Ref.set(state.rollSeed, found.seed)
          searched = found.attempts
        }

        // Concatenated rather than run as two passes, so that the population cap
        // sees ONE stream of candidates. Two passes would each apply the cap
        // against a census taken inside their own loop, and a frame holding one
        // offered cell and a full ring could spawn one more mob than
        // `MAX_HOSTILE_COUNT` allows.
        const attempts =
          searched.length === 0 ? offered : offered.length === 0 ? searched : [...offered, ...searched]

        if (attempts.length > 0) {
          // The outcomes — a `Refused` reason per cell, or `AtCapacity` — are
          // returned by `applySpawnAttempts` and dropped HERE, because `run`
          // returns void and there is nowhere in the frame to report a
          // diagnostic to. They are not dropped by the rule: whoever offers
          // candidates is who wants to know why they were refused, and when the
          // search that offers them lands in this repository it will call this
          // function directly and read them. `apps/preview-mining-site`'s arena
          // screen already prints the word.
          yield* applySpawnAttempts(roster, attempts)
        }

        // ---- falling blocks ------------------------------------------------
        //
        // `Ref.modify` rather than get-then-set: plan.md §3.8 lists TOCTOU on a
        // Ref among the reference's recurring Effect-level mistakes.
        // Read-modify-write as two steps is a race the moment anything else
        // forks — and something else always does, because `disturb` is called
        // by every rule that writes a block, including the crater above.
        const batch = yield* Ref.modify(state.fallingBlocks, (queue) => {
          const { batch: taken, rest } = takeBatch(queue)
          return [taken, rest] as const
        })

        // An idle tick stops HERE, without touching the store. This is the
        // whole of DN-GP-1: the reference implementation read ~7M blocks at
        // this point whether or not anything had moved. The mob half above is
        // held to the same standard by the same test — an idle frame's sweep
        // returns the roster it was given, hands every mob the SAME step object,
        // and makes no store call at all.
        if (batch.length === 0) {
          return
        }

        const { destinations } = yield* applyFallingBlocks(store, batch)

        // `update`, not `set`: the store writes above may have caused other
        // rules to disturb positions while this tick was running, and a `set`
        // would erase them.
        if (destinations.length > 0) {
          yield* Ref.update(state.fallingBlocks, (queue) => settled(queue, destinations))
        }
      }),
  },
  {
    id: GAMEPLAY_STAGE_IDS.enderDragon,
    after: [GAMEPLAY_STAGE_IDS.entities],
    run: (dt) =>
      Effect.flatMap(player.dimension, (dimension) =>
        dimension === 'end' ? state.enderDragonEncounter.stage.run(dt) : Effect.void,
      ),
  },
  {
    id: GAMEPLAY_STAGE_IDS.fluids,
    after: [GAMEPLAY_STAGE_IDS.enderDragon],
    run: () => {
      const runtime = fluidRuntimeStateFor(state.fluidFrontier)
      return fluidRuntimeSemaphoreFor(state.fluidFrontier).withPermits(1)(
        Effect.gen(function* () {
          const tick = yield* Ref.updateAndGet(state.tickCount, (value) => value + 1)
          const lavaTickActive = tick % LAVA_TICK_INTERVAL === 0
          const work = yield* Ref.modify(runtime, (fluidState) => {
            let uniqueFrontier: ReadonlyArray<FluidWorkItem> = []
            for (const item of fluidState.frontier) {
              uniqueFrontier = enqueueFluidDisturbance(uniqueFrontier, item)
            }
            const split = splitBudget(uniqueFrontier, { lavaTickActive })
            return [
              split.work,
              {
                ...fluidState,
                // Reserve work before any asynchronous store access. New
                // disturbances can still append to the remaining frontier.
                frontier: carryOver(uniqueFrontier, split),
              },
            ] as const
          })

          if (work.length === 0) return

          const dimension = yield* player.dimension
          yield* runFluidPropagation(store, runtime, work, dimension)
        }),
      )
    },
  },
  {
    id: GAMEPLAY_STAGE_IDS.timeWeather,
    after: [GAMEPLAY_STAGE_IDS.fluids],
    // NO LONGER EMPTY, and the half that filled it is the half that was always
    // this repository's.
    //
    // ADVANCING THE CLOCK IS STILL mc-sim's: `TimeService.advance(dt)` over
    // `mc-sim/domain/time-of-day.ts`, which owns the absolute tick counter, the
    // day-length denominator, the `setDayLength -> setTimeOfDay` ordering rule
    // and the value that reaches the save file. This stage held a second copy of
    // that state until it was deleted; see the module header. mc-sim registers
    // its advance inside `sim:physics` rather than a `sim:time-weather`, for a
    // reason that repository documents at length: two stages in one phase are
    // ordered lexicographically, `gameplay:` sorts before `sim:`, and this stage
    // would read an hour the frame had not yet advanced. So by the time this
    // runs, `timeOfDay` is this frame's.
    //
    // WEATHER IS THE PART THAT IS HERE. `domain/weather.ts` holds the rule and
    // holds nothing else; this stage reads the hour's weather out of an inbox,
    // asks the rule what it becomes, and puts the answer in an outbox for
    // whoever owns persistence. See the module header on why weather gets an
    // inbox/outbox pair rather than the `Ref` its countdown looks like it wants.
    //
    // WHAT IS STILL NOT HERE: the CONSEQUENCES that need a service to write to.
    // `weatherLightScale` is mc-render's to read, and the thunderstorm hazard is
    // damage applied to a player whose health is mc-sim's `PlayerService` — the
    // same boundary that keeps `mobXpReward` written and uncalled. Gating
    // hostile spawns on the hour is NOT on that list and never was: it already
    // happens, in `gameplay:entities` above, where the search is.
    run: (dt) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state.weather)
        const weatherGameplayInput = yield* Ref.get(state.weatherGameplayInput)
        const weatherGameplayState = yield* Ref.get(state.weatherGameplay)
        const tick = yield* Ref.get(state.tickCount)
        const weatherGameplayStep = advanceWeatherGameplay(
          weatherGameplayState,
          tick,
          current.weather,
          weatherGameplayInput,
        )
        yield* Ref.set(state.weatherGameplay, weatherGameplayStep.state)
        if (weatherGameplayStep.events.length > 0) {
          yield* Ref.update(state.weatherGameplayEvents, (events) => [
            ...events,
            ...weatherGameplayStep.events,
          ])
        }

        // THE ROLLS ARE DRAWN ONLY WHEN THE STRETCH RUNS OUT, which is
        // `domain/frame-rolls.ts`'s rule that the sequence depend on what
        // happened rather than on how many frames passed — the same discipline
        // the spawn search's cadence follows two stages up. A frame that only
        // decrements a countdown leaves the generator exactly where it found it,
        // so a scenario that runs ten thousand clear frames and then rains draws
        // the same two numbers as one that rains immediately.
        //
        // `weatherExpires` is asked here rather than inside `advanceWeather`
        // because only the caller can decide not to draw; the rule is total
        // either way and ignores the rolls it does not need.
        const next = weatherExpires(current, dt)
          ? yield* Ref.modify(state.rollSeed, (seed) => {
              const batch = drawRolls(seed, WEATHER_TRANSITION_ROLLS)
              return [
                advanceWeather(current, dt, {
                  transition: rollAt(batch, 0),
                  duration: rollAt(batch, 1),
                }),
                batch.seed,
              ] as const
            })
          : advanceWeather(current, dt, LOWEST_WEATHER_ROLLS)

        // `set` and not `update`: the outbox is a countdown and its last value
        // subsumes every earlier one, so a host that drains every other frame
        // loses nothing. Unlike append-only event outboxes, only the newest
        // countdown value matters.
        yield* Ref.set(state.weatherAdvanced, next)
      }),
  },
]

/**
 * Build the module's state and its stages together.
 *
 * This is exactly `GameModule.frameStages` — see `gameplayModule` below. The two
 * services in the context are the whole reason that field is an Effect: this is
 * the one moment at which a module may acquire a service in order to BUILD a
 * stage, rather than in order to run one.
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
  ChunkStore | EntityManager | InventoryService | PlayerService | TimeService
> = Effect.gen(function* () {
  const store = yield* ChunkStore
  const roster = yield* entityManagerTag<MobBehaviour>()
  const inventory = yield* InventoryService
  const player = yield* PlayerService
  const time = yield* TimeService
  const state = yield* makeGameplayFrameState

  return gameplayStages(state, store, roster, inventory, player, time)
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
 * `RRegister` is now `ChunkStore | EntityManager | InventoryService |
 * PlayerService | TimeService` and `RIn`
 * is still `never`, which is the distinction that parameter was added for: this
 * repository needs mc-worldgen's store in order to REGISTER stages that write
 * blocks, mc-sim's roster in order to register the stage that iterates mobs and
 * mc-sim's inventory in order to register the stage that mines, and needs
 * nothing at all in order to build a Layer it does not have.
 *
 * The union growing to five services is the shape `RRegister`
 * predicted and is not a widening of anything a consumer relies on: `RIn` is
 * untouched, so mx-gameplay still BUILDS nothing another repository has to
 * supply. What it does mean is that a host which was providing only the store
 * and the roster now fails to compile, which is the correct failure — the
 * alternative is a stage that deposits into an inventory nobody built.
 *
 * A host supplies mc-sim's entity, inventory, player, and time layers. The
 * latter three have no behaviour type parameter, so the `MobBehaviour` hazard
 * does not repeat. The host's line is
 *
 *     Layer.mergeAll(
 *       simModule.layers,
 *       EntityManagerLayer<MobBehaviour>(undefined, repairMobBehaviour),
 *       InventoryServiceLayer(),
 *     )
 */
export const gameplayModule: GameModule<
  never,
  never,
 never,
  ChunkStore | EntityManager | InventoryService | PlayerService | TimeService
> = {
  layers: Layer.empty,
  frameStages: makeGameplayStages,
}
