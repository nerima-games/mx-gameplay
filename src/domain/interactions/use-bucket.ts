import {
  addItem,
  removeItem,
  withInventory,
  type InventoryServiceApi,
} from '@nerima-games/mc-sim'
import { Effect, Exit, Ref } from 'effect'
import { blockIdOf } from '../block-vocabulary.js'
import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type ChunkCoord,
  type ChunkStoreApi,
} from '../chunk-store-port.js'
import { positionKeyOf } from '../block-position-key.js'
import {
  enqueueFluidDisturbance,
  type FluidKind,
  type FluidWorkItem,
} from '../fluid-frontier.js'
import type { ItemType } from '../item-vocabulary.js'
import type { Dimension } from '@nerima-games/mc-worldgen'

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
  | { readonly _tag: 'InventoryUpdateFailed' }
  | {
      readonly _tag: 'RollbackFailed'
      readonly trigger: 'WorldChanged' | 'InventoryUpdateFailed'
      readonly world: 'Restored' | 'ChunkNotLoaded' | 'OutOfWorld'
      readonly inventory: 'Unchanged' | 'Restored' | 'RestoreFailed'
    }

type BucketPlan = {
  readonly action: 'collect' | 'place'
  readonly fluid: FluidKind
  readonly expectedBlock: BlockId
  readonly nextBlock: BlockId
  readonly nextItem: BucketItemType
}

const fluidBlockId = (fluid: FluidKind): BlockId | undefined => blockIdOf(fluid)

const planBucketUse = (heldItem: BucketItemType, block: BlockId): BucketPlan | undefined => {
  const waterBlock = fluidBlockId('water')
  const lavaBlock = fluidBlockId('lava')

  if (heldItem === 'bucket') {
    if (waterBlock !== undefined && block === waterBlock) {
      return {
        action: 'collect',
        fluid: 'water',
        expectedBlock: waterBlock,
        nextBlock: AIR_BLOCK_ID,
        nextItem: 'water_bucket',
      }
    }
    if (lavaBlock !== undefined && block === lavaBlock) {
      return {
        action: 'collect',
        fluid: 'lava',
        expectedBlock: lavaBlock,
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
  // `test/block-vocabulary-mirror.test.ts` proves `blockIdOf` total over
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
    expectedBlock: AIR_BLOCK_ID,
    nextBlock,
    nextItem: 'bucket',
  }
}

type WorldRollback = 'Restored' | 'ChunkNotLoaded' | 'OutOfWorld'

const rollbackWorld = (
  store: ChunkStoreApi,
  position: BlockPosition,
  block: BlockId,
): Effect.Effect<WorldRollback> =>
  Effect.map(store.setBlock(position, block), (outcome) => {
    if (outcome._tag === 'ChunkNotLoaded' || outcome._tag === 'OutOfWorld') {
      return outcome._tag
    }
    return 'Restored'
  })

/**
 * Exchange one bucket item and one world cell as one interaction.
 *
 * Inventory capacity is proven against a snapshot before the world write. The
 * snapshot is installed only after a successful write, so ordinary refusals do
 * not need compensating mutations.
 */
export const useBucket = (
  store: ChunkStoreApi,
  inventory: InventoryServiceApi,
  fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>,
  request: BucketUseRequest,
): Effect.Effect<BucketUseOutcome> =>
  Effect.gen(function* () {
    if (request.activeDimension !== request.targetDimension) {
      return {
        _tag: 'WrongDimension',
        activeDimension: request.activeDimension,
        targetDimension: request.targetDimension,
      }
    }

    const storage = yield* inventory.storageSnapshot
    const removed = removeItem(storage.inventory, request.heldItem, 1)
    if (removed.removed !== 1) {
      return { _tag: 'MissingItem', item: request.heldItem }
    }

    const reading = yield* store.getBlock(request.position)
    if (reading._tag !== 'Block') {
      return reading
    }

    const plan = planBucketUse(request.heldItem, reading.block)
    if (plan === undefined) {
      return request.heldItem === 'bucket'
        ? { _tag: 'WrongTarget', block: reading.block }
        : { _tag: 'Occupied', block: reading.block }
    }

    const added = addItem(removed.inventory, plan.nextItem, 1)
    if (added.leftover !== 0) {
      return { _tag: 'InventoryFull', item: plan.nextItem }
    }

    const written = yield* store.setBlock(request.position, plan.nextBlock)
    if (written._tag === 'ChunkNotLoaded' || written._tag === 'OutOfWorld') {
      return written
    }
    if (written._tag === 'Written' && written.previous !== plan.expectedBlock) {
      const world = yield* rollbackWorld(store, request.position, written.previous)
      if (world !== 'Restored') {
        return {
          _tag: 'RollbackFailed',
          trigger: 'WorldChanged',
          world,
          inventory: 'Unchanged',
        }
      }
      return { _tag: 'WorldChanged' }
    }
    if (written._tag !== 'Written') {
      return { _tag: 'WorldChanged' }
    }

    const inventoryUpdate = yield* Effect.exit(
      inventory.restoreStorage(withInventory(storage, added.inventory)),
    )
    if (Exit.isFailure(inventoryUpdate)) {
      const inventoryRollback = yield* Effect.exit(inventory.restoreStorage(storage))
      const world = yield* rollbackWorld(store, request.position, plan.expectedBlock)
      const inventoryState = Exit.isSuccess(inventoryRollback) ? 'Restored' : 'RestoreFailed'

      if (world !== 'Restored' || inventoryState === 'RestoreFailed') {
        return {
          _tag: 'RollbackFailed',
          trigger: 'InventoryUpdateFailed',
          world,
          inventory: inventoryState,
        }
      }
      return { _tag: 'InventoryUpdateFailed' }
    }
    yield* Ref.update(fluidFrontier, (frontier) =>
      enqueueFluidDisturbance(frontier, {
        key: positionKeyOf(request.position),
        kind: plan.fluid,
      }),
    )

    return {
      _tag: plan.action === 'collect' ? 'Collected' : 'Placed',
      fluid: plan.fluid,
      position: request.position,
      chunk: written.chunk,
    }
  })
