---
"@nerima-games/mx-gameplay": minor
---

Make endermen hostile after five consecutive ticks of unobstructed eye contact within 64 blocks. They stop while watched within 16 blocks, then pursue and attack the player through the existing mob movement and combat paths. Melee attacks require an unobstructed eye segment.

Add optional `endermanAnger` to `HostileMobSnapshot` and optional gaze observations to `MobFrameSenses` and `planMobMovementRoster`. Persisted anger records its target, stare ticks, and attack cooldown. Gaze observations may carry a `visible` set; without visibility evidence, endermen cannot attack. World-read failures use the existing entity stage fault API with the `EndermanGaze` source.
