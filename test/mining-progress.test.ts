import { describe, expect, it } from '@effect/vitest'
import {
  blockPosition,
  blockIdOf,
  type HarvestToolRequirement,
} from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import { blockLoot } from '../domain/interactions/block-loot'
import { type requestBlockBreak } from '../stages/registration'
import {
  advanceMiningProgress,
  effectiveMiningSpeed,
  HAND_MINING_TOOL,
  miningDurationSecsForBlock,
  miningLootContextForItem,
  miningProgressFraction,
  miningToolForItem,
  type MiningProgressState,
} from '../domain/interactions/mining-progress'

const STONE = { position: blockPosition(1, 64, 2), blockId: blockIdOf('stone') }
const STONE_BESIDE = { position: blockPosition(2, 64, 2), blockId: blockIdOf('stone') }
const DIRT = { position: blockPosition(1, 64, 3), blockId: blockIdOf('dirt') }
const DIRT_AT_STONE_POSITION = { position: STONE.position, blockId: DIRT.blockId }

const completedPositionAcceptedByRequestBlockBreak: Parameters<typeof requestBlockBreak>[1] =
  STONE.position
void completedPositionAcceptedByRequestBlockBreak

describe('mining duration', () => {
  it.effect('maps the selected item to its loot context', () =>
    Effect.sync(() => {
      expect(miningLootContextForItem('wooden_pickaxe')).toStrictEqual({ heldTier: 'wooden' })
      expect(miningLootContextForItem('stone_pickaxe')).toStrictEqual({ heldTier: 'stone' })
      expect(miningLootContextForItem(null)).toStrictEqual({})
      expect(miningLootContextForItem('dirt')).toStrictEqual({})
    }),
  )

  it.effect('preserves the kernel hardness ordering', () =>
    Effect.sync(() => {
      const dirt = miningDurationSecsForBlock(blockIdOf('dirt'), null)
      const stone = miningDurationSecsForBlock(blockIdOf('stone'), null)
      const deepslate = miningDurationSecsForBlock(blockIdOf('deepslate'), null)

      expect(dirt).toBeLessThan(stone)
      expect(stone).toBeLessThan(deepslate)
    }),
  )

  it.effect('a wooden pickaxe speeds up pickaxe blocks, but not shovel blocks', () =>
    Effect.sync(() => {
      expect(miningDurationSecsForBlock(STONE.blockId, 'wooden_pickaxe')).toBeLessThan(
        miningDurationSecsForBlock(STONE.blockId, null),
      )
      expect(miningDurationSecsForBlock(DIRT.blockId, 'wooden_pickaxe')).toBe(
        miningDurationSecsForBlock(DIRT.blockId, null),
      )
    }),
  )

  it.effect('a stone pickaxe mines pickaxe blocks faster than a wooden pickaxe', () =>
    Effect.sync(() => {
      expect(miningDurationSecsForBlock(STONE.blockId, 'stone_pickaxe')).toBeLessThan(
        miningDurationSecsForBlock(STONE.blockId, 'wooden_pickaxe'),
      )
    }),
  )

  it.effect('only a stone-tier pickaxe yields raw iron from iron ore', () =>
    Effect.sync(() => {
      const ironOre = blockIdOf('iron_ore')

      expect(blockLoot(ironOre, miningLootContextForItem('wooden_pickaxe'))).toStrictEqual([])
      expect(blockLoot(ironOre, miningLootContextForItem('stone_pickaxe'))).toStrictEqual([
        { item: 'raw_iron', count: 1 },
      ])
    }),
  )

  it.effect('does not use the drop tier gate as a speed gate', () =>
    Effect.sync(() => {
      const lowTier: HarvestToolRequirement = { category: 'pickaxe', minTier: 'wooden' }
      const highTier: HarvestToolRequirement = { category: 'pickaxe', minTier: 'diamond' }
      const woodenPickaxe = miningToolForItem('wooden_pickaxe')

      expect(effectiveMiningSpeed(woodenPickaxe, lowTier)).toBe(2)
      expect(effectiveMiningSpeed(woodenPickaxe, highTier)).toBe(2)
      expect(effectiveMiningSpeed(HAND_MINING_TOOL, highTier)).toBe(1)
    }),
  )
})

describe('delta-time progress', () => {
  const runPartitions = (parts: ReadonlyArray<number>): MiningProgressState | null => {
    let state: MiningProgressState | null = null
    for (const deltaSecs of parts) {
      state = advanceMiningProgress({
        current: state,
        target: STONE,
        isMining: true,
        selectedItem: null,
        deltaSecs,
      }).nextProgress
    }
    return state
  }

  it.effect('is invariant to partitioning the same elapsed time', () =>
    Effect.sync(() => {
      const oneFrame = runPartitions([0.75])
      const manyFrames = runPartitions([0.1, 0.2, 0.15, 0.3])

      expect(oneFrame?.elapsedSecs).toBeCloseTo(manyFrames?.elapsedSecs ?? -1)
      expect(miningProgressFraction(oneFrame)).toBeCloseTo(miningProgressFraction(manyFrames))
      expect(oneFrame?.completed).toBe(manyFrames?.completed)
    }),
  )

  it.effect('continues progress across equivalent position values', () =>
    Effect.sync(() => {
      const first = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: null,
        deltaSecs: 0.1,
      })
      const second = advanceMiningProgress({
        current: first.nextProgress,
        target: { position: blockPosition(1, 64, 2), blockId: STONE.blockId },
        isMining: true,
        selectedItem: null,
        deltaSecs: 0.2,
      })

      expect(second.nextProgress?.elapsedSecs).toBeCloseTo(0.3)
    }),
  )

  it.effect('resets in-progress work when the block changes at the same position', () =>
    Effect.sync(() => {
      const stoneProgress = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: null,
        deltaSecs: 0.1,
      }).nextProgress
      const dirtProgress = advanceMiningProgress({
        current: stoneProgress,
        target: DIRT_AT_STONE_POSITION,
        isMining: true,
        selectedItem: null,
        deltaSecs: 0.05,
      }).nextProgress

      expect(dirtProgress?.blockKey).toBe(stoneProgress?.blockKey)
      expect(dirtProgress?.blockId).toBe(DIRT.blockId)
      expect(dirtProgress?.elapsedSecs).toBeCloseTo(0.05)
    }),
  )

  it.effect('starts a new break after a completed block is replaced at the same position', () =>
    Effect.sync(() => {
      const completedStone = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: null,
        deltaSecs: miningDurationSecsForBlock(STONE.blockId, null),
      })
      const replacement = advanceMiningProgress({
        current: completedStone.nextProgress,
        target: DIRT_AT_STONE_POSITION,
        isMining: true,
        selectedItem: null,
        deltaSecs: 0,
      })

      expect(completedStone.shouldBreak).toBe(true)
      expect(replacement.shouldBreak).toBe(false)
      expect(replacement.nextProgress?.blockId).toBe(DIRT.blockId)
      expect(replacement.nextProgress?.completed).toBe(false)
    }),
  )

  it.effect('accumulates each partition with the tool selected during that partition', () =>
    Effect.sync(() => {
      const run = (frames: ReadonlyArray<readonly [number, 'wooden_pickaxe' | null]>) => {
        let state: MiningProgressState | null = null
        for (const [deltaSecs, selectedItem] of frames) {
          state = advanceMiningProgress({
            current: state,
            target: STONE,
            isMining: true,
            selectedItem,
            deltaSecs,
          }).nextProgress
        }
        return state
      }

      const coarse = run([
        [0.1, null],
        [0.2, 'wooden_pickaxe'],
      ])
      const partitioned = run([
        [0.04, null],
        [0.06, null],
        [0.05, 'wooden_pickaxe'],
        [0.15, 'wooden_pickaxe'],
      ])

      expect(coarse?.accumulatedWork).toBeCloseTo(0.1 + 0.2 * 2)
      expect(partitioned?.accumulatedWork).toBeCloseTo(coarse?.accumulatedWork ?? -1)
      expect(miningProgressFraction(partitioned)).toBeCloseTo(miningProgressFraction(coarse))
      expect(partitioned?.completed).toBe(coarse?.completed)
    }),
  )

  it.effect('completes at the same total time regardless of frame count', () =>
    Effect.sync(() => {
      const requiredSecs = miningDurationSecsForBlock(STONE.blockId, null)
      const oneFrame = runPartitions([requiredSecs])
      const tenFrames = runPartitions(Array.from({ length: 10 }, () => requiredSecs / 10))

      expect(oneFrame?.completed).toBe(true)
      expect(tenFrames?.completed).toBe(true)
      expect(oneFrame?.elapsedSecs).toBeCloseTo(tenFrames?.elapsedSecs ?? -1)
    }),
  )

  it.effect('resets on target switch and on release', () =>
    Effect.sync(() => {
      const stoneProgress = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: null,
        deltaSecs: 0.5,
      }).nextProgress
      const dirtProgress = advanceMiningProgress({
        current: stoneProgress,
        target: DIRT,
        isMining: true,
        selectedItem: null,
        deltaSecs: 0.1,
      }).nextProgress

      expect(dirtProgress?.blockKey).not.toBe(stoneProgress?.blockKey)
      expect(dirtProgress?.elapsedSecs).toBeCloseTo(0.1)
      expect(
        advanceMiningProgress({
          current: dirtProgress,
          target: DIRT,
          isMining: false,
          selectedItem: null,
          deltaSecs: 0.1,
        }),
      ).toStrictEqual({ nextProgress: null, shouldBreak: false })
    }),
  )

  it.effect('emits completion exactly once until release or target change', () =>
    Effect.sync(() => {
      const first = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: 'wooden_pickaxe',
        deltaSecs: 0.5,
      })
      const completed = advanceMiningProgress({
        current: first.nextProgress,
        target: STONE,
        isMining: true,
        selectedItem: 'wooden_pickaxe',
        deltaSecs: 0.2,
      })
      const heldAfterCompletion = advanceMiningProgress({
        current: completed.nextProgress,
        target: STONE,
        isMining: true,
        selectedItem: 'wooden_pickaxe',
        deltaSecs: 1,
      })

      expect(first.shouldBreak).toBe(false)
      expect(completed.shouldBreak).toBe(true)
      expect(heldAfterCompletion.shouldBreak).toBe(false)
      expect(heldAfterCompletion.nextProgress?.completed).toBe(true)
    }),
  )

  it.effect('emits one completion per consecutively mined block for durability accounting', () =>
    Effect.sync(() => {
      const requiredSecs = miningDurationSecsForBlock(STONE.blockId, 'stone_pickaxe')
      const first = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: 'stone_pickaxe',
        deltaSecs: requiredSecs,
      })
      const held = advanceMiningProgress({
        current: first.nextProgress,
        target: STONE,
        isMining: true,
        selectedItem: 'stone_pickaxe',
        deltaSecs: requiredSecs,
      })
      const second = advanceMiningProgress({
        current: held.nextProgress,
        target: STONE_BESIDE,
        isMining: true,
        selectedItem: 'stone_pickaxe',
        deltaSecs: requiredSecs,
      })

      expect([first.shouldBreak, held.shouldBreak, second.shouldBreak]).toStrictEqual([
        true,
        false,
        true,
      ])
    }),
  )

  it.effect('normalises non-finite and negative persisted progress', () =>
    Effect.sync(() => {
      for (const accumulatedWork of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        const result = advanceMiningProgress({
          current: {
            blockKey: '1,64,2',
            blockId: STONE.blockId,
            elapsedSecs: Number.POSITIVE_INFINITY,
            requiredSecs: Number.NaN,
            accumulatedWork,
            completed: false,
          },
          target: STONE,
          isMining: true,
          selectedItem: null,
          deltaSecs: 0.1,
        })

        expect(Number.isFinite(result.nextProgress?.elapsedSecs)).toBe(true)
        expect(Number.isFinite(result.nextProgress?.requiredSecs)).toBe(true)
        expect(Number.isFinite(result.nextProgress?.accumulatedWork)).toBe(true)
        expect(miningProgressFraction(result.nextProgress)).toBeGreaterThanOrEqual(0)
        expect(miningProgressFraction(result.nextProgress)).toBeLessThanOrEqual(1)
      }
    }),
  )

  it.effect('returns a bounded fraction for externally corrupted progress', () =>
    Effect.sync(() => {
      const progress = (accumulatedWork: number): MiningProgressState => ({
        blockKey: '1,64,2',
        blockId: STONE.blockId,
        elapsedSecs: 0,
        requiredSecs: 1,
        accumulatedWork,
        completed: false,
      })

      expect(miningProgressFraction(progress(Number.NaN))).toBe(0)
      expect(miningProgressFraction(progress(Number.POSITIVE_INFINITY))).toBe(0)
      expect(miningProgressFraction(progress(Number.NEGATIVE_INFINITY))).toBe(0)
      expect(miningProgressFraction(progress(-1))).toBe(0)
    }),
  )
})
