/**
 * Death causes, and carrying one all the way to the death message.
 *
 * ---------------------------------------------------------------------------
 * The measured mistake this file exists to prevent
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.11: 「死因はドロップせず死亡メッセージまで運ぶ(参照実装では全死亡が
 * 「You died.」になるバグがあった)」. The reference's own post-mortem, at
 * `packages/app/application/frame/stages/physics-stage-health.ts:32-34`:
 *
 *     Forward the cause: survival effects (lava/fire/drowning/…) pass one and
 *     the death screen renders it — a (amount)-only closure silently dropped
 *     every cause and made all deaths read as the generic "You died."
 *
 * Note the shape of that bug. Nothing crashed, no test failed, no type was
 * violated: an intermediate helper was written as `(amount: number) => …`, the
 * cause had nowhere to go, and every death in the game printed the fallback
 * string. The mechanism that produced the bug was an OPTIONAL argument
 * disappearing across a call boundary.
 *
 * So the defence here is structural rather than diligent: `cause` is a required
 * field of `Damage`, `applyDamage` is the only way to reduce health, and there
 * is no overload that takes a bare number. Writing the reference's bug requires
 * deleting a field, not forgetting an argument.
 *
 * ---------------------------------------------------------------------------
 * Only the killing blow's cause is kept
 * ---------------------------------------------------------------------------
 *
 * A player who falls into lava takes fall damage and then burn damage. The
 * message must name what actually killed them, so `lastDeathCause` is written
 * on the transition to zero health and at no other time — the reference does
 * the same via `justDied ? Option.some(cause) : s.lastDeathCause`
 * (`packages/entity/application/health-service.ts:82`).
 *
 * ---------------------------------------------------------------------------
 * Where the strings will eventually live
 * ---------------------------------------------------------------------------
 *
 * `DEATH_MESSAGES` is English-only and lives in the module that owns the rule,
 * mirroring the reference's `packages/entity/domain/player-damage-cause.ts:31`.
 * When localisation arrives, mx-gameplay should emit the `DeathCause` and let
 * mx-ui resolve the string — the cause is the fact, the sentence is a
 * presentation concern. Doing that now would mean inventing an i18n contract
 * before there is a screen to consume it.
 */

export type DeathCause =
  | 'fall'
  | 'lava'
  | 'cactus'
  | 'fire'
  | 'drowning'
  | 'suffocation'
  | 'starvation'
  | 'mob'
  | 'projectile'
  | 'explosion'
  | 'void'
  | 'ender_pearl'
  | 'poison'
  | 'generic'

/**
 * `generic` maps to the reference's fallback string. It is a legitimate cause —
 * `/kill`, an unattributed defect — not a stand-in for "we lost the real one".
 * The regression test asserts that the OTHER twelve never resolve to it.
 *
 * `ender_pearl` ARRIVED WITH ITS RULE, which is the condition this union is meant
 * to be extended under. The reference's `PlayerDamageCause`
 * (`<reference-impl>/packages/entity/domain/player-damage-cause.ts:1-15`) has
 * fourteen members and this transcription initially left `cactus`, `lightning`
 * and `ender_pearl` out because no rule here produced any of them. The ender
 * pearl and environmental contact rules now produce two of those causes, so
 * their members complete the partial transcription rather than inventing terms.
 *
 * `lightning` remains absent for that reason. Adding a cause with no rule behind
 * it would claim that this build can kill you that way, which is the direction
 * `./entities/mob-frame.ts`'s `HOSTILE_KINDS` refuses for the zombie.
 *
 * NOTE THAT THIS IS THIS REPOSITORY'S OWN VOCABULARY and not a mirror of somebody
 * else's: `DeathCause` is exported from `index.ts`, it is not one of the nine
 * provisional stand-ins listed there, and mc-dev-meta's `MIRROR_SPECS` has no row
 * for this file. Extending it needs no kernel word — which is exactly what
 * `bow` / `arrow` / `ender_pearl` as ITEM names do need, and the contrast is the
 * point. A cause is a rule's output; an item is a name.
 */
export const DEATH_MESSAGES: Readonly<Record<DeathCause, string>> = {
  fall: 'You fell from a high place.',
  lava: 'You tried to swim in lava.',
  cactus: 'You were pricked to death.',
  fire: 'You burned to death.',
  drowning: 'You drowned.',
  suffocation: 'You suffocated in a wall.',
  starvation: 'You starved to death.',
  mob: 'You were slain by a monster.',
  projectile: 'You were shot.',
  explosion: 'You blew up.',
  void: 'You fell out of the world.',
  ender_pearl: 'You teleported too hard.',
  poison: 'You were poisoned.',
  generic: 'You died.',
}

export const describeDeath = (cause: DeathCause): string => DEATH_MESSAGES[cause]

/**
 * One application of damage. `cause` is required, and that is the whole point of
 * the type.
 */
export type Damage = {
  readonly amount: number
  readonly cause: DeathCause
}

export type Vitals = {
  readonly healthPoints: number
  /** Written only on the transition to zero. `undefined` means "still alive". */
  readonly lastDeathCause: DeathCause | undefined
}

export const MAX_HEALTH_POINTS = 20

export const fullHealth: Vitals = { healthPoints: MAX_HEALTH_POINTS, lastDeathCause: undefined }

export const isDead = (vitals: Vitals): boolean => vitals.healthPoints <= 0

/**
 * Apply damage, recording the cause if and only if this blow is the fatal one.
 *
 * Damage to an already-dead player is ignored, so a corpse hit by a second
 * creeper does not have its death message rewritten.
 */
export const applyDamage = (vitals: Vitals, damage: Damage): Vitals => {
  if (isDead(vitals) || !Number.isFinite(damage.amount)) {
    return vitals
  }

  const healthPoints = Math.max(0, vitals.healthPoints - Math.max(0, damage.amount))
  const justDied = healthPoints <= 0

  return {
    healthPoints,
    lastDeathCause: justDied ? damage.cause : vitals.lastDeathCause,
  }
}

/**
 * The message the death screen shows, or `undefined` while the player lives.
 *
 * A dead player with no recorded cause is impossible by construction (the only
 * route to zero health is `applyDamage`, which always records), so the `??`
 * below is a total-function formality rather than a real fallback. If it ever
 * fires, something has constructed a `Vitals` by hand.
 */
export const deathMessage = (vitals: Vitals): string | undefined =>
  isDead(vitals) ? describeDeath(vitals.lastDeathCause ?? 'generic') : undefined
