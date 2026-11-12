import {
  blockPositionKeyOf,
  satisfiesHarvestTier,
  type BlockId,
  propertyOfBlockId,
  type BlockPosition,
  type DeltaTimeSecs as DeltaTimeSecsValue,
  type HarvestToolCategory,
  type HarvestToolRequirement,
  type HarvestTier,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { Brand, Result, Schema } from 'effect'
import { EnchantmentLevel, type EnchantmentLevel as EnchantmentLevelValue } from '@nerima-games/mc-kernel/domain/quantities'
import { NO_TOOL, type BlockLootContext } from './block-loot.js'
import { miningSpeedWithEnchantments } from '../enchantment.js'
import {
  MiningSpeedMultiplierSchema,
  type MiningSpeedMultiplier as MiningSpeedMultiplierValue,
} from '../status-effect.js'

export const MINING_TICKS_PER_SECOND = 20
const NO_EFFICIENCY_LEVEL = Result.getOrThrow(EnchantmentLevel.result(0))

export type MiningProgressFraction = number & Brand.Brand<'MiningProgressFraction'>

export const MiningProgressFractionSchema: Schema.Codec<MiningProgressFraction, number> = Schema.Finite
  .check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  .pipe(Schema.brand('MiningProgressFraction'))

const DEFAULT_MINING_SPEED_MULTIPLIER: MiningSpeedMultiplierValue = Result.getOrThrow(
  Schema.decodeUnknownResult(MiningSpeedMultiplierSchema)(1),
)

const miningProgressFractionOf = (fraction: number): MiningProgressFraction => Result.getOrThrow(
  Schema.decodeUnknownResult(MiningProgressFractionSchema)(fraction),
)

export type MiningToolProfile = {
  readonly category: HarvestToolCategory
  readonly tier: HarvestTier
  readonly speedMultiplier: number
  readonly efficiencyLevel?: EnchantmentLevelValue
}

export type EffectiveMiningSpeedError = 'invalid-speed-multiplier'

export const HAND_MINING_TOOL: MiningToolProfile = {
  category: 'none',
  tier: 'none',
  speedMultiplier: 1,
}

export const WOODEN_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  tier: 'wooden',
  speedMultiplier: 2,
}

export const STONE_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  tier: 'stone',
  speedMultiplier: 4,
}

export const IRON_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  tier: 'iron',
  speedMultiplier: 6,
}

export const DIAMOND_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  tier: 'diamond',
  speedMultiplier: 8,
}

export const GOLD_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  tier: 'wooden',
  speedMultiplier: 12,
}

export const NETHERITE_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  tier: 'netherite',
  speedMultiplier: 9,
}

export type MiningProgressState = {
  readonly blockKey: string
  readonly blockId: BlockId
  readonly elapsedSecs: number
  readonly requiredSecs: number
  readonly accumulatedWork: number
  readonly completed: boolean
}

export type MiningTarget = {
  readonly position: BlockPosition
  readonly blockId: BlockId
}

export type AdvanceMiningProgressInput = {
  readonly current: MiningProgressState | null
  readonly target: MiningTarget | null
  readonly isMining: boolean
  readonly selectedItem: ItemType | null
  readonly efficiencyLevel?: EnchantmentLevelValue
  readonly miningSpeedMultiplier?: MiningSpeedMultiplierValue
  readonly deltaSecs: DeltaTimeSecsValue
}

export type AdvanceMiningProgressResult = {
  readonly nextProgress: MiningProgressState | null
  readonly shouldBreak: boolean
}

export const miningToolForItem = (
  item: ItemType | null,
  efficiencyLevel: EnchantmentLevelValue = NO_EFFICIENCY_LEVEL,
): MiningToolProfile => {
  const enchanted = (tool: MiningToolProfile): MiningToolProfile =>
    efficiencyLevel === NO_EFFICIENCY_LEVEL ? tool : { ...tool, efficiencyLevel }
  if (item === 'wooden_pickaxe') return enchanted(WOODEN_PICKAXE_MINING_TOOL)
  if (item === 'stone_pickaxe') return enchanted(STONE_PICKAXE_MINING_TOOL)
  if (item === 'iron_pickaxe') return enchanted(IRON_PICKAXE_MINING_TOOL)
  if (item === 'diamond_pickaxe') return enchanted(DIAMOND_PICKAXE_MINING_TOOL)
  if (item === 'gold_pickaxe') return enchanted(GOLD_PICKAXE_MINING_TOOL)
  if (item === 'netherite_pickaxe') return enchanted(NETHERITE_PICKAXE_MINING_TOOL)
  return HAND_MINING_TOOL
}

export const miningLootContextForItem = (item: ItemType | null): BlockLootContext => {
  if (item === 'wooden_pickaxe' || item === 'gold_pickaxe') return { heldTier: 'wooden' }
  if (item === 'stone_pickaxe') return { heldTier: 'stone' }
  if (item === 'iron_pickaxe') return { heldTier: 'iron' }
  if (item === 'diamond_pickaxe') return { heldTier: 'diamond' }
  if (item === 'netherite_pickaxe') return { heldTier: 'netherite' }
  return NO_TOOL
}

/** Java Edition's slower hardness divisor applies when the held tool cannot harvest. */
export const effectiveMiningSpeed = (
  tool: MiningToolProfile,
  requirement: HarvestToolRequirement,
): Result.Result<number, EffectiveMiningSpeedError> => {
  if (!Number.isFinite(tool.speedMultiplier) || tool.speedMultiplier <= 0) {
    return Result.fail('invalid-speed-multiplier')
  }
  const suitableTool = requirement.category !== 'none' &&
    tool.category === requirement.category &&
    satisfiesHarvestTier(requirement, tool.tier)
  if (!suitableTool) {
    return Result.succeed(HAND_MINING_TOOL.speedMultiplier)
  }
  const efficiency = tool.efficiencyLevel === undefined
    ? []
    : [{ id: 'efficiency' as const, level: tool.efficiencyLevel }]
  return Result.succeed(miningSpeedWithEnchantments(
    tool.speedMultiplier,
    efficiency,
    suitableTool,
  ))
}

const hardnessOfBlockId = (blockId: BlockId): number =>
  Result.getOrThrow(propertyOfBlockId(blockId, 'hardness'))

const harvestToolRequirementOfBlockId = (blockId: BlockId): HarvestToolRequirement =>
  Result.getOrThrow(propertyOfBlockId(blockId, 'harvestTool'))

const canHarvestWithTool = (
  tool: MiningToolProfile,
  requirement: HarvestToolRequirement,
): boolean => requirement.minTier === 'none' || (
  tool.category === requirement.category && satisfiesHarvestTier(requirement, tool.tier)
)

export const miningDurationSecsForBlock = (
  blockId: BlockId,
  item: ItemType | null,
  efficiencyLevel: EnchantmentLevelValue = NO_EFFICIENCY_LEVEL,
  miningSpeedMultiplier: MiningSpeedMultiplierValue = DEFAULT_MINING_SPEED_MULTIPLIER,
): number => {
  const hardness = hardnessOfBlockId(blockId)
  if (hardness === 0) return 0
  if (!Number.isFinite(hardness) || hardness < 0) return Number.POSITIVE_INFINITY
  const requirement = harvestToolRequirementOfBlockId(blockId)
  const tool = miningToolForItem(item, efficiencyLevel)
  const speed = Result.getOrThrow(effectiveMiningSpeed(tool, requirement)) *
    miningSpeedMultiplier
  const divisor = canHarvestWithTool(tool, requirement) ? 30 : 100
  return Math.ceil((hardness * divisor) / speed) / MINING_TICKS_PER_SECOND
}

const hardnessOfMiningTarget = (blockId: BlockId): number => {
  const hardness = hardnessOfBlockId(blockId)
  return Number.isFinite(hardness) ? hardness : Number.POSITIVE_INFINITY
}

const miningSpeedForBlock = (
  blockId: BlockId,
  item: ItemType | null,
  efficiencyLevel: EnchantmentLevelValue,
  miningSpeedMultiplier: MiningSpeedMultiplierValue,
): Readonly<{ hardness: number; speed: number; divisor: number }> => {
  const tool = miningToolForItem(item, efficiencyLevel)
  const requirement = harvestToolRequirementOfBlockId(blockId)
  return {
    hardness: hardnessOfMiningTarget(blockId),
    speed: Result.getOrThrow(effectiveMiningSpeed(tool, requirement)) *
      miningSpeedMultiplier,
    divisor: canHarvestWithTool(tool, requirement) ? 30 : 100,
  }
}

const normaliseAccumulatedWork = (accumulatedWork: number, requiredWork: number): number =>
  Number.isFinite(accumulatedWork)
    ? Math.max(0, Math.min(requiredWork, accumulatedWork))
    : 0

const normaliseElapsedSecs = (elapsedSecs: number): number =>
  Number.isFinite(elapsedSecs) && elapsedSecs > 0 ? elapsedSecs : 0

export const advanceMiningProgress = ({
  current,
  target,
  isMining,
  selectedItem,
  efficiencyLevel = NO_EFFICIENCY_LEVEL,
  miningSpeedMultiplier = DEFAULT_MINING_SPEED_MULTIPLIER,
  deltaSecs,
}: AdvanceMiningProgressInput): AdvanceMiningProgressResult => {
  if (!isMining || target === null) {
    return { nextProgress: null, shouldBreak: false }
  }

  const blockKey = blockPositionKeyOf(target.position)
  const sameTarget = current?.blockKey === blockKey && current.blockId === target.blockId
  const mining = miningSpeedForBlock(
    target.blockId,
    selectedItem,
    efficiencyLevel,
    miningSpeedMultiplier,
  )
  if (sameTarget && current.completed) {
    const elapsedSecs = normaliseElapsedSecs(current.elapsedSecs)
    return {
      nextProgress: {
        ...current,
        elapsedSecs,
        requiredSecs: elapsedSecs,
        accumulatedWork: 1,
      },
      shouldBreak: false,
    }
  }

  const hardness = mining.hardness
  if (hardness < 0 || !Number.isFinite(hardness)) {
    const elapsedSecs = sameTarget ? normaliseElapsedSecs(current.elapsedSecs) : 0
    return {
      nextProgress: {
        blockKey,
        blockId: target.blockId,
        elapsedSecs,
        requiredSecs: Number.POSITIVE_INFINITY,
        accumulatedWork: 0,
        completed: false,
      },
      shouldBreak: false,
    }
  }
  if (hardness === 0) {
    return {
      nextProgress: {
        blockKey,
        blockId: target.blockId,
        elapsedSecs: 0,
        requiredSecs: 0,
        accumulatedWork: 1,
        completed: true,
      },
      shouldBreak: true,
    }
  }
  const previousWork = sameTarget
    ? normaliseAccumulatedWork(current.accumulatedWork, 1)
    : 0
  const previousElapsedSecs = sameTarget ? normaliseElapsedSecs(current.elapsedSecs) : 0
  const availableSecs = deltaSecs
  const totalElapsedSecs = previousElapsedSecs + availableSecs
  const previousTicks = Math.floor(previousElapsedSecs * MINING_TICKS_PER_SECOND + 1e-9)
  const totalTicks = Math.floor(totalElapsedSecs * MINING_TICKS_PER_SECOND + 1e-9)
  const availableTicks = Math.max(0, totalTicks - previousTicks)
  const damagePerTick = mining.speed / (hardness * mining.divisor)
  const remainingWork = Math.max(0, 1 - previousWork)
  const ticksToFinish = Math.ceil(remainingWork / damagePerTick - 1e-12)
  const consumedTicks = Math.min(availableTicks, ticksToFinish)
  const accumulatedWork = Math.min(1, previousWork + consumedTicks * damagePerTick)
  const completed = consumedTicks >= ticksToFinish
  const elapsedSecs = completed
    ? (previousTicks + consumedTicks) / MINING_TICKS_PER_SECOND
    : totalElapsedSecs
  const remainingSecs = (1 - accumulatedWork) / (damagePerTick * MINING_TICKS_PER_SECOND)
  const requiredSecs = completed
    ? elapsedSecs
    : Math.ceil((elapsedSecs + remainingSecs) * MINING_TICKS_PER_SECOND - 1e-9) /
      MINING_TICKS_PER_SECOND
  const nextProgress: MiningProgressState = {
    blockKey,
    blockId: target.blockId,
    elapsedSecs,
    requiredSecs,
    accumulatedWork,
    completed,
  }

  return { nextProgress, shouldBreak: completed }
}

export const miningProgressFraction = (
  progress: MiningProgressState | null,
): MiningProgressFraction => {
  if (progress === null) {
    return miningProgressFractionOf(0)
  }
  if (progress.completed) {
    return miningProgressFractionOf(1)
  }
  const hardness = hardnessOfMiningTarget(progress.blockId)
  if (hardness === 0) {
    return miningProgressFractionOf(1)
  }
  if (!Number.isFinite(hardness) || hardness < 0) return miningProgressFractionOf(0)
  return miningProgressFractionOf(normaliseAccumulatedWork(progress.accumulatedWork, 1))
}
