import type { Position } from '@nerima-games/mc-kernel'
import type { Entity } from '@nerima-games/mc-sim'
import { HOSTILE_KINDS, type MobBehaviour } from '../entities/mob-frame'
import type { ItemType } from '../item-vocabulary'
import { shotTarget, type ShotHit } from './bow-shot'

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
export const meleeDamageForItem = (item: ItemType | null | undefined): number =>
  item === null || item === undefined
    ? DEFAULT_MELEE_DAMAGE
    : (SWORD_MELEE_DAMAGE[item] ?? DEFAULT_MELEE_DAMAGE)

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
