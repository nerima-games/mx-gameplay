/**
 * The in-memory world adapts supplied sparse blocks to mc-worldgen's ChunkStore.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import {
  AIR_BLOCK_ID,
  blockIdOf,
  type BlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from '@nerima-games/mc-worldgen'
import { blockPosition } from './support/coordinate-fixtures.js'
import {
  EMPTY_WORLD,
  cellKey,
  chunkKey,
  chunkOf,
  isInWorld,
  makeInMemoryWorld,
  solidityFromStore,
  targetabilityFromStore,
  type WorldContents,
} from '../src/domain/in-memory-world.js'

const AT = blockPosition(5, 5, 5)
const NEARBY = blockPosition(6, 5, 5)
const DIRT = Option.getOrThrow(blockIdOf('dirt'))
const STONE = Option.getOrThrow(blockIdOf('stone'))

const worldWith = (
  cells: ReadonlyArray<readonly [BlockPosition, BlockId]>,
): WorldContents => ({
  blocks: new Map(cells.map(([position, block]) => [cellKey(position), block])),
  loaded: [...new Set(cells.map(([position]) => chunkKey(chunkOf(position))))],
})

describe('makeInMemoryWorld ChunkStore', () => {
  it.effect('an unloaded chunk reads ChunkNotLoaded until loaded', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld()
      expect((yield* world.chunkStore.getBlock(AT))._tag).toBe('ChunkNotLoaded')

      yield* world.chunkStore.load(chunkOf(AT))
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({
        _tag: 'Block',
        block: AIR_BLOCK_ID,
      })
    }),
  )

  it.effect('loads supplied blocks from a construction-time snapshot', () =>
    Effect.gen(function* () {
      const blocks = new Map([[cellKey(AT), STONE]])
      const world = yield* makeInMemoryWorld({
        world: { blocks, loaded: [chunkKey(chunkOf(AT))] },
      })
      blocks.set(cellKey(AT), DIRT)

      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({
        _tag: 'Block',
        block: STONE,
      })
    }),
  )

  it.effect('a same-block write is Unchanged and does not dirty subscribers', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld({ world: worldWith([[AT, STONE]]) })
      const subscription = yield* world.chunkStore.subscribeDirty

      expect(yield* world.chunkStore.setBlock(AT, STONE)).toStrictEqual({
        _tag: 'Unchanged',
        previous: STONE,
      })
      expect(yield* subscription.drain).toStrictEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('subscribers collect a set of changed chunks', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld({ world: worldWith([[AT, STONE]]) })
      const first = yield* world.chunkStore.subscribeDirty
      const second = yield* world.chunkStore.subscribeDirty

      yield* world.chunkStore.setBlock(NEARBY, DIRT)
      yield* world.chunkStore.setBlock(AT, DIRT)

      expect(yield* first.drain).toStrictEqual({
        changed: [chunkOf(AT)],
        removed: [],
      })
      expect(yield* second.drain).toStrictEqual({
        changed: [chunkOf(AT)],
        removed: [],
      })
      expect(yield* first.drain).toStrictEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('unknown loaded chunks are empty and distinct from unloaded chunks', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld({ world: EMPTY_WORLD })
      const unknown = blockPosition(100, 5, 100)

      expect((yield* world.chunkStore.getBlock(unknown))._tag).toBe('ChunkNotLoaded')
      yield* world.chunkStore.load(chunkOf(unknown))
      expect(yield* world.chunkStore.getBlock(unknown)).toStrictEqual({
        _tag: 'Block',
        block: AIR_BLOCK_ID,
      })
    }),
  )

  it.effect('unload removes a resident chunk and reload reads again from its source', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld({ world: worldWith([[AT, STONE]]) })
      const subscription = yield* world.chunkStore.subscribeDirty

      yield* world.chunkStore.setBlock(AT, DIRT)
      expect(yield* world.chunkStore.unload(chunkOf(AT))).toBe(true)
      expect((yield* world.chunkStore.getBlock(AT))._tag).toBe('ChunkNotLoaded')
      expect(yield* subscription.drain).toStrictEqual({
        changed: [],
        removed: [chunkOf(AT)],
      })

      yield* world.chunkStore.load(chunkOf(AT))
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({
        _tag: 'Block',
        block: STONE,
      })
    }),
  )

  it.effect('reset reports resident chunks as removed to subscribers', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld({ world: worldWith([[AT, STONE]]) })
      const subscription = yield* world.chunkStore.subscribeDirty

      yield* world.chunkStore.reset
      expect((yield* world.chunkStore.getBlock(AT))._tag).toBe('ChunkNotLoaded')
      expect(yield* subscription.drain).toStrictEqual({
        changed: [],
        removed: [chunkOf(AT)],
      })
    }),
  )

  it.effect('derives light from loaded chunks and rejects out-of-world reads', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld()
      const above = blockPosition(5, CHUNK_HEIGHT, 5)

      expect((yield* world.chunkStore.getLight(AT))._tag).toBe('ChunkNotLoaded')
      expect((yield* world.chunkStore.getLight(above))._tag).toBe('OutOfWorld')
      yield* world.chunkStore.load(chunkOf(AT))
      expect(yield* world.chunkStore.getLight(AT)).toStrictEqual({
        _tag: 'Light',
        sky: 15,
        block: 0,
      })
      expect(isInWorld(blockPosition(0, CHUNK_HEIGHT - 1, 0))).toBe(true)
    }),
  )

  it.effect('skips malformed sparse keys and blocks outside the vertical extent', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld({
        world: {
          blocks: new Map([
            [cellKey(AT), STONE],
            ['not,a,cell,key', DIRT],
            ['5,999,5', DIRT],
            ['9007199254740992,5,5', DIRT],
          ]),
          loaded: [
            chunkKey(chunkOf(AT)),
            'malformed',
            '9007199254740992,0',
            '0,9007199254740992',
          ],
        },
      })

      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({
        _tag: 'Block',
        block: STONE,
      })
      expect(yield* world.chunkStore.getBlock(blockPosition(6, 5, 5))).toStrictEqual({
        _tag: 'Block',
        block: AIR_BLOCK_ID,
      })
      expect((yield* world.chunkStore.getBlock(blockPosition(5, CHUNK_HEIGHT, 5)))._tag).toBe(
        'OutOfWorld',
      )
    }),
  )

  it.effect('treats non-finite collision and target coordinates as unavailable', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld({ world: worldWith([[AT, STONE]]) })
      const isSolid = solidityFromStore(world.chunkStore)
      const isTargetable = targetabilityFromStore(world.chunkStore)
      const invalidPositions = [
        { x: Number.NaN, y: 5, z: 5 },
        { x: 5, y: Number.NaN, z: 5 },
        { x: 5, y: 5, z: Number.NaN },
      ] as const

      for (const point of invalidPositions) {
        expect(isSolid(point)).toBe(true)
        expect(isTargetable(point.x, point.y, point.z)).toBe(false)
      }
    }),
  )
})
