/**
 * `domain/chunk-window.ts` — the bridge from an `Effect`-shaped store to the
 * synchronous accessor mc-worldgen's portal rule takes.
 *
 * Two claims are worth pinning here rather than through the rule that uses it,
 * because both are about the SHORTCUT and the rule would still pass if either
 * were broken in the fabricating direction:
 *
 *   1. an unreadable cell reads as `UNREADABLE_BLOCK` and is COUNTED, so
 *      `ChunkNotLoaded` survives a chunk-buffer read;
 *   2. the layout arithmetic is right at a negative coordinate and at a chunk
 *      boundary, which is where `%` in JavaScript quietly does the wrong thing.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  UNREADABLE_BLOCK,
  chunkCoordOf,
  chunkCoordsAround,
  openChunkWindow,
} from '../domain/chunk-window'
import { AIR_BLOCK_ID, CHUNK_HEIGHT, blockIndex } from '../domain/chunk-store-port'
import { makeChunkStoreDouble, world, CHUNK_SIDE, STONE } from './support/chunk-store-double'

describe('the buffer layout, transcribed', () => {
  it('is y-major, which is what makes a vertical walk contiguous', () => {
    // Restated rather than re-derived — see `domain/chunk-store-port.ts`. An
    // index function that is "obviously equivalent" is how two repositories end
    // up reading one buffer two ways.
    expect(blockIndex(0, 0, 0)).toBe(0)
    expect(blockIndex(0, 1, 0)).toBe(1)
    expect(blockIndex(0, 0, 1)).toBe(CHUNK_HEIGHT)
    expect(blockIndex(1, 0, 0)).toBe(CHUNK_HEIGHT * CHUNK_SIDE)
  })
})

describe('chunkCoordOf and chunkCoordsAround', () => {
  it('floors, so a negative world coordinate lands in the chunk west of the origin', () => {
    // `Math.trunc` would put x = -1 in chunk 0 along with x = 0, which is a
    // sixteen-block-wide chunk covering thirty-one columns.
    expect(chunkCoordOf({ x: 0, y: 64, z: 0 })).toStrictEqual({ cx: 0, cz: 0 })
    expect(chunkCoordOf({ x: -1, y: 64, z: -1 })).toStrictEqual({ cx: -1, cz: -1 })
    expect(chunkCoordOf({ x: 16, y: 64, z: 31 })).toStrictEqual({ cx: 1, cz: 1 })
  })

  it('covers the whole square, and covers it exactly once', () => {
    const coords = chunkCoordsAround({ x: 8, y: 64, z: 8 }, 22)

    // x and z both run -14..30, which is chunks -1..1 on each axis.
    expect(coords).toHaveLength(9)
    expect(new Set(coords.map((coord) => `${String(coord.cx)},${String(coord.cz)}`)).size).toBe(9)
    expect(coords).toContainEqual({ cx: -1, cz: -1 })
    expect(coords).toContainEqual({ cx: 1, cz: 1 })
  })

  it('yields nothing for a centre or a radius that is not a usable number', () => {
    // TOTAL: a window opened on nonsense answers `UNREADABLE_BLOCK` everywhere
    // rather than looping. `positionOfKey` yields `NaN` coordinates for a
    // malformed key and that is the path this guards.
    expect(chunkCoordsAround({ x: Number.NaN, y: 64, z: 0 }, 22)).toStrictEqual([])
    expect(chunkCoordsAround({ x: 0, y: 64, z: Number.NaN }, 22)).toStrictEqual([])
    expect(chunkCoordsAround({ x: 0, y: 64, z: 0 }, Number.POSITIVE_INFINITY)).toStrictEqual([])
    expect(chunkCoordsAround({ x: 0, y: 64, z: 0 }, -1)).toStrictEqual([])
  })
})

describe('openChunkWindow', () => {
  it.effect('reads real bytes out of the peeked buffers, and costs one peek per chunk', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[{ x: 3, y: 64, z: 5 }, STONE]]), ['0,0'])
      const window = yield* openChunkWindow(store.api, [{ cx: 0, cz: 0 }])

      expect(window.blockAt(3, 64, 5)).toBe(STONE)
      expect(window.blockAt(3, 65, 5)).toBe(AIR_BLOCK_ID)
      expect(window.unreadableProbes()).toBe(0)

      // THE WHOLE POINT OF THE FILE, in one assertion: three cell reads and no
      // `getBlock` at all. `domain/chunk-window.ts`'s header rejects the
      // per-cell version at 3,872 store calls per right-click, and this is the
      // unit that tells the two apart.
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 1 })
    }),
  )

  it.effect('answers UNREADABLE for a chunk that is not resident, and counts it', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const window = yield* openChunkWindow(store.api, [
        { cx: 0, cz: 0 },
        { cx: 1, cz: 0 },
      ])

      // NOT AIR. This is the distinction a chunk-buffer read normally throws
      // away, and `UNREADABLE_BLOCK` is not a `BlockId` any registry row
      // carries — so a consumer that forgets the counter still refuses rather
      // than fabricating a portal in unloaded space.
      expect(window.blockAt(20, 64, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.blockAt(20, 64, 0)).not.toBe(AIR_BLOCK_ID)
      expect(window.unreadableProbes()).toBe(2)

      // A cell in the resident chunk still answers.
      expect(window.blockAt(0, 64, 0)).toBe(AIR_BLOCK_ID)
      expect(window.unreadableProbes()).toBe(2)
    }),
  )

  it.effect('answers UNREADABLE outside the requested square, so too small a window is visible', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0', '1,0'])
      // Chunk 1,0 is resident but was NOT asked for.
      const window = yield* openChunkWindow(store.api, [{ cx: 0, cz: 0 }])

      expect(window.blockAt(20, 64, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.unreadableProbes()).toBe(1)
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 1 })
    }),
  )

  it.effect('answers UNREADABLE below bedrock and above the build limit', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const window = yield* openChunkWindow(store.api, [{ cx: 0, cz: 0 }])

      // THE SHARP CASE. `readBlock` is total and answers AIR for an
      // out-of-range index, so without this guard a portal could be detected in
      // fabricated air under the world. Both bounds, and both are refusals.
      expect(window.blockAt(0, -1, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.blockAt(0, CHUNK_HEIGHT, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.blockAt(0, CHUNK_HEIGHT - 1, 0)).toBe(AIR_BLOCK_ID)
      expect(window.unreadableProbes()).toBe(2)
    }),
  )

  it.effect('answers UNREADABLE for a coordinate that is not an integer', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const window = yield* openChunkWindow(store.api, [{ cx: 0, cz: 0 }])

      // `positionOfKey` yields `NaN` for a malformed key and says so: a `NaN`
      // position must not be answered with a plausible byte.
      expect(window.blockAt(Number.NaN, 64, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.blockAt(0, Number.NaN, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.blockAt(0, 64, 0.5)).toBe(UNREADABLE_BLOCK)
      expect(window.blockAt(0.5, 64, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.unreadableProbes()).toBe(4)
    }),
  )

  it.effect('gets the local coordinate right west of the origin, where `%` is negative', () =>
    Effect.gen(function* () {
      // `-1 % 16` is `-1` in JavaScript, so a naive local coordinate indexes
      // BACKWARDS out of the column — and `readBlock` would answer with a real
      // byte from the wrong place rather than with a miss. The cell below is at
      // local x = 15 of chunk -1.
      const store = yield* makeChunkStoreDouble(
        world([
          [{ x: -1, y: 64, z: -1 }, STONE],
          [{ x: -16, y: 70, z: -16 }, STONE],
        ]),
        ['-1,-1'],
      )
      const window = yield* openChunkWindow(store.api, [{ cx: -1, cz: -1 }])

      expect(window.blockAt(-1, 64, -1)).toBe(STONE)
      expect(window.blockAt(-16, 70, -16)).toBe(STONE)
      expect(window.blockAt(-2, 64, -1)).toBe(AIR_BLOCK_ID)
      expect(window.unreadableProbes()).toBe(0)
    }),
  )

  it.effect('opens over no chunks at all, and refuses everything', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const window = yield* openChunkWindow(store.api, [])

      expect(window.blockAt(0, 64, 0)).toBe(UNREADABLE_BLOCK)
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 0 })
    }),
  )
})
