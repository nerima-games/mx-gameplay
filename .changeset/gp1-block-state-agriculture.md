---
"@nerima-games/mx-gameplay": minor
---

Add stateful block interactions and growth for crops and saplings.

Breaking for hosts: `gameplayModule` and `makeGameplayComposition` now require the `GameplayBlockStateWorld` service. The host must bind its `BlockStateWorldPort` to the C7 `WorldWritePort` so state edits and optional owner changes commit together.
