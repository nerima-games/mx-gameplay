/**
 * Rail topology: plan.md §3.11's fifth responsibility, the half that is a rule
 * about blocks.
 *
 * The first two `describe`s are the reference's oracle
 * (`<reference-impl>/packages/game/test/rail-shape.test.ts`) transcribed, one
 * `it` per `it` and the `file:line` on each — docs/porting.md §4: move the tests
 * first, do not reinvent the specification. Everything after them is this
 * repository's, and each block says what it is for: a stated precondition, a
 * divergence from the reference, or the executable form of an ownership
 * argument that docs/responsibility.md §5 makes in prose.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { isAscendingAhead, RAIL_HEADING_EPSILON } from '../src/domain/vehicle/rail-ascent'
import {
  projectMinecartVelocity,
  resolveRailShape,
  type IsRailAt,
  type RailShape,
} from '../src/domain/vehicle/rail-shape'

/** A rail world as a set of cells. The reference's helper (`rail-shape.test.ts:10-13`). */
const railsAt = (cells: ReadonlyArray<readonly [number, number, number]>): IsRailAt => {
  const set = new Set(cells.map(([x, y, z]) => `${String(x)},${String(y)},${String(z)}`))
  return (wx, wy, wz) => set.has(`${String(wx)},${String(wy)},${String(wz)}`)
}

/** The same, wrapped so a test can assert HOW MANY cells were probed and which. */
const countingRails = (
  cells: ReadonlyArray<readonly [number, number, number]>,
): { readonly isRailAt: IsRailAt; readonly probes: Array<string> } => {
  const inner = railsAt(cells)
  const probes: Array<string> = []
  return {
    isRailAt: (wx, wy, wz) => {
      probes.push(`${String(wx)},${String(wy)},${String(wz)}`)
      return inner(wx, wy, wz)
    },
    probes,
  }
}

const CENTRE = [0, 60, 0] as const

// ---------------------------------------------------------------------------
// The reference's oracle, transcribed
// ---------------------------------------------------------------------------

describe('resolveRailShape — `<reference-impl>/packages/game/test/rail-shape.test.ts:15-41`', () => {
  it.effect('a straight north-south run resolves ns; east-west resolves ew (:16-21)', () =>
    Effect.sync(() => {
      const ns = railsAt([
        [0, 60, -1],
        [0, 60, 0],
        [0, 60, 1],
      ])
      expect(resolveRailShape(ns, 0, 60, 0)).toBe('ns')

      const ew = railsAt([
        [-1, 60, 0],
        [0, 60, 0],
        [1, 60, 0],
      ])
      expect(resolveRailShape(ew, 0, 60, 0)).toBe('ew')
    }),
  )

  it.effect('a single neighbour extends that axis (:23-26)', () =>
    Effect.sync(() => {
      const stub = railsAt([
        [0, 60, 0],
        [0, 60, 1],
      ])
      expect(resolveRailShape(stub, 0, 60, 0)).toBe('ns')
    }),
  )

  it.effect('perpendicular neighbours resolve a curve (:28-31)', () =>
    Effect.sync(() => {
      const corner = railsAt([
        [0, 60, 0],
        [0, 60, -1],
        [1, 60, 0],
      ])
      // The reference's oracle asserts "this is a curve"; which curve is a
      // question its collapsed shape could not even ask. North + east is the
      // orientation this specific layout connects — see `rail-shape.ts`'s
      // `RailShape` doc comment for why the answer is now this specific
      // rather than the reference's undifferentiated one.
      expect(resolveRailShape(corner, 0, 60, 0)).toBe('curve_north_east')
    }),
  )

  it.effect('slope neighbours (one block up) still connect (:33-36)', () =>
    Effect.sync(() => {
      const slope = railsAt([
        [0, 60, 0],
        [0, 61, 1],
      ])
      expect(resolveRailShape(slope, 0, 60, 0)).toBe('ns')
    }),
  )

  it.effect('no neighbours resolves isolated (:38-40)', () =>
    Effect.sync(() => {
      expect(resolveRailShape(railsAt([CENTRE]), 0, 60, 0)).toBe('isolated')
    }),
  )
})

describe('isAscendingAhead — `<reference-impl>/packages/game/test/rail-shape.test.ts:60-71`', () => {
  const slope = railsAt([
    [0, 60, 0],
    [0, 61, 1],
  ])

  it.effect('detects a rail one block up along the motion direction (:61-65)', () =>
    Effect.sync(() => {
      expect(isAscendingAhead(slope, 0, 60, 0, 0, 2)).toBe(true)
      expect(isAscendingAhead(slope, 0, 60, 0, 0, -2)).toBe(false)
    }),
  )

  it.effect('a stationary cart never climbs (:67-70)', () =>
    Effect.sync(() => {
      expect(isAscendingAhead(slope, 0, 60, 0, 0, 0)).toBe(false)
    }),
  )
})

// ---------------------------------------------------------------------------
// The neighbour table in full
// ---------------------------------------------------------------------------

describe('resolveRailShape: all sixteen neighbour combinations', () => {
  /**
   * `domain/vehicle/rail-shape.ts` replaced the reference's `nsCount > 0` with
   * `north || south` and its header claims the two agree on every input. This is
   * that claim enumerated rather than asserted: four independent neighbours,
   * sixteen cases, and the expected shape written out by hand.
   *
   * It is also where "a curve beats a straight" is pinned. The four T-junctions
   * (three neighbours) and the crossroads (four) all answer the undirected
   * `'curve'` — there is no single connected pair to name for those — and a
   * reader who reordered the tests in `resolveRailShape` so that the straight
   * case ran first would get `'ns'` for two of them.
   *
   * The four clean two-neighbour perpendicular cases answer an ORIENTED curve
   * instead of the undirected one; `rail-shape.ts`'s `RailShape` doc comment
   * has the reasoning. This table is what makes that repair checkable per
   * input, the same way it already checks `north || south`.
   */
  const NEIGHBOURS = {
    north: [0, 60, -1],
    south: [0, 60, 1],
    east: [1, 60, 0],
    west: [-1, 60, 0],
  } as const

  const CASES: ReadonlyArray<readonly [ReadonlyArray<keyof typeof NEIGHBOURS>, RailShape]> = [
    [[], 'isolated'],
    [['north'], 'ns'],
    [['south'], 'ns'],
    [['north', 'south'], 'ns'],
    [['east'], 'ew'],
    [['west'], 'ew'],
    [['east', 'west'], 'ew'],
    [['north', 'east'], 'curve_north_east'],
    [['north', 'west'], 'curve_north_west'],
    [['south', 'east'], 'curve_south_east'],
    [['south', 'west'], 'curve_south_west'],
    [['north', 'south', 'east'], 'curve'],
    [['north', 'south', 'west'], 'curve'],
    [['north', 'east', 'west'], 'curve'],
    [['south', 'east', 'west'], 'curve'],
    [['north', 'south', 'east', 'west'], 'curve'],
  ]

  it.effect('every combination resolves to the shape the rule states', () =>
    Effect.sync(() => {
      expect(CASES).toHaveLength(16)

      for (const [present, expected] of CASES) {
        const world = railsAt([CENTRE, ...present.map((side) => NEIGHBOURS[side])])
        expect(resolveRailShape(world, 0, 60, 0)).toBe(expected)
      }
    }),
  )
})

// ---------------------------------------------------------------------------
// The precondition, stated rather than discovered
// ---------------------------------------------------------------------------

describe('resolveRailShape: the centre cell is never asked about', () => {
  /**
   * `domain/vehicle/rail-shape.ts`'s header records this as a PRECONDITION the
   * reference's caller holds (`game-state-update-orchestration.ts:268` checks
   * `isOnRail` before asking for a shape) rather than as an oversight to repair.
   * If a later reader adds the centre probe, these go red and they have the
   * argument to read.
   */
  it.effect('empty air beside a rail still answers with that rail’s axis', () =>
    Effect.sync(() => {
      const neighbourOnly = railsAt([[0, 60, 1]])
      expect(resolveRailShape(neighbourOnly, 0, 60, 0)).toBe('ns')
    }),
  )

  it.effect('the centre cell is not among the cells probed', () =>
    Effect.sync(() => {
      const { isRailAt, probes } = countingRails([])
      resolveRailShape(isRailAt, 0, 60, 0)
      expect(probes).not.toContain('0,60,0')
    }),
  )

  it.effect('a lone rail and empty air are indistinguishable, which is what makes it a precondition', () =>
    Effect.sync(() => {
      expect(resolveRailShape(railsAt([CENTRE]), 0, 60, 0)).toBe('isolated')
      expect(resolveRailShape(railsAt([]), 0, 60, 0)).toBe('isolated')
    }),
  )
})

// ---------------------------------------------------------------------------
// Slopes connect in both directions, and the probe budget is bounded
// ---------------------------------------------------------------------------

describe('resolveRailShape: the ±1 slope tolerance and what it costs', () => {
  it.effect('a neighbour one block DOWN connects too, which the reference oracle does not cover', () =>
    Effect.sync(() => {
      const descending = railsAt([
        [0, 60, 0],
        [0, 59, 1],
      ])
      expect(resolveRailShape(descending, 0, 60, 0)).toBe('ns')
    }),
  )

  it.effect('a neighbour two blocks up does NOT connect — the tolerance is exactly one', () =>
    Effect.sync(() => {
      const tooHigh = railsAt([
        [0, 60, 0],
        [0, 62, 1],
      ])
      expect(resolveRailShape(tooHigh, 0, 60, 0)).toBe('isolated')
    }),
  )

  it.effect('an empty neighbourhood costs exactly twelve probes: four directions, three heights', () =>
    Effect.sync(() => {
      const { isRailAt, probes } = countingRails([])
      expect(resolveRailShape(isRailAt, 0, 60, 0)).toBe('isolated')
      expect(probes).toHaveLength(12)
      expect(new Set(probes).size).toBe(12)
    }),
  )

  it.effect('level track short-circuits to four probes, because level is tested first', () =>
    Effect.sync(() => {
      const { isRailAt, probes } = countingRails([
        [0, 60, -1],
        [0, 60, 1],
        [1, 60, 0],
        [-1, 60, 0],
      ])
      expect(resolveRailShape(isRailAt, 0, 60, 0)).toBe('curve')
      expect(probes).toStrictEqual(['0,60,-1', '0,60,1', '1,60,0', '-1,60,0'])
    }),
  )
})

// ---------------------------------------------------------------------------
// Totality: the guard the reference does not have
// ---------------------------------------------------------------------------

describe('resolveRailShape: a non-finite cell answers isolated WITHOUT reading the world', () => {
  const BROKEN: ReadonlyArray<readonly [string, number, number, number]> = [
    ['x is NaN', Number.NaN, 60, 0],
    ['y is NaN', 0, Number.NaN, 0],
    ['z is NaN', 0, 60, Number.NaN],
    ['x is Infinity', Number.POSITIVE_INFINITY, 60, 0],
    ['y is -Infinity', 0, Number.NEGATIVE_INFINITY, 0],
    ['z is Infinity', 0, 60, Number.POSITIVE_INFINITY],
  ]

  it.effect('every broken coordinate is refused, and refused before any probe', () =>
    Effect.sync(() => {
      for (const [, wx, wy, wz] of BROKEN) {
        // A world where EVERY cell is a rail: without the guard the rule would
        // answer `'curve'` here, which is the constraining answer, from a
        // coordinate nobody measured.
        const { isRailAt, probes } = countingRails([])
        const everywhere: IsRailAt = (px, py, pz) => {
          isRailAt(px, py, pz)
          return true
        }
        expect(resolveRailShape(everywhere, wx, wy, wz)).toBe('isolated')
        expect(probes).toStrictEqual([])
      }
    }),
  )
})

// ---------------------------------------------------------------------------
// The ownership argument, in executable form
// ---------------------------------------------------------------------------

describe('isAscendingAhead: the heading is a DIRECTION, which is why this rule is not mc-physics’', () => {
  /**
   * docs/responsibility.md §5 places this rule here on the ground that its
   * velocity-shaped parameter is consumed by `Math.sign` and one comparison of
   * magnitudes, so the magnitude cannot reach the answer. That is a property,
   * and a property can be tested.
   *
   * If somebody later adds a minimum speed to mount a slope — a plausible and
   * entirely reasonable rule — this goes red, and the §5 row has to be rewritten
   * before the code lands. That is the whole point of writing it this way.
   */
  const ramp = railsAt([
    [0, 60, 0],
    [1, 61, 0],
    [0, 61, 1],
  ])

  const SCALES = [1e-6, 0.5, 1, 2, 17, 1e6]

  it.effect('scaling a heading by any positive factor cannot change the answer', () =>
    Effect.sync(() => {
      for (const scale of SCALES) {
        expect(isAscendingAhead(ramp, 0, 60, 0, 1 * scale, 0)).toBe(true)
        expect(isAscendingAhead(ramp, 0, 60, 0, -1 * scale, 0)).toBe(false)
        expect(isAscendingAhead(ramp, 0, 60, 0, 0, 1 * scale)).toBe(true)
        expect(isAscendingAhead(ramp, 0, 60, 0, 0, -1 * scale)).toBe(false)
      }
    }),
  )

  it.effect('the answer is a fact about ONE block: exactly one probe, and it is one cell up', () =>
    Effect.sync(() => {
      const { isRailAt, probes } = countingRails([[0, 61, 1]])
      expect(isAscendingAhead(isRailAt, 0, 60, 0, 0, 4)).toBe(true)
      expect(probes).toStrictEqual(['0,61,1'])
    }),
  )
})

describe('isAscendingAhead: the dominant axis, and where the ties go', () => {
  const bothRamps = railsAt([
    [0, 60, 0],
    [-1, 61, 0],
    [0, 61, 1],
  ])

  it.effect('a 45-degree heading resolves to the X ramp, because the test is >= and not >', () =>
    Effect.sync(() => {
      // West and south are both ramps. `|-3| >= |3|` picks west.
      const { isRailAt, probes } = countingRails([
        [-1, 61, 0],
        [0, 61, 1],
      ])
      expect(isAscendingAhead(isRailAt, 0, 60, 0, -3, 3)).toBe(true)
      expect(probes).toStrictEqual(['-1,61,0'])
    }),
  )

  it.effect('a heading dominated by Z probes the Z ramp instead', () =>
    Effect.sync(() => {
      const { isRailAt, probes } = countingRails([
        [-1, 61, 0],
        [0, 61, 1],
      ])
      expect(isAscendingAhead(isRailAt, 0, 60, 0, -3, 4)).toBe(true)
      expect(probes).toStrictEqual(['0,61,1'])
    }),
  )

  it.effect('the two ramps are genuinely different cells, so the tie-break is observable', () =>
    Effect.sync(() => {
      expect(isAscendingAhead(bothRamps, 0, 60, 0, -1, 1)).toBe(true)
      const westOnly = railsAt([[-1, 61, 0]])
      // Dominated by Z: probes south, where there is no ramp.
      expect(isAscendingAhead(westOnly, 0, 60, 0, -1, 2)).toBe(false)
      expect(isAscendingAhead(westOnly, 0, 60, 0, -1, 1)).toBe(true)
    }),
  )
})

describe('isAscendingAhead: the deadband, transcribed', () => {
  const slope = railsAt([[0, 61, 1]])

  it.effect('the bound is per-axis and not on the resultant — the reference’s shape, kept', () =>
    Effect.sync(() => {
      const under = RAIL_HEADING_EPSILON * 0.9
      // Length is 1.27e-9, LARGER than the bound, and it is still refused
      // because both axes are under it individually.
      expect(Math.hypot(under, under)).toBeGreaterThan(RAIL_HEADING_EPSILON)

      // The ramp is at the cell an X-dominant heading probes — `(under, under)`
      // ties, and ties go to X — so a rule that measured the RESULTANT would
      // pass the deadband and answer `true` here. That is the only arrangement
      // in which the two rules disagree; with the ramp anywhere else both
      // answer `false` and the test would pin nothing.
      const eastRamp = railsAt([[1, 61, 0]])
      expect(isAscendingAhead(eastRamp, 0, 60, 0, under, under)).toBe(false)
      // Same world, same direction, a heading that clears the bound: `true`.
      // So the refusal above is the deadband and not a missing rail.
      expect(isAscendingAhead(eastRamp, 0, 60, 0, 1, 1)).toBe(true)
    }),
  )

  it.effect('one axis at the bound is enough to have a heading', () =>
    Effect.sync(() => {
      expect(isAscendingAhead(slope, 0, 60, 0, 0, RAIL_HEADING_EPSILON)).toBe(true)
      expect(isAscendingAhead(slope, 0, 60, 0, 0, RAIL_HEADING_EPSILON * 0.9)).toBe(false)
    }),
  )
})

describe('isAscendingAhead: a broken measurement does not climb (DIVERGENCE from the reference)', () => {
  /**
   * `domain/vehicle/rail-ascent.ts`'s header sets out the reference's behaviour:
   * `Math.abs(NaN) < 1e-9` is false so a `NaN` heading passes the deadband, and
   * `Math.abs(NaN) >= Math.abs(vz)` is false so the rule decides the cart is
   * travelling along z and probes a cell it was never aimed at. The reference
   * therefore CLIMBS on a broken measurement. This is the opposite, and these
   * tests are the record that it is deliberate.
   */
  const everywhere: IsRailAt = () => true

  const BROKEN: ReadonlyArray<readonly [string, number, number, number, number, number]> = [
    ['heading x is NaN', 0, 60, 0, Number.NaN, 1],
    ['heading z is NaN', 0, 60, 0, 1, Number.NaN],
    ['heading x is Infinity', 0, 60, 0, Number.POSITIVE_INFINITY, 1],
    ['heading z is -Infinity', 0, 60, 0, 1, Number.NEGATIVE_INFINITY],
    ['cell x is NaN', Number.NaN, 60, 0, 0, 1],
    ['cell y is NaN', 0, Number.NaN, 0, 0, 1],
    ['cell z is NaN', 0, 60, Number.NaN, 0, 1],
  ]

  it.effect('every broken input refuses, in a world where every cell is a rail', () =>
    Effect.sync(() => {
      for (const [, wx, wy, wz, hx, hz] of BROKEN) {
        expect(isAscendingAhead(everywhere, wx, wy, wz, hx, hz)).toBe(false)
      }
      // The same world says yes to a heading that is not broken, so the refusals
      // above are the guard and not an empty world.
      expect(isAscendingAhead(everywhere, 0, 60, 0, 0, 1)).toBe(true)
    }),
  )

  it.effect('a refused input reads no blocks at all', () =>
    Effect.sync(() => {
      const { isRailAt, probes } = countingRails([])
      isAscendingAhead(isRailAt, 0, 60, 0, Number.NaN, 1)
      isAscendingAhead(isRailAt, Number.NaN, 60, 0, 0, 1)
      isAscendingAhead(isRailAt, 0, 60, 0, 0, 0)
      expect(probes).toStrictEqual([])
    }),
  )
})

/**
 * `projectMinecartVelocity` has no reference oracle behind it — verified by
 * absence, not by memory: every other symbol and `describe` block in this
 * file and in `rail-shape.ts` cites an exact `<reference-impl>` `file:line`;
 * this one never has, not in its doc comment, not in a single assertion
 * below, and not in the commit that introduced it. `docs/testing.md` used to
 * claim three of the reference's ten `rail-shape.test.ts` cases were
 * transcribed here — that claim has been removed, being unbacked by any
 * citation this repository can produce (see the changeset for this fix).
 *
 * The corner-turning cases below are therefore checked against the real
 * stepping path instead: `test/vehicle-rail-simulation.test.ts`'s closed
 * rectangular circuit is the actual proof that these are correct, the same
 * way `test/rail.test.ts` treats the sixteen-neighbour table as the proof for
 * `resolveRailShape`. These pinned cases are the fast, isolated half of that
 * same claim.
 */
describe('projectMinecartVelocity', () => {
  it.effect('keeps speed while projecting onto a straight rail axis', () =>
    Effect.sync(() => {
      expect(projectMinecartVelocity('ns', 3, 4)).toStrictEqual({ vx: 0, vz: 5 })
      expect(projectMinecartVelocity('ew', 3, 4)).toStrictEqual({ vx: 5, vz: 0 })
    }),
  )

  it.effect('uses the dominant axis to continue straight through an AMBIGUOUS junction', () =>
    Effect.sync(() => {
      // `'curve'` (undirected) is only reachable from a T-junction or a
      // crossing now — a clean two-neighbour bend gets an oriented shape
      // instead (see the tests below). A junction has no single connected
      // pair to steer onto, so this keeps the cart on the axis it already
      // has, which is a pass-through rather than a turn.
      //
      // The inputs are axis-aligned, not diagonal: a straight rail zeros the
      // perpendicular component before handing off (the test above), so a
      // cart is NEVER handed to a junction cell with a large component on
      // both axes. `projectMinecartVelocity('curve', 3, 4)` was pinned here
      // before this fix and asserted a shape this physics cannot produce —
      // corrected rather than kept, per the same rule that added the oriented
      // cases below.
      expect(projectMinecartVelocity('curve', 5, 0)).toStrictEqual({ vx: 5, vz: 0 })
      expect(projectMinecartVelocity('curve', 0, 5)).toStrictEqual({ vx: 0, vz: 5 })
    }),
  )

  it.effect('an oriented curve turns the cart onto its OTHER leg, not the one it arrived on', () =>
    Effect.sync(() => {
      // `curve_north_east` connects north and east. Arriving from the north
      // (travelling south, vz > 0, vx == 0 — a straight rail's handoff) must
      // exit east; arriving from the east (travelling west, vx < 0, vz == 0)
      // must exit north. This is the case `test/vehicle-rail-simulation.test
      // .ts`'s rectangle depends on: four corners, each turning exactly once.
      expect(projectMinecartVelocity('curve_north_east', 0, 5)).toStrictEqual({ vx: 5, vz: 0 })
      expect(projectMinecartVelocity('curve_north_east', -5, 0)).toStrictEqual({ vx: 0, vz: -5 })

      expect(projectMinecartVelocity('curve_north_west', 0, 5)).toStrictEqual({ vx: -5, vz: 0 })
      expect(projectMinecartVelocity('curve_north_west', 5, 0)).toStrictEqual({ vx: 0, vz: -5 })

      expect(projectMinecartVelocity('curve_south_east', 0, -5)).toStrictEqual({ vx: 5, vz: 0 })
      expect(projectMinecartVelocity('curve_south_east', -5, 0)).toStrictEqual({ vx: 0, vz: 5 })

      expect(projectMinecartVelocity('curve_south_west', 0, -5)).toStrictEqual({ vx: -5, vz: 0 })
      expect(projectMinecartVelocity('curve_south_west', 5, 0)).toStrictEqual({ vx: 0, vz: 5 })
    }),
  )

  it.effect('an oriented curve preserves speed, not just direction', () =>
    Effect.sync(() => {
      expect(projectMinecartVelocity('curve_south_west', 0, -3)).toStrictEqual({ vx: -3, vz: 0 })
      expect(projectMinecartVelocity('curve_south_west', 8, 0)).toStrictEqual({ vx: 0, vz: 8 })
    }),
  )

  /**
   * REPAIR, NOT A PORT — see `rail-shape.ts`'s doc comment on this function
   * for the mechanism and `test/vehicle-rail-simulation.test.ts`'s slow-cart
   * test for the same defect caught across real ticks.
   *
   * `resolveRailShape` is re-read from the SAME curve cell on every tick
   * until the cart's floored position finally crosses a boundary, which takes
   * more than one tick whenever the per-tick displacement is under about half
   * a block. Each re-read calls this function again with ITS OWN prior output
   * as `vx`/`vz`. Feeding a curve's own exit vector back in must be a no-op:
   * before the fix, `towardX` read that output as a fresh arrival and turned
   * it a SECOND time, back onto the leg the cart had just left.
   */
  it.effect('REGRESSION-GUARD: an oriented curve does not re-turn a cart already exiting on one of its own legs', () =>
    Effect.sync(() => {
      expect(projectMinecartVelocity('curve_north_east', 5, 0)).toStrictEqual({ vx: 5, vz: 0 })
      expect(projectMinecartVelocity('curve_north_east', 0, -5)).toStrictEqual({ vx: 0, vz: -5 })

      expect(projectMinecartVelocity('curve_north_west', -5, 0)).toStrictEqual({ vx: -5, vz: 0 })
      expect(projectMinecartVelocity('curve_north_west', 0, -5)).toStrictEqual({ vx: 0, vz: -5 })

      expect(projectMinecartVelocity('curve_south_east', 5, 0)).toStrictEqual({ vx: 5, vz: 0 })
      expect(projectMinecartVelocity('curve_south_east', 0, 5)).toStrictEqual({ vx: 0, vz: 5 })

      expect(projectMinecartVelocity('curve_south_west', -5, 0)).toStrictEqual({ vx: -5, vz: 0 })
      expect(projectMinecartVelocity('curve_south_west', 0, 5)).toStrictEqual({ vx: 0, vz: 5 })
    }),
  )

  it.effect('isolated track leaves the horizontal velocity untouched', () =>
    Effect.sync(() => {
      expect(projectMinecartVelocity('isolated', 3, 4)).toStrictEqual({ vx: 3, vz: 4 })
    }),
  )

  it.effect('non-finite inputs refuse to propagate', () =>
    Effect.sync(() => {
      expect(projectMinecartVelocity('ew', Number.NaN, 4)).toStrictEqual({ vx: 0, vz: 0 })
      expect(projectMinecartVelocity('ns', 3, Number.POSITIVE_INFINITY)).toStrictEqual({
        vx: 0,
        vz: 0,
      })
    }),
  )

  it.effect('a genuinely stationary cart (zero speed) stays at zero, on any shape', () =>
    Effect.sync(() => {
      // Distinct from the non-finite guard above: 0 and 0 are both finite, so
      // this is the OTHER way `Math.hypot` can hand back a speed the rule
      // must not divide direction out of.
      expect(projectMinecartVelocity('ns', 0, 0)).toStrictEqual({ vx: 0, vz: 0 })
      expect(projectMinecartVelocity('isolated', 0, 0)).toStrictEqual({ vx: 0, vz: 0 })
    }),
  )

  it.effect('a straight rail perpendicular to the velocity still gets a sign, from the axis that has one', () =>
    Effect.sync(() => {
      // `vx` is exactly 0 on an east-west rail: `Math.sign(vx)` alone would
      // collapse the result to zero even though the cart is moving (along z),
      // so the rule falls back to `Math.sign(vz)` to pick a direction along x.
      expect(projectMinecartVelocity('ew', 0, 5)).toStrictEqual({ vx: 5, vz: 0 })
      expect(projectMinecartVelocity('ew', 0, -5)).toStrictEqual({ vx: -5, vz: 0 })

      // The mirrored case on a north-south rail: `vz` is 0, so `Math.sign(vz)`
      // falls back to `Math.sign(vx)`.
      expect(projectMinecartVelocity('ns', 5, 0)).toStrictEqual({ vx: 0, vz: 5 })
      expect(projectMinecartVelocity('ns', -5, 0)).toStrictEqual({ vx: 0, vz: -5 })
    }),
  )
})
