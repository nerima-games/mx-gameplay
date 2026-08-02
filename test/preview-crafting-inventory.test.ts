import { describe, expect, it } from '@effect/vitest'
import { craftGrid } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import { makePreviewInventory } from '../apps/preview-mining-site/inventory'

describe('preview crafting inventory adapter', () => {
  it.effect('previews and crafts one oak log into four oak planks', () =>
    Effect.gen(function* () {
      const inventory = yield* makePreviewInventory()
      const grid = craftGrid(1, 1, ['oak_log'])

      yield* inventory.api.add('oak_log', 1)

      const beforePreview = yield* inventory.api.snapshot
      expect((yield* inventory.api.previewCraft(grid))._tag).toBe('Match')
      expect(yield* inventory.api.snapshot).toStrictEqual(beforePreview)

      expect((yield* inventory.api.craft(grid))._tag).toBe('Crafted')
      expect(yield* inventory.api.countOf('oak_log')).toBe(0)
      expect(yield* inventory.api.countOf('oak_planks')).toBe(4)
      expect(yield* inventory.held).toStrictEqual(new Map([['oak_planks', 4]]))
    }),
  )

  it.effect('retains the preview deposit log around the canonical service', () =>
    Effect.gen(function* () {
      const inventory = yield* makePreviewInventory()

      yield* inventory.api.add('oak_log', 1)

      expect(yield* inventory.takeDepositLog).toStrictEqual([
        { item: 'oak_log', count: 1 },
      ])
      expect(yield* inventory.takeDepositLog).toStrictEqual([])
    }),
  )
})
