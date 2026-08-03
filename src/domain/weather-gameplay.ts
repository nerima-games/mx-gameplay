import type { Position } from '@nerima-games/mc-kernel'
import type { EntityId, EntityKind } from '@nerima-games/mc-sim'
import type { Dimension } from './nether-travel-port'
import type { PositionKey } from './position-key'
import type { Weather } from './weather'

export type WeatherDifficulty = 'peaceful' | 'easy' | 'normal' | 'hard'

export type WeatherBlockCandidate = {
  readonly position: PositionKey
  readonly block: 'fire' | 'farmland' | 'flammable' | 'other'
  readonly exposedToSky: boolean
}

export type WeatherEntityCandidate = {
  readonly id: EntityId
  readonly kind: EntityKind
  readonly position: Position
  readonly exposedToSky: boolean
}

export type WeatherGameplayInput = {
  readonly dimension: Dimension
  readonly difficulty: WeatherDifficulty
  readonly blocks: ReadonlyArray<WeatherBlockCandidate>
  readonly entities: ReadonlyArray<WeatherEntityCandidate>
}

export type WeatherGameplayEvent =
  | { readonly _tag: 'FireExtinguished'; readonly position: PositionKey }
  | { readonly _tag: 'FarmlandHydrated'; readonly position: PositionKey }
  | { readonly _tag: 'LightningStrike'; readonly position: Position }
  | { readonly _tag: 'EntityLightningDamage'; readonly id: EntityId; readonly amount: number }
  | { readonly _tag: 'CreeperCharged'; readonly id: EntityId }
  | {
      readonly _tag: 'EntityTransformationRequested'
      readonly id: EntityId
      readonly from: EntityKind
      readonly to: EntityKind
    }
  | { readonly _tag: 'FireIgnited'; readonly position: PositionKey }

export type WeatherGameplayState = {
  readonly seed: number
  readonly lastProcessedTick: number | undefined
  readonly chargedCreepers: ReadonlyArray<EntityId>
}

export type WeatherGameplayStep = {
  readonly state: WeatherGameplayState
  readonly events: ReadonlyArray<WeatherGameplayEvent>
}

export const makeWeatherGameplayState = (seed: number): WeatherGameplayState => ({
  seed: seed >>> 0,
  lastProcessedTick: undefined,
  chargedCreepers: [],
})

const nextSeed = (seed: number): number => (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
const entityOrder = (left: WeatherEntityCandidate, right: WeatherEntityCandidate): number =>
  String(left.id).localeCompare(String(right.id))
const blockOrder = (left: WeatherBlockCandidate, right: WeatherBlockCandidate): number =>
  String(left.position).localeCompare(String(right.position))
const distanceSquared = (left: Position, right: Position): number =>
  (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2

const LIGHTNING_DAMAGE: Record<WeatherDifficulty, number> = {
  peaceful: 0,
  easy: 3,
  normal: 5,
  hard: 7,
}

/**
 * Resolve weather consequences once for a simulation tick. Absolute time is
 * deliberately absent: sleeping may jump the day clock without replaying a
 * tick, while snapshot restore retains the duplicate guard.
 */
export const advanceWeatherGameplay = (
  state: WeatherGameplayState,
  tick: number,
  weather: Weather,
  input: WeatherGameplayInput,
): WeatherGameplayStep => {
  if (state.lastProcessedTick === tick) return { state, events: [] }

  const events: Array<WeatherGameplayEvent> = []
  const blocks = [...input.blocks].sort(blockOrder)
  const entities = [...input.entities].sort(entityOrder)
  const inWeatherDimension = input.dimension === 'overworld'

  if (inWeatherDimension && weather !== 'clear') {
    for (const candidate of blocks) {
      if (!candidate.exposedToSky) continue
      if (candidate.block === 'fire') events.push({ _tag: 'FireExtinguished', position: candidate.position })
      if (candidate.block === 'farmland') events.push({ _tag: 'FarmlandHydrated', position: candidate.position })
    }
  }

  let seed = state.seed
  let chargedCreepers = state.chargedCreepers
  if (inWeatherDimension && weather === 'thunder') {
    const targets = entities.filter((entity) => entity.exposedToSky)
    if (targets.length > 0) {
      seed = nextSeed(seed ^ (tick >>> 0))
      const target = targets[seed % targets.length]!
      events.push({ _tag: 'LightningStrike', position: target.position })

      const damage = LIGHTNING_DAMAGE[input.difficulty]
      if (damage > 0) {
        for (const entity of entities) {
          if (!entity.exposedToSky || distanceSquared(entity.position, target.position) > 9) continue
          events.push({ _tag: 'EntityLightningDamage', id: entity.id, amount: damage })
          if (String(entity.kind) === 'creeper' && !chargedCreepers.includes(entity.id)) {
            chargedCreepers = [...chargedCreepers, entity.id].sort((a, b) => String(a).localeCompare(String(b)))
            events.push({ _tag: 'CreeperCharged', id: entity.id })
          }
          if (String(entity.kind) === 'pig') {
            events.push({
              _tag: 'EntityTransformationRequested',
              id: entity.id,
              from: entity.kind,
              to: 'zombified_piglin' as EntityKind,
            })
          }
        }
      }
    }

    // Thunder includes rain: only sheltered flammables can retain ignition.
    const ignitionTargets = blocks.filter(
      (candidate) => candidate.block === 'flammable' && !candidate.exposedToSky,
    )
    if (ignitionTargets.length > 0 && entities.some((entity) => entity.exposedToSky)) {
      seed = nextSeed(seed)
      events.push({ _tag: 'FireIgnited', position: ignitionTargets[seed % ignitionTargets.length]!.position })
    }
  }

  return {
    state: { seed, lastProcessedTick: tick, chargedCreepers },
    events,
  }
}
