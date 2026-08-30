import { Effect } from 'effect'
import type { BlockType } from '@nerima-games/mc-kernel'
import type { BlockPosition } from '../chunk-store-port.js'

export const BONE_MEAL_CROPS: ReadonlyArray<BlockType> = ['wheat_crop', 'potato_crop', 'nether_wart_crop']

export type BoneMealOutcome =
  | { readonly _tag: 'applied'; readonly at: BlockPosition }
  | { readonly _tag: 'notCrop'; readonly at: BlockPosition; readonly block: BlockType | undefined }

export const applyBoneMeal = (
  blockAt: (position: BlockPosition) => Effect.Effect<BlockType | undefined>,
  position: BlockPosition,
): Effect.Effect<BoneMealOutcome> =>
  Effect.map(blockAt(position), (block) =>
    BONE_MEAL_CROPS.some((crop) => crop === block)
      ? { _tag: 'applied', at: position }
      : { _tag: 'notCrop', at: position, block },
  )
