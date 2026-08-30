/**
 * THE FOUR PER-BLOCK PLACEMENT RULES, which `docs/testing.md` §3-1 recorded as
 * 「設置のブロック別ルール 4 本 […] も無い」 and named as 先送りであって拒否ではない.
 *
 * `domain/interactions/place-mushroom-light.ts`, `./place-sugar-cane-water.ts`,
 * `./place-cactus-sides.ts` and `./place-door-upper.ts`, plus the composition in
 * `./place-block.ts`.
 *
 * The reference oracle is
 * `<reference-impl>/packages/world/domain/block-placement-rules.test.ts`, whose
 * four `it`s are transcribed in the first `describe` of each rule below. What
 * the reference cannot express — the three-valued read, and therefore what
 * happens at a chunk edge — is tested after them, because that is where this
 * repository's version DIFFERS rather than merely ports.
 *
 * Kernel 0.2.5 itemises all ten support-sensitive plants. The last `describe`
 * pins that vocabulary boundary positively, while the integration cases below
 * reach the mushroom, sugar-cane and cactus gates through real held items.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  BLOCK_TYPES,
  PLACEABLE_ITEM_TYPES,
  blockIdOf,
  isPlaceableItem,
  type PlaceableItemType,
} from '../src/domain/block-vocabulary'
import { blockPosition, horizontalBlockNeighbours, ITEM_TYPES } from '@nerima-games/mc-kernel'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition, type BlockReading } from '../src/domain/chunk-store-port'
import {
  MAX_MUSHROOM_PLACEMENT_LIGHT,
  isMushroomBlock,
  isMushroomPlacementLightAllowed,
  mushroomLightObjection,
  placementLightLevel,
} from '../src/domain/interactions/place-mushroom-light'
import {
  hasRequiredSugarCaneAdjacentWater,
  isSugarCaneBlock,
  sugarCaneWaterObjection,
} from '../src/domain/interactions/place-sugar-cane-water'
import {
  hasClearCactusHorizontalSides,
  isCactusBlock,
  cactusSidesObjection,
} from '../src/domain/interactions/place-cactus-sides'
import { doorUpperBreakCell, doorUpperCell, isDoorBlock } from '../src/domain/interactions/place-door-upper'
import { placeBlock } from '../src/domain/interactions/place-block'
import { lightWorld, makeChunkStoreDouble, world, STONE, WATER } from './support/chunk-store-double'

const id = (name: Parameters<typeof blockIdOf>[0]): BlockId => {
  const found = blockIdOf(name)
  expect(found).toBeDefined()
  return found ?? -1
}

const BROWN_MUSHROOM = id('brown_mushroom')
const RED_MUSHROOM = id('red_mushroom')
const SUGAR_CANE = id('sugar_cane')
const CACTUS = id('cactus')
const DOOR = id('door')
const SAND = id('sand')

const target: BlockPosition = { x: 4, y: 64, z: 4 }
const supportCell: BlockPosition = { x: 4, y: 63, z: 4 }
const block = (blockId: BlockId): BlockReading => ({ _tag: 'Block', block: blockId })

describe('horizontalBlockNeighbours', () => {
  it('returns all four, in a fixed order, and does not clip at a chunk edge', () => {
    // THE REFERENCE'S DEFECT, NOT REPRODUCED. `localHorizontalNeighbors` drops
    // any neighbour outside the chunk it holds, so a cactus at x = 15 is checked
    // on three sides and a sugar cane at x = 0 cannot see water one cell west.
    expect(horizontalBlockNeighbours(blockPosition(0, 64, 0))).toStrictEqual([
      { x: -1, y: 64, z: 0 },
      { x: 1, y: 64, z: 0 },
      { x: 0, y: 64, z: -1 },
      { x: 0, y: 64, z: 1 },
    ])
    expect(horizontalBlockNeighbours(blockPosition(15, 64, 15))).toHaveLength(4)
  })
})

describe('mushrooms need light 12 or lower', () => {
  it('ports the reference oracle', () => {
    // `block-placement-rules.test.ts`: 「allows mushroom placement only in low
    // light」, over ids instead of names.
    expect(isMushroomPlacementLightAllowed(BROWN_MUSHROOM, 12)).toBe(true)
    expect(isMushroomPlacementLightAllowed(RED_MUSHROOM, 13)).toBe(false)
    expect(isMushroomPlacementLightAllowed(STONE, 15)).toBe(true)
  })

  it('brackets the threshold from both sides, so an off-by-one fails a named test', () => {
    expect(MAX_MUSHROOM_PLACEMENT_LIGHT).toBe(12)
    expect(isMushroomPlacementLightAllowed(BROWN_MUSHROOM, MAX_MUSHROOM_PLACEMENT_LIGHT)).toBe(true)
    expect(isMushroomPlacementLightAllowed(BROWN_MUSHROOM, MAX_MUSHROOM_PLACEMENT_LIGHT + 1)).toBe(
      false,
    )
  })

  it('refuses an unmeasurable light level, which the arithmetic alone already did', () => {
    // `NaN <= 12` is `false`, so the explicit test changes no answer — it is
    // there so that changing the comparison cannot silently change one. The
    // same shape, and the same direction, as `domain/mob/hostile-spawn.ts`.
    expect(isMushroomPlacementLightAllowed(BROWN_MUSHROOM, Number.NaN)).toBe(false)
    expect(isMushroomPlacementLightAllowed(BROWN_MUSHROOM, Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('names the two mushrooms through kernel’s registry, and nothing else', () => {
    expect(isMushroomBlock(BROWN_MUSHROOM)).toBe(true)
    expect(isMushroomBlock(RED_MUSHROOM)).toBe(true)
    expect(isMushroomBlock(STONE)).toBe(false)
    // An id this build cannot name is not a mushroom: the arm that lets an
    // unknown byte through rather than refusing it for a reason nobody can state.
    expect(isMushroomBlock(250)).toBe(false)
  })

  it('takes the BRIGHTER of sky and block, which is not what the spawn rule does', () => {
    expect(placementLightLevel(0, 14)).toBe(14)
    expect(placementLightLevel(15, 0)).toBe(15)
  })

  it.effect('reads no light at all for a block that is not a mushroom', () =>
    Effect.gen(function* () {
      // The whole cost argument for putting these on the placement path:
      // `getLight` relights a chunk on the first read after a write, and a
      // player stacking stone must not pay for it.
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(yield* mushroomLightObjection(store.api, STONE, target)).toBeUndefined()
      expect((yield* store.calls).reads).toBe(0)
    }),
  )

  it.effect('refuses a bright cell and allows a dark one', () =>
    Effect.gen(function* () {
      const bright = yield* makeChunkStoreDouble(
        world([]),
        ['0,0'],
        lightWorld([[target, { sky: 13, block: 0 }]]),
      )
      const dim = yield* makeChunkStoreDouble(
        world([]),
        ['0,0'],
        lightWorld([[target, { sky: 12, block: 0 }]]),
      )

      expect(yield* mushroomLightObjection(bright.api, BROWN_MUSHROOM, target)).toStrictEqual({
        _tag: 'TooBright',
        light: 13,
      })
      expect(yield* mushroomLightObjection(dim.api, RED_MUSHROOM, target)).toBeUndefined()
    }),
  )

  it.effect('reports an unmeasurable light apart from a bright one', () =>
    Effect.gen(function* () {
      // The reference cannot: it defaults an absent light grid to `skyLight = 15`,
      // so an unlit chunk reports FULL DAYLIGHT and every mushroom is refused
      // with a message about brightness.
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(
        yield* mushroomLightObjection(store.api, BROWN_MUSHROOM, { x: 200, y: 64, z: 0 }),
      ).toStrictEqual({ _tag: 'LightUnknown' })
    }),
  )
})

describe('sugar cane needs water beside its support', () => {
  it('ports the reference oracle', () => {
    // 「requires adjacent water for sugar cane unless stacked on sugar cane」.
    expect(hasRequiredSugarCaneAdjacentWater(block(SUGAR_CANE), [block(AIR_BLOCK_ID)])).toBe(true)
    expect(
      hasRequiredSugarCaneAdjacentWater(block(SAND), [block(AIR_BLOCK_ID), block(WATER)]),
    ).toBe(true)
    expect(hasRequiredSugarCaneAdjacentWater(block(SAND), [block(AIR_BLOCK_ID)])).toBe(false)
  })

  it('does not accept an unreadable neighbour as water, nor an unread support as a stack', () => {
    // The refusing direction, and the case the reference cannot express at all.
    expect(hasRequiredSugarCaneAdjacentWater(block(SAND), [{ _tag: 'ChunkNotLoaded' }])).toBe(false)
    expect(hasRequiredSugarCaneAdjacentWater({ _tag: 'ChunkNotLoaded' }, [block(WATER)])).toBe(true)
    expect(hasRequiredSugarCaneAdjacentWater(undefined, [block(WATER)])).toBe(true)
    expect(hasRequiredSugarCaneAdjacentWater(undefined, [block(AIR_BLOCK_ID)])).toBe(false)
  })

  it('names sugar cane through kernel’s registry', () => {
    expect(isSugarCaneBlock(SUGAR_CANE)).toBe(true)
    expect(isSugarCaneBlock(SAND)).toBe(false)
  })

  it.effect('reads nothing for another block, and nothing further for a stacked cane', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(yield* sugarCaneWaterObjection(store.api, STONE, target, block(SAND))).toBeUndefined()
      // The stacking short-circuit is not an optimisation to be tidied away:
      // the common case of a growing stack would otherwise pay four store calls
      // per segment.
      expect(
        yield* sugarCaneWaterObjection(store.api, SUGAR_CANE, target, block(SUGAR_CANE)),
      ).toBeUndefined()
      expect((yield* store.calls).reads).toBe(0)
    }),
  )

  it.effect('looks for the water BESIDE THE SUPPORT, one level below the cane', () =>
    Effect.gen(function* () {
      // The half that is easy to get wrong by one. Water level with the plant is
      // water the plant is standing in; sugar cane grows on a bank with water
      // lapping against the BANK.
      const besideSupport = yield* makeChunkStoreDouble(
        world([[{ x: 5, y: 63, z: 4 }, WATER]]),
        ['0,0'],
      )
      const besideCane = yield* makeChunkStoreDouble(world([[{ x: 5, y: 64, z: 4 }, WATER]]), ['0,0'])

      expect(
        yield* sugarCaneWaterObjection(besideSupport.api, SUGAR_CANE, target, block(SAND)),
      ).toBeUndefined()
      expect(
        yield* sugarCaneWaterObjection(besideCane.api, SUGAR_CANE, target, block(SAND)),
      ).toStrictEqual({ _tag: 'NoAdjacentWater' })

      // Four reads either way, one per side.
      expect((yield* besideSupport.calls).reads).toBe(4)
    }),
  )

  it.effect('sees water in the NEXT CHUNK, which the reference cannot', () =>
    Effect.gen(function* () {
      // A cane at x = 0 with water at x = -1. The reference filters that
      // neighbour out of its list entirely, so the shoreline is invisible and
      // the cane is refused — a position-dependent placement rule.
      const edge: BlockPosition = { x: 0, y: 64, z: 4 }
      const store = yield* makeChunkStoreDouble(
        world([[{ x: -1, y: 63, z: 4 }, WATER]]),
        ['0,0', '-1,0'],
      )

      expect(
        yield* sugarCaneWaterObjection(store.api, SUGAR_CANE, edge, block(SAND)),
      ).toBeUndefined()
    }),
  )
})

describe('cactus needs four clear sides', () => {
  it('ports the reference oracle', () => {
    // 「requires every cactus side to be air」.
    expect(
      hasClearCactusHorizontalSides([block(AIR_BLOCK_ID), block(AIR_BLOCK_ID), block(AIR_BLOCK_ID)]),
    ).toBe(true)
    expect(
      hasClearCactusHorizontalSides([block(AIR_BLOCK_ID), block(STONE), block(AIR_BLOCK_ID)]),
    ).toBe(false)
  })

  it('does not widen air to replaceable — water against a cactus is a cactus that pops', () => {
    expect(hasClearCactusHorizontalSides([block(WATER)])).toBe(false)
  })

  it('does not accept an unreadable side as clear', () => {
    expect(hasClearCactusHorizontalSides([{ _tag: 'ChunkNotLoaded' }])).toBe(false)
    expect(hasClearCactusHorizontalSides([{ _tag: 'OutOfWorld' }])).toBe(false)
    // `every` over an empty list is `true`, which is the right answer here and
    // is stated so that a reader need not decide whether it was thought about.
    expect(hasClearCactusHorizontalSides([])).toBe(true)
  })

  it('names the cactus through kernel’s registry', () => {
    expect(isCactusBlock(CACTUS)).toBe(true)
    expect(isCactusBlock(SAND)).toBe(false)
  })

  it.effect('reads nothing for another block, and exactly four sides for a cactus', () =>
    Effect.gen(function* () {
      const clear = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const blocked = yield* makeChunkStoreDouble(world([[{ x: 5, y: 64, z: 4 }, STONE]]), ['0,0'])

      expect(yield* cactusSidesObjection(clear.api, STONE, target)).toBeUndefined()
      expect((yield* clear.calls).reads).toBe(0)

      expect(yield* cactusSidesObjection(clear.api, CACTUS, target)).toBeUndefined()
      expect((yield* clear.calls).reads).toBe(4)

      expect(yield* cactusSidesObjection(blocked.api, CACTUS, target)).toStrictEqual({
        _tag: 'SidesBlocked',
      })
      // FOUR EVEN WHEN THE FIRST IS BLOCKED. A loop that bailed early would
      // make the call count depend on which side happened to be in the way, and
      // two runs of one scenario must make the same store calls (plan.md §5.1-3).
      expect((yield* blocked.calls).reads).toBe(4)
    }),
  )

  it.effect('checks all four sides at a chunk boundary, which the reference does not', () =>
    Effect.gen(function* () {
      const edge: BlockPosition = { x: 15, y: 64, z: 4 }
      const store = yield* makeChunkStoreDouble(world([[{ x: 16, y: 64, z: 4 }, STONE]]), ['0,0', '1,0'])

      expect(yield* cactusSidesObjection(store.api, CACTUS, edge)).toStrictEqual({
        _tag: 'SidesBlocked',
      })
    }),
  )
})

describe('a door needs the cell above', () => {
  it('names the door through kernel’s registry, and NOT the open form', () => {
    expect(isDoorBlock(DOOR)).toBe(true)
    expect(isDoorBlock(id('door_open'))).toBe(false)
    expect(isDoorBlock(STONE)).toBe(false)
  })

  it.effect('reads nothing for another block; one read for a door', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(yield* doorUpperCell(store.api, STONE, target)).toStrictEqual({ _tag: 'NotADoor' })
      expect((yield* store.calls).reads).toBe(0)

      expect(yield* doorUpperCell(store.api, DOOR, target)).toStrictEqual({
        _tag: 'Clear',
        cell: { x: 4, y: 65, z: 4 },
      })
      expect((yield* store.calls).reads).toBe(1)
    }),
  )

  it.effect('refuses a blocked cell above, an unloaded one, and the build limit', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[{ x: 4, y: 65, z: 4 }, STONE]]), ['0,0'])

      expect(yield* doorUpperCell(store.api, DOOR, target)).toStrictEqual({ _tag: 'NoRoomAbove' })
      expect(yield* doorUpperCell(store.api, DOOR, { x: 200, y: 64, z: 4 })).toStrictEqual({
        _tag: 'NoRoomAbove',
      })
      expect(yield* doorUpperCell(store.api, DOOR, { x: 4, y: 255, z: 4 })).toStrictEqual({
        _tag: 'NoRoomAbove',
      })
    }),
  )

  it.effect('refuses WATER above, although `isReplaceable` admits it', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[{ x: 4, y: 65, z: 4 }, WATER]]), ['0,0'])

      expect(yield* doorUpperCell(store.api, DOOR, target)).toStrictEqual({ _tag: 'NoRoomAbove' })
    }),
  )
})

describe('doorUpperBreakCell finds the upper half that must break with the lower', () => {
  it.effect('is NotADoor for a non-door block, without reading the cell above', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(yield* doorUpperBreakCell(store.api, STONE, target)).toStrictEqual({ _tag: 'NotADoor' })
      expect((yield* store.calls).reads).toBe(0)
    }),
  )

  it.effect('is NoDoorAbove when the cell above is not a door, so nothing extra is broken', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[{ x: 4, y: 65, z: 4 }, STONE]]), ['0,0'])

      expect(yield* doorUpperBreakCell(store.api, DOOR, target)).toStrictEqual({ _tag: 'NoDoorAbove' })
    }),
  )

  it.effect('is DoorAbove when the cell above is the matching upper half', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[{ x: 4, y: 65, z: 4 }, DOOR]]), ['0,0'])

      expect(yield* doorUpperBreakCell(store.api, DOOR, target)).toStrictEqual({
        _tag: 'DoorAbove',
        cell: { x: 4, y: 65, z: 4 },
      })
    }),
  )
})

describe('placeBlock composes the four, and a door fills two cells', () => {
  it.effect('places both halves of a door and reports the second in `alsoPlaced`', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[supportCell, STONE]]), ['0,0'])

      const outcome = yield* placeBlock(store.api, { position: target, heldItem: 'door' })

      expect(outcome).toStrictEqual({
        _tag: 'Placed',
        block: DOOR,
        consumed: 'door',
        chunk: { cx: 0, cz: 0 },
        alsoPlaced: [{ x: 4, y: 65, z: 4 }],
      })
      expect(yield* store.blockAt(target)).toBe(DOOR)
      expect(yield* store.blockAt({ x: 4, y: 65, z: 4 })).toBe(DOOR)
      // ONE ITEM, TWO CELLS. The second cell is the other half of the same
      // object rather than a second placement.
      expect(outcome._tag === 'Placed' && outcome.consumed).toBe('door')
    }),
  )

  it.effect('refuses a door with no room above, and writes NOTHING — not even the lower half', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(
        world([
          [supportCell, STONE],
          [{ x: 4, y: 65, z: 4 }, STONE],
        ]),
        ['0,0'],
      )

      expect(yield* placeBlock(store.api, { position: target, heldItem: 'door' })).toStrictEqual({
        _tag: 'NoRoomAbove',
      })
      // The gate runs BEFORE the write, so a refused placement cannot leave
      // half a door standing.
      expect((yield* store.calls).writes).toBe(0)
      expect(yield* store.blockAt(target)).toBeUndefined()
    }),
  )

  it.effect('a mushroom refused by light, through placeBlock', () =>
    Effect.gen(function* () {
      const bright = yield* makeChunkStoreDouble(
        world([[supportCell, id('grass_block')]]),
        ['0,0'],
        lightWorld([[target, { sky: 13, block: 0 }]]),
      )
      const dim = yield* makeChunkStoreDouble(
        world([[supportCell, id('grass_block')]]),
        ['0,0'],
        lightWorld([[target, { sky: 12, block: 0 }]]),
      )
      const held = 'brown_mushroom'

      expect(yield* placeBlock(bright.api, { position: target, heldItem: held })).toStrictEqual({
        _tag: 'TooBright',
        light: 13,
      })
      // ...and one level darker it goes in, on the plantable ground its
      // `supportRule` requires. Both halves, so the refusal is a threshold
      // rather than a rule that refuses everything.
      expect((yield* placeBlock(dim.api, { position: target, heldItem: held }))._tag).toBe('Placed')
    }),
  )

  it.effect('sugar cane refused for want of water, through placeBlock', () =>
    Effect.gen(function* () {
      const dry = yield* makeChunkStoreDouble(world([[supportCell, SAND]]), ['0,0'])
      const wet = yield* makeChunkStoreDouble(
        world([
          [supportCell, SAND],
          [{ x: 5, y: 63, z: 4 }, WATER],
        ]),
        ['0,0'],
      )
      const held = 'sugar_cane'

      expect(yield* placeBlock(dry.api, { position: target, heldItem: held })).toStrictEqual({
        _tag: 'NoAdjacentWater',
      })
      expect((yield* placeBlock(wet.api, { position: target, heldItem: held }))._tag).toBe('Placed')
    }),
  )

  it.effect('a cactus refused for a blocked side, through placeBlock', () =>
    Effect.gen(function* () {
      const blocked = yield* makeChunkStoreDouble(
        world([
          [supportCell, SAND],
          [{ x: 5, y: 64, z: 4 }, STONE],
        ]),
        ['0,0'],
      )
      const clear = yield* makeChunkStoreDouble(world([[supportCell, SAND]]), ['0,0'])
      const held = 'cactus'

      expect(yield* placeBlock(blocked.api, { position: target, heldItem: held })).toStrictEqual({
        _tag: 'SidesBlocked',
      })
      expect((yield* placeBlock(clear.api, { position: target, heldItem: held }))._tag).toBe('Placed')
    }),
  )

  it.effect('a door whose upper write is lost reports the lower half only, and does not undo it', () =>
    Effect.gen(function* () {
      // The window between the read and the write, on the second cell. The two
      // available answers are a compensating write that can itself fail, or a
      // door with no top; the second is visible, breakable, and RECORDED —
      // `alsoPlaced` is empty, so a caller cannot mistake it for a whole door.
      const store = yield* makeChunkStoreDouble(world([[supportCell, STONE]]), ['0,0'])
      let writes = 0
      const dropsTheSecondWrite = {
        ...store.api,
        setBlock: (position: BlockPosition, blockId: BlockId) => {
          writes += 1
          return writes === 1
            ? store.api.setBlock(position, blockId)
            : Effect.succeed({ _tag: 'ChunkNotLoaded' } as const)
        },
      }

      const outcome = yield* placeBlock(dropsTheSecondWrite, { position: target, heldItem: 'door' })

      expect(outcome).toStrictEqual({
        _tag: 'Placed',
        block: DOOR,
        consumed: 'door',
        chunk: { cx: 0, cz: 0 },
        alsoPlaced: [],
      })
      // The lower half is still there: a refusal on the second cell is not a
      // reason to take the first one back.
      expect(yield* store.blockAt(target)).toBe(DOOR)
    }),
  )

  it.effect('costs an ordinary block nothing beyond its own read and write', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[supportCell, STONE]]), ['0,0'])

      yield* placeBlock(store.api, { position: target, heldItem: 'stone' })

      // Stone is not support-sensitive, is not a mushroom, is not sugar cane,
      // is not a cactus and is not a door: one read of the target, one write.
      // Four pure registry lookups and no store call is the whole cost argument
      // for putting the four rules on this path.
      expect(yield* store.calls).toStrictEqual({ reads: 1, writes: 1, peeks: 0 })
    }),
  )
})

describe('kernel 0.2.5 makes all ten support-sensitive plants placeable items', () => {
  const items: ReadonlyArray<string> = ITEM_TYPES
  const blocks: ReadonlyArray<string> = BLOCK_TYPES
  const plants: ReadonlyArray<PlaceableItemType> = [
    'sapling',
    'dandelion',
    'poppy',
    'brown_mushroom',
    'red_mushroom',
    'tall_grass',
    'fern',
    'sugar_cane',
    'cactus',
    'lily_pad',
  ]

  it('names every plant as both an item and a placeable block', () => {
    for (const name of plants) {
      expect(blocks).toContain(name)
      expect(items).toContain(name)
      expect(PLACEABLE_ITEM_TYPES).toContain(name)
      expect(isPlaceableItem(name)).toBe(true)
    }
  })

  it('the block-specific classifiers still recognise their registry ids', () => {
    expect(isMushroomBlock(BROWN_MUSHROOM)).toBe(true)
    expect(isSugarCaneBlock(SUGAR_CANE)).toBe(true)
    expect(isCactusBlock(CACTUS)).toBe(true)
  })
})
