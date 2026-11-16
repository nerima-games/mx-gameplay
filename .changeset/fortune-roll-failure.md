---
"@nerima-games/mx-gameplay": minor
---

Change `rollFortuneExtraDrops` to return `Result<number, FortuneRollFailure>`. Non-finite rolls and rolls outside [0, 1) return `InvalidFortuneRoll`, including when the Fortune level is zero.

Host callers must handle the failure and unwrap the successful result before using the extra drop count.
