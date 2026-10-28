import { targetBlockFromPlayerPose } from '@nerima-games/mc-sim'
import { Effect, Option } from 'effect'

import {
  BlockAxis,
  blockPosition,
  blockTypeOfId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import type { BlockReading, ChunkStoreApi } from '@nerima-games/mc-worldgen'
import {
  rightClickRoute,
  type RightClickRoute,
} from '../domain/interactions/right-click-target.js'
import type { PlayerPose } from '@nerima-games/mc-sim'
import { DEFAULT_BLOCK_REACH } from './registration.js'

const coordinateKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

const blockPositionAt = (x: number, y: number, z: number): BlockPosition =>
  blockPosition(BlockAxis(x + 0), BlockAxis(y + 0), BlockAxis(z + 0))

/** Resolve the route from a pose read from the authoritative gameplay player owner. */
export const targetedRightClickRoute = (
  store: ChunkStoreApi,
  pose: PlayerPose,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<RightClickRoute | undefined> =>
  Effect.gen(function* () {
    const candidates: Array<BlockPosition> = []
    // No dedup Set: `@nerima-games/mc-physics`'s `voxelRaycast` DDA walk
    // (`domain/dda.js`) advances exactly one axis by exactly one cell per
    // step, so no two steps of one walk ever produce the same `(x, y, z)` —
    // there is no candidate here to deduplicate.
    yield* Effect.orDie(
      Effect.fromResult(
        targetBlockFromPlayerPose(pose, maxDistance, (x, y, z) => {
          candidates.push(blockPositionAt(x, y, z))
          return false
        }),
      ),
    )

    const readings = new Map<string, BlockReading>()
    for (const position of candidates) {
      const reading = yield* store.getBlock(position)
      readings.set(
        coordinateKey(position.x, position.y, position.z),
        reading,
      )
      if (reading._tag === 'Block' && reading.block !== 0) break
    }
    const target = yield* Effect.orDie(
      Effect.fromResult(
        targetBlockFromPlayerPose(
          pose,
          maxDistance,
          (x, y, z) => {
            const reading = readings.get(coordinateKey(x, y, z))
            return reading?._tag === 'Block' && reading.block !== 0
          },
        ),
      ),
    )
    if (Option.isNone(target)) return undefined

    const reading = readings.get(
      coordinateKey(
        target.value.position.x,
        target.value.position.y,
        target.value.position.z,
      ),
    )
    /* v8 ignore start -- unreachable while `targetBlockFromPlayerPose` is
     * deterministic in (pose, maxDistance): the second call above stops
     * exactly at the first position whose callback test — `readings.get(key)
     * ?._tag === 'Block' && block !== 0` — returns true, so `target.value
     * .position`'s key is, by construction, a `readings` entry that already
     * satisfies this same test. Narrowed rather than asserted, for
     * `./unequip-armor.ts`'s reason: a non-null assertion here would be the one
     * place a future change to either walk could make lie. */
    if (reading?._tag !== 'Block') return undefined
    /* v8 ignore stop */

    const blockType = yield* Effect.orDie(
      Effect.fromResult(blockTypeOfId(reading.block)),
    )
    if (blockType === undefined) return undefined

    return rightClickRoute(
      blockPositionAt(
        target.value.position.x,
        target.value.position.y,
        target.value.position.z,
      ),
      blockType,
    )
  })
