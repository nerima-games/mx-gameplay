import { describe, expect, it } from '@effect/vitest'
import {
  applyWeatherState,
  isWeather,
  isWeatherState,
  type WeatherState,
} from '../domain/weather'

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
    const current: WeatherState = { weather: 'clear', remainingSecs: 20 }
    const hostState = { weather: 'rain' as const, remainingSecs: 600 }

    const applied = applyWeatherState(current, hostState)
    hostState.remainingSecs = 1

    expect(applied).toStrictEqual({ weather: 'rain', remainingSecs: 600 })
    expect(applied).not.toBe(hostState)
  })

  it('keeps the current state when the host value is invalid', () => {
    const current: WeatherState = { weather: 'thunder', remainingSecs: 180 }

    expect(applyWeatherState(current, { weather: 'clear', remainingSecs: 0 })).toBe(current)
    expect(applyWeatherState(current, { weather: 'snow', remainingSecs: 100 })).toBe(current)
  })
})
