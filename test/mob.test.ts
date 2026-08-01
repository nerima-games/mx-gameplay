/**
 * The mob rules: a creeper's fuse, blast, spawn condition and drop; an
 * enderman's teleport; a shulker's shell; and the sweep that removes any of them.
 *
 * ---------------------------------------------------------------------------
 * These are ported oracles, not invented cases
 * ---------------------------------------------------------------------------
 *
 * docs/porting.md §4 says to move the reference implementation's tests FIRST and
 * plan.md §8 says 「ゼロから仕様を再発明しない」. Every constant and every expected
 * number below is cited to `<reference-impl>` (a checkout of the frozen
 * `takeokunn/ts-minecraft` — docs/README.md), and the files it comes from are:
 *
 *   packages/entity/test/mob/creeper-fuse.test.ts          the fuse
 *   packages/entity/test/creeper-fuse.test.ts              an older duplicate
 *                                                          with three extra cases
 *   packages/entity/test/explosion.test.ts                 the damage table
 *   packages/entity/test/mob/mob-spawner-rules.test.ts     the distance band
 *   packages/entity/test/mob/terrain-spawn.test.ts         the light gate
 *   packages/entity/test/mob/drop.test.ts                  the chance gate
 *   packages/entity/test/enderman-teleport.test.ts         the teleport band
 *   packages/entity/test/shulker-behavior.test.ts          the shell machine
 *   packages/entity/test/mob/entity-manager-utils.test.ts  the despawn sweep
 *
 * The rule under test is a pure function in every case, so this file ENUMERATES
 * the state machines rather than sampling them: every transition of
 * `CreeperFuse` and of `ShulkerShell` appears below at least once, including the
 * ones that do nothing.
 *
 * `REGRESSION:` is used exactly where docs/testing.md §2-1 allows it — for
 * something that actually happened in the reference's production. Two of them
 * are here (the death message, and the enderman's dead 30% roll), plus the two
 * shape checks that keep a whole class out.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AIR_BLOCK_ID, type BlockId } from '../src/domain/chunk-store-port'
import { validSpawnSurface } from '../src/domain/block-vocabulary'
import { applyDamage, deathMessage, fullHealth, isDead, MAX_HEALTH_POINTS } from '../src/domain/death-cause'
import { DeltaTimeSecs } from '../src/domain/frame-contract'
import { ITEM_TYPES } from '../src/domain/item-vocabulary'
import {
  CREEPER_FUSE_SECS,
  CREEPER_IGNITION_RANGE_BLOCKS,
  DORMANT_FUSE,
  stepCreeperFuse,
  type CreeperFuse,
} from '../src/domain/mob/creeper-fuse'
import {
  CREEPER_EXPLOSION_POWER,
  explosionDamageAmount,
  explosionDamageAt,
  explosionRadius,
  type Explosion,
} from '../src/domain/mob/explosion'
import {
  canHostileSpawnAt,
  HOSTILE_SPAWN_MAX_BLOCK_LIGHT,
  MAX_SPAWN_DISTANCE_BLOCKS,
  MIN_SPAWN_DISTANCE_BLOCKS,
  type SpawnCandidate,
} from '../src/domain/mob/hostile-spawn'
import {
  BLAZE_DROPS,
  BLAZE_XP_REWARD,
  CREEPER_DROPS,
  CREEPER_XP_REWARD,
  dropPasses,
  ENDERMAN_DROPS,
  ENDERMAN_XP_REWARD,
  GHAST_DROPS,
  GHAST_XP_REWARD,
  LOWEST_ROLLS,
  mobXpReward,
  rollMobDrop,
  rollMobDrops,
  type MobDropRule,
  ZOMBIE_DROPS,
  ZOMBIE_XP_REWARD,
} from '../src/domain/mob/mob-drop'
import {
  ENDERMAN_CHASE_TELEPORT_CHANCE,
  ENDERMAN_DAMAGE_TELEPORT_CHANCE,
  ENDERMAN_STUCK_TELEPORT_TICKS,
  ENDERMAN_TELEPORT_ATTEMPTS,
  ENDERMAN_TELEPORT_MAX_BLOCKS,
  ENDERMAN_TELEPORT_MIN_BLOCKS,
  endermanTeleportOffset,
  endermanTeleportUrge,
  type EndermanSenses,
} from '../src/domain/mob/enderman-teleport'
import {
  CLOSED_SHELL,
  SHULKER_CLOSED_ARMOR_POINTS,
  SHULKER_OPENING_TICKS,
  shulkerShellArmorPoints,
  shulkerWantsToTeleport,
  stepShulkerShell,
  type ShulkerSenses,
  type ShulkerShell,
} from '../src/domain/mob/shulker-shell'
import {
  DESPAWN_DISTANCE_BLOCKS,
  despawnVerdict,
  type DespawnCandidate,
} from '../src/domain/mob/hostile-despawn'

/** Block ids, from kernel's registry. The RULES never name one; a test may. */
const STONE: BlockId = 2
const WATER: BlockId = 6
const OAK_LEAVES: BlockId = 10
const GLASS: BlockId = 13

const at = (distance: number | undefined) => ({ distanceToTargetBlocks: distance })
const NO_TARGET = at(undefined)

/** One 20 Hz frame. The delta the reference's own oracle steps by. */
const TICK = DeltaTimeSecs(0.05)

const lit = (burnedSecs: number): CreeperFuse => ({ _tag: 'Lit', burnedSecs })

describe('creeper: the fuse is a state machine with a timer and an irreversible end', () => {
  it.effect('carries the reference implementation’s two constants', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/creeper-fuse.ts:14-15, pinned by its own
      // oracle at packages/entity/test/mob/creeper-fuse.test.ts:8-11.
      expect(CREEPER_IGNITION_RANGE_BLOCKS).toBe(3)
      expect(CREEPER_FUSE_SECS).toBe(1.5)
      expect(DORMANT_FUSE).toStrictEqual({ _tag: 'Dormant' })
    }),
  )

  it.effect('the fuse starts only within range, and the range is inclusive', () =>
    Effect.sync(() => {
      // The reference's oracle asserts ignition at exactly 3.0
      // (test/mob/creeper-fuse.test.ts:44-48) and no ignition at 3.1
      // (test/creeper-fuse.test.ts). Both boundaries, because `<` versus `<=`
      // is the kind of edit that passes every other test in this file.
      expect(stepCreeperFuse(DORMANT_FUSE, at(2), TICK).fuse).toStrictEqual(lit(0.05))
      expect(stepCreeperFuse(DORMANT_FUSE, at(3), TICK).fuse).toStrictEqual(lit(0.05))
      expect(stepCreeperFuse(DORMANT_FUSE, at(3.1), TICK).fuse).toStrictEqual(DORMANT_FUSE)
      expect(stepCreeperFuse(DORMANT_FUSE, at(5), TICK).fuse).toStrictEqual(DORMANT_FUSE)
    }),
  )

  it.effect('a creeper with no target never lights, however long it is stepped', () =>
    Effect.sync(() => {
      let fuse = DORMANT_FUSE
      for (let step = 0; step < 100; step += 1) {
        fuse = stepCreeperFuse(fuse, NO_TARGET, TICK).fuse
      }
      expect(fuse).toStrictEqual(DORMANT_FUSE)
    }),
  )

  it.effect('an unmeasurable distance is nobody in range, rather than everybody', () =>
    Effect.sync(() => {
      // `NaN <= 3` is false, so this is the inert answer — but it is inert by
      // luck unless something pins it. The preview's finding F5 is the same
      // class of value reaching arithmetic that had no opinion about it.
      expect(stepCreeperFuse(DORMANT_FUSE, at(Number.NaN), TICK).fuse).toStrictEqual(DORMANT_FUSE)
      expect(stepCreeperFuse(DORMANT_FUSE, at(Number.POSITIVE_INFINITY), TICK).fuse).toStrictEqual(
        DORMANT_FUSE,
      )
    }),
  )

  it.effect('the fuse accumulates, and does not restart while it stays in range', () =>
    Effect.sync(() => {
      // The reference's accumulation oracle: ten steps of 0.016 leave ~0.16
      // burned and the fuse still lit (test/creeper-fuse.test.ts).
      const dt = DeltaTimeSecs(0.016)
      let fuse: CreeperFuse = DORMANT_FUSE
      let previous = -1

      for (let step = 0; step < 10; step += 1) {
        fuse = stepCreeperFuse(fuse, at(1), dt).fuse
        expect(fuse._tag).toBe('Lit')
        const burned = fuse._tag === 'Lit' ? fuse.burnedSecs : Number.NaN
        // Monotone: the only direction a lit fuse moves is forward. A restart
        // would show up here and nowhere else, because the end state after a
        // restart is a perfectly ordinary lit fuse.
        expect(burned).toBeGreaterThan(previous)
        previous = burned
      }

      expect(previous).toBeCloseTo(0.16, 6)
    }),
  )

  it.effect('dt = 0 advances nothing — a frame may be scheduled twice in one tick', () =>
    Effect.sync(() => {
      const zero = DeltaTimeSecs(0)
      expect(stepCreeperFuse(lit(0.8), at(1), zero)).toStrictEqual({
        fuse: lit(0.8),
        explosion: undefined,
      })
      // And it can still LIGHT one, at zero burned: lighting is a reaction to a
      // distance, and only the burning is an accumulation of time.
      expect(stepCreeperFuse(DORMANT_FUSE, at(1), zero).fuse).toStrictEqual(lit(0))
    }),
  )

  it.effect('a non-finite or negative delta cannot even be constructed', () =>
    Effect.sync(() => {
      // The structural half of the finding F5 argument: `DeltaTimeSecs` is
      // `Brand.refined` on `Number.isFinite(value) && value >= 0`
      // (domain/frame-contract.ts:57), so a fuse cannot be advanced by a
      // non-number and cannot be wound backwards. There is no overload here
      // that takes a bare number.
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(-0.05)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('DECIDED AND PINNED: leaving range puts the fuse out, and it keeps no memory', () =>
    Effect.sync(() => {
      // The reference's cancellation oracle (test/mob/creeper-fuse.test.ts:37-42
      // and :15-20): a fuse at 1.0 burned seconds, target at 10 blocks, one
      // step — back to the initial state, not paused and not decayed.
      //
      // The alternative design (a committed fuse) is real and is rejected in
      // domain/mob/creeper-fuse.ts's header: it leaves a player without a
      // weapon no answer at all. What the reset costs is written down there
      // too, so this test is the record of a decision rather than of a
      // discovery.
      expect(stepCreeperFuse(lit(1.0), at(10), TICK)).toStrictEqual({
        fuse: DORMANT_FUSE,
        explosion: undefined,
      })
      expect(stepCreeperFuse(lit(1.49), at(4), TICK).fuse).toStrictEqual(DORMANT_FUSE)
      // Losing the target entirely is the same answer as walking away.
      expect(stepCreeperFuse(lit(1.49), NO_TARGET, TICK).fuse).toStrictEqual(DORMANT_FUSE)
    }),
  )

  it.effect('stepping back in lights a FULL fuse, so stepping in twice is not fatal', () =>
    Effect.sync(() => {
      const nearlyThere = lit(CREEPER_FUSE_SECS - 0.05)
      const cancelled = stepCreeperFuse(nearlyThere, at(9), TICK).fuse
      const relit = stepCreeperFuse(cancelled, at(1), TICK).fuse

      // 0.05 rather than 0, because lighting and burning are one step — see the
      // `Dormant` case. What matters is that it is not 1.45.
      expect(relit).toStrictEqual(lit(0.05))
      // The whole 1.5 seconds is available again — this is the consequence of
      // "keeps no memory" that a player actually feels.
      expect(stepCreeperFuse(relit, at(1), TICK).explosion).toBeUndefined()
    }),
  )

  it.effect('the explosion happens on the step that crosses 1.5s, and overshoot counts', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/creeper-fuse.ts:52 uses `>=`, and its oracle
      // steps 1.49 by 0.05 (test/mob/creeper-fuse.test.ts:30-35).
      const step = stepCreeperFuse(lit(1.49), at(2), TICK)

      expect(step.fuse).toStrictEqual({ _tag: 'Detonated' })
      expect(step.explosion).toStrictEqual({ source: 'creeper', power: CREEPER_EXPLOSION_POWER })

      // A single enormous frame detonates on that frame rather than deferring.
      const lagSpike = stepCreeperFuse(lit(0), at(2), DeltaTimeSecs(30))
      expect(lagSpike.fuse).toStrictEqual({ _tag: 'Detonated' })
      expect(lagSpike.explosion).toBeDefined()
    }),
  )

  it.effect('the explosion happens EXACTLY once — detonated is terminal, whatever the input', () =>
    Effect.sync(() => {
      // In the reference this property is not the fuse's at all: `detonate` is
      // discarded by the lane that ticks it
      // (entity-manager-update-maintenance.ts:36) and the explosion is
      // re-derived by re-testing the stored number
      // (entity-manager-creeper-detonation.ts:19), so what stops a second blast
      // is a `HashMap.remove` in a third file (entity-manager-combat.ts:60). A
      // creeper that survived that removal would explode once per frame.
      const detonated = stepCreeperFuse(lit(1.49), at(2), TICK)
      expect(detonated.explosion).toBeDefined()

      let fuse = detonated.fuse
      let explosions = 0
      for (const senses of [at(0), at(2), at(100), NO_TARGET, at(Number.NaN)]) {
        for (const dt of [DeltaTimeSecs(0), TICK, DeltaTimeSecs(10)]) {
          const step = stepCreeperFuse(fuse, senses, dt)
          if (step.explosion !== undefined) {
            explosions += 1
          }
          fuse = step.fuse
        }
      }

      expect(explosions).toBe(0)
      expect(fuse).toStrictEqual({ _tag: 'Detonated' })
    }),
  )

  it.effect('every step is a pure function of its three arguments — repeat calls agree', () =>
    Effect.sync(() => {
      const inputs: ReadonlyArray<readonly [CreeperFuse, number | undefined]> = [
        [DORMANT_FUSE, 2],
        [DORMANT_FUSE, 9],
        [lit(0.4), 2],
        [lit(1.49), 2],
        [lit(0.4), undefined],
        [{ _tag: 'Detonated' }, 0],
      ]

      for (const [fuse, distance] of inputs) {
        const first = stepCreeperFuse(fuse, at(distance), TICK)
        const second = stepCreeperFuse(fuse, at(distance), TICK)
        expect(second).toStrictEqual(first)
      }
    }),
  )
})

describe('creeper: the blast, and the death message it must carry', () => {
  const blast: Explosion = { source: 'creeper', power: CREEPER_EXPLOSION_POWER }

  it.effect('reproduces the reference’s damage table for a creeper, value for value', () =>
    Effect.sync(() => {
      // packages/entity/test/explosion.test.ts:20-43. Power 3, exposure 1.
      expect(explosionRadius(CREEPER_EXPLOSION_POWER)).toBe(6)
      expect(explosionDamageAmount(3, 0)).toBe(43)
      expect(explosionDamageAmount(3, 3)).toBe(16)
      expect(explosionDamageAmount(3, 6)).toBe(1)
      expect(explosionDamageAmount(3, 7)).toBe(0)
      expect(explosionDamageAmount(3, 0, 0.5)).toBe(16)
    }),
  )

  it.effect('falls off monotonically, stays an integer, and is never 0 inside the radius', () =>
    Effect.sync(() => {
      let previous = Number.POSITIVE_INFINITY
      for (let step = 0; step <= 60; step += 1) {
        const amount = explosionDamageAmount(3, step / 10)
        expect(Number.isInteger(amount)).toBe(true)
        expect(amount).toBeLessThanOrEqual(previous)
        expect(amount).toBeGreaterThanOrEqual(1)
        previous = amount
      }
      // Strictly beyond the radius it is a hard zero, not a small number.
      expect(explosionDamageAmount(3, 6.01)).toBe(0)
    }),
  )

  it.effect('a point-blank creeper kills a full-health player outright', () =>
    Effect.sync(() => {
      // 43 against 20 maximum health. This is why the 1.5 seconds are worth
      // modelling at all: the fuse is the whole of the counter-play.
      expect(explosionDamageAmount(3, 0)).toBeGreaterThan(MAX_HEALTH_POINTS)
      expect(isDead(applyDamage(fullHealth, explosionDamageAt(blast, 0)))).toBe(true)
      // And retreating works: at four blocks a full-health player lives.
      expect(isDead(applyDamage(fullHealth, explosionDamageAt(blast, 4)))).toBe(false)
    }),
  )

  it.effect('REGRESSION: a fatal blast reports "You blew up.", not the generic fallback', () =>
    Effect.sync(() => {
      // plan.md §3.11: 「死因はドロップせず死亡メッセージまで運ぶ(参照実装では全死亡が
      // 「You died.」になるバグがあった)」. The reference's post-mortem
      // (packages/app/application/frame/stages/physics-stage-health.ts:32-34)
      // blames an intermediate helper written as `(amount: number) => …`, and a
      // damage FORMULA is exactly where such a helper appears. `explosionDamageAt`
      // has no overload that returns a bare number.
      const dead = applyDamage(fullHealth, explosionDamageAt(blast, 0))

      expect(dead.lastDeathCause).toBe('explosion')
      expect(deathMessage(dead)).toBe('You blew up.')
      expect(deathMessage(dead)).not.toBe('You died.')
    }),
  )

  it.effect('the cause survives even when the amount is zero', () =>
    Effect.sync(() => {
      // Dropping the cause once the amount is 0 is how the optional argument
      // gets reintroduced, one guard clause at a time.
      expect(explosionDamageAt(blast, 99)).toStrictEqual({ amount: 0, cause: 'explosion' })
      expect(explosionDamageAt(blast, Number.NaN)).toStrictEqual({ amount: 0, cause: 'explosion' })
    }),
  )

  it.effect('a powerless explosion has no radius and does nothing', () =>
    Effect.sync(() => {
      expect(explosionRadius(0)).toBe(0)
      expect(explosionDamageAmount(0, 0)).toBe(0)
    }),
  )
})

describe('creeper: spawning is a rule about light and surface, never a block list', () => {
  const NIGHT = 0.9
  const NOON = 0.5

  const candidate = (overrides: Partial<SpawnCandidate> = {}): SpawnCandidate => ({
    groundBlock: STONE,
    footBlock: AIR_BLOCK_ID,
    headBlock: AIR_BLOCK_ID,
    blockLight: 0,
    timeOfDay: NIGHT,
    distanceToPlayerBlocksXZ: 20,
    ...overrides,
  })

  it.effect('spawns on dark, solid ground at night, at a workable distance', () =>
    Effect.sync(() => {
      expect(canHostileSpawnAt(candidate())).toStrictEqual({ _tag: 'Spawn' })
    }),
  )

  it.effect('is gated on domain/day-night.ts, not on a comparison of its own', () =>
    Effect.sync(() => {
      // domain/day-night.ts's header records what a second opinion costs: the
      // reference shipped a world that spawned at midnight, and daylight-immune
      // hostiles camped the respawn point — an unrecoverable death loop on
      // world creation. `hostileSpawnsAllowed` is CALLED here, so widening
      // twilight or moving dawn cannot make the two disagree.
      expect(canHostileSpawnAt(candidate({ timeOfDay: NOON }))).toStrictEqual({
        _tag: 'Refused',
        reason: 'daylight',
      })
      // Pitch dark at noon is still noon.
      expect(canHostileSpawnAt(candidate({ timeOfDay: NOON, blockLight: 0 }))._tag).toBe('Refused')
    }),
  )

  it.effect('refuses light 8 and accepts light 7, exactly as the reference does', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/spawner-config.ts:29 with the strictly
      // greater test at terrain-spawn.ts:75; the oracle is
      // packages/entity/test/mob/terrain-spawn.test.ts, which asserts both
      // sides of this boundary and that an absent light grid reads as 0.
      expect(HOSTILE_SPAWN_MAX_BLOCK_LIGHT).toBe(7)
      expect(canHostileSpawnAt(candidate({ blockLight: 7 }))).toStrictEqual({ _tag: 'Spawn' })
      expect(canHostileSpawnAt(candidate({ blockLight: 8 }))).toStrictEqual({
        _tag: 'Refused',
        reason: 'too-bright',
      })
      expect(canHostileSpawnAt(candidate({ blockLight: 15 }))._tag).toBe('Refused')
    }),
  )

  it.effect('asks kernel’s validSpawnSurface, so leaves and glass are not ground', () =>
    Effect.sync(() => {
      // kernel's capability audit §4.9: these two are SOLID FOR COLLISION and
      // still not a spawn surface, which is the whole reason the flag exists
      // separately from `solid`. A rule that tested solidity would spawn mobs in
      // the canopy — and the reference's mob spawner, which tested nothing at
      // all beyond "first non-air block from the top", did.
      expect(validSpawnSurface(OAK_LEAVES)).toBe(false)
      expect(validSpawnSurface(GLASS)).toBe(false)

      for (const ground of [OAK_LEAVES, GLASS, WATER, AIR_BLOCK_ID]) {
        expect(canHostileSpawnAt(candidate({ groundBlock: ground }))).toStrictEqual({
          _tag: 'Refused',
          reason: 'not-a-surface',
        })
      }
    }),
  )

  it.effect('a block id this build cannot name is ordinary ground, as kernel says', () =>
    Effect.sync(() => {
      // kernel's `capabilityOfBlockId` is total and falls back to the defaults
      // for an unknown byte, and `validSpawnSurface` defaults to `true`. The
      // negative-set transcription in domain/chunk-store-port.ts reproduces
      // that for free — which is the reason it is a negative set.
      expect(canHostileSpawnAt(candidate({ groundBlock: 200 }))).toStrictEqual({ _tag: 'Spawn' })
    }),
  )

  it.effect('needs two blocks of room, and neither of them may be water', () =>
    Effect.sync(() => {
      for (const overrides of [{ footBlock: STONE }, { headBlock: STONE }, { footBlock: WATER }]) {
        expect(canHostileSpawnAt(candidate(overrides))).toStrictEqual({
          _tag: 'Refused',
          reason: 'obstructed',
        })
      }
    }),
  )

  it.effect('accepts both ends of the reference’s distance band and rejects just outside it', () =>
    Effect.sync(() => {
      // packages/entity/application/mob/mob-spawner-rules.ts:14 rejects on
      // `< min` and `> max`, so 16 and 40 are both legal — asserted by
      // packages/entity/test/mob/mob-spawner-rules.test.ts, which also asserts
      // 15 and 41 are not. The asymmetry is invisible in the code and only the
      // boundary tests carry it.
      expect(MIN_SPAWN_DISTANCE_BLOCKS).toBe(16)
      expect(MAX_SPAWN_DISTANCE_BLOCKS).toBe(40)

      expect(canHostileSpawnAt(candidate({ distanceToPlayerBlocksXZ: 16 }))._tag).toBe('Spawn')
      expect(canHostileSpawnAt(candidate({ distanceToPlayerBlocksXZ: 28 }))._tag).toBe('Spawn')
      expect(canHostileSpawnAt(candidate({ distanceToPlayerBlocksXZ: 40 }))._tag).toBe('Spawn')

      expect(canHostileSpawnAt(candidate({ distanceToPlayerBlocksXZ: 15 }))).toStrictEqual({
        _tag: 'Refused',
        reason: 'too-close',
      })
      expect(canHostileSpawnAt(candidate({ distanceToPlayerBlocksXZ: 41 }))).toStrictEqual({
        _tag: 'Refused',
        reason: 'too-far',
      })
      expect(canHostileSpawnAt(candidate({ distanceToPlayerBlocksXZ: 0 }))._tag).toBe('Refused')
    }),
  )

  it.effect('a measurement that is not a number refuses, rather than reading as darkness', () =>
    Effect.sync(() => {
      // `NaN > 7` is false, so an unguarded light gate would treat a broken
      // measurement as pitch dark and spawn a mob in daylight. Finding F5 is the
      // same shape one module over, and this is the guard it argues for.
      for (const overrides of [
        { blockLight: Number.NaN },
        { distanceToPlayerBlocksXZ: Number.NaN },
        { distanceToPlayerBlocksXZ: Number.POSITIVE_INFINITY },
      ]) {
        expect(canHostileSpawnAt(candidate(overrides))).toStrictEqual({
          _tag: 'Refused',
          reason: 'unmeasurable',
        })
      }
    }),
  )

  it.effect('reports the FIRST reason it failed, in the documented order', () =>
    Effect.sync(() => {
      // A candidate that is bright, obstructed, on leaves AND too far away
      // answers with the world-scale fact, because that is the one a spawner can
      // stop on before it looks at a single cell.
      expect(
        canHostileSpawnAt(
          candidate({
            timeOfDay: NOON,
            blockLight: 15,
            groundBlock: OAK_LEAVES,
            footBlock: STONE,
            distanceToPlayerBlocksXZ: 999,
          }),
        ),
      ).toStrictEqual({ _tag: 'Refused', reason: 'daylight' })
    }),
  )
})

describe('creeper: kernel names the drop, this repository decides the count', () => {
  const SLAIN = { _tag: 'Slain', lootingLevel: 0 } as const
  const SELF_DESTRUCT = { _tag: 'SelfDestruct' } as const

  it.effect('drops exactly one gunpowder, and gunpowder is spelled kernel’s way', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/mobs/creeper.ts:15 —
      // `drops: [{ blockType: 'GUNPOWDER', count: 1 }]`. The re-casing is the
      // repoint kernel's item-type header predicts: mc-sim's provisional
      // strings are UPPER_SNAKE and the union is lower_snake.
      expect(CREEPER_DROPS).toStrictEqual([{ item: 'gunpowder', count: 1 }])
      expect(ITEM_TYPES).toContain('gunpowder')

      expect(rollMobDrops(CREEPER_DROPS, SLAIN, () => LOWEST_ROLLS)).toStrictEqual([
        { item: 'gunpowder', count: 1 },
      ])
    }),
  )

  it.effect('is not random at all — every roll produces the same single gunpowder', () =>
    Effect.sync(() => {
      // Nothing about this mob is random: not the fuse, not the blast, not the
      // drop. The rolls are threaded for the roster entries that DO have a
      // `chance`, and taking them now is cheaper than retrofitting determinism
      // onto a signature later.
      for (const roll of [0, 0.001, 0.5, 0.999, 1, -1, Number.NaN]) {
        expect(rollMobDrops(CREEPER_DROPS, SLAIN, () => ({ chance: roll, count: roll }))).toStrictEqual([
          { item: 'gunpowder', count: 1 },
        ])
      }
    }),
  )

  it.effect('zombie and enderman use Minecraft count ranges', () =>
    Effect.sync(() => {
      expect(ZOMBIE_DROPS).toStrictEqual([{ item: 'rotten_flesh', count: 0, maxCount: 2 }])
      expect(ENDERMAN_DROPS).toStrictEqual([{ item: 'ender_pearl', count: 0, maxCount: 1 }])
      expect(ITEM_TYPES).toContain('rotten_flesh')
      expect(ITEM_TYPES).toContain('ender_pearl')

      expect(rollMobDrops(ZOMBIE_DROPS, SLAIN, () => ({ chance: 0, count: 0 }))).toStrictEqual([])
      expect(rollMobDrops(ZOMBIE_DROPS, SLAIN, () => ({ chance: 0, count: 0.34 }))).toStrictEqual([
        { item: 'rotten_flesh', count: 1 },
      ])
      expect(rollMobDrops(ZOMBIE_DROPS, SLAIN, () => ({ chance: 0, count: 0.67 }))).toStrictEqual([
        { item: 'rotten_flesh', count: 2 },
      ])
      expect(rollMobDrops(ENDERMAN_DROPS, SLAIN, () => ({ chance: 0, count: 0 }))).toStrictEqual([])
      expect(rollMobDrops(ENDERMAN_DROPS, SLAIN, () => ({ chance: 0, count: 0.5 }))).toStrictEqual([
        { item: 'ender_pearl', count: 1 },
      ])
    }),
  )

  it.effect('a creeper that blew itself up leaves nothing at all', () =>
    Effect.sync(() => {
      // In the reference this is not written down anywhere — the detonating
      // creeper is removed from the entity map (entity-manager-combat.ts:60)
      // before the path that awards drops and experience runs. Right behaviour,
      // accidental mechanism: moving the removal three lines changes the rule
      // and no test notices. Here it is a case of the argument.
      expect(rollMobDrops(CREEPER_DROPS, SELF_DESTRUCT, () => LOWEST_ROLLS)).toStrictEqual([])
      expect(mobXpReward(SELF_DESTRUCT, CREEPER_XP_REWARD)).toBe(0)

      expect(mobXpReward(SLAIN, CREEPER_XP_REWARD)).toBe(5)
      expect(CREEPER_XP_REWARD).toBe(5)
      expect(ZOMBIE_XP_REWARD).toBe(5)
      expect(ENDERMAN_XP_REWARD).toBe(5)
    }),
  )

  it.effect('looting adds one item per level, which is the reference’s rule and not vanilla’s', () =>
    Effect.sync(() => {
      // interaction-melee-handler.ts:180-200 re-spawns each already-rolled drop
      // with `count = lootingEnchant.level`, so the total is base + level.
      // Vanilla rolls an extra 0..level instead. Ported rather than corrected:
      // docs/porting.md §4 makes the reference the specification, and a silent
      // change to a drop rate should arrive with a measurement.
      const withLooting = (level: number) =>
        rollMobDrops(CREEPER_DROPS, { _tag: 'Slain', lootingLevel: level }, () => LOWEST_ROLLS)

      expect(withLooting(0)).toStrictEqual([{ item: 'gunpowder', count: 1 }])
      expect(withLooting(3)).toStrictEqual([{ item: 'gunpowder', count: 4 }])
      // A nonsense level adds nothing rather than producing a nonsense stack.
      expect(withLooting(-2)).toStrictEqual([{ item: 'gunpowder', count: 1 }])
      expect(withLooting(Number.NaN)).toStrictEqual([{ item: 'gunpowder', count: 1 }])
    }),
  )

  it.effect('the chance gate is strict, and an absent chance always passes', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/drop.ts:14-16 and its oracle
      // packages/entity/test/mob/drop.test.ts: a `chance` of 0.025 passes at
      // 0.024 and fails at exactly 0.025, and an un-gated drop passes even at a
      // roll of 1.
      const rare: MobDropRule = { item: 'blaze_powder', count: 1, chance: 0.025 }

      expect(dropPasses(rare, 0)).toBe(true)
      expect(dropPasses(rare, 0.024)).toBe(true)
      expect(dropPasses(rare, 0.025)).toBe(false)
      expect(dropPasses(rare, 0.5)).toBe(false)
      expect(dropPasses(CREEPER_DROPS[0] ?? rare, 1)).toBe(true)

      expect(rollMobDrop(rare, SLAIN, { chance: 0.5, count: 0 })).toBeUndefined()
      expect(rollMobDrop(rare, SLAIN, { chance: 0.01, count: 0 })).toStrictEqual({
        item: 'blaze_powder',
        count: 1,
      })
    }),
  )

  it.effect('a count range is a uniform INCLUSIVE roll, and an out-of-range roll cannot leave it', () =>
    Effect.sync(() => {
      // interaction-mob-drops.ts:16-19. No mob in this repository has a range
      // yet — the creeper does not — so this drives the branch with a rule
      // written for the purpose rather than leaving it unexercised.
      const ranged: MobDropRule = { item: 'gunpowder', count: 1, maxCount: 3 }
      const counts = [0, 0.32, 0.34, 0.66, 0.67, 0.999].map(
        (roll) => rollMobDrop(ranged, SLAIN, { chance: 0, count: roll })?.count,
      )

      expect(counts).toStrictEqual([1, 1, 2, 2, 3, 3])
      // Both ends of the range are reachable and neither is exceeded.
      expect(rollMobDrop(ranged, SLAIN, { chance: 0, count: 1 })?.count).toBe(3)
      expect(rollMobDrop(ranged, SLAIN, { chance: 0, count: 12 })?.count).toBe(3)
      expect(rollMobDrop(ranged, SLAIN, { chance: 0, count: Number.NaN })?.count).toBe(1)
      expect(rollMobDrop(ranged, SLAIN, { chance: 0, count: -5 })?.count).toBe(1)
    }),
  )

  it.effect('nothing is an answer: a zero count yields no drop rather than an empty stack', () =>
    Effect.sync(() => {
      // The same convention kernel's `resolveDrop` uses for blocks — "Always
      // >= 1; 'nothing' is `undefined`, not zero" — so a consumer never has to
      // decide what a stack of zero means.
      expect(rollMobDrop({ item: 'gunpowder', count: 0 }, SLAIN, LOWEST_ROLLS)).toBeUndefined()
      expect(rollMobDrops([{ item: 'gunpowder', count: 0 }], SLAIN, () => LOWEST_ROLLS)).toStrictEqual([])
    }),
  )

  it.effect('a ghast drops the same gunpowder, because the NAME is kernel’s', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/mobs/ghast.ts:16-17. Same item, same count,
      // different mob, no new mechanism — which is the point of asserting it:
      // under the scatter plan.md §3.1 measured these would have been two
      // spellings of the same string.
      expect(GHAST_DROPS).toStrictEqual([{ item: 'gunpowder', count: 1 }])
      expect(GHAST_XP_REWARD).toBe(5)
      expect(rollMobDrops(GHAST_DROPS, SLAIN, () => LOWEST_ROLLS)).toStrictEqual([
        { item: 'gunpowder', count: 1 },
      ])
      // And it obeys the same self-destruct rule the creeper does — it is a
      // case of the argument, not a fact about creepers.
      expect(rollMobDrops(GHAST_DROPS, SELF_DESTRUCT, () => LOWEST_ROLLS)).toStrictEqual([])
    }),
  )

  it.effect('a blaze is the first REAL table with a chance, and the half is strict', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/mobs/blaze.ts:17-18 — `chance: 0.5`,
      // `xpReward: 10`. Until now the only chance-gated rule in this file was
      // one written for the test; this is the gate running against a table.
      expect(BLAZE_DROPS).toStrictEqual([{ item: 'blaze_powder', count: 1, chance: 0.5 }])
      expect(BLAZE_XP_REWARD).toBe(10)

      const powder = [{ item: 'blaze_powder', count: 1 }]
      expect(rollMobDrops(BLAZE_DROPS, SLAIN, () => ({ chance: 0.499, count: 0 }))).toStrictEqual(powder)
      // Strictly less than, so exactly half fails — the same comparison
      // packages/entity/domain/mob/drop.ts:14-16 makes, checked at the one
      // value where `<` and `<=` differ.
      expect(rollMobDrops(BLAZE_DROPS, SLAIN, () => ({ chance: 0.5, count: 0 }))).toStrictEqual([])
      expect(rollMobDrops(BLAZE_DROPS, SLAIN, () => ({ chance: 0.9, count: 0 }))).toStrictEqual([])
      // A broken generator fails the gate rather than passing it — the guard in
      // `rollMobDrop` that the creeper's ungated drop can never exercise.
      expect(rollMobDrops(BLAZE_DROPS, SLAIN, () => ({ chance: Number.NaN, count: 0 }))).toStrictEqual([])
      // Looting still applies to a drop that PASSED its gate.
      expect(
        rollMobDrops(BLAZE_DROPS, { _tag: 'Slain', lootingLevel: 2 }, () => ({ chance: 0, count: 0 })),
      ).toStrictEqual([{ item: 'blaze_powder', count: 3 }])
    }),
  )

  it.effect('DECIDED AND PINNED: the blaze’s item is kernel’s word, not the reference’s', () =>
    Effect.sync(() => {
      // The reference drops `BLAZE_ROD` (mobs/blaze.ts:17). `blaze_rod` is not
      // in kernel's roster and `blaze_powder` is — added by kernel with the note
      // "mob drops", which is this rule. The RULE is ported unchanged and only
      // the noun moved; domain/mob/mob-drop.ts states what that costs.
      expect(ITEM_TYPES).toContain('blaze_powder')
      expect(ITEM_TYPES as ReadonlyArray<string>).not.toContain('blaze_rod')
      expect(BLAZE_DROPS[0]?.item).toBe('blaze_powder')
    }),
  )

  it.effect('a drop this repository cannot spell is absent rather than approximated', () =>
    Effect.sync(() => {
      // An enderman drops ENDER_PEARL and a shulker SHULKER_SHELL
      // (mobs/enderman.ts:15, mobs/shulker.ts:15). Neither name exists in
      // kernel's vocabulary, and substituting a name that happens to be
      // spellable is a different rule wearing this one's clothes — the blaze is
      // a substitution kernel itself made, and these would be substitutions this
      // repository invented. So there is no ENDERMAN_DROPS and no SHULKER_DROPS,
      // and the arena's missing list says which kernel row would unblock them.
      const names = ITEM_TYPES as ReadonlyArray<string>
      expect(names).not.toContain('shulker_shell')
    }),
  )
})

describe('enderman: the teleport is a decision and an offset, and holds nothing', () => {
  const senses = (overrides: Partial<EndermanSenses> = {}): EndermanSenses => ({
    damagedThisStep: false,
    stuckTicks: 0,
    roll: 0.99,
    ...overrides,
  })

  it.effect('carries the reference implementation’s six constants', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/enderman-teleport.ts:3-9.
      expect(ENDERMAN_TELEPORT_MIN_BLOCKS).toBe(8)
      expect(ENDERMAN_TELEPORT_MAX_BLOCKS).toBe(32)
      expect(ENDERMAN_TELEPORT_ATTEMPTS).toBe(16)
      expect(ENDERMAN_DAMAGE_TELEPORT_CHANCE).toBe(0.3)
      expect(ENDERMAN_CHASE_TELEPORT_CHANCE).toBe(0.05)
      expect(ENDERMAN_STUCK_TELEPORT_TICKS).toBe(40)
    }),
  )

  it.effect('a hurt enderman flees on a roll under 30%, and the boundary is strict', () =>
    Effect.sync(() => {
      // packages/entity/test/enderman-teleport.test.ts:51-54.
      expect(endermanTeleportUrge(senses({ damagedThisStep: true, roll: 0.29 }))).toStrictEqual({
        _tag: 'Teleport',
        reason: 'damaged',
        // Away from ITSELF. entity-manager-damage-enderman.ts:16-18 passes
        // `entity.position` as the anchor; the chase path passes the player's.
        // Nothing in the reference records that they differ.
        anchor: 'self',
      })
      expect(endermanTeleportUrge(senses({ damagedThisStep: true, roll: 0.3 }))).toStrictEqual({
        _tag: 'Stay',
      })
    }),
  )

  it.effect('damage SHORT-CIRCUITS: a hurt enderman that fails its roll ignores being stuck', () =>
    Effect.sync(() => {
      // enderman-teleport.ts:54 returns from the damage branch rather than
      // falling through, and its oracle asserts exactly this
      // (test/enderman-teleport.test.ts:53 — `(true, 100, 0.3)` is false).
      // Collapsing the three branches into one `||` reads better and is a
      // different rule: it would let a cornered enderman escape every hit.
      expect(endermanTeleportUrge(senses({ damagedThisStep: true, stuckTicks: 100, roll: 0.3 }))).toStrictEqual(
        { _tag: 'Stay' },
      )
      // Unhurt, the same hundred frames teleport it unconditionally.
      expect(endermanTeleportUrge(senses({ stuckTicks: 100, roll: 0.99 }))._tag).toBe('Teleport')
    }),
  )

  it.effect('being stuck teleports it past 40 frames, and 40 itself is not past', () =>
    Effect.sync(() => {
      // test/enderman-teleport.test.ts:56-59: 40 is no and 41 is yes. Both
      // sides, because `>` versus `>=` passes every other test here.
      expect(endermanTeleportUrge(senses({ stuckTicks: 40, roll: 0.99 }))).toStrictEqual({ _tag: 'Stay' })
      expect(endermanTeleportUrge(senses({ stuckTicks: 41, roll: 0.99 }))).toStrictEqual({
        _tag: 'Teleport',
        reason: 'stuck',
        anchor: 'target',
      })
      // The stuck branch does not consult the roll at all — a 0.99 teleports.
      expect(endermanTeleportUrge(senses({ stuckTicks: 41, roll: 0 }))._tag).toBe('Teleport')
    }),
  )

  it.effect('an unstuck, unhurt enderman teleports on a 5% roll, and the boundary is strict', () =>
    Effect.sync(() => {
      // test/enderman-teleport.test.ts:61-64.
      expect(endermanTeleportUrge(senses({ roll: 0.049 }))).toStrictEqual({
        _tag: 'Teleport',
        reason: 'restless',
        anchor: 'target',
      })
      expect(endermanTeleportUrge(senses({ roll: 0.05 }))).toStrictEqual({ _tag: 'Stay' })
    }),
  )

  it.effect('a measurement that is not a number leaves it standing there', () =>
    Effect.sync(() => {
      // `NaN < 0.3` and `NaN > 40` are both false, so every branch declines.
      // Inert by luck unless something pins it — and the inert direction here is
      // the one that cannot drop a mob on top of a player.
      for (const broken of [
        senses({ roll: Number.NaN }),
        senses({ damagedThisStep: true, roll: Number.NaN }),
        senses({ stuckTicks: Number.NaN, roll: 0.99 }),
        senses({ stuckTicks: Number.POSITIVE_INFINITY, roll: Number.NaN }),
      ]) {
        // The last one is the exception worth seeing: an INFINITE stuck count is
        // still "more than forty", so it teleports. That is a measurement, not
        // the absence of one.
        const urge = endermanTeleportUrge(broken)
        expect(urge._tag).toBe(broken.stuckTicks === Number.POSITIVE_INFINITY ? 'Teleport' : 'Stay')
      }
    }),
  )

  it.effect('reproduces the reference’s offset, digit for digit, with the position cancelled', () =>
    Effect.sync(() => {
      // test/enderman-teleport.test.ts:22-26 asserts `{x: 116, y: 64, z: -20}`
      // for an anchor of `{x: 100, y: 64, z: -20}` and rolls `[0.75, 0.5]`.
      // 116 - 100 = 16 and -20 - -20 = 0. The enderman's own position is unused
      // in the reference (`_position`, enderman-teleport.ts:28), which is why
      // the whole rule reduces to this offset with nothing lost.
      expect(endermanTeleportOffset([0.75, 0.5])).toStrictEqual({ xBlocks: 16, zBlocks: 0 })

      // And the reference's y is the anchor's, unchanged (:39) — so there is no
      // vertical component to assert. See domain/mob/enderman-teleport.ts.
    }),
  )

  it.effect('skips attempts that land too near, and takes the first that does not', () =>
    Effect.sync(() => {
      // test/enderman-teleport.test.ts:28-32. `[0.5, 0.5]` is an offset of
      // (0, 0) — on top of the anchor — so attempt 0 fails and attempt 1 answers.
      expect(endermanTeleportOffset([0.5, 0.5, 0.75, 0.5])).toStrictEqual({ xBlocks: 16, zBlocks: 0 })
    }),
  )

  it.effect('both ends of the 8..32 band are reachable, and just outside either is not', () =>
    Effect.sync(() => {
      // Inclusive on both sides (enderman-teleport.ts:24). 0.625 and 1 are exact
      // in binary, so these are arithmetic rather than rounding coincidences:
      // 0.625 * 64 - 32 = 8 and 1 * 64 - 32 = 32.
      expect(endermanTeleportOffset([0.625, 0.5])).toStrictEqual({ xBlocks: 8, zBlocks: 0 })
      expect(endermanTeleportOffset([1, 0.5])).toStrictEqual({ xBlocks: 32, zBlocks: 0 })

      // 0.6 * 64 - 32 = 6.4 — inside the minimum, so the attempt is refused and
      // the rolls run out.
      expect(endermanTeleportOffset([0.6, 0.5])).toBeUndefined()
      // The corner of the square the offsets are drawn from: (32, 32) is 45.25
      // blocks away, outside the circle. That corner is why the rule needs
      // sixteen attempts and not one.
      expect(endermanTeleportOffset([1, 1])).toBeUndefined()
    }),
  )

  it.effect('sixteen misses is an answer: it stays where it is', () =>
    Effect.sync(() => {
      // test/enderman-teleport.test.ts:34-38 — thirty-two rolls of 0.5, every
      // one an offset of zero, and the answer is no teleport rather than a
      // widened band.
      expect(endermanTeleportOffset(Array.from({ length: 32 }, () => 0.5))).toBeUndefined()
      // Exactly sixteen attempts are tried and no more: a 33rd pair that WOULD
      // have worked is never reached.
      const late = [...Array.from({ length: 32 }, () => 0.5), 0.75, 0.5]
      expect(endermanTeleportOffset(late)).toBeUndefined()
    }),
  )

  it.effect('running out of rolls ends the search, rather than counting as a miss', () =>
    Effect.sync(() => {
      // enderman-teleport.ts:35 returns null the moment either index is missing.
      expect(endermanTeleportOffset([])).toBeUndefined()
      expect(endermanTeleportOffset([0.75])).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: an infinite roll is a failed attempt, not a maximum-range jump', () =>
    Effect.sync(() => {
      // The reference clamps with `Math.max(0, Math.min(1, value))`
      // (enderman-teleport.ts:11). `Math.min(1, Infinity)` is 1, so an infinite
      // roll from a broken generator becomes an offset of exactly +32 — the
      // LONGEST teleport the rule can produce, out of a value that is not a
      // measurement. Same shape as the preview's finding F5, failing in the
      // dangerous direction. Here it fails its attempt.
      expect(endermanTeleportOffset([Number.POSITIVE_INFINITY, 0.5])).toBeUndefined()
      expect(endermanTeleportOffset([Number.NaN, 0.5])).toBeUndefined()
      expect(endermanTeleportOffset([0.75, Number.NaN])).toBeUndefined()
      // And a broken roll does not poison the attempts after it.
      expect(endermanTeleportOffset([Number.NaN, 0.5, 0.75, 0.5])).toStrictEqual({
        xBlocks: 16,
        zBlocks: 0,
      })
    }),
  )

  it.effect('every offset it ever returns is inside the band, swept across the roll space', () =>
    Effect.sync(() => {
      // The band is the whole promise this rule makes to a host that will add
      // the offset to a position, so it is checked over the input space rather
      // than at four points.
      let answered = 0
      for (let x = 0; x <= 100; x += 1) {
        for (let z = 0; z <= 100; z += 5) {
          const offset = endermanTeleportOffset([x / 100, z / 100])
          if (offset === undefined) {
            continue
          }
          answered += 1
          const distance = Math.hypot(offset.xBlocks, offset.zBlocks)
          expect(distance).toBeGreaterThanOrEqual(ENDERMAN_TELEPORT_MIN_BLOCKS)
          expect(distance).toBeLessThanOrEqual(ENDERMAN_TELEPORT_MAX_BLOCKS)
        }
      }
      // The sweep has to actually reach the accepting branch, or it asserts
      // nothing at all.
      expect(answered).toBeGreaterThan(500)
    }),
  )

  it.effect('every call is a pure function of its arguments — repeat calls agree', () =>
    Effect.sync(() => {
      for (const rolls of [[0.75, 0.5], [0.5, 0.5, 0.75, 0.5], [0.1, 0.2], []]) {
        expect(endermanTeleportOffset(rolls)).toStrictEqual(endermanTeleportOffset(rolls))
      }
      for (const input of [senses(), senses({ damagedThisStep: true, roll: 0.1 }), senses({ stuckTicks: 99 })]) {
        expect(endermanTeleportUrge(input)).toStrictEqual(endermanTeleportUrge(input))
      }
    }),
  )
})

describe('shulker: the shell is the fuse’s shape — a countdown with one legal exit', () => {
  const senses = (overrides: Partial<ShulkerSenses> = {}): ShulkerSenses => ({
    hasTarget: true,
    damageTakenThisTick: 0,
    // The reference's oracle fights a shulker at 10 of 30 throughout
    // (test/shulker-behavior.test.ts:47 onwards) — already below half, so only
    // `damageTakenThisTick` decides whether it flinches.
    healthPoints: 10,
    maxHealthPoints: 30,
    ...overrides,
  })

  const opening = (openedTicks: number): ShulkerShell => ({ _tag: 'Opening', openedTicks })
  const OPEN: ShulkerShell = { _tag: 'Open' }

  it.effect('carries the reference implementation’s two live constants', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/shulker-behavior.ts:8,10.
      expect(SHULKER_OPENING_TICKS).toBe(20)
      expect(SHULKER_CLOSED_ARMOR_POINTS).toBe(20)
      expect(CLOSED_SHELL).toStrictEqual({ _tag: 'Closed' })
    }),
  )

  it.effect('a shut shulker with nothing to shoot at stays shut, forever', () =>
    Effect.sync(() => {
      // test/shulker-behavior.test.ts:46-51.
      let shell = CLOSED_SHELL
      for (let tick = 0; tick < 200; tick += 1) {
        const step = stepShulkerShell(shell, senses({ hasTarget: false }))
        expect(step.canFire).toBe(false)
        shell = step.shell
      }
      expect(shell).toStrictEqual(CLOSED_SHELL)
    }),
  )

  it.effect('acquiring a target starts the shell opening at zero', () =>
    Effect.sync(() => {
      // test/shulker-behavior.test.ts:53-57. The counter is INSIDE the state
      // here; the reference takes it as an input it never returns, so a host has
      // to know to reset it and nothing says so.
      expect(stepShulkerShell(CLOSED_SHELL, senses())).toStrictEqual({
        shell: { _tag: 'Opening', openedTicks: 0 },
        canFire: false,
      })
    }),
  )

  it.effect('ENUMERATED: twenty-one frames from shut to able to fire, and not one earlier', () =>
    Effect.sync(() => {
      // The reference's boundary, transcribed: ticksInState 18 stays opening and
      // 19 opens (test/shulker-behavior.test.ts:59-68). Walked end to end rather
      // than sampled at those two points, because "it opens eventually" is what
      // an off-by-one still satisfies.
      let shell: ShulkerShell = CLOSED_SHELL
      const fired: Array<number> = []

      for (let frame = 1; frame <= 21; frame += 1) {
        const step = stepShulkerShell(shell, senses())
        shell = step.shell
        if (step.canFire) {
          fired.push(frame)
        }
        if (frame < 21) {
          expect(shell).toStrictEqual(opening(frame - 1))
        }
      }

      expect(shell).toStrictEqual(OPEN)
      // It is OPEN after 21 frames and fires on the 22nd: `canFire` is a
      // property of a shulker that was already open when the frame began.
      expect(fired).toStrictEqual([])
      expect(stepShulkerShell(shell, senses())).toStrictEqual({ shell: OPEN, canFire: true })
    }),
  )

  it.effect('an open shulker with a target fires every frame — there is no cadence here', () =>
    Effect.sync(() => {
      // test/shulker-behavior.test.ts:70-74. `canFire` is a PERMISSION; the
      // reference has no cooldown in this rule either, so a host that fired on
      // every true would fire at its frame rate. Pinned so that the missing
      // cadence is a fact rather than an assumption.
      for (let frame = 0; frame < 5; frame += 1) {
        expect(stepShulkerShell(OPEN, senses())).toStrictEqual({ shell: OPEN, canFire: true })
      }
    }),
  )

  it.effect('losing the target shuts it in ONE frame — opening is slow, closing is not', () =>
    Effect.sync(() => {
      // test/shulker-behavior.test.ts:76-80.
      expect(stepShulkerShell(OPEN, senses({ hasTarget: false }))).toStrictEqual({
        shell: CLOSED_SHELL,
        canFire: false,
      })
    }),
  )

  it.effect('DECIDED AND PINNED: a shulker mid-open ignores losing its target', () =>
    Effect.sync(() => {
      // shulker-behavior.ts:62-65 does not consult `hasTarget` in the opening
      // branch, so twenty frames of opening are committed. Left alone rather
      // than tidied: a mob that could abort an animation it is drawing is a
      // worse rule, and this one is the reference's.
      expect(stepShulkerShell(opening(3), senses({ hasTarget: false }))).toStrictEqual({
        shell: opening(4),
        canFire: false,
      })
      // It shuts only once it has finished opening and finds nobody there.
      expect(stepShulkerShell(opening(19), senses({ hasTarget: false })).shell).toStrictEqual(OPEN)
      expect(stepShulkerShell(OPEN, senses({ hasTarget: false })).shell).toStrictEqual(CLOSED_SHELL)
    }),
  )

  it.effect('a hit slams it shut from ANY state, and throws away the frames it had spent', () =>
    Effect.sync(() => {
      // test/shulker-behavior.test.ts:82-92 — 14 of 30 health with 5 damage
      // taken. The check runs before the state switch (shulker-behavior.ts:53),
      // so all three states answer the same way; enumerated rather than sampled.
      const hit = senses({ healthPoints: 14, maxHealthPoints: 30, damageTakenThisTick: 5 })
      for (const shell of [CLOSED_SHELL, opening(0), opening(19), OPEN]) {
        expect(stepShulkerShell(shell, hit)).toStrictEqual({ shell: CLOSED_SHELL, canFire: false })
      }
    }),
  )

  it.effect('BOTH sides of half health: 15 of 30 does not flinch and 14 of 30 does', () =>
    Effect.sync(() => {
      // `health / maxHealth < 0.5` (shulker-behavior.ts:35) — strict, so exactly
      // half is not below half. This is the clause that makes the reference's
      // shulker un-vanilla: the first half of a fight is against an OPEN
      // shulker, because a healthy one does not close when hit.
      const wounded = (healthPoints: number): ShulkerSenses =>
        senses({ healthPoints, maxHealthPoints: 30, damageTakenThisTick: 5 })

      expect(stepShulkerShell(OPEN, wounded(15))).toStrictEqual({ shell: OPEN, canFire: true })
      expect(stepShulkerShell(OPEN, wounded(30))).toStrictEqual({ shell: OPEN, canFire: true })
      expect(stepShulkerShell(OPEN, wounded(14)).shell).toStrictEqual(CLOSED_SHELL)

      // And a hit of zero is not a hit, however low the health.
      expect(stepShulkerShell(OPEN, senses({ healthPoints: 1, damageTakenThisTick: 0 })).shell).toStrictEqual(
        OPEN,
      )
    }),
  )

  it.effect('a maximum health of zero is not "below half" — it is nothing to divide by', () =>
    Effect.sync(() => {
      // shulker-behavior.ts:35's `maxHealth > 0` guard. Without it `0 / 0` is
      // `NaN` and the answer would depend on which way a `NaN` comparison fell.
      for (const broken of [
        senses({ healthPoints: 0, maxHealthPoints: 0, damageTakenThisTick: 5 }),
        senses({ healthPoints: Number.NaN, maxHealthPoints: 30, damageTakenThisTick: 5 }),
        senses({ healthPoints: 10, maxHealthPoints: Number.NaN, damageTakenThisTick: 5 }),
        senses({ healthPoints: 10, maxHealthPoints: 30, damageTakenThisTick: Number.NaN }),
      ]) {
        expect(stepShulkerShell(OPEN, broken)).toStrictEqual({ shell: OPEN, canFire: true })
      }
    }),
  )

  it.effect('a counter that is not a number opens LATE, never early', () =>
    Effect.sync(() => {
      // There is no brand on a frame count the way `DeltaTimeSecs` brands a
      // delta, so a corrupt counter has to be answered here. Both directions are
      // recoverable and only this one cannot make `canFire` true sooner than the
      // rule allows.
      expect(stepShulkerShell({ _tag: 'Opening', openedTicks: Number.NaN }, senses())).toStrictEqual({
        shell: opening(1),
        canFire: false,
      })
      expect(
        stepShulkerShell({ _tag: 'Opening', openedTicks: Number.POSITIVE_INFINITY }, senses()).shell,
      ).toStrictEqual(opening(1))
    }),
  )

  it.effect('reports armour points on all three states, and never a mitigated damage', () =>
    Effect.sync(() => {
      // test/shulker-behavior.test.ts:15-27, all three pinned.
      expect(shulkerShellArmorPoints(CLOSED_SHELL)).toBe(20)
      expect(shulkerShellArmorPoints(opening(0))).toBe(0)
      expect(shulkerShellArmorPoints(OPEN)).toBe(0)
    }),
  )

  it.effect('REGRESSION-PROOF BY SHAPE: no "invulnerable" flag, and no dead 100-tick constant', () =>
    Effect.sync(() => {
      // Two things the reference has that are NOT ported, both recorded in
      // domain/mob/shulker-shell.ts's header:
      //
      //  1. `isInvulnerable: true` for a closed shell (shulker-behavior.ts:54)
      //     contradicts its own `computeShulkerShellDamage`, which lets 20% of
      //     the blow through (:37-43, and its oracle asserts 2 from 10). A
      //     melee handler reading the flag would have made the mob unkillable.
      //  2. `SHULKER_FORCED_CLOSED_TICKS = 100` (:9) is referenced by nothing at
      //     all — the `closeTicksRemaining` it gates on has no producer and no
      //     decrement anywhere in the reference.
      //
      // Neither can be caught by reading the rule's answers, so the surface is
      // asserted instead: a step reports a shell and a permission, and nothing
      // else can creep back in beside them.
      const step = stepShulkerShell(CLOSED_SHELL, senses())
      expect(Object.keys(step).sort()).toStrictEqual(['canFire', 'shell'])
    }),
  )

  it.effect('wanting to leave and wanting to shut are ONE condition, not two that agree', () =>
    Effect.sync(() => {
      // shulker-behavior.ts writes the pair twice (:49 and :90) and nothing
      // records that they must match. Here it is one function called twice, so
      // this test is checking that the two answers cannot drift.
      for (const input of [
        senses({ healthPoints: 14, damageTakenThisTick: 5 }),
        senses({ healthPoints: 15, damageTakenThisTick: 5 }),
        senses({ healthPoints: 1, damageTakenThisTick: 0 }),
        senses({ healthPoints: 10, maxHealthPoints: 0, damageTakenThisTick: 5 }),
      ]) {
        const shutByHit = stepShulkerShell(OPEN, input).shell._tag === 'Closed'
        expect(shulkerWantsToTeleport(input)).toBe(shutByHit)
      }
    }),
  )
})

describe('the sweep: a mob stops existing when nobody is near it', () => {
  const candidate = (overrides: Partial<DespawnCandidate> = {}): DespawnCandidate => ({
    distanceToPlayerBlocks: 10,
    persistent: false,
    ...overrides,
  })

  it.effect('carries the reference implementation’s distance, and 128 itself is kept', () =>
    Effect.sync(() => {
      // packages/entity/domain/mob/spawner-config.ts:4, with the STRICTLY
      // greater comparison at entity-manager-utils.ts:68. Both sides, because
      // `>` versus `>=` is invisible in the code — and the reference's own
      // oracle says so in as many words:
      // `packages/entity/test/mob/entity-manager-utils.test.ts:266-270`,
      // "returns false when entity is exactly at max distance boundary".
      expect(DESPAWN_DISTANCE_BLOCKS).toBe(128)
      expect(despawnVerdict(candidate({ distanceToPlayerBlocks: 128 }))).toStrictEqual({ _tag: 'Keep' })
      expect(despawnVerdict(candidate({ distanceToPlayerBlocks: 128.001 }))).toStrictEqual({
        _tag: 'Despawn',
        reason: 'too-far',
      })
      expect(despawnVerdict(candidate({ distanceToPlayerBlocks: 0 }))).toStrictEqual({ _tag: 'Keep' })
    }),
  )

  it.effect('nothing this repository can SPAWN is ever swept on the frame it spawns', () =>
    Effect.sync(() => {
      // The two rules are the ends of one budget and this is the sentence that
      // says they agree: the whole 16..40 band sits inside 128, with 88 blocks
      // of slack. A despawn distance under 40 would make a spawner that spawns
      // and immediately sweeps, and neither rule alone would look wrong.
      for (const distance of [MIN_SPAWN_DISTANCE_BLOCKS, 28, MAX_SPAWN_DISTANCE_BLOCKS]) {
        expect(despawnVerdict(candidate({ distanceToPlayerBlocks: distance }))._tag).toBe('Keep')
      }
      expect(MAX_SPAWN_DISTANCE_BLOCKS).toBeLessThan(DESPAWN_DISTANCE_BLOCKS)
    }),
  )

  it.effect('a persistent mob is never swept for being far away, however far', () =>
    Effect.sync(() => {
      // entity-manager-utils.ts:66 spells this as `type === 'Villager'`. Here it
      // is a flag on the candidate, so making a second mob persistent is a
      // roster edit and not an edit to this rule — the same argument
      // domain/mob/hostile-spawn.ts makes about naming blocks.
      for (const distance of [129, 1_000, 1e12]) {
        expect(despawnVerdict({ distanceToPlayerBlocks: distance, persistent: true })).toStrictEqual({
          _tag: 'Keep',
        })
      }
    }),
  )

  it.effect('ORDER: a persistent mob whose position is not a number is swept anyway', () =>
    Effect.sync(() => {
      // entity-manager-utils.ts checks finiteness at :59 and the exemption at
      // :66 — in that order, so the exemption never protects a broken entity.
      // The order is the whole content of this test: an exemption from a
      // distance rule is not an exemption from being a number.
      //
      // The finiteness half HAS an oracle (test/mob/entity-manager-utils.test.ts
      // :272-285 covers a NaN position, an infinite position and a non-finite
      // velocity, all three answering "despawn"). The EXEMPTION has none, and
      // the interaction between them has none either — which is exactly why the
      // order is worth a test rather than a comment.
      expect(despawnVerdict({ distanceToPlayerBlocks: Number.NaN, persistent: true })).toStrictEqual({
        _tag: 'Despawn',
        reason: 'unmeasurable',
      })
      expect(
        despawnVerdict({ distanceToPlayerBlocks: Number.POSITIVE_INFINITY, persistent: false }),
      ).toStrictEqual({ _tag: 'Despawn', reason: 'unmeasurable' })
    }),
  )

  it.effect('the spawn rule and the sweep fail in OPPOSITE directions, which is one decision', () =>
    Effect.sync(() => {
      // A broken measurement REFUSES a spawn and CAUSES a despawn. Both answers
      // remove a mob, so no unmeasurable number can ever be the reason a
      // population grows. Asserted together because separately each looks like
      // an arbitrary choice about `NaN`.
      const refused = canHostileSpawnAt({
        groundBlock: STONE,
        footBlock: AIR_BLOCK_ID,
        headBlock: AIR_BLOCK_ID,
        blockLight: Number.NaN,
        timeOfDay: 0.9,
        distanceToPlayerBlocksXZ: 20,
      })
      expect(refused).toStrictEqual({ _tag: 'Refused', reason: 'unmeasurable' })
      expect(despawnVerdict(candidate({ distanceToPlayerBlocks: Number.NaN }))).toStrictEqual({
        _tag: 'Despawn',
        reason: 'unmeasurable',
      })
    }),
  )

  it.effect('DECIDED AND PINNED: with no player at all, every mob is kept', () =>
    Effect.sync(() => {
      // `undefined` is the absence of a measurement and not a very large one —
      // the same distinction `CreeperSenses` draws. "Remove every mob" is a
      // different decision with a different trigger: the reference spells it
      // `despawnAllEntities` (entity-manager-lifecycle.ts:46) and reaches it
      // from the mobs-disabled switch, never from this rule. Answering Despawn
      // here would quietly empty a server between two players logging in.
      expect(despawnVerdict(candidate({ distanceToPlayerBlocks: undefined }))).toStrictEqual({
        _tag: 'Keep',
      })
      expect(
        despawnVerdict({ distanceToPlayerBlocks: undefined, persistent: true }),
      ).toStrictEqual({ _tag: 'Keep' })
    }),
  )
})

describe('the mob rules are deterministic by construction', () => {
  const mobDomain = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'domain', 'mob')

  it.effect('REGRESSION-PROOF BY SHAPE: no mob rule reads a random number or a clock', () =>
    Effect.sync(() => {
      // plan.md §5.1-3 makes determinism the precondition for using the
      // reference's tests as an oracle, and the reference is precisely where
      // this leaks: its drop domain is pure and its APPLICATION layer calls
      // `Math.random()` twice (interaction-melee-handler.ts:185,
      // interaction-mob-drops.ts:18), so its drops cannot be replayed. Every
      // roll here is a parameter instead.
      //
      // This is the same enforcement style as DN-GP-8's `Date.now()` ban, which
      // also had to be a source check because oxlint 0.12 implements neither
      // `no-restricted-syntax` nor `no-restricted-globals`.
      const files = readdirSync(mobDomain).filter((name) => name.endsWith('.ts'))
      expect(files.length).toBeGreaterThan(0)

      for (const file of files) {
        const source = readFileSync(path.join(mobDomain, file), 'utf8')
        // Comments quoting the reference's `Math.random()` are legitimate and
        // are what the trailing `(` distinguishes from a call... which a
        // comment can also contain, so the exclusion is explicit: a line that
        // is a comment does not count.
        const offending = source
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
          .filter(
            (line) =>
              line.includes('Math.random') ||
              line.includes('Date.now') ||
              line.includes('performance.now'),
          )

        expect({ file, offending }).toStrictEqual({ file, offending: [] })
      }
    }),
  )

  it.effect('a whole creeper lifetime replays identically', () =>
    Effect.sync(() => {
      // Spawn -> approach -> fuse -> blast -> death message -> drop, twice, with
      // no shared state between the runs. This is the shape docs/testing.md §5
      // asks for ("シード固定のシナリオテスト") and the reason none of these rules
      // may grow an internal counter.
      // 0.25 rather than 0.05 on purpose: quarter-seconds are exact in binary,
      // so "six steps reach 1.5" is arithmetic rather than a rounding
      // coincidence. Thirty steps of 0.05 sum to 1.4999999999999998 and
      // detonate one frame late — deterministically, which is all this rule
      // promises, but not a number to write into an expected value by hand.
      const STRIDE = DeltaTimeSecs(0.25)

      const run = (): ReadonlyArray<string> => {
        const trace: Array<string> = []
        const verdict = canHostileSpawnAt({
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          timeOfDay: 0.9,
          distanceToPlayerBlocksXZ: 20,
        })
        trace.push(`spawn:${verdict._tag}`)

        let fuse: CreeperFuse = DORMANT_FUSE
        let vitals = fullHealth
        // Walks in from 6 blocks, one block per frame, then stands still.
        for (let frame = 0; frame < 40; frame += 1) {
          const distance = Math.max(1, 6 - frame)
          const step = stepCreeperFuse(fuse, at(distance), STRIDE)
          fuse = step.fuse
          if (step.explosion !== undefined) {
            vitals = applyDamage(vitals, explosionDamageAt(step.explosion, distance))
            trace.push(`blast@${String(frame)}`)
          }
        }

        trace.push(`fuse:${fuse._tag}`)
        trace.push(`death:${String(deathMessage(vitals))}`)
        trace.push(
          `drop:${JSON.stringify(rollMobDrops(CREEPER_DROPS, { _tag: 'Slain', lootingLevel: 0 }, () => LOWEST_ROLLS))}`,
        )
        return trace
      }

      const first = run()
      expect(run()).toStrictEqual(first)
      expect(first).toStrictEqual([
        'spawn:Spawn',
        // Frame 3 is the first at three blocks, and six quarter-seconds later
        // the fuse is out of time.
        'blast@8',
        'fuse:Detonated',
        'death:You blew up.',
        'drop:[{"item":"gunpowder","count":1}]',
      ])
    }),
  )

  it.effect('a shulker fight and an enderman escape replay identically too', () =>
    Effect.sync(() => {
      // The same shape for the two mobs added after the creeper: a whole
      // encounter driven frame by frame with every roll supplied, run twice,
      // with no shared state between the runs. The rolls come out of a plain
      // counter rather than a generator — which is the point of threading them
      // through the signatures at all (plan.md §5.1-3).
      const run = (): ReadonlyArray<string> => {
        const trace: Array<string> = []

        // A shulker opens, fires, is hurt below half, and shuts.
        let shell: ShulkerShell = CLOSED_SHELL
        let health = 30
        for (let frame = 0; frame < 30; frame += 1) {
          // The player lands a blow on frame 25, taking it under half.
          const damageTakenThisTick = frame === 25 ? 20 : 0
          health -= damageTakenThisTick
          const step = stepShulkerShell(shell, {
            hasTarget: true,
            damageTakenThisTick,
            healthPoints: health,
            maxHealthPoints: 30,
          })
          shell = step.shell
          if (step.canFire) {
            trace.push(`fire@${String(frame)}`)
          }
          if (frame >= 25) {
            trace.push(`shell@${String(frame)}:${shell._tag}`)
          }
        }
        trace.push(`shell:${shell._tag}`)
        trace.push(`armour:${String(shulkerShellArmorPoints(shell))}`)
        trace.push(`flees:${String(shulkerWantsToTeleport({
          hasTarget: true,
          damageTakenThisTick: 20,
          healthPoints: health,
          maxHealthPoints: 30,
        }))}`)

        // An enderman is hit, rolls under 30%, and jumps away from itself.
        const urge = endermanTeleportUrge({ damagedThisStep: true, stuckTicks: 0, roll: 0.1 })
        trace.push(`urge:${urge._tag}:${urge._tag === 'Teleport' ? `${urge.reason}/${urge.anchor}` : ''}`)
        trace.push(`offset:${JSON.stringify(endermanTeleportOffset([0.5, 0.5, 0.75, 0.5]))}`)

        // And the sweep, at the distance that jump could have put it.
        trace.push(`sweep:${despawnVerdict({ distanceToPlayerBlocks: 32, persistent: false })._tag}`)
        return trace
      }

      const first = run()
      expect(run()).toStrictEqual(first)
      expect(first).toStrictEqual([
        // Open after 21 frames, so the first shot is frame 21 (0-indexed) and
        // the last is frame 24 — the blow lands on frame 25 and shuts it before
        // it can fire again.
        'fire@21',
        'fire@22',
        'fire@23',
        'fire@24',
        // AND THEN IT IMMEDIATELY STARTS REOPENING. The flinch is a test on the
        // damage taken THIS frame (shulker-behavior.ts:49), not a timer, so one
        // hit buys the player exactly one frame of armour and the twenty-frame
        // window starts again. `SHULKER_FORCED_CLOSED_TICKS = 100` is presumably
        // what that was meant to fix, and it is dead — see the shell rule's
        // header. Traced rather than asserted in prose, because the consequence
        // of a dead constant is only visible in a run.
        'shell@25:Closed',
        'shell@26:Opening',
        'shell@27:Opening',
        'shell@28:Opening',
        'shell@29:Opening',
        'shell:Opening',
        'armour:0',
        'flees:true',
        'urge:Teleport:damaged/self',
        'offset:{"xBlocks":16,"zBlocks":0}',
        'sweep:Keep',
      ])
    }),
  )
})
