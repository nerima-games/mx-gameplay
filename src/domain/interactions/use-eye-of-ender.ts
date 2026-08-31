/**
 * ONE RULE, ONE FILE (DN-GP-9): where a thrown eye of ender goes, and when.
 *
 * Lowered from the composing app's `eye-of-ender-runtime.ts`. Unlike `./draw-bow`
 * and `./throw-ender-pearl`, an eye of ender genuinely FLIES rather than
 * resolving in the frame it was thrown: it climbs toward the stronghold's
 * bearing over `EYE_OF_ENDER_FLIGHT_SECS`, then settles — breaking three times
 * in four, surviving to be picked up the fourth. That is a state that has to be
 * carried between frames, which is exactly the category `./draw-bow`'s header
 * found the bow did NOT belong to; this file is the one place in `interactions/`
 * that does.
 *
 * IT IS STILL NOT A ROSTER ENTITY. Nothing here touches `EntityManagerApi` or
 * `mc-sim`: a thrown eye has no health, cannot be attacked, and the caller owns
 * exactly one collection of them (`EyeOfEnderRuntimeState`), not a general
 * roster mc-physics steps. Its motion is a fixed, deterministic interpolation
 * between two points, not a simulated trajectory — the "projectile" category
 * error `./draw-bow`'s header names does not apply here because nothing claims
 * this needs mc-sim's or mc-physics' machinery to answer where it is.
 */
export type Position3 = Readonly<{ x: number; y: number; z: number }>

/** How long a thrown eye is airborne before it settles, in seconds. */
export const EYE_OF_ENDER_FLIGHT_SECS = 2.5

/** How far, at most, an eye travels horizontally toward its target before arcing up. */
export const EYE_OF_ENDER_MAX_HORIZONTAL_DISTANCE = 12

/** How high above its horizontal midpoint an eye's arc peaks, in blocks. */
export const EYE_OF_ENDER_ARC_HEIGHT = 8

export type ThrownEyeOfEnder = Readonly<{
  id: string
  dimension: string
  position: Position3
  start: Position3
  destination: Position3
  ageSeconds: number
  flightSeconds: number
  /** Whether this throw breaks on landing (vanilla: 1 in 4 survive). */
  breaks: boolean
}>

export type EyeOfEnderRuntimeState = Readonly<{
  nextId: number
  eyes: ReadonlyArray<ThrownEyeOfEnder>
}>

/** An eye that finished its flight this frame, at the point it settled. */
export type EyeOfEnderSettlement = Readonly<{
  eyeId: string
  dimension: string
  position: Position3
  breaks: boolean
}>

export const initialEyeOfEnderRuntimeState = (): EyeOfEnderRuntimeState => ({
  nextId: 0,
  eyes: [],
})

/**
 * Throws one eye toward `target`, capping the horizontal travel at
 * `EYE_OF_ENDER_MAX_HORIZONTAL_DISTANCE` and arcing it up by
 * `EYE_OF_ENDER_ARC_HEIGHT` along the way — the bearing this repository's
 * stronghold-triangulation rule reads is which way the eye pointed before it
 * settled, not where it landed, so the cap keeps every throw legible at a
 * glance rather than flying to the stronghold's exact (and, before enough
 * throws, unknown) position.
 *
 * A target exactly at the thrower's position (zero horizontal distance) is not
 * a special case here: `scale` becomes `0` and the eye rises straight up in
 * place, which is the correct degenerate answer rather than a divide-by-zero.
 */
export const launchEyeOfEnder = (
  state: EyeOfEnderRuntimeState,
  input: Readonly<{
    dimension: string
    position: Position3
    target: Position3
    breaks: boolean
  }>,
): EyeOfEnderRuntimeState => {
  const dx = input.target.x - input.position.x
  const dz = input.target.z - input.position.z
  const horizontalDistance = Math.hypot(dx, dz)
  const travelDistance = Math.min(horizontalDistance, EYE_OF_ENDER_MAX_HORIZONTAL_DISTANCE)
  const scale = horizontalDistance === 0 ? 0 : travelDistance / horizontalDistance
  const nextId = state.nextId + 1

  return {
    nextId,
    eyes: [...state.eyes, {
      id: `eye-of-ender-${String(nextId)}`,
      dimension: input.dimension,
      position: input.position,
      start: input.position,
      destination: {
        x: input.position.x + dx * scale,
        y: input.position.y + EYE_OF_ENDER_ARC_HEIGHT,
        z: input.position.z + dz * scale,
      },
      ageSeconds: 0,
      flightSeconds: EYE_OF_ENDER_FLIGHT_SECS,
      breaks: input.breaks,
    }],
  }
}

/**
 * Ages every eye in `dimension` by `deltaSeconds`, moving it along a straight
 * horizontal path and a sine arc vertically (peaking at the flight's
 * midpoint), and settles any that reach the end of their flight this frame —
 * removed from `state.eyes` and reported once each, in `settlements`, rather
 * than lingering at `ageSeconds >= flightSeconds` waiting to be noticed.
 *
 * A non-finite or negative `deltaSeconds` advances nothing (clamped to zero),
 * the inert direction: a broken clock should not silently teleport an eye to
 * its destination.
 */
export const advanceEyeOfEnder = (
  state: EyeOfEnderRuntimeState,
  dimension: string,
  deltaSeconds: number,
): Readonly<{
  state: EyeOfEnderRuntimeState
  settlements: ReadonlyArray<EyeOfEnderSettlement>
}> => {
  const validDeltaSeconds = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
  const eyes: ThrownEyeOfEnder[] = []
  const settlements: EyeOfEnderSettlement[] = []

  for (const eye of state.eyes) {
    if (eye.dimension !== dimension) {
      eyes.push(eye)
      continue
    }

    const ageSeconds = Math.min(eye.flightSeconds, eye.ageSeconds + validDeltaSeconds)
    const progress = ageSeconds / eye.flightSeconds
    const position: Position3 = {
      x: eye.start.x + (eye.destination.x - eye.start.x) * progress,
      y: eye.start.y + (eye.destination.y - eye.start.y) * Math.sin((progress * Math.PI) / 2),
      z: eye.start.z + (eye.destination.z - eye.start.z) * progress,
    }

    if (ageSeconds >= eye.flightSeconds) {
      settlements.push({ eyeId: eye.id, dimension: eye.dimension, position, breaks: eye.breaks })
    } else {
      eyes.push({ ...eye, ageSeconds, position })
    }
  }

  return { state: { ...state, eyes }, settlements }
}

/** Every eye currently in flight in `dimension`, for a renderer to draw. */
export const eyesOfEnderInFlight = (
  state: EyeOfEnderRuntimeState,
  dimension: string,
): ReadonlyArray<ThrownEyeOfEnder> => state.eyes.filter((eye) => eye.dimension === dimension)
