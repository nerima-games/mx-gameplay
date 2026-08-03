import { describe, expect, it } from 'vitest'
import {
  BREWING_DURATION_SECS,
  collectBrewingBottle,
  emptyBrewingStandState,
  isValidBrewingStandState,
  acceptBrewingBottle,
  acceptBrewingFuel,
  acceptBrewingIngredient,
  tickBrewingStand,
  type BrewingIngredient,
  type BrewingStandState,
} from '../src/domain/brewing'
import { DeltaTimeSecs } from '../src/domain/frame-contract'

const loadedStand = (ingredient: BrewingIngredient): BrewingStandState => {
  const [withFuel] = acceptBrewingFuel(emptyBrewingStandState())
  const [withBottle] = acceptBrewingBottle(withFuel, 'water_bottle')
  const [loaded] = acceptBrewingIngredient(withBottle, ingredient)
  return loaded
}

describe('basic brewing runtime', () => {
  it('brews water and nether wart into awkward potion after exactly 20 seconds', () => {
    const started = tickBrewingStand(loadedStand('nether_wart'), DeltaTimeSecs(0))

    expect(started).toMatchObject({
      fuelUnits: 0,
      ingredient: undefined,
      brewing: { output: 'awkward', remainingSecs: BREWING_DURATION_SECS },
    })
    expect(tickBrewingStand(started, DeltaTimeSecs(19.999)).bottle).toBe('water_bottle')
    expect(tickBrewingStand(started, DeltaTimeSecs(20))).toMatchObject({
      bottle: { potion: 'awkward' },
      brewing: undefined,
    })
  })

  it.each([
    ['sugar', 'speed'],
    ['spider_eye', 'poison'],
    ['ghast_tear', 'regeneration'],
  ] as const)('brews awkward potion with %s into %s', (ingredient, output) => {
    const stand: BrewingStandState = {
      fuelUnits: 1,
      bottle: { potion: 'awkward' },
      ingredient,
      brewing: undefined,
    }
    expect(tickBrewingStand(stand, DeltaTimeSecs(20))).toStrictEqual({
      fuelUnits: 0,
      bottle: { potion: output },
      ingredient: undefined,
      brewing: undefined,
    })
  })

  it('reports consumed and returned stacks at the host boundary', () => {
    const empty = emptyBrewingStandState()
    const [withBottle, inserted] = acceptBrewingBottle(empty, 'water_bottle')
    const [unchanged, rejected] = acceptBrewingBottle(withBottle, 'water_bottle')
    const [collected, collection] = collectBrewingBottle(withBottle)

    expect(inserted).toStrictEqual({
      _tag: 'Accepted',
      consumed: { item: 'water_bottle', count: 1 },
    })
    expect(rejected).toStrictEqual({ _tag: 'Rejected', reason: 'Occupied' })
    expect(unchanged).toBe(withBottle)
    expect(collection).toStrictEqual({
      _tag: 'Collected',
      returned: { item: 'water_bottle', count: 1 },
    })
    expect(collected.bottle).toBeUndefined()
  })

  it('fixes deliberate Minecraft divergences: one bottle and one fuel per brew', () => {
    const started = tickBrewingStand(loadedStand('nether_wart'), DeltaTimeSecs(0))
    const [, secondBottle] = acceptBrewingBottle(started, 'water_bottle')

    expect(secondBottle).toStrictEqual({ _tag: 'Rejected', reason: 'Occupied' })
    expect(started.fuelUnits).toBe(0)
    expect(started.ingredient).toBeUndefined()
  })

  it('rejects a known invalid recipe without consuming the ingredient', () => {
    const [withBottle] = acceptBrewingBottle(emptyBrewingStandState(), 'water_bottle')
    const [unchanged, result] = acceptBrewingIngredient(withBottle, 'sugar')

    expect(result).toStrictEqual({ _tag: 'Rejected', reason: 'InvalidRecipe' })
    expect(unchanged).toBe(withBottle)
  })

  it('validates saved state before restoration', () => {
    expect(isValidBrewingStandState(emptyBrewingStandState())).toBe(true)
    expect(isValidBrewingStandState({
      fuelUnits: 0,
      bottle: { potion: 'speed' },
      ingredient: undefined,
      brewing: { output: 'speed', remainingSecs: 10 },
    })).toBe(true)
    expect(isValidBrewingStandState({ ...emptyBrewingStandState(), fuelUnits: -1 })).toBe(false)
    expect(isValidBrewingStandState({
      fuelUnits: 0,
      bottle: undefined,
      ingredient: undefined,
      brewing: { output: 'speed', remainingSecs: 10 },
    })).toBe(false)
  })
})
