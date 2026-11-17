---
"@nerima-games/mx-gameplay": minor
---

Add public requests to drop one held item or its stack and pick a targeted block. Both requests take InteractionInventoryContext; pick results return the hotbar selection for the host to apply. Export discriminated result schemas and a pick target schema that requires normal or sticky state for piston_head. Dropping atomically removes and spawns the item, preserves components in dropped-item behaviour, and applies movement and a pickup delay. Picking prefers an empty hotbar slot for main-inventory matches and preserves displaced creative items when space permits. This API's creative world pick creates one item; Ctrl picking with block entity data is outside its scope.

When a pickup request omits currentFrame, the stage now uses its authoritative tick count, so the pickup delay still applies. Dropped items falling into the void emit a typed despawn event without stopping other item movement.
