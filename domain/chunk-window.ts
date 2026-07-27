/**
 * A synchronous `BlockAt` over a fixed set of resident chunks.
 *
 * ---------------------------------------------------------------------------
 * The one problem this file exists to solve
 * ---------------------------------------------------------------------------
 *
 * `./portal-frame-port`'s `detectNetherPortal` takes a SYNCHRONOUS accessor and
 * probes on the order of five hundred cells. Every block read in this repository
 * is an `Effect`. Those two facts do not compose, and there are exactly three
 * ways to make them:
 *
 *   1. READ THE BOX FIRST, cell by cell. Every probe detection can make lies
 *      inside `h in [h0-22, h0+21], y in [y0-22, y0+21]` on each of two planes,
 *      which is 3,872 `getBlock` calls per right-click — paid in full whether
 *      the player clicked a portal frame or a dirt wall. Rejected on cost.
 *   2. RESOLVE BY DEMAND: run detection against a cache, collect the cells it
 *      missed, read those, run it again, repeat. The reads are then proportional
 *      to the answer (about thirty for a real portal, one for a dirt wall), and
 *      the round count is proportional to the DEPTH of the probe chain — up to
 *      five hundred sequential rounds for a click into open sky, because the
 *      interior sweep returns on its first unknown cell. Rejected on complexity:
 *      a fixpoint loop whose bound is an argument about somebody else's control
 *      flow is a bound that stops holding when they change it.
 *   3. FETCH THE CHUNKS, INDEX THE BUFFERS. Nine to sixteen `peek` calls, then
 *      pure array reads. THIS FILE.
 *
 * Three is also what the reference implementation does — `buildBlockAtFromCache`
 * over a 3x3 chunk neighbourhood
 * (`<reference-impl>/packages/app/application/frame/stages/interaction-flint-steel-portal.ts`)
 * — so it is a port rather than an invention, and `./chunk-store-port`'s note on
 * `blockIndex` argues the buffer indexing itself.
 *
 * ---------------------------------------------------------------------------
 * `ChunkNotLoaded` IS NOT AIR, AND THAT SURVIVES THE SHORTCUT
 * ---------------------------------------------------------------------------
 *
 * This is the thing a chunk-buffer read normally throws away, and it is the
 * whole reason `BlockReading` has three cases. It is kept here in two steps:
 *
 *   - `peek` and not `load`. A rule must not force a chunk into residence — that
 *     is a generation decision and it belongs to whoever owns the loaded set —
 *     so an absent chunk stays absent and its cells read `UNREADABLE_BLOCK`.
 *   - `UNREADABLE_BLOCK` is `-1`, which is not a `BlockId` any registry row
 *     carries. It cannot be mistaken for air, for obsidian, or for anything
 *     else, so a consumer that forgets to check the counter still gets a
 *     REFUSAL rather than a fabricated portal in unloaded space. The counter
 *     then lets `./interactions/ignite-portal` say `ChunkNotLoaded` instead of
 *     "there is no frame here", which are different answers to the player.
 *
 * The same value answers a `y` outside the world, and that case is the sharper
 * one: `./chunk-store-port`'s `readBlock` is TOTAL and answers AIR for an
 * out-of-range index, so handing it an unclamped `y` would report empty space
 * below bedrock. A portal detected in fabricated air under the world is a
 * portal, and nothing in `readBlock` would say otherwise. The guard is here,
 * where the coordinate arrives, and it is the reason this file exists as
 * something other than a two-line closure.
 *
 * ---------------------------------------------------------------------------
 * A LIVE VIEW, AND WHY THAT IS SAFE HERE AND NOT IN GENERAL
 * ---------------------------------------------------------------------------
 *
 * `peek` resolves to mc-worldgen's LIVE chunk ("Look without loading. `undefined`
 * if not resident. Live view."), not to `snapshot`'s detached copy. The copy
 * would be sixteen chunks of 64KiB memcpy per right-click, to protect against a
 * writer that does not exist: within one frame there is exactly one writer of
 * the store in this repository (`./interactions/place-block`'s header records
 * the same fact for the same reason), and the window between opening this and
 * reading the last cell contains no `yield`.
 *
 * A CALLER THAT WRITES THROUGH THE STORE MUST NOT KEEP READING. Once
 * `./interactions/ignite-portal` starts filling the interior, the buffers under
 * this window are the ones changing, and a `blockAt` call after the first write
 * would see a half-lit portal. That ordering is stated at that call site rather
 * than defended with a copy, because a copy would only make the stale answer
 * quieter.
 */
import { Effect } from 'effect'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  blockIndex,
  readBlock,
  type BlockPosition,
  type ChunkCoord,
  type ChunkStoreApi,
  type WorldgenChunk,
} from './chunk-store-port'
import type { BlockAt } from './portal-frame-port'

/**
 * The answer for a cell this window cannot speak for.
 *
 * NOT a `BlockId`. Kernel's registry runs 0..119 and every id is a
 * `Uint8Array` element, so a negative number cannot collide with a row now or
 * after any number of additions. See the header on why the inert answer is a
 * value rather than a throw: the consumers are pure predicates over a byte, and
 * every one of them answers "no" to a byte it cannot name.
 */
export const UNREADABLE_BLOCK = -1

export type ChunkWindow = {
  /** The synchronous accessor `./portal-frame-port` wants. */
  readonly blockAt: BlockAt
  /**
   * How many probes fell on a cell this window could not answer — an absent
   * chunk, or a `y` outside the world.
   *
   * A FUNCTION AND NOT A NUMBER, because it is read AFTER the probing is done
   * and a number would have been captured before any of it happened. A caller
   * uses it to tell "no frame here" from "I could not see", which are different
   * things to tell the player.
   */
  readonly unreadableProbes: () => number
}

/** The chunk a world position lives in. `Math.floor`, so negative x works. */
export const chunkCoordOf = (position: BlockPosition): ChunkCoord => ({
  cx: Math.floor(position.x / CHUNK_SIZE_XZ),
  cz: Math.floor(position.z / CHUNK_SIZE_XZ),
})

/**
 * Every chunk coordinate covering the square `[x-radius, x+radius]` by
 * `[z-radius, z+radius]` around `centre`.
 *
 * A SQUARE, although `detectNetherPortal` only ever probes two PLANES through
 * the centre and therefore only needs an L of chunks. The square is between one
 * and seven extra `peek` calls, each an `O(1)` map lookup that usually misses,
 * and the L-shaped version is arithmetic that has to be right about which axis
 * `fixed` is on — a shape the caller would then have to keep in step with a rule
 * it does not own. The cheap thing to get wrong is not worth the cheaper call.
 *
 * TOTAL: a non-finite centre or radius yields no coordinates, so a window opened
 * on nonsense answers `UNREADABLE_BLOCK` everywhere rather than looping.
 */
export const chunkCoordsAround = (
  centre: BlockPosition,
  radius: number,
): ReadonlyArray<ChunkCoord> => {
  if (!Number.isFinite(centre.x) || !Number.isFinite(centre.z) || !Number.isFinite(radius) || radius < 0) {
    return []
  }

  const minCx = Math.floor((centre.x - radius) / CHUNK_SIZE_XZ)
  const maxCx = Math.floor((centre.x + radius) / CHUNK_SIZE_XZ)
  const minCz = Math.floor((centre.z - radius) / CHUNK_SIZE_XZ)
  const maxCz = Math.floor((centre.z + radius) / CHUNK_SIZE_XZ)

  const coords: Array<ChunkCoord> = []
  for (let cx = minCx; cx <= maxCx; cx += 1) {
    for (let cz = minCz; cz <= maxCz; cz += 1) {
      coords.push({ cx, cz })
    }
  }
  return coords
}

const chunkKey = (coord: ChunkCoord): string => `${String(coord.cx)},${String(coord.cz)}`

/**
 * Chunk-local coordinate. `((n % s) + s) % s` and not `n % s`, because `-1 % 16`
 * is `-1` in JavaScript and a portal one block west of the origin would index
 * backwards out of the buffer — into another column's cells, which `readBlock`
 * would answer with a real byte from the wrong place rather than with a miss.
 */
const localOf = (world: number): number => ((world % CHUNK_SIZE_XZ) + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ

/**
 * Fetch the named chunks and hand back a synchronous accessor over them.
 *
 * ONE `peek` PER COORDINATE AND NOTHING ELSE. Absent chunks are simply absent
 * from the map; nothing is loaded, generated or written.
 *
 * The accessor is TOTAL over every `(x, y, z)`, including coordinates outside
 * the requested square — they read `UNREADABLE_BLOCK` and are counted, which is
 * what lets a caller notice that it asked for too small a window instead of
 * silently getting a different answer.
 */
export const openChunkWindow = (
  store: ChunkStoreApi,
  coords: ReadonlyArray<ChunkCoord>,
): Effect.Effect<ChunkWindow> =>
  Effect.gen(function* () {
    const chunks = new Map<string, WorldgenChunk>()
    for (const coord of coords) {
      const chunk = yield* store.peek(coord)
      if (chunk !== undefined) {
        chunks.set(chunkKey(coord), chunk)
      }
    }

    let unreadable = 0

    const blockAt: BlockAt = (x, y, z) => {
      // The world bound first, because it is the one `readBlock` would answer
      // with fabricated air. See the header.
      if (!Number.isInteger(y) || y < 0 || y >= CHUNK_HEIGHT) {
        unreadable += 1
        return UNREADABLE_BLOCK
      }
      if (!Number.isInteger(x) || !Number.isInteger(z)) {
        unreadable += 1
        return UNREADABLE_BLOCK
      }

      const chunk = chunks.get(chunkKey(chunkCoordOf({ x, y, z })))
      if (chunk === undefined) {
        unreadable += 1
        return UNREADABLE_BLOCK
      }

      return readBlock(chunk.blocks, blockIndex(localOf(x), y, localOf(z)))
    }

    return { blockAt, unreadableProbes: () => unreadable }
  })
