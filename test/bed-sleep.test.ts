import { describe, expect, it, vi } from '@effect/vitest'
import { Effect } from 'effect'
import { blockPosition } from '@nerima-games/mc-kernel'
import {
  advanceSleep,
  attemptBedSleep,
  enterSleep,
  initialSleepRuntimeState,
  isDangerNearby,
  leaveSleep,
  reconcileSleepers,
  requiredSleeperCount,
  resolveBedSleep,
  sleepRatioFromPercentage,
  validRespawnLocation,
  type BedSleepPlayer,
  type BedSleepTime,
  type SleepLocation,
} from '../src/domain/bed-sleep'

const bedPosition = blockPosition(5, 64, -3)

const makePlayer = (dimension: 'overworld' | 'nether' | 'end'): BedSleepPlayer => ({
  dimension: Effect.succeed(dimension),
})

const makeTime = (timeOfDay: number) => {
  const setTimeOfDay = vi.fn((_fraction: number) => Effect.void)
  const time: BedSleepTime = {
    timeOfDay: Effect.succeed(timeOfDay),
    setTimeOfDay,
  }
  return { setTimeOfDay, time }
}

describe('bed sleep', () => {
  it('accepts night and returns the safe respawn location above the bed', () => {
    expect(resolveBedSleep({
      bedPosition,
      dangerNearby: false,
      dimension: 'overworld',
      timeOfDay: 0,
      weather: 'clear',
    })).toStrictEqual({
      _tag: 'SleepAccepted',
      morningTimeOfDay: 0.25,
      respawnLocation: {
        dimension: 'overworld',
        position: { x: 5, y: 65, z: -3 },
      },
    })
  })

  it('accepts thunder during daytime but rejects ordinary daytime weather', () => {
    const common = {
      bedPosition,
      dangerNearby: false,
      dimension: 'overworld' as const,
      timeOfDay: 0.5,
    }

    expect(resolveBedSleep({ ...common, weather: 'thunder' })._tag).toBe('SleepAccepted')
    expect(resolveBedSleep({ ...common, weather: 'rain' })).toStrictEqual({
      _tag: 'SleepRejected',
      reason: 'not-night-or-thunder',
    })
  })

  it('rejects danger before considering otherwise valid sleep conditions', () => {
    expect(resolveBedSleep({
      bedPosition,
      dangerNearby: true,
      dimension: 'overworld',
      timeOfDay: 0,
      weather: 'thunder',
    })).toStrictEqual({ _tag: 'SleepRejected', reason: 'danger-nearby' })
  })

  it('rejects every non-overworld dimension before any other condition', () => {
    for (const dimension of ['nether', 'end'] as const) {
      expect(resolveBedSleep({
        bedPosition,
        dangerNearby: true,
        dimension,
        timeOfDay: 0,
        weather: 'thunder',
      })).toStrictEqual({ _tag: 'SleepRejected', reason: 'wrong-dimension' })
    }
  })

  it.effect('moves authoritative time to dawn after acceptance', () =>
    Effect.gen(function* () {
      const { setTimeOfDay, time } = makeTime(0.9)
      const decision = yield* attemptBedSleep(makePlayer('overworld'), time, {
        bedPosition,
        dangerNearby: false,
        weather: 'clear',
      })

      expect(decision._tag).toBe('SleepAccepted')
      expect(setTimeOfDay).toHaveBeenCalledExactlyOnceWith(0.25)
    }),
  )

  it.effect('does not change time after rejection', () =>
    Effect.gen(function* () {
      const { setTimeOfDay, time } = makeTime(0.5)
      const decision = yield* attemptBedSleep(makePlayer('overworld'), time, {
        bedPosition,
        dangerNearby: false,
        weather: 'clear',
      })

      expect(decision).toStrictEqual({
        _tag: 'SleepRejected',
        reason: 'not-night-or-thunder',
      })
      expect(setTimeOfDay).not.toHaveBeenCalled()
    }),
  )
})

const location = (playerBedX = 0): SleepLocation => ({
  dimension: 'overworld',
  position: { x: playerBedX, y: 65, z: 0 },
  bedPosition: blockPosition(playerBedX, 64, 0),
})

describe('multiplayer sleep roster', () => {
  it('enterSleep replaces an existing entry for the same player rather than duplicating it', () => {
    const first = enterSleep(initialSleepRuntimeState(), 'alice', location(0))
    const second = enterSleep(first, 'alice', location(5))
    expect(second.sleepers).toHaveLength(1)
    expect(second.sleepers[0]).toStrictEqual({
      playerId: 'alice', location: location(5), elapsedSecs: 0,
    })
  })

  it('leaveSleep removes only the named player', () => {
    const both = enterSleep(enterSleep(initialSleepRuntimeState(), 'alice', location()), 'bob', location())
    const left = leaveSleep(both, 'alice')
    expect(left.sleepers.map((s) => s.playerId)).toStrictEqual(['bob'])
  })

  it('reconcileSleepers drops a disconnected player and a player whose bed is gone', () => {
    const state = enterSleep(enterSleep(initialSleepRuntimeState(), 'alice', location(0)), 'bob', location(5))
    const reconciled = reconcileSleepers(
      state,
      new Set(['alice']),
      (loc) => loc.bedPosition.x === 0,
    )
    // bob fails on BOTH grounds (disconnected AND bed gone) — still removed exactly once.
    expect(reconciled.sleepers.map((s) => s.playerId)).toStrictEqual(['alice'])
  })

  it('requiredSleeperCount rounds up and floors at one player', () => {
    expect(requiredSleeperCount(4, 0.5)).toBe(2)
    expect(requiredSleeperCount(3, 0.5)).toBe(2)
    expect(requiredSleeperCount(0, 1)).toBe(1)
    expect(requiredSleeperCount(10, 0)).toBe(1)
    expect(requiredSleeperCount(10, Number.NaN)).toBe(10)
  })

  it('sleepRatioFromPercentage parses a gamerule string, defaulting to "everyone" when it cannot', () => {
    expect(sleepRatioFromPercentage(null)).toBe(1)
    expect(sleepRatioFromPercentage('')).toBe(1)
    expect(sleepRatioFromPercentage('   ')).toBe(1)
    expect(sleepRatioFromPercentage('not a number')).toBe(1)
    expect(sleepRatioFromPercentage('50')).toBe(0.5)
    // Clamped at both ends.
    expect(sleepRatioFromPercentage('150')).toBe(1)
    expect(sleepRatioFromPercentage('-20')).toBe(0)
  })

  describe('advanceSleep', () => {
    it('skips to morning once enough players are sleeping AND one has waited long enough', () => {
      const state = enterSleep(initialSleepRuntimeState(), 'alice', location())
      const result = advanceSleep(state, 5, 1, 1, 5)
      expect(result.state.sleepers[0]?.elapsedSecs).toBe(5)
      expect(result.skipToMorning).toBe(true)
    })

    it('does not skip when enough players are sleeping but none has waited long enough', () => {
      const state = enterSleep(initialSleepRuntimeState(), 'alice', location())
      const result = advanceSleep(state, 4.999, 1, 1, 5)
      expect(result.skipToMorning).toBe(false)
    })

    it('does not skip when the wait is satisfied but not enough players are sleeping', () => {
      const state = enterSleep(initialSleepRuntimeState(), 'alice', location())
      const result = advanceSleep(state, 10, 4, 1, 5)
      expect(result.skipToMorning).toBe(false)
    })

    it('ages every sleeper by the same delta, additively across frames', () => {
      const state = enterSleep(initialSleepRuntimeState(), 'alice', location())
      const afterOne = advanceSleep(state, 2, 1, 1, 100).state
      const afterTwo = advanceSleep(afterOne, 3, 1, 1, 100).state
      expect(afterTwo.sleepers[0]?.elapsedSecs).toBe(5)
    })
  })

  it('validRespawnLocation keeps a location only while its bed still exists', () => {
    expect(validRespawnLocation(null, () => true)).toBeNull()
    expect(validRespawnLocation(location(), () => false)).toBeNull()
    expect(validRespawnLocation(location(), () => true)).toStrictEqual(location())
  })

  describe('isDangerNearby', () => {
    const dangerBedPosition = { x: 0, y: 64, z: 0 }

    it('is true for a hostile within both the horizontal and vertical radius', () => {
      expect(isDangerNearby(dangerBedPosition, [{ x: 6, y: 66, z: 0 }])).toBe(true)
    })

    it('is true exactly on the horizontal and vertical boundary', () => {
      expect(isDangerNearby(dangerBedPosition, [{ x: 8, y: 69, z: 0 }])).toBe(true)
    })

    it('is false one step beyond the horizontal radius', () => {
      expect(isDangerNearby(dangerBedPosition, [{ x: 8.01, y: 64, z: 0 }])).toBe(false)
    })

    it('is false one step beyond the vertical radius', () => {
      expect(isDangerNearby(dangerBedPosition, [{ x: 0, y: 69.01, z: 0 }])).toBe(false)
    })

    it('is false with no hostiles at all', () => {
      expect(isDangerNearby(dangerBedPosition, [])).toBe(false)
    })

    it('honours custom radii', () => {
      expect(isDangerNearby(dangerBedPosition, [{ x: 3, y: 64, z: 0 }], 2, 2)).toBe(false)
    })
  })
})
