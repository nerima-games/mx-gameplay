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
exported declarations: 878
supporting declarations: 38

## Exported

### ARMOR_SLOTS  `const`

```ts
const ARMOR_SLOTS: readonly ["helmet", "chestplate", "leggings", "boots"];
```

### ActiveFire  `type`

```ts
type ActiveFire = {
    readonly position: FirePosition;
    readonly ageTicks: number;
    readonly unloadedRetries?: number;
};
```

### ActiveStatusEffect  `type`

```ts
type ActiveStatusEffect = {
    readonly type: StatusEffectType;
    readonly remainingSecs: number;
    readonly pulseClockSecs: number;
    readonly amplifier?: number;
};
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

### AdvanceFishingResult  `type`

```ts
type AdvanceFishingResult = {
    readonly _tag: 'Waiting';
    readonly session: FishingSession;
} | {
    readonly _tag: 'Bite';
    readonly session: FishingSession;
} | {
    readonly _tag: 'Escaped';
    readonly session: FishingSession;
} | {
    readonly _tag: 'Cancelled';
    readonly reason: 'LostWater';
    readonly rod: FishingRod;
} | {
    readonly _tag: 'InvalidDuration';
    readonly durationSecs: number;
    readonly session: FishingSession;
};
```

### AdvanceMiningProgressInput  `type`

```ts
type AdvanceMiningProgressInput = {
    readonly current: MiningProgressState | null;
    readonly target: MiningTarget | null;
    readonly isMining: boolean;
    readonly selectedItem: ItemType | null;
    readonly efficiencyLevel?: number;
    readonly deltaSecs: number;
};
```

### AdvanceMiningProgressResult  `type`

```ts
type AdvanceMiningProgressResult = {
    readonly nextProgress: MiningProgressState | null;
    readonly shouldBreak: boolean;
};
```

### ArmorHitResolution  `type`

```ts
type ArmorHitResolution = {
    readonly damage: Damage;
    readonly durabilityWear: number;
    readonly wornSlots: ReadonlyArray<(typeof WORN_ARMOR_SLOTS)[number]>;
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

### BLAZE_KIND  `const`

```ts
const BLAZE_KIND: EntityKind;
```

### BLAZE_XP_REWARD  `const`

```ts
const BLAZE_XP_REWARD = 10;
```

### BLOCK_LOOT_ROLLS  `const`

```ts
const BLOCK_LOOT_ROLLS = 4;
```

### BOARDING_MAX_DISTANCE  `const`

```ts
const BOARDING_MAX_DISTANCE = 2;
```

### BOAT_ACCELERATION  `const`

```ts
const BOAT_ACCELERATION = 4;
```

### BOAT_TURN_RATE  `const`

```ts
const BOAT_TURN_RATE = 1.8;
```

### BONE_MEAL_CROPS  `const`

```ts
const BONE_MEAL_CROPS: readonly ["wheat_crop", "potato_crop", "nether_wart_crop"];
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

### BREWING_DURATION_SECS  `const`

```ts
const BREWING_DURATION_SECS = 20;
```

### BREWING_INGREDIENTS  `const`

```ts
const BREWING_INGREDIENTS: readonly ["nether_wart", "sugar", "spider_eye", "ghast_tear"];
```

### BROWN_MUSHROOM_BLOCK_ID  `const`

```ts
const BROWN_MUSHROOM_BLOCK_ID: BlockId | undefined;
```

### BUCKET_ITEM_TYPES  `const`

```ts
const BUCKET_ITEM_TYPES: readonly ["bucket", "water_bucket", "lava_bucket"];
```

### BedSleepDecision  `type`

```ts
type BedSleepDecision = {
    readonly _tag: 'SleepAccepted';
    readonly morningTimeOfDay: typeof DAWN_FRACTION;
    readonly respawnLocation: RespawnLocation;
} | {
    readonly _tag: 'SleepRejected';
    readonly reason: SleepRejectionReason;
};
```

### BedSleepInput  `type`

```ts
type BedSleepInput = {
    readonly bedPosition: BlockPosition;
    readonly dangerNearby: boolean;
    readonly dimension: Dimension;
    readonly timeOfDay: number;
    readonly weather: Weather;
};
```

### BedSleepPlayer  `type`

```ts
type BedSleepPlayer = Pick<PlayerServiceApi, 'dimension'>;
```

### BedSleepRequest  `type`

```ts
type BedSleepRequest = Omit<BedSleepInput, 'dimension' | 'timeOfDay'>;
```

### BedSleepTime  `type`

```ts
type BedSleepTime = Pick<TimeServiceApi, 'timeOfDay' | 'setTimeOfDay'>;
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

### BlockPlacementCommand  `type`

```ts
type BlockPlacementCommand = PlacementRequest & {
    readonly requestId: BlockPlacementRequestId;
    readonly mode?: BlockPlacementMode;
};
```

### BlockPlacementCommandOutcome  `type`

```ts
type BlockPlacementCommandOutcome = PlaceOutcome | {
    readonly _tag: 'InventoryUnavailable';
} | {
    readonly _tag: 'RequestIdConflict';
} | {
    readonly _tag: 'PlayerDead';
};
```

### BlockPlacementMode  `type`

```ts
type BlockPlacementMode = 'survival' | 'creative';
```

### BlockPlacementRequestId  `type`

```ts
type BlockPlacementRequestId = string;
```

### BlockPlacementResult  `type`

```ts
type BlockPlacementResult = {
    readonly requestId: BlockPlacementRequestId;
    readonly success: boolean;
    readonly consumed: boolean;
    readonly replayed: boolean;
    readonly outcome: BlockPlacementCommandOutcome;
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
} | {
    readonly requestId: BlockUseRequestId;
    readonly success: false;
    readonly outcome: 'PlayerDead';
};
```

### BoatControl  `type`

```ts
type BoatControl = VehicleCollision & Readonly<{
    throttle: number;
    steering: number;
    inWater: boolean;
}>;
```

### BoneMealOutcome  `type`

```ts
type BoneMealOutcome = {
    readonly _tag: 'applied';
    readonly at: BlockPosition;
} | {
    readonly _tag: 'notCrop';
    readonly at: BlockPosition;
    readonly block: BlockType | undefined;
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
    readonly inventory: InteractionInventoryContext;
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
    readonly outcome: 'Undercharged' | 'DuplicateRequest' | 'PlayerDead' | 'InventoryUnavailable';
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

### BrewingBottle  `type`

```ts
type BrewingBottle = 'water_bottle' | {
    readonly potion: PotionType;
};
```

### BrewingCollectionResult  `type`

```ts
type BrewingCollectionResult = {
    readonly _tag: 'Collected';
    readonly returned: BrewingStack;
} | {
    readonly _tag: 'Rejected';
    readonly reason: 'Empty' | 'Brewing';
};
```

### BrewingDrinkResult  `type`

```ts
type BrewingDrinkResult = {
    readonly _tag: 'Consumed';
    readonly consumed: BrewingStack;
    readonly effect: StatusEffectApplication;
} | {
    readonly _tag: 'Rejected';
    readonly reason: 'Empty' | 'Brewing' | 'NoEffect';
};
```

### BrewingIngredient  `type`

```ts
type BrewingIngredient = (typeof BREWING_INGREDIENTS)[number];
```

### BrewingItem  `type`

```ts
type BrewingItem = Extract<ItemType, 'blaze_powder' | BrewingIngredient | 'water_bottle' | 'awkward_potion' | 'potion_of_swiftness' | 'potion_of_poison' | 'potion_of_regeneration'>;
```

### BrewingRecipe  `type`

```ts
type BrewingRecipe = {
    readonly bottle: BrewingBottle;
    readonly ingredient: BrewingIngredient;
    readonly output: PotionType;
};
```

### BrewingStack  `type`

```ts
type BrewingStack = {
    readonly item: BrewingItem;
    readonly count: 1;
};
```

### BrewingStandState  `type`

```ts
type BrewingStandState = {
    readonly fuelUnits: number;
    readonly bottle: BrewingBottle | undefined;
    readonly ingredient: BrewingIngredient | undefined;
    readonly brewing: {
        readonly output: PotionType;
        readonly remainingSecs: number;
    } | undefined;
};
```

### BrewingTransferResult  `type`

```ts
type BrewingTransferResult = {
    readonly _tag: 'Accepted';
    readonly consumed: BrewingStack;
} | {
    readonly _tag: 'Rejected';
    readonly reason: 'Occupied' | 'Empty' | 'Brewing' | 'InvalidRecipe';
};
```

### BucketItemType  `type`

```ts
type BucketItemType = (typeof BUCKET_ITEM_TYPES)[number];
```

### BucketItemUseRequest  `type`

```ts
type BucketItemUseRequest = {
    readonly action: 'UseBucket';
    readonly requestId: ItemUseRequestId;
    readonly positionKey: PositionKey;
    readonly heldItem: BucketItemType;
    readonly activeDimension: Dimension;
    readonly targetDimension: Dimension;
};
```

### BucketItemUseResult  `type`

```ts
type BucketItemUseResult = {
    readonly action: 'UseBucket';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: BucketItemType;
    readonly success: true;
    readonly outcome: SuccessfulBucketUseOutcome;
} | {
    readonly action: 'UseBucket';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: BucketItemType;
    readonly success: false;
    readonly outcome: FailedBucketUseOutcome;
};
```

### BucketUseOutcome  `type`

```ts
type BucketUseOutcome = {
    readonly _tag: 'Collected';
    readonly fluid: FluidKind;
    readonly position: BlockPosition;
    readonly chunk: ChunkCoord;
} | {
    readonly _tag: 'Placed';
    readonly fluid: FluidKind;
    readonly position: BlockPosition;
    readonly chunk: ChunkCoord;
} | {
    readonly _tag: 'WrongDimension';
    readonly activeDimension: Dimension;
    readonly targetDimension: Dimension;
} | {
    readonly _tag: 'WrongTarget';
    readonly block: BlockId;
} | {
    readonly _tag: 'Occupied';
    readonly block: BlockId;
} | {
    readonly _tag: 'MissingItem';
    readonly item: BucketItemType;
} | {
    readonly _tag: 'InventoryFull';
    readonly item: BucketItemType;
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
} | {
    readonly _tag: 'WorldChanged';
} | {
    readonly _tag: 'InventoryUpdateFailed';
} | {
    readonly _tag: 'RollbackFailed';
    readonly trigger: 'WorldChanged' | 'InventoryUpdateFailed';
    readonly world: 'Restored' | 'ChunkNotLoaded' | 'OutOfWorld';
    readonly inventory: 'Unchanged' | 'Restored' | 'RestoreFailed';
};
```

### BucketUseRequest  `type`

```ts
type BucketUseRequest = {
    readonly activeDimension: Dimension;
    readonly targetDimension: Dimension;
    readonly position: BlockPosition;
    readonly heldItem: BucketItemType;
};
```

### BurningActor  `type`

```ts
type BurningActor = {
    readonly id: string;
    readonly kind: 'player' | 'entity';
    readonly position: FirePosition;
    readonly remainingTicks: number;
    readonly damageCooldownTicks: number;
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

### CHARGED_CREEPER_EXPLOSION_POWER  `const`

```ts
const CHARGED_CREEPER_EXPLOSION_POWER = 6;
```

### CHICKEN_KIND  `const`

```ts
const CHICKEN_KIND: EntityKind;
```

### CLEAR_DURATION_RANGE_SECS  `const`

```ts
const CLEAR_DURATION_RANGE_SECS: WeatherDurationRange;
```

### CLOSED_SHELL  `const`

```ts
const CLOSED_SHELL: ShulkerShell;
```

### COLLISION_EXIT_SPEED  `const`

```ts
const COLLISION_EXIT_SPEED = 6;
```

### COW_KIND  `const`

```ts
const COW_KIND: EntityKind;
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

### CancelFishingResult  `type`

```ts
type CancelFishingResult = {
    readonly _tag: 'Cancelled';
    readonly reason: 'Player';
    readonly rod: FishingRod;
};
```

### CastFishingResult  `type`

```ts
type CastFishingResult = {
    readonly _tag: 'Cast';
    readonly session: FishingSession;
} | {
    readonly _tag: 'InvalidRod';
} | {
    readonly _tag: 'NoWater';
} | {
    readonly _tag: 'InvalidRoll';
    readonly roll: keyof FishingRolls;
    readonly value: number;
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
    readonly charged?: boolean;
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

### DEFAULT_FLUID_HORIZONTAL_RANGE  `const`

```ts
const DEFAULT_FLUID_HORIZONTAL_RANGE: {
    readonly water: 7;
    readonly lava: {
        readonly overworld: 3;
        readonly nether: 7;
        readonly end: 3;
    };
};
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

### DEFAULT_SURVIVAL_DIFFICULTY  `const`

```ts
const DEFAULT_SURVIVAL_DIFFICULTY: "normal";
```

### DESPAWN_DISTANCE_BLOCKS  `const`

```ts
const DESPAWN_DISTANCE_BLOCKS = 128;
```

### DIAMOND_PICKAXE_MINING_TOOL  `const`

```ts
const DIAMOND_PICKAXE_MINING_TOOL: MiningToolProfile;
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
type DeathCause = 'fall' | 'lava' | 'cactus' | 'fire' | 'drowning' | 'suffocation' | 'starvation' | 'mob' | 'projectile' | 'explosion' | 'void' | 'ender_pearl' | 'poison' | 'generic';
```

### DespawnCandidate  `type`

```ts
type DespawnCandidate = {
    readonly distanceToPlayerBlocks: number | undefined;
    readonly persistent: boolean;
    readonly named?: boolean;
    readonly tamed?: boolean;
    readonly ageTicks?: number;
    readonly randomRoll?: number;
    readonly difficulty?: HostileDifficulty;
};
```

### DespawnReason  `type`

```ts
type DespawnReason = 'too-far' | 'unmeasurable' | 'peaceful' | 'natural';
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

### DoorUpperBreakCell  `type`

```ts
type DoorUpperBreakCell = {
    readonly _tag: 'NotADoor';
} | {
    readonly _tag: 'NoDoorAbove';
} | {
    readonly _tag: 'DoorAbove';
    readonly cell: BlockPosition;
};
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
    readonly durability: Durability | null;
    readonly eligibleFromFrame?: number;
};
```

### DroppedItemSpawn  `type`

```ts
type DroppedItemSpawn = {
    readonly item: ItemType;
    readonly count: number;
    readonly at: Position;
    readonly durability?: Durability | null;
    readonly eligibleFromFrame?: number;
};
```

### DroppedItemSpawnError  `type`

```ts
type DroppedItemSpawnError = Extract<AddStoredStackResult, {
    readonly _tag: 'InvalidStack';
}>;
```

### ECOSYSTEM_MOB_KINDS  `const`

```ts
const ECOSYSTEM_MOB_KINDS: readonly [EntityKind, EntityKind, EntityKind, EntityKind, EntityKind, EntityKind, EntityKind, EntityKind];
```

### EMPTY_WORLD  `const`

```ts
const EMPTY_WORLD: WorldContents;
```

### ENCHANTMENT_IDS  `const`

```ts
const ENCHANTMENT_IDS: readonly ["protection", "sharpness", "efficiency", "unbreaking", "fortune", "power"];
```

### ENCHANTMENT_REGISTRY  `const`

```ts
const ENCHANTMENT_REGISTRY: Readonly<Record<EnchantmentId, EnchantmentDefinition>>;
```

### ENDERMAN_CHASE_TELEPORT_CHANCE  `const`

```ts
const ENDERMAN_CHASE_TELEPORT_CHANCE = 0.05;
```

### ENDERMAN_DAMAGE_TELEPORT_CHANCE  `const`

```ts
const ENDERMAN_DAMAGE_TELEPORT_CHANCE = 0.3;
```

### ENDERMAN_DROPS  `const`

```ts
const ENDERMAN_DROPS: ReadonlyArray<MobDropRule>;
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

### ENDERMAN_XP_REWARD  `const`

```ts
const ENDERMAN_XP_REWARD = 5;
```

### ENDERMITE_KIND  `const`

```ts
const ENDERMITE_KIND: EntityKind;
```

### ENDERMITE_MAX_HEALTH  `const`

```ts
const ENDERMITE_MAX_HEALTH = 8;
```

### ENDER_DRAGON_CONTACT_DAMAGE  `const`

```ts
const ENDER_DRAGON_CONTACT_DAMAGE = 10;
```

### ENDER_DRAGON_DEATH_XP  `const`

```ts
const ENDER_DRAGON_DEATH_XP = 12000;
```

### ENDER_DRAGON_MAX_HEALTH  `const`

```ts
const ENDER_DRAGON_MAX_HEALTH = 200;
```

### ENDER_DRAGON_PHASE_DURATION_SECS  `const`

```ts
const ENDER_DRAGON_PHASE_DURATION_SECS: {
    readonly circling: 10;
    readonly perching: 4;
    readonly charging: 2;
};
```

### ENDER_DRAGON_STAGE_ID  `const`

```ts
const ENDER_DRAGON_STAGE_ID: string;
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

### END_ARRIVAL_ORIGIN  `const`

```ts
const END_ARRIVAL_ORIGIN: import("@nerima-games/mc-worldgen").BlockPosition;
```

### ENVIRONMENTAL_CONTACT_DAMAGE_CADENCE_SECS  `const`

```ts
const ENVIRONMENTAL_CONTACT_DAMAGE_CADENCE_SECS = 0.5;
```

### EXPERIENCE_MODULE_STAGE_PREFIXES  `const`

```ts
const EXPERIENCE_MODULE_STAGE_PREFIXES: readonly ["gameplay:", "redstone:", "ui:", "multiplayer:"];
```

### EYE_LEVEL_OFFSET  `const`

```ts
const EYE_LEVEL_OFFSET = 1.62;
```

### EcosystemAttack  `type`

```ts
type EcosystemAttack = {
    readonly _tag: 'MobAttack';
    readonly attackerKind: EntityKind;
    readonly mode: 'melee' | 'projectile';
    readonly damage: number;
};
```

### EcosystemMobState  `type`

```ts
type EcosystemMobState = {
    readonly _tag: 'EcosystemMob';
    readonly attackCooldownSecs: number;
    readonly motionPhase: number;
    readonly provoked: boolean;
};
```

### EcosystemMobStep  `type`

```ts
type EcosystemMobStep = {
    readonly state: EcosystemMobState;
    readonly feetPosition: Position;
    readonly attack?: EcosystemAttack;
    readonly jumping: boolean;
};
```

### EnchantedItem  `type`

```ts
type EnchantedItem = {
    readonly item: ItemType;
    readonly durability: Durability | null;
    readonly enchantments: ReadonlyArray<Enchantment>;
};
```

### EnchantedItemEncodingResult  `type`

```ts
type EnchantedItemEncodingResult = {
    readonly ok: true;
    readonly encoded: string;
} | {
    readonly ok: false;
    readonly issues: ReadonlyArray<EnchantedItemValidationIssue>;
};
```

### EnchantedItemResult  `type`

```ts
type EnchantedItemResult = {
    readonly ok: true;
    readonly value: EnchantedItem;
} | {
    readonly ok: false;
    readonly issues: ReadonlyArray<EnchantedItemValidationIssue>;
};
```

### EnchantedItemValidationIssue  `type`

```ts
type EnchantedItemValidationIssue = {
    readonly path: string;
    readonly reason: string;
};
```

### Enchantment  `type`

```ts
type Enchantment = {
    readonly id: EnchantmentId;
    readonly level: number;
};
```

### EnchantmentConflictId  `type`

```ts
type EnchantmentConflictId = EnchantmentId | 'fire_protection' | 'blast_protection' | 'projectile_protection' | 'smite' | 'bane_of_arthropods' | 'silk_touch';
```

### EnchantmentDefinition  `type`

```ts
type EnchantmentDefinition = {
    readonly id: EnchantmentId;
    readonly maxLevel: number;
    readonly targets: ReadonlyArray<EnchantmentTarget>;
    readonly incompatibleWith: ReadonlyArray<EnchantmentConflictId>;
};
```

### EnchantmentId  `type`

```ts
type EnchantmentId = (typeof ENCHANTMENT_IDS)[number];
```

### EnchantmentOffer  `type`

```ts
type EnchantmentOffer = {
    readonly seed: number;
    readonly bookshelfCount: number;
    readonly slot: EnchantmentTableSlot;
    readonly enchantment: Enchantment;
    readonly requiredPlayerLevel: number;
    readonly lapisCost: 1 | 2 | 3;
};
```

### EnchantmentRejectionReason  `type`

```ts
type EnchantmentRejectionReason = 'invalid_state' | 'no_item' | 'invalid_item' | 'invalid_offer' | 'incompatible_item' | 'conflicting_enchantment' | 'insufficient_level' | 'insufficient_lapis';
```

### EnchantmentTableSlot  `type`

```ts
type EnchantmentTableSlot = 0 | 1 | 2;
```

### EnchantmentTableState  `type`

```ts
type EnchantmentTableState = {
    readonly seed: number;
    readonly bookshelfCount: number;
    readonly playerLevel: number;
    readonly lapis: number;
    readonly item: EnchantedItem | null;
};
```

### EnchantmentTarget  `type`

```ts
type EnchantmentTarget = 'armor' | 'melee_weapon' | 'mining_tool' | 'bow' | 'damageable';
```

### EnchantmentTransactionResult  `type`

```ts
type EnchantmentTransactionResult = {
    readonly ok: true;
    readonly state: EnchantmentTableState;
} | {
    readonly ok: false;
    readonly state: EnchantmentTableState;
    readonly reason: EnchantmentRejectionReason;
};
```

### EndPortalTravelEvent  `type`

```ts
type EndPortalTravelEvent = {
    readonly sourceDimension: Dimension;
    readonly sourcePosition: BlockPosition;
    readonly toDimension: Dimension;
    readonly destination: BlockPosition;
    readonly arrival: ReturnType<typeof endArrivalDescriptor> | undefined;
};
```

### EnderDragonDamageResult  `type`

```ts
type EnderDragonDamageResult = {
    readonly _tag: 'Applied';
    readonly state: EnderDragonEncounterSnapshot;
    readonly events: ReadonlyArray<EnderDragonEncounterEvent>;
} | {
    readonly _tag: 'Rejected';
    readonly reason: 'invalid-damage' | 'dragon-defeated';
};
```

### EnderDragonEncounterEvent  `type`

```ts
type EnderDragonEncounterEvent = {
    readonly _tag: 'DragonDamagedByPlayer';
    readonly amount: number;
    readonly remainingHealth: number;
} | {
    readonly _tag: 'PlayerDamaged';
    readonly amount: typeof ENDER_DRAGON_CONTACT_DAMAGE;
} | {
    readonly _tag: 'ExperienceRewarded';
    readonly amount: typeof ENDER_DRAGON_DEATH_XP;
} | {
    readonly _tag: 'ExitPortalMaterializationRequested';
    readonly dimension: 'end';
} | {
    readonly _tag: 'DragonEggRewarded';
    readonly item: 'dragon_egg';
    readonly count: 1;
};
```

### EnderDragonEncounterSnapshot  `type`

```ts
type EnderDragonEncounterSnapshot = typeof EnderDragonEncounterSnapshotSchema.Type;
```

### EnderDragonEncounterSnapshotSchema  `const`

```ts
const EnderDragonEncounterSnapshotSchema: Schema.Struct<{
    phase: Schema.Literal<["circling", "perching", "charging", "dead"]>;
    phaseTimerSecs: Schema.filter<Schema.filter<typeof Schema.Number>>;
    health: Schema.filter<Schema.filter<typeof Schema.Number>>;
    rewardEmitted: typeof Schema.Boolean;
}>;
```

### EnderDragonEncounterStageApi  `type`

```ts
type EnderDragonEncounterStageApi = {
    readonly stage: StageRegistration;
    readonly damageByPlayer: (damage: unknown) => Effect.Effect<EnderDragonDamageResult>;
    readonly snapshot: Effect.Effect<EnderDragonEncounterSnapshot>;
    readonly restore: (snapshot: unknown) => Effect.Effect<boolean>;
    readonly drainEvents: Effect.Effect<ReadonlyArray<EnderDragonEncounterEvent>>;
};
```

### EnderDragonPhase  `type`

```ts
type EnderDragonPhase = typeof EnderDragonPhaseSchema.Type;
```

### EnderDragonPhaseSchema  `const`

```ts
const EnderDragonPhaseSchema: Schema.Literal<["circling", "perching", "charging", "dead"]>;
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
    readonly damage: Damage | undefined;
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
    readonly inventory: InteractionInventoryContext;
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
    readonly inWater?: boolean;
    readonly exposedToDaylight?: boolean;
};
```

### EndermanTeleportCell  `type`

```ts
type EndermanTeleportCell = {
    readonly position: EndermanTeleportPosition;
    readonly block: string;
    readonly solid: boolean;
};
```

### EndermanTeleportPosition  `type`

```ts
type EndermanTeleportPosition = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### EndermanTeleportProbe  `type`

```ts
type EndermanTeleportProbe = {
    readonly _tag: 'EndermanTeleport';
    readonly entityId: EntityId;
    readonly current: EndermanTeleportPosition;
    readonly anchor: EndermanTeleportPosition;
    readonly rolls: ReadonlyArray<number>;
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

### EnvironmentalContact  `type`

```ts
type EnvironmentalContact = {
    readonly block: EnvironmentalContactBlock;
    readonly contactDamage: number;
};
```

### EnvironmentalContactBlock  `type`

```ts
type EnvironmentalContactBlock = 'lava' | 'cactus';
```

### EnvironmentalContactDamageState  `type`

```ts
type EnvironmentalContactDamageState = {
    readonly lastDamageElapsedSecs: number | undefined;
};
```

### EnvironmentalContactDamageStep  `type`

```ts
type EnvironmentalContactDamageStep = {
    readonly state: EnvironmentalContactDamageState;
    readonly damages: ReadonlyArray<Damage>;
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
type ExplosionSource = 'creeper' | 'tnt';
```

### FALLING_BLOCK_MOVES_PER_TICK  `const`

```ts
const FALLING_BLOCK_MOVES_PER_TICK = 32;
```

### FIRE_BURN_DURATION_TICKS  `const`

```ts
const FIRE_BURN_DURATION_TICKS = 80;
```

### FIRE_CONTACT_DAMAGE  `const`

```ts
const FIRE_CONTACT_DAMAGE: Damage;
```

### FIRE_DAMAGE_INTERVAL_TICKS  `const`

```ts
const FIRE_DAMAGE_INTERVAL_TICKS = 20;
```

### FIRE_FRAME_TICK_BUDGET  `const`

```ts
const FIRE_FRAME_TICK_BUDGET = 4;
```

### FIRE_LIFECYCLE_SNAPSHOT_VERSION  `const`

```ts
const FIRE_LIFECYCLE_SNAPSHOT_VERSION = 1;
```

### FIRE_NATURAL_LIFETIME_TICKS  `const`

```ts
const FIRE_NATURAL_LIFETIME_TICKS = 8;
```

### FIRE_SPREAD_CHANCE  `const`

```ts
const FIRE_SPREAD_CHANCE = 0.3;
```

### FIRE_TICK_INTERVAL_SECS  `const`

```ts
const FIRE_TICK_INTERVAL_SECS: number;
```

### FIRE_UNAVAILABLE_BLOCK  `const`

```ts
const FIRE_UNAVAILABLE_BLOCK = "__fire_chunk_unavailable__";
```

### FIRE_UNLOADED_RETRY_LIMIT  `const`

```ts
const FIRE_UNLOADED_RETRY_LIMIT = 3;
```

### FIRE_WORK_BUDGET  `const`

```ts
const FIRE_WORK_BUDGET = 128;
```

### FISHING_BITE_WINDOW_SECS  `const`

```ts
const FISHING_BITE_WINDOW_SECS = 2;
```

### FISHING_FISH_LOOT  `const`

```ts
const FISHING_FISH_LOOT: readonly ["cod", "salmon", "tropical_fish", "pufferfish"];
```

### FISHING_JUNK_LOOT  `const`

```ts
const FISHING_JUNK_LOOT: readonly ["bowl", "leather", "bone", "string", "stick", "lily_pad"];
```

### FISHING_MAX_WAIT_SECS  `const`

```ts
const FISHING_MAX_WAIT_SECS = 30;
```

### FISHING_MIN_WAIT_SECS  `const`

```ts
const FISHING_MIN_WAIT_SECS = 5;
```

### FISHING_RAIN_WAIT_MULTIPLIER  `const`

```ts
const FISHING_RAIN_WAIT_MULTIPLIER = 0.8;
```

### FISHING_ROD_ITEM  `const`

```ts
const FISHING_ROD_ITEM: "fishing_rod";
```

### FISHING_TREASURE_LOOT  `const`

```ts
const FISHING_TREASURE_LOOT: readonly ["name_tag", "saddle", "bow", "enchanted_book"];
```

### FOOD_PROPERTIES  `const`

```ts
const FOOD_PROPERTIES: Readonly<Partial<Record<ItemType, FoodProperties>>>;
```

### FORTUNE_MULTIPLIERS  `const`

```ts
const FORTUNE_MULTIPLIERS: ReadonlyMap<number, number>;
```

### FRESH_PRIMED_TNT  `const`

```ts
const FRESH_PRIMED_TNT: PrimedTnt;
```

### FallingBlockBatch  `type`

```ts
type FallingBlockBatch = {
    readonly batch: ReadonlyArray<PositionKey>;
    readonly rest: FallingBlockQueue;
};
```

### FallingBlockPosition  `type`

```ts
type FallingBlockPosition = Readonly<{
    x: number;
    y: number;
    z: number;
}>;
```

### FallingBlockQueue  `type`

```ts
type FallingBlockQueue = {
    readonly pending: ReadonlySet<PositionKey>;
};
```

### FallingBlockRead  `type`

```ts
type FallingBlockRead = (at: FallingBlockPosition) => number | undefined;
```

### FarmingItemUseRequest  `type`

```ts
type FarmingItemUseRequest = {
    readonly action: 'TillSoil';
    readonly requestId: ItemUseRequestId;
    readonly positionKey: PositionKey;
    readonly heldItem: HoeItemType;
} | {
    readonly action: 'ApplyBoneMeal';
    readonly requestId: ItemUseRequestId;
    readonly positionKey: PositionKey;
    readonly heldItem: 'bone_meal';
} | {
    readonly action: 'PlantPotato';
    readonly requestId: ItemUseRequestId;
    readonly positionKey: PositionKey;
    readonly heldItem: 'potato';
} | {
    readonly action: 'HarvestPotato';
    readonly requestId: ItemUseRequestId;
    readonly positionKey: PositionKey;
    readonly ripe: boolean;
    readonly roll: number;
} | {
    readonly action: 'EatPotato';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: 'potato';
    readonly vitals: FoodUseRequest['vitals'];
} | {
    readonly action: 'EatFood';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: ItemType;
    readonly vitals: FoodUseRequest['vitals'];
    readonly effectRoll: number;
};
```

### FarmingItemUseResult  `type`

```ts
type FarmingItemUseResult = {
    readonly action: 'TillSoil';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: HoeItemType;
    readonly success: boolean;
    readonly durabilityDamage: 0 | 1;
    readonly outcome: TillOutcome;
} | {
    readonly action: 'ApplyBoneMeal';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: 'bone_meal';
    readonly success: boolean;
    readonly consumedCount: 0 | 1;
    readonly outcome: BoneMealOutcome;
} | {
    readonly action: 'PlantPotato';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: 'potato';
    readonly success: boolean;
    readonly consumedCount: 0 | 1;
    readonly outcome: PlantOutcome;
} | {
    readonly action: 'HarvestPotato';
    readonly requestId: ItemUseRequestId;
    readonly positionKey: PositionKey;
    readonly success: boolean;
    readonly outcome: CropDropOutcome;
} | {
    readonly action: 'EatPotato';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: 'potato';
    readonly success: boolean;
    readonly consumedCount: 0 | 1;
    readonly outcome: FoodUseOutcome;
} | {
    readonly action: 'EatFood';
    readonly requestId: ItemUseRequestId;
    readonly heldItem: ItemType;
    readonly success: boolean;
    readonly consumedCount: 0 | 1;
    readonly outcome: FoodUseOutcome;
};
```

### FireActorContact  `type`

```ts
type FireActorContact = {
    readonly id: string;
    readonly kind: 'player' | 'entity';
    readonly position: FirePosition;
    readonly alive?: boolean;
    readonly inWater?: boolean;
    readonly exposedToSky?: boolean;
};
```

### FireCell  `type`

```ts
type FireCell = {
    readonly position: FirePosition;
    readonly block: string;
    readonly exposedToSky?: boolean;
};
```

### FireContactDamage  `type`

```ts
type FireContactDamage = {
    readonly _tag: 'FireContact';
    readonly at: FirePosition;
    readonly damage: Damage;
};
```

### FireEntityDamage  `type`

```ts
type FireEntityDamage = {
    readonly actorId: string;
    readonly at: FirePosition;
    readonly damage: Damage;
};
```

### FireLifecycleSnapshot  `type`

```ts
type FireLifecycleSnapshot = {
    readonly version: typeof FIRE_LIFECYCLE_SNAPSHOT_VERSION;
    readonly fires: ReadonlyArray<ActiveFire>;
    readonly burningActors: ReadonlyArray<BurningActor>;
    readonly seed: number;
    readonly tickAccumulatorSecs: number;
};
```

### FireLifecycleState  `type`

```ts
type FireLifecycleState = {
    readonly fires: ReadonlyArray<ActiveFire>;
    readonly burningActors?: ReadonlyArray<BurningActor>;
    readonly seed: number;
};
```

### FireLifecycleStep  `type`

```ts
type FireLifecycleStep = {
    readonly state: FireLifecycleState;
    readonly mutations: ReadonlyArray<FireMutation>;
    readonly damages: ReadonlyArray<FireContactDamage>;
    readonly entityDamages: ReadonlyArray<FireEntityDamage>;
};
```

### FireMutation  `type`

```ts
type FireMutation = {
    readonly position: FirePosition;
    readonly block: 'air' | 'fire';
};
```

### FirePosition  `type`

```ts
type FirePosition = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### FishingCategory  `type`

```ts
type FishingCategory = 'fish' | 'junk' | 'treasure';
```

### FishingEnvironment  `type`

```ts
type FishingEnvironment = {
    readonly hasWater: boolean;
    readonly hasSkyAccess: boolean;
    readonly isRaining: boolean;
    readonly isOpenWater: boolean;
};
```

### FishingItemUseRequest  `type`

```ts
type FishingItemUseRequest = {
    readonly action: 'CastFishing';
    readonly requestId: ItemUseRequestId;
    readonly rod: EquipmentItem | null;
    readonly environment: FishingEnvironment;
} | {
    readonly action: 'AdvanceFishing';
    readonly requestId: ItemUseRequestId;
    readonly deltaTimeSecs: number;
    readonly environment: Pick<FishingEnvironment, 'hasWater'>;
} | {
    readonly action: 'CancelFishing' | 'ReelFishing';
    readonly requestId: ItemUseRequestId;
};
```

### FishingItemUseResult  `type`

```ts
type FishingItemUseResult = {
    readonly action: 'CastFishing';
    readonly requestId: ItemUseRequestId;
    readonly success: true;
    readonly outcome: SuccessfulFishingCast;
} | {
    readonly action: 'CastFishing';
    readonly requestId: ItemUseRequestId;
    readonly success: false;
    readonly outcome: FailedFishingCast | 'AlreadyFishing';
} | {
    readonly action: 'AdvanceFishing';
    readonly requestId: ItemUseRequestId;
    readonly success: true;
    readonly outcome: AdvancedFishingResult;
} | {
    readonly action: 'AdvanceFishing';
    readonly requestId: ItemUseRequestId;
    readonly success: false;
    readonly outcome: FailedFishingAdvance | 'NoActiveFishingSession';
} | {
    readonly action: 'CancelFishing';
    readonly requestId: ItemUseRequestId;
    readonly success: true;
    readonly outcome: CancelFishingResult;
} | {
    readonly action: 'ReelFishing';
    readonly requestId: ItemUseRequestId;
    readonly success: true;
    readonly outcome: ReelFishingResult;
} | {
    readonly action: 'CancelFishing' | 'ReelFishing';
    readonly requestId: ItemUseRequestId;
    readonly success: false;
    readonly outcome: 'NoActiveFishingSession';
};
```

### FishingLoot  `type`

```ts
type FishingLoot = {
    readonly category: FishingCategory;
    readonly item: ItemType;
    readonly count: 1;
};
```

### FishingPhase  `type`

```ts
type FishingPhase = 'waiting' | 'bite' | 'escaped';
```

### FishingRod  `type`

```ts
type FishingRod = EquipmentItem & {
    readonly item: typeof FISHING_ROD_ITEM;
    readonly durability: Durability;
};
```

### FishingRolls  `type`

```ts
type FishingRolls = {
    readonly wait: number;
    readonly category: number;
    readonly item: number;
};
```

### FishingSession  `type`

```ts
type FishingSession = {
    readonly rod: FishingRod;
    readonly elapsedSecs: number;
    readonly waitSecs: number;
    readonly biteWindowSecs: number;
    readonly openWater: boolean;
    readonly rolls: FishingRolls;
};
```

### FluidBudgetSplit  `type`

```ts
type FluidBudgetSplit = {
    readonly work: ReadonlyArray<FluidWorkItem>;
};
```

### FluidCell  `type`

```ts
type FluidCell = {
    readonly key: PositionKey;
    readonly kind: FluidKind;
    readonly level: number;
    readonly source: boolean;
    readonly parent?: PositionKey;
    readonly falling: boolean;
};
```

### FluidChange  `type`

```ts
type FluidChange = {
    readonly _tag: 'PlaceFluid';
    readonly cell: FluidCell;
} | {
    readonly _tag: 'RemoveFluid';
    readonly key: PositionKey;
} | {
    readonly _tag: 'Solidify';
    readonly key: PositionKey;
    readonly block: 'obsidian' | 'cobblestone';
} | {
    readonly _tag: 'ForgetFluid';
    readonly key: PositionKey;
};
```

### FluidKind  `type`

```ts
type FluidKind = 'water' | 'lava';
```

### FluidProbe  `type`

```ts
type FluidProbe = {
    readonly key: PositionKey;
    readonly state: FluidProbeState;
    readonly source?: boolean;
};
```

### FluidProbeState  `type`

```ts
type FluidProbeState = 'air' | 'blocked' | 'same-fluid' | 'opposite-fluid' | 'unloaded' | 'out-of-world';
```

### FluidTransition  `type`

```ts
type FluidTransition = {
    readonly changes: ReadonlyArray<FluidChange>;
    readonly defer: boolean;
};
```

### FluidWorkItem  `type`

```ts
type FluidWorkItem = {
    readonly key: PositionKey;
    readonly kind: FluidKind;
    readonly level?: number;
    readonly source?: boolean;
    readonly parent?: PositionKey;
    readonly falling?: boolean;
    readonly deferred?: number;
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
    readonly effects: ReadonlyArray<StatusEffectApplication>;
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
    readonly effectRoll?: number;
};
```

### FurnaceAdvanceApplyResult  `type`

```ts
type FurnaceAdvanceApplyResult = {
    readonly _tag: 'Applied';
    readonly state: FurnaceState;
} | {
    readonly _tag: 'Stale';
    readonly state: FurnaceState;
};
```

### FurnaceAdvancePlan  `type`

```ts
type FurnaceAdvancePlan = {
    readonly before: FurnaceState;
    readonly after: FurnaceState;
    readonly advancedSecs: number;
    readonly deferredSecs: number;
    readonly smelted: number;
    readonly fuelConsumed: number;
};
```

### FurnaceItemUseRequest  `type`

```ts
type FurnaceItemUseRequest = {
    readonly action: 'AdvanceFurnace';
    readonly requestId: ItemUseRequestId;
    readonly state: FurnaceState;
    readonly deltaTimeSecs: number;
};
```

### FurnaceItemUseResult  `type`

```ts
type FurnaceItemUseResult = {
    readonly action: 'AdvanceFurnace';
    readonly requestId: ItemUseRequestId;
    readonly success: boolean;
    readonly plan: FurnaceAdvancePlan;
};
```

### GAMEPLAY_STAGE_IDS  `const`

```ts
const GAMEPLAY_STAGE_IDS: {
    readonly vehicles: StageId;
    readonly interactions: StageId;
    readonly fire: StageId;
    readonly survivalHunger: StageId;
    readonly entities: StageId;
    readonly enderDragon: StageId;
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

### GameplayFrameState  `type`

```ts
type GameplayFrameState = {
    readonly enderDragonEncounter: EnderDragonEncounterStageApi;
    readonly survivalHunger: SurvivalHungerRuntimeApi;
    readonly playerDead: Ref.Ref<boolean>;
    readonly pendingBreaks: Ref.Ref<ReadonlyArray<PositionKey>>;
    readonly pendingPlacements: Ref.Ref<ReadonlyArray<PlacementRequest>>;
    readonly pendingBlockUses: Ref.Ref<ReadonlyArray<BlockUseRequest>>;
    readonly pendingItemUses: Ref.Ref<ReadonlyArray<ItemUseRequest>>;
    readonly pendingBowShots: Ref.Ref<ReadonlyArray<BowShotRequest>>;
    readonly pendingMeleeAttacks: Ref.Ref<ReadonlyArray<MeleeAttackRequest>>;
    readonly pendingPearlThrows: Ref.Ref<ReadonlyArray<EnderPearlThrowRequest>>;
    readonly pendingVillagerTrades: Ref.Ref<ReadonlyArray<VillagerTradeRequest>>;
    readonly pendingStatusEffects: Ref.Ref<ReadonlyArray<StatusEffectApplication>>;
    readonly consumedItems: Ref.Ref<ReadonlyArray<PlaceableItemType>>;
    readonly usedItems: Ref.Ref<ReadonlyArray<IgnitionItemType>>;
    readonly blockUseResults: Ref.Ref<ReadonlyArray<BlockUseResult>>;
    readonly itemUseResults: Ref.Ref<ReadonlyArray<ItemUseResult>>;
    readonly fishingSession: Ref.Ref<FishingSession | undefined>;
    readonly bowShotResults: Ref.Ref<ReadonlyArray<BowShotResult>>;
    readonly meleeAttackResults: Ref.Ref<ReadonlyArray<GameplayMeleeAttackResult>>;
    readonly handledBowShotRequestIds: Ref.Ref<ReadonlySet<BowShotRequestId>>;
    readonly bowKnockbacks: Ref.Ref<ReadonlyArray<BowKnockback>>;
    readonly enderPearlOutcomes: Ref.Ref<ReadonlyArray<EnderPearlOutcome>>;
    readonly playerDamages: Ref.Ref<ReadonlyArray<PlayerDamageEvent>>;
    readonly playerHeals: Ref.Ref<ReadonlyArray<PlayerHealingEvent>>;
    readonly playerMovementSpeedMultiplier: Ref.Ref<number>;
    readonly statusEffects: Ref.Ref<StatusEffectState>;
    readonly brewingStand: Ref.Ref<BrewingStandState>;
    readonly fireLifecycle: Ref.Ref<FireLifecycleState>;
    readonly hostileContactCooldowns: Ref.Ref<ReadonlyMap<EntityId, number>>;
    readonly mobDrops: Ref.Ref<ReadonlyArray<MobDropEvent>>;
    readonly mobExperience: Ref.Ref<ReadonlyArray<MobExperienceEvent>>;
    readonly villagerTradeResults: Ref.Ref<ReadonlyArray<VillagerTradeResult>>;
    readonly villagerTrades: Ref.Ref<VillagerTradeState>;
    readonly spawnAttempts: Ref.Ref<ReadonlyArray<MobSpawnAttempt>>;
    readonly targetPosition: Ref.Ref<Position | undefined>;
    readonly timeOfDay: Ref.Ref<number>;
    readonly heldTool: Ref.Ref<BlockLootContext>;
    readonly weather: Ref.Ref<WeatherState>;
    readonly weatherAdvanced: Ref.Ref<WeatherState | undefined>;
    readonly weatherGameplayInput: Ref.Ref<WeatherGameplayInput>;
    readonly weatherGameplay: Ref.Ref<WeatherGameplayState>;
    readonly weatherGameplayEvents: Ref.Ref<ReadonlyArray<WeatherGameplayEvent>>;
    readonly spawnClockSecs: Ref.Ref<number>;
    readonly rollSeed: Ref.Ref<number>;
    readonly fallingBlocks: Ref.Ref<FallingBlockQueue>;
    readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>;
    readonly fluidUpdates: Ref.Ref<ReadonlyArray<FluidWorkItem>>;
    readonly tickCount: Ref.Ref<number>;
    readonly portalCandidates: Ref.Ref<ReadonlyMap<Dimension, ReadonlyArray<BlockPosition>>>;
    readonly portalTravels: Ref.Ref<ReadonlyArray<PortalTravelEvent>>;
    readonly endPortalTravels: Ref.Ref<ReadonlyArray<EndPortalTravelEvent>>;
    readonly portalDwell: Ref.Ref<PortalDwell>;
};
```

### GameplayMeleeAttackResult  `type`

```ts
type GameplayMeleeAttackResult = ResolvedMeleeAttackResult | {
    readonly requestId: string;
    readonly success: false;
    readonly outcome: 'PlayerDead';
};
```

### GameplayStageOptions  `interface`

```ts
interface GameplayStageOptions {
    readonly mobSimulation?: boolean;
}
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

### HAND_MINING_TOOL  `const`

```ts
const HAND_MINING_TOOL: MiningToolProfile;
```

### HOE_ITEM_TYPES  `const`

```ts
const HOE_ITEM_TYPES: readonly ["wooden_hoe", "stone_hoe", "iron_hoe", "diamond_hoe"];
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

### HoeItemType  `type`

```ts
type HoeItemType = (typeof HOE_ITEM_TYPES)[number];
```

### HorizontalSwimmingInput  `type`

```ts
type HorizontalSwimmingInput = Readonly<{
    x: number;
    z: number;
}>;
```

### HostileContactResolution  `type`

```ts
type HostileContactResolution = {
    readonly damages: ReadonlyArray<PlayerDamageEvent>;
    readonly cooldowns: ReadonlyMap<EntityId, number>;
};
```

### HostileDifficulty  `type`

```ts
type HostileDifficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
```

### HostileLocomotion  `type`

```ts
type HostileLocomotion = {
    readonly speedBlocksPerSecond: number;
    readonly stoppingDistanceBlocks: number;
};
```

### HostileMobSnapshot  `type`

```ts
type HostileMobSnapshot = {
    readonly _tag: 'HostileMob';
    readonly behaviour: CreeperFuse | EndermanFlinch | EcosystemMobState | undefined;
    readonly ageTicks: number;
    readonly persistent: boolean;
    readonly named: boolean;
    readonly tamed: boolean;
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

### INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE  `const`

```ts
const INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE: EnvironmentalContactDamageState;
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

### IRON_PICKAXE_MINING_TOOL  `const`

```ts
const IRON_PICKAXE_MINING_TOOL: MiningToolProfile;
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

### IgniteTntOutcome  `type`

```ts
type IgniteTntOutcome = {
    readonly _tag: 'Lit';
} | {
    readonly _tag: 'NotTnt';
} | {
    readonly _tag: 'ChunkNotLoaded';
} | {
    readonly _tag: 'OutOfWorld';
} | {
    readonly _tag: 'UnknownBlock';
} | {
    readonly _tag: 'ChangedBeforeWrite';
};
```

### IgnitionItemType  `type`

```ts
type IgnitionItemType = (typeof IGNITION_ITEM_TYPES)[number];
```

### IgnitionItemUseRequest  `type`

```ts
type IgnitionItemUseRequest = {
    readonly requestId: ItemUseRequestId;
    readonly positionKey: PositionKey;
    readonly heldItem: IgnitionItemType;
};
```

### IgnitionItemUseResult  `type`

```ts
type IgnitionItemUseResult = {
    readonly requestId: ItemUseRequestId;
    readonly heldItem: IgnitionItemType;
    readonly success: boolean;
    readonly outcome: IgnitionOutcome;
};
```

### IgnitionOutcome  `type`

```ts
type IgnitionOutcome = {
    readonly _tag: 'Tnt';
    readonly outcome: IgniteTntOutcome;
} | {
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
    readonly advanceFoodTimer: (dt: DeltaTimeSecs, starvationHealthFloor?: number) => Effect.Effect<FoodTimerOutcome>;
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

### InteractionInventoryContext  `type`

```ts
type InteractionInventoryContext = {
    readonly mode: BlockPlacementMode;
    readonly slotIndex: number;
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

### IsRailAt  `type`

```ts
type IsRailAt = (wx: number, wy: number, wz: number) => boolean;
```

### ItemUseRequest  `type`

```ts
type ItemUseRequest = IgnitionItemUseRequest | FarmingItemUseRequest | FurnaceItemUseRequest | BucketItemUseRequest | FishingItemUseRequest;
```

### ItemUseRequestId  `type`

```ts
type ItemUseRequestId = string;
```

### ItemUseResult  `type`

```ts
type ItemUseResult = IgnitionItemUseResult | FarmingItemUseResult | FurnaceItemUseResult | BucketItemUseResult | FishingItemUseResult | PlayerDeadItemUseResult;
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

### LIGHTNING_STRIKE_RADIUS_BLOCKS  `const`

```ts
const LIGHTNING_STRIKE_RADIUS_BLOCKS = 3;
```

### LOWEST_ROLLS  `const`

```ts
const LOWEST_ROLLS: DropRolls;
```

### LOWEST_WEATHER_ROLLS  `const`

```ts
const LOWEST_WEATHER_ROLLS: WeatherRolls;
```

### MAX_FLUID_DEFERRED_ATTEMPTS  `const`

```ts
const MAX_FLUID_DEFERRED_ATTEMPTS = 8;
```

### MAX_FURNACE_ADVANCE_SECS  `const`

```ts
const MAX_FURNACE_ADVANCE_SECS = 10;
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

### MAX_PASSIVE_COUNT  `const`

```ts
const MAX_PASSIVE_COUNT = 16;
```

### MAX_SPAWN_DISTANCE_BLOCKS  `const`

```ts
const MAX_SPAWN_DISTANCE_BLOCKS = 40;
```

### MINECART_CLIMB_SPEED  `const`

```ts
const MINECART_CLIMB_SPEED = 2;
```

### MINECART_MAX_SPEED  `const`

```ts
const MINECART_MAX_SPEED = 8;
```

### MINECART_POWERED_ACCELERATION  `const`

```ts
const MINECART_POWERED_ACCELERATION = 5;
```

### MINING_TICKS_PER_SECOND  `const`

```ts
const MINING_TICKS_PER_SECOND = 20;
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
    readonly requestId?: string;
    readonly origin: Position;
    readonly direction: Position;
    readonly reach: number;
    readonly damage: number;
    readonly hitDistance?: number;
};
```

### MeleeAttackResult  `type`

```ts
type MeleeAttackResult = {
    readonly requestId: string;
    readonly success: true;
    readonly target: ShotHit;
} | {
    readonly requestId: string;
    readonly success: false;
};
```

### MinecartTrack  `type`

```ts
type MinecartTrack = Readonly<{
    kind: 'none' | 'normal' | 'powered';
    shape: RailShape;
    ascendingAhead?: boolean;
    powered?: boolean;
}>;
```

### MinedItem  `type`

```ts
type MinedItem = {
    readonly item: ItemType;
    readonly count: number;
};
```

### MiningProgressState  `type`

```ts
type MiningProgressState = {
    readonly blockKey: string;
    readonly blockId: number;
    readonly elapsedSecs: number;
    readonly requiredSecs: number;
    readonly accumulatedWork: number;
    readonly completed: boolean;
};
```

### MiningTarget  `type`

```ts
type MiningTarget = {
    readonly position: BlockPosition;
    readonly blockId: number;
};
```

### MiningToolProfile  `type`

```ts
type MiningToolProfile = {
    readonly category: HarvestToolCategory;
    readonly speedMultiplier: number;
    readonly efficiencyLevel?: number;
};
```

### MobAttackEvent  `type`

```ts
type MobAttackEvent = EcosystemAttack & {
    readonly source: EntityId;
    readonly at: Position;
};
```

### MobBehaviour  `type`

```ts
type MobBehaviour = HostileMobSnapshot | CreeperFuse | PrimedTnt | EndermanFlinch | EcosystemMobState | DroppedItemBehaviour | undefined;
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

### MobExperienceEvent  `type`

```ts
type MobExperienceEvent = {
    readonly source: EntityId;
    readonly kind: EntityKind;
    readonly at: Position;
    readonly amount: number;
};
```

### MobFrameSenses  `type`

```ts
type MobFrameSenses = {
    readonly target: Position | undefined;
    readonly dt: DeltaTimeSecs;
    readonly difficulty?: HostileDifficulty;
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
    readonly attacks: ReadonlyArray<MobAttackEvent>;
    readonly teleports: ReadonlyArray<EndermanTeleportProbe>;
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

### NETHER_HOSTILE_KINDS  `const`

```ts
const NETHER_HOSTILE_KINDS: readonly [EntityKind, EntityKind];
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

### OVERWORLD_ECOSYSTEM_HOSTILE_KINDS  `const`

```ts
const OVERWORLD_ECOSYSTEM_HOSTILE_KINDS: readonly [EntityKind, EntityKind];
```

### OVERWORLD_RETURN_POSITION  `const`

```ts
const OVERWORLD_RETURN_POSITION: BlockPosition;
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "gameplay:";
```

### PASSIVE_MOB_KINDS  `const`

```ts
const PASSIVE_MOB_KINDS: readonly [EntityKind, EntityKind, EntityKind, EntityKind];
```

### PIG_KIND  `const`

```ts
const PIG_KIND: EntityKind;
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

### PLAYER_MAXIMUM_HEALTH_POINTS  `const`

```ts
const PLAYER_MAXIMUM_HEALTH_POINTS = 20;
```

### POISON_DAMAGE_POINTS  `const`

```ts
const POISON_DAMAGE_POINTS = 1;
```

### POISON_INTERVAL_SECS  `const`

```ts
const POISON_INTERVAL_SECS = 1;
```

### POISON_MINIMUM_HEALTH_POINTS  `const`

```ts
const POISON_MINIMUM_HEALTH_POINTS = 1;
```

### PORTAL_WINDOW_RADIUS  `const`

```ts
const PORTAL_WINDOW_RADIUS: number;
```

### POTION_EFFECT_DURATION_SECS  `const`

```ts
const POTION_EFFECT_DURATION_SECS: Readonly<Record<Exclude<PotionType, 'awkward'>, number>>;
```

### POTION_TYPES  `const`

```ts
const POTION_TYPES: readonly ["awkward", "speed", "poison", "regeneration"];
```

### PRIMED_TNT_FUSE_SECS  `const`

```ts
const PRIMED_TNT_FUSE_SECS = 4;
```

### PRIMED_TNT_KIND  `const`

```ts
const PRIMED_TNT_KIND: EntityKind;
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

### PlannedFallingBlockMove  `type`

```ts
type PlannedFallingBlockMove = Readonly<{
    source: FallingBlockPosition;
    target: FallingBlockPosition;
    blockId: number;
}>;
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
} | {
    readonly _tag: 'FireContact';
    readonly at: Position;
    readonly damage: Damage;
} | {
    readonly _tag: 'StatusEffect';
    readonly effect: 'poison';
    readonly damage: Damage;
    readonly minimumHealthPoints: 1;
};
```

### PlayerDeadItemUseResult  `type`

```ts
type PlayerDeadItemUseResult = {
    readonly requestId: ItemUseRequestId;
    readonly success: false;
    readonly outcome: 'PlayerDead';
};
```

### PlayerFoodTickSignal  `type`

```ts
type PlayerFoodTickSignal = 'none' | 'regen' | 'starve';
```

### PlayerHealingEvent  `type`

```ts
type PlayerHealingEvent = {
    readonly _tag: 'StatusEffect';
    readonly effect: 'regeneration';
    readonly amount: number;
    readonly maximumHealthPoints: number;
};
```

### PlayerSwimmingInput  `type`

```ts
type PlayerSwimmingInput = Readonly<{
    velocity: SwimmingVelocity;
    verticalInput: number;
    horizontalInput: HorizontalSwimmingInput;
    isInWater: boolean;
    deltaSeconds: number;
}>;
```

### PlayerVitals  `type`

```ts
type PlayerVitals = SimVitals;
```

### PlayerVitalsView  `type`

```ts
type PlayerVitalsView = SimVitalsView;
```

### PortalTravelEvent  `type`

```ts
type PortalTravelEvent = {
    readonly sourceDimension: Dimension;
    readonly sourcePosition: BlockPosition;
    readonly plan: PortalTravelPlan;
};
```

### PositionKey  `type`

```ts
type PositionKey = string & Brand.Brand<'GameplayPositionKey'>;
```

### PotionType  `type`

```ts
type PotionType = (typeof POTION_TYPES)[number];
```

### PrimedTnt  `type`

```ts
type PrimedTnt = {
    readonly _tag: 'PrimedTnt';
    readonly burnedSecs: number;
};
```

### PrimedTntStep  `type`

```ts
type PrimedTntStep = {
    readonly tnt: PrimedTnt;
    readonly explosion?: Explosion;
};
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

### RANDOM_DESPAWN_CHANCE  `const`

```ts
const RANDOM_DESPAWN_CHANCE: number;
```

### RANDOM_DESPAWN_MIN_AGE_TICKS  `const`

```ts
const RANDOM_DESPAWN_MIN_AGE_TICKS = 600;
```

### RANDOM_DESPAWN_MIN_DISTANCE_BLOCKS  `const`

```ts
const RANDOM_DESPAWN_MIN_DISTANCE_BLOCKS = 32;
```

### REDSTONE_INPUT_FLAGS  `const`

```ts
const REDSTONE_INPUT_FLAGS: readonly ["placeWire", "placeLever", "placeButton", "placeTorch", "placePiston", "placeObserver", "placeHopper", "placeRepeater", "placeComparator", "placeDispenser", "toggleLever", "pressButton", "toggleTorch"];
```

### RED_MUSHROOM_BLOCK_ID  `const`

```ts
const RED_MUSHROOM_BLOCK_ID: BlockId | undefined;
```

### REGENERATION_HEAL_POINTS  `const`

```ts
const REGENERATION_HEAL_POINTS = 1;
```

### REGENERATION_INTERVAL_SECS  `const`

```ts
const REGENERATION_INTERVAL_SECS = 2.5;
```

### RIPE_CROP_YIELD  `const`

```ts
const RIPE_CROP_YIELD: Readonly<Partial<Record<BlockType, {
    readonly item: ItemType;
    readonly span: number;
    readonly floor: number;
    readonly fixedDrops?: ReadonlyArray<CropDrop>;
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

### ReelFishingResult  `type`

```ts
type ReelFishingResult = {
    readonly _tag: 'Caught';
    readonly loot: FishingLoot;
    readonly rod: FishingRod | null;
} | {
    readonly _tag: 'ReeledTooEarly';
    readonly rod: FishingRod | null;
} | {
    readonly _tag: 'ReeledTooLate';
    readonly rod: FishingRod | null;
};
```

### RespawnLocation  `type`

```ts
type RespawnLocation = {
    readonly dimension: 'overworld';
    readonly position: Position;
};
```

### RightClickRoute  `type`

```ts
type RightClickRoute = {
    readonly kind: 'storage';
    readonly at: BlockPosition;
    readonly block: StorageBlock;
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

### SHEEP_KIND  `const`

```ts
const SHEEP_KIND: EntityKind;
```

### SHULKER_CLOSED_ARMOR_POINTS  `const`

```ts
const SHULKER_CLOSED_ARMOR_POINTS = 20;
```

### SHULKER_OPENING_TICKS  `const`

```ts
const SHULKER_OPENING_TICKS = 20;
```

### SKELETON_KIND  `const`

```ts
const SKELETON_KIND: EntityKind;
```

### SOIL_OF_CROP  `const`

```ts
const SOIL_OF_CROP: Readonly<Partial<Record<BlockType, BlockType>>>;
```

### SPAWN_PLAYER_VITALS  `const`

```ts
const SPAWN_PLAYER_VITALS: PlayerVitals;
```

### SPEED_MOVEMENT_MULTIPLIER  `const`

```ts
const SPEED_MOVEMENT_MULTIPLIER = 1.2;
```

### SPIDER_KIND  `const`

```ts
const SPIDER_KIND: EntityKind;
```

### STATUS_EFFECT_TYPES  `const`

```ts
const STATUS_EFFECT_TYPES: readonly ["poison", "regeneration", "speed", "hunger", "nausea"];
```

### STEADY_ENDERMAN  `const`

```ts
const STEADY_ENDERMAN: EndermanFlinch;
```

### STONE_PICKAXE_MINING_TOOL  `const`

```ts
const STONE_PICKAXE_MINING_TOOL: MiningToolProfile;
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

### SURVIVAL_EXHAUSTION  `const`

```ts
const SURVIVAL_EXHAUSTION: {
    readonly walkPerBlock: 0.01;
    readonly sprintPerBlock: 0.1;
    readonly jump: 0.05;
    readonly sprintJump: 0.2;
    readonly swimPerBlock: 0.01;
    readonly minePerBlock: 0.005;
    readonly attack: 0.1;
};
```

### SURVIVAL_HUNGER_STATE_VERSION  `const`

```ts
const SURVIVAL_HUNGER_STATE_VERSION: 1;
```

### SWIMMING_BUOYANCY_BLOCKS_PER_S2  `const`

```ts
const SWIMMING_BUOYANCY_BLOCKS_PER_S2 = 4;
```

### SWIMMING_DRAG_PER_SECOND  `const`

```ts
const SWIMMING_DRAG_PER_SECOND = 2;
```

### SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2  `const`

```ts
const SWIMMING_HORIZONTAL_ACCELERATION_BLOCKS_PER_S2 = 10;
```

### SWIMMING_VERTICAL_ACCELERATION_BLOCKS_PER_S2  `const`

```ts
const SWIMMING_VERTICAL_ACCELERATION_BLOCKS_PER_S2 = 8;
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

### SleepRejectionReason  `type`

```ts
type SleepRejectionReason = 'wrong-dimension' | 'danger-nearby' | 'not-night-or-thunder';
```

### SpawnCandidate  `type`

```ts
type SpawnCandidate = {
    readonly dimension?: Dimension;
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
type SpawnRefusal = 'daylight' | 'too-close' | 'too-far' | 'not-a-surface' | 'obstructed' | 'too-bright' | 'unmeasurable' | 'wrong-dimension';
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

### StatusEffectApplication  `type`

```ts
type StatusEffectApplication = {
    readonly type: StatusEffectType;
    readonly durationSecs: number;
    readonly amplifier?: number;
};
```

### StatusEffectState  `type`

```ts
type StatusEffectState = {
    readonly effects: ReadonlyArray<ActiveStatusEffect>;
};
```

### StatusEffectTick  `type`

```ts
type StatusEffectTick = {
    readonly state: StatusEffectState;
    readonly poisonPulses: number;
    readonly regenerationPulses: number;
    readonly movementSpeedMultiplier: number;
    readonly hungerExhaustion: number;
    readonly nauseaAmplifier: number | null;
};
```

### StatusEffectType  `type`

```ts
type StatusEffectType = (typeof STATUS_EFFECT_TYPES)[number];
```

### StorageBlock  `type`

```ts
type StorageBlock = (typeof STORAGE_BLOCK_TYPES)[number];
```

### SugarCaneWaterRefusal  `type`

```ts
type SugarCaneWaterRefusal = {
    readonly _tag: 'NoAdjacentWater';
};
```

### SurvivalActivityInput  `type`

```ts
type SurvivalActivityInput = {
    readonly _tag: 'walk';
    readonly distance: number;
} | {
    readonly _tag: 'sprint';
    readonly distance: number;
} | {
    readonly _tag: 'jump';
    readonly count: number;
    readonly sprinting?: boolean;
} | {
    readonly _tag: 'swim';
    readonly distance: number;
} | {
    readonly _tag: 'mine';
    readonly blocks: number;
} | {
    readonly _tag: 'attack';
    readonly count: number;
};
```

### SurvivalDifficulty  `type`

```ts
type SurvivalDifficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
```

### SurvivalHungerRuntimeApi  `type`

```ts
type SurvivalHungerRuntimeApi = {
    readonly submit: (input: SurvivalActivityInput) => Effect.Effect<void>;
    readonly addExhaustion: (amount: number) => Effect.Effect<void>;
    readonly tick: (dt: DeltaTimeSecs) => Effect.Effect<SurvivalHungerTickOutcome>;
    readonly eat: (foodPoints: number, saturationModifier: number) => Effect.Effect<PlayerVitals>;
    readonly damage: (damage: Damage) => Effect.Effect<VitalsDamageOutcome>;
    readonly heal: (amount: number) => Effect.Effect<PlayerVitals>;
    readonly setDifficulty: (difficulty: SurvivalDifficulty) => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<SurvivalHungerState>;
    readonly restore: (state: SurvivalHungerState) => Effect.Effect<void>;
    readonly respawn: Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### SurvivalHungerState  `type`

```ts
type SurvivalHungerState = SurvivalHungerStateV1;
```

### SurvivalHungerStateV1  `type`

```ts
type SurvivalHungerStateV1 = {
    readonly version: typeof SURVIVAL_HUNGER_STATE_VERSION;
    readonly difficulty: SurvivalDifficulty;
    readonly vitals: PlayerVitals;
};
```

### SurvivalHungerTickOutcome  `type`

```ts
type SurvivalHungerTickOutcome = {
    readonly difficulty: SurvivalDifficulty;
    readonly exhaustionAdded: number;
    readonly foodTicks: number;
    readonly regeneratedHealth: number;
    readonly starvationDamage: number;
    readonly died: boolean;
    readonly vitals: PlayerVitals;
};
```

### SwimmingVelocity  `type`

```ts
type SwimmingVelocity = Readonly<{
    x: number;
    y: number;
    z: number;
}>;
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

### TNT_BLOCK_ID  `const`

```ts
const TNT_BLOCK_ID: number | undefined;
```

### TNT_EXPLOSION_POWER  `const`

```ts
const TNT_EXPLOSION_POWER = 4;
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

### TargetedPrimaryAttackResolution  `type`

```ts
type TargetedPrimaryAttackResolution = {
    readonly _tag: 'Melee';
    readonly target: ShotHit;
    readonly request: MeleeAttackRequest;
} | {
    readonly _tag: 'Block';
    readonly target: BlockTarget;
} | {
    readonly _tag: 'None';
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
type TeleportReason = 'damaged' | 'stuck' | 'restless' | 'water' | 'daylight';
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

### VILLAGER_RESTOCK_INTERVAL_SECS  `const`

```ts
const VILLAGER_RESTOCK_INTERVAL_SECS = 300;
```

### VehicleCollision  `type`

```ts
type VehicleCollision = Readonly<{
    collided?: boolean;
    impactSpeed?: number;
    destroyed?: boolean;
}>;
```

### VehicleControlInput  `type`

```ts
type VehicleControlInput = Readonly<{
    throttle: number;
    steering: number;
}>;
```

### VehicleExitReason  `type`

```ts
type VehicleExitReason = 'requested' | 'collision' | 'destroyed';
```

### VehicleFrameEnvironment  `type`

```ts
type VehicleFrameEnvironment = Readonly<{
    isActiveDimension?: (dimension: Dimension) => boolean;
    isPoweredRailAt?: (dimension: Dimension, position: BlockPosition) => boolean;
    controlsForVehicle?: (vehicle: Vehicle) => VehicleControlInput;
    onVehicleExit?: (vehicle: Vehicle, reason: VehicleExitReason) => void;
}>;
```

### VehicleTransition  `type`

```ts
type VehicleTransition = Readonly<{
    vehicle: Vehicle;
    exited?: Readonly<{
        occupant: OccupantId;
        reason: VehicleExitReason;
    }>;
}>;
```

### Villager  `type`

```ts
type Villager = {
    readonly id: string;
    readonly profession: VillagerProfession;
    readonly offers: ReadonlyArray<VillagerTradeOffer>;
};
```

### VillagerProfession  `type`

```ts
type VillagerProfession = 'farmer' | 'toolsmith';
```

### VillagerTradeOffer  `type`

```ts
type VillagerTradeOffer = {
    readonly id: string;
    readonly input: {
        readonly item: ItemType;
        readonly count: number;
    };
    readonly output: {
        readonly item: ItemType;
        readonly count: number;
    };
    readonly uses: number;
    readonly maxUses: number;
};
```

### VillagerTradeRequest  `type`

```ts
type VillagerTradeRequest = {
    readonly requestId: string;
    readonly villagerId: string;
    readonly offerId: string;
};
```

### VillagerTradeResult  `type`

```ts
type VillagerTradeResult = (VillagerTradeRequest & {
    readonly _tag: 'Traded';
}) | (VillagerTradeRequest & {
    readonly _tag: 'Rejected';
    readonly reason: 'UnknownOffer' | 'OutOfStock' | 'InsufficientItems' | 'InventoryFull' | 'PlayerDead';
});
```

### VillagerTradeState  `type`

```ts
type VillagerTradeState = {
    readonly villagers: ReadonlyArray<Villager>;
    readonly restockElapsedSecs: number;
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

### WOODEN_PICKAXE_MINING_TOOL  `const`

```ts
const WOODEN_PICKAXE_MINING_TOOL: MiningToolProfile;
```

### Weather  `type`

```ts
type Weather = 'clear' | 'rain' | 'thunder';
```

### WeatherBlockCandidate  `type`

```ts
type WeatherBlockCandidate = {
    readonly position: PositionKey;
    readonly block: 'fire' | 'farmland' | 'flammable' | 'other';
    readonly exposedToSky: boolean;
};
```

### WeatherDifficulty  `type`

```ts
type WeatherDifficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
```

### WeatherDurationRange  `type`

```ts
type WeatherDurationRange = {
    readonly min: number;
    readonly max: number;
};
```

### WeatherEntityCandidate  `type`

```ts
type WeatherEntityCandidate = {
    readonly id: EntityId;
    readonly kind: EntityKind;
    readonly position: Position;
    readonly exposedToSky: boolean;
};
```

### WeatherGameplayEvent  `type`

```ts
type WeatherGameplayEvent = {
    readonly _tag: 'FireExtinguished';
    readonly position: PositionKey;
} | {
    readonly _tag: 'FarmlandHydrated';
    readonly position: PositionKey;
} | {
    readonly _tag: 'LightningStrike';
    readonly position: Position;
} | {
    readonly _tag: 'EntityLightningDamage';
    readonly id: EntityId;
    readonly amount: number;
} | {
    readonly _tag: 'CreeperCharged';
    readonly id: EntityId;
} | {
    readonly _tag: 'EntityTransformationRequested';
    readonly id: EntityId;
    readonly from: EntityKind;
    readonly to: EntityKind;
} | {
    readonly _tag: 'FireIgnited';
    readonly position: PositionKey;
};
```

### WeatherGameplayInput  `type`

```ts
type WeatherGameplayInput = {
    readonly dimension: Dimension;
    readonly difficulty: WeatherDifficulty;
    readonly blocks: ReadonlyArray<WeatherBlockCandidate>;
    readonly entities: ReadonlyArray<WeatherEntityCandidate>;
};
```

### WeatherGameplayState  `type`

```ts
type WeatherGameplayState = {
    readonly seed: number;
    readonly lastProcessedTick: number | undefined;
    readonly chargedCreepers: ReadonlyArray<EntityId>;
};
```

### WeatherGameplayStep  `type`

```ts
type WeatherGameplayStep = {
    readonly state: WeatherGameplayState;
    readonly events: ReadonlyArray<WeatherGameplayEvent>;
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

### ZOMBIE_DROPS  `const`

```ts
const ZOMBIE_DROPS: ReadonlyArray<MobDropRule>;
```

### ZOMBIE_KIND  `const`

```ts
const ZOMBIE_KIND: EntityKind;
```

### ZOMBIE_LOCOMOTION  `const`

```ts
const ZOMBIE_LOCOMOTION: HostileLocomotion;
```

### ZOMBIE_XP_REWARD  `const`

```ts
const ZOMBIE_XP_REWARD = 5;
```

### ZOMBIFIED_PIGLIN_KIND  `const`

```ts
const ZOMBIFIED_PIGLIN_KIND: EntityKind;
```

### acceptBrewingBottle  `const`

```ts
const acceptBrewingBottle: (state: BrewingStandState, bottle: BrewingBottle) => readonly [BrewingStandState, BrewingTransferResult];
```

### acceptBrewingFuel  `const`

```ts
const acceptBrewingFuel: (state: BrewingStandState) => readonly [BrewingStandState, BrewingTransferResult];
```

### acceptBrewingIngredient  `const`

```ts
const acceptBrewingIngredient: (state: BrewingStandState, ingredient: BrewingIngredient) => readonly [BrewingStandState, BrewingTransferResult];
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

### addVillager  `const`

```ts
const addVillager: (state: VillagerTradeState, villager: Villager) => VillagerTradeState;
```

### advanceBreakProgress  `const`

```ts
const advanceBreakProgress: (input: AdvanceBreakProgressInput) => AdvanceBreakProgressResult;
```

### advanceEnderDragonEncounter  `const`

```ts
const advanceEnderDragonEncounter: (state: EnderDragonEncounterSnapshot, deltaSecs: number) => readonly [EnderDragonEncounterSnapshot, ReadonlyArray<EnderDragonEncounterEvent>];
```

### advanceFireLifecycle  `const`

```ts
const advanceFireLifecycle: (state: FireLifecycleState, cells: ReadonlyArray<FireCell>, weather: Weather, contacted?: ReadonlyArray<FirePosition | FireActorContact>, difficulty?: SurvivalDifficulty) => FireLifecycleStep;
```

### advanceFishing  `const`

```ts
const advanceFishing: (session: FishingSession, durationSecs: number, environment: Pick<FishingEnvironment, "hasWater">) => AdvanceFishingResult;
```

### advanceMiningProgress  `const`

```ts
const advanceMiningProgress: ({ current, target, isMining, selectedItem, efficiencyLevel, deltaSecs, }: AdvanceMiningProgressInput) => AdvanceMiningProgressResult;
```

### advanceVehicles  `const`

```ts
const advanceVehicles: (store: ChunkStoreApi, vehicleService: VehicleServiceApi, dt: number, environment?: VehicleFrameEnvironment) => Effect.Effect<void>;
```

### advanceVillagerRestock  `const`

```ts
const advanceVillagerRestock: (state: VillagerTradeState, deltaTimeSecs: number) => VillagerTradeState;
```

### advanceWeather  `const`

```ts
const advanceWeather: (state: WeatherState, dt: number, rolls: WeatherRolls) => WeatherState;
```

### advanceWeatherGameplay  `const`

```ts
const advanceWeatherGameplay: (state: WeatherGameplayState, tick: number, weather: Weather, input: WeatherGameplayInput) => WeatherGameplayStep;
```

### anyRedstoneInput  `const`

```ts
const anyRedstoneInput: (flags: RedstoneInputFlags) => boolean;
```

### applyArmorToDamage  `const`

```ts
const applyArmorToDamage: (damage: Damage, armorPoints: number) => Damage;
```

### applyBoneMeal  `const`

```ts
const applyBoneMeal: (blockAt: (position: BlockPosition) => Effect.Effect<BlockType | undefined>, position: BlockPosition) => Effect.Effect<BoneMealOutcome>;
```

### applyDamage  `const`

```ts
const applyDamage: (vitals: Vitals, damage: Damage) => Vitals;
```

### applyEnchantmentOffer  `const`

```ts
const applyEnchantmentOffer: (state: EnchantmentTableState, offer: EnchantmentOffer) => EnchantmentTransactionResult;
```

### applyEndPortalTravel  `const`

```ts
const applyEndPortalTravel: (player: PlayerServiceApi, sourcePosition: BlockPosition) => Effect.Effect<EndPortalTravelEvent>;
```

### applyFurnaceAdvance  `const`

```ts
const applyFurnaceAdvance: (current: FurnaceState, plan: FurnaceAdvancePlan) => FurnaceAdvanceApplyResult;
```

### applyLook  `const`

```ts
const applyLook: (pose: PlayerPose, deltaYaw: number, deltaPitch: number) => PlayerPose;
```

### applyPlayerSwimming  `const`

```ts
const applyPlayerSwimming: (input: PlayerSwimmingInput) => SwimmingVelocity;
```

### applySpawnAttempts  `const`

```ts
const applySpawnAttempts: (roster: EntityManagerApi<MobBehaviour>, attempts: ReadonlyArray<MobSpawnAttempt>) => Effect.Effect<ReadonlyArray<MobSpawnOutcome>>;
```

### applyStatusEffect  `const`

```ts
const applyStatusEffect: (state: StatusEffectState, application: StatusEffectApplication) => StatusEffectState;
```

### applyWeatherState  `const`

```ts
const applyWeatherState: (current: WeatherState, candidate: unknown) => WeatherState;
```

### armorDamageWithEnchantments  `const`

```ts
const armorDamageWithEnchantments: (damage: Damage, armorPoints: number, armor: ReadonlyArray<EnchantedItem>) => Damage;
```

### armorDurabilityWearFromPreMitigationDamage  `const`

```ts
const armorDurabilityWearFromPreMitigationDamage: (damage: Damage) => number;
```

### armorPointsForEquipment  `const`

```ts
const armorPointsForEquipment: (equipment: Equipment) => number;
```

### arrowHitProjection  `const`

```ts
const arrowHitProjection: (from: Position, to: Position, target: Position) => number | undefined;
```

### attemptBedSleep  `const`

```ts
const attemptBedSleep: (player: BedSleepPlayer, time: BedSleepTime, request: BedSleepRequest) => Effect.Effect<BedSleepDecision>;
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

### boardVehicle  `const`

```ts
const boardVehicle: (vehicle: Vehicle, occupant: OccupantId, distance: number) => Vehicle;
```

### bowCharge  `const`

```ts
const bowCharge: (secsHeld: number) => number;
```

### bowDamage  `const`

```ts
const bowDamage: (charge: number, context?: BowDrawContext) => number;
```

### bowDamageWithEnchantments  `const`

```ts
const bowDamageWithEnchantments: (baseDamage: number, item: EnchantedItem) => number;
```

### bowPowerMultiplier  `const`

```ts
const bowPowerMultiplier: (powerLevel: number | undefined) => number;
```

### breakProgressFraction  `const`

```ts
const breakProgressFraction: (state: BreakProgressState) => number;
```

### brewingOutput  `const`

```ts
const brewingOutput: (bottle: BrewingBottle, ingredient: BrewingIngredient) => PotionType | undefined;
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

### canMobSpawnAt  `const`

```ts
const canMobSpawnAt: (kind: EntityKind, candidate: SpawnCandidate) => SpawnVerdict;
```

### cancelFishing  `const`

```ts
const cancelFishing: (session: FishingSession) => CancelFishingResult;
```

### carryOver  `const`

```ts
const carryOver: (frontier: ReadonlyArray<FluidWorkItem>, split: FluidBudgetSplit) => ReadonlyArray<FluidWorkItem>;
```

### carveExplosionCrater  `const`

```ts
const carveExplosionCrater: (store: ChunkStoreApi, centre: BlockPosition, power: number) => Effect.Effect<ReadonlyArray<PositionKey>>;
```

### castFishing  `const`

```ts
const castFishing: (rod: EquipmentItem | null, environment: FishingEnvironment, rolls: FishingRolls) => CastFishingResult;
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

### collectBrewingBottle  `const`

```ts
const collectBrewingBottle: (state: BrewingStandState) => readonly [BrewingStandState, BrewingCollectionResult];
```

### collectBrewingPotion  `const`

```ts
const collectBrewingPotion: (state: GameplayFrameState) => Effect.Effect<BrewingCollectionResult>;
```

### copyBrewingStandState  `const`

```ts
const copyBrewingStandState: (state: BrewingStandState) => BrewingStandState;
```

### copyStatusEffectState  `const`

```ts
const copyStatusEffectState: (state: StatusEffectState) => StatusEffectState;
```

### copyVillagerTradeState  `const`

```ts
const copyVillagerTradeState: (state: VillagerTradeState) => VillagerTradeState;
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

### damageEnderDragonByPlayer  `const`

```ts
const damageEnderDragonByPlayer: (state: EnderDragonEncounterSnapshot, input: unknown) => EnderDragonDamageResult;
```

### dayPhase  `const`

```ts
const dayPhase: (timeOfDay: number) => DayPhase;
```

### deathMessage  `const`

```ts
const deathMessage: (vitals: Vitals) => string | undefined;
```

### decodeEnchantedItem  `const`

```ts
const decodeEnchantedItem: (value: unknown) => EnchantedItemResult;
```

### decodeEnchantedItemSnapshot  `const`

```ts
const decodeEnchantedItemSnapshot: (encoded: string) => EnchantedItemResult;
```

### decodeEnderDragonEncounterSnapshot  `const`

```ts
const decodeEnderDragonEncounterSnapshot: (input: unknown) => EnderDragonEncounterSnapshot | undefined;
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

### doorUpperBreakCell  `const`

```ts
const doorUpperBreakCell: (store: ChunkStoreApi, block: BlockId, position: BlockPosition) => Effect.Effect<DoorUpperBreakCell>;
```

### doorUpperCell  `const`

```ts
const doorUpperCell: (store: ChunkStoreApi, block: BlockId, position: BlockPosition) => Effect.Effect<DoorUpperCell>;
```

### drainBlockPlacementResults  `const`

```ts
const drainBlockPlacementResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<BlockPlacementResult>>;
```

### drainBlockUseResults  `const`

```ts
const drainBlockUseResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<BlockUseResult>>;
```

### drainBowKnockbacks  `const`

```ts
const drainBowKnockbacks: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<BowKnockback>>;
```

### drainBowShotResults  `const`

```ts
const drainBowShotResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<BowShotResult>>;
```

### drainEndPortalTravels  `const`

```ts
const drainEndPortalTravels: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<EndPortalTravelEvent>>;
```

### drainFluidUpdates  `const`

```ts
const drainFluidUpdates: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<FluidWorkItem>>;
```

### drainItemUseResults  `const`

```ts
const drainItemUseResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<ItemUseResult>>;
```

### drainMeleeAttackResults  `const`

```ts
const drainMeleeAttackResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<GameplayMeleeAttackResult>>;
```

### drainMobDrops  `const`

```ts
const drainMobDrops: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<MobDropEvent>>;
```

### drainMobExperience  `const`

```ts
const drainMobExperience: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<MobExperienceEvent>>;
```

### drainPlayerDamages  `const`

```ts
const drainPlayerDamages: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<PlayerDamageEvent>>;
```

### drainPlayerHeals  `const`

```ts
const drainPlayerHeals: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<PlayerHealingEvent>>;
```

### drainPortalTravels  `const`

```ts
const drainPortalTravels: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<PortalTravelEvent>>;
```

### drainVillagerTradeResults  `const`

```ts
const drainVillagerTradeResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<VillagerTradeResult>>;
```

### drainWeatherGameplayEvents  `const`

```ts
const drainWeatherGameplayEvents: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<WeatherGameplayEvent>>;
```

### drawRolls  `const`

```ts
const drawRolls: (seed: number, count: number) => RollBatch;
```

### drinkBrewingPotion  `const`

```ts
const drinkBrewingPotion: (state: BrewingStandState) => readonly [BrewingStandState, BrewingDrinkResult];
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

### durabilityWearWithEnchantments  `const`

```ts
const durabilityWearWithEnchantments: (requestedWear: number, item: EnchantedItem, rolls: ReadonlyArray<number>) => number;
```

### ecosystemDimensionAllows  `const`

```ts
const ecosystemDimensionAllows: (kind: EntityKind, dimension: Dimension) => boolean;
```

### effectiveMiningSpeed  `const`

```ts
const effectiveMiningSpeed: (tool: MiningToolProfile, requirement: HarvestToolRequirement) => number;
```

### emptyBrewingStandState  `const`

```ts
const emptyBrewingStandState: () => BrewingStandState;
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

### emptyStatusEffectState  `const`

```ts
const emptyStatusEffectState: () => StatusEffectState;
```

### emptyVillagerTradeState  `const`

```ts
const emptyVillagerTradeState: () => VillagerTradeState;
```

### enchantmentAppliesTo  `const`

```ts
const enchantmentAppliesTo: (id: EnchantmentId, item: ItemType) => boolean;
```

### enchantmentLevel  `const`

```ts
const enchantmentLevel: (item: EnchantedItem, id: EnchantmentId) => number;
```

### enchantmentOffer  `const`

```ts
const enchantmentOffer: (seed: number, bookshelfCount: number, slot: EnchantmentTableSlot) => EnchantmentOffer;
```

### enchantmentOffers  `const`

```ts
const enchantmentOffers: (seed: number, bookshelfCount: number) => readonly [EnchantmentOffer, EnchantmentOffer, EnchantmentOffer];
```

### enchantmentsConflict  `const`

```ts
const enchantmentsConflict: (left: EnchantmentConflictId, right: EnchantmentConflictId) => boolean;
```

### encodeEnchantedItem  `const`

```ts
const encodeEnchantedItem: (item: EnchantedItem) => EnchantedItemEncodingResult;
```

### enderPearlDisplacement  `const`

```ts
const enderPearlDisplacement: (dirX: number, dirY: number, dirZ: number, hitDistance: number | undefined) => EnderPearlDisplacement | undefined;
```

### enderPearlDistance  `const`

```ts
const enderPearlDistance: (hitDistance: number | undefined) => number;
```

### endermanTeleportCandidateCells  `const`

```ts
const endermanTeleportCandidateCells: (current: EndermanTeleportPosition, anchor: EndermanTeleportPosition, rolls: ReadonlyArray<number>) => ReadonlyArray<EndermanTeleportPosition>;
```

### endermanTeleportCandidates  `const`

```ts
const endermanTeleportCandidates: (current: EndermanTeleportPosition, anchor: EndermanTeleportPosition, rolls: ReadonlyArray<number>) => ReadonlyArray<EndermanTeleportPosition>;
```

### endermanTeleportOffset  `const`

```ts
const endermanTeleportOffset: (rolls: ReadonlyArray<number>) => TeleportOffset | undefined;
```

### endermanTeleportUrge  `const`

```ts
const endermanTeleportUrge: (senses: EndermanSenses) => EndermanTeleportUrge;
```

### enqueueFluidDisturbance  `const`

```ts
const enqueueFluidDisturbance: (frontier: ReadonlyArray<FluidWorkItem>, item: FluidWorkItem) => ReadonlyArray<FluidWorkItem>;
```

### exhaustionForSurvivalActivity  `const`

```ts
const exhaustionForSurvivalActivity: (input: SurvivalActivityInput) => number;
```

### exitVehicle  `const`

```ts
const exitVehicle: (vehicle: Vehicle) => VehicleTransition;
```

### experienceOfCasualties  `const`

```ts
const experienceOfCasualties: (casualties: ReadonlyArray<MobCasualty>) => ReadonlyArray<MobExperienceEvent>;
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

### extinguishFire  `const`

```ts
const extinguishFire: (state: FireLifecycleState, position: FirePosition) => FireLifecycleState;
```

### firstWornSlot  `const`

```ts
const firstWornSlot: (equipment: Equipment) => ArmorSlot | undefined;
```

### fishingPhase  `const`

```ts
const fishingPhase: (session: FishingSession) => FishingPhase;
```

### fortuneDropCountWithEnchantments  `const`

```ts
const fortuneDropCountWithEnchantments: (baseDrops: number, item: EnchantedItem, roll: number) => number;
```

### fullHealth  `const`

```ts
const fullHealth: Vitals;
```

### furnaceAdvanceChanged  `const`

```ts
const furnaceAdvanceChanged: (plan: FurnaceAdvancePlan) => boolean;
```

### gameplayModule  `const`

```ts
const gameplayModule: GameModule<never, never, never, ChunkStore | EntityManager | InventoryService | PlayerService | TimeService>;
```

### gameplayStages  `const`

```ts
const gameplayStages: (state: GameplayFrameState, store: ChunkStoreApi, roster: EntityManagerApi<MobBehaviour>, inventory: InventoryServiceApi, player: PlayerServiceApi, time: TimeServiceApi, vehicleService?: VehicleServiceApi, vehicleEnvironment?: VehicleFrameEnvironment, options?: GameplayStageOptions) => ReadonlyArray<StageRegistration>;
```

### getPlayerMovementSpeedMultiplier  `const`

```ts
const getPlayerMovementSpeedMultiplier: (state: GameplayFrameState) => Effect.Effect<number>;
```

### hasClearCactusHorizontalSides  `const`

```ts
const hasClearCactusHorizontalSides: (sides: ReadonlyArray<BlockReading>) => boolean;
```

### hasRequiredSugarCaneAdjacentWater  `const`

```ts
const hasRequiredSugarCaneAdjacentWater: (supportBelow: BlockReading | undefined, besideSupport: ReadonlyArray<BlockReading>) => boolean;
```

### hostileMobSnapshot  `const`

```ts
const hostileMobSnapshot: (behaviour: HostileMobSnapshot["behaviour"], options?: Partial<Omit<HostileMobSnapshot, "_tag" | "behaviour">>) => HostileMobSnapshot;
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

### igniteTnt  `const`

```ts
const igniteTnt: (store: ChunkStoreApi, position: BlockPosition) => Effect.Effect<IgniteTntOutcome>;
```

### initialBehaviourOfKind  `const`

```ts
const initialBehaviourOfKind: (kind: EntityKind) => MobBehaviour;
```

### initialEcosystemMobState  `const`

```ts
const initialEcosystemMobState: () => EcosystemMobState;
```

### initialEnderDragonEncounter  `const`

```ts
const initialEnderDragonEncounter: () => EnderDragonEncounterSnapshot;
```

### insertBrewingBottle  `const`

```ts
const insertBrewingBottle: (state: GameplayFrameState, bottle: BrewingBottle) => Effect.Effect<BrewingTransferResult>;
```

### insertBrewingFuel  `const`

```ts
const insertBrewingFuel: (state: GameplayFrameState) => Effect.Effect<BrewingTransferResult>;
```

### insertBrewingIngredient  `const`

```ts
const insertBrewingIngredient: (state: GameplayFrameState, ingredient: BrewingIngredient) => Effect.Effect<BrewingTransferResult>;
```

### isAscendingAhead  `const`

```ts
const isAscendingAhead: (isRailAt: IsRailAt, wx: number, wy: number, wz: number, headingX: number, headingZ: number) => boolean;
```

### isBucketItem  `const`

```ts
const isBucketItem: (item: ItemType) => item is BucketItemType;
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

### isEndPortalBlock  `const`

```ts
const isEndPortalBlock: (block: number) => boolean;
```

### isFireLifecycleSnapshot  `const`

```ts
const isFireLifecycleSnapshot: (value: unknown) => value is FireLifecycleSnapshot;
```

### isHoeItem  `const`

```ts
const isHoeItem: (item: ItemType) => item is HoeItemType;
```

### isHostileMobSnapshot  `const`

```ts
const isHostileMobSnapshot: (value: unknown) => value is HostileMobSnapshot;
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

### isPrimedTnt  `const`

```ts
const isPrimedTnt: (value: unknown) => value is PrimedTnt;
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

### isSurvivalHungerState  `const`

```ts
const isSurvivalHungerState: (value: unknown) => value is SurvivalHungerState;
```

### isThunderstorm  `const`

```ts
const isThunderstorm: (weather: Weather) => boolean;
```

### isValidBrewingStandState  `const`

```ts
const isValidBrewingStandState: (value: unknown) => value is BrewingStandState;
```

### isValidPlayerVitals  `const`

```ts
const isValidPlayerVitals: (vitals: PlayerVitals) => boolean;
```

### isValidStatusEffectState  `const`

```ts
const isValidStatusEffectState: (value: unknown) => value is StatusEffectState;
```

### isValidVillagerTradeState  `const`

```ts
const isValidVillagerTradeState: (value: unknown) => value is VillagerTradeState;
```

### isWeather  `const`

```ts
const isWeather: (value: unknown) => value is Weather;
```

### isWeatherState  `const`

```ts
const isWeatherState: (value: unknown) => value is WeatherState;
```

### isWithinLightningStrikeRadius  `const`

```ts
const isWithinLightningStrikeRadius: (position: Position, strike: Position) => boolean;
```

### itemOfBlock  `const`

```ts
const itemOfBlock: (block: BlockType) => ItemType | undefined;
```

### knockbackDirection  `const`

```ts
const knockbackDirection: (dx: number, dz: number) => KnockbackDirection;
```

### makeEnderDragonEncounterRuntime  `const`

```ts
const makeEnderDragonEncounterRuntime: Effect.Effect<EnderDragonEncounterStageApi>;
```

### makeEnderDragonEncounterStage  `const`

```ts
const makeEnderDragonEncounterStage: (dimension: unknown) => Effect.Effect<EnderDragonEncounterStageApi | undefined>;
```

### makeFireLifecycleSnapshot  `const`

```ts
const makeFireLifecycleSnapshot: (state: FireLifecycleState, tickAccumulatorSecs: number) => FireLifecycleSnapshot;
```

### makeFireLifecycleState  `const`

```ts
const makeFireLifecycleState: (positions: ReadonlyArray<FirePosition>, seed: number) => FireLifecycleState;
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

### makeSurvivalHungerRuntime  `const`

```ts
const makeSurvivalHungerRuntime: (initial?: SurvivalHungerState) => Effect.Effect<SurvivalHungerRuntimeApi>;
```

### makeVillager  `const`

```ts
const makeVillager: (id: string, profession: VillagerProfession) => Villager;
```

### makeWeatherGameplayState  `const`

```ts
const makeWeatherGameplayState: (seed: number) => WeatherGameplayState;
```

### maxHealthOfKind  `const`

```ts
const maxHealthOfKind: (kind: EntityKind) => number;
```

### meleeDamageForItem  `const`

```ts
const meleeDamageForItem: (item: ItemType | null | undefined) => number;
```

### meleeDamageWithEnchantments  `const`

```ts
const meleeDamageWithEnchantments: (baseDamage: number, item: EnchantedItem) => number;
```

### meleeTarget  `const`

```ts
const meleeTarget: (candidates: ReadonlyArray<Entity<MobBehaviour>>, request: MeleeAttackRequest) => ShotHit | undefined;
```

### meleeTargetBeforeBlock  `const`

```ts
const meleeTargetBeforeBlock: (candidates: ReadonlyArray<Entity<MobBehaviour>>, request: Omit<MeleeAttackRequest, "hitDistance">, blockDistance: number | undefined) => ShotHit | undefined;
```

### miningDurationSecsForBlock  `const`

```ts
const miningDurationSecsForBlock: (blockId: number, item: ItemType | null, efficiencyLevel?: number) => number;
```

### miningLootContextForItem  `const`

```ts
const miningLootContextForItem: (item: ItemType | null) => BlockLootContext;
```

### miningProgressFraction  `const`

```ts
const miningProgressFraction: (progress: MiningProgressState | null) => number;
```

### miningSpeedWithEnchantments  `const`

```ts
const miningSpeedWithEnchantments: (baseSpeed: number, item: EnchantedItem) => number;
```

### miningToolForItem  `const`

```ts
const miningToolForItem: (item: ItemType | null, efficiencyLevel?: number) => MiningToolProfile;
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

### passivePopulation  `const`

```ts
const passivePopulation: <S>(roster: EntityManagerApi<S>) => Effect.Effect<number>;
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

### planFallingBlockMoves  `const`

```ts
const planFallingBlockMoves: (targets: Iterable<FallingBlockPosition>, readBlock: FallingBlockRead) => ReadonlyArray<PlannedFallingBlockMove>;
```

### planFurnaceAdvance  `const`

```ts
const planFurnaceAdvance: (state: FurnaceState, requestedSecs: number) => FurnaceAdvancePlan;
```

### plantCrop  `const`

```ts
const plantCrop: (port: PlantPort, request: PlantRequest) => Effect.Effect<PlantOutcome>;
```

### plantingVerdict  `const`

```ts
const plantingVerdict: (request: PlantRequest, soilBlock: BlockType, blockAbove: BlockType) => PlantOutcome;
```

### positionKey  `const`

```ts
const positionKey: (value: string) => PositionKey;
```

### projectMinecartVelocity  `const`

```ts
const projectMinecartVelocity: (shape: RailShape, vx: number, vz: number) => {
    readonly vx: number;
    readonly vz: number;
};
```

### propagatedPiglinProvocation  `const`

```ts
const propagatedPiglinProvocation: <S>(entities: ReadonlyArray<Entity<S>>, attackedPiglinIds: ReadonlySet<EntityId>, radius?: number) => ReadonlySet<EntityId>;
```

### pursueHorizontally  `const`

```ts
const pursueHorizontally: (from: Position, target: Position | undefined, dt: number, locomotion: HostileLocomotion) => Position;
```

### reelFishing  `const`

```ts
const reelFishing: (session: FishingSession) => ReelFishingResult;
```

### removeFromSlots  `const`

```ts
const removeFromSlots: (slots: ReadonlyArray<Slot>, item: ItemType, count: number) => {
    readonly slots: ReadonlyArray<Slot>;
    readonly removed: number;
};
```

### repairEcosystemMobState  `const`

```ts
const repairEcosystemMobState: (value: unknown) => EcosystemMobState | undefined;
```

### repairMobBehaviour  `const`

```ts
const repairMobBehaviour: (kind: EntityKind, behaviour: unknown) => MobBehaviour;
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
const requestBlockBreak: (state: GameplayFrameState, position: BlockPosition, lootContext?: BlockLootContext) => Effect.Effect<void>;
```

### requestBlockPlacement  `const`

```ts
const requestBlockPlacement: (state: GameplayFrameState, request: PlacementRequest) => Effect.Effect<void>;
```

### requestBlockPlacementCommand  `const`

```ts
const requestBlockPlacementCommand: (state: GameplayFrameState, command: BlockPlacementCommand) => Effect.Effect<void>;
```

### requestBlockUse  `const`

```ts
const requestBlockUse: (state: GameplayFrameState, requestId: BlockUseRequestId, position: BlockPosition) => Effect.Effect<void>;
```

### requestBoneMeal  `const`

```ts
const requestBoneMeal: (state: GameplayFrameState, requestId: ItemUseRequestId, position: BlockPosition) => Effect.Effect<void>;
```

### requestBowShot  `function`

```ts
function requestBowShot(state: GameplayFrameState, request: BowShotRequest): Effect.Effect<void>;
```

### requestBowShot  `function`

```ts
function requestBowShot(state: GameplayFrameState, requestId: BowShotRequestId, request: Omit<BowShotRequest, 'requestId'>): Effect.Effect<void>;
```

### requestBucketUse  `const`

```ts
const requestBucketUse: (state: GameplayFrameState, requestId: ItemUseRequestId, position: BlockPosition, heldItem: BucketItemType, activeDimension: Dimension, targetDimension?: Dimension) => Effect.Effect<void>;
```

### requestFireExtinguish  `const`

```ts
const requestFireExtinguish: (state: GameplayFrameState, store: ChunkStoreApi, position: FirePosition) => Effect.Effect<boolean>;
```

### requestFishingAdvance  `const`

```ts
const requestFishingAdvance: (state: GameplayFrameState, requestId: ItemUseRequestId, deltaTimeSecs: number, environment: Pick<FishingEnvironment, "hasWater">) => Effect.Effect<void>;
```

### requestFishingCancel  `const`

```ts
const requestFishingCancel: (state: GameplayFrameState, requestId: ItemUseRequestId) => Effect.Effect<void>;
```

### requestFishingCast  `const`

```ts
const requestFishingCast: (state: GameplayFrameState, requestId: ItemUseRequestId, rod: EquipmentItem | null, environment: FishingEnvironment) => Effect.Effect<void>;
```

### requestFishingReel  `const`

```ts
const requestFishingReel: (state: GameplayFrameState, requestId: ItemUseRequestId) => Effect.Effect<void>;
```

### requestFoodUse  `const`

```ts
const requestFoodUse: (state: GameplayFrameState, requestId: ItemUseRequestId, heldItem: ItemType, vitals: FoodUseRequest["vitals"]) => Effect.Effect<void>;
```

### requestFurnaceAdvance  `const`

```ts
const requestFurnaceAdvance: (state: GameplayFrameState, requestId: ItemUseRequestId, furnace: FurnaceState, deltaTimeSecs: number) => Effect.Effect<void>;
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

### requestPotatoFoodUse  `const`

```ts
const requestPotatoFoodUse: (state: GameplayFrameState, requestId: ItemUseRequestId, vitals: FoodUseRequest["vitals"]) => Effect.Effect<void>;
```

### requestPotatoHarvest  `const`

```ts
const requestPotatoHarvest: (state: GameplayFrameState, requestId: ItemUseRequestId, position: BlockPosition, ripe: boolean, roll: number) => Effect.Effect<void>;
```

### requestPotatoPlanting  `const`

```ts
const requestPotatoPlanting: (state: GameplayFrameState, requestId: ItemUseRequestId, position: BlockPosition) => Effect.Effect<void>;
```

### requestSoilTill  `const`

```ts
const requestSoilTill: (state: GameplayFrameState, requestId: ItemUseRequestId, position: BlockPosition, heldItem: HoeItemType) => Effect.Effect<void>;
```

### requestStatusEffect  `const`

```ts
const requestStatusEffect: (state: GameplayFrameState, application: StatusEffectApplication) => Effect.Effect<void>;
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

### requestTargetedBoneMeal  `const`

```ts
const requestTargetedBoneMeal: (state: GameplayFrameState, store: ChunkStoreApi, player: PlayerServiceApi, requestId: ItemUseRequestId, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### requestTargetedItemUse  `const`

```ts
const requestTargetedItemUse: (state: GameplayFrameState, store: ChunkStoreApi, player: PlayerServiceApi, requestId: ItemUseRequestId, heldItem: IgnitionItemType, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### requestTargetedPotatoPlanting  `const`

```ts
const requestTargetedPotatoPlanting: (state: GameplayFrameState, store: ChunkStoreApi, player: PlayerServiceApi, requestId: ItemUseRequestId, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### requestTargetedPrimaryAttack  `const`

```ts
const requestTargetedPrimaryAttack: (state: GameplayFrameState, store: ChunkStoreApi, roster: EntityManagerApi<MobBehaviour>, player: PlayerServiceApi, options?: TargetedPrimaryAttackOptions) => Effect.Effect<TargetedPrimaryAttackResult>;
```

### requestTargetedSoilTill  `const`

```ts
const requestTargetedSoilTill: (state: GameplayFrameState, store: ChunkStoreApi, player: PlayerServiceApi, requestId: ItemUseRequestId, heldItem: HoeItemType, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### requestVillagerTrade  `const`

```ts
const requestVillagerTrade: (state: GameplayFrameState, request: VillagerTradeRequest) => Effect.Effect<void>;
```

### rerollEnchantmentSeed  `const`

```ts
const rerollEnchantmentSeed: (seed: number) => number;
```

### resolveArmorHit  `const`

```ts
const resolveArmorHit: (equipment: Equipment, damage: Damage) => ArmorHitResolution;
```

### resolveArmoredPlayerDamages  `const`

```ts
const resolveArmoredPlayerDamages: (inventory: InventoryServiceApi, damages: ReadonlyArray<PlayerDamageEvent>) => Effect.Effect<ReadonlyArray<PlayerDamageEvent>>;
```

### resolveBedSleep  `const`

```ts
const resolveBedSleep: (input: BedSleepInput) => BedSleepDecision;
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

### resolveEndermanTeleportProbes  `const`

```ts
const resolveEndermanTeleportProbes: (roster: EntityManagerApi<MobBehaviour>, store: ChunkStoreApi, probes: ReadonlyArray<EndermanTeleportProbe>) => Effect.Effect<void>;
```

### resolveEnvironmentalContactDamage  `const`

```ts
const resolveEnvironmentalContactDamage: (state: EnvironmentalContactDamageState, contacts: ReadonlyArray<EnvironmentalContact>, simulationElapsedSecs: number) => EnvironmentalContactDamageStep;
```

### resolveFallDamage  `const`

```ts
const resolveFallDamage: (fallDistance: number) => Damage | undefined;
```

### resolveFoodUse  `const`

```ts
const resolveFoodUse: ({ held, vitals, effectRoll }: FoodUseRequest) => FoodUseOutcome;
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

### resolveRailShape  `const`

```ts
const resolveRailShape: (isRailAt: IsRailAt, wx: number, wy: number, wz: number) => RailShape;
```

### resolveSafeEndermanTeleport  `const`

```ts
const resolveSafeEndermanTeleport: (current: EndermanTeleportPosition, anchor: EndermanTeleportPosition, rolls: ReadonlyArray<number>, cells: ReadonlyArray<EndermanTeleportCell>) => EndermanTeleportPosition;
```

### resolveTargetedBlock  `const`

```ts
const resolveTargetedBlock: (store: ChunkStoreApi, player: PlayerServiceApi, maxDistance?: number) => Effect.Effect<Option.Option<BlockTarget>>;
```

### resolveTargetedPrimaryAttack  `const`

```ts
const resolveTargetedPrimaryAttack: (store: ChunkStoreApi, roster: EntityManagerApi<MobBehaviour>, player: PlayerServiceApi, options?: TargetedPrimaryAttackOptions) => Effect.Effect<TargetedPrimaryAttackResolution>;
```

### resolveWeatherDurationSecs  `const`

```ts
const resolveWeatherDurationSecs: (weather: Weather, roll: number) => number;
```

### restoreBrewingStand  `const`

```ts
const restoreBrewingStand: (state: GameplayFrameState, snapshot: BrewingStandState) => Effect.Effect<void>;
```

### restoreFireLifecycle  `const`

```ts
const restoreFireLifecycle: (state: GameplayFrameState, snapshot: FireLifecycleSnapshot) => Effect.Effect<void>;
```

### restoreFireLifecycleSnapshot  `const`

```ts
const restoreFireLifecycleSnapshot: (snapshot: FireLifecycleSnapshot) => {
    readonly state: FireLifecycleState;
    readonly tickAccumulatorSecs: number;
};
```

### restoreStatusEffects  `const`

```ts
const restoreStatusEffects: (state: GameplayFrameState, snapshot: StatusEffectState) => Effect.Effect<void>;
```

### restoreVillagerTrades  `const`

```ts
const restoreVillagerTrades: (state: GameplayFrameState, snapshot: VillagerTradeState) => Effect.Effect<void>;
```

### restoreWeatherGameplay  `const`

```ts
const restoreWeatherGameplay: (state: GameplayFrameState, snapshot: WeatherGameplayState) => Effect.Effect<void>;
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

### setPlayerDead  `const`

```ts
const setPlayerDead: (state: GameplayFrameState, playerDead: boolean) => Effect.Effect<void>;
```

### setPortalCandidates  `const`

```ts
const setPortalCandidates: (state: GameplayFrameState, dimension: Dimension, candidates: ReadonlyArray<BlockPosition>) => Effect.Effect<void>;
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

### snapshotBrewingStand  `const`

```ts
const snapshotBrewingStand: (state: GameplayFrameState) => Effect.Effect<BrewingStandState>;
```

### snapshotEnchantedItem  `const`

```ts
const snapshotEnchantedItem: (item: EnchantedItem) => EnchantedItemResult;
```

### snapshotFireLifecycle  `const`

```ts
const snapshotFireLifecycle: (state: GameplayFrameState) => Effect.Effect<FireLifecycleSnapshot>;
```

### snapshotStatusEffects  `const`

```ts
const snapshotStatusEffects: (state: GameplayFrameState) => Effect.Effect<StatusEffectState>;
```

### snapshotVillagerTrades  `const`

```ts
const snapshotVillagerTrades: (state: GameplayFrameState) => Effect.Effect<VillagerTradeState>;
```

### snapshotWeatherGameplay  `const`

```ts
const snapshotWeatherGameplay: (state: GameplayFrameState) => Effect.Effect<WeatherGameplayState>;
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
const spawnDroppedItem: (roster: EntityManagerApi<MobBehaviour>, drop: DroppedItemSpawn) => Effect.Effect<Entity<MobBehaviour>, DroppedItemSpawnError>;
```

### spawnDroppedItems  `const`

```ts
const spawnDroppedItems: (roster: EntityManagerApi<MobBehaviour>, drops: ReadonlyArray<DroppedItemSpawn>) => Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>, DroppedItemSpawnError>;
```

### spawnMobDrop  `const`

```ts
const spawnMobDrop: (roster: EntityManagerApi<MobBehaviour>, drop: MobDropEvent) => Effect.Effect<Entity<MobBehaviour>, DroppedItemSpawnError>;
```

### spawnMobDrops  `const`

```ts
const spawnMobDrops: (roster: EntityManagerApi<MobBehaviour>, drops: ReadonlyArray<MobDropEvent>) => Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>, DroppedItemSpawnError>;
```

### splitBudget  `const`

```ts
const splitBudget: (frontier: ReadonlyArray<FluidWorkItem>, options: {
    readonly budget?: number;
    readonly lavaTickActive: boolean;
}) => FluidBudgetSplit;
```

### starvationHealthFloor  `const`

```ts
const starvationHealthFloor: (difficulty: SurvivalDifficulty) => number;
```

### statusEffectOfPotion  `const`

```ts
const statusEffectOfPotion: (potion: PotionType) => StatusEffectApplication | undefined;
```

### stepBoat  `const`

```ts
const stepBoat: (vehicle: Vehicle, control: BoatControl, dt: number) => VehicleTransition;
```

### stepCreeperFuse  `const`

```ts
const stepCreeperFuse: (fuse: CreeperFuse, senses: CreeperSenses, dt: DeltaTimeSecs) => CreeperStep;
```

### stepEcosystemMob  `const`

```ts
const stepEcosystemMob: (kind: EntityKind, state: EcosystemMobState, self: Position, target: Position | undefined, deltaSecs: number) => EcosystemMobStep;
```

### stepMinecart  `const`

```ts
const stepMinecart: (vehicle: Vehicle, track: MinecartTrack, collision: VehicleCollision, dt: number) => VehicleTransition;
```

### stepPrimedTnt  `const`

```ts
const stepPrimedTnt: (tnt: PrimedTnt, dt: DeltaTimeSecs) => PrimedTntStep;
```

### stepShulkerShell  `const`

```ts
const stepShulkerShell: (shell: ShulkerShell, senses: ShulkerSenses) => ShulkerStep;
```

### submitWeatherGameplayInput  `const`

```ts
const submitWeatherGameplayInput: (state: GameplayFrameState, input: WeatherGameplayInput) => Effect.Effect<void>;
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

### targetedRightClickRoute  `const`

```ts
const targetedRightClickRoute: (store: ChunkStoreApi, player: PlayerServiceApi, maxDistance?: number) => Effect.Effect<RightClickRoute | undefined>;
```

### tickBrewingStand  `const`

```ts
const tickBrewingStand: (state: BrewingStandState, dt: DeltaTimeSecs) => BrewingStandState;
```

### tickStatusEffects  `const`

```ts
const tickStatusEffects: (state: StatusEffectState, dt: DeltaTimeSecs) => StatusEffectTick;
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

### transitionFluidCell  `const`

```ts
const transitionFluidCell: (input: {
    readonly cell: FluidCell;
    readonly current: FluidProbe;
    readonly below: FluidProbe;
    readonly horizontal: ReadonlyArray<FluidProbe>;
    readonly supported: boolean;
    readonly maximumHorizontalLevel: number;
}) => FluidTransition;
```

### unequipTopmost  `const`

```ts
const unequipTopmost: (port: UnequipPort, equipment: Equipment) => Effect.Effect<UnequipOutcome>;
```

### useBrewingPotion  `const`

```ts
const useBrewingPotion: (state: GameplayFrameState) => Effect.Effect<BrewingDrinkResult>;
```

### useBucket  `const`

```ts
const useBucket: (store: ChunkStoreApi, inventory: InventoryServiceApi, fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>, request: BucketUseRequest) => Effect.Effect<BucketUseOutcome>;
```

### useFlintAndSteel  `const`

```ts
const useFlintAndSteel: (store: ChunkStoreApi, position: BlockPosition, item: IgnitionItemType) => Effect.Effect<IgnitionOutcome>;
```

### useVillagerOffer  `const`

```ts
const useVillagerOffer: (state: VillagerTradeState, villagerId: string, offerId: string) => VillagerTradeState | undefined;
```

### validateEnchantedItem  `const`

```ts
const validateEnchantedItem: (value: unknown) => value is EnchantedItem;
```

### weatherExpires  `const`

```ts
const weatherExpires: (state: WeatherState, dt: number) => boolean;
```

### weatherLightScale  `const`

```ts
const weatherLightScale: (weather: Weather) => number;
```

### xpRewardOfKind  `const`

```ts
const xpRewardOfKind: (kind: EntityKind) => number;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

### AdvancedFishingResult  `type`

```ts
type AdvancedFishingResult = Extract<AdvanceFishingResult, {
    readonly _tag: 'Waiting' | 'Bite' | 'Escaped';
}>;
```

### BLOCK_TYPES  `const`

```ts
const BLOCK_TYPES: readonly ["air", "stone", "cobblestone", "dirt", "grass_block", "sand", "gravel", "water", "lava", "oak_log", "oak_planks", "oak_leaves", "glass", "torch", "glowstone", "bedrock", "piston", "snow", "ladder", "cobweb", "sapling", "dandelion", "poppy", "brown_mushroom", "red_mushroom", "tall_grass", "fern", "sugar_cane", "lily_pad", "kelp", "seagrass", "rail", "powered_rail", "cactus", "pressure_plate", "stone_slab", "granite", "diorite", "andesite", "deepslate", "obsidian", "smooth_basalt", "calcite", "amethyst_block", "amethyst_cluster", "sandstone", "prismarine", "soul_sand", "ice", "farmland", "coal_ore", "iron_ore", "gold_ore", "diamond_ore", "redstone_ore", "lapis_ore", "emerald_ore", "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_gold_ore", "deepslate_diamond_ore", "deepslate_redstone_ore", "deepslate_lapis_ore", "deepslate_emerald_ore", "coal_block", "iron_block", "gold_block", "diamond_block", "redstone_block", "lapis_block", "emerald_block", "wheat_crop", "potato_crop", "nether_wart_crop", "redstone_wire", "redstone_torch", "lever", "stone_button", "repeater", "redstone_lamp", "redstone_lamp_lit", "observer", "comparator", "dispenser", "hopper", "piston_head", "end_stone", "end_portal_frame", "end_portal_frame_filled", "end_portal", "chorus_flower", "chorus_plant", "dragon_egg", "end_crystal", "end_gateway", "end_rod", "end_stone_bricks", "ender_chest", "purpur_block", "purpur_pillar", "purpur_slab", "purpur_stairs", "shulker_box", "crafting_table", "furnace", "chest", "door", "door_open", "oak_stairs", "anvil", "cauldron", "water_cauldron", "bed", "enchanting_table", "brewing_stand", "tnt", "nether_brick", "netherrack", "nether_portal", "fire", "soul_soil", "wither_skeleton_skull"];
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

### DeltaTimeSecs  `const`

```ts
const DeltaTimeSecs: Brand.Brand.Constructor<DeltaTimeSecs>;
```

### DeltaTimeSecs  `type`

```ts
type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>;
```

### FailedBucketUseOutcome  `type`

```ts
type FailedBucketUseOutcome = Exclude<BucketUseOutcome, SuccessfulBucketUseOutcome>;
```

### FailedFishingAdvance  `type`

```ts
type FailedFishingAdvance = Exclude<AdvanceFishingResult, AdvancedFishingResult>;
```

### FailedFishingCast  `type`

```ts
type FailedFishingCast = Exclude<CastFishingResult, SuccessfulFishingCast>;
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

### SPECIAL_BLOCK_BY_ITEM  `const`

```ts
const SPECIAL_BLOCK_BY_ITEM: {
    readonly redstone_dust: "redstone_wire";
};
```

### STORAGE_BLOCK_TYPES  `const`

```ts
const STORAGE_BLOCK_TYPES: readonly ["chest", "shulker_box", "dispenser", "hopper"];
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

### SuccessfulBucketUseOutcome  `type`

```ts
type SuccessfulBucketUseOutcome = Extract<BucketUseOutcome, {
    readonly _tag: 'Collected' | 'Placed';
}>;
```

### SuccessfulFishingCast  `type`

```ts
type SuccessfulFishingCast = Extract<CastFishingResult, {
    readonly _tag: 'Cast';
}>;
```

### WORN_ARMOR_SLOTS  `const`

```ts
const WORN_ARMOR_SLOTS: readonly ["head", "chest", "legs", "feet"];
```

### WorldgenChunk  `type`

```ts
type WorldgenChunk = {
    readonly coord: ChunkCoord;
    readonly blocks: Uint8Array;
    readonly biomes: ReadonlyArray<string>;
};
```
