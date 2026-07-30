import {
  propertyOfBlockId,
  type BlockPosition,
  type HarvestToolCategory,
  type HarvestToolRequirement,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { positionKeyOf } from '../block-position-key'
import { NO_TOOL, type BlockLootContext } from './block-loot'

export const MINING_TICKS_PER_SECOND = 20

export type MiningToolProfile = {
  readonly category: HarvestToolCategory
  readonly speedMultiplier: number
}

export const HAND_MINING_TOOL: MiningToolProfile = {
  category: 'none',
  speedMultiplier: 1,
}

export const WOODEN_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  speedMultiplier: 2,
}

export const STONE_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  speedMultiplier: 4,
}

export const IRON_PICKAXE_MINING_TOOL: MiningToolProfile = {
  category: 'pickaxe',
  speedMultiplier: 6,
}

export type MiningProgressState = {
  readonly blockKey: string
  readonly blockId: number
  readonly elapsedSecs: number
  readonly requiredSecs: number
  readonly accumulatedWork: number
  readonly completed: boolean
}

export type MiningTarget = {
  readonly position: BlockPosition
  readonly blockId: number
}

export type AdvanceMiningProgressInput = {
  readonly current: MiningProgressState | null
  readonly target: MiningTarget | null
  readonly isMining: boolean
  readonly selectedItem: ItemType | null
  readonly deltaSecs: number
}

export type AdvanceMiningProgressResult = {
  readonly nextProgress: MiningProgressState | null
  readonly shouldBreak: boolean
}

export const miningToolForItem = (item: ItemType | null): MiningToolProfile => {
  if (item === 'wooden_pickaxe') return WOODEN_PICKAXE_MINING_TOOL
  if (item === 'stone_pickaxe') return STONE_PICKAXE_MINING_TOOL
  if (item === 'iron_pickaxe') return IRON_PICKAXE_MINING_TOOL
  return HAND_MINING_TOOL
}

export const miningLootContextForItem = (item: ItemType | null): BlockLootContext => {
  if (item === 'wooden_pickaxe') return { heldTier: 'wooden' }
  if (item === 'stone_pickaxe') return { heldTier: 'stone' }
  if (item === 'iron_pickaxe') return { heldTier: 'iron' }
  return NO_TOOL
}

/** `minTier` is intentionally irrelevant here; it gates drops, not mining speed. */
export const effectiveMiningSpeed = (
  tool: MiningToolProfile,
  requirement: HarvestToolRequirement,
): number => {
  const matchesCategory = requirement.category !== 'none' && tool.category === requirement.category
  if (!matchesCategory || !Number.isFinite(tool.speedMultiplier) || tool.speedMultiplier <= 0) {
    return HAND_MINING_TOOL.speedMultiplier
  }
  return tool.speedMultiplier
}

export const miningDurationSecsForBlock = (blockId: number, item: ItemType | null): number => {
  const hardness = propertyOfBlockId(blockId, 'hardness')
  if (!Number.isFinite(hardness) || hardness <= 0) {
    return 0
  }

  const requirement = propertyOfBlockId(blockId, 'harvestTool')
  const speed = effectiveMiningSpeed(miningToolForItem(item), requirement)
  return hardness / (MINING_TICKS_PER_SECOND * speed)
}

const miningWorkRequiredForBlock = (blockId: number): number => {
  const hardness = propertyOfBlockId(blockId, 'hardness')
  return Number.isFinite(hardness) && hardness > 0 ? hardness / MINING_TICKS_PER_SECOND : 0
}

const miningSpeedForBlock = (blockId: number, item: ItemType | null): number =>
  effectiveMiningSpeed(
    miningToolForItem(item),
    propertyOfBlockId(blockId, 'harvestTool'),
  )

const normaliseDeltaSecs = (deltaSecs: number): number =>
  Number.isFinite(deltaSecs) && deltaSecs > 0 ? deltaSecs : 0

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
  deltaSecs,
}: AdvanceMiningProgressInput): AdvanceMiningProgressResult => {
  if (!isMining || target === null) {
    return { nextProgress: null, shouldBreak: false }
  }

  const blockKey = positionKeyOf(target.position)
  const sameTarget = current?.blockKey === blockKey && current.blockId === target.blockId
  const requiredWork = miningWorkRequiredForBlock(target.blockId)
  if (sameTarget && current.completed) {
    const elapsedSecs = normaliseElapsedSecs(current.elapsedSecs)
    return {
      nextProgress: {
        ...current,
        elapsedSecs,
        requiredSecs: elapsedSecs,
        accumulatedWork: requiredWork,
      },
      shouldBreak: false,
    }
  }

  const speed = miningSpeedForBlock(target.blockId, selectedItem)
  const previousWork = sameTarget
    ? normaliseAccumulatedWork(current.accumulatedWork, requiredWork)
    : 0
  const previousElapsedSecs = sameTarget ? normaliseElapsedSecs(current.elapsedSecs) : 0
  const availableSecs = normaliseDeltaSecs(deltaSecs)
  const remainingWork = Math.max(0, requiredWork - previousWork)
  const consumedSecs = requiredWork === 0 ? 0 : Math.min(availableSecs, remainingWork / speed)
  const accumulatedWork = Math.min(requiredWork, previousWork + consumedSecs * speed)
  const elapsedSecs = previousElapsedSecs + consumedSecs
  const completed = requiredWork === 0 || accumulatedWork >= requiredWork
  const progressFraction = requiredWork === 0 ? 1 : accumulatedWork / requiredWork
  const requiredSecs = completed
    ? elapsedSecs
    : progressFraction === 0
      ? requiredWork / speed
      : elapsedSecs / progressFraction
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

export const miningProgressFraction = (progress: MiningProgressState | null): number => {
  if (progress === null) {
    return 0
  }
  if (progress.completed) {
    return 1
  }
  const requiredWork = miningWorkRequiredForBlock(progress.blockId)
  if (requiredWork === 0) {
    return 1
  }
  return normaliseAccumulatedWork(progress.accumulatedWork, requiredWork) / requiredWork
}
