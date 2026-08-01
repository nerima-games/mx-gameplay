import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DeltaTimeSecs } from '../src/domain/frame-contract'
import { makeInMemoryVitals, type PlayerVitals } from '../src/domain/in-memory-vitals'
import { makeGeneratedWorld } from '../src/domain/in-memory-world'
import { isValidPlayerVitals, SPAWN_PLAYER_VITALS } from '../src/index'

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

describe('in-memory vitals facade', () => {
  it.effect('publishes the spawn value and persisted-state validator through the facade', () =>
    Effect.gen(function* () {
      const service = yield* makeInMemoryVitals()

      expect(yield* service.snapshot).toStrictEqual(SPAWN_PLAYER_VITALS)
      expect(isValidPlayerVitals(SPAWN_PLAYER_VITALS)).toBe(true)
      expect(isValidPlayerVitals(vitals({ healthPoints: 7, hungerPoints: 12 }))).toBe(true)
      expect(isValidPlayerVitals(vitals({ healthPoints: 21 }))).toBe(false)
      expect(isValidPlayerVitals(vitals({ saturation: 6, hungerPoints: 5 }))).toBe(false)
      expect(isValidPlayerVitals(vitals({ foodTimerSecs: 4 }))).toBe(false)
    }),
  )

  it.effect('is exposed by generated worlds with optional initial state', () =>
    Effect.gen(function* () {
      const initial = vitals({ healthPoints: 12, hungerPoints: 8, totalExperience: 17 })
      const world = yield* makeGeneratedWorld({ seed: 123, vitals: initial })

      expect(yield* world.vitals.snapshot).toStrictEqual(initial)
      expect(yield* world.vitals.view).toMatchObject({
        healthPoints: 12,
        hungerPoints: 8,
      })
    }),
  )

  it.effect('turns food timer signals into healing and starvation damage', () =>
    Effect.gen(function* () {
      const regenerating = yield* makeInMemoryVitals(vitals({ healthPoints: 19, foodTimerSecs: 3.5 }))
      const regeneration = yield* regenerating.advanceFoodTimer(DeltaTimeSecs(0.5))

      expect(regeneration).toMatchObject({
        signal: 'regen',
        died: false,
        vitals: { healthPoints: 20, foodTimerSecs: 0 },
      })

      const starving = yield* makeInMemoryVitals(vitals({
        healthPoints: 1,
        hungerPoints: 0,
        saturation: 0,
        foodTimerSecs: 3.5,
      }))
      const starvation = yield* starving.advanceFoodTimer(DeltaTimeSecs(0.5))

      expect(starvation).toMatchObject({
        signal: 'starve',
        died: true,
        vitals: { healthPoints: 0, lastDamageCause: 'starvation', foodTimerSecs: 0 },
      })
    }),
  )

  it.effect('blocks survival updates while dead but permits lifecycle operations', () =>
    Effect.gen(function* () {
      const dead = vitals({
        healthPoints: 0,
        hungerPoints: 0,
        saturation: 0,
        lastDamageCause: 'fall',
      })
      const service = yield* makeInMemoryVitals(dead)

      yield* service.addExhaustion(10)
      yield* service.eat(8, 0.6)
      const tick = yield* service.advanceFoodTimer(DeltaTimeSecs(4))
      expect(tick).toStrictEqual({ signal: 'none', vitals: dead, died: false })
      expect(yield* service.heal(5)).toStrictEqual(dead)

      yield* service.respawn
      expect(yield* service.snapshot).toMatchObject({
        healthPoints: 20,
        hungerPoints: 20,
        totalExperience: 0,
        lastDamageCause: undefined,
      })

      const restored = vitals({ healthPoints: 7, totalExperience: 30 })
      yield* service.restore(restored)
      expect(yield* service.snapshot).toStrictEqual(restored)

      yield* service.reset
      expect(yield* service.snapshot).toMatchObject({
        healthPoints: 20,
        hungerPoints: 20,
        totalExperience: 0,
      })
    }),
  )
})
