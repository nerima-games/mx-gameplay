/**
 * `domain/interactions/interaction-intent.ts` — what the buttons mean.
 *
 * The reference's four cases are here, and so is the thing its four cases
 * cannot reach: it spells `hasRedstoneInput` as a 13-term `||` and builds its
 * fixture with 8 of the 13 fields, so five of those terms have never been
 * exercised by anything. A chain has no length a test can check; a fold does.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  INERT_ITEM,
  REDSTONE_INPUT_FLAGS,
  anyRedstoneInput,
  resolveInteractionIntent,
  type HeldItemCapabilities,
  type InteractionSnapshot,
} from '../src/domain/interactions/interaction-intent'

const CHARGING_ITEM: HeldItemCapabilities = { charges: true, blocks: false }
const BLOCKING_ITEM: HeldItemCapabilities = { charges: false, blocks: true }

const idle: InteractionSnapshot = {
  paused: false,
  isSpectator: false,
  leftClick: false,
  mouseHeld: false,
  middleClick: false,
  rightClick: false,
  rightMouseHeld: false,
  redstoneFlags: {},
  held: INERT_ITEM,
  chargeStartedAtSecs: null,
}

const snapshot = (overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot => ({
  ...idle,
  ...overrides,
})

describe('redstone input', () => {
  it.effect('EVERY declared flag can turn it on, one at a time', () =>
    Effect.sync(() => {
      // THE ASSERTION THE REFERENCE CANNOT MAKE. Its 13-term `||` is fed a
      // fixture with 8 fields; the other five read as `undefined`, which is
      // falsy, so its tests pass and those terms have never been executed.
      // Deleting any one of them there changes nothing observable.
      for (const flag of REDSTONE_INPUT_FLAGS) {
        expect(anyRedstoneInput({ [flag]: true })).toBe(true)
      }
    }),
  )

  it.effect('an absent flag is false, not undefined-truthy', () =>
    Effect.sync(() => {
      expect(anyRedstoneInput({})).toBe(false)
      expect(anyRedstoneInput({ placeWire: false })).toBe(false)
    }),
  )

  it.effect('REGRESSION: the flag list matches the fold', () =>
    Effect.sync(() => {
      // Guards against the list and the type drifting apart — which is exactly
      // how the reference's fixture came to be missing five names.
      expect(REDSTONE_INPUT_FLAGS.length).toBe(13)
      expect(new Set(REDSTONE_INPUT_FLAGS).size).toBe(REDSTONE_INPUT_FLAGS.length)
    }),
  )

  it.effect('redstone input alone counts as interacting', () =>
    Effect.sync(() => {
      // A player placing a wire has not clicked in the mouse sense, and a
      // `canInteract` that ignored redstone would drop the whole module's input.
      expect(resolveInteractionIntent(snapshot({ redstoneFlags: { placeWire: true } })).canInteract).toBe(
        true,
      )
    }),
  )
})

describe('canInteract', () => {
  it.effect('is false when nothing is pressed', () =>
    Effect.sync(() => {
      expect(resolveInteractionIntent(idle).canInteract).toBe(false)
    }),
  )

  it.effect('any of the five mouse inputs is enough', () =>
    Effect.sync(() => {
      const inputs = ['leftClick', 'mouseHeld', 'middleClick', 'rightClick', 'rightMouseHeld'] as const
      for (const input of inputs) {
        expect(resolveInteractionIntent(snapshot({ [input]: true })).canInteract).toBe(true)
      }
    }),
  )

  it.effect('paused and spectator each suppress it', () =>
    Effect.sync(() => {
      expect(resolveInteractionIntent(snapshot({ leftClick: true, paused: true })).canInteract).toBe(false)
      expect(resolveInteractionIntent(snapshot({ leftClick: true, isSpectator: true })).canInteract).toBe(
        false,
      )
    }),
  )
})

describe('charging', () => {
  it.effect('holding right with a charging item starts a charge', () =>
    Effect.sync(() => {
      expect(
        resolveInteractionIntent(snapshot({ rightMouseHeld: true, held: CHARGING_ITEM }))
          .shouldStartCharge,
      ).toBe(true)
    }),
  )

  it.effect('a charge already running is not restarted', () =>
    Effect.sync(() => {
      // Restarting would reset the draw every frame and the bow would never
      // reach full charge — visible only as "the bow feels weak".
      expect(
        resolveInteractionIntent(
          snapshot({ rightMouseHeld: true, held: CHARGING_ITEM, chargeStartedAtSecs: 12 }),
        ).shouldStartCharge,
      ).toBe(false)
    }),
  )

  it.effect('KEYED ON CAPABILITY: an item that does not charge never starts one', () =>
    Effect.sync(() => {
      // The whole reason this file takes capabilities rather than an item name:
      // a capability also covers a crossbow or trident added later without
      // another item-name `||`.
      expect(
        resolveInteractionIntent(snapshot({ rightMouseHeld: true, held: BLOCKING_ITEM }))
          .shouldStartCharge,
      ).toBe(false)
      expect(
        resolveInteractionIntent(snapshot({ rightMouseHeld: true, held: INERT_ITEM })).shouldStartCharge,
      ).toBe(false)
    }),
  )

  it.effect('releasing the button with a charge running fires it', () =>
    Effect.sync(() => {
      expect(
        resolveInteractionIntent(snapshot({ held: CHARGING_ITEM, chargeStartedAtSecs: 3 }))
          .shouldReleaseCharge,
      ).toBe(true)
    }),
  )

  it.effect('a release while paused or spectating does NOT fire', () =>
    Effect.sync(() => {
      // Unpausing into a fired arrow is the failure. Note this is the opposite
      // guard from the two cleanup outputs below, and both are the reference's.
      expect(
        resolveInteractionIntent(snapshot({ held: CHARGING_ITEM, chargeStartedAtSecs: 3, paused: true }))
          .shouldReleaseCharge,
      ).toBe(false)
      expect(
        resolveInteractionIntent(
          snapshot({ held: CHARGING_ITEM, chargeStartedAtSecs: 3, isSpectator: true }),
        ).shouldReleaseCharge,
      ).toBe(false)
    }),
  )

  it.effect('no charge running means nothing to release', () =>
    Effect.sync(() => {
      expect(resolveInteractionIntent(snapshot({ held: CHARGING_ITEM })).shouldReleaseCharge).toBe(false)
    }),
  )
})

describe('blocking', () => {
  it.effect('holding right with a blocking item blocks', () =>
    Effect.sync(() => {
      expect(
        resolveInteractionIntent(snapshot({ rightMouseHeld: true, held: BLOCKING_ITEM })).shouldBlock,
      ).toBe(true)
    }),
  )

  it.effect('a charging item does not block, and a blocking item does not charge', () =>
    Effect.sync(() => {
      // The two capabilities are independent flags rather than one enum, so
      // this asserts they do not leak into each other.
      const charging = resolveInteractionIntent(
        snapshot({ rightMouseHeld: true, held: CHARGING_ITEM }),
      )
      const blocking = resolveInteractionIntent(snapshot({ rightMouseHeld: true, held: BLOCKING_ITEM }))

      expect(charging.shouldBlock).toBe(false)
      expect(blocking.shouldStartCharge).toBe(false)
    }),
  )

  it.effect('a spectator stops blocking even while holding the button', () =>
    Effect.sync(() => {
      expect(
        resolveInteractionIntent(
          snapshot({ rightMouseHeld: true, held: BLOCKING_ITEM, isSpectator: true }),
        ).shouldResetBlocking,
      ).toBe(true)
    }),
  )
})

describe('the two cleanup outputs, which do NOT guard on paused', () => {
  it.effect('break progress resets whenever the button is not held, even paused', () =>
    Effect.sync(() => {
      // Transcribed from the reference, and the asymmetry is deliberate: these
      // two UNDO state rather than starting an action. A pause that stopped the
      // cleanup would leave a half-drawn bow charging across the pause.
      expect(resolveInteractionIntent(snapshot({ paused: true })).shouldResetBreakProgress).toBe(true)
      expect(resolveInteractionIntent(snapshot({ mouseHeld: true, paused: true })).shouldResetBreakProgress).toBe(
        false,
      )
    }),
  )

  it.effect('the charge clears when the button is released and the item cannot charge', () =>
    Effect.sync(() => {
      expect(resolveInteractionIntent(snapshot({ held: INERT_ITEM })).shouldClearCharge).toBe(true)
      expect(resolveInteractionIntent(snapshot({ held: CHARGING_ITEM })).shouldClearCharge).toBe(false)
    }),
  )

  it.effect('REGRESSION: cleanup is unaffected by paused, unlike the other six', () =>
    Effect.sync(() => {
      // Stated as its own case so that "tidying" the guards to be consistent
      // fails here rather than in a bug report about a bow that fires itself.
      const paused = resolveInteractionIntent(snapshot({ paused: true, isSpectator: true }))

      expect(paused.shouldResetBreakProgress).toBe(true)
      expect(paused.shouldClearCharge).toBe(true)
      expect(paused.canInteract).toBe(false)
      expect(paused.shouldReleaseCharge).toBe(false)
    }),
  )
})
