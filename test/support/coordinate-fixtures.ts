import { Result } from 'effect'
import {
  BlockAxis,
  ChunkAxis,
  PositionAxis,
  blockPosition as kernelBlockPosition,
  chunkCoord as kernelChunkCoord,
  position as kernelPosition,
  type BlockPosition,
  type ChunkCoord,
  type Position,
} from '@nerima-games/mc-kernel'

const blockAxis = (value: number): BlockAxis => Result.getOrThrow(BlockAxis.result(value))
const positionAxis = (value: number): PositionAxis => Result.getOrThrow(PositionAxis.result(value))

export const blockPosition = (x: number, y: number, z: number): BlockPosition =>
  kernelBlockPosition(blockAxis(x), blockAxis(y), blockAxis(z))

export const chunkCoord = (cx: number, cz: number): ChunkCoord =>
  kernelChunkCoord(Result.getOrThrow(ChunkAxis.result(cx)), Result.getOrThrow(ChunkAxis.result(cz)))

export const position = (x: number, y: number, z: number): Position =>
  kernelPosition(positionAxis(x), positionAxis(y), positionAxis(z))
