import { describe, expect, it } from '@effect/vitest'
import { blockIdOf } from '../src/domain/block-vocabulary'
import type { BlockPosition, BlockReading } from '../src/domain/chunk-store-port'
import { isSuccessfulBlockUse, resolveBlockUse } from '../src/domain/interactions/use-block'

const POSITION: BlockPosition = { x: 1, y: 64, z: 1 }
const LEVER_ID = blockIdOf('lever') ?? -1
const DIRT_ID = blockIdOf('dirt') ?? -1

describe('resolveBlockUse', () => {
  it('toggles a lever', () => {
    const reading: BlockReading = { _tag: 'Block', block: LEVER_ID }

    expect(resolveBlockUse(POSITION, reading)).toStrictEqual({
      _tag: 'ToggleLever',
      position: POSITION,
    })
  })

  it('refuses a block that is not a lever, naming what it found', () => {
    const reading: BlockReading = { _tag: 'Block', block: DIRT_ID }

    expect(resolveBlockUse(POSITION, reading)).toStrictEqual({
      _tag: 'NotLever',
      position: POSITION,
      existing: DIRT_ID,
    })
  })

  it('reports ChunkNotLoaded rather than treating an unresident cell as not-a-lever', () => {
    const reading: BlockReading = { _tag: 'ChunkNotLoaded' }

    expect(resolveBlockUse(POSITION, reading)).toStrictEqual({
      _tag: 'ChunkNotLoaded',
      position: POSITION,
    })
  })

  it('reports OutOfWorld rather than treating a cell beyond the build limit as not-a-lever', () => {
    const reading: BlockReading = { _tag: 'OutOfWorld' }

    expect(resolveBlockUse(POSITION, reading)).toStrictEqual({
      _tag: 'OutOfWorld',
      position: POSITION,
    })
  })
})

describe('isSuccessfulBlockUse', () => {
  it('is true only for a lit lever toggle', () => {
    expect(isSuccessfulBlockUse({ _tag: 'ToggleLever', position: POSITION })).toBe(true)
    expect(
      isSuccessfulBlockUse({ _tag: 'NotLever', position: POSITION, existing: DIRT_ID }),
    ).toBe(false)
    expect(isSuccessfulBlockUse({ _tag: 'ChunkNotLoaded', position: POSITION })).toBe(false)
    expect(isSuccessfulBlockUse({ _tag: 'OutOfWorld', position: POSITION })).toBe(false)
  })
})
