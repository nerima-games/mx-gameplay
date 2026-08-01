import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  SWIMMING_BUOYANCY_BLOCKS_PER_S2,
  SWIMMING_DRAG_PER_SECOND,
  SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2,
  SWIMMING_VERTICAL_ACCELERATION_BLOCKS_PER_S2,
  applyPlayerSwimming,
  type PlayerSwimmingInput,
} from '../domain/player-swimming'

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
