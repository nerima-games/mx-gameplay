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
  candidateForItemUse,
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
  requestStatusEffect,
  isSuccessfulBlockUse,
  NO_TOOL,
  planFurnaceAdvance,
  processBlockPlacementCommand,
  resolveBlockUse,
  stepPortalTravel,
  stepStatusEffects,
  useBucket,
  useFlintAndSteel,
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
import type { BlockPosition } from '@nerima-games/mc-kernel'
import { planBreakBlock } from '../domain/interactions/break-block.js'
import { TNT_BLOCK_ID } from '../domain/interactions/ignite-tnt.js'
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
  BlockAddressSchema,
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
  BrewingServicePlanSnapshotSchema,
  BrewingBottleIndexSchema,
  PotionDrinkInventorySnapshotSchema,
  PotionDrinkIntentSchema,
  PotionDrinkSlotIndexSchema,
  PotionDrinkPlanSchema,
  PotionDrinkFailureSchema,
  BREWING_FUEL_ITEM,
  BREWING_MAX_FUEL_CHARGES,
  FishingStateSchema,
  FishingServicePlanSnapshotSchema,
  FishingAdvanceIntentSchema,
  FishingCancelIntentSchema,
  FishingReelIntentSchema,
  FishingAdvancePlanSchema,
  FishingCancelPlanSchema,
  FishingServiceCastSuccessSchema,
  FishingServiceReelSuccessSchema,
  FishingLootSampleSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  launchProjectile,
  mergeWorldCommitPlans,
  WorldCommitPlanMergeResultSchema,
  WorldCommitPlanRequestSchema,
  worldCommitPlanFragmentSchema,
  worldCommitPlanSnapshotSchema,
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
  GameplayVillagerTradeSnapshotSchema,
} from './gameplay-owner-registrations.js'
import { useVillagerOffer } from '../domain/villager-trade.js'
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
): Result.Result<ReplicatedOwnerCandidate, Schema.SchemaError> =>
  Result.map(
    Schema.decodeUnknownResult(CropSnapshotSchema)({ crops }),
    (state) => ({ ownerId, state }),
  )

const commitMobDamage = (
  state: GameplayStageContext['state'],
  context: NonNullable<GameplayStageContext['commit']>,
  entitySnapshot: Readonly<{
    revision: WorldWriteBatch['expectedWorldRevision']
    state: Schema.Schema.Type<typeof GameplayEntityRosterSchema>
  }>,
  hit: Readonly<{ id: import('@nerima-games/mc-kernel').EntityId; damage: Damage }> | undefined,
  storageCandidate?: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  event?: Schema.Schema.Type<typeof DomainEventSchema>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const ownerId = context.entitiesOwnerId
    if (ownerId === undefined) return false
    const damage = planMobDamageRoster(
      entitySnapshot.state,
      hit === undefined ? [] : [{ id: hit.id, damage: hit.damage }],
    )
    const roster = Schema.decodeUnknownResult(GameplayEntityRosterSchema)(damage.roster)
    if (Result.isFailure(roster)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: roster.failure,
      })
      return false
    }

    const seed = yield* Ref.get(state.rollSeed)
    const drops = rollCasualtyDrops(damage.casualties, seed)
    const experience = experienceOfCasualties(damage.casualties)
    const changes: Array<ReplicatedOwnerCandidate> = []
    if (damage.roster !== entitySnapshot.state) {
      changes.push({ ownerId, state: roster.success })
    }
    if (storageCandidate !== undefined && context.playerStorageOwnerId !== undefined) {
      const storage = Schema.decodeUnknownResult(PlayerStorageSnapshotSchema)(storageCandidate)
      if (Result.isFailure(storage)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: storage.failure,
        })
        return false
      }
      changes.push({ ownerId: context.playerStorageOwnerId, state: storage.success })
    }
    if (drops.drops.length > 0) {
      if (context.droppedItemsOwnerId === undefined) {
        yield* recordGameplayUnsupportedOperation(state, {
          _tag: 'Unsupported', action: 'MobDrop', reason: 'OwnerRegistrationUnavailable',
        })
        return false
      }
      const droppedSnapshot = yield* Effect.result(context.coordinator.snapshot(
        context.droppedItemsOwnerId,
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
      const appended = appendDroppedItemSpawns(
        droppedSnapshot.success.state,
        drops.drops.map(({ item, count, at }) => ({ item, count, at })),
        entitySnapshot.revision,
      )
      if (Result.isFailure(appended)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse', error: appended.failure,
        })
        return false
      }
      changes.push({ ownerId: context.droppedItemsOwnerId, state: appended.success })
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
      const result: import('./registration-core.js').BowShotResult = outcome === 'Fired'
        ? { requestId: request.requestId, success: true, outcome }
        : { requestId: request.requestId, success: false, outcome }
      return Ref.update(state.bowShotResults, (results) => [...results, result])
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
      request.dirX,
      request.dirY,
      request.dirZ,
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
      const inventory = withInventory(storage.success.state, consumed.success.inventory)
      if (Result.isFailure(inventory)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: inventory.failure,
        })
        yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
        return
      }
      const damaged = damagePlayerStorageAt(inventory.success, {
        _tag: 'Inventory', slotIndex: request.inventory.slotIndex,
      }, 1)
      if (damaged.result._tag !== 'Damaged' && damaged.result._tag !== 'Broken') {
        yield* result('InventoryUnavailable')
        return
      }
      storageCandidate = damaged.storage
    }

    let damageEvent: Schema.Schema.Type<typeof DomainEventSchema> | undefined
    if (hit !== undefined && target !== undefined) {
      const tick = Schema.decodeUnknownResult(SimulationTickSchema)(yield* Ref.get(state.tickCount))
      const position = Schema.decodeUnknownResult(WorldPositionSchema)({
        dimension: player.success.state.pose.feetPosition.dimension,
        x: target.candidate.feetPosition.x,
        y: target.candidate.feetPosition.y,
        z: target.candidate.feetPosition.z,
      })
      const amount = DamageAmount.result(hit.damage.amount)
      if (Result.isFailure(tick)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: tick.failure,
        })
        yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
        return
      }
      if (Result.isFailure(position)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: position.failure,
        })
        yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
        return
      }
      if (Result.isFailure(amount)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: amount.failure,
        })
        yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
        return
      }
      const event = Schema.decodeUnknownResult(DomainEventSchema)({
        _tag: 'EntityDamaged', tick: tick.success, entity: hit.id,
        position: position.success, amount: amount.success, cause: 'projectile',
      })
      if (Result.isFailure(event)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: event.failure,
        })
        yield* Ref.update(state.pendingBowShots, (pending) => [request, ...pending])
        return
      }
      damageEvent = event.success
    }

    const committed = yield* commitMobDamage(
      state,
      context,
      entities.success,
      hit,
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
    const tick = Schema.decodeUnknownResult(SimulationTickSchema)(yield* Ref.get(state.tickCount))
    const targetEntity = entities.success.state.entities.find(({ id }) => id === target.id)
    if (targetEntity === undefined) {
      if (request.requestId !== undefined) {
        const result: import('./registration-core.js').GameplayMeleeAttackResult = {
          requestId: request.requestId,
          success: false,
        }
        yield* Ref.update(state.meleeAttackResults, (results) => [...results, result])
      }
      return
    }
    if (Result.isFailure(tick)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: tick.failure,
      })
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    const targetPosition = Schema.decodeUnknownResult(WorldPositionSchema)({
      dimension: player.success.state.pose.feetPosition.dimension,
      x: targetEntity.feetPosition.x,
      y: targetEntity.feetPosition.y,
      z: targetEntity.feetPosition.z,
    })
    if (Result.isFailure(targetPosition)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: targetPosition.failure,
      })
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    const event = Schema.decodeUnknownResult(DomainEventSchema)({
          _tag: 'EntityDamaged', tick: tick.success, entity: target.id,
          position: targetPosition.success, amount: amount.success, cause: 'mob',
        })
    if (Result.isFailure(event)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: event.failure,
      })
      yield* Ref.update(state.pendingMeleeAttacks, (pending) => [request, ...pending])
      return
    }
    const committed = yield* commitMobDamage(state, context, entities.success, {
      id: target.id,
      damage: { amount: amount.success, cause: 'mob' },
    }, undefined, event.success)
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
    if (Result.isFailure(candidate)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'ItemUse',
        error: candidate.failure,
      })
      return
    }
    const committed = yield* Effect.result(commit.coordinator.commit({
      expectedRevision: snapshot.success.revision,
      expectedDimensions: [],
      changes: [candidate.success],
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
  context: GameplayStageContext['commit'],
  subject: 'Fishing' | 'Brewing',
  plans: ReadonlyArray<WorldCommitPlanFragment<unknown>>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (context === undefined) return false
    const merged = Schema.decodeUnknownResult(WorldCommitPlanMergeResultSchema)(
      mergeWorldCommitPlans(plans),
    )
    if (Result.isFailure(merged)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'PlanBuild',
        subject,
        error: merged.failure,
      })
      return false
    }
    if (Result.isFailure(merged.success)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'PlanBuild',
        subject,
        error: merged.success.failure,
      })
      return false
    }
    const request = Schema.decodeUnknownResult(WorldCommitPlanRequestSchema)(merged.success.success)
    if (Result.isFailure(request)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'PlanBuild',
        subject,
        error: request.failure,
      })
      return false
    }
    const events = plans.flatMap((plan) => plan.postCommitEvents)
    const decodedEvents = events.map((event) => Schema.decodeUnknownResult(DomainEventSchema)(event))
    const invalidEvent = decodedEvents.find(Result.isFailure)
    if (invalidEvent !== undefined && Result.isFailure(invalidEvent)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed',
        operation: 'PlanBuild',
        subject,
        error: invalidEvent.failure,
      })
      return false
    }
    if (events.length > 0 && context.eventBus === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported',
        action: subject === 'Fishing' ? 'Fishing' : 'CollectBrewingBottle',
        reason: 'OwnerRegistrationUnavailable',
      })
      return false
    }
    const committed = yield* Effect.result(context.coordinator.commit(request.success))
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
      for (const event of decodedEvents) {
        if (Result.isFailure(event)) continue
        const published = yield* Effect.result(context.eventBus.publish(event.success))
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
    const snapshot = Schema.decodeUnknownResult(FishingServicePlanSnapshotSchema)({
      world: observed.success.world,
      expectedRevision: observed.success.revision,
      expectedDimensions: [],
      state: observed.success.state,
    })
    if (Result.isFailure(snapshot)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: snapshot.failure,
      })
      return
    }

    let plans: Array<WorldCommitPlanFragment<unknown>> = []
    let outcome: import('@nerima-games/mc-sim').FishingProgressOutcome |
      import('@nerima-games/mc-sim').FishingCancelOutcome |
      import('@nerima-games/mc-sim').FishingReelOutcome |
      undefined
    let nextSeed: number | undefined
    let projectilePlan: WorldCommitPlanFragment<unknown> | undefined
    const activeRod = snapshot.success.state.rods.find((rod) => rod.actor === request.actor)
    let removeBobber: import('@nerima-games/mc-kernel').ProjectileId | undefined
    switch (request.action) {
      case 'CastFishing': {
        const tick = Schema.decodeUnknownResult(SimulationTickSchema)(request.tick)
        if (Result.isFailure(tick)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: tick.failure,
          })
          return
        }
        const cast = yield* Effect.result(context.fishingService.planCast(snapshot.success, {
          actor: request.actor,
          bobber: request.bobber,
        }))
        if (Result.isFailure(cast)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: cast.failure,
          })
          return
        }
        const castSchema = worldCommitPlanFragmentSchema(FishingServiceCastSuccessSchema)
        const decodedCast = Schema.decodeUnknownResult(castSchema)(cast.success)
        if (Result.isFailure(decodedCast)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: decodedCast.failure,
          })
          return
        }
        plans = [decodedCast.success]
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
        const projectileSnapshot = Schema.decodeUnknownResult(worldCommitPlanSnapshotSchema(ProjectileServiceSnapshotSchema))({
          world: projectileObserved.success.world,
          expectedRevision: projectileObserved.success.revision,
          expectedDimensions: [],
          state: projectileObserved.success.state,
        })
        if (Result.isFailure(projectileSnapshot)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: projectileSnapshot.failure,
          })
          return
        }
        const projectileFragment = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(Schema.Undefined))({
          world: projectileSnapshot.success.world,
          expectedRevision: projectileSnapshot.success.expectedRevision,
          expectedDimensions: projectileSnapshot.success.expectedDimensions,
          changes: [{ ownerId: projectileOwnerId, state: projectileCandidate.success }],
          result: undefined,
          postCommitEvents: [],
        })
        if (Result.isFailure(projectileFragment)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: projectileFragment.failure,
          })
          return
        }
        projectilePlan = projectileFragment.success
        plans.push(projectilePlan)
        break
      }
      case 'AdvanceFishing': {
        const intent = Schema.decodeUnknownResult(FishingAdvanceIntentSchema)({
          actor: request.actor,
          elapsedTicks: request.elapsedTicks,
          waitTicks: request.waitTicks,
          approachTicks: request.approachTicks,
          biteWindowTicks: request.biteWindowTicks,
          hasWater: request.environment.hasWater,
        })
        if (Result.isFailure(intent)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: intent.failure,
          })
          return
        }
        const advance = yield* Effect.result(context.fishingService.planAdvance(snapshot.success, intent.success))
        if (Result.isFailure(advance)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: advance.failure,
          })
          return
        }
        const decodedAdvance = Schema.decodeUnknownResult(FishingAdvancePlanSchema)(advance.success)
        if (Result.isFailure(decodedAdvance)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: decodedAdvance.failure,
          })
          return
        }
        plans = [decodedAdvance.success]
        outcome = decodedAdvance.success.result
        if (outcome._tag === 'Cancelled') removeBobber = outcome.bobber
        break
      }
      case 'CancelFishing': {
        const intent = Schema.decodeUnknownResult(FishingCancelIntentSchema)({ actor: request.actor })
        if (Result.isFailure(intent)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: intent.failure,
          })
          return
        }
        const cancel = yield* Effect.result(context.fishingService.planCancel(snapshot.success, intent.success))
        if (Result.isFailure(cancel)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: cancel.failure,
          })
          return
        }
        const decodedCancel = Schema.decodeUnknownResult(FishingCancelPlanSchema)(cancel.success)
        if (Result.isFailure(decodedCancel)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: decodedCancel.failure,
          })
          return
        }
        plans = [decodedCancel.success]
        outcome = decodedCancel.success.result
        removeBobber = decodedCancel.success.result.bobber
        break
      }
      case 'ReelFishing': {
        const tick = Schema.decodeUnknownResult(SimulationTickSchema)(yield* Ref.get(state.tickCount))
        if (Result.isFailure(tick)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: tick.failure,
          })
          return
        }
        const seed = yield* Ref.get(state.rollSeed)
        const batch = drawRolls(seed, 1)
        const sample = Schema.decodeUnknownResult(FishingLootSampleSchema)(rollAt(batch, 0))
        if (Result.isFailure(sample)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: sample.failure,
          })
          return
        }
        const intent = Schema.decodeUnknownResult(FishingReelIntentSchema)({
          actor: request.actor,
          tick: tick.success,
          sample: sample.success,
        })
        if (Result.isFailure(intent)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: intent.failure,
          })
          return
        }
        const reel = yield* Effect.result(context.fishingService.planReel(snapshot.success, intent.success))
        if (Result.isFailure(reel)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: reel.failure,
          })
          return
        }
        const decodedReel = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(FishingServiceReelSuccessSchema))(reel.success)
        if (Result.isFailure(decodedReel)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: decodedReel.failure,
          })
          return
        }
        plans = [decodedReel.success]
        outcome = decodedReel.success.result
        removeBobber = activeRod?.bobber
        if (decodedReel.success.result._tag === 'Caught') {
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
          const caughtStack = itemStack(decodedReel.success.result.item, StackCount(1))
          if (Result.isFailure(caughtStack)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'CandidateBuild', subject: 'Fishing', error: caughtStack.failure,
            })
            return
          }
          const stored = addStoredStack(storageObserved.success.state, {
            ...caughtStack.success,
            durability: null,
          })
          if (stored.result._tag !== 'Added' || stored.result.added !== 1) {
            yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
            return
          }
          const storageSnapshot = Schema.decodeUnknownResult(worldCommitPlanSnapshotSchema(PlayerStorageSnapshotSchema))({
            world: storageObserved.success.world,
            expectedRevision: storageObserved.success.revision,
            expectedDimensions: [],
            state: storageObserved.success.state,
          })
          if (Result.isFailure(storageSnapshot)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: storageSnapshot.failure,
            })
            return
          }
          const storagePlan = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(Schema.Undefined))({
            world: storageSnapshot.success.world,
            expectedRevision: storageSnapshot.success.expectedRevision,
            expectedDimensions: storageSnapshot.success.expectedDimensions,
            changes: [{ ownerId: context.playerStorageOwnerId, state: stored.storage }],
            result: undefined,
            postCommitEvents: [],
          })
          if (Result.isFailure(storagePlan)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: storagePlan.failure,
            })
            return
          }
          plans.push(storagePlan.success)
        }
        nextSeed = batch.seed
        break
      }
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
      const candidate = Schema.decodeUnknownResult(ProjectileServiceSnapshotSchema)({ projectiles: after })
      if (Result.isFailure(candidate)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Fishing', error: candidate.failure,
        })
        return
      }
      const projectileSnapshot = Schema.decodeUnknownResult(worldCommitPlanSnapshotSchema(ProjectileServiceSnapshotSchema))({
        world: projectiles.success.world,
        expectedRevision: projectiles.success.revision,
        expectedDimensions: [],
        state: projectiles.success.state,
      })
      if (Result.isFailure(projectileSnapshot)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: projectileSnapshot.failure,
        })
        return
      }
      const fragment = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(Schema.Undefined))({
        world: projectileSnapshot.success.world,
        expectedRevision: projectileSnapshot.success.expectedRevision,
        expectedDimensions: projectileSnapshot.success.expectedDimensions,
        changes: [{ ownerId: projectileOwnerId, state: candidate.success }],
        result: undefined,
        postCommitEvents: [],
      })
      if (Result.isFailure(fragment)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: fragment.failure,
        })
        return
      }
      plans.push(fragment.success)
    }

    const result = Schema.decodeUnknownResult(GameplayFishingItemUseResultSchema)({
      action: request.action,
      requestId: request.requestId,
      success: true,
      outcome,
    })
    if (Result.isFailure(result)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Fishing', error: result.failure,
      })
      return
    }
    if (!(yield* commitPlanFragments(state, context, 'Fishing', plans))) {
      yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
      return
    }
    if (nextSeed !== undefined) yield* Ref.set(state.rollSeed, nextSeed)
    yield* Ref.update(state.itemUseResults, (results) => [...results, result.success])
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
    const bottleIndex = Schema.decodeUnknownResult(BrewingBottleIndexSchema)(request.bottleIndex)
    const address = Schema.decodeUnknownResult(BlockAddressSchema)(request.address)
    const tick = Schema.decodeUnknownResult(SimulationTickSchema)(request.tick)
    if (Result.isFailure(bottleIndex)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: bottleIndex.failure,
      })
      return
    }
    if (Result.isFailure(address)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: address.failure,
      })
      return
    }
    if (Result.isFailure(tick)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: tick.failure,
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
    const brewingSnapshot = Schema.decodeUnknownResult(BrewingServicePlanSnapshotSchema)({
      world: brewingObserved.success.world,
      expectedRevision: brewingObserved.success.revision,
      expectedDimensions: [],
      state: brewingObserved.success.state,
    })
    if (Result.isFailure(brewingSnapshot)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: brewingSnapshot.failure,
      })
      return
    }
    const bottle = brewingSnapshot.success.state.bottles[bottleIndex.success]
    if (bottle === undefined) {
      const emptyResult = Schema.decodeUnknownResult(GameplayBrewingBottleItemUseResultSchema)({
        action: 'CollectBrewingBottle', requestId: request.requestId, success: false,
        outcome: { _tag: 'Empty' },
      })
      if (Result.isFailure(emptyResult)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: emptyResult.failure,
        })
      } else {
        yield* Ref.update(state.itemUseResults, (results) => [...results, emptyResult.success])
      }
      return
    }
    const inserted = addStoredStack(storageObserved.success.state, {
      ...bottle,
      durability: null,
    })
    if (inserted.result._tag === 'InvalidStack' || inserted.result._tag === 'ItemStackFailure') {
      const invalidResult = Schema.decodeUnknownResult(GameplayBrewingBottleItemUseResultSchema)({
        action: 'CollectBrewingBottle', requestId: request.requestId, success: false,
        outcome: { _tag: 'InvalidStack' },
      })
      if (Result.isFailure(invalidResult)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: invalidResult.failure,
        })
      } else {
        yield* Ref.update(state.itemUseResults, (results) => [...results, invalidResult.success])
      }
      return
    }
    if (inserted.result.added === 0) {
      const fullResult = Schema.decodeUnknownResult(GameplayBrewingBottleItemUseResultSchema)({
        action: 'CollectBrewingBottle', requestId: request.requestId, success: false,
        outcome: { _tag: 'InventoryFull', item: bottle.item, count: bottle.count },
      })
      if (Result.isFailure(fullResult)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: fullResult.failure,
        })
      } else {
        yield* Ref.update(state.itemUseResults, (results) => [...results, fullResult.success])
      }
      return
    }
    const pickupCount = StackCount.result(inserted.result.added)
    if (Result.isFailure(pickupCount)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: pickupCount.failure,
      })
      return
    }
    const event = Schema.decodeUnknownResult(DomainEventSchema)({
      _tag: 'ItemPickedUp',
      tick: tick.success,
      actor: request.actor,
      source: { _tag: 'BrewingStand', address: address.success },
      item: itemIdOf(bottle.item),
      count: pickupCount.success,
    })
    if (Result.isFailure(event)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: event.failure,
      })
      return
    }
    const remaining = inserted.result.leftover
    const bottlePlan = yield* Effect.result(context.brewingService.planSetBottle(
      brewingSnapshot.success,
      bottleIndex.success,
      remaining ?? undefined,
    ))
    if (Result.isFailure(bottlePlan)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: bottlePlan.failure,
      })
      return
    }
    const bottlePlanDecoded = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(BrewingServiceStateSchema))(bottlePlan.success)
    if (Result.isFailure(bottlePlanDecoded)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: bottlePlanDecoded.failure,
      })
      return
    }
    const storagePlan = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(Schema.Undefined))({
      world: storageObserved.success.world,
      expectedRevision: storageObserved.success.revision,
      expectedDimensions: [],
      changes: [{ ownerId: context.playerStorageOwnerId, state: inserted.storage }],
      result: undefined,
      postCommitEvents: [event.success],
    })
    if (Result.isFailure(storagePlan)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: storagePlan.failure,
      })
      return
    }
    const result = Schema.decodeUnknownResult(GameplayBrewingBottleItemUseResultSchema)({
      action: 'CollectBrewingBottle', requestId: request.requestId, success: true,
      outcome: {
        _tag: 'Collected',
        item: bottle.item,
        count: inserted.result.added,
        remainingCount: remaining?.count ?? 0,
      },
    })
    if (Result.isFailure(result)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: result.failure,
      })
      return
    }
    if (!(yield* commitPlanFragments(state, context, 'Brewing', [bottlePlanDecoded.success, storagePlan.success]))) {
      yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
      return
    }
    yield* Ref.update(state.itemUseResults, (results) => [...results, result.success])
  })

const recordBrewingItemUseResult = (
  state: GameplayStageContext['state'],
  result: BrewingItemUseResult,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownResult(GameplayBrewingItemUseResultSchema)(result)
    if (Result.isFailure(decoded)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: decoded.failure,
      })
      return
    }
    yield* Ref.update(state.itemUseResults, (results) => [...results, decoded.success])
  })

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
      const slotIndex = Schema.decodeUnknownResult(PotionDrinkSlotIndexSchema)(request.slotIndex)
      const tick = Schema.decodeUnknownResult(SimulationTickSchema)(request.tick)
      if (Result.isFailure(slotIndex)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: slotIndex.failure,
        })
        return
      }
      if (Result.isFailure(tick)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: tick.failure,
        })
        return
      }
      const planSnapshot = Schema.decodeUnknownResult(PotionDrinkInventorySnapshotSchema)({
        world: storage.success.world,
        expectedRevision: storage.success.revision,
        expectedDimensions: [],
        state: storage.success.state,
      })
      const intent = Schema.decodeUnknownResult(PotionDrinkIntentSchema)({
        inventoryOwnerId: storageOwnerId,
        actor: request.actor,
        slotIndex: slotIndex.success,
        tick: tick.success,
      })
      if (Result.isFailure(planSnapshot)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: planSnapshot.failure,
        })
        return
      }
      if (Result.isFailure(intent)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: intent.failure,
        })
        return
      }
      const planned = yield* Effect.result(context.brewingService.planDrinkPotion(
        planSnapshot.success,
        intent.success,
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
      const drinkPlan = Schema.decodeUnknownResult(PotionDrinkPlanSchema)(planned.success)
      if (Result.isFailure(drinkPlan)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: drinkPlan.failure,
        })
        return
      }
      const plans: Array<WorldCommitPlanFragment<unknown>> = [drinkPlan.success]
      let statusCandidate: Schema.Schema.Type<typeof StatusEffectStateSchema> | undefined
      if (drinkPlan.success.result._tag === 'Consumed') {
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
        const nextEffects = Schema.decodeUnknownResult(StatusEffectStateSchema)(
          applyStatusEffect(observedEffects.success.state, drinkPlan.success.result.effect),
        )
        if (Result.isFailure(nextEffects)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'CandidateBuild', subject: 'Brewing', error: nextEffects.failure,
          })
          return
        }
        const effectSnapshot = Schema.decodeUnknownResult(worldCommitPlanSnapshotSchema(StatusEffectStateSchema))({
          world: observedEffects.success.world,
          expectedRevision: observedEffects.success.revision,
          expectedDimensions: [],
          state: observedEffects.success.state,
        })
        if (Result.isFailure(effectSnapshot)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: effectSnapshot.failure,
          })
          return
        }
        const effectPlan = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(Schema.Undefined))({
          world: effectSnapshot.success.world,
          expectedRevision: effectSnapshot.success.expectedRevision,
          expectedDimensions: effectSnapshot.success.expectedDimensions,
          changes: [{ ownerId: context.statusEffectsOwnerId, state: nextEffects.success }],
          result: undefined,
          postCommitEvents: [],
        })
        if (Result.isFailure(effectPlan)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: effectPlan.failure,
          })
          return
        }
        statusCandidate = nextEffects.success
        plans.push(effectPlan.success)
      }
      const result = Schema.decodeUnknownResult(GameplayBrewingItemUseResultSchema)({
        action: 'DrinkPotion', requestId: request.requestId,
        success: true, outcome: drinkPlan.success.result,
      })
      if (Result.isFailure(result)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: result.failure,
        })
        return
      }
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
      yield* Ref.update(state.itemUseResults, (results) => [...results, result.success])
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
    const brewingSnapshot = Schema.decodeUnknownResult(BrewingServicePlanSnapshotSchema)({
      world: brewing.success.world,
      expectedRevision: brewing.success.revision,
      expectedDimensions: [],
      state: brewing.success.state,
    })
    if (Result.isFailure(brewingSnapshot)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: brewingSnapshot.failure,
      })
      return
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
      const setFuel = yield* Effect.result(context.brewingService.planSetFuel(brewingSnapshot.success, fuel.success))
      if (Result.isFailure(setFuel)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: setFuel.failure,
        })
        return
      }
      const intermediate = Schema.decodeUnknownResult(worldCommitPlanSnapshotSchema(BrewingServiceStateSchema))({
        world: setFuel.success.world,
        expectedRevision: setFuel.success.expectedRevision,
        expectedDimensions: setFuel.success.expectedDimensions,
        state: setFuel.success.result,
      })
      if (Result.isFailure(intermediate)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: intermediate.failure,
        })
        return
      }
      const addFuel = yield* Effect.result(context.brewingService.planAddFuel(intermediate.success))
      if (Result.isFailure(addFuel)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: addFuel.failure,
        })
        return
      }
      const decodedFuel = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(BrewingServiceStateSchema))(addFuel.success)
      if (Result.isFailure(decodedFuel)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: decodedFuel.failure,
        })
        return
      }
      fragments.push(decodedFuel.success)
    } else if (request.action === 'InsertBrewingBottle') {
      const bottleIndex = Schema.decodeUnknownResult(BrewingBottleIndexSchema)(request.bottleIndex)
      if (Result.isFailure(bottleIndex)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: bottleIndex.failure,
        })
        return
      }
      if (brewing.success.state.bottles[bottleIndex.success] !== undefined) {
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
      const bottle = itemStack(requestedItem, StackCount(1))
      if (Result.isFailure(bottle)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Brewing', error: bottle.failure,
        })
        return
      }
      const plan = yield* Effect.result(context.brewingService.planSetBottle(
        brewingSnapshot.success,
        bottleIndex.success,
        bottle.success,
      ))
      if (Result.isFailure(plan)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: plan.failure,
        })
        return
      }
      const decoded = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(BrewingServiceStateSchema))(plan.success)
      if (Result.isFailure(decoded)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: decoded.failure,
        })
        return
      }
      fragments.push(decoded.success)
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
      const ingredient = itemStack(requestedItem, StackCount(1))
      if (Result.isFailure(ingredient)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Brewing', error: ingredient.failure,
        })
        return
      }
      const plan = yield* Effect.result(context.brewingService.planSetIngredient(
        brewingSnapshot.success,
        ingredient.success,
      ))
      if (Result.isFailure(plan)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: plan.failure,
        })
        return
      }
      const decoded = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(BrewingServiceStateSchema))(plan.success)
      if (Result.isFailure(decoded)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: decoded.failure,
        })
        return
      }
      fragments.push(decoded.success)
    }

    const storageCandidate = candidateForPlayerStorageItemUse(
      context.playerStorageOwnerId,
      storage.success.state,
      requestedItem,
      'consume',
    )
    if (Result.isFailure(storageCandidate)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Brewing', error: storageCandidate.failure,
      })
      return
    }
    if (storageCandidate.success === undefined) {
      yield* recordRejected('MissingItem')
      return
    }
    const storagePlan = Schema.decodeUnknownResult(worldCommitPlanFragmentSchema(Schema.Undefined))({
      world: storage.success.world,
      expectedRevision: storage.success.revision,
      expectedDimensions: [],
      changes: [storageCandidate.success],
      result: undefined,
      postCommitEvents: [],
    })
    if (Result.isFailure(storagePlan)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: storagePlan.failure,
      })
      return
    }
    fragments.push(storagePlan.success)
    const result = Schema.decodeUnknownResult(GameplayBrewingItemUseResultSchema)({
      action: request.action, requestId: request.requestId, success: true, outcome: undefined,
    })
    if (Result.isFailure(result)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'PlanBuild', subject: 'Brewing', error: result.failure,
      })
      return
    }
    if (!(yield* commitPlanFragments(state, context, 'Brewing', fragments))) {
      yield* retry()
      return
    }
    yield* Ref.update(state.itemUseResults, (results) => [...results, result.success])
  })

const processPlacement = (
  state: GameplayStageContext['state'],
  context: GameplayStageContext['commit'],
  store: GameplayStageContext['store'],
  playerState: Schema.Schema.Type<typeof PlayerServiceSnapshotSchema> | undefined,
  playerDead: boolean,
  request: PlacementRequest | BlockPlacementCommand,
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
        if (playerState === undefined || context.playerStorageOwnerId === undefined) {
          return unsupported('OwnerRegistrationUnavailable')
        }
        if (playerState.pose.feetPosition.dimension === undefined) {
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
          const removed = removeItemAt(observed.success.state.inventory, slotIndex, request.heldItem, 1)
          if (
            Result.isFailure(removed) ||
            removed.success.result._tag !== 'Removed' ||
            removed.success.result.removed !== 1
          ) {
            return {
              requestId: command?.requestId ?? '',
              success: false,
              consumed: false,
              replayed: false,
              outcome: { _tag: 'InventoryUnavailable' },
            }
          }
          const updated = withInventory(observed.success.state, removed.success.inventory)
          if (Result.isFailure(updated)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse', error: updated.failure,
            })
            return {
              requestId: command?.requestId ?? '',
              success: false,
              consumed: false,
              replayed: false,
              outcome: { _tag: 'InventoryUnavailable' },
            }
          }
          const decoded = Schema.decodeUnknownResult(PlayerStorageSnapshotSchema)(updated.success)
          if (Result.isFailure(decoded)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse', error: decoded.failure,
            })
            return {
              requestId: command?.requestId ?? '',
              success: false,
              consumed: false,
              replayed: false,
              outcome: { _tag: 'InventoryUnavailable' },
            }
          }
          storageCandidate = { ownerId: context.playerStorageOwnerId, state: decoded.success }
        }

        const expectedDimensionRevision = yield* context.coordinator.dimensionRevision(dimension)
        const blockWriteResult = yield* Effect.result(Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
          world: observed.success.world,
          expectedWorldRevision: observed.success.revision,
          dimension,
          expectedDimensionRevision,
          edits: planned.edits,
        }))
        if (Result.isFailure(blockWriteResult)) {
          yield* recordGameplayStageFailure(state, {
            _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse', error: blockWriteResult.failure,
          })
          return {
            requestId: command?.requestId ?? '',
            success: false,
            consumed: false,
            replayed: false,
            outcome: { _tag: 'CommitFailed', error: blockWriteResult.failure },
          }
        }
        const committed = yield* Effect.result(context.coordinator.commit({
          expectedRevision: observed.success.revision,
          expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
          changes: storageCandidate === undefined ? [] : [storageCandidate],
          blockWrite: blockWriteResult.success,
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
      if (!result.success && result.outcome._tag === 'Unsupported' && 'reason' in result.outcome) {
        yield* recordGameplayUnsupportedOperation(state, {
          _tag: 'Unsupported',
          action: 'PlaceBlock',
          reason: result.outcome.reason,
        })
      }
      return
    }
    yield* processBlockPlacementCommand(state, command, execute)
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
    const spawnEndermite = shouldSpawnEndermite(roll.rolls[0] ?? 1)
    if (spawnEndermite && context.entitiesOwnerId === undefined) {
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
      const updated = withInventory(storageSnapshot.success.state, removed.success.inventory)
      if (Result.isFailure(updated)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: updated.failure,
        })
        return
      }
      const decodedStorage = Schema.decodeUnknownResult(PlayerStorageSnapshotSchema)(updated.success)
      if (Result.isFailure(decodedStorage)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: decodedStorage.failure,
        })
        return
      }
      changes.push({ ownerId: context.playerStorageOwnerId, state: decodedStorage.success })
    }

    const currentPose = playerSnapshot.success.state.pose
    const destination = Schema.decodeUnknownResult(WorldPositionSchema)({
      dimension: currentPose.feetPosition.dimension,
      x: currentPose.feetPosition.x + displacement.x,
      y: currentPose.feetPosition.y + displacement.y,
      z: currentPose.feetPosition.z + displacement.z,
    })
    if (Result.isFailure(destination)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: destination.failure,
      })
      return
    }
    const playerCandidate = Schema.decodeUnknownResult(PlayerServiceSnapshotSchema)({
      pose: { ...currentPose, feetPosition: destination.success },
    })
    if (Result.isFailure(playerCandidate)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: playerCandidate.failure,
      })
      return
    }
    changes.push({ ownerId: context.playerOwnerId, state: playerCandidate.success })

    let damage: { readonly amount: number; readonly cause: 'ender_pearl' } | undefined
    if (request.inventory.mode === 'survival') {
      const amount = DamageAmount.result(ENDER_PEARL_DAMAGE)
      const cause = DamageCause.result('ender_pearl')
      if (Result.isFailure(amount)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Vitals', error: amount.failure,
        })
        return
      }
      if (Result.isFailure(cause)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Vitals', error: cause.failure,
        })
        return
      }
      const nextVitals = applyVitalsDamage(vitalsSnapshot.success.state.vitals, {
        amount: amount.success,
        cause: cause.success,
      })
      const decodedVitals = Schema.decodeUnknownResult(ExperienceOrbVitalsOwnerSnapshotSchema)({
        vitals: nextVitals,
      })
      if (Result.isFailure(decodedVitals)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Vitals', error: decodedVitals.failure,
        })
        return
      }
      changes.push({ ownerId: context.vitalsOwnerId, state: decodedVitals.success })
      damage = { amount: ENDER_PEARL_DAMAGE, cause: 'ender_pearl' }
    } else {
      changes.push({ ownerId: context.vitalsOwnerId, state: vitalsSnapshot.success.state })
    }

    if (spawnEndermite) {
      const entities = yield* Effect.result(context.coordinator.snapshot(
        context.entitiesOwnerId!,
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
          PositionAxis(destination.success.x),
          PositionAxis(destination.success.y),
          PositionAxis(destination.success.z),
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
      const decodedEntities = Schema.decodeUnknownResult(GameplayEntityRosterSchema)(spawned.success.roster)
      if (Result.isFailure(decodedEntities)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: decodedEntities.failure,
        })
        return
      }
      changes.push({ ownerId: context.entitiesOwnerId!, state: decodedEntities.success })
    }

    const outcome = Schema.decodeUnknownResult(EnderPearlOutcomeSchema)({ displacement, damage })
    if (Result.isFailure(outcome)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player', error: outcome.failure,
      })
      return
    }
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
    yield* Ref.update(state.enderPearlOutcomes, (outcomes) => [...outcomes, outcome.success])
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
        if (commit !== undefined && playerState === undefined) return

        yield* advanceCropLifecycle(state, commit, dt)

        // Advance portal dwell on idle frames, before the early return below.
        yield* stepPortalTravel(state, store, playerState, commit, dt)
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

        for (const request of villagerTrades) {
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
            continue
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
          const added = Result.getOrUndefined(addInventoryItem(
            removed.inventory,
            offer.output.item,
            offer.output.count,
          ))
          if (added === undefined || added.leftover > 0) {
            yield* reject('InventoryFull')
            continue
          }
          const candidateStorage = Result.getOrUndefined(withInventory(
            storageSnapshot.success.state,
            added.inventory,
          ))
          if (candidateStorage === undefined) {
            yield* reject('InventoryFull')
            continue
          }
          const candidateTrades = useVillagerOffer(
            tradesSnapshot.success.state,
            request.villagerId,
            request.offerId,
          )
          if (candidateTrades === undefined) {
            yield* reject('OutOfStock')
            continue
          }
          const decodedTrades = Schema.decodeUnknownResult(GameplayVillagerTradeSnapshotSchema)(candidateTrades)
          if (Result.isFailure(decodedTrades)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse', error: decodedTrades.failure,
            })
            continue
          }
          const committed = yield* Effect.result(commit.coordinator.commit({
            expectedRevision: storageSnapshot.success.revision,
            expectedDimensions: [],
            changes: [
              { ownerId: commit.playerStorageOwnerId, state: candidateStorage },
              { ownerId: tradesOwnerId, state: decodedTrades.success },
            ],
          }))
          if (Result.isFailure(committed)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse', error: committed.failure,
            })
            continue
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

        for (const [index, positionKey] of breaks.entries()) {
          if (playerDead) continue
          const request = snapshots.get(index)
          const tool = request?.lootContext ?? NO_TOOL
          const breakPosition = yield* blockPositionForKey(positionKey)
          if (request === undefined || commit === undefined) {
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'MineBlock',
              ...(request === undefined ? {} : { requestId: String(request.requestId) }),
              reason: commit === undefined
                ? 'WorldCommitCoordinatorUnavailable'
                : 'OwnerRegistrationUnavailable',
            })
            continue
          }
          const miningDimension = request.dimension ?? playerState?.pose.feetPosition.dimension
          if (miningDimension === undefined) {
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'MineBlock',
              requestId: String(request.requestId),
              reason: 'OwnerRegistrationUnavailable',
            })
            continue
          }
          {
            const plan = yield* planBreakBlock(breakPosition, {
              coordinator: commit.coordinator,
              dimension: miningDimension,
              ownerId: commit.playerStorageOwnerId,
              toolLocation: request.toolLocation,
            })
            if (plan._tag === 'PlannedCascade') {
              const seed = yield* Ref.get(state.rollSeed)
              const plannedLoot = plannedDropsForBrokenBlock(seed, plan.yielded, tool, breakPosition)
              const drops = plannedLoot.drops
              let candidate: PlayerStorage = plan.candidateStorage
              const leftovers: Array<DroppedItemSpawn> = []
              for (const item of drops) {
                const added = addInventoryItem(candidate.inventory, item.item, item.count)
                if (Result.isFailure(added)) {
                  leftovers.push(item)
                  continue
                }
                const updated = withInventory(candidate, added.success.inventory)
                if (Result.isFailure(updated)) {
                  leftovers.push(item)
                  continue
                }
                candidate = updated.success
                if (added.success.leftover > 0) {
                  leftovers.push({ ...item, count: added.success.leftover })
                }
              }

              let changes = plan.request.changes.map((change) =>
                change.ownerId === commit.playerStorageOwnerId
                  ? { ...change, state: candidate }
                  : change,
              )
              if (leftovers.length > 0) {
                const droppedItemsOwnerId = commit.droppedItemsOwnerId
                if (droppedItemsOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'MineBlock',
                    requestId: String(request.requestId),
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
                yield* requeueBlockBreak(state, request)
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
          yield* processPlacement(state, commit, store, playerState, playerDead, request)
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
                if (commit === undefined || commit.cropOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'ApplyBoneMeal',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break
                }
                const position = yield* blockPositionForKey(request.positionKey)
                const dimension = playerState?.pose.feetPosition.dimension
                if (dimension === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'ApplyBoneMeal',
                    requestId: request.requestId,
                    reason: 'OwnerRegistrationUnavailable',
                  })
                  break
                }
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
                  break
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
                  break
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
                  break
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
                  break
                }
                const crop = cropAt(cropSnapshot.success.state, dimension, position)
                if (crop === undefined || crop.crop !== blockType) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'ApplyBoneMeal',
                    requestId: request.requestId,
                    reason: 'OwnerRegistrationUnavailable',
                  })
                  break
                }
                const candidate = candidateForPlayerStorageItemUse(
                  commit.playerStorageOwnerId,
                  observed.success.state,
                  request.heldItem,
                  'consume',
                )
                if (Result.isFailure(candidate)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'ItemUse',
                    error: candidate.failure,
                  })
                  break
                }
                const nextCrops = cropSnapshot.success.state.crops.map((entry) =>
                  entry === crop ? advanceCropByBoneMeal(entry) : entry,
                )
                const cropChange = cropCandidate(commit.cropOwnerId, nextCrops)
                if (Result.isFailure(cropChange)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'ItemUse',
                    error: cropChange.failure,
                  })
                  break
                }
                const success = candidate.success !== undefined
                if (success) {
                  const committed = yield* Effect.result(commit.coordinator.commit({
                    expectedRevision: observed.success.revision,
                    expectedDimensions: [],
                    changes: [candidate.success, cropChange.success],
                  }))
                  if (Result.isFailure(committed)) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'WorldCommit',
                      subject: 'ItemUse',
                      error: committed.failure,
                    })
                    break
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
                break
              }
              case 'TillSoil': {
                const ground = yield* blockPositionForKey(request.positionKey)
                const above = Result.getOrUndefined(cellAbove(ground))
                const dimension = playerState?.pose.feetPosition.dimension
                if (commit === undefined || dimension === undefined || above === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'TillSoil',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break
                }
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
                  break
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
                if (Result.isFailure(candidate)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'ItemUse',
                    error: candidate.failure,
                  })
                  break
                }
                const outcome = tillingVerdict(
                  { tills: candidate.success !== undefined },
                  ground,
                  groundBlock,
                  aboveBlock,
                )
                const success = outcome._tag === 'tilled' && candidate.success !== undefined
                if (outcome._tag === 'tilled' && candidate.success !== undefined) {
                  const candidateChange = candidate.success
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
                    break
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
                break
              }
              case 'PlantPotato': {
                const soil = yield* blockPositionForKey(request.positionKey)
                const above = Result.getOrUndefined(cropCellAbove(soil))
                const dimension = playerState?.pose.feetPosition.dimension
                if (commit === undefined || dimension === undefined || above === undefined || commit.cropOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'PlantPotato',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break
                }
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
                  break
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
                  break
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
                  break
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
                if (Result.isFailure(candidate)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'ItemUse',
                    error: candidate.failure,
                  })
                  break
                }
                const outcome = candidate.success === undefined
                  ? { _tag: 'notASeed' as const, held: request.heldItem }
                  : plantingVerdict({ held: request.heldItem, soil }, soilBlock, aboveBlock)
                const success = outcome._tag === 'planted' && candidate.success !== undefined
                if (outcome._tag === 'planted' && candidate.success !== undefined) {
                  if (!isCropType(outcome.crop) || cropAt(cropSnapshot.success.state, dimension, outcome.at) !== undefined) {
                    yield* recordGameplayUnsupportedOperation(state, {
                      _tag: 'Unsupported',
                      action: 'PlantPotato',
                      requestId: request.requestId,
                      reason: 'OwnerRegistrationUnavailable',
                    })
                    break
                  }
                  const cropChange = cropCandidate(commit.cropOwnerId, [
                    ...cropSnapshot.success.state.crops,
                    { dimension, position: outcome.at, crop: outcome.crop, growthSecs: 0 },
                  ])
                  if (Result.isFailure(cropChange)) {
                    yield* recordGameplayStageFailure(state, {
                      _tag: 'Failed',
                      operation: 'CandidateBuild',
                      subject: 'ItemUse',
                      error: cropChange.failure,
                    })
                    break
                  }
                  const candidateChange = candidate.success
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
                      changes: [candidateChange, cropChange.success],
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
                    break
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
                break
              }
              case 'HarvestPotato': {
                if (commit === undefined || commit.cropOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'HarvestPotato',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break
                }
                const position = yield* blockPositionForKey(request.positionKey)
                const dimension = playerState?.pose.feetPosition.dimension
                if (dimension === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'HarvestPotato',
                    requestId: request.requestId,
                    reason: 'OwnerRegistrationUnavailable',
                  })
                  break
                }
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
                  break
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
                  break
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
                  break
                }
                const crop = cropAt(cropSnapshot.success.state, dimension, position)
                if (crop === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'HarvestPotato',
                    requestId: request.requestId,
                    reason: 'OwnerRegistrationUnavailable',
                  })
                  break
                }
                const reading = observed.success.blocks[0]?.reading
                const cropType = reading?._tag === 'Block'
                  ? Result.getOrUndefined(blockTypeOfId(reading.block)) ?? 'air'
                  : 'air'
                if (crop.crop !== cropType) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'HarvestPotato',
                    requestId: request.requestId,
                    reason: 'OwnerRegistrationUnavailable',
                  })
                  break
                }
                const outcome = cropDrops(cropType, isMatureCrop(crop), request.roll)
                if (outcome._tag !== 'drops') {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    positionKey: request.positionKey,
                    success: false,
                    outcome,
                  })
                  break
                }
                let storage = observed.success.state
                const leftovers: Array<DroppedItemSpawn> = []
                for (const drop of outcome.drops) {
                  const added = addInventoryItem(storage.inventory, drop.item, drop.count)
                  if (Result.isFailure(added)) {
                    leftovers.push({
                      ...drop,
                      at: {
                        x: PositionAxis(position.x),
                        y: PositionAxis(position.y),
                        z: PositionAxis(position.z),
                      },
                    })
                    continue
                  }
                  const updated = withInventory(storage, added.success.inventory)
                  if (Result.isFailure(updated)) {
                    leftovers.push({
                      ...drop,
                      at: {
                        x: PositionAxis(position.x),
                        y: PositionAxis(position.y),
                        z: PositionAxis(position.z),
                      },
                    })
                    continue
                  }
                  storage = updated.success
                  if (added.success.leftover > 0) {
                    leftovers.push({
                      item: drop.item,
                      count: added.success.leftover,
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
                if (Result.isFailure(cropChange)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'ItemUse',
                    error: cropChange.failure,
                  })
                  break
                }
                let changes: Array<ReplicatedOwnerCandidate> = [
                  { ownerId: commit.playerStorageOwnerId, state: storage },
                  cropChange.success,
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
                    break
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
                    break
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
                    break
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
                    break
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
                  break
                }
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  positionKey: request.positionKey,
                  success: true,
                  outcome,
                })
                disturbed.push(request.positionKey)
                break
              }
              case 'EatPotato':
              case 'EatFood': {
                if (commit === undefined || commit.vitalsOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'EatFood',
                    requestId: request.requestId,
                    reason: commit === undefined
                      ? 'WorldCommitCoordinatorUnavailable'
                      : 'OwnerRegistrationUnavailable',
                  })
                  break
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
                  break
                }
                const vitalsSnapshot = yield* Effect.result(commit.coordinator.snapshot(
                  commit.vitalsOwnerId,
                  ExperienceOrbVitalsOwnerSnapshotSchema,
                ))
                if (Result.isFailure(vitalsSnapshot)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'Vitals',
                    error: vitalsSnapshot.failure,
                  })
                  break
                }
                if (storageSnapshot.success.revision !== vitalsSnapshot.success.revision) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'Vitals',
                    error: new WorldRevisionConflict({
                      expected: storageSnapshot.success.revision,
                      actual: vitalsSnapshot.success.revision,
                    }),
                  })
                  break
                }
                const vitals = vitalsSnapshot.success.state.vitals
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
                  break
                }
                const storageCandidate = candidateForPlayerStorageItemUse(
                  commit.playerStorageOwnerId,
                  storageSnapshot.success.state,
                  heldItem,
                  'consume',
                )
                if (Result.isFailure(storageCandidate)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'ItemUse',
                    error: storageCandidate.failure,
                  })
                  break
                }
                if (storageCandidate.success === undefined) {
                  publishFoodResult(false, 0, { _tag: 'missingItem' })
                  break
                }
                const nutrition = FoodNutrition.result(outcome.foodPoints)
                const saturation = SaturationModifier.result(outcome.saturationModifier)
                if (Result.isFailure(nutrition)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'Vitals',
                    error: nutrition.failure,
                  })
                  break
                }
                if (Result.isFailure(saturation)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'Vitals',
                    error: saturation.failure,
                  })
                  break
                }
                const nextVitals = eatVitals(vitals, nutrition.success, saturation.success)
                const validatedVitals = yield* Effect.result(
                  Schema.decodeUnknownEffect(ExperienceOrbVitalsOwnerSnapshotSchema)({
                    vitals: nextVitals,
                  }),
                )
                if (Result.isFailure(validatedVitals)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'CandidateBuild',
                    subject: 'Vitals',
                    error: validatedVitals.failure,
                  })
                  break
                }
                const committed = yield* Effect.result(commit.coordinator.commit({
                  expectedRevision: storageSnapshot.success.revision,
                  expectedDimensions: [],
                  changes: [
                    storageCandidate.success,
                    {
                      ownerId: commit.vitalsOwnerId,
                      state: validatedVitals.success,
                    },
                  ],
                }))
                if (Result.isFailure(committed)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'WorldCommit',
                    subject: 'Vitals',
                    error: committed.failure,
                  })
                  break
                }
                for (const effect of outcome.effects) {
                  yield* requestStatusEffect(state, effect)
                }
                publishFoodResult(true, 1, outcome)
                break
              }
              case 'UseBucket': {
                if (commit === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'UseBucket',
                    requestId: request.requestId,
                    reason: 'WorldCommitCoordinatorUnavailable',
                  })
                  break
                }
                if (commit.playerStorageOwnerId === undefined) {
                  yield* recordGameplayUnsupportedOperation(state, {
                    _tag: 'Unsupported',
                    action: 'UseBucket',
                    requestId: request.requestId,
                    reason: 'OwnerRegistrationUnavailable',
                  })
                  break
                }
                const position = yield* blockPositionForKey(request.positionKey)
                const outcome = yield* useBucket(
                  commit.coordinator,
                  state.fluidFrontier,
                  {
                    activeDimension: request.activeDimension,
                    targetDimension: request.targetDimension,
                    position,
                    heldItem: request.heldItem,
                    playerStorageOwnerId: commit.playerStorageOwnerId,
                  },
                )
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
                break
              }
              case 'CastFishing':
              case 'AdvanceFishing':
              case 'CancelFishing':
              case 'ReelFishing': {
                yield* processFishingItemUse(state, commit, request)
                break
              }
              case 'CollectBrewingBottle': {
                yield* processBrewingBottleCollection(state, commit, request)
                break
              }
              case 'InsertBrewingFuel':
              case 'InsertBrewingBottle':
              case 'InsertBrewingIngredient':
              case 'DrinkPotion': {
                yield* processBrewingItemUse(state, commit, request)
                break
              }
              case 'AdvanceFurnace': {
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
                break
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
          const ignitionPosition = yield* blockPositionForKey(request.positionKey)
          const targetBlock = yield* store.getBlock(ignitionPosition)
          if (targetBlock._tag === 'Block' && targetBlock.block === TNT_BLOCK_ID) {
            const dimension = playerState?.pose.feetPosition.dimension
            const tntOwnerId = commit.tntOwnerId
            const playerStorageOwnerId = commit.playerStorageOwnerId
            if (
              tntOwnerId === undefined ||
              playerStorageOwnerId === undefined ||
              dimension === undefined
            ) {
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
            if (observedTnt.success.revision !== observedStorage.success.revision) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ItemUse',
                error: new WorldRevisionConflict({
                  expected: observedTnt.success.revision,
                  actual: observedStorage.success.revision,
                }),
              })
              continue
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
            if (Result.isFailure(storageCandidate)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse', error: storageCandidate.failure,
              })
              continue
            }
            if (storageCandidate.success === undefined) {
              itemUseResults.push({
                requestId: request.requestId,
                heldItem: request.heldItem,
                success: false,
                outcome: { _tag: 'Tnt', outcome: { _tag: 'NotTnt' } },
              })
              continue
            }
            const tntId = Schema.decodeUnknownResult(EntityIdSchema)(`gameplay:tnt:${request.requestId}`)
            const primed = primeTnt()
            if (Result.isFailure(tntId)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse',
                error: tntId.failure,
              })
              continue
            }
            if (Result.isFailure(primed)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse', error: primed.failure,
              })
              continue
            }
            const tntCandidate = Schema.decodeUnknownResult(TntServiceSnapshotSchema)({
              tnts: [...observedTnt.success.state.tnts, {
                id: tntId.success,
                dimension,
                center: {
                  x: ignitionPosition.x + 0.5,
                  y: ignitionPosition.y + 0.5,
                  z: ignitionPosition.z + 0.5,
                },
                state: primed.success,
              }],
            })
            if (Result.isFailure(tntCandidate)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'CandidateBuild', subject: 'ItemUse', error: tntCandidate.failure,
              })
              continue
            }
            const storageChange = storageCandidate.success
            const tntState = tntCandidate.success
            const coordinator = commit.coordinator
            const committed = yield* Effect.result(Effect.gen(function* () {
              const expectedDimensionRevision = yield* coordinator.dimensionRevision(dimension)
              const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
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
                  storageChange,
                ],
                blockWrite,
              })
            }))
            if (Result.isFailure(committed)) {
              yield* recordGameplayStageFailure(state, {
                _tag: 'Failed', operation: 'WorldCommit', subject: 'ItemUse', error: committed.failure,
              })
              yield* Ref.update(state.pendingItemUses, (pending) => [request, ...pending])
              continue
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
          const ignitionDimension = playerState?.pose.feetPosition.dimension
          const ignitionCandidateResult = ignitionDimension === undefined
            ? Result.succeed(undefined)
            : yield* candidateForItemUse(
              commit.coordinator,
              commit.playerStorageOwnerId,
              request.heldItem,
              request.heldItem === 'fire_charge' ? 'consume' : 'damage',
            )
          if (Result.isFailure(ignitionCandidateResult)) {
            yield* recordGameplayStageFailure(state, {
              _tag: 'Failed',
              operation: 'OwnerSnapshot',
              subject: 'ItemUse',
              error: ignitionCandidateResult.failure,
            })
          }
          const ignitionCandidate = Result.getOrUndefined(ignitionCandidateResult)
          if (ignitionCandidate === undefined) {
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'IgniteTnt',
              requestId: String(request.requestId),
              reason: 'OwnerRegistrationUnavailable',
            })
            continue
          }
          const ignition = yield* useFlintAndSteel(
            store,
            ignitionPosition,
            request.heldItem,
            ignitionDimension === undefined
              ? undefined
              : {
                coordinator: commit.coordinator,
                dimension: ignitionDimension,
                changes: ignitionCandidate === undefined ? [] : [ignitionCandidate],
              },
          )
          const success = ignition.outcome._tag === 'Lit'
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
