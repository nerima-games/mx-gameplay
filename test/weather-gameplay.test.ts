import { Effect, Ref } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import { EntityId, EntityKind } from '@nerima-games/mc-sim'
import type { Dimension } from '@nerima-games/mc-worldgen'
import type { PositionKey } from '../src/domain/position-key'
import {
  advanceWeatherGameplay,
  isWithinLightningStrikeRadius,
  LIGHTNING_STRIKE_RADIUS_BLOCKS,
  makeWeatherGameplayState,
  type WeatherGameplayInput,
} from '../src/domain/weather-gameplay'
import {
  drainWeatherGameplayEvents,
  makeGameplayFrameState,
  restoreWeatherGameplay,
  snapshotWeatherGameplay,
} from '../src/stages/registration'

const position = (x: number, y: number, z: number): Position => ({ x, y, z })
const key = (value: string): PositionKey => value as PositionKey
const input = (overrides: Partial<WeatherGameplayInput> = {}): WeatherGameplayInput => ({
  dimension: 'overworld' as Dimension,
  difficulty: 'normal',
  blocks: [],
  entities: [],
  ...overrides,
})

describe('weather gameplay', () => {
  it('uses an inclusive spherical lightning radius', () => {
    expect(LIGHTNING_STRIKE_RADIUS_BLOCKS).toBe(3)
    expect(isWithinLightningStrikeRadius(position(3, 64, 0), position(0, 64, 0))).toBe(true)
    expect(isWithinLightningStrikeRadius(position(3.01, 64, 0), position(0, 64, 0))).toBe(false)
  })

  it('rain affects only sky-exposed fire and farmland in the overworld', () => {
    const result = advanceWeatherGameplay(
      makeWeatherGameplayState(1),
      10,
      'rain',
      input({
        blocks: [
          { position: key('0,0,0'), block: 'fire', exposedToSky: true },
          { position: key('1,0,0'), block: 'farmland', exposedToSky: true },
          { position: key('2,0,0'), block: 'fire', exposedToSky: false },
        ],
      }),
    )
    expect(result.events.map((event) => event._tag)).toEqual(['FireExtinguished', 'FarmlandHydrated'])

    const nether = advanceWeatherGameplay(
      makeWeatherGameplayState(1),
      10,
      'rain',
      input({
        dimension: 'nether' as Dimension,
        blocks: [{ position: key('0,0,0'), block: 'fire', exposedToSky: true }],
      }),
    )
    expect(nether.events).toEqual([])
  })

  it('selects lightning targets deterministically independent of candidate order', () => {
    const entities = [
      { id: EntityId('b'), kind: EntityKind('pig'), position: position(3, 64, 0), exposedToSky: true },
      { id: EntityId('a'), kind: EntityKind('creeper'), position: position(0, 64, 0), exposedToSky: true },
    ]
    const left = advanceWeatherGameplay(makeWeatherGameplayState(42), 80, 'thunder', input({ entities }))
    const right = advanceWeatherGameplay(
      makeWeatherGameplayState(42),
      80,
      'thunder',
      input({ entities: [...entities].reverse() }),
    )
    expect(right).toEqual(left)
    expect(left.events.some((event) => event._tag === 'LightningStrike')).toBe(true)
    expect(left.events.some((event) => event._tag === 'CreeperCharged')).toBe(true)
    expect(left.events.some((event) => event._tag === 'EntityTransformationRequested')).toBe(true)
  })

  it('skips lightning damage for a sheltered entity, even one standing where the strike lands', () => {
    // The only existing thunder-damage cases leave every entity exposed, so
    // the `continue` guard's `!entity.exposedToSky` clause has never fired.
    // Same position as the (sole, so deterministic) target: only shelter
    // explains the skip.
    const sheltered = { id: EntityId('sheltered'), kind: EntityKind('creeper'), position: position(0, 64, 0), exposedToSky: false }
    const struck = { id: EntityId('struck'), kind: EntityKind('pig'), position: position(0, 64, 0), exposedToSky: true }

    const result = advanceWeatherGameplay(
      makeWeatherGameplayState(1),
      5,
      'thunder',
      input({ entities: [sheltered, struck] }),
    )

    expect(result.events.filter((event) => event._tag === 'EntityLightningDamage')).toStrictEqual([
      { _tag: 'EntityLightningDamage', id: struck.id, amount: 5 },
    ])
  })

  it('skips lightning damage for an exposed entity outside the strike radius', () => {
    // Both entities are exposed and so are both candidate targets — the seed
    // picks one deterministically, but this test does not need to know which.
    // Whichever is struck, the other sits 1000 blocks away, far outside
    // LIGHTNING_STRIKE_RADIUS_BLOCKS, so exactly one of the two can ever be
    // damaged.
    const near = { id: EntityId('near'), kind: EntityKind('pig'), position: position(0, 64, 0), exposedToSky: true }
    const far = {
      id: EntityId('far'),
      kind: EntityKind('pig'),
      position: position(1000, 64, 0),
      exposedToSky: true,
    }

    const result = advanceWeatherGameplay(
      makeWeatherGameplayState(1),
      5,
      'thunder',
      input({ entities: [near, far] }),
    )

    const damaged = result.events.filter((event) => event._tag === 'EntityLightningDamage')
    expect(damaged).toHaveLength(1)
  })

  it('does not re-charge, or re-emit CreeperCharged for, an already-charged creeper', () => {
    // The one existing "preserves charged creepers" case below skips the whole
    // lightning branch via the duplicate-tick guard, so it never reaches the
    // `!chargedCreepers.includes(...)` clause itself. Striking a creeper that
    // is ALREADY charged, on a fresh tick, is the case that does.
    const alreadyCharged = EntityId('creeper')
    const state = { ...makeWeatherGameplayState(9), chargedCreepers: [alreadyCharged] }
    const entities = [
      { id: alreadyCharged, kind: EntityKind('creeper'), position: position(0, 64, 0), exposedToSky: true },
    ]

    const result = advanceWeatherGameplay(state, 5, 'thunder', input({ entities }))

    expect(result.events.some((event) => event._tag === 'CreeperCharged')).toBe(false)
    expect(result.events.some((event) => event._tag === 'EntityLightningDamage')).toBe(true)
    expect(result.state.chargedCreepers).toStrictEqual([alreadyCharged])
  })

  it('does not duplicate a restored tick and preserves charged creepers', () => {
    const entities = [
      { id: EntityId('creeper'), kind: EntityKind('creeper'), position: position(0, 64, 0), exposedToSky: true },
    ]
    const first = advanceWeatherGameplay(makeWeatherGameplayState(9), 5, 'thunder', input({ entities }))
    const restored = advanceWeatherGameplay(first.state, 5, 'thunder', input({ entities }))
    expect(restored.events).toEqual([])
    expect(restored.state).toBe(first.state)
  })

  it('peaceful lightning does not damage or transform entities', () => {
    const result = advanceWeatherGameplay(
      makeWeatherGameplayState(3),
      2,
      'thunder',
      input({
        difficulty: 'peaceful',
        entities: [{ id: EntityId('pig'), kind: EntityKind('pig'), position: position(0, 64, 0), exposedToSky: true }],
      }),
    )
    expect(result.events.map((event) => event._tag)).toEqual(['LightningStrike'])
  })

  it('never leaves exposed fire from a thunderstorm ignition', () => {
    const result = advanceWeatherGameplay(
      makeWeatherGameplayState(7),
      4,
      'thunder',
      input({
        blocks: [
          { position: key('open'), block: 'flammable', exposedToSky: true },
          { position: key('sheltered'), block: 'flammable', exposedToSky: false },
        ],
        entities: [{ id: EntityId('target'), kind: EntityKind('cow'), position: position(0, 64, 0), exposedToSky: true }],
      }),
    )
    expect(result.events).toContainEqual({ _tag: 'FireIgnited', position: key('sheltered') })
    expect(result.events).not.toContainEqual({ _tag: 'FireIgnited', position: key('open') })
  })

  it('restores snapshots defensively and drains stage events exactly once', async () => {
    const state = await Effect.runPromise(makeGameplayFrameState)
    const snapshot = {
      seed: 99,
      lastProcessedTick: 12,
      chargedCreepers: [EntityId('charged')],
    }

    await Effect.runPromise(restoreWeatherGameplay(state, snapshot))
    const restored = await Effect.runPromise(snapshotWeatherGameplay(state))
    expect(restored).toEqual(snapshot)
    expect(restored).not.toBe(snapshot)
    expect(restored.chargedCreepers).not.toBe(snapshot.chargedCreepers)

    const event = { _tag: 'FarmlandHydrated' as const, position: key('farm') }
    await Effect.runPromise(Ref.set(state.weatherGameplayEvents, [event]))
    expect(await Effect.runPromise(drainWeatherGameplayEvents(state))).toEqual([event])
    expect(await Effect.runPromise(drainWeatherGameplayEvents(state))).toEqual([])
  })
})
