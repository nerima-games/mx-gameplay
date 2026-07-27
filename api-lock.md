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
exported declarations: 233
supporting declarations: 66

## Exported

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

### CACTUS_BLOCK_ID  `const`

```ts
const CACTUS_BLOCK_ID: BlockId | undefined;
```

### CLEAR_DURATION_RANGE_SECS  `const`

```ts
const CLEAR_DURATION_RANGE_SECS: WeatherDurationRange;
```

### CLOSED_SHELL  `const`

```ts
const CLOSED_SHELL: ShulkerShell;
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

### CREEPER_MAX_HEALTH  `const`

```ts
const CREEPER_MAX_HEALTH = 20;
```

### CREEPER_XP_REWARD  `const`

```ts
const CREEPER_XP_REWARD = 5;
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
    readonly drops: ReadonlyArray<MobDrop>;
    readonly seed: number;
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

### DAWN_FRACTION  `const`

```ts
const DAWN_FRACTION = 0.25;
```

### DEATH_MESSAGES  `const`

```ts
const DEATH_MESSAGES: Readonly<Record<DeathCause, string>>;
```

### DEFAULT_FLUID_FRONTIER_BUDGET  `const`

```ts
const DEFAULT_FLUID_FRONTIER_BUDGET = 64;
```

### DEFAULT_ROLL_SEED  `const`

```ts
const DEFAULT_ROLL_SEED = 20260727;
```

### DESPAWN_DISTANCE_BLOCKS  `const`

```ts
const DESPAWN_DISTANCE_BLOCKS = 128;
```

### DOOR_BLOCK_ID  `const`

```ts
const DOOR_BLOCK_ID: BlockId | undefined;
```

### DORMANT_FUSE  `const`

```ts
const DORMANT_FUSE: CreeperFuse;
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
type DeathCause = 'fall' | 'lava' | 'fire' | 'drowning' | 'suffocation' | 'starvation' | 'mob' | 'projectile' | 'explosion' | 'void' | 'generic';
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

### EXPERIENCE_MODULE_STAGE_PREFIXES  `const`

```ts
const EXPERIENCE_MODULE_STAGE_PREFIXES: readonly ["gameplay:", "redstone:", "ui:", "multiplayer:"];
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

### GameplayFrameState  `type`

```ts
type GameplayFrameState = {
    readonly pendingBreaks: Ref.Ref<ReadonlyArray<PositionKey>>;
    readonly pendingPlacements: Ref.Ref<ReadonlyArray<PlacementRequest>>;
    readonly pendingItemUses: Ref.Ref<ReadonlyArray<ItemUseRequest>>;
    readonly leftoverItems: Ref.Ref<ReadonlyArray<MinedItem>>;
    readonly consumedItems: Ref.Ref<ReadonlyArray<PlaceableItemType>>;
    readonly usedItems: Ref.Ref<ReadonlyArray<IgnitionItemType>>;
    readonly mobDrops: Ref.Ref<ReadonlyArray<MobDrop>>;
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
};
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

### IGNITION_ITEM_TYPES  `const`

```ts
const IGNITION_ITEM_TYPES: readonly ["flint_and_steel", "fire_charge"];
```

### INITIAL_WEATHER  `const`

```ts
const INITIAL_WEATHER: WeatherState;
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

### IsRailAt  `type`

```ts
type IsRailAt = (wx: number, wy: number, wz: number) => boolean;
```

### ItemUseRequest  `type`

```ts
type ItemUseRequest = {
    readonly positionKey: PositionKey;
    readonly heldItem: IgnitionItemType;
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

### MinedItem  `type`

```ts
type MinedItem = {
    readonly item: ItemType;
    readonly count: number;
};
```

### MobBehaviour  `type`

```ts
type MobBehaviour = CreeperFuse | EndermanFlinch | undefined;
```

### MobCasualty  `type`

```ts
type MobCasualty = {
    readonly id: EntityId;
    readonly kind: EntityKind;
};
```

### MobDrop  `type`

```ts
type MobDrop = {
    readonly item: ItemType;
    readonly count: number;
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

### NO_TOOL  `const`

```ts
const NO_TOOL: BlockLootContext;
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "gameplay:";
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

### PlacementRequest  `type`

```ts
type PlacementRequest = {
    readonly positionKey: PositionKey;
    readonly heldItem: PlaceableItemType;
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

### RED_MUSHROOM_BLOCK_ID  `const`

```ts
const RED_MUSHROOM_BLOCK_ID: BlockId | undefined;
```

### RailShape  `type`

```ts
type RailShape = 'ns' | 'ew' | 'curve' | 'isolated';
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

### STEADY_ENDERMAN  `const`

```ts
const STEADY_ENDERMAN: EndermanFlinch;
```

### STRUCK_ENDERMAN  `const`

```ts
const STRUCK_ENDERMAN: EndermanFlinch;
```

### SUGAR_CANE_BLOCK_ID  `const`

```ts
const SUGAR_CANE_BLOCK_ID: BlockId | undefined;
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

### TWILIGHT_BAND  `const`

```ts
const TWILIGHT_BAND = 0.05;
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

### UNREADABLE_BLOCK  `const`

```ts
const UNREADABLE_BLOCK = -1;
```

### UPSTREAM_STAGE_IDS  `const`

```ts
const UPSTREAM_STAGE_IDS: {
    readonly simPhysics: StageId;
};
```

### Vitals  `type`

```ts
type Vitals = {
    readonly healthPoints: number;
    readonly lastDeathCause: DeathCause | undefined;
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

### advanceWeather  `const`

```ts
const advanceWeather: (state: WeatherState, dt: number, rolls: WeatherRolls) => WeatherState;
```

### applyDamage  `const`

```ts
const applyDamage: (vitals: Vitals, damage: Damage) => Vitals;
```

### applySpawnAttempts  `const`

```ts
const applySpawnAttempts: (roster: EntityManagerApi<MobBehaviour>, attempts: ReadonlyArray<MobSpawnAttempt>) => Effect.Effect<ReadonlyArray<MobSpawnOutcome>>;
```

### blockLoot  `const`

```ts
const blockLoot: (block: BlockId, context?: BlockLootContext, rolls?: ReadonlyArray<number>) => ReadonlyArray<MinedItem>;
```

### blockOverlapsPlayer  `const`

```ts
const blockOverlapsPlayer: (block: BlockPosition, playerFeet: Position) => boolean;
```

### cactusSidesObjection  `const`

```ts
const cactusSidesObjection: (store: ChunkStoreApi, block: BlockId, position: BlockPosition) => Effect.Effect<CactusSidesRefusal | undefined>;
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

### fullHealth  `const`

```ts
const fullHealth: Vitals;
```

### gameplayModule  `const`

```ts
const gameplayModule: GameModule<never, never, never, ChunkStore | EntityManager | InventoryService>;
```

### gameplayStages  `const`

```ts
const gameplayStages: (state: GameplayFrameState, store: ChunkStoreApi, roster: EntityManagerApi<MobBehaviour>, inventory: InventoryServiceApi) => ReadonlyArray<StageRegistration>;
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

### isIgnitionItem  `const`

```ts
const isIgnitionItem: (item: ItemType) => item is IgnitionItemType;
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

### isPrecipitating  `const`

```ts
const isPrecipitating: (weather: Weather) => boolean;
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

### makeGameplayFrameState  `const`

```ts
const makeGameplayFrameState: Effect.Effect<GameplayFrameState>;
```

### makeGameplayStages  `const`

```ts
const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, ChunkStore | EntityManager | InventoryService>;
```

### maxHealthOfKind  `const`

```ts
const maxHealthOfKind: (kind: EntityKind) => number;
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

### normaliseSeed  `const`

```ts
const normaliseSeed: (seed: number) => number;
```

### openChunkWindow  `const`

```ts
const openChunkWindow: (store: ChunkStoreApi, coords: ReadonlyArray<ChunkCoord>) => Effect.Effect<ChunkWindow>;
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

### repairMobBehaviour  `const`

```ts
const repairMobBehaviour: (kind: EntityKind, behaviour: MobBehaviour) => MobBehaviour;
```

### resolveBlasts  `const`

```ts
const resolveBlasts: (roster: EntityManagerApi<MobBehaviour>, store: ChunkStoreApi, blasts: ReadonlyArray<Blast>) => Effect.Effect<BlastResolution>;
```

### resolveNextWeatherState  `const`

```ts
const resolveNextWeatherState: (current: Weather, rolls: WeatherRolls) => WeatherState;
```

### resolveRailShape  `const`

```ts
const resolveRailShape: (isRailAt: IsRailAt, wx: number, wy: number, wz: number) => RailShape;
```

### resolveWeatherDurationSecs  `const`

```ts
const resolveWeatherDurationSecs: (weather: Weather, roll: number) => number;
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
const rollSelfDestructDrops: (kind: EntityKind) => ReadonlyArray<MobDrop>;
```

### settled  `const`

```ts
const settled: (queue: FallingBlockQueue, destinations: Iterable<PositionKey>) => FallingBlockQueue;
```

### shulkerShellArmorPoints  `const`

```ts
const shulkerShellArmorPoints: (shell: ShulkerShell) => number;
```

### shulkerWantsToTeleport  `const`

```ts
const shulkerWantsToTeleport: (senses: ShulkerSenses) => boolean;
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

### CraftGrid  `type`

```ts
type CraftGrid = {
    readonly width: number;
    readonly height: number;
    readonly cells: ReadonlyArray<Slot>;
};
```

### CraftResult  `type`

```ts
type CraftResult = {
    readonly _tag: 'Crafted';
    readonly recipeId: RecipeId;
    readonly output: ItemStack;
} | {
    readonly _tag: 'NoMatch';
} | {
    readonly _tag: 'MissingIngredients';
    readonly missing: ReadonlyArray<MissingIngredient>;
} | {
    readonly _tag: 'NoRoom';
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

### Ingredient  `type`

```ts
type Ingredient = {
    readonly _tag: 'Exact';
    readonly item: ItemType;
};
```

### Inventory  `type`

```ts
type Inventory = {
    readonly slots: ReadonlyArray<Slot>;
};
```

### InventoryService  `class`

```ts
class InventoryService extends InventoryService_base {
}
```

### InventoryServiceApi  `type`

```ts
type InventoryServiceApi = {
    readonly add: (item: ItemType, count: number) => Effect.Effect<number>;
    readonly remove: (item: ItemType, count: number) => Effect.Effect<number>;
    readonly countOf: (item: ItemType) => Effect.Effect<number>;
    readonly snapshot: Effect.Effect<Inventory>;
    readonly restore: (inventory: Inventory) => Effect.Effect<number>;
    readonly reset: Effect.Effect<void>;
    readonly recipes: Effect.Effect<RecipeTable>;
    readonly previewCraft: (grid: CraftGrid) => Effect.Effect<RecipeMatch>;
    readonly craft: (grid: CraftGrid) => Effect.Effect<CraftResult>;
};
```

### InventoryService_base  `const`

```ts
const InventoryService_base: Context.TagClass<InventoryService, "@nerima-games/mc-sim/InventoryService", InventoryServiceApi>;
```

### ItemStack  `type`

```ts
type ItemStack = {
    readonly item: ItemType;
    readonly count: StackCount;
};
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

### MissingIngredient  `type`

```ts
type MissingIngredient = {
    readonly item: ItemType;
    readonly short: number;
};
```

### PatternCell  `type`

```ts
type PatternCell = Ingredient | undefined;
```

### PlaceableItemType  `type`

```ts
type PlaceableItemType = ItemType & BlockType;
```

### PortalAxis  `type`

```ts
type PortalAxis = 'x' | 'z';
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

### Recipe  `type`

```ts
type Recipe = ShapedRecipe | ShapelessRecipe;
```

### RecipeId  `type`

```ts
type RecipeId = string;
```

### RecipeMatch  `type`

```ts
type RecipeMatch = {
    readonly _tag: 'Match';
    readonly recipe: Recipe;
    readonly output: ItemStack;
} | {
    readonly _tag: 'NoMatch';
};
```

### RecipePattern  `type`

```ts
type RecipePattern = {
    readonly width: number;
    readonly height: number;
    readonly cells: ReadonlyArray<PatternCell>;
};
```

### RecipeTable  `type`

```ts
type RecipeTable = ReadonlyArray<Recipe>;
```

### RosterRepair  `type`

```ts
type RosterRepair = {
    readonly discarded: number;
    readonly reidentified: number;
};
```

### ShapedRecipe  `type`

```ts
type ShapedRecipe = {
    readonly _tag: 'Shaped';
    readonly id: RecipeId;
    readonly pattern: RecipePattern;
    readonly output: ItemStack;
};
```

### ShapelessRecipe  `type`

```ts
type ShapelessRecipe = {
    readonly _tag: 'Shapeless';
    readonly id: RecipeId;
    readonly ingredients: ReadonlyArray<Ingredient>;
    readonly output: ItemStack;
};
```

### Slot  `type`

```ts
type Slot = ItemStack | undefined;
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

### StackCount  `const`

```ts
const StackCount: Brand.Brand.Constructor<StackCount>;
```

### StackCount  `type`

```ts
type StackCount = number & Brand.Brand<'StackCount'>;
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
