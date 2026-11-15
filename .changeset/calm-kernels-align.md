---
"@nerima-games/mx-gameplay": minor
---

Align gameplay with kernel 0.17.0, mc-audio 0.6.0, mc-sim 0.11.1, and mc-worldgen 0.9.1. Use faster cave carving and block-state materialization with unchanged generated output.

`makeGameplayStages` now requires `GameplayStageFaults`, and `GameplayFrameState` exposes the required `stageFaults` field. `placeBlock`, `planPlaceBlock`, `breakBlock`, `carveExplosionCrater`, `igniteTnt`, `useFlintAndSteel`, `mushroomLightObjection`, and `resolveBlasts` expose `BlockStateCodecFailure` and `LightQueueUnderflowError`; `targetedRightClickRoute` and targeted request helpers expose typed input and coordinator failures. Placement and item-use results include typed world-data failures. Gameplay block-decode faults accept only `UnregisteredBlockId`, and the seven public fault decoder schemas are removed.

The root barrel adds the projectile runtime, XP-orb, gameplay owner-registration, and break-block transaction APIs, and no longer exports the in-memory chunk-store helpers. The biome spawn table covers kernel biome IDs, and default-material surfaces play the default footstep cue. The coverage-run per-test timeout is 60 seconds; regular test timeouts and the 100% coverage thresholds are unchanged.
