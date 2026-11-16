import { Result, Schema } from 'effect'

const GazePositionSchema = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite })
const GazeInputSchema = Schema.Struct({
  playerFeet: GazePositionSchema,
  yawRadians: Schema.Finite,
  pitchRadians: Schema.Finite,
  endermanFeet: GazePositionSchema,
})

// Rule facts only: https://github.com/PaperMC/Paper/blob/ver/1.21.4/paper-server/patches/sources/net/minecraft/world/entity/monster/EnderMan.java.patch
export const isLookingAtEnderman = (
  playerFeet: unknown,
  yawRadians: unknown,
  pitchRadians: unknown,
  endermanFeet: unknown,
): Result.Result<boolean, 'invalid-gaze-input'> => {
  const decoded = Schema.decodeUnknownResult(GazeInputSchema)({ playerFeet, yawRadians, pitchRadians, endermanFeet })
  if (Result.isFailure(decoded)) return Result.fail('invalid-gaze-input')
  const { playerFeet: player, yawRadians: yaw, pitchRadians: pitch, endermanFeet: enderman } = decoded.success
  const dx = enderman.x - player.x
  const dy = enderman.y - player.y
  const dz = enderman.z - player.z
  if (Math.hypot(dx, dy, dz) > 64) return Result.succeed(false)
  const eyeDy = dy + 2.55 - 1.62
  const distance = Math.hypot(dx, eyeDy, dz)
  if (distance === 0) return Result.succeed(false)
  const dot = -Math.sin(yaw) * Math.cos(pitch) * (dx / distance) -
    Math.sin(pitch) * (eyeDy / distance) + Math.cos(yaw) * Math.cos(pitch) * (dz / distance)
  return Result.succeed(dot > 1 - 0.025 / distance)
}
