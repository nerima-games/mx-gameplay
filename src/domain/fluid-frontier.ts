/**
 * Fluid propagation — a frontier with a hard per-tick budget.
 *
 * ---------------------------------------------------------------------------
 * The measured mistake this file exists to prevent
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.11: 「流体伝播はフロンティアサイズに上限(O(frontier)/tick が
 * 37〜55倍の性能改善をもたらした)」. The reference records the same number from
 * the other side, in `docs/reference/shipping-readiness-2026-07-10.md:51`:
 *
 *     Fluid simulation event-driven rework: 37–55× on its hot path.
 *
 * Two separate ideas got that improvement and both are reproduced here:
 *
 *   1. The tick works on a FRONTIER — the cells whose neighbourhood changed —
 *      rather than on every fluid cell in the world.
 *   2. The frontier is capped per tick. Water and lava share one budget, so a
 *      lava flow cannot starve water propagation and vice versa.
 *
 * `splitBudget` reproduces the reference's allocation
 * (`packages/world/application/fluid-tick-budget.ts:5-40`) exactly: water takes
 * up to half the budget, lava fills the remainder, and lava's frontier is
 * RETAINED rather than dropped when its slower tick is not active. Retaining is
 * the part that is easy to get wrong — dropping the keys makes lava stop
 * spreading in a way that only shows up minutes later, in a preview, as a lava
 * lake with a straight edge.
 *
 * ---------------------------------------------------------------------------
 * Why lava has its own tick at all
 * ---------------------------------------------------------------------------
 *
 * Vanilla lava spreads several times more slowly than water. Modelling that as
 * "run the lava half of the frontier only every N ticks" keeps one propagation
 * algorithm instead of two. `lavaTickActive` is that switch, and the caller —
 * the fluid stage — owns the counter, because a rate is a policy and this module
 * is a mechanism.
 */

import type { PositionKey } from './position-key'

export type FluidKind = 'water' | 'lava'

export type FluidWorkItem = {
  readonly key: PositionKey
  readonly kind: FluidKind
  readonly level?: number
  readonly source?: boolean
  readonly parent?: PositionKey
  readonly falling?: boolean
  readonly deferred?: number
}

export type FluidCell = {
  readonly key: PositionKey
  readonly kind: FluidKind
  readonly level: number
  readonly source: boolean
  readonly parent?: PositionKey
  readonly falling: boolean
}

export type FluidProbeState =
  | 'air'
  | 'blocked'
  | 'same-fluid'
  | 'opposite-fluid'
  | 'unloaded'
  | 'out-of-world'

export type FluidProbe = {
  readonly key: PositionKey
  readonly state: FluidProbeState
  readonly source?: boolean
}

export type FluidChange =
  | { readonly _tag: 'PlaceFluid'; readonly cell: FluidCell }
  | { readonly _tag: 'RemoveFluid'; readonly key: PositionKey }
  | {
      readonly _tag: 'Solidify'
      readonly key: PositionKey
      readonly block: 'obsidian' | 'cobblestone'
    }
  | { readonly _tag: 'ForgetFluid'; readonly key: PositionKey }

export type FluidTransition = {
  readonly changes: ReadonlyArray<FluidChange>
  readonly defer: boolean
}

export const DEFAULT_FLUID_HORIZONTAL_RANGE = {
  water: 7,
  lava: { overworld: 3, nether: 7, end: 3 },
} as const

export const MAX_FLUID_DEFERRED_ATTEMPTS = 8

/** Decide one cell's propagation without performing world IO. */
export const transitionFluidCell = (input: {
  readonly cell: FluidCell
  readonly current: FluidProbe
  readonly below: FluidProbe
  readonly horizontal: ReadonlyArray<FluidProbe>
  readonly supported: boolean
  readonly maximumHorizontalLevel: number
}): FluidTransition => {
  const { cell, current, below, horizontal } = input

  if (current.state === 'unloaded') return { changes: [], defer: true }
  if (current.state !== 'same-fluid') {
    return { changes: [{ _tag: 'ForgetFluid', key: cell.key }], defer: false }
  }
  if (!cell.source && !input.supported) {
    return { changes: [{ _tag: 'RemoveFluid', key: cell.key }], defer: false }
  }

  const contacts = [below, ...horizontal].filter(
    (probe) => probe.state === 'opposite-fluid',
  )
  if (cell.kind === 'lava' && contacts.length > 0) {
    return {
      changes: [
        {
          _tag: 'Solidify',
          key: cell.key,
          block: cell.source ? 'obsidian' : 'cobblestone',
        },
      ],
      defer: false,
    }
  }

  const changes: Array<FluidChange> = contacts.map((probe) => ({
    _tag: 'Solidify' as const,
    key: probe.key,
    block: probe.source ? ('obsidian' as const) : ('cobblestone' as const),
  }))

  if (below.state === 'air') {
    changes.push({
      _tag: 'PlaceFluid',
      cell: {
        key: below.key,
        kind: cell.kind,
        level: cell.level,
        source: false,
        parent: cell.key,
        falling: true,
      },
    })
    return { changes, defer: false }
  }
  if (below.state === 'unloaded') return { changes, defer: true }

  if (cell.level < input.maximumHorizontalLevel) {
    for (const probe of horizontal) {
      if (probe.state !== 'air') continue
      changes.push({
        _tag: 'PlaceFluid',
        cell: {
          key: probe.key,
          kind: cell.kind,
          level: cell.level + 1,
          source: false,
          parent: cell.key,
          falling: false,
        },
      })
    }
  }

  return {
    changes,
    defer: horizontal.some((probe) => probe.state === 'unloaded'),
  }
}

/**
 * Schedule a cell whose fluid state changed.
 *
 * A position may carry only one current fluid kind. Replacing an older entry
 * avoids spending tick budget on stale work after two interactions touch the
 * same cell before the next fluid stage runs.
 */
export const enqueueFluidDisturbance = (
  frontier: ReadonlyArray<FluidWorkItem>,
  item: FluidWorkItem,
): ReadonlyArray<FluidWorkItem> => [
  ...frontier.filter((candidate) => candidate.key !== item.key),
  item,
]

/**
 * Cells evaluated in one tick, across both fluids.
 *
 * Provisional: the reference tuned its budget against a specific frame time and
 * this repository has not measured its own yet. The bound existing at all is the
 * load-bearing part; the number is a knob.
 */
export const DEFAULT_FLUID_FRONTIER_BUDGET = 64

export type FluidBudgetSplit = {
  /** The cells to evaluate this tick. Never longer than the budget. */
  readonly work: ReadonlyArray<FluidWorkItem>
}

/**
 * Allocate one tick's budget across the frontier.
 *
 * Single classification pass, as in the reference: separate filter/filter/take
 * sweeps allocate intermediates on a hot path that runs every tick.
 */
export const splitBudget = (
  frontier: ReadonlyArray<FluidWorkItem>,
  options: {
    readonly budget?: number
    readonly lavaTickActive: boolean
  },
): FluidBudgetSplit => {
  const budget = Math.max(0, Math.trunc(options.budget ?? DEFAULT_FLUID_FRONTIER_BUDGET))

  const water: Array<FluidWorkItem> = []
  const lava: Array<FluidWorkItem> = []
  for (const item of frontier) {
    if (item.kind === 'water') {
      water.push(item)
    } else {
      lava.push(item)
    }
  }

  const waterSliceLength = Math.min(water.length, Math.floor(budget / 2))
  const lavaAvailable = options.lavaTickActive ? lava.length : 0
  const lavaSliceLength = Math.min(lavaAvailable, budget - waterSliceLength)

  const work: Array<FluidWorkItem> = [
    ...water.slice(0, waterSliceLength),
    ...lava.slice(0, lavaSliceLength),
  ]

  return { work }
}

/**
 * The frontier cells that were NOT evaluated and must survive into the next
 * tick.
 *
 * Split out from `splitBudget` because the two answers have different owners:
 * `work` goes to the propagation rule, `carryOver` goes back into the stage's
 * state. Fusing them into one return type invited the reference's bug of
 * dropping one of the two.
 */
export const carryOver = (
  frontier: ReadonlyArray<FluidWorkItem>,
  split: FluidBudgetSplit,
): ReadonlyArray<FluidWorkItem> => {
  const evaluatedWater = new Set<PositionKey>()
  const evaluatedLava = new Set<PositionKey>()
  for (const item of split.work) {
    const evaluated = item.kind === 'water' ? evaluatedWater : evaluatedLava
    evaluated.add(item.key)
  }

  return frontier.filter((item) => {
    const evaluated = item.kind === 'water' ? evaluatedWater : evaluatedLava
    return !evaluated.has(item.key)
  })
}
