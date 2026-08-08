import type { DeltaTimeSecs } from './frame-contract'

export const STATUS_EFFECT_TYPES = [
  'poison',
  'regeneration',
  'speed',
  'hunger',
  'nausea',
] as const

export type StatusEffectType = (typeof STATUS_EFFECT_TYPES)[number]

export type StatusEffectApplication = {
  readonly type: StatusEffectType
  readonly durationSecs: number
  readonly amplifier?: number
}

export type ActiveStatusEffect = {
  readonly type: StatusEffectType
  readonly remainingSecs: number
  readonly pulseClockSecs: number
  readonly amplifier?: number
}

export type StatusEffectState = {
  readonly effects: ReadonlyArray<ActiveStatusEffect>
}

export type StatusEffectTick = {
  readonly state: StatusEffectState
  readonly poisonPulses: number
  readonly regenerationPulses: number
  readonly movementSpeedMultiplier: number
  readonly hungerExhaustion: number
  readonly nauseaAmplifier: number | null
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

const finiteAmplifier = (amplifier: number | undefined): number =>
  /* v8 ignore start -- `?? 0` guards Math.floor's parameter type only; Number.isFinite(amplifier) being true already proves amplifier is a finite number, never nullish, so this fallback cannot execute. */
  Number.isFinite(amplifier) ? Math.max(0, Math.floor(amplifier ?? 0)) : 0
  /* v8 ignore stop */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStatusEffectType = (value: unknown): value is StatusEffectType =>
  typeof value === 'string' && STATUS_EFFECT_TYPES.includes(value as StatusEffectType)

export const isValidStatusEffectState = (
  value: unknown,
): value is StatusEffectState => {
  if (!isRecord(value) || !Array.isArray(value['effects'])) return false

  const effectTypes = new Set<StatusEffectType>()
  return value['effects'].every((effect) => {
    const amplifier = isRecord(effect) ? effect['amplifier'] : undefined
    if (
      !isRecord(effect) ||
      !isStatusEffectType(effect['type']) ||
      effectTypes.has(effect['type']) ||
      typeof effect['remainingSecs'] !== 'number' ||
      !Number.isFinite(effect['remainingSecs']) ||
      effect['remainingSecs'] <= 0 ||
      typeof effect['pulseClockSecs'] !== 'number' ||
      !Number.isFinite(effect['pulseClockSecs']) ||
      effect['pulseClockSecs'] < 0 ||
      (amplifier !== undefined &&
        (typeof amplifier !== 'number' ||
          !Number.isSafeInteger(amplifier) ||
          amplifier < 0))
    ) {
      return false
    }

    effectTypes.add(effect['type'])
    return true
  })
}

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

  const amplifier = finiteAmplifier(application.amplifier)
  const current = state.effects.find((effect) => effect.type === application.type)
  if (current !== undefined && finiteAmplifier(current.amplifier) > amplifier) return state

  const next: ActiveStatusEffect = current === undefined
    || finiteAmplifier(current.amplifier) < amplifier
    ? {
        type: application.type,
        remainingSecs: durationSecs,
        pulseClockSecs: 0,
        amplifier,
      }
    : {
        ...current,
        amplifier,
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
  let hungerExhaustion = 0

  for (const effect of state.effects) {
    const amplifier = finiteAmplifier(effect.amplifier)
    const activeElapsedSecs = Math.min(effect.remainingSecs, elapsedSecs)

    switch (effect.type) {
      case 'poison': {
        const advanced = advancePulsingEffect(
          effect,
          elapsedSecs,
          POISON_INTERVAL_SECS / 2 ** amplifier,
        )
        if (advanced.effect !== undefined) effects.push(advanced.effect)
        poisonPulses += advanced.pulses
        break
      }
      case 'regeneration': {
        const advanced = advancePulsingEffect(
          effect,
          elapsedSecs,
          REGENERATION_INTERVAL_SECS / 2 ** amplifier,
        )
        if (advanced.effect !== undefined) effects.push(advanced.effect)
        regenerationPulses += advanced.pulses
        break
      }
      case 'hunger':
        hungerExhaustion += activeElapsedSecs * 0.1 * (amplifier + 1)
        if (effect.remainingSecs > elapsedSecs) {
          effects.push({ ...effect, remainingSecs: effect.remainingSecs - elapsedSecs })
        }
        break
      case 'nausea':
      case 'speed':
        if (effect.remainingSecs > elapsedSecs) {
          effects.push({ ...effect, remainingSecs: effect.remainingSecs - elapsedSecs })
        }
        break
      /* v8 ignore start -- exhaustiveness safety net over StatusEffectType, a closed union every case above already covers; no input can reach this arm. */
      default: {
        const exhaustiveEffect: never = effect.type
        return exhaustiveEffect
      }
      /* v8 ignore stop */
    }
  }

  return {
    state: { effects },
    poisonPulses,
    regenerationPulses,
    movementSpeedMultiplier: effects.some((effect) => effect.type === 'speed')
      ? SPEED_MOVEMENT_MULTIPLIER
      : 1,
    hungerExhaustion,
    nauseaAmplifier: effects.some((effect) => effect.type === 'nausea')
      ? finiteAmplifier(effects.find((effect) => effect.type === 'nausea')?.amplifier)
      : null,
  }
}
