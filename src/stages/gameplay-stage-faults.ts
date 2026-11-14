import type {
  BlockId,
  BlockPosition,
} from '@nerima-games/mc-kernel'
import type { BlockStateCodecFailure, LightQueueUnderflowError } from '@nerima-games/mc-worldgen'
import { Brand, Context, Effect, Layer, Ref, Schema } from 'effect'

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

export type GameplayStageFaultOccurrenceCount = number & Brand.Brand<'GameplayStageFaultOccurrenceCount'>
const gameplayStageFaultOccurrenceCountSchema: Schema.Codec<GameplayStageFaultOccurrenceCount, number> =
  Schema.Int
    .check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
    .pipe(Schema.brand('GameplayStageFaultOccurrenceCount'))

export type GameplayStageWorldFault = Readonly<{
  _tag: 'WorldDataFailure'
  operation: 'DecodeBlockType' | 'ReadBlock' | 'ReadBlockState' | 'WriteBlock' | 'ReadLight'
  position: BlockPosition
  reason: GameplayStageWorldFaultReason
  occurrences: GameplayStageFaultOccurrenceCount
}>

export type GameplayStageWorldFaultInput = Omit<GameplayStageWorldFault, 'occurrences'>

export type GameplayStageItemUseWorldFailure =
  | Readonly<{
      _tag: 'WorldDataFailed'
      reason: GameplayStageBlockTypeDecodeFailure | GameplayStageMissingBlockReadFailure
    }>
  | Readonly<{
      _tag: 'WorldUnavailable'
      position: BlockPosition
      state: 'ChunkNotLoaded' | 'OutOfWorld'
    }>

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
      : fault.reason._tag === 'BlockTypeDecodeFailed'
        ? String(fault.reason.block)
        : fault.reason._tag
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
        occurrences: Schema.decodeUnknownSync(gameplayStageFaultOccurrenceCountSchema)(
          (previous?.occurrences ?? 0) + 1,
        ),
      })
      return next
    }),
    drain: Ref.modify(faults, (current) => [Array.from(current.values()), new Map()]),
  }
})

export const GameplayStageFaultsLayer: Layer.Layer<GameplayStageFaults> =
  Layer.effect(GameplayStageFaults, makeGameplayStageFaults)
