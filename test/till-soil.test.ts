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
import { Effect, Ref } from 'effect'
import {
  CANNOT_TILL,
  TILLABLE_BLOCKS,
  TILLED_BLOCK,
  cellAbove,
  tillSoil,
  tillingVerdict,
  type TillPort,
  type TillingCapability,
} from '../domain/interactions/till-soil'
import { CROP_OF_SEED, SOIL_OF_CROP } from '../domain/interactions/plant-crop'
import { blockIdOf, type BlockType } from '../domain/block-vocabulary'
import type { BlockPosition } from '../domain/chunk-store-port'

const HOE: TillingCapability = { tills: true }
const GROUND: BlockPosition = { x: -2, y: 61, z: 7 }

const keyOf = (p: BlockPosition): string => `${String(p.x)},${String(p.y)},${String(p.z)}`

const makeWorld = (cells: Readonly<Record<string, BlockType>>) =>
  Effect.gen(function* () {
    const written = yield* Ref.make<ReadonlyArray<{ at: BlockPosition; block: number }>>([])
    const reads = yield* Ref.make(0)
    const port: TillPort = {
      blockAt: (position) =>
        Effect.gen(function* () {
          yield* Ref.update(reads, (n) => n + 1)
          const block = cells[keyOf(position)]
          return block === undefined ? undefined : blockIdOf(block)
        }),
      setBlock: (at, block) => Ref.update(written, (all) => [...all, { at, block }]),
    }
    return { port, written, reads }
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
})

describe('tillSoil', () => {
  it.effect('writes farmland into the ground cell, not above it', () =>
    Effect.gen(function* () {
      // The off-by-one that would put farmland where the crop goes.
      const { port, written } = yield* makeWorld({
        [keyOf(GROUND)]: 'dirt',
        [keyOf(cellAbove(GROUND))]: 'air',
      })

      const outcome = yield* tillSoil(port, HOE, GROUND)

      expect(outcome._tag).toBe('tilled')
      expect(yield* Ref.get(written)).toStrictEqual([
        { at: GROUND, block: blockIdOf(TILLED_BLOCK) },
      ])
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
      const { port, written } = yield* makeWorld({
        [keyOf(GROUND)]: 'dirt',
        [keyOf(cellAbove(GROUND))]: 'stone',
      })

      expect((yield* tillSoil(port, HOE, GROUND))._tag).toBe('obstructed')
      expect(yield* Ref.get(written)).toStrictEqual([])
    }),
  )

  it.effect('an unloaded cell refuses rather than defaulting to air', () =>
    Effect.gen(function* () {
      const { port, written } = yield* makeWorld({ [keyOf(cellAbove(GROUND))]: 'air' })

      expect((yield* tillSoil(port, HOE, GROUND))._tag).not.toBe('tilled')
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
        (crop) => SOIL_OF_CROP[crop as BlockType] === TILLED_BLOCK,
      )

      expect(overworldCrops.length).toBeGreaterThan(0)
      for (const crop of overworldCrops) {
        expect(SOIL_OF_CROP[crop as BlockType]).toBe(TILLED_BLOCK)
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
