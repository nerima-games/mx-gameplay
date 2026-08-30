import type { Damage } from './death-cause.js'
import { nextRoll, normaliseSeed } from './frame-rolls.js'
import type { SurvivalDifficulty } from './survival-hunger.js'
import type { Weather } from './weather.js'

export type FirePosition = { readonly x: number; readonly y: number; readonly z: number }
export type FireCell = {
  readonly position: FirePosition
  readonly block: string
  readonly exposedToSky?: boolean
}
export type ActiveFire = {
  readonly position: FirePosition
  readonly ageTicks: number
  readonly unloadedRetries?: number
}
export type BurningActor = {
  readonly id: string
  readonly kind: 'player' | 'entity'
  readonly position: FirePosition
  readonly remainingTicks: number
  readonly damageCooldownTicks: number
}
export type FireLifecycleState = {
  readonly fires: ReadonlyArray<ActiveFire>
  readonly burningActors?: ReadonlyArray<BurningActor>
  readonly seed: number
}
export type FireLifecycleSnapshot = {
  readonly version: typeof FIRE_LIFECYCLE_SNAPSHOT_VERSION
  readonly fires: ReadonlyArray<ActiveFire>
  readonly burningActors: ReadonlyArray<BurningActor>
  readonly seed: number
  readonly tickAccumulatorSecs: number
}
export type FireMutation = { readonly position: FirePosition; readonly block: 'air' | 'fire' }
export type FireActorContact = {
  readonly id: string
  readonly kind: 'player' | 'entity'
  readonly position: FirePosition
  readonly alive?: boolean
  readonly inWater?: boolean
  readonly exposedToSky?: boolean
}
export type FireContactDamage = {
  readonly _tag: 'FireContact'
  readonly at: FirePosition
  readonly damage: Damage
}
export type FireEntityDamage = {
  readonly actorId: string
  readonly at: FirePosition
  readonly damage: Damage
}
export type FireLifecycleStep = {
  readonly state: FireLifecycleState
  readonly mutations: ReadonlyArray<FireMutation>
  readonly damages: ReadonlyArray<FireContactDamage>
  readonly entityDamages: ReadonlyArray<FireEntityDamage>
}

export const FIRE_LIFECYCLE_SNAPSHOT_VERSION = 1
export const FIRE_NATURAL_LIFETIME_TICKS = 8
/** Fire simulation runs at 20 Hz independently of the host render cadence. */
export const FIRE_TICK_INTERVAL_SECS: number = 1 / 20
export const FIRE_SPREAD_CHANCE = 0.3
export const FIRE_CONTACT_DAMAGE: Damage = { amount: 1, cause: 'fire' }
export const FIRE_BURN_DURATION_TICKS = 80
export const FIRE_DAMAGE_INTERVAL_TICKS = 20
export const FIRE_UNLOADED_RETRY_LIMIT = 3
export const FIRE_FRAME_TICK_BUDGET = 4
export const FIRE_WORK_BUDGET = 128
/** A cell value used by the stage to distinguish an unloaded chunk from air. */
export const FIRE_UNAVAILABLE_BLOCK = '__fire_chunk_unavailable__'

const FLAMMABLE = new Set([
  'oak_log', 'oak_planks', 'oak_leaves', 'oak_stairs', 'crafting_table', 'chest',
  'door', 'ladder', 'sapling', 'tall_grass', 'fern', 'wheat_crop', 'potato_crop',
])
const offsets = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]] as const
const key = (p: FirePosition): string => `${p.x},${p.y},${p.z}`
const compare = (a: FirePosition, b: FirePosition): number => a.x - b.x || a.y - b.y || a.z - b.z
const copyPosition = (position: FirePosition): FirePosition => ({ ...position })

const fireDamageFor = (difficulty: SurvivalDifficulty): Damage | undefined => {
  if (difficulty === 'peaceful') return undefined
  return { amount: difficulty === 'hard' ? 2 : 1, cause: 'fire' }
}

const actorInput = (
  contacted: ReadonlyArray<FirePosition | FireActorContact>,
): ReadonlyArray<FireActorContact> => {
  const actors = new Map<string, FireActorContact>()
  for (const contact of contacted) {
    const actor = 'id' in contact
      ? contact
      : { id: 'player', kind: 'player' as const, position: contact }
    actors.set(actor.id, actor)
  }
  return [...actors.values()].sort((a, b) => a.id.localeCompare(b.id))
}

const supported = (
  position: FirePosition,
  cellByKey: ReadonlyMap<string, FireCell>,
): boolean => {
  const below = cellByKey.get(key({ x: position.x, y: position.y - 1, z: position.z }))
  if (below === undefined || below.block === FIRE_UNAVAILABLE_BLOCK) return true
  if (below.block !== 'air' && below.block !== 'water') return true
  return offsets.some(([dx, dy, dz]) => {
    const neighbour = cellByKey.get(key({ x: position.x + dx, y: position.y + dy, z: position.z + dz }))
    return neighbour !== undefined && FLAMMABLE.has(neighbour.block)
  })
}

export const makeFireLifecycleState = (
  positions: ReadonlyArray<FirePosition>,
  seed: number,
): FireLifecycleState => ({
  fires: [...new Map(positions.map((position) => [key(position), { position, ageTicks: 0 }])).values()]
    .sort((a, b) => compare(a.position, b.position)),
  seed: normaliseSeed(seed),
})

export const extinguishFire = (
  state: FireLifecycleState,
  position: FirePosition,
): FireLifecycleState => ({
  ...state,
  fires: state.fires.filter((fire) => key(fire.position) !== key(position)),
})

export const makeFireLifecycleSnapshot = (
  state: FireLifecycleState,
  tickAccumulatorSecs: number,
): FireLifecycleSnapshot => ({
  version: FIRE_LIFECYCLE_SNAPSHOT_VERSION,
  fires: state.fires.map((fire) => ({ ...fire, position: copyPosition(fire.position) })),
  burningActors: (state.burningActors ?? []).map((actor) => ({
    ...actor,
    position: copyPosition(actor.position),
  })),
  seed: normaliseSeed(state.seed),
  tickAccumulatorSecs: Number.isFinite(tickAccumulatorSecs)
    ? Math.max(0, Math.min(FIRE_TICK_INTERVAL_SECS * FIRE_FRAME_TICK_BUDGET, tickAccumulatorSecs))
    : 0,
})

export const isFireLifecycleSnapshot = (value: unknown): value is FireLifecycleSnapshot => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<FireLifecycleSnapshot>
  return candidate.version === FIRE_LIFECYCLE_SNAPSHOT_VERSION &&
    Array.isArray(candidate.fires) &&
    candidate.fires.every((fire) =>
      typeof fire === 'object' && fire !== null &&
      typeof fire.position === 'object' && fire.position !== null &&
      Number.isFinite(fire.position.x) && Number.isFinite(fire.position.y) &&
      Number.isFinite(fire.position.z) && Number.isInteger(fire.ageTicks) && fire.ageTicks >= 0 &&
      (fire.unloadedRetries === undefined ||
        (Number.isInteger(fire.unloadedRetries) && fire.unloadedRetries >= 0)),
    ) &&
    Array.isArray(candidate.burningActors) &&
    candidate.burningActors.every((actor) =>
      typeof actor === 'object' && actor !== null && typeof actor.id === 'string' &&
      (actor.kind === 'player' || actor.kind === 'entity') &&
      typeof actor.position === 'object' && actor.position !== null &&
      Number.isFinite(actor.position.x) && Number.isFinite(actor.position.y) &&
      Number.isFinite(actor.position.z) && Number.isInteger(actor.remainingTicks) &&
      actor.remainingTicks > 0 && Number.isInteger(actor.damageCooldownTicks) &&
      actor.damageCooldownTicks >= 0,
    ) &&
    typeof candidate.seed === 'number' && Number.isFinite(candidate.seed) &&
    typeof candidate.tickAccumulatorSecs === 'number' && Number.isFinite(candidate.tickAccumulatorSecs) &&
    candidate.tickAccumulatorSecs >= 0
}

export const restoreFireLifecycleSnapshot = (
  snapshot: FireLifecycleSnapshot,
): { readonly state: FireLifecycleState; readonly tickAccumulatorSecs: number } => ({
  state: {
    fires: snapshot.fires.map((fire) => ({ ...fire, position: copyPosition(fire.position) })),
    burningActors: snapshot.burningActors.map((actor) => ({
      ...actor,
      position: copyPosition(actor.position),
    })),
    seed: normaliseSeed(snapshot.seed),
  },
  tickAccumulatorSecs: Math.max(
    0,
    Math.min(FIRE_TICK_INTERVAL_SECS * FIRE_FRAME_TICK_BUDGET, snapshot.tickAccumulatorSecs),
  ),
})

const advanceBurningActors = (
  state: FireLifecycleState,
  contacts: ReadonlyArray<FireActorContact>,
  fireKeys: ReadonlySet<string>,
  weather: Weather,
  difficulty: SurvivalDifficulty,
): Pick<FireLifecycleStep, 'damages' | 'entityDamages'> & {
  readonly burningActors: ReadonlyArray<BurningActor>
} => {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const burningById = new Map((state.burningActors ?? []).map((actor) => [actor.id, actor]))
  for (const contact of contacts) {
    if (contact.alive === false || contact.inWater === true) {
      burningById.delete(contact.id)
      continue
    }
    if (fireKeys.has(key(contact.position))) {
      const current = burningById.get(contact.id)
      burningById.set(contact.id, {
        id: contact.id,
        kind: contact.kind,
        position: copyPosition(contact.position),
        remainingTicks: Math.max(current?.remainingTicks ?? 0, FIRE_BURN_DURATION_TICKS),
        damageCooldownTicks: current?.damageCooldownTicks ?? 0,
      })
    }
  }

  const burningActors: BurningActor[] = []
  const damages: FireContactDamage[] = []
  const entityDamages: FireEntityDamage[] = []
  const damage = fireDamageFor(difficulty)
  for (const actor of [...burningById.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const contact = contactById.get(actor.id)
    if (contact === undefined) {
      burningActors.push(actor)
      continue
    }
    if (contact.alive === false || contact.inWater === true ||
      (weather !== 'clear' && contact.exposedToSky === true)) continue
    const remainingTicks = actor.remainingTicks - 1
    if (remainingTicks <= 0) continue
    const position = copyPosition(contact.position)
    const shouldDamage = actor.damageCooldownTicks <= 0 && damage !== undefined
    if (shouldDamage) {
      if (actor.kind === 'player') damages.push({ _tag: 'FireContact', at: position, damage })
      else entityDamages.push({ actorId: actor.id, at: position, damage })
    }
    burningActors.push({
      ...actor,
      position,
      remainingTicks,
      damageCooldownTicks: shouldDamage
        ? FIRE_DAMAGE_INTERVAL_TICKS - 1
        : Math.max(0, actor.damageCooldownTicks - 1),
    })
  }
  return { burningActors, damages, entityDamages }
}

/** Advances one deterministic fire tick from a caller-provided loaded-cell snapshot. */
export const advanceFireLifecycle = (
  state: FireLifecycleState,
  cells: ReadonlyArray<FireCell>,
  weather: Weather,
  contacted: ReadonlyArray<FirePosition | FireActorContact> = [],
  difficulty: SurvivalDifficulty = 'normal',
): FireLifecycleStep => {
  const cellByKey = new Map(cells.map((cell) => [key(cell.position), cell]))
  const active = [...state.fires].sort((a, b) => compare(a.position, b.position))
  const survivors: ActiveFire[] = []
  const mutations = new Map<string, FireMutation>()
  const additions = new Map<string, ActiveFire>()
  let seed = state.seed

  for (const fire of active.slice(0, FIRE_WORK_BUDGET)) {
    const cell = cellByKey.get(key(fire.position))
    if (cell === undefined || cell.block === FIRE_UNAVAILABLE_BLOCK) {
      const unloadedRetries = (fire.unloadedRetries ?? 0) + 1
      if (unloadedRetries <= FIRE_UNLOADED_RETRY_LIMIT) survivors.push({ ...fire, unloadedRetries })
      continue
    }
    if (cell.block !== 'fire') continue
    if ((weather !== 'clear' && cell.exposedToSky === true) || !supported(fire.position, cellByKey)) {
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
  survivors.push(...active.slice(FIRE_WORK_BUDGET))

  const fires = [...new Map([...survivors, ...additions.values()].map((fire) => [key(fire.position), fire])).values()]
    .sort((a, b) => compare(a.position, b.position))
  const orderedMutations = [...mutations.values()].sort((a, b) => compare(a.position, b.position))
  const fireKeys = new Set(fires.map((fire) => key(fire.position)))
  const actors = advanceBurningActors(state, actorInput(contacted), fireKeys, weather, difficulty)
  const nextState: FireLifecycleState = {
    fires,
    ...(actors.burningActors.length > 0 || state.burningActors !== undefined
      ? { burningActors: actors.burningActors }
      : {}),
    seed,
  }
  return {
    state: nextState,
    mutations: orderedMutations,
    damages: actors.damages,
    entityDamages: actors.entityDamages,
  }
}
