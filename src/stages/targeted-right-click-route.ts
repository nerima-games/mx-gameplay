import { targetBlockFromPlayerPose } from '@nerima-games/mc-sim'
import { Effect, Option } from 'effect'

import { blockTypeOfId } from '../domain/block-vocabulary'
import type {
  BlockPosition,
  BlockReading,
  ChunkStoreApi,
} from '../domain/chunk-store-port'
import {
  rightClickRoute,
  type RightClickRoute,
} from '../domain/interactions/right-click-target'
import type { PlayerServiceApi } from '@nerima-games/mc-sim'
import { DEFAULT_BLOCK_REACH } from './registration'

const coordinateKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

/** Resolve the right-click route for the block currently targeted by the player. */
export const targetedRightClickRoute = (
  store: ChunkStoreApi,
  player: PlayerServiceApi,
  maxDistance: number = DEFAULT_BLOCK_REACH,
): Effect.Effect<RightClickRoute | undefined> =>
  Effect.gen(function* () {
    const pose = yield* player.pose
    const candidates: Array<BlockPosition> = []
    const visited = new Set<string>()
    targetBlockFromPlayerPose(pose, maxDistance, (x, y, z) => {
      const key = coordinateKey(x, y, z)
      if (!visited.has(key)) {
        visited.add(key)
        candidates.push({ x, y, z })
      }
      return false
    })

    const readings = new Map<string, BlockReading>()
    for (const position of candidates) {
      const reading = yield* store.getBlock(position)
      readings.set(
        coordinateKey(position.x, position.y, position.z),
        reading,
      )
      if (reading._tag === 'Block' && reading.block !== 0) break
    }
    const target = targetBlockFromPlayerPose(
      pose,
      maxDistance,
      (x, y, z) => {
        const reading = readings.get(coordinateKey(x, y, z))
        return reading?._tag === 'Block' && reading.block !== 0
      },
    )
    if (Option.isNone(target)) return undefined

    const reading = readings.get(
      coordinateKey(
        target.value.position.x,
        target.value.position.y,
        target.value.position.z,
      ),
    )
    if (reading?._tag !== 'Block') return undefined

    return rightClickRoute(
      target.value.position,
      blockTypeOfId(reading.block),
    )
  })
