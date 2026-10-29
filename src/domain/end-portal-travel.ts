import {
  type Dimension,
  END_PORTAL_BLOCK,
  endArrivalDescriptor,
} from '@nerima-games/mc-worldgen'
import {
  BlockAxis,
  PositionAxis,
  blockPosition as kernelBlockPosition,
  position,
  type BlockPosition,
  type Position,
} from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import type { PlayerServiceApi, PlayerServiceInputError } from '@nerima-games/mc-sim'

/** Deterministic End arrival origin until worldgen supplies a world spawn. */
export const END_ARRIVAL_ORIGIN: ReturnType<typeof kernelBlockPosition> =
  kernelBlockPosition(BlockAxis(0), BlockAxis(60), BlockAxis(0))

/** Deterministic return position until mc-sim exposes the Overworld spawn. */
export const OVERWORLD_RETURN_POSITION: BlockPosition =
  kernelBlockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))

const asPlayerPosition = (positionValue: BlockPosition): Position => position(
  PositionAxis(positionValue.x),
  PositionAxis(positionValue.y),
  PositionAxis(positionValue.z),
)

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
): Effect.Effect<EndPortalTravelEvent, PlayerServiceInputError> =>
  Effect.gen(function* () {
    const sourceDimension = yield* player.dimension
    if (sourceDimension === 'overworld') {
      const arrival = endArrivalDescriptor(END_ARRIVAL_ORIGIN)
      yield* player.moveTo(asPlayerPosition(arrival.spawn))
      yield* player.setDimension('end')
      return {
        arrival,
        destination: arrival.spawn,
        sourceDimension,
        sourcePosition,
        toDimension: 'end',
      }
    }

    yield* player.moveTo(asPlayerPosition(OVERWORLD_RETURN_POSITION))
    yield* player.setDimension('overworld')
    return {
      arrival: undefined,
      destination: OVERWORLD_RETURN_POSITION,
      sourceDimension,
      sourcePosition,
      toDimension: 'overworld',
    }
  })
