import { Effect } from 'effect'
import {
  makeVitalsService,
  SPAWN_VITALS,
  type Vitals as SimVitals,
  type VitalsView as SimVitalsView,
} from '@nerima-games/mc-sim'
import type { Damage } from './death-cause.js'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'

export type PlayerVitals = SimVitals

export type PlayerVitalsView = SimVitalsView

export const SPAWN_PLAYER_VITALS: PlayerVitals = SPAWN_VITALS

export const isValidPlayerVitals = (vitals: unknown): vitals is PlayerVitals => {
  if (!isRecord(vitals)) return false
  return typeof vitals['maxHealthPoints'] === 'number' && Number.isFinite(vitals['maxHealthPoints']) && vitals['maxHealthPoints'] > 0 &&
    typeof vitals['healthPoints'] === 'number' && Number.isFinite(vitals['healthPoints']) && vitals['healthPoints'] >= 0 && vitals['healthPoints'] <= vitals['maxHealthPoints'] &&
    typeof vitals['maxHungerPoints'] === 'number' && Number.isFinite(vitals['maxHungerPoints']) && vitals['maxHungerPoints'] >= 0 &&
    typeof vitals['hungerPoints'] === 'number' && Number.isFinite(vitals['hungerPoints']) && vitals['hungerPoints'] >= 0 && vitals['hungerPoints'] <= vitals['maxHungerPoints'] &&
    typeof vitals['saturation'] === 'number' && Number.isFinite(vitals['saturation']) && vitals['saturation'] >= 0 && vitals['saturation'] <= vitals['hungerPoints'] &&
    typeof vitals['exhaustion'] === 'number' && Number.isFinite(vitals['exhaustion']) && vitals['exhaustion'] >= 0 && vitals['exhaustion'] < 4 &&
    typeof vitals['foodTimerSecs'] === 'number' && Number.isFinite(vitals['foodTimerSecs']) && vitals['foodTimerSecs'] >= 0 && vitals['foodTimerSecs'] < 4 &&
    typeof vitals['totalExperience'] === 'number' && Number.isFinite(vitals['totalExperience']) && vitals['totalExperience'] >= 0 &&
    (vitals['lastDamageCause'] === undefined || typeof vitals['lastDamageCause'] === 'string')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export type VitalsDamageOutcome = {
  readonly vitals: PlayerVitals
  readonly died: boolean
}

export type PlayerFoodTickSignal = 'none' | 'regen' | 'starve'

export type FoodTimerOutcome = {
  readonly signal: PlayerFoodTickSignal
  readonly vitals: PlayerVitals
  readonly died: boolean
}

export type InMemoryVitalsApi = {
  readonly snapshot: Effect.Effect<PlayerVitals>
  readonly view: Effect.Effect<PlayerVitalsView>
  readonly damage: (damage: Damage) => Effect.Effect<VitalsDamageOutcome>
  readonly heal: (amount: number) => Effect.Effect<PlayerVitals>
  readonly addExhaustion: (amount: number) => Effect.Effect<void>
  readonly eat: (foodPoints: number, saturationModifier: number) => Effect.Effect<void>
  readonly advanceFoodTimer: (
    dt: DeltaTimeSecs,
    starvationHealthFloor?: number,
  ) => Effect.Effect<FoodTimerOutcome>
  readonly respawn: Effect.Effect<void>
  readonly restore: (vitals: PlayerVitals) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const isAlive = (vitals: PlayerVitals): boolean => vitals.healthPoints > 0

export const makeInMemoryVitals = (
  initial?: PlayerVitals,
): Effect.Effect<InMemoryVitalsApi> =>
  Effect.gen(function* () {
    const service = yield* makeVitalsService(initial)

    const whileAlive = (effect: Effect.Effect<void>): Effect.Effect<void> =>
      Effect.flatMap(service.snapshot, (vitals) => isAlive(vitals) ? effect : Effect.void)

    const advanceFoodTimer = (
      dt: DeltaTimeSecs,
      starvationHealthFloor = 0,
    ): Effect.Effect<FoodTimerOutcome> =>
      Effect.gen(function* () {
        const before = yield* service.snapshot
        if (!isAlive(before)) {
          return { signal: 'none', vitals: before, died: false }
        }

        const signal = yield* service.advanceFoodTimer(dt)
        if (signal === 'regen') {
          const vitals = yield* service.heal(1)
          return { signal, vitals, died: false }
        }
        if (signal === 'starve') {
          const damage = Math.min(1, Math.max(0, before.healthPoints - starvationHealthFloor))
          if (damage === 0) {
            return { signal, vitals: yield* service.snapshot, died: false }
          }
          const outcome = yield* service.damage({ amount: damage, cause: 'starvation' })
          return { signal, ...outcome }
        }

        return { signal, vitals: yield* service.snapshot, died: false }
      })

    return {
      snapshot: service.snapshot,
      view: service.view,
      damage: service.damage,
      heal: service.heal,
      addExhaustion: (amount) => whileAlive(service.addExhaustion(amount)),
      eat: (foodPoints, saturationModifier) => whileAlive(service.eat(foodPoints, saturationModifier)),
      advanceFoodTimer,
      respawn: service.respawn,
      restore: service.restore,
      reset: service.reset,
    }
  })
