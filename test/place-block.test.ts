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
  PLACEABLE_ITEM_TYPES,
  validSpawnSurface,
  type BlockType,
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
import { makeChunkStoreDouble, SAND, STONE, WATER, world } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import type { MobBehaviour } from '../domain/entities/mob-frame'
import { runFrame } from './support/frame-runner'

const LAVA = 11
const TORCH = 14
const SNOW = 7
const DIRT = 3
const RAIL = 31
const PRESSURE_PLATE = 34

/**
 * `SUPPORT_SENSITIVE_BLOCK_TYPES` in `domain/interactions/place-block.ts`, which
 * the rule keeps private. Restated here so the test can ask a question about the
 * WHOLE set rather than about the members somebody thought to list — the count
 * is the point, and it is the count that changes when kernel grows a row.
 */
const SUPPORT_SENSITIVE_TYPES: ReadonlyArray<BlockType> = [
  'torch',
  'pressure_plate',
  'rail',
  'powered_rail',
  'sapling',
  'dandelion',
  'poppy',
  'brown_mushroom',
  'red_mushroom',
  'tall_grass',
  'fern',
  'sugar_cane',
  'cactus',
  'lily_pad',
]

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

  /*
   * THE REFERENCE HAS A SECOND TABLE FOR THIS ONE FUNCTION, and the rows below
   * are the ones the first table does not contain:
   * `<reference-impl>/packages/world/test/block-utils.test.ts:88-121`.
   *
   * Two oracles for one predicate is itself the reason to port both. The table
   * above brackets the X threshold at 1.29 / 1.31 and therefore pins
   * `PLAYER_HALF_WIDTH`; every one of its Y rows is a block far above the player
   * (`y: 3`), so nothing in it says anything about the VERTICAL comparison at
   * all. The reference's second table has the vertical bracket the first is
   * missing (`:115-122`), and it is EXCLUSIVE: a block exactly one cube below
   * the feet sits at a centre gap of exactly `BLOCK_HALF + PLAYER_HALF_HEIGHT`,
   * and `<` refuses it. Lowering the player by a tenth brings it into reach.
   *
   * WHAT THAT BRACKET PINS IS THE `<`, AND NOT THE 0.9 — measured, because the
   * obvious reading is wrong and was written here before it was checked. Both
   * sides of that comparison contain the half-height (the player's centre is
   * feet + H, the threshold is BLOCK_HALF + H), so H cancels: setting it to 0.45
   * leaves BOTH rows green and fails only the constant assertion at the top of
   * this describe. The reference's own table has the same blind spot. The rows
   * are worth having anyway — flipping `<` to `<=` fails the first of them and
   * nothing else in this repository — but the VALUE 0.9 is pinned by the
   * transcription assertion alone, which is why that assertion is not redundant.
   *
   * The diagonal row is the other thing a single-axis table cannot say: the test
   * is three independent axis comparisons ANDed, not a radius, so a block
   * touching the player at a corner overlaps. It is the row that fails when the
   * Z extent is changed independently of the X one.
   */
  const secondOracle: ReadonlyArray<readonly [string, BlockPosition, Position, boolean]> = [
    // `:92-95`. Block (-1, 0, -1) spans [-1,0]×[0,1]×[-1,0]; its + faces touch
    // the player's box on both horizontal axes at once.
    ['the block the player is standing inside — a corner touch still overlaps', { x: -1, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }, true],
    // `:106-108`. The cell the feet are in.
    ['a block at the player’s feet level overlaps', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, true],
    // `:110-113`. The NEAREST side cell that clears: block centre 1.5 against a
    // threshold of 0.8. (The reference's comment on this row says the gap is
    // 1.2; the arithmetic its own code does gives 1.5. What is ported is the
    // EXPECTATION, not the annotation.) The table above only has x = 2.
    ['the nearest side block that clears the horizontal half-extent', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, false],
    // `:115-118`. THE VERTICAL BRACKET — it pins the `<` and not the 0.9, for
    // the reason measured in the note above.
    ['one cube below just clears, because the y comparison is exclusive', { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 0 }, false],
    // `:119-121`. The other side of the same threshold.
    ['lowering the player a tenth brings that same cube into reach', { x: 0, y: -1, z: 0 }, { x: 0, y: -0.1, z: 0 }, true],
    // `:97-99`. Well outside on both horizontal axes.
    ['a block well outside the footprint does not overlap', { x: 5, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, false],
  ]

  for (const [name, block, player, expected] of secondOracle) {
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
// The reference's own support oracle
// ---------------------------------------------------------------------------

/*
 * PORTED ORACLE.
 * `<reference-impl>/packages/world/domain/block-support.test.ts:10-33` — the two
 * case tables the reference feeds to `isSupportSensitiveBlock` and
 * `canBlockStaySupported`.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ROWS ARE PUT TO THE PREDICATES AND NOT TO `placeBlock`
 * ---------------------------------------------------------------------------
 *
 * They were written against `placeBlock` first, and `pnpm typecheck` refused
 * them. `PlaceRequest.heldItem` is a `PlaceableItemType` — `ItemType & BlockType`
 * — and of the FOURTEEN block types `SUPPORT_SENSITIVE_BLOCK_TYPES` names,
 * exactly ONE (`torch`) is in that intersection. Rail, pressure plate, powered
 * rail and all ten plants have no item form in this build, so no caller can hold
 * one and no `placeBlock` call can reach the support arm with one. That fact is
 * asserted below rather than worked around with a cast: a cast would have made
 * six green tests that no production path can execute.
 *
 * So the rows go to the two predicates the rule ANDs — `isSupportSensitive`
 * (this file) and `canSupportAttachments` (`domain/block-vocabulary.ts`) — both
 * of which take a `BlockId`, which is a byte and has no roster gate. That is
 * where the reference's `canBlockStaySupported` lives too; `block-support.ts`
 * takes a `BlockType` and knows nothing about items either.
 *
 * ---------------------------------------------------------------------------
 * AND WHY THE TABLE IS SPLIT IN TWO
 * ---------------------------------------------------------------------------
 *
 * `canBlockStaySupported` (`block-support.ts:96-101`) has two arms:
 *
 *     if (!isSupportSensitiveBlock(blockType)) return true
 *     const supportRule = SUPPORT_RULES.get(blockType)
 *     if (supportRule) return supportRule(blockBelow)          // <- PER BLOCK
 *     return !NON_SUPPORTING_BLOCK_TYPES.has(blockBelow)       // <- the fallback
 *
 * `domain/interactions/place-block.ts` ported the FALLBACK and applies it to
 * every support-sensitive block. The rows in this describe are the reference's
 * rows that reach that same fallback in the reference too, so they are a port in
 * the ordinary sense. The rows that reach `SUPPORT_RULES` are F7 below, and they
 * do NOT agree.
 */
describe('the reference\u2019s support table, on the rows that share its rule', () => {
  // `block-support.test.ts:10-17`, the membership half. Two of the reference's
  // six rows (WHEAT_CROP, POTATO_CROP) are crops, which this build's roster does
  // not have and `docs/testing.md` §3-2 counts under item use.
  it.effect('agrees about which blocks are support-sensitive at all', () =>
    Effect.sync(() => {
      expect(isSupportSensitive(TORCH)).toBe(true)
      expect(isSupportSensitive(PRESSURE_PLATE)).toBe(true)
      expect(isSupportSensitive(RAIL)).toBe(true)
      expect(isSupportSensitive(STONE)).toBe(false)
    }),
  )

  /*
   * THIRTEEN OF THE FOURTEEN CANNOT BE HELD, and that is the reason the rows
   * below are predicate-level. It is asserted rather than described because it
   * is the thing that will change: `domain/interactions/block-loot.ts` already
   * records that a sapling 「cannot yield a sapling you can carry until kernel
   * itemises it」, and the day kernel does, this test fails and F7 below stops
   * being dormant on the same commit.
   */
  it.effect('only the torch of the fourteen support-sensitive types is a placeable item today', () =>
    Effect.sync(() => {
      const placeable: ReadonlySet<string> = new Set<string>(PLACEABLE_ITEM_TYPES)
      const heldToday = SUPPORT_SENSITIVE_TYPES.filter((type) => placeable.has(type))

      expect(heldToday).toStrictEqual(['torch'])
      // ...and every one of the other thirteen IS support-sensitive, so the arm
      // they would take is written and unreachable rather than absent.
      for (const type of SUPPORT_SENSITIVE_TYPES) {
        expect(isSupportSensitive(blockIdOf(type) ?? -1)).toBe(true)
      }
    }),
  )

  // `block-support.test.ts:20-25`. RAIL and PRESSURE_PLATE have no entry in
  // `SUPPORT_RULES`, so the reference answers them with the same negative list
  // this repository mirrors as `canSupportAttachments`. All six rows agree, and
  // the composition below — sensitive AND supported — is `placementVerdict`'s
  // support branch with the store calls taken out.
  const sharedRule: ReadonlyArray<readonly [string, number, number, boolean]> = [
    ['a pressure plate on stone', PRESSURE_PLATE, STONE, true],
    ['a pressure plate on air', PRESSURE_PLATE, AIR_BLOCK_ID, false],
    ['a rail on stone', RAIL, STONE, true],
    ['a rail on air', RAIL, AIR_BLOCK_ID, false],
    // The two rows worth having: a rail is not held up by a liquid, and it is
    // not held up by another attachment either.
    ['a rail on water', RAIL, WATER, false],
    ['a rail on a pressure plate', RAIL, PRESSURE_PLATE, false],
  ]

  for (const [name, held, support, stays] of sharedRule) {
    it.effect(`${name} — ${stays ? 'stays' : 'falls'}`, () =>
      Effect.sync(() => {
        expect(isSupportSensitive(held)).toBe(true)
        expect(canSupportAttachments(support)).toBe(stays)
      }),
    )
  }

  // The torch is the one row that can be run end to end, so it is: the two
  // predicates above and the rule that reads them give the same answer.
  it.effect('and the one type that CAN be held gives the same answer through the whole rule', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[below, WATER]])

      expect(isSupportSensitive(TORCH)).toBe(true)
      expect(canSupportAttachments(WATER)).toBe(false)
      expect(yield* placeBlock(store.api, { position: target, heldItem: 'torch' })).toStrictEqual({
        _tag: 'Unsupported',
        support: WATER,
      })
    }),
  )
})

/*
 * F7 — A CONTRADICTION, DORMANT, PINNED RATHER THAN FIXED.
 *
 * `<reference-impl>/packages/world/domain/block-support.ts:73-89` builds
 * `SUPPORT_RULES`, a per-block-type map consulted BEFORE the negative list:
 *
 *     LILY_PAD     -> blockBelow === 'WATER'
 *     CACTUS       -> SAND | CACTUS
 *     SUGAR_CANE   -> DIRT | GRASS | SAND | SUGAR_CANE
 *     the seven surface plants -> DIRT | GRASS | FARMLAND
 *     the three crops          -> FARMLAND
 *
 * `domain/interactions/place-block.ts` carries all ten of those block types in
 * its `SUPPORT_SENSITIVE_BLOCK_TYPES` and then answers every one of them with
 * the FALLBACK arm — `canSupportAttachments`, kernel's mirror of
 * `NON_SUPPORTING_BLOCK_TYPES`. In the reference no lily pad, cactus, sugar cane
 * or surface plant ever reaches that arm.
 *
 * The file's header does not record this as a decision. It says
 * `canBlockStaySupported` is 「checked at PLACEMENT time in the reference」 and
 * that 「Only the placement half is here」 — the half it names as absent is the
 * MAINTENANCE sweep, not the per-block map. It separately defers four rules from
 * `block-service-place-plan.ts:208-214` (mushroom light, sugar cane's ADJACENT
 * water, cactus's four air sides, doors), which are a different mechanism in a
 * different file and do not cover these rows.
 *
 * THE WORST ROW IS THE FIRST. Water is in `NON_SUPPORTING_IDS`, and water is the
 * only thing that supports a lily pad — so under this rule a lily pad is refused
 * on the one cell it belongs on and allowed on stone. That is not a deferral in
 * the direction of doing less; it is wrong in both directions at once.
 *
 * IT IS DORMANT, WHICH IS WHY NOTHING HAS SEEN IT. None of the ten types is a
 * `PlaceableItemType`, so no `placeBlock` call can reach the wrong answer today
 * (the describe above pins that, and pins the day it stops being true). The
 * predicates are wrong now; the game is not wrong yet. A dormant contradiction
 * is still worth a test, because the roster row that wakes it will be added by
 * somebody who is not reading this file.
 *
 * These tests pin the CURRENT behaviour, in the shape `test/preview-findings.test.ts`
 * established for exactly this situation: 「直すと finding は『固定される』のでは
 * なく静かに消える」. They FAIL when the divergence is fixed, by design, and each
 * names the reference row it contradicts so the fix is an edit here too.
 *
 * NOT FIXED HERE because the fix is a new table and the table has an owner
 * question attached: kernel's registry has no `supportRule` column
 * (`domain/interactions/place-block.ts` quotes mc-kernel's own note that it is
 * `PENDING_CAPABILITIES`), so writing one here is this repository inventing a
 * kernel flag — which that file's own `SUPPORT_SENSITIVE_BLOCK_TYPES` comment
 * calls 「worse than holding the set where the rule that reads it lives」.
 */
describe('F7 — the per-block support rules were not ported, and the fallback disagrees with four of them', () => {
  /**
   * `placementVerdict`'s support branch, for a type nobody can hold yet.
   *
   * A RECONSTRUCTION, and its one weakness is stated rather than hidden: because
   * the ten types cannot be put into a `PlaceRequest`, this composes the rule's
   * two predicates instead of calling the rule. A fix that added a per-block
   * table INSIDE `placementVerdict` and left both predicates alone would not
   * turn these pins red on its own.
   *
   * The guard below is what narrows that. It runs `wouldStay` and the real
   * `placeBlock` against each other on `torch` — the one support-sensitive type
   * that fits through the type — on both sides of the answer, so the
   * reconstruction cannot drift from the rule at the only point where both can
   * be evaluated. The residual gap is a fix applied to the plants and NOT to the
   * torch; the day the plants become placeable, `only the torch of the fourteen`
   * above fails and this whole describe has to be revisited anyway, which is the
   * coupling that closes it.
   */
  const wouldStay = (held: BlockType, support: number): boolean =>
    !isSupportSensitive(blockIdOf(held) ?? -1) || canSupportAttachments(support)

  it.effect('the reconstruction above agrees with the real rule, on the one type that fits through it', () =>
    Effect.gen(function* () {
      const supported = yield* storeWith([[below, STONE]])
      expect(wouldStay('torch', STONE)).toBe(true)
      expect((yield* placeBlock(supported.api, { position: target, heldItem: 'torch' }))._tag).toBe(
        'Placed',
      )

      const unsupported = yield* storeWith([[below, WATER]])
      expect(wouldStay('torch', WATER)).toBe(false)
      expect(
        (yield* placeBlock(unsupported.api, { position: target, heldItem: 'torch' }))._tag,
      ).toBe('Unsupported')
    }),
  )

  // `block-support.test.ts:32` asserts LILY_PAD on WATER IS supported.
  it.effect('pins the current behaviour: a lily pad on water would be REFUSED, so it could go nowhere', () =>
    Effect.sync(() => {
      expect(canSupportAttachments(WATER)).toBe(false)
      expect(wouldStay('lily_pad', WATER)).toBe(false)
    }),
  )

  it.effect('pins the current behaviour: a lily pad on stone would be ALLOWED, which the reference refuses', () =>
    Effect.sync(() => {
      expect(wouldStay('lily_pad', STONE)).toBe(true)
    }),
  )

  // `block-support.test.ts:31` asserts CACTUS on DIRT is NOT supported.
  it.effect('pins the current behaviour: a cactus on dirt would be ALLOWED, which the reference refuses', () =>
    Effect.sync(() => {
      expect(wouldStay('cactus', DIRT)).toBe(true)
    }),
  )

  // The seven surface plants take `DIRT | GRASS | FARMLAND` in the reference
  // (`block-support.ts:85-88`). Stone is in none of them.
  it.effect('pins the current behaviour: a sapling on stone would be ALLOWED, which the reference refuses', () =>
    Effect.sync(() => {
      expect(wouldStay('sapling', STONE)).toBe(true)
    }),
  )

  // THE ROWS THAT AGREE BY ACCIDENT, kept so that a fix can be told apart from a
  // regression. Both reach `SUPPORT_RULES` in the reference and the fallback
  // here, and both happen to give the same answer — which is exactly why the
  // four above went unnoticed.
  it.effect('sugar cane on sand and a sapling on dirt agree with the reference, by coincidence', () =>
    Effect.sync(() => {
      expect(wouldStay('sugar_cane', SAND)).toBe(true)
      expect(wouldStay('sapling', DIRT)).toBe(true)
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
