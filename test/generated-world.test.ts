import { describe, expect, it } from '@effect/vitest'
import { surfaceHeightAt } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import { makeGeneratedWorld } from '../domain/in-memory-world'
import type { MobBehaviour } from '../domain/entities/mob-frame'

const SEED = 424242

describe('generated world composition', () => {
  it.effect('shares generated chunks, writes, and dirty notifications through one store', () =>
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
})
