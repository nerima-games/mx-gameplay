import { describe, expect, it } from '@effect/vitest'
import { BlockAxis, BlockId, blockPosition } from '@nerima-games/mc-kernel'
import { LightQueueUnderflowError } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import { makeGameplayStageFaults, type GameplayStageWorldFaultInput } from '../src/stages/gameplay-stage-faults.js'

describe('gameplay stage faults', () => {
  it.effect('keeps distinct world-fault records separate', () =>
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
          operation: 'DecodeBlockType',
          position,
          reason: {
            _tag: 'BlockTypeDecodeFailed',
            position,
            block: BlockId(2),
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
