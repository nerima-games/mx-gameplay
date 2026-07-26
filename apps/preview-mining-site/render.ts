/**
 * Every renderer, as a pure function of its arguments.
 *
 * A dev application, not shipped API.
 *
 * Pure so that `--once` produces byte-identical output for the same world, which
 * is what makes a pasted frame a piece of evidence rather than an anecdote. The
 * `Style` is threaded rather than read from a global for the reason `ansi.ts`
 * gives.
 */
import { padEnd, padStart, type Rgb, type Style } from './ansi'
import type { DayPhase } from '../../domain/day-night'
import { FALLING_BLOCK_MOVES_PER_TICK } from '../../domain/falling-block'
import type { PositionKey } from '../../domain/position-key'
import { positionKeyOf } from '../../domain/block-position-key'
import {
  ARENA_AMOUNTS,
  ARENA_CAUSES,
  ARENA_MISSING,
  arenaAmount,
  arenaCause,
  arenaVerdict,
  healthBar,
  phaseBand,
  wrapReport,
  type ArenaState,
  type TimeState,
} from './screens'
import { positionAt, type FrameRow, type Site } from './site'
import { AIR, glyphOf } from './world'

export const VIEW_MODES = ['world', 'queue', 'timeline'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

export const isViewMode = (value: string): value is ViewMode =>
  (VIEW_MODES as ReadonlyArray<string>).includes(value)

export const SCREENS = ['site', 'time', 'arena'] as const
export type ScreenName = (typeof SCREENS)[number]

export const isScreenName = (value: string): value is ScreenName =>
  (SCREENS as ReadonlyArray<string>).includes(value)

const CURSOR_BACKDROP: Rgb = [90, 90, 110]
const PENDING_BACKDROP: Rgb = [70, 55, 25]
const UNLOADED: Rgb = [70, 40, 40]

/** Row label width: `y` goes to two digits in every scenario here. */
const GUTTER = 4

// ---------------------------------------------------------------------------
// site / world
// ---------------------------------------------------------------------------

export const renderWorld = (
  site: Site,
  cursor: { readonly x: number; readonly y: number },
  pending: ReadonlySet<PositionKey>,
  style: Style,
  columns: number,
  rows: number,
): ReadonlyArray<string> => {
  const width = Math.min(site.bounds.width, Math.max(1, columns - GUTTER))
  const height = Math.min(site.bounds.height, Math.max(1, rows - 1))
  const lines: Array<string> = []

  for (let y = height - 1; y >= 0; y -= 1) {
    let line = style.dim(padStart(String(y), GUTTER - 1) + ' ')
    for (let x = 0; x < width; x += 1) {
      const position = positionAt(site, x, y)
      const resident = site.world.isResident(position)
      const id = resident ? (site.world.peekBlock(position) ?? AIR) : AIR
      const entry = glyphOf(id)
      const isCursor = x === cursor.x && y === cursor.y
      // A pending position means "the cell ABOVE this one is worth looking at",
      // which is why the marker sits on the position itself and not on the
      // block. Reading it the other way round is the single easiest mistake to
      // make about `FallingBlockQueue` and the queue view spells it out.
      const isPending = pending.has(positionKeyOf(position))

      const backdrop = isCursor ? CURSOR_BACKDROP : isPending ? PENDING_BACKDROP : undefined
      const glyph = resident ? entry.glyph : '/'
      const color = resident ? entry.color : UNLOADED
      line += style.cell(glyph, color, backdrop)
    }
    lines.push(line)
  }

  lines.push(
    style.dim(
      ' '.repeat(GUTTER) +
        Array.from({ length: width }, (_, x) => (x % 10 === 0 ? String((x / 10) % 10) : '-')).join(''),
    ),
  )

  return lines
}

export const contentRows = (site: Site): number => site.bounds.height + 1

export const isClipped = (site: Site, columns: number, rows: number): boolean =>
  site.bounds.width > columns - GUTTER || site.bounds.height + 1 > rows

// ---------------------------------------------------------------------------
// site / queue
// ---------------------------------------------------------------------------

/**
 * The pending set, in insertion order, with what each entry will actually look
 * at when its turn comes.
 *
 * The order is load-bearing: `domain/falling-block.ts:43-47` says the set is a
 * native insertion-ordered `Set` and that `takeBatch` returns a PREFIX of that
 * order, because that is what makes a scenario test an oracle. Printing the
 * order and drawing the budget line through it is the only way to see that
 * property hold or fail.
 */
export const renderQueue = (
  site: Site,
  pending: ReadonlyArray<PositionKey>,
  style: Style,
  rows: number,
): ReadonlyArray<string> => {
  const lines: Array<string> = [
    style.bold(
      `pending ${String(pending.length)}   budget ${String(FALLING_BLOCK_MOVES_PER_TICK)}   ` +
        `frame ${String(site.frame)}`,
    ),
    style.dim('  an entry P means "look at the cell ABOVE P and see whether it falls INTO P"'),
    '',
    style.dim(`  ${padEnd('#', 4)}${padEnd('position', 14)}${padEnd('above it', 12)}at it`),
  ]

  const budget = FALLING_BLOCK_MOVES_PER_TICK
  const visible = Math.max(4, rows - lines.length - 1)

  pending.slice(0, visible).forEach((key, index) => {
    const parts = key.split(',')
    const position = { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) }
    const source = { ...position, y: position.y + 1 }
    const resident = site.world.isResident(position)
    const at = resident ? glyphOf(site.world.peekBlock(position) ?? AIR).name : 'not loaded'
    const above = resident ? glyphOf(site.world.peekBlock(source) ?? AIR).name : 'not loaded'
    const marker = index < budget ? style.paint('>', [226, 202, 130]) : style.dim(' ')
    lines.push(`${marker} ${padEnd(String(index), 4)}${padEnd(key, 14)}${padEnd(above, 12)}${at}`)
  })

  if (pending.length === 0) {
    lines.push(style.dim('  (empty — an idle frame reads and writes NOTHING; watch the counters)'))
  }
  if (pending.length > visible) {
    lines.push(style.dim(`  … ${String(pending.length - visible)} more`))
  }
  if (pending.length > budget) {
    lines.push('')
    lines.push(
      style.dim(
        `  the ${String(pending.length - budget)} entries below the marker wait for the next frame — ` +
          'that is the burst-flattening the budget buys',
      ),
    )
  }

  return lines
}

// ---------------------------------------------------------------------------
// site / timeline
// ---------------------------------------------------------------------------

const TIMELINE_HEADER = [
  padStart('frame', 6),
  padStart('req', 4),
  padStart('pend', 5),
  padStart('exam', 5),
  padStart('move', 5),
  padStart('->pend', 7),
  padStart('reads', 6),
  padStart('writes', 7),
  padStart('float', 6),
  '  mined',
].join('')

const timelineRow = (row: FrameRow): string =>
  [
    padStart(String(row.frame), 6),
    padStart(row.requested === 0 ? '.' : String(row.requested), 4),
    padStart(String(row.pendingBefore), 5),
    padStart(String(row.examined), 5),
    padStart(String(row.moved), 5),
    padStart(String(row.pendingAfter), 7),
    padStart(String(row.reads), 6),
    padStart(String(row.writes), 7),
    padStart(String(row.floating), 6),
    '  ' + (row.mined.length === 0 ? '' : row.mined.map((id) => glyphOf(id).name).join(' ')),
  ].join('')

/**
 * The frame tape.
 *
 * THIS IS WHY THE APP EXISTS. `test/vertical-slice.test.ts` asserts the world
 * AFTER a cascade and the store call counts around it; it cannot assert the
 * SHAPE of the drain, because the shape is a sequence and the assertions are
 * endpoints. "The queue grew to 64 before it drained" and "the queue drained
 * monotonically" leave the same final world and the same final counters.
 *
 * `reads` on a row where `pend` is 0 is the DN-GP-1 check, live: the reference
 * implementation's number here was ~7M.
 */
export const renderTimeline = (
  site: Site,
  style: Style,
  rows: number,
): ReadonlyArray<string> => {
  const lines: Array<string> = [style.bold(TIMELINE_HEADER), style.dim('-'.repeat(TIMELINE_HEADER.length))]
  const visible = Math.max(4, rows - 6)
  const tail = site.trace.slice(-visible)

  for (const row of tail) {
    lines.push(row.pendingBefore === 0 && row.requested === 0 ? style.dim(timelineRow(row)) : timelineRow(row))
  }

  if (site.trace.length === 0) {
    lines.push(style.dim('  (no frames yet — press . to run one, b to queue a break)'))
  }

  const idle = site.trace.filter((row) => row.pendingBefore === 0 && row.requested === 0)
  const busy = site.trace.filter((row) => row.pendingBefore > 0)
  lines.push('')
  lines.push(
    style.dim(
      `  idle frames ${String(idle.length)} (reads ${String(idle.reduce((sum, row) => sum + row.reads, 0))}, ` +
        `writes ${String(idle.reduce((sum, row) => sum + row.writes, 0))})   ` +
        `busy frames ${String(busy.length)}   ` +
        `peak pending ${String(site.trace.reduce((peak, row) => Math.max(peak, row.pendingAfter), 0))}`,
    ),
  )

  return lines
}

// ---------------------------------------------------------------------------
// time slider
// ---------------------------------------------------------------------------

const PHASE_GLYPH: Readonly<Record<DayPhase, string>> = {
  night: '#',
  dawn: '/',
  day: ' ',
  dusk: '\\',
}

const PHASE_COLOR: Readonly<Record<DayPhase, Rgb>> = {
  night: [70, 80, 140],
  dawn: [235, 160, 90],
  day: [150, 200, 245],
  dusk: [220, 120, 90],
}

export const renderTimeScreen = (
  state: TimeState,
  style: Style,
  columns: number,
): ReadonlyArray<string> => {
  const width = Math.max(20, Math.min(96, columns - 8))
  const band = phaseBand(width)
  const report = wrapReport(state.timeOfDay)
  const cursorAt = Math.round(((state.timeOfDay % 1) + 1) % 1 * width) % width

  const bar = band
    .map((phase, index) =>
      style.cell(PHASE_GLYPH[phase], PHASE_COLOR[phase], index === cursorAt ? CURSOR_BACKDROP : undefined),
    )
    .join('')

  // Tick marks and their captions are generated from the SAME positions, so the
  // caption cannot drift away from the mark when the window is resized. A
  // hard-coded caption line is how a chart ends up lying about its own axis.
  const marks: ReadonlyArray<readonly [number, string]> = [
    [0, '0 midnight'],
    [0.25, '0.25 dawn'],
    [0.5, '0.5 noon'],
    [0.75, '0.75 dusk'],
  ]

  const place = (glyphFor: (caption: string) => string): string => {
    const cells: Array<string> = Array.from({ length: width }, () => ' ')
    for (const [fraction, caption] of marks) {
      const start = Math.min(width - 1, Math.round(fraction * width))
      const text = glyphFor(caption)
      for (let offset = 0; offset < text.length && start + offset < width; offset += 1) {
        cells[start + offset] = text.charAt(offset)
      }
    }
    return cells.join('')
  }

  const ruler = place(() => '^')
  const captions = place((caption) => caption)

  const reading = report.today
  const lines: Array<string> = [
    style.bold('time slider — domain/day-night.ts, driven directly'),
    style.dim('mc-sim owns the HOUR (DN-GP-7). gameplay:time-weather is Effect.void, so there is'),
    style.dim('nothing to advance; this sweeps the argument these rules are total functions of.'),
    '',
    '    ' + bar,
    '    ' + style.dim(ruler),
    '    ' + style.dim(captions),
    '',
    `  timeOfDay            ${style.bold(reading.timeOfDay.toFixed(4))}`,
    `  dayPhase()           ${style.paint(reading.phase, PHASE_COLOR[reading.phase])}`,
    `  isNight()            ${String(reading.night)}`,
    `  hostileSpawnsAllowed ${String(reading.hostiles)}`,
    '',
    style.bold('  the same instant on three consecutive days'),
    style.dim('  a time of day is a FRACTION OF A DAY. mc-sim advances it as (base + elapsed/len) % 1,'),
    style.dim('  and JS `%` keeps the sign of its left operand — so a clock that steps backwards'),
    style.dim('  (NTP, a user changing the system time) hands these rules a NEGATIVE fraction.'),
    '',
    `    t-1  ${padEnd(report.yesterday.timeOfDay.toFixed(4), 10)}${padEnd(report.yesterday.phase, 8)}night=${String(report.yesterday.night)}`,
    `    t    ${padEnd(report.today.timeOfDay.toFixed(4), 10)}${padEnd(report.today.phase, 8)}night=${String(report.today.night)}`,
    `    t+1  ${padEnd(report.tomorrow.timeOfDay.toFixed(4), 10)}${padEnd(report.tomorrow.phase, 8)}night=${String(report.tomorrow.night)}`,
    '',
    report.agrees
      ? style.dim('    the three agree at this instant')
      : style.paint(
          '    THE THREE DISAGREE. Same moment of the day, three different answers — see F6.',
          [235, 120, 120],
        ),
  ]

  return lines
}

// ---------------------------------------------------------------------------
// arena
// ---------------------------------------------------------------------------

export const renderArenaScreen = (
  state: ArenaState,
  style: Style,
  columns: number,
): ReadonlyArray<string> => {
  const width = Math.max(40, Math.min(100, columns - 4))
  const { label } = arenaAmount(state)
  const lines: Array<string> = [
    style.bold('mob arena — THERE IS NO MOB'),
    style.dim('plan.md §3.11 asks for "スポーンさせて対峙". Nothing in domain/ names a mob, and'),
    style.dim('gameplay:entities runs the falling-block cascade and nothing else. Rather than draw'),
    style.dim('an arena that simulates nothing, this drives what a mob would eventually reach:'),
    style.dim('domain/death-cause.ts, for real. Every number below came out of applyDamage().'),
    '',
    style.bold('  what is missing, and where it would go'),
  ]

  for (const [what, where] of ARENA_MISSING) {
    lines.push(`    ${padEnd(what, 28)}${style.dim(where)}`)
  }

  lines.push('')
  lines.push(style.bold('  death-cause rules, driven'))
  lines.push('')
  lines.push(
    `    health  ${healthBar(state.vitals, 20)}  ${
      Number.isFinite(state.vitals.healthPoints) ? String(state.vitals.healthPoints) : 'NaN'
    } / 20`,
  )
  lines.push(`    lastDeathCause   ${String(state.vitals.lastDeathCause)}`)
  lines.push(`    deathMessage()   ${arenaVerdict(state.vitals)}`)
  lines.push('')
  lines.push(
    `    cause  ${style.bold(arenaCause(state))}   amount  ${style.bold(label)}` +
      style.dim('   (c cycles cause, a cycles amount, space strikes, r respawns)'),
  )
  lines.push(
    style.dim(
      `    causes: ${ARENA_CAUSES.join(' ')}` ,
    ),
  )
  lines.push(style.dim(`    amounts: ${ARENA_AMOUNTS.map((entry) => entry.label).join(' ')}`))
  lines.push('')
  lines.push(style.dim(`    ${padEnd('cause', 14)}${padEnd('amount', 10)}${padEnd('health', 10)}`))

  for (const blow of state.log) {
    const before = Number.isFinite(blow.before) ? String(blow.before) : 'NaN'
    const after = Number.isFinite(blow.after) ? String(blow.after) : 'NaN'
    lines.push(`    ${padEnd(blow.cause, 14)}${padEnd(blow.amountLabel, 10)}${before} -> ${after}`)
  }

  if (!Number.isFinite(state.vitals.healthPoints)) {
    lines.push('')
    lines.push(
      style.paint(
        '    health is NaN. isDead() is false and stays false, so no further blow can land'.slice(0, width),
        [235, 120, 120],
      ),
    )
    lines.push(style.paint('    and no death message will ever be produced. See F5.'.slice(0, width), [235, 120, 120]))
  }

  return lines
}
