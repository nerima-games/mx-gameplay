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
 * the slider fails to reach. What the slider does NOT do is ADVANCE time: the
 * hour belongs to mc-sim's `TimeService` (DN-GP-7), so this screen sweeps the
 * argument and reads the rule's answer.
 *
 * ---------------------------------------------------------------------------
 * The weather half arrived and it does advance, which is a DIFFERENT answer
 * ---------------------------------------------------------------------------
 *
 * This paragraph used to end with 「there is no `there` to write to yet」, quoting
 * docs/testing.md's one-sentence version of the same complaint. It is half
 * retired: `gameplay:time-weather` is no longer `Effect.void`, and this screen
 * advances a `WeatherState` from a seed.
 *
 * The distinction that made that possible is `domain/weather.ts`'s header and it
 * is worth carrying here, because a reader looking at two sliders side by side
 * will otherwise conclude that one of them is cheating. The HOUR has an owner and
 * this screen must not become a second one. The WEATHER has no owner at all —
 * mc-sim publishes a `TimeService` and nothing weather-shaped — so this screen
 * holds it exactly as it holds `ArenaCreeper`: playing the repository that will
 * own the value, and saying which repository that is.
 *
 * ---------------------------------------------------------------------------
 * The mob arena has THREE mobs, and the screen says which
 * ---------------------------------------------------------------------------
 *
 * This screen used to open with the line "THERE IS NO MOB" and list what was
 * missing, because `domain/` held nine files and none of them named a mob. Seven
 * of them now do — `domain/mob/creeper-fuse.ts`, `enderman-teleport.ts`,
 * `explosion.ts`, `hostile-despawn.ts`, `hostile-spawn.ts`, `mob-drop.ts` and
 * `shulker-shell.ts` — so the arena drives a creeper, an enderman's teleport
 * decision and a shulker's shell, with every number produced by a rule in this
 * repository rather than by this file.
 *
 * The habit does not change, and it is worth being precise about what has NOT
 * happened to the missing list: it got LONGER, TWICE, and for two different
 * reasons. Writing three of plan.md §3.11's four behaviours turned one vague
 * line ("enderman / shulker / dragon") into eight specific ones. Then WIRING
 * them into `gameplay:entities` retired four rows outright — the stage that runs
 * them, the population cap, the blast crater, and mob health and position as
 * state. The dragon encounter and vehicle frame are now registered as well.
 * The remaining rows are measurements or rules that still lack an executable
 * path. A rule that is RUNNING is a rule whose inputs can be counted.
 *
 * ---------------------------------------------------------------------------
 * The preview is STILL the host, and that is now a smaller claim
 * ---------------------------------------------------------------------------
 *
 * `domain/mob/` holds no creeper, no enderman and no shulker. It holds the rules
 * they obey, and every one of them is a total function from a value to a value:
 * mc-sim owns where the mob is, how far away the player is, what its fuse reads
 * and how much health it has left (plan.md §7 — 「状態管理は sim、AI/スポーン/
 * ドロップのルールは gameplay」).
 *
 * mc-sim has now BUILT that — `EntityManager`, mirrored in
 * `@nerima-games/mc-sim` and driven by `domain/entities/mob-frame.ts` —
 * and this screen still plays the part, because a preview cannot ship an
 * implementation of another repository's service and mc-sim is not published.
 * What changed is the status of the shape: `ArenaCreeper` being four fields long
 * with no position, no entity id and no random number generator used to be a
 * PREDICTION about what mc-sim would hold, and it is now a description of what
 * mc-sim does hold. The screen is the same; the claim it makes is weaker and
 * true.
 */
import { dayPhase, hostileSpawnsAllowed, isNight, type DayPhase } from '../../src/domain/day-night'
import {
  applyDamage,
  deathMessage,
  fullHealth,
  isDead,
  MAX_HEALTH_POINTS,
  type DeathCause,
  type Vitals,
} from '../../src/domain/death-cause'
import { AIR_BLOCK_ID, BlockId, DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { DEFAULT_ROLL_SEED, drawRolls } from '../../src/domain/frame-rolls'
import {
  advanceWeather,
  createWeatherState,
  INITIAL_WEATHER,
  isPrecipitating,
  isThunderstorm,
  LOWEST_WEATHER_ROLLS,
  RAIN_AFTER_THUNDER_CHANCE,
  resolveNextWeatherState,
  THUNDER_AFTER_CLEAR_CHANCE,
  THUNDER_AFTER_RAIN_CHANCE,
  weatherExpires,
  weatherLightScale,
  WEATHERS,
  WEATHER_TRANSITION_ROLLS,
  type Weather,
  type WeatherRolls,
  type WeatherState,
} from '../../src/domain/weather'
import {
  CREEPER_FUSE_SECS,
  CREEPER_IGNITION_RANGE_BLOCKS,
  DORMANT_FUSE,
  stepCreeperFuse,
  type CreeperFuse,
} from '../../src/domain/mob/creeper-fuse'
import { explosionDamageAmount, explosionDamageAt, explosionRadius } from '../../src/domain/mob/explosion'
import {
  canHostileSpawnAt,
  MIN_SPAWN_DISTANCE_BLOCKS,
  type SpawnCandidate,
  type SpawnVerdict,
} from '../../src/domain/mob/hostile-spawn'
import {
  BLAZE_DROPS,
  BLAZE_XP_REWARD,
  CREEPER_DROPS,
  CREEPER_XP_REWARD,
  GHAST_DROPS,
  GHAST_XP_REWARD,
  LOWEST_ROLLS,
  mobXpReward,
  rollMobDrops,
  type MobDrop,
  type MobDropRule,
} from '../../src/domain/mob/mob-drop'
import {
  ENDERMAN_TELEPORT_MAX_BLOCKS,
  ENDERMAN_TELEPORT_MIN_BLOCKS,
  endermanTeleportOffset,
  endermanTeleportUrge,
  type EndermanTeleportUrge,
  type TeleportOffset,
} from '../../src/domain/mob/enderman-teleport'
import {
  CLOSED_SHELL,
  SHULKER_OPENING_TICKS,
  shulkerShellArmorPoints,
  shulkerWantsToTeleport,
  stepShulkerShell,
  type ShulkerShell,
} from '../../src/domain/mob/shulker-shell'
import {
  DESPAWN_DISTANCE_BLOCKS,
  despawnVerdict,
  type DespawnVerdict,
} from '../../src/domain/mob/hostile-despawn'

// ---------------------------------------------------------------------------
// Time slider
// ---------------------------------------------------------------------------

/** How far one arrow-key press moves the slider. 1/200 of a day. */
export const TIME_STEP = 0.005

/** How far a shifted press moves it: to the next phase boundary, roughly. */
export const TIME_STEP_COARSE = 0.05

/**
 * How much weather one `.` press advances. A MINUTE, not a frame.
 *
 * The shortest stretch any weather can have is 180 seconds
 * (`THUNDER_DURATION_RANGE_SECS.min`) and the longest is 9000, so a slider that
 * moved in 1/60ths would need half a million presses to see a transition. This
 * is the same reason `docs/testing.md` §5 asks for fast-forward rather than for
 * a test that waits twenty minutes.
 */
export const WEATHER_STEP_SECS = 60

export type TimeState = {
  /** The fraction handed to the rules. NOT clamped — see `wrapReport`. */
  timeOfDay: number
  /**
   * The weather the screen is holding, EXACTLY as the site screen's host holds
   * it: `domain/weather.ts` is a total function from a state to a state, so
   * somebody has to be the owner and on this screen it is this field.
   *
   * That is the identical arrangement `ArenaCreeper` has with `domain/mob/` —
   * the preview plays the repository that owns the value — and here the
   * repository it is playing does not exist yet, which is the whole of
   * `domain/weather.ts`'s header.
   */
  weather: WeatherState
  /**
   * The generator, threaded by hand.
   *
   * A SEED AND NOT `Math.random()`, which is the one thing this screen must get
   * right to be a fair demonstration: the reference's `WeatherService` reads the
   * global generator at every call site (`weather-service.ts:13,23,35`), so its
   * weather cannot be replayed, and a preview that did the same would be showing
   * a rule that is deterministic through a driver that is not.
   */
  weatherSeed: number
}

export const initialTimeState = (): TimeState => ({
  timeOfDay: 0.3,
  weather: INITIAL_WEATHER,
  weatherSeed: DEFAULT_ROLL_SEED,
})

/** Draw the two rolls one transition needs, advancing the screen's seed. */
const drawWeatherRolls = (state: TimeState): WeatherRolls => {
  const batch = drawRolls(state.weatherSeed, WEATHER_TRANSITION_ROLLS)
  state.weatherSeed = batch.seed

  return { transition: batch.rolls[0] ?? 0, duration: batch.rolls[1] ?? 0 }
}

/**
 * Advance the weather by `secs`.
 *
 * The rolls are drawn ONLY when the stretch runs out, which is what
 * `stages/registration.ts` does and is `domain/frame-rolls.ts`' rule that the
 * sequence depend on what happened. A screen that drew unconditionally would
 * still look right and would quietly stop matching the stage.
 */
export const stepWeather = (state: TimeState, secs: number): void => {
  state.weather = weatherExpires(state.weather, secs)
    ? advanceWeather(state.weather, secs, drawWeatherRolls(state))
    : advanceWeather(state.weather, secs, LOWEST_WEATHER_ROLLS)
}

/**
 * Fast-forward to the next transition.
 *
 * The `docs/testing.md` §5 fast-forward, made a keystroke: rather than pressing
 * `.` a hundred and fifty times, expire the stretch and let the RULE decide what
 * follows. Note what this does NOT do — pick the next weather. The transition
 * roll is drawn from the same seed as everything else, so pressing this key
 * repeatedly walks the actual Markov chain rather than a cycle somebody wrote.
 */
export const skipWeather = (state: TimeState): void => {
  state.weather = advanceWeather(
    { weather: state.weather.weather, remainingSecs: 0 },
    0,
    drawWeatherRolls(state),
  )
}

/**
 * Force a weather, the way the reference's `setWeather` and its QA API do
 * (`weather-service.ts:22-23`, `qa-api.ts:82`).
 *
 * The DURATION still comes from the rule, because `createWeatherState` is the
 * only thing that knows a stretch's range — a forced weather with a made-up
 * countdown would be the screen inventing half a rule.
 */
export const cycleForcedWeather = (state: TimeState): void => {
  const next = WEATHERS[(WEATHERS.indexOf(state.weather.weather) + 1) % WEATHERS.length] ?? 'clear'
  const batch = drawRolls(state.weatherSeed, 1)
  state.weatherSeed = batch.seed
  state.weather = createWeatherState(next, batch.rolls[0] ?? 0)
}

/** What the world does about the current weather. Every value is a rule's answer. */
export type WeatherReading = {
  readonly weather: Weather
  readonly remainingSecs: number
  readonly precipitating: boolean
  readonly thunder: boolean
  readonly lightScale: number
}

export const readWeather = (state: WeatherState): WeatherReading => ({
  weather: state.weather,
  remainingSecs: state.remainingSecs,
  precipitating: isPrecipitating(state.weather),
  thunder: isThunderstorm(state.weather),
  lightScale: weatherLightScale(state.weather),
})

/**
 * The six edges of the transition graph, computed from the RULE rather than
 * transcribed.
 *
 * Each row asks `resolveNextWeatherState` with a roll on either side of the
 * threshold, so the table on screen cannot disagree with the code — which is the
 * failure the `place`/`captions` pair in `render.ts` is also built to avoid. A
 * hard-coded table is how a chart ends up lying about its own axis.
 */
export const weatherTransitionTable = (): ReadonlyArray<
  readonly [Weather, string, Weather, Weather]
> =>
  WEATHERS.map((from) => {
    const threshold =
      from === 'clear'
        ? THUNDER_AFTER_CLEAR_CHANCE
        : from === 'rain'
          ? THUNDER_AFTER_RAIN_CHANCE
          : RAIN_AFTER_THUNDER_CHANCE

    return [
      from,
      threshold.toFixed(2),
      resolveNextWeatherState(from, { transition: 0, duration: 0 }).weather,
      resolveNextWeatherState(from, { transition: 1, duration: 0 }).weather,
    ] as const
  })

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
  'in_fire',
  'on_fire',
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
 * (kernel's `domain/quantities.ts`) for exactly the same class of argument.
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

/**
 * The creeper, as its host has to hold it.
 *
 * Four fields, and three of them are mc-sim's nouns wearing a preview's clothes:
 * where it is relative to the player, whether it is still alive, and what its
 * fuse reads. Only `fuse` came from this repository, and it came as a VALUE that
 * `stepCreeperFuse` transforms — there is no creeper object with methods, and no
 * registry to look one up in.
 */
export type ArenaCreeper = {
  /** mc-sim's `EntityManager` would own this. Here, an arrow key owns it. */
  distanceBlocks: number
  fuse: CreeperFuse
  /** Cleared when it detonates or is killed; a dead creeper is not a state. */
  alive: boolean
  /** Frames it has been stepped, for the tape at the bottom of the screen. */
  steps: number
}

/** The candidate cell the spawn rule is asked about, minus the hour. */
export type ArenaSpawnSite = {
  groundBlock: BlockId
  blockLight: number
  distanceBlocks: number
}

/**
 * The enderman, as its host has to hold it.
 *
 * FOUR INDICES AND A BOOLEAN, and not one of them is a position. That is the
 * whole point of this type: `domain/mob/enderman-teleport.ts` decides WHETHER
 * and BY HOW MUCH, and the only thing a host has to keep is the facts it feeds
 * in. There is no enderman here either — mc-sim owns where it stands, and this
 * screen owns four cursors into tables of interesting numbers.
 *
 * The rolls are indices into a fixed table rather than a generator, because the
 * `Math.random()` ban applies to this app as much as to `domain/` and because a
 * preview that rolled its own dice could not be pointed at a boundary.
 */
export type ArenaEnderman = {
  /** Did a blow land this frame? mc-sim's combat lane would answer. */
  damaged: boolean
  /** Into `ARENA_ENDERMAN_ROLLS`. */
  rollIndex: number
  /** Into `ARENA_STUCK_TICKS` — mc-sim already keeps this counter. */
  stuckIndex: number
  /** Into `ARENA_TELEPORT_ROLLS`. */
  sequenceIndex: number
}

/**
 * The shulker, as its host has to hold it.
 *
 * `maxHealthPoints` is NOT here and is not this repository's: 30 is a stat on
 * mc-sim's roster entry (`mobs/shulker.ts:9`), so it is `SHULKER_MAX_HEALTH`
 * below, in the preview, where the rest of mc-sim's job is being done.
 *
 * `hitThisFrame` is the honest shape of `damageTakenThisTick`: a blow belongs to
 * ONE frame and is gone on the next, which is why the shell reopens a frame
 * after it slams shut. Holding it as a lasting field would have hidden that.
 */
export type ArenaShulker = {
  shell: ShulkerShell
  healthPoints: number
  hasTarget: boolean
  /** Damage that lands on the NEXT step, then clears. */
  hitThisFrame: number
  frames: number
  /** Frames on which the rule said it could fire. */
  shots: number
}

export type ArenaState = {
  vitals: Vitals
  causeIndex: number
  amountIndex: number
  log: ReadonlyArray<ArenaBlow>
  site: ArenaSpawnSite
  creeper: ArenaCreeper | undefined
  enderman: ArenaEnderman
  shulker: ArenaShulker
  /** The last answer `canHostileSpawnAt` gave, verbatim. */
  verdict: SpawnVerdict | undefined
  lootingLevel: number
  /** What the last dead creeper left. Empty after a self-destruct, by rule. */
  loot: ReadonlyArray<MobDrop>
  xp: number
  note: string
}

/** Blocks a spawned creeper starts at. The near end of the reference's band. */
export const ARENA_SPAWN_DISTANCE: number = MIN_SPAWN_DISTANCE_BLOCKS

/** Where `--spawn` walks it to: inside ignition range, and not on top of you. */
export const ARENA_APPROACH_TO = 2

/** Frames `--settle` will step before giving up on the fuse ever ending. */
export const ARENA_SETTLE_CAP = 64

/**
 * One preview frame, in seconds.
 *
 * A quarter second rather than a 20 Hz tick, so a keystroke visibly moves the
 * fuse and so the six steps to 1.5 are exact in binary. `run(dt)` takes its
 * delta as an argument precisely so a preview may choose one (docs/testing.md
 * §5); nothing here reads a clock, and DN-GP-8 forbids it anyway.
 */
export const ARENA_STEP_SECS = 0.25

/** A shulker's maximum health. mc-sim's stat — see `ArenaShulker`. */
export const SHULKER_MAX_HEALTH = 30

/** What one press of `;` hits the shulker for. Enough to cross half. */
export const ARENA_SHULKER_BLOW = 16

export const initialShulker = (): ArenaShulker => ({
  shell: CLOSED_SHELL,
  healthPoints: SHULKER_MAX_HEALTH,
  hasTarget: false,
  hitThisFrame: 0,
  frames: 0,
  shots: 0,
})

export const initialEnderman = (): ArenaEnderman => ({
  damaged: false,
  // 0.99 — above every threshold, so the screen opens on `Stay` and `e` walks
  // down through the two gates rather than starting past both of them.
  rollIndex: ARENA_ENDERMAN_ROLLS.indexOf(0.99),
  stuckIndex: 0,
  sequenceIndex: 0,
})

export const initialArenaState = (): ArenaState => ({
  vitals: fullHealth,
  causeIndex: 0,
  amountIndex: 1,
  log: [],
  site: { groundBlock: BlockId(2), blockLight: 0, distanceBlocks: 20 },
  creeper: undefined,
  enderman: initialEnderman(),
  shulker: initialShulker(),
  verdict: undefined,
  lootingLevel: 0,
  loot: [],
  xp: 0,
  note: 'press s to ask the spawn rule',
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
  state.creeper = undefined
  state.enderman = initialEnderman()
  state.shulker = initialShulker()
  state.verdict = undefined
  state.loot = []
  state.xp = 0
  state.note = 'respawned — press s to ask the spawn rule again'
}

// ---------------------------------------------------------------------------
// Arena — the creeper
// ---------------------------------------------------------------------------

/** Ground blocks worth trying, and what each one demonstrates. */
export const ARENA_GROUNDS: ReadonlyArray<readonly [BlockId, string]> = [
  [BlockId(2), 'stone'],
  [BlockId(5), 'sand'],
  [BlockId(10), 'oak_leaves'],
  [BlockId(13), 'glass'],
  [BlockId(6), 'water'],
  [AIR_BLOCK_ID, 'air'],
  [BlockId(200), 'id 200 (unknown)'],
]

/** Light levels either side of the threshold, plus the extremes. */
export const ARENA_LIGHTS: ReadonlyArray<number> = [0, 4, 7, 8, 12, 15]

export const groundName = (block: BlockId): string =>
  ARENA_GROUNDS.find(([id]) => id === block)?.[1] ?? `id ${String(block)}`

const cycleThrough = <A>(values: ReadonlyArray<A>, current: A, next: (index: number) => number): A =>
  values[((next(values.indexOf(current)) % values.length) + values.length) % values.length] ??
  (values[0] as A)

export const cycleGround = (state: ArenaState): void => {
  state.site.groundBlock = cycleThrough(
    ARENA_GROUNDS.map(([id]) => id),
    state.site.groundBlock,
    (index) => index + 1,
  )
}

export const cycleLight = (state: ArenaState): void => {
  state.site.blockLight = cycleThrough(ARENA_LIGHTS, state.site.blockLight, (index) => index + 1)
}

export const cycleLooting = (state: ArenaState): void => {
  state.lootingLevel = (state.lootingLevel + 1) % 4
}

export const nudgeSpawnDistance = (state: ArenaState, delta: number): void => {
  state.site.distanceBlocks = Math.max(0, state.site.distanceBlocks + delta)
}

/**
 * The candidate handed to the rule.
 *
 * The hour comes from the TIME SCREEN's slider, not from a second copy kept
 * here. That is the same argument DN-GP-7 makes one level up: there is one
 * answer to "what time is it" and the rule that gates spawning on it must read
 * the same one everything else does. Set the slider to noon and this screen
 * cannot spawn anything, which is the rule working rather than the screen
 * pretending.
 *
 * The two cells the mob would occupy are air here, always, because this preview
 * has no world at this position — the mining-site screen is where blocks live.
 * `s` on a ceiling is the one refusal this screen cannot show, and saying so is
 * cheaper than faking a column.
 */
export const arenaCandidate = (state: ArenaState, timeOfDay: number): SpawnCandidate => ({
  groundBlock: state.site.groundBlock,
  footBlock: AIR_BLOCK_ID,
  headBlock: AIR_BLOCK_ID,
  blockLight: state.site.blockLight,
  timeOfDay,
  distanceToPlayerBlocksXZ: state.site.distanceBlocks,
})

export const attemptSpawn = (state: ArenaState, timeOfDay: number): void => {
  const verdict = canHostileSpawnAt(arenaCandidate(state, timeOfDay))
  state.verdict = verdict

  if (verdict._tag === 'Refused') {
    state.note = `spawn refused: ${verdict.reason}`
    return
  }

  state.creeper = {
    distanceBlocks: ARENA_SPAWN_DISTANCE,
    fuse: DORMANT_FUSE,
    alive: true,
    steps: 0,
  }
  state.loot = []
  state.xp = 0
  state.note = `spawned at ${String(ARENA_SPAWN_DISTANCE)} blocks — h/l to walk it in, . to step time`
}

/** Move the creeper. mc-sim's pathfinder would do this; here it is a key. */
export const approach = (state: ArenaState, delta: number): void => {
  if (state.creeper === undefined) {
    return
  }
  state.creeper.distanceBlocks = Math.max(
    0,
    Number((state.creeper.distanceBlocks + delta).toFixed(3)),
  )
}

/**
 * One frame: step the fuse, and if it ended, apply the blast.
 *
 * Note what this function is NOT allowed to decide. Whether the fuse lights,
 * whether it survives the step, whether this is the step it ends on, how hard
 * the blast lands and what the death message says are all answers from
 * `domain/mob/`; the host chooses the delta, holds the value it is given back,
 * and hands the damage to `applyDamage`.
 */
export const stepArena = (state: ArenaState): void => {
  const creeper = state.creeper
  if (creeper === undefined || !creeper.alive) {
    return
  }

  const step = stepCreeperFuse(
    creeper.fuse,
    { distanceToTargetBlocks: creeper.distanceBlocks },
    DeltaTimeSecs(ARENA_STEP_SECS),
  )
  creeper.fuse = step.fuse
  creeper.steps += 1

  if (step.explosion === undefined) {
    return
  }

  const damage = explosionDamageAt(step.explosion, creeper.distanceBlocks)
  const before = state.vitals.healthPoints
  state.vitals = applyDamage(state.vitals, damage)
  state.log = [
    ...state.log.slice(-11),
    {
      cause: damage.cause,
      amountLabel: `${String(damage.amount)} @${creeper.distanceBlocks.toFixed(1)}b`,
      before,
      after: state.vitals.healthPoints,
    },
  ]

  creeper.alive = false
  // A creeper that blew itself up leaves nothing — see `MobKill` in
  // domain/mob/mob-drop.ts. Asking the rule rather than writing `[]` is the
  // point: the empty list below came out of `rollMobDrops`.
  state.loot = rollMobDrops(CREEPER_DROPS, { _tag: 'SelfDestruct' }, () => LOWEST_ROLLS)
  state.xp = mobXpReward({ _tag: 'SelfDestruct' }, CREEPER_XP_REWARD)
  state.note = `it detonated at ${creeper.distanceBlocks.toFixed(1)} blocks for ${String(damage.amount)} damage`
}

/** Kill it before the fuse ends — the only path that yields loot. */
export const slayCreeper = (state: ArenaState): void => {
  const creeper = state.creeper
  if (creeper === undefined || !creeper.alive) {
    state.note = 'nothing alive to kill'
    return
  }

  const kill = { _tag: 'Slain', lootingLevel: state.lootingLevel } as const
  creeper.alive = false
  state.loot = rollMobDrops(CREEPER_DROPS, kill, () => LOWEST_ROLLS)
  state.xp = mobXpReward(kill, CREEPER_XP_REWARD)
  state.note = `slain with looting ${String(state.lootingLevel)}`
}

// ---------------------------------------------------------------------------
// Arena — the enderman
// ---------------------------------------------------------------------------

/**
 * Rolls either side of every threshold the teleport rule has, plus a `NaN`.
 *
 * 0.049/0.05 is the chase gate and 0.29/0.3 the damage gate, so cycling this
 * list walks straight across both boundaries. The `NaN` is here for the reason
 * the damage amounts list has one: a rule's behaviour on a value that is not a
 * measurement is the thing a preview can show that a unit test only asserts.
 */
export const ARENA_ENDERMAN_ROLLS: ReadonlyArray<number> = [
  0, 0.049, 0.05, 0.29, 0.3, 0.5, 0.99, Number.NaN,
]

/** Stuck counts either side of the 40-frame threshold. */
export const ARENA_STUCK_TICKS: ReadonlyArray<number> = [0, 39, 40, 41, 100]

/**
 * Roll sequences worth watching the offset search run against.
 *
 * Named rather than random, and every one of them is a case `test/mob.test.ts`
 * also pins — the near edge, the far edge, the corner of the square that is
 * outside the circle, a first attempt that misses and a second that lands, and
 * the infinite roll that the reference would have turned into a maximum-range
 * jump.
 */
export const ARENA_TELEPORT_ROLLS: ReadonlyArray<readonly [string, ReadonlyArray<number>]> = [
  ['0.75 0.50', [0.75, 0.5]],
  ['0.50 0.50 | 0.75 0.50', [0.5, 0.5, 0.75, 0.5]],
  ['0.625 0.50  (the near edge)', [0.625, 0.5]],
  ['1.00 0.50   (the far edge)', [1, 0.5]],
  ['1.00 1.00   (the corner)', [1, 1]],
  ['0.60 0.50   (too near)', [0.6, 0.5]],
  ['thirty-two x 0.50', Array.from({ length: 32 }, () => 0.5)],
  ['Infinity 0.50', [Number.POSITIVE_INFINITY, 0.5]],
]

const pick = <A>(values: ReadonlyArray<A>, index: number, fallback: A): A =>
  values[((index % values.length) + values.length) % values.length] ?? fallback

export const endermanRoll = (state: ArenaState): number =>
  pick(ARENA_ENDERMAN_ROLLS, state.enderman.rollIndex, 0)

export const endermanStuckTicks = (state: ArenaState): number =>
  pick(ARENA_STUCK_TICKS, state.enderman.stuckIndex, 0)

export const endermanSequence = (state: ArenaState): readonly [string, ReadonlyArray<number>] =>
  pick(ARENA_TELEPORT_ROLLS, state.enderman.sequenceIndex, ['none', []])

/** The whole of the enderman's decision, asked afresh every redraw. */
export const endermanUrge = (state: ArenaState): EndermanTeleportUrge =>
  endermanTeleportUrge({
    damagedThisStep: state.enderman.damaged,
    stuckTicks: endermanStuckTicks(state),
    roll: endermanRoll(state),
  })

export const endermanOffset = (state: ArenaState): TeleportOffset | undefined =>
  endermanTeleportOffset(endermanSequence(state)[1])

/** How far that offset actually moved it — the number the band is about. */
export const offsetDistance = (offset: TeleportOffset | undefined): number | undefined =>
  offset === undefined ? undefined : Math.hypot(offset.xBlocks, offset.zBlocks)

export const TELEPORT_BAND: readonly [number, number] = [ENDERMAN_TELEPORT_MIN_BLOCKS, ENDERMAN_TELEPORT_MAX_BLOCKS]

export const toggleEndermanDamage = (state: ArenaState): void => {
  state.enderman.damaged = !state.enderman.damaged
  state.note = state.enderman.damaged
    ? 'the enderman was hit this frame — the damage branch short-circuits the other two'
    : 'the enderman was not hit this frame'
}

export const cycleEndermanRoll = (state: ArenaState): void => {
  state.enderman.rollIndex += 1
}

export const cycleEndermanStuck = (state: ArenaState): void => {
  state.enderman.stuckIndex += 1
}

export const cycleTeleportRolls = (state: ArenaState): void => {
  state.enderman.sequenceIndex += 1
}

// ---------------------------------------------------------------------------
// Arena — the shulker
// ---------------------------------------------------------------------------

/**
 * One frame of the shell.
 *
 * Note what this function is NOT allowed to decide, which is the same list as
 * `stepArena`'s: whether the shell opens, how long that takes, whether the hit
 * shuts it and whether it may fire are all answers from
 * `domain/mob/shulker-shell.ts`. The host supplies four facts and stores the
 * value it is handed back.
 */
export const stepShulker = (state: ArenaState): void => {
  const shulker = state.shulker
  const step = stepShulkerShell(shulker.shell, {
    hasTarget: shulker.hasTarget,
    damageTakenThisTick: shulker.hitThisFrame,
    healthPoints: shulker.healthPoints,
    maxHealthPoints: SHULKER_MAX_HEALTH,
  })

  shulker.shell = step.shell
  shulker.frames += 1
  // A blow belongs to one frame. See `ArenaShulker`.
  shulker.hitThisFrame = 0
  if (step.canFire) {
    shulker.shots += 1
  }
}

export const toggleShulkerTarget = (state: ArenaState): void => {
  state.shulker.hasTarget = !state.shulker.hasTarget
  state.note = state.shulker.hasTarget
    ? `the shulker has a target — ${String(SHULKER_OPENING_TICKS)} frames of . before it can fire`
    : 'the shulker has no target — it shuts on the next frame, unless it is still opening'
}

export const hitShulker = (state: ArenaState): void => {
  state.shulker.hitThisFrame = ARENA_SHULKER_BLOW
  state.shulker.healthPoints = Math.max(0, state.shulker.healthPoints - ARENA_SHULKER_BLOW)
  state.note = `hit the shulker for ${String(ARENA_SHULKER_BLOW)} — it lands on the next . step`
}

export const shulkerArmor = (state: ArenaState): number => shulkerShellArmorPoints(state.shulker.shell)

export const shulkerFlees = (state: ArenaState): boolean =>
  shulkerWantsToTeleport({
    hasTarget: state.shulker.hasTarget,
    damageTakenThisTick: state.shulker.hitThisFrame,
    healthPoints: state.shulker.healthPoints,
    maxHealthPoints: SHULKER_MAX_HEALTH,
  })

export const shellLabel = (shell: ShulkerShell): string => {
  switch (shell._tag) {
    case 'Closed':
      return 'Closed'
    case 'Opening':
      return `Opening ${String(shell.openedTicks)} / ${String(SHULKER_OPENING_TICKS)}`
    case 'Open':
      return 'Open'
    default: {
      const exhaustive: never = shell
      return exhaustive
    }
  }
}

export const shellFraction = (shell: ShulkerShell): number =>
  shell._tag === 'Opening'
    ? Math.min(1, Math.max(0, shell.openedTicks) / SHULKER_OPENING_TICKS)
    : shell._tag === 'Open'
      ? 1
      : 0

// ---------------------------------------------------------------------------
// Arena — the sweep
// ---------------------------------------------------------------------------

/**
 * Distances worth asking the sweep about, and every answer is the rule's.
 *
 * The first two are the ends of the spawn band, so the table shows the two rules
 * agreeing: nothing this repository can spawn is swept on the frame it spawns.
 */
export const DESPAWN_PROBES: ReadonlyArray<number> = [
  MIN_SPAWN_DISTANCE_BLOCKS,
  40,
  127,
  DESPAWN_DISTANCE_BLOCKS,
  129,
  Number.NaN,
]

export const sweepAt = (distanceBlocks: number, persistent: boolean): DespawnVerdict =>
  despawnVerdict({ distanceToPlayerBlocks: distanceBlocks, persistent })

export const sweepLabel = (verdict: DespawnVerdict): string =>
  verdict._tag === 'Keep' ? 'Keep' : `Despawn: ${verdict.reason}`

export const DESPAWN_RADIUS: number = DESPAWN_DISTANCE_BLOCKS

// ---------------------------------------------------------------------------
// Arena — the other drop tables
// ---------------------------------------------------------------------------

/**
 * Every drop table this repository can spell, driven by the rule.
 *
 * Three, and the list stops where kernel's vocabulary does: an enderman drops
 * `ENDER_PEARL` and a shulker `SHULKER_SHELL`, neither of which is an
 * `ItemType`, so neither has a table here. The arena's missing list says so with
 * the kernel row that would unblock them.
 */
export const ARENA_DROP_TABLES: ReadonlyArray<
  readonly [string, ReadonlyArray<MobDropRule>, number]
> = [
  ['creeper', CREEPER_DROPS, CREEPER_XP_REWARD],
  ['ghast', GHAST_DROPS, GHAST_XP_REWARD],
  ['blaze', BLAZE_DROPS, BLAZE_XP_REWARD],
]

/** What a table yields at a given chance roll. Every number is `rollMobDrops`'. */
export const dropsAtRoll = (rules: ReadonlyArray<MobDropRule>, chance: number): string => {
  const drops = rollMobDrops(rules, { _tag: 'Slain', lootingLevel: 0 }, () => ({ chance, count: 0 }))
  return drops.length === 0 ? '(nothing)' : drops.map((drop) => `${drop.item} x${String(drop.count)}`).join(', ')
}

export const fuseLabel = (fuse: CreeperFuse): string => {
  switch (fuse._tag) {
    case 'Dormant':
      return 'Dormant'
    case 'Lit':
      return `Lit ${fuse.burnedSecs.toFixed(2)} / ${String(CREEPER_FUSE_SECS)}s`
    case 'Detonated':
      return 'Detonated'
    default: {
      const exhaustive: never = fuse
      return exhaustive
    }
  }
}

export const fuseFraction = (fuse: CreeperFuse): number =>
  fuse._tag === 'Lit' ? Math.min(1, fuse.burnedSecs / CREEPER_FUSE_SECS) : fuse._tag === 'Detonated' ? 1 : 0

/**
 * A row of the damage curve, so the falloff is visible rather than asserted.
 *
 * Every number is `explosionDamageAmount` at run time. The two radii are worth
 * seeing side by side: ignition is 3 blocks and the blast reaches 6, so backing
 * out of the range that lights the fuse is not the same as being safe.
 */
export const blastCurve = (power: number): ReadonlyArray<readonly [number, number]> =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((distance) => [distance, explosionDamageAmount(power, distance)] as const)

export const blastRadius: typeof explosionRadius = explosionRadius

export const IGNITION_RANGE: number = CREEPER_IGNITION_RANGE_BLOCKS

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
 * What the arena HAS, with the file each part came out of.
 *
 * Checked against the tree rather than remembered: `domain/mob/` holds
 * `creeper-fuse.ts`, `enderman-teleport.ts`, `explosion.ts`,
 * `hostile-despawn.ts`, `hostile-spawn.ts`, `mob-drop.ts` and
 * `shulker-shell.ts`, and there is no eighth file.
 */
export const ARENA_IMPLEMENTED: ReadonlyArray<readonly [string, string]> = [
  ['spawn condition', 'domain/mob/hostile-spawn.ts — night, light <= 7, kernel’s validSpawnSurface, 16-40 blocks'],
  ['creeper fuse', 'domain/mob/creeper-fuse.ts — 3-block ignition, 1.5s, cancels on retreat, detonates once'],
  ['blast + death cause', 'domain/mob/explosion.ts — the reference’s curve, and the cause reaches the message'],
  ['enderman teleport', 'domain/mob/enderman-teleport.ts — three triggers, and an 8..32 block offset with no y'],
  ['shulker shell', 'domain/mob/shulker-shell.ts — 20 frames to open, one frame to shut, 20 armour when closed'],
  ['the sweep', 'domain/mob/hostile-despawn.ts — 128 blocks in 3D, and a persistent mob is exempt'],
  ['drop + experience', 'domain/mob/mob-drop.ts — creeper, ghast and blaze; nothing at all if it blew itself up'],
]

/**
 * What runs the seven rules above, now that mc-sim has published a roster.
 *
 * Separate from `ARENA_IMPLEMENTED` because none of it is a `domain/mob/` rule
 * and that list's own doc comment counts those files. These are the JOIN — the
 * loop `stages/registration.ts` spent a headed paragraph explaining why it could
 * not yet write, plus the two pieces that could only be written once something
 * was calling the rules for real.
 */
export const ARENA_WIRED: ReadonlyArray<readonly [string, string]> = [
  ['the stage runs them', 'domain/entities/mob-frame.ts — one sweep over mc-sim’s roster; an idle frame allocates nothing per mob'],
  ['mob death rewards reach the host', 'site.ts drains mobDrops into dropped-item entities and credits mobExperience to its cumulative XP ledger once per frame'],
  ['the population cap', 'MAX_HOSTILE_COUNT = 16 against countOfKind, re-read per candidate. The census hostile-spawn.ts was waiting for'],
  ['the blast crater', 'domain/interactions/explosion-crater.ts — floor(power) = 3, and every emptied cell feeds `disturb`'],
  ['rolls without an RNG', 'domain/frame-rolls.ts — a seed in the frame state, so a whole scenario replays'],
]

/**
 * What still has no mob, and where each piece would go.
 *
 * ---------------------------------------------------------------------------
 * The ratio, stated rather than drawn
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.11 names four mob behaviours and three of them are now written; the
 * fourth is the dragon and it is NOT here on purpose, which is the first line
 * below. The list is still longer than the section above and that is still the
 * honest shape of this repository: seven rule files against eleven things that
 * are not rules yet, and docs/porting.md §4's 61 portable mob test files against
 * the nine that have been ported.
 *
 * ---------------------------------------------------------------------------
 * What the missing list means
 * ---------------------------------------------------------------------------
 *
 * Each row is an unimplemented behaviour or a required measurement that this
 * repository cannot derive without crossing an ownership boundary.
 */
export const ARENA_MISSING: ReadonlyArray<readonly [string, string]> = [
  ['enderman / shulker DROPS', 'ender_pearl and shulker_shell are not ItemTypes. One row in mc-kernel’s roster, no edit here'],
  ['where a teleport LANDS', 'the offset has no y and no ground check — a ChunkStore query, next to domain/interactions/'],
  // WAS: 'endermanTeleportUrge needs damagedThisStep and stuckTicks; mc-sim's
  // entity has neither field'. That was the right observation and the wrong
  // conclusion — mc-sim carries per-mob rule state on a type parameter that
  // mx-gameplay instantiates, so `damagedThisStep` went on `MobBehaviour` as
  // `EndermanFlinch` and needed no change in mc-sim at all. Only the half that is
  // genuinely unmeasurable is left, and it names the lane it is waiting for.
  ['an enderman’s stuckTicks', 'the > 40 branch needs a movement lane reporting no progress. Deriving it from "the position did not change" makes it a frame counter, because nothing writes feetPosition but the teleport'],
  // WAS: 'an enderman off the SPAWNER — the teleport is wired and a host can
  // spawn one, but MobSpawnAttempt carries no kind, and MAX_HOSTILE_COUNT would
  // have to become a sum'. Both were deferrals rather than refusals and both are
  // done: the attempt carries a kind, `HOSTILE_KINDS` is the roster the search
  // picks from, and the cap is a sum over it. An enderman now arrives from the
  // spawner like any other hostile.
  ['water / daylight teleports', 'vanilla’s other two triggers. Needs a "submerged" capability from kernel and mc-worldgen’s sky light'],
  ['the shulker’s bullet', 'computeShulkerBulletDirection is a normalised vector — aiming is mc-physics’, canFire is here'],
  ['a shulker on the roster', 'ShulkerShell fits MobBehaviour unchanged and the enderman’s wiring shows the roster is no obstacle. What blocks it is that canFire is a permission to fire a projectile nothing produces, and that hasTarget and maxHealthPoints have no measurement on this side'],
  ['projectile + melee cadence', 'canFire is a permission with no cooldown; attackCooldownRemaining is mc-sim’s combat state'],
  ['the armour formula', '4% per point, capped at 80% — every defender shares it, so it belongs in a domain/combat/, not here'],
  ['age-based despawn', 'vanilla sweeps on time as well as distance; the reference has no age on an entity and neither has this'],
  ['the mob roster’s other SIX', 'HOSTILE_KINDS has two rows and the reference rotates eight. The missing six are not a table this repository can copy — each needs a domain/mob/ rule behind it, or the row is a claim that this build has zombies. The PICK is also uniform where the reference uses a round-robin cursor, which is per-world state and therefore mc-sim’s'],
  ['AI / pathfinding', 'the creeper’s distance is an arrow key on this screen. The teleport is now the ONLY write to feetPosition anywhere — walking, chasing and fleeing on foot are all still missing'],
  // WAS: 'THE SPAWN SEARCH — the stage applies the verdict to candidates it is
  // handed. The ring that offers them needs mc-worldgen's block LIGHT
  // (ChunkStoreApi has no light query) and mc-sim's hour'. Both halves are
  // answered. mc-worldgen built the light grid it had claimed to own since
  // `application/chunk-store.ts`'s header was written, `ChunkStoreApi.getLight`
  // is the query, and the hour reaches the stage through an inbox `Ref` argued
  // in `stages/registration.ts` beside `targetPosition`'s. The ring itself is
  // `domain/entities/mob-spawn-search.ts`. What is left of the row is the ONE
  // measurement that is still a stand-in.
  ['a spawn candidate’s ALTITUDE', 'the ring searches the player’s own feet plane, not the surface. The reference scans down a column, which is the scan whose lack of a surface test hostile-spawn.ts was written to fix; the honest replacement is a heightmap the STORE maintains, since surfaceHeightAt answers about generated terrain and not about anything a player built'],
  ['the player’s position', 'targetPosition is an inbox. PlayerService.cameraPose requires ClockPort, and a local ClockPort is worse than a narrow mirror'],
  ['a mob’s death CAUSE', 'explosionDamageAt carries one and applyDamage records it; mc-sim’s EntityState has no field for it, so it is dropped'],
  ['blast resistance', 'the crater sets every cell to AIR — obsidian and bedrock included. One flag in kernel’s capability table, no edit here'],
  // ---- what the loot table and the placement rule did NOT close ------------
  // WAS: 'items reaching the inventory — minedItems and consumedItems are
  // outboxes ... mirroring InventoryServiceApi whole means restating
  // Inventory/RecipeTable/CraftGrid/RecipeMatch/CraftResult'. The price was
  // paid: domain/inventory-port.ts carries that vocabulary as dead weight and
  // gameplay:interactions calls add(). What is left of the row is the OTHER
  // direction.
  // WAS: 'a placement CHARGING the player'.
  // CLOSED: the stage reserves inventory before placeBlock and restores it on refusal.
  ['durability', 'usedItems is an outbox and half of it has no method to become a call to: lighting a portal DAMAGES a flint and steel by one point, and mc-sim’s published api has no damageSlot at all'],
  ['the held TOOL', 'heldTool is an inbox. Which slot is selected and what is enchanted on it is InventoryService’s; the tier gate is live and the value reaching it is a stand-in'],
  ['a block popping off', 'canBlockStaySupported is checked at PLACEMENT time only. The other half needs a disturb-shaped queue for attachments, and a sweep would be DN-GP-1 rebuilt'],
  ['apple / sapling / seeds', 'three of the reference’s four bonus drop lines have no ItemType. rollLeafDrops yields all three and only `stick` can ship — see UNITEMISED_BLOCK_TYPES, which exists so this is data'],
  ['gravel -> flint', 'vanilla’s 10%. NOT ported, and that is docs/porting.md §4 rather than an oversight: the reference implementation has no such rule, and a drop rate is exactly the kind of change that should arrive with a measurement'],
  ['silk touch as a SUBSTITUTION', 'kernel models it as a GATE, so "stone drops itself instead of cobblestone" is not expressible. The additive fix is one optional `silkTouchItem` on kernel’s BlockDropRule'],
  ['who OWNS the weather', 'the rule is here and holds nothing; the countdown reaches the frame as an inbox and leaves as an outbox. mc-sim has a TimeService and no weather service at all, so this is the one noun with a rule and NO owner'],
  ['the lightning strike', 'weather === thunder && exposedToSky is the reference’s hazard (environment.ts:101). The damage lands on a player, and a player’s health is PlayerService’s — the same wall mobXpReward is behind'],
  ['weather in the SKY', 'weatherLightScale is a number this repository can compute and nobody here can apply. The reference’s same function also sets two HSL triples, and a sky tint is mc-render’s'],
]
