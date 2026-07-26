/**
 * A test double for mc-sim's `EntityManager`, typed by this repository's mirror
 * of that service (`domain/entity-manager-port.ts`).
 *
 * ---------------------------------------------------------------------------
 * Why a double at all, and what makes it meaningful
 * ---------------------------------------------------------------------------
 *
 * The same argument `chunk-store-double.ts` makes: nothing is published (plan.md
 * §6 Step 3 is bottom-up publish-then-pin), so mx-gameplay cannot import mc-sim's
 * implementation today, but it CAN be typed by mc-sim's interface — and the
 * mirror is pinned against that interface in both directions by
 * `test/entity-manager-mirror.test.ts`. The same scenarios against the REAL
 * roster are mc-sim's `test/entity-manager.test.ts` and its own vertical slice;
 * between the two the whole path is covered, and when mc-sim is published this
 * file is deleted and its Layer is replaced by `EntityManagerLayer<MobBehaviour>`.
 *
 * ---------------------------------------------------------------------------
 * THE THREE PROPERTIES IT REPRODUCES, AND WHY IT MUST
 * ---------------------------------------------------------------------------
 *
 * `chunk-store-double.ts` reproduces the three store semantics a rule can get
 * wrong. The equivalents here are mc-sim's `docs/public-api.md` §7-3, and they
 * are the whole reason `domain/entities/mob-frame.ts` is shaped the way it is —
 * a double that copied its array on every sweep would let a stage allocate
 * per-mob-per-frame garbage and no test in this repository would notice:
 *
 *   - `entities` returns the roster's OWN array. No copy, no projection. Two
 *     reads with no write between them return the same array.
 *   - An `Unchanged` entity is REUSED — the same object appears in the result, so
 *     a renderer or a network diff can compare by reference.
 *   - A sweep in which nothing changed and nothing was emitted returns the
 *     ARGUMENT roster and allocates no array at all. The result array is created
 *     lazily, on the first entity that actually changes, from the prefix that did
 *     not.
 *
 * The lazy-materialisation loop below is transcribed from `sweepRoster` in
 * `mc-sim/domain/entity.ts` for that reason. It is the one place in this
 * repository that copies another's implementation rather than its interface, and
 * it is worth it: the property under test in `test/vertical-slice.test.ts` — "the
 * idle frame does no work" — is a claim about allocation, and a double that
 * merely returned correct CONTENTS would pass it while the real service did not.
 *
 * ---------------------------------------------------------------------------
 * What it counts
 * ---------------------------------------------------------------------------
 *
 * `distinctStepObjects` is the number of DIFFERENT `EntityStep` values the last
 * sweep's step function returned, compared by identity. It exists because the
 * step record is the one allocation `sweepRoster` cannot remove and the stage
 * can: `domain/entities/mob-frame.ts` shares `IGNORED` and `SWEPT`, so an idle
 * frame over a hundred mobs must show ONE. A stage that built
 * `{ transition: UNCHANGED, emit: undefined }` per mob would show a hundred, be
 * completely correct, and be exactly the regression this counter is here to
 * catch.
 *
 * `restore` dies rather than answering plausibly, following the same rule as the
 * store double's `load`: the world-load path is not part of this repository's
 * slice, mc-sim's five repairs are pinned by mc-sim's own tests, and a double
 * that half-implemented them would let a test here assert a repair nobody
 * performs.
 */
import { Effect, Layer, Ref } from 'effect'
import type { MobBehaviour } from '../../domain/entities/mob-frame'
import {
  EntityId,
  entityManagerTag,
  type Entity,
  type EntityManager,
  type EntityManagerApi,
  type EntityRoster,
  type EntityState,
  type EntityStep,
  type Position,
} from '../../domain/entity-manager-port'

export type RosterCalls = {
  readonly sweeps: number
  readonly spawns: number
  readonly despawns: number
  /** `countOfKind`. The census a spawn cap needs, counted so that "re-read per attempt" is assertable. */
  readonly censuses: number
  /** Distinct `EntityStep` objects returned by the LAST sweep, by identity. */
  readonly distinctStepObjects: number
}

export type EntityManagerDouble<S> = {
  /** Handed straight to `gameplayStages`, which takes the API rather than the tag. */
  readonly api: EntityManagerApi<S>
  /** For the `makeGameplayStages` path, which acquires the tag itself. */
  readonly layer: Layer.Layer<EntityManager>
  readonly calls: Effect.Effect<RosterCalls>
}

type Doubles<S> = {
  roster: EntityRoster<S>
  sweeps: number
  spawns: number
  despawns: number
  censuses: number
  distinctStepObjects: number
}

/**
 * A coordinate or a health value with no magnitude becomes 0.
 *
 * mc-sim runs every state that enters the roster through this, at all three
 * entry points, so that a rule cannot write a `NaN` health even by accident —
 * and `mx-gameplay`'s own preview finding F5 is what that guard is for (a `NaN`
 * health makes an entity permanently immortal, because every later comparison
 * against `NaN` is false). Reproduced here because the alternative is a double
 * that is more permissive than the service, which is the direction that lets a
 * defect through.
 */
const magnitude = (value: number): number => (Number.isFinite(value) ? value : 0)

const repairPosition = (value: Position): Position => ({
  x: magnitude(value.x),
  y: magnitude(value.y),
  z: magnitude(value.z),
})

const repairState = <S>(state: EntityState<S>): EntityState<S> => ({
  feetPosition: repairPosition(state.feetPosition),
  healthPoints: Number.isFinite(state.healthPoints) ? Math.max(0, state.healthPoints) : 0,
  behaviour: state.behaviour,
})

/** Shared, so that an empty roster and a swept-clean one are the SAME array. */
const NO_ENTITIES: ReadonlyArray<never> = []
const NO_EMISSIONS: ReadonlyArray<never> = []

export const emptyRosterValue = <S>(): EntityRoster<S> => ({ entities: NO_ENTITIES, nextSerial: 0 })

export const makeEntityManagerDouble = <S>(
  initial: EntityRoster<S> = emptyRosterValue<S>(),
): Effect.Effect<EntityManagerDouble<S>> =>
  Effect.map(
    Ref.make<Doubles<S>>({
      roster: initial,
      sweeps: 0,
      spawns: 0,
      despawns: 0,
      censuses: 0,
      distinctStepObjects: 0,
    }),
    (state) => {
      const api: EntityManagerApi<S> = {
        spawn: (request) =>
          Ref.modify(state, (doubles) => {
            const entity: Entity<S> = {
              id: EntityId(`e:${String(doubles.roster.nextSerial)}`),
              kind: request.kind,
              ...repairState(request),
            }

            return [
              entity,
              {
                ...doubles,
                spawns: doubles.spawns + 1,
                roster: {
                  entities: [...doubles.roster.entities, entity],
                  nextSerial: doubles.roster.nextSerial + 1,
                },
              },
            ] as const
          }),

        despawn: (id) =>
          Ref.modify(state, (doubles) => {
            const entities = doubles.roster.entities.filter((entity) => entity.id !== id)
            const removed = entities.length !== doubles.roster.entities.length

            return [
              removed,
              {
                ...doubles,
                despawns: doubles.despawns + 1,
                // The serial is NOT reclaimed: an id is never reused inside one
                // world's lifetime, because a recycled id silently starts naming
                // a different mob to whoever held the old one.
                roster: removed
                  ? { entities, nextSerial: doubles.roster.nextSerial }
                  : doubles.roster,
              },
            ] as const
          }),

        entities: Effect.map(Ref.get(state), (doubles) => doubles.roster.entities),
        find: (id) =>
          Effect.map(Ref.get(state), (doubles) =>
            doubles.roster.entities.find((entity) => entity.id === id),
          ),
        count: Effect.map(Ref.get(state), (doubles) => doubles.roster.entities.length),
        countOfKind: (kind) =>
          Ref.modify(state, (doubles) => {
            const total = doubles.roster.entities.reduce(
              (running, entity) => (entity.kind === kind ? running + 1 : running),
              0,
            )
            return [total, { ...doubles, censuses: doubles.censuses + 1 }] as const
          }),

        sweep: <A>(step: (entity: Entity<S>) => EntityStep<S, A>) =>
          Ref.modify(state, (doubles) => {
            const seen = new Set<EntityStep<S, A>>()
            let kept: Array<Entity<S>> | undefined
            let emitted: Array<A> | undefined

            doubles.roster.entities.forEach((entity, index) => {
              const outcome = step(entity)
              seen.add(outcome)

              if (outcome.emit !== undefined) {
                emitted = emitted ?? []
                emitted.push(outcome.emit)
              }

              if (outcome.transition._tag === 'Unchanged') {
                kept?.push(entity)
                return
              }

              // First divergence: materialise the prefix that did not change,
              // once. Everything before this point cost nothing.
              kept = kept ?? doubles.roster.entities.slice(0, index)

              if (outcome.transition._tag === 'Changed') {
                kept.push({
                  id: entity.id,
                  kind: entity.kind,
                  ...repairState(outcome.transition.state),
                })
              }
            })

            return [
              (emitted ?? NO_EMISSIONS) as ReadonlyArray<A>,
              {
                ...doubles,
                sweeps: doubles.sweeps + 1,
                distinctStepObjects: seen.size,
                roster:
                  kept === undefined
                    ? doubles.roster
                    : { entities: kept, nextSerial: doubles.roster.nextSerial },
              },
            ] as const
          }),

        snapshot: Effect.map(Ref.get(state), (doubles) => doubles.roster),

        // Not exercised by this repository's slice. See the module header.
        restore: () => Effect.dieMessage('not exercised by this test'),

        reset: Ref.update(state, (doubles) => ({ ...doubles, roster: emptyRosterValue<S>() })),
      }

      return {
        api,
        layer: Layer.succeed(entityManagerTag<S>(), api),
        calls: Effect.map(Ref.get(state), (doubles) => ({
          sweeps: doubles.sweeps,
          spawns: doubles.spawns,
          despawns: doubles.despawns,
          censuses: doubles.censuses,
          distinctStepObjects: doubles.distinctStepObjects,
        })),
      }
    },
  )

/**
 * An empty roster as a Layer, for the tests that are about the SHAPE of the
 * registration rather than about any mob.
 *
 * Declared after the factory it calls because it evaluates at module load — the
 * same note `chunk-store-double.ts`'s `emptyWorldStoreLayer` carries.
 */
export const emptyRosterLayer: Layer.Layer<EntityManager> = Layer.effect(
  entityManagerTag<MobBehaviour>(),
  Effect.map(makeEntityManagerDouble<MobBehaviour>(), (double) => double.api),
)
