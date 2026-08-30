/**
 * ONE RULE, ONE FILE (DN-GP-9): the player plants a seed on soil.
 *
 * Ported from the reference's `interaction-farming-handler.ts`, which is ONE
 * FILE CARRYING FOUR RULES — till, plant, bone-meal and sapling-to-tree. Only
 * this one is here, and the reason is the vocabulary rather than a preference;
 * see the next section. `./place-block` is the file to read alongside this one:
 * the shape is deliberately the same, and the differences are the crop rules.
 *
 * ---------------------------------------------------------------------------
 * PLANTING IS KEPT SEPARATE FROM TILLING AND BONE MEAL
 * ---------------------------------------------------------------------------
 *
 * Tilling and bone meal have dedicated interaction modules with their own
 * input and world-state rules. The planting module owns only seed placement.
 *
 * ---------------------------------------------------------------------------
 * THE SOIL TABLE IS PER-CROP AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 *
 * The reference keys soil by CROP, not by item, and it matters: wheat and
 * potato want tilled `farmland`, and nether wart wants `soul_sand` and will not
 * take farmland at all (`interaction-farming-handler.config.ts:15-19`, comment
 * "nether wart only grows on SOUL_SAND (vanilla)").
 *
 * A single `isSoil` predicate would plant nether wart on farmland — which grows
 * a crop, drops an item, and is wrong only if you know vanilla. That is the
 * failure mode this project's notes call the expensive one: it looks like a
 * design choice rather than a defect.
 */
import { Effect } from 'effect'
import {
  adjacentBlockPosition,
  blockIdOf,
  blockPosition,
  blockTypeOfId,
  type BlockType,
  type ItemType,
} from '@nerima-games/mc-kernel'
import type { BlockPosition } from '../chunk-store-port.js'

/**
 * Which crop each seed item becomes.
 *
 * TRANSCRIBED from `PLANTABLE_CROP_ITEMS` (`interaction-farming-handler.config.ts:7-11`).
 * A `Map` there, a record here, and the difference is only that a record's keys
 * are checked against `ItemType` at compile time — a typo in a seed name is a
 * type error rather than a rule that silently never fires.
 */
export const CROP_OF_SEED: Readonly<Partial<Record<ItemType, BlockType>>> = {
  wheat_seeds: 'wheat_crop',
  potato: 'potato_crop',
  nether_wart: 'nether_wart_crop',
}

/**
 * The block each crop must be planted ON.
 *
 * Keyed by CROP and not by seed, matching the reference. See the header: nether
 * wart takes `soul_sand` and refuses farmland, and collapsing this to one
 * predicate is the mistake that reads as a design choice.
 */
export const SOIL_OF_CROP: Readonly<Partial<Record<BlockType, BlockType>>> = {
  wheat_crop: 'farmland',
  potato_crop: 'farmland',
  nether_wart_crop: 'soul_sand',
}

/** Every item this rule will act on. Derived, so it cannot drift from the table. */
export const PLANTABLE_SEEDS: ReadonlyArray<ItemType> = Object.keys(CROP_OF_SEED) as ReadonlyArray<ItemType>

/** What the player is trying to do. */
export type PlantRequest = {
  /** The item in hand. Not assumed to be a seed. */
  readonly held: ItemType
  /** The cell the player is aiming at — the SOIL, not where the crop goes. */
  readonly soil: BlockPosition
}

/**
 * Why a planting attempt did or did not happen.
 *
 * A UNION AND NOT A BOOLEAN, for the reason `./place-block`'s `PlaceOutcome`
 * gives: the caller has to tell "you are not holding a seed" from "this is the
 * wrong soil" in order to decide whether to consume the item, and a boolean
 * makes those the same answer.
 */
export type PlantOutcome =
  | { readonly _tag: 'planted'; readonly crop: BlockType; readonly at: BlockPosition }
  /** The held item is not a seed. Nothing was read. */
  | { readonly _tag: 'notASeed'; readonly held: ItemType }
  /** A seed, but this soil is not the one it grows on. */
  | { readonly _tag: 'wrongSoil'; readonly crop: BlockType; readonly needs: BlockType; readonly found: BlockType }
  /** The cell above the soil is occupied; a crop cannot share it. */
  | { readonly _tag: 'occupied'; readonly crop: BlockType; readonly blockedBy: BlockType }

/** Where the crop goes: directly above the soil. */
export const cropCellAbove = (soil: BlockPosition): BlockPosition =>
  adjacentBlockPosition(blockPosition(soil.x, soil.y, soil.z), 'up')

/**
 * Decide, given what is already known about the two cells.
 *
 * PURE, AND SEPARATE FROM THE EFFECT BELOW, which is the shape every rule in
 * this directory takes: the decision is a function of two block types and an
 * item, so a test can enumerate the table without a store, and `plantCrop`
 * below is only the reads and the write.
 */
export const plantingVerdict = (
  request: PlantRequest,
  soilBlock: BlockType,
  blockAbove: BlockType,
): PlantOutcome => {
  const crop = CROP_OF_SEED[request.held]
  if (crop === undefined) {
    return { _tag: 'notASeed', held: request.held }
  }

  const needs = SOIL_OF_CROP[crop]
  if (needs === undefined || soilBlock !== needs) {
    // `needs === undefined` is unreachable while the two tables agree, and
    // `test/plant-crop.test.ts` asserts that they do rather than leaving this
    // branch to be argued about. Reported as `wrongSoil` because that is what a
    // caller can act on; there is no outcome for "the table is inconsistent".
    /* v8 ignore start -- the `?? 'air'` fallback only fires when `needs` is
     * undefined, which the table-agreement invariant above makes unreachable on
     * every path that reaches this line: `needs === undefined` is itself the
     * documented-unreachable disjunct, and the other disjunct (`soilBlock !==
     * needs`) requires `needs` to already be defined. */
    return { _tag: 'wrongSoil', crop, needs: needs ?? 'air', found: soilBlock }
    /* v8 ignore stop */
  }

  if (blockAbove !== 'air') {
    return { _tag: 'occupied', crop, blockedBy: blockAbove }
  }

  return { _tag: 'planted', crop, at: cropCellAbove(request.soil) }
}

/** The two reads and one write this rule needs of a world. */
export type PlantPort = {
  readonly blockAt: (position: BlockPosition) => Effect.Effect<number | undefined>
  readonly setBlock: (position: BlockPosition, block: number) => Effect.Effect<unknown>
}

/**
 * Read the two cells, decide, and write if the decision says so.
 *
 * READS BEFORE IT WRITES, and for exactly the reason `./place-block`'s header
 * sets out at length: `setBlock` reports what it replaced, so asking it first
 * would mean the soil is already gone by the time you learn it was the wrong
 * soil. The window between the reads and the write is the same one that file
 * documents, on the same single fiber, and closes the same way — a
 * `setBlockIf` on mc-worldgen's `ChunkStore`.
 *
 * AN UNLOADED CELL READS AS `undefined` AND IS TREATED AS NOT-SOIL rather than
 * as air. `./chunk-store-port` returns `undefined` for a chunk that is not
 * resident, and defaulting that to air would let a player plant into a chunk
 * nobody has loaded — the write would land, and the chunk that eventually loads
 * would overwrite it. Refusing is the inert reading.
 */
export const plantCrop = (
  port: PlantPort,
  request: PlantRequest,
): Effect.Effect<PlantOutcome> =>
  Effect.gen(function* () {
    const soilId = yield* port.blockAt(request.soil)
    const aboveId = yield* port.blockAt(cropCellAbove(request.soil))

    const soilBlock = soilId === undefined ? undefined : blockTypeOfId(soilId)
    const aboveBlock = aboveId === undefined ? undefined : blockTypeOfId(aboveId)

    if (soilBlock === undefined || aboveBlock === undefined) {
      // Not loaded, or an id this vocabulary does not know. Either way the rule
      // declines rather than guessing; see the header.
      const crop = CROP_OF_SEED[request.held]
      return crop === undefined
        ? { _tag: 'notASeed' as const, held: request.held }
        : /* v8 ignore start -- the `?? 'air'` fallback only fires when `crop` is
           * defined but `SOIL_OF_CROP[crop]` is not, which the table-agreement
           * invariant `test/plant-crop.test.ts` asserts (`CROP_OF_SEED` and
           * `SOIL_OF_CROP` name the same crops) makes unreachable. */
          { _tag: 'wrongSoil' as const, crop, needs: SOIL_OF_CROP[crop] ?? 'air', found: 'air' as BlockType }
      /* v8 ignore stop */
    }

    const verdict = plantingVerdict(request, soilBlock, aboveBlock)
    if (verdict._tag === 'planted') {
      // `verdict.crop` is drawn only from `CROP_OF_SEED`'s three values
      // (`wheat_crop` / `potato_crop` / `nether_wart_crop`), and all three carry
      // a row in kernel's own registry (ids 71-73), so
      // `blockIdOf` cannot return `undefined` here. Asserted rather than
      // branched on, since a vocabulary defect that removed one of those rows
      // would be caught by kernel's own type declaration long before
      // this line ran, not by a runtime fallback that plants nothing and
      // reports success.
      yield* port.setBlock(verdict.at, blockIdOf(verdict.crop)!)
    }
    return verdict
  })
