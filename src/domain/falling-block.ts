/**
 * Falling blocks (sand, gravel) — EVENT-DRIVEN, with a per-tick move budget.
 *
 * ---------------------------------------------------------------------------
 * The measured mistake this file exists to prevent
 * ---------------------------------------------------------------------------
 *
 * The reference implementation originally rescanned every loaded chunk every
 * maintenance tick looking for unsupported sand and gravel. Its own note on the
 * fix, at `packages/world/application/falling-block-maintenance.ts:9-15`:
 *
 *     Falling blocks are primarily EVENT-driven (chunks whose blocks changed
 *     since the last tick, via the frame's dirty-chunk map); the sweep exists
 *     only to catch mutation paths that bypass that map (e.g. fluid updates).
 *     Scanning every loaded chunk every tick — the previous behaviour — cost
 *     ~7M+ block reads per 16-48ms maintenance tick (~40% of the main thread
 *     while exploring); two chunks per tick is ~0.05ms.
 *
 * The cost was O(chunks × blocks) and it was paid whether or not anything had
 * moved. The API here is shaped so that the mistake cannot be re-made by
 * accident: there is no "scan the world" function to call. Work enters this
 * queue only through `disturb`, and the only way to obtain work is `takeBatch`.
 * An idle world therefore produces an empty batch, and that is asserted twice:
 * at unit level by `test/rules.test.ts` ("REGRESSION: an untouched world
 * produces no work, because work only enters through `disturb`") and at stage
 * level by `test/stage-registration.test.ts` ("REGRESSION: an idle tick does no
 * falling-block work at all").
 *
 * ---------------------------------------------------------------------------
 * The cascade, and why `settled` exists
 * ---------------------------------------------------------------------------
 *
 * A falling column settles one cell per tick, so the position a block moved
 * into must be re-examined next tick even though no external event re-dirties
 * it. The reference kept a `pendingCoordKeysRef` for exactly this
 * (`falling-block-maintenance.ts:24-27`). `settled` is that mechanism, at
 * position rather than chunk granularity.
 *
 * ---------------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------------
 *
 * The pending set is a native insertion-ordered `Set`, and `takeBatch` returns a
 * prefix of that order. Two runs fed the same events therefore produce the same
 * batches in the same order, which is what makes a Node scenario test a
 * meaningful oracle (plan.md §5.1-3). Do not "improve" this into an unordered
 * collection.
 */

import type { PositionKey } from './position-key'

/**
 * Upper bound on block moves applied in one tick.
 *
 * Same value as the reference's `FALLING_BLOCK_MAX_PER_TICK`
 * (`packages/world/domain/falling-block.ts:7`). The bound is what converts a
 * pathological event burst — a TNT blast under a desert — from a frame spike
 * into a visible cascade spread over several ticks.
 */
export const FALLING_BLOCK_MOVES_PER_TICK = 32

export type FallingBlockQueue = {
  /** Positions whose support may have changed. Insertion-ordered. */
  readonly pending: ReadonlySet<PositionKey>
}

export const emptyFallingBlockQueue: FallingBlockQueue = { pending: new Set<PositionKey>() }

/**
 * Record that something changed at these positions, so the column above each of
 * them may now be unsupported.
 *
 * This is the ONLY entry point for work. Callers are the rules that mutate
 * blocks: breaking, placing, explosions, fluid displacement, piston pushes.
 * Re-disturbing an already-pending position is a no-op and keeps the earlier
 * queue position, so a hot spot cannot starve the rest of the queue.
 */
export const disturb = (
  queue: FallingBlockQueue,
  positions: Iterable<PositionKey>,
): FallingBlockQueue => {
  const pending = new Set(queue.pending)
  for (const position of positions) {
    pending.add(position)
  }
  return { pending }
}

export type FallingBlockBatch = {
  /** At most `budget` positions, in the order they were disturbed. */
  readonly batch: ReadonlyArray<PositionKey>
  /** The queue with those positions removed. */
  readonly rest: FallingBlockQueue
}

/**
 * Take up to `budget` positions to evaluate this tick.
 *
 * Cost is O(taken), never O(world). An empty queue costs one allocation and
 * returns an empty batch — the property that the reference's full scan lacked.
 */
export const takeBatch = (
  queue: FallingBlockQueue,
  budget: number = FALLING_BLOCK_MOVES_PER_TICK,
): FallingBlockBatch => {
  if (budget <= 0 || queue.pending.size === 0) {
    return { batch: [], rest: queue }
  }

  const batch: Array<PositionKey> = []
  const rest = new Set<PositionKey>()
  for (const position of queue.pending) {
    if (batch.length < budget) {
      batch.push(position)
    } else {
      rest.add(position)
    }
  }

  return { batch, rest: { pending: rest } }
}

/**
 * Re-enqueue the destination of a block that moved, so the cascade continues on
 * the next tick.
 *
 * Separate from `disturb` only for readability at the call site: the two mean
 * different things ("the world changed here" versus "I moved something here and
 * it may keep going"), and a reader of a stage should be able to tell which one
 * is happening.
 */
export const settled = (
  queue: FallingBlockQueue,
  destinations: Iterable<PositionKey>,
): FallingBlockQueue => disturb(queue, destinations)
