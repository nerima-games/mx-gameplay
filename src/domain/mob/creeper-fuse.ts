/**
 * ONE RULE, ONE FILE (DN-GP-9): a creeper close enough to its target lights its
 * fuse, and a fuse that burns out explodes exactly once.
 *
 * Ported from `packages/entity/domain/mob/creeper-fuse.ts` in `<reference-impl>`
 * — the constants and the cancellation semantics are that file's, and its two
 * test files (`packages/entity/test/mob/creeper-fuse.test.ts` and the older
 * `packages/entity/test/creeper-fuse.test.ts`) are the oracle `test/mob.test.ts`
 * ports. docs/porting.md §4 says to move the tests first and not to reinvent the
 * specification; this is the first mob rule to do it.
 *
 * plan.md §3.11 lists four mob behaviours 「クリーパー起爆・エンダーマンテレポート・
 * シュルカー・ドラゴン」 and this is the first because it is the only one of the
 * four that is a STATE MACHINE WITH A TIMER AND AN IRREVERSIBLE END. A teleport
 * is a function call; a fuse has to answer "what if the player steps back",
 * "what if the frame runs twice in one tick", "what if it already went off".
 *
 * ---------------------------------------------------------------------------
 * What is a rule here and what is mc-sim's
 * ---------------------------------------------------------------------------
 *
 * plan.md §7 splits the mob row: 「状態管理は sim、AI/スポーン/ドロップのルールは
 * gameplay」. Applied to this file, in the direction that shows up in a signature:
 *
 *   mc-sim's (NOUNS)          where the creeper is, where the player is, how
 *                             much health either has, and — the one that is
 *                             easiest to reach for — WHICH creeper this is.
 *                             There is no entity id in this file. An id is a
 *                             key into a roster, and the roster is
 *                             `EntityManager`'s.
 *
 *   this repository's (VERB)  "within three blocks" — the threshold, the
 *                             countdown, the cancellation, and the once-only
 *                             detonation.
 *
 * The model is `domain/day-night.ts`, which holds nothing because mc-sim owns
 * the hour (DN-GP-7). A fuse is more than a fraction, so this file cannot be a
 * function of one number — but it is still a TOTAL FUNCTION FROM A VALUE TO A
 * VALUE, exactly as `Vitals` is in `../death-cause`:
 *
 *     next = stepCreeperFuse(previous, senses, dt)
 *
 * No `Ref`, no map from entity to fuse, no way to enumerate creepers. Ask the
 * save-file question `stages/registration.ts` states and the answer comes out
 * the same as the reference's: the CREEPER is saved state (mc-sim's), and
 * `fuseSecs` is a field of it that the reference persists (`entity.ts:81`,
 * serialised only while it is non-zero, `entity-utils.ts:42`). This rule
 * computes that field; it does not own it.
 *
 * ---------------------------------------------------------------------------
 * Backing away puts the fuse out, and it goes ALL the way out
 * ---------------------------------------------------------------------------
 *
 * `packages/entity/domain/mob/creeper-fuse.ts:6-9` states the intent and :49
 * implements it: out of range returns `initialCreeperFuse` — a hard reset to
 * zero, not a pause and not a decay. Re-entering range therefore starts a fresh
 * full fuse.
 *
 * That is worth stating rather than inheriting, because the alternative is a
 * real design and a worse one. A committed fuse leaves the player two outcomes
 * (take the blast, or kill it inside 1.5 seconds) and removes the only answer a
 * player without a weapon has, which is to walk away. The cost of the reset is
 * that a creeper cannot corner you by attrition; that is the trade, and it is
 * the reference's.
 *
 * Two consequences, both pinned by name in `test/mob.test.ts`: a cancelled fuse
 * keeps NO memory (a creeper that remembered 1.4 burned seconds would kill you
 * for stepping in twice), and a fuse that stays in range NEVER restarts — it
 * accumulates monotonically, which is what makes "1.5 seconds" mean anything.
 *
 * ---------------------------------------------------------------------------
 * Two divergences from the reference, both deliberate
 * ---------------------------------------------------------------------------
 *
 * 1. THE STATES ARE A UNION, NOT A RECORD. The reference's state is
 *    `{ fuseSecs: number; ignited: boolean }` (`creeper-fuse.ts:17-20`), whose
 *    two fields can disagree — and downstream they do: the frame lane rebuilds
 *    `ignited` as `fuseSecs > 0` rather than reading it
 *    (`entity-manager-update-maintenance.ts:34`), so the stored flag is dead
 *    data that still typechecks. A tagged union cannot be in that state:
 *    `Dormant` carries no time, so "not ignited with 0.8 seconds on the clock"
 *    is not expressible.
 *
 * 2. DETONATION IS A TRANSITION, NOT A PREDICATE. The reference computes a
 *    `detonate` flag and THROWS IT AWAY in the lane that ticks the fuse
 *    (`entity-manager-update-maintenance.ts:36` keeps only `.state.fuseSecs`);
 *    the explosion is re-derived later by re-testing the stored number
 *    (`entity-manager-creeper-detonation.ts:19`, `fuseSecs < 1.5 -> null`).
 *    Two things follow from that shape, and only one of them is intended:
 *
 *      - the once-only-ness of the blast is not a property of the fuse at all.
 *        It is `HashMap.remove` in a third file (`entity-manager-combat.ts:60`).
 *        A creeper that survived the removal would satisfy the predicate again
 *        on the next pass, and again after that.
 *      - the predicate has no range check, so once the stored fuse reaches 1.5
 *        seconds, running away no longer helps. Cancellation works during the
 *        burn and not at the end of it.
 *
 *    Here, `blast` is produced on the single step that crosses the threshold and
 *    `Detonated` is terminal, so "exactly once" is a property of the machine and
 *    survives whatever the host does with the entity afterwards. It also closes
 *    the second gap: there is no step at which a full fuse has not yet gone off.
 *
 * ---------------------------------------------------------------------------
 * Why `dt` is branded and the distance is not
 * ---------------------------------------------------------------------------
 *
 * `DeltaTimeSecs` refuses `NaN` and refuses a negative AT CONSTRUCTION
 * (`../frame-contract`), so a fuse cannot be advanced by a non-number and cannot
 * be wound backwards. That brand is load-bearing rather than decorative: the
 * preview's finding F5 is a bare `number` reaching `applyDamage`, where a single
 * `NaN` makes the player permanently immortal. The same argument arrives here as
 * "a `NaN` delta would leave a fuse that never ends and never explodes" — a mob
 * that hisses forever.
 *
 * The distance stays a plain number because it is a MEASUREMENT mc-sim takes,
 * not a quantity this repository owns, and because the rule is total over every
 * value one can be: `NaN <= 3` is `false`, so an unmeasurable distance is nobody
 * in range, which is the inert answer.
 */
import type { DeltaTimeSecs } from '../frame-contract'
import {
  CHARGED_CREEPER_EXPLOSION_POWER,
  CREEPER_EXPLOSION_POWER,
  type Explosion,
} from './explosion'

/**
 * Inside this many blocks, a dormant fuse lights.
 *
 * `packages/entity/domain/mob/creeper-fuse.ts:14`. INCLUSIVE: the reference
 * tests `distance <= CREEPER_IGNITION_RANGE` (:47) and its oracle asserts that
 * a player at exactly 3.0 ignites (`test/mob/creeper-fuse.test.ts:44-48`).
 */
export const CREEPER_IGNITION_RANGE_BLOCKS = 3

/**
 * How long a lit fuse burns, in SECONDS.
 *
 * `packages/entity/domain/mob/creeper-fuse.ts:15`. Seconds and not ticks: the
 * reference's tick function takes `dtSecs` and never touches its
 * `GAME_TICKS_PER_SEC`, so the fuse is frame-rate independent by construction
 * rather than by a conversion somebody has to remember.
 */
export const CREEPER_FUSE_SECS = 1.5

/**
 * The whole of a creeper's behavioural state. Three cases, one terminal.
 *
 * A tagged union rather than the reference's flag-plus-number, for the reason
 * in the module header. `switch` over `_tag` is exhaustive, so a fourth case (a
 * charged creeper, a swell-then-retreat) stops `tsc` at every decision point
 * rather than falling through one of them.
 */
export type CreeperFuse =
  /** Nobody near enough to react to. The state a freshly spawned creeper is in. */
  | { readonly _tag: 'Dormant' }
  /**
   * Hissing. `burnedSecs` is how long it has burned, always in `[0, 1.5)`.
   *
   * Burned rather than remaining, because that is the number the reference
   * persists on the entity and the number a renderer's flash reads
   * (`entity-renderer.ts:111-116`, `fuseSecs / CREEPER_FUSE_SECONDS`). A host
   * that stores this is storing mc-sim's field, not a second representation.
   */
  | { readonly _tag: 'Lit'; readonly burnedSecs: number }
  /** Gone off. TERMINAL: no input takes a creeper back out of this. */
  | { readonly _tag: 'Detonated' }

/** The state a freshly spawned creeper is in. */
export const DORMANT_FUSE: CreeperFuse = { _tag: 'Dormant' }

/**
 * What this rule is allowed to know about the world on this step.
 *
 * One field, deliberately. Everything else a creeper could react to — line of
 * sight, armour, whether it is on fire — is a further QUESTION ABOUT STATE, and
 * every one added here is a fact mc-sim has to supply on every frame for every
 * creeper. The type is therefore the bill this rule presents to its host, and it
 * should be readable in one line.
 *
 * `undefined` means NO TARGET: no player in this world, the player is dead, the
 * player is in another dimension. It is not a very large distance, even though
 * both leave the fuse alone, because a distance of `Infinity` is a measurement
 * and the absence of one is not. The reference arms against the CLOSEST of
 * several players (`entity-manager-update-maintenance.ts:33`,
 * `nearestPlayerPosition`) — that selection is the host's, and this field is its
 * answer.
 */
export type CreeperSenses = {
  /** Blocks between this creeper and its target, measured by mc-sim. */
  readonly distanceToTargetBlocks: number | undefined
  /** Whether a prior lightning strike has charged this creeper. */
  readonly charged?: boolean
}

/**
 * The result of one step: the fuse to store back, and the explosion if this was
 * the step that ended it.
 *
 * `explosion` is present on EXACTLY ONE step per creeper — the transition into
 * `Detonated` — and `undefined` on every other, including every later step of an
 * already-detonated one.
 */
export type CreeperStep = {
  readonly fuse: CreeperFuse
  readonly explosion: Explosion | undefined
}

/**
 * TOTAL over every distance, including the ones a measurement should not
 * produce. `NaN <= 3` is `false`, so an unmeasurable distance is nobody in
 * range — the inert answer, and the one that cannot light a fuse by accident.
 */
const withinIgnitionRange = (senses: CreeperSenses): boolean =>
  senses.distanceToTargetBlocks !== undefined &&
  senses.distanceToTargetBlocks <= CREEPER_IGNITION_RANGE_BLOCKS

/**
 * Burn a fuse that is in range, and detonate it if that finishes it.
 *
 * The threshold is `>=` and OVERSHOOT COUNTS (`creeper-fuse.ts:51`): a frame
 * long enough to skip past 1.5 seconds detonates on that frame rather than
 * deferring to the next one, so a lag spike cannot buy the player time.
 */
const burn = (burnedSoFar: number, dt: DeltaTimeSecs, charged: boolean): CreeperStep => {
  const burnedSecs = burnedSoFar + dt

  return burnedSecs < CREEPER_FUSE_SECS
    ? // Monotone: `burnedSecs` only ever moves up, so a fuse that stays in
      // range cannot restart. `dt = 0` lands here unchanged.
      { fuse: { _tag: 'Lit', burnedSecs }, explosion: undefined }
    : {
        fuse: { _tag: 'Detonated' },
        explosion: {
          source: 'creeper',
          power: charged ? CHARGED_CREEPER_EXPLOSION_POWER : CREEPER_EXPLOSION_POWER,
        },
      }
}

/**
 * Advance one creeper by one frame.
 *
 * TOTAL and pure: the same three arguments always produce the same step, which
 * is what lets `test/mob.test.ts` ENUMERATE the machine rather than sample it.
 * plan.md §5.1-3 makes determinism the precondition for using the reference's
 * tests as an oracle, and this rule has no clock, no RNG and no ambient state to
 * break it with.
 *
 * `dt = 0` is legal and ADVANCES NOTHING rather than being rejected: a frame may
 * be scheduled twice inside one clock tick (`../frame-contract`), and a fuse
 * that burned on a zero delta would burn faster on a faster machine.
 */
export const stepCreeperFuse = (
  fuse: CreeperFuse,
  senses: CreeperSenses,
  dt: DeltaTimeSecs,
): CreeperStep => {
  switch (fuse._tag) {
    // Lighting and burning are ONE step, not two. The reference's tick adds
    // `dtSecs` to a fuse of zero on the very step that finds the player in range
    // (`creeper-fuse.ts:50`) and its oracle asserts the 0.05 that results
    // (`test/mob/creeper-fuse.test.ts:22-28`). Splitting them would cost a frame
    // of hiss on ignition — invisible, unjustifiable, and a gratuitous
    // divergence from the numbers this file is ported from.
    case 'Dormant': {
      return withinIgnitionRange(senses) ? burn(0, dt, senses.charged === true) : { fuse, explosion: undefined }
    }

    case 'Lit': {
      // Out of range: the fuse goes out and keeps no memory of how far it had
      // burned (`creeper-fuse.ts:49`). See the module header — a decision, not
      // an omission.
      return withinIgnitionRange(senses)
        ? burn(fuse.burnedSecs, dt, senses.charged === true)
        : { fuse: DORMANT_FUSE, explosion: undefined }
    }

    // Terminal. What becomes of the creeper afterwards — removed from the
    // roster, dropped, despawned — is the host's business; what matters here is
    // that no input can produce a second explosion.
    case 'Detonated': {
      return { fuse, explosion: undefined }
    }
  }
}
