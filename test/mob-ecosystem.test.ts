import { describe, expect, it } from 'vitest'
import type { Position } from '@nerima-games/mc-kernel'
import { EntityId, type Entity } from '@nerima-games/mc-sim'
import {
  BLAZE_KIND,
  COW_KIND,
  ecosystemDimensionAllows,
  initialEcosystemMobState,
  propagatedPiglinProvocation,
  repairEcosystemMobState,
  SKELETON_KIND,
  SPIDER_KIND,
  stepEcosystemMob,
  ZOMBIFIED_PIGLIN_KIND,
} from '../src/domain/mob/mob-ecosystem'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'

const position = (x: number, z = 0): Position => ({ x, y: 64, z })

describe('mob ecosystem', () => {
  it('restricts overworld and nether mobs to their dimensions', () => {
    expect(ecosystemDimensionAllows(COW_KIND, 'overworld')).toBe(true)
    expect(ecosystemDimensionAllows(COW_KIND, 'nether')).toBe(false)
    expect(ecosystemDimensionAllows(BLAZE_KIND, 'nether')).toBe(true)
    expect(ecosystemDimensionAllows(BLAZE_KIND, 'end')).toBe(false)
  })

  it('makes passive mobs flee a nearby player', () => {
    const step = stepEcosystemMob(COW_KIND, initialEcosystemMobState(), position(0), position(2), 1)

    expect(step.feetPosition.x).toBeLessThan(0)
    expect(step.attack).toBeUndefined()
  })

  it('lets skeletons attack at range and respects their cooldown', () => {
    const first = stepEcosystemMob(
      SKELETON_KIND,
      initialEcosystemMobState(),
      position(0),
      position(10),
      0.05,
    )
    const second = stepEcosystemMob(SKELETON_KIND, first.state, position(0), position(10), 0.05)

    expect(first.attack).toMatchObject({ mode: 'projectile', damage: 4 })
    expect(second.attack).toBeUndefined()
  })

  it('lets zombies attack in melee range and respects their cooldown', () => {
    const first = stepEcosystemMob(
      ZOMBIE_KIND,
      initialEcosystemMobState(),
      position(1),
      position(0),
      0.05,
    )
    const second = stepEcosystemMob(ZOMBIE_KIND, first.state, position(1), position(0), 0.05)

    expect(first.attack).toMatchObject({ mode: 'melee', damage: 3 })
    expect(first.state.attackCooldownSecs).toBe(1)
    expect(first.feetPosition).toEqual(position(1))
    expect(second.attack).toBeUndefined()
  })

  it('propagates provocation only to nearby zombified piglins', () => {
    const attackedId = EntityId('piglin-attacked')
    const nearbyId = EntityId('piglin-nearby')
    const distantId = EntityId('piglin-distant')
    const entities: ReadonlyArray<Entity<undefined>> = [
      { id: attackedId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(0), healthPoints: 20, behaviour: undefined },
      { id: nearbyId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(8), healthPoints: 20, behaviour: undefined },
      { id: distantId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(20), healthPoints: 20, behaviour: undefined },
    ]

    expect(propagatedPiglinProvocation(entities, new Set([attackedId]))).toEqual(
      new Set([attackedId, nearbyId]),
    )
  })

  it('makes passive mobs wander instead of fleeing once the player is far enough away', () => {
    const step = stepEcosystemMob(COW_KIND, initialEcosystemMobState(), position(0), position(20), 1)

    // Too far to flee (distance 20 >= 8), so the mob wanders along the
    // cos/sin path rather than moving away from the target.
    expect(step.feetPosition).toEqual({
      x: 0 + Math.cos(1) * 1,
      y: 64,
      z: 0 + Math.sin(1) * 1,
    })
    expect(step.attack).toBeUndefined()
  })

  it('makes a passive mob wander when it has no target at all', () => {
    const step = stepEcosystemMob(COW_KIND, initialEcosystemMobState(), position(0), undefined, 1)

    expect(step.feetPosition).toEqual({
      x: 0 + Math.cos(1) * 1,
      y: 64,
      z: 0 + Math.sin(1) * 1,
    })
  })

  it('leaves a hostile mob in place when it has no target', () => {
    const step = stepEcosystemMob(SKELETON_KIND, initialEcosystemMobState(), position(0), undefined, 1)

    expect(step.feetPosition).toEqual(position(0))
    expect(step.attack).toBeUndefined()
    expect(step.jumping).toBe(false)
  })

  it('treats a non-finite deltaSecs as zero elapsed time', () => {
    const state = { ...initialEcosystemMobState(), attackCooldownSecs: 2, motionPhase: 3 }

    const step = stepEcosystemMob(SKELETON_KIND, state, position(0), position(10), Number.NaN)

    expect(step.state.attackCooldownSecs).toBe(2)
    expect(step.state.motionPhase).toBe(3)
  })

  it('does not let an unprovoked zombified piglin attack, even in melee range', () => {
    const step = stepEcosystemMob(
      ZOMBIFIED_PIGLIN_KIND,
      initialEcosystemMobState(),
      position(0),
      position(0.5),
      0.05,
    )

    expect(step.attack).toBeUndefined()
    expect(step.feetPosition).toEqual(position(0))
  })

  it('lets a provoked zombified piglin attack in melee range', () => {
    const provoked = { ...initialEcosystemMobState(), provoked: true }

    const step = stepEcosystemMob(ZOMBIFIED_PIGLIN_KIND, provoked, position(0), position(0.5), 0.05)

    expect(step.attack).toMatchObject({ mode: 'melee', damage: 5, attackerKind: ZOMBIFIED_PIGLIN_KIND })
  })

  it('lets blazes attack at range and respects their wider cooldown', () => {
    const first = stepEcosystemMob(BLAZE_KIND, initialEcosystemMobState(), position(0), position(16), 0.05)
    const second = stepEcosystemMob(BLAZE_KIND, first.state, position(0), position(16), 0.05)

    expect(first.attack).toMatchObject({ mode: 'projectile', damage: 6, attackerKind: BLAZE_KIND })
    expect(first.state.attackCooldownSecs).toBe(3)
    expect(second.attack).toBeUndefined()
  })

  it('lets spiders attack in melee range and jump while attacking', () => {
    const step = stepEcosystemMob(SPIDER_KIND, initialEcosystemMobState(), position(0), position(1), 0.05)

    expect(step.attack).toMatchObject({ mode: 'melee', damage: 3, attackerKind: SPIDER_KIND })
    expect(step.jumping).toBe(true)
  })

  it('makes a spider jump while closing distance outside melee range', () => {
    const step = stepEcosystemMob(SPIDER_KIND, initialEcosystemMobState(), position(0), position(10), 0.05)

    expect(step.attack).toBeUndefined()
    expect(step.jumping).toBe(true)
  })

  it('does not divide by zero when a hostile mob is already standing on its target', () => {
    // Below skeleton attack range (distance 0 < 6), so it falls through to the
    // default chase movement with target === self: `move`'s zero-length guard
    // must return `self` unchanged rather than computing 0/0.
    const step = stepEcosystemMob(SKELETON_KIND, initialEcosystemMobState(), position(3), position(3), 0.05)

    expect(step.feetPosition).toEqual(position(3))
    expect(step.jumping).toBe(false)
  })
})

describe('repairEcosystemMobState', () => {
  it('round-trips a validly-shaped persisted state', () => {
    const persisted = { _tag: 'EcosystemMob', attackCooldownSecs: 1.5, motionPhase: 4.2, provoked: true }

    expect(repairEcosystemMobState(persisted)).toEqual(persisted)
  })

  it('rejects a value with the wrong tag', () => {
    expect(repairEcosystemMobState({ _tag: 'SomethingElse' })).toBeUndefined()
  })

  it('rejects null and non-object values', () => {
    expect(repairEcosystemMobState(null)).toBeUndefined()
    expect(repairEcosystemMobState('EcosystemMob')).toBeUndefined()
  })

  it('clamps a negative attackCooldownSecs to zero instead of trusting a corrupt save', () => {
    const repaired = repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownSecs: -5,
      motionPhase: 0,
      provoked: false,
    })

    expect(repaired?.attackCooldownSecs).toBe(0)
  })

  it('defaults a non-finite attackCooldownSecs to zero', () => {
    const repaired = repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownSecs: Number.NaN,
      motionPhase: 0,
      provoked: false,
    })

    expect(repaired?.attackCooldownSecs).toBe(0)
  })

  it('defaults a non-finite motionPhase to zero', () => {
    const repaired = repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownSecs: 0,
      motionPhase: Number.POSITIVE_INFINITY,
      provoked: false,
    })

    expect(repaired?.motionPhase).toBe(0)
  })

  it('only a literal true survives as provoked', () => {
    const repaired = repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownSecs: 0,
      motionPhase: 0,
      provoked: 'yes',
    })

    expect(repaired?.provoked).toBe(false)
  })
})
