---
"@nerima-games/mx-gameplay": patch
---

Restore the `droppedItemPickup` opt-out on `GameplayStageOptions` (defaults to `true`, unchanged for every existing caller). A consumer that runs its own richer pickup loop — one that preserves item metadata such as durability or custom names, which this stage's own sweep does not carry — sets `droppedItemPickup: false` to stop the entities stage from also picking the same item up and double-consuming it.
