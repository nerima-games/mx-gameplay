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
 * The mob arena has ONE mob, and the screen says which
 * ---------------------------------------------------------------------------
 *
 * This screen used to open with the line "THERE IS NO MOB" and list what was
 * missing, because `domain/` held nine files and none of them named a mob. Four
 * of them now do — `domain/mob/creeper-fuse.ts`, `explosion.ts`,
 * `hostile-spawn.ts` and `mob-drop.ts` — so the arena drives a real creeper:
 * spawn condition, fuse, blast, death cause and drop, every number produced by
 * a rule in this repository rather than by this file.
 *
 * The habit does not change. What still has no mob is still listed, by name and
 * with a destination, and the list is longer than the implemented part —
 * enderman, shulker and dragon are three of plan.md §3.11's four, and pathing,
 * melee and the mob roster are not here either. A preview that stopped naming
 * its gaps the moment it had something to show would be worth less than the one
 * that admitted it had nothing.
 *
 * ---------------------------------------------------------------------------
 * The preview is the HOST, and that is the interesting part
 * ---------------------------------------------------------------------------
 *
 * `domain/mob/` holds no creeper. It holds the rules a creeper obeys, and every
 * one of them is a total function from a value to a value: mc-sim owns where the
 * mob is, how far away the player is, and what its fuse currently reads
 * (plan.md §7 — 「状態管理は sim、AI/スポーン/ドロップのルールは gameplay」).
 *
 * mc-sim is not published, so THIS FILE plays that part, and the shape of what
 * it has to hold is exactly the shape mc-sim will: a `CreeperFuse` value, a
 * distance, and nothing else. `ArenaCreeper` below is four fields long, and that
 * is the whole bill the mob rules present to a host. Reading it is the fastest
 * way to see what this repository does and does not claim to own.
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
import { AIR_BLOCK_ID, type BlockId } from '../../domain/chunk-store-port'
import { DeltaTimeSecs } from '../../domain/frame-contract'
import {
  CREEPER_FUSE_SECS,
  CREEPER_IGNITION_RANGE_BLOCKS,
  DORMANT_FUSE,
  stepCreeperFuse,
  type CreeperFuse,
} from '../../domain/mob/creeper-fuse'
import { explosionDamageAmount, explosionDamageAt, explosionRadius } from '../../domain/mob/explosion'
import {
  canHostileSpawnAt,
  MIN_SPAWN_DISTANCE_BLOCKS,
  type SpawnCandidate,
  type SpawnVerdict,
} from '../../domain/mob/hostile-spawn'
import {
  CREEPER_DROPS,
  CREEPER_XP_REWARD,
  LOWEST_ROLLS,
  mobXpReward,
  rollMobDrops,
  type MobDrop,
} from '../../domain/mob/mob-drop'

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

export type ArenaState = {
  vitals: Vitals
  causeIndex: number
  amountIndex: number
  log: ReadonlyArray<ArenaBlow>
  site: ArenaSpawnSite
  creeper: ArenaCreeper | undefined
  /** The last answer `canHostileSpawnAt` gave, verbatim. */
  verdict: SpawnVerdict | undefined
  lootingLevel: number
  /** What the last dead creeper left. Empty after a self-destruct, by rule. */
  loot: ReadonlyArray<MobDrop>
  xp: number
  note: string
}

/** Blocks a spawned creeper starts at. The near end of the reference's band. */
export const ARENA_SPAWN_DISTANCE = MIN_SPAWN_DISTANCE_BLOCKS

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

export const initialArenaState = (): ArenaState => ({
  vitals: fullHealth,
  causeIndex: 0,
  amountIndex: 1,
  log: [],
  site: { groundBlock: 2, blockLight: 0, distanceBlocks: 20 },
  creeper: undefined,
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
  [2, 'stone'],
  [5, 'sand'],
  [10, 'oak_leaves'],
  [13, 'glass'],
  [6, 'water'],
  [AIR_BLOCK_ID, 'air'],
  [200, 'id 200 (unknown)'],
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

export const fuseLabel = (fuse: CreeperFuse): string => {
  switch (fuse._tag) {
    case 'Dormant':
      return 'Dormant'
    case 'Lit':
      return `Lit ${fuse.burnedSecs.toFixed(2)} / ${String(CREEPER_FUSE_SECS)}s`
    case 'Detonated':
      return 'Detonated'
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

export const blastRadius = explosionRadius

export const IGNITION_RANGE = CREEPER_IGNITION_RANGE_BLOCKS

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
 * `creeper-fuse.ts`, `explosion.ts`, `hostile-spawn.ts` and `mob-drop.ts`, and
 * there is no fifth file.
 */
export const ARENA_IMPLEMENTED: ReadonlyArray<readonly [string, string]> = [
  ['spawn condition', 'domain/mob/hostile-spawn.ts — night, light <= 7, kernel’s validSpawnSurface, 16-40 blocks'],
  ['creeper fuse', 'domain/mob/creeper-fuse.ts — 3-block ignition, 1.5s, cancels on retreat, detonates once'],
  ['blast + death cause', 'domain/mob/explosion.ts — the reference’s curve, and the cause reaches the message'],
  ['drop + experience', 'domain/mob/mob-drop.ts — one gunpowder, and nothing at all if it blew itself up'],
]

/**
 * What still has no mob, and where each piece would go.
 *
 * The list this screen has always printed, minus the four lines that came true
 * and plus the ones the creeper made specific. It is longer than the section
 * above, which is the honest ratio: plan.md §3.11 names four mob behaviours and
 * this repository has one, and docs/porting.md §4 counts 61 portable mob test
 * files against the six this repository has ported.
 */
export const ARENA_MISSING: ReadonlyArray<readonly [string, string]> = [
  ['enderman / shulker / dragon', 'three of plan.md §3.11’s four behaviours; only the creeper is written'],
  ['the mob roster', 'the reference rotates 8 hostiles; CREEPER_DROPS is the only definition here'],
  ['AI / pathfinding', 'the creeper’s distance is an arrow key on this screen. Movement needs mc-sim’s positions'],
  ['melee + projectile handlers', 'two of the ~40 one-rule-per-file handlers (DN-GP-9); domain/interactions/ holds one'],
  ['the blast crater', 'explosions destroy blocks out to floor(power)=3 — a ChunkStore write that must also `disturb`'],
  ['despawn + population caps', 'DESPAWN_DISTANCE, MAX_HOSTILE_COUNT: every one of them reads mc-sim’s roster'],
  ['mob HEALTH and POSITION as state', 'mc-sim owns both. The fuse here is a value a rule transforms, never a Ref'],
  ['a stage that runs any of it', 'gameplay:entities still runs only the cascade — there is no mob to iterate over'],
]
