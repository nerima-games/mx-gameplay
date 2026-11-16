import { Result } from 'effect'

// Rule facts only: https://github.com/PaperMC/Paper/blob/ver/1.21.4/paper-server/patches/sources/net/minecraft/world/entity/monster/EnderMan.java.patch
export const isLookingAtEnderman = (
  playerFeet: Readonly<{ x: number; y: number; z: number }>,
  yawRadians: number,
  pitchRadians: number,
  endermanFeet: Readonly<{ x: number; y: number; z: number }>,
): Result.Result<boolean, 'invalid-gaze-input'> => {
  if (![playerFeet.x, playerFeet.y, playerFeet.z, endermanFeet.x, endermanFeet.y,
    endermanFeet.z, yawRadians, pitchRadians].every(Number.isFinite)) return Result.fail('invalid-gaze-input')
  const dx = endermanFeet.x - playerFeet.x
  const dy = endermanFeet.y - playerFeet.y
  const dz = endermanFeet.z - playerFeet.z
  if (Math.hypot(dx, dy, dz) > 64) return Result.succeed(false)
  const eyeDy = dy + 2.55 - 1.62
  const distance = Math.hypot(dx, eyeDy, dz)
  if (distance === 0) return Result.succeed(false)
  const dot = -Math.sin(yawRadians) * Math.cos(pitchRadians) * (dx / distance) -
    Math.sin(pitchRadians) * (eyeDy / distance) + Math.cos(yawRadians) * Math.cos(pitchRadians) * (dz / distance)
  return Result.succeed(dot > 1 - 0.025 / distance)
}
