import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Result, Schema } from 'effect'
import { AIR_BLOCK_ID, BlockAxis, BlockId, type BlockRegistryResolutionFailure } from '@nerima-games/mc-kernel'

const registryControl = vi.hoisted(() => ({
  mode: 'native' as 'native' | 'resolution-failure' | 'known-without-resolved-block' | 'type-resolution-failure' | 'known-without-resolved-type',
}))

vi.mock('@nerima-games/mc-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mc-kernel')>()
  const { Result: EffectResult } = await import('effect')
  const failure = {
    _tag: 'BlockPropertyFailure',
    reason: 'type',
    message: 'registry property resolution failed',
  } satisfies BlockRegistryResolutionFailure

  return {
    ...actual,
    isKnownBlockId: (blockId: Parameters<typeof actual.isKnownBlockId>[0]) =>
      registryControl.mode === 'known-without-resolved-block'
        ? EffectResult.succeed(true)
        : actual.isKnownBlockId(blockId),
    resolvedBlockOfId: (blockId: Parameters<typeof actual.resolvedBlockOfId>[0]) => {
      if (registryControl.mode === 'resolution-failure') return EffectResult.fail(failure)
      if (registryControl.mode === 'known-without-resolved-block') return EffectResult.succeed(undefined)
      return actual.resolvedBlockOfId(blockId)
    },
    blockTypeOfId: (blockId: Parameters<typeof actual.blockTypeOfId>[0]) => {
      if (registryControl.mode === 'type-resolution-failure') return EffectResult.fail(failure)
      if (registryControl.mode === 'known-without-resolved-type') return EffectResult.succeed(undefined)
      return actual.blockTypeOfId(blockId)
    },
  }
})

import { EntityWorldQueryFailureSchema, entityWorldBlockDataAt, entityWorldBlockTypeAt } from '../src/domain/entities/entity-world-cell.js'

const cell = { x: BlockAxis(0), y: BlockAxis(64), z: BlockAxis(0) }

describe('entity world block registry results', () => {
  beforeEach(() => {
    registryControl.mode = 'native'
  })

  it('preserves a kernel registry resolution failure as a typed query fault', () => {
    registryControl.mode = 'resolution-failure'

    expect(entityWorldBlockDataAt(cell, BlockId(1))).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'EntityWorldRegistryFailure',
        cell,
        failure: { _tag: 'BlockPropertyFailure', reason: 'type' },
      },
    })
  })

  it('rejects a missing resolved block even when the registry reports the id as known', () => {
    registryControl.mode = 'known-without-resolved-block'

    expect(entityWorldBlockDataAt(cell, BlockId(1))).toStrictEqual(Result.fail({
      _tag: 'EntityWorldUnregisteredBlockId',
      cell,
      blockId: BlockId(1),
    }))
  })

  it('preserves a block-type registry failure after block data resolves', () => {
    registryControl.mode = 'type-resolution-failure'

    expect(entityWorldBlockTypeAt(cell, AIR_BLOCK_ID)).toStrictEqual(Result.fail({
      _tag: 'EntityWorldRegistryFailure',
      cell,
      failure: { _tag: 'BlockPropertyFailure', reason: 'type', message: 'registry property resolution failed' },
    }))
  })

  it('rejects an absent block type after block data resolves', () => {
    registryControl.mode = 'known-without-resolved-type'

    expect(entityWorldBlockTypeAt(cell, AIR_BLOCK_ID)).toStrictEqual(Result.fail({
      _tag: 'EntityWorldUnregisteredBlockId',
      cell,
      blockId: AIR_BLOCK_ID,
    }))
  })

  it('decodes each tagged world-query fault, including each kernel registry failure', () => {
    const registryFailures = [
      { _tag: 'BrandError', issue: {}, message: 'invalid block id' },
      { _tag: 'BlockDefinitionFailure', reason: 'unknown-field', message: 'invalid definition' },
      { _tag: 'BlockCapabilityFailure', reason: 'hostile-input', message: 'invalid capability' },
      { _tag: 'BlockPropertyFailure', reason: 'range', message: 'invalid property' },
    ]
    const failures = [
      { _tag: 'EntityWorldWindowUnavailable', cell },
      { _tag: 'EntityWorldCorruptBuffer', cell, index: 1, length: 1 },
      ...registryFailures.map((failure) => ({ _tag: 'EntityWorldRegistryFailure', cell, failure })),
      { _tag: 'EntityWorldUnregisteredBlockId', cell, blockId: BlockId(65_535) },
      { _tag: 'EntityWorldInvalidCell', reason: 'not-block-coordinate', position: { x: 0, y: 64, z: 0 } },
    ]

    for (const failure of failures) {
      expect(Schema.decodeUnknownSync(EntityWorldQueryFailureSchema)(failure)).toEqual(failure)
    }
    expect(Result.isFailure(Schema.decodeUnknownResult(EntityWorldQueryFailureSchema)(null))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(EntityWorldQueryFailureSchema)({ _tag: 'EntityWorldUnregisteredBlockId', cell, blockId: -1 }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(EntityWorldQueryFailureSchema)({
      _tag: 'EntityWorldRegistryFailure', cell, failure: { _tag: 'OtherFailure' },
    }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(EntityWorldQueryFailureSchema)({ _tag: 'OtherFailure' }))).toBe(true)
  })
})
