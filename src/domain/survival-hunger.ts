import { Effect, Ref } from 'effect'
import type { Damage } from './death-cause'
import { DeltaTimeSecs } from './frame-contract'
import {
  SPAWN_PLAYER_VITALS,
  isValidPlayerVitals,
  makeInMemoryVitals,
  type InMemoryVitalsApi,
  type PlayerVitals,
  type VitalsDamageOutcome,
} from './in-memory-vitals'

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
  readonly addExhaustion: (amount: number) => Effect.Effect<void>
  readonly tick: (dt: DeltaTimeSecs) => Effect.Effect<SurvivalHungerTickOutcome>
  readonly eat: (foodPoints: number, saturationModifier: number) => Effect.Effect<PlayerVitals>
  readonly damage: (damage: Damage) => Effect.Effect<VitalsDamageOutcome>
  readonly heal: (amount: number) => Effect.Effect<PlayerVitals>
  readonly setDifficulty: (difficulty: SurvivalDifficulty) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<SurvivalHungerState>
  readonly restore: (state: SurvivalHungerState) => Effect.Effect<void>
  readonly respawn: Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0

export const exhaustionForSurvivalActivity = (input: SurvivalActivityInput): number => {
  switch (input._tag) {
    case 'walk':
      return finiteNonNegative(input.distance) * SURVIVAL_EXHAUSTION.walkPerBlock
    case 'sprint':
      return finiteNonNegative(input.distance) * SURVIVAL_EXHAUSTION.sprintPerBlock
    case 'jump':
      return finiteNonNegative(input.count) *
        (input.sprinting ? SURVIVAL_EXHAUSTION.sprintJump : SURVIVAL_EXHAUSTION.jump)
    case 'swim':
      return finiteNonNegative(input.distance) * SURVIVAL_EXHAUSTION.swimPerBlock
    case 'mine':
      return finiteNonNegative(input.blocks) * SURVIVAL_EXHAUSTION.minePerBlock
    case 'attack':
      return finiteNonNegative(input.count) * SURVIVAL_EXHAUSTION.attack
  }
}

export const starvationHealthFloor = (difficulty: SurvivalDifficulty): number => {
  switch (difficulty) {
    case 'peaceful':
      return 20
    case 'easy':
      return 10
    case 'normal':
      return 1
    case 'hard':
      return 0
  }
}

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
}> =>
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
      const outcome = yield* vitals.advanceFoodTimer(
        DeltaTimeSecs(slice),
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

    const tick = (dt: DeltaTimeSecs): Effect.Effect<SurvivalHungerTickOutcome> =>
      Effect.gen(function* () {
        const currentDifficulty = yield* Ref.get(difficulty)
        const inputs = yield* Ref.getAndSet(pending, [])
        const before = yield* vitals.snapshot
        const exhaustionAdded = currentDifficulty === 'peaceful' || before.healthPoints <= 0
          ? 0
          : inputs.reduce((total, input) => total + exhaustionForSurvivalActivity(input), 0)

        if (exhaustionAdded > 0) yield* vitals.addExhaustion(exhaustionAdded)
        const food = yield* runFoodTicks(vitals, currentDifficulty, dt)
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
        Effect.zipRight(vitals.eat(foodPoints, saturationModifier), vitals.snapshot),
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
      respawn: Effect.zipRight(Ref.set(pending, []), vitals.respawn),
      reset: Effect.gen(function* () {
        yield* Ref.set(pending, [])
        yield* Ref.set(difficulty, DEFAULT_SURVIVAL_DIFFICULTY)
        yield* vitals.reset
      }),
    }
  })
