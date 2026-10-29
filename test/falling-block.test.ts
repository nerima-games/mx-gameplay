import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import {
  blockIdOf,
  blockPositionKeyOf,
  type BlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import { applyFallingBlocks } from '../src/domain/entities/falling-block-move.js'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { makeInMemoryWorld } from '../src/domain/in-memory-world.js'
import { planFallingBlockMoves, type FallingBlockPosition } from '../src/domain/falling-block.js'
import { blockPosition } from './support/coordinate-fixtures.js'

const SAND_ID = Option.getOrThrow(blockIdOf('sand'))
const AIR_ID = Option.getOrThrow(blockIdOf('air'))
const TARGET: FallingBlockPosition = { x: 0, y: 1, z: 0 }

describe('falling block domain', () => {
  it.effect('plans a column cascade against the virtual positions of earlier moves', () =>
    Effect.sync(() => {
      const sand = Option.getOrThrow(blockIdOf('sand'))
      const air = Option.getOrThrow(blockIdOf('air'))
      const blocks = new Map<string, number>([
        ['0,63,0', air],
        ['0,64,0', sand],
        ['0,65,0', sand],
      ])

      const moves = planFallingBlockMoves(
        [{ x: 0, y: 63, z: 0 }, { x: 0, y: 64, z: 0 }],
        (at) => blocks.get(`${String(at.x)},${String(at.y)},${String(at.z)}`),
      )

      expect(moves).toStrictEqual([
        {
          source: { x: 0, y: 64, z: 0 },
          target: { x: 0, y: 63, z: 0 },
          blockId: sand,
        },
        {
          source: { x: 0, y: 65, z: 0 },
          target: { x: 0, y: 64, z: 0 },
          blockId: sand,
        },
      ])
    }),
  )

  it.effect('does not query the store above a valid maximum block coordinate', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>()
      const target = blockPosition(0, Number.MAX_SAFE_INTEGER, 0)
      let reads = 0
      let writes = 0
      const store = {
        ...world.chunkStore,
        getBlock: (position: BlockPosition) => {
          reads += 1
          return world.chunkStore.getBlock(position)
        },
        setBlock: (position: BlockPosition, block: BlockId) => {
          writes += 1
          return world.chunkStore.setBlock(position, block)
        },
      }

      expect(yield* applyFallingBlocks(store, [blockPositionKeyOf(target)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(reads).toBe(0)
      expect(writes).toBe(0)
    }),
  )
})

describe('falling block planning', () => {
  it.each([
    ['source', -1, AIR_ID],
    ['destination', SAND_ID, -1],
  ] as const)('rejects an invalid block id read from the %s cell', (_cell, sourceId, destinationId) => {
    const moves = planFallingBlockMoves(
      [TARGET],
      (at) => (at.y === TARGET.y + 1 ? sourceId : destinationId),
    )

    expect(moves).toStrictEqual([])
  })
})
