import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Schema } from 'effect'
import {
  BlockAxis,
  BlockIdSchema,
  BlockPositionSchema,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  type BlockId,
  type BlockPositionKey,
} from '@nerima-games/mc-kernel'
import { applyFallingBlocks } from '../src/domain/entities/falling-block-move'
import { makeChunkStoreDouble, world } from './support/chunk-store-double'

describe('falling block move input boundaries', () => {
  it.effect('skips malformed keys and positions whose upward neighbour overflows', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(new Map<string, BlockId>(), [])
      const malformedKey = '0,1' as BlockPositionKey
      const upperBoundary = blockPositionKeyOf(
        blockPosition(BlockAxis(0), BlockAxis(Number.MAX_SAFE_INTEGER), BlockAxis(0)),
      )

      expect(yield* applyFallingBlocks(store.api, [malformedKey, upperBoundary])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 0 })
    }),
  )

  it.effect('does not schedule a cell below the world floor after sand lands at y zero', () =>
    Effect.gen(function* () {
      const source = Schema.decodeUnknownSync(BlockPositionSchema)({ x: 0, y: 1, z: 0 })
      const floor = Schema.decodeUnknownSync(BlockPositionSchema)({ x: 0, y: 0, z: 0 })
      const sand = Schema.decodeUnknownSync(BlockIdSchema)(Option.getOrThrow(blockIdOf('sand')))
      const store = yield* makeChunkStoreDouble(world([[source, sand]]), ['0,0'])

      // Sand falls when its support is removed: https://minecraft.wiki/w/Sand
      const moves = yield* applyFallingBlocks(store.api, [blockPositionKeyOf(floor)])

      expect(moves).toStrictEqual({ moved: 1, destinations: [blockPositionKeyOf(source)] })
      expect(yield* store.blockAt(source)).toBeUndefined()
      expect(yield* store.blockAt(floor)).toBe(sand)
      expect(yield* store.calls).toStrictEqual({ reads: 2, writes: 2, peeks: 0 })
    }),
  )
})
