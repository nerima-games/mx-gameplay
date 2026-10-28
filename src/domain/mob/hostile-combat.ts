import type { Damage } from '../death-cause.js'
import {
  DamageAmountSchema,
  DimensionIdSchema,
  DomainEventSchema,
  EntityIdSchema,
  PositionAxis,
  SimulationTickSchema,
  WorldPositionSchema,
  position,
  type Dimension,
  type DomainEvent,
  type EntityId as KernelEntityId,
  type Position,
  type SimulationTick,
} from '@nerima-games/mc-kernel'
import {
  EntityKind,
  IntentPayloadSchema,
  type Entity,
  type EntityId,
  type IntentPayload,
  type PlayerPose,
} from '@nerima-games/mc-sim'
import { Result, Schema } from 'effect'
import { explosionDamageAt, type Explosion } from './explosion.js'

/** Java Edition startup delay; the default horizontal blocking angle is 90 degrees per side. */
export const SHIELD_BLOCKING_DELAY_TICKS = 5
export const SHIELD_HORIZONTAL_BLOCKING_HALF_ANGLE_DEGREES = 90
/** Attacks at or above this damage cause item durability loss in Java Edition. */
export const SHIELD_DURABILITY_DAMAGE_THRESHOLD = 3

export type ShieldBlockingIntent = Extract<IntentPayload, { readonly _tag: 'SetShieldBlocking' }>

export type ShieldBlockingState = Readonly<{
  actor: KernelEntityId
  raisedAt: SimulationTick
}>

export type ShieldBlockingPreparation = Readonly<{
  actor: KernelEntityId
  blocking: boolean
  raisedAt: SimulationTick | null
  blocked: boolean
  blockedAmount: number
  durabilityDamage: number
  event: DomainEvent | null
}>

const ShieldBlockingStateSchema = Schema.Struct({
  actor: EntityIdSchema,
  raisedAt: SimulationTickSchema,
})

const ShieldIncomingAttackSchema = Schema.Struct({
  attacker: EntityIdSchema,
  attackerPosition: WorldPositionSchema,
  kind: Schema.Literals(['melee', 'projectile', 'explosion']),
  piercing: Schema.optionalKey(Schema.Boolean),
  amount: DamageAmountSchema,
})

export const ShieldBlockingPreparationSchema: Schema.ConstraintDecoder<ShieldBlockingPreparation> = Schema.Struct({
  actor: EntityIdSchema,
  blocking: Schema.Boolean,
  raisedAt: Schema.NullOr(SimulationTickSchema),
  blocked: Schema.Boolean,
  blockedAmount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  durabilityDamage: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  event: Schema.NullOr(DomainEventSchema),
})

export type ShieldBlockingPreparationError =
  | 'invalid-intent'
  | 'invalid-authoritative-state'
  | 'invalid-tick-order'
  | 'shield-not-equipped'
  | 'invalid-attack'

/** Prepare the C2 shield owner candidate and optional post-commit block event. */
export const prepareShieldBlocking = (
  intent: ShieldBlockingIntent,
  input: Readonly<{
    tick: SimulationTick
    dimension: Dimension
    pose: PlayerPose
    hasShield: boolean
    current: ShieldBlockingState | null
    incoming?: Readonly<{
      attacker: KernelEntityId
      attackerPosition: Readonly<{ dimension: Dimension; x: number; y: number; z: number }>
      kind: 'melee' | 'projectile' | 'explosion'
      piercing?: boolean
      amount: number
    }>
  }>,
): Result.Result<ShieldBlockingPreparation, ShieldBlockingPreparationError> => {
  const decodedIntent = Schema.decodeUnknownResult(IntentPayloadSchema)(intent)
  if (Result.isFailure(decodedIntent) || decodedIntent.success._tag !== 'SetShieldBlocking') {
    return Result.fail('invalid-intent')
  }
  const tick = Schema.decodeUnknownResult(SimulationTickSchema)(input.tick)
  const dimension = Schema.decodeUnknownResult(DimensionIdSchema)(input.dimension)
  const current = input.current === null
    ? Result.succeed(null)
    : Schema.decodeUnknownResult(ShieldBlockingStateSchema)(input.current)
  if (Result.isFailure(tick) || Result.isFailure(dimension) || Result.isFailure(current)) {
    return Result.fail('invalid-authoritative-state')
  }
  if (
    decodedIntent.success.actor !== input.current?.actor && input.current !== null ||
    !Number.isFinite(input.pose.feetPosition.x) || !Number.isFinite(input.pose.feetPosition.y) ||
    !Number.isFinite(input.pose.feetPosition.z) || !Number.isFinite(input.pose.yawRadians) ||
    !Number.isFinite(input.pose.pitchRadians) || typeof input.hasShield !== 'boolean'
  ) return Result.fail('invalid-authoritative-state')
  const currentRaisedAt = current.success === null ? null : current.success.raisedAt
  if (currentRaisedAt !== null && tick.success < currentRaisedAt) {
    return Result.fail('invalid-tick-order')
  }
  if (decodedIntent.success.blocking && !input.hasShield) return Result.fail('shield-not-equipped')
  const attack = input.incoming === undefined
    ? Result.succeed(undefined)
    : Schema.decodeUnknownResult(ShieldIncomingAttackSchema, {
        onExcessProperty: 'error',
      })(input.incoming)
  if (Result.isFailure(attack)) return Result.fail('invalid-attack')
  if (attack.success !== undefined) {
    if (
      attack.success.attacker === decodedIntent.success.actor ||
      attack.success.attackerPosition.dimension !== dimension.success
    ) return Result.fail('invalid-attack')
  }

  const raisedAt = decodedIntent.success.blocking
    ? (currentRaisedAt ?? tick.success)
    : null
  let blocked = false
  let blockedAmount = 0
  let durabilityDamage = 0
  let event: DomainEvent | null = null

  if (decodedIntent.success.blocking && raisedAt !== null && attack.success !== undefined) {
    const ticksRaised = tick.success - raisedAt
    const dx = attack.success.attackerPosition.x - input.pose.feetPosition.x
    const dz = attack.success.attackerPosition.z - input.pose.feetPosition.z
    const distance = Math.hypot(dx, dz)
    const facingX = -Math.sin(input.pose.yawRadians)
    const facingZ = Math.cos(input.pose.yawRadians)
    const dot = facingX * dx + facingZ * dz
    const cross = facingX * dz - facingZ * dx
    if (!Number.isFinite(distance) || !Number.isFinite(dot) || !Number.isFinite(cross)) {
      return Result.fail('invalid-attack')
    }
    const horizontalAngle = distance === 0 ? Math.PI : Math.atan2(Math.abs(cross), dot)

    const blockable = attack.success.kind !== 'projectile' || attack.success.piercing !== true
    if (
      blockable &&
      ticksRaised >= SHIELD_BLOCKING_DELAY_TICKS &&
      horizontalAngle <= SHIELD_HORIZONTAL_BLOCKING_HALF_ANGLE_DEGREES * Math.PI / 180
    ) {
      blocked = true
      const amount = attack.success.amount
      blockedAmount = amount
      durabilityDamage = amount >= SHIELD_DURABILITY_DAMAGE_THRESHOLD ? Math.ceil(amount) : 0
      const defenderPosition = Result.getOrThrow(Schema.decodeUnknownResult(WorldPositionSchema)({
        dimension: dimension.success,
        x: input.pose.feetPosition.x,
        y: input.pose.feetPosition.y,
        z: input.pose.feetPosition.z,
      }))
      const domainEvent: DomainEvent = {
        _tag: 'ShieldBlocked',
        tick: tick.success,
        attacker: attack.success.attacker,
        defender: decodedIntent.success.actor,
        position: defenderPosition,
        blockedAmount: amount,
      }
      event = domainEvent
    }
  }

  const preparation: ShieldBlockingPreparation = {
    actor: decodedIntent.success.actor,
    blocking: decodedIntent.success.blocking,
    raisedAt,
    blocked,
    blockedAmount,
    durabilityDamage,
    event,
  }
  return Result.succeed(preparation)
}

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

  return position(
    PositionAxis(from.x + (dx / distance) * distanceMoved),
    from.y,
    PositionAxis(from.z + (dz / distance) * distanceMoved),
  )
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
