/**
 * ONE RULE, ONE FILE (DN-GP-9): a flint and steel used on an obsidian frame
 * fills its interior with portal blocks.
 *
 * The reference implementation's
 * `<reference-impl>/packages/app/application/frame/stages/interaction-flint-steel-portal.ts`,
 * and the first ITEM USE in this repository — plan.md §3.11's responsibility 1
 * names 「採掘 / 設置 / アイテム使用」 and only the first two existed.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE ITEM USE THAT COULD BE BUILT, AND MOST OF THE OTHERS CANNOT
 * ---------------------------------------------------------------------------
 *
 * `flint_and_steel` and `fire_charge` are in kernel's `ITEM_TYPES`
 * (`../item-vocabulary`). `bucket`, `water_bucket`, `lava_bucket`, `shears`,
 * `bow`, `arrow`, `ender_pearl` and `hoe` are NOT — kernel's roster is 97 items
 * and none of those eight is one of them. So the other item uses in the
 * reference's `interaction-item-use-handler/` directory are not deferred here
 * for want of a rule; they cannot be SPELLED, and writing `'bucket'` would be
 * this repository inventing a kernel literal, which is the failure kernel's
 * audit §4.9.1(c) names and which mc-sim's seven-literal request is the
 * precedent for doing properly. `docs/testing.md` §3-1 carries the list.
 *
 * ---------------------------------------------------------------------------
 * THE DETECTION IS NOT HERE, AND THAT SPLIT IS THE REFERENCE'S OWN
 * ---------------------------------------------------------------------------
 *
 * `docs/testing.md` §3-1 used to argue portals belonged to mc-physics and mc-sim
 * because they 「move an entity that has a position」. mc-worldgen answered the
 * detection half by building it (`domain/portal-frame.ts`), and its header names
 * the evidence: the reference splits this responsibility across three files, and
 * only one of them is in a world domain.
 *
 *     packages/world/domain/nether/portal-frame.ts        the SHAPE  -> mc-worldgen
 *     packages/app/.../interaction-flint-steel-portal.ts  the ITEM USE -> THIS FILE
 *     packages/app/.../physics-stage-portal.ts            MOVING THE PLAYER -> neither
 *
 * The third is still nobody's here, and it is not this file's to take: it reads
 * a player's position, decides they have stood in a portal long enough, and puts
 * them somewhere else in another dimension. That needs mc-sim's roster and a
 * dimension service, and neither exists.
 *
 * So this rule consumes the shape through `../portal-frame-port`, which mirrors
 * mc-worldgen's rule exactly as `../chunk-store-port` mirrors its service.
 *
 * ---------------------------------------------------------------------------
 * READ EVERYTHING, THEN DECIDE, THEN WRITE — AND THE ORDER IS LOAD-BEARING
 * ---------------------------------------------------------------------------
 *
 * `../chunk-window` opens a synchronous view over the chunks around the ignition
 * cell, detection runs against that view, and only then does anything write. The
 * window is a LIVE view of mc-worldgen's buffers, so the first `setBlock` below
 * invalidates it — which is why `frame.interior` is materialised by detection
 * and iterated afterwards, and why nothing calls `blockAt` again once the loop
 * has started. That constraint is stated in `../chunk-window`'s header and this
 * is the call site it is about.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RULE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * PICK THE CELL. `adjacentToHit` turns a raycast hit into the cell one step
 * along the face normal, which is a question about where the player is LOOKING —
 * mc-render's raycast and mc-sim's pose. This rule is handed a cell, exactly as
 * `./break-block` and `./place-block` are.
 *
 * SPEND THE ITEM. The reference damages the held flint and steel by one point
 * (`interaction-flint-steel-handler.ts`'s `damageHeldFlintAndSteel`). Durability
 * is a property of an inventory SLOT and mc-sim's `InventoryService` owns slots;
 * `stages/registration.ts` parks the fact that an item was used, for the same
 * reason and in the same shape as `consumedItems`.
 *
 * REGISTER THE PORTAL. The reference calls `netherService.registerPortal` so
 * that a return trip reuses the same portal. That is a persistent link between
 * two dimensions — state, and therefore mc-sim's or mc-save's by the test in
 * `stages/registration.ts`'s header. Nothing here holds it.
 *
 * DETONATE TNT. The reference's flint-and-steel handler tries three things in
 * order: TNT, then a portal, then fire. The TNT arm is absent here and the
 * missing piece is nameable — `../mob/explosion.ts`'s `ExplosionSource` is the
 * single literal `'creeper'` and its only power is `CREEPER_EXPLOSION_POWER`, so
 * a TNT blast has no power to be given and no source to be attributed to. It is
 * also the arm that needs the player's own health (`applyTntPlayerDamage`),
 * which is mc-sim's. Two missing things, both named, neither invented here.
 *
 * SOUND. `soundManager.playEffect('blockPlace', ...)` is mc-audio's, and
 * mx-gameplay has no edge to it (plan.md §2.1). Whoever drains the outbox plays
 * the sound.
 */
import { Effect, Option } from 'effect'
import { blockIdOf } from '../block-vocabulary.js'
import { chunkCoordsAround, openChunkWindow } from '../chunk-window.js'
import type { BlockId, BlockPosition, ChunkStoreApi } from '../chunk-store-port.js'
import { MAX_PORTAL_WIDTH, detectNetherPortal, type PortalFrame } from '../portal-frame-port.js'

/**
 * How far from the ignition cell the chunk window must reach.
 *
 * DERIVED FROM THE DETECTOR'S OWN BOUND rather than picked. `countAir` is
 * called with `MAX_PORTAL_WIDTH + 1` as its cap, so the leftward walk probes at
 * most `MAX_PORTAL_WIDTH` cells beyond the anchor, and the ring sits one cell
 * beyond the widest accepted interior. `MAX_PORTAL_WIDTH + 1` covers both with
 * one cell to spare, and the spare is deliberate: too large costs one extra
 * `peek` of a chunk that is usually not resident anyway, while too small
 * silently refuses a portal a player legitimately built.
 *
 * IT IS BRACKETED FROM THE EXPENSIVE SIDE, and finding out how took a mutation
 * run. `test/ignite.test.ts`'s first maximum-size test left a shrunken radius
 * GREEN, because a portal ignited at its bottom-left corner never walks: the
 * ring is one cell away. The test that bites ignites the FAR END of a
 * maximum-width portal across a chunk boundary, which is the only shape that
 * makes the walk go the full distance.
 *
 * The VERTICAL extent needs no radius: chunks are full height
 * (`../chunk-store-port`'s `CHUNK_HEIGHT`), so a column is resident or it is
 * not.
 */
export const PORTAL_WINDOW_RADIUS: number = MAX_PORTAL_WIDTH + 1

/**
 * TOTAL, mirroring `./place-block`'s `PlaceOutcome`. There is no error channel
 * because `StageRegistration.run` has none (`../frame-contract`).
 *
 * Every refusal names WHICH test failed rather than answering `false`, which is
 * the shape `./place-block` and `../mob/hostile-spawn` argue: 「a placement rule
 * that refuses everything and one that refuses everything FOR THE SAME REASON
 * are different bugs, and only the second is findable」. The reference answers
 * `boolean` here, and its caller cannot tell a dirt wall from an unloaded chunk.
 */
export type IgnitePortalOutcome =
  /** The frame lit. `cells` are the interior cells whose write actually landed. */
  | {
      readonly _tag: 'Lit'
      readonly frame: PortalFrame
      readonly cells: ReadonlyArray<BlockPosition>
    }
  /**
   * There is no valid frame around this cell.
   *
   * The common answer, and it covers the ordinary case of lighting a fire
   * against a wall — which is why `./ignite-fire` is what a caller tries next.
   */
  | { readonly _tag: 'NoFrame' }
  /**
   * Detection could not see far enough: a chunk in the window is not resident,
   * or a probe left the world vertically.
   *
   * DISTINCT FROM `NoFrame` and that is the point of `unreadableProbes`. An
   * unreadable cell can only ever REFUSE a frame (`UNREADABLE_BLOCK` is neither
   * air nor obsidian), never manufacture one, so the answer is never wrong in
   * the dangerous direction — but "I could not see" and "there is nothing here"
   * are different things to tell the player, and only the first is worth
   * retrying.
   */
  | { readonly _tag: 'ChunkNotLoaded' }
  /**
   * This build has no id for `nether_portal`.
   *
   * UNREACHABLE TODAY and kept for `./place-block`'s `UnknownBlock` reason:
   * kernel's registry carries the row, `test/block-vocabulary-mirror.test.ts`
   * pins `blockIdOf` total over all 120 block types, and a named refusal is the
   * only answer that does not write a byte nobody chose into the world.
   */
  | { readonly _tag: 'UnknownBlock' }

/**
 * Light the portal around `ignition`, and report what happened.
 *
 * ONE `peek` PER CHUNK IN THE WINDOW, then pure reads, then one `setBlock` per
 * interior cell. The reads are why this is not `getBlock` in a loop; see
 * `../chunk-window`'s header for the three ways to bridge a synchronous rule to
 * an `Effect`-shaped store and why this is the one chosen.
 *
 * NOTHING IS DISTURBED. `../falling-block`'s queue answers "does the block ABOVE
 * this cell now fall into it", and every cell written here was air a moment ago
 * — filling a hole cannot start a fall, it can only stop one. A break disturbs
 * because it makes a hole; this makes the opposite of one.
 *
 * `Unchanged` cannot happen on a cell detection has just proved to be air, and
 * it is handled anyway: `run` has no error channel, so the four write outcomes
 * are enumerated rather than assumed, and a cell that did not change is a cell
 * that is not reported as lit.
 */
export const ignitePortal = (
  store: ChunkStoreApi,
  ignition: BlockPosition,
): Effect.Effect<IgnitePortalOutcome> =>
  Effect.gen(function* () {
    const portalBlock: BlockId | undefined = blockIdOf('nether_portal')
    /* v8 ignore start -- UnknownBlock is unreachable in a green tree: `nether_portal`
     * is one of the 120 `BlockType`s `test/block-vocabulary-mirror.test.ts` pins
     * `blockIdOf` total over, so `blockIdOf('nether_portal')` never returns
     * `undefined`. Kept for the reason `./place-block.ts`'s own `UnknownBlock` arm
     * is: it fails toward a NAMED refusal rather than a portal silently vanishing.
     * Named in `vitest.config.ts`'s coverage-threshold comment as one of the five
     * documented-unreachable branches the 99% gate accounts for. */
    if (portalBlock === undefined) {
      return { _tag: 'UnknownBlock' }
    }
    /* v8 ignore stop */

    const window = yield* openChunkWindow(store, chunkCoordsAround(ignition, PORTAL_WINDOW_RADIUS))
    const detected = detectNetherPortal(window.blockAt, ignition)

    if (Option.isNone(detected)) {
      // The ORDER of these two answers is a decision. A window with an absent
      // chunk in it can refuse a frame that is really there, so "I could not
      // see" is checked first and reported in preference to "there is nothing
      // here" — the opposite order would tell a player at the edge of the loaded
      // area that their portal is malformed.
      return window.unreadableProbes() > 0 ? { _tag: 'ChunkNotLoaded' } : { _tag: 'NoFrame' }
    }

    const frame = detected.value

    // FROM HERE ON `window.blockAt` IS STALE. `../chunk-window` peeks LIVE
    // buffers, so the first write below changes what it would answer.
    // `frame.interior` was materialised by detection and is iterated instead.
    const cells: Array<BlockPosition> = []
    for (const cell of frame.interior) {
      const outcome = yield* store.setBlock(cell, portalBlock)
      switch (outcome._tag) {
        case 'Written': {
          cells.push(cell)
          break
        }

        // Detection proved every one of these cells was air a moment ago, so
        // none of the three is reachable from a green tree. They are decided
        // rather than asserted away, for `./place-block`'s reason: the window
        // between a read and a write is real, and the answer that invents
        // nothing is to leave the cell out of the report.
        /* v8 ignore start */
        case 'Unchanged':
        case 'ChunkNotLoaded':
        case 'OutOfWorld': {
          break
        }
        /* v8 ignore stop */
        // exhaustiveness arm over BlockWriteOutcome, a closed four-tag union
        // (chunk-store-port.ts's BlockWriteOutcome); 'Written', 'Unchanged',
        // 'ChunkNotLoaded' and 'OutOfWorld' are the only reachable tags and
        // all four are handled above, so no input can reach this arm.
        /* v8 ignore start */
        default: {
          const exhaustive: never = outcome
          void exhaustive
          break
        }
        /* v8 ignore stop */
      }
    }

    return { _tag: 'Lit', frame, cells }
  })
