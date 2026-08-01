import { EntityKind, type Entity, type EntityId, type Position } from '../entity-manager-port'
import type { Dimension } from '../nether-travel-port'

export const SKELETON_KIND = EntityKind('skeleton')
export const SPIDER_KIND = EntityKind('spider')
export const COW_KIND = EntityKind('cow')
export const PIG_KIND = EntityKind('pig')
export const SHEEP_KIND = EntityKind('sheep')
export const CHICKEN_KIND = EntityKind('chicken')
export const ZOMBIFIED_PIGLIN_KIND = EntityKind('zombified_piglin')
export const BLAZE_KIND = EntityKind('blaze')

export const PASSIVE_MOB_KINDS = [COW_KIND, PIG_KIND, SHEEP_KIND, CHICKEN_KIND] as const
export const OVERWORLD_ECOSYSTEM_HOSTILE_KINDS = [SKELETON_KIND, SPIDER_KIND] as const
export const NETHER_HOSTILE_KINDS = [ZOMBIFIED_PIGLIN_KIND, BLAZE_KIND] as const
export const ECOSYSTEM_MOB_KINDS = [
  ...OVERWORLD_ECOSYSTEM_HOSTILE_KINDS,
  ...PASSIVE_MOB_KINDS,
  ...NETHER_HOSTILE_KINDS,
] as const

export type EcosystemMobState = {
  readonly _tag: 'EcosystemMob'
  readonly attackCooldownSecs: number
  readonly motionPhase: number
  readonly provoked: boolean
}

export const initialEcosystemMobState = (): EcosystemMobState => ({
  _tag: 'EcosystemMob',
  attackCooldownSecs: 0,
  motionPhase: 0,
  provoked: false,
})

export const repairEcosystemMobState = (value: unknown): EcosystemMobState | undefined => {
  if (typeof value !== 'object' || value === null || (value as { _tag?: unknown })._tag !== 'EcosystemMob') return undefined
  const state = value as Partial<EcosystemMobState>
  return {
    _tag: 'EcosystemMob',
    attackCooldownSecs: Number.isFinite(state.attackCooldownSecs) ? Math.max(0, state.attackCooldownSecs!) : 0,
    motionPhase: Number.isFinite(state.motionPhase) ? state.motionPhase! : 0,
    provoked: state.provoked === true,
  }
}

export const ecosystemDimensionAllows = (kind: EntityKind, dimension: Dimension): boolean =>
  NETHER_HOSTILE_KINDS.includes(kind as (typeof NETHER_HOSTILE_KINDS)[number])
    ? dimension === 'nether'
    : dimension === 'overworld'

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
const move = (from: Position, target: Position, distance: number): Position => {
  const dx = target.x - from.x
  const dz = target.z - from.z
  const length = Math.hypot(dx, dz)
  return length === 0 ? from : { ...from, x: from.x + (dx / length) * distance, z: from.z + (dz / length) * distance }
}

export const stepEcosystemMob = (
  kind: EntityKind,
  state: EcosystemMobState,
  self: Position,
  target: Position | undefined,
  deltaSecs: number,
): EcosystemMobStep => {
  const dt = Number.isFinite(deltaSecs) ? Math.max(0, deltaSecs) : 0
  const cooldown = Math.max(0, state.attackCooldownSecs - dt)
  const phase = state.motionPhase + dt
  const distance = target === undefined ? Number.POSITIVE_INFINITY : distanceXZ(self, target)
  const nextState = (attackCooldownSecs = cooldown): EcosystemMobState => ({ ...state, attackCooldownSecs, motionPhase: phase })
  const attack = (mode: 'melee' | 'projectile', damage: number, reset: number): EcosystemMobStep => ({
    state: nextState(reset), feetPosition: self, jumping: kind === SPIDER_KIND,
    attack: { _tag: 'MobAttack', attackerKind: kind, mode, damage },
  })

  if (PASSIVE_MOB_KINDS.includes(kind as (typeof PASSIVE_MOB_KINDS)[number])) {
    const feetPosition = target !== undefined && distance < 8
      ? move(self, { x: self.x * 2 - target.x, y: self.y, z: self.z * 2 - target.z }, dt * 3)
      : { ...self, x: self.x + Math.cos(phase) * dt, z: self.z + Math.sin(phase) * dt }
    return { state: nextState(), feetPosition, jumping: false }
  }
  if (target === undefined) return { state: nextState(), feetPosition: self, jumping: false }
  if (kind === ZOMBIFIED_PIGLIN_KIND && !state.provoked) return { state: nextState(), feetPosition: self, jumping: false }
  if ((kind === SKELETON_KIND || kind === BLAZE_KIND) && cooldown === 0 && distance >= (kind === BLAZE_KIND ? 8 : 6) && distance <= (kind === BLAZE_KIND ? 24 : 16))
    return attack('projectile', kind === BLAZE_KIND ? 6 : 4, kind === BLAZE_KIND ? 3 : 2)
  if ((kind === SPIDER_KIND || kind === ZOMBIFIED_PIGLIN_KIND) && cooldown === 0 && distance <= 1.5)
    return attack('melee', kind === SPIDER_KIND ? 3 : 5, 1)
  const speed = kind === SPIDER_KIND ? 4 : 2.5
  return { state: nextState(), feetPosition: move(self, target, Math.min(distance, speed * dt)), jumping: kind === SPIDER_KIND && distance > 1.5 }
}

export const propagatedPiglinProvocation = <S>(
  entities: ReadonlyArray<Entity<S>>,
  attackedPiglinIds: ReadonlySet<EntityId>,
  radius = 16,
): ReadonlySet<EntityId> => {
  const attacked = entities.filter((entity) => entity.kind === ZOMBIFIED_PIGLIN_KIND && attackedPiglinIds.has(entity.id))
  return new Set(entities.filter((entity) => entity.kind === ZOMBIFIED_PIGLIN_KIND && attacked.some((origin) => distanceXZ(origin.feetPosition, entity.feetPosition) <= radius)).map((entity) => entity.id))
}
