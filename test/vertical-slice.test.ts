/**
 * THE SLICE, end to end: the player breaks a block in `gameplay:interactions`,
 * the sand above it falls in `gameplay:entities` on a later tick, and the mined
 * block goes to the inventory.
 *
 * ---------------------------------------------------------------------------
 * What is real here and what is a stand-in
 * ---------------------------------------------------------------------------
 *
 * REAL: everything on this repository's side of the line. The scenarios below
 * run the SHIPPED stage registrations — `gameplayStages` / `makeGameplayStages`
 * — over the shipped rules (`domain/interactions/break-block.ts`,
 * `domain/entities/falling-block-move.ts`) and the shipped queue
 * (`domain/falling-block.ts`). Nothing here re-implements a rule in order to
 * test it. That distinction is the point of this file: the port and the loop
 * were each proven separately before, and separately proven halves do not
 * compose by themselves.
 *
 * A STAND-IN: the store, `test/support/chunk-store-double.ts`, and the frame
 * loop, `test/support/frame-runner.ts`. The first is typed by this
 * repository's mirror of mc-worldgen's `ChunkStore` and the mirror is pinned
 * against the real interface by `test/chunk-store-mirror.test.ts`; the second
 * resolves the `after` edges the way mc-compose will, rather than trusting the
 * array order. The same scenario against the REAL store is
 * `mc-worldgen/test/vertical-slice.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * The properties this file exists to protect
 * ---------------------------------------------------------------------------
 *
 *  1. **Work enters only through the rules that write blocks.** There is no
 *     "scan the world" call and no subscription to the dirty channel in any
 *     stage. The reference implementation rescanned every loaded chunk every
 *     maintenance tick — ~7M block reads, ~40% of the main thread while
 *     exploring (`falling-block-maintenance.ts:9-15`) — so an idle frame here
 *     is asserted to touch the store ZERO times, not merely to change nothing.
 *
 *  2. **`ChunkNotLoaded` is not air.** A two-valued read, which is what
 *     mc-meshing correctly uses for DRAWING, drops sand out of the world at the
 *     edge of the resident area.
 *
 *  3. **`Unchanged` does not dirty.** Breaking air must not enqueue work, must
 *     not put an item in the inventory and must not re-mesh a chunk.
 *
 *  4. **The rule never names a block.** It reads a byte out of the store and
 *     asks kernel's capability table. The identical stages are run over gravel
 *     below, with no code change anywhere.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { positionKeyOf } from '../domain/block-position-key'
import {
  AIR_BLOCK_ID,
  type BlockPosition,
  type BlockWriteOutcome,
  type ChunkStoreApi,
} from '../domain/chunk-store-port'
import { disturb } from '../domain/falling-block'
import { gameplayStages, makeGameplayFrameState } from '../stages/registration'
import {
  GRAVEL,
  makeChunkStoreDouble,
  SAND,
  STONE,
  world,
} from './support/chunk-store-double'
import { runFrame, runFrames } from './support/frame-runner'

// ---------------------------------------------------------------------------
// The column under test. Chunk (0, 0), which is the only resident one unless a
// scenario says otherwise.
// ---------------------------------------------------------------------------

const support: BlockPosition = { x: 2, y: 64, z: 3 }
const floor: BlockPosition = { x: 2, y: 63, z: 3 }
const sandAt: BlockPosition = { x: 2, y: 65, z: 3 }
const aboveSand: BlockPosition = { x: 2, y: 66, z: 3 }
const topOfColumn: BlockPosition = { x: 2, y: 67, z: 3 }

const slice = (
  initial: ReadonlyMap<string, number>,
  loaded: ReadonlyArray<string> = ['0,0'],
) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(initial, loaded)
    const state = yield* makeGameplayFrameState
    return { store, state, stages: gameplayStages(state, store.api) }
  })

const samePosition = (left: BlockPosition, right: BlockPosition): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

/** What mc-render's input stage will do, once mc-render is published. */
const requestBreak = (
  state: { readonly pendingBreaks: Ref.Ref<ReadonlyArray<string>> },
  position: BlockPosition,
): Effect.Effect<void> =>
  Ref.update(state.pendingBreaks, (pending) => [...pending, positionKeyOf(position)])

describe('the slice, through the stage registration', () => {
  it.effect('breaks a block in interactions and moves the sand in entities', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* slice(
        world([
          [floor, STONE],
          [support, STONE],
          [sandAt, SAND],
        ]),
      )
      // mc-render's chunk-sync stage will hold one of these. Nothing in
      // mx-gameplay subscribes: a chunk coordinate cannot tell a rule WHICH
      // cell moved, so a stage that worked from it would have to scan.
      const renderer = yield* store.api.subscribeDirty

      yield* requestBreak(state, support)
      yield* runFrame(stages)

      // ---- the block was mined, and the item went to the inventory ---------
      // `previous` came back from the write itself, so there was no
      // read-then-write race for it (mc-worldgen §6-3).
      expect(yield* Ref.get(state.minedItems)).toStrictEqual([STONE])

      // ---- and the sand above it moved down, in the same frame -------------
      expect(yield* store.blockAt(support)).toBe(SAND)
      expect(yield* store.blockAt(sandAt)).toBe(AIR_BLOCK_ID)

      // ---- the renderer is told about the chunk once -----------------------
      // Three writes (the break, the clear, the place), one coordinate.
      expect(yield* renderer.drain).toStrictEqual({ changed: [{ cx: 0, cz: 0 }], removed: [] })

      // ---- the inbox was consumed, not merely read -------------------------
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
    }),
  )

  it.effect('a multi-block cascade dirties the chunk once and then stops on its own', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* slice(
        world([
          [floor, STONE],
          [support, STONE],
          [sandAt, SAND],
          [aboveSand, SAND],
          [topOfColumn, SAND],
        ]),
      )
      const renderer = yield* store.api.subscribeDirty

      yield* requestBreak(state, support)
      // A column sinks one cell per tick (DN-GP-1), so three sand blocks need
      // three ticks plus one to discover there is nothing left to do.
      yield* runFrames(stages, 6)

      // ---- the whole column moved down exactly one cell --------------------
      expect(yield* store.blockAt(support)).toBe(SAND)
      expect(yield* store.blockAt(sandAt)).toBe(SAND)
      expect(yield* store.blockAt(aboveSand)).toBe(SAND)
      expect(yield* store.blockAt(topOfColumn)).toBe(AIR_BLOCK_ID)

      // ---- seven writes, ONE dirty coordinate ------------------------------
      // The break plus three moves of two writes each. A stream or a PubSub
      // would have delivered seven messages and re-meshed seven times; the
      // per-subscriber SET is what makes this one entry
      // (mc-worldgen §6-4, and the reason the channel is not a Stream).
      expect(yield* renderer.drain).toStrictEqual({ changed: [{ cx: 0, cz: 0 }], removed: [] })

      // ---- and the cascade terminated by itself ----------------------------
      // Nothing external stopped it: the queue drained because the last move
      // fed back destinations that turned out to be supported.
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)

      const before = yield* store.calls
      yield* runFrames(stages, 3)
      expect(yield* store.calls).toStrictEqual(before)
    }),
  )

  it.effect('REGRESSION: an idle frame does not touch the store at all (the O(chunks × blocks) scan is gone)', () =>
    Effect.gen(function* () {
      const { store, stages } = yield* slice(
        world([
          [floor, STONE],
          [support, STONE],
          [sandAt, SAND],
        ]),
      )
      const renderer = yield* store.api.subscribeDirty

      // Nobody broke anything. Every stage runs; none of them looks at a block.
      yield* runFrames(stages, 10)

      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0 })
      expect(yield* renderer.drain).toStrictEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('adding a falling block is a row in kernel’s table, not a change here', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* slice(
        world([
          [floor, STONE],
          [support, STONE],
          [sandAt, GRAVEL],
        ]),
      )

      yield* requestBreak(state, support)
      yield* runFrame(stages)

      // Identical stages, identical rules, different block. Neither file was
      // told that gravel exists — the reference implementation asked
      // `blockTypeToIndex('SAND')` in 229 places across 51 files (plan.md §3.1).
      expect(yield* store.blockAt(support)).toBe(GRAVEL)
      expect(yield* Ref.get(state.minedItems)).toStrictEqual([STONE])
    }),
  )

  it.effect('REGRESSION: `ChunkNotLoaded` is not air — sand does not fall out of the world', () =>
    Effect.gen(function* () {
      // Chunk (-1, 0) is not resident. Whatever is in it is UNKNOWN, and a rule
      // that read "air" there would clear a cell it cannot see and drop the
      // block into ungenerated space.
      const edge: BlockPosition = { x: -1, y: 64, z: 3 }
      const { store, state, stages } = yield* slice(world([[floor, STONE]]), ['0,0'])

      // Both entry points are exercised: a break request at the edge...
      yield* requestBreak(state, edge)
      // ...and a position that reached the queue some other way (an explosion
      // in a chunk that has since been unloaded, say).
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, [positionKeyOf(edge)]))
      yield* runFrames(stages, 3)

      const calls = yield* store.calls
      // The reads happened — that is how the rule LEARNED it must not act.
      expect(calls.reads).toBeGreaterThan(0)
      // The write is the break request, which the store refused; the rule added
      // nothing to it.
      expect(calls.writes).toBe(1)
      expect(yield* Ref.get(state.minedItems)).toStrictEqual([])
      expect(yield* store.blockAt(edge)).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: breaking air is `Unchanged` — no item, no dirty chunk, no falling-block work', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* slice(
        world([
          [floor, STONE],
          [support, STONE],
        ]),
      )
      const renderer = yield* store.api.subscribeDirty

      // The player is holding the mine button over empty sky. The store answers
      // `Unchanged` and does not dirty; treating that as a break would put air
      // in the inventory and re-mesh the chunk on every frame of the hold.
      yield* requestBreak(state, sandAt)
      yield* requestBreak(state, aboveSand)
      yield* runFrames(stages, 3)

      expect(yield* Ref.get(state.minedItems)).toStrictEqual([])
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)
      expect(yield* renderer.drain).toStrictEqual({ changed: [], removed: [] })
      expect(yield* store.blockAt(support)).toBe(STONE)

      // Two write attempts, both `Unchanged`, and NOT ONE READ. The reads are
      // the load-bearing number: they are zero only if the interactions stage
      // declined to enqueue falling-block work for a write that changed
      // nothing. Enqueueing it would cost a pair of reads per held frame
      // forever, which is the shape of the workload this design exists to
      // avoid.
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 2 })
    }),
  )

  /*
   * The two below drive the rule through a store that answers `ChunkNotLoaded`
   * for ONE cell.
   *
   * mc-worldgen's chunks are columns, so today a cell and the cell beneath it
   * are always in the same chunk and always agree about residency — which means
   * the scenarios here cannot be built out of the double's loaded-chunk set.
   * They are built by wrapping one method instead, because the PORT does not
   * promise the agreement: `getBlock` and `setBlock` are declared per position
   * (`mc-worldgen/docs/public-api.md` §6-3), and a sectioned chunk format, a
   * store that evicts under memory pressure, or a concurrent unload would each
   * make this reachable without changing a line of the interface.
   *
   * Both are pinned because the cost of being wrong is asymmetric: the failure
   * is not a crash but a block that ceases to exist, which no test that only
   * looks at the happy path can see.
   */
  it.effect('REGRESSION: a cell that reads `ChunkNotLoaded` does not receive a falling block', () =>
    Effect.gen(function* () {
      // The support is AIR, so without the wrapper below the sand falls into
      // it. The control is the very first test in this file.
      const { store, state } = yield* slice(world([[sandAt, SAND]]))

      const hidesTheDestination: ChunkStoreApi = {
        ...store.api,
        getBlock: (position) =>
          samePosition(position, support)
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
            : store.api.getBlock(position),
      }

      const stages = gameplayStages(state, hidesTheDestination)
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, [positionKeyOf(support)]))
      yield* runFrames(stages, 3)

      // Unknown is not empty: the sand stays where it is rather than being
      // written into a chunk nobody can see.
      expect(yield* store.blockAt(sandAt)).toBe(SAND)
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('REGRESSION: a refused destination write puts the block back rather than losing it', () =>
    Effect.gen(function* () {
      const { store, state } = yield* slice(world([[sandAt, SAND]]))

      // Reads say the move is legal; the destination write is refused anyway —
      // the window the source-first write order opens.
      const refusesTheDestination: ChunkStoreApi = {
        ...store.api,
        setBlock: (position, block) =>
          samePosition(position, support)
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
            : store.api.setBlock(position, block),
      }

      const stages = gameplayStages(state, refusesTheDestination)
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, [positionKeyOf(support)]))
      yield* runFrame(stages)

      // The sand is still sand. A rule that trusted its own read would have
      // cleared the source, had the write refused, and deleted the block.
      expect(yield* store.blockAt(sandAt)).toBe(SAND)
      expect(yield* store.blockAt(support)).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: a source write that did not vacate never places a second block below', () =>
    // The mirror image of the test above: this time the FIRST write is refused.
    // Placing the block below anyway would duplicate matter, which is the
    // failure mode the source-first order trades against losing it.
    Effect.forEach(
      [
        { _tag: 'Unchanged', previous: SAND },
        { _tag: 'ChunkNotLoaded' },
        { _tag: 'OutOfWorld' },
      ] as ReadonlyArray<BlockWriteOutcome>,
      (refusal) =>
        Effect.gen(function* () {
          const { store, state } = yield* slice(world([[sandAt, SAND]]))

          const refusesTheSource: ChunkStoreApi = {
            ...store.api,
            setBlock: (position, block) =>
              samePosition(position, sandAt)
                ? Effect.succeed(refusal)
                : store.api.setBlock(position, block),
          }

          const stages = gameplayStages(state, refusesTheSource)
          yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, [positionKeyOf(support)]))
          yield* runFrame(stages)

          expect(yield* store.blockAt(support)).toBeUndefined()
        }),
      { discard: true },
    ),
  )

  it.effect('REGRESSION: the floor of the world holds a block up — `OutOfWorld` is not a free cell', () =>
    Effect.gen(function* () {
      const bottom: BlockPosition = { x: 2, y: 0, z: 3 }
      const belowTheWorld: BlockPosition = { x: 2, y: -1, z: 3 }
      const { store, state, stages } = yield* slice(world([[bottom, SAND]]))

      yield* Ref.update(state.fallingBlocks, (queue) =>
        disturb(queue, [positionKeyOf(belowTheWorld)]),
      )
      yield* runFrames(stages, 2)

      expect(yield* store.blockAt(bottom)).toBe(SAND)
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('nothing falls from above the build limit', () =>
    Effect.gen(function* () {
      const ceiling: BlockPosition = { x: 2, y: 255, z: 3 }
      const { store, state, stages } = yield* slice(world([]))

      // The cell examined is the one ABOVE the disturbance, and at y = 256 that
      // is outside the world rather than empty. Reading it as air would be
      // harmless; asking for it and then acting on the answer would not.
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, [positionKeyOf(ceiling)]))
      yield* runFrames(stages, 2)

      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('REGRESSION: a break below the world is `OutOfWorld`, and the frame carries on', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* slice(world([[floor, STONE]]))

      // `run` has no error channel, so "the player aimed at nothing" has to be
      // an ordinary outcome rather than a failure. The frame must complete and
      // the next request must still be serviced.
      yield* requestBreak(state, { x: 2, y: -1, z: 3 })
      yield* runFrame(stages)
      expect(yield* Ref.get(state.minedItems)).toStrictEqual([])

      yield* requestBreak(state, floor)
      yield* runFrame(stages)
      expect(yield* Ref.get(state.minedItems)).toStrictEqual([STONE])
      expect(yield* store.blockAt(floor)).toBe(AIR_BLOCK_ID)
    }),
  )
})
