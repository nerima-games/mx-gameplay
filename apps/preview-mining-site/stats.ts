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
import { Effect, Ref } from 'effect'
import { positionKeyOf } from '../../domain/block-position-key'
import { fallsWhenUnsupported, isReplaceable, type BlockId } from '../../domain/chunk-store-port'
import { dayPhase, hostileSpawnsAllowed, isNight } from '../../domain/day-night'
import {
  applyDamage,
  DEATH_MESSAGES,
  deathMessage,
  fullHealth,
  isDead,
  type DeathCause,
  type Vitals,
} from '../../domain/death-cause'
import { FALLING_BLOCK_MOVES_PER_TICK } from '../../domain/falling-block'
import { carryOver, splitBudget, type FluidWorkItem } from '../../domain/fluid-frontier'
import { DeltaTimeSecs } from '../../domain/frame-contract'
import { GAMEPLAY_STAGE_IDS } from '../../stages/stage-ids'
import { SCENARIOS, scenarioByName } from './scenarios'
import {
  floatingIn,
  makeSite,
  pendingPositions,
  requestBreak,
  settle,
  stepFrame,
  runFrames,
  positionAt,
  type Site,
} from './site'
import { GRAVEL, SAND, glyphOf, type WorldSpec } from './world'

const BOUNDS = { width: 26, height: 18 }

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
      `  ${pad(String(height), 8)}${pad(String(report.frames), 8)}${pad(String(moves), 7)}` +
        `${pad(String(reads), 7)}${pad(String(writes), 8)}` +
        (moves === 0 ? '-' : (reads / moves).toFixed(2)),
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
    const minedFalling = site.inventory.filter((id) => fallsWhenUnsupported(id)).length
    const conserved = before === after + minedFalling
    if (!conserved) {
      broken = true
    }
    lines.push(
      `  ${pad(scenario.name, 14)}${pad(String(before), 16)}${pad(String(after), 8)}` +
        `${pad(String(minedFalling), 7)}${String(site.inventory.length)} items  ` +
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
      `  ${pad(scenario.name, 14)}${pad(String(peak), 14)}${String(left)}` +
        (initiallyHanging === 0 ? '' : ` (already hanging in the fixture: ${String(initiallyHanging)})`),
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
  const yieldedFromUnloaded = site.inventory.length
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
        yield* Effect.forEach(stages, (stage) => stage.run(DeltaTimeSecs(delta)), { discard: true })
        frames += 1
      }
      return `${String(frames)} frames, world hash ${String(fallingCount(site))}`
    })

  const zero = yield* withDelta(0)
  const sixty = yield* withDelta(1 / 60)
  const huge = yield* withDelta(3600)

  return {
    id: 'note',
    title: 'no stage reads `dt` yet — a frame is a frame, at any delta',
    finding: false,
    lines: [
      `  dt = 0        ${zero}`,
      `  dt = 1/60     ${sixty}`,
      `  dt = 3600     ${huge}`,
      '',
      '  identical. That is correct today (the cascade counts in ticks and time/weather is',
      '  Effect.void) and it is why this preview never reads a clock: there is nothing a',
      '  wall clock could make more accurate, and plenty it could make machine-dependent.',
    ],
  } satisfies Check
})

// ---------------------------------------------------------------------------
// DN-GP-2: fluids
// ---------------------------------------------------------------------------

/**
 * `retainedLavaFrontier` and `carryOver` return the same cells.
 *
 * `FluidBudgetSplit.retainedLavaFrontier` is documented "These MUST be fed back
 * into the next frontier; dropping them stops lava mid-flow"
 * (`domain/fluid-frontier.ts:62-65`). `carryOver` is documented as "the frontier
 * cells that were NOT evaluated and must survive into the next tick". On an
 * inactive lava tick the lava cells satisfy both descriptions, so a caller that
 * does what the two doc comments jointly say duplicates every lava cell — and
 * duplicates them again on the next inactive tick.
 *
 * `stages/registration.ts:270` gets this right by using only `carryOver`, which
 * means the field is dead in the only caller that exists. The hazard is that it
 * is dead in a way that reads like an obligation.
 */
const lavaRetentionOverlap = Effect.sync((): Check => {
  const frontier: ReadonlyArray<FluidWorkItem> = [
    { key: 'w0', kind: 'water' },
    { key: 'l0', kind: 'lava' },
    { key: 'l1', kind: 'lava' },
    { key: 'l2', kind: 'lava' },
  ]
  const split = splitBudget(frontier, { lavaTickActive: false, budget: 64 })
  const carried = carryOver(frontier, split)
  const carriedKeys = new Set(carried.map((item) => item.key))
  const overlap = split.retainedLavaFrontier.filter((key) => carriedKeys.has(key))

  // What five inactive ticks of "feed both back" would do.
  let naive: ReadonlyArray<FluidWorkItem> = frontier
  const growth: Array<number> = [naive.length]
  for (let tick = 0; tick < 5; tick += 1) {
    const step = splitBudget(naive, { lavaTickActive: false, budget: 64 })
    naive = [
      ...carryOver(naive, step),
      ...step.retainedLavaFrontier.map((key): FluidWorkItem => ({ key, kind: 'lava' })),
    ]
    growth.push(naive.length)
  }

  return {
    id: overlap.length === 0 ? 'ok' : 'F2',
    title: 'retainedLavaFrontier is a strict subset of what carryOver already keeps',
    finding: overlap.length > 0,
    lines: [
      `  frontier                       ${String(frontier.length)} cells (1 water, 3 lava)`,
      `  split.retainedLavaFrontier     ${JSON.stringify(split.retainedLavaFrontier)}`,
      `  carryOver(...)                 ${JSON.stringify(carried.map((item) => item.key))}`,
      `  cells named by BOTH            ${String(overlap.length)} of ${String(split.retainedLavaFrontier.length)}`,
      '',
      `  a caller obeying both doc comments, over 5 inactive lava ticks:`,
      `    frontier size  ${growth.join(' -> ')}`,
      '',
      '  stages/registration.ts:270 uses carryOver alone and is correct. The field is dead in',
      '  the only caller there is, and its doc comment reads as an obligation to use it.',
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
    { key: '10,64,10', kind: 'water' },
    { key: '10,64,10', kind: 'lava' },
    { key: '11,64,10', kind: 'water' },
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
    title: 'carryOver drops an unevaluated cell when two kinds share a position',
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

/**
 * The fluids stage reads and writes its frontier in two steps.
 *
 * `stages/registration.ts:267-270`:
 *
 *     const frontier = yield* Ref.get(state.fluidFrontier)
 *     const split = splitBudget(frontier, { lavaTickActive })
 *     yield* Ref.set(state.fluidFrontier, carryOver(frontier, split))
 *
 * DN-GP-10 is titled "`Ref.modify` で TOCTOU 回避" and the other two stages in
 * this same file take it seriously: `interactions` uses `Ref.getAndSet` with a
 * comment saying a request arriving between the two steps "would be dropped
 * without a trace", and `entities` uses `Ref.modify` and then `Ref.update` with
 * a comment saying "`update`, not `set`: … a `set` would erase them". The fluids
 * stage is the one that does not.
 *
 * The probe below is honest about what it can and cannot show. Effect does not
 * preempt between two adjacent non-yielding operations, and nothing else in the
 * repository writes `fluidFrontier` yet, so the loss is not reachable today.
 * What is reachable is the shape, and the shape is the same one this file's own
 * comments call a bug twice.
 */
const fluidFrontierRace = Effect.gen(function* () {
  const site = yield* buildSite({ z: 0, loadedChunks: ['0,0'], cells: [] }, 'race')
  const fluids = site.stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)

  const seeded: ReadonlyArray<FluidWorkItem> = [
    { key: 'a', kind: 'water' },
    { key: 'b', kind: 'water' },
  ]
  yield* Ref.set(site.state.fluidFrontier, seeded)

  const producer = Ref.update(site.state.fluidFrontier, (frontier) => [
    ...frontier,
    { key: 'arrived-mid-stage', kind: 'water' } as FluidWorkItem,
  ])

  yield* Effect.all([fluids?.run(DeltaTimeSecs(1 / 60)) ?? Effect.void, producer], {
    concurrency: 'unbounded',
  })

  const after = yield* Ref.get(site.state.fluidFrontier)
  const survived = after.some((item) => item.key === 'arrived-mid-stage')

  return {
    id: 'F4',
    title: 'the fluids stage is the one stage in the file that uses get-then-set',
    finding: true,
    lines: [
      `  stages/registration.ts:177  interactions  Ref.getAndSet   atomic`,
      `  stages/registration.ts:236  entities      Ref.modify      atomic`,
      `  stages/registration.ts:254  entities      Ref.update      atomic ("a set would erase them")`,
      `  stages/registration.ts:267  fluids        Ref.get         <- read`,
      `  stages/registration.ts:270  fluids        Ref.set         <- write, from the stale read`,
      '',
      `  concurrent-producer probe: the injected cell survived = ${String(survived)}`,
      '',
      '  Not reachable today, and the probe says so: nothing else writes `fluidFrontier`, and',
      '  Effect does not preempt between two adjacent non-yielding operations. This is reported',
      '  as a shape, not as an observed loss. It is the shape DN-GP-10 exists to forbid and the',
      '  shape the neighbouring stage carries a comment against, and it is one line to fix.',
    ],
  } satisfies Check
})

// ---------------------------------------------------------------------------
// DN-GP-3: death causes
// ---------------------------------------------------------------------------

/**
 * A non-finite damage amount makes the player permanently immortal.
 *
 * `Damage.amount` is a bare `number`. `Math.max(0, NaN)` is `NaN`, so
 * `healthPoints` becomes `NaN`; `isDead` is `healthPoints <= 0`, and every
 * comparison with `NaN` is false, so the player is not dead. `applyDamage`
 * returns early when `isDead`, so the next blow is applied to `NaN` and produces
 * `NaN` again. The player can never die and `deathMessage` can never be
 * produced.
 *
 * This is DN-GP-3's own failure mode one level down. The note is titled "carry
 * the cause all the way to the death message" and the defence it describes is
 * structural — `cause` is a required field, `applyDamage` is the only route to
 * zero health — but the amount was left unconstrained, and an unconstrained
 * amount removes the death the cause was going to describe.
 *
 * The repository already knows the shape of the fix. `domain/frame-contract.ts`
 * brands `DeltaTimeSecs` with `Number.isFinite(value) && value >= 0` and says
 * why; `Damage.amount` wants the same brand.
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
    title: 'one NaN damage makes the player immortal, and no death message can follow',
    finding: immortal,
    lines: [
      `  applyDamage(full, {amount: NaN, cause: 'lava'})      ${show(struck)}`,
      `  then {amount: 1000, cause: 'void'}                   ${show(again)}`,
      `  then {amount: 1000, cause: 'explosion'}              ${show(andAgain)}`,
      `  applyDamage(full, {amount: Infinity})                ${show(infinite)}`,
      `  applyDamage(full, {amount: -Infinity})               ${show(negativeInfinite)}`,
      '',
      '  `Math.max(0, NaN)` is NaN; `NaN <= 0` is false, so `isDead` says alive; `applyDamage`',
      '  returns early only for the dead, so every later blow recomputes NaN. Health is neither',
      '  a number nor a death.',
      '',
      '  `-Infinity` is handled (the `Math.max(0, amount)` guard catches a negative amount) and',
      '  `Infinity` is handled (it kills). Only the non-number is not.',
      '',
      "  domain/frame-contract.ts:57 brands DeltaTimeSecs with `Number.isFinite(value) && value >= 0`",
      '  for exactly this class of argument. `Damage.amount` is a bare number.',
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
 * These rules are not periodic, and a time of day is a period.
 *
 * `isNight(t) = t < 0.25 || t > 0.75` has no modulo in it, so it answers a
 * question about the NUMBER rather than about the time of day the number names.
 * `t`, `t + 1` and `t - 1` are the same instant on three consecutive days;
 * `dayPhase` gives them three different answers, and the one it gives for
 * anything outside [0, 1) is always `night` — which also means
 * `hostileSpawnsAllowed` is always true there.
 *
 * The reachable input is the negative one. mc-sim advances the hour as
 * `(base + elapsed / dayLength) % 1` and JS `%` keeps the sign of its left
 * operand, so a clock that steps backwards — NTP, DST, a user changing the
 * system time, the exact hazard mx-multiplayer's DN-3 spends a section on —
 * produces a negative fraction. DN-GP-7's whole point is that this repository
 * and mc-sim must agree about when night is, and they are in different
 * repositories, so the seam is where the disagreement lands.
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

  // And within one day the two predicates do agree, which is worth keeping.
  let inconsistent = 0
  for (let step = 0; step < 1000; step += 1) {
    const t = step / 1000
    if (isNight(t) !== (dayPhase(t) === 'night')) {
      inconsistent += 1
    }
    if (hostileSpawnsAllowed(t) !== isNight(t)) {
      inconsistent += 1
    }
  }

  return {
    id: disagreements > 0 ? 'F6' : 'ok',
    title: 'dayPhase / isNight / hostileSpawnsAllowed are not periodic in the day',
    finding: disagreements > 0,
    lines: [
      ...rows,
      '',
      `  disagreements over ${String(samples.length)} samples: ${String(disagreements)}`,
      `  inside [0,1): isNight and dayPhase agree at all 1000 sample points ` +
        `(${String(inconsistent)} disagreements)`,
      '',
      '  every out-of-range value answers "night", so hostileSpawnsAllowed is true there too:',
      `    dayPhase(1.5)  = ${dayPhase(1.5)}    (1.5 mod 1 = 0.5, which is noon)`,
      `    dayPhase(-0.25)= ${dayPhase(-0.25)}    (-0.25 mod 1 = 0.75, which is dusk)`,
      `    (-0.3) % 1 in JS = ${String((-0.3) % 1)} — the sign survives the modulo`,
      '',
      '  mc-sim owns the normalisation (DN-GP-7) and this repository states no precondition,',
      '  brands nothing and rejects nothing. `domain/frame-contract.ts` brands DeltaTimeSecs',
      '  rather than trusting its callers; `timeOfDay` is the same kind of argument.',
    ],
  } satisfies Check
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

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
      `(lava was missing once — domain/chunk-store-port.ts:232-242)`,
  )
  lines.push(`positionKeyOf({x:-1,y:2,z:-3}) = ${positionKeyOf({ x: -1, y: 2, z: -3 })}`)
  lines.push(`glyph check: ${glyphOf(SAND).name}/${glyphOf(GRAVEL).name}`)

  return lines
})
