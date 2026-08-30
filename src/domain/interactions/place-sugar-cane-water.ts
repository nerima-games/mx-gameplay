/**
 * ONE RULE, ONE FILE (DN-GP-9): sugar cane needs water beside the block it
 * stands on, unless it is standing on more sugar cane.
 *
 * The second of the four per-block placement rules `./place-block`'s header
 * defers by name. `./place-mushroom-light`'s header carries the argument for why
 * they are four files rather than one array, and the note that kernel gives
 * `sugar_cane` no item form — so like two of its three siblings this rule cannot
 * be reached through a held item today, is wired anyway, and is pinned as
 * unreachable by a named test rather than by a silence.
 *
 * ---------------------------------------------------------------------------
 * THE WATER IS BESIDE THE SUPPORT, NOT BESIDE THE CANE
 * ---------------------------------------------------------------------------
 *
 * This is the half of the rule that is easy to get wrong by one, and the
 * reference gets it right in a way that is easy to read past
 * (`block-service-place-plan.ts:150-154`): the four neighbours it reads are at
 * `context.y - 1`, the level of the SUPPORTING block, not at the level of the
 * cane itself. Sugar cane grows on a sand or dirt bank with water lapping
 * against that bank; water level with the plant is water the plant is standing
 * in.
 *
 * Reading the four at the cane's own level instead would make a cane placeable
 * one block up a shoreline and refuse it on the shoreline, which is the opposite
 * of the rule in both directions. `test/rules.test.ts` pins the level from both
 * sides for that reason.
 *
 * ---------------------------------------------------------------------------
 * STACKING IS THE FIRST TEST AND IT SHORT-CIRCUITS
 * ---------------------------------------------------------------------------
 *
 * `hasRequiredSugarCaneAdjacentWater` is `blockBelow === 'SUGAR_CANE' || …`, so
 * a cane placed on a cane needs no water at all — which is what lets a stack
 * grow three tall from one waterside block. The `||` also means the four
 * neighbour reads DO NOT HAPPEN in that case, and that is not an optimisation
 * to be tidied away: the common case of a growing stack is the one that would
 * otherwise pay four store calls per segment.
 *
 * ---------------------------------------------------------------------------
 * THE SUPPORT READ IS BORROWED, NOT REPEATED
 * ---------------------------------------------------------------------------
 *
 * `sugar_cane`'s `supportRule` is `needsOneOf('dirt', 'grass_block', 'sand',
 * 'sugar_cane')` (`../block-vocabulary`), so `./place-block` has ALREADY read the
 * cell below by the time this gate is asked — `placementVerdict` cannot answer
 * without it. The reading is therefore a parameter rather than a second
 * `getBlock`, and the alternative is a store call per placement that can only
 * ever return what the caller is already holding.
 *
 * The parameter is a `BlockReading` and not a `BlockId`, so the three-valued
 * answer survives: an unloaded cell below is not a cell that fails the stacking
 * test, it is a cell nobody read. `undefined` is a FOURTH answer meaning the
 * caller did not read at all, which is `placementVerdict`'s own convention for
 * the same parameter — and it is not reachable from `./place-block`, because
 * sugar cane is support-sensitive and that read is what `placementVerdict`
 * needed in order to allow the placement in the first place.
 */
import { Effect } from 'effect'
import { horizontalNeighbours } from '../block-position-key.js'
import { blockIdOf, blockTypeOfId } from '../block-vocabulary.js'
import { below } from '../block-position-key.js'
import type { BlockId, BlockPosition, BlockReading, ChunkStoreApi } from '../chunk-store-port.js'

/** Is this byte sugar cane? Asked of kernel's registry; see `./place-mushroom-light`. */
export const isSugarCaneBlock = (block: BlockId): boolean => blockTypeOfId(block) === 'sugar_cane'

/** Is this byte water? Asked of kernel's registry, for the same reason. */
const isWaterBlock = (block: BlockId): boolean => blockTypeOfId(block) === 'water'

/**
 * The reference's `hasRequiredSugarCaneAdjacentWater`, over bytes and over
 * three-valued readings.
 *
 * PURE and TOTAL, and separate from the store calls for `./place-block`'s
 * reason: the decision is the part worth enumerating in a test and the store
 * call is the part worth counting.
 *
 * A `ChunkNotLoaded` or `OutOfWorld` neighbour DOES NOT SATISFY the rule, which
 * is the refusing direction and is chosen: "some side is water" cannot be
 * established by a side nobody read, and the alternative would place a cane
 * against unloaded space and let the shoreline turn out not to be there. The
 * reference cannot express this case at all — it drops out-of-chunk neighbours
 * from the list entirely, which `../block-position-key`'s `horizontalNeighbours`
 * records as a defect rather than reproduces.
 */
export const hasRequiredSugarCaneAdjacentWater = (
  supportBelow: BlockReading | undefined,
  besideSupport: ReadonlyArray<BlockReading>,
): boolean =>
  (supportBelow !== undefined && supportBelow._tag === 'Block' && isSugarCaneBlock(supportBelow.block)) ||
  besideSupport.some((reading) => reading._tag === 'Block' && isWaterBlock(reading.block))

/** Why sugar cane was refused. `undefined` from the gate means no objection. */
export type SugarCaneWaterRefusal = { readonly _tag: 'NoAdjacentWater' }

/**
 * Does the ground beside the support refuse the cane? `undefined` if it does not.
 *
 * READS NOTHING unless the block is sugar cane, and reads nothing FURTHER when
 * the cane is stacked on a cane. See the header on both.
 *
 * `supportBelow` is what `./place-block` already read, and `undefined` is the
 * caller saying it did not read — `placementVerdict`'s convention for the same
 * parameter. A caller that did not read cannot have established that the cane is
 * stacked, so the stacking short-circuit does not fire and the four neighbours
 * decide.
 */
export const sugarCaneWaterObjection = (
  store: ChunkStoreApi,
  block: BlockId,
  position: BlockPosition,
  supportBelow: BlockReading | undefined,
): Effect.Effect<SugarCaneWaterRefusal | undefined> =>
  Effect.gen(function* () {
    if (!isSugarCaneBlock(block)) {
      return undefined
    }
    if (supportBelow !== undefined && supportBelow._tag === 'Block' && isSugarCaneBlock(supportBelow.block)) {
      return undefined
    }

    const besideSupport: Array<BlockReading> = []
    for (const neighbour of horizontalNeighbours(below(position))) {
      besideSupport.push(yield* store.getBlock(neighbour))
    }

    return hasRequiredSugarCaneAdjacentWater(supportBelow, besideSupport)
      ? undefined
      : { _tag: 'NoAdjacentWater' }
  })

/** The id this rule is about, for a caller that wants to demonstrate it. */
export const SUGAR_CANE_BLOCK_ID: BlockId | undefined = blockIdOf('sugar_cane')
