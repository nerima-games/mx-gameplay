import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeSite, requestPlace, stepFrame } from '../apps/preview-mining-site/site'
import { AIR, STONE } from '../apps/preview-mining-site/world'

const TARGET = { x: 2, y: 64, z: 0 } as const

describe('preview placement inventory bridge', () => {
  it.effect('charges exactly one item for a successful placement', () =>
    Effect.gen(function* () {
      const site = yield* makeSite(
        { cells: [], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )
      yield* site.inventoryService.api.add('stone', 2)

      yield* requestPlace(site, TARGET, 'stone')
      const frame = yield* stepFrame(site)

      expect(site.world.peekBlock(TARGET)).toBe(STONE)
      expect(site.inventory.get('stone')).toBe(1)
      expect(frame.spent).toStrictEqual(['stone'])
    }),
  )

  it.effect('does not place when the inventory is empty', () =>
    Effect.gen(function* () {
      const site = yield* makeSite(
        { cells: [], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )

      yield* requestPlace(site, TARGET, 'stone')
      const frame = yield* stepFrame(site)

      expect(site.world.peekBlock(TARGET) ?? AIR).toBe(AIR)
      expect(site.inventory.get('stone') ?? 0).toBe(0)
      expect(frame.spent).toStrictEqual([])
    }),
  )

  it.effect('restores the reserved item when placement is refused', () =>
    Effect.gen(function* () {
      const site = yield* makeSite(
        { cells: [[TARGET.x, TARGET.y, STONE]], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )
      yield* site.inventoryService.api.add('stone', 1)

      yield* requestPlace(site, TARGET, 'stone')
      const frame = yield* stepFrame(site)

      expect(site.world.peekBlock(TARGET)).toBe(STONE)
      expect(site.inventory.get('stone')).toBe(1)
      expect(frame.spent).toStrictEqual([])
    }),
  )
})
