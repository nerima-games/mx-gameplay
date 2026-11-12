import {
  FISHING_LURE_WAIT_REDUCTION_TICKS,
  type FishingLootSample,
  type FishingWaitTicks,
} from '@nerima-games/mc-sim'

export const FISHING_MAX_ENCHANTMENT_LEVEL = 3

/** Adjusts the schema-validated wait countdown by vanilla's 100 ticks per Lure level. */
export const fishingWaitTicksWithLure = (waitTicks: FishingWaitTicks, lureLevel: number): number => {
  const effectiveLevel = Math.min(FISHING_MAX_ENCHANTMENT_LEVEL, Math.max(0, Math.trunc(lureLevel)))
  return Math.max(0, waitTicks - FISHING_LURE_WAIT_REDUCTION_TICKS * effectiveLevel)
}

const fishingCategoryWeights = (luckOfTheSeaLevel: number, openWater: boolean) => {
  const effectiveLevel = Math.min(
    FISHING_MAX_ENCHANTMENT_LEVEL,
    Math.max(0, Math.trunc(luckOfTheSeaLevel)),
  )
  const fish = 85 - effectiveLevel
  const junk = 10 - effectiveLevel * 2
  const treasure = openWater ? 5 + effectiveLevel * 2 : 0
  return { fish, junk, treasure, total: fish + junk + treasure }
}

/**
 * Maps a schema-validated uniform fishing sample onto the Luck of the Sea category weights,
 * retaining its relative position within the chosen category. Treasure requires open water.
 */
export const fishingLootSampleWithLuckOfTheSea = (
  sample: FishingLootSample,
  luckOfTheSeaLevel: number,
  openWater: boolean,
): number => {
  const weights = fishingCategoryWeights(luckOfTheSeaLevel, openWater)
  if (weights.fish === 85 && weights.junk === 10 && weights.treasure === 5) return sample

  const draw = sample * weights.total
  if (draw < weights.fish) {
    return (draw / weights.fish) * 0.85
  }
  if (draw < weights.fish + weights.junk) {
    return 0.85 + ((draw - weights.fish) / weights.junk) * 0.1
  }
  return 0.95 + ((draw - weights.fish - weights.junk) / weights.treasure) * 0.05
}
