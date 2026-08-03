import { Either, Schema } from 'effect'

export const ENDER_DRAGON_MAX_HEALTH = 200
export const ENDER_DRAGON_DEATH_XP = 12_000
export const ENDER_DRAGON_CONTACT_DAMAGE = 10

export const ENDER_DRAGON_PHASE_DURATION_SECS = {
  circling: 10,
  perching: 4,
  charging: 2,
} as const

export const EnderDragonPhaseSchema = Schema.Literal('circling', 'perching', 'charging', 'dead')
export type EnderDragonPhase = typeof EnderDragonPhaseSchema.Type

const HealthSchema = Schema.Number.pipe(Schema.finite(), Schema.between(0, ENDER_DRAGON_MAX_HEALTH))
const PhaseTimerSchema = Schema.Number.pipe(Schema.finite(), Schema.nonNegative())

export const EnderDragonEncounterSnapshotSchema = Schema.Struct({
  phase: EnderDragonPhaseSchema,
  phaseTimerSecs: PhaseTimerSchema,
  health: HealthSchema,
  rewardEmitted: Schema.Boolean,
})
export type EnderDragonEncounterSnapshot = typeof EnderDragonEncounterSnapshotSchema.Type

export type EnderDragonEncounterEvent =
  | { readonly _tag: 'DragonDamagedByPlayer'; readonly amount: number; readonly remainingHealth: number }
  | { readonly _tag: 'PlayerDamaged'; readonly amount: typeof ENDER_DRAGON_CONTACT_DAMAGE }
  | { readonly _tag: 'ExperienceRewarded'; readonly amount: typeof ENDER_DRAGON_DEATH_XP }
  | { readonly _tag: 'ExitPortalMaterializationRequested'; readonly dimension: 'end' }
  | { readonly _tag: 'DragonEggRewarded'; readonly item: 'dragon_egg'; readonly count: 1 }

export type EnderDragonDamageResult =
  | {
      readonly _tag: 'Applied'
      readonly state: EnderDragonEncounterSnapshot
      readonly events: ReadonlyArray<EnderDragonEncounterEvent>
    }
  | { readonly _tag: 'Rejected'; readonly reason: 'invalid-damage' | 'dragon-defeated' }

const PlayerDamageSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(ENDER_DRAGON_MAX_HEALTH),
)

export const initialEnderDragonEncounter = (): EnderDragonEncounterSnapshot => ({
  phase: 'circling',
  phaseTimerSecs: 0,
  health: ENDER_DRAGON_MAX_HEALTH,
  rewardEmitted: false,
})

export const decodeEnderDragonEncounterSnapshot = (
  input: unknown,
): EnderDragonEncounterSnapshot | undefined => {
  const decoded = Schema.decodeUnknownEither(EnderDragonEncounterSnapshotSchema)(input)
  if (Either.isLeft(decoded)) return undefined

  const snapshot = decoded.right
  const consistentDeath = snapshot.phase === 'dead'
    ? snapshot.health === 0 && snapshot.rewardEmitted
    : snapshot.health > 0 && !snapshot.rewardEmitted
  const validTimer = snapshot.phase === 'dead'
    ? snapshot.phaseTimerSecs === 0
    : snapshot.phaseTimerSecs < ENDER_DRAGON_PHASE_DURATION_SECS[snapshot.phase]

  return consistentDeath && validTimer ? snapshot : undefined
}

const deathRewards = (): ReadonlyArray<EnderDragonEncounterEvent> => [
  { _tag: 'ExperienceRewarded', amount: ENDER_DRAGON_DEATH_XP },
  { _tag: 'ExitPortalMaterializationRequested', dimension: 'end' },
  { _tag: 'DragonEggRewarded', item: 'dragon_egg', count: 1 },
]

export const damageEnderDragonByPlayer = (
  state: EnderDragonEncounterSnapshot,
  input: unknown,
): EnderDragonDamageResult => {
  const decoded = Schema.decodeUnknownEither(PlayerDamageSchema)(input)
  if (Either.isLeft(decoded)) return { _tag: 'Rejected', reason: 'invalid-damage' }
  if (state.phase === 'dead') return { _tag: 'Rejected', reason: 'dragon-defeated' }

  const amount = decoded.right
  const health = Math.max(0, state.health - amount)
  const damageEvent: EnderDragonEncounterEvent = {
    _tag: 'DragonDamagedByPlayer',
    amount,
    remainingHealth: health,
  }
  if (health > 0) {
    return { _tag: 'Applied', state: { ...state, health }, events: [damageEvent] }
  }

  const next: EnderDragonEncounterSnapshot = {
    phase: 'dead',
    phaseTimerSecs: 0,
    health: 0,
    rewardEmitted: true,
  }
  return {
    _tag: 'Applied',
    state: next,
    events: [damageEvent, ...deathRewards()],
  }
}

const nextPhase = (phase: Exclude<EnderDragonPhase, 'dead'>): Exclude<EnderDragonPhase, 'dead'> => {
  if (phase === 'circling') return 'perching'
  if (phase === 'perching') return 'charging'
  return 'circling'
}

export const advanceEnderDragonEncounter = (
  state: EnderDragonEncounterSnapshot,
  deltaSecs: number,
): readonly [EnderDragonEncounterSnapshot, ReadonlyArray<EnderDragonEncounterEvent>] => {
  if (!Number.isFinite(deltaSecs) || deltaSecs <= 0 || state.phase === 'dead') return [state, []]

  let phase = state.phase
  let timer = state.phaseTimerSecs + deltaSecs
  const events: Array<EnderDragonEncounterEvent> = []
  while (timer >= ENDER_DRAGON_PHASE_DURATION_SECS[phase]) {
    timer -= ENDER_DRAGON_PHASE_DURATION_SECS[phase]
    phase = nextPhase(phase)
    if (phase === 'charging') events.push({ _tag: 'PlayerDamaged', amount: ENDER_DRAGON_CONTACT_DAMAGE })
  }

  return [{ ...state, phase, phaseTimerSecs: timer }, events]
}
