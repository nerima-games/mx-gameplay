import type { ItemType } from '../item-vocabulary'
import type { PlayerVitals } from '../in-memory-vitals'

/** Nutrition passed to the vitals service after an item has been consumed. */
export type FoodProperties = {
  readonly foodPoints: number
  readonly saturationModifier: number
}

/** Foods currently understood by gameplay. Missing items are not food. */
export const FOOD_PROPERTIES: Readonly<Partial<Record<ItemType, FoodProperties>>> = {
  potato: { foodPoints: 1, saturationModifier: 0.6 },
}

export type FoodUseRequest = {
  readonly held: ItemType
  readonly vitals: Pick<PlayerVitals, 'healthPoints' | 'hungerPoints' | 'maxHungerPoints'>
}

/** The host consumes inventory only for the `consume` outcome. */
export type FoodUseOutcome =
  | ({ readonly _tag: 'consume'; readonly count: 1 } & FoodProperties)
  | { readonly _tag: 'notFood' }
  | { readonly _tag: 'full' }
  | { readonly _tag: 'dead' }

/** Decide whether normal item use should eat the held item. */
export const resolveFoodUse = ({ held, vitals }: FoodUseRequest): FoodUseOutcome => {
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

  return { _tag: 'consume', count: 1, ...food }
}
