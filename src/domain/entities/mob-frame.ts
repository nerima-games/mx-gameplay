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
 * with both arguments coming from here. See `@nerima-games/mc-sim`'s header for
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
 * `@nerima-games/mc-sim`'s header makes for the parameter's existence.
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
import {
  blockTypeOfId,
  capabilityOfBlockId,
  isItemType,
  type ItemType,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  durabilityForItem,
  isDamageableItemType,
  isValidDurabilityForItem,
  type Durability,
} from '@nerima-games/mc-sim'
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
} from '@nerima-games/mc-sim'
import type { BlockPosition, ChunkStoreApi } from '../chunk-store-port'
import type { DeltaTimeSecs } from '../frame-contract'
import { drawRolls, nextRoll } from '../frame-rolls'
import { carveExplosionCrater } from '../interactions/explosion-crater'
import type { PositionKey } from '../position-key'
import { DORMANT_FUSE, stepCreeperFuse, type CreeperFuse, type CreeperSenses } from '../mob/creeper-fuse'
import {
  ENDERMAN_TELEPORT_ATTEMPTS,
  endermanTeleportCandidateCells,
  endermanTeleportCandidates,
  endermanTeleportUrge,
  resolveSafeEndermanTeleport,
  type EndermanSenses,
  type EndermanTeleportCell,
  type EndermanTeleportPosition,
} from '../mob/enderman-teleport'
import { explosionDamageAt, type Explosion } from '../mob/explosion'
import { FRESH_PRIMED_TNT, isPrimedTnt, stepPrimedTnt, type PrimedTnt } from '../mob/primed-tnt'
import {
  DESPAWN_DISTANCE_BLOCKS,
  despawnVerdict,
  RANDOM_DESPAWN_MIN_AGE_TICKS,
  RANDOM_DESPAWN_MIN_DISTANCE_BLOCKS,
  type DespawnCandidate,
  type HostileDifficulty,
} from '../mob/hostile-despawn'
import {
  CREEPER_LOCOMOTION,
  pursueHorizontally,
  ZOMBIE_KIND,
  ZOMBIE_LOCOMOTION,
} from '../mob/hostile-combat'
import { canMobSpawnAt, type SpawnCandidate, type SpawnRefusal } from '../mob/hostile-spawn'
import {
  BLAZE_KIND,
  ECOSYSTEM_MOB_KINDS,
  initialEcosystemMobState,
  NETHER_HOSTILE_KINDS,
  OVERWORLD_ECOSYSTEM_HOSTILE_KINDS,
  PASSIVE_MOB_KINDS,
  repairEcosystemMobState,
  stepEcosystemMob,
  type EcosystemAttack,
  type EcosystemMobState,
} from '../mob/mob-ecosystem'
import {
  BLAZE_DROPS,
  BLAZE_XP_REWARD,
  CREEPER_DROPS,
  CREEPER_XP_REWARD,
  ENDERMAN_DROPS,
  ENDERMAN_XP_REWARD,
  mobXpReward,
  rollMobDrops,
  type MobDrop,
  type MobDropRule,
  type MobKill,
  ZOMBIE_DROPS,
  ZOMBIE_XP_REWARD,
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
export type DroppedItemBehaviour = {
  readonly _tag: 'DroppedItem'
  readonly item: ItemType
  readonly count: number
  readonly durability: Durability | null
  readonly eligibleFromFrame?: number
}

export type HostileMobSnapshot = {
  readonly _tag: 'HostileMob'
  readonly behaviour: CreeperFuse | EndermanFlinch | EcosystemMobState | undefined
  readonly ageTicks: number
  readonly persistent: boolean
  readonly named: boolean
  readonly tamed: boolean
}

export type MobBehaviour =
  | HostileMobSnapshot
  | CreeperFuse
  | PrimedTnt
  | EndermanFlinch
  | EcosystemMobState
  | DroppedItemBehaviour
  | undefined

export const hostileMobSnapshot = (
  behaviour: HostileMobSnapshot['behaviour'],
  options: Partial<Omit<HostileMobSnapshot, '_tag' | 'behaviour'>> = {},
): HostileMobSnapshot => ({
  _tag: 'HostileMob',
  behaviour,
  ageTicks: options.ageTicks ?? 0,
  persistent: options.persistent ?? false,
  named: options.named ?? false,
  tamed: options.tamed ?? false,
})

/**
 * The three entity kinds this repository names.
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
export const DROPPED_ITEM_KIND: EntityKind = EntityKind('dropped_item')
export const PRIMED_TNT_KIND: EntityKind = EntityKind('primed_tnt')

/**
 * The second, and it now arrives from the spawner as well as from a host.
 *
 * THIS PARAGRAPH USED TO SAY 「NOTHING IN THIS REPOSITORY PUTS ONE ON THE
 * ROSTER」, and gave two reasons: `MobSpawnAttempt` carried no kind, and
 * `MAX_HOSTILE_COUNT` was a per-kind cap that a second hostile kind would turn
 * into 「a sum over a roster of hostile kinds that does not exist yet」. Both were
 * deferrals rather than refusals, and both are now done — the roster is
 * `HOSTILE_KINDS` below, the attempt carries a kind, and the cap is the sum.
 *
 * What made them deferrable was that no search existed to offer candidates. With
 * `./mob-spawn-search` the question stopped being hypothetical: a spawner that
 * produced only creepers in a world that can contain endermen would enforce
 * 「16 creepers」 rather than 「16 hostiles」, which is not the reference's cap and
 * not a defensible one — a player could be surrounded by 16 creepers AND every
 * enderman a host ever spawned.
 */
export const ENDERMAN_KIND: EntityKind = EntityKind('enderman')

/**
 * The third, and the only one that is NOT in `HOSTILE_KINDS` below.
 *
 * An endermite exists because a player threw an ender pearl and lost a 5% roll
 * (`../interactions/throw-ender-pearl.ts`), which is the only way vanilla makes
 * one and the only way this repository does. `../../stages/registration.ts`
 * performs the spawn.
 *
 * ---------------------------------------------------------------------------
 * IT HAS NO BEHAVIOUR RULE, AND THAT IS RECORDED RATHER THAN STUBBED
 * ---------------------------------------------------------------------------
 *
 * It is spawned with a `behaviour` of `undefined`, which `MobBehaviour` admits and
 * `sweepMobs` ticks nothing for — 「a pig keeps its `undefined`」. So an endermite
 * here appears, occupies a roster slot, can be shot, and does nothing else.
 *
 * The reference gives it `behavior: 'hostile'`
 * (`<reference-impl>/packages/entity/domain/mob/mobs/endermite.ts:8`), which
 * drives a generic chase-and-attack AI. THIS REPOSITORY HAS NO GENERIC MOB AI AT
 * ALL: `../mob/` holds a creeper's fuse, an enderman's teleport and a shulker's
 * shell, and not one of them is a chase. So the endermite is not less finished
 * than its neighbours by having no chase — it is less finished by having no rule
 * of its own, and 「small hostile End mob that spawns from ender pearl throws」
 * (`endermite.ts:4`) does not name one the way a fuse or a teleport is named.
 * Writing an attack loop to fill the gap would be inventing behaviour rather than
 * porting it.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS OUTSIDE `HOSTILE_KINDS`, AND WHAT THAT COSTS
 * ---------------------------------------------------------------------------
 *
 * That list is the SPAWNER's roster and the population cap's, and its header says
 * 「THIS IS THE ONE LIST [...] a kind cannot be spawnable without being counted」.
 * An endermite must not be in it, because `./mob-spawn-search` would then produce
 * endermites from the night sky, which is neither vanilla nor the reference: the
 * reference's spawner rotates eight hostiles and the endermite is not among the
 * ones it picks — its only producer is the pearl.
 *
 * THE COST IS STATED BECAUSE IT IS REAL: an endermite is a hostile mob that
 * `MAX_HOSTILE_COUNT` does not count, so a player throwing pearls can raise the
 * hostile population past 16. That is a DIVERGENCE from a cap this repository
 * argued for at length, and it is the correct half of the trade — the alternative
 * makes the natural spawner produce a mob that only a pearl should. If a cap over
 * pearl-spawned endermites is wanted, it is a rule of its own with its own number,
 * and it does not exist in the reference either. `test/ender-pearl.test.ts` pins
 * the exclusion so that adding this kind to `HOSTILE_KINDS` fails a named test
 * rather than quietly changing what spawns at night.
 */
export const ENDERMITE_KIND: EntityKind = EntityKind('endermite')

/**
 * An endermite's health at spawn.
 *
 * `<reference-impl>/packages/entity/domain/mob/mobs/endermite.ts:9` (`maxHealth: 8`),
 * which its comment attributes to vanilla. On this side of the line for
 * `CREEPER_MAX_HEALTH`'s reason: mc-sim's §7-6 puts per-kind constants in the
 * rules layer.
 *
 * It is NOT reachable through `maxHealthOfKind`, whose fallback is the creeper's
 * 20 and whose only caller picks from `HOSTILE_KINDS`. The pearl's spawn passes
 * this constant directly, because an endermite is not something the hostile
 * spawner produces and routing it through that function would mean adding a row
 * for a kind that function's callers can never be handed.
 */
export const ENDERMITE_MAX_HEALTH = 8

/**
 * Every kind this repository considers HOSTILE, and therefore every kind the
 * population cap counts and the spawner may produce.
 *
 * TWO ROWS, and the reference has eight. `ARENA_MISSING` recorded the gap as
 * 「the reference rotates 8 hostiles; which mob spawns is a table this repository
 * has no second row for」 — it has a second row now, and it still does not have
 * eight, because a third row would need a third `domain/mob/` rule behind it.
 * Listing a zombie here without one would be a claim that this build has
 * zombies, which is the direction `dropRulesOfKind` already refuses for the
 * ghast and the blaze.
 *
 * THIS IS THE ONE LIST. `./mob-spawn-search` picks from it and
 * `hostilePopulation` sums over it, so a kind cannot be spawnable without being
 * counted — which is the failure a separate spawn-roster and cap-roster would
 * eventually produce, and it is the same 「two lists, three consumers, no
 * agreement」 shape `../mob/hostile-spawn`'s header measures in the reference's
 * surface tables.
 */
// NON-EMPTY IN THE TYPE, not merely in the literal. `./mob-spawn-search` picks a
// member by a computed index, which `noUncheckedIndexedAccess` types
// `EntityKind | undefined` however the index was derived; it therefore needs
// somewhere total to land, and it used to land on `HOSTILE_KINDS[0] ??
// EntityKind('creeper')` — a SECOND fallback whose only job was to cover the
// possibility that this line is `[]`. Saying non-empty here deletes that layer
// and, more usefully, moves the claim to where a future edit to the roster would
// have to read it. A build with no hostiles is a decision, not an accident to be
// absorbed three files away.
export const HOSTILE_KINDS: readonly [EntityKind, ...ReadonlyArray<EntityKind>] = [
  CREEPER_KIND,
  ENDERMAN_KIND,
  ZOMBIE_KIND,
  ...OVERWORLD_ECOSYSTEM_HOSTILE_KINDS,
  ...NETHER_HOSTILE_KINDS,
]

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

/** A zombie's health at spawn. */
const ZOMBIE_MAX_HEALTH = 20

/**
 * An enderman's health at spawn.
 *
 * Vanilla's 40, and on this side of the line for `CREEPER_MAX_HEALTH`'s reason:
 * mc-sim's §7-6 puts per-kind constants in the rules layer, because a table of
 * them mirrored into mc-sim 「が「クリーパーとは何か」を知る商売に戻る」.
 *
 * It exists now because the spawner produces endermen. Before that, every
 * enderman on the roster came from a host's `spawn`, which supplies its own
 * health — so there was no place in this repository that had to know the number
 * and inventing one would have been a constant with no caller.
 */
export const ENDERMAN_MAX_HEALTH = 40

/**
 * How much health a freshly spawned hostile has.
 *
 * Total, and the fallback is the interesting part: a kind with no row gets the
 * creeper's 20 rather than a throw, because `applySpawnAttempts` runs inside a
 * frame with no error channel. It is unreachable today — the only caller picks
 * from `HOSTILE_KINDS`, and every member has a row — and it is written as a
 * total function anyway so that adding a kind to that list produces a mob with
 * plausible health rather than a `NaN`-healthed one that is instantly dead.
 */
export const maxHealthOfKind = (kind: EntityKind): number => {
  if (kind === ENDERMAN_KIND) return ENDERMAN_MAX_HEALTH
  if (kind === ZOMBIE_KIND) return ZOMBIE_MAX_HEALTH
  if (kind === EntityKind('spider')) return 16
  if (kind === EntityKind('cow') || kind === EntityKind('pig')) return 10
  if (kind === EntityKind('sheep')) return 8
  if (kind === EntityKind('chicken')) return 4
  return CREEPER_MAX_HEALTH
}

/**
 * The behaviour a freshly spawned hostile carries.
 *
 * Creepers start with `DORMANT_FUSE`, endermen with `STEADY_ENDERMAN`, and
 * zombies carry no state because their pursuit rule is stateless.
 *
 * It agrees with `repairMobBehaviour` by construction: both send a creeper to a
 * fuse and an enderman to a flinch, and `sweepMobs` picks its rule by the tag
 * and guards on the kind. A spawner that handed a creeper a flinch would produce
 * a mob that ticks nothing, which is exactly the mismatch that function's last
 * paragraph is about.
 */
export const initialBehaviourOfKind = (kind: EntityKind): MobBehaviour => {
  if (ECOSYSTEM_MOB_KINDS.includes(kind as (typeof ECOSYSTEM_MOB_KINDS)[number])) return hostileMobSnapshot(initialEcosystemMobState())
  if (kind === ENDERMAN_KIND) return hostileMobSnapshot(STEADY_ENDERMAN)
  if (kind === ZOMBIE_KIND) return hostileMobSnapshot(undefined)
  return hostileMobSnapshot(DORMANT_FUSE)
}

/**
 * How many hostiles may exist at once.
 *
 * `../mob/hostile-spawn.ts`'s header lists this among the things it does not
 * decide — 「HOW MANY (`MAX_HOSTILE_COUNT = 16` against a live census) [...] Every
 * one of those reads or writes the roster. They arrive with mc-sim」 — and this is
 * that arrival. The number is
 * `<reference-impl>/packages/entity/domain/mob/spawner-config.ts`'s.
 *
 * THE DIVERGENCE THIS NOTE USED TO RECORD IS GONE. It read: 「the reference's cap
 * is over ALL hostiles and this one is per kind, because `countOfKind` is the
 * census mc-sim publishes and a total-hostiles count would need this repository
 * to enumerate which kinds are hostile — a roster it does not have. With exactly
 * one hostile kind the two agree; the day a second arrives, the cap has to become
 * a sum and this comment is where that is recorded.」
 *
 * The day arrived with `./mob-spawn-search`. The roster is `HOSTILE_KINDS` and
 * the cap is a sum over it — see `hostilePopulation`. The cost is one
 * `countOfKind` call per hostile kind per accepted candidate instead of one,
 * which is two calls today and is the correct shape however long the list grows:
 * mc-sim's census answers about ONE kind (mc-sim DN-11 — `countOfKind` 「compares
 * two strings the caller supplied and that is the whole of its interest」), so a
 * total is this repository's to add up.
 */
export const MAX_HOSTILE_COUNT = 16

/**
 * How many hostiles are on the roster right now.
 *
 * A SUM over `HOSTILE_KINDS` rather than a single count, and re-read per
 * accepted candidate rather than hoisted — see `applySpawnAttempts` on why
 * hoisting it breaks the cap in the only frame where the cap is what is being
 * tested.
 */
export const hostilePopulation = <S>(roster: EntityManagerApi<S>): Effect.Effect<number> =>
  Effect.reduce(HOSTILE_KINDS, 0, (total, kind) =>
    Effect.map(roster.countOfKind(kind), (count) => total + count),
  )

export const MAX_PASSIVE_COUNT = 16

export const passivePopulation = <S>(roster: EntityManagerApi<S>): Effect.Effect<number> =>
  Effect.reduce(PASSIVE_MOB_KINDS, 0, (total, kind) =>
    Effect.map(roster.countOfKind(kind), (count) => total + count),
  )

/** What a creeper leaves behind. A creeper drops nothing at all, which is `../mob/mob-drop`'s rule and not this file's. */
const SELF_DESTRUCT: MobKill = { _tag: 'SelfDestruct' }

/**
 * A player-caused casualty with no Looting context.
 *
 * Bow and melee requests currently carry damage but no enchantment metadata,
 * so both drop and experience resolution use level zero.
 */
const SLAIN_WITHOUT_LOOTING: MobKill = { _tag: 'Slain', lootingLevel: 0 }

const NO_DROP_RULES: ReadonlyArray<MobDropRule> = []

/**
 * The loot table for a kind.
 *
 * A table in the rules tier, which is where mob identity lives (plan.md §3.11).
 * `../mob/mob-drop` also holds a ghast's; it is not here because no `EntityKind`
 * in this build spawns one. Blaze is wired because the Nether ecosystem does
 * spawn `BLAZE_KIND`.
 */
export const dropRulesOfKind = (kind: EntityKind): ReadonlyArray<MobDropRule> =>
  kind === CREEPER_KIND
    ? CREEPER_DROPS
    : kind === ZOMBIE_KIND
      ? ZOMBIE_DROPS
      : kind === ENDERMAN_KIND
        ? ENDERMAN_DROPS
        : kind === BLAZE_KIND
          ? BLAZE_DROPS
          : NO_DROP_RULES

/** Experience granted when the player kills one runtime-supported hostile. */
export const xpRewardOfKind = (kind: EntityKind): number =>
  kind === CREEPER_KIND
    ? CREEPER_XP_REWARD
    : kind === ZOMBIE_KIND
      ? ZOMBIE_XP_REWARD
      : kind === ENDERMAN_KIND
        ? ENDERMAN_XP_REWARD
        : kind === BLAZE_KIND
          ? BLAZE_XP_REWARD
          : 0

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
export const repairMobBehaviour = (kind: EntityKind, behaviour: unknown): MobBehaviour => {
  if (isHostileMobSnapshot(behaviour) && HOSTILE_KINDS.includes(kind)) {
    const inner = repairHostileInner(kind, behaviour.behaviour)
    return inner === behaviour.behaviour && Object.hasOwn(behaviour, 'behaviour')
      ? behaviour
      : { ...behaviour, behaviour: inner }
  }

  if (kind === CREEPER_KIND) {
    return hostileMobSnapshot(isCreeperFuse(behaviour) ? behaviour : DORMANT_FUSE)
  }

  if (kind === ENDERMAN_KIND) {
    return hostileMobSnapshot(isEndermanFlinch(behaviour) ? behaviour : STEADY_ENDERMAN)
  }

  if (kind === ZOMBIE_KIND) return hostileMobSnapshot(undefined)

  if (ECOSYSTEM_MOB_KINDS.includes(kind as (typeof ECOSYSTEM_MOB_KINDS)[number])) {
    return hostileMobSnapshot(repairEcosystemMobState(behaviour) ?? initialEcosystemMobState())
  }

  if (kind === PRIMED_TNT_KIND) {
    return isPrimedTnt(behaviour) ? behaviour : FRESH_PRIMED_TNT
  }

  if (kind === DROPPED_ITEM_KIND) {
    if (isDroppedItemBehaviour(behaviour)) return behaviour
    if (!isLegacyDroppedItemBehaviour(behaviour)) return undefined
    return { ...behaviour, durability: durabilityForItem(behaviour.item) }
  }

  return undefined
}

const repairHostileInner = (
  kind: EntityKind,
  behaviour: unknown,
): HostileMobSnapshot['behaviour'] => {
  if (kind === CREEPER_KIND) return isCreeperFuse(behaviour) ? behaviour : DORMANT_FUSE
  if (kind === ENDERMAN_KIND) return isEndermanFlinch(behaviour) ? behaviour : STEADY_ENDERMAN
  if (ECOSYSTEM_MOB_KINDS.includes(kind as (typeof ECOSYSTEM_MOB_KINDS)[number])) return repairEcosystemMobState(behaviour) ?? initialEcosystemMobState()
  return undefined
}

export const isHostileMobSnapshot = (value: unknown): value is HostileMobSnapshot => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<HostileMobSnapshot>
  return (
    candidate._tag === 'HostileMob' &&
    typeof candidate.ageTicks === 'number' &&
    Number.isFinite(candidate.ageTicks) &&
    candidate.ageTicks >= 0 &&
    typeof candidate.persistent === 'boolean' &&
    typeof candidate.named === 'boolean' &&
    typeof candidate.tamed === 'boolean'
  )
}

export const isDroppedItemBehaviour = (value: unknown): value is DroppedItemBehaviour => {
  if (!hasDroppedItemFields(value)) return false
  return isDamageableItemType(value.item)
    ? value.count === 1 && isValidDurabilityForItem(value.item, value.durability)
    : value.durability === null
}

const hasDroppedItemFields = (
  value: unknown,
): value is {
  readonly _tag: 'DroppedItem'
  readonly item: ItemType
  readonly count: number
  readonly durability?: unknown
  readonly eligibleFromFrame?: number
} => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as {
    readonly _tag?: unknown
    readonly item?: unknown
    readonly count?: unknown
    readonly durability?: unknown
    readonly eligibleFromFrame?: unknown
  }
  return candidate._tag === 'DroppedItem' &&
    typeof candidate.item === 'string' &&
    isItemType(candidate.item) &&
    typeof candidate.count === 'number' &&
    Number.isInteger(candidate.count) &&
    candidate.count > 0 &&
    (candidate.eligibleFromFrame === undefined ||
      (typeof candidate.eligibleFromFrame === 'number' &&
        Number.isInteger(candidate.eligibleFromFrame) &&
        candidate.eligibleFromFrame >= 0))
}

const isLegacyDroppedItemBehaviour = (
  value: unknown,
): value is Omit<DroppedItemBehaviour, 'durability'> =>
  hasDroppedItemFields(value) &&
  !Object.hasOwn(value, 'durability') &&
  (!isDamageableItemType(value.item) || value.count === 1)

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

const innerBehaviour = (behaviour: MobBehaviour): HostileMobSnapshot['behaviour'] =>
  isHostileMobSnapshot(behaviour) ? behaviour.behaviour : behaviour as HostileMobSnapshot['behaviour']

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

/**
 * A mob that died to a blow, for the drop roll that happens outside the sweep.
 *
 * TWO PRODUCERS NOW, not one: `resolveBlasts` and `resolveBowHits`. The name was
 * always about what a casualty IS rather than what killed it, and the drop roll
 * downstream (`rollCasualtyDrops`) has never asked.
 */
export type MobCasualty = {
  readonly id: EntityId
  readonly kind: EntityKind
  readonly at: Position
}

/** One entity, and what a shot took off it. See `resolveBowHits`. */
export type BowHit = {
  readonly id: EntityId
  /** Health points, already scaled by charge and Power (`../interactions/draw-bow.ts`). */
  readonly damage: number
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
 * `Math.floor` and not `Math.round`, which is why `Position` and
 * `BlockPosition` are distinct types:
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
  /** Additive until the world host supplies its difficulty; omitted means normal. */
  readonly difficulty?: HostileDifficulty
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
  readonly attacks: ReadonlyArray<MobAttackEvent>
  readonly teleports: ReadonlyArray<EndermanTeleportProbe>
  /**
   * The seed to keep. Advanced by exactly the rolls the rules asked for and by no
   * more — see the module header, and `ENDERMAN_TELEPORT_ROLLS` for the one place
   * a budget is drawn rather than a single roll.
   */
  readonly seed: number
}

export type MobAttackEvent = EcosystemAttack & {
  readonly source: EntityId
  readonly at: Position
}

/** A deterministic teleport decision awaiting world-backed landing validation. */
export type EndermanTeleportProbe = {
  readonly _tag: 'EndermanTeleport'
  readonly entityId: EntityId
  readonly current: EndermanTeleportPosition
  readonly anchor: EndermanTeleportPosition
  readonly rolls: ReadonlyArray<number>
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
      roster.sweep<Blast | MobAttackEvent | EndermanTeleportProbe>((entity) => {
        if (entity.kind === DROPPED_ITEM_KIND && isDroppedItemBehaviour(entity.behaviour)) {
          return IGNORED
        }

        if (entity.kind === PRIMED_TNT_KIND && isPrimedTnt(entity.behaviour)) {
          const step = stepPrimedTnt(entity.behaviour, senses.dt)
          if (step.explosion !== undefined) {
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
          return step.tnt === entity.behaviour
            ? IGNORED
            : {
                transition: changed({
                  feetPosition: entity.feetPosition,
                  healthPoints: entity.healthPoints,
                  behaviour: step.tnt,
                }),
                emit: undefined,
              }
        }

        const distance =
          senses.target === undefined ? undefined : distanceBetween(entity.feetPosition, senses.target)

        const snapshot = isHostileMobSnapshot(entity.behaviour) ? entity.behaviour : undefined
        const ageTicks = snapshot === undefined ? undefined : snapshot.ageTicks + senses.dt * 20
        despawnScratch.distanceToPlayerBlocks = distance
        if (ageTicks === undefined) delete despawnScratch.ageTicks
        else despawnScratch.ageTicks = ageTicks
        despawnScratch.persistent = snapshot?.persistent ?? false
        if (snapshot === undefined) {
          delete despawnScratch.named
          delete despawnScratch.tamed
        } else {
          despawnScratch.named = snapshot.named
          despawnScratch.tamed = snapshot.tamed
        }
        despawnScratch.difficulty = senses.difficulty ?? 'normal'
        delete despawnScratch.randomRoll
        if (
          distance !== undefined &&
          distance > RANDOM_DESPAWN_MIN_DISTANCE_BLOCKS &&
          distance <= DESPAWN_DISTANCE_BLOCKS &&
          ageTicks !== undefined &&
          ageTicks > RANDOM_DESPAWN_MIN_AGE_TICKS &&
          !despawnScratch.persistent &&
          !despawnScratch.named &&
          !despawnScratch.tamed &&
          despawnScratch.difficulty !== 'peaceful'
        ) {
          const draw = nextRoll(cursor)
          cursor = draw.seed
          despawnScratch.randomRoll = draw.roll
        }
        if (despawnVerdict(despawnScratch)._tag === 'Despawn') {
          // NO DROPS. A despawn is not a death: nobody killed it, nobody is there
          // to pick anything up, and `../mob/mob-drop`'s `MobKill` has no case for
          // it because there is nothing to decide.
          return SWEPT
        }

        const behaviour = innerBehaviour(entity.behaviour)
        const storedBehaviour = (
          next: HostileMobSnapshot['behaviour'],
        ): MobBehaviour => snapshot === undefined
          ? next
          : { ...snapshot, behaviour: next, ageTicks: ageTicks ?? snapshot.ageTicks }
        if (entity.kind === ZOMBIE_KIND) {
          const feetPosition = pursueHorizontally(
            entity.feetPosition,
            senses.target,
            senses.dt,
            ZOMBIE_LOCOMOTION,
          )
          return feetPosition === entity.feetPosition && snapshot === undefined
            ? IGNORED
            : {
                transition: changed({
                  feetPosition,
                  healthPoints: entity.healthPoints,
                  behaviour: storedBehaviour(behaviour),
                }),
                emit: undefined,
              }
        }


        if (ECOSYSTEM_MOB_KINDS.includes(entity.kind) && behaviour?._tag === 'EcosystemMob') {
          const step = stepEcosystemMob(
            entity.kind,
            behaviour,
            entity.feetPosition,
            senses.target,
            senses.dt,
          )
          return {
            transition: changed({
              feetPosition: step.feetPosition,
              healthPoints: entity.healthPoints,
              behaviour: storedBehaviour(step.state),
            }),
            emit: step.attack === undefined
              ? undefined
              : { ...step.attack, source: entity.id, at: entity.feetPosition },
          }
        }

        if (behaviour === undefined) {
          // The whole cost of a mob this repository has no rule for: one closure
          // call, one distance, and a shared object.
          return IGNORED
        }

        if (entity.kind === CREEPER_KIND && isFuse(behaviour)) {
          const feetPosition = pursueHorizontally(
            entity.feetPosition,
            senses.target,
            senses.dt,
            CREEPER_LOCOMOTION,
          )
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
                at: feetPosition,
                explosion: step.explosion,
              },
            }
          }

          // Reference identity, not deep equality. `stepCreeperFuse` returns the
          // ARGUMENT fuse when nothing happened (a dormant creeper out of range, a
          // detonated one), so `===` is exact here and costs nothing — and it is
          // what lets an idle frame reach mc-sim's zero-allocation path.
          return step.fuse === behaviour && feetPosition === entity.feetPosition && snapshot === undefined
            ? IGNORED
            : {
                transition: changed({
                  feetPosition,
                  healthPoints: entity.healthPoints,
                  behaviour: storedBehaviour(step.fuse),
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
            return snapshot === undefined
              ? IGNORED
              : {
                  transition: changed({
                    feetPosition: entity.feetPosition,
                    healthPoints: entity.healthPoints,
                    behaviour: storedBehaviour(behaviour),
                  }),
                  emit: undefined,
                }
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

          let teleport: EndermanTeleportProbe | undefined
          if (anchor !== undefined) {
            const batch = drawRolls(cursor, ENDERMAN_TELEPORT_ROLLS)
            cursor = batch.seed
            if (endermanTeleportCandidates(entity.feetPosition, anchor, batch.rolls).length > 0) {
              // ChunkStore reads happen after the atomic roster sweep. Unloaded
              // or unsafe candidates are rejected by resolveEndermanTeleportProbes.
              teleport = {
                _tag: 'EndermanTeleport',
                entityId: entity.id,
                current: entity.feetPosition,
                anchor,
                rolls: batch.rolls,
              }
            }
          }

          // Nothing moved and nothing was owed: the shared step, and the roster
          // stays the array it was.
          if (!struck && snapshot === undefined) {
            return teleport === undefined ? IGNORED : { transition: UNCHANGED, emit: teleport }
          }

          // A blow is spent whether or not it moved the mob. `STEADY_ENDERMAN` is
          // shared, so clearing the flinch allocates nothing beyond the state
          // record every `Changed` transition needs.
          return {
            transition: changed({
              feetPosition: entity.feetPosition,
              healthPoints: entity.healthPoints,
              behaviour: storedBehaviour(STEADY_ENDERMAN),
            }),
            emit: teleport,
          }
        }

        // A behaviour whose tag does not match its kind. `repairMobBehaviour`
        // replaces these on the load path; a host that spawns one directly gets
        // the same answer as a pig, which is the inert one.
        return IGNORED
      }),
      (events) => ({
        blasts: events.filter((event): event is Blast => !('_tag' in event)),
        attacks: events.filter(
          (event): event is MobAttackEvent => '_tag' in event && event._tag !== 'EndermanTeleport',
        ),
        teleports: events.filter(
          (event): event is EndermanTeleportProbe =>
            '_tag' in event && event._tag === 'EndermanTeleport',
        ),
        seed: cursor,
      }),
    )
  })

/** Resolves planned teleports against loaded terrain, then applies only safe landings. */
export const resolveEndermanTeleportProbes = (
  roster: EntityManagerApi<MobBehaviour>,
  store: ChunkStoreApi,
  probes: ReadonlyArray<EndermanTeleportProbe>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const destinations = new Map<EntityId, EndermanTeleportPosition>()

    for (const probe of probes) {
      const cells = yield* Effect.forEach(
        endermanTeleportCandidateCells(probe.current, probe.anchor, probe.rolls),
        (position) =>
          Effect.map(store.getBlock(position), (reading): EndermanTeleportCell | undefined => {
            if (reading._tag !== 'Block') return undefined
            const block = blockTypeOfId(reading.block)
            if (block === undefined) return undefined
            return {
              position,
              block,
              solid: capabilityOfBlockId(reading.block, 'validSpawnSurface'),
            }
          }),
      )
      const destination = resolveSafeEndermanTeleport(
        probe.current,
        probe.anchor,
        probe.rolls,
        cells.filter((cell): cell is EndermanTeleportCell => cell !== undefined),
      )
      if (destination !== probe.current) destinations.set(probe.entityId, destination)
    }

    if (destinations.size === 0) return

    yield* roster.sweep<never>((entity) => {
      const destination = destinations.get(entity.id)
      return destination === undefined
        ? IGNORED
        : {
            transition: changed({
              feetPosition: destination,
              healthPoints: entity.healthPoints,
              behaviour: entity.behaviour,
            }),
            emit: undefined,
          }
    })
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
      if (entity.kind === DROPPED_ITEM_KIND && isDroppedItemBehaviour(entity.behaviour)) {
        return IGNORED
      }

      const vitals = damageFrom(blasts, entity)

      if (vitals === undefined) {
        return IGNORED
      }

      if (isDead(vitals)) {
        return {
          transition: DESPAWNED,
          emit: { id: entity.id, kind: entity.kind, at: entity.feetPosition },
        }
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
 * Turn bow hits into damage.
 *
 * `resolveBlasts`' sibling, and deliberately the same shape: ONE sweep for every
 * hit rather than one sweep per hit, because `sweep` is mc-sim's only write path
 * and two arrows reaching one mob in a frame must both land — the second would
 * otherwise be applied to a mob the first had already removed.
 *
 * THE DAMAGE PER ENTITY IS SUMMED BY THE CALLER, not here, and the parameter is a
 * list rather than a map for that reason: two shots at one mob are two hits, and
 * whether they add up is a question about a frame rather than about a sweep. The
 * interactions stage sums them.
 *
 * NO CRATER, NO STORE, AND NO SECOND PASS. A blast reshapes the world and this
 * does not, which is why this function takes no `ChunkStoreApi` and why it is much
 * the shorter of the two.
 *
 * ---------------------------------------------------------------------------
 * IT ARMS THE ENDERMAN'S FLINCH, AND THAT PARAGRAPH IS NOW OUT OF DATE
 * ---------------------------------------------------------------------------
 *
 * `resolveBlasts` carries a long note ending 「melee belongs in a `domain/combat/`
 * that does not exist [...] and A PROJECTILE HAS NO PRODUCER. A blast is the one
 * hit the frame both delivers and knows about, so it is the one that arms the
 * flinch」.
 *
 * The bow is that producer. It is not a projectile in the sense that sentence
 * assumed — nothing flies (`../interactions/draw-bow.ts`'s header) — but it is
 * exactly the thing the sentence was waiting for: a hit this frame delivers and
 * knows about, from a weapon rather than from an explosion. So `bruise` is applied
 * here too, and an enderman shot with a bow can now teleport away from it, which
 * is `../mob/enderman-teleport.ts`'s `damaged` branch reached for the second time
 * and the first time from a weapon.
 *
 * Melee is still absent and still for that note's reason.
 */
export const resolveBowHits = (
  roster: EntityManagerApi<MobBehaviour>,
  hits: ReadonlyArray<BowHit>,
): Effect.Effect<ReadonlyArray<MobCasualty>> =>
  Effect.gen(function* () {
    if (hits.length === 0) {
      return NO_CASUALTIES
    }

    // Summed here rather than by the caller after all — see above, the LIST is
    // the contract and the summing is this function's reading of it. A map keyed
    // by id costs one allocation per frame in which anything was shot at all.
    const totals = new Map<EntityId, number>()
    for (const hit of hits) {
      if (!Number.isFinite(hit.damage) || hit.damage <= 0) {
        continue
      }
      totals.set(hit.id, (totals.get(hit.id) ?? 0) + hit.damage)
    }

    if (totals.size === 0) {
      return NO_CASUALTIES
    }

    return yield* roster.sweep<MobCasualty>((entity) => {
      if (entity.kind === DROPPED_ITEM_KIND && isDroppedItemBehaviour(entity.behaviour)) {
        return IGNORED
      }

      const amount = totals.get(entity.id)
      if (amount === undefined) {
        return IGNORED
      }

      // `../death-cause.ts`'s rule rather than a bare subtraction, for the reason
      // this file's header gives: 「Writing a bare `healthPoints - amount`」 is how
      // the floor at zero gets forgotten in one of the two places that need it.
      // The cause is `projectile`, which is what the reference calls an arrow
      // (`player-damage-cause.ts:5`) — it is discarded for a mob, whose death
      // needs no message, and it is passed anyway because `Damage` requires one
      // and inventing a second damage type without a cause is how the field
      // becomes optional.
      const vitals = applyDamage(
        { healthPoints: entity.healthPoints, lastDeathCause: undefined },
        { amount, cause: 'projectile' },
      )

      if (isDead(vitals)) {
        return {
          transition: DESPAWNED,
          emit: { id: entity.id, kind: entity.kind, at: entity.feetPosition },
        }
      }

      return {
        transition: changed({
          feetPosition: entity.feetPosition,
          healthPoints: vitals.healthPoints,
          behaviour: bruise(entity.behaviour),
        }),
        emit: undefined,
      }
    })
  })

/** Melee uses the same batched entity transition as an instantaneous bow hit. */
export const resolveMeleeHits = resolveBowHits

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
  isHostileMobSnapshot(behaviour)
    ? isFlinch(behaviour.behaviour)
      ? { ...behaviour, behaviour: STRUCK_ENDERMAN }
      : behaviour
    : isFlinch(behaviour)
      ? STRUCK_ENDERMAN
      : behaviour

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
  readonly drops: ReadonlyArray<MobDropEvent>
  readonly seed: number
}

export type MobDropEvent = MobDrop & {
  readonly source: EntityId
  readonly kind: EntityKind
  readonly at: Position
}

/** Experience left by a player-caused mob casualty for the host to award. */
export type MobExperienceEvent = {
  readonly source: EntityId
  readonly kind: EntityKind
  readonly at: Position
  readonly amount: number
}

const NO_DROPS: ReadonlyArray<never> = []

/** Resolve experience without consuming the deterministic loot seed. */
export const experienceOfCasualties = (
  casualties: ReadonlyArray<MobCasualty>,
): ReadonlyArray<MobExperienceEvent> =>
  casualties.flatMap((casualty) => {
    const amount = mobXpReward(SLAIN_WITHOUT_LOOTING, xpRewardOfKind(casualty.kind))
    return amount <= 0
      ? []
      : [{ source: casualty.id, kind: casualty.kind, at: casualty.at, amount }]
  })

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

  const drops: Array<MobDropEvent> = []
  let current = seed

  for (const casualty of casualties) {
    const batch = drawRolls(current, dropRollsNeeded(casualty.kind))
    current = batch.seed
    drops.push(
      ...rollDropsOfKind(casualty.kind, SLAIN_WITHOUT_LOOTING, batch.rolls).map((drop) => ({
        ...drop,
        source: casualty.id,
        kind: casualty.kind,
        at: casualty.at,
      })),
    )
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
export const rollSelfDestructDrops = (blast: Blast): ReadonlyArray<MobDropEvent> =>
  rollDropsOfKind(blast.kind, SELF_DESTRUCT, NO_DROPS).map((drop) => ({
    ...drop,
    source: blast.source,
    kind: blast.kind,
    at: blast.at,
  }))

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
 * WHAT PRODUCES THESE IS `./mob-spawn-search`, and this paragraph used to say it
 * did not exist. It named two missing measurements:
 *
 *   BLOCK LIGHT   「`SpawnCandidate.blockLight` is mc-worldgen's light grid, and
 *                 `../chunk-store-port` — a mirror of mc-worldgen's WHOLE
 *                 `ChunkStoreApi` — has no light query at all」. It has one now.
 *                 mc-worldgen built the grid it had been claiming to own since
 *                 `application/chunk-store.ts`'s header was written, and the
 *                 mirror carries `getLight` beside `getBlock`. The warning that
 *                 came with the gap held: the reading is three-valued, so an
 *                 unloaded chunk is still not darkness.
 *
 *   TIME OF DAY   mc-sim's `TimeService.timeOfDay`, and it is STILL not
 *                 mirrorable — `../frame-contract` names restating `ClockPort`
 *                 as 「a far worse failure than a narrower type」 and that has not
 *                 changed. It reaches the search as an inbox `Ref` instead, which
 *                 `stages/registration.ts` argues in the same terms it argues
 *                 `targetPosition`: the frame writes it and the stage reads it
 *                 within one frame, it answers no question, and nothing reads it
 *                 afterwards.
 *
 * THE KIND IS NOW CARRIED, and that is the change this type's shape needed. It
 * used to hold only a candidate and a position, and `applySpawnAttempts` spawned
 * a creeper unconditionally — which was correct exactly as long as the creeper
 * was the only hostile anything could produce. `HOSTILE_KINDS` and the search
 * that picks from it end that; see `ENDERMAN_KIND` for the deferral this
 * discharges.
 */
export type MobSpawnAttempt = {
  readonly candidate: SpawnCandidate
  /**
   * Which hostile this cell would produce.
   *
   * CHOSEN BY WHOEVER OFFERS THE CELL, not by the rule and not by
   * `applySpawnAttempts`. `../mob/hostile-spawn` answers about a cell and knows
   * nothing about mobs; the population cap is about a total and does not care
   * which. Putting the choice on the attempt keeps both of those true and puts
   * it where the randomness already is — `./mob-spawn-search` draws it from
   * `../frame-rolls` beside the roll that rotates its ring.
   *
   * A kind outside `HOSTILE_KINDS` is not rejected here. It would spawn, would
   * count against nothing, and would tick whichever rule its behaviour's tag
   * selects — which is the same latitude a host's `spawn` already has, and
   * narrowing it would mean this function policing a roster mc-sim deliberately
   * leaves open (mc-sim DN-11).
   */
  readonly kind: EntityKind
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
      const verdict = canMobSpawnAt(attempt.kind, attempt.candidate)
      if (verdict._tag === 'Refused') {
        outcomes.push({ _tag: 'Refused', reason: verdict.reason })
        continue
      }

      // THE SUM, not `countOfKind(CREEPER_KIND)`. With multiple hostile kinds a
      // per-kind cap enforces 「16 creepers」 rather than 「16 hostiles」, so a
      // player could be surrounded by sixteen of each. See `MAX_HOSTILE_COUNT`,
      // whose note recorded this as the thing that would have to change.
      const passive = PASSIVE_MOB_KINDS.includes(attempt.kind)
      const population = yield* (passive ? passivePopulation(roster) : hostilePopulation(roster))
      if (population >= (passive ? MAX_PASSIVE_COUNT : MAX_HOSTILE_COUNT)) {
        outcomes.push({ _tag: 'AtCapacity', population })
        continue
      }

      const entity = yield* roster.spawn({
        kind: attempt.kind,
        feetPosition: attempt.feetPosition,
        healthPoints: maxHealthOfKind(attempt.kind),
        // Each rule's own type documents its starting state, so the value is
        // looked up rather than restated here.
        behaviour: initialBehaviourOfKind(attempt.kind),
      })
      outcomes.push({ _tag: 'Spawned', id: entity.id })
    }

    return outcomes
  })
