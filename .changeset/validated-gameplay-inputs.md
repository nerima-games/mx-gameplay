---
"@nerima-games/mx-gameplay": minor
---

Validate enchantment levels and status-effect state before calculating gameplay modifiers. Return typed failures for invalid block-loot rolls, invalid sleep deltas, and missing spawn measurements.

Breaking for hosts: `Enchantment.level`, `BlockLootContext.fortuneLevel`, and the `level` parameter of `rollFortuneExtraDrops` now require the kernel `EnchantmentLevel` brand. `statusEffectLevel` and `statusEffectModifiers` require `ValidatedStatusEffectState`; status-effect application and tick outcomes return that validated state. Decode raw levels and state at the input boundary.

`VehicleFrameEnvironment.isPoweredRailAt` is required, and `advanceVehicles` requires an explicit environment. Pass the vehicle service and environment together through the optional `vehicles: { service, environment }` argument to `gameplayStages`.

Handle the added block-loot and sleep failures. Replace the removed `SpawnRefusal` arm `unmeasurable` with the existing `InvalidSpawnCandidate` failure.
