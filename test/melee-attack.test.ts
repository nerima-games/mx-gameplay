import { describe, expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { AttackRangeDistance, EntityHealthPoints, EntityId, SimulationTickSchema } from '@nerima-games/mc-kernel'
import { type Entity } from '@nerima-games/mc-sim'
import { position as atPosition } from './support/coordinate-fixtures'
import { DamageImmunityStateSchema, ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import {
  DEFAULT_MELEE_ATTACK_SPEED,
  MELEE_ATTACK_COOLDOWN_TICKS_PER_SECOND,
  MIN_ATTACK_COOLDOWN_FOR_CRITICAL,
  MeleeCooldownTicksSchema,
  MeleeAttackPreparationSchema,
  meleeAttackCooldown,
  meleeAttackCooldownForItem,
  meleeDamageForItem,
  meleeTarget,
  meleeTargetBeforeBlock,
  prepareMeleeAttack,
  type MeleeAttackRequest,
} from '../src/domain/interactions/melee-attack'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'

const MELEE_PARITY_FIXTURE = {
  source: 'https://minecraft.wiki/w/Melee_attack',
  parity: 'https://raw.githubusercontent.com/takeokunn/ts-minecraft/main/docs/reference/vanilla-parity.md',
  edition: 'Java Edition 26.3',
} as const

const zombie: Entity<MobBehaviour> = {
  id: EntityId('zombie:melee-target'),
  kind: ZOMBIE_KIND,
  feetPosition: atPosition(0, 64, 2.5),
  healthPoints: EntityHealthPoints(20),
  behaviour: undefined,
}

const meleeCooldownTicks = (value: number) =>
  Result.getOrThrow(Schema.decodeUnknownResult(MeleeCooldownTicksSchema)(value))

const damageImmunityState = (lastDamageTick: number, lastDamageAmount: number) =>
  Schema.decodeUnknownSync(DamageImmunityStateSchema)({
    lastDamageTick: Schema.decodeUnknownSync(SimulationTickSchema)(lastDamageTick),
    lastDamageAmount,
  })

describe('melee attack damage', () => {
  it('uses unarmed damage for empty hands and ranged items', () => {
    expect(meleeDamageForItem(undefined)).toBe(1)
    expect(meleeDamageForItem(null)).toBe(1)
    expect(meleeDamageForItem('bow')).toBe(1)
  })

  it('maps mining tools to their melee damage', () => {
    expect(meleeDamageForItem('diamond_pickaxe')).toBe(5)
    expect(meleeDamageForItem('diamond_shovel')).toBe(5.5)
    expect(meleeDamageForItem('wooden_hoe')).toBe(1)
  })

  it(`maps axes to their vanilla damage (${MELEE_PARITY_FIXTURE.source}, ${MELEE_PARITY_FIXTURE.edition})`, () => {
    expect(meleeDamageForItem('wooden_axe')).toBe(7)
    expect(meleeDamageForItem('gold_axe')).toBe(7)
    expect(meleeDamageForItem('stone_axe')).toBe(9)
    expect(meleeDamageForItem('iron_axe')).toBe(9)
    expect(meleeDamageForItem('diamond_axe')).toBe(9)
    expect(meleeDamageForItem('netherite_axe')).toBe(10)
  })

  it(`maps each supported sword to its melee damage (${MELEE_PARITY_FIXTURE.source}, ${MELEE_PARITY_FIXTURE.edition})`, () => {
    expect(meleeDamageForItem('wooden_sword')).toBe(4)
    expect(meleeDamageForItem('gold_sword')).toBe(4)
    expect(meleeDamageForItem('stone_sword')).toBe(5)
    expect(meleeDamageForItem('iron_sword')).toBe(6)
    expect(meleeDamageForItem('diamond_sword')).toBe(7)
    expect(meleeDamageForItem('netherite_sword')).toBe(8)
  })

  it(`applies the parity critical multiplier (${MELEE_PARITY_FIXTURE.parity}, ${MELEE_PARITY_FIXTURE.edition})`, () => {
    expect(meleeDamageForItem('iron_sword', true)).toBe(9)
    expect(meleeDamageForItem(undefined, true)).toBe(1.5)
  })
})

describe('melee attack cooldown', () => {
  it('scales charge by attack speed and reaches full strength at the cooldown boundary', () => {
    const atStart = meleeAttackCooldown({ attackSpeed: 4, ticksSinceLastAttack: 0 })
    const oneTickShort = meleeAttackCooldown({ attackSpeed: 4, ticksSinceLastAttack: 4 })
    const ready = meleeAttackCooldown({ attackSpeed: 4, ticksSinceLastAttack: 5 })
    const slowStart = meleeAttackCooldown({ attackSpeed: 1, ticksSinceLastAttack: 0 })
    const swordReady = meleeAttackCooldownForItem('iron_sword', 12)
    const swordStart = meleeAttackCooldownForItem('iron_sword', 0)
    const axeStart = meleeAttackCooldownForItem('wooden_axe', 0)
    const emptyHandStart = meleeAttackCooldownForItem(undefined, 0)
    const rangedItemStart = meleeAttackCooldownForItem('bow', 0)

    expect(MELEE_ATTACK_COOLDOWN_TICKS_PER_SECOND).toBe(20)
    expect(DEFAULT_MELEE_ATTACK_SPEED).toBe(4)
    expect(Result.isSuccess(swordStart) && swordStart.success.charge).toBeCloseTo(0.04)
    expect(Result.isSuccess(axeStart) && axeStart.success.charge).toBeCloseTo(0.02)
    expect(Result.isSuccess(emptyHandStart) && emptyHandStart.success.charge).toBe(0.1)
    expect(Result.isSuccess(rangedItemStart) && rangedItemStart.success.charge).toBe(0.1)
    expect(Result.isSuccess(atStart) && atStart.success.charge).toBe(0.1)
    expect(Result.isSuccess(atStart) && atStart.success.damageMultiplier).toBeCloseTo(0.208)
    expect(Result.isSuccess(oneTickShort) && oneTickShort.success.charge).toBe(0.9)
    expect(Result.isSuccess(ready) && ready.success).toStrictEqual({ charge: 1, damageMultiplier: 1 })
    expect(Result.isSuccess(slowStart) && slowStart.success.charge).toBe(0.025)
    expect(Result.isSuccess(swordReady) && swordReady.success.charge).toBe(1)
  })

  it('returns typed failures outside the attack speed and tick schema', () => {
    expect(meleeAttackCooldown({ attackSpeed: 0, ticksSinceLastAttack: 0 })).toStrictEqual(
      Result.fail('invalid-input'),
    )
    expect(meleeAttackCooldown({ attackSpeed: 1, ticksSinceLastAttack: -1 })).toStrictEqual(
      Result.fail('invalid-input'),
    )
    expect(meleeAttackCooldownForItem('not-an-item' as never, 0)).toStrictEqual(
      Result.fail('invalid-input'),
    )
    expect(meleeAttackCooldown({ attackSpeed: Number.NaN, ticksSinceLastAttack: 1 })).toStrictEqual(
      Result.fail('invalid-input'),
    )
  })
})

describe('C2 melee preparation', () => {
  const actor = EntityId('melee-owner')
  const intent = { _tag: 'MeleeAttack', actor } as const
  const input = {
    tick: Schema.decodeUnknownSync(SimulationTickSchema)(12),
    dimension: 'overworld' as const,
    pose: { feetPosition: atPosition(0, 64, 0), yawRadians: 0, pitchRadians: 0 },
    entities: [zombie],
    heldItem: 'iron_sword' as const,
    critical: false,
    ticksSinceLastAttack: meleeCooldownTicks(12),
    targetDamageState: null,
  }

  it('uses the authoritative pose, reach, held item, and world candidates', () => {
    const result = prepareMeleeAttack(intent, input)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) return
    const decoded = Schema.decodeUnknownResult(MeleeAttackPreparationSchema, {
      onExcessProperty: 'error',
    })(result.success)
    expect(Result.isSuccess(decoded)).toBe(true)
    expect(result.success.event).toMatchObject({
      _tag: 'EntityDamaged',
      entity: zombie.id,
      amount: 6,
      cause: 'mob',
    })
  })

  it('gates critical damage at the charge threshold and returns knockback away from the attacker', () => {
    const belowThreshold = prepareMeleeAttack(intent, {
      ...input,
      critical: true,
      ticksSinceLastAttack: meleeCooldownTicks(10),
    })
    const aboveThreshold = prepareMeleeAttack(intent, {
      ...input,
      critical: true,
      ticksSinceLastAttack: meleeCooldownTicks(11),
    })

    expect(MIN_ATTACK_COOLDOWN_FOR_CRITICAL).toBe(0.848)
    expect(Result.isSuccess(belowThreshold)).toBe(true)
    expect(Result.isSuccess(aboveThreshold)).toBe(true)
    if (Result.isFailure(belowThreshold) || Result.isFailure(aboveThreshold)) return

    const belowEvent = belowThreshold.success.event
    const aboveEvent = aboveThreshold.success.event
    expect(belowEvent._tag).toBe('EntityDamaged')
    expect(aboveEvent._tag).toBe('EntityDamaged')
    if (belowEvent._tag !== 'EntityDamaged' || aboveEvent._tag !== 'EntityDamaged') return
    expect(belowEvent.amount).toBeCloseTo(4.58688)
    expect(aboveEvent.amount).toBeCloseTo(7.89408)
    expect(aboveThreshold.success.knockback).toMatchObject({ _tag: 'Away', x: 0, z: 1 })
  })

  it('applies mob hurt resistance to melee hits and records stronger-hit state', () => {
    const ignored = prepareMeleeAttack(intent, {
      ...input,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(20),
      targetDamageState: damageImmunityState(11, 6),
    })
    const stronger = prepareMeleeAttack(intent, {
      ...input,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(20),
      heldItem: 'netherite_axe',
      ticksSinceLastAttack: meleeCooldownTicks(20),
      targetDamageState: damageImmunityState(11, 8),
    })

    expect(Result.isFailure(ignored) && ignored.failure).toBe('target-invulnerable')
    expect(Result.isSuccess(stronger) && stronger.success.event).toMatchObject({
      _tag: 'EntityDamaged',
      amount: 2,
    })
    expect(Result.isSuccess(stronger) && stronger.success.targetDamageState).toStrictEqual({
      lastDamageTick: Schema.decodeUnknownSync(SimulationTickSchema)(11),
      lastDamageAmount: 10,
    })
  })

  it('rejects a damage state from a later authoritative tick', () => {
    const result = prepareMeleeAttack(intent, {
      ...input,
      targetDamageState: damageImmunityState(13, 4),
    })

    expect(result).toStrictEqual(Result.fail('invalid-authoritative-state'))
  })

  it('rejects a target behind the authoritative block ray without mutating inputs', () => {
    const snapshot = JSON.stringify({ input, zombie })
    const result = prepareMeleeAttack(intent, { ...input, blockDistance: AttackRangeDistance(1) })

    expect(Result.isFailure(result)).toBe(true)
    expect(JSON.stringify({ input, zombie })).toBe(snapshot)
  })

  it('rejects a non-melee intent', () => {
    const wrongIntent = prepareMeleeAttack({ _tag: 'BowAction', actor, action: 'draw' } as never, input)

    expect(Result.isFailure(wrongIntent) && wrongIntent.failure).toBe('invalid-intent')
  })

  it('rejects malformed authoritative state before selecting a target', () => {
    const missingEntities = { ...input }
    Reflect.set(missingEntities, 'entities', undefined)
    const invalidTick = { ...input }
    Reflect.set(invalidTick, 'tick', -1)
    const invalidPose = { ...input }
    Reflect.set(invalidPose, 'pose', null)
    const invalidEntity = { ...input }
    Reflect.set(invalidEntity, 'entities', [null])
    const invalidCritical = { ...input }
    Reflect.set(invalidCritical, 'critical', 'true')
    const invalidHeldItem = { ...input }
    Reflect.set(invalidHeldItem, 'heldItem', 'not-an-item')
    const invalidAttackTime = { ...input }
    Reflect.set(invalidAttackTime, 'ticksSinceLastAttack', -1)

    expect(prepareMeleeAttack(intent, missingEntities)).toStrictEqual(
      Result.fail('invalid-authoritative-state'),
    )
    expect(prepareMeleeAttack(intent, invalidTick)).toStrictEqual(
      Result.fail('invalid-authoritative-state'),
    )
    expect(prepareMeleeAttack(intent, invalidPose)).toStrictEqual(
      Result.fail('invalid-authoritative-state'),
    )
    expect(prepareMeleeAttack(intent, invalidEntity)).toStrictEqual(
      Result.fail('invalid-authoritative-state'),
    )
    expect(prepareMeleeAttack(intent, invalidCritical)).toStrictEqual(
      Result.fail('invalid-authoritative-state'),
    )
    expect(prepareMeleeAttack(intent, invalidHeldItem)).toStrictEqual(
      Result.fail('invalid-authoritative-state'),
    )
    expect(prepareMeleeAttack(intent, invalidAttackTime)).toStrictEqual(
      Result.fail('invalid-attack-timing'),
    )
  })

  it('rejects a target id that cannot be emitted in the damage event', () => {
    const invalidIdTarget = { ...zombie, id: '' as typeof zombie.id }
    const result = prepareMeleeAttack(intent, { ...input, entities: [invalidIdTarget] })

    expect(result).toStrictEqual(Result.fail('invalid-authoritative-state'))
  })

  it('returns no-target when no hostile entities are in the authoritative roster', () => {
    const result = prepareMeleeAttack(intent, { ...input, entities: [] })

    expect(Result.isFailure(result) && result.failure).toBe('no-target')
  })

  it('returns a hostile target only when it is in reach and before the aimed block', () => {
    const request: MeleeAttackRequest = {
      origin: atPosition(0, 64 + 1.62, 0),
      direction: atPosition(0, 0, 1),
      reach: AttackRangeDistance(3),
      damage: 1,
    }
    const candidates = [zombie]
    const target = meleeTarget(candidates, request)

    expect(target).toMatchObject({ id: zombie.id })
    if (target === undefined) return

    expect(meleeTargetBeforeBlock(candidates, request, undefined)).toStrictEqual(target)
    expect(meleeTargetBeforeBlock(candidates, request, target.distance)).toBeUndefined()
    expect(meleeTargetBeforeBlock(candidates, request, target.distance + 0.01)).toStrictEqual(target)
  })

  it('rejects an invalid hit distance', () => {
    const request: MeleeAttackRequest = {
      origin: atPosition(0, 64 + 1.62, 0),
      direction: atPosition(0, 0, 1),
      reach: AttackRangeDistance(3),
      damage: 1,
    }

    expect(meleeTarget([zombie], { ...request, hitDistance: -1 })).toBeUndefined()
    expect(meleeTarget([zombie], { ...request, hitDistance: Number.NaN })).toBeUndefined()
  })

  it('keeps valid authoritative ticks in the emitted event', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 1e12 }),
        (rawTick) => {
          const tick = Schema.decodeUnknownSync(SimulationTickSchema)(rawTick)
          const result = prepareMeleeAttack(intent, { ...input, tick })
          if (Result.isFailure(result)) return false
          const decoded = Schema.decodeUnknownResult(MeleeAttackPreparationSchema, {
            onExcessProperty: 'error',
          })(result.success)
          return Result.isSuccess(decoded) &&
            Number.isFinite(decoded.success.event._tag === 'EntityDamaged' ? decoded.success.event.amount : Number.NaN) &&
            (decoded.success.event._tag !== 'EntityDamaged' || decoded.success.event.amount > 0)
        },
      ),
      { numRuns: 250 },
    )
  })
})
