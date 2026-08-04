import { describe, expect, it } from '@effect/vitest'
import type { BlockId, BlockPosition } from '../src/domain/chunk-store-port'
import { blockIdOf, type BlockType } from '../src/domain/block-vocabulary'
import { planFallingBlockMoves } from '../src/domain/interactions/plan-falling-block-moves'

const SOURCE: BlockPosition = { x: 4, y: 12, z: -3 }
const TARGET: BlockPosition = { x: 4, y: 11, z: -3 }

const blockId = (block: BlockType): BlockId => blockIdOf(block) ?? -1
const positionKey = (position: BlockPosition): string => `${position.x},${position.y},${position.z}`

const readerFor = (blocks: ReadonlyArray<readonly [BlockPosition, BlockId]>) => {
  const byPosition = new Map(blocks.map(([position, id]) => [positionKey(position), id]))
  return (position: BlockPosition): BlockId | undefined => byPosition.get(positionKey(position))
}

describe('planFallingBlockMoves', () => {
  it.each(['air', 'water', 'lava'] as const)(
    'plans sand falling into replaceable %s',
    (targetBlock) => {
      const sand = blockId('sand')
      const moves = planFallingBlockMoves(
        [SOURCE],
        readerFor([
          [SOURCE, sand],
          [TARGET, blockId(targetBlock)],
        ]),
      )

      expect(moves).toStrictEqual([{ source: SOURCE, target: TARGET, blockId: sand }])
    },
  )

  it('does not move a source that does not fall when unsupported', () => {
    expect(planFallingBlockMoves([SOURCE], readerFor([[SOURCE, blockId('stone')], [TARGET, blockId('air')]]))).toStrictEqual([])
  })

  it('does not overwrite a nonreplaceable target', () => {
    expect(planFallingBlockMoves([SOURCE], readerFor([[SOURCE, blockId('sand')], [TARGET, blockId('stone')]]))).toStrictEqual([])
  })

  it('does not treat an unloaded source or target as air', () => {
    const sand = blockId('sand')

    expect(planFallingBlockMoves([SOURCE], readerFor([[TARGET, blockId('air')]]))).toStrictEqual([])
    expect(planFallingBlockMoves([SOURCE], readerFor([[SOURCE, sand]]))).toStrictEqual([])
  })
})
