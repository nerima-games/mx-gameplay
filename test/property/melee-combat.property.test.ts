import { describe, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  DimensionIdSchema,
  SimulationTickSchema,
  WorldPositionSchema,
} from '@nerima-games/mc-kernel'
import { EntityId } from '@nerima-games/mc-sim'
import { position as atPosition } from '../support/coordinate-fixtures'
import {
  DAMAGE_IMMUNITY_TICKS,
  DamageImmunityResolutionSchema,
  HostileAttackPreparationSchema,
  prepareHostileAttack,
  resolveDamageWithInvulnerability,
  scaleHostileDamageForDifficulty,
} from '../../src/domain/mob/hostile-combat'
import { DifficultyDamageResultSchema } from '../../src/domain/combat/difficulty-damage'
import { meleeAttackCooldown, MeleeAttackCooldownSchema } from '../../src/domain/interactions/melee-attack'

const actor = EntityId('property:shield-owner')
const attacker = EntityId('property:mob-attacker')
const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const simulationTick = (value: number) => Schema.decodeUnknownSync(SimulationTickSchema)(value)
const pose = { feetPosition: atPosition(0, 64, 0), yawRadians: 0, pitchRadians: 0 }
const incoming = {
  attacker,
  attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({
    dimension,
    x: 0,
    y: 64,
    z: 2,
  }),
  kind: 'melee' as const,
  amount: 4,
}

describe('melee combat properties', () => {
  it('returns a typed failure or schema-valid cooldown for arbitrary input', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input: unknown) => {
        const result = meleeAttackCooldown(input)
        if (Result.isFailure(result)) {
          return result.failure === 'invalid-input'
        }
        const decoded = Schema.decodeUnknownResult(MeleeAttackCooldownSchema, {
          onExcessProperty: 'error',
        })(result.success)
        return Result.isSuccess(decoded) &&
          Number.isFinite(decoded.success.charge) &&
          Number.isFinite(decoded.success.damageMultiplier)
      }),
    )
  })

  it('returns a typed failure or schema-valid hurt-resistance result for arbitrary input', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input: unknown) => {
        const result = resolveDamageWithInvulnerability(input)
        if (Result.isFailure(result)) {
          return result.failure === 'invalid-input' || result.failure === 'invalid-tick-order'
        }
        const decoded = Schema.decodeUnknownResult(DamageImmunityResolutionSchema, {
          onExcessProperty: 'error',
        })(result.success)
        return Result.isSuccess(decoded) && Number.isFinite(decoded.success.appliedAmount)
      }),
    )
  })

  it('matches cooldown charge and damage to generated valid tick and attack-speed inputs', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.record({
          attackSpeed: FastCheck.double({ min: 0.01, max: 20, noNaN: true, noDefaultInfinity: true }),
          ticksSinceLastAttack: FastCheck.integer({ min: 0, max: 1000 }),
        }),
        ({ attackSpeed, ticksSinceLastAttack }) => {
          const result = meleeAttackCooldown({ attackSpeed, ticksSinceLastAttack })
          if (Result.isFailure(result)) return false
          const decoded = Schema.decodeUnknownResult(MeleeAttackCooldownSchema)(result.success)
          if (Result.isFailure(decoded)) return false
          const expectedCharge = Math.min(
            1,
            (ticksSinceLastAttack + 0.5) /
              (20 / attackSpeed),
          )
          const expectedDamageMultiplier = 0.2 + 0.8 * expectedCharge ** 2
          return Number.isFinite(decoded.success.charge) &&
            Number.isFinite(decoded.success.damageMultiplier) &&
            Math.abs(decoded.success.charge - expectedCharge) < 1e-12 &&
            Math.abs(decoded.success.damageMultiplier - expectedDamageMultiplier) < 1e-12
        },
      ),
    )
  })

  it('returns a typed failure or schema-valid difficulty damage for arbitrary input', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input: unknown) => {
        const result = scaleHostileDamageForDifficulty(input)
        if (Result.isFailure(result)) {
          return result.failure === 'invalid-input' || result.failure === 'invalid-result'
        }
        const decoded = Schema.decodeUnknownResult(DifficultyDamageResultSchema, {
          onExcessProperty: 'error',
        })(result.success)
        return Result.isSuccess(decoded) && Number.isFinite(decoded.success) && decoded.success >= 0
      }),
    )
  })

  it('matches the hurt-resistance window and stronger-hit delta for generated valid inputs', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.record({
          lastDamageTick: FastCheck.integer({ min: 0, max: 1000 }),
          elapsedTicks: FastCheck.integer({ min: 0, max: 20 }),
          lastDamageAmount: FastCheck.integer({ min: 1, max: 20 }),
          incomingAmount: FastCheck.integer({ min: 1, max: 30 }),
        }),
        ({ lastDamageTick, elapsedTicks, lastDamageAmount, incomingAmount }) => {
          const previousState = {
            lastDamageTick: simulationTick(lastDamageTick),
            lastDamageAmount,
          }
          const result = resolveDamageWithInvulnerability({
            tick: simulationTick(lastDamageTick + elapsedTicks),
            amount: incomingAmount,
            previousState,
          })
          if (Result.isFailure(result)) return false
          const decoded = Schema.decodeUnknownResult(DamageImmunityResolutionSchema)(result.success)
          if (Result.isFailure(decoded)) return false
          const expectedApplied = elapsedTicks < DAMAGE_IMMUNITY_TICKS
            ? Math.max(0, incomingAmount - lastDamageAmount)
            : incomingAmount
          const expectedState = elapsedTicks < DAMAGE_IMMUNITY_TICKS
            ? incomingAmount > lastDamageAmount
              ? { lastDamageTick: simulationTick(lastDamageTick), lastDamageAmount: incomingAmount }
              : previousState
            : { lastDamageTick: simulationTick(lastDamageTick + elapsedTicks), lastDamageAmount: incomingAmount }
          return Number.isFinite(decoded.success.appliedAmount) &&
            decoded.success.appliedAmount === expectedApplied &&
            JSON.stringify(decoded.success.state) === JSON.stringify(expectedState)
        },
      ),
    )
  })

  it('matches generated difficulty, shield, and hurt-resistance damage calculations', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.record({
          tick: FastCheck.integer({ min: 0, max: 100 }),
          amount: FastCheck.integer({ min: 1, max: 20 }),
          blocking: FastCheck.boolean(),
          shieldAge: FastCheck.integer({ min: 0, max: 10 }),
          attackKind: FastCheck.constantFrom('melee', 'projectile', 'explosion'),
          piercing: FastCheck.boolean(),
          difficulty: FastCheck.constantFrom('peaceful', 'easy', 'normal', 'hard'),
          hasDamageState: FastCheck.boolean(),
          previousDamageAge: FastCheck.integer({ min: 0, max: 20 }),
          previousDamageAmount: FastCheck.integer({ min: 1, max: 30 }),
        }),
        ({
          tick,
          amount,
          blocking,
          shieldAge,
          attackKind,
          piercing,
          difficulty,
          hasDamageState,
          previousDamageAge,
          previousDamageAmount,
        }) => {
          const raisedAt = Math.max(0, tick - shieldAge)
          const damageTick = Math.max(0, tick - previousDamageAge)
          const previousState = hasDamageState
            ? { lastDamageTick: simulationTick(damageTick), lastDamageAmount: previousDamageAmount }
            : null
          const previousDamageElapsed = tick - damageTick
          const scaledAmount = difficulty === 'peaceful'
            ? 0
            : difficulty === 'easy'
              ? Math.min(amount, amount / 2 + 1)
              : difficulty === 'hard'
                ? amount * 1.5
                : amount
          const ticksRaised = tick - raisedAt
          const expectedBlocked = blocking &&
            scaledAmount > 0 &&
            ticksRaised >= 5 &&
            (attackKind !== 'projectile' || !piercing)
          const expectedApplied = scaledAmount === 0 || expectedBlocked
            ? 0
            : previousState === null || previousDamageElapsed >= DAMAGE_IMMUNITY_TICKS
              ? scaledAmount
              : Math.max(0, scaledAmount - previousDamageAmount)
          const expectedDamageState = scaledAmount === 0 || expectedBlocked
            ? previousState
            : previousState === null || previousDamageElapsed >= DAMAGE_IMMUNITY_TICKS
              ? { lastDamageTick: simulationTick(tick), lastDamageAmount: scaledAmount }
              : scaledAmount > previousDamageAmount
                ? { lastDamageTick: simulationTick(damageTick), lastDamageAmount: scaledAmount }
                : previousState
          const result = prepareHostileAttack(
            { _tag: 'SetShieldBlocking', actor, blocking },
            {
              tick: simulationTick(tick),
              dimension,
              pose,
              hasShield: blocking,
              currentShield: blocking ? { actor, raisedAt: simulationTick(raisedAt) } : null,
              incoming: { ...incoming, kind: attackKind, piercing, amount },
              difficulty,
              damageState: previousState,
            },
          )
          if (Result.isFailure(result)) return false
          const decoded = Schema.decodeUnknownResult(HostileAttackPreparationSchema, {
            onExcessProperty: 'error',
          })(result.success)
          if (Result.isFailure(decoded)) return false
          return decoded.success.appliedAmount === expectedApplied &&
            JSON.stringify(decoded.success.damageState) === JSON.stringify(expectedDamageState) &&
            decoded.success.shield.blocked === expectedBlocked &&
            decoded.success.shield.blockedAmount === (expectedBlocked ? scaledAmount : 0) &&
            decoded.success.shield.durabilityDamage === (expectedBlocked && scaledAmount >= 3 ? Math.ceil(scaledAmount) : 0) &&
            decoded.success.shield.raisedAt === (blocking ? simulationTick(raisedAt) : null) &&
            (decoded.success.shield.event !== null) === expectedBlocked
        },
      ),
    )
  })

  it('returns a typed failure or schema-valid result for arbitrary hostile wrapper arguments', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.anything(),
        FastCheck.anything(),
        (intent: unknown, input: unknown) => {
          try {
            const result = prepareHostileAttack(intent, input)
            if (Result.isFailure(result)) {
              return result.failure === 'invalid-intent' ||
                result.failure === 'invalid-input' ||
                result.failure === 'invalid-attack' ||
                result.failure === 'invalid-shield-state' ||
                result.failure === 'invalid-damage-state'
            }
            const decoded = Schema.decodeUnknownResult(HostileAttackPreparationSchema, {
              onExcessProperty: 'error',
            })(result.success)
            return Result.isSuccess(decoded)
          } catch {
            return false
          }
        },
      ),
    )
  })
})
