/**
 * ONE RULE, ONE FILE: unsupported sand and gravel sink by one cell.
 *
 * `domain/falling-block.ts` is the SCHEDULE — which positions are worth looking
 * at, and how many of them fit in a tick. This file is the MOVE: given the
 * positions that schedule handed over, it reads the world through
 * `ChunkStore` and writes the block one cell down.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately absent
 * ---------------------------------------------------------------------------
 *
 * There is no scan, and there is no subscription to the store's dirty channel
 * either. Both would reintroduce the reference implementation's
 * O(chunks × blocks) sweep — ~7M block reads per maintenance tick, ~40% of the
 * main thread while exploring (`falling-block-maintenance.ts:9-15`) — because a
 * CHUNK coordinate is not enough information to find the unsupported cells
 * inside it without looking at all of them. mc-worldgen records the division
 * (`docs/public-api.md` §6-5): the dirty channel is chunk-granular and belongs
 * to whoever re-meshes; position-granular tracking is mx-gameplay's
 * `FallingBlockQueue`, and the two compose rather than replace each other.
 *
 * The rule also never names a block. It reads a byte and asks kernel's
 * capability table (`fallsWhenUnsupported`, `isReplaceable`). The reference
 * asked `blockTypeToIndex('SAND')` in 229 places across 51 files (plan.md
 * §3.1); adding a falling block here is one row in kernel's table and no change
 * in this file, which `test/vertical-slice.test.ts` checks by running this
 * identical code over gravel.
 *
 * ---------------------------------------------------------------------------
 * Every outcome, on purpose
 * ---------------------------------------------------------------------------
 *
 * Reads and writes are total (`mc-worldgen/docs/public-api.md` §6-3), so every
 * case below is a case this function must decide. The one that costs a bug if
 * it is got wrong is `ChunkNotLoaded`: it is NOT air. Sand at the edge of the
 * resident area, told the cell below it is empty, falls into ungenerated space
 * and is gone. mc-meshing's read collapses the two on purpose — an unloaded
 * neighbour should draw as open sky rather than as a black wall — which is
 * right for drawing and wrong for simulating.
 */
import { capabilityOfBlockId } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import { above, below, positionKeyOf, positionOfKey } from '../block-position-key'
import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockReading,
  type BlockWriteOutcome,
  type ChunkStoreApi,
} from '../chunk-store-port'
import type { PositionKey } from '../position-key'

export type FallingBlockMoves = {
  /** How many blocks actually sank one cell this tick. */
  readonly moved: number
  /**
   * Positions to re-examine on a later tick, for `settled`.
   *
   * A column sinks one cell per tick, so a block that moved is not necessarily
   * finished; nothing external will re-dirty it, and without this the sand
   * stops one cell short of where it belongs.
   */
  readonly destinations: ReadonlyArray<PositionKey>
}

/** The block that would fall from `reading`, or `undefined` if none would. */
const fallingMaterial = (reading: BlockReading): BlockId | undefined => {
  switch (reading._tag) {
    case 'Block':
      return capabilityOfBlockId(reading.block, 'fallsWhenUnsupported') ? reading.block : undefined
    // Unknown, not empty. Whatever is up there stays up there until the chunk
    // is resident and something disturbs it again.
    case 'ChunkNotLoaded':
      return undefined
    // Above the build limit there is nothing to fall.
    case 'OutOfWorld':
      return undefined
    // exhaustiveness arm over BlockReading, a closed three-tag union
    // (chunk-store-port.ts's BlockReading); 'Block', 'ChunkNotLoaded' and
    // 'OutOfWorld' are the only reachable tags and all three are covered
    // above, so no input can reach this arm.
    /* v8 ignore start */
    default: {
      const exhaustive: never = reading
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

/** Whether a falling block may occupy `reading`'s cell. */
const canReceive = (reading: BlockReading): boolean => {
  switch (reading._tag) {
    // `replaceable`, from kernel's table: air and water, not "everything
    // non-solid" — kernel's audit §4.9 spends a section on the difference.
    case 'Block':
      return capabilityOfBlockId(reading.block, 'replaceable')
    // THE case this whole three-valued read exists for. Treating it as air
    // drops the block out of the world at the edge of the loaded area.
    case 'ChunkNotLoaded':
      return false
    // The floor of the world holds everything up.
    case 'OutOfWorld':
      return false
    // exhaustiveness arm over BlockReading, a closed three-tag union
    // (chunk-store-port.ts's BlockReading); 'Block', 'ChunkNotLoaded' and
    // 'OutOfWorld' are the only reachable tags and all three are covered
    // above, so no input can reach this arm.
    /* v8 ignore start */
    default: {
      const exhaustive: never = reading
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

/** Whether the source cell really was emptied by our write. */
const vacated = (outcome: BlockWriteOutcome): boolean => {
  switch (outcome._tag) {
    case 'Written':
      return true
    // Air was already there, so something else moved this block between the
    // read and the write. Placing it below anyway would duplicate matter.
    case 'Unchanged':
      return false
    case 'ChunkNotLoaded':
      return false
    case 'OutOfWorld':
      return false
    // exhaustiveness arm over BlockWriteOutcome, a closed four-tag union
    // (chunk-store-port.ts's BlockWriteOutcome); 'Written', 'Unchanged',
    // 'ChunkNotLoaded' and 'OutOfWorld' are the only reachable tags and all
    // four are covered above, so no input can reach this arm.
    /* v8 ignore start */
    default: {
      const exhaustive: never = outcome
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

/**
 * Apply one tick's worth of falling-block moves.
 *
 * `batch` is what `takeBatch` handed over, so the per-tick bound is already
 * applied and the cost here is O(taken) — an empty batch touches the store zero
 * times, which is the property the reference's sweep lacked.
 *
 * Each entry means "something under this column changed", so the cell examined
 * is the one ABOVE it.
 */
export const applyFallingBlocks = (
  store: ChunkStoreApi,
  batch: ReadonlyArray<PositionKey>,
): Effect.Effect<FallingBlockMoves> =>
  Effect.gen(function* () {
    const destinations: Array<PositionKey> = []
    let moved = 0

    for (const positionKey of batch) {
      const target = positionOfKey(positionKey)
      const source = above(target)

      const material = fallingMaterial(yield* store.getBlock(source))
      if (material === undefined) {
        continue
      }

      if (!canReceive(yield* store.getBlock(target))) {
        continue
      }

      // Source first, then destination. The reverse order would duplicate the
      // block if the second write were refused; this order can only ever lose
      // it, and the branch below puts it back.
      if (!vacated(yield* store.setBlock(source, AIR_BLOCK_ID))) {
        continue
      }

      const placed = yield* store.setBlock(target, material)
      switch (placed._tag) {
        case 'Written':
        // `Unchanged` here means the destination already held this very
        // block, which the capability table makes unreachable (nothing is
        // both `replaceable` and `fallsWhenUnsupported`). If it ever happens
        // the world is already in the state this move wanted, so it counts
        // as the move rather than as a failure.
        // falls through
        case 'Unchanged': {
          moved += 1
          // The cell BELOW the new resting place, so the column keeps sinking,
          // and the cell it came FROM, because whatever was above that is now
          // unsupported in its turn.
          destinations.push(positionKeyOf(below(target)), positionKeyOf(source))
          break
        }

        // Unreachable for the same reason: the read two lines up said this cell
        // was resident and inside the world. Restore rather than assume, since
        // the alternative is a block that silently ceases to exist.
        case 'ChunkNotLoaded':
        case 'OutOfWorld': {
          yield* store.setBlock(source, material)
          break
        }
        // exhaustiveness arm over BlockWriteOutcome, a closed four-tag union
        // (chunk-store-port.ts's BlockWriteOutcome); 'Written', 'Unchanged',
        // 'ChunkNotLoaded' and 'OutOfWorld' are the only reachable tags and
        // all four are covered above, so no input can reach this arm.
        /* v8 ignore start */
        default: {
          const exhaustive: never = placed
          void exhaustive
          break
        }
        /* v8 ignore stop */
      }
    }

    return { moved, destinations }
  })
