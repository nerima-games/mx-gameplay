/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-sim`'s `EntityManager`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * mc-sim is a legitimate `dependencies` edge for this repository (plan.md §2.1:
 * `gameplay --> sim`), so — exactly like `./chunk-store-port` — this mirror is
 * not standing in for a forbidden import, only for an unpublished one. plan.md
 * §6 Step 3 publishes bottom-up and nothing is on GitHub Packages yet, so
 * `pnpm check:deps` would reject an import of a package absent from
 * `package.json#dependencies`.
 *
 * WHEN mc-sim IS PUBLISHED:
 *   1. add `@nerima-games/mc-sim` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './entity-manager-port'` at `'@nerima-games/mc-sim'`.
 *
 * It is NOT re-exported from `index.ts`, for the same reason `./chunk-store-port`
 * is not: re-exporting another repository's service would make deleting the
 * stand-in a breaking change for consumers of mx-gameplay. `EntityManager` and
 * `EntityManagerApi` are nonetheless VISIBLE to a consumer, because they appear
 * in the type of `makeGameplayStages` — which is why they show up in the
 * "Supporting declarations" section of `api-lock.md`, precisely as `ChunkStore`
 * does.
 *
 * ---------------------------------------------------------------------------
 * Why the WHOLE api is mirrored even though four members are all that is used
 * ---------------------------------------------------------------------------
 *
 * `./chunk-store-port`'s header states the rule and the reason: Effect resolves
 * Tags by their TEXTUAL KEY, so a `Layer` built against a narrow mirror
 * satisfies the wide Tag and every omitted method reads `undefined` in a
 * repository that never saw this file. A narrower mirror is not "less of the
 * vocabulary", it is a silent runtime hazard. The stage below calls `sweep`,
 * `spawn`, `despawn` and `countOfKind`; all eleven members are here, and
 * `test/entity-manager-mirror.test.ts` pins the shape in both directions and the
 * key literally.
 *
 * ---------------------------------------------------------------------------
 * TWO HAZARDS THAT ARE NOT THE SAME, AND ONLY ONE OF THEM IS HERE
 * ---------------------------------------------------------------------------
 *
 * `ChunkStore` is a `Context.Tag` CLASS, so mc-worldgen's copy and this one are
 * two nominal types denoting one service — the shape can drift and TypeScript
 * cannot see it. `EntityManager` is not a class. mc-sim declares it as a plain
 * structural type:
 *
 *     type EntityManager = { readonly _tag: '@nerima-games/mc-sim/EntityManager' }
 *
 * and the copy below is structurally identical, which makes the two THE SAME
 * TYPE rather than two types that agree. It is a `Context.GenericTag` because
 * the service value type carries a parameter and a Tag class cannot be generic
 * in its own Tag (mc-sim's `application/entity-manager.ts` argues this at
 * length). So the class-shaped hazard does not exist for this mirror; what
 * remains is the KEY, and the key is asserted as a literal.
 *
 * The second hazard is real and is worth naming because it is invisible:
 * `EntityManagerLayer<S>()` has result type `Layer.Layer<EntityManager>` — `S`
 * appears NOWHERE in it. A host that builds the roster at the wrong `S` gets a
 * Layer that satisfies every requirement in this repository and hands the stage
 * a roster whose `behaviour` field is not what the stage's static type says. No
 * compiler on either side can see that. The only defence is that exactly ONE
 * repository names the behaviour type and the host imports that name from it:
 * that name is `MobBehaviour` in `./entities/mob-frame`, and it is exported from
 * `index.ts` for this reason and no other.
 *
 * ---------------------------------------------------------------------------
 * The brands are transcribed CHARACTER FOR CHARACTER, and that is load-bearing
 * ---------------------------------------------------------------------------
 *
 * `Brand.Brand<'EntityId'>` here and in mc-sim are ONE TYPE to TypeScript,
 * however differently the two constructors validate — the mc-physics defect
 * `test/stage-registration.test.ts` records for `DeltaTimeSecs` (a mirror
 * refining to a tighter range than kernel's, so a kernel-built value satisfied
 * the parameter type while breaking the invariant the comments claimed). The
 * refinements and the error messages below are copied from
 * `mc-sim/domain/entity.ts` unchanged for that reason, not for tidiness.
 *
 * ---------------------------------------------------------------------------
 * What is NOT mirrored, and why that is not a narrowing
 * ---------------------------------------------------------------------------
 *
 * `mc-sim/domain/entity.ts` also exports the PURE roster functions —
 * `spawnEntity`, `despawnEntity`, `findEntity`, `countOfKind`, `sweepRoster`,
 * `normaliseRoster`, `mintEntityId`, `serialOfEntityId`, `isEntityId`,
 * `isEntityKind`, `emptyRoster`. None of them is here. They carry no Tag, so
 * they carry none of the hazard the paragraph above is about: a function that is
 * absent from a mirror is a compile error at its call site, never an `undefined`
 * at run time. This repository calls the SERVICE, and the service is complete.
 *
 * `Position` is mirrored as a type and not as mc-sim's `position(x, y, z)`
 * constructor, for the same reason: an object literal cannot be silently wrong.
 * Note that it is NOT `./chunk-store-port`'s `BlockPosition` even though the two
 * have identical shape — a `BlockPosition` names a discrete cell and a
 * `Position` is a continuous point, and a mob standing at `y = 64.0` is at the
 * bottom of cell 64 rather than being cell 64. Both belong to mc-kernel and both
 * are mirrored at one hop's remove; collapsing them here would invent an
 * equivalence neither owner has declared.
 */
import { Brand, Context, type Effect } from 'effect'

// ---------------------------------------------------------------------------
// Vocabulary — mirrors mc-sim/domain/kernel-vocabulary.ts, which in turn mirrors
// mc-kernel. Two hops, one shape; both are deleted together.
// ---------------------------------------------------------------------------

/** A continuous world-space point. Y is up, 1 block = 1 unit. */
export type Position = {
  readonly x: number
  readonly y: number
  readonly z: number
}

// ---------------------------------------------------------------------------
// Identity — mirrors mc-sim/domain/entity.ts
// ---------------------------------------------------------------------------

/** Identifies one entity within one world, across a save/load round trip. */
export type EntityId = string & Brand.Brand<'EntityId'>

export const EntityId = Brand.refined<EntityId>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`EntityId must be a non-blank string, received ${JSON.stringify(value)}`),
)

/**
 * What KIND of entity this is — `'creeper'`, `'zombie'`, `'dropped_item'`.
 *
 * DELIBERATELY OPEN, and mc-sim's header explains at length why it refused to
 * close it: the roster of things that exist is a vocabulary, vocabularies are
 * kernel's, and plan.md §3.11 puts mob identity in the RULES tier — so a closed
 * union declared in mc-sim would be that repository guessing on behalf of this
 * one. The consequence for this file is that naming a kind is mx-gameplay's job
 * and nobody checks the spelling; see `CREEPER_KIND` in `./entities/mob-frame`,
 * which is the only place in this repository that names one.
 */
export type EntityKind = string & Brand.Brand<'EntityKind'>

export const EntityKind = Brand.refined<EntityKind>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`EntityKind must be a non-blank string, received ${JSON.stringify(value)}`),
)

// ---------------------------------------------------------------------------
// The entity
// ---------------------------------------------------------------------------

/**
 * Everything about an entity that can CHANGE while it exists.
 *
 * All three fields together, never a partial record: mc-sim's header cites this
 * repository's `./death-cause` for the reason — an optional field disappearing
 * across a call boundary is how a rule that meant to write a fuse writes nothing
 * and a creeper hisses forever.
 */
export type EntityState<S> = {
  /** Where it is, FEET ORIGIN. The name carries the convention (mc-sim DN-10). */
  readonly feetPosition: Position
  /** How much health it has left. There is no maximum here — that is per-kind, and kinds are this repository's. */
  readonly healthPoints: number
  /** Whatever the rules tier stores per entity, handed back untouched. mc-sim never reads inside it. */
  readonly behaviour: S
}

/** An entity: an identity, a kind, and the state that changes. */
export type Entity<S> = EntityState<S> & {
  readonly id: EntityId
  readonly kind: EntityKind
}

/** The whole roster, as one value. This is what a save file holds. */
export type EntityRoster<S> = {
  readonly entities: ReadonlyArray<Entity<S>>
  readonly nextSerial: number
}

/** What a caller supplies to bring an entity into existence. Note the absence of an id: minting is the roster's. */
export type SpawnRequest<S> = {
  readonly kind: EntityKind
  readonly feetPosition: Position
  readonly healthPoints: number
  readonly behaviour: S
}

// ---------------------------------------------------------------------------
// The frame sweep
// ---------------------------------------------------------------------------

/** What one step of a rule decides about one entity. */
export type EntityTransition<S> =
  /** Nothing happened to it this frame. The entity object is REUSED. */
  | { readonly _tag: 'Unchanged' }
  /** New position, health and behaviour. Id and kind are not the rule's to change. */
  | { readonly _tag: 'Changed'; readonly state: EntityState<S> }
  /** Gone. A detonated creeper, a mob that died, one that walked out of range. */
  | { readonly _tag: 'Despawned' }

/**
 * The two transitions that carry no payload, as shared constants.
 *
 * `EntityTransition<never>` is assignable to `EntityTransition<S>` for every
 * `S`, so one frozen object serves every roster — an idle frame over a hundred
 * dormant mobs allocates ZERO transition objects. `./entities/mob-frame` goes
 * one step further and shares the whole `EntityStep`, because the step record is
 * an allocation too and it is the one a stage controls.
 */
export const UNCHANGED: EntityTransition<never> = { _tag: 'Unchanged' }
export const DESPAWNED: EntityTransition<never> = { _tag: 'Despawned' }

export const changed = <S>(state: EntityState<S>): EntityTransition<S> => ({ _tag: 'Changed', state })

/**
 * One entity's outcome for one sweep: what becomes of it, and what the rule
 * produced.
 *
 * `emit` is how an explosion gets out, and it is `A | undefined` rather than an
 * array because "nothing happened" is the common case and it must not cost an
 * allocation.
 */
export type EntityStep<S, A> = {
  readonly transition: EntityTransition<S>
  readonly emit: A | undefined
}

// ---------------------------------------------------------------------------
// The load path
// ---------------------------------------------------------------------------

/**
 * How a host repairs a behaviour it — and only it — understands.
 *
 * A saved `behaviour` is JSON that CLAIMS to be an `S`, and mc-sim cannot check
 * that claim without knowing what an `S` is, which is the one thing it is built
 * not to know. So the check is delegated to the party that instantiated the
 * parameter, which is this repository: see `repairMobBehaviour` in
 * `./entities/mob-frame`. It must be TOTAL — a throw on the world-load path is a
 * `Cause.Die` that mc-sim's frame loop logs and swallows.
 */
export type BehaviourRepair<S> = (kind: EntityKind, behaviour: S) => S

/** What a repair had to change. Zero on a save this build wrote itself. */
export type RosterRepair = {
  /** Entities dropped because they had no kind. The only unrepairable field. */
  readonly discarded: number
  /** Entities given a new id because theirs was blank or a duplicate. A stale reference is now stale. */
  readonly reidentified: number
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type EntityManagerApi<S> = {
  readonly spawn: (request: SpawnRequest<S>) => Effect.Effect<Entity<S>>
  /** Remove one. Resolves to `false` when nothing had that id — not an error. */
  readonly despawn: (id: EntityId) => Effect.Effect<boolean>
  /**
   * Every entity, for iterating. THE HOT PATH.
   *
   * Resolves to the roster's OWN array — no copy, no projection — so two reads
   * with no write between them resolve to the same array with the same objects
   * in it. That is a contract of mc-sim's, not an implementation detail.
   */
  readonly entities: Effect.Effect<ReadonlyArray<Entity<S>>>
  readonly find: (id: EntityId) => Effect.Effect<Entity<S> | undefined>
  readonly count: Effect.Effect<number>
  /**
   * The census a spawn cap needs.
   *
   * `./mob/hostile-spawn`'s header names HOW MANY (`MAX_HOSTILE_COUNT = 16`
   * against a live census) among the things that 「arrive with mc-sim」. This is
   * it. mc-sim counts; the cap is still this repository's number.
   */
  readonly countOfKind: (kind: EntityKind) => Effect.Effect<number>
  /**
   * Advance every entity by one step, atomically, and collect what the rules
   * produced. THE ONLY WRITE PATH for an entity that already exists.
   *
   * There is deliberately no `moveTo`, no `damage` and no `setBehaviour`: a
   * second write path is a second place for the invariants to be enforced, and
   * the blast case wants the sweep anyway — damaging every entity in a radius is
   * ONE pass, not N atomic updates.
   *
   * A sweep in which nothing changed and nothing was emitted returns the
   * ARGUMENT roster, having allocated no array at all.
   */
  readonly sweep: <A>(step: (entity: Entity<S>) => EntityStep<S, A>) => Effect.Effect<ReadonlyArray<A>>
  /** The whole roster, for persistence and for mx-multiplayer's snapshots. */
  readonly snapshot: Effect.Effect<EntityRoster<S>>
  /** Install a saved roster. THE WORLD-LOAD PATH. No error channel, on purpose. */
  readonly restore: (roster: EntityRoster<S>) => Effect.Effect<RosterRepair>
  /** Empty the roster, counter and all. A NEW world, not a reloaded one. */
  readonly reset: Effect.Effect<void>
}

/**
 * The context identity of the roster service.
 *
 * Never constructed and has no members that mean anything — its whole job is to
 * be the nominal type that appears in an `R`, so that `EntityManager` is ONE
 * requirement whatever `S` a consumer instantiates. Structurally identical to
 * mc-sim's declaration, and therefore the same type; see the module header.
 */
export type EntityManager = {
  readonly _tag: '@nerima-games/mc-sim/EntityManager'
}

/**
 * The tag key is `'@nerima-games/mc-sim/EntityManager'` — mc-sim's, not this
 * repository's, because it denotes mc-sim's service. Changing this string breaks
 * resolution silently at runtime while typechecking cleanly, so
 * `test/entity-manager-mirror.test.ts` asserts it literally.
 */
export const ENTITY_MANAGER_TAG_KEY = '@nerima-games/mc-sim/EntityManager'

/**
 * The Tag, at the behaviour type the caller works in.
 *
 * ```ts
 * const roster = yield* entityManagerTag<MobBehaviour>()
 * ```
 *
 * Every call produces a Tag with the same key and therefore names the same
 * service; only the static view of the `behaviour` field differs.
 */
export const entityManagerTag = <S>(): Context.Tag<EntityManager, EntityManagerApi<S>> =>
  Context.GenericTag<EntityManager, EntityManagerApi<S>>(ENTITY_MANAGER_TAG_KEY)
