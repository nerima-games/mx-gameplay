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
  blockTypeOrDie,
  breakRequestQueueFor,
  candidateForItemUse,
  disturb,
  drawRolls,
  firePositionKey,
  furnaceAdvanceChanged,
  gameplayPlayerStateForStage,
  recordGameplayStageFailure,
  recordUnsupportedBlockPlacement,
  resultOrDie,
  isSuccessfulBlockUse,
  planFurnaceAdvance,
  plantCrop,
  resolveBlockUse,
  stepPortalTravel,
  stepStatusEffects,
  tillSoil,
  useFlintAndSteel,
} from './registration-core.js'
import { PositionAxis } from '@nerima-games/mc-kernel'
import type { BlockId } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import { withInventory, type PlayerStorage } from '@nerima-games/mc-sim'
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
  recordGameplayUnsupportedOperation,
  IgnitionItemType,
  ItemUseRequest,
  ItemUseResult,
  MeleeAttackRequest,
  PendingBlockBreakRequest,
  PlaceableItemType,
  PlacementRequest,
  StageRegistration,
  VillagerTradeRequest,
} from './registration-core.js'

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

        const spent: Array<PlaceableItemType> = []
        const used: Array<IgnitionItemType> = []
        const blockUseResults: Array<BlockUseResult> = []
        const itemUseResults: Array<ItemUseResult> = []
        const disturbed: Array<BlockPositionKey> = []

        for (const request of villagerTrades) {
          yield* recordGameplayUnsupportedOperation(state, {
            _tag: 'Unsupported',
            action: 'VillagerTrade',
            requestId: request.requestId,
            reason: 'McSimPlanFragmentUnavailable',
          })
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
          const tool = request?.lootContext
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

        for (const request of placements) {
          const reason = commit === undefined
            ? 'WorldCommitCoordinatorUnavailable'
            : 'McSimPlanFragmentUnavailable'
          yield* recordGameplayUnsupportedOperation(state, {
            _tag: 'Unsupported',
            action: 'PlaceBlock',
            ...('requestId' in request ? { requestId: request.requestId } : {}),
            reason,
          })
          if ('requestId' in request) {
            yield* recordUnsupportedBlockPlacement(state, request, reason)
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
              case 'ApplyBoneMeal':
                yield* recordGameplayUnsupportedOperation(state, {
                  _tag: 'Unsupported',
                  action: 'ApplyBoneMeal',
                  requestId: request.requestId,
                  reason: 'McSimPlanFragmentUnavailable',
                })
                break
              case 'TillSoil': {
                const ground = yield* blockPositionForKey(request.positionKey)
                const tillPort = {
                  blockAt: (position: BlockPosition) =>
                    Effect.map(store.getBlock(position), (reading) =>
                      reading._tag === 'Block' ? reading.block : undefined,
                    ),
                }
                const dimension = playerState?.pose.feetPosition.dimension
                const candidateResult = commit === undefined || dimension === undefined
                  ? Result.succeed(undefined)
                  : yield* candidateForItemUse(
                    commit.coordinator,
                    commit.playerStorageOwnerId,
                    request.heldItem,
                    'damage',
                  )
                if (Result.isFailure(candidateResult)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: candidateResult.failure,
                  })
                }
                const candidate = Result.getOrUndefined(candidateResult)
                const outcome = yield* tillSoil(
                  tillPort,
                  { tills: true },
                  ground,
                  commit === undefined || dimension === undefined || candidate === undefined
                    ? undefined
                    : { coordinator: commit.coordinator, dimension, changes: [candidate] },
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
                const soil = yield* blockPositionForKey(request.positionKey)
                const plantPort = {
                  blockAt: (position: BlockPosition) =>
                    Effect.map(store.getBlock(position), (reading) =>
                      reading._tag === 'Block' ? reading.block : undefined,
                    ),
                }
                const dimension = playerState?.pose.feetPosition.dimension
                const candidateResult = commit === undefined || dimension === undefined
                  ? Result.succeed(undefined)
                  : yield* candidateForItemUse(
                    commit.coordinator,
                    commit.playerStorageOwnerId,
                    request.heldItem,
                    'consume',
                  )
                if (Result.isFailure(candidateResult)) {
                  yield* recordGameplayStageFailure(state, {
                    _tag: 'Failed',
                    operation: 'OwnerSnapshot',
                    subject: 'ItemUse',
                    error: candidateResult.failure,
                  })
                }
                const candidate = Result.getOrUndefined(candidateResult)
                const outcome = yield* plantCrop(
                  plantPort,
                  { held: request.heldItem, soil },
                  commit === undefined || dimension === undefined || candidate === undefined
                    ? undefined
                    : { coordinator: commit.coordinator, dimension, changes: [candidate] },
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
                yield* recordGameplayUnsupportedOperation(state, {
                  _tag: 'Unsupported',
                  action: 'HarvestPotato',
                  requestId: request.requestId,
                  reason: 'McSimPlanFragmentUnavailable',
                })
                break
              }
              case 'EatPotato': {
                yield* recordGameplayUnsupportedOperation(state, {
                  _tag: 'Unsupported',
                  action: 'EatFood',
                  requestId: request.requestId,
                  reason: 'McSimPlanFragmentUnavailable',
                })
                break
              }
              case 'EatFood': {
                yield* recordGameplayUnsupportedOperation(state, {
                  _tag: 'Unsupported',
                  action: 'EatFood',
                  requestId: request.requestId,
                  reason: 'McSimPlanFragmentUnavailable',
                })
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
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  heldItem: request.heldItem,
                  success: outcome._tag === 'Collected' || outcome._tag === 'Placed',
                  outcome,
                })
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
              // exhaustiveness arm over ItemUseRequest's `action`, a closed
              // twelve-case union across IgnitionItemUseRequest (tagless, routed
              // above the `if ('action' in request)` guard), FarmingItemUseRequest
              // (6), FurnaceItemUseRequest (1), BucketItemUseRequest (1) and
              // FishingItemUseRequest (4); every `action` is handled above, so no
              // input can reach this arm.
              /* v8 ignore start */
              default: {
                const exhaustive: never = request
                void exhaustive
                break
              }
              /* v8 ignore stop */
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
