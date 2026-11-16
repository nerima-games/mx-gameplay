import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { AIR_BLOCK_ID } from '@nerima-games/mc-kernel'
import { ChunkStore } from '@nerima-games/mc-worldgen'
import { emptyWorldStoreLayer, STONE } from './support/chunk-store-double.js'
import { blockPosition } from './support/coordinate-fixtures.js'

it.effect('builds an independent empty store for each test layer provision', () =>
  Effect.gen(function* () {
    const position = blockPosition(1, 64, 1)
    const write = Effect.gen(function* () {
      const store = yield* ChunkStore
      expect(yield* store.setBlock(position, STONE)).toMatchObject({ _tag: 'Written' })
      expect(yield* store.getBlock(position)).toStrictEqual({ _tag: 'Block', block: STONE })
    }).pipe(Effect.provide(emptyWorldStoreLayer))
    const read = Effect.gen(function* () {
      const store = yield* ChunkStore
      return yield* store.getBlock(position)
    }).pipe(Effect.provide(emptyWorldStoreLayer))

    yield* write
    expect(yield* read).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
  }),
)
