import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Schema } from 'effect'
import {
  AIR_BLOCK_ID,
  BlockAxis,
  BlockIdSchema,
  BlockPositionSchema,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  type BlockPosition,
  type BlockId,
  type BlockPositionKey,
} from '@nerima-games/mc-kernel'
import { applyFallingBlocks } from '../src/domain/entities/falling-block-move'
import { makeChunkStoreDouble, world } from './support/chunk-store-double'

const at = (y: number) => Schema.decodeUnknownSync(BlockPositionSchema)({ x: 0, y, z: 0 })
const block = (type: 'dirt' | 'gravel' | 'sand') => Option.getOrThrow(blockIdOf(type))
const samePosition = (left: BlockPosition, right: BlockPosition) =>
  blockPositionKeyOf(left) === blockPositionKeyOf(right)

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
      expect(yield* store.blockAt(source)).toBe(AIR_BLOCK_ID)
      expect(yield* store.blockAt(floor)).toBe(sand)
      expect(yield* store.calls).toStrictEqual({ reads: 3, writes: 2, peeks: 0 })
    }),
  )

  it.effect('leaves non-falling and out-of-world source readings untouched', () =>
    Effect.gen(function* () {
      const target = at(5)
      const source = at(6)
      const dirtStore = yield* makeChunkStoreDouble(world([[source, block('dirt')]]), ['0,0'])
      const outOfWorldTarget = at(319)
      const outOfWorldStore = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(yield* applyFallingBlocks(dirtStore.api, [blockPositionKeyOf(target)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(yield* dirtStore.calls).toStrictEqual({ reads: 1, writes: 0, peeks: 0 })
      expect(yield* applyFallingBlocks(outOfWorldStore.api, [blockPositionKeyOf(outOfWorldTarget)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(yield* outOfWorldStore.calls).toStrictEqual({ reads: 1, writes: 0, peeks: 0 })
    }),
  )

  it.effect('does not treat a transiently unavailable source as air', () =>
    Effect.gen(function* () {
      const target = at(5)
      const source = at(6)
      const store = yield* makeChunkStoreDouble(world([[source, block('sand')]]), ['0,0'])
      const api = {
        ...store.api,
        getBlock: (position: BlockPosition) =>
          samePosition(position, source)
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' as const })
            : store.api.getBlock(position),
      }

      expect(yield* applyFallingBlocks(api, [blockPositionKeyOf(target)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(yield* store.blockAt(source)).toBe(block('sand'))
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 0 })
    }),
  )

  it.effect('does not fall into an unavailable or solid destination', () =>
    Effect.gen(function* () {
      const target = at(5)
      const source = at(6)
      const sand = block('sand')
      const unavailableStore = yield* makeChunkStoreDouble(world([[source, sand]]), ['0,0'])
      const unavailableApi = {
        ...unavailableStore.api,
        getBlock: (position: BlockPosition) =>
          samePosition(position, target)
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' as const })
            : unavailableStore.api.getBlock(position),
      }
      const solidStore = yield* makeChunkStoreDouble(world([[source, sand], [target, sand]]), ['0,0'])
      const belowWorld = at(-1)
      const floorSource = at(0)
      const floorStore = yield* makeChunkStoreDouble(world([[floorSource, sand]]), ['0,0'])

      expect(yield* applyFallingBlocks(unavailableApi, [blockPositionKeyOf(target)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(yield* applyFallingBlocks(solidStore.api, [blockPositionKeyOf(target)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(yield* applyFallingBlocks(floorStore.api, [blockPositionKeyOf(belowWorld)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(yield* unavailableStore.blockAt(source)).toBe(sand)
      expect(yield* solidStore.blockAt(source)).toBe(sand)
      expect(yield* solidStore.blockAt(target)).toBe(sand)
      expect(yield* floorStore.blockAt(floorSource)).toBe(sand)
    }),
  )

  it.effect('stops when the source was already cleared by a competing write', () =>
    Effect.gen(function* () {
      const target = at(5)
      const source = at(6)
      const sand = block('sand')
      const store = yield* makeChunkStoreDouble(world([[source, sand]]), ['0,0'])
      let competingWrite = false
      const api = {
        ...store.api,
        setBlock: (position: BlockPosition, next: BlockId) => {
          if (!competingWrite && samePosition(position, source) && next === AIR_BLOCK_ID) {
            competingWrite = true
            return Effect.gen(function* () {
              yield* store.api.setBlock(position, AIR_BLOCK_ID)
              return yield* store.api.setBlock(position, next)
            })
          }
          return store.api.setBlock(position, next)
        },
      }

      expect(yield* applyFallingBlocks(api, [blockPositionKeyOf(target)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(competingWrite).toBe(true)
      expect(yield* store.blockAt(source)).toBe(AIR_BLOCK_ID)
      expect(yield* store.blockAt(target)).toBeUndefined()
    }),
  )

  it.effect('restores the source if the destination unloads before its write', () =>
    Effect.gen(function* () {
      const target = at(5)
      const source = at(6)
      const sand = block('sand')
      const store = yield* makeChunkStoreDouble(world([[source, sand]]), ['0,0'])
      let refusedDestinationWrite = false
      const api = {
        ...store.api,
        setBlock: (position: BlockPosition, next: BlockId) => {
          if (!refusedDestinationWrite && samePosition(position, target) && next === sand) {
            refusedDestinationWrite = true
            return Effect.succeed({ _tag: 'ChunkNotLoaded' as const })
          }
          return store.api.setBlock(position, next)
        },
      }

      expect(yield* applyFallingBlocks(api, [blockPositionKeyOf(target)])).toStrictEqual({
        moved: 0,
        destinations: [],
      })
      expect(refusedDestinationWrite).toBe(true)
      expect(yield* store.blockAt(source)).toBe(sand)
      expect(yield* store.blockAt(target)).toBeUndefined()
    }),
  )

  it.effect('schedules the cell below a newly landed block and its old source', () =>
    Effect.gen(function* () {
      const target = at(5)
      const source = at(6)
      const below = at(4)
      const sand = block('sand')
      const store = yield* makeChunkStoreDouble(world([[source, sand]]), ['0,0'])

      expect(yield* applyFallingBlocks(store.api, [blockPositionKeyOf(target)])).toStrictEqual({
        moved: 1,
        destinations: [blockPositionKeyOf(below), blockPositionKeyOf(source)],
      })
      expect(yield* store.blockAt(source)).toBe(AIR_BLOCK_ID)
      expect(yield* store.blockAt(target)).toBe(sand)
    }),
  )
})
