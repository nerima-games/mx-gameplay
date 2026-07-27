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
import { NOON_FRACTION } from '../domain/day-night'
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  ENDERMAN_KIND,
  ENDERMAN_TELEPORT_ROLLS,
  HOSTILE_KINDS,
  MAX_HOSTILE_COUNT,
  STEADY_ENDERMAN,
  STRUCK_ENDERMAN,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../domain/entities/mob-frame'
import { EntityKind, type EntityManagerApi, type Position } from '../domain/entity-manager-port'
import { disturb } from '../domain/falling-block'
import { DeltaTimeSecs } from '../domain/frame-contract'
import { DEFAULT_ROLL_SEED, drawRolls, nextRoll } from '../domain/frame-rolls'
import { craterCells, craterRadius } from '../domain/interactions/explosion-crater'
import { CREEPER_FUSE_SECS, DORMANT_FUSE } from '../domain/mob/creeper-fuse'
import {
  ENDERMAN_CHASE_TELEPORT_CHANCE,
  ENDERMAN_DAMAGE_TELEPORT_CHANCE,
  ENDERMAN_TELEPORT_MAX_BLOCKS,
  ENDERMAN_TELEPORT_MIN_BLOCKS,
  endermanTeleportOffset,
} from '../domain/mob/enderman-teleport'
import { CREEPER_EXPLOSION_POWER, explosionDamageAmount } from '../domain/mob/explosion'
import { DESPAWN_DISTANCE_BLOCKS } from '../domain/mob/hostile-despawn'
import type { MinedItem } from '../domain/interactions/block-loot'
import {
  gameplayStages,
  makeGameplayFrameState,
  type PlacementRequest,
} from '../stages/registration'
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

/**
 * What mc-sim's `InventoryService` will supply: the tool the player is holding.
 *
 * A WOODEN PICKAXE IS NOT THE DEFAULT and every test that wants stone to drop
 * has to say so, which is the whole of what `domain/interactions/block-loot.ts`
 * changed about this file. Before it, `minedItems` received the raw byte the
 * write returned, so bare hands harvested stone and mining it yielded STONE
 * rather than cobblestone.
 */
const holdWoodenPickaxe = (
  state: { readonly heldTool: Ref.Ref<{ readonly heldTier?: 'none' | 'wooden' | 'stone' | 'iron' | 'diamond' }> },
): Effect.Effect<void> => Ref.set(state.heldTool, { heldTier: 'wooden' })

/** kernel's answer for stone mined with a pickaxe: one cobblestone, no fortune. */
const ONE_COBBLESTONE: ReadonlyArray<MinedItem> = [{ item: 'cobblestone', count: 1 }]

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

      yield* holdWoodenPickaxe(state)
      yield* requestBreak(state, support)
      yield* runFrame(stages)

      // ---- the block was mined, and the ITEM went to the inventory ---------
      // `previous` came back from the write itself, so there was no
      // read-then-write race for it (mc-worldgen §6-3) — and it is a BYTE, so
      // `domain/interactions/block-loot.ts` is what turns it into an item. The
      // assertion is `cobblestone` and not `stone`, which is kernel's drop row
      // (`{ ...DEFAULT_BLOCK_DROP, item: 'cobblestone' }`) reaching the outbox.
      expect(yield* Ref.get(state.minedItems)).toStrictEqual(ONE_COBBLESTONE)

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

      yield* holdWoodenPickaxe(state)
      yield* requestBreak(state, support)
      yield* runFrame(stages)

      // Identical stages, identical rules, different block. Neither file was
      // told that gravel exists — the reference implementation asked
      // `blockTypeToIndex('SAND')` in 229 places across 51 files (plan.md §3.1).
      expect(yield* store.blockAt(support)).toBe(GRAVEL)
      expect(yield* Ref.get(state.minedItems)).toStrictEqual(ONE_COBBLESTONE)
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

      yield* holdWoodenPickaxe(state)
      yield* requestBreak(state, floor)
      yield* runFrame(stages)
      expect(yield* Ref.get(state.minedItems)).toStrictEqual(ONE_COBBLESTONE)
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
 *
 * These tests keep OFFERING candidates through the inbox even though
 * `domain/entities/mob-spawn-search.ts` now gathers them for real. That is
 * deliberate: an offered cell states every fact in one literal, so a test about
 * the CAP or about a refusal reason is not also a test of the ring's geometry.
 * The search has its own file (`test/mob-spawn-search.test.ts`) and its own
 * end-to-end case below.
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
  // Named explicitly rather than defaulted. `MobSpawnAttempt` carries a kind
  // because the spawner now produces more than one hostile, and a test that let
  // the field be implicit would stop noticing which mob it asked for.
  kind: CREEPER_KIND,
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

/**
 * Put the world at noon, so that the SPAWN SEARCH does not run.
 *
 * `domain/entities/mob-spawn-search.ts` is paced by
 * `HOSTILE_SPAWN_INTERVAL_SECS` and gated on `hostileSpawnsAllowed`, and the
 * stage's frame-state `timeOfDay` defaults to 0 — midnight — which is night and
 * therefore ALLOWS spawns. That default is deliberate (see the paragraph on the
 * inbox in `stages/registration.ts`: a host that forgets to write the hour gets
 * a world that visibly spawns rather than one that silently never does).
 *
 * It means every test below that is about something ELSE has to say what time it
 * is, exactly as it already has to say where the player is. The tests that ARE
 * about the search are in `test/mob-spawn-search.test.ts` and in the end-to-end
 * case at the bottom of this file, and they set night explicitly.
 *
 * This is NOT a way of switching the feature off to keep an old assertion
 * passing. The assertions these tests make — no store reads, no rolls drawn, one
 * shared step object — are claims about the MOB SWEEP, and the sweep is what
 * they still measure. Measuring the sweep plus a paced search in one number
 * would make both unfalsifiable.
 */
const daylight = (state: { readonly timeOfDay: Ref.Ref<number> }): Effect.Effect<void> =>
  Ref.set(state.timeOfDay, NOON_FRACTION)

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
      yield* daylight(state)
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
      yield* daylight(state)
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
      yield* daylight(state)
      yield* Ref.set(state.targetPosition, playerFar)

      const offered = MAX_HOSTILE_COUNT + 4
      yield* offerSpawns(
        state,
        Array.from({ length: offered }, (_, index) => attemptAt({ x: index, y: 64, z: 5 })),
      )
      yield* runFrame(stages, STRIDE)

      expect(yield* roster.api.countOfKind(CREEPER_KIND)).toBe(MAX_HOSTILE_COUNT)

      // One census PER HOSTILE KIND per candidate that got past the cell test,
      // plus the one this assertion just took. A hoisted count would have
      // spawned all twenty, which is what this number is really guarding.
      //
      // The multiplier is `HOSTILE_KINDS.length` and it is the visible cost of
      // the cap becoming a SUM. mc-sim's census answers about ONE kind
      // (`countOfKind` 「compares two strings the caller supplied」), so a total
      // over hostiles is this repository's to add up — and a per-kind cap with
      // two hostile kinds would enforce 「16 creepers」 rather than 「16 hostiles」.
      expect((yield* roster.calls).censuses).toBe(offered * HOSTILE_KINDS.length + 1)
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
        { candidate: { ...legalCandidate, timeOfDay: 0.5 }, kind: CREEPER_KIND, feetPosition: creeperAt },
        { candidate: { ...legalCandidate, blockLight: 8 }, kind: CREEPER_KIND, feetPosition: creeperAt },
        { candidate: { ...legalCandidate, distanceToPlayerBlocksXZ: 4 }, kind: CREEPER_KIND, feetPosition: creeperAt },
        { candidate: { ...legalCandidate, groundBlock: AIR_BLOCK_ID }, kind: CREEPER_KIND, feetPosition: creeperAt },
        { candidate: { ...legalCandidate, blockLight: Number.NaN }, kind: CREEPER_KIND, feetPosition: creeperAt },
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

// ---------------------------------------------------------------------------
// The enderman half of the slice.
//
// `domain/mob/enderman-teleport.ts` was written, tested against the reference's
// oracle in `test/mob.test.ts`, and then called by nothing at all — the same
// position `domain/mob/creeper-fuse.ts` was in before mc-sim published a roster.
// The stated blocker was that `endermanTeleportUrge` wants `damagedThisStep` and
// `stuckTicks` and 「mc-sim's entity has neither field」, which was true of
// `EntityState`'s three fields and irrelevant: mc-sim carries per-mob rule state
// on a TYPE PARAMETER that this repository instantiates, so a flag about a mob
// belongs on `MobBehaviour` and needed no change in mc-sim to put there.
//
// What follows is the wiring that argument was hiding. One of the two facts turns
// out to be measurable and the other does not, and the tests below pin both
// answers rather than only the good one.
// ---------------------------------------------------------------------------

/** Four blocks from the creeper: inside the blast, and a long way from killed. */
const endermanAt: Position = { x: 9, y: 64, z: 5 }

/**
 * An enderman's health at spawn.
 *
 * A LOCAL NUMBER AND NOT A CONSTANT, on purpose. A per-kind maximum is the rules
 * tier's (`CREEPER_MAX_HEALTH` says so, quoting mc-sim's §7-6), but nothing on
 * this side of the line spawns an enderman — see `ENDERMAN_KIND` — so a
 * `ENDERMAN_MAX_HEALTH` would be an exported constant with no producer, which is
 * the shape `domain/mob/shulker-shell.ts` refuses for `SHULKER_FORCED_CLOSED_TICKS`.
 * Forty is vanilla's; the test needs only "survives ten damage".
 */
const ENDERMAN_HEALTH = 40

/**
 * The first seed whose draw sequence does what a scenario needs.
 *
 * Searched rather than hard-coded, and the predicates below are written out of
 * the RULE's own constants and functions. A literal seed would be a number
 * nobody could check, and would silently stop meaning what its comment said the
 * day `nextRoll` or the teleport band moved.
 *
 * The bound is not arbitrary. MINSTD's first output is `16807 * seed` while that
 * product stays under the modulus, so scanning upward from 1 walks the FIRST ROLL
 * linearly through `[0, 1)` and runs out of roll space at `2^31 - 1` over 16807 —
 * a little under 128 thousand. Anything beyond that would be re-searching rolls
 * the scan has already offered, and a search that stopped at, say, twenty
 * thousand would silently be unable to ask for a first roll above 0.16.
 */
const MAX_SEED_SEARCH = Math.ceil(2_147_483_647 / 16_807)

const seedSuchThat = (accept: (seed: number) => boolean): number => {
  for (let seed = 1; seed <= MAX_SEED_SEARCH; seed += 1) {
    if (accept(seed)) {
      return seed
    }
  }
  throw new Error('no seed at all produces the draw sequence this scenario needs')
}

/** The rolls one frame of an enderman that decides to go consumes: the urge, then the search. */
const teleportSucceedsFrom = (seed: number): boolean =>
  endermanTeleportOffset(drawRolls(seed, ENDERMAN_TELEPORT_ROLLS).rolls) !== undefined

const blocksApart = (from: Position, to: Position): number =>
  Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z)

/** The one mob in a scenario that has exactly one. `[0]` rather than a search: an id is not the point. */
const soleEntity = (roster: { readonly api: EntityManagerApi<MobBehaviour> }) =>
  Effect.map(roster.api.entities, (entities) => entities[0])

describe('the enderman slice: a rule that returns a displacement, run over a roster', () => {
  it.effect('WIRING: a restless enderman closes on the player, and lands in the 8..32 band', () =>
    Effect.gen(function* () {
      // THE TEST THAT FAILS IF THE WIRING IS ABSENT. Before this change the sweep
      // ignored every mob that was not a creeper, so the enderman below stayed
      // exactly where it was spawned for as many frames as anyone cared to run.
      const { roster, state, stages } = yield* slice(world([]))

      // A seed whose FIRST roll passes the 5% chase gate and whose next
      // thirty-two find an offset inside the band. Both halves are the rule's own
      // arithmetic, so this is a scenario rather than a magic number.
      const seed = seedSuchThat((candidate) => {
        const urge = nextRoll(candidate)
        return urge.roll < ENDERMAN_CHASE_TELEPORT_CHANCE && teleportSucceedsFrom(urge.seed)
      })

      yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: endermanAt,
        healthPoints: ENDERMAN_HEALTH,
        behaviour: STEADY_ENDERMAN,
      })
      yield* Ref.set(state.targetPosition, playerNear)
      yield* Ref.set(state.rollSeed, seed)
      yield* runFrame(stages, STRIDE)

      const moved = yield* soleEntity(roster)

      // THE ANCHOR IS THE PLAYER, and that is the half of the rule the reference
      // lost: `reason: 'restless'` carries `anchor: 'target'`, so this is an
      // APPROACH — 8 to 32 blocks from you, from whatever distance it started at
      // — and not an escape. Measured against the player rather than against
      // where it stood, which is what tells the two anchors apart.
      const reach = blocksApart(moved?.feetPosition ?? endermanAt, playerNear)
      expect(reach).toBeGreaterThanOrEqual(ENDERMAN_TELEPORT_MIN_BLOCKS)
      expect(reach).toBeLessThanOrEqual(ENDERMAN_TELEPORT_MAX_BLOCKS)

      // ...and it kept its own altitude. `domain/mob/enderman-teleport.ts`
      // returns no `y` at all, and the reference copies the ANCHOR's — which puts
      // an approaching enderman at the player's altitude, usually inside rock.
      expect(moved?.feetPosition.y).toBe(endermanAt.y)

      // The seed advanced by the urge plus the whole search budget, and by
      // nothing else: an enderman that decided to go is what moved the generator.
      expect(yield* Ref.get(state.rollSeed)).toBe(
        drawRolls(nextRoll(seed).seed, ENDERMAN_TELEPORT_ROLLS).seed,
      )
    }),
  )

  it.effect('WIRING: a creeper’s blast marks the enderman beside it, and it flees on the next frame', () =>
    Effect.gen(function* () {
      // The whole path, end to end and across a frame boundary: the fuse ends,
      // `resolveBlasts` damages a bystander and arms its flinch, and the NEXT
      // sweep reads the flinch, rolls the 30%, and moves the mob. Two stages of
      // one frame plus one more frame, none of it re-implemented here.
      const { roster, state, stages } = yield* slice(world([]))

      // Frame 1's roll must MISS the 5% chase gate (the enderman is Steady and
      // has a target, so it consults the rule before the blast reaches it), and
      // frame 2's must PASS the 30% damage gate and then find an offset.
      const seed = seedSuchThat((candidate) => {
        const chase = nextRoll(candidate)
        if (chase.roll < ENDERMAN_CHASE_TELEPORT_CHANCE) {
          return false
        }
        const flee = nextRoll(chase.seed)
        return flee.roll < ENDERMAN_DAMAGE_TELEPORT_CHANCE && teleportSucceedsFrom(flee.seed)
      })

      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: creeperAt,
        // One step from the end, so the very next frame detonates.
        healthPoints: CREEPER_MAX_HEALTH,
        behaviour: { _tag: 'Lit', burnedSecs: 1.4 },
      })
      yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: endermanAt,
        healthPoints: ENDERMAN_HEALTH,
        behaviour: STEADY_ENDERMAN,
      })
      yield* Ref.set(state.targetPosition, playerNear)
      yield* Ref.set(state.rollSeed, seed)

      yield* runFrame(stages, STRIDE)

      // ---- the blast landed, and it is the ONE blow this repository measures --
      // Four blocks from a creeper is 10 damage against 40 health, and that
      // number is `domain/mob/explosion.ts`'s curve rather than this file's
      // arithmetic. The creeper is gone; the enderman is hurt and now REMEMBERS
      // being hurt, which is the field mc-sim's `EntityState` was said not to
      // have.
      expect(explosionDamageAmount(CREEPER_EXPLOSION_POWER, 4)).toBe(10)
      const struck = yield* soleEntity(roster)
      expect(yield* roster.api.count).toBe(1)
      expect(struck?.healthPoints ?? 0).toBe(ENDERMAN_HEALTH - 10)
      expect(struck?.behaviour).toBe(STRUCK_ENDERMAN)
      // It has NOT moved yet: the blast is resolved after the sweep, so the
      // answer is a frame late and that is the design rather than a lag.
      expect(struck?.feetPosition).toStrictEqual(endermanAt)

      yield* runFrame(stages, STRIDE)

      // ---- and on the next frame it flees ------------------------------------
      // THE ANCHOR IS ITSELF. `reason: 'damaged'` carries `anchor: 'self'`, so
      // this is measured from where it was STANDING — the opposite of the
      // restless case above, and the distinction the reference makes by passing a
      // different argument at each of two call sites and recording it nowhere.
      const fled = yield* soleEntity(roster)
      const escape = blocksApart(fled?.feetPosition ?? endermanAt, endermanAt)
      expect(escape).toBeGreaterThanOrEqual(ENDERMAN_TELEPORT_MIN_BLOCKS)
      expect(escape).toBeLessThanOrEqual(ENDERMAN_TELEPORT_MAX_BLOCKS)
      expect(fled?.feetPosition.y).toBe(endermanAt.y)

      // ...and the blow is SPENT. Keeping it would re-roll the same hit on every
      // later frame until one of them came up under 0.3, teleporting a mob for
      // damage it took ten seconds ago.
      expect(fled?.behaviour).toBe(STEADY_ENDERMAN)
    }),
  )

  it.effect('a hurt enderman that fails its 30% roll stays put — and still forgets the blow', () =>
    Effect.gen(function* () {
      // `endermanTeleportUrge`'s damage branch SHORT-CIRCUITS, which
      // `test/mob.test.ts` pins on the rule; this is the frame honouring it. The
      // interesting half is the second assertion: `Stay` must still consume the
      // flinch, or a cornered enderman becomes one that escapes every hit
      // eventually.
      //
      // It also exercises the constant the reference never ran: its only
      // damage-side caller passes a hard-coded roll of `0`, so `0 < 0.3` is
      // always true and a hurt enderman there teleports EVERY time. The frame
      // feeds a real roll, which is what makes the 30% a behaviour rather than a
      // comment.
      const { roster, state, stages } = yield* slice(world([]))

      const seed = seedSuchThat(
        (candidate) => nextRoll(candidate).roll >= ENDERMAN_DAMAGE_TELEPORT_CHANCE,
      )

      const spawned = yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: endermanAt,
        healthPoints: ENDERMAN_HEALTH,
        behaviour: STRUCK_ENDERMAN,
      })
      // No target at all, so nothing but the flinch can make it act — the chase
      // lane does not run, and the damage branch anchors on `self` and needs no
      // player.
      yield* Ref.set(state.rollSeed, seed)
      yield* runFrame(stages, STRIDE)

      const settled = yield* soleEntity(roster)
      expect(settled?.feetPosition).toStrictEqual(spawned.feetPosition)
      expect(settled?.behaviour).toBe(STEADY_ENDERMAN)

      // Exactly one roll was drawn: the urge said `Stay`, so the thirty-two-roll
      // search budget was never touched.
      expect(yield* Ref.get(state.rollSeed)).toBe(nextRoll(seed).seed)
    }),
  )

  it.effect('REGRESSION: an idle enderman costs one shared step object and does not move the seed', () =>
    Effect.gen(function* () {
      // The mob-side allocation property, extended to the behaviour that arrived
      // with a random number generator attached. A rule that consults a roll is
      // the obvious place for an idle frame to start allocating again — one
      // `RollDraw` per mob per frame is DN-GP-1's mistake made out of objects —
      // so the enderman draws NOTHING when it has nobody to chase and no blow to
      // answer, and the generator is left exactly where it was found.
      const { roster, state, stages } = yield* slice(world([]))

      yield* Effect.forEach([0, 1, 2], (index) =>
        roster.api.spawn({
          kind: ENDERMAN_KIND,
          feetPosition: { x: index, y: 64, z: 0 },
          healthPoints: ENDERMAN_HEALTH,
          behaviour: STEADY_ENDERMAN,
        }),
      )
      // No target. `despawnVerdict` KEEPS a mob in a world with nobody in it —
      // 「a world with nobody in it has nobody to be far from」 — so all three
      // survive to be ignored.
      const before = yield* roster.api.entities
      yield* runFrames(stages, 10, STRIDE)

      expect(yield* roster.api.entities).toBe(before)
      const calls = yield* roster.calls
      expect(calls.distinctStepObjects).toBe(1)
      expect(calls.sweeps).toBe(10)
      expect(yield* Ref.get(state.rollSeed)).toBe(DEFAULT_ROLL_SEED)
    }),
  )

  it.effect('DECIDED AND PINNED: standing still is not being stuck — no 41-frame clock', () =>
    Effect.gen(function* () {
      // `ENDERMAN_STUCK_TELEPORT_TICKS = 40` is the one branch of the rule the
      // frame cannot reach, and the temptation is to reach it anyway by counting
      // frames in which `feetPosition` did not change. Nothing in this repository
      // writes a mob's position except the teleport itself, so that counter would
      // be true for every mob on every frame: every enderman in the world would
      // teleport once every 41 frames, on a measurement carrying no information.
      //
      // So the frame passes zero, and this is what pins the decision — sixty
      // consecutive frames with a target and no blow, in which the ONLY thing
      // that can move the mob is the 5% chase roll. A frame counter would have
      // moved it on the 41st.
      const { roster, state, stages } = yield* slice(world([]))

      const frames = 60
      const seed = seedSuchThat((candidate) => {
        let cursor = candidate
        for (let frame = 0; frame < frames; frame += 1) {
          const draw = nextRoll(cursor)
          if (draw.roll < ENDERMAN_CHASE_TELEPORT_CHANCE) {
            return false
          }
          cursor = draw.seed
        }
        return true
      })

      yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: endermanAt,
        healthPoints: ENDERMAN_HEALTH,
        behaviour: STEADY_ENDERMAN,
      })
      yield* Ref.set(state.targetPosition, playerNear)
      yield* Ref.set(state.rollSeed, seed)
      yield* runFrames(stages, frames, STRIDE)

      expect((yield* soleEntity(roster))?.feetPosition).toStrictEqual(endermanAt)
    }),
  )

  it.effect('the teleport is deterministic: two runs of one scenario land in the same place', () =>
    Effect.gen(function* () {
      // The property `domain/frame-rolls.ts` exists for, applied to the first rule
      // in this repository that draws a roll on the FRAME path rather than on a
      // death. The seed is threaded through the sweep as a local cursor rather
      // than as a `Ref`, so "two runs agree" is also what pins that the cursor is
      // handed back rather than dropped.
      const run = Effect.gen(function* () {
        const { roster, state, stages } = yield* slice(world([]))
        yield* roster.api.spawn({
          kind: ENDERMAN_KIND,
          feetPosition: endermanAt,
          healthPoints: ENDERMAN_HEALTH,
          behaviour: STEADY_ENDERMAN,
        })
        yield* Ref.set(state.targetPosition, playerNear)
        yield* runFrames(stages, 40, STRIDE)

        return {
          position: (yield* soleEntity(roster))?.feetPosition,
          seed: yield* Ref.get(state.rollSeed),
        }
      })

      const first = yield* run
      const second = yield* run

      expect(second).toStrictEqual(first)
      // The run has to actually reach the teleport, or it asserts nothing but
      // that two motionless mobs agree.
      expect(first.position).not.toStrictEqual(endermanAt)
      expect(first.seed).not.toBe(DEFAULT_ROLL_SEED)
    }),
  )

  it.effect('REGRESSION: a mob whose behaviour does not match its kind runs no rule at all', () =>
    Effect.gen(function* () {
      // `repairMobBehaviour` enforces the kind/behaviour agreement on the LOAD
      // path; `spawn` has no such guard, so the frame path enforces it too. The
      // failure this prevents is not cosmetic: dispatching on the tag alone would
      // make a pig carrying a fuse explode, and a creeper carrying a flinch
      // consult the teleport rule instead of burning down.
      const { roster, state, stages } = yield* slice(world([]))

      const pig = EntityKind('pig')
      yield* roster.api.spawn({
        kind: pig,
        feetPosition: endermanAt,
        healthPoints: 10,
        behaviour: STRUCK_ENDERMAN,
      })
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: creeperAt,
        healthPoints: CREEPER_MAX_HEALTH,
        behaviour: STRUCK_ENDERMAN,
      })
      yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: bystanderAt,
        healthPoints: ENDERMAN_HEALTH,
        // Two blocks from the player, which is well inside ignition range.
        behaviour: DORMANT_FUSE,
      })
      yield* daylight(state)
      yield* Ref.set(state.targetPosition, playerNear)

      const before = yield* roster.api.entities
      yield* runFrames(stages, 10, STRIDE)

      // Nothing burned, nothing moved, nothing exploded, and the generator never
      // turned. The roster is the array it was.
      expect(yield* roster.api.entities).toBe(before)
      expect((yield* roster.calls).distinctStepObjects).toBe(1)
      expect(yield* Ref.get(state.rollSeed)).toBe(DEFAULT_ROLL_SEED)
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
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

// ---------------------------------------------------------------------------
// The mining site, end to end: swing, loot, place, cascade
// ---------------------------------------------------------------------------

/**
 * THE LOOP THE PREVIEW'S 「採掘場」 SCREEN IS ABOUT, and the one plan.md §3.11
 * names as the first of its three: 「掘る / 置く / ドロップ確認」.
 *
 * It could not be written before, and the reason is worth keeping: the
 * interactions stage held one rule, `breakBlock`, and pushed the byte it
 * returned into an outbox. So "dig" was real, "drop" was "the block that was
 * there", and "place" did not exist at all — `apps/preview-mining-site/site.ts`
 * carried a `pokeBlock` that wrote the store directly and said so in the HUD.
 *
 * All three run here, through the shipped registrations, in one frame each.
 */
describe('the mining site slice: dig, drop, place', () => {
  const cell: BlockPosition = { x: 4, y: 64, z: 3 }
  const under: BlockPosition = { x: 4, y: 63, z: 3 }

  const requestPlace = (
    state: { readonly pendingPlacements: Ref.Ref<ReadonlyArray<PlacementRequest>> },
    position: BlockPosition,
    heldItem: PlacementRequest['heldItem'],
  ): Effect.Effect<void> =>
    Ref.update(state.pendingPlacements, (queue): ReadonlyArray<PlacementRequest> => [
      ...queue,
      { positionKey: positionKeyOf(position), heldItem },
    ])

  it.effect('a pickaxe turns a stone block into cobblestone in the outbox', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* slice(
        world([
          [under, STONE],
          [cell, STONE],
        ]),
      )

      // Bare-handed first: the swing lands, the block goes, and NOTHING is
      // yielded. That is the tool gate, and it is the half of this change that
      // is invisible from a screenshot.
      yield* requestBreak(state, cell)
      yield* runFrame(stages)
      expect(yield* store.blockAt(cell)).toBe(AIR_BLOCK_ID)
      expect(yield* Ref.get(state.minedItems)).toStrictEqual([])

      // ...and with a pickaxe, against the block below.
      yield* holdWoodenPickaxe(state)
      yield* requestBreak(state, under)
      yield* runFrame(stages)
      expect(yield* Ref.get(state.minedItems)).toStrictEqual(ONE_COBBLESTONE)
    }),
  )

  it.effect('places a block back, spends the item, and the cascade picks it up', () =>
    Effect.gen(function* () {
      const floorLevel: BlockPosition = { x: 4, y: 60, z: 3 }
      const { store, state, stages } = yield* slice(world([[floorLevel, STONE]]))

      yield* requestPlace(state, cell, 'sand')
      yield* runFrame(stages)

      // The item left the stack exactly once...
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual(['sand'])
      // ...and the sand is already one cell lower, because `gameplay:entities`
      // runs `after` `gameplay:interactions` and the placement disturbed the
      // cell UNDER what it wrote.
      expect(yield* store.blockAt(cell)).toBe(AIR_BLOCK_ID)
      expect(yield* store.blockAt({ x: 4, y: 63, z: 3 })).toBe(SAND)
    }),
  )

  // The whole loop, in the order a player does it, in ONE frame — which is the
  // claim the `after` edges make and the thing an array-ordered runner would
  // pass anyway. `test/support/frame-runner.ts` resolves the constraints, so
  // this is evidence about the edges.
  it.effect('dig then place, in one frame, with both outboxes correct', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* slice(
        world([
          [under, STONE],
          [cell, STONE],
        ]),
      )

      yield* holdWoodenPickaxe(state)
      yield* requestBreak(state, cell)
      yield* requestPlace(state, cell, 'sand')
      yield* runFrame(stages)

      expect(yield* Ref.get(state.minedItems)).toStrictEqual(ONE_COBBLESTONE)
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual(['sand'])
      // The sand rests on the stone that was already under the cell, so nothing
      // cascades and the queue is empty again.
      expect(yield* store.blockAt(cell)).toBe(SAND)
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)
    }),
  )

  // WHERE THE CHAIN STOPS, asserted rather than described. `minedItems` and
  // `consumedItems` are lists the host drains: mc-sim's `InventoryService` has
  // `add` and `remove` (`application/inventory-service.ts:49,51`) and this
  // repository cannot call either, because mirroring `InventoryServiceApi`
  // honestly means restating `Inventory`, `RecipeTable`, `CraftGrid`,
  // `RecipeMatch` and `CraftResult` — mc-sim's crafting vocabulary — in a
  // repository with no crafting rule to justify it.
  //
  // What the loot table DID close is the other half of that gap, and it is the
  // half mc-compose's `docs/e2e-triage.md` §4.3 recorded as unanswerable from
  // one repository: the outbox used to carry a `BlockId`, a NUMBER, and
  // `InventoryService.add` takes an `ItemId`, a STRING. It carries item names
  // now, so the remaining distance is a call and not a translation.
  it.effect('the loot chain reaches an outbox and stops there — by name, not by number', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* slice(world([[cell, STONE]]))

      yield* holdWoodenPickaxe(state)
      yield* requestBreak(state, cell)
      yield* runFrame(stages)

      const mined = yield* Ref.get(state.minedItems)
      // A STRING, which is what `InventoryService.add` takes.
      expect(typeof mined[0]?.item).toBe('string')
      expect(mined[0]?.item).toBe('cobblestone')
      // And nothing in this repository holds the total. The frame state has no
      // inventory; `test/stage-registration.test.ts` pins the whole key list.
      expect(Object.keys(state)).not.toContain('inventory')
    }),
  )
})
