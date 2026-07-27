/**
 * THE JOIN: `domain/mob/`'s rules, run over mc-sim's roster.
 *
 * ---------------------------------------------------------------------------
 * What changed, and what did not
 * ---------------------------------------------------------------------------
 *
 * `stages/registration.ts` used to carry a headed paragraph beginning "THE
 * CREEPER IS NOT RUN HERE, AND THE REASON IS THE POINT", whose argument was that
 * running the rules needs 「a roster of mobs with positions and health」 and that
 * a roster is saved state, therefore mc-sim's. mc-sim has now built it —
 * `domain/entity.ts` and `application/entity-manager.ts`, documented in that
 * repository's `docs/public-api.md` §7, which quotes the paragraph back.
 *
 * NOT ONE FILE IN `domain/mob/` CHANGED to make this work, which was the claim
 * that paragraph was making. Every rule is still a total function from a value to
 * a value with no id, no `Ref` and no way to enumerate anything; this file is the
 * loop it said the stage would grow, and it is the only place in the repository
 * that knows both a `CreeperFuse` and an `EntityId`.
 *
 * It is a sibling of `./falling-block-move` on purpose: that file is the stage's
 * other half — the rules that move blocks, given a store — and this is the rules
 * that move mobs, given a roster. The stage registration itself stays a list of
 * `after` edges and a handful of `Ref` reads.
 *
 * ---------------------------------------------------------------------------
 * `S` IS THIS REPOSITORY'S TO NAME, AND IT IS NAMED HERE
 * ---------------------------------------------------------------------------
 *
 * mc-sim carries the per-mob rule state on a TYPE PARAMETER so that it can store
 * a `CreeperFuse` without knowing what one is (`docs/public-api.md` §7-1). The
 * parameter has to be instantiated somewhere, and `EntityManagerLayer<S>()`
 * returns `Layer.Layer<EntityManager>` — `S` appears nowhere in the result — so
 * a host that picks the wrong one gets a Layer that satisfies every requirement
 * and a roster whose `behaviour` field is not what any static type says.
 *
 * The defence is that exactly one repository names it. `MobBehaviour` below is
 * that name, it is exported from `index.ts` for that reason, and a host writes
 *
 *     Layer.merge(simModule.layers, EntityManagerLayer<MobBehaviour>(undefined, repairMobBehaviour))
 *
 * with both arguments coming from here. See `../entity-manager-port`'s header for
 * why no compiler can check that line, and `docs/public-api.md` for why
 * `simModule` should NOT grow a type parameter to try.
 *
 * ---------------------------------------------------------------------------
 * NON-CREEPER MOBS MUST COST NOTHING, AND THE STEP RECORD IS AN ALLOCATION
 * ---------------------------------------------------------------------------
 *
 * mc-sim's `sweepRoster` is built so that a frame in which nothing changed
 * returns the argument roster and allocates no array, and it shares `UNCHANGED`
 * and `DESPAWNED` so that the transitions cost nothing either. That leaves
 * exactly one allocation the SWEEP CANNOT REMOVE and only this file can: the
 * `{ transition, emit }` record the step function returns, once per entity per
 * frame. Returning a fresh one for a mob nothing happened to would hand back
 * per-mob-per-frame garbage on the frame path — undoing, one level up, precisely
 * what mc-sim's design is for, and repeating DN-GP-1's mistake with objects
 * instead of block reads.
 *
 * So `IGNORED` and `SWEPT` are shared frozen values, the two scratch records the
 * rules are asked their questions through are allocated ONCE PER SWEEP rather
 * than once per entity, and `test/vertical-slice.test.ts` asserts the property
 * directly: on an idle frame every entity receives the SAME step object, by
 * reference.
 *
 * The scratch records are safe because the rules they are handed to are in this
 * repository, are pure, and do not retain their arguments — `despawnVerdict` and
 * `stepCreeperFuse` each read their fields and return. That is a property of
 * those files rather than of this one, so it is stated here and pinned there by
 * `test/mob.test.ts`'s enumeration.
 *
 * ---------------------------------------------------------------------------
 * The mob's death cause is computed and then thrown away
 * ---------------------------------------------------------------------------
 *
 * `explosionDamageAt` returns a `Damage` and never a bare number, which is
 * DN-GP-3: the cause has to reach the death message. `applyDamage` below is given
 * one and records it — and then mc-sim's `EntityState` has nowhere to put it,
 * because it holds a position, a health number and a behaviour, and nothing else.
 *
 * That is stated rather than worked around. Writing a bare `healthPoints - amount`
 * here instead would be the reference's `(amount: number) => …` helper reappearing
 * at the one call site it was invented for; keeping the `Damage` costs nothing and
 * means the day a mob gets a death message (a kill feed, an advancement) the cause
 * is already being carried and only needs somewhere to land — on `behaviour`, or
 * on a field mc-sim adds. Inventing that field from this side would be this
 * repository designing mc-sim's roster entry.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND BEHAVIOUR IS THE ENDERMAN, AND THE SHULKER IS STILL NOT
 * ---------------------------------------------------------------------------
 *
 * `MobBehaviour` used to be `CreeperFuse | undefined`, and the paragraph on it
 * refused `ShulkerShell` on the grounds that it 「would be a union member nothing
 * can reach」. That sentence was written about the enderman and the shulker at
 * once and it does not survive being asked of them separately, because the two
 * fail different halves of the same test.
 *
 * A rule is reachable from this file when the ROSTER CAN HOLD its state and the
 * FRAME CAN ACT on its output. The second half is where they part:
 *
 *   ENDERMAN   Its output is a POSITION. `feetPosition` is one of the three
 *              fields of mc-sim's `EntityState` and this sweep already writes it
 *              on every `Changed` transition — the teleport reuses the identical
 *              `changed(...)` call the fuse uses, with a different field moved.
 *              Nothing new has to exist for the answer to land, so it is wired.
 *
 *   SHULKER    Its output is `canFire`, which is a PERMISSION TO FIRE A
 *              PROJECTILE, and there is no projectile. Nothing in `domain/`
 *              produces one, mc-sim's roster entry carries no velocity to give
 *              one, and `../mob/shulker-shell`'s own header puts the bullet's
 *              direction in mc-physics. Two of its four senses are unmeasurable
 *              here as well: `hasTarget` is a targeting search with a range this
 *              repository has not ported (`senses.target !== undefined` means
 *              「a player exists somewhere in the world」, which would open every
 *              shulker on the map at once), and `maxHealthPoints` is a per-kind
 *              stat with no citation on this side of the line — the preview holds
 *              it as `SHULKER_MAX_HEALTH` precisely because the preview is
 *              playing mc-sim. So a wired shell would compute, on every frame, a
 *              permission nothing can act on, out of two facts nobody measured.
 *              It stays out, and `ARENA_MISSING` keeps it with that reason.
 *
 * ---------------------------------------------------------------------------
 * A BLOW IS A FACT ABOUT THE PREVIOUS FRAME, AND THAT IS WHY IT IS STORED
 * ---------------------------------------------------------------------------
 *
 * `endermanTeleportUrge` wants `damagedThisStep`, and mc-sim's `EntityState` has
 * no such flag — three fields, and none of them is a combat lane. `ARENA_MISSING`
 * read 「mc-sim's entity has neither field」 and stopped there, which is the wrong
 * conclusion from the right observation: mc-sim stores per-entity rule state on a
 * TYPE PARAMETER, this repository instantiates it, and a flag about a mob is
 * exactly what `behaviour` is for. `EndermanFlinch` below is that flag, and
 * adding it needed no change in mc-sim at all — which is the claim
 * `../entity-manager-port`'s header makes for the parameter's existence.
 *
 * IT IS A FRAME LATE, AND DELIBERATELY. The only blow this repository can measure
 * is a blast, and a blast is resolved in `resolveBlasts` — AFTER `sweepMobs`, for
 * the reason that function's header gives (one pass over the roster for every
 * blast in the frame, not one pass per blast). So an enderman caught in an
 * explosion is marked `Struck` on the frame it is hurt and answers on the next.
 * The alternative is a third sweep between the two, which is the shape the
 * 「ONE sweep and not three」 paragraph above refuses; one frame at 20 Hz is 50 ms,
 * and the reference's own flinch is a lane that runs on a later tick anyway.
 *
 * THE FLINCH IS CONSUMED WHATEVER IT DECIDES: a `Struck` enderman that fails its
 * roll goes back to `Steady` rather than re-rolling the same blow on every later
 * frame. A blow belongs to one frame — the preview's `ArenaShulker.hitThisFrame`
 * carries that note for the same reason — and an enderman that kept it would
 * eventually roll under 0.3 and teleport for a hit it took ten seconds ago.
 *
 * ---------------------------------------------------------------------------
 * THE ANCHOR IS HONOURED HERE, WHICH IS THE HALF THE REFERENCE LOST
 * ---------------------------------------------------------------------------
 *
 * `../mob/enderman-teleport`'s header shows that the reference's teleport
 * function IGNORES the enderman's own position — every candidate is built from
 * the target and measured back against the target, so the position cancels — and
 * that the reference then passes a DIFFERENT anchor from each of its two call
 * sites without recording anywhere that they differ. The rule was ported with the
 * cancellation kept (it is sound: what is left really is a displacement) and the
 * anchor promoted to a field of the verdict.
 *
 * This is the call site that field was for. `anchor: 'self'` adds the offset to
 * the enderman's own feet — a hurt mob jumping 8 to 32 blocks from where it was
 * standing, an escape — and `anchor: 'target'` adds it to the player's, which is
 * an approach to within 8 to 32 blocks of you from any distance whatsoever.
 * Rename a parameter in the reference and those two silently swap; here they are
 * two readable branches of one expression.
 *
 * THE ALTITUDE IS THE ENDERMAN'S OWN, and that is a divergence rather than an
 * omission. The reference copies the ANCHOR's y (`enderman-teleport.ts:39`), so
 * an enderman approaching a player arrives at the PLAYER's altitude 8 to 32
 * blocks away — on any terrain at all, usually inside rock or in mid-air. The
 * rule deliberately returns no `y` and says so. Keeping the mob's own altitude is
 * the only choice available that invents nothing: it is a purely horizontal move
 * in world terms, which is what a horizontal offset means. It is still not a
 * GROUND check, and that one is not fixable from here — see the call site.
 *
 * ---------------------------------------------------------------------------
 * The seed is threaded THROUGH the sweep, and the window that opens is not new
 * ---------------------------------------------------------------------------
 *
 * The creeper needed no randomness, so `sweepMobs` used to be a pure function of
 * a roster and a delta. The enderman consults a roll, so the seed has to reach
 * inside the step function — and `../frame-rolls` is a whole file about the one
 * way that may happen.
 *
 * It is a LOCAL CURSOR, advanced by `nextRoll` and `drawRolls` and handed back
 * beside the blasts. It is not a `Ref`: writing a Ref inside `roster.sweep` would
 * be a side effect inside an atomic update, which is the shape mc-sim's `emit`
 * channel exists to avoid. Mutating a local allocated one line up is the same
 * thing the two scratch records above already do, and it is safe for the same
 * reason plus one more — `Ref.modify` runs its function EXACTLY ONCE
 * (`effect/internal/ref.ts`: `self.modify(f)`, a synchronous read-compute-write),
 * so there is no retry that could draw one frame's rolls twice.
 *
 * What the caller loses is the atomic `Ref.modify` that `rollCasualtyDrops` gets:
 * the stage must read the seed, run an Effect, and write the seed back. That
 * window is real and it is not a NEW hazard — two frames overlapping here would
 * be two frames sweeping one roster, which is incoherent long before the
 * generator is reached. The seed is not the thing that breaks first.
 *
 * ROLLS ARE DRAWN ONLY WHEN A RULE ASKS FOR ONE. An enderman with nothing to
 * chase and no blow to answer draws nothing, and a roster with no enderman on it
 * leaves the seed exactly where it found it — which is `../frame-rolls`' rule
 * that the sequence must depend on what happened rather than on how many mobs
 * existed.
 */
import { Effect } from 'effect'
import { applyDamage, isDead, type Vitals } from '../death-cause'
import {
  changed,
  DESPAWNED,
  EntityKind,
  UNCHANGED,
  type Entity,
  type EntityId,
  type EntityManagerApi,
  type EntityStep,
  type Position,
} from '../entity-manager-port'
import type { BlockPosition, ChunkStoreApi } from '../chunk-store-port'
import type { DeltaTimeSecs } from '../frame-contract'
import { drawRolls, nextRoll } from '../frame-rolls'
import { carveExplosionCrater } from '../interactions/explosion-crater'
import type { PositionKey } from '../position-key'
import { DORMANT_FUSE, stepCreeperFuse, type CreeperFuse, type CreeperSenses } from '../mob/creeper-fuse'
import {
  ENDERMAN_TELEPORT_ATTEMPTS,
  endermanTeleportOffset,
  endermanTeleportUrge,
  type EndermanSenses,
} from '../mob/enderman-teleport'
import { explosionDamageAt, type Explosion } from '../mob/explosion'
import { despawnVerdict, type DespawnCandidate } from '../mob/hostile-despawn'
import { canHostileSpawnAt, type SpawnCandidate, type SpawnRefusal } from '../mob/hostile-spawn'
import {
  CREEPER_DROPS,
  rollMobDrops,
  type MobDrop,
  type MobDropRule,
  type MobKill,
} from '../mob/mob-drop'

// ---------------------------------------------------------------------------
// The vocabulary this repository contributes to the roster
// ---------------------------------------------------------------------------

/**
 * Everything an enderman needs remembered between two frames, and nothing else.
 *
 * TWO TAGS AND NO FIELDS, which is the whole design. `endermanTeleportUrge` asks
 * for three facts and exactly one of them survives a frame: a roll is drawn where
 * it is used, `stuckTicks` has no measurement here (see `sweepMobs`), and whether
 * a blow landed is a fact about a moment that has passed by the time the next
 * sweep asks. So the state is that one bit, spelled as a union rather than as a
 * boolean field for the reason `../mob/creeper-fuse`'s header gives about the
 * reference's `{ fuseSecs, ignited }`: two shared frozen values cannot disagree
 * with each other, and neither of them is a number a save file can corrupt.
 *
 * The tags are disjoint from `CreeperFuse`'s `Dormant` / `Lit` / `Detonated` on
 * purpose — `MobBehaviour` is one union over the whole roster, so a tag collision
 * would make a creeper and an enderman indistinguishable to `repairMobBehaviour`
 * on the load path, where the kind is the only other thing to go on.
 *
 * NO COOLDOWN, and that is a refusal rather than an oversight. A 5% chance per
 * frame is a teleport a second at 20 Hz, which is frantic — and it is the
 * reference's number, whose lane also runs once per frame
 * (`../mob/enderman-teleport`'s note on `ENDERMAN_STUCK_TELEPORT_TICKS` records
 * frame-rate dependence as the known divergence). Adding a countdown to calm it
 * down would be inventing both ends of a rule, which is exactly what
 * `../mob/shulker-shell` declines to do with `SHULKER_FORCED_CLOSED_TICKS`.
 */
export type EndermanFlinch =
  /** Nothing has hit it since its last step. The state a fresh enderman is in. */
  | { readonly _tag: 'Steady' }
  /**
   * A blow landed after its last step and has not been answered yet.
   *
   * Set by `resolveBlasts` and cleared by the very next `sweepMobs`, whatever the
   * urge decides. See the module header on why it is a frame late and why it is
   * spent rather than kept.
   */
  | { readonly _tag: 'Struck' }

/** The state a freshly spawned enderman is in, and the one a repair falls back to. */
export const STEADY_ENDERMAN: EndermanFlinch = { _tag: 'Steady' }

/** What a blast leaves on an enderman that survived it. Shared: a blow allocates nothing. */
export const STRUCK_ENDERMAN: EndermanFlinch = { _tag: 'Struck' }

/**
 * What mx-gameplay stores on every entity — mc-sim's `S`.
 *
 * A UNION, and the interesting member is `undefined`. mc-sim's roster carries one
 * behaviour type for every entity in the world, so a mob this repository has no
 * per-mob state for still has to name a member of it, and "nothing" is the honest
 * one: an `undefined` behaviour is a mob no rule here ticks. The alternative — an
 * invented `{ _tag: 'Inert' }` — would be a value that exists only to satisfy a
 * type parameter, and the first reader to see it in a save file would reasonably
 * ask which rule produces it.
 *
 * WHAT IS NOT IN IT, AND WHY. `ShulkerShell` is the same shape as `CreeperFuse` —
 * a small machine with a countdown, designed in `../mob/shulker-shell.ts` with
 * the fuse's discipline deliberately — and its three tags (`Closed` / `Opening` /
 * `Open`) are disjoint from everything above, so adding it would be one `|` and
 * one more arm of `repairMobBehaviour`. It is left out because the frame cannot
 * act on what it would produce: see the module header, which measures that
 * refusal against the enderman's, whose output is a position this sweep already
 * writes. A behaviour that can be stored and never acted on is a save-file field
 * with no rule behind it.
 */
export type MobBehaviour = CreeperFuse | EndermanFlinch | undefined

/**
 * The two entity kinds this repository names.
 *
 * mc-sim's `EntityKind` is deliberately OPEN and mc-sim never branches on one —
 * `countOfKind` compares two strings the caller supplied and that is the whole of
 * its interest (mc-sim DN-11). Which means the spelling is checked by nobody, and
 * so it is written down exactly once, here, and every comparison in the
 * repository goes through this constant. The reference's failure in the other
 * direction is the one plan.md §3.1 measured: `blockTypeToIndex('SAND')` in 229
 * places across 51 files.
 *
 * When mc-kernel publishes an `EntityType` roster this becomes a reference to a
 * member of it, and mc-sim's `EntityKind` becomes an alias of it — mc-sim's
 * §7-6 already records that repoint as one line.
 */
export const CREEPER_KIND: EntityKind = EntityKind('creeper')

/**
 * The second, and it arrived with the teleport rather than with a spawner.
 *
 * NOTHING IN THIS REPOSITORY PUTS ONE ON THE ROSTER, and that is a measured gap
 * rather than an omission this constant papers over. `applySpawnAttempts` below
 * spawns creepers because `MobSpawnAttempt` carries no kind, and the reason it
 * carries none is `ARENA_MISSING`'s 「the reference rotates 8 hostiles; which mob
 * spawns is a table this repository has no second row for」 — choosing which of
 * the eight a candidate cell produces is a weighted rotation, and inventing one
 * here would be inventing a spawn rule. Widening the cap is the other half of the
 * same decision: `MAX_HOSTILE_COUNT`'s note records that a second hostile kind
 * turns a per-kind cap into a sum over a roster of hostile kinds that does not
 * exist yet.
 *
 * An enderman therefore reaches the roster the way any mob does that the spawner
 * does not produce: a host's `spawn`, or `restore` on the world-load path — which
 * is precisely why `repairMobBehaviour` below now has an arm for it.
 */
export const ENDERMAN_KIND: EntityKind = EntityKind('enderman')

/**
 * A creeper's health at spawn.
 *
 * A PER-KIND CONSTANT, which mc-sim's §7-6 puts on this side of the line in as
 * many words: 「kind ごとの定数はルール層のもので、表をミラーすれば mc-sim が
 * 「クリーパーとは何か」を知る商売に戻る」. Twenty is vanilla's and the reference's,
 * and it is deliberately NOT `../death-cause`'s `MAX_HEALTH_POINTS` even though
 * both are 20: that one is the PLAYER's, and two constants that happen to agree
 * are not one constant.
 */
export const CREEPER_MAX_HEALTH = 20

/**
 * How many creepers may exist at once.
 *
 * `../mob/hostile-spawn.ts`'s header lists this among the things it does not
 * decide — 「HOW MANY (`MAX_HOSTILE_COUNT = 16` against a live census) [...] Every
 * one of those reads or writes the roster. They arrive with mc-sim」 — and this is
 * that arrival. The number is
 * `<reference-impl>/packages/entity/domain/mob/spawner-config.ts`'s.
 *
 * ONE DIVERGENCE, stated because it is invisible: the reference's cap is over ALL
 * hostiles and this one is per kind, because `countOfKind` is the census mc-sim
 * publishes and a total-hostiles count would need this repository to enumerate
 * which kinds are hostile — a roster it does not have (see the arena's missing
 * list). With exactly one hostile kind the two agree; the day a second arrives,
 * the cap has to become a sum and this comment is where that is recorded.
 */
export const MAX_HOSTILE_COUNT = 16

/** What a creeper leaves behind. A creeper drops nothing at all, which is `../mob/mob-drop`'s rule and not this file's. */
const SELF_DESTRUCT: MobKill = { _tag: 'SelfDestruct' }

/**
 * How a blast kills a bystander.
 *
 * `lootingLevel: 0` because an explosion has no weapon. The reference reaches
 * looting only through the melee handler, and a creeper's blast is not a melee
 * blow — so this is the reference's behaviour rather than an omission.
 */
const SLAIN_BY_BLAST: MobKill = { _tag: 'Slain', lootingLevel: 0 }

const NO_DROP_RULES: ReadonlyArray<MobDropRule> = []

/**
 * The loot table for a kind.
 *
 * A table in the rules tier, which is where mob identity lives (plan.md §3.11).
 * `../mob/mob-drop` also holds a ghast's and a blaze's; neither is here, because
 * neither has an `EntityKind` that anything spawns, and a row mapping a kind
 * nothing produces would be a claim that this build has ghasts.
 */
export const dropRulesOfKind = (kind: EntityKind): ReadonlyArray<MobDropRule> =>
  kind === CREEPER_KIND ? CREEPER_DROPS : NO_DROP_RULES

/** How many rolls `rollDropsOfKind` will consume for this kind. Two per drop line — a chance and a count. */
export const dropRollsNeeded = (kind: EntityKind): number => dropRulesOfKind(kind).length * 2

/**
 * Roll a kind's loot from a flat array of rolls.
 *
 * `rolls[2n]` is line `n`'s chance roll and `rolls[2n + 1]` its count roll, which
 * is the same two-at-a-time convention `../mob/enderman-teleport`'s
 * `endermanTeleportOffset` reads its array with. The `?? 0` is a total-function
 * formality rather than a fallback — the caller draws exactly
 * `dropRollsNeeded(kind)` — and it lands on `LOWEST_ROLLS`, which
 * `../mob/mob-drop` documents as the every-"always"-branch, smallest-count
 * answer.
 */
export const rollDropsOfKind = (
  kind: EntityKind,
  kill: MobKill,
  rolls: ReadonlyArray<number>,
): ReadonlyArray<MobDrop> =>
  rollMobDrops(dropRulesOfKind(kind), kill, (index) => ({
    chance: rolls[index * 2] ?? 0,
    count: rolls[index * 2 + 1] ?? 0,
  }))

/**
 * The host's `BehaviourRepair` — the function mc-sim's load path delegates to
 * because it cannot check a claim about a type it refuses to know.
 *
 * TOTAL, and it must be: a throw here is a `Cause.Die` on the world-load path
 * that mc-sim's frame loop logs and swallows, so a repairable save would become
 * an unopenable one AND a silent one. Every field is tested on the value before
 * anything can coerce it, exactly as `normaliseRoster` does one layer up.
 *
 * Note the direction each repair fails in. A creeper whose saved fuse is
 * unreadable becomes DORMANT rather than `Detonated` or `Lit`: dormant is the
 * state a fresh creeper is in, so the mob resumes as if it had just arrived,
 * whereas `Lit` would detonate a mob the player never provoked and `Detonated`
 * would leave a creeper on the roster that no input can ever change. A mob of
 * neither kind carrying a behaviour loses it, because there is no rule that would
 * ever read it and keeping it would make the roster's contents depend on which
 * build wrote the save.
 *
 * THE ENDERMAN'S ARM FAILS TOWARDS `Steady`, and both wrong directions are worth
 * naming because one of them MOVES A MOB. A saved flinch that cannot be read
 * becomes `Steady`: the enderman resumes as if nothing had hit it. Falling back
 * to `Struck` instead would roll the damage branch on the first frame after a
 * world load, and 30% of the time would teleport a mob 8 to 32 blocks out of the
 * place the save file put it — a mob that moved for a blow that was never struck,
 * on a frame the player has not yet had a chance to act in. The same rule as the
 * fuse's, applied to the state whose failure is visible rather than fatal.
 *
 * A BEHAVIOUR OF THE WRONG SHAPE FOR ITS KIND IS REPLACED, NOT TRUSTED, and that
 * is now a claim with two sides to it: a creeper carrying a flinch becomes
 * `DORMANT_FUSE` and an enderman carrying a fuse becomes `STEADY_ENDERMAN`.
 * Passing either one through would be worse than losing it — `sweepMobs` reads
 * the tag to decide which rule runs, so a creeper that kept a `Struck` would tick
 * no fuse and consult the teleport rule instead.
 */
export const repairMobBehaviour = (kind: EntityKind, behaviour: MobBehaviour): MobBehaviour => {
  if (kind === CREEPER_KIND) {
    return isCreeperFuse(behaviour) ? behaviour : DORMANT_FUSE
  }

  if (kind === ENDERMAN_KIND) {
    return isEndermanFlinch(behaviour) ? behaviour : STEADY_ENDERMAN
  }

  return undefined
}

/**
 * Is this actually a `CreeperFuse`?
 *
 * Written against `unknown` rather than against the declared type, because on the
 * load path the declared type is a CLAIM: the value is JSON that mc-save parsed
 * and mc-sim handed straight back, and mc-sim cannot check it (that is the whole
 * reason `BehaviourRepair` exists). So every field is tested on the value before
 * any property access or comparison can coerce it into looking deliberate — the
 * discipline `normaliseRoster` states one layer down.
 *
 * A burn time that is not a number would make the fuse neither advance nor end —
 * `../mob/creeper-fuse`'s header calls that 「a mob that hisses forever」 — and a
 * negative one would buy the player time no rule granted, so `Lit` is the one tag
 * that has to look inside.
 */
const isCreeperFuse = (value: unknown): value is CreeperFuse => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const tag = (value as { readonly _tag?: unknown })._tag
  if (tag === 'Dormant' || tag === 'Detonated') {
    return true
  }

  const burnedSecs = (value as { readonly burnedSecs?: unknown }).burnedSecs
  return tag === 'Lit' && typeof burnedSecs === 'number' && Number.isFinite(burnedSecs) && burnedSecs >= 0
}

/**
 * Is this actually an `EndermanFlinch`?
 *
 * Against `unknown` for `isCreeperFuse`'s reason, and SHORTER than it for a
 * reason worth stating rather than leaving as an apparent asymmetry: the flinch
 * carries no fields, so there is no number a save file can put out of range and
 * nothing to test but the tag. That is the second dividend of spelling one bit as
 * a union — `../mob/creeper-fuse`'s 「a mob that hisses forever」 has no analogue
 * here, because there is no counter to be `NaN`.
 */
const isEndermanFlinch = (value: unknown): value is EndermanFlinch => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const tag = (value as { readonly _tag?: unknown })._tag
  return tag === 'Steady' || tag === 'Struck'
}

/**
 * The frame path's two tag tests, which are NOT the load path's above.
 *
 * The load path is handed JSON and must not believe a field until it has looked
 * at it. These are handed a value that came out of `spawn` or out of
 * `repairMobBehaviour`, so its FIELDS are already trusted and only its TAG is in
 * question — a host may legally spawn a creeper holding a flinch, and `sweepMobs`
 * has to answer that without ticking the wrong rule. Reusing `isCreeperFuse` here
 * would run four extra checks per creeper per frame to re-learn something the
 * load path already established.
 */
const isFuse = (behaviour: MobBehaviour): behaviour is CreeperFuse =>
  behaviour !== undefined &&
  (behaviour._tag === 'Dormant' || behaviour._tag === 'Lit' || behaviour._tag === 'Detonated')

const isFlinch = (behaviour: MobBehaviour): behaviour is EndermanFlinch =>
  behaviour !== undefined && (behaviour._tag === 'Steady' || behaviour._tag === 'Struck')

/** What a creeper hands the rest of the frame on the one step it detonates. */
export type Blast = {
  /** The entity that produced it. It is already off the roster by the time this is read. */
  readonly source: EntityId
  readonly kind: EntityKind
  /**
   * Where it went off.
   *
   * `../mob/explosion.ts`'s `Explosion` deliberately carries no position — 「the
   * host already has it」 — and this is the host putting it back. The rule stays
   * free of a coordinate vocabulary it does not own; the frame, which does the
   * measuring, supplies the measurement.
   */
  readonly at: Position
  readonly explosion: Explosion
}

/** A mob that died to a blast, for the drop roll that happens outside the sweep. */
export type MobCasualty = {
  readonly id: EntityId
  readonly kind: EntityKind
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Blocks between two points, in THREE dimensions.
 *
 * 3D for both consumers, and the two are different rules that happen to agree:
 * `../mob/hostile-despawn` documents its distance as 3D explicitly (the
 * reference's `distanceToPlayerSq` over x, y and z), and the creeper's ignition
 * range is a radius around a mob rather than a footprint. `../mob/hostile-spawn`'s
 * band is the one that is HORIZONTAL, and it never reaches this function — the
 * spawn rule takes its own `distanceToPlayerBlocksXZ` from the candidate, which
 * is measured by whoever proposed the cell.
 *
 * TOTAL: a coordinate that is not a number yields `NaN`, which `despawnVerdict`
 * answers with `Despawn` and `stepCreeperFuse` answers with "nobody in range".
 * Both are the inert direction, and both are the rules' decisions rather than
 * this function's.
 */
export const distanceBetween = (from: Position, to: Position): number =>
  Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z)

/**
 * The cell a continuous point is standing in.
 *
 * `Math.floor` and not `Math.round`, which is the whole reason
 * `../entity-manager-port` mirrors `Position` and `BlockPosition` as two types:
 * a mob at `y = 64.0` is at the BOTTOM of cell 64, and rounding would put a
 * creeper standing on the floor of a room one cell above it and blow the roof
 * off instead of the floor.
 */
export const cellOf = (position: Position): BlockPosition => ({
  x: Math.floor(position.x),
  y: Math.floor(position.y),
  z: Math.floor(position.z),
})

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * The shared steps. See the module header — these are the allocation the sweep
 * cannot remove and this file can.
 *
 * `EntityStep<S, never>` is assignable to `EntityStep<S, A>` for every `A`
 * (`emit` is `never | undefined`, i.e. `undefined`), so one value serves every
 * sweep in this file whatever it emits — which is the same trick mc-sim plays
 * with `EntityTransition<never>` one level down.
 */
const IGNORED: EntityStep<MobBehaviour, never> = { transition: UNCHANGED, emit: undefined }
const SWEPT: EntityStep<MobBehaviour, never> = { transition: DESPAWNED, emit: undefined }

/** The scratch records, mutable so that they can be refilled rather than rebuilt. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** What the frame knows that the rules need. */
export type MobFrameSenses = {
  /**
   * Where the mobs' target is, or `undefined` for no target at all.
   *
   * NOT a large distance — `../mob/creeper-fuse` and `../mob/hostile-despawn`
   * both take `undefined` to mean "there is no player", and both answer it
   * differently on purpose (a fuse stays out; a mob is KEPT, because a world with
   * nobody in it has nobody to be far from). Collapsing the two into a big number
   * would silently pick one of those answers for both.
   */
  readonly target: Position | undefined
  readonly dt: DeltaTimeSecs
}

/**
 * How many rolls one teleport search may consume: two per attempt, sixteen
 * attempts, and the search reads them `rolls[2n]` / `rolls[2n + 1]`.
 *
 * THE WHOLE BUDGET IS DRAWN EVEN THOUGH THE SEARCH USUALLY STOPS EARLY, and the
 * over-draw is the point rather than the cost. `endermanTeleportOffset` returns
 * the FIRST offset that lands in the 8..32 band, so a lucky first attempt reads
 * two rolls and an unlucky run reads all thirty-two; advancing the seed by
 * whichever it happened to need would make the next mob's loot depend on which
 * attempt this mob's teleport succeeded on. Drawing a fixed budget makes the
 * sequence depend only on WHETHER an enderman teleported, which is the property
 * `../frame-rolls` asks for — and it keeps the seed stable under a change to the
 * band, which would otherwise silently reshuffle every later draw.
 *
 * The alternative — handing the rule a generator so it could draw lazily — would
 * put the shape of randomness inside `domain/mob/`, where `../mob/mob-drop` and
 * `../mob/enderman-teleport` both deliberately take a flat array instead.
 */
export const ENDERMAN_TELEPORT_ROLLS = ENDERMAN_TELEPORT_ATTEMPTS * 2

/** A frame's mob sweep: what blew up, and where the generator ended. */
export type MobSweep = {
  readonly blasts: ReadonlyArray<Blast>
  /**
   * The seed to keep. Advanced by exactly the rolls the rules asked for and by no
   * more — see the module header, and `ENDERMAN_TELEPORT_ROLLS` for the one place
   * a budget is drawn rather than a single roll.
   */
  readonly seed: number
}

/**
 * One frame of every mob: sweep for despawns, burn every creeper's fuse, move
 * every enderman that wants to move, and collect the blasts.
 *
 * ONE sweep and not four. mc-sim's `sweep` is a single `Ref.modify` over the
 * whole roster, so four passes would be four atomic updates with four windows
 * between them — and a mob that despawned in the first would still be ticked by
 * the second in whatever the frame loop forked in between. It is also four
 * closure calls per mob where one will do. The enderman was added INSIDE this
 * closure for that reason and not as a sibling of it; a second pass would also
 * have cost the idle frame a second `distinctStepObjects` count, which is the
 * number `test/vertical-slice.test.ts` reads to prove the frame allocates
 * nothing.
 *
 * THE ORDER INSIDE THE STEP IS A DECISION. The despawn sweep runs FIRST, so a
 * creeper 200 blocks away is removed rather than having its fuse evaluated
 * against a distance that already decided its fate. The reference reaches the
 * same order by accident — its maintenance lane despawns before its AI lane ticks
 * — and the visible difference is a creeper at the edge of the world that would
 * otherwise be dormant, ticked, and then removed on the same frame. An enderman
 * gets the same treatment for the sharper version of the same reason: a mob about
 * to be swept must not draw a roll, because a roll it consumed would move every
 * later mob's loot.
 *
 * THE RULE IS CHOSEN BY THE BEHAVIOUR'S TAG AND GUARDED BY THE KIND. Neither
 * alone is enough. The tag is what makes the union discriminable — `sweepMobs`
 * cannot ask mc-sim what kind of state it is holding, because mc-sim is built not
 * to know — and the kind is what stops a host's `spawn({ kind: pig, behaviour:
 * DORMANT_FUSE })` from producing an exploding pig. `repairMobBehaviour` enforces
 * the same agreement on the load path; this is the frame path's half of it.
 */
export const sweepMobs = (
  roster: EntityManagerApi<MobBehaviour>,
  senses: MobFrameSenses,
  seed: number,
): Effect.Effect<MobSweep> =>
  Effect.suspend(() => {
    // Allocated once per sweep, refilled once per entity. See the module header
    // for why that is worth the mutation, and why it is safe.
    const despawnScratch: Mutable<DespawnCandidate> = {
      distanceToPlayerBlocks: undefined,
      // A property of the roster entry, and mc-sim's `EntityState` has no flag
      // for it — its three fields are position, health and behaviour. So nothing
      // in this world is exempt from the distance sweep today. That is the right
      // default (the reference exempts exactly one mob, the villager, and there
      // are no villagers here) and the wrong place to fix it: exemption is a
      // property of the entity, so it arrives as a field on mc-sim's entry or as
      // a member of `MobBehaviour`, never as a list of kinds in this file.
      persistent: false,
    }
    const creeperScratch: Mutable<CreeperSenses> = { distanceToTargetBlocks: undefined }
    const endermanScratch: Mutable<EndermanSenses> = {
      damagedThisStep: false,
      // ALWAYS ZERO, AND THE MISSING MEASUREMENT IS A LANE RATHER THAN A FIELD.
      // `stuckTicks` is 「consecutive host frames it has failed to move」, which
      // needs somebody whose job it was to move it: the reference's counter is
      // written by its pathfinding lane
      // (`entity-manager-ai-enderman-teleport.ts:25,52`) and means "the path made
      // no progress". Nothing in this repository writes a mob's `feetPosition`
      // except the teleport four lines below, so deriving the count from position
      // equality would make it a plain FRAME COUNTER — true for every mob on
      // every frame — and every enderman in the world would teleport once every
      // 41 frames forever, on a measurement that carries no information.
      //
      // Storing it on `EndermanFlinch` would not help: the flag is the honest
      // shape of a fact the frame HAS, and this is a fact the frame does not.
      // What it wants is `ARENA_MISSING`'s 「AI / pathfinding」 row — a movement
      // lane reporting whether a mob made progress towards a goal, which is
      // mc-physics' write and mc-sim's goal. Until one exists the stuck branch of
      // `endermanTeleportUrge` cannot fire, and the rule keeps it because
      // `test/mob.test.ts` pins its boundary against the reference's oracle.
      stuckTicks: 0,
      roll: 0,
    }

    // The local cursor. See the module header: not a `Ref`, advanced only where a
    // rule asks for a roll, and handed back beside the blasts.
    let cursor = seed

    return Effect.map(
      roster.sweep<Blast>((entity) => {
        const distance =
          senses.target === undefined ? undefined : distanceBetween(entity.feetPosition, senses.target)

        despawnScratch.distanceToPlayerBlocks = distance
        if (despawnVerdict(despawnScratch)._tag === 'Despawn') {
          // NO DROPS. A despawn is not a death: nobody killed it, nobody is there
          // to pick anything up, and `../mob/mob-drop`'s `MobKill` has no case for
          // it because there is nothing to decide.
          return SWEPT
        }

        const behaviour = entity.behaviour
        if (behaviour === undefined) {
          // The whole cost of a mob this repository has no rule for: one closure
          // call, one distance, and a shared object.
          return IGNORED
        }

        if (entity.kind === CREEPER_KIND && isFuse(behaviour)) {
          creeperScratch.distanceToTargetBlocks = distance
          const step = stepCreeperFuse(behaviour, creeperScratch, senses.dt)

          if (step.explosion !== undefined) {
            // DESPAWNED rather than stored as `Detonated`, and the two are not the
            // same frame's difference. `../mob/mob-drop`'s `MobKill` records that
            // the reference's detonating creeper drops nothing only because a
            // `return` in one file happens to precede the drop path in another —
            // 「the behaviour is right and the mechanism is an accident」. Removing
            // it here, on the step that produced the blast, makes the ordering a
            // property of this loop instead: the creeper is off the roster before
            // the blast is resolved, so it cannot be damaged by its own explosion
            // and cannot be counted as slain by it.
            return {
              transition: DESPAWNED,
              emit: {
                source: entity.id,
                kind: entity.kind,
                at: entity.feetPosition,
                explosion: step.explosion,
              },
            }
          }

          // Reference identity, not deep equality. `stepCreeperFuse` returns the
          // ARGUMENT fuse when nothing happened (a dormant creeper out of range, a
          // detonated one), so `===` is exact here and costs nothing — and it is
          // what lets an idle frame reach mc-sim's zero-allocation path.
          return step.fuse === behaviour
            ? IGNORED
            : {
                transition: changed({
                  feetPosition: entity.feetPosition,
                  healthPoints: entity.healthPoints,
                  behaviour: step.fuse,
                }),
                emit: undefined,
              }
        }

        if (entity.kind === ENDERMAN_KIND && isFlinch(behaviour)) {
          const struck = behaviour._tag === 'Struck'

          // THE CHASE LANE ONLY RUNS WHEN THERE IS SOMETHING TO CHASE, and this
          // is the one gate the frame adds rather than the rule.
          // `ENDERMAN_CHASE_TELEPORT_CHANCE` is documented as 「a CHASING
          // enderman」 and both of the branches it can reach anchor on `target`,
          // so an enderman with no target has nothing to measure a destination
          // from — and drawing a roll to decide something unactionable would move
          // every later mob's loot for nothing. The flinch is checked first
          // because the damage branch anchors on `self` and needs no target at
          // all: a mob hit in an empty world can still flee.
          //
          // Whether it is REALLY chasing is `enderman-anger.ts`, which is not
          // ported (`../mob/enderman-teleport` lists it), so a present target is
          // read as a chase — the identical reading `../mob/creeper-fuse` gets
          // from this same field.
          if (!struck && senses.target === undefined) {
            return IGNORED
          }

          endermanScratch.damagedThisStep = struck
          const draw = nextRoll(cursor)
          cursor = draw.seed
          endermanScratch.roll = draw.roll

          const urge = endermanTeleportUrge(endermanScratch)
          // The verdict picks its own anchor and the frame supplies the position
          // for it. See the module header on why the reference lost this.
          const anchor =
            urge._tag === 'Stay'
              ? undefined
              : urge.anchor === 'self'
                ? entity.feetPosition
                : senses.target

          let destination: Position | undefined
          if (anchor !== undefined) {
            const batch = drawRolls(cursor, ENDERMAN_TELEPORT_ROLLS)
            cursor = batch.seed
            const offset = endermanTeleportOffset(batch.rolls)

            // `undefined` is sixteen misses, which is an ANSWER — the rule's own
            // header and the reference's oracle both pin "it stays where it is"
            // rather than a widened band. Nothing further is measured about the
            // destination either, and that gap is `ARENA_MISSING`'s 「where a
            // teleport LANDS」: the cell an enderman arrives in is a
            // `ChunkStoreApi.getBlock` question and this function holds no store,
            // by design — `sweepMobs` runs inside `Ref.modify`, so a read there
            // would be an Effect inside an atomic update. The honest place for a
            // ground check is a second pass beside `resolveBlasts`, which is
            // where the crater's writes already live, and it needs a query
            // `../chunk-store-port` does not have: the surface height of a
            // column, or 「is this cell solid」 for a mob rather than for a spawn
            // (`validSpawnSurface` answers about the block BELOW a candidate,
            // not about the two the mob would occupy).
            destination =
              offset === undefined
                ? undefined
                : {
                    x: anchor.x + offset.xBlocks,
                    // ITS OWN, not the anchor's. See the module header.
                    y: entity.feetPosition.y,
                    z: anchor.z + offset.zBlocks,
                  }
          }

          // Nothing moved and nothing was owed: the shared step, and the roster
          // stays the array it was.
          if (destination === undefined && !struck) {
            return IGNORED
          }

          // A blow is spent whether or not it moved the mob. `STEADY_ENDERMAN` is
          // shared, so clearing the flinch allocates nothing beyond the state
          // record every `Changed` transition needs.
          return {
            transition: changed({
              feetPosition: destination ?? entity.feetPosition,
              healthPoints: entity.healthPoints,
              behaviour: STEADY_ENDERMAN,
            }),
            emit: undefined,
          }
        }

        // A behaviour whose tag does not match its kind. `repairMobBehaviour`
        // replaces these on the load path; a host that spawns one directly gets
        // the same answer as a pig, which is the inert one.
        return IGNORED
      }),
      (blasts) => ({ blasts, seed: cursor }),
    )
  })

// ---------------------------------------------------------------------------
// Resolving a blast
// ---------------------------------------------------------------------------

export type BlastResolution = {
  /** Mobs the blast killed. Their drops are rolled outside the sweep, where the seed lives. */
  readonly casualties: ReadonlyArray<MobCasualty>
  /** Cells the crater emptied, for `disturb`. Empty when nothing was destroyed. */
  readonly disturbed: ReadonlyArray<PositionKey>
}

const NO_CASUALTIES: ReadonlyArray<never> = []
const NO_DISTURBANCES: ReadonlyArray<never> = []

/**
 * Turn blasts into damage and into a crater.
 *
 * ONE sweep for every blast, not one sweep per blast: 「an explosion damages every
 * entity in a radius, which is one pass, not N atomic updates」 is mc-sim's own
 * argument for why `sweep` is the only write path, and two creepers going off in
 * the same frame is the case that makes it matter — a mob standing between them
 * takes both blows, and taking them in two passes would let it die to the first
 * and never be reached by the second, which is the same answer by luck rather
 * than by design.
 *
 * The crater runs AFTER the damage. Both orders are defensible and this one is
 * chosen because the damage sweep is over a roster and the crater is over a
 * store: doing the store work first would put ~123 writes between a mob's health
 * being read and being written, for no gain.
 */
export const resolveBlasts = (
  roster: EntityManagerApi<MobBehaviour>,
  store: ChunkStoreApi,
  blasts: ReadonlyArray<Blast>,
): Effect.Effect<BlastResolution> =>
  Effect.gen(function* () {
    if (blasts.length === 0) {
      return { casualties: NO_CASUALTIES, disturbed: NO_DISTURBANCES }
    }

    const casualties = yield* roster.sweep<MobCasualty>((entity) => {
      const vitals = damageFrom(blasts, entity)

      if (vitals === undefined) {
        return IGNORED
      }

      if (isDead(vitals)) {
        return { transition: DESPAWNED, emit: { id: entity.id, kind: entity.kind } }
      }

      return {
        transition: changed({
          feetPosition: entity.feetPosition,
          healthPoints: vitals.healthPoints,
          // THE ONLY BLOW THIS REPOSITORY CAN MEASURE. `endermanTeleportUrge`'s
          // `damagedThisStep` is 「mc-sim's combat lane」 and there is no combat
          // lane here: melee belongs in a `domain/combat/` that does not exist
          // (`../mob/shulker-shell` puts the armour formula there for the same
          // reason), and a projectile has no producer. A blast is the one hit the
          // frame both delivers and knows about, so it is the one that arms the
          // flinch. `../mob/enderman-teleport` names water and daylight as the
          // other triggers it declines to invent; this is the trigger it can have.
          behaviour: bruise(entity.behaviour),
        }),
        emit: undefined,
      }
    })

    const disturbed: Array<PositionKey> = []
    for (const blast of blasts) {
      disturbed.push(...(yield* carveExplosionCrater(store, cellOf(blast.at), blast.explosion.power)))
    }

    return { casualties, disturbed }
  })

/**
 * Record that a blow landed, for the behaviours that care.
 *
 * NO BRANCH ON A KIND, deliberately, and the difference from `sweepMobs` is worth
 * the sentence. That function needs the kind because it decides which RULE runs
 * and a host can spawn a mismatched pair; this one is answering "does anything
 * remember being hit", and the only behaviour that does is the flinch. Asking the
 * value is therefore both narrower and total: a creeper keeps its fuse, a pig
 * keeps its `undefined`, and a mob whose flinch was already `Struck` is handed the
 * SAME shared value back, so a blast that reaches an enderman twice in one frame
 * allocates nothing on the second pass.
 */
const bruise = (behaviour: MobBehaviour): MobBehaviour =>
  isFlinch(behaviour) ? STRUCK_ENDERMAN : behaviour

/**
 * What every blast in this frame does to one entity, or `undefined` if none of
 * them reached it.
 *
 * `undefined` rather than "unchanged vitals" so that the caller can answer with
 * the shared `IGNORED` step. A mob outside every radius is the common case even
 * on the frame a creeper goes off, and it must cost nothing.
 *
 * The zero-damage guard is deliberate and is not a re-derivation of the radius:
 * `explosionDamageAt` already answers 0 outside the blast (and for a distance
 * that is not a number), and this only declines to allocate a `Vitals` for a blow
 * that would take nothing off. `../mob/explosion` guarantees the two are the same
 * question — its curve never yields zero anywhere INSIDE the radius, because of
 * the `+ 1`.
 */
const damageFrom = (blasts: ReadonlyArray<Blast>, entity: Entity<MobBehaviour>): Vitals | undefined => {
  let vitals: Vitals | undefined

  for (const blast of blasts) {
    const damage = explosionDamageAt(blast.explosion, distanceBetween(entity.feetPosition, blast.at))
    if (damage.amount <= 0) {
      continue
    }

    // The `Damage` carries its cause all the way in, and `applyDamage` records it
    // on the killing blow. See the module header on where it then goes.
    vitals = applyDamage(vitals ?? { healthPoints: entity.healthPoints, lastDeathCause: undefined }, damage)
  }

  return vitals
}

/** Every drop a blast's casualties leave, and the seed to keep. */
export type CasualtyDrops = {
  readonly drops: ReadonlyArray<MobDrop>
  readonly seed: number
}

const NO_DROPS: ReadonlyArray<never> = []

/**
 * Roll what the dead leave behind.
 *
 * OUTSIDE the sweep, and it has to be: the step function runs inside mc-sim's
 * `Ref.modify`, so drawing from the seed there would be a side effect inside an
 * atomic update — which is the shape mc-sim's `emit` channel exists to avoid
 * (「a side effect in the function an atomic update runs」).
 *
 * The seed advances by exactly the number of rolls the tables need and by no
 * more, so a scenario that spawns an extra mob that nothing kills gets the same
 * loot as one that does not. See `../frame-rolls`.
 */
export const rollCasualtyDrops = (
  casualties: ReadonlyArray<MobCasualty>,
  seed: number,
): CasualtyDrops => {
  if (casualties.length === 0) {
    return { drops: NO_DROPS, seed }
  }

  const drops: Array<MobDrop> = []
  let current = seed

  for (const casualty of casualties) {
    const batch = drawRolls(current, dropRollsNeeded(casualty.kind))
    current = batch.seed
    drops.push(...rollDropsOfKind(casualty.kind, SLAIN_BY_BLAST, batch.rolls))
  }

  return { drops, seed: current }
}

/**
 * What the creeper that produced a blast leaves behind: nothing.
 *
 * Called rather than assumed. `../mob/mob-drop`'s `rollMobDrop` returns
 * `undefined` for a `SelfDestruct` before it looks at anything else, so this
 * consumes no rolls and yields no items — and the reason that is written as a
 * call is the header of that file: in the reference the same behaviour is 「an
 * accident」 of statement order, and 「move the removal three lines down and the
 * rule changes with no test to notice」. Here the rule is asked.
 */
export const rollSelfDestructDrops = (kind: EntityKind): ReadonlyArray<MobDrop> =>
  rollDropsOfKind(kind, SELF_DESTRUCT, NO_DROPS)

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/**
 * One cell offered to the spawn rule, with the place a mob would stand in it.
 *
 * `candidate` is `canHostileSpawnAt`'s six facts and `feetPosition` is where the
 * mob goes if it says yes. They are separate fields because the rule does not
 * take a position and must not start to: 「every field is somebody else's fact」,
 * and a coordinate is the frame's business rather than the rule's.
 *
 * WHAT PRODUCES THESE IS NOT IN THIS REPOSITORY YET, and the blocker is worth
 * naming precisely because it is not "somebody has to write a loop". The
 * reference's spawner walks a ring of sixteen angles by four radii around the
 * player and asks about each cell, which needs two measurements this repository
 * cannot obtain today:
 *
 *   BLOCK LIGHT   `SpawnCandidate.blockLight` is mc-worldgen's light grid, and
 *                 `../chunk-store-port` — a mirror of mc-worldgen's WHOLE
 *                 `ChunkStoreApi` — has no light query at all. Reading an absent
 *                 grid as 0 would be reading it as PITCH DARK, which spawns
 *                 hostiles in a lit room; that is the direction
 *                 `../mob/hostile-spawn`'s `unmeasurable` refusal exists to
 *                 avoid, and inventing it here would defeat it.
 *
 *   TIME OF DAY   mc-sim's `TimeService.timeOfDay`, and `stages/registration.ts`
 *                 records why there is no port for it: mirroring the service
 *                 would mean restating `ClockPort`, which `../frame-contract`
 *                 names as 「a far worse failure than a narrower type」.
 *
 * So the stage applies the verdict to candidates it is HANDED, exactly as it
 * applies `breakBlock` to break requests it is handed, and the search is on the
 * arena's missing list with those two destinations.
 */
export type MobSpawnAttempt = {
  readonly candidate: SpawnCandidate
  readonly feetPosition: Position
}

/** What became of one attempt. Every outcome is named, because `run` has no error channel. */
export type MobSpawnOutcome =
  | { readonly _tag: 'Spawned'; readonly id: EntityId }
  /** The cell said no. `../mob/hostile-spawn` reports WHICH test failed, and it is kept. */
  | { readonly _tag: 'Refused'; readonly reason: SpawnRefusal }
  /** The cell said yes and the world is full. A different answer from a refusal, and a different fix. */
  | { readonly _tag: 'AtCapacity'; readonly population: number }

/**
 * Apply the spawn rule to each candidate, and the population cap to each that
 * passes.
 *
 * THE CENSUS IS RE-READ PER ATTEMPT, not hoisted. Two candidates in one frame
 * with one slot left must produce one mob and one `AtCapacity`, and a count taken
 * before the loop would produce two — which is the reference's population cap
 * failing in the only frame where the cap is the thing being tested.
 *
 * The refusals are returned rather than dropped. `../mob/hostile-spawn` answers
 * with a REASON rather than a `false` because 「a spawner that refuses everything
 * and a spawner that refuses everything FOR THE SAME REASON are different bugs,
 * and only the second is findable」; discarding the reason at the one call site
 * would make that design decorative.
 */
export const applySpawnAttempts = (
  roster: EntityManagerApi<MobBehaviour>,
  attempts: ReadonlyArray<MobSpawnAttempt>,
): Effect.Effect<ReadonlyArray<MobSpawnOutcome>> =>
  Effect.gen(function* () {
    const outcomes: Array<MobSpawnOutcome> = []

    for (const attempt of attempts) {
      const verdict = canHostileSpawnAt(attempt.candidate)
      if (verdict._tag === 'Refused') {
        outcomes.push({ _tag: 'Refused', reason: verdict.reason })
        continue
      }

      const population = yield* roster.countOfKind(CREEPER_KIND)
      if (population >= MAX_HOSTILE_COUNT) {
        outcomes.push({ _tag: 'AtCapacity', population })
        continue
      }

      const entity = yield* roster.spawn({
        kind: CREEPER_KIND,
        feetPosition: attempt.feetPosition,
        healthPoints: CREEPER_MAX_HEALTH,
        // A freshly spawned creeper is dormant — `../mob/creeper-fuse` says so in
        // the type's own doc comment, which is why there is no second constant
        // for it here.
        behaviour: DORMANT_FUSE,
      })
      outcomes.push({ _tag: 'Spawned', id: entity.id })
    }

    return outcomes
  })
