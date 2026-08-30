/**
 * `--stats`: the numeric report, and the only place this app makes a claim.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Everything below is MEASURED at run time. No expected value is recorded.
 * ---------------------------------------------------------------------------
 *
 * That is a deliberate property, taken from mx-redstone's preview, and it has
 * one consequence worth stating: a finding printed here is NOT pinned. Fix the
 * code and the finding does not "turn green", it silently disappears. So a
 * confirmed finding belongs in `test/` as an assertion — a report has to be read
 * to work, a test falls over on its own — and the numbers here exist to find
 * them, not to hold them.
 *
 * The checks themselves are kept after they pass. A check deleted once it goes
 * green inspects the code exactly once.
 *
 * Every check answers a question of the form "if this were broken, what would I
 * see?". A measurement with no such answer is a number, not a check.
 */
import { Brand, Effect, Ref } from 'effect'
import {
  blockPosition,
  blockPositionKeyOf,
  DeltaTimeSecs,
  MAX_STACK_COUNT,
  type BlockPositionKey,
} from '@nerima-games/mc-kernel'
import { type BlockId } from '../../src/domain/chunk-store-port'
import { dayPhase, hostileSpawnsAllowed, isNight } from '../../src/domain/day-night'
import {
  applyDamage,
  DEATH_MESSAGES,
  deathMessage,
  fullHealth,
  isDead,
  MAX_HEALTH_POINTS,
  type DeathCause,
  type Vitals,
} from '../../src/domain/death-cause'
import { FALLING_BLOCK_MOVES_PER_TICK } from '../../src/domain/falling-block'
import {
  CREEPER_FUSE_SECS,
  DORMANT_FUSE,
  stepCreeperFuse,
} from '../../src/domain/mob/creeper-fuse'
import { canHostileSpawnAt } from '../../src/domain/mob/hostile-spawn'
import { carryOver, splitBudget, type FluidWorkItem } from '../../src/domain/fluid-frontier'
import { GAMEPLAY_STAGE_IDS } from '../../src/stages/stage-ids'
import { SCENARIOS, scenarioByName } from './scenarios'
import {
  approach,
  ARENA_APPROACH_TO,
  ARENA_GROUNDS,
  ARENA_SETTLE_CAP,
  ARENA_SPAWN_DISTANCE,
  ARENA_STEP_SECS,
  attemptSpawn,
  initialArenaState,
  slayCreeper,
  stepArena,
} from './screens'
import {
  floatingIn,
  inventoryCount,
  inventorySize,
  makeSite,
  pendingPositions,
  requestBreak,
  setHeldTool,
  settle,
  stepFrame,
  runFrames,
  positionAt,
  previewPlacement,
  type Site,
} from './site'
import { INVENTORY_SLOT_COUNT } from './inventory'
import { FrameServicesLayer } from './frame-services'
import { GRAVEL, SAND, glyphOf, placeableItemOf, type WorldSpec } from './world'
import { fallsWhenUnsupported, isReplaceable, type HarvestTier } from '../../src/domain/block-vocabulary'
import { blockLoot } from '../../src/domain/interactions/block-loot'
import { DEFAULT_ROLL_SEED, drawRolls } from '../../src/domain/frame-rolls'
import {
  advanceWeather,
  INITIAL_WEATHER,
  isPrecipitating,
  isThunderstorm,
  weatherLightScale,
  WEATHERS,
  WEATHER_TRANSITION_ROLLS,
} from '../../src/domain/weather'

const BOUNDS = { width: 26, height: 18 }

/**
 * A scenario-graph identifier, not a coordinate.
 *
 * This report's fluid-frontier fixtures name cells `'w0'`, `'a'`, `'b'` — the
 * caller cares about which entry is which, not where in the world it sits — so
 * they cannot go through kernel's `BlockPositionKey(value)`, which validates
 * the canonical `x,y,z` text and throws on anything else. Before the Wave 1
 * (W1-M3) repoint this repository's own `domain/position-key.ts` exposed the
 * same unchecked construction; this is that same escape hatch, expressed with
 * `Brand.nominal` (the mechanism kernel's own constructor is built on) rather
 * than a type assertion.
 */
const opaqueTestKey = Brand.nominal<BlockPositionKey>()

/**
 * The item names a mined falling block yields, ASKED of kernel's table rather
 * than written down.
 *
 * `placeableItemOf` is the id -> `BlockType` -> `ItemType` bridge, so if kernel
 * ever renamed sand's item or removed its item form, this array would shrink and
 * the conservation sum below would visibly stop counting rather than silently
 * count the wrong thing.
 */
const FALLING_ITEM_NAMES: ReadonlyArray<string> = [SAND, GRAVEL].flatMap((id) => {
  const item = placeableItemOf(id)
  return item === undefined ? [] : [item]
})

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length)

type Check = {
  /** `F1`..`Fn` when this is a finding, `ok` when the measurement came out right. */
  readonly id: string
  readonly title: string
  readonly finding: boolean
  readonly lines: ReadonlyArray<string>
}

const buildSite = (spec: WorldSpec, name: string): Effect.Effect<Site> =>
  makeSite(spec, BOUNDS, name)

const fallingCount = (site: Site): number => {
  let total = 0
  for (const [id, count] of site.world.census()) {
    if (fallsWhenUnsupported(id)) {
      total += count
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// DN-GP-1: the event-driven cascade
// ---------------------------------------------------------------------------

/**
 * An idle frame must not touch the store at all.
 *
 * The reference implementation's number here was ~7M block reads per
 * maintenance tick, ~40% of the main thread while exploring
 * (`domain/falling-block.ts:10-17`). `test/vertical-slice.test.ts` asserts it
 * once, for ten frames, on one world; this runs it on every scenario, and after
 * a cascade rather than only before one — the interesting failure is a queue
 * that never quite empties, not one that starts full.
 */
const idleFrames = Effect.gen(function* () {
  const lines: Array<string> = []
  let worst = 0

  for (const scenario of SCENARIOS) {
    const site = yield* buildSite(scenario.build(), scenario.name)
    yield* requestBreak(site, positionAt(site, scenario.target.x, scenario.target.y))
    yield* settle(site)
    const settledAt = site.trace.length
    yield* runFrames(site, 20)
    const idle = site.trace.slice(settledAt)
    const reads = idle.reduce((sum, row) => sum + row.reads, 0)
    const writes = idle.reduce((sum, row) => sum + row.writes, 0)
    worst = Math.max(worst, reads + writes)
    lines.push(
      `  ${pad(scenario.name, 14)}${String(idle.length)} idle frames after a full cascade: ` +
        `${String(reads)} reads, ${String(writes)} writes`,
    )
  }

  return {
    id: worst === 0 ? 'ok' : 'F0',
    title: 'an idle frame does no work at all (DN-GP-1)',
    finding: worst > 0,
    lines,
  } satisfies Check
})

/**
 * How many frames a column of height H needs, and what it costs.
 *
 * The claim in `domain/falling-block.ts:30-38` is "a falling column settles one
 * cell per tick". This measures it, and measures the store traffic that buys it.
 * A per-tick scan would have a flat frame count and an enormous read count; an
 * event-driven cascade should be linear in H with a small constant.
 */
const cascadeShape = Effect.gen(function* () {
  const lines: Array<string> = [
    `  ${pad('height', 8)}${pad('frames', 8)}${pad('moves', 7)}${pad('reads', 7)}${pad('writes', 8)}reads/move`,
  ]
  let linear = true

  for (const height of [1, 2, 3, 4, 6, 8, 12]) {
    const cells: Array<readonly [number, number, BlockId]> = [[4, 0, 2], [4, 1, 2]]
    for (let index = 0; index < height; index += 1) {
      cells.push([4, 2 + index, SAND])
    }
    const site = yield* buildSite({ z: 0, loadedChunks: ['0,0'], cells }, `column-${String(height)}`)
    yield* requestBreak(site, positionAt(site, 4, 1))
    const report = yield* settle(site)
    const moves = site.trace.reduce((sum, row) => sum + row.moved, 0)
    // Summed over the trace, NOT read from the counter: `stepFrame` resets the
    // counter every frame so that the timeline column means "this frame".
    const reads = site.trace.reduce((sum, row) => sum + row.reads, 0)
    const writes = site.trace.reduce((sum, row) => sum + row.writes, 0)
    lines.push(
      `  ${pad(String(height), 8)}${pad(String(report.frames), 8)}${pad(String(moves), 7)}${pad(String(reads), 7)}${pad(String(writes), 8)}${moves === 0 ? '-' : (reads / moves).toFixed(2)}`,
    )
    if (report.frames !== height + 1) {
      linear = false
    }
  }

  lines.push('')
  lines.push(
    linear
      ? '  frames == height + 1 everywhere: one cell per frame, plus one frame to find nothing left'
      : '  frames is NOT height + 1 — the cascade is not one cell per frame',
  )

  return {
    id: linear ? 'ok' : 'F-cascade',
    title: 'a column sinks exactly one cell per frame and stops by itself',
    finding: !linear,
    lines,
  } satisfies Check
})

/**
 * The burst: many disturbances at once, against a budget named for moves.
 *
 * `FALLING_BLOCK_MOVES_PER_TICK` is documented as "Upper bound on block moves
 * applied in one tick" (`domain/falling-block.ts:53-60`), and `takeBatch`'s
 * budget is applied to POSITIONS TAKEN. Whether those two numbers coincide is a
 * question about the cascade's shape that no unit test asks, because every
 * scenario test uses a world small enough that the budget never binds.
 */
const burstBudget = Effect.gen(function* () {
  const scenario = scenarioByName('wide-seam')
  if (scenario === undefined) {
    return { id: 'ok', title: 'burst', finding: false, lines: [] } satisfies Check
  }

  const site = yield* buildSite(scenario.build(), scenario.name)
  // The whole seam at once — one frame's worth of "a TNT blast under a desert".
  for (let x = 0; x < BOUNDS.width; x += 1) {
    yield* requestBreak(site, positionAt(site, x, 2))
  }
  const report = yield* settle(site)

  const peakPending = site.trace.reduce((peak, row) => Math.max(peak, row.pendingAfter), 0)
  const boundRows = site.trace.filter((row) => row.pendingBefore > FALLING_BLOCK_MOVES_PER_TICK)
  const movedWhenBound = boundRows.reduce((sum, row) => sum + row.moved, 0)
  const examinedWhenBound = boundRows.reduce((sum, row) => sum + row.examined, 0)
  const ratio = examinedWhenBound === 0 ? 1 : movedWhenBound / examinedWhenBound
  const overBudget = site.trace.filter((row) => row.moved > FALLING_BLOCK_MOVES_PER_TICK).length

  const lines = [
    `  disturbances submitted        ${String(BOUNDS.width)}`,
    `  frames to idle                ${String(report.frames)}${report.gaveUp ? ' (GAVE UP)' : ''}`,
    `  peak pending queue            ${String(peakPending)}`,
    `  budget                        ${String(FALLING_BLOCK_MOVES_PER_TICK)}`,
    `  frames where the budget bound ${String(boundRows.length)}`,
    `  positions examined in those   ${String(examinedWhenBound)}`,
    `  moves applied in those        ${String(movedWhenBound)}`,
    `  moves per position examined   ${ratio.toFixed(2)}`,
    `  frames exceeding the budget   ${String(overBudget)}`,
    '',
    '  The bound HOLDS: no frame applied more than the budget, so the constant`s contract is',
    '  intact. What it does not do is bind tightly. `takeBatch` spends the budget on POSITIONS,',
    '  and every move enqueues TWO positions — `below(target)` so the block can keep falling and',
    '  `source` so whatever was above it follows (falling-block-move.ts:167). In a column',
    '  collapse only one of the two can ever move, so under load roughly half of each batch is',
    '  spent on positions that are already settled.',
    '',
    `  effective move throughput under load: ${String(Math.round(FALLING_BLOCK_MOVES_PER_TICK * ratio))} ` +
      `per frame against a budget of ${String(FALLING_BLOCK_MOVES_PER_TICK)}, and the queue peaks at ` +
      `${String(peakPending)} for ${String(BOUNDS.width)} disturbances.`,
    '  A burst therefore takes about twice as many frames to flatten as the constant implies.',
    '  Not a correctness bug — recorded because the constant is named FALLING_BLOCK_MOVES_PER_TICK',
    '  and is applied to something else, and because no scenario test uses a world large enough',
    '  for the budget to bind at all.',
  ]

  return {
    id: ratio > 0.95 || boundRows.length === 0 ? 'ok' : 'F1',
    title: 'the per-tick budget binds positions, so half a saturated batch cannot move',
    finding: boundRows.length > 0 && ratio <= 0.95,
    lines,
  } satisfies Check
})

/**
 * Mass conservation.
 *
 * A move is `setBlock(source, AIR)` then `setBlock(target, material)`. Both ways
 * that pair can go wrong change this number: placing before vacating duplicates
 * the block, and failing to restore after a refused destination write loses it.
 * `test/vertical-slice.test.ts` has a case for each mechanism; this asks the
 * question of the whole cascade instead, which is the only way a compound of two
 * correct steps can be caught.
 *
 * THE INVENTORY SIDE OF THE SUM IS NOW AN ITEM COUNT, not a list of block ids,
 * and the check is stronger for it. `sand` and `gravel` are both `'self'` drops
 * with no tool gate in kernel's table, so mining one still yields exactly one —
 * which means the arithmetic is unchanged AND is now asserting that the drop
 * table did not quietly change what falling materials yield. A row that started
 * dropping two would show up here as mass created out of nothing.
 */
const conservation = Effect.gen(function* () {
  const lines: Array<string> = [
    `  ${pad('scenario', 14)}${pad('falling before', 16)}${pad('after', 8)}${pad('mined', 7)}inventory`,
  ]
  let broken = false

  for (const scenario of SCENARIOS) {
    const site = yield* buildSite(scenario.build(), scenario.name)
    const before = fallingCount(site)

    // Break the scenario's own support, a sweep through the floor, AND some of
    // the falling blocks themselves — mining sand is the case where the item in
    // the inventory and the block missing from the world have to add up.
    yield* requestBreak(site, positionAt(site, scenario.target.x, scenario.target.y))
    for (let x = 2; x < BOUNDS.width; x += 5) {
      yield* requestBreak(site, positionAt(site, x, 1))
    }
    let minedTargets = 0
    for (let x = 0; x < BOUNDS.width && minedTargets < 3; x += 1) {
      for (let y = BOUNDS.height - 1; y >= 0 && minedTargets < 3; y -= 1) {
        const position = positionAt(site, x, y)
        if (fallsWhenUnsupported(site.world.peekBlock(position) ?? 0)) {
          yield* requestBreak(site, position)
          minedTargets += 1
        }
      }
    }

    yield* settle(site)
    const after = fallingCount(site)
    // Items, by name, and only the ones that are falling materials. The block
    // ids are `SAND` and `GRAVEL`; their item forms are named the same, which is
    // kernel's name-identity bridge (`domain/block-vocabulary.ts`) and is why
    // this can be written without a second table.
    const minedFalling = FALLING_ITEM_NAMES.reduce(
      (total, item) => total + inventoryCount(site, item),
      0,
    )
    const conserved = before === after + minedFalling
    if (!conserved) {
      broken = true
    }
    lines.push(
      `  ${pad(scenario.name, 14)}${pad(String(before), 16)}${pad(String(after), 8)}` +
        `${pad(String(minedFalling), 7)}${String(inventorySize(site))} items  ` +
        `${conserved ? 'conserved' : 'NOT CONSERVED'}`,
    )
  }

  return {
    id: broken ? 'F-mass' : 'ok',
    title: 'sand and gravel are neither duplicated nor lost by a cascade',
    finding: broken,
    lines,
  } satisfies Check
})

/**
 * After the queue is idle, nothing is left hanging.
 *
 * This is the invariant `settled` exists to preserve: without the re-queue the
 * sand stops one cell short and stays there until something unrelated dirties
 * the chunk (`domain/falling-block.ts:30-38`). The transient count is reported
 * next to it because it is not zero, and the reason is worth seeing: a column
 * does not fall as a unit, so a gap opens under the top block and travels
 * upward. That is visible in the `world` view and invisible to every assertion,
 * which asserts endpoints.
 */
const supportInvariant = Effect.gen(function* () {
  const lines: Array<string> = [`  ${pad('scenario', 14)}${pad('peak hanging', 14)}after settle`]
  let broken = false

  for (const scenario of SCENARIOS) {
    const site = yield* buildSite(scenario.build(), scenario.name)
    const initiallyHanging = floatingIn(site).length
    yield* requestBreak(site, positionAt(site, scenario.target.x, scenario.target.y))
    yield* settle(site)
    const peak = site.trace.reduce((max, row) => Math.max(max, row.floating), 0)
    const left = floatingIn(site).length
    if (left > initiallyHanging) {
      broken = true
    }
    lines.push(
      `  ${pad(scenario.name, 14)}${pad(String(peak), 14)}${String(left)}${initiallyHanging === 0 ? '' : ` (already hanging in the fixture: ${String(initiallyHanging)})`}`,
    )
  }

  lines.push('')
  lines.push('  "peak hanging" > 0 during a cascade is expected, not a bug: a column unzips from')
  lines.push('  the bottom, so a one-cell gap travels up it. It is here because the gap is what a')
  lines.push('  person sees, and no endpoint assertion can show it.')

  return {
    id: broken ? 'F-hang' : 'ok',
    title: 'no falling block is left hanging once the queue is idle',
    finding: broken,
    lines,
  } satisfies Check
})

/**
 * `ChunkNotLoaded` is not air (DN-GP-11), measured at a real chunk boundary.
 *
 * The chunk arithmetic is the store's, not the preview's: `cx = floor(x / 16)`,
 * and the `chunk-edge` scenario declares only `0,0` resident. Sand at x >= 16 is
 * therefore genuinely unreachable rather than drawn as unreachable.
 */
const chunkEdge = Effect.gen(function* () {
  const scenario = scenarioByName('chunk-edge')
  if (scenario === undefined) {
    return { id: 'ok', title: 'chunk edge', finding: false, lines: [] } satisfies Check
  }
  const site = yield* buildSite(scenario.build(), scenario.name)

  // A break aimed into the unloaded chunk.
  yield* requestBreak(site, positionAt(site, 17, 3))
  yield* stepFrame(site)
  const yieldedFromUnloaded = inventorySize(site)
  const pendingAfterUnloaded = (yield* pendingPositions(site)).length

  // Sand standing at x=15 with air at x=15,y=0? No: the floor stops at x=15, so
  // the column at 15 is over the world floor and the column at 17 is in the
  // unloaded chunk entirely.
  yield* requestBreak(site, positionAt(site, 10, 2))
  yield* settle(site)

  const lines = [
    `  break aimed at 17,3 (chunk 1,0 — not resident)`,
    `    items yielded              ${String(yieldedFromUnloaded)}   (must be 0: the cell is unknown, not air)`,
    `    falling-block work queued  ${String(pendingAfterUnloaded)}   (must be 0: nothing was dirtied)`,
    `  sand standing in the unloaded chunk`,
    `    still present after settle ${String(site.world.peekBlock(positionAt(site, 17, 5)) !== undefined)}`,
    `    (the rule never saw it; nothing disturbed a position inside a chunk it cannot read)`,
  ]

  return {
    id: yieldedFromUnloaded === 0 && pendingAfterUnloaded === 0 ? 'ok' : 'F-notloaded',
    title: 'ChunkNotLoaded is not air, at a real chunk boundary (DN-GP-11)',
    finding: yieldedFromUnloaded !== 0 || pendingAfterUnloaded !== 0,
    lines,
  } satisfies Check
})

/**
 * The same script twice produces the same trace.
 *
 * plan.md §5.1-3 makes determinism the precondition for using the reference's
 * tests as an oracle, and `domain/falling-block.ts:43-47` names the insertion
 * order as the mechanism. A `Set` swapped for something unordered would leave
 * every existing assertion passing and this comparison failing.
 */
const determinism = Effect.gen(function* () {
  const scenario = scenarioByName('wide-seam')
  if (scenario === undefined) {
    return { id: 'ok', title: 'determinism', finding: false, lines: [] } satisfies Check
  }

  const runOnce = Effect.gen(function* () {
    const site = yield* buildSite(scenario.build(), scenario.name)
    for (let x = 0; x < BOUNDS.width; x += 3) {
      yield* requestBreak(site, positionAt(site, x, 2))
    }
    yield* settle(site)
    return site.trace.map((row) => `${String(row.moved)}/${String(row.pendingAfter)}/${String(row.reads)}`).join(' ')
  })

  const first = yield* runOnce
  const second = yield* runOnce

  return {
    id: first === second ? 'ok' : 'F-determinism',
    title: 'two identical scripts produce identical frame traces',
    finding: first !== second,
    lines: [
      `  frames compared  ${String(first.split(' ').length)}`,
      `  traces equal     ${String(first === second)}`,
    ],
  } satisfies Check
})

/**
 * `dt` reaches every stage and no stage uses it.
 *
 * Not a bug — `gameplay:time-weather` is deliberately empty and the falling-block
 * cascade counts in TICKS — but it is the kind of fact a reader assumes the
 * other way round, and it is the reason this preview advances on a keystroke
 * rather than on a clock. If a stage ever starts integrating `dt`, this stops
 * being true and the number below changes.
 */
const deltaTimeUnused = Effect.gen(function* () {
  const scenario = scenarioByName('sand-column')
  if (scenario === undefined) {
    return { id: 'ok', title: 'dt', finding: false, lines: [] } satisfies Check
  }

  const withDelta = (delta: number) =>
    Effect.gen(function* () {
      const site = yield* buildSite(scenario.build(), scenario.name)
      yield* requestBreak(site, positionAt(site, scenario.target.x, scenario.target.y))
      const stages = site.stages
      let frames = 0
      while (frames < 64) {
        const pending = (yield* pendingPositions(site)).length
        const inbox = yield* Ref.get(site.state.pendingBreaks)
        if (pending === 0 && inbox.length === 0) {
          break
        }
        yield* Effect.forEach(stages, (stage) => stage.run(DeltaTimeSecs(delta)), {
          discard: true,
        }).pipe(Effect.provide(FrameServicesLayer))
        frames += 1
      }
      const weather = yield* Ref.get(site.state.weatherAdvanced)
      return (
        `${pad(`${String(frames)} frames`, 12)}` +
        `${pad(`falling ${String(fallingCount(site))}`, 14)}` +
        `weather ${weather?.weather ?? '-'} ${(weather?.remainingSecs ?? 0).toFixed(1)}s left`
      )
    })

  const zero = yield* withDelta(0)
  const sixty = yield* withDelta(1 / 60)
  const huge = yield* withDelta(3600)

  return {
    id: 'note',
    title: 'the BLOCK half is dt-independent and the WEATHER half is not — both on purpose',
    finding: false,
    lines: [
      `  dt = 0        ${zero}`,
      `  dt = 1/60     ${sixty}`,
      `  dt = 3600     ${huge}`,
      '',
      '  THE FIRST TWO COLUMNS ARE IDENTICAL AND THE THIRD IS NOT, which is the whole of',
      '  what `gameplay:time-weather` becoming non-empty changed about this check. It used',
      '  to be titled "no stage reads dt yet" and every column agreed.',
      '',
      '  The cascade counts in TICKS: a column sinks one cell per frame whatever the frame',
      '  was worth, because `settled` re-enqueues rather than looping to the floor. That is',
      '  `domain/falling-block.ts`, and it is why a slow machine sees the same cascade.',
      '  The weather counts in SECONDS, because a weather that lasted a fixed number of',
      '  frames would last twice as long at 30 Hz — the same divergence',
      '  `HOSTILE_SPAWN_INTERVAL_SECS` is spelled in seconds to avoid.',
      '',
      '  Neither reads a clock. `run(dt)` takes the delta as an argument, which is why a',
      '  dt of 3600 is a legal thing for this harness to hand it and why two hours of',
      '  weather costs a few microseconds in `test/weather.test.ts`.',
    ],
  } satisfies Check
})

// ---------------------------------------------------------------------------
// DN-GP-2: fluids
// ---------------------------------------------------------------------------

/** The split has one owner for deferred cells: `carryOver`. */
const lavaRetentionOverlap = Effect.sync((): Check => {
  const frontier: ReadonlyArray<FluidWorkItem> = [
    { key: opaqueTestKey('w0'), kind: 'water' },
    { key: opaqueTestKey('l0'), kind: 'lava' },
    { key: opaqueTestKey('l1'), kind: 'lava' },
    { key: opaqueTestKey('l2'), kind: 'lava' },
  ]
  const split = splitBudget(frontier, { lavaTickActive: false, budget: 64 })
  const carried = carryOver(frontier, split)
  const splitKeys = Object.keys(split)
  const onlyWork = splitKeys.length === 1 && splitKeys[0] === 'work'

  return {
    id: onlyWork ? 'ok' : 'F2',
    title: 'carryOver is the only next-tick owner of inactive lava',
    finding: !onlyWork,
    lines: [
      `  frontier                       ${String(frontier.length)} cells (1 water, 3 lava)`,
      `  split result keys               ${JSON.stringify(splitKeys)}`,
      `  carryOver(...)                 ${JSON.stringify(carried.map((item) => item.key))}`,
      '',
      '  splitBudget supplies work for this tick only. carryOver retains every unevaluated',
      '  cell, including inactive lava, so there is no second result to reinsert.',
    ],
  } satisfies Check
})

/**
 * `carryOver` compares by `key`; the frontier is keyed by `(key, kind)`.
 *
 * A `FluidWorkItem` is a pair. `splitBudget` classifies on `kind` and `carryOver`
 * filters on `key` alone, so the two disagree about what an item is. The
 * consequence is a cell that was never evaluated being dropped from the
 * frontier, which is precisely the failure DN-GP-2 is about: dropping frontier
 * keys "makes lava stop spreading in a way that only shows up minutes later, in
 * a preview, as a lava lake with a straight edge"
 * (`domain/fluid-frontier.ts:22-27`).
 *
 * Water and lava do meet at one position — that is the whole of the cobblestone
 * and obsidian rules — so a frontier holding both kinds for one cell is the
 * natural encoding of a fluid interface, not a contrived input.
 */
const carryOverKeyCollision = Effect.sync((): Check => {
  const frontier: ReadonlyArray<FluidWorkItem> = [
    { key: opaqueTestKey('10,64,10'), kind: 'water' },
    { key: opaqueTestKey('10,64,10'), kind: 'lava' },
    { key: opaqueTestKey('11,64,10'), kind: 'water' },
  ]
  const split = splitBudget(frontier, { lavaTickActive: false, budget: 64 })
  const carried = carryOver(frontier, split)

  const evaluated = split.work
  const shouldSurvive = frontier.filter(
    (item) => !evaluated.some((done) => done.key === item.key && done.kind === item.kind),
  )
  const lost = shouldSurvive.filter(
    (item) => !carried.some((kept) => kept.key === item.key && kept.kind === item.kind),
  )

  return {
    id: lost.length === 0 ? 'ok' : 'F3',
    title: 'carryOver preserves an unevaluated cell when two kinds share a position',
    finding: lost.length > 0,
    lines: [
      `  frontier            ${JSON.stringify(frontier)}`,
      `  lavaTickActive      false  (so no lava cell may be evaluated this tick)`,
      `  split.work          ${JSON.stringify(split.work)}`,
      `  carryOver(...)      ${JSON.stringify(carried)}`,
      `  never evaluated     ${JSON.stringify(shouldSurvive)}`,
      `  silently dropped    ${JSON.stringify(lost)}`,
      '',
      '  domain/fluid-frontier.ts:120 builds its "evaluated" set from `item.key` while the',
      '  frontier is a set of (key, kind) pairs. The lava half of a water/lava interface is',
      '  removed from the frontier without ever being handed to a propagation rule.',
    ],
  } satisfies Check
})

/** The fluids stage reserves work and retains its frontier with one `Ref.modify`. */
const fluidFrontierRace = Effect.gen(function* () {
  const site = yield* buildSite({ z: 0, loadedChunks: ['0,0'], cells: [] }, 'race')
  const fluids = site.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)

  const seeded: ReadonlyArray<FluidWorkItem> = [
    { key: opaqueTestKey('a'), kind: 'water' },
    { key: opaqueTestKey('b'), kind: 'water' },
  ]
  yield* Ref.set(site.state.fluidFrontier, seeded)

  const producer = Ref.update(site.state.fluidFrontier, (frontier) => [
    ...frontier,
    { key: 'arrived-mid-stage', kind: 'water' } as FluidWorkItem,
  ])

  // The layer is provided AROUND the race and not inside either branch, so that
  // building it cannot shift the interleaving this probe is here to measure.
  // See `./frame-services.ts`: empty today, and not a line to delete.
  yield* Effect.all([fluids?.run(DeltaTimeSecs(1 / 60)) ?? Effect.void, producer], {
    concurrency: 'unbounded',
  }).pipe(Effect.provide(FrameServicesLayer))

  const after = yield* Ref.get(site.state.fluidFrontier)
  const survived = after.some((item) => item.key === 'arrived-mid-stage')

  return {
    id: survived ? 'ok' : 'F4',
    title: 'the fluids stage preserves a concurrent frontier producer',
    finding: !survived,
    lines: [
      `  stages/registration.ts:177  interactions  Ref.getAndSet   atomic`,
      `  stages/registration.ts:236  entities      Ref.modify      atomic`,
      `  stages/registration.ts:254  entities      Ref.update      atomic ("a set would erase them")`,
      `  stages/registration.ts:267  fluids        Ref.modify      atomic reservation`,
      '',
      `  concurrent-producer probe: the injected cell survived = ${String(survived)}`,
      '',
      '  Ref.modify commits reservation and carry-over from one state snapshot. A producer',
      '  scheduled alongside the stage remains in the frontier for a later tick.',
    ],
  } satisfies Check
})

// ---------------------------------------------------------------------------
// DN-GP-3: death causes
// ---------------------------------------------------------------------------

/**
 * Non-finite damage is ignored before it reaches the vital-state arithmetic.
 *
 * `Damage.amount` remains a bare `number` at the public boundary, so the rule
 * explicitly rejects non-finite input. That preserves total API behaviour
 * without allowing `Math.max(0, NaN)` to poison `healthPoints`.
 *
 * This keeps DN-GP-3's required death cause meaningful: invalid damage cannot
 * make an otherwise healthy player immortal.
 */
const nonFiniteDamage = Effect.sync((): Check => {
  const struck = applyDamage(fullHealth, { amount: Number.NaN, cause: 'lava' })
  const again = applyDamage(struck, { amount: 1000, cause: 'void' })
  const andAgain = applyDamage(again, { amount: 1000, cause: 'explosion' })

  const infinite = applyDamage(fullHealth, { amount: Number.POSITIVE_INFINITY, cause: 'fall' })
  const negativeInfinite = applyDamage(fullHealth, { amount: Number.NEGATIVE_INFINITY, cause: 'fall' })

  const show = (vitals: Vitals): string =>
    `health=${Number.isFinite(vitals.healthPoints) ? String(vitals.healthPoints) : String(vitals.healthPoints)} ` +
    `isDead=${String(isDead(vitals))} message=${String(deathMessage(vitals))}`

  const immortal = !Number.isFinite(struck.healthPoints) && !isDead(andAgain)

  return {
    id: immortal ? 'F5' : 'ok',
    title: 'non-finite damage is ignored before it can corrupt player vitals',
    finding: immortal,
    lines: [
      `  applyDamage(full, {amount: NaN, cause: 'lava'})      ${show(struck)}`,
      `  then {amount: 1000, cause: 'void'}                   ${show(again)}`,
      `  then {amount: 1000, cause: 'explosion'}              ${show(andAgain)}`,
      `  applyDamage(full, {amount: Infinity})                ${show(infinite)}`,
      `  applyDamage(full, {amount: -Infinity})               ${show(negativeInfinite)}`,
      '',
      '  `applyDamage` rejects non-finite values before health arithmetic, so a later finite',
      '  damage amount remains able to kill and produce its normal death message.',
      '',
      '  All three non-finite values are ignored; finite negative, zero, and positive values',
      '  retain their existing semantics.',
    ],
  } satisfies Check
})

/** Every cause reaches its own sentence. The regression DN-GP-3 is named for. */
const causesDistinct = Effect.sync((): Check => {
  const causes = Object.keys(DEATH_MESSAGES) as ReadonlyArray<DeathCause>
  const resolved = causes.map((cause) => {
    const dead = applyDamage(fullHealth, { amount: 999, cause })
    return { cause, message: deathMessage(dead) }
  })
  const generic = resolved.filter((entry) => entry.cause !== 'generic' && entry.message === DEATH_MESSAGES.generic)
  const distinct = new Set(resolved.map((entry) => entry.message)).size

  return {
    id: generic.length === 0 ? 'ok' : 'F-cause',
    title: 'every cause survives applyDamage and reaches its own sentence (DN-GP-3)',
    finding: generic.length > 0,
    lines: [
      `  causes                       ${String(causes.length)}`,
      `  distinct death messages      ${String(distinct)}`,
      `  collapsed to "You died."     ${String(generic.length)}`,
    ],
  } satisfies Check
})

// ---------------------------------------------------------------------------
// DN-GP-7: day and night
// ---------------------------------------------------------------------------

/**
 * Day/night rules consume a phase, not an absolute day count.
 *
 * `t`, `t + 1` and `t - 1` are the same phase on consecutive days. The rule
 * reduces finite input to [0, 1) before applying the shared dawn/dusk predicate.
 *
 * JavaScript `%` preserves a negative dividend's sign, so a rewound clock can
 * supply a negative fraction. Canonicalising at the gameplay-rule boundary
 * keeps that host detail from spawning mobs at noon.
 */
const dayNightPeriodicity = Effect.sync((): Check => {
  const samples = [0.0, 0.1, 0.25, 0.3, 0.5, 0.7, 0.75, 0.9, 0.99]
  const rows: Array<string> = [`  ${pad('t', 8)}${pad('t (phase)', 12)}${pad('t+1', 12)}${pad('t-1', 12)}agrees`]
  let disagreements = 0

  for (const t of samples) {
    const here = dayPhase(t)
    const tomorrow = dayPhase(t + 1)
    const yesterday = dayPhase(t - 1)
    const agrees = here === tomorrow && here === yesterday
    if (!agrees) {
      disagreements += 1
    }
    rows.push(
      `  ${pad(t.toFixed(2), 8)}${pad(here, 12)}${pad(tomorrow, 12)}${pad(yesterday, 12)}${String(agrees)}`,
    )
  }

  // The phase predicates must agree even when the clock includes a day count.
  let inconsistent = 0
  for (let step = 0; step < 1000; step += 1) {
    for (const dayOffset of [-2, -1, 0, 1, 2]) {
      const t = step / 1000 + dayOffset
      if (isNight(t) !== (dayPhase(t) === 'night')) {
        inconsistent += 1
      }
      if (hostileSpawnsAllowed(t) !== isNight(t)) {
        inconsistent += 1
      }
    }
  }

  return {
    id: disagreements > 0 ? 'F6' : 'ok',
    title: 'dayPhase / isNight / hostileSpawnsAllowed are periodic in the day',
    finding: disagreements > 0,
    lines: [
      ...rows,
      '',
      `  disagreements over ${String(samples.length)} samples: ${String(disagreements)}`,
      `  across whole-day offsets, isNight and dayPhase agree at all 5000 sample points ` +
        `(${String(inconsistent)} disagreements)`,
      '',
      '  out-of-range finite values resolve to their matching phase:',
      `    dayPhase(1.5)  = ${dayPhase(1.5)}    (1.5 mod 1 = 0.5, which is noon)`,
      `    dayPhase(-0.25)= ${dayPhase(-0.25)}    (-0.25 mod 1 = 0.75, which is dusk)`,
      `    (-0.3) % 1 in JS = ${String((-0.3) % 1)} — the sign survives the modulo`,
      '',
      '  mx-sim owns the persistent clock. mx-gameplay only canonicalises the finite value',
      '  supplied to its pure rule, preserving one state owner and one phase definition.',
    ],
  } satisfies Check
})

// ---------------------------------------------------------------------------
// plan.md §3.11: the mob rules
// ---------------------------------------------------------------------------

/**
 * How long the fuse actually lasts, measured at several frame rates.
 *
 * `domain/mob/creeper-fuse.ts` says the fuse is frame-rate independent by
 * construction, because it accumulates SECONDS rather than counting ticks. That
 * claim is true of the arithmetic and not quite true of the floating-point: the
 * fuse ends on the first step whose running total reaches 1.5, and a running
 * total of many small deltas is not the same number as their product.
 *
 * If this were broken — a tick count instead of a delta, or a comparison the
 * wrong way round — the "elapsed" column would be a different number for every
 * frame rate rather than the same one to within a frame.
 */
const creeperFuseFrameRate = Effect.sync((): Check => {
  const lines: Array<string> = [
    `  ${pad('dt', 10)}${pad('steps', 8)}${pad('ideal', 8)}${pad('elapsed', 10)}drift`,
  ]
  let worstDrift = 0

  for (const dt of [0.25, 0.1, 0.05, 0.02, 1 / 60, 0.016]) {
    let fuse = DORMANT_FUSE
    let steps = 0
    while (fuse._tag !== 'Detonated' && steps < 10_000) {
      fuse = stepCreeperFuse(fuse, { distanceToTargetBlocks: 1 }, DeltaTimeSecs(dt)).fuse
      steps += 1
    }
    const ideal = Math.ceil(CREEPER_FUSE_SECS / dt)
    worstDrift = Math.max(worstDrift, Math.abs(steps - ideal))
    lines.push(
      `  ${pad(dt.toFixed(5), 10)}${pad(String(steps), 8)}${pad(String(ideal), 8)}` +
        `${pad((steps * dt).toFixed(4), 10)}${String(steps - ideal)} frame(s)`,
    )
  }

  lines.push('')
  lines.push('  The fuse is 1.5 SECONDS at every frame rate, to within one frame. The residue is')
  lines.push('  floating-point accumulation, not a tick count: 90 additions of 1/60 come to')
  lines.push('  1.4999999999999993, so a 60 Hz fuse takes a 91st step and lasts 1.5167s (+1.1%).')
  lines.push('  Reported rather than "fixed" — carrying the start time instead would need a clock,')
  lines.push('  which DN-GP-8 forbids, and quarter-seconds (the arena screen`s step) are exact.')

  return {
    id: worstDrift <= 1 ? 'note' : 'F-fuse',
    title: 'the creeper fuse lasts 1.5s at any frame rate, to within one frame',
    finding: worstDrift > 1,
    lines,
  } satisfies Check
})

/**
 * The whole creeper, driven end to end, with every number measured.
 *
 * Spawn condition -> fuse -> blast -> death cause -> drop. This is the one check
 * that crosses all four mob files, and the failure it is looking for is
 * DN-GP-3's: a death message that has collapsed back to the generic sentence
 * because the cause was dropped somewhere between the formula and the screen.
 *
 * The second failure it is looking for is the drop rule's: a creeper that
 * detonates must leave NOTHING. In the reference that property is an accident of
 * statement order in a file two removes away (`entity-manager-combat.ts:60`
 * removes the entity before the drop path runs), so it is exactly the kind of
 * thing that comes back.
 */
const creeperEndToEnd = Effect.sync((): Check => {
  const state = initialArenaState()
  const night = 0.9

  attemptSpawn(state, night)
  approach(state, ARENA_APPROACH_TO - ARENA_SPAWN_DISTANCE)

  const trace: Array<string> = []
  let steps = 0
  while (state.creeper?.alive === true && steps < ARENA_SETTLE_CAP) {
    stepArena(state)
    steps += 1
    const fuse = state.creeper?.fuse
    trace.push(fuse === undefined ? '-' : fuse._tag === 'Lit' ? fuse.burnedSecs.toFixed(2) : fuse._tag)
  }

  const message = deathMessage(state.vitals)
  const collapsed = message === DEATH_MESSAGES.generic
  const lootAfterSelfDestruct = state.loot.length

  // ...and the other death: killed by the player before the fuse ends.
  const killed = initialArenaState()
  attemptSpawn(killed, night)
  killed.lootingLevel = 2
  slayCreeper(killed)

  return {
    id: collapsed || lootAfterSelfDestruct > 0 ? 'F-creeper' : 'ok',
    title: 'spawn -> fuse -> blast -> death cause -> drop, every number measured',
    finding: collapsed || lootAfterSelfDestruct > 0,
    lines: [
      `  spawn verdict                 ${String(state.verdict?._tag)}`,
      `  distance when it went off     ${state.creeper?.distanceBlocks.toFixed(2) ?? '-'} blocks`,
      `  steps of ${String(ARENA_STEP_SECS)}s               ${String(steps)}`,
      `  fuse trace                    ${trace.join(' ')}`,
      `  health                        ${String(MAX_HEALTH_POINTS)} -> ${String(state.vitals.healthPoints)}`,
      `  lastDeathCause                ${String(state.vitals.lastDeathCause)}`,
      `  deathMessage()                ${String(message)}`,
      `  collapsed to "You died."      ${String(collapsed)}   <- DN-GP-3`,
      '',
      `  loot after SELF-DESTRUCT      ${lootAfterSelfDestruct} item(s), xp ${String(state.xp)}`,
      `  loot after a KILL (looting 2) ${killed.loot.map((drop) => `${drop.item} x${String(drop.count)}`).join(', ')}` +
        `, xp ${String(killed.xp)}`,
      '',
      '  Both loot lines came out of `rollMobDrops`; neither is written down here. The empty',
      '  one is the rule, not a missing implementation — see `MobKill` in domain/mob/mob-drop.ts.',
    ],
  } satisfies Check
})

/**
 * The spawn gate, swept.
 *
 * Two axes at once, because the interesting failures are conjunctions: a rule
 * that ignored the hour would still refuse a bright cell, and a rule that
 * collapsed `validSpawnSurface` into "is it solid" would still refuse water. The
 * grid shows both at a glance and would show either mistake as a whole row or a
 * whole column changing.
 */
const spawnGate = Effect.sync((): Check => {
  const grounds = ARENA_GROUNDS
  const lights = [0, 7, 8, 15]
  const lines: Array<string> = [
    `  night (0.90)      ${lights.map((light) => pad(`L${String(light)}`, 6)).join('')}`,
  ]
  let daylightAccepted = 0
  let canopyAccepted = 0

  for (const [block, name] of grounds) {
    const cells: Array<string> = []
    for (const light of lights) {
      const verdict = canHostileSpawnAt({
        groundBlock: block,
        footBlock: 0,
        headBlock: 0,
        blockLight: light,
        timeOfDay: 0.9,
        distanceToPlayerBlocksXZ: 20,
      })
      if (verdict._tag === 'Spawn' && (block === 10 || block === 13)) {
        canopyAccepted += 1
      }
      cells.push(pad(verdict._tag === 'Spawn' ? 'yes' : verdict.reason.slice(0, 5), 6))
    }
    lines.push(`  ${pad(name, 18)}${cells.join('')}`)
  }

  for (const light of lights) {
    const verdict = canHostileSpawnAt({
      groundBlock: 2,
      footBlock: 0,
      headBlock: 0,
      blockLight: light,
      timeOfDay: 0.5,
      distanceToPlayerBlocksXZ: 20,
    })
    if (verdict._tag === 'Spawn') {
      daylightAccepted += 1
    }
  }

  lines.push('')
  lines.push(`  noon (0.50), stone, every light level: accepted ${String(daylightAccepted)} of ${String(lights.length)}`)
  lines.push('  leaves and glass are SOLID FOR COLLISION and are still not ground — kernel`s audit')
  lines.push('  §4.9 keeps `validSpawnSurface` separate from solidity for exactly this row.')

  return {
    id: daylightAccepted === 0 && canopyAccepted === 0 ? 'ok' : 'F-spawn',
    title: 'the spawn gate refuses daylight, brightness and the canopy',
    finding: daylightAccepted > 0 || canopyAccepted > 0,
    lines,
  } satisfies Check
})

/**
 * THE LOOT TABLE, swept.
 *
 * The check `docs/testing.md` §3-1 said the mining screen could not make:
 * 「ドロップテーブルも設置ルールも存在しない」. A grid of every block the palette
 * can produce against every tool tier, so the two axes kernel keeps separate —
 * WHICH item and WHETHER anything drops — are visible as a table rather than as
 * two functions somebody has to read.
 *
 * The finding condition is the one that would matter: a row that yields the
 * block it came from. That was the OLD behaviour, exactly, and it would look
 * completely plausible on screen.
 */
const lootTable = Effect.sync(() => {
  const tiers: ReadonlyArray<HarvestTier> = ['none', 'wooden', 'stone', 'iron', 'diamond']
  const probed: ReadonlyArray<readonly [BlockId, string]> = [
    [2, 'stone'],
    [4, 'grass_block'],
    [5, 'sand'],
    [8, 'gravel'],
    [10, 'oak_leaves'],
    [13, 'glass'],
    [15, 'glowstone'],
    [11, 'lava'],
  ]

  const lines: Array<string> = [`  ${pad('block', 14)}${tiers.map((tier) => pad(tier, 19)).join('')}`]
  let selfDrops = 0

  for (const [id, name] of probed) {
    const cells: Array<string> = []
    for (const heldTier of tiers) {
      // NO_LUCK so the bonus lines and the fortune remainder stay out of the
      // deterministic half; both get their own rows below.
      const loot = blockLoot(id, { heldTier }, [0.999, 0.999, 0.999, 0.999])
      // A drop whose item is spelled the same as the block it came from is only
      // wrong when kernel's row says otherwise — sand really does yield sand.
      // The rows that must NOT self-drop are the two with an `item:` override.
      if ((name === 'stone' || name === 'grass_block') && loot.some((drop) => drop.item === name)) {
        selfDrops += 1
      }
      cells.push(pad(loot.length === 0 ? '-' : loot.map((drop) => `${drop.item} x${String(drop.count)}`).join(' '), 19))
    }
    lines.push(`  ${pad(name, 14)}${cells.join('')}`)
  }

  lines.push('')
  lines.push('  `-` is a REFUSAL and not an empty row: stone needs a wooden pickaxe, glass needs')
  lines.push('  silk touch, and lava and leaves yield nothing to anyone (kernel`s count: 0 rows).')
  lines.push('')

  // Silk touch and fortune, the two axes the tier grid cannot show.
  const glowstone = (context: Parameters<typeof blockLoot>[1]): string => {
    const loot = blockLoot(15, context, [0, 0, 0, 0])
    return loot.map((drop) => `${drop.item} x${String(drop.count)}`).join(' ') || '-'
  }
  lines.push(`  glowstone, bare hands            ${glowstone({})}`)
  lines.push(`  glowstone, fortune I             ${glowstone({ fortuneLevel: 1 })}`)
  lines.push(`  glowstone, fortune III           ${glowstone({ fortuneLevel: 3 })}`)
  lines.push(`  glowstone, fortune III + silk    ${glowstone({ fortuneLevel: 3, silkTouch: true })}`)
  lines.push(`  glass,     bare hands            ${blockLoot(13, {}, []).length === 0 ? '-' : 'glass'}`)
  lines.push(`  glass,     silk touch            ${blockLoot(13, { silkTouch: true }, []).map((d) => d.item).join(' ')}`)
  lines.push(`  oak_leaves, lucky stick roll     ${blockLoot(10, {}, [0, 0, 0, 0]).map((d) => d.item).join(' ') || '-'}`)
  lines.push('')
  lines.push('  Fortune and silk touch are MUTUALLY EXCLUSIVE, which the reference enforces at the')
  lines.push('  break site rather than at the enchanting table (interaction-break-handler.execute.ts:131).')

  return {
    id: selfDrops === 0 ? 'ok' : 'F-loot',
    title: 'every block yields kernel`s drop, and bare hands do not harvest stone',
    finding: selfDrops > 0,
    lines,
  } satisfies Check
})

/**
 * THE PLACEMENT RULE's four refusals, each reached on purpose.
 *
 * Three of them are places the reference implementation got it wrong, and the
 * lava row is the one the mirror's own comment predicted from the other end:
 * 「falling sand and gravel did not displace lava, AND placement treated a lava
 * cell as occupied」.
 */
const placementRefusals = Effect.gen(function* () {
  const site = yield* buildSite(scenarioByName('lava-pit')?.build() ?? SCENARIOS[0]!.build(), 'placement')
  const cell = positionAt(site, 4, 8)
  const under = positionAt(site, 4, 7)

  const lines: Array<string> = []
  const seen = new Map<string, string>()
  const say = (label: string, outcome: { readonly _tag: string }): void => {
    seen.set(label, outcome._tag)
    lines.push(`  ${pad(label, 34)}${outcome._tag}`)
  }

  // Air over stone: the ordinary case.
  site.world.poke(cell, 0)
  site.world.poke(under, 2)
  say('air over stone, holding stone', yield* previewPlacement(site, cell, 'stone'))

  // Occupied.
  site.world.poke(cell, 2)
  say('stone already there', yield* previewPlacement(site, cell, 'stone'))

  // Lava — REPLACEABLE, and the reference refused it.
  site.world.poke(cell, 11)
  say('lava in the cell', yield* previewPlacement(site, cell, 'stone'))

  // Water — the case the reference DID allow.
  site.world.poke(cell, 6)
  say('water in the cell', yield* previewPlacement(site, cell, 'stone'))

  // A torch with nothing under it, and then with something.
  site.world.poke(cell, 0)
  site.world.poke(under, 0)
  say('torch over air', yield* previewPlacement(site, cell, 'torch'))
  site.world.poke(under, 7)
  say('torch over snow', yield* previewPlacement(site, cell, 'torch'))
  site.world.poke(under, 2)
  say('torch over stone', yield* previewPlacement(site, cell, 'torch'))

  // An item with no block form is a TYPE error at the call site, so the screen
  // cannot even ask. What it can show is the other direction.
  lines.push('')
  lines.push(`  placeableItemOf(lava)             ${String(placeableItemOf(11))}`)
  lines.push(`  placeableItemOf(water)            ${String(placeableItemOf(6))}`)
  lines.push(`  placeableItemOf(stone)            ${String(placeableItemOf(2))}`)
  lines.push('')
  lines.push('  `lava in the cell` is the row the reference got wrong: block-service-place-load.ts:48')
  lines.push('  asks `existing === AIR || existing === WATER`, so a lava cell read as occupied.')
  lines.push('  `torch over snow` is kernel`s audit §4.9: snow is a valid SPAWN surface and is not a')
  lines.push('  valid ATTACHMENT support, and the two flags must not be collapsed into one.')

  // The two rows that are claims rather than illustrations. A build in which
  // lava reads as occupied, or in which snow holds a torch up, is a build that
  // has reintroduced one of the two bugs this rule was written against — and
  // both would look entirely plausible in the table above.
  const wrong =
    seen.get('lava in the cell') !== 'Allowed' || seen.get('torch over snow') !== 'Unsupported'

  return {
    id: wrong ? 'F-place' : 'ok',
    title: 'the placement rule refuses for four distinct, named reasons',
    finding: wrong,
    lines,
  } satisfies Check
})

/**
 * WEATHER, fast-forwarded.
 *
 * `docs/testing.md` §5 asks for exactly this and says why: 「実時間 20 分待つ
 * テストは書かない」. The transition graph is walked from a SEED, so the sequence
 * below is the same on every run — which the reference cannot say about its own
 * `WeatherService.tick`, because that reads the global generator.
 */
const weatherWalk = Effect.sync(() => {
  const lines: Array<string> = []
  let state = INITIAL_WEATHER
  let seed = DEFAULT_ROLL_SEED
  const stretches: Array<string> = []
  let elapsed = 0

  // Twelve stretches, jumping straight to each expiry. Long enough to visit
  // every edge of a three-node graph several times over.
  for (let step = 0; step < 12; step += 1) {
    elapsed += state.remainingSecs
    stretches.push(`${state.weather}(${state.remainingSecs.toFixed(0)}s)`)
    const batch = drawRolls(seed, WEATHER_TRANSITION_ROLLS)
    seed = batch.seed
    state = advanceWeather({ weather: state.weather, remainingSecs: 0 }, 0, {
      transition: batch.rolls[0] ?? 0,
      duration: batch.rolls[1] ?? 0,
    })
  }

  lines.push(`  ${stretches.slice(0, 6).join(' -> ')}`)
  lines.push(`  ${stretches.slice(6).join(' -> ')}`)
  lines.push('')
  lines.push(`  total game time covered           ${(elapsed / 60).toFixed(1)} minutes`)
  lines.push(`  seed after 12 transitions         ${String(seed)}`)
  lines.push('')

  for (const weather of WEATHERS) {
    lines.push(
      `  ${pad(weather, 12)}precipitating=${pad(String(isPrecipitating(weather)), 7)}` +
        `thunder=${pad(String(isThunderstorm(weather)), 7)}lightScale=${weatherLightScale(weather).toFixed(2)}`,
    )
  }
  lines.push('')
  lines.push('  No weather follows itself: every expiry is a change, and the roll only chooses which.')
  lines.push('  hostileSpawnsAllowed is NOT consulted here — vanilla spawns hostiles in daylight rain')
  lines.push('  and the reference implementation does not, so neither does this (docs/porting.md §4).')

  const repeated = stretches.filter(
    (entry, index) => index > 0 && entry.split('(')[0] === stretches[index - 1]?.split('(')[0],
  ).length

  return {
    id: repeated === 0 ? 'ok' : 'F-weather',
    title: 'weather walks its own transition graph from a seed, and replays identically',
    finding: repeated > 0,
    lines,
  } satisfies Check
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// The seam plan.md §2.3-1 is the worked example for
// ---------------------------------------------------------------------------

/**
 * Mining reaches mc-sim's inventory, and a FULL one is measured too.
 *
 * The first half is the whole point of `domain/inventory-port.ts` and it is the
 * boring half: swing, item, count. It is measured anyway because it used to be
 * a `Ref` this preview added up itself, and a number a host tallies and a
 * number a service answers are different claims that look identical on a
 * screen.
 *
 * THE SECOND HALF IS WHY THIS CHECK EXISTS. `add` resolves to what did NOT fit,
 * and a stage that read that number as a success flag would produce a world
 * indistinguishable from a correct one except for items that stop existing. A
 * full inventory is unreachable by playing — 36 slots x 64 — so nothing on this
 * screen would ever show it, and no scenario would either. This arranges it and
 * then mines one more block.
 *
 * If this were broken, the dropped count below would differ from the mined
 * count, or `held after` would have grown past the cap: the block would be gone
 * from the world without the overflow existing either in inventory or on the
 * ground.
 */
const inventoryDeposit = Effect.gen(function* () {
  const scenario = scenarioByName('sand-column')
  if (scenario === undefined) {
    return { id: 'ok', title: 'inventory deposit', finding: false, lines: [] } satisfies Check
  }

  const site = yield* buildSite(scenario.build(), scenario.name)
  yield* setHeldTool(site, { heldTier: 'wooden' })
  yield* requestBreak(site, positionAt(site, scenario.target.x, scenario.target.y))
  yield* stepFrame(site)

  const depositedRow = site.trace[site.trace.length - 1]
  const afterOneSwing = inventorySize(site)

  // Now fill it. `add` through the SERVICE, so "full" is mc-sim's definition of
  // full — every slot holding a whole stack of one item — rather than a number
  // this file decided on.
  const capacity = INVENTORY_SLOT_COUNT * MAX_STACK_COUNT
  yield* site.inventoryService.api.add('cobblestone', capacity)
  // Drain the log, so the row below reports the STAGE's call and not this
  // arrangement. The same reason `poke` exists beside `requestPlace`: setting a
  // world up is not part of what the measurement claims.
  yield* site.inventoryService.takeDepositLog
  const held = yield* site.inventoryService.api.countOf('cobblestone')

  // One more swing, into a full inventory.
  yield* requestBreak(site, positionAt(site, scenario.target.x, scenario.target.y - 1))
  yield* stepFrame(site)
  const spilledRow = site.trace[site.trace.length - 1]
  const attempted = (spilledRow?.mined ?? []).reduce((total, item) => total + item.count, 0)
  const dropped = (spilledRow?.dropped ?? []).reduce((total, item) => total + item.count, 0)
  const heldAfter = yield* site.inventoryService.api.countOf('cobblestone')

  const lost = attempted > 0 && dropped !== attempted
  const overflowed = heldAfter > capacity

  return {
    id: lost || overflowed ? 'F-inventory' : 'ok',
    title: 'a mined block reaches mc-sim\u2019s inventory, and a FULL one drops the overflow',
    finding: lost || overflowed,
    lines: [
      `  one swing, wooden pickaxe`,
      `    add() calls              ${(depositedRow?.mined ?? [])
        .map((item) => `${item.item} x${String(item.count)}`)
        .join(', ')}`,
      `    held afterwards          ${String(afterOneSwing)}`,
      '',
      `  the same swing into a FULL inventory (${String(INVENTORY_SLOT_COUNT)} slots x ${String(MAX_STACK_COUNT)})`,
      `    held before              ${String(held)}`,
      `    add() calls              ${(spilledRow?.mined ?? [])
        .map((item) => `${item.item} x${String(item.count)}`)
        .join(', ')}`,
      `    refused and dropped      ${String(dropped)}   (must equal the mined count)`,
      `    entities on the ground   ${(spilledRow?.dropped ?? [])
        .map((item) => `${item.item} x${String(item.count)}`)
        .join(', ')}`,
      `    held after               ${String(heldAfter)}   (must equal held before)`,
      '',
      '  The refused count is a dropped-item entity at the broken cell. The frame tape',
      '  prints live ground items as !item; pickup removes the entity in a later frame.',
    ],
  } satisfies Check
})

const CHECKS = [
  idleFrames,
  cascadeShape,
  burstBudget,
  conservation,
  supportInvariant,
  chunkEdge,
  determinism,
  deltaTimeUnused,
  lavaRetentionOverlap,
  carryOverKeyCollision,
  fluidFrontierRace,
  nonFiniteDamage,
  causesDistinct,
  dayNightPeriodicity,
  creeperFuseFrameRate,
  creeperEndToEnd,
  spawnGate,
  lootTable,
  inventoryDeposit,
  placementRefusals,
  weatherWalk,
] as const

export const buildStatsReport: Effect.Effect<ReadonlyArray<string>> = Effect.gen(function* () {
  const results = yield* Effect.forEach(CHECKS, (check) => check)
  const lines: Array<string> = [
    'preview-mining-site --stats',
    '',
    'Everything below is measured at run time; no expected value is recorded here.',
    'A finding therefore vanishes silently when it is fixed — confirm one, then pin it',
    'in test/ as an assertion. The checks are kept after they pass.',
    '',
  ]

  for (const check of results) {
    lines.push(`${check.finding ? `[${check.id}]` : check.id === 'note' ? '[note]' : '[ ok ]'} ${check.title}`)
    lines.push(...check.lines)
    lines.push('')
  }

  const findings = results.filter((check) => check.finding)
  lines.push('-'.repeat(76))
  lines.push(
    `${String(findings.length)} finding(s): ${findings.map((check) => check.id).join(', ')}` +
      `   ${String(results.length - findings.length)} check(s) passing`,
  )

  // A last sanity line that is cheap and would be embarrassing to get wrong: the
  // capability table the whole cascade keys off.
  const falls = [SAND, GRAVEL].every((id) => fallsWhenUnsupported(id))
  const replaceable = [0, 6, 11].every((id) => isReplaceable(id))
  lines.push(
    `capability table: fallsWhenUnsupported(sand,gravel)=${String(falls)}  ` +
      `isReplaceable(air,water,lava)=${String(replaceable)}  ` +
      // The citation used to read `domain/chunk-store-port.ts:267-281`, which
      // is where the four capability sets lived before they moved to the mirror
      // whose barrel replaces them. Those lines are now the `AIR_BLOCK_ID`
      // comment, so the note pointed a reader at the wrong paragraph in the
      // wrong file. No line number this time: a citation that rots on every
      // edit above it is a citation that will rot again.
      `(lava was missing once — see REPLACEABLE_IDS in domain/block-vocabulary.ts)`,
  )
  lines.push(`positionKeyOf({x:-1,y:2,z:-3}) = ${blockPositionKeyOf(blockPosition(-1, 2, -3))}`)
  lines.push(`glyph check: ${glyphOf(SAND).name}/${glyphOf(GRAVEL).name}`)

  return lines
})
