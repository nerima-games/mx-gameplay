import type { ItemType } from '@nerima-games/mc-kernel'
import type { PlayerVitals } from '../in-memory-vitals.js'
import type { StatusEffectApplication } from '../status-effect.js'

/** Nutrition passed to the vitals service after an item has been consumed. */
export type FoodProperties = {
  readonly foodPoints: number
  readonly saturationModifier: number
}

/** Foods currently understood by gameplay. Missing items are not food. */
export const FOOD_PROPERTIES: Readonly<Partial<Record<ItemType, FoodProperties>>> = {
  potato: { foodPoints: 1, saturationModifier: 0.6 },
  rotten_flesh: { foodPoints: 4, saturationModifier: 0.1 },
  cod: { foodPoints: 2, saturationModifier: 0.1 },
  salmon: { foodPoints: 2, saturationModifier: 0.1 },
  tropical_fish: { foodPoints: 1, saturationModifier: 0.1 },
  pufferfish: { foodPoints: 1, saturationModifier: 0.1 },
  spider_eye: { foodPoints: 2, saturationModifier: 0.8 },
}

export type FoodUseRequest = {
  readonly held: ItemType
  readonly vitals: Pick<PlayerVitals, 'healthPoints' | 'hungerPoints' | 'maxHungerPoints'>
  readonly effectRoll?: number
}

/** The host consumes inventory only for the `consume` outcome. */
export type FoodUseOutcome =
  | ({
      readonly _tag: 'consume'
      readonly count: 1
      readonly effects: ReadonlyArray<StatusEffectApplication>
    } & FoodProperties)
  | { readonly _tag: 'notFood' }
  | { readonly _tag: 'full' }
  | { readonly _tag: 'dead' }

/** Decide whether normal item use should eat the held item. */
export const resolveFoodUse = ({ held, vitals, effectRoll = 1 }: FoodUseRequest): FoodUseOutcome => {
  if (vitals.healthPoints <= 0) {
    return { _tag: 'dead' }
  }

  const food = FOOD_PROPERTIES[held]
  if (food === undefined) {
    return { _tag: 'notFood' }
  }

  if (vitals.hungerPoints >= vitals.maxHungerPoints) {
    return { _tag: 'full' }
  }

  const effects: ReadonlyArray<StatusEffectApplication> = held === 'pufferfish'
    ? [
        { type: 'poison', amplifier: 3, durationSecs: 60 },
        { type: 'hunger', amplifier: 2, durationSecs: 15 },
        { type: 'nausea', amplifier: 0, durationSecs: 15 },
      ]
    : held === 'spider_eye'
      ? [{ type: 'poison', amplifier: 0, durationSecs: 5 }]
    : held === 'rotten_flesh' && effectRoll < 0.8
      ? [{ type: 'hunger', amplifier: 0, durationSecs: 30 }]
      : []

  return { _tag: 'consume', count: 1, effects, ...food }
}
