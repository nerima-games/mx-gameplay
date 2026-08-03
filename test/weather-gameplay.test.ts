import { Effect, Ref } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import { EntityId, EntityKind } from '@nerima-games/mc-sim'
import type { Dimension } from '@nerima-games/mc-worldgen'
import type { PositionKey } from '../src/domain/position-key'
import {
  advanceWeatherGameplay,
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
