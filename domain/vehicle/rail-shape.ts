/**
 * ONE RULE, ONE FILE (DN-GP-9): what shape a rail is, from the rails around it.
 *
 * Ported from `<reference-impl>/packages/game/domain/rail-shape.ts:1-34`, whose
 * oracle is `packages/game/test/rail-shape.test.ts:15-41`. docs/porting.md §4:
 * move the tests first, do not reinvent the specification.
 *
 * plan.md §3.11 names 乗り物（ボート / トロッコ / レール）as the fifth of seven
 * responsibilities, and docs/responsibility.md §2 records that plan.md §7 assigns
 * it to `gameplay` 全部 — one of only two rows in that audit with a sole owner.
 * This file is the first of it. `docs/responsibility.md` §5 is the per-symbol
 * decision for the rest, and is the only place that decision is written.
 *
 * ---------------------------------------------------------------------------
 * This is a BLOCK rule, not a vehicle rule, and that is why it is buildable now
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md §3-1 carried this responsibility as 未着手 on the grounds that
 * a vehicle is 「位置を持つ実体を動かす」— a velocity, which is mc-physics', over a
 * roster, which is mc-sim's. Half of that is true and this file is the other
 * half. Re-measured against the reference:
 *
 *     resolveRailShape(isRailAt: IsRailAt, wx, wy, wz): RailShape
 *
 * No entity, no roster, no velocity, no `dt`, and — in the reference file as
 * well as here — NO IMPORTS AT ALL. What it reads is four horizontal neighbours
 * of one cell, and it reads them through an INJECTED PREDICATE, so it does not
 * even name the service the answer comes from.
 *
 * That is the shape this repository already accepts everywhere: `../mob/
 * hostile-spawn.ts` judges a cell, `../interactions/place-block.ts` judges a
 * support, `../entities/mob-spawn-search.ts` walks a ring. It is also the shape
 * the SIBLING repositories accept — mc-physics' `IsBlockSolid` (`domain/
 * resolve.ts:157`) and `BlockShapeAt` (:168) are `(bx, by, bz) => …` callbacks
 * for exactly this reason, and mc-meshing takes its `transparentBlockIds` the
 * same way.
 *
 * ---------------------------------------------------------------------------
 * INJECTING THE PREDICATE IS WHAT KEEPS plan.md §3.4's BAN, and the reference
 * is the counter-example
 * ---------------------------------------------------------------------------
 *
 * The reference builds the predicate at the call site
 * (`packages/game/application/game-state-update-orchestration.ts:294`) out of
 * this:
 *
 *     export const isOnRail = (…) => {
 *       const id = blockIdAt(wx, wy, wz, chunkCache, playerCx, playerCz)
 *       return id === RAIL_ID || id === POWERED_RAIL_ID
 *     }
 *     — `packages/game/domain/block-collision-predicates.ts:184-191`
 *
 * Two hand-written block-ID name checks, in the same file and eight lines above
 * the hand-maintained `PASSABLE_BLOCK_IDS` denylist that mc-physics'
 * docs/responsibility.md §3.1 records as a SHIPPED BUG — leaves were listed as
 * passable and players fell through tree canopies. plan.md §3.4 bans the
 * pattern; kernel answers it with a capability column instead, and `railKind`
 * ('none' | 'normal' | 'powered') is already 120/120 of that roster.
 *
 * Taking the predicate as an argument is what keeps that ban keepable. This file
 * cannot name a block id because it never sees one, and whoever supplies
 * `IsRailAt` supplies it from `railKind` rather than from two integers. Note
 * that BOTH tiers count: `powered_rail` is a rail for topology, and only the
 * speed tier tells them apart — which is a fact about the cart, not the track.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RULE DOES NOT ASK: whether the centre cell is a rail
 * ---------------------------------------------------------------------------
 *
 * `resolveRailShape` never calls `isRailAt(wx, wy, wz)`. Only the four
 * horizontal neighbours are probed, so a patch of grass with one rail to the
 * north answers `'ns'` rather than refusing.
 *
 * That is the reference's behaviour and it is a PRECONDITION rather than an
 * oversight: its caller has already established the cart is on a rail
 * (`game-state-update-orchestration.ts:268`, `isOnRail`) before it asks what
 * shape that rail is, and re-asking would be a second store read per frame to
 * confirm something the frame decided one line earlier. The reference's own
 * oracle pins it — `resolveRailShape(railsAt([[0, 60, 0]]), 0, 60, 0)` is
 * `'isolated'` (`test/rail-shape.test.ts:39`), which is the answer for a lone
 * rail AND the answer for empty air, and nothing distinguishes them.
 *
 * It is recorded here rather than repaired because repairing it silently would
 * change a rule this repository ported as a specification, and because the
 * precondition is genuinely cheaper to hold at the call site. `test/rail.test.ts`
 * asserts it, so a later reader finds it stated rather than discovering it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT IN THIS FILE, and where the decision is written
 * ---------------------------------------------------------------------------
 *
 * The reference's `rail-shape.ts` holds three more symbols —
 * `projectMinecartVelocity`, `isAscendingAhead` and `RAIL_CLIMB_SPEED`. They do
 * NOT all belong together and that is the point: one file held two concerns, the
 * same way `lod-simplification.ts` did until mc-meshing's docs/responsibility.md
 * §3.4 split it by asking which half took a distance.
 *
 * `./rail-ascent.ts` is the second topology rule. The other two are decided in
 * docs/responsibility.md §5, ONCE, with the reasoning; they are not restated
 * here and they are not built here.
 */

/**
 * What a rail constrains a cart to.
 *
 * Four cases and no `undefined`: `'isolated'` IS the answer for a rail with no
 * neighbours, and it means "constrain nothing" rather than "I do not know". A
 * lone rail is a plain floor, which is the reference's comment
 * (`rail-shape.ts:12-13`) and the behaviour its oracle pins.
 *
 * There is no `'slope'`. An ascending rail still has a horizontal shape — it is
 * an `'ns'` or an `'ew'` that also climbs — and the climb is `./rail-ascent.ts`'s
 * separate question, asked of the same cell. Folding it in here would make the
 * shape depend on which way the cart happens to be pointing.
 */
export type RailShape = 'ns' | 'ew' | 'curve' | 'isolated'

/**
 * "Is there a rail in this cell?", answered by somebody who can read blocks.
 *
 * Whole-number world coordinates. The caller resolves it from kernel's
 * `railKind` column — see the module header on why this is a parameter and not
 * a `ChunkStoreApi` read.
 *
 * SYNCHRONOUS, unlike every other world question in this repository, which is an
 * `Effect` over `ChunkStoreApi`. That is deliberate and it is the reference's
 * shape: one `resolveRailShape` probes up to twelve cells, it would run per cart
 * per frame, and twelve `Effect`s per cart per frame on the hot path is the cost
 * `../entities/mob-spawn-search.ts` had to buy a cadence to avoid. The reference
 * answers all twelve from a chunk cache the physics pass already holds. A host
 * with only an `Effect` store can still satisfy this by reading the 3x3x3
 * neighbourhood once and closing over it — which is one batch rather than twelve
 * round trips, and is the honest way round.
 */
export type IsRailAt = (wx: number, wy: number, wz: number) => boolean

/**
 * A rail in this column, or one step up, or one step down.
 *
 * `rail-shape.ts:10-11`, unchanged including the probe order: level first, then
 * up, then down. The order cannot change the answer — it is an `||` over three
 * booleans — but it does decide how many times `isRailAt` runs, and level is the
 * common case, so it short-circuits first on flat track.
 *
 * THE +-1 IS WHAT MAKES SLOPES CONNECT. Without it a rail at the top of a ramp
 * has no neighbour at its own height and resolves `'isolated'`, so a cart
 * reaching the crest would stop being constrained at exactly the moment it is
 * moving fastest. The reference's oracle pins this directly
 * (`test/rail-shape.test.ts:33-36`: a rail at `y+1` to the south still gives
 * `'ns'`).
 */
const hasRailNear = (isRailAt: IsRailAt, wx: number, wy: number, wz: number): boolean =>
  isRailAt(wx, wy, wz) || isRailAt(wx, wy + 1, wz) || isRailAt(wx, wy - 1, wz)

/**
 * The shape of the rail at this cell.
 *
 * North is `-z`, south is `+z`, east is `+x`, west is `-x`. A pair on one axis
 * is a straight; one neighbour on one axis extends that axis; any two
 * perpendicular neighbours make a curve; nothing at all is `'isolated'`.
 *
 * PURE, TOTAL and deterministic — the same predicate always gives the same
 * shape, and it makes at most twelve calls to it (four directions, three heights
 * each) and no other observation of anything.
 *
 * A CURVE BEATS A STRAIGHT, and the order of the tests below is that rule. A
 * T-junction — north, south AND east — has `nsCount === 2`, so reading the
 * straight test first would answer `'ns'` and lock a cart out of the branch it
 * is aimed at. The reference tests the mixed case first (`rail-shape.ts:29`) and
 * this keeps that; `'curve'` is the permissive answer, because
 * `projectMinecartVelocity` lets a curve steer and a straight does not.
 *
 * NON-FINITE COORDINATES ANSWER `'isolated'` WITHOUT PROBING. This is one guard
 * the reference does not have, and it is the same call `../interactions/
 * explosion-crater.ts` makes for `craterCells`: `isRailAt` is a world read in a
 * host, and `NaN + 1` is `NaN`, so an unguarded rule asks mc-worldgen for the
 * block at twelve `NaN` cells and then answers from whatever the store said
 * about them. `'isolated'` is the inert direction — it constrains nothing, so a
 * broken coordinate cannot lock a cart onto an axis that was never measured.
 *
 * The reference counts its neighbours (`nsCount = (north ? 1 : 0) + …`) and then
 * tests `nsCount > 0`. The counts are read nowhere else, and `count > 0` is
 * `north || south` for every input, so they are booleans here. Same answers, and
 * `test/rail.test.ts` enumerates all sixteen neighbour combinations rather than
 * taking that sentence's word for it.
 */
export const resolveRailShape = (
  isRailAt: IsRailAt,
  wx: number,
  wy: number,
  wz: number,
): RailShape => {
  if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) {
    return 'isolated'
  }

  const north = hasRailNear(isRailAt, wx, wy, wz - 1)
  const south = hasRailNear(isRailAt, wx, wy, wz + 1)
  const east = hasRailNear(isRailAt, wx + 1, wy, wz)
  const west = hasRailNear(isRailAt, wx - 1, wy, wz)

  const onNorthSouth = north || south
  const onEastWest = east || west

  if (onNorthSouth && onEastWest) {
    return 'curve'
  }
  if (onNorthSouth) {
    return 'ns'
  }
  if (onEastWest) {
    return 'ew'
  }
  return 'isolated'
}
