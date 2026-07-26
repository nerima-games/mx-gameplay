/**
 * THE SLICE, end to end. Two of them now.
 *
 * BLOCKS: the player breaks a block in `gameplay:interactions`, the sand above
 * it falls in `gameplay:entities` on a later tick, and the mined block goes to
 * the inventory.
 *
 * MOBS: a creeper spawns through the spawn rule in `gameplay:entities`, lights
 * its fuse as the player walks up, detonates exactly once, the blast kills the
 * mob beside it, that mob's gunpowder reaches the outbox, the crater's blocks go
 * through the falling-block queue, and the roster settles empty.
 *
 * ---------------------------------------------------------------------------
 * What is real here and what is a stand-in
 * ---------------------------------------------------------------------------
 *
 * REAL: everything on this repository's side of the line. The scenarios below
 * run the SHIPPED stage registrations — `gameplayStages` / `makeGameplayStages`
 * — over the shipped rules (`domain/interactions/break-block.ts`,
 * `domain/interactions/explosion-crater.ts`, `domain/entities/falling-block-move.ts`,
 * `domain/entities/mob-frame.ts` and all seven of `domain/mob/`) and the shipped
 * queue (`domain/falling-block.ts`). Nothing here re-implements a rule in order
 * to test it. That distinction is the point of this file: the port and the loop
 * were each proven separately before, and separately proven halves do not
 * compose by themselves.
 *
 * A STAND-IN: the store, `test/support/chunk-store-double.ts`; the roster,
 * `test/support/entity-manager-double.ts`; and the frame loop,
 * `test/support/frame-runner.ts`. The first two are typed by this repository's
 * mirrors of mc-worldgen's `ChunkStore` and mc-sim's `EntityManager`, and both
 * mirrors are pinned against the real interfaces by `test/chunk-store-mirror.test.ts`
 * and `test/entity-manager-mirror.test.ts`; the third resolves the `after` edges
 * the way mc-compose will, rather than trusting the array order. The same
 * scenarios against the REAL services are `mc-worldgen/test/vertical-slice.test.ts`
 * and mc-sim's own entity tests.
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
 *     not put an item in the inventory and must not re-mesh a chunk. A creeper
 *     detonating in open sky is the same rule reached by a new writer.
 *
 *  4. **The rule never names a block.** It reads a byte out of the store and
 *     asks kernel's capability table. The identical stages are run over gravel
 *     below, with no code change anywhere.
 *
 *  5. **An idle frame ALLOCATES nothing per mob.** The roster's sweep returns
 *     the argument roster and the stage hands every mob the SAME step object, so
 *     the assertion is on reference identity rather than on contents — a stage
 *     that built one record per mob per frame would satisfy every other test in
 *     this file. That is property 1 again, made out of objects instead of block
 *     reads, and it is the one the whole `EntityManager` design exists for.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { positionKeyOf } from '../domain/block-position-key'
import {
  AIR_BLOCK_ID,
  type BlockPosition,
  type BlockWriteOutcome,
  type ChunkStoreApi,
} from '../domain/chunk-store-port'
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  MAX_HOSTILE_COUNT,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../domain/entities/mob-frame'
import { EntityKind, type Position } from '../domain/entity-manager-port'
import { disturb } from '../domain/falling-block'
import { DeltaTimeSecs } from '../domain/frame-contract'
import { craterCells, craterRadius } from '../domain/interactions/explosion-crater'
import { CREEPER_FUSE_SECS, DORMANT_FUSE } from '../domain/mob/creeper-fuse'
import { CREEPER_EXPLOSION_POWER, explosionDamageAmount } from '../domain/mob/explosion'
import { DESPAWN_DISTANCE_BLOCKS } from '../domain/mob/hostile-despawn'
import { gameplayStages, makeGameplayFrameState } from '../stages/registration'
import {
  GRAVEL,
  makeChunkStoreDouble,
  SAND,
  STONE,
  world,
} from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
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
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const state = yield* makeGameplayFrameState
    return { store, roster, state, stages: gameplayStages(state, store.api, roster.api) }
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
      const { store, roster, state } = yield* slice(world([[sandAt, SAND]]))

      const hidesTheDestination: ChunkStoreApi = {
        ...store.api,
        getBlock: (position) =>
          samePosition(position, support)
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
            : store.api.getBlock(position),
      }

      const stages = gameplayStages(state, hidesTheDestination, roster.api)
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
      const { store, roster, state } = yield* slice(world([[sandAt, SAND]]))

      // Reads say the move is legal; the destination write is refused anyway —
      // the window the source-first write order opens.
      const refusesTheDestination: ChunkStoreApi = {
        ...store.api,
        setBlock: (position, block) =>
          samePosition(position, support)
            ? Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
            : store.api.setBlock(position, block),
      }

      const stages = gameplayStages(state, refusesTheDestination, roster.api)
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
          const { store, roster, state } = yield* slice(world([[sandAt, SAND]]))

          const refusesTheSource: ChunkStoreApi = {
            ...store.api,
            setBlock: (position, block) =>
              samePosition(position, sandAt)
                ? Effect.succeed(refusal)
                : store.api.setBlock(position, block),
          }

          const stages = gameplayStages(state, refusesTheSource, roster.api)
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

// ---------------------------------------------------------------------------
// The mob half of the slice.
//
// `stages/registration.ts` carried a headed paragraph for the whole of this
// repository's life saying THE CREEPER IS NOT RUN HERE, because running it needs
// a roster and a roster is mc-sim's. mc-sim built it. What follows is the slice
// that paragraph was describing: a creeper spawns through the spawn rule, lights
// its fuse as the player walks up, detonates exactly once, the blast lands on the
// mob beside it, that mob's drop reaches the outbox, the crater's blocks enter the
// falling-block queue, and the roster settles empty.
//
// A STAND-IN: the roster, `test/support/entity-manager-double.ts`, typed by this
// repository's mirror of mc-sim's `EntityManager` and pinned against the real
// interface by `test/entity-manager-mirror.test.ts`. It reproduces the three
// allocation properties of mc-sim's `sweepRoster` deliberately, because the
// headline property below — "the idle frame does no work" — is a claim about
// allocation rather than about contents.
// ---------------------------------------------------------------------------

/** Chunk (0, 0), so that a creeper's whole 3-block crater is resident. */
const creeperAt: Position = { x: 5, y: 64, z: 5 }
const bystanderAt: Position = { x: 7, y: 64, z: 5 }
/** 20 blocks off in XZ, which is inside `hostile-spawn`'s 16..40 band. */
const playerFar: Position = { x: 25, y: 64, z: 5 }
/** Two blocks from the creeper and four from the bystander: one lights, one does not. */
const playerNear: Position = { x: 3, y: 64, z: 5 }

/** In the crater (distance 1), and the creeper's floor. */
const craterFloor: BlockPosition = { x: 5, y: 63, z: 5 }
/** In the crater at exactly the radius (distance 3), and it is holding sand up. */
const craterLedge: BlockPosition = { x: 5, y: 67, z: 5 }
/** Outside the crater (distance 4), resting on the ledge. */
const ledgeSand: BlockPosition = { x: 5, y: 68, z: 5 }

/**
 * A candidate cell that `canHostileSpawnAt` says yes to.
 *
 * Every field is somebody else's fact and the test is playing all of them:
 * midnight (mc-sim's hour), pitch dark and a stone floor with two cells of air
 * (mc-worldgen's blocks and light grid), 20 blocks away in XZ (mc-sim's player).
 * The SEARCH that would gather these is not in this repository and cannot be —
 * see `MobSpawnAttempt` — so the frame is handed candidates exactly as it is
 * handed break requests.
 */
const legalCandidate = {
  groundBlock: STONE,
  footBlock: AIR_BLOCK_ID,
  headBlock: AIR_BLOCK_ID,
  blockLight: 0,
  timeOfDay: 0,
  distanceToPlayerBlocksXZ: 20,
} as const

const attemptAt = (feetPosition: Position): MobSpawnAttempt => ({
  candidate: legalCandidate,
  feetPosition,
})

const offerSpawns = (
  state: { readonly spawnAttempts: Ref.Ref<ReadonlyArray<MobSpawnAttempt>> },
  attempts: ReadonlyArray<MobSpawnAttempt>,
): Effect.Effect<void> =>
  Ref.update(state.spawnAttempts, (pending) => [...pending, ...attempts])

/**
 * A quarter of a second per frame, for the reason `test/mob.test.ts` gives:
 * quarter-seconds are exact in binary, so "six steps reach 1.5" is arithmetic
 * rather than a rounding coincidence.
 */
const STRIDE = DeltaTimeSecs(0.25)

describe('the mob slice, through the stage registration', () => {
  it.effect('a creeper spawns, lights, detonates once, and the blast reaches the world', () =>
    Effect.gen(function* () {
      const { store, roster, state, stages } = yield* slice(
        world([
          [craterFloor, STONE],
          [craterLedge, STONE],
          [ledgeSand, SAND],
        ]),
      )

      // ---- the player is far away, and two creepers are offered ------------
      yield* Ref.set(state.targetPosition, playerFar)
      yield* offerSpawns(state, [attemptAt(creeperAt), attemptAt(bystanderAt)])
      yield* runFrame(stages, STRIDE)

      expect(yield* roster.api.countOfKind(CREEPER_KIND)).toBe(2)
      const spawned = yield* roster.api.entities
      // A mob spawned this frame does not act this frame: the sweep runs before
      // the spawn, so both are dormant with full health and nothing has moved.
      expect(spawned.map((entity) => entity.behaviour)).toStrictEqual([DORMANT_FUSE, DORMANT_FUSE])
      expect(spawned.map((entity) => entity.healthPoints)).toStrictEqual([
        CREEPER_MAX_HEALTH,
        CREEPER_MAX_HEALTH,
      ])
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0 })

      // ---- the player walks up ---------------------------------------------
      yield* Ref.set(state.targetPosition, playerNear)
      yield* runFrame(stages, STRIDE)

      // Lighting and burning are ONE step (`domain/mob/creeper-fuse.ts`), so the
      // very frame that finds the player in range already has 0.25 on the clock.
      // The bystander is four blocks off — outside the three-block ignition
      // range — and is untouched.
      const lit = yield* roster.api.entities
      expect(lit[0]?.behaviour).toStrictEqual({ _tag: 'Lit', burnedSecs: 0.25 })
      expect(lit[1]?.behaviour).toBe(DORMANT_FUSE)

      // ...and the unchanged bystander is the SAME OBJECT it was before, which
      // is what mc-sim's zero-copy sweep is for.
      expect(lit[1]).toBe(spawned[1])

      // ---- five more quarter-seconds ---------------------------------------
      // 0.25 * 6 = 1.5 = CREEPER_FUSE_SECS, and the threshold is `>=`.
      expect(CREEPER_FUSE_SECS).toBe(1.5)
      yield* runFrames(stages, 4, STRIDE)
      expect((yield* roster.api.entities)[0]?.behaviour).toStrictEqual({
        _tag: 'Lit',
        burnedSecs: 1.25,
      })

      const beforeBlast = yield* store.calls
      yield* runFrame(stages, STRIDE)

      // ---- the roster settles ----------------------------------------------
      // The creeper is gone because it detonated; the bystander is gone because
      // the blast killed it. Two blocks from a creeper is 24 damage against 20
      // health, and that number is `domain/mob/explosion.ts`'s curve rather than
      // this file's arithmetic.
      expect(explosionDamageAmount(CREEPER_EXPLOSION_POWER, 2)).toBe(24)
      expect(yield* roster.api.count).toBe(0)

      // ---- the drop reached the OUTBOX, and only the bystander's ------------
      // A creeper that blows itself up drops nothing — `MobKill.SelfDestruct` —
      // so one gunpowder and not two. The block outbox is untouched: a mob drop
      // is not a mined block, and the two are different lists for that reason.
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([{ item: 'gunpowder', count: 1 }])
      expect(yield* Ref.get(state.minedItems)).toStrictEqual([])

      // ---- the crater emptied its cells, and only those --------------------
      expect(yield* store.blockAt(craterFloor)).toBe(AIR_BLOCK_ID)
      // The ledge went too, and the sand that was resting on it FELL — in the
      // same frame, through the falling-block queue, because `disturb` is the
      // only way block work enters and the crater fed it. This is the property
      // `domain/mob/explosion.ts` predicted: 「a blast under a desert leaves the
      // sand hanging」 unless the crater disturbs.
      expect(yield* store.blockAt(ledgeSand)).toBe(AIR_BLOCK_ID)
      expect(yield* store.blockAt(craterLedge)).toBe(SAND)

      // The store was untouched until the blast, and the blast is the only
      // reason it was touched at all: one write per crater cell and no reads
      // beyond the falling-block rule's.
      expect(beforeBlast).toStrictEqual({ reads: 0, writes: 0 })
      expect((yield* store.calls).writes).toBeGreaterThanOrEqual(craterCells(creeperAt, CREEPER_EXPLOSION_POWER).length)
    }),
  )

  it.effect('REGRESSION: an idle frame does no mob work — one shared step object, and the roster it was given', () =>
    Effect.gen(function* () {
      // THE PROPERTY THE WHOLE DESIGN PROTECTS, and the mob-side twin of the
      // idle-frame test above. mc-sim's sweep returns the ARGUMENT roster when
      // nothing changed and allocates no array; the one allocation it cannot
      // remove is the `{ transition, emit }` record the step function returns,
      // and `domain/entities/mob-frame.ts` shares that too. A stage that built a
      // fresh one per mob would be completely correct and would hand back
      // per-mob-per-frame garbage on the frame path — DN-GP-1's mistake made out
      // of objects instead of block reads.
      const { store, roster, state, stages } = yield* slice(world([[craterFloor, STONE]]))

      // Three mobs this repository has no rule for, and one dormant creeper.
      // The creeper is 50 blocks off: outside the 3-block ignition range and
      // well inside the 128-block despawn radius, so nothing happens to any of
      // them for any reason.
      const pig = EntityKind('pig')
      yield* Effect.forEach([0, 1, 2], (index) =>
        roster.api.spawn({
          kind: pig,
          feetPosition: { x: index, y: 64, z: 0 },
          healthPoints: 10,
          behaviour: undefined,
        }),
      )
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: 50, y: 64, z: 5 },
        healthPoints: CREEPER_MAX_HEALTH,
        behaviour: DORMANT_FUSE,
      })
      yield* Ref.set(state.targetPosition, playerNear)

      const before = yield* roster.api.entities
      yield* runFrames(stages, 10, STRIDE)

      // The array is the SAME array, and every entity in it is the same object.
      expect(yield* roster.api.entities).toBe(before)

      // ONE distinct step object across four mobs. Four would mean the stage is
      // allocating per mob; the count is per sweep, so it is the last frame's.
      const calls = yield* roster.calls
      expect(calls.distinctStepObjects).toBe(1)
      expect(calls.sweeps).toBe(10)
      expect(calls.despawns).toBe(0)

      // ...and the store was not touched at all, which is the original claim.
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0 })
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
    }),
  )

  it.effect('a mob past the despawn radius is swept, and leaves nothing behind', () =>
    Effect.gen(function* () {
      // The other end of the spawn rule's budget. A despawn is NOT a death:
      // nobody killed it, so `domain/mob/mob-drop.ts` is never consulted and the
      // outbox stays empty. Getting this wrong would have a player's inventory
      // fill up with the gunpowder of mobs they never met.
      const { roster, state, stages } = yield* slice(world([]))

      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: DESPAWN_DISTANCE_BLOCKS + 1, y: 64, z: 0 },
        healthPoints: CREEPER_MAX_HEALTH,
        behaviour: DORMANT_FUSE,
      })
      const kept = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        // Exactly at the boundary. The comparison is STRICTLY GREATER, which the
        // reference's oracle pins and `domain/mob/hostile-despawn.ts` ports.
        feetPosition: { x: DESPAWN_DISTANCE_BLOCKS, y: 64, z: 0 },
        healthPoints: CREEPER_MAX_HEALTH,
        behaviour: DORMANT_FUSE,
      })

      yield* Ref.set(state.targetPosition, { x: 0, y: 64, z: 0 })
      yield* runFrame(stages, STRIDE)

      expect((yield* roster.api.entities).map((entity) => entity.id)).toStrictEqual([kept.id])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
    }),
  )

  it.effect('the population cap is a live census, re-read for every candidate', () =>
    Effect.gen(function* () {
      // `domain/mob/hostile-spawn.ts` said HOW MANY 「arrives with mc-sim」 and
      // named `MAX_HOSTILE_COUNT = 16 against a live census`. `countOfKind` is
      // that census. The cap is re-read per attempt rather than hoisted, because
      // the frame in which the last slot is taken is the only frame in which the
      // cap is the thing being tested.
      const { roster, state, stages } = yield* slice(world([]))
      yield* Ref.set(state.targetPosition, playerFar)

      const offered = MAX_HOSTILE_COUNT + 4
      yield* offerSpawns(
        state,
        Array.from({ length: offered }, (_, index) => attemptAt({ x: index, y: 64, z: 5 })),
      )
      yield* runFrame(stages, STRIDE)

      expect(yield* roster.api.countOfKind(CREEPER_KIND)).toBe(MAX_HOSTILE_COUNT)

      // One census per candidate that got past the cell test, plus the one this
      // assertion just took. A hoisted count would have spawned all twenty.
      expect((yield* roster.calls).censuses).toBe(offered + 1)
    }),
  )

  it.effect('a refused cell spawns nothing, and daylight is a refusal like any other', () =>
    Effect.gen(function* () {
      // The night gate is `domain/day-night.ts`'s and is called rather than
      // re-derived: its header records the reference shipping a fresh world that
      // spawned at midnight with daylight-immune hostiles camped on the respawn
      // point — an unrecoverable death loop on world creation.
      const { roster, state, stages } = yield* slice(world([]))
      yield* Ref.set(state.targetPosition, playerFar)

      yield* offerSpawns(state, [
        { candidate: { ...legalCandidate, timeOfDay: 0.5 }, feetPosition: creeperAt },
        { candidate: { ...legalCandidate, blockLight: 8 }, feetPosition: creeperAt },
        { candidate: { ...legalCandidate, distanceToPlayerBlocksXZ: 4 }, feetPosition: creeperAt },
        { candidate: { ...legalCandidate, groundBlock: AIR_BLOCK_ID }, feetPosition: creeperAt },
        { candidate: { ...legalCandidate, blockLight: Number.NaN }, feetPosition: creeperAt },
      ])
      yield* runFrame(stages, STRIDE)

      expect(yield* roster.api.count).toBe(0)
      // The inbox was CONSUMED, not merely read: a candidate offered between a
      // get and a set would be dropped without a trace (DN-GP-10).
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
      expect((yield* roster.calls).spawns).toBe(0)
    }),
  )

  it.effect('the drop is deterministic: two runs of one scenario produce the same loot', () =>
    Effect.gen(function* () {
      // plan.md §5.1-3 makes determinism the precondition for using the
      // reference's tests as an oracle, and `domain/frame-rolls.ts` is where
      // randomness enters a frame so that this holds. The creeper's own table
      // never consults a roll — `domain/mob/mob-drop.ts` says so — so what this
      // pins is the SEED PLUMBING: the same scenario advances the same generator
      // by the same number of draws.
      const run = Effect.gen(function* () {
        const { roster, state, stages } = yield* slice(world([]))
        yield* roster.api.spawn({
          kind: CREEPER_KIND,
          feetPosition: creeperAt,
          healthPoints: CREEPER_MAX_HEALTH,
          behaviour: DORMANT_FUSE,
        })
        yield* roster.api.spawn({
          kind: CREEPER_KIND,
          feetPosition: bystanderAt,
          healthPoints: CREEPER_MAX_HEALTH,
          behaviour: DORMANT_FUSE,
        })
        yield* Ref.set(state.targetPosition, playerNear)
        yield* runFrames(stages, 6, STRIDE)

        return {
          drops: yield* Ref.get(state.mobDrops),
          seed: yield* Ref.get(state.rollSeed),
        }
      })

      const first = yield* run
      const second = yield* run

      expect(first.drops).toStrictEqual([{ item: 'gunpowder', count: 1 }])
      expect(second).toStrictEqual(first)
    }),
  )
})

describe('the crater is the other radius, and it is the falling-block queue’s newest source', () => {
  it.effect('destroys blocks out to floor(power), not out to the damage radius', () =>
    Effect.sync(() => {
      // `domain/mob/explosion.ts` warns about exactly this call site: the
      // reference damages out to `power * 2` = 6 and destroys out to
      // `Math.floor(power)` = 3, and the temptation at a crater is to reach for
      // the one that is already in scope.
      expect(craterRadius(CREEPER_EXPLOSION_POWER)).toBe(3)

      const cells = craterCells({ x: 0, y: 64, z: 0 }, CREEPER_EXPLOSION_POWER)
      // A SOLID Euclidean sphere: every integer offset with dx² + dy² + dz² <= 9,
      // boundary included, which is 123 cells and not the 343 of the cube.
      expect(cells.length).toBe(123)
      expect(cells).toContainEqual({ x: 3, y: 64, z: 0 })
      expect(cells).not.toContainEqual({ x: 3, y: 65, z: 0 })

      // TOTAL, in the inert direction: a power that is not a number has no
      // crater rather than a `NaN` bound that empties the loop by accident.
      expect(craterCells({ x: 0, y: 0, z: 0 }, Number.NaN)).toStrictEqual([])
      expect(craterCells({ x: Number.NaN, y: 0, z: 0 }, 3)).toStrictEqual([])
      expect(craterRadius(0)).toBe(0)
    }),
  )

  it.effect('a blast in open sky enqueues nothing, because `Unchanged` did not dirty', () =>
    Effect.gen(function* () {
      // The interactions stage's rule, applied to a new writer: queueing a
      // disturbance for a write that changed nothing is how a cheap event
      // becomes a per-tick workload. A creeper detonating in mid-air writes air
      // over air 123 times and must leave the queue empty.
      const { store, roster, state, stages } = yield* slice(world([]))

      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: creeperAt,
        healthPoints: CREEPER_MAX_HEALTH,
        // Already one step from the end, so the very next frame detonates.
        behaviour: { _tag: 'Lit', burnedSecs: 1.4 },
      })
      yield* Ref.set(state.targetPosition, playerNear)
      yield* runFrame(stages, STRIDE)

      expect(yield* roster.api.count).toBe(0)
      expect((yield* store.calls).writes).toBe(craterCells(creeperAt, CREEPER_EXPLOSION_POWER).length)
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)
      // ...and no reads at all: the falling-block pass had an empty batch, so it
      // stopped before touching the store.
      expect((yield* store.calls).reads).toBe(0)
    }),
  )
})

describe('the stage supplies its rolls from a seed', () => {
  const repositoryRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

  it.effect('REGRESSION-PROOF BY SHAPE: nothing on the frame path reads a random number or a clock', () =>
    Effect.sync(() => {
      // `test/mob.test.ts` reads `domain/mob/` and fails on `Math.random`, which
      // is what makes "the rules take their rolls as parameters" enforceable
      // rather than aspirational. Wiring those rules into a stage is exactly the
      // moment somebody reaches for the global generator to feed them — the
      // reference did, in the application layer, twice
      // (`interaction-melee-handler.ts:185`, `interaction-mob-drops.ts:18`), and
      // that is why its drops cannot be replayed.
      //
      // So the same check now covers the code that CALLS the rules. The clock
      // half of it duplicates `pnpm check:deps` on purpose: two gates, and the
      // one that runs in the test suite is the one a developer sees first.
      const directories = ['stages', 'domain/entities', 'domain/interactions']
      const files = [
        path.join(repositoryRoot, 'domain/frame-rolls.ts'),
        ...directories.flatMap((directory) =>
          readdirSync(path.join(repositoryRoot, directory))
            .filter((name) => name.endsWith('.ts'))
            .map((name) => path.join(repositoryRoot, directory, name)),
        ),
      ]
      expect(files.length).toBeGreaterThan(4)

      for (const file of files) {
        const source = readFileSync(file, 'utf8')
        const offending = source
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
          .filter(
            (line) =>
              line.includes('Math.random') ||
              line.includes('Date.now') ||
              line.includes('performance.now'),
          )

        expect({ file: path.relative(repositoryRoot, file), offending }).toStrictEqual({
          file: path.relative(repositoryRoot, file),
          offending: [],
        })
      }
    }),
  )
})
