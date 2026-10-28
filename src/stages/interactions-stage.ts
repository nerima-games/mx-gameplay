import {
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
  candidateForItemUse,
  candidateForPlayerStorageItemUse,
  disturb,
  drawRolls,
  firePositionKey,
  furnaceAdvanceChanged,
  gameplayPlayerStateForStage,
  recordGameplayStageFailure,
  recordGameplayUnsupportedOperation,
  requestStatusEffect,
  isSuccessfulBlockUse,
  NO_TOOL,
  planFurnaceAdvance,
  resolveBlockUse,
  stepPortalTravel,
  stepStatusEffects,
  useBucket,
  useFlintAndSteel,
} from './registration-core.js'
import { PositionAxis } from '@nerima-games/mc-kernel'
import type { BlockId } from '@nerima-games/mc-kernel'
import { Option, Result } from 'effect'
import { removeItem as removeInventoryItem, withInventory, type PlayerStorage } from '@nerima-games/mc-sim'
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
  BowShotRequest,
  DroppedItemSpawn,
  GameplayStageContext,
  IgnitionItemType,
  ItemUseRequest,
  ItemUseResult,
  MeleeAttackRequest,
  PendingBlockBreakRequest,
  PlacementRequest,
  StageRegistration,
  VillagerTradeRequest,
  EnderPearlThrowRequest,
} from './registration-core.js'

import {
  AIR_BLOCK_ID,
  WorldWriteBatchSchema,
  FoodNutrition,
  blockIdOf,
  blockTypeOfId,
} from '@nerima-games/mc-kernel'
import {
  PlayerStorageSnapshotSchema,
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
} from '@nerima-games/mc-sim'
import { Schema } from 'effect'
import { applyBoneMeal } from '../domain/interactions/bone-meal.js'
import { cropDrops } from '../domain/interactions/crop-drops.js'
import { resolveFoodUse } from '../domain/interactions/eat-food.js'
import { plantingVerdict, cropCellAbove } from '../domain/interactions/plant-crop.js'
import { TILLED_BLOCK, tillingVerdict, cellAbove } from '../domain/interactions/till-soil.js'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../domain/entities/xp-orb.js'
import { GameplayVillagerTradeSnapshotSchema } from './gameplay-owner-registrations.js'
import { useVillagerOffer } from '../domain/villager-trade.js'

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
        yield* stepPortalTravel(state, store, playerState, dt)
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

        for (const _request of placements) {
          const reason = commit === undefined
            ? 'WorldCommitCoordinatorUnavailable'
            : 'McSimPlanFragmentUnavailable'
          yield* recordGameplayUnsupportedOperation(state, {
            _tag: 'Unsupported',
            action: 'PlaceBlock',
            reason,
          })
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
                      reason: 'CropOwnerStateUnavailable',
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
                    reason: 'CropOwnerStateUnavailable',
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
                    reason: 'CropOwnerStateUnavailable',
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
                yield* recordGameplayUnsupportedOperation(state, {
                  _tag: 'Unsupported',
                  action: 'Fishing',
                  requestId: request.requestId,
                  reason: 'McSimPlanFragmentUnavailable',
                })
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
            yield* recordGameplayUnsupportedOperation(state, {
              _tag: 'Unsupported',
              action: 'IgniteTnt',
              requestId: String(request.requestId),
              reason: 'EntityRosterOwnerUnavailable',
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

        // mc-sim 0.6.0 has no owner-aware entity damage plan. Reject these
        // cross-owner operations before reading or mutating the local roster.
        for (const shot of bowShots) {
          yield* recordGameplayUnsupportedOperation(state, {
            _tag: 'Unsupported',
            action: 'BowShot',
            ...(shot.requestId === undefined ? {} : { requestId: shot.requestId }),
            reason: 'EntityRosterOwnerUnavailable',
          })
        }
        for (const attack of meleeAttacks) {
          yield* recordGameplayUnsupportedOperation(state, {
            _tag: 'Unsupported',
            action: 'MeleeAttack',
            ...(attack.requestId === undefined ? {} : { requestId: attack.requestId }),
            reason: 'EntityRosterOwnerUnavailable',
          })
        }

        // ---- THE ENDER PEARL -----------------------------------------------
        //
        // ONE ROLL PER THROW, drawn as a BATCH up front rather than one at a time
        // inside the loop, which is `domain/interactions/block-loot.ts`'s
        // convention and `domain/frame-rolls.ts`'s: the budget is a function of
        // how many throws there were and not of what happened to them, so two runs
        // of one scenario draw the same numbers whatever the endermites do.
        for (const _thrown of pearlThrows) {
          yield* recordGameplayUnsupportedOperation(state, {
            _tag: 'Unsupported',
            action: 'EnderPearl',
            reason: 'McSimPlanFragmentUnavailable',
          })
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
