import {
  addItem,
  BucketUseOutcomeSchema as BucketServiceOutcomeSchema,
  removeItem,
  withInventory,
  validatePlayerStorageSnapshot,
  PlayerStorageSnapshotSchema,
  type InventoryServiceApi,
  type ItemStackFailure,
  type PlayerStorage,
  type PlayerStorageFailure,
  type PlayerStorageValidationError,
  type BucketServiceApi,
  type BucketServiceError,
  type ReplicatedOwnerId,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Equal, Option, Ref, Result, Schema } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import {
  AIR_BLOCK_ID,
  DimensionIdSchema,
  type BlockId,
  type BlockPosition,
  type ChunkCoord,
  type WorldWriteBatch,
} from '@nerima-games/mc-kernel'
import { blockPosition, blockPositionKeyOf, type ItemType } from '@nerima-games/mc-kernel'
import { chunkCoordOf } from '../chunk-window.js'
import {
  enqueueFluidDisturbance,
  type FluidKind,
  type FluidWorkItem,
} from '../fluid-frontier.js'
import type { ChunkStoreApi, Dimension } from '@nerima-games/mc-worldgen'

export const BUCKET_ITEM_TYPES = ['bucket', 'water_bucket', 'lava_bucket'] as const
export type BucketItemType = (typeof BUCKET_ITEM_TYPES)[number]

const BUCKET_ITEM_NAMES: ReadonlySet<string> = new Set<string>(BUCKET_ITEM_TYPES)

export const isBucketItem = (item: ItemType): item is BucketItemType =>
  BUCKET_ITEM_NAMES.has(item)

export type BucketUseRequest = {
  readonly activeDimension: Dimension
  readonly targetDimension: Dimension
  readonly position: BlockPosition
  readonly heldItem: BucketItemType
  readonly playerStorageOwnerId: ReplicatedOwnerId
}

export type BucketUseOutcome =
  | {
      readonly _tag: 'Collected'
      readonly fluid: FluidKind
      readonly position: BlockPosition
      readonly chunk: ChunkCoord
    }
  | {
      readonly _tag: 'Placed'
      readonly fluid: FluidKind
      readonly position: BlockPosition
      readonly chunk: ChunkCoord
    }
  | {
      readonly _tag: 'WrongDimension'
      readonly activeDimension: Dimension
      readonly targetDimension: Dimension
    }
  | { readonly _tag: 'WrongTarget'; readonly block: BlockId }
  | { readonly _tag: 'Occupied'; readonly block: BlockId }
  | { readonly _tag: 'MissingItem'; readonly item: BucketItemType }
  | { readonly _tag: 'InventoryFull'; readonly item: BucketItemType }
  | { readonly _tag: 'InventoryOperationFailed'; readonly failure: ItemStackFailure }
  | {
      readonly _tag: 'StorageOperationFailed'
      readonly failure: PlayerStorageFailure | PlayerStorageValidationError | ItemStackFailure
    }
  | { readonly _tag: 'InventoryOutOfSync' }
  | { readonly _tag: 'ChunkNotLoaded' }
  | { readonly _tag: 'OutOfWorld' }
  | { readonly _tag: 'WorldChanged' }
  | { readonly _tag: 'CommitContextMissing' }

type BucketPlan = {
  readonly action: 'collect' | 'place'
  readonly fluid: FluidKind
  readonly nextBlock: BlockId
  readonly nextItem: BucketItemType
}

const fluidBlockId = (fluid: FluidKind): BlockId | undefined => Option.getOrUndefined(blockIdOf(fluid))

const planBucketUse = (heldItem: BucketItemType, block: BlockId): BucketPlan | undefined => {
  const waterBlock = fluidBlockId('water')
  const lavaBlock = fluidBlockId('lava')

  if (heldItem === 'bucket') {
    if (waterBlock !== undefined && block === waterBlock) {
      return {
        action: 'collect',
        fluid: 'water',
        nextBlock: AIR_BLOCK_ID,
        nextItem: 'water_bucket',
      }
    }
    if (lavaBlock !== undefined && block === lavaBlock) {
      return {
        action: 'collect',
        fluid: 'lava',
        nextBlock: AIR_BLOCK_ID,
        nextItem: 'lava_bucket',
      }
    }
    return undefined
  }

  if (block !== AIR_BLOCK_ID) {
    return undefined
  }

  const fluid: FluidKind = heldItem === 'water_bucket' ? 'water' : 'lava'
  const nextBlock = fluidBlockId(fluid)
  // UNREACHABLE TODAY, same shape as `./ignite-fire`'s `UnknownBlock`:
  // `FluidKind` is closed to 'water' | 'lava' (fluid-frontier.ts), and
  // kernel's own type declaration proves `blockIdOf` total over
  // every `BlockType`, water and lava included, so no legal `fluid` value
  // can reach this branch.
  /* v8 ignore start */
  if (nextBlock === undefined) {
    return undefined
  }
  /* v8 ignore stop */
  return {
    action: 'place',
    fluid,
    nextBlock,
    nextItem: 'bucket',
  }
}

/**
 * Exchange one bucket item and one world cell through mc-sim's C4/C7 commit.
 *
 * The coordinator observation supplies both the replicated storage owner and
 * the target block at one world revision. The inventory service must match that
 * owner state before a candidate is built; the bucket service then commits the
 * candidate and block edit together. The local inventory mirror and fluid
 * frontier are updated only after that commit succeeds.
 */
type LegacyBucketUseRequest = Omit<BucketUseRequest, 'playerStorageOwnerId'>

type LegacyBucketUseArguments = readonly [
  store: ChunkStoreApi,
  inventory: InventoryServiceApi,
  fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  request: LegacyBucketUseRequest,
]

type CoordinatedBucketUseArguments = readonly [
  inventory: InventoryServiceApi,
  bucketService: BucketServiceApi,
  coordinator: WorldCommitCoordinatorApi,
  fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  request: BucketUseRequest,
]

const useBucketWithCommit = (
  inventory: InventoryServiceApi,
  bucketService: BucketServiceApi,
  coordinator: WorldCommitCoordinatorApi,
  fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  request: BucketUseRequest,
): Effect.Effect<
  BucketUseOutcome,
  | BucketServiceError
  | PlayerStorageValidationError
  | ItemStackFailure
> =>
  Effect.gen(function* () {
    if (request.activeDimension !== request.targetDimension) {
      return {
        _tag: 'WrongDimension',
        activeDimension: request.activeDimension,
        targetDimension: request.targetDimension,
      }
    }

    const localStorage = yield* inventory.storageSnapshot
    const removal = removeItem(localStorage.inventory, request.heldItem, 1)
    if (Result.isFailure(removal)) {
      return { _tag: 'InventoryOperationFailed', failure: removal.failure }
    }
    const removed = removal.success
    if (removed.removed !== 1) {
      return { _tag: 'MissingItem', item: request.heldItem }
    }

    const dimension = yield* Schema.decodeUnknownEffect(DimensionIdSchema)(request.targetDimension)
    const observation = yield* coordinator.observe(
      request.playerStorageOwnerId,
      PlayerStorageSnapshotSchema,
      [{ dimension, position: request.position }],
    )
    if (!Equal.equals(localStorage, observation.state)) {
      return { _tag: 'InventoryOutOfSync' }
    }

    const target = observation.blocks[0]
    if (target === undefined) {
      return { _tag: 'WorldChanged' }
    }
    if (target.reading._tag !== 'Block') {
      return target.reading
    }

    const plan = planBucketUse(request.heldItem, target.reading.block)
    if (plan === undefined) {
      return request.heldItem === 'bucket'
        ? { _tag: 'WrongTarget', block: target.reading.block }
        : { _tag: 'Occupied', block: target.reading.block }
    }

    const addition = addItem(removed.inventory, plan.nextItem, 1)
    if (Result.isFailure(addition)) {
      return { _tag: 'InventoryOperationFailed', failure: addition.failure }
    }
    const added = addition.success
    if (added.leftover !== 0) {
      return { _tag: 'InventoryFull', item: plan.nextItem }
    }

    const candidateResult = withInventory(observation.state, added.inventory)
    if (Result.isFailure(candidateResult)) {
      return { _tag: 'StorageOperationFailed', failure: candidateResult.failure }
    }
    const candidate: PlayerStorage = candidateResult.success
    const validation = validatePlayerStorageSnapshot(candidate)
    if (validation._tag === 'Invalid' || validation._tag === 'ItemStackFailure') {
      return { _tag: 'StorageOperationFailed', failure: validation.error }
    }

    const expectedDimensionRevision = yield* coordinator.dimensionRevision(dimension)
    const blockWrite: WorldWriteBatch = {
      world: observation.world,
      expectedWorldRevision: observation.revision,
      dimension,
      expectedDimensionRevision,
      edits: [{ position: request.position, block: plan.nextBlock }],
    }

    const commitResult = yield* bucketService.commitUse({
      playerOwnerId: request.playerStorageOwnerId,
      playerStorage: candidate,
      blockWrite,
    })
    const committed = yield* Schema.decodeUnknownEffect(BucketServiceOutcomeSchema)(commitResult)
    if (committed._tag !== 'Committed') {
      return { _tag: 'WorldChanged' }
    }

    yield* inventory.restoreStorage(candidate)
    yield* Ref.update(fluidFrontier, (frontier) =>
      enqueueFluidDisturbance(frontier, {
        key: blockPositionKeyOf(
          blockPosition(request.position.x, request.position.y, request.position.z),
        ),
        kind: plan.fluid,
      }),
    )

    return {
      _tag: plan.action === 'collect' ? 'Collected' : 'Placed',
      fluid: plan.fluid,
      position: request.position,
      chunk: chunkCoordOf(request.position),
    }
  })

export function useBucket(...args: LegacyBucketUseArguments): Effect.Effect<BucketUseOutcome>
export function useBucket(
  ...args: CoordinatedBucketUseArguments
): Effect.Effect<
  BucketUseOutcome,
  BucketServiceError | PlayerStorageValidationError | ItemStackFailure
>
export function useBucket(
  ...args: LegacyBucketUseArguments | CoordinatedBucketUseArguments
): Effect.Effect<
  BucketUseOutcome,
  BucketServiceError | PlayerStorageValidationError | ItemStackFailure
> {
  if (args.length === 4) {
    return Effect.succeed({ _tag: 'CommitContextMissing' })
  }
  return useBucketWithCommit(...args)
}
