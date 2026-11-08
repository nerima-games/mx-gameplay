export type BalanceSample =
  | { readonly status: 'measured'; readonly value: number | null }
  | { readonly status: 'unavailable'; readonly reason: string }

export interface TargetSummary {
  readonly totalCount: number
  readonly measuredCount: number
  readonly unavailableCount: number
  readonly median: number | null
  readonly p90: number | null
  readonly achievementRate: number | null
}

export type AchievementGoal =
  | { readonly kind: 'max' | 'min'; readonly threshold: number }
  | { readonly kind: 'range'; readonly min: number; readonly max: number }

export type TargetSummaryError =
  | { readonly kind: 'invalid-target' }
  | {
      readonly kind: 'invalid-goal'
      readonly issue: 'invalid-shape' | 'invalid-threshold' | 'invalid-range'
    }
  | { readonly kind: 'invalid-samples' }
  | {
      readonly kind: 'invalid-sample'
      readonly index: number
      readonly issue: 'invalid-shape' | 'invalid-status' | 'invalid-value' | 'invalid-reason'
    }

export type TargetSummaryResult =
  | { readonly ok: true; readonly value: TargetSummary }
  | { readonly ok: false; readonly error: TargetSummaryError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function summarizeSamples(
  samples: readonly BalanceSample[],
  isAchieved: (value: number) => boolean,
): TargetSummaryResult {
  if (!Array.isArray(samples)) {
    return { ok: false, error: { kind: 'invalid-samples' } }
  }

  let measuredCount = 0
  let unavailableCount = 0
  let achievedCount = 0
  const values: number[] = []

  for (let index = 0; index < samples.length; index += 1) {
    const sample: unknown = samples[index]
    if (!isRecord(sample)) {
      return { ok: false, error: { kind: 'invalid-sample', index, issue: 'invalid-shape' } }
    }

    if (sample['status'] === 'measured') {
      const value = sample['value']
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        return { ok: false, error: { kind: 'invalid-sample', index, issue: 'invalid-value' } }
      }

      measuredCount += 1
      if (typeof value === 'number') {
        values.push(value)
        if (isAchieved(value)) achievedCount += 1
      }
      continue
    }

    if (sample['status'] === 'unavailable') {
      const reason = sample['reason']
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        return { ok: false, error: { kind: 'invalid-sample', index, issue: 'invalid-reason' } }
      }
      unavailableCount += 1
      continue
    }

    return { ok: false, error: { kind: 'invalid-sample', index, issue: 'invalid-status' } }
  }

  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  const median =
    values.length === 0
      ? null
      : values.length % 2 === 1
        ? values[middle]!
        : values[middle - 1]! / 2 + values[middle]! / 2
  const p90 = values.length === 0 ? null : values[Math.ceil(values.length * 0.9) - 1]!

  return {
    ok: true,
    value: {
      totalCount: samples.length,
      measuredCount,
      unavailableCount,
      median,
      p90,
      achievementRate: measuredCount === 0 ? null : achievedCount / measuredCount,
    },
  }
}

export function summarizeTarget(samples: readonly BalanceSample[], target: number): TargetSummaryResult {
  if (!isValidThreshold(target)) {
    return { ok: false, error: { kind: 'invalid-target' } }
  }
  return summarizeSamples(samples, (value) => value <= target)
}

export function summarizeGoal(
  samples: readonly BalanceSample[],
  goal: AchievementGoal,
): TargetSummaryResult {
  if (!isRecord(goal)) {
    return { ok: false, error: { kind: 'invalid-goal', issue: 'invalid-shape' } }
  }

  const kind = goal['kind']
  if (kind === 'max' || kind === 'min') {
    const threshold = goal['threshold']
    if (!isValidThreshold(threshold)) {
      return { ok: false, error: { kind: 'invalid-goal', issue: 'invalid-threshold' } }
    }
    return summarizeSamples(samples, (value) => (kind === 'max' ? value <= threshold : value >= threshold))
  }

  if (kind === 'range') {
    const min = goal['min']
    const max = goal['max']
    if (!isValidThreshold(min) || !isValidThreshold(max) || min > max) {
      return { ok: false, error: { kind: 'invalid-goal', issue: 'invalid-range' } }
    }
    return summarizeSamples(samples, (value) => value >= min && value <= max)
  }

  return { ok: false, error: { kind: 'invalid-goal', issue: 'invalid-shape' } }
}
