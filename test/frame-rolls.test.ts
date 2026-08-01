/**
 * `domain/frame-rolls.ts` — where randomness enters a frame, and the three
 * total-function decisions that file makes about inputs it should never see.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists separately from the scenarios that use rolls
 * ---------------------------------------------------------------------------
 *
 * Every other test that touches the generator drives it through a stage:
 * `vertical-slice.test.ts` walks the enderman's teleport draw, `weather.test.ts`
 * fast-forwards two hours of transitions, `mob-spawn-search.test.ts` counts the
 * budget a search consumes. All of those pass rolls the generator PRODUCED, so
 * none of them can say what happens to a seed or a count that the generator did
 * not produce — and the module header's claims are almost entirely about exactly
 * that. `normaliseSeed` is documented TOTAL, `drawRolls` is documented to draw
 * nothing and advance nothing for a count of zero, and `rollAt` is documented to
 * read past the end as 0.
 *
 * Those are not defensive asides. Two of the three are load-bearing:
 *
 *   ZERO IS THE GENERATOR'S FIXED POINT. `16807 * 0 mod m` is `0` forever, so a
 *   seed of 0 is not a slightly worse seed, it is a generator that returns the
 *   same number for the rest of the world's life. Nothing in a save file stops
 *   a 0 arriving.
 *
 *   A COUNT OF ZERO IS THE COMMON CASE. The frame path calls `drawRolls` on
 *   every sweep, and most sweeps kill nothing. If a zero count advanced the
 *   seed, the sequence would depend on how many frames had passed rather than on
 *   what happened in them — which is the property `stages/registration.ts`
 *   reproduces a save file against.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DEFAULT_ROLL_SEED, drawRolls, nextRoll, normaliseSeed, rollAt } from '../src/domain/frame-rolls'

/** The generator's modulus, restated. `domain/frame-rolls.ts` keeps it private. */
const MODULUS = 2_147_483_647

describe('normaliseSeed: the states the generator must never be left in', () => {
  it.effect('folds a seed that is not a number to 1 rather than poisoning every later roll', () =>
    Effect.sync(() => {
      // The preview's finding F5 is a non-number travelling through arithmetic
      // that had no opinion about it, and a seed is the furthest-travelling
      // number in the frame: one `NaN` here makes every roll after it `NaN`, so
      // every chance gate compares false and the world quietly stops having
      // creepers drop anything. `../domain/mob/mob-drop`'s `clampRoll` takes the
      // same inert direction for the same reason.
      for (const broken of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(normaliseSeed(broken)).toBe(1)
      }

      expect(Number.isFinite(nextRoll(Number.NaN).roll)).toBe(true)
      expect(nextRoll(Number.NaN)).toStrictEqual(nextRoll(1))
    }),
  )

  it.effect('maps 0 — and every multiple of the modulus — to 1, because 0 is the fixed point', () =>
    Effect.sync(() => {
      // THE ONE THAT IS NOT COSMETIC. `16807 * 0 mod m` is 0, so a seed of 0
      // does not degrade the sequence, it ENDS it: every draw from then on
      // returns the same roll forever. A frame loop would keep running and
      // every rule would keep answering, with the same answer.
      expect(normaliseSeed(0)).toBe(1)
      expect(normaliseSeed(-0)).toBe(1)
      expect(normaliseSeed(MODULUS)).toBe(1)
      expect(normaliseSeed(-MODULUS)).toBe(1)

      // And the sequence really does move afterwards, which is the point of
      // mapping rather than accepting.
      expect(nextRoll(0).seed).not.toBe(0)
      expect(nextRoll(nextRoll(0).seed).roll).not.toBe(nextRoll(0).roll)
    }),
  )

  it.effect('leaves a legal seed exactly where it is', () =>
    Effect.sync(() => {
      // The other half of "total": folding must not move a seed that was
      // already in `[1, MODULUS - 1]`, or replaying a saved seed would not
      // reproduce the run it was saved from.
      expect(normaliseSeed(DEFAULT_ROLL_SEED)).toBe(DEFAULT_ROLL_SEED)
      expect(normaliseSeed(1)).toBe(1)
      expect(normaliseSeed(MODULUS - 1)).toBe(MODULUS - 1)
    }),
  )
})

describe('drawRolls: a count of zero is the common frame, not an edge case', () => {
  it.effect('draws nothing and LEAVES THE SEED, so an uneventful frame costs the sequence nothing', () =>
    Effect.sync(() => {
      // This is the rule the whole file is organised around: the sequence
      // depends on WHAT HAPPENED, not on how many frames passed. A sweep in
      // which nothing died draws zero rolls, and if that advanced the seed then
      // a scenario that idles for ten thousand frames and then kills a creeper
      // would get different gunpowder from one that kills it immediately.
      const batch = drawRolls(DEFAULT_ROLL_SEED, 0)

      expect(batch.rolls).toStrictEqual([])
      expect(batch.seed).toBe(DEFAULT_ROLL_SEED)

      // Identical to never having asked.
      expect(drawRolls(batch.seed, 2)).toStrictEqual(drawRolls(DEFAULT_ROLL_SEED, 2))
    }),
  )

  it.effect('treats a negative or non-numeric count the same way, rather than looping or drawing NaN', () =>
    Effect.sync(() => {
      for (const count of [-1, -1e9, Number.NaN, Number.NEGATIVE_INFINITY]) {
        const batch = drawRolls(DEFAULT_ROLL_SEED, count)
        expect(batch.rolls).toStrictEqual([])
        expect(batch.seed).toBe(DEFAULT_ROLL_SEED)
      }

      // `Number.POSITIVE_INFINITY` is refused by the same guard, which matters
      // more than the others: it is the one that would otherwise be a loop that
      // never returns, inside a frame.
      expect(drawRolls(DEFAULT_ROLL_SEED, Number.POSITIVE_INFINITY).rolls).toStrictEqual([])
    }),
  )

  it.effect('the empty batch is the SHARED array, so the uneventful frame allocates nothing', () =>
    Effect.sync(() => {
      // `NO_ROLLS` is shared for the same reason `mob-frame`'s `IGNORED` is:
      // this runs on every frame, and a fresh `[]` per frame is garbage
      // proportional to frame rate rather than to events.
      expect(drawRolls(DEFAULT_ROLL_SEED, 0).rolls).toBe(drawRolls(7, -3).rolls)
    }),
  )
})

describe('rollAt: the one spelling of "this batch has no roll there"', () => {
  it.effect('answers 0 past the end, which is what makes `drawRolls(seed, 0)` safe to read', () =>
    Effect.sync(() => {
      // Not a hypothetical index: the empty batch above is the common frame,
      // and a caller holding one still has to ask for its rolls. This function
      // exists so that the answer is written once — four call sites in
      // `domain/entities/mob-spawn-search.ts` and `stages/registration.ts` each
      // carried their own `?? 0`, none reachable at its own site, all four
      // unexaminable as a group.
      const empty = drawRolls(DEFAULT_ROLL_SEED, 0)

      expect(rollAt(empty, 0)).toBe(0)
      expect(rollAt(empty, 41)).toBe(0)
      expect(rollAt(drawRolls(DEFAULT_ROLL_SEED, 2), 2)).toBe(0)
    }),
  )

  it.effect('returns the drawn roll itself when the batch has one, in the order it was drawn', () =>
    Effect.sync(() => {
      // The half that would still pass if the function had been written
      // `() => 0`, so it is asserted against the batch rather than against a
      // literal.
      const batch = drawRolls(DEFAULT_ROLL_SEED, 3)

      expect(batch.rolls.length).toBe(3)
      for (const [index, roll] of batch.rolls.entries()) {
        expect(rollAt(batch, index)).toBe(roll)
      }

      // The interval every rule downstream documents.
      for (const roll of batch.rolls) {
        expect(roll).toBeGreaterThanOrEqual(0)
        expect(roll).toBeLessThan(1)
      }
    }),
  )

  it.effect('0 is the GENEROUS answer, not the inert one — and that is deliberate', () =>
    Effect.sync(() => {
      // Worth pinning because it is the surprising direction. A roll of 0 is
      // below every chance threshold, so a caller that forgot to draw gets the
      // most generous outcome rather than the least — the opposite of the
      // direction `normaliseSeed` and `clampRoll` take. It is chosen for the
      // reason `domain/interactions/block-loot.ts` documents at its own
      // out-of-range read: the only production caller draws its budget from
      // `drawRolls`, so an absent roll means a test wrote one on purpose and
      // "every chance line fires" is what such a test is asking for.
      const empty = drawRolls(DEFAULT_ROLL_SEED, 0)
      const anyChance = 0.000_001

      expect(rollAt(empty, 0) < anyChance).toBe(true)
    }),
  )
})
