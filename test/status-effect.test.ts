import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { Result, Schema } from 'effect'
import { DeltaTimeSecs, EffectAmplifier } from '@nerima-games/mc-kernel'
import {
  STATUS_EFFECT_AMPLIFIER_MAX,
  STATUS_EFFECT_NAMES,
  type StatusEffectName,
} from '@nerima-games/mc-kernel/domain/status-effect'
import {
  StatusEffectApplicationErrorSchema,
  ValidatedStatusEffectApplicationSchema,
  ValidatedStatusEffectStateSchema,
  StatusEffectApplicationOutcomeSchema,
  AttackDamageBonusSchema,
  MiningSpeedMultiplierSchema,
  StatusEffectLevelSchema,
  StatusEffectModifiersSchema,
  StatusEffectPulseCountSchema,
  StatusEffectStateSchema,
  applyStatusEffect,
  applyStatusEffectToValidatedState,
  copyStatusEffectState,
  emptyStatusEffectState,
  isValidStatusEffectState,
  statusEffectLevel,
  statusEffectModifiers,
  tickStatusEffects,
  validatePersistentStatusEffectApplication,
  validateStatusEffectApplication,
  type StatusEffectApplication,
  type StatusEffectApplicationOutcome,
  type PersistentStatusEffectApplication,
  type StatusEffectState,
} from '../src/domain/status-effect'

const apply = (
  state: StatusEffectState,
  application: StatusEffectApplication,
): StatusEffectApplicationOutcome => {
  const result = applyStatusEffect(state, application)
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const statusNames: ReadonlyArray<StatusEffectName> = STATUS_EFFECT_NAMES

describe('status effects', () => {
  it('accepts and expires the complete Java Edition 26.3 kernel status-effect table', () => {
    expect(STATUS_EFFECT_NAMES).toHaveLength(40)

    for (const type of statusNames) {
      const outcome = applyStatusEffect(emptyStatusEffectState(), {
        type,
        durationSecs: 0.2,
        amplifier: 0,
      })

      expect(Result.isSuccess(outcome), `${type} should be accepted`).toBe(true)
      if (Result.isFailure(outcome)) continue
      expect(Result.isSuccess(
        Schema.decodeUnknownResult(StatusEffectApplicationOutcomeSchema)(outcome.success),
      )).toBe(true)

      if (type === 'instant_health' || type === 'instant_damage' || type === 'saturation') {
        expect(outcome.success.instantEffects).toStrictEqual([{ type, amplifier: 0 }])
        expect(outcome.success.state.effects).toStrictEqual([])
      } else {
        expect(outcome.success.instantEffects).toStrictEqual([])
        expect(outcome.success.state.effects.map((effect) => effect.type)).toContain(type)
      }

      const expired = tickStatusEffects(outcome.success.state, DeltaTimeSecs(0.2))
      expect(expired.state.effects.map((effect) => effect.type)).not.toContain(type)
    }
  })

  it('applies branded inputs through the total helper, preserving instant and hidden effects', () => {
    const initialState = Schema.decodeUnknownSync(ValidatedStatusEffectStateSchema)(emptyStatusEffectState())
    const speedZero = Schema.decodeUnknownSync(ValidatedStatusEffectApplicationSchema)({
      type: 'speed', durationSecs: 5, amplifier: 0,
    })
    const speedOne = Schema.decodeUnknownSync(ValidatedStatusEffectApplicationSchema)({
      type: 'speed', durationSecs: 2, amplifier: 1,
    })
    const speedZeroAgain = Schema.decodeUnknownSync(ValidatedStatusEffectApplicationSchema)({
      type: 'speed', durationSecs: 4, amplifier: 0,
    })

    const initialSpeed = applyStatusEffectToValidatedState(initialState, speedZero)
    const equalAmplifier = applyStatusEffectToValidatedState(
      initialSpeed.state,
      Schema.decodeUnknownSync(ValidatedStatusEffectApplicationSchema)({
        type: 'speed', durationSecs: 3, amplifier: 0,
      }),
    )
    expect(equalAmplifier.state.effects[0]).toMatchObject({ remainingSecs: 5, amplifier: 0 })

    const stronger = applyStatusEffectToValidatedState(equalAmplifier.state, speedOne)
    expect(stronger.state.effects[0]).toMatchObject({
      remainingSecs: 2,
      amplifier: 1,
      hiddenEffects: [{ remainingSecs: 5, amplifier: 0 }],
    })
    expect(stronger.instantEffects).toStrictEqual([])

    const weaker = applyStatusEffectToValidatedState(stronger.state, speedZeroAgain)
    expect(weaker.state.effects[0]).toMatchObject({
      remainingSecs: 2,
      amplifier: 1,
      hiddenEffects: [{ remainingSecs: 5, amplifier: 0 }],
    })

    const instant = applyStatusEffectToValidatedState(
      weaker.state,
      Schema.decodeUnknownSync(ValidatedStatusEffectApplicationSchema)({
        type: 'instant_health', durationSecs: 1, amplifier: 2,
      }),
    )
    expect(instant.state).toBe(weaker.state)
    expect(instant.instantEffects).toStrictEqual([{ type: 'instant_health', amplifier: 2 }])

    const removed = applyStatusEffectToValidatedState(
      weaker.state,
      Schema.decodeUnknownSync(ValidatedStatusEffectApplicationSchema)({
        type: 'speed', durationSecs: 0, amplifier: 1,
      }),
    )
    expect(removed.state.effects).toStrictEqual([])
    expect(removed.instantEffects).toStrictEqual([])
  })

  it('keeps schema and typed errors on the public API boundary', () => {
    const validState = emptyStatusEffectState()
    expect(applyStatusEffect(validState, {
      type: 'speed', durationSecs: Number.NaN,
    })).toEqual(Result.fail({ _tag: 'InvalidStatusEffectApplication', reason: 'invalid-duration' }))

    expect(applyStatusEffect(validState, {
      type: 'unknown_effect' as StatusEffectName,
      durationSecs: 1,
    })).toEqual(Result.fail({ _tag: 'UnknownStatusEffect', value: 'unknown_effect' }))

    const invalidState = {
      effects: [
        { type: 'speed', remainingSecs: 2, pulseClockSecs: 0, amplifier: 0 },
        { type: 'speed', remainingSecs: 1, pulseClockSecs: 0, amplifier: 1 },
      ],
    } as unknown as StatusEffectState
    expect(applyStatusEffect(invalidState, {
      type: 'poison', durationSecs: 1,
    })).toEqual(Result.fail({ _tag: 'InvalidStatusEffectApplication', reason: 'invalid-state' }))
  })

  it('validates arbitrary JSON applications as typed failures or schema-valid values', () => {
    fc.assert(fc.property(fc.jsonValue(), (input) => {
      const result = validateStatusEffectApplication(input as StatusEffectApplication)
      if (Result.isFailure(result)) {
        expect(Result.isSuccess(Schema.decodeUnknownResult(StatusEffectApplicationErrorSchema)(result.failure))).toBe(true)
      } else {
        expect(Result.isSuccess(Schema.decodeUnknownResult(ValidatedStatusEffectApplicationSchema)(result.success))).toBe(true)
      }
    }))

    fc.assert(fc.property(fc.jsonValue(), (input) => {
      const result = validatePersistentStatusEffectApplication(
        input as PersistentStatusEffectApplication,
      )
      if (Result.isFailure(result)) {
        expect(Result.isSuccess(Schema.decodeUnknownResult(StatusEffectApplicationErrorSchema)(result.failure))).toBe(true)
      } else {
        expect(Result.isSuccess(Schema.decodeUnknownResult(ValidatedStatusEffectApplicationSchema)(result.success))).toBe(true)
        expect(['instant_health', 'instant_damage', 'saturation']).not.toContain(result.success.type)
      }
    }))
  })

  it('accepts zero duration and omitted amplifier, and rejects adjacent invalid boundaries', () => {
    expect(validateStatusEffectApplication({
      type: 'speed', durationSecs: 0, amplifier: 0,
    })._tag).toBe('Success')
    expect(validatePersistentStatusEffectApplication({
      type: 'speed', durationSecs: 5,
    })).toMatchObject({ _tag: 'Success', success: { type: 'speed', durationSecs: 5 } })
    expect(validatePersistentStatusEffectApplication({
      type: 'speed', durationSecs: 5, amplifier: 0,
    })).toMatchObject({ _tag: 'Success', success: { type: 'speed', durationSecs: 5, amplifier: 0 } })
    expect(validatePersistentStatusEffectApplication({
      type: 'speed', durationSecs: -Number.MIN_VALUE,
    })).toEqual(Result.fail({ _tag: 'InvalidStatusEffectApplication', reason: 'invalid-duration' }))
    expect(validateStatusEffectApplication({
      type: 'speed', durationSecs: 5, amplifier: STATUS_EFFECT_AMPLIFIER_MAX + 1,
    })).toEqual(Result.fail({ _tag: 'InvalidStatusEffectApplication', reason: 'invalid-amplifier' }))
    expect(validateStatusEffectApplication({
      type: 'speed', durationSecs: 5, unexpected: true,
    } as unknown as StatusEffectApplication)).toEqual(Result.fail({
      _tag: 'InvalidStatusEffectApplication', reason: 'invalid-shape',
    }))
  })

  it('derives poison, regeneration, and wither pulses from Java Edition tick intervals', () => {
    // Java Edition 26.3 fixtures: 20 ticks/second and the effect intervals in
    // the independent wiki tables. Formulas are kept here, not imported from gameplay.
    // https://minecraft.wiki/w/Java_Edition_26.3
    // https://minecraft.wiki/w/Tick
    // https://minecraft.wiki/w/Poison
    // https://minecraft.wiki/w/Regeneration
    // https://minecraft.wiki/w/Damage
    let state = emptyStatusEffectState()
    state = apply(state, { type: 'poison', durationSecs: 6, amplifier: 0 }).state
    state = apply(state, { type: 'regeneration', durationSecs: 6, amplifier: 0 }).state
    state = apply(state, { type: 'wither', durationSecs: 6, amplifier: 0 }).state

    const tick = tickStatusEffects(state, DeltaTimeSecs(3))

    expect(tick.poisonPulses).toBe(Math.floor((3 * 20) / 25))
    expect(tick.regenerationPulses).toBe(Math.floor((3 * 20) / 50))
    expect(tick.witherPulses).toBe(Math.floor((3 * 20) / 40))
    expect(tick.state.effects.map(({ type }) => type)).toStrictEqual([
      'poison',
      'regeneration',
      'wither',
    ])
    expect(tick.state.effects.map(({ remainingSecs }) => remainingSecs)).toStrictEqual([3, 3, 3])
  })

  it('scales pulse intervals by amplifier and crosses a boundary on the exact tick', () => {
    // Java Edition 26.3 tables: poison 25/12/6/3/1 ticks, regeneration
    // 50/25/12/6/3/1 ticks, and wither I/II at 40/20 ticks.
    // https://minecraft.wiki/w/Poison
    // https://minecraft.wiki/w/Regeneration
    // https://minecraft.wiki/w/Damage
    const pulseCases = [
      { type: 'poison', baseTicks: 25, levels: 6 },
      { type: 'regeneration', baseTicks: 50, levels: 6 },
      { type: 'wither', baseTicks: 40, levels: 2 },
    ] as const

    for (const { type, baseTicks, levels } of pulseCases) {
      for (let level = 1; level <= levels; level += 1) {
        const intervalTicks = Math.max(1, Math.floor(baseTicks / 2 ** (level - 1)))
        const intervalSecs = intervalTicks / 20
        const state = apply(emptyStatusEffectState(), {
          type,
          durationSecs: 10,
          amplifier: level - 1,
        }).state

        const beforeBoundary = tickStatusEffects(
          state,
          DeltaTimeSecs(intervalSecs - 1 / 20),
        )
        const pulsesBefore = type === 'poison'
          ? beforeBoundary.poisonPulses
          : type === 'regeneration'
            ? beforeBoundary.regenerationPulses
            : beforeBoundary.witherPulses
        expect(pulsesBefore, `${type} level ${level} before interval`).toBe(0)

        const atBoundary = tickStatusEffects(beforeBoundary.state, DeltaTimeSecs(1 / 20))
        const pulsesAt = type === 'poison'
          ? atBoundary.poisonPulses
          : type === 'regeneration'
            ? atBoundary.regenerationPulses
            : atBoundary.witherPulses
        expect(pulsesAt, `${type} level ${level} at interval`).toBe(1)
      }
    }
  })

  it('adds hunger exhaustion at 0.005 per level per game tick while active', () => {
    // Java Edition 26.3: Hunger adds 0.005 × level exhaustion per tick;
    // 20 ticks/second × 1.5 seconds × level III = 0.45.
    // https://minecraft.wiki/w/Hunger_%28effect%29
    // https://minecraft.wiki/w/Java_Edition_26.3
    const state = apply(emptyStatusEffectState(), {
      type: 'hunger',
      durationSecs: 1.5,
      amplifier: 2,
    }).state

    const tick = tickStatusEffects(state, DeltaTimeSecs(2))

    expect(tick.hungerExhaustion).toBeCloseTo(0.005 * 3 * 20 * 1.5, 12)
    expect(tick.state.effects).toStrictEqual([])
  })

  it('keeps hunger active after a shorter frame and reports its remaining duration', () => {
    const state = apply(emptyStatusEffectState(), {
      type: 'hunger',
      durationSecs: 5,
      amplifier: 1,
    }).state

    const tick = tickStatusEffects(state, DeltaTimeSecs(2))

    expect(tick.hungerExhaustion).toBeCloseTo(2 * 0.005 * 2 * 20, 12)
    expect(tick.state.effects).toStrictEqual([{
      type: 'hunger',
      remainingSecs: 3,
      pulseClockSecs: 0,
      amplifier: 1,
    }])
  })

  it('projects active levels to vanilla combat, movement, mining, and survival modifiers', () => {
    // Java Edition 26.3 sources: movement/status effects, strength, weakness,
    // resistance, haste, and the 26.3 mining-fatigue factor.
    // https://minecraft.wiki/w/Attribute
    // https://minecraft.wiki/w/Speed
    // https://minecraft.wiki/w/Slowness
    // https://minecraft.wiki/w/Strength
    // https://minecraft.wiki/w/Weakness
    // https://minecraft.wiki/w/Resistance
    // https://minecraft.wiki/w/Haste
    // https://minecraft.wiki/w/Mining_fatigue
    // https://minecraft.wiki/w/Health_Boost
    // https://minecraft.wiki/w/Absorption
    // https://minecraft.wiki/w/Breath_of_the_Nautilus
    const applications: ReadonlyArray<StatusEffectApplication> = [
      { type: 'speed', durationSecs: 30, amplifier: 1 },
      { type: 'slowness', durationSecs: 30, amplifier: 0 },
      { type: 'haste', durationSecs: 30, amplifier: 1 },
      { type: 'conduit_power', durationSecs: 30, amplifier: 0 },
      { type: 'mining_fatigue', durationSecs: 30, amplifier: 2 },
      { type: 'strength', durationSecs: 30, amplifier: 1 },
      { type: 'weakness', durationSecs: 30, amplifier: 0 },
      { type: 'resistance', durationSecs: 30, amplifier: 1 },
      { type: 'fire_resistance', durationSecs: 30, amplifier: 0 },
      { type: 'water_breathing', durationSecs: 30, amplifier: 0 },
      { type: 'breath_of_the_nautilus', durationSecs: 30, amplifier: 0 },
      { type: 'health_boost', durationSecs: 30, amplifier: 0 },
      { type: 'absorption', durationSecs: 30, amplifier: 1 },
      { type: 'jump_boost', durationSecs: 30, amplifier: 2 },
      { type: 'slow_falling', durationSecs: 30, amplifier: 0 },
      { type: 'luck', durationSecs: 30, amplifier: 1 },
      { type: 'unluck', durationSecs: 30, amplifier: 0 },
      { type: 'nausea', durationSecs: 30, amplifier: 3 },
      { type: 'blindness', durationSecs: 30, amplifier: 0 },
      { type: 'darkness', durationSecs: 30, amplifier: 0 },
      { type: 'night_vision', durationSecs: 30, amplifier: 0 },
      { type: 'invisibility', durationSecs: 30, amplifier: 0 },
      { type: 'glowing', durationSecs: 30, amplifier: 0 },
    ]
    const state = applications.reduce(
      (current, application) => apply(current, application).state,
      emptyStatusEffectState(),
    )
    const modifiers = statusEffectModifiers(state)

    expect(statusEffectLevel(emptyStatusEffectState(), 'speed')).toBe(0)
    expect(statusEffectLevel(state, 'speed')).toBe(2)
    expect(modifiers.levels['conduit_power']).toBe(1)
    expect(modifiers.movementSpeedMultiplier).toBeCloseTo((1 + 0.2 * 2) * (1 - 0.15), 12)
    expect(modifiers.attackSpeedMultiplier).toBeCloseTo((1 + 0.1 * 2) * (1 - 0.1 * 3), 12)
    expect(modifiers.miningSpeedMultiplier).toBeCloseTo(
      (1 + 0.2 * Math.max(2, 1)) * 0.3 ** 3,
      12,
    )
    expect(modifiers.attackDamageBonus).toBe(3 * 2 - 4)
    expect(modifiers.damageTakenMultiplier).toBeCloseTo(1 - 0.2 * 2, 12)
    expect(modifiers.fireResistance).toBe(true)
    expect(modifiers.waterBreathing).toBe(true)
    expect(modifiers.breathOfTheNautilus).toBe(true)
    expect(modifiers.additionalMaximumHealthPoints).toBe(4)
    expect(modifiers.absorptionHealthPoints).toBe(8)
    expect(modifiers.jumpBoostLevel).toBe(3)
    expect(modifiers.slowFalling).toBe(true)
    expect(modifiers.luck).toBe(1)
    expect(modifiers.nauseaAmplifier).toBe(3)
    expect(modifiers.blindness).toBe(true)
    expect(modifiers.darkness).toBe(true)
    expect(modifiers.nightVision).toBe(true)
    expect(modifiers.invisibility).toBe(true)
    expect(modifiers.glowing).toBe(true)
  })

  it('validates the public modifier quantities at their boundaries', () => {
    expect(Result.isSuccess(Schema.decodeUnknownResult(StatusEffectLevelSchema)(0))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(StatusEffectLevelSchema)(256))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(StatusEffectLevelSchema)(-1))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(StatusEffectLevelSchema)(257))).toBe(true)

    expect(Result.isSuccess(Schema.decodeUnknownResult(StatusEffectPulseCountSchema)(0))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(StatusEffectPulseCountSchema)(-1))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(StatusEffectPulseCountSchema)(1.5))).toBe(true)

    expect(Result.isSuccess(Schema.decodeUnknownResult(MiningSpeedMultiplierSchema)(0))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(MiningSpeedMultiplierSchema)(-Number.MIN_VALUE))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(MiningSpeedMultiplierSchema)(Number.POSITIVE_INFINITY))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(AttackDamageBonusSchema)(-4))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(AttackDamageBonusSchema)(Number.NaN))).toBe(true)
  })

  it('rejects out-of-domain values for every public status modifier field', () => {
    const valid = statusEffectModifiers(emptyStatusEffectState())
    expect(Result.isSuccess(Schema.decodeUnknownResult(StatusEffectModifiersSchema)(valid))).toBe(true)

    const invalidValues: ReadonlyArray<readonly [string, unknown]> = [
      ['levels', { speed: -1 }],
      ['movementSpeedMultiplier', -1],
      ['attackSpeedMultiplier', Number.POSITIVE_INFINITY],
      ['miningSpeedMultiplier', -Number.MIN_VALUE],
      ['attackDamageBonus', Number.NaN],
      ['damageTakenMultiplier', 1.01],
      ['additionalMaximumHealthPoints', 0.5],
      ['absorptionHealthPoints', -1],
      ['jumpBoostLevel', -1],
      ['luck', 1.5],
      ['nauseaAmplifier', STATUS_EFFECT_AMPLIFIER_MAX + 1],
    ]

    for (const [field, value] of invalidValues) {
      expect(Result.isFailure(Schema.decodeUnknownResult(StatusEffectModifiersSchema)({
        ...valid,
        [field]: value,
      })), `${field} should be rejected`).toBe(true)
    }
  })

  it('caps resistance and mining-fatigue projections at their Java Edition limits', () => {
    // Java Edition 26.3 Resistance removes 20% per level; Mining Fatigue
    // multiplies mining speed by 0.3^min(level, 4).
    // https://minecraft.wiki/w/Resistance
    // https://minecraft.wiki/w/Mining_fatigue
    const resistant = apply(emptyStatusEffectState(), {
      type: 'resistance',
      durationSecs: 2,
      amplifier: 4,
    }).state
    const fatigued = apply(emptyStatusEffectState(), {
      type: 'mining_fatigue',
      durationSecs: 2,
      amplifier: 5,
    }).state

    expect(statusEffectModifiers(resistant).damageTakenMultiplier).toBe(0)
    expect(statusEffectModifiers(fatigued).miningSpeedMultiplier).toBeCloseTo(0.3 ** 4, 12)
  })

  it('keeps Breath of the Nautilus distinct from water breathing', () => {
    const state = apply(emptyStatusEffectState(), {
      type: 'breath_of_the_nautilus',
      durationSecs: 2,
      amplifier: 0,
    }).state
    const modifiers = statusEffectModifiers(state)

    expect(modifiers.waterBreathing).toBe(false)
    expect(modifiers.breathOfTheNautilus).toBe(true)
  })

  it('defaults an omitted amplifier to status-effect level I', () => {
    const outcome = apply(emptyStatusEffectState(), { type: 'speed', durationSecs: 1 })

    expect(outcome.state.effects[0]?.amplifier).toBe(0)
    expect(statusEffectLevel(outcome.state, 'speed')).toBe(1)
  })

  it('preserves weaker effects and restores their remaining duration after a stronger effect', () => {
    let state = apply(emptyStatusEffectState(), {
      type: 'speed',
      durationSecs: 4,
      amplifier: 0,
    }).state
    state = tickStatusEffects(state, DeltaTimeSecs(1)).state
    state = apply(state, { type: 'speed', durationSecs: 2, amplifier: 1 }).state

    expect(state.effects[0]).toStrictEqual({
      type: 'speed',
      remainingSecs: 2,
      pulseClockSecs: 0,
      amplifier: 1,
      hiddenEffects: [{ remainingSecs: 3, pulseClockSecs: 0, amplifier: 0 }],
    })

    const restored = tickStatusEffects(state, DeltaTimeSecs(2.5))

    expect(restored.state.effects).toStrictEqual([{
      type: 'speed',
      remainingSecs: 0.5,
      pulseClockSecs: 0,
      amplifier: 0,
    }])
    expect(restored.movementSpeedMultiplier).toBeCloseTo(1.2, 12)
  })

  it('drops a hidden effect that expires before the active effect and keeps the next one on promotion', () => {
    const expiringHidden = {
      effects: [{
        type: 'speed',
        remainingSecs: 3,
        pulseClockSecs: 0,
        amplifier: 2,
        hiddenEffects: [
          { remainingSecs: DeltaTimeSecs(0.5), pulseClockSecs: DeltaTimeSecs(0), amplifier: EffectAmplifier(1) },
        ],
      }],
    } as const
    const afterHiddenExpiry = tickStatusEffects(expiringHidden, DeltaTimeSecs(1))
    expect(afterHiddenExpiry.state.effects).toStrictEqual([{
      type: 'speed',
      remainingSecs: 2,
      pulseClockSecs: 0,
      amplifier: 2,
    }])

    const stackedEffects = {
      effects: [{
        type: 'speed',
        remainingSecs: 1,
        pulseClockSecs: 0,
        amplifier: 2,
        hiddenEffects: [
          { remainingSecs: DeltaTimeSecs(4), pulseClockSecs: DeltaTimeSecs(0), amplifier: EffectAmplifier(1) },
          { remainingSecs: DeltaTimeSecs(3), pulseClockSecs: DeltaTimeSecs(0), amplifier: EffectAmplifier(0) },
        ],
      }],
    } as const
    const afterPromotion = tickStatusEffects(stackedEffects, DeltaTimeSecs(1))
    expect(afterPromotion.state.effects).toStrictEqual([{
      type: 'speed',
      remainingSecs: 3,
      pulseClockSecs: 0,
      amplifier: 1,
      hiddenEffects: [{ remainingSecs: 2, pulseClockSecs: 0, amplifier: 0 }],
    }])
  })

  it('advances a hidden poison clock without applying pulses until it is restored', () => {
    let state = apply(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 3,
      amplifier: 0,
    }).state
    state = tickStatusEffects(state, DeltaTimeSecs(0.25)).state
    state = apply(state, { type: 'poison', durationSecs: 0.5, amplifier: 1 }).state

    const strongerTick = tickStatusEffects(state, DeltaTimeSecs(0.5))
    expect(strongerTick.poisonPulses).toBe(0)
    expect(strongerTick.state.effects[0]).toStrictEqual({
      type: 'poison',
      remainingSecs: 2.25,
      pulseClockSecs: 0.75,
      amplifier: 0,
    })

    const restoredTick = tickStatusEffects(strongerTick.state, DeltaTimeSecs(0.5))
    expect(restoredTick.poisonPulses).toBe(1)
  })

  it('extends equal-strength duration without resetting its poison cadence', () => {
    let state = apply(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 2,
      amplifier: 0,
    }).state
    state = tickStatusEffects(state, DeltaTimeSecs(0.75)).state
    state = apply(state, { type: 'poison', durationSecs: 2, amplifier: 0 }).state

    expect(state.effects[0]?.pulseClockSecs).toBe(0.75)
    const tick = tickStatusEffects(state, DeltaTimeSecs(0.5))
    expect(tick.poisonPulses).toBe(1)
    expect(tick.state.effects[0]?.remainingSecs).toBe(1.5)
  })

  it('keeps the longer stronger effect and the longer same-strength duration', () => {
    const stronger = apply(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 4,
      amplifier: 2,
    }).state
    const longerWeaker = apply(stronger, {
      type: 'poison',
      durationSecs: 10,
      amplifier: 1,
    }).state
    expect(isValidStatusEffectState(longerWeaker)).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(StatusEffectStateSchema)(longerWeaker))).toBe(true)

    const shorterEqual = apply(longerWeaker, {
      type: 'poison',
      durationSecs: 2,
      amplifier: 2,
    }).state

    expect(longerWeaker.effects[0]).toStrictEqual({
      type: 'poison',
      remainingSecs: 4,
      pulseClockSecs: 0,
      amplifier: 2,
      hiddenEffects: [{ remainingSecs: 10, pulseClockSecs: 0, amplifier: 1 }],
    })
    expect(shorterEqual.effects[0]).toStrictEqual(longerWeaker.effects[0])
  })

  it('returns identified instant effects with their amplifier and does not persist them', () => {
    const existing = apply(emptyStatusEffectState(), {
      type: 'speed',
      durationSecs: 8,
      amplifier: 0,
    }).state

    for (const type of ['instant_health', 'instant_damage', 'saturation'] as const) {
      const outcome = applyStatusEffect(existing, { type, durationSecs: 5, amplifier: 2 })

      expect(Result.isSuccess(outcome)).toBe(true)
      if (Result.isFailure(outcome)) continue
      expect(outcome.success.instantEffects).toStrictEqual([{ type, amplifier: 2 }])
      expect(outcome.success.state).toStrictEqual(existing)
    }

    const zeroDurationInstant = applyStatusEffect(existing, {
      type: 'instant_health',
      durationSecs: 0,
      amplifier: 1,
    })
    expect(Result.isSuccess(zeroDurationInstant)).toBe(true)
    if (Result.isSuccess(zeroDurationInstant)) {
      expect(zeroDurationInstant.success.instantEffects).toStrictEqual([
        { type: 'instant_health', amplifier: 1 },
      ])
      expect(zeroDurationInstant.success.state).toStrictEqual(existing)
    }
  })

  it('reports nausea only while its effect remains active', () => {
    const state = apply(emptyStatusEffectState(), {
      type: 'nausea',
      durationSecs: 1,
      amplifier: 3,
    }).state
    const active = tickStatusEffects(state, DeltaTimeSecs(0.5))
    const expired = tickStatusEffects(active.state, DeltaTimeSecs(0.5))

    expect(active.nauseaAmplifier).toBe(3)
    expect(expired.nauseaAmplifier).toBeNull()
    expect(active.movementSpeedMultiplier).toBe(1)
  })

  it('rejects invalid applications as Invalid and keeps unknown names as Unknown', () => {
    const original = Object.freeze({
      effects: Object.freeze([Object.freeze({
        type: 'speed' as const,
        remainingSecs: 4,
        pulseClockSecs: 0,
        amplifier: 0,
      })]),
    })
    const invalidApplications: ReadonlyArray<unknown> = [
      null,
      'poison',
      { durationSecs: 1 },
      { type: 4, durationSecs: 1 },
      { type: 'poison', durationSecs: Number.NaN },
      { type: 'poison', durationSecs: Number.POSITIVE_INFINITY },
      { type: 'poison', durationSecs: -1 },
      { type: 'poison', durationSecs: 1, amplifier: -1 },
      { type: 'poison', durationSecs: 1, amplifier: 1.5 },
      { type: 'poison', durationSecs: 1, amplifier: STATUS_EFFECT_AMPLIFIER_MAX + 1 },
      { type: 'poison', durationSecs: 1, extra: true },
    ]

    for (const application of invalidApplications) {
      const result = applyStatusEffect(
        original as StatusEffectState,
        application as StatusEffectApplication,
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe('InvalidStatusEffectApplication')
      }
      expect(original.effects[0]?.remainingSecs).toBe(4)
    }

    const unknown = applyStatusEffect(original as StatusEffectState, {
      type: 'not_a_status_effect' as StatusEffectName,
      durationSecs: 1,
      amplifier: 0,
    })
    expect(Result.isFailure(unknown)).toBe(true)
    if (Result.isFailure(unknown)) {
      expect(unknown.failure).toStrictEqual({
        _tag: 'UnknownStatusEffect',
        value: 'not_a_status_effect',
      })
    }
    expect(original.effects[0]?.remainingSecs).toBe(4)

    const invalidState = {
      effects: [
        { type: 'speed', remainingSecs: 4, pulseClockSecs: 0, amplifier: 0 },
        { type: 'speed', remainingSecs: 2, pulseClockSecs: 0, amplifier: 1 },
      ],
    } as unknown as StatusEffectState
    const rejectedState = applyStatusEffect(invalidState, {
      type: 'poison',
      durationSecs: 1,
      amplifier: 0,
    })
    expect(Result.isFailure(rejectedState)).toBe(true)
    if (Result.isFailure(rejectedState)) {
      expect(rejectedState.failure._tag).toBe('InvalidStatusEffectApplication')
      expect(rejectedState.failure).toMatchObject({ reason: 'invalid-state' })
    }
    expect(invalidState.effects).toHaveLength(2)
  })

  it('accepts amplifier bounds and removes an effect only for an explicit zero duration', () => {
    const maximum = applyStatusEffect(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: Number.MIN_VALUE,
      amplifier: STATUS_EFFECT_AMPLIFIER_MAX,
    })
    expect(Result.isSuccess(maximum)).toBe(true)
    if (Result.isSuccess(maximum)) expect(maximum.success.state.effects[0]?.amplifier).toBe(255)

    const active = apply(emptyStatusEffectState(), {
      type: 'speed',
      durationSecs: 4,
      amplifier: 0,
    }).state
    const removed = applyStatusEffect(active, { type: 'speed', durationSecs: 0, amplifier: 0 })
    expect(Result.isSuccess(removed)).toBe(true)
    if (Result.isSuccess(removed)) expect(removed.success.state.effects).toStrictEqual([])

    const negativeDuration = applyStatusEffect(active, {
      type: 'speed',
      durationSecs: -Number.MIN_VALUE,
      amplifier: 0,
    })
    expect(Result.isFailure(negativeDuration)).toBe(true)
  })

  it('validates saved state records, duplicate effects, and hidden-effect ordering', () => {
    expect(isValidStatusEffectState(emptyStatusEffectState())).toBe(true)
    expect(Result.isSuccess(
      Schema.decodeUnknownResult(StatusEffectStateSchema)(emptyStatusEffectState()),
    )).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(StatusEffectStateSchema)({
      effects: [{ type: 'not_a_status_effect', remainingSecs: 1, pulseClockSecs: 0, amplifier: 0 }],
    }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(StatusEffectStateSchema)({
      effects: [{ type: 'speed', remainingSecs: 1, pulseClockSecs: 0, amplifier: 0, extra: true }],
    }))).toBe(true)
    expect(isValidStatusEffectState({
      effects: [
        { type: 'poison', remainingSecs: 10, pulseClockSecs: 0, amplifier: 1 },
        { type: 'poison', remainingSecs: 5, pulseClockSecs: 0, amplifier: 0 },
      ],
    })).toBe(false)
    expect(isValidStatusEffectState({
      effects: [{
        type: 'speed',
        remainingSecs: 10,
        pulseClockSecs: 0,
        amplifier: 2,
        hiddenEffects: [
          { remainingSecs: 5, pulseClockSecs: 0, amplifier: 1 },
          { remainingSecs: 4, pulseClockSecs: 0, amplifier: 1 },
        ],
      }],
    })).toBe(false)
    expect(isValidStatusEffectState({
      effects: [{
        type: 'speed',
        remainingSecs: 10,
        pulseClockSecs: 0,
        amplifier: 2,
        hiddenEffects: [{ remainingSecs: 5, pulseClockSecs: 0, amplifier: 1, extra: true }],
      }],
    })).toBe(false)
    expect(isValidStatusEffectState({
      effects: [{
        type: 'speed',
        remainingSecs: 10,
        pulseClockSecs: 0,
        amplifier: 2,
        hiddenEffects: 'not-an-array',
      }],
    })).toBe(false)
    expect(isValidStatusEffectState({
      effects: [{ type: 'speed', remainingSecs: Number.POSITIVE_INFINITY, pulseClockSecs: 0, amplifier: 0 }],
    })).toBe(false)
    expect(isValidStatusEffectState({ effects: [], extra: true })).toBe(false)
  })

  it('keeps malformed tick state inert and treats a bypassed non-finite delta as no elapsed time', () => {
    const poison = apply(emptyStatusEffectState(), { type: 'poison', durationSecs: 5, amplifier: 0 }).state
    const invalidDelta = tickStatusEffects(poison, Number.NaN as unknown as DeltaTimeSecs)
    expect(invalidDelta.poisonPulses).toBe(0)
    expect(invalidDelta.state.effects).toStrictEqual(poison.effects)

    const malformed = {
      effects: [{ type: 'unknown', remainingSecs: 1, pulseClockSecs: 0, amplifier: 0 }],
    } as unknown as StatusEffectState
    expect(tickStatusEffects(malformed, DeltaTimeSecs(0))).toMatchObject({
      state: { effects: [] },
      poisonPulses: 0,
      regenerationPulses: 0,
      witherPulses: 0,
      hungerExhaustion: 0,
      movementSpeedMultiplier: 1,
    })
  })

  it('clamps a non-finite amplifier when projecting malformed state into modifiers', () => {
    const malformed = {
      effects: [{ type: 'speed', remainingSecs: 1, pulseClockSecs: 0, amplifier: Number.NaN }],
    } as unknown as StatusEffectState
    const modifiers = statusEffectModifiers(malformed)

    expect(statusEffectLevel(malformed, 'speed')).toBe(1)
    expect(modifiers.movementSpeedMultiplier).toBeCloseTo(1.2, 12)
    expect(Result.isSuccess(Schema.decodeUnknownResult(StatusEffectModifiersSchema)(modifiers))).toBe(true)
  })

  it('clones active and hidden status-effect records without aliasing', () => {
    const visibleOnly = apply(emptyStatusEffectState(), { type: 'speed', durationSecs: 5, amplifier: 0 }).state
    expect(copyStatusEffectState(visibleOnly)).toStrictEqual(visibleOnly)

    let state = visibleOnly
    state = apply(state, { type: 'speed', durationSecs: 2, amplifier: 1 }).state

    const copy = copyStatusEffectState(state)

    expect(copy).toStrictEqual(state)
    expect(copy.effects[0]).not.toBe(state.effects[0])
    expect(copy.effects[0]?.hiddenEffects?.[0]).not.toBe(state.effects[0]?.hiddenEffects?.[0])
  })

  it('returns a typed failure or schema-decodable result for arbitrary JSON input without throwing', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (state, application) => {
        const result: unknown = Reflect.apply(applyStatusEffect, undefined, [state, application])
        if (typeof result !== 'object' || result === null) return false
        if ('failure' in result) {
          return Result.isSuccess(Schema.decodeUnknownResult(StatusEffectApplicationErrorSchema)(result.failure))
        }
        if ('success' in result) {
          return Result.isSuccess(Schema.decodeUnknownResult(StatusEffectApplicationOutcomeSchema)(result.success))
        }
        return false
      }),
      { numRuns: 300 },
    )
  })

  it('returns schema-decodable outcomes and valid state across supported effects and values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATUS_EFFECT_NAMES),
        fc.double({ min: 0, max: 600, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: STATUS_EFFECT_AMPLIFIER_MAX }),
        (type, durationSecs, amplifier) => {
          const result = applyStatusEffect(emptyStatusEffectState(), {
            type,
            durationSecs,
            amplifier,
          })
          return Result.isSuccess(result) &&
            Result.isSuccess(Schema.decodeUnknownResult(StatusEffectApplicationOutcomeSchema)(result.success)) &&
            Result.isSuccess(Schema.decodeUnknownResult(StatusEffectStateSchema)(result.success.state))
        },
      ),
      { numRuns: 300 },
    )
  })

  it('ticks randomized applied effects into schema-valid state with nonnegative pulse counts', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATUS_EFFECT_NAMES),
        fc.double({ min: 0.05, max: 120, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: STATUS_EFFECT_AMPLIFIER_MAX }),
        fc.integer({ min: 0, max: 2400 }),
        (type, durationSecs, amplifier, elapsedTicks) => {
          const applied = applyStatusEffect(emptyStatusEffectState(), {
            type,
            durationSecs,
            amplifier,
          })
          if (Result.isFailure(applied)) return false

          const tick = tickStatusEffects(
            applied.success.state,
            DeltaTimeSecs(elapsedTicks / 20),
          )
          return Result.isSuccess(Schema.decodeUnknownResult(StatusEffectStateSchema)(tick.state)) &&
            Result.isSuccess(Schema.decodeUnknownResult(StatusEffectModifiersSchema)(tick.modifiers)) &&
            Number.isSafeInteger(tick.poisonPulses) && tick.poisonPulses >= 0 &&
            Number.isSafeInteger(tick.regenerationPulses) && tick.regenerationPulses >= 0 &&
            Number.isSafeInteger(tick.witherPulses) && tick.witherPulses >= 0 &&
            Number.isFinite(tick.hungerExhaustion) && tick.hungerExhaustion >= 0
        },
      ),
      { numRuns: 300 },
    )
  })
})
