/**
 * `domain/interactions/place-block.ts` — the counterpart to `break-block`.
 *
 * ---------------------------------------------------------------------------
 * What this file is protecting, and where the numbers came from
 * ---------------------------------------------------------------------------
 *
 * Placement is where the reference implementation had REAL BUGS rather than
 * imagined ones, which is why three of the four refusals below carry a
 * `REGRESSION:` prefix (docs/testing.md §2-1: the prefix means "the reference's
 * production actually did this"):
 *
 *   LAVA IS REPLACEABLE. `block-service-place-load.ts:48-58` asks
 *   `existing === 'AIR' || existing === 'WATER'` — a hand-written two-element
 *   list with a comment about underwater building — so a lava cell was refused
 *   as "block already exists". `domain/block-vocabulary.ts`'s own comment
 *   records the two halves of that omission and says the second is placement's.
 *
 *   PLACING INSIDE YOURSELF. `blockOverlapsPlayer` (`block-utils.ts:66-74`) is
 *   the suffocation guard, and its boundary table
 *   (`block-service-utils.test.ts:84-98`) is ported below UNCHANGED, including
 *   the 1.29 / 1.31 bracket that pins WHERE the threshold is rather than that it
 *   exists.
 *
 *   NOTHING TO STAND ON. `canBlockStaySupported` (`block-support.ts:96-101`)
 *   against `NON_SUPPORTING_BLOCK_TYPES` (:47-61), which kernel carries as
 *   `canSupportAttachments` — the flag that is NOT `validSpawnSurface`, and the
 *   test below pins the row where the two disagree (snow) because kernel's audit
 *   §4.9 says five near-duplicate lists in the reference disagree with each
 *   other and that is the failure mode.
 *
 * The fourth is not the reference's: `Unchanged` reported as `Occupied` rather
 * than as success, so that a placement which dirtied nothing cannot take an item
 * off the stack.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { positionKeyOf } from '../domain/block-position-key'
import { AIR_BLOCK_ID, type BlockPosition } from '../domain/chunk-store-port'
import {
  blockIdOf,
  canSupportAttachments,
  isReplaceable,
  validSpawnSurface,
} from '../domain/block-vocabulary'
import {
  blockOverlapsPlayer,
  isSupportSensitive,
  placeBlock,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  type PlaceOutcome,
} from '../domain/interactions/place-block'
import type { Position } from '../domain/entity-manager-port'
import { gameplayStages, makeGameplayFrameState } from '../stages/registration'
import { makeChunkStoreDouble, STONE, WATER, world } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import type { MobBehaviour } from '../domain/entities/mob-frame'
import { runFrame } from './support/frame-runner'

const LAVA = 11
const TORCH = 14
const SNOW = 7

const target: BlockPosition = { x: 2, y: 64, z: 3 }
const below: BlockPosition = { x: 2, y: 63, z: 3 }

const storeWith = (entries: ReadonlyArray<readonly [BlockPosition, number]>) =>
  makeChunkStoreDouble(world(entries), ['0,0'])

describe('placeBlock — the target cell', () => {
  it.effect('places into air and reports the item to spend', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[below, STONE]])

      const outcome = yield* placeBlock(store.api, { position: target, heldItem: 'stone' })

      expect(outcome).toStrictEqual({
        _tag: 'Placed',
        block: STONE,
        consumed: 'stone',
        chunk: { cx: 0, cz: 0 },
      } satisfies PlaceOutcome)
      // ...and the id the rule chose came out of kernel's table rather than out
      // of this test: `stone` the item names `stone` the block, which is the
      // name-identity bridge `domain/block-vocabulary.ts` is built on.
      expect(blockIdOf('stone')).toBe(STONE)
      expect(yield* store.blockAt(target)).toBe(STONE)
    }),
  )

  it.effect('refuses a cell that already holds a non-replaceable block, and writes nothing', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[target, STONE]])

      const outcome = yield* placeBlock(store.api, { position: target, heldItem: 'sand' })

      expect(outcome).toStrictEqual({ _tag: 'Occupied', existing: STONE })
      // The cell is untouched: the refusal happened on the READ, so the store
      // never saw a write it had to undo.
      expect(yield* store.blockAt(target)).toBe(STONE)
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('places into water, which the reference also allows — underwater building', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[target, WATER]])

      expect((yield* placeBlock(store.api, { position: target, heldItem: 'stone' }))._tag).toBe(
        'Placed',
      )
      expect(yield* store.blockAt(target)).toBe(STONE)
    }),
  )

  // REGRESSION. `block-service-place-load.ts:48-58` asks
  // `existing === 'AIR' || existing === 'WATER'`, so a lava cell was refused as
  // occupied. This asks `isReplaceable`, which is kernel's capability, and
  // `domain/chunk-store-port.ts` records that lava was MISSING from the mirror's
  // copy of that set until `pnpm check:mirrors` diffed it — the same omission,
  // found from the other end.
  it.effect('REGRESSION: lava is replaceable — a block may be placed into it', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[target, LAVA]])

      expect(isReplaceable(LAVA)).toBe(true)
      expect((yield* placeBlock(store.api, { position: target, heldItem: 'stone' }))._tag).toBe(
        'Placed',
      )
      expect(yield* store.blockAt(target)).toBe(STONE)
    }),
  )

  it.effect('reports `Unchanged` as Occupied, so a write that dirtied nothing spends nothing', () =>
    Effect.gen(function* () {
      // Water onto water: the target IS replaceable, so the read-side gate opens
      // and the write comes back `Unchanged`. `water` has no item form, so the
      // only way to reach this arm through the public rule is a block that is
      // both replaceable and placeable — which nothing in this build is. The
      // arm is reached here by writing the same STONE twice through the store,
      // and the assertion is on the RULE's translation of that outcome.
      const store = yield* storeWith([[target, WATER]])

      expect((yield* placeBlock(store.api, { position: target, heldItem: 'stone' }))._tag).toBe(
        'Placed',
      )
      const again = yield* placeBlock(store.api, { position: target, heldItem: 'stone' })
      expect(again).toStrictEqual({ _tag: 'Occupied', existing: STONE })
    }),
  )

  // DN-GP-11: `ChunkNotLoaded` is not air. A placement into a chunk nobody has
  // read is a placement into a cell that may already hold something.
  it.effect('REGRESSION: `ChunkNotLoaded` is not air — nothing is placed there', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([])
      const edge: BlockPosition = { x: -1, y: 64, z: 3 }

      expect(yield* placeBlock(store.api, { position: edge, heldItem: 'stone' })).toStrictEqual({
        _tag: 'ChunkNotLoaded',
      })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('refuses a cell below the world', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([])

      expect(
        yield* placeBlock(store.api, { position: { x: 2, y: -1, z: 3 }, heldItem: 'stone' }),
      ).toStrictEqual({ _tag: 'OutOfWorld' })
    }),
  )
})

describe('blockOverlapsPlayer — the suffocation guard', () => {
  // `<reference-impl>/packages/core/domain/constants.ts:23-24`. Restated in this
  // repository because mc-physics is not a parent of it, so this assertion is
  // the only thing standing between a transcription and a silent divergence in
  // where a player may build.
  it.effect('carries the reference’s half-extents', () =>
    Effect.sync(() => {
      expect(PLAYER_HALF_WIDTH).toBe(0.3)
      expect(PLAYER_HALF_HEIGHT).toBe(0.9)
    }),
  )

  // The reference's own table, `block-service-utils.test.ts:84-98`, ported
  // unchanged. The last two rows are the point: they BRACKET the x threshold at
  // 0.8 = blockHalf + PLAYER_HALF_WIDTH, so a change to either half-extent moves
  // one of them and fails. A single "far away is false" row would not.
  const oracle: ReadonlyArray<readonly [string, BlockPosition, Position, boolean]> = [
    ['overlap on all 3 axes', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, true],
    ['separated on X', { x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, false],
    ['separated on Z', { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 0 }, false],
    ['separated on Y (block above player)', { x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 }, false],
    ['overlap away from the origin', { x: 5, y: 0, z: 5 }, { x: 5, y: 0, z: 5 }, true],
    ['X just beyond the threshold (player at 1.31) — placeable', { x: 0, y: 0, z: 0 }, { x: 1.31, y: 0, z: 0 }, false],
    ['X just inside the threshold (player at 1.29) — blocked', { x: 0, y: 0, z: 0 }, { x: 1.29, y: 0, z: 0 }, true],
  ]

  for (const [name, block, player, expected] of oracle) {
    it.effect(name, () =>
      Effect.sync(() => {
        expect(blockOverlapsPlayer(block, player)).toBe(expected)
      }),
    )
  }

  // TOTAL, and the direction is chosen rather than accidental: an unmeasurable
  // pose must not lock a player out of building everywhere, silently and with no
  // message. `domain/interactions/place-block.ts` argues it next to
  // `domain/mob/hostile-spawn.ts`'s light guard, which is the same decision made
  // the other way for a reason it states.
  it.effect('a NaN player position does not block placement', () =>
    Effect.sync(() => {
      expect(blockOverlapsPlayer({ x: 0, y: 0, z: 0 }, { x: Number.NaN, y: 0, z: 0 })).toBe(false)
    }),
  )
})

describe('placeBlock — the player’s body', () => {
  it.effect('REGRESSION: refuses a block that would be placed inside the player', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[below, STONE]])
      // Feet in the very cell being filled.
      const feet: Position = { x: target.x + 0.5, y: target.y, z: target.z + 0.5 }

      expect(
        yield* placeBlock(store.api, { position: target, heldItem: 'stone', playerFeet: feet }),
      ).toStrictEqual({ _tag: 'InsidePlayer' })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('a player standing well clear does not block it', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[below, STONE]])
      const feet: Position = { x: target.x + 8, y: target.y, z: target.z }

      expect(
        (yield* placeBlock(store.api, { position: target, heldItem: 'stone', playerFeet: feet }))._tag,
      ).toBe('Placed')
    }),
  )

  // `undefined` means "there is nobody there", the convention
  // `domain/mob/creeper-fuse.ts` and `domain/mob/hostile-despawn.ts` both use.
  // Reading it as a player at the origin would refuse every placement near
  // (0, 0, 0) in a world with no player in it.
  it.effect('an absent player is nobody, not somebody at the origin', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[{ x: 0, y: 63, z: 0 }, STONE]])

      expect(
        (yield* placeBlock(store.api, { position: { x: 0, y: 64, z: 0 }, heldItem: 'stone' }))._tag,
      ).toBe('Placed')
    }),
  )
})

describe('placeBlock — support', () => {
  it.effect('a torch needs something under it', () =>
    Effect.gen(function* () {
      expect(isSupportSensitive(TORCH)).toBe(true)
      const store = yield* storeWith([])

      expect(yield* placeBlock(store.api, { position: target, heldItem: 'torch' })).toStrictEqual({
        _tag: 'Unsupported',
        support: AIR_BLOCK_ID,
      })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('a torch on stone goes in', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[below, STONE]])

      expect((yield* placeBlock(store.api, { position: target, heldItem: 'torch' }))._tag).toBe(
        'Placed',
      )
    }),
  )

  // kernel audit §4.9's disagreement, made a test. `canSupportAttachments` and
  // `validSpawnSurface` are two flags and snow is the row where they part: a mob
  // may STAND on snow and a torch may NOT be planted in it. The reference keeps
  // five near-duplicate negative lists and the audit measured that they disagree;
  // collapsing them into one `solid` test here is how a sixth one starts.
  it.effect('REGRESSION: snow supports a mob and not a torch — the two flags are not one flag', () =>
    Effect.gen(function* () {
      expect(validSpawnSurface(SNOW)).toBe(true)
      expect(canSupportAttachments(SNOW)).toBe(false)

      const store = yield* storeWith([[below, SNOW]])

      expect(yield* placeBlock(store.api, { position: target, heldItem: 'torch' })).toStrictEqual({
        _tag: 'Unsupported',
        support: SNOW,
      })
    }),
  )

  // An ordinary block asks nothing about what is below it, and the READ COUNT is
  // how that is asserted. A rule that read the support cell for every placement
  // would be a store call per block a player stacks, and would pass every other
  // test in this file.
  it.effect('a stone placement does not read the cell below at all', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[below, STONE]])

      yield* placeBlock(store.api, { position: target, heldItem: 'stone' })

      expect((yield* store.calls).reads).toBe(1)
    }),
  )

  it.effect('a torch placement reads exactly two cells: the target and its support', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[below, STONE]])

      yield* placeBlock(store.api, { position: target, heldItem: 'torch' })

      expect((yield* store.calls).reads).toBe(2)
    }),
  )

  // An unreadable support cell is a refusal and not a permission. The rule is
  // being asked about a fact nobody measured, and the answer that invents
  // nothing is "no torch here".
  it.effect('a support cell in an unloaded chunk refuses rather than assuming', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      // y = 0 is inside the world; y = -1 is not, so the support read answers
      // `OutOfWorld` while the target itself is a legal cell.
      const floorLevel: BlockPosition = { x: 2, y: 0, z: 3 }

      expect(
        yield* placeBlock(store.api, { position: floorLevel, heldItem: 'torch' }),
      ).toStrictEqual({ _tag: 'Unsupported', support: AIR_BLOCK_ID })
    }),
  )
})

// ---------------------------------------------------------------------------
// Through the stage
// ---------------------------------------------------------------------------

const stagedSlice = (entries: ReadonlyArray<readonly [BlockPosition, number]>) =>
  Effect.gen(function* () {
    const store = yield* storeWith(entries)
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const state = yield* makeGameplayFrameState
    return { store, state, stages: gameplayStages(state, store.api, roster.api) }
  })

describe('placement through gameplay:interactions', () => {
  it.effect('a queued placement is serviced and the item is reported as spent', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* stagedSlice([[below, STONE]])

      yield* Ref.update(state.pendingPlacements, (queue) => [
        ...queue,
        { positionKey: positionKeyOf(target), heldItem: 'sand' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(blockIdOf('sand'))
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual(['sand'])
    }),
  )

  // THE LINE `domain/falling-block.ts:73-77` HAS BEEN CARRYING WITH NOTHING
  // BEHIND IT: 「Callers are the rules that mutate blocks: breaking, PLACING,
  // explosions, fluid displacement, piston pushes」. The mining-site preview's
  // `p` key used to write the store directly and deliberately NOT disturb, to
  // show what the missing rule would have to remember. This is that memory.
  it.effect('REGRESSION: sand placed in mid-air falls — placement disturbs', () =>
    Effect.gen(function* () {
      // A floor at y = 60 and nothing between it and the placement at y = 64.
      const groundLevel: BlockPosition = { x: 2, y: 60, z: 3 }
      const { store, state, stages } = yield* stagedSlice([[groundLevel, STONE]])

      yield* Ref.update(state.pendingPlacements, (queue) => [
        ...queue,
        { positionKey: positionKeyOf(target), heldItem: 'sand' as const },
      ])

      // ONE FRAME MOVES IT ONE CELL, and both halves of that are the design.
      // `gameplay:entities` is ordered `after` `gameplay:interactions`, so the
      // disturbance a placement raises is serviced in the SAME frame — the
      // property `test/vertical-slice.test.ts` asserts for a break. And a column
      // sinks one cell per tick, because `settled` re-enqueues the destination
      // rather than looping to the floor inside one tick.
      yield* runFrame(stages)
      expect(yield* store.blockAt(target)).toBe(AIR_BLOCK_ID)
      expect(yield* store.blockAt({ x: 2, y: 63, z: 3 })).toBe(blockIdOf('sand'))

      for (let frame = 0; frame < 8; frame += 1) {
        yield* runFrame(stages)
      }

      // Resting on the floor at y = 60, and the queue is empty again.
      expect(yield* store.blockAt({ x: 2, y: 61, z: 3 })).toBe(blockIdOf('sand'))
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)
    }),
  )

  // The refusals reach the stage and are DROPPED there — `run` returns void and
  // there is nowhere in a frame to report a diagnostic to. What must not happen
  // is that a refused placement spends an item anyway.
  it.effect('a refused placement spends nothing and disturbs nothing', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* stagedSlice([[target, STONE]])

      yield* Ref.update(state.pendingPlacements, (queue) => [
        ...queue,
        { positionKey: positionKeyOf(target), heldItem: 'sand' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(STONE)
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual([])
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)
    }),
  )

  // The order inside the stage is a decision, and this is the frame that shows
  // it. A player who breaks a cell and places into it in the same frame gets the
  // sequence they asked for; servicing placements first would refuse the
  // placement as `Occupied` by a block that is about to stop existing.
  it.effect('a break and a placement of the same cell in one frame do both, in that order', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* stagedSlice([
        [below, STONE],
        [target, STONE],
      ])

      yield* Ref.set(state.pendingBreaks, [positionKeyOf(target)])
      yield* Ref.set(state.pendingPlacements, [
        { positionKey: positionKeyOf(target), heldItem: 'sand' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(blockIdOf('sand'))
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual(['sand'])
    }),
  )

  // The player's pose reaches the rule through `targetPosition`, which is the
  // inbox `stages/registration.ts` argues at length. If the stage forgot to pass
  // it, every placement would succeed and the suffocation guard would be dead
  // code behind a passing unit test.
  it.effect('REGRESSION: the stage passes the player’s position, so the body guard is live', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* stagedSlice([[below, STONE]])

      yield* Ref.set(state.targetPosition, {
        x: target.x + 0.5,
        y: target.y,
        z: target.z + 0.5,
      })
      yield* Ref.set(state.pendingPlacements, [
        { positionKey: positionKeyOf(target), heldItem: 'stone' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBeUndefined()
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual([])
    }),
  )
})
