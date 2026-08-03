import { describe, expect, it, vi } from '@effect/vitest'
import { Effect } from 'effect'
import {
  attemptBedSleep,
  resolveBedSleep,
  type BedSleepPlayer,
  type BedSleepTime,
} from '../src/domain/bed-sleep'

const bedPosition = { x: 5, y: 64, z: -3 }

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
