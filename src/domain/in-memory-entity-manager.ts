/**
 * A COMPLETE in-memory `EntityManager`, typed by this repository's mirror.
 *
 * The third and last of the services `gameplayModule` requires.
 * `./in-memory-chunk-store`'s header carries the argument for why these exist,
 * why they are not test doubles, and when they are deleted.
 *
 * ---------------------------------------------------------------------------
 * THE SWEEP IS THE ONLY WRITE PATH, AND ITS ALLOCATION CONTRACT IS A CONTRACT
 * ---------------------------------------------------------------------------
 *
 * `@nerima-games/mc-sim` states two things about `sweep` that read as
 * performance notes and are not:
 *
 *   「A sweep in which nothing changed and nothing was emitted returns the
 *    ARGUMENT roster, having allocated no array at all.」
 *
 *   `entities` 「Resolves to the roster's OWN array — no copy, no projection」
 *
 * Both are observable. An idle frame over a hundred dormant mobs runs sixty
 * times a second; a sweep that rebuilt the array anyway would allocate a
 * hundred-element array per frame for a world in which nothing happened, and
 * the only symptom is a GC sawtooth nobody attributes to the roster. So the
 * implementation below reuses the array when every transition is `Unchanged`
 * and nothing was emitted, and a test asserts the identity rather than the
 * contents.
 *
 * ---------------------------------------------------------------------------
 * `restore` REPAIRS RATHER THAN VALIDATES, AND CANNOT FAIL
 * ---------------------------------------------------------------------------
 *
 * There is no error channel on purpose — the mirror says so — because this is
 * the world-load path and a throw there is a `Cause.Die` the frame loop
 * swallows. A saved roster can be wrong in exactly three ways, and each has a
 * repair rather than a refusal:
 *
 *   NO KIND — unrepairable, because a kind is what the rules dispatch on. The
 *   entity is DISCARDED and counted.
 *   BLANK OR DUPLICATE ID — reidentified from the serial counter. A stale
 *   reference to it is now stale, which is the honest outcome and is counted.
 *   A BEHAVIOUR THAT IS NOT AN `S` — not checkable here. `BehaviourRepair` is
 *   the injected hook the party that instantiated `S` supplies; it is required
 *   to be total for the same reason this function is.
 */
import { Effect, Layer, Ref } from 'effect'
import {
  EntityId,
  entityManagerTag,
  type BehaviourRepair,
  type Entity,
  type EntityKind,
  type EntityManager,
  type EntityManagerApi,
  type EntityRoster,
  type EntityStep,
  type RosterRepair,
  type SpawnRequest,
} from '@nerima-games/mc-sim'

/** A roster with nothing in it. */
export const emptyRoster = <S>(): EntityRoster<S> => ({ entities: [], nextSerial: 0 })

/**
 * How a minted id is spelled.
 *
 * `<kind>-<serial>` rather than a bare number, so an id read in a log says what
 * it is. The serial is what guarantees uniqueness; the kind is for the human.
 */
export const mintEntityId = (kind: EntityKind, serial: number): EntityId =>
  EntityId(`${kind}-${String(serial)}`)

/** The identity repair `restore` performs. Exposed so a test can drive it directly. */
export const repairRoster = <S>(
  roster: EntityRoster<S>,
  repairBehaviour: BehaviourRepair<S>,
): { readonly roster: EntityRoster<S>; readonly repair: RosterRepair } => {
  const seen = new Set<string>()
  const entities: Array<Entity<S>> = []
  let discarded = 0
  let reidentified = 0
  let serial = Math.max(0, Math.floor(roster.nextSerial))

  for (const entity of roster.entities) {
    // A kind is what the rules dispatch on. There is nothing to repair it to.
    if (typeof entity.kind !== 'string' || entity.kind.trim().length === 0) {
      discarded += 1
      continue
    }

    const blank = typeof entity.id !== 'string' || entity.id.trim().length === 0
    const duplicate = !blank && seen.has(entity.id)
    const id = blank || duplicate ? mintEntityId(entity.kind, serial) : entity.id
    if (blank || duplicate) {
      serial += 1
      reidentified += 1
    }

    seen.add(id)
    entities.push({
      id,
      kind: entity.kind,
      feetPosition: entity.feetPosition,
      healthPoints: entity.healthPoints,
      behaviour: repairBehaviour(entity.kind, entity.behaviour),
    })
  }

  return { roster: { entities, nextSerial: serial }, repair: { discarded, reidentified } }
}

/**
 * Build a roster.
 *
 * `repairBehaviour` defaults to the identity, which is correct for a host whose
 * `S` needs no repair and is the honest default: a hook that invented a
 * behaviour would be guessing at a type this file cannot see.
 */
export const makeInMemoryEntityManager = <S>(
  initial: EntityRoster<S> = emptyRoster<S>(),
  repairBehaviour: BehaviourRepair<S> = (_kind, behaviour) => behaviour,
): Effect.Effect<EntityManagerApi<S>> =>
  Effect.map(Ref.make<EntityRoster<S>>(initial), (state): EntityManagerApi<S> => ({
    spawn: (request: SpawnRequest<S>) =>
      Ref.modify(state, (roster) => {
        const entity: Entity<S> = {
          id: mintEntityId(request.kind, roster.nextSerial),
          kind: request.kind,
          feetPosition: request.feetPosition,
          healthPoints: request.healthPoints,
          behaviour: request.behaviour,
        }
        return [
          entity,
          { entities: [...roster.entities, entity], nextSerial: roster.nextSerial + 1 },
        ] as const
      }),

    despawn: (id) =>
      Ref.modify(state, (roster) => {
        const next = roster.entities.filter((entity) => entity.id !== id)
        // `false` when nothing had that id — "not an error", per the mirror.
        return [next.length !== roster.entities.length, { ...roster, entities: next }] as const
      }),

    // THE ROSTER'S OWN ARRAY. No copy: two reads with no write between them
    // resolve to the same array with the same objects in it, which the mirror
    // states is mc-sim's contract rather than an implementation detail.
    entities: Effect.map(Ref.get(state), (roster) => roster.entities),

    find: (id) =>
      Effect.map(Ref.get(state), (roster) =>
        roster.entities.find((entity) => entity.id === id),
      ),

    count: Effect.map(Ref.get(state), (roster) => roster.entities.length),

    countOfKind: (kind) =>
      Effect.map(
        Ref.get(state),
        (roster) => roster.entities.filter((entity) => entity.kind === kind).length,
      ),

    sweep: <A>(step: (entity: Entity<S>) => EntityStep<S, A>) =>
      Ref.modify(state, (roster) => {
        const emitted: Array<A> = []
        let mutated = false
        const next: Array<Entity<S>> = []

        for (const entity of roster.entities) {
          const outcome = step(entity)
          if (outcome.emit !== undefined) {
            emitted.push(outcome.emit)
          }

          switch (outcome.transition._tag) {
            case 'Unchanged':
              // The SAME object, not a copy. See the header.
              next.push(entity)
              break
            case 'Changed':
              mutated = true
              next.push({
                id: entity.id,
                kind: entity.kind,
                feetPosition: outcome.transition.state.feetPosition,
                healthPoints: outcome.transition.state.healthPoints,
                behaviour: outcome.transition.state.behaviour,
              })
              break
            case 'Despawned':
              mutated = true
              break
            // exhaustiveness arm over EntityStep['transition'], a closed
            // three-tag union ('Unchanged' | 'Changed' | 'Despawned'); all
            // three are handled above, so no input can reach this arm.
            /* v8 ignore start */
            default: {
              const exhaustive: never = outcome.transition
              void exhaustive
              break
            }
            /* v8 ignore stop */
          }
        }

        // THE ALLOCATION CONTRACT. Nothing changed and nothing emitted means
        // the argument roster goes back untouched — no new array, no new
        // record. An idle frame over a hundred dormant mobs allocates nothing.
        return mutated
          ? ([emitted, { ...roster, entities: next }] as const)
          : ([emitted, roster] as const)
      }),

    snapshot: Ref.get(state),

    restore: (roster) =>
      Ref.modify(state, () => {
        const result = repairRoster(roster, repairBehaviour)
        return [result.repair, result.roster] as const
      }),

    // Counter and all: a NEW world, not a reloaded one.
    reset: Ref.set(state, emptyRoster<S>()),
  }))

/** The roster as a Layer, for a host that composes `gameplayModule`. */
export const InMemoryEntityManagerLayer = <S>(
  initial: EntityRoster<S> = emptyRoster<S>(),
  repairBehaviour: BehaviourRepair<S> = (_kind, behaviour) => behaviour,
): Layer.Layer<EntityManager> =>
  Layer.effect(entityManagerTag<S>(), makeInMemoryEntityManager(initial, repairBehaviour))
