---
"@nerima-games/mx-gameplay": minor
---

Use SM3 pathfinding and physics for supported mob movement, add physical skeleton arrows and Blaze
fireballs, let spiders climb walls, and burn exposed zombies and skeletons in daylight. Return typed
failures for malformed present mob state and gameplay inputs while preserving migrations and
defaults for omitted fields. Propagate world, registry, and operation failures through drainable stage
faults so affected requests or entities can be isolated while the frame continues. Keep unavailable
world cells distinct from empty cells and no-target outcomes.
