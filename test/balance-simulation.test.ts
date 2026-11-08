import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Ref, Schema } from 'effect'
import { AIR_BLOCK_ID, BlockAxis, ChunkAxis, EntityHealthPoints, InterpolationFraction, PositionAxis, blockIdOf, blockPosition, chunkCoord, position } from '@nerima-games/mc-kernel'
import { PlayerServiceSnapshotSchema, PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import { TickCountSchema } from '@nerima-games/mc-sim/testing'
import { cellKey, chunkKey, chunkOf } from '../src/domain/in-memory-world.js'
import {
  BALANCE_HARNESS_TICKS_PER_SECOND,
  countPlayerStorageItem,
  makeBalanceGameplayRuntime,
  movePlayer,
  runBalanceHarness,
  setBlockBreakRequest,
  type BalanceMobSpawnRecord,
  type BalanceRecordedDamage,
} from '../scripts/balance/gameplay-harness.js'
import {
  buildBalanceReport,
  formatBalanceTable,
  parseRunArguments,
  renderBalanceReport,
} from '../scripts/balance/run.js'
import {
  type BalanceEventSeries,
  type BalanceObservation,
  type SeedObservations,
  type SeedSimulationResult,
  balanceDayBoundaries,
  observeNight1Death,
} from '../scripts/balance/simulator.js'
import { HOSTILE_KINDS, hostileMobSnapshot } from '../src/domain/entities/mob-frame.js'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat.js'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GameplayEntityRosterSchema,
  restoreGameplayEntityMetadata,
} from '../src/stages/gameplay-owner-registrations.js'

const observedAt = (seconds: number): BalanceObservation => ({
  status: 'observed',
  seconds,
  ticks: seconds * BALANCE_HARNESS_TICKS_PER_SECOND,
})

const unavailableObservation = (reason: string): BalanceObservation => ({ status: 'unavailable', reason })

const observedEvents = (...seconds: ReadonlyArray<number>): BalanceEventSeries => ({
  status: 'observed',
  events: seconds.map((value) => ({ seconds: value, ticks: value * BALANCE_HARNESS_TICKS_PER_SECOND })),
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
  firstNightTick: 480 * BALANCE_HARNESS_TICKS_PER_SECOND,
  firstTwilightTick: 360 * BALANCE_HARNESS_TICKS_PER_SECOND,
  limitations: [],
  terrain: { chunkX: 0, chunkZ: 0, blockTypes: [] },
  observations,
  metricPaths: {
    firstLog: 'actual path exercised',
    woodenPickaxe: 'actual path not exercised for crafting: no crafting stage is registered',
    stoneTool: 'actual path not exercised for crafting: no crafting stage is registered',
    iron: 'actual path not exercised for crafting/smelting; furnace uses advanceFurnace',
  },
  gameplayStageIds: [],
  gameplayTicks: 0,
})

describe('balance simulation runner', () => {
  it('scales night boundary harness ticks with the configured day length', () => {
    const defaultDay = balanceDayBoundaries()
    const doubledDay = balanceDayBoundaries({ ticks: 14_400, dayLengthTicks: 48_000 })

    expect(Math.abs(doubledDay.firstTwilightTick - defaultDay.firstTwilightTick * 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(doubledDay.firstNightTick - defaultDay.firstNightTick * 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(doubledDay.firstNightEndTick - defaultDay.firstNightEndTick * 2)).toBeLessThanOrEqual(1)
    expect(defaultDay.firstNightTick).toBeGreaterThan(60 * BALANCE_HARNESS_TICKS_PER_SECOND)
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
    expect(formatBalanceTable(report)).toContain('actual path not exercised for crafting')
    expect(formatBalanceTable(report)).toContain('actual path not exercised: animal meat drops are unimplemented')
    const table = formatBalanceTable(report)
    expect(table).toContain('| Bed by end of first night | ≤ 380 s | 0 / 2 | unavailable | unknown')
    expect(table).toContain('50% deaths')
    expect(renderBalanceReport(report)).toContain('"schemaVersion": 1')
    expect(renderBalanceReport(report)).toContain('## Summary')
  })

  it('keeps known pre-twilight damage as a target failure and leaves incomplete no-hit runs unknown', () => {
    const diedAfterHostileDamage = simulatedResult(2, observationsFor({
      night1Death: { status: 'unavailable', reason: 'player died before first night' },
      preTwilightDamage: {
        status: 'partial',
        events: [{ seconds: 100, ticks: 100 * BALANCE_HARNESS_TICKS_PER_SECOND, cause: 'hostile' }],
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
        events: [{ seconds: 100, ticks: 100 * BALANCE_HARNESS_TICKS_PER_SECOND, cause: 'starvation' }],
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
    expect(buildBalanceReport([fullyObservedNoDamage], 'exposed').preTwilightDamage).toMatchObject({
      status: 'observed',
      attainment: { measuredCount: 1, unavailableCount: 0, noDamageRatePercent: 100, damageRunRatePercent: 0 },
      completeRunQuantiles: { sampleCount: 1, medianEvents: 0, p90Events: 0 },
    })
  })

  it('counts night deaths only inside the first-night interval', () => {
    const coverage = { firstNight: 4_800, firstNightEnd: 12_000, stagesCovered: true, measurementFailure: undefined }
    expect(observeNight1Death({ ...coverage, deathTick: 4_799 })).toStrictEqual({
      status: 'unavailable',
      reason: 'player died before first night began at tick 4800',
    })
    expect(observeNight1Death({ ...coverage, deathTick: 4_800 })).toStrictEqual({
      status: 'observed',
      died: true,
      deathTicks: 4_800,
    })
    expect(observeNight1Death({ ...coverage, deathTick: 12_000 })).toStrictEqual({
      status: 'observed',
      died: false,
      deathTicks: null,
    })
    expect(observeNight1Death({ ...coverage, deathTick: undefined })).toStrictEqual({
      status: 'observed',
      died: false,
      deathTicks: null,
    })
  })

  it('replays mining and hostile damage deterministically through registered stages on the same harness tick', async () => {
    const target = blockPosition(BlockAxis(0), BlockAxis(1), BlockAxis(0))
    const dirt = Option.getOrThrow(blockIdOf('dirt'))
    const runOneTick = async () => {
      const runtime = await Effect.runPromise(makeBalanceGameplayRuntime({
        blocks: new Map([[cellKey(target), dirt]]),
        loaded: [chunkKey(chunkOf(target))],
      }, {
        feetPosition: position(PositionAxis(0.5), PositionAxis(0), PositionAxis(2.5)),
        yawRadians: 0,
        pitchRadians: 0,
      }, 7))
      const zombie = await Effect.runPromise(runtime.world.entities.spawn({
        kind: ZOMBIE_KIND,
        feetPosition: position(PositionAxis(1.25), PositionAxis(0), PositionAxis(2.5)),
        healthPoints: EntityHealthPoints(20),
        behaviour: hostileMobSnapshot(undefined),
      }))
      await Effect.runPromise(Effect.gen(function* () {
        const owner = yield* runtime.commit.coordinator.snapshot(
          GAMEPLAY_ENTITIES_OWNER_ID,
          GameplayEntityRosterSchema,
        )
        const roster = yield* runtime.world.entities.snapshot
        const entities = restoreGameplayEntityMetadata(roster, owner.state, 'overworld')
        yield* runtime.commit.coordinator.commit({
          expectedRevision: owner.revision,
          expectedDimensions: [],
          changes: [{ ownerId: GAMEPLAY_ENTITIES_OWNER_ID, state: entities }],
        })
      }))
      const result = await runBalanceHarness<{
        before: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>
        block: Effect.Success<ReturnType<typeof runtime.world.chunkStore.getBlock>>
        after: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>
        player: Readonly<{ state: Schema.Schema.Type<typeof PlayerServiceSnapshotSchema> }>
        events: ReadonlyArray<Readonly<{ tick: number; event: unknown }>>
        stageTicks: number
        stageDamages: ReadonlyArray<unknown>
      }>(runtime, 7, Effect.runPromise, (harness) => Effect.gen(function* () {
        const before = yield* runtime.commit.coordinator.snapshot(
          runtime.commit.playerStorageOwnerId,
          PlayerStorageSnapshotSchema,
        )
        yield* setBlockBreakRequest(runtime, target)
        yield* movePlayer(runtime, position(PositionAxis(0.75), PositionAxis(0), PositionAxis(2.5)))
        yield* harness.step(Schema.decodeUnknownSync(TickCountSchema)(1))
        const block = yield* runtime.world.chunkStore.getBlock(target)
        const after = yield* runtime.commit.coordinator.snapshot(
          runtime.commit.playerStorageOwnerId,
          PlayerStorageSnapshotSchema,
        )
        return {
          before: before.state,
          block,
          after: after.state,
          player: yield* runtime.commit.coordinator.snapshot(
            runtime.commit.playerOwnerId,
            PlayerServiceSnapshotSchema,
          ),
          events: yield* Ref.get(runtime.damageEventsByTick),
          stageTicks: yield* Ref.get(runtime.stageTickCount),
          stageDamages: yield* Ref.get(runtime.state.playerDamages),
        }
      }))
      return { result, zombieId: zombie.id, stageIds: runtime.stages.map((stage) => stage.id) }
    }
    const first = await runOneTick()
    const replay = await runOneTick()

    expect(first).toStrictEqual(replay)
    expect(first.result.block).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
    expect(countPlayerStorageItem(first.result.before, 'dirt')).toBe(0)
    expect(countPlayerStorageItem(first.result.after, 'dirt')).toBe(1)
    expect(first.result.player.state.pose.feetPosition.x).toBe(0.75)
    expect(first.result.stageTicks).toBe(1)
    expect(first.result.events).toHaveLength(1)
    expect(first.result.events[0]).toMatchObject({
      tick: 1,
      event: { _tag: 'HostileContact', source: first.zombieId },
    })
    expect(first.result.stageDamages).toHaveLength(1)
    expect(first.stageIds).toHaveLength(8)
    expect(first.stageIds).toContain('gameplay:interactions')
    expect(first.stageIds).toContain('gameplay:entities')
  })

  it('records hostile damage after a natural night spawn with TimeService and candidate-light provenance', async () => {
    const grass = Option.getOrThrow(blockIdOf('grass_block'))
    const blocks = new Map<string, typeof grass>()
    for (let z = -48; z <= 48; z += 1) {
      for (let x = -48; x <= 48; x += 1) {
        blocks.set(cellKey(blockPosition(BlockAxis(x), BlockAxis(63), BlockAxis(z))), grass)
      }
    }
    const loaded = Array.from({ length: 36 }, (_, index) => {
      const z = Math.floor(index / 6) - 3
      const x = (index % 6) - 3
      return chunkKey(chunkCoord(ChunkAxis(x), ChunkAxis(z)))
    })
    const runtime = await Effect.runPromise(makeBalanceGameplayRuntime({ blocks, loaded }, {
      feetPosition: position(PositionAxis(0.5), PositionAxis(64), PositionAxis(0.5)),
      yawRadians: 0,
      pitchRadians: 0,
    }, 7))
    await Effect.runPromise(runtime.world.time.setTimeOfDay(InterpolationFraction(0.8)))
    const result = await runBalanceHarness<{
      spawns: ReadonlyArray<BalanceMobSpawnRecord>
      damage: ReadonlyArray<BalanceRecordedDamage>
    }>(runtime, 7, Effect.runPromise, (harness) => Effect.gen(function* () {
      yield* harness.step(Schema.decodeUnknownSync(TickCountSchema)(300))
      return {
        spawns: yield* Ref.get(runtime.mobSpawnsByTick),
        damage: yield* Ref.get(runtime.damageEventsByTick),
      }
    }))
    const nighttimeHostiles = result.spawns.filter((spawn) =>
      HOSTILE_KINDS.some((kind) => String(kind) === spawn.kind),
    )
    const hostileDamage = result.damage.find((entry) => entry.attacker !== undefined)

    expect(nighttimeHostiles.length).toBeGreaterThan(0)
    expect(['HostileContact', 'Explosion']).toContain(hostileDamage?.event._tag)
    expect(hostileDamage?.attacker).toMatchObject({
      source: expect.any(String),
      mobKind: expect.any(String),
      position: { x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) },
      spawnPosition: { x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) },
      spawnTick: expect.any(Number),
      spawnCandidateBlockLight: { status: 'observed', block: expect.any(Number) },
    })
    expect(Number(hostileDamage?.attacker?.spawnTick)).toBeGreaterThan(0)
    expect(Number(hostileDamage?.attacker?.spawnCandidateBlockLight.status === 'observed'
      ? hostileDamage.attacker.spawnCandidateBlockLight.block
      : Infinity)).toBeLessThanOrEqual(7)
    expect(Number(hostileDamage?.timeService.timeOfDay)).toBeGreaterThan(0.75)
    expect(Number(hostileDamage?.attacker?.spawnTimeService?.timeOfDay)).toBeGreaterThan(0.75)
    expect(hostileDamage?.tick).toBeGreaterThan(hostileDamage?.attacker?.spawnTick ?? Infinity)
  })
})
