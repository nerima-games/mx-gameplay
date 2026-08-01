/**
 * The portal dwell timer and the re-entry cooldown.
 *
 * The reference implementation has no unit test for this rule at all — its
 * `packages/app/application/frame/stages/physics-stage-portal.test.ts` drives
 * the whole stage against mocked services, and `docs/testing.md` §3-1 records
 * that only 2 of its cases survived the port and that both were about chunk
 * coordinates. So there is no suite to port and nothing to strengthen; what
 * follows is written against the arithmetic in `physics-stage-portal.ts:35-100`
 * directly, and the four properties worth naming are:
 *
 *   EXACTLY ONCE PER CROSSING. The state that fires is also the state that
 *   starts the cooldown, so no sequence of inputs can fire twice without an
 *   intervening exit. This is the property the reference gets from an early
 *   return and the type gets from `Cooling` carrying no dwell.
 *
 *   THE FRAME RATE CANNOT CHANGE THE ANSWER. Four frames of 1.0 s, eight of
 *   0.5 s and one of 4.0 s all fire on the frame that reaches the threshold.
 *   A rule that fired a frame late on one of them would be a rule whose
 *   behaviour depended on the machine.
 *
 *   THE COOLDOWN IS WHY TRAVEL DOES NOT OSCILLATE. A traveller arrives standing
 *   INSIDE the destination portal — `inPortal` is true on the very next frame —
 *   and the last test here drives exactly that and asserts it does not fire
 *   again until the cooldown is spent.
 *
 *   THE CONSTANTS ARE PINNED AS `> 0`, NOT AS `=== 4`. Both are transcribed and
 *   neither is justified (`domain/portal-dwell.ts`'s header says so), so
 *   correcting one must not be a test edit. What IS pinned is the behaviour AT
 *   the constant, which is what a caller depends on.
 *
 * Regression names (docs/design-notes.md): gameplay-portal-fires-once,
 * gameplay-portal-cooldown-blocks-dwell, gameplay-portal-exit-forgets-dwell.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DeltaTimeSecs } from '../src/domain/frame-contract'
import {
  OUTSIDE_PORTAL,
  PORTAL_ACTIVATION_SECS,
  PORTAL_REENTRY_COOLDOWN_SECS,
  stepPortalDwell,
  type PortalDwell,
} from '../src/domain/portal-dwell'

const dt = (seconds: number): DeltaTimeSecs => DeltaTimeSecs(seconds)

const STANDING = (dwelledSecs: number): PortalDwell => ({ _tag: 'Standing', dwelledSecs })
const COOLING = (remainingSecs: number): PortalDwell => ({ _tag: 'Cooling', remainingSecs })

/** Drive `frames` steps of `seconds` each, collecting the frames that fired. */
const run = (
  from: PortalDwell,
  inPortal: boolean,
  seconds: number,
  frames: number,
): { readonly dwell: PortalDwell; readonly firedOn: ReadonlyArray<number> } => {
  const firedOn: Array<number> = []
  let dwell = from
  for (let frame = 1; frame <= frames; frame += 1) {
    const step = stepPortalDwell(dwell, inPortal, dt(seconds))
    dwell = step.dwell
    if (step.travels) {
      firedOn.push(frame)
    }
  }
  return { dwell, firedOn }
}

describe('the two durations', () => {
  it.effect('are both positive, which is the only thing about them that is an argument', () =>
    Effect.sync(() => {
      // A zero activation delay would fire on contact — a different rule, not a
      // faster one. A zero cooldown would let travel oscillate forever, since a
      // traveller arrives standing inside the destination portal.
      expect(PORTAL_ACTIVATION_SECS).toBeGreaterThan(0)
      expect(PORTAL_REENTRY_COOLDOWN_SECS).toBeGreaterThan(0)
    }),
  )
})

describe('standing in a portal', () => {
  it.effect('a traveller nowhere near a portal stays exactly where they are', () =>
    Effect.sync(() => {
      const step = stepPortalDwell(OUTSIDE_PORTAL, false, dt(1))

      expect(step.dwell).toStrictEqual(OUTSIDE_PORTAL)
      expect(step.travels).toBe(false)
    }),
  )

  it.effect('entering and dwelling are ONE frame, not two', () =>
    Effect.sync(() => {
      // The reference adds the delta to a dwell of zero on the very frame it
      // finds the traveller in the block. Splitting them would cost a frame on
      // every crossing.
      expect(stepPortalDwell(OUTSIDE_PORTAL, true, dt(0.5)).dwell).toStrictEqual(STANDING(0.5))
    }),
  )

  it.effect('the dwell accumulates while the traveller stays put', () =>
    Effect.sync(() => {
      const { dwell, firedOn } = run(OUTSIDE_PORTAL, true, 0.5, 7)

      expect(dwell).toStrictEqual(STANDING(3.5))
      expect(firedOn).toStrictEqual([])
    }),
  )

  it.effect('fires on the frame that reaches the threshold and not before', () =>
    Effect.sync(() => {
      const eighth = stepPortalDwell(STANDING(PORTAL_ACTIVATION_SECS - 0.5), true, dt(0.5))

      expect(eighth.travels).toBe(true)
      // One tick short of the threshold is still a dwell, not a crossing.
      expect(stepPortalDwell(STANDING(PORTAL_ACTIVATION_SECS - 0.5), true, dt(0.25)).travels).toBe(false)
    }),
  )

  it.effect('fires on the same frame whatever the frame rate is', () =>
    Effect.sync(() => {
      // Four frames of 1 s, eight of 0.5 s, one of 4 s. A rule whose answer
      // depended on the machine would disagree with itself here.
      expect(run(OUTSIDE_PORTAL, true, PORTAL_ACTIVATION_SECS / 4, 4).firedOn).toStrictEqual([4])
      expect(run(OUTSIDE_PORTAL, true, PORTAL_ACTIVATION_SECS / 8, 8).firedOn).toStrictEqual([8])
      expect(run(OUTSIDE_PORTAL, true, PORTAL_ACTIVATION_SECS, 1).firedOn).toStrictEqual([1])
    }),
  )

  it.effect('OVERSHOOT COUNTS: one enormous frame fires rather than deferring', () =>
    Effect.sync(() => {
      // A lag spike must not buy the traveller extra frames in the portal, for
      // the reason `domain/mob/creeper-fuse.ts` gives about the same `>=`.
      const step = stepPortalDwell(OUTSIDE_PORTAL, true, dt(PORTAL_ACTIVATION_SECS * 10))

      expect(step.travels).toBe(true)
      expect(step.dwell).toStrictEqual(COOLING(PORTAL_REENTRY_COOLDOWN_SECS))
    }),
  )

  it.effect('a zero delta advances nothing, in every state', () =>
    Effect.sync(() => {
      // A frame may be scheduled twice inside one clock tick, so a dwell that
      // accrued on a zero delta would fire sooner on a faster machine.
      expect(stepPortalDwell(STANDING(3.5), true, dt(0)).dwell).toStrictEqual(STANDING(3.5))
      expect(stepPortalDwell(COOLING(2), true, dt(0)).dwell).toStrictEqual(COOLING(2))
      expect(stepPortalDwell(OUTSIDE_PORTAL, false, dt(0)).dwell).toStrictEqual(OUTSIDE_PORTAL)
    }),
  )

  it.effect('stepping out FORGETS the wait rather than draining it', () =>
    Effect.sync(() => {
      const out = stepPortalDwell(STANDING(PORTAL_ACTIVATION_SECS - 0.1), false, dt(0.5))

      expect(out.dwell).toStrictEqual(OUTSIDE_PORTAL)
      expect(out.travels).toBe(false)
      // ...and stepping back in starts from zero, not from 3.9.
      expect(stepPortalDwell(out.dwell, true, dt(0.5)).dwell).toStrictEqual(STANDING(0.5))
    }),
  )
})

describe('the re-entry cooldown', () => {
  it.effect('firing starts the full cooldown and clears the dwell', () =>
    Effect.sync(() => {
      const step = stepPortalDwell(STANDING(PORTAL_ACTIVATION_SECS), true, dt(0))

      expect(step.travels).toBe(true)
      expect(step.dwell).toStrictEqual(COOLING(PORTAL_REENTRY_COOLDOWN_SECS))
    }),
  )

  it.effect('ticks down while the traveller is still standing in the portal', () =>
    Effect.sync(() => {
      // `inPortal` is TRUE throughout, because a traveller arrives inside the
      // destination portal. The cooldown branch does not consult it.
      const { dwell, firedOn } = run(COOLING(PORTAL_REENTRY_COOLDOWN_SECS), true, 1, 2)

      expect(dwell).toStrictEqual(COOLING(PORTAL_REENTRY_COOLDOWN_SECS - 2))
      expect(firedOn).toStrictEqual([])
    }),
  )

  it.effect('the frame that spends the cooldown accrues no dwell; the next one may', () =>
    Effect.sync(() => {
      const spent = stepPortalDwell(COOLING(0.5), true, dt(0.5))

      // Not `STANDING(0)` — the reference returns before it can look at the
      // block, so this frame is worth nothing to the traveller.
      expect(spent.dwell).toStrictEqual(OUTSIDE_PORTAL)
      expect(stepPortalDwell(spent.dwell, true, dt(0.5)).dwell).toStrictEqual(STANDING(0.5))
    }),
  )

  it.effect('a frame longer than the cooldown ends it outright, and does not leave a spent one behind', () =>
    Effect.sync(() => {
      expect(stepPortalDwell(COOLING(0.5), false, dt(1000)).dwell).toStrictEqual(OUTSIDE_PORTAL)
      // `Cooling(0)` must not be a state the machine can sit in: it reads as
      // "cooling" and behaves as "outside", and the frame after it would be the
      // second frame in a row that accrued nothing.
      expect(stepPortalDwell(COOLING(0.5), false, dt(0.5)).dwell).toStrictEqual(OUTSIDE_PORTAL)
    }),
  )

  it.effect('cannot fire, whatever it is handed', () =>
    Effect.sync(() => {
      for (const inPortal of [true, false]) {
        for (const seconds of [0, 0.5, PORTAL_REENTRY_COOLDOWN_SECS, 1000]) {
          expect(stepPortalDwell(COOLING(PORTAL_REENTRY_COOLDOWN_SECS), inPortal, dt(seconds)).travels).toBe(
            false,
          )
        }
      }
    }),
  )
})

describe('a whole crossing', () => {
  it.effect('fires EXACTLY ONCE and then refuses for the length of the cooldown', () =>
    Effect.sync(() => {
      // The traveller stands in a portal and never moves — which is what really
      // happens, because arriving puts them inside the destination portal. Over
      // 16 seconds at 1 s a frame the portal must fire on frame 4 (the dwell),
      // then not again until the cooldown is spent AND a fresh dwell completes:
      // frames 5-8 cool, frames 9-12 dwell, frame 12 fires.
      const { firedOn } = run(OUTSIDE_PORTAL, true, 1, 16)

      expect(firedOn).toStrictEqual([4, 12])
      // The gap between two firings is the cooldown plus the dwell, never less.
      const [first, second] = firedOn
      expect((second ?? 0) - (first ?? 0)).toBe(PORTAL_REENTRY_COOLDOWN_SECS + PORTAL_ACTIVATION_SECS)
    }),
  )

  it.effect('a traveller who leaves during the cooldown is simply outside', () =>
    Effect.sync(() => {
      const { dwell, firedOn } = run(COOLING(PORTAL_REENTRY_COOLDOWN_SECS), false, 1, 6)

      expect(dwell).toStrictEqual(OUTSIDE_PORTAL)
      expect(firedOn).toStrictEqual([])
    }),
  )
})
