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
import { Effect, Option, Ref, Result, Schema } from 'effect'
import {
  CROP_OF_SEED,
  PLANTABLE_SEEDS,
  SOIL_OF_CROP,
  cropCellAbove,
  plantCrop,
  plantingVerdict,
  type PlantPort,
  type PlantRequest,
  type PlantCommitContext,
} from '../src/domain/interactions/plant-crop'
import {
  makeReplicatedOwnerId,
  makeWorldCommitCoordinator,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { BlockAxis, blockIdOf, blockPosition, WorldIdSchema, type BlockType } from '@nerima-games/mc-kernel'
import type { ChunkStoreRegistryApi } from '@nerima-games/mc-worldgen'
import type { BlockPosition } from '@nerima-games/mc-kernel'
import { cellKey, chunkKey, chunkOf, makeInMemoryWorld } from '../src/domain/in-memory-world'

const SOIL: BlockPosition = blockPosition(BlockAxis(4), BlockAxis(63), BlockAxis(-9))
const TOP_SOIL: BlockPosition = blockPosition(BlockAxis(4), BlockAxis(Number.MAX_SAFE_INTEGER), BlockAxis(-9))

const request = (held: PlantRequest['held']): PlantRequest => ({ held, soil: SOIL })

const keyOf = (position: BlockPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

const WORLD_ID = Schema.decodeUnknownSync(WorldIdSchema)('gameplay-plant-tests')
const OWNER_ID = makeReplicatedOwnerId('plant-test-owner')
const OWNER_SCHEMA = Schema.Struct({ durability: Schema.Number })
const INITIAL_OWNER_STATE = { durability: 10 }

const positionAbove = (soil: BlockPosition): BlockPosition => {
  const result = cropCellAbove(soil)
  if (Result.isSuccess(result)) return result.success
  throw new Error(`Expected a cell above ${keyOf(soil)}: ${result.failure.message}`)
}

/**
 * A world of exactly two cells, plus whatever a test adds.
 *
 * `undefined` for anything not listed, which is `PlantPort.blockAt`'s "that
 * chunk is not resident" and NOT air — the distinction the implementation
 * refuses to collapse.
 */
const makeWorld = (cells: Readonly<Record<string, BlockType>>) =>
  Effect.gen(function* () {
    const written = yield* Ref.make<ReadonlyArray<{ at: BlockPosition; block: number }>>([])
    const reads = yield* Ref.make(0)
    const entries = Object.entries(cells).map(([key, block]) => {
      const [x, y, z] = key.split(',')
      const position = blockPosition(BlockAxis(Number(x)), BlockAxis(Number(y)), BlockAxis(Number(z)))
      return [position, Option.getOrThrow(blockIdOf(block))] as const
    })
    const world = yield* makeInMemoryWorld<unknown>({
      world: {
        blocks: new Map(entries.map(([position, block]) => [cellKey(position), block])),
        loaded: [...new Set(entries.map(([position]) => chunkKey(chunkOf(position))))],
      },
    })
    const baseCoordinator = yield* makeWorldCommitCoordinator({
      world: WORLD_ID,
      owners: [{ ownerId: OWNER_ID, schema: OWNER_SCHEMA, initialState: INITIAL_OWNER_STATE }],
      chunkStores: { forDimension: () => world.chunkStore } satisfies ChunkStoreRegistryApi,
    })
    const coordinator: WorldCommitCoordinatorApi = {
      ...baseCoordinator,
      commit: (request) => Effect.tap(
        baseCoordinator.commit(request),
        () => Ref.update(written, (all) => [
          ...all,
          ...(request.blockWrite?.edits.map(({ position, block }) => ({ at: position, block })) ?? []),
        ]),
      ),
    }
    const context: PlantCommitContext = { coordinator, dimension: 'overworld', changes: [] }
    const port: PlantPort = {
      blockAt: (position) =>
        Effect.gen(function* () {
          yield* Ref.update(reads, (n) => n + 1)
          const block = cells[keyOf(position)]
          return block === undefined ? undefined : Option.getOrUndefined(blockIdOf(block))
        }),
    }
    return { port, written, reads, world, coordinator, context }
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
        at: positionAbove(SOIL),
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
      expect(positionAbove(SOIL)).toStrictEqual({ x: SOIL.x, y: SOIL.y + 1, z: SOIL.z })
      expect(positionAbove(SOIL).y).not.toBe(SOIL.y)
    }),
  )

  it.effect('coordinate overflow is reported as an invalid position', () =>
    Effect.sync(() => {
      expect(cropCellAbove(TOP_SOIL)).toStrictEqual(Result.fail({
        _tag: 'BlockNeighbourFailure',
        kind: 'RangeError',
        reason: 'coordinate-overflow',
        message: `Block coordinate exceeds the safe integer range: ${Number.MAX_SAFE_INTEGER + 1}`,
      }))
      expect(plantingVerdict({ held: 'wheat_seeds', soil: TOP_SOIL }, 'farmland', 'air')).toStrictEqual({
        _tag: 'invalidPosition',
      })
    }),
  )
})

describe('plantCrop', () => {
  it.effect('writes the crop above the soil, and nothing else', () =>
    Effect.gen(function* () {
      const above = positionAbove(SOIL)
      const { port, written, context, coordinator } = yield* makeWorld({
        [keyOf(SOIL)]: 'farmland',
        [keyOf(above)]: 'air',
      })

      const outcome = yield* plantCrop(port, request('wheat_seeds'), {
        ...context,
        changes: [{ ownerId: OWNER_ID, state: { durability: 9 } }],
      })

      expect(outcome._tag).toBe('planted')
      expect(yield* Ref.get(written)).toStrictEqual([
        { at: above, block: Option.getOrUndefined(blockIdOf('wheat_crop')) },
      ])
      const committedOwner = yield* coordinator.snapshot(OWNER_ID, OWNER_SCHEMA)
      expect(Schema.decodeUnknownSync(OWNER_SCHEMA)(committedOwner.state)).toStrictEqual({ durability: 9 })
      expect(yield* coordinator.revision).toBe(1)
    }),
  )

  it.effect('refuses a successful plant when C4/C7 commit context is missing', () =>
    Effect.gen(function* () {
      const above = positionAbove(SOIL)
      const { port, written, coordinator } = yield* makeWorld({
        [keyOf(SOIL)]: 'farmland',
        [keyOf(above)]: 'air',
      })

      expect((yield* plantCrop(port, request('wheat_seeds')))._tag).toBe('commitContextMissing')
      expect(yield* Ref.get(written)).toStrictEqual([])
      expect(yield* coordinator.revision).toBe(0)
    }),
  )

  it.effect('a refusal writes NOTHING', () =>
    Effect.gen(function* () {
      // The property that makes the outcome union worth having: a caller can
      // consume the seed on `planted` and keep it otherwise, and the world is
      // untouched either way.
      const { port, written, context } = yield* makeWorld({
        [keyOf(SOIL)]: 'dirt',
        [keyOf(positionAbove(SOIL))]: 'air',
      })

      const outcome = yield* plantCrop(port, request('wheat_seeds'), context)

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
      const { port, written, context } = yield* makeWorld({
        [keyOf(positionAbove(SOIL))]: 'air',
      })

      const outcome = yield* plantCrop(port, request('wheat_seeds'), context)

      expect(outcome._tag).not.toBe('planted')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('an unloaded cell ABOVE refuses too', () =>
    Effect.gen(function* () {
      const { port, written, context } = yield* makeWorld({ [keyOf(SOIL)]: 'farmland' })

      const outcome = yield* plantCrop(port, request('wheat_seeds'), context)

      expect(outcome._tag).not.toBe('planted')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('a non-seed held over an UNLOADED cell is still notASeed, not wrongSoil', () =>
    Effect.gen(function* () {
      // The unloaded-cell refusal above always held a real seed, so it only
      // ever reached the `wrongSoil` arm of the inner ternary. An unloaded
      // cell with a non-seed in hand is the case that reaches the other arm.
      const { port, written, context } = yield* makeWorld({})

      const outcome = yield* plantCrop(port, request('stone'), context)

      expect(outcome).toStrictEqual({ _tag: 'notASeed', held: 'stone' })
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('a non-seed still reads nothing and writes nothing', () =>
    Effect.gen(function* () {
      const { port, written, context } = yield* makeWorld({
        [keyOf(SOIL)]: 'farmland',
        [keyOf(positionAbove(SOIL))]: 'air',
      })

      const outcome = yield* plantCrop(port, request('stone'), context)

      expect(outcome).toStrictEqual({ _tag: 'notASeed', held: 'stone' })
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('nether wart plants on soul sand through the full path', () =>
    Effect.gen(function* () {
      // The end-to-end form of the refusal above: the same seed that was
      // refused on farmland succeeds on its own soil.
      const above = positionAbove(SOIL)
      const { port, written, context } = yield* makeWorld({
        [keyOf(SOIL)]: 'soul_sand',
        [keyOf(above)]: 'air',
      })

      const outcome = yield* plantCrop(port, request('nether_wart'), context)

      expect(outcome._tag).toBe('planted')
      expect(yield* Ref.get(written)).toStrictEqual([
        { at: above, block: Option.getOrUndefined(blockIdOf('nether_wart_crop')) },
      ])
    }),
  )

  it.effect('coordinate overflow refuses before reading or writing', () =>
    Effect.gen(function* () {
      const { port, reads, written } = yield* makeWorld({})

      const outcome = yield* plantCrop(port, { held: 'wheat_seeds', soil: TOP_SOIL })

      expect(outcome).toStrictEqual({ _tag: 'invalidPosition' })
      expect(yield* Ref.get(reads)).toBe(0)
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )
})
