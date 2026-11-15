import { position, type DeltaTimeSecs, type WorldPosition } from '@nerima-games/mc-kernel'

export const EXPERIENCE_ORB_ATTRACTION_RADIUS_BLOCKS = 7.25
export const EXPERIENCE_ORB_PICKUP_RADIUS_BLOCKS = 1

type EncodedWorldPosition = Readonly<{
  dimension: WorldPosition['dimension']
  x: number
  y: number
  z: number
}>

export type ExperienceOrbPullEvaluation = Readonly<{
  position: EncodedWorldPosition
  movementAttempted: boolean
}> & (
  | Readonly<{ withinPickupRange: false }>
  | Readonly<{ withinPickupRange: true; distanceSquared: number }>
)

const coordinatesOf = (positionValue: WorldPosition) =>
  position(positionValue.x, positionValue.y, positionValue.z)

const distanceSquaredBetween = (
  left: Readonly<{ x: number; y: number; z: number }>,
  right: Readonly<{ x: number; y: number; z: number }>,
): number => {
  const dx = right.x - left.x
  const dy = right.y - left.y
  const dz = right.z - left.z
  return dx * dx + dy * dy + dz * dz
}

/** Typed stage helper for positions already decoded by their owner schemas. */
export const isExperienceOrbWithinAttractionRangeForPositions = (
  orbPosition: WorldPosition,
  playerPosition: WorldPosition,
): boolean => {
  if (orbPosition.dimension !== playerPosition.dimension) return false
  const orb = coordinatesOf(orbPosition)
  const player = coordinatesOf(playerPosition)
  return distanceSquaredBetween(orb, player) <= EXPERIENCE_ORB_ATTRACTION_RADIUS_BLOCKS ** 2
}

/** Typed stage helper for positions already decoded by their owner schemas. */
export const isExperienceOrbWithinPickupRangeForPositions = (
  orbPosition: WorldPosition,
  playerPosition: WorldPosition,
): boolean => {
  if (orbPosition.dimension !== playerPosition.dimension) return false
  const orb = coordinatesOf(orbPosition)
  const player = coordinatesOf(playerPosition)
  return distanceSquaredBetween(orb, player) <= EXPERIENCE_ORB_PICKUP_RADIUS_BLOCKS ** 2
}

/**
 * Computes a pull and its pickup test for already-decoded stage inputs.
 * The returned position is encoded for the owner commit boundary.
 */
export const pullExperienceOrbTowardPlayerForPositions = (
  orbPosition: WorldPosition,
  playerPosition: WorldPosition,
  dtSeconds: DeltaTimeSecs,
): ExperienceOrbPullEvaluation => {
  const orb = coordinatesOf(orbPosition)
  const player = coordinatesOf(playerPosition)
  let nextX: number = orb.x
  let nextY: number = orb.y
  let nextZ: number = orb.z
  let movementAttempted = false
  if (orbPosition.dimension === playerPosition.dimension) {
    const dx = player.x - orb.x
    const dy = player.y - orb.y
    const dz = player.z - orb.z
    const distance = Math.hypot(dx, dy, dz)
    if (distance !== 0 && distance <= EXPERIENCE_ORB_ATTRACTION_RADIUS_BLOCKS) {
      movementAttempted = true
      const closeness = 1 - distance / EXPERIENCE_ORB_ATTRACTION_RADIUS_BLOCKS
      const speed = 2 * closeness * closeness
      const travel = Math.min(distance, speed * Number(dtSeconds))
      // travel / distance is in [0, 1], so every axis stays between the two finite endpoints.
      nextX = orb.x + dx / distance * travel
      nextY = orb.y + dy / distance * travel
      nextZ = orb.z + dz / distance * travel
    }
  }

  const nextPosition: EncodedWorldPosition = {
    dimension: orbPosition.dimension,
    x: nextX,
    y: nextY,
    z: nextZ,
  }
  if (orbPosition.dimension !== playerPosition.dimension) {
    return { position: nextPosition, movementAttempted, withinPickupRange: false }
  }
  const distanceSquared = distanceSquaredBetween(nextPosition, player)
  return distanceSquared <= EXPERIENCE_ORB_PICKUP_RADIUS_BLOCKS ** 2
    ? { position: nextPosition, movementAttempted, withinPickupRange: true, distanceSquared }
    : { position: nextPosition, movementAttempted, withinPickupRange: false }
}
