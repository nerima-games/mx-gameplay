import { describe, expect, it } from '@effect/vitest'
import { BlockAxis, BlockId, blockPosition } from '@nerima-games/mc-kernel'
import { LightQueueUnderflowError } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import {
  drainGameplayEntityStageFaults,
  makeGameplayFrameState,
  recordGameplayEntityStageFault,
  type EntityStageFault,
} from '../src/stages/registration-core.js'

describe('gameplay stage faults', () => {
  it.effect('keeps distinct world-fault records separate', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const position = blockPosition(BlockAxis(2), BlockAxis(64), BlockAxis(3))
      const inputs: ReadonlyArray<EntityStageFault> = [
        {
          _tag: 'WorldDataFailure',
          source: 'FallingBlock',
          operation: 'ReadBlockState',
          position,
          reason: { _tag: 'BlockStateCodecFailure', reason: 'unknown-block-id' },
        },
        {
          _tag: 'WorldDataFailure',
          source: 'FallingBlock',
          operation: 'ReadBlockState',
          position,
          reason: { _tag: 'BlockStateCodecFailure', reason: 'invalid-state' },
        },
        {
          _tag: 'WorldDataFailure',
          source: 'Fire',
          operation: 'ReadLight',
          position,
          reason: new LightQueueUnderflowError({ index: 4 }),
        },
        {
          _tag: 'WorldDataFailure',
          source: 'Fire',
          operation: 'ReadLight',
          position,
          reason: new LightQueueUnderflowError({ index: 5 }),
        },
        {
          _tag: 'WorldDataFailure',
          source: 'MobSpawnSearch',
          operation: 'ReadLight',
          position,
          reason: new LightQueueUnderflowError({ index: 4 }),
        },
        {
          _tag: 'WorldDataFailure',
          source: 'Fire',
          operation: 'WriteBlock',
          position,
          reason: new LightQueueUnderflowError({ index: 4 }),
        },
        {
          _tag: 'WorldDataFailure',
          source: 'Fire',
          operation: 'ReadLight',
          position: blockPosition(BlockAxis(3), BlockAxis(64), BlockAxis(3)),
          reason: new LightQueueUnderflowError({ index: 4 }),
        },
        {
          _tag: 'WorldDataFailure',
          source: 'Portal',
          operation: 'DecodeBlockType',
          position,
          reason: {
            _tag: 'BlockTypeDecodeFailed',
            position,
            block: BlockId(65_534),
            failure: { _tag: 'UnregisteredBlockId' },
          },
        },
        {
          _tag: 'WorldDataFailure',
          source: 'Portal',
          operation: 'DecodeBlockType',
          position,
          reason: {
            _tag: 'BlockTypeDecodeFailed',
            position,
            block: BlockId(65_535),
            failure: { _tag: 'UnregisteredBlockId' },
          },
        },
        {
          _tag: 'WorldDataFailure',
          source: 'ItemUse',
          operation: 'ReadBlock',
          position,
          reason: { _tag: 'MissingBlockReadResult', position },
        },
      ]

      for (const fault of inputs) yield* recordGameplayEntityStageFault(state, fault)

      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual(inputs)
    }),
  )

  it.effect('records an equal source, operation, target and reason once, including after drain', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const position = blockPosition(BlockAxis(1), BlockAxis(64), BlockAxis(1))
      const fault: EntityStageFault = {
        _tag: 'WorldDataFailure',
        source: 'Portal',
        operation: 'DecodeBlockType',
        position,
        reason: {
          _tag: 'BlockTypeDecodeFailed',
          position,
          block: BlockId(250),
          failure: { _tag: 'UnregisteredBlockId' },
        },
      }

      yield* recordGameplayEntityStageFault(state, fault)
      yield* recordGameplayEntityStageFault(state, { ...fault })
      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual([fault])
      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual([])
      yield* recordGameplayEntityStageFault(state, { ...fault })
      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual([])
    }),
  )
})
