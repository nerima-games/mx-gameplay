import { BlockId } from '@nerima-games/mc-kernel'
import {
  defaultBlockState,
  encodeBlockState,
  type BlockStateCodecFailure,
} from '@nerima-games/mc-kernel/domain/block-state'
import { Result } from 'effect'

export const materializeDefaultBlockStates = (
  blocks: Uint16Array,
): Result.Result<Uint32Array, BlockStateCodecFailure> => {
  const encoded = new Uint32Array(blocks.length)
  const defaults = new Map<number, number>()

  for (const [index, blockValue] of blocks.entries()) {
    const block = BlockId(blockValue)
    const cached = defaults.get(blockValue)
    if (cached !== undefined) {
      encoded[index] = cached
      continue
    }

    const state = defaultBlockState(block)
    if (Result.isFailure(state)) return Result.fail(state.failure)
    const blockState = encodeBlockState(block, state.success)
    if (Result.isFailure(blockState)) return Result.fail(blockState.failure)

    encoded[index] = blockState.success
    defaults.set(blockValue, blockState.success)
  }

  return Result.succeed(encoded)
}
