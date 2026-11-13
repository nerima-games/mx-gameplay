import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Result } from 'effect'
import { BlockAxis, BlockId, type BlockRegistryResolutionFailure } from '@nerima-games/mc-kernel'

const registryControl = vi.hoisted(() => ({
  mode: 'native' as 'native' | 'resolution-failure' | 'known-without-resolved-block',
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
  }
})

import { entityWorldBlockDataAt } from '../src/domain/entities/entity-world-cell.js'

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
})
