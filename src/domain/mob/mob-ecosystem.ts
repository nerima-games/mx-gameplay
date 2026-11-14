import { NonNegativeTickCount, PositionAxis, position, tickDuration, type Position } from '@nerima-games/mc-kernel'
import { EntityKind, MobMovementStateSchema, type Entity, type EntityId, type MobMovementState } from '@nerima-games/mc-sim'
import type { Dimension } from '@nerima-games/mc-worldgen'
import { Brand, Result, Schema } from 'effect'
import { CREEPER_KIND, ZOMBIE_KIND } from './hostile-combat.js'

export const SKELETON_KIND: EntityKind = EntityKind('skeleton')
export const SPIDER_KIND: EntityKind = EntityKind('spider')
export const COW_KIND: EntityKind = EntityKind('cow')
export const PIG_KIND: EntityKind = EntityKind('pig')
export const SHEEP_KIND: EntityKind = EntityKind('sheep')
export const CHICKEN_KIND: EntityKind = EntityKind('chicken')
export const ZOMBIFIED_PIGLIN_KIND: EntityKind = EntityKind('zombified_piglin')
export const BLAZE_KIND: EntityKind = EntityKind('blaze')
export const ENDERMAN_KIND: EntityKind = EntityKind('enderman')

export const SKELETON_ATTACK_INTERVAL_TICKS = 60
export const SKELETON_ATTACK_DAMAGE = 3
export const SPIDER_ATTACK_DAMAGE = 2

export type MobMovementDistance = number & Brand.Brand<'MobMovementDistance'>
const mobMovementDistance = Brand.nominal<MobMovementDistance>()

const LEGACY_TICKS_PER_SECOND = 1 / Number(tickDuration)
const BLAZE_ATTACK_INTERVAL_TICKS = 60
const MELEE_ATTACK_INTERVAL_TICKS = 20
const motionPhaseTicks = (phase: number): number => Math.ceil(phase)

export type MobStateRepairFailure =
  | Readonly<{ _tag: 'MobMovementStateRepairFailure' }>
  | Readonly<{ _tag: 'MobBehaviourStateRepairFailure'; kind: 'creeper' | 'enderman' | 'primed-tnt' | 'dropped-item' }>
  | Readonly<{
      _tag: 'EcosystemMobStateRepairFailure'
      field: '_tag' | 'attackCooldownTicks' | 'attackCooldownSecs' | 'motionPhase' | 'provoked' | 'movementGoal' | 'movement' | 'hasHeadProtection' | 'burningTicks'
    }>

const migrateLegacyEcosystemMobFields = (state: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  ...state,
  ...(!Object.hasOwn(state, 'hasHeadProtection') ? { hasHeadProtection: false } : {}),
  ...(!Object.hasOwn(state, 'burningTicks') ? { burningTicks: 0 } : {}),
})

const cooldownTicksFromPersisted = (
  state: Readonly<Record<string, unknown>>,
): Result.Result<number, MobStateRepairFailure> => {
  const hasTicks = Object.hasOwn(state, 'attackCooldownTicks')
  if (hasTicks) {
    const ticks = state['attackCooldownTicks']
    if (typeof ticks !== 'number' || !Number.isFinite(ticks) || ticks < 0 || ticks > Number.MAX_SAFE_INTEGER) {
      return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'attackCooldownTicks' })
    }
    if (Object.hasOwn(state, 'attackCooldownSecs')) {
      const seconds = state['attackCooldownSecs']
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'attackCooldownSecs' })
      }
    }
    return Result.succeed(Math.ceil(ticks))
  }
  if (!Object.hasOwn(state, 'attackCooldownSecs')) {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'attackCooldownTicks' })
  }
  const seconds = state['attackCooldownSecs']
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'attackCooldownSecs' })
  }
  const ticks = Math.ceil(seconds * LEGACY_TICKS_PER_SECOND)
  return Number.isSafeInteger(ticks)
    ? Result.succeed(ticks)
    : Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'attackCooldownSecs' })
}

// Explicit fixed-length tuple annotations (not `ReadonlyArray<EntityKind>`) are
// deliberate on the spawn-kind tuples: `./entities/mob-frame`'s `HOSTILE_KINDS` and
// `./entities/mob-spawn-search` both need the non-empty TUPLE type these
// produce, not a widened array — see `HOSTILE_KINDS`' own explicit
// `readonly [EntityKind, ...]` annotation, which a plain array-typed source
// would no longer satisfy at its direct (non-spread) use in the ternary in
// `searchSpawnCandidates`.
export const PASSIVE_MOB_KINDS: readonly [EntityKind, EntityKind, EntityKind, EntityKind] = [
  COW_KIND,
  PIG_KIND,
  SHEEP_KIND,
  CHICKEN_KIND,
]
export const OVERWORLD_ECOSYSTEM_HOSTILE_KINDS: readonly [EntityKind, EntityKind] = [SKELETON_KIND, SPIDER_KIND]
export const NETHER_ECOSYSTEM_HOSTILE_KINDS: readonly [EntityKind, EntityKind] = [
  ZOMBIFIED_PIGLIN_KIND,
  BLAZE_KIND,
]
export const NETHER_HOSTILE_KINDS: readonly [EntityKind, EntityKind, EntityKind] = [
  ENDERMAN_KIND,
  ...NETHER_ECOSYSTEM_HOSTILE_KINDS,
]
export const ECOSYSTEM_MOB_KINDS: ReadonlyArray<EntityKind> = [
  ...OVERWORLD_ECOSYSTEM_HOSTILE_KINDS,
  ...PASSIVE_MOB_KINDS,
  ...NETHER_ECOSYSTEM_HOSTILE_KINDS,
]

export type MobMovementPolicy =
  | Readonly<{ _tag: 'FleeOrWander'; fleeWithin: MobMovementDistance; fleeDistance: MobMovementDistance; wanderRadius: MobMovementDistance }>
  | Readonly<{ _tag: 'Approach'; attackDistance: MobMovementDistance; followRange: MobMovementDistance }>
  | Readonly<{ _tag: 'RangedSpacing'; minDistance: MobMovementDistance; maxDistance: MobMovementDistance; followRange: MobMovementDistance }>
  | Readonly<{ _tag: 'ProvokedApproach'; attackDistance: MobMovementDistance; followRange: MobMovementDistance }>

const PASSIVE_MOVEMENT_POLICY: MobMovementPolicy = {
  _tag: 'FleeOrWander', fleeWithin: mobMovementDistance(8), fleeDistance: mobMovementDistance(8), wanderRadius: mobMovementDistance(4),
}

/** Per-kind movement decisions; SM3 owns the path and physical step that follows. */
export const MOB_MOVEMENT_POLICIES: ReadonlyMap<EntityKind, MobMovementPolicy> = new Map<EntityKind, MobMovementPolicy>([
  [COW_KIND, PASSIVE_MOVEMENT_POLICY],
  [PIG_KIND, PASSIVE_MOVEMENT_POLICY],
  [SHEEP_KIND, PASSIVE_MOVEMENT_POLICY],
  [CHICKEN_KIND, PASSIVE_MOVEMENT_POLICY],
  [ZOMBIE_KIND, { _tag: 'Approach', attackDistance: mobMovementDistance(1.5), followRange: mobMovementDistance(35) }],
  [CREEPER_KIND, { _tag: 'Approach', attackDistance: mobMovementDistance(3), followRange: mobMovementDistance(16) }],
  [SPIDER_KIND, { _tag: 'Approach', attackDistance: mobMovementDistance(1.5), followRange: mobMovementDistance(16) }],
  [SKELETON_KIND, { _tag: 'RangedSpacing', minDistance: mobMovementDistance(8), maxDistance: mobMovementDistance(16), followRange: mobMovementDistance(16) }],
  [BLAZE_KIND, { _tag: 'RangedSpacing', minDistance: mobMovementDistance(8), maxDistance: mobMovementDistance(24), followRange: mobMovementDistance(48) }],
  [ZOMBIFIED_PIGLIN_KIND, { _tag: 'ProvokedApproach', attackDistance: mobMovementDistance(1.5), followRange: mobMovementDistance(35) }],
])

const DEFAULT_MOVEMENT_POLICY: MobMovementPolicy = {
  _tag: 'Approach',
  attackDistance: mobMovementDistance(1.5),
  followRange: mobMovementDistance(16),
}

const movementPolicyFor = (kind: EntityKind): MobMovementPolicy =>
  MOB_MOVEMENT_POLICIES.get(kind) ?? DEFAULT_MOVEMENT_POLICY

const validPosition = (value: unknown): value is Position => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Position>
  const validAxis = (axis: unknown): axis is number =>
    typeof axis === 'number' && Number.isFinite(axis) && Number.isSafeInteger(Math.floor(axis))
  return validAxis(candidate.x) && validAxis(candidate.y) && validAxis(candidate.z)
}

export const repairMobMovementState = (
  value: unknown,
): Result.Result<MobMovementState | undefined, MobStateRepairFailure> => {
  if (value === undefined) return Result.succeed(undefined)
  const decoded = Schema.decodeUnknownResult(MobMovementStateSchema)(value)
  return decoded._tag === 'Success'
    ? Result.succeed(decoded.success)
    : Result.fail({ _tag: 'MobMovementStateRepairFailure' })
}

export type EcosystemMobState = {
  readonly _tag: 'EcosystemMob'
  readonly attackCooldownTicks: number
  readonly motionPhase: number
  readonly provoked: boolean
  readonly movementGoal?: Position
  readonly movement?: MobMovementState
  readonly hasHeadProtection: boolean
  readonly burningTicks: NonNegativeTickCount
}

export const initialEcosystemMobState = (): EcosystemMobState => ({
  _tag: 'EcosystemMob',
  attackCooldownTicks: 0,
  motionPhase: 0,
  provoked: false,
  hasHeadProtection: false,
  burningTicks: NonNegativeTickCount(0),
})

export const repairEcosystemMobState = (
  value: unknown,
): Result.Result<EcosystemMobState | undefined, MobStateRepairFailure> => {
  if (value === undefined) return Result.succeed(undefined)
  if (typeof value !== 'object' || value === null || (value as { _tag?: unknown })._tag !== 'EcosystemMob') {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: '_tag' })
  }
  const state = migrateLegacyEcosystemMobFields(value as Readonly<Record<string, unknown>>)
  const cooldownTicks = cooldownTicksFromPersisted(state)
  if (Result.isFailure(cooldownTicks)) return Result.fail(cooldownTicks.failure)
  const motionPhase = state['motionPhase']
  if (typeof motionPhase !== 'number' || !Number.isFinite(motionPhase) || motionPhase < 0 ||
    Math.ceil(motionPhase) > Number.MAX_SAFE_INTEGER) {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'motionPhase' })
  }
  const provoked = state['provoked']
  if (typeof provoked !== 'boolean') {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'provoked' })
  }
  const hasHeadProtection = state['hasHeadProtection']
  if (typeof hasHeadProtection !== 'boolean') {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'hasHeadProtection' })
  }
  const burningTicks = state['burningTicks']
  if (typeof burningTicks !== 'number' || !Number.isSafeInteger(burningTicks) || burningTicks < 0 || burningTicks > 160) {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'burningTicks' })
  }
  let goal: Position | undefined
  if (Object.hasOwn(state, 'movementGoal')) {
    if (!validPosition(state['movementGoal'])) {
      return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'movementGoal' })
    }
    const movementGoal = state['movementGoal']
    goal = position(
      PositionAxis(movementGoal.x),
      PositionAxis(movementGoal.y),
      PositionAxis(movementGoal.z),
    )
  }
  const movementResult = repairMobMovementState(state['movement'])
  if (Result.isFailure(movementResult)) {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'movement' })
  }
  if (Object.hasOwn(state, 'movement') && movementResult.success === undefined) {
    return Result.fail({ _tag: 'EcosystemMobStateRepairFailure', field: 'movement' })
  }
  return Result.succeed({
    _tag: 'EcosystemMob',
    attackCooldownTicks: cooldownTicks.success,
    motionPhase: motionPhaseTicks(motionPhase),
    provoked,
    ...(goal === undefined ? {} : { movementGoal: goal }),
    ...(movementResult.success === undefined ? {} : { movement: movementResult.success }),
    hasHeadProtection,
    burningTicks: NonNegativeTickCount(burningTicks),
  })
}

export const ecosystemDimensionAllows = (kind: EntityKind, dimension: Dimension): boolean => {
  if (kind === ENDERMAN_KIND) return dimension === 'overworld' || dimension === 'nether'
  return NETHER_HOSTILE_KINDS.includes(kind as (typeof NETHER_HOSTILE_KINDS)[number])
    ? dimension === 'nether'
    : dimension === 'overworld'
}

export type EcosystemAttack = {
  readonly _tag: 'MobAttack'
  readonly attackerKind: EntityKind
  readonly mode: 'melee' | 'projectile'
  readonly damage: number
}

export type EcosystemMobStep = {
  readonly state: EcosystemMobState
  readonly feetPosition: Position
  readonly attack?: EcosystemAttack
  readonly jumping: boolean
}

const distanceXZ = (a: Position, b: Position): number => Math.hypot(a.x - b.x, a.z - b.z)

const positionAt = (self: Position, x: number, z: number): Position => {
  return position(PositionAxis(x), self.y, PositionAxis(z))
}

const atDistanceAwayFrom = (self: Position, target: Position, distance: number, phase: number): Position => {
  const dx = self.x - target.x
  const dz = self.z - target.z
  const length = Math.hypot(dx, dz)
  const angle = phase * 2.399963229728653
  const directionX = length === 0 ? Math.cos(angle) : dx / length
  const directionZ = length === 0 ? Math.sin(angle) : dz / length
  return positionAt(self, self.x + directionX * distance, self.z + directionZ * distance)
}

const WANDER_TURN_INTERVAL_TICKS = 60
const wanderGoal = (self: Position, phase: number, radius: number): Position => {
  const direction = Math.floor(phase / WANDER_TURN_INTERVAL_TICKS) * 2.399963229728653
  return positionAt(self, self.x + Math.cos(direction) * radius, self.z + Math.sin(direction) * radius)
}

export const movementGoalForEcosystemMob = (
  kind: EntityKind,
  state: EcosystemMobState,
  self: Position,
  target: Position | undefined,
  phase: NonNegativeTickCount = NonNegativeTickCount(state.motionPhase),
): Position => {
  const policy = movementPolicyFor(kind)
  const distance = target === undefined ? Number.POSITIVE_INFINITY : distanceXZ(self, target)
  switch (policy._tag) {
    case 'FleeOrWander':
      return target !== undefined && distance < policy.fleeWithin
        ? atDistanceAwayFrom(self, target, policy.fleeDistance, phase)
        : wanderGoal(self, phase, policy.wanderRadius)
    case 'Approach':
      return target !== undefined && distance <= policy.followRange &&
        (distance > policy.attackDistance || (kind === SPIDER_KIND && target.y > self.y))
        ? target
        : self
    case 'RangedSpacing':
      if (target === undefined || distance > policy.followRange) return self
      if (distance < policy.minDistance) return atDistanceAwayFrom(self, target, policy.minDistance, phase)
      return distance > policy.maxDistance ? target : self
    case 'ProvokedApproach':
      return state.provoked && target !== undefined && distance <= policy.followRange && distance > policy.attackDistance
        ? target
        : self
    /* v8 ignore start */
    default: {
      const exhaustive: never = policy
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

export const stepEcosystemMob = (
  kind: EntityKind,
  state: EcosystemMobState,
  self: Position,
  target: Position | undefined,
  _deltaSecs: number,
): EcosystemMobStep => {
  const cooldown = Math.max(0, state.attackCooldownTicks - 1)
  const currentPhase = motionPhaseTicks(state.motionPhase)
  const phase = NonNegativeTickCount(currentPhase === Number.MAX_SAFE_INTEGER ? currentPhase : currentPhase + 1)
  const distance = target === undefined ? Number.POSITIVE_INFINITY : distanceXZ(self, target)
  const movementGoal = movementGoalForEcosystemMob(kind, state, self, target, phase)
  const nextState = (attackCooldownTicks = cooldown): EcosystemMobState => ({
    ...state,
    attackCooldownTicks,
    motionPhase: phase,
    movementGoal,
  })
  const attack = (mode: 'melee' | 'projectile', damage: number, resetTicks: number): EcosystemMobStep => ({
    state: nextState(resetTicks), feetPosition: self, jumping: kind === SPIDER_KIND,
    attack: { _tag: 'MobAttack', attackerKind: kind, mode, damage },
  })

  if (PASSIVE_MOB_KINDS.includes(kind as (typeof PASSIVE_MOB_KINDS)[number])) {
    return { state: nextState(), feetPosition: self, jumping: false }
  }
  if (target === undefined) return { state: nextState(), feetPosition: self, jumping: false }
  const policy = movementPolicyFor(kind)
  if (policy._tag === 'ProvokedApproach' && !state.provoked) return { state: nextState(), feetPosition: self, jumping: false }
  if (policy._tag === 'RangedSpacing' && cooldown === 0 && distance >= policy.minDistance && distance <= policy.maxDistance)
    return attack(
      'projectile',
      kind === BLAZE_KIND ? 6 : SKELETON_ATTACK_DAMAGE,
      kind === BLAZE_KIND ? BLAZE_ATTACK_INTERVAL_TICKS : SKELETON_ATTACK_INTERVAL_TICKS,
    )
  if ((kind === SPIDER_KIND || kind === ZOMBIE_KIND || kind === ZOMBIFIED_PIGLIN_KIND) && cooldown === 0 && distance <= 1.5)
    return attack(
      'melee',
      kind === SPIDER_KIND ? SPIDER_ATTACK_DAMAGE : kind === ZOMBIE_KIND ? 3 : 5,
      MELEE_ATTACK_INTERVAL_TICKS,
    )
  return { state: nextState(), feetPosition: self, jumping: kind === SPIDER_KIND && distance > 1.5 }
}

export const propagatedPiglinProvocation = <S>(
  entities: ReadonlyArray<Entity<S>>,
  attackedPiglinIds: ReadonlySet<EntityId>,
  radius = 16,
): ReadonlySet<EntityId> => {
  const attacked = entities.filter((entity) => entity.kind === ZOMBIFIED_PIGLIN_KIND && attackedPiglinIds.has(entity.id))
  return new Set(entities.filter((entity) => entity.kind === ZOMBIFIED_PIGLIN_KIND && attacked.some((origin) => distanceXZ(origin.feetPosition, entity.feetPosition) <= radius)).map((entity) => entity.id))
}
