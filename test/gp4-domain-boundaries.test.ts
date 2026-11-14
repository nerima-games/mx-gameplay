import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref, Result } from 'effect'
import { BlockAxis, DeltaTimeSecs, PositionAxis, blockPosition, position as kernelPosition } from '@nerima-games/mc-kernel'
import type { Position } from '@nerima-games/mc-kernel'
import { EntityId, EntityKind } from '@nerima-games/mc-sim'
import { resolveBedSleep } from '../src/domain/bed-sleep'
import { applyDamage, deathMessage, fullHealth, type Damage, type Vitals } from '../src/domain/death-cause'
import { enchantmentOffer, enchantmentOffers, rerollEnchantmentSeed } from '../src/domain/enchantment'
import {
  INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
  resolveEnvironmentalContactDamage,
  type EnvironmentalContact,
  type EnvironmentalContactDamageState,
} from '../src/domain/environmental-contact-damage'
import {
  advanceFireLifecycle,
  makeFireLifecycleSnapshot,
  makeFireLifecycleState,
  type FireActorContact,
  type FireCell,
  type FireLifecycleState,
  type FirePosition,
} from '../src/domain/fire-lifecycle'
import { rollAt } from '../src/domain/frame-rolls'
import { applyLook, INITIAL_PLAYER_POSE } from '../src/domain/in-memory-player'
import { makeGeneratedWorld, makeInMemoryWorld, type WorldContents } from '../src/domain/in-memory-world'
import { explosionDamageAmount, explosionDamageAt, type Explosion } from '../src/domain/mob/explosion'
import { pursueHorizontally, resolvePlayerBlastDamage, ZOMBIE_LOCOMOTION, type PlayerBlast } from '../src/domain/mob/hostile-combat'
import { despawnVerdict, type DespawnCandidate } from '../src/domain/mob/hostile-despawn'
import { canMobSpawnAt, type SpawnCandidate } from '../src/domain/mob/hostile-spawn'
import type { SurvivalDifficulty } from '../src/domain/survival-hunger'
import { resolveNextWeatherState, resolveWeatherDurationSecs, type Weather, type WeatherRolls } from '../src/domain/weather'
import { makeTimeWeatherStage } from '../src/stages/time-weather-stage'
import { makeGameplayFrameState, type GameplayStageContext } from '../src/stages/registration-core'
import { FrameServicesLayer } from './support/frame-services'

const origin = kernelPosition(PositionAxis(0), PositionAxis(64), PositionAxis(0))

describe('persisted gameplay input boundaries', () => {
  it('rejects an unreadable sleep clock rather than accepting or refusing as daytime', () => {
    expect(resolveBedSleep({
      bedPosition: blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0)),
      dangerNearby: false,
      dimension: 'overworld',
      timeOfDay: Number.NaN,
      weather: 'clear',
    })).toStrictEqual(Result.fail({ _tag: 'InvalidDayNightInput', field: 'timeOfDay' }))
  })

  it('rejects malformed damage shapes and preserves the original vitals', () => {
    const damage: Damage = { amount: 1, cause: 'mob' }
    expect(applyDamage(null as unknown as Vitals, damage)).toStrictEqual(Result.fail({
      _tag: 'InvalidDamageApplicationInput', field: 'vitals',
    }))
    expect(applyDamage(fullHealth, null as unknown as Damage)).toStrictEqual(Result.fail({
      _tag: 'InvalidDamageApplicationInput', field: 'damage',
    }))
    expect(applyDamage({ ...fullHealth, healthPoints: 21 }, damage)).toStrictEqual(Result.fail({
      _tag: 'InvalidDamageApplicationInput', field: 'vitals.healthPoints',
    }))
    expect(applyDamage(fullHealth, { amount: 1, cause: 'unknown' } as unknown as Damage)).toStrictEqual(Result.fail({
      _tag: 'InvalidDamageApplicationInput', field: 'damage.cause',
    }))
    expect(deathMessage(null as unknown as Vitals)).toStrictEqual(Result.fail({
      _tag: 'InvalidDeathMessageInput', field: 'vitals',
    }))
    expect(deathMessage({ healthPoints: 0, lastDeathCause: 'unknown' } as unknown as Vitals)).toStrictEqual(Result.fail({
      _tag: 'InvalidDeathMessageInput', field: 'vitals.lastDeathCause',
    }))
    expect(fullHealth).toStrictEqual({ healthPoints: 20, lastDeathCause: undefined })
  })

  it('rejects invalid enchantment seed and slot without publishing offers', () => {
    expect(rerollEnchantmentSeed(Number.NaN)).toStrictEqual(Result.fail({ _tag: 'InvalidEnchantmentOfferInput', field: 'seed' }))
    expect(enchantmentOffer(1, 0, 3 as 0)).toStrictEqual(Result.fail({ _tag: 'InvalidEnchantmentOfferInput', field: 'slot' }))
    expect(enchantmentOffers(Number.NaN, 0)).toStrictEqual(Result.fail({ _tag: 'InvalidEnchantmentOfferInput', field: 'seed' }))
  })

  it('does not treat malformed contacts or contact history as an empty safe set', () => {
    const base = INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE
    for (const [state, contacts, field] of [
      [null, [], 'state.lastDamageElapsedSecs'],
      [base, null, 'contacts'],
      [base, [null], 'contacts'],
      [base, [{ block: 'stone', contactDamage: 1 }], 'contacts.block'],
      [{ lastDamageElapsedSecs: Number.NaN }, [], 'state.lastDamageElapsedSecs'],
    ] as const) {
      expect(resolveEnvironmentalContactDamage(
        state as EnvironmentalContactDamageState,
        contacts as unknown as ReadonlyArray<EnvironmentalContact>,
        1,
      )).toStrictEqual(Result.fail({ _tag: 'InvalidEnvironmentalContactDamageInput', field }))
    }
  })

  it('rejects missing entries in a sparse externally supplied roll batch', () => {
    expect(rollAt({ rolls: Array<number>(1), seed: 1 }, 0)).toStrictEqual(Result.fail({
      _tag: 'InvalidFrameRollInput', field: 'index',
    }))
  })

  it('rejects pitch addition overflow instead of clamping an unreadable angle', () => {
    expect(applyLook({ ...INITIAL_PLAYER_POSE, pitchRadians: Number.MAX_VALUE }, 0, Number.MAX_VALUE)).toStrictEqual(Result.fail({
      _tag: 'PlayerServiceInputError', reason: 'invalid-look', field: 'pitchRadians',
    }))
  })

  it('rejects invalid weather names and incomplete transition rolls', () => {
    expect(resolveWeatherDurationSecs('snow' as Weather, 0)).toStrictEqual(Result.fail({ _tag: 'InvalidWeatherInput', field: 'weather' }))
    for (const [current, rolls, field] of [
      ['snow', { transition: 0, duration: 0 }, 'weather'],
      ['clear', null, 'rolls'],
      ['clear', { duration: 0 }, 'transition'],
      ['clear', { transition: 0 }, 'duration'],
      ['clear', { transition: 0, duration: Number.NaN }, 'duration'],
    ] as const) {
      expect(resolveNextWeatherState(current as Weather, rolls as WeatherRolls)).toStrictEqual(Result.fail({
        _tag: 'InvalidWeatherInput', field,
      }))
    }
  })
})

describe('fire input boundaries', () => {
  const position = { x: 0, y: 64, z: 0 }
  const state: FireLifecycleState = { fires: [], seed: 1 }

  it('rejects malformed saved fire and burning-actor records before advancing', () => {
    for (const [input, field] of [
      [null, 'fires'],
      [{ fires: null, seed: 1 }, 'fires'],
      [{ fires: [], seed: Number.NaN }, 'seed'],
      [{ fires: [null], seed: 1 }, 'position'],
      [{ fires: [{ position: null, ageTicks: 0 }], seed: 1 }, 'position'],
      [{ fires: [{ position, ageTicks: -1 }], seed: 1 }, 'ageTicks'],
      [{ fires: [], seed: 1, burningActors: {} }, 'burningActors'],
      [{ fires: [], seed: 1, burningActors: [null] }, 'burningActor'],
      [{ fires: [], seed: 1, burningActors: [{ id: 'player', kind: 'player', position, remainingTicks: 0, damageCooldownTicks: 0 }] }, 'burningActor'],
    ] as const) {
      expect(advanceFireLifecycle(input as unknown as FireLifecycleState, [], 'clear')).toStrictEqual(Result.fail({
        _tag: 'InvalidFireLifecycleInput', field,
      }))
      expect(makeFireLifecycleSnapshot(input as unknown as FireLifecycleState, 0)).toStrictEqual(Result.fail({
        _tag: 'InvalidFireLifecycleInput', field,
      }))
    }
  })

  it('rejects malformed cells, contacts, weather, and difficulty without mutations', () => {
    for (const cells of [null, [null]] as const) {
      expect(advanceFireLifecycle(state, cells as unknown as ReadonlyArray<FireCell>, 'clear')).toStrictEqual(Result.fail({
        _tag: 'InvalidFireLifecycleInput', field: cells === null ? 'cells' : 'cell',
      }))
    }
    for (const contacts of [null, [null], [{ x: Number.NaN, y: 64, z: 0 }], [{ id: 'broken', position, kind: 'unknown' }]] as const) {
      expect(advanceFireLifecycle(state, [], 'clear', contacts as unknown as ReadonlyArray<FireActorContact>)).toStrictEqual(Result.fail({
        _tag: 'InvalidFireLifecycleInput', field: contacts === null ? 'contacts' : 'contact',
      }))
    }
    expect(advanceFireLifecycle(state, [], 'clear', undefined as unknown as [])).toStrictEqual(Result.fail({
      _tag: 'InvalidFireLifecycleInput', field: 'contacts',
    }))
    expect(advanceFireLifecycle(state, [], 'clear', [], undefined as unknown as SurvivalDifficulty)).toStrictEqual(Result.fail({
      _tag: 'InvalidFireLifecycleInput', field: 'difficulty',
    }))
    expect(advanceFireLifecycle(state, [], 'snow' as Weather)).toStrictEqual(Result.fail({ _tag: 'InvalidFireLifecycleInput', field: 'weather' }))
    expect(advanceFireLifecycle(state, [], 'clear', [], 'unknown' as SurvivalDifficulty)).toStrictEqual(Result.fail({ _tag: 'InvalidFireLifecycleInput', field: 'difficulty' }))
    expect(makeFireLifecycleState([null] as unknown as ReadonlyArray<FirePosition>, 1)).toStrictEqual(Result.fail({ _tag: 'InvalidFireLifecycleInput', field: 'position' }))
    expect(makeFireLifecycleState([], Number.NaN)).toStrictEqual(Result.fail({ _tag: 'InvalidFrameRollInput', field: 'seed' }))
  })
})

describe('mob domain input boundaries', () => {
  it('rejects malformed pursuit positions, locomotion, and overflowing distances', () => {
    for (const [from, target, locomotion, field] of [
      [null, origin, ZOMBIE_LOCOMOTION, 'from'],
      [origin, null, ZOMBIE_LOCOMOTION, 'target'],
      [origin, origin, null, 'locomotion'],
      [origin, origin, { ...ZOMBIE_LOCOMOTION, speedBlocksPerSecond: -1 }, 'speedBlocksPerSecond'],
      [origin, origin, { ...ZOMBIE_LOCOMOTION, stoppingDistanceBlocks: -1 }, 'stoppingDistanceBlocks'],
      [{ x: Number.MAX_VALUE, y: 64, z: 0 }, { x: -Number.MAX_VALUE, y: 64, z: 0 }, ZOMBIE_LOCOMOTION, 'distance'],
    ] as const) {
      expect(pursueHorizontally(from as Position, target as Position, 0.05, locomotion as typeof ZOMBIE_LOCOMOTION)).toStrictEqual(Result.fail({
        _tag: 'InvalidPursuitInput', field,
      }))
    }
  })

  it('rejects malformed despawn fields before applying persistence exemptions', () => {
    const candidate: DespawnCandidate = { persistent: true, distanceToPlayerBlocks: 0 }
    for (const [value, field] of [
      [null, 'candidate'],
      [{ ...candidate, persistent: null }, 'persistent'],
      [{ ...candidate, named: undefined }, 'named'],
      [{ ...candidate, tamed: undefined }, 'tamed'],
      [{ ...candidate, ageTicks: '1' }, 'ageTicks'],
      [{ ...candidate, randomRoll: undefined }, 'randomRoll'],
      [{ ...candidate, difficulty: 'unknown' }, 'difficulty'],
    ] as const) {
      expect(despawnVerdict(value as unknown as DespawnCandidate)).toStrictEqual(Result.fail({ _tag: 'InvalidDespawnCandidate', field }))
    }
    expect(canMobSpawnAt(EntityKind('cow'), { dimension: 'unknown' } as unknown as SpawnCandidate)).toStrictEqual({
      _tag: 'InvalidSpawnCandidate', field: 'dimension',
    })
  })

  it('rejects malformed blast records and numeric overflow without dropping the cause', () => {
    const validBlast: PlayerBlast = {
      source: EntityId('tnt:one'),
      kind: EntityKind('tnt'),
      at: origin,
      explosion: { source: 'tnt', power: 4 },
    }
    for (const [blasts, target, difficulty, field] of [
      [null, origin, 'normal', 'blasts'],
      [[], null, 'normal', 'target'],
      [[null], origin, 'normal', 'position'],
      [[{ ...validBlast, explosion: null }], origin, 'normal', 'explosion'],
      [[], origin, 'unknown', 'difficulty'],
    ] as const) {
      expect(resolvePlayerBlastDamage(blasts as unknown as ReadonlyArray<PlayerBlast>, target as Position, difficulty as SurvivalDifficulty)).toStrictEqual(Result.fail({
        _tag: 'InvalidPlayerBlastDamageInput', field,
      }))
    }
    expect(resolvePlayerBlastDamage([{ ...validBlast, explosion: { source: 'tnt', power: -1 } }], origin)).toStrictEqual(Result.fail({
      _tag: 'InvalidExplosionInput', field: 'power',
    }))
    expect(explosionDamageAt(null as unknown as Explosion, 0)).toStrictEqual(Result.fail({ _tag: 'InvalidExplosionInput', field: 'power' }))
    expect(explosionDamageAmount(Number.MAX_VALUE / 4, 0)).toStrictEqual(Result.fail({ _tag: 'InvalidExplosionInput', field: 'damageAmount' }))
  })
})

describe('world input boundaries', () => {
  it.effect('rejects malformed world contents and loaded coordinates', () => Effect.gen(function* () {
    for (const world of [null, { blocks: new Map(), loaded: 1 }, { blocks: new Map(), loaded: [1] }, { blocks: new Map(), loaded: '0,0' }]) {
      const failure = yield* Effect.flip(makeInMemoryWorld({ world: world as unknown as WorldContents }))
      expect(failure).toMatchObject({ _tag: 'WorldInputFailure', reason: 'invalid' })
    }
    for (const options of [{ seed: 0.5 }, { spawnX: null }, { spawnZ: null }, { yawRadians: null }, { pitchRadians: null }, { chunkSource: null }]) {
      const field = Object.keys(options)[0]
      expect(yield* Effect.flip(makeGeneratedWorld(options as unknown as Parameters<typeof makeGeneratedWorld>[0]))).toStrictEqual({
        _tag: 'WorldInputFailure', field, reason: 'invalid',
      })
    }
    for (const field of ['yawRadians', 'pitchRadians'] as const) {
      expect(yield* Effect.flip(makeGeneratedWorld({ [field]: undefined }))).toStrictEqual({
        _tag: 'WorldInputFailure', field, reason: 'undefined',
      })
    }
  }))
})

describe('time-weather stage data faults', () => {
  it.effect('records invalid persisted weather and seed without publishing a transition', () => Effect.gen(function* () {
    const state = yield* makeGameplayFrameState
    const stage = makeTimeWeatherStage({ state } as GameplayStageContext)
    yield* Ref.set(state.weather, { weather: 'clear' as const, remainingSecs: 0 })
    yield* stage.run(DeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer))
    expect(yield* Ref.get(state.operationFailures)).toMatchObject([{ error: { _tag: 'InvalidWeatherInput', field: 'state' } }])
    expect(yield* Ref.get(state.weatherAdvanced)).toBeUndefined()
    yield* Ref.set(state.operationFailures, [])
    yield* Ref.set(state.weather, { weather: 'clear' as const, remainingSecs: 0.01 })
    yield* Ref.set(state.rollSeed, Number.NaN)
    yield* stage.run(DeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer))
    expect(yield* Ref.get(state.operationFailures)).toMatchObject([{ error: { _tag: 'InvalidFrameRollInput', field: 'seed' } }])
    expect(yield* Ref.get(state.weatherAdvanced)).toBeUndefined()
  }))
})
