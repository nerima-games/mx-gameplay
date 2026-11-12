import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  STATUS_EFFECT_AMPLIFIER_MAX,
  STATUS_EFFECT_DEFINITIONS,
  STATUS_EFFECT_NAMES,
  resolveStatusEffectDefinition,
  type StatusEffectDefinition,
  type StatusEffectName,
} from '@nerima-games/mc-kernel/domain/status-effect'
import { Result, Schema, SchemaParser } from 'effect'

export const STATUS_EFFECT_TYPES: typeof STATUS_EFFECT_NAMES = STATUS_EFFECT_NAMES

export type StatusEffectType = StatusEffectName

export type StatusEffectApplication = Readonly<{
  type: StatusEffectType
  durationSecs: number
  amplifier?: number
}>

export type HiddenStatusEffect = Readonly<{
  remainingSecs: number
  pulseClockSecs: number
  amplifier: number
}>

export type ActiveStatusEffect = Readonly<{
  type: StatusEffectType
  remainingSecs: number
  pulseClockSecs: number
  amplifier: number
  hiddenEffects?: ReadonlyArray<HiddenStatusEffect>
}>

export type StatusEffectState = Readonly<{
  effects: ReadonlyArray<ActiveStatusEffect>
}>

export type StatusEffectInstantEffect =
  | Readonly<{ type: 'instant_health'; amplifier: number }>
  | Readonly<{ type: 'instant_damage'; amplifier: number }>
  | Readonly<{ type: 'saturation'; amplifier: number }>

export type StatusEffectApplicationOutcome = Readonly<{
  state: StatusEffectState
  instantEffects: ReadonlyArray<StatusEffectInstantEffect>
}>

export type StatusEffectTick = Readonly<{
  state: StatusEffectState
  poisonPulses: number
  regenerationPulses: number
  witherPulses: number
  movementSpeedMultiplier: number
  hungerExhaustion: number
  nauseaAmplifier: number | null
  modifiers: StatusEffectModifiers
}>

/** Derived gameplay attributes; `levels` preserves every active kernel effect for consumers. */
export type StatusEffectModifiers = Readonly<{
  levels: Readonly<Partial<Record<StatusEffectType, number>>>
  definitions: ReadonlyArray<StatusEffectDefinition>
  movementSpeedMultiplier: number
  attackSpeedMultiplier: number
  miningSpeedMultiplier: number
  attackDamageBonus: number
  damageTakenMultiplier: number
  fireResistance: boolean
  waterBreathing: boolean
  breathOfTheNautilus: boolean
  additionalMaximumHealthPoints: number
  absorptionHealthPoints: number
  jumpBoostLevel: number
  slowFalling: boolean
  luck: number
  nauseaAmplifier: number | null
  blindness: boolean
  darkness: boolean
  nightVision: boolean
  invisibility: boolean
  glowing: boolean
}>

export type StatusEffectApplicationError =
  | InvalidStatusEffectApplication
  | Readonly<{ _tag: 'UnknownStatusEffect'; value: unknown }>

export type InvalidStatusEffectApplication = Readonly<{
  _tag: 'InvalidStatusEffectApplication'
  reason: 'invalid-state' | 'invalid-shape' | 'invalid-duration' | 'invalid-amplifier'
}>

export type PlayerHealingEvent = Readonly<{
  _tag: 'StatusEffect'
  effect: 'regeneration'
  amount: number
  maximumHealthPoints: number
}>

const TICKS_PER_SECOND = 20
const POISON_INTERVAL_TICKS = 25
const REGENERATION_INTERVAL_TICKS = 50
const WITHER_INTERVAL_TICKS = 40
const HUNGER_EXHAUSTION_PER_LEVEL_PER_TICK = 0.005
const SPEED_PER_LEVEL = 0.2
const SLOWNESS_PER_LEVEL = 0.15
const HASTE_PER_LEVEL = 0.2
const MINING_FATIGUE_MULTIPLIER_PER_LEVEL = 0.3
const STRENGTH_DAMAGE_PER_LEVEL = 3
const WEAKNESS_DAMAGE_PER_LEVEL = 4
const RESISTANCE_PER_LEVEL = 0.2
const ATTACK_SPEED_PER_LEVEL = 0.1
const HEALTH_POINTS_PER_LEVEL = 4
const PULSE_BOUNDARY_EPSILON_SECS = 1e-9

export const POISON_INTERVAL_SECS: number = POISON_INTERVAL_TICKS / TICKS_PER_SECOND
export const REGENERATION_INTERVAL_SECS: number = REGENERATION_INTERVAL_TICKS / TICKS_PER_SECOND
export const WITHER_INTERVAL_SECS: number = WITHER_INTERVAL_TICKS / TICKS_PER_SECOND
export const SPEED_MOVEMENT_MULTIPLIER: number = 1 + SPEED_PER_LEVEL
export const POISON_DAMAGE_POINTS: number = 1
export const POISON_MINIMUM_HEALTH_POINTS: number = 1
export const REGENERATION_HEAL_POINTS: number = 1
export const PLAYER_MAXIMUM_HEALTH_POINTS: number = 20

export const emptyStatusEffectState = (): StatusEffectState => ({ effects: [] })

const strictCodec = <A, I>(schema: Schema.Codec<A, I>): Schema.Codec<A, I> =>
  Schema.declareConstructor<A, I>()([schema], ([inner]) =>
    (input, _ast, options) =>
      SchemaParser.decodeUnknownEffect(inner)(input, {
        ...options,
        onExcessProperty: 'error',
      }),
  )

const StatusEffectSecondsSchema = Schema.Finite.check(Schema.isGreaterThan(0))
const StatusEffectApplicationDurationSchema = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
)
const StatusEffectClockSchema = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const StatusEffectAmplifierSchema = Schema.Int.check(Schema.isBetween({
  minimum: 0,
  maximum: STATUS_EFFECT_AMPLIFIER_MAX,
}))

const HiddenStatusEffectSchema = strictCodec(Schema.Struct({
  remainingSecs: StatusEffectSecondsSchema,
  pulseClockSecs: StatusEffectClockSchema,
  amplifier: StatusEffectAmplifierSchema,
}))

const ActiveStatusEffectSchema = strictCodec(Schema.Struct({
  type: Schema.Literals(STATUS_EFFECT_TYPES),
  remainingSecs: StatusEffectSecondsSchema,
  pulseClockSecs: StatusEffectClockSchema,
  amplifier: StatusEffectAmplifierSchema,
  hiddenEffects: Schema.optionalKey(Schema.Array(HiddenStatusEffectSchema)),
}))

export const StatusEffectStateSchema: Schema.Codec<StatusEffectState, unknown> = strictCodec(
  Schema.Struct({
    effects: Schema.Array(ActiveStatusEffectSchema),
  }),
).check(Schema.makeFilter((state) => isValidStatusEffectState(state)))

export const StatusEffectApplicationSchema: Schema.Codec<
  StatusEffectApplication,
  unknown
> = strictCodec(Schema.Struct({
  type: Schema.Literals(STATUS_EFFECT_TYPES),
  durationSecs: StatusEffectApplicationDurationSchema,
  amplifier: Schema.optionalKey(StatusEffectAmplifierSchema),
}))

const StatusEffectInstantEffectSchema = strictCodec(Schema.Union([
  Schema.Struct({ type: Schema.Literal('instant_health'), amplifier: StatusEffectAmplifierSchema }),
  Schema.Struct({ type: Schema.Literal('instant_damage'), amplifier: StatusEffectAmplifierSchema }),
  Schema.Struct({ type: Schema.Literal('saturation'), amplifier: StatusEffectAmplifierSchema }),
]))

export const StatusEffectApplicationOutcomeSchema: Schema.Codec<
  StatusEffectApplicationOutcome,
  unknown
> = strictCodec(Schema.Struct({
  state: StatusEffectStateSchema,
  instantEffects: Schema.Array(StatusEffectInstantEffectSchema),
}))

const InvalidStatusEffectApplicationSchema: Schema.Codec<
  InvalidStatusEffectApplication,
  unknown
> = strictCodec(Schema.Struct({
  _tag: Schema.Literal('InvalidStatusEffectApplication'),
  reason: Schema.Literals([
    'invalid-state',
    'invalid-shape',
    'invalid-duration',
    'invalid-amplifier',
  ]),
}))
const UnknownStatusEffectSchema = strictCodec(Schema.Struct({
  _tag: Schema.Literal('UnknownStatusEffect'),
  value: Schema.Unknown,
}))
export const StatusEffectApplicationErrorSchema: Schema.Codec<
  StatusEffectApplicationError,
  unknown
> = Schema.Union([InvalidStatusEffectApplicationSchema, UnknownStatusEffectSchema])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, allowedKeys: ReadonlyArray<string>): boolean =>
  Object.keys(value).every((key) => allowedKeys.includes(key))

const isSafeAmplifier = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) &&
  value >= 0 && value <= STATUS_EFFECT_AMPLIFIER_MAX

const isHiddenStatusEffect = (value: unknown): value is HiddenStatusEffect => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['remainingSecs', 'pulseClockSecs', 'amplifier'])) return false
  return typeof value['remainingSecs'] === 'number' &&
    Number.isFinite(value['remainingSecs']) && value['remainingSecs'] > 0 &&
    typeof value['pulseClockSecs'] === 'number' &&
    Number.isFinite(value['pulseClockSecs']) && value['pulseClockSecs'] >= 0 &&
    isSafeAmplifier(value['amplifier'])
}

const isStatusEffectType = (value: unknown): value is StatusEffectType =>
  typeof value === 'string' && STATUS_EFFECT_TYPES.includes(value as StatusEffectType)

const hasValidHiddenEffects = (
  activeAmplifier: number,
  hiddenEffects: unknown,
): hiddenEffects is ReadonlyArray<HiddenStatusEffect> => {
  if (hiddenEffects === undefined) return true
  if (!Array.isArray(hiddenEffects)) return false
  let previousAmplifier = activeAmplifier
  for (const hiddenEffect of hiddenEffects) {
    if (!isHiddenStatusEffect(hiddenEffect) || hiddenEffect.amplifier >= previousAmplifier) {
      return false
    }
    previousAmplifier = hiddenEffect.amplifier
  }
  return true
}

export const isValidStatusEffectState = (value: unknown): value is StatusEffectState => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['effects']) ||
    !Array.isArray(value['effects'])
  ) return false

  const effectTypes = new Set<StatusEffectType>()
  return value['effects'].every((effect) => {
    if (
      !isRecord(effect) ||
      !hasOnlyKeys(effect, ['type', 'remainingSecs', 'pulseClockSecs', 'amplifier', 'hiddenEffects']) ||
      !isStatusEffectType(effect['type']) ||
      effectTypes.has(effect['type']) ||
      typeof effect['remainingSecs'] !== 'number' ||
      !Number.isFinite(effect['remainingSecs']) ||
      effect['remainingSecs'] <= 0 ||
      typeof effect['pulseClockSecs'] !== 'number' ||
      !Number.isFinite(effect['pulseClockSecs']) ||
      effect['pulseClockSecs'] < 0 ||
      !isSafeAmplifier(effect['amplifier']) ||
      !hasValidHiddenEffects(effect['amplifier'], effect['hiddenEffects'])
    ) {
      return false
    }

    effectTypes.add(effect['type'])
    return true
  })
}

const copyHiddenEffects = (
  hiddenEffects: ReadonlyArray<HiddenStatusEffect>,
): ReadonlyArray<HiddenStatusEffect> =>
  hiddenEffects.map((effect) => ({ ...effect }))

export const copyStatusEffectState = (state: StatusEffectState): StatusEffectState => ({
  effects: state.effects.map((effect) => ({
    ...effect,
    ...(effect.hiddenEffects === undefined
      ? {}
      : { hiddenEffects: copyHiddenEffects(effect.hiddenEffects) }),
  })),
})

const instantEffectFor = (
  type: StatusEffectType,
  amplifier: number,
): StatusEffectInstantEffect | undefined => {
  if (type === 'instant_health' || type === 'instant_damage' || type === 'saturation') {
    return { type, amplifier }
  }
  return undefined
}

const invalidApplication = (
  reason: 'invalid-state' | 'invalid-shape' | 'invalid-duration' | 'invalid-amplifier',
): Result.Result<never, InvalidStatusEffectApplication> =>
  Result.fail({ _tag: 'InvalidStatusEffectApplication', reason })

const hiddenEffectsWith = (
  current: ActiveStatusEffect,
  application: HiddenStatusEffect,
): ReadonlyArray<HiddenStatusEffect> => {
  const byAmplifier = new Map<number, HiddenStatusEffect>()
  for (const hidden of [
    { remainingSecs: current.remainingSecs, pulseClockSecs: current.pulseClockSecs, amplifier: current.amplifier },
    ...(current.hiddenEffects ?? []),
  ]) {
    byAmplifier.set(hidden.amplifier, hidden)
  }
  const previous = byAmplifier.get(application.amplifier)
  byAmplifier.set(application.amplifier, previous === undefined
    ? application
    : {
        ...previous,
        remainingSecs: Math.max(previous.remainingSecs, application.remainingSecs),
      })
  return [...byAmplifier.values()]
    .sort((left, right) => right.amplifier - left.amplifier)
    .map((effect) => ({ ...effect }))
}

const canonicalEffects = (
  effects: ReadonlyArray<ActiveStatusEffect>,
): ReadonlyArray<ActiveStatusEffect> =>
  [...effects].sort((left, right) =>
    STATUS_EFFECT_TYPES.indexOf(left.type) - STATUS_EFFECT_TYPES.indexOf(right.type),
  )

export const applyStatusEffect = (
  state: StatusEffectState,
  application: StatusEffectApplication,
): Result.Result<StatusEffectApplicationOutcome, StatusEffectApplicationError> => {
  if (!isRecord(application)) return invalidApplication('invalid-shape')

  const typeValue = application['type']
  if (typeof typeValue !== 'string') return invalidApplication('invalid-shape')
  const definition = resolveStatusEffectDefinition(typeValue)
  if (Result.isFailure(definition)) return Result.fail(definition.failure)

  if (
    typeof application['durationSecs'] !== 'number' ||
    !Number.isFinite(application['durationSecs']) ||
    application['durationSecs'] < 0
  ) {
    return invalidApplication('invalid-duration')
  }
  if (application['amplifier'] !== undefined && !isSafeAmplifier(application['amplifier'])) {
    return invalidApplication('invalid-amplifier')
  }

  const decodedState = Schema.decodeUnknownResult(StatusEffectStateSchema)(state)
  if (Result.isFailure(decodedState)) return invalidApplication('invalid-state')
  const decodedApplication = Schema.decodeUnknownResult(StatusEffectApplicationSchema)(application)
  if (Result.isFailure(decodedApplication)) return invalidApplication('invalid-shape')

  const currentState = decodedState.success
  const current = currentState.effects.find((effect) => effect.type === decodedApplication.success.type)
  const { type, durationSecs } = decodedApplication.success
  const amplifier = decodedApplication.success.amplifier ?? 0
  const instantEffect = instantEffectFor(type, amplifier)
  if (instantEffect !== undefined) {
    return Result.succeed({
      state: currentState,
      instantEffects: [instantEffect],
    })
  }

  if (durationSecs === 0) {
    return Result.succeed({
      state: {
        effects: canonicalEffects(currentState.effects.filter((effect) => effect.type !== type)),
      },
      instantEffects: [],
    })
  }

  const applicationEffect: ActiveStatusEffect = {
    type,
    remainingSecs: durationSecs,
    pulseClockSecs: 0,
    amplifier,
  }
  let nextEffect: ActiveStatusEffect
  if (current === undefined) {
    nextEffect = applicationEffect
  } else if (current.amplifier === amplifier) {
    nextEffect = {
      ...current,
      remainingSecs: Math.max(current.remainingSecs, durationSecs),
      ...(current.hiddenEffects === undefined
        ? {}
        : { hiddenEffects: copyHiddenEffects(current.hiddenEffects) }),
    }
  } else if (current.amplifier > amplifier) {
    const hiddenEffects = hiddenEffectsWith(current, {
      remainingSecs: durationSecs,
      pulseClockSecs: 0,
      amplifier,
    })
    nextEffect = { ...current, hiddenEffects }
  } else {
    nextEffect = {
      ...applicationEffect,
      hiddenEffects: hiddenEffectsWith(current, {
        remainingSecs: current.remainingSecs,
        pulseClockSecs: current.pulseClockSecs,
        amplifier: current.amplifier,
      }).filter((effect) => effect.amplifier < amplifier),
    }
  }

  const effects = currentState.effects.filter((effect) => effect.type !== type)
  effects.push(nextEffect)
  const result = {
    state: { effects: canonicalEffects(effects) },
    instantEffects: [],
  } satisfies StatusEffectApplicationOutcome
  const decodedResult = Schema.decodeUnknownResult(StatusEffectApplicationOutcomeSchema)(result)
  return Result.isFailure(decodedResult)
    ? invalidApplication('invalid-state')
    : Result.succeed(decodedResult.success)
}

const finiteAmplifier = (amplifier: number): number =>
  Number.isFinite(amplifier) ? Math.max(0, Math.min(STATUS_EFFECT_AMPLIFIER_MAX, Math.floor(amplifier))) : 0

const effectLevel = (effect: ActiveStatusEffect | undefined): number =>
  effect === undefined ? 0 : finiteAmplifier(effect.amplifier) + 1

/** Returns the 1-based Vanilla level, or zero when the effect is absent. */
export const statusEffectLevel = (
  state: StatusEffectState,
  type: StatusEffectType,
): number => {
  const definition = STATUS_EFFECT_DEFINITIONS[type]
  const effect = state.effects.find((candidate) => candidate.type === definition.name)
  return effect === undefined
    ? 0
    : Math.min(definition.maxAmplifier, finiteAmplifier(effect.amplifier)) + 1
}

/** Projects active kernel effects into the shared numeric modifiers for stages. */
export const statusEffectModifiers = (state: StatusEffectState): StatusEffectModifiers => {
  const levels: Partial<Record<StatusEffectType, number>> = {}
  for (const effect of state.effects) levels[effect.type] = effectLevel(effect)

  const level = (type: StatusEffectType): number => levels[type] ?? 0
  const speedLevel = level('speed')
  const slownessLevel = level('slowness')
  const resistanceLevel = level('resistance')
  const hasteLevel = level('haste')
  const conduitPowerLevel = level('conduit_power')
  const miningFatigueLevel = level('mining_fatigue')
  const luck = level('luck') - level('unluck')
  const nausea = state.effects.find((effect) => effect.type === 'nausea')

  return {
    levels,
    definitions: state.effects.map(({ type }) => STATUS_EFFECT_DEFINITIONS[type]),
    movementSpeedMultiplier: Math.max(
      0,
      (1 + SPEED_PER_LEVEL * speedLevel) * (1 - SLOWNESS_PER_LEVEL * slownessLevel),
    ),
    attackSpeedMultiplier: Math.max(
      0,
      (1 + ATTACK_SPEED_PER_LEVEL * hasteLevel) *
        (1 - ATTACK_SPEED_PER_LEVEL * miningFatigueLevel),
    ),
    miningSpeedMultiplier:
      (1 + HASTE_PER_LEVEL * Math.max(hasteLevel, conduitPowerLevel)) *
      MINING_FATIGUE_MULTIPLIER_PER_LEVEL ** Math.min(miningFatigueLevel, 4),
    attackDamageBonus:
      STRENGTH_DAMAGE_PER_LEVEL * level('strength') -
      WEAKNESS_DAMAGE_PER_LEVEL * level('weakness'),
    damageTakenMultiplier: Math.max(0, 1 - RESISTANCE_PER_LEVEL * resistanceLevel),
    fireResistance: level('fire_resistance') > 0,
    waterBreathing: level('water_breathing') > 0 || level('conduit_power') > 0,
    breathOfTheNautilus: level('breath_of_the_nautilus') > 0,
    additionalMaximumHealthPoints: HEALTH_POINTS_PER_LEVEL * level('health_boost'),
    absorptionHealthPoints: HEALTH_POINTS_PER_LEVEL * level('absorption'),
    jumpBoostLevel: level('jump_boost'),
    slowFalling: level('slow_falling') > 0,
    luck,
    nauseaAmplifier: nausea === undefined ? null : finiteAmplifier(nausea.amplifier),
    blindness: level('blindness') > 0,
    darkness: level('darkness') > 0,
    nightVision: level('night_vision') > 0,
    invisibility: level('invisibility') > 0,
    glowing: level('glowing') > 0,
  }
}

const intervalSecs = (baseIntervalTicks: number, amplifier: number): number =>
  Math.max(1, Math.floor(baseIntervalTicks / 2 ** finiteAmplifier(amplifier))) /
  TICKS_PER_SECOND

const pulseIntervalFor = (type: StatusEffectType): number | undefined =>
  type === 'poison'
    ? POISON_INTERVAL_TICKS
    : type === 'regeneration'
      ? REGENERATION_INTERVAL_TICKS
      : type === 'wither'
        ? WITHER_INTERVAL_TICKS
        : undefined

const advancePulseClock = (
  type: StatusEffectType,
  amplifier: number,
  pulseClockSecs: number,
  elapsedSecs: number,
): { readonly pulseClockSecs: number; readonly pulses: number } => {
  const baseIntervalTicks = pulseIntervalFor(type)
  if (baseIntervalTicks === undefined) return { pulseClockSecs, pulses: 0 }

  const interval = intervalSecs(baseIntervalTicks, amplifier)
  const accumulated = pulseClockSecs + elapsedSecs
  const pulses = Math.floor((accumulated + PULSE_BOUNDARY_EPSILON_SECS) / interval)
  return {
    pulseClockSecs: Math.max(0, accumulated - pulses * interval),
    pulses,
  }
}

const advanceHiddenEffects = (
  type: StatusEffectType,
  hiddenEffects: ReadonlyArray<HiddenStatusEffect> | undefined,
  elapsedSecs: number,
): ReadonlyArray<HiddenStatusEffect> =>
  (hiddenEffects ?? []).flatMap((effect) => {
    const activeElapsedSecs = Math.min(effect.remainingSecs, elapsedSecs)
    const remainingSecs = effect.remainingSecs - elapsedSecs
    if (remainingSecs <= 0) return []

    const pulse = advancePulseClock(type, effect.amplifier, effect.pulseClockSecs, activeElapsedSecs)
    return [{ ...effect, remainingSecs, pulseClockSecs: pulse.pulseClockSecs }]
  })

const promoteHiddenEffect = (
  type: StatusEffectType,
  hiddenEffects: ReadonlyArray<HiddenStatusEffect>,
): ActiveStatusEffect | undefined => {
  const [next, ...rest] = hiddenEffects
  return next === undefined
    ? undefined
    : {
        type,
        ...next,
        ...(rest.length === 0 ? {} : { hiddenEffects: rest }),
      }
}

export const tickStatusEffects = (
  state: StatusEffectState,
  dt: DeltaTimeSecs,
): StatusEffectTick => {
  const elapsedSecs = typeof dt === 'number' && Number.isFinite(dt) && dt >= 0 ? dt : 0
  const sourceState = isValidStatusEffectState(state) ? state : emptyStatusEffectState()
  let poisonPulses = 0
  let regenerationPulses = 0
  let witherPulses = 0
  let hungerExhaustion = 0

  const advance = (effect: ActiveStatusEffect, elapsed: number): ActiveStatusEffect | undefined => {
    const activeElapsedSecs = Math.min(effect.remainingSecs, elapsed)
    const remainingSecs = effect.remainingSecs - activeElapsedSecs
    const activePulse = advancePulseClock(
      effect.type,
      effect.amplifier,
      effect.pulseClockSecs,
      activeElapsedSecs,
    )
    poisonPulses += effect.type === 'poison' ? activePulse.pulses : 0
    regenerationPulses += effect.type === 'regeneration' ? activePulse.pulses : 0
    witherPulses += effect.type === 'wither' ? activePulse.pulses : 0
    hungerExhaustion += effect.type === 'hunger'
      ? activeElapsedSecs * HUNGER_EXHAUSTION_PER_LEVEL_PER_TICK *
        TICKS_PER_SECOND * effectLevel(effect)
      : 0

    const hiddenEffects = advanceHiddenEffects(effect.type, effect.hiddenEffects, activeElapsedSecs)
    if (remainingSecs > 0) {
      return {
        type: effect.type,
        remainingSecs,
        pulseClockSecs: activePulse.pulseClockSecs,
        amplifier: effect.amplifier,
        ...(hiddenEffects.length === 0 ? {} : { hiddenEffects }),
      }
    }

    const promoted = promoteHiddenEffect(effect.type, hiddenEffects)
    if (promoted === undefined) return undefined
    return advance(promoted, elapsed - activeElapsedSecs)
  }

  const effects = sourceState.effects.flatMap((effect) => {
    const advanced = advance(effect, elapsedSecs)
    return advanced === undefined ? [] : [advanced]
  })

  const nextState: StatusEffectState = { effects: canonicalEffects(effects) }
  const modifiers = statusEffectModifiers(nextState)
  return {
    state: nextState,
    poisonPulses,
    regenerationPulses,
    witherPulses,
    movementSpeedMultiplier: modifiers.movementSpeedMultiplier,
    hungerExhaustion,
    nauseaAmplifier: modifiers.nauseaAmplifier,
    modifiers,
  }
}
