/**
 * The mirror of mc-worldgen's `domain/portal-frame.ts`, pinned.
 *
 * `test/chunk-store-mirror.test.ts` states the reason a mirror needs its own
 * test file and it applies unchanged here: this repository cannot import the
 * source (nothing is published, plan.md §6 Step 3), so nothing local can tell
 * that a transcription has drifted. mc-dev-meta's `pnpm check:mirrors` is the
 * only thing in the organisation that can see both files at once; what THIS file
 * can do is pin the behaviour that the transcription is FOR, so that a drift
 * which survives the diff still fails a named test.
 *
 * ---------------------------------------------------------------------------
 * The round trip is the load-bearing test, and it is not the obvious one
 * ---------------------------------------------------------------------------
 *
 * A detector tested against frames a test file spelled out by hand is tested
 * against one author's idea of a portal — and the author of the test is the
 * author of the detector, so the two agree by construction. mc-worldgen's own
 * test file makes the same point about the same rule: `generatePortalLayout` is
 * the INVERSE, so sweeping every legal size through it and back through
 * detection is a test the two would have to agree to break together.
 *
 * That is why the sweep below is the first `describe` and the hand-written cases
 * are the second: the hand-written ones are about the REFUSALS, which the
 * generator cannot produce.
 */
import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { blockIdOf } from '../src/domain/block-vocabulary'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition } from '../src/domain/chunk-store-port'
import {
  detectNetherPortal,
  generatePortalLayout,
  MAX_PORTAL_HEIGHT,
  MAX_PORTAL_WIDTH,
  MIN_PORTAL_HEIGHT,
  MIN_PORTAL_WIDTH,
  type BlockAt,
  type PortalAxis,
} from '../src/domain/portal-frame-port'

const OBSIDIAN = blockIdOf('obsidian')
const STONE = blockIdOf('stone')

const key = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`

/**
 * A world made of a map, defaulting to STONE.
 *
 * STONE AND NOT AIR, deliberately. An air default makes every probe outside the
 * built cells succeed, so `countAir` would walk to its cap in every direction
 * and the test would be measuring the cap rather than the frame. Solid rock with
 * a portal cut into it is the world a player actually builds one in.
 */
const worldOf = (cells: ReadonlyMap<string, BlockId>): BlockAt =>
  (x, y, z) => cells.get(key(x, y, z)) ?? STONE ?? 2

/** An obsidian ring with an air interior, at `origin`, in `axis`. */
const portalWorld = (
  origin: BlockPosition,
  axis: PortalAxis,
  width: number,
  height: number,
): Map<string, BlockId> => {
  const layout = generatePortalLayout(origin, axis, width, height)
  const cells = new Map<string, BlockId>()
  for (const cell of layout.frame) cells.set(key(cell.x, cell.y, cell.z), OBSIDIAN ?? 40)
  for (const cell of layout.interior) cells.set(key(cell.x, cell.y, cell.z), AIR_BLOCK_ID)
  return cells
}

const ORIGIN: BlockPosition = { x: 10, y: 64, z: 20 }

describe('the mirror carries kernel-sourced ids rather than literals', () => {
  it('names obsidian and air through the registry, and the ids are the table’s', () => {
    // The two comparisons the detector makes. `../domain/portal-frame-port`'s
    // header records that mc-worldgen spells them `BLOCK.OBSIDIAN` / `BLOCK.AIR`
    // and that this mirror asks kernel's registry instead; this is the
    // assertion that keeps the two expressions denoting the same bytes.
    expect(OBSIDIAN).toBe(40)
    expect(AIR_BLOCK_ID).toBe(0)
  })

  it('carries the source’s four bounds, and asserts the maxima with `>=`', () => {
    // `===` on the minima and `>=` on the maxima, which is mc-worldgen's own
    // choice and its reason: MIN 2x3 is JUSTIFIED (a second file in the
    // reference independently defines the auto-generated portal as 2x3), MAX
    // 21x21 is TRANSCRIBED AND NOT JUSTIFIED, so raising it if a real limit is
    // ever established must not be a test edit.
    expect(MIN_PORTAL_WIDTH).toBe(2)
    expect(MIN_PORTAL_HEIGHT).toBe(3)
    expect(MAX_PORTAL_WIDTH).toBeGreaterThanOrEqual(21)
    expect(MAX_PORTAL_HEIGHT).toBeGreaterThanOrEqual(21)
  })
})

describe('generate then detect: every legal size, on both axes', () => {
  it('round-trips every legal width and height', () => {
    let checked = 0
    for (const axis of ['x', 'z'] as const) {
      for (let width = MIN_PORTAL_WIDTH; width <= MAX_PORTAL_WIDTH; width += 1) {
        for (let height = MIN_PORTAL_HEIGHT; height <= MAX_PORTAL_HEIGHT; height += 1) {
          const found = detectNetherPortal(worldOf(portalWorld(ORIGIN, axis, width, height)), ORIGIN)

          expect(Option.isSome(found)).toBe(true)
          const frame = Option.getOrThrow(found)
          expect({ axis: frame.axis, width: frame.width, height: frame.height }).toStrictEqual({
            axis,
            width,
            height,
          })
          expect(frame.interior).toHaveLength(width * height)
          checked += 1
        }
      }
    }

    // The sweep is not vacuous: `docs/testing.md` §6 asks every invariant to
    // come with evidence it ran. 2 axes x 20 widths x 19 heights.
    expect(checked).toBe(2 * 20 * 19)
  })

  it('resolves the same frame from ANY interior cell, not only from the corner', () => {
    const cells = portalWorld(ORIGIN, 'x', 4, 5)
    const corner = detectNetherPortal(worldOf(cells), ORIGIN)

    // Detection walks to the bottom-left corner before measuring, so a player
    // clicking the middle of a portal gets the same answer as one clicking its
    // bottom-left cell. Without the walk this is the test that fails.
    for (let dx = 0; dx < 4; dx += 1) {
      for (let dy = 0; dy < 5; dy += 1) {
        const found = detectNetherPortal(worldOf(cells), {
          x: ORIGIN.x + dx,
          y: ORIGIN.y + dy,
          z: ORIGIN.z,
        })
        expect(Option.getOrNull(found)).toStrictEqual(Option.getOrNull(corner))
      }
    }
  })
})

describe('the refusals, which the generator cannot produce', () => {
  it('refuses when the ignition cell is not air — an already-lit portal is not waiting to be lit', () => {
    const cells = portalWorld(ORIGIN, 'x', 2, 3)
    cells.set(key(ORIGIN.x, ORIGIN.y, ORIGIN.z), STONE ?? 2)

    expect(Option.isNone(detectNetherPortal(worldOf(cells), ORIGIN))).toBe(true)
  })

  it('accepts a ring with all four corners missing — corners are not required', () => {
    const cells = portalWorld(ORIGIN, 'x', 3, 4)
    // The four cells detection deliberately does not read. Players leave them
    // out to save obsidian and vanilla accepts it.
    for (const [dx, dy] of [
      [-1, -1],
      [3, -1],
      [-1, 4],
      [3, 4],
    ] as const) {
      cells.set(key(ORIGIN.x + dx, ORIGIN.y + dy, ORIGIN.z), STONE ?? 2)
    }

    expect(Option.isSome(detectNetherPortal(worldOf(cells), ORIGIN))).toBe(true)
  })

  it('refuses when a NON-corner ring block is missing, from every one of the four edges', () => {
    // The counterpart to the test above, and the pair is the point: without it,
    // "corners are optional" would be indistinguishable from "the ring is not
    // checked". mc-worldgen's preview knocks out the middle of the bottom edge
    // for the same reason.
    const holes: ReadonlyArray<readonly [number, number]> = [
      [1, -1], // bottom edge
      [1, 4], // top edge
      [-1, 1], // left edge
      [3, 1], // right edge
    ]
    for (const [dx, dy] of holes) {
      const cells = portalWorld(ORIGIN, 'x', 3, 4)
      cells.set(key(ORIGIN.x + dx, ORIGIN.y + dy, ORIGIN.z), STONE ?? 2)
      expect(Option.isNone(detectNetherPortal(worldOf(cells), ORIGIN))).toBe(true)
    }
  })

  it('refuses an L-shaped cavity, which passes both edge measurements', () => {
    // The bottom row and the left column are measured; the rest is not. This is
    // the case the full interior sweep exists for, and it is the one a detector
    // written from the measurements alone would accept.
    const cells = portalWorld(ORIGIN, 'x', 3, 4)
    cells.set(key(ORIGIN.x + 2, ORIGIN.y + 3, ORIGIN.z), STONE ?? 2)

    expect(Option.isNone(detectNetherPortal(worldOf(cells), ORIGIN))).toBe(true)
  })

  it('refuses a cavity below the minimum and above the maximum, on both axes', () => {
    for (const axis of ['x', 'z'] as const) {
      // One short in each dimension.
      expect(
        Option.isNone(
          detectNetherPortal(worldOf(portalWorld(ORIGIN, axis, MIN_PORTAL_WIDTH - 1, 4)), ORIGIN),
        ),
      ).toBe(true)
      expect(
        Option.isNone(
          detectNetherPortal(worldOf(portalWorld(ORIGIN, axis, 3, MIN_PORTAL_HEIGHT - 1)), ORIGIN),
        ),
      ).toBe(true)
      // One over. The cap makes the walk finite; the guard then rejects the
      // over-sized measurement it returns, which is why `countAir` is given
      // `MAX + 1` rather than `MAX`.
      expect(
        Option.isNone(
          detectNetherPortal(worldOf(portalWorld(ORIGIN, axis, MAX_PORTAL_WIDTH + 1, 4)), ORIGIN),
        ),
      ).toBe(true)
      expect(
        Option.isNone(
          detectNetherPortal(worldOf(portalWorld(ORIGIN, axis, 3, MAX_PORTAL_HEIGHT + 1)), ORIGIN),
        ),
      ).toBe(true)
    }
  })

  it('prefers the X plane when a cell is the interior of a valid frame in both', () => {
    // Two portals sharing one hole. There is no correct answer to pick; the
    // transcribed order makes it DETERMINISTIC, so detection and any later
    // re-detection of the same world agree.
    const cells = new Map([
      ...portalWorld(ORIGIN, 'x', 2, 3),
      ...portalWorld(ORIGIN, 'z', 2, 3),
    ])
    // The interiors overlap only at the shared column, so re-assert it as air.
    cells.set(key(ORIGIN.x, ORIGIN.y, ORIGIN.z), AIR_BLOCK_ID)

    const found = detectNetherPortal(worldOf(cells), ORIGIN)
    expect(Option.getOrThrow(found).axis).toBe('x')
  })
})

describe('generatePortalLayout', () => {
  it('fills the corners it generates although detection does not require them', () => {
    const layout = generatePortalLayout(ORIGIN, 'x', 2, 3)

    // Ring of a (w+2) x (h+2) rectangle minus its inside: 2*(w+2) + 2*h.
    expect(layout.frame).toHaveLength(2 * 4 + 2 * 3)
    expect(layout.interior).toHaveLength(6)
    // Building a portal with four holes in it, to demonstrate that four holes
    // are legal, would be showing off at the expense of the thing built.
    expect(layout.frame).toContainEqual({ x: ORIGIN.x - 1, y: ORIGIN.y - 1, z: ORIGIN.z })
  })

  it('lays the plane along the axis it is given', () => {
    const alongX = generatePortalLayout(ORIGIN, 'x', 2, 3)
    const alongZ = generatePortalLayout(ORIGIN, 'z', 2, 3)

    expect(alongX.interior.every((cell) => cell.z === ORIGIN.z)).toBe(true)
    expect(alongZ.interior.every((cell) => cell.x === ORIGIN.x)).toBe(true)
  })
})
