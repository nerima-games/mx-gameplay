export type SwimmingVelocity = Readonly<{
  x: number
  y: number
  z: number
}>

export type HorizontalSwimmingInput = Readonly<{
  x: number
  z: number
}>

export type PlayerSwimmingInput = Readonly<{
  velocity: SwimmingVelocity
  verticalInput: number
  horizontalInput: HorizontalSwimmingInput
  isInWater: boolean
  deltaSeconds: number
}>

/** Upward acceleration in blocks per second squared while submerged. */
export const SWIMMING_BUOYANCY_BLOCKS_PER_S2 = 4

/** Acceleration from ascend/dive input in blocks per second squared. */
export const SWIMMING_VERTICAL_ACCELERATION_BLOCKS_PER_S2 = 8

/** Acceleration per horizontal input axis in blocks per second squared. */
export const SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2 = 10

/** Fraction of velocity removed per second, capped at all velocity for long steps. */
export const SWIMMING_DRAG_PER_SECOND = 2

const finiteOrZero = (value: number): number => (Number.isFinite(value) ? value : 0)

const unitInput = (value: number): number => Math.max(-1, Math.min(1, finiteOrZero(value)))

/**
 * Computes the next swimming velocity without reading or mutating host state.
 * Velocity uses blocks/second and time uses seconds.
 */
export const applyPlayerSwimming = (input: PlayerSwimmingInput): SwimmingVelocity => {
  if (!input.isInWater) {
    return input.velocity
  }

  const deltaSeconds = Number.isFinite(input.deltaSeconds) ? Math.max(0, input.deltaSeconds) : 0
  const drag = Math.max(0, 1 - SWIMMING_DRAG_PER_SECOND * deltaSeconds)
  const horizontalX = unitInput(input.horizontalInput.x)
  const horizontalZ = unitInput(input.horizontalInput.z)
  const vertical = unitInput(input.verticalInput)

  return {
    x:
      (finiteOrZero(input.velocity.x) +
        horizontalX * SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2 * deltaSeconds) *
      drag,
    y:
      (finiteOrZero(input.velocity.y) +
        (SWIMMING_BUOYANCY_BLOCKS_PER_S2 +
          vertical * SWIMMING_VERTICAL_ACCELERATION_BLOCKS_PER_S2) *
          deltaSeconds) *
      drag,
    z:
      (finiteOrZero(input.velocity.z) +
        horizontalZ * SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2 * deltaSeconds) *
      drag,
  }
}
