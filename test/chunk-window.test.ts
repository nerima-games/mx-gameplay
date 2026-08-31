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
 *
 * ---------------------------------------------------------------------------
 * The first oracle out of the reference's `interaction-*` directory
 * ---------------------------------------------------------------------------
 *
 * `docs/testing.md` §2-2-1 has recorded `interaction-*` (33 files, 402 tests) as
 * the one untouched area of the port. Two of those 402 land here, and they are
 * both of
 * `<reference-impl>/packages/app/application/frame/stages/interaction-flint-steel-portal.test.ts`:
 *
 *   「builds the 3x3 chunk neighborhood around the ignition position」
 *   「deduplicates affected chunk coords by chunk key」
 *
 * Both are about chunk coordinates around an ignition cell, and both use a
 * NEGATIVE anchor — `{ x: -1, z: -1 }` — which is the case they exist for. The
 * 3x3 is replaced here by a radius derived from the detector's own bound
 * (`PORTAL_WINDOW_RADIUS`), because a hand-picked neighbourhood silently refuses
 * the largest legal portals; the property the second one protects is unchanged
 * and is the last test below.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  UNREADABLE_BLOCK,
  chunkCoordOf,
  chunkCoordsAround,
  openChunkWindow,
} from '../src/domain/chunk-window'
import { AIR_BLOCK_ID, blockPosition, chunkCoord, CHUNK_SIZE_XZ } from '@nerima-games/mc-kernel'
import {
  CHUNK_HEIGHT,
  blockIndex,
  readBlock,
  type ChunkStoreApi,
} from '@nerima-games/mc-worldgen'
import { makeChunkStoreDouble, world, CHUNK_SIDE, STONE } from './support/chunk-store-double'

/**
 * A store whose every member dies if called.
 *
 * `./support/chunk-store-double` allocates a full-length buffer for every chunk
 * it serves, which is the right default everywhere else in this suite and is
 * exactly what the truncated-buffer test below must override. Spreading this
 * and replacing `peek` alone keeps that test honest about which member it exercises: anything
 * it reaches by accident dies loudly instead of answering.
 */
const notAStore: ChunkStoreApi = new Proxy({} as ChunkStoreApi, {
  get: (_target, property) => {
    if (property === 'peek') {
      return () => Effect.dieMessage('peek must be overridden')
    }
    return Effect.dieMessage(`chunk-window reached ChunkStoreApi.${String(property)}`)
  },
})

describe('the buffer layout, transcribed', () => {
  it('is y-major, which is what makes a vertical walk contiguous', () => {
    // Restated rather than re-derived — see mc-worldgen's `blockIndex`. An
    // index function that is "obviously equivalent" is how two repositories end
    // up reading one buffer two ways.
    expect(blockIndex(0, 0, 0)).toBe(0)
    expect(blockIndex(0, 1, 0)).toBe(1)
    expect(blockIndex(0, 0, 1)).toBe(CHUNK_HEIGHT)
    expect(blockIndex(1, 0, 0)).toBe(CHUNK_HEIGHT * CHUNK_SIDE)
  })

  it('readBlock is TOTAL: an out-of-range index reads as air rather than throwing', () => {
    // `openChunkWindow` never hands `readBlock` an out-of-range index — it
    // guards y at the call site, per the header above `readBlock` itself — so
    // this is the one place that exercises `readBlock`'s own totality directly,
    // against a buffer too short for the index it is asked to read.
    const shortBuffer = new Uint8Array(1)
    expect(readBlock(shortBuffer, 5)).toBe(AIR_BLOCK_ID)
    expect(readBlock(shortBuffer, -1)).toBe(AIR_BLOCK_ID)
  })
})

/**
 * `chunkCoordOf`'s own expression (`domain/chunk-window.ts`), reproduced here
 * rather than called, for the one test below that needs a fractional
 * position: `chunkCoordOf` takes kernel's branded `BlockPosition` and throws
 * on a non-integer `x`/`z`, which is exactly the input that test exists to
 * exercise.
 */
const chunkCoordOfRaw = (position: { readonly x: number; readonly z: number }) =>
  chunkCoord(Math.floor(position.x / CHUNK_SIZE_XZ), Math.floor(position.z / CHUNK_SIZE_XZ))

describe('chunkCoordOf and chunkCoordsAround', () => {
  it('floors, so a negative world coordinate lands in the chunk west of the origin', () => {
    // `Math.trunc` would put x = -1 in chunk 0 along with x = 0, which is a
    // sixteen-block-wide chunk covering thirty-one columns.
    expect(chunkCoordOf(blockPosition(0, 64, 0))).toStrictEqual({ cx: 0, cz: 0 })
    expect(chunkCoordOf(blockPosition(-1, 64, -1))).toStrictEqual({ cx: -1, cz: -1 })
    expect(chunkCoordOf(blockPosition(16, 64, 31))).toStrictEqual({ cx: 1, cz: 1 })
  })

  it('covers the whole square, and covers it exactly once', () => {
    const coords = chunkCoordsAround({ x: 8, y: 64, z: 8 }, 22)

    // x and z both run -14..30, which is chunks -1..1 on each axis.
    expect(coords).toHaveLength(9)
    expect(new Set(coords.map((coord) => `${String(coord.cx)},${String(coord.cz)}`)).size).toBe(9)
    expect(coords).toContainEqual({ cx: -1, cz: -1 })
    expect(coords).toContainEqual({ cx: 1, cz: 1 })
  })

  // `<reference-impl>/packages/app/application/frame/stages/interaction-stage-underwater.test.ts:29-58`
  //
  // 「loads the 3x3 chunk neighborhood in dx-major, dz-minor order」, and it is
  // an ORDER claim: the reference records the nine `getChunk` calls and compares
  // the whole array positionally. The test above this one cannot see order at
  // all — it counts, de-duplicates through a `Set` and asks `toContainEqual`,
  // all three of which survive the loops being nested the other way round.
  //
  // `<reference-impl>/…/interaction-flint-steel-portal.test.ts:10-23` asserts the
  // same nesting on the same shape from a negative anchor, so this is two of the
  // 402 agreeing rather than one file's incidental output being frozen.
  //
  // WHY IT IS WORTH PINNING HERE, where the reference's reason does not apply.
  // There the order decides which chunk a partially-loaded neighbourhood serves
  // first. Here `openChunkWindow` peeks every coordinate before answering, so no
  // ANSWER depends on the nesting — but the peek order is observable through the
  // store double, and `test/ignite.test.ts`'s 「costs peeks and writes」 counts
  // those calls. An emission order that drifts turns a cost oracle into a
  // sequence nobody chose.
  it('emits the square in dx-major, dz-minor order, which is the reference nesting', () => {
    expect(chunkCoordsAround({ x: 8, y: 64, z: 8 }, 22)).toStrictEqual([
      { cx: -1, cz: -1 },
      { cx: -1, cz: 0 },
      { cx: -1, cz: 1 },
      { cx: 0, cz: -1 },
      { cx: 0, cz: 0 },
      { cx: 0, cz: 1 },
      { cx: 1, cz: -1 },
      { cx: 1, cz: 0 },
      { cx: 1, cz: 1 },
    ])
  })

  // Same claim from the reference's own negative anchor
  // (`interaction-flint-steel-portal.test.ts:10-23`, ignition at `x: -1, z: -1`,
  // expecting `-2..0` on both axes). The radius is this repository's
  // `PORTAL_WINDOW_RADIUS`-shaped bound rather than a hand-picked 3x3 — see this
  // file's header — and one block of reach is enough to span the same three
  // chunk columns from that anchor.
  it('spans the reference neighbourhood from a negative ignition cell', () => {
    expect(chunkCoordsAround({ x: -1, y: 64, z: -1 }, 16)).toStrictEqual([
      { cx: -2, cz: -2 },
      { cx: -2, cz: -1 },
      { cx: -2, cz: 0 },
      { cx: -1, cz: -2 },
      { cx: -1, cz: -1 },
      { cx: -1, cz: 0 },
      { cx: 0, cz: -2 },
      { cx: 0, cz: -1 },
      { cx: 0, cz: 0 },
    ])
  })

  // `interaction-stage-underwater.test.ts:24-27` —
  // 「floors world coordinates into the containing chunk coordinate」.
  //
  // The oracle above this describe's first test uses INTEGER coordinates, and an
  // integer cannot tell apart flooring the QUOTIENT from flooring the COORDINATE
  // and then truncating the quotient. The reference's inputs are fractional
  // because its caller holds a player position rather than a block position, and
  // that is exactly the input that separates them: `Math.floor(-0.1)` is `-1`,
  // and `-1 / 16` truncated is `0` — the wrong chunk, one column east.
  it('floors the quotient and not the coordinate, which a fractional position can tell apart', () => {
    // `chunkCoordOf` itself takes kernel's branded, integer-only `BlockPosition`
    // and would throw on the fractional input this test needs — the whole point
    // being made above is about a caller (a player position) that is NOT a
    // `BlockPosition`. `chunkCoordOfRaw` below is `chunkCoordOf`'s own
    // Math.floor-the-quotient expression, inlined ahead of that branded
    // boundary, for exactly the reason `domain/chunk-window.ts`'s
    // `chunkCoordsAround` takes the same plain shape.
    expect(chunkCoordOfRaw({ x: 0.1, z: 15.9 })).toStrictEqual({ cx: 0, cz: 0 })
    expect(chunkCoordOfRaw({ x: -0.1, z: -16.01 })).toStrictEqual({ cx: -1, cz: -2 })
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
      const store = yield* makeChunkStoreDouble(world([[blockPosition(3, 64, 5), STONE]]), ['0,0'])
      const window = yield* openChunkWindow(store.api, [chunkCoord(0, 0)])

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
        chunkCoord(0, 0),
        chunkCoord(1, 0),
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

  // F9 — the reference rejects incomplete chunk storage instead of converting
  // missing cells to air. This is the agreement claim for that behaviour.
  //
  // Four of the 402 make the same claim, all in
  // `<reference-impl>/…/interaction-block-access.test.ts` —
  //
  //   :78  「rejects incomplete chunk storage instead of converting missing
  //         cells to air」   (`blocks: new Uint8Array(0)`)
  //   :93  「rejects chunk block indexes outside the fixed storage range」
  //   :104 「rejects fixed-length chunk storage with a missing cell」
  //   :170 「fails when a cached chunk has incomplete storage」
  //
  // — and each one is an `InteractionBlockReadError` there.
  //
  it.effect('answers UNREADABLE for a cell missing from a resident chunk buffer', () =>
    Effect.gen(function* () {
      const shortBuffered: ChunkStoreApi = {
        ...notAStore,
        peek: (coord) =>
          Effect.succeed({
            coord,
            blocks: new Uint8Array(0),
            biomes: [],
          }),
      }

      const window = yield* openChunkWindow(shortBuffered, [chunkCoord(0, 0)])

      expect(window.blockAt(0, 64, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.unreadableProbes()).toBe(1)
    }),
  )

  it.effect('answers UNREADABLE outside the requested square, so too small a window is visible', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0', '1,0'])
      // Chunk 1,0 is resident but was NOT asked for.
      const window = yield* openChunkWindow(store.api, [chunkCoord(0, 0)])

      expect(window.blockAt(20, 64, 0)).toBe(UNREADABLE_BLOCK)
      expect(window.unreadableProbes()).toBe(1)
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 1 })
    }),
  )

  it.effect('answers UNREADABLE below bedrock and above the build limit', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const window = yield* openChunkWindow(store.api, [chunkCoord(0, 0)])

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
      const window = yield* openChunkWindow(store.api, [chunkCoord(0, 0)])

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
          [blockPosition(-1, 64, -1), STONE],
          [blockPosition(-16, 70, -16), STONE],
        ]),
        ['-1,-1'],
      )
      const window = yield* openChunkWindow(store.api, [chunkCoord(-1, -1)])

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
