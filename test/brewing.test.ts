import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import {
  BrewingBottleCollectionResultSchema,
  BrewingBottleCollectionRequestSchema,
  BREWING_DURATION_SECS,
  POTION_EFFECT_DURATION_SECS,
  collectBrewingBottleWithStorage,
  collectBrewingBottle,
  copyBrewingStandState,
  drinkBrewingPotion,
  emptyBrewingStandState,
  isValidBrewingStandState,
  acceptBrewingBottle,
  acceptBrewingFuel,
  acceptBrewingIngredient,
  statusEffectOfPotion,
  tickBrewingStand,
  type BrewingIngredient,
  type BrewingStandState,
} from '../src/domain/brewing'
import { DeltaTimeSecs, StackCount, WorldIdSchema, itemStack } from '@nerima-games/mc-kernel'
import {
  BrewingServiceStateSchema,
  PlayerStorageSnapshotSchema,
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  emptyPlayerStorage,
  makeBrewingServiceRegistration,
  makeReplicatedOwnerId,
  playerStorageOwnerRegistration,
} from '@nerima-games/mc-sim'

const loadedStand = (ingredient: BrewingIngredient): BrewingStandState => {
  const [withFuel] = acceptBrewingFuel(emptyBrewingStandState())
  const [withBottle] = acceptBrewingBottle(withFuel, 'water_bottle')
  const [loaded] = acceptBrewingIngredient(withBottle, ingredient)
  return loaded
}

const collectionTestSetup = (
  bottles: ReadonlyArray<unknown> = [undefined, undefined, undefined],
  storage = emptyPlayerStorage(),
) => {
  const brewingOwnerId = makeReplicatedOwnerId('test-brewing-owner')
  const playerStorageOwnerId = makeReplicatedOwnerId('test-player-storage-owner')
  const brewingState = Schema.decodeUnknownSync(BrewingServiceStateSchema)({
    bottles,
    ingredient: undefined,
    fuel: undefined,
    fuelCharges: 0,
    brewProgressSecs: 0,
  })
  const brewingRegistration = Result.getOrThrow(
    makeBrewingServiceRegistration(brewingOwnerId, brewingState),
  )
  const layer = WorldCommitCoordinatorLayer({
    world: Schema.decodeUnknownSync(WorldIdSchema)('brewing-collection-tests'),
    owners: [
      brewingRegistration,
      playerStorageOwnerRegistration(playerStorageOwnerId, storage),
    ],
  })
  return { layer, brewingOwnerId, playerStorageOwnerId }
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

  it('rejects a saved state that is not a record, before inspecting any field', () => {
    expect(isValidBrewingStandState(null)).toBe(false)
    expect(isValidBrewingStandState('nope')).toBe(false)
    expect(isValidBrewingStandState([])).toBe(false)
  })

  it('validates a loaded ingredient and a bottle-plus-ingredient pairing awaiting fuel', () => {
    expect(isValidBrewingStandState({
      fuelUnits: 1,
      bottle: undefined,
      ingredient: 'nether_wart',
      brewing: undefined,
    })).toBe(true)
    expect(isValidBrewingStandState({
      fuelUnits: 1,
      bottle: undefined,
      ingredient: 'made_up',
      brewing: undefined,
    })).toBe(false)
    expect(isValidBrewingStandState({
      fuelUnits: 1,
      bottle: 'water_bottle',
      ingredient: 'nether_wart',
      brewing: undefined,
    })).toBe(true)
    expect(isValidBrewingStandState({
      fuelUnits: 1,
      bottle: 'water_bottle',
      ingredient: 'sugar',
      brewing: undefined,
    })).toBe(false)
  })

  it('deep-copies a stand and floors or clamps a fractional or negative fuel count', () => {
    const empty = copyBrewingStandState(emptyBrewingStandState())
    expect(empty).toStrictEqual(emptyBrewingStandState())

    const source: BrewingStandState = {
      fuelUnits: 2.9,
      bottle: { potion: 'speed' },
      ingredient: undefined,
      brewing: { output: 'poison', remainingSecs: 12 },
    }
    const copy = copyBrewingStandState(source)
    expect(copy).toStrictEqual({ ...source, fuelUnits: 2 })
    expect(copy.bottle).not.toBe(source.bottle)
    expect(copy.brewing).not.toBe(source.brewing)

    expect(copyBrewingStandState({ ...source, fuelUnits: -3 }).fuelUnits).toBe(0)
  })

  it('brews from an already-loaded ingredient once a bottle arrives, and rejects a mismatched one', () => {
    const [withIngredient] = acceptBrewingIngredient(emptyBrewingStandState(), 'nether_wart')
    const [accepted, result] = acceptBrewingBottle(withIngredient, 'water_bottle')
    expect(result).toStrictEqual({
      _tag: 'Accepted',
      consumed: { item: 'water_bottle', count: 1 },
    })
    expect(accepted.bottle).toBe('water_bottle')

    const [unchanged, rejected] = acceptBrewingBottle(withIngredient, { potion: 'speed' })
    expect(rejected).toStrictEqual({ _tag: 'Rejected', reason: 'InvalidRecipe' })
    expect(unchanged).toBe(withIngredient)
  })

  it('accepts a potion bottle directly, consuming and returning the specific potion item', () => {
    const [withBottle, inserted] = acceptBrewingBottle(emptyBrewingStandState(), { potion: 'speed' })
    expect(inserted).toStrictEqual({
      _tag: 'Accepted',
      consumed: { item: 'potion_of_swiftness', count: 1 },
    })
    const [, collection] = collectBrewingBottle(withBottle)
    expect(collection).toStrictEqual({
      _tag: 'Collected',
      returned: { item: 'potion_of_swiftness', count: 1 },
    })

    const [, poisonInserted] = acceptBrewingBottle(emptyBrewingStandState(), { potion: 'poison' })
    expect(poisonInserted).toStrictEqual({
      _tag: 'Accepted',
      consumed: { item: 'potion_of_poison', count: 1 },
    })

    const [, awkwardCollection] = collectBrewingBottle({
      ...emptyBrewingStandState(),
      bottle: { potion: 'awkward' },
    })
    expect(awkwardCollection).toStrictEqual({
      _tag: 'Collected',
      returned: { item: 'awkward_potion', count: 1 },
    })
  })

  it('rejects loading an ingredient while brewing or while one is already loaded', () => {
    const brewing: BrewingStandState = {
      fuelUnits: 1,
      bottle: { potion: 'awkward' },
      ingredient: undefined,
      brewing: { output: 'poison', remainingSecs: 5 },
    }
    expect(acceptBrewingIngredient(brewing, 'sugar')[1]).toStrictEqual({
      _tag: 'Rejected',
      reason: 'Brewing',
    })

    const [loaded] = acceptBrewingIngredient(emptyBrewingStandState(), 'nether_wart')
    expect(acceptBrewingIngredient(loaded, 'sugar')[1]).toStrictEqual({
      _tag: 'Rejected',
      reason: 'Occupied',
    })
  })

  it('rejects an ingredient that cannot advance an already-brewed, non-awkward potion', () => {
    const stand: BrewingStandState = {
      fuelUnits: 1,
      bottle: { potion: 'speed' },
      ingredient: undefined,
      brewing: undefined,
    }
    const [unchanged, result] = acceptBrewingIngredient(stand, 'sugar')
    expect(result).toStrictEqual({ _tag: 'Rejected', reason: 'InvalidRecipe' })
    expect(unchanged).toBe(stand)
  })

  it('rejects an ingredient that does not turn an awkward potion into anything', () => {
    const stand: BrewingStandState = {
      fuelUnits: 1,
      bottle: { potion: 'awkward' },
      ingredient: undefined,
      brewing: undefined,
    }
    expect(acceptBrewingIngredient(stand, 'nether_wart')[1]).toStrictEqual({
      _tag: 'Rejected',
      reason: 'InvalidRecipe',
    })
  })

  it('rejects collecting while brewing or while the bottle slot is empty', () => {
    const brewing: BrewingStandState = {
      fuelUnits: 1,
      bottle: { potion: 'awkward' },
      ingredient: undefined,
      brewing: { output: 'poison', remainingSecs: 5 },
    }
    expect(collectBrewingBottle(brewing)[1]).toStrictEqual({ _tag: 'Rejected', reason: 'Brewing' })
    expect(collectBrewingBottle(emptyBrewingStandState())[1]).toStrictEqual({
      _tag: 'Rejected',
      reason: 'Empty',
    })
  })

  it('does not start brewing an invalid bottle/ingredient pairing loaded from outside acceptBrewingIngredient', () => {
    // `acceptBrewingIngredient` refuses an invalid pairing before it is ever
    // stored, so every other tick test's `brewingOutput(...) !== undefined`
    // check inside `tickBrewingStand` has only ever seen a valid pairing.
    // `tickBrewingStand` takes a plain `BrewingStandState`, not a value only
    // constructible through the blessed setters, so a state restored from a
    // stale or corrupted save can still carry an invalid pairing — this is
    // that defensive check exercised directly.
    const corrupted: BrewingStandState = {
      fuelUnits: 1,
      bottle: 'water_bottle',
      ingredient: 'sugar',
      brewing: undefined,
    }

    const result = tickBrewingStand(corrupted, DeltaTimeSecs(1))

    expect(result.brewing).toBeUndefined()
    expect(result.fuelUnits).toBe(1)
    expect(result.ingredient).toBe('sugar')
  })

  it('leaves an idle stand untouched and treats a non-finite delta as no time passing', () => {
    const idle = emptyBrewingStandState()
    expect(tickBrewingStand(idle, DeltaTimeSecs(1))).toStrictEqual(idle)

    // DeltaTimeSecs' own smart constructor rejects non-finite input, so a non-finite delta can only
    // reach the domain function past a validated boundary (e.g. a forged/decoded value). The cast
    // stands in for that boundary, the same way test/placement-rules.test.ts casts around a missing
    // registry row (see vitest.config.ts's coverage-gap note).
    const started = tickBrewingStand(loadedStand('nether_wart'), DeltaTimeSecs(0))
    const forgedDelta = Number.NaN as unknown as DeltaTimeSecs
    expect(tickBrewingStand(started, forgedDelta)).toStrictEqual(started)
  })

  it('derives the status effect of a potion, or no effect for an awkward potion', () => {
    expect(statusEffectOfPotion('awkward')).toBeUndefined()
    expect(statusEffectOfPotion('speed')).toStrictEqual({
      type: 'speed',
      durationSecs: POTION_EFFECT_DURATION_SECS.speed,
    })
    expect(statusEffectOfPotion('poison')).toStrictEqual({
      type: 'poison',
      durationSecs: POTION_EFFECT_DURATION_SECS.poison,
    })
    expect(statusEffectOfPotion('regeneration')).toStrictEqual({
      type: 'regeneration',
      durationSecs: POTION_EFFECT_DURATION_SECS.regeneration,
    })
  })

  it('rejects drinking while brewing, while empty, or a bottle with no effect', () => {
    const brewing: BrewingStandState = {
      fuelUnits: 1,
      bottle: { potion: 'awkward' },
      ingredient: undefined,
      brewing: { output: 'poison', remainingSecs: 5 },
    }
    expect(drinkBrewingPotion(brewing)[1]).toStrictEqual({ _tag: 'Rejected', reason: 'Brewing' })
    expect(drinkBrewingPotion(emptyBrewingStandState())[1]).toStrictEqual({
      _tag: 'Rejected',
      reason: 'Empty',
    })

    const withWater: BrewingStandState = { ...emptyBrewingStandState(), bottle: 'water_bottle' }
    expect(drinkBrewingPotion(withWater)[1]).toStrictEqual({ _tag: 'Rejected', reason: 'NoEffect' })

    const withAwkward: BrewingStandState = { ...emptyBrewingStandState(), bottle: { potion: 'awkward' } }
    expect(drinkBrewingPotion(withAwkward)[1]).toStrictEqual({ _tag: 'Rejected', reason: 'NoEffect' })
  })

  it('consumes a drinkable potion and reports its status effect', () => {
    const stand: BrewingStandState = { ...emptyBrewingStandState(), bottle: { potion: 'regeneration' } }
    const [next, result] = drinkBrewingPotion(stand)
    expect(result).toStrictEqual({
      _tag: 'Consumed',
      consumed: { item: 'potion_of_regeneration', count: 1 },
      effect: { type: 'regeneration', durationSecs: POTION_EFFECT_DURATION_SECS.regeneration },
    })
    expect(next.bottle).toBeUndefined()
  })

  it.effect('collects a bottle and stores the accepted count in one world commit', () => {
    const setup = collectionTestSetup(
      [Result.getOrThrow(itemStack('water_bottle', StackCount(1))), undefined, undefined],
    )
    const request = Schema.decodeUnknownSync(BrewingBottleCollectionRequestSchema, {
      onExcessProperty: 'error',
    })({
      brewingOwnerId: setup.brewingOwnerId,
      playerStorageOwnerId: setup.playerStorageOwnerId,
      bottleIndex: 0,
    })
    const decodeResult = Schema.decodeUnknownSync(BrewingBottleCollectionResultSchema, {
      onExcessProperty: 'error',
    })

    return Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const revisionBefore = yield* coordinator.revision
      const result = yield* collectBrewingBottleWithStorage(request)
      const brewing = yield* coordinator.snapshot(setup.brewingOwnerId, BrewingServiceStateSchema)
      const player = yield* coordinator.snapshot(
        setup.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const revisionAfter = yield* coordinator.revision

      expect(decodeResult(result)).toStrictEqual({
        _tag: 'Collected',
        item: 'water_bottle',
        count: 1,
        remainingCount: 0,
      })
      expect(() => decodeResult({ ...result, extra: true })).toThrow()
      expect(brewing.state.bottles[0]).toBeUndefined()
      expect(player.state.inventory.slots[0]?.count).toBe(1)
      expect(revisionAfter - revisionBefore).toBe(1)
    }).pipe(Effect.provide(setup.layer))
  })

  it.effect('leaves a bottle in the stand when the player storage is full', () => {
    const baseStorage = emptyPlayerStorage()
    const stoneStack = Result.getOrThrow(itemStack('stone', StackCount(64)))
    const fullStorage = {
      ...baseStorage,
      inventory: {
        slots: baseStorage.inventory.slots.map(() => stoneStack),
      },
    }
    const setup = collectionTestSetup(
      [Result.getOrThrow(itemStack('water_bottle', StackCount(1))), undefined, undefined],
      fullStorage,
    )
    const request = {
      brewingOwnerId: setup.brewingOwnerId,
      playerStorageOwnerId: setup.playerStorageOwnerId,
      bottleIndex: 0,
    }

    return Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const revisionBefore = yield* coordinator.revision
      const result = yield* collectBrewingBottleWithStorage(request)
      const brewing = yield* coordinator.snapshot(setup.brewingOwnerId, BrewingServiceStateSchema)
      const revisionAfter = yield* coordinator.revision

      expect(result).toStrictEqual({
        _tag: 'InventoryFull',
        item: 'water_bottle',
        count: 1,
      })
      expect(brewing.state.bottles[0]?.count).toBe(1)
      expect(revisionAfter).toBe(revisionBefore)
    }).pipe(Effect.provide(setup.layer))
  })
})
