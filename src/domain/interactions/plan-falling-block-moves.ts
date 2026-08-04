import type { BlockId, BlockPosition } from '../chunk-store-port'
import { fallsWhenUnsupported, isReplaceable } from '../block-vocabulary'

export type FallingBlockMove = {
  readonly source: BlockPosition
  readonly target: BlockPosition
  readonly blockId: BlockId
}

export type FallingBlockReader = (position: BlockPosition) => BlockId | undefined

/**
 * Plans the one-cell falls requested by the host without taking ownership of
 * its world. `undefined` is an unreadable cell, never an air block.
 */
export const planFallingBlockMoves = (
  sources: ReadonlyArray<BlockPosition>,
  readBlock: FallingBlockReader,
): ReadonlyArray<FallingBlockMove> => {
  const moves: Array<FallingBlockMove> = []

  for (const source of sources) {
    const blockId = readBlock(source)
    if (blockId === undefined || !fallsWhenUnsupported(blockId)) continue

    const target = { x: source.x, y: source.y - 1, z: source.z }
    const targetBlockId = readBlock(target)
    if (targetBlockId === undefined || !isReplaceable(targetBlockId)) continue

    moves.push({ source, target, blockId })
  }

  return moves
}
