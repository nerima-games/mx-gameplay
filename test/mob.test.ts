/**
 * The creeper: its fuse, its blast, its spawn condition and its drop.
 *
 * ---------------------------------------------------------------------------
 * These are ported oracles, not invented cases
 * ---------------------------------------------------------------------------
 *
 * docs/porting.md §4 says to move the reference implementation's tests FIRST and
 * plan.md §8 says 「ゼロから仕様を再発明しない」. Every constant and every expected
 * number below is cited to `<reference-impl>` (a checkout of the frozen
 * `takeokunn/ts-minecraft` — docs/README.md), and the four files it comes from
 * are:
 *
 *   packages/entity/test/mob/creeper-fuse.test.ts          the fuse
 *   packages/entity/test/creeper-fuse.test.ts              an older duplicate
 *                                                          with three extra cases
 *   packages/entity/test/explosion.test.ts                 the damage table
 *   packages/entity/test/mob/mob-spawner-rules.test.ts     the distance band
 *   packages/entity/test/mob/terrain-spawn.test.ts         the light gate
 *   packages/entity/test/mob/drop.test.ts                  the chance gate
 *
 * The rule under test is a pure function in every case, so this file ENUMERATES
 * the state machine rather than sampling it: every transition of `CreeperFuse`
 * appears below at least once, including the ones that do nothing.
 *
 * `REGRESSION:` is used exactly where docs/testing.md §2-1 allows it — for
 * something that actually happened in the reference's production. That is one
 * test here (the death message), and it is the same bug DN-GP-3 is named for,
 * arriving at a new call site.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AIR_BLOCK_ID, validSpawnSurface, type BlockId } from '../domain/chunk-store-port'
import { applyDamage, deathMessage, fullHealth, isDead, MAX_HEALTH_POINTS } from '../domain/death-cause'
import { DeltaTimeSecs } from '../domain/frame-contract'
import { ITEM_TYPES } from '../domain/item-vocabulary'
import {
  CREEPER_FUSE_SECS,
  CREEPER_IGNITION_RANGE_BLOCKS,
  DORMANT_FUSE,
  stepCreeperFuse,
  type CreeperFuse,
} from '../domain/mob/creeper-fuse'
import {
  CREEPER_EXPLOSION_POWER,
  explosionDamageAmount,
  explosionDamageAt,
  explosionRadius,
  type Explosion,
} from '../domain/mob/explosion'
import {
  canHostileSpawnAt,
  HOSTILE_SPAWN_MAX_BLOCK_LIGHT,
  MAX_SPAWN_DISTANCE_BLOCKS,
  MIN_SPAWN_DISTANCE_BLOCKS,
  type SpawnCandidate,
} from '../domain/mob/hostile-spawn'
import {
  CREEPER_DROPS,
  CREEPER_XP_REWARD,
  dropPasses,
  LOWEST_ROLLS,
  mobXpReward,
  rollMobDrop,
  rollMobDrops,
  type MobDropRule,
} from '../domain/mob/mob-drop'

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
})

describe('the mob rules are deterministic by construction', () => {
  const mobDomain = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'mob')

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
})
