import type { PlaybackSpeed } from './url-state.js'

export type PlaybackState = {
  readonly playing: boolean
  readonly speed: PlaybackSpeed
}

export type PlaybackCallbacks = {
  readonly advance: () => boolean
  readonly render: () => void
  readonly reset: () => void
  readonly stateChanged: (state: PlaybackState) => void
}

export type PlaybackController = {
  readonly play: () => void
  readonly pause: () => void
  readonly stepFrame: () => void
  readonly setSpeed: (speed: PlaybackSpeed) => void
  readonly reset: () => void
  readonly dispose: () => void
  readonly state: () => PlaybackState
}

const FRAME_DURATION_MS = 1000 / 60
const MAX_CATCH_UP_FRAMES = 16

export const createPlayback = (
  callbacks: PlaybackCallbacks,
  initial: PlaybackState,
): PlaybackController => {
  let playing = initial.playing
  let speed = initial.speed
  let frameRequest: number | undefined
  let lastTimestamp: number | undefined
  let accumulatedMs = 0
  let disposed = false

  const state = (): PlaybackState => ({ playing, speed })
  const notify = (): void => callbacks.stateChanged(state())

  const cancelFrame = (): void => {
    if (frameRequest !== undefined) {
      cancelAnimationFrame(frameRequest)
      frameRequest = undefined
    }
  }

  const scheduleFrame = (): void => {
    if (playing && !disposed && frameRequest === undefined) {
      frameRequest = requestAnimationFrame(onAnimationFrame)
    }
  }

  const onAnimationFrame = (timestamp: number): void => {
    frameRequest = undefined
    if (!playing || disposed) return

    if (lastTimestamp === undefined) {
      lastTimestamp = timestamp
    } else {
      accumulatedMs = Math.min(
        accumulatedMs + Math.max(0, timestamp - lastTimestamp) * speed,
        FRAME_DURATION_MS * MAX_CATCH_UP_FRAMES,
      )
      lastTimestamp = timestamp
      let advanced = false
      while (playing && accumulatedMs >= FRAME_DURATION_MS) {
        if (!callbacks.advance()) {
          playing = false
          lastTimestamp = undefined
          accumulatedMs = 0
          notify()
          break
        }
        accumulatedMs -= FRAME_DURATION_MS
        advanced = true
      }
      if (advanced) callbacks.render()
    }

    scheduleFrame()
  }

  const play = (): void => {
    if (disposed || playing) return
    playing = true
    lastTimestamp = undefined
    scheduleFrame()
    notify()
  }

  const pause = (): void => {
    if (!playing) return
    playing = false
    lastTimestamp = undefined
    accumulatedMs = 0
    cancelFrame()
    notify()
  }

  const stepFrame = (): void => {
    if (disposed) return
    if (playing) {
      playing = false
      cancelFrame()
    }
    lastTimestamp = undefined
    accumulatedMs = 0
    if (callbacks.advance()) callbacks.render()
    notify()
  }

  const setSpeed = (next: PlaybackSpeed): void => {
    speed = next
    lastTimestamp = undefined
    accumulatedMs = 0
    notify()
  }

  const reset = (): void => {
    if (disposed) return
    playing = false
    lastTimestamp = undefined
    accumulatedMs = 0
    cancelFrame()
    callbacks.reset()
    callbacks.render()
    notify()
  }

  const dispose = (): void => {
    playing = false
    disposed = true
    lastTimestamp = undefined
    accumulatedMs = 0
    cancelFrame()
  }

  const controller: PlaybackController = { play, pause, stepFrame, setSpeed, reset, dispose, state }
  if (playing) scheduleFrame()
  return controller
}
