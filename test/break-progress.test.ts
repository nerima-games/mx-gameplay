/**
 * `domain/interactions/break-progress.ts` — the hold-to-mine accumulator.
 *
 * The reference's four cases are here (accumulate, complete, reset on a new
 * block, instant at zero) and so are the three its condition lets through:
 * negative, non-finite and fractional tick budgets. Those three are the reason
 * this is a port rather than a transcription — see the implementation header.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  advanceBreakProgress,
  breakProgressFraction,
  normaliseBreakTicks,
  type BreakProgressState,
} from '../src/domain/interactions/break-progress'

const STONE = '1,64,2'
const DIRT = '1,64,3'

describe('accumulating', () => {
  it.effect('the first frame on a block starts at one tick', () =>
    Effect.sync(() => {
      expect(advanceBreakProgress({ current: null, blockKey: STONE, breakTicks: 3 })).toStrictEqual({
        nextProgress: { blockKey: STONE, ticks: 1, totalTicks: 3 },
        shouldBreak: false,
      })
    }),
  )

  it.effect('holding on the same block adds a tick per frame', () =>
    Effect.sync(() => {
      const first = advanceBreakProgress({ current: null, blockKey: STONE, breakTicks: 3 })
      const second = advanceBreakProgress({
        current: first.nextProgress,
        blockKey: STONE,
        breakTicks: 3,
      })

      expect(second.nextProgress?.ticks).toBe(2)
      expect(second.shouldBreak).toBe(false)
    }),
  )

  it.effect('the tick that reaches the budget breaks, and clears the progress', () =>
    Effect.sync(() => {
      // `nextProgress: null` on completion is what stops the next frame from
      // starting at tick 4 of 3 and breaking the replacement block instantly.
      const at2: BreakProgressState = { blockKey: STONE, ticks: 2, totalTicks: 3 }

      expect(advanceBreakProgress({ current: at2, blockKey: STONE, breakTicks: 3 })).toStrictEqual({
        nextProgress: null,
        shouldBreak: true,
      })
    }),
  )
})

describe('switching blocks', () => {
  it.effect('THE RULE THE OPAQUE KEY EXISTS FOR: a different block restarts at one', () =>
    Effect.sync(() => {
      // Look away and the progress resets. Everyone knows this from playing and
      // nothing else in the file mentions it — it is entirely carried by one
      // string equality.
      const nearlyDone: BreakProgressState = { blockKey: STONE, ticks: 2, totalTicks: 3 }

      const result = advanceBreakProgress({ current: nearlyDone, blockKey: DIRT, breakTicks: 3 })

      expect(result.nextProgress).toStrictEqual({ blockKey: DIRT, ticks: 1, totalTicks: 3 })
      expect(result.shouldBreak).toBe(false)
    }),
  )

  it.effect('REGRESSION: progress is not carried across, even when nearly complete', () =>
    Effect.sync(() => {
      // The failure this prevents is the nastiest form: mine most of a block,
      // glance at the one next to it, and that one shatters. A version that
      // kept `ticks` and only replaced `blockKey` passes every other test here.
      const nearlyDone: BreakProgressState = { blockKey: STONE, ticks: 99, totalTicks: 100 }

      expect(advanceBreakProgress({ current: nearlyDone, blockKey: DIRT, breakTicks: 100 }).shouldBreak).toBe(
        false,
      )
    }),
  )
})

describe('the tick budget', () => {
  it.effect('zero breaks instantly', () =>
    Effect.sync(() => {
      expect(advanceBreakProgress({ current: null, blockKey: STONE, breakTicks: 0 })).toStrictEqual({
        nextProgress: null,
        shouldBreak: true,
      })
    }),
  )

  it.effect('a negative budget is the same as zero, by the same route', () =>
    Effect.sync(() => {
      // The reference reaches this answer accidentally — `1 >= -5` is true — so
      // it would keep working if the `=== 0` test were deleted. Here it is
      // clamped, and this case says so.
      expect(normaliseBreakTicks(-5)).toBe(0)
      expect(advanceBreakProgress({ current: null, blockKey: STONE, breakTicks: -5 }).shouldBreak).toBe(
        true,
      )
    }),
  )

  it.effect('REGRESSION: a non-finite budget breaks instead of never breaking', () =>
    Effect.sync(() => {
      // NaN fails every comparison, so the reference's block NEVER breaks and
      // the counter grows without bound — an indestructible block, silently,
      // from one bad hardness lookup. Loud is the right direction here.
      expect(advanceBreakProgress({ current: null, blockKey: STONE, breakTicks: Number.NaN }).shouldBreak).toBe(
        true,
      )
      expect(
        advanceBreakProgress({ current: null, blockKey: STONE, breakTicks: Number.POSITIVE_INFINITY })
          .shouldBreak,
      ).toBe(true)
    }),
  )

  it.effect('a fractional budget rounds UP, and the reported total is whole', () =>
    Effect.sync(() => {
      // Ceil and not round: the budget is a hardness over a tool speed, and
      // rounding down makes a marginal tool exactly as good as the tier above.
      // The whole total is also what stops a progress bar reading 120%.
      expect(normaliseBreakTicks(2.5)).toBe(3)

      const result = advanceBreakProgress({ current: null, blockKey: STONE, breakTicks: 2.5 })
      expect(result.nextProgress?.totalTicks).toBe(3)
      expect(Number.isInteger(result.nextProgress?.totalTicks ?? 0)).toBe(true)
    }),
  )

  it.effect('a budget of one breaks on the first frame', () =>
    Effect.sync(() => {
      expect(advanceBreakProgress({ current: null, blockKey: STONE, breakTicks: 1 }).shouldBreak).toBe(true)
    }),
  )
})

describe('invariants over any input', () => {
  it.effect('ticks never exceed the total, and never exceed it silently', () =>
    Effect.sync(() => {
      // The property a progress bar depends on. An implementation that returned
      // progress on the completing frame would produce ticks === totalTicks
      // here and a bar that sits full for one frame before the block goes.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 1, max: 50 }),
          FastCheck.integer({ min: 0, max: 60 }),
          (budget, frames) => {
            let state: BreakProgressState | null = null
            for (let frame = 0; frame < frames; frame += 1) {
              const result = advanceBreakProgress({
                current: state,
                blockKey: STONE,
                breakTicks: budget,
              })
              if (result.shouldBreak) {
                return result.nextProgress === null
              }
              state = result.nextProgress
              if (state !== null && state.ticks >= state.totalTicks) {
                return false
              }
            }
            return true
          },
        ),
        { numRuns: 300 },
      )
    }),
  )

  it.effect('a block always breaks within its budget of frames', () =>
    Effect.sync(() => {
      // The other half: no input makes mining take longer than it says. This is
      // what the NaN case violated in the reference — forever is "within" no
      // budget at all.
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 1, max: 40 }), (budget) => {
          let state: BreakProgressState | null = null
          for (let frame = 0; frame < budget; frame += 1) {
            const result = advanceBreakProgress({
              current: state,
              blockKey: STONE,
              breakTicks: budget,
            })
            if (result.shouldBreak) {
              return true
            }
            state = result.nextProgress
          }
          return false
        }),
        { numRuns: 200 },
      )
    }),
  )
})

describe('breakProgressFraction', () => {
  it.effect('reports the fraction a bar would draw', () =>
    Effect.sync(() => {
      expect(breakProgressFraction({ blockKey: STONE, ticks: 1, totalTicks: 4 })).toBe(0.25)
      expect(breakProgressFraction({ blockKey: STONE, ticks: 3, totalTicks: 4 })).toBe(0.75)
    }),
  )

  it.effect('is clamped, so a hand-built state cannot draw past the end', () =>
    Effect.sync(() => {
      expect(breakProgressFraction({ blockKey: STONE, ticks: 9, totalTicks: 4 })).toBe(1)
      expect(breakProgressFraction({ blockKey: STONE, ticks: 1, totalTicks: 0 })).toBe(1)
      expect(breakProgressFraction({ blockKey: STONE, ticks: -3, totalTicks: 4 })).toBe(0)
    }),
  )
})
