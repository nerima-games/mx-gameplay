import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { planFallingBlockMoves, type FallingBlockPosition } from '../src/domain/falling-block'

const SAND_ID = Option.getOrThrow(blockIdOf('sand'))
const AIR_ID = Option.getOrThrow(blockIdOf('air'))
const TARGET: FallingBlockPosition = { x: 0, y: 1, z: 0 }

describe('falling block planning', () => {
  it.each([
    ['source', -1, AIR_ID],
    ['destination', SAND_ID, -1],
  ] as const)('rejects an invalid block id read from the %s cell', (_cell, sourceId, destinationId) => {
    const moves = planFallingBlockMoves(
      [TARGET],
      (at) => (at.y === TARGET.y + 1 ? sourceId : destinationId),
    )

    expect(moves).toStrictEqual([])
  })
})
