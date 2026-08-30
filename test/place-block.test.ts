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
 *   as "block already exists". The former `domain/block-vocabulary.ts`'s own
 *   comment recorded the two halves of that omission and said the second was
 *   placement's.
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
import { makeTimeService } from '@nerima-games/mc-sim'
import { Effect, Ref } from 'effect'
import {
  blockIdOf,
  blockOfPlaceableItem,
  blockPosition,
  blockPositionKeyOf,
  canBlockStaySupported,
  capabilityOfBlockId,
  needsOneOf,
  PLACEABLE_ITEM_TYPES,
  StackCount,
  supportRuleOfBlockId,
  type BlockType,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  AIR_BLOCK_ID,
  type BlockPosition,
  type BlockWriteOutcome,
  type ChunkStoreApi,
} from '../src/domain/chunk-store-port'
import {
  blockOverlapsPlayer,
  isSupportSensitiveOfBlock,
  placeBlock,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  type PlaceOutcome,
} from '../src/domain/interactions/place-block'
import {
  drainBlockPlacementResults,
  gameplayStages,
  makeGameplayFrameState,
  requestBlockPlacementCommand,
} from '../src/stages/registration'
import { lightWorld, makeChunkStoreDouble, SAND, STONE, WATER, world } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makePlayerServiceDouble } from './support/player-service-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { runFrame } from './support/frame-runner'

const LAVA = 11
const TORCH = 14
const SNOW = 7
const DIRT = 3
const RAIL = 31
const PRESSURE_PLATE = 34
const WITHER_SKELETON_SKULL = 121

const SUPPORT_SENSITIVE_PLANT_TYPES: ReadonlyArray<BlockType> = [
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

const SUPPORT_SENSITIVE_TYPES: ReadonlyArray<BlockType> = [
  'torch',
  'pressure_plate',
  'rail',
  'powered_rail',
  'wither_skeleton_skull',
  ...SUPPORT_SENSITIVE_PLANT_TYPES,
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
        // EMPTY, and asserted rather than omitted: `alsoPlaced` is the door
        // rule's channel (`domain/interactions/place-door-upper.ts`) and an
        // ordinary block must not acquire a second cell. `toStrictEqual` would
        // catch an extra entry; spelling the empty array catches the day the
        // member stops being present at all.
        alsoPlaced: [],
      } satisfies PlaceOutcome)
      // ...and the id the rule chose came out of kernel's table rather than out
      // of this test: `stone` the item names `stone` the block, which is
      // kernel's own name-identity bridge (`PlaceableItemType`).
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

      expect(capabilityOfBlockId(LAVA, 'replaceable')).toBe(true)
      expect((yield* placeBlock(store.api, { position: target, heldItem: 'stone' }))._tag).toBe(
        'Placed',
      )
      expect(yield* store.blockAt(target)).toBe(STONE)
    }),
  )

  it.effect('a second placement onto the block it just wrote is refused on the READ', () =>
    Effect.gen(function* () {
      // NOT the `Unchanged` path, and the distinction is the point — this test
      // used to claim it was. Stone is not replaceable, so the second call never
      // reaches the store at all: it is refused by `isReplaceable` on the read,
      // exactly like the `Occupied` case above. Coverage is what said so; the
      // write-side arm below had never run.
      //
      // Nothing in this build is BOTH replaceable and placeable — the five
      // replaceable blocks (air, water, lava, snow, …) have no item form — so
      // there is no held item that can reach the store's `Unchanged` through the
      // ordinary path. The one way it happens is a race, and that is the test
      // that follows.
      const store = yield* storeWith([[target, WATER]])

      expect((yield* placeBlock(store.api, { position: target, heldItem: 'stone' }))._tag).toBe(
        'Placed',
      )

      const writesAfterFirst = (yield* store.calls).writes
      const again = yield* placeBlock(store.api, { position: target, heldItem: 'stone' })

      expect(again).toStrictEqual({ _tag: 'Occupied', existing: STONE })
      expect((yield* store.calls).writes).toBe(writesAfterFirst)
    }),
  )

  describe('the window between the read and the write', () => {
    /**
     * A store that answers the read honestly and then changes its mind.
     *
     * This is the state the module header is about and the only way to produce
     * it: `placeBlock` reads the target, decides, and writes, and between those
     * two calls the world belongs to somebody else. The double cannot do it —
     * its `getBlock` and `setBlock` consult the same map, so they always agree —
     * and agreeing is precisely what a race does not do.
     *
     * NOT AN ASSERTION ABOUT A CONCURRENCY MODEL. mx-gameplay does not own one;
     * `stages/registration.ts` runs inside a frame and mc-worldgen owns the
     * store. The claim is narrower and is entirely about this file: whatever the
     * write says, that is the answer — the rule does not re-report the verdict it
     * formed from a reading that has since expired.
     */
    const storeThatChangesItsMind = (
      honest: ChunkStoreApi,
      onWrite: BlockWriteOutcome,
    ): ChunkStoreApi => ({ ...honest, setBlock: () => Effect.succeed(onWrite) })

    it.effect('a write that comes back `Unchanged` is Occupied, so nothing is taken off the stack', () =>
      Effect.gen(function* () {
        // The fourth refusal, and the only one that is not the reference's. A
        // write that dirtied nothing must not report `Placed`, because `Placed`
        // carries `consumed` and the caller spends it: the player would lose an
        // item to a placement that changed nothing in the world.
        //
        // `existing` is the store's `previous` and not the rule's `verdict.block`
        // — they are equal in the case the tag describes, and taking it from the
        // store is what makes the answer a report rather than a restatement.
        const store = yield* storeWith([[below, STONE]])
        const raced = storeThatChangesItsMind(store.api, { _tag: 'Unchanged', previous: STONE })

        const outcome = yield* placeBlock(raced, { position: target, heldItem: 'stone' })

        expect(outcome).toStrictEqual({ _tag: 'Occupied', existing: STONE })
        // No `consumed`, which is the half that costs a player an item.
        expect(outcome).not.toHaveProperty('consumed')
      }),
    )

    it.effect('a write that comes back `ChunkNotLoaded` gives the answer the READ would have given', () =>
      Effect.gen(function* () {
        // The chunk was unloaded between the two calls. The verdict is DECIDED
        // rather than asserted away: reporting `Placed` would tell the caller to
        // spend an item for a block that is not in any chunk, and dying here
        // would take the frame down for a state the store is entitled to be in.
        const store = yield* storeWith([[below, STONE]])
        const raced = storeThatChangesItsMind(store.api, { _tag: 'ChunkNotLoaded' })

        expect(yield* placeBlock(raced, { position: target, heldItem: 'stone' })).toStrictEqual({
          _tag: 'ChunkNotLoaded',
        })
      }),
    )

    it.effect('a write that comes back `OutOfWorld` does too, and the two are kept apart', () =>
      Effect.gen(function* () {
        // Two tags rather than one shared "it did not happen", for the reason
        // `BlockReading` is three-valued: `ChunkNotLoaded` is temporary and a
        // caller may retry it, `OutOfWorld` never becomes true and a caller that
        // retried would spin. Collapsing them is the cheap simplification that
        // makes the difference unrecoverable.
        const store = yield* storeWith([[below, STONE]])
        const raced = storeThatChangesItsMind(store.api, { _tag: 'OutOfWorld' })

        expect(yield* placeBlock(raced, { position: target, heldItem: 'stone' })).toStrictEqual({
          _tag: 'OutOfWorld',
        })
      }),
    )
  })

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
  it.effect('places soul soil normally and requires support for a wither skeleton skull', () =>
    Effect.gen(function* () {
      const soulSoilStore = yield* storeWith([])
      expect(
        yield* placeBlock(soulSoilStore.api, { position: target, heldItem: 'soul_soil' }),
      ).toStrictEqual({
        _tag: 'Placed',
        block: 120,
        consumed: 'soul_soil',
        chunk: { cx: 0, cz: 0 },
        alsoPlaced: [],
      } satisfies PlaceOutcome)

      const supported = yield* storeWith([[below, STONE]])
      expect(
        yield* placeBlock(supported.api, {
          position: target,
          heldItem: 'wither_skeleton_skull',
        }),
      ).toStrictEqual({
        _tag: 'Placed',
        block: WITHER_SKELETON_SKULL,
        consumed: 'wither_skeleton_skull',
        chunk: { cx: 0, cz: 0 },
        alsoPlaced: [],
      } satisfies PlaceOutcome)

      const unsupported = yield* storeWith([])
      expect(
        yield* placeBlock(unsupported.api, {
          position: target,
          heldItem: 'wither_skeleton_skull',
        }),
      ).toStrictEqual({ _tag: 'Unsupported', support: 0 })
    }),
  )

  it.effect('a torch needs something under it', () =>
    Effect.gen(function* () {
      expect(isSupportSensitiveOfBlock(TORCH)).toBe(true)
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
      expect(capabilityOfBlockId(SNOW, 'validSpawnSurface')).toBe(true)
      expect(capabilityOfBlockId(SNOW, 'canSupportAttachments')).toBe(false)

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

describe('placeBlock — the four per-block rules, reached through a real held item', () => {
  // `./place-mushroom-light.ts`'s gate: it reads nothing unless the block is a
  // mushroom, and reads the light at the TARGET cell — the one being placed
  // into, not the support cell below it.
  it.effect('a mushroom is refused when the cell is too bright', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(
        world([[below, DIRT]]),
        ['0,0'],
        lightWorld([[target, { sky: 13, block: 0 }]]),
      )

      expect(
        yield* placeBlock(store.api, { position: target, heldItem: 'brown_mushroom' }),
      ).toStrictEqual({ _tag: 'TooBright', light: 13 })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  // `./place-cactus-sides.ts`'s gate: all four horizontal neighbours must read
  // `AIR`, and one blocked side is enough to refuse the whole placement.
  it.effect('a cactus is refused when a horizontal side is blocked', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([
        [below, SAND],
        [{ x: target.x + 1, y: target.y, z: target.z }, STONE],
      ])

      expect(
        yield* placeBlock(store.api, { position: target, heldItem: 'cactus' }),
      ).toStrictEqual({ _tag: 'SidesBlocked' })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  // `./place-door-upper.ts`'s refusal arm: the gate runs BEFORE the write, so a
  // door with no room above writes nothing at all — not even the lower half.
  it.effect('a door is refused when the cell above is not clear, and nothing is written', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([
        [below, STONE],
        [{ x: target.x, y: target.y + 1, z: target.z }, STONE],
      ])

      expect(
        yield* placeBlock(store.api, { position: target, heldItem: 'door' }),
      ).toStrictEqual({ _tag: 'NoRoomAbove' })
      expect((yield* store.calls).writes).toBe(0)
      expect(yield* store.blockAt(target)).toBeUndefined()
    }),
  )

  // The `Clear` arm of `./place-door-upper.ts`, and the only branch of
  // `placeBlock`'s own `switch` that writes a SECOND cell: the module header's
  // `alsoPlaced` contract, exercised end to end.
  it.effect('a door places both halves and reports the second cell in alsoPlaced', () =>
    Effect.gen(function* () {
      const upperCell: BlockPosition = { x: target.x, y: target.y + 1, z: target.z }
      const store = yield* storeWith([[below, STONE]])

      const outcome = yield* placeBlock(store.api, { position: target, heldItem: 'door' })

      expect(outcome).toStrictEqual({
        _tag: 'Placed',
        block: blockIdOf('door')!,
        consumed: 'door',
        chunk: { cx: 0, cz: 0 },
        alsoPlaced: [upperCell],
      } satisfies PlaceOutcome)
      expect(yield* store.blockAt(target)).toBe(blockIdOf('door'))
      expect(yield* store.blockAt(upperCell)).toBe(blockIdOf('door'))
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
 * WHY THESE ROWS ALSO STAY AT THE PREDICATE LEVEL
 * ---------------------------------------------------------------------------
 *
 * Kernel gives all ten plants item forms, so all fifteen support-sensitive
 * blocks are now reachable through `placeBlock`; the coupling test in F7 below
 * exercises that production path. These oracle rows remain at the predicate
 * level because they pin the support-rule answers independently and precisely.
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
      expect(isSupportSensitiveOfBlock(TORCH)).toBe(true)
      expect(isSupportSensitiveOfBlock(PRESSURE_PLATE)).toBe(true)
      expect(isSupportSensitiveOfBlock(RAIL)).toBe(true)
      expect(isSupportSensitiveOfBlock(STONE)).toBe(false)
    }),
  )

  it.effect('all fifteen support-sensitive blocks are reachable as held items', () =>
    Effect.sync(() => {
      const placeable: ReadonlySet<string> = new Set<string>(PLACEABLE_ITEM_TYPES)
      const heldToday = SUPPORT_SENSITIVE_TYPES.filter((type) => placeable.has(type))

      expect(heldToday).toStrictEqual(SUPPORT_SENSITIVE_TYPES)

      const cannotBeHeld = SUPPORT_SENSITIVE_TYPES.filter((type) => !placeable.has(type))
      expect(cannotBeHeld).toStrictEqual([])

      // ...and every one of the fifteen IS support-sensitive, so the arm they
      // take is written rather than absent. This half is unchanged and is what
      // the whole file's support coverage rests on.
      for (const type of SUPPORT_SENSITIVE_TYPES) {
        expect(isSupportSensitiveOfBlock(blockIdOf(type) ?? -1)).toBe(true)
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
        expect(isSupportSensitiveOfBlock(held)).toBe(true)
        // THROUGH THE RULE, not through the two predicates it used to AND. These
        // rows used to assert `capabilityOfBlockId(support, 'canSupportAttachments')` directly, which
        // was the whole of the answer while the fallback was the whole of the
        // implementation. It is not any more, so the assertion goes through the
        // function `placementVerdict` actually calls — and these six rows are
        // the ones where the two spellings agree, which is what makes them a
        // safe place to check that the composition did not change their answers.
        expect(canBlockStaySupported(held, support)).toBe(stays)
        expect(capabilityOfBlockId(support, 'canSupportAttachments')).toBe(stays)
      }),
    )
  }

  // The torch is the one row that can be run end to end, so it is: the two
  // predicates above and the rule that reads them give the same answer.
  it.effect('and the one type that CAN be held gives the same answer through the whole rule', () =>
    Effect.gen(function* () {
      const store = yield* storeWith([[below, WATER]])

      expect(isSupportSensitiveOfBlock(TORCH)).toBe(true)
      expect(capabilityOfBlockId(WATER, 'canSupportAttachments')).toBe(false)
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
 * `SupportRule` and `mc-kernel/domain/block-registry.ts` fills in all twenty
 * non-default rows; this repository reads both directly since W1-M4, and
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
 * THE RESIDUAL GAP IS CLOSED
 * ---------------------------------------------------------------------------
 *
 * Kernel 0.2.5 itemises all ten plants with a `'oneOf'` support rule. The
 * coupling test below now passes those real item literals through `placeBlock`,
 * so replacing the per-block rule with the raw fallback is observable without
 * casts or reconstructed inputs.
 */
describe('F7 — CLOSED: per-block support rules are reachable through placeBlock', () => {
  /**
   * Direct helper for the detailed oracle rows below. Production-path coverage
   * is provided separately by the coupling test.
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
   * Kernel makes all fifteen named support-sensitive blocks reachable,
   * including the ten `'oneOf'` plants on which the per-block rule differs from
   * the raw fallback. The dynamic list also covers any other placeable item the
   * kernel classifies as support-sensitive.
   */
  it.effect('the support branch agrees with the rule on every pair it can be handed', () =>
    Effect.gen(function* () {
      const heldable = PLACEABLE_ITEM_TYPES.filter((item) =>
        isSupportSensitiveOfBlock(blockIdOf(blockOfPlaceableItem(item)) ?? -1),
      )
      const heldableSet = new Set<string>(heldable)
      expect(SUPPORT_SENSITIVE_TYPES.filter((type) => !heldableSet.has(type))).toStrictEqual([])

      for (const item of heldable) {
        for (const support of [STONE, WATER, SNOW, DIRT, SAND, AIR_BLOCK_ID, RAIL, LAVA]) {
          const store = yield* storeWith([[below, support]])
          const outcome = yield* placeBlock(store.api, { position: target, heldItem: item })
          const stays = canBlockStaySupported(
            blockIdOf(blockOfPlaceableItem(item)) ?? -1,
            support,
          )

          expect({ item, support, refused: outcome._tag === 'Unsupported' }).toStrictEqual({
            item,
            support,
            refused: !stays,
          })
        }
      }
    }),
  )

  it.effect('...and all ten oneOf rules are reachable through held items', () =>
    Effect.sync(() => {
      // The F7 row itself. If these two ever stop disagreeing, the test above
      // has become vacuous for a second reason and somebody should know.
      expect(canBlockStaySupported(blockIdOf('lily_pad') ?? -1, WATER)).toBe(true)
      expect(capabilityOfBlockId(WATER, 'canSupportAttachments')).toBe(false)

      const reachable = PLACEABLE_ITEM_TYPES.filter(
        (item) =>
          supportRuleOfBlockId(blockIdOf(blockOfPlaceableItem(item)) ?? -1).kind === 'oneOf',
      )
      expect(reachable).toStrictEqual(SUPPORT_SENSITIVE_PLANT_TYPES)
    }),
  )

  it.effect('the helper agrees with the real rule for an anySupporting representative', () =>
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
  // wrong answer, with `capabilityOfBlockId(WATER, 'canSupportAttachments')` false beside it as the
  // explanation. The explanation still holds and the verdict has flipped: water
  // is still a non-supporting block, and a lily pad still floats on it, because
  // the per-block list is consulted first.
  it.effect('AGREES with block-support.test.ts:32 — a lily pad floats on water, which is non-supporting', () =>
    Effect.sync(() => {
      expect(capabilityOfBlockId(WATER, 'canSupportAttachments')).toBe(false)
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
      expect(capabilityOfBlockId(STONE, 'canSupportAttachments')).toBe(true)
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
      expect(capabilityOfBlockId(blockIdOf('sugar_cane') ?? -1, 'canSupportAttachments')).toBe(false)
      expect(wouldStay('sugar_cane', blockIdOf('sugar_cane') ?? -1)).toBe(true)
    }),
  )
})

// ---------------------------------------------------------------------------
// Through the stage
// ---------------------------------------------------------------------------

const stagedSlice = (
  entries: ReadonlyArray<readonly [BlockPosition, number]>,
  stocked = true,
) =>
  Effect.gen(function* () {
    const store = yield* storeWith(entries)
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const player = yield* makePlayerServiceDouble()
    const initialInventory = emptySlots().map((_, index) => {
      if (!stocked) return undefined
      if (index === 0) return { item: 'sand' as const, count: StackCount(1) }
      if (index === 1) return { item: 'stone' as const, count: StackCount(1) }
      if (index === 2) return { item: 'redstone_dust' as const, count: StackCount(1) }
      return undefined
    })
    const inventory = yield* makeInventoryDouble(initialInventory)
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    return {
      store,
      state,
      inventory,
      player,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time),
    }
  })

describe('placement through gameplay:interactions', () => {
  it.effect('a queued placement is serviced and the item is reported as spent', () =>
    Effect.gen(function* () {
      const { store, state, inventory, stages } = yield* stagedSlice([[below, STONE]])
      const before = yield* inventory.api.countOf('sand')

      yield* Ref.update(state.pendingPlacements, (queue) => [
        ...queue,
        { positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)), heldItem: 'sand' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(blockIdOf('sand'))
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual(['sand'])
      expect(yield* inventory.api.countOf('sand')).toBe(before - 1)
    }),
  )

  it.effect('redstone dust places wire and consumes dust', () =>
    Effect.gen(function* () {
      const { store, state, inventory, stages } = yield* stagedSlice([[below, STONE]])

      yield* Ref.set(state.pendingPlacements, [
        { positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)), heldItem: 'redstone_dust' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(blockIdOf('redstone_wire'))
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual(['redstone_dust'])
      expect(yield* inventory.api.countOf('redstone_dust')).toBe(0)
    }),
  )

  it.effect('competing placements cannot consume the same held item twice', () =>
    Effect.gen(function* () {
      const competingTarget: BlockPosition = { x: 3, y: 64, z: 3 }
      const competingBelow: BlockPosition = { x: 3, y: 63, z: 3 }
      const { store, state, inventory, stages } = yield* stagedSlice([
        [below, STONE],
        [competingBelow, STONE],
      ])

      yield* Ref.set(state.pendingPlacements, [
        { positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)), heldItem: 'sand' as const },
        { positionKey: blockPositionKeyOf(blockPosition(competingTarget.x, competingTarget.y, competingTarget.z)), heldItem: 'sand' as const },
      ])
      yield* runFrame(stages)

      const placements = [yield* store.blockAt(target), yield* store.blockAt(competingTarget)]
      expect(placements.filter((block) => block === blockIdOf('sand'))).toHaveLength(1)
      expect(yield* inventory.api.countOf('sand')).toBe(0)
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual(['sand'])
    }),
  )

  it.effect('an empty inventory makes a queued placement a no-op', () =>
    Effect.gen(function* () {
      const { store, state, stages } = yield* stagedSlice([[below, STONE]], false)

      yield* Ref.set(state.pendingPlacements, [
        { positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)), heldItem: 'sand' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBeUndefined()
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual([])
    }),
  )

  it.effect('a correlated empty-hand placement reports failure without changing the world', () =>
    Effect.gen(function* () {
      const { store, state, inventory, stages } = yield* stagedSlice([[below, STONE]], false)

      yield* requestBlockPlacementCommand(state, {
        requestId: 'empty-hand',
        positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)),
        heldItem: 'sand',
      })
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBeUndefined()
      expect(yield* inventory.withdrawals).toStrictEqual([
        { item: 'sand', count: 1, removed: 0 },
      ])
      expect(yield* drainBlockPlacementResults(state)).toStrictEqual([
        {
          requestId: 'empty-hand',
          success: false,
          consumed: false,
          replayed: false,
          outcome: { _tag: 'InventoryUnavailable' },
        },
      ])
    }),
  )

  it.effect('the last held item is consumed exactly once when placement succeeds', () =>
    Effect.gen(function* () {
      const { store, state, inventory, stages } = yield* stagedSlice([[below, STONE]])

      yield* requestBlockPlacementCommand(state, {
        requestId: 'last-item',
        positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)),
        heldItem: 'sand',
      })
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(blockIdOf('sand'))
      expect(yield* inventory.api.countOf('sand')).toBe(0)
      expect(yield* inventory.withdrawals).toStrictEqual([
        { item: 'sand', count: 1, removed: 1 },
      ])
      const [result] = yield* drainBlockPlacementResults(state)
      expect(result).toMatchObject({
        requestId: 'last-item',
        success: true,
        consumed: true,
        replayed: false,
        outcome: { _tag: 'Placed', consumed: 'sand' },
      })
    }),
  )

  it.effect('a refused correlated placement restores the reservation and reports the reason', () =>
    Effect.gen(function* () {
      const { store, state, inventory, stages } = yield* stagedSlice([[target, STONE]])

      yield* requestBlockPlacementCommand(state, {
        requestId: 'occupied',
        positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)),
        heldItem: 'sand',
      })
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(STONE)
      expect(yield* inventory.api.countOf('sand')).toBe(1)
      expect(yield* drainBlockPlacementResults(state)).toStrictEqual([
        {
          requestId: 'occupied',
          success: false,
          consumed: false,
          replayed: false,
          outcome: { _tag: 'Occupied', existing: STONE },
        },
      ])
    }),
  )

  it.effect('creative placement changes the world without touching inventory', () =>
    Effect.gen(function* () {
      const { store, state, inventory, stages } = yield* stagedSlice([[below, STONE]], false)

      yield* requestBlockPlacementCommand(state, {
        requestId: 'creative',
        positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)),
        heldItem: 'sand',
        mode: 'creative',
      })
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(blockIdOf('sand'))
      expect(yield* inventory.withdrawals).toStrictEqual([])
      const [result] = yield* drainBlockPlacementResults(state)
      expect(result).toMatchObject({
        requestId: 'creative',
        success: true,
        consumed: false,
        replayed: false,
        outcome: { _tag: 'Placed' },
      })
    }),
  )

  it.effect('replaying the same command id returns its result without a second mutation', () =>
    Effect.gen(function* () {
      const { store, state, inventory, stages } = yield* stagedSlice([[below, STONE]])
      const command = {
        requestId: 'retry',
        positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)),
        heldItem: 'sand' as const,
      }

      yield* requestBlockPlacementCommand(state, command)
      yield* runFrame(stages)
      yield* drainBlockPlacementResults(state)
      yield* requestBlockPlacementCommand(state, command)
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(blockIdOf('sand'))
      expect(yield* inventory.withdrawals).toStrictEqual([
        { item: 'sand', count: 1, removed: 1 },
      ])
      const [result] = yield* drainBlockPlacementResults(state)
      expect(result).toMatchObject({
        requestId: 'retry',
        success: true,
        consumed: true,
        replayed: true,
        outcome: { _tag: 'Placed' },
      })
    }),
  )

  it.effect('reusing a command id for another payload is rejected without mutation', () =>
    Effect.gen(function* () {
      const secondTarget: BlockPosition = { x: 3, y: 64, z: 3 }
      const secondBelow: BlockPosition = { x: 3, y: 63, z: 3 }
      const { store, state, inventory, stages } = yield* stagedSlice([
        [below, STONE],
        [secondBelow, STONE],
      ])

      yield* requestBlockPlacementCommand(state, {
        requestId: 'conflict',
        positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)),
        heldItem: 'sand',
      })
      yield* runFrame(stages)
      yield* drainBlockPlacementResults(state)
      yield* requestBlockPlacementCommand(state, {
        requestId: 'conflict',
        positionKey: blockPositionKeyOf(blockPosition(secondTarget.x, secondTarget.y, secondTarget.z)),
        heldItem: 'sand',
      })
      yield* runFrame(stages)

      expect(yield* store.blockAt(secondTarget)).toBeUndefined()
      expect(yield* inventory.withdrawals).toHaveLength(1)
      expect(yield* drainBlockPlacementResults(state)).toStrictEqual([
        {
          requestId: 'conflict',
          success: false,
          consumed: false,
          replayed: true,
          outcome: { _tag: 'RequestIdConflict' },
        },
      ])
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
        { positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)), heldItem: 'sand' as const },
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
      const { store, state, inventory, stages } = yield* stagedSlice([[target, STONE]])
      const before = yield* inventory.api.countOf('sand')

      yield* Ref.update(state.pendingPlacements, (queue) => [
        ...queue,
        { positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)), heldItem: 'sand' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(STONE)
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual([])
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)
      expect(yield* inventory.api.countOf('sand')).toBe(before)
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

      yield* Ref.set(state.pendingBreaks, [blockPositionKeyOf(blockPosition(target.x, target.y, target.z))])
      yield* Ref.set(state.pendingPlacements, [
        { positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)), heldItem: 'sand' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(blockIdOf('sand'))
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual(['sand'])
    }),
  )

  // PlayerService is authoritative. Keep the compatibility Ref deliberately
  // stale so this also detects any accidental fallback to the old inbox.
  it.effect('REGRESSION: the stage reads the latest PlayerService pose, so the body guard is live', () =>
    Effect.gen(function* () {
      const { store, state, player, stages } = yield* stagedSlice([[below, STONE]])

      yield* Ref.set(state.targetPosition, {
        x: target.x + 20.5,
        y: target.y,
        z: target.z + 20.5,
      })
      yield* player.api.moveTo({
        x: target.x + 0.5,
        y: target.y,
        z: target.z + 0.5,
      })
      yield* Ref.set(state.pendingPlacements, [
        { positionKey: blockPositionKeyOf(blockPosition(target.x, target.y, target.z)), heldItem: 'stone' as const },
      ])
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBeUndefined()
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual([])
    }),
  )
})
