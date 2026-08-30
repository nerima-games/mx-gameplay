import { Effect } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition, type ChunkStoreApi } from '../chunk-store-port.js'

export const TNT_BLOCK_ID: BlockId | undefined = blockIdOf('tnt')

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
    /* v8 ignore start -- UnknownBlock is unreachable in a green tree: `tnt` is
     * one of the 120 `BlockType`s kernel's own type declaration pins
     * `blockIdOf` total over, so `TNT_BLOCK_ID` — computed once at module load —
     * is never `undefined`. Kept for the reason `./place-block.ts`'s own
     * `UnknownBlock` arm is: it fails toward a NAMED refusal rather than TNT
     * silently never igniting. */
    if (TNT_BLOCK_ID === undefined) return { _tag: 'UnknownBlock' }
    /* v8 ignore stop */

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
