import type { Damage } from './death-cause.js'
import { Result } from 'effect'

export type FallDamageInputFailure = Readonly<{
  _tag: 'InvalidFallDamageInput'
  field: 'fallDistance'
}>

export const resolveFallDamage = (
  fallDistance: number,
): Result.Result<Damage | undefined, FallDamageInputFailure> => {
  if (!Number.isFinite(fallDistance) || fallDistance < 0) {
    return Result.fail({ _tag: 'InvalidFallDamageInput', field: 'fallDistance' })
  }

  if (fallDistance <= 3) return Result.succeed(undefined)
  return Result.succeed({ amount: Math.ceil(fallDistance - 3), cause: 'fall' })
}
