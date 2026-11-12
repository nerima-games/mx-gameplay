import {
  DeltaTimeSecs,
  type DeltaTimeSecs as DeltaTimeSecsValue,
  type EffectAmplifier,
} from '@nerima-games/mc-kernel'
import {
  STATUS_EFFECT_AMPLIFIER_MAX,
  STATUS_EFFECT_DEFINITIONS,
  STATUS_EFFECT_NAMES,
  resolveStatusEffectDefinition,
  type StatusEffectDefinition,
  type StatusEffectName,
} from '@nerima-games/mc-kernel/domain/status-effect'
import { Brand, Result, Schema, SchemaParser } from 'effect'

export const STATUS_EFFECT_TYPES: typeof STATUS_EFFECT_NAMES = STATUS_EFFECT_NAMES

export type StatusEffectType = StatusEffectName

export type StatusEffectLevel = number & Brand.Brand<'StatusEffectLevel'>
export const StatusEffectLevelSchema: Schema.Codec<StatusEffectLevel, number> = Schema.Int
  .check(Schema.isBetween({ minimum: 0, maximum: STATUS_EFFECT_AMPLIFIER_MAX + 1 }))
  .pipe(Schema.brand('StatusEffectLevel'))

export type StatusEffectPulseCount = number & Brand.Brand<'StatusEffectPulseCount'>
export const StatusEffectPulseCountSchema: Schema.Codec<StatusEffectPulseCount, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('StatusEffectPulseCount'))

export type MovementSpeedMultiplier = number & Brand.Brand<'MovementSpeedMultiplier'>
export const MovementSpeedMultiplierSchema: Schema.Codec<MovementSpeedMultiplier, number> = Schema.Finite
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('MovementSpeedMultiplier'))

export type AttackSpeedMultiplier = number & Brand.Brand<'AttackSpeedMultiplier'>
const AttackSpeedMultiplierSchema: Schema.Codec<AttackSpeedMultiplier, number> = Schema.Finite
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('AttackSpeedMultiplier'))

export type MiningSpeedMultiplier = number & Brand.Brand<'MiningSpeedMultiplier'>
export const MiningSpeedMultiplierSchema: Schema.Codec<MiningSpeedMultiplier, number> = Schema.Finite
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('MiningSpeedMultiplier'))

export type AttackDamageBonus = number & Brand.Brand<'AttackDamageBonus'>
export const AttackDamageBonusSchema: Schema.Codec<AttackDamageBonus, number> = Schema.Finite
  .pipe(Schema.brand('AttackDamageBonus'))

export type DamageTakenMultiplier = number & Brand.Brand<'DamageTakenMultiplier'>
const DamageTakenMultiplierSchema: Schema.Codec<DamageTakenMultiplier, number> = Schema.Finite
  .check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  .pipe(Schema.brand('DamageTakenMultiplier'))

export type AdditionalMaximumHealthPoints = number & Brand.Brand<'AdditionalMaximumHealthPoints'>
const AdditionalMaximumHealthPointsSchema: Schema.Codec<AdditionalMaximumHealthPoints, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('AdditionalMaximumHealthPoints'))

export type AbsorptionHealthPoints = number & Brand.Brand<'AbsorptionHealthPoints'>
const AbsorptionHealthPointsSchema: Schema.Codec<AbsorptionHealthPoints, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('AbsorptionHealthPoints'))

export type StatusEffectLuck = number & Brand.Brand<'StatusEffectLuck'>
const StatusEffectLuckSchema: Schema.Codec<StatusEffectLuck, number> = Schema.Int
  .pipe(Schema.brand('StatusEffectLuck'))

const makeStatusEffectLevel = Brand.nominal<StatusEffectLevel>()
const makeStatusEffectPulseCount = Brand.nominal<StatusEffectPulseCount>()
const makeMovementSpeedMultiplier = Brand.nominal<MovementSpeedMultiplier>()
const makeAttackSpeedMultiplier = Brand.nominal<AttackSpeedMultiplier>()
const makeMiningSpeedMultiplier = Brand.nominal<MiningSpeedMultiplier>()
const makeAttackDamageBonus = Brand.nominal<AttackDamageBonus>()
const makeDamageTakenMultiplier = Brand.nominal<DamageTakenMultiplier>()
const makeAdditionalMaximumHealthPoints = Brand.nominal<AdditionalMaximumHealthPoints>()
const makeAbsorptionHealthPoints = Brand.nominal<AbsorptionHealthPoints>()
const makeStatusEffectLuck = Brand.nominal<StatusEffectLuck>()
const makeEffectAmplifier = Brand.nominal<EffectAmplifier>()
const makeDeltaTimeSecs = Brand.nominal<DeltaTimeSecsValue>()

export type StatusEffectApplication = Readonly<{
  type: StatusEffectType
  durationSecs: number
  amplifier?: number
}>

export type HiddenStatusEffect = Readonly<{
  remainingSecs: DeltaTimeSecsValue
  pulseClockSecs: DeltaTimeSecsValue
  amplifier: EffectAmplifier
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
  | Readonly<{ type: 'instant_health'; amplifier: EffectAmplifier }>
  | Readonly<{ type: 'instant_damage'; amplifier: EffectAmplifier }>
  | Readonly<{ type: 'saturation'; amplifier: EffectAmplifier }>

export type StatusEffectApplicationOutcome = Readonly<{
  state: StatusEffectState
  instantEffects: ReadonlyArray<StatusEffectInstantEffect>
}>

export type StatusEffectTick = Readonly<{
  state: StatusEffectState
  poisonPulses: number
  regenerationPulses: number
  witherPulses: StatusEffectPulseCount
  movementSpeedMultiplier: MovementSpeedMultiplier
  hungerExhaustion: number
  nauseaAmplifier: EffectAmplifier | null
  modifiers: StatusEffectModifiers
}>

/** Derived gameplay attributes; `levels` preserves every active kernel effect for consumers. */
export type StatusEffectModifiers = Readonly<{
  levels: Readonly<Partial<Record<StatusEffectType, StatusEffectLevel>>>
  definitions: ReadonlyArray<StatusEffectDefinition>
  movementSpeedMultiplier: MovementSpeedMultiplier
  attackSpeedMultiplier: AttackSpeedMultiplier
  miningSpeedMultiplier: MiningSpeedMultiplier
  attackDamageBonus: AttackDamageBonus
  damageTakenMultiplier: DamageTakenMultiplier
  fireResistance: boolean
  waterBreathing: boolean
  breathOfTheNautilus: boolean
  additionalMaximumHealthPoints: AdditionalMaximumHealthPoints
  absorptionHealthPoints: AbsorptionHealthPoints
  jumpBoostLevel: StatusEffectLevel
  slowFalling: boolean
  luck: StatusEffectLuck
  nauseaAmplifier: EffectAmplifier | null
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

const StatusEffectSecondsSchema: Schema.Codec<DeltaTimeSecsValue, number> = Schema.Finite
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand('DeltaTimeSecs'))
const StatusEffectApplicationDurationSchema = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
)
const StatusEffectClockSchema: Schema.Codec<DeltaTimeSecsValue, number> = Schema.Finite
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('DeltaTimeSecs'))
const StatusEffectAmplifierSchema: Schema.Codec<EffectAmplifier, number> = Schema.Int.check(Schema.isBetween({
  minimum: 0,
  maximum: STATUS_EFFECT_AMPLIFIER_MAX,
})).pipe(Schema.brand('EffectAmplifier'))

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

const StatusEffectDefinitionSchema: Schema.Codec<StatusEffectDefinition, unknown> = Schema.Struct({
  name: Schema.Literals(STATUS_EFFECT_TYPES),
  beneficial: Schema.Boolean,
  particleColor: Schema.Int
    .check(Schema.isBetween({ minimum: 0, maximum: 0xffffff }))
    .pipe(Schema.brand('RgbColor')),
  maxAmplifier: StatusEffectAmplifierSchema,
})

export const StatusEffectModifiersSchema: Schema.Codec<StatusEffectModifiers, unknown> = strictCodec(
  Schema.Struct({
    levels: Schema.Record(
      Schema.Literals(STATUS_EFFECT_TYPES),
      Schema.optionalKey(StatusEffectLevelSchema),
    ),
    definitions: Schema.Array(StatusEffectDefinitionSchema),
    movementSpeedMultiplier: MovementSpeedMultiplierSchema,
    attackSpeedMultiplier: AttackSpeedMultiplierSchema,
    miningSpeedMultiplier: MiningSpeedMultiplierSchema,
    attackDamageBonus: AttackDamageBonusSchema,
    damageTakenMultiplier: DamageTakenMultiplierSchema,
    fireResistance: Schema.Boolean,
    waterBreathing: Schema.Boolean,
    breathOfTheNautilus: Schema.Boolean,
    additionalMaximumHealthPoints: AdditionalMaximumHealthPointsSchema,
    absorptionHealthPoints: AbsorptionHealthPointsSchema,
    jumpBoostLevel: StatusEffectLevelSchema,
    slowFalling: Schema.Boolean,
    luck: StatusEffectLuckSchema,
    nauseaAmplifier: Schema.NullOr(StatusEffectAmplifierSchema),
    blindness: Schema.Boolean,
    darkness: Schema.Boolean,
    nightVision: Schema.Boolean,
    invisibility: Schema.Boolean,
    glowing: Schema.Boolean,
  }),
)

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
    return { type, amplifier: makeEffectAmplifier(amplifier) }
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
    {
      remainingSecs: makeDeltaTimeSecs(current.remainingSecs),
      pulseClockSecs: makeDeltaTimeSecs(current.pulseClockSecs),
      amplifier: makeEffectAmplifier(current.amplifier),
    },
    ...(current.hiddenEffects ?? []),
  ]) {
    byAmplifier.set(hidden.amplifier, hidden)
  }
  const previous = byAmplifier.get(application.amplifier)
  byAmplifier.set(application.amplifier, previous === undefined
    ? application
    : {
        ...previous,
        remainingSecs: makeDeltaTimeSecs(Math.max(previous.remainingSecs, application.remainingSecs)),
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
      remainingSecs: makeDeltaTimeSecs(durationSecs),
      pulseClockSecs: makeDeltaTimeSecs(0),
      amplifier: makeEffectAmplifier(amplifier),
    }).filter((effect) => effect.amplifier < current.amplifier)
    nextEffect = { ...current, hiddenEffects }
  } else {
    nextEffect = {
      ...applicationEffect,
      hiddenEffects: hiddenEffectsWith(current, {
        remainingSecs: makeDeltaTimeSecs(current.remainingSecs),
        pulseClockSecs: makeDeltaTimeSecs(current.pulseClockSecs),
        amplifier: makeEffectAmplifier(current.amplifier),
      }).filter((effect) => effect.amplifier < amplifier),
    }
  }

  const effects = currentState.effects.filter((effect) => effect.type !== type)
  effects.push(nextEffect)
  const result = {
    state: { effects: canonicalEffects(effects) },
    instantEffects: [],
  } satisfies StatusEffectApplicationOutcome
  return Result.succeed(result)
}

const finiteAmplifier = (amplifier: number): number =>
  Number.isFinite(amplifier) ? Math.max(0, Math.min(STATUS_EFFECT_AMPLIFIER_MAX, Math.floor(amplifier))) : 0

const effectLevel = (effect: ActiveStatusEffect): number =>
  finiteAmplifier(effect.amplifier) + 1

/** Returns the 1-based Vanilla level, or zero when the effect is absent. */
export const statusEffectLevel = (
  state: StatusEffectState,
  type: StatusEffectType,
): StatusEffectLevel => {
  const definition = STATUS_EFFECT_DEFINITIONS[type]
  const effect = state.effects.find((candidate) => candidate.type === definition.name)
  return makeStatusEffectLevel(effect === undefined
    ? 0
    : Math.min(definition.maxAmplifier, finiteAmplifier(effect.amplifier)) + 1)
}

/** Projects active kernel effects into the shared numeric modifiers for stages. */
export const statusEffectModifiers = (state: StatusEffectState): StatusEffectModifiers => {
  const levels: Partial<Record<StatusEffectType, StatusEffectLevel>> = {}
  for (const effect of state.effects) levels[effect.type] = makeStatusEffectLevel(effectLevel(effect))

  const level = (type: StatusEffectType): StatusEffectLevel => levels[type] ?? makeStatusEffectLevel(0)
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
    movementSpeedMultiplier: makeMovementSpeedMultiplier(Math.max(
      0,
      (1 + SPEED_PER_LEVEL * speedLevel) * (1 - SLOWNESS_PER_LEVEL * slownessLevel),
    )),
    attackSpeedMultiplier: makeAttackSpeedMultiplier(Math.max(
      0,
      (1 + ATTACK_SPEED_PER_LEVEL * hasteLevel) *
        (1 - ATTACK_SPEED_PER_LEVEL * miningFatigueLevel),
    )),
    miningSpeedMultiplier: makeMiningSpeedMultiplier(
      (1 + HASTE_PER_LEVEL * Math.max(hasteLevel, conduitPowerLevel)) *
      MINING_FATIGUE_MULTIPLIER_PER_LEVEL ** Math.min(miningFatigueLevel, 4),
    ),
    attackDamageBonus: makeAttackDamageBonus(
      STRENGTH_DAMAGE_PER_LEVEL * level('strength') -
      WEAKNESS_DAMAGE_PER_LEVEL * level('weakness'),
    ),
    damageTakenMultiplier: makeDamageTakenMultiplier(Math.max(0, 1 - RESISTANCE_PER_LEVEL * resistanceLevel)),
    fireResistance: level('fire_resistance') > 0,
    waterBreathing: level('water_breathing') > 0 || level('conduit_power') > 0,
    breathOfTheNautilus: level('breath_of_the_nautilus') > 0,
    additionalMaximumHealthPoints: makeAdditionalMaximumHealthPoints(HEALTH_POINTS_PER_LEVEL * level('health_boost')),
    absorptionHealthPoints: makeAbsorptionHealthPoints(HEALTH_POINTS_PER_LEVEL * level('absorption')),
    jumpBoostLevel: level('jump_boost'),
    slowFalling: level('slow_falling') > 0,
    luck: makeStatusEffectLuck(luck),
    nauseaAmplifier: nausea === undefined ? null : makeEffectAmplifier(finiteAmplifier(nausea.amplifier)),
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
    return [{
      ...effect,
      remainingSecs: makeDeltaTimeSecs(remainingSecs),
      pulseClockSecs: makeDeltaTimeSecs(pulse.pulseClockSecs),
    }]
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
    witherPulses: makeStatusEffectPulseCount(witherPulses),
    movementSpeedMultiplier: modifiers.movementSpeedMultiplier,
    hungerExhaustion,
    nauseaAmplifier: modifiers.nauseaAmplifier,
    modifiers,
  }
}
