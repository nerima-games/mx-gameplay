import { describe, expect, it } from '@effect/vitest'
import {
  BLOCKS,
  BROWN_MUSHROOM,
  CACTUS,
  RED_MUSHROOM,
  SUGAR_CANE,
  placeableItemOf,
} from '../apps/preview-mining-site/world'

const PLACEMENT_RULE_BLOCKS = [BROWN_MUSHROOM, RED_MUSHROOM, SUGAR_CANE, CACTUS] as const

describe('preview placement palette', () => {
  it('exposes every itemized block with a specialized placement rule', () => {
    for (const block of PLACEMENT_RULE_BLOCKS) {
      expect(BLOCKS.some((entry) => entry.id === block)).toBe(true)
      expect(placeableItemOf(block)).toBeDefined()
    }
  })
})
