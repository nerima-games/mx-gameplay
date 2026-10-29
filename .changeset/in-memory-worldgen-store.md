---
"@nerima-games/mx-gameplay": minor
---

Remove the public `InMemoryChunkStoreLayer` and `makeInMemoryChunkStore` API and the arbitrary `WorldContents.lights` seed. Migrate callers to `makeInMemoryWorld({ world })`, which adapts supplied blocks through mc-worldgen's `ChunkStoreLayer(source, capacity)` and derives light from chunk contents. Unknown chunk coordinates load as empty chunks from the source.
