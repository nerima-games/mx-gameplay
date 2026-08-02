import { Effect } from 'effect'
import type { BlockType } from '../block-vocabulary'
import type { BlockPosition } from '../chunk-store-port'

export const BONE_MEAL_CROPS = [
  'wheat_crop',
  'potato_crop',
  'nether_wart_crop',
] as const satisfies ReadonlyArray<BlockType>

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
