import { describe, expect, it } from '@effect/vitest'
import { DeltaTimeSecs } from '../src/domain/frame-contract'
import {
  SPEED_MOVEMENT_MULTIPLIER,
  applyStatusEffect,
  emptyStatusEffectState,
  tickStatusEffects,
} from '../src/domain/status-effect'

describe('status effects', () => {
  it('ticks poison and regeneration deterministically across a long frame', () => {
    const state = [
      { type: 'poison' as const, durationSecs: 3 },
      { type: 'regeneration' as const, durationSecs: 5 },
    ].reduce(applyStatusEffect, emptyStatusEffectState())

    const tick = tickStatusEffects(state, DeltaTimeSecs(3))

    expect(tick.poisonPulses).toBe(3)
    expect(tick.regenerationPulses).toBe(1)
    expect(tick.hungerExhaustion).toBe(0)
    expect(tick.nauseaAmplifier).toBeNull()
    expect(tick.state.effects).toStrictEqual([
      { type: 'regeneration', remainingSecs: 2, pulseClockSecs: 0.5, amplifier: 0 },
    ])
  })

  it('defaults omitted amplifiers to zero and preserves pulse cadence on refresh', () => {
    const initial = applyStatusEffect(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 2,
    })
    const partial = tickStatusEffects(initial, DeltaTimeSecs(0.75)).state
    const refreshed = applyStatusEffect(partial, { type: 'poison', durationSecs: 2 })
    const tick = tickStatusEffects(refreshed, DeltaTimeSecs(0.25))

    expect(initial.effects[0]?.amplifier).toBe(0)
    expect(tick.poisonPulses).toBe(1)
    expect(tick.state.effects[0]?.remainingSecs).toBe(1.75)
  })

  it('keeps the stronger effect and the longer duration at equal strength', () => {
    const strong = applyStatusEffect(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 4,
      amplifier: 2,
    })
    const rejectedWeak = applyStatusEffect(strong, {
      type: 'poison',
      durationSecs: 10,
      amplifier: 1,
    })
    const rejectedShort = applyStatusEffect(rejectedWeak, {
      type: 'poison',
      durationSecs: 2,
      amplifier: 2,
    })

    expect(rejectedWeak).toBe(strong)
    expect(rejectedShort.effects[0]).toStrictEqual({
      type: 'poison',
      remainingSecs: 4,
      pulseClockSecs: 0,
      amplifier: 2,
    })
  })

  it('replaces a weaker effect and resets its pulse cadence', () => {
    const weak = applyStatusEffect(emptyStatusEffectState(), {
      type: 'regeneration',
      durationSecs: 4,
    })
    const partial = tickStatusEffects(weak, DeltaTimeSecs(1)).state
    const strong = applyStatusEffect(partial, {
      type: 'regeneration',
      durationSecs: 2,
      amplifier: 1,
    })
    const tick = tickStatusEffects(strong, DeltaTimeSecs(1.25))

    expect(strong.effects[0]).toStrictEqual({
      type: 'regeneration',
      remainingSecs: 2,
      pulseClockSecs: 0,
      amplifier: 1,
    })
    expect(tick.regenerationPulses).toBe(1)
  })

  it('scales poison pulse intervals by amplifier', () => {
    const state = applyStatusEffect(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 1,
      amplifier: 2,
    })

    const tick = tickStatusEffects(state, DeltaTimeSecs(0.5))

    expect(tick.poisonPulses).toBe(2)
    expect(tick.state.effects[0]?.pulseClockSecs).toBe(0)
  })

  it('adds hunger exhaustion only for elapsed active time', () => {
    const state = applyStatusEffect(emptyStatusEffectState(), {
      type: 'hunger',
      durationSecs: 1.5,
      amplifier: 2,
    })

    const tick = tickStatusEffects(state, DeltaTimeSecs(2))

    expect(tick.hungerExhaustion).toBeCloseTo(0.45)
    expect(tick.poisonPulses).toBe(0)
    expect(tick.regenerationPulses).toBe(0)
    expect(tick.state.effects).toStrictEqual([])
  })

  it('reports nausea amplifier only while nausea remains active', () => {
    const state = applyStatusEffect(emptyStatusEffectState(), {
      type: 'nausea',
      durationSecs: 1,
      amplifier: 3,
    })

    const active = tickStatusEffects(state, DeltaTimeSecs(0.5))
    const expired = tickStatusEffects(active.state, DeltaTimeSecs(0.5))

    expect(active.nauseaAmplifier).toBe(3)
    expect(expired.nauseaAmplifier).toBeNull()
    expect(active.regenerationPulses).toBe(0)
  })

  it('exposes speed only while its duration remains active', () => {
    const state = applyStatusEffect(emptyStatusEffectState(), {
      type: 'speed',
      durationSecs: 1,
    })

    const active = tickStatusEffects(state, DeltaTimeSecs(0.5))
    const expired = tickStatusEffects(active.state, DeltaTimeSecs(0.5))

    expect(active.movementSpeedMultiplier).toBe(SPEED_MOVEMENT_MULTIPLIER)
    expect(expired.movementSpeedMultiplier).toBe(1)
    expect(expired.state.effects).toStrictEqual([])
  })
})
