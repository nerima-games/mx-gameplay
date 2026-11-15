import type {
  BlockId,
  BlockPosition,
} from '@nerima-games/mc-kernel'
import type { BlockStateCodecFailure, LightQueueUnderflowError } from '@nerima-games/mc-worldgen'

export type GameplayStageBlockTypeDecodeFailure = Readonly<{
  _tag: 'BlockTypeDecodeFailed'
  position: BlockPosition
  block: BlockId
  failure: Readonly<{ _tag: 'UnregisteredBlockId' }>
}>

export type GameplayStageWorldFaultReason =
  | GameplayStageBlockTypeDecodeFailure
  | GameplayStageMissingBlockReadFailure
  | BlockStateCodecFailure
  | LightQueueUnderflowError

export type GameplayStageMissingBlockReadFailure = Readonly<{
  _tag: 'MissingBlockReadResult'
  position: BlockPosition
}>

export type GameplayStageItemUseWorldFailure = Readonly<{
  _tag: 'WorldDataFailed'
  reason: GameplayStageBlockTypeDecodeFailure | GameplayStageMissingBlockReadFailure
}>
