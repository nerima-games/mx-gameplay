/**
 * @nerima-games/mx-gameplay — the rules of play.
 *
 * PRE-IMPLEMENTATION FIRST CUT (叩き台). See README.md 現状.
 *
 * mx-gameplay is an EXPERIENCE MODULE: a verb (plan.md §2.3-1). It owns rules —
 * mining and placement, item use, mob behaviour, drops and loot, fluid
 * propagation, vehicles, portals, day/night and weather — and owns no state.
 * Every fact it reads or writes belongs to mc-sim or mc-worldgen; every sound it
 * asks for belongs to mc-audio.
 *
 * It knows nothing of mx-redstone, mx-ui or mx-multiplayer. "Mining puts an item
 * in the inventory" is mx-gameplay writing to mc-sim's InventoryService and
 * mx-ui reading that same service — not an edge between the two.
 *
 * Its public surface is stage registration (`stages/registration.ts`). The
 * domain modules below are exported because they are the units the tests and the
 * previews drive directly, not because another repository is expected to import
 * them; see docs/public-api.md for what is contract and what is merely visible.
 */

export * from './domain/day-night.js'
export * from './domain/bed-sleep.js'
export * from './domain/death-cause.js'
export * from './domain/environmental-contact-damage.js'
export * from './domain/enchantment.js'
export * from './domain/fall-damage.js'
export * from './domain/entities/mob-frame.js'
export * from './domain/falling-block.js'
export * from './domain/fluid-frontier.js'
export * from './domain/frame-rolls.js'
export * from './domain/fire-lifecycle.js'
export * from './domain/chunk-window.js'
export * from './domain/combat/armor.js'
export * from './domain/interactions/block-loot.js'
export * from './domain/interactions/bow-shot.js'
export * from './domain/interactions/draw-bow.js'
export * from './domain/interactions/explosion-crater.js'
export * from './domain/interactions/eat-food.js'
export * from './domain/interactions/fishing.js'
export * from './domain/interactions/advance-furnace.js'
export * from './domain/interactions/ignite-fire.js'
export * from './domain/interactions/ignite-portal.js'
export * from './domain/interactions/ignite-tnt.js'
export * from './domain/interactions/knockback.js'
export * from './domain/interactions/place-block.js'
export * from './domain/in-memory-chunk-store.js'
export * from './domain/in-memory-entity-manager.js'
export * from './domain/in-memory-inventory.js'
export * from './domain/in-memory-player.js'
export * from './domain/in-memory-world.js'
export * from './domain/in-memory-vitals.js'
export * from './domain/player-swimming.js'
export * from './domain/interactions/break-progress.js'
export * from './domain/interactions/mining-progress.js'
export * from './domain/interactions/right-click-target.js'
export * from './domain/interactions/till-soil.js'
export * from './domain/interactions/unequip-armor.js'
export * from './domain/interactions/crop-drops.js'
export * from './domain/interactions/interaction-intent.js'
export * from './domain/interactions/plant-crop.js'
export * from './domain/interactions/bone-meal.js'
export * from './domain/interactions/place-cactus-sides.js'
export * from './domain/interactions/melee-attack.js'
export * from './domain/interactions/place-door-upper.js'
export * from './domain/interactions/place-mushroom-light.js'
export * from './domain/interactions/place-sugar-cane-water.js'
export * from './domain/interactions/throw-ender-pearl.js'
export * from './domain/interactions/use-flint-and-steel.js'
export * from './domain/interactions/use-bucket.js'
export * from './domain/mob/creeper-fuse.js'
export * from './domain/entities/dropped-item.js'
export * from './domain/mob/enderman-teleport.js'
export * from './domain/mob/ender-dragon-encounter.js'
export * from './domain/end-portal-travel.js'
export * from './domain/mob/explosion.js'
export * from './domain/mob/primed-tnt.js'
export * from './domain/mob/hostile-despawn.js'
export * from './domain/mob/hostile-combat.js'
export * from './domain/mob/hostile-spawn.js'
export * from './domain/mob/mob-drop.js'
export * from './domain/mob/mob-ecosystem.js'
export * from './domain/mob/shulker-shell.js'
export * from './domain/vehicle/rail-ascent.js'
export * from './domain/vehicle/rail-shape.js'
export * from './domain/vehicle/vehicle-motion.js'
export * from './domain/vehicle/vehicle-frame.js'
export * from './domain/weather.js'
export * from './domain/weather-gameplay.js'
export * from './domain/villager-trade.js'
export * from './domain/status-effect.js'
export * from './domain/survival-hunger.js'
export * from './domain/brewing.js'
export {
  blockOfPlaceableItem,
  isPlaceableItem,
  itemOfBlock,
  type PlaceableItemType,
} from './domain/block-vocabulary.js'
export * from './domain/interactions/use-block.js'
export * from './stages/registration.js'
export * from './stages/ender-dragon-encounter-stage.js'
export * from './stages/stage-ids.js'
export * from './stages/targeted-right-click-route.js'

// --- Provisional ---------------------------------------------------------------
// Three modules are temporary local stand-ins for packages that are not
// published yet, and none of their vocabularies is re-exported wholesale:
//
//   domain/block-vocabulary.ts    -> @nerima-games/mc-kernel
//   domain/chunk-store-port.ts    -> @nerima-games/mc-worldgen
//   domain/portal-frame-port.ts   -> @nerima-games/mc-worldgen
//
// (Wave 1 (W1-M3) already repointed and deleted this repository's four
// mc-kernel mirrors of coordinate/frame/item vocabulary — domain/frame-contract.ts,
// domain/item-vocabulary.ts, domain/position-key.ts and domain/block-position-key.ts.
// Consumers of `StageId`, `DeltaTimeSecs`, `StackCount`, `CameraPoseSnapshot`,
// `ClockPort`, `FrameServices`, `GameModule`, `StageRegistration`, `ItemType` and
// `BlockPositionKey` take them directly from `@nerima-games/mc-kernel` now.)
//
// TWO of the remaining three mirror mc-worldgen, which is not an
// inconsistency: `domain/portal-frame-port.ts`'s header records the lesson that
// one mirror file must have one SOURCE module.
//
// `domain/chunk-window.ts` sits beside them and IS re-exported, because it is
// this repository's own: the bridge from an `Effect`-shaped store to the
// synchronous accessor mc-worldgen's portal rule takes. It survives the
// repoint; the mirror it names does not.
//
// `isPlaceableItem` is the narrow exception: gameplay consumers need the guard
// before requesting placement, so the barrel exports that operation without
// republishing kernel's block and item rosters.
//
// All of them carry a deletion date — see the "WHY THIS FILE EXISTS AND WHEN IT
// DIES" header on the first — and re-exporting them would make `ChunkStore`,
// `EntityManagerApi` and `InventoryServiceApi` published API of a package that
// does not own them, so deleting the stand-in would become a breaking change
// for every consumer. Consumers take that
// vocabulary from mc-worldgen and mc-sim; the types are structurally
// identical, so a consumer importing them from there typechecks against the
// signatures above. Same call, and the same reason, as mc-sim's and mc-render's
// barrels.
//
// `ChunkStore`, `EntityManager`, `EntityManagerApi`, `InventoryService` and
// `InventoryServiceApi` are nonetheless VISIBLE to a consumer, because they
// appear in the type of `makeGameplayStages`. That
// is why they are in the "Supporting declarations" section of `api-lock.md`: not
// exported, but named by an export.
//
// `MobBehaviour` and `repairMobBehaviour` ARE exported, and that is not an
// inconsistency. They are this repository's own — the instantiation of mc-sim's
// behaviour parameter and the repair function mc-sim's load path delegates to —
// and a host has to import them by name in order to build the roster correctly.
// `domain/entities/mob-frame.ts` explains why no compiler can check that it did.
