import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Result } from 'effect'
import { durability, equipmentItem, itemStack } from '@nerima-games/mc-sim'
import {
  advanceFishing,
  castFishing,
  reelFishing,
  type FishingEnvironment,
  type FishingRolls,
} from '../../src/domain/interactions/fishing'

const rod = (current: number) =>
  Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('fishing_rod', 1)),
    Result.getOrThrow(durability(current, 64)),
  ))

const rolls = (wait: number): FishingRolls => ({ wait, category: 0.2, item: 0.5 })

const environment = (hasSkyAccess: boolean, isRaining: boolean): FishingEnvironment => ({
  hasWater: true,
  hasSkyAccess,
  isRaining,
  isOpenWater: true,
})

describe('fishing properties', () => {
  it('rain shortens wait only when the cast has sky access', () => {
    // Fails if weather changes wait under a roof or leaves an exposed rainy cast unchanged.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: 0, max: 1, noNaN: true }),
        FastCheck.boolean(),
        (waitRoll, hasSkyAccess) => {
          const dry = castFishing(rod(64), environment(hasSkyAccess, false), rolls(waitRoll))
          const rainy = castFishing(rod(64), environment(hasSkyAccess, true), rolls(waitRoll))
          if (dry._tag !== 'Cast' || rainy._tag !== 'Cast') return false

          return rainy.session.waitSecs >= 4 &&
            rainy.session.waitSecs <= 30 &&
            (hasSkyAccess
              ? rainy.session.waitSecs < dry.session.waitSecs
              : rainy.session.waitSecs === dry.session.waitSecs)
        },
      ),
    )
  })

  it('reeling wears the rod once in waiting, bite, and escaped phases', () => {
    // Fails if any reel outcome skips wear or decrements durability more than once.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 64 }),
        FastCheck.integer({ min: 0, max: 40 }),
        (currentDurability, elapsedSecs) => {
          const cast = castFishing(rod(currentDurability), environment(true, false), rolls(0.5))
          if (cast._tag !== 'Cast') return false

          const advanced = advanceFishing(cast.session, elapsedSecs, { hasWater: true })
          if (advanced._tag === 'Cancelled' || advanced._tag === 'InvalidDuration') return false
          const reeled = reelFishing(advanced.session)
          if (reeled._tag === 'InvalidLoot') return false

          return currentDurability === 1
            ? reeled.rod === null
            : reeled.rod?.durability.current === currentDurability - 1
        },
      ),
    )
  })
})
