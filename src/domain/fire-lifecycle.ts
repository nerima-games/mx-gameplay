import type { Damage } from './death-cause'
import { nextRoll, normaliseSeed } from './frame-rolls'
import type { Weather } from './weather'

export type FirePosition = { readonly x: number; readonly y: number; readonly z: number }
export type FireCell = {
  readonly position: FirePosition
  readonly block: string
  readonly exposedToSky?: boolean
}
export type ActiveFire = { readonly position: FirePosition; readonly ageTicks: number }
export type FireLifecycleState = { readonly fires: ReadonlyArray<ActiveFire>; readonly seed: number }
export type FireMutation = { readonly position: FirePosition; readonly block: 'air' | 'fire' }
export type FireContactDamage = {
  readonly _tag: 'FireContact'
  readonly at: FirePosition
  readonly damage: Damage
}
export type FireLifecycleStep = {
  readonly state: FireLifecycleState
  readonly mutations: ReadonlyArray<FireMutation>
  readonly damages: ReadonlyArray<FireContactDamage>
}

export const FIRE_NATURAL_LIFETIME_TICKS = 8
export const FIRE_SPREAD_CHANCE = 0.3
export const FIRE_CONTACT_DAMAGE: Damage = { amount: 1, cause: 'fire' }

const FLAMMABLE = new Set([
  'oak_log', 'oak_planks', 'oak_leaves', 'oak_stairs', 'crafting_table', 'chest',
  'door', 'ladder', 'sapling', 'tall_grass', 'fern', 'wheat_crop', 'potato_crop',
])
const offsets = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]] as const
const key = (p: FirePosition): string => `${p.x},${p.y},${p.z}`
const compare = (a: FirePosition, b: FirePosition): number => a.x - b.x || a.y - b.y || a.z - b.z

export const makeFireLifecycleState = (
  positions: ReadonlyArray<FirePosition>,
  seed: number,
): FireLifecycleState => ({
  fires: [...new Map(positions.map((position) => [key(position), { position, ageTicks: 0 }])).values()]
    .sort((a, b) => compare(a.position, b.position)),
  seed: normaliseSeed(seed),
})

/** Advances one deterministic fire tick from a caller-provided loaded-cell snapshot. */
export const advanceFireLifecycle = (
  state: FireLifecycleState,
  cells: ReadonlyArray<FireCell>,
  weather: Weather,
  contacted: ReadonlyArray<FirePosition> = [],
): FireLifecycleStep => {
  const cellByKey = new Map(cells.map((cell) => [key(cell.position), cell]))
  const active = [...state.fires].sort((a, b) => compare(a.position, b.position))
  const survivors: ActiveFire[] = []
  const mutations = new Map<string, FireMutation>()
  const additions = new Map<string, ActiveFire>()
  let seed = state.seed

  for (const fire of active) {
    const cell = cellByKey.get(key(fire.position))
    if (cell?.block !== 'fire') continue
    if (weather !== 'clear' && cell.exposedToSky === true) {
      mutations.set(key(fire.position), { position: fire.position, block: 'air' })
      continue
    }
    const ageTicks = fire.ageTicks + 1
    if (ageTicks >= FIRE_NATURAL_LIFETIME_TICKS) {
      mutations.set(key(fire.position), { position: fire.position, block: 'air' })
      continue
    }
    survivors.push({ position: fire.position, ageTicks })
    for (const [dx, dy, dz] of offsets) {
      const position = { x: fire.position.x + dx, y: fire.position.y + dy, z: fire.position.z + dz }
      const neighbour = cellByKey.get(key(position))
      if (neighbour === undefined || !FLAMMABLE.has(neighbour.block) || additions.has(key(position))) continue
      const draw = nextRoll(seed)
      seed = draw.seed
      if (draw.roll < FIRE_SPREAD_CHANCE) {
        mutations.set(key(position), { position, block: 'fire' })
        additions.set(key(position), { position, ageTicks: 0 })
      }
    }
  }

  const fires = [...survivors, ...additions.values()].sort((a, b) => compare(a.position, b.position))
  const orderedMutations = [...mutations.values()].sort((a, b) => compare(a.position, b.position))
  const fireKeys = new Set(fires.map((fire) => key(fire.position)))
  const damages = [...new Map(contacted.map((position) => [key(position), position])).values()]
    .filter((position) => fireKeys.has(key(position)))
    .sort(compare)
    .map((at): FireContactDamage => ({ _tag: 'FireContact', at, damage: FIRE_CONTACT_DAMAGE }))
  return { state: { fires, seed }, mutations: orderedMutations, damages }
}
