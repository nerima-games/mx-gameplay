import { describe, expect, it } from '@effect/vitest'
import {
  CHUNK_SIZE_XZ,
  emptyBlocks,
  surfaceHeightAt,
  type ChunkSource,
} from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import { makeGeneratedWorld, solidityFromStore } from '../domain/in-memory-world'
import type { MobBehaviour } from '../domain/entities/mob-frame'

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
})
