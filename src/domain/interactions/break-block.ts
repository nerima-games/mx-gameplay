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
  DimensionRevisionSchema,
  DimensionIdSchema,
  WorldRevisionSchema,
  adjacentBlockPosition,
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
  WorldCommitChunkStoreUnavailable,
  WorldCommitCoordinatorErrorSchema,
  WorldCommitCoordinatorSnapshotErrorSchema,
  damageAt,
  type InventoryServiceApi,
  type WorldCommitCoordinatorError,
  type ReplicatedOwnerId,
  type StorageLocation,
  type WorldCommitCoordinatorApi,
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

export type BreakTransactionContext = Readonly<{
  readonly coordinator: WorldCommitCoordinatorApi
  readonly dimension: Dimension
  readonly ownerId: ReplicatedOwnerId
  readonly inventory: Pick<InventoryServiceApi, 'restoreStorage'>
  /** Captured when the mining action starts. `undefined` means the player used a hand. */
  readonly toolLocation: StorageLocation | undefined
}>

type ObservationFailure =
  | Schema.Schema.Type<typeof WorldCommitCoordinatorSnapshotErrorSchema>
  | WorldCommitChunkStoreUnavailable

const ObservationFailureSchema: Schema.Codec<ObservationFailure, unknown> = Schema.Union([
  WorldCommitCoordinatorSnapshotErrorSchema,
  Schema.instanceOf(WorldCommitChunkStoreUnavailable),
])

export type BreakTransactionFailure =
  | { readonly _tag: 'MissingTransactionContext' }
  | { readonly _tag: 'InvalidDimension' }
  | { readonly _tag: 'BlockUnavailable'; readonly reason: 'air' | 'chunk-not-loaded' | 'out-of-world' }
  | { readonly _tag: 'ObservationIncomplete'; readonly position: BlockPosition }
  | { readonly _tag: 'ObservationFailed'; readonly error: ObservationFailure }
  | { readonly _tag: 'ObservationChanged'; readonly expectedWorldRevision: WorldRevision; readonly actualWorldRevision: WorldRevision }
  | { readonly _tag: 'ToolDamageRejected'; readonly reason: 'InvalidLocation' | 'InvalidDurability' }
  | { readonly _tag: 'SupportRuleFailed'; readonly position: BlockPosition }
  | { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError }

export const BreakTransactionFailureSchema: Schema.Codec<BreakTransactionFailure, unknown> = Schema.Union([
  Schema.TaggedStruct('MissingTransactionContext', {}),
  Schema.TaggedStruct('InvalidDimension', {}),
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
    reason: Schema.Literals(['InvalidLocation', 'InvalidDurability']),
  }),
  Schema.TaggedStruct('SupportRuleFailed', { position: BlockPositionSchema }),
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

const failure = (reason: BreakTransactionFailure): BreakTransactionResult => ({
  _tag: 'TransactionFailure',
  failure: reason,
})

const positionKey = (position: BlockPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

const comparePosition = (left: BlockPosition, right: BlockPosition): number =>
  left.x - right.x || left.y - right.y || left.z - right.z

const breakBlockLegacy = (
  store: ChunkStoreApi,
  position: BlockPosition,
): Effect.Effect<BreakOutcome> =>
  Effect.map(store.setBlock(position, AIR_BLOCK_ID), (outcome): BreakOutcome => {
    switch (outcome._tag) {
      case 'Written':
        return { _tag: 'Broken', yielded: outcome.previous, chunk: outcome.chunk }

      // `Unchanged` means air was already there: the write did not dirty the
      // chunk, and this rule must not invent an item or a disturbance out of
      // it. A player swinging at empty space is a legal thing to do, and
      // treating it as a break would drop air into the inventory and re-mesh
      // the chunk on every frame the button is held.
      case 'Unchanged':
        return { _tag: 'NothingThere' }

      // The store refused because it does not know that cell. Answering "there
      // was air there" would be the two-valued read that drops sand out of the
      // world one file over.
      case 'ChunkNotLoaded':
        return { _tag: 'ChunkNotLoaded' }

      case 'OutOfWorld':
        return { _tag: 'OutOfWorld' }
      // exhaustiveness arm over BlockWriteOutcome, a closed four-tag union
      // (mc-worldgen's chunk-store-state.d.ts): 'Written', 'Unchanged', 'ChunkNotLoaded' and
      // 'OutOfWorld' are all handled above, so no input can reach this arm.
      /* v8 ignore start */
      default: {
        const exhaustive: never = outcome
        return exhaustive
      }
      /* v8 ignore stop */
    }
  })

const transactionBreakBlock = (
  position: BlockPosition,
  context: BreakTransactionContext,
): Effect.Effect<BreakTransactionResult> =>
  Effect.gen(function* () {
    const decodedDimension = Schema.decodeUnknownResult(DimensionIdSchema)(context.dimension)
    if (Result.isFailure(decodedDimension)) {
      return failure({ _tag: 'InvalidDimension' })
    }
    const dimension = decodedDimension.success

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
      switch (damaged.result._tag) {
        case 'InvalidLocation':
          return failure({ _tag: 'ToolDamageRejected', reason: 'InvalidLocation' })
        case 'InvalidDurability':
        case 'EquipmentFailure':
        case 'InvalidAmount':
          return failure({ _tag: 'ToolDamageRejected', reason: 'InvalidDurability' })
        case 'Damaged':
        case 'Broken':
        case 'Empty':
        case 'NotDamageable':
          candidateStorage = damaged.storage
          break
        default: {
          const exhaustive: never = damaged.result
          return exhaustive
        }
      }
    }

    const removed: Array<BlockPosition> = [position]
    const removedBlocks = new Map([[positionKey(position), primaryRead.reading.block]])
    let wave: ReadonlyArray<BlockPosition> = [position]

    while (wave.length > 0) {
      const parents = wave
      const candidates = new Map<string, Readonly<{ position: BlockPosition; parent: BlockPosition }>>()
      for (const parent of parents) {
        const above = Result.getOrUndefined(adjacentBlockPosition(parent, 'up'))
        if (above === undefined || removedBlocks.has(positionKey(above))) continue
        const key = positionKey(above)
        if (!candidates.has(key)) candidates.set(key, { position: above, parent })
      }
      const orderedCandidates = [...candidates.values()].sort((left, right) =>
        comparePosition(left.position, right.position),
      )
      if (orderedCandidates.length === 0) break

      const snapshotResult = yield* observe(orderedCandidates.map((candidate) => candidate.position))
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

      const reads = new Map(snapshot.blocks.map((block) => [positionKey(block.position), block.reading]))
      const nextWave: Array<BlockPosition> = []
      for (const candidate of orderedCandidates) {
        const reading = reads.get(positionKey(candidate.position))
        if (reading === undefined) {
          return failure({ _tag: 'ObservationIncomplete', position: candidate.position })
        }
        if (reading._tag === 'ChunkNotLoaded') {
          return failure({ _tag: 'BlockUnavailable', reason: 'chunk-not-loaded' })
        }
        if (reading._tag === 'OutOfWorld' || reading.block === AIR_BLOCK_ID) continue

        const parentBlock = removedBlocks.get(positionKey(candidate.parent))
        const pairedDoor =
          parentBlock !== undefined && isDoorBlock(parentBlock) && isDoorBlock(reading.block)
        const support = canBlockStaySupported(reading.block, AIR_BLOCK_ID)
        if (Result.isFailure(support)) {
          return failure({ _tag: 'SupportRuleFailed', position: candidate.position })
        }
        const lacksSupport = !support.success
        if (!pairedDoor && !lacksSupport) continue

        removedBlocks.set(positionKey(candidate.position), reading.block)
        removed.push(candidate.position)
        nextWave.push(candidate.position)
      }
      wave = nextWave
    }

    const expectedDimensionRevision = yield* context.coordinator.dimensionRevision(dimension)
    const commitResult = yield* Effect.result(context.coordinator.commit({
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
    }))
    if (Result.isFailure(commitResult)) {
      return failure({ _tag: 'CommitFailed', error: commitResult.failure })
    }

    // A successful C7 commit increments each affected dimension once. Derive
    // this commit's revision from its accepted precondition instead of reading
    // again after the coordinator gate, where another commit could intervene.
    const committedDimensionRevision = Schema.decodeUnknownSync(DimensionRevisionSchema)(
      expectedDimensionRevision + 1,
    )

    // The successful commit decoded this candidate with PlayerStorageSnapshotSchema.
    // restoreStorage validates the same player-storage invariants before updating
    // its Ref, so rejection here would mean that the committed candidate and the
    // local mirror disagree about the shared schema. Surface that invariant break
    // as a defect rather than returning a failure after the world already committed.
    yield* Effect.orDie(context.inventory.restoreStorage(candidateStorage))
    return {
      _tag: 'CommittedCascade',
      primary: position,
      yielded: primaryRead.reading.block,
      removed,
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
