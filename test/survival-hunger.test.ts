import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  DeltaTimeSecs,
  EntityHealthPoints,
  FoodSaturation,
  type DeltaTimeSecs as DeltaTimeSecsValue,
  WorldId,
} from '@nerima-games/mc-kernel'
import {
  ExhaustionAmount,
  FoodTimerSecs,
  HungerPoints,
  makeReplicatedOwnerId,
  makeWorldCommitCoordinator,
  TotalExperience,
  VitalsSchema,
} from '@nerima-games/mc-sim'
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
  makeReplicatedSurvivalHungerRuntime,
  starvationHealthFloor,
  type SurvivalDifficulty,
} from '../src/domain/survival-hunger'
import {
  ExperienceOrbVitalsOwnerSnapshotSchema,
  vitalsOwnerRegistration,
} from '../src/domain/entities/xp-orb'

const vitals = (overrides: Partial<PlayerVitals> = {}): PlayerVitals => ({
  healthPoints: EntityHealthPoints(20),
  maxHealthPoints: EntityHealthPoints(20),
  hungerPoints: HungerPoints(20),
  maxHungerPoints: HungerPoints(20),
  saturation: FoodSaturation(5),
  exhaustion: ExhaustionAmount(0),
  foodTimerSecs: FoodTimerSecs(0),
  totalExperience: TotalExperience(0),
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

const numericInputs = FastCheck.oneof(
  FastCheck.double({ min: -Number.MAX_VALUE, max: Number.MAX_VALUE }),
  FastCheck.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
)

const isNonNegativeFinite = (values: ReadonlyArray<number>): boolean =>
  values.every((value) => Number.isFinite(value) && value >= 0)

// The published `Schema<T>` type erases the pure decoder's services to `unknown`.
const decodeVitals = Schema.decodeUnknownResult(
  VitalsSchema as unknown as Schema.ConstraintDecoder<PlayerVitals>,
)

const REPLICATED_VITALS_OWNER = makeReplicatedOwnerId('survival-hunger-test-vitals')

const makeReplicatedRuntime = (
  playerVitals: PlayerVitals = SPAWN_PLAYER_VITALS,
  difficulty: SurvivalDifficulty = DEFAULT_SURVIVAL_DIFFICULTY,
) =>
  Effect.gen(function* () {
    const coordinator = yield* makeWorldCommitCoordinator({
      world: WorldId('survival-hunger-test-world'),
      owners: [vitalsOwnerRegistration(REPLICATED_VITALS_OWNER, { vitals: playerVitals })],
    })
    const runtime = yield* makeReplicatedSurvivalHungerRuntime(
      coordinator,
      REPLICATED_VITALS_OWNER,
      difficulty,
    )
    return { coordinator, runtime }
  })

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
      const runtime = yield* makeSurvivalHungerRuntime(initial('normal', { saturation: FoodSaturation(1) }))
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

  it.effect('adds explicit exhaustion directly and propagates vitals validation failures', () =>
    Effect.gen(function* () {
      const runtime = yield* makeSurvivalHungerRuntime(initial('peaceful', { saturation: FoodSaturation(2) }))

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

      // Exercise runtime validation with a malformed value crossing the branded type boundary.
      const invalidTickDuration = Number.NaN as DeltaTimeSecsValue
      const validationErrors = [
        yield* Effect.flip(runtime.addExhaustion(Number.NaN)),
        yield* Effect.flip(runtime.addExhaustion(Number.NEGATIVE_INFINITY)),
        yield* Effect.flip(runtime.addExhaustion(Number.POSITIVE_INFINITY)),
        yield* Effect.flip(runtime.eat(Number.NaN, 0)),
        yield* Effect.flip(runtime.damage({ amount: Number.NaN, cause: 'fall' })),
        yield* Effect.flip(runtime.heal(Number.NaN)),
        yield* Effect.flip(runtime.tick(invalidTickDuration)),
      ]
      expect(validationErrors.map((error) => error._tag)).toEqual([
        'BrandError',
        'BrandError',
        'BrandError',
        'BrandError',
        'BrandError',
        'BrandError',
        'BrandError',
      ])
      expect((yield* runtime.snapshot).vitals).toMatchObject({
        hungerPoints: 19,
        saturation: 0,
        exhaustion: 0.5,
      })
    }))

  it.effect('regenerates health, adds exhaustion, and counts every elapsed food tick', () =>
    Effect.gen(function* () {
      const runtime = yield* makeSurvivalHungerRuntime(initial('normal', {
        healthPoints: EntityHealthPoints(19),
        saturation: FoodSaturation(0),
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
          healthPoints: EntityHealthPoints(healthPoints),
          hungerPoints: HungerPoints(0),
          saturation: FoodSaturation(0),
        }))
        const outcome = yield* runtime.tick(DeltaTimeSecs(4))
        expect(outcome.vitals.healthPoints).toBe(expected)
        expect(outcome.died).toBe(difficulty === 'hard')
      }
    }),
  )

  it.effect('partitions long frames identically to consecutive food ticks', () =>
    Effect.gen(function* () {
      const state = initial('hard', {
        healthPoints: EntityHealthPoints(3),
        hungerPoints: HungerPoints(0),
        saturation: FoodSaturation(0),
      })
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
      const source = yield* makeSurvivalHungerRuntime(initial('easy', { hungerPoints: HungerPoints(12) }))
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
        healthPoints: EntityHealthPoints(10),
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
        healthPoints: EntityHealthPoints(1),
        hungerPoints: HungerPoints(0),
        saturation: FoodSaturation(0),
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
        healthPoints: EntityHealthPoints(1),
        hungerPoints: HungerPoints(0),
        saturation: FoodSaturation(0),
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

  it.effect('property: invalid exhaustion updates fail without changing decoded vitals', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(numericInputs, (amount) => {
          const runtime = Effect.runSync(makeSurvivalHungerRuntime(initial('hard')))
          const before = Effect.runSync(runtime.snapshot)
          const update = Effect.runSync(Effect.result(runtime.addExhaustion(amount)))
          const after = Effect.runSync(runtime.snapshot)
          const decoded = decodeVitals(after.vitals)

          if (Result.isFailure(update)) {
            return update.failure._tag === 'BrandError' &&
              JSON.stringify(after) === JSON.stringify(before) &&
              Result.isSuccess(decoded)
          }

          return Result.isSuccess(decoded) &&
            isNonNegativeFinite([
              decoded.success.exhaustion,
              decoded.success.hungerPoints,
              decoded.success.saturation,
            ])
        }),
        { numRuns: 200 },
      )
    }),
  )

  it.effect('property: hunger damage and resulting vitals stay finite and non-negative', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.double({ min: 0, max: 10_000 }), (rawDelta) => {
          const delta = DeltaTimeSecs.result(rawDelta)
          if (Result.isFailure(delta)) return delta.failure._tag === 'BrandError'

          const runtime = Effect.runSync(makeSurvivalHungerRuntime(initial('hard', {
            hungerPoints: HungerPoints(0),
            saturation: FoodSaturation(0),
          })))
          const outcome = Effect.runSync(runtime.tick(delta.success))
          const decoded = decodeVitals(outcome.vitals)

          return Result.isSuccess(decoded) &&
            isNonNegativeFinite([
              outcome.starvationDamage,
              outcome.exhaustionAdded,
              outcome.regeneratedHealth,
              decoded.success.healthPoints,
              decoded.success.hungerPoints,
              decoded.success.saturation,
            ])
        }),
        { numRuns: 100 },
      )
    }),
  )

  it.effect('replicated food ticks regenerate, starve, respect floors, and stop when dead', () =>
    Effect.gen(function* () {
      const regen = yield* makeReplicatedRuntime(vitals({
        healthPoints: EntityHealthPoints(19),
        saturation: FoodSaturation(0),
      }))
      yield* regen.runtime.submit({ _tag: 'walk', distance: 1 })
      const regeneration = yield* regen.runtime.tick(DeltaTimeSecs(4))
      expect(regeneration).toMatchObject({
        difficulty: 'normal',
        exhaustionAdded: 0.01,
        foodTicks: 1,
        regeneratedHealth: 1,
        starvationDamage: 0,
        died: false,
        vitals: { healthPoints: 20, hungerPoints: 19, exhaustion: 2.01 },
      })
      const regeneratedOwner = yield* regen.coordinator.snapshot(
        REPLICATED_VITALS_OWNER,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      expect(regeneratedOwner.state.vitals).toStrictEqual(regeneration.vitals)
      expect((yield* regen.runtime.tick(DeltaTimeSecs(0))).foodTicks).toBe(0)

      const starved = yield* makeReplicatedRuntime(vitals({
        healthPoints: EntityHealthPoints(1),
        hungerPoints: HungerPoints(0),
        saturation: FoodSaturation(0),
      }), 'hard')
      const starvation = yield* starved.runtime.tick(DeltaTimeSecs(8))
      expect(starvation).toMatchObject({
        difficulty: 'hard',
        foodTicks: 1,
        regeneratedHealth: 0,
        starvationDamage: 1,
        died: true,
        vitals: { healthPoints: 0, lastDamageCause: 'starvation' },
      })
      expect((yield* starved.coordinator.snapshot(
        REPLICATED_VITALS_OWNER,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )).state.vitals).toStrictEqual(starvation.vitals)

      const floor = yield* makeReplicatedRuntime(vitals({
        healthPoints: EntityHealthPoints(10),
        hungerPoints: HungerPoints(0),
        saturation: FoodSaturation(0),
      }), 'easy')
      const floorTick = yield* floor.runtime.tick(DeltaTimeSecs(4))
      expect(floorTick).toMatchObject({
        difficulty: 'easy',
        foodTicks: 1,
        starvationDamage: 0,
        died: false,
        vitals: { healthPoints: 10, hungerPoints: 0 },
      })

      const dead = yield* makeReplicatedRuntime(vitals({
        healthPoints: EntityHealthPoints(0),
        hungerPoints: HungerPoints(0),
        saturation: FoodSaturation(0),
      }), 'hard')
      yield* dead.runtime.submit({ _tag: 'sprint', distance: 10 })
      const deadTick = yield* dead.runtime.tick(DeltaTimeSecs(4))
      expect(deadTick).toMatchObject({
        exhaustionAdded: 0,
        foodTicks: 0,
        regeneratedHealth: 0,
        starvationDamage: 0,
        died: false,
        vitals: { healthPoints: 0 },
      })
    }),
  )

  it.effect('replicated mutations commit owner vitals and do not revive a dead player', () =>
    Effect.gen(function* () {
      const { coordinator, runtime } = yield* makeReplicatedRuntime(vitals({
        healthPoints: EntityHealthPoints(10),
        hungerPoints: HungerPoints(19),
        saturation: FoodSaturation(0),
      }))

      yield* runtime.addExhaustion(0.25)
      expect((yield* runtime.snapshot).vitals.exhaustion).toBe(0.25)
      expect(yield* runtime.eat(1, 0.6)).toMatchObject({
        hungerPoints: 20,
        saturation: 1.2,
      })
      expect(yield* runtime.damage({ amount: 3, cause: 'fall' })).toMatchObject({
        died: false,
        vitals: { healthPoints: 7, lastDamageCause: undefined },
      })
      expect(yield* runtime.heal(2)).toMatchObject({
        healthPoints: 9,
        lastDamageCause: undefined,
      })
      expect(yield* runtime.damage({ amount: 20, cause: 'explosion' })).toMatchObject({
        died: true,
        vitals: { healthPoints: 0, lastDamageCause: 'explosion' },
      })

      const deadBefore = yield* runtime.snapshot
      yield* runtime.addExhaustion(4)
      expect(yield* runtime.eat(4, 0.8)).toStrictEqual(deadBefore.vitals)
      expect(yield* runtime.heal(5)).toMatchObject({
        healthPoints: 0,
        lastDamageCause: 'explosion',
      })
      expect(yield* runtime.damage({ amount: 1, cause: 'mob' })).toMatchObject({
        died: false,
        vitals: { healthPoints: 0, lastDamageCause: 'explosion' },
      })
      expect((yield* coordinator.snapshot(
        REPLICATED_VITALS_OWNER,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )).state.vitals).toStrictEqual(deadBefore.vitals)
    }),
  )

  it.effect('replicated restore, respawn, and reset clear pending activity at their boundaries', () =>
    Effect.gen(function* () {
      const { coordinator, runtime } = yield* makeReplicatedRuntime(vitals({
        healthPoints: EntityHealthPoints(8),
        hungerPoints: HungerPoints(11),
        saturation: FoodSaturation(1),
      }), 'hard')
      const restored = initial('easy', {
        healthPoints: EntityHealthPoints(12),
        hungerPoints: HungerPoints(10),
        saturation: FoodSaturation(2),
      })

      yield* runtime.submit({ _tag: 'sprint', distance: 20 })
      yield* runtime.restore(restored)
      expect(yield* runtime.snapshot).toStrictEqual(restored)
      expect((yield* runtime.tick(DeltaTimeSecs(0))).exhaustionAdded).toBe(0)
      expect((yield* coordinator.snapshot(
        REPLICATED_VITALS_OWNER,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )).state.vitals).toStrictEqual(restored.vitals)

      yield* runtime.setDifficulty('peaceful')
      yield* runtime.submit({ _tag: 'attack', count: 10 })
      yield* runtime.respawn
      expect(yield* runtime.snapshot).toStrictEqual({
        version: SURVIVAL_HUNGER_STATE_VERSION,
        difficulty: 'peaceful',
        vitals: SPAWN_PLAYER_VITALS,
      })
      expect((yield* runtime.tick(DeltaTimeSecs(0))).exhaustionAdded).toBe(0)

      yield* runtime.setDifficulty('hard')
      yield* runtime.submit({ _tag: 'mine', blocks: 4 })
      yield* runtime.reset
      expect(yield* runtime.snapshot).toStrictEqual({
        version: SURVIVAL_HUNGER_STATE_VERSION,
        difficulty: DEFAULT_SURVIVAL_DIFFICULTY,
        vitals: SPAWN_PLAYER_VITALS,
      })
      expect((yield* runtime.tick(DeltaTimeSecs(0))).exhaustionAdded).toBe(0)
    }),
  )
})
