import {
  addItem,
  removeItem,
  withInventory,
  PlayerStorageSnapshotSchema,
  type InventoryServiceApi,
  type PlayerStorage,
  type ReplicatedOwnerId,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
  type WorldCommitRequest,
} from '@nerima-games/mc-sim'
import { Effect, Option, Ref, Result, Schema } from 'effect'
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

const FLUID_BLOCK_IDS: Readonly<Record<FluidKind, BlockId>> = {
  water: Option.getOrThrow(blockIdOf('water')),
  lava: Option.getOrThrow(blockIdOf('lava')),
}

const fluidBlockId = (fluid: FluidKind): BlockId => FLUID_BLOCK_IDS[fluid]

const planBucketUse = (heldItem: BucketItemType, block: BlockId): BucketPlan | undefined => {
  const waterBlock = fluidBlockId('water')
  const lavaBlock = fluidBlockId('lava')

  if (heldItem === 'bucket') {
    if (block === waterBlock) {
      return {
        action: 'collect',
        fluid: 'water',
        nextBlock: AIR_BLOCK_ID,
        nextItem: 'water_bucket',
      }
    }
    if (block === lavaBlock) {
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
  return {
    action: 'place',
    fluid,
    nextBlock,
    nextItem: 'bucket',
  }
}

/**
 * Exchange one bucket item and one world cell through one C4/C7 commit.
 *
 * The coordinator observation is authoritative for both storage and the target
 * block. The fluid frontier is updated only after the owner and block commit.
 */
type LegacyBucketUseRequest = Omit<BucketUseRequest, 'playerStorageOwnerId'>

type LegacyBucketUseArguments = readonly [
  store: ChunkStoreApi,
  inventory: InventoryServiceApi,
  fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  request: LegacyBucketUseRequest,
]

type CoordinatedBucketUseArguments = readonly [
  coordinator: WorldCommitCoordinatorApi,
  fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  request: BucketUseRequest,
]

const useBucketWithCommit = (
  coordinator: WorldCommitCoordinatorApi,
  fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  request: BucketUseRequest,
): Effect.Effect<
  BucketUseOutcome,
  | WorldCommitCoordinatorError
  | Schema.SchemaError
> =>
  Effect.gen(function* () {
    if (request.activeDimension !== request.targetDimension) {
      return {
        _tag: 'WrongDimension',
        activeDimension: request.activeDimension,
        targetDimension: request.targetDimension,
      }
    }

    const dimension = yield* Schema.decodeUnknownEffect(DimensionIdSchema)(request.targetDimension)
    const observation = yield* coordinator.observe(
      request.playerStorageOwnerId,
      PlayerStorageSnapshotSchema,
      [{ dimension, position: request.position }],
    )

    const removed = Result.getOrThrow(removeItem(observation.state.inventory, request.heldItem, 1))
    if (removed.removed !== 1) {
      return { _tag: 'MissingItem', item: request.heldItem }
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

    const added = Result.getOrThrow(addItem(removed.inventory, plan.nextItem, 1))
    if (added.leftover !== 0) {
      return { _tag: 'InventoryFull', item: plan.nextItem }
    }

    const candidate: PlayerStorage = Result.getOrThrow(withInventory(observation.state, added.inventory))

    const expectedDimensionRevision = yield* coordinator.dimensionRevision(dimension)
    const blockWrite: WorldWriteBatch = {
      world: observation.world,
      expectedWorldRevision: observation.revision,
      dimension,
      expectedDimensionRevision,
      edits: [{ position: request.position, block: plan.nextBlock }],
    }

    const commitRequest: WorldCommitRequest = {
      expectedRevision: observation.revision,
      expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
      changes: [{ ownerId: request.playerStorageOwnerId, state: candidate }],
      blockWrite,
    }
    yield* coordinator.commit(commitRequest)

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
  WorldCommitCoordinatorError | Schema.SchemaError
>
export function useBucket(
  ...args: LegacyBucketUseArguments | CoordinatedBucketUseArguments
): Effect.Effect<
  BucketUseOutcome,
  WorldCommitCoordinatorError | Schema.SchemaError
> {
  if (args.length === 4) {
    const request = args[3]
    return Effect.succeed(
      request.activeDimension !== request.targetDimension
        ? {
            _tag: 'WrongDimension' as const,
            activeDimension: request.activeDimension,
            targetDimension: request.targetDimension,
          }
        : { _tag: 'CommitContextMissing' as const },
    )
  }
  return useBucketWithCommit(...args)
}
