import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  FOOD_PROPERTIES,
  resolveFoodUse,
  type FoodUseRequest,
} from '../src/domain/interactions/eat-food'

const request = (
  held: FoodUseRequest['held'],
  overrides: Partial<FoodUseRequest['vitals']> = {},
  effectRoll?: number,
): FoodUseRequest => ({
  held,
  vitals: {
    healthPoints: 20,
    hungerPoints: 19,
    maxHungerPoints: 20,
    ...overrides,
  },
  ...(effectRoll === undefined ? {} : { effectRoll }),
})

describe('resolveFoodUse', () => {
  it.effect('consumes one potato with its exact nutrition and no effects', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('potato'))).toStrictEqual({
        _tag: 'consume',
        count: 1,
        foodPoints: 1,
        saturationModifier: 0.6,
        effects: [],
      })
    }),
  )

  it.effect('applies rotten flesh hunger below the probability boundary', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('rotten_flesh', {}, 0.799999))).toStrictEqual({
        _tag: 'consume',
        count: 1,
        foodPoints: 4,
        saturationModifier: 0.1,
        effects: [{ type: 'hunger', amplifier: 0, durationSecs: 30 }],
      })
    }),
  )

  it.effect('does not apply rotten flesh hunger at the 0.8 boundary or by default', () =>
    Effect.sync(() => {
      const expected = {
        _tag: 'consume',
        count: 1,
        foodPoints: 4,
        saturationModifier: 0.1,
        effects: [],
      }
      expect(resolveFoodUse(request('rotten_flesh', {}, 0.8))).toStrictEqual(expected)
      expect(resolveFoodUse(request('rotten_flesh'))).toStrictEqual(expected)
    }),
  )

  it.effect('always applies all pufferfish effects', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('pufferfish', {}, 1))).toStrictEqual({
        _tag: 'consume',
        count: 1,
        foodPoints: 1,
        saturationModifier: 0.1,
        effects: [
          { type: 'poison', amplifier: 3, durationSecs: 60 },
          { type: 'hunger', amplifier: 2, durationSecs: 15 },
          { type: 'nausea', amplifier: 0, durationSecs: 15 },
        ],
      })
    }),
  )

  it.effect('consumes raw fish caught by fishing with no effects', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('cod'))).toStrictEqual({
        _tag: 'consume',
        count: 1,
        foodPoints: 2,
        saturationModifier: 0.1,
        effects: [],
      })
      expect(resolveFoodUse(request('salmon'))).toStrictEqual({
        _tag: 'consume',
        count: 1,
        foodPoints: 2,
        saturationModifier: 0.1,
        effects: [],
      })
      expect(resolveFoodUse(request('tropical_fish'))).toStrictEqual({
        _tag: 'consume',
        count: 1,
        foodPoints: 1,
        saturationModifier: 0.1,
        effects: [],
      })
    }),
  )

  it.effect('still consumes at the hunger boundary immediately below full', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('potato', { hungerPoints: 19, maxHungerPoints: 20 }))._tag).toBe('consume')
    }),
  )

  it.effect('refuses food at or above full hunger without effects', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('pufferfish', { hungerPoints: 20 }, 0))).toStrictEqual({ _tag: 'full' })
      expect(resolveFoodUse(request('potato', { hungerPoints: 21 }))).toStrictEqual({ _tag: 'full' })
    }),
  )

  it.effect('classifies an item outside the food table as not food without effects', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('stone', {}, 0))).toStrictEqual({ _tag: 'notFood' })
    }),
  )

  it.effect('refuses all item consumption after death', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('potato', { healthPoints: 0 }))).toStrictEqual({ _tag: 'dead' })
      expect(resolveFoodUse(request('stone', { healthPoints: -1 }))).toStrictEqual({ _tag: 'dead' })
    }),
  )

  it.effect('pins the food table to supported foods and their vanilla nutrition', () =>
    Effect.sync(() => {
      expect(FOOD_PROPERTIES).toStrictEqual({
        potato: { foodPoints: 1, saturationModifier: 0.6 },
        rotten_flesh: { foodPoints: 4, saturationModifier: 0.1 },
        cod: { foodPoints: 2, saturationModifier: 0.1 },
        salmon: { foodPoints: 2, saturationModifier: 0.1 },
        tropical_fish: { foodPoints: 1, saturationModifier: 0.1 },
        pufferfish: { foodPoints: 1, saturationModifier: 0.1 },
      })
    }),
  )
})
