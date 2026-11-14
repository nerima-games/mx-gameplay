import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import {
  applyWeatherState,
  isWeather,
  isWeatherState,
} from '../src/domain/weather'

describe('weather host boundary', () => {
  it('accepts exactly the Minecraft weather vocabulary', () => {
    expect(['clear', 'rain', 'thunder'].every(isWeather)).toBe(true)

    for (const value of ['snow', '', null, undefined, 1, {}]) {
      expect(isWeather(value)).toBe(false)
    }
  })

  it('accepts usable persisted states', () => {
    expect(isWeatherState({ weather: 'clear', remainingSecs: 0.001 })).toBe(true)
    expect(isWeatherState({ weather: 'rain', remainingSecs: 600 })).toBe(true)
    expect(isWeatherState({ weather: 'thunder', remainingSecs: 780 })).toBe(true)
  })

  it.each([
    null,
    undefined,
    'rain',
    {},
    { weather: 'snow', remainingSecs: 10 },
    { weather: 'clear' },
    { weather: 'clear', remainingSecs: '10' },
    { weather: 'clear', remainingSecs: 0 },
    { weather: 'clear', remainingSecs: -1 },
    { weather: 'clear', remainingSecs: Number.NaN },
    { weather: 'clear', remainingSecs: Number.POSITIVE_INFINITY },
  ])('rejects an unusable persisted state: %j', (value) => {
    expect(isWeatherState(value)).toBe(false)
  })

  it('applies a valid host state as an isolated value', () => {
    const hostState = { weather: 'rain' as const, remainingSecs: 600 }

    const applied = applyWeatherState(hostState)
    hostState.remainingSecs = 1

    expect(applied).toStrictEqual(Result.succeed({ weather: 'rain', remainingSecs: 600 }))
    if (Result.isFailure(applied)) return
    expect(applied.success).not.toBe(hostState)
  })

  it('returns a typed failure for an invalid host value', () => {
    expect(applyWeatherState({ weather: 'clear', remainingSecs: 0 })).toEqual(Result.fail('invalid-weather-state'))
    expect(applyWeatherState({ weather: 'snow', remainingSecs: 100 })).toEqual(Result.fail('invalid-weather-state'))
  })
})
