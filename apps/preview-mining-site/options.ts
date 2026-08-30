/**
 * Command-line options for the mining-site preview.
 *
 * A dev application, not shipped API.
 *
 * Pure: `parseArguments` reads an array and returns a value. It never touches
 * `process`, so the whole option surface is exercisable without launching a
 * terminal UI — which matters because a parser that can only be tested by
 * starting a full-screen app is a parser nobody tests.
 *
 * Adapted from mx-redstone's `apps/preview-circuit-board/options.ts`, including
 * its two hard-won behaviours: `--` is accepted and ignored (pnpm 9 forwards a
 * literal one when somebody writes `pnpm preview -- --stats` out of npm habit),
 * and an unknown flag is an ERROR rather than a silent no-op. A dropped
 * `--scenario` is a preview showing the wrong world with full confidence.
 */
import { isScreenName, isViewMode, SCREENS, VIEW_MODES, type ScreenName, type ViewMode } from './render'
import { DEFAULT_SCENARIO, SCENARIO_NAMES, SCENARIOS } from './scenarios'
import { HARVEST_TIERS, type HarvestTier } from '@nerima-games/mc-kernel'

/** How many frames the `n` key advances. */
export const DEFAULT_RUN_FRAMES = 10

export type PreviewOptions = {
  readonly scenario: string
  readonly screen: ScreenName
  readonly view: ViewMode
  readonly runFrames: number
  /** Advance this many frames before drawing. */
  readonly frames: number
  /**
   * Break the scenario's target position before drawing.
   *
   * A piped frame has nobody to press `b`, and a frame of an undisturbed world
   * shows an empty queue and zero store calls — which is a true and completely
   * uninformative picture. Same role as mx-redstone's `--levers-on`.
   */
  readonly autoBreak: boolean
  /**
   * Ask the arena's spawn rule, and walk the creeper into ignition range.
   *
   * The arena's `--break`: a piped frame has nobody to press `s`, and an arena
   * with no creeper in it shows the spawn rule refusing nothing. The walk is
   * explicit rather than automatic because there is no pathfinder — the flag
   * does what the arrow keys do, and the screen's own missing-list says so.
   */
  readonly spawn: boolean
  /**
   * Advance until nothing more will happen before drawing.
   *
   * On the mining site that means the falling-block queue is idle; on the arena
   * it means the creeper has stopped being alive, by fuse or by `k`.
   */
  readonly settle: boolean
  readonly timeOfDay: number
  /**
   * The tool tier the site screen starts holding.
   *
   * A FLAG AND NOT JUST A KEY, because the tool gate is the half of the loot
   * table that is invisible in a screenshot and `--once` is how a frame becomes
   * a piece of evidence in a diff. `--tool none` and `--tool wooden` over the
   * same scenario are two pasteable frames that differ in exactly one line.
   */
  readonly toolTier: HarvestTier
  readonly once: boolean
  readonly ascii: boolean
  readonly stats: boolean
  readonly list: boolean
  readonly help: boolean
  readonly frameWidth: number | undefined
  readonly frameHeight: number | undefined
  readonly errors: ReadonlyArray<string>
}

const DEFAULTS = {
  scenario: DEFAULT_SCENARIO,
  screen: 'site',
  view: 'world',
  runFrames: DEFAULT_RUN_FRAMES,
  frames: 0,
  autoBreak: false,
  spawn: false,
  settle: false,
  timeOfDay: 0.3,
  toolTier: 'none',
  once: false,
  ascii: false,
  stats: false,
  list: false,
  help: false,
  frameWidth: undefined,
  frameHeight: undefined,
  errors: [],
} satisfies PreviewOptions

type Accumulator = {
  -readonly [Key in keyof PreviewOptions]: PreviewOptions[Key]
}

const readNumber = (
  accumulator: Accumulator,
  flag: string,
  raw: string | undefined,
): number | undefined => {
  if (raw === undefined) {
    accumulator.errors = [...accumulator.errors, `${flag} needs a value`]
    return undefined
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    accumulator.errors = [...accumulator.errors, `${flag}: "${raw}" is not a number`]
    return undefined
  }
  return value
}

/** Accepts `--flag value` and `--flag=value`. */
export const parseArguments = (argv: ReadonlyArray<string>): PreviewOptions => {
  const accumulator: Accumulator = { ...DEFAULTS }
  const queue = [...argv]

  while (queue.length > 0) {
    const token = queue.shift()
    if (token === undefined) {
      break
    }

    const equalsAt = token.indexOf('=')
    const flag = equalsAt === -1 ? token : token.slice(0, equalsAt)
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1)
    const takeValue = (): string | undefined => inlineValue ?? queue.shift()

    switch (flag) {
      case '--':
        break
      case '--help':
      case '-h':
        accumulator.help = true
        break
      case '--stats':
        accumulator.stats = true
        break
      case '--list':
        accumulator.list = true
        break
      case '--once':
        accumulator.once = true
        break
      case '--ascii':
        accumulator.ascii = true
        break
      case '--break':
        accumulator.autoBreak = true
        break
      case '--spawn':
        accumulator.spawn = true
        break
      case '--settle':
        accumulator.settle = true
        break
      case '--scenario': {
        const value = takeValue()
        if (value !== undefined && SCENARIO_NAMES.includes(value)) {
          accumulator.scenario = value
        } else {
          accumulator.errors = [
            ...accumulator.errors,
            `--scenario: "${String(value)}" is not one of ${SCENARIO_NAMES.join(', ')}`,
          ]
        }
        break
      }
      case '--screen': {
        const value = takeValue()
        if (value !== undefined && isScreenName(value)) {
          accumulator.screen = value
        } else {
          accumulator.errors = [
            ...accumulator.errors,
            `--screen: "${String(value)}" is not one of ${SCREENS.join(', ')}`,
          ]
        }
        break
      }
      case '--view': {
        const value = takeValue()
        if (value !== undefined && isViewMode(value)) {
          accumulator.view = value
        } else {
          accumulator.errors = [
            ...accumulator.errors,
            `--view: "${String(value)}" is not one of ${VIEW_MODES.join(', ')}`,
          ]
        }
        break
      }
      case '--frames':
        accumulator.frames = Math.max(0, readNumber(accumulator, flag, takeValue()) ?? accumulator.frames)
        break
      case '--run-frames':
        accumulator.runFrames = Math.max(
          1,
          readNumber(accumulator, flag, takeValue()) ?? accumulator.runFrames,
        )
        break
      case '--time':
        accumulator.timeOfDay = readNumber(accumulator, flag, takeValue()) ?? accumulator.timeOfDay
        break
      case '--tool': {
        const raw = takeValue()
        if (raw === undefined) {
          accumulator.errors = [...accumulator.errors, `${flag} needs a value`]
        } else if ((HARVEST_TIERS as ReadonlyArray<string>).includes(raw)) {
          accumulator.toolTier = raw as HarvestTier
        } else {
          accumulator.errors = [
            ...accumulator.errors,
            `${flag}: "${raw}" is not one of ${HARVEST_TIERS.join(' ')}`,
          ]
        }
        break
      }
      case '--width':
        accumulator.frameWidth = readNumber(accumulator, flag, takeValue()) ?? accumulator.frameWidth
        break
      case '--height':
        accumulator.frameHeight = readNumber(accumulator, flag, takeValue()) ?? accumulator.frameHeight
        break
      default:
        accumulator.errors = [...accumulator.errors, `unknown option: ${flag}`]
        break
    }
  }

  return {
    ...accumulator,
    frames: Math.trunc(accumulator.frames),
    runFrames: Math.trunc(accumulator.runFrames),
  }
}

export const SCENARIO_LIST: ReadonlyArray<string> = SCENARIOS.flatMap((scenario) => [
  `  ${scenario.name}${' '.repeat(Math.max(1, 16 - scenario.name.length))}${scenario.title}`,
  ...scenario.notes.map((note) => `${' '.repeat(18)}· ${note}`),
  '',
])

export const USAGE: ReadonlyArray<string> = [
  'pnpm preview [options]        mining-site sandbox for @nerima-games/mx-gameplay',
  '',
  'options',
  `  --screen <name>     site | time | arena                     (default site)`,
  `  --scenario <name>   prebuilt world to load                  (default ${DEFAULT_SCENARIO})`,
  '  --list              print the scenarios and what each one is for',
  '  --view <mode>       world | queue | timeline                (default world)',
  '  --break             queue a break at the scenario target before drawing — a piped',
  '                      frame of an undisturbed world measures nothing',
  '  --spawn             arena: ask the spawn rule and walk the creeper into range',
  '  --settle            site: run frames until the falling-block queue is idle;',
  '                      arena: step the fuse until the creeper is no longer alive',
  '  --frames <n>        advance n frames before drawing         (default 0)',
  `  --run-frames <n>    how many frames the n key advances      (default ${String(DEFAULT_RUN_FRAMES)})`,
  '  --time <fraction>   starting time of day for the time screen (default 0.3)',
  `  --tool <tier>       what the site screen starts holding: ${HARVEST_TIERS.join(' | ')}`,
  '                      (default none — bare hands, which mine stone and get NOTHING)',
  '  --once              render one frame to stdout and exit (no raw mode, pipe-safe)',
  '  --ascii             glyphs instead of colour — pasteable into an issue or a diff',
  '  --stats             print the measured report instead of a picture',
  '  --width <n> --height <n>   force the frame size in terminal cells',
  '  --help              this text',
  '',
  'keys (interactive)',
  '  g               next screen: site -> time -> arena',
  '',
  '  site',
  '    arrows / hjkl move the cursor (HJKL moves 5)   v cycle world/queue/timeline',
  '    b             queue a BREAK at the cursor, through gameplay:interactions',
  '    p             queue a PLACE at the cursor, through gameplay:interactions. The',
  '                  rule is asked FIRST and a refusal is printed rather than queued —',
  '                  the stage drops refusals, and they are the interesting half',
  '    i             USE a flint and steel at the cursor, through the same stage.',
  '                  ONE key, TWO rules: inside a finished obsidian ring the interior',
  '                  becomes % (a portal), anywhere else the cell becomes * (fire).',
  '                  No dry run — detection and the fill are one rule, so asking',
  '                  twice would light it twice. Read the WORLD, not a printed tag',
  '    e             erase a cell directly — NOT a rule, and it disturbs nothing.',
  '                  The contrast with p is the point: a placement starts a cascade',
  '    1-9 / 0       select the first ten palette entries; [ / ] cycles every entry',
  '                  (what p places and e erases). air, water, lava, nether_portal and',
  '                  fire have no ITEM form, so p says so and stops — that is kernel’s',
  '                  roster. mushrooms need light <= 12; sugar cane needs adjacent water;',
  '                  cactus needs four clear sides; door fills TWO cells',
  '    t / u / f     cycle the tool TIER / toggle silk touch / cycle fortune. The',
  '                  gate opens and shuts in the HUD: bare hands mine stone and get',
  '                  NOTHING, a wooden tier gets cobblestone',
  '    .             run ONE frame     n run --run-frames     s settle',
  '    o / O         next / previous scenario           r  reload this scenario',
  '',
  '  time — the hour',
  '    left/right    move the slider by 0.005          H/L by 0.05',
  '    r             reset the hour AND the weather',
  '',
  '  time — the weather (domain/weather.ts; the screen owns the value, nobody else does)',
  '    .             advance 60s of weather            n advance --run-frames of those',
  '    w             FAST-FORWARD to the next transition — the rule picks what follows',
  '    c             force the next weather (its DURATION still comes from the rule)',
  '',
  '  arena — the creeper',
  '    s             ask the spawn rule (uses the TIME screen’s hour)',
  '    u / t         cycle the ground block / the light level at the candidate cell',
  '    [ ]           move the spawn CANDIDATE nearer / further (the 16..40 band)',
  '    left/right    walk the spawned creeper in and out of its 3-block ignition range',
  '    .             step one 0.25s frame (every mob)  n step --run-frames of them',
  '    k             kill it before the fuse ends      f cycle looting 0-3',
  '',
  '  arena — the enderman (a decision and an offset; it holds no state)',
  '    d             toggle "hit this frame" — the branch that short-circuits the rest',
  '    e / w         cycle the roll / the stuckTicks, either side of every threshold',
  '    y             cycle the roll SEQUENCE the 16-attempt offset search runs against',
  '',
  '  arena — the shulker',
  '    m             toggle its target: 20 frames of . to open, 1 frame to shut',
  '    ;             hit it for 16 — it only flinches BELOW half health',
  '',
  '  arena — death causes (finding F5 lives here)',
  '    c             cycle death cause                 a cycle damage amount',
  '    space         apply one blow                    r respawn (clears every mob)',
  '',
  '  ?  help    x  Esc  Ctrl-C  quit',
]
