import type { TimeServiceApi } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import type { BlockPosition } from './chunk-store-port'
import { DAWN_FRACTION, isNight } from './day-night'
import type { Position } from './entity-manager-port'
import type { Dimension } from './nether-travel-port'
import type { PlayerServiceApi } from './player-port'
import type { Weather } from './weather'

export type SleepRejectionReason =
  | 'wrong-dimension'
  | 'danger-nearby'
  | 'not-night-or-thunder'

export type RespawnLocation = {
  readonly dimension: 'overworld'
  readonly position: Position
}

export type BedSleepInput = {
  readonly bedPosition: BlockPosition
  readonly dangerNearby: boolean
  readonly dimension: Dimension
  readonly timeOfDay: number
  readonly weather: Weather
}

export type BedSleepRequest = Omit<BedSleepInput, 'dimension' | 'timeOfDay'>

export type BedSleepDecision =
  | {
      readonly _tag: 'SleepAccepted'
      readonly morningTimeOfDay: typeof DAWN_FRACTION
      readonly respawnLocation: RespawnLocation
    }
  | {
      readonly _tag: 'SleepRejected'
      readonly reason: SleepRejectionReason
    }

export type BedSleepPlayer = Pick<PlayerServiceApi, 'dimension'>
export type BedSleepTime = Pick<TimeServiceApi, 'timeOfDay' | 'setTimeOfDay'>

/** Decide whether a bed may be used without mutating player or world state. */
export const resolveBedSleep = (input: BedSleepInput): BedSleepDecision => {
  if (input.dimension !== 'overworld') {
    return { _tag: 'SleepRejected', reason: 'wrong-dimension' }
  }
  if (input.dangerNearby) {
    return { _tag: 'SleepRejected', reason: 'danger-nearby' }
  }
  if (!isNight(input.timeOfDay) && input.weather !== 'thunder') {
    return { _tag: 'SleepRejected', reason: 'not-night-or-thunder' }
  }

  return {
    _tag: 'SleepAccepted',
    morningTimeOfDay: DAWN_FRACTION,
    respawnLocation: {
      dimension: 'overworld',
      position: {
        x: input.bedPosition.x,
        y: input.bedPosition.y + 1,
        z: input.bedPosition.z,
      },
    },
  }
}

/** Read authoritative state and advance the clock only after sleep is accepted. */
export const attemptBedSleep = (
  player: BedSleepPlayer,
  time: BedSleepTime,
  request: BedSleepRequest,
): Effect.Effect<BedSleepDecision> =>
  Effect.gen(function* () {
    const [dimension, timeOfDay] = yield* Effect.all([player.dimension, time.timeOfDay])
    const decision = resolveBedSleep({ ...request, dimension, timeOfDay })

    if (decision._tag === 'SleepAccepted') {
      yield* time.setTimeOfDay(decision.morningTimeOfDay)
    }

    return decision
  })
