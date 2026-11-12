import { Effect, Ref, Result, Schema } from 'effect'
import {
  AIR_BLOCK_ID,
  BlockAxis,
  BlockId,
  ChunkAxis,
  ITEM_TYPES,
  NonNegativeTickCount,
  PositionAxis,
  blockPosition,
  capabilityOfBlockId,
  blockTypeOfId,
  position,
  type BlockPosition,
  type BlockType,
  type ItemType,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  countOf,
  emptyFurnaceState,
  STARTER_FUEL_RULES,
  STARTER_SMELTING_RECIPES,
  advance as advanceTime,
  advanceFurnace,
  craftGrid,
  dayLengthSecs,
  emptyInventory,
  transferToFurnace,
  INITIAL_TIME_STATE,
  isNight as isSimulationNight,
  matchSmeltingRecipe,
  timeOfDay,
  type TimeState,
} from '@nerima-games/mc-sim'
import {
  miningDurationSecsForBlock,
  miningLootContextForItem,
} from '../../src/index.js'
import {
  dayPhase,
  hostileSpawnsAllowed,
  NIGHT_END_FRACTION,
  NIGHT_START_FRACTION,
} from '../../src/domain/day-night.js'
import { PlayerServiceSnapshotSchema, PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import { TickCountSchema } from '@nerima-games/mc-sim/testing'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  blockIndex,
  generateChunk as generateWorldChunk,
  NoiseSeed,
  surfaceHeightAt,
  type InvalidNaturalStructureCoordinate,
  type NaturalStructureChunk,
} from '@nerima-games/mc-worldgen'
import { cellKey } from '../../src/domain/in-memory-world.js'
import {
  BALANCE_HARNESS_TICKS_PER_SECOND,
  makeGeneratedBalanceGameplayRuntime,
  movePlayer,
  runBalanceHarness,
  scheduleGameplayStages,
  setBlockBreakRequest,
  type BalanceTimeServiceReading,
} from './gameplay-harness.js'

export type BalanceEffectRunner = typeof Effect.runPromise

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
  timeService?: BalanceTimeServiceReading
  attacker?: Readonly<{
    source: string
    mobKind: string
    position: Readonly<{ x: number; y: number; z: number }>
    spawnPosition: Readonly<{ x: number; y: number; z: number }> | null
    spawnTick: number | null
    spawnTimeService: BalanceTimeServiceReading | null
    spawnCandidateBlockLight:
      | Readonly<{ status: 'observed'; block: number }>
      | Readonly<{ status: 'unavailable'; reason: string }>
  }>
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
      metricPaths: Readonly<Record<MetricName, string>>
      gameplayStageIds: ReadonlyArray<string>
      gameplayTicks: number
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

const WALK_SPEED_BLOCKS_PER_SECOND = 4.317

type SurfaceStart = Readonly<{
  readonly x: number
  readonly y: number
  readonly z: number
  readonly groundBlock: ReturnType<typeof BlockId>
  readonly groundPosition: BlockPosition
  readonly exposedPosition: Position
  readonly shelteredPosition: Position
}>

type RouteMeasurement = Readonly<{
  observations: Record<MetricName, BalanceObservation>
  routeElapsedTicks: number
  routeHunger: Readonly<{
    died: boolean
    healthPoints: number
    hungerPoints: number
    starvationDamage: number
  }>
  night1Death: NightDeathObservation
  preTwilightDamage: BalanceEventSeries
  damageTimestamps: BalanceEventSeries
  policyActionFailure: string | undefined
  policyShelterBlocksMined: number
}>

const unavailable = (reason: string): BalanceObservation => ({ status: 'unavailable', reason })

const incompleteEvents = (
  events: ReadonlyArray<BalanceDamageEvent>,
  reason: string,
): BalanceEventSeries => events.length > 0
  ? { status: 'partial', events, reason }
  : { status: 'unavailable', reason }

export const observeNight1Death = (input: Readonly<{
  deathTick: number | undefined
  hostileSpawnStart: number
  hostileSpawnEnd: number
  hostileSpawnWindowCovered: boolean
  measurementFailure: string | undefined
}>): NightDeathObservation => input.measurementFailure !== undefined
  ? { status: 'unavailable', reason: input.measurementFailure }
  : !input.hostileSpawnWindowCovered
    ? { status: 'unavailable', reason: 'gameplay stage coverage did not reach the end of the first hostile-spawn window' }
    : input.deathTick !== undefined && input.deathTick < input.hostileSpawnStart
      ? { status: 'unavailable', reason: `player died before hostile spawning began at tick ${input.hostileSpawnStart}` }
      : input.deathTick !== undefined && input.deathTick < input.hostileSpawnEnd
        ? { status: 'observed', died: true, deathTicks: input.deathTick }
        : { status: 'observed', died: false, deathTicks: null }

const reasonOf = (failure: unknown): string => {
  if (typeof failure === 'object' && failure !== null && '_tag' in failure) {
    return String(failure._tag)
  }
  return String(failure)
}

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
  const x = Math.floor(index / (CHUNK_HEIGHT * CHUNK_SIZE_XZ))
  const z = Math.floor(index / CHUNK_HEIGHT) % CHUNK_SIZE_XZ
  const y = index % CHUNK_HEIGHT
  return blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))
}

const stateAfterTicks = (initialTimeState: TimeState, ticks: number): TimeState => {
  const elapsedTicks = Result.getOrThrow(NonNegativeTickCount.result(ticks))
  return Result.getOrThrow(advanceTime(initialTimeState, elapsedTicks))
}

// BAL's clock night follows mc-sim. Hostile survival uses the separate
// gameplay window that allows hostile spawns.
const firstNightTick = (initialTimeState: TimeState): number => {
  const ticksPerDay = Math.ceil(dayLengthSecs(initialTimeState) * BALANCE_HARNESS_TICKS_PER_SECOND)
  const reachedNight = (ticks: number): boolean => isSimulationNight(stateAfterTicks(initialTimeState, ticks))
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

const firstHostileSpawnTick = (initialTimeState: TimeState): number => {
  const ticksPerDay = Math.ceil(dayLengthSecs(initialTimeState) * BALANCE_HARNESS_TICKS_PER_SECOND)
  const allowedAt = (ticks: number): boolean => hostileSpawnsAllowed(timeOfDay(stateAfterTicks(initialTimeState, ticks)))
  if (allowedAt(0)) return 0

  const currentFraction = timeOfDay(initialTimeState)
  const fractionUntilStart = (NIGHT_START_FRACTION - currentFraction + 1) % 1
  let high = Math.max(1, Math.floor(fractionUntilStart * ticksPerDay))
  while (!allowedAt(high)) high += 1
  let low = 0
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (allowedAt(middle)) high = middle
    else low = middle
  }
  return high
}

// The returned end is exclusive because NIGHT_END_FRACTION is inclusive.
const firstHostileSpawnEndTick = (initialTimeState: TimeState, startTick: number): number => {
  const ticksPerDay = Math.ceil(dayLengthSecs(initialTimeState) * BALANCE_HARNESS_TICKS_PER_SECOND)
  const allowedAt = (ticks: number): boolean => hostileSpawnsAllowed(timeOfDay(stateAfterTicks(initialTimeState, ticks)))
  const startFraction = timeOfDay(stateAfterTicks(initialTimeState, startTick))
  const fractionUntilEnd = (NIGHT_END_FRACTION - startFraction + 1) % 1
  let low = startTick + Math.floor(fractionUntilEnd * ticksPerDay)
  while (!allowedAt(low)) low -= 1
  let high = low + 1
  while (allowedAt(high)) high += 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (allowedAt(middle)) low = middle
    else high = middle
  }
  return high
}

const firstNightEndTick = (initialTimeState: TimeState, startTick: number): number => {
  const ticksPerDay = Math.ceil(dayLengthSecs(initialTimeState) * BALANCE_HARNESS_TICKS_PER_SECOND)
  const reachedNight = (ticks: number): boolean => isSimulationNight(stateAfterTicks(initialTimeState, ticks))
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

const firstTwilightTick = (initialTimeState: TimeState, firstNight: number): number => {
  const entersTwilightOrNight = (ticks: number): boolean => {
    const phase = dayPhase(timeOfDay(stateAfterTicks(initialTimeState, ticks)))
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

export const balanceDayBoundaries = (initialTimeState: TimeState = INITIAL_TIME_STATE): Readonly<{
  firstTwilightTick: number
  firstNightTick: number
  firstNightEndTick: number
  firstHostileSpawnTick: number
  firstHostileSpawnEndTick: number
}> => {
  const night = firstNightTick(initialTimeState)
  const hostileSpawnStart = firstHostileSpawnTick(initialTimeState)
  return {
    firstTwilightTick: firstTwilightTick(initialTimeState, night),
    firstNightTick: night,
    firstNightEndTick: firstNightEndTick(initialTimeState, night),
    firstHostileSpawnTick: hostileSpawnStart,
    firstHostileSpawnEndTick: firstHostileSpawnEndTick(initialTimeState, hostileSpawnStart),
  }
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
  seconds: ticks / BALANCE_HARNESS_TICKS_PER_SECOND,
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

export const simulateSeed = async (
  seed: number,
  policy: BalancePolicy,
  runEffect: BalanceEffectRunner,
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
  const boundaries = balanceDayBoundaries()
  const firstNight = boundaries.firstNightTick
  const firstTwilight = boundaries.firstTwilightTick
  const firstNightEnd = boundaries.firstNightEndTick
  const hostileSpawnStart = boundaries.firstHostileSpawnTick
  const hostileSpawnEnd = boundaries.firstHostileSpawnEndTick
  const availableBlockTypes = [...blocks.keys()]
  const nightAction = policy.decide({ seed, terrain, firstNightTick: firstNight, availableBlockTypes })
  const surfaceStart = findSurfaceStart(seed, terrain)
  const spawn = surfaceStart === undefined
    ? { x: 0.5, z: 0.5 }
    : { x: surfaceStart.x + 0.5, z: surfaceStart.z + 0.5 }
  const runtime = await runEffect(makeGeneratedBalanceGameplayRuntime(seed, spawn, seed))

  const result = await runBalanceHarness<RouteMeasurement>(runtime, seed, runEffect, (harness) =>
    Effect.gen(function* () {
      const observations: Record<MetricName, BalanceObservation> = {
        firstLog: unavailable('no oak log in generated chunk (0, 0)'),
        woodenPickaxe: unavailable('requires three mined oak logs and starter recipes'),
        stoneTool: unavailable('requires actual cobblestone drops and a crafting recipe'),
        iron: unavailable('requires a crafted furnace, actual raw iron, fuel, and smelting'),
      }
      const minedPositions = new Set<string>()
      const exploredColumns = new Set<string>()
      let gatheredInventory = yield* runtime.world.inventory.snapshot
      let policyActionFailure: string | undefined
      let policyShelterBlocksMined = 0
      let policyActionAttempted = false
      const step = (ticks: number) => ticks <= 0
        ? Effect.void
        : harness.step(Schema.decodeUnknownSync(TickCountSchema)(ticks))

      const inventoryFromOwner = () => Effect.gen(function* () {
        const snapshot = yield* runtime.commit.coordinator.snapshot(
          runtime.commit.playerStorageOwnerId,
          PlayerStorageSnapshotSchema,
        )
        yield* runtime.world.inventory.restoreStorage(snapshot.state)
        return yield* runtime.world.inventory.snapshot
      })

      const saveInventoryToOwner = () => Effect.gen(function* () {
        const storage = yield* runtime.world.inventory.storageSnapshot
        const snapshot = yield* runtime.commit.coordinator.snapshot(
          runtime.commit.playerStorageOwnerId,
          PlayerStorageSnapshotSchema,
        )
        yield* runtime.commit.coordinator.commit({
          expectedRevision: snapshot.revision,
          expectedDimensions: [],
          changes: [{ ownerId: runtime.commit.playerStorageOwnerId, state: storage }],
        })
      })

      const footPositionFor = (target: BlockPosition): Position => {
        const x = Number(target.x)
        const z = Number(target.z)
        const y = Number(surfaceHeightAt(NoiseSeed(seed), BlockAxis(x), BlockAxis(z)))
        return position(
          PositionAxis(x + 0.5),
          PositionAxis(y + 1),
          PositionAxis(z + 0.5),
        )
      }

      const travelTo = (target: Position) => Effect.gen(function* () {
        const snapshot = yield* runtime.commit.coordinator.snapshot(
          runtime.commit.playerOwnerId,
          PlayerServiceSnapshotSchema,
        )
        const start = snapshot.state.pose.feetPosition
        const distance = Math.hypot(
          target.x - start.x,
          target.y - start.y,
          target.z - start.z,
        )
        const ticks = Math.ceil((distance / WALK_SPEED_BLOCKS_PER_SECOND) * BALANCE_HARNESS_TICKS_PER_SECOND)
        if (distance > 0) {
          yield* runtime.state.survivalHunger.submit({ _tag: 'walk', distance })
        }
        for (let tick = 1; tick <= ticks; tick += 1) {
          const fraction = tick / ticks
          yield* movePlayer(runtime, position(
            PositionAxis(start.x + (target.x - start.x) * fraction),
            PositionAxis(start.y + (target.y - start.y) * fraction),
            PositionAxis(start.z + (target.z - start.z) * fraction),
          ))
          yield* step(1)
        }
      })

      const exploreForBlock = (candidates: ReadonlyArray<Readonly<{
        id: ReturnType<typeof BlockId>
        position: BlockPosition
      }>>) => Effect.gen(function* () {
        const columns = new Map<string, Array<typeof candidates[number]>>()
        for (const candidate of candidates) {
          const x = Math.floor(candidate.position.x)
          const z = Math.floor(candidate.position.z)
          const key = `${x},${z}`
          const column = columns.get(key)
          if (column === undefined) columns.set(key, [candidate])
          else column.push(candidate)
        }

        const snapshot = yield* runtime.commit.coordinator.snapshot(
          runtime.commit.playerOwnerId,
          PlayerServiceSnapshotSchema,
        )
        const current = snapshot.state.pose.feetPosition
        const known = candidates.filter((candidate) =>
          exploredColumns.has(`${Math.floor(candidate.position.x)},${Math.floor(candidate.position.z)}`) &&
          !minedPositions.has(cellKey(candidate.position)),
        )
        if (known.length > 0) {
          return known.reduce((nearest, candidate) => {
            if (nearest === undefined) return candidate
            const nearestTarget = footPositionFor(nearest.position)
            const candidateTarget = footPositionFor(candidate.position)
            const nearestDistance = Math.hypot(
              nearestTarget.x - current.x,
              nearestTarget.y - current.y,
              nearestTarget.z - current.z,
            )
            const candidateDistance = Math.hypot(
              candidateTarget.x - current.x,
              candidateTarget.y - current.y,
              candidateTarget.z - current.z,
            )
            return candidateDistance < nearestDistance ? candidate : nearest
          }, undefined as typeof candidates[number] | undefined)
        }

        const originX = Math.max(0, Math.min(CHUNK_SIZE_XZ - 1, Math.floor(current.x)))
        const originZ = Math.max(0, Math.min(CHUNK_SIZE_XZ - 1, Math.floor(current.z)))
        const searchOrder = Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, (_, index) => ({
          x: index % CHUNK_SIZE_XZ,
          z: Math.floor(index / CHUNK_SIZE_XZ),
        })).filter(({ x, z }) => !exploredColumns.has(`${x},${z}`))
          .sort((left, right) =>
            Math.abs(left.x - originX) + Math.abs(left.z - originZ) -
              (Math.abs(right.x - originX) + Math.abs(right.z - originZ)) ||
            left.z - right.z ||
            left.x - right.x,
          )

        for (const column of searchOrder) {
          const key = `${column.x},${column.z}`
          const y = Number(surfaceHeightAt(NoiseSeed(seed), BlockAxis(column.x), BlockAxis(column.z)))
          yield* travelTo(position(
            PositionAxis(column.x + 0.5),
            PositionAxis(y + 1),
            PositionAxis(column.z + 0.5),
          ))
          exploredColumns.add(key)
          const found = (columns.get(key) ?? []).filter((candidate) =>
            !minedPositions.has(cellKey(candidate.position)),
          )
          if (found.length > 0) return found[0]
        }
        return undefined
      })

      const mineAndCollect = (
        blockId: ReturnType<typeof BlockId>,
        item: ItemType | null,
        minedBlockPosition: BlockPosition,
      ) => Effect.gen(function* () {
        const target = footPositionFor(minedBlockPosition)
        yield* travelTo(target)
        const before = yield* inventoryFromOwner()
        const seconds = miningDurationSecsForBlock(blockId, item)
        const miningTicks = Math.max(1, Math.ceil(seconds * BALANCE_HARNESS_TICKS_PER_SECOND))
        yield* step(miningTicks - 1)
        yield* runtime.state.survivalHunger.submit({ _tag: 'mine', blocks: 1 })
        yield* setBlockBreakRequest(runtime, minedBlockPosition, miningLootContextForItem(item))
        yield* step(1)
        const actualBlock = yield* runtime.world.chunkStore.getBlock(minedBlockPosition)
        if (actualBlock._tag !== 'Block' || actualBlock.block !== AIR_BLOCK_ID) {
          return {
            reason: 'registered interactions stage did not remove the requested block',
            mined: undefined,
          }
        }
        const after = yield* inventoryFromOwner()
        const drops = ITEM_TYPES.flatMap((dropItem) => {
          const count = countOf(after, dropItem) - countOf(before, dropItem)
          return count > 0 ? [{ item: dropItem, count }] : []
        })
        gatheredInventory = after
        minedPositions.add(cellKey(minedBlockPosition))
        return {
          reason: undefined,
          mined: { seconds, drops } satisfies MinedBlock,
        }
      })

      const craft = (
        width: number,
        height: number,
        gridItems: ReadonlyArray<ItemType | undefined>,
      ) => Effect.gen(function* () {
        const inventory = yield* inventoryFromOwner()
        const grid = craftGrid(width, height, gridItems)
        if (Result.isFailure(grid)) {
          return { inventory, output: undefined, reason: reasonOf(grid.failure) } satisfies CraftAttempt
        }
        const crafted = yield* Effect.result(runtime.world.inventory.craft(grid.success))
        if (crafted._tag === 'Failure') {
          return { inventory, output: undefined, reason: reasonOf(crafted.failure) } satisfies CraftAttempt
        }
        if (crafted.success._tag !== 'Crafted') {
          return {
            inventory: yield* runtime.world.inventory.snapshot,
            output: undefined,
            reason: crafted.success._tag,
          } satisfies CraftAttempt
        }
        yield* saveInventoryToOwner()
        gatheredInventory = yield* runtime.world.inventory.snapshot
        return {
          inventory: gatheredInventory,
          output: crafted.success.output.item,
          reason: undefined,
        } satisfies CraftAttempt
      })

      const collectUntil = (
        candidates: ReadonlyArray<Readonly<{ id: ReturnType<typeof BlockId>; position: BlockPosition }>>,
        item: ItemType,
        count: number,
        tool: ItemType | null,
      ) => Effect.gen(function* () {
        let failure: string | undefined
        while (countOf(gatheredInventory, item) < count) {
          const candidate = yield* exploreForBlock(candidates)
          if (candidate === undefined) break
          const dug = yield* mineAndCollect(candidate.id, tool, candidate.position)
          if (dug.reason !== undefined || dug.mined === undefined) {
            failure = dug.reason ?? 'mining did not produce a completed block action'
            break
          }
          if (
            item === 'oak_log' &&
            countOf(gatheredInventory, 'oak_log') > 0 &&
            observations.firstLog.status !== 'observed'
          ) {
            observations.firstLog = metricAt(yield* Ref.get(runtime.stageTickCount))
          }
        }
        return failure
      })

      const candidatesOf = (...types: ReadonlyArray<BlockType>) => types.flatMap((type) => {
        const indexed = blocks.get(type)
        return indexed === undefined
          ? []
          : indexed.positions.map((blockCell) => ({ id: indexed.id, position: blockCell }))
      })

      const executeShelterAction = () => Effect.gen(function* () {
        if (
          nightAction !== 'shelter' ||
          surfaceStart === undefined ||
          policyActionAttempted
        ) return
        policyActionAttempted = true
        const shelterTool: ItemType | null = countOf(gatheredInventory, 'stone_pickaxe') > 0
          ? 'stone_pickaxe'
          : countOf(gatheredInventory, 'wooden_pickaxe') > 0
            ? 'wooden_pickaxe'
            : null
        for (let depth = 0; depth < 3; depth += 1) {
          const target = blockPosition(
            BlockAxis(surfaceStart.x),
            BlockAxis(surfaceStart.y - depth),
            BlockAxis(surfaceStart.z),
          )
          const reading = yield* runtime.world.chunkStore.getBlock(target)
          if (reading._tag !== 'Block' || reading.block === AIR_BLOCK_ID) {
            policyActionFailure = `shelter shaft block at depth ${depth} is missing or air`
            break
          }
          const dug = yield* mineAndCollect(reading.block, shelterTool, target)
          if (dug.reason !== undefined) {
            policyActionFailure = dug.reason
            break
          }
          policyShelterBlocksMined += 1
        }
        if (policyActionFailure === undefined) {
          const sheltered = position(
            PositionAxis(surfaceStart.x + 0.5),
            PositionAxis(surfaceStart.y - 2),
            PositionAxis(surfaceStart.z + 0.5),
          )
          yield* movePlayer(runtime, sheltered)
        }
      })

      const oakLogs = candidatesOf('oak_log')
      let oakFailure = yield* collectUntil(oakLogs, 'oak_log', 3, null)
      if (oakLogs.length === 0) {
        observations.firstLog = unavailable('generated chunk (0, 0) contains no oak_log')
      } else if (oakFailure !== undefined) {
        observations.woodenPickaxe = unavailable(`oak log mining failed: ${oakFailure}`)
      }

      let craftFailure: string | undefined
      if (countOf(gatheredInventory, 'oak_log') < 3) {
        observations.woodenPickaxe = unavailable(
          `only ${countOf(gatheredInventory, 'oak_log')} actual oak_log drops were gathered; three are required for planks, a workbench, sticks, and a wooden pickaxe`,
        )
        observations.stoneTool = unavailable('wooden pickaxe route could not start without three actual oak_log drops')
        observations.iron = unavailable('wooden pickaxe route could not start without three actual oak_log drops')
      } else {
        for (let index = 0; index < 3; index += 1) {
          const plankCraft = yield* craft(1, 1, ['oak_log'])
          if (plankCraft.output !== 'oak_planks') {
            craftFailure = plankCraft.reason ?? `expected oak_planks, got ${String(plankCraft.output)}`
            break
          }
        }
        if (craftFailure === undefined) {
          const workbench = yield* craft(2, 2, [
            'oak_planks', 'oak_planks',
            'oak_planks', 'oak_planks',
          ])
          if (workbench.output !== 'crafting_table') {
            craftFailure = workbench.reason ?? `expected crafting_table, got ${String(workbench.output)}`
          }
        }
        if (craftFailure === undefined) {
          const sticks = yield* craft(1, 2, ['oak_planks', 'oak_planks'])
          if (sticks.output !== 'stick') {
            craftFailure = sticks.reason ?? `expected stick, got ${String(sticks.output)}`
          }
        }
        if (craftFailure === undefined) {
          const woodenPick = yield* craft(3, 3, [
            'oak_planks', 'oak_planks', 'oak_planks',
            undefined, 'stick', undefined,
            undefined, 'stick', undefined,
          ])
          if (woodenPick.output !== 'wooden_pickaxe') {
            craftFailure = woodenPick.reason ?? `expected wooden_pickaxe, got ${String(woodenPick.output)}`
          }
        }
        if (craftFailure !== undefined) {
          observations.woodenPickaxe = unavailable(`starter recipe crafting failed: ${craftFailure}`)
          observations.stoneTool = unavailable('wooden pickaxe route could not start because crafting failed')
          observations.iron = unavailable('iron route could not start because crafting failed')
        } else {
          observations.woodenPickaxe = metricAt(yield* Ref.get(runtime.stageTickCount))
          const stoneFailure = yield* collectUntil(candidatesOf('stone'), 'cobblestone', 11, 'wooden_pickaxe')
          if (stoneFailure !== undefined) {
            observations.stoneTool = unavailable(`wooden-pickaxe mining failed: ${stoneFailure}`)
            observations.iron = unavailable('iron route could not start because stone mining failed')
          } else if (countOf(gatheredInventory, 'cobblestone') < 11) {
            observations.stoneTool = unavailable('generated world had fewer than eleven cobblestone drops')
            observations.iron = unavailable('iron route could not start without a furnace')
          } else {
            const stonePick = yield* craft(3, 3, [
              'cobblestone', 'cobblestone', 'cobblestone',
              undefined, 'stick', undefined,
              undefined, 'stick', undefined,
            ])
            if (stonePick.output !== 'stone_pickaxe') {
              observations.stoneTool = unavailable(`stone pickaxe recipe failed: ${stonePick.reason ?? 'wrong output'}`)
              observations.iron = unavailable('iron route could not start without a stone pickaxe')
            } else {
              observations.stoneTool = metricAt(yield* Ref.get(runtime.stageTickCount))
              const furnace = yield* craft(3, 3, [
                'cobblestone', 'cobblestone', 'cobblestone',
                'cobblestone', undefined, 'cobblestone',
                'cobblestone', 'cobblestone', 'cobblestone',
              ])
              if (furnace.output !== 'furnace') {
                yield* executeShelterAction()
                observations.iron = unavailable(`furnace recipe failed: ${furnace.reason ?? 'wrong output'}`)
              } else {
                gatheredInventory = furnace.inventory
                yield* executeShelterAction()
                const ironFailure = yield* collectUntil(
                  candidatesOf('iron_ore', 'deepslate_iron_ore'),
                  'raw_iron',
                  1,
                  'stone_pickaxe',
                )
                if (ironFailure !== undefined || countOf(gatheredInventory, 'raw_iron') < 1) {
                  observations.iron = unavailable(
                    ironFailure ?? 'no mined iron ore block produced raw_iron in generated chunks',
                  )
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
                            const cookTicks = Math.ceil(cookSeconds * BALANCE_HARNESS_TICKS_PER_SECOND)
                            yield* step(cookTicks)
                            observations.iron = metricAt(yield* Ref.get(runtime.stageTickCount))
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

      yield* executeShelterAction()
      const routeElapsedTicks = yield* Ref.get(runtime.stageTickCount)
      const routeHungerState = yield* runtime.state.survivalHunger.snapshot
      const routeHungerOutcomes = runtime.hungerOutcomesByTick
      const routeStarvationDamage = routeHungerOutcomes.reduce(
        (total, entry) => total + entry.outcome.starvationDamage,
        0,
      )

      const nightTicks = Math.max(0, firstNightEnd - routeElapsedTicks)
      yield* step(nightTicks)
      const coverageEnd = yield* Ref.get(runtime.stageTickCount)
      const hostileEvents = (yield* Ref.get(runtime.damageEventsByTick)).flatMap(({ tick, event, timeService, attacker }) =>
        (event._tag === 'HostileContact' || event._tag === 'Explosion') &&
        event.damage.amount > 0
          ? [{
              seconds: tick / BALANCE_HARNESS_TICKS_PER_SECOND,
              ticks: tick,
              cause: 'hostile' as const,
              timeService,
              ...(attacker === undefined ? {} : { attacker }),
            }]
          : [],
      )
      const starvationEvents = runtime.hungerOutcomesByTick.flatMap(({ tick, outcome }) =>
        outcome.starvationDamage > 0
          ? [{
              seconds: tick / BALANCE_HARNESS_TICKS_PER_SECOND,
              ticks: tick,
              cause: 'starvation' as const,
            }]
          : [],
      )
      const preTwilightHostileEvents = hostileEvents.filter((event) => event.ticks < firstTwilight)
      const deathTick = yield* Ref.get(runtime.deathTick)
      const measurementFailure = yield* Ref.get(runtime.measurementFailure)
      const stagesCovered = coverageEnd >= firstNightEnd
      const hostileSpawnWindowCovered = coverageEnd >= hostileSpawnEnd
      const preTwilightComplete =
        stagesCovered &&
        (deathTick === undefined || deathTick >= firstTwilight) &&
        measurementFailure === undefined
      const damageComplete =
        stagesCovered &&
        (deathTick === undefined || deathTick >= firstNightEnd) &&
        measurementFailure === undefined
      const preTwilightReason = measurementFailure ??
        (deathTick !== undefined && deathTick < firstTwilight
          ? `player died at tick ${deathTick} before twilight tick ${firstTwilight}`
          : 'registered gameplay stages did not cover the complete pre-twilight interval')
      const damageReason = measurementFailure ??
        (deathTick !== undefined && deathTick < firstNightEnd
          ? `player died at tick ${deathTick} before first-night end tick ${firstNightEnd}`
          : 'registered gameplay stages did not cover the complete first-night interval')
      const preTwilightDamage: BalanceEventSeries = preTwilightComplete
        ? { status: 'observed', events: preTwilightHostileEvents }
        : incompleteEvents(preTwilightHostileEvents, preTwilightReason)
      const damageTimestamps: BalanceEventSeries = damageComplete
        ? { status: 'observed', events: [...hostileEvents, ...starvationEvents].sort((a, b) => a.ticks - b.ticks) }
        : incompleteEvents([...hostileEvents, ...starvationEvents], damageReason)
      const firstNightDeath = observeNight1Death({
        deathTick,
        hostileSpawnStart,
        hostileSpawnEnd,
        hostileSpawnWindowCovered,
        measurementFailure,
      })

      return {
        observations,
        routeElapsedTicks,
        routeHunger: {
          died: routeHungerState.vitals.healthPoints <= 0,
          healthPoints: routeHungerState.vitals.healthPoints,
          hungerPoints: routeHungerState.vitals.hungerPoints,
          starvationDamage: routeStarvationDamage,
        },
        night1Death: firstNightDeath,
        preTwilightDamage,
        damageTimestamps,
        policyActionFailure,
        policyShelterBlocksMined,
      }
    }),
  )

  const policyExecution: PolicyExecutionObservation = surfaceStart === undefined
    ? { status: 'unavailable', reason: 'generated chunk (0, 0) has no valid spawn surface with two air blocks above it' }
    : result.policyActionFailure !== undefined
      ? { status: 'unavailable', reason: `policy ${nightAction} action could not be executed: ${result.policyActionFailure}` }
      : {
          status: 'observed',
          action: nightAction,
          startPosition: { x: spawn.x, y: surfaceStart.exposedPosition.y, z: spawn.z },
          targetPosition: nightAction === 'shelter'
            ? { x: spawn.x, y: surfaceStart.y - 2, z: spawn.z }
            : { x: spawn.x, y: surfaceStart.exposedPosition.y, z: spawn.z },
          shelterBlocksMined: result.policyShelterBlocksMined,
        }
  const gameplayTicks = await runEffect(Ref.get(runtime.stageTickCount))

  return {
    status: 'simulated',
    seed,
    policy: { name: policy.name, nightAction },
    policyExecution,
    firstNightTick: firstNight,
    firstTwilightTick: firstTwilight,
    limitations: [
      'Resource exploration walks a deterministic Manhattan-distance order over the 16×16 columns in generated chunk (0, 0), advancing harness ticks at 4.317 blocks/s until a requested resource column is found. This scan and all travel time are estimates: they do not model game visibility/raycast, pathfinding, collision, obstacles, or mining reach.',
      'Player travel updates the owner and PlayerService along an estimated straight line at 4.317 blocks/s; mc-physics foot locomotion, collision, and obstacles are not executed. Movement-dependent times and target attainment are model outputs, not actual-play results. Physical movement and pathfinding are deferred to W6 after release.',
      'Mining requests are sent through the registered gameplay:interactions stage and that stage commits block removal and drops. Time until each request uses the current kernel hardness/(20×speed) mining rule, rounded up to simulation ticks; a bare-hand oak log is 1.75 s here versus about 3.0 s in vanilla, and scale alignment is deferred to W6. The stage has no progressive mining-time state.',
      'There is no crafting stage in gameplayStages() or simStages. Recipe actions use mc-sim InventoryService.craft() and do not advance ticks. Furnace smelting uses advanceFurnace directly and includes its cook duration in harness ticks.',
      'The actual gameplay:entities stage handles spawn search, mob movement, explosions, hostile contact, and damage on the same HeadlessHarness tick stream as route movement/mining. The generated world loads every chunk intersecting the 40-block hostile spawn search radius. Hunger advances through gameplay:survival-hunger.',
      'Animal meat and wool drops are implemented in mx-gameplay, but this route does not search for animals, sheep, or crops, so food and bed inputs remain unavailable to the route.',
    ],
    terrain: { chunkX: 0, chunkZ: 0, blockTypes: [...blocks.keys()] },
    observations: {
      ...result.observations,
      cookedFood: unavailable('the route does not search for animals or crops'),
      bedByNight1: unavailable('the route does not search for sheep'),
      night1Death: result.night1Death,
      preTwilightDamage: result.preTwilightDamage,
      damageTimestamps: result.damageTimestamps,
      hunger: {
        status: 'observed',
        died: result.routeHunger.died,
        healthPoints: result.routeHunger.healthPoints,
        hungerPoints: result.routeHunger.hungerPoints,
        starvationDamage: result.routeHunger.starvationDamage,
      },
    },
    metricPaths: {
      firstLog: 'actual gameplay:interactions stage for mining; deterministic column scan and 4.317 block/s travel are modeled, but game visibility/raycast is not exercised',
      woodenPickaxe: 'actual path not exercised for crafting: no crafting stage is registered; InventoryService.craft is used after deterministic column scan/travel',
      stoneTool: 'actual path not exercised for crafting: no crafting stage is registered; InventoryService.craft is used after deterministic column scan/travel',
      iron: 'actual path not exercised for crafting/smelting; ore mining is stage-backed, deterministic column scan/travel is modeled, furnace uses advanceFurnace',
    },
    gameplayStageIds: scheduleGameplayStages(runtime.stages).map((stage) => stage.id),
    gameplayTicks,
  }
}
