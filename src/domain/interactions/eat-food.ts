import {
  foodDefinitionOf,
  VANILLA_FOOD_DEFINITIONS,
  type FoodDefinition,
  type FoodStatusEffectName,
  type ItemType,
} from '@nerima-games/mc-kernel'
import type { PlayerVitals } from '../in-memory-vitals.js'
import type { StatusEffectApplication, StatusEffectType } from '../status-effect.js'

/** Nutrition passed to the vitals service after an item has been consumed. */
export type FoodProperties = {
  readonly foodPoints: number
  readonly saturationModifier: number
}

const foodPropertiesOf = (food: FoodDefinition): FoodProperties => ({
  foodPoints: food.nutrition,
  saturationModifier: food.saturation / (2 * food.nutrition),
})

/** Food values follow the kernel's canonical vanilla definitions. */
const foodProperties: Partial<Record<ItemType, FoodProperties>> = {}
for (const definition of VANILLA_FOOD_DEFINITIONS) {
  foodProperties[definition.item] = foodPropertiesOf(definition)
}
export const FOOD_PROPERTIES: Readonly<Partial<Record<ItemType, FoodProperties>>> = foodProperties

const STATUS_EFFECT_TYPE_BY_FOOD_NAME: Readonly<Partial<Record<FoodStatusEffectName, StatusEffectType>>> = {
  hunger: 'hunger',
  nausea: 'nausea',
  poison: 'poison',
  regeneration: 'regeneration',
}

const statusEffectTypeOf = (name: FoodStatusEffectName): StatusEffectType | undefined =>
  STATUS_EFFECT_TYPE_BY_FOOD_NAME[name]

const effectsOfFood = (
  food: FoodDefinition,
  effectRoll: number,
): ReadonlyArray<StatusEffectApplication> => food.effects.flatMap<StatusEffectApplication>((effect) => {
  if (effect.chance < 1 && !(effectRoll < effect.chance)) {
    return []
  }

  if (effect.kind === 'remove') {
    return [{ type: effect.name, durationSecs: 0 }]
  }
  if (effect.kind === 'teleport') {
    return []
  }

  const type = statusEffectTypeOf(effect.name)
  return type === undefined
    ? []
    : [{ type, amplifier: effect.amplifier, durationSecs: effect.durationSecs }]
})

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

  const definition = foodDefinitionOf(held)
  if (definition === undefined) {
    return { _tag: 'notFood' }
  }

  if (!definition.canAlwaysEat && vitals.hungerPoints >= vitals.maxHungerPoints) {
    return { _tag: 'full' }
  }

  return {
    _tag: 'consume',
    count: 1,
    effects: effectsOfFood(definition, effectRoll),
    ...foodPropertiesOf(definition),
  }
}
