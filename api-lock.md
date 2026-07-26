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
exported declarations: 72
supporting declarations: 22

## Exported

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

### CREEPER_XP_REWARD  `const`

```ts
const CREEPER_XP_REWARD = 5;
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

### DropRolls  `type`

```ts
type DropRolls = {
    readonly chance: number;
    readonly count: number;
};
```

### EXPERIENCE_MODULE_STAGE_PREFIXES  `const`

```ts
const EXPERIENCE_MODULE_STAGE_PREFIXES: readonly ["gameplay:", "redstone:", "ui:", "multiplayer:"];
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

### GameplayFrameState  `type`

```ts
type GameplayFrameState = {
    readonly pendingBreaks: Ref.Ref<ReadonlyArray<PositionKey>>;
    readonly minedItems: Ref.Ref<ReadonlyArray<BlockId>>;
    readonly fallingBlocks: Ref.Ref<FallingBlockQueue>;
    readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>;
    readonly tickCount: Ref.Ref<number>;
};
```

### HOSTILE_SPAWN_MAX_BLOCK_LIGHT  `const`

```ts
const HOSTILE_SPAWN_MAX_BLOCK_LIGHT = 7;
```

### LAVA_TICK_INTERVAL  `const`

```ts
const LAVA_TICK_INTERVAL = 4;
```

### LOWEST_ROLLS  `const`

```ts
const LOWEST_ROLLS: DropRolls;
```

### MAX_HEALTH_POINTS  `const`

```ts
const MAX_HEALTH_POINTS = 20;
```

### MAX_SPAWN_DISTANCE_BLOCKS  `const`

```ts
const MAX_SPAWN_DISTANCE_BLOCKS = 40;
```

### MIN_SPAWN_DISTANCE_BLOCKS  `const`

```ts
const MIN_SPAWN_DISTANCE_BLOCKS = 16;
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

### MobKill  `type`

```ts
type MobKill = {
    readonly _tag: 'Slain';
    readonly lootingLevel: number;
} | {
    readonly _tag: 'SelfDestruct';
};
```

### NOON_FRACTION  `const`

```ts
const NOON_FRACTION = 0.5;
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "gameplay:";
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

### TWILIGHT_BAND  `const`

```ts
const TWILIGHT_BAND = 0.05;
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

### applyDamage  `const`

```ts
const applyDamage: (vitals: Vitals, damage: Damage) => Vitals;
```

### canHostileSpawnAt  `const`

```ts
const canHostileSpawnAt: (candidate: SpawnCandidate) => SpawnVerdict;
```

### carryOver  `const`

```ts
const carryOver: (frontier: ReadonlyArray<FluidWorkItem>, split: FluidBudgetSplit) => ReadonlyArray<FluidWorkItem>;
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

### disturb  `const`

```ts
const disturb: (queue: FallingBlockQueue, positions: Iterable<PositionKey>) => FallingBlockQueue;
```

### dropPasses  `const`

```ts
const dropPasses: (rule: MobDropRule, roll: number) => boolean;
```

### emptyFallingBlockQueue  `const`

```ts
const emptyFallingBlockQueue: FallingBlockQueue;
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
const gameplayModule: GameModule<never, never, never, ChunkStore>;
```

### gameplayStages  `const`

```ts
const gameplayStages: (state: GameplayFrameState, store: ChunkStoreApi) => ReadonlyArray<StageRegistration>;
```

### hostileSpawnsAllowed  `const`

```ts
const hostileSpawnsAllowed: (timeOfDay: number) => boolean;
```

### isDead  `const`

```ts
const isDead: (vitals: Vitals) => boolean;
```

### isNight  `const`

```ts
const isNight: (timeOfDay: number) => boolean;
```

### makeGameplayFrameState  `const`

```ts
const makeGameplayFrameState: Effect.Effect<GameplayFrameState>;
```

### makeGameplayStages  `const`

```ts
const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, ChunkStore>;
```

### mobXpReward  `const`

```ts
const mobXpReward: (kill: MobKill, reward: number) => number;
```

### rollMobDrop  `const`

```ts
const rollMobDrop: (rule: MobDropRule, kill: MobKill, rolls: DropRolls) => MobDrop | undefined;
```

### rollMobDrops  `const`

```ts
const rollMobDrops: (rules: ReadonlyArray<MobDropRule>, kill: MobKill, rollsFor: (index: number) => DropRolls) => ReadonlyArray<MobDrop>;
```

### settled  `const`

```ts
const settled: (queue: FallingBlockQueue, destinations: Iterable<PositionKey>) => FallingBlockQueue;
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

### takeBatch  `const`

```ts
const takeBatch: (queue: FallingBlockQueue, budget?: number) => FallingBlockBatch;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

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

### ITEM_TYPES  `const`

```ts
const ITEM_TYPES: readonly ["stone", "cobblestone", "dirt", "grass_block", "sand", "gravel", "oak_log", "oak_planks", "oak_leaves", "glass", "torch", "glowstone", "piston", "stick", "glowstone_dust", "wooden_pickaxe", "coal", "iron_ingot", "flint", "gunpowder", "blaze_powder", "flint_and_steel", "fire_charge"];
```

### ItemType  `type`

```ts
type ItemType = (typeof ITEM_TYPES)[number];
```

### PositionKey  `type`

```ts
type PositionKey = string;
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
