import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DeltaTimeSecs } from '../src/domain/frame-contract'
import {
  SPAWN_PLAYER_VITALS,
  type PlayerVitals,
} from '../src/domain/in-memory-vitals'
import {
  DEFAULT_SURVIVAL_DIFFICULTY,
  SURVIVAL_HUNGER_STATE_VERSION,
  exhaustionForSurvivalActivity,
  isSurvivalHungerState,
  makeSurvivalHungerRuntime,
  starvationHealthFloor,
  type SurvivalDifficulty,
} from '../src/domain/survival-hunger'

const vitals = (overrides: Partial<PlayerVitals> = {}): PlayerVitals => ({
  healthPoints: 20,
  maxHealthPoints: 20,
  hungerPoints: 20,
  maxHungerPoints: 20,
  saturation: 5,
  exhaustion: 0,
  foodTimerSecs: 0,
  totalExperience: 0,
  lastDamageCause: undefined,
  ...overrides,
})

const initial = (
  difficulty: SurvivalDifficulty,
  overrides: Partial<PlayerVitals> = {},
) => ({
  version: SURVIVAL_HUNGER_STATE_VERSION,
  difficulty,
  vitals: vitals(overrides),
}) as const

describe('survival hunger', () => {
  it('maps player activity to deterministic exhaustion and rejects invalid magnitudes', () => {
    expect(exhaustionForSurvivalActivity({ _tag: 'walk', distance: 100 })).toBe(1)
    expect(exhaustionForSurvivalActivity({ _tag: 'sprint', distance: 10 })).toBe(1)
    expect(exhaustionForSurvivalActivity({ _tag: 'jump', count: 2 })).toBe(0.1)
    expect(exhaustionForSurvivalActivity({ _tag: 'jump', count: 2, sprinting: true })).toBe(0.4)
    expect(exhaustionForSurvivalActivity({ _tag: 'swim', distance: 100 })).toBe(1)
    expect(exhaustionForSurvivalActivity({ _tag: 'mine', blocks: 200 })).toBe(1)
    expect(exhaustionForSurvivalActivity({ _tag: 'attack', count: 10 })).toBe(1)
    expect(exhaustionForSurvivalActivity({ _tag: 'walk', distance: -1 })).toBe(0)
    expect(exhaustionForSurvivalActivity({ _tag: 'attack', count: Number.NaN })).toBe(0)
  })

  it.effect('consumes saturation before hunger and applies food recovery', () =>
    Effect.gen(function* () {
      const runtime = yield* makeSurvivalHungerRuntime(initial('normal', { saturation: 1 }))
      yield* runtime.submit({ _tag: 'walk', distance: 400 })
      expect((yield* runtime.tick(DeltaTimeSecs(0))).vitals).toMatchObject({
        hungerPoints: 20,
        saturation: 0,
      })

      yield* runtime.submit({ _tag: 'attack', count: 40 })
      expect((yield* runtime.tick(DeltaTimeSecs(0))).vitals).toMatchObject({
        hungerPoints: 19,
        saturation: 0,
      })

      expect(yield* runtime.eat(1, 0.6)).toMatchObject({
        hungerPoints: 20,
        saturation: 1.2,
      })
    }),
  )

  it.effect('adds explicit exhaustion directly and preserves vitals numeric guards', () =>
    Effect.gen(function* () {
      const runtime = yield* makeSurvivalHungerRuntime(initial('peaceful', { saturation: 2 }))

      expect(yield* runtime.addExhaustion(4.5)).toBeUndefined()
      expect((yield* runtime.snapshot).vitals).toMatchObject({
        hungerPoints: 20,
        saturation: 1,
        exhaustion: 0.5,
      })

      yield* runtime.addExhaustion(8)
      expect((yield* runtime.snapshot).vitals).toMatchObject({
        hungerPoints: 19,
        saturation: 0,
        exhaustion: 0.5,
      })

      yield* runtime.addExhaustion(Number.NaN)
      yield* runtime.addExhaustion(Number.NEGATIVE_INFINITY)
      expect((yield* runtime.snapshot).vitals).toMatchObject({
        hungerPoints: 19,
        saturation: 0,
        exhaustion: 0.5,
      })

      yield* runtime.addExhaustion(Number.POSITIVE_INFINITY)
      expect((yield* runtime.snapshot).vitals).toMatchObject({
        hungerPoints: 9,
        saturation: 0,
        exhaustion: 0,
      })
    }))

  it.effect('regenerates health, adds exhaustion, and counts every elapsed food tick', () =>
    Effect.gen(function* () {
      const runtime = yield* makeSurvivalHungerRuntime(initial('normal', {
        healthPoints: 19,
        saturation: 0,
      }))
      const outcome = yield* runtime.tick(DeltaTimeSecs(8))

      expect(outcome.foodTicks).toBe(2)
      expect(outcome.regeneratedHealth).toBe(1)
      expect(outcome.vitals).toMatchObject({
        healthPoints: 20,
        hungerPoints: 19,
        exhaustion: 2,
      })
    }),
  )

  it.effect('enforces difficulty-specific starvation floors', () =>
    Effect.gen(function* () {
      const cases = [
        ['peaceful', 5, 5],
        ['easy', 11, 10],
        ['normal', 2, 1],
        ['hard', 1, 0],
      ] as const

      expect(starvationHealthFloor('peaceful')).toBe(20)
      for (const [difficulty, healthPoints, expected] of cases) {
        const runtime = yield* makeSurvivalHungerRuntime(initial(difficulty, {
          healthPoints,
          hungerPoints: 0,
          saturation: 0,
        }))
        const outcome = yield* runtime.tick(DeltaTimeSecs(4))
        expect(outcome.vitals.healthPoints).toBe(expected)
        expect(outcome.died).toBe(difficulty === 'hard')
      }
    }),
  )

  it.effect('partitions long frames identically to consecutive food ticks', () =>
    Effect.gen(function* () {
      const state = initial('hard', { healthPoints: 3, hungerPoints: 0, saturation: 0 })
      const longFrame = yield* makeSurvivalHungerRuntime(state)
      const splitFrames = yield* makeSurvivalHungerRuntime(state)

      const outcome = yield* longFrame.tick(DeltaTimeSecs(8))
      yield* splitFrames.tick(DeltaTimeSecs(4))
      yield* splitFrames.tick(DeltaTimeSecs(4))

      expect(outcome.foodTicks).toBe(2)
      expect(outcome.starvationDamage).toBe(2)
      expect(yield* longFrame.snapshot).toStrictEqual(yield* splitFrames.snapshot)
    }),
  )

  it.effect('round-trips versioned state and clears transient input on restore', () =>
    Effect.gen(function* () {
      const source = yield* makeSurvivalHungerRuntime(initial('easy', { hungerPoints: 12 }))
      yield* source.submit({ _tag: 'sprint', distance: 10 })
      const snapshot = yield* source.snapshot
      const decoded: unknown = JSON.parse(JSON.stringify(snapshot))
      expect(isSurvivalHungerState(decoded)).toBe(true)
      expect(isSurvivalHungerState({ ...snapshot, version: 2 })).toBe(false)

      const restored = yield* makeSurvivalHungerRuntime()
      yield* restored.submit({ _tag: 'attack', count: 40 })
      yield* restored.restore(snapshot)
      expect(yield* restored.snapshot).toStrictEqual(snapshot)
      expect((yield* restored.tick(DeltaTimeSecs(0))).exhaustionAdded).toBe(0)
    }),
  )

  it.effect('applies damage and healing while alive and reports death only once', () =>
    Effect.gen(function* () {
      const runtime = yield* makeSurvivalHungerRuntime(initial('normal', {
        healthPoints: 10,
      }))

      expect(yield* runtime.damage({ amount: 3, cause: 'fall' })).toMatchObject({
        died: false,
        vitals: { healthPoints: 7 },
      })
      expect(yield* runtime.heal(2)).toMatchObject({
        healthPoints: 9,
      })
      expect(yield* runtime.damage({ amount: 20, cause: 'explosion' })).toMatchObject({
        died: true,
        vitals: { healthPoints: 0, lastDamageCause: 'explosion' },
      })
      expect(yield* runtime.damage({ amount: 1, cause: 'mob' })).toMatchObject({
        died: false,
        vitals: { healthPoints: 0, lastDamageCause: 'explosion' },
      })
      expect(yield* runtime.heal(5)).toMatchObject({
        healthPoints: 0,
        lastDamageCause: 'explosion',
      })
      expect((yield* runtime.snapshot).vitals).toMatchObject({
        healthPoints: 0,
        lastDamageCause: 'explosion',
      })
    }),
  )

  it.effect('setDifficulty changes which starvation floor a later tick enforces', () =>
    Effect.gen(function* () {
      const runtime = yield* makeSurvivalHungerRuntime(initial('peaceful', {
        healthPoints: 1,
        hungerPoints: 0,
        saturation: 0,
      }))

      yield* runtime.setDifficulty('hard')

      const outcome = yield* runtime.tick(DeltaTimeSecs(4))

      // If setDifficulty had not taken effect, 'peaceful' floors starvation
      // at 20 and this player would not take damage at all. Reaching 0 and
      // dying is only possible because the runtime is now on 'hard'.
      expect(outcome.vitals.healthPoints).toBe(0)
      expect(outcome.died).toBe(true)
      expect((yield* runtime.snapshot).difficulty).toBe('hard')
    }),
  )

  it('validates every difficulty, including the ones no other test decodes', () => {
    expect(isSurvivalHungerState(initial('normal'))).toBe(true)
    expect(isSurvivalHungerState(initial('hard'))).toBe(true)
    expect(isSurvivalHungerState({ ...initial('easy'), difficulty: 'nightmare' })).toBe(false)
  })

  it('rejects a save that is not even an object before looking at its fields', () => {
    expect(isSurvivalHungerState(null)).toBe(false)
    expect(isSurvivalHungerState('not an object')).toBe(false)
    expect(isSurvivalHungerState(42)).toBe(false)
  })

  it.effect('stops processing while dead and restores spawn vitals on respawn', () =>
    Effect.gen(function* () {
      const runtime = yield* makeSurvivalHungerRuntime(initial('hard', {
        healthPoints: 1,
        hungerPoints: 0,
        saturation: 0,
      }))
      expect((yield* runtime.tick(DeltaTimeSecs(4))).died).toBe(true)
      yield* runtime.submit({ _tag: 'sprint', distance: 10 })
      expect((yield* runtime.tick(DeltaTimeSecs(4))).exhaustionAdded).toBe(0)

      yield* runtime.respawn
      expect((yield* runtime.snapshot).vitals).toStrictEqual(SPAWN_PLAYER_VITALS)
      expect((yield* runtime.tick(DeltaTimeSecs(0))).exhaustionAdded).toBe(0)

      yield* runtime.reset
      expect((yield* runtime.snapshot).difficulty).toBe(DEFAULT_SURVIVAL_DIFFICULTY)
    }),
  )
})
