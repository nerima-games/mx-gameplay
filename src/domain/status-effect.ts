import type { DeltaTimeSecs } from './frame-contract'

export const STATUS_EFFECT_TYPES = ['poison', 'regeneration', 'speed'] as const

export type StatusEffectType = (typeof STATUS_EFFECT_TYPES)[number]

export type StatusEffectApplication = {
  readonly type: StatusEffectType
  readonly durationSecs: number
}

export type ActiveStatusEffect = {
  readonly type: StatusEffectType
  readonly remainingSecs: number
  readonly pulseClockSecs: number
}

export type StatusEffectState = {
  readonly effects: ReadonlyArray<ActiveStatusEffect>
}

export type StatusEffectTick = {
  readonly state: StatusEffectState
  readonly poisonPulses: number
  readonly regenerationPulses: number
  readonly movementSpeedMultiplier: number
}

export type PlayerHealingEvent = {
  readonly _tag: 'StatusEffect'
  readonly effect: 'regeneration'
  readonly amount: number
  readonly maximumHealthPoints: number
}

export const POISON_INTERVAL_SECS = 1
export const REGENERATION_INTERVAL_SECS = 2.5
export const SPEED_MOVEMENT_MULTIPLIER = 1.2
export const POISON_DAMAGE_POINTS = 1
export const POISON_MINIMUM_HEALTH_POINTS = 1
export const REGENERATION_HEAL_POINTS = 1
export const PLAYER_MAXIMUM_HEALTH_POINTS = 20

export const emptyStatusEffectState = (): StatusEffectState => ({ effects: [] })

const finiteDuration = (durationSecs: number): number =>
  Number.isFinite(durationSecs) ? Math.max(0, durationSecs) : 0

export const copyStatusEffectState = (state: StatusEffectState): StatusEffectState => ({
  effects: state.effects.map((effect) => ({ ...effect })),
})

export const applyStatusEffect = (
  state: StatusEffectState,
  application: StatusEffectApplication,
): StatusEffectState => {
  const durationSecs = finiteDuration(application.durationSecs)
  const others = state.effects.filter((effect) => effect.type !== application.type)
  if (durationSecs === 0) return { effects: others }

  const current = state.effects.find((effect) => effect.type === application.type)
  const next: ActiveStatusEffect = current === undefined
    ? { type: application.type, remainingSecs: durationSecs, pulseClockSecs: 0 }
    : {
        ...current,
        remainingSecs: Math.max(current.remainingSecs, durationSecs),
      }
  return {
    effects: STATUS_EFFECT_TYPES.flatMap((type) =>
      type === next.type ? [next] : others.filter((effect) => effect.type === type),
    ),
  }
}

const advancePulsingEffect = (
  effect: ActiveStatusEffect,
  elapsedSecs: number,
  intervalSecs: number,
): { readonly effect: ActiveStatusEffect | undefined; readonly pulses: number } => {
  const activeElapsed = Math.min(effect.remainingSecs, elapsedSecs)
  const accumulated = effect.pulseClockSecs + activeElapsed
  const pulses = Math.floor((accumulated + Number.EPSILON) / intervalSecs)
  const remainingSecs = Math.max(0, effect.remainingSecs - elapsedSecs)
  return {
    effect: remainingSecs > 0
      ? { ...effect, remainingSecs, pulseClockSecs: accumulated - pulses * intervalSecs }
      : undefined,
    pulses,
  }
}

export const tickStatusEffects = (
  state: StatusEffectState,
  dt: DeltaTimeSecs,
): StatusEffectTick => {
  const elapsedSecs = Number.isFinite(dt) ? Math.max(0, dt) : 0
  const effects: Array<ActiveStatusEffect> = []
  let poisonPulses = 0
  let regenerationPulses = 0

  for (const effect of state.effects) {
    if (effect.type === 'speed') {
      const remainingSecs = Math.max(0, effect.remainingSecs - elapsedSecs)
      if (remainingSecs > 0) effects.push({ ...effect, remainingSecs })
      continue
    }

    const interval = effect.type === 'poison'
      ? POISON_INTERVAL_SECS
      : REGENERATION_INTERVAL_SECS
    const advanced = advancePulsingEffect(effect, elapsedSecs, interval)
    if (advanced.effect !== undefined) effects.push(advanced.effect)
    if (effect.type === 'poison') poisonPulses += advanced.pulses
    else regenerationPulses += advanced.pulses
  }

  return {
    state: { effects },
    poisonPulses,
    regenerationPulses,
    movementSpeedMultiplier: effects.some((effect) => effect.type === 'speed')
      ? SPEED_MOVEMENT_MULTIPLIER
      : 1,
  }
}
