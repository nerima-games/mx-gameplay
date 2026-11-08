/**
 * THE SPAWN SEARCH: which cells are offered to `../mob/hostile-spawn`'s rule.
 *
 * ---------------------------------------------------------------------------
 * Search inputs and constraints
 * ---------------------------------------------------------------------------
 *
 * This module samples the player's horizontal ring, finds a valid floor in each
 * sampled column, and supplies the world facts required by the spawn rule.
 *
 * The candidate facts come from the world store and the time service:
 *
 *   BLOCK AND SKY LIGHT   `getLight` returns the raw levels or an unreadable
 *                         result. The host has not exposed time-adjusted sky
 *                         light, so surface daylight uses a documented coarse
 *                         threshold while block light remains exact.
 *   TIME OF DAY            The time service supplies the fraction as an
 *                         argument, keeping this search deterministic.
 *
 * Each proposed cell is passed through the same rule used for offered attempts.
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
 * FLOOR SEARCH AND BIOME LIMITS
 * ---------------------------------------------------------------------------
 *
 * Each sampled XZ column is scanned from world height down. The first solid
 * spawn-capable block with two air cells and acceptable light is selected. A
 * bright daytime surface therefore does not hide a darker cave floor below it.
 * Missing chunks, biome data, blocks, or light remain unreadable rather than
 * being treated as air or darkness.
 *
 * Worldgen exposes coarse biome labels only. This table covers those labels and
 * the species the runtime supports; it cannot express vanilla sub-biomes,
 * Mushroom Fields or Deep Dark exclusions, or structure-only fortress rules.
 */
import { Effect, Result } from 'effect'
import {
  CHUNK_HEIGHT,
  blockIndex,
  biomeAt,
  type ChunkStoreApi,
  type Dimension,
  type ReadonlyChunk,
} from '@nerima-games/mc-worldgen'
import {
  AIR_BLOCK_ID,
  BlockAxis,
  BlockId,
  PositionAxis,
  chunkCoordOfBlock,
  capabilityOfBlockId,
  localCoordOfBlock,
  blockPosition,
  position,
  type BlockPosition,
  type Position,
} from '@nerima-games/mc-kernel'
import { EntityKind } from '@nerima-games/mc-sim'
import { drawRolls, rollAt } from '../frame-rolls.js'
import {
  NETHER_HOSTILE_KINDS,
  PASSIVE_MOB_KINDS,
} from '../mob/mob-ecosystem.js'
import {
  biomeAllowsMob,
  canMobSpawnAt,
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

/** Allow for flooring both horizontal coordinates while keeping the true range. */
export const SPAWN_RING_RADIUS_INSET_BLOCKS = 2

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
 * The radii of the ring sit two blocks inside the rule's band.
 *
 * The inset covers the maximum XZ shift from flooring both coordinates. Deriving
 * them here means a change to the band moves the ring
 * with it instead of leaving a search that probes outside the rule it feeds.
 */
export const SPAWN_RING_RADIUS_STEPS: ReadonlyArray<number> = Array.from(
  { length: SPAWN_RING_RADII },
  (_, index) =>
    MIN_SPAWN_DISTANCE_BLOCKS + SPAWN_RING_RADIUS_INSET_BLOCKS +
    ((MAX_SPAWN_DISTANCE_BLOCKS - MIN_SPAWN_DISTANCE_BLOCKS - SPAWN_RING_RADIUS_INSET_BLOCKS * 2) * index) /
      (SPAWN_RING_RADII - 1),
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
 * Search each sampled column from the top of the world down. A column contributes
 * its first geometrically valid, biome-valid and light-valid floor, which lets a
 * dark cave replace an exposed daytime surface as the candidate.
 */
export const searchSpawnCandidates = (
  store: ChunkStoreApi,
  target: Position,
  timeOfDay: number,
  seed: number,
  dimension: Dimension = 'overworld',
  mode: 'hostile' | 'passive' = 'hostile',
): Effect.Effect<MobSpawnSearch> =>
  Effect.gen(function* () {
    const batch = drawRolls(seed, SPAWN_SEARCH_ROLLS)
    if (dimension === 'end') return { attempts: EMPTY_ATTEMPTS, unreadable: 0, seed: batch.seed }
    const spawnKinds: ReadonlyArray<EntityKind> = mode === 'passive'
      ? dimension === 'overworld' ? PASSIVE_MOB_KINDS : []
      : dimension === 'nether'
        ? NETHER_HOSTILE_KINDS
        : HOSTILE_KINDS.filter((kind) => !NETHER_HOSTILE_KINDS.includes(kind as (typeof NETHER_HOSTILE_KINDS)[number]))
    // `rollAt` and not `batch.rolls[0] ?? 0`: the fallback is a
    // `noUncheckedIndexedAccess` formality — `drawRolls` returns exactly the
    // count asked for — and `../frame-rolls` now owns the one spelling of it,
    // so this file no longer carries a guard of its own that nothing can reach.
    // The value it lands on is "no rotation", the inert reading rather than one
    // that would quietly move the ring.
    const rotation = rollAt(batch, 0)

    const attempts: Array<MobSpawnAttempt> = []
    let unreadable = 0
    const chunks = new Map<string, ReadonlyChunk | undefined>()

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

        const distanceToPlayerBlocksXZ = Math.hypot(x - target.x, z - target.z)
        if (
          distanceToPlayerBlocksXZ < MIN_SPAWN_DISTANCE_BLOCKS ||
          distanceToPlayerBlocksXZ > MAX_SPAWN_DISTANCE_BLOCKS
        ) continue

        const probeAt = at(x, 0, z)
        if (probeAt === undefined) {
          unreadable += 1
          continue
        }
        const coord = chunkCoordOfBlock(probeAt)
        const chunkKey = `${String(coord.cx)},${String(coord.cz)}`
        if (!chunks.has(chunkKey)) chunks.set(chunkKey, yield* store.peek(coord))
        const chunk = chunks.get(chunkKey)
        if (chunk === undefined) {
          unreadable += 1
          continue
        }
        const local = localCoordOfBlock(probeAt)
        const biomeIndex = local.lz * 16 + local.lx
        if (
          chunk.biomes.length !== 256 || chunk.biomes[biomeIndex] === undefined ||
          chunk.blocks.length !== CHUNK_HEIGHT * 256
        ) {
          unreadable += 1
          continue
        }
        const biome = biomeAt(chunk, local.lx, local.lz)
        const kinds = spawnKinds.filter((kind) => biomeAllowsMob(kind, biome))
        if (kinds.length === 0) continue
        const kind = kindForRoll(
          rollAt(batch, 1 + cellIndex),
          kinds as [EntityKind, ...ReadonlyArray<EntityKind>],
        )
        let columnUnreadable = false
        const attemptsBeforeColumn = attempts.length
        const positionX = Result.getOrUndefined(PositionAxis.result(x))
        const positionZ = Result.getOrUndefined(PositionAxis.result(z))
        if (positionX === undefined || positionZ === undefined) {
          unreadable += 1
          continue
        }

        for (let groundY = CHUNK_HEIGHT - 3; groundY >= 0; groundY -= 1) {
          const positionY = Result.getOrUndefined(PositionAxis.result(groundY + 1))
          if (positionY === undefined) {
            columnUnreadable = true
            break
          }
          const groundValue = chunk.blocks[blockIndex(local.lx, groundY, local.lz)]
          const footValue = chunk.blocks[blockIndex(local.lx, groundY + 1, local.lz)]
          const headValue = chunk.blocks[blockIndex(local.lx, groundY + 2, local.lz)]
          if (groundValue === undefined || footValue === undefined || headValue === undefined) {
            columnUnreadable = true
            break
          }
          const groundBlock = BlockId(groundValue)
          const footBlock = BlockId(footValue)
          const headBlock = BlockId(headValue)
          if (Result.getOrUndefined(capabilityOfBlockId(groundBlock, 'validSpawnSurface')) !== true) continue
          if (footBlock !== AIR_BLOCK_ID || headBlock !== AIR_BLOCK_ID) continue

          const footAt = at(x, groundY + 1, z)
          if (footAt === undefined) {
            columnUnreadable = true
            break
          }
          const light = yield* store.getLight(footAt)
          if (light._tag !== 'Light') {
            columnUnreadable = true
            break
          }
          const candidate: SpawnCandidate = {
            groundBlock,
            footBlock,
            headBlock,
            blockLight: light.block,
            skyLight: light.sky,
            biome,
            timeOfDay,
            distanceToPlayerBlocksXZ,
            dimension,
          }
          if (canMobSpawnAt(kind, candidate)._tag !== 'Spawn') continue

          attempts.push({
            candidate,
            kind,
            feetPosition: position(positionX, positionY, positionZ),
          })
          break
        }
        if (columnUnreadable && attempts.length === attemptsBeforeColumn) unreadable += 1
      }
    }

    return {
      attempts: attempts.length === 0 ? EMPTY_ATTEMPTS : attempts,
      unreadable,
      seed: batch.seed,
    }
  })

/**
 * Build a branded world position, returning undefined when a coordinate is out
 * of the kernel's valid range.
 */
const at = (x: number, y: number, z: number): BlockPosition | undefined => {
  const blockX = Result.getOrUndefined(BlockAxis.result(x))
  const blockY = Result.getOrUndefined(BlockAxis.result(y))
  const blockZ = Result.getOrUndefined(BlockAxis.result(z))
  return blockX === undefined || blockY === undefined || blockZ === undefined
    ? undefined
    : blockPosition(blockX, blockY, blockZ)
}

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
 * `../frame-rolls` does not produce but which keeps this selection within the
 * roster's upper bound. The non-empty tuple supplies the initial selection, and
 * the reduction replaces it when the target index is visited; it does not need
 * an unchecked indexed read or an empty-roster fallback.
 */
const kindForRoll = (roll: number, kinds: readonly [EntityKind, ...ReadonlyArray<EntityKind>]): EntityKind => {
  const index = Math.min(kinds.length - 1, Math.floor(roll * kinds.length))
  return kinds.reduce(
    (selected, kind, candidateIndex) => candidateIndex === index ? kind : selected,
    kinds[0],
  )
}
