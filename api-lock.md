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
exported declarations: 41
supporting declarations: 8

## Exported

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

### EXPERIENCE_MODULE_STAGE_PREFIXES  `const`

```ts
const EXPERIENCE_MODULE_STAGE_PREFIXES: readonly ["gameplay:", "redstone:", "ui:", "multiplayer:"];
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
    readonly fallingBlocks: Ref.Ref<FallingBlockQueue>;
    readonly fluidFrontier: Ref.Ref<ReadonlyArray<FluidWorkItem>>;
    readonly tickCount: Ref.Ref<number>;
};
```

### LAVA_TICK_INTERVAL  `const`

```ts
const LAVA_TICK_INTERVAL = 4;
```

### MAX_HEALTH_POINTS  `const`

```ts
const MAX_HEALTH_POINTS = 20;
```

### NOON_FRACTION  `const`

```ts
const NOON_FRACTION = 0.5;
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "gameplay:";
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

### emptyFallingBlockQueue  `const`

```ts
const emptyFallingBlockQueue: FallingBlockQueue;
```

### fullHealth  `const`

```ts
const fullHealth: Vitals;
```

### gameplayModule  `const`

```ts
const gameplayModule: GameModule<never, never, never>;
```

### gameplayStages  `const`

```ts
const gameplayStages: (state: GameplayFrameState) => ReadonlyArray<StageRegistration>;
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
const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>>;
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

### takeBatch  `const`

```ts
const takeBatch: (queue: FallingBlockQueue, budget?: number) => FallingBlockBatch;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

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
