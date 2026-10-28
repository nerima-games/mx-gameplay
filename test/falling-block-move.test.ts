import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  BlockAxis,
  blockPosition,
  blockPositionKeyOf,
  type BlockId,
  type BlockPositionKey,
} from '@nerima-games/mc-kernel'
import { applyFallingBlocks } from '../src/domain/entities/falling-block-move'
import { makeChunkStoreDouble } from './support/chunk-store-double'

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
})
