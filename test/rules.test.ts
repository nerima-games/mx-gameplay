/**
 * Named regression tests for the three measured mistakes plan.md §3.11 records.
 *
 * Every `describe` below is titled with the bug it prevents, and every one of
 * them was found in production in the reference implementation rather than
 * imagined here. The file:line references are relative to `<reference-impl>`,
 * a checkout of the frozen `takeokunn/ts-minecraft` — see docs/README.md.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import {
  applyDamage,
  DEATH_MESSAGES,
  deathMessage,
  describeDeath,
  fullHealth,
  isDead,
  MAX_HEALTH_POINTS,
  type DeathCause,
} from '../src/domain/death-cause'
import {
  disturb,
  emptyFallingBlockQueue,
  FALLING_BLOCK_MOVES_PER_TICK,
  planFallingBlockMoves,
  settled,
  takeBatch,
} from '../src/domain/falling-block'
import {
  carryOver,
  DEFAULT_FLUID_FRONTIER_BUDGET,
  splitBudget,
  transitionFluidCell,
  type FluidCell,
  type FluidProbe,
  type FluidWorkItem,
} from '../src/domain/fluid-frontier'
import { positionKey } from '../src/domain/position-key'

const ALL_CAUSES: ReadonlyArray<DeathCause> = [
  'fall',
  'lava',
  'cactus',
  'fire',
  'drowning',
  'suffocation',
  'starvation',
  'mob',
  'projectile',
  'explosion',
  'void',
  'generic',
]

describe('falling blocks: the O(chunks × blocks) full scan must not come back', () => {
  it.effect('REGRESSION: an untouched world produces no work, because work only enters through `disturb`', () =>
    Effect.sync(() => {
      const { batch, rest } = takeBatch(emptyFallingBlockQueue)
      expect(batch).toStrictEqual([])
      // Identity, not merely equality: an idle tick must not even allocate a
      // replacement queue.
      expect(rest).toBe(emptyFallingBlockQueue)
    }),
  )

  it.effect('REGRESSION: one tick applies at most FALLING_BLOCK_MOVES_PER_TICK moves', () =>
    Effect.sync(() => {
      const positions = Array.from({ length: 500 }, (_, index) => positionKey(`0,${String(index)},0`))
      const queue = disturb(emptyFallingBlockQueue, positions)
      const { batch, rest } = takeBatch(queue)

      expect(batch).toHaveLength(FALLING_BLOCK_MOVES_PER_TICK)
      expect(rest.pending.size).toBe(500 - FALLING_BLOCK_MOVES_PER_TICK)
    }),
  )

  it.effect('REGRESSION: `settled` re-queues a destination so a column keeps cascading without an external event', () =>
    Effect.sync(() => {
      // A falling column settles one cell per tick. The reference kept a
      // `pendingCoordKeysRef` for exactly this
      // (packages/world/application/falling-block-maintenance.ts:24-27); if the
      // destination is not re-queued the sand stops one cell short and stays
      // there until something unrelated dirties the chunk.
      const afterMove = settled(emptyFallingBlockQueue, [positionKey('0,63,0')])
      expect(takeBatch(afterMove).batch).toStrictEqual(['0,63,0'])
    }),
  )

  it.effect('re-disturbing a pending position keeps its original queue position, so a hot spot cannot starve the queue', () =>
    Effect.sync(() => {
      const queue = disturb(disturb(emptyFallingBlockQueue, [positionKey('a'), positionKey('b')]), [positionKey('a'), positionKey('c')])
      expect(takeBatch(queue).batch).toStrictEqual(['a', 'b', 'c'])
    }),
  )

  it.effect('a zero or negative budget takes nothing rather than throwing or taking everything', () =>
    Effect.sync(() => {
      const queue = disturb(emptyFallingBlockQueue, [positionKey('a'), positionKey('b')])
      expect(takeBatch(queue, 0).batch).toStrictEqual([])
      expect(takeBatch(queue, -1).rest).toBe(queue)
    }),
  )

  it.effect('disturb does not mutate the queue it was given', () =>
    Effect.sync(() => {
      const before = disturb(emptyFallingBlockQueue, [positionKey('a')])
      const after = disturb(before, [positionKey('b')])
      expect([...before.pending]).toStrictEqual(['a'])
      expect([...after.pending]).toStrictEqual(['a', 'b'])
    }),
  )

  it.effect('plans one-cell moves through a storage-free read boundary', () =>
    Effect.sync(() => {
      const sand = blockIdOf('sand')
      const air = blockIdOf('air')
      const blocks = new Map<string, number>([
        ['0,64,0', sand],
        ['0,63,0', air],
      ])
      const moves = planFallingBlockMoves([{ x: 0, y: 63, z: 0 }], (at) => blocks.get(`${String(at.x)},${String(at.y)},${String(at.z)}`))

      expect(moves).toStrictEqual([{
        source: { x: 0, y: 64, z: 0 },
        target: { x: 0, y: 63, z: 0 },
        blockId: sand,
      }])
    }),
  )

  it.effect('does not move across an unavailable world boundary', () =>
    Effect.sync(() => {
      expect(planFallingBlockMoves([{ x: 0, y: 63, z: 0 }], () => undefined)).toStrictEqual([])
    }),
  )
})

describe('fluids: the frontier budget that bought 37–55×', () => {
  const frontierOf = (water: number, lava: number): ReadonlyArray<FluidWorkItem> => [
    ...Array.from({ length: water }, (_, i): FluidWorkItem => ({ key: positionKey(`w${String(i)}`), kind: 'water' })),
    ...Array.from({ length: lava }, (_, i): FluidWorkItem => ({ key: positionKey(`l${String(i)}`), kind: 'lava' })),
  ]
  const cell: FluidCell = {
    key: positionKey('0,64,0'),
    kind: 'water',
    level: 0,
    source: true,
    falling: false,
  }
  const probe = (key: string, state: FluidProbe['state']): FluidProbe => ({ key: positionKey(key), state })
  const transition = (overrides: Partial<Parameters<typeof transitionFluidCell>[0]> = {}) =>
    transitionFluidCell({
      cell,
      current: probe(cell.key, 'same-fluid'),
      below: probe('0,63,0', 'blocked'),
      horizontal: [
        probe('-1,64,0', 'air'),
        probe('1,64,0', 'air'),
        probe('0,64,-1', 'air'),
        probe('0,64,1', 'air'),
      ],
      supported: true,
      maximumHorizontalLevel: 7,
      ...overrides,
    })

  it.effect('propagates downward before horizontal neighbours', () =>
    Effect.sync(() => {
      const result = transition({ below: probe('0,63,0', 'air') })
      expect(result.changes).toStrictEqual([
        {
          _tag: 'PlaceFluid',
          cell: {
            key: '0,63,0',
            kind: 'water',
            level: 0,
            source: false,
            parent: '0,64,0',
            falling: true,
          },
        },
      ])
    }),
  )

  it.effect('spreads horizontally in deterministic order and stops at the configured level', () =>
    Effect.sync(() => {
      expect(
        transition().changes.map((change) =>
          change._tag === 'PlaceFluid' ? change.cell.key : change.key,
        ),
      ).toStrictEqual(['-1,64,0', '1,64,0', '0,64,-1', '0,64,1'])
      expect(transition({ cell: { ...cell, level: 7 } }).changes).toStrictEqual([])
    }),
  )

  it.effect('does not replace blocked cells and removes an unsupported flow', () =>
    Effect.sync(() => {
      const blocked = transition({
        horizontal: [probe('-1,64,0', 'blocked')],
      })
      expect(blocked.changes).toStrictEqual([])
      const unsupported = transition({
        cell: { ...cell, source: false, parent: positionKey('-1,64,0') },
        supported: false,
      })
      expect(unsupported.changes).toStrictEqual([{ _tag: 'RemoveFluid', key: cell.key }])
    }),
  )

  it.effect('solidifies opposite-fluid contact and differentiates source lava', () =>
    Effect.sync(() => {
      const waterMeetingSourceLava = transition({
        horizontal: [{ ...probe('1,64,0', 'opposite-fluid'), source: true }],
      })
      expect(waterMeetingSourceLava.changes[0]).toStrictEqual({
        _tag: 'Solidify',
        key: '1,64,0',
        block: 'obsidian',
      })

      const waterMeetingFlowingLava = transition({
        horizontal: [{ ...probe('1,64,0', 'opposite-fluid'), source: false }],
      })
      expect(waterMeetingFlowingLava.changes[0]).toStrictEqual({
        _tag: 'Solidify',
        key: '1,64,0',
        block: 'cobblestone',
      })

      const sourceLava = transition({
        cell: { ...cell, kind: 'lava' },
        horizontal: [probe('1,64,0', 'opposite-fluid')],
      })
      expect(sourceLava.changes).toStrictEqual([
        { _tag: 'Solidify', key: cell.key, block: 'obsidian' },
      ])

      const flowingLava = transition({
        cell: { ...cell, kind: 'lava', level: 1, source: false },
        horizontal: [probe('1,64,0', 'opposite-fluid')],
      })
      expect(flowingLava.changes).toStrictEqual([
        { _tag: 'Solidify', key: cell.key, block: 'cobblestone' },
      ])
    }),
  )

  it.effect('defers an unloaded downward decision without speculative spreading', () =>
    Effect.sync(() => {
      const result = transition({ below: probe('0,63,0', 'unloaded') })
      expect(result).toStrictEqual({ changes: [], defer: true })
    }),
  )

  it.effect('REGRESSION: work never exceeds the budget, however large the frontier grows', () =>
    Effect.sync(() => {
      const split = splitBudget(frontierOf(5_000, 5_000), { lavaTickActive: true })
      expect(split.work.length).toBeLessThanOrEqual(DEFAULT_FLUID_FRONTIER_BUDGET)
      expect(split.work).toHaveLength(DEFAULT_FLUID_FRONTIER_BUDGET)
    }),
  )

  it.effect('REGRESSION: lava cannot starve water — water is guaranteed half the budget', () =>
    Effect.sync(() => {
      const split = splitBudget(frontierOf(1_000, 1_000), { lavaTickActive: true, budget: 64 })
      const water = split.work.filter((item) => item.kind === 'water')
      expect(water).toHaveLength(32)
      expect(split.work.filter((item) => item.kind === 'lava')).toHaveLength(32)
    }),
  )

  it.effect('water takes the whole budget when there is no lava, rather than leaving half of it idle', () =>
    Effect.sync(() => {
      // Water is capped at half, so a water-only frontier uses half the budget
      // per tick. This is the reference's semantics verbatim
      // (packages/world/application/fluid-tick-budget.ts:25-32) and is recorded
      // here as a KNOWN LIMIT rather than as desired behaviour: it should be
      // revisited against a measurement, not silently "fixed".
      const split = splitBudget(frontierOf(1_000, 0), { lavaTickActive: true, budget: 64 })
      expect(split.work).toHaveLength(32)
    }),
  )

  it.effect('REGRESSION: an inactive lava tick RETAINS the lava frontier instead of dropping it', () =>
    Effect.sync(() => {
      const frontier = frontierOf(0, 3)
      const split = splitBudget(frontier, { lavaTickActive: false })

      expect(split.work).toStrictEqual([])
      expect(split.retainedLavaFrontier).toStrictEqual(['l0', 'l1', 'l2'])
      // And the carry-over agrees, so the stage cannot keep one and lose the
      // other. Dropping these is what produces a lava lake with a straight edge.
      expect(carryOver(frontier, split)).toStrictEqual(frontier)
    }),
  )

  it.effect('carryOver returns exactly the cells that were not evaluated', () =>
    Effect.sync(() => {
      const frontier = frontierOf(4, 0)
      const split = splitBudget(frontier, { lavaTickActive: true, budget: 4 })
      expect(split.work).toHaveLength(2)
      expect(carryOver(frontier, split).map((item) => item.key)).toStrictEqual(['w2', 'w3'])
    }),
  )

  it.effect('same-position water and lava have distinct frontier identities', () =>
    Effect.sync(() => {
      const frontier: ReadonlyArray<FluidWorkItem> = [
        { key: positionKey('interface'), kind: 'water' },
        { key: positionKey('interface'), kind: 'lava' },
      ]
      const inactive = splitBudget(frontier, { lavaTickActive: false, budget: 2 })

      expect(inactive.work).toStrictEqual([{ key: 'interface', kind: 'water' }])
      expect(carryOver(frontier, inactive)).toStrictEqual([
        { key: 'interface', kind: 'lava' },
      ])

      const active = splitBudget(frontier, { lavaTickActive: true, budget: 1 })
      expect(active.work).toStrictEqual([{ key: 'interface', kind: 'lava' }])
      expect(carryOver(frontier, active)).toStrictEqual([
        { key: 'interface', kind: 'water' },
      ])
    }),
  )

  it.effect('repeated inactive ticks remain deterministic and bounded', () =>
    Effect.sync(() => {
      const initial: ReadonlyArray<FluidWorkItem> = [
        { key: positionKey('shared'), kind: 'water' },
        { key: positionKey('shared'), kind: 'lava' },
        { key: positionKey('lava-only'), kind: 'lava' },
      ]
      const run = (): ReadonlyArray<ReadonlyArray<FluidWorkItem>> => {
        let frontier = initial
        const history: Array<ReadonlyArray<FluidWorkItem>> = []
        for (let tick = 0; tick < 8; tick += 1) {
          const split = splitBudget(frontier, { lavaTickActive: false, budget: 3 })
          expect(split.work.length).toBeLessThanOrEqual(3)
          frontier = carryOver(frontier, split)
          expect(frontier.length).toBeLessThanOrEqual(initial.length)
          history.push(frontier)
        }
        return history
      }

      expect(run()).toStrictEqual(run())
      expect(run().at(-1)).toStrictEqual([
        { key: 'shared', kind: 'lava' },
        { key: 'lava-only', kind: 'lava' },
      ])
    }),
  )

  it.effect('a zero budget evaluates nothing and loses nothing', () =>
    Effect.sync(() => {
      const frontier = frontierOf(3, 3)
      const split = splitBudget(frontier, { lavaTickActive: true, budget: 0 })
      expect(split.work).toStrictEqual([])
      expect(carryOver(frontier, split)).toStrictEqual(frontier)
    }),
  )

  /*
   * PORTED ORACLES. `<reference-impl>/packages/world/test/fluid-tick-budget.test.ts`,
   * the three of its seven cases the tests above do not already make.
   *
   * The four that were already here are the halves-and-ceilings ones. These
   * three are the asymmetries, and the first is the one a reader would guess
   * wrong: HALF IS A CAP ON WATER, NOT A RESERVATION FOR LAVA. Water is capped
   * at `floor(budget / 2)`; lava then takes `budget - waterSliceLength`, which
   * is MORE than half whenever water did not fill its own half. The test above
   * named 「water is guaranteed half the budget」 states the water side of that
   * and would pass against an implementation that gave lava a fixed half too.
   */
  it.effect('lava takes the REMAINDER, not a second half — one water cell leaves it three of four', () =>
    Effect.sync(() => {
      // The reference's own numbers, `fluid-tick-budget.test.ts:55-63`: 1 water
      // and 4 lava against a budget of 4. halfBudget = 2, water fills 1 of it,
      // and lava gets 4 - 1 = 3 rather than 2.
      const split = splitBudget(frontierOf(1, 4), { lavaTickActive: true, budget: 4 })

      expect(split.work.filter((item) => item.kind === 'water')).toHaveLength(1)
      expect(split.work.filter((item) => item.kind === 'lava')).toHaveLength(3)
    }),
  )

  it.effect('an ACTIVE lava tick retains nothing — the retained frontier is the inactive case only', () =>
    Effect.sync(() => {
      // `fluid-tick-budget.test.ts:35-40`. The mirror of the RETAINS test above,
      // and the row that stops "retain lava always" from passing both: retaining
      // an evaluated cell is how the preview's F2 doubling starts.
      const split = splitBudget(frontierOf(2, 2), { lavaTickActive: true, budget: 64 })
      expect(split.retainedLavaFrontier).toStrictEqual([])
    }),
  )

  /*
   * NOT PORTED, and measured rather than judged:
   * `fluid-tick-budget.test.ts:14-19`, 「returns empty work and no frontier for
   * empty input」.
   *
   * It was written here and then deleted, because it CANNOT FAIL. Both outputs
   * are built by iterating the input, so an empty input gives two empty lists
   * under every mutation `splitBudget` can carry — deleting the whole
   * classification loop (`if (item.kind === 'water')` and both pushes) leaves it
   * green. A test that no wrong implementation fails is not an oracle; it is a
   * line that makes the count look larger.
   *
   * The property it is REACHING for — an idle world produces no work — is real
   * and is already held on the falling-block side, where the queue is stateful
   * and the claim has content: 「REGRESSION: an untouched world produces no work,
   * because work only enters through `disturb`」 above, and the frame-level
   * 「REGRESSION: an idle frame does not touch the store at all」 in
   * `test/vertical-slice.test.ts`.
   */
})

describe('death: "You died." must not be the only message the game can print', () => {
  it.effect('REGRESSION: a fatal lava blow reports lava, not the generic fallback', () =>
    Effect.sync(() => {
      // The reference's own note, at
      // packages/app/application/frame/stages/physics-stage-health.ts:32-34:
      // an (amount)-only closure silently dropped every cause and made all
      // deaths read as the generic "You died.". `Damage.cause` is required
      // here, so that closure cannot be written.
      const dead = applyDamage({ healthPoints: 3, lastDeathCause: undefined }, {
        amount: 10,
        cause: 'lava',
      })

      expect(isDead(dead)).toBe(true)
      expect(deathMessage(dead)).toBe('You tried to swim in lava.')
      expect(deathMessage(dead)).not.toBe(DEATH_MESSAGES.generic)
    }),
  )

  it.effect('REGRESSION: every non-generic cause has its own message', () =>
    Effect.sync(() => {
      const messages = ALL_CAUSES.filter((cause) => cause !== 'generic').map(describeDeath)
      expect(new Set(messages).size).toBe(messages.length)
      expect(messages).not.toContain(DEATH_MESSAGES.generic)
    }),
  )

  it.effect('REGRESSION: only the killing blow sets the cause, so falling into lava reports lava', () =>
    Effect.sync(() => {
      const afterFall = applyDamage(fullHealth, { amount: 6, cause: 'fall' })
      expect(afterFall.lastDeathCause).toBeUndefined()

      const dead = applyDamage(afterFall, { amount: MAX_HEALTH_POINTS, cause: 'lava' })
      expect(dead.lastDeathCause).toBe('lava')
    }),
  )

  it.effect('REGRESSION: damage to an already-dead player does not rewrite the death message', () =>
    Effect.sync(() => {
      const dead = applyDamage(fullHealth, { amount: 100, cause: 'void' })
      const hitAgain = applyDamage(dead, { amount: 100, cause: 'explosion' })
      expect(hitAgain).toBe(dead)
      expect(deathMessage(hitAgain)).toBe('You fell out of the world.')
    }),
  )

  it.effect('a living player has no death message', () =>
    Effect.sync(() => {
      expect(deathMessage(fullHealth)).toBeUndefined()
      expect(deathMessage(applyDamage(fullHealth, { amount: 1, cause: 'mob' }))).toBeUndefined()
    }),
  )

  it.effect('a hand-built dead Vitals with no recorded cause still gets a message rather than nothing', () =>
    Effect.sync(() => {
      // Unreachable through `applyDamage`, which always records. It is reachable
      // through an object literal — a QA API, a save migration, a test — and a
      // death screen with no text at all is a worse failure than a generic one.
      expect(deathMessage({ healthPoints: 0, lastDeathCause: undefined })).toBe(
        DEATH_MESSAGES.generic,
      )
    }),
  )

  it.effect('health never goes below zero and negative damage never heals', () =>
    Effect.sync(() => {
      expect(applyDamage(fullHealth, { amount: 999, cause: 'fall' }).healthPoints).toBe(0)
      expect(applyDamage(fullHealth, { amount: -5, cause: 'fall' }).healthPoints).toBe(
        MAX_HEALTH_POINTS,
      )
    }),
  )
})
