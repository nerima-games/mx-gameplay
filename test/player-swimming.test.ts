import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  advancePlayerSwimming,
  applyPlayerSwimming,
  DROWNING_DAMAGE_INTERVAL_SECS,
  DROWNING_DAMAGE_POINTS,
  initialPlayerSwimmingState,
  MAX_SWIMMING_OXYGEN_SECS,
  SWIMMING_BUOYANCY_BLOCKS_PER_S2,
  SWIMMING_DRAG_PER_SECOND,
  SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2,
  SWIMMING_OXYGEN_RECOVERY_PER_SEC,
  SWIMMING_VERTICAL_ACCELERATION_BLOCKS_PER_S2,
  type AdvancePlayerSwimmingInput,
  type PlayerSwimmingInput,
} from '../src/domain/player-swimming'

const advanceInput = (
  overrides: Partial<AdvancePlayerSwimmingInput> = {},
): AdvancePlayerSwimmingInput => ({
  feetInWater: true,
  eyesInWater: true,
  dead: false,
  horizontalInput: { x: 0, z: 0 },
  verticalInput: 0,
  deltaSecs: 1,
  ...overrides,
})

const input = (overrides: Partial<PlayerSwimmingInput> = {}): PlayerSwimmingInput => ({
  velocity: { x: 0, y: 0, z: 0 },
  verticalInput: 0,
  horizontalInput: { x: 0, z: 0 },
  isInWater: true,
  deltaSeconds: 0.1,
  ...overrides,
})

describe('player swimming', () => {
  it.effect('leaves velocity unchanged outside water', () =>
    Effect.sync(() => {
      const velocity = { x: Number.NaN, y: -2, z: 3 }
      expect(applyPlayerSwimming(input({ velocity, isInWater: false }))).toBe(velocity)
    }),
  )

  it.effect('combines buoyancy, controls, and drag in water', () =>
    Effect.sync(() => {
      const deltaSeconds = 0.1
      const drag = 1 - SWIMMING_DRAG_PER_SECOND * deltaSeconds
      const result = applyPlayerSwimming(
        input({
          velocity: { x: 1, y: -1, z: 0 },
          verticalInput: 1,
          horizontalInput: { x: -1, z: 0.5 },
          deltaSeconds,
        }),
      )

      expect(result.x).toBeCloseTo(
        (1 - SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2 * deltaSeconds) * drag,
        9,
      )
      expect(result.y).toBeCloseTo(
        (-1 +
          (SWIMMING_BUOYANCY_BLOCKS_PER_S2 + SWIMMING_VERTICAL_ACCELERATION_BLOCKS_PER_S2) *
            deltaSeconds) *
          drag,
        9,
      )
      expect(result.z).toBeCloseTo(
        0.5 * SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2 * deltaSeconds * drag,
        9,
      )
    }),
  )

  it.effect('clamps controls and safely handles invalid numeric inputs', () =>
    Effect.sync(() => {
      const invalidDelta = applyPlayerSwimming(
        input({
          velocity: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 2 },
          verticalInput: Number.NaN,
          horizontalInput: { x: Number.POSITIVE_INFINITY, z: -20 },
          deltaSeconds: Number.NaN,
        }),
      )
      expect(invalidDelta).toEqual({ x: 0, y: 0, z: 2 })

      const negativeDelta = applyPlayerSwimming(input({ velocity: { x: 1, y: 2, z: 3 }, deltaSeconds: -1 }))
      expect(negativeDelta).toEqual({ x: 1, y: 2, z: 3 })

      const clamped = applyPlayerSwimming(
        input({ verticalInput: 20, horizontalInput: { x: -20, z: 20 } }),
      )
      expect(Object.values(clamped).every(Number.isFinite)).toBe(true)
      expect(clamped.x).toBeCloseTo(-SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2 * 0.1 * 0.8, 9)
      expect(clamped.z).toBeCloseTo(SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2 * 0.1 * 0.8, 9)
    }),
  )
})

describe('advancePlayerSwimming: oxygen and drowning boundaries', () => {
  it.effect('feet-only submersion is active but not fully submerged, and does not drain oxygen', () =>
    Effect.sync(() => {
      const { state } = advancePlayerSwimming(
        initialPlayerSwimmingState(),
        advanceInput({ feetInWater: true, eyesInWater: false }),
      )
      expect(state.active).toBe(true)
      expect(state.fullySubmerged).toBe(false)
      expect(state.oxygenSecs).toBe(MAX_SWIMMING_OXYGEN_SECS)
    }),
  )

  it.effect('fully submerged drains oxygen, clamped at zero rather than going negative', () =>
    Effect.sync(() => {
      const almostOut = advancePlayerSwimming(
        initialPlayerSwimmingState(),
        advanceInput({ deltaSecs: MAX_SWIMMING_OXYGEN_SECS - 0.5 }),
      ).state
      expect(almostOut.oxygenSecs).toBe(0.5)
      expect(almostOut.drowningElapsedSecs).toBe(0)

      // A short frame that reaches exactly zero: the frame's own duration
      // (0.5s) is below the damage interval, so reaching zero costs no
      // damage BY ITSELF — it is time spent AT zero that does, pinned by the
      // interval-boundary test below.
      const atZero = advancePlayerSwimming(almostOut, advanceInput({ deltaSecs: 0.5 }))
      expect(atZero.state.oxygenSecs).toBe(0)
      expect(atZero.drowningDamagePoints).toBe(0)

      // A further second past zero: 0 - 1 clamps to 0, not -1.
      const pastZero = advancePlayerSwimming(atZero.state, advanceInput({ deltaSecs: 1 }))
      expect(pastZero.state.oxygenSecs).toBe(0)
    }),
  )

  it.effect('drowning damage begins exactly on the interval boundary, not before', () =>
    Effect.sync(() => {
      const outOfOxygen = advancePlayerSwimming(
        initialPlayerSwimmingState(),
        advanceInput({ deltaSecs: MAX_SWIMMING_OXYGEN_SECS }),
      ).state
      expect(outOfOxygen.oxygenSecs).toBe(0)

      // One tick short of the interval: no damage yet.
      const justShort = advancePlayerSwimming(
        outOfOxygen,
        advanceInput({ deltaSecs: DROWNING_DAMAGE_INTERVAL_SECS - 0.01 }),
      )
      expect(justShort.drowningDamagePoints).toBe(0)

      // Exactly on the interval: one tick of damage, and the elapsed clock
      // resets rather than accumulating past the tick it just paid for.
      const onBoundary = advancePlayerSwimming(justShort.state, advanceInput({ deltaSecs: 0.01 }))
      expect(onBoundary.drowningDamagePoints).toBe(DROWNING_DAMAGE_POINTS)
      expect(onBoundary.state.drowningElapsedSecs).toBeCloseTo(0, 9)
    }),
  )

  it.effect('a single long frame past several intervals pays every tick it crossed, once', () =>
    Effect.sync(() => {
      const outOfOxygen = advancePlayerSwimming(
        initialPlayerSwimmingState(),
        advanceInput({ deltaSecs: MAX_SWIMMING_OXYGEN_SECS }),
      ).state

      // 2.5 intervals in one frame: 2 whole ticks of damage, 0.5s carried over.
      const longFrame = advancePlayerSwimming(
        outOfOxygen,
        advanceInput({ deltaSecs: DROWNING_DAMAGE_INTERVAL_SECS * 2.5 }),
      )
      expect(longFrame.drowningDamagePoints).toBe(DROWNING_DAMAGE_POINTS * 2)
      expect(longFrame.state.drowningElapsedSecs).toBeCloseTo(DROWNING_DAMAGE_INTERVAL_SECS * 0.5, 9)
    }),
  )

  it.effect('surfacing recovers oxygen and clears the drowning clock immediately', () =>
    Effect.sync(() => {
      const drowning = advancePlayerSwimming(
        initialPlayerSwimmingState(),
        advanceInput({ deltaSecs: MAX_SWIMMING_OXYGEN_SECS + DROWNING_DAMAGE_INTERVAL_SECS * 0.5 }),
      ).state
      expect(drowning.oxygenSecs).toBe(0)
      expect(drowning.drowningElapsedSecs).toBeGreaterThan(0)

      const surfaced = advancePlayerSwimming(
        drowning,
        advanceInput({ feetInWater: false, eyesInWater: false, deltaSecs: 1 }),
      )
      expect(surfaced.state.active).toBe(false)
      expect(surfaced.state.oxygenSecs).toBe(Math.min(MAX_SWIMMING_OXYGEN_SECS, SWIMMING_OXYGEN_RECOVERY_PER_SEC))
      expect(surfaced.state.drowningElapsedSecs).toBe(0)
      expect(surfaced.drowningDamagePoints).toBe(0)
      expect(surfaced.state.velocity).toStrictEqual({ x: 0, y: 0, z: 0 })
    }),
  )

  it.effect('a non-finite or negative delta is treated as no time passing at all', () =>
    Effect.sync(() => {
      const start = initialPlayerSwimmingState()
      for (const deltaSecs of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
        const result = advancePlayerSwimming(start, advanceInput({ deltaSecs }))
        expect(result.state.oxygenSecs).toBe(MAX_SWIMMING_OXYGEN_SECS)
        expect(result.drowningDamagePoints).toBe(0)
      }
    }),
  )

  it.effect('dying mid-drown resets to the initial state rather than leaving stale oxygen debt', () =>
    Effect.sync(() => {
      const drowning = advancePlayerSwimming(
        initialPlayerSwimmingState(),
        advanceInput({ deltaSecs: MAX_SWIMMING_OXYGEN_SECS + DROWNING_DAMAGE_INTERVAL_SECS }),
      ).state

      const afterDeath = advancePlayerSwimming(drowning, advanceInput({ dead: true }))
      expect(afterDeath).toStrictEqual({
        state: initialPlayerSwimmingState(),
        drowningDamagePoints: 0,
      })
    }),
  )
})
