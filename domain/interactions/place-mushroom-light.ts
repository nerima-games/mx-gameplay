/**
 * ONE RULE, ONE FILE (DN-GP-9): a mushroom may only be placed somewhere dark.
 *
 * The first of the four per-block placement rules `./place-block`'s header
 * defers by name — 「mushrooms need light <= 12, sugar cane needs adjacent water,
 * cactus needs four air sides, doors need the cell above」 — and it is deferred
 * there rather than branched there for exactly the reason this file exists:
 *
 *     A `PlacementRule` array here would be `block-service-place-plan.ts`
 *     reappearing: five unrelated block-name tests in one function.
 *
 * The reference has all four in one file with one array
 * (`<reference-impl>/packages/world/application/block-service-place-plan.ts:207-213`).
 * They are four files here and `./place-block` calls them by name, so the
 * composition is still one place and the block-name test is in the file that
 * owns the block.
 *
 * ---------------------------------------------------------------------------
 * NOTHING CAN REACH THIS RULE TODAY, AND THAT IS A KERNEL ROSTER FACT
 * ---------------------------------------------------------------------------
 *
 * `brown_mushroom` and `red_mushroom` are in kernel's `BLOCK_TYPES` and are NOT
 * in its `ITEM_TYPES`, so neither is a member of `PlaceableItemType` and
 * `placeBlock` cannot be handed one. The same is true of `sugar_cane` and
 * `cactus`; of the four deferred rules only `./place-door-upper`'s block has an
 * item form.
 *
 * That is worth stating plainly rather than leaving to be discovered, because it
 * is the SECOND time this repository has met it. `../block-vocabulary`'s
 * `SupportRule` section records the first:
 *
 *     no block that needs it could be held. `PlaceableItemType` is `ItemType &
 *     BlockType`, and kernel deliberately withholds an item form from the ten
 *     blocks whose rule differs from the fallback — so `placeBlock` could not
 *     reach the wrong answer even while the wrong answer was what it would have
 *     given.
 *
 * The conclusion drawn there is the one drawn here: WRITE THE RULE ANYWAY and
 * wire it, because the day kernel gives mushrooms an item form is a row in a
 * table and no edit in this repository. `test/rules.test.ts` pins the
 * unreachability as a NAMED test rather than leaving it as a silence, so that
 * the day it stops being true, the test that says so fails and points here.
 *
 * The rule is reachable from the other end regardless: `placementVerdict` is
 * pure and takes a `BlockId`, and every writer of blocks that is not a held item
 * — a structure generator, the preview's palette — goes through it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LIGHT READ IS NOT FREE, AND WHY IT IS STILL PAID HERE
 * ---------------------------------------------------------------------------
 *
 * `ChunkStoreApi.getLight`'s own comment: 「NOT free: mc-worldgen computes light
 * lazily and a block write drops the chunk's cached grid, so the first read
 * after a write relights that chunk」. A placement is a block write, so a rule
 * that read the light on EVERY placement would relight a chunk per block a
 * player stacks.
 *
 * It does not. `isMushroomBlock` is a pure test on the id and it runs first, so
 * the only placements that pay for a light read are the ones putting a mushroom
 * down. That ordering is the whole of the cost argument and it is why the gate
 * below takes the block rather than the store deciding.
 */
import { Effect } from 'effect'
import { blockIdOf, blockTypeOfId } from '../block-vocabulary'
import type { BlockId, BlockPosition, ChunkStoreApi } from '../chunk-store-port'

/**
 * The brightest a cell may be and still take a mushroom.
 *
 * `<reference-impl>/packages/world/domain/block-placement-rules.ts`'s
 * `MAX_MUSHROOM_PLACEMENT_LIGHT`. Twelve, and the comparison below is `<=`, so a
 * cell at exactly 12 is legal — which `test/rules.test.ts` brackets from both
 * sides, because an off-by-one here is invisible in play.
 */
export const MAX_MUSHROOM_PLACEMENT_LIGHT = 12

/**
 * Is this byte one of the two mushrooms?
 *
 * Asked of kernel's registry rather than of a literal pair of ids, for
 * `../portal-frame-port`'s reason: a literal `23` is the scatter plan.md §3.1
 * measured, and it goes stale silently if a row is ever renumbered. TOTAL — a
 * byte this build cannot name is not a mushroom, which is the arm that lets an
 * unknown id through rather than refusing it for a reason nobody can state.
 */
export const isMushroomBlock = (block: BlockId): boolean => {
  const type = blockTypeOfId(block)
  return type === 'brown_mushroom' || type === 'red_mushroom'
}

/**
 * The reference's `isMushroomPlacementLightAllowed`, over a byte.
 *
 * TOTAL AND VACUOUSLY TRUE FOR EVERY OTHER BLOCK, which is the source's shape
 * (`!MUSHROOM_BLOCK_TYPES.has(blockType) || lightLevel <= MAX`) and is worth
 * keeping: it makes the predicate answerable about any placement, so a test can
 * assert that stone at light 15 is allowed rather than only that mushrooms are
 * refused.
 *
 * A non-finite light level is NOT allowed, and that is this file's own decision
 * rather than the source's. `NaN <= 12` is `false`, so the arithmetic already
 * refuses — the explicit test is here so that a reader does not have to
 * reconstruct which way an unmeasurable light falls, and so that changing the
 * comparison cannot silently change the answer. It is the same shape as
 * `../mob/hostile-spawn`'s light guard and the same direction: a fact nobody
 * measured is not a fact.
 */
export const isMushroomPlacementLightAllowed = (block: BlockId, lightLevel: number): boolean =>
  !isMushroomBlock(block) || (Number.isFinite(lightLevel) && lightLevel <= MAX_MUSHROOM_PLACEMENT_LIGHT)

/**
 * Why a mushroom was refused. `undefined` from the gate means no objection.
 *
 * TWO ARMS AND NOT ONE, because "it is too bright here" and "nobody could
 * measure the light here" are different things and only the first is the
 * player's fault. The reference has one — it defaults an absent light grid to
 * `skyLight = 15` (`block-service-place-plan.ts`'s `placementLightLevel`), so an
 * unlit chunk reports FULL DAYLIGHT and every mushroom is refused with a message
 * about brightness. That default is the reason this file distinguishes them.
 */
export type MushroomLightRefusal =
  | { readonly _tag: 'TooBright'; readonly light: number }
  | { readonly _tag: 'LightUnknown' }

/**
 * The light level a placement rule reads: the brighter of sky and block.
 *
 * `Math.max(skyLight, blockLight)`, which is the reference's `placementLightLevel`.
 * Note that this is NOT the combination `../mob/hostile-spawn` uses — that rule
 * gates on BLOCK light alone, and `../chunk-store-port`'s `LightReading` keeps
 * the two apart precisely so that two rules can want two different answers.
 * A mushroom cares whether the cell is dark; a torch and a sunbeam make it
 * equally not-dark.
 */
export const placementLightLevel = (sky: number, block: number): number => Math.max(sky, block)

/**
 * Does the light in this cell refuse the block? `undefined` if it does not.
 *
 * READS NOTHING unless the block is a mushroom. See the header on why that
 * ordering is the whole cost argument.
 */
export const mushroomLightObjection = (
  store: ChunkStoreApi,
  block: BlockId,
  position: BlockPosition,
): Effect.Effect<MushroomLightRefusal | undefined> =>
  Effect.gen(function* () {
    if (!isMushroomBlock(block)) {
      return undefined
    }

    const reading = yield* store.getLight(position)
    if (reading._tag !== 'Light') {
      return { _tag: 'LightUnknown' }
    }

    const light = placementLightLevel(reading.sky, reading.block)
    return isMushroomPlacementLightAllowed(block, light) ? undefined : { _tag: 'TooBright', light }
  })

/**
 * The two ids this rule is about, for a caller that wants to demonstrate it.
 *
 * `BlockId | undefined` and not a filtered array, because `blockIdOf` is PARTIAL
 * on this mirror (see its comment) and a filter would introduce an arm no test
 * can reach — `test/block-vocabulary-mirror.test.ts` pins `blockIdOf` total over
 * all 120 block types, so in a green tree neither of these is ever `undefined`.
 * The type says what the mirror can promise; the test says what is true today.
 */
export const BROWN_MUSHROOM_BLOCK_ID: BlockId | undefined = blockIdOf('brown_mushroom')
export const RED_MUSHROOM_BLOCK_ID: BlockId | undefined = blockIdOf('red_mushroom')
