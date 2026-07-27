/**
 * ONE RULE, ONE FILE (DN-GP-9): the player puts a block into the cell they are
 * aiming at.
 *
 * The counterpart to `./break-block`, and deliberately shaped as its mirror
 * image so that the two can be read side by side. What is NOT mirrored is the
 * store traffic, and that difference is the whole of this file's design; see the
 * next section.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ONE HAS TO READ FIRST, WHEN BREAKING DOES NOT
 * ---------------------------------------------------------------------------
 *
 * `./break-block`'s header is emphatic that "put the mined block in the
 * inventory" must NOT be get-then-set, because `setBlock` returns the block it
 * replaced (`mc-worldgen/docs/public-api.md` §6-3) and asking first would be a
 * TOCTOU as well as a doubling of the cost.
 *
 * Placement cannot take that route, and the reason is not laziness. Breaking
 * writes AIR unconditionally: every cell is a legal target and the write is
 * correct whatever was there. Placement's target must be REPLACEABLE, and by the
 * time `setBlock` has told you what was there IT HAS ALREADY OVERWRITTEN IT.
 * `setBlock(cell, stone)` on a dirt cell returns `Written { previous: dirt }` —
 * the answer to "may I place here?" arrives one instruction after the dirt is
 * gone, and putting it back is a compensating write that can itself fail.
 *
 * So this rule reads, decides, and then writes. THAT WINDOW IS REAL AND IT IS
 * NOT PAPERED OVER:
 *
 *   - The reference has the identical shape and the identical window —
 *     `ensurePlacementTargetIsAir` (`block-service-place-load.ts:35-58`) reads,
 *     then `commitPlacedBlocks` writes, with four more reads in between
 *     (`block-service-place-plan.ts`). This is a port, not a regression.
 *   - Within one frame there is exactly one writer of the store in this
 *     repository: `gameplay:interactions` and `gameplay:entities` are ordered by
 *     an `after` edge and neither forks. The window is between two statements of
 *     one Effect on one fiber.
 *   - THE REAL FIX IS ANOTHER REPOSITORY'S API. A compare-and-set —
 *     `setBlockIf(position, expected, block)` — closes it completely and belongs
 *     on mc-worldgen's `ChunkStore` beside `setBlock`, where the chunk buffer
 *     actually is. `./chunk-store-port` mirrors that service whole, so the day it
 *     grows the method this file loses a read and a paragraph.
 *
 * ---------------------------------------------------------------------------
 * THREE REFUSALS, AND ALL THREE ARE PLACES THE REFERENCE GOT IT WRONG
 * ---------------------------------------------------------------------------
 *
 * OCCUPIED. The reference asks `existing === 'AIR' || existing === 'WATER'`
 * (`block-service-place-load.ts:48-58`), a hand-written two-element list with a
 * comment about underwater building. LAVA IS MISSING FROM IT, so placing into a
 * lava cell is refused as "block already exists". That is the same omission
 * `../block-vocabulary`'s `REPLACEABLE_IDS` had — its own comment records the
 * consequence in two halves, 「falling sand and gravel did not displace lava, and
 * placement treated a lava cell as occupied」 — and this rule is the second half.
 * It asks `isReplaceable`, so the answer is kernel's capability rather than a
 * third hand-written list, and adding a replaceable block is a row in kernel's
 * table and no edit here.
 *
 * INSIDE THE PLAYER. `blockOverlapsPlayer` (`block-utils.ts:66-74`) is an AABB
 * test the reference does run, and correctly; what it does not do is state that
 * the answer is a SUFFOCATION guard rather than a politeness. A player who can
 * place a block in their own head is a player who can suffocate themselves with
 * one keystroke. It is ported verbatim, including the half-extents, and
 * `test/rules.test.ts` brackets the threshold from both sides so that its
 * LOCATION is pinned rather than its sign.
 *
 * UNSUPPORTED. `canBlockStaySupported` (`block-support.ts:96-101`) is checked at
 * PLACEMENT time in the reference and, as its name says, is also what a
 * maintenance pass would use to decide that an existing block should pop off.
 * Only the placement half is here. The other half needs a sweep, and a sweep
 * over the world is DN-GP-1's mistake; the event-driven version of it is a
 * `disturb`-shaped queue for attachments, which nothing needs yet and which
 * would be a second queue with no consumer.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RULE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * PICK THE CELL. `adjacentToHit` (`placement-geometry.ts`) turns a raycast hit
 * and a face normal into the cell one step along the normal. That is a question
 * about where the player is LOOKING, which is mc-render's raycast and mc-sim's
 * pose; this rule is handed a cell, exactly as `./break-block` is handed one.
 *
 * SPEND THE ITEM. The stack the block came out of is mc-sim's `InventoryService`
 * — plan.md §2.3-1's worked example, from the other end. The rule reports which
 * item was consumed and `stages/registration.ts` parks it, for the same reason
 * and in the same shape as `minedItems`.
 *
 * THE PER-BLOCK PLACEMENT RULES. The reference has four more beyond support:
 * mushrooms need light <= 12, sugar cane needs adjacent water, cactus needs four
 * air sides, doors need the cell above (`block-service-place-plan.ts:208-214`).
 * Each is a genuine rule and each needs a fact this repository can measure —
 * `getLight` exists, the four horizontal neighbours are four more reads — so
 * they are deferred rather than refused, and they are deferred because each is
 * ANOTHER FILE by DN-GP-9 rather than another branch of this one. A `PlacementRule`
 * array here would be `block-service-place-plan.ts` reappearing: five unrelated
 * block-name tests in one function.
 */
import { Effect } from 'effect'
import {
  type BlockId,
  type BlockPosition,
  type BlockReading,
  type ChunkCoord,
  type ChunkStoreApi,
} from '../chunk-store-port'
import { below } from '../block-position-key'
import {
  blockIdOf,
  blockTypeOfId,
  canSupportAttachments,
  isReplaceable,
  type BlockType,
  type PlaceableItemType,
} from '../block-vocabulary'
import type { Position } from '../entity-manager-port'

/**
 * Half-extents of the player's collision box, from
 * `<reference-impl>/packages/core/domain/constants.ts:23-24`.
 *
 * They are the PHYSICS numbers and they are restated here rather than derived,
 * because mc-physics is not a parent of this repository (plan.md §2.1) and
 * cannot be imported. That is a transcription with a real drift risk and it is
 * pinned as one: `test/rules.test.ts` carries the reference's own boundary table
 * (`block-service-utils.test.ts:84-98`), which brackets the x threshold at 1.29
 * and 1.31 — so a divergence in either half-extent fails a named test rather
 * than quietly moving where a player may build.
 */
export const PLAYER_HALF_WIDTH = 0.3
export const PLAYER_HALF_HEIGHT = 0.9

/** Half a unit cube. Written down because it appears three times below and means one thing. */
const BLOCK_HALF = 0.5

/**
 * Would a block in this cell overlap the player's body?
 *
 * `<reference-impl>/packages/world/domain/block-utils.ts:66-74`, verbatim,
 * including the two things a reader should not have to reconstruct: the block's
 * centre is `blockPos + 0.5` on every axis, and the player's centre is their
 * FEET plus one half-height (the position mc-sim stores is the feet, which is
 * why `../entity-manager-port` mirrors `Position` and `BlockPosition` as two
 * types rather than one).
 *
 * TOTAL. A coordinate that is not a number yields `NaN` in every comparison and
 * `NaN < x` is `false`, so an unmeasurable player does not block placement. That
 * is the permissive direction and it is chosen: the alternative is a world in
 * which a corrupt pose makes the player unable to build anywhere at all, with no
 * message, and `../mob/hostile-spawn`'s light guard records the same shape of
 * decision made the other way for a reason it states.
 */
export const blockOverlapsPlayer = (block: BlockPosition, playerFeet: Position): boolean => {
  const playerCentreY = playerFeet.y + PLAYER_HALF_HEIGHT

  return (
    Math.abs(block.x + BLOCK_HALF - playerFeet.x) < BLOCK_HALF + PLAYER_HALF_WIDTH &&
    Math.abs(block.y + BLOCK_HALF - playerCentreY) < BLOCK_HALF + PLAYER_HALF_HEIGHT &&
    Math.abs(block.z + BLOCK_HALF - playerFeet.z) < BLOCK_HALF + PLAYER_HALF_WIDTH
  )
}

/**
 * The blocks that fall off if there is nothing under them.
 *
 * A RULES-TIER TABLE, and it is here rather than in `../chunk-store-port`
 * because kernel does not have it: `mc-kernel/domain/block-registry.ts` records
 * the gap in as many words on its shared plant row — 「`supportRule` is the one
 * capability these blocks need and kernel does not have […] It is
 * `PENDING_CAPABILITIES`」. Transcribing it into the capability mirror would be
 * this repository inventing a kernel flag, which is worse than holding the set
 * where the rule that reads it lives.
 *
 * It is deliberately BLOCK TYPES and not ids, so it reads against the reference
 * rather than against a byte, and it is ONE set in ONE file — the property that
 * distinguishes it from the scatter plan.md §3.1 measured
 * (`blockTypeToIndex('SAND')` in 229 places across 51 files). When kernel adds
 * `supportSensitive` this becomes `capabilityOfBlockId(id, 'supportSensitive')`
 * and the set is deleted.
 *
 * Membership is `SUPPORT_SENSITIVE_BLOCK_TYPES` (`block-support.ts:22-32`)
 * intersected with this build's roster. The reference's `REDSTONE_TORCH`,
 * `REDSTONE_WIRE` and its three crops have no `BlockType` here — the redstone
 * pair is mx-redstone's vocabulary and the crops are farming, which
 * `docs/testing.md` §3-2 counts under item use.
 */
const SUPPORT_SENSITIVE_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'torch',
  'pressure_plate',
  'rail',
  'powered_rail',
  // `SURFACE_PLANT_BLOCK_TYPES` (`block-support.ts:4-12`), all seven.
  'sapling',
  'dandelion',
  'poppy',
  'brown_mushroom',
  'red_mushroom',
  'tall_grass',
  'fern',
  // `WATERSIDE_PLANT_BLOCK_TYPES` (`block-support.ts:14-18`), all three.
  'sugar_cane',
  'cactus',
  'lily_pad',
])

/**
 * Does this block need something under it to stay put?
 *
 * TOTAL over ids, including ones this build cannot name: an unrecognised byte is
 * NOT support-sensitive, which is the inert direction — it places, rather than
 * being refused for a reason nobody can name. That matches
 * `../chunk-store-port`'s rule that an unknown id reads as an ordinary cube.
 */
export const isSupportSensitive = (block: BlockId): boolean => {
  const type = blockTypeOfId(block)
  return type !== undefined && SUPPORT_SENSITIVE_BLOCK_TYPES.has(type)
}

/**
 * What the player is trying to put down, and where.
 *
 * `heldItem` is a `PlaceableItemType` — `ItemType & BlockType`, kernel's audit
 * §6-8 intersection — so "you cannot place a stick" is a TYPE ERROR at the call
 * site rather than a refusal at runtime. `../block-vocabulary`'s `isPlaceableItem`
 * is the proof obligation, and it belongs to whoever reads the hotbar.
 *
 * `playerFeet` is OPTIONAL and `undefined` means "there is nobody there", which
 * is the same convention `../mob/creeper-fuse` and `../mob/hostile-despawn` use
 * for a missing target. It is not a large distance and it is not the origin: a
 * world with no player in it must not refuse every placement near `(0, 0, 0)`.
 */
export type PlaceRequest = {
  readonly position: BlockPosition
  readonly heldItem: PlaceableItemType
  readonly playerFeet?: Position
}

/**
 * TOTAL, mirroring `./break-block`'s `BreakOutcome`. There is no error channel
 * here because there is none in `StageRegistration.run`
 * (`../frame-contract`), so a failure would have nowhere to go but a `catchAll`
 * that drops it.
 *
 * Every refusal names WHICH test failed rather than answering `false`, for the
 * reason `../mob/hostile-spawn` gives about its own verdict: 「a placement rule
 * that refuses everything and one that refuses everything FOR THE SAME REASON
 * are different bugs, and only the second is findable」. The mining-site preview
 * prints the tag.
 */
export type PlaceOutcome =
  /** The block went in. `consumed` is the item to take off the stack. */
  | {
      readonly _tag: 'Placed'
      readonly block: BlockId
      readonly consumed: PlaceableItemType
      readonly chunk: ChunkCoord
    }
  /** Something is already there and it is not replaceable. */
  | { readonly _tag: 'Occupied'; readonly existing: BlockId }
  /** The block would be inside the player's own body. */
  | { readonly _tag: 'InsidePlayer' }
  /** A support-sensitive block with nothing under it to hold it up. */
  | { readonly _tag: 'Unsupported'; readonly support: BlockId }
  /**
   * The item names a block this build has no id for.
   *
   * UNREACHABLE TODAY and kept anyway. `PlaceableItemType` is derived from the
   * two rosters, and every member of it has a registry row — but the rosters and
   * the registry are two transcriptions in `../block-vocabulary`, and kernel's
   * own `blockIdOf` records what the alternative costs: 「an unregistered type
   * silently becomes AIR, so the block does not merely misread, it VANISHES」.
   * A named refusal is the only answer that does not delete a cell.
   */
  | { readonly _tag: 'UnknownBlock' }
  /** Out of the resident area. NOT air — the world there is unknown, not empty. */
  | { readonly _tag: 'ChunkNotLoaded' }
  /** Below bedrock or above the build limit. */
  | { readonly _tag: 'OutOfWorld' }

/**
 * Decide, given what the store said is in the target cell and what is under it.
 *
 * PURE, TOTAL and separate from the store calls, which is `./explosion-crater`'s
 * split for `craterCells` and the same reason: the DECISION is the part worth
 * enumerating in a test and the store call is the part worth counting. It also
 * means the three refusals can be tested without a double.
 *
 * THE ORDER OF THE TESTS IS A DECISION, not an accident of writing:
 *
 *   1. residency and world bounds, because `ChunkNotLoaded` is not air
 *      (DN-GP-11) and every later test would be answering about a cell nobody
 *      knows;
 *   2. occupancy, because it is the cheapest and the most common refusal;
 *   3. the player's body, because it is about the cell rather than about its
 *      neighbours and needs no second read;
 *   4. support, which is the only test that costs another store call.
 *
 * Reordering 4 above 2 would read the cell below on every refused placement,
 * which is a store call per held mouse button per frame.
 */
export const placementVerdict = (
  request: PlaceRequest,
  target: BlockReading,
  supportBelow: BlockReading | undefined,
): PlaceOutcome | { readonly _tag: 'Allowed'; readonly block: BlockId } => {
  if (target._tag === 'ChunkNotLoaded') {
    return { _tag: 'ChunkNotLoaded' }
  }
  if (target._tag === 'OutOfWorld') {
    return { _tag: 'OutOfWorld' }
  }
  if (!isReplaceable(target.block)) {
    return { _tag: 'Occupied', existing: target.block }
  }

  const block = blockIdOf(request.heldItem)
  if (block === undefined) {
    return { _tag: 'UnknownBlock' }
  }

  if (request.playerFeet !== undefined && blockOverlapsPlayer(request.position, request.playerFeet)) {
    return { _tag: 'InsidePlayer' }
  }

  if (isSupportSensitive(block)) {
    // `undefined` is the caller saying it did not read — which it does not when
    // the block is not support-sensitive. Reaching here with `undefined` would
    // be this function being asked a question about a fact nobody measured, and
    // the answer that invents nothing is the refusal: a torch is not placed on
    // an unmeasured cell.
    if (supportBelow === undefined || supportBelow._tag !== 'Block') {
      return { _tag: 'Unsupported', support: 0 }
    }
    if (!canSupportAttachments(supportBelow.block)) {
      return { _tag: 'Unsupported', support: supportBelow.block }
    }
  }

  return { _tag: 'Allowed', block }
}

/**
 * Place a block, and report what happened.
 *
 * ONE OR TWO READS AND AT MOST ONE WRITE. The second read happens only for a
 * support-sensitive block, which is a torch or a plant and not the stone a
 * player spends a session stacking.
 *
 * `Unchanged` from the write is reported as `Occupied` rather than as success,
 * and that is not the same choice `./break-block` made. There, `Unchanged` means
 * the player swung at air and the honest answer is "nothing happened, and no
 * item". Here it means the cell already held the very block being placed — which
 * `isReplaceable` has just said is a replaceable one, so it can only be water
 * onto water or lava onto lava. Reporting `Placed` would consume an item off the
 * stack for a write that did not dirty the chunk.
 */
export const placeBlock = (
  store: ChunkStoreApi,
  request: PlaceRequest,
): Effect.Effect<PlaceOutcome> =>
  Effect.gen(function* () {
    const target = yield* store.getBlock(request.position)

    // The support read is CONDITIONAL and the condition is known before the
    // target read is interpreted, because it depends only on the held item. It
    // is issued after the target read rather than beside it so that a placement
    // into an occupied cell costs one call and not two.
    const block = blockIdOf(request.heldItem)
    const supportBelow =
      block !== undefined && isSupportSensitive(block)
        ? yield* store.getBlock(below(request.position))
        : undefined

    const verdict = placementVerdict(request, target, supportBelow)
    if (verdict._tag !== 'Allowed') {
      return verdict
    }

    const outcome = yield* store.setBlock(request.position, verdict.block)

    switch (outcome._tag) {
      case 'Written':
        return {
          _tag: 'Placed',
          block: verdict.block,
          consumed: request.heldItem,
          chunk: outcome.chunk,
        }

      // See the module header: the cell already held this exact block, so
      // nothing was dirtied and nothing may be taken off the stack.
      case 'Unchanged':
        return { _tag: 'Occupied', existing: outcome.previous }

      // The store changed its mind between the read and the write. That is the
      // window this file's header is about, and it is DECIDED rather than
      // asserted away: the answer is the same one the read would have given.
      case 'ChunkNotLoaded':
        return { _tag: 'ChunkNotLoaded' }

      case 'OutOfWorld':
        return { _tag: 'OutOfWorld' }
    }
  })
