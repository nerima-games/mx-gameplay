---
"@nerima-games/mx-gameplay": patch
---

Fix armour blunting damage it should never touch: fall damage, drowning, suffocation, starvation, void, ender pearl exhaustion damage, and poison were all taking the same four-percent-per-armour-point reduction as a sword hit. A fully iron-armoured player falling from a height, drowning, or standing in a wall took visibly less damage than an unarmoured player in the same situation — wrong in either direction a player could exploit or be hurt by, since none of those are things armour protects against.

`applyArmorToDamage` (`src/domain/combat/armor.ts`) applied its reduction to every `Damage` regardless of `cause`. It now checks the cause first: the eight causes above pass through unmitigated, and every other cause — including cactus and lava contact, which ARE armour-mitigated, same as a sword hit — is unchanged. `fire` is deliberately left alone: this package's single `'fire'` cause currently covers two situations that should be treated differently (standing in a fire block, which armour reduces, and burning over time after leaving it, which armour does not), and fixing that needs splitting the cause rather than a one-line exemption.
