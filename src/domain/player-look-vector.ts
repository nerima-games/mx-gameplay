import {
  PositionAxis,
  position,
  type Position,
} from '@nerima-games/mc-kernel'
import type { PlayerPose } from '@nerima-games/mc-sim'

export const playerLookVector = (
  yawRadians: PlayerPose['yawRadians'],
  pitchRadians: PlayerPose['pitchRadians'],
): Position =>
  position(
    PositionAxis(-Math.sin(yawRadians) * Math.cos(pitchRadians)),
    PositionAxis(Math.sin(pitchRadians)),
    PositionAxis(-Math.cos(yawRadians) * Math.cos(pitchRadians)),
  )
