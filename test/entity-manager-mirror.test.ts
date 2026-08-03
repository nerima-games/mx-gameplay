/**
 * The `EntityManager` mirror is pinned against mc-sim's real interface.
 *
 * ---------------------------------------------------------------------------
 * What this file is defending against
 * ---------------------------------------------------------------------------
 *
 * `domain/entity-manager-port.ts` is a temporary local copy of a service that
 * lives in another repository, and its header promises that deleting it and
 * repointing every import at `@nerima-games/mc-sim` will typecheck. Nothing but
 * a test can enforce that promise, and — as with `test/chunk-store-mirror.test.ts`
 * — the failure mode if it goes unenforced is not a compile error.
 *
 * Effect resolves Tags BY THEIR TEXTUAL KEY. Both copies use
 * `'@nerima-games/mc-sim/EntityManager'`, so in any bundle containing two of
 * them a `Layer` built against a narrow mirror satisfies the wide tag and every
 * method the narrow copy omitted is `undefined` at the point of use.
 *
 * There is one structural difference from the `ChunkStore` mirror and it makes
 * this file's job SMALLER rather than larger, so it is worth stating: mc-sim's
 * `EntityManager` is a plain structural type rather than a `Context.Tag` class,
 * because the service value type carries a parameter and a Tag class cannot be
 * generic in its own Tag. Two structurally identical type aliases are ONE type,
 * so the nominal drift `ChunkStore` can suffer is not available here. What is
 * still available is a missing method and a mistyped key, and those are what is
 * asserted below.
 */
import { describe, expect, it } from '@effect/vitest'
import { Brand, Context, Effect, type Layer } from 'effect'
import {
  changed,
  DESPAWNED,
  EntityId,
  EntityKind,
  ENTITY_MANAGER_TAG_KEY,
  entityManagerTag,
  UNCHANGED,
  type BehaviourRepair,
  type Entity,
  type EntityManager,
  type EntityManagerApi,
  type EntityRoster,
  type EntityStep,
  type Position,
  type RosterRepair,
  type SpawnRequest,
} from '../src/domain/entity-manager-port'
import {
  CREEPER_KIND,
  DROPPED_ITEM_KIND,
  ENDERMAN_KIND,
  isDroppedItemBehaviour,
  repairMobBehaviour,
  STEADY_ENDERMAN,
  STRUCK_ENDERMAN,
  type MobBehaviour,
} from '../src/domain/entities/mob-frame'
import { DORMANT_FUSE } from '../src/domain/mob/creeper-fuse'
import { makeEntityManagerDouble } from './support/entity-manager-double'

/**
 * mc-sim's `EntityManagerApi`, restated from
 * `mc-sim/application/entity-manager.ts`.
 *
 * Written out rather than imported because mc-sim is not published — which is
 * the same reason the mirror exists at all. When it is published, this alias
 * becomes `import type { EntityManagerApi } from '@nerima-games/mc-sim'` and
 * every assertion below keeps its meaning unchanged.
 *
 * There is NO deliberate widening here, unlike the `ChunkStore` mirror's
 * `Chunk.biomes`. Every member is transcribed exactly, which is what lets the
 * two assignments below check the whole surface rather than most of it.
 */
type SimEntityManagerApi<S> = {
  readonly spawn: (request: SpawnRequest<S>) => Effect.Effect<Entity<S>>
  readonly despawn: (id: EntityId) => Effect.Effect<boolean>
  readonly entities: Effect.Effect<ReadonlyArray<Entity<S>>>
  readonly find: (id: EntityId) => Effect.Effect<Entity<S> | undefined>
  readonly count: Effect.Effect<number>
  readonly countOfKind: (kind: EntityKind) => Effect.Effect<number>
  readonly sweep: <A>(step: (entity: Entity<S>) => EntityStep<S, A>) => Effect.Effect<ReadonlyArray<A>>
  readonly snapshot: Effect.Effect<EntityRoster<S>>
  readonly restore: (roster: EntityRoster<S>) => Effect.Effect<RosterRepair>
  readonly reset: Effect.Effect<void>
}

describe('the EntityManager mirror', () => {
  it.effect('matches mc-sim’s interface in BOTH directions', () =>
    Effect.sync(() => {
      // The assertions ARE the assignments. A method added, removed or
      // re-signed on either side stops the build here rather than at the
      // repoint — and, more importantly, rather than at runtime with an
      // `undefined` method.
      const asSim = (api: EntityManagerApi<MobBehaviour>): SimEntityManagerApi<MobBehaviour> => api
      const asMirror = (api: SimEntityManagerApi<MobBehaviour>): EntityManagerApi<MobBehaviour> => api

      expect(typeof asSim).toBe('function')
      expect(typeof asMirror).toBe('function')
    }),
  )

  it.effect('uses mc-sim’s tag key, character for character', () =>
    Effect.sync(() => {
      // If this string drifts, Effect resolves two different services and the
      // failure is a missing method at runtime in a bundle neither repository
      // tested alone.
      expect(ENTITY_MANAGER_TAG_KEY).toBe('@nerima-games/mc-sim/EntityManager')
      expect(entityManagerTag<MobBehaviour>().key).toBe('@nerima-games/mc-sim/EntityManager')
    }),
  )

  it.effect('every instantiation of the behaviour parameter names ONE service', () =>
    Effect.sync(() => {
      // The property mc-sim's §7-1 buys by using `Context.GenericTag` rather
      // than a Tag class: the CONTEXT IDENTITY has no parameter and the SERVICE
      // VALUE TYPE has one, and Effect resolves by the string, so a world has
      // one roster however many times a consumer names it.
      const asFuse = entityManagerTag<MobBehaviour>()
      const asNumber = entityManagerTag<number>()

      expect(asFuse.key).toBe(asNumber.key)

      // ...and the context requirement is the same nominal type either way, so
      // `EntityManager` appears once in an `R` rather than once per consumer.
      const sameRequirement = (tag: Context.Tag<EntityManager, EntityManagerApi<number>>): string => tag.key
      expect(sameRequirement(asNumber)).toBe(ENTITY_MANAGER_TAG_KEY)
    }),
  )

  it.effect('a Layer built from the mirror is a Layer for the tag', () =>
    Effect.sync(() => {
      const asLayer = (layer: Layer.Layer<EntityManager>): Layer.Layer<EntityManager> => layer
      expect(typeof asLayer).toBe('function')
    }),
  )

  /*
   * REGRESSION-SHAPED, and the shape is mc-physics'. A brand is keyed by its
   * STRING: `Brand.Brand<'EntityId'>` here and in mc-sim are ONE TYPE to
   * TypeScript, however differently the two constructors validate — which is
   * exactly the defect `test/stage-registration.test.ts` records for
   * `DeltaTimeSecs`, where mc-physics refined to a tighter range than kernel and
   * a kernel-built value satisfied every parameter type while breaking the
   * invariant the comments claimed. So the refinements are transcribed rather
   * than re-decided, and both boundaries are pinned here.
   */
  it.effect('the branded ids refine exactly as mc-sim’s do', () =>
    Effect.sync(() => {
      expect(EntityId('e:0')).toBe('e:0')
      expect(EntityKind('creeper')).toBe('creeper')

      expect(() => EntityId('   ')).toThrow()
      expect(() => EntityId('')).toThrow()
      expect(() => EntityKind('   ')).toThrow()

      // `Brand.refined` and not `Brand.nominal`: a blank literal fails where a
      // human wrote it. Values from outside the type system go through mc-sim's
      // `isEntityId` / `isEntityKind` on the load path instead, which is why
      // neither of those is mirrored — this repository writes literals.
      expect(Brand.error('x')).toBeDefined()
    }),
  )

  it.effect('does not leak into this package’s published surface', () =>
    Effect.gen(function* () {
      // `index.ts` deliberately omits this module, exactly as it omits
      // `domain/chunk-store-port.ts` and `domain/frame-contract.ts`.
      // Re-exporting another repository's service would make deleting the
      // stand-in a breaking change for consumers of mx-gameplay.
      const barrel = yield* Effect.promise(() => import('../src/index'))
      expect(Object.keys(barrel)).not.toContain('entityManagerTag')
      expect(Object.keys(barrel)).not.toContain('ENTITY_MANAGER_TAG_KEY')
      expect(Object.keys(barrel)).not.toContain('EntityId')
      expect(Object.keys(barrel)).not.toContain('EntityKind')

      // ...while the two things a host MUST import by name are exported, for the
      // reason `domain/entities/mob-frame.ts` gives: `EntityManagerLayer<S>()`
      // returns a `Layer.Layer<EntityManager>` in which `S` appears nowhere, so
      // the only defence against a host picking the wrong one is that exactly
      // one repository names it.
      expect(Object.keys(barrel)).toContain('repairMobBehaviour')
      expect(Object.keys(barrel)).toContain('CREEPER_KIND')
    }),
  )
})

describe('the behaviour parameter carries a CreeperFuse without mc-sim knowing what one is', () => {
  it.effect('a fuse survives spawn, sweep and snapshot BY REFERENCE IDENTITY', () =>
    Effect.gen(function* () {
      // The property mc-sim's `test/entity.test.ts` pins from its own side, and
      // the reason the parameter exists at all: this repository reads a
      // `CreeperFuse` back out with no cast and no adapter.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const lit: MobBehaviour = { _tag: 'Lit', burnedSecs: 0.75 }

      const spawned = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: 1, y: 64, z: 1 },
        healthPoints: 20,
        behaviour: lit,
      })

      expect(spawned.behaviour).toBe(lit)
      expect((yield* roster.api.find(spawned.id))?.behaviour).toBe(lit)
      expect((yield* roster.api.snapshot).entities[0]?.behaviour).toBe(lit)

      // ...and a sweep that does not touch it hands back the SAME entity object,
      // which is what makes a renderer's diff a reference comparison.
      const before = yield* roster.api.entities
      yield* roster.api.sweep(() => ({ transition: UNCHANGED, emit: undefined }))
      expect(yield* roster.api.entities).toBe(before)
    }),
  )

  it.effect('a position with no magnitude becomes the origin rather than NaN', () =>
    Effect.gen(function* () {
      // mc-sim repairs at every entry point and states why: `NaN` fails every
      // distance test, so an unrepaired mob is invisible to the ignition range
      // AND to the despawn radius — immortal and unreachable. A mob standing at
      // the origin is wrong in a way somebody can see. This repository's
      // preview finding F5 is the same observation about health.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const spawned = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: Number.NaN, y: 64, z: 1 },
        healthPoints: Number.NaN,
        behaviour: DORMANT_FUSE,
      })

      expect(spawned.feetPosition).toStrictEqual({ x: 0, y: 64, z: 1 })
      expect(spawned.healthPoints).toBe(0)
    }),
  )

  it.effect('`changed` and the two shared transitions are assignable at every behaviour type', () =>
    Effect.sync(() => {
      // `EntityTransition<never>` is assignable to `EntityTransition<S>` for
      // every `S`, which is what lets one frozen object serve every roster. The
      // assignments below are the assertion; the `expect` only keeps the
      // statement alive.
      const unchanged: EntityStep<MobBehaviour, never> = { transition: UNCHANGED, emit: undefined }
      const despawned: EntityStep<MobBehaviour, never> = { transition: DESPAWNED, emit: undefined }
      const asBlast: EntityStep<MobBehaviour, string> = unchanged

      const state = changed<MobBehaviour>({
        feetPosition: { x: 0, y: 0, z: 0 } satisfies Position,
        healthPoints: 20,
        behaviour: DORMANT_FUSE,
      })

      expect(unchanged.transition).toBe(UNCHANGED)
      expect(despawned.transition).toBe(DESPAWNED)
      expect(asBlast.emit).toBeUndefined()
      expect(state._tag).toBe('Changed')
    }),
  )
})

describe('repairMobBehaviour is the host half of mc-sim’s load path', () => {
  it.effect('migrates legacy dropped items to canonical durability', () =>
    Effect.sync(() => {
      const legacyStack = { _tag: 'DroppedItem', item: 'cobblestone', count: 3 } as const
      const legacyTool = { _tag: 'DroppedItem', item: 'wooden_pickaxe', count: 1 } as const

      expect(repairMobBehaviour(DROPPED_ITEM_KIND, legacyStack)).toStrictEqual({
        ...legacyStack,
        durability: null,
      })
      expect(repairMobBehaviour(DROPPED_ITEM_KIND, legacyTool)).toStrictEqual({
        ...legacyTool,
        durability: { current: 59, max: 59 },
      })
    }),
  )

  it.effect('accepts only canonical dropped-item durability', () =>
    Effect.sync(() => {
      const validTool = {
        _tag: 'DroppedItem',
        item: 'wooden_pickaxe',
        count: 1,
        durability: { current: 12, max: 59 },
      } as const
      expect(isDroppedItemBehaviour(validTool)).toBe(true)
      expect(repairMobBehaviour(DROPPED_ITEM_KIND, validTool)).toBe(validTool)

      for (const invalid of [
        { ...validTool, durability: null },
        { ...validTool, durability: { current: 60, max: 59 } },
        { ...validTool, durability: { current: 12, max: 60 } },
        { ...validTool, count: 2 },
        { _tag: 'DroppedItem', item: 'cobblestone', count: 1, durability: validTool.durability },
      ]) {
        expect(isDroppedItemBehaviour(invalid)).toBe(false)
        expect(repairMobBehaviour(DROPPED_ITEM_KIND, invalid)).toBeUndefined()
      }
    }),
  )

  it.effect('is a BehaviourRepair, and is total over anything a save can hold', () =>
    Effect.sync(() => {
      // The type assignment is half the test: mc-sim's `EntityManagerLayer`
      // takes exactly this shape, and a host wires this function into it.
      const asRepair: BehaviourRepair<MobBehaviour> = repairMobBehaviour
      expect(typeof asRepair).toBe('function')

      const untyped = repairMobBehaviour as (kind: EntityKind, behaviour: unknown) => MobBehaviour

      // Readable fuses survive untouched, by identity.
      const lit: MobBehaviour = { _tag: 'Lit', burnedSecs: 0.5 }
      expect(repairMobBehaviour(CREEPER_KIND, lit)).toBe(lit)
      expect(repairMobBehaviour(CREEPER_KIND, DORMANT_FUSE)).toBe(DORMANT_FUSE)

      // Everything a save can put there and a type cannot stop.
      expect(untyped(CREEPER_KIND, undefined)).toStrictEqual(DORMANT_FUSE)
      expect(untyped(CREEPER_KIND, null)).toStrictEqual(DORMANT_FUSE)
      expect(untyped(CREEPER_KIND, 'Lit')).toStrictEqual(DORMANT_FUSE)
      expect(untyped(CREEPER_KIND, { _tag: 'Swelling' })).toStrictEqual(DORMANT_FUSE)
      expect(untyped(CREEPER_KIND, { _tag: 'Lit' })).toStrictEqual(DORMANT_FUSE)
      expect(untyped(CREEPER_KIND, { _tag: 'Lit', burnedSecs: Number.NaN })).toStrictEqual(DORMANT_FUSE)
      expect(untyped(CREEPER_KIND, { _tag: 'Lit', burnedSecs: -1 })).toStrictEqual(DORMANT_FUSE)
    }),
  )

  it.effect('an unreadable fuse becomes DORMANT, which is the only safe direction', () =>
    Effect.sync(() => {
      // `Lit` would detonate a mob the player never provoked, and `Detonated`
      // would leave a creeper on the roster that no input can ever change
      // (`domain/mob/creeper-fuse.ts`: the state is terminal). Dormant is the
      // state a fresh creeper is in, so the mob resumes as if it had arrived.
      const repaired = (repairMobBehaviour as (k: EntityKind, b: unknown) => MobBehaviour)(
        CREEPER_KIND,
        { _tag: 'Detonating' },
      )
      expect(repaired).toStrictEqual({ _tag: 'Dormant' })
    }),
  )

  it.effect('a kind with no rule loses whatever it was carrying', () =>
    Effect.sync(() => {
      // No rule here would ever read it, and keeping it would make the roster's
      // contents depend on which build wrote the save.
      const pig = EntityKind('pig')
      expect(repairMobBehaviour(pig, DORMANT_FUSE)).toBeUndefined()
      expect(repairMobBehaviour(pig, STRUCK_ENDERMAN)).toBeUndefined()
      expect(repairMobBehaviour(pig, undefined)).toBeUndefined()
    }),
  )

  it.effect('an unreadable flinch becomes STEADY, which is the only direction that does not MOVE a mob', () =>
    Effect.sync(() => {
      // The enderman's arm of the repair, and its wrong direction is louder than
      // the fuse's. Falling back to `Struck` would run the damage branch on the
      // first frame after a world load and, 30% of the time, teleport a mob 8 to
      // 32 blocks out of the place the save file put it — for a blow that was
      // never struck, before the player has had a frame to act in.
      const untyped = repairMobBehaviour as (kind: EntityKind, behaviour: unknown) => MobBehaviour

      // Readable flinches survive untouched, by identity — both of them, because
      // `Struck` is a legitimate thing to save: a mob hit on the last frame
      // before the game was closed is owed its answer.
      expect(repairMobBehaviour(ENDERMAN_KIND, STEADY_ENDERMAN)).toBe(STEADY_ENDERMAN)
      expect(repairMobBehaviour(ENDERMAN_KIND, STRUCK_ENDERMAN)).toBe(STRUCK_ENDERMAN)

      for (const junk of [undefined, null, 'Struck', 42, [], { _tag: 'Angry' }, { tag: 'Steady' }]) {
        expect(untyped(ENDERMAN_KIND, junk)).toStrictEqual(STEADY_ENDERMAN)
      }

      // A FIELD THE RULE DOES NOT KNOW ABOUT SURVIVES, and that is the same
      // answer `isCreeperFuse` gives a `{ _tag: 'Dormant', … }` with something
      // extra on it. The repair is a validator and not a schema: it establishes
      // that every field a rule READS is present and in range, which is what
      // makes the frame path's tag test enough. Stripping the rest would allocate
      // a replacement for every entity on the load path in order to discard data
      // from a build that may be about to be rolled back to.
      const embellished = { _tag: 'Steady', writtenBy: 'a later build' }
      expect(untyped(ENDERMAN_KIND, embellished)).toBe(embellished)
    }),
  )

  it.effect('a behaviour of the wrong shape for its kind is REPLACED, not trusted', () =>
    Effect.sync(() => {
      // The claim the repair has always made, now that there are two shapes for
      // it to be wrong about. This is not tidiness: `sweepMobs` reads the tag to
      // choose which rule runs, so a creeper that kept a `Struck` would tick no
      // fuse at all and consult the teleport rule instead — a creeper that can
      // never explode, which no test that only looks at one kind would see.
      expect(repairMobBehaviour(CREEPER_KIND, STRUCK_ENDERMAN)).toStrictEqual(DORMANT_FUSE)
      expect(repairMobBehaviour(ENDERMAN_KIND, DORMANT_FUSE)).toStrictEqual(STEADY_ENDERMAN)
      expect(repairMobBehaviour(ENDERMAN_KIND, { _tag: 'Lit', burnedSecs: 1.4 })).toStrictEqual(
        STEADY_ENDERMAN,
      )
    }),
  )

  it.effect('is a FIXED POINT — repairing a repaired behaviour changes nothing', () =>
    Effect.sync(() => {
      // The same idempotence mc-sim's `normaliseRoster` tests are built around,
      // for the reason its header gives: a repair that is not a fixed point is a
      // repair that reproduces what it repairs, and that defect has been shipped
      // in this organisation once already (mc-sim's docs/testing.md §3.0.1).
      const inputs: ReadonlyArray<unknown> = [
        undefined,
        null,
        { _tag: 'Dormant' },
        { _tag: 'Lit', burnedSecs: 1.4 },
        { _tag: 'Detonated' },
        { _tag: 'Lit', burnedSecs: Number.POSITIVE_INFINITY },
        { _tag: 'Steady' },
        { _tag: 'Struck' },
        { _tag: 'Angry' },
      ]
      const untyped = repairMobBehaviour as (kind: EntityKind, behaviour: unknown) => MobBehaviour

      // Over every kind that has an arm, and over the one that has none: a repair
      // that is a fixed point for creepers and not for endermen would reproduce
      // exactly what it repairs on the second load.
      for (const kind of [CREEPER_KIND, ENDERMAN_KIND, EntityKind('pig')]) {
        for (const input of inputs) {
          const once = untyped(kind, input)
          expect(untyped(kind, once)).toStrictEqual(once)
        }
      }
    }),
  )
})
