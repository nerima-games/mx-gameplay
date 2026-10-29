import {
  AttackRangeDistance,
  DamageAmountSchema,
  DomainEventSchema,
  EntityIdSchema,
  PositionAxis,
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
  readonly reach: AttackRangeDistance
  readonly damage: number
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
    candidates.filter((candidate) => HOSTILE_KINDS.includes(candidate.kind)),
    request.origin,
    request.direction,
    request.reach,
  )
  if (match === undefined) return undefined
  if (request.hitDistance !== undefined && match.hit.distance >= request.hitDistance) return undefined
  return { entity: match.candidate, target: match.hit }
}

/** Returns the nearest hostile target only when it is closer than the aimed block. */
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
}>

export const MeleeAttackPreparationSchema: Schema.ConstraintDecoder<MeleeAttackPreparation> = Schema.Struct({
  target: Schema.Struct({ id: EntityIdSchema, distance: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) }),
  event: DomainEventSchema,
})

export type MeleeAttackPreparationError =
  | 'invalid-intent'
  | 'invalid-authoritative-state'
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
    blockDistance?: AttackRangeDistance
  }>,
): Result.Result<MeleeAttackPreparation, MeleeAttackPreparationError> => {
  const decodedIntent = Schema.decodeUnknownResult(IntentPayloadSchema)(intent)
  if (Result.isFailure(decodedIntent) || decodedIntent.success._tag !== 'MeleeAttack') {
    return Result.fail('invalid-intent')
  }
  const tick = input.tick
  const dimension = input.dimension
  const eyeY = input.pose.feetPosition.y + EYE_LEVEL_OFFSET

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
  const match = meleeTargetMatch(input.entities, {
    origin,
    direction,
    reach: DEFAULT_MELEE_REACH,
    damage: meleeDamageForItem(input.heldItem, input.critical),
    ...(input.blockDistance === undefined ? {} : { hitDistance: input.blockDistance }),
  })
  if (match === undefined) return Result.fail('no-target')

  const amount = Result.getOrThrow(
    Schema.decodeUnknownResult(DamageAmountSchema)(
      meleeDamageForItem(input.heldItem, input.critical),
    ),
  )
  const targetPosition = Result.getOrThrow(Schema.decodeUnknownResult(WorldPositionSchema)({
    dimension,
    x: match.entity.feetPosition.x,
    y: match.entity.feetPosition.y,
    z: match.entity.feetPosition.z,
  }))
  const event: DomainEvent = Result.getOrThrow(Schema.decodeUnknownResult(DomainEventSchema)({
    _tag: 'EntityDamaged',
    tick,
    entity: match.target.id,
    position: targetPosition,
    amount,
    cause: 'mob',
  }))
  return Result.succeed({ target: match.target, event })
}
