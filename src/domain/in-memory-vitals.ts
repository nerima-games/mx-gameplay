import { Brand, Effect } from 'effect'
import {
  DamageAmount,
  DamageCause as SimDamageCause,
  ExhaustionAmount,
  HealthAmount,
  isValidVitals as isValidSimVitals,
  makeVitalsService,
  SaturationModifier,
  SPAWN_VITALS,
  type Vitals as SimVitals,
  type VitalsView as SimVitalsView,
} from '@nerima-games/mc-sim'
import type { Damage } from './death-cause.js'
import { FoodNutrition, type DeltaTimeSecs } from '@nerima-games/mc-kernel'

export type PlayerVitals = SimVitals

export type PlayerVitalsView = SimVitalsView

export const SPAWN_PLAYER_VITALS: PlayerVitals = SPAWN_VITALS

export const isValidPlayerVitals = (vitals: PlayerVitals): boolean =>
  isValidSimVitals(vitals)

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
  readonly damage: (damage: Damage) => Effect.Effect<VitalsDamageOutcome, Brand.BrandError>
  readonly heal: (amount: number) => Effect.Effect<PlayerVitals, Brand.BrandError>
  readonly addExhaustion: (amount: number) => Effect.Effect<void, Brand.BrandError>
  readonly eat: (foodPoints: number, saturationModifier: number) => Effect.Effect<void, Brand.BrandError>
  readonly advanceFoodTimer: (
    dt: DeltaTimeSecs,
    starvationHealthFloor?: number,
  ) => Effect.Effect<FoodTimerOutcome, Brand.BrandError>
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

    const whileAlive = (effect: Effect.Effect<void, Brand.BrandError>): Effect.Effect<void, Brand.BrandError> =>
      Effect.flatMap(service.snapshot, (vitals) => isAlive(vitals) ? effect : Effect.void)

    const damage = (input: Damage): Effect.Effect<VitalsDamageOutcome, Brand.BrandError> =>
      Effect.gen(function* () {
        const amount = yield* Effect.fromResult(DamageAmount.result(input.amount))
        const cause = yield* Effect.fromResult(SimDamageCause.result(input.cause))
        return yield* service.damage({ amount, cause })
      })

    const advanceFoodTimer = (
      dt: DeltaTimeSecs,
      starvationHealthFloor = 0,
    ): Effect.Effect<FoodTimerOutcome, Brand.BrandError> =>
      Effect.gen(function* () {
        const before = yield* service.snapshot
        if (!isAlive(before)) {
          return { signal: 'none', vitals: before, died: false }
        }

        const signal = yield* service.advanceFoodTimer(dt)
        if (signal === 'regen') {
          const amount = yield* Effect.fromResult(HealthAmount.result(1))
          const vitals = yield* service.heal(amount)
          return { signal, vitals, died: false }
        }
        if (signal === 'starve') {
          const damageAmount = Math.min(1, Math.max(0, before.healthPoints - starvationHealthFloor))
          if (damageAmount === 0) {
            return { signal, vitals: yield* service.snapshot, died: false }
          }
          const outcome = yield* damage({ amount: damageAmount, cause: 'starvation' })
          return { signal, ...outcome }
        }

        return { signal, vitals: yield* service.snapshot, died: false }
      })

    return {
      snapshot: service.snapshot,
      view: service.view,
      damage,
      heal: (amount) => Effect.flatMap(Effect.fromResult(HealthAmount.result(amount)), service.heal),
      addExhaustion: (amount) =>
        Effect.flatMap(Effect.fromResult(ExhaustionAmount.result(amount)), (value) =>
          whileAlive(service.addExhaustion(value)),
        ),
      eat: (foodPoints, saturationModifier) =>
        Effect.gen(function* () {
          const nutrition = yield* Effect.fromResult(FoodNutrition.result(foodPoints))
          const saturation = yield* Effect.fromResult(SaturationModifier.result(saturationModifier))
          yield* whileAlive(service.eat(nutrition, saturation))
        }),
      advanceFoodTimer,
      respawn: service.respawn,
      restore: service.restore,
      reset: service.reset,
    }
  })
