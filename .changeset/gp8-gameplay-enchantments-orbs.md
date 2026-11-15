---
"@nerima-games/mx-gameplay": minor
---

Wire combat, mining, fishing, mob-drop, and armor enchantments; apply kernel status-effect definitions during ticks; and add XP-orb pickup, Mending, and continuous mining progress.

`applyStatusEffect` now returns a `Result` of `StatusEffectApplicationOutcome` or `StatusEffectApplicationError` instead of a `StatusEffectState`. `tickStatusEffects` now returns a `Result` of `StatusEffectTick` or `InvalidStatusEffectTick` and rejects an invalid state or delta instead of ticking an empty state or zero elapsed time.

Fishing records each cast's Lure and Luck of the Sea levels and open-water decision in the new replicated owner `GAMEPLAY_FISHING_ENCHANTMENTS_OWNER_ID` (`GameplayFishingEnchantmentsSnapshotSchema`), registered by `gameplayOwnerRegistrations` and restorable through `GameplayOwnerInitialState.fishingEnchantments`. The record is written in the cast commit and removed in the reel or cancel commit. `GameplayStageCommitServices` accepts an optional `fishingEnchantmentsOwnerId`. An active cast without a record is rebuilt from the rod at the reel's `toolLocation` and the blocks around the bobber; when that is impossible the request is skipped and a stage fault is recorded (`FishingRodNotHeld` when the request names no rod location, `FishingBobberUnavailable` when the bobber is gone, or a `Fishing` world-data fault when the blocks around the bobber cannot be read), so an advance or tool-less reel for such a cast no longer proceeds with default levels.
