import type { Damage } from '../death-cause.js'
import type { Position } from '@nerima-games/mc-kernel'
import {
  EntityKind,
  type Entity,
  type EntityId,
} from '@nerima-games/mc-sim'
import { explosionDamageAt, type Explosion } from './explosion.js'

export const ZOMBIE_KIND: EntityKind = EntityKind('zombie')

export type HostileLocomotion = {
  readonly speedBlocksPerSecond: number
  readonly stoppingDistanceBlocks: number
}

export const ZOMBIE_LOCOMOTION: HostileLocomotion = {
  speedBlocksPerSecond: 2.3,
  stoppingDistanceBlocks: 1.25,
}

export const CREEPER_LOCOMOTION: HostileLocomotion = {
  speedBlocksPerSecond: 2,
  stoppingDistanceBlocks: 3,
}

export const pursueHorizontally = (
  from: Position,
  target: Position | undefined,
  dt: number,
  locomotion: HostileLocomotion,
): Position => {
  if (target === undefined || !Number.isFinite(dt) || dt <= 0) {
    return from
  }

  const dx = target.x - from.x
  const dz = target.z - from.z
  const distance = Math.hypot(dx, dz)
  const remaining = distance - locomotion.stoppingDistanceBlocks
  if (!Number.isFinite(distance) || distance === 0 || remaining <= 0) {
    return from
  }

  const distanceMoved = Math.min(remaining, locomotion.speedBlocksPerSecond * dt)
  if (distanceMoved <= 0) {
    return from
  }

  return {
    x: from.x + (dx / distance) * distanceMoved,
    y: from.y,
    z: from.z + (dz / distance) * distanceMoved,
  }
}

export type PlayerDamageEvent =
  | {
      readonly _tag: 'HostileContact'
      readonly source: EntityId
      readonly kind: EntityKind
      readonly at: Position
      readonly damage: Damage
    }
  | {
      readonly _tag: 'Explosion'
      readonly source: EntityId
      readonly kind: EntityKind
      readonly at: Position
      readonly explosion: Explosion
      readonly damage: Damage
    }
  | {
      readonly _tag: 'FireContact'
      readonly at: Position
      readonly damage: Damage
    }
  | {
      readonly _tag: 'StatusEffect'
      readonly effect: 'poison'
      readonly damage: Damage
      readonly minimumHealthPoints: 1
    }

export type HostileContactResolution = {
  readonly damages: ReadonlyArray<PlayerDamageEvent>
  readonly cooldowns: ReadonlyMap<EntityId, number>
}

export const HOSTILE_CONTACT_INTERVAL_SECS = 1
export const ZOMBIE_CONTACT_RANGE_BLOCKS = 1.5
export const ZOMBIE_CONTACT_DAMAGE: Damage = { amount: 3, cause: 'mob' }

export const resolveHostileContacts = <S>(
  entities: ReadonlyArray<Entity<S>>,
  target: Position | undefined,
  dt: number,
  previousCooldowns: ReadonlyMap<EntityId, number>,
): HostileContactResolution => {
  const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0
  const cooldowns = new Map<EntityId, number>()
  for (const [id, remaining] of previousCooldowns) {
    const next = remaining - elapsed
    if (next > 0) cooldowns.set(id, next)
  }

  if (target === undefined) {
    return { damages: [], cooldowns }
  }

  const damages: Array<PlayerDamageEvent> = []
  for (const entity of entities) {
    if (
      entity.kind !== ZOMBIE_KIND ||
      cooldowns.has(entity.id) ||
      Math.hypot(
        entity.feetPosition.x - target.x,
        entity.feetPosition.y - target.y,
        entity.feetPosition.z - target.z,
      ) > ZOMBIE_CONTACT_RANGE_BLOCKS
    ) {
      continue
    }

    damages.push({
      _tag: 'HostileContact',
      source: entity.id,
      kind: entity.kind,
      at: entity.feetPosition,
      damage: ZOMBIE_CONTACT_DAMAGE,
    })
    cooldowns.set(entity.id, HOSTILE_CONTACT_INTERVAL_SECS)
  }

  return { damages, cooldowns }
}

export type PlayerBlast = {
  readonly source: EntityId
  readonly kind: EntityKind
  readonly at: Position
  readonly explosion: Explosion
}

export const resolvePlayerBlastDamage = (
  blasts: ReadonlyArray<PlayerBlast>,
  target: Position | undefined,
): ReadonlyArray<PlayerDamageEvent> => {
  if (target === undefined) return []

  const damages: Array<PlayerDamageEvent> = []
  for (const blast of blasts) {
    const damage = explosionDamageAt(
      blast.explosion,
      Math.hypot(target.x - blast.at.x, target.y - blast.at.y, target.z - blast.at.z),
    )
    if (damage.amount > 0) {
      damages.push({
        _tag: 'Explosion',
        source: blast.source,
        kind: blast.kind,
        at: blast.at,
        explosion: blast.explosion,
        damage,
      })
    }
  }
  return damages
}
