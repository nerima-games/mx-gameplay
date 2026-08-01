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
 * `knownPortals` remains optional so direct callers keep the original empty
 * behaviour. The gameplay stage supplies a host-owned snapshot for the
 * destination dimension and publishes the completed plan through its outbox;
 * this rule still owns neither the portal ledger nor world generation.
 */
import { Effect } from 'effect'
import { type BlockPosition } from './chunk-store-port'
import { type Dimension, type PortalTravelPlan, resolveNetherTravel } from './nether-travel-port'
import { type PlayerServiceApi } from './player-port'

/**
 * Stable empty default for direct callers and frame states without a supplied
 * destination snapshot.
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
 * Returns the plan so that the gameplay stage can publish `portalToCreate` to
 * the host. Building the portal remains a chunk write owned by the host; this
 * rule reports the required layout without performing world generation.
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
