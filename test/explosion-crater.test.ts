import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { positionKeyOf } from '../src/domain/block-position-key'
import { blockIdOf, type BlockType } from '../src/domain/block-vocabulary'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition } from '../src/domain/chunk-store-port'
import { carveExplosionCrater, craterCells } from '../src/domain/interactions/explosion-crater'
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
      const centre: BlockPosition = { x: 8, y: 64, z: 8 }
      const bedrockAt: BlockPosition = { x: 9, y: 64, z: 8 }
      const obsidianAt: BlockPosition = { x: 8, y: 65, z: 8 }
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
      expect(disturbed).toContain(positionKeyOf(centre))
      expect(disturbed).not.toContain(positionKeyOf(bedrockAt))
      expect(disturbed).not.toContain(positionKeyOf(obsidianAt))
      expect(yield* store.calls).toStrictEqual({
        reads: craterCells(centre, 1).length,
        writes: craterCells(centre, 1).length - 2,
        peeks: 0,
      })
    }),
  )

  it.effect('does not write crater cells in unloaded chunks', () =>
    Effect.gen(function* () {
      const centre: BlockPosition = { x: 8, y: 64, z: 8 }
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
})
