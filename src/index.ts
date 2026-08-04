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

export * from './domain/day-night'
export * from './domain/bed-sleep'
export * from './domain/death-cause'
export * from './domain/environmental-contact-damage'
export * from './domain/enchantment'
export * from './domain/fall-damage'
export * from './domain/entities/mob-frame'
export * from './domain/falling-block'
export * from './domain/fluid-frontier'
export * from './domain/position-key'
export * from './domain/frame-rolls'
export * from './domain/fire-lifecycle'
export * from './domain/chunk-window'
export * from './domain/combat/armor'
export * from './domain/interactions/plan-falling-block-moves'
export * from './domain/interactions/block-loot'
export * from './domain/interactions/bow-shot'
export * from './domain/interactions/draw-bow'
export * from './domain/interactions/explosion-crater'
export * from './domain/interactions/eat-food'
export * from './domain/interactions/fishing'
export * from './domain/interactions/advance-furnace'
export * from './domain/interactions/ignite-fire'
export * from './domain/interactions/ignite-portal'
export * from './domain/interactions/ignite-tnt'
export * from './domain/interactions/knockback'
export * from './domain/interactions/place-block'
export * from './domain/in-memory-chunk-store'
export * from './domain/in-memory-entity-manager'
export * from './domain/in-memory-inventory'
export * from './domain/in-memory-player'
export * from './domain/in-memory-world'
export * from './domain/in-memory-vitals'
export * from './domain/player-collision'
export * from './domain/player-swimming'
export * from './domain/interactions/break-progress'
export * from './domain/interactions/mining-progress'
export * from './domain/interactions/right-click-target'
export * from './domain/interactions/till-soil'
export * from './domain/interactions/unequip-armor'
export * from './domain/interactions/crop-drops'
export * from './domain/interactions/interaction-intent'
export * from './domain/interactions/plant-crop'
export * from './domain/interactions/bone-meal'
export * from './domain/interactions/place-cactus-sides'
export * from './domain/interactions/melee-attack'
export * from './domain/interactions/place-door-upper'
export * from './domain/interactions/place-mushroom-light'
export * from './domain/interactions/place-sugar-cane-water'
export * from './domain/interactions/throw-ender-pearl'
export * from './domain/interactions/use-flint-and-steel'
export * from './domain/interactions/use-bucket'
export * from './domain/mob/creeper-fuse'
export * from './domain/entities/dropped-item'
export * from './domain/mob/enderman-teleport'
export * from './domain/mob/ender-dragon-encounter'
export * from './domain/end-portal-travel'
export * from './domain/mob/explosion'
export * from './domain/mob/primed-tnt'
export * from './domain/mob/hostile-despawn'
export * from './domain/mob/hostile-combat'
export * from './domain/mob/hostile-spawn'
export * from './domain/mob/mob-drop'
export * from './domain/mob/mob-ecosystem'
export * from './domain/mob/shulker-shell'
export * from './domain/vehicle/rail-ascent'
export * from './domain/vehicle/rail-shape'
export * from './domain/vehicle/vehicle-motion'
export * from './domain/vehicle/vehicle-frame'
export * from './domain/weather'
export * from './domain/weather-gameplay'
export * from './domain/villager-trade'
export * from './domain/status-effect'
export * from './domain/survival-hunger'
export * from './domain/brewing'
export {
  blockOfPlaceableItem,
  isPlaceableItem,
  itemOfBlock,
  type PlaceableItemType,
} from './domain/block-vocabulary'
export * from './domain/interactions/use-block'
export * from './stages/registration'
export * from './stages/ender-dragon-encounter-stage'
export * from './stages/stage-ids'
export * from './stages/targeted-right-click-route'

// --- Provisional ---------------------------------------------------------------
// Eight modules are temporary local stand-ins for packages that are not
// published yet, and none of their vocabularies is re-exported wholesale:
//
//   domain/frame-contract.ts      -> @nerima-games/mc-kernel
//   domain/position-key.ts        -> @nerima-games/mc-kernel
//   domain/item-vocabulary.ts     -> @nerima-games/mc-kernel
//   domain/block-vocabulary.ts    -> @nerima-games/mc-kernel
//   domain/chunk-store-port.ts    -> @nerima-games/mc-worldgen
//   domain/portal-frame-port.ts   -> @nerima-games/mc-worldgen
//   domain/inventory-port.ts      -> @nerima-games/mc-sim
//   domain/block-position-key.ts — the join between two of the vocabularies above
//
// TWO of them mirror mc-worldgen and ONE mirrors mc-sim, which is not an
// inconsistency: `domain/portal-frame-port.ts`'s header records the lesson that
// one mirror file must have one SOURCE module, and `domain/block-vocabulary.ts`
// beside `domain/item-vocabulary.ts` is the same arrangement for mc-kernel.
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
// DIES" header on the first — and re-exporting them would make `StageId`,
// `DeltaTimeSecs`, `StackCount`, `StageRegistration`, `ChunkStore`,
// `EntityManagerApi` and `InventoryServiceApi` published API of a package that
// does not own them, so deleting the stand-in would become a breaking change
// for every consumer. Consumers take that
// vocabulary from kernel, mc-worldgen and mc-sim; the types are structurally
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
