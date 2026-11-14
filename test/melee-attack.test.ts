import { describe, expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  AttackRangeDistance,
  ENTITY_TYPES,
  EntityHealthPoints,
  EntityId,
  EntityKind,
  isItemType,
  SimulationTickSchema,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { EYE_LEVEL_OFFSET, type Entity } from '@nerima-games/mc-sim'
import { position as atPosition } from './support/coordinate-fixtures'
import { expectedMeleeAttack } from './support/melee-attack-oracle'
import { BOW_TARGET_CENTER_Y_OFFSET } from '../src/domain/interactions/bow-shot'
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

const MELEE_WEAPON_STATS = [
  { item: 'wooden_sword', damage: 4, attackSpeed: 1.6 },
  { item: 'gold_sword', damage: 4, attackSpeed: 1.6 },
  { item: 'stone_sword', damage: 5, attackSpeed: 1.6 },
  { item: 'iron_sword', damage: 6, attackSpeed: 1.6 },
  { item: 'diamond_sword', damage: 7, attackSpeed: 1.6 },
  { item: 'netherite_sword', damage: 8, attackSpeed: 1.6 },
  { item: 'wooden_axe', damage: 7, attackSpeed: 0.8 },
  { item: 'gold_axe', damage: 7, attackSpeed: 1 },
  { item: 'stone_axe', damage: 9, attackSpeed: 0.8 },
  { item: 'iron_axe', damage: 9, attackSpeed: 0.9 },
  { item: 'diamond_axe', damage: 9, attackSpeed: 1 },
  { item: 'netherite_axe', damage: 10, attackSpeed: 1 },
  { item: 'wooden_pickaxe', damage: 2, attackSpeed: 1.2 },
  { item: 'gold_pickaxe', damage: 2, attackSpeed: 1.2 },
  { item: 'stone_pickaxe', damage: 3, attackSpeed: 1.2 },
  { item: 'iron_pickaxe', damage: 4, attackSpeed: 1.2 },
  { item: 'diamond_pickaxe', damage: 5, attackSpeed: 1.2 },
  { item: 'netherite_pickaxe', damage: 6, attackSpeed: 1.2 },
  { item: 'wooden_shovel', damage: 2.5, attackSpeed: 1 },
  { item: 'gold_shovel', damage: 2.5, attackSpeed: 1 },
  { item: 'stone_shovel', damage: 3.5, attackSpeed: 1 },
  { item: 'iron_shovel', damage: 4.5, attackSpeed: 1 },
  { item: 'diamond_shovel', damage: 5.5, attackSpeed: 1 },
  { item: 'netherite_shovel', damage: 6.5, attackSpeed: 1 },
  { item: 'wooden_hoe', damage: 1, attackSpeed: 1 },
  { item: 'gold_hoe', damage: 1, attackSpeed: 1 },
  { item: 'stone_hoe', damage: 1, attackSpeed: 2 },
  { item: 'iron_hoe', damage: 1, attackSpeed: 3 },
  { item: 'diamond_hoe', damage: 1, attackSpeed: 4 },
  { item: 'netherite_hoe', damage: 1, attackSpeed: 4 },
] as const

const zombie: Entity<MobBehaviour> = {
  id: EntityId('zombie:melee-target'),
  kind: ZOMBIE_KIND,
  feetPosition: atPosition(0, 64, -2.5),
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
    expect(meleeDamageForItem(undefined)).toStrictEqual(Result.succeed(1))
    expect(meleeDamageForItem(null)).toStrictEqual(Result.succeed(1))
    expect(meleeDamageForItem('bow')).toStrictEqual(Result.succeed(1))
  })

  it(`maps all 30 swords and tools to vanilla damage and attack speed (${MELEE_PARITY_FIXTURE.source}, ${MELEE_PARITY_FIXTURE.edition})`, () => {
    expect(MELEE_WEAPON_STATS).toHaveLength(30)
    for (const { item, damage, attackSpeed } of MELEE_WEAPON_STATS) {
      expect(meleeDamageForItem(item)).toStrictEqual(Result.succeed(damage))

      const cooldownAtStart = meleeAttackCooldownForItem(item, 0)
      expect(Result.isSuccess(cooldownAtStart)).toBe(true)
      if (Result.isFailure(cooldownAtStart)) continue
      expect(cooldownAtStart.success.charge).toBeCloseTo(attackSpeed / 40, 10)
    }
  })

  it('rejects unknown item identifiers instead of assigning unarmed damage', () => {
    expect(meleeDamageForItem('not-an-item' as never)).toStrictEqual(Result.fail('invalid-input'))
  })

  it('returns typed finite damage for arbitrary runtime item identifiers without throwing', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.string(), FastCheck.boolean(), (item, critical) => {
        const result = meleeDamageForItem(item as never, critical)
        if (!isItemType(item)) return Result.isFailure(result) && result.failure === 'invalid-input'
        return Result.isSuccess(result) && Number.isFinite(result.success) && result.success >= 0
      }),
      { numRuns: 500 },
    )
  })

  it(`applies the parity critical multiplier (${MELEE_PARITY_FIXTURE.parity}, ${MELEE_PARITY_FIXTURE.edition})`, () => {
    expect(meleeDamageForItem('iron_sword', true)).toStrictEqual(Result.succeed(9))
    expect(meleeDamageForItem(undefined, true)).toStrictEqual(Result.succeed(1.5))
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
    for (const ticksSinceLastAttack of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(meleeAttackCooldown({ attackSpeed: 1, ticksSinceLastAttack })).toStrictEqual(
        Result.fail('invalid-input'),
      )
    }
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

  it('targets all 81 kernel mob IDs and excludes every non-mob entity kind', () => {
    const firstMobIndex = ENTITY_TYPES.indexOf('allay')
    const firstProjectileIndex = ENTITY_TYPES.indexOf('arrow')
    const mobKinds = ENTITY_TYPES.slice(firstMobIndex, firstProjectileIndex)
    const nonMobKinds = ENTITY_TYPES.filter((_, index) =>
      index < firstMobIndex || index >= firstProjectileIndex,
    )
    const request: MeleeAttackRequest = {
      origin: atPosition(0, 64 + EYE_LEVEL_OFFSET, 0),
      direction: atPosition(0, 0, -1),
      reach: AttackRangeDistance(3),
      damage: 1,
    }

    expect(mobKinds).toHaveLength(81)
    expect(nonMobKinds).toEqual(expect.arrayContaining([
      'player',
      'arrow',
      'boat',
      'block_display',
      'interaction',
      'marker',
      'armor_stand',
    ]))
    for (const kind of mobKinds) {
      const candidate = { ...zombie, id: EntityId(`melee-target-${kind}`), kind: EntityKind(kind) }
      const target = meleeTarget([candidate], request)
      expect(Result.isSuccess(target) && target.success?.id).toBe(candidate.id)
    }
    for (const kind of nonMobKinds) {
      const candidate = { ...zombie, id: EntityId(`melee-target-${kind}`), kind: EntityKind(kind) }
      expect(meleeTarget([candidate], request)).toStrictEqual(Result.succeed(undefined))
    }
  })

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
    expect(aboveThreshold.success.knockback).toMatchObject({ _tag: 'Away', x: 0, z: -1 })
  })

  it('uses mc-sim yaw and pitch directions at cardinal aim boundaries', () => {
    const westTarget: Entity<MobBehaviour> = {
      ...zombie,
      id: EntityId('melee-west-target'),
      feetPosition: atPosition(-2.5, 64, 0),
    }
    const verticalOffset = 2
    const eyeY = 64 + EYE_LEVEL_OFFSET
    const upwardTarget: Entity<MobBehaviour> = {
      ...zombie,
      id: EntityId('melee-upward-target'),
      feetPosition: atPosition(0, eyeY + verticalOffset - BOW_TARGET_CENTER_Y_OFFSET, 0),
    }
    const downwardTarget: Entity<MobBehaviour> = {
      ...zombie,
      id: EntityId('melee-downward-target'),
      feetPosition: atPosition(0, eyeY - verticalOffset - BOW_TARGET_CENTER_Y_OFFSET, 0),
    }

    const west = prepareMeleeAttack(intent, {
      ...input,
      pose: { ...input.pose, yawRadians: Math.PI / 2 },
      entities: [westTarget],
    })
    const upward = prepareMeleeAttack(intent, {
      ...input,
      pose: { ...input.pose, pitchRadians: Math.PI / 2 },
      entities: [upwardTarget],
    })
    const downward = prepareMeleeAttack(intent, {
      ...input,
      pose: { ...input.pose, pitchRadians: -Math.PI / 2 },
      entities: [downwardTarget],
    })

    expect(Result.isSuccess(west) && west.success.target.id).toBe(westTarget.id)
    expect(Result.isSuccess(upward) && upward.success.target.id).toBe(upwardTarget.id)
    expect(Result.isSuccess(downward) && downward.success.target.id).toBe(downwardTarget.id)
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

  it('applies full damage and records the current tick after the 10-tick immunity window', () => {
    const result = prepareMeleeAttack(intent, {
      ...input,
      tick: Schema.decodeUnknownSync(SimulationTickSchema)(21),
      targetDamageState: damageImmunityState(11, 20),
    })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) return
    expect(result.success.event).toMatchObject({ _tag: 'EntityDamaged', amount: 6 })
    expect(result.success.targetDamageState).toStrictEqual({
      lastDamageTick: Schema.decodeUnknownSync(SimulationTickSchema)(21),
      lastDamageAmount: 6,
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
      direction: atPosition(0, 0, -1),
      reach: AttackRangeDistance(3),
      damage: 1,
    }
    const candidates = [zombie]
    const targetResult = meleeTarget(candidates, request)

    expect(Result.isSuccess(targetResult) && targetResult.success).toMatchObject({ id: zombie.id })
    if (Result.isFailure(targetResult) || targetResult.success === undefined) return
    const target = targetResult.success

    expect(meleeTargetBeforeBlock(candidates, request, undefined)).toStrictEqual(Result.succeed(target))
    expect(meleeTargetBeforeBlock(candidates, request, target.distance)).toStrictEqual(Result.succeed(undefined))
    expect(meleeTargetBeforeBlock(candidates, request, target.distance + 0.01)).toStrictEqual(Result.succeed(target))
  })

  it('distinguishes invalid hit distances from an absent target', () => {
    const request: MeleeAttackRequest = {
      origin: atPosition(0, 64 + 1.62, 0),
      direction: atPosition(0, 0, -1),
      reach: AttackRangeDistance(3),
      damage: 1,
    }

    const invalid = Result.fail({ _tag: 'InvalidMeleeTargetInput', field: 'hitDistance' })
    expect(meleeTarget([zombie], { ...request, hitDistance: -1 })).toStrictEqual(invalid)
    expect(meleeTarget([zombie], { ...request, hitDistance: Number.NaN })).toStrictEqual(invalid)
    expect(meleeTarget([zombie], { ...request, hitDistance: Number.POSITIVE_INFINITY })).toStrictEqual(invalid)
    expect(meleeTarget([zombie], { ...request, hitDistance: undefined } as unknown as MeleeAttackRequest)).toStrictEqual(invalid)
    expect(meleeTarget([], request)).toStrictEqual(Result.succeed(undefined))
    expect(prepareMeleeAttack(intent, { ...input, blockDistance: undefined } as never)).toStrictEqual(invalid)
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

  it('matches independent damage and hurt-resistance expectations for every weapon', () => {
    const weaponItem = FastCheck.constantFrom(
      ...MELEE_WEAPON_STATS.map(({ item }) => item as ItemType),
    )
    const previousDamage = FastCheck.oneof(
      FastCheck.constant(null),
      FastCheck.record({
        ageTicks: FastCheck.integer({ min: 0, max: 15 }),
        lastDamageAmount: FastCheck.double({ min: 0.1, max: 20, noNaN: true, noDefaultInfinity: true }),
      }),
    )

    FastCheck.assert(
      FastCheck.property(
        weaponItem,
        FastCheck.integer({ min: 0, max: 60 }),
        FastCheck.boolean(),
        FastCheck.integer({ min: 20, max: 1000 }),
        previousDamage,
        (heldItem, ticksSinceLastAttack, critical, rawTick, previous) => {
          const tick = Schema.decodeUnknownSync(SimulationTickSchema)(rawTick)
          const targetDamageState = previous === null
            ? null
            : damageImmunityState(rawTick - previous.ageTicks, previous.lastDamageAmount)
          const expected = expectedMeleeAttack({
            heldItem,
            ticksSinceLastAttack,
            critical,
            tick: rawTick,
            targetDamageState: targetDamageState === null
              ? null
              : {
                  lastDamageTick: targetDamageState.lastDamageTick,
                  lastDamageAmount: targetDamageState.lastDamageAmount,
                },
          })
          const result = prepareMeleeAttack(intent, {
            ...input,
            tick,
            heldItem,
            critical,
            ticksSinceLastAttack: meleeCooldownTicks(ticksSinceLastAttack),
            targetDamageState,
          })

          if (expected === null) {
            return Result.isFailure(result) && result.failure === 'target-invulnerable'
          }
          if (Result.isFailure(result) || result.success.event._tag !== 'EntityDamaged') return false
          return Math.abs(result.success.event.amount - expected.appliedAmount) < 1e-9 &&
            result.success.targetDamageState.lastDamageTick === expected.targetDamageState.lastDamageTick &&
            Math.abs(
              result.success.targetDamageState.lastDamageAmount - expected.targetDamageState.lastDamageAmount,
            ) < 1e-9
        },
      ),
      { numRuns: 500 },
    )
  })
})
