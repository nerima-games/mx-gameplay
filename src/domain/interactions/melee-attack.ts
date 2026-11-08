import {
  AttackRangeDistance,
  DamageAmountSchema,
  DimensionIdSchema,
  DomainEventSchema,
  EntityIdSchema,
  isItemType,
  PositionAxis,
  SimulationTickSchema,
  WorldPositionSchema,
  position,
  type Dimension,
  type DomainEvent,
  type ItemType,
  type Position,
  type SimulationTick,
} from '@nerima-games/mc-kernel'
import {
  EYE_LEVEL_OFFSET,
  IntentPayloadSchema,
  type Entity,
  type IntentPayload,
  type PlayerPose,
  type StorageLocation,
} from '@nerima-games/mc-sim'
import { Brand, Result, Schema } from 'effect'
import { HOSTILE_KINDS, type MobBehaviour } from '../entities/mob-frame.js'
import {
  DamageImmunityStateSchema,
  resolveDamageWithInvulnerability,
  type DamageImmunityState,
} from '../mob/hostile-combat.js'
import { PASSIVE_MOB_KINDS } from '../mob/mob-ecosystem.js'
import { knockbackDirection, KnockbackDirectionSchema, type KnockbackDirection } from './knockback.js'
import { shotTargetWithCandidate, type ShotHit } from './bow-shot.js'

/** Vanilla-style survival melee reach, measured from the player's eye position. */
export const DEFAULT_MELEE_REACH: AttackRangeDistance = AttackRangeDistance(3)

/** Damage dealt by an unarmed primary attack. */
export const DEFAULT_MELEE_DAMAGE = 1

const SWORD_MELEE_DAMAGE: Readonly<Partial<Record<ItemType, number>>> = {
  wooden_sword: 4,
  gold_sword: 4,
  stone_sword: 5,
  iron_sword: 6,
  diamond_sword: 7,
  netherite_sword: 8,
}

const TOOL_MELEE_DAMAGE: Readonly<Partial<Record<ItemType, number>>> = {
  wooden_axe: 7,
  gold_axe: 7,
  stone_axe: 9,
  iron_axe: 9,
  diamond_axe: 9,
  netherite_axe: 10,
  wooden_pickaxe: 2,
  gold_pickaxe: 2,
  stone_pickaxe: 3,
  iron_pickaxe: 4,
  diamond_pickaxe: 5,
  netherite_pickaxe: 6,
  wooden_shovel: 2.5,
  gold_shovel: 2.5,
  stone_shovel: 3.5,
  iron_shovel: 4.5,
  diamond_shovel: 5.5,
  netherite_shovel: 6.5,
  wooden_hoe: 1,
  gold_hoe: 1,
  stone_hoe: 1,
  iron_hoe: 1,
  diamond_hoe: 1,
  netherite_hoe: 1,
}

const TOOL_ATTACK_SPEED: Readonly<Partial<Record<ItemType, number>>> = {
  wooden_axe: 0.8,
  gold_axe: 1,
  stone_axe: 0.8,
  iron_axe: 0.9,
  diamond_axe: 1,
  netherite_axe: 1,
  wooden_pickaxe: 1.2,
  gold_pickaxe: 1.2,
  stone_pickaxe: 1.2,
  iron_pickaxe: 1.2,
  diamond_pickaxe: 1.2,
  netherite_pickaxe: 1.2,
  wooden_shovel: 1,
  gold_shovel: 1,
  stone_shovel: 1,
  iron_shovel: 1,
  diamond_shovel: 1,
  netherite_shovel: 1,
  wooden_hoe: 1,
  gold_hoe: 1,
  stone_hoe: 2,
  iron_hoe: 3,
  diamond_hoe: 4,
  netherite_hoe: 4,
}

export const DEFAULT_MELEE_ATTACK_SPEED = 4
export const MELEE_ATTACK_COOLDOWN_TICKS_PER_SECOND = 20
export const MIN_ATTACK_COOLDOWN_FOR_CRITICAL = 0.848

type MeleeCooldownTicksValue = Brand.Brand<'MeleeCooldownTicks'>
export type MeleeCooldownTicks = number & MeleeCooldownTicksValue

export const MeleeCooldownTicksSchema: Schema.Codec<MeleeCooldownTicks, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand('MeleeCooldownTicks'))

const MeleeAttackCooldownInputSchema: Schema.ConstraintDecoder<{
  attackSpeed: number
  ticksSinceLastAttack: MeleeCooldownTicks
}> = Schema.Struct({
  attackSpeed: Schema.Finite.check(Schema.isGreaterThan(0)),
  ticksSinceLastAttack: MeleeCooldownTicksSchema,
})

export const MeleeAttackCooldownSchema: Schema.ConstraintDecoder<{
  charge: number
  damageMultiplier: number
}> = Schema.Struct({
  charge: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  damageMultiplier: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0.2), Schema.isLessThanOrEqualTo(1)),
})

export type MeleeAttackCooldown = Schema.Schema.Type<typeof MeleeAttackCooldownSchema>
export type MeleeAttackCooldownError = 'invalid-input' | 'invalid-result'

const meleeAttackSpeedForItem = (item: ItemType | null | undefined): number =>
  item === null || item === undefined
    ? DEFAULT_MELEE_ATTACK_SPEED
    : item.endsWith('_sword')
      ? 1.6
      : (TOOL_ATTACK_SPEED[item] ?? DEFAULT_MELEE_ATTACK_SPEED)

export const meleeAttackCooldown = (input: unknown): Result.Result<MeleeAttackCooldown, MeleeAttackCooldownError> => {
  const decoded = Schema.decodeUnknownResult(MeleeAttackCooldownInputSchema, {
    onExcessProperty: 'error',
  })(input)
  if (Result.isFailure(decoded)) return Result.fail('invalid-input')

  const cooldownTicks = MELEE_ATTACK_COOLDOWN_TICKS_PER_SECOND / decoded.success.attackSpeed
  const charge = Math.min(1, (decoded.success.ticksSinceLastAttack + 0.5) / cooldownTicks)
  const result = Schema.decodeUnknownResult(MeleeAttackCooldownSchema)({
    charge,
    damageMultiplier: 0.2 + 0.8 * charge ** 2,
  })
  if (Result.isFailure(result)) return Result.fail('invalid-result')
  return Result.succeed(result.success)
}

export const meleeAttackCooldownForItem = (
  item: ItemType | null | undefined,
  ticksSinceLastAttack: unknown,
): Result.Result<MeleeAttackCooldown, MeleeAttackCooldownError> => {
  if (item !== null && item !== undefined && !isItemType(item)) return Result.fail('invalid-input')
  return meleeAttackCooldown({
    attackSpeed: meleeAttackSpeedForItem(item),
    ticksSinceLastAttack,
  })
}

/** Damage for the held item; bare hands and non-weapon items use the unarmed value. */
export const meleeDamageForItem = (
  item: ItemType | null | undefined,
  critical = false,
): number => {
  const base = item === null || item === undefined
    ? DEFAULT_MELEE_DAMAGE
    : (SWORD_MELEE_DAMAGE[item] ?? TOOL_MELEE_DAMAGE[item] ?? DEFAULT_MELEE_DAMAGE)
  return critical ? base * 1.5 : base
}

export type MeleeAttackRequest = {
  /** Correlates host-facing completion results. Legacy callers may omit it. */
  readonly requestId?: string
  readonly origin: Position
  readonly direction: Position
  readonly reach: AttackRangeDistance
  readonly damage: number
  /** Selected weapon slot used for atomic durability wear by the interactions stage. */
  readonly toolLocation?: StorageLocation
  /** Host raycast distance to terrain. A target at or beyond it is blocked. */
  readonly hitDistance?: number
}

export type MeleeAttackResult =
  | { readonly requestId: string; readonly success: true; readonly target: ShotHit }
  | { readonly requestId: string; readonly success: false }

type MeleeTargetMatch = Readonly<{ entity: Entity<MobBehaviour>; target: ShotHit }>

const meleeTargetMatch = (
  candidates: ReadonlyArray<Entity<MobBehaviour>>,
  request: MeleeAttackRequest,
): MeleeTargetMatch | undefined => {
  if (request.hitDistance !== undefined && (!Number.isFinite(request.hitDistance) || request.hitDistance < 0)) {
    return undefined
  }

  const match = shotTargetWithCandidate(
    candidates.filter((candidate) =>
      HOSTILE_KINDS.includes(candidate.kind) || PASSIVE_MOB_KINDS.some((kind) => kind === candidate.kind),
    ),
    request.origin,
    request.direction,
    request.reach,
  )
  if (match === undefined) return undefined
  if (request.hitDistance !== undefined && match.hit.distance >= request.hitDistance) return undefined
  return { entity: match.candidate, target: match.hit }
}

/** Returns the nearest mob target only when it is closer than the aimed block. */
export const meleeTarget = (
  candidates: ReadonlyArray<Entity<MobBehaviour>>,
  request: MeleeAttackRequest,
): ShotHit | undefined => meleeTargetMatch(candidates, request)?.target

/** Compose helper: returns a melee target only when it is closer than the aimed block. */
export const meleeTargetBeforeBlock = (
  candidates: ReadonlyArray<Entity<MobBehaviour>>,
  request: Omit<MeleeAttackRequest, 'hitDistance'>,
  blockDistance: number | undefined,
): ShotHit | undefined =>
  meleeTarget(candidates, {
    ...request,
    ...(blockDistance === undefined ? {} : { hitDistance: blockDistance }),
  })

export type MeleeAttackIntent = Extract<IntentPayload, { readonly _tag: 'MeleeAttack' }>

export type MeleeAttackPreparation = Readonly<{
  target: ShotHit
  event: DomainEvent
  knockback: KnockbackDirection
  targetDamageState: DamageImmunityState
}>

export const MeleeAttackPreparationSchema: Schema.ConstraintDecoder<MeleeAttackPreparation> = Schema.Struct({
  target: Schema.Struct({ id: EntityIdSchema, distance: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) }),
  event: DomainEventSchema,
  knockback: KnockbackDirectionSchema,
  targetDamageState: DamageImmunityStateSchema,
})

export type MeleeAttackPreparationError =
  | 'invalid-intent'
  | 'invalid-authoritative-state'
  | 'invalid-attack-timing'
  | 'target-invulnerable'
  | 'no-target'

/** Prepare a C2 melee hit from the server pose, entity roster, inventory item, and world ray. */
export const prepareMeleeAttack = (
  intent: MeleeAttackIntent,
  input: Readonly<{
    tick: SimulationTick
    dimension: Dimension
    pose: PlayerPose
    entities: ReadonlyArray<Entity<MobBehaviour>>
    heldItem: ItemType | null
    critical: boolean
    ticksSinceLastAttack: MeleeCooldownTicks
    targetDamageState: DamageImmunityState | null
    blockDistance?: AttackRangeDistance
  }>,
): Result.Result<MeleeAttackPreparation, MeleeAttackPreparationError> => {
  const decodedIntent = Schema.decodeUnknownResult(IntentPayloadSchema, {
    onExcessProperty: 'error',
  })(intent)
  if (Result.isFailure(decodedIntent) || decodedIntent.success._tag !== 'MeleeAttack') {
    return Result.fail('invalid-intent')
  }
  if (typeof input !== 'object' || input === null || !Array.isArray(input.entities)) {
    return Result.fail('invalid-authoritative-state')
  }
  const tick = Schema.decodeUnknownResult(SimulationTickSchema)(input.tick)
  const dimension = Schema.decodeUnknownResult(DimensionIdSchema)(input.dimension)
  if (Result.isFailure(tick) || Result.isFailure(dimension)) {
    return Result.fail('invalid-authoritative-state')
  }
  const pose = input.pose
  if (
    typeof pose !== 'object' || pose === null ||
    typeof pose.feetPosition !== 'object' || pose.feetPosition === null ||
    !Number.isFinite(pose.feetPosition.x) || !Number.isFinite(pose.feetPosition.y) ||
    !Number.isFinite(pose.feetPosition.z) || !Number.isFinite(pose.yawRadians) ||
    !Number.isFinite(pose.pitchRadians)
  ) return Result.fail('invalid-authoritative-state')
  for (const candidate of input.entities) {
    if (
      typeof candidate !== 'object' || candidate === null || typeof candidate.id !== 'string' ||
      typeof candidate.kind !== 'string' || typeof candidate.feetPosition !== 'object' ||
      candidate.feetPosition === null || !Number.isFinite(candidate.feetPosition.x) ||
      !Number.isFinite(candidate.feetPosition.y) || !Number.isFinite(candidate.feetPosition.z)
    ) return Result.fail('invalid-authoritative-state')
  }
  if (typeof input.critical !== 'boolean') return Result.fail('invalid-authoritative-state')
  if (input.heldItem !== null && !isItemType(input.heldItem)) return Result.fail('invalid-authoritative-state')

  const cooldown = meleeAttackCooldownForItem(input.heldItem, input.ticksSinceLastAttack)
  if (Result.isFailure(cooldown)) return Result.fail('invalid-attack-timing')

  const critical = input.critical && cooldown.success.charge >= MIN_ATTACK_COOLDOWN_FOR_CRITICAL
  const attackDamage = meleeDamageForItem(input.heldItem) * cooldown.success.damageMultiplier * (critical ? 1.5 : 1)

  const eyeY = pose.feetPosition.y + EYE_LEVEL_OFFSET

  const origin = position(
    PositionAxis(pose.feetPosition.x),
    PositionAxis(eyeY),
    PositionAxis(pose.feetPosition.z),
  )
  const direction = position(
    PositionAxis(-Math.sin(pose.yawRadians) * Math.cos(pose.pitchRadians)),
    PositionAxis(-Math.sin(pose.pitchRadians)),
    PositionAxis(Math.cos(pose.yawRadians) * Math.cos(pose.pitchRadians)),
  )
  const match = meleeTargetMatch(input.entities, {
    origin,
    direction,
    reach: DEFAULT_MELEE_REACH,
    damage: attackDamage,
    ...(input.blockDistance === undefined ? {} : { hitDistance: input.blockDistance }),
  })
  if (match === undefined) return Result.fail('no-target')

  const invulnerability = resolveDamageWithInvulnerability({
    tick: tick.success,
    amount: attackDamage,
    previousState: input.targetDamageState,
  })
  if (Result.isFailure(invulnerability)) return Result.fail('invalid-authoritative-state')
  if (invulnerability.success.appliedAmount <= 0) return Result.fail('target-invulnerable')
  if (invulnerability.success.state === null) return Result.fail('invalid-authoritative-state')
  const amount = Schema.decodeUnknownResult(DamageAmountSchema)(invulnerability.success.appliedAmount)
  if (Result.isFailure(amount)) return Result.fail('invalid-authoritative-state')

  const targetPosition = Schema.decodeUnknownResult(WorldPositionSchema)({
    dimension: dimension.success,
    x: match.entity.feetPosition.x,
    y: match.entity.feetPosition.y,
    z: match.entity.feetPosition.z,
  })
  if (Result.isFailure(targetPosition)) return Result.fail('invalid-authoritative-state')
  const decodedEvent = Schema.decodeUnknownResult(DomainEventSchema)({
    _tag: 'EntityDamaged',
    tick: tick.success,
    entity: match.target.id,
    position: targetPosition.success,
    amount: amount.success,
    cause: 'mob',
  })
  if (Result.isFailure(decodedEvent)) return Result.fail('invalid-authoritative-state')
  const result: MeleeAttackPreparation = {
    target: match.target,
    event: decodedEvent.success,
    knockback: knockbackDirection(
      match.entity.feetPosition.x - pose.feetPosition.x,
      match.entity.feetPosition.z - pose.feetPosition.z,
    ),
    targetDamageState: invulnerability.success.state,
  }
  const decodedResult = Schema.decodeUnknownResult(MeleeAttackPreparationSchema, {
    onExcessProperty: 'error',
  })(result)
  if (Result.isFailure(decodedResult)) return Result.fail('invalid-authoritative-state')
  return Result.succeed(decodedResult.success)
}
