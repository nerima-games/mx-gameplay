/**
 * `createDroppedItemLifetimeTracker` — lowered unchanged from the composing
 * app's `dropped-item-lifetime.ts`. It has no behaviour of its own beyond
 * bookkeeping elapsed seconds per `(dimension, entityId)`, so the scenario
 * tests below establish the shape and `tick sequence invariant` below is the
 * one property that actually matters: however the same total elapsed time is
 * split across frames, a tracked item despawns on exactly the frame that
 * crosses its lifetime, never earlier and never later, and once despawned it
 * carries no residual state.
 */
import { describe, expect, it } from '@effect/vitest'
import { createDroppedItemLifetimeTracker } from '../src/domain/entities/dropped-item'

describe('createDroppedItemLifetimeTracker: scenarios', () => {
  it('tracks elapsed time per dimension and entity independently', () => {
    const tracker = createDroppedItemLifetimeTracker(10)
    tracker.advance('overworld', 4, ['a'])
    tracker.advance('nether', 9, ['a'])
    expect(tracker.elapsed('overworld', 'a')).toBe(4)
    expect(tracker.elapsed('nether', 'a')).toBe(9)
    expect(tracker.elapsed('overworld', 'b')).toBe(0)
  })

  it('drops an entity id that is no longer present, so a picked-up item does not linger', () => {
    const tracker = createDroppedItemLifetimeTracker(10)
    tracker.advance('overworld', 4, ['a', 'b'])
    tracker.advance('overworld', 4, ['a'])
    expect(tracker.elapsed('overworld', 'a')).toBe(8)
    expect(tracker.elapsed('overworld', 'b')).toBe(0)
  })

  it('restore seeds elapsed time and replaces any prior tracking for that dimension', () => {
    const tracker = createDroppedItemLifetimeTracker(10)
    tracker.advance('overworld', 4, ['a'])
    tracker.restore('overworld', [{ entityId: 'b', elapsedSecs: 6 }])
    expect(tracker.elapsed('overworld', 'a')).toBe(0)
    expect(tracker.elapsed('overworld', 'b')).toBe(6)
  })

  it('restore clamps a negative persisted elapsed to zero', () => {
    const tracker = createDroppedItemLifetimeTracker(10)
    tracker.restore('overworld', [{ entityId: 'a', elapsedSecs: -5 }])
    expect(tracker.elapsed('overworld', 'a')).toBe(0)
  })

  it('expires an item the instant it reaches the lifetime, and only once', () => {
    const tracker = createDroppedItemLifetimeTracker(10)
    expect(tracker.advance('overworld', 6, ['a'])).toStrictEqual([])
    expect(tracker.advance('overworld', 4, ['a'])).toStrictEqual(['a'])
    // No longer tracked: a second advance with the same id starts a fresh clock
    // rather than expiring again immediately (the caller is responsible for not
    // re-presenting a despawned id — see the invariant below for the sweep-safe
    // usage this enables).
    expect(tracker.elapsed('overworld', 'a')).toBe(0)
  })
})

describe('createDroppedItemLifetimeTracker: tick-sequence invariant', () => {
  const LIFETIME_SECS = 300

  /**
   * Run one item through a sequence of frame deltas (summing past the
   * lifetime) and return, for each frame, whether that frame's `advance`
   * reported the item as expired.
   */
  const runSequence = (deltas: ReadonlyArray<number>): ReadonlyArray<boolean> => {
    const tracker = createDroppedItemLifetimeTracker(LIFETIME_SECS)
    const expiredPerFrame: boolean[] = []
    let alive = true
    for (const delta of deltas) {
      const ids = alive ? ['item'] : []
      const expired = tracker.advance('overworld', delta, ids)
      expiredPerFrame.push(expired.includes('item'))
      if (expired.includes('item')) alive = false
    }
    return expiredPerFrame
  }

  // Six ways of spending the same total (or more) time, chosen to exercise a
  // single huge tick, uniform ticks that divide the lifetime evenly, uniform
  // ticks that do not, and irregular ticks — every shape `advance`'s caller
  // (a variable-length frame) can actually produce.
  const TICK_SEQUENCES: ReadonlyArray<{ readonly name: string; readonly deltas: ReadonlyArray<number> }> = [
    { name: 'one tick covering the whole lifetime', deltas: [LIFETIME_SECS] },
    { name: 'one tick past the lifetime', deltas: [LIFETIME_SECS + 120] },
    { name: '30 uniform 10s ticks (divides evenly)', deltas: Array.from({ length: 30 }, () => 10) },
    { name: '299 uniform 1s ticks, one short, then the rest', deltas: [...Array.from({ length: 299 }, () => 1), 50] },
    { name: 'irregular ticks summing past the lifetime', deltas: [17, 3, 250, 1, 1, 40, 99] },
    { name: 'many tiny ticks (60fps for 6 minutes)', deltas: Array.from({ length: 360 * 6 }, () => 1 / 6) },
  ]

  for (const { name, deltas } of TICK_SEQUENCES) {
    it(`despawns on exactly the crossing frame, never earlier, for: ${name}`, () => {
      const expiredPerFrame = runSequence(deltas)

      // Never survives past its lifetime: some frame must report expiry, since
      // the deltas sum to at least the lifetime.
      const expiryFrames = expiredPerFrame.filter(Boolean).length
      expect(expiryFrames).toBe(1)

      // Never despawns before its lifetime: the running total at the moment of
      // the (single) reported expiry must be >= LIFETIME_SECS, and the running
      // total one frame earlier must be < LIFETIME_SECS.
      let runningTotal = 0
      let expiryIndex = -1
      for (const [index, delta] of deltas.entries()) {
        const totalBefore = runningTotal
        runningTotal += delta
        if (expiredPerFrame[index] === true) {
          expiryIndex = index
          expect(totalBefore).toBeLessThan(LIFETIME_SECS)
          expect(runningTotal).toBeGreaterThanOrEqual(LIFETIME_SECS)
        }
      }
      expect(expiryIndex).toBeGreaterThanOrEqual(0)
    })
  }

  it('pickup is idempotent: an id already absent from the roster is simply not re-expired', () => {
    const tracker = createDroppedItemLifetimeTracker(LIFETIME_SECS)
    tracker.advance('overworld', LIFETIME_SECS - 1, ['item'])
    // The item is picked up (removed from the live roster) one frame before
    // it would have expired.
    const afterPickup = tracker.advance('overworld', 10, [])
    expect(afterPickup).toStrictEqual([])
    // Calling advance again with the same (still-absent) id set is a no-op,
    // not a second expiry — there is nothing left to expire.
    expect(tracker.advance('overworld', 10, [])).toStrictEqual([])
    expect(tracker.elapsed('overworld', 'item')).toBe(0)
  })
})
