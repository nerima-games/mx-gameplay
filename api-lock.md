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
exported declarations: 146
supporting declarations: 37

## Exported

### BLAZE_DROPS  `const`

```ts
const BLAZE_DROPS: ReadonlyArray<MobDropRule>;
```

### BLAZE_XP_REWARD  `const`

```ts
const BLAZE_XP_REWARD = 10;
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

### CasualtyDrops  `type`

```ts
type CasualtyDrops = {
    readonly drops: ReadonlyArray<MobDrop>;
    readonly seed: number;
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

### GameplayFrameState  `type`

```ts
type GameplayFrameState = {
    readonly pendingBreaks: Ref.Ref<ReadonlyArray<PositionKey>>;
    readonly minedItems: Ref.Ref<ReadonlyArray<BlockId>>;
    readonly mobDrops: Ref.Ref<ReadonlyArray<MobDrop>>;
    readonly spawnAttempts: Ref.Ref<ReadonlyArray<MobSpawnAttempt>>;
    readonly targetPosition: Ref.Ref<Position | undefined>;
    readonly timeOfDay: Ref.Ref<number>;
    readonly spawnClockSecs: Ref.Ref<number>;
    readonly rollSeed: Ref.Ref<number>;
    readonly fallingBlocks: Ref.Ref<FallingBlockQueue>;
    readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>;
    readonly tickCount: Ref.Ref<number>;
};
```

### HOSTILE_KINDS  `const`

```ts
const HOSTILE_KINDS: ReadonlyArray<EntityKind>;
```

### HOSTILE_SPAWN_INTERVAL_SECS  `const`

```ts
const HOSTILE_SPAWN_INTERVAL_SECS = 0.3;
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

### MAX_HOSTILE_COUNT  `const`

```ts
const MAX_HOSTILE_COUNT = 16;
```

### MAX_SPAWN_DISTANCE_BLOCKS  `const`

```ts
const MAX_SPAWN_DISTANCE_BLOCKS = 40;
```

### MIN_SPAWN_DISTANCE_BLOCKS  `const`

```ts
const MIN_SPAWN_DISTANCE_BLOCKS = 16;
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

### NOON_FRACTION  `const`

```ts
const NOON_FRACTION = 0.5;
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "gameplay:";
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

### applySpawnAttempts  `const`

```ts
const applySpawnAttempts: (roster: EntityManagerApi<MobBehaviour>, attempts: ReadonlyArray<MobSpawnAttempt>) => Effect.Effect<ReadonlyArray<MobSpawnOutcome>>;
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

### craterCells  `const`

```ts
const craterCells: (centre: BlockPosition, power: number) => ReadonlyArray<BlockPosition>;
```

### craterRadius  `const`

```ts
const craterRadius: (power: number) => number;
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
const gameplayModule: GameModule<never, never, never, ChunkStore | EntityManager>;
```

### gameplayStages  `const`

```ts
const gameplayStages: (state: GameplayFrameState, store: ChunkStoreApi, roster: EntityManagerApi<MobBehaviour>) => ReadonlyArray<StageRegistration>;
```

### hostilePopulation  `const`

```ts
const hostilePopulation: <S>(roster: EntityManagerApi<S>) => Effect.Effect<number>;
```

### hostileSpawnsAllowed  `const`

```ts
const hostileSpawnsAllowed: (timeOfDay: number) => boolean;
```

### initialBehaviourOfKind  `const`

```ts
const initialBehaviourOfKind: (kind: EntityKind) => MobBehaviour;
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
const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, ChunkStore | EntityManager>;
```

### maxHealthOfKind  `const`

```ts
const maxHealthOfKind: (kind: EntityKind) => number;
```

### mobXpReward  `const`

```ts
const mobXpReward: (kill: MobKill, reward: number) => number;
```

### nextRoll  `const`

```ts
const nextRoll: (seed: number) => RollDraw;
```

### normaliseSeed  `const`

```ts
const normaliseSeed: (seed: number) => number;
```

### repairMobBehaviour  `const`

```ts
const repairMobBehaviour: (kind: EntityKind, behaviour: MobBehaviour) => MobBehaviour;
```

### resolveBlasts  `const`

```ts
const resolveBlasts: (roster: EntityManagerApi<MobBehaviour>, store: ChunkStoreApi, blasts: ReadonlyArray<Blast>) => Effect.Effect<BlastResolution>;
```

### rollCasualtyDrops  `const`

```ts
const rollCasualtyDrops: (casualties: ReadonlyArray<MobCasualty>, seed: number) => CasualtyDrops;
```

### rollDropsOfKind  `const`

```ts
const rollDropsOfKind: (kind: EntityKind, kill: MobKill, rolls: ReadonlyArray<number>) => ReadonlyArray<MobDrop>;
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

### sweepMobs  `const`

```ts
const sweepMobs: (roster: EntityManagerApi<MobBehaviour>, senses: MobFrameSenses, seed: number) => Effect.Effect<MobSweep>;
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

### ITEM_TYPES  `const`

```ts
const ITEM_TYPES: readonly ["stone", "cobblestone", "dirt", "grass_block", "sand", "gravel", "oak_log", "oak_planks", "oak_leaves", "glass", "torch", "glowstone", "piston", "stick", "glowstone_dust", "wooden_pickaxe", "coal", "iron_ingot", "flint", "gunpowder", "blaze_powder", "flint_and_steel", "fire_charge"];
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
