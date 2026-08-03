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
): FoodUseRequest => ({
  held,
  vitals: {
    healthPoints: 20,
    hungerPoints: 19,
    maxHungerPoints: 20,
    ...overrides,
  },
})

describe('resolveFoodUse', () => {
  it.effect('consumes one potato with its exact nutrition when the player is hungry', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('potato'))).toStrictEqual({
        _tag: 'consume',
        count: 1,
        foodPoints: 1,
        saturationModifier: 0.6,
      })
    }),
  )

  it.effect('still consumes at the hunger boundary immediately below full', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('potato', { hungerPoints: 19, maxHungerPoints: 20 }))._tag).toBe('consume')
    }),
  )

  it.effect('refuses a potato at or above full hunger', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('potato', { hungerPoints: 20 }))).toStrictEqual({ _tag: 'full' })
      expect(resolveFoodUse(request('potato', { hungerPoints: 21 }))).toStrictEqual({ _tag: 'full' })
    }),
  )

  it.effect('classifies an item outside the food table as not food', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('stone'))).toStrictEqual({ _tag: 'notFood' })
    }),
  )

  it.effect('refuses all item consumption after death', () =>
    Effect.sync(() => {
      expect(resolveFoodUse(request('potato', { healthPoints: 0 }))).toStrictEqual({ _tag: 'dead' })
      expect(resolveFoodUse(request('stone', { healthPoints: -1 }))).toStrictEqual({ _tag: 'dead' })
    }),
  )

  it.effect('pins the food table to potato and its vanilla nutrition', () =>
    Effect.sync(() => {
      expect(FOOD_PROPERTIES).toStrictEqual({
        potato: { foodPoints: 1, saturationModifier: 0.6 },
      })
    }),
  )
})
