import { Option } from 'effect'
import type { BlockId, BlockPosition } from '@nerima-games/mc-kernel'
import type { BlockReading } from '@nerima-games/mc-worldgen'
import { blockIdOf } from '@nerima-games/mc-kernel'

const LEVER_BLOCK_ID = Option.getOrUndefined(blockIdOf('lever'))

export type BlockUseOutcome =
  | Readonly<{ _tag: 'ToggleLever'; position: BlockPosition }>
  | Readonly<{
      _tag: 'NotLever'
      position: BlockPosition
      existing: BlockId
    }>
  | Readonly<{ _tag: 'ChunkNotLoaded'; position: BlockPosition }>
  | Readonly<{ _tag: 'OutOfWorld'; position: BlockPosition }>

export const resolveBlockUse = (
  position: BlockPosition,
  reading: BlockReading,
): BlockUseOutcome => {
  if (reading._tag === 'ChunkNotLoaded') return { _tag: 'ChunkNotLoaded', position }
  if (reading._tag === 'OutOfWorld') return { _tag: 'OutOfWorld', position }
  return reading.block === LEVER_BLOCK_ID
    ? { _tag: 'ToggleLever', position }
    : { _tag: 'NotLever', position, existing: reading.block }
}

export const isSuccessfulBlockUse = (outcome: BlockUseOutcome): boolean =>
  outcome._tag === 'ToggleLever'
