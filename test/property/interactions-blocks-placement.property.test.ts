import { describe, it } from '@effect/vitest'
import { Option } from 'effect'
import * as FastCheck from 'fast-check'
import { blockIdOf, type BlockId } from '@nerima-games/mc-kernel'
import type { BlockReading } from '@nerima-games/mc-worldgen'
import { hasRequiredSugarCaneAdjacentWater } from '../../src/domain/interactions/place-sugar-cane-water'
import { SAND, WATER } from '../support/chunk-store-double'

const SUGAR_CANE = Option.getOrThrow(blockIdOf('sugar_cane'))

const asBlock = (block: BlockId): BlockReading => ({ _tag: 'Block', block })

describe('block placement properties', () => {
  it('allows sugar cane beside water or above another cane (fast-check)', () => {
    // This catches an omitted horizontal neighbor or a stacked cane incorrectly requiring fresh water.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.boolean(),
        FastCheck.array(FastCheck.boolean(), { minLength: 4, maxLength: 4 }),
        (stacked, waterSides) => {
          const support = asBlock(stacked ? SUGAR_CANE : SAND)
          const expectedAllowed = stacked || waterSides.some(Boolean)
          const readings = waterSides.map((isWater) => asBlock(isWater ? WATER : SAND))
          const reversedReadings = [...readings].reverse()

          const actual = hasRequiredSugarCaneAdjacentWater(support, readings)
          const reversedActual = hasRequiredSugarCaneAdjacentWater(support, reversedReadings)

          return actual === expectedAllowed && reversedActual === expectedAllowed
        },
      ),
    )
  })
})
