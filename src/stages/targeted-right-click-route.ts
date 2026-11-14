import { targetBlockFromPlayerPose } from '@nerima-games/mc-sim'
import { Effect } from 'effect'

import {
  BlockAxis,
  blockPosition,
  blockTypeOfId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import {
  rightClickRoute,
  type RightClickRoute,
} from '../domain/interactions/right-click-target.js'
import type { PlayerPose } from '@nerima-games/mc-sim'
import { DEFAULT_BLOCK_REACH } from './registration.js'

const blockPositionAt = (x: number, y: number, z: number): BlockPosition =>
  blockPosition(BlockAxis(x + 0), BlockAxis(y + 0), BlockAxis(z + 0))

export type TargetedRightClickRouteInputFailure = Readonly<{
  readonly _tag: 'TargetedRightClickRouteInputFailure'
  readonly field: 'maxDistance'
  readonly reason: 'undefined'
}>

/** Resolve the route from a pose read from the authoritative gameplay player owner. */
export const targetedRightClickRoute = (
  store: ChunkStoreApi,
  pose: PlayerPose,
  ...maxDistanceArgument: [] | [maxDistance: number]
) =>
  Effect.gen(function* () {
    const maxDistance = maxDistanceArgument.length === 0
      ? DEFAULT_BLOCK_REACH
      : maxDistanceArgument[0]
    if (maxDistance === undefined) {
      return yield* Effect.fail({
        _tag: 'TargetedRightClickRouteInputFailure',
        field: 'maxDistance',
        reason: 'undefined',
      } satisfies TargetedRightClickRouteInputFailure)
    }

    const candidates: Array<BlockPosition> = []
    // No dedup Set: `@nerima-games/mc-physics`'s `voxelRaycast` DDA walk
    // (`domain/dda.js`) advances exactly one axis by exactly one cell per
    // step, so no two steps of one walk ever produce the same `(x, y, z)` —
    // there is no candidate here to deduplicate.
    yield* Effect.fromResult(
      targetBlockFromPlayerPose(pose, maxDistance, (x, y, z) => {
        candidates.push(blockPositionAt(x, y, z))
        return false
      }),
    )

    for (const position of candidates) {
      const reading = yield* store.getBlock(position)
      if (reading._tag !== 'Block' || reading.block === 0) continue

      const blockType = yield* Effect.fromResult(blockTypeOfId(reading.block))
      if (blockType === undefined) return undefined

      return rightClickRoute(position, blockType)
    }

    return undefined
  })
