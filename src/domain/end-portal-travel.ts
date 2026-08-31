import {
  type Dimension,
  END_PORTAL_BLOCK,
  endArrivalDescriptor,
} from '@nerima-games/mc-worldgen'
import { blockPosition as kernelBlockPosition } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import type { BlockPosition } from '@nerima-games/mc-kernel'
import type { PlayerServiceApi } from '@nerima-games/mc-sim'

/** Deterministic End arrival origin until worldgen supplies a world spawn. */
export const END_ARRIVAL_ORIGIN: ReturnType<typeof kernelBlockPosition> = kernelBlockPosition(0, 60, 0)

/** Deterministic return position until mc-sim exposes the Overworld spawn. */
export const OVERWORLD_RETURN_POSITION: BlockPosition = kernelBlockPosition(0, 64, 0)

export type EndPortalTravelEvent = {
  readonly sourceDimension: Dimension
  readonly sourcePosition: BlockPosition
  readonly toDimension: Dimension
  readonly destination: BlockPosition
  readonly arrival: ReturnType<typeof endArrivalDescriptor> | undefined
}

export const isEndPortalBlock = (block: number): boolean => block === END_PORTAL_BLOCK.PORTAL

/** Move the player and leave destination-world construction to mc-worldgen. */
export const applyEndPortalTravel = (
  player: PlayerServiceApi,
  sourcePosition: BlockPosition,
): Effect.Effect<EndPortalTravelEvent> =>
  Effect.gen(function* () {
    const sourceDimension = yield* player.dimension
    if (sourceDimension === 'overworld') {
      const arrival = endArrivalDescriptor(END_ARRIVAL_ORIGIN)
      yield* player.moveTo(arrival.spawn)
      yield* player.setDimension('end')
      return {
        arrival,
        destination: arrival.spawn,
        sourceDimension,
        sourcePosition,
        toDimension: 'end',
      }
    }

    yield* player.moveTo(OVERWORLD_RETURN_POSITION)
    yield* player.setDimension('overworld')
    return {
      arrival: undefined,
      destination: OVERWORLD_RETURN_POSITION,
      sourceDimension,
      sourcePosition,
      toDimension: 'overworld',
    }
  })
