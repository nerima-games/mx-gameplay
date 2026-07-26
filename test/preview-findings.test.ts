/**
 * The findings `apps/preview-mining-site --stats` produced, pinned.
 *
 * ---------------------------------------------------------------------------
 * Why these are here and not only in the report
 * ---------------------------------------------------------------------------
 *
 * `--stats` measures everything at run time and records no expected value, which
 * is deliberate: a finding that is fixed disappears from the report rather than
 * turning green. That is the right property for a search tool and the wrong one
 * for a record. A report has to be read to work; a test falls over on its own.
 *
 * So every finding that was CONFIRMED gets an assertion here. Two kinds live in
 * this file and the distinction is written into each test's name:
 *
 *   - `pins the current behaviour` — the defect is still present. The assertion
 *     describes what the code does today, so that fixing it makes this test fail
 *     and forces whoever fixes it to come here and invert it. Deleting the test
 *     instead is also fine; leaving it passing is not.
 *   - everything else — the property held when it was measured, and the test
 *     keeps it held.
 *
 * There is no `REGRESSION:` prefix anywhere in this file. docs/testing.md §2-1
 * reserves that word for things that actually happened in the reference
 * implementation's production, and none of these did: they were found here, by
 * driving this repository's own rules.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { dayPhase, hostileSpawnsAllowed, isNight } from '../domain/day-night'
import { applyDamage, deathMessage, fullHealth, isDead } from '../domain/death-cause'
import { carryOver, splitBudget, type FluidWorkItem } from '../domain/fluid-frontier'

describe('F5 — a non-finite damage amount makes the player permanently immortal', () => {
  // `Damage.amount` is a bare `number`. `Math.max(0, NaN)` is NaN, `NaN <= 0` is
  // false, and `applyDamage` returns early only for the dead — so one NaN blow
  // puts the player in a state from which no later blow can remove them.
  //
  // This is DN-GP-3's failure mode one level down. That note makes `cause` a
  // required field so a death message can never lose its cause; this removes the
  // death the cause was going to describe.
  //
  // The fix is the one `domain/frame-contract.ts:57` already uses for
  // `DeltaTimeSecs`: a `Brand.refined` on `Number.isFinite(value)`. When it
  // lands, these three assertions are the ones to invert.
  it.effect('pins the current behaviour: NaN damage leaves health NaN and isDead false', () =>
    Effect.sync(() => {
      const struck = applyDamage(fullHealth, { amount: Number.NaN, cause: 'lava' })

      expect(Number.isNaN(struck.healthPoints)).toBe(true)
      expect(isDead(struck)).toBe(false)
      expect(deathMessage(struck)).toBeUndefined()
      // The cause was never recorded, because the transition to zero never
      // happened — so even the field DN-GP-3 exists to protect is empty.
      expect(struck.lastDeathCause).toBeUndefined()
    }),
  )

  it.effect('pins the current behaviour: no amount of later damage can kill a NaN player', () =>
    Effect.sync(() => {
      let vitals = applyDamage(fullHealth, { amount: Number.NaN, cause: 'lava' })
      for (const amount of [20, 1_000, 1_000_000]) {
        vitals = applyDamage(vitals, { amount, cause: 'explosion' })
      }

      expect(isDead(vitals)).toBe(false)
      expect(deathMessage(vitals)).toBeUndefined()
    }),
  )

  it.effect('the finite edges are already handled — only the non-number is not', () =>
    Effect.sync(() => {
      // Infinity kills, which is the right answer for "infinite damage".
      const obliterated = applyDamage(fullHealth, { amount: Number.POSITIVE_INFINITY, cause: 'fall' })
      expect(obliterated.healthPoints).toBe(0)
      expect(deathMessage(obliterated)).toBe('You fell from a high place.')

      // A negative amount is clamped by `Math.max(0, damage.amount)`, so damage
      // cannot heal. -Infinity goes the same way.
      expect(applyDamage(fullHealth, { amount: -5, cause: 'mob' }).healthPoints).toBe(20)
      expect(
        applyDamage(fullHealth, { amount: Number.NEGATIVE_INFINITY, cause: 'mob' }).healthPoints,
      ).toBe(20)
    }),
  )
})

describe('F6 — the day/night rules are not periodic in the day', () => {
  // `isNight(t) = t < DAWN || t > DUSK` has no modulo in it, so it answers a
  // question about the NUMBER rather than about the time of day the number
  // names. `t`, `t + 1` and `t - 1` are the same instant on three consecutive
  // days and get three different answers.
  //
  // The reachable input is the negative one. mc-sim advances the hour as
  // `(base + elapsed / dayLength) % 1`; JS `%` keeps the sign of its left
  // operand, so a clock that steps backwards produces a negative fraction.
  // DN-GP-7's whole point is that this repository and mc-sim must agree about
  // when night is, and this is the seam.
  it.effect('pins the current behaviour: noon on the next day reads as night', () =>
    Effect.sync(() => {
      expect(dayPhase(0.5)).toBe('day')
      expect(dayPhase(1.5)).toBe('night')
      expect(isNight(1.5)).toBe(true)
      expect(hostileSpawnsAllowed(1.5)).toBe(true)
    }),
  )

  it.effect('pins the current behaviour: a negative fraction always reads as night', () =>
    Effect.sync(() => {
      // -0.25 is dusk on the previous day; -0.5 is noon on the previous day.
      expect(dayPhase(-0.25)).toBe('night')
      expect(dayPhase(-0.5)).toBe('night')
      expect(hostileSpawnsAllowed(-0.5)).toBe(true)

      // And this is how a negative fraction is produced, in one line.
      expect((-0.3) % 1).toBe(-0.3)
    }),
  )

  it.effect('inside [0, 1) the two predicates do agree, at every one of 1000 samples', () =>
    Effect.sync(() => {
      let disagreements = 0
      for (let step = 0; step < 1000; step += 1) {
        const t = step / 1000
        if (isNight(t) !== (dayPhase(t) === 'night')) {
          disagreements += 1
        }
        if (hostileSpawnsAllowed(t) !== isNight(t)) {
          disagreements += 1
        }
      }
      expect(disagreements).toBe(0)
    }),
  )
})

describe('F3 — carryOver compares by key, but the frontier is keyed by (key, kind)', () => {
  // `splitBudget` classifies on `kind`; `carryOver` builds its "evaluated" set
  // from `item.key` alone (`domain/fluid-frontier.ts:120`). When two kinds share
  // one position the two disagree about what an item is, and the cell that was
  // never evaluated is dropped from the frontier.
  //
  // Water and lava meet at one position by definition — that is the whole of the
  // cobblestone and obsidian rules — so this is the encoding of a fluid
  // interface, not a contrived input. DN-GP-2 records what a dropped frontier
  // key looks like from the outside: a lava lake with a straight edge, minutes
  // later, in a preview.
  const interfaceCell: ReadonlyArray<FluidWorkItem> = [
    { key: '10,64,10', kind: 'water' },
    { key: '10,64,10', kind: 'lava' },
  ]

  it.effect('pins the current behaviour: the unevaluated lava half is silently dropped', () =>
    Effect.sync(() => {
      const split = splitBudget(interfaceCell, { lavaTickActive: false, budget: 64 })

      // The lava tick is not active, so no lava cell may be evaluated.
      expect(split.work).toStrictEqual([{ key: '10,64,10', kind: 'water' }])

      // …and yet the lava cell does not survive into the next frontier.
      expect(carryOver(interfaceCell, split)).toStrictEqual([])
    }),
  )

  it.effect('with distinct keys the same call is correct, which is why no existing test caught it', () =>
    Effect.sync(() => {
      const distinct: ReadonlyArray<FluidWorkItem> = [
        { key: '10,64,10', kind: 'water' },
        { key: '11,64,10', kind: 'lava' },
      ]
      const split = splitBudget(distinct, { lavaTickActive: false, budget: 64 })
      expect(carryOver(distinct, split)).toStrictEqual([{ key: '11,64,10', kind: 'lava' }])
    }),
  )
})

describe('F2 — retainedLavaFrontier names cells carryOver already keeps', () => {
  // `FluidBudgetSplit.retainedLavaFrontier` is documented "These MUST be fed
  // back into the next frontier"; `carryOver` is documented as returning the
  // cells that were not evaluated. On an inactive lava tick every lava cell
  // satisfies both, so a caller obeying both comments duplicates them — and
  // duplicates them again on the next inactive tick.
  //
  // `stages/registration.ts:270` uses `carryOver` alone and is correct. The
  // field is dead in the only caller that exists, and its doc comment reads as
  // an obligation.
  const frontier: ReadonlyArray<FluidWorkItem> = [
    { key: 'w0', kind: 'water' },
    { key: 'l0', kind: 'lava' },
    { key: 'l1', kind: 'lava' },
  ]

  it.effect('pins the current behaviour: the two outputs overlap completely', () =>
    Effect.sync(() => {
      const split = splitBudget(frontier, { lavaTickActive: false, budget: 64 })
      const carriedKeys = carryOver(frontier, split).map((item) => item.key)

      expect(split.retainedLavaFrontier).toStrictEqual(['l0', 'l1'])
      expect(carriedKeys).toStrictEqual(['l0', 'l1'])
    }),
  )

  it.effect('pins the current behaviour: obeying both doc comments doubles the lava frontier each tick', () =>
    Effect.sync(() => {
      let naive: ReadonlyArray<FluidWorkItem> = frontier
      const sizes: Array<number> = [naive.length]

      for (let tick = 0; tick < 4; tick += 1) {
        const split = splitBudget(naive, { lavaTickActive: false, budget: 64 })
        naive = [
          ...carryOver(naive, split),
          ...split.retainedLavaFrontier.map((key): FluidWorkItem => ({ key, kind: 'lava' })),
        ]
        sizes.push(naive.length)
      }

      expect(sizes).toStrictEqual([3, 4, 8, 16, 32])
    }),
  )
})
