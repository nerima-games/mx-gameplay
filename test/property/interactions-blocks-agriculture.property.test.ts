import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import {
  CROP_TYPES,
  advanceCrop,
  maturitySecsFor,
  type CropState,
} from '@nerima-games/mc-sim'
import { blockPosition } from '../support/coordinate-fixtures'

const cropPosition = blockPosition(3, 64, 5)

const cropGrowthCase = FastCheck.constantFrom(...CROP_TYPES).chain((crop) => {
  const maturitySecs = maturitySecsFor(crop)
  return FastCheck.record({
    crop: FastCheck.constant(crop),
    growthSecs: FastCheck.double({ min: 0, max: maturitySecs, noNaN: true }),
    frameDeltas: FastCheck.array(
      FastCheck.double({ min: 0, max: maturitySecs * 2, noNaN: true }),
      { maxLength: 8 },
    ),
    afterMaturityDelta: FastCheck.double({ min: 0, max: maturitySecs * 2, noNaN: true }),
  })
})

describe('crop growth properties', () => {
  it('keeps growth monotonic and capped at maturity across frame deltas', () => {
    // Catches accelerated growth or overshoot that makes crops mature too early or exceed their cap.
    FastCheck.assert(
      FastCheck.property(cropGrowthCase, ({ crop, growthSecs, frameDeltas, afterMaturityDelta }) => {
        const maturitySecs = maturitySecsFor(crop)
        let current: CropState = {
          dimension: 'overworld',
          position: cropPosition,
          crop,
          growthSecs,
        }

        for (const deltaSecs of frameDeltas) {
          const next = advanceCrop(current, deltaSecs)
          if (next.growthSecs !== Math.min(maturitySecs, current.growthSecs + deltaSecs)) return false
          current = next
        }

        const mature = advanceCrop(current, maturitySecs)
        const afterMaturity = advanceCrop(mature, afterMaturityDelta)
        return mature.growthSecs === maturitySecs && afterMaturity.growthSecs === maturitySecs
      }),
    )
  })
})
