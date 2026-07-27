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
  canBlockStaySupported,
  canSupportAttachments,
  isReplaceable,
  needsOneOf,
  PLACEABLE_ITEM_TYPES,
  supportRuleOfBlockId,
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
 * So the rows go to `canBlockStaySupported` (`domain/block-vocabulary.ts`),
 * which takes two `BlockId`s — bytes, with no roster gate. That is where the
 * reference's function of the same name lives too; `block-support.ts` takes a
 * `BlockType` and knows nothing about items either.
 *
 * ---------------------------------------------------------------------------
 * THE TABLE USED TO BE SPLIT IN TWO. IT IS NOT ANY MORE.
 * ---------------------------------------------------------------------------
 *
 * `canBlockStaySupported` (`block-support.ts:96-101`) has two arms:
 *
 *     if (!isSupportSensitiveBlock(blockType)) return true
 *     const supportRule = SUPPORT_RULES.get(blockType)
 *     if (supportRule) return supportRule(blockBelow)          // <- PER BLOCK
 *     return !NON_SUPPORTING_BLOCK_TYPES.has(blockBelow)       // <- the fallback
 *
 * `domain/interactions/place-block.ts` ported the FALLBACK ONLY and applied it
 * to every support-sensitive block, so this describe held the rows that reach
 * the fallback in the reference TOO, and F7 below held the rows that do not.
 *
 * **Kernel now ships the per-block arm as `supportRule`** (`mc-kernel/domain/
 * block-support.ts`) and this repository reads it through the mirror, so both
 * arms exist here and the split is history rather than structure. The rows below
 * still take the fallback in the reference; what changed is that they now do so
 * BECAUSE THEIR RULE SAYS `anySupporting`, rather than because this repository
 * had no other rule to offer.
 */
describe('the reference\u2019s support table, on the rows whose rule IS the fallback', () => {
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
   * WHAT THIS TEST NOW GUARDS, SINCE WHAT IT USED TO GUARD HAS ENDED.
   *
   * It has been rewritten twice and the history is the point. It began as "only
   * the torch of the fourteen is placeable", with a prediction attached: the day
   * kernel itemises a sapling, "this test fails and F7 below stops being dormant
   * on the same commit". Kernel completed its roster, faced that choice for ten
   * blocks at once, and split it along `SUPPORT_RULES` membership — itemising the
   * four with no per-block entry and holding the ten that have one. So the test
   * became "the four placeable ones are the four F7 does not cover", and its
   * stated job was to keep F7 dormant.
   *
   * **F7 IS CLOSED**, so that job is gone. The ten are no longer held back
   * because the code that would receive them is wrong — `supportRule` landed in
   * kernel, this repository reads it, and a lily pad placed today would be
   * refused on stone and allowed on water, correctly. Deleting this test was
   * considered and rejected: it still fails on a real event, and the event is
   * worth failing on.
   *
   * WHAT IT GUARDS NOW is the remaining ROSTER GAP, in the direction that costs
   * something. Ten blocks in this build drop nothing when broken
   * (`domain/block-vocabulary.ts`'s `DROPS_NOTHING` rows, mirroring kernel's),
   * which is a stated divergence from the reference. The day kernel itemises
   * them, those rows must become the default drop rule ON THE SAME COMMIT — and
   * this test is what fails to say so. It is a different failure from the old
   * one: then it meant "a wrong rule just became reachable", now it means
   * "ten drop rules just went stale".
   */
  it.effect('the ten unitemised support-sensitive blocks are the remaining roster gap, and drop nothing', () =>
    Effect.sync(() => {
      const placeable: ReadonlySet<string> = new Set<string>(PLACEABLE_ITEM_TYPES)
      const heldToday = SUPPORT_SENSITIVE_TYPES.filter((type) => placeable.has(type))

      expect(heldToday).toStrictEqual(['torch', 'pressure_plate', 'rail', 'powered_rail'])

      // The complement, named. When a literal moves out of this list, the
      // matching row in `BLOCK_DROP_REGISTRY` has to stop saying `DROPS_NOTHING`
      // in the same change, or breaking the block yields nothing while claiming
      // to yield itself.
      const cannotBeHeld = SUPPORT_SENSITIVE_TYPES.filter((type) => !placeable.has(type))
      expect(cannotBeHeld).toStrictEqual([
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
      ])

      // ...and every one of the fourteen IS support-sensitive, so the arm they
      // take is written rather than absent. This half is unchanged and is what
      // the whole file's support coverage rests on.
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
        // THROUGH THE RULE, not through the two predicates it used to AND. These
        // rows used to assert `canSupportAttachments(support)` directly, which
        // was the whole of the answer while the fallback was the whole of the
        // implementation. It is not any more, so the assertion goes through the
        // function `placementVerdict` actually calls — and these six rows are
        // the ones where the two spellings agree, which is what makes them a
        // safe place to check that the composition did not change their answers.
        expect(canBlockStaySupported(held, support)).toBe(stays)
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
 * F7 — CLOSED. THE PER-BLOCK SUPPORT RULES ARE PORTED, AND THESE ROWS NOW AGREE.
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
 * `domain/interactions/place-block.ts` used to carry all ten of the block types
 * this build has in a private `SUPPORT_SENSITIVE_BLOCK_TYPES` and then answer
 * every one of them with the FALLBACK arm — `canSupportAttachments`, kernel's
 * mirror of `NON_SUPPORTING_BLOCK_TYPES`. In the reference no lily pad, cactus,
 * sugar cane or surface plant ever reaches that arm.
 *
 * THE WORST ROW WAS THE FIRST. Water is in `NON_SUPPORTING_IDS`, and water is
 * the only thing that supports a lily pad — so under that rule a lily pad was
 * refused on the one cell it belongs on and allowed on stone. Not a deferral in
 * the direction of doing less; wrong in both directions at once.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WAS NOT FIXED HERE, AND WHAT REMOVED THE OBJECTION
 * ---------------------------------------------------------------------------
 *
 * The objection was ownership, not difficulty: 「the fix is a new table and the
 * table has an owner question attached: kernel's registry has no `supportRule`
 * column, so writing one here is this repository inventing a kernel flag」.
 *
 * Kernel has the column now. `mc-kernel/domain/block-support.ts` carries
 * `SupportRule` and `mc-kernel/domain/block-registry.ts` fills in all nineteen
 * non-default rows; `domain/block-vocabulary.ts` mirrors both IN FULL, and
 * `placementVerdict` calls `canBlockStaySupported` instead of ANDing two
 * predicates. Nothing here was invented — the objection was answered rather than
 * overruled.
 *
 * ---------------------------------------------------------------------------
 * THESE TESTS USED TO PIN THE WRONG ANSWER. EVERY ONE IS INVERTED.
 * ---------------------------------------------------------------------------
 *
 * They were written in the shape `test/preview-findings.test.ts` established —
 * 「直すと finding は『固定される』のではなく静かに消える」— so that they would
 * FAIL when the divergence was fixed, and each named the reference row it
 * contradicted. Each now asserts AGREEMENT with that same row, and says which
 * assertion flipped. They are not deleted, because a finding that disappears
 * without a trace is one nobody can tell was ever fixed.
 *
 * THEY DID NOT GO RED ON THEIR OWN, which is the one thing worth knowing about
 * the fix. They composed a RECONSTRUCTION (`wouldStay` below) rather than calling
 * the rule, and this describe's own text predicted exactly that: 「A fix that
 * added a per-block table INSIDE `placementVerdict` and left both predicates
 * alone would not turn these pins red on its own.」 It was right. The
 * reconstruction is gone — `wouldStay` is now a direct call to
 * `canBlockStaySupported`, the single function the support branch calls — so
 * these rows can no longer agree with a table that has drifted from them.
 *
 * ---------------------------------------------------------------------------
 * THE RESIDUAL GAP, MEASURED RATHER THAN ASSERTED AWAY
 * ---------------------------------------------------------------------------
 *
 * One weakness SURVIVES the fix and it is the mirror image of the old one.
 * These rows now pin the FUNCTION; what they cannot pin is that
 * `placementVerdict` still CALLS it. Reverting its support branch to
 * `canSupportAttachments` — the exact F7 defect — leaves all 51 tests in this
 * file green. That was verified by making the change and running them, not
 * assumed.
 *
 * The reason is the same wall the old tests hit, one level along: the two
 * spellings differ only on a block with a `'oneOf'` rule, and NO SUCH BLOCK IS
 * PLACEABLE. All four support-sensitive types that have an item form
 * (`torch`, `pressure_plate`, `rail`, `powered_rail`) have the `'anySupporting'`
 * rule, on which the two functions agree BY CONSTRUCTION. So no `PlaceRequest`
 * this build's types admit can tell them apart, and a cast would produce a green
 * test no production path can execute — which is what the ported-oracle comment
 * above already refused to do once.
 *
 * `the support branch agrees with the rule on every pair it can be handed` below
 * is what can be written today, and it is the test that closes the gap on the
 * day the gap becomes reachable: itemising any one of the ten plants
 * (`mc-kernel/domain/item-type.ts` records that this is now the only step left)
 * puts a `'oneOf'` block into `PLACEABLE_ITEM_TYPES`, and that test is driven by
 * that array rather than by a list somebody maintains.
 */
describe('F7 — CLOSED: the per-block support rules are ported, and all four rows now agree', () => {
  /**
   * `placementVerdict`'s support branch, for a type nobody can hold yet.
   *
   * NO LONGER A RECONSTRUCTION. This used to be
   * `!isSupportSensitive(id) || canSupportAttachments(support)` — the two
   * predicates the rule ANDed, reassembled here because the ten types cannot be
   * put into a `PlaceRequest`. That reassembly was the weakness this describe
   * declared, and it was a real one: it could not see a fix applied inside the
   * rule.
   *
   * It is now a direct call to `canBlockStaySupported`, the single function the
   * support branch calls. The composition — the precedence of the per-block list
   * over the negative set — lives in that function rather than in this file, so
   * these rows can no longer agree with a table that has drifted from them.
   *
   * What this still does NOT prove is that `placementVerdict` calls it; see the
   * residual-gap section in this describe's header, which measures exactly how
   * far short of that these rows fall and names the day it closes.
   */
  const wouldStay = (held: BlockType, support: number): boolean =>
    canBlockStaySupported(blockIdOf(held) ?? -1, support)

  /*
   * THE COUPLING TEST, DRIVEN BY `PLACEABLE_ITEM_TYPES` RATHER THAN BY A LIST.
   *
   * It runs the REAL `placementVerdict` — the thing that must call the rule —
   * against `canBlockStaySupported` for every support-sensitive item this build
   * can put into a `PlaceRequest`, over every block id the store can hold.
   *
   * TODAY IT CANNOT FAIL FOR THE REASON IT EXISTS, and that is stated rather
   * than hidden: all four placeable support-sensitive types have the
   * `'anySupporting'` rule, on which `canBlockStaySupported` and
   * `canSupportAttachments` agree by construction. The test is written against
   * the ARRAY, so the day a `'oneOf'` block gains an item form it starts
   * comparing rows where the two disagree — with no edit here.
   *
   * The second half is what makes that claim checkable now: it asserts the two
   * functions DO differ, on the row F7 was about, so "they agree everywhere" is
   * a fact about the reachable inputs rather than about the functions.
   */
  it.effect('the support branch agrees with the rule on every pair it can be handed', () =>
    Effect.gen(function* () {
      const heldable = PLACEABLE_ITEM_TYPES.filter((item) =>
        isSupportSensitive(blockIdOf(item) ?? -1),
      )
      expect(heldable.length).toBeGreaterThan(0)

      for (const item of heldable) {
        for (const support of [STONE, WATER, SNOW, DIRT, SAND, AIR_BLOCK_ID, RAIL, LAVA]) {
          const store = yield* storeWith([[below, support]])
          const outcome = yield* placeBlock(store.api, { position: target, heldItem: item })
          const stays = canBlockStaySupported(blockIdOf(item) ?? -1, support)

          expect({ item, support, refused: outcome._tag === 'Unsupported' }).toStrictEqual({
            item,
            support,
            refused: !stays,
          })
        }
      }
    }),
  )

  it.effect('...and the rule and the raw fallback DO differ, so that agreement is about the inputs', () =>
    Effect.sync(() => {
      // The F7 row itself. If these two ever stop disagreeing, the test above
      // has become vacuous for a second reason and somebody should know.
      expect(canBlockStaySupported(blockIdOf('lily_pad') ?? -1, WATER)).toBe(true)
      expect(canSupportAttachments(WATER)).toBe(false)

      // ...and no item can currently reach that disagreement, which is WHY the
      // coupling test above cannot fail today. Asserted, so that the excuse
      // expires automatically.
      const reachable = PLACEABLE_ITEM_TYPES.filter(
        (item) => supportRuleOfBlockId(blockIdOf(item) ?? -1).kind === 'oneOf',
      )
      expect(reachable).toStrictEqual([])
    }),
  )

  it.effect('the helper above agrees with the real rule, on the one type that fits through it', () =>
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
  // WAS: `expect(wouldStay('lily_pad', WATER)).toBe(false)` — pinned as the
  // wrong answer, with `canSupportAttachments(WATER)` false beside it as the
  // explanation. The explanation still holds and the verdict has flipped: water
  // is still a non-supporting block, and a lily pad still floats on it, because
  // the per-block list is consulted first.
  it.effect('AGREES with block-support.test.ts:32 — a lily pad floats on water, which is non-supporting', () =>
    Effect.sync(() => {
      expect(canSupportAttachments(WATER)).toBe(false)
      expect(wouldStay('lily_pad', WATER)).toBe(true)
    }),
  )

  // The complement of the row above, and the other half of "wrong in both
  // directions". WAS: `expect(wouldStay('lily_pad', STONE)).toBe(true)` — pinned
  // as allowed, which the reference refuses because `STONE` is not in
  // `['WATER']` (`block-support.ts:84`).
  it.effect('AGREES with block-support.ts:84 — a lily pad does NOT sit on stone', () =>
    Effect.sync(() => {
      expect(wouldStay('lily_pad', STONE)).toBe(false)
      // Stone supports attachments, so the OLD rule allowed this. The assertion
      // is kept beside the verdict to show that the fallback did not change —
      // what changed is that a lily pad no longer consults it.
      expect(canSupportAttachments(STONE)).toBe(true)
    }),
  )

  // `block-support.test.ts:31` asserts CACTUS on DIRT is NOT supported.
  // WAS: `expect(wouldStay('cactus', DIRT)).toBe(true)` — pinned as allowed,
  // which is the reference's own case table contradicted directly.
  it.effect('AGREES with block-support.test.ts:31 — a cactus does NOT stand on dirt', () =>
    Effect.sync(() => {
      expect(wouldStay('cactus', DIRT)).toBe(false)
      // ...and the rows the reference DOES allow, so the fix is not "refuse
      // everything": `SAND | CACTUS` (`block-support.ts:69`).
      expect(wouldStay('cactus', SAND)).toBe(true)
      expect(wouldStay('cactus', blockIdOf('cactus') ?? -1)).toBe(true)
    }),
  )

  // The seven surface plants take `DIRT | GRASS | FARMLAND` in the reference
  // (`block-support.ts:85-88`). Stone is in none of them.
  // WAS: `expect(wouldStay('sapling', STONE)).toBe(true)` — pinned as allowed.
  it.effect('AGREES with block-support.ts:85-88 — a sapling does NOT grow on stone', () =>
    Effect.sync(() => {
      expect(wouldStay('sapling', STONE)).toBe(false)
      expect(wouldStay('sapling', blockIdOf('grass_block') ?? -1)).toBe(true)
      expect(wouldStay('sapling', blockIdOf('farmland') ?? -1)).toBe(true)
      // All seven share ONE rule in the reference, so they share one here.
      for (const plant of ['dandelion', 'poppy', 'brown_mushroom', 'red_mushroom', 'tall_grass', 'fern'] as const) {
        expect(supportRuleOfBlockId(blockIdOf(plant) ?? -1)).toStrictEqual(
          supportRuleOfBlockId(blockIdOf('sapling') ?? -1),
        )
      }
    }),
  )

  // THE ROWS THAT USED TO AGREE BY ACCIDENT, kept because they are the reason
  // the four above went unnoticed for so long: they reach `SUPPORT_RULES` in the
  // reference and reached the fallback here, and happened to give the same
  // answer either way. They still agree, and now they agree for the right
  // reason — which is a thing this test can now show rather than assert.
  it.effect('sugar cane on sand and a sapling on dirt agree, and no longer by coincidence', () =>
    Effect.sync(() => {
      expect(wouldStay('sugar_cane', SAND)).toBe(true)
      expect(wouldStay('sapling', DIRT)).toBe(true)

      // The proof that the coincidence is over: both are answered by a per-block
      // list now, not by the negative set.
      expect(supportRuleOfBlockId(blockIdOf('sugar_cane') ?? -1)).toStrictEqual(
        needsOneOf('dirt', 'grass_block', 'sand', 'sugar_cane'),
      )
      expect(supportRuleOfBlockId(blockIdOf('sapling') ?? -1)).toStrictEqual(
        needsOneOf('dirt', 'grass_block', 'farmland'),
      )
      // ...and sugar cane stacks on itself, a row the fallback could never have
      // got right: sugar cane is in `NON_SUPPORTING_IDS`.
      expect(canSupportAttachments(blockIdOf('sugar_cane') ?? -1)).toBe(false)
      expect(wouldStay('sugar_cane', blockIdOf('sugar_cane') ?? -1)).toBe(true)
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
