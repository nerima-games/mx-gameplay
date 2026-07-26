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
  type BlockId,
  type BlockPosition,
  type BlockReading,
  type BlockWriteOutcome,
  type ChunkDirtyBatch,
  type ChunkDirtySubscription,
  type ChunkStoreApi,
} from '../../domain/chunk-store-port'

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

export type StoreCalls = {
  readonly reads: number
  readonly writes: number
}

type Doubles = {
  readonly blocks: Map<string, BlockId>
  readonly loadedChunks: Set<string>
  readonly subscribers: Map<number, Set<string>>
  nextSubscriber: number
  reads: number
  writes: number
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
): Effect.Effect<ChunkStoreDouble> =>
  Effect.map(
    Ref.make<Doubles>({
      blocks: new Map(initial),
      loadedChunks: new Set(loaded),
      subscribers: new Map(),
      nextSubscriber: 0,
      reads: 0,
      writes: 0,
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
        peek: () => notImplemented,
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
