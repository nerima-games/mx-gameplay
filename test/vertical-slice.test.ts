/**
 * THE SLICE, from the rule's side: break a block, the sand above it falls, and
 * the item goes somewhere.
 *
 * ---------------------------------------------------------------------------
 * What is real here and what is a stand-in
 * ---------------------------------------------------------------------------
 *
 * REAL: `domain/falling-block.ts` — `disturb`, `takeBatch`, `settled` and
 * `FALLING_BLOCK_MOVES_PER_TICK`. This file drives the shipped queue, not a
 * simplification of it, which is the point: the question the vertical-slice
 * spike left open was whether mx-gameplay's event-driven queue and a chunk
 * store in another repository actually compose, and the only way to answer it
 * is to run them against each other.
 *
 * A STAND-IN: the store itself. `makeTestChunkStore` below is a test double for
 * mc-worldgen's `ChunkStore`, built against this repository's mirror of that
 * service (`domain/chunk-store-port.ts`). It has to be: nothing is published
 * (plan.md §6 Step 3), so mx-gameplay cannot import the real implementation
 * today. The mirror is what makes the double meaningful — it is typed by the
 * interface mc-worldgen actually publishes, and `test/chunk-store-mirror.test.ts`
 * pins the mirror against that interface. The same scenario against the REAL
 * store is `mc-worldgen/test/vertical-slice.test.ts`; between the two files the
 * whole path is covered, and when mc-worldgen is published this double is
 * deleted and the real Layer takes its place.
 *
 * ---------------------------------------------------------------------------
 * The two properties this file exists to protect
 * ---------------------------------------------------------------------------
 *
 *  1. **Work enters only through the dirty channel.** There is no "scan the
 *     world" call anywhere. The reference implementation rescanned every loaded
 *     chunk every maintenance tick — ~7M block reads, ~40% of the main thread
 *     while exploring (`falling-block-maintenance.ts:9-15`) — and the API here
 *     is shaped so that mistake cannot be re-made by accident.
 *
 *  2. **The rule never names a block.** It reads a byte out of the store and
 *     asks the capability table. Running the identical rule over gravel, with
 *     no code change, is asserted below.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import {
  AIR_BLOCK_ID,
  ChunkStore,
  fallsWhenUnsupported,
  isReplaceable,
  type BlockId,
  type BlockPosition,
  type BlockWriteOutcome,
  type ChunkDirtyBatch,
  type ChunkDirtySubscription,
  type ChunkStoreApi,
} from '../domain/chunk-store-port'
import {
  disturb,
  emptyFallingBlockQueue,
  settled,
  takeBatch,
  type FallingBlockQueue,
} from '../domain/falling-block'
import type { PositionKey } from '../domain/position-key'

// ---------------------------------------------------------------------------
// The test double
// ---------------------------------------------------------------------------

const SAND: BlockId = 5
const GRAVEL: BlockId = 8
const STONE: BlockId = 2

const key = (position: BlockPosition): string => `${position.x},${position.y},${position.z}`

const chunkKey = (position: BlockPosition): string =>
  `${Math.floor(position.x / 16)},${Math.floor(position.z / 16)}`

const chunkCoordOf = (position: BlockPosition) => ({
  cx: Math.floor(position.x / 16),
  cz: Math.floor(position.z / 16),
})

type Doubles = {
  readonly blocks: Map<string, BlockId>
  readonly loadedChunks: Set<string>
  readonly subscribers: Map<number, Set<string>>
  nextSubscriber: number
}

/**
 * A sparse stand-in with mc-worldgen's semantics, and in particular its three
 * that a rule can get wrong:
 *
 *   - an unloaded chunk reads `ChunkNotLoaded`, never air;
 *   - writing the same block back is `Unchanged` and does not dirty;
 *   - each subscriber accumulates a SET, so N writes to one chunk drain once.
 */
const makeTestChunkStore = (
  initial: ReadonlyMap<string, BlockId>,
  loaded: ReadonlyArray<string>,
): Effect.Effect<ChunkStoreApi> =>
  Effect.map(
    Ref.make<Doubles>({
      blocks: new Map(initial),
      loadedChunks: new Set(loaded),
      subscribers: new Map(),
      nextSubscriber: 0,
    }),
    (state) => {
      const notImplemented = Effect.dieMessage('not exercised by this test')

      const markDirty = (doubles: Doubles, position: BlockPosition): void => {
        for (const pending of doubles.subscribers.values()) {
          pending.add(chunkKey(position))
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

      return {
        load: () => notImplemented,
        peek: () => notImplemented,
        snapshot: () => notImplemented,
        isLoaded: (coord) =>
          Effect.map(Ref.get(state), (doubles) => doubles.loadedChunks.has(`${coord.cx},${coord.cz}`)),
        loadedCoords: notImplemented,
        neighbours: () => notImplemented,
        unload: () => notImplemented,

        getBlock: (position) =>
          Effect.map(Ref.get(state), (doubles) => {
            if (position.y < 0 || position.y >= 256) {
              return { _tag: 'OutOfWorld' } as const
            }
            if (!doubles.loadedChunks.has(chunkKey(position))) {
              return { _tag: 'ChunkNotLoaded' } as const
            }
            return { _tag: 'Block', block: doubles.blocks.get(key(position)) ?? AIR_BLOCK_ID } as const
          }),

        setBlock: (position, block) =>
          Ref.modify(state, (doubles): readonly [BlockWriteOutcome, Doubles] => {
            if (position.y < 0 || position.y >= 256) {
              return [{ _tag: 'OutOfWorld' } as const, doubles] as const
            }
            if (!doubles.loadedChunks.has(chunkKey(position))) {
              return [{ _tag: 'ChunkNotLoaded' } as const, doubles] as const
            }

            const previous = doubles.blocks.get(key(position)) ?? AIR_BLOCK_ID
            if (previous === block) {
              return [{ _tag: 'Unchanged', previous } as const, doubles] as const
            }

            doubles.blocks.set(key(position), block)
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
    },
  )

const testStoreLayer = (
  initial: ReadonlyMap<string, BlockId>,
  loaded: ReadonlyArray<string>,
): Layer.Layer<ChunkStore> => Layer.effect(ChunkStore, makeTestChunkStore(initial, loaded))

// ---------------------------------------------------------------------------
// The rule, written the way `gameplay:entities` will be written
// ---------------------------------------------------------------------------

const positionOfKey = (positionKey: PositionKey): BlockPosition => {
  const [x, y, z] = positionKey.split(',')
  return { x: Number(x), y: Number(y), z: Number(z) }
}

const positionKeyOf = (position: BlockPosition): PositionKey => key(position)

/**
 * One tick of the falling-block stage.
 *
 * Reads `takeBatch` off the shipped queue, evaluates only those positions, and
 * feeds destinations back with `settled` so the cascade continues next tick.
 * Cost is O(taken), never O(world) — an empty queue produces an empty batch and
 * this function then touches the store zero times.
 */
const fallingBlockStage = (
  store: ChunkStoreApi,
  queue: FallingBlockQueue,
): Effect.Effect<{ readonly queue: FallingBlockQueue; readonly moved: number }> =>
  Effect.gen(function* () {
    const { batch, rest } = takeBatch(queue)
    const destinations: Array<PositionKey> = []
    let moved = 0

    for (const positionKey of batch) {
      // Each disturbed position may have unsupported material ABOVE it — that
      // is what "disturbed" means: something under this column changed.
      const here = positionOfKey(positionKey)
      const above: BlockPosition = { x: here.x, y: here.y + 1, z: here.z }

      const reading = yield* store.getBlock(above)
      if (reading._tag !== 'Block' || !fallsWhenUnsupported(reading.block)) {
        continue
      }

      const under = yield* store.getBlock(here)
      // Not `_tag === 'Block' && block === AIR`: `ChunkNotLoaded` must not read
      // as air, or sand at the edge of the loaded area falls out of the world.
      if (under._tag !== 'Block' || !isReplaceable(under.block)) {
        continue
      }

      yield* store.setBlock(above, AIR_BLOCK_ID)
      yield* store.setBlock(here, reading.block)
      moved += 1

      // The cell it moved INTO must be re-examined next tick even though
      // nothing external re-dirties it, and so must the cell it came from,
      // because whatever was above THAT is now unsupported too.
      destinations.push(positionKeyOf({ x: here.x, y: here.y - 1, z: here.z }))
      destinations.push(positionKeyOf(above))
    }

    return { queue: settled(rest, destinations), moved }
  })

// ---------------------------------------------------------------------------

const world = (entries: ReadonlyArray<readonly [BlockPosition, BlockId]>): ReadonlyMap<string, BlockId> =>
  new Map(entries.map(([position, block]) => [key(position), block] as const))

describe('the slice: break a block, the sand above it falls', () => {
  const support: BlockPosition = { x: 2, y: 64, z: 3 }
  const sandAt: BlockPosition = { x: 2, y: 65, z: 3 }

  it.effect('runs end to end through the real FallingBlockQueue', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      const subscription = yield* store.subscribeDirty

      // ---- 1. the player breaks the support ---------------------------------
      const broken = yield* store.setBlock(support, AIR_BLOCK_ID)

      expect(broken).toStrictEqual({ _tag: 'Written', previous: STONE, chunk: { cx: 0, cz: 0 } })

      // The mined block travels to mc-sim's InventoryService from here. That is
      // plan.md §2.3-1's worked example — "掘ったらドロップする" is this
      // repository, the place the item ends up is mc-sim's — and it is
      // unaffected by the store living in mc-worldgen.
      const mined = broken._tag === 'Written' ? broken.previous : AIR_BLOCK_ID
      expect(mined).toBe(STONE)

      // ---- 2. the block is gone from the store ------------------------------
      expect(yield* store.getBlock(support)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })

      // ---- 3. the chunk is reported dirty -----------------------------------
      const batch = yield* subscription.drain
      expect(batch.changed).toStrictEqual([{ cx: 0, cz: 0 }])

      // ---- 4. the rule observes it ------------------------------------------
      // The interactions stage disturbs the position it wrote. This is the ONLY
      // entry point for work; there is no scan.
      const queued = disturb(emptyFallingBlockQueue, [positionKeyOf(support)])
      expect(queued.pending.size).toBe(1)

      const first = yield* fallingBlockStage(store, queued)
      expect(first.moved).toBe(1)

      expect(yield* store.getBlock(sandAt)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
      expect(yield* store.getBlock(support)).toStrictEqual({ _tag: 'Block', block: SAND })

      // ---- 5. and the cascade terminates by itself --------------------------
      const second = yield* fallingBlockStage(store, first.queue)
      expect(second.moved).toBe(0)

      const third = yield* fallingBlockStage(store, second.queue)
      expect(third.moved).toBe(0)
      expect(third.queue.pending.size).toBe(0)
    }).pipe(
      Effect.provide(
        testStoreLayer(
          world([
            [support, STONE],
            [sandAt, SAND],
            [{ x: 2, y: 63, z: 3 }, STONE],
          ]),
          ['0,0'],
        ),
      ),
    ),
  )

  it.effect('REGRESSION: an untouched world does no work, because work only enters through disturb', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      const subscription = yield* store.subscribeDirty

      // Nothing has happened. The queue is empty, so the stage never reaches
      // the store at all — not "scans and finds nothing".
      const outcome = yield* fallingBlockStage(store, emptyFallingBlockQueue)

      expect(outcome.moved).toBe(0)
      expect(outcome.queue.pending.size).toBe(0)
      expect(yield* subscription.drain).toStrictEqual({ changed: [], removed: [] })
    }).pipe(
      Effect.provide(
        testStoreLayer(
          world([
            [support, STONE],
            [sandAt, SAND],
          ]),
          ['0,0'],
        ),
      ),
    ),
  )

  it.effect('adding a falling block is a kernel table row, not a change here', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore

      yield* store.setBlock(support, AIR_BLOCK_ID)
      const outcome = yield* fallingBlockStage(store, disturb(emptyFallingBlockQueue, [positionKeyOf(support)]))

      // Identical rule, identical call, different block. The rule was never
      // told that gravel exists.
      expect(outcome.moved).toBe(1)
      expect(yield* store.getBlock(support)).toStrictEqual({ _tag: 'Block', block: GRAVEL })
    }).pipe(
      Effect.provide(
        testStoreLayer(
          world([
            [support, STONE],
            [sandAt, GRAVEL],
            [{ x: 2, y: 63, z: 3 }, STONE],
          ]),
          ['0,0'],
        ),
      ),
    ),
  )

  it.effect('REGRESSION: sand does not fall into an unloaded chunk', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore

      // The support is in a chunk that is not resident. A two-valued read that
      // answered AIR — which is what mc-meshing correctly answers for DRAWING —
      // would drop the sand out of the world here.
      const edge: BlockPosition = { x: -1, y: 64, z: 3 }
      expect(yield* store.getBlock(edge)).toStrictEqual({ _tag: 'ChunkNotLoaded' })

      const outcome = yield* fallingBlockStage(store, disturb(emptyFallingBlockQueue, [positionKeyOf(edge)]))
      expect(outcome.moved).toBe(0)
    }).pipe(Effect.provide(testStoreLayer(world([]), ['0,0']))),
  )

  it.effect('a moving column re-dirties one chunk once, however many blocks moved', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      const renderer = yield* store.subscribeDirty

      yield* store.setBlock(support, AIR_BLOCK_ID)
      yield* renderer.drain

      // Three sand blocks, so the tick performs six writes.
      let queue = disturb(emptyFallingBlockQueue, [positionKeyOf(support)])
      const outcome = yield* fallingBlockStage(store, queue)
      queue = outcome.queue

      expect(outcome.moved).toBeGreaterThan(0)

      // The renderer meshes the chunk once. A stream would have delivered one
      // message per write.
      const batch = yield* renderer.drain
      expect(batch.changed).toStrictEqual([{ cx: 0, cz: 0 }])
    }).pipe(
      Effect.provide(
        testStoreLayer(
          world([
            [support, STONE],
            [{ x: 2, y: 63, z: 3 }, STONE],
            [sandAt, SAND],
            [{ x: 2, y: 66, z: 3 }, SAND],
            [{ x: 2, y: 67, z: 3 }, SAND],
          ]),
          ['0,0'],
        ),
      ),
    ),
  )
})
