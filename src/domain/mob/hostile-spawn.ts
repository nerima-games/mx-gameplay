/**
 * ONE RULE, ONE FILE (DN-GP-9): may a hostile mob spawn on this cell, right now?
 *
 * plan.md §7 gives mx-gameplay the mob row's 「AI・スポーン条件・ドロップ」, and this
 * is the spawn condition. It answers about ONE candidate cell. Choosing which
 * cells to offer — the reference's ring of sixteen angles by four radii
 * (`packages/entity/application/mob/mob-spawner-helpers.ts:9-18`), the 0.3s
 * cadence, the population caps, the moon-phase gate — is a SEARCH over mc-sim's
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
 * `validSpawnSurface` comes from `../block-vocabulary`, which transcribes
 * kernel's registry. This matters more than it looks, and it is the one place
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
 * `hostileSpawnsAllowed` is called, not reimplemented. `../day-night`'s header
 * records what happens when a caller inlines its own comparison instead: the
 * reference shipped a fresh world that spawned at midnight with hostiles that do
 * not burn in daylight camped on the respawn point — an unrecoverable death loop
 * on world creation. DN-GP-7's whole point is that mc-sim and this repository
 * must agree about when night is; a third opinion in this file would be the
 * second half of that bug.
 *
 * (Creepers are, incidentally, among the mobs that do NOT burn at dawn —
 * `packages/entity/domain/mob/mob-categories.ts:59-68` lists only the undead —
 * so "it is night" is the whole of the daylight rule for this mob, and the
 * despawn half is not here. See what is missing, below.)
 *
 * ---------------------------------------------------------------------------
 * What this rule does NOT decide
 * ---------------------------------------------------------------------------
 *
 * WHICH mob (the reference rotates a roster by cursor, `mob-categories.ts:16-25`
 * — the creeper is index 1 of 8), HOW MANY (`MAX_HOSTILE_COUNT = 16` against a
 * live census), HOW OFTEN (`SPAWN_INTERVAL_SECS = 0.3`), and DESPAWNING
 * (`DESPAWN_DISTANCE = 128`, a 3D test). Every one of those reads or writes the
 * roster. They arrive with mc-sim, and until then a rule that pretended to make
 * them would be a second owner of the mob population.
 */
import { AIR_BLOCK_ID, type BlockId } from '../chunk-store-port'
import { validSpawnSurface } from '../block-vocabulary'
import { hostileSpawnsAllowed } from '../day-night'
import type { EntityKind } from '../entity-manager-port'
import type { Dimension } from '../nether-travel-port'
import {
  ecosystemDimensionAllows,
  ECOSYSTEM_MOB_KINDS,
  NETHER_HOSTILE_KINDS,
  PASSIVE_MOB_KINDS,
} from './mob-ecosystem'

/**
 * Brightest block light a hostile may spawn in.
 *
 * `packages/entity/domain/mob/spawner-config.ts:29`, and the comparison is
 * STRICTLY GREATER (`terrain-spawn.ts:75`): light of exactly 7 still spawns.
 * The reference's own oracle pins both sides of that boundary
 * (`packages/entity/test/mob/terrain-spawn.test.ts`: 7 spawns, 8 does not).
 */
export const HOSTILE_SPAWN_MAX_BLOCK_LIGHT = 7

/**
 * The band of horizontal distances from the player a spawn may land in.
 *
 * `spawner-config.ts:2-3`. Both ends are INCLUSIVE, which is not obvious from
 * the reference's code and is asserted by its oracle: `mob-spawner-rules.ts:14`
 * rejects on `distSq < minSq` and `distSq > maxSq`, so 16 and 40 both pass
 * (`packages/entity/test/mob/mob-spawner-rules.test.ts` asserts exactly that,
 * and that 15 and 41 fail).
 *
 * The band is HORIZONTAL (XZ) in the reference; the vertical component enters
 * only the 128-block despawn guard, which is not ported (see the module header).
 */
export const MIN_SPAWN_DISTANCE_BLOCKS = 16
export const MAX_SPAWN_DISTANCE_BLOCKS = 40

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
  /** Block light at the body cell, 0-15. An absent light grid reads as 0 = dark. */
  readonly blockLight: number
  /** mc-sim's fraction of the day. Zero is midnight (`../day-night`). */
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

export type SpawnVerdict =
  | { readonly _tag: 'Spawn' }
  | { readonly _tag: 'Refused'; readonly reason: SpawnRefusal }

const REFUSED = (reason: SpawnRefusal): SpawnVerdict => ({ _tag: 'Refused', reason })

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
  if (!hostileSpawnsAllowed(candidate.timeOfDay)) {
    return REFUSED('daylight')
  }

  if (
    !Number.isFinite(candidate.distanceToPlayerBlocksXZ) ||
    !Number.isFinite(candidate.blockLight)
  ) {
    return REFUSED('unmeasurable')
  }

  if (candidate.distanceToPlayerBlocksXZ < MIN_SPAWN_DISTANCE_BLOCKS) {
    return REFUSED('too-close')
  }

  if (candidate.distanceToPlayerBlocksXZ > MAX_SPAWN_DISTANCE_BLOCKS) {
    return REFUSED('too-far')
  }

  if (!validSpawnSurface(candidate.groundBlock)) {
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

  if (candidate.blockLight > HOSTILE_SPAWN_MAX_BLOCK_LIGHT) {
    return REFUSED('too-bright')
  }

  return { _tag: 'Spawn' }
}

export const canMobSpawnAt = (kind: EntityKind, candidate: SpawnCandidate): SpawnVerdict => {
  const dimension = candidate.dimension ?? 'overworld'
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

  if (!Number.isFinite(candidate.distanceToPlayerBlocksXZ) || !Number.isFinite(candidate.blockLight)) return REFUSED('unmeasurable')
  if (candidate.distanceToPlayerBlocksXZ < MIN_SPAWN_DISTANCE_BLOCKS) return REFUSED('too-close')
  if (candidate.distanceToPlayerBlocksXZ > MAX_SPAWN_DISTANCE_BLOCKS) return REFUSED('too-far')
  if (!validSpawnSurface(candidate.groundBlock)) return REFUSED('not-a-surface')
  if (candidate.footBlock !== AIR_BLOCK_ID || candidate.headBlock !== AIR_BLOCK_ID) return REFUSED('obstructed')
  if (nether && candidate.blockLight > HOSTILE_SPAWN_MAX_BLOCK_LIGHT) return REFUSED('too-bright')
  return { _tag: 'Spawn' }
}
