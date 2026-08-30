/**
 * ONE RULE, ONE FILE (DN-GP-9): a cactus needs all four of its sides clear.
 *
 * The third of the four per-block placement rules `./place-block`'s header
 * defers by name. `./place-mushroom-light`'s header carries the argument for why
 * they are four files rather than one array, and the note that kernel gives
 * `cactus` no item form — so this rule is written and wired and cannot be
 * reached through a held item today, which `test/rules.test.ts` pins by name.
 *
 * ---------------------------------------------------------------------------
 * AIR, AND NOT "NOT SOLID"
 * ---------------------------------------------------------------------------
 *
 * `hasClearCactusHorizontalSides` is `every(t === 'AIR')`
 * (`<reference-impl>/packages/world/domain/block-placement-rules.ts`), and the
 * temptation is to widen it to `isReplaceable`, which would also admit water and
 * lava. That is the wrong widening in a way that is specific rather than
 * stylistic: a cactus with water against it is one that vanilla breaks on the
 * next tick, so admitting water at PLACEMENT time builds a plant whose only
 * future is to pop. The strict test is transcribed.
 *
 * It is also the reason this rule and `../block-vocabulary`'s
 * `canSupportAttachments` must not be folded together. Kernel's audit §4.9 is
 * explicit that the capabilities are independent with different membership, and
 * "may a cactus be here" is a question about the four cells BESIDE the cactus
 * while every capability flag is a question about one cell.
 *
 * ---------------------------------------------------------------------------
 * FOUR SIDES, ALWAYS
 * ---------------------------------------------------------------------------
 *
 * The reference reads only the neighbours whose CHUNK-LOCAL coordinate stays
 * inside the chunk it is holding, so a cactus placed against a chunk boundary is
 * checked on two or three sides and can be built flush against a stone wall.
 * kernel's `horizontalBlockNeighbours` fixes that defect and does
 * not reproduce it; a cell in the next chunk is one more `getBlock` here.
 *
 * An unreadable side REFUSES, which is the same direction
 * `./place-sugar-cane-water` takes and for a sharper reason: the rule is "every
 * side is air", and a side nobody read is not known to be air. Placing on the
 * permissive reading would put a cactus against unloaded space and let the wall
 * turn out to be there.
 */
import { Effect } from 'effect'
import { blockPosition, horizontalBlockNeighbours } from '@nerima-games/mc-kernel'
import { blockIdOf, blockTypeOfId } from '../block-vocabulary.js'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition, type BlockReading, type ChunkStoreApi } from '../chunk-store-port.js'

/** Is this byte a cactus? Asked of kernel's registry; see `./place-mushroom-light`. */
export const isCactusBlock = (block: BlockId): boolean => blockTypeOfId(block) === 'cactus'

/**
 * The reference's `hasClearCactusHorizontalSides`, over three-valued readings.
 *
 * PURE and TOTAL. `every` over an EMPTY list is `true`, which is JavaScript's
 * answer and is also the right one here: a caller that read no sides has not
 * established that a side is blocked. The gate below never passes an empty list
 * — `horizontalNeighbours` returns four — and the case is stated so that a
 * reader does not have to decide whether it was thought about.
 */
export const hasClearCactusHorizontalSides = (sides: ReadonlyArray<BlockReading>): boolean =>
  sides.every((reading) => reading._tag === 'Block' && reading.block === AIR_BLOCK_ID)

/** Why a cactus was refused. `undefined` from the gate means no objection. */
export type CactusSidesRefusal = { readonly _tag: 'SidesBlocked' }

/**
 * Do the four sides refuse the cactus? `undefined` if they do not.
 *
 * READS NOTHING unless the block is a cactus. FOUR READS when it is, and they
 * are not short-circuited on the first blocked side: the reads are issued in
 * `horizontalNeighbours`' fixed order so that two runs of one scenario make the
 * same store calls in the same sequence (plan.md §5.1-3), and a loop that bailed
 * early would make the call count depend on which side happened to be blocked.
 * Four is the cost of a cactus placement and it is paid on no other block.
 */
export const cactusSidesObjection = (
  store: ChunkStoreApi,
  block: BlockId,
  position: BlockPosition,
): Effect.Effect<CactusSidesRefusal | undefined> =>
  Effect.gen(function* () {
    if (!isCactusBlock(block)) {
      return undefined
    }

    const sides: Array<BlockReading> = []
    for (const neighbour of horizontalBlockNeighbours(blockPosition(position.x, position.y, position.z))) {
      sides.push(yield* store.getBlock(neighbour))
    }

    return hasClearCactusHorizontalSides(sides) ? undefined : { _tag: 'SidesBlocked' }
  })

/** The id this rule is about, for a caller that wants to demonstrate it. */
export const CACTUS_BLOCK_ID: BlockId | undefined = blockIdOf('cactus')
