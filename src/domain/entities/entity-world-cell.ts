import {
  AIR_BLOCK_ID,
  blockTypeOfId,
  capabilitiesOfBlockId,
  isKnownBlockId,
  resolvedBlockOfId,
  type BlockAxis,
  type BlockCapabilities,
  type BlockId,
  type BlockProperties,
  type BlockType,
  type BlockRegistryResolutionFailure,
  type Position,
  type ResolvedBlock,
} from '@nerima-games/mc-kernel'
import { Result, Schema } from 'effect'
import { readChunkWindowCell, type ChunkWindow, type ChunkWindowCell } from '../chunk-window.js'

export type EntityWorldCellPosition = Readonly<{ x: BlockAxis; y: BlockAxis; z: BlockAxis }>
type CorruptChunkBuffer = Extract<ChunkWindowCell, { _tag: 'CorruptBuffer' }>

export type EntityWorldQueryFailure =
  | Readonly<{ _tag: 'EntityWorldWindowUnavailable'; cell: EntityWorldCellPosition }>
  | Readonly<{
      _tag: 'EntityWorldCorruptBuffer'
      cell: EntityWorldCellPosition
      index: CorruptChunkBuffer['index']
      length: CorruptChunkBuffer['length']
    }>
  | Readonly<{ _tag: 'EntityWorldRegistryFailure'; cell: EntityWorldCellPosition; failure: BlockRegistryResolutionFailure }>
  | Readonly<{ _tag: 'EntityWorldUnregisteredBlockId'; cell: EntityWorldCellPosition; blockId: BlockId }>
  | Readonly<{ _tag: 'EntityWorldInvalidCell'; reason: 'not-block-coordinate'; position: Position }>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const isCellPosition = (value: unknown): value is EntityWorldCellPosition =>
  isRecord(value) &&
  Number.isSafeInteger(value['x']) &&
  Number.isSafeInteger(value['y']) &&
  Number.isSafeInteger(value['z'])

const isBlockRegistryResolutionFailure = (value: unknown): value is BlockRegistryResolutionFailure => {
  if (!isRecord(value) || typeof value['_tag'] !== 'string') return false
  if (value['_tag'] === 'BrandError') return isRecord(value['issue']) && typeof value['message'] === 'string'
  if (value['_tag'] === 'BlockDefinitionFailure') {
    return (value['reason'] === 'unknown-field' || value['reason'] === 'invalid-shape') && typeof value['message'] === 'string'
  }
  if (value['_tag'] === 'BlockCapabilityFailure') {
    return (
      value['reason'] === 'not-object' || value['reason'] === 'unknown-key' ||
      value['reason'] === 'not-boolean' || value['reason'] === 'hostile-input'
    ) && typeof value['message'] === 'string'
  }
  return value['_tag'] === 'BlockPropertyFailure' &&
    (value['reason'] === 'type' || value['reason'] === 'range' || value['reason'] === 'unknown-key') &&
    typeof value['message'] === 'string'
}

const isEntityWorldQueryFailure = (value: unknown): value is EntityWorldQueryFailure => {
  if (!isRecord(value) || typeof value['_tag'] !== 'string') return false
  if (value['_tag'] === 'EntityWorldWindowUnavailable') return isCellPosition(value['cell'])
  if (value['_tag'] === 'EntityWorldCorruptBuffer') {
    return isCellPosition(value['cell']) && Number.isSafeInteger(value['index']) && Number.isSafeInteger(value['length'])
  }
  if (value['_tag'] === 'EntityWorldRegistryFailure') {
    return isCellPosition(value['cell']) && isBlockRegistryResolutionFailure(value['failure'])
  }
  if (value['_tag'] === 'EntityWorldUnregisteredBlockId') {
    return isCellPosition(value['cell']) && typeof value['blockId'] === 'number' &&
      Number.isInteger(value['blockId']) && value['blockId'] >= 0 && value['blockId'] <= 65_535
  }
  return value['_tag'] === 'EntityWorldInvalidCell' && value['reason'] === 'not-block-coordinate' && isRecord(value['position'])
}

export const EntityWorldQueryFailureSchema: Schema.Codec<EntityWorldQueryFailure, unknown> =
  Schema.declare<EntityWorldQueryFailure>(isEntityWorldQueryFailure)

export type EntityWorldCell =
  | Readonly<{ _tag: 'Loaded'; blockId: BlockId; block: ResolvedBlock; properties: BlockProperties; capabilities: BlockCapabilities }>
  | Readonly<{ _tag: 'Unloaded' }>
  | Readonly<{ _tag: 'AboveWorld' }>
  | Readonly<{ _tag: 'BelowWorld' }>

type EntityWorldBlockLookup = Result.Result<
  Readonly<{ block: ResolvedBlock | undefined; capabilities: BlockCapabilities }>,
  BlockRegistryResolutionFailure
>

type EntityWorldRegistryFailure = Extract<EntityWorldQueryFailure, { _tag: 'EntityWorldRegistryFailure' }>
type EntityWorldUnregisteredBlockId = Extract<EntityWorldQueryFailure, { _tag: 'EntityWorldUnregisteredBlockId' }>

const entityWorldValueFromLookup = <Value>(
  cell: EntityWorldCellPosition,
  lookup: Result.Result<Value, BlockRegistryResolutionFailure>,
): Result.Result<Value, EntityWorldRegistryFailure> => {
  if (Result.isFailure(lookup)) {
    return Result.fail({ _tag: 'EntityWorldRegistryFailure', cell, failure: lookup.failure })
  }
  return Result.succeed(lookup.success)
}

const entityWorldBlockDataFromLookup = (
  cell: EntityWorldCellPosition,
  blockId: BlockId,
  lookup: EntityWorldBlockLookup,
): Result.Result<
  Extract<EntityWorldCell, { _tag: 'Loaded' }>,
  EntityWorldRegistryFailure | EntityWorldUnregisteredBlockId
> => {
  const known = isKnownBlockId(blockId)
  if (Result.isFailure(known)) {
    return Result.fail({ _tag: 'EntityWorldRegistryFailure', cell, failure: known.failure })
  }
  if (!known.success) return Result.fail({ _tag: 'EntityWorldUnregisteredBlockId', cell, blockId })

  const resolved = entityWorldValueFromLookup(cell, lookup)
  if (Result.isFailure(resolved)) return Result.fail(resolved.failure)
  if (resolved.success.block === undefined) {
    return Result.fail({ _tag: 'EntityWorldUnregisteredBlockId', cell, blockId })
  }
  return Result.succeed({
    _tag: 'Loaded',
    blockId,
    block: resolved.success.block,
    properties: resolved.success.block.properties,
    capabilities: resolved.success.capabilities,
  })
}

export const entityWorldBlockDataAt = (
  cell: EntityWorldCellPosition,
  blockId: BlockId,
): Result.Result<Extract<EntityWorldCell, { _tag: 'Loaded' }>, EntityWorldRegistryFailure | EntityWorldUnregisteredBlockId> =>
  entityWorldBlockDataFromLookup(cell, blockId, Result.all({
    block: resolvedBlockOfId(blockId),
    capabilities: capabilitiesOfBlockId(blockId),
  }))

export const entityWorldBlockTypeAt = (
  cell: EntityWorldCellPosition,
  blockId: BlockId,
): Result.Result<BlockType, EntityWorldRegistryFailure | EntityWorldUnregisteredBlockId> => {
  const data = entityWorldBlockDataAt(cell, blockId)
  if (Result.isFailure(data)) return Result.fail(data.failure)
  const blockType = blockTypeOfId(blockId)
  if (Result.isFailure(blockType)) {
    return Result.fail({ _tag: 'EntityWorldRegistryFailure', cell, failure: blockType.failure })
  }
  return blockType.success === undefined
    ? Result.fail({ _tag: 'EntityWorldUnregisteredBlockId', cell, blockId })
    : Result.succeed(blockType.success)
}

export const entityWorldAirBlockDataAt = (
  cell: EntityWorldCellPosition,
): Result.Result<
  Extract<EntityWorldCell, { _tag: 'Loaded' }>,
  EntityWorldRegistryFailure | EntityWorldUnregisteredBlockId
> =>
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
