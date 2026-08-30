/**
 * `domain/interactions/plant-crop.ts` — the planting third of the reference's
 * farming handler.
 *
 * PORTED FROM `interaction-farming-handler.test.ts` (35 cases across four
 * rules). The cases here are the ones that are about PLANTING; the ones about
 * tilling, bone meal and sapling-to-tree are covered by dedicated interaction
 * modules and tests.
 *
 * The interesting cases are the REFUSALS. "Seed on the right soil grows a crop"
 * is one line and would be hard to get wrong; "nether wart refuses farmland"
 * and "a crop will not replace water" are the ones a single `isSoil` predicate
 * silently gets wrong, and both produce a world that looks deliberate.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import {
  CROP_OF_SEED,
  PLANTABLE_SEEDS,
  SOIL_OF_CROP,
  cropCellAbove,
  plantCrop,
  plantingVerdict,
  type PlantPort,
  type PlantRequest,
} from '../src/domain/interactions/plant-crop'
import { blockIdOf, type BlockType } from '@nerima-games/mc-kernel'
import type { BlockPosition } from '../src/domain/chunk-store-port'

const SOIL: BlockPosition = { x: 4, y: 63, z: -9 }

const request = (held: PlantRequest['held']): PlantRequest => ({ held, soil: SOIL })

const keyOf = (position: BlockPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

/**
 * A world of exactly two cells, plus whatever a test adds.
 *
 * `undefined` for anything not listed, which is `chunk-store-port`'s "that
 * chunk is not resident" and NOT air — the distinction the implementation
 * refuses to collapse.
 */
const makeWorld = (cells: Readonly<Record<string, BlockType>>) =>
  Effect.gen(function* () {
    const written = yield* Ref.make<ReadonlyArray<{ at: BlockPosition; block: number }>>([])
    const port: PlantPort = {
      blockAt: (position) =>
        Effect.sync(() => {
          const block = cells[keyOf(position)]
          return block === undefined ? undefined : blockIdOf(block)
        }),
      setBlock: (at, block) => Ref.update(written, (all) => [...all, { at, block }]),
    }
    return { port, written }
  })

describe('the two tables agree', () => {
  it.effect('every crop a seed produces has a soil', () =>
    Effect.sync(() => {
      // This is what makes `needs === undefined` unreachable in the verdict, and
      // it is asserted rather than argued. Without it, adding a fourth seed and
      // forgetting its soil would report `wrongSoil ... needs: 'air'` — a
      // refusal that names a block nobody mentioned.
      for (const seed of PLANTABLE_SEEDS) {
        const crop = CROP_OF_SEED[seed]
        expect(crop).toBeDefined()
        expect(SOIL_OF_CROP[crop as BlockType]).toBeDefined()
      }
    }),
  )

  it.effect('REGRESSION: the soils are not all the same block', () =>
    Effect.sync(() => {
      // Guards the whole file from being satisfiable by one `isSoil` predicate.
      // The reference's config comments that nether wart grows ONLY on soul
      // sand; if a future edit made every crop take farmland, every other test
      // here would still pass.
      const soils = new Set(Object.values(SOIL_OF_CROP))
      expect(soils.size).toBeGreaterThan(1)
      expect(SOIL_OF_CROP['nether_wart_crop']).toBe('soul_sand')
      expect(SOIL_OF_CROP['wheat_crop']).toBe('farmland')
    }),
  )
})

describe('plantingVerdict', () => {
  it.effect('a seed on its own soil, under air, plants', () =>
    Effect.sync(() => {
      expect(plantingVerdict(request('wheat_seeds'), 'farmland', 'air')).toStrictEqual({
        _tag: 'planted',
        crop: 'wheat_crop',
        at: cropCellAbove(SOIL),
      })
    }),
  )

  it.effect('every seed in the table plants on its own soil', () =>
    Effect.sync(() => {
      // Derived from the table rather than three hand-written cases, so a
      // fourth seed is covered the day it is added.
      for (const seed of PLANTABLE_SEEDS) {
        const crop = CROP_OF_SEED[seed] as BlockType
        const soil = SOIL_OF_CROP[crop] as BlockType
        expect(plantingVerdict(request(seed), soil, 'air')._tag).toBe('planted')
      }
    }),
  )

  it.effect('an item that is not a seed is refused before anything is read', () =>
    Effect.sync(() => {
      expect(plantingVerdict(request('stone'), 'farmland', 'air')).toStrictEqual({
        _tag: 'notASeed',
        held: 'stone',
      })
    }),
  )

  it.effect('THE CASE A SINGLE isSoil GETS WRONG: nether wart refuses farmland', () =>
    Effect.sync(() => {
      // Vanilla, and the reference's config says so in a comment. A world where
      // this succeeds grows a crop and drops an item and is wrong only if you
      // know the game — which is why it is asserted rather than trusted.
      expect(plantingVerdict(request('nether_wart'), 'farmland', 'air')).toStrictEqual({
        _tag: 'wrongSoil',
        crop: 'nether_wart_crop',
        needs: 'soul_sand',
        found: 'farmland',
      })
    }),
  )

  it.effect('and wheat refuses soul sand, which is the same rule read backwards', () =>
    Effect.sync(() => {
      expect(plantingVerdict(request('wheat_seeds'), 'soul_sand', 'air')._tag).toBe('wrongSoil')
    }),
  )

  it.effect('a seed on bare dirt is refused — soil means TILLED', () =>
    Effect.sync(() => {
      // The rule that makes tilling matter. Since `hoe` is not in the
      // vocabulary there is no way to CREATE farmland here yet, and this
      // assertion is what says that gap is a gap rather than an oversight.
      expect(plantingVerdict(request('wheat_seeds'), 'dirt', 'air')._tag).toBe('wrongSoil')
      expect(plantingVerdict(request('wheat_seeds'), 'grass_block', 'air')._tag).toBe('wrongSoil')
    }),
  )

  it.effect('an occupied cell above refuses, and names what is in the way', () =>
    Effect.sync(() => {
      // Water is the case worth naming: it is not solid, so a rule that asked
      // "is the cell above solid?" would plant into it and the crop would be
      // underwater. The reference plants only into AIR.
      expect(plantingVerdict(request('wheat_seeds'), 'farmland', 'water')).toStrictEqual({
        _tag: 'occupied',
        crop: 'wheat_crop',
        blockedBy: 'water',
      })
      expect(plantingVerdict(request('wheat_seeds'), 'farmland', 'wheat_crop')._tag).toBe('occupied')
    }),
  )

  it.effect('the crop goes ABOVE the soil, not into it', () =>
    Effect.sync(() => {
      // An off-by-one here replaces the farmland with the crop: the crop
      // appears, and the soil it needs is gone underneath it.
      expect(cropCellAbove(SOIL)).toStrictEqual({ x: SOIL.x, y: SOIL.y + 1, z: SOIL.z })
      expect(cropCellAbove(SOIL).y).not.toBe(SOIL.y)
    }),
  )
})

describe('plantCrop', () => {
  it.effect('writes the crop above the soil, and nothing else', () =>
    Effect.gen(function* () {
      const above = cropCellAbove(SOIL)
      const { port, written } = yield* makeWorld({
        [keyOf(SOIL)]: 'farmland',
        [keyOf(above)]: 'air',
      })

      const outcome = yield* plantCrop(port, request('wheat_seeds'))

      expect(outcome._tag).toBe('planted')
      expect(yield* Ref.get(written)).toStrictEqual([
        { at: above, block: blockIdOf('wheat_crop') },
      ])
    }),
  )

  it.effect('a refusal writes NOTHING', () =>
    Effect.gen(function* () {
      // The property that makes the outcome union worth having: a caller can
      // consume the seed on `planted` and keep it otherwise, and the world is
      // untouched either way.
      const { port, written } = yield* makeWorld({
        [keyOf(SOIL)]: 'dirt',
        [keyOf(cropCellAbove(SOIL))]: 'air',
      })

      const outcome = yield* plantCrop(port, request('wheat_seeds'))

      expect(outcome._tag).toBe('wrongSoil')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('an UNLOADED soil cell refuses rather than defaulting to air', () =>
    Effect.gen(function* () {
      // `undefined` from the store means "that chunk is not resident". Treating
      // it as air would let the write land in a chunk nobody has loaded, and the
      // chunk that eventually loads would overwrite it — a plant that silently
      // disappears some seconds later.
      const { port, written } = yield* makeWorld({
        [keyOf(cropCellAbove(SOIL))]: 'air',
      })

      const outcome = yield* plantCrop(port, request('wheat_seeds'))

      expect(outcome._tag).not.toBe('planted')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('an unloaded cell ABOVE refuses too', () =>
    Effect.gen(function* () {
      const { port, written } = yield* makeWorld({ [keyOf(SOIL)]: 'farmland' })

      const outcome = yield* plantCrop(port, request('wheat_seeds'))

      expect(outcome._tag).not.toBe('planted')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('a non-seed held over an UNLOADED cell is still notASeed, not wrongSoil', () =>
    Effect.gen(function* () {
      // The unloaded-cell refusal above always held a real seed, so it only
      // ever reached the `wrongSoil` arm of the inner ternary. An unloaded
      // cell with a non-seed in hand is the case that reaches the other arm.
      const { port, written } = yield* makeWorld({})

      const outcome = yield* plantCrop(port, request('stone'))

      expect(outcome).toStrictEqual({ _tag: 'notASeed', held: 'stone' })
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('a non-seed still reads nothing and writes nothing', () =>
    Effect.gen(function* () {
      const { port, written } = yield* makeWorld({
        [keyOf(SOIL)]: 'farmland',
        [keyOf(cropCellAbove(SOIL))]: 'air',
      })

      const outcome = yield* plantCrop(port, request('stone'))

      expect(outcome).toStrictEqual({ _tag: 'notASeed', held: 'stone' })
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('nether wart plants on soul sand through the full path', () =>
    Effect.gen(function* () {
      // The end-to-end form of the refusal above: the same seed that was
      // refused on farmland succeeds on its own soil.
      const above = cropCellAbove(SOIL)
      const { port, written } = yield* makeWorld({
        [keyOf(SOIL)]: 'soul_sand',
        [keyOf(above)]: 'air',
      })

      const outcome = yield* plantCrop(port, request('nether_wart'))

      expect(outcome._tag).toBe('planted')
      expect(yield* Ref.get(written)).toStrictEqual([
        { at: above, block: blockIdOf('nether_wart_crop') },
      ])
    }),
  )
})
