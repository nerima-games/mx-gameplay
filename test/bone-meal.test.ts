import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Result } from 'effect'
import { applyBoneMeal } from '../src/domain/interactions/bone-meal'
import { blockIdOf, blockTypeOfId, type BlockType, type BlockPosition } from '@nerima-games/mc-kernel'
import { blockPosition } from './support/coordinate-fixtures'

const TARGET: BlockPosition = blockPosition(2, 64, -1)

const blockAt = (block: Parameters<typeof blockIdOf>[0]) =>
  (position: BlockPosition): Effect.Effect<BlockType | undefined> => {
    if (position.x !== TARGET.x || position.y !== TARGET.y || position.z !== TARGET.z) {
      return Effect.succeed(undefined)
    }
    const blockId = Option.getOrUndefined(blockIdOf(block))
    return Effect.succeed(blockId === undefined ? undefined : Result.getOrUndefined(blockTypeOfId(blockId)))
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
