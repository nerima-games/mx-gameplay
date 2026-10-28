import { Result } from 'effect'
import {
  BlockAxis,
  PositionAxis,
  blockPosition as kernelBlockPosition,
  position as kernelPosition,
  type BlockPosition,
  type Position,
} from '@nerima-games/mc-kernel'

const blockAxis = (value: number): BlockAxis => Result.getOrThrow(BlockAxis.result(value))
const positionAxis = (value: number): PositionAxis => Result.getOrThrow(PositionAxis.result(value))

export const blockPosition = (x: number, y: number, z: number): BlockPosition =>
  kernelBlockPosition(blockAxis(x), blockAxis(y), blockAxis(z))

export const position = (x: number, y: number, z: number): Position =>
  kernelPosition(positionAxis(x), positionAxis(y), positionAxis(z))
