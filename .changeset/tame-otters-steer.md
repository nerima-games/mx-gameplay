---
"@nerima-games/mx-gameplay": minor
---

Fix minecarts running straight through corners instead of turning.

Minor rather than patch because `RailShape` is an exported union this package
*produces*: `resolveRailShape` can now return four values that did not exist
before, so a consumer narrowing it exhaustively gains unhandled cases. No
consumer in this organisation references `RailShape` today, but the bump
describes the type change rather than the current consumer list.

`resolveRailShape` used to collapse every perpendicular pair of rail
neighbours into one undirected `'curve'`, so `projectMinecartVelocity` had no
orientation left to steer with and kept whichever axis already dominated the
incoming velocity. A cart is only ever handed to a corner cell moving exactly
along one axis — a straight segment zeros the other component before the
handoff — so the reachable case was always the one that could not turn: the
cart ran straight through the corner and off the end of the track instead of
turning, every time.

`RailShape` gains four oriented curve values — `curve_north_east`,
`curve_north_west`, `curve_south_east`, `curve_south_west` — computed in
`resolveRailShape` from neighbour data the function already had and used to
discard. `projectMinecartVelocity` now exits an oriented curve on the leg the
cart did not arrive from, in that leg's fixed compass direction, preserving
speed. The undirected `'curve'` still exists for the one case an orientation
cannot resolve: a T-junction or crossing (three or four neighbours at once),
which has no single connected pair to name; `projectMinecartVelocity` keeps
its original dominant-axis continuation there.

This has no reference-implementation oracle behind it — verified by the
absence of any `file:line` citation on `projectMinecartVelocity` or its tests,
unlike every sibling symbol in `rail-shape.ts`, and confirmed by the
introducing commit's citation-free, one-line message. `docs/testing.md`
previously claimed three reference tests were transcribed into
`projectMinecartVelocity`; that claim had no citation backing it anywhere and
has been corrected. The fix instead restores information the port had
already computed and discarded, checked against the game's own documented
rail block-state model (ten shapes: two straight, four ascending, four
curve orientations) after confirming `mc-kernel`'s block registry does not
store per-block rail orientation (`railKind` is `'none' | 'normal' |
'powered'` only), so this repository continues to derive shape from
neighbours rather than reading a stored one.

`test/vehicle-rail-simulation.test.ts`'s closed-loop integration test was an
out-and-back specifically because of this defect (its header said so). It is
now a genuine closed rectangle: a minecart driven around a four-corner
circuit through the real stepping path, asserted on every tick to never leave
the rails it was placed on, and to reach all four sides of the loop.
