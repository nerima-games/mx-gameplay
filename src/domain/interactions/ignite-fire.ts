/**
 * ONE RULE, ONE FILE (DN-GP-9): a flint and steel used on an empty cell puts
 * fire in it.
 *
 * The reference implementation's
 * `<reference-impl>/packages/app/application/frame/stages/interaction-flint-steel-fire.ts`,
 * and the second arm of `./use-flint-and-steel` — the one that runs when
 * `./ignite-portal` finds no frame.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `./place-block` WITH `fire` AS THE HELD ITEM
 * ---------------------------------------------------------------------------
 *
 * It cannot be, and the reason is kernel's rather than a preference: `fire` is
 * in `BLOCK_TYPES` and is NOT in `ITEM_TYPES`, so it is not a member of
 * `PlaceableItemType` and `placeBlock` could not be handed it if one wanted to.
 * That is the correct roster — you cannot carry a stack of fire — and it is what
 * makes an item USE a different verb from a placement rather than a special case
 * of one: the item consumed and the block written are two different things.
 *
 * The same fact is why `./ignite-portal` writes `nether_portal` directly.
 *
 * ---------------------------------------------------------------------------
 * AIR, NOT REPLACEABLE, AND THE DIFFERENCE IS DELIBERATE
 * ---------------------------------------------------------------------------
 *
 * `./place-block` asks `isReplaceable`, which is kernel's capability and admits
 * `water` and `lava` as well as `air`. This rule asks for AIR and nothing else,
 * which is the reference's test (`current !== 'AIR'`) transcribed rather than
 * improved. The two disagree on exactly the cells where the improvement would be
 * wrong: fire in a water cell is a fire that goes out on the tick nothing has
 * written yet, and fire in a lava cell is a keystroke that deletes a lava
 * source. Both would be regressions dressed as consistency.
 *
 * There is no `isFlammable` test here because this operation places fire in an
 * empty cell. Fire support and spread are handled by `../fire-lifecycle`, which
 * reads kernel's `capabilityOfBlockId(id, 'flammable')` table rather than
 * maintaining a gameplay block list.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RULE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * BURN. Fire that spreads, consumes its fuel and goes out is the reference's
 * `packages/world/domain/fire-lifecycle.ts` and `application/fire-maintenance.ts`
 * — a per-tick sweep over the fire blocks in the world. That is a MAINTENANCE
 * pass, DN-GP-1 is about exactly that shape of workload, and the event-driven
 * version of it is a `disturb`-shaped queue whose consumer does not exist yet.
 * Writing the block is this rule; making it behave is another one, and it would
 * have its own file.
 *
 * HURT ANYBODY. A player or a mob standing in fire takes damage, which reads a
 * roster of things with positions and health. mc-sim owns the roster and
 * `../mob/` owns none of the player's half.
 *
 * SPEND THE ITEM or PLAY THE SOUND. See `./ignite-portal`'s header; the same two
 * services own them and neither is published.
 */
import { Effect, Option, Schema } from 'effect'
import {
  AIR_BLOCK_ID,
  blockIdOf,
  WorldWriteBatchSchema,
  type BlockId,
  type BlockPosition,
  type Dimension,
} from '@nerima-games/mc-kernel'
import type {
  ReplicatedOwnerCandidate,
  WorldCommitCoordinatorApi,
  WorldCommitCoordinatorError,
} from '@nerima-games/mc-sim'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'

export type IgniteFireCommitContext = {
  readonly coordinator: WorldCommitCoordinatorApi
  readonly dimension: Dimension
  readonly changes: ReadonlyArray<ReplicatedOwnerCandidate>
}

/**
 * TOTAL, mirroring `./place-block`'s `PlaceOutcome` and `./ignite-portal`'s.
 * Every refusal is named; see those two files on why `boolean` is the answer
 * that makes two different bugs indistinguishable.
 */
export type IgniteFireOutcome =
  /** Fire went in. */
  | { readonly _tag: 'Lit'; readonly position: BlockPosition }
  /** Something is already there. Not air — see the header on why not replaceable. */
  | { readonly _tag: 'Occupied'; readonly existing: BlockId }
  /** Out of the resident area. NOT air — the world there is unknown, not empty. */
  | { readonly _tag: 'ChunkNotLoaded' }
  /** Below bedrock or above the build limit. */
  | { readonly _tag: 'OutOfWorld' }
  /**
   * This build has no id for `fire`.
   *
   * UNREACHABLE TODAY, and kept for `./place-block`'s `UnknownBlock` reason.
   */
  | { readonly _tag: 'UnknownBlock' }
  /** The host did not provide the coordinator and dimension required for C4. */
  | { readonly _tag: 'CommitContextMissing' }
  /** The atomic C4 block commit was rejected or could not be validated. */
  | { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError }

/**
 * Put fire in the cell, and report what happened.
 *
 * ONE READ AND AT MOST ONE C4 COMMIT. The coordinator checks the captured world
 * and dimension revisions while committing the fire edit, so a change after the
 * air read rejects the whole write. `ChunkStore.setBlock` is not a fallback.
 *
 * NOTHING IS DISTURBED, for `./ignite-portal`'s reason: the cell was air, and
 * filling a hole cannot start a fall.
 */
export const igniteFire = (
  store: ChunkStoreApi,
  position: BlockPosition,
  commitContext?: IgniteFireCommitContext,
): Effect.Effect<IgniteFireOutcome> =>
  Effect.gen(function* () {
    const fireBlock = Option.getOrUndefined(blockIdOf('fire'))
    /* v8 ignore start -- UnknownBlock is unreachable in a green tree: `fire` is one
     * of the 120 `BlockType`s kernel's own type declaration pins `blockIdOf`
     * total over, so `blockIdOf('fire')` never returns `undefined`. Kept for the
     * reason `./place-block.ts`'s own `UnknownBlock` arm is: it fails toward a NAMED
     * refusal rather than a fire block silently vanishing. Named in
     * `vitest.config.ts`'s coverage-threshold comment as one of the five
     * documented-unreachable branches the 99% gate accounts for. */
    if (fireBlock === undefined) {
      return { _tag: 'UnknownBlock' }
    }
    /* v8 ignore stop */

    const expectedRevision = commitContext === undefined
      ? undefined
      : yield* commitContext.coordinator.revision
    const expectedDimensionRevision = commitContext === undefined
      ? undefined
      : yield* commitContext.coordinator.dimensionRevision(commitContext.dimension)

    const target = yield* store.getBlock(position)
    if (target._tag === 'ChunkNotLoaded') {
      return { _tag: 'ChunkNotLoaded' }
    }
    if (target._tag === 'OutOfWorld') {
      return { _tag: 'OutOfWorld' }
    }
    if (target.block !== AIR_BLOCK_ID) {
      return { _tag: 'Occupied', existing: target.block }
    }

    if (
      commitContext === undefined ||
      expectedRevision === undefined ||
      expectedDimensionRevision === undefined
    ) return { _tag: 'CommitContextMissing' }

    const committed = Effect.gen(function* () {
      const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
        world: commitContext.coordinator.worldId,
        expectedWorldRevision: expectedRevision,
        dimension: commitContext.dimension,
        expectedDimensionRevision,
        edits: [{ position, block: fireBlock }],
      })
      yield* commitContext.coordinator.commit({
        expectedRevision,
        expectedDimensions: [{
          dimension: commitContext.dimension,
          expectedRevision: expectedDimensionRevision,
        }],
        changes: commitContext.changes,
        blockWrite,
      })
      return { _tag: 'Lit', position } as const
    })

    return yield* Effect.matchEffect(committed, {
      onFailure: (error) => Effect.succeed({ _tag: 'CommitFailed', error } as const),
      onSuccess: (outcome) => Effect.succeed(outcome),
    })
  })
