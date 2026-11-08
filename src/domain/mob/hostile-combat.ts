import type { Damage } from '../death-cause.js'
import { Brand, Result, Schema } from 'effect'
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
  type DamageAmount,
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
} from '@nerima-games/mc-sim'
import { explosionDamageAt, type Explosion } from './explosion.js'
import {
  DifficultyDamageResultSchema,
  scaleDifficultyDamage,
} from '../combat/difficulty-damage.js'
import type { SurvivalDifficulty } from '../survival-hunger.js'

export { DifficultyDamageResultSchema, scaleDifficultyDamage as scaleHostileDamageForDifficulty }

/** Java Edition startup delay; the default horizontal blocking angle is 90 degrees per side. */
export const SHIELD_BLOCKING_DELAY_TICKS = 5
export const SHIELD_HORIZONTAL_BLOCKING_HALF_ANGLE_DEGREES = 90
/** Attacks at or above this damage cause item durability loss in Java Edition. */
export const SHIELD_DURABILITY_DAMAGE_THRESHOLD = 3

export type ShieldBlockingIntent = Extract<IntentPayload, { readonly _tag: 'SetShieldBlocking' }>

type HostileCombatPoseAxis = number & Brand.Brand<'PositionAxis'>
type HostileCombatPoseAngle = number & Brand.Brand<'AngleRadians'>

export type HostileCombatPose = Readonly<{
  feetPosition: Readonly<{ x: HostileCombatPoseAxis; y: HostileCombatPoseAxis; z: HostileCombatPoseAxis }>
  yawRadians: HostileCombatPoseAngle
  pitchRadians: HostileCombatPoseAngle
}>

const HostileCombatPoseSchema: Schema.ConstraintDecoder<HostileCombatPose> = Schema.Struct({
  feetPosition: Schema.Struct({
    x: Schema.Finite.pipe(Schema.brand('PositionAxis')),
    y: Schema.Finite.pipe(Schema.brand('PositionAxis')),
    z: Schema.Finite.pipe(Schema.brand('PositionAxis')),
  }),
  yawRadians: Schema.Finite.pipe(Schema.brand('AngleRadians')),
  pitchRadians: Schema.Finite.pipe(Schema.brand('AngleRadians')),
})

export type ShieldBlockingState = Readonly<{
  actor: KernelEntityId
  raisedAt: SimulationTick
}>

export type DamageImmunityState = Readonly<{
  lastDamageTick: SimulationTick
  lastDamageAmount: DamageAmount
}>

export const DAMAGE_IMMUNITY_TICKS = 10

export const DamageImmunityStateSchema: Schema.ConstraintDecoder<DamageImmunityState> = Schema.Struct({
  lastDamageTick: SimulationTickSchema,
  lastDamageAmount: DamageAmountSchema,
})

export type DamageImmunityResolution = Readonly<{
  appliedAmount: AppliedDamageAmount
  state: DamageImmunityState
}>

type AppliedDamageAmountValue = Brand.Brand<'AppliedDamageAmount'>
type AppliedDamageAmount = number & AppliedDamageAmountValue

const AppliedDamageAmountSchema: Schema.Codec<AppliedDamageAmount, number> = Schema.Finite
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('AppliedDamageAmount'))

export const DamageImmunityResolutionSchema: Schema.ConstraintDecoder<DamageImmunityResolution> = Schema.Struct({
  appliedAmount: AppliedDamageAmountSchema,
  state: DamageImmunityStateSchema,
})

const DamageImmunityInputSchema = Schema.Struct({
  tick: SimulationTickSchema,
  amount: DamageAmountSchema,
  previousState: Schema.NullOr(DamageImmunityStateSchema),
})

export type DamageImmunityResolutionError = 'invalid-input' | 'invalid-tick-order'

/** Applies Java Edition's ten-tick hurt resistance to one incoming hit. */
export const resolveDamageWithInvulnerability = (
  input: unknown,
): Result.Result<DamageImmunityResolution, DamageImmunityResolutionError> => {
  const decoded = Schema.decodeUnknownResult(DamageImmunityInputSchema, {
    onExcessProperty: 'error',
  })(input)
  if (Result.isFailure(decoded)) return Result.fail('invalid-input')

  const { tick, amount, previousState } = decoded.success
  let appliedAmount: number = amount
  let state: DamageImmunityState = { lastDamageTick: tick, lastDamageAmount: amount }
  if (previousState !== null) {
    const ticksSinceLastDamage = tick - previousState.lastDamageTick
    if (ticksSinceLastDamage < 0) return Result.fail('invalid-tick-order')
    if (ticksSinceLastDamage < DAMAGE_IMMUNITY_TICKS) {
      appliedAmount = amount > previousState.lastDamageAmount
        ? amount - previousState.lastDamageAmount
        : 0
      state = appliedAmount > 0
        ? { ...previousState, lastDamageAmount: amount }
        : previousState
    }
  }

  const result = Schema.decodeUnknownResult(DamageImmunityResolutionSchema, {
    onExcessProperty: 'error',
  })({ appliedAmount, state })
  return Result.succeed(Result.getOrThrow(result))
}

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

type ShieldIncomingAttack = Readonly<{
  attacker: Schema.Schema.Type<typeof EntityIdSchema>
  attackerPosition: Schema.Schema.Type<typeof WorldPositionSchema>
  kind: 'melee' | 'projectile' | 'explosion'
  piercing?: Schema.Schema.Type<typeof Schema.Boolean>
  amount: Schema.Schema.Type<typeof DamageAmountSchema>
}>
export type ShieldIncomingAttackInput = Readonly<{
  attacker: Schema.Codec.Encoded<typeof EntityIdSchema>
  attackerPosition: Schema.Codec.Encoded<typeof WorldPositionSchema>
  kind: 'melee' | 'projectile' | 'explosion'
  piercing?: Schema.Codec.Encoded<typeof Schema.Boolean>
  amount: Schema.Codec.Encoded<typeof DamageAmountSchema>
}>

const ShieldIncomingAttackSchema: Schema.Codec<ShieldIncomingAttack, ShieldIncomingAttackInput> = Schema.Struct({
  attacker: EntityIdSchema,
  attackerPosition: WorldPositionSchema,
  kind: Schema.Literals(['melee', 'projectile', 'explosion']),
  piercing: Schema.optionalKey(Schema.Boolean),
  amount: DamageAmountSchema,
})

export type HostileAttackInput = Readonly<{
  tick: SimulationTick
  dimension: Dimension
  pose: HostileCombatPose
  hasShield: boolean
  currentShield: ShieldBlockingState | null
  incoming: ShieldIncomingAttackInput
  difficulty: SurvivalDifficulty
  damageState: DamageImmunityState | null
}>

const HostileAttackInputSchema: Schema.ConstraintDecoder<HostileAttackInput> = Schema.Struct({
  tick: SimulationTickSchema,
  dimension: DimensionIdSchema,
  pose: HostileCombatPoseSchema,
  hasShield: Schema.Boolean,
  currentShield: Schema.NullOr(ShieldBlockingStateSchema),
  incoming: ShieldIncomingAttackSchema,
  difficulty: Schema.Literals(['peaceful', 'easy', 'normal', 'hard']),
  damageState: Schema.NullOr(DamageImmunityStateSchema),
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
    pose: unknown
    hasShield: boolean
    current: ShieldBlockingState | null
    incoming?: ShieldIncomingAttackInput
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
  const pose = Schema.decodeUnknownResult(HostileCombatPoseSchema)(input.pose)
  if (
    Result.isFailure(tick) || Result.isFailure(dimension) ||
    Result.isFailure(current) || Result.isFailure(pose)
  ) {
    return Result.fail('invalid-authoritative-state')
  }
  if (
    decodedIntent.success.actor !== input.current?.actor && input.current !== null ||
    typeof input.hasShield !== 'boolean'
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
    const dx = attack.success.attackerPosition.x - pose.success.feetPosition.x
    const dz = attack.success.attackerPosition.z - pose.success.feetPosition.z
    const distance = Math.hypot(dx, dz)
    const facingX = -Math.sin(pose.success.yawRadians)
    const facingZ = Math.cos(pose.success.yawRadians)
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
        x: pose.success.feetPosition.x,
        y: pose.success.feetPosition.y,
        z: pose.success.feetPosition.z,
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

export type HostileAttackPreparation = Readonly<{
  shield: ShieldBlockingPreparation
  appliedAmount: AppliedDamageAmount
  damageState: DamageImmunityState | null
}>

export const HostileAttackPreparationSchema: Schema.ConstraintDecoder<HostileAttackPreparation> = Schema.Struct({
  shield: ShieldBlockingPreparationSchema,
  appliedAmount: AppliedDamageAmountSchema,
  damageState: Schema.NullOr(DamageImmunityStateSchema),
})

export type HostileAttackPreparationError =
  | 'invalid-intent'
  | 'invalid-input'
  | 'invalid-attack'
  | 'invalid-shield-state'
  | 'invalid-damage-state'

/** Prepare one hostile hit through difficulty, shield blocking, and hurt resistance. */
export const prepareHostileAttack = (
  intent: unknown,
  input: unknown,
): Result.Result<HostileAttackPreparation, HostileAttackPreparationError> => {
  const decodedIntent = Schema.decodeUnknownResult(IntentPayloadSchema, {
    onExcessProperty: 'error',
  })(intent)
  if (Result.isFailure(decodedIntent) || decodedIntent.success._tag !== 'SetShieldBlocking') {
    return Result.fail('invalid-intent')
  }
  const decodedInput = Schema.decodeUnknownResult(HostileAttackInputSchema, {
    onExcessProperty: 'error',
  })(input)
  if (Result.isFailure(decodedInput)) return Result.fail('invalid-input')
  if (
    decodedInput.success.damageState !== null &&
    decodedInput.success.damageState.lastDamageTick > decodedInput.success.tick
  ) return Result.fail('invalid-damage-state')

  const adjusted = scaleDifficultyDamage({
    amount: decodedInput.success.incoming.amount,
    difficulty: decodedInput.success.difficulty,
  })
  if (Result.isFailure(adjusted)) return Result.fail('invalid-attack')

  const incomingAmount = adjusted.success === 0
    ? undefined
    : Result.getOrThrow(Schema.decodeUnknownResult(DamageAmountSchema)(adjusted.success))

  const shield = prepareShieldBlocking(decodedIntent.success, {
    tick: decodedInput.success.tick,
    dimension: decodedInput.success.dimension,
    pose: decodedInput.success.pose,
    hasShield: decodedInput.success.hasShield,
    current: decodedInput.success.currentShield,
    ...(incomingAmount === undefined
      ? {}
      : { incoming: { ...decodedInput.success.incoming, amount: incomingAmount } }),
  })
  if (Result.isFailure(shield)) return Result.fail('invalid-shield-state')

  const damage = incomingAmount === undefined || shield.success.blocked
    ? Result.succeed({ appliedAmount: 0, state: decodedInput.success.damageState })
    : resolveDamageWithInvulnerability({
        tick: decodedInput.success.tick,
        amount: incomingAmount,
        previousState: decodedInput.success.damageState,
      })
  const resolvedDamage = Result.getOrThrow(damage)

  const result = Schema.decodeUnknownResult(HostileAttackPreparationSchema, {
    onExcessProperty: 'error',
  })({
    shield: shield.success,
    appliedAmount: resolvedDamage.appliedAmount,
    damageState: resolvedDamage.state,
  })
  return Result.succeed(Result.getOrThrow(result))
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

type HostileContactDamageEvent = Extract<PlayerDamageEvent, { readonly _tag: 'HostileContact' }>
type PlayerExplosionDamageEvent = Extract<PlayerDamageEvent, { readonly _tag: 'Explosion' }>

export type HostileContactResolution = {
  readonly damages: ReadonlyArray<HostileContactDamageEvent>
  readonly cooldowns: ReadonlyMap<EntityId, SimulationTick>
}

export type HostileContactResolutionError = 'invalid-input' | 'invalid-tick-order'

export const HOSTILE_CONTACT_INTERVAL_TICKS = 20
export const ZOMBIE_CONTACT_RANGE_BLOCKS = 1.5
export const ZOMBIE_CONTACT_DAMAGE: Damage = { amount: 3, cause: 'mob' }

export const resolveHostileContacts = <S>(
  entities: ReadonlyArray<Entity<S>>,
  target: Position | undefined,
  tick: SimulationTick,
  previousCooldowns: ReadonlyMap<EntityId, SimulationTick>,
  difficulty: SurvivalDifficulty = 'normal',
): Result.Result<HostileContactResolution, HostileContactResolutionError> => {
  const decodedTick = Schema.decodeUnknownResult(SimulationTickSchema)(tick)
  if (Result.isFailure(decodedTick)) return Result.fail('invalid-input')

  const currentTick = decodedTick.success
  const cooldowns = new Map<EntityId, SimulationTick>()
  for (const [id, previousTick] of previousCooldowns) {
    const decodedPreviousTick = Schema.decodeUnknownResult(SimulationTickSchema)(previousTick)
    if (Result.isFailure(decodedPreviousTick)) return Result.fail('invalid-input')
    if (currentTick < decodedPreviousTick.success) return Result.fail('invalid-tick-order')
    if (currentTick - decodedPreviousTick.success < HOSTILE_CONTACT_INTERVAL_TICKS) {
      cooldowns.set(id, decodedPreviousTick.success)
    }
  }

  if (target === undefined) {
    return Result.succeed({ damages: [], cooldowns })
  }

  const damages: Array<HostileContactDamageEvent> = []
  if (difficulty === 'peaceful') return Result.succeed({ damages, cooldowns })
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

    const scaledAmount = Result.getOrThrow(scaleDifficultyDamage({
      amount: ZOMBIE_CONTACT_DAMAGE.amount,
      difficulty,
    }))
    const amount = Result.getOrThrow(Schema.decodeUnknownResult(DamageAmountSchema)(scaledAmount))
    damages.push({
      _tag: 'HostileContact',
      source: entity.id,
      kind: entity.kind,
      at: entity.feetPosition,
      damage: { amount, cause: 'mob' },
    })
    cooldowns.set(entity.id, currentTick)
  }

  return Result.succeed({ damages, cooldowns })
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
  difficulty: SurvivalDifficulty = 'normal',
): ReadonlyArray<PlayerExplosionDamageEvent> => {
  if (target === undefined) return []

  const damages: Array<PlayerExplosionDamageEvent> = []
  for (const blast of blasts) {
    const baseDamage = explosionDamageAt(
      blast.explosion,
      Math.hypot(target.x - blast.at.x, target.y - blast.at.y, target.z - blast.at.z),
    )
    if (baseDamage.amount <= 0) continue
    const scaledAmount = Result.getOrThrow(scaleDifficultyDamage({
      amount: baseDamage.amount,
      difficulty,
    }))
    if (scaledAmount > 0) {
      const amount = Result.getOrThrow(Schema.decodeUnknownResult(DamageAmountSchema)(scaledAmount))
      damages.push({
        _tag: 'Explosion',
        source: blast.source,
        kind: blast.kind,
        at: blast.at,
        explosion: blast.explosion,
        damage: { amount, cause: 'explosion' },
      })
    }
  }
  return damages
}
