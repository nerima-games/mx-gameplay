---
"@nerima-games/mx-gameplay": minor
---

Make endermen hostile after five consecutive ticks of unobstructed eye contact within 64 blocks. While watched, they pause within 16 blocks and approach from farther away. After the player looks away, they pursue and attack through the existing mob movement and combat paths. Melee attacks require an unobstructed eye segment.

Anger expires after a duration sampled once from the inclusive 400–780 tick range. It also clears when its target is absent, dies, moves to another dimension, or leaves the 64-block follow range. Neutral endermen no longer chase merely because a player position is available.

Mob frame callers must now supply `simulationTick` and `endermanGaze` in `MobFrameSenses`. `planMobMovementRoster` requires its final gaze argument. Gaze observations require `target`, `looking`, and `visible`: `target` is the player ID, and `looking` and `visible` contain enderman IDs observed from that player's perspective. Represent an absent target with `undefined` and empty observation sets explicitly.

Add optional `endermanAnger` and `ecosystem` to `HostileMobSnapshot`. Pending anger records its target and stare ticks; acquired anger also records its absolute `expiresAt` tick. Enderman attacks share `EcosystemMobState.attackCooldownTicks` through `ecosystem`, preserving the separate hit flinch. World-read failures use the existing entity stage fault API with the `EndermanGaze` source, and raycast failures retain their original physics cause.

Skeleton and blaze sight checks retain their existing 64-block eye-segment limit. Longer segments are not visible and produce no fault. Actual raycast failures, such as unrepresentable coordinates, produce a `ProjectileLineOfSight` entity stage fault while preventing the shot. `MobBehaviourStateRepairFailure.kind` reports the affected mob's `EntityKind` for foreign enderman metadata and retains the existing serialized labels `primed-tnt` and `dropped-item`.
