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
  ARENA_DROP_TABLES,
  ARENA_MISSING,
  ARENA_WIRED,
  ARENA_STEP_SECS,
  arenaAmount,
  arenaCandidate,
  arenaCause,
  arenaVerdict,
  blastCurve,
  blastRadius,
  DESPAWN_PROBES,
  DESPAWN_RADIUS,
  dropsAtRoll,
  endermanOffset,
  endermanRoll,
  endermanSequence,
  endermanStuckTicks,
  endermanUrge,
  fuseFraction,
  fuseLabel,
  groundName,
  healthBar,
  IGNITION_RANGE,
  offsetDistance,
  phaseBand,
  readWeather,
  shellFraction,
  shellLabel,
  shulkerArmor,
  shulkerFlees,
  SHULKER_MAX_HEALTH,
  sweepAt,
  sweepLabel,
  TELEPORT_BAND,
  weatherTransitionTable,
  wrapReport,
  type ArenaState,
  type TimeState,
} from './screens'
import { CREEPER_EXPLOSION_POWER, explosionDamageAmount } from '../../domain/mob/explosion'
import type { Weather } from '../../domain/weather'
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

/** Width of the label column in the arena's missing list. */
const MISSING_LABEL_WIDTH = 34

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
    // Items and not block ids: what the interactions stage handed to mc-sim's
    // `InventoryService.add`, plus what placement took off the stack with a
    // leading `-`. The two are on one column because they are one story — a
    // frame that mined a sand and placed it back reads `sand -sand`, which is
    // the round trip.
    //
    // A LEADING `!` IS WHAT THE INVENTORY REFUSED. It is on the same column
    // deliberately: a full inventory shows `cobblestone !cobblestone`, so the
    // deposit and its rejection are read together rather than the rejection
    // needing a column of its own that is blank in every ordinary frame.
    '  ' +
      [
        ...row.mined.map((item) => (item.count === 1 ? item.item : `${item.item}x${String(item.count)}`)),
        ...row.leftover.map((item) =>
          item.count === 1 ? `!${item.item}` : `!${item.item}x${String(item.count)}`,
        ),
        ...row.spent.map((item) => `-${item}`),
      ].join(' '),
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

const WEATHER_COLOR: Readonly<Record<Weather, readonly [number, number, number]>> = {
  clear: [150, 200, 245],
  rain: [110, 140, 180],
  thunder: [90, 95, 130],
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
  const weather = readWeather(state.weather)
  const lines: Array<string> = [
    style.bold('time slider — domain/day-night.ts and domain/weather.ts, driven directly'),
    style.dim('mc-sim owns the HOUR (DN-GP-7) and NOBODY owns the weather, so this screen holds it'),
    style.dim('the way the mining site’s host does — see domain/weather.ts. Both rules are total'),
    style.dim('functions; the seed below is threaded by hand, never Math.random().'),
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
    '',
    style.bold('  weather — domain/weather.ts'),
    `  weather              ${style.paint(weather.weather, WEATHER_COLOR[weather.weather])}`,
    `  remainingSecs        ${weather.remainingSecs.toFixed(1)}`,
    `  isPrecipitating()    ${String(weather.precipitating)}`,
    `  isThunderstorm()     ${String(weather.thunder)}`,
    `  weatherLightScale()  ${weather.lightScale.toFixed(2)}`,
    `  seed                 ${String(state.weatherSeed)}`,
    '',
    style.dim('  the transition graph, ASKED of resolveNextWeatherState rather than transcribed:'),
    ...weatherTransitionTable().map(
      ([from, threshold, low, high]) =>
        `    ${padEnd(from, 9)}roll < ${threshold} -> ${padEnd(low, 9)}otherwise -> ${high}`,
    ),
    style.dim('    note that no row can stay put: every expiry changes the weather.'),
    '',
    style.dim(
      '  vanilla lets rain spawn hostiles in DAYLIGHT. hostileSpawnsAllowed above ignores the',
    ),
    style.dim(
      '  weather, deliberately: the reference implementation has no such gate (docs/porting.md §4).',
    ),
  ]

  return lines
}

// ---------------------------------------------------------------------------
// arena
// ---------------------------------------------------------------------------

/**
 * The lane the creeper walks down.
 *
 * One cell per block, with the ignition range marked, because "three blocks" is
 * a number until you watch the fuse light at the third cell. The blast radius is
 * twice that and is marked separately — the two radii being different is the
 * thing this drawing exists to make obvious.
 */
const approachLane = (distance: number, style: Style): string => {
  const cells = Array.from({ length: 13 }, (_, index) =>
    index === 0 ? '@' : index <= IGNITION_RANGE ? '=' : index <= blastRadius(CREEPER_EXPLOSION_POWER) ? '-' : '.',
  )
  const at = Math.min(cells.length - 1, Math.max(0, Math.round(distance)))
  const drawn = cells.map((cell, index) => (index === at && at > 0 ? 'C' : cell)).join('')

  return `    ${style.bold(drawn)}   ${style.dim('@ player   = ignition   - blast   C creeper')}`
}

const renderCreeper = (state: ArenaState, style: Style): ReadonlyArray<string> => {
  const creeper = state.creeper
  if (creeper === undefined) {
    return [
      style.dim('    no creeper. The spawn rule above has to say Spawn first — which is the point:'),
      style.dim('    a mob appears because a rule allowed it, not because this screen drew one.'),
    ]
  }

  const filled = Math.round(fuseFraction(creeper.fuse) * 24)
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(24 - filled)}]`
  const damageNow = explosionDamageAmount(CREEPER_EXPLOSION_POWER, creeper.distanceBlocks)

  return [
    approachLane(creeper.distanceBlocks, style),
    '',
    `    distance   ${style.bold(creeper.distanceBlocks.toFixed(2))} blocks` +
      style.dim(`   (ignition <= ${String(IGNITION_RANGE)}, blast < ${String(blastRadius(CREEPER_EXPLOSION_POWER))})`),
    `    fuse       ${creeper.fuse._tag === 'Lit' ? style.paint(bar, [235, 160, 90]) : style.dim(bar)}  ${fuseLabel(creeper.fuse)}`,
    `    steps      ${String(creeper.steps)} × ${String(ARENA_STEP_SECS)}s` +
      style.dim(`   alive=${String(creeper.alive)}`),
    `    if it went off now: ${style.bold(String(damageNow))} damage` +
      style.dim('  (explosionDamageAmount, measured at this distance)'),
  ]
}

const bar = (fraction: number, width: number): string => {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`
}

/**
 * The enderman: a decision and an offset, and no enderman.
 *
 * There is no lane to draw here and no sprite to move, which is the honest
 * picture of what `domain/mob/enderman-teleport.ts` decides. What the screen can
 * show — and a unit test cannot — is the two halves being INDEPENDENT: the urge
 * on the left is computed from three facts, the offset on the right from a roll
 * sequence, and the rule never puts them together because putting them together
 * means adding a position, which is mc-sim's.
 */
const renderEnderman = (state: ArenaState, style: Style): ReadonlyArray<string> => {
  const urge = endermanUrge(state)
  const roll = endermanRoll(state)
  const [sequenceName, sequence] = endermanSequence(state)
  const offset = endermanOffset(state)
  const distance = offsetDistance(offset)

  return [
    `    hit this frame  ${padEnd(state.enderman.damaged ? 'yes' : 'no', 12)}${style.dim('d toggles — a hit short-circuits the other two branches')}`,
    `    roll            ${padEnd(Number.isNaN(roll) ? 'NaN' : roll.toFixed(3), 12)}${style.dim('e cycles — the gates are < 0.3 hurt and < 0.05 chasing')}`,
    `    stuckTicks      ${padEnd(String(endermanStuckTicks(state)), 12)}${style.dim('w cycles — the gate is > 40 FRAMES, not seconds')}`,
    '',
    `    ${style.bold('urge')}  ${
      urge._tag === 'Stay'
        ? style.dim('Stay')
        : style.paint(`Teleport  reason=${urge.reason}  anchor=${urge.anchor}`, [180, 140, 235])
    }`,
    style.dim('    the anchor is part of the answer: a hurt enderman jumps away from ITSELF and a'),
    style.dim('    restless one jumps to 8..32 blocks from YOU. The reference passes both and says neither.'),
    '',
    `    rolls           ${padEnd(sequenceName, 26)}${style.dim('y cycles')}`,
    `    ${style.bold('offset')}  ${
      offset === undefined
        ? style.dim(`(none — ${String(Math.floor(sequence.length / 2))} attempt(s), all refused or out of rolls)`)
        : style.paint(
            `x ${offset.xBlocks.toFixed(2)}  z ${offset.zBlocks.toFixed(2)}   |offset| ${(distance ?? 0).toFixed(2)} blocks`,
            [180, 140, 235],
          )
    }`,
    style.dim(
      `    the band is ${String(TELEPORT_BAND[0])}..${String(TELEPORT_BAND[1])} blocks, inclusive. There is no y — the reference copies the anchor's`,
    ),
    style.dim('    altitude unchanged, so nothing anywhere asks whether the destination is inside a block.'),
  ]
}

/**
 * The shulker: the same shape as the fuse, drawn the same way.
 *
 * The bar is the twenty frames of opening, and it is worth watching against the
 * creeper's: both are countdowns with one irreversible-looking exit, and only
 * one of them actually is. A shulker can be slammed shut at nineteen frames and
 * has to start again — and then starts REOPENING one frame later, because the
 * flinch is a test on this frame's damage and not a timer.
 */
const renderShulker = (state: ArenaState, style: Style): ReadonlyArray<string> => {
  const shulker = state.shulker
  const opening = shulker.shell._tag === 'Opening'

  return [
    `    target          ${padEnd(shulker.hasTarget ? 'yes' : 'no', 12)}${style.dim('m toggles — losing it shuts the shell in ONE frame')}`,
    `    health          ${padEnd(`${String(shulker.healthPoints)} / ${String(SHULKER_MAX_HEALTH)}`, 12)}${style.dim('; hits it — a hit only flinches it BELOW half')}`,
    `    landing next .  ${padEnd(String(shulker.hitThisFrame), 12)}${style.dim('damage belongs to one frame, then it is gone')}`,
    '',
    `    shell    ${opening ? style.paint(bar(shellFraction(shulker.shell), 20), [140, 200, 180]) : style.dim(bar(shellFraction(shulker.shell), 20))}  ${style.bold(shellLabel(shulker.shell))}`,
    `    armour   ${padEnd(String(shulkerArmor(state)), 21)}${style.dim('points, NOT a mitigated damage — the 4%/point formula is combat’s')}`,
    `    frames   ${padEnd(String(shulker.frames), 21)}${style.dim(`shots ${String(shulker.shots)}   wantsToTeleport ${String(shulkerFlees(state))}`)}`,
    style.dim('    . steps this too. Twenty frames to open, one to shut: that asymmetry is the shell.'),
  ]
}

/** The sweep, as a table, because every row is the rule answering. */
const renderSweep = (state: ArenaState, style: Style): ReadonlyArray<string> => [
  `    ${DESPAWN_PROBES.map((distance) => {
    const verdict = sweepAt(distance, false)
    const label = Number.isNaN(distance) ? 'NaN' : `${String(distance)}b`
    return `${label}:${verdict._tag === 'Keep' ? 'keep' : verdict.reason}`
  }).join('  ')}`,
  `    at the spawn site (${String(state.site.distanceBlocks)} blocks): ${style.bold(sweepLabel(sweepAt(state.site.distanceBlocks, false)))}` +
    style.dim(`   persistent: ${sweepLabel(sweepAt(state.site.distanceBlocks, true))}`),
  style.dim(
    `    ${String(DESPAWN_RADIUS)} blocks, measured in 3D, and 128 itself is kept. A persistent mob is exempt from the`,
  ),
  style.dim('    distance and NOT from being a number — that order is the reference’s and is easy to invert.'),
]

export const renderArenaScreen = (
  state: ArenaState,
  timeOfDay: number,
  style: Style,
  columns: number,
): ReadonlyArray<string> => {
  const width = Math.max(40, Math.min(100, columns - 4))
  const { label } = arenaAmount(state)
  const candidate = arenaCandidate(state, timeOfDay)
  const verdict = state.verdict
  const lines: Array<string> = [
    style.bold('mob arena — three mobs: a creeper, an enderman’s teleport, a shulker’s shell'),
    style.dim('plan.md §3.11 asks for "スポーンさせて対峙" and for four behaviours. Three are written and'),
    style.dim('the fourth is refused with its reason, below. Everything here is produced by domain/mob/'),
    style.dim('at run time: this screen holds the state mc-sim will hold, and decides nothing at all.'),
    '',
    style.bold('  1. spawn condition — domain/mob/hostile-spawn.ts'),
    `    ground ${padEnd(groundName(candidate.groundBlock), 22)}${style.dim('u cycles')}`,
    `    light  ${padEnd(String(candidate.blockLight), 22)}${style.dim('t cycles — the gate is > 7')}`,
    `    range  ${padEnd(`${String(candidate.distanceToPlayerBlocksXZ)} blocks`, 22)}${style.dim('[ ] adjust — the band is 16..40')}`,
    `    hour   ${padEnd(timeOfDay.toFixed(3), 22)}${style.dim('the TIME screen owns it (DN-GP-7); noon refuses')}`,
    '',
    `    ${style.bold('s')} asks the rule -> ${
      verdict === undefined
        ? style.dim('not asked yet')
        : verdict._tag === 'Spawn'
          ? style.paint('Spawn', [150, 220, 150])
          : style.paint(`Refused: ${verdict.reason}`, [235, 160, 120])
    }`,
    '',
    style.bold('  2. the fuse — domain/mob/creeper-fuse.ts'),
    ...renderCreeper(state, style),
    '',
    style.bold('  3. the blast — domain/mob/explosion.ts'),
    `    ${blastCurve(CREEPER_EXPLOSION_POWER)
      .map(([distance, amount]) => `${String(distance)}b:${String(amount)}`)
      .join('  ')}`,
    style.dim('    43 at the centre against 20 maximum health — the fuse is the whole counter-play.'),
    '',
    style.bold('  4. the drop — domain/mob/mob-drop.ts, in mc-kernel’s vocabulary'),
    `    looting ${padEnd(String(state.lootingLevel), 8)}${style.dim('f cycles   k kills it before the fuse ends')}`,
    `    loot    ${padEnd(
      state.loot.length === 0 ? '(nothing)' : state.loot.map((drop) => `${drop.item} x${String(drop.count)}`).join(', '),
      24,
    )}${style.dim(`xp ${String(state.xp)}`)}`,
    style.dim('    a creeper that detonates leaves nothing at all; only a kill drops gunpowder.'),
    '',
    ...ARENA_DROP_TABLES.map(
      ([name, rules, xp]) =>
        `    ${padEnd(name, 9)}${padEnd(dropsAtRoll(rules, 0), 22)}${style.dim(
          `at roll 0.9: ${padEnd(dropsAtRoll(rules, 0.9), 22)}xp ${String(xp)}`,
        )}`,
    ),
    style.dim('    three tables, and the list stops where kernel’s vocabulary does — an enderman drops'),
    style.dim('    ENDER_PEARL and there is no such ItemType, so there is no table rather than a guess.'),
    '',
    style.bold('  5. the enderman’s teleport — domain/mob/enderman-teleport.ts'),
    ...renderEnderman(state, style),
    '',
    style.bold('  6. the shulker’s shell — domain/mob/shulker-shell.ts'),
    ...renderShulker(state, style),
    '',
    style.bold('  7. the sweep — domain/mob/hostile-despawn.ts'),
    ...renderSweep(state, style),
    '',
    style.paint(`  ${state.note}`, [226, 202, 130]),
    '',
    // NOT drawn, and that is deliberate. This screen used to be the only host
    // the seven rules had; `gameplay:entities` is now the real one, and a
    // preview may not implement another repository's service in order to draw
    // it (see apps/preview-mining-site/roster.ts). So the loop is NAMED here and
    // exercised in a test, which is the honest division.
    style.bold('  what now RUNS them, in the frame rather than on this screen'),
  ]

  for (const [what, where] of ARENA_WIRED) {
    lines.push(`    ${padEnd(what, 34)}${style.dim(where)}`)
  }

  lines.push(
    style.dim('    The scenario that goes THROUGH the stage — spawn, fuse, blast, damage, drop, crater,'),
    style.dim('    cascade, settle — is test/vertical-slice.test.ts. This screen still holds its own'),
    style.dim('    creeper: mc-sim is not published, and mx-gameplay must not ship an EntityManager.'),
  )

  lines.push('')
  lines.push(style.bold('  what is missing, and where it would go'))

  // A label longer than the column gets a line of its own rather than shoving the
  // reason sideways. The list is the point of this screen, so a row that is hard
  // to read is a row nobody reads.
  for (const [what, where] of ARENA_MISSING) {
    if (what.length >= MISSING_LABEL_WIDTH) {
      lines.push(`    ${what}`)
      lines.push(`    ${' '.repeat(MISSING_LABEL_WIDTH)}${style.dim(where)}`)
    } else {
      lines.push(`    ${padEnd(what, MISSING_LABEL_WIDTH)}${style.dim(where)}`)
    }
  }

  lines.push('')
  lines.push(style.bold('  death-cause rules, driven directly'))
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
