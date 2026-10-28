/**
 * ONE RULE, ONE FILE (DN-GP-9): the player breaks the block they are looking at.
 *
 * This is the first of the ~40 interaction handlers plan.md §3.11 keeps at
 * one-rule-per-file granularity. They are many files and ONE stage
 * (`gameplay:interactions`): the granularity that matters for review is the
 * rule, the granularity that matters for composition is the stage.
 *
 * ---------------------------------------------------------------------------
 * Why there is no read here
 * ---------------------------------------------------------------------------
 *
 * The two-argument compatibility path still mirrors the old one-write rule:
 * `setBlock` returns the block it replaced (`mc-worldgen/docs/public-api.md`
 * §6-3), so that path performs one store call and yields the replaced block.
 * The transaction overload instead observes through C4 so the cascade, owner
 * candidate, and C7 batch all share the revision used by the commit.
 *
 * ---------------------------------------------------------------------------
 * Where the item goes
 * ---------------------------------------------------------------------------
 *
 * `Broken.yielded` travels to mc-sim's `InventoryService` — plan.md §2.3-1's
 * worked example. The legacy stage path parks it in frame-local scratch; the
 * transaction overload returns it in `CommittedCascade` for the stage to use.
 */
import { Effect, Result, Schema } from 'effect'
import {
  AIR_BLOCK_ID,
  BlockIdSchema,
  BlockPositionSchema,
  DimensionIdSchema,
  DimensionRevisionSchema,
  WorldRevisionSchema,
  adjacentBlockPosition,
  chunkCoordOfBlock,
  canBlockStaySupported,
  type BlockId,
  type BlockPosition,
  type ChunkCoord,
  type Dimension,
  type DimensionRevision,
  type WorldRevision,
} from '@nerima-games/mc-kernel'
import { isDoorBlock } from './place-door-upper.js'
import {
  PlayerStorageSnapshotSchema,
  EquipmentItemSchema,
  WorldCommitChunkStoreUnavailable,
  WorldCommitCoordinatorErrorSchema,
  WorldCommitCoordinatorSnapshotErrorSchema,
  damageAt,
  type WorldCommitCoordinatorError,
  type ReplicatedOwnerId,
  type StorageLocation,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
  type WorldReadSnapshot,
} from '@nerima-games/mc-sim'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'

/**
 * TOTAL, mirroring `BlockWriteOutcome`. There is no error channel here because
 * there is none in `StageRegistration.run` (kernel's `domain/frame.ts`), so a
 * failure would have nowhere to go but a `catchAll` that drops it.
 */
export type BreakOutcome =
  /** The block was removed. `yielded` is what the player now holds. */
  | { readonly _tag: 'Broken'; readonly yielded: BlockId; readonly chunk: ChunkCoord }
  /** The cell was already air. Nothing mined, nothing dirtied, nothing to fall. */
  | { readonly _tag: 'NothingThere' }
  /** Out of the resident area. NOT air — the world there is unknown, not empty. */
  | { readonly _tag: 'ChunkNotLoaded' }
  /** Below bedrock or above the build limit. */
  | { readonly _tag: 'OutOfWorld' }

export type BreakBlockPlanContext = Readonly<{
  readonly coordinator: WorldCommitCoordinatorApi
  readonly dimension: Dimension
  readonly ownerId: ReplicatedOwnerId
  /** Captured when the mining action starts. `undefined` means the player used a hand. */
  readonly toolLocation: StorageLocation | undefined
}>

export type BreakTransactionContext = BreakBlockPlanContext

type BreakBlockPlanRequest = WorldCommitRequest & Readonly<{
  readonly blockWrite: NonNullable<WorldCommitRequest['blockWrite']>
}>

export type PlannedCascade = Readonly<{
  readonly _tag: 'PlannedCascade'
  readonly request: BreakBlockPlanRequest
  readonly ownerSnapshot: WorldReadSnapshot<typeof PlayerStorageSnapshotSchema>
  readonly candidateStorage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>
  readonly outcome: Extract<BreakOutcome, { readonly _tag: 'Broken' }>
  readonly primary: BlockPosition
  readonly yielded: BlockId
  readonly removed: ReadonlyArray<BlockPosition>
}>

export type BreakBlockPlanResult =
  | PlannedCascade
  | { readonly _tag: 'TransactionFailure'; readonly failure: BreakTransactionFailure }

const BreakToolDamageResultSchema = Schema.Union([
  Schema.TaggedStruct('InvalidLocation', {}),
  Schema.TaggedStruct('Empty', {}),
  Schema.TaggedStruct('NotDamageable', { item: EquipmentItemSchema }),
  Schema.TaggedStruct('Damaged', { item: EquipmentItemSchema, applied: Schema.Int }),
  Schema.TaggedStruct('Broken', { item: EquipmentItemSchema, applied: Schema.Int }),
])

type ObservationFailure =
  | Schema.Schema.Type<typeof WorldCommitCoordinatorSnapshotErrorSchema>
  | WorldCommitChunkStoreUnavailable

const ObservationFailureSchema: Schema.Codec<ObservationFailure, unknown> = Schema.Union([
  WorldCommitCoordinatorSnapshotErrorSchema,
  Schema.instanceOf(WorldCommitChunkStoreUnavailable),
])

export type BreakTransactionFailure =
  | { readonly _tag: 'MissingTransactionContext' }
  | { readonly _tag: 'BlockUnavailable'; readonly reason: 'air' | 'chunk-not-loaded' | 'out-of-world' }
  | { readonly _tag: 'ObservationIncomplete'; readonly position: BlockPosition }
  | { readonly _tag: 'ObservationFailed'; readonly error: ObservationFailure }
  | { readonly _tag: 'ObservationChanged'; readonly expectedWorldRevision: WorldRevision; readonly actualWorldRevision: WorldRevision }
  | { readonly _tag: 'ToolDamageRejected'; readonly reason: 'InvalidLocation' }
  | { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError }

export const BreakTransactionFailureSchema: Schema.Codec<BreakTransactionFailure, unknown> = Schema.Union([
  Schema.TaggedStruct('MissingTransactionContext', {}),
  Schema.TaggedStruct('BlockUnavailable', {
    reason: Schema.Literals(['air', 'chunk-not-loaded', 'out-of-world']),
  }),
  Schema.TaggedStruct('ObservationIncomplete', { position: BlockPositionSchema }),
  Schema.TaggedStruct('ObservationFailed', { error: ObservationFailureSchema }),
  Schema.TaggedStruct('ObservationChanged', {
    expectedWorldRevision: WorldRevisionSchema,
    actualWorldRevision: WorldRevisionSchema,
  }),
  Schema.TaggedStruct('ToolDamageRejected', {
    reason: Schema.Literal('InvalidLocation'),
  }),
  Schema.TaggedStruct('CommitFailed', { error: WorldCommitCoordinatorErrorSchema }),
])

export type BreakTransactionResult =
  | {
      readonly _tag: 'CommittedCascade'
      readonly primary: BlockPosition
      readonly yielded: BlockId
      readonly removed: ReadonlyArray<BlockPosition>
      readonly worldRevision: WorldRevision
      readonly dimensionRevision: DimensionRevision
    }
  | { readonly _tag: 'TransactionFailure'; readonly failure: BreakTransactionFailure }

export const BreakTransactionResultSchema: Schema.Codec<BreakTransactionResult, unknown> = Schema.Union([
  Schema.TaggedStruct('CommittedCascade', {
    primary: BlockPositionSchema,
    yielded: BlockIdSchema,
    /** Primary position first, followed by each support-removal breadth-first wave. */
    removed: Schema.Array(BlockPositionSchema),
    worldRevision: WorldRevisionSchema,
    dimensionRevision: DimensionRevisionSchema,
  }),
  Schema.TaggedStruct('TransactionFailure', { failure: BreakTransactionFailureSchema }),
])

type BreakFailure = Extract<BreakTransactionResult, { readonly _tag: 'TransactionFailure' }>

const failure = (reason: BreakTransactionFailure): BreakFailure => ({
  _tag: 'TransactionFailure',
  failure: reason,
})

const positionKey = (position: BlockPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

const breakBlockLegacy = (
  store: ChunkStoreApi,
  position: BlockPosition,
): Effect.Effect<BreakOutcome> =>
  Effect.map(store.setBlock(position, AIR_BLOCK_ID), (outcome): BreakOutcome => {
    if (outcome._tag === 'Written') {
      return { _tag: 'Broken', yielded: outcome.previous, chunk: outcome.chunk }
    }

    // `Unchanged` means air was already there: the write did not dirty the
    // chunk, and this rule must not invent an item or a disturbance out of
    // it. A player swinging at empty space is a legal thing to do, and
    // treating it as a break would drop air into the inventory and re-mesh
    // the chunk on every frame the button is held.
    if (outcome._tag === 'Unchanged') {
      return { _tag: 'NothingThere' }
    }

    // The store refused because it does not know that cell. Answering "there
    // was air there" would be the two-valued read that drops sand out of the
    // world one file over.
    if (outcome._tag === 'ChunkNotLoaded') {
      return { _tag: 'ChunkNotLoaded' }
    }

    return { _tag: 'OutOfWorld' }
  })

export const planBreakBlock = (
  position: BlockPosition,
  context: BreakBlockPlanContext,
): Effect.Effect<BreakBlockPlanResult> =>
  Effect.gen(function* () {
    const dimension = Schema.decodeUnknownSync(DimensionIdSchema)(context.dimension)

    const observe = (positions: ReadonlyArray<BlockPosition>) =>
      Effect.result(context.coordinator.observe(
        context.ownerId,
        PlayerStorageSnapshotSchema,
        positions.map((candidate) => ({ dimension, position: candidate })),
      ))

    const initialResult = yield* observe([position])
    if (Result.isFailure(initialResult)) {
      return failure({ _tag: 'ObservationFailed', error: initialResult.failure })
    }
    const initial = initialResult.success
    const primaryRead = initial.blocks.find((block) => positionKey(block.position) === positionKey(position))
    if (primaryRead === undefined) {
      return failure({ _tag: 'ObservationIncomplete', position })
    }
    if (primaryRead.reading._tag === 'ChunkNotLoaded') {
      return failure({ _tag: 'BlockUnavailable', reason: 'chunk-not-loaded' })
    }
    if (primaryRead.reading._tag === 'OutOfWorld') {
      return failure({ _tag: 'BlockUnavailable', reason: 'out-of-world' })
    }
    if (primaryRead.reading.block === AIR_BLOCK_ID) {
      return failure({ _tag: 'BlockUnavailable', reason: 'air' })
    }

    let candidateStorage = initial.state
    if (context.toolLocation !== undefined) {
      const damaged = damageAt(candidateStorage, context.toolLocation, 1)
      const damageResult = Schema.decodeUnknownSync(BreakToolDamageResultSchema)(damaged.result)
      if (damageResult._tag === 'InvalidLocation') {
        return failure({ _tag: 'ToolDamageRejected', reason: 'InvalidLocation' })
      }
      candidateStorage = damaged.storage
    }

    const removed: Array<BlockPosition> = [position]
    let parent: Readonly<{ position: BlockPosition; block: BlockId }> = {
      position,
      block: primaryRead.reading.block,
    }

    while (true) {
      const above = Result.getOrThrow(adjacentBlockPosition(parent.position, 'up'))
      const snapshotResult = yield* observe([above])
      if (Result.isFailure(snapshotResult)) {
        return failure({ _tag: 'ObservationFailed', error: snapshotResult.failure })
      }
      const snapshot = snapshotResult.success
      if (snapshot.revision !== initial.revision) {
        return failure({
          _tag: 'ObservationChanged',
          expectedWorldRevision: initial.revision,
          actualWorldRevision: snapshot.revision,
        })
      }

      const read = snapshot.blocks.find((block) => positionKey(block.position) === positionKey(above))
      if (read === undefined) {
        return failure({ _tag: 'ObservationIncomplete', position: above })
      }
      const reading = read.reading
      if (reading._tag === 'ChunkNotLoaded') {
        return failure({ _tag: 'BlockUnavailable', reason: 'chunk-not-loaded' })
      }
      if (reading._tag === 'OutOfWorld' || reading.block === AIR_BLOCK_ID) break

      const pairedDoor = isDoorBlock(parent.block) && isDoorBlock(reading.block)
      const isSupported = Result.getOrThrow(canBlockStaySupported(reading.block, AIR_BLOCK_ID))
      if (!pairedDoor && isSupported) break

      removed.push(above)
      parent = { position: above, block: reading.block }
    }

    const expectedDimensionRevision = yield* context.coordinator.dimensionRevision(dimension)
    const request: BreakBlockPlanRequest = {
      expectedRevision: initial.revision,
      expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
      changes: [{ ownerId: context.ownerId, state: candidateStorage }],
      blockWrite: {
        world: context.coordinator.worldId,
        expectedWorldRevision: initial.revision,
        dimension,
        expectedDimensionRevision,
        edits: removed.map((removedPosition) => ({ position: removedPosition, block: AIR_BLOCK_ID })),
      },
    }

    const yielded = primaryRead.reading.block
    return {
      _tag: 'PlannedCascade',
      request,
      ownerSnapshot: initial,
      candidateStorage,
      outcome: { _tag: 'Broken', yielded, chunk: chunkCoordOfBlock(position) },
      primary: position,
      yielded,
      removed,
    }
  })

const transactionBreakBlock = (
  position: BlockPosition,
  context: BreakTransactionContext,
): Effect.Effect<BreakTransactionResult> =>
  Effect.gen(function* () {
    const plan = yield* planBreakBlock(position, context)
    if (plan._tag === 'TransactionFailure') return plan

    const commitResult = yield* Effect.result(context.coordinator.commit(plan.request))
    if (Result.isFailure(commitResult)) {
      return failure({ _tag: 'CommitFailed', error: commitResult.failure })
    }

    const committedDimensionRevision = Schema.decodeUnknownSync(DimensionRevisionSchema)(
      plan.request.blockWrite.expectedDimensionRevision + 1,
    )
    return {
      _tag: 'CommittedCascade',
      primary: plan.primary,
      yielded: plan.yielded,
      removed: plan.removed,
      worldRevision: commitResult.success.revision,
      dimensionRevision: committedDimensionRevision,
    }
  })

export function breakBlock(
  store: ChunkStoreApi,
  position: BlockPosition,
): Effect.Effect<BreakOutcome>
export function breakBlock(
  store: ChunkStoreApi,
  position: BlockPosition,
  context: undefined,
): Effect.Effect<BreakTransactionResult>
export function breakBlock(
  store: ChunkStoreApi,
  position: BlockPosition,
  context: BreakTransactionContext,
): Effect.Effect<BreakTransactionResult>
export function breakBlock(
  store: ChunkStoreApi,
  position: BlockPosition,
  context?: BreakTransactionContext,
): Effect.Effect<BreakOutcome | BreakTransactionResult> {
  if (arguments.length < 3) return breakBlockLegacy(store, position)
  if (context === undefined) return Effect.succeed(failure({ _tag: 'MissingTransactionContext' }))
  return transactionBreakBlock(position, context)
}
