import { describe, expect, it } from '@effect/vitest'
import { DeltaTimeSecs } from '../src/domain/frame-contract'
import {
  SPEED_MOVEMENT_MULTIPLIER,
  applyStatusEffect,
  copyStatusEffectState,
  emptyStatusEffectState,
  isValidStatusEffectState,
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

  it('validates saved effects before restoration', () => {
    expect(isValidStatusEffectState(emptyStatusEffectState())).toBe(true)
    expect(isValidStatusEffectState({
      effects: [{ type: 'poison', remainingSecs: 10, pulseClockSecs: 0, amplifier: 1 }],
    })).toBe(true)
    expect(isValidStatusEffectState({
      effects: [
        { type: 'poison', remainingSecs: 10, pulseClockSecs: 0 },
        { type: 'poison', remainingSecs: 5, pulseClockSecs: 0 },
      ],
    })).toBe(false)
    expect(isValidStatusEffectState({
      effects: [{ type: 'speed', remainingSecs: Number.POSITIVE_INFINITY, pulseClockSecs: 0 }],
    })).toBe(false)
  })

  it('rejects a save whose top level is not a well-formed effects record', () => {
    // Distinct from the per-effect rejections above: these never even reach
    // the `.every()` walk because the container itself is malformed.
    expect(isValidStatusEffectState(null)).toBe(false)
    expect(isValidStatusEffectState('not an object')).toBe(false)
    expect(isValidStatusEffectState({ effects: 'not an array' })).toBe(false)
    expect(isValidStatusEffectState({ effects: [null] })).toBe(false)
    expect(isValidStatusEffectState({ effects: ['not a record either'] })).toBe(false)
  })

  it('applying a non-finite duration clears any existing effect of that type', () => {
    // A malformed application (e.g. from an untrusted caller) must not throw
    // or silently keep the old effect — it is treated the same as an
    // explicit durationSecs: 0, which is applyStatusEffect's own removal
    // convention.
    const withPoison = applyStatusEffect(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 5,
    })

    const cleared = applyStatusEffect(withPoison, {
      type: 'poison',
      durationSecs: Number.NaN,
    })

    expect(cleared.effects).toStrictEqual([])
  })

  it('a hunger effect that outlives the frame keeps ticking next frame', () => {
    const state = applyStatusEffect(emptyStatusEffectState(), {
      type: 'hunger',
      durationSecs: 5,
      amplifier: 1,
    })

    const tick = tickStatusEffects(state, DeltaTimeSecs(2))

    expect(tick.hungerExhaustion).toBeCloseTo(2 * 0.1 * 2)
    expect(tick.state.effects).toStrictEqual([
      { type: 'hunger', remainingSecs: 3, pulseClockSecs: 0, amplifier: 1 },
    ])
  })

  it('treats a non-finite delta time as zero elapsed, defending against an unvalidated dt', () => {
    // `DeltaTimeSecs` is a refined brand that normally refuses this value —
    // this simulates state restored from outside the constructor, the same
    // way `savedStack` does in the inventory tests.
    const state = applyStatusEffect(emptyStatusEffectState(), {
      type: 'poison',
      durationSecs: 5,
    })

    const tick = tickStatusEffects(state, Number.NaN as unknown as DeltaTimeSecs)

    expect(tick.poisonPulses).toBe(0)
    expect(tick.state.effects).toStrictEqual(state.effects)
  })

  it('copyStatusEffectState clones each effect rather than aliasing it', () => {
    const original = applyStatusEffect(emptyStatusEffectState(), {
      type: 'speed',
      durationSecs: 5,
    })

    const copy = copyStatusEffectState(original)

    expect(copy).toStrictEqual(original)
    expect(copy.effects[0]).not.toBe(original.effects[0])
  })
})
