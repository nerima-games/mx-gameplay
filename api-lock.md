# API lock — @nerima-games/mx-gameplay

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 455
supporting declarations: 61

## Exported

### ARMOR_SLOTS  `const`

```ts
const ARMOR_SLOTS: readonly ["helmet", "chestplate", "leggings", "boots"];
```

### AdvanceBreakProgressInput  `type`

```ts
type AdvanceBreakProgressInput = {
    readonly current: BreakProgressState | null;
    readonly blockKey: string;
    readonly breakTicks: number;
};
```

### AdvanceBreakProgressResult  `type`

```ts
type AdvanceBreakProgressResult = {
    readonly nextProgress: BreakProgressState | null;
    readonly shouldBreak: boolean;
};
```

### ArmorSlot  `type`

```ts
type ArmorSlot = (typeof ARMOR_SLOTS)[number];
```

### BLAZE_DROPS  `const`

```ts
const BLAZE_DROPS: ReadonlyArray<MobDropRule>;
```

### BLAZE_XP_REWARD  `const`

```ts
const BLAZE_XP_REWARD = 10;
```

### BLOCK_LOOT_ROLLS  `const`

```ts
const BLOCK_LOOT_ROLLS = 4;
```

### BOW_AIM_EPSILON_SQUARED  `const`

```ts
const BOW_AIM_EPSILON_SQUARED = 1e-18;
```

### BOW_FULL_CHARGE_SECS  `const`

```ts
const BOW_FULL_CHARGE_SECS = 1;
```

### BOW_LINE_OF_SIGHT_EPSILON  `const`

```ts
const BOW_LINE_OF_SIGHT_EPSILON = 0.000001;
```

### BOW_LINE_OF_SIGHT_STEP  `const`

```ts
const BOW_LINE_OF_SIGHT_STEP = 0.1;
```

### BOW_MAX_DAMAGE  `const`

```ts
const BOW_MAX_DAMAGE = 9;
```

### BOW_MAX_RANGE  `const`

```ts
const BOW_MAX_RANGE = 50;
```

### BOW_MIN_CHARGE_SECS  `const`

```ts
const BOW_MIN_CHARGE_SECS = 0.2;
```

### BOW_MIN_DAMAGE  `const`

```ts
const BOW_MIN_DAMAGE = 1;
```

### BOW_TARGET_CENTER_Y_OFFSET  `const`

```ts
const BOW_TARGET_CENTER_Y_OFFSET = 0.9;
```

### BOW_TARGET_RADIUS  `const`

```ts
const BOW_TARGET_RADIUS = 0.9;
```

### BROWN_MUSHROOM_BLOCK_ID  `const`

```ts
const BROWN_MUSHROOM_BLOCK_ID: BlockId | undefined;
```

### Blast  `type`

```ts
type Blast = {
    readonly source: EntityId;
    readonly kind: EntityKind;
    readonly at: Position;
    readonly explosion: Explosion;
};
```

### BlastResolution  `type`

```ts
type BlastResolution = {
    readonly casualties: ReadonlyArray<MobCasualty>;
    readonly disturbed: ReadonlyArray<PositionKey>;
};
```

### BlockLootContext  `type`

```ts
type BlockLootContext = HarvestContext & {
    readonly fortuneLevel?: number;
};
```

### BlockUseOutcome  `type`

```ts
type BlockUseOutcome = Readonly<{
    _tag: 'ToggleLever';
    position: BlockPosition;
}> | Readonly<{
    _tag: 'NotLever';
    position: BlockPosition;
    existing: BlockId;
}> | Readonly<{
    _tag: 'ChunkNotLoaded';
    position: BlockPosition;
}> | Readonly<{
    _tag: 'OutOfWorld';
    position: BlockPosition;
}>;
```

### BlockUseRequest  `type`

```ts
type BlockUseRequest = {
    readonly requestId: BlockUseRequestId;
    readonly positionKey: PositionKey;
};
```

### BlockUseRequestId  `type`

```ts
type BlockUseRequestId = string;
```

### BlockUseResult  `type`

```ts
type BlockUseResult = {
    readonly requestId: BlockUseRequestId;
    readonly success: boolean;
    readonly outcome: BlockUseOutcome;
};
```

### BowDrawContext  `type`

```ts
type BowDrawContext = {
    readonly powerLevel?: number;
};
```

### BowHit  `type`

```ts
type BowHit = {
    readonly id: EntityId;
    readonly damage: number;
};
```

### BowKnockback  `type`

```ts
type BowKnockback = {
    readonly id: EntityId;
    readonly direction: KnockbackDirection;
};
```

### BowShotRequest  `type`

```ts
type BowShotRequest = {
    readonly requestId?: BowShotRequestId;
    readonly origin: Position;
    readonly dirX: number;
    readonly dirY: number;
    readonly dirZ: number;
    readonly chargeSecs: number;
    readonly powerLevel?: number;
};
```

### BowShotRequestId  `type`

```ts
type BowShotRequestId = string;
```

### BowShotResult  `type`

```ts
type BowShotResult = {
    readonly requestId: BowShotRequestId;
    readonly success: true;
    readonly outcome: 'Fired';
} | {
    readonly requestId: BowShotRequestId;
    readonly success: false;
    readonly outcome: 'Undercharged' | 'DuplicateRequest';
};
```

### BreakProgressState  `type`

```ts
type BreakProgressState = {
    readonly blockKey: string;
    readonly ticks: number;
    readonly totalTicks: number;
};
```

### CACTUS_BLOCK_ID  `const`

```ts
const CACTUS_BLOCK_ID: BlockId | undefined;
```

### CANNOT_TILL  `const`

```ts
const CANNOT_TILL: TillingCapability;
```

### CLEAR_DURATION_RANGE_SECS  `const`

```ts
const CLEAR_DURATION_RANGE_SECS: WeatherDurationRange;
```

### CLOSED_SHELL  `const`

```ts
const CLOSED_SHELL: ShulkerShell;
```

### CONTACT_EPSILON  `const`

```ts
const CONTACT_EPSILON = 1e-9;
```

### CREEPER_DROPS  `const`

```ts
const CREEPER_DROPS: ReadonlyArray<MobDropRule>;
```

### CREEPER_EXPLOSION_POWER  `const`

```ts
const CREEPER_EXPLOSION_POWER = 3;
```

### CREEPER_FUSE_SECS  `const`

```ts
const CREEPER_FUSE_SECS = 1.5;
```

### CREEPER_IGNITION_RANGE_BLOCKS  `const`

```ts
const CREEPER_IGNITION_RANGE_BLOCKS = 3;
```

### CREEPER_KIND  `const`

```ts
const CREEPER_KIND: EntityKind;
```

### CREEPER_LOCOMOTION  `const`

```ts
const CREEPER_LOCOMOTION: HostileLocomotion;
```

### CREEPER_MAX_HEALTH  `const`

```ts
const CREEPER_MAX_HEALTH = 20;
```

### CREEPER_XP_REWARD  `const`

```ts
const CREEPER_XP_REWARD = 5;
```

### CROP_OF_SEED  `const`

```ts
const CROP_OF_SEED: Readonly<Partial<Record<ItemType, BlockType>>>;
```

### CactusSidesRefusal  `type`

```ts
type CactusSidesRefusal = {
    readonly _tag: 'SidesBlocked';
};
```

### CasualtyDrops  `type`

```ts
type CasualtyDrops = {
    readonly drops: ReadonlyArray<MobDropEvent>;
    readonly seed: number;
};
```

### CellLight  `type`

```ts
type CellLight = {
    readonly sky: number;
    readonly block: number;
};
```

### ChunkWindow  `type`

```ts
type ChunkWindow = {
    readonly blockAt: BlockAt;
    readonly unreadableProbes: () => number;
};
```

### CreeperFuse  `type`

```ts
type CreeperFuse = {
    readonly _tag: 'Dormant';
} | {
    readonly _tag: 'Lit';
    readonly burnedSecs: number;
} | {
    readonly _tag: 'Detonated';
};
```

### CreeperSenses  `type`

```ts
type CreeperSenses = {
    readonly distanceToTargetBlocks: number | undefined;
};
```

### CreeperStep  `type`

```ts
type CreeperStep = {
    readonly fuse: CreeperFuse;
    readonly explosion: Explosion | undefined;
};
```

### CropDrop  `type`

```ts
type CropDrop = {
    readonly item: ItemType;
    readonly count: number;
};
```

### CropDropOutcome  `type`

```ts
type CropDropOutcome = {
    readonly _tag: 'drops';
    readonly drops: ReadonlyArray<CropDrop>;
} | {
    readonly _tag: 'notACrop';
    readonly block: BlockType;
} | {
    readonly _tag: 'unavailable';
    readonly block: BlockType;
    readonly missingItem: string;
};
```

### DAWN_FRACTION  `const`

```ts
const DAWN_FRACTION = 0.25;
```

### DEATH_MESSAGES  `const`

```ts
const DEATH_MESSAGES: Readonly<Record<DeathCause, string>>;
```

### DEFAULT_BLOCK_REACH  `const`

```ts
const DEFAULT_BLOCK_REACH = 5;
```

### DEFAULT_FLUID_FRONTIER_BUDGET  `const`

```ts
const DEFAULT_FLUID_FRONTIER_BUDGET = 64;
```

### DEFAULT_MELEE_DAMAGE  `const`

```ts
const DEFAULT_MELEE_DAMAGE = 1;
```

### DEFAULT_MELEE_REACH  `const`

```ts
const DEFAULT_MELEE_REACH = 3;
```

### DEFAULT_ROLL_SEED  `const`

```ts
const DEFAULT_ROLL_SEED = 20260727;
```

### DESPAWN_DISTANCE_BLOCKS  `const`

```ts
const DESPAWN_DISTANCE_BLOCKS = 128;
```

### DOOR_BLOCKS  `const`

```ts
const DOOR_BLOCKS: readonly ["door", "door_open"];
```

### DOOR_BLOCK_ID  `const`

```ts
const DOOR_BLOCK_ID: BlockId | undefined;
```

### DORMANT_FUSE  `const`

```ts
const DORMANT_FUSE: CreeperFuse;
```

### DROPPED_ITEM_KIND  `const`

```ts
const DROPPED_ITEM_KIND: EntityKind;
```

### DROPPED_ITEM_PICKUP_RADIUS  `const`

```ts
const DROPPED_ITEM_PICKUP_RADIUS = 1.5;
```

### DUSK_FRACTION  `const`

```ts
const DUSK_FRACTION = 0.75;
```

### Damage  `type`

```ts
type Damage = {
    readonly amount: number;
    readonly cause: DeathCause;
};
```

### DayPhase  `type`

```ts
type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';
```

### DeathCause  `type`

```ts
type DeathCause = 'fall' | 'lava' | 'fire' | 'drowning' | 'suffocation' | 'starvation' | 'mob' | 'projectile' | 'explosion' | 'void' | 'ender_pearl' | 'generic';
```

### DespawnCandidate  `type`

```ts
type DespawnCandidate = {
    readonly distanceToPlayerBlocks: number | undefined;
    readonly persistent: boolean;
};
```

### DespawnReason  `type`

```ts
type DespawnReason = 'too-far' | 'unmeasurable';
```

### DespawnVerdict  `type`

```ts
type DespawnVerdict = {
    readonly _tag: 'Keep';
} | {
    readonly _tag: 'Despawn';
    readonly reason: DespawnReason;
};
```

### DoorBlock  `type`

```ts
type DoorBlock = (typeof DOOR_BLOCKS)[number];
```

### DoorUpperCell  `type`

```ts
type DoorUpperCell = {
    readonly _tag: 'NotADoor';
} | {
    readonly _tag: 'Clear';
    readonly cell: BlockPosition;
} | {
    readonly _tag: 'NoRoomAbove';
};
```

### DropRolls  `type`

```ts
type DropRolls = {
    readonly chance: number;
    readonly count: number;
};
```

### DroppedItemBehaviour  `type`

```ts
type DroppedItemBehaviour = {
    readonly _tag: 'DroppedItem';
    readonly item: ItemType;
    readonly count: number;
    readonly eligibleFromFrame?: number;
};
```

### DroppedItemSpawn  `type`

```ts
type DroppedItemSpawn = {
    readonly item: ItemType;
    readonly count: number;
    readonly at: Position;
    readonly eligibleFromFrame?: number;
};
```

### EMPTY_WORLD  `const`

```ts
const EMPTY_WORLD: WorldContents;
```

### ENDERMAN_CHASE_TELEPORT_CHANCE  `const`

```ts
const ENDERMAN_CHASE_TELEPORT_CHANCE = 0.05;
```

### ENDERMAN_DAMAGE_TELEPORT_CHANCE  `const`

```ts
const ENDERMAN_DAMAGE_TELEPORT_CHANCE = 0.3;
```

### ENDERMAN_KIND  `const`

```ts
const ENDERMAN_KIND: EntityKind;
```

### ENDERMAN_MAX_HEALTH  `const`

```ts
const ENDERMAN_MAX_HEALTH = 40;
```

### ENDERMAN_STUCK_TELEPORT_TICKS  `const`

```ts
const ENDERMAN_STUCK_TELEPORT_TICKS = 40;
```

### ENDERMAN_TELEPORT_ATTEMPTS  `const`

```ts
const ENDERMAN_TELEPORT_ATTEMPTS = 16;
```

### ENDERMAN_TELEPORT_MAX_BLOCKS  `const`

```ts
const ENDERMAN_TELEPORT_MAX_BLOCKS = 32;
```

### ENDERMAN_TELEPORT_MIN_BLOCKS  `const`

```ts
const ENDERMAN_TELEPORT_MIN_BLOCKS = 8;
```

### ENDERMAN_TELEPORT_ROLLS  `const`

```ts
const ENDERMAN_TELEPORT_ROLLS: number;
```

### ENDERMITE_KIND  `const`

```ts
const ENDERMITE_KIND: EntityKind;
```

### ENDERMITE_MAX_HEALTH  `const`

```ts
const ENDERMITE_MAX_HEALTH = 8;
```

### ENDER_PEARL_DAMAGE  `const`

```ts
const ENDER_PEARL_DAMAGE = 5;
```

### ENDER_PEARL_DEATH_CAUSE  `const`

```ts
const ENDER_PEARL_DEATH_CAUSE: DeathCause;
```

### ENDER_PEARL_ENDERMITE_SPAWN_CHANCE  `const`

```ts
const ENDER_PEARL_ENDERMITE_SPAWN_CHANCE = 0.05;
```

### ENDER_PEARL_MAX_DISTANCE  `const`

```ts
const ENDER_PEARL_MAX_DISTANCE = 24;
```

### EXPERIENCE_MODULE_STAGE_PREFIXES  `const`

```ts
const EXPERIENCE_MODULE_STAGE_PREFIXES: readonly ["gameplay:", "redstone:", "ui:", "multiplayer:"];
```

### EYE_LEVEL_OFFSET  `const`

```ts
const EYE_LEVEL_OFFSET = 1.62;
```

### EnderPearlDisplacement  `type`

```ts
type EnderPearlDisplacement = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### EnderPearlOutcome  `type`

```ts
type EnderPearlOutcome = {
    readonly displacement: EnderPearlDisplacement;
    readonly damage: Damage;
};
```

### EnderPearlThrowRequest  `type`

```ts
type EnderPearlThrowRequest = {
    readonly origin: Position;
    readonly dirX: number;
    readonly dirY: number;
    readonly dirZ: number;
    readonly hitDistance?: number;
};
```

### EndermanFlinch  `type`

```ts
type EndermanFlinch = {
    readonly _tag: 'Steady';
} | {
    readonly _tag: 'Struck';
};
```

### EndermanSenses  `type`

```ts
type EndermanSenses = {
    readonly damagedThisStep: boolean;
    readonly stuckTicks: number;
    readonly roll: number;
};
```

### EndermanTeleportUrge  `type`

```ts
type EndermanTeleportUrge = {
    readonly _tag: 'Stay';
} | {
    readonly _tag: 'Teleport';
    readonly reason: TeleportReason;
    readonly anchor: TeleportAnchor;
};
```

### Equipment  `type`

```ts
type Equipment = Partial<Readonly<Record<ArmorSlot, ItemType>>>;
```

### Explosion  `type`

```ts
type Explosion = {
    readonly source: ExplosionSource;
    readonly power: number;
};
```

### ExplosionSource  `type`

```ts
type ExplosionSource = 'creeper';
```

### FALLING_BLOCK_MOVES_PER_TICK  `const`

```ts
const FALLING_BLOCK_MOVES_PER_TICK = 32;
```

### FOOD_PROPERTIES  `const`

```ts
const FOOD_PROPERTIES: Readonly<Partial<Record<ItemType, FoodProperties>>>;
```

### FORTUNE_MULTIPLIERS  `const`

```ts
const FORTUNE_MULTIPLIERS: ReadonlyMap<number, number>;
```

### FallingBlockBatch  `type`

```ts
type FallingBlockBatch = {
    readonly batch: ReadonlyArray<PositionKey>;
    readonly rest: FallingBlockQueue;
};
```

### FallingBlockQueue  `type`

```ts
type FallingBlockQueue = {
    readonly pending: ReadonlySet<PositionKey>;
};
```

### FluidBudgetSplit  `type`

```ts
type FluidBudgetSplit = {
    readonly work: ReadonlyArray<FluidWorkItem>;
    readonly retainedLavaFrontier: ReadonlyArray<PositionKey>;
};
```

### FluidKind  `type`

```ts
type FluidKind = 'water' | 'lava';
```

### FluidWorkItem  `type`

```ts
type FluidWorkItem = {
    readonly key: PositionKey;
    readonly kind: FluidKind;
};
```

### FoodProperties  `type`

```ts
type FoodProperties = {
    readonly foodPoints: number;
    readonly saturationModifier: number;
};
```

### FoodTimerOutcome  `type`

```ts
type FoodTimerOutcome = {
    readonly signal: PlayerFoodTickSignal;
    readonly vitals: PlayerVitals;
    readonly died: boolean;
};
```

### FoodUseOutcome  `type`

```ts
type FoodUseOutcome = ({
    readonly _tag: 'consume';
    readonly count: 1;
} & FoodProperties) | {
    readonly _tag: 'notFood';
} | {
    readonly _tag: 'full';
} | {
    readonly _tag: 'dead';
};
```

### FoodUseRequest  `type`

```ts
type FoodUseRequest = {
    readonly held: ItemType;
    readonly vitals: Pick<PlayerVitals, 'healthPoints' | 'hungerPoints' | 'maxHungerPoints'>;
};
```

### GAMEPLAY_STAGE_IDS  `const`

```ts
const GAMEPLAY_STAGE_IDS: {
    readonly interactions: StageId;
    readonly entities: StageId;
    readonly fluids: StageId;
    readonly timeWeather: StageId;
};
```

### GHAST_DROPS  `const`

```ts
const GHAST_DROPS: ReadonlyArray<MobDropRule>;
```

### GHAST_XP_REWARD  `const`

```ts
const GHAST_XP_REWARD = 5;
```

### GRASS_SEED_DROP_CHANCE  `const`

```ts
const GRASS_SEED_DROP_CHANCE = 0.125;
```

### GRAVITY_M_PER_S2  `const`

```ts
const GRAVITY_M_PER_S2 = 32;
```

### GameplayFrameState  `type`

```ts
type GameplayFrameState = {
    readonly pendingBreaks: Ref.Ref<ReadonlyArray<PositionKey>>;
    readonly pendingPlacements: Ref.Ref<ReadonlyArray<PlacementRequest>>;
    readonly pendingBlockUses: Ref.Ref<ReadonlyArray<BlockUseRequest>>;
    readonly pendingItemUses: Ref.Ref<ReadonlyArray<ItemUseRequest>>;
    readonly pendingBowShots: Ref.Ref<ReadonlyArray<BowShotRequest>>;
    readonly pendingMeleeAttacks: Ref.Ref<ReadonlyArray<MeleeAttackRequest>>;
    readonly pendingPearlThrows: Ref.Ref<ReadonlyArray<EnderPearlThrowRequest>>;
    readonly consumedItems: Ref.Ref<ReadonlyArray<PlaceableItemType>>;
    readonly usedItems: Ref.Ref<ReadonlyArray<IgnitionItemType>>;
    readonly blockUseResults: Ref.Ref<ReadonlyArray<BlockUseResult>>;
    readonly itemUseResults: Ref.Ref<ReadonlyArray<ItemUseResult>>;
    readonly bowShotResults: Ref.Ref<ReadonlyArray<BowShotResult>>;
    readonly handledBowShotRequestIds: Ref.Ref<ReadonlySet<BowShotRequestId>>;
    readonly bowKnockbacks: Ref.Ref<ReadonlyArray<BowKnockback>>;
    readonly enderPearlOutcomes: Ref.Ref<ReadonlyArray<EnderPearlOutcome>>;
    readonly playerDamages: Ref.Ref<ReadonlyArray<PlayerDamageEvent>>;
    readonly hostileContactCooldowns: Ref.Ref<ReadonlyMap<EntityId, number>>;
    readonly mobDrops: Ref.Ref<ReadonlyArray<MobDropEvent>>;
    readonly spawnAttempts: Ref.Ref<ReadonlyArray<MobSpawnAttempt>>;
    readonly targetPosition: Ref.Ref<Position | undefined>;
    readonly timeOfDay: Ref.Ref<number>;
    readonly heldTool: Ref.Ref<BlockLootContext>;
    readonly weather: Ref.Ref<WeatherState>;
    readonly weatherAdvanced: Ref.Ref<WeatherState | undefined>;
    readonly spawnClockSecs: Ref.Ref<number>;
    readonly rollSeed: Ref.Ref<number>;
    readonly fallingBlocks: Ref.Ref<FallingBlockQueue>;
    readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>;
    readonly tickCount: Ref.Ref<number>;
    readonly portalDwell: Ref.Ref<PortalDwell>;
};
```

### GeneratedWorld  `type`

```ts
type GeneratedWorld<S> = InMemoryWorld<S> & {
    readonly worldgenChunkStore: WorldgenChunkStoreApi;
};
```

### GeneratedWorldOptions  `type`

```ts
type GeneratedWorldOptions = {
    readonly seed?: number;
    readonly chunkSource?: ChunkSource;
    readonly spawnX?: number;
    readonly spawnZ?: number;
    readonly yawRadians?: number;
    readonly pitchRadians?: number;
    readonly dimension?: Dimension;
    readonly inventory?: ReadonlyArray<Slot>;
    readonly vitals?: PlayerVitals;
};
```

### HOSTILE_CONTACT_INTERVAL_SECS  `const`

```ts
const HOSTILE_CONTACT_INTERVAL_SECS = 1;
```

### HOSTILE_KINDS  `const`

```ts
const HOSTILE_KINDS: readonly [EntityKind, ...ReadonlyArray<EntityKind>];
```

### HOSTILE_SPAWN_INTERVAL_SECS  `const`

```ts
const HOSTILE_SPAWN_INTERVAL_SECS = 0.3;
```

### HOSTILE_SPAWN_MAX_BLOCK_LIGHT  `const`

```ts
const HOSTILE_SPAWN_MAX_BLOCK_LIGHT = 7;
```

### HeldItemCapabilities  `type`

```ts
type HeldItemCapabilities = {
    readonly charges: boolean;
    readonly blocks: boolean;
};
```

### HostileContactResolution  `type`

```ts
type HostileContactResolution = {
    readonly damages: ReadonlyArray<PlayerDamageEvent>;
    readonly cooldowns: ReadonlyMap<EntityId, number>;
};
```

### HostileLocomotion  `type`

```ts
type HostileLocomotion = {
    readonly speedBlocksPerSecond: number;
    readonly stoppingDistanceBlocks: number;
};
```

### IGNITION_ITEM_TYPES  `const`

```ts
const IGNITION_ITEM_TYPES: readonly ["flint_and_steel", "fire_charge"];
```

### INERT_ITEM  `const`

```ts
const INERT_ITEM: HeldItemCapabilities;
```

### INITIAL_DIMENSION  `const`

```ts
const INITIAL_DIMENSION: Dimension;
```

### INITIAL_PLAYER_POSE  `const`

```ts
const INITIAL_PLAYER_POSE: PlayerPose;
```

### INITIAL_WEATHER  `const`

```ts
const INITIAL_WEATHER: WeatherState;
```

### INSTANT_BREAK  `const`

```ts
const INSTANT_BREAK: AdvanceBreakProgressResult;
```

### INVENTORY_SLOT_COUNT  `const`

```ts
const INVENTORY_SLOT_COUNT = 36;
```

### IgniteFireOutcome  `type`

```ts
type IgniteFireOutcome = {
    readonly _tag: 'Lit';
    readonly position: BlockPosition;
} | {
    readonly _tag: 'Occupied';
    readonly existing: BlockId;
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
} | {
    readonly _tag: 'UnknownBlock';
};
```

### IgnitePortalOutcome  `type`

```ts
type IgnitePortalOutcome = {
    readonly _tag: 'Lit';
    readonly frame: PortalFrame;
    readonly cells: ReadonlyArray<BlockPosition>;
} | {
    readonly _tag: 'NoFrame';
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'UnknownBlock';
};
```

### IgnitionItemType  `type`

```ts
type IgnitionItemType = (typeof IGNITION_ITEM_TYPES)[number];
```

### IgnitionOutcome  `type`

```ts
type IgnitionOutcome = {
    readonly _tag: 'Portal';
    readonly outcome: IgnitePortalOutcome;
} | {
    readonly _tag: 'Fire';
    readonly outcome: IgniteFireOutcome;
};
```

### InMemoryChunkStoreLayer  `const`

```ts
const InMemoryChunkStoreLayer: (contents?: WorldContents) => Layer.Layer<ChunkStore>;
```

### InMemoryEntityManagerLayer  `const`

```ts
const InMemoryEntityManagerLayer: <S>(initial?: EntityRoster<S>, repairBehaviour?: BehaviourRepair<S>) => Layer.Layer<EntityManager>;
```

### InMemoryInventoryLayer  `const`

```ts
const InMemoryInventoryLayer: (initial?: ReadonlyArray<Slot>) => Layer.Layer<InventoryService>;
```

### InMemoryPlayerLayer  `const`

```ts
const InMemoryPlayerLayer: (initialPose?: PlayerPose, initialDimension?: Dimension) => Layer.Layer<PlayerService>;
```

### InMemoryVitalsApi  `type`

```ts
type InMemoryVitalsApi = {
    readonly snapshot: Effect.Effect<PlayerVitals>;
    readonly view: Effect.Effect<PlayerVitalsView>;
    readonly damage: (damage: Damage) => Effect.Effect<VitalsDamageOutcome>;
    readonly heal: (amount: number) => Effect.Effect<PlayerVitals>;
    readonly addExhaustion: (amount: number) => Effect.Effect<void>;
    readonly eat: (foodPoints: number, saturationModifier: number) => Effect.Effect<void>;
    readonly advanceFoodTimer: (dt: DeltaTimeSecs) => Effect.Effect<FoodTimerOutcome>;
    readonly respawn: Effect.Effect<void>;
    readonly restore: (vitals: PlayerVitals) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### InMemoryWorld  `type`

```ts
type InMemoryWorld<S> = {
    readonly layer: Layer.Layer<ChunkStore | EntityManager | InventoryService | PlayerService | TimeService>;
    readonly chunkStore: ChunkStoreApi;
    readonly inventory: InventoryServiceApi;
    readonly player: PlayerServiceApi;
    readonly time: TimeServiceApi;
    readonly entities: EntityManagerApi<S>;
    readonly vitals: InMemoryVitalsApi;
};
```

### InMemoryWorldOptions  `type`

```ts
type InMemoryWorldOptions = {
    readonly world?: WorldContents;
    readonly spawnPose?: PlayerPose;
    readonly dimension?: Dimension;
    readonly inventory?: ReadonlyArray<Slot>;
    readonly vitals?: PlayerVitals;
};
```

### InteractionIntent  `type`

```ts
type InteractionIntent = {
    readonly hasRedstoneInput: boolean;
    readonly canInteract: boolean;
    readonly shouldResetBreakProgress: boolean;
    readonly shouldResetBlocking: boolean;
    readonly shouldReleaseCharge: boolean;
    readonly shouldStartCharge: boolean;
    readonly shouldClearCharge: boolean;
    readonly shouldBlock: boolean;
};
```

### InteractionSnapshot  `type`

```ts
type InteractionSnapshot = {
    readonly paused: boolean;
    readonly isSpectator: boolean;
    readonly leftClick: boolean;
    readonly mouseHeld: boolean;
    readonly middleClick: boolean;
    readonly rightClick: boolean;
    readonly rightMouseHeld: boolean;
    readonly redstoneFlags: RedstoneInputFlags;
    readonly held: HeldItemCapabilities;
    readonly chargeStartedAtSecs: number | null;
};
```

### IsArrowBlockedAt  `type`

```ts
type IsArrowBlockedAt = (wx: number, wy: number, wz: number) => boolean;
```

### IsBlockSolid  `type`

```ts
type IsBlockSolid = (position: BlockPosition) => boolean;
```

### IsRailAt  `type`

```ts
type IsRailAt = (wx: number, wy: number, wz: number) => boolean;
```

### ItemUseRequest  `type`

```ts
type ItemUseRequest = {
    readonly requestId: ItemUseRequestId;
    readonly positionKey: PositionKey;
    readonly heldItem: IgnitionItemType;
};
```

### ItemUseRequestId  `type`

```ts
type ItemUseRequestId = string;
```

### ItemUseResult  `type`

```ts
type ItemUseResult = {
    readonly requestId: ItemUseRequestId;
    readonly heldItem: IgnitionItemType;
    readonly success: boolean;
    readonly outcome: IgnitionOutcome;
};
```

### KNOCKBACK_EPSILON  `const`

```ts
const KNOCKBACK_EPSILON = 1e-9;
```

### KnockbackDirection  `type`

```ts
type KnockbackDirection = {
    readonly _tag: 'Away';
    readonly x: number;
    readonly z: number;
} | {
    readonly _tag: 'StraightUp';
};
```

### LAVA_TICK_INTERVAL  `const`

```ts
const LAVA_TICK_INTERVAL = 4;
```

### LEAF_APPLE_DROP_CHANCE  `const`

```ts
const LEAF_APPLE_DROP_CHANCE = 0.005;
```

### LEAF_SAPLING_DROP_CHANCE  `const`

```ts
const LEAF_SAPLING_DROP_CHANCE = 0.05;
```

### LEAF_STICK_DROP_CHANCE  `const`

```ts
const LEAF_STICK_DROP_CHANCE = 0.02;
```

### LOWEST_ROLLS  `const`

```ts
const LOWEST_ROLLS: DropRolls;
```

### LOWEST_WEATHER_ROLLS  `const`

```ts
const LOWEST_WEATHER_ROLLS: WeatherRolls;
```

### MAX_HEALTH_POINTS  `const`

```ts
const MAX_HEALTH_POINTS = 20;
```

### MAX_HOSTILE_COUNT  `const`

```ts
const MAX_HOSTILE_COUNT = 16;
```

### MAX_MUSHROOM_PLACEMENT_LIGHT  `const`

```ts
const MAX_MUSHROOM_PLACEMENT_LIGHT = 12;
```

### MAX_SPAWN_DISTANCE_BLOCKS  `const`

```ts
const MAX_SPAWN_DISTANCE_BLOCKS = 40;
```

### MIN_SPAWN_DISTANCE_BLOCKS  `const`

```ts
const MIN_SPAWN_DISTANCE_BLOCKS = 16;
```

### MISSING_RIPE_PRODUCE  `const`

```ts
const MISSING_RIPE_PRODUCE: Readonly<Partial<Record<BlockType, string>>>;
```

### MeleeAttackRequest  `type`

```ts
type MeleeAttackRequest = {
    readonly origin: Position;
    readonly direction: Position;
    readonly reach: number;
    readonly damage: number;
    readonly hitDistance?: number;
};
```

### MinedItem  `type`

```ts
type MinedItem = {
    readonly item: ItemType;
    readonly count: number;
};
```

### MobBehaviour  `type`

```ts
type MobBehaviour = CreeperFuse | EndermanFlinch | DroppedItemBehaviour | undefined;
```

### MobCasualty  `type`

```ts
type MobCasualty = {
    readonly id: EntityId;
    readonly kind: EntityKind;
    readonly at: Position;
};
```

### MobDrop  `type`

```ts
type MobDrop = {
    readonly item: ItemType;
    readonly count: number;
};
```

### MobDropEvent  `type`

```ts
type MobDropEvent = MobDrop & {
    readonly source: EntityId;
    readonly kind: EntityKind;
    readonly at: Position;
};
```

### MobDropRule  `type`

```ts
type MobDropRule = {
    readonly item: ItemType;
    readonly count: number;
    readonly chance?: number;
    readonly maxCount?: number;
};
```

### MobFrameSenses  `type`

```ts
type MobFrameSenses = {
    readonly target: Position | undefined;
    readonly dt: DeltaTimeSecs;
};
```

### MobKill  `type`

```ts
type MobKill = {
    readonly _tag: 'Slain';
    readonly lootingLevel: number;
} | {
    readonly _tag: 'SelfDestruct';
};
```

### MobSpawnAttempt  `type`

```ts
type MobSpawnAttempt = {
    readonly candidate: SpawnCandidate;
    readonly kind: EntityKind;
    readonly feetPosition: Position;
};
```

### MobSpawnOutcome  `type`

```ts
type MobSpawnOutcome = {
    readonly _tag: 'Spawned';
    readonly id: EntityId;
} | {
    readonly _tag: 'Refused';
    readonly reason: SpawnRefusal;
} | {
    readonly _tag: 'AtCapacity';
    readonly population: number;
};
```

### MobSweep  `type`

```ts
type MobSweep = {
    readonly blasts: ReadonlyArray<Blast>;
    readonly seed: number;
};
```

### MushroomLightRefusal  `type`

```ts
type MushroomLightRefusal = {
    readonly _tag: 'TooBright';
    readonly light: number;
} | {
    readonly _tag: 'LightUnknown';
};
```

### NOON_FRACTION  `const`

```ts
const NOON_FRACTION = 0.5;
```

### NO_ARMOR  `const`

```ts
const NO_ARMOR: Equipment;
```

### NO_RECIPES  `const`

```ts
const NO_RECIPES: RecipeTable;
```

### NO_TOOL  `const`

```ts
const NO_TOOL: BlockLootContext;
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "gameplay:";
```

### PITCH_MAX_RADIANS  `const`

```ts
const PITCH_MAX_RADIANS: number;
```

### PITCH_MIN_RADIANS  `const`

```ts
const PITCH_MIN_RADIANS: number;
```

### PLAIN_BOW  `const`

```ts
const PLAIN_BOW: BowDrawContext;
```

### PLANTABLE_SEEDS  `const`

```ts
const PLANTABLE_SEEDS: ReadonlyArray<ItemType>;
```

### PLAYER_HALF_HEIGHT  `const`

```ts
const PLAYER_HALF_HEIGHT = 0.9;
```

### PLAYER_HALF_WIDTH  `const`

```ts
const PLAYER_HALF_WIDTH = 0.3;
```

### PORTAL_WINDOW_RADIUS  `const`

```ts
const PORTAL_WINDOW_RADIUS: number;
```

### PlaceOutcome  `type`

```ts
type PlaceOutcome = {
    readonly _tag: 'Placed';
    readonly block: BlockId;
    readonly consumed: PlaceableItemType;
    readonly chunk: ChunkCoord;
    readonly alsoPlaced: ReadonlyArray<BlockPosition>;
} | {
    readonly _tag: 'Occupied';
    readonly existing: BlockId;
} | {
    readonly _tag: 'InsidePlayer';
} | {
    readonly _tag: 'Unsupported';
    readonly support: BlockId;
} | {
    readonly _tag: 'UnknownBlock';
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
} | MushroomLightRefusal | SugarCaneWaterRefusal | CactusSidesRefusal | {
    readonly _tag: 'NoRoomAbove';
};
```

### PlaceRequest  `type`

```ts
type PlaceRequest = {
    readonly position: BlockPosition;
    readonly heldItem: PlaceableItemType;
    readonly playerFeet?: Position;
};
```

### PlaceableItemType  `type`

```ts
type PlaceableItemType = (ItemType & BlockType) | keyof typeof SPECIAL_BLOCK_BY_ITEM;
```

### PlacementRequest  `type`

```ts
type PlacementRequest = {
    readonly positionKey: PositionKey;
    readonly heldItem: PlaceableItemType;
};
```

### PlantOutcome  `type`

```ts
type PlantOutcome = {
    readonly _tag: 'planted';
    readonly crop: BlockType;
    readonly at: BlockPosition;
} | {
    readonly _tag: 'notASeed';
    readonly held: ItemType;
} | {
    readonly _tag: 'wrongSoil';
    readonly crop: BlockType;
    readonly needs: BlockType;
    readonly found: BlockType;
} | {
    readonly _tag: 'occupied';
    readonly crop: BlockType;
    readonly blockedBy: BlockType;
};
```

### PlantPort  `type`

```ts
type PlantPort = {
    readonly blockAt: (position: BlockPosition) => Effect.Effect<number | undefined>;
    readonly setBlock: (position: BlockPosition, block: number) => Effect.Effect<unknown>;
};
```

### PlantRequest  `type`

```ts
type PlantRequest = {
    readonly held: ItemType;
    readonly soil: BlockPosition;
};
```

### PlayerBlast  `type`

```ts
type PlayerBlast = {
    readonly source: EntityId;
    readonly kind: EntityKind;
    readonly at: Position;
    readonly explosion: Explosion;
};
```

### PlayerBody  `type`

```ts
type PlayerBody = {
    readonly centre: Position;
    readonly velocity: Position;
};
```

### PlayerDamageEvent  `type`

```ts
type PlayerDamageEvent = {
    readonly _tag: 'HostileContact';
    readonly source: EntityId;
    readonly kind: EntityKind;
    readonly at: Position;
    readonly damage: Damage;
} | {
    readonly _tag: 'Explosion';
    readonly source: EntityId;
    readonly kind: EntityKind;
    readonly at: Position;
    readonly explosion: Explosion;
    readonly damage: Damage;
};
```

### PlayerFoodTickSignal  `type`

```ts
type PlayerFoodTickSignal = 'none' | 'regen' | 'starve';
```

### PlayerResolution  `type`

```ts
type PlayerResolution = {
    readonly body: PlayerBody;
    readonly isGrounded: boolean;
};
```

### PlayerVitals  `type`

```ts
type PlayerVitals = SimVitals;
```

### PlayerVitalsView  `type`

```ts
type PlayerVitalsView = SimVitalsView;
```

### RAIL_HEADING_EPSILON  `const`

```ts
const RAIL_HEADING_EPSILON = 1e-9;
```

### RAIN_AFTER_THUNDER_CHANCE  `const`

```ts
const RAIN_AFTER_THUNDER_CHANCE = 0.4;
```

### RAIN_DURATION_RANGE_SECS  `const`

```ts
const RAIN_DURATION_RANGE_SECS: WeatherDurationRange;
```

### REDSTONE_INPUT_FLAGS  `const`

```ts
const REDSTONE_INPUT_FLAGS: readonly ["placeWire", "placeLever", "placeButton", "placeTorch", "placePiston", "placeObserver", "placeHopper", "placeRepeater", "placeComparator", "placeDispenser", "toggleLever", "pressButton", "toggleTorch"];
```

### RED_MUSHROOM_BLOCK_ID  `const`

```ts
const RED_MUSHROOM_BLOCK_ID: BlockId | undefined;
```

### RIPE_CROP_YIELD  `const`

```ts
const RIPE_CROP_YIELD: Readonly<Partial<Record<BlockType, {
    readonly item: ItemType;
    readonly span: number;
    readonly floor: number;
}>>>;
```

### ROUTED_BLOCKS  `const`

```ts
const ROUTED_BLOCKS: ReadonlyArray<BlockType>;
```

### RailShape  `type`

```ts
type RailShape = 'ns' | 'ew' | 'curve' | 'isolated';
```

### RedstoneInputFlags  `type`

```ts
type RedstoneInputFlags = Partial<{
    readonly placeWire: boolean;
    readonly placeLever: boolean;
    readonly placeButton: boolean;
    readonly placeTorch: boolean;
    readonly placePiston: boolean;
    readonly placeObserver: boolean;
    readonly placeHopper: boolean;
    readonly placeRepeater: boolean;
    readonly placeComparator: boolean;
    readonly placeDispenser: boolean;
    readonly toggleLever: boolean;
    readonly pressButton: boolean;
    readonly toggleTorch: boolean;
}>;
```

### RightClickRoute  `type`

```ts
type RightClickRoute = {
    readonly kind: 'storage';
    readonly at: BlockPosition;
} | {
    readonly kind: 'craftingTable';
    readonly at: BlockPosition;
} | {
    readonly kind: 'furnace';
    readonly at: BlockPosition;
} | {
    readonly kind: 'bed';
    readonly at: BlockPosition;
} | {
    readonly kind: 'enchantingTable';
    readonly at: BlockPosition;
} | {
    readonly kind: 'anvil';
    readonly at: BlockPosition;
} | {
    readonly kind: 'door';
    readonly at: BlockPosition;
    readonly block: DoorBlock;
};
```

### RollBatch  `type`

```ts
type RollBatch = {
    readonly rolls: ReadonlyArray<number>;
    readonly seed: number;
};
```

### RollDraw  `type`

```ts
type RollDraw = {
    readonly roll: number;
    readonly seed: number;
};
```

### SHULKER_CLOSED_ARMOR_POINTS  `const`

```ts
const SHULKER_CLOSED_ARMOR_POINTS = 20;
```

### SHULKER_OPENING_TICKS  `const`

```ts
const SHULKER_OPENING_TICKS = 20;
```

### SOIL_OF_CROP  `const`

```ts
const SOIL_OF_CROP: Readonly<Partial<Record<BlockType, BlockType>>>;
```

### SPAWN_PLAYER_VITALS  `const`

```ts
const SPAWN_PLAYER_VITALS: PlayerVitals;
```

### STEADY_ENDERMAN  `const`

```ts
const STEADY_ENDERMAN: EndermanFlinch;
```

### STORAGE_BLOCKS  `const`

```ts
const STORAGE_BLOCKS: ReadonlySet<BlockType>;
```

### STRUCK_ENDERMAN  `const`

```ts
const STRUCK_ENDERMAN: EndermanFlinch;
```

### SUGAR_CANE_BLOCK_ID  `const`

```ts
const SUGAR_CANE_BLOCK_ID: BlockId | undefined;
```

### ShotCandidate  `type`

```ts
type ShotCandidate = {
    readonly id: EntityId;
    readonly feetPosition: Position;
};
```

### ShotHit  `type`

```ts
type ShotHit = {
    readonly id: EntityId;
    readonly distance: number;
};
```

### ShulkerSenses  `type`

```ts
type ShulkerSenses = {
    readonly hasTarget: boolean;
    readonly damageTakenThisTick: number;
    readonly healthPoints: number;
    readonly maxHealthPoints: number;
};
```

### ShulkerShell  `type`

```ts
type ShulkerShell = {
    readonly _tag: 'Closed';
} | {
    readonly _tag: 'Opening';
    readonly openedTicks: number;
} | {
    readonly _tag: 'Open';
};
```

### ShulkerStep  `type`

```ts
type ShulkerStep = {
    readonly shell: ShulkerShell;
    readonly canFire: boolean;
};
```

### SpawnCandidate  `type`

```ts
type SpawnCandidate = {
    readonly groundBlock: BlockId;
    readonly footBlock: BlockId;
    readonly headBlock: BlockId;
    readonly blockLight: number;
    readonly timeOfDay: number;
    readonly distanceToPlayerBlocksXZ: number;
};
```

### SpawnRefusal  `type`

```ts
type SpawnRefusal = 'daylight' | 'too-close' | 'too-far' | 'not-a-surface' | 'obstructed' | 'too-bright' | 'unmeasurable';
```

### SpawnVerdict  `type`

```ts
type SpawnVerdict = {
    readonly _tag: 'Spawn';
} | {
    readonly _tag: 'Refused';
    readonly reason: SpawnRefusal;
};
```

### SugarCaneWaterRefusal  `type`

```ts
type SugarCaneWaterRefusal = {
    readonly _tag: 'NoAdjacentWater';
};
```

### TERMINAL_VELOCITY_M_PER_S  `const`

```ts
const TERMINAL_VELOCITY_M_PER_S = 78.4;
```

### THUNDER_AFTER_CLEAR_CHANCE  `const`

```ts
const THUNDER_AFTER_CLEAR_CHANCE = 0.1;
```

### THUNDER_AFTER_RAIN_CHANCE  `const`

```ts
const THUNDER_AFTER_RAIN_CHANCE = 0.3;
```

### THUNDER_DURATION_RANGE_SECS  `const`

```ts
const THUNDER_DURATION_RANGE_SECS: WeatherDurationRange;
```

### TILLABLE_BLOCKS  `const`

```ts
const TILLABLE_BLOCKS: ReadonlySet<BlockType>;
```

### TILLED_BLOCK  `const`

```ts
const TILLED_BLOCK: BlockType;
```

### TWILIGHT_BAND  `const`

```ts
const TWILIGHT_BAND = 0.05;
```

### TargetedPrimaryAttackOptions  `type`

```ts
type TargetedPrimaryAttackOptions = {
    readonly meleeReach?: number;
    readonly meleeDamage?: number;
    readonly blockReach?: number;
};
```

### TargetedPrimaryAttackResult  `type`

```ts
type TargetedPrimaryAttackResult = {
    readonly _tag: 'Melee';
    readonly target: ShotHit;
} | {
    readonly _tag: 'Block';
    readonly target: BlockTarget;
} | {
    readonly _tag: 'None';
};
```

### TeleportAnchor  `type`

```ts
type TeleportAnchor = 'self' | 'target';
```

### TeleportOffset  `type`

```ts
type TeleportOffset = {
    readonly xBlocks: number;
    readonly zBlocks: number;
};
```

### TeleportReason  `type`

```ts
type TeleportReason = 'damaged' | 'stuck' | 'restless';
```

### TillOutcome  `type`

```ts
type TillOutcome = {
    readonly _tag: 'tilled';
    readonly at: BlockPosition;
} | {
    readonly _tag: 'noHoe';
} | {
    readonly _tag: 'notTillable';
    readonly found: BlockType;
} | {
    readonly _tag: 'obstructed';
    readonly blockedBy: BlockType;
};
```

### TillPort  `type`

```ts
type TillPort = {
    readonly blockAt: (position: BlockPosition) => Effect.Effect<number | undefined>;
    readonly setBlock: (position: BlockPosition, block: number) => Effect.Effect<unknown>;
};
```

### TillingCapability  `type`

```ts
type TillingCapability = {
    readonly tills: boolean;
};
```

### UNREADABLE_BLOCK  `const`

```ts
const UNREADABLE_BLOCK = -1;
```

### UNRIPE_CROP_DROP  `const`

```ts
const UNRIPE_CROP_DROP: Readonly<Partial<Record<BlockType, CropDrop>>>;
```

### UPSTREAM_STAGE_IDS  `const`

```ts
const UPSTREAM_STAGE_IDS: {
    readonly simPhysics: StageId;
};
```

### UnequipOutcome  `type`

```ts
type UnequipOutcome = {
    readonly _tag: 'unequipped';
    readonly slot: ArmorSlot;
    readonly item: ItemType;
} | {
    readonly _tag: 'nothingWorn';
} | {
    readonly _tag: 'inventoryFull';
    readonly slot: ArmorSlot;
    readonly item: ItemType;
};
```

### UnequipPort  `type`

```ts
type UnequipPort = {
    readonly unequip: (slot: ArmorSlot) => Effect.Effect<unknown>;
    readonly equip: (slot: ArmorSlot, item: ItemType) => Effect.Effect<unknown>;
    readonly add: (item: ItemType, count: number) => Effect.Effect<number>;
};
```

### Vitals  `type`

```ts
type Vitals = {
    readonly healthPoints: number;
    readonly lastDeathCause: DeathCause | undefined;
};
```

### VitalsDamageOutcome  `type`

```ts
type VitalsDamageOutcome = {
    readonly vitals: PlayerVitals;
    readonly died: boolean;
};
```

### WEATHERS  `const`

```ts
const WEATHERS: ReadonlyArray<Weather>;
```

### WEATHER_DURATION_RANGES  `const`

```ts
const WEATHER_DURATION_RANGES: Readonly<Record<Weather, WeatherDurationRange>>;
```

### WEATHER_TRANSITION_ROLLS  `const`

```ts
const WEATHER_TRANSITION_ROLLS = 2;
```

### Weather  `type`

```ts
type Weather = 'clear' | 'rain' | 'thunder';
```

### WeatherDurationRange  `type`

```ts
type WeatherDurationRange = {
    readonly min: number;
    readonly max: number;
};
```

### WeatherRolls  `type`

```ts
type WeatherRolls = {
    readonly transition: number;
    readonly duration: number;
};
```

### WeatherState  `type`

```ts
type WeatherState = {
    readonly weather: Weather;
    readonly remainingSecs: number;
};
```

### WorldContents  `type`

```ts
type WorldContents = {
    readonly blocks: ReadonlyMap<string, BlockId>;
    readonly loaded: Iterable<string>;
    readonly lights?: ReadonlyMap<string, CellLight>;
};
```

### ZOMBIE_CONTACT_DAMAGE  `const`

```ts
const ZOMBIE_CONTACT_DAMAGE: Damage;
```

### ZOMBIE_CONTACT_RANGE_BLOCKS  `const`

```ts
const ZOMBIE_CONTACT_RANGE_BLOCKS = 1.5;
```

### ZOMBIE_KIND  `const`

```ts
const ZOMBIE_KIND: EntityKind;
```

### ZOMBIE_LOCOMOTION  `const`

```ts
const ZOMBIE_LOCOMOTION: HostileLocomotion;
```

### adaptGeneratedChunkStore  `const`

```ts
const adaptGeneratedChunkStore: (store: WorldgenChunkStoreApi) => ChunkStoreApi;
```

### addToSlots  `const`

```ts
const addToSlots: (slots: ReadonlyArray<Slot>, item: ItemType, count: number) => {
    readonly slots: ReadonlyArray<Slot>;
    readonly accepted: number;
};
```

### advanceBreakProgress  `const`

```ts
const advanceBreakProgress: (input: AdvanceBreakProgressInput) => AdvanceBreakProgressResult;
```

### advanceWeather  `const`

```ts
const advanceWeather: (state: WeatherState, dt: number, rolls: WeatherRolls) => WeatherState;
```

### anyRedstoneInput  `const`

```ts
const anyRedstoneInput: (flags: RedstoneInputFlags) => boolean;
```

### applyDamage  `const`

```ts
const applyDamage: (vitals: Vitals, damage: Damage) => Vitals;
```

### applyGravity  `const`

```ts
const applyGravity: (velocityY: number, deltaSecs: number) => number;
```

### applyLook  `const`

```ts
const applyLook: (pose: PlayerPose, deltaYaw: number, deltaPitch: number) => PlayerPose;
```

### applySpawnAttempts  `const`

```ts
const applySpawnAttempts: (roster: EntityManagerApi<MobBehaviour>, attempts: ReadonlyArray<MobSpawnAttempt>) => Effect.Effect<ReadonlyArray<MobSpawnOutcome>>;
```

### blockLoot  `const`

```ts
const blockLoot: (block: BlockId, context?: BlockLootContext, rolls?: ReadonlyArray<number>) => ReadonlyArray<MinedItem>;
```

### blockOfPlaceableItem  `const`

```ts
const blockOfPlaceableItem: (item: PlaceableItemType) => BlockType;
```

### blockOverlapsPlayer  `const`

```ts
const blockOverlapsPlayer: (block: BlockPosition, playerFeet: Position) => boolean;
```

### bowCharge  `const`

```ts
const bowCharge: (secsHeld: number) => number;
```

### bowDamage  `const`

```ts
const bowDamage: (charge: number, context?: BowDrawContext) => number;
```

### bowPowerMultiplier  `const`

```ts
const bowPowerMultiplier: (powerLevel: number | undefined) => number;
```

### breakProgressFraction  `const`

```ts
const breakProgressFraction: (state: BreakProgressState) => number;
```

### cactusSidesObjection  `const`

```ts
const cactusSidesObjection: (store: ChunkStoreApi, block: BlockId, position: BlockPosition) => Effect.Effect<CactusSidesRefusal | undefined>;
```

### canFireBow  `const`

```ts
const canFireBow: (secsHeld: number) => boolean;
```

### canHostileSpawnAt  `const`

```ts
const canHostileSpawnAt: (candidate: SpawnCandidate) => SpawnVerdict;
```

### carryOver  `const`

```ts
const carryOver: (frontier: ReadonlyArray<FluidWorkItem>, split: FluidBudgetSplit) => ReadonlyArray<FluidWorkItem>;
```

### carveExplosionCrater  `const`

```ts
const carveExplosionCrater: (store: ChunkStoreApi, centre: BlockPosition, power: number) => Effect.Effect<ReadonlyArray<PositionKey>>;
```

### cellAbove  `const`

```ts
const cellAbove: (ground: BlockPosition) => BlockPosition;
```

### cellKey  `const`

```ts
const cellKey: (position: BlockPosition) => string;
```

### cellOf  `const`

```ts
const cellOf: (position: Position) => BlockPosition;
```

### chunkCoordOf  `const`

```ts
const chunkCoordOf: (position: BlockPosition) => ChunkCoord;
```

### chunkCoordsAround  `const`

```ts
const chunkCoordsAround: (centre: BlockPosition, radius: number) => ReadonlyArray<ChunkCoord>;
```

### chunkKey  `const`

```ts
const chunkKey: (coord: ChunkCoord) => string;
```

### chunkOf  `const`

```ts
const chunkOf: (position: BlockPosition) => ChunkCoord;
```

### clampPitch  `const`

```ts
const clampPitch: (pitchRadians: number) => number;
```

### craterCells  `const`

```ts
const craterCells: (centre: BlockPosition, power: number) => ReadonlyArray<BlockPosition>;
```

### craterRadius  `const`

```ts
const craterRadius: (power: number) => number;
```

### createWeatherState  `const`

```ts
const createWeatherState: (weather: Weather, durationRoll: number) => WeatherState;
```

### cropCellAbove  `const`

```ts
const cropCellAbove: (soil: BlockPosition) => BlockPosition;
```

### cropDrops  `const`

```ts
const cropDrops: (block: BlockType, ripe: boolean, roll: number) => CropDropOutcome;
```

### dayPhase  `const`

```ts
const dayPhase: (timeOfDay: number) => DayPhase;
```

### deathMessage  `const`

```ts
const deathMessage: (vitals: Vitals) => string | undefined;
```

### describeDeath  `const`

```ts
const describeDeath: (cause: DeathCause) => string;
```

### despawnVerdict  `const`

```ts
const despawnVerdict: (candidate: DespawnCandidate) => DespawnVerdict;
```

### distanceBetween  `const`

```ts
const distanceBetween: (from: Position, to: Position) => number;
```

### disturb  `const`

```ts
const disturb: (queue: FallingBlockQueue, positions: Iterable<PositionKey>) => FallingBlockQueue;
```

### doorUpperCell  `const`

```ts
const doorUpperCell: (store: ChunkStoreApi, block: BlockId, position: BlockPosition) => Effect.Effect<DoorUpperCell>;
```

### drainBlockUseResults  `const`

```ts
const drainBlockUseResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<BlockUseResult>>;
```

### drainBowShotResults  `const`

```ts
const drainBowShotResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<BowShotResult>>;
```

### drainItemUseResults  `const`

```ts
const drainItemUseResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<ItemUseResult>>;
```

### drainMobDrops  `const`

```ts
const drainMobDrops: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<MobDropEvent>>;
```

### drainPlayerDamages  `const`

```ts
const drainPlayerDamages: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<PlayerDamageEvent>>;
```

### drawRolls  `const`

```ts
const drawRolls: (seed: number, count: number) => RollBatch;
```

### dropPasses  `const`

```ts
const dropPasses: (rule: MobDropRule, roll: number) => boolean;
```

### dropRollsNeeded  `const`

```ts
const dropRollsNeeded: (kind: EntityKind) => number;
```

### dropRulesOfKind  `const`

```ts
const dropRulesOfKind: (kind: EntityKind) => ReadonlyArray<MobDropRule>;
```

### emptyFallingBlockQueue  `const`

```ts
const emptyFallingBlockQueue: FallingBlockQueue;
```

### emptyRoster  `const`

```ts
const emptyRoster: <S>() => EntityRoster<S>;
```

### emptySlots  `const`

```ts
const emptySlots: () => ReadonlyArray<Slot>;
```

### enderPearlDisplacement  `const`

```ts
const enderPearlDisplacement: (dirX: number, dirY: number, dirZ: number, hitDistance: number | undefined) => EnderPearlDisplacement | undefined;
```

### enderPearlDistance  `const`

```ts
const enderPearlDistance: (hitDistance: number | undefined) => number;
```

### endermanTeleportOffset  `const`

```ts
const endermanTeleportOffset: (rolls: ReadonlyArray<number>) => TeleportOffset | undefined;
```

### endermanTeleportUrge  `const`

```ts
const endermanTeleportUrge: (senses: EndermanSenses) => EndermanTeleportUrge;
```

### explosionDamageAmount  `const`

```ts
const explosionDamageAmount: (power: number, distanceToCentre: number, exposure?: number) => number;
```

### explosionDamageAt  `const`

```ts
const explosionDamageAt: (explosion: Explosion, distanceToCentre: number, exposure?: number) => Damage;
```

### explosionRadius  `const`

```ts
const explosionRadius: (power: number) => number;
```

### firstWornSlot  `const`

```ts
const firstWornSlot: (equipment: Equipment) => ArmorSlot | undefined;
```

### fullHealth  `const`

```ts
const fullHealth: Vitals;
```

### gameplayModule  `const`

```ts
const gameplayModule: GameModule<never, never, never, ChunkStore | EntityManager | InventoryService | PlayerService | TimeService>;
```

### gameplayStages  `const`

```ts
const gameplayStages: (state: GameplayFrameState, store: ChunkStoreApi, roster: EntityManagerApi<MobBehaviour>, inventory: InventoryServiceApi, player: PlayerServiceApi, time: TimeServiceApi) => ReadonlyArray<StageRegistration>;
```

### hasClearCactusHorizontalSides  `const`

```ts
const hasClearCactusHorizontalSides: (sides: ReadonlyArray<BlockReading>) => boolean;
```

### hasRequiredSugarCaneAdjacentWater  `const`

```ts
const hasRequiredSugarCaneAdjacentWater: (supportBelow: BlockReading | undefined, besideSupport: ReadonlyArray<BlockReading>) => boolean;
```

### hostilePopulation  `const`

```ts
const hostilePopulation: <S>(roster: EntityManagerApi<S>) => Effect.Effect<number>;
```

### hostileSpawnsAllowed  `const`

```ts
const hostileSpawnsAllowed: (timeOfDay: number) => boolean;
```

### igniteFire  `const`

```ts
const igniteFire: (store: ChunkStoreApi, position: BlockPosition) => Effect.Effect<IgniteFireOutcome>;
```

### ignitePortal  `const`

```ts
const ignitePortal: (store: ChunkStoreApi, ignition: BlockPosition) => Effect.Effect<IgnitePortalOutcome>;
```

### initialBehaviourOfKind  `const`

```ts
const initialBehaviourOfKind: (kind: EntityKind) => MobBehaviour;
```

### isAscendingAhead  `const`

```ts
const isAscendingAhead: (isRailAt: IsRailAt, wx: number, wy: number, wz: number, headingX: number, headingZ: number) => boolean;
```

### isCactusBlock  `const`

```ts
const isCactusBlock: (block: BlockId) => boolean;
```

### isDead  `const`

```ts
const isDead: (vitals: Vitals) => boolean;
```

### isDoorBlock  `const`

```ts
const isDoorBlock: (block: BlockId) => boolean;
```

### isDroppedItemBehaviour  `const`

```ts
const isDroppedItemBehaviour: (value: unknown) => value is DroppedItemBehaviour;
```

### isIgnitionItem  `const`

```ts
const isIgnitionItem: (item: ItemType) => item is IgnitionItemType;
```

### isInWorld  `const`

```ts
const isInWorld: (position: BlockPosition) => boolean;
```

### isMushroomBlock  `const`

```ts
const isMushroomBlock: (block: BlockId) => boolean;
```

### isMushroomPlacementLightAllowed  `const`

```ts
const isMushroomPlacementLightAllowed: (block: BlockId, lightLevel: number) => boolean;
```

### isNight  `const`

```ts
const isNight: (timeOfDay: number) => boolean;
```

### isPlaceableItem  `const`

```ts
const isPlaceableItem: (item: ItemType) => item is PlaceableItemType;
```

### isPrecipitating  `const`

```ts
const isPrecipitating: (weather: Weather) => boolean;
```

### isSuccessfulBlockUse  `const`

```ts
const isSuccessfulBlockUse: (outcome: BlockUseOutcome) => boolean;
```

### isSugarCaneBlock  `const`

```ts
const isSugarCaneBlock: (block: BlockId) => boolean;
```

### isSupportSensitiveOfBlock  `const`

```ts
const isSupportSensitiveOfBlock: (block: BlockId) => boolean;
```

### isThunderstorm  `const`

```ts
const isThunderstorm: (weather: Weather) => boolean;
```

### isValidPlayerVitals  `const`

```ts
const isValidPlayerVitals: (vitals: PlayerVitals) => boolean;
```

### itemOfBlock  `const`

```ts
const itemOfBlock: (block: BlockType) => ItemType | undefined;
```

### knockbackDirection  `const`

```ts
const knockbackDirection: (dx: number, dz: number) => KnockbackDirection;
```

### makeGameplayFrameState  `const`

```ts
const makeGameplayFrameState: Effect.Effect<GameplayFrameState>;
```

### makeGameplayStages  `const`

```ts
const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, ChunkStore | EntityManager | InventoryService | PlayerService | TimeService>;
```

### makeGeneratedWorld  `const`

```ts
const makeGeneratedWorld: <S>(options?: GeneratedWorldOptions) => Effect.Effect<GeneratedWorld<S>>;
```

### makeInMemoryChunkStore  `const`

```ts
const makeInMemoryChunkStore: (contents?: WorldContents) => Effect.Effect<ChunkStoreApi>;
```

### makeInMemoryEntityManager  `const`

```ts
const makeInMemoryEntityManager: <S>(initial?: EntityRoster<S>, repairBehaviour?: BehaviourRepair<S>) => Effect.Effect<EntityManagerApi<S>>;
```

### makeInMemoryInventory  `const`

```ts
const makeInMemoryInventory: (initial?: ReadonlyArray<Slot>) => Effect.Effect<InventoryServiceApi>;
```

### makeInMemoryPlayer  `const`

```ts
const makeInMemoryPlayer: (initialPose?: PlayerPose, initialDimension?: Dimension) => Effect.Effect<PlayerServiceApi>;
```

### makeInMemoryVitals  `const`

```ts
const makeInMemoryVitals: (initial?: PlayerVitals) => Effect.Effect<InMemoryVitalsApi>;
```

### makeInMemoryWorld  `const`

```ts
const makeInMemoryWorld: <S>(options?: InMemoryWorldOptions) => Effect.Effect<InMemoryWorld<S>>;
```

### maxHealthOfKind  `const`

```ts
const maxHealthOfKind: (kind: EntityKind) => number;
```

### meleeTarget  `const`

```ts
const meleeTarget: (candidates: ReadonlyArray<Entity<MobBehaviour>>, request: MeleeAttackRequest) => ShotHit | undefined;
```

### meleeTargetBeforeBlock  `const`

```ts
const meleeTargetBeforeBlock: (candidates: ReadonlyArray<Entity<MobBehaviour>>, request: Omit<MeleeAttackRequest, "hitDistance">, blockDistance: number | undefined) => ShotHit | undefined;
```

### mintEntityId  `const`

```ts
const mintEntityId: (kind: EntityKind, serial: number) => EntityId;
```

### mobXpReward  `const`

```ts
const mobXpReward: (kill: MobKill, reward: number) => number;
```

### mushroomLightObjection  `const`

```ts
const mushroomLightObjection: (store: ChunkStoreApi, block: BlockId, position: BlockPosition) => Effect.Effect<MushroomLightRefusal | undefined>;
```

### nextRoll  `const`

```ts
const nextRoll: (seed: number) => RollDraw;
```

### normaliseBreakTicks  `const`

```ts
const normaliseBreakTicks: (breakTicks: number) => number;
```

### normaliseInventory  `const`

```ts
const normaliseInventory: (inventory: Inventory) => {
    readonly slots: ReadonlyArray<Slot>;
    readonly discarded: number;
};
```

### normaliseSeed  `const`

```ts
const normaliseSeed: (seed: number) => number;
```

### openChunkWindow  `const`

```ts
const openChunkWindow: (store: ChunkStoreApi, coords: ReadonlyArray<ChunkCoord>) => Effect.Effect<ChunkWindow>;
```

### pickupDroppedItems  `const`

```ts
const pickupDroppedItems: (roster: EntityManagerApi<MobBehaviour>, inventory: InventoryServiceApi, playerPosition: Position | undefined, radius?: number, currentFrame?: number) => Effect.Effect<void>;
```

### placeBlock  `const`

```ts
const placeBlock: (store: ChunkStoreApi, request: PlaceRequest) => Effect.Effect<PlaceOutcome>;
```

### placementLightLevel  `const`

```ts
const placementLightLevel: (sky: number, block: number) => number;
```

### placementVerdict  `const`

```ts
const placementVerdict: (request: PlaceRequest, target: BlockReading, supportBelow: BlockReading | undefined) => PlaceOutcome | {
    readonly _tag: "Allowed";
    readonly block: BlockId;
};
```

### plantCrop  `const`

```ts
const plantCrop: (port: PlantPort, request: PlantRequest) => Effect.Effect<PlantOutcome>;
```

### plantingVerdict  `const`

```ts
const plantingVerdict: (request: PlantRequest, soilBlock: BlockType, blockAbove: BlockType) => PlantOutcome;
```

### pursueHorizontally  `const`

```ts
const pursueHorizontally: (from: Position, target: Position | undefined, dt: number, locomotion: HostileLocomotion) => Position;
```

### removeFromSlots  `const`

```ts
const removeFromSlots: (slots: ReadonlyArray<Slot>, item: ItemType, count: number) => {
    readonly slots: ReadonlyArray<Slot>;
    readonly removed: number;
};
```

### repairMobBehaviour  `const`

```ts
const repairMobBehaviour: (kind: EntityKind, behaviour: MobBehaviour) => MobBehaviour;
```

### repairRoster  `const`

```ts
const repairRoster: <S>(roster: EntityRoster<S>, repairBehaviour: BehaviourRepair<S>) => {
    readonly roster: EntityRoster<S>;
    readonly repair: RosterRepair;
};
```

### requestBlockBreak  `const`

```ts
const requestBlockBreak: (state: GameplayFrameState, position: BlockPosition) => Effect.Effect<void>;
```

### requestBlockPlacement  `const`

```ts
const requestBlockPlacement: (state: GameplayFrameState, request: PlacementRequest) => Effect.Effect<void>;
```

### requestBlockUse  `const`

```ts
const requestBlockUse: (state: GameplayFrameState, requestId: BlockUseRequestId, position: BlockPosition) => Effect.Effect<void>;
```

### requestBowShot  `function`

```ts
function requestBowShot(state: GameplayFrameState, request: BowShotRequest): Effect.Effect<void>;
```

### requestBowShot  `function`

```ts
function requestBowShot(state: GameplayFrameState, requestId: BowShotRequestId, request: Omit<BowShotRequest, 'requestId'>): Effect.Effect<void>;
```

### requestItemUse  `const`

```ts
const requestItemUse: (state: GameplayFrameState, requestId: ItemUseRequestId, position: BlockPosition, heldItem: IgnitionItemType) => Effect.Effect<void>;
```

### requestMeleeAttack  `const`

```ts
const requestMeleeAttack: (state: GameplayFrameState, request: MeleeAttackRequest) => Effect.Effect<void>;
```

### requestMobSpawn  `const`

```ts
const requestMobSpawn: (state: GameplayFrameState, attempt: MobSpawnAttempt) => Effect.Effect<void>;
```

### requestTargetedBlockBreak  `const`

```ts
const requestTargetedBlockBreak: (state: GameplayFrameState, store: ChunkStoreApi, player: PlayerServiceApi, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### requestTargetedBlockPlacement  `const`

```ts
const requestTargetedBlockPlacement: (state: GameplayFrameState, store: ChunkStoreApi, player: PlayerServiceApi, heldItem: PlaceableItemType, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### requestTargetedBlockUse  `const`

```ts
const requestTargetedBlockUse: (state: GameplayFrameState, store: ChunkStoreApi, player: PlayerServiceApi, requestId: BlockUseRequestId, heldItem: PlaceableItemType, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### requestTargetedItemUse  `const`

```ts
const requestTargetedItemUse: (state: GameplayFrameState, store: ChunkStoreApi, player: PlayerServiceApi, requestId: ItemUseRequestId, heldItem: IgnitionItemType, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### requestTargetedPrimaryAttack  `const`

```ts
const requestTargetedPrimaryAttack: (state: GameplayFrameState, store: ChunkStoreApi, roster: EntityManagerApi<MobBehaviour>, player: PlayerServiceApi, options?: TargetedPrimaryAttackOptions) => Effect.Effect<TargetedPrimaryAttackResult>;
```

### resolveBlasts  `const`

```ts
const resolveBlasts: (roster: EntityManagerApi<MobBehaviour>, store: ChunkStoreApi, blasts: ReadonlyArray<Blast>) => Effect.Effect<BlastResolution>;
```

### resolveBlockUse  `const`

```ts
const resolveBlockUse: (position: BlockPosition, reading: BlockReading) => BlockUseOutcome;
```

### resolveBowHits  `const`

```ts
const resolveBowHits: (roster: EntityManagerApi<MobBehaviour>, hits: ReadonlyArray<BowHit>) => Effect.Effect<ReadonlyArray<MobCasualty>>;
```

### resolveFoodUse  `const`

```ts
const resolveFoodUse: ({ held, vitals }: FoodUseRequest) => FoodUseOutcome;
```

### resolveHostileContacts  `const`

```ts
const resolveHostileContacts: <S>(entities: ReadonlyArray<Entity<S>>, target: Position | undefined, dt: number, previousCooldowns: ReadonlyMap<EntityId, number>) => HostileContactResolution;
```

### resolveInteractionIntent  `const`

```ts
const resolveInteractionIntent: (snapshot: InteractionSnapshot) => InteractionIntent;
```

### resolveMeleeHits  `const`

```ts
const resolveMeleeHits: (roster: EntityManagerApi<MobBehaviour>, hits: ReadonlyArray<BowHit>) => Effect.Effect<ReadonlyArray<MobCasualty>>;
```

### resolveNextWeatherState  `const`

```ts
const resolveNextWeatherState: (current: Weather, rolls: WeatherRolls) => WeatherState;
```

### resolvePlayerBlastDamage  `const`

```ts
const resolvePlayerBlastDamage: (blasts: ReadonlyArray<PlayerBlast>, target: Position | undefined) => ReadonlyArray<PlayerDamageEvent>;
```

### resolvePlayerMovement  `const`

```ts
const resolvePlayerMovement: (body: PlayerBody, deltaSecs: number, isBlockSolid: IsBlockSolid) => PlayerResolution;
```

### resolveRailShape  `const`

```ts
const resolveRailShape: (isRailAt: IsRailAt, wx: number, wy: number, wz: number) => RailShape;
```

### resolveWeatherDurationSecs  `const`

```ts
const resolveWeatherDurationSecs: (weather: Weather, roll: number) => number;
```

### rightClickRoute  `const`

```ts
const rightClickRoute: (at: BlockPosition, block: BlockType | undefined) => RightClickRoute | undefined;
```

### ripeYieldRange  `const`

```ts
const ripeYieldRange: (block: BlockType) => {
    readonly min: number;
    readonly max: number;
} | undefined;
```

### rollAt  `const`

```ts
const rollAt: (batch: RollBatch, index: number) => number;
```

### rollCasualtyDrops  `const`

```ts
const rollCasualtyDrops: (casualties: ReadonlyArray<MobCasualty>, seed: number) => CasualtyDrops;
```

### rollDropsOfKind  `const`

```ts
const rollDropsOfKind: (kind: EntityKind, kill: MobKill, rolls: ReadonlyArray<number>) => ReadonlyArray<MobDrop>;
```

### rollFortuneExtraDrops  `const`

```ts
const rollFortuneExtraDrops: (level: number, roll: number) => number;
```

### rollMobDrop  `const`

```ts
const rollMobDrop: (rule: MobDropRule, kill: MobKill, rolls: DropRolls) => MobDrop | undefined;
```

### rollMobDrops  `const`

```ts
const rollMobDrops: (rules: ReadonlyArray<MobDropRule>, kill: MobKill, rollsFor: (index: number) => DropRolls) => ReadonlyArray<MobDrop>;
```

### rollSelfDestructDrops  `const`

```ts
const rollSelfDestructDrops: (blast: Blast) => ReadonlyArray<MobDropEvent>;
```

### settled  `const`

```ts
const settled: (queue: FallingBlockQueue, destinations: Iterable<PositionKey>) => FallingBlockQueue;
```

### shotBlockedByTerrain  `const`

```ts
const shotBlockedByTerrain: (isArrowBlockedAt: IsArrowBlockedAt, from: Position, to: Position) => boolean;
```

### shotTarget  `const`

```ts
const shotTarget: (candidates: ReadonlyArray<ShotCandidate>, origin: Position, dirX: number, dirY: number, dirZ: number, reach?: number) => ShotHit | undefined;
```

### shouldSpawnEndermite  `const`

```ts
const shouldSpawnEndermite: (roll: number) => boolean;
```

### shulkerShellArmorPoints  `const`

```ts
const shulkerShellArmorPoints: (shell: ShulkerShell) => number;
```

### shulkerWantsToTeleport  `const`

```ts
const shulkerWantsToTeleport: (senses: ShulkerSenses) => boolean;
```

### solidityFromStore  `const`

```ts
const solidityFromStore: (store: ChunkStoreApi) => (position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}) => boolean;
```

### spawnDroppedItem  `const`

```ts
const spawnDroppedItem: (roster: EntityManagerApi<MobBehaviour>, drop: DroppedItemSpawn) => Effect.Effect<Entity<MobBehaviour>>;
```

### spawnDroppedItems  `const`

```ts
const spawnDroppedItems: (roster: EntityManagerApi<MobBehaviour>, drops: ReadonlyArray<DroppedItemSpawn>) => Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>>;
```

### spawnMobDrop  `const`

```ts
const spawnMobDrop: (roster: EntityManagerApi<MobBehaviour>, drop: MobDropEvent) => Effect.Effect<Entity<MobBehaviour>>;
```

### spawnMobDrops  `const`

```ts
const spawnMobDrops: (roster: EntityManagerApi<MobBehaviour>, drops: ReadonlyArray<MobDropEvent>) => Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>>;
```

### splitBudget  `const`

```ts
const splitBudget: (frontier: ReadonlyArray<FluidWorkItem>, options: {
    readonly budget?: number;
    readonly lavaTickActive: boolean;
}) => FluidBudgetSplit;
```

### stepCreeperFuse  `const`

```ts
const stepCreeperFuse: (fuse: CreeperFuse, senses: CreeperSenses, dt: DeltaTimeSecs) => CreeperStep;
```

### stepShulkerShell  `const`

```ts
const stepShulkerShell: (shell: ShulkerShell, senses: ShulkerSenses) => ShulkerStep;
```

### sugarCaneWaterObjection  `const`

```ts
const sugarCaneWaterObjection: (store: ChunkStoreApi, block: BlockId, position: BlockPosition, supportBelow: BlockReading | undefined) => Effect.Effect<SugarCaneWaterRefusal | undefined>;
```

### sweepMobs  `const`

```ts
const sweepMobs: (roster: EntityManagerApi<MobBehaviour>, senses: MobFrameSenses, seed: number) => Effect.Effect<MobSweep>;
```

### takeBatch  `const`

```ts
const takeBatch: (queue: FallingBlockQueue, budget?: number) => FallingBlockBatch;
```

### targetabilityFromStore  `const`

```ts
const targetabilityFromStore: (store: ChunkStoreApi) => (x: number, y: number, z: number) => boolean;
```

### tillSoil  `const`

```ts
const tillSoil: (port: TillPort, held: TillingCapability, ground: BlockPosition) => Effect.Effect<TillOutcome>;
```

### tillingVerdict  `const`

```ts
const tillingVerdict: (held: TillingCapability, ground: BlockPosition, groundBlock: BlockType, blockAbove: BlockType) => TillOutcome;
```

### totalOf  `const`

```ts
const totalOf: (slots: ReadonlyArray<Slot>, item: ItemType) => number;
```

### unequipTopmost  `const`

```ts
const unequipTopmost: (port: UnequipPort, equipment: Equipment) => Effect.Effect<UnequipOutcome>;
```

### useFlintAndSteel  `const`

```ts
const useFlintAndSteel: (store: ChunkStoreApi, position: BlockPosition, item: IgnitionItemType) => Effect.Effect<IgnitionOutcome>;
```

### weatherExpires  `const`

```ts
const weatherExpires: (state: WeatherState, dt: number) => boolean;
```

### weatherLightScale  `const`

```ts
const weatherLightScale: (weather: Weather) => number;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

### BLOCK_TYPES  `const`

```ts
const BLOCK_TYPES: readonly ["air", "stone", "cobblestone", "dirt", "grass_block", "sand", "gravel", "water", "lava", "oak_log", "oak_planks", "oak_leaves", "glass", "torch", "glowstone", "bedrock", "piston", "snow", "ladder", "cobweb", "sapling", "dandelion", "poppy", "brown_mushroom", "red_mushroom", "tall_grass", "fern", "sugar_cane", "lily_pad", "kelp", "seagrass", "rail", "powered_rail", "cactus", "pressure_plate", "stone_slab", "granite", "diorite", "andesite", "deepslate", "obsidian", "smooth_basalt", "calcite", "amethyst_block", "amethyst_cluster", "sandstone", "prismarine", "soul_sand", "ice", "farmland", "coal_ore", "iron_ore", "gold_ore", "diamond_ore", "redstone_ore", "lapis_ore", "emerald_ore", "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_gold_ore", "deepslate_diamond_ore", "deepslate_redstone_ore", "deepslate_lapis_ore", "deepslate_emerald_ore", "coal_block", "iron_block", "gold_block", "diamond_block", "redstone_block", "lapis_block", "emerald_block", "wheat_crop", "potato_crop", "nether_wart_crop", "redstone_wire", "redstone_torch", "lever", "stone_button", "repeater", "redstone_lamp", "redstone_lamp_lit", "observer", "comparator", "dispenser", "hopper", "piston_head", "end_stone", "end_portal_frame", "end_portal_frame_filled", "end_portal", "chorus_flower", "chorus_plant", "dragon_egg", "end_crystal", "end_gateway", "end_rod", "end_stone_bricks", "ender_chest", "purpur_block", "purpur_pillar", "purpur_slab", "purpur_stairs", "shulker_box", "crafting_table", "furnace", "chest", "door", "door_open", "oak_stairs", "anvil", "cauldron", "water_cauldron", "bed", "enchanting_table", "brewing_stand", "tnt", "nether_brick", "netherrack", "nether_portal", "fire"];
```

### BehaviourRepair  `type`

```ts
type BehaviourRepair<S> = (kind: EntityKind, behaviour: S) => S;
```

### BlockAt  `type`

```ts
type BlockAt = (x: number, y: number, z: number) => number;
```

### BlockId  `type`

```ts
type BlockId = number;
```

### BlockPosition  `type`

```ts
type BlockPosition = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### BlockReading  `type`

```ts
type BlockReading = {
    readonly _tag: 'Block';
    readonly block: BlockId;
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
};
```

### BlockType  `type`

```ts
type BlockType = (typeof BLOCK_TYPES)[number];
```

### BlockWriteOutcome  `type`

```ts
type BlockWriteOutcome = {
    readonly _tag: 'Written';
    readonly previous: BlockId;
    readonly chunk: ChunkCoord;
} | {
    readonly _tag: 'Unchanged';
    readonly previous: BlockId;
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
};
```

### CameraPoseSnapshot  `type`

```ts
type CameraPoseSnapshot = {
    readonly position: Position;
    readonly yawRadians: number;
    readonly pitchRadians: number;
    readonly capturedAtSecs: MonotonicTimeSecs;
};
```

### ChunkCoord  `type`

```ts
type ChunkCoord = {
    readonly cx: number;
    readonly cz: number;
};
```

### ChunkDirtyBatch  `type`

```ts
type ChunkDirtyBatch = {
    readonly changed: ReadonlyArray<ChunkCoord>;
    readonly removed: ReadonlyArray<ChunkCoord>;
};
```

### ChunkDirtySubscription  `type`

```ts
type ChunkDirtySubscription = {
    readonly id: number;
    readonly drain: Effect.Effect<ChunkDirtyBatch>;
    readonly unsubscribe: Effect.Effect<void>;
};
```

### ChunkNeighbours  `type`

```ts
type ChunkNeighbours = {
    readonly xPos?: WorldgenChunk;
    readonly xNeg?: WorldgenChunk;
    readonly zPos?: WorldgenChunk;
    readonly zNeg?: WorldgenChunk;
};
```

### ChunkStore  `class`

```ts
class ChunkStore extends ChunkStore_base {
}
```

### ChunkStoreApi  `type`

```ts
type ChunkStoreApi = {
    readonly load: (coord: ChunkCoord) => Effect.Effect<WorldgenChunk>;
    readonly peek: (coord: ChunkCoord) => Effect.Effect<WorldgenChunk | undefined>;
    readonly snapshot: (coord: ChunkCoord) => Effect.Effect<WorldgenChunk | undefined>;
    readonly isLoaded: (coord: ChunkCoord) => Effect.Effect<boolean>;
    readonly loadedCoords: Effect.Effect<ReadonlyArray<ChunkCoord>>;
    readonly neighbours: (coord: ChunkCoord) => Effect.Effect<ChunkNeighbours>;
    readonly unload: (coord: ChunkCoord) => Effect.Effect<boolean>;
    readonly getBlock: (position: BlockPosition) => Effect.Effect<BlockReading>;
    readonly setBlock: (position: BlockPosition, block: BlockId) => Effect.Effect<BlockWriteOutcome>;
    readonly getLight: (position: BlockPosition) => Effect.Effect<LightReading>;
    readonly subscribeDirty: Effect.Effect<ChunkDirtySubscription>;
    readonly subscribeDirtyScoped: Effect.Effect<ChunkDirtySubscription, never, Scope.Scope>;
    readonly reset: Effect.Effect<void>;
};
```

### ChunkStore_base  `const`

```ts
const ChunkStore_base: Context.TagClass<ChunkStore, "@nerima-games/mc-worldgen/ChunkStore", ChunkStoreApi>;
```

### ClockPort  `class`

```ts
class ClockPort extends ClockPort_base {
}
```

### ClockPort_base  `const`

```ts
const ClockPort_base: Context.TagClass<ClockPort, "@nerima-games/mc-kernel/ClockPort", ClockService>;
```

### ClockService  `type`

```ts
type ClockService = {
    readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>;
    readonly wallClockEpochMillis: Effect.Effect<EpochMillis>;
};
```

### DeltaTimeSecs  `const`

```ts
const DeltaTimeSecs: Brand.Brand.Constructor<DeltaTimeSecs>;
```

### DeltaTimeSecs  `type`

```ts
type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>;
```

### Dimension  `type`

```ts
type Dimension = 'overworld' | 'nether' | 'end';
```

### Entity  `type`

```ts
type Entity<S> = EntityState<S> & {
    readonly id: EntityId;
    readonly kind: EntityKind;
};
```

### EntityId  `const`

```ts
const EntityId: Brand.Brand.Constructor<EntityId>;
```

### EntityId  `type`

```ts
type EntityId = string & Brand.Brand<'EntityId'>;
```

### EntityKind  `const`

```ts
const EntityKind: Brand.Brand.Constructor<EntityKind>;
```

### EntityKind  `type`

```ts
type EntityKind = string & Brand.Brand<'EntityKind'>;
```

### EntityManager  `type`

```ts
type EntityManager = {
    readonly _tag: '@nerima-games/mc-sim/EntityManager';
};
```

### EntityManagerApi  `type`

```ts
type EntityManagerApi<S> = {
    readonly spawn: (request: SpawnRequest<S>) => Effect.Effect<Entity<S>>;
    readonly despawn: (id: EntityId) => Effect.Effect<boolean>;
    readonly entities: Effect.Effect<ReadonlyArray<Entity<S>>>;
    readonly find: (id: EntityId) => Effect.Effect<Entity<S> | undefined>;
    readonly count: Effect.Effect<number>;
    readonly countOfKind: (kind: EntityKind) => Effect.Effect<number>;
    readonly sweep: <A>(step: (entity: Entity<S>) => EntityStep<S, A>) => Effect.Effect<ReadonlyArray<A>>;
    readonly snapshot: Effect.Effect<EntityRoster<S>>;
    readonly restore: (roster: EntityRoster<S>) => Effect.Effect<RosterRepair>;
    readonly reset: Effect.Effect<void>;
};
```

### EntityRoster  `type`

```ts
type EntityRoster<S> = {
    readonly entities: ReadonlyArray<Entity<S>>;
    readonly nextSerial: number;
};
```

### EntityState  `type`

```ts
type EntityState<S> = {
    readonly feetPosition: Position;
    readonly healthPoints: number;
    readonly behaviour: S;
};
```

### EntityStep  `type`

```ts
type EntityStep<S, A> = {
    readonly transition: EntityTransition<S>;
    readonly emit: A | undefined;
};
```

### EntityTransition  `type`

```ts
type EntityTransition<S> = {
    readonly _tag: 'Unchanged';
} | {
    readonly _tag: 'Changed';
    readonly state: EntityState<S>;
} | {
    readonly _tag: 'Despawned';
};
```

### EpochMillis  `const`

```ts
const EpochMillis: Brand.Brand.Constructor<EpochMillis>;
```

### EpochMillis  `type`

```ts
type EpochMillis = number & Brand.Brand<'EpochMillis'>;
```

### FrameServices  `type`

```ts
type FrameServices = never;
```

### GameModule  `interface`

```ts
interface GameModule<ROut, E, RIn, RRegister = never> {
    readonly layers: Layer.Layer<ROut, E, RIn>;
    readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>;
}
```

### HARVEST_TIERS  `const`

```ts
const HARVEST_TIERS: readonly ["none", "wooden", "stone", "iron", "diamond"];
```

### HarvestContext  `type`

```ts
type HarvestContext = {
    readonly heldTier?: HarvestTier;
    readonly silkTouch?: boolean;
};
```

### HarvestTier  `type`

```ts
type HarvestTier = (typeof HARVEST_TIERS)[number];
```

### ITEM_TYPES  `const`

```ts
const ITEM_TYPES: readonly ["stone", "cobblestone", "dirt", "grass_block", "sand", "gravel", "oak_log", "oak_planks", "oak_leaves", "glass", "torch", "glowstone", "piston", "stick", "glowstone_dust", "wooden_pickaxe", "coal", "iron_ingot", "flint", "gunpowder", "blaze_powder", "flint_and_steel", "fire_charge", "granite", "diorite", "andesite", "deepslate", "obsidian", "smooth_basalt", "calcite", "amethyst_block", "sandstone", "prismarine", "soul_sand", "coal_block", "iron_block", "gold_block", "diamond_block", "redstone_block", "lapis_block", "emerald_block", "redstone_torch", "lever", "stone_button", "repeater", "redstone_lamp", "observer", "comparator", "dispenser", "hopper", "end_stone", "end_portal_frame", "end_portal_frame_filled", "chorus_flower", "chorus_plant", "dragon_egg", "end_crystal", "end_rod", "end_stone_bricks", "ender_chest", "purpur_block", "purpur_pillar", "purpur_slab", "purpur_stairs", "shulker_box", "crafting_table", "furnace", "chest", "door", "oak_stairs", "anvil", "cauldron", "bed", "enchanting_table", "brewing_stand", "tnt", "nether_brick", "netherrack", "raw_iron", "raw_gold", "diamond", "emerald", "lapis_lazuli", "redstone_dust", "amethyst_shard", "wheat_seeds", "potato", "nether_wart", "ladder", "kelp", "seagrass", "rail", "powered_rail", "pressure_plate", "stone_slab", "string", "snowball"];
```

### ItemType  `type`

```ts
type ItemType = (typeof ITEM_TYPES)[number];
```

### LightReading  `type`

```ts
type LightReading = {
    readonly _tag: 'Light';
    readonly sky: number;
    readonly block: number;
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
};
```

### MonotonicTimeSecs  `const`

```ts
const MonotonicTimeSecs: Brand.Brand.Constructor<MonotonicTimeSecs>;
```

### MonotonicTimeSecs  `type`

```ts
type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>;
```

### PlayerPose  `type`

```ts
type PlayerPose = {
    readonly feetPosition: Position;
    readonly yawRadians: number;
    readonly pitchRadians: number;
};
```

### PlayerService  `class`

```ts
class PlayerService extends PlayerService_base {
}
```

### PlayerServiceApi  `type`

```ts
type PlayerServiceApi = {
    readonly pose: Effect.Effect<PlayerPose>;
    readonly dimension: Effect.Effect<Dimension>;
    readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<PlayerPose>;
    readonly moveTo: (feetPosition: Position) => Effect.Effect<void>;
    readonly setDimension: (dimension: Dimension) => Effect.Effect<void>;
    readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>;
    readonly restore: (pose: PlayerPose, dimension: Dimension) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### PlayerService_base  `const`

```ts
const PlayerService_base: Context.TagClass<PlayerService, "@nerima-games/mc-sim/PlayerService", PlayerServiceApi>;
```

### PortalAxis  `type`

```ts
type PortalAxis = 'x' | 'z';
```

### PortalDwell  `type`

```ts
type PortalDwell = {
    readonly _tag: 'Outside';
} | {
    readonly _tag: 'Standing';
    readonly dwelledSecs: number;
} | {
    readonly _tag: 'Cooling';
    readonly remainingSecs: number;
};
```

### PortalFrame  `type`

```ts
type PortalFrame = {
    readonly axis: PortalAxis;
    readonly width: number;
    readonly height: number;
    readonly interior: ReadonlyArray<BlockPosition>;
};
```

### Position  `type`

```ts
type Position = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### PositionKey  `type`

```ts
type PositionKey = string;
```

### RosterRepair  `type`

```ts
type RosterRepair = {
    readonly discarded: number;
    readonly reidentified: number;
};
```

### SPECIAL_BLOCK_BY_ITEM  `const`

```ts
const SPECIAL_BLOCK_BY_ITEM: {
    readonly redstone_dust: "redstone_wire";
};
```

### SpawnRequest  `type`

```ts
type SpawnRequest<S> = {
    readonly kind: EntityKind;
    readonly feetPosition: Position;
    readonly healthPoints: number;
    readonly behaviour: S;
};
```

### StageId  `const`

```ts
const StageId: Brand.Brand.Constructor<StageId>;
```

### StageId  `type`

```ts
type StageId = string & Brand.Brand<'StageId'>;
```

### StageRegistration  `interface`

```ts
interface StageRegistration {
    readonly id: StageId;
    readonly after?: ReadonlyArray<StageId>;
    readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>;
}
```

### WorldgenChunk  `type`

```ts
type WorldgenChunk = {
    readonly coord: ChunkCoord;
    readonly blocks: Uint8Array;
    readonly biomes: ReadonlyArray<string>;
};
```
