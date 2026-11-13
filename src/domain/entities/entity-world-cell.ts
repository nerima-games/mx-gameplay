import {
  AIR_BLOCK_ID,
  BLOCK_PROPERTY_DEFAULTS,
  capabilitiesOfBlockId,
  resolvedBlockOfId,
  type BlockAxis,
  type BlockCapabilities,
  type BlockId,
  type BlockProperties,
  type BlockRegistryResolutionFailure,
  type ResolvedBlock,
} from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import { readChunkWindowCell, type ChunkWindow } from '../chunk-window.js'

export type EntityWorldCellPosition = Readonly<{ x: BlockAxis; y: BlockAxis; z: BlockAxis }>

export type EntityWorldQueryFailure =
  | Readonly<{ _tag: 'EntityWorldWindowUnavailable'; cell: EntityWorldCellPosition }>
  | Readonly<{ _tag: 'EntityWorldCorruptBuffer'; cell: EntityWorldCellPosition; index: number; length: number }>
  | Readonly<{ _tag: 'EntityWorldRegistryFailure'; cell: EntityWorldCellPosition; failure: BlockRegistryResolutionFailure }>
  | Readonly<{ _tag: 'EntityWorldInvalidCell'; x: number; y: number; z: number }>

export type EntityWorldCell =
  | Readonly<{ _tag: 'Loaded'; blockId: BlockId; block: ResolvedBlock | undefined; properties: BlockProperties; capabilities: BlockCapabilities }>
  | Readonly<{ _tag: 'Unloaded' }>
  | Readonly<{ _tag: 'AboveWorld' }>
  | Readonly<{ _tag: 'BelowWorld' }>

type EntityWorldBlockLookup = Result.Result<
  Readonly<{ block: ResolvedBlock | undefined; capabilities: BlockCapabilities }>,
  BlockRegistryResolutionFailure
>

export const entityWorldBlockDataFromLookup = (
  cell: EntityWorldCellPosition,
  blockId: BlockId,
  lookup: EntityWorldBlockLookup,
): Result.Result<Extract<EntityWorldCell, { _tag: 'Loaded' }>, EntityWorldQueryFailure> => {
  if (Result.isFailure(lookup)) {
    return Result.fail({ _tag: 'EntityWorldRegistryFailure', cell, failure: lookup.failure })
  }
  return Result.succeed({
    _tag: 'Loaded',
    blockId,
    block: lookup.success.block,
    properties: lookup.success.block?.properties ?? BLOCK_PROPERTY_DEFAULTS,
    capabilities: lookup.success.capabilities,
  })
}

export const entityWorldBlockDataAt = (
  cell: EntityWorldCellPosition,
  blockId: BlockId,
): Result.Result<Extract<EntityWorldCell, { _tag: 'Loaded' }>, EntityWorldQueryFailure> =>
  entityWorldBlockDataFromLookup(cell, blockId, Result.all({
    block: resolvedBlockOfId(blockId),
    capabilities: capabilitiesOfBlockId(blockId),
  }))

export const entityWorldAirBlockDataAt = (
  cell: EntityWorldCellPosition,
): Result.Result<Extract<EntityWorldCell, { _tag: 'Loaded' }>, EntityWorldQueryFailure> =>
  entityWorldBlockDataAt(cell, AIR_BLOCK_ID)

export const entityWorldCellAt = (
  window: ChunkWindow,
  cell: EntityWorldCellPosition,
): Result.Result<EntityWorldCell, EntityWorldQueryFailure> => {
  const read = readChunkWindowCell(window, cell.x, cell.y, cell.z)
  if (Result.isFailure(read)) return Result.fail({ _tag: 'EntityWorldWindowUnavailable', cell })
  switch (read.success._tag) {
    case 'Loaded': return entityWorldBlockDataAt(cell, read.success.blockId)
    case 'Unloaded': return Result.succeed({ _tag: 'Unloaded' })
    case 'AboveWorld': return Result.succeed({ _tag: 'AboveWorld' })
    case 'BelowWorld': return Result.succeed({ _tag: 'BelowWorld' })
    case 'CorruptBuffer':
      return Result.fail({
        _tag: 'EntityWorldCorruptBuffer',
        cell,
        index: read.success.index,
        length: read.success.length,
      })
    /* v8 ignore start */
    default: {
      const exhaustive: never = read.success
      return exhaustive
    }
    /* v8 ignore stop */
  }
}
