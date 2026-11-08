/**
 * Environmental facts for the undead daylight rule. The caller supplies the
 * simulation clock's daytime result and raw sky light at the mob's head.
 */
import type { SkyLightLevel } from './hostile-spawn.js'

export type UndeadDaylightSenses = Readonly<{
  readonly daytime: boolean
  readonly skyLight: SkyLightLevel
  readonly inWater: boolean
  readonly hasHeadProtection: boolean
}>

/** Java Edition daylight burns zombies and skeletons exposed to full skylight, except when protected by water or head armor. */
export const burnsInDaylight = ({
  daytime,
  skyLight,
  inWater,
  hasHeadProtection,
}: UndeadDaylightSenses): boolean =>
  daytime &&
  Number.isInteger(skyLight) &&
  skyLight === 15 &&
  !inWater &&
  !hasHeadProtection
