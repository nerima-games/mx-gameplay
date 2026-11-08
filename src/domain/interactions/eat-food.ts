import {
  ITEM_TYPES,
  foodDefinitionOf,
  VANILLA_FOOD_DEFINITIONS,
  type FoodDefinition,
  type FoodStatusEffectName,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { Brand, Result } from 'effect'
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

type FoodKernel014Override = {
  readonly alwaysEdible?: true
  readonly effectAmplifiers?: Partial<Record<FoodStatusEffectName, number>>
}

// mc-kernel #95 (https://github.com/nerima-games/mc-kernel/pull/95) fixes these
// two vanilla-data errors in 0.16.0. Remove the entries when gameplay upgrades
// to that pin. Pufferfish Nausea I stores
// amplifier 1 (which means Nausea II); honey_bottle is marked not always edible,
// though vanilla allows it at full hunger.
const FOOD_KERNEL_014_OVERRIDES: Readonly<Partial<Record<ItemType, FoodKernel014Override>>> = {
  pufferfish: { effectAmplifiers: { nausea: 0 } },
  honey_bottle: { alwaysEdible: true },
}

const foodEffectAmplifierOf = (
  food: FoodDefinition,
  effect: Extract<FoodDefinition['effects'][number], { readonly kind: 'status' }>,
): number => FOOD_KERNEL_014_OVERRIDES[food.item]?.effectAmplifiers?.[effect.name] ?? effect.amplifier

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

  const amplifier = foodEffectAmplifierOf(food, effect)
  const type = statusEffectTypeOf(effect.name)
  return type === undefined
    ? []
    : [{
        type,
        amplifier,
        durationSecs: effect.durationSecs,
      }]
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

type InvalidFoodItemValue = string & Brand.Brand<'InvalidFoodItemValue'>
const makeInvalidFoodItemValue = Brand.nominal<InvalidFoodItemValue>()
export type InvalidFoodItemId = Readonly<{ _tag: 'InvalidFoodItemId'; itemId: InvalidFoodItemValue }>

const KNOWN_ITEM_IDS: ReadonlySet<string> = new Set<string>(ITEM_TYPES)

/** Decide whether normal item use should eat the held item. */
export const resolveFoodUse = ({
  held,
  vitals,
  effectRoll = 1,
}: FoodUseRequest): Result.Result<FoodUseOutcome, InvalidFoodItemId> => {
  if (!KNOWN_ITEM_IDS.has(held)) {
    return Result.fail({ _tag: 'InvalidFoodItemId', itemId: makeInvalidFoodItemValue(String(held)) })
  }

  if (vitals.healthPoints <= 0) {
    return Result.succeed({ _tag: 'dead' })
  }

  const definition = foodDefinitionOf(held)
  if (definition === undefined) {
    return Result.succeed({ _tag: 'notFood' })
  }

  if (
    !definition.canAlwaysEat &&
    FOOD_KERNEL_014_OVERRIDES[held]?.alwaysEdible !== true &&
    vitals.hungerPoints >= vitals.maxHungerPoints
  ) {
    return Result.succeed({ _tag: 'full' })
  }

  return Result.succeed({
    _tag: 'consume',
    count: 1,
    effects: effectsOfFood(definition, effectRoll),
    ...foodPropertiesOf(definition),
  })
}
