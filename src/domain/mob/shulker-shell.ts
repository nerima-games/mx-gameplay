/**
 * ONE RULE, ONE FILE (DN-GP-9): a shulker's shell opens to shoot and shuts to
 * survive.
 *
 * Ported from `<reference-impl>/packages/entity/domain/mob/shulker-behavior.ts`
 * — the three states, the twenty ticks and the twenty armour points are that
 * file's, and its oracle
 * (`<reference-impl>/packages/entity/test/shulker-behavior.test.ts`) is what
 * `test/mob.test.ts` enumerates.
 *
 * plan.md §3.11's third mob behaviour. It is here rather than deferred because
 * it is THE SAME SHAPE AS THE FUSE — a small machine with a countdown and an
 * output that is only legal in one state — and so it reuses `./creeper-fuse`'s
 * discipline exactly: a tagged union rather than a flag beside a number, the
 * counter inside the state that uses it, and no entity id anywhere.
 *
 * ---------------------------------------------------------------------------
 * HAZARD: in the reference, none of this is wired to anything
 * ---------------------------------------------------------------------------
 *
 * `tickShulkerShell`, `getShulkerShellArmorPoints`, `computeShulkerShellDamage`,
 * `shouldShulkerTeleport` and `computeShulkerBulletDirection` are exported from
 * `<reference-impl>/packages/entity/index.ts:16` and called by NOTHING except
 * their own test file. There is no shulker in the reference's spawn rotation
 * (`mob-categories.ts:16-25` lists eight hostiles and the shulker is not among
 * them) and no lane that ticks a shell.
 *
 * That is worth stating before porting a line of it, because it changes what the
 * source is evidence OF. The creeper's numbers had been played; these have not,
 * and two of them contradict each other in a way that only a caller would have
 * found. Both contradictions are recorded below and neither is ported blind.
 *
 * ---------------------------------------------------------------------------
 * CONTRADICTION 1: "invulnerable" and "80% off" are not the same thing
 * ---------------------------------------------------------------------------
 *
 * A closed shulker gets two different answers in one file:
 *
 *   `tickShulkerShell` returns `isInvulnerable: true` (`shulker-behavior.ts:54`,
 *   :59, :67) — it takes NO damage.
 *
 *   `computeShulkerShellDamage` puts the blow through `applyArmorReduction` with
 *   20 armour points (:37-43), and the armour formula is 4% per point capped at
 *   80% (`packages/entity/domain/combat.config.ts:15-16`) — it takes 20% of the
 *   damage. The reference's own oracle asserts the 2-from-10
 *   (`test/shulker-behavior.test.ts:31-36`).
 *
 * Vanilla's closed shulker has +20 armour and is emphatically killable, so the
 * armour answer is the right one; `isInvulnerable` is a boolean that would have
 * made the mob unkillable the first time a melee handler read it instead. This
 * file ports the armour points and DOES NOT port the flag. A step result with
 * both would be shipping the contradiction.
 *
 * The armour ARITHMETIC is not here either, and that is the same call
 * `./mob-drop` makes about fortune, quoting kernel: report the fact and let the
 * rule that owns the operation apply it. 4%-per-point mitigates every defender
 * in the game — a player in iron, a zombie in picked-up boots — so it belongs
 * with a melee handler in a `domain/combat/` this repository does not have yet,
 * not in the mob folder behind a shulker-shaped door. `shulkerShellArmorPoints`
 * is the shulker's whole contribution to that sum.
 *
 * ---------------------------------------------------------------------------
 * CONTRADICTION 2: a constant with no producer and no consumer
 * ---------------------------------------------------------------------------
 *
 * `SHULKER_FORCED_CLOSED_TICKS = 100` (`shulker-behavior.ts:9`) is exported and
 * referenced nowhere — not in the reference's implementation, not in its tests.
 * The input it was written for, `closeTicksRemaining` (:18, :50, :53), is
 * supplied by no caller and decremented by no code, so nothing can ever set the
 * countdown and nothing would ever end it if something did.
 *
 * It is NOT ported. Porting it would mean inventing both halves — what starts
 * the hundred ticks and what counts them down — and inventing state is the one
 * thing `./creeper-fuse` was careful not to do. "A shulker that stays shut on a
 * timer" is on the arena's missing list, where an undecided rule belongs.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT in this file
 * ---------------------------------------------------------------------------
 *
 * `shouldShulkerTeleport` (:85-103) picks a destination out of a list of
 * neighbouring POSITIONS and breaks ties with `Math.abs(Math.trunc(pos.x * 31 +
 * pos.y * 17 + ...))` (:78-83) — a hash of world coordinates. Unlike the
 * enderman's, that offset does not cancel: the candidates are supplied by the
 * caller rather than generated, so the rule is a SEARCH OVER POSITIONS and the
 * positions are mc-sim's. The half that is a rule — "only when hurt below half
 * health" — is `hurtAndBloodied` below, and the arena's missing list carries the
 * search with its destination.
 *
 * `computeShulkerBulletDirection` (:105-115) is a normalised vector. Aiming is
 * mc-physics'; whether it may fire at all is `canFire` here.
 */

/**
 * Host frames a shell takes to open. `shulker-behavior.ts:8`.
 *
 * Frames rather than seconds, and it is the reference's — see
 * `./enderman-teleport`'s note on `ENDERMAN_STUCK_TELEPORT_TICKS` for why that
 * is ported rather than converted, and what it costs.
 */
export const SHULKER_OPENING_TICKS = 20

/**
 * Armour points a CLOSED shell is worth. `shulker-behavior.ts:10`.
 *
 * Exactly the reference's armour cap (`combat.config.ts:16`, `MAX_ARMOR_POINTS =
 * 20`), so a closed shulker is at the maximum mitigation the model allows: 80%
 * off, never more, and never all of it. See the module header.
 */
export const SHULKER_CLOSED_ARMOR_POINTS = 20

/**
 * The whole of a shulker's shell. Three cases, none terminal.
 *
 * `openedTicks` lives inside `Opening` and nowhere else, which is the divergence
 * from the reference worth naming. Its `tickShulkerShell` takes `ticksInState`
 * as an input (`shulker-behavior.ts:14`) and does not return it, so the host has
 * to know — from nothing written down — to reset the counter on every
 * transition. A host that forgot would hand a stale count to a freshly opening
 * shell and open it early or never. Here there is no counter to forget: entering
 * `Opening` constructs a zero, and no other state can carry one.
 */
export type ShulkerShell =
  /** Shut. Armoured, and cannot shoot. The state a shulker rests in. */
  | { readonly _tag: 'Closed' }
  /**
   * Opening. `openedTicks` is how many frames it has been opening, in
   * `[0, 20)`. Unarmoured ALREADY — the reference drops the armour the moment
   * the shell starts to move (`shulker-behavior.ts:64`), so the twenty frames
   * are a window in which it can be hurt and cannot answer.
   */
  | { readonly _tag: 'Opening'; readonly openedTicks: number }
  /** Open. Unarmoured, and may fire. */
  | { readonly _tag: 'Open' }

/** The state a freshly spawned shulker is in. */
export const CLOSED_SHELL: ShulkerShell = { _tag: 'Closed' }

/**
 * What this rule is allowed to know about the world on this frame.
 *
 * Four fields, every one of them mc-sim's: whether it has somebody to shoot at
 * (the targeting search is the roster's), how hard it was just hit, and its
 * health against its maximum. Health is READ and never written — `../death-cause`
 * owns the player's `Vitals` and mc-sim owns a mob's, and this rule only asks
 * for the ratio.
 */
export type ShulkerSenses = {
  /** Is there something worth opening for? `shulker-behavior.ts:19,51`. */
  readonly hasTarget: boolean
  /** Damage that landed this frame. Zero when nothing hit it. `:17`. */
  readonly damageTakenThisTick: number
  readonly healthPoints: number
  readonly maxHealthPoints: number
}

/**
 * The result of one frame: the shell to store back, and whether it may shoot.
 *
 * `canFire` is a PERMISSION and not an event, which is the reference's `canAttack`
 * (`shulker-behavior.ts:26`) under a name that says so. There is no cadence in
 * this rule and there is none in the reference's either, so a host that fired on
 * every frame this is true would fire at its frame rate — twenty bullets a
 * second at 20 Hz. The cooldown is a combat-lane fact
 * (`attackCooldownRemaining`, `entity-manager-ai-frame.ts`) and is on the
 * arena's missing list with that destination.
 */
export type ShulkerStep = {
  readonly shell: ShulkerShell
  readonly canFire: boolean
}

/**
 * How much armour this shell is worth right now.
 *
 * `shulker-behavior.ts:37-38`, and pinned on all three states by its oracle
 * (`test/shulker-behavior.test.ts:15-27`). A number, not a mitigated damage —
 * see the module header on where the 4%-per-point formula belongs.
 */
export const shulkerShellArmorPoints = (shell: ShulkerShell): number =>
  shell._tag === 'Closed' ? SHULKER_CLOSED_ARMOR_POINTS : 0

/**
 * Hurt, AND already below half health. `shulker-behavior.ts:34-35,49`.
 *
 * BOTH, which is not what vanilla does and is worth pinning rather than
 * smoothing: a shulker at full health that takes a hit does not flinch, so the
 * first half of a fight is fought against an open shulker and the second half
 * against a shut one. That is the reference's rule and docs/porting.md §4 makes
 * the reference the specification.
 *
 * TOTAL by comparison: a `NaN` anywhere makes every one of these `false`, so a
 * broken measurement leaves the shell alone rather than slamming it shut.
 */
const hurtAndBloodied = (senses: ShulkerSenses): boolean =>
  senses.damageTakenThisTick > 0 &&
  senses.maxHealthPoints > 0 &&
  senses.healthPoints / senses.maxHealthPoints < 0.5

/**
 * Advance one shulker by one frame.
 *
 * TOTAL and pure, so `test/mob.test.ts` enumerates the machine rather than
 * sampling it: there are three states and two interesting senses, and every
 * combination appears there.
 */
export const stepShulkerShell = (shell: ShulkerShell, senses: ShulkerSenses): ShulkerStep => {
  // Checked before the state, exactly as `shulker-behavior.ts:53` does: a blow
  // that lands on a bloodied shulker slams the shell shut out of ANY state,
  // including the middle of opening, and throws away the frames it had spent.
  if (hurtAndBloodied(senses)) {
    return { shell: CLOSED_SHELL, canFire: false }
  }

  switch (shell._tag) {
    // `shulker-behavior.ts:57-60`. Opening starts on the frame the target
    // appears, at zero — the twenty frames are counted from here, so acquiring a
    // target costs a full window before a single shot.
    case 'Closed': {
      return senses.hasTarget
        ? { shell: { _tag: 'Opening', openedTicks: 0 }, canFire: false }
        : { shell, canFire: false }
    }

    // `shulker-behavior.ts:62-65`. NOTE what is missing: `hasTarget` is not
    // consulted, so a shulker whose target walks away mid-open finishes opening
    // and only then shuts. The reference does that and it is left alone —
    // twenty frames of commitment is a real, playable property, and removing it
    // would let a shulker abort an animation it is drawing.
    case 'Opening': {
      // A counter that is not a number RESTARTS the window rather than
      // completing it. Both directions are recoverable; only this one cannot
      // make a shulker fire sooner than the rule allows, and `canFire` is the
      // output with teeth. (`./creeper-fuse` gets this for free from
      // `DeltaTimeSecs`; there is no brand on a frame count.)
      const openedTicks = (Number.isFinite(shell.openedTicks) ? shell.openedTicks : 0) + 1

      return openedTicks >= SHULKER_OPENING_TICKS
        ? { shell: { _tag: 'Open' }, canFire: false }
        : { shell: { _tag: 'Opening', openedTicks }, canFire: false }
    }

    // `shulker-behavior.ts:67-68`. Losing the target shuts it in one frame —
    // opening is slow and closing is instant, which is the asymmetry that makes
    // the shell worth having.
    case 'Open': {
      return senses.hasTarget
        ? { shell, canFire: true }
        : { shell: CLOSED_SHELL, canFire: false }
    }

    /* v8 ignore start -- exhaustiveness safety net over ShulkerShell's `_tag` union
     * ('Closed' | 'Opening' | 'Open'), a closed union every case above already
     * covers; no input can reach this arm. */
    default: {
      const exhaustive: never = shell
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

/**
 * Does a hit make it want to move?
 *
 * The half of `shouldShulkerTeleport` (`shulker-behavior.ts:90-92`) that is a
 * rule. WHERE it goes is a search over neighbouring positions and is not here;
 * see the module header.
 *
 * The condition is `hurtAndBloodied`'s, to the letter — the same two clauses
 * that shut the shell also make it want to leave, so a shulker never teleports
 * with its shell open. That the reference reaches the same pair through a
 * separately written expression is a coincidence its own code does not record;
 * here it is one function called twice.
 */
export const shulkerWantsToTeleport = (senses: ShulkerSenses): boolean =>
  hurtAndBloodied(senses)
