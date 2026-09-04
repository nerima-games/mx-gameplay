---
"@nerima-games/mx-gameplay": patch
---

Fix a minecart reversing back the way it came, at a corner, whenever its per-tick displacement is under about half a block.

`stepVehicle` re-reads `resolveRailShape` from the cart's current cell every
tick, so a cart takes MULTIPLE ticks to cross a curve cell whenever its
speed × dt is small relative to a block width — a slow or just-launched
minecart, not only an edge case. Each of those re-reads called
`projectMinecartVelocity` again with ITS OWN prior output as `vx`/`vz`.
`towardX` read that already-turned velocity as if it were a fresh arrival and
turned the cart a SECOND time, back onto the leg it had just left. Because
the cart's offset past the entry boundary is always smaller than one tick's
displacement (by construction — that is what "just crossed the boundary"
means), the undone step always overshoots back across the entry boundary too:
not a cosmetic one-frame wobble but a full reversal that sends the cart back
up the leg it arrived from, permanently, since a straight rail only ever
preserves the sign of the velocity it is handed. The existing closed-rectangle
regression test never caught this because it always covers 0.8 blocks/tick
(unpowered acceleration to `MINECART_MAX_SPEED` at `dt = 0.1`), enough to
clear an entire curve cell in one tick.

`projectMinecartVelocity` is now idempotent on its own output for the
oriented curve shapes: once `vx`/`vz` already matches one of the curve's two
exit legs — the other axis exactly zero, matching sign — it is held there
instead of being re-derived from `towardX`. An arrival is always the OPPOSITE
sign on that axis (heading INTO the cell along a leg, not out of it), so this
cannot mask a genuine arrival; it only recognizes the function's own prior
answer and leaves it alone.

No reference-implementation oracle exists for this function (see its own doc
comment); the fix is checked against a reproduction that steps a cart through
a corner using the real exported functions and records the position
sequence, and against a new multi-tick regression test that drives a slow
cart around a single corner through the real `advanceVehicles` path and
asserts neither axis ever regresses below its own running maximum.
