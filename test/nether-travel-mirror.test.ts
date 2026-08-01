import { describe, expect, it } from 'vitest'
import { Option } from 'effect'
import { type BlockPosition } from '../src/domain/chunk-store-port'
import {
  findNearestPortal,
  NETHER_HORIZONTAL_RATIO,
  netherToOverworld,
  overworldToNether,
  PORTAL_SEARCH_RADIUS,
  resolveNetherTravel,
} from '../src/domain/nether-travel-port'

/**
 * The mc-worldgen nether-travel mirror is pinned against the rule it transcribes.
 *
 * `domain/nether-travel-port.ts` copies mc-worldgen's scaling pair, its portal
 * search and the composition over them. A mirror of a pure rule cannot drift
 * silently the way a mirror of a `Context.Tag` can — a wrong constant is a wrong
 * answer rather than an `undefined` at run time — but it drifts just as easily,
 * and the failure lands in the destination coordinate of a player who is now in
 * the wrong world.
 *
 * So the cases here are the ones mc-worldgen's own test enumerates, plus the two
 * guards in `findNearestPortal` that `./portal-travel` never reaches because it
 * passes an empty candidate list.
 */
const at = (x: number, y: number, z: number): BlockPosition => ({ x, y, z })

describe('the scaling pair, and why it is not a bijection', () => {
  it('divides by eight going in and multiplies by eight coming out', () => {
    expect(overworldToNether(at(128, 64, -256))).toStrictEqual(at(16, 64, -32))
    expect(netherToOverworld(at(16, 64, -32))).toStrictEqual(at(128, 64, -256))
    expect(NETHER_HORIZONTAL_RATIO).toBe(8)
  })

  it('leaves y alone in both directions', () => {
    expect(overworldToNether(at(0, 200, 0)).y).toBe(200)
    expect(netherToOverworld(at(0, 200, 0)).y).toBe(200)
  })

  /**
   * The asymmetry is the RULE, not a defect. Eight Overworld cells share one
   * Nether cell, so the round trip lands on the multiple of eight at or below
   * where it started — a floor, which is why negative coordinates move AWAY from
   * zero rather than toward it.
   */
  it('the round trip floors, including on the negative side', () => {
    expect(netherToOverworld(overworldToNether(at(129, 64, 129)))).toStrictEqual(at(128, 64, 128))
    expect(netherToOverworld(overworldToNether(at(-1, 64, -1)))).toStrictEqual(at(-8, 64, -8))
  })
})

describe('findNearestPortal', () => {
  const target = at(0, 64, 0)

  it('finds nothing among no candidates', () => {
    expect(Option.isNone(findNearestPortal([], target, PORTAL_SEARCH_RADIUS))).toBe(true)
  })

  it('picks the nearest of several', () => {
    const near = at(3, 64, 0)
    const found = findNearestPortal([at(50, 64, 0), near, at(10, 64, 10)], target, PORTAL_SEARCH_RADIUS)
    expect(Option.getOrNull(found)).toStrictEqual(near)
  })

  /**
   * THE FIRST GUARD `./portal-travel` cannot reach. A candidate outside the
   * radius is skipped rather than clamped — the difference matters because the
   * skipped arm is what makes the radius a REUSE bound instead of a search
   * bound, and a mutation that dropped it would reuse a portal any distance away.
   */
  it('ignores a candidate beyond the radius', () => {
    const tooFar = at(PORTAL_SEARCH_RADIUS + 1, 64, 0)
    expect(Option.isNone(findNearestPortal([tooFar], target, PORTAL_SEARCH_RADIUS))).toBe(true)
  })

  /**
   * THE SECOND GUARD. A non-finite or negative radius finds nothing rather than
   * throwing or comparing against `NaN` — every comparison with `NaN` is false,
   * so without this the reduce would silently accept the FIRST candidate at any
   * distance.
   */
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('finds nothing with a radius of %p', (radius) => {
    expect(Option.isNone(findNearestPortal([at(1, 64, 1)], target, radius))).toBe(true)
  })

  /** Ties keep the incumbent, so the result does not depend on candidate order. */
  it('keeps the incumbent on a tie', () => {
    const first = at(5, 64, 0)
    const second = at(-5, 64, 0)
    expect(Option.getOrNull(findNearestPortal([first, second], target, PORTAL_SEARCH_RADIUS))).toStrictEqual(first)
    expect(Option.getOrNull(findNearestPortal([second, first], target, PORTAL_SEARCH_RADIUS))).toStrictEqual(second)
  })
})

describe('resolveNetherTravel', () => {
  it('toggles overworld and nether', () => {
    expect(resolveNetherTravel('overworld', at(0, 64, 0), []).toDimension).toBe('nether')
    expect(resolveNetherTravel('nether', at(0, 64, 0), []).toDimension).toBe('overworld')
  })

  /**
   * `from === 'end'` RETURNS TO THE OVERWORLD. Transcribed from the reference's
   * branch where anything that is not `'overworld'` maps to `'overworld'`, and
   * pinned so that the behaviour is a decision rather than a fall-through nobody
   * looked at. It is NOT an End-portal rule.
   */
  it('the end goes to the overworld and scales like the nether', () => {
    const plan = resolveNetherTravel('end', at(2, 64, 2), [])
    expect(plan.toDimension).toBe('overworld')
    expect(plan.destination).toStrictEqual(at(16, 64, 16))
  })

  it('plans a portal when none is near, and reuses one when it is', () => {
    const planned = resolveNetherTravel('overworld', at(128, 64, -256), [])
    expect(Option.isSome(planned.portalToCreate)).toBe(true)
    expect(planned.destination).toStrictEqual(at(16, 64, -32))

    const existing = at(16, 64, -32)
    const reused = resolveNetherTravel('overworld', at(128, 64, -256), [existing])
    expect(Option.isNone(reused.portalToCreate)).toBe(true)
    expect(reused.destination).toStrictEqual(existing)
  })

  /**
   * A custom radius is honoured. This is the parameter `./portal-travel` will
   * pass once someone owns the portal list, so it is exercised now rather than
   * left as an untested affordance.
   */
  it('respects a caller-supplied search radius', () => {
    const candidate = at(20, 64, -32)
    expect(Option.isNone(resolveNetherTravel('overworld', at(128, 64, -256), [candidate], 1).portalToCreate)).toBe(
      false,
    )
    expect(Option.isNone(resolveNetherTravel('overworld', at(128, 64, -256), [candidate], 10).portalToCreate)).toBe(
      true,
    )
  })
})
