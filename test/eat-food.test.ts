import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import * as FastCheck from 'fast-check'
import {
  EntityHealthPoints,
  VANILLA_FOOD_DEFINITIONS,
  type FoodStatusEffectName,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { HungerPoints } from '@nerima-games/mc-sim'
import { applyStatusEffect, emptyStatusEffectState } from '../src/domain/status-effect'
import {
  FOOD_PROPERTIES,
  resolveFoodUse,
  type FoodUseRequest,
} from '../src/domain/interactions/eat-food'

const request = (
  held: FoodUseRequest['held'],
  overrides: Readonly<{ healthPoints?: number; hungerPoints?: number; maxHungerPoints?: number }> = {},
  effectRoll?: number,
): FoodUseRequest => ({
  held,
  vitals: {
    healthPoints: EntityHealthPoints(overrides.healthPoints ?? 20),
    hungerPoints: HungerPoints(overrides.hungerPoints ?? 19),
    maxHungerPoints: HungerPoints(overrides.maxHungerPoints ?? 20),
  },
  ...(effectRoll === undefined ? {} : { effectRoll }),
})

const effectsOf = (foodRequest: FoodUseRequest) => {
  const outcome = Result.getOrThrow(resolveFoodUse(foodRequest))
  if (outcome._tag !== 'consume') throw new Error('expected food to be consumed')
  return outcome.effects
}

const foodUse = (foodRequest: FoodUseRequest) => Result.getOrThrow(resolveFoodUse(foodRequest))

const WIKI_FOOD_EFFECTS: ReadonlyArray<Readonly<{
  item: ItemType
  name: FoodStatusEffectName
  level: number
  durationSecs: number
  chance: number
}>> = [
  { item: 'pufferfish', name: 'poison', level: 2, durationSecs: 60, chance: 1 },
  { item: 'pufferfish', name: 'nausea', level: 1, durationSecs: 15, chance: 1 },
  { item: 'pufferfish', name: 'hunger', level: 3, durationSecs: 15, chance: 1 },
  { item: 'rotten_flesh', name: 'hunger', level: 1, durationSecs: 30, chance: 0.8 },
  { item: 'spider_eye', name: 'poison', level: 1, durationSecs: 5, chance: 1 },
  { item: 'chicken', name: 'hunger', level: 1, durationSecs: 30, chance: 0.3 },
  { item: 'enchanted_golden_apple', name: 'regeneration', level: 2, durationSecs: 20, chance: 1 },
  { item: 'enchanted_golden_apple', name: 'absorption', level: 4, durationSecs: 120, chance: 1 },
  { item: 'enchanted_golden_apple', name: 'fire_resistance', level: 1, durationSecs: 300, chance: 1 },
  { item: 'enchanted_golden_apple', name: 'resistance', level: 1, durationSecs: 300, chance: 1 },
  { item: 'golden_apple', name: 'regeneration', level: 2, durationSecs: 5, chance: 1 },
  { item: 'golden_apple', name: 'absorption', level: 1, durationSecs: 120, chance: 1 },
  { item: 'poisonous_potato', name: 'poison', level: 1, durationSecs: 5, chance: 0.6 },
]

describe('resolveFoodUse', () => {
  it.effect('resolves every kernel food with its nutrition and converted saturation modifier', () =>
    Effect.sync(() => {
      expect(VANILLA_FOOD_DEFINITIONS).toHaveLength(39)
      expect(Object.keys(FOOD_PROPERTIES)).toHaveLength(39)

      for (const definition of VANILLA_FOOD_DEFINITIONS) {
        const expected = {
          foodPoints: definition.nutrition,
          saturationModifier: definition.saturation / (2 * definition.nutrition),
        }
        expect(FOOD_PROPERTIES[definition.item]).toStrictEqual(expected)
        expect(foodUse(request(definition.item, { hungerPoints: 0 }, 1))).toMatchObject({
          _tag: 'consume',
          count: 1,
          ...expected,
        })
      }
    }),
  )

  it.effect('preserves food values for arbitrary kernel definitions and valid effect rolls (fast-check)', () =>
    Effect.sync(() => {
      const definition = FastCheck.constantFrom(...VANILLA_FOOD_DEFINITIONS)
      const effectRoll = FastCheck.double({ min: 0, max: 1 - Number.EPSILON, noNaN: true })

      FastCheck.assert(
        FastCheck.property(definition, effectRoll, (food, roll) => {
          const outcome = foodUse(request(food.item, { hungerPoints: 0 }, roll))
          expect(outcome).toMatchObject({
            _tag: 'consume',
            count: 1,
            foodPoints: food.nutrition,
            saturationModifier: food.saturation / (2 * food.nutrition),
          })
        }),
        { numRuns: 100 },
      )
    }),
  )

  it.effect('allows vanilla always-edible foods at full hunger, including honey bottles', () =>
    Effect.sync(() => {
      expect(foodUse(request('potato', { hungerPoints: 20 }))).toStrictEqual({ _tag: 'full' })

      for (const held of [
        'chorus_fruit',
        'golden_apple',
        'enchanted_golden_apple',
        'honey_bottle',
      ] as const) {
        expect(foodUse(request(held, { hungerPoints: 20 }))._tag).toBe('consume')
      }
    }),
  )

  it.effect('applies probabilistic food effects below their chance and excludes the exact boundary', () =>
    Effect.sync(() => {
      const cases = [
        {
          held: 'chicken',
          chance: 0.3,
          effect: { type: 'hunger', amplifier: 0, durationSecs: 30 },
        },
        {
          held: 'poisonous_potato',
          chance: 0.6,
          effect: { type: 'poison', amplifier: 0, durationSecs: 5 },
        },
        {
          held: 'rotten_flesh',
          chance: 0.8,
          effect: { type: 'hunger', amplifier: 0, durationSecs: 30 },
        },
      ] as const

      for (const { held, chance, effect } of cases) {
        expect(effectsOf(request(held, {}, chance - 0.000001))).toStrictEqual([effect])
        expect(effectsOf(request(held, {}, chance))).toStrictEqual([])
      }
    }),
  )

  it.effect('translates supported status effects and skips effects the status layer cannot represent', () =>
    Effect.sync(() => {
      expect(effectsOf(request('pufferfish', {}, 1))).toStrictEqual([
        { type: 'poison', amplifier: 1, durationSecs: 60 },
        { type: 'nausea', amplifier: 0, durationSecs: 15 },
        { type: 'hunger', amplifier: 2, durationSecs: 15 },
      ])
      expect(effectsOf(request('spider_eye'))).toStrictEqual([
        { type: 'poison', amplifier: 0, durationSecs: 5 },
      ])
      expect(effectsOf(request('golden_apple'))).toStrictEqual([
        { type: 'regeneration', amplifier: 1, durationSecs: 5 },
      ])
      expect(effectsOf(request('honey_bottle'))).toStrictEqual([
        { type: 'poison', durationSecs: 0 },
      ])
      expect(effectsOf(request('chorus_fruit'))).toStrictEqual([])
    }),
  )

  it.effect('audits every kernel food effect against wiki levels and applies zero-based amplifiers', () =>
    Effect.sync(() => {
      const kernelEffects = VANILLA_FOOD_DEFINITIONS.flatMap((food) => food.effects.flatMap((effect) =>
        effect.kind === 'status'
          ? [{ item: food.item, name: effect.name, amplifier: effect.amplifier, durationSecs: effect.durationSecs, chance: effect.chance }]
          : [],
      ))
      expect(kernelEffects).toHaveLength(WIKI_FOOD_EFFECTS.length)

      for (const expected of WIKI_FOOD_EFFECTS) {
        const kernelEffect = kernelEffects.find(({ item, name }) =>
          item === expected.item && name === expected.name,
        )
        expect(kernelEffect).toBeDefined()
        if (kernelEffect === undefined) continue

        const knownKernel014Outlier = expected.item === 'pufferfish' && expected.name === 'nausea'
        expect(kernelEffect).toMatchObject({
          durationSecs: expected.durationSecs,
          chance: expected.chance,
          amplifier: expected.level - 1 + (knownKernel014Outlier ? 1 : 0),
        })

        const translated = effectsOf(request(expected.item, {}, 0)).find(({ type }) => type === expected.name)
        if (['hunger', 'nausea', 'poison', 'regeneration'].includes(expected.name)) {
          expect(translated).toBeDefined()
          if (translated === undefined) continue
          expect(translated.amplifier).toBe(expected.level - 1)
        } else {
          expect(translated).toBeUndefined()
        }
      }
    }),
  )

  it.effect('uses the status-effect removal path for honey bottle poison clearing', () =>
    Effect.sync(() => {
      const poisoned = applyStatusEffect(emptyStatusEffectState(), {
        type: 'poison',
        amplifier: 0,
        durationSecs: 10,
      })
      const cleared = effectsOf(request('honey_bottle')).reduce(applyStatusEffect, poisoned)
      expect(cleared).toStrictEqual({ effects: [] })
    }),
  )

  it.effect('still consumes below full hunger and refuses ordinary food at or above full', () =>
    Effect.sync(() => {
      expect(foodUse(request('potato', { hungerPoints: 19, maxHungerPoints: 20 }))._tag).toBe('consume')
      expect(foodUse(request('pufferfish', { hungerPoints: 20 }, 0))).toStrictEqual({ _tag: 'full' })
      expect(foodUse(request('potato', { hungerPoints: 21 }))).toStrictEqual({ _tag: 'full' })
    }),
  )

  it.effect('classifies non-food items and refuses consumption after death', () =>
    Effect.sync(() => {
      expect(foodUse(request('stone', {}, 0))).toStrictEqual({ _tag: 'notFood' })
      expect(foodUse(request('potato', { healthPoints: 0 }))).toStrictEqual({ _tag: 'dead' })
      expect(resolveFoodUse(request('not_a_kernel_item' as FoodUseRequest['held'], {}, 0)))
        .toStrictEqual(Result.fail({ _tag: 'InvalidFoodItemId', itemId: 'not_a_kernel_item' }))
    }),
  )
})
