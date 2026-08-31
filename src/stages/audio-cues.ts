/**
 * WHEN this repository's actions play a sound, not WHICH sound plays.
 *
 * Lowered from the composing app's `audio-runtime.ts` (the placement latch and
 * the inventory-open/close and confirmed-placement announcements) and
 * `footstep-runtime.ts` (the when-to-step accumulator). The cue SELECTION rule
 * — a surface classification or a fixed event name to a `SoundCueId` — is
 * `@nerima-games/mc-audio`'s (`footstepCueFor`, and the `'inventoryOpen'` /
 * `'inventoryClose'` / `'blockPlace'` literals below, which name mc-audio's
 * own published cue roster rather than inventing one here); this file only
 * decides the moment each rule fires.
 *
 * `surfaceForBlockType` from the composing app's original is NOT ported.
 * Its own header already said why not: "mirrors the published block
 * vocabulary only at the package boundary; replace it with kernel property
 * lookup when compose consumes that release." That release is out —
 * `@nerima-games/mc-kernel`'s block property table now carries
 * `footstepMaterial` per block id directly (`block-property-data.ts`,
 * identical four-value vocabulary to mc-audio's `FootstepSurface`) — so
 * `advanceFootstepRuntime` below reads it via `propertyOfBlockId` instead of
 * re-deriving a surface from a block-name string list that would drift from
 * the registry the moment either changes.
 */
import { footstepCueFor, type CuePlayOptions, type SoundCueId } from '@nerima-games/mc-audio'
import { propertyOfBlockId, type Position } from '@nerima-games/mc-kernel'

/** The one capability every rule in this file needs from a host's audio runtime. */
export type AudioCuePort = {
  readonly play: (cueId: SoundCueId, options?: CuePlayOptions) => void
}

export type PlacementAudioLatch = {
  readonly request: (position?: Position) => void
  readonly confirm: (consumedPlacements: ReadonlyArray<unknown>) => boolean
}

/**
 * Gameplay's placement path exposes no request/response correlation id, so
 * this holds exactly ONE pending position between `request` (fired when a
 * placement is attempted) and `confirm` (fired once the frame settles) and
 * replaces it on every new attempt — a second `request` before the first
 * `confirm` means the first attempt never resolved, and holding it would
 * announce a placement at the wrong location instead of none at all.
 */
export const makePlacementAudioLatch = (audio: AudioCuePort): PlacementAudioLatch => {
  let pendingPosition: Position | undefined
  return {
    request: (position) => {
      pendingPosition = position
    },
    confirm: (consumedPlacements) => {
      if (consumedPlacements.length === 0) return false
      const position = pendingPosition
      pendingPosition = undefined
      return announceConfirmedPlacements(audio, consumedPlacements, position)
    },
  }
}

/** Plays the open/close cue on a genuine transition, and does nothing for a frame that reports no change. */
export const announceInventoryTransition = (
  audio: AudioCuePort,
  previousOpen: boolean,
  nextOpen: boolean,
): boolean => {
  if (previousOpen === nextOpen) return false
  audio.play(nextOpen ? 'inventoryOpen' : 'inventoryClose')
  return true
}

export const announceConfirmedPlacements = (
  audio: AudioCuePort,
  consumedPlacements: ReadonlyArray<unknown>,
  position?: Position,
): boolean => {
  if (consumedPlacements.length === 0) return false
  audio.play('blockPlace', position === undefined ? undefined : { position })
  return true
}

export type FootstepRuntimeState = {
  readonly distanceSinceLastStep: number
}

export const initialFootstepRuntimeState = (): FootstepRuntimeState => ({
  distanceSinceLastStep: 0,
})

/** Horizontal distance travelled between footstep cues, in blocks. */
export const FOOTSTEP_DISTANCE = 2

export type FootstepAdvanceInput = {
  readonly grounded: boolean
  readonly horizontalDistance: number
  /** The block the player is currently standing on. */
  readonly standingOnBlockId: number
  readonly sneaking: boolean
  readonly dead: boolean
  readonly dimensionChanged: boolean
  readonly position: Position
}

/**
 * Accumulates horizontal travel and fires one footstep cue per
 * `FOOTSTEP_DISTANCE` crossed, carrying the remainder into the next frame
 * rather than resetting it — the same "credit carries forward" shape
 * `../domain/entities/dropped-item.ts`'s lifetime tracker uses for elapsed
 * time, applied to distance instead.
 *
 * RESETS TO ZERO on death, a dimension change, or leaving the ground: none of
 * those are "no distance travelled this frame", they are "the walk that was
 * accumulating no longer means anything" — a player who respawns across the
 * map should not owe a footstep for the teleport, and one still rising from a
 * jump should not credit the ground they left.
 *
 * A surface with no registered cue (`footstepCueFor` returning `undefined`,
 * today only `'default'`) still advances the distance counter — the walk is
 * real even where this repository has no sound for it yet — it just never
 * calls `play`.
 */
export const advanceFootstepRuntime = (
  state: FootstepRuntimeState,
  input: FootstepAdvanceInput,
  audio: AudioCuePort,
): FootstepRuntimeState => {
  if (input.dead || input.dimensionChanged || !input.grounded) return initialFootstepRuntimeState()

  const distance = state.distanceSinceLastStep + Math.max(0, input.horizontalDistance)
  const surface = propertyOfBlockId(input.standingOnBlockId, 'footstepMaterial')
  const cueId = footstepCueFor(surface)
  if (cueId === undefined || distance < FOOTSTEP_DISTANCE) {
    return { distanceSinceLastStep: distance }
  }

  const steps = Math.floor(distance / FOOTSTEP_DISTANCE)
  for (let index = 0; index < steps; index += 1) {
    audio.play(cueId, { position: input.position, gainScale: input.sneaking ? 0.55 : 1 })
  }
  return { distanceSinceLastStep: distance - steps * FOOTSTEP_DISTANCE }
}
