import { describe, expect, it } from '@effect/vitest'
import { BlockId } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import {
  makeInMemoryWorld,
  solidityFromStore,
  targetabilityFromStore,
} from '../src/domain/in-memory-world'
import { blockPosition, chunkCoord } from './support/coordinate-fixtures'

describe('in-memory world input boundaries', () => {
  it.effect('ignores malformed saved cell and loaded-chunk keys', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: {
          blocks: new Map([
            ['0,0,0', BlockId(2)],
            ['1,2,0.5', BlockId(3)],
          ]),
          loaded: ['0,0', '0,9007199254740992'],
        },
      })

      expect(yield* world.chunkStore.isLoaded(chunkCoord(0, 0))).toBe(true)
      expect(yield* world.chunkStore.getBlock(blockPosition(0, 0, 0))).toStrictEqual({
        _tag: 'Block',
        block: 2,
      })
      expect(yield* world.chunkStore.getBlock(blockPosition(1, 2, 0))).toStrictEqual({
        _tag: 'Block',
        block: 0,
      })
    }),
  )

  it.effect('treats invalid block coordinates as solid and untargetable', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: {
          blocks: new Map([['0,0,0', BlockId(2)]]),
          loaded: ['0,0'],
        },
      })
      const isSolid = solidityFromStore(world.chunkStore)
      const isTargetable = targetabilityFromStore(world.chunkStore)

      expect(isSolid({ x: Number.NaN, y: 0, z: 0 })).toBe(true)
      expect(isTargetable(Number.NaN, 0, 0)).toBe(false)
      expect(isTargetable(0, 0, 0)).toBe(true)
    }),
  )
})
