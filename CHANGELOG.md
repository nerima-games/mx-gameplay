# @nerima-games/mx-gameplay

## 0.13.0

### Minor Changes

- Make endermen hostile after five consecutive ticks of unobstructed eye contact within 64 blocks. While watched, they pause within 16 blocks and approach from farther away. After the player looks away, they pursue and attack through the existing mob movement and combat paths. Melee attacks require an unobstructed eye segment.
  
  Anger expires after a duration sampled once from the inclusive 400–780 tick range. It also clears when its target is absent, dies, moves to another dimension, or leaves the 64-block follow range. Neutral endermen no longer chase merely because a player position is available.
  
  Mob frame callers must now supply `simulationTick` and `endermanGaze` in `MobFrameSenses`. `planMobMovementRoster` requires its final gaze argument. Gaze observations require `target`, `looking`, and `visible`: `target` is the player ID, and `looking` and `visible` contain enderman IDs observed from that player's perspective. Represent an absent target with `undefined` and empty observation sets explicitly.
  
  Add optional `endermanAnger` and `ecosystem` to `HostileMobSnapshot`. Pending anger records its target and stare ticks; acquired anger also records its absolute `expiresAt` tick. Enderman attacks share `EcosystemMobState.attackCooldownTicks` through `ecosystem`, preserving the separate hit flinch. World-read failures use the existing entity stage fault API with the `EndermanGaze` source, and raycast failures retain their original physics cause.
  
  Skeleton and blaze sight checks retain their existing 64-block eye-segment limit. Longer segments are not visible and produce no fault. Actual raycast failures, such as unrepresentable coordinates, produce a `ProjectileLineOfSight` entity stage fault while preventing the shot. `MobBehaviourStateRepairFailure.kind` reports the affected mob's `EntityKind` for foreign enderman metadata and retains the existing serialized labels `primed-tnt` and `dropped-item`.

- Change `rollFortuneExtraDrops` to return `Result<number, FortuneRollFailure>`. Non-finite rolls and rolls outside [0, 1) return `InvalidFortuneRoll`, including when the Fortune level is zero.
  
  Host callers must handle the failure and unwrap the successful result before using the extra drop count.

- Validate enchantment levels and status-effect state before calculating gameplay modifiers. Return typed failures for invalid block-loot rolls, invalid sleep deltas, and missing spawn measurements.
  
  Breaking for hosts: `Enchantment.level`, `BlockLootContext.fortuneLevel`, and the `level` parameter of `rollFortuneExtraDrops` now require the kernel `EnchantmentLevel` brand. `statusEffectLevel` and `statusEffectModifiers` require `ValidatedStatusEffectState`; status-effect application and tick outcomes return that validated state. Decode raw levels and state at the input boundary.
  
  `VehicleFrameEnvironment.isPoweredRailAt` is required, and `advanceVehicles` requires an explicit environment. Pass the vehicle service and environment together through the optional `vehicles: { service, environment }` argument to `gameplayStages`.
  
  Handle the added block-loot and sleep failures. Replace the removed `SpawnRefusal` arm `unmeasurable` with the existing `InvalidSpawnCandidate` failure.

## 0.12.0

### Minor Changes

- [#86](https://github.com/nerima-games/mx-gameplay/pull/86) [`d1b71d7`](https://github.com/nerima-games/mx-gameplay/commit/d1b71d702b5505f9a3b44ff03ae0fff49daa724a) Thanks [@takeokunn](https://github.com/takeokunn)! - Export `mobMovementWorldFromChunkWindow` and the `MobMovementWorldAdapter`, `MobMovementWorldCell`, and `MobMovementWorldFailure` types.

- [#76](https://github.com/nerima-games/mx-gameplay/pull/76) [`26c1c50`](https://github.com/nerima-games/mx-gameplay/commit/26c1c50a8db0e55f2b885332e021c9b97956635b) Thanks [@takeokunn](https://github.com/takeokunn)! - Add stateful block interactions and growth for crops and saplings.
  
  Breaking for hosts: `gameplayModule` and `makeGameplayStages` now require the `GameplayBlockStateWorld` service. The host must bind its `BlockStateWorldPort` to the C7 `WorldWritePort` so state edits and optional owner changes commit together.

## 0.11.0

### Minor Changes

- [#72](https://github.com/nerima-games/mx-gameplay/pull/72) [`1ed672f`](https://github.com/nerima-games/mx-gameplay/commit/1ed672fe70ec17095aebc389750ddba7e981d85c) Thanks [@takeokunn](https://github.com/takeokunn)! - Add tick-based melee cooldowns, hurt resistance, shield and difficulty resolution, weapon damage values, sprint eligibility, and mining penalties.

- [#80](https://github.com/nerima-games/mx-gameplay/pull/80) [`18fa7df`](https://github.com/nerima-games/mx-gameplay/commit/18fa7df67d6cb16446d8444bae8651f6ba1b92ed) Thanks [@takeokunn](https://github.com/takeokunn)! - Align gameplay with kernel 0.17.0, mc-audio 0.6.0, mc-sim 0.11.1, and mc-worldgen 0.9.1. Use faster cave carving and block-state materialization with unchanged generated output.
  
  Stages expose world-data failures through new `EntityStageFault` records in `GameplayFrameState.entityStageFaults` and `drainGameplayEntityStageFaults(state)`. `WorldDataFailure` records report the operation, position, source, and typed reason. Equal records are deduplicated while pending and after draining. `placeBlock`, `carveExplosionCrater`, `igniteTnt`, `useFlintAndSteel`, `resolveBlasts`, and the two-argument `breakBlock` overload expose `BlockStateCodecFailure` and `LightQueueUnderflowError`. `planPlaceBlock` and `mushroomLightObjection` expose `LightQueueUnderflowError`. `targetedRightClickRoute` exposes typed target and registry errors. `BlockPlacementCommandOutcome` adds `WorldDataFailed`; farming item-use outcomes include the new `GameplayStageItemUseWorldFailure` type. Gameplay block-decode faults report `UnregisteredBlockId` failures.
  
  Hosts that drain faults retain state from `makeGameplayFrameStateForOwner` and pass it to `gameplayStages`; `makeGameplayStages` and `gameplayModule` keep their state private.
  
  The biome spawn table covers kernel biome IDs, and default-material surfaces play the default footstep cue. The coverage-run per-test timeout is 60 seconds; regular test timeouts and the 100% coverage thresholds are unchanged.

- [#79](https://github.com/nerima-games/mx-gameplay/pull/79) [`16fdf7e`](https://github.com/nerima-games/mx-gameplay/commit/16fdf7e8b476312cda51e8d5c2547dba05356950) Thanks [@takeokunn](https://github.com/takeokunn)! - Generate enchanting-table offers through mc-sim's `EnchantmentTableService`, which counts the bookshelves around the requested table from the world. `OffersGenerated` results carry the counted `bookshelfCount` (0 to 15). An offers request is rejected with `table-area-unloaded` when a block used for the count is in an unloaded chunk or outside the world; the roll seed is not consumed, and each unreadable position is recorded as a `WorldDataFailure` stage fault with the new source `EnchantmentTable`.

- [#73](https://github.com/nerima-games/mx-gameplay/pull/73) [`8e302fc`](https://github.com/nerima-games/mx-gameplay/commit/8e302fcce29b8c902a355a5448f406de8408caeb) Thanks [@takeokunn](https://github.com/takeokunn)! - Use kernel food definitions, supported vanilla mob drops, and oak-leaf apples.

- [#77](https://github.com/nerima-games/mx-gameplay/pull/77) [`9958993`](https://github.com/nerima-games/mx-gameplay/commit/995899393c346f67c03c1888ea9bd251c8df11b0) Thanks [@takeokunn](https://github.com/takeokunn)! - Upgrade mc-sim to 0.10.0 and align gameplay time progression with its tick-based clock.

- [#78](https://github.com/nerima-games/mx-gameplay/pull/78) [`24a803e`](https://github.com/nerima-games/mx-gameplay/commit/24a803e212bc5d4eea1a25bc3f6173b14e26eeb2) Thanks [@takeokunn](https://github.com/takeokunn)! - Use SM3 pathfinding and physics for supported mob movement, add physical skeleton arrows and Blaze fireballs, let spiders climb walls, and burn exposed zombies and skeletons in daylight. Record typed world-data failures for affected targets while other stage work continues. Reject malformed present state.
  
  ## Public contract changes
  
  Relative to the latest published release, v0.10.0, callers must handle the Result and Effect error channels listed below. This inventory follows every export reachable from the package entrypoint and includes inferred declarations. Function-body changes alone are excluded. Referenced-type changes are listed separately from directly changed declarations. Dependency-internal declarations are outside this table.
  
  New `EntityStageFault` records and `drainGameplayEntityStageFaults(state)` expose target-specific world-data and entity failures. Equal records are deduplicated while pending and after draining.
  
  Hosts that drain faults retain state from `makeGameplayFrameStateForOwner` and pass it to `gameplayStages`; `makeGameplayStages` and `gameplayModule` keep their state private.
  
  `applyWeatherState(current, candidate)` becomes `applyWeatherState(candidate)` and returns `Result<WeatherState, "invalid-weather-state">`. `DespawnReason` loses `unmeasurable`. `HostileMobSnapshot.behaviour` becomes optional and excludes explicit undefined. Explosion exposure, hostile-contact/blast difficulty, and right-click range arguments use omission-aware rest tuples. Boat and minecart helpers reject negative and non-finite elapsed time; valid positive time is capped at 0.1 seconds. Spawn planners reject malformed feet positions before simulator repair. The request-fault variant of `EntityStageFault` carries optional `positionKey` for requests without an ID, preserving target-specific deduplication.
  
  For those rest-tuple arguments, omission retains the existing defaults: explosion exposure is 1, hostile difficulty is `normal`, and right-click range is `DEFAULT_BLOCK_REACH`. Explicit `undefined`, `null`, and other invalid values return typed failures.
  
  `GameplayEntityRosterSchema` restores a JSON-omitted entity `behaviour` key to undefined through `migrateLegacyMissingEntityBehaviour`. For omitted legacy behavior state, `repairMobBehaviour` uses `migrateLegacyMissingCreeperFuse`, `migrateLegacyMissingEndermanFlinch`, `migrateLegacyMissingPrimedTntFuse`, and `migrateLegacyMissingEcosystemMobState`. In `repairEcosystemMobState`, `migrateLegacyEcosystemMobFields` supplies omitted `hasHeadProtection` as false and `burningTicks` as 0.
  
  <details>
  <summary>Complete public export changes since v0.10.0</summary>
  
  Blank module cells continue the preceding module.
  
  ### Direct declaration changes
  
  | Module | Export | Contract change |
  | --- | --- | --- |
  | `src/domain/bed-sleep.ts` | `advanceSleep` | Return: `SleepAdvance` to `Result.Result<SleepAdvance, "invalid-sleep-ratio">`. |
  |  | `attemptBedSleep` | Return: `Effect.Effect<BedSleepDecision, Brand.BrandError>` to `Effect.Effect<BedSleepDecision, Brand.BrandError \| DayNightInputFailure>`. |
  |  | `requiredSleeperCount` | Return: `number` to `Result.Result<number, "invalid-sleep-ratio">`. |
  |  | `resolveBedSleep` | Return: `BedSleepDecision` to `Result.Result<BedSleepDecision, DayNightInputFailure>`. |
  |  | `sleepRatioFromPercentage` | Return: `number` to `Result.Result<number, "invalid-sleep-percentage">`. |
  | `src/domain/day-night.ts` | `DAWN_FRACTION` | Previous: `DAWN_FRACTION = 0.25`. New: `DAWN_FRACTION: number`. |
  |  | `DUSK_FRACTION` | Previous: `DUSK_FRACTION = 0.75`. New: `DUSK_FRACTION: number`. |
  |  | `NOON_FRACTION` | Previous: `NOON_FRACTION = 0.5`. New: `NOON_FRACTION = 0.25`. |
  |  | `dayPhase` | Return: `DayPhase` to `Result.Result<DayPhase, DayNightInputFailure>`. |
  |  | `hostileSpawnsAllowed` | Return: `boolean` to `Result.Result<boolean, DayNightInputFailure>`. |
  |  | `isNight` | Return: `boolean` to `Result.Result<boolean, DayNightInputFailure>`. |
  | `src/domain/death-cause.ts` | `applyDamage` | Return: `Vitals` to `Result.Result<Vitals, DamageApplicationFailure>`. |
  |  | `deathMessage` | Return: `string \| undefined` to `Result.Result<string \| undefined, DeathMessageFailure>`. |
  | `src/domain/enchantment.ts` | `enchantmentOffer` | Parameters: (`seed: number, bookshelfCount: number, slot: EnchantmentTableSlot`) to (`seed: unknown, bookshelfCount: unknown, slot: EnchantmentTableSlot`). Return: `EnchantmentOffer` to `Result.Result<EnchantmentOffer, EnchantmentOfferFailure>`. |
  |  | `enchantmentOffers` | Parameters: (`seed: number, bookshelfCount: number`) to (`seed: unknown, bookshelfCount: unknown`). Return: `readonly [ EnchantmentOffer, EnchantmentOffer, EnchantmentOffer ]` to `Result.Result<readonly [ EnchantmentOffer, EnchantmentOffer, EnchantmentOffer ], EnchantmentOfferFailure>`. |
  |  | `generateEnchantmentTableOffersForItem` | Return: `Result.Result<EnchantmentTableOffers, EnchantmentTableError>` to `Result.Result<EnchantmentTableOffers, EnchantmentTableError \| Brand.BrandError>`. |
  |  | `rerollEnchantmentSeed` | Parameters: (`seed: number`) to (`seed: unknown`). Return: `number` to `Result.Result<number, EnchantmentOfferFailure>`. |
  | `src/domain/entities/dropped-item.ts` | `DroppedItemLifetimeTracker` | `readonly restore: (dimension: string, entries: ReadonlyArray<{ readonly entityId: string; readonly elapsedSecs: number; }>) => void;` becomes `readonly restore: (dimension: string, entries: ReadonlyArray<{ readonly entityId: string; readonly elapsedSecs: number; }>) => Result.Result<void, DroppedItemLifetimeFailure>;`. `readonly advance: (dimension: string, deltaSecs: number, entityIds: ReadonlyArray<string>) => ReadonlyArray<string>;` becomes `readonly advance: (dimension: string, deltaSecs: number, entityIds: ReadonlyArray<string>) => Result.Result<ReadonlyArray<string>, DroppedItemLifetimeFailure>;`. |
  |  | `DroppedItemPickupFailure` | Previous: `export type DroppedItemPickupFailure = Brand.BrandError \| ItemStackFailure \| Schema.SchemaError \| WorldCommitCoordinatorError \| Schema.Schema.Type<typeof DroppedItemPickupCommitIncompleteSchema>;`. New: `export type DroppedItemPickupFailure = Brand.BrandError \| ItemStackFailure \| Schema.SchemaError \| WorldCommitCoordinatorError \| DroppedItemPickupRadiusFailure \| Readonly<{ _tag: 'InvalidDroppedItemPickupField'; field: 'position' \| 'currentFrame'; }> \| Schema.Schema.Type<typeof DroppedItemPickupCommitIncompleteSchema>;`. |
  |  | `DroppedItemSpawnError` | Previous: `export type DroppedItemSpawnError = Extract<AddStoredStackResult, { readonly _tag: 'InvalidStack' \| 'ItemStackFailure'; }> \| EntitySerialExhausted;`. New: `export type DroppedItemSpawnError = Extract<AddStoredStackResult, { readonly _tag: 'InvalidStack' \| 'ItemStackFailure'; }> \| EntitySerialExhausted \| Schema.SchemaError \| Readonly<{ _tag: 'InvalidDroppedItemSpawnField'; field: 'durability' \| 'eligibleFromFrame' \| 'customName' \| 'enchantments'; }>;`. |
  |  | `createDroppedItemLifetimeTracker` | Previous: `createDroppedItemLifetimeTracker: (lifetimeSecs?: number) => DroppedItemLifetimeTracker`. New: `export declare function createDroppedItemLifetimeTracker(): DroppedItemLifetimeTracker; export declare function createDroppedItemLifetimeTracker(lifetimeSecs: number): Result.Result<DroppedItemLifetimeTracker, DroppedItemLifetimeFailure>;`. |
  |  | `deathDropsFromPlayerStorage` | Return: `ReadonlyArray<DroppedItemSpawn>` to `Result.Result<ReadonlyArray<DroppedItemSpawn>, DeathDropsFromPlayerStorageFailure>`. |
  |  | `droppedItemOwnerRegistration` | Previous: `droppedItemOwnerRegistration: (ownerId: ReplicatedOwnerId, initialState?: DroppedItemOwnerSnapshot) => ReplicatedOwnerRegistration<typeof DroppedItemOwnerSnapshotSchema>`. New: `export declare function droppedItemOwnerRegistration(ownerId: ReplicatedOwnerId): ReplicatedOwnerRegistration<typeof DroppedItemOwnerSnapshotSchema>; export declare function droppedItemOwnerRegistration(ownerId: ReplicatedOwnerId, initialState: DroppedItemOwnerSnapshot): Result.Result<ReplicatedOwnerRegistration<typeof DroppedItemOwnerSnapshotSchema>, DroppedItemOwnerRegistrationFailure>;`. |
  |  | `droppedItemPickupOwnerRegistrations` | Previous: `droppedItemPickupOwnerRegistrations: (owners: DroppedItemPickupOwners, playerStorage: PlayerStorage, droppedItems?: DroppedItemOwnerSnapshot) => readonly [ ReplicatedOwnerRegistration<typeof PlayerStorageSnapshotSchema>, ReplicatedOwnerRegistration<typeof DroppedItemOwnerSnapshotSchema> ]`. New: `export declare function droppedItemPickupOwnerRegistrations(owners: DroppedItemPickupOwners, playerStorage: PlayerStorage): DroppedItemPickupOwnerRegistrations; export declare function droppedItemPickupOwnerRegistrations(owners: DroppedItemPickupOwners, playerStorage: PlayerStorage, droppedItems: DroppedItemOwnerSnapshot): Result.Result<DroppedItemPickupOwnerRegistrations, DroppedItemOwnerRegistrationFailure>;`. |
  |  | `pickupDroppedItems` | Previous: `pickupDroppedItems: (roster: EntityManagerApi<MobBehaviour>, inventory: InventoryServiceApi, playerPosition: Position \| undefined, radius?: number, currentFrame?: number) => Effect.Effect<void>`. New: `export declare function pickupDroppedItems(roster: EntityManagerApi<MobBehaviour>, inventory: InventoryServiceApi, playerPosition: Position \| undefined): Effect.Effect<void, DroppedItemPickupRadiusFailure>; export declare function pickupDroppedItems(roster: EntityManagerApi<MobBehaviour>, inventory: InventoryServiceApi, playerPosition: Position \| undefined, radius: number, currentFrame?: number): Effect.Effect<void, DroppedItemPickupRadiusFailure>;`. |
  | `src/domain/entities/mob-frame.ts` | `BlastResolution` | Adds `readonly faults: ReadonlyArray<MobRosterDamageFault>;`. |
  |  | `CasualtyDrops` | Previous: `export type CasualtyDrops = { readonly drops: ReadonlyArray<MobDropEvent>; readonly seed: number; };`. New: `export type CasualtyDrops = Readonly<{ readonly drops: ReadonlyArray<MobDropEvent>; readonly seed: number; }> & ({ readonly _tag: 'Resolved'; } \| { readonly _tag: 'Unsupported'; readonly issues: ReadonlyArray<MobRuleIssue>; });`. |
  |  | `HostileMobSnapshot` | `readonly behaviour: CreeperFuse \| EndermanFlinch \| EcosystemMobState \| undefined;` becomes `readonly behaviour?: CreeperFuse \| EndermanFlinch \| EcosystemMobState;`. Adds `readonly movement?: MobMovementState;`. |
  |  | `MAX_HOSTILE_COUNT` | Previous: `MAX_HOSTILE_COUNT = 16`. New: `MAX_HOSTILE_COUNT: number`. |
  |  | `MobBehaviour` | Previous: `export type MobBehaviour = HostileMobSnapshot \| CreeperFuse \| PrimedTnt \| EndermanFlinch \| EcosystemMobState \| DroppedItemBehaviour \| undefined;`. New: `export type MobBehaviour = HostileMobSnapshot \| MobBehaviourRepairFault \| CreeperFuse \| PrimedTnt \| EndermanFlinch \| EcosystemMobState \| DroppedItemBehaviour \| undefined;`. |
  |  | `MobBlastRosterResolution` | Previous: `export type MobBlastRosterResolution = Readonly<{ roster: MobRoster; casualties: ReadonlyArray<MobCasualty>; }>;`. New: `export type MobBlastRosterResolution = Readonly<{ roster: MobRoster; casualties: ReadonlyArray<MobCasualty>; faults: ReadonlyArray<MobRosterDamageFault>; }>;`. |
  |  | `MobCasualty` | Previous: `export type MobCasualty = Readonly<{ id: EntityId; kind: EntityKind; at: Position; killCredit?: MobKillCredit; lastHitTick?: SimulationTickValue; deathTick?: SimulationTickValue; }>;`. New: `export type MobCasualty = Readonly<{ id: EntityId; kind: EntityKind; at: Position; killCredit?: MobKillCredit; lastHitTick?: SimulationTickValue; deathTick?: SimulationTickValue; age?: MobAge; size?: MobSize; burning?: boolean; killedByChargedCreeper?: boolean; experienceRoll?: MobExperienceRoll; undroppedEquipmentCount?: MobUndroppedEquipmentCount; equipmentXpRolls?: ReadonlyArray<MobExperienceRoll>; firstDragonDeath?: boolean; }>;`. |
  |  | `MobDamageHit` | Previous: `export type MobDamageHit = Readonly<{ id: EntityId; damage: Damage; killCredit?: Exclude<MobKillCredit, 'player-triggered-tnt'>; lastHitTick?: SimulationTickValue; }>;`. New: `export type MobDamageHit = Readonly<{ id: EntityId; damage: Damage; killCredit?: Exclude<MobKillCredit, 'player-triggered-tnt'>; lastHitTick?: SimulationTickValue; burning?: boolean; }>;`. |
  |  | `MobFrameSenses` | `readonly dt: DeltaTimeSecs;` becomes `readonly dt: DeltaTimeSecsValue;`. Adds `readonly undeadDaylight?: ReadonlyMap<EntityId, Readonly<{ exposed: boolean; inWater: boolean; }>>;`. |
  |  | `MobKillCredit` | Previous: `export type MobKillCredit = 'player' \| 'player-triggered-tnt';`. New: `export type MobKillCredit = 'player' \| 'player-triggered-tnt' \| 'tamed-wolf';`. |
  |  | `MobRoster` | Previous: `export type MobRoster = Omit<EntityRoster<MobBehaviour>, 'entities'> & Readonly<{ entities: ReadonlyArray<MobEntity>; }>;`. New: `export type MobRoster = Omit<EntityRoster<MobBehaviour>, 'entities'> & Readonly<{ entities: ReadonlyArray<MobEntity>; resolvedMobProjectileIds?: ReadonlyArray<ProjectileId>; pendingMobProjectileImpacts?: ReadonlyArray<MobProjectilePendingImpact>; }>;`. |
  |  | `MobSweep` | Adds `readonly faults: ReadonlyArray<MobFrameRuleFault>;`. |
  |  | `applySpawnAttempts` | Parameters: (`roster: EntityManagerApi<MobBehaviour>, attempts: ReadonlyArray<MobSpawnAttempt>`) to (`roster: EntityManagerApi<MobBehaviour>, attempts: ReadonlyArray<MobSpawnAttempt>, difficulty?: HostileDifficulty`). Return: `Effect.Effect<ReadonlyArray<MobSpawnOutcome>, EntitySerialExhausted>` to `Effect.Effect<ReadonlyArray<MobSpawnOutcome>, EntitySerialExhausted \| HostileSpawnInputFailure>`. |
  |  | `dropRollsNeeded` | Return: `number` to `Result.Result<number, { readonly _tag: "UnknownMobKind"; readonly kind: EntityKind; }>`. |
  |  | `dropRulesOfKind` | Return: `ReadonlyArray<MobDropRule>` to `Result.Result<ReadonlyArray<MobDropRule>, { readonly _tag: "UnknownMobKind"; readonly kind: EntityKind; }>`. |
  |  | `experienceOfCasualties` | Return: `ReadonlyArray<MobExperienceEvent>` to `MobExperienceResolution`. |
  |  | `hostileMobSnapshot` | Parameters: (`behaviour: HostileMobSnapshot["behaviour"], options?: Partial<Omit<HostileMobSnapshot, "_tag" \| "behaviour">>`) to (`behaviour: HostileMobSnapshot["behaviour"], options?: Partial<Omit<HostileMobSnapshot, "_tag" \| "behaviour" \| "movement">> & Readonly<{ movement?: MobMovementState; }>`). |
  |  | `planEndermanTeleportRoster` | Return: `Effect.Effect<MobRoster>` to `Effect.Effect<Readonly<{ roster: MobRoster; faults: ReadonlyArray<EndermanTeleportRosterFault>; }>>`. |
  |  | `planSpawnAttemptsOnRoster` | Parameters: (`initial: EntityRoster<MobBehaviour>, attempts: ReadonlyArray<MobSpawnAttempt>`) to (`initial: EntityRoster<MobBehaviour>, attempts: ReadonlyArray<MobSpawnAttempt>, difficulty?: HostileDifficulty`). Return: `Result.Result<MobSpawnRosterResolution, EntitySerialExhausted>` to `Result.Result<MobSpawnRosterResolution, EntitySerialExhausted \| HostileSpawnInputFailure>`. |
  |  | `resolveBlasts` | Return: `Effect.Effect<BlastResolution>` to `Effect.Effect<BlastResolution, BlockStateCodecFailure \| LightQueueUnderflowError>`. |
  |  | `resolveBowHits` | Return: `Effect.Effect<ReadonlyArray<MobCasualty>>` to `Effect.Effect<ReadonlyArray<MobCasualty>, DamageApplicationFailure>`. |
  |  | `resolveEndermanTeleportProbes` | Return: `Effect.Effect<void>` to `Effect.Effect<ReadonlyArray<EndermanTeleportRosterFault>>`. |
  |  | `rollCasualtyDrops` | Return: `CasualtyDrops` to `Result.Result<CasualtyDrops, FrameRollFailure>`. |
  |  | `rollDropsOfKind` | Return: `ReadonlyArray<MobDrop>` to `Result.Result<ReadonlyArray<MobDrop>, { readonly _tag: "UnknownMobKind"; readonly kind: EntityKind; }>`. |
  |  | `xpRewardOfKind` | Return: `number` to `Result.Result<number, { readonly _tag: "UnknownMobKind"; readonly kind: EntityKind; }>`. |
  | `src/domain/environmental-contact-damage.ts` | `resolveEnvironmentalContactDamage` | Return: `EnvironmentalContactDamageStep` to `Result.Result<EnvironmentalContactDamageStep, EnvironmentalContactDamageFailure>`. |
  | `src/domain/fall-damage.ts` | `resolveFallDamage` | Return: `Damage \| undefined` to `Result.Result<Damage \| undefined, FallDamageInputFailure>`. |
  | `src/domain/fire-lifecycle.ts` | `advanceFireLifecycle` | Previous: `advanceFireLifecycle: (state: FireLifecycleState, cells: ReadonlyArray<FireCell>, weather: Weather, contacted?: ReadonlyArray<FirePosition \| FireActorContact>, difficulty?: SurvivalDifficulty) => FireLifecycleStep`. New: `export declare function advanceFireLifecycle(state: FireLifecycleState, cells: ReadonlyArray<FireCell>, weather: Weather): Result.Result<FireLifecycleStep, FireLifecycleFailure>; export declare function advanceFireLifecycle(state: FireLifecycleState, cells: ReadonlyArray<FireCell>, weather: Weather, contacted: ReadonlyArray<FirePosition \| FireActorContact>, difficulty?: SurvivalDifficulty): Result.Result<FireLifecycleStep, FireLifecycleFailure>;`. |
  |  | `makeFireLifecycleSnapshot` | Return: `FireLifecycleSnapshot` to `Result.Result<FireLifecycleSnapshot, FireLifecycleFailure>`. |
  |  | `makeFireLifecycleState` | Return: `FireLifecycleState` to `Result.Result<FireLifecycleState, FireLifecycleFailure>`. |
  |  | `restoreFireLifecycleSnapshot` | Return: `{ readonly state: FireLifecycleState; readonly tickAccumulatorSecs: number; }` to `Result.Result<{ readonly state: FireLifecycleState; readonly tickAccumulatorSecs: number; }, FireLifecycleFailure>`. |
  | `src/domain/fluid-frontier.ts` | `splitBudget` | Previous: `splitBudget: (frontier: ReadonlyArray<FluidWorkItem>, options: { readonly budget?: number; readonly lavaTickActive: boolean; }) => FluidBudgetSplit`. New: `export declare function splitBudget(frontier: ReadonlyArray<FluidWorkItem>, options: { readonly lavaTickActive: boolean; }): FluidBudgetSplit; export declare function splitBudget(frontier: ReadonlyArray<FluidWorkItem>, options: { readonly budget: number; readonly lavaTickActive: boolean; }): Result.Result<FluidBudgetSplit, FluidBudgetFailure>; export declare function splitBudget(frontier: ReadonlyArray<FluidWorkItem>, options: { readonly budget?: number; readonly lavaTickActive: boolean; }): FluidBudgetSplit \| Result.Result<FluidBudgetSplit, FluidBudgetFailure>;`. |
  | `src/domain/frame-rolls.ts` | `drawRolls` | Return: `RollBatch` to `Result.Result<RollBatch, FrameRollFailure>`. |
  |  | `nextRoll` | Return: `RollDraw` to `Result.Result<RollDraw, FrameRollFailure>`. |
  |  | `normaliseSeed` | Return: `number` to `Result.Result<number, FrameRollFailure>`. |
  |  | `rollAt` | Return: `number` to `Result.Result<number, FrameRollFailure>`. |
  | `src/domain/in-memory-player.ts` | `applyLook` | Return: `PlayerPose` to `Result.Result<PlayerPose, PlayerServiceInputError>`. |
  |  | `clampPitch` | Parameters: (`pitchRadians: number`) to (`pitchRadians: number, reason?: PlayerServiceInputError["reason"]`). Return: `number` to `Result.Result<number, PlayerServiceInputError>`. |
  | `src/domain/in-memory-world.ts` | `makeGeneratedWorld` | Return: `Effect.Effect<GeneratedWorld<S>>` to `Effect.Effect<GeneratedWorld<S>, WorldInputFailure \| ItemStackFailure \| RecipeFailure \| PlayerStorageFailure \| EntitySerialExhausted>`. |
  |  | `makeInMemoryWorld` | Return: `Effect.Effect<InMemoryWorld<S>>` to `Effect.Effect<InMemoryWorld<S>, WorldInputFailure \| ItemStackFailure \| RecipeFailure \| PlayerStorageFailure \| EntitySerialExhausted \| ChunkStoreError>`. |
  |  | `solidityFromStore` | Return: `(position: { readonly x: number; readonly y: number; readonly z: number; }) => boolean` to `(position: { readonly x: number; readonly y: number; readonly z: number; }) => Result.Result<boolean, EntityWorldQueryFailure>`. |
  | `src/domain/interactions/block-loot.ts` | `LEAF_APPLE_DROP_CHANCE` | Previous: `LEAF_APPLE_DROP_CHANCE = 0.005`. New: `LEAF_APPLE_DROP_CHANCE: number`. |
  |  | `blockLoot` | Return: `ReadonlyArray<MinedItem>` to `Result.Result<ReadonlyArray<MinedItem>, BlockLootFailure>`. |
  | `src/domain/interactions/break-block.ts` | `BreakTransactionFailure` | Previous: `export type BreakTransactionFailure = { readonly _tag: 'MissingTransactionContext'; } \| { readonly _tag: 'BlockUnavailable'; readonly reason: 'air' \| 'chunk-not-loaded' \| 'out-of-world'; } \| { readonly _tag: 'ObservationIncomplete'; readonly position: BlockPosition; } \| { readonly _tag: 'ObservationFailed'; readonly error: ObservationFailure; } \| { readonly _tag: 'ObservationChanged'; readonly expectedWorldRevision: WorldRevision; readonly actualWorldRevision: WorldRevision; } \| { readonly _tag: 'ToolDamageRejected'; readonly reason: 'InvalidLocation'; } \| { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError; };`. New: `export type BreakTransactionFailure = { readonly _tag: 'MissingTransactionContext'; } \| { readonly _tag: 'BlockUnavailable'; readonly reason: 'air' \| 'chunk-not-loaded' \| 'out-of-world'; } \| { readonly _tag: 'ObservationIncomplete'; readonly position: BlockPosition; } \| { readonly _tag: 'WorldDataFault'; readonly failure: EntityWorldQueryFailure; } \| { readonly _tag: 'ObservationFailed'; readonly error: ObservationFailure; } \| { readonly _tag: 'ObservationChanged'; readonly expectedWorldRevision: WorldRevision; readonly actualWorldRevision: WorldRevision; } \| { readonly _tag: 'ToolDamageRejected'; readonly reason: 'InvalidLocation'; } \| { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError; };`. |
  |  | `breakBlock` | Previous: `export declare function breakBlock(store: ChunkStoreApi, position: BlockPosition): Effect.Effect<BreakOutcome>; export declare function breakBlock(store: ChunkStoreApi, position: BlockPosition, context: undefined): Effect.Effect<BreakTransactionResult>; export declare function breakBlock(store: ChunkStoreApi, position: BlockPosition, context: BreakTransactionContext): Effect.Effect<BreakTransactionResult>;`. New: `export declare function breakBlock(store: ChunkStoreApi, position: BlockPosition): Effect.Effect<BreakOutcome, BlockStateCodecFailure \| LightQueueUnderflowError>; export declare function breakBlock(store: ChunkStoreApi, position: BlockPosition, context: undefined): Effect.Effect<BreakTransactionResult>; export declare function breakBlock(store: ChunkStoreApi, position: BlockPosition, context: BreakTransactionContext): Effect.Effect<BreakTransactionResult>;`. |
  | `src/domain/interactions/eat-food.ts` | `resolveFoodUse` | Return: `FoodUseOutcome` to `Result.Result<FoodUseOutcome, InvalidFoodItemId>`. |
  | `src/domain/interactions/explosion-crater.ts` | `carveExplosionCrater` | Return: `Effect.Effect<ReadonlyArray<BlockPositionKey>>` to `Effect.Effect<ReadonlyArray<BlockPositionKey>, BlockStateCodecFailure \| LightQueueUnderflowError>`. |
  | `src/domain/interactions/ignite-fire.ts` | `IgniteFireCommitContext` | `readonly expectedRevision?: WorldRevision;` becomes `readonly expectedRevision?: WorldRevision \| undefined;`. `readonly expectedDimensionRevision?: DimensionRevision;` becomes `readonly expectedDimensionRevision?: DimensionRevision \| undefined;`. |
  |  | `IgniteFireOutcome` | Previous: `export type IgniteFireOutcome = { readonly _tag: 'Lit'; readonly position: BlockPosition; } \| { readonly _tag: 'Occupied'; readonly existing: BlockId; } \| { readonly _tag: 'ChunkNotLoaded'; } \| { readonly _tag: 'OutOfWorld'; } \| { readonly _tag: 'CommitContextMissing'; } \| { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError; };`. New: `export type IgniteFireOutcome = { readonly _tag: 'Lit'; readonly position: BlockPosition; } \| { readonly _tag: 'Occupied'; readonly existing: BlockId; } \| { readonly _tag: 'ChunkNotLoaded'; } \| { readonly _tag: 'OutOfWorld'; } \| { readonly _tag: 'CommitContextMissing'; } \| { readonly _tag: 'InvalidCommitContext'; readonly field: 'expectedRevision' \| 'expectedDimensionRevision'; } \| { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError; };`. |
  | `src/domain/interactions/ignite-tnt.ts` | `igniteTnt` | Return: `Effect.Effect<IgniteTntOutcome>` to `Effect.Effect<IgniteTntOutcome, BlockStateCodecFailure \| LightQueueUnderflowError>`. |
  | `src/domain/interactions/knockback.ts` | `knockbackDirection` | Return: `KnockbackDirection` to `Result.Result<KnockbackDirection, KnockbackPreparationError>`. |
  | `src/domain/interactions/melee-attack.ts` | `MeleeAttackPreparation` | Previous: `export type MeleeAttackPreparation = Readonly<{ target: ShotHit; event: DomainEvent; }>;`. New: `export type MeleeAttackPreparation = Readonly<{ target: ShotHit; event: MeleeAttackDamageEvent; knockback: KnockbackDirection; targetDamageState: DamageImmunityState; }>;`. |
  |  | `MeleeAttackPreparationError` | Previous: `export type MeleeAttackPreparationError = 'invalid-intent' \| 'invalid-authoritative-state' \| 'no-target';`. New: `export type MeleeAttackPreparationError = 'invalid-intent' \| 'invalid-authoritative-state' \| 'invalid-attack-timing' \| 'target-invulnerable' \| 'no-target' \| MeleeTargetInputFailure;`. |
  |  | `meleeDamageForItem` | Return: `number` to `Result.Result<number, "invalid-input">`. |
  |  | `meleeTarget` | Return: `ShotHit \| undefined` to `Result.Result<ShotHit \| undefined, MeleeTargetInputFailure>`. |
  |  | `meleeTargetBeforeBlock` | Return: `ShotHit \| undefined` to `Result.Result<ShotHit \| undefined, MeleeTargetInputFailure>`. |
  |  | `prepareMeleeAttack` | Parameters: (`intent: MeleeAttackIntent, input: Readonly<{ tick: SimulationTick; dimension: Dimension; pose: PlayerPose; entities: ReadonlyArray<Entity<MobBehaviour>>; heldItem: ItemType \| null; critical: boolean; blockDistance?: AttackRangeDistance; }>`) to (`intent: MeleeAttackIntent, input: Readonly<{ tick: SimulationTick; dimension: Dimension; pose: PlayerPose; entities: ReadonlyArray<Entity<MobBehaviour>>; heldItem: ItemType \| null; critical: boolean; ticksSinceLastAttack: MeleeCooldownTicks; targetDamageState: DamageImmunityState \| null; blockDistance?: AttackRangeDistance; }>`). |
  | `src/domain/interactions/mining-progress.ts` | `effectiveMiningSpeed` | Return: `number` to `Result.Result<number, EffectiveMiningSpeedError>`. |
  | `src/domain/interactions/place-block.ts` | `PlaceOutcome` | Previous: `export type PlaceOutcome = { readonly _tag: 'Placed'; readonly block: BlockId; readonly consumed: PlaceableItemType; readonly chunk: ChunkCoord; readonly alsoPlaced: ReadonlyArray<BlockPosition>; } \| { readonly _tag: 'Occupied'; readonly existing: BlockId; } \| { readonly _tag: 'InsidePlayer'; } \| { readonly _tag: 'Unsupported'; readonly support: BlockId; } \| { readonly _tag: 'ChunkNotLoaded'; } \| { readonly _tag: 'OutOfWorld'; } \| MushroomLightRefusal \| SugarCaneWaterRefusal \| CactusSidesRefusal \| { readonly _tag: 'NoRoomAbove'; };`. New: `export type PlaceOutcome = { readonly _tag: 'WorldDataFault'; readonly failure: EntityWorldQueryFailure; } \| { readonly _tag: 'Placed'; readonly block: BlockId; readonly consumed: PlaceableItemType; readonly chunk: ChunkCoord; readonly alsoPlaced: ReadonlyArray<BlockPosition>; } \| { readonly _tag: 'Occupied'; readonly existing: BlockId; } \| { readonly _tag: 'InsidePlayer'; } \| { readonly _tag: 'Unsupported'; readonly support: BlockId; } \| { readonly _tag: 'ChunkNotLoaded'; } \| { readonly _tag: 'OutOfWorld'; } \| MushroomLightRefusal \| SugarCaneWaterRefusal \| CactusSidesRefusal \| { readonly _tag: 'NoRoomAbove'; };`. |
  |  | `placeBlock` | Return: `Effect.Effect<PlaceOutcome>` to `Effect.Effect<PlaceOutcome, BlockStateCodecFailure \| LightQueueUnderflowError>`. |
  |  | `planPlaceBlock` | Return: `Effect.Effect<PlaceBlockPlan>` to `Effect.Effect<PlaceBlockPlan, LightQueueUnderflowError>`. |
  | `src/domain/interactions/place-cactus-sides.ts` | `CACTUS_BLOCK_ID` | Previous: `CACTUS_BLOCK_ID: BlockId \| undefined`. New: `CACTUS_BLOCK_ID: BlockId`. |
  |  | `CactusSidesRefusal` | Previous: `export type CactusSidesRefusal = { readonly _tag: 'SidesBlocked'; };`. New: `export type CactusSidesRefusal = { readonly _tag: 'SidesBlocked'; } \| { readonly _tag: 'WorldDataFault'; readonly failure: EntityWorldQueryFailure; };`. |
  | `src/domain/interactions/place-door-upper.ts` | `DOOR_BLOCK_ID` | Previous: `DOOR_BLOCK_ID: BlockId \| undefined`. New: `DOOR_BLOCK_ID: BlockId`. |
  |  | `DoorUpperBreakCell` | Previous: `export type DoorUpperBreakCell = { readonly _tag: 'NotADoor'; } \| { readonly _tag: 'NoDoorAbove'; } \| { readonly _tag: 'DoorAbove'; readonly cell: BlockPosition; };`. New: `export type DoorUpperBreakCell = { readonly _tag: 'NotADoor'; } \| { readonly _tag: 'NoDoorAbove'; } \| { readonly _tag: 'DoorAbove'; readonly cell: BlockPosition; } \| { readonly _tag: 'WorldDataFault'; readonly failure: EntityWorldQueryFailure; };`. |
  |  | `DoorUpperCell` | Previous: `export type DoorUpperCell = { readonly _tag: 'NotADoor'; } \| { readonly _tag: 'Clear'; readonly cell: BlockPosition; } \| { readonly _tag: 'NoRoomAbove'; };`. New: `export type DoorUpperCell = { readonly _tag: 'NotADoor'; } \| { readonly _tag: 'Clear'; readonly cell: BlockPosition; } \| { readonly _tag: 'NoRoomAbove'; } \| { readonly _tag: 'WorldDataFault'; readonly failure: EntityWorldQueryFailure; };`. |
  | `src/domain/interactions/place-mushroom-light.ts` | `BROWN_MUSHROOM_BLOCK_ID` | Previous: `BROWN_MUSHROOM_BLOCK_ID: BlockId \| undefined`. New: `BROWN_MUSHROOM_BLOCK_ID: BlockId`. |
  |  | `RED_MUSHROOM_BLOCK_ID` | Previous: `RED_MUSHROOM_BLOCK_ID: BlockId \| undefined`. New: `RED_MUSHROOM_BLOCK_ID: BlockId`. |
  |  | `mushroomLightObjection` | Return: `Effect.Effect<MushroomLightRefusal \| undefined>` to `Effect.Effect<MushroomLightRefusal \| undefined, LightQueueUnderflowError>`. |
  | `src/domain/interactions/place-sugar-cane-water.ts` | `SUGAR_CANE_BLOCK_ID` | Previous: `SUGAR_CANE_BLOCK_ID: BlockId \| undefined`. New: `SUGAR_CANE_BLOCK_ID: BlockId`. |
  |  | `SugarCaneWaterRefusal` | Previous: `export type SugarCaneWaterRefusal = { readonly _tag: 'NoAdjacentWater'; };`. New: `export type SugarCaneWaterRefusal = { readonly _tag: 'NoAdjacentWater'; } \| { readonly _tag: 'WorldDataFault'; readonly failure: EntityWorldQueryFailure; };`. |
  | `src/domain/interactions/plant-crop.ts` | `PlantOutcome` | Previous: `export type PlantOutcome = { readonly _tag: 'planted'; readonly crop: CropBlock; readonly at: BlockPosition; } \| { readonly _tag: 'cropOwnerMismatch'; readonly crop: CropBlock; readonly at: BlockPosition; } \| { readonly _tag: 'notASeed'; readonly held: ItemType; } \| { readonly _tag: 'wrongSoil'; readonly crop: BlockType; readonly needs: BlockType; readonly found: BlockType; } \| { readonly _tag: 'occupied'; readonly crop: BlockType; readonly blockedBy: BlockType; } \| { readonly _tag: 'invalidPosition'; } \| { readonly _tag: 'commitContextMissing'; } \| { readonly _tag: 'commitFailed'; readonly error: Schema.SchemaError \| WorldCommitCoordinatorError; };`. New: `export type PlantOutcome = { readonly _tag: 'planted'; readonly crop: CropBlock; readonly at: BlockPosition; } \| { readonly _tag: 'cropOwnerMismatch'; readonly crop: CropBlock; readonly at: BlockPosition; } \| { readonly _tag: 'notASeed'; readonly held: ItemType; } \| { readonly _tag: 'wrongSoil'; readonly crop: BlockType; readonly needs: BlockType; readonly found: BlockType; } \| { readonly _tag: 'worldUnavailable'; readonly cell: 'soil' \| 'above'; } \| { readonly _tag: 'occupied'; readonly crop: BlockType; readonly blockedBy: BlockType; } \| { readonly _tag: 'invalidPosition'; } \| { readonly _tag: 'commitContextMissing'; } \| { readonly _tag: 'commitFailed'; readonly error: Schema.SchemaError \| WorldCommitCoordinatorError; };`. |
  |  | `plantCrop` | Return: `Effect.Effect<PlantOutcome>` to `Effect.Effect<PlantOutcome, PlantWorldDataFailure>`. |
  | `src/domain/interactions/till-soil.ts` | `TillOutcome` | Previous: `export type TillOutcome = { readonly _tag: 'tilled'; readonly at: BlockPosition; } \| { readonly _tag: 'noHoe'; } \| { readonly _tag: 'notTillable'; readonly found: BlockType; } \| { readonly _tag: 'obstructed'; readonly blockedBy: BlockType; } \| { readonly _tag: 'invalidPosition'; } \| { readonly _tag: 'commitContextMissing'; } \| { readonly _tag: 'commitFailed'; readonly error: Schema.SchemaError \| WorldCommitCoordinatorError; };`. New: `export type TillOutcome = { readonly _tag: 'tilled'; readonly at: BlockPosition; } \| { readonly _tag: 'noHoe'; } \| { readonly _tag: 'notTillable'; readonly found: BlockType; } \| { readonly _tag: 'worldUnavailable'; readonly cell: 'ground' \| 'above'; } \| { readonly _tag: 'obstructed'; readonly blockedBy: BlockType; } \| { readonly _tag: 'invalidPosition'; } \| { readonly _tag: 'commitContextMissing'; } \| { readonly _tag: 'commitFailed'; readonly error: Schema.SchemaError \| WorldCommitCoordinatorError; };`. |
  |  | `tillSoil` | Return: `Effect.Effect<TillOutcome>` to `Effect.Effect<TillOutcome, TillWorldDataFailure>`. |
  | `src/domain/interactions/use-flint-and-steel.ts` | `useFlintAndSteel` | Return: `Effect.Effect<IgnitionOutcome>` to `Effect.Effect<IgnitionOutcome, BlockStateCodecFailure \| LightQueueUnderflowError>`. |
  | `src/domain/mob/explosion.ts` | `explosionDamageAmount` | Parameters: (`power: number, distanceToCentre: number, exposure?: number`) to (`power: number, distanceToCentre: number, ...exposureInput: readonly [ ] \| readonly [ number ]`). Return: `number` to `Result.Result<number, ExplosionInputFailure>`. |
  |  | `explosionDamageAt` | Parameters: (`explosion: Explosion, distanceToCentre: number, exposure?: number`) to (`explosion: Explosion, distanceToCentre: number, ...exposureInput: readonly [ ] \| readonly [ number ]`). Return: `Damage` to `Result.Result<Damage, ExplosionInputFailure>`. |
  |  | `explosionRadius` | Return: `number` to `Result.Result<number, ExplosionInputFailure>`. |
  | `src/domain/mob/hostile-combat.ts` | `HostileContactResolution` | `readonly damages: ReadonlyArray<PlayerDamageEvent>;` becomes `readonly damages: ReadonlyArray<HostileContactDamageEvent>;`. `readonly cooldowns: ReadonlyMap<EntityId, number>;` becomes `readonly cooldowns: ReadonlyMap<EntityId, SimulationTick>;`. |
  |  | `prepareShieldBlocking` | Parameters: (`intent: ShieldBlockingIntent, input: Readonly<{ tick: SimulationTick; dimension: Dimension; pose: PlayerPose; hasShield: boolean; current: ShieldBlockingState \| null; incoming?: ShieldIncomingAttackInput; }>`) to (`intent: ShieldBlockingIntent, input: Readonly<{ tick: SimulationTick; dimension: Dimension; pose: unknown; hasShield: boolean; current: ShieldBlockingState \| null; incoming?: ShieldIncomingAttackInput; }>`). |
  |  | `pursueHorizontally` | Return: `Position` to `Result.Result<Position, PursueHorizontallyFailure>`. |
  |  | `resolveHostileContacts` | Parameters: (`entities: ReadonlyArray<Entity<S>>, target: Position \| undefined, dt: number, previousCooldowns: ReadonlyMap<EntityId, number>`) to (`entities: ReadonlyArray<Entity<S>>, target: Position \| undefined, tick: SimulationTick, previousCooldowns: ReadonlyMap<EntityId, SimulationTick>, ...difficultyInput: readonly [ ] \| readonly [ SurvivalDifficulty ]`). Return: `HostileContactResolution` to `Result.Result<HostileContactResolution, HostileContactResolutionError>`. |
  |  | `resolvePlayerBlastDamage` | Parameters: (`blasts: ReadonlyArray<PlayerBlast>, target: Position \| undefined`) to (`blasts: ReadonlyArray<PlayerBlast>, target: Position \| undefined, ...difficultyInput: readonly [ ] \| readonly [ SurvivalDifficulty ]`). Return: `ReadonlyArray<PlayerDamageEvent>` to `Result.Result<ReadonlyArray<PlayerExplosionDamageEvent>, PlayerBlastDamageFailure>`. |
  | `src/domain/mob/hostile-despawn.ts` | `DespawnReason` | Previous: `export type DespawnReason = 'too-far' \| 'unmeasurable' \| 'peaceful' \| 'natural';`. New: `export type DespawnReason = 'too-far' \| 'peaceful' \| 'natural';`. |
  |  | `despawnVerdict` | Return: `DespawnVerdict` to `Result.Result<DespawnVerdict, DespawnVerdictFailure>`. |
  | `src/domain/mob/hostile-spawn.ts` | `HOSTILE_SPAWN_MAX_BLOCK_LIGHT` | Previous: `HOSTILE_SPAWN_MAX_BLOCK_LIGHT = 7`. New: `HOSTILE_SPAWN_MAX_BLOCK_LIGHT = 0`. |
  |  | `MIN_SPAWN_DISTANCE_BLOCKS` | Previous: `MIN_SPAWN_DISTANCE_BLOCKS = 16`. New: `MIN_SPAWN_DISTANCE_BLOCKS = 24`. |
  |  | `SpawnCandidate` | Adds `readonly skyLight: SkyLightLevel;`. Adds `readonly biome: ChunkBiomeType;`. |
  |  | `SpawnRefusal` | Previous: `export type SpawnRefusal = 'daylight' \| 'too-close' \| 'too-far' \| 'not-a-surface' \| 'obstructed' \| 'too-bright' \| 'unmeasurable' \| 'wrong-dimension';`. New: `export type SpawnRefusal = 'daylight' \| 'too-close' \| 'too-far' \| 'not-a-surface' \| 'obstructed' \| 'too-bright' \| 'unmeasurable' \| 'wrong-dimension' \| 'wrong-biome';`. |
  |  | `canHostileSpawnAt` | Return: `SpawnVerdict` to `SpawnVerdict \| HostileSpawnInputFailure`. |
  |  | `canMobSpawnAt` | Return: `SpawnVerdict` to `SpawnVerdict \| HostileSpawnInputFailure`. |
  | `src/domain/mob/mob-drop.ts` | `MobDropRule` | Adds `readonly playerKillOnly?: boolean;`. Adds `readonly adultOnly?: boolean;`. Adds `readonly babyOnly?: boolean;`. Adds `readonly burningItem?: ItemType;`. Adds `readonly size?: MobSize;`. Adds `readonly minimumSize?: MobSize;`. Adds `readonly chargedCreeperOnly?: boolean;`. |
  |  | `MobKill` | Previous: `export type MobKill = { readonly _tag: 'Slain'; readonly lootingLevel: number; } \| { readonly _tag: 'SelfDestruct'; };`. New: `export type MobKill = { readonly _tag: 'Slain'; readonly lootingLevel: number; readonly playerKill?: boolean; readonly age?: MobAge; readonly size?: MobSize; readonly burning?: boolean; readonly killedByChargedCreeper?: boolean; } \| { readonly _tag: 'SelfDestruct'; };`. |
  |  | `mobXpReward` | Parameters: (`kill: MobKill, reward: number`) to (`kill: MobKill, reward: number \| MobExperienceRule, roll?: number, context?: MobExperienceContext`). |
  | `src/domain/mob/mob-ecosystem.ts` | `EcosystemMobState` | Removes `readonly attackCooldownSecs: number;`. Adds `readonly attackCooldownTicks: number;`. Adds `readonly movementGoal?: Position;`. Adds `readonly movement?: MobMovementState;`. Adds `readonly hasHeadProtection: boolean;`. Adds `readonly burningTicks: NonNegativeTickCount;`. |
  |  | `NETHER_HOSTILE_KINDS` | Previous: `NETHER_HOSTILE_KINDS: readonly [ EntityKind, EntityKind ]`. New: `NETHER_HOSTILE_KINDS: readonly [ EntityKind, EntityKind, EntityKind ]`. |
  |  | `repairEcosystemMobState` | Parameters: (`value: unknown`) to (`value: unknown, fieldPresent?: boolean`). Return: `EcosystemMobState \| undefined` to `Result.Result<EcosystemMobState \| undefined, MobStateRepairFailure>`. |
  | `src/domain/status-effect.ts` | `tickStatusEffects` | Parameters: (`state: StatusEffectState, dt: DeltaTimeSecs`) to (`state: StatusEffectState, dt: DeltaTimeSecsValue`). Return: `StatusEffectTick` to `Result.Result<StatusEffectTick, Brand.BrandError>`. |
  | `src/domain/survival-hunger.ts` | `SURVIVAL_EXHAUSTION` | Previous: `SURVIVAL_EXHAUSTION: { readonly walkPerBlock: 0.01; readonly sprintPerBlock: 0.1; readonly jump: 0.05; readonly sprintJump: 0.2; readonly swimPerBlock: 0.01; readonly minePerBlock: 0.005; readonly attack: 0.1; }`. New: `SURVIVAL_EXHAUSTION: { readonly walkPerBlock: 0; readonly sprintPerBlock: 0.1; readonly jump: 0.05; readonly sprintJump: 0.2; readonly swimPerBlock: 0.01; readonly minePerBlock: 0.005; readonly attack: 0.1; }`. |
  |  | `SurvivalHungerError` | Previous: `export type SurvivalHungerError = Brand.BrandError \| Schema.SchemaError \| WorldCommitCoordinatorError;`. New: `export type SurvivalHungerError = SurvivalActivityInputFailure \| Brand.BrandError \| Schema.SchemaError \| WorldCommitCoordinatorError;`. |
  |  | `SurvivalHungerRuntimeApi` | `readonly submit: (input: SurvivalActivityInput) => Effect.Effect<void>;` becomes `readonly submit: (input: SurvivalActivityInput) => Effect.Effect<void, SurvivalActivityInputFailure>;`. `readonly setDifficulty: (difficulty: SurvivalDifficulty) => Effect.Effect<void>;` becomes `readonly setDifficulty: (difficulty: SurvivalDifficulty) => Effect.Effect<void, SurvivalHungerError>;`. |
  |  | `exhaustionForSurvivalActivity` | Parameters: (`input: SurvivalActivityInput`) to (`input: unknown`). Return: `number` to `Result.Result<number, SurvivalActivityInputFailure>`. |
  |  | `makeReplicatedSurvivalHungerRuntime` | Previous: `makeReplicatedSurvivalHungerRuntime: (coordinator: WorldCommitCoordinatorApi, ownerId: ReplicatedOwnerId, initialDifficulty?: SurvivalDifficulty) => Effect.Effect<SurvivalHungerRuntimeApi>`. New: `export declare function makeReplicatedSurvivalHungerRuntime(coordinator: WorldCommitCoordinatorApi, ownerId: ReplicatedOwnerId): Effect.Effect<SurvivalHungerRuntimeApi>; export declare function makeReplicatedSurvivalHungerRuntime(coordinator: WorldCommitCoordinatorApi, ownerId: ReplicatedOwnerId, initialDifficulty: SurvivalDifficulty): Effect.Effect<SurvivalHungerRuntimeApi, SurvivalHungerError>;`. |
  |  | `makeSurvivalHungerRuntime` | Previous: `makeSurvivalHungerRuntime: (initial?: SurvivalHungerState) => Effect.Effect<SurvivalHungerRuntimeApi>`. New: `export declare function makeSurvivalHungerRuntime(): Effect.Effect<SurvivalHungerRuntimeApi>; export declare function makeSurvivalHungerRuntime(initial: SurvivalHungerState): Effect.Effect<SurvivalHungerRuntimeApi, SurvivalHungerError>;`. |
  | `src/domain/vehicle/rail-shape.ts` | `projectMinecartVelocity` | Return: `{ readonly vx: number; readonly vz: number; }` to `Result.Result<{ readonly vx: number; readonly vz: number; }, RailShapeFailure>`. |
  |  | `resolveRailShape` | Return: `RailShape` to `Result.Result<RailShape, RailShapeFailure>`. |
  | `src/domain/vehicle/vehicle-frame.ts` | `advanceVehicles` | Return: `Effect.Effect<void>` to `Effect.Effect<ReadonlyArray<VehicleFrameFailure>>`. |
  | `src/domain/vehicle/vehicle-motion.ts` | `stepBoat` | Return: `VehicleTransition` to `Result.Result<VehicleTransition, VehicleMotionFailure>`. |
  |  | `stepMinecart` | Return: `VehicleTransition` to `Result.Result<VehicleTransition, VehicleMotionFailure>`. |
  | `src/domain/weather.ts` | `advanceWeather` | Return: `WeatherState` to `Result.Result<WeatherState, WeatherInputFailure>`. |
  |  | `applyWeatherState` | Parameters: (`current: WeatherState, candidate: unknown`) to (`candidate: unknown`). Return: `WeatherState` to `Result.Result<WeatherState, "invalid-weather-state">`. |
  |  | `createWeatherState` | Return: `WeatherState` to `Result.Result<WeatherState, WeatherInputFailure>`. |
  |  | `resolveNextWeatherState` | Return: `WeatherState` to `Result.Result<WeatherState, WeatherInputFailure>`. |
  |  | `resolveWeatherDurationSecs` | Return: `number` to `Result.Result<number, WeatherInputFailure>`. |
  |  | `weatherExpires` | Return: `boolean` to `Result.Result<boolean, WeatherInputFailure>`. |
  | `src/stages/gameplay-owner-registrations.ts` | `GameplayEntityRoster` | Previous: `export type GameplayEntityRoster = Omit<EntityRoster<MobBehaviour>, 'entities'> & Readonly<{ entities: ReadonlyArray<GameplayEntity>; }>;`. New: `export type GameplayEntityRoster = Omit<EntityRoster<MobBehaviour>, 'entities'> & Readonly<{ entities: ReadonlyArray<GameplayEntity>; resolvedMobProjectileIds?: ReadonlyArray<ProjectileId>; pendingMobProjectileImpacts?: ReadonlyArray<MobProjectilePendingImpact>; }>;`. |
  |  | `gameplayOwnerRegistrations` | Previous: `gameplayOwnerRegistrations: (initial?: GameplayOwnerInitialState) => ReadonlyArray<ReplicatedOwnerRegistration>`. New: `export declare function gameplayOwnerRegistrations(): ReadonlyArray<ReplicatedOwnerRegistration>; export declare function gameplayOwnerRegistrations(initial: GameplayOwnerInitialState \| undefined): Result.Result<ReadonlyArray<ReplicatedOwnerRegistration>, GameplayOwnerRegistrationFailure>;`. |
  |  | `restoreGameplayEntityMetadata` | Parameters: (`roster: MobRoster, previous: MobRoster, fallbackDimension: Dimension`) to (`roster: MobRoster & Readonly<{ resolvedMobProjectileIds?: ReadonlyArray<ProjectileId>; pendingMobProjectileImpacts?: ReadonlyArray<MobProjectilePendingImpact>; }>, previous: MobRoster & Readonly<{ resolvedMobProjectileIds?: ReadonlyArray<ProjectileId>; pendingMobProjectileImpacts?: ReadonlyArray<MobProjectilePendingImpact>; }>, fallbackDimension: Dimension`). Return: `GameplayEntityRoster` to `Result.Result<GameplayEntityRoster, GameplayEntityMetadataFailure>`. |
  | `src/stages/registration-core.ts` | `BlockPlacementCommandOutcome` | Previous: `export type BlockPlacementCommandOutcome = PlaceOutcome \| { readonly _tag: 'InventoryUnavailable'; } \| { readonly _tag: 'RequestIdConflict'; } \| { readonly _tag: 'PlayerDead'; } \| { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError \| Schema.SchemaError; } \| { readonly _tag: 'Unsupported'; readonly reason: 'WorldCommitCoordinatorUnavailable' \| 'OwnerRegistrationUnavailable'; };`. New: `export type BlockPlacementCommandOutcome = PlaceOutcome \| { readonly _tag: 'WorldDataFailed'; readonly reason: LightQueueUnderflowError; } \| { readonly _tag: 'InventoryUnavailable'; } \| { readonly _tag: 'InvalidPosition'; } \| { readonly _tag: 'RequestIdConflict'; } \| { readonly _tag: 'PlayerDead'; } \| { readonly _tag: 'CommitFailed'; readonly error: WorldCommitCoordinatorError \| Schema.SchemaError; } \| { readonly _tag: 'Unsupported'; readonly reason: 'WorldCommitCoordinatorUnavailable' \| 'OwnerRegistrationUnavailable'; };`. |
  |  | `FarmingItemUseResult` | Previous: `export type FarmingItemUseResult = { readonly action: 'TillSoil'; readonly requestId: ItemUseRequestId; readonly heldItem: HoeItemType; readonly success: boolean; readonly durabilityDamage: 0 \| 1; readonly outcome: TillOutcome; } \| { readonly action: 'ApplyBoneMeal'; readonly requestId: ItemUseRequestId; readonly heldItem: 'bone_meal'; readonly success: boolean; readonly consumedCount: 0 \| 1; readonly outcome: BoneMealOutcome; } \| { readonly action: 'PlantPotato'; readonly requestId: ItemUseRequestId; readonly heldItem: 'potato'; readonly success: boolean; readonly consumedCount: 0 \| 1; readonly outcome: PlantOutcome; } \| { readonly action: 'HarvestPotato'; readonly requestId: ItemUseRequestId; readonly positionKey: BlockPositionKey; readonly success: boolean; readonly outcome: CropDropOutcome; } \| { readonly action: 'EatPotato'; readonly requestId: ItemUseRequestId; readonly heldItem: 'potato'; readonly success: boolean; readonly consumedCount: 0 \| 1; readonly outcome: FoodUseOutcome \| { readonly _tag: 'missingItem'; }; } \| { readonly action: 'EatFood'; readonly requestId: ItemUseRequestId; readonly heldItem: ItemType; readonly success: boolean; readonly consumedCount: 0 \| 1; readonly outcome: FoodUseOutcome \| { readonly _tag: 'missingItem'; }; };`. New: `export type FarmingItemUseResult = { readonly action: 'TillSoil'; readonly requestId: ItemUseRequestId; readonly heldItem: HoeItemType; readonly success: boolean; readonly durabilityDamage: 0 \| 1; readonly outcome: TillOutcome \| GameplayStageItemUseWorldFailure \| ItemUseWorldReadRefusal; } \| { readonly action: 'ApplyBoneMeal'; readonly requestId: ItemUseRequestId; readonly heldItem: 'bone_meal'; readonly success: boolean; readonly consumedCount: 0 \| 1; readonly outcome: BoneMealOutcome \| GameplayStageItemUseWorldFailure \| ItemUseWorldReadRefusal; } \| { readonly action: 'PlantPotato'; readonly requestId: ItemUseRequestId; readonly heldItem: 'potato'; readonly success: boolean; readonly consumedCount: 0 \| 1; readonly outcome: PlantOutcome \| GameplayStageItemUseWorldFailure \| ItemUseWorldReadRefusal; } \| { readonly action: 'HarvestPotato'; readonly requestId: ItemUseRequestId; readonly positionKey: BlockPositionKey; readonly success: boolean; readonly outcome: CropDropOutcome \| GameplayStageItemUseWorldFailure \| ItemUseWorldReadRefusal; } \| { readonly action: 'EatPotato'; readonly requestId: ItemUseRequestId; readonly heldItem: 'potato'; readonly success: boolean; readonly consumedCount: 0 \| 1; readonly outcome: FoodUseOutcome \| InvalidFoodItemId \| { readonly _tag: 'missingItem'; }; } \| { readonly action: 'EatFood'; readonly requestId: ItemUseRequestId; readonly heldItem: ItemType; readonly success: boolean; readonly consumedCount: 0 \| 1; readonly outcome: FoodUseOutcome \| InvalidFoodItemId \| { readonly _tag: 'missingItem'; }; };`. |
  |  | `GameplayFrameState` | `readonly hostileContactCooldowns: Ref.Ref<ReadonlyMap<EntityId, number>>;` becomes `readonly hostileContactCooldowns: Ref.Ref<ReadonlyMap<EntityId, SimulationTick>>;`. Removes `readonly spawnClockSecs: Ref.Ref<number>;`. Adds `readonly entityStageFaults: Ref.Ref<Readonly<{ pending: ReadonlyArray<EntityStageFault>; seen: ReadonlySet<GameplayEntityStageFaultKey>; }>>;`. Adds `readonly nextTargetedMeleeRequestId: Ref.Ref<number>;`. Adds `readonly pendingShieldBlocking: Ref.Ref<ReadonlyArray<ShieldBlockingIntent>>;`. Adds `readonly shieldBlocking: Ref.Ref<ShieldBlockingState \| null>;`. Adds `readonly damageImmunity: Ref.Ref<DamageImmunityState \| null>;`. Adds `readonly meleeLastAttackTick: Ref.Ref<SimulationTick \| null>;`. Adds `readonly meleeTargetDamageStates: Ref.Ref<ReadonlyMap<EntityId, DamageImmunityState>>;`. Adds `readonly lastHostileSpawnTick: Ref.Ref<SimulationTick>;`. Adds `readonly lastPassiveSpawnTick: Ref.Ref<number>;`. Adds `readonly passiveInitialSpawnPending: Ref.Ref<boolean>;`. |
  |  | `GameplayMeleeAttackResult` | Previous: `export type GameplayMeleeAttackResult = ResolvedMeleeAttackResult \| { readonly requestId: string; readonly success: false; readonly outcome: 'PlayerDead'; };`. New: `export type GameplayMeleeAttackResult = ResolvedMeleeAttackResult \| { readonly requestId: string; readonly success: false; readonly outcome: 'InvalidToolLocation' \| 'PlayerDead'; };`. |
  |  | `HOSTILE_SPAWN_INTERVAL_SECS` | Previous: `HOSTILE_SPAWN_INTERVAL_SECS = 0.3`. New: `HOSTILE_SPAWN_INTERVAL_SECS: number`. |
  |  | `TargetedPrimaryAttackResult` | Previous: `export type TargetedPrimaryAttackResult = { readonly _tag: 'Melee'; readonly target: ShotHit; } \| { readonly _tag: 'Block'; readonly target: BlockTarget; } \| { readonly _tag: 'None'; };`. New: `export type TargetedPrimaryAttackResult = { readonly _tag: 'Melee'; readonly target: ShotHit; readonly requestId: string; } \| { readonly _tag: 'Block'; readonly target: BlockTarget; } \| { readonly _tag: 'None'; };`. |
  |  | `requestTargetedBlockPlacement` | Return: `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError>` to `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError \| CameraPoseError \| RangeError \| BlockTargetInputError>`. |
  |  | `requestTargetedBlockUse` | Return: `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError>` to `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError \| CameraPoseError \| RangeError \| BlockTargetInputError>`. |
  |  | `requestTargetedItemUse` | Return: `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError>` to `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError \| CameraPoseError \| RangeError \| BlockTargetInputError>`. |
  |  | `requestTargetedPotatoPlanting` | Return: `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError>` to `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError \| CameraPoseError \| RangeError \| BlockTargetInputError>`. |
  |  | `requestTargetedPrimaryAttack` | Return: `Effect.Effect<TargetedPrimaryAttackResult, CameraPoseError \| RangeError \| BlockTargetInputError \| WorldCommitCoordinatorError \| Schema.SchemaError>` to `Effect.Effect<TargetedPrimaryAttackResult, CameraPoseError \| RangeError \| BlockTargetInputError \| MeleeTargetInputFailure \| WorldCommitCoordinatorError \| Schema.SchemaError>`. |
  |  | `requestTargetedSoilTill` | Return: `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError>` to `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError \| CameraPoseError \| RangeError \| BlockTargetInputError>`. |
  |  | `resolveArmoredPlayerDamages` | Return: `Effect.Effect<ReadonlyArray<PlayerDamageEvent>>` to `Effect.Effect<ReadonlyArray<PlayerDamageEvent>, "invalid-damage" \| "invalid-armor">`. |
  |  | `resolveTargetedBlock` | Return: `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError>` to `Effect.Effect<Option.Option<BlockTarget>, WorldCommitCoordinatorError \| Schema.SchemaError \| CameraPoseError \| RangeError \| BlockTargetInputError>`. |
  |  | `resolveTargetedPrimaryAttack` | Return: `Effect.Effect<TargetedPrimaryAttackResolution, CameraPoseError \| RangeError \| BlockTargetInputError \| WorldCommitCoordinatorError \| Schema.SchemaError>` to `Effect.Effect<TargetedPrimaryAttackResolution, CameraPoseError \| RangeError \| BlockTargetInputError \| MeleeTargetInputFailure \| WorldCommitCoordinatorError \| Schema.SchemaError>`. |
  |  | `restoreFireLifecycle` | Return: `Effect.Effect<void>` to `Effect.Effect<void, FireLifecycleFailure>`. |
  |  | `snapshotFireLifecycle` | Return: `Effect.Effect<FireLifecycleSnapshot>` to `Effect.Effect<FireLifecycleSnapshot, FireLifecycleFailure>`. |
  | `src/stages/targeted-right-click-route.ts` | `targetedRightClickRoute` | Parameters: (`store: ChunkStoreApi, pose: PlayerPose, maxDistance?: number`) to (`store: ChunkStoreApi, pose: PlayerPose, ...maxDistanceArgument: [ ] \| [ maxDistance: number ]`). Return: `Effect.Effect<RightClickRoute \| undefined>` to `Effect.Effect<RightClickRoute \| TargetedRightClickRouteUnavailable \| undefined, CameraPoseError \| RangeError \| BlockTargetInputError \| BlockRegistryResolutionFailure \| TargetedRightClickRouteFailure>`. |
  
  ### Added exports
  
  The declarations below are newly reachable from the package entrypoint.
  
  | Module | Export | Declaration |
  | --- | --- | --- |
  | `src/domain/combat/difficulty-damage.ts` | `DifficultyDamageResultSchema` | `DifficultyDamageResultSchema: Schema.Codec<DifficultyScaledDamage, number>` |
  |  | `scaleHostileDamageForDifficulty` | Export alias of `scaleDifficultyDamage`: `(input: unknown) => Result.Result<DifficultyScaledDamage, DifficultyDamageError>`. |
  | `src/domain/day-night.ts` | `DayNightInputFailure` | `export type DayNightInputFailure = Readonly<{ _tag: 'InvalidDayNightInput'; field: 'timeOfDay'; }>;` |
  |  | `NIGHT_END_FRACTION` | `NIGHT_END_FRACTION = 0.95` |
  |  | `NIGHT_START_FRACTION` | `NIGHT_START_FRACTION = 0.55` |
  | `src/domain/death-cause.ts` | `DamageApplicationFailure` | `export type DamageApplicationFailure = Readonly<{ _tag: 'InvalidDamageApplicationInput'; field: 'vitals' \| 'damage' \| 'vitals.healthPoints' \| 'vitals.lastDeathCause' \| 'damage.amount' \| 'damage.cause'; }>;` |
  |  | `DeathMessageFailure` | `export type DeathMessageFailure = Readonly<{ _tag: 'InvalidDeathMessageInput'; field: 'vitals' \| 'vitals.healthPoints' \| 'vitals.lastDeathCause'; }>;` |
  | `src/domain/enchantment.ts` | `EnchantmentOfferFailure` | `export type EnchantmentOfferFailure = Readonly<{ _tag: 'InvalidEnchantmentOfferInput'; field: 'seed' \| 'bookshelfCount' \| 'slot'; }>;` |
  | `src/domain/entities/dropped-item.ts` | `DeathDropsFromPlayerStorageFailure` | `export type DeathDropsFromPlayerStorageFailure = Extract<PlayerStorageFailure, { readonly _tag: 'InvalidInventoryDurability'; }> \| Readonly<{ _tag: 'InvalidPlayerSlotMetadata'; field: 'metadata' \| 'customName' \| 'enchantedItem'; }>;` |
  |  | `DroppedItemLifetimeFailure` | `export type DroppedItemLifetimeFailure = Readonly<{ _tag: 'InvalidDroppedItemLifetimeInput'; field: 'lifetimeSecs' \| 'elapsedSecs' \| 'deltaSecs' \| 'entityIds'; }>;` |
  |  | `DroppedItemOwnerRegistrationFailure` | `export type DroppedItemOwnerRegistrationFailure = Readonly<{ _tag: 'ExplicitUndefinedDroppedItemOwnerInitialState'; }> \| Readonly<{ _tag: 'InvalidDroppedItemOwnerInitialState'; error: Schema.SchemaError; }>;` |
  |  | `DroppedItemPickupRadiusFailure` | `export type DroppedItemPickupRadiusFailure = Readonly<{ _tag: 'InvalidDroppedItemPickupRadius'; }>;` |
  | `src/domain/entities/mob-frame.ts` | `EndermanTeleportRosterFault` | `export type EndermanTeleportRosterFault = Readonly<{ _tag: 'EndermanTeleportWorldQueryFailure'; entityId: EntityId; failure: EntityWorldQueryFailure; }>;` |
  |  | `MobBehaviourRepairFault` | `export type MobBehaviourRepairFault = Readonly<{ _tag: 'MobBehaviourRepairFault'; failure: MobStateRepairFailure; }>;` |
  |  | `MobExperienceRoll` | `export type MobExperienceRoll = number & Brand.Brand<'MobExperienceRoll'>;` |
  |  | `MobFrameRuleFault` | `export type MobFrameRuleFault = Readonly<{ _tag: 'MobFrameRuleFault'; entityId: EntityId; failure: FrameRollFailure \| DespawnVerdictFailure; }>;` |
  |  | `MobMovementRosterFault` | `export type MobMovementRosterFault = Readonly<{ _tag: 'MobMovementRosterFailure'; reason: 'invalid-state'; entityId: EntityId; entityKind: EntityKind; repairFailure: MobStateRepairFailure; }> \| Readonly<{ _tag: 'MobMovementRosterFailure'; reason: 'invalid-state'; entityId: EntityId; }> \| Readonly<{ _tag: 'MobMovementRosterFailure'; reason: 'invalid-goal'; entityId: EntityId; }> \| Readonly<{ _tag: 'MobMovementRosterFailure'; reason: 'simulation-rejected'; entityId: EntityId; failure: MobMovementFailure; }> \| Readonly<{ _tag: 'MobMovementRosterFailure'; reason: 'step-failed'; entityId: EntityId; failure: MobMovementFailure; }> \| Readonly<{ _tag: 'MobMovementRosterFailure'; reason: 'world-query-failed'; entityId: EntityId; worldFailure: MobMovementWorldFailure; }>;` |
  |  | `MobProjectilePendingImpact` | `export type MobProjectilePendingImpact = Readonly<{ id: ProjectileId; source: EntityId; kind: import('@nerima-games/mc-sim').EntityKind; hit: Readonly<{ kind: 'entity'; entityId: EntityId; point: WorldPosition; }> \| Readonly<{ kind: 'block'; point: WorldPosition; }>; }>;` |
  |  | `MobRosterDamageFailure` | `export type MobRosterDamageFailure = DamageApplicationFailure \| ExplosionInputFailure \| Readonly<{ _tag: 'InvalidMobExplosionHitInput'; field: 'knockback.x' \| 'knockback.y' \| 'knockback.z'; }>;` |
  |  | `MobRosterDamageFault` | `export type MobRosterDamageFault = Readonly<{ _tag: 'MobRosterDamageFault'; entityId: EntityId; failure: MobRosterDamageFailure; }>;` |
  |  | `MobUndroppedEquipmentCount` | `export type MobUndroppedEquipmentCount = number & Brand.Brand<'MobUndroppedEquipmentCount'>;` |
  |  | `hasMobMovementCandidates` | `hasMobMovementCandidates: (roster: MobRoster, dimension: Dimension, target?: Position) => boolean` |
  |  | `isMobBehaviourRepairFault` | `isMobBehaviourRepairFault: (value: unknown) => value is MobBehaviourRepairFault` |
  |  | `planMobMovementRoster` | `planMobMovementRoster: (roster: MobRoster, target: Position \| undefined, world: MobMovementWorldAdapter, simulationTick: SimulationTickValue, dimension: Dimension) => Result.Result<Readonly<{ roster: MobRoster; faults: ReadonlyArray<MobMovementRosterFault>; }>, never>` |
  | `src/domain/environmental-contact-damage.ts` | `EnvironmentalContactDamageFailure` | `export type EnvironmentalContactDamageFailure = Readonly<{ _tag: 'InvalidEnvironmentalContactDamageInput'; field: 'contacts' \| 'contacts.block' \| 'contacts.contactDamage' \| 'state.lastDamageElapsedSecs' \| 'simulationElapsedSecs'; }>;` |
  | `src/domain/fall-damage.ts` | `FallDamageInputFailure` | `export type FallDamageInputFailure = Readonly<{ _tag: 'InvalidFallDamageInput'; field: 'fallDistance'; }>;` |
  | `src/domain/fire-lifecycle.ts` | `FIRE_TICK_ACCUMULATOR_MAX_SECS` | `FIRE_TICK_ACCUMULATOR_MAX_SECS: number` |
  |  | `FireLifecycleFailure` | `export type FireLifecycleFailure = FrameRollFailure \| Readonly<{ _tag: 'InvalidFireLifecycleInput'; field: FireLifecycleInputField; }>;` |
  |  | `FireLifecycleInputField` | `export type FireLifecycleInputField = 'positions' \| 'position' \| 'seed' \| 'fires' \| 'ageTicks' \| 'unloadedRetries' \| 'burningActors' \| 'burningActor' \| 'cells' \| 'cell' \| 'contacts' \| 'contact' \| 'tickAccumulatorSecs' \| 'weather' \| 'difficulty' \| 'snapshot';` |
  | `src/domain/fluid-frontier.ts` | `FluidBudgetFailure` | `export type FluidBudgetFailure = Readonly<{ _tag: 'InvalidFluidFrontierBudget'; }>;` |
  | `src/domain/frame-rolls.ts` | `FrameRollFailure` | `export type FrameRollFailure = Readonly<{ _tag: 'InvalidFrameRollInput'; field: 'seed' \| 'count' \| 'index' \| 'batch'; }>;` |
  | `src/domain/in-memory-world.ts` | `WorldInputFailure` | `export type WorldInputFailure = Readonly<{ readonly _tag: 'WorldInputFailure'; readonly field: 'world' \| 'world.blocks' \| 'world.loaded' \| 'seed' \| 'spawnX' \| 'spawnZ' \| 'spawnPose' \| 'dimension' \| 'inventory' \| 'vitals' \| 'chunkSource' \| 'yawRadians' \| 'pitchRadians'; readonly reason: 'undefined' \| 'invalid'; }>;` |
  | `src/domain/interactions/block-loot.ts` | `BlockLootFailure` | `export type BlockLootFailure = Readonly<{ _tag: 'BlockLootRegistryFailure'; block: BlockId; lookup: 'drop' \| 'type'; failure: BlockRegistryResolutionFailure; }>;` |
  | `src/domain/interactions/eat-food.ts` | `InvalidFoodItemId` | `export type InvalidFoodItemId = Readonly<{ _tag: 'InvalidFoodItemId'; itemId: InvalidFoodItemValue; }>;` |
  | `src/domain/interactions/melee-attack.ts` | `DEFAULT_MELEE_ATTACK_SPEED` | `DEFAULT_MELEE_ATTACK_SPEED = 4` |
  |  | `MELEE_ATTACK_COOLDOWN_TICKS_PER_SECOND` | `MELEE_ATTACK_COOLDOWN_TICKS_PER_SECOND = 20` |
  |  | `MIN_ATTACK_COOLDOWN_FOR_CRITICAL` | `MIN_ATTACK_COOLDOWN_FOR_CRITICAL = 0.848` |
  |  | `MeleeAttackCooldown` | `export type MeleeAttackCooldown = Schema.Schema.Type<typeof MeleeAttackCooldownSchema>;` |
  |  | `MeleeAttackCooldownError` | `export type MeleeAttackCooldownError = 'invalid-input';` |
  |  | `MeleeAttackCooldownSchema` | `MeleeAttackCooldownSchema: Schema.ConstraintDecoder<{ charge: number; damageMultiplier: number; }>` |
  |  | `MeleeCooldownTicks` | `export type MeleeCooldownTicks = number & MeleeCooldownTicksValue;` |
  |  | `MeleeCooldownTicksSchema` | `MeleeCooldownTicksSchema: Schema.Codec<MeleeCooldownTicks, number>` |
  |  | `MeleeTargetInputFailure` | `export type MeleeTargetInputFailure = Readonly<{ _tag: 'InvalidMeleeTargetInput'; field: 'hitDistance'; }>;` |
  |  | `meleeAttackCooldown` | `meleeAttackCooldown: (input: unknown) => Result.Result<MeleeAttackCooldown, MeleeAttackCooldownError>` |
  |  | `meleeAttackCooldownForItem` | `meleeAttackCooldownForItem: (item: ItemType \| null \| undefined, ticksSinceLastAttack: unknown) => Result.Result<MeleeAttackCooldown, MeleeAttackCooldownError>` |
  | `src/domain/interactions/mining-progress.ts` | `EffectiveMiningSpeedError` | `export type EffectiveMiningSpeedError = 'invalid-speed-multiplier';` |
  | `src/domain/interactions/plant-crop.ts` | `PlantWorldDataFailure` | `export type PlantWorldDataFailure = Readonly<{ _tag: 'PlantWorldDataFailure'; cell: 'soil' \| 'above'; failure: Brand.BrandError \| EntityWorldQueryFailure; }>;` |
  | `src/domain/interactions/till-soil.ts` | `TillWorldDataFailure` | `export type TillWorldDataFailure = Readonly<{ _tag: 'TillWorldDataFailure'; cell: 'ground' \| 'above'; failure: Brand.BrandError \| EntityWorldQueryFailure; }>;` |
  | `src/domain/mob/explosion.ts` | `ExplosionInputFailure` | `export type ExplosionInputFailure = Readonly<{ _tag: 'InvalidExplosionInput'; field: 'power' \| 'radius' \| 'distanceToCentre' \| 'exposure' \| 'damageAmount'; }>;` |
  | `src/domain/mob/hostile-combat.ts` | `DAMAGE_IMMUNITY_TICKS` | `DAMAGE_IMMUNITY_TICKS = 10` |
  |  | `DamageImmunityResolution` | `export type DamageImmunityResolution = Readonly<{ appliedAmount: AppliedDamageAmount; state: DamageImmunityState; }>;` |
  |  | `DamageImmunityResolutionError` | `export type DamageImmunityResolutionError = 'invalid-input' \| 'invalid-tick-order';` |
  |  | `DamageImmunityResolutionSchema` | `DamageImmunityResolutionSchema: Schema.ConstraintDecoder<DamageImmunityResolution>` |
  |  | `DamageImmunityState` | `export type DamageImmunityState = Readonly<{ lastDamageTick: SimulationTick; lastDamageAmount: DamageAmount; }>;` |
  |  | `DamageImmunityStateSchema` | `DamageImmunityStateSchema: Schema.ConstraintDecoder<DamageImmunityState>` |
  |  | `HOSTILE_CONTACT_INTERVAL_TICKS` | `HOSTILE_CONTACT_INTERVAL_TICKS = 20` |
  |  | `HostileAttackInput` | `export type HostileAttackInput = Readonly<{ tick: SimulationTick; dimension: Dimension; pose: HostileCombatPose; hasShield: boolean; currentShield: ShieldBlockingState \| null; incoming: ShieldIncomingAttackInput; difficulty: SurvivalDifficulty; damageState: DamageImmunityState \| null; }>;` |
  |  | `HostileAttackPreparation` | `export type HostileAttackPreparation = Readonly<{ shield: ShieldBlockingPreparation; appliedAmount: AppliedDamageAmount; damageState: DamageImmunityState \| null; }>;` |
  |  | `HostileAttackPreparationError` | `export type HostileAttackPreparationError = 'invalid-intent' \| 'invalid-input' \| 'invalid-attack' \| 'invalid-shield-state' \| 'invalid-damage-state';` |
  |  | `HostileAttackPreparationSchema` | `HostileAttackPreparationSchema: Schema.ConstraintDecoder<HostileAttackPreparation>` |
  |  | `HostileCombatPose` | `export type HostileCombatPose = Readonly<{ feetPosition: Readonly<{ x: HostileCombatPoseAxis; y: HostileCombatPoseAxis; z: HostileCombatPoseAxis; }>; yawRadians: HostileCombatPoseAngle; pitchRadians: HostileCombatPoseAngle; }>;` |
  |  | `HostileContactResolutionError` | `export type HostileContactResolutionError = 'invalid-input' \| 'invalid-tick-order';` |
  |  | `PlayerBlastDamageFailure` | `export type PlayerBlastDamageFailure = ExplosionInputFailure \| Readonly<{ _tag: 'InvalidPlayerBlastDamageInput'; field: 'blasts' \| 'target' \| 'difficulty' \| 'position' \| 'explosion' \| 'damageAmount'; }>;` |
  |  | `PursueHorizontallyFailure` | `export type PursueHorizontallyFailure = Readonly<{ _tag: 'InvalidPursuitInput'; field: 'from' \| 'target' \| 'dt' \| 'locomotion' \| 'speedBlocksPerSecond' \| 'stoppingDistanceBlocks' \| 'distance'; }>;` |
  |  | `ShieldIncomingAttackInput` | `export type ShieldIncomingAttackInput = Readonly<{ attacker: Schema.Codec.Encoded<typeof EntityIdSchema>; attackerPosition: Schema.Codec.Encoded<typeof WorldPositionSchema>; kind: 'melee' \| 'projectile' \| 'explosion'; piercing?: Schema.Codec.Encoded<typeof Schema.Boolean>; amount: Schema.Codec.Encoded<typeof DamageAmountSchema>; }>;` |
  |  | `prepareHostileAttack` | `prepareHostileAttack: (intent: unknown, input: unknown) => Result.Result<HostileAttackPreparation, HostileAttackPreparationError>` |
  |  | `resolveDamageWithInvulnerability` | `resolveDamageWithInvulnerability: (input: unknown) => Result.Result<DamageImmunityResolution, DamageImmunityResolutionError>` |
  | `src/domain/mob/hostile-despawn.ts` | `DespawnVerdictFailure` | `export type DespawnVerdictFailure = Readonly<{ _tag: 'InvalidDespawnCandidate'; field: 'candidate' \| 'distanceToPlayerBlocks' \| 'persistent' \| 'named' \| 'tamed' \| 'ageTicks' \| 'randomRoll' \| 'difficulty'; }>;` |
  | `src/domain/mob/hostile-spawn.ts` | `HOSTILE_SPAWN_MAX_DAY_SKY_LIGHT` | `HOSTILE_SPAWN_MAX_DAY_SKY_LIGHT = 7` |
  |  | `HOSTILE_SPAWN_SETTINGS` | `HOSTILE_SPAWN_SETTINGS: Readonly<Record<HostileDifficulty, { readonly maxPopulation: number; readonly intervalTicks: number; }>>` |
  |  | `HostileSpawnInputFailure` | `export type HostileSpawnInputFailure = DayNightInputFailure \| Readonly<{ _tag: 'InvalidSpawnCandidate'; field: 'dimension' \| 'distanceToPlayerBlocksXZ' \| 'blockLight' \| 'skyLight' \| 'feetPosition'; }>;` |
  |  | `MOB_BIOME_SPAWN_TABLE` | `MOB_BIOME_SPAWN_TABLE: Readonly<Record<ChunkBiomeType, ReadonlyArray<string>>>` |
  |  | `SkyLightLevel` | `export type SkyLightLevel = number & Brand.Brand<'SkyLightLevel'>; SkyLightLevel: Brand.Constructor<SkyLightLevel>` |
  |  | `SpawnTickFailure` | `export type SpawnTickFailure = { readonly _tag: 'InvalidSpawnTick'; };` |
  |  | `biomeAllowsMob` | `biomeAllowsMob: (kind: EntityKind, biome: ChunkBiomeType) => boolean` |
  |  | `hostileSpawnSearchDue` | `hostileSpawnSearchDue: (currentTick: SimulationTick, lastSpawnTick: SimulationTick, difficulty: HostileDifficulty) => Result.Result<boolean, SpawnTickFailure>` |
  | `src/domain/mob/mob-drop.ts` | `MOB_DROP_TABLES` | `MOB_DROP_TABLES: Readonly<Record<string, MobDropTable>>` |
  |  | `MOB_EXPERIENCE_RULES` | `MOB_EXPERIENCE_RULES: Readonly<Record<string, MobExperienceRule>>` |
  |  | `MobAge` | `export type MobAge = 'adult' \| 'baby';` |
  |  | `MobDropRollCount` | `export type MobDropRollCount = number & Brand.Brand<'MobDropRollCount'>;` |
  |  | `MobDropRollSequence` | `export type MobDropRollSequence = ReadonlyArray<number> & Brand.Brand<'MobDropRollSequence'>;` |
  |  | `MobSize` | `export type MobSize = 'small' \| 'medium' \| 'large';` |
  |  | `dropRollsNeededForTable` | `dropRollsNeededForTable: (table: MobDropRollTable) => MobDropRollCount` |
  |  | `mobDropRulesOfKind` | `mobDropRulesOfKind: (kind: EntityKind) => Result.Result<ReadonlyArray<MobDropRule>, UnknownMobKind>` |
  |  | `mobDropTableOfKind` | `mobDropTableOfKind: (kind: EntityKind) => Result.Result<MobDropTable, UnknownMobKind>` |
  |  | `mobExperienceRuleOfKind` | `mobExperienceRuleOfKind: (kind: EntityKind) => Result.Result<MobExperienceRule, UnknownMobKind>` |
  |  | `rollMobTable` | `rollMobTable: (table: MobDropRollTable, kill: MobKill, rolls: MobDropRollSequence) => ReadonlyArray<MobDrop>` |
  | `src/domain/mob/mob-ecosystem.ts` | `MOB_MOVEMENT_POLICIES` | `MOB_MOVEMENT_POLICIES: ReadonlyMap<EntityKind, MobMovementPolicy>` |
  |  | `MobMovementDistance` | `export type MobMovementDistance = number & Brand.Brand<'MobMovementDistance'>;` |
  |  | `MobMovementPolicy` | `export type MobMovementPolicy = Readonly<{ _tag: 'FleeOrWander'; fleeWithin: MobMovementDistance; fleeDistance: MobMovementDistance; wanderRadius: MobMovementDistance; }> \| Readonly<{ _tag: 'Approach'; attackDistance: MobMovementDistance; followRange: MobMovementDistance; }> \| Readonly<{ _tag: 'RangedSpacing'; minDistance: MobMovementDistance; maxDistance: MobMovementDistance; followRange: MobMovementDistance; }> \| Readonly<{ _tag: 'ProvokedApproach'; attackDistance: MobMovementDistance; followRange: MobMovementDistance; }>;` |
  |  | `MobStateRepairFailure` | `export type MobStateRepairFailure = Readonly<{ _tag: 'MobMovementStateRepairFailure'; }> \| Readonly<{ _tag: 'MobBehaviourStateRepairFailure'; kind: 'creeper' \| 'enderman' \| 'zombie' \| 'primed-tnt' \| 'dropped-item'; }> \| Readonly<{ _tag: 'EcosystemMobStateRepairFailure'; field: '_tag' \| 'attackCooldownTicks' \| 'attackCooldownSecs' \| 'motionPhase' \| 'provoked' \| 'movementGoal' \| 'movement' \| 'hasHeadProtection' \| 'burningTicks'; }>;` |
  |  | `NETHER_ECOSYSTEM_HOSTILE_KINDS` | `NETHER_ECOSYSTEM_HOSTILE_KINDS: readonly [ EntityKind, EntityKind ]` |
  |  | `SKELETON_ATTACK_DAMAGE` | `SKELETON_ATTACK_DAMAGE = 3` |
  |  | `SKELETON_ATTACK_INTERVAL_TICKS` | `SKELETON_ATTACK_INTERVAL_TICKS = 60` |
  |  | `SPIDER_ATTACK_DAMAGE` | `SPIDER_ATTACK_DAMAGE = 2` |
  |  | `VILLAGER_KIND` | `VILLAGER_KIND: EntityKind` |
  |  | `movementGoalForEcosystemMob` | `movementGoalForEcosystemMob: (kind: EntityKind, state: EcosystemMobState, self: Position, target: Position \| undefined, phase?: NonNegativeTickCount) => Position` |
  |  | `repairMobMovementState` | `repairMobMovementState: (value: unknown) => Result.Result<MobMovementState \| undefined, MobStateRepairFailure>` |
  | `src/domain/survival-hunger.ts` | `MIN_SPRINT_HUNGER_POINTS` | `MIN_SPRINT_HUNGER_POINTS = 7` |
  |  | `SurvivalActivityInputFailure` | `export type SurvivalActivityInputFailure = { readonly _tag: 'SurvivalActivityInputFailure'; readonly field: 'activity' \| 'distance' \| 'count' \| 'blocks'; };` |
  |  | `canSprintAtHungerPoints` | `canSprintAtHungerPoints: (input: unknown) => Result.Result<boolean, "invalid-hunger-points">` |
  | `src/domain/vehicle/rail-shape.ts` | `RailShapeFailure` | `export type RailShapeFailure = Readonly<{ _tag: 'InvalidRailShapeInput' \| 'InvalidMinecartVelocityInput'; field: 'wx' \| 'wy' \| 'wz' \| 'vx' \| 'vz' \| 'speed'; }>;` |
  | `src/domain/vehicle/vehicle-frame.ts` | `VehicleFrameFailure` | `export type VehicleFrameFailure = Readonly<{ _tag: 'VehicleWorldDataFault'; vehicleId: VehicleId; failure: EntityWorldQueryFailure; }> \| Readonly<{ _tag: 'VehicleWorldUnavailable'; vehicleId: VehicleId; position: BlockPosition; reading: Extract<BlockReading, { readonly _tag: 'ChunkNotLoaded' \| 'OutOfWorld'; }>; }> \| Readonly<{ _tag: 'VehicleMotionFailure'; vehicleId: VehicleId; failure: VehicleMotionFailure; }> \| Readonly<{ _tag: 'VehicleUpdateFailure'; vehicleId: VehicleId; failure: VehicleOperationError; }>;` |
  | `src/domain/vehicle/vehicle-motion.ts` | `VehicleMotionFailure` | `export type VehicleMotionFailure = Readonly<{ _tag: 'InvalidImpactSpeed'; }> \| Readonly<{ _tag: 'InvalidVehicleDeltaTime'; }> \| Readonly<{ _tag: 'InvalidBoatControl'; field: 'controls' \| 'throttle' \| 'steering'; }> \| RailShapeFailure;` |
  | `src/domain/weather.ts` | `WeatherInputFailure` | `export type WeatherInputFailure = Readonly<{ _tag: 'InvalidWeatherInput'; field: 'weather' \| 'roll' \| 'rolls' \| 'state' \| 'deltaSeconds' \| 'transition' \| 'duration'; }>;` |
  | `src/stages/gameplay-owner-registrations.ts` | `GameplayEntityMetadataFailure` | `export type GameplayEntityMetadataFailure = Readonly<{ _tag: 'InvalidGameplayEntityMetadata'; field: 'entities' \| 'resolvedMobProjectileIds' \| 'pendingMobProjectileImpacts' \| 'behaviour' \| 'dimension' \| 'killCredit' \| 'lastHitTick'; }> \| Readonly<{ _tag: 'InvalidGameplayEntityRoster'; error: Schema.SchemaError; }>;` |
  |  | `GameplayOwnerRegistrationFailure` | `export type GameplayOwnerRegistrationFailure = Readonly<{ _tag: 'ExplicitUndefinedGameplayOwnerInitialState'; field: keyof GameplayOwnerInitialState \| 'initial'; }> \| Readonly<{ _tag: 'InvalidGameplayOwnerInitialState'; field: keyof GameplayOwnerInitialState \| 'initial'; }> \| GameplayEntityMetadataFailure \| Readonly<{ _tag: 'InvalidGameplayOwnerRegistration'; ownerId: ReplicatedOwnerId; error: Schema.SchemaError; }>;` |
  | `src/stages/gameplay-stage-faults.ts` | `GameplayStageBlockTypeDecodeFailure` | `export type GameplayStageBlockTypeDecodeFailure = Readonly<{ _tag: 'BlockTypeDecodeFailed'; position: BlockPosition; block: BlockId; failure: Readonly<{ _tag: 'UnregisteredBlockId'; }>; }>;` |
  |  | `GameplayStageItemUseWorldFailure` | `export type GameplayStageItemUseWorldFailure = Readonly<{ _tag: 'WorldDataFailed'; reason: GameplayStageBlockTypeDecodeFailure \| GameplayStageMissingBlockReadFailure; }>;` |
  |  | `GameplayStageMissingBlockReadFailure` | `export type GameplayStageMissingBlockReadFailure = Readonly<{ _tag: 'MissingBlockReadResult'; position: BlockPosition; }>;` |
  |  | `GameplayStageWorldFaultReason` | `export type GameplayStageWorldFaultReason = GameplayStageBlockTypeDecodeFailure \| GameplayStageMissingBlockReadFailure \| BlockStateCodecFailure \| LightQueueUnderflowError;` |
  | `src/stages/registration-core.ts` | `BlockPlacementCommandFailure` | `export type BlockPlacementCommandFailure = Readonly<{ _tag: 'InvalidBlockPlacementCommand'; field: 'requestId' \| 'mode'; }>;` |
  |  | `EntityStageFault` | `export type EntityStageFault = Readonly<{ _tag: 'WorldDataFailure'; source: EntityWorldDataFaultSource; operation: 'DecodeBlockType' \| 'ReadBlock' \| 'ReadBlockState' \| 'WriteBlock' \| 'ReadLight'; position: BlockPosition; reason: GameplayStageWorldFaultReason; }> \| Readonly<{ _tag: 'EntityWorldDataFault'; source: EntityWorldDataFaultSource; target: Readonly<{ _tag: 'Cell'; cell: EntityWorldCellPosition; }> \| Readonly<{ _tag: 'Entity'; entityId: EntityId; }> \| Readonly<{ _tag: 'Position'; position: Position; }>; failure: EntityWorldQueryFailure; }> \| Readonly<{ _tag: 'GameplayRequestFault'; source: 'Mining' \| 'BlockUse' \| 'ItemUse' \| 'Tnt' \| 'Fluid' \| 'VehicleMovement'; requestId?: string; positionKey?: BlockPositionKey; reason: 'InvalidBlockPositionKey' \| 'NeighbourPositionOverflow' \| 'InvalidCropRoll' \| 'InvalidBlockLootContext' \| 'InvalidBlockLootFortuneLevel' \| 'InvalidBowChargeSecs' \| 'InvalidBowPowerLevel' \| 'InvalidVehicleControlShape' \| 'InvalidVehicleThrottle' \| 'InvalidVehicleSteering'; }> \| Readonly<{ _tag: 'FluidNeighbourPositionFault'; cell: BlockPosition; reason: 'coordinate-overflow' \| 'unknown-face'; }> \| Readonly<{ _tag: 'MobBehaviourRepairFault'; entityId: EntityId; entityKind: EntityKind; failure: MobStateRepairFailure; }> \| Readonly<{ _tag: 'MobMovementExecutionFault'; entityId: EntityId; reason: 'invalid-state' \| 'invalid-goal'; }> \| Readonly<{ _tag: 'MobMovementExecutionFault'; entityId: EntityId; reason: 'simulation-rejected' \| 'step-failed'; failure: MobMovementFailure; }> \| Readonly<{ _tag: 'MobFrameRuleFault'; entityId: EntityId; failure: MobFrameRuleFault['failure']; }> \| MobRosterDamageFault;` |
  |  | `drainGameplayEntityStageFaults` | `drainGameplayEntityStageFaults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<EntityStageFault>>` |
  |  | `requestShieldBlocking` | `requestShieldBlocking: (state: GameplayFrameState, intent: ShieldBlockingIntent) => Effect.Effect<void>` |
  |  | `validateBlockPlacementCommand` | `validateBlockPlacementCommand: (command: unknown) => Result.Result<BlockPlacementCommand, BlockPlacementCommandFailure>` |
  | `src/stages/targeted-right-click-route.ts` | `TargetedRightClickRouteFailure` | `export type TargetedRightClickRouteFailure = TargetedRightClickRouteInputFailure \| Readonly<{ readonly _tag: 'UnknownTargetBlockId'; readonly position: BlockPosition; readonly blockId: BlockId; }>;` |
  |  | `TargetedRightClickRouteInputFailure` | `export type TargetedRightClickRouteInputFailure = Readonly<{ readonly _tag: 'TargetedRightClickRouteInputFailure'; readonly field: 'maxDistance'; readonly reason: 'undefined'; }>;` |
  |  | `TargetedRightClickRouteUnavailable` | `export type TargetedRightClickRouteUnavailable = Readonly<{ readonly _tag: Extract<BlockReading['_tag'], 'ChunkNotLoaded' \| 'OutOfWorld'>; readonly position: BlockPosition; }>;` |
  
  ### Removed exports
  
  Use `HOSTILE_CONTACT_INTERVAL_TICKS` (20 ticks) instead of `HOSTILE_CONTACT_INTERVAL_SECS` (1 second); hostile-contact cooldowns now use simulation ticks.
  
  | Module | Removed export | Previous declaration |
  | --- | --- | --- |
  | `src/domain/mob/hostile-combat.ts` | `HOSTILE_CONTACT_INTERVAL_SECS` | `HOSTILE_CONTACT_INTERVAL_SECS = 1` |
  
  ### Exports affected through referenced types
  
  These signatures retain their text. Dependencies are the module-wide union of changes from the published release to this release, not a per-export mapping.
  
  | Module | Exports | Changed dependencies across the module row |
  | --- | --- | --- |
  | `src/domain/bed-sleep.ts` | `BedSleepDecision` | `DAWN_FRACTION` |
  | `src/domain/entities/dropped-item.ts` | `appendDroppedItemSpawns`, `droppedItemPickupResultAfterCommit`, `pickupDroppedItemsCommitted`, `planDroppedItemPickup`, `spawnDroppedItem`, `spawnDroppedItems`, `spawnMobDrop`, `spawnMobDrops` | `DroppedItemPickupFailure`, `DroppedItemPickupRadiusFailure`, `DroppedItemSpawnError`, `HostileMobSnapshot`, `MobBehaviour`, `MobBehaviourRepairFault`, `EcosystemMobState`, `MobStateRepairFailure` |
  | `src/domain/entities/mob-frame.ts` | `BowHit`, `MobEntity`, `MobRosterSweep`, `MobSpawnAttempt`, `MobSpawnOutcome`, `MobSpawnRosterResolution`, `initialBehaviourOfKind`, `isHostileMobSnapshot`, `planMobBlastRoster`, `planMobDamageRoster`, `planMobExplosionRoster`, `planMobRosterSweep`, `repairMobBehaviour`, `resolveMeleeHits`, `sweepMobs` | `DamageApplicationFailure`, `HostileMobSnapshot`, `MobBehaviour`, `MobBehaviourRepairFault`, `MobBlastRosterResolution`, `MobCasualty`, `MobDamageHit`, `MobExperienceRoll`, `MobFrameRuleFault`, `MobFrameSenses`, `MobKillCredit`, `MobProjectilePendingImpact`, `MobRoster`, `MobRosterDamageFailure`, `MobRosterDamageFault`, `MobSweep`, `MobUndroppedEquipmentCount`, `resolveBowHits`, `FrameRollFailure`, `ExplosionInputFailure`, `DespawnVerdictFailure`, `SkyLightLevel`, `SpawnCandidate`, `SpawnRefusal`, `MobAge`, `MobSize`, `EcosystemMobState`, `MobStateRepairFailure` |
  | `src/domain/interactions/break-block.ts` | `BreakBlockPlanResult`, `BreakTransactionFailureSchema`, `BreakTransactionResult`, `BreakTransactionResultSchema`, `planBreakBlock` | `ChunkWindowCell`, `CorruptChunkBuffer`, `EntityWorldCellPosition`, `EntityWorldQueryFailure`, `BreakTransactionFailure` |
  | `src/domain/interactions/ignite-fire.ts` | `igniteFire` | `IgniteFireCommitContext`, `IgniteFireOutcome` |
  | `src/domain/interactions/melee-attack.ts` | `MeleeAttackPreparationSchema` | `KnockbackDirection`, `MeleeAttackDamageEvent`, `MeleeAttackPreparation`, `DamageImmunityState` |
  | `src/domain/interactions/place-block.ts` | `PlaceBlockPlan`, `placementVerdict` | `ChunkWindowCell`, `CorruptChunkBuffer`, `EntityWorldCellPosition`, `EntityWorldQueryFailure`, `PlaceOutcome`, `CactusSidesRefusal`, `SugarCaneWaterRefusal` |
  | `src/domain/interactions/place-cactus-sides.ts` | `cactusSidesObjection` | `ChunkWindowCell`, `CorruptChunkBuffer`, `EntityWorldCellPosition`, `EntityWorldQueryFailure`, `CactusSidesRefusal` |
  | `src/domain/interactions/place-door-upper.ts` | `doorUpperBreakCell`, `doorUpperCell` | `ChunkWindowCell`, `CorruptChunkBuffer`, `EntityWorldCellPosition`, `EntityWorldQueryFailure`, `DoorUpperBreakCell`, `DoorUpperCell` |
  | `src/domain/interactions/place-sugar-cane-water.ts` | `sugarCaneWaterObjection` | `ChunkWindowCell`, `CorruptChunkBuffer`, `EntityWorldCellPosition`, `EntityWorldQueryFailure`, `SugarCaneWaterRefusal` |
  | `src/domain/interactions/plant-crop.ts` | `plantingVerdict` | `PlantOutcome` |
  | `src/domain/interactions/till-soil.ts` | `tillingVerdict` | `TillOutcome` |
  | `src/domain/interactions/use-flint-and-steel.ts` | `IgnitionOutcome` | `IgniteFireOutcome` |
  | `src/domain/mob/hostile-despawn.ts` | `DespawnVerdict` | `DespawnReason` |
  | `src/domain/mob/hostile-spawn.ts` | `SpawnVerdict` | `SpawnRefusal` |
  | `src/domain/mob/mob-drop.ts` | `BLAZE_DROPS`, `CREEPER_DROPS`, `ENDERMAN_DROPS`, `GHAST_DROPS`, `ZOMBIE_DROPS`, `dropPasses`, `rollMobDrop`, `rollMobDrops` | `MobAge`, `MobDropRule`, `MobKill`, `MobSize` |
  | `src/domain/mob/mob-ecosystem.ts` | `EcosystemMobStep`, `initialEcosystemMobState`, `stepEcosystemMob` | `EcosystemMobState` |
  | `src/stages/gameplay-owner-registrations.ts` | `GameplayEntity`, `GameplayEntityRosterSchema`, `GameplayMobBehaviourSchema`, `GameplayOwnerInitialState`, `GameplayTntSource`, `GameplayTntSourcesSnapshot`, `GameplayTntSourcesSnapshotSchema` | `HostileMobSnapshot`, `MobBehaviour`, `MobBehaviourRepairFault`, `MobKillCredit`, `MobProjectilePendingImpact`, `MobRoster`, `EcosystemMobState`, `MobStateRepairFailure`, `GameplayEntityRoster` |
  | `src/stages/registration-core.ts` | `BlockPlacementResult`, `DroppedItemPickupExecution`, `IgnitionItemUseResult`, `ItemUseResult`, `collectBrewingPotion`, `drainBlockPlacementResults`, `drainBlockUseResults`, `drainBowKnockbacks`, `drainBowShotResults`, `drainDroppedItemPickupExecutions`, `drainEndPortalTravels`, `drainExperienceOrbAbsorptionExecutions`, `drainFluidUpdates`, `drainItemUseResults`, `drainMeleeAttackResults`, `drainMobDrops`, `drainMobExperience`, `drainPlayerDamages`, `drainPlayerHeals`, `drainPortalTravels`, `drainVillagerTradeResults`, `drainWeatherGameplayEvents`, `getPlayerMovementSpeedMultiplier`, `insertBrewingBottle`, `insertBrewingFuel`, `insertBrewingIngredient`, `makeGameplayFrameState`, `makeGameplayFrameStateForOwner`, `requestBlockBreak`, `requestBlockPlacement`, `requestBlockPlacementCommand`, `requestBlockUse`, `requestBoneMeal`, `requestBowShot`, `requestBucketUse`, `requestCollectBrewingBottle`, `requestDroppedItemPickup`, `requestEnderPearlThrow`, `requestExperienceOrbAbsorption`, `requestFireExtinguish`, `requestFishingAdvance`, `requestFishingCancel`, `requestFishingCast`, `requestFishingReel`, `requestFoodUse`, `requestFurnaceAdvance`, `requestItemUse`, `requestMeleeAttack`, `requestMobSpawn`, `requestPotatoFoodUse`, `requestPotatoHarvest`, `requestPotatoPlanting`, `requestSoilTill`, `requestStatusEffect`, `requestTargetedBlockBreak`, `requestVillagerTrade`, `restoreStatusEffects`, `restoreWeatherGameplay`, `setPlayerDead`, `setPortalCandidates`, `snapshotStatusEffects`, `snapshotWeatherGameplay`, `submitWeatherGameplayInput`, `useBrewingPotion` | `ChunkWindowCell`, `DayNightInputFailure`, `DamageApplicationFailure`, `DroppedItemPickupFailure`, `DroppedItemPickupRadiusFailure`, `DroppedItemSpawnError`, `CorruptChunkBuffer`, `EntityWorldCellPosition`, `EntityWorldQueryFailure`, `MobFrameRuleFault`, `MobRosterDamageFailure`, `MobRosterDamageFault`, `MobSpawnSearchFailure`, `FireLifecycleFailure`, `FireLifecycleInputField`, `FrameRollFailure`, `BlockLootFailure`, `BreakTransactionFailure`, `InvalidFoodItemId`, `InvalidFoodItemValue`, `IgniteFireOutcome`, `KnockbackPreparationError`, `MeleeTargetInputFailure`, `PlaceOutcome`, `CactusSidesRefusal`, `SugarCaneWaterRefusal`, `PlantOutcome`, `TillOutcome`, `ExplosionInputFailure`, `DamageImmunityState`, `HostileContactResolutionError`, `PlayerBlastDamageFailure`, `ShieldBlockingIntent`, `ShieldBlockingPreparationError`, `ShieldBlockingState`, `DespawnVerdictFailure`, `HostileSpawnInputFailure`, `SkyLightLevel`, `SpawnCandidate`, `MobStateRepairFailure`, `SurvivalActivityInputFailure`, `SurvivalHungerError`, `SurvivalHungerRuntimeApi`, `RailShapeFailure`, `VehicleMotionFailure`, `WeatherInputFailure`, `GameplayEntityMetadataFailure`, `GameplayStageBlockTypeDecodeFailure`, `GameplayStageItemUseWorldFailure`, `GameplayStageMissingBlockReadFailure`, `GameplayStageWorldFaultReason`, `BlockPlacementCommandFailure`, `BlockPlacementCommandOutcome`, `EntitiesStageFailureTag`, `EntityStageFault`, `EntityWorldDataFaultSource`, `FarmingItemUseResult`, `GameplayBlockWriteBatchFailure`, `GameplayEntityStageFaultKey`, `GameplayFrameState`, `GameplayMeleeAttackResult`, `GameplayStageOperationFailure`, `GameplayUnsupportedAction`, `GameplayUnsupportedOperation`, `GameplayUnsupportedReason`, `ItemUseWorldReadRefusal`, `UnsupportedDropItemId` |
  | `src/stages/registration.ts` | `gameplayStages` | `ChunkWindowCell`, `DayNightInputFailure`, `DamageApplicationFailure`, `DroppedItemPickupFailure`, `DroppedItemPickupRadiusFailure`, `DroppedItemSpawnError`, `CorruptChunkBuffer`, `EntityWorldCellPosition`, `EntityWorldQueryFailure`, `HostileMobSnapshot`, `MobBehaviour`, `MobBehaviourRepairFault`, `MobFrameRuleFault`, `MobRosterDamageFailure`, `MobRosterDamageFault`, `MobSpawnSearchFailure`, `FireLifecycleFailure`, `FireLifecycleInputField`, `FrameRollFailure`, `BlockLootFailure`, `BreakTransactionFailure`, `InvalidFoodItemId`, `InvalidFoodItemValue`, `IgniteFireOutcome`, `KnockbackPreparationError`, `MeleeTargetInputFailure`, `PlantOutcome`, `TillOutcome`, `ExplosionInputFailure`, `DamageImmunityState`, `HostileContactResolutionError`, `PlayerBlastDamageFailure`, `ShieldBlockingIntent`, `ShieldBlockingPreparationError`, `ShieldBlockingState`, `DespawnVerdictFailure`, `HostileSpawnInputFailure`, `SkyLightLevel`, `SpawnCandidate`, `EcosystemMobState`, `MobStateRepairFailure`, `SurvivalActivityInputFailure`, `SurvivalHungerError`, `SurvivalHungerRuntimeApi`, `RailShapeFailure`, `VehicleMotionFailure`, `WeatherInputFailure`, `GameplayEntityMetadataFailure`, `GameplayStageBlockTypeDecodeFailure`, `GameplayStageItemUseWorldFailure`, `GameplayStageMissingBlockReadFailure`, `GameplayStageWorldFaultReason`, `BlockPlacementCommandFailure`, `EntitiesStageFailureTag`, `EntityStageFault`, `EntityWorldDataFaultSource`, `FarmingItemUseResult`, `GameplayBlockWriteBatchFailure`, `GameplayEntityStageFaultKey`, `GameplayFrameState`, `GameplayMeleeAttackResult`, `GameplayStageOperationFailure`, `GameplayUnsupportedAction`, `GameplayUnsupportedOperation`, `GameplayUnsupportedReason`, `ItemUseWorldReadRefusal`, `UnsupportedDropItemId` |
  
  </details>

- [#75](https://github.com/nerima-games/mx-gameplay/pull/75) [`1597d67`](https://github.com/nerima-games/mx-gameplay/commit/1597d67264b731ecf075d15eef023b7ccdd2a916) Thanks [@takeokunn](https://github.com/takeokunn)! - Revise mob spawning with column-based floor search, light and biome checks, difficulty caps, and scheduled passive respawns.

- [#79](https://github.com/nerima-games/mx-gameplay/pull/79) [`16fdf7e`](https://github.com/nerima-games/mx-gameplay/commit/16fdf7e8b476312cda51e8d5c2547dba05356950) Thanks [@takeokunn](https://github.com/takeokunn)! - Wire combat, mining, fishing, mob-drop, and armor enchantments; apply kernel status-effect definitions during ticks; and add XP-orb pickup, Mending, and continuous mining progress.
  
  `applyStatusEffect` now returns a `Result` of `StatusEffectApplicationOutcome` or `StatusEffectApplicationError` instead of a `StatusEffectState`. `tickStatusEffects` now returns a `Result` of `StatusEffectTick` or `InvalidStatusEffectTick` and rejects an invalid state or delta instead of ticking an empty state or zero elapsed time.
  
  Fishing records each cast's Lure and Luck of the Sea levels and open-water decision in the new replicated owner `GAMEPLAY_FISHING_ENCHANTMENTS_OWNER_ID` (`GameplayFishingEnchantmentsSnapshotSchema`), registered by `gameplayOwnerRegistrations` and restorable through `GameplayOwnerInitialState.fishingEnchantments`. The record is written in the cast commit and removed in the reel or cancel commit. `GameplayStageCommitServices` accepts an optional `fishingEnchantmentsOwnerId`. An active cast without a record is rebuilt from the rod at the reel's `toolLocation` and the blocks around the bobber; when that is impossible the request is skipped and a stage fault is recorded (`FishingRodNotHeld` when the request names no rod location, `FishingBobberUnavailable` when the bobber is gone, or a `Fishing` world-data fault when the blocks around the bobber cannot be read), so an advance or tool-less reel for such a cast no longer proceeds with default levels.

- [#79](https://github.com/nerima-games/mx-gameplay/pull/79) [`16fdf7e`](https://github.com/nerima-games/mx-gameplay/commit/16fdf7e8b476312cda51e8d5c2547dba05356950) Thanks [@takeokunn](https://github.com/takeokunn)! - Add gameplay requests for generating enchanting-table offers and applying them through mc-sim. Both requests are rejected with `table-missing` when the requested position does not hold an enchanting table.

## 0.10.0

### Minor Changes

- Advance brewing from the production gameplay frame delta.

### Patch Changes

- Allow fishing reel requests to carry the held rod slot and apply rod durability wear during stage settlement.

- Reject fishing reel requests whose declared held slot does not contain a fishing rod.

- Fix entity ID repair collisions, exact container metadata deletion, and subnormal direction handling.

- Add the held storage location to melee attack requests so the gameplay stage can apply weapon durability wear.

- Add a browser debug UI and expand gameplay property and scenario validation. The UI under `apps/browser-debug/` is development tooling and is not included in the published package.

## 0.9.0

### Minor Changes

- Pin `mc-audio`, `mc-sim`, and `mc-worldgen` to their updated releases.

## 0.8.0

### Minor Changes

- Pin mc-kernel 0.14.0 for the gameplay release.

- Remove the public `InMemoryChunkStoreLayer` and `makeInMemoryChunkStore` API and the arbitrary `WorldContents.lights` seed. Migrate callers to `makeInMemoryWorld({ world })`, which adapts supplied blocks through mc-worldgen's `ChunkStoreLayer(source, capacity)` and derives light from chunk contents. Unknown chunk coordinates load as empty chunks from the source.

- Export `breakBlock` and its transaction-aware mining overload from the package root, together with `GAMEPLAY_PLAYER_STORAGE_OWNER_ID` for coordinator setup.

- Update gameplay to mc-worldgen 0.7 and Effect 4.

- Export the typed mc-sim projectile runtime adapter for gameplay callers.

- Pin mc-sim 0.7.1 and route owner-backed interactions through merged plans with one world commit.

### Patch Changes

- Split gameplay registration into stage-specific adapters.

## 0.7.0

### Minor Changes

- [#41](https://github.com/nerima-games/mx-gameplay/pull/41) [`871153a`](https://github.com/nerima-games/mx-gameplay/commit/871153a8ff295a4751724270b6d883a949897a77) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix armour wrongly blunting sustained burn damage: a player already on fire but no longer standing in the fire block took less damage from a full iron set than they should have. With 15 armour points (60% reduction) a burning player was taking 0.4 instead of 1.0 damage per pulse on normal difficulty, 0.8 instead of 2.0 on hard — over a full 80-tick burn, roughly 1.6 instead of 4, more than half of sustained burn damage wrongly absorbed by armour that should have no effect on it.
  
  The single `'fire'` `DeathCause` (`src/domain/death-cause.ts`) covered two rules that vanilla treats oppositely: standing in the fire block (`in_fire`, armour-mitigated) and burning over time after leaving it (`on_fire`, armour-bypassing). One cause could not answer both, so the exemption in `CAUSES_BYPASSING_ARMOR` (`src/domain/combat/armor.ts`) could not be applied without also wrongly exempting fire-block contact. `fire-lifecycle.ts`'s `advanceBurningActors` now assigns the cause per damage tick from whether the actor is still inside a fire cell that tick, and `on_fire` is now in the bypass table.
  
  This is a breaking change to the public API: `DeathCause` no longer has a `'fire'` member (replaced by `'in_fire'` and `'on_fire'`), and the unused, never-wired `FIRE_CONTACT_DAMAGE` export has been removed. No consumer in this org currently imports either (checked via `git grep` across mx-multiplayer, mx-ui, mc-compose and mx-redstone), and no save format or wire protocol persists a `DeathCause` value (`mc-save` has no reference to `Vitals`; `mc-sim`'s own `Vitals.lastDamageCause` is a bare `string`, deliberately decoupled from this package's cause roster) — but the union member removal is still a source-breaking change for any future consumer matching on it.

## 0.6.3

### Patch Changes

- [#38](https://github.com/nerima-games/mx-gameplay/pull/38) [`da3d32f`](https://github.com/nerima-games/mx-gameplay/commit/da3d32f970e01caa5421ac44e1afd23e973c8520) Thanks [@takeokunn](https://github.com/takeokunn)! - Strengthen test coverage over combat, environmental damage, and death-drop rules that already had 100% statement/branch coverage but were verified only by hand mutation testing, not by that coverage number.
  
  Two of the surviving mutants pointed at a genuine gap where the same code path had never been exercised with the input that would show the difference:
  
  - `deathDropsFromPlayerStorage` (`src/domain/entities/dropped-item.ts`) loops over all five `EQUIPMENT_SLOTS` when a player dies, but every existing test only ever equipped `head`. A mutant that iterated a single slot still passed the whole suite — chest, legs, feet, and offhand items would have silently stayed on the corpse. Added a case that equips all five slots and asserts each drops.
  - `resolveEnvironmentalContactDamage`'s tie-break, which prefers lava over cactus when two contacted cells deal equal damage, was untested because vanilla's own numbers (cactus 1, lava 4) never actually tie — the branch was only reachable with constructed `EnvironmentalContact` values. Added a case that ties them directly, in both contact orders.
  
  A third mutation surfaced a real defect in `addToSlots` (`src/domain/in-memory-inventory.ts`): its pass-one top-up subtracts a partial stack's existing count from `MAX_STACK_COUNT` to find remaining headroom before capping. A mutant that capped at `MAX_STACK_COUNT` directly (ignoring what the slot already held) was caught only by a new conservation property — "the inventory's total count after `add` equals the total before plus what `add` reports as accepted" — swept over several starting occupancies rather than the fixed small scenarios the existing tests used. No prior test started from a partially-filled stack large enough to expose it. Added the conservation property for both `addToSlots` and `removeFromSlots`, plus an armour-mitigation monotonicity property (resulting damage never increases as armour points increase, for every armour-mitigated cause).
  
  No production behaviour changed: `git diff` against the prior release touches only `test/`.

## 0.6.2

### Patch Changes

- [#36](https://github.com/nerima-games/mx-gameplay/pull/36) [`c04d895`](https://github.com/nerima-games/mx-gameplay/commit/c04d8959de0434dc5ecbc7c7844fe8b9f23ae669) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix armour blunting damage it should never touch: fall damage, drowning, suffocation, starvation, void, ender pearl exhaustion damage, and poison were all taking the same four-percent-per-armour-point reduction as a sword hit. A fully iron-armoured player falling from a height, drowning, or standing in a wall took visibly less damage than an unarmoured player in the same situation — wrong in either direction a player could exploit or be hurt by, since none of those are things armour protects against.
  
  `applyArmorToDamage` (`src/domain/combat/armor.ts`) applied its reduction to every `Damage` regardless of `cause`. It now checks the cause first: the eight causes above pass through unmitigated, and every other cause — including cactus and lava contact, which ARE armour-mitigated, same as a sword hit — is unchanged. `fire` is deliberately left alone: this package's single `'fire'` cause currently covers two situations that should be treated differently (standing in a fire block, which armour reduces, and burning over time after leaving it, which armour does not), and fixing that needs splitting the cause rather than a one-line exemption.

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
