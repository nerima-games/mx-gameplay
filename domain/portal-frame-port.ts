/**
 * PROVISIONAL LOCAL MIRROR of `@nerima-games/mc-worldgen`'s
 * `domain/portal-frame.ts`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * WHEN mc-worldgen IS PUBLISHED:
 *   1. add `@nerima-games/mc-worldgen` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './portal-frame-port'` at `'@nerima-games/mc-worldgen'`.
 *
 * It is NOT re-exported from `index.ts`, for the reason `./chunk-store-port`,
 * `./frame-contract`, `./position-key`, `./item-vocabulary` and
 * `./block-vocabulary` are not: re-exporting another repository's rule would
 * make the promised deletion a breaking change for every consumer of
 * mx-gameplay. `test/public-api.test.ts` pins that absence.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SECOND mc-worldgen MIRROR AND NOT A SECTION OF THE FIRST
 * ---------------------------------------------------------------------------
 *
 * `./chunk-store-port` mirrors ONE thing — mc-worldgen's `ChunkStore` service —
 * and its header records at length what happened when it mirrored two: four
 * capability predicates sat in it under a heading that said they were kernel's,
 * and the repoint step would not have repointed them, it would have DELETED
 * them. The lesson recorded there is about the source rather than about the
 * file: 「a mirror's home is decided by WHOSE BARREL REPLACES IT」.
 *
 * Both files are replaced by the same barrel, so by that rule they could be one
 * file. They are two because the SOURCES are two modules with two lifetimes:
 * `application/chunk-store.ts` is a service and `domain/portal-frame.ts` is a
 * pure rule, mc-worldgen may publish or move either without the other, and
 * `./block-vocabulary` and `./item-vocabulary` are already the precedent for two
 * mirrors of one package. One mirror per source module; any number of them per
 * package.
 *
 * ---------------------------------------------------------------------------
 * THE ONE PLACE THIS TRANSCRIPTION IS NOT LITERAL, AND WHY
 * ---------------------------------------------------------------------------
 *
 * mc-worldgen compares against `BLOCK.AIR` and `BLOCK.OBSIDIAN`, two branded
 * constants out of its own `domain/biome.ts`. This repository has neither, and
 * the two available spellings are not equally good:
 *
 *   - a literal `40` for obsidian would be exactly the scatter plan.md §3.1
 *     measured (`blockTypeToIndex('SAND')` in 229 places across 51 files), and
 *     it would go stale silently if kernel ever renumbered a row;
 *   - `blockTypeOfId(id) === 'obsidian'` asks KERNEL's registry
 *     (`./block-vocabulary`) what the byte denotes, which is the same question
 *     `BLOCK.OBSIDIAN` answers from the other end.
 *
 * The second is used. It is a different EXPRESSION of the same comparison and
 * not a different rule: `test/portal-frame-mirror.test.ts` pins the two answers
 * against the ids kernel's table gives, so a renumbering breaks a named test
 * rather than the detector.
 *
 * The positions are `./chunk-store-port`'s UNBRANDED `BlockPosition` rather than
 * mc-worldgen's branded one, which is the widening that file's header already
 * argues: a branded value from the source is assignable to this alias, so the
 * deletion in step 3 above narrows rather than widens.
 *
 * Everything else — the four bounds, the plane probe, the corner-exclusion rule,
 * the X-before-Z order, the `None` on a non-air ignition cell — is transcribed.
 * The comments below are the source's, shortened where they discuss decisions
 * that were made in that repository and cannot be revisited here.
 */
import { Option } from 'effect'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition } from './chunk-store-port'
import { blockTypeOfId } from './block-vocabulary'

/**
 * Reads the block at an integer world coordinate.
 *
 * THREE NUMBERS AND NOT A `BlockPosition`, which is the source's decision and
 * the reason this repository cannot simply pass it `ChunkStoreApi.getBlock`:
 * detection probes on the order of `width x height` cells plus the ring — up to
 * ~530 for a maximum-sized frame — and mc-worldgen removed the per-probe object
 * allocation deliberately. `number` on the way out for the blunter reason that a
 * chunk is a `Uint8Array` and reading one yields a number.
 *
 * IT IS ALSO SYNCHRONOUS, and that is the whole of the problem
 * `./interactions/ignite-portal` has to solve, since every block read in this
 * repository is an `Effect`. See `./chunk-store-port`'s note on `blockIndex` for
 * why the answer is a chunk-buffer read rather than five hundred round trips.
 */
export type BlockAt = (x: number, y: number, z: number) => number

/** The horizontal axis that the portal's vertical plane runs along. */
export type PortalAxis = 'x' | 'z'

export type PortalFrame = {
  readonly axis: PortalAxis
  readonly width: number
  readonly height: number
  /** The interior cells, AIR today, that become portal blocks when lit. */
  readonly interior: ReadonlyArray<BlockPosition>
}

/**
 * The four size bounds, transcribed. mc-worldgen's header is explicit about
 * which of them are justified and which are merely carried, and that
 * distinction is worth keeping on this side too:
 *
 * MIN 2 x 3 — JUSTIFIED, corroborated inside the reference implementation by a
 * second file (`nether-travel.ts:23-24`) that independently defines the size of
 * an AUTO-GENERATED portal as 2 x 3. Two files that never import each other
 * agree, and the generator would produce an undetectable portal if they did not.
 *
 * MAX 21 x 21 — TRANSCRIBED, NOT JUSTIFIED, and mc-worldgen says so rather than
 * dressing a recollection of the vanilla limit up as a derivation. What the code
 * needs from it is weaker than the number: as an ACCEPTANCE bound it only has to
 * be at least as large as any frame we are willing to detect, and as a
 * TERMINATION bound it is what makes `countAir` finite over the unbounded air
 * above an obsidian ring built on open ground.
 */
export const MIN_PORTAL_WIDTH = 2
export const MAX_PORTAL_WIDTH = 21
export const MIN_PORTAL_HEIGHT = 3
export const MAX_PORTAL_HEIGHT = 21

/** kernel's registry, asked the question `BLOCK.OBSIDIAN` answers. See the header. */
const isObsidian = (block: BlockId): boolean => blockTypeOfId(block) === 'obsidian'

/**
 * Reads one cell of the plane without allocating.
 *
 * `(h, y)` are in-plane coordinates: `h` runs along `axis` and `fixed` is the
 * constant coordinate on the other horizontal axis.
 */
const probe = (blockAt: BlockAt, axis: PortalAxis, fixed: number, h: number, y: number): number =>
  axis === 'x' ? blockAt(h, y, fixed) : blockAt(fixed, y, h)

/** The same mapping, materialised. Called once per cell of the RESULT. */
const positionAt = (axis: PortalAxis, fixed: number, h: number, y: number): BlockPosition =>
  axis === 'x' ? { x: h, y, z: fixed } : { x: fixed, y, z: h }

/**
 * Counts consecutive AIR cells from `(h0, y0)` inclusive, stepping `(dh, dy)`.
 *
 * Capped at `max` so that an unbounded region of air terminates the walk.
 * Callers pass `MAX + 1` so that an over-sized run is measurable as over-sized
 * rather than clamping to the legal maximum and being accepted.
 */
const countAir = (
  blockAt: BlockAt,
  axis: PortalAxis,
  fixed: number,
  h0: number,
  y0: number,
  dh: number,
  dy: number,
  max: number,
): number => {
  let n = 0
  while (n < max) {
    if (probe(blockAt, axis, fixed, h0 + dh * n, y0 + dy * n) !== AIR_BLOCK_ID) break
    n += 1
  }
  return n
}

/** Resolves a frame in one plane, anchored at an interior AIR cell `(h0, y0)`. */
const detectInPlane = (
  blockAt: BlockAt,
  axis: PortalAxis,
  fixed: number,
  h0: number,
  y0: number,
): Option.Option<PortalFrame> => {
  // Walk to the bottom-left interior corner. The caller has already established
  // that the anchor itself is AIR, so both counts are at least 1 and the `- 1`
  // cannot push the corner past the anchor.
  const bottomY = y0 - (countAir(blockAt, axis, fixed, h0, y0, 0, -1, MAX_PORTAL_HEIGHT + 1) - 1)
  const leftH = h0 - (countAir(blockAt, axis, fixed, h0, bottomY, -1, 0, MAX_PORTAL_WIDTH + 1) - 1)

  // Measure the interior from that corner, one past the maximum in each axis.
  const width = countAir(blockAt, axis, fixed, leftH, bottomY, 1, 0, MAX_PORTAL_WIDTH + 1)
  const height = countAir(blockAt, axis, fixed, leftH, bottomY, 0, 1, MAX_PORTAL_HEIGHT + 1)

  if (width < MIN_PORTAL_WIDTH) return Option.none()
  if (width > MAX_PORTAL_WIDTH) return Option.none()
  if (height < MIN_PORTAL_HEIGHT) return Option.none()
  if (height > MAX_PORTAL_HEIGHT) return Option.none()

  // The bottom row and left column were measured; the rest of the rectangle was
  // not. An L-shaped cavity passes both measurements and is not a portal, so the
  // interior is swept in full.
  for (let h = leftH; h < leftH + width; h++) {
    for (let y = bottomY; y < bottomY + height; y++) {
      if (probe(blockAt, axis, fixed, h, y) !== AIR_BLOCK_ID) return Option.none()
    }
  }

  // The obsidian ring, corners EXCLUDED. Requiring corners would reject the
  // four-cornerless portal that vanilla accepts and that players actually build
  // to save obsidian.
  for (let h = leftH; h < leftH + width; h++) {
    if (!isObsidian(probe(blockAt, axis, fixed, h, bottomY - 1))) return Option.none()
    if (!isObsidian(probe(blockAt, axis, fixed, h, bottomY + height))) return Option.none()
  }
  for (let y = bottomY; y < bottomY + height; y++) {
    if (!isObsidian(probe(blockAt, axis, fixed, leftH - 1, y))) return Option.none()
    if (!isObsidian(probe(blockAt, axis, fixed, leftH + width, y))) return Option.none()
  }

  const interior: Array<BlockPosition> = []
  for (let h = leftH; h < leftH + width; h++) {
    for (let y = bottomY; y < bottomY + height; y++) {
      interior.push(positionAt(axis, fixed, h, y))
    }
  }

  return Option.some({ axis, width, height, interior })
}

/**
 * Detects a valid Nether portal frame around `ignition`.
 *
 * `ignition` is the cell something is trying to light. Any interior cell
 * resolves the same frame, because detection walks to the bottom-left corner
 * first rather than assuming it was handed one.
 *
 * The X plane is tried before the Z plane. A cell can in principle be the
 * interior of a valid frame in both planes at once, and this makes the answer
 * deterministic rather than correct: there is no correct answer to pick, and a
 * deterministic one at least means detection and any later re-detection of the
 * same world agree.
 *
 * Returns `None` when the ignition cell is not AIR. A frame whose interior is
 * already full of portal blocks is therefore NOT detected, which is the
 * behaviour the caller wants — an already-lit portal is not a portal waiting to
 * be lit — and is why this rule does not need to name the portal block at all.
 */
export const detectNetherPortal = (
  blockAt: BlockAt,
  ignition: BlockPosition,
): Option.Option<PortalFrame> => {
  if (blockAt(ignition.x, ignition.y, ignition.z) !== AIR_BLOCK_ID) return Option.none()
  return Option.orElse(detectInPlane(blockAt, 'x', ignition.z, ignition.x, ignition.y), () =>
    detectInPlane(blockAt, 'z', ignition.x, ignition.z, ignition.y),
  )
}

/** The cells a portal occupies: its obsidian ring, and the hole inside it. */
export type PortalLayout = {
  /** The complete rectangular ring, corners INCLUDED. */
  readonly frame: ReadonlyArray<BlockPosition>
  /** The interior cells, which stay AIR until something lights them. */
  readonly interior: ReadonlyArray<BlockPosition>
}

/**
 * Generates the cells of a portal whose interior bottom-left corner is `origin`.
 *
 * The inverse of `detectNetherPortal`, and mirrored although no rule in THIS
 * repository builds a portal: it is what makes detection falsifiable.
 * `test/portal-frame-mirror.test.ts` sweeps every legal size through this
 * function and back through detection, which is a test the two would have to
 * agree to break together — the alternative being a detector tested only against
 * frames one author spelled out by hand.
 *
 * The ring here includes the corners even though detection does not require
 * them.
 */
export const generatePortalLayout = (
  origin: BlockPosition,
  axis: PortalAxis,
  width: number,
  height: number,
): PortalLayout => {
  const fixed = axis === 'x' ? origin.z : origin.x
  const leftH = axis === 'x' ? origin.x : origin.z
  const bottomY = origin.y

  const interior: Array<BlockPosition> = []
  for (let h = leftH; h < leftH + width; h++) {
    for (let y = bottomY; y < bottomY + height; y++) {
      interior.push(positionAt(axis, fixed, h, y))
    }
  }

  // The bounding rectangle one cell larger on every side, minus its inside. A
  // cell is on the ring exactly when it sits on the outer row or column.
  const frame: Array<BlockPosition> = []
  for (let h = leftH - 1; h <= leftH + width; h++) {
    for (let y = bottomY - 1; y <= bottomY + height; y++) {
      if (h === leftH - 1 || h === leftH + width || y === bottomY - 1 || y === bottomY + height) {
        frame.push(positionAt(axis, fixed, h, y))
      }
    }
  }

  return { frame, interior }
}
