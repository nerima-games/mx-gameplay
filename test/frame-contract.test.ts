/**
 * `domain/frame-contract.ts`'s two clock brands, `MonotonicTimeSecs` and
 * `EpochMillis`.
 *
 * Every other brand in this file (`StageId`, `DeltaTimeSecs`, `StackCount`) has
 * its rejection path exercised elsewhere — `test/stage-registration.test.ts`
 * and `test/mob.test.ts`. These two did not: `ClockPort` is mirrored whole
 * (§0 of the module header) but nothing in this repository constructs an
 * INVALID clock reading, so the `Brand.refined` failure branch for each was
 * unreached under the Wave 0 100% coverage gate. This file closes that gap
 * the same way `StackCount`'s own test does — construct valid and invalid
 * values and assert the boundary.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { EpochMillis, MonotonicTimeSecs } from '../src/domain/frame-contract'

describe('MonotonicTimeSecs', () => {
  it.effect('accepts finite, non-negative readings and nothing else', () =>
    Effect.sync(() => {
      expect(MonotonicTimeSecs(0)).toBe(0)
      expect(MonotonicTimeSecs(12.5)).toBe(12.5)

      expect(() => MonotonicTimeSecs(-1)).toThrow()
      expect(() => MonotonicTimeSecs(Number.NaN)).toThrow()
      expect(() => MonotonicTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )
})

describe('EpochMillis', () => {
  it.effect('accepts safe integers and nothing else', () =>
    Effect.sync(() => {
      expect(EpochMillis(0)).toBe(0)
      expect(EpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000)

      expect(() => EpochMillis(1.5)).toThrow()
      expect(() => EpochMillis(Number.NaN)).toThrow()
      expect(() => EpochMillis(Number.MAX_SAFE_INTEGER + 1)).toThrow()
    }),
  )
})
