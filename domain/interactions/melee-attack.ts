import type { Entity, Position } from '../entity-manager-port'
import { HOSTILE_KINDS, type MobBehaviour } from '../entities/mob-frame'
import { shotTarget, type ShotHit } from './bow-shot'

/** Vanilla-style survival melee reach, measured from the player's eye position. */
export const DEFAULT_MELEE_REACH = 3

/** Damage dealt by an unarmed primary attack. */
export const DEFAULT_MELEE_DAMAGE = 1

export type MeleeAttackRequest = {
  readonly origin: Position
  readonly direction: Position
  readonly reach: number
  readonly damage: number
  /** Host raycast distance to terrain. A target at or beyond it is blocked. */
  readonly hitDistance?: number
}

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
