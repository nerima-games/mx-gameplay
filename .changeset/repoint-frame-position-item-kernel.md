---
"@nerima-games/mx-gameplay": minor
---

Repoint the coordinate/frame/item vocabulary mirrors to `@nerima-games/mc-kernel` (0.5.1) and delete them: `domain/frame-contract.ts`, `domain/item-vocabulary.ts`, `domain/position-key.ts` and `domain/block-position-key.ts`. `FrameServices` now resolves to kernel's `ClockPort` instead of `never`, so every test and preview stage run provides a fixed clock through `FrameServicesLayer`. `PositionKey` is kernel's `BlockPositionKey`, encoded identically. `below`/`above`/`horizontalNeighbours` are kernel's `adjacentBlockPosition`/`horizontalBlockNeighbours`, called through a local unbranded-to-kernel-branded position lift since `domain/chunk-store-port.ts`'s own `BlockPosition` stays unbranded until its own repoint (Wave 1, W1-M5).
