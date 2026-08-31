import type { TimeServiceApi } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import type { BlockPosition } from '@nerima-games/mc-kernel'
import { DAWN_FRACTION, isNight } from './day-night.js'
import type { Position } from '@nerima-games/mc-kernel'
import type { Dimension } from '@nerima-games/mc-worldgen'
import type { PlayerServiceApi } from '@nerima-games/mc-sim'
import type { Weather } from './weather.js'

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

/**
 * The multiplayer half of sleeping: `resolveBedSleep` gates one player's OWN
 * attempt, and everything below tracks the ROSTER of players currently in bed
 * to decide when the night is skipped for everyone — Java Edition requires a
 * ratio of the server's players to be sleeping, not merely one, and gives
 * latecomers a short grace period before the skip actually happens. Multiple
 * `enterSleep` calls for the same player replace rather than duplicate the
 * entry, so a host driving this from repeated per-frame input never grows an
 * unbounded roster.
 */
export type SleepLocation = {
  readonly dimension: 'overworld'
  readonly position: Position
  readonly bedPosition: BlockPosition
}

export type SleepingPlayer = {
  readonly playerId: string
  readonly location: SleepLocation
  readonly elapsedSecs: number
}

export type SleepRuntimeState = {
  readonly sleepers: ReadonlyArray<SleepingPlayer>
}

export type SleepAdvance = {
  readonly state: SleepRuntimeState
  readonly skipToMorning: boolean
}

export const initialSleepRuntimeState = (): SleepRuntimeState => ({ sleepers: [] })

export const enterSleep = (
  state: SleepRuntimeState,
  playerId: string,
  location: SleepLocation,
): SleepRuntimeState => ({
  sleepers: [
    ...state.sleepers.filter((sleeper) => sleeper.playerId !== playerId),
    { playerId, location, elapsedSecs: 0 },
  ],
})

export const leaveSleep = (state: SleepRuntimeState, playerId: string): SleepRuntimeState => ({
  sleepers: state.sleepers.filter((sleeper) => sleeper.playerId !== playerId),
})

/**
 * Drops any sleeper who disconnected or whose bed is gone — the two ways a
 * roster entry can go stale between frames without an explicit `leaveSleep`.
 */
export const reconcileSleepers = (
  state: SleepRuntimeState,
  connectedSurvivalPlayerIds: ReadonlySet<string>,
  bedExists: (location: SleepLocation) => boolean,
): SleepRuntimeState => ({
  sleepers: state.sleepers.filter(
    (sleeper) => connectedSurvivalPlayerIds.has(sleeper.playerId) && bedExists(sleeper.location),
  ),
})

/** How many of `connectedPlayers` must be sleeping, `ratio` rounded up and floored at one. */
export const requiredSleeperCount = (connectedPlayers: number, ratio: number): number => {
  const normalizedRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1
  return Math.max(1, Math.ceil(connectedPlayers * normalizedRatio))
}

/** Parses a `playersSleepingPercentage`-shaped game rule string; any unparsable value means "all of them." */
export const sleepRatioFromPercentage = (value: string | null): number => {
  if (value === null || value.trim() === '') return 1
  const percentage = Number(value)
  return Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) / 100 : 1
}

/**
 * Ages every sleeper by `deltaSecs` and decides whether the night skips this
 * frame: enough of the connected players must be in bed AND at least one of
 * them must have waited out `delaySecs`, so a lone early sleeper cannot skip
 * the night alone and a ratio met for a single instant does not skip it
 * before anyone has actually waited.
 */
export const advanceSleep = (
  state: SleepRuntimeState,
  deltaSecs: number,
  connectedSurvivalPlayers: number,
  requiredRatio: number,
  delaySecs: number,
): SleepAdvance => {
  const sleepers = state.sleepers.map((sleeper) => ({
    ...sleeper,
    elapsedSecs: sleeper.elapsedSecs + Math.max(0, deltaSecs),
  }))
  const enoughPlayers = sleepers.length >= requiredSleeperCount(connectedSurvivalPlayers, requiredRatio)
  const waitedLongEnough = sleepers.some((sleeper) => sleeper.elapsedSecs >= delaySecs)
  return {
    state: { sleepers },
    skipToMorning: enoughPlayers && waitedLongEnough,
  }
}

/** A respawn point is only valid while its bed still exists. */
export const validRespawnLocation = (
  location: SleepLocation | null,
  bedExists: (location: SleepLocation) => boolean,
): SleepLocation | null => location !== null && bedExists(location) ? location : null

/** Vanilla refuses to let a player sleep with a hostile mob standing near the bed. */
export const isDangerNearby = (
  bedPosition: Position,
  hostiles: ReadonlyArray<Position>,
  horizontalRadius = 8,
  verticalRadius = 5,
): boolean => hostiles.some((hostile) =>
  Math.abs(hostile.y - bedPosition.y) <= verticalRadius
  && Math.hypot(hostile.x - bedPosition.x, hostile.z - bedPosition.z) <= horizontalRadius,
)
