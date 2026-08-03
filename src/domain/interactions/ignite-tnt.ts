import { Effect } from 'effect'
import { blockIdOf } from '../block-vocabulary'
import { AIR_BLOCK_ID, type BlockPosition, type ChunkStoreApi } from '../chunk-store-port'

export const TNT_BLOCK_ID = blockIdOf('tnt')

export type IgniteTntOutcome =
  | { readonly _tag: 'Lit' }
  | { readonly _tag: 'NotTnt' }
  | { readonly _tag: 'ChunkNotLoaded' }
  | { readonly _tag: 'OutOfWorld' }
  | { readonly _tag: 'UnknownBlock' }
  | { readonly _tag: 'ChangedBeforeWrite' }

export const igniteTnt = (
  store: ChunkStoreApi,
  position: BlockPosition,
): Effect.Effect<IgniteTntOutcome> =>
  Effect.gen(function* () {
    if (TNT_BLOCK_ID === undefined) return { _tag: 'UnknownBlock' }

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
