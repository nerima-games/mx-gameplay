import { Option, Result } from 'effect'
import { blockIdOf, capabilityOfBlockId, isBlockType } from '@nerima-games/mc-kernel'
import type { Damage } from './death-cause.js'
import { nextRoll, normaliseSeed, type FrameRollFailure } from './frame-rolls.js'
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

export type FireLifecycleInputField =
  | 'positions'
  | 'position'
  | 'seed'
  | 'fires'
  | 'ageTicks'
  | 'unloadedRetries'
  | 'burningActors'
  | 'burningActor'
  | 'cells'
  | 'cell'
  | 'contacts'
  | 'contact'
  | 'tickAccumulatorSecs'
  | 'weather'
  | 'difficulty'
  | 'snapshot'

export type FireLifecycleFailure = FrameRollFailure | Readonly<{
  _tag: 'InvalidFireLifecycleInput'
  field: FireLifecycleInputField
}>

export const FIRE_LIFECYCLE_SNAPSHOT_VERSION = 1
export const FIRE_NATURAL_LIFETIME_TICKS = 8
/** Fire simulation runs at 20 Hz independently of the host render cadence. */
export const FIRE_TICK_INTERVAL_SECS: number = 1 / 20
export const FIRE_SPREAD_CHANCE = 0.3
export const FIRE_BURN_DURATION_TICKS = 80
export const FIRE_DAMAGE_INTERVAL_TICKS = 20
export const FIRE_UNLOADED_RETRY_LIMIT = 3
export const FIRE_FRAME_TICK_BUDGET = 4
export const FIRE_WORK_BUDGET = 128
/** A cell value used by the stage to distinguish an unloaded chunk from air. */
export const FIRE_UNAVAILABLE_BLOCK = '__fire_chunk_unavailable__'
export const FIRE_TICK_ACCUMULATOR_MAX_SECS: number = FIRE_TICK_INTERVAL_SECS * FIRE_FRAME_TICK_BUDGET

const offsets = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]] as const
const key = (p: FirePosition): string => `${p.x},${p.y},${p.z}`
const compare = (a: FirePosition, b: FirePosition): number => a.x - b.x || a.y - b.y || a.z - b.z
const copyPosition = (position: FirePosition): FirePosition => ({ ...position })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidFireInput = (field: FireLifecycleInputField): FireLifecycleFailure => ({
  _tag: 'InvalidFireLifecycleInput',
  field,
})

const isPosition = (value: unknown): value is FirePosition =>
  isRecord(value) && Number.isFinite(value['x']) && Number.isFinite(value['y']) && Number.isFinite(value['z'])

const validateLifecycleState = (state: FireLifecycleState): FireLifecycleFailure | undefined => {
  if (!isRecord(state)) return invalidFireInput('fires')
  const fires = state['fires']
  const seed = state['seed']
  if (!Array.isArray(fires)) return invalidFireInput('fires')
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return invalidFireInput('seed')
  if (Object.hasOwn(state, 'burningActors') && state['burningActors'] === undefined) {
    return invalidFireInput('burningActors')
  }
  for (const fire of fires) {
    if (!isRecord(fire)) return invalidFireInput('position')
    const position = fire['position']
    const ageTicks = fire['ageTicks']
    const hasUnloadedRetries = Object.hasOwn(fire, 'unloadedRetries')
    const unloadedRetries = fire['unloadedRetries']
    if (!isPosition(position)) return invalidFireInput('position')
    if (typeof ageTicks !== 'number' || !Number.isSafeInteger(ageTicks) || ageTicks < 0) {
      return invalidFireInput('ageTicks')
    }
    if (hasUnloadedRetries && (
      typeof unloadedRetries !== 'number' ||
      !Number.isSafeInteger(unloadedRetries) ||
      unloadedRetries < 0
    )) {
      return invalidFireInput('unloadedRetries')
    }
  }
  const burningActors = state['burningActors']
  if (burningActors !== undefined) {
    if (!Array.isArray(burningActors)) return invalidFireInput('burningActors')
    for (const actor of burningActors) {
      if (!isRecord(actor)) return invalidFireInput('burningActor')
      const id = actor['id']
      const kind = actor['kind']
      const position = actor['position']
      const remainingTicks = actor['remainingTicks']
      const damageCooldownTicks = actor['damageCooldownTicks']
      if (
        typeof id !== 'string' ||
        (kind !== 'player' && kind !== 'entity') ||
        !isPosition(position) ||
        typeof remainingTicks !== 'number' || !Number.isSafeInteger(remainingTicks) || remainingTicks <= 0 ||
        typeof damageCooldownTicks !== 'number' || !Number.isSafeInteger(damageCooldownTicks) || damageCooldownTicks < 0
      ) return invalidFireInput('burningActor')
    }
  }
  return undefined
}

const validateFireCells = (cells: ReadonlyArray<FireCell>): FireLifecycleFailure | undefined => {
  if (!Array.isArray(cells)) return invalidFireInput('cells')
  for (const cell of cells) {
    if (!isRecord(cell)) return invalidFireInput('cell')
    const position = cell['position']
    const block = cell['block']
    if (
      !isPosition(position) ||
      typeof block !== 'string' || (block !== FIRE_UNAVAILABLE_BLOCK && !isBlockType(block)) ||
      (Object.hasOwn(cell, 'exposedToSky') && typeof cell['exposedToSky'] !== 'boolean')
    ) return invalidFireInput('cell')
  }
  return undefined
}

const validateContacts = (
  contacts: ReadonlyArray<FirePosition | FireActorContact>,
): FireLifecycleFailure | undefined => {
  if (!Array.isArray(contacts)) return invalidFireInput('contacts')
  for (const contact of contacts) {
    if (!isRecord(contact)) return invalidFireInput('contact')
    const position = Object.hasOwn(contact, 'position') ? contact['position'] : contact
    if (!isPosition(position)) return invalidFireInput('contact')
    if (Object.hasOwn(contact, 'id') || Object.hasOwn(contact, 'kind')) {
      if (
        typeof contact['id'] !== 'string' ||
        (contact['kind'] !== 'player' && contact['kind'] !== 'entity') ||
        (Object.hasOwn(contact, 'alive') && typeof contact['alive'] !== 'boolean') ||
        (Object.hasOwn(contact, 'inWater') && typeof contact['inWater'] !== 'boolean') ||
        (Object.hasOwn(contact, 'exposedToSky') && typeof contact['exposedToSky'] !== 'boolean')
      ) return invalidFireInput('contact')
    }
  }
  return undefined
}

const hasFlammableCapability = (block: string): boolean => {
  if (!isBlockType(block)) return false
  const blockId = Option.getOrUndefined(blockIdOf(block))
  return blockId !== undefined &&
    Result.getOrUndefined(capabilityOfBlockId(blockId, 'flammable')) === true
}

const fireDamageAmountFor = (difficulty: SurvivalDifficulty): number | undefined => {
  if (difficulty === 'peaceful') return undefined
  return difficulty === 'hard' ? 2 : 1
}

const actorInput = (
  contacted: ReadonlyArray<FirePosition | FireActorContact>,
): ReadonlyArray<FireActorContact> => {
  const actors = new Map<string, FireActorContact>()
  for (const contact of contacted) {
    if ('id' in contact) {
      actors.set(contact.id, contact)
      continue
    }
    actors.set('player', { id: 'player', kind: 'player', position: contact })
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
    return neighbour !== undefined && hasFlammableCapability(neighbour.block)
  })
}

export const makeFireLifecycleState = (
  positions: ReadonlyArray<FirePosition>,
  seed: number,
): Result.Result<FireLifecycleState, FireLifecycleFailure> => {
  if (!Array.isArray(positions) || positions.some((position) => !isPosition(position))) {
    return Result.fail(invalidFireInput('position'))
  }
  const normalisedSeed = normaliseSeed(seed)
  if (Result.isFailure(normalisedSeed)) return Result.fail(normalisedSeed.failure)
  return Result.succeed({
    fires: [...new Map(positions.map((position) => [key(position), { position, ageTicks: 0 }])).values()]
      .sort((a, b) => compare(a.position, b.position)),
    seed: normalisedSeed.success,
  })
}

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
): Result.Result<FireLifecycleSnapshot, FireLifecycleFailure> => {
  const invalidState = validateLifecycleState(state)
  if (invalidState !== undefined) return Result.fail(invalidState)
  if (
    !Number.isFinite(tickAccumulatorSecs) ||
    tickAccumulatorSecs < 0 ||
    tickAccumulatorSecs > FIRE_TICK_ACCUMULATOR_MAX_SECS
  ) return Result.fail(invalidFireInput('tickAccumulatorSecs'))
  const normalisedSeed = normaliseSeed(state.seed)
  if (Result.isFailure(normalisedSeed)) return Result.fail(normalisedSeed.failure)
  const burningActors = state.burningActors === undefined ? [] : state.burningActors
  return Result.succeed({
    version: FIRE_LIFECYCLE_SNAPSHOT_VERSION,
    fires: state.fires.map((fire) => ({ ...fire, position: copyPosition(fire.position) })),
    burningActors: burningActors.map((actor) => ({
      ...actor,
      position: copyPosition(actor.position),
    })),
    seed: normalisedSeed.success,
    tickAccumulatorSecs,
  })
}

export const isFireLifecycleSnapshot = (value: unknown): value is FireLifecycleSnapshot => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<FireLifecycleSnapshot>
  return candidate.version === FIRE_LIFECYCLE_SNAPSHOT_VERSION &&
    Array.isArray(candidate.fires) &&
    candidate.fires.every((fire) =>
      typeof fire === 'object' && fire !== null &&
      typeof fire.position === 'object' && fire.position !== null &&
      Number.isFinite(fire.position.x) && Number.isFinite(fire.position.y) &&
      Number.isFinite(fire.position.z) && Number.isSafeInteger(fire.ageTicks) && fire.ageTicks >= 0 &&
      (!Object.hasOwn(fire, 'unloadedRetries') ||
        (Number.isSafeInteger(fire.unloadedRetries) && fire.unloadedRetries >= 0)),
    ) &&
    Array.isArray(candidate.burningActors) &&
    candidate.burningActors.every((actor) =>
      typeof actor === 'object' && actor !== null && typeof actor.id === 'string' &&
      (actor.kind === 'player' || actor.kind === 'entity') &&
      typeof actor.position === 'object' && actor.position !== null &&
      Number.isFinite(actor.position.x) && Number.isFinite(actor.position.y) &&
      Number.isFinite(actor.position.z) && Number.isSafeInteger(actor.remainingTicks) &&
      actor.remainingTicks > 0 && Number.isSafeInteger(actor.damageCooldownTicks) &&
      actor.damageCooldownTicks >= 0,
    ) &&
    typeof candidate.seed === 'number' && Number.isFinite(candidate.seed) &&
    typeof candidate.tickAccumulatorSecs === 'number' && Number.isFinite(candidate.tickAccumulatorSecs) &&
    candidate.tickAccumulatorSecs >= 0 &&
    candidate.tickAccumulatorSecs <= FIRE_TICK_ACCUMULATOR_MAX_SECS
}

export const restoreFireLifecycleSnapshot = (
  snapshot: FireLifecycleSnapshot,
): Result.Result<{
  readonly state: FireLifecycleState
  readonly tickAccumulatorSecs: number
}, FireLifecycleFailure> => {
  if (!isFireLifecycleSnapshot(snapshot)) return Result.fail(invalidFireInput('snapshot'))
  const normalisedSeed = normaliseSeed(snapshot.seed)
  if (Result.isFailure(normalisedSeed)) return Result.fail(normalisedSeed.failure)
  return Result.succeed({
    state: {
      fires: snapshot.fires.map((fire) => ({ ...fire, position: copyPosition(fire.position) })),
      burningActors: snapshot.burningActors.map((actor) => ({
        ...actor,
        position: copyPosition(actor.position),
      })),
      seed: normalisedSeed.success,
    },
    tickAccumulatorSecs: snapshot.tickAccumulatorSecs,
  })
}

const advanceBurningActors = (
  existingActors: ReadonlyArray<BurningActor>,
  contacts: ReadonlyArray<FireActorContact>,
  fireKeys: ReadonlySet<string>,
  weather: Weather,
  difficulty: SurvivalDifficulty,
): Pick<FireLifecycleStep, 'damages' | 'entityDamages'> & {
  readonly burningActors: ReadonlyArray<BurningActor>
} => {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const burningById = new Map(existingActors.map((actor) => [actor.id, actor]))
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
        remainingTicks: Math.max(
          current === undefined ? 0 : current.remainingTicks,
          FIRE_BURN_DURATION_TICKS,
        ),
        damageCooldownTicks: current === undefined ? 0 : current.damageCooldownTicks,
      })
    }
  }

  const burningActors: BurningActor[] = []
  const damages: FireContactDamage[] = []
  const entityDamages: FireEntityDamage[] = []
  const damageAmount = fireDamageAmountFor(difficulty)
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
    const shouldDamage = actor.damageCooldownTicks <= 0 && damageAmount !== undefined
    if (shouldDamage) {
      // Armour mitigates contact with the fire block itself but not the burn
      // that continues after leaving it (armor.ts's `CAUSES_BYPASSING_ARMOR`),
      // so the cause is read from where the actor is THIS tick, not from
      // whether it is still counting down a shared burn timer.
      const damage: Damage = {
        amount: damageAmount,
        cause: fireKeys.has(key(contact.position)) ? 'in_fire' : 'on_fire',
      }
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
export function advanceFireLifecycle(
  state: FireLifecycleState,
  cells: ReadonlyArray<FireCell>,
  weather: Weather,
): Result.Result<FireLifecycleStep, FireLifecycleFailure>
export function advanceFireLifecycle(
  state: FireLifecycleState,
  cells: ReadonlyArray<FireCell>,
  weather: Weather,
  contacted: ReadonlyArray<FirePosition | FireActorContact>,
  difficulty?: SurvivalDifficulty,
): Result.Result<FireLifecycleStep, FireLifecycleFailure>
export function advanceFireLifecycle(
  state: FireLifecycleState,
  cells: ReadonlyArray<FireCell>,
  weather: Weather,
  contacted?: ReadonlyArray<FirePosition | FireActorContact>,
  difficulty?: SurvivalDifficulty,
): Result.Result<FireLifecycleStep, FireLifecycleFailure> {
  if (arguments.length >= 4 && contacted === undefined) {
    return Result.fail(invalidFireInput('contacts'))
  }
  if (arguments.length >= 5 && difficulty === undefined) {
    return Result.fail(invalidFireInput('difficulty'))
  }
  const contacts = contacted === undefined ? [] : contacted
  const effectiveDifficulty = difficulty === undefined ? 'normal' : difficulty
  const invalidState = validateLifecycleState(state)
  if (invalidState !== undefined) return Result.fail(invalidState)
  const invalidCells = validateFireCells(cells)
  if (invalidCells !== undefined) return Result.fail(invalidCells)
  const invalidContacts = validateContacts(contacts)
  if (invalidContacts !== undefined) return Result.fail(invalidContacts)
  if (weather !== 'clear' && weather !== 'rain' && weather !== 'thunder') {
    return Result.fail(invalidFireInput('weather'))
  }
  if (!['peaceful', 'easy', 'normal', 'hard'].includes(effectiveDifficulty)) {
    return Result.fail(invalidFireInput('difficulty'))
  }
  const normalisedSeed = normaliseSeed(state.seed)
  if (Result.isFailure(normalisedSeed)) return Result.fail(normalisedSeed.failure)

  const cellByKey = new Map(cells.map((cell) => [key(cell.position), cell]))
  const active = [...state.fires].sort((a, b) => compare(a.position, b.position))
  const survivors: ActiveFire[] = []
  const mutations = new Map<string, FireMutation>()
  const additions = new Map<string, ActiveFire>()
  let seed = normalisedSeed.success

  for (const fire of active.slice(0, FIRE_WORK_BUDGET)) {
    const cell = cellByKey.get(key(fire.position))
    if (cell === undefined || cell.block === FIRE_UNAVAILABLE_BLOCK) {
      const unloadedRetries = (fire.unloadedRetries === undefined ? 0 : fire.unloadedRetries) + 1
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
      if (neighbour === undefined || !hasFlammableCapability(neighbour.block) || additions.has(key(position))) continue
      const draw = nextRoll(seed)
      if (Result.isFailure(draw)) return Result.fail(draw.failure)
      seed = draw.success.seed
      if (draw.success.roll < FIRE_SPREAD_CHANCE) {
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
  const existingActors = state.burningActors === undefined ? [] : state.burningActors
  const actors = advanceBurningActors(
    existingActors,
    actorInput(contacts),
    fireKeys,
    weather,
    effectiveDifficulty,
  )
  const nextState: FireLifecycleState = {
    fires,
    ...(actors.burningActors.length > 0 || Object.hasOwn(state, 'burningActors')
      ? { burningActors: actors.burningActors }
      : {}),
    seed,
  }
  return Result.succeed({
    state: nextState,
    mutations: orderedMutations,
    damages: actors.damages,
    entityDamages: actors.entityDamages,
  })
}
