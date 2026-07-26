/**
 * `apps/preview-mining-site` — the built-in gameplay sandbox.
 *
 * plan.md §3.11 asks this repository for 「ルール単位のシナリオテスト + プレビュー3本
 * （採掘場: 掘る/置く/ドロップ確認、Mobアリーナ: スポーンさせて対峙、時間スライダー:
 * 昼夜/天候）」, and plan.md §6 Step 2 makes both halves the completion criterion:
 * tests green AND the built-in preview operable. This is the second half.
 * plan.md §4.1 requires it to live with the thing it verifies, so it is a dev
 * application INSIDE mx-gameplay: not a package, not part of `index.ts`, and not
 * something a consumer can import.
 *
 * ---------------------------------------------------------------------------
 * Three previews, one app, and one of them is honestly empty
 * ---------------------------------------------------------------------------
 *
 * `g` cycles three screens, one per preview plan.md names:
 *
 *   site   the mining site. REAL: it drives `gameplayStages` against a real
 *          `ChunkStoreApi`, and every block that moves was moved by
 *          `domain/entities/falling-block-move.ts`.
 *   time   the time slider. REAL as a rule driver: `domain/day-night.ts` is four
 *          total functions and the slider sweeps their argument. It does NOT
 *          advance time — mc-sim owns the hour (DN-GP-7) and
 *          `gameplay:time-weather` is `Effect.void`.
 *   arena  the mob arena. THERE IS NO MOB, and the screen says so as its first
 *          line. It lists what is missing and where it would go, then drives the
 *          part of the arena that does exist: `domain/death-cause.ts`.
 *
 * The alternative was to draw an arena with two sprites in it. mx-ui's preview
 * refused the same offer for its inventory screen, and for the same reason: a
 * drawn arena would make a gap look like progress, and the completion table in
 * docs/testing.md §3 would acquire a tick nobody could cash.
 *
 * ---------------------------------------------------------------------------
 * Why this renders in a terminal
 * ---------------------------------------------------------------------------
 *
 * `docs/testing.md` §3-1 originally specified `mc-playground-kit` as a
 * devDependency for all three previews. That is still the right home for a
 * first-person preview — mc-sim's obstacle course cannot be anything else. It is
 * the wrong home for these, for three reasons:
 *
 *  1. Nothing is published yet (plan.md §6 Step 3 is bottom-up
 *     publish-then-pin). A preview that cannot be run is not a completion
 *     criterion, it is a plan to have one.
 *  2. Everything plan.md asks these previews to make visible is a NUMBER
 *     ATTACHED TO A COORDINATE, or a number attached to an instant: which cell
 *     is queued, how many store reads a frame cost, how many ticks a cascade
 *     took, what phase 0.31 is. A camera adds nothing to any of them and takes
 *     away the ability to see the whole column and the whole queue at once.
 *     mc-worldgen's terrain preview made this argument first and mx-redstone's
 *     circuit board sharpened it.
 *  3. `tsconfig.base.json` omits "DOM" from `lib`, so a browser type does not
 *     typecheck anywhere in this repository. A 3D preview would need that lib
 *     back in some tsconfig, converting a mechanical guarantee into a promise.
 *
 * What is lost is real: this preview cannot show you a player standing in the
 * world, because there is no player. It shows the world and the rules, which is
 * what this repository owns.
 *
 * ---------------------------------------------------------------------------
 * Constraints this app is written under
 * ---------------------------------------------------------------------------
 *
 *  - `apps` is in `SCAN_ROOTS` (`scripts/check-dependency-whitelist.ts:262`), so
 *    the preview's imports are gated like any other source here. It imports this
 *    repository's own modules and `effect`, and nothing else — no org package,
 *    no new npm dependency, not even a colour library.
 *  - The `Date.now()` / `new Date()` / `performance.now()` ban applies. It is
 *    satisfied without an escape hatch: there is no clock read anywhere in this
 *    app. A frame advances on a keystroke, and `run(dt)` takes its delta as an
 *    argument for precisely that reason. `mc-kernel-allow-time-source` is not
 *    taken. mx-redstone declined it too, on the grounds that a wall-clock-driven
 *    preview shows a different circuit on a faster machine; here it would show a
 *    different cascade.
 *  - `pnpm verify` does not run this app. `tsconfig.preview.json` typechecks it
 *    and `pnpm lint` lints it; `pnpm preview` is not a gate.
 */
import { Effect } from 'effect'
import { ANSI_STYLE, PLAIN_STYLE, type Style } from './ansi'
import { buildHelp, buildHud, buildLegend, buildNotes, HUD_ROWS, type HudState } from './hud'
import { parseArguments, SCENARIO_LIST, USAGE, type PreviewOptions } from './options'
import {
  contentRows,
  isClipped,
  renderArenaScreen,
  renderQueue,
  renderTimeScreen,
  renderTimeline,
  renderWorld,
  SCREENS,
  VIEW_MODES,
  type ScreenName,
  type ViewMode,
} from './render'
import {
  approach,
  ARENA_AMOUNTS,
  ARENA_APPROACH_TO,
  ARENA_CAUSES,
  ARENA_SETTLE_CAP,
  ARENA_SPAWN_DISTANCE,
  attemptSpawn,
  cycleGround,
  cycleLight,
  cycleLooting,
  initialArenaState,
  initialTimeState,
  nudgeSpawnDistance,
  nudgeTime,
  respawn,
  slayCreeper,
  stepArena,
  strike,
  TIME_STEP,
  TIME_STEP_COARSE,
  type ArenaState,
  type TimeState,
} from './screens'
import { DEFAULT_SCENARIO, SCENARIOS, type Scenario } from './scenarios'
import { buildStatsReport } from './stats'
import {
  makeSite,
  pendingPositions,
  positionAt,
  pokeBlock,
  requestBreak,
  runFrames,
  settle,
  stepFrame,
  type Site,
} from './site'
import { BLOCKS } from './world'
import {
  enterFullScreen,
  isInteractive,
  leaveFullScreen,
  onExit,
  onInputEnd,
  onKey,
  onResize,
  paintFrame,
  guardBrokenPipe,
  screenSize,
  writeLine,
} from './terminal'
import type { BlockId } from '../../domain/chunk-store-port'
import type { PositionKey } from '../../domain/position-key'

const BOUNDS = { width: 26, height: 18 }

type State = {
  site: Site
  scenarioIndex: number
  screen: ScreenName
  view: ViewMode
  cursor: { x: number; y: number }
  palette: BlockId
  time: TimeState
  arena: ArenaState
  showHelp: boolean
  /** Cached each redraw so the renderers stay pure functions. */
  pending: ReadonlyArray<PositionKey>
}

const scenarioAt = (index: number): Scenario => {
  const wrapped = ((index % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length
  const scenario = SCENARIOS[wrapped]
  if (scenario === undefined) {
    throw new Error('preview-mining-site: SCENARIOS is empty')
  }
  return scenario
}

const loadScenario = (state: State, index: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    const wrapped = ((index % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length
    const scenario = scenarioAt(wrapped)
    state.scenarioIndex = wrapped
    state.site = yield* makeSite(
      scenario.build(),
      { width: Math.max(BOUNDS.width, scenario.minWidth), height: Math.max(BOUNDS.height, scenario.minHeight) },
      scenario.name,
    )
    state.cursor = { x: scenario.target.x, y: scenario.target.y }
    state.site.note = scenario.title
    state.pending = yield* pendingPositions(state.site)
  })

const refresh = (state: State): Effect.Effect<void> =>
  Effect.map(pendingPositions(state.site), (pending) => {
    state.pending = pending
  })

const frameSize = (options: PreviewOptions): { readonly columns: number; readonly rows: number } => {
  const screen = screenSize()
  return {
    columns: Math.max(30, options.frameWidth ?? screen.columns),
    rows: Math.max(8, (options.frameHeight ?? screen.rows) - HUD_ROWS - 2),
  }
}

const render = (state: State, options: PreviewOptions, style: Style): ReadonlyArray<string> => {
  if (state.showHelp) {
    return buildHelp(style)
  }

  const frame = frameSize(options)
  const columns = frame.columns
  const rows =
    options.once && state.screen === 'site' && state.view === 'world'
      ? Math.min(frame.rows, contentRows(state.site) + 1)
      : frame.rows

  const body =
    state.screen === 'time'
      ? renderTimeScreen(state.time, style, columns)
      : state.screen === 'arena'
        ? // The arena reads the TIME screen's hour rather than keeping one of
          // its own: the spawn rule gates on `hostileSpawnsAllowed`, and two
          // answers to "what time is it" is the mistake DN-GP-7 records.
          renderArenaScreen(state.arena, state.time.timeOfDay, style, columns)
        : state.view === 'queue'
          ? renderQueue(state.site, state.pending, style, rows)
          : state.view === 'timeline'
            ? renderTimeline(state.site, style, rows)
            : renderWorld(state.site, state.cursor, new Set(state.pending), style, columns, rows)

  const hud: HudState = {
    screen: state.screen,
    view: state.view,
    cursor: state.cursor,
    palette: state.palette,
    runFrames: options.runFrames,
    clipped:
      state.screen === 'site' && state.view === 'world'
        ? isClipped(state.site, columns, frame.rows)
        : false,
  }

  return [...body, '', ...buildHud(hud, state.site, style)]
}

const clampCursor = (state: State): void => {
  state.cursor = {
    x: Math.min(Math.max(state.cursor.x, 0), state.site.bounds.width - 1),
    y: Math.min(Math.max(state.cursor.y, 0), state.site.bounds.height - 1),
  }
}

const move = (state: State, dx: number, dy: number): void => {
  state.cursor = { x: state.cursor.x + dx, y: state.cursor.y + dy }
  clampCursor(state)
}

const cycle = <A>(values: ReadonlyArray<A>, current: A, fallback: A): A =>
  values[(values.indexOf(current) + 1) % values.length] ?? fallback

/** Returns false when the key means "quit". */
const handleKey = (state: State, key: string, options: PreviewOptions): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (state.showHelp) {
      state.showHelp = false
      return true
    }

    switch (key) {
      case 'x':
      case 'escape':
      case 'ctrl-c':
        return false
      case '?':
        state.showHelp = true
        return true
      case 'g':
        state.screen = cycle(SCREENS, state.screen, 'site')
        return true
      default:
        break
    }

    if (state.screen === 'time') {
      switch (key) {
        case 'left':
        case 'h':
          nudgeTime(state.time, -TIME_STEP)
          break
        case 'right':
        case 'l':
          nudgeTime(state.time, TIME_STEP)
          break
        case 'H':
          nudgeTime(state.time, -TIME_STEP_COARSE)
          break
        case 'L':
          nudgeTime(state.time, TIME_STEP_COARSE)
          break
        case 'r':
          state.time = initialTimeState()
          break
        default:
          break
      }
      return true
    }

    if (state.screen === 'arena') {
      switch (key) {
        // --- the creeper -------------------------------------------------
        case 's':
          attemptSpawn(state.arena, state.time.timeOfDay)
          break
        case 'u':
          cycleGround(state.arena)
          break
        case 't':
          cycleLight(state.arena)
          break
        case '[':
          nudgeSpawnDistance(state.arena, -1)
          break
        case ']':
          nudgeSpawnDistance(state.arena, 1)
          break
        case 'left':
        case 'h':
          approach(state.arena, -1)
          break
        case 'right':
        case 'l':
          approach(state.arena, 1)
          break
        case '.':
          stepArena(state.arena)
          break
        case 'n':
          for (let step = 0; step < options.runFrames; step += 1) {
            stepArena(state.arena)
          }
          break
        case 'k':
          slayCreeper(state.arena)
          break
        case 'f':
          cycleLooting(state.arena)
          break

        // --- the death-cause driver (unchanged; finding F5 lives here) ----
        case 'c':
          state.arena.causeIndex = (state.arena.causeIndex + 1) % ARENA_CAUSES.length
          break
        case 'a':
          state.arena.amountIndex = (state.arena.amountIndex + 1) % ARENA_AMOUNTS.length
          break
        case ' ':
        case 'enter':
          strike(state.arena)
          break
        case 'r':
          respawn(state.arena)
          break
        default:
          break
      }
      return true
    }

    const site = state.site

    switch (key) {
      case 'left':
      case 'h':
        move(state, -1, 0)
        break
      case 'H':
        move(state, -5, 0)
        break
      case 'right':
      case 'l':
        move(state, 1, 0)
        break
      case 'L':
        move(state, 5, 0)
        break
      case 'up':
      case 'k':
        move(state, 0, 1)
        break
      case 'K':
        move(state, 0, 5)
        break
      case 'down':
      case 'j':
        move(state, 0, -1)
        break
      case 'J':
        move(state, 0, -5)
        break

      case 'b':
        yield* requestBreak(site, positionAt(site, state.cursor.x, state.cursor.y))
        break
      case 'p':
        pokeBlock(site, positionAt(site, state.cursor.x, state.cursor.y), state.palette)
        break
      case 'e':
        pokeBlock(site, positionAt(site, state.cursor.x, state.cursor.y), 0)
        break

      case '.': {
        const row = yield* stepFrame(site)
        site.note =
          `frame ${String(row.frame)}: examined ${String(row.examined)}, moved ${String(row.moved)}, ` +
          `${String(row.reads)} reads / ${String(row.writes)} writes, pending ${String(row.pendingAfter)}`
        break
      }
      case 'n':
        yield* runFrames(site, options.runFrames)
        site.note = `ran ${String(options.runFrames)} frames, now at ${String(site.frame)}`
        break
      case 's': {
        const report = yield* settle(site)
        site.note = report.gaveUp
          ? `settle GAVE UP after ${String(report.cap)} frames — the queue is not draining`
          : `settled after ${String(report.frames)} frame(s); the queue emptied by itself`
        break
      }

      case 'v':
        state.view = cycle(VIEW_MODES, state.view, 'world')
        break
      case 'o':
        yield* loadScenario(state, state.scenarioIndex + 1)
        break
      case 'O':
        yield* loadScenario(state, state.scenarioIndex - 1)
        break
      case 'r':
        yield* loadScenario(state, state.scenarioIndex)
        break

      default: {
        const slot = Number(key)
        if (Number.isInteger(slot) && slot >= 1 && slot <= BLOCKS.length) {
          state.palette = BLOCKS[slot - 1]?.id ?? 0
          site.note = `poke palette: ${BLOCKS[slot - 1]?.name ?? 'air'}`
        }
        break
      }
    }

    yield* refresh(state)
    return true
  })

const runInteractive = (state: State, options: PreviewOptions, style: Style): void => {
  enterFullScreen()

  let restored = false
  const restore = (): void => {
    if (!restored) {
      restored = true
      leaveFullScreen()
    }
  }
  onExit(restore)

  const draw = (): void => {
    paintFrame(render(state, options, style))
  }

  const quit = (): void => {
    restore()
    process.exit(0)
  }

  onResize(draw)
  onInputEnd(quit)
  onKey((key) => {
    if (Effect.runSync(handleKey(state, key, options))) {
      draw()
      return
    }
    quit()
  })

  draw()
}

const program: Effect.Effect<number> = Effect.gen(function* () {
  guardBrokenPipe()

  const options = parseArguments(process.argv.slice(2))
  const style = options.ascii ? PLAIN_STYLE : ANSI_STYLE

  if (options.errors.length > 0) {
    for (const error of options.errors) {
      writeLine(`preview-mining-site: ${error}`)
    }
    writeLine('')
    for (const line of USAGE) {
      writeLine(line)
    }
    return 1
  }

  if (options.help) {
    for (const line of USAGE) {
      writeLine(line)
    }
    return 0
  }

  if (options.list) {
    writeLine('scenarios')
    writeLine('')
    for (const line of SCENARIO_LIST) {
      writeLine(line)
    }
    return 0
  }

  if (options.stats) {
    for (const line of yield* buildStatsReport) {
      writeLine(line)
    }
    return 0
  }

  const requested = SCENARIOS.findIndex((scenario) => scenario.name === options.scenario)
  const start = requested === -1 ? SCENARIOS.findIndex((s) => s.name === DEFAULT_SCENARIO) : requested
  const scenario = scenarioAt(start)

  const state: State = {
    site: yield* makeSite(scenario.build(), BOUNDS, scenario.name),
    scenarioIndex: start,
    screen: options.screen,
    view: options.view,
    cursor: { x: scenario.target.x, y: scenario.target.y },
    palette: 5,
    time: { timeOfDay: options.timeOfDay },
    arena: initialArenaState(),
    showHelp: false,
    pending: [],
  }
  yield* loadScenario(state, start)

  if (options.autoBreak) {
    yield* requestBreak(state.site, positionAt(state.site, scenario.target.x, scenario.target.y))
  }
  if (options.spawn) {
    attemptSpawn(state.arena, state.time.timeOfDay)
    // The arrow keys, in one flag. There is no pathfinder — the creeper spawns
    // 16 blocks away by rule and something has to walk it in.
    approach(state.arena, ARENA_APPROACH_TO - ARENA_SPAWN_DISTANCE)
  }
  if (options.settle) {
    if (state.screen === 'arena') {
      // Step until the creeper stops being alive. The cap exists for the same
      // reason the mining site's does: a rule that never terminates should say
      // so rather than hang a preview.
      let steps = 0
      while (state.arena.creeper?.alive === true && steps < ARENA_SETTLE_CAP) {
        stepArena(state.arena)
        steps += 1
      }
    } else {
      const report = yield* settle(state.site)
      state.site.note = report.gaveUp
        ? `settle GAVE UP after ${String(report.cap)} frames`
        : `settled after ${String(report.frames)} frame(s)`
    }
  }
  yield* runFrames(state.site, options.frames)
  yield* refresh(state)

  if (options.once || !isInteractive()) {
    if (!options.once) {
      writeLine(
        style.dim('preview-mining-site: stdin/stdout is not a TTY, drawing a single frame (same as --once)'),
      )
    }
    if (state.screen === 'site') {
      for (const line of buildNotes(style, scenario.notes, scenario.title)) {
        writeLine(line)
      }
      writeLine(buildLegend(style))
      writeLine('')
    }
    for (const line of render(state, options, style)) {
      writeLine(line)
    }
    return 0
  }

  runInteractive(state, options, style)
  return 0
})

const exitCode = Effect.runSync(program)
if (exitCode !== 0) {
  process.exit(exitCode)
}
