import { describe, expect, it } from '@effect/vitest'
import { AIR_BLOCK_ID, blockPosition, BlockAxis, type BlockId } from '@nerima-games/mc-kernel'
import { Effect, Result } from 'effect'
import { fishingOpenWaterAt } from '../src/domain/interactions/fishing-open-water'
import { blockKey, makeChunkStoreDouble, STONE, WATER } from './support/chunk-store-double'

const BOBBER = { x: 8.5, y: 62.2, z: 8.5 }

const at = (x: number, y: number, z: number) => blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

/** Water at y 61..62 and air at y 63..64 over x 6..10, z 6..10. */
const openWaterRegion = (): Map<string, BlockId> => {
  const blocks = new Map<string, BlockId>()
  for (let x = 6; x <= 10; x++) {
    for (let z = 6; z <= 10; z++) {
      blocks.set(blockKey(at(x, 61, z)), WATER)
      blocks.set(blockKey(at(x, 62, z)), WATER)
      blocks.set(blockKey(at(x, 63, z)), AIR_BLOCK_ID)
    }
  }
  return blocks
}

describe('fishingOpenWaterAt', () => {
  it.effect('is open water when the lower two layers are water and the upper two are water or air', () =>
    Effect.gen(function* () {
      const blocks = openWaterRegion()
      blocks.set(blockKey(at(10, 64, 10)), WATER)
      const store = yield* makeChunkStoreDouble(blocks, ['0,0'])

      expect(yield* fishingOpenWaterAt(store.api.getBlock, BOBBER)).toBe(true)
    }),
  )

  it.effect('is not open water when one block in the region is stone', () =>
    Effect.gen(function* () {
      const blocks = openWaterRegion()
      blocks.set(blockKey(at(6, 64, 10)), STONE)
      const store = yield* makeChunkStoreDouble(blocks, ['0,0'])

      expect(yield* fishingOpenWaterAt(store.api.getBlock, BOBBER)).toBe(false)
    }),
  )

  it.effect('is not open water when a layer at the bobber is air', () =>
    Effect.gen(function* () {
      const blocks = openWaterRegion()
      blocks.set(blockKey(at(7, 62, 9)), AIR_BLOCK_ID)
      const store = yield* makeChunkStoreDouble(blocks, ['0,0'])

      expect(yield* fishingOpenWaterAt(store.api.getBlock, BOBBER)).toBe(false)
    }),
  )

  it.effect('fails instead of reading air when a block in the region is in an unloaded chunk', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(openWaterRegion(), ['0,0'])

      const decided = yield* Effect.result(fishingOpenWaterAt(store.api.getBlock, { x: 0.5, y: 62.2, z: 8.5 }))

      expect(Result.isFailure(decided)).toBe(true)
      if (Result.isFailure(decided)) {
        expect(decided.failure).toStrictEqual({
          _tag: 'FishingOpenWaterReadFailure',
          position: { x: -2, y: 61, z: 6 },
          reason: 'ChunkNotLoaded',
        })
      }
    }),
  )

  it.effect('is not open water when a cell above the bobber is stone', () =>
    Effect.gen(function* () {
      const blocks = openWaterRegion()
      blocks.set(blockKey(at(8, 63, 8)), STONE)
      const store = yield* makeChunkStoreDouble(blocks, ['0,0'])

      expect(yield* fishingOpenWaterAt(store.api.getBlock, BOBBER)).toBe(false)
    }),
  )

  it.effect('fails without reading the store when a region cell is not a safe-integer block position', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(openWaterRegion(), ['0,0'])
      // 2^53 + 2 is exactly representable; the first region cell, x = 2^53, is not a safe integer.
      const huge = 2 ** 53 + 2

      const decided = yield* Effect.result(fishingOpenWaterAt(store.api.getBlock, { x: huge, y: 62.2, z: 8.5 }))

      expect(decided).toMatchObject({
        failure: {
          _tag: 'FishingOpenWaterReadFailure',
          position: { x: huge - 2, y: 61, z: 6 },
          reason: 'InvalidPosition',
        },
      })
      expect(Result.isFailure(decided)).toBe(true)
      expect((yield* store.calls).reads).toBe(0)
    }),
  )
})
