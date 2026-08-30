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
 * the former `../block-vocabulary`'s `REPLACEABLE_IDS` had — its own comment
 * recorded the consequence in two halves, 「falling sand and gravel did not displace lava, and
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
 * THE PER-BLOCK PLACEMENT RULES — and this section used to say they did not
 * exist. It said:
 *
 *     The reference has four more beyond support: mushrooms need light <= 12,
 *     sugar cane needs adjacent water, cactus needs four air sides, doors need
 *     the cell above (`block-service-place-plan.ts:208-214`). […] they are
 *     deferred rather than refused, and they are deferred because each is
 *     ANOTHER FILE by DN-GP-9 rather than another branch of this one. A
 *     `PlacementRule` array here would be `block-service-place-plan.ts`
 *     reappearing: five unrelated block-name tests in one function.
 *
 * All four are written now, one per file, and this file CALLS them:
 *
 *     ./place-mushroom-light     light <= 12                     1 light read
 *     ./place-sugar-cane-water   water beside the support        0 or 4 reads
 *     ./place-cactus-sides       four sides air                  4 reads
 *     ./place-door-upper         the cell above, and it fills it 1 read + 1 write
 *
 * The deferral's reason survives the deferral ending. There is still no
 * `PlacementRule` array here and there is still no block name in this file: each
 * of the four asks kernel's registry whether the byte is ITS block, answers
 * `undefined` for every other placement without reading anything, and is called
 * by name below. The composition is one place; the five block-name tests are in
 * the five files that own those blocks.
 *
 * Kernel 0.2.5 gives the support-sensitive plants item forms, so mushrooms,
 * sugar cane and cactus now reach these rules through `request.heldItem`. The
 * gates remain unchanged: support comes from kernel's `supportRule`, mushrooms
 * additionally require light <= 12, sugar cane requires adjacent water, and a
 * cactus requires four clear horizontal sides. `test/placement-rules.test.ts`
 * exercises those combinations through `placeBlock` with real item literals.
 */
import { Effect } from 'effect'
import {
  type BlockId,
  type BlockPosition,
  type BlockReading,
  type ChunkCoord,
  type ChunkStoreApi,
} from '../chunk-store-port.js'
import {
  adjacentBlockPosition,
  blockIdOf,
  blockOfPlaceableItem,
  blockPosition,
  canBlockStaySupported,
  capabilityOfBlockId,
  isSupportSensitiveBlockId,
  type PlaceableItemType,
  type Position,
} from '@nerima-games/mc-kernel'
import { cactusSidesObjection, type CactusSidesRefusal } from './place-cactus-sides.js'
import { doorUpperCell, type DoorUpperCell } from './place-door-upper.js'
import { mushroomLightObjection, type MushroomLightRefusal } from './place-mushroom-light.js'
import { sugarCaneWaterObjection, type SugarCaneWaterRefusal } from './place-sugar-cane-water.js'

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
 * FEET plus one half-height (the position mc-sim stores is the feet, while
 * `Position` and `BlockPosition` deliberately remain distinct types).
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
 * Does this block need something under it to stay put?
 *
 * THE TABLE THIS USED TO CARRY IS GONE, and its own comment named the day:
 * 「When kernel adds `supportSensitive` this becomes `capabilityOfBlockId(id,
 * …)` and the set is deleted」. Kernel added the column — as `supportRule`
 * rather than as a boolean, which is the better shape and the one the audit
 * always specified — so the set is deleted and this delegates to kernel's
 * `supportRuleOfBlockId` / `isSupportSensitiveBlockId` directly.
 *
 * The set was here on a stated objection: kernel's registry had no `supportRule`
 * column, so transcribing one into the capability mirror would have been this
 * repository inventing a kernel flag. That objection is answered rather than
 * overridden. The mirror now transcribes a column that EXISTS.
 *
 * Kept as an export because it is on this repository's published surface
 * (`test/public-api.test.ts`) and `apps/preview-mining-site` calls it to decide
 * whether to read the cell below. The answer is kernel's.
 *
 * RENAMED from `isSupportSensitive`, which is kernel's name for the predicate
 * over a RULE. The former block-vocabulary.ts mirror had to carry kernel's
 * names exactly -- a renamed mirror typechecks, passes every local test, and
 * yields a name that does not exist on the day the import is repointed -- so
 * when the two collided, the local one moved rather than the mirror. That
 * direction was not a preference: the mirror was a transcription and had no
 * freedom, while this name is ours to choose. The name stays post-repoint
 * because the collision itself is real: kernel's own `isSupportSensitive`
 * (imported directly now) takes a `SupportRule`, and this function takes a
 * `BlockId`.
 *
 * TOTAL over ids, including ones this build cannot name: an unrecognised byte is
 * NOT support-sensitive, which is the inert direction — it places, rather than
 * being refused for a reason nobody can name.
 */
export const isSupportSensitiveOfBlock = (block: BlockId): boolean => isSupportSensitiveBlockId(block)

/**
 * What the player is trying to put down, and where.
 *
 * `heldItem` is a `PlaceableItemType` — `ItemType & BlockType`, kernel's audit
 * §6-8 intersection — so "you cannot place a stick" is a TYPE ERROR at the call
 * site rather than a refusal at runtime. kernel's `isPlaceableItem`
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
 * (kernel's `domain/frame.ts`), so a failure would have nowhere to go but a `catchAll`
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
      /**
       * Cells beyond `request.position` that this placement also filled.
       *
       * EMPTY FOR EVERY BLOCK BUT A DOOR, which is the only one of the four
       * per-block rules that writes a second cell (`./place-door-upper`). It is
       * an array rather than an optional member so that a caller iterating it
       * needs no test, and it holds the cells whose write actually came back
       * `Written` — the same discipline `./explosion-crater` uses for the cells
       * it reports.
       *
       * IT IS NOT A SECOND ITEM. `consumed` stays one, because one door in the
       * hand becomes one door in the world; the second cell is the other half of
       * the same object rather than a second placement.
       */
      readonly alsoPlaced: ReadonlyArray<BlockPosition>
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
   * the registry are two of kernel's own files, taken directly since W1-M4, and
   * kernel's own `blockIdOf` records what the alternative costs: 「an unregistered type
   * silently becomes AIR, so the block does not merely misread, it VANISHES」.
   * A named refusal is the only answer that does not delete a cell.
   */
  | { readonly _tag: 'UnknownBlock' }
  /** Out of the resident area. NOT air — the world there is unknown, not empty. */
  | { readonly _tag: 'ChunkNotLoaded' }
  /** Below bedrock or above the build limit. */
  | { readonly _tag: 'OutOfWorld' }
  /**
   * The four per-block refusals, each owned by the file that owns the block.
   *
   * They are IMPORTED rather than spelled here, and that is the difference
   * between this union and the reference's one function: adding a fifth
   * per-block rule adds a file and one member to this list, and touches no
   * branch of `placementVerdict`. The tags stay flat — `TooBright` rather than
   * `PerBlock { rule, reason }` — because a caller switching on `_tag` is the
   * whole reason every refusal is named, and one more level of nesting would put
   * the answer back behind a second switch.
   */
  | MushroomLightRefusal
  | SugarCaneWaterRefusal
  | CactusSidesRefusal
  /** A door with something in the way above it. `./place-door-upper`. */
  | { readonly _tag: 'NoRoomAbove' }

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
  if (!capabilityOfBlockId(target.block, 'replaceable')) {
    return { _tag: 'Occupied', existing: target.block }
  }

  const block = blockIdOf(blockOfPlaceableItem(request.heldItem))
  /* v8 ignore start -- UnknownBlock is unreachable in a green tree: PlaceableItemType
   * is exactly the roster `blockIdOf` is pinned total over
   * (kernel's own type declaration), so `blockIdOf(blockOfPlaceableItem(x))`
   * never returns `undefined` for a request this type permits. Kept for the reason
   * the `UnknownBlock` tag's own comment states, on `PlaceOutcome` above. */
  if (block === undefined) {
    return { _tag: 'UnknownBlock' }
  }
  /* v8 ignore stop */

  if (request.playerFeet !== undefined && blockOverlapsPlayer(request.position, request.playerFeet)) {
    return { _tag: 'InsidePlayer' }
  }

  if (isSupportSensitiveOfBlock(block)) {
    // `undefined` is the caller saying it did not read — which it does not when
    // the block is not support-sensitive. Reaching here with `undefined` would
    // be this function being asked a question about a fact nobody measured, and
    // the answer that invents nothing is the refusal: a torch is not placed on
    // an unmeasured cell.
    if (supportBelow === undefined || supportBelow._tag !== 'Block') {
      return { _tag: 'Unsupported', support: 0 }
    }
    // ONE CALL, NOT TWO PREDICATES ANDED, and the difference is F7. This used to
    // ask `canSupportAttachments` — the reference's FALLBACK arm — for every
    // support-sensitive block, including the thirteen the reference answers from
    // a per-block list instead. The list wins over the negative set, so asking
    // the set first refuses a lily pad on water (water is non-supporting) and
    // allows it on stone: wrong in both directions on the only cell it belongs
    // on. `canBlockStaySupported` is the composition in the reference's order.
    if (!canBlockStaySupported(block, supportBelow.block)) {
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
    const block = blockIdOf(blockOfPlaceableItem(request.heldItem))
    const supportBelow =
      block !== undefined && isSupportSensitiveOfBlock(block)
        ? yield* store.getBlock(
            adjacentBlockPosition(
              blockPosition(request.position.x, request.position.y, request.position.z),
              'down',
            ),
          )
        : undefined

    const verdict = placementVerdict(request, target, supportBelow)
    if (verdict._tag !== 'Allowed') {
      return verdict
    }

    // THE FOUR PER-BLOCK RULES, in the reference's own order
    // (`PLACEMENT_RULES`, `block-service-place-plan.ts:207-213`): support —
    // which `placementVerdict` has just done — then mushroom, sugar cane,
    // cactus, door. The order is transcribed rather than chosen, because these
    // are refusals about DIFFERENT blocks and no two can fire on one placement;
    // preserving it costs nothing and means a reader can diff the two files.
    //
    // EACH READS NOTHING FOR A BLOCK THAT IS NOT ITS OWN. That is the cost
    // argument for putting them on this path at all: stacking stone still costs
    // one read, one write, and four pure registry lookups.
    const tooBright = yield* mushroomLightObjection(store, verdict.block, request.position)
    if (tooBright !== undefined) {
      return tooBright
    }

    const noWater = yield* sugarCaneWaterObjection(store, verdict.block, request.position, supportBelow)
    if (noWater !== undefined) {
      return noWater
    }

    const sidesBlocked = yield* cactusSidesObjection(store, verdict.block, request.position)
    if (sidesBlocked !== undefined) {
      return sidesBlocked
    }

    // The door rule is the one that answers with WORK rather than only with a
    // refusal, so its verdict is held across the write below. See
    // `./place-door-upper` on why the cell is returned rather than written there.
    const upper: DoorUpperCell = yield* doorUpperCell(store, verdict.block, request.position)
    if (upper._tag === 'NoRoomAbove') {
      return { _tag: 'NoRoomAbove' }
    }

    const outcome = yield* store.setBlock(request.position, verdict.block)

    switch (outcome._tag) {
      case 'Written': {
        // The door's upper half. It is written AFTER the lower one and only
        // when the lower one landed, so a refused placement cannot leave half a
        // door standing in the world.
        //
        // A NON-`Written` ANSWER HERE IS REPORTED BY OMISSION rather than by
        // undoing the lower cell. The cell was read as air one instruction ago,
        // so reaching this needs the store to have changed underneath — the
        // window this file's header is about — and the two available answers are
        // a compensating write that can itself fail, or a door with no top. The
        // second is visible, breakable and recorded in `alsoPlaced`; the first
        // is a second failure mode with nowhere to report itself.
        const alsoPlaced: Array<BlockPosition> = []
        if (upper._tag === 'Clear') {
          const upperOutcome = yield* store.setBlock(upper.cell, verdict.block)
          if (upperOutcome._tag === 'Written') {
            alsoPlaced.push(upper.cell)
          }
        }

        return {
          _tag: 'Placed',
          block: verdict.block,
          consumed: request.heldItem,
          chunk: outcome.chunk,
          alsoPlaced,
        }
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
      // exhaustiveness arm over `BlockWriteOutcome`, a closed four-tag union
      // (chunk-store-port.ts): `Written`, `Unchanged`, `ChunkNotLoaded` and
      // `OutOfWorld` are all handled above, so no input can reach this arm.
      /* v8 ignore start */
      default: {
        const exhaustive: never = outcome
        return exhaustive
      }
      /* v8 ignore stop */
    }
  })
