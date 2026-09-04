/**
 * ONE RULE, ONE FILE (DN-GP-9): what shape a rail is, from the rails around it.
 *
 * Ported from `<reference-impl>/packages/game/domain/rail-shape.ts:1-34`, whose
 * oracle is `packages/game/test/rail-shape.test.ts:15-41`. docs/porting.md §4:
 * move the tests first, do not reinvent the specification.
 *
 * CORNER TURNING WAS REPAIRED, NOT PORTED: `RailShape`'s curve orientation and
 * `projectMinecartVelocity`'s use of it were not in the reference oracle this
 * file was born from — see their own doc comments for what was wrong and why
 * un-collapsing already-computed neighbour data, not new physics, was the fix.
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
 * `./rail-ascent.ts` is the second topology rule. `projectMinecartVelocity` is
 * the third symbol and is built here because it is still a pure projection over
 * a shape and a horizontal velocity. `RAIL_CLIMB_SPEED` remains decided in
 * docs/responsibility.md §5, ONCE, with the reasoning; it is not restated here.
 */

/**
 * What a rail constrains a cart to.
 *
 * `'isolated'` IS the answer for a rail with no neighbours, and it means
 * "constrain nothing" rather than "I do not know". A lone rail is a plain
 * floor, which is the reference's comment (`rail-shape.ts:12-13`) and the
 * behaviour its oracle pins.
 *
 * There is no `'slope'`. An ascending rail still has a horizontal shape — it is
 * an `'ns'` or an `'ew'` that also climbs — and the climb is `./rail-ascent.ts`'s
 * separate question, asked of the same cell. Folding it in here would make the
 * shape depend on which way the cart happens to be pointing.
 *
 * FOUR CURVE ORIENTATIONS, NOT ONE — a repair, checked against the kernel
 * rather than invented. `resolveRailShape` used to answer a single `'curve'`
 * for every perpendicular pair, and `projectMinecartVelocity` had no way to
 * turn a cart correctly as a result: see that function's doc comment for why a
 * shape without an orientation cannot be steered, only continued. The game
 * this is reproducing does not collapse those cases — its rail block state
 * carries the connected pair directly (`north_east` / `north_west` /
 * `south_east` / `south_west`, alongside the two straights and four ascending
 * forms; ten shapes in total, none of them a bare `'curve'`). `mc-kernel`'s
 * `RAIL_KINDS` (`block-property-data.ts:43`) was checked for this and does NOT
 * store it — kernel only tracks whether a cell is a rail and which of
 * `'none' | 'normal' | 'powered'` it is, not its placed orientation — so this
 * repository cannot read a stored shape the way the real block state would.
 * `resolveRailShape` derives one instead, from neighbour connectivity, the
 * same way it already derives `'ns'` / `'ew'` / `'isolated'`; restoring the
 * orientation is un-collapsing information the function already computes
 * (`north` / `south` / `east` / `west` below) and used to discard, not adding
 * a new observation.
 *
 * `'curve'` still exists, for the genuinely ambiguous case a 90-degree bend
 * does not have: three or four neighbours present at once (a T-junction or a
 * crossing). Those have no single connected pair to name, and nothing in this
 * codebase's reach — not the kernel, not the reference — arbitrates which two
 * legs such a junction should honour, so `projectMinecartVelocity` keeps its
 * original dominant-axis behaviour there rather than inventing a switch rule.
 */
export type RailShape =
  | 'ns'
  | 'ew'
  | 'curve_north_east'
  | 'curve_north_west'
  | 'curve_south_east'
  | 'curve_south_west'
  | 'curve'
  | 'isolated'

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
 * this keeps that; a curve is the permissive answer, because
 * `projectMinecartVelocity` lets a curve steer and a straight does not.
 *
 * ORIENTED WHEN IT CAN BE, GENERIC WHEN IT CANNOT. Exactly one of
 * north/south present together with exactly one of east/west present is an
 * unambiguous 90-degree bend — the `RailShape` doc comment records why that
 * gets its own value instead of a bare `'curve'`. A T-junction or crossing has
 * no single connected pair (`north && south` together, or `east && west`
 * together, alongside the other axis) and keeps the old undirected answer.
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
    // Un-collapsing: `north !== south` and `east !== west` is exactly "exactly
    // one side present on each axis" — the case a real placed curve piece
    // always is. Anything else (both sides of an axis, alongside the other
    // axis) is the ambiguous junction case and keeps the undirected answer.
    if (north !== south && east !== west) {
      if (north && east) return 'curve_north_east'
      if (north && west) return 'curve_north_west'
      if (south && east) return 'curve_south_east'
      return 'curve_south_west'
    }
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

/**
 * Project a horizontal velocity onto the rail the cart is on.
 *
 * This preserves speed with `Math.hypot(vx, vz)` and rewrites only the
 * direction. `isolated` is the inert case: it constrains nothing, so the input
 * velocity is returned unchanged.
 *
 * ---------------------------------------------------------------------------
 * WHY A GENERIC 'curve' COULD NEVER BE STEERED, ONLY CONTINUED
 * ---------------------------------------------------------------------------
 *
 * A straight rail zeros the perpendicular component outright (`'ns'` keeps
 * only `vz`, `'ew'` keeps only `vx`), so a cart handed from a straight segment
 * into a curve cell always arrives EXACTLY axis-aligned: one component is the
 * full speed, the other is zero. `towardX` reads which axis that is, but a
 * bare `'curve'` carries no memory of which TWO directions the bend actually
 * connects — so the old code here had nothing left to do but keep going on
 * whichever axis was already dominant, which is a straight-through, not a
 * turn. That is why a cart arriving axis-aligned — the only way it is ever
 * handed to a corner — ran through it instead of turning: the information a
 * turn needs was discarded one function earlier, in `resolveRailShape`, not
 * missing here.
 *
 * The four oriented shapes restore that information, so this function can now
 * answer the question a curve actually poses: which of its two legs is the
 * cart NOT already travelling along, and what is that leg's fixed compass
 * direction. `towardX` still decides which axis the cart arrived on — that
 * part was always correct — but the exit is now the curve's OTHER leg, in
 * that leg's own direction (north is `-z`, east is `+x`, …), not a copy of
 * the input's sign. Turning necessarily moves the sign from one axis to the
 * other, which preserving the input sign can never do.
 */
export const projectMinecartVelocity = (
  shape: RailShape,
  vx: number,
  vz: number,
): { readonly vx: number; readonly vz: number } => {
  if (!Number.isFinite(vx) || !Number.isFinite(vz)) {
    return { vx: 0, vz: 0 }
  }

  const speed = Math.hypot(vx, vz)
  if (speed === 0) {
    return { vx: 0, vz: 0 }
  }

  if (shape === 'isolated') {
    return { vx, vz }
  }

  const towardX = Math.abs(vx) >= Math.abs(vz)

  if (
    shape === 'curve_north_east' ||
    shape === 'curve_north_west' ||
    shape === 'curve_south_east' ||
    shape === 'curve_south_west'
  ) {
    const northLeg = shape === 'curve_north_east' || shape === 'curve_north_west'
    const eastLeg = shape === 'curve_north_east' || shape === 'curve_south_east'
    const exitZ = (northLeg ? -1 : 1) * speed
    const exitX = (eastLeg ? 1 : -1) * speed

    // REPAIR, NOT A PORT (like the corner-turning fix above it, this has no
    // reference oracle — see the module header): a cart takes MULTIPLE ticks
    // to cross a curve cell whenever its per-tick displacement is under about
    // half a block, because `resolveRailShape` is re-read from the SAME cell
    // every tick until the cart's floored position finally crosses a
    // boundary. `towardX` was being recomputed from THIS function's own prior
    // output on every one of those re-reads: the tick after the cart turned
    // onto (say) the east leg, `vx` is what makes it dominant, so `towardX`
    // read the exit as if it were a fresh arrival and turned it AGAIN, back
    // onto the north leg — undoing the turn. Because the cart's sub-cell
    // offset past the entry boundary is always smaller than one tick's
    // displacement (it is however far the previous tick's motion carried it
    // past the boundary, on the very tick that boundary was first crossed),
    // that undone step reliably overshoots back across the entry boundary
    // too: not one cosmetic wobble but a full reversal that sends the cart
    // back up the leg it arrived from, permanently, since a straight rail
    // only ever preserves the sign of the velocity it is handed.
    //
    // The fix is to make the projection idempotent on its own output: once
    // `vx`/`vz` already IS one of this curve's two exit vectors — same axis
    // zero, same sign on the other — hold it there instead of re-deriving a
    // turn from it. An arrival is always the OPPOSITE sign on that axis (it
    // is heading INTO the cell along a leg, not out of it), so this cannot
    // mask a genuine arrival; it only recognizes the function's own prior
    // answer and leaves it alone.
    if (vz === 0 && Math.sign(vx) === Math.sign(exitX)) return { vx: exitX, vz: 0 }
    if (vx === 0 && Math.sign(vz) === Math.sign(exitZ)) return { vx: 0, vz: exitZ }

    // Arriving on the x-axis (towardX) means the z-leg is the one not yet
    // travelled — exit there, and vice versa. Direction comes from the leg's
    // own compass sign (north/-z, south/+z, east/+x, west/-x), never from vx/vz.
    return towardX ? { vx: 0, vz: exitZ } : { vx: exitX, vz: 0 }
  }

  if (shape === 'ew' || (shape === 'curve' && towardX)) {
    return { vx: (Math.sign(vx) || Math.sign(vz)) * speed, vz: 0 }
  }

  return { vx: 0, vz: (Math.sign(vz) || Math.sign(vx)) * speed }
}
