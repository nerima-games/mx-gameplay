import type {
  BlockId,
  BlockPosition,
  BlockRegistryResolutionFailure,
} from '@nerima-games/mc-kernel'
import type { BlockStateCodecFailure, LightQueueUnderflowError } from '@nerima-games/mc-worldgen'
import { Context, Effect, Layer, Ref } from 'effect'

export type GameplayStageBlockTypeDecodeFailure = Readonly<{
  _tag: 'BlockTypeDecodeFailed'
  position: BlockPosition
  block: BlockId
  failure: BlockRegistryResolutionFailure | Readonly<{ _tag: 'UnregisteredBlockId' }>
}>

export type GameplayStageWorldFaultReason =
  | GameplayStageBlockTypeDecodeFailure
  | BlockStateCodecFailure
  | LightQueueUnderflowError

export type GameplayStageWorldFault = Readonly<{
  _tag: 'WorldDataFailure'
  operation: 'DecodeBlockType' | 'ReadBlockState' | 'WriteBlock' | 'ReadLight'
  position: BlockPosition
  reason: GameplayStageWorldFaultReason
  occurrences: number
}>

export type GameplayStageWorldFaultInput = Omit<GameplayStageWorldFault, 'occurrences'>

export type GameplayStageFaultsApi = Readonly<{
  record: (fault: GameplayStageWorldFaultInput) => Effect.Effect<void>
  drain: Effect.Effect<ReadonlyArray<GameplayStageWorldFault>>
}>

export type GameplayStageFaults = GameplayStageFaultsApi
export const GameplayStageFaults: Context.Service<GameplayStageFaults, GameplayStageFaultsApi> = Context.Service<
  GameplayStageFaults,
  GameplayStageFaultsApi
>(
  '@nerima-games/mx-gameplay/GameplayStageFaults',
)

const faultKey = (fault: GameplayStageWorldFaultInput): string => {
  const position = `${fault.position.x},${fault.position.y},${fault.position.z}`
  const reason = fault.reason._tag === 'BlockStateCodecFailure'
    ? fault.reason.reason
    : fault.reason._tag === 'LightQueueUnderflowError'
      ? String(fault.reason.index)
      : `${String(fault.reason.block)}:${fault.reason.failure._tag}:${'reason' in fault.reason.failure ? fault.reason.failure.reason : ''}`
  return `${fault.operation}:${position}:${fault.reason._tag}:${reason}`
}

export const makeGameplayStageFaults: Effect.Effect<GameplayStageFaultsApi> = Effect.gen(function* () {
  const faults = yield* Ref.make<ReadonlyMap<string, GameplayStageWorldFault>>(new Map())

  return {
    record: (fault) => Ref.update(faults, (current) => {
      const key = faultKey(fault)
      const previous = current.get(key)
      const next = new Map(current)
      next.set(key, {
        ...fault,
        occurrences: (previous?.occurrences ?? 0) + 1,
      })
      return next
    }),
    drain: Ref.modify(faults, (current) => [Array.from(current.values()), new Map()]),
  }
})

export const GameplayStageFaultsLayer: Layer.Layer<GameplayStageFaults> =
  Layer.effect(GameplayStageFaults, makeGameplayStageFaults)
