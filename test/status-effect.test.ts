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
    expect(tick.state.effects).toStrictEqual([
      { type: 'regeneration', remainingSecs: 2, pulseClockSecs: 0.5 },
    ])
  })

  it('refreshes duration without resetting the pulse cadence', () => {
    const initial = applyStatusEffect(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 2,
    })
    const partial = tickStatusEffects(initial, DeltaTimeSecs(0.75)).state
    const refreshed = applyStatusEffect(partial, { type: 'poison', durationSecs: 2 })
    const tick = tickStatusEffects(refreshed, DeltaTimeSecs(0.25))

    expect(tick.poisonPulses).toBe(1)
    expect(tick.state.effects[0]?.remainingSecs).toBe(1.75)
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
