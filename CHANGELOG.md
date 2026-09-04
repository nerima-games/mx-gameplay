# @nerima-games/mx-gameplay

## 0.6.1

### Patch Changes

- [#34](https://github.com/nerima-games/mx-gameplay/pull/34) [`533c2a6`](https://github.com/nerima-games/mx-gameplay/commit/533c2a621a14f3bd9bdf5833b112af7273d10906) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix a minecart reversing back the way it came, at a corner, whenever its per-tick displacement is under about half a block.
  
  `stepVehicle` re-reads `resolveRailShape` from the cart's current cell every
  tick, so a cart takes MULTIPLE ticks to cross a curve cell whenever its
  speed × dt is small relative to a block width — a slow or just-launched
  minecart, not only an edge case. Each of those re-reads called
  `projectMinecartVelocity` again with ITS OWN prior output as `vx`/`vz`.
  `towardX` read that already-turned velocity as if it were a fresh arrival and
  turned the cart a SECOND time, back onto the leg it had just left. Because
  the cart's offset past the entry boundary is always smaller than one tick's
  displacement (by construction — that is what "just crossed the boundary"
  means), the undone step always overshoots back across the entry boundary too:
  not a cosmetic one-frame wobble but a full reversal that sends the cart back
  up the leg it arrived from, permanently, since a straight rail only ever
  preserves the sign of the velocity it is handed. The existing closed-rectangle
  regression test never caught this because it always covers 0.8 blocks/tick
  (unpowered acceleration to `MINECART_MAX_SPEED` at `dt = 0.1`), enough to
  clear an entire curve cell in one tick.
  
  `projectMinecartVelocity` is now idempotent on its own output for the
  oriented curve shapes: once `vx`/`vz` already matches one of the curve's two
  exit legs — the other axis exactly zero, matching sign — it is held there
  instead of being re-derived from `towardX`. An arrival is always the OPPOSITE
  sign on that axis (heading INTO the cell along a leg, not out of it), so this
  cannot mask a genuine arrival; it only recognizes the function's own prior
  answer and leaves it alone.
  
  No reference-implementation oracle exists for this function (see its own doc
  comment); the fix is checked against a reproduction that steps a cart through
  a corner using the real exported functions and records the position
  sequence, and against a new multi-tick regression test that drives a slow
  cart around a single corner through the real `advanceVehicles` path and
  asserts neither axis ever regresses below its own running maximum.

## 0.6.0

### Minor Changes

- [#31](https://github.com/nerima-games/mx-gameplay/pull/31) [`fced0a0`](https://github.com/nerima-games/mx-gameplay/commit/fced0a05f540471bb53b4351bc1ef88c8bdc87bd) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix minecarts running straight through corners instead of turning.
  
  Minor rather than patch because `RailShape` is an exported union this package
  *produces*: `resolveRailShape` can now return four values that did not exist
  before, so a consumer narrowing it exhaustively gains unhandled cases. No
  consumer in this organisation references `RailShape` today, but the bump
  describes the type change rather than the current consumer list.
  
  `resolveRailShape` used to collapse every perpendicular pair of rail
  neighbours into one undirected `'curve'`, so `projectMinecartVelocity` had no
  orientation left to steer with and kept whichever axis already dominated the
  incoming velocity. A cart is only ever handed to a corner cell moving exactly
  along one axis — a straight segment zeros the other component before the
  handoff — so the reachable case was always the one that could not turn: the
  cart ran straight through the corner and off the end of the track instead of
  turning, every time.
  
  `RailShape` gains four oriented curve values — `curve_north_east`,
  `curve_north_west`, `curve_south_east`, `curve_south_west` — computed in
  `resolveRailShape` from neighbour data the function already had and used to
  discard. `projectMinecartVelocity` now exits an oriented curve on the leg the
  cart did not arrive from, in that leg's fixed compass direction, preserving
  speed. The undirected `'curve'` still exists for the one case an orientation
  cannot resolve: a T-junction or crossing (three or four neighbours at once),
  which has no single connected pair to name; `projectMinecartVelocity` keeps
  its original dominant-axis continuation there.
  
  This has no reference-implementation oracle behind it — verified by the
  absence of any `file:line` citation on `projectMinecartVelocity` or its tests,
  unlike every sibling symbol in `rail-shape.ts`, and confirmed by the
  introducing commit's citation-free, one-line message. `docs/testing.md`
  previously claimed three reference tests were transcribed into
  `projectMinecartVelocity`; that claim had no citation backing it anywhere and
  has been corrected. The fix instead restores information the port had
  already computed and discarded, checked against the game's own documented
  rail block-state model (ten shapes: two straight, four ascending, four
  curve orientations) after confirming `mc-kernel`'s block registry does not
  store per-block rail orientation (`railKind` is `'none' | 'normal' |
  'powered'` only), so this repository continues to derive shape from
  neighbours rather than reading a stored one.
  
  `test/vehicle-rail-simulation.test.ts`'s closed-loop integration test was an
  out-and-back specifically because of this defect (its header said so). It is
  now a genuine closed rectangle: a minecart driven around a four-corner
  circuit through the real stepping path, asserted on every tick to never leave
  the rails it was placed on, and to reach all four sides of the loop.

## 0.5.3

### Patch Changes

- [#29](https://github.com/nerima-games/mx-gameplay/pull/29) [`888d516`](https://github.com/nerima-games/mx-gameplay/commit/888d516d50a0052e1021e40bc7b9696884712f69) Thanks [@takeokunn](https://github.com/takeokunn)! - Add multi-angle integration verification for minecart rail physics
  (`test/vehicle-rail-simulation.test.ts`), run through the real
  `advanceVehicles` frame function against a real in-memory `ChunkStoreApi`
  and `@nerima-games/mc-sim`'s real `VehicleServiceApi` rather than doubles.
  
  This closes the verification half of the vehicle/rail row in plan.md
  §3.11's responsibility 5 (`docs/responsibility.md` §5, `docs/testing.md`
  §3-1 row 5): the rail topology (`domain/vehicle/rail-shape.ts`,
  `rail-ascent.ts`), the powered-rail speed rule and climb constant
  (`domain/vehicle/vehicle-motion.ts`'s `MINECART_POWERED_ACCELERATION`,
  `MINECART_MAX_SPEED`, `MINECART_CLIMB_SPEED`), and the frame wiring
  (`domain/vehicle/vehicle-frame.ts`'s `advanceVehicles`, called from
  `stages/registration.ts`) were already implemented and 100%-covered by
  per-function unit tests, but none of those tests advanced a cart across
  more than a handful of ticks. The four new tests add the angles a
  per-function test cannot reach: a powered-rail out-and-back returning to
  its start position across repeated round trips (drift), the same elapsed
  time at different frame rates landing at the same position including a
  frame that straddles a 2-second boundary, a frame slower than the
  `advanceVehicles` 0.1s clamp advancing no further than the clamp, and
  speed staying bounded at `MINECART_MAX_SPEED` on every sampled tick of a
  300-simulated-second powered-rail run.
  
  No production code changed. A genuine gap was found rather than fixed: a
  cart approaching a grid corner (`'curve'`-shaped rail cell) axis-aligned —
  the only way a preceding straight segment ever hands one off — runs
  straight through it instead of turning, because `projectMinecartVelocity`
  keeps whichever axis already dominates the incoming velocity. This is
  recorded in the new test file's header rather than patched, since a fix
  would mean inventing corner-steering behaviour with no reference oracle
  behind it.

## 0.5.2

### Patch Changes

- [#27](https://github.com/nerima-games/mx-gameplay/pull/27) [`8e5995f`](https://github.com/nerima-games/mx-gameplay/commit/8e5995fa1408deeeaba857b0fefbf2fafc3e18d2) Thanks [@takeokunn](https://github.com/takeokunn)! - Align internal pins to the current published versions
  
  - `@nerima-games/mc-audio` to 0.2.8
  - `@nerima-games/mc-sim` to 0.4.2
  - `@nerima-games/mc-worldgen` to 0.3.2
  Each of these upstream releases contained a pin change and no source change,
  so no behaviour moves with this bump.

## 0.5.1

### Patch Changes

- [#25](https://github.com/nerima-games/mx-gameplay/pull/25) [`a113065`](https://github.com/nerima-games/mx-gameplay/commit/a113065cafca387fe45d1e33921339eed286b465) Thanks [@takeokunn](https://github.com/takeokunn)! - Pin mc-kernel 0.7.0 and mc-sim 0.4.1. mc-kernel 0.7.0 merges the player-settings value rules into one domain (`rebindKey` replaces `bindKey`, `audioEnabled`/`mouseSensitivity` defaults change); this repository never imports the settings domain, so no call sites moved. mc-sim 0.3.0 added a save coordinator and a placement-consumption rule brought down from the composing app, and 0.4.0 adopted that same settings domain; this repository has no local save coordinator or placement-consumption rule to collide with, and does not read `rebindKey`/`DEFAULT_SETTINGS`, so neither changed anything here. mc-sim 0.4.1 only re-pins mc-save and mc-worldgen one level further down, with no source changes of its own. Verified the footstep-material vocabulary this repository reads from kernel's block registry (`propertyOfBlockId(id, 'footstepMaterial')`) still agrees with mc-audio's `FOOTSTEP_SURFACES` by enumerating every registered block id: all 123 resolve to one of the four known surfaces and every non-`'default'` surface still resolves to a cue. No source changes were required beyond the two pins.

## 0.5.0

### Minor Changes

- [#22](https://github.com/nerima-games/mx-gameplay/pull/22) [`dd4de4c`](https://github.com/nerima-games/mx-gameplay/commit/dd4de4c1b2ee88476577a347e18e273bc1c7872f) Thanks [@takeokunn](https://github.com/takeokunn)! - Add item metadata, the wither boss, audio cues and hotbar placement
  
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

- [#21](https://github.com/nerima-games/mx-gameplay/pull/21) [`d56624a`](https://github.com/nerima-games/mx-gameplay/commit/d56624a4a8a70cd60466c012a940a5cf66d83ec1) Thanks [@takeokunn](https://github.com/takeokunn)! - Bring down the dropped-item lifecycle (lifetime, metadata, pickup eligibility, and death drops), the furnace advance policy, the swimming oxygen and drowning machine, the multiplayer sleep roster, and the eye-of-ender flight from the composing app. Dropped-item behaviour now carries custom names and enchantments as typed fields rather than having them bolted on at restore time.

## 0.4.0

### Minor Changes

- [#18](https://github.com/nerima-games/mx-gameplay/pull/18) [`9c8a7b4`](https://github.com/nerima-games/mx-gameplay/commit/9c8a7b40f102dac133d1e355b132b4c30a0d57ce) Thanks [@takeokunn](https://github.com/takeokunn)! - Repoint the block vocabulary mirror to `@nerima-games/mc-kernel` (0.6.1) and delete it: `domain/block-vocabulary.ts`. `isReplaceable`/`fallsWhenUnsupported`/`validSpawnSurface`/`canSupportAttachments` are now `capabilityOfBlockId(id, flag)`; `resistsNormalExplosion(id)` is now `resistsExplosion(id, power)`. `HARVEST_TIERS` gained a sixth tier, `'netherite'`, which gates no additional block (a netherite pickaxe is faster than diamond, never a tier gate in vanilla).
  
  `test/block-loot.test.ts`'s silk-touch expectations for glowstone now expect `count: 2` rather than the former mirror's flat `count: 1`: kernel's `silkTouchItem` substitutes only the item, and the row's own base count (glowstone's is 2, before fortune) still applies. This is kernel's row-level model, not the former mirror's blanket "every silk-touch drop is exactly 1" rule.
  
  Depends on the mc-kernel 0.6.1 registry fix (`silkTouchItem: 'glowstone'`; `drops: DROPS_NOTHING` for `tall_grass`/`fern`, matching every other plant row whose vanilla behaviour already agreed with the bare default) — 0.6.0 was missing both and left four `block-loot` tests red; pinned at 0.6.1 where they pass with the pre-existing, vanilla-correct expectations otherwise unchanged.

- [`317a545`](https://github.com/nerima-games/mx-gameplay/commit/317a545ab24b02b8418146bf768f213f4f9cb865) Thanks [@takeokunn](https://github.com/takeokunn)! - Repoint the last two mirrors and delete them: `domain/chunk-store-port.ts` and `domain/portal-frame-port.ts`. The split is not the one either mirror's own header predicted: `chunk-store-port.ts`'s chunk-store vocabulary (`ChunkStore`, `ChunkStoreApi`, `BlockReading`, `BlockWriteOutcome`, `LightReading`, `ChunkNeighbours`, `ChunkDirtyBatch`, `ChunkDirtySubscription`, `blockIndex`, `readBlock`, `CHUNK_HEIGHT`, and the local `WorldgenChunk` alias, now literally `@nerima-games/mc-worldgen`'s own `Chunk`) comes from `@nerima-games/mc-worldgen` (0.3.0, exact) as expected, but `portal-frame-port.ts`'s portal-frame family (`detectNetherPortal`, `generatePortalLayout`, `PortalFrame`, `PortalLayout`, `PortalAxis`, `BlockAt`, `MIN_PORTAL_WIDTH`, `MAX_PORTAL_WIDTH`, `MIN_PORTAL_HEIGHT`, `MAX_PORTAL_HEIGHT`) comes from `@nerima-games/mc-kernel` (pinned 0.6.1, unchanged) instead: mc-worldgen deleted its own portal-frame duplicate before this repoint landed, and kernel is the sole remaining owner. Coordinate and id types (`BlockId`, `BlockPosition`, `ChunkCoord`, `AIR_BLOCK_ID`) come from kernel.
  
  Two adaptations follow from the type change rather than from a naming choice:
  
  - `chunk-store-port.ts`'s `BlockPosition` was deliberately unbranded (documented in its own header); every position that used to flow through it is now kernel's branded `BlockPosition`, produced at the few remaining literal-construction sites with kernel's own `blockPosition(x, y, z)` constructor rather than a type assertion. `stages/registration.ts`'s `toKernelPosition` helper — a lift used at roughly twenty call sites — is now the identity function; it is kept, rather than removed and its call sites touched, because the lift's meaning (kernel-branded in, kernel-branded out) has not changed, only its implementation.
  - Kernel's `detectNetherPortal` returns `PortalFrame | undefined`, where the deleted mirror's shape was `Option.Option<PortalFrame>`. `domain/interactions/ignite-portal.ts`, the one call site, is rewritten from `Option.isNone(detected)` to `frame === undefined`.
  
  `domain/in-memory-world.ts`'s `adaptGeneratedChunkStore` no longer needs to lift coordinates or block ids between an unbranded mirror and mc-worldgen's branded store — both sides are now the same type — so it is reduced to spreading the real store and overriding only `load`/`unload` with `Effect.orDie`, which this repository still needs because nothing downstream of `ChunkStore` here handles mc-worldgen's `ChunkPersistenceError` channel.
  
  `stages/registration.ts`'s fluid-flow `PlaceFluid` branch is fixed for a real behavior change the type widening exposed: mc-worldgen's real `BlockWriteOutcome` is a four-tag union (`Written` / `Unchanged` / `ChunkNotLoaded` / `OutOfWorld`), not the three-tag shape (`Written` / `Unchanged` / `ChunkNotLoaded`) the deleted mirror carried and the branch's own comment claimed. Before this fix, an `OutOfWorld` write outcome fell into the same `else` branch as `ChunkNotLoaded` and was deferred for retry up to `MAX_FLUID_DEFERRED_ATTEMPTS` times, even though a `y` outside the world will never become writable. It is now left undeferred, matching the terminal treatment `OutOfWorld` already gets everywhere else in the file (the `BlockUseOutcome`/`BreakOutcome` switches). The `RemoveFluid` and `Solidify` branches needed no equivalent fix: their existing `else` (non-`ChunkNotLoaded`) behavior — forget the cell locally — was already correct for `OutOfWorld` too, since there is no world state to represent for a position that cannot exist.
  
  Every producer site across `src/`, `apps/preview-mining-site/` and `test/` that built a `BlockPosition`/`ChunkCoord`/`BlockId` from a plain literal is repointed to kernel's own `blockPosition(x, y, z)`/`chunkCoord(cx, cz)`/`BlockId(value)` constructors — these validate (`Number.isSafeInteger`, `[0, 65535]` for `BlockId`) and throw on a bad value, rather than the deleted mirror's silent pass-through. Two functions whose own contract tolerates deliberately-invalid input (`domain/chunk-window.ts`'s `chunkCoordsAround`, `stages/registration.ts`'s `validFluidPosition`) are widened to accept the plain unbranded shape instead of being forced through the throwing constructor; `validFluidPosition` is now a type predicate so its ~20 downstream call sites keep their existing branded typing. `domain/interactions/explosion-crater.ts`'s `craterCells` is widened the same way, for the same reason (an arrow's fractional hit-point midpoint). `domain/in-memory-chunk-store.ts` and its preview-app counterpart use a justified `as SubscriberId` at one boundary each — `@nerima-games/mc-worldgen` exports the `SubscriberId` type but no public constructor for it, so an independent `ChunkStoreApi` reimplementation outside the package has no other way to produce one; documented in place.
  
  A real bug surfaced by this: `domain/mob/enderman-teleport.ts`'s `endermanTeleportCandidates` built landing cells by adding a continuous, generally-fractional displacement (`offsetFromRoll`'s unchanged port of the reference formula) directly onto an anchor, despite `EndermanTeleportPosition`'s own doc comment promising an integer. The deleted mirror's unbranded `BlockPosition` let this pass silently into mis-addressed chunk-buffer reads; kernel's real branded type throws on it instead. Fixed by flooring at the one place the displacement becomes a cell, matching this repository's existing floor-at-the-boundary convention (`domain/entities/mob-frame.ts`'s `cellOf`, `stages/registration.ts`'s portal-travel floor).
  
  `stages/registration.ts` gained one new test (`an out-of-world PlaceFluid write is dropped, not deferred`) to cover the `OutOfWorld` fluid-defer branch above at the coverage gate's request — 100% branches was otherwise 2902/2903.
  
  Not done here, flagged as follow-ups: `domain/in-memory-chunk-store.ts` and `test/support/chunk-store-double.ts` are typed against `@nerima-games/mc-worldgen`'s real `ChunkStoreApi` now (their imports and false claims about the deleted mirror are fixed), but both files' own headers say they should be deleted now that mc-worldgen has published — that deletion is out of scope for this repoint and was not done. `README.md` and `docs/*.md` still describe both deleted mirrors (and, unrelated to this change, the four mirrors `frame-contract.ts`/`item-vocabulary.ts`/`position-key.ts`/`block-position-key.ts`/`block-vocabulary.ts` deleted by earlier repoints) as if they exist; doc updates were out of scope for the earlier repoints too and remain out of scope here.

- [#17](https://github.com/nerima-games/mx-gameplay/pull/17) [`d27d62f`](https://github.com/nerima-games/mx-gameplay/commit/d27d62fb218924411ba12c2be44403a056d12838) Thanks [@takeokunn](https://github.com/takeokunn)! - Repoint the coordinate/frame/item vocabulary mirrors to `@nerima-games/mc-kernel` (0.5.1) and delete them: `domain/frame-contract.ts`, `domain/item-vocabulary.ts`, `domain/position-key.ts` and `domain/block-position-key.ts`. `FrameServices` now resolves to kernel's `ClockPort` instead of `never`, so every test and preview stage run provides a fixed clock through `FrameServicesLayer`. `PositionKey` is kernel's `BlockPositionKey`, encoded identically. `below`/`above`/`horizontalNeighbours` are kernel's `adjacentBlockPosition`/`horizontalBlockNeighbours`, called through a local unbranded-to-kernel-branded position lift since `domain/chunk-store-port.ts`'s own `BlockPosition` stays unbranded until its own repoint (Wave 1, W1-M5).

### Patch Changes

- [#16](https://github.com/nerima-games/mx-gameplay/pull/16) [`62e330d`](https://github.com/nerima-games/mx-gameplay/commit/62e330d1025a4960ba880c064381d32f035c4d6a) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.3.3

### Patch Changes

- [#14](https://github.com/nerima-games/mx-gameplay/pull/14) [`bf3adda`](https://github.com/nerima-games/mx-gameplay/commit/bf3adda674606beb1842264e516c7fa71fb77ff0) Thanks [@takeokunn](https://github.com/takeokunn)! - Restore the `droppedItemPickup` opt-out on `GameplayStageOptions` (defaults to `true`, unchanged for every existing caller). A consumer that runs its own richer pickup loop — one that preserves item metadata such as durability or custom names, which this stage's own sweep does not carry — sets `droppedItemPickup: false` to stop the entities stage from also picking the same item up and double-consuming it.

## 0.3.2

### Patch Changes

- [`071b1cd`](https://github.com/nerima-games/mx-gameplay/commit/071b1cdf94d33324b976fd06f9e51a6402b36868) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate to the org-wide package standard: source moved under `src/`, the
  `api-lock`/`check-dependency-whitelist` custom gates were replaced by
  `.oxlintrc.json`'s `no-restricted-imports`, GitHub Actions are now SHA-pinned,
  Dependabot and changesets were added, and the previously-undeclared
  `@nerima-games/mc-audio` runtime dependency (used per this repository's
  declared Tier3 parents in `docs/architecture.md` and `DEPENDENCY_POLICY.md`)
  was added to `dependencies`. No public API changes.

- [#9](https://github.com/nerima-games/mx-gameplay/pull/9) [`56fdd33`](https://github.com/nerima-games/mx-gameplay/commit/56fdd3319e3d63e427efdca405dd02975d838341) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix oxlint violations surfaced by nixpkgs' oxlint 1.73 (categories were left
  "warn" instead of "off", and individual rules flagged real shadowing/magic-number/
  no-empty issues once enforced) and close the coverage gate back to the declared
  99% threshold on all four metrics, with real behavioral tests for every
  reachable branch and `v8 ignore` pragmas — each with a stated rationale,
  matching this repository's existing convention — for the branches proven
  unreachable. No public API changes.

- [#12](https://github.com/nerima-games/mx-gameplay/pull/12) [`4a8d438`](https://github.com/nerima-games/mx-gameplay/commit/4a8d438f78a2bbccab7764df01b606b6017d3671) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added

## 0.1.44

### Patch Changes

- Integrate deterministic hostile mob despawning into the live mob frame with persistent snapshot state and save/restore compatibility.

## 0.1.43

### Patch Changes

- Add deterministic age, distance, persistence, difficulty, and random hostile mob despawn rules.

## 0.1.42

### Patch Changes

- Add deterministic Enderman teleport landing validation for loaded, solid, clear, hazard-free destinations and environmental escape triggers.

## 0.1.41

### Patch Changes

- Add deterministic fire spreading, fuel consumption, weather extinguishing, natural expiry, and contact damage events.

## 0.1.38

### Patch Changes

- [`f478ee0`](https://github.com/nerima-games/mx-gameplay/commit/f478ee06aea11d787a5c7aca4e4d0d7b2870f038) Thanks [@takeokunn](https://github.com/takeokunn)! - Add bounded furnace advance planning, stale-plan-safe application, and item-use stage routing over mc-sim-owned furnace state.

- Add Efficiency-aware mining speed to the bounded mining progress API.

- [#1](https://github.com/nerima-games/mx-gameplay/pull/1) [`9cee47c`](https://github.com/nerima-games/mx-gameplay/commit/9cee47cc22e9027afb231e87a1117679ae9ab05e) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate to the org-wide package standard: source moved under `src/`, the
  `api-lock`/`check-dependency-whitelist` custom gates were replaced by
  `.oxlintrc.json`'s `no-restricted-imports`, GitHub Actions are now SHA-pinned,
  Dependabot and changesets were added, and the previously-undeclared
  `@nerima-games/mc-audio` runtime dependency (used per this repository's
  declared Tier3 parents in `docs/architecture.md` and `DEPENDENCY_POLICY.md`)
  was added to `dependencies`. No public API changes.
