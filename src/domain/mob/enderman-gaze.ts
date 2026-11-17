import type { Position } from '@nerima-games/mc-kernel'
import type { PlayerPose } from '@nerima-games/mc-sim'
import { ENDERMAN_DIMENSIONS, PLAYER_DIMENSIONS } from '../entities/entity-dimensions.js'
import { playerLookVector } from '../player-look-vector.js'

// Rule facts only: https://github.com/PaperMC/Paper/blob/ver/1.21.4/paper-server/patches/sources/net/minecraft/world/entity/monster/EnderMan.java.patch
export const isLookingAtEnderman = (
  playerFeet: Position,
  yawRadians: PlayerPose['yawRadians'],
  pitchRadians: PlayerPose['pitchRadians'],
  endermanFeet: Position,
): boolean => {
  const dx = endermanFeet.x - playerFeet.x
  const dy = endermanFeet.y - playerFeet.y
  const dz = endermanFeet.z - playerFeet.z
  if (Math.hypot(dx, dy, dz) > 64) return false
  const eyeDy = dy + ENDERMAN_DIMENSIONS.eyeHeight - PLAYER_DIMENSIONS.eyeHeight
  const distance = Math.hypot(dx, eyeDy, dz)
  if (distance === 0) return false
  const lookVector = playerLookVector(yawRadians, pitchRadians)
  const dot = lookVector.x * (dx / distance) + lookVector.y * (eyeDy / distance) +
    lookVector.z * (dz / distance)
  return dot > 1 - 0.025 / distance
}
