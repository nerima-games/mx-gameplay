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
  type Position,
  type SimulationTick,
} from '@nerima-games/mc-kernel'
import { EYE_LEVEL_OFFSET, IntentPayloadSchema, type Entity, type IntentPayload, type PlayerPose } from '@nerima-games/mc-sim'
import { Result, Schema } from 'effect'
import { HOSTILE_KINDS, type MobBehaviour } from '../entities/mob-frame.js'
import type { ItemType } from '@nerima-games/mc-kernel'
import { shotTarget, type ShotHit } from './bow-shot.js'

/** Vanilla-style survival melee reach, measured from the player's eye position. */
export const DEFAULT_MELEE_REACH = 3

/** Damage dealt by an unarmed primary attack. */
export const DEFAULT_MELEE_DAMAGE = 1

const SWORD_MELEE_DAMAGE: Readonly<Partial<Record<ItemType, number>>> = {
  wooden_sword: 4,
  stone_sword: 5,
  iron_sword: 6,
  diamond_sword: 7,
}

/** Damage for the held item; bare hands and non-swords use the unarmed value. */
export const meleeDamageForItem = (
  item: ItemType | null | undefined,
  critical = false,
): number => {
  const base = item === null || item === undefined
    ? DEFAULT_MELEE_DAMAGE
    : (SWORD_MELEE_DAMAGE[item] ?? DEFAULT_MELEE_DAMAGE)
  return critical ? base * 1.5 : base
}

export type MeleeAttackRequest = {
  /** Correlates host-facing completion results. Legacy callers may omit it. */
  readonly requestId?: string
  readonly origin: Position
  readonly direction: Position
  readonly reach: number
  readonly damage: number
  /** Host raycast distance to terrain. A target at or beyond it is blocked. */
  readonly hitDistance?: number
}

export type MeleeAttackResult =
  | { readonly requestId: string; readonly success: true; readonly target: ShotHit }
  | { readonly requestId: string; readonly success: false }

export const meleeTarget = (
  candidates: ReadonlyArray<Entity<MobBehaviour>>,
  request: MeleeAttackRequest,
): ShotHit | undefined => {
  if (!Number.isFinite(request.reach) || request.reach < 0) return undefined
  if (request.hitDistance !== undefined && (!Number.isFinite(request.hitDistance) || request.hitDistance < 0)) {
    return undefined
  }

  const target = shotTarget(
    candidates.filter((candidate) => HOSTILE_KINDS.includes(candidate.kind)),
    request.origin,
    request.direction.x,
    request.direction.y,
    request.direction.z,
    request.reach,
  )
  if (target === undefined) return undefined
  return request.hitDistance !== undefined && target.distance >= request.hitDistance ? undefined : target
}

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
}>

export const MeleeAttackPreparationSchema: Schema.ConstraintDecoder<MeleeAttackPreparation> = Schema.Struct({
  target: Schema.Struct({ id: EntityIdSchema, distance: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) }),
  event: DomainEventSchema,
})

export type MeleeAttackPreparationError =
  | 'invalid-intent'
  | 'invalid-authoritative-state'
  | 'no-target'
  | 'invalid-event'

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
    blockDistance?: number
  }>,
): Result.Result<MeleeAttackPreparation, MeleeAttackPreparationError> => {
  const decodedIntent = Schema.decodeUnknownResult(IntentPayloadSchema)(intent)
  if (Result.isFailure(decodedIntent) || decodedIntent.success._tag !== 'MeleeAttack') {
    return Result.fail('invalid-intent')
  }
  const tick = Schema.decodeUnknownResult(SimulationTickSchema)(input.tick)
  const dimension = Schema.decodeUnknownResult(DimensionIdSchema)(input.dimension)
  if (Result.isFailure(tick) || Result.isFailure(dimension)) {
    return Result.fail('invalid-authoritative-state')
  }
  if (
    !Number.isFinite(input.pose.feetPosition.x) || !Number.isFinite(input.pose.feetPosition.y) ||
    !Number.isFinite(input.pose.feetPosition.z) || !Number.isFinite(input.pose.yawRadians) ||
    !Number.isFinite(input.pose.pitchRadians) || typeof input.critical !== 'boolean' ||
    (input.blockDistance !== undefined &&
      (!Number.isFinite(input.blockDistance) || input.blockDistance < 0))
  ) return Result.fail('invalid-authoritative-state')

  const eyeY = input.pose.feetPosition.y + EYE_LEVEL_OFFSET
  if (!Number.isFinite(eyeY)) return Result.fail('invalid-authoritative-state')

  const origin = position(
    PositionAxis(input.pose.feetPosition.x),
    PositionAxis(eyeY),
    PositionAxis(input.pose.feetPosition.z),
  )
  const direction = position(
    PositionAxis(-Math.sin(input.pose.yawRadians) * Math.cos(input.pose.pitchRadians)),
    PositionAxis(-Math.sin(input.pose.pitchRadians)),
    PositionAxis(Math.cos(input.pose.yawRadians) * Math.cos(input.pose.pitchRadians)),
  )
  const target = meleeTarget(input.entities, {
    origin,
    direction,
    reach: DEFAULT_MELEE_REACH,
    damage: meleeDamageForItem(input.heldItem, input.critical),
    ...(input.blockDistance === undefined ? {} : { hitDistance: input.blockDistance }),
  })
  if (target === undefined) return Result.fail('no-target')
  const targetEntity = input.entities.find((entity) => entity.id === target.id)
  if (targetEntity === undefined) return Result.fail('no-target')
  const amount = Schema.decodeUnknownResult(DamageAmountSchema)(meleeDamageForItem(input.heldItem, input.critical))
  if (Result.isFailure(amount)) return Result.fail('invalid-authoritative-state')
  const targetPosition = Schema.decodeUnknownResult(WorldPositionSchema)({
    dimension: dimension.success,
    x: targetEntity.feetPosition.x,
    y: targetEntity.feetPosition.y,
    z: targetEntity.feetPosition.z,
  })
  if (Result.isFailure(targetPosition)) return Result.fail('invalid-authoritative-state')

  const event = Schema.decodeUnknownResult(DomainEventSchema, {
    onExcessProperty: 'error',
  })({
    _tag: 'EntityDamaged',
    tick: tick.success,
    entity: target.id,
    position: targetPosition.success,
    amount: amount.success,
    cause: 'mob',
  })
  if (Result.isFailure(event) || event.success._tag !== 'EntityDamaged') {
    return Result.fail('invalid-event')
  }
  const decoded = Schema.decodeUnknownResult(MeleeAttackPreparationSchema, {
    onExcessProperty: 'error',
  })({ target, event: event.success })
  return Result.isFailure(decoded) ? Result.fail('invalid-event') : Result.succeed(decoded.success)
}
