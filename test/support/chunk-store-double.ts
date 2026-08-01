/**
 * A test double for mc-worldgen's `ChunkStore`, typed by this repository's
 * mirror of that service (`domain/chunk-store-port.ts`).
 *
 * ---------------------------------------------------------------------------
 * Why a double at all, and what makes it meaningful
 * ---------------------------------------------------------------------------
 *
 * Nothing is published (plan.md §6 Step 3 is bottom-up publish-then-pin), so
 * mx-gameplay cannot import mc-worldgen's implementation today. What it CAN do
 * is be typed by mc-worldgen's interface: the mirror is pinned against that
 * interface in both directions by `test/chunk-store-mirror.test.ts`, so a
 * double built against the mirror cannot quietly drift into a different
 * service. The same scenarios against the REAL store are
 * `mc-worldgen/test/vertical-slice.test.ts`; between the two the whole path is
 * covered, and when mc-worldgen is published this file is deleted and its Layer
 * is replaced by the real one.
 *
 * It is sparse — a `Map` from a position key to a block id — because the rules
 * under test never look at a chunk, only at cells. It reproduces the three
 * store semantics a rule can get wrong (`mc-worldgen/docs/public-api.md` §6-3,
 * §6-4):
 *
 *   - an unloaded chunk reads `ChunkNotLoaded`, never air;
 *   - writing the same block back is `Unchanged` and does NOT dirty;
 *   - each subscriber accumulates a SET, so N writes to one chunk drain once.
 *
 * It also counts reads and writes. That is not decoration: "an idle tick does
 * no falling-block work" is a claim about the number of store calls, and
 * asserting it on the world's contents instead would pass even if the stage
 * scanned every loaded chunk and happened to change nothing.
 *
 * Methods outside the slice die rather than return a plausible value. A double
 * that quietly answers `load` would let a rule start scanning chunks and the
 * test suite would not notice.
 */
import { Effect, Layer, Ref } from 'effect'
import {
  AIR_BLOCK_ID,
  ChunkStore,
  blockIndex,
  type BlockId,
  type BlockPosition,
  type BlockReading,
  type BlockWriteOutcome,
  type ChunkDirtyBatch,
  type ChunkDirtySubscription,
  type ChunkStoreApi,
  type LightReading,
  type WorldgenChunk,
} from '../../src/domain/chunk-store-port'

/** Block ids, transcribed from kernel's `BLOCK_REGISTRY` (see the mirror). */
export const STONE: BlockId = 2
export const SAND: BlockId = 5
export const WATER: BlockId = 6
export const GRAVEL: BlockId = 8

export const CHUNK_SIDE = 16
export const WORLD_HEIGHT = 256

/**
 * The double's own key encoding, deliberately NOT `domain/block-position-key.ts`.
 *
 * Sharing that function would make a double consistent with a broken encoding:
 * the rule would write where the double reads and every test would pass while
 * the real store saw something else.
 */
export const blockKey = (position: BlockPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

export const chunkKeyOf = (position: BlockPosition): string =>
  `${String(Math.floor(position.x / CHUNK_SIDE))},${String(Math.floor(position.z / CHUNK_SIDE))}`

const chunkCoordOf = (position: BlockPosition) => ({
  cx: Math.floor(position.x / CHUNK_SIDE),
  cz: Math.floor(position.z / CHUNK_SIDE),
})

export const world = (
  entries: ReadonlyArray<readonly [BlockPosition, BlockId]>,
): ReadonlyMap<string, BlockId> =>
  new Map(entries.map(([position, block]) => [blockKey(position), block] as const))

/** One cell's brightness, as the double stores it. */
export type LightLevels = {
  readonly sky: number
  readonly block: number
}

/**
 * A sparse light world, for the cells a test actually cares about.
 *
 * SPARSE AND DARK BY DEFAULT, which is the honest default for a double of a
 * grid rather than a convenient one: a cell nobody lit is a cell with no light,
 * and the rule under test refuses cells that are too BRIGHT, so darkness is the
 * permissive direction. A test that wants a refusal has to say so, which is
 * what makes `too-bright` a claim rather than a coincidence.
 *
 * The double does NOT propagate. Computing light is mc-worldgen's job and
 * `mc-worldgen/test/light.test.ts` is where the BFS is checked; reproducing it
 * here would mean two implementations of one algorithm and a test suite that
 * agreed with itself rather than with the store.
 */
export const lightWorld = (
  entries: ReadonlyArray<readonly [BlockPosition, LightLevels]>,
): ReadonlyMap<string, LightLevels> =>
  new Map(entries.map(([position, levels]) => [blockKey(position), levels] as const))

const DARK: LightLevels = { sky: 0, block: 0 }

export type StoreCalls = {
  readonly reads: number
  readonly writes: number
  /**
   * `peek` calls. COUNTED SEPARATELY from `reads`, and that separation is the
   * point of the counter rather than bookkeeping.
   *
   * A `peek` is one chunk and a `getBlock` is one cell, so folding them together
   * would make `domain/interactions/ignite-portal.ts` — which fetches a handful
   * of chunks and then reads five hundred cells out of them without touching the
   * store — look identical to the five-hundred-round-trip version
   * `domain/chunk-window.ts`'s header rejects on cost. The two are only
   * distinguishable if the units are.
   */
  readonly peeks: number
}

type Doubles = {
  readonly blocks: Map<string, BlockId>
  readonly lights: Map<string, LightLevels>
  readonly loadedChunks: Set<string>
  readonly subscribers: Map<number, Set<string>>
  nextSubscriber: number
  reads: number
  writes: number
  peeks: number
}

export type ChunkStoreDouble = {
  /** Handed straight to `gameplayStages`, which takes the API rather than the tag. */
  readonly api: ChunkStoreApi
  /** For the `makeGameplayStages` path, which acquires the tag itself. */
  readonly layer: Layer.Layer<ChunkStore>
  readonly calls: Effect.Effect<StoreCalls>
  /** Reads the world without going through the counters. */
  readonly blockAt: (position: BlockPosition) => Effect.Effect<BlockId | undefined>
}

export const makeChunkStoreDouble = (
  initial: ReadonlyMap<string, BlockId>,
  loaded: ReadonlyArray<string>,
  /**
   * Optional, and defaulted to an empty map rather than made required, so that
   * the twenty-odd existing call sites keep their meaning: a world nobody lit
   * is a dark world, which is exactly what they were testing against before
   * `getLight` existed.
   */
  lights: ReadonlyMap<string, LightLevels> = new Map(),
): Effect.Effect<ChunkStoreDouble> =>
  Effect.map(
    Ref.make<Doubles>({
      blocks: new Map(initial),
      lights: new Map(lights),
      loadedChunks: new Set(loaded),
      subscribers: new Map(),
      nextSubscriber: 0,
      reads: 0,
      writes: 0,
      peeks: 0,
    }),
    (state) => {
      const notImplemented = Effect.dieMessage('not exercised by this test')

      const markDirty = (doubles: Doubles, position: BlockPosition): void => {
        for (const pending of doubles.subscribers.values()) {
          pending.add(chunkKeyOf(position))
        }
      }

      const subscribe: Effect.Effect<ChunkDirtySubscription> = Ref.modify(state, (doubles) => {
        const id = doubles.nextSubscriber
        doubles.subscribers.set(id, new Set())

        const subscription: ChunkDirtySubscription = {
          id,
          drain: Ref.modify(state, (current) => {
            const pending = current.subscribers.get(id) ?? new Set<string>()
            const batch: ChunkDirtyBatch = {
              changed: [...pending].map((entry) => {
                const [cx, cz] = entry.split(',')
                return { cx: Number(cx), cz: Number(cz) }
              }),
              removed: [],
            }
            current.subscribers.set(id, new Set())
            return [batch, current] as const
          }),
          unsubscribe: Ref.update(state, (current) => {
            current.subscribers.delete(id)
            return current
          }),
        }

        return [subscription, { ...doubles, nextSubscriber: id + 1 }] as const
      })

      const api: ChunkStoreApi = {
        load: () => notImplemented,

        /**
         * MATERIALISED FROM THE SPARSE MAP, not stored as a buffer.
         *
         * The double keeps a `Map` from a cell key to a block because every rule
         * before `domain/interactions/ignite-portal.ts` read cells. That rule
         * reads a chunk, so this builds the `Uint8Array` mc-worldgen would have
         * handed back — 65,536 bytes per call, which is the wrong shape for a
         * hot path and exactly the right shape for a test: it means the double's
         * one source of truth stays the map, and a cell written through
         * `setBlock` is visible to the next `peek` with no bookkeeping to get
         * wrong.
         *
         * `undefined` for a chunk that is not resident, which is mc-worldgen's
         * contract ("Look without loading") and is what makes
         * `domain/chunk-window.ts`'s `UNREADABLE_BLOCK` reachable.
         */
        peek: (coord) =>
          Ref.modify(state, (doubles): readonly [WorldgenChunk | undefined, Doubles] => {
            doubles.peeks += 1
            const key = `${String(coord.cx)},${String(coord.cz)}`
            if (!doubles.loadedChunks.has(key)) {
              return [undefined, doubles] as const
            }

            const blocks = new Uint8Array(CHUNK_SIDE * CHUNK_SIDE * WORLD_HEIGHT)
            for (const [cell, block] of doubles.blocks) {
              const [x, y, z] = cell.split(',').map(Number)
              if (x === undefined || y === undefined || z === undefined) continue
              if (Math.floor(x / CHUNK_SIDE) !== coord.cx) continue
              if (Math.floor(z / CHUNK_SIDE) !== coord.cz) continue
              if (y < 0 || y >= WORLD_HEIGHT) continue

              const lx = ((x % CHUNK_SIDE) + CHUNK_SIDE) % CHUNK_SIDE
              const lz = ((z % CHUNK_SIDE) + CHUNK_SIDE) % CHUNK_SIDE
              blocks[blockIndex(lx, y, lz)] = block
            }

            return [{ coord, blocks, biomes: [] }, doubles] as const
          }),

        snapshot: () => notImplemented,
        isLoaded: (coord) =>
          Effect.map(Ref.get(state), (doubles) =>
            doubles.loadedChunks.has(`${String(coord.cx)},${String(coord.cz)}`),
          ),
        loadedCoords: notImplemented,
        neighbours: () => notImplemented,
        unload: () => notImplemented,

        getBlock: (position) =>
          Ref.modify(state, (doubles): readonly [BlockReading, Doubles] => {
            doubles.reads += 1
            if (position.y < 0 || position.y >= WORLD_HEIGHT) {
              return [{ _tag: 'OutOfWorld' } as const, doubles] as const
            }
            if (!doubles.loadedChunks.has(chunkKeyOf(position))) {
              return [{ _tag: 'ChunkNotLoaded' } as const, doubles] as const
            }
            return [
              { _tag: 'Block', block: doubles.blocks.get(blockKey(position)) ?? AIR_BLOCK_ID } as const,
              doubles,
            ] as const
          }),

        setBlock: (position, block) =>
          Ref.modify(state, (doubles): readonly [BlockWriteOutcome, Doubles] => {
            doubles.writes += 1
            if (position.y < 0 || position.y >= WORLD_HEIGHT) {
              return [{ _tag: 'OutOfWorld' } as const, doubles] as const
            }
            if (!doubles.loadedChunks.has(chunkKeyOf(position))) {
              return [{ _tag: 'ChunkNotLoaded' } as const, doubles] as const
            }

            const previous = doubles.blocks.get(blockKey(position)) ?? AIR_BLOCK_ID
            if (previous === block) {
              // No dirty mark. A fluid re-asserting its own level, or a player
              // holding the mine button over empty air, must not re-mesh the
              // chunk every tick.
              return [{ _tag: 'Unchanged', previous } as const, doubles] as const
            }

            doubles.blocks.set(blockKey(position), block)
            markDirty(doubles, position)

            return [
              { _tag: 'Written', previous, chunk: chunkCoordOf(position) } as const,
              doubles,
            ] as const
          }),

        getLight: (position) =>
          Ref.modify(state, (doubles): readonly [LightReading, Doubles] => {
            // COUNTED AS A READ, alongside `getBlock`. The spawn search's cost
            // is the number of store calls it makes per attempt, and a light
            // query that did not appear in the count would let the ring grow
            // silently — which is DN-GP-1's failure measured in the one unit
            // that catches it.
            doubles.reads += 1
            if (position.y < 0 || position.y >= WORLD_HEIGHT) {
              return [{ _tag: 'OutOfWorld' } as const, doubles] as const
            }
            if (!doubles.loadedChunks.has(chunkKeyOf(position))) {
              // NOT darkness. The whole reason the reading is three-valued: a
              // rule that read an unloaded chunk as pitch dark would spawn
              // hostiles at the edge of the loaded area in daylight.
              return [{ _tag: 'ChunkNotLoaded' } as const, doubles] as const
            }

            const levels = doubles.lights.get(blockKey(position)) ?? DARK
            return [{ _tag: 'Light', sky: levels.sky, block: levels.block } as const, doubles] as const
          }),

        subscribeDirty: subscribe,
        subscribeDirtyScoped: Effect.acquireRelease(subscribe, (s) => s.unsubscribe),
        reset: Ref.update(state, (doubles) => {
          doubles.blocks.clear()
          return doubles
        }),
      }

      return {
        api,
        layer: Layer.succeed(ChunkStore, api),
        calls: Effect.map(Ref.get(state), (doubles) => ({
          reads: doubles.reads,
          writes: doubles.writes,
          peeks: doubles.peeks,
        })),
        blockAt: (position) =>
          Effect.map(Ref.get(state), (doubles) => doubles.blocks.get(blockKey(position))),
      }
    },
  )

/**
 * One resident chunk with nothing in it.
 *
 * The default for tests that are about the SHAPE of the registration rather
 * than about the world: a rule that reads it finds air everywhere, which is a
 * legal world and not a special case. Declared after the factory it calls
 * because it evaluates at module load.
 */
export const emptyWorldStoreLayer: Layer.Layer<ChunkStore> = Layer.effect(
  ChunkStore,
  Effect.map(makeChunkStoreDouble(world([]), ['0,0']), (double) => double.api),
)
