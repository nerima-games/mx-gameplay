/**
 * THE SPAWN SEARCH: which cells are offered to `../mob/hostile-spawn`'s rule.
 *
 * ---------------------------------------------------------------------------
 * What this file is, and why it could not be written until now
 * ---------------------------------------------------------------------------
 *
 * `../mob/hostile-spawn.ts` has been finished for as long as it has existed. Its
 * header says so and says what was missing: 「Choosing which cells to offer — the
 * reference's ring of sixteen angles by four radii, the 0.3s cadence, the
 * population caps, the moon-phase gate — is a SEARCH」, and a search needs facts
 * the rule deliberately does not gather.
 *
 * `MobSpawnAttempt`'s own header in `./mob-frame.ts` named the two that were
 * unobtainable, and one of them has now been built:
 *
 *   BLOCK LIGHT   「mc-worldgen's light grid, and `../chunk-store-port` — a
 *                 mirror of mc-worldgen's WHOLE `ChunkStoreApi` — has no light
 *                 query at all」. It has one now: `getLight`, three-valued for
 *                 the same reason `getBlock` is, backed by
 *                 `mc-worldgen/domain/light.ts`.
 *   TIME OF DAY   mc-sim's `TimeService.timeOfDay`, still unmirrorable for the
 *                 reason kernel's `domain/clock.ts` gives about `ClockPort`. It reaches
 *                 this function as an ARGUMENT rather than as a service, and
 *                 `stages/registration.ts` argues the inbox that carries it.
 *
 * So this is the loop those two headers predicted, and — as with the mob sweep
 * before it — NOT ONE FILE IN `domain/mob/` CHANGED to make it work.
 *
 * ---------------------------------------------------------------------------
 * The ring, and the one thing about it that is random
 * ---------------------------------------------------------------------------
 *
 * Sixteen angles by four radii, which is the reference's
 * (`packages/entity/application/mob/mob-spawner-helpers.ts:9-18`), giving 64
 * candidate cells per attempt. The radii span the rule's own band inclusively —
 * `MIN_SPAWN_DISTANCE_BLOCKS` to `MAX_SPAWN_DISTANCE_BLOCKS`, whose ends that
 * file pins against the reference's oracle — so the ring is derived from the
 * rule rather than agreeing with it by coincidence. Change the band and the ring
 * follows.
 *
 * A FIXED ring would offer the same 64 cells every attempt forever, so a world
 * whose 64 cells all fail is a world in which nothing ever spawns, deterministic
 * and invisible. The ring is therefore ROTATED by one roll per attempt. That is
 * the only randomness in the geometry, and it is deliberately the smallest
 * amount that fixes the defect: jittering each cell independently would make the
 * search unable to state what it covered.
 *
 * `../frame-rolls` is where the roll comes from, never `Math.random()`, and the
 * budget is drawn UP FRONT for the reason `ENDERMAN_TELEPORT_ROLLS` records:
 * consuming a variable number of rolls would make the next mob's loot depend on
 * how many candidates this search happened to reject.
 *
 * ---------------------------------------------------------------------------
 * ONE PLANE, NOT A COLUMN SCAN, AND THAT IS A DIVERGENCE
 * ---------------------------------------------------------------------------
 *
 * The reference finds a Y by taking 「the first non-air block from the top」
 * (`terrain-spawn.ts`). This search does not: every candidate sits at the
 * PLAYER'S OWN feet altitude, and the three cells it reads are the one below,
 * the one at, and the one above that Y.
 *
 * Two reasons, in order of force.
 *
 *  1. **The reference's version is the bug `../mob/hostile-spawn.ts` was written
 *     to avoid.** 「takes the first non-air block from the top and spawns on it,
 *     so leaves and glass were legal mob ground」. Porting the scan and then
 *     filtering it with `validSpawnSurface` would work, but the scan is the part
 *     that has no surface test in it.
 *  2. **A scan has no bounded cost anyone here can cite.** Walking a 256-cell
 *     column for each of 64 candidates is ~16,000 store reads per attempt, and
 *     every read after a block write may relight a chunk (see `getLight`'s note
 *     in `@nerima-games/mc-worldgen`). Three reads per candidate is 192, and it is a
 *     number rather than a hope.
 *
 * The consequence is honest and worth stating: a player standing on a plain sees
 * spawns on that plain, and a player at the top of a tower sees candidates in
 * mid-air 40 blocks out, all of which the rule refuses as `not-a-surface`. That
 * is a REFUSAL rather than a wrong spawn, so the divergence fails in the inert
 * direction — but it does mean the spawn rate depends on the local terrain in a
 * way vanilla's does not.
 *
 * The honest fix is a surface query, and it is worth naming precisely because
 * one nearly exists: mc-worldgen publishes `surfaceHeightAt`, which answers
 * about GENERATED terrain and therefore does not know about anything a player
 * has built or mined. A spawner that used it would put mobs on the roof of a
 * house that is not there. What is wanted is a heightmap the STORE maintains,
 * which is `ChunkStoreApi`'s to grow and is the same shape of request as this
 * light query was.
 */
import { Effect } from 'effect'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { blockPosition, type BlockPosition, type Position } from '@nerima-games/mc-kernel'
import { EntityKind } from '@nerima-games/mc-sim'
import { drawRolls, rollAt } from '../frame-rolls.js'
import { hostileSpawnsAllowed } from '../day-night.js'
import type { Dimension } from '@nerima-games/mc-worldgen'
import {
  ecosystemDimensionAllows,
  NETHER_HOSTILE_KINDS,
  PASSIVE_MOB_KINDS,
} from '../mob/mob-ecosystem.js'
import {
  MAX_SPAWN_DISTANCE_BLOCKS,
  MIN_SPAWN_DISTANCE_BLOCKS,
  type SpawnCandidate,
} from '../mob/hostile-spawn.js'
import { HOSTILE_KINDS, type MobSpawnAttempt } from './mob-frame.js'

/**
 * Angles around the player. The reference's sixteen
 * (`mob-spawner-helpers.ts:9-18`).
 */
export const SPAWN_RING_ANGLES = 16

/** Radii per angle. The reference's four, spanning the rule's band inclusively. */
export const SPAWN_RING_RADII = 4

/** Cells offered per attempt, before any of them is read. */
export const SPAWN_RING_CELLS: number = SPAWN_RING_ANGLES * SPAWN_RING_RADII

/**
 * How many rolls one search consumes: one to rotate the ring, then one per cell
 * to pick which hostile that cell would produce.
 *
 * THE WHOLE BUDGET IS DRAWN EVEN THOUGH MOST CELLS ARE REFUSED. `../frame-rolls`
 * asks that the sequence depend on WHAT HAPPENED rather than on how much work
 * something did, and `ENDERMAN_TELEPORT_ROLLS` in `./mob-frame` makes the same
 * trade for the same reason: drawing per surviving candidate would make the next
 * mob's loot depend on how many cells this search happened to reject, and would
 * silently reshuffle every later draw the day the ring's size changed.
 */
export const SPAWN_SEARCH_ROLLS: number = 1 + SPAWN_RING_CELLS

/**
 * The radii of the ring, from the rule's band rather than from four literals.
 *
 * Both ends INCLUSIVE, which is `../mob/hostile-spawn`'s documented reading of
 * the reference (16 and 40 both pass; 15 and 41 do not, and its oracle asserts
 * exactly that). Deriving them here means a change to the band moves the ring
 * with it instead of leaving a search that probes outside the rule it feeds.
 */
export const SPAWN_RING_RADIUS_STEPS: ReadonlyArray<number> = Array.from(
  { length: SPAWN_RING_RADII },
  (_, index) =>
    MIN_SPAWN_DISTANCE_BLOCKS +
    ((MAX_SPAWN_DISTANCE_BLOCKS - MIN_SPAWN_DISTANCE_BLOCKS) * index) / (SPAWN_RING_RADII - 1),
)

/** What the search found, and where the generator ended. */
export type MobSpawnSearch = {
  readonly attempts: ReadonlyArray<MobSpawnAttempt>
  /**
   * Cells that could not be read at all — an unloaded chunk, or a Y outside the
   * world.
   *
   * COUNTED RATHER THAN DROPPED SILENTLY. A search that offers nothing because
   * the world around the player is not resident and a search that offers nothing
   * because every cell is lit are different problems with different fixes, and
   * `../mob/hostile-spawn`'s header makes exactly this argument one level down
   * about why a refusal carries a reason. The arena screen prints it.
   */
  readonly unreadable: number
  readonly seed: number
}

const EMPTY_ATTEMPTS: ReadonlyArray<never> = []

/**
 * Offer the cells around a player to the spawn rule.
 *
 * READS 3 BLOCKS AND 1 LIGHT PER CELL, so 256 store calls for the full ring.
 * That is why this is called on a CADENCE and not every frame — see
 * `stages/registration.ts`, which paces it, and `@nerima-games/mc-worldgen`'s
 * note on `getLight` being occasionally O(chunk) rather than O(1).
 *
 * The rule is NOT applied here. This function gathers facts and hands them over;
 * `applySpawnAttempts` runs `canHostileSpawnAt` and the population cap. Keeping
 * the two apart is what lets the arena screen drive the rule with cells nobody
 * searched for, and what keeps this file free of any opinion about whether a
 * candidate is good.
 */
export const searchSpawnCandidates = (
  store: ChunkStoreApi,
  target: Position,
  timeOfDay: number,
  seed: number,
  dimension: Dimension = 'overworld',
): Effect.Effect<MobSpawnSearch> =>
  Effect.gen(function* () {
    const batch = drawRolls(seed, SPAWN_SEARCH_ROLLS)
    if (dimension === 'end') return { attempts: EMPTY_ATTEMPTS, unreadable: 0, seed: batch.seed }
    const kinds: readonly [EntityKind, ...ReadonlyArray<EntityKind>] = dimension === 'nether'
      ? NETHER_HOSTILE_KINDS
      : hostileSpawnsAllowed(timeOfDay)
        ? HOSTILE_KINDS.filter((kind) => ecosystemDimensionAllows(kind, dimension)) as [EntityKind, ...EntityKind[]]
        : PASSIVE_MOB_KINDS
    // `rollAt` and not `batch.rolls[0] ?? 0`: the fallback is a
    // `noUncheckedIndexedAccess` formality — `drawRolls` returns exactly the
    // count asked for — and `../frame-rolls` now owns the one spelling of it,
    // so this file no longer carries a guard of its own that nothing can reach.
    // The value it lands on is "no rotation", the inert reading rather than one
    // that would quietly move the ring.
    const rotation = rollAt(batch, 0)

    const attempts: Array<MobSpawnAttempt> = []
    let unreadable = 0

    // The plane. `Math.floor` and not `Math.round`, for the reason
    // `./mob-frame`'s `cellOf` gives: a mob at y = 64.0 is at the BOTTOM of cell
    // 64, and rounding would offer the cell above the one it is standing in.
    const footY = Math.floor(target.y)

    for (let angleIndex = 0; angleIndex < SPAWN_RING_ANGLES; angleIndex += 1) {
      // The rotation is a FRACTION OF ONE STEP, so the ring turns by less than
      // the gap between two angles. Rotating by a whole turn would re-offer the
      // same cells with different indices and change nothing.
      const angle = ((angleIndex + rotation) / SPAWN_RING_ANGLES) * 2 * Math.PI

      // OVER THE STEPS, not over `SPAWN_RING_RADII` with an indexed read. The
      // two say the same thing — the array is built `{ length: SPAWN_RING_RADII }`
      // — but the indexed spelling is `number | undefined` under
      // `noUncheckedIndexedAccess`, so it needed a `?? MIN_SPAWN_DISTANCE_BLOCKS`
      // arm that no iteration can reach: an uncoverable branch, permanently red
      // in the report, and one that would have hidden a real off-by-one by
      // quietly probing the inner radius twice. Iterating the array cannot
      // disagree with the array.
      for (const [radiusIndex, radius] of SPAWN_RING_RADIUS_STEPS.entries()) {
        const cellIndex = angleIndex * SPAWN_RING_RADII + radiusIndex

        const x = Math.floor(target.x + radius * Math.cos(angle))
        const z = Math.floor(target.z + radius * Math.sin(angle))

        const ground = yield* store.getBlock(at(x, footY - 1, z))
        const foot = yield* store.getBlock(at(x, footY, z))
        const head = yield* store.getBlock(at(x, footY + 1, z))

        if (ground._tag !== 'Block' || foot._tag !== 'Block' || head._tag !== 'Block') {
          // NOT offered as air. `@nerima-games/mc-worldgen`'s `BlockReading`
          // exists to keep these apart: 「sand at the edge of the loaded area, told the cell
          // below it is air, falls out of the world」, and a spawner told the same
          // thing puts a mob there.
          unreadable += 1
          continue
        }

        const light = yield* store.getLight(at(x, footY, z))
        if (light._tag !== 'Light') {
          unreadable += 1
          continue
        }

        // MEASURED FROM THE CELL, not from the radius that produced it. The
        // floor above moves a cell by up to a block on each axis, so the true
        // distance is not the radius — and the rule's band test must be about
        // where the mob would actually stand. Offering a cell whose real
        // distance is 40.6 and calling it 40 would be the search lying to the
        // rule about the one fact the rule cannot check.
        const distanceToPlayerBlocksXZ = Math.hypot(x - target.x, z - target.z)

        const candidate: SpawnCandidate = {
          groundBlock: ground.block,
          footBlock: foot.block,
          headBlock: head.block,
          // The BLOCK grid, not the sky grid. `../mob/hostile-spawn` gates on
          // block light alone, and its header explains why the daylight half is
          // `hostileSpawnsAllowed`'s job instead.
          blockLight: light.block,
          timeOfDay,
          distanceToPlayerBlocksXZ,
          dimension,
        }

        attempts.push({
          candidate,
          kind: kindForRoll(rollAt(batch, 1 + cellIndex), kinds),
          feetPosition: { x, y: footY, z },
        })
      }
    }

    return {
      attempts: attempts.length === 0 ? EMPTY_ATTEMPTS : attempts,
      unreadable,
      seed: batch.seed,
    }
  })

/**
 * A world position, spelled once.
 *
 * Note what this file never does with one: compare it to `AIR_BLOCK_ID`. The
 * search reports the blocks it found and the rule decides whether they are a
 * floor and two blocks of room — which is the whole shape
 * `../mob/hostile-spawn`'s header asks for, 「a total function from facts to a
 * decision, with the facts named in the argument type and gathered by somebody
 * else」. A search that pre-filtered on air would be a second, unnamed and
 * untested copy of the `obstructed` test.
 */
const at = (x: number, y: number, z: number): BlockPosition => blockPosition(x, y, z)

/**
 * Which hostile a cell would produce.
 *
 * A UNIFORM pick over `./mob-frame`'s `HOSTILE_KINDS` — the same list the
 * population cap sums over, so a kind cannot be spawnable without being counted.
 *
 * Uniform is a divergence, stated rather than smuggled. The reference rotates
 * its eight-mob roster by a CURSOR (`mob-categories.ts:16-25`), which is not a
 * weighting at all: it is round-robin, and what it produces depends on how many
 * spawns have happened rather than on chance. A cursor here would be per-world
 * state, and by `stages/registration.ts`'s save-file test per-world state is
 * mc-sim's. A uniform roll is the choice that needs nothing remembered.
 *
 * The clamp on the last index is for a roll of exactly 1.0, which
 * `../frame-rolls` does not produce but which a caller passing its own array
 * could; landing outside the roster would be an `undefined` kind reaching
 * `roster.spawn`.
 *
 * ONE FALLBACK, AND IT IS UNREACHABLE — recorded rather than covered.
 * `HOSTILE_KINDS[index]` is `EntityKind | undefined` under
 * `noUncheckedIndexedAccess` no matter how the index was derived, so a total
 * function has to answer for the `undefined` that the clamp above has already
 * made impossible. That arm cannot be tested without contriving a roll no caller
 * produces, and contriving one would teach the next reader that the roster can
 * be missed. It is left uncovered on purpose; `docs/testing.md` §7 carries the
 * argument and the coverage budget it spends.
 *
 * There used to be a SECOND fallback here — `?? EntityKind('creeper')` behind
 * `?? HOSTILE_KINDS[0]` — covering the case where the roster is empty. That one
 * was deleted by saying non-empty in `./mob-frame`'s type instead, which is a
 * claim a future edit to the roster has to read. Two unreachable fallbacks for
 * one lookup is how a formality stops being examined.
 */
const kindForRoll = (roll: number, kinds: readonly [EntityKind, ...ReadonlyArray<EntityKind>]): EntityKind => {
  const index = Math.min(kinds.length - 1, Math.floor(roll * kinds.length))
  /* v8 ignore start -- see the header immediately above: `?? kinds[0]` is the
   * ONE FALLBACK left, documented as unreachable rather than covered.
   * `docs/testing.md` §7 and `vitest.config.ts`'s coverage-threshold comment
   * both name it. */
  return kinds[index] ?? kinds[0]
  /* v8 ignore stop */
}
