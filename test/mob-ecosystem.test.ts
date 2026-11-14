import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { Result } from 'effect'
import { position as atPosition } from './support/coordinate-fixtures'
import { EntityHealthPoints, type Position } from '@nerima-games/mc-kernel'
import { EntityId, EntityKind, type Entity } from '@nerima-games/mc-sim'
import {
  BLAZE_KIND,
  CHICKEN_KIND,
  COW_KIND,
  ecosystemDimensionAllows,
  initialEcosystemMobState,
  propagatedPiglinProvocation,
  PIG_KIND,
  repairEcosystemMobState,
  repairMobMovementState,
  SKELETON_KIND,
  SKELETON_ATTACK_INTERVAL_TICKS,
  SHEEP_KIND,
  SPIDER_KIND,
  VILLAGER_KIND,
  stepEcosystemMob,
  ZOMBIFIED_PIGLIN_KIND,
} from '../src/domain/mob/mob-ecosystem'
import { CREEPER_KIND, ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'

const position = (x: number, z = 0): Position => atPosition(x, 64, z)
const movementGoal = (
  kind: Parameters<typeof stepEcosystemMob>[0],
  self: Position,
  target: Position,
  state = initialEcosystemMobState(),
): Position | undefined => stepEcosystemMob(kind, state, self, target, 0.05).state.movementGoal

describe('mob ecosystem', () => {
  it('restricts overworld and nether mobs to their dimensions', () => {
    expect(ecosystemDimensionAllows(COW_KIND, 'overworld')).toBe(true)
    expect(ecosystemDimensionAllows(COW_KIND, 'nether')).toBe(false)
    expect(ecosystemDimensionAllows(BLAZE_KIND, 'nether')).toBe(true)
    expect(ecosystemDimensionAllows(BLAZE_KIND, 'end')).toBe(false)
  })

  it('makes passive mobs flee a nearby player', () => {
    const step = stepEcosystemMob(COW_KIND, initialEcosystemMobState(), position(0), position(2), 1)

    expect(step.feetPosition).toEqual(position(0))
    expect(step.state.movementGoal?.x).toBeLessThan(0)
    expect(step.attack).toBeUndefined()
  })

  it('does not apply an approach policy to an unlisted entity kind', () => {
    const self = position(0)
    const step = stepEcosystemMob(EntityKind('unlisted-mob'), initialEcosystemMobState(), self, position(4), 0.05)

    expect(step.state.movementGoal).toEqual(self)
    expect(step.feetPosition).toEqual(self)
    expect(step.attack).toBeUndefined()
  })

  it('sets a flee goal eight blocks directly away from every nearby target', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        fc.tuple(fc.integer({ min: -5, max: 5 }), fc.integer({ min: -5, max: 5 }))
          .filter(([offsetX, offsetZ]) => offsetX !== 0 || offsetZ !== 0),
        (selfX, selfZ, [offsetX, offsetZ]) => {
          const self = position(selfX, selfZ)
          const target = position(selfX + offsetX, selfZ + offsetZ)
          const goal = movementGoal(COW_KIND, self, target)

          if (goal === undefined) {
            expect(goal).toBeDefined()
            return
          }

          const goalX = goal.x - self.x
          const goalZ = goal.z - self.z
          const goalDistance = Math.hypot(goalX, goalZ)
          const targetDistance = Math.hypot(offsetX, offsetZ)

          expect(goal.y).toBe(self.y)
          expect(goalDistance).toBeCloseTo(8, 10)
          expect(goalX / goalDistance).toBeCloseTo(-offsetX / targetDistance, 10)
          expect(goalZ / goalDistance).toBeCloseTo(-offsetZ / targetDistance, 10)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('holds skeleton and blaze positions throughout their ranged-spacing bands', () => {
    const rangedBands = [
      { kind: SKELETON_KIND, minDistance: 8, maxDistance: 16 },
      { kind: BLAZE_KIND, minDistance: 8, maxDistance: 24 },
    ] as const

    fc.assert(
      fc.property(
        fc.constantFrom(...rangedBands),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -24, max: 24 }),
        fc.integer({ min: -24, max: 24 }),
        (band, selfX, selfZ, offsetX, offsetZ) => {
          const distance = Math.hypot(offsetX, offsetZ)
          fc.pre(distance >= band.minDistance && distance <= band.maxDistance)

          const self = position(selfX, selfZ)
          const target = position(selfX + offsetX, selfZ + offsetZ)

          expect(movementGoal(band.kind, self, target)).toEqual(self)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('lets skeletons attack at range and observes the 60-tick cadence independent of deltaSecs', () => {
    const first = stepEcosystemMob(
      SKELETON_KIND,
      initialEcosystemMobState(),
      position(0),
      position(10),
      0.05,
    )
    let beforeCadence = first
    for (let elapsedTicks = 1; elapsedTicks < SKELETON_ATTACK_INTERVAL_TICKS; elapsedTicks += 1) {
      beforeCadence = stepEcosystemMob(SKELETON_KIND, beforeCadence.state, position(0), position(10), 3)
      expect(beforeCadence.attack).toBeUndefined()
    }
    const ready = stepEcosystemMob(SKELETON_KIND, beforeCadence.state, position(0), position(10), 0)

    expect(SKELETON_ATTACK_INTERVAL_TICKS).toBe(60)
    expect(first.attack).toMatchObject({ mode: 'projectile', damage: 3 })
    expect(first.state.attackCooldownTicks).toBe(SKELETON_ATTACK_INTERVAL_TICKS)
    expect(beforeCadence.state.attackCooldownTicks).toBe(1)
    expect(ready.attack).toMatchObject({ mode: 'projectile', damage: 3 })
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
    expect(first.state.attackCooldownTicks).toBe(20)
    expect(first.feetPosition).toEqual(position(1))
    expect(second.attack).toBeUndefined()
  })

  it('stops hostile pursuit at the Java Edition follow range', () => {
    // Java Edition 26.3 ranges: creepers 16 blocks, zombies and zombified piglins 35.
    // Sources: https://minecraft.wiki/w/Creeper#Behavior and https://minecraft.wiki/w/Attribute#Mob_Follow_Range
    const self = position(0)
    const provokedPiglin = { ...initialEcosystemMobState(), provoked: true }

    expect(movementGoal(CREEPER_KIND, self, position(16))).toEqual(position(16))
    expect(movementGoal(CREEPER_KIND, self, position(16.5))).toEqual(self)
    expect(movementGoal(ZOMBIE_KIND, self, position(35))).toEqual(position(35))
    expect(movementGoal(ZOMBIE_KIND, self, position(35.5))).toEqual(self)
    expect(movementGoal(ZOMBIFIED_PIGLIN_KIND, self, position(35), provokedPiglin)).toEqual(position(35))
    expect(movementGoal(ZOMBIFIED_PIGLIN_KIND, self, position(35.5), provokedPiglin)).toEqual(self)
  })

  it('keeps spider and ranged pursuit inside their follow ranges', () => {
    // Spider, skeleton, and other ordinary mobs use 16 blocks; blaze uses 48.
    // Source: https://minecraft.wiki/w/Attribute#Mob_Follow_Range
    const self = atPosition(0, 64, 0)
    const spiderTargetAtRange = atPosition(16, 65, 0)
    const spiderTargetOutsideRange = atPosition(16.5, 65, 0)

    expect(movementGoal(SPIDER_KIND, self, spiderTargetAtRange)).toEqual(spiderTargetAtRange)
    expect(movementGoal(SPIDER_KIND, self, spiderTargetOutsideRange)).toEqual(self)
    expect(movementGoal(SKELETON_KIND, self, position(16.5))).toEqual(self)
    expect(movementGoal(BLAZE_KIND, self, position(48))).toEqual(position(48))
    expect(movementGoal(BLAZE_KIND, self, position(48.5))).toEqual(self)
  })

  it('uses the explicit approach policy for villagers', () => {
    const self = position(0)
    const target = position(8)

    expect(movementGoal(VILLAGER_KIND, self, target)).toEqual(target)
    expect(movementGoal(VILLAGER_KIND, self, position(17))).toEqual(self)
  })

  it('propagates provocation only to nearby zombified piglins', () => {
    const attackedId = EntityId('piglin-attacked')
    const nearbyId = EntityId('piglin-nearby')
    const distantId = EntityId('piglin-distant')
    const entities: ReadonlyArray<Entity<undefined>> = [
      { id: attackedId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(0), healthPoints: EntityHealthPoints(20), behaviour: undefined },
      { id: nearbyId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(8), healthPoints: EntityHealthPoints(20), behaviour: undefined },
      { id: distantId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(20), healthPoints: EntityHealthPoints(20), behaviour: undefined },
    ]

    expect(propagatedPiglinProvocation(entities, new Set([attackedId]))).toEqual(
      new Set([attackedId, nearbyId]),
    )
  })

  it('sets a four-block wander goal instead of fleeing once the player is far enough away', () => {
    const step = stepEcosystemMob(COW_KIND, initialEcosystemMobState(), position(0), position(20), 1)
    const goal = step.state.movementGoal

    expect(step.feetPosition).toEqual(position(0))
    expect(goal).toBeDefined()
    if (goal === undefined) return
    expect(goal.y).toBe(step.feetPosition.y)
    expect(Math.hypot(goal.x - step.feetPosition.x, goal.z - step.feetPosition.z)).toBeLessThanOrEqual(4 + 1e-12)
    expect(step.attack).toBeUndefined()
  })

  it('makes a passive mob set a wander goal when it has no target at all', () => {
    const step = stepEcosystemMob(COW_KIND, initialEcosystemMobState(), position(0), undefined, 1)
    const goal = step.state.movementGoal

    expect(step.feetPosition).toEqual(position(0))
    expect(goal).toBeDefined()
    if (goal === undefined) return
    expect(goal.y).toBe(step.feetPosition.y)
    expect(Math.hypot(goal.x - step.feetPosition.x, goal.z - step.feetPosition.z)).toBeLessThanOrEqual(4 + 1e-12)
  })

  it('keeps wander goals within four blocks and repeats them for the same phase', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: 0, max: 100_000 }),
        (selfX, selfZ, phase) => {
          const self = position(selfX, selfZ)
          const target = position(selfX + 20, selfZ)
          const state = { ...initialEcosystemMobState(), motionPhase: phase }
          const firstGoal = movementGoal(COW_KIND, self, target, state)
          const repeatedGoal = movementGoal(COW_KIND, self, target, state)

          if (firstGoal === undefined || repeatedGoal === undefined) {
            expect(firstGoal).toBeDefined()
            expect(repeatedGoal).toBeDefined()
            return
          }

          expect(firstGoal.y).toBe(self.y)
          const distance = Math.hypot(firstGoal.x - self.x, firstGoal.z - self.z)
          expect(distance).toBeGreaterThan(0)
          expect(distance).toBeLessThanOrEqual(4 + 1e-12)
          expect(repeatedGoal).toEqual(firstGoal)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('sets a finite flee goal for a subnormal diagonal offset', () => {
    const self = atPosition(0, 0, 0)
    const target = atPosition(Number.MIN_VALUE, 0, -Number.MIN_VALUE)
    const step = stepEcosystemMob(
      COW_KIND,
      initialEcosystemMobState(),
      self,
      target,
      0.001,
    )
    expect(step.feetPosition).toEqual(self)
    expect(Number.isFinite(step.state.movementGoal?.x)).toBe(true)
    expect(Number.isFinite(step.state.movementGoal?.z)).toBe(true)
  })

  it('leaves a hostile mob in place when it has no target', () => {
    const step = stepEcosystemMob(SKELETON_KIND, initialEcosystemMobState(), position(0), undefined, 1)

    expect(step.feetPosition).toEqual(position(0))
    expect(step.attack).toBeUndefined()
    expect(step.jumping).toBe(false)
  })

  it('advances motion phase by exactly one simulation tick regardless of deltaSecs', () => {
    const state = { ...initialEcosystemMobState(), attackCooldownTicks: 2, motionPhase: 3 }

    const step = stepEcosystemMob(SKELETON_KIND, state, position(0), position(10), Number.NaN)

    expect(step.state.attackCooldownTicks).toBe(1)
    expect(step.state.motionPhase).toBe(4)
  })

  it('saturates the tick counter at the largest safe integer', () => {
    const state = { ...initialEcosystemMobState(), motionPhase: Number.MAX_SAFE_INTEGER }
    const step = stepEcosystemMob(SKELETON_KIND, state, position(0), undefined, 0.05)

    expect(step.state.motionPhase).toBe(Number.MAX_SAFE_INTEGER)
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
    expect(first.state.attackCooldownTicks).toBe(SKELETON_ATTACK_INTERVAL_TICKS)
    expect(second.attack).toBeUndefined()
  })

  it('lets spiders attack in melee range and jump while attacking', () => {
    const step = stepEcosystemMob(SPIDER_KIND, initialEcosystemMobState(), position(0), position(1), 0.05)

    expect(step.attack).toMatchObject({ mode: 'melee', damage: 2, attackerKind: SPIDER_KIND })
    expect(step.jumping).toBe(true)
  })

  it('uses per-kind movement goals for all supported species', () => {
    const target = position(12)
    const self = position(0)
    const cases = [
      COW_KIND,
      PIG_KIND,
      SHEEP_KIND,
      CHICKEN_KIND,
      SKELETON_KIND,
      SPIDER_KIND,
      BLAZE_KIND,
      ZOMBIFIED_PIGLIN_KIND,
    ] as const

    for (const kind of cases) {
      const state = kind === ZOMBIFIED_PIGLIN_KIND
        ? { ...initialEcosystemMobState(), provoked: true }
        : initialEcosystemMobState()
      const step = stepEcosystemMob(kind, state, self, target, 0)
      expect(step.state.movementGoal).toBeDefined()
      if (kind === SKELETON_KIND || kind === BLAZE_KIND) {
        expect(step.state.movementGoal).toEqual(self)
      } else if (kind === ZOMBIFIED_PIGLIN_KIND || kind === SPIDER_KIND) {
        expect(step.state.movementGoal).toEqual(target)
      } else {
        expect(step.state.movementGoal?.x).toBeGreaterThan(0)
      }
    }
  })

  it('makes a spider jump while closing distance outside melee range', () => {
    const step = stepEcosystemMob(SPIDER_KIND, initialEcosystemMobState(), position(0), position(10), 0.05)

    expect(step.attack).toBeUndefined()
    expect(step.jumping).toBe(true)
  })

  it('sets a finite eight-block spacing goal when a skeleton is already on its target', () => {
    const self = position(3, 4)
    const step = stepEcosystemMob(SKELETON_KIND, initialEcosystemMobState(), self, self, 0.05)
    const goal = step.state.movementGoal

    expect(goal).toBeDefined()
    if (goal === undefined) {
      expect(goal).toBeDefined()
      return
    }

    expect(Number.isFinite(goal.x)).toBe(true)
    expect(Number.isFinite(goal.y)).toBe(true)
    expect(Number.isFinite(goal.z)).toBe(true)
    expect(goal.y).toBe(self.y)
    expect(Math.hypot(goal.x - self.x, goal.z - self.z)).toBeCloseTo(8, 10)
    expect(step.feetPosition).toEqual(self)
    expect(step.jumping).toBe(false)
    expect(step.attack).toBeUndefined()
  })
})

describe('repairEcosystemMobState', () => {
  it('round-trips a validly-shaped persisted state', () => {
    const persisted = {
      _tag: 'EcosystemMob', attackCooldownTicks: 30, motionPhase: 5, provoked: true,
      hasHeadProtection: false, burningTicks: 0,
    }

    expect(repairEcosystemMobState(persisted)).toEqual(Result.succeed(persisted))
  })

  it('restores finite, cell-addressable movement goals', () => {
    const goal = atPosition(4.5, 64, -2.5)

    const repaired = repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownTicks: 0,
      motionPhase: 0,
      provoked: false,
      movementGoal: goal,
    })
    expect(Result.isSuccess(repaired) && repaired.success?.movementGoal).toEqual(goal)
  })

  it('migrates only omitted legacy fields and a seconds cooldown', () => {
    expect(repairEcosystemMobState({
      _tag: 'EcosystemMob', attackCooldownSecs: 1.5, motionPhase: 4.2, provoked: true,
    })).toEqual(Result.succeed({
      _tag: 'EcosystemMob', attackCooldownTicks: 30, motionPhase: 5, provoked: true,
      hasHeadProtection: false, burningTicks: 0,
    }))
  })

  it('rejects omissions that are not part of the legacy ecosystem migration', () => {
    expect(repairEcosystemMobState({
      _tag: 'EcosystemMob', attackCooldownSecs: 0, provoked: false,
    })).toEqual(Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'motionPhase' }))
    expect(repairEcosystemMobState({
      _tag: 'EcosystemMob', attackCooldownSecs: 0, motionPhase: 0,
    })).toEqual(Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'provoked' }))
    expect(repairEcosystemMobState({
      _tag: 'EcosystemMob', motionPhase: 0, provoked: false,
    })).toEqual(Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'attackCooldownTicks' }))
  })

  it('leaves an absent ecosystem state absent', () => {
    expect(repairEcosystemMobState(undefined)).toEqual(Result.succeed(undefined))
  })

  it('returns a typed failure for a present value with the wrong tag', () => {
    expect(repairEcosystemMobState({ _tag: 'SomethingElse' })).toEqual(Result.fail({
      _tag: 'EcosystemMobStateRepairFailure', field: '_tag',
    }))
  })

  it('returns a typed failure for present null and non-object values', () => {
    const failure = Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: '_tag' })
    expect(repairEcosystemMobState(null)).toEqual(failure)
    expect(repairEcosystemMobState('EcosystemMob')).toEqual(failure)
  })

  it('returns a typed failure for a negative legacy seconds cooldown', () => {
    expect(repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownSecs: -5,
      motionPhase: 0,
      provoked: false,
    })).toEqual(Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'attackCooldownSecs' }))
  })

  it('returns a typed failure for a non-finite legacy seconds cooldown', () => {
    expect(repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownSecs: Number.NaN,
      motionPhase: 0,
      provoked: false,
    })).toEqual(Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'attackCooldownSecs' }))
  })

  it('rejects malformed persisted cooldowns, including a seconds overflow', () => {
    const failure = (field: 'attackCooldownTicks' | 'attackCooldownSecs') => Result.fail({
      _tag: 'EcosystemMobStateRepairFailure',
      field,
    })
    const state = { _tag: 'EcosystemMob', motionPhase: 0, provoked: false }

    expect(repairEcosystemMobState({ ...state, attackCooldownTicks: -1 })).toEqual(failure('attackCooldownTicks'))
    expect(repairEcosystemMobState({ ...state, attackCooldownTicks: Number.MAX_VALUE })).toEqual(failure('attackCooldownTicks'))
    expect(repairEcosystemMobState({ ...state, attackCooldownTicks: 0, attackCooldownSecs: 'bad' })).toEqual(failure('attackCooldownSecs'))
    expect(repairEcosystemMobState({ ...state, attackCooldownTicks: 0, attackCooldownSecs: Number.POSITIVE_INFINITY })).toEqual(failure('attackCooldownSecs'))
    expect(repairEcosystemMobState({ ...state, attackCooldownTicks: 0, attackCooldownSecs: -1 })).toEqual(failure('attackCooldownSecs'))
    expect(repairEcosystemMobState({ ...state, attackCooldownSecs: Number.MAX_VALUE })).toEqual(failure('attackCooldownSecs'))
    expect(repairEcosystemMobState({ ...state, attackCooldownTicks: 2, attackCooldownSecs: 0.1 })).toMatchObject({
      _tag: 'Success', success: { attackCooldownTicks: 2 },
    })
  })

  it('rounds a fractional tick cooldown up to an integer tick', () => {
    const repaired = repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownTicks: 1.5,
      motionPhase: 0,
      provoked: false,
    })

    expect(repaired).toMatchObject({ _tag: 'Success', success: { attackCooldownTicks: 2 } })
  })

  it('returns a typed failure for a non-finite motion phase', () => {
    expect(repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownTicks: 0,
      motionPhase: Number.POSITIVE_INFINITY,
      provoked: false,
    })).toEqual(Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'motionPhase' }))
  })

  it('repairs a fractional saved motion phase to a whole tick count', () => {
    const repaired = repairEcosystemMobState({
      _tag: 'EcosystemMob', attackCooldownTicks: 0, motionPhase: 4.2, provoked: false,
    })

    expect(repaired).toMatchObject({ _tag: 'Success', success: { motionPhase: 5 } })
  })

  it('returns a typed failure for an invalid present boolean', () => {
    expect(repairEcosystemMobState({
      _tag: 'EcosystemMob',
      attackCooldownTicks: 0,
      motionPhase: 0,
      provoked: 'yes',
    })).toEqual(Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'provoked' }))
  })

  it('returns typed failures for invalid present movement and ecosystem fields', () => {
    const base = {
      _tag: 'EcosystemMob', attackCooldownTicks: 0, motionPhase: 0, provoked: false,
      hasHeadProtection: false, burningTicks: 0,
    }
    expect(repairEcosystemMobState({ ...base, movementGoal: { x: '2', y: 64, z: 3 } })).toEqual(Result.fail({
      _tag: 'EcosystemMobStateRepairFailure', field: 'movementGoal',
    }))
    expect(repairEcosystemMobState({
      ...base,
      movementGoal: { x: Number.MAX_VALUE, y: 64, z: 3 },
    })).toEqual(Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'movementGoal' }))
    expect(repairEcosystemMobState({ ...base, movementGoal: null })).toEqual(Result.fail({
      _tag: 'EcosystemMobStateRepairFailure', field: 'movementGoal',
    }))
    expect(repairEcosystemMobState({ ...base, burningTicks: 161 })).toEqual(Result.fail({
      _tag: 'EcosystemMobStateRepairFailure', field: 'burningTicks',
    }))
    expect(repairEcosystemMobState({ ...base, burningTicks: -1 })).toEqual(Result.fail({
      _tag: 'EcosystemMobStateRepairFailure', field: 'burningTicks',
    }))
    expect(repairEcosystemMobState({ ...base, hasHeadProtection: 'yes' })).toEqual(Result.fail({
      _tag: 'EcosystemMobStateRepairFailure', field: 'hasHeadProtection',
    }))
    expect(repairEcosystemMobState({ ...base, movement: { body: 'invalid' } })).toEqual(Result.fail({
      _tag: 'EcosystemMobStateRepairFailure', field: 'movement',
    }))
    expect(repairEcosystemMobState({ ...base, movement: undefined })).toEqual(Result.fail({
      _tag: 'EcosystemMobStateRepairFailure', field: 'movement',
    }))
  })

  it('keeps omitted movement optional and fails a present malformed movement state', () => {
    expect(repairMobMovementState(undefined)).toEqual(Result.succeed(undefined))
    expect(repairMobMovementState({ body: 'invalid' })).toEqual(Result.fail({
      _tag: 'MobMovementStateRepairFailure',
    }))
  })
})
