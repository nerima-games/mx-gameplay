/**
 * ONE RULE, ONE FILE (DN-GP-9): may a hostile mob spawn on this cell, right now?
 *
 * plan.md §7 gives mx-gameplay the mob row's 「AI・スポーン条件・ドロップ」, and this
 * is the spawn condition. It answers about ONE candidate cell. Choosing which
 * cells to offer — the reference's ring of sixteen angles by four radii
 * (`packages/entity/application/mob/mob-spawner-helpers.ts:9-18`), the
 * difficulty-based tick cadence, and the population caps — is a SEARCH over the
 * entity roster, and the roster is mc-sim's. A rule that iterated candidates
 * would need to know how many mobs already exist, which is the question
 * `EntityManager` answers.
 *
 * So the shape is the one this repository uses everywhere: a total function from
 * facts to a decision, with the facts named in the argument type and gathered by
 * somebody else.
 *
 * ---------------------------------------------------------------------------
 * The surface test is kernel's capability, NOT a block list
 * ---------------------------------------------------------------------------
 *
 * `capabilityOfBlockId(id, 'validSpawnSurface')` comes from kernel's registry
 * directly. This matters more than it looks, and it is the one place
 * this file deliberately does BETTER than the reference rather than porting it:
 *
 *  - The reference's mob spawner had no surface test at all. `terrain-spawn.ts`
 *    takes "the first non-air block from the top" and spawns on it, so leaves
 *    and glass were legal mob ground.
 *  - It DID have a surface blacklist — `NON_SPAWN_SURFACE_BLOCK_IDS`,
 *    `packages/app/application/main/spawn-selection-search.ts:41-86` — but it
 *    was used for choosing the PLAYER's world spawn, and a near-duplicate list
 *    in `village-placement-surface.ts:6-12` disagreed with it. Two lists, three
 *    consumers, no agreement.
 *  - kernel's capability audit §4.8/§4.9 promoted it to a flag and warned that
 *    it must not be collapsed into a general `solid`: glass and leaves are solid
 *    for collision and are still not ground.
 *
 * Naming blocks here would recreate exactly the scatter plan.md §3.1 measured
 * (`blockTypeToIndex('SAND')` in 229 places across 51 files) and docs/porting.md
 * §6 forbids bringing over. Adding a block that mobs cannot stand on should be
 * one row in kernel's table and no edit in this repository — the same property
 * `test/vertical-slice.test.ts` demonstrates for falling blocks by running the
 * rule over gravel without naming it.
 *
 * ---------------------------------------------------------------------------
 * The night gate is `../day-night`'s, and is not re-derived
 * ---------------------------------------------------------------------------
 *
 * `hostileSpawnsAllowed` provides the configured night window, while raw sky
 * light distinguishes exposed daytime surfaces from dark caves. `ChunkStoreApi`
 * reports sky light before time-of-day reduction, so the threshold is an
 * approximation until the host exposes adjusted sky light.
 *
 * This rule requires block light zero in every hostile dimension; surface
 * Overworld hostiles also require the night window or low raw sky light.
 *
 * ---------------------------------------------------------------------------
 * What this rule does NOT decide
 * ---------------------------------------------------------------------------
 *
 * HOW MANY is difficulty-configured; the search and frame own the roster census
 * and cadence. Biomes here use worldgen's coarse categories, which cannot
 * distinguish several vanilla sub-biomes or structure-only spawn locations.
 */
import { Brand, Result } from 'effect'
import { AIR_BLOCK_ID, capabilityOfBlockId, type BlockId, type SimulationTick } from '@nerima-games/mc-kernel'
import { hostileSpawnsAllowed } from '../day-night.js'
import type { EntityKind } from '@nerima-games/mc-sim'
import type { ChunkBiomeType, Dimension } from '@nerima-games/mc-worldgen'
import type { HostileDifficulty } from './hostile-despawn.js'
import {
  ecosystemDimensionAllows,
  ECOSYSTEM_MOB_KINDS,
  NETHER_HOSTILE_KINDS,
  PASSIVE_MOB_KINDS,
} from './mob-ecosystem.js'

/**
 * Brightest block light a hostile may spawn in.
 *
 * Vanilla Java Edition requires block light zero. Tests cover zero and the
 * adjacent level-one boundary.
 */
export const HOSTILE_SPAWN_MAX_BLOCK_LIGHT = 0

/** Raw sky light above this level marks an exposed cell outside the night window. */
export const HOSTILE_SPAWN_MAX_DAY_SKY_LIGHT = 7

/**
 * The band of horizontal distances from the player a spawn may land in.
 *
 * Both ends are inclusive. The balance target is 24–40 blocks.
 *
 * The band is HORIZONTAL (XZ) in the reference; the vertical component enters
 * only the 128-block despawn guard, which is not ported (see the module header).
 */
export const MIN_SPAWN_DISTANCE_BLOCKS = 24
export const MAX_SPAWN_DISTANCE_BLOCKS = 40

/** Difficulty-specific hostile population caps and tick-unit search intervals. */
export const HOSTILE_SPAWN_SETTINGS: Readonly<Record<HostileDifficulty, {
  readonly maxPopulation: number
  readonly intervalTicks: number
}>> = {
  peaceful: { maxPopulation: 0, intervalTicks: 40 },
  easy: { maxPopulation: 6, intervalTicks: 40 },
  normal: { maxPopulation: 9, intervalTicks: 30 },
  hard: { maxPopulation: 14, intervalTicks: 20 },
}

export type SpawnTickFailure = { readonly _tag: 'InvalidSpawnTick' }

export type SkyLightLevel = number & Brand.Brand<'SkyLightLevel'>
export const SkyLightLevel: Brand.Constructor<SkyLightLevel> = Brand.nominal<SkyLightLevel>()

export const hostileSpawnSearchDue = (
  currentTick: SimulationTick,
  lastSpawnTick: SimulationTick,
  difficulty: HostileDifficulty,
): Result.Result<boolean, SpawnTickFailure> => {
  if (
    !Number.isSafeInteger(currentTick) || currentTick < 0 ||
    !Number.isSafeInteger(lastSpawnTick) || lastSpawnTick < 0 || currentTick < lastSpawnTick
  ) return Result.fail({ _tag: 'InvalidSpawnTick' })

  return Result.succeed(
    currentTick - lastSpawnTick >= HOSTILE_SPAWN_SETTINGS[difficulty].intervalTicks,
  )
}

const OVERWORLD_HOSTILES = ['creeper', 'enderman', 'zombie', 'skeleton', 'spider'] as const
const FARM_ANIMALS = ['cow', 'pig', 'sheep'] as const

/**
 * The current worldgen API stores 13 coarse Overworld biomes plus Nether and
 * End. These entries approximate the species each label can represent; they do
 * not encode sub-biome variants, spawn weights, group sizes, or structures.
 */
export const MOB_BIOME_SPAWN_TABLE: Readonly<Record<ChunkBiomeType, ReadonlyArray<string>>> = {
  PLAINS: [...OVERWORLD_HOSTILES, ...FARM_ANIMALS, 'chicken'],
  DESERT: [...OVERWORLD_HOSTILES],
  FOREST: [...OVERWORLD_HOSTILES, ...FARM_ANIMALS, 'chicken'],
  FLOWER_FOREST: [...OVERWORLD_HOSTILES, ...FARM_ANIMALS, 'chicken'],
  OCEAN: [...OVERWORLD_HOSTILES],
  MOUNTAINS: [...OVERWORLD_HOSTILES, ...FARM_ANIMALS, 'chicken'],
  SNOW: [...OVERWORLD_HOSTILES],
  SWAMP: [...OVERWORLD_HOSTILES, ...FARM_ANIMALS, 'chicken'],
  JUNGLE: [...OVERWORLD_HOSTILES, ...FARM_ANIMALS, 'chicken'],
  BEACH: [...OVERWORLD_HOSTILES],
  RIVER: [...OVERWORLD_HOSTILES],
  TAIGA: [...OVERWORLD_HOSTILES, ...FARM_ANIMALS, 'chicken'],
  SAVANNA: [...OVERWORLD_HOSTILES, ...FARM_ANIMALS, 'chicken'],
  NETHER: ['zombified_piglin', 'blaze'],
  END: [],
}

export const biomeAllowsMob = (kind: EntityKind, biome: ChunkBiomeType): boolean =>
  MOB_BIOME_SPAWN_TABLE[biome]?.includes(kind) === true

/**
 * Everything the rule needs to know, and nothing it does not.
 *
 * Every field is somebody else's fact: three blocks and a light level from
 * mc-worldgen, the hour from mc-sim, the distance from mc-sim. That this type is
 * six lines long is the point — it is the bill the spawn rule presents to its
 * host, once per candidate cell.
 */
export type SpawnCandidate = {
  readonly dimension?: Dimension
  /** The block the mob would stand ON. */
  readonly groundBlock: BlockId
  /** The cell the mob's feet would occupy. */
  readonly footBlock: BlockId
  /** The cell above that. Mobs are two blocks tall (`terrain-spawn.ts:69`). */
  readonly headBlock: BlockId
  /** Block light at the body cell, 0-15. An unavailable light read refuses the candidate. */
  readonly blockLight: number
  /** Raw sky light at the body cell, before time-of-day reduction. */
  readonly skyLight: SkyLightLevel
  /** Coarse biome read from the candidate's chunk column. */
  readonly biome: ChunkBiomeType
  /** mc-sim's fraction of the day, interpreted by this module's .55-.95 night window. */
  readonly timeOfDay: number
  /** Horizontal distance to the nearest player, in blocks. */
  readonly distanceToPlayerBlocksXZ: number
}

/**
 * Why a candidate was refused.
 *
 * A reason rather than a `false`, because a spawner that refuses everything and
 * a spawner that refuses everything FOR THE SAME REASON are different bugs, and
 * only the second is findable. `apps/preview-mining-site`'s arena screen prints
 * this word.
 *
 * `unmeasurable` is the answer to a light level or a distance that is not a
 * number. It exists because refusing is the inert direction and because this
 * repository has already been bitten once in the other: the preview's finding F5
 * is `NaN` reaching `applyDamage` through a bare `number`, and `NaN > 7` is
 * `false`, so a light level of `NaN` would otherwise read as pitch dark and
 * spawn a mob in daylight.
 */
export type SpawnRefusal =
  | 'daylight'
  | 'too-close'
  | 'too-far'
  | 'not-a-surface'
  | 'obstructed'
  | 'too-bright'
  | 'unmeasurable'
  | 'wrong-dimension'
  | 'wrong-biome'

export type SpawnVerdict =
  | { readonly _tag: 'Spawn' }
  | { readonly _tag: 'Refused'; readonly reason: SpawnRefusal }

const REFUSED = (reason: SpawnRefusal): SpawnVerdict => ({ _tag: 'Refused', reason })
const isLightLevel = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 15

// Valid but unregistered ids retain kernel's default capability values.
const isSpawnSurface = (block: BlockId): boolean =>
  Result.getOrUndefined(capabilityOfBlockId(block, 'validSpawnSurface')) === true

/**
 * May a hostile spawn here?
 *
 * TOTAL, deterministic, and ordered: the FIRST failing test is the reason
 * reported, so a cell that is bright, occupied and too far away answers
 * `too-far`. The order runs from the facts about the world (is it night, is the
 * player at the right distance) to the facts about the cell (ground, room,
 * light), because that is the order in which a spawner can cheaply stop —
 * everything before the first cell fact is decided once per attempt rather than
 * once per candidate.
 *
 * NOT decided here: whether the roster has room for another hostile, and which
 * mob it would be. See the module header.
 */
export const canHostileSpawnAt = (candidate: SpawnCandidate): SpawnVerdict => {
  if (
    !Number.isFinite(candidate.distanceToPlayerBlocksXZ) ||
    !isLightLevel(candidate.blockLight) ||
    !isLightLevel(candidate.skyLight) ||
    !Number.isFinite(candidate.timeOfDay)
  ) {
    return REFUSED('unmeasurable')
  }

  if (!hostileSpawnsAllowed(candidate.timeOfDay) && candidate.skyLight > HOSTILE_SPAWN_MAX_DAY_SKY_LIGHT) {
    return REFUSED('daylight')
  }

  if (candidate.distanceToPlayerBlocksXZ < MIN_SPAWN_DISTANCE_BLOCKS) {
    return REFUSED('too-close')
  }

  if (candidate.distanceToPlayerBlocksXZ > MAX_SPAWN_DISTANCE_BLOCKS) {
    return REFUSED('too-far')
  }

  if (!isSpawnSurface(candidate.groundBlock)) {
    return REFUSED('not-a-surface')
  }

  // Two blocks of room. `isReplaceable` would be the wrong question here even
  // though it is the neighbouring capability: water and lava are both
  // replaceable, and neither is a place to stand. Kernel's `passable` is nearer
  // still and has the same defect for lava, so the conservative subset — air —
  // is what this rule asks for, and an aquatic spawn rule (the reference has
  // one, `terrain-spawn.ts:53-65`) will need its own test rather than a
  // widening of this one.
  if (candidate.footBlock !== AIR_BLOCK_ID || candidate.headBlock !== AIR_BLOCK_ID) {
    return REFUSED('obstructed')
  }

  if (candidate.blockLight !== HOSTILE_SPAWN_MAX_BLOCK_LIGHT) {
    return REFUSED('too-bright')
  }

  return { _tag: 'Spawn' }
}

export const canMobSpawnAt = (kind: EntityKind, candidate: SpawnCandidate): SpawnVerdict => {
  const dimension = candidate.dimension ?? 'overworld'
  if (!biomeAllowsMob(kind, candidate.biome)) return REFUSED('wrong-biome')
  if (
    ECOSYSTEM_MOB_KINDS.includes(kind as (typeof ECOSYSTEM_MOB_KINDS)[number]) &&
    !ecosystemDimensionAllows(kind, dimension)
  ) return REFUSED('wrong-dimension')

  const passive = PASSIVE_MOB_KINDS.includes(kind as (typeof PASSIVE_MOB_KINDS)[number])
  const nether = NETHER_HOSTILE_KINDS.includes(kind as (typeof NETHER_HOSTILE_KINDS)[number])
  if (!passive && !nether) {
    if (dimension !== 'overworld') return REFUSED('wrong-dimension')
    return canHostileSpawnAt(candidate)
  }

  if (!Number.isFinite(candidate.distanceToPlayerBlocksXZ) || !isLightLevel(candidate.blockLight) || !isLightLevel(candidate.skyLight)) return REFUSED('unmeasurable')
  if (candidate.distanceToPlayerBlocksXZ < MIN_SPAWN_DISTANCE_BLOCKS) return REFUSED('too-close')
  if (candidate.distanceToPlayerBlocksXZ > MAX_SPAWN_DISTANCE_BLOCKS) return REFUSED('too-far')
  if (!isSpawnSurface(candidate.groundBlock)) return REFUSED('not-a-surface')
  if (candidate.footBlock !== AIR_BLOCK_ID || candidate.headBlock !== AIR_BLOCK_ID) return REFUSED('obstructed')
  if (nether && candidate.blockLight !== HOSTILE_SPAWN_MAX_BLOCK_LIGHT) return REFUSED('too-bright')
  return { _tag: 'Spawn' }
}
