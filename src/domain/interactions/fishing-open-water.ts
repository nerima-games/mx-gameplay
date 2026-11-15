import {
  AIR_BLOCK_ID,
  BlockPositionSchema,
  blockIdOf,
  type BlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import type { BlockReading } from '@nerima-games/mc-worldgen'
import { Effect, Option, Result, Schema } from 'effect'

const WATER_BLOCK_ID: BlockId = Option.getOrThrow(blockIdOf('water'))

export const FISHING_OPEN_WATER_HORIZONTAL_RADIUS = 2
export const FISHING_OPEN_WATER_LOWEST_LAYER = -1
export const FISHING_OPEN_WATER_HIGHEST_LAYER = 2

export type FishingOpenWaterReadFailure =
  | Readonly<{
      _tag: 'FishingOpenWaterReadFailure'
      position: Readonly<{ x: number; y: number; z: number }>
      reason: 'InvalidPosition'
    }>
  | Readonly<{
      _tag: 'FishingOpenWaterReadFailure'
      position: BlockPosition
      reason: 'ChunkNotLoaded' | 'OutOfWorld' | 'MissingBlockReadResult'
    }>

/** Reads every position in one call; the readings follow the order of `positions`. */
type BlockBatchReader<E> = (positions: ReadonlyArray<BlockPosition>) => Effect.Effect<ReadonlyArray<BlockReading>, E>

/**
 * Decides open water from the blocks around the bobber's block cell, after
 * https://minecraft.wiki/w/Fishing#Open_water: in the 5x4x5 region spanning
 * x-2..x+2, z-2..z+2 and y-1..y+2, the layers at y-1 and y must be water and
 * the layers at y+1 and y+2 must be water or air. The kernel stores water as a
 * single block id; source and flowing cells are not distinguished here.
 *
 * Every cell is read before any is judged, so an unreadable cell fails the
 * decision even when another cell would already rule open water out.
 */
export const fishingOpenWaterAt = <E>(
  readBlocks: BlockBatchReader<E>,
  bobber: Readonly<{ x: number; y: number; z: number }>,
): Effect.Effect<boolean, FishingOpenWaterReadFailure | E> =>
  Effect.gen(function* () {
    const origin = { x: Math.floor(bobber.x), y: Math.floor(bobber.y), z: Math.floor(bobber.z) }
    const cells: Array<Readonly<{ layer: number; position: BlockPosition }>> = []
    for (let layer = FISHING_OPEN_WATER_LOWEST_LAYER; layer <= FISHING_OPEN_WATER_HIGHEST_LAYER; layer++) {
      for (let dx = -FISHING_OPEN_WATER_HORIZONTAL_RADIUS; dx <= FISHING_OPEN_WATER_HORIZONTAL_RADIUS; dx++) {
        for (let dz = -FISHING_OPEN_WATER_HORIZONTAL_RADIUS; dz <= FISHING_OPEN_WATER_HORIZONTAL_RADIUS; dz++) {
          const coordinates = { x: origin.x + dx, y: origin.y + layer, z: origin.z + dz }
          const decoded = Schema.decodeUnknownResult(BlockPositionSchema)(coordinates)
          if (Result.isFailure(decoded)) {
            return yield* Effect.fail({
              _tag: 'FishingOpenWaterReadFailure',
              position: coordinates,
              reason: 'InvalidPosition',
            } satisfies FishingOpenWaterReadFailure)
          }
          cells.push({ layer, position: decoded.success })
        }
      }
    }
    const readings = yield* readBlocks(cells.map(({ position }) => position))
    const blocks: Array<Readonly<{ layer: number; block: BlockId }>> = []
    for (const [index, { layer, position }] of cells.entries()) {
      const reading = readings[index]
      if (reading === undefined || reading._tag !== 'Block') {
        return yield* Effect.fail({
          _tag: 'FishingOpenWaterReadFailure',
          position,
          reason: reading === undefined ? 'MissingBlockReadResult' : reading._tag,
        } satisfies FishingOpenWaterReadFailure)
      }
      blocks.push({ layer, block: reading.block })
    }
    return blocks.every(({ layer, block }) =>
      block === WATER_BLOCK_ID || (layer > 0 && block === AIR_BLOCK_ID))
  })
