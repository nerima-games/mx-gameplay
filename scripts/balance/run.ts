import { Result } from 'effect'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  advance as advanceTime,
  dayLengthSecs,
  INITIAL_TIME_STATE,
  TICKS_PER_SECOND,
  timeOfDay,
} from '@nerima-games/mc-sim'
import { isNight } from '../../src/index.js'
import {
  exposedPolicy,
  shelterPolicy,
  simulateSeed,
  type BalanceEffectRunner,
  type BalanceObservation,
  type BalancePolicy,
  type SeedSimulationResult,
} from './simulator.js'
import {
  summarizeGoal,
  type AchievementGoal,
  type BalanceSample,
  type TargetSummary,
} from './statistics.js'

export type PolicyName = 'shelter' | 'exposed'

export type RunOptions = Readonly<{
  seedCount: number
  policy: PolicyName
}>

export type CliParseResult =
  | Readonly<{ ok: true; value: RunOptions }>
  | Readonly<{ ok: false; error: string }>

export type GoalReport = Readonly<{
  key: string
  label: string
  target: string
  measurementPath: string
  goal: AchievementGoal
  summary: TargetSummary
  medianGap: number | null
  p90Gap: number | null
  unavailableReasons: ReadonlyArray<Readonly<{ reason: string; count: number }>>
}>

export type RateReport = Readonly<{
  status: 'observed' | 'unknown'
  totalCount: number
  measuredCount: number
  unavailableCount: number
  eventCount: number
  ratePercent: number | null
  medianDeathIndicator: number | null
  p90DeathIndicator: number | null
  target: string
  goal: AchievementGoal
  gapPercentagePoints: number | null
  meetsTarget: boolean | null
  unavailableReasons: ReadonlyArray<Readonly<{ reason: string; count: number }>>
}>

export type DamageReport = Readonly<{
  status: 'observed' | 'unknown'
  target: string
  attainment: Readonly<{
    totalCount: number
    measuredCount: number
    unavailableCount: number
    noDamageRatePercent: number | null
    damageRunRatePercent: number | null
  }>
  partialKnownDamageCount: number
  completeRunQuantiles: Readonly<{
    sampleCount: number
    medianEvents: number | null
    p90Events: number | null
  }>
  goal: AchievementGoal
  unavailableReasons: ReadonlyArray<Readonly<{ reason: string; count: number }>>
}>

export type BalanceReport = Readonly<{
  schemaVersion: 1
  config: Readonly<{ seedCount: number; seeds: ReadonlyArray<number>; policy: PolicyName }>
  goals: ReadonlyArray<GoalReport>
  night1Death: RateReport
  preTwilightDamage: DamageReport
  simulations: ReadonlyArray<SeedSimulationResult>
}>

type GoalDefinition = Readonly<{
  key: 'firstLog' | 'woodenPickaxe' | 'stoneTool' | 'cookedFood' | 'iron' | 'firstNight' | 'bedByNight1'
  label: string
  target: string
  goal: AchievementGoal
}>

const ticksPerDay = Math.ceil(dayLengthSecs(INITIAL_TIME_STATE) * TICKS_PER_SECOND)

const isNightAt = (ticks: number): boolean => {
  const state = Result.getOrThrow(
    advanceTime(INITIAL_TIME_STATE, (ticks / TICKS_PER_SECOND) as DeltaTimeSecs),
  )
  return isNight(timeOfDay(state))
}

const findFirstNightStartTick = (): number => {
  if (isNightAt(0)) return 0
  let low = 0
  let high = ticksPerDay
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (isNightAt(middle)) high = middle
    else low = middle
  }
  return high
}

const findFirstNightEndTick = (startTick: number): number => {
  let low = startTick
  let high = startTick + Math.ceil(ticksPerDay / 2)
  while (isNightAt(high)) high += 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (isNightAt(middle)) low = middle
    else high = middle
  }
  return high
}

const firstNightEndSeconds = findFirstNightEndTick(findFirstNightStartTick()) / TICKS_PER_SECOND

const goalDefinitions: ReadonlyArray<GoalDefinition> = [
  { key: 'firstLog', label: 'First log', target: '≤ 30 s', goal: { kind: 'max', threshold: 30 } },
  { key: 'woodenPickaxe', label: 'Wooden pickaxe', target: '≤ 150 s', goal: { kind: 'max', threshold: 150 } },
  { key: 'stoneTool', label: 'Stone tool', target: '≤ 240 s', goal: { kind: 'max', threshold: 240 } },
  { key: 'cookedFood', label: 'First cooked food', target: '≤ 420 s', goal: { kind: 'max', threshold: 420 } },
  { key: 'firstNight', label: 'First night', target: '≥ 480 s', goal: { kind: 'min', threshold: 480 } },
  { key: 'iron', label: 'First iron', target: '≤ 900 s', goal: { kind: 'max', threshold: 900 } },
  {
    key: 'bedByNight1',
    label: 'Bed by end of first night',
    target: `≤ ${firstNightEndSeconds} s`,
    goal: { kind: 'max', threshold: firstNightEndSeconds },
  },
]

const usage = 'Usage: tsx apps/balance-simulation/main.ts --seeds <positive-integer> --policy <shelter|exposed>'

export const parseRunArguments = (args: ReadonlyArray<string>): CliParseResult => {
  let seedCount: number | undefined
  let policy: PolicyName | undefined

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]
    const value = args[index + 1]
    if (option !== '--seeds' && option !== '--policy') {
      return { ok: false, error: `unknown argument: ${option ?? ''}` }
    }
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: `missing value for ${option}` }
    }
    if (option === '--seeds') {
      if (seedCount !== undefined) return { ok: false, error: 'duplicate --seeds option' }
      if (!/^[1-9][0-9]*$/.test(value)) {
        return { ok: false, error: '--seeds must be a positive safe integer' }
      }
      const parsed = Number(value)
      if (!Number.isSafeInteger(parsed)) return { ok: false, error: '--seeds must be a positive safe integer' }
      seedCount = parsed
    } else {
      if (policy !== undefined) return { ok: false, error: 'duplicate --policy option' }
      if (value !== 'shelter' && value !== 'exposed') {
        return { ok: false, error: '--policy must be shelter or exposed' }
      }
      policy = value
    }
  }

  if (seedCount === undefined) return { ok: false, error: 'missing required --seeds option' }
  if (policy === undefined) return { ok: false, error: 'missing required --policy option' }
  return { ok: true, value: { seedCount, policy } }
}

const policyFor = (name: PolicyName): BalancePolicy => name === 'shelter' ? shelterPolicy : exposedPolicy

const unavailableReasonForSimulation = (result: Exclude<SeedSimulationResult, { status: 'simulated' }>): string =>
  result.status === 'invalid-seed' ? result.reason : `terrain generation failed: ${JSON.stringify(result.error)}`

const sampleFromObservation = (observation: BalanceObservation): BalanceSample =>
  observation.status === 'observed'
    ? { status: 'measured', value: observation.seconds }
    : { status: 'unavailable', reason: observation.reason }

const sampleForGoal = (result: SeedSimulationResult, key: GoalDefinition['key']): BalanceSample => {
  if (result.status !== 'simulated') {
    return { status: 'unavailable', reason: unavailableReasonForSimulation(result) }
  }
  if (key === 'firstNight') {
    return { status: 'measured', value: result.firstNightTick / TICKS_PER_SECOND }
  }
  return sampleFromObservation(result.observations[key])
}

const summarize = (samples: ReadonlyArray<BalanceSample>, goal: AchievementGoal): TargetSummary => {
  const result = summarizeGoal(samples, goal)
  if (!result.ok) throw new Error(`balance goal summary failed: ${result.error.kind}`)
  return result.value
}

const summarizeUnavailableReasons = (samples: ReadonlyArray<BalanceSample>): ReadonlyArray<Readonly<{ reason: string; count: number }>> => {
  const counts = new Map<string, number>()
  for (const sample of samples) {
    if (sample.status === 'unavailable') counts.set(sample.reason, (counts.get(sample.reason) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({ reason, count }))
}

const gapFromGoal = (value: number | null, goal: AchievementGoal): number | null => {
  if (value === null) return null
  if (goal.kind === 'range') {
    if (value < goal.min) return goal.min - value
    if (value > goal.max) return value - goal.max
    return 0
  }
  if (goal.kind === 'max') return value - goal.threshold
  return goal.threshold - value
}

const goalReport = (results: ReadonlyArray<SeedSimulationResult>, definition: GoalDefinition): GoalReport => {
  const samples = results.map((result) => sampleForGoal(result, definition.key))
  const summary = summarize(samples, definition.goal)
  const measurementPaths = new Set(results.flatMap((result) => {
    if (result.status !== 'simulated') return []
    if (definition.key === 'firstNight') return ['first-night duration calculated from mc-sim TimeService day/night rules']
    if (definition.key === 'cookedFood') {
      return ['actual path not exercised: animal meat drops are unimplemented and the route does not search animals or crops']
    }
    if (definition.key === 'bedByNight1') {
      return ['actual path not exercised: wool drops are unimplemented and the route does not search sheep']
    }
    return [result.metricPaths[definition.key]]
  }))
  return {
    key: definition.key,
    label: definition.label,
    target: definition.target,
    measurementPath: [...measurementPaths].join('; ') || 'no simulated path available',
    goal: definition.goal,
    summary,
    medianGap: gapFromGoal(summary.median, definition.goal),
    p90Gap: gapFromGoal(summary.p90, definition.goal),
    unavailableReasons: summarizeUnavailableReasons(samples),
  }
}

const isGoalMet = (value: number, goal: AchievementGoal): boolean => {
  if (goal.kind === 'range') return value >= goal.min && value <= goal.max
  if (goal.kind === 'max') return value <= goal.threshold
  return value >= goal.threshold
}

const goalGap = (value: number, goal: AchievementGoal): number => gapFromGoal(value, goal) ?? 0

const nightDeathReport = (results: ReadonlyArray<SeedSimulationResult>, policy: PolicyName): RateReport => {
  const goal: AchievementGoal = policy === 'shelter'
    ? { kind: 'max', threshold: 10 }
    : { kind: 'range', min: 30, max: 50 }
  const target = policy === 'shelter' ? '≤ 10%' : '30–50%'
  let measuredCount = 0
  let eventCount = 0
  const samples: BalanceSample[] = []

  for (const result of results) {
    if (result.status !== 'simulated') {
      samples.push({ status: 'unavailable', reason: unavailableReasonForSimulation(result) })
      continue
    }
    const observation = result.observations.night1Death
    if (observation.status === 'unavailable') {
      samples.push({ status: 'unavailable', reason: observation.reason })
      continue
    }
    measuredCount += 1
    if (observation.died) eventCount += 1
    samples.push({ status: 'measured', value: observation.died ? 1 : 0 })
  }

  const unavailableCount = results.length - measuredCount
  const ratePercent = measuredCount === 0 ? null : (eventCount / measuredCount) * 100
  const indicatorSummary = summarize(samples, { kind: 'max', threshold: 0 })
  return {
    status: measuredCount === 0 ? 'unknown' : 'observed',
    totalCount: results.length,
    measuredCount,
    unavailableCount,
    eventCount,
    ratePercent,
    medianDeathIndicator: indicatorSummary.median,
    p90DeathIndicator: indicatorSummary.p90,
    target,
    goal,
    gapPercentagePoints: ratePercent === null ? null : goalGap(ratePercent, goal),
    meetsTarget: ratePercent === null ? null : isGoalMet(ratePercent, goal),
    unavailableReasons: summarizeUnavailableReasons(samples),
  }
}

const preTwilightDamageReport = (results: ReadonlyArray<SeedSimulationResult>): DamageReport => {
  const goal: AchievementGoal = { kind: 'max', threshold: 0 }
  const attainmentSamples: BalanceSample[] = []
  const completeEventCounts: number[] = []
  let partialKnownDamageCount = 0
  for (const result of results) {
    if (result.status !== 'simulated') {
      attainmentSamples.push({ status: 'unavailable', reason: unavailableReasonForSimulation(result) })
      continue
    }
    const series = result.observations.preTwilightDamage
    if (series.status === 'observed') {
      const eventCount = series.events.filter((event) => event.cause !== 'starvation').length
      completeEventCounts.push(eventCount)
      attainmentSamples.push({ status: 'measured', value: eventCount })
      continue
    }
    if (series.status === 'partial') {
      const knownHostileDamage = series.events.filter((event) => event.cause === 'hostile').length
      if (knownHostileDamage > 0) {
        partialKnownDamageCount += 1
        attainmentSamples.push({ status: 'measured', value: knownHostileDamage })
      } else {
        attainmentSamples.push({ status: 'unavailable', reason: series.reason })
      }
      continue
    }
    attainmentSamples.push({ status: 'unavailable', reason: series.reason })
  }
  const attainmentSummary = summarize(attainmentSamples, goal)
  const completeQuantileSummary = summarize(
    completeEventCounts.map((value) => ({ status: 'measured', value })),
    goal,
  )
  const noDamageRatePercent = attainmentSummary.achievementRate === null
    ? null
    : attainmentSummary.achievementRate * 100
  const damageRunRatePercent = noDamageRatePercent === null ? null : 100 - noDamageRatePercent
  return {
    status: attainmentSummary.measuredCount === 0 ? 'unknown' : 'observed',
    target: '0 hostile damage events before first twilight',
    attainment: {
      totalCount: attainmentSummary.totalCount,
      measuredCount: attainmentSummary.measuredCount,
      unavailableCount: attainmentSummary.unavailableCount,
      noDamageRatePercent,
      damageRunRatePercent,
    },
    partialKnownDamageCount,
    completeRunQuantiles: {
      sampleCount: completeEventCounts.length,
      medianEvents: completeQuantileSummary.median,
      p90Events: completeQuantileSummary.p90,
    },
    goal,
    unavailableReasons: summarizeUnavailableReasons(attainmentSamples),
  }
}

export const buildBalanceReport = (
  results: ReadonlyArray<SeedSimulationResult>,
  policy: PolicyName,
): BalanceReport => ({
  schemaVersion: 1,
  config: {
    seedCount: results.length,
    seeds: results.map((result) => result.seed),
    policy,
  },
  goals: goalDefinitions.map((definition) => goalReport(results, definition)),
  night1Death: nightDeathReport(results, policy),
  preTwilightDamage: preTwilightDamageReport(results),
  simulations: results,
})

export const runBalanceSimulation = async (
  options: RunOptions,
  runEffect: BalanceEffectRunner,
): Promise<BalanceReport> => {
  const policy = policyFor(options.policy)
  const results: SeedSimulationResult[] = []
  const simulateNext = (seed: number): Promise<void> => seed >= options.seedCount
    ? Promise.resolve()
    : simulateSeed(seed, policy, runEffect).then((result) => {
        results.push(result)
        return simulateNext(seed + 1)
      })
  await simulateNext(0)
  return buildBalanceReport(results, options.policy)
}

const formatNumber = (value: number | null, suffix = ''): string =>
  value === null ? 'unknown' : `${Number(value.toFixed(2))}${suffix}`

const formatPercent = (value: number | null): string => formatNumber(value, '%')

export const formatBalanceTable = (report: BalanceReport): string => {
  const lines = [
    `Policy: ${report.config.policy}; seeds: ${report.config.seedCount}`,
    '',
    'Gap is signed: positive means outside the target; negative means within it.',
    '',
    '| Goal | Target | Measured / unknown | Median | p90 | Attainment | Median gap | p90 gap | Measurement path |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ]

  for (const goal of report.goals) {
    const { summary } = goal
    lines.push(`${[
      `| ${goal.label}`,
      goal.target,
      `${summary.measuredCount} / ${summary.unavailableCount}`,
      formatNumber(summary.median, ' s'),
      formatNumber(summary.p90, ' s'),
      formatPercent(summary.achievementRate === null ? null : summary.achievementRate * 100),
      formatNumber(goal.medianGap, ' s'),
      formatNumber(goal.p90Gap, ' s'),
      goal.measurementPath,
    ].join(' | ')} |`)
  }

  lines.push(
    '',
    '| Night metric | Target | Attainment measured / unknown | Rate | Distribution summary | Partial hit runs | Gap | Status |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    `| Night-1 deaths | ${report.night1Death.target} | ${report.night1Death.measuredCount} / ${report.night1Death.unavailableCount} | ${formatPercent(report.night1Death.ratePercent)} deaths | indicator ${formatNumber(report.night1Death.medianDeathIndicator)} / ${formatNumber(report.night1Death.p90DeathIndicator)} (n=${report.night1Death.measuredCount}, 0/1) | — | ${formatNumber(report.night1Death.gapPercentagePoints, ' pp')} | ${report.night1Death.status} |`,
    `| Pre-twilight damage runs | ${report.preTwilightDamage.target} | ${report.preTwilightDamage.attainment.measuredCount} / ${report.preTwilightDamage.attainment.unavailableCount} | ${formatPercent(report.preTwilightDamage.attainment.damageRunRatePercent)} runs affected | complete-run events ${formatNumber(report.preTwilightDamage.completeRunQuantiles.medianEvents)} / ${formatNumber(report.preTwilightDamage.completeRunQuantiles.p90Events)} (n=${report.preTwilightDamage.completeRunQuantiles.sampleCount}) | ${report.preTwilightDamage.partialKnownDamageCount} | ${formatNumber(report.preTwilightDamage.attainment.damageRunRatePercent, ' pp')} | ${report.preTwilightDamage.status} |`,
  )

  return lines.join('\n')
}

export const renderBalanceReport = (report: BalanceReport): string => `## JSON

\`\`\`json
${JSON.stringify(report, null, 2)}
\`\`\`

## Summary

${formatBalanceTable(report)}
`

export const runCli = async (
  args: ReadonlyArray<string>,
  runEffect: BalanceEffectRunner,
): Promise<number> => {
  const parsed = parseRunArguments(args)
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n${usage}\n`)
    return 2
  }
  const report = await runBalanceSimulation(parsed.value, runEffect)
  process.stdout.write(renderBalanceReport(report))
  return 0
}
