---
"@nerima-games/mx-gameplay": minor
---

Align gameplay with kernel 0.17.0, mc-audio 0.6.0, mc-sim 0.11.1, and mc-worldgen 0.9.1. Use faster cave carving and block-state materialization with unchanged generated output.

Stages record world-data failures in `GameplayFrameState.entityStageFaults`, and hosts read them through `drainGameplayEntityStageFaults(state)`. `WorldDataFailure` records preserve the operation, position, source, and typed reason. Equal records are deduplicated while pending and after draining. `makeGameplayStages` requires no fault service, and `gameplayModule.layers` is empty. `placeBlock`, `planPlaceBlock`, `breakBlock`, `carveExplosionCrater`, `igniteTnt`, `useFlintAndSteel`, `mushroomLightObjection`, and `resolveBlasts` expose `BlockStateCodecFailure` and `LightQueueUnderflowError`. `targetedRightClickRoute` keeps its typed target and registry errors. `BlockPlacementCommandOutcome` adds `WorldDataFailed`; farming item-use outcomes include `GameplayStageItemUseWorldFailure`. Gameplay block-decode faults retain `UnregisteredBlockId` failures.

Hosts that drain faults retain state from `makeGameplayFrameStateForOwner` and pass it to `gameplayStages`; `makeGameplayStages` and `gameplayModule` keep their state private.

The biome spawn table covers kernel biome IDs, and default-material surfaces play the default footstep cue. The coverage-run per-test timeout is 60 seconds; regular test timeouts and the 100% coverage thresholds are unchanged.
