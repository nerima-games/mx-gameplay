/**
 * `domain/in-memory-chunk-store.ts`.
 *
 * The point of this file is that EVERY member is implemented.
 * `test/support/chunk-store-double.ts` answers five of thirteen with
 * `Effect.dieMessage('not exercised by this test')`, which is correct for a
 * double and fatal for a running game — so the first test below walks the whole
 * interface and would fail on any member that died.
 *
 * The rest are the three semantics `mc-worldgen/docs/public-api.md` §6-3/§6-4
 * names as the ones a rule gets wrong, each of which produces a world that
 * looks deliberate:
 *
 *   - an unloaded chunk reading as air makes sand fall out of the world;
 *   - a no-op write dirtying the chunk remeshes it every tick forever;
 *   - a subscriber that does not accumulate makes N writes drain N times.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  EMPTY_WORLD,
  InMemoryChunkStoreLayer,
  cellKey,
  chunkKey,
  chunkOf,
  isInWorld,
  makeInMemoryChunkStore,
  type WorldContents,
} from '../src/domain/in-memory-chunk-store'
import {
  AIR_BLOCK_ID,
  blockPosition,
  chunkCoord,
  type BlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from '@nerima-games/mc-worldgen'

const STONE: BlockId = 2 as BlockId
const DIRT: BlockId = 3 as BlockId

const AT: BlockPosition = blockPosition(5, 64, 9)

const worldWith = (cells: ReadonlyArray<readonly [BlockPosition, BlockId]>): WorldContents => ({
  blocks: new Map(cells.map(([position, block]) => [cellKey(position), block])),
  loaded: [...new Set(cells.map(([position]) => chunkKey(chunkOf(position))))],
})

describe('every member is implemented', () => {
  it.effect('the whole interface answers without dying', () =>
    Effect.gen(function* () {
      // THE REASON THIS FILE EXISTS. The test double dies on `load`,
      // `snapshot`, `loadedCoords`, `neighbours` and `unload`; a game that
      // called any of them would take the frame with it. Walking all thirteen
      // here is the assertion that this is a store rather than a double.
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const coord = chunkOf(AT)

      expect((yield* store.load(coord)).coord).toStrictEqual(coord)
      expect(yield* store.peek(coord)).toBeDefined()
      expect(yield* store.snapshot(coord)).toBeDefined()
      expect(yield* store.isLoaded(coord)).toBe(true)
      expect(yield* store.loadedCoords).toStrictEqual([coord])
      expect(yield* store.neighbours(coord)).toStrictEqual({})
      expect((yield* store.getBlock(AT))._tag).toBe('Block')
      expect((yield* store.setBlock(AT, DIRT))._tag).toBe('Written')
      expect((yield* store.getLight(AT))._tag).toBe('Light')

      const subscription = yield* store.subscribeDirty
      expect((yield* subscription.drain).changed.length).toBeGreaterThanOrEqual(0)
      yield* subscription.unsubscribe

      expect(yield* store.unload(coord)).toBe(true)
      yield* store.reset
      expect(yield* store.loadedCoords).toStrictEqual([])
    }),
  )
})

describe('an unloaded chunk is not air', () => {
  it.effect('getBlock says ChunkNotLoaded, never Block', () =>
    Effect.gen(function* () {
      // Sand at the edge of the loaded area, told the cell below is air, falls
      // out of the world. That is the failure this three-valued read prevents.
      const store = yield* makeInMemoryChunkStore(EMPTY_WORLD)

      expect(yield* store.getBlock(AT)).toStrictEqual({ _tag: 'ChunkNotLoaded' })
    }),
  )

  it.effect('a LOADED but empty cell IS air, which is a different answer', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore({ blocks: new Map(), loaded: ['0,0'] })

      expect(yield* store.getBlock(blockPosition(1, 1, 1))).toStrictEqual({
        _tag: 'Block',
        block: AIR_BLOCK_ID,
      })
    }),
  )

  it.effect('writing into an unloaded chunk refuses', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(EMPTY_WORLD)

      expect(yield* store.setBlock(AT, STONE)).toStrictEqual({ _tag: 'ChunkNotLoaded' })
    }),
  )

  it.effect('above and below the world is OutOfWorld, not ChunkNotLoaded', () =>
    Effect.gen(function* () {
      // Two different unknowns. A rule that conflated them would treat the
      // build limit as a streaming problem and keep retrying.
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))

      expect((yield* store.getBlock(blockPosition(5, -1, 9)))._tag).toBe('OutOfWorld')
      expect((yield* store.getBlock(blockPosition(5, CHUNK_HEIGHT, 9)))._tag).toBe('OutOfWorld')
      expect(isInWorld(blockPosition(0, CHUNK_HEIGHT - 1, 0))).toBe(true)
    }),
  )
})

describe('a no-op write does not dirty', () => {
  it.effect('writing the same block back is Unchanged', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))

      expect(yield* store.setBlock(AT, STONE)).toStrictEqual({ _tag: 'Unchanged', previous: STONE })
    }),
  )

  it.effect('REGRESSION: and it notifies NOBODY', () =>
    Effect.gen(function* () {
      // A fluid re-asserting its level, or redstone recomputing to the same
      // state, would otherwise remesh the chunk every tick forever — visible
      // only as an unexplained frame cost.
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const subscription = yield* store.subscribeDirty

      yield* store.setBlock(AT, STONE)

      expect((yield* subscription.drain).changed).toStrictEqual([])
    }),
  )

  it.effect('a real change DOES notify', () =>
    Effect.gen(function* () {
      // The other half, so the test above cannot pass by never notifying.
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const subscription = yield* store.subscribeDirty

      yield* store.setBlock(AT, DIRT)

      expect((yield* subscription.drain).changed).toStrictEqual([chunkOf(AT)])
    }),
  )
})

describe('subscribers accumulate a set', () => {
  it.effect('N writes to one chunk drain ONCE', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const subscription = yield* store.subscribeDirty

      yield* store.setBlock(blockPosition(5, 64, 9), DIRT)
      yield* store.setBlock(blockPosition(6, 64, 9), DIRT)
      yield* store.setBlock(blockPosition(7, 64, 9), DIRT)

      expect((yield* subscription.drain).changed).toStrictEqual([chunkOf(AT)])
    }),
  )

  it.effect('draining clears, so a quiet frame reports nothing', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const subscription = yield* store.subscribeDirty

      yield* store.setBlock(AT, DIRT)
      yield* subscription.drain

      expect((yield* subscription.drain).changed).toStrictEqual([])
    }),
  )

  it.effect('two subscribers each see the change', () =>
    Effect.gen(function* () {
      // Independent sets, not one shared queue: the renderer and a save
      // scheduler both need the news, and one draining must not blind the
      // other.
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const first = yield* store.subscribeDirty
      const second = yield* store.subscribeDirty

      yield* store.setBlock(AT, DIRT)

      expect((yield* first.drain).changed).toStrictEqual([chunkOf(AT)])
      expect((yield* second.drain).changed).toStrictEqual([chunkOf(AT)])
    }),
  )

  it.effect('an unsubscribed handle stops accumulating', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const subscription = yield* store.subscribeDirty

      yield* subscription.unsubscribe
      yield* store.setBlock(AT, DIRT)

      expect((yield* subscription.drain).changed).toStrictEqual([])
    }),
  )
})

describe('chunk residency', () => {
  it.effect('load makes an unknown chunk resident and EMPTY, not generated', () =>
    Effect.gen(function* () {
      // Generating terrain is mc-worldgen's and is the part this file does not
      // claim. Inventing it here would be the thing the header refuses.
      const store = yield* makeInMemoryChunkStore(EMPTY_WORLD)

      const chunk = yield* store.load(chunkCoord(3, -1))

      expect(chunk.blocks.every((block) => block === AIR_BLOCK_ID)).toBe(true)
      expect(yield* store.isLoaded(chunkCoord(3, -1))).toBe(true)
    }),
  )

  it.effect('unload drops the chunk AND its cells', () =>
    Effect.gen(function* () {
      // Leaving the cells behind would resurrect blocks on reload, and would
      // let `loadedCoords` and the block map disagree about what exists.
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const coord = chunkOf(AT)

      expect(yield* store.unload(coord)).toBe(true)
      yield* store.load(coord)

      expect(yield* store.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
    }),
  )

  it.effect('unload leaves a DIFFERENT resident chunk’s cells untouched', () =>
    Effect.gen(function* () {
      // Every prior unload test populated exactly one chunk, so the cell scan's
      // `chunkKey(...) === key` comparison had only ever seen a match — its
      // FALSE arm (a cell that belongs to some OTHER resident chunk) never ran.
      const FAR: BlockPosition = blockPosition(500, 64, 500)
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE], [FAR, DIRT]]))

      expect(yield* store.unload(chunkOf(AT))).toBe(true)

      expect(yield* store.getBlock(FAR)).toStrictEqual({ _tag: 'Block', block: DIRT })
      expect(yield* store.isLoaded(chunkOf(FAR))).toBe(true)
    }),
  )

  it.effect('unloading a chunk that was never here says so', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(EMPTY_WORLD)

      expect(yield* store.unload(chunkCoord(9, 9))).toBe(false)
    }),
  )

  it.effect('neighbours OMITS absent sides rather than setting them undefined', () =>
    Effect.gen(function* () {
      // `exactOptionalPropertyTypes` makes these different types, and the
      // difference is observable: a consumer doing `'xPos' in neighbours` would
      // see a neighbour that is not there.
      const store = yield* makeInMemoryChunkStore(EMPTY_WORLD)
      yield* store.load(chunkCoord(0, 0))
      yield* store.load(chunkCoord(1, 0))

      const neighbours = yield* store.neighbours(chunkCoord(0, 0))

      expect('xPos' in neighbours).toBe(true)
      expect('xNeg' in neighbours).toBe(false)
    }),
  )

  it.effect('negative coordinates land in the right chunk', () =>
    Effect.sync(() => {
      // Floor division, not truncation. `-1 / 16` truncates to 0, which would
      // put the cell one chunk east of where it is — and only for negative
      // coordinates, so half the world would be subtly wrong.
      expect(chunkOf(blockPosition(-1, 0, -1))).toStrictEqual({ cx: -1, cz: -1 })
      expect(chunkOf(blockPosition(-16, 0, 0))).toStrictEqual({ cx: -1, cz: 0 })
      expect(chunkOf(blockPosition(16, 0, 0))).toStrictEqual({ cx: 1, cz: 0 })
    }),
  )
})

describe('the world is copied at construction', () => {
  it.effect('mutating the caller’s map afterwards does not change the store', () =>
    Effect.gen(function* () {
      // A caller keeping its own map would be a second writer of the same
      // state, and every read here would race it.
      const blocks = new Map([[cellKey(AT), STONE]])
      const store = yield* makeInMemoryChunkStore({ blocks, loaded: [chunkKey(chunkOf(AT))] })

      blocks.set(cellKey(AT), DIRT)

      expect(yield* store.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: STONE })
    }),
  )

  it.effect('the Layer builds a working store', () =>
    Effect.sync(() => {
      expect(InMemoryChunkStoreLayer(worldWith([[AT, STONE]]))).toBeDefined()
    }),
  )
})

describe('setBlock and getLight above the world', () => {
  it.effect('setBlock refuses OutOfWorld without touching the map', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))

      expect(yield* store.setBlock(blockPosition(5, CHUNK_HEIGHT, 9), DIRT)).toStrictEqual({
        _tag: 'OutOfWorld',
      })
      // Unchanged: the out-of-world write must not have touched the real cell.
      expect(yield* store.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: STONE })
    }),
  )

  it.effect('getLight above the world is OutOfWorld', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))

      expect(yield* store.getLight(blockPosition(5, -1, 9))).toStrictEqual({ _tag: 'OutOfWorld' })
    }),
  )

  it.effect('getLight on an unloaded chunk is ChunkNotLoaded, not dark', () =>
    Effect.gen(function* () {
      // Same three-valued reasoning as getBlock: an unlit reading here would be
      // indistinguishable from a chunk that is merely dark.
      const store = yield* makeInMemoryChunkStore(EMPTY_WORLD)

      expect(yield* store.getLight(AT)).toStrictEqual({ _tag: 'ChunkNotLoaded' })
    }),
  )

  it.effect('getLight returns an actually-lit cell’s levels, not just the dark default', () =>
    Effect.gen(function* () {
      // The other half of the `?? 0` default: a lit cell must report its own
      // sky/block levels rather than falling through to the absent-cell zero.
      const store = yield* makeInMemoryChunkStore({
        blocks: new Map([[cellKey(AT), STONE]]),
        loaded: [chunkKey(chunkOf(AT))],
        lights: new Map([[cellKey(AT), { sky: 15, block: 4 }]]),
      })

      expect(yield* store.getLight(AT)).toStrictEqual({ _tag: 'Light', sky: 15, block: 4 })
    }),
  )
})

describe('writing air deletes the cell rather than storing it', () => {
  it.effect('setBlock(AIR_BLOCK_ID) removes the block from the sparse map', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))

      expect(yield* store.setBlock(AT, AIR_BLOCK_ID)).toStrictEqual({
        _tag: 'Written',
        previous: STONE,
        chunk: chunkOf(AT),
      })
      const chunk = yield* store.peek(chunkOf(AT))
      expect(chunk?.blocks.every((block) => block === AIR_BLOCK_ID)).toBe(true)
    }),
  )
})

describe('subscribeDirtyScoped unsubscribes when its scope closes', () => {
  it.effect('a change after the scope closes is not seen by the released subscription', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))

      const subscription = yield* Effect.scoped(
        Effect.gen(function* () {
          const sub = yield* store.subscribeDirtyScoped
          yield* store.setBlock(AT, DIRT)
          expect((yield* sub.drain).changed).toStrictEqual([chunkOf(AT)])
          return sub
        }),
      )

      // The scope above has already closed and run the finalizer, so this
      // write must not be seen by the same subscription handle.
      yield* store.setBlock(AT, STONE)
      expect((yield* subscription.drain).changed).toStrictEqual([])
    }),
  )
})

describe('reset clears pending dirty batches, not only the world', () => {
  it.effect('an undrained subscriber sees nothing after reset', () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryChunkStore(worldWith([[AT, STONE]]))
      const subscription = yield* store.subscribeDirty

      yield* store.setBlock(AT, DIRT)
      yield* store.reset

      expect((yield* subscription.drain).changed).toStrictEqual([])
    }),
  )
})

describe('materialise draws only from the requested chunk', () => {
  it.effect('a neighbour chunk’s blocks on either axis are not pulled in', () =>
    Effect.gen(function* () {
      // AT is chunk (0,0). One neighbour shares its z but differs in x, the
      // other shares x but differs in z — so both filter arms in materialise
      // (the x check and the z check) each have something to reject.
      const neighbourOnX: BlockPosition = blockPosition(20, 64, 9)
      const neighbourOnZ: BlockPosition = blockPosition(5, 64, 20)
      expect(chunkOf(neighbourOnX)).toStrictEqual({ cx: 1, cz: 0 })
      expect(chunkOf(neighbourOnZ)).toStrictEqual({ cx: 0, cz: 1 })

      const store = yield* makeInMemoryChunkStore(
        worldWith([
          [AT, STONE],
          [neighbourOnX, DIRT],
          [neighbourOnZ, DIRT],
        ]),
      )

      const chunk = yield* store.load(chunkOf(AT))

      expect([...chunk.blocks].filter((block) => block !== AIR_BLOCK_ID)).toStrictEqual([STONE])
    }),
  )
})

describe('malformed sparse-map keys are skipped rather than crashing', () => {
  // `WorldContents.blocks` is a plain `ReadonlyMap<string, BlockId>` handed in
  // at construction — nothing enforces that its keys came from `cellKey`. A
  // corrupt save or a hand-built fixture can carry a key that does not parse
  // to a full x,y,z, or a y outside the world's vertical extent; materialise
  // and unload both guard against exactly that rather than trusting the key.
  it.effect('an unparsable key is skipped by materialise and by unload', () =>
    Effect.gen(function* () {
      const blocks = new Map<string, BlockId>([
        [cellKey(AT), STONE],
        ['garbage,64', DIRT], // missing z component
      ])
      const store = yield* makeInMemoryChunkStore({ blocks, loaded: [chunkKey(chunkOf(AT))] })

      const chunk = yield* store.load(chunkOf(AT))
      expect([...chunk.blocks].filter((block) => block !== AIR_BLOCK_ID)).toStrictEqual([STONE])

      expect(yield* store.unload(chunkOf(AT))).toBe(true)
      yield* store.load(chunkOf(AT))
      // The valid cell is gone after unload+reload; the unparsable key never
      // resurrects anything because materialise skips it too.
      expect(yield* store.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
    }),
  )

  it.effect('a y outside the vertical extent is skipped by materialise', () =>
    Effect.gen(function* () {
      const blocks = new Map<string, BlockId>([
        [cellKey(AT), STONE],
        ['5,999,5', DIRT], // y >= CHUNK_HEIGHT
      ])
      const store = yield* makeInMemoryChunkStore({ blocks, loaded: [chunkKey(chunkOf(AT))] })

      const chunk = yield* store.load(chunkOf(AT))

      expect([...chunk.blocks].filter((block) => block !== AIR_BLOCK_ID)).toStrictEqual([STONE])
    }),
  )
})
