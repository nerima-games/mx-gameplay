import type { DeltaTimeSecs } from './frame-contract.js'
import type { ItemType } from './item-vocabulary.js'
import type { StatusEffectApplication } from './status-effect.js'

export const BREWING_INGREDIENTS = ['nether_wart', 'sugar', 'spider_eye', 'ghast_tear'] as const
export type BrewingIngredient = (typeof BREWING_INGREDIENTS)[number]

export const POTION_TYPES = ['awkward', 'speed', 'poison', 'regeneration'] as const
export type PotionType = (typeof POTION_TYPES)[number]
export type BrewingBottle = 'water_bottle' | { readonly potion: PotionType }

export type BrewingItem = Extract<
  ItemType,
  | 'blaze_powder'
  | BrewingIngredient
  | 'water_bottle'
  | 'awkward_potion'
  | 'potion_of_swiftness'
  | 'potion_of_poison'
  | 'potion_of_regeneration'
>

export type BrewingStack = {
  readonly item: BrewingItem
  readonly count: 1
}

export type BrewingRecipe = {
  readonly bottle: BrewingBottle
  readonly ingredient: BrewingIngredient
  readonly output: PotionType
}

export type BrewingStandState = {
  readonly fuelUnits: number
  readonly bottle: BrewingBottle | undefined
  readonly ingredient: BrewingIngredient | undefined
  readonly brewing: { readonly output: PotionType; readonly remainingSecs: number } | undefined
}

export type BrewingTransferResult =
  | { readonly _tag: 'Accepted'; readonly consumed: BrewingStack }
  | { readonly _tag: 'Rejected'; readonly reason: 'Occupied' | 'Empty' | 'Brewing' | 'InvalidRecipe' }

export type BrewingCollectionResult =
  | { readonly _tag: 'Collected'; readonly returned: BrewingStack }
  | { readonly _tag: 'Rejected'; readonly reason: 'Empty' | 'Brewing' }

export type BrewingDrinkResult =
  | { readonly _tag: 'Consumed'; readonly consumed: BrewingStack; readonly effect: StatusEffectApplication }
  | { readonly _tag: 'Rejected'; readonly reason: 'Empty' | 'Brewing' | 'NoEffect' }

export const BREWING_DURATION_SECS = 20
export const POTION_EFFECT_DURATION_SECS: Readonly<Record<Exclude<PotionType, 'awkward'>, number>> = {
  speed: 180,
  poison: 45,
  regeneration: 45,
}

const potionItem = (potion: PotionType): BrewingItem => {
  if (potion === 'awkward') return 'awkward_potion'
  if (potion === 'speed') return 'potion_of_swiftness'
  if (potion === 'poison') return 'potion_of_poison'
  return 'potion_of_regeneration'
}

export const emptyBrewingStandState = (): BrewingStandState => ({
  fuelUnits: 0,
  bottle: undefined,
  ingredient: undefined,
  brewing: undefined,
})

export const copyBrewingStandState = (state: BrewingStandState): BrewingStandState => ({
  fuelUnits: Math.max(0, Math.floor(state.fuelUnits)),
  bottle: typeof state.bottle === 'object' ? { ...state.bottle } : state.bottle,
  ingredient: state.ingredient,
  brewing: state.brewing === undefined ? undefined : { ...state.brewing },
})

export const brewingOutput = (
  bottle: BrewingBottle,
  ingredient: BrewingIngredient,
): PotionType | undefined => {
  if (bottle === 'water_bottle') return ingredient === 'nether_wart' ? 'awkward' : undefined
  if (bottle.potion !== 'awkward') return undefined
  if (ingredient === 'sugar') return 'speed'
  if (ingredient === 'spider_eye') return 'poison'
  if (ingredient === 'ghast_tear') return 'regeneration'
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPotionType = (value: unknown): value is PotionType =>
  typeof value === 'string' && POTION_TYPES.includes(value as PotionType)

const isBrewingIngredient = (value: unknown): value is BrewingIngredient =>
  typeof value === 'string' && BREWING_INGREDIENTS.includes(value as BrewingIngredient)

const isBrewingBottle = (value: unknown): value is BrewingBottle =>
  value === 'water_bottle' || (isRecord(value) && isPotionType(value['potion']))

export const isValidBrewingStandState = (
  value: unknown,
): value is BrewingStandState => {
  const fuelUnits = isRecord(value) ? value['fuelUnits'] : undefined
  const bottle = isRecord(value) ? value['bottle'] : undefined
  const ingredient = isRecord(value) ? value['ingredient'] : undefined
  const brewing = isRecord(value) ? value['brewing'] : undefined
  if (
    !isRecord(value) ||
    typeof fuelUnits !== 'number' ||
    !Number.isSafeInteger(fuelUnits) ||
    fuelUnits < 0 ||
    !(bottle === undefined || isBrewingBottle(bottle)) ||
    !(ingredient === undefined || isBrewingIngredient(ingredient))
  ) {
    return false
  }

  if (brewing === undefined) {
    return (
      bottle === undefined ||
      ingredient === undefined ||
      brewingOutput(bottle, ingredient) !== undefined
    )
  }

  if (
    !isRecord(brewing) ||
    !isPotionType(brewing['output']) ||
    typeof brewing['remainingSecs'] !== 'number' ||
    !Number.isFinite(brewing['remainingSecs']) ||
    brewing['remainingSecs'] <= 0 ||
    bottle === undefined ||
    ingredient !== undefined
  ) {
    return false
  }

  return true
}

export const acceptBrewingFuel = (
  state: BrewingStandState,
): readonly [BrewingStandState, BrewingTransferResult] => [
  { ...state, fuelUnits: state.fuelUnits + 1 },
  { _tag: 'Accepted', consumed: { item: 'blaze_powder', count: 1 } },
]

export const acceptBrewingBottle = (
  state: BrewingStandState,
  bottle: BrewingBottle,
): readonly [BrewingStandState, BrewingTransferResult] => {
  if (state.bottle !== undefined) return [state, { _tag: 'Rejected', reason: 'Occupied' }]
  if (state.ingredient !== undefined && brewingOutput(bottle, state.ingredient) === undefined) {
    return [state, { _tag: 'Rejected', reason: 'InvalidRecipe' }]
  }
  const item = bottle === 'water_bottle' ? bottle : potionItem(bottle.potion)
  return [{ ...state, bottle }, { _tag: 'Accepted', consumed: { item, count: 1 } }]
}

export const acceptBrewingIngredient = (
  state: BrewingStandState,
  ingredient: BrewingIngredient,
): readonly [BrewingStandState, BrewingTransferResult] => {
  if (state.brewing !== undefined) return [state, { _tag: 'Rejected', reason: 'Brewing' }]
  if (state.ingredient !== undefined) return [state, { _tag: 'Rejected', reason: 'Occupied' }]
  if (state.bottle !== undefined && brewingOutput(state.bottle, ingredient) === undefined) {
    return [state, { _tag: 'Rejected', reason: 'InvalidRecipe' }]
  }
  return [
    { ...state, ingredient },
    { _tag: 'Accepted', consumed: { item: ingredient, count: 1 } },
  ]
}

export const collectBrewingBottle = (
  state: BrewingStandState,
): readonly [BrewingStandState, BrewingCollectionResult] => {
  if (state.brewing !== undefined) return [state, { _tag: 'Rejected', reason: 'Brewing' }]
  if (state.bottle === undefined) return [state, { _tag: 'Rejected', reason: 'Empty' }]
  const item = state.bottle === 'water_bottle' ? state.bottle : potionItem(state.bottle.potion)
  return [{ ...state, bottle: undefined }, { _tag: 'Collected', returned: { item, count: 1 } }]
}

export const tickBrewingStand = (
  state: BrewingStandState,
  dt: DeltaTimeSecs,
): BrewingStandState => {
  const elapsedSecs = Number.isFinite(dt) ? Math.max(0, dt) : 0
  let current = state
  if (current.brewing === undefined && current.fuelUnits > 0 && current.bottle !== undefined && current.ingredient !== undefined) {
    const output = brewingOutput(current.bottle, current.ingredient)
    if (output !== undefined) {
      current = {
        ...current,
        fuelUnits: current.fuelUnits - 1,
        ingredient: undefined,
        brewing: { output, remainingSecs: BREWING_DURATION_SECS },
      }
    }
  }
  if (current.brewing === undefined) return current

  const remainingSecs = Math.max(0, current.brewing.remainingSecs - elapsedSecs)
  if (remainingSecs > 0) return { ...current, brewing: { ...current.brewing, remainingSecs } }
  return { ...current, bottle: { potion: current.brewing.output }, brewing: undefined }
}

export const statusEffectOfPotion = (potion: PotionType): StatusEffectApplication | undefined => {
  if (potion === 'awkward') return undefined
  return {
    type: potion,
    durationSecs: POTION_EFFECT_DURATION_SECS[potion],
  }
}

export const drinkBrewingPotion = (
  state: BrewingStandState,
): readonly [BrewingStandState, BrewingDrinkResult] => {
  if (state.brewing !== undefined) return [state, { _tag: 'Rejected', reason: 'Brewing' }]
  if (state.bottle === undefined) return [state, { _tag: 'Rejected', reason: 'Empty' }]
  if (state.bottle === 'water_bottle') return [state, { _tag: 'Rejected', reason: 'NoEffect' }]
  const effect = statusEffectOfPotion(state.bottle.potion)
  if (effect === undefined) return [state, { _tag: 'Rejected', reason: 'NoEffect' }]
  return [
    { ...state, bottle: undefined },
    {
      _tag: 'Consumed',
      consumed: { item: potionItem(state.bottle.potion), count: 1 },
      effect,
    },
  ]
}
