import { describe, expect, it } from '@effect/vitest'
import { InventoryService, craftGrid } from '@nerima-games/mc-sim'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  emptyBlocks,
  surfaceHeightAt,
  type ChunkSource,
} from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import { makeGeneratedWorld, solidityFromStore } from '../src/domain/in-memory-world'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'

const SEED = 424242

describe('generated world composition', () => {
  it.effect('uses generated chunks by default and shares writes and dirty notifications', () =>
    Effect.gen(function* () {
      const world = yield* makeGeneratedWorld<MobBehaviour>({ seed: SEED, spawnX: 0.5, spawnZ: 0.5 })
      const dirty = yield* world.chunkStore.subscribeDirty
      const surfaceY = surfaceHeightAt(SEED, 0, 0)

      expect((yield* world.player.pose).feetPosition).toStrictEqual({ x: 0.5, y: surfaceY + 1, z: 0.5 })

      yield* world.chunkStore.load({ cx: 0, cz: 0 })
      expect((yield* dirty.drain).changed).toStrictEqual([{ cx: 0, cz: 0 }])
      expect(yield* world.chunkStore.getBlock({ x: 0, y: surfaceY, z: 0 })).toMatchObject({ _tag: 'Block' })

      const write = yield* world.chunkStore.setBlock({ x: 0, y: surfaceY, z: 0 }, 0)
      expect(write._tag).toBe('Written')
      expect(yield* world.chunkStore.getBlock({ x: 0, y: surfaceY, z: 0 })).toStrictEqual({
        _tag: 'Block',
        block: 0,
      })
      expect((yield* dirty.drain).changed).toStrictEqual([{ cx: 0, cz: 0 }])
    }),
  )

  it.effect('uses an injected chunk source instead of generated terrain', () =>
    Effect.gen(function* () {
      const loaded: Array<{ readonly cx: number; readonly cz: number }> = []
      const chunkSource: ChunkSource = (coord) =>
        Effect.sync(() => {
          loaded.push({ cx: coord.cx, cz: coord.cz })
          return {
            coord,
            blocks: emptyBlocks(),
            biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
          }
        })
      const world = yield* makeGeneratedWorld<MobBehaviour>({ seed: SEED, chunkSource })

      yield* world.chunkStore.load({ cx: 0, cz: 0 })

      expect(loaded).toStrictEqual([{ cx: 0, cz: 0 }])
      expect(yield* world.chunkStore.getBlock({ x: 0, y: 0, z: 0 })).toStrictEqual({
        _tag: 'Block',
        block: 0,
      })
    }),
  )

  it.effect('uses kernel passability for generated block collision', () =>
    Effect.gen(function* () {
      const world = yield* makeGeneratedWorld<MobBehaviour>({ seed: 20260728 })
      yield* world.chunkStore.load({ cx: 0, cz: 0 })
      const isSolid = solidityFromStore(world.chunkStore)

      expect(isSolid({ x: 0, y: 60, z: 0 })).toBe(false) // water
      expect(isSolid({ x: 0, y: 59, z: 0 })).toBe(true) // sand
    }),
  )

  it.effect('defaults to seed 8675309 when none is provided', () =>
    Effect.gen(function* () {
      const world = yield* makeGeneratedWorld<MobBehaviour>({})
      const defaultSurfaceY = surfaceHeightAt(8675309, 0, 0)

      expect((yield* world.player.pose).feetPosition).toStrictEqual({
        x: 0.5,
        y: defaultSurfaceY + 1,
        z: 0.5,
      })
    }),
  )

  it.effect('treats an unloaded chunk as solid, not as air', () =>
    Effect.gen(function* () {
      const world = yield* makeGeneratedWorld<MobBehaviour>({ seed: SEED })
      const isSolid = solidityFromStore(world.chunkStore)

      // Chunk (0,0) is never loaded in this test, so the read is ChunkNotLoaded.
      expect(isSolid({ x: 0, y: 64, z: 0 })).toBe(true)
    }),
  )

  it.effect('treats a position outside the build height as solid', () =>
    Effect.gen(function* () {
      const world = yield* makeGeneratedWorld<MobBehaviour>({ seed: SEED })
      yield* world.chunkStore.load({ cx: 0, cz: 0 })
      const isSolid = solidityFromStore(world.chunkStore)

      expect(isSolid({ x: 0, y: -1, z: 0 })).toBe(true) // below bedrock
      expect(isSolid({ x: 0, y: CHUNK_HEIGHT, z: 0 })).toBe(true) // above the build limit
    }),
  )

  it.effect('adapts peek, snapshot, isLoaded, neighbours, unload and getLight, coordinate-branded', () =>
    Effect.gen(function* () {
      // The other tests in this file only exercise `load`, `getBlock` and
      // `setBlock` on the adapted store — this is the one that reaches every
      // remaining member `adaptGeneratedChunkStore` wraps.
      const world = yield* makeGeneratedWorld<MobBehaviour>({ seed: SEED })
      const coord = { cx: 0, cz: 0 }
      const eastCoord = { cx: 1, cz: 0 }

      expect(yield* world.chunkStore.isLoaded(coord)).toBe(false)
      expect(yield* world.chunkStore.peek(coord)).toBeUndefined()
      expect(yield* world.chunkStore.snapshot(coord)).toBeUndefined()

      yield* world.chunkStore.load(coord)
      yield* world.chunkStore.load(eastCoord)

      expect(yield* world.chunkStore.isLoaded(coord)).toBe(true)
      const peeked = yield* world.chunkStore.peek(coord)
      expect(peeked?.coord).toStrictEqual(coord)
      const snapshotted = yield* world.chunkStore.snapshot(coord)
      expect(snapshotted?.coord).toStrictEqual(coord)

      const neighbours = yield* world.chunkStore.neighbours(coord)
      expect(neighbours.xPos?.coord).toStrictEqual(eastCoord)
      expect(neighbours.xNeg).toBeUndefined()

      const light = yield* world.chunkStore.getLight({ x: 0, y: 100, z: 0 })
      expect(light._tag).toBe('Light')
      const unloadedLight = yield* world.chunkStore.getLight({ x: 500, y: 100, z: 500 })
      expect(unloadedLight).toStrictEqual({ _tag: 'ChunkNotLoaded' })

      expect(yield* world.chunkStore.unload(coord)).toBe(true)
      expect(yield* world.chunkStore.isLoaded(coord)).toBe(false)
    }),
  )

  it.effect('shares recipe-enabled inventory between the world handle and layer', () =>
    Effect.gen(function* () {
      const world = yield* makeGeneratedWorld<MobBehaviour>({ seed: SEED })
      const inventoryFromLayer = yield* InventoryService.pipe(Effect.provide(world.layer))
      const grid = craftGrid(1, 1, ['oak_log'])

      expect(inventoryFromLayer).toBe(world.inventory)
      yield* world.inventory.add('oak_log', 1)
      expect((yield* inventoryFromLayer.previewCraft(grid))._tag).toBe('Match')
      expect((yield* inventoryFromLayer.craft(grid))._tag).toBe('Crafted')
      expect(yield* world.inventory.countOf('oak_log')).toBe(0)
      expect(yield* world.inventory.countOf('oak_planks')).toBe(4)
    }),
  )
})
