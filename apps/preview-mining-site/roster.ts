/**
 * AN EMPTY ROSTER, for a preview that has no mobs.
 *
 * `gameplay:entities` now iterates mc-sim's `EntityManager` every frame, so
 * `gameplayStages` takes one — and the mining site is about sand, gravel, water
 * and a pickaxe. It needs a roster to hand over and it has nothing to put in one.
 *
 * ---------------------------------------------------------------------------
 * It REFUSES to grow a mob, and that is the whole design of this file
 * ---------------------------------------------------------------------------
 *
 * `./world.ts` plays mc-worldgen's part for this preview and implements a real
 * store, because the rules under test read and write blocks and a store that
 * refused would test nothing. Nothing here is under test: this preview never
 * spawns, never sets a target and never offers a spawn candidate, so a working
 * roster would be A SECOND IMPLEMENTATION OF MC-SIM'S SERVICE living in
 * mx-gameplay — the thing `stages/registration.ts` spent a headed paragraph
 * refusing to write, arriving through an app directory instead of through a Ref.
 *
 * So every mutator dies rather than answering plausibly, exactly as
 * `test/support/chunk-store-double.ts` does for the store methods outside its
 * slice. If a future preview wants a creeper in the mining site, the honest move
 * is to depend on mc-sim once it is published — not to finish this file.
 *
 * The two readers that the frame path actually calls answer truthfully: there
 * are no entities, and a sweep over none of them emits nothing. Note that
 * `sweep` returns the SHARED empty array, so an idle frame here allocates
 * nothing either — the property `test/vertical-slice.test.ts` asserts against
 * the real shape.
 */
import { Effect } from 'effect'
import type { MobBehaviour } from '../../domain/entities/mob-frame'
import type { EntityManagerApi } from '../../domain/entity-manager-port'

const NOTHING: ReadonlyArray<never> = []

const refuse = <A>(what: string): Effect.Effect<A> =>
  Effect.dieMessage(
    `preview-mining-site: ${what} — this preview has no mobs, and mx-gameplay must not implement mc-sim's roster. See apps/preview-mining-site/roster.ts.`,
  )

export const emptyPreviewRoster: EntityManagerApi<MobBehaviour> = {
  spawn: () => refuse('spawn'),
  despawn: () => refuse('despawn'),
  entities: Effect.succeed(NOTHING),
  find: () => Effect.succeed(undefined),
  count: Effect.succeed(0),
  countOfKind: () => Effect.succeed(0),
  sweep: () => Effect.succeed(NOTHING),
  snapshot: Effect.succeed({ entities: NOTHING, nextSerial: 0 }),
  restore: () => refuse('restore'),
  reset: Effect.void,
}
