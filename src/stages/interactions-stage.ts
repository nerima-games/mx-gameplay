import {
  AIR_BLOCK_ID,
  BLOCK_LOOT_ROLLS,
  BOW_MAX_RANGE,
  BlockId,
  ENDERMITE_KIND,
  ENDERMITE_MAX_HEALTH,
  ENDER_PEARL_DAMAGE,
  ENDER_PEARL_DEATH_CAUSE,
  Effect,
  FRESH_PRIMED_TNT,
  GAMEPLAY_STAGE_IDS,
  PRIMED_TNT_KIND,
  Ref,
  UNREADABLE_BLOCK,
  UPSTREAM_STAGE_IDS,
  addInventoryItem,
  adjacentBlockPosition,
  advanceFishing,
  advanceVillagerRestock,
  applyBoneMeal,
  blockLoot,
  blockPlacementRuntimeFor,
  blockPositionKeyOf,
  blockPositionForKey,
  blockTypeOrDie,
  bowCharge,
  bowDamage,
  breakBlock,
  breakRequestQueueFor,
  canFireBow,
  cancelFishing,
  capabilityOfBlockId,
  castFishing,
  chunkCoordsAround,
  cropDrops,
  disturb,
  doorUpperBreakCell,
  drawRolls,
  enderPearlDisplacement,
  executeBlockPlacementAtomically,
  executeBlockPlacementCommand,
  experienceOfCasualties,
  firePositionKey,
  furnaceAdvanceChanged,
  resultOrDie,
  isBlockPlacementCommand,
  isSuccessfulBlockUse,
  knockbackDirection,
  meleeTarget,
  openChunkWindow,
  planFurnaceAdvance,
  plantCrop,
  recordVillagerTradeResult,
  reelFishing,
  removeInventoryItem,
  resolveBlockUse,
  resolveBowHits,
  resolveFoodUse,
  resolveMeleeHits,
  rollAt,
  rollCasualtyDrops,
  shotBlockedByTerrain,
  shotTarget,
  shouldSpawnEndermite,
  spawnDroppedItems,
  stepBrewing,
  stepPortalTravel,
  stepStatusEffects,
  tillSoil,
  toKernelPosition,
  useBucket,
  useFlintAndSteel,
  useVillagerOffer,
} from './registration-core.js'
import { BlockAxis, EntityHealthPoints, PositionAxis } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import type {
  BlockPositionKey,
  BlockUseRequest,
  BlockUseResult,
  BowHit,
  BowKnockback,
  BowShotRequest,
  BowShotResult,
  DroppedItemSpawn,
  EnderPearlOutcome,
  EnderPearlThrowRequest,
  GameplayMeleeAttackResult,
  GameplayStageContext,
  IgnitionItemType,
  ItemUseRequest,
  ItemUseResult,
  MeleeAttackRequest,
  PendingBlockBreakRequest,
  PlaceableItemType,
  PlacementRequest,
  Position,
  StageRegistration,
  VillagerTradeRequest,
} from './registration-core.js'

export const makeInteractionsStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, roster, inventory, player } = context
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
        const playerDead = yield* Ref.get(state.playerDead)

        // Advance portal dwell on idle frames, before the early return below.
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

        const gained: Array<DroppedItemSpawn> = []
        const spent: Array<PlaceableItemType> = []
        const used: Array<IgnitionItemType> = []
        const blockUseResults: Array<BlockUseResult> = []
        const itemUseResults: Array<ItemUseResult> = []
        const bowShotResults: Array<BowShotResult> = []
        const meleeAttackResults: Array<GameplayMeleeAttackResult> = []
        const disturbed: Array<BlockPositionKey> = []

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
          const removed = yield* resultOrDie(
            removeInventoryItem(before, offer.input.item, offer.input.count),
          )
          if (removed.removed !== offer.input.count) {
            yield* recordVillagerTradeResult(state, {
              ...request,
              _tag: 'Rejected',
              reason: 'InsufficientItems',
            })
            continue
          }
          const added = yield* resultOrDie(
            addInventoryItem(removed.inventory, offer.output.item, offer.output.count),
          )
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
          const breakPosition = yield* blockPositionForKey(positionKey)
          const outcome = yield* breakBlock(store, breakPosition)
          switch (outcome._tag) {
            case 'Broken': {
              const upperDoor = yield* doorUpperBreakCell(store, outcome.yielded, breakPosition)
              if (upperDoor._tag === 'DoorAbove') {
                const upperOutcome = yield* store.setBlock(upperDoor.cell, AIR_BLOCK_ID)
                if (upperOutcome._tag === 'Written') {
                  disturbed.push(blockPositionKeyOf(toKernelPosition(upperDoor.cell)))
                }
              }

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
              gained.push(
                ...loot.map((item) => ({
                  ...item,
                  at: {
                    x: PositionAxis(breakPosition.x),
                    y: PositionAxis(breakPosition.y),
                    z: PositionAxis(breakPosition.z),
                  },
                })),
              )

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
            // falls through
            case 'ChunkNotLoaded':
            case 'OutOfWorld': {
              break
            }
            // exhaustiveness arm over BreakOutcome, a closed four-tag union
            // (break-block.ts's own `BreakOutcome` definition); all four tags
            // are handled above, so no input can reach this arm.
            /* v8 ignore start */
            default: {
              const exhaustive: never = outcome
              void exhaustive
              break
            }
            /* v8 ignore stop */
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
            const position = yield* blockPositionForKey(request.positionKey)
            const below = yield* resultOrDie(adjacentBlockPosition(position, 'down'))
            disturbed.push(
              blockPositionKeyOf(below),
            )
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
                const position = yield* blockPositionForKey(request.positionKey)
                const outcome = yield* applyBoneMeal(
                  (position) =>
                    Effect.flatMap(store.getBlock(position), (reading) =>
                      reading._tag === 'Block'
                        ? blockTypeOrDie(reading.block)
                        : Effect.succeed(undefined),
                    ),
                  position,
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
                const ground = yield* blockPositionForKey(request.positionKey)
                const outcome = yield* tillSoil(
                  {
                    blockAt: (position) =>
                      Effect.map(store.getBlock(position), (reading) =>
                        reading._tag === 'Block' ? reading.block : undefined,
                      ),
                    setBlock: (position, block) => store.setBlock(position, BlockId(block)),
                  },
                  { tills: true },
                  ground,
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
                const outcome = yield* plantCrop(
                  {
                    blockAt: (position) =>
                      Effect.map(store.getBlock(position), (reading) =>
                        reading._tag === 'Block' ? reading.block : undefined,
                      ),
                    setBlock: (position, block) => store.setBlock(position, BlockId(block)),
                  },
                  { held: request.heldItem, soil },
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
              case 'UseBucket': {
                const position = yield* blockPositionForKey(request.positionKey)
                const outcome = yield* useBucket(store, inventory, state.fluidFrontier, {
                  activeDimension: request.activeDimension,
                  targetDimension: request.targetDimension,
                  position,
                  heldItem: request.heldItem,
                })
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
              case 'CastFishing': {
                const active = yield* Ref.get(state.fishingSession)
                if (active !== undefined) {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: false,
                    outcome: 'AlreadyFishing',
                  })
                  break
                }
                const rolls = yield* Ref.modify(state.rollSeed, (seed) => {
                  const drawn = drawRolls(seed, 3)
                  return [
                    { wait: drawn.rolls[0]!, category: drawn.rolls[1]!, item: drawn.rolls[2]! },
                    drawn.seed,
                  ] as const
                })
                const outcome = castFishing(request.rod, request.environment, rolls)
                if (outcome._tag === 'Cast') {
                  yield* Ref.set(state.fishingSession, outcome.session)
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: true,
                    outcome,
                  })
                } else {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: false,
                    outcome,
                  })
                }
                break
              }
              case 'AdvanceFishing': {
                const session = yield* Ref.get(state.fishingSession)
                if (session === undefined) {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: false,
                    outcome: 'NoActiveFishingSession',
                  })
                  break
                }
                const outcome = advanceFishing(session, request.deltaTimeSecs, request.environment)
                if (
                  outcome._tag === 'Waiting' ||
                  outcome._tag === 'Bite' ||
                  outcome._tag === 'Escaped'
                ) {
                  yield* Ref.set(state.fishingSession, outcome.session)
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: true,
                    outcome,
                  })
                } else {
                  if (outcome._tag === 'Cancelled') {
                    yield* Ref.set(state.fishingSession, undefined)
                  }
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: false,
                    outcome,
                  })
                }
                break
              }
              case 'CancelFishing': {
                const session = yield* Ref.get(state.fishingSession)
                if (session === undefined) {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: false,
                    outcome: 'NoActiveFishingSession',
                  })
                  break
                }
                const outcome = cancelFishing(session)
                yield* Ref.set(state.fishingSession, undefined)
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  success: true,
                  outcome,
                })
                break
              }
              case 'ReelFishing': {
                const session = yield* Ref.get(state.fishingSession)
                if (session === undefined) {
                  itemUseResults.push({
                    action: request.action,
                    requestId: request.requestId,
                    success: false,
                    outcome: 'NoActiveFishingSession',
                  })
                  break
                }
                const outcome = reelFishing(session)
                yield* Ref.set(state.fishingSession, undefined)
                itemUseResults.push({
                  action: request.action,
                  requestId: request.requestId,
                  success: true,
                  outcome,
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

          const ignition = yield* useFlintAndSteel(
            store,
            yield* blockPositionForKey(request.positionKey),
            request.heldItem,
          )
          const success = ignition.outcome._tag === 'Lit'
          if (ignition._tag === 'Tnt' && success) {
            const position = yield* blockPositionForKey(request.positionKey)
            yield* roster.spawn({
              kind: PRIMED_TNT_KIND,
              feetPosition: {
                x: PositionAxis(position.x + 0.5),
                y: PositionAxis(position.y),
                z: PositionAxis(position.z + 0.5),
              },
              healthPoints: EntityHealthPoints(1),
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

            if (shot.inventory.mode === 'survival') {
              const consumeOutcome = yield* inventory.consumeAndDamageAt({
                consume: { item: 'arrow', count: 1 },
                damage: {
                  location: { _tag: 'Inventory', slotIndex: shot.inventory.slotIndex },
                  expectedItem: 'bow',
                  amount: 1,
                },
              })
              if (consumeOutcome._tag !== 'Applied') {
                if (shot.requestId !== undefined) {
                  bowShotResults.push({
                    requestId: shot.requestId,
                    success: false,
                    outcome: 'InventoryUnavailable',
                  })
                }
                continue
              }
            }

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
              x: PositionAxis(shot.origin.x + (shot.dirX / directionLength) * hit.distance),
              y: PositionAxis(shot.origin.y + (shot.dirY / directionLength) * hit.distance),
              z: PositionAxis(shot.origin.z + (shot.dirZ / directionLength) * hit.distance),
            }
            // A fractional midpoint, not a cell — kernel's `blockPosition()`
            // would throw on it. `chunkCoordsAround` takes the plain shape for
            // exactly this reason; see its own header.
            const centre = {
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
                const block = terrain.blockAt(BlockAxis(x), BlockAxis(y), BlockAxis(z))
                if (block === UNREADABLE_BLOCK) return true
                const passable = capabilityOfBlockId(block, 'passable')
                return Result.isFailure(passable) || !passable.success
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
            //
            // NO `undefined` GUARD: `hit.id` is `candidate.id` for some
            // `candidate` in this exact `candidates` array (`shotTarget`'s
            // `nearest = { id: candidate.id, distance: alongRay }`, bow-shot.ts).
            // `candidates` is read once for the whole batch (the comment above
            // this loop) and nothing between that read and here reassigns it or
            // removes a roster entry — terrain sampling and the damage/shove
            // math are both pure, and the roster is not touched again until
            // `resolveBowHits` runs after this loop. The lookup cannot miss.
            const target = candidates.find((candidate) => candidate.id === hit.id)!
            shoves.push({
              id: hit.id,
              direction: knockbackDirection(
                target.feetPosition.x - shot.origin.x,
                target.feetPosition.z - shot.origin.z,
              ),
            })
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

            if (thrown.inventory.mode === 'survival') {
              const removed = yield* inventory.removeAt(
                thrown.inventory.slotIndex,
                'ender_pearl',
                1,
              )
              if (removed._tag !== 'Removed') continue
            }

            pearlOutcomes.push({
              displacement,
              damage:
                thrown.inventory.mode === 'creative'
                  ? undefined
                  : { amount: ENDER_PEARL_DAMAGE, cause: ENDER_PEARL_DEATH_CAUSE },
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
                x: PositionAxis(playerFeet.x + displacement.x),
                y: PositionAxis(playerFeet.y + displacement.y),
                z: PositionAxis(playerFeet.z + displacement.z),
              },
              healthPoints: EntityHealthPoints(ENDERMITE_MAX_HEALTH),
              behaviour: undefined,
            })
          }
        }

        // ---- THE DEPOSIT ---------------------------------------------------
        //
        // Deposit each mined stack into mc-sim's inventory in mining order.
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
      }).pipe(Effect.orDie),
  }
}
