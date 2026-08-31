import { describe, expect, it } from '@effect/vitest'
import {
  advanceEyeOfEnder,
  eyesOfEnderInFlight,
  EYE_OF_ENDER_ARC_HEIGHT,
  EYE_OF_ENDER_FLIGHT_SECS,
  EYE_OF_ENDER_MAX_HORIZONTAL_DISTANCE,
  initialEyeOfEnderRuntimeState,
  launchEyeOfEnder,
} from '../src/domain/interactions/use-eye-of-ender'

const origin = { x: 0, y: 64, z: 0 }

describe('launchEyeOfEnder', () => {
  it('assigns sequential ids and tracks one entry per throw', () => {
    const first = launchEyeOfEnder(initialEyeOfEnderRuntimeState(), {
      dimension: 'overworld', position: origin, target: { x: 100, y: 64, z: 0 }, breaks: true,
    })
    const second = launchEyeOfEnder(first, {
      dimension: 'overworld', position: origin, target: { x: 0, y: 64, z: 100 }, breaks: false,
    })
    expect(second.eyes.map((eye) => eye.id)).toStrictEqual(['eye-of-ender-1', 'eye-of-ender-2'])
  })

  it('caps horizontal travel at EYE_OF_ENDER_MAX_HORIZONTAL_DISTANCE, toward the target bearing', () => {
    const state = launchEyeOfEnder(initialEyeOfEnderRuntimeState(), {
      dimension: 'overworld', position: origin, target: { x: 1000, y: 64, z: 0 }, breaks: true,
    })
    const eye = state.eyes[0]!
    expect(eye.destination.x).toBeCloseTo(EYE_OF_ENDER_MAX_HORIZONTAL_DISTANCE, 9)
    expect(eye.destination.z).toBeCloseTo(0, 9)
    expect(eye.destination.y).toBe(origin.y + EYE_OF_ENDER_ARC_HEIGHT)
  })

  it('does not cap a target closer than the max distance', () => {
    const state = launchEyeOfEnder(initialEyeOfEnderRuntimeState(), {
      dimension: 'overworld', position: origin, target: { x: 3, y: 64, z: 4 }, breaks: true,
    })
    const eye = state.eyes[0]!
    expect(eye.destination.x).toBeCloseTo(3, 9)
    expect(eye.destination.z).toBeCloseTo(4, 9)
  })

  it('a target exactly at the thrower rises straight up rather than dividing by zero', () => {
    const state = launchEyeOfEnder(initialEyeOfEnderRuntimeState(), {
      dimension: 'overworld', position: origin, target: origin, breaks: true,
    })
    const eye = state.eyes[0]!
    expect(eye.destination).toStrictEqual({ x: 0, y: origin.y + EYE_OF_ENDER_ARC_HEIGHT, z: 0 })
    expect(Number.isFinite(eye.destination.x)).toBe(true)
  })
})

describe('advanceEyeOfEnder', () => {
  const thrown = () => launchEyeOfEnder(initialEyeOfEnderRuntimeState(), {
    dimension: 'overworld', position: origin, target: { x: 8, y: 64, z: 0 }, breaks: true,
  })

  it('leaves an eye in another dimension untouched', () => {
    const state = launchEyeOfEnder(initialEyeOfEnderRuntimeState(), {
      dimension: 'nether', position: origin, target: { x: 8, y: 64, z: 0 }, breaks: true,
    })
    const result = advanceEyeOfEnder(state, 'overworld', 1)
    expect(result.state.eyes).toStrictEqual(state.eyes)
    expect(result.settlements).toStrictEqual([])
  })

  it('interpolates position partway through the flight and does not settle early', () => {
    const halfway = advanceEyeOfEnder(thrown(), 'overworld', EYE_OF_ENDER_FLIGHT_SECS / 2)
    expect(halfway.settlements).toStrictEqual([])
    expect(halfway.state.eyes).toHaveLength(1)
    expect(halfway.state.eyes[0]?.position.x).toBeCloseTo(4, 9)
    // sin(pi/4) of the arc height — above both endpoints, mid-arc.
    expect(halfway.state.eyes[0]?.position.y).toBeCloseTo(
      origin.y + EYE_OF_ENDER_ARC_HEIGHT * Math.sin(Math.PI / 4),
      9,
    )
  })

  it('settles exactly on the frame the flight duration is reached, removing it from state', () => {
    const settled = advanceEyeOfEnder(thrown(), 'overworld', EYE_OF_ENDER_FLIGHT_SECS)
    expect(settled.state.eyes).toStrictEqual([])
    expect(settled.settlements).toStrictEqual([{
      eyeId: 'eye-of-ender-1',
      dimension: 'overworld',
      position: { x: 8, y: origin.y + EYE_OF_ENDER_ARC_HEIGHT, z: 0 },
      breaks: true,
    }])
  })

  it('settles on a frame that overshoots the flight duration, clamped rather than overflying', () => {
    const settled = advanceEyeOfEnder(thrown(), 'overworld', EYE_OF_ENDER_FLIGHT_SECS + 10)
    expect(settled.settlements[0]?.position).toStrictEqual({ x: 8, y: origin.y + EYE_OF_ENDER_ARC_HEIGHT, z: 0 })
  })

  it('splits accumulation across two frames the same as one, for the same total elapsed', () => {
    const oneFrame = advanceEyeOfEnder(thrown(), 'overworld', EYE_OF_ENDER_FLIGHT_SECS / 2)
    const twoFrames = advanceEyeOfEnder(
      advanceEyeOfEnder(thrown(), 'overworld', EYE_OF_ENDER_FLIGHT_SECS / 4).state,
      'overworld',
      EYE_OF_ENDER_FLIGHT_SECS / 4,
    )
    expect(twoFrames.state.eyes[0]?.position.x).toBeCloseTo(oneFrame.state.eyes[0]!.position.x, 9)
  })

  it('treats a non-finite or negative delta as no time passing', () => {
    const state = thrown()
    for (const deltaSeconds of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      const result = advanceEyeOfEnder(state, 'overworld', deltaSeconds)
      expect(result.state.eyes).toStrictEqual(state.eyes)
      expect(result.settlements).toStrictEqual([])
    }
  })
})

describe('eyesOfEnderInFlight', () => {
  it('reports only the eyes in the requested dimension', () => {
    const overworldEye = launchEyeOfEnder(initialEyeOfEnderRuntimeState(), {
      dimension: 'overworld', position: origin, target: { x: 8, y: 64, z: 0 }, breaks: true,
    })
    const both = launchEyeOfEnder(overworldEye, {
      dimension: 'nether', position: origin, target: { x: 8, y: 64, z: 0 }, breaks: true,
    })
    expect(eyesOfEnderInFlight(both, 'overworld')).toHaveLength(1)
    expect(eyesOfEnderInFlight(both, 'nether')).toHaveLength(1)
    expect(eyesOfEnderInFlight(both, 'end')).toStrictEqual([])
  })
})
