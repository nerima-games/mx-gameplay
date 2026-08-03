import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  hostileMobSnapshot,
  isHostileMobSnapshot,
  repairMobBehaviour,
  sweepMobs,
  type MobBehaviour,
} from '../src/domain/entities/mob-frame'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import { RANDOM_DESPAWN_CHANCE } from '../src/domain/mob/hostile-despawn'
import { DeltaTimeSecs } from '../src/domain/frame-contract'
import { nextRoll } from '../src/domain/frame-rolls'
import type { Position } from '@nerima-games/mc-kernel'
import { makeEntityManagerDouble } from './support/entity-manager-double'

const PLAYER: Position = { x: 0, y: 64, z: 0 }
const AT_RANDOM_DISTANCE: Position = { x: 40, y: 64, z: 0 }

const seedWhoseNextRollDespawns = (): number => {
  for (let seed = 1; seed < 10_000; seed += 1) {
    if (nextRoll(seed).roll < RANDOM_DESPAWN_CHANCE) return seed
  }
  throw new Error('expected the deterministic generator to have a despawn roll')
}

describe('hostile despawn is part of the mob frame state', () => {
  it.effect('retains age across frames and advances the PRNG only when random despawn is eligible', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: ZOMBIE_KIND,
        feetPosition: AT_RANDOM_DISTANCE,
        healthPoints: 20,
        behaviour: hostileMobSnapshot(undefined, { ageTicks: 599 }),
      })

      const seed = 1
      const boundary = yield* sweepMobs(
        roster.api,
        { target: PLAYER, dt: DeltaTimeSecs(0.05) },
        seed,
      )
      expect(boundary.seed).toBe(seed)

      const afterBoundary = yield* roster.api.entities
      expect(afterBoundary).toHaveLength(1)
      expect(afterBoundary[0]?.behaviour).toMatchObject({ _tag: 'HostileMob', ageTicks: 600 })

      const eligible = yield* sweepMobs(
        roster.api,
        { target: PLAYER, dt: DeltaTimeSecs(0.05) },
        boundary.seed,
      )
      expect(eligible.seed).toBe(nextRoll(seed).seed)

      const afterEligible = yield* roster.api.entities
      if (afterEligible[0] !== undefined) {
        expect(afterEligible[0].behaviour).toMatchObject({ _tag: 'HostileMob', ageTicks: 601 })
      }
    }),
  )

  it.effect('uses the deterministic roll, preserves exemptions, and does not draw for immediate distance', () =>
    Effect.gen(function* () {
      const seed = seedWhoseNextRollDespawns()
      const natural = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* natural.api.spawn({
        kind: ZOMBIE_KIND,
        feetPosition: AT_RANDOM_DISTANCE,
        healthPoints: 20,
        behaviour: hostileMobSnapshot(undefined, { ageTicks: 601 }),
      })
      const naturalSweep = yield* sweepMobs(
        natural.api,
        { target: PLAYER, dt: DeltaTimeSecs(0) },
        seed,
      )
      expect(yield* natural.api.count).toBe(0)
      expect(naturalSweep.seed).toBe(nextRoll(seed).seed)

      const persistent = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* persistent.api.spawn({
        kind: ZOMBIE_KIND,
        feetPosition: AT_RANDOM_DISTANCE,
        healthPoints: 20,
        behaviour: hostileMobSnapshot(undefined, { ageTicks: 601, named: true }),
      })
      const persistentSweep = yield* sweepMobs(
        persistent.api,
        { target: PLAYER, dt: DeltaTimeSecs(0) },
        seed,
      )
      expect(yield* persistent.api.count).toBe(1)
      expect(persistentSweep.seed).toBe(seed)

      const distant = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* distant.api.spawn({
        kind: ZOMBIE_KIND,
        feetPosition: { x: 129, y: 64, z: 0 },
        healthPoints: 20,
        behaviour: hostileMobSnapshot(undefined, { ageTicks: 601 }),
      })
      const distantSweep = yield* sweepMobs(
        distant.api,
        { target: PLAYER, dt: DeltaTimeSecs(0) },
        seed,
      )
      expect(yield* distant.api.count).toBe(0)
      expect(distantSweep.seed).toBe(seed)
    }),
  )

  it.effect('peaceful overrides persistence and the public snapshot survives a save roundtrip', () =>
    Effect.gen(function* () {
      const saved = hostileMobSnapshot(undefined, {
        ageTicks: 777,
        persistent: true,
        named: true,
        tamed: true,
      })
      const decoded: unknown = JSON.parse(JSON.stringify(saved))
      const restored = repairMobBehaviour(ZOMBIE_KIND, decoded)
      expect(isHostileMobSnapshot(restored)).toBe(true)
      expect(restored).toStrictEqual(saved)

      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: ZOMBIE_KIND,
        feetPosition: PLAYER,
        healthPoints: 20,
        behaviour: restored,
      })
      const seed = 17
      const swept = yield* sweepMobs(
        roster.api,
        { target: PLAYER, dt: DeltaTimeSecs(0), difficulty: 'peaceful' },
        seed,
      )
      expect(yield* roster.api.count).toBe(0)
      expect(swept.seed).toBe(seed)
    }),
  )
})
