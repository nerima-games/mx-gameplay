import type {
  BlockId,
  BlockPosition,
  BlockReading,
} from '../chunk-store-port'
import { blockIdOf } from '../block-vocabulary'

const LEVER_BLOCK_ID = blockIdOf('lever')

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
  switch (reading._tag) {
    case 'ChunkNotLoaded':
      return { _tag: 'ChunkNotLoaded', position }
    case 'OutOfWorld':
      return { _tag: 'OutOfWorld', position }
    case 'Block':
      return reading.block === LEVER_BLOCK_ID
        ? { _tag: 'ToggleLever', position }
        : { _tag: 'NotLever', position, existing: reading.block }
    // exhaustiveness arm over BlockReading, a closed three-tag union
    // (chunk-store-port.ts's BlockReading); all three tags are handled
    // above, so no input can reach this arm.
    /* v8 ignore start */
    default: {
      const exhaustive: never = reading
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

export const isSuccessfulBlockUse = (outcome: BlockUseOutcome): boolean =>
  outcome._tag === 'ToggleLever'
