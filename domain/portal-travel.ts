/**
 * APPLYING a portal crossing: the step that makes `travels: true` mean something.
 *
 * ---------------------------------------------------------------------------
 * The three parts, and where each of them lives
 * ---------------------------------------------------------------------------
 *
 *   WHEN   `./portal-dwell`'s `stepPortalDwell` — four seconds in the block,
 *          then a cooldown. Holds no coordinate and knows no world.
 *   WHERE  `./nether-travel-port`'s `resolveNetherTravel` — mc-worldgen's rule,
 *          mirrored. Scales the position and picks or plans a portal.
 *   APPLY  this file — `moveTo` the destination, `setDimension` the plan's
 *          `toDimension`, in that order and never one without the other.
 *
 * `./player-port`'s header spent a long paragraph on why APPLY could not be
 * written, and the reason was that `from` had no source and `plan.toDimension`
 * had no receiver. Both now exist on `PlayerServiceApi`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PAIRING IS HERE AND NOT A SINGLE mc-sim METHOD
 * ---------------------------------------------------------------------------
 *
 * `mc-sim/application/player-service.ts` declines to fuse `moveTo` and
 * `setDimension` into one `travelTo`, and states the cost of declining: 「The
 * pairing is the CALLER's to get right and it is a rule, so it lives in
 * mx-gameplay where the other portal rules are」. This file is that caller, and
 * `applyPortalTravel` is the ONLY place in this repository where the two are
 * called — which is what makes the pairing checkable rather than a convention.
 *
 * A `moveTo` without the `setDimension` is not this rule minus one step; it is
 * the defect `./player-port`'s header describes: a destination computed in the
 * OTHER world's coordinate frame, applied to a world that was never switched,
 * leaving the player at a scaled point with the same chunks around them.
 * `test/portal-travel.test.ts` fails on exactly that mutation.
 *
 * ---------------------------------------------------------------------------
 * `knownPortals` IS EMPTY, DELIBERATELY, AND THIS IS THE RESTRICTION
 * ---------------------------------------------------------------------------
 *
 * `resolveNetherTravel` takes the DESTINATION dimension's portal list so that an
 * existing portal within `PORTAL_SEARCH_RADIUS` is reused instead of a second
 * one being built beside it. **Nothing in this organisation owns that list.**
 * Measured across mc-sim, mc-worldgen and mx-gameplay: the only occurrences of
 * such a list anywhere are the parameter and its use inside mc-worldgen's rule.
 *
 * The consequence is REAL AND VISIBLE: every crossing plans a fresh portal, and
 * a player who walks back through arrives beside their original rather than at
 * it. That is wrong, and it is wrong in a way that is stated, tested
 * (`test/portal-travel.test.ts` pins `portalToCreate` as always `Some`) and
 * cheap to correct once an owner exists — `candidates` is a parameter here for
 * that reason and not for symmetry.
 *
 * The alternative was a portal registry invented in this repository. mc-worldgen
 * declined to grow one as a side effect of porting a distance comparison
 * (`docs/responsibility.md` §6) and the reference's owner is a SERVICE with a
 * save file. A registry here would be a second owner of world state, in the
 * repository whose whole discipline is that it owns rules and not nouns.
 */
import { Effect } from 'effect'
import { type BlockPosition } from './chunk-store-port'
import { type Dimension, type PortalTravelPlan, resolveNetherTravel } from './nether-travel-port'
import { type PlayerServiceApi } from './player-port'

/**
 * The candidate list every crossing currently gets.
 *
 * Exported so that `test/portal-travel.test.ts` can name the restriction rather
 * than restate `[]`, and so that the day an owner appears the compiler points at
 * every place that assumed emptiness.
 */
export const NO_KNOWN_PORTALS: ReadonlyArray<BlockPosition> = []

/**
 * Perform a crossing: resolve the plan, move, and switch.
 *
 * TOTAL in its decision and effectful only in its application. The plan is
 * computed by mc-worldgen's rule from the player's CURRENT dimension, which is
 * read here rather than passed, because a caller that supplied `from` could
 * supply one the player is not in — and `resolveNetherTravel` would then compute
 * a destination in the wrong frame with no type able to object.
 *
 * ORDER: `moveTo` then `setDimension`. `mc-sim/test/player-service.test.ts` pins
 * that the two orders leave identical state, so this order is a readability
 * choice and not a correctness one — but it is fixed here so that a reader
 * comparing this with the reference (`physics-stage-portal.ts:59-63`, which also
 * places before it switches) sees the same sequence.
 *
 * Returns the plan so that a caller can act on `portalToCreate`. NOTHING IN THIS
 * REPOSITORY DOES YET: building the portal is a chunk write, the layout comes
 * from `./portal-frame-port`, and wiring it belongs with the block-write path
 * rather than here. Returning it rather than dropping it is what keeps that a
 * pending call site instead of a lost value.
 */
export const applyPortalTravel = (
  player: PlayerServiceApi,
  playerCell: BlockPosition,
  candidates: ReadonlyArray<BlockPosition> = NO_KNOWN_PORTALS,
): Effect.Effect<PortalTravelPlan> =>
  Effect.gen(function* () {
    const from: Dimension = yield* player.dimension
    const plan = resolveNetherTravel(from, playerCell, candidates)

    yield* player.moveTo({ x: plan.destination.x, y: plan.destination.y, z: plan.destination.z })
    yield* player.setDimension(plan.toDimension)

    return plan
  })
