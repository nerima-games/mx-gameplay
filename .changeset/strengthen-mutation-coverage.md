---
"@nerima-games/mx-gameplay": patch
---

Strengthen test coverage over combat, environmental damage, and death-drop rules that already had 100% statement/branch coverage but were verified only by hand mutation testing, not by that coverage number.

Two of the surviving mutants pointed at a genuine gap where the same code path had never been exercised with the input that would show the difference:

- `deathDropsFromPlayerStorage` (`src/domain/entities/dropped-item.ts`) loops over all five `EQUIPMENT_SLOTS` when a player dies, but every existing test only ever equipped `head`. A mutant that iterated a single slot still passed the whole suite — chest, legs, feet, and offhand items would have silently stayed on the corpse. Added a case that equips all five slots and asserts each drops.
- `resolveEnvironmentalContactDamage`'s tie-break, which prefers lava over cactus when two contacted cells deal equal damage, was untested because vanilla's own numbers (cactus 1, lava 4) never actually tie — the branch was only reachable with constructed `EnvironmentalContact` values. Added a case that ties them directly, in both contact orders.

A third mutation surfaced a real defect in `addToSlots` (`src/domain/in-memory-inventory.ts`): its pass-one top-up subtracts a partial stack's existing count from `MAX_STACK_COUNT` to find remaining headroom before capping. A mutant that capped at `MAX_STACK_COUNT` directly (ignoring what the slot already held) was caught only by a new conservation property — "the inventory's total count after `add` equals the total before plus what `add` reports as accepted" — swept over several starting occupancies rather than the fixed small scenarios the existing tests used. No prior test started from a partially-filled stack large enough to expose it. Added the conservation property for both `addToSlots` and `removeFromSlots`, plus an armour-mitigation monotonicity property (resulting damage never increases as armour points increase, for every armour-mitigated cause).

No production behaviour changed: `git diff` against the prior release touches only `test/`.
