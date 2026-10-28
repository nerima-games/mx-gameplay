/**
 * `domain/interactions/till-soil.ts` — the step before `./plant-crop`.
 *
 * This file exists because a recorded blocker was wrong. `plant-crop.ts` filed
 * tilling as unwritable — the reference keys it on five hoe item names and the
 * vocabulary has none of them — and that was a statement about the reference's
 * implementation rather than about the rule. Keyed on the capability, every
 * block it touches was already present.
 *
 * The tests below also pin a DIVERGENCE: the reference never checks the cell
 * above, and vanilla refuses to till under a solid block.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import {
  CANNOT_TILL,
  TILLABLE_BLOCKS,
  TILLED_BLOCK,
  cellAbove,
  tillSoil,
  tillingVerdict,
  type TillPort,
  type TillCommitContext,
  type TillingCapability,
} from '../src/domain/interactions/till-soil'
import {
  makeReplicatedOwnerId,
  makeWorldCommitCoordinator,
  WorldRevisionConflict,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { CROP_OF_SEED, SOIL_OF_CROP } from '../src/domain/interactions/plant-crop'
import { blockIdOf, WorldIdSchema, WorldRevisionSchema, type BlockType } from '@nerima-games/mc-kernel'
import type { ChunkStoreRegistryApi } from '@nerima-games/mc-worldgen'
import type { BlockPosition } from '@nerima-games/mc-kernel'
import { blockPosition } from './support/coordinate-fixtures'
import { cellKey, chunkKey, chunkOf, makeInMemoryWorld } from '../src/domain/in-memory-world'

const HOE: TillingCapability = { tills: true }
const GROUND: BlockPosition = blockPosition(-2, 61, 7)
const TOP_GROUND: BlockPosition = blockPosition(-2, Number.MAX_SAFE_INTEGER, 7)
type CropBlockType = keyof typeof SOIL_OF_CROP

const keyOf = (p: BlockPosition): string => `${String(p.x)},${String(p.y)},${String(p.z)}`
const WORLD_ID = Schema.decodeUnknownSync(WorldIdSchema)('gameplay-till-tests')
const OWNER_ID = makeReplicatedOwnerId('till-test-owner')
const OWNER_SCHEMA = Schema.Struct({ durability: Schema.Number })
const INITIAL_OWNER_STATE = { durability: 10 }

const positionAbove = (ground: BlockPosition): BlockPosition => {
  const result = cellAbove(ground)
  if (Result.isSuccess(result)) return result.success
  throw new Error(`Expected a cell above ${keyOf(ground)}: ${result.failure.message}`)
}

const makeWorld = (cells: Readonly<Record<string, BlockType>>) =>
  Effect.gen(function* () {
    const written = yield* Ref.make<ReadonlyArray<{ at: BlockPosition; block: number }>>([])
    const reads = yield* Ref.make(0)
    const entries = Object.entries(cells).map(([key, block]) => {
      const [x, y, z] = key.split(',')
      const position = blockPosition(Number(x), Number(y), Number(z))
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
    const context: TillCommitContext = { coordinator, dimension: 'overworld', changes: [] }
    const port: TillPort = {
      blockAt: (position) =>
        Effect.gen(function* () {
          yield* Ref.update(reads, (n) => n + 1)
          const block = cells[keyOf(position)]
          return block === undefined ? undefined : Option.getOrUndefined(blockIdOf(block))
        }),
    }
    return { port, written, reads, world, coordinator, context }
  })

describe('tillingVerdict', () => {
  it.effect('a hoe on clear dirt tills it', () =>
    Effect.sync(() => {
      expect(tillingVerdict(HOE, GROUND, 'dirt', 'air')).toStrictEqual({ _tag: 'tilled', at: GROUND })
    }),
  )

  it.effect('every tillable block tills', () =>
    Effect.sync(() => {
      for (const block of TILLABLE_BLOCKS) {
        expect(tillingVerdict(HOE, GROUND, block, 'air')._tag).toBe('tilled')
      }
      expect(TILLABLE_BLOCKS.size).toBe(2)
    }),
  )

  it.effect('KEYED ON CAPABILITY: an item that does not till is refused first', () =>
    Effect.sync(() => {
      // The reason this file could be written at all. The reference asks
      // `HOE_ITEM_TYPES.has(item)` over five literals the vocabulary lacks; the
      // rule only ever needed one boolean.
      expect(tillingVerdict(CANNOT_TILL, GROUND, 'dirt', 'air')).toStrictEqual({ _tag: 'noHoe' })
    }),
  )

  it.effect('stone is not tillable, and the refusal names what was found', () =>
    Effect.sync(() => {
      expect(tillingVerdict(HOE, GROUND, 'stone', 'air')).toStrictEqual({
        _tag: 'notTillable',
        found: 'stone',
      })
    }),
  )

  it.effect('already-tilled ground is not tillable again', () =>
    Effect.sync(() => {
      // Farmland is not in the tillable set, so a second swing is a no-op
      // rather than a redundant write. Worth its own case because "till what is
      // already tilled" is what holding the button does.
      expect(tillingVerdict(HOE, GROUND, TILLED_BLOCK, 'air')._tag).toBe('notTillable')
    }),
  )
})

describe('the check the reference does not make', () => {
  it.effect('DIVERGENCE: tilling under a solid block is refused', () =>
    Effect.sync(() => {
      // Vanilla refuses. The reference tests only the ground block and writes
      // FARMLAND regardless, so a player can till a cave floor under stone and
      // get farmland nothing can ever be planted on — `./plant-crop` would then
      // answer `occupied`, which is correct and a confusing place to learn it.
      expect(tillingVerdict(HOE, GROUND, 'dirt', 'stone')).toStrictEqual({
        _tag: 'obstructed',
        blockedBy: 'stone',
      })
    }),
  )

  it.effect('water above also blocks it', () =>
    Effect.sync(() => {
      // Water is not solid, so a rule asking "is the block above solid?" would
      // allow this. Only `air` is clear — the same test `./plant-crop` makes.
      expect(tillingVerdict(HOE, GROUND, 'dirt', 'water')._tag).toBe('obstructed')
    }),
  )

  it.effect('the obstruction is checked AFTER the ground, so the refusal is specific', () =>
    Effect.sync(() => {
      // Ordering matters for the message: stone under stone should say "not
      // tillable", not "obstructed", because changing what is above would not
      // help.
      expect(tillingVerdict(HOE, GROUND, 'stone', 'stone')._tag).toBe('notTillable')
    }),
  )

  it.effect('coordinate overflow is reported as an invalid position', () =>
    Effect.sync(() => {
      expect(cellAbove(TOP_GROUND)).toStrictEqual(Result.fail({
        _tag: 'BlockNeighbourFailure',
        kind: 'RangeError',
        reason: 'coordinate-overflow',
        message: `Block coordinate exceeds the safe integer range: ${Number.MAX_SAFE_INTEGER + 1}`,
      }))
      expect(tillingVerdict(HOE, TOP_GROUND, 'dirt', 'air')).toStrictEqual({ _tag: 'invalidPosition' })
    }),
  )
})

describe('tillSoil', () => {
  it.effect('writes farmland into the ground cell, not above it', () =>
    Effect.gen(function* () {
      // The off-by-one that would put farmland where the crop goes.
      const { port, written, context, coordinator } = yield* makeWorld({
        [keyOf(GROUND)]: 'dirt',
        [keyOf(positionAbove(GROUND))]: 'air',
      })

      const outcome = yield* tillSoil(port, HOE, GROUND, {
        ...context,
        changes: [{ ownerId: OWNER_ID, state: { durability: 9 } }],
      })

      expect(outcome._tag).toBe('tilled')
      expect(yield* Ref.get(written)).toStrictEqual([
        { at: GROUND, block: Option.getOrThrow(blockIdOf(TILLED_BLOCK)) },
      ])
      const committedOwner = yield* coordinator.snapshot(OWNER_ID, OWNER_SCHEMA)
      expect(Schema.decodeUnknownSync(OWNER_SCHEMA)(committedOwner.state)).toStrictEqual({ durability: 9 })
      expect(yield* coordinator.revision).toBe(1)
    }),
  )

  it.effect('refuses a successful till when C4/C7 commit context is missing', () =>
    Effect.gen(function* () {
      const { port, written, coordinator } = yield* makeWorld({
        [keyOf(GROUND)]: 'dirt',
        [keyOf(positionAbove(GROUND))]: 'air',
      })

      expect((yield* tillSoil(port, HOE, GROUND))._tag).toBe('commitContextMissing')
      expect(yield* Ref.get(written)).toStrictEqual([])
      expect(yield* coordinator.revision).toBe(0)
    }),
  )

  it.effect('reports a coordinator conflict without tilling the ground', () =>
    Effect.gen(function* () {
      const { port, written, context, coordinator } = yield* makeWorld({
        [keyOf(GROUND)]: 'dirt',
        [keyOf(positionAbove(GROUND))]: 'air',
      })
      const refusingContext: TillCommitContext = {
        ...context,
        coordinator: {
          ...context.coordinator,
          commit: () => Effect.fail(new WorldRevisionConflict({
            expected: Schema.decodeUnknownSync(WorldRevisionSchema)(1),
            actual: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
          })),
        },
      }

      const outcome = yield* tillSoil(port, HOE, GROUND, refusingContext)

      expect(outcome._tag).toBe('commitFailed')
      if (outcome._tag !== 'commitFailed') return
      expect(outcome.error._tag).toBe('WorldRevisionConflict')
      expect(yield* Ref.get(written)).toStrictEqual([])
      expect(yield* coordinator.revision).toBe(0)
    }),
  )

  it.effect('a non-tilling item costs NO reads at all', () =>
    Effect.gen(function* () {
      // Answered before touching the world. A player swinging a sword must not
      // cost two chunk reads every frame.
      const { port, reads, written } = yield* makeWorld({ [keyOf(GROUND)]: 'dirt' })

      const outcome = yield* tillSoil(port, CANNOT_TILL, GROUND)

      expect(outcome).toStrictEqual({ _tag: 'noHoe' })
      expect(yield* Ref.get(reads)).toBe(0)
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('a refusal writes nothing', () =>
    Effect.gen(function* () {
      const { port, written, context } = yield* makeWorld({
        [keyOf(GROUND)]: 'dirt',
        [keyOf(positionAbove(GROUND))]: 'stone',
      })

      expect((yield* tillSoil(port, HOE, GROUND, context))._tag).toBe('obstructed')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('an unloaded cell refuses rather than defaulting to air', () =>
    Effect.gen(function* () {
      const { port, written, context } = yield* makeWorld({ [keyOf(positionAbove(GROUND))]: 'air' })

      expect((yield* tillSoil(port, HOE, GROUND, context))._tag).not.toBe('tilled')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('an unloaded cell ABOVE refuses too, with the ground itself loaded', () =>
    Effect.gen(function* () {
      // The case above always left GROUND unloaded; this is the mirror where
      // the ground reads fine and only the cell above is not resident.
      const { port, written, context } = yield* makeWorld({ [keyOf(GROUND)]: 'dirt' })

      expect((yield* tillSoil(port, HOE, GROUND, context))._tag).not.toBe('tilled')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('coordinate overflow refuses before reading or writing', () =>
    Effect.gen(function* () {
      const { port, reads, written } = yield* makeWorld({})

      const outcome = yield* tillSoil(port, HOE, TOP_GROUND)

      expect(outcome).toStrictEqual({ _tag: 'invalidPosition' })
      expect(yield* Ref.get(reads)).toBe(0)
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )
})

describe('the loop closes', () => {
  it.effect('what tilling produces is what planting requires', () =>
    Effect.sync(() => {
      // THE ASSERTION NEITHER FILE CAN MAKE ALONE, and the reason to have both.
      // If tilling produced `soil` and planting wanted `farmland`, each file's
      // own tests would pass and the game would have a step that cannot be
      // completed.
      const overworldCrops = Object.values(CROP_OF_SEED).filter(
        (crop): crop is CropBlockType =>
          crop !== undefined && SOIL_OF_CROP[crop] === TILLED_BLOCK,
      )

      expect(overworldCrops.length).toBeGreaterThan(0)
      for (const crop of overworldCrops) {
        expect(SOIL_OF_CROP[crop]).toBe(TILLED_BLOCK)
      }
    }),
  )

  it.effect('and one crop deliberately does NOT use it', () =>
    Effect.sync(() => {
      // Nether wart takes soul sand, which no hoe produces. Asserted so that
      // "everything plantable needs tilling" cannot quietly become true.
      expect(SOIL_OF_CROP['nether_wart_crop']).not.toBe(TILLED_BLOCK)
      expect(TILLABLE_BLOCKS.has('soul_sand')).toBe(false)
    }),
  )
})
