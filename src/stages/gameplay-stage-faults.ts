import type {
  BlockId,
  BlockPosition,
  BlockRegistryResolutionFailure,
} from '@nerima-games/mc-kernel'
import { BlockIdSchema, BlockPositionSchema } from '@nerima-games/mc-kernel'
import type { BlockStateCodecFailure, LightQueueUnderflowError } from '@nerima-games/mc-worldgen'
import { Brand, Context, Effect, Layer, Ref, Schema } from 'effect'

export type GameplayStageBlockTypeDecodeFailure = Readonly<{
  _tag: 'BlockTypeDecodeFailed'
  position: BlockPosition
  block: BlockId
  failure: BlockRegistryResolutionFailure | Readonly<{ _tag: 'UnregisteredBlockId' }>
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
export const GameplayStageFaultOccurrenceCountSchema: Schema.Codec<GameplayStageFaultOccurrenceCount, number> =
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

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const hasStringFields = (
  value: Readonly<Record<string, unknown>>,
  fields: ReadonlyArray<string>,
): boolean => fields.every((field) => typeof value[field] === 'string')

const isBlockRegistryResolutionFailure = (value: unknown): value is BlockRegistryResolutionFailure => {
  if (!isRecord(value)) return false
  if (typeof value['_tag'] !== 'string') return false

  switch (value['_tag']) {
    case 'BlockDefinitionFailure':
      return ['unknown-field', 'invalid-shape'].includes(String(value['reason'])) && hasStringFields(value, ['message'])
    case 'BlockCapabilityFailure':
      return ['not-object', 'unknown-key', 'not-boolean', 'hostile-input'].includes(String(value['reason'])) &&
        hasStringFields(value, ['message'])
    case 'BlockPropertyFailure':
      return ['type', 'range', 'unknown-key'].includes(String(value['reason'])) && hasStringFields(value, ['message'])
    case 'BrandError':
      return hasStringFields(value, ['name', 'message']) && isRecord(value['issue'])
    default:
      return false
  }
}

const isGameplayStageBlockTypeDecodeFailure = (value: unknown): value is GameplayStageBlockTypeDecodeFailure =>
  isRecord(value) &&
  value['_tag'] === 'BlockTypeDecodeFailed' &&
  Schema.is(BlockPositionSchema)(value['position']) &&
  Schema.is(BlockIdSchema)(value['block']) &&
  (isBlockRegistryResolutionFailure(value['failure']) ||
    (isRecord(value['failure']) && value['failure']['_tag'] === 'UnregisteredBlockId'))

const isGameplayStageMissingBlockReadFailure = (value: unknown): value is GameplayStageMissingBlockReadFailure =>
  isRecord(value) &&
  value['_tag'] === 'MissingBlockReadResult' &&
  Schema.is(BlockPositionSchema)(value['position'])

const isBlockStateCodecFailure = (value: unknown): value is BlockStateCodecFailure =>
  isRecord(value) &&
  value['_tag'] === 'BlockStateCodecFailure' &&
  ['invalid-block-id', 'unknown-block-id', 'invalid-state', 'unsupported-property', 'invalid-property-value', 'invalid-encoded-value', 'reserved-code'].includes(String(value['reason']))

const isLightQueueUnderflowError = (value: unknown): value is LightQueueUnderflowError =>
  value instanceof Error &&
  isRecord(value) &&
  value['_tag'] === 'LightQueueUnderflowError' &&
  Number.isSafeInteger(value['index'])

const isGameplayStageWorldFaultReason = (value: unknown): value is GameplayStageWorldFaultReason =>
  isGameplayStageBlockTypeDecodeFailure(value) ||
  isGameplayStageMissingBlockReadFailure(value) ||
  isBlockStateCodecFailure(value) ||
  isLightQueueUnderflowError(value)

export const GameplayStageBlockTypeDecodeFailureSchema: Schema.Codec<
  GameplayStageBlockTypeDecodeFailure,
  GameplayStageBlockTypeDecodeFailure
> = Schema.declare(isGameplayStageBlockTypeDecodeFailure)

export const GameplayStageMissingBlockReadFailureSchema: Schema.Codec<
  GameplayStageMissingBlockReadFailure,
  GameplayStageMissingBlockReadFailure
> = Schema.declare(isGameplayStageMissingBlockReadFailure)

export const GameplayStageWorldFaultReasonSchema: Schema.Codec<
  GameplayStageWorldFaultReason,
  GameplayStageWorldFaultReason
> = Schema.declare(isGameplayStageWorldFaultReason)

export const GameplayStageWorldFaultInputSchema: Schema.Codec<
  GameplayStageWorldFaultInput,
  GameplayStageWorldFaultInput
> = Schema.declare((value): value is GameplayStageWorldFaultInput =>
  isRecord(value) &&
  value['_tag'] === 'WorldDataFailure' &&
  ['DecodeBlockType', 'ReadBlock', 'ReadBlockState', 'WriteBlock', 'ReadLight'].includes(String(value['operation'])) &&
  Schema.is(BlockPositionSchema)(value['position']) &&
  isGameplayStageWorldFaultReason(value['reason'])
)

export const GameplayStageWorldFaultSchema: Schema.Codec<
  GameplayStageWorldFault,
  GameplayStageWorldFault
> = Schema.declare((value): value is GameplayStageWorldFault =>
  isRecord(value) &&
  Schema.is(GameplayStageFaultOccurrenceCountSchema)(value['occurrences']) &&
  Schema.is(GameplayStageWorldFaultInputSchema)(value)
)

export const GameplayStageItemUseWorldFailureSchema: Schema.Codec<
  GameplayStageItemUseWorldFailure,
  GameplayStageItemUseWorldFailure
> = Schema.declare((value): value is GameplayStageItemUseWorldFailure => {
  if (!isRecord(value)) return false
  if (value['_tag'] === 'WorldDataFailed') {
    return isGameplayStageBlockTypeDecodeFailure(value['reason']) || isGameplayStageMissingBlockReadFailure(value['reason'])
  }
  return value['_tag'] === 'WorldUnavailable' &&
    Schema.is(BlockPositionSchema)(value['position']) &&
    (value['state'] === 'ChunkNotLoaded' || value['state'] === 'OutOfWorld')
})

const faultKey = (fault: GameplayStageWorldFaultInput): string => {
  const position = `${fault.position.x},${fault.position.y},${fault.position.z}`
  const reason = fault.reason._tag === 'BlockStateCodecFailure'
    ? fault.reason.reason
    : fault.reason._tag === 'LightQueueUnderflowError'
      ? String(fault.reason.index)
      : fault.reason._tag === 'BlockTypeDecodeFailed'
        ? `${String(fault.reason.block)}:${fault.reason.failure._tag}:${'reason' in fault.reason.failure ? fault.reason.failure.reason : ''}`
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
        occurrences: Schema.decodeUnknownSync(GameplayStageFaultOccurrenceCountSchema)(
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
