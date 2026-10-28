import { Effect, Option } from 'effect'
import { AIR_BLOCK_ID, blockIdOf, type BlockId, type BlockPosition } from '@nerima-games/mc-kernel'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'

export const TNT_BLOCK_ID: BlockId = Option.getOrThrow(blockIdOf('tnt'))

export type IgniteTntOutcome =
  | { readonly _tag: 'Lit' }
  | { readonly _tag: 'NotTnt' }
  | { readonly _tag: 'ChunkNotLoaded' }
  | { readonly _tag: 'OutOfWorld' }
  | { readonly _tag: 'ChangedBeforeWrite' }

export const igniteTnt = (
  store: ChunkStoreApi,
  position: BlockPosition,
): Effect.Effect<IgniteTntOutcome> =>
  Effect.gen(function* () {
    const target = yield* store.getBlock(position)
    if (target._tag !== 'Block') return target
    if (target.block !== TNT_BLOCK_ID) return { _tag: 'NotTnt' }

    const write = yield* store.setBlock(position, AIR_BLOCK_ID)
    if (write._tag === 'ChunkNotLoaded' || write._tag === 'OutOfWorld') return write
    if (write._tag !== 'Written' || write.previous !== TNT_BLOCK_ID) {
      return { _tag: 'ChangedBeforeWrite' }
    }
    return { _tag: 'Lit' }
  })
