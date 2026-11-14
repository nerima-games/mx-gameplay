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
import type { GameplayStageBlockTypeDecodeFailure } from './gameplay-stage-faults.js'

const blockPositionAt = (x: number, y: number, z: number): BlockPosition =>
  blockPosition(BlockAxis(x + 0), BlockAxis(y + 0), BlockAxis(z + 0))

type TargetBlockFailure = Extract<ReturnType<typeof targetBlockFromPlayerPose>, { readonly _tag: 'Failure' }>['failure']
  | GameplayStageBlockTypeDecodeFailure

/** Resolve the route from a pose read from the authoritative gameplay player owner. */
export const targetedRightClickRoute = (
  store: ChunkStoreApi,
  pose: PlayerPose,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<RightClickRoute | undefined, TargetBlockFailure> =>
  Effect.gen(function* () {
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

      const decoded = blockTypeOfId(reading.block)
      if (decoded._tag === 'Failure') {
        const reason: GameplayStageBlockTypeDecodeFailure = {
          _tag: 'BlockTypeDecodeFailed',
          position,
          block: reading.block,
          failure: decoded.failure,
        }
        return yield* Effect.fail(reason)
      }
      if (decoded.success === undefined) {
        const reason: GameplayStageBlockTypeDecodeFailure = {
          _tag: 'BlockTypeDecodeFailed',
          position,
          block: reading.block,
          failure: { _tag: 'UnregisteredBlockId' },
        }
        return yield* Effect.fail(reason)
      }

      return rightClickRoute(position, decoded.success)
    }

    return undefined
  })
