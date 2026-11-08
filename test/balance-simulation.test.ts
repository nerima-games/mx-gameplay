import { beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TICKS_PER_SECOND } from '@nerima-games/mc-sim'
import {
  buildBalanceReport,
  formatBalanceTable,
  parseRunArguments,
  renderBalanceReport,
} from '../scripts/balance/run.js'
import {
  exposedPolicy,
  shelterPolicy,
  simulateSeed,
  type BalanceEventSeries,
  type BalanceObservation,
  type SeedObservations,
  type SeedSimulationResult,
} from '../scripts/balance/simulator.js'

const observedAt = (seconds: number): BalanceObservation => ({
  status: 'observed',
  seconds,
  ticks: seconds * TICKS_PER_SECOND,
})

const unavailableObservation = (reason: string): BalanceObservation => ({ status: 'unavailable', reason })

const expectObservedAtOrUnder = (observation: BalanceObservation, threshold: number): void => {
  expect(observation.status).toBe('observed')
  if (observation.status === 'observed') expect(observation.seconds).toBeLessThanOrEqual(threshold)
}

const observedEvents = (...seconds: ReadonlyArray<number>): BalanceEventSeries => ({
  status: 'observed',
  events: seconds.map((value) => ({ seconds: value, ticks: value * TICKS_PER_SECOND })),
})

const observationsFor = (overrides: Partial<SeedObservations> = {}): SeedObservations => ({
  firstLog: unavailableObservation('no log route'),
  woodenPickaxe: unavailableObservation('no wood route'),
  stoneTool: unavailableObservation('no stone route'),
  cookedFood: unavailableObservation('food route unavailable'),
  iron: unavailableObservation('no iron route'),
  bedByNight1: unavailableObservation('bed materials unavailable'),
  night1Death: { status: 'observed', died: false, deathTicks: null },
  preTwilightDamage: observedEvents(),
  damageTimestamps: observedEvents(),
  hunger: { status: 'observed', died: false, healthPoints: 20, hungerPoints: 20, starvationDamage: 0 },
  ...overrides,
})

const simulatedResult = (
  seed: number,
  observations: SeedObservations,
): Extract<SeedSimulationResult, { status: 'simulated' }> => ({
  status: 'simulated',
  seed,
  policy: { name: 'shelter', nightAction: 'shelter' },
  policyExecution: {
    status: 'observed',
    action: 'shelter',
    startPosition: { x: 0, y: 64, z: 0 },
    targetPosition: { x: 0, y: 61, z: 0 },
    shelterBlocksMined: 3,
  },
  firstNightTick: 480 * TICKS_PER_SECOND,
  firstTwilightTick: 360 * TICKS_PER_SECOND,
  limitations: [],
  terrain: { chunkX: 0, chunkZ: 0, blockTypes: [] },
  observations,
})

describe('balance simulation runner', () => {
  let shelterResult: SeedSimulationResult | undefined

  beforeAll(async () => {
    shelterResult = await simulateSeed(0, shelterPolicy, Effect.runPromise)
  })

  it('requires a positive seed count and a supported policy', () => {
    expect(parseRunArguments(['--seeds', '3', '--policy', 'shelter'])).toStrictEqual({
      ok: true,
      value: { seedCount: 3, policy: 'shelter' },
    })
    expect(parseRunArguments(['--seeds', '0', '--policy', 'shelter']).ok).toBe(false)
    expect(parseRunArguments(['--seeds', '2.5', '--policy', 'shelter']).ok).toBe(false)
    expect(parseRunArguments(['--seeds', '2', '--policy', 'normal']).ok).toBe(false)
    expect(parseRunArguments(['--seeds', '2']).ok).toBe(false)
  })

  it('reports target summaries, aggregate death probability, unknown goals, and readable gaps', () => {
    const first = simulatedResult(0, observationsFor({
      firstLog: observedAt(20),
      woodenPickaxe: observedAt(100),
      stoneTool: observedAt(240),
      iron: observedAt(800),
      night1Death: { status: 'observed', died: true, deathTicks: 12_500 },
      preTwilightDamage: observedEvents(),
    }))
    const second = simulatedResult(1, observationsFor({
      firstLog: observedAt(40),
      woodenPickaxe: observedAt(200),
      cookedFood: observedAt(400),
      night1Death: { status: 'observed', died: false, deathTicks: null },
      preTwilightDamage: observedEvents(120, 300),
    }))

    const report = buildBalanceReport([first, second], 'shelter')
    const firstLog = report.goals.find((goal) => goal.key === 'firstLog')
    const food = report.goals.find((goal) => goal.key === 'cookedFood')
    const bed = report.goals.find((goal) => goal.key === 'bedByNight1')

    expect(firstLog).toMatchObject({
      summary: {
        totalCount: 2,
        measuredCount: 2,
        unavailableCount: 0,
        median: 30,
        p90: 40,
        achievementRate: 0.5,
      },
      medianGap: 0,
      p90Gap: 10,
    })
    expect(food).toMatchObject({
      summary: {
        totalCount: 2,
        measuredCount: 1,
        unavailableCount: 1,
        median: 400,
        p90: 400,
        achievementRate: 1,
      },
    })
    expect(bed?.summary).toStrictEqual({
      totalCount: 2,
      measuredCount: 0,
      unavailableCount: 2,
      median: null,
      p90: null,
      achievementRate: null,
    })
    expect(report.night1Death).toMatchObject({
      status: 'observed',
      measuredCount: 2,
      unavailableCount: 0,
      eventCount: 1,
      ratePercent: 50,
      gapPercentagePoints: 40,
      meetsTarget: false,
      medianDeathIndicator: 0.5,
      p90DeathIndicator: 1,
    })
    expect(buildBalanceReport([first, second], 'exposed').night1Death).toMatchObject({
      target: '30–50%',
      ratePercent: 50,
      gapPercentagePoints: 0,
      meetsTarget: true,
    })
    expect(report.preTwilightDamage).toMatchObject({
      status: 'observed',
      attainment: {
        totalCount: 2,
        measuredCount: 2,
        unavailableCount: 0,
        noDamageRatePercent: 50,
        damageRunRatePercent: 50,
      },
      partialKnownDamageCount: 0,
      completeRunQuantiles: { sampleCount: 2, medianEvents: 1, p90Events: 2 },
    })
    expect(formatBalanceTable(report)).toContain('| Bed by end of first night')
    const table = formatBalanceTable(report)
    expect(table).toContain('| 0 / 2 | unknown | unknown | unknown |')
    expect(table).toContain('50% deaths')
    expect(renderBalanceReport(report)).toContain('"schemaVersion": 1')
    expect(renderBalanceReport(report)).toContain('## Summary')
  })

  it('keeps known pre-twilight damage as a target failure and leaves incomplete no-hit runs unknown', () => {
    const diedAfterHostileDamage = simulatedResult(2, observationsFor({
      night1Death: { status: 'unavailable', reason: 'player died before first night' },
      preTwilightDamage: {
        status: 'partial',
        events: [{ seconds: 100, ticks: 100 * TICKS_PER_SECOND, cause: 'hostile' }],
        reason: 'player died before twilight',
      },
      damageTimestamps: {
        status: 'unavailable',
        reason: 'twilight interval did not begin before death',
      },
    }))
    const diedWithoutHostileDamage = simulatedResult(3, observationsFor({
      night1Death: { status: 'unavailable', reason: 'player died before first night' },
      preTwilightDamage: {
        status: 'partial',
        events: [],
        reason: 'player died before twilight before any hostile damage was observed',
      },
      damageTimestamps: {
        status: 'observed',
        events: [{ seconds: 100, ticks: 100 * TICKS_PER_SECOND, cause: 'starvation' }],
      },
    }))
    const routeReachedTwilightBeforeCombat = simulatedResult(4, observationsFor({
      preTwilightDamage: {
        status: 'unavailable',
        reason: 'combat measurement started after the first twilight boundary',
      },
      damageTimestamps: observedEvents(),
    }))
    const fullyObservedNoDamage = simulatedResult(5, observationsFor({
      preTwilightDamage: observedEvents(),
    }))

    const report = buildBalanceReport([
      diedAfterHostileDamage,
      diedWithoutHostileDamage,
      routeReachedTwilightBeforeCombat,
      fullyObservedNoDamage,
    ], 'exposed')
    expect(report.preTwilightDamage).toMatchObject({
      status: 'observed',
      attainment: {
        totalCount: 4,
        measuredCount: 2,
        unavailableCount: 2,
        noDamageRatePercent: 50,
        damageRunRatePercent: 50,
      },
      completeRunQuantiles: { sampleCount: 1, medianEvents: 0, p90Events: 0 },
      partialKnownDamageCount: 1,
      target: '0 hostile damage events before first twilight',
      unavailableReasons: [{
        reason: 'combat measurement started after the first twilight boundary',
        count: 1,
      }, {
        reason: 'player died before twilight before any hostile damage was observed',
        count: 1,
      }],
    })
    expect(formatBalanceTable(report)).toContain('| complete-run events 0 / 0 (n=1) | 1 |')
  })

  it('replays a seed deterministically and leaves the unobserved route interval unknown', async () => {
    if (shelterResult === undefined) throw new Error('seed setup did not complete')
    expect(await simulateSeed(0, shelterPolicy, Effect.runPromise)).toStrictEqual(shelterResult)
    expect(shelterResult.status).toBe('simulated')
    if (shelterResult.status !== 'simulated') return

    expectObservedAtOrUnder(shelterResult.observations.firstLog, 30)
    expectObservedAtOrUnder(shelterResult.observations.woodenPickaxe, 150)
    expectObservedAtOrUnder(shelterResult.observations.stoneTool, 240)
    expectObservedAtOrUnder(shelterResult.observations.iron, 900)
    expect(shelterResult.observations.cookedFood).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('animal meat drops are not implemented'),
    })
    expect(shelterResult.observations.bedByNight1).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('wool drops'),
    })
    expect(shelterResult.observations.preTwilightDamage).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('route actions were not interleaved with combat'),
    })
    expect(buildBalanceReport([shelterResult], 'shelter').preTwilightDamage).toMatchObject({
      status: 'unknown',
      attainment: {
        totalCount: 1,
        measuredCount: 0,
        unavailableCount: 1,
        noDamageRatePercent: null,
        damageRunRatePercent: null,
      },
      completeRunQuantiles: { sampleCount: 0, medianEvents: null, p90Events: null },
    })
  })

  it('applies replacement policies to the actual night position', async () => {
    if (shelterResult === undefined) throw new Error('seed setup did not complete')
    const shelter = shelterResult
    const exposed = await simulateSeed(0, exposedPolicy, Effect.runPromise)

    expect(shelter.status).toBe('simulated')
    expect(exposed.status).toBe('simulated')
    if (shelter.status !== 'simulated' || exposed.status !== 'simulated') return
    expect(shelter.policyExecution.status).toBe('observed')
    expect(exposed.policyExecution.status).toBe('observed')
    if (shelter.policyExecution.status !== 'observed' || exposed.policyExecution.status !== 'observed') return

    expect(shelter.policyExecution.action).toBe('shelter')
    expect(shelter.policyExecution.shelterBlocksMined).toBe(3)
    expect(shelter.policyExecution.targetPosition.y).toBeLessThan(shelter.policyExecution.startPosition.y)
    expect(exposed.policyExecution.action).toBe('exposed')
    expect(exposed.policyExecution.shelterBlocksMined).toBe(0)
    expect(exposed.policyExecution.targetPosition.y).toBe(exposed.policyExecution.startPosition.y)
    expect(shelter.policyExecution.targetPosition).not.toStrictEqual(exposed.policyExecution.targetPosition)
  })
})
