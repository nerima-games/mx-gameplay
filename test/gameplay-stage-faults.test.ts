import * as FastCheck from 'fast-check'
import { describe, expect, it } from '@effect/vitest'
import { BlockAxis, BlockId, blockPosition } from '@nerima-games/mc-kernel'
import { LightQueueUnderflowError } from '@nerima-games/mc-worldgen'
import { Effect, Result, Schema } from 'effect'
import * as gameplay from '../src/index'
import { makeGameplayStageFaults, type GameplayStageWorldFaultInput } from '../src/stages/gameplay-stage-faults.js'

describe('gameplay stage faults', () => {
  it.effect('exports schemas that reject arbitrary malformed input without throwing', () =>
    Effect.sync(() => {
      for (const schema of [
        gameplay.GameplayStageFaultOccurrenceCountSchema,
        gameplay.GameplayStageBlockTypeDecodeFailureSchema,
        gameplay.GameplayStageMissingBlockReadFailureSchema,
        gameplay.GameplayStageWorldFaultReasonSchema,
        gameplay.GameplayStageWorldFaultInputSchema,
        gameplay.GameplayStageWorldFaultSchema,
        gameplay.GameplayStageItemUseWorldFailureSchema,
      ]) {
        FastCheck.assert(FastCheck.property(FastCheck.anything(), (input: unknown) => {
          const decoded = Schema.decodeUnknownResult(schema)(input)
          return Result.isFailure(decoded) || Schema.is(schema)(decoded.success)
        }))
      }
    }),
  )

  it.effect('accepts the 16-bit block ID ceiling and rejects invalid IDs and fault counts', () =>
    Effect.sync(() => {
      const position = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
      const fault = {
        _tag: 'WorldDataFailure',
        operation: 'DecodeBlockType',
        position,
        reason: {
          _tag: 'BlockTypeDecodeFailed',
          position,
          block: BlockId(65535),
          failure: { _tag: 'UnregisteredBlockId' },
        },
      }

      expect(Schema.is(gameplay.GameplayStageWorldFaultInputSchema)(fault)).toBe(true)
      expect(Schema.is(gameplay.GameplayStageWorldFaultInputSchema)({
        ...fault,
        reason: { ...fault.reason, block: 65536 },
      })).toBe(false)
      expect(Schema.is(gameplay.GameplayStageWorldFaultSchema)({ ...fault, occurrences: 1 })).toBe(true)
      expect(Schema.is(gameplay.GameplayStageWorldFaultSchema)({ ...fault, occurrences: 0 })).toBe(false)
      expect(Schema.is(gameplay.GameplayStageWorldFaultSchema)({ ...fault, occurrences: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)
      expect(Schema.is(gameplay.GameplayStageWorldFaultSchema)({ ...fault, occurrences: Number.MAX_SAFE_INTEGER })).toBe(true)
    }),
  )

  it.effect('accepts public registry failures and both item-use world-data reasons', () =>
    Effect.sync(() => {
      const position = blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1))
      const invalidId = BlockId.result(65536)
      if (Result.isSuccess(invalidId)) throw new Error('The block ID limit must reject 65536')

      const registryFailures = [
        { _tag: 'BlockDefinitionFailure', reason: 'unknown-field', message: 'unknown definition key' },
        { _tag: 'BlockCapabilityFailure', reason: 'not-object', message: 'capabilities must be an object' },
        { _tag: 'BlockPropertyFailure', reason: 'type', message: 'opacity must be numeric' },
        invalidId.failure,
      ]
      for (const failure of registryFailures) {
        expect(Schema.is(gameplay.GameplayStageBlockTypeDecodeFailureSchema)({
          _tag: 'BlockTypeDecodeFailed',
          position,
          block: BlockId(1),
          failure,
        })).toBe(true)
      }

      for (const failure of [
        null,
        {},
        { _tag: 'UnrelatedFailure' },
        { _tag: 'BlockDefinitionFailure', reason: 'unknown-reason', message: 'bad definition' },
        { _tag: 'BlockDefinitionFailure', reason: 'unknown-field' },
        { _tag: 'BlockCapabilityFailure', reason: 'unknown-reason', message: 'bad capability' },
        { _tag: 'BlockCapabilityFailure', reason: 'not-object' },
        { _tag: 'BlockPropertyFailure', reason: 'unknown-reason', message: 'bad property' },
        { _tag: 'BlockPropertyFailure', reason: 'type' },
        { _tag: 'BrandError', name: 'BlockId', message: 'invalid ID', issue: null },
      ]) {
        expect(Schema.is(gameplay.GameplayStageBlockTypeDecodeFailureSchema)({
          _tag: 'BlockTypeDecodeFailed',
          position,
          block: BlockId(1),
          failure,
        })).toBe(false)
      }

      const decodeFailure = {
        _tag: 'BlockTypeDecodeFailed',
        position,
        block: BlockId(1),
        failure: { _tag: 'UnregisteredBlockId' },
      }
      const missingRead = { _tag: 'MissingBlockReadResult', position }
      expect(Schema.is(gameplay.GameplayStageItemUseWorldFailureSchema)({
        _tag: 'WorldDataFailed',
        reason: decodeFailure,
      })).toBe(true)
      expect(Schema.is(gameplay.GameplayStageItemUseWorldFailureSchema)({
        _tag: 'WorldDataFailed',
        reason: missingRead,
      })).toBe(true)
      expect(Schema.is(gameplay.GameplayStageMissingBlockReadFailureSchema)({
        _tag: 'MissingBlockReadResult',
        position: null,
      })).toBe(false)
      expect(Schema.is(gameplay.GameplayStageItemUseWorldFailureSchema)({
        _tag: 'WorldDataFailed',
        reason: null,
      })).toBe(false)
      expect(Schema.is(gameplay.GameplayStageItemUseWorldFailureSchema)({
        _tag: 'WorldUnavailable',
        position,
        state: 'ChunkNotLoaded',
      })).toBe(true)
      expect(Schema.is(gameplay.GameplayStageItemUseWorldFailureSchema)({
        _tag: 'WorldUnavailable',
        position,
        state: 'OutOfWorld',
      })).toBe(true)
      expect(Schema.is(gameplay.GameplayStageItemUseWorldFailureSchema)({
        _tag: 'WorldUnavailable',
        position,
        state: 'Unknown',
      })).toBe(false)

      expect(Schema.is(gameplay.GameplayStageWorldFaultReasonSchema)({
        _tag: 'BlockStateCodecFailure',
        reason: 'unknown-block-id',
      })).toBe(true)
      expect(Schema.is(gameplay.GameplayStageWorldFaultReasonSchema)({
        _tag: 'BlockStateCodecFailure',
        reason: 'not-a-codec-reason',
      })).toBe(false)
      expect(Schema.is(gameplay.GameplayStageWorldFaultReasonSchema)(new LightQueueUnderflowError({ index: 2 }))).toBe(true)
      expect(Schema.is(gameplay.GameplayStageWorldFaultReasonSchema)({
        _tag: 'LightQueueUnderflowError',
        index: 2,
      })).toBe(false)
      expect(Schema.is(gameplay.GameplayStageWorldFaultReasonSchema)(new LightQueueUnderflowError({ index: 2.5 }))).toBe(false)
      const functionWithErrorPrototype = Object.assign(() => undefined, {
        _tag: 'LightQueueUnderflowError',
        index: 2,
      })
      Object.setPrototypeOf(functionWithErrorPrototype, Error.prototype)
      expect(functionWithErrorPrototype instanceof Error).toBe(true)
      expect(Schema.is(gameplay.GameplayStageWorldFaultReasonSchema)(functionWithErrorPrototype)).toBe(false)
    }),
  )

  it.effect('keys each public world-fault reason without losing its distinct identity', () =>
    Effect.gen(function* () {
      const faults = yield* makeGameplayStageFaults
      const position = blockPosition(BlockAxis(2), BlockAxis(64), BlockAxis(3))
      const inputs: ReadonlyArray<GameplayStageWorldFaultInput> = [
        {
          _tag: 'WorldDataFailure',
          operation: 'ReadBlockState',
          position,
          reason: { _tag: 'BlockStateCodecFailure', reason: 'unknown-block-id' },
        },
        {
          _tag: 'WorldDataFailure',
          operation: 'ReadLight',
          position,
          reason: new LightQueueUnderflowError({ index: 4 }),
        },
        {
          _tag: 'WorldDataFailure',
          operation: 'DecodeBlockType',
          position,
          reason: {
            _tag: 'BlockTypeDecodeFailed',
            position,
            block: BlockId(1),
            failure: { _tag: 'UnregisteredBlockId' },
          },
        },
        {
          _tag: 'WorldDataFailure',
          operation: 'ReadBlock',
          position,
          reason: { _tag: 'MissingBlockReadResult', position },
        },
      ]

      for (const fault of inputs) yield* faults.record(fault)

      expect((yield* faults.drain).map(({ reason }) => reason._tag)).toStrictEqual([
        'BlockStateCodecFailure',
        'LightQueueUnderflowError',
        'BlockTypeDecodeFailed',
        'MissingBlockReadResult',
      ])
    }),
  )

  it.effect('deduplicates equal faults by occurrence count and clears them on drain', () =>
    Effect.gen(function* () {
      const faults = yield* makeGameplayStageFaults
      const position = blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1))
      const reason = {
        _tag: 'BlockTypeDecodeFailed' as const,
        position,
        block: BlockId(250),
        failure: { _tag: 'UnregisteredBlockId' as const },
      }
      const fault = {
        _tag: 'WorldDataFailure' as const,
        operation: 'DecodeBlockType' as const,
        position,
        reason,
      }

      yield* faults.record(fault)
      yield* faults.record(fault)
      const drained = yield* faults.drain
      const empty = yield* faults.drain
      expect(drained).toStrictEqual([{ ...fault, occurrences: 2 }])
      expect(empty).toStrictEqual([])
    }),
  )
})
