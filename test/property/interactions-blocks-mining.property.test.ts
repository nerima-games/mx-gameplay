import { describe, it } from '@effect/vitest'
import { DeltaTimeSecs, blockIdOf, propertyOfBlockId, type BlockType, type DeltaTimeSecs as DeltaTimeSecsValue, type ItemType } from '@nerima-games/mc-kernel'
import { EnchantmentLevel } from '@nerima-games/mc-kernel/domain/quantities'
import { Effect, Option, Result } from 'effect'
import fc from 'fast-check'
import { blockPosition } from '../support/coordinate-fixtures'
import {
  advanceMiningProgress,
  effectiveMiningSpeed,
  HAND_MINING_TOOL,
  miningDurationSecsForBlock,
  miningToolForItem,
  type MiningProgressState,
} from '../../src/domain/interactions/mining-progress'

const registeredBlockId = (type: BlockType) =>
  Option.getOrElse(blockIdOf(type), () => {
    throw new Error(`missing block registry entry: ${type}`)
  })

const stone = {
  position: blockPosition(1, 64, 2),
  blockId: registeredBlockId('stone'),
}
const dirt = { ...stone, blockId: registeredBlockId('dirt') }

const requiredWork = 1
const dirtRequirement = Result.getOrThrow(propertyOfBlockId(dirt.blockId, 'harvestTool'))
const enchantmentLevel = (value: number) => Result.getOrThrow(EnchantmentLevel.result(value))
const deltaTimeSecs = (value: number): DeltaTimeSecsValue => Result.getOrThrow(DeltaTimeSecs.result(value))

const tools: ReadonlyArray<ItemType | null> = [
  null,
  'wooden_pickaxe',
  'stone_pickaxe',
  'iron_pickaxe',
  'diamond_pickaxe',
]

describe('mining progress properties', () => {
  it.effect('keeps an unsuitable mining category at hand speed regardless of Efficiency', () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), (efficiencyLevel) => {
          const level = enchantmentLevel(efficiencyLevel)
          const wrongTool = miningToolForItem('wooden_pickaxe', level)
          const speed = effectiveMiningSpeed(wrongTool, dirtRequirement)
          const handDuration = miningDurationSecsForBlock(dirt.blockId, null)
          const mismatchedToolDuration = miningDurationSecsForBlock(
            dirt.blockId,
            'wooden_pickaxe',
            level,
          )
          return Result.isSuccess(speed) &&
            Number.isFinite(speed.success) &&
            speed.success === HAND_MINING_TOOL.speedMultiplier &&
            mismatchedToolDuration === handDuration
        }),
      )
    }),
  )

  it.effect('returns a typed failure for invalid mining speed multipliers', () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          fc.double({ noNaN: false, noDefaultInfinity: false }),
          (speedMultiplier) => {
            const result = effectiveMiningSpeed(
              { ...miningToolForItem('wooden_pickaxe'), speedMultiplier },
              dirtRequirement,
            )
            if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
              return Result.isFailure(result) && result.failure === 'invalid-speed-multiplier'
            }
            return Result.isSuccess(result) && result.success === HAND_MINING_TOOL.speedMultiplier
          },
        ),
      )
    }),
  )

  it.effect('keeps work bounded and announces completion once for a held target', () =>
    Effect.sync(() => {
      // This catches lost work on tool changes, work overshoot, or repeated break notifications.
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              deltaSecs: fc.integer({ min: 0, max: 10 }).map((milliseconds) => deltaTimeSecs(milliseconds / 1000)),
              selectedItem: fc.constantFrom(...tools),
              efficiencyLevel: fc.integer({ min: 0, max: 5 }).map(enchantmentLevel),
            }),
            { minLength: 1, maxLength: 32 },
          ),
          (generatedFrames) => {
            let current: MiningProgressState | null = null
            const frames = [
              { deltaSecs: deltaTimeSecs(0.001), selectedItem: 'diamond_pickaxe' as const, efficiencyLevel: enchantmentLevel(0) },
              { deltaSecs: deltaTimeSecs(0.001), selectedItem: null, efficiencyLevel: enchantmentLevel(0) },
              ...generatedFrames,
            ]

            for (const frame of frames) {
              const result = advanceMiningProgress({
                current,
                target: stone,
                isMining: true,
                selectedItem: frame.selectedItem,
                efficiencyLevel: frame.efficiencyLevel,
                deltaSecs: frame.deltaSecs,
              })
              const next = result.nextProgress
              if (next === null) return false

              const previousWork = current?.accumulatedWork ?? 0
              if (!Number.isFinite(next.accumulatedWork)) return false
              if (next.accumulatedWork < previousWork) return false
              if (next.accumulatedWork > requiredWork) return false
              if (next.completed !== (next.accumulatedWork === requiredWork)) return false
              if (result.shouldBreak !== (!current?.completed && next.completed)) return false

              current = next
            }

            return true
          },
        ),
      )
    }),
  )
})
