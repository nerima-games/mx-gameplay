/**
 * A COMPLETE in-memory `ChunkStore`, typed by `@nerima-games/mc-worldgen`'s
 * real `ChunkStoreApi`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IS NOT A TEST DOUBLE
 * ---------------------------------------------------------------------------
 *
 * `gameplayModule` is `GameModule<..., ChunkStore | EntityManager |
 * InventoryService>`: registering it needs all three, and mc-compose's own
 * entry point records at length that the ONLY implementations in the
 * organisation live in `test/support/*-double.ts` — that none is exported from
 * a package's public API, and that composing them would be
 * 「偽物のモジュールを4つ作って合成すれば、検証されるのは偽物である」
 * (docs/testing.md §3.4). That reading is correct and this file does not
 * contradict it.
 *
 * WHAT MAKES THIS DIFFERENT FROM `test/support/chunk-store-double.ts` IS NOT
 * ITS LOCATION. That file's own header says: 「Methods outside the slice die
 * rather than return a plausible value」, and five of its thirteen members are
 * `Effect.dieMessage('not exercised by this test')`. Handing that to a running
 * game means the game dies the first time anything calls `load`.
 *
 * Every member here is implemented. There is no `notImplemented`, no method
 * that answers a plausible lie, and no branch that exists to keep a test quiet.
 * It is a real store whose backing happens to be a `Map` — the same way an
 * in-memory database is a real database.
 *
 * ---------------------------------------------------------------------------
 * IT IS STILL NOT mc-worldgen's STORE, AND THE DIFFERENCE IS NAMED
 * ---------------------------------------------------------------------------
 *
 * Chunk storage belongs to mc-worldgen (docs/responsibility.md), and this file
 * does not claim it. What it is: a store for a world that is HANDED TO IT
 * rather than generated — no terrain generation, no persistence, no eviction
 * policy, no disk. `load` on an unknown chunk yields an empty one rather than
 * generating, because generating is precisely the part that is not ours.
 *
 * It existed, historically, because `domain/chunk-store-port.ts` was a mirror
 * that `check:mirrors` pinned in both directions, so an implementation written
 * against it could not drift into a different service — and because a rule
 * with no store cannot be exercised by anything except a test. mc-worldgen has
 * now published and `chunk-store-port.ts` is deleted, its callers repointed to
 * mc-worldgen directly, which is the trigger this header used to say would
 * delete this file too and replace its Layer with `GeneratedChunkStoreLayer`.
 * That has NOT happened yet: it is a flagged follow-up rather than done here.
 * Until then this remains a second implementation to maintain, typed against
 * mc-worldgen's real `ChunkStoreApi` directly rather than against a mirror.
 *
 * ---------------------------------------------------------------------------
 * THE THREE SEMANTICS A RULE CAN GET WRONG
 * ---------------------------------------------------------------------------
 *
 * Carried over from the double, which got them right and states the sources
 * (`mc-worldgen/docs/public-api.md` §6-3, §6-4):
 *
 *   - an unloaded chunk reads `ChunkNotLoaded`, NEVER air. Sand at the edge of
 *     the loaded area, told the cell below is air, falls out of the world.
 *   - writing the block that is already there is `Unchanged` and does NOT
 *     dirty. Otherwise a fluid re-asserting its level remeshes the chunk every
 *     tick forever.
 *   - each subscriber accumulates a SET, so N writes to one chunk drain once.
 */
import { Effect, Layer, Ref } from 'effect'
import {
  AIR_BLOCK_ID,
  blockPosition,
  chunkCoord,
  type BlockId,
  type BlockPosition,
  type ChunkCoord,
} from '@nerima-games/mc-kernel'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  ChunkStore,
  blockIndex,
  type BlockReading,
  type BlockWriteOutcome,
  type Chunk,
  type ChunkDirtyBatch,
  type ChunkDirtySubscription,
  type ChunkNeighbours,
  type ChunkStoreApi,
  type LightReading,
  type SubscriberId,
} from '@nerima-games/mc-worldgen'

/** How bright a cell is. Absent means dark, which is the honest default. */
export type CellLight = {
  readonly sky: number
  readonly block: number
}

/** `x,y,z`. The sparse map's key. */
export const cellKey = (position: BlockPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

/** `cx,cz`. The loaded set's key. */
export const chunkKey = (coord: ChunkCoord): string => `${String(coord.cx)},${String(coord.cz)}`

/** Which chunk a cell is in. Floor division, so negative coordinates work. */
export const chunkOf = (position: BlockPosition): ChunkCoord =>
  chunkCoord(Math.floor(position.x / CHUNK_SIZE_XZ), Math.floor(position.z / CHUNK_SIZE_XZ))

const parseChunkKey = (key: string): ChunkCoord => {
  const [cx, cz] = key.split(',')
  return chunkCoord(Number(cx), Number(cz))
}

/** Is this cell inside the world's vertical extent? */
export const isInWorld = (position: BlockPosition): boolean =>
  Number.isInteger(position.y) && position.y >= 0 && position.y < CHUNK_HEIGHT

/** What a world is handed to this store as. */
export type WorldContents = {
  /** Cell -> block. Anything absent inside a loaded chunk is air. */
  readonly blocks: ReadonlyMap<string, BlockId>
  /** Which chunks are resident. A cell outside these reads `ChunkNotLoaded`. */
  readonly loaded: Iterable<string>
  /** Optional per-cell light. Absent is dark. */
  readonly lights?: ReadonlyMap<string, CellLight>
}

/** An empty, fully unloaded world. */
export const EMPTY_WORLD: WorldContents = { blocks: new Map(), loaded: [] }

type State = {
  readonly blocks: Map<string, BlockId>
  readonly lights: Map<string, CellLight>
  readonly loaded: Set<string>
  readonly subscribers: Map<number, Set<string>>
  nextSubscriber: number
}

/**
 * Build a store over the given world.
 *
 * The world is COPIED at construction. A caller that kept its own map and
 * mutated it would be a second writer of the same state, and every read here
 * would race it — the exact hazard `@nerima-games/mc-worldgen`'s `setBlock`
 * contract exists to make single-threaded.
 */
export const makeInMemoryChunkStore = (
  contents: WorldContents = EMPTY_WORLD,
): Effect.Effect<ChunkStoreApi> =>
  Effect.map(
    Ref.make<State>({
      blocks: new Map(contents.blocks),
      lights: new Map(contents.lights ?? new Map()),
      loaded: new Set(contents.loaded),
      subscribers: new Map(),
      nextSubscriber: 0,
    }),
    (state): ChunkStoreApi => {
      const markDirty = (current: State, coord: ChunkCoord): void => {
        for (const pending of current.subscribers.values()) {
          pending.add(chunkKey(coord))
        }
      }

      /**
       * Build the `Uint8Array` mc-worldgen would hand back.
       *
       * MATERIALISED FROM THE SPARSE MAP rather than stored as a buffer, so the
       * map stays the single source of truth and a cell written through
       * `setBlock` is visible to the next read with no bookkeeping to get
       * wrong. It allocates 65,536 bytes per call, which is the wrong shape for
       * a hot path and the right shape for a store whose world fits in a Map.
       */
      const materialise = (current: State, coord: ChunkCoord): Chunk => {
        const blocks = new Uint8Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT)
        for (const [cell, block] of current.blocks) {
          const [x, y, z] = cell.split(',').map(Number)
          if (x === undefined || y === undefined || z === undefined) continue
          if (Math.floor(x / CHUNK_SIZE_XZ) !== coord.cx) continue
          if (Math.floor(z / CHUNK_SIZE_XZ) !== coord.cz) continue
          if (y < 0 || y >= CHUNK_HEIGHT) continue

          const lx = ((x % CHUNK_SIZE_XZ) + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
          const lz = ((z % CHUNK_SIZE_XZ) + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
          blocks[blockIndex(lx, y, lz)] = block
        }
        return { coord, blocks, biomes: [] }
      }

      const peekChunk = (current: State, coord: ChunkCoord): Chunk | undefined =>
        current.loaded.has(chunkKey(coord)) ? materialise(current, coord) : undefined

      const subscribe: Effect.Effect<ChunkDirtySubscription> = Ref.modify(state, (current) => {
        const id = current.nextSubscriber
        current.subscribers.set(id, new Set())

        const subscription: ChunkDirtySubscription = {
          // `@nerima-games/mc-worldgen` exports no public constructor for
          // `SubscriberId` — it is minted only inside the package's own
          // `ChunkStoreState.subscribed`, which this file, as an independent
          // reimplementation of `ChunkStoreApi`, has no way to call. This
          // counter-derived id is a genuine, never-reused subscriber
          // identity by construction; the cast asserts only that, not that
          // an unchecked value has an unverified shape.
          id: id as SubscriberId,
          drain: Ref.modify(state, (now) => {
            const pending = now.subscribers.get(id) ?? new Set<string>()
            const batch: ChunkDirtyBatch = {
              changed: [...pending].map(parseChunkKey),
              removed: [],
            }
            now.subscribers.set(id, new Set())
            return [batch, now] as const
          }),
          unsubscribe: Ref.update(state, (now) => {
            now.subscribers.delete(id)
            return now
          }),
        }

        return [subscription, { ...current, nextSubscriber: id + 1 }] as const
      })

      return {
        /**
         * Make a chunk resident and hand it back.
         *
         * AN UNKNOWN CHUNK BECOMES EMPTY RATHER THAN GENERATED. Generating is
         * mc-worldgen's and is the part this file does not claim; answering
         * with terrain invented here would be the thing the header refuses.
         */
        load: (coord) =>
          Ref.modify(state, (current) => {
            current.loaded.add(chunkKey(coord))
            return [materialise(current, coord), current] as const
          }),

        peek: (coord) => Effect.map(Ref.get(state), (current) => peekChunk(current, coord)),

        /**
         * The same as `peek` here, and that is a property of this store rather
         * than of the interface: mc-worldgen distinguishes a live view from a
         * point-in-time copy because its chunks are mutable buffers. Every
         * chunk this file hands out is already freshly materialised, so both
         * answers are copies and neither can alias the world.
         */
        snapshot: (coord) => Effect.map(Ref.get(state), (current) => peekChunk(current, coord)),

        isLoaded: (coord) =>
          Effect.map(Ref.get(state), (current) => current.loaded.has(chunkKey(coord))),

        loadedCoords: Effect.map(Ref.get(state), (current) =>
          [...current.loaded].map(parseChunkKey),
        ),

        /**
         * The four side neighbours, each `undefined` if not resident.
         *
         * FOUR AND NOT SIX: there is no vertical chunking — `CHUNK_HEIGHT` is
         * the whole column — so a `yPos` neighbour would be a chunk that cannot
         * exist. `ChunkNeighbours` in the mirror names exactly these four.
         */
        neighbours: (coord) =>
          Effect.map(Ref.get(state), (current): ChunkNeighbours => {
            // ABSENT KEYS, NOT `undefined` VALUES. `tsconfig.base.json` sets
            // `exactOptionalPropertyTypes`, so `{ xPos: undefined }` is NOT a
            // `{ xPos?: Chunk }` — and the distinction is real here
            // rather than pedantic: a consumer doing `'xPos' in neighbours`
            // would see a neighbour that is not there.
            const sides = [
              ['xPos', chunkCoord(coord.cx + 1, coord.cz)],
              ['xNeg', chunkCoord(coord.cx - 1, coord.cz)],
              ['zPos', chunkCoord(coord.cx, coord.cz + 1)],
              ['zNeg', chunkCoord(coord.cx, coord.cz - 1)],
            ] as const

            const neighbours: { -readonly [K in keyof ChunkNeighbours]: ChunkNeighbours[K] } = {}
            for (const [side, at] of sides) {
              const chunk = peekChunk(current, at)
              if (chunk !== undefined) {
                neighbours[side] = chunk
              }
            }
            return neighbours
          }),

        /**
         * Drop a chunk, and its cells with it.
         *
         * THE CELLS GO TOO. Leaving them behind would make a reloaded chunk
         * resurrect blocks the world no longer contains — and, worse, would let
         * `loadedCoords` and the block map disagree about what exists.
         *
         * Returns whether anything was actually unloaded, which is the
         * interface's contract and lets a caller tell "I dropped it" from "it
         * was never here".
         */
        unload: (coord) =>
          Ref.modify(state, (current) => {
            const key = chunkKey(coord)
            const wasLoaded = current.loaded.delete(key)
            if (wasLoaded) {
              // Deleting from a `Map` while iterating its keys is well-defined:
              // an entry removed before the iterator reaches it is skipped, and
              // the current one is already past. No copy is needed, and oxlint
              // says so.
              for (const cell of current.blocks.keys()) {
                const [x, , z] = cell.split(',').map(Number)
                if (x === undefined || z === undefined) continue
                if (chunkKey(chunkOf(blockPosition(x, 0, z))) === key) {
                  current.blocks.delete(cell)
                  current.lights.delete(cell)
                }
              }
            }
            return [wasLoaded, current] as const
          }),

        getBlock: (position) =>
          Effect.map(Ref.get(state), (current): BlockReading => {
            if (!isInWorld(position)) {
              return { _tag: 'OutOfWorld' }
            }
            if (!current.loaded.has(chunkKey(chunkOf(position)))) {
              // NEVER air. See the header.
              return { _tag: 'ChunkNotLoaded' }
            }
            return { _tag: 'Block', block: current.blocks.get(cellKey(position)) ?? AIR_BLOCK_ID }
          }),

        setBlock: (position, block) =>
          Ref.modify(state, (current): readonly [BlockWriteOutcome, State] => {
            if (!isInWorld(position)) {
              return [{ _tag: 'OutOfWorld' }, current] as const
            }
            const coord = chunkOf(position)
            if (!current.loaded.has(chunkKey(coord))) {
              return [{ _tag: 'ChunkNotLoaded' }, current] as const
            }

            const key = cellKey(position)
            const previous = current.blocks.get(key) ?? AIR_BLOCK_ID
            if (previous === block) {
              // Unchanged does NOT dirty. See the header.
              return [{ _tag: 'Unchanged', previous }, current] as const
            }

            if (block === AIR_BLOCK_ID) {
              current.blocks.delete(key)
            } else {
              current.blocks.set(key, block)
            }
            markDirty(current, coord)
            return [{ _tag: 'Written', previous, chunk: coord }, current] as const
          }),

        getLight: (position) =>
          Effect.map(Ref.get(state), (current): LightReading => {
            if (!isInWorld(position)) {
              return { _tag: 'OutOfWorld' }
            }
            if (!current.loaded.has(chunkKey(chunkOf(position)))) {
              return { _tag: 'ChunkNotLoaded' }
            }
            const light = current.lights.get(cellKey(position))
            // Absent is DARK and not unknown: the chunk is resident, so the
            // answer is known and it is zero. `ChunkNotLoaded` above is the
            // only "I do not know", which is what `hostile-spawn.ts` relies on.
            return { _tag: 'Light', sky: light?.sky ?? 0, block: light?.block ?? 0 }
          }),

        subscribeDirty: subscribe,

        subscribeDirtyScoped: Effect.flatMap(subscribe, (subscription) =>
          Effect.as(
            Effect.addFinalizer(() => subscription.unsubscribe),
            subscription,
          ),
        ),

        reset: Ref.update(state, (current) => {
          current.blocks.clear()
          current.lights.clear()
          current.loaded.clear()
          for (const pending of current.subscribers.values()) {
            pending.clear()
          }
          return current
        }),
      }
    },
  )

/** The store as a Layer, for a host that composes `gameplayModule`. */
export const InMemoryChunkStoreLayer = (
  contents: WorldContents = EMPTY_WORLD,
): Layer.Layer<ChunkStore> => Layer.effect(ChunkStore, makeInMemoryChunkStore(contents))
