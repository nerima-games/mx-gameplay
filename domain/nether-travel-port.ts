/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-worldgen`'s nether travel rule.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * mc-worldgen is a legitimate `dependencies` edge for this repository, so this
 * mirror stands in for an UNPUBLISHED import rather than a forbidden one —
 * exactly as `./chunk-store-port` and `./portal-frame-port` do, and for the same
 * plan.md §6 Step 3 reason.
 *
 * WHEN mc-worldgen IS PUBLISHED:
 *   1. add `@nerima-games/mc-worldgen` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './nether-travel-port'` at `'@nerima-games/mc-worldgen'`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS NOW WHEN IT COULD NOT BEFORE
 * ---------------------------------------------------------------------------
 *
 * `./player-port`'s header recorded the blocker precisely: 「`resolveNetherTravel`
 * IS NOT ON mc-worldgen's BARREL, so there is nothing here to mirror even if the
 * two arguments could be produced. Its `Dimension` is declared 「PROVISIONALLY」
 * and kept off `index.ts` deliberately … A mirror of it would be this repository
 * depending on exactly the spelling that file refuses to publish.」
 *
 * That was correct and it has been resolved at the source rather than worked
 * around here. mc-worldgen has CLAIMED the word — `domain/nether-travel.ts`'s
 * header now reads 「OWNED HERE」 where it read 「NOT CLAIMING THE WORD」 — and
 * publishes both `Dimension` and `resolveNetherTravel` from its barrel. The
 * mirror is therefore of a PUBLISHED module, which is the test
 * `./portal-frame-port` states: 「a mirror's home is decided by WHOSE BARREL
 * REPLACES IT」.
 *
 * `Dimension` LIVES HERE AND NOT IN `./player-port`, and that is that same test
 * applied twice. `./player-port` is replaced by `@nerima-games/mc-sim`, and
 * mc-sim's barrel deliberately does NOT re-export its own worldgen mirror — so
 * `Dimension` does not come back from mc-sim on repoint day. It comes back from
 * `@nerima-games/mc-worldgen`, which is the barrel THIS file is replaced by.
 * Declaring it in `./player-port` would be the defect `./chunk-store-port`'s
 * header records: a symbol sitting in a mirror whose source did not have it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS MIRRORED, AND THE ONE THING THAT IS NOT
 * ---------------------------------------------------------------------------
 *
 * The scaling pair and the search are transcribed from
 * `mc-worldgen/domain/nether-link.ts` because `resolveNetherTravel` composes
 * them and a mirror of a composition without its parts cannot be checked
 * against anything. `test/nether-travel-mirror.test.ts` runs the transcribed
 * rule over the cases mc-worldgen's own test enumerates.
 *
 * `generatePortalLayout` is NOT re-transcribed: `./portal-frame-port` already
 * carries it, and two copies in one repository would be the 「二つの綴り」 failure
 * happening locally. `PortalTravelPlan.portalToCreate` therefore carries that
 * file's `PortalLayout`.
 */
import { Option } from 'effect'
import { type BlockPosition } from './chunk-store-port'
import { generatePortalLayout, type PortalAxis, type PortalLayout } from './portal-frame-port'

/**
 * Which world a cell — or a player — is in.
 *
 * TRANSCRIBED CHARACTER FOR CHARACTER from
 * `mc-worldgen/domain/nether-travel.ts`. A closed literal union's MEMBERSHIP IS
 * THE TYPE, so a copy that dropped `'end'` — which no rule in this repository
 * reaches — would be a different type under the same name, typechecking locally
 * and failing at the seam on repoint day.
 *
 * The reference implementation declares `Dimension` TWICE
 * (`packages/world/domain/nether/nether-travel.ts:17` and
 * `packages/worker/domain/terrain-worker-protocol.ts:18`). This repository
 * mirrors the first and only the first.
 */
export type Dimension = 'overworld' | 'nether' | 'end'

/** Eight Overworld cells to one Nether cell. Transcribed; see mc-worldgen. */
export const NETHER_HORIZONTAL_RATIO = 8

/** How far from the scaled destination an existing portal may be and still be reused. */
export const PORTAL_SEARCH_RADIUS = 128

const DEFAULT_PORTAL_WIDTH = 2
const DEFAULT_PORTAL_HEIGHT = 3
const DEFAULT_PORTAL_AXIS: PortalAxis = 'x'

const blockPosition = (x: number, y: number, z: number): BlockPosition => ({ x, y, z })

/** Scale an Overworld cell into the Nether. */
export const overworldToNether = (pos: BlockPosition): BlockPosition =>
  blockPosition(
    Math.floor(pos.x / NETHER_HORIZONTAL_RATIO),
    pos.y,
    Math.floor(pos.z / NETHER_HORIZONTAL_RATIO),
  )

/**
 * Scale a Nether cell back into the Overworld.
 *
 * NOT the inverse of `overworldToNether`, and the asymmetry is the rule rather
 * than a defect: eight Overworld cells share one Nether cell.
 */
export const netherToOverworld = (pos: BlockPosition): BlockPosition =>
  blockPosition(pos.x * NETHER_HORIZONTAL_RATIO, pos.y, pos.z * NETHER_HORIZONTAL_RATIO)

/** Squared Euclidean distance. Squared because nothing here needs the root. */
const distanceSquared = (a: BlockPosition, b: BlockPosition): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/** The portal nearest to `target` within `maxDistance`, or `None`. */
export const findNearestPortal = (
  candidates: ReadonlyArray<BlockPosition>,
  target: BlockPosition,
  maxDistance: number,
): Option.Option<BlockPosition> => {
  if (!Number.isFinite(maxDistance) || maxDistance < 0) {
    return Option.none()
  }
  const maxSq = maxDistance * maxDistance

  return candidates.reduce<Option.Option<BlockPosition>>((best, candidate) => {
    const candidateSq = distanceSquared(candidate, target)
    if (candidateSq > maxSq) {
      return best
    }
    const incumbent = Option.getOrNull(best)
    if (incumbent === null) {
      return Option.some(candidate)
    }
    return distanceSquared(incumbent, target) <= candidateSq ? best : Option.some(candidate)
  }, Option.none())
}

export type PortalTravelPlan = {
  readonly toDimension: Dimension
  /** Where the traveller comes out. A reused portal's own cell, not the scaled point. */
  readonly destination: BlockPosition
  /** The portal to build, or `None` when an existing one is being reused. */
  readonly portalToCreate: Option.Option<PortalLayout>
}

/**
 * Resolve where a Nether portal at `playerPos` in `from` comes out.
 *
 * `from === 'end'` RETURNS TO THE OVERWORLD, transcribed from the reference's
 * branch where anything that is not `'overworld'` maps to `'overworld'`. It is
 * not an End-portal rule and is reachable only if a caller builds a nether
 * portal there.
 *
 * `knownPortals` ARE THE DESTINATION DIMENSION'S, and no type here can check
 * that — a `BlockPosition` does not say which world it is in. Passing the SOURCE
 * dimension's portals would silently reuse a portal in the world being left.
 * `./portal-travel` is the only caller in this repository and its header records
 * what it passes and why.
 */
export const resolveNetherTravel = (
  from: Dimension,
  playerPos: BlockPosition,
  knownPortals: ReadonlyArray<BlockPosition>,
  searchRadius: number = PORTAL_SEARCH_RADIUS,
): PortalTravelPlan => {
  const toDimension: Dimension = from === 'overworld' ? 'nether' : 'overworld'
  const destination = from === 'overworld' ? overworldToNether(playerPos) : netherToOverworld(playerPos)
  const nearest = Option.getOrNull(findNearestPortal(knownPortals, destination, searchRadius))

  if (nearest !== null) {
    return { toDimension, destination: nearest, portalToCreate: Option.none() }
  }

  return {
    toDimension,
    destination,
    portalToCreate: Option.some(
      generatePortalLayout(destination, DEFAULT_PORTAL_AXIS, DEFAULT_PORTAL_WIDTH, DEFAULT_PORTAL_HEIGHT),
    ),
  }
}
