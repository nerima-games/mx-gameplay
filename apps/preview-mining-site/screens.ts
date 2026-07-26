/**
 * The two screens that are NOT the mining site, and the state behind them.
 *
 * A dev application, not shipped API.
 *
 * plan.md §3.11 asks mx-gameplay for three previews — a mining site, a mob arena
 * and a time slider. Two of the three are honest today and one is not, and this
 * file is where that is dealt with rather than papered over.
 *
 * ---------------------------------------------------------------------------
 * The time slider is real
 * ---------------------------------------------------------------------------
 *
 * `domain/day-night.ts` is four total functions of one number. A slider is
 * therefore the whole of it — there is nothing hidden behind state, so nothing
 * the slider fails to reach. What the slider does NOT do is ADVANCE time:
 * `gameplay:time-weather` is `Effect.void` (`stages/registration.ts:293`) and the
 * hour belongs to mc-sim's `TimeService` (DN-GP-7), so this screen sweeps the
 * argument and reads the rule's answer. docs/testing.md §3-1 says the same in
 * one sentence: "スライダーはそこへ書く" — and there is no `there` to write to
 * yet.
 *
 * ---------------------------------------------------------------------------
 * The mob arena is not, and this screen says so on itself
 * ---------------------------------------------------------------------------
 *
 * There is no mob. There is no AI, no spawn rule, no pathfinder, no melee
 * handler and no loot table: `domain/` holds nine files and none of them names a
 * mob, and `gameplay:entities` runs the falling-block cascade and nothing else.
 * Drawing a plausible arena — two sprites, a health bar, an attack animation —
 * would make a gap look like progress, which is the one thing a preview must
 * never do.
 *
 * So this screen previews what actually exists at the arena's far end: the DEATH
 * CAUSE rules of `domain/death-cause.ts`, driven for real, with the mob half
 * shown as an explicit empty section listing what is missing and where it would
 * go. Confronting a mob is not previewable. Being killed BY one — as far as the
 * rule that turns damage into a death message is concerned — is, and it turned
 * out to be where the bug was.
 */
import { dayPhase, hostileSpawnsAllowed, isNight, type DayPhase } from '../../domain/day-night'
import {
  applyDamage,
  deathMessage,
  fullHealth,
  isDead,
  MAX_HEALTH_POINTS,
  type DeathCause,
  type Vitals,
} from '../../domain/death-cause'

// ---------------------------------------------------------------------------
// Time slider
// ---------------------------------------------------------------------------

/** How far one arrow-key press moves the slider. 1/200 of a day. */
export const TIME_STEP = 0.005

/** How far a shifted press moves it: to the next phase boundary, roughly. */
export const TIME_STEP_COARSE = 0.05

export type TimeState = {
  /** The fraction handed to the rules. NOT clamped — see `wrapReport`. */
  timeOfDay: number
}

export const initialTimeState = (): TimeState => ({ timeOfDay: 0.3 })

export const nudgeTime = (state: TimeState, delta: number): void => {
  // Deliberately NOT wrapped. mc-sim owns the hour and owns its normalisation
  // (DN-GP-7); a slider that silently wrapped would be hiding the question of
  // what these rules do when handed a fraction outside [0, 1), which is the one
  // thing about them a preview can find out that a unit test has not.
  state.timeOfDay = Number((state.timeOfDay + delta).toFixed(6))
}

export type TimeReading = {
  readonly timeOfDay: number
  readonly phase: DayPhase
  readonly night: boolean
  readonly hostiles: boolean
}

export const readTime = (timeOfDay: number): TimeReading => ({
  timeOfDay,
  phase: dayPhase(timeOfDay),
  night: isNight(timeOfDay),
  hostiles: hostileSpawnsAllowed(timeOfDay),
})

/**
 * The same instant, expressed three ways.
 *
 * A time of day is a fraction OF A DAY, so `t`, `t + 1` and `t - 1` are the same
 * moment on three consecutive days and every one of them can reach these
 * functions: mc-sim's advance is `(base + elapsed / dayLength) % 1`, and JS `%`
 * keeps the sign of its left operand, so a clock that steps backwards — NTP, a
 * user changing the system time, the very hazard mx-multiplayer's DN-3 is about
 * — produces a NEGATIVE fraction and nothing in this repository rejects it.
 *
 * `agrees` is what the screen shows. It is false whenever these rules are not
 * periodic, which is a fact about the rules and not about the slider.
 */
export type WrapReport = {
  readonly today: TimeReading
  readonly tomorrow: TimeReading
  readonly yesterday: TimeReading
  readonly agrees: boolean
}

export const wrapReport = (timeOfDay: number): WrapReport => {
  const today = readTime(timeOfDay)
  const tomorrow = readTime(timeOfDay + 1)
  const yesterday = readTime(timeOfDay - 1)
  return {
    today,
    tomorrow,
    yesterday,
    agrees:
      today.phase === tomorrow.phase &&
      today.phase === yesterday.phase &&
      today.night === tomorrow.night &&
      today.night === yesterday.night,
  }
}

/** The phase at each of `steps` equally spaced points across one whole day. */
export const phaseBand = (steps: number): ReadonlyArray<DayPhase> =>
  Array.from({ length: Math.max(1, steps) }, (_, index) => dayPhase(index / Math.max(1, steps)))

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

/** The causes the arena can apply, in the order the number keys select them. */
export const ARENA_CAUSES: ReadonlyArray<DeathCause> = [
  'mob',
  'projectile',
  'explosion',
  'fall',
  'lava',
  'fire',
  'drowning',
  'suffocation',
  'starvation',
  'void',
  'generic',
]

/**
 * The damage amounts the arena can apply.
 *
 * `NaN` is on this list on purpose and is the reason the arena screen is worth
 * having at all. `Damage.amount` is a bare `number` with no refinement, while
 * this very repository brands `DeltaTimeSecs` with `Number.isFinite`
 * (`domain/frame-contract.ts:57-60`) for exactly the same class of argument.
 * Press it and watch what happens to the health bar.
 */
export const ARENA_AMOUNTS: ReadonlyArray<{ readonly label: string; readonly amount: number }> = [
  { label: '1', amount: 1 },
  { label: '4', amount: 4 },
  { label: '10', amount: 10 },
  { label: '20', amount: 20 },
  { label: '-5', amount: -5 },
  { label: 'Infinity', amount: Number.POSITIVE_INFINITY },
  { label: 'NaN', amount: Number.NaN },
]

export type ArenaBlow = {
  readonly cause: DeathCause
  readonly amountLabel: string
  readonly before: number
  readonly after: number
}

export type ArenaState = {
  vitals: Vitals
  causeIndex: number
  amountIndex: number
  log: ReadonlyArray<ArenaBlow>
}

export const initialArenaState = (): ArenaState => ({
  vitals: fullHealth,
  causeIndex: 0,
  amountIndex: 1,
  log: [],
})

export const arenaCause = (state: ArenaState): DeathCause => ARENA_CAUSES[state.causeIndex] ?? 'generic'

export const arenaAmount = (state: ArenaState): { readonly label: string; readonly amount: number } =>
  ARENA_AMOUNTS[state.amountIndex] ?? { label: '1', amount: 1 }

export const strike = (state: ArenaState): void => {
  const cause = arenaCause(state)
  const { amount, label } = arenaAmount(state)
  const before = state.vitals.healthPoints
  state.vitals = applyDamage(state.vitals, { amount, cause })
  state.log = [
    ...state.log.slice(-11),
    { cause, amountLabel: label, before, after: state.vitals.healthPoints },
  ]
}

export const respawn = (state: ArenaState): void => {
  state.vitals = fullHealth
  state.log = []
}

/**
 * The health bar, and what it says when health is not a number.
 *
 * `Math.round(NaN)` is `NaN` and `'#'.repeat(NaN)` throws, so a naive bar
 * crashes the preview on the very input that matters. Reporting the value is the
 * finding; crashing is just a crash.
 */
export const healthBar = (vitals: Vitals, width: number): string => {
  if (!Number.isFinite(vitals.healthPoints)) {
    return `[${'?'.repeat(Math.max(0, width))}]`
  }
  const filled = Math.max(0, Math.min(width, Math.round((vitals.healthPoints / MAX_HEALTH_POINTS) * width)))
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}]`
}

export const arenaVerdict = (vitals: Vitals): string => {
  const message = deathMessage(vitals)
  if (message !== undefined) {
    return message
  }
  if (!Number.isFinite(vitals.healthPoints)) {
    return 'alive — isDead() is false, and no further damage can change that'
  }
  return 'alive'
}

export const arenaIsDead = (vitals: Vitals): boolean => isDead(vitals)

/**
 * What a real mob arena would need, and where each piece would live.
 *
 * Printed on the screen, not hidden in this comment, because the honest content
 * of the arena preview today IS this list. Each line was checked against the
 * tree rather than remembered: `domain/` holds `block-position-key`,
 * `chunk-store-port`, `day-night`, `death-cause`, `falling-block`,
 * `fluid-frontier`, `frame-contract`, `position-key`, `entities/
 * falling-block-move` and `interactions/break-block`. There is no eleventh file.
 */
export const ARENA_MISSING: ReadonlyArray<readonly [string, string]> = [
  ['mob entity + roster', 'nothing in domain/ names a mob; plan.md §3.11 lists 61 portable oracles'],
  ['spawn rule', 'would gate on domain/day-night.ts `hostileSpawnsAllowed`, which exists and is driven by the time screen'],
  ['AI / pathfinding', 'not started; the reference has it under packages/entity'],
  ['melee + projectile handlers', 'two of the ~40 one-rule-per-file interaction handlers (DN-GP-9); domain/interactions/ holds one'],
  ['drops / loot tables', 'not started; the mining site has nothing to drop either'],
  ['health as STATE', 'mc-sim owns it. `Vitals` here is a value the rule transforms, never a Ref (plan.md §2.3-1)'],
]
