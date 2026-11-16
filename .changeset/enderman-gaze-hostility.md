---
"@nerima-games/mx-gameplay": minor
---

Make endermen hostile after five consecutive ticks of unobstructed eye contact within 64 blocks. While watched, they pause within 16 blocks and approach from farther away. After the player looks away, they pursue and attack through the existing mob movement and combat paths. Melee attacks require an unobstructed eye segment.

Add optional `endermanAnger` to `HostileMobSnapshot` and optional gaze observations to `MobFrameSenses` and `planMobMovementRoster`. Persisted anger records its target, stare ticks, and attack cooldown. Gaze observations may carry a `visible` set; without visibility evidence, endermen cannot attack. World-read failures use the existing entity stage fault API with the `EndermanGaze` source.
