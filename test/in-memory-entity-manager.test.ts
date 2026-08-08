/**
 * `domain/in-memory-entity-manager.ts`.
 *
 * Two of these tests assert OBJECT IDENTITY rather than contents, and that is
 * deliberate: `@nerima-games/mc-sim` states both as contracts, and both are
 * invisible to a contents comparison.
 *
 *   `entities` resolves to the roster's OWN array — so two reads with no write
 *   between them are the same array.
 *   an idle `sweep` returns the ARGUMENT roster, having allocated nothing.
 *
 * A version that copied defensively passes every other test here and allocates
 * a fresh array per frame for a world in which nothing happened. The symptom is
 * a GC sawtooth nobody attributes to the roster.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'
import {
  InMemoryEntityManagerLayer,
  emptyRoster,
  makeInMemoryEntityManager,
  mintEntityId,
  repairRoster,
} from '../src/domain/in-memory-entity-manager'
import {
  DESPAWNED,
  EntityId,
  EntityKind,
  UNCHANGED,
  entityManagerTag,
  type Entity,
  type EntityRoster,
  type SpawnRequest,
} from '@nerima-games/mc-sim'

const position = (x: number, y: number, z: number): Position => ({ x, y, z })

type Behaviour = { readonly mood: string }

const ZOMBIE = EntityKind('zombie')
const CREEPER = EntityKind('creeper')

const spawnRequest = (kind = ZOMBIE): SpawnRequest<Behaviour> => ({
  kind,
  feetPosition: position(1, 64, 2),
  healthPoints: 20,
  behaviour: { mood: 'idle' },
})

/** An entity as an UNTRUSTED SAVE contains one — the brands are erased by JSON. */
const saved = (fields: Partial<Entity<Behaviour>>): Entity<Behaviour> =>
  ({
    id: EntityId('zombie-0'),
    kind: ZOMBIE,
    feetPosition: position(0, 0, 0),
    healthPoints: 20,
    behaviour: { mood: 'idle' },
    ...fields,
  }) as Entity<Behaviour>

describe('spawn and despawn', () => {
  it.effect('spawn mints an id and adds the entity', () =>
    Effect.gen(function* () {
      const roster = yield* makeInMemoryEntityManager<Behaviour>()

      const entity = yield* roster.spawn(spawnRequest())

      expect(entity.id).toBe(mintEntityId(ZOMBIE, 0))
      expect(yield* roster.count).toBe(1)
      expect(yield* roster.find(entity.id)).toStrictEqual(entity)
    }),
  )

  it.effect('ids are unique across spawns of the same kind', () =>
    Effect.gen(function* () {
      // The serial is what guarantees this; the kind prefix is for the human
      // reading a log. Two entities sharing an id makes `despawn` remove both.
      const roster = yield* makeInMemoryEntityManager<Behaviour>()

      const first = yield* roster.spawn(spawnRequest())
      const second = yield* roster.spawn(spawnRequest())

      expect(first.id).not.toBe(second.id)
    }),
  )

  it.effect('despawn resolves false for an id nobody has — not an error', () =>
    Effect.gen(function* () {
      const roster = yield* makeInMemoryEntityManager<Behaviour>()

      expect(yield* roster.despawn(EntityId('never-spawned'))).toBe(false)
    }),
  )

  it.effect('countOfKind counts one kind, not all of them', () =>
    Effect.gen(function* () {
      // The census a spawn cap reads. Counting everything would cap creepers
      // because there are zombies.
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      yield* roster.spawn(spawnRequest(ZOMBIE))
      yield* roster.spawn(spawnRequest(ZOMBIE))
      yield* roster.spawn(spawnRequest(CREEPER))

      expect(yield* roster.countOfKind(ZOMBIE)).toBe(2)
      expect(yield* roster.countOfKind(CREEPER)).toBe(1)
    }),
  )
})

describe('the allocation contract', () => {
  it.effect('entities resolves to the SAME array twice with no write between', () =>
    Effect.gen(function* () {
      // Identity, not contents. The mirror calls this "a contract of mc-sim's,
      // not an implementation detail".
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      yield* roster.spawn(spawnRequest())

      expect(yield* roster.entities).toBe(yield* roster.entities)
    }),
  )

  it.effect('REGRESSION: an idle sweep returns the ARGUMENT roster untouched', () =>
    Effect.gen(function* () {
      // Sixty times a second over a hundred dormant mobs. A defensive copy
      // here passes every other test in this file.
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      yield* roster.spawn(spawnRequest())
      const before = yield* roster.entities

      const emitted = yield* roster.sweep(() => ({ transition: UNCHANGED, emit: undefined }))

      expect(emitted).toStrictEqual([])
      expect(yield* roster.entities).toBe(before)
    }),
  )

  it.effect('an UNCHANGED entity is the same object, not a copy', () =>
    Effect.gen(function* () {
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      const spawned = yield* roster.spawn(spawnRequest())

      yield* roster.sweep((entity) =>
        entity.kind === CREEPER
          ? { transition: DESPAWNED, emit: undefined }
          : { transition: UNCHANGED, emit: undefined },
      )

      expect(yield* roster.find(spawned.id)).toBe(spawned)
    }),
  )

  it.effect('a sweep that emits DOES rebuild, because something happened', () =>
    Effect.gen(function* () {
      // The other side of the contract, so the test above cannot pass by never
      // rebuilding at all.
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      yield* roster.spawn(spawnRequest())

      const emitted = yield* roster.sweep(() => ({ transition: UNCHANGED, emit: 'noise' }))

      expect(emitted).toStrictEqual(['noise'])
    }),
  )
})

describe('sweep is the only write path', () => {
  it.effect('Changed replaces state but never id or kind', () =>
    Effect.gen(function* () {
      // "Id and kind are not the rule's to change" — a rule that could would be
      // able to turn a zombie into a creeper mid-frame.
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      const spawned = yield* roster.spawn(spawnRequest())

      yield* roster.sweep((entity) => ({
        transition: {
          _tag: 'Changed',
          state: {
            feetPosition: position(9, 9, 9),
            healthPoints: entity.healthPoints - 5,
            behaviour: { mood: 'angry' },
          },
        },
        emit: undefined,
      }))

      const after = yield* roster.find(spawned.id)
      expect(after?.id).toBe(spawned.id)
      expect(after?.kind).toBe(spawned.kind)
      expect(after?.healthPoints).toBe(15)
      expect(after?.behaviour).toStrictEqual({ mood: 'angry' })
    }),
  )

  it.effect('Despawned removes the entity', () =>
    Effect.gen(function* () {
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      yield* roster.spawn(spawnRequest())

      yield* roster.sweep(() => ({ transition: DESPAWNED, emit: undefined }))

      expect(yield* roster.count).toBe(0)
    }),
  )

  it.effect('one pass handles a mix of all three transitions', () =>
    Effect.gen(function* () {
      // The blast case the mirror names: damaging every entity in a radius is
      // ONE pass, not N atomic updates.
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      const survivor = yield* roster.spawn(spawnRequest(ZOMBIE))
      yield* roster.spawn(spawnRequest(CREEPER))
      const hurt = yield* roster.spawn(spawnRequest(ZOMBIE))

      const emitted = yield* roster.sweep((entity) => {
        if (entity.kind === CREEPER) {
          return { transition: DESPAWNED, emit: 'boom' }
        }
        if (entity.id === hurt.id) {
          return {
            transition: {
              _tag: 'Changed',
              state: { ...entity, healthPoints: 1 },
            },
            emit: undefined,
          }
        }
        return { transition: UNCHANGED, emit: undefined }
      })

      expect(emitted).toStrictEqual(['boom'])
      expect(yield* roster.count).toBe(2)
      expect((yield* roster.find(hurt.id))?.healthPoints).toBe(1)
      expect(yield* roster.find(survivor.id)).toBe(survivor)
    }),
  )
})

describe('restore repairs rather than validates', () => {
  it.effect('a clean roster needs no repair', () =>
    Effect.gen(function* () {
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      const clean: EntityRoster<Behaviour> = {
        entities: [saved({ id: EntityId('zombie-7') })],
        nextSerial: 8,
      }

      expect(yield* roster.restore(clean)).toStrictEqual({ discarded: 0, reidentified: 0 })
      expect(yield* roster.count).toBe(1)
    }),
  )

  it.effect('an entity with no kind is DISCARDED, because a kind is unrepairable', () =>
    Effect.sync(() => {
      // A kind is what the rules dispatch on. There is nothing to repair it to,
      // and inventing one would put a creeper in the world the save never had.
      const result = repairRoster<Behaviour>(
        { entities: [saved({ kind: '' as never })], nextSerial: 0 },
        (_kind, behaviour) => behaviour,
      )

      expect(result.repair.discarded).toBe(1)
      expect(result.roster.entities).toStrictEqual([])
    }),
  )

  it.effect('a duplicate id is REIDENTIFIED, not dropped', () =>
    Effect.sync(() => {
      // Dropping would lose an entity the save legitimately had. A new id makes
      // a stale reference stale, which is the honest outcome and is counted.
      const result = repairRoster<Behaviour>(
        {
          entities: [saved({ id: EntityId('same') }), saved({ id: EntityId('same') })],
          nextSerial: 0,
        },
        (_kind, behaviour) => behaviour,
      )

      expect(result.repair.reidentified).toBe(1)
      expect(result.roster.entities).toHaveLength(2)
      expect(result.roster.entities[0]?.id).not.toBe(result.roster.entities[1]?.id)
    }),
  )

  it.effect('a blank id is reidentified too', () =>
    Effect.sync(() => {
      const result = repairRoster<Behaviour>(
        { entities: [saved({ id: '   ' as never })], nextSerial: 3 },
        (_kind, behaviour) => behaviour,
      )

      expect(result.repair.reidentified).toBe(1)
      expect(result.roster.entities[0]?.id).toBe(mintEntityId(ZOMBIE, 3))
    }),
  )

  it.effect('the behaviour repair hook is applied to every survivor', () =>
    Effect.sync(() => {
      // The one field mc-sim cannot check, delegated to the party that
      // instantiated `S`. Required to be TOTAL: a throw here is a Cause.Die on
      // the world-load path that the frame loop swallows.
      const result = repairRoster<Behaviour>(
        { entities: [saved({}), saved({ id: EntityId('other') })], nextSerial: 0 },
        () => ({ mood: 'repaired' }),
      )

      expect(result.roster.entities.map((entity) => entity.behaviour)).toStrictEqual([
        { mood: 'repaired' },
        { mood: 'repaired' },
      ])
    }),
  )

  it.effect('reset empties the roster AND the counter', () =>
    Effect.gen(function* () {
      // "A NEW world, not a reloaded one." A counter that survived would mint
      // ids that collide with nothing, which is harmless, and would make the
      // first id of a new world depend on the last one of the old.
      const roster = yield* makeInMemoryEntityManager<Behaviour>()
      yield* roster.spawn(spawnRequest())

      yield* roster.reset

      expect(yield* roster.snapshot).toStrictEqual(emptyRoster<Behaviour>())
      const respawned = yield* roster.spawn(spawnRequest())
      expect(respawned.id).toBe(mintEntityId(ZOMBIE, 0))
    }),
  )
})

describe('InMemoryEntityManagerLayer, for a host that composes gameplayModule', () => {
  it.effect('resolves to a working EntityManager, defaulting to an empty roster', () =>
    Effect.gen(function* () {
      const manager = yield* entityManagerTag<Behaviour>().pipe(
        Effect.provide(InMemoryEntityManagerLayer<Behaviour>()),
      )

      expect(yield* manager.count).toBe(0)
      const entity = yield* manager.spawn(spawnRequest())
      expect(yield* manager.find(entity.id)).toStrictEqual(entity)
    }),
  )

  it.effect('seeds the service from the initial roster it is given', () =>
    Effect.gen(function* () {
      const initial: EntityRoster<Behaviour> = {
        entities: [saved({ id: EntityId('zombie-9') })],
        nextSerial: 10,
      }
      const manager = yield* entityManagerTag<Behaviour>().pipe(
        Effect.provide(InMemoryEntityManagerLayer<Behaviour>(initial)),
      )

      expect(yield* manager.count).toBe(1)
      expect(yield* manager.find(EntityId('zombie-9'))).toBeDefined()
      // The next spawn continues from the seeded roster's own counter rather
      // than starting over at zero.
      const spawned = yield* manager.spawn(spawnRequest())
      expect(spawned.id).toBe(mintEntityId(ZOMBIE, 10))
    }),
  )

  it.effect('defaults the repair hook to the identity, leaving behaviour untouched on restore', () =>
    Effect.gen(function* () {
      // The two tests above never call `restore`, so the identity default this
      // Layer falls back to when no hook is given — distinct from
      // `makeInMemoryEntityManager`'s own identity default, which the
      // "restore repairs rather than validates" suite already exercises — was
      // never itself invoked.
      const manager = yield* entityManagerTag<Behaviour>().pipe(
        Effect.provide(InMemoryEntityManagerLayer<Behaviour>()),
      )
      const seeded = saved({ id: EntityId('zombie-9') })

      yield* manager.restore({ entities: [seeded], nextSerial: 10 })

      expect((yield* manager.find(EntityId('zombie-9')))?.behaviour).toStrictEqual(seeded.behaviour)
    }),
  )

  it.effect('threads the repair hook it is given through to restore', () =>
    Effect.gen(function* () {
      const manager = yield* entityManagerTag<Behaviour>().pipe(
        Effect.provide(
          InMemoryEntityManagerLayer<Behaviour>(emptyRoster<Behaviour>(), () => ({
            mood: 'reincarnated',
          })),
        ),
      )

      yield* manager.restore({ entities: [saved({ id: EntityId('zombie-9') })], nextSerial: 10 })

      expect((yield* manager.find(EntityId('zombie-9')))?.behaviour).toStrictEqual({
        mood: 'reincarnated',
      })
    }),
  )
})
