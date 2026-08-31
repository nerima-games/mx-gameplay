import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { blockIdOf, blockPosition, blockPositionKeyOf, type BlockType } from '@nerima-games/mc-kernel'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition } from '@nerima-games/mc-kernel'
import { carveExplosionCrater, craterCells, craterRadius } from '../src/domain/interactions/explosion-crater'
import { makeChunkStoreDouble, world } from './support/chunk-store-double'

const registeredBlockId = (type: BlockType): BlockId => {
  const id = blockIdOf(type)
  if (id === undefined) throw new Error(`missing block registry entry: ${type}`)
  return id
}

const STONE = registeredBlockId('stone')
const BEDROCK = registeredBlockId('bedrock')
const OBSIDIAN = registeredBlockId('obsidian')

describe('explosion crater', () => {
  it.effect('destroys stone but preserves normal-explosion-resistant blocks', () =>
    Effect.gen(function* () {
      const centre: BlockPosition = blockPosition(8, 64, 8)
      const bedrockAt: BlockPosition = blockPosition(9, 64, 8)
      const obsidianAt: BlockPosition = blockPosition(8, 65, 8)
      const store = yield* makeChunkStoreDouble(
        world([
          [centre, STONE],
          [bedrockAt, BEDROCK],
          [obsidianAt, OBSIDIAN],
        ]),
        ['0,0'],
      )

      const disturbed = yield* carveExplosionCrater(store.api, centre, 1)

      expect(yield* store.blockAt(centre)).toBe(AIR_BLOCK_ID)
      expect(yield* store.blockAt(bedrockAt)).toBe(BEDROCK)
      expect(yield* store.blockAt(obsidianAt)).toBe(OBSIDIAN)
      expect(disturbed).toContain(blockPositionKeyOf(blockPosition(centre.x, centre.y, centre.z)))
      expect(disturbed).not.toContain(blockPositionKeyOf(blockPosition(bedrockAt.x, bedrockAt.y, bedrockAt.z)))
      expect(disturbed).not.toContain(
        blockPositionKeyOf(blockPosition(obsidianAt.x, obsidianAt.y, obsidianAt.z)),
      )
      expect(yield* store.calls).toStrictEqual({
        reads: craterCells(centre, 1).length,
        writes: craterCells(centre, 1).length - 2,
        peeks: 0,
      })
    }),
  )

  it.effect('does not write crater cells in unloaded chunks', () =>
    Effect.gen(function* () {
      const centre: BlockPosition = blockPosition(8, 64, 8)
      const store = yield* makeChunkStoreDouble(world([[centre, STONE]]), [])

      const disturbed = yield* carveExplosionCrater(store.api, centre, 1)

      expect(disturbed).toStrictEqual([])
      expect(yield* store.blockAt(centre)).toBe(STONE)
      expect(yield* store.calls).toStrictEqual({
        reads: craterCells(centre, 1).length,
        writes: 0,
        peeks: 0,
      })
    }),
  )

  it('craterRadius is 0 for a non-finite power, rather than propagating NaN', () => {
    expect(craterRadius(Number.NaN)).toBe(0)
    expect(craterRadius(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('craterCells returns no cells for a non-positive power', () => {
    const centre: BlockPosition = blockPosition(8, 64, 8)

    expect(craterCells(centre, 0)).toStrictEqual([])
    expect(craterCells(centre, -3)).toStrictEqual([])
  })

  it('craterCells returns no cells when the centre has a non-finite coordinate', () => {
    expect(craterCells({ x: Number.NaN, y: 64, z: 8 }, 1)).toStrictEqual([])
    expect(craterCells({ x: 8, y: Number.POSITIVE_INFINITY, z: 8 }, 1)).toStrictEqual([])
    expect(craterCells({ x: 8, y: 64, z: Number.NaN }, 1)).toStrictEqual([])
  })
})
