import * as FastCheck from 'fast-check'
import { describe, expect, it } from '@effect/vitest'
import { BlockAxis, BlockId, blockPosition } from '@nerima-games/mc-kernel'
import { Effect, Result, Schema } from 'effect'
import * as gameplay from '../src/index'
import { makeGameplayStageFaults } from '../src/stages/gameplay-stage-faults.js'

describe('gameplay stage faults', () => {
  it.effect('exports schemas that reject arbitrary malformed input without throwing', () =>
    Effect.sync(() => {
      for (const schema of [
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
