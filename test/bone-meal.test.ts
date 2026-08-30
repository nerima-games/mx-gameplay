import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { applyBoneMeal } from '../src/domain/interactions/bone-meal'
import { blockIdOf, blockTypeOfId } from '@nerima-games/mc-kernel'
import type { BlockPosition } from '../src/domain/chunk-store-port'

const TARGET: BlockPosition = { x: 2, y: 64, z: -1 }

const blockAt = (block: Parameters<typeof blockIdOf>[0]) =>
  (position: BlockPosition): Effect.Effect<ReturnType<typeof blockTypeOfId>> => {
    const blockId = blockIdOf(block)
    return Effect.succeed(
      position.x === TARGET.x && blockId !== undefined ? blockTypeOfId(blockId) : undefined,
    )
  }

describe('applyBoneMeal', () => {
  it.effect('applies only to a registered crop block', () =>
    Effect.gen(function* () {
      expect(yield* applyBoneMeal(blockAt('wheat_crop'), TARGET)).toStrictEqual({
        _tag: 'applied',
        at: TARGET,
      })
    }),
  )

  it.effect('refuses non-crop blocks without changing the world', () =>
    Effect.gen(function* () {
      expect(yield* applyBoneMeal(blockAt('farmland'), TARGET)).toStrictEqual({
        _tag: 'notCrop',
        at: TARGET,
        block: 'farmland',
      })
    }),
  )
})
