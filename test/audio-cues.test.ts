import { describe, expect, it, vi } from '@effect/vitest'
import { blockIdOf } from '@nerima-games/mc-kernel'
import type { CuePlayOptions, SoundCueId } from '@nerima-games/mc-audio'
import {
  advanceFootstepRuntime,
  announceConfirmedPlacements,
  announceInventoryTransition,
  FOOTSTEP_DISTANCE,
  initialFootstepRuntimeState,
  makePlacementAudioLatch,
  type AudioCuePort,
  type FootstepAdvanceInput,
} from '../src/stages/audio-cues'

const makeAudio = (): { readonly audio: AudioCuePort; readonly play: ReturnType<typeof vi.fn> } => {
  const play = vi.fn<(cueId: SoundCueId, options?: CuePlayOptions) => void>()
  return { audio: { play }, play }
}

describe('announceInventoryTransition', () => {
  it('plays inventoryOpen on a closed-to-open transition', () => {
    const { audio, play } = makeAudio()
    expect(announceInventoryTransition(audio, false, true)).toBe(true)
    expect(play).toHaveBeenCalledExactlyOnceWith('inventoryOpen')
  })

  it('plays inventoryClose on an open-to-closed transition', () => {
    const { audio, play } = makeAudio()
    expect(announceInventoryTransition(audio, true, false)).toBe(true)
    expect(play).toHaveBeenCalledExactlyOnceWith('inventoryClose')
  })

  it('plays nothing when the frame reports no change', () => {
    const { audio, play } = makeAudio()
    expect(announceInventoryTransition(audio, true, true)).toBe(false)
    expect(announceInventoryTransition(audio, false, false)).toBe(false)
    expect(play).not.toHaveBeenCalled()
  })
})

describe('announceConfirmedPlacements', () => {
  it('plays blockPlace with a position when at least one placement is consumed', () => {
    const { audio, play } = makeAudio()
    const position = { x: 1, y: 2, z: 3 }
    expect(announceConfirmedPlacements(audio, [{}], position)).toBe(true)
    expect(play).toHaveBeenCalledExactlyOnceWith('blockPlace', { position })
  })

  it('plays blockPlace with no options when no position is known', () => {
    const { audio, play } = makeAudio()
    expect(announceConfirmedPlacements(audio, [{}])).toBe(true)
    expect(play).toHaveBeenCalledExactlyOnceWith('blockPlace', undefined)
  })

  it('plays nothing when nothing was consumed', () => {
    const { audio, play } = makeAudio()
    expect(announceConfirmedPlacements(audio, [])).toBe(false)
    expect(play).not.toHaveBeenCalled()
  })
})

describe('makePlacementAudioLatch', () => {
  it('announces at the requested position once confirmed', () => {
    const { audio, play } = makeAudio()
    const latch = makePlacementAudioLatch(audio)
    const position = { x: 5, y: 5, z: 5 }
    latch.request(position)
    expect(latch.confirm([{}])).toBe(true)
    expect(play).toHaveBeenCalledExactlyOnceWith('blockPlace', { position })
  })

  it('a second request before confirm REPLACES the pending position rather than queuing both', () => {
    const { audio, play } = makeAudio()
    const latch = makePlacementAudioLatch(audio)
    latch.request({ x: 1, y: 1, z: 1 })
    latch.request({ x: 2, y: 2, z: 2 })
    latch.confirm([{}])
    expect(play).toHaveBeenCalledExactlyOnceWith('blockPlace', { position: { x: 2, y: 2, z: 2 } })
  })

  it('confirming with nothing consumed announces nothing and leaves the pending position untouched', () => {
    const { audio, play } = makeAudio()
    const latch = makePlacementAudioLatch(audio)
    const position = { x: 1, y: 1, z: 1 }
    latch.request(position)
    expect(latch.confirm([])).toBe(false)
    expect(play).not.toHaveBeenCalled()

    // The no-op confirm returned before touching `pendingPosition`, so the
    // NEXT (real) confirm still announces at the position from the original
    // request.
    latch.confirm([{}])
    expect(play).toHaveBeenCalledExactlyOnceWith('blockPlace', { position })
  })

  it('confirming with no prior request announces without a position', () => {
    const { audio, play } = makeAudio()
    const latch = makePlacementAudioLatch(audio)
    latch.confirm([{}])
    expect(play).toHaveBeenCalledExactlyOnceWith('blockPlace', undefined)
  })
})

describe('advanceFootstepRuntime', () => {
  const dirtId = blockIdOf('dirt')!
  const stoneId = blockIdOf('stone')!
  const oakPlanksId = blockIdOf('oak_planks')!
  const airId = blockIdOf('air')!

  const footstepInput = (overrides: Partial<FootstepAdvanceInput> = {}): FootstepAdvanceInput => ({
    grounded: true,
    horizontalDistance: 0,
    standingOnBlockId: dirtId,
    sneaking: false,
    dead: false,
    dimensionChanged: false,
    position: { x: 0, y: 64, z: 0 },
    ...overrides,
  })

  it('accumulates distance without firing a cue before FOOTSTEP_DISTANCE is reached', () => {
    const { audio, play } = makeAudio()
    const state = advanceFootstepRuntime(
      initialFootstepRuntimeState(),
      footstepInput({ horizontalDistance: FOOTSTEP_DISTANCE - 0.01 }),
      audio,
    )
    expect(state.distanceSinceLastStep).toBeCloseTo(FOOTSTEP_DISTANCE - 0.01, 9)
    expect(play).not.toHaveBeenCalled()
  })

  it('fires exactly one grass cue at exactly FOOTSTEP_DISTANCE, resetting the remainder to zero', () => {
    const { audio, play } = makeAudio()
    const state = advanceFootstepRuntime(
      initialFootstepRuntimeState(),
      footstepInput({ standingOnBlockId: dirtId, horizontalDistance: FOOTSTEP_DISTANCE }),
      audio,
    )
    expect(play).toHaveBeenCalledExactlyOnceWith('footstepGrass', { position: footstepInput().position, gainScale: 1 })
    expect(state.distanceSinceLastStep).toBe(0)
  })

  it('selects the cue for stone and wood surfaces via the block registry, not a hardcoded list', () => {
    for (const [blockId, cueId] of [[stoneId, 'footstepStone'], [oakPlanksId, 'footstepWood']] as const) {
      const { audio, play } = makeAudio()
      advanceFootstepRuntime(
        initialFootstepRuntimeState(),
        footstepInput({ standingOnBlockId: blockId, horizontalDistance: FOOTSTEP_DISTANCE }),
        audio,
      )
      expect(play).toHaveBeenCalledExactlyOnceWith(cueId, expect.anything())
    }
  })

  it('advances distance for a "default"-material surface without ever playing a cue', () => {
    const { audio, play } = makeAudio()
    const state = advanceFootstepRuntime(
      initialFootstepRuntimeState(),
      footstepInput({ standingOnBlockId: airId, horizontalDistance: FOOTSTEP_DISTANCE * 3 }),
      audio,
    )
    expect(play).not.toHaveBeenCalled()
    expect(state.distanceSinceLastStep).toBeCloseTo(FOOTSTEP_DISTANCE * 3, 9)
  })

  it('fires multiple cues in one frame that crosses more than one FOOTSTEP_DISTANCE', () => {
    const { audio, play } = makeAudio()
    const state = advanceFootstepRuntime(
      initialFootstepRuntimeState(),
      footstepInput({ horizontalDistance: FOOTSTEP_DISTANCE * 2.5 }),
      audio,
    )
    expect(play).toHaveBeenCalledTimes(2)
    expect(state.distanceSinceLastStep).toBeCloseTo(FOOTSTEP_DISTANCE * 0.5, 9)
  })

  it('halves the gain while sneaking', () => {
    const { audio, play } = makeAudio()
    advanceFootstepRuntime(
      initialFootstepRuntimeState(),
      footstepInput({ horizontalDistance: FOOTSTEP_DISTANCE, sneaking: true }),
      audio,
    )
    expect(play).toHaveBeenCalledExactlyOnceWith('footstepGrass', expect.objectContaining({ gainScale: 0.55 }))
  })

  it('treats negative horizontal distance as zero rather than reducing the accumulator', () => {
    const { audio } = makeAudio()
    const state = advanceFootstepRuntime(
      { distanceSinceLastStep: 1 },
      footstepInput({ horizontalDistance: -5 }),
      audio,
    )
    expect(state.distanceSinceLastStep).toBe(1)
  })

  it.each([
    ['dead', footstepInput({ dead: true, horizontalDistance: 5 })],
    ['dimension changed', footstepInput({ dimensionChanged: true, horizontalDistance: 5 })],
    ['not grounded', footstepInput({ grounded: false, horizontalDistance: 5 })],
  ])('resets accumulated distance to zero and plays nothing when %s', (_label, input) => {
    const { audio, play } = makeAudio()
    const state = advanceFootstepRuntime({ distanceSinceLastStep: 1.5 }, input, audio)
    expect(state).toStrictEqual(initialFootstepRuntimeState())
    expect(play).not.toHaveBeenCalled()
  })
})
