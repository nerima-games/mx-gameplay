import { Effect, Layer, Result, Schema } from 'effect'
import {
  AIR_BLOCK_ID,
  BlockAxis,
  BlockId,
  ChunkAxis,
  PositionAxis,
  RandomSeed,
  SimulationTickSchema,
  blockPosition,
  capabilityOfBlockId,
  blockTypeOfId,
  chunkCoord,
  position,
  type BlockPosition,
  type BlockType,
  type DeltaTimeSecs,
  type ItemType,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  countOf,
  emptyFurnaceState,
  STARTER_FUEL_RULES,
  STARTER_RECIPES,
  STARTER_SMELTING_RECIPES,
  advance as advanceTime,
  advanceFurnace,
  craftFromGrid,
  craftGrid,
  dayLengthSecs,
  emptyInventory,
  addItem,
  transferToFurnace,
  INITIAL_TIME_STATE,
  matchSmeltingRecipe,
  timeOfDay,
  TICKS_PER_SECOND,
  type RecipeTable,
} from '@nerima-games/mc-sim'
import { emptyRoster } from '@nerima-games/mc-sim'
import {
  advanceMiningProgress,
  blockLoot,
  isNight,
  miningDurationSecsForBlock,
  miningLootContextForItem,
} from '../../src/index.js'
import { searchSpawnCandidates } from '../../src/domain/entities/mob-spawn-search.js'
import {
  planMobRosterSweep,
  planMobBlastRoster,
  planEndermanTeleportRoster,
  planSpawnAttemptsOnRoster,
  rollCasualtyDrops,
  type MobBehaviour,
  type MobRoster,
} from '../../src/domain/entities/mob-frame.js'
import { resolveHostileContacts, resolvePlayerBlastDamage } from '../../src/domain/mob/hostile-combat.js'
import { dayPhase } from '../../src/domain/day-night.js'
import {
  makeSurvivalHungerRuntime,
  type SurvivalHungerState,
} from '../../src/domain/survival-hunger.js'
import { HOSTILE_SPAWN_INTERVAL_SECS } from '../../src/stages/registration-core.js'
import {
  HeadlessHarness,
  HeadlessHarnessSessionFactoryLayer,
  HeadlessHarnessTestLayer,
  RandomSeedSchema,
  type HeadlessHarnessStages,
} from '@nerima-games/mc-sim/testing'
import {
  CHUNK_HEIGHT,
  ChunkCapacity,
  ChunkStore,
  GeneratedChunkStoreLayer,
  blockIndex,
  generateChunk as generateWorldChunk,
  NoiseSeed,
  surfaceHeightAt,
  type InvalidNaturalStructureCoordinate,
  type NaturalStructureChunk,
} from '@nerima-games/mc-worldgen'

export type BalancePolicyAction = 'shelter' | 'exposed'

export type BalancePolicyInput = Readonly<{
  seed: number
  terrain: NaturalStructureChunk
  firstNightTick: number
  availableBlockTypes: ReadonlyArray<BlockType>
}>

export type BalancePolicy = Readonly<{
  name: string
  decide: (input: BalancePolicyInput) => BalancePolicyAction
}>

export const shelterPolicy: BalancePolicy = {
  name: 'shelter',
  decide: () => 'shelter',
}

export const exposedPolicy: BalancePolicy = {
  name: 'exposed',
  decide: () => 'exposed',
}

export type BalanceObservation =
  | Readonly<{ status: 'observed'; seconds: number; ticks: number }>
  | Readonly<{ status: 'unavailable'; reason: string }>

export type BalanceDamageEvent = Readonly<{
  seconds: number
  ticks: number
  cause?: 'hostile' | 'starvation'
}>

export type BalanceEventSeries =
  | Readonly<{ status: 'observed'; events: ReadonlyArray<BalanceDamageEvent> }>
  | Readonly<{ status: 'partial'; events: ReadonlyArray<BalanceDamageEvent>; reason: string }>
  | Readonly<{ status: 'unavailable'; reason: string }>

export type NightDeathObservation =
  | Readonly<{ status: 'observed'; died: boolean; deathTicks: number | null }>
  | Readonly<{ status: 'unavailable'; reason: string }>

export type PolicyExecutionObservation =
  | Readonly<{
      status: 'observed'
      action: BalancePolicyAction
      startPosition: Readonly<{ x: number; y: number; z: number }>
      targetPosition: Readonly<{ x: number; y: number; z: number }>
      shelterBlocksMined: number
    }>
  | Readonly<{ status: 'unavailable'; reason: string }>

export type SeedObservations = Readonly<{
  firstLog: BalanceObservation
  woodenPickaxe: BalanceObservation
  stoneTool: BalanceObservation
  cookedFood: BalanceObservation
  iron: BalanceObservation
  bedByNight1: BalanceObservation
  night1Death: NightDeathObservation
  preTwilightDamage: BalanceEventSeries
  damageTimestamps: BalanceEventSeries
  hunger: Readonly<{
    status: 'observed'
    died: boolean
    healthPoints: number
    hungerPoints: number
    starvationDamage: number
  }>
}>

export type SeedSimulationResult =
  | Readonly<{
      status: 'simulated'
      seed: number
      policy: Readonly<{ name: string; nightAction: BalancePolicyAction }>
      policyExecution: PolicyExecutionObservation
      firstNightTick: number
      firstTwilightTick: number
      limitations: ReadonlyArray<string>
      terrain: Readonly<{ chunkX: 0; chunkZ: 0; blockTypes: ReadonlyArray<BlockType> }>
      observations: SeedObservations
    }>
  | Readonly<{
      status: 'terrain-failed'
      seed: number
      error: InvalidNaturalStructureCoordinate
    }>
  | Readonly<{
      status: 'invalid-seed'
      seed: number
      reason: string
    }>

type MinedBlock = Readonly<{
  seconds: number
  drops: ReadonlyArray<Readonly<{ item: ItemType; count: number }>>
}>

type CraftAttempt = Readonly<{
  inventory: ReturnType<typeof emptyInventory>
  output: ItemType | undefined
  reason: string | undefined
}>

type MetricName = 'firstLog' | 'woodenPickaxe' | 'stoneTool' | 'iron'

type SurfaceStart = Readonly<{
  readonly x: number
  readonly y: number
  readonly z: number
  readonly groundBlock: ReturnType<typeof BlockId>
  readonly groundPosition: BlockPosition
  readonly exposedPosition: Position
  readonly shelteredPosition: Position
}>

const unavailable = (reason: string): BalanceObservation => ({ status: 'unavailable', reason })

const incompleteEvents = (
  events: ReadonlyArray<BalanceDamageEvent>,
  reason: string,
): BalanceEventSeries => events.length > 0
  ? { status: 'partial', events, reason }
  : { status: 'unavailable', reason }

const reasonOf = (failure: unknown): string => {
  if (typeof failure === 'object' && failure !== null && '_tag' in failure) {
    return String(failure._tag)
  }
  return String(failure)
}

const makeNoopStage = () => Effect.succeed({ changes: [], expectedDimensions: [], events: [] })

const headlessStages: HeadlessHarnessStages = {
  intentsAndRules: makeNoopStage,
  stations: makeNoopStage,
  environment: makeNoopStage,
  entities: makeNoopStage,
}

const targetPosition = blockPosition(BlockAxis(0), BlockAxis(0), BlockAxis(0))

const indexedBlocks = (chunk: NaturalStructureChunk): ReadonlyMap<BlockType, Readonly<{ id: ReturnType<typeof BlockId>; positions: ReadonlyArray<BlockPosition> }>> => {
  const blocks = new Map<BlockType, { id: ReturnType<typeof BlockId>; positions: Array<BlockPosition> }>()
  for (const [index, rawId] of chunk.blocks.entries()) {
    const id = BlockId(rawId)
    const type = Result.getOrUndefined(blockTypeOfId(id))
    if (type === undefined) continue
    const current = blocks.get(type)
    const blockCell = positionFromIndex(index)
    if (current === undefined) {
      blocks.set(type, { id, positions: [blockCell] })
    } else {
      current.positions.push(blockCell)
    }
  }
  return blocks
}

const positionFromIndex = (index: number): BlockPosition => {
  const x = Math.floor(index / (CHUNK_HEIGHT * 16))
  const z = Math.floor(index / CHUNK_HEIGHT) % 16
  const y = index % CHUNK_HEIGHT
  return blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))
}

const mine = (
  blockId: ReturnType<typeof BlockId>,
  item: ItemType | null,
  miningTargetPosition = targetPosition,
): MinedBlock | undefined => {
  const progress = advanceMiningProgress({
    current: null,
    target: { position: miningTargetPosition, blockId },
    isMining: true,
    selectedItem: item,
    deltaSecs: miningDurationSecsForBlock(blockId, item),
  })
  if (!progress.shouldBreak || progress.nextProgress === null) return undefined
  return {
    seconds: progress.nextProgress.elapsedSecs,
    drops: blockLoot(blockId, miningLootContextForItem(item)),
  }
}

const craft = (
  inventory: ReturnType<typeof emptyInventory>,
  recipes: RecipeTable,
  width: number,
  height: number,
  gridItems: ReadonlyArray<ItemType | undefined>,
): CraftAttempt => {
  const grid = craftGrid(width, height, gridItems)
  if (Result.isFailure(grid)) return { inventory, output: undefined, reason: reasonOf(grid.failure) }
  const outcome = craftFromGrid(inventory, recipes, grid.success)
  if (Result.isFailure(outcome)) return { inventory, output: undefined, reason: reasonOf(outcome.failure) }
  if (outcome.success.result._tag !== 'Crafted') {
    return { inventory, output: undefined, reason: outcome.success.result._tag }
  }
  return {
    inventory: outcome.success.inventory,
    output: outcome.success.result.output.item,
    reason: undefined,
  }
}

const inventoryWith = (
  inventory: ReturnType<typeof emptyInventory>,
  item: ItemType,
  count: number,
): Readonly<{ inventory?: ReturnType<typeof emptyInventory>; reason?: string }> => {
  const added = addItem(inventory, item, count)
  return Result.isFailure(added)
    ? { reason: reasonOf(added.failure) }
    : added.success.leftover === 0
      ? { inventory: added.success.inventory }
      : { reason: `inventory-full:${added.success.leftover}` }
}

const inventoryWithDrops = (
  inventory: ReturnType<typeof emptyInventory>,
  drops: ReadonlyArray<Readonly<{ item: ItemType; count: number }>>,
): Readonly<{ inventory?: ReturnType<typeof emptyInventory>; reason?: string }> => {
  let current = inventory
  for (const drop of drops) {
    const next = inventoryWith(current, drop.item, drop.count)
    if (next.inventory === undefined) return next
    current = next.inventory
  }
  return { inventory: current }
}

const firstNightTick = (): number => {
  const ticksPerDay = Math.ceil(dayLengthSecs(INITIAL_TIME_STATE) * TICKS_PER_SECOND)
  const reachedNight = (ticks: number): boolean => {
    const state = Result.getOrThrow(
      advanceTime(INITIAL_TIME_STATE, (ticks / TICKS_PER_SECOND) as DeltaTimeSecs),
    )
    return isNight(timeOfDay(state))
  }
  if (reachedNight(0)) return 0
  let low = 0
  let high = ticksPerDay
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (reachedNight(middle)) high = middle
    else low = middle
  }
  return high
}

const firstNightEndTick = (startTick: number): number => {
  const ticksPerDay = Math.ceil(dayLengthSecs(INITIAL_TIME_STATE) * TICKS_PER_SECOND)
  const reachedNight = (ticks: number): boolean => {
    const state = Result.getOrThrow(
      advanceTime(INITIAL_TIME_STATE, (ticks / TICKS_PER_SECOND) as DeltaTimeSecs),
    )
    return isNight(timeOfDay(state))
  }
  let low = startTick
  let high = startTick + Math.ceil(ticksPerDay / 2)
  while (reachedNight(high)) high += 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (reachedNight(middle)) low = middle
    else high = middle
  }
  return high
}

const firstTwilightTick = (firstNight: number): number => {
  const entersTwilightOrNight = (ticks: number): boolean => {
    const state = Result.getOrThrow(
      advanceTime(INITIAL_TIME_STATE, (ticks / TICKS_PER_SECOND) as DeltaTimeSecs),
    )
    const phase = dayPhase(timeOfDay(state))
    return phase === 'dusk' || phase === 'night'
  }
  let low = 0
  let high = firstNight
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (entersTwilightOrNight(middle)) high = middle
    else low = middle
  }
  return high
}

const findSurfaceStart = (seed: number, chunk: NaturalStructureChunk): SurfaceStart | undefined => {
  const worldSeed = NoiseSeed(seed)
  for (let z = 0; z < 16; z += 1) {
    for (let x = 0; x < 16; x += 1) {
      const y = Number(surfaceHeightAt(worldSeed, BlockAxis(x), BlockAxis(z)))
      const groundRaw = chunk.blocks[blockIndex(x, y, z)]
      const footRaw = chunk.blocks[blockIndex(x, y + 1, z)]
      const headRaw = chunk.blocks[blockIndex(x, y + 2, z)]
      if (groundRaw === undefined || (footRaw ?? 0) !== AIR_BLOCK_ID || (headRaw ?? 0) !== AIR_BLOCK_ID) continue
      const groundBlock = BlockId(groundRaw)
      if (Result.getOrUndefined(capabilityOfBlockId(groundBlock, 'validSpawnSurface')) !== true) continue
      return {
        x,
        y,
        z,
        groundBlock,
        groundPosition: blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z)),
        exposedPosition: position(PositionAxis(x), PositionAxis(y + 1), PositionAxis(z)),
        shelteredPosition: position(PositionAxis(x), PositionAxis(y - 2), PositionAxis(z)),
      }
    }
  }
  return undefined
}

const metricAt = (ticks: number): BalanceObservation => ({
  status: 'observed',
  seconds: ticks / TICKS_PER_SECOND,
  ticks,
})

const generatedChunk = (seed: number):
  | Readonly<{ status: 'ok'; chunk: NaturalStructureChunk }>
  | Readonly<{ status: 'failed'; error: InvalidNaturalStructureCoordinate }> => {
  const result = generateWorldChunk(NoiseSeed(seed), { cx: ChunkAxis(0), cz: ChunkAxis(0) })
  return Result.isFailure(result)
    ? { status: 'failed', error: result.failure }
    : { status: 'ok', chunk: result.success }
}

type NightCombatResult = Readonly<{
  night1Death: NightDeathObservation
  preTwilightDamage: BalanceEventSeries
  damageTimestamps: BalanceEventSeries
}>

const measureNightCombat = async (
  seed: number,
  start: Position,
  firstTwilight: number,
  firstNight: number,
  firstNightEnd: number,
  routeElapsedTicks: number,
  routeHungerState: SurvivalHungerState,
  minedPositions: ReadonlyArray<BlockPosition>,
): Promise<NightCombatResult> => {
  const program = Effect.gen(function* () {
    const store = yield* ChunkStore
    const minimumChunkX = Math.floor((start.x - 40) / 16)
    const maximumChunkX = Math.floor((start.x + 40) / 16)
    const minimumChunkZ = Math.floor((start.z - 40) / 16)
    const maximumChunkZ = Math.floor((start.z + 40) / 16)
    for (let chunkZ = minimumChunkZ; chunkZ <= maximumChunkZ; chunkZ += 1) {
      for (let chunkX = minimumChunkX; chunkX <= maximumChunkX; chunkX += 1) {
        yield* store.load(chunkCoord(ChunkAxis(chunkX), ChunkAxis(chunkZ)))
      }
    }

    for (const minedPosition of minedPositions) {
      const write = yield* store.setBlock(minedPosition, AIR_BLOCK_ID)
      if (write._tag !== 'Written') {
        return {
          night1Death: { status: 'unavailable', reason: `mined terrain block write returned ${write._tag}` },
          preTwilightDamage: { status: 'unavailable', reason: `mined terrain block write returned ${write._tag}` },
          damageTimestamps: { status: 'unavailable', reason: `mined terrain block write returned ${write._tag}` },
        } satisfies NightCombatResult
      }
    }

    if (routeHungerState.vitals.healthPoints <= 0) {
      const reason = 'route hunger runtime ended with zero health before day/night measurement began'
      return {
        night1Death: { status: 'unavailable', reason },
        preTwilightDamage: { status: 'unavailable', reason },
        damageTimestamps: { status: 'unavailable', reason },
      } satisfies NightCombatResult
    }

    const hunger = yield* makeSurvivalHungerRuntime(routeHungerState)
    let roster: MobRoster = emptyRoster<MobBehaviour>()
    let rollSeed = seed
    let state = Result.getOrThrow(
      advanceTime(INITIAL_TIME_STATE, (routeElapsedTicks / TICKS_PER_SECOND) as DeltaTimeSecs),
    )
    let deathTicks: number | null = null
    let contactCooldowns = new Map()
    const preTwilightDamage: Array<BalanceDamageEvent> = []
    const damageTimestamps: Array<BalanceDamageEvent> = []
    let spawnClockSecs = (routeElapsedTicks / TICKS_PER_SECOND) % HOSTILE_SPAWN_INTERVAL_SECS
    let ticks = routeElapsedTicks

    let deathBeforeNight = false
    let deathBeforeTwilight = false
    while (ticks < firstNightEnd && deathTicks === null) {
      const untilNight = ticks < firstNight ? firstNight - ticks : firstNightEnd - ticks
      const stepTicks = Math.min(
        Math.ceil(HOSTILE_SPAWN_INTERVAL_SECS * TICKS_PER_SECOND),
        untilNight,
      )
      const deltaSecs = stepTicks / TICKS_PER_SECOND
      const delta = deltaSecs as DeltaTimeSecs
      const currentTime = timeOfDay(state)
      const hostileSearch = isNight(currentTime)
      spawnClockSecs += deltaSecs
      const searchDue = spawnClockSecs >= HOSTILE_SPAWN_INTERVAL_SECS
      if (searchDue) spawnClockSecs -= HOSTILE_SPAWN_INTERVAL_SECS
      const tickAtEvents = ticks + stepTicks

      if (!hostileSearch) {
        // Daylight spawn search yields passive mobs only; they cannot damage the player.
        const hungerTick = yield* hunger.tick(delta)
        if (hungerTick.starvationDamage > 0) {
          damageTimestamps.push({
            seconds: tickAtEvents / TICKS_PER_SECOND,
            ticks: tickAtEvents,
            cause: 'starvation',
          })
        }
        if (hungerTick.died) {
          deathTicks = tickAtEvents
          deathBeforeNight = tickAtEvents < firstNight
          deathBeforeTwilight = tickAtEvents < firstTwilight
        }
        state = Result.getOrThrow(advanceTime(state, delta))
        ticks = tickAtEvents
        continue
      }

      const sweep = planMobRosterSweep(roster, { target: start, dt: delta }, RandomSeed(rollSeed))
      const teleported = yield* planEndermanTeleportRoster(sweep.roster, store, sweep.teleports)
      const blast = planMobBlastRoster(
        teleported,
        sweep.blasts,
        Schema.decodeUnknownSync(SimulationTickSchema)(ticks),
      )
      const casualtyDrops = rollCasualtyDrops(blast.casualties, sweep.seed)
      rollSeed = casualtyDrops.seed
      const found = searchDue
        ? yield* searchSpawnCandidates(store, start, currentTime, rollSeed)
        : undefined
      if (found !== undefined) rollSeed = found.seed
      const attempts = found?.attempts ?? []
      const spawned = planSpawnAttemptsOnRoster(blast.roster, attempts)
      if (Result.isFailure(spawned)) return yield* Effect.fail(spawned.failure)
      roster = spawned.success.roster

      const contact = resolveHostileContacts(roster.entities, start, deltaSecs, contactCooldowns)
      contactCooldowns = new Map(contact.cooldowns)
      const attacks = sweep.attacks.map((attack) => ({
        damage: { amount: attack.damage, cause: 'mob' as const },
      }))
      const damageEvents = [
        ...attacks,
        ...contact.damages,
        ...resolvePlayerBlastDamage(sweep.blasts, start),
      ]
      for (const event of damageEvents) {
        if (event.damage.amount <= 0) continue
        yield* hunger.damage(event.damage)
        const timestamp = {
          seconds: tickAtEvents / TICKS_PER_SECOND,
          ticks: tickAtEvents,
          cause: 'hostile' as const,
        }
        damageTimestamps.push(timestamp)
        if (tickAtEvents < firstTwilight) preTwilightDamage.push(timestamp)
        const snapshot = yield* hunger.snapshot
        if (snapshot.vitals.healthPoints <= 0) {
          deathTicks = tickAtEvents
          deathBeforeNight = tickAtEvents < firstNight
          deathBeforeTwilight = tickAtEvents < firstTwilight
          break
        }
      }
      const hungerTick = yield* hunger.tick(delta)
      if (hungerTick.starvationDamage > 0) {
        const timestamp = {
          seconds: tickAtEvents / TICKS_PER_SECOND,
          ticks: tickAtEvents,
          cause: 'starvation' as const,
        }
        damageTimestamps.push(timestamp)
      }
      if (hungerTick.died) {
        deathTicks = tickAtEvents
        deathBeforeNight = tickAtEvents < firstNight
        deathBeforeTwilight = tickAtEvents < firstTwilight
      }
      state = Result.getOrThrow(advanceTime(state, delta))
      ticks = tickAtEvents
    }

    const twilightCoverageReason = routeElapsedTicks >= firstTwilight
      ? `combat measurement started at tick ${routeElapsedTicks}, after twilight began at tick ${firstTwilight}`
      : deathBeforeTwilight
        ? `player died at tick ${deathTicks} before the pre-twilight interval ended at tick ${firstTwilight}`
        : `combat measurement started at tick ${routeElapsedTicks}; route actions were not interleaved with combat`
    const preTwilightIncomplete = routeElapsedTicks > 0 || deathBeforeTwilight
    const damageCoverageReason = routeElapsedTicks > 0
      ? `combat damage timestamps exclude the route interval ending at tick ${routeElapsedTicks}`
      : deathTicks !== null
        ? `player died at tick ${deathTicks} before the twilight/night interval ended at tick ${firstNightEnd}`
        : `combat measurement started at tick ${routeElapsedTicks}, after first night ended at tick ${firstNightEnd}`
    const damageCoverageIncomplete = routeElapsedTicks > 0 ||
      deathTicks !== null ||
      routeElapsedTicks >= firstNightEnd
    const night1Death: NightDeathObservation = routeElapsedTicks >= firstNightEnd
      ? { status: 'unavailable', reason: `combat measurement started at tick ${routeElapsedTicks}, after first night ended at tick ${firstNightEnd}` }
      : deathBeforeNight
        ? { status: 'unavailable', reason: `player died at tick ${deathTicks} before first night began at tick ${firstNight}` }
        : deathTicks !== null
          ? { status: 'observed', died: true, deathTicks }
          : routeElapsedTicks > firstNight
            ? { status: 'unavailable', reason: `combat measurement started at tick ${routeElapsedTicks}, after first night began at tick ${firstNight}` }
            : { status: 'observed', died: false, deathTicks: null }

    return {
      night1Death,
      preTwilightDamage: preTwilightIncomplete
        ? incompleteEvents(preTwilightDamage, twilightCoverageReason)
        : { status: 'observed', events: preTwilightDamage },
      damageTimestamps: damageCoverageIncomplete
        ? incompleteEvents(damageTimestamps, damageCoverageReason)
        : { status: 'observed', events: damageTimestamps },
    } satisfies NightCombatResult
  })
  const storeLayer = GeneratedChunkStoreLayer(NoiseSeed(seed), ChunkCapacity(64))
  return Effect.runPromise(Effect.provide(program, storeLayer))
}

export const simulateSeed = async (
  seed: number,
  policy: BalancePolicy,
): Promise<SeedSimulationResult> => {
  if (!Number.isSafeInteger(seed)) {
    return { status: 'invalid-seed', seed, reason: 'seed must be a safe integer' }
  }

  const terrainResult = generatedChunk(seed)
  if (terrainResult.status === 'failed') {
    return { status: 'terrain-failed', seed, error: terrainResult.error }
  }

  const terrain = terrainResult.chunk
  const blocks = indexedBlocks(terrain)
  const firstNight = firstNightTick()
  const firstTwilight = firstTwilightTick(firstNight)
  const availableBlockTypes = [...blocks.keys()]
  const nightAction = policy.decide({ seed, terrain, firstNightTick: firstNight, availableBlockTypes })
  const observations: Record<MetricName, BalanceObservation> = {
    firstLog: unavailable('no oak log in generated chunk (0, 0)'),
    woodenPickaxe: unavailable('requires three mined oak logs, a workbench, and successful starter recipes'),
    stoneTool: unavailable('requires three actual cobblestone drops and a workbench crafting recipe'),
    iron: unavailable('requires a crafted furnace, actual raw iron, fuel, and a successful smelting recipe'),
  }
  let elapsedTicks = 0
  let gatheredInventory = emptyInventory()
  const minedPositions: BlockPosition[] = []
  let miningActions = 0

  const addActionTime = (seconds: number): number => {
    const ticks = Math.ceil(seconds * TICKS_PER_SECOND)
    elapsedTicks += ticks
    return elapsedTicks
  }

  const mineAndCollect = (
    blockId: ReturnType<typeof BlockId>,
    item: ItemType | null,
    minedBlockPosition: BlockPosition,
  ): Readonly<{ mined?: MinedBlock; reason?: string }> => {
    const mined = mine(blockId, item, minedBlockPosition)
    if (mined === undefined) return { reason: 'mining progress did not reach the block break threshold' }
    miningActions += 1
    minedPositions.push(minedBlockPosition)
    addActionTime(mined.seconds)
    const collected = inventoryWithDrops(gatheredInventory, mined.drops)
    if (collected.inventory === undefined) return { mined, reason: collected.reason ?? 'could not add mined drops to inventory' }
    gatheredInventory = collected.inventory
    return { mined }
  }

  const recipesResult = STARTER_RECIPES
  const recipes = Result.getOrUndefined(recipesResult)
  const surfaceStart = findSurfaceStart(seed, terrain)
  let policyActionFailure: string | undefined
  let policyShelterBlocksMined = 0
  let policyActionAttempted = false

  const executeShelterAction = (): void => {
    if (nightAction !== 'shelter' || surfaceStart === undefined || policyActionAttempted) return
    policyActionAttempted = true
    const shelterTool: ItemType | null = countOf(gatheredInventory, 'stone_pickaxe') > 0
      ? 'stone_pickaxe'
      : countOf(gatheredInventory, 'wooden_pickaxe') > 0
        ? 'wooden_pickaxe'
        : null
    for (let depth = 0; depth < 3; depth += 1) {
      const y = surfaceStart.y - depth
      const rawBlock = terrain.blocks[blockIndex(surfaceStart.x, y, surfaceStart.z)]
      if (rawBlock === undefined || rawBlock === AIR_BLOCK_ID) {
        policyActionFailure = `shelter shaft block at depth ${depth} is missing or air`
        break
      }
      const dug = mineAndCollect(
        BlockId(rawBlock),
        shelterTool,
        blockPosition(BlockAxis(surfaceStart.x), BlockAxis(y), BlockAxis(surfaceStart.z)),
      )
      if (dug.reason !== undefined) {
        policyActionFailure = dug.reason
        break
      }
      policyShelterBlocksMined += 1
    }
  }

  const oakLog = blocks.get('oak_log')
  let firstLogObserved = false
  if (oakLog !== undefined) {
    for (const logPosition of oakLog.positions) {
      if (countOf(gatheredInventory, 'oak_log') >= 3) break
      const result = mineAndCollect(oakLog.id, null, logPosition)
      if (
        result.reason === undefined &&
        result.mined !== undefined &&
        result.mined.drops.some((drop) => drop.item === 'oak_log') &&
        countOf(gatheredInventory, 'oak_log') > 0
      ) {
        if (!firstLogObserved) {
          observations.firstLog = metricAt(elapsedTicks)
          firstLogObserved = true
        }
      }
      if (result.reason !== undefined) {
        observations.woodenPickaxe = unavailable(`oak log mining failed: ${result.reason}`)
        break
      }
    }
  }
  if (!firstLogObserved && oakLog !== undefined) {
    observations.firstLog = unavailable('mined oak log blocks in generated chunk (0, 0) did not drop oak_log')
  }

  if (recipes === undefined) {
    const reason = `starter crafting recipes failed: ${reasonOf(Result.isFailure(recipesResult) ? recipesResult.failure : 'no recipe table')}`
    observations.woodenPickaxe = unavailable(reason)
    observations.stoneTool = unavailable(reason)
    observations.iron = unavailable(reason)
  } else if (countOf(gatheredInventory, 'oak_log') < 3) {
    observations.woodenPickaxe = unavailable(
      `only ${countOf(gatheredInventory, 'oak_log')} actual oak_log drops were gathered; three are required for planks, a workbench, sticks, and the wooden pickaxe`,
    )
    observations.stoneTool = unavailable('wooden pickaxe route could not start without three actual oak_log drops')
    observations.iron = unavailable('wooden pickaxe route could not start without three actual oak_log drops')
  } else {
    let plankCraftReason: string | undefined
    for (let index = 0; index < 3; index += 1) {
      const plankCraft = craft(gatheredInventory, recipes, 1, 1, ['oak_log'])
      if (plankCraft.output !== 'oak_planks') {
        plankCraftReason = plankCraft.reason ?? `expected oak_planks, got ${plankCraft.output ?? 'no output'}`
        break
      }
      gatheredInventory = plankCraft.inventory
    }
    if (plankCraftReason !== undefined) {
      observations.woodenPickaxe = unavailable(`oak plank recipe failed: ${plankCraftReason}`)
      observations.stoneTool = unavailable('wooden pickaxe route could not start because planks could not be crafted')
      observations.iron = unavailable('wooden pickaxe route could not start because planks could not be crafted')
    } else {
      const workbench = craft(gatheredInventory, recipes, 2, 2, [
        'oak_planks', 'oak_planks',
        'oak_planks', 'oak_planks',
      ])
      if (workbench.output !== 'crafting_table') {
        observations.woodenPickaxe = unavailable(`workbench recipe failed: ${workbench.reason ?? `expected crafting_table, got ${workbench.output ?? 'no output'}`}`)
        observations.stoneTool = unavailable('3x3 tool recipes require a workbench item from a successful crafting recipe')
        observations.iron = unavailable('furnace route could not start without a workbench')
      } else {
        gatheredInventory = workbench.inventory
        const sticks = craft(gatheredInventory, recipes, 1, 2, ['oak_planks', 'oak_planks'])
        if (sticks.output !== 'stick') {
          observations.woodenPickaxe = unavailable(`stick recipe failed: ${sticks.reason ?? `expected stick, got ${sticks.output ?? 'no output'}`}`)
          observations.stoneTool = unavailable('wooden pickaxe route could not start because sticks could not be crafted')
          observations.iron = unavailable('wooden pickaxe route could not start because sticks could not be crafted')
        } else {
          gatheredInventory = sticks.inventory
          const woodenPick = craft(gatheredInventory, recipes, 3, 3, [
            'oak_planks', 'oak_planks', 'oak_planks',
            undefined, 'stick', undefined,
            undefined, 'stick', undefined,
          ])
          if (woodenPick.output !== 'wooden_pickaxe') {
            observations.woodenPickaxe = unavailable(`wooden pickaxe recipe failed: ${woodenPick.reason ?? `expected wooden_pickaxe, got ${woodenPick.output ?? 'no output'}`}`)
            observations.stoneTool = unavailable('stone tool route could not start without a wooden pickaxe')
            observations.iron = unavailable('iron route could not start without a wooden pickaxe')
          } else {
            gatheredInventory = woodenPick.inventory
            observations.woodenPickaxe = metricAt(elapsedTicks)

            const stone = blocks.get('stone')
            if (stone !== undefined) {
              for (const stonePosition of stone.positions) {
                if (countOf(gatheredInventory, 'cobblestone') >= 11) break
                const result = mineAndCollect(stone.id, 'wooden_pickaxe', stonePosition)
                if (result.reason !== undefined) break
              }
            }
            if (countOf(gatheredInventory, 'cobblestone') < 3) {
              observations.stoneTool = unavailable('actual wooden-pickaxe mining produced fewer than three cobblestone drops')
              observations.iron = unavailable('iron route could not start without three actual cobblestone drops')
            } else {
              const stonePick = craft(gatheredInventory, recipes, 3, 3, [
                'cobblestone', 'cobblestone', 'cobblestone',
                undefined, 'stick', undefined,
                undefined, 'stick', undefined,
              ])
              if (stonePick.output !== 'stone_pickaxe') {
                observations.stoneTool = unavailable(`stone pickaxe recipe failed: ${stonePick.reason ?? `expected stone_pickaxe, got ${stonePick.output ?? 'no output'}`}`)
                observations.iron = unavailable('iron route could not start without a stone pickaxe')
              } else {
                gatheredInventory = stonePick.inventory
                observations.stoneTool = metricAt(elapsedTicks)

                const furnace = craft(gatheredInventory, recipes, 3, 3, [
                  'cobblestone', 'cobblestone', 'cobblestone',
                  'cobblestone', undefined, 'cobblestone',
                  'cobblestone', 'cobblestone', 'cobblestone',
                ])
                if (furnace.output !== 'furnace') {
                  executeShelterAction()
                  observations.iron = unavailable(`furnace recipe failed: ${furnace.reason ?? `expected furnace, got ${furnace.output ?? 'no output'}`}`)
                } else {
                  gatheredInventory = furnace.inventory
                  executeShelterAction()
                  const ironOre = blocks.get('iron_ore') ?? blocks.get('deepslate_iron_ore')
                  let rawIronGathered = false
                  if (ironOre !== undefined) {
                    for (const orePosition of ironOre.positions) {
                      const result = mineAndCollect(ironOre.id, 'stone_pickaxe', orePosition)
                      if (result.mined?.drops.some((drop) => drop.item === 'raw_iron')) {
                        rawIronGathered = true
                        break
                      }
                    }
                  }
                  if (!rawIronGathered || countOf(gatheredInventory, 'raw_iron') < 1) {
                    observations.iron = unavailable('no mined iron_ore or deepslate_iron_ore block produced raw_iron in generated chunk (0, 0)')
                  } else {
                    const recipeList = Result.getOrUndefined(STARTER_SMELTING_RECIPES)
                    const emptyFurnace = Result.getOrUndefined(emptyFurnaceState('furnace'))
                    if (recipeList === undefined || emptyFurnace === undefined) {
                      observations.iron = unavailable('starter furnace state or smelting recipes could not be constructed')
                    } else {
                      const inputTransfer = transferToFurnace(gatheredInventory, emptyFurnace, 'input', 'raw_iron', 1)
                      if (inputTransfer.result._tag !== 'Transferred') {
                        observations.iron = unavailable(`raw_iron furnace transfer failed: ${inputTransfer.result._tag}`)
                      } else {
                        const fuelTransfer = transferToFurnace(inputTransfer.inventory, inputTransfer.furnace, 'fuel', 'oak_planks', 1)
                        if (fuelTransfer.result._tag !== 'Transferred') {
                          observations.iron = unavailable(`oak_planks furnace fuel transfer failed: ${fuelTransfer.result._tag}`)
                        } else {
                          const recipe = Result.getOrUndefined(
                            matchSmeltingRecipe(fuelTransfer.furnace.input, 'furnace', recipeList),
                          )
                          if (recipe === undefined) {
                            observations.iron = unavailable('no starter smelting recipe matched the transferred raw_iron')
                          } else {
                            const cookSeconds = 'cookDurationSecs' in recipe
                              ? recipe.cookDurationSecs
                              : recipe.cookTimeSecs
                            const smelted = Result.getOrUndefined(advanceFurnace(
                              fuelTransfer.furnace,
                              cookSeconds,
                              recipeList,
                              STARTER_FUEL_RULES,
                            ))
                            if (smelted?.state.output?.item === 'iron_ingot') {
                              observations.iron = metricAt(addActionTime(cookSeconds))
                            } else {
                              observations.iron = unavailable('advanceFurnace did not produce an iron_ingot after the recipe cook duration')
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  executeShelterAction()

  const routeHunger = await Effect.runPromise(Effect.gen(function* () {
    const hunger = yield* makeSurvivalHungerRuntime()
    if (miningActions > 0) yield* hunger.submit({ _tag: 'mine', blocks: miningActions })
    const outcome = elapsedTicks > 0
      ? yield* hunger.tick((elapsedTicks / TICKS_PER_SECOND) as DeltaTimeSecs)
      : undefined
    const snapshot = yield* hunger.snapshot
    return {
      state: snapshot,
      died: outcome?.died ?? snapshot.vitals.healthPoints <= 0,
      healthPoints: snapshot.vitals.healthPoints,
      hungerPoints: snapshot.vitals.hungerPoints,
      starvationDamage: outcome?.starvationDamage ?? 0,
    }
  }))

  const nightEnd = firstNightEndTick(firstNight)
  const nightResult = surfaceStart === undefined
    ? {
        night1Death: { status: 'unavailable', reason: 'generated chunk (0, 0) has no valid spawn surface with two air blocks above it' },
        preTwilightDamage: { status: 'unavailable', reason: 'generated chunk (0, 0) has no valid spawn surface with two air blocks above it' },
        damageTimestamps: { status: 'unavailable', reason: 'generated chunk (0, 0) has no valid spawn surface with two air blocks above it' },
      } satisfies NightCombatResult
    : policyActionFailure !== undefined
      ? {
          night1Death: { status: 'unavailable', reason: `policy ${nightAction} action could not be executed: ${policyActionFailure}` },
          preTwilightDamage: { status: 'unavailable', reason: `policy ${nightAction} action could not be executed: ${policyActionFailure}` },
          damageTimestamps: { status: 'unavailable', reason: `policy ${nightAction} action could not be executed: ${policyActionFailure}` },
        } satisfies NightCombatResult
    : await measureNightCombat(
        seed,
        nightAction === 'shelter' ? surfaceStart.shelteredPosition : surfaceStart.exposedPosition,
        firstTwilight,
        firstNight,
        nightEnd,
        elapsedTicks,
        routeHunger.state,
        minedPositions,
      )
  const policyExecution: PolicyExecutionObservation = surfaceStart === undefined
    ? { status: 'unavailable', reason: 'generated chunk (0, 0) has no valid spawn surface with two air blocks above it' }
    : policyActionFailure !== undefined
      ? { status: 'unavailable', reason: `policy ${nightAction} action could not be executed: ${policyActionFailure}` }
      : {
          status: 'observed',
          action: nightAction,
          startPosition: {
            x: surfaceStart.exposedPosition.x,
            y: surfaceStart.exposedPosition.y,
            z: surfaceStart.exposedPosition.z,
          },
          targetPosition: nightAction === 'shelter'
            ? {
                x: surfaceStart.shelteredPosition.x,
                y: surfaceStart.shelteredPosition.y,
                z: surfaceStart.shelteredPosition.z,
              }
            : {
                x: surfaceStart.exposedPosition.x,
                y: surfaceStart.exposedPosition.y,
                z: surfaceStart.exposedPosition.z,
              },
          shelterBlocksMined: policyShelterBlocksMined,
        }

  const finalObservations: SeedObservations = {
    ...observations,
    cookedFood: unavailable('no mined block drop produced raw food, and animal meat drops are not implemented'),
    bedByNight1: unavailable('wool drops, breeding, and shearing are not implemented, so the wool recipe inputs cannot be gathered'),
    night1Death: nightResult.night1Death,
    preTwilightDamage: nightResult.preTwilightDamage,
    damageTimestamps: nightResult.damageTimestamps,
    hunger: {
      status: 'observed',
      died: routeHunger.died,
      healthPoints: routeHunger.healthPoints,
      hungerPoints: routeHunger.hungerPoints,
      starvationDamage: routeHunger.starvationDamage,
    },
  }

  const harnessProgram = Effect.gen(function* () {
    const harness = yield* HeadlessHarness
    yield* harness.reset({
      worldSeed: NoiseSeed(seed),
      randomSeed: Schema.decodeUnknownSync(RandomSeedSchema)(seed),
    })
  })
  const layer = HeadlessHarnessTestLayer(headlessStages).pipe(
    Layer.provide(HeadlessHarnessSessionFactoryLayer),
  )
  await Effect.runPromise(Effect.provide(harnessProgram, layer))

  return {
    status: 'simulated',
    seed,
    policy: { name: policy.name, nightAction },
    policyExecution,
    firstNightTick: firstNight,
    firstTwilightTick: firstTwilight,
    limitations: [
      'Resource collection scans generated chunk (0, 0); travel, pathfinding, and movement time are not modeled. Milestone time sums actual mining durations and furnace cook time. Crafting is a pure recipe transition with no duration rule.',
      'HeadlessHarness resets with both seeds. Route ticks come from mining durations and furnace cook time; mining, loot, crafting, spawn search, mob movement, blast resolution, contact damage, and hunger use directly composed domain functions. Owner-backed casualty drops and experience are not committed.',
      'Pre-twilight hostile damage covers tick 0 through the first dusk tick, but combat starts at routeElapsedTicks. Any nonzero route duration makes coverage incomplete: known hostile hits remain partial target failures, while a no-hit interval is unavailable. damageTimestamps records hostile and starvation hits with causes from routeElapsedTicks through first night. Mining actions are not interleaved with mob frames and all route-mined terrain is applied before combat starts. The player stays at the policy execution target during that interval.',
    ],
    terrain: {
      chunkX: 0,
      chunkZ: 0,
      blockTypes: [...blocks.keys()],
    },
    observations: finalObservations,
  }
}
