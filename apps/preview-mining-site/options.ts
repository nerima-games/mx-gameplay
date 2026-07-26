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
  /** Advance until the queue is idle before drawing. */
  readonly settle: boolean
  readonly timeOfDay: number
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
  settle: false,
  timeOfDay: 0.3,
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
  '  --settle            run frames until the falling-block queue is idle',
  '  --frames <n>        advance n frames before drawing         (default 0)',
  `  --run-frames <n>    how many frames the n key advances      (default ${String(DEFAULT_RUN_FRAMES)})`,
  '  --time <fraction>   starting time of day for the time screen (default 0.3)',
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
  '    p             poke a block into the store directly — NOT a rule, and it does',
  '                  not disturb the falling-block queue (there is no placement rule)',
  '    e             erase a cell directly, same caveat',
  '    1-6           air stone sand gravel water lava (what p pokes)',
  '    .             run ONE frame     n run --run-frames     s settle',
  '    o / O         next / previous scenario           r  reload this scenario',
  '',
  '  time',
  '    left/right    move the slider by 0.005          H/L by 0.05',
  '',
  '  arena',
  '    c             cycle death cause                 a cycle damage amount',
  '    space         apply one blow                    r respawn',
  '',
  '  ?  help    x  Esc  Ctrl-C  quit',
]
