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
  requestBlockBreak,
  candidateForPlayerStorageItemUse,
  EnderPearlOutcomeSchema,
  disturb,
  drawRolls,
  firePositionKey,
  furnaceAdvanceChanged,
  gameplayPlayerStateForStage,
  recordGameplayStageFailure,
  recordGameplayUnsupportedOperation,
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
import { EntityHealthPoints, PositionAxis } from '@nerima-games/mc-kernel'
import { position as kernelPosition } from '@nerima-games/mc-kernel'
import type { BlockId } from '@nerima-games/mc-kernel'
import { Option, Result } from 'effect'
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
} from '@nerima-games/mc-sim'
import type { BlockPosition, Dimension } from '@nerima-games/mc-kernel'
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
  BowShotRequest,
  DroppedItemSpawn,
  GameplayStageContext,
  BrewingItemUseResult,
  IgnitionItemType,
  ItemUseRequest,
  ItemUseResult,
  FishingItemUseRequest,
  MeleeAttackRequest,
  PendingBlockBreakRequest,
  PlacementRequest,
  StageRegistration,
  VillagerTradeRequest,
  EnderPearlThrowRequest,
  BlockPlacementCommand,
} from './registration-core.js'

import {
  AIR_BLOCK_ID,
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
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  launchProjectile,
  mergeWorldCommitPlans,
  addStoredStack,
  type WorldCommitPlanFragment,
  CropSnapshotSchema,
  advanceCrop,
  advanceCropByBoneMeal,
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
} from '@nerima-games/mc-sim'
import { Schema } from 'effect'
import {
  applyStatusEffect,
  SPEED_MOVEMENT_MULTIPLIER,
  StatusEffectStateSchema,
} from '../domain/status-effect.js'
import { applyBoneMeal } from '../domain/interactions/bone-meal.js'
import { cropDrops } from '../domain/interactions/crop-drops.js'
import { resolveFoodUse } from '../domain/interactions/eat-food.js'
import { plantingVerdict, cropCellAbove } from '../domain/interactions/plant-crop.js'
import { TILLED_BLOCK, tillingVerdict, cellAbove } from '../domain/interactions/till-soil.js'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../domain/entities/xp-orb.js'
import {
  GameplayEntityRosterSchema,
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
import { meleeTarget } from '../domain/interactions/melee-attack.js'
import { knockbackDirection } from '../domain/interactions/knockback.js'
import {
  ENDER_PEARL_DAMAGE,
  enderPearlDisplacement,
  shouldSpawnEndermite,
} from '../domain/interactions/throw-ender-pearl.js'
import {
  ENDERMITE_KIND,
  ENDERMITE_MAX_HEALTH,
  experienceOfCasualties,
  initialBehaviourOfKind,
  planMobDamageRoster,
  rollCasualtyDrops,
  type MobKillCredit,
} from '../domain/entities/mob-frame.js'
import type { Damage } from '../domain/death-cause.js'
import { solidityFromStore } from '../domain/in-memory-world.js'

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

// Callers hold schema-decoded item types, and every registered item admits a stack of one.
const singleItemStack = (item: Parameters<typeof itemStack>[0]) =>
  Result.getOrThrow(itemStack(item, StackCount(1)))

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
    killCredit?: Exclude<MobKillCredit, 'player-triggered-tnt'>
  }> | undefined,
  storageCandidate?: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  event?: Schema.Schema.Type<typeof DomainEventSchema>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const ownerId = Option.getOrThrow(Option.fromNullishOr(context.entitiesOwnerId))
    const tick = Schema.decodeUnknownSync(SimulationTickSchema)(yield* Ref.get(state.tickCount))
    const damage = planMobDamageRoster(
      entitySnapshot.state,
      hit === undefined ? [] : [{
        id: hit.id,
        damage: hit.damage,
        ...(hit.killCredit === undefined ? {} : { killCredit: hit.killCredit, lastHitTick: tick }),
      }],
      tick,
    )
    const roster = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(restoreGameplayEntityMetadata(
      damage.roster,
      entitySnapshot.state,
      dimension,
    ))

    const seed = yield* Ref.get(state.rollSeed)
    const drops = rollCasualtyDrops(damage.casualties, seed)
    const experience = experienceOfCasualties(damage.casualties)
    const changes: Array<ReplicatedOwnerCandidate> = []
    if (damage.roster !== entitySnapshot.state) {
      changes.push({ ownerId, state: roster })
    }
    if (storageCandidate !== undefined && context.playerStorageOwnerId !== undefined) {
      changes.push({ ownerId: context.playerStorageOwnerId, state: storageCandidate })
    }
    if (drops.drops.length > 0) {
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
        drops.drops.map(({ item, count, at }) => ({ item, count, at })),
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
    if (damage.casualties.length > 0) yield* Ref.set(state.rollSeed, drops.seed)
    if (drops.drops.length > 0) {
      yield* Ref.update(state.mobDrops, (pending) => [...pending, ...drops.drops])
    }
    if (experience.length > 0) {
      yield* Ref.update(state.mobExperience, (pending) => [...pending, ...experience])
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
    if (context.entitiesOwnerId === undefined || context.playerOwnerId === undefined ||
      (request.inventory.mode === 'survival' && context.playerStorageOwnerId === undefined)) {
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

    const target = shotTargetWithCandidate(
      entities.success.state.entities,
      request.origin,
      {
        x: request.dirX,
        y: request.dirY,
        z: request.dirZ,
      },
    )
    let hit: Readonly<{ id: import('@nerima-games/mc-kernel').EntityId; damage: Damage }> | undefined
    let knockback: ReturnType<typeof knockbackDirection> | undefined
    if (target !== undefined) {
      const aimLength = Math.hypot(request.dirX, request.dirY, request.dirZ)
      const end = kernelPosition(
        PositionAxis(request.origin.x + request.dirX / aimLength * target.hit.distance),
        PositionAxis(request.origin.y + request.dirY / aimLength * target.hit.distance),
        PositionAxis(request.origin.z + request.dirZ / aimLength * target.hit.distance),
      )
      const isBlockedAt = solidityFromStore(store)
      if (!shotBlockedByTerrain((x, y, z) => isBlockedAt({ x, y, z }), request.origin, end)) {
        const amount = DamageAmount.result(bowDamage(
          bowCharge(request.chargeSecs),
          request.powerLevel === undefined ? {} : { powerLevel: request.powerLevel },
        ))
        if (Result.isFailure(amount)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: amount.failure,
          })
          yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
          return
        }
        hit = { id: target.hit.id, damage: { amount: amount.success, cause: 'projectile' } }
        const pose = player.success.state.pose.feetPosition
        knockback = knockbackDirection(
          target.candidate.feetPosition.x - pose.x,
          target.candidate.feetPosition.z - pose.z,
        )
      }
    }

    let storageCandidate: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema> | undefined
    if (request.inventory.mode === 'survival') {
      const storage = yield* Effect.result(context.coordinator.snapshot(
        context.playerStorageOwnerId!, PlayerStorageSnapshotSchema,
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
      const consumed = removeInventoryItem(storage.success.state.inventory, 'arrow', 1)
      if (Result.isFailure(consumed) || consumed.success.removed !== 1 ||
        storage.success.state.inventory.slots[request.inventory.slotIndex]?.item !== 'bow') {
        yield* result('InventoryUnavailable')
        return
      }
      const inventory = Result.getOrThrow(withInventory(storage.success.state, consumed.success.inventory))
      const damaged = damagePlayerStorageAt(inventory, {
        _tag: 'Inventory', slotIndex: request.inventory.slotIndex,
      }, 1)
      storageCandidate = damaged.storage
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
    )
    if (!committed) {
      yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
      return
    }
    if (hit !== undefined && knockback !== undefined) {
      yield* Ref.update(state.bowKnockbacks, (pending) => [...pending, { id: hit.id, direction: knockback! }])
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
): Effect.Effect<void> =>
  Effect.gen(function* () {
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
    if (context === undefined || context.entitiesOwnerId === undefined || context.playerOwnerId === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'MeleeAttack',
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        reason: context === undefined ? 'WorldCommitCoordinatorUnavailable' : 'OwnerRegistrationUnavailable',
      })
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
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
    const target = meleeTarget(entities.success.state.entities, request)
    if (target === undefined) {
      if (request.requestId !== undefined) {
        const result: import('./registration-core.js').GameplayMeleeAttackResult = {
          requestId: request.requestId,
          success: false,
        }
        yield* Ref.update(state.meleeAttackResults, (results) => [...results, result])
      }
      return
    }
    const amount = DamageAmount.result(request.damage)
    if (Result.isFailure(amount)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: amount.failure,
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
    const tick = yield* Ref.get(state.tickCount)
    const targetEntity = Option.getOrThrow(Option.fromNullishOr(
      entities.success.state.entities.find(({ id }) => id === target.id),
    ))
    const targetPosition = Schema.decodeUnknownSync(WorldPositionSchema)({
      dimension: player.success.state.pose.feetPosition.dimension,
      x: targetEntity.feetPosition.x,
      y: targetEntity.feetPosition.y,
      z: targetEntity.feetPosition.z,
    })
    const event = Schema.decodeUnknownSync(DomainEventSchema)({
      _tag: 'EntityDamaged', tick, entity: target.id,
      position: targetPosition, amount: amount.success, cause: 'mob',
    })
    const committed = yield* commitMobDamage(
      state,
      context,
      entities.success,
      player.success.state.pose.feetPosition.dimension,
      {
        id: target.id,
        damage: { amount: amount.success, cause: 'mob' },
        killCredit: 'player',
      },
      undefined,
      event,
    )
    if (!committed) {
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    if (request.requestId !== undefined) {
      const result: import('./registration-core.js').GameplayMeleeAttackResult = {
        requestId: request.requestId,
        success: true,
        target,
      }
      yield* Ref.update(state.meleeAttackResults, (results) => [...results, result])
    }
  })

const advanceCropLifecycle = (
  state: GameplayStageContext['state'],
  commit: GameplayStageContext['commit'],
  dt: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (commit === undefined || commit.cropOwnerId === undefined || dt === 0) return
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
    const crops = snapshot.success.state.crops.map((crop) => advanceCrop(crop, dt))
    if (crops.every((crop, index) => crop.growthSecs === snapshot.success.state.crops[index]?.growthSecs)) return
    const candidate = cropCandidate(commit.cropOwnerId, crops)
    const committed = yield* Effect.result(commit.coordinator.commit({
      expectedRevision: snapshot.success.revision,
      expectedDimensions: [],
      changes: [candidate],
    }))
    if (Result.isFailure(committed)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'WorldCommit',
        subject: 'ItemUse',
        error: committed.failure,
      })
    }
  })

const commitPlanFragments = (
  state: GameplayStageContext['state'],
  context: NonNullable<GameplayStageContext['commit']>,
  subject: 'Fishing' | 'Brewing',
  plans: ReadonlyArray<WorldCommitPlanFragment<unknown>>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const merged = mergeWorldCommitPlans(plans)
    if (Result.isFailure(merged)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'PlanBuild',
        subject,
        error: merged.failure,
      })
      return false
    }
    const events = plans.flatMap((plan) => plan.postCommitEvents)
    if (events.length > 0 && context.eventBus === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported',
        action: subject === 'Fishing' ? 'Fishing' : 'CollectBrewingBottle',
        reason: 'OwnerRegistrationUnavailable',
      })
      return false
    }
    const committed = yield* Effect.result(context.coordinator.commit(merged.success))
    if (Result.isFailure(committed)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'WorldCommit',
        subject,
        error: committed.failure,
      })
      return false
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
    return true
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

    let plans: Array<WorldCommitPlanFragment<unknown>> = []
    let outcome: import('@nerima-games/mc-sim').FishingProgressOutcome |
      import('@nerima-games/mc-sim').FishingCancelOutcome |
      import('@nerima-games/mc-sim').FishingReelOutcome |
      undefined
    let nextSeed: number | undefined
    let projectilePlan: WorldCommitPlanFragment<unknown> | undefined
    const activeRod = snapshot.state.rods.find((rod) => rod.actor === request.actor)
    let removeBobber: import('@nerima-games/mc-kernel').ProjectileId | undefined
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
    } else if (request.action === 'AdvanceFishing') {
        const intent = {
          actor: request.actor,
          elapsedTicks: request.elapsedTicks,
          waitTicks: request.waitTicks,
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
        const batch = drawRolls(seed, 1)
        const sample = Schema.decodeUnknownSync(FishingLootSampleSchema)(rollAt(batch, 0))
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
        if (reel.success.result._tag === 'Caught') {
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
          const caughtStack = singleItemStack(reel.success.result.item)
          const stored = addStoredStack(storageObserved.success.state, {
            ...caughtStack,
            durability: null,
          })
          if (stored.result._tag !== 'Added' || stored.result.added !== 1) {
            yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
            return
          }
          const storageSnapshot = {
            world: storageObserved.success.world,
            expectedRevision: storageObserved.success.revision,
            expectedDimensions: [],
            state: storageObserved.success.state,
          }
          const storagePlan = {
            world: storageSnapshot.world,
            expectedRevision: storageSnapshot.expectedRevision,
            expectedDimensions: storageSnapshot.expectedDimensions,
            changes: [{ ownerId: context.playerStorageOwnerId, state: stored.storage }],
            result: undefined,
            postCommitEvents: [],
          }
          plans.push(storagePlan)
        }
        nextSeed = batch.seed
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
    if (!(yield* commitPlanFragments(state, context, 'Fishing', plans))) {
      yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
      return
    }
    if (nextSeed !== undefined) yield* Ref.set(state.rollSeed, nextSeed)
    yield* Ref.update(state.itemUseResults, (results) => [...results, result])
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
    if (!(yield* commitPlanFragments(state, context, 'Brewing', [bottlePlan.success, storagePlan]))) {
      yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
      return
    }
    yield* Ref.update(state.itemUseResults, (results) => [...results, result])
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
      let statusCandidate: Schema.Schema.Type<typeof StatusEffectStateSchema> | undefined
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
          StatusEffectStateSchema,
          [],
        ))
        if (Result.isFailure(observedEffects)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing', error: observedEffects.failure,
          })
          return
        }
        const nextEffects = applyStatusEffect(observedEffects.success.state, drinkPlan.result.effect)
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
      if (!(yield* commitPlanFragments(state, context, 'Brewing', plans))) {
        yield* retry()
        return
      }
      if (statusCandidate !== undefined) {
        yield* Ref.set(state.playerMovementSpeedMultiplier,
          statusCandidate.effects.some((effect) => effect.type === 'speed')
            ? SPEED_MOVEMENT_MULTIPLIER
            : 1,
        )
      }
      yield* Ref.update(state.itemUseResults, (results) => [...results, result])
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
    if (!(yield* commitPlanFragments(state, context, 'Brewing', fragments))) {
      yield* retry()
      return
    }
    yield* Ref.update(state.itemUseResults, (results) => [...results, result])
  })

const processPlacement = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  store: GameplayStageContext['store'],
  playerState: Schema.Schema.Type<typeof PlayerServiceSnapshotSchema> | undefined,
  playerDead: boolean,
  request: PlacementRequest | BlockPlacementCommand,
  disturbed: Array<BlockPositionKey>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const command = 'requestId' in request ? request : undefined
    const execute = (): Effect.Effect<import('./registration-core.js').BlockPlacementResult> =>
      Effect.gen(function* () {
        const unsupported = (
          reason: 'WorldCommitCoordinatorUnavailable' | 'OwnerRegistrationUnavailable',
        ): import('./registration-core.js').BlockPlacementResult => ({
          requestId: command?.requestId ?? '',
          success: false,
          consumed: false,
          replayed: false,
          outcome: { _tag: 'Unsupported', reason },
        })
        if (playerDead) {
          return {
            requestId: command?.requestId ?? '',
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
        const position = yield* blockPositionForKey(request.positionKey)
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
            requestId: command?.requestId ?? '', success: false, consumed: false, replayed: false,
            outcome: { _tag: 'CommitFailed', error: observed.failure },
          }
        }

        const planned = yield* planPlaceBlock(store, {
          position,
          heldItem: request.heldItem,
          playerFeet: kernelPosition(
            PositionAxis(playerState.pose.feetPosition.x),
            PositionAxis(playerState.pose.feetPosition.y),
            PositionAxis(playerState.pose.feetPosition.z),
          ),
        })
        if (planned.outcome._tag !== 'Placed') {
          return {
            requestId: command?.requestId ?? '',
            success: false,
            consumed: false,
            replayed: false,
            outcome: planned.outcome,
          }
        }

        const mode = command?.mode ?? 'survival'
        let storageCandidate: ReplicatedOwnerCandidate | undefined
        if (mode === 'survival') {
          const slotIndex = observed.success.state.inventory.slots.findIndex(
            (slot) => slot?.item === request.heldItem,
          )
          if (slotIndex < 0) {
            return {
              requestId: command?.requestId ?? '',
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
            requestId: command?.requestId ?? '',
            success: false,
            consumed: false,
            replayed: false,
            outcome: { _tag: 'CommitFailed', error: committed.failure },
          }
        }
        for (const edit of planned.edits) {
          // A successful coordinator commit cannot have a negative edit Y, so stepping down stays safe.
          const below = Result.getOrThrow(adjacentBlockPosition(edit.position, 'down'))
          disturbed.push(blockPositionKeyOf(below))
        }
        if (storageCandidate !== undefined) {
          yield* Ref.update(state.consumedItems, (items) => [...items, request.heldItem])
        }
        return {
          requestId: command?.requestId ?? '',
          success: true,
          consumed: storageCandidate !== undefined,
          replayed: false,
          outcome: planned.outcome,
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
    const roll = drawRolls(seed, 1)
    const spawnEndermite = shouldSpawnEndermite(rollAt(roll, 0))
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
      changes.push({
        ownerId: entitiesOwnerId,
        state: Schema.decodeUnknownSync(GameplayEntityRosterSchema)(restoreGameplayEntityMetadata(
          spawned.success.roster,
          entities.success.state,
          currentPose.feetPosition.dimension,
        )),
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
    yield* Ref.set(state.rollSeed, roll.seed)
    yield* Ref.update(state.enderPearlOutcomes, (outcomes) => [...outcomes, outcome])
  })

export const makeInteractionsStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, commit } = context
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
        const playerState = yield* gameplayPlayerStateForStage(state, commit)
        const portalTravel = commit !== undefined && playerState !== undefined
          ? { commit, playerState }
          : undefined
        if (commit !== undefined && playerState === undefined) {
          const placements = yield* Ref.getAndSet<ReadonlyArray<PlacementRequest | BlockPlacementCommand>>(
            state.pendingPlacements,
            [],
          )
          const disturbed: Array<BlockPositionKey> = []
          for (const request of placements) {
            yield* processPlacement(state, commit, store, playerState, playerDead, request, disturbed)
          }
          return
        }

        yield* advanceCropLifecycle(state, commit, dt)

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
        ) => {
          const batch = drawRolls(seed, BLOCK_LOOT_ROLLS)
          return {
            seed: batch.seed,
            drops: blockLoot(yielded, tool, batch.rolls).map((item) => ({
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
          if (playerDead) continue
          const request = snapshots.get(index)
          const tool = request?.lootContext ?? batchHeldTool
          const breakPosition = yield* blockPositionForKey(positionKey)
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
              const seed = yield* Ref.get(state.rollSeed)
              const plannedLoot = plannedDropsForBrokenBlock(seed, plan.yielded, tool, breakPosition)
              const drops = plannedLoot.drops
              let candidate: PlayerStorage = plan.candidateStorage
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
              for (const removed of plan.removed) {
                disturbed.push(blockPositionKeyOf(removed))
              }
            } else {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed',
                operation: 'CandidateBuild',
                subject: 'Mining',
                error: plan.failure,
              })
              if (plan.failure._tag === 'ObservationChanged') {
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
          const position = yield* blockPositionForKey(request.positionKey)
          const outcome = resolveBlockUse(position, yield* store.getBlock(position))
          blockUseResults.push({
            requestId: request.requestId,
            success: isSuccessfulBlockUse(outcome),
            outcome,
          })
        }

        for (const request of placements) {
          yield* processPlacement(state, commit, store, playerState, playerDead, request, disturbed)
        }

        // ITEM USES ARE SERVICED LAST, after breaks and placements, and the
        // order is the same decision the break-before-place one is: a player who
        // builds the last block of an obsidian frame and lights it in the same
        // frame gets the sequence they asked for. The other order asks
        // `detectNetherPortal` about a ring that is one block short.
        itemUseRequests: for (const [itemUseIndex, request] of itemUses.entries()) {
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
                const position = yield* blockPositionForKey(request.positionKey)
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
                const reading = observed.success.blocks[0]?.reading
                const blockType = reading?._tag === 'Block'
                  ? Result.getOrUndefined(blockTypeOfId(reading.block))
                  : undefined
                const outcome = yield* applyBoneMeal(
                  () => Effect.succeed(blockType),
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
                if (crop === undefined || crop.crop !== blockType) {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    heldItem: request.heldItem,
                    success: false,
                    consumedCount: 0,
                    outcome: {
                      _tag: 'cropOwnerMismatch',
                      at: position,
                      block: blockType,
                      registeredCrop: crop?.crop,
                    },
                  })
                  break itemUseAction
                }
                const candidate = candidateForPlayerStorageItemUse(
                  commit.playerStorageOwnerId,
                  observed.success.state,
                  request.heldItem,
                  'consume',
                )
                const nextCrops = cropSnapshot.success.state.crops.map((entry) =>
                  entry === crop ? advanceCropByBoneMeal(entry) : entry,
                )
                const cropChange = cropCandidate(commit.cropOwnerId, nextCrops)
                const success = candidate !== undefined
                if (success) {
                  const committed = yield* Effect.result(commit.coordinator.commit({
                    expectedRevision: observed.success.revision,
                    expectedDimensions: [],
                    changes: [candidate, cropChange],
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
              else if (request.action === 'TillSoil') {
                const ground = yield* blockPositionForKey(request.positionKey)
                const above = Result.getOrUndefined(cellAbove(ground))
                if (commit === undefined || above === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'TillSoil',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
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
                const groundRead = observed.success.blocks[0]?.reading
                const aboveRead = observed.success.blocks[1]?.reading
                const groundBlock = groundRead?._tag === 'Block'
                  ? Result.getOrUndefined(blockTypeOfId(groundRead.block)) ?? 'air'
                  : 'air'
                const aboveBlock = aboveRead?._tag === 'Block'
                  ? Result.getOrUndefined(blockTypeOfId(aboveRead.block)) ?? 'air'
                  : 'air'
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
                const soil = yield* blockPositionForKey(request.positionKey)
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
                const soilRead = observed.success.blocks[0]?.reading
                const aboveRead = observed.success.blocks[1]?.reading
                const soilBlock = soilRead?._tag === 'Block'
                  ? Result.getOrUndefined(blockTypeOfId(soilRead.block)) ?? 'air'
                  : 'air'
                const aboveBlock = aboveRead?._tag === 'Block'
                  ? Result.getOrUndefined(blockTypeOfId(aboveRead.block)) ?? 'air'
                  : 'air'
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
                const position = yield* blockPositionForKey(request.positionKey)
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
                const reading = observed.success.blocks[0]?.reading
                const cropType = reading?._tag === 'Block'
                  ? Result.getOrUndefined(blockTypeOfId(reading.block)) ?? 'air'
                  : 'air'
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
                const outcome = resolveFoodUse({
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
                  finalOutcome: typeof outcome | { readonly _tag: 'missingItem' },
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
                    StatusEffectStateSchema,
                  ))
                  if (Result.isFailure(statusEffectsSnapshot)) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'OwnerSnapshot',
                      subject: 'ItemUse',
                      error: statusEffectsSnapshot.failure,
                    })
                    break itemUseAction
                  }
                  if (statusEffectsSnapshot.success.revision !== storageSnapshot.success.revision) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'OwnerSnapshot',
                      subject: 'ItemUse',
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
                    nextStatusEffects = applyStatusEffect(nextStatusEffects, effect)
                  }
                  statusEffectCandidate = {
                    ownerId: statusEffectsOwnerId,
                    state: nextStatusEffects,
                  }
                }
                const nutrition = Result.getOrThrow(FoodNutrition.result(outcome.foodPoints))
                const saturation = Result.getOrThrow(SaturationModifier.result(outcome.saturationModifier))
                const nextVitals = eatVitals(vitals, nutrition, saturation)
                const validatedVitals = Schema.decodeUnknownSync(ExperienceOrbVitalsOwnerSnapshotSchema)({
                  vitals: nextVitals,
                })
                const committed = yield* Effect.result(commit.coordinator.commit({
                  expectedRevision: storageSnapshot.success.revision,
                  expectedDimensions: [],
                  changes: [
                    storageCandidate,
                    {
                      ownerId: commit.vitalsOwnerId,
                      state: validatedVitals,
                    },
                    ...(statusEffectCandidate === undefined ? [] : [statusEffectCandidate]),
                  ],
                }))
                if (Result.isFailure(committed)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'WorldCommit',
                    subject: 'Vitals',
                    error: committed.failure,
                  })
                  yield* requeueItemUsesFrom(itemUseIndex)
                  break itemUseRequests
                }
                publishFoodResult(true, 1, outcome)
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
                const position = yield* blockPositionForKey(request.positionKey)
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
          const ignitionPosition = yield* blockPositionForKey(request.positionKey)
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
      }).pipe(Effect.orDie),
  }
}
