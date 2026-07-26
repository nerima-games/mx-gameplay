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
export * from './domain/death-cause'
export * from './domain/falling-block'
export * from './domain/fluid-frontier'
export * from './stages/registration'
export * from './stages/stage-ids'

// --- Provisional ---------------------------------------------------------------
// `domain/frame-contract.ts` and `domain/position-key.ts` are temporary local
// stand-ins for @nerima-games/mc-kernel and are NOT re-exported. Both carry a
// deletion date — see the "WHY THIS FILE EXISTS AND WHEN IT DIES" header on the
// first — and re-exporting them would make `StageId`, `DeltaTimeSecs` and
// `StageRegistration` published API of a package that does not own them, so
// deleting the stand-in would become a breaking change for every consumer.
// Consumers take that vocabulary from kernel; the types are structurally
// identical, so a consumer importing them from kernel typechecks against the
// signatures above. Same call, and the same reason, as mc-sim's and
// mc-render's barrels.
