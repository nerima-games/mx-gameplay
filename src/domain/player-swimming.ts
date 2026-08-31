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

/** Seconds of held breath before drowning starts, fully submerged. */
export const MAX_SWIMMING_OXYGEN_SECS = 15

/** Oxygen regained per second once the head clears the surface. */
export const SWIMMING_OXYGEN_RECOVERY_PER_SEC = 4

/** Seconds between each point of drowning damage, once oxygen has run out. */
export const DROWNING_DAMAGE_INTERVAL_SECS = 1

export const DROWNING_DAMAGE_POINTS = 2

export type PlayerSwimmingState = Readonly<{
  active: boolean
  fullySubmerged: boolean
  oxygenSecs: number
  drowningElapsedSecs: number
  velocity: SwimmingVelocity
}>

export type AdvancePlayerSwimmingInput = Readonly<{
  feetInWater: boolean
  eyesInWater: boolean
  dead: boolean
  horizontalInput: HorizontalSwimmingInput
  verticalInput: number
  deltaSecs: number
}>

export type AdvancePlayerSwimmingResult = Readonly<{
  state: PlayerSwimmingState
  drowningDamagePoints: number
}>

export const initialPlayerSwimmingState = (): PlayerSwimmingState => ({
  active: false,
  fullySubmerged: false,
  oxygenSecs: MAX_SWIMMING_OXYGEN_SECS,
  drowningElapsedSecs: 0,
  velocity: { x: 0, y: 0, z: 0 },
})

/**
 * One frame of breath-holding and its consequence, layered over
 * `applyPlayerSwimming`'s velocity: fully submerged (eyes under, not merely
 * feet under, matching Java Edition) drains oxygen; surfacing recovers it.
 * Oxygen at exactly zero is still holding breath — drowning damage begins
 * only once it has been at zero for a full `DROWNING_DAMAGE_INTERVAL_SECS`,
 * and repeats every interval after, each tick reported as whole points so a
 * caller applying damage never sees a fractional health loss.
 */
export const advancePlayerSwimming = (
  state: PlayerSwimmingState,
  input: AdvancePlayerSwimmingInput,
): AdvancePlayerSwimmingResult => {
  if (input.dead) {
    return { state: initialPlayerSwimmingState(), drowningDamagePoints: 0 }
  }

  const deltaSecs = finiteOrZero(input.deltaSecs) > 0 ? input.deltaSecs : 0
  const active = input.feetInWater || input.eyesInWater
  const fullySubmerged = active && input.eyesInWater
  const oxygenSecs = fullySubmerged
    ? Math.max(0, state.oxygenSecs - deltaSecs)
    : Math.min(MAX_SWIMMING_OXYGEN_SECS, state.oxygenSecs + SWIMMING_OXYGEN_RECOVERY_PER_SEC * deltaSecs)
  const drowningElapsedSecs = oxygenSecs === 0 && fullySubmerged
    ? state.drowningElapsedSecs + deltaSecs
    : 0
  const damageTicks = Math.floor(drowningElapsedSecs / DROWNING_DAMAGE_INTERVAL_SECS)
  const velocity = applyPlayerSwimming({
    velocity: active ? state.velocity : { x: 0, y: 0, z: 0 },
    verticalInput: input.verticalInput,
    horizontalInput: input.horizontalInput,
    isInWater: active,
    deltaSeconds: deltaSecs,
  })

  return {
    state: {
      active,
      fullySubmerged,
      oxygenSecs,
      drowningElapsedSecs: drowningElapsedSecs - damageTicks * DROWNING_DAMAGE_INTERVAL_SECS,
      velocity: active ? velocity : { x: 0, y: 0, z: 0 },
    },
    drowningDamagePoints: damageTicks * DROWNING_DAMAGE_POINTS,
  }
}
