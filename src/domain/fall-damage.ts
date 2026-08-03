import type { Damage } from './death-cause'

export const resolveFallDamage = (fallDistance: number): Damage | undefined => {
  if (!Number.isFinite(fallDistance) || fallDistance <= 3) {
    return undefined
  }

  return { amount: Math.ceil(fallDistance - 3), cause: 'fall' }
}
