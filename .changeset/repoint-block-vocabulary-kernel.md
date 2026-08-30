---
"@nerima-games/mx-gameplay": minor
---

Repoint the block vocabulary mirror to `@nerima-games/mc-kernel` (0.6.1) and delete it: `domain/block-vocabulary.ts`. `isReplaceable`/`fallsWhenUnsupported`/`validSpawnSurface`/`canSupportAttachments` are now `capabilityOfBlockId(id, flag)`; `resistsNormalExplosion(id)` is now `resistsExplosion(id, power)`. `HARVEST_TIERS` gained a sixth tier, `'netherite'`, which gates no additional block (a netherite pickaxe is faster than diamond, never a tier gate in vanilla).

`test/block-loot.test.ts`'s silk-touch expectations for glowstone now expect `count: 2` rather than the former mirror's flat `count: 1`: kernel's `silkTouchItem` substitutes only the item, and the row's own base count (glowstone's is 2, before fortune) still applies. This is kernel's row-level model, not the former mirror's blanket "every silk-touch drop is exactly 1" rule.

Depends on the mc-kernel 0.6.1 registry fix (`silkTouchItem: 'glowstone'`; `drops: DROPS_NOTHING` for `tall_grass`/`fern`, matching every other plant row whose vanilla behaviour already agreed with the bare default) — 0.6.0 was missing both and left four `block-loot` tests red; pinned at 0.6.1 where they pass with the pre-existing, vanilla-correct expectations otherwise unchanged.
