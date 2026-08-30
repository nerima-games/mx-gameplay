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
import { dayPhase, hostileSpawnsAllowed, isNight } from '../src/domain/day-night'
import { applyDamage, deathMessage, fullHealth, isDead } from '../src/domain/death-cause'
import { carryOver, splitBudget, type FluidWorkItem } from '../src/domain/fluid-frontier'
import { BlockPositionKey as positionKey } from '@nerima-games/mc-kernel'

describe('F5 — non-finite damage is ignored', () => {
  it.effect('preserves vitals for every non-finite damage amount', () =>
    Effect.sync(() => {
      for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(applyDamage(fullHealth, { amount, cause: 'lava' })).toEqual(fullHealth)
      }
    }),
  )

  it.effect('allows later finite damage to kill after non-finite damage is ignored', () =>
    Effect.sync(() => {
      const unaffected = applyDamage(fullHealth, { amount: Number.NaN, cause: 'lava' })
      const killed = applyDamage(unaffected, { amount: 20, cause: 'explosion' })

      expect(isDead(killed)).toBe(true)
      expect(deathMessage(killed)).toBe('You blew up.')
    }),
  )

  it.effect('preserves the existing finite negative, zero, and positive boundaries', () =>
    Effect.sync(() => {
      expect(applyDamage(fullHealth, { amount: -5, cause: 'mob' }).healthPoints).toBe(20)
      expect(applyDamage(fullHealth, { amount: 0, cause: 'mob' }).healthPoints).toBe(20)
      expect(applyDamage(fullHealth, { amount: 5, cause: 'mob' }).healthPoints).toBe(15)
      expect(applyDamage(fullHealth, { amount: 20, cause: 'mob' })).toEqual({
        healthPoints: 0,
        lastDeathCause: 'mob',
      })
    }),
  )
})

describe('F6 regression — the day/night rules are periodic in the day', () => {
  it.effect('keeps noon as day on the next day', () =>
    Effect.sync(() => {
      expect(dayPhase(0.5)).toBe('day')
      expect(dayPhase(1.5)).toBe('day')
      expect(isNight(1.5)).toBe(false)
      expect(hostileSpawnsAllowed(1.5)).toBe(false)
    }),
  )

  it.effect('maps negative fractions to the previous day', () =>
    Effect.sync(() => {
      // -0.25 is dusk on the previous day; -0.5 is noon on the previous day.
      expect(dayPhase(-0.25)).toBe('dusk')
      expect(dayPhase(-0.5)).toBe('day')
      expect(hostileSpawnsAllowed(-0.5)).toBe(false)

      // And this is how a negative fraction is produced, in one line.
      expect((-0.3) % 1).toBe(-0.3)
    }),
  )

  it.effect('keeps the phase and spawn predicates aligned across whole-day offsets', () =>
    Effect.sync(() => {
      let disagreements = 0
      for (let step = 0; step < 1000; step += 1) {
        const t = step / 1000
        for (const day of [-2, -1, 0, 1, 2]) {
          const shifted = t + day
          if (isNight(shifted) !== (dayPhase(shifted) === 'night')) {
            disagreements += 1
          }
          if (hostileSpawnsAllowed(shifted) !== isNight(shifted)) {
            disagreements += 1
          }
        }
      }
      expect(disagreements).toBe(0)
    }),
  )
})

describe('fluid frontier identity and carry-over contract', () => {
  const interfaceCell: ReadonlyArray<FluidWorkItem> = [
    { key: positionKey('10,64,10'), kind: 'water' },
    { key: positionKey('10,64,10'), kind: 'lava' },
  ]

  it.effect('identifies work by position and kind so inactive lava survives a water evaluation', () =>
    Effect.sync(() => {
      const split = splitBudget(interfaceCell, { lavaTickActive: false, budget: 64 })

      expect(split.work).toStrictEqual([{ key: '10,64,10', kind: 'water' }])
      expect(carryOver(interfaceCell, split)).toStrictEqual([
        { key: '10,64,10', kind: 'lava' },
      ])
    }),
  )

  it.effect('with distinct keys the same call is correct, which is why no existing test caught it', () =>
    Effect.sync(() => {
      const distinct: ReadonlyArray<FluidWorkItem> = [
        { key: positionKey('10,64,10'), kind: 'water' },
        { key: positionKey('11,64,10'), kind: 'lava' },
      ]
      const split = splitBudget(distinct, { lavaTickActive: false, budget: 64 })
      expect(carryOver(distinct, split)).toStrictEqual([{ key: '11,64,10', kind: 'lava' }])
    }),
  )
  it.effect('uses carryOver alone for reinsertion without doubling deferred lava', () =>
    Effect.sync(() => {
      let frontier: ReadonlyArray<FluidWorkItem> = interfaceCell
      const sizes: Array<number> = [frontier.length]

      for (let tick = 0; tick < 4; tick += 1) {
        const split = splitBudget(frontier, { lavaTickActive: false, budget: 64 })
        expect(split).toHaveProperty('work')
        expect(Object.keys(split)).toStrictEqual(['work'])
        frontier = carryOver(frontier, split)
        sizes.push(frontier.length)
      }

      expect(sizes).toStrictEqual([2, 1, 1, 1, 1])
    }),
  )
})
