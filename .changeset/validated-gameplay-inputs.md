---
"@nerima-games/mx-gameplay": minor
---

Validate enchantment levels and status-effect state before calculating gameplay modifiers. Return typed failures for invalid block-loot rolls, invalid sleep deltas, missing powered-rail queries, and missing spawn measurements.

Breaking for hosts: `Enchantment.level` now requires the kernel `EnchantmentLevel` brand. `statusEffectLevel` and `statusEffectModifiers` require `ValidatedStatusEffectState`; status-effect application and tick outcomes return that validated state. Decode raw levels and state at the input boundary. Handle the added block-loot, vehicle, and sleep failures, and replace the removed `SpawnRefusal` arm `unmeasurable` with the existing `InvalidSpawnCandidate` failure.
