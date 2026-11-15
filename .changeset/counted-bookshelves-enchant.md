---
"@nerima-games/mx-gameplay": minor
---

Generate enchanting-table offers through mc-sim's `EnchantmentTableService`, which counts the bookshelves around the requested table from the world. `OffersGenerated` results carry the counted `bookshelfCount` (0 to 15). An offers request is rejected with `table-area-unloaded` when a block used for the count is in an unloaded chunk or outside the world; the roll seed is not consumed, and each unreadable position is recorded as a `WorldDataFailure` stage fault with the new source `EnchantmentTable`.
