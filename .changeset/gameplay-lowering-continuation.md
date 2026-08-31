---
'@nerima-games/mx-gameplay': minor
---

Add item metadata, the wither boss, audio cues and hotbar placement

Four areas move into this package from the composing app.

`createItemMetadataStore` tracks per-stack metadata and container-scoped
metadata, keyed so that a container id containing a separator still resolves
correctly. The wither boss builds on the state machine mc-sim already
publishes, adding the encounter rules around it. `audio-cues` covers the
placement latch, inventory-transition announcements and the footstep
when-to-fire accumulator. `requestPlacementFromSelectedSlot` routes a
placement request from whichever hotbar slot is selected.

`advanceFootstepRuntime` takes a block id and resolves the surface through
the kernel block property table and the audio package's cue mapping, rather
than through a caller-supplied surface string. Callers that previously
resolved a surface themselves should pass the block id straight through; the
resulting cue is unchanged for every block in the registry.
