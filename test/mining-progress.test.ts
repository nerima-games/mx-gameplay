import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import { Effect, Option, Result, Schema } from 'effect'
import {
  DeltaTimeSecs,
  blockIdOf,
  blockPositionKeyOf,
  type BlockId,
  type BlockType,
  type HarvestToolRequirement,
  type DeltaTimeSecs as DeltaTimeSecsValue,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import { EnchantmentLevel } from '@nerima-games/mc-kernel/domain/quantities'
import { blockPosition as atBlockPosition } from './support/coordinate-fixtures'
import { blockLoot } from '../src/domain/interactions/block-loot'
import { MiningSpeedMultiplierSchema, type MiningSpeedMultiplier } from '../src/domain/status-effect.js'
import { type requestBlockBreak } from '../src/stages/registration'
import {
  advanceMiningProgress,
  DIAMOND_PICKAXE_MINING_TOOL,
  effectiveMiningSpeed,
  GOLD_PICKAXE_MINING_TOOL,
  HAND_MINING_TOOL,
  IRON_PICKAXE_MINING_TOOL,
  MINING_TICKS_PER_SECOND,
  miningDurationSecsForBlock,
  miningLootContextForItem,
  miningProgressFraction,
  MiningProgressFractionSchema,
  miningToolForItem,
  type MiningProgressState,
  NETHERITE_PICKAXE_MINING_TOOL,
  WOODEN_PICKAXE_MINING_TOOL,
} from '../src/domain/interactions/mining-progress'

const registeredBlockId = (type: BlockType): BlockId =>
  Option.getOrElse(blockIdOf(type), () => {
    throw new Error(`missing block registry entry: ${type}`)
  })

const STONE = { position: atBlockPosition(1, 64, 2), blockId: registeredBlockId('stone') }
const STONE_BESIDE = { position: atBlockPosition(2, 64, 2), blockId: registeredBlockId('stone') }
const DIRT = { position: atBlockPosition(1, 64, 3), blockId: registeredBlockId('dirt') }
const DIRT_AT_STONE_POSITION = { position: STONE.position, blockId: DIRT.blockId }
const END_GATEWAY = { position: atBlockPosition(3, 64, 2), blockId: registeredBlockId('end_gateway') }
const miningSpeed = (tool: Parameters<typeof effectiveMiningSpeed>[0], requirement: HarvestToolRequirement) =>
  Result.getOrThrow(effectiveMiningSpeed(tool, requirement))
const miningSpeedMultiplier = (value: number): MiningSpeedMultiplier =>
  Result.getOrThrow(Schema.decodeUnknownResult(MiningSpeedMultiplierSchema)(value))
const enchantmentLevel = (value: number) => Result.getOrThrow(EnchantmentLevel.result(value))
const deltaTimeSecs = (value: number): DeltaTimeSecsValue => Result.getOrThrow(DeltaTimeSecs.result(value))

const completedPositionAcceptedByRequestBlockBreak: Parameters<typeof requestBlockBreak>[1] =
  STONE.position
void completedPositionAcceptedByRequestBlockBreak

describe('mining duration', () => {
  it.effect('maps the selected item to its loot context', () =>
    Effect.sync(() => {
      expect(miningLootContextForItem('wooden_pickaxe')).toStrictEqual({ heldTier: 'wooden' })
      expect(miningLootContextForItem('stone_pickaxe')).toStrictEqual({ heldTier: 'stone' })
      expect(miningLootContextForItem('iron_pickaxe')).toStrictEqual({ heldTier: 'iron' })
      expect(miningLootContextForItem('diamond_pickaxe')).toStrictEqual({ heldTier: 'diamond' })
      expect(miningLootContextForItem('netherite_pickaxe')).toStrictEqual({ heldTier: 'netherite' })
      expect(miningLootContextForItem(null)).toStrictEqual({})
      expect(miningLootContextForItem('dirt')).toStrictEqual({})
    }),
  )

  it.effect('uses the registry hardness as input to the vanilla tick formula', () =>
    Effect.sync(() => {
      const dirt = miningDurationSecsForBlock(registeredBlockId('dirt'), null)
      const stone = miningDurationSecsForBlock(registeredBlockId('stone'), null)
      const deepslate = miningDurationSecsForBlock(registeredBlockId('deepslate'), null)
      const unbreakable = miningDurationSecsForBlock(END_GATEWAY.blockId, null)
      const dirtHardness = Result.getOrThrow(propertyOfBlockId(registeredBlockId('dirt'), 'hardness'))
      const stoneHardness = Result.getOrThrow(propertyOfBlockId(STONE.blockId, 'hardness'))
      const deepslateHardness = Result.getOrThrow(
        propertyOfBlockId(registeredBlockId('deepslate'), 'hardness'),
      )

      expect(dirt).toBe(Math.ceil(dirtHardness * 30) / MINING_TICKS_PER_SECOND)
      expect(stone).toBe(Math.ceil(stoneHardness * 100) / MINING_TICKS_PER_SECOND)
      expect(deepslate).toBe(Math.ceil(deepslateHardness * 30) / MINING_TICKS_PER_SECOND)
      expect(unbreakable).toBe(Number.POSITIVE_INFINITY)
    }),
  )

  it.effect('a wooden pickaxe speeds up stone but does not help on dirt', () =>
    Effect.sync(() => {
      expect(miningDurationSecsForBlock(STONE.blockId, 'wooden_pickaxe')).toBeLessThan(
        miningDurationSecsForBlock(STONE.blockId, null),
      )
      expect(miningDurationSecsForBlock(DIRT.blockId, 'wooden_pickaxe', enchantmentLevel(3))).toBe(
        miningDurationSecsForBlock(DIRT.blockId, null),
      )
    }),
  )

  it.effect('applies a branded mining-speed multiplier to the vanilla tick formula', () =>
    Effect.sync(() => {
      // Stone hardness is 25; hand mining uses divisor 100 and speed 1.
      expect(miningDurationSecsForBlock(STONE.blockId, null, enchantmentLevel(0), miningSpeedMultiplier(2))).toBe(
        Math.ceil((25 * 100) / 2) / MINING_TICKS_PER_SECOND,
      )
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 2_000 }), (multiplierMilli) => {
          const multiplier = multiplierMilli / 1_000
          const result = advanceMiningProgress({
            current: null,
            target: STONE,
            isMining: true,
            selectedItem: null,
            miningSpeedMultiplier: miningSpeedMultiplier(multiplier),
            deltaSecs: deltaTimeSecs(1 / MINING_TICKS_PER_SECOND),
          })
          expect(result.nextProgress?.accumulatedWork).toBeCloseTo(multiplier / (25 * 100), 12)
        }),
      )
      expect(Result.isSuccess(Schema.decodeUnknownResult(MiningSpeedMultiplierSchema)(0))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(MiningSpeedMultiplierSchema)(-Number.MIN_VALUE))).toBe(true)
      expect(miningDurationSecsForBlock(STONE.blockId, null, enchantmentLevel(0), miningSpeedMultiplier(0))).toBe(
        Number.POSITIVE_INFINITY,
      )
      const stopped = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: null,
        miningSpeedMultiplier: miningSpeedMultiplier(0),
        deltaSecs: deltaTimeSecs(1),
      })
      expect(stopped.shouldBreak).toBe(false)
      expect(stopped.nextProgress?.accumulatedWork).toBe(0)
      expect(stopped.nextProgress?.requiredSecs).toBe(Number.POSITIVE_INFINITY)
    }),
  )

  it.effect('accepts finite non-negative frame deltas through the kernel schema', () =>
    Effect.sync(() => {
      expect(Result.isSuccess(DeltaTimeSecs.result(0))).toBe(true)
      expect(Result.isSuccess(DeltaTimeSecs.result(1 / MINING_TICKS_PER_SECOND))).toBe(true)
      for (const invalidDelta of [-Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(Result.isFailure(DeltaTimeSecs.result(invalidDelta))).toBe(true)
      }
    }),
  )

  it.effect('each pickaxe tier mines pickaxe blocks faster than the previous tier', () =>
    Effect.sync(() => {
      const woodenDuration = miningDurationSecsForBlock(STONE.blockId, 'wooden_pickaxe')
      const stoneDuration = miningDurationSecsForBlock(STONE.blockId, 'stone_pickaxe')
      const ironDuration = miningDurationSecsForBlock(STONE.blockId, 'iron_pickaxe')
      const diamondDuration = miningDurationSecsForBlock(STONE.blockId, 'diamond_pickaxe')

      expect(stoneDuration).toBeLessThan(woodenDuration)
      expect(ironDuration).toBeLessThan(stoneDuration)
      expect(diamondDuration).toBeLessThan(ironDuration)
      expect(miningToolForItem('iron_pickaxe')).toBe(IRON_PICKAXE_MINING_TOOL)
      expect(miningToolForItem('diamond_pickaxe')).toBe(DIAMOND_PICKAXE_MINING_TOOL)
      expect(IRON_PICKAXE_MINING_TOOL).toStrictEqual({
        category: 'pickaxe',
        tier: 'iron',
        speedMultiplier: 6,
      })
      expect(DIAMOND_PICKAXE_MINING_TOOL).toStrictEqual({
        category: 'pickaxe',
        tier: 'diamond',
        speedMultiplier: 8,
      })
      expect(miningToolForItem('gold_pickaxe')).toStrictEqual(GOLD_PICKAXE_MINING_TOOL)
      expect(GOLD_PICKAXE_MINING_TOOL).toStrictEqual({
        category: 'pickaxe',
        tier: 'wooden',
        speedMultiplier: 12,
      })
      expect(miningToolForItem('netherite_pickaxe')).toStrictEqual(NETHERITE_PICKAXE_MINING_TOOL)
      expect(NETHERITE_PICKAXE_MINING_TOOL).toStrictEqual({
        category: 'pickaxe',
        tier: 'netherite',
        speedMultiplier: 9,
      })
    }),
  )

  it.effect('maps selected pickaxe tiers to gated ore drops', () =>
    Effect.sync(() => {
      const ironOre = registeredBlockId('iron_ore')
      const goldOre = registeredBlockId('gold_ore')
      const diamondOre = registeredBlockId('diamond_ore')
      const obsidian = registeredBlockId('obsidian')

      expect(blockLoot(ironOre, miningLootContextForItem('wooden_pickaxe'))).toStrictEqual([])
      expect(blockLoot(ironOre, miningLootContextForItem('stone_pickaxe'))).toStrictEqual([
        { item: 'raw_iron', count: 1 },
      ])
      expect(blockLoot(goldOre, miningLootContextForItem('stone_pickaxe'))).toStrictEqual([])
      expect(blockLoot(goldOre, miningLootContextForItem('iron_pickaxe'))).toStrictEqual([
        { item: 'raw_gold', count: 1 },
      ])
      expect(blockLoot(diamondOre, miningLootContextForItem('stone_pickaxe'))).toStrictEqual([])
      expect(blockLoot(diamondOre, miningLootContextForItem('iron_pickaxe'))).toStrictEqual([
        { item: 'diamond', count: 1 },
      ])
      expect(blockLoot(obsidian, miningLootContextForItem('iron_pickaxe'))).toStrictEqual([])
      expect(blockLoot(obsidian, miningLootContextForItem('diamond_pickaxe'))).toStrictEqual([
        { item: 'obsidian', count: 1 },
      ])
      expect(blockLoot(obsidian, miningLootContextForItem('netherite_pickaxe'))).toStrictEqual([
        { item: 'obsidian', count: 1 },
      ])
    }),
  )

  it.effect('uses the vanilla slow divisor when the tool cannot harvest the block', () =>
    Effect.sync(() => {
      const lowTier: HarvestToolRequirement = { category: 'pickaxe', minTier: 'wooden' }
      const highTier: HarvestToolRequirement = { category: 'pickaxe', minTier: 'diamond' }
      const woodenPickaxe = miningToolForItem('wooden_pickaxe')

      expect(miningSpeed(woodenPickaxe, lowTier)).toBe(2)
      expect(miningSpeed(woodenPickaxe, highTier)).toBe(1)
      expect(miningSpeed(HAND_MINING_TOOL, highTier)).toBe(1)
      expect(
        miningSpeed(woodenPickaxe, { category: 'shovel', minTier: 'wooden' }),
      ).toBe(1)
      const obsidian = registeredBlockId('obsidian')
      const obsidianHardness = Result.getOrThrow(propertyOfBlockId(obsidian, 'hardness'))
      expect(miningDurationSecsForBlock(obsidian, 'wooden_pickaxe')).toBe(
        Math.ceil(obsidianHardness * 100) / MINING_TICKS_PER_SECOND,
      )
      expect(miningDurationSecsForBlock(obsidian, 'diamond_pickaxe')).toBe(
        Math.ceil(obsidianHardness * 30 / 8) / MINING_TICKS_PER_SECOND,
      )
    }),
  )

  it.effect('keeps the no-tool speed as the hand-mining baseline', () =>
    Effect.sync(() => {
      const hardness = Result.getOrThrow(propertyOfBlockId(STONE.blockId, 'hardness'))

      expect(hardness).toBe(25)
      expect(miningDurationSecsForBlock(STONE.blockId, null)).toBe(
        Math.ceil(hardness * 100) / MINING_TICKS_PER_SECOND,
      )
    }),
  )

  it.effect('applies Efficiency only when the selected tool matches the block category', () =>
    Effect.sync(() => {
      const plainStone = miningDurationSecsForBlock(STONE.blockId, 'wooden_pickaxe')
      const efficientStone = miningDurationSecsForBlock(STONE.blockId, 'wooden_pickaxe', enchantmentLevel(3))

      expect(plainStone).toBe(Math.ceil(25 * 30 / 2) / MINING_TICKS_PER_SECOND)
      expect(efficientStone).toBe(Math.ceil(25 * 30 / 12) / MINING_TICKS_PER_SECOND)
      expect(miningDurationSecsForBlock(DIRT.blockId, 'wooden_pickaxe', enchantmentLevel(3))).toBe(
        miningDurationSecsForBlock(DIRT.blockId, 'wooden_pickaxe'),
      )
      expect(
        miningSpeed(miningToolForItem('wooden_pickaxe', enchantmentLevel(3)), {
          category: 'pickaxe',
          minTier: 'wooden',
        }),
      ).toBe(12)
    }),
  )

  it.effect('accepts only kernel-branded Efficiency levels', () =>
    Effect.sync(() => {
      expect(Result.isSuccess(EnchantmentLevel.result(0))).toBe(true)
      expect(Result.isSuccess(EnchantmentLevel.result(255))).toBe(true)
      for (const invalidLevel of [-1, 256, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(Result.isFailure(EnchantmentLevel.result(invalidLevel))).toBe(true)
      }
      expect(
        miningSpeed(miningToolForItem('wooden_pickaxe', enchantmentLevel(0)), {
          category: 'pickaxe',
          minTier: 'wooden',
        }),
      ).toBe(2)
    }),
  )

  it.effect('returns a typed failure for invalid mining speed multipliers', () =>
    Effect.sync(() => {
      const requirement: HarvestToolRequirement = { category: 'pickaxe', minTier: 'wooden' }
      const invalidSpeedMultipliers = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

      for (const speedMultiplier of invalidSpeedMultipliers) {
        expect(
          effectiveMiningSpeed(
            { ...WOODEN_PICKAXE_MINING_TOOL, speedMultiplier },
            requirement,
          ),
        ).toStrictEqual(Result.fail('invalid-speed-multiplier'))
      }
    }),
  )

  it.effect('an instant-break block (zero hardness) needs no time to mine', () =>
    Effect.sync(() => {
      // A dandelion breaks in one hit regardless of tool, same as vanilla:
      // kernel registers it with hardness 0.
      expect(miningDurationSecsForBlock(registeredBlockId('dandelion'), null)).toBe(0)
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
        deltaSecs: deltaTimeSecs(deltaSecs),
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
        deltaSecs: deltaTimeSecs(0.1),
      })
      const second = advanceMiningProgress({
        current: first.nextProgress,
        target: { position: atBlockPosition(1, 64, 2), blockId: STONE.blockId },
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0.2),
      })

      expect(second.nextProgress?.elapsedSecs).toBeCloseTo(0.3)
    }),
  )

  it.effect('keeps registered unbreakable blocks at zero work without resetting same-target elapsed time', () =>
    Effect.sync(() => {
      expect(Result.getOrThrow(propertyOfBlockId(END_GATEWAY.blockId, 'hardness'))).toBe(-1)
      const persistedProgress: MiningProgressState = {
        blockKey: blockPositionKeyOf(END_GATEWAY.position),
        blockId: END_GATEWAY.blockId,
        elapsedSecs: 1.5,
        requiredSecs: Number.POSITIVE_INFINITY,
        accumulatedWork: 0,
        completed: false,
      }
      const firstFrame = advanceMiningProgress({
        current: null,
        target: END_GATEWAY,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0.1),
      })
      const resumed = advanceMiningProgress({
        current: persistedProgress,
        target: END_GATEWAY,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0.1),
      })

      expect(firstFrame).toMatchObject({
        shouldBreak: false,
        nextProgress: {
          elapsedSecs: 0,
          requiredSecs: Number.POSITIVE_INFINITY,
          accumulatedWork: 0,
          completed: false,
        },
      })
      expect(resumed.nextProgress).toMatchObject({
        elapsedSecs: 1.5,
        requiredSecs: Number.POSITIVE_INFINITY,
        accumulatedWork: 0,
        completed: false,
      })
      expect(miningProgressFraction(resumed.nextProgress)).toBe(0)
    }),
  )

  it.effect('completes a zero-hardness block immediately and keeps it complete', () =>
    Effect.sync(() => {
      const dandelion = {
        position: atBlockPosition(1, 64, 2),
        blockId: registeredBlockId('dandelion'),
      }
      const first = advanceMiningProgress({
        current: null,
        target: dandelion,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0),
      })

      expect(first.shouldBreak).toBe(true)
      expect(first.nextProgress).toMatchObject({ completed: true, elapsedSecs: 0, requiredSecs: 0 })

      const repeated = advanceMiningProgress({
        current: first.nextProgress,
        target: dandelion,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(1),
      })
      expect(repeated.shouldBreak).toBe(false)
      expect(repeated.nextProgress).toStrictEqual(first.nextProgress)
    }),
  )

  it.effect('resets in-progress work when the block changes at the same position', () =>
    Effect.sync(() => {
      const stoneProgress = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0.1),
      }).nextProgress
      const dirtProgress = advanceMiningProgress({
        current: stoneProgress,
        target: DIRT_AT_STONE_POSITION,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0.05),
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
        deltaSecs: deltaTimeSecs(miningDurationSecsForBlock(STONE.blockId, null)),
      })
      const replacement = advanceMiningProgress({
        current: completedStone.nextProgress,
        target: DIRT_AT_STONE_POSITION,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0),
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
            deltaSecs: deltaTimeSecs(deltaSecs),
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

      expect(coarse?.accumulatedWork).toBeCloseTo((2 / (25 * 100)) + (8 / (25 * 30)))
      expect(partitioned?.accumulatedWork).toBeCloseTo(coarse?.accumulatedWork ?? -1)
      expect(miningProgressFraction(partitioned)).toBeCloseTo(miningProgressFraction(coarse))
      expect(partitioned?.completed).toBe(coarse?.completed)
    }),
  )

  it.effect('accumulates Efficiency work only during frames where it is active', () =>
    Effect.sync(() => {
      const first = advanceMiningProgress({
        current: null,
        target: STONE,
        isMining: true,
        selectedItem: 'wooden_pickaxe',
        deltaSecs: deltaTimeSecs(0.05),
      })
      const enchanted = advanceMiningProgress({
        current: first.nextProgress,
        target: STONE,
        isMining: true,
        selectedItem: 'wooden_pickaxe',
        efficiencyLevel: enchantmentLevel(2),
        deltaSecs: deltaTimeSecs(0.05),
      })

      expect(first.nextProgress?.accumulatedWork).toBeCloseTo(2 / (25 * 30))
      expect(enchanted.nextProgress?.accumulatedWork).toBeCloseTo(9 / (25 * 30))
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
        deltaSecs: deltaTimeSecs(0.5),
      }).nextProgress
      const dirtProgress = advanceMiningProgress({
        current: stoneProgress,
        target: DIRT,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0.1),
      }).nextProgress

      expect(dirtProgress?.blockKey).not.toBe(stoneProgress?.blockKey)
      expect(dirtProgress?.elapsedSecs).toBeCloseTo(0.1)
      expect(
        advanceMiningProgress({
          current: dirtProgress,
          target: DIRT,
          isMining: false,
          selectedItem: null,
          deltaSecs: deltaTimeSecs(0.1),
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
        efficiencyLevel: enchantmentLevel(1),
        deltaSecs: deltaTimeSecs(4.5),
      })
      const completed = advanceMiningProgress({
        current: first.nextProgress,
        target: STONE,
        isMining: true,
        selectedItem: 'wooden_pickaxe',
        efficiencyLevel: enchantmentLevel(1),
        deltaSecs: deltaTimeSecs(5),
      })
      const heldAfterCompletion = advanceMiningProgress({
        current: completed.nextProgress,
        target: STONE,
        isMining: true,
        selectedItem: 'wooden_pickaxe',
        deltaSecs: deltaTimeSecs(1),
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
        deltaSecs: deltaTimeSecs(requiredSecs),
      })
      const held = advanceMiningProgress({
        current: first.nextProgress,
        target: STONE,
        isMining: true,
        selectedItem: 'stone_pickaxe',
        deltaSecs: deltaTimeSecs(requiredSecs),
      })
      const second = advanceMiningProgress({
        current: held.nextProgress,
        target: STONE_BESIDE,
        isMining: true,
        selectedItem: 'stone_pickaxe',
        deltaSecs: deltaTimeSecs(requiredSecs),
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
          deltaSecs: deltaTimeSecs(0.1),
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

  it.effect('returns schema-branded progress fractions within inclusive boundaries', () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1_000 }), (workMilli) => {
          const fraction = workMilli / 1_000
          const result = miningProgressFraction({
            blockKey: '1,64,2',
            blockId: STONE.blockId,
            elapsedSecs: 0,
            requiredSecs: 1,
            accumulatedWork: fraction,
            completed: false,
          })
          expect(result).toBe(fraction)
          expect(Result.isSuccess(Schema.decodeUnknownResult(MiningProgressFractionSchema)(result))).toBe(true)
        }),
      )
      expect(Result.isSuccess(Schema.decodeUnknownResult(MiningProgressFractionSchema)(0))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(MiningProgressFractionSchema)(1))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(MiningProgressFractionSchema)(-Number.EPSILON))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(MiningProgressFractionSchema)(1 + Number.EPSILON))).toBe(true)
    }),
  )

  it.effect('an instant-break target completes on the first frame with zero required work', () =>
    Effect.sync(() => {
      const dandelion = { position: atBlockPosition(5, 64, 5), blockId: registeredBlockId('dandelion') }
      const result = advanceMiningProgress({
        current: null,
        target: dandelion,
        isMining: true,
        selectedItem: null,
        deltaSecs: deltaTimeSecs(0.1),
      })

      expect(result.shouldBreak).toBe(true)
      expect(result.nextProgress?.completed).toBe(true)
      expect(result.nextProgress?.accumulatedWork).toBe(1)
      expect(miningProgressFraction(result.nextProgress)).toBe(1)
    }),
  )

  it.effect('a null target has no progress to report', () =>
    Effect.sync(() => {
      expect(miningProgressFraction(null)).toBe(0)
    }),
  )

  it.effect('a completed block reports full progress regardless of stored work', () =>
    Effect.sync(() => {
      const progress: MiningProgressState = {
        blockKey: '1,64,2',
        blockId: STONE.blockId,
        elapsedSecs: 1,
        requiredSecs: 1,
        // Deliberately stale/mismatched: `completed` alone must decide the answer.
        accumulatedWork: 0,
        completed: true,
      }
      expect(miningProgressFraction(progress)).toBe(1)
    }),
  )

  it.effect('treats a not-yet-flagged-completed instant-break block as fully mined', () =>
    Effect.sync(() => {
      // Models externally-supplied progress (e.g. persisted state) for a block
      // whose hardness is zero but whose `completed` flag was never set.
      const progress: MiningProgressState = {
        blockKey: '5,64,5',
        blockId: registeredBlockId('dandelion'),
        elapsedSecs: 0,
        requiredSecs: 0,
        accumulatedWork: 0,
        completed: false,
      }
      expect(miningProgressFraction(progress)).toBe(1)
    }),
  )
})
