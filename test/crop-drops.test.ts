/**
 * `domain/interactions/crop-drops.ts` — the other end of `./plant-crop`.
 *
 * Ported from `interaction-break-handler.crop-drops.config.ts`. The reference
 * expresses each rule as a closure over `Math.random`-shaped input, so its own
 * tests can only SAMPLE them. Here the two numbers are data, so the RANGE is
 * checkable — and the reference's prose comment 「Vanilla mature nether wart:
 * 2-4 warts」 becomes arithmetic instead of a claim.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  MISSING_RIPE_PRODUCE,
  RIPE_CROP_YIELD,
  UNRIPE_CROP_DROP,
  cropDrops,
  ripeYieldRange,
} from '../src/domain/interactions/crop-drops'
import { CROP_OF_SEED } from '../src/domain/interactions/plant-crop'
import { ITEM_TYPES } from '../src/domain/item-vocabulary'
import type { BlockType } from '../src/domain/block-vocabulary'

const CROPS = Object.keys(UNRIPE_CROP_DROP) as ReadonlyArray<BlockType>

describe('the table lines up with what can be planted', () => {
  it.effect('every crop that can be planted can also be broken', () =>
    Effect.sync(() => {
      // The two files are the two ends of one lifecycle. A crop that could be
      // planted and not broken would be a block the player can create and never
      // remove — and neither file alone can see that.
      for (const crop of Object.values(CROP_OF_SEED)) {
        expect(UNRIPE_CROP_DROP[crop as BlockType]).toBeDefined()
      }
    }),
  )

  it.effect('an unripe crop returns what was planted', () =>
    Effect.sync(() => {
      // Vanilla returns the seed rather than punishing a mistimed break. This
      // is derived from `plant-crop`'s table so the two cannot disagree.
      for (const [seed, crop] of Object.entries(CROP_OF_SEED)) {
        const outcome = cropDrops(crop as BlockType, false, 0)
        expect(outcome).toStrictEqual({ _tag: 'drops', drops: [{ item: seed, count: 1 }] })
      }
    }),
  )
})

describe('ripe yields', () => {
  it.effect('nether wart yields 2-4, which the reference states in prose', () =>
    Effect.sync(() => {
      expect(ripeYieldRange('nether_wart_crop')).toStrictEqual({ min: 2, max: 4 })
    }),
  )

  it.effect('wheat seeds yield 1-4', () =>
    Effect.sync(() => {
      expect(ripeYieldRange('wheat_crop')).toStrictEqual({ min: 1, max: 4 })
    }),
  )

  it.effect('potato yields 2-5', () =>
    Effect.sync(() => {
      expect(ripeYieldRange('potato_crop')).toStrictEqual({ min: 2, max: 5 })
    }),
  )

  it.effect('no roll can land outside the stated range', () =>
    Effect.sync(() => {
      // The property the range exists for, over the whole domain including the
      // values that break the reference's expression: a roll of exactly 1 gives
      // `floor(1*4)+2 = 6` there, one past the top of a 2-5 range.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -2, max: 2, noNaN: false }),
          FastCheck.constantFrom(...(Object.keys(RIPE_CROP_YIELD) as ReadonlyArray<BlockType>)),
          (roll, crop) => {
            const range = ripeYieldRange(crop)
            const outcome = cropDrops(crop, true, roll)
            if (range === undefined || outcome._tag !== 'drops') {
              return false
            }
            const count = outcome.drops.at(-1)?.count ?? 0
            return count >= range.min && count <= range.max
          },
        ),
        { numRuns: 500 },
      )
    }),
  )

  it.effect('REGRESSION: a roll of exactly 1 does not exceed the range', () =>
    Effect.sync(() => {
      // Stated as its own case because it is the one the reference gets wrong,
      // and a property test that happened not to draw 1.0 would miss it.
      const outcome = cropDrops('potato_crop', true, 1)
      expect(outcome._tag).toBe('drops')
      expect(outcome._tag === 'drops' && outcome.drops[0]?.count).toBe(5)
    }),
  )

  it.effect('a non-finite roll yields the floor rather than NaN', () =>
    Effect.sync(() => {
      // NaN in a drop count propagates into an inventory add, where it is a
      // stack of NaN items — the same class of defect the residual-work notes
      // record for NaN damage producing immortality.
      const outcome = cropDrops('potato_crop', true, Number.NaN)
      expect(outcome._tag === 'drops' && outcome.drops[0]?.count).toBe(2)
    }),
  )

  it.effect('the low roll is the floor and the high roll is the max', () =>
    Effect.sync(() => {
      for (const crop of Object.keys(RIPE_CROP_YIELD) as ReadonlyArray<BlockType>) {
        const range = ripeYieldRange(crop)
        const low = cropDrops(crop, true, 0)
        const high = cropDrops(crop, true, 0.999)
        expect(low._tag === 'drops' && low.drops.at(-1)?.count).toBe(range?.min)
        expect(high._tag === 'drops' && high.drops.at(-1)?.count).toBe(range?.max)
      }
    }),
  )
})

describe('wheat yields', () => {
  it.effect('ripe wheat drops one wheat and 1-4 seeds', () =>
    Effect.sync(() => {
      expect(cropDrops('wheat_crop', true, 0)).toStrictEqual({
        _tag: 'drops',
        drops: [
          { item: 'wheat', count: 1 },
          { item: 'wheat_seeds', count: 1 },
        ],
      })
      expect(cropDrops('wheat_crop', true, 0.999)).toStrictEqual({
        _tag: 'drops',
        drops: [
          { item: 'wheat', count: 1 },
          { item: 'wheat_seeds', count: 4 },
        ],
      })
    }),
  )

  it.effect('unripe wheat still returns only the planted seed', () =>
    Effect.sync(() => {
      expect(cropDrops('wheat_crop', false, 0.5)).toStrictEqual({
        _tag: 'drops',
        drops: [{ item: 'wheat_seeds', count: 1 }],
      })
    }),
  )

  it.effect('the ripe produce is part of the item vocabulary', () =>
    Effect.sync(() => {
      expect(ITEM_TYPES).toContain('wheat')
      expect(MISSING_RIPE_PRODUCE).not.toHaveProperty('wheat_crop')
    }),
  )
})

describe('blocks that are not crops', () => {
  it.effect('fall through, so the caller uses the block’s own loot', () =>
    Effect.sync(() => {
      expect(cropDrops('stone', false, 0)).toStrictEqual({ _tag: 'notACrop', block: 'stone' })
      expect(cropDrops('farmland', true, 0)._tag).toBe('notACrop')
    }),
  )

  it.effect('REGRESSION: the crop set is not everything', () =>
    Effect.sync(() => {
      // Guards the test above from being vacuous: if `UNRIPE_CROP_DROP` ever
      // gained a catch-all, `notACrop` would become unreachable and the caller
      // would stop consulting the block loot registry at all.
      expect(CROPS.length).toBeGreaterThan(0)
      expect(CROPS).not.toContain('stone')
    }),
  )
})
