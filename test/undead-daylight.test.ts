import { describe, expect, it } from 'vitest'
import { SkyLightLevel } from '../src/domain/mob/hostile-spawn'
import { burnsInDaylight, type UndeadDaylightSenses } from '../src/domain/mob/undead-daylight'

// Vanilla oracle: Java Edition 26.3 sunlight requires internal sky light >= 12 and sky light 15.
// https://minecraft.wiki/w/Sun#Sunlight

const exposed = (overrides: Partial<UndeadDaylightSenses> = {}): UndeadDaylightSenses => ({
  daytime: true,
  skyLight: SkyLightLevel(15),
  inWater: false,
  hasHeadProtection: false,
  ...overrides,
})

describe('undead daylight burning', () => {
  it('burns an exposed undead mob in daytime with full skylight', () => {
    expect(burnsInDaylight(exposed())).toBe(true)
    expect(burnsInDaylight(exposed({ skyLight: SkyLightLevel(14) }))).toBe(false)
    expect(burnsInDaylight(exposed({ skyLight: SkyLightLevel(12) }))).toBe(false)
  })

  it('does not burn at night or when shade reduces skylight to 11 or less', () => {
    expect(burnsInDaylight(exposed({ daytime: false }))).toBe(false)
    expect(burnsInDaylight(exposed({ skyLight: SkyLightLevel(11) }))).toBe(false)
    expect(burnsInDaylight(exposed({ skyLight: SkyLightLevel(0) }))).toBe(false)
  })

  it('does not burn an undead mob protected by water or head armor', () => {
    expect(burnsInDaylight(exposed({ inWater: true }))).toBe(false)
    expect(burnsInDaylight(exposed({ hasHeadProtection: true }))).toBe(false)
  })

  it('fails closed for invalid skylight readings', () => {
    expect(burnsInDaylight(exposed({ skyLight: SkyLightLevel(Number.NaN) }))).toBe(false)
    expect(burnsInDaylight(exposed({ skyLight: SkyLightLevel(-1) }))).toBe(false)
    expect(burnsInDaylight(exposed({ skyLight: SkyLightLevel(16) }))).toBe(false)
    expect(burnsInDaylight(exposed({ skyLight: SkyLightLevel(12.5) }))).toBe(false)
  })
})
