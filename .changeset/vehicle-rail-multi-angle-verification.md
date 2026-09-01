---
"@nerima-games/mx-gameplay": patch
---

Add multi-angle integration verification for minecart rail physics
(`test/vehicle-rail-simulation.test.ts`), run through the real
`advanceVehicles` frame function against a real in-memory `ChunkStoreApi`
and `@nerima-games/mc-sim`'s real `VehicleServiceApi` rather than doubles.

This closes the verification half of the vehicle/rail row in plan.md
§3.11's responsibility 5 (`docs/responsibility.md` §5, `docs/testing.md`
§3-1 row 5): the rail topology (`domain/vehicle/rail-shape.ts`,
`rail-ascent.ts`), the powered-rail speed rule and climb constant
(`domain/vehicle/vehicle-motion.ts`'s `MINECART_POWERED_ACCELERATION`,
`MINECART_MAX_SPEED`, `MINECART_CLIMB_SPEED`), and the frame wiring
(`domain/vehicle/vehicle-frame.ts`'s `advanceVehicles`, called from
`stages/registration.ts`) were already implemented and 100%-covered by
per-function unit tests, but none of those tests advanced a cart across
more than a handful of ticks. The four new tests add the angles a
per-function test cannot reach: a powered-rail out-and-back returning to
its start position across repeated round trips (drift), the same elapsed
time at different frame rates landing at the same position including a
frame that straddles a 2-second boundary, a frame slower than the
`advanceVehicles` 0.1s clamp advancing no further than the clamp, and
speed staying bounded at `MINECART_MAX_SPEED` on every sampled tick of a
300-simulated-second powered-rail run.

No production code changed. A genuine gap was found rather than fixed: a
cart approaching a grid corner (`'curve'`-shaped rail cell) axis-aligned —
the only way a preceding straight segment ever hands one off — runs
straight through it instead of turning, because `projectMinecartVelocity`
keeps whichever axis already dominates the incoming velocity. This is
recorded in the new test file's header rather than patched, since a fix
would mean inventing corner-steering behaviour with no reference oracle
behind it.
