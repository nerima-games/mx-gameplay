---
"@nerima-games/mx-gameplay": minor
---

Wire combat, mining, fishing, mob-drop, and armor enchantments; apply kernel status-effect definitions during ticks; and add XP-orb pickup, Mending, and continuous mining progress.

`applyStatusEffect` now returns a `Result` of `StatusEffectApplicationOutcome` or `StatusEffectApplicationError` instead of a `StatusEffectState`. `tickStatusEffects` now returns a `Result` of `StatusEffectTick` or `InvalidStatusEffectTick` and rejects an invalid state or delta instead of ticking an empty state or zero elapsed time.
