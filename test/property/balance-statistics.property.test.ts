import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import {
  summarizeGoal,
  summarizeTarget,
  type AchievementGoal,
  type BalanceSample,
  type TargetSummary,
} from '../../scripts/balance/statistics'

const timeArbitrary = fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true })
const sampleArbitrary = fc.oneof(
  timeArbitrary.map((value) => ({ status: 'measured' as const, value })),
  fc.constant({ status: 'measured' as const, value: null }),
  fc.constantFrom(
    { status: 'unavailable' as const, reason: 'outside observation range' },
    { status: 'unavailable' as const, reason: 'measurement unsupported' },
  ),
)
const goalArbitrary: fc.Arbitrary<AchievementGoal> = fc.oneof(
  timeArbitrary.map((threshold) => ({ kind: 'max' as const, threshold })),
  timeArbitrary.map((threshold) => ({ kind: 'min' as const, threshold })),
  fc.tuple(timeArbitrary, timeArbitrary).map(([first, second]) => ({
    kind: 'range' as const,
    min: Math.min(first, second),
    max: Math.max(first, second),
  })),
)

function summaryOf(samples: readonly BalanceSample[], target: number): TargetSummary {
  const result = summarizeTarget(samples, target)
  if (!result.ok) throw new Error(`Expected valid samples, got ${result.error.kind}`)
  return result.value
}

function goalSummaryOf(samples: readonly BalanceSample[], goal: AchievementGoal): TargetSummary {
  const result = summarizeGoal(samples, goal)
  if (!result.ok) throw new Error(`Expected a valid goal, got ${result.error.kind}`)
  return result.value
}

function numericStatsOf(summary: TargetSummary): { readonly median: number; readonly p90: number } {
  if (summary.median === null || summary.p90 === null) {
    throw new Error('Expected at least one measured numeric value')
  }
  return { median: summary.median, p90: summary.p90 }
}

function achievementRateOf(summary: TargetSummary): number {
  if (summary.achievementRate === null) throw new Error('Expected at least one measured sample')
  return summary.achievementRate
}

describe('balance target statistics', () => {
  it('returns null rates and time statistics when there are no measured samples', () => {
    expect([
      summarizeTarget([], 10),
      summarizeTarget([{ status: 'unavailable', reason: 'not observed' }], 10),
    ]).toStrictEqual([
      {
        ok: true,
        value: {
          totalCount: 0,
          measuredCount: 0,
          unavailableCount: 0,
          median: null,
          p90: null,
          achievementRate: null,
        },
      },
      {
        ok: true,
        value: {
          totalCount: 1,
          measuredCount: 0,
          unavailableCount: 1,
          median: null,
          p90: null,
          achievementRate: null,
        },
      },
    ])
  })

  it('keeps null measured values in the achievement denominator and excludes them from time statistics', () => {
    expect([
      summarizeTarget(
        [
          { status: 'measured', value: null },
          { status: 'measured', value: 3 },
          { status: 'unavailable', reason: 'not observed' },
        ],
        3,
      ),
      summarizeTarget(
        [
          { status: 'measured', value: null },
          { status: 'unavailable', reason: 'not observed' },
        ],
        3,
      ),
    ]).toStrictEqual([
      {
        ok: true,
        value: {
          totalCount: 3,
          measuredCount: 2,
          unavailableCount: 1,
          median: 3,
          p90: 3,
          achievementRate: 0.5,
        },
      },
      {
        ok: true,
        value: {
          totalCount: 2,
          measuredCount: 1,
          unavailableCount: 1,
          median: null,
          p90: null,
          achievementRate: 0,
        },
      },
    ])
  })

  it('counts values equal to the target as achieved and larger values as missed', () => {
    expect(
      summarizeTarget(
        [
          { status: 'measured', value: 5 },
          { status: 'measured', value: 6 },
        ],
        5,
      ),
    ).toStrictEqual({
      ok: true,
      value: {
        totalCount: 2,
        measuredCount: 2,
        unavailableCount: 0,
        median: 5.5,
        p90: 6,
        achievementRate: 0.5,
      },
    })
  })

  it('uses the ordinary median and nearest-rank p90 for even-sized numeric samples', () => {
    const samples: BalanceSample[] = [100, 1, 8, 2, 9, 3, 7, 4, 6, 5].map((value) => ({
      status: 'measured',
      value,
    }))

    expect(summarizeTarget(samples, 6)).toStrictEqual({
      ok: true,
      value: {
        totalCount: 10,
        measuredCount: 10,
        unavailableCount: 0,
        median: 5.5,
        p90: 9,
        achievementRate: 0.6,
      },
    })
  })

  it('keeps p90 at or above the median for non-empty numeric samples', () => {
    fc.assert(
      fc.property(fc.array(timeArbitrary, { minLength: 1, maxLength: 40 }), timeArbitrary, (values, target) => {
        const stats = numericStatsOf(
          summaryOf(
            values.map((value) => ({ status: 'measured', value })),
            target,
          ),
        )
        expect(stats.p90).toBeGreaterThanOrEqual(stats.median)
      }),
      { numRuns: 100 },
    )
  })

  it('keeps achievement rates between zero and one', () => {
    fc.assert(
      fc.property(
        timeArbitrary,
        fc.array(sampleArbitrary, { maxLength: 20 }),
        timeArbitrary,
        (value, samples, target) => {
          const rate = achievementRateOf(
            summaryOf([...samples, { status: 'measured', value }], target),
          )
          expect(rate).toBeGreaterThanOrEqual(0)
          expect(rate).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('does not change summaries when valid samples are reordered', () => {
    fc.assert(
      fc.property(fc.array(sampleArbitrary, { maxLength: 40 }), timeArbitrary, (samples, target) => {
        expect(summarizeTarget(samples, target)).toStrictEqual(
          summarizeTarget([...samples].reverse(), target),
        )
      }),
      { numRuns: 100 },
    )
  })

  it('counts max and min thresholds and both range bounds inclusively', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        (maxThreshold, minThreshold, rangeWidth) => {
          const maxSamples: BalanceSample[] = [
            { status: 'measured', value: maxThreshold },
            { status: 'measured', value: maxThreshold + 1 },
          ]
          const minSamples: BalanceSample[] = [
            { status: 'measured', value: minThreshold - 1 },
            { status: 'measured', value: minThreshold },
          ]
          const rangeMin = minThreshold
          const rangeMax = rangeMin + rangeWidth
          const rangeSamples: BalanceSample[] = [
            { status: 'measured', value: rangeMin - 1 },
            { status: 'measured', value: rangeMin },
            { status: 'measured', value: rangeMax },
            { status: 'measured', value: rangeMax + 1 },
          ]

          expect({
            maxRate: goalSummaryOf(maxSamples, { kind: 'max', threshold: maxThreshold }).achievementRate,
            maxMatchesLegacy: summarizeGoal(maxSamples, { kind: 'max', threshold: maxThreshold }),
            minRate: goalSummaryOf(minSamples, { kind: 'min', threshold: minThreshold }).achievementRate,
            rangeRate: goalSummaryOf(rangeSamples, { kind: 'range', min: rangeMin, max: rangeMax })
              .achievementRate,
          }).toStrictEqual({
            maxRate: 0.5,
            maxMatchesLegacy: summarizeTarget(maxSamples, maxThreshold),
            minRate: 0.5,
            rangeRate: 0.5,
          })
        },
      ),
      { numRuns: 100 },
    )
  })

  it('keeps goal summaries unchanged when valid samples are reordered', () => {
    fc.assert(
      fc.property(
        fc.array(sampleArbitrary, { maxLength: 40 }),
        goalArbitrary,
        (samples, goal) => {
          expect(summarizeGoal(samples, goal)).toStrictEqual(
            summarizeGoal([...samples].reverse(), goal),
          )
        },
      ),
      { numRuns: 100 },
    )
  })

  it('keeps goal achievement rates between zero and one', () => {
    fc.assert(
      fc.property(
        timeArbitrary,
        fc.array(sampleArbitrary, { maxLength: 20 }),
        goalArbitrary,
        (value, samples, goal) => {
          const rate = achievementRateOf(
            goalSummaryOf([...samples, { status: 'measured', value }], goal),
          )
          expect(rate).toBeGreaterThanOrEqual(0)
          expect(rate).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects invalid goal bounds and reversed ranges', () => {
    expect([
      summarizeGoal([], { kind: 'min', threshold: -1 }),
      summarizeGoal([], { kind: 'range', min: 2, max: 1 }),
      summarizeGoal([], { kind: 'range', min: 0, max: Number.POSITIVE_INFINITY }),
    ]).toStrictEqual([
      { ok: false, error: { kind: 'invalid-goal', issue: 'invalid-threshold' } },
      { ok: false, error: { kind: 'invalid-goal', issue: 'invalid-range' } },
      { ok: false, error: { kind: 'invalid-goal', issue: 'invalid-range' } },
    ])
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid target %s', (target) => {
    expect(summarizeTarget([], target)).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-target' },
    })
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid measured value %s', (value) => {
    expect(summarizeTarget([{ status: 'measured', value }], 1)).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-sample', index: 0, issue: 'invalid-value' },
    })
  })

  it.each(['', ' \t '])('rejects empty unavailable reason %j', (reason) => {
    expect(summarizeTarget([{ status: 'unavailable', reason }], 1)).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-sample', index: 0, issue: 'invalid-reason' },
    })
  })
})
