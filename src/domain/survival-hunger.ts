import { Brand, Effect, Ref, Schema } from 'effect'
import type { Damage } from './death-cause.js'
import { DeltaTimeSecs, FoodNutrition } from '@nerima-games/mc-kernel'
import {
  DamageAmount,
  DamageCause as SimDamageCause,
  ExhaustionAmount,
  HealthAmount,
  SaturationModifier,
  addExhaustion as addVitalsExhaustion,
  advanceFoodTimer as advanceVitalsFoodTimer,
  applyDamage as applyVitalsDamage,
  eat as eatVitals,
  heal as healVitals,
  respawn as respawnVitals,
} from '@nerima-games/mc-sim'
import {
  SPAWN_PLAYER_VITALS,
  isValidPlayerVitals,
  makeInMemoryVitals,
  type InMemoryVitalsApi,
  type PlayerVitals,
  type VitalsDamageOutcome,
} from './in-memory-vitals.js'
import {
  ExperienceOrbVitalsOwnerSnapshotSchema,
} from './entities/xp-orb.js'
import type {
  ReplicatedOwnerId,
  WorldCommitCoordinatorApi,
  WorldCommitCoordinatorError,
} from '@nerima-games/mc-sim'

export const SURVIVAL_HUNGER_STATE_VERSION = 1 as const
export const DEFAULT_SURVIVAL_DIFFICULTY = 'normal' as const

export type SurvivalDifficulty = 'peaceful' | 'easy' | 'normal' | 'hard'

export type SurvivalActivityInput =
  | { readonly _tag: 'walk'; readonly distance: number }
  | { readonly _tag: 'sprint'; readonly distance: number }
  | { readonly _tag: 'jump'; readonly count: number; readonly sprinting?: boolean }
  | { readonly _tag: 'swim'; readonly distance: number }
  | { readonly _tag: 'mine'; readonly blocks: number }
  | { readonly _tag: 'attack'; readonly count: number }

type QueuedSurvivalActivity = {
  readonly sequence: number
  readonly input: SurvivalActivityInput
}

type PendingSurvivalActivities = {
  readonly nextSequence: number
  readonly queue: ReadonlyArray<QueuedSurvivalActivity>
}

export const SURVIVAL_EXHAUSTION = {
  walkPerBlock: 0.01,
  sprintPerBlock: 0.1,
  jump: 0.05,
  sprintJump: 0.2,
  swimPerBlock: 0.01,
  minePerBlock: 0.005,
  attack: 0.1,
} as const

export type SurvivalHungerStateV1 = {
  readonly version: typeof SURVIVAL_HUNGER_STATE_VERSION
  readonly difficulty: SurvivalDifficulty
  readonly vitals: PlayerVitals
}

export type SurvivalHungerState = SurvivalHungerStateV1

export type SurvivalHungerTickOutcome = {
  readonly difficulty: SurvivalDifficulty
  readonly exhaustionAdded: number
  readonly foodTicks: number
  readonly regeneratedHealth: number
  readonly starvationDamage: number
  readonly died: boolean
  readonly vitals: PlayerVitals
}

export type SurvivalHungerRuntimeApi = {
  readonly submit: (input: SurvivalActivityInput) => Effect.Effect<void>
  readonly addExhaustion: (amount: number) => Effect.Effect<void, SurvivalHungerError>
  readonly tick: (dt: DeltaTimeSecs) => Effect.Effect<SurvivalHungerTickOutcome, SurvivalHungerError>
  readonly eat: (foodPoints: number, saturationModifier: number) => Effect.Effect<PlayerVitals, SurvivalHungerError>
  readonly damage: (damage: Damage) => Effect.Effect<VitalsDamageOutcome, SurvivalHungerError>
  readonly heal: (amount: number) => Effect.Effect<PlayerVitals, SurvivalHungerError>
  readonly setDifficulty: (difficulty: SurvivalDifficulty) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<SurvivalHungerState, SurvivalHungerError>
  readonly restore: (state: SurvivalHungerState) => Effect.Effect<void, SurvivalHungerError>
  readonly respawn: Effect.Effect<void, SurvivalHungerError>
  readonly reset: Effect.Effect<void, SurvivalHungerError>
}

export type SurvivalHungerError =
  | Brand.BrandError
  | Schema.SchemaError
  | WorldCommitCoordinatorError

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0

export const exhaustionForSurvivalActivity = (input: SurvivalActivityInput): number => {
  if (input._tag === 'walk') return finiteNonNegative(input.distance) * SURVIVAL_EXHAUSTION.walkPerBlock
  if (input._tag === 'sprint') return finiteNonNegative(input.distance) * SURVIVAL_EXHAUSTION.sprintPerBlock
  if (input._tag === 'jump') {
    return finiteNonNegative(input.count) *
      (input.sprinting ? SURVIVAL_EXHAUSTION.sprintJump : SURVIVAL_EXHAUSTION.jump)
  }
  if (input._tag === 'swim') return finiteNonNegative(input.distance) * SURVIVAL_EXHAUSTION.swimPerBlock
  if (input._tag === 'mine') return finiteNonNegative(input.blocks) * SURVIVAL_EXHAUSTION.minePerBlock
  return finiteNonNegative(input.count) * SURVIVAL_EXHAUSTION.attack
}

const STARVATION_HEALTH_FLOOR: Readonly<Record<SurvivalDifficulty, number>> = {
  peaceful: 20,
  easy: 10,
  normal: 1,
  hard: 0,
}

export const starvationHealthFloor = (difficulty: SurvivalDifficulty): number =>
  STARVATION_HEALTH_FLOOR[difficulty]

const isDifficulty = (value: unknown): value is SurvivalDifficulty =>
  value === 'peaceful' || value === 'easy' || value === 'normal' || value === 'hard'

export const isSurvivalHungerState = (value: unknown): value is SurvivalHungerState => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SurvivalHungerState>
  return candidate.version === SURVIVAL_HUNGER_STATE_VERSION &&
    isDifficulty(candidate.difficulty) &&
    candidate.vitals !== undefined &&
    isValidPlayerVitals(candidate.vitals)
}

const runFoodTicks = (
  vitals: InMemoryVitalsApi,
  difficulty: SurvivalDifficulty,
  dt: DeltaTimeSecs,
): Effect.Effect<{
  readonly foodTicks: number
  readonly regeneratedHealth: number
  readonly starvationDamage: number
  readonly died: boolean
}, Brand.BrandError> =>
  Effect.gen(function* () {
    let remaining = dt as number
    let foodTicks = 0
    let regeneratedHealth = 0
    let starvationDamage = 0
    let died = false

    while (remaining > 0) {
      const before = yield* vitals.snapshot
      if (before.healthPoints <= 0) break

      const untilFoodTick = 4 - before.foodTimerSecs
      const slice = Math.min(remaining, untilFoodTick)
      const elapsed = yield* Effect.fromResult(DeltaTimeSecs.result(slice))
      const outcome = yield* vitals.advanceFoodTimer(
        elapsed,
        starvationHealthFloor(difficulty),
      )
      remaining -= slice
      if (slice === untilFoodTick) foodTicks += 1

      if (outcome.signal === 'regen') {
        regeneratedHealth += outcome.vitals.healthPoints - before.healthPoints
      } else if (outcome.signal === 'starve') {
        starvationDamage += before.healthPoints - outcome.vitals.healthPoints
        died ||= outcome.died
      }
    }

    return { foodTicks, regeneratedHealth, starvationDamage, died }
  })

export const makeSurvivalHungerRuntime = (
  initial: SurvivalHungerState = {
    version: SURVIVAL_HUNGER_STATE_VERSION,
    difficulty: DEFAULT_SURVIVAL_DIFFICULTY,
    vitals: SPAWN_PLAYER_VITALS,
  },
): Effect.Effect<SurvivalHungerRuntimeApi> =>
  Effect.gen(function* () {
    const vitals = yield* makeInMemoryVitals(initial.vitals)
    const difficulty = yield* Ref.make<SurvivalDifficulty>(initial.difficulty)
    const pending = yield* Ref.make<ReadonlyArray<SurvivalActivityInput>>([])

    const tick = (dt: DeltaTimeSecs): Effect.Effect<SurvivalHungerTickOutcome, Brand.BrandError> =>
      Effect.gen(function* () {
        const elapsed = yield* Effect.fromResult(DeltaTimeSecs.result(dt))
        const currentDifficulty = yield* Ref.get(difficulty)
        const inputs = yield* Ref.getAndSet(pending, [])
        const before = yield* vitals.snapshot
        const exhaustionAdded = currentDifficulty === 'peaceful' || before.healthPoints <= 0
          ? 0
          : inputs.reduce((total, input) => total + exhaustionForSurvivalActivity(input), 0)

        if (exhaustionAdded > 0) yield* vitals.addExhaustion(exhaustionAdded)
        const food = yield* runFoodTicks(vitals, currentDifficulty, elapsed)
        const snapshot = yield* vitals.snapshot

        return {
          difficulty: currentDifficulty,
          exhaustionAdded,
          ...food,
          vitals: snapshot,
        }
      })

    return {
      submit: (input) => Ref.update(pending, (inputs) => [...inputs, input]),
      addExhaustion: (amount) => vitals.addExhaustion(amount),
      tick,
      eat: (foodPoints, saturationModifier) =>
        Effect.andThen(vitals.eat(foodPoints, saturationModifier), vitals.snapshot),
      damage: (damage) => vitals.damage(damage),
      heal: (amount) => vitals.heal(amount),
      setDifficulty: (next) => Ref.set(difficulty, next),
      snapshot: Effect.gen(function* () {
        return {
          version: SURVIVAL_HUNGER_STATE_VERSION,
          difficulty: yield* Ref.get(difficulty),
          vitals: yield* vitals.snapshot,
        }
      }),
      restore: (state) =>
        Effect.gen(function* () {
          yield* Ref.set(pending, [])
          yield* Ref.set(difficulty, state.difficulty)
          yield* vitals.restore(state.vitals)
        }),
      respawn: Effect.andThen(Ref.set(pending, []), vitals.respawn),
      reset: Effect.gen(function* () {
        yield* Ref.set(pending, [])
        yield* Ref.set(difficulty, DEFAULT_SURVIVAL_DIFFICULTY)
        yield* vitals.reset
      }),
    }
  })

/** Build the gameplay runtime against the registered WCC vitals owner. */
export const makeReplicatedSurvivalHungerRuntime = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
  initialDifficulty: SurvivalDifficulty = DEFAULT_SURVIVAL_DIFFICULTY,
): Effect.Effect<SurvivalHungerRuntimeApi> =>
  Effect.gen(function* () {
    const difficulty = yield* Ref.make<SurvivalDifficulty>(initialDifficulty)
    const pending = yield* Ref.make<PendingSurvivalActivities>({ nextSequence: 0, queue: [] })

    const transact = <A>(
      operation: (vitals: PlayerVitals) => Effect.Effect<Readonly<{ vitals: PlayerVitals; result: A }>, Brand.BrandError>,
    ): Effect.Effect<A, SurvivalHungerError> =>
      Effect.gen(function* () {
        const observed = yield* coordinator.snapshot(ownerId, ExperienceOrbVitalsOwnerSnapshotSchema)
        const planned = yield* operation(observed.state.vitals)
        const candidate = yield* Schema.decodeUnknownEffect(ExperienceOrbVitalsOwnerSnapshotSchema)({
          vitals: planned.vitals,
        })
        yield* coordinator.commit({
          expectedRevision: observed.revision,
          expectedDimensions: [],
          changes: [{ ownerId, state: candidate }],
        })
        return planned.result
      })

    const simulateFoodTicks = (
      initial: PlayerVitals,
      currentDifficulty: SurvivalDifficulty,
      dt: DeltaTimeSecs,
    ): Effect.Effect<Readonly<{
      vitals: PlayerVitals
      foodTicks: number
      regeneratedHealth: number
      starvationDamage: number
      died: boolean
    }>, Brand.BrandError> => Effect.gen(function* () {
      let vitals = initial
      let remaining = dt as number
      let foodTicks = 0
      let regeneratedHealth = 0
      let starvationDamage = 0
      let died = false

      while (remaining > 0 && vitals.healthPoints > 0) {
        const untilFoodTick = 4 - vitals.foodTimerSecs
        const slice = Math.min(remaining, untilFoodTick)
        const elapsed = yield* Effect.fromResult(DeltaTimeSecs.result(slice))
        const [signal, ticked] = advanceVitalsFoodTimer(vitals, elapsed)
        vitals = ticked
        remaining -= slice
        if (slice === untilFoodTick) foodTicks += 1

        if (signal === 'regen') {
          const amount = yield* Effect.fromResult(HealthAmount.result(1))
          const before = vitals.healthPoints
          vitals = healVitals(vitals, amount)
          regeneratedHealth += vitals.healthPoints - before
        } else if (signal === 'starve') {
          const damageAmount = Math.min(1, Math.max(0, vitals.healthPoints - starvationHealthFloor(currentDifficulty)))
          starvationDamage += damageAmount
          if (damageAmount > 0) {
            const amount = yield* Effect.fromResult(DamageAmount.result(damageAmount))
            const cause = yield* Effect.fromResult(SimDamageCause.result('starvation'))
            const before = vitals.healthPoints
            vitals = applyVitalsDamage(vitals, { amount, cause })
            died ||= before > 0 && vitals.healthPoints <= 0
          }
        }
      }

      return { vitals, foodTicks, regeneratedHealth, starvationDamage, died }
    })

    const tick = (dt: DeltaTimeSecs): Effect.Effect<SurvivalHungerTickOutcome, SurvivalHungerError> =>
      Effect.gen(function* () {
        const elapsed = yield* Effect.fromResult(DeltaTimeSecs.result(dt))
        const currentDifficulty = yield* Ref.get(difficulty)
        const batch = (yield* Ref.get(pending)).queue
        const activities = batch.map((entry) => entry.input)
        const outcome = yield* transact((before) => Effect.gen(function* () {
          const exhaustionAdded = currentDifficulty === 'peaceful' || before.healthPoints <= 0
            ? 0
            : activities.reduce((total, input) => total + exhaustionForSurvivalActivity(input), 0)
          const exhausted = exhaustionAdded > 0
            ? addVitalsExhaustion(
                before,
                yield* Effect.fromResult(ExhaustionAmount.result(exhaustionAdded)),
              )
            : before
          const food = yield* simulateFoodTicks(exhausted, currentDifficulty, elapsed)
          return {
            vitals: food.vitals,
            result: {
              difficulty: currentDifficulty,
              exhaustionAdded,
              foodTicks: food.foodTicks,
              regeneratedHealth: food.regeneratedHealth,
              starvationDamage: food.starvationDamage,
              died: food.died,
              vitals: food.vitals,
            },
          }
        }))
        const completedSequences = new Set(batch.map((entry) => entry.sequence))
        yield* Ref.update(pending, (current) => ({
          ...current,
          queue: current.queue.filter((entry) => !completedSequences.has(entry.sequence)),
        }))
        return outcome
      })

    const clearPending = Ref.update(pending, (current) => ({ ...current, queue: [] }))

    return {
      submit: (input) => Ref.update(pending, (current) => ({
        nextSequence: current.nextSequence + 1,
        queue: [...current.queue, { sequence: current.nextSequence, input }],
      })),
      addExhaustion: (amount) => transact((vitals) => Effect.gen(function* () {
        const exhaustion = yield* Effect.fromResult(ExhaustionAmount.result(amount))
        const candidate = vitals.healthPoints > 0 ? addVitalsExhaustion(vitals, exhaustion) : vitals
        return { vitals: candidate, result: undefined }
      })),
      tick,
      eat: (foodPoints, saturationModifier) =>
        transact((vitals) => Effect.gen(function* () {
          const food = yield* Effect.fromResult(FoodNutrition.result(foodPoints))
          const saturation = yield* Effect.fromResult(SaturationModifier.result(saturationModifier))
          const candidate = vitals.healthPoints > 0 ? eatVitals(vitals, food, saturation) : vitals
          return { vitals: candidate, result: candidate }
        })),
      damage: (damage) => transact((vitals) => Effect.gen(function* () {
        const amount = yield* Effect.fromResult(DamageAmount.result(damage.amount))
        const cause = yield* Effect.fromResult(SimDamageCause.result(damage.cause))
        const candidate = applyVitalsDamage(vitals, { amount, cause })
        return {
          vitals: candidate,
          result: { vitals: candidate, died: vitals.healthPoints > 0 && candidate.healthPoints <= 0 },
        }
      })),
      heal: (amount) => transact((vitals) => Effect.gen(function* () {
        const health = yield* Effect.fromResult(HealthAmount.result(amount))
        const candidate = healVitals(vitals, health)
        return { vitals: candidate, result: candidate }
      })),
      setDifficulty: (next) => Ref.set(difficulty, next),
      snapshot: Effect.gen(function* () {
        const current = yield* coordinator.snapshot(ownerId, ExperienceOrbVitalsOwnerSnapshotSchema)
        return {
          version: SURVIVAL_HUNGER_STATE_VERSION,
          difficulty: yield* Ref.get(difficulty),
          vitals: current.state.vitals,
        }
      }),
      restore: (state) =>
        Effect.gen(function* () {
          yield* clearPending
          yield* Ref.set(difficulty, state.difficulty)
          yield* transact(() => Effect.succeed({ vitals: state.vitals, result: undefined }))
        }),
      respawn: Effect.andThen(clearPending, transact((vitals) => {
        const candidate = respawnVitals(vitals)
        return Effect.succeed({ vitals: candidate, result: undefined })
      })),
      reset: Effect.gen(function* () {
        yield* clearPending
        yield* Ref.set(difficulty, DEFAULT_SURVIVAL_DIFFICULTY)
        yield* transact(() => Effect.succeed({ vitals: SPAWN_PLAYER_VITALS, result: undefined }))
      }),
    }
  })
