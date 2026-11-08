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

function independentSummary(
  samples: readonly BalanceSample[],
  isAchieved: (value: number) => boolean,
): TargetSummary {
  const measured = samples.filter(
    (sample): sample is Extract<BalanceSample, { status: 'measured' }> => sample.status === 'measured',
  )
  const values = measured.flatMap((sample) => sample.value === null ? [] : [sample.value])
  values.sort((left, right) => left - right)

  const valueAt = (index: number): number => {
    const value = values[index]
    if (value === undefined) throw new Error(`Expected a sorted value at index ${index}`)
    return value
  }
  const middle = Math.floor(values.length / 2)
  const median = values.length === 0
    ? null
    : values.length % 2 === 1
      ? valueAt(middle)
      : valueAt(middle - 1) / 2 + valueAt(middle) / 2
  const p90Rank = Math.ceil(values.length * 0.9)
  const p90 = p90Rank === 0 ? null : valueAt(p90Rank - 1)
  const achievedCount = measured.filter((sample) => sample.value !== null && isAchieved(sample.value)).length

  return {
    totalCount: samples.length,
    measuredCount: measured.length,
    unavailableCount: samples.filter((sample) => sample.status === 'unavailable').length,
    median,
    p90,
    achievementRate: measured.length === 0 ? null : achievedCount / measured.length,
  }
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

  it('matches target summaries against independently sorted and counted samples', () => {
    fc.assert(
      fc.property(sampleArbitrary, fc.array(sampleArbitrary, { maxLength: 40 }), timeArbitrary, (first, rest, target) => {
        const samples = [first, ...rest]
        expect(summarizeTarget(samples, target)).toStrictEqual({
          ok: true,
          value: independentSummary(samples, (value) => value <= target),
        })
      }),
      { numRuns: 100 },
    )
  })

  it('matches goal summaries against independently sorted and counted samples', () => {
    fc.assert(
      fc.property(
        sampleArbitrary,
        fc.array(sampleArbitrary, { maxLength: 40 }),
        goalArbitrary,
        (first, rest, goal) => {
          const samples = [first, ...rest]
          const isAchieved = (value: number): boolean => goal.kind === 'range'
            ? value >= goal.min && value <= goal.max
            : goal.kind === 'min'
              ? value >= goal.threshold
              : value <= goal.threshold
          expect(summarizeGoal(samples, goal)).toStrictEqual({
            ok: true,
            value: independentSummary(samples, isAchieved),
          })
        },
      ),
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
            max: summarizeGoal(maxSamples, { kind: 'max', threshold: maxThreshold }),
            min: summarizeGoal(minSamples, { kind: 'min', threshold: minThreshold }),
            range: summarizeGoal(rangeSamples, { kind: 'range', min: rangeMin, max: rangeMax }),
          }).toStrictEqual({
            max: {
              ok: true,
              value: independentSummary(maxSamples, (value) => value <= maxThreshold),
            },
            min: {
              ok: true,
              value: independentSummary(minSamples, (value) => value >= minThreshold),
            },
            range: {
              ok: true,
              value: independentSummary(rangeSamples, (value) => value >= rangeMin && value <= rangeMax),
            },
          })
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
