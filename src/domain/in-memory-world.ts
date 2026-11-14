/**
 * The in-memory services, built together, with handles AND a Layer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN THE HOST PULLING SERVICES OUT OF A CONTEXT
 * ---------------------------------------------------------------------------
 *
 * A host that composes `gameplayModule` needs two things: a `Layer` to register
 * the module against, and direct handles on `PlayerService` and `ChunkStore` so
 * its frame loop can move the player and ask what is solid.
 *
 * The obvious way to get the second is `Context.get(context, PlayerService)` —
 * and that needs the TAG, which `index.ts` deliberately does not export.
 * `ChunkStore` and `PlayerService` are `@nerima-games/mc-worldgen`'s and
 * `@nerima-games/mc-sim`'s own tags, and `index.ts`'s "Formerly provisional"
 * note records the general rule this repository holds to: it does not
 * republish another package's tags as its own barrel's API, published or not.
 *
 * So the handles are handed over directly. The tag stays private, the barrel
 * stays clean, and the host gets what it needs without naming a tag this
 * repository does not own.
 *
 * ---------------------------------------------------------------------------
 * ONE CONSTRUCTION, NOT FOUR
 * ---------------------------------------------------------------------------
 *
 * The handles and the Layer come from the SAME service instances. Building a
 * Layer and then constructing a second set for the host is the failure
 * `mc-render/stages/registration.ts` records at length about `InputServiceLayer`
 * — "providing `Layer.effect` twice builds two services", and the symptom there
 * was DOM events landing on a service the frame stage could not see. Here it
 * would be a frame loop moving one player while `render:camera-mirror` mirrors
 * another, which is a world where the camera never follows you.
 */
import { Context, Effect, Layer, Result } from 'effect'
import {
  BlockAxis,
  ChunkAxis,
  PositionAxis,
  chunkCoord,
  BlockId,
  type BlockId as BlockIdType,
  type BlockPosition,
  type ChunkCoord,
  blockPosition,
  position as worldPosition,
} from '@nerima-games/mc-kernel'
import { entityWorldBlockDataAt, type EntityWorldQueryFailure } from './entities/entity-world-cell.js'
import {
  InventoryService,
  TimeService,
  makeTimeService,
  type InventoryServiceApi,
  type Slot,
  type TimeServiceApi,
} from '@nerima-games/mc-sim'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  ChunkStore,
  ChunkCapacity,
  ChunkStoreLayer,
  NoiseSeed,
  blockIndex,
  generatedChunkSource,
  makeChunkStore,
  surfaceHeightAt,
  type Chunk,
  type ChunkSource,
  type ChunkStoreApi,
} from '@nerima-games/mc-worldgen'
import { entityManagerTag, type EntityManager, type EntityManagerApi } from '@nerima-games/mc-sim'
import { PlayerService, type PlayerPose, type PlayerServiceApi } from '@nerima-games/mc-sim'

import { makeInMemoryEntityManager } from './in-memory-entity-manager.js'
import { makeInMemoryInventory } from './in-memory-inventory.js'
import { makeInMemoryPlayer } from './in-memory-player.js'
import { makeInMemoryVitals, type InMemoryVitalsApi, type PlayerVitals } from './in-memory-vitals.js'
import type { Dimension } from '@nerima-games/mc-worldgen'

/** What a host supplies to stand a world up. */
export type WorldContents = {
  /** Cell key to block. Cells absent inside a loaded chunk are air. */
  readonly blocks: ReadonlyMap<string, BlockIdType>
  /** Chunk keys that should be resident when the world is created. */
  readonly loaded: Iterable<string>
}

export const EMPTY_WORLD: WorldContents = { blocks: new Map(), loaded: [] }

export const cellKey = (position: BlockPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

export const chunkKey = (coord: ChunkCoord): string =>
  `${String(coord.cx)},${String(coord.cz)}`

export const chunkOf = (position: BlockPosition): ChunkCoord =>
  chunkCoord(
    ChunkAxis(Math.floor(position.x / CHUNK_SIZE_XZ)),
    ChunkAxis(Math.floor(position.z / CHUNK_SIZE_XZ)),
  )

const parseChunkKey = (key: string): ChunkCoord | undefined => {
  const parts = key.split(',')
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return undefined

  const cx = Number(parts[0])
  const cz = Number(parts[1])
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) return undefined
  const chunkX = ChunkAxis.result(cx)
  const chunkZ = ChunkAxis.result(cz)
  if (Result.isFailure(chunkX) || Result.isFailure(chunkZ)) return undefined

  return chunkCoord(chunkX.success, chunkZ.success)
}

const parseCellKey = (key: string): readonly [number, number, number] | undefined => {
  const parts = key.split(',')
  if (parts.length !== 3 || parts.some((part) => part.trim() === '')) return undefined

  const x = Number(parts[0])
  const y = Number(parts[1])
  const z = Number(parts[2])
  if (![x, y, z].every(Number.isSafeInteger)) return undefined

  return [x, y, z]
}

export const isInWorld = (position: BlockPosition): boolean =>
  Number.isInteger(position.y) && position.y >= 0 && position.y < CHUNK_HEIGHT
export type InMemoryWorldOptions = {
  readonly world?: WorldContents
  readonly spawnPose?: PlayerPose
  readonly dimension?: Dimension
  readonly inventory?: ReadonlyArray<Slot>
  readonly vitals?: PlayerVitals
}

/** Options for a deterministic generated overworld. */
export type GeneratedWorldOptions = {
  readonly seed?: number
  readonly chunkSource?: ChunkSource
  readonly spawnX?: number
  readonly spawnZ?: number
  readonly yawRadians?: number
  readonly pitchRadians?: number
  readonly dimension?: Dimension
  readonly inventory?: ReadonlyArray<Slot>
  readonly vitals?: PlayerVitals
}

export type WorldInputFailure = Readonly<{
  readonly _tag: 'WorldInputFailure'
  readonly field:
    | 'world'
    | 'world.blocks'
    | 'world.loaded'
    | 'spawnPose'
    | 'dimension'
    | 'inventory'
    | 'vitals'
    | 'chunkSource'
    | 'yawRadians'
    | 'pitchRadians'
  readonly reason: 'undefined' | 'invalid'
}>

const worldInputFailure = (
  field: WorldInputFailure['field'],
  reason: WorldInputFailure['reason'],
): WorldInputFailure => ({ _tag: 'WorldInputFailure', field, reason })

const isIterable = (value: unknown): value is Iterable<unknown> =>
  value !== null
  && (typeof value === 'object' || typeof value === 'string')
  && typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'

const isReadonlyMap = (value: unknown): value is ReadonlyMap<unknown, unknown> =>
  value !== null
  && typeof value === 'object'
  && typeof (value as { readonly get?: unknown }).get === 'function'
  && typeof (value as { readonly has?: unknown }).has === 'function'
  && isIterable(value)

const isWorldContents = (value: unknown): value is WorldContents => {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { readonly blocks?: unknown; readonly loaded?: unknown }
  return isReadonlyMap(candidate.blocks) && isIterable(candidate.loaded)
}

/**
 * The service handles, plus the Layer that provides the stage-facing services.
 *
 * `layer` is what `registerModule` is provided from; the five handles are for
 * a host loop that drives them directly. They are the SAME objects — see the
 * header on why that matters more than it looks.
 */
export type InMemoryWorld<S> = {
  readonly layer: Layer.Layer<
    ChunkStore | EntityManager | InventoryService | PlayerService | TimeService
  >
  readonly chunkStore: ChunkStoreApi
  readonly inventory: InventoryServiceApi
  readonly player: PlayerServiceApi
  readonly time: TimeServiceApi
  readonly entities: EntityManagerApi<S>
  readonly vitals: InMemoryVitalsApi
}

/** A generated world plus its unwrapped store for meshing and rendering adapters. */
export type GeneratedWorld<S> = InMemoryWorld<S> & {
  readonly worldgenChunkStore: ChunkStoreApi
}

const GENERATED_WORLD_CHUNK_CAPACITY = ChunkCapacity(256)

/** Keep the public adapter name while preserving the store's typed failures. */
export const adaptGeneratedChunkStore = (store: ChunkStoreApi): ChunkStoreApi => store

const makeWorldWithStore = <S>(
  chunkStore: ChunkStoreApi,
  options: {
    readonly spawnPose?: PlayerPose | undefined
    readonly dimension?: Dimension | undefined
    readonly inventory?: ReadonlyArray<Slot> | undefined
    readonly vitals?: PlayerVitals | undefined
  },
) => Effect.gen(function* () {
    for (const field of ['spawnPose', 'dimension', 'inventory', 'vitals'] as const) {
      if (Object.hasOwn(options, field) && options[field] === undefined) {
        return yield* Effect.fail(worldInputFailure(field, 'undefined'))
      }
    }

    const inventory = yield* makeInMemoryInventory(options.inventory)
    const player = yield* makeInMemoryPlayer(options.spawnPose, options.dimension)
    const entities = yield* makeInMemoryEntityManager<S>()
    const time = yield* makeTimeService()
    const vitals = yield* makeInMemoryVitals(options.vitals)

    const layer = Layer.mergeAll(
      Layer.succeed(ChunkStore, chunkStore),
      Layer.succeed(InventoryService, inventory),
      Layer.succeed(PlayerService, player),
      Layer.succeed(TimeService, time),
      Layer.succeed(entityManagerTag<S>(), entities),
    )

    return { layer, chunkStore, inventory, player, time, entities, vitals }
  })

/**
 * Stand up a world.
 *
 * `S` is the entity behaviour type the host instantiates — the same parameter
 * `entityManagerTag` takes, and the reason `EntityManager` is one requirement
 * whatever a consumer chooses.
 */
const makeWorldChunkSource = (
  world: WorldContents,
): Result.Result<
  { readonly source: ChunkSource; readonly loaded: ReadonlyArray<ChunkCoord> },
  WorldInputFailure
> => {
  const chunks = new Map<string, Uint16Array>()

  for (const [cell, block] of world.blocks) {
    if (typeof cell !== 'string' || Result.isFailure(BlockId.result(block))) {
      return Result.fail(worldInputFailure('world.blocks', 'invalid'))
    }
    const coordinates = parseCellKey(cell)
    if (coordinates === undefined) {
      return Result.fail(worldInputFailure('world.blocks', 'invalid'))
    }
    const [x, y, z] = coordinates
    const blockX = BlockAxis.result(x)
    const blockY = BlockAxis.result(y)
    const blockZ = BlockAxis.result(z)
    if (Result.isFailure(blockX) || Result.isFailure(blockY) || Result.isFailure(blockZ)) {
      return Result.fail(worldInputFailure('world.blocks', 'invalid'))
    }
    if (blockY.success < 0 || blockY.success >= CHUNK_HEIGHT) {
      return Result.fail(worldInputFailure('world.blocks', 'invalid'))
    }

    const chunkX = ChunkAxis.result(Math.floor(blockX.success / CHUNK_SIZE_XZ))
    const chunkZ = ChunkAxis.result(Math.floor(blockZ.success / CHUNK_SIZE_XZ))
    if (Result.isFailure(chunkX) || Result.isFailure(chunkZ)) {
      return Result.fail(worldInputFailure('world.blocks', 'invalid'))
    }
    const coord = chunkCoord(chunkX.success, chunkZ.success)
    const coordKey = chunkKey(coord)
    let blocks = chunks.get(coordKey)
    if (blocks === undefined) {
      blocks = new Uint16Array(CHUNK_VOLUME)
      chunks.set(coordKey, blocks)
    }

    const localX = ((blockX.success % CHUNK_SIZE_XZ) + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
    const localZ = ((blockZ.success % CHUNK_SIZE_XZ) + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
    blocks[blockIndex(localX, blockY.success, localZ)] = block
  }

  const loaded: Array<ChunkCoord> = []
  for (const key of world.loaded) {
    if (typeof key !== 'string') {
      return Result.fail(worldInputFailure('world.loaded', 'invalid'))
    }
    const coord = parseChunkKey(key)
    if (coord === undefined) return Result.fail(worldInputFailure('world.loaded', 'invalid'))
    loaded.push(coord)
  }

  const source: ChunkSource = (coord) => {
    const resident = chunks.get(chunkKey(coord))
    const blocks =
      resident === undefined
        ? new Uint16Array(CHUNK_VOLUME)
        : new Uint16Array(resident)

    const chunk: Chunk = { coord, blocks, biomes: [] }
    return Effect.succeed(chunk)
  }

  return Result.succeed({ source, loaded })
}
export const makeInMemoryWorld = <S>(
  options: InMemoryWorldOptions = {},
) => Effect.gen(function* () {
    const world = Object.hasOwn(options, 'world') ? options.world : EMPTY_WORLD
    if (world === undefined) return yield* Effect.fail(worldInputFailure('world', 'undefined'))
    if (!isWorldContents(world)) return yield* Effect.fail(worldInputFailure('world', 'invalid'))
    const { source, loaded } = yield* Effect.fromResult(makeWorldChunkSource(world))
    const context = yield* Effect.scoped(
      Layer.build(ChunkStoreLayer(source, ChunkCapacity(Number.MAX_SAFE_INTEGER))),
    )
    const chunkStore = Context.get(context, ChunkStore)

    for (const coord of loaded) {
      yield* chunkStore.load(coord)
    }

    return yield* makeWorldWithStore<S>(chunkStore, options)
  })

/** Stand up a deterministic generated world backed by mc-worldgen's real store. */
export const makeGeneratedWorld = <S>(
  options: GeneratedWorldOptions = {},
) => Effect.gen(function* () {
    const seedInput = Object.hasOwn(options, 'seed') ? options.seed : 8675309
    const spawnXInput = Object.hasOwn(options, 'spawnX') ? options.spawnX : 0.5
    const spawnZInput = Object.hasOwn(options, 'spawnZ') ? options.spawnZ : 0.5
    const seed = yield* Effect.fromResult(NoiseSeed.result(seedInput))
    const spawnX = yield* Effect.fromResult(PositionAxis.result(spawnXInput))
    const spawnZ = yield* Effect.fromResult(PositionAxis.result(spawnZInput))
    const blockX = yield* Effect.fromResult(BlockAxis.result(Math.floor(spawnX)))
    const blockZ = yield* Effect.fromResult(BlockAxis.result(Math.floor(spawnZ)))
    const spawnY = yield* Effect.fromResult(
      PositionAxis.result(surfaceHeightAt(seed, blockX, blockZ) + 1),
    )
    const chunkSource = Object.hasOwn(options, 'chunkSource')
      ? options.chunkSource
      : generatedChunkSource(seed)
    if (chunkSource === undefined) {
      return yield* Effect.fail(worldInputFailure('chunkSource', 'undefined'))
    }
    if (typeof chunkSource !== 'function') {
      return yield* Effect.fail(worldInputFailure('chunkSource', 'invalid'))
    }
    const worldgenStore = yield* makeChunkStore(chunkSource, GENERATED_WORLD_CHUNK_CAPACITY)
    const chunkStore = adaptGeneratedChunkStore(worldgenStore)
    const yawRadians = Object.hasOwn(options, 'yawRadians') ? options.yawRadians : 0
    const pitchRadians = Object.hasOwn(options, 'pitchRadians') ? options.pitchRadians : 0
    if (typeof yawRadians !== 'number' || !Number.isFinite(yawRadians)) {
      return yield* Effect.fail(
        worldInputFailure('yawRadians', yawRadians === undefined ? 'undefined' : 'invalid'),
      )
    }
    if (typeof pitchRadians !== 'number' || !Number.isFinite(pitchRadians)) {
      return yield* Effect.fail(
        worldInputFailure('pitchRadians', pitchRadians === undefined ? 'undefined' : 'invalid'),
      )
    }
    const spawnPose: PlayerPose = {
      feetPosition: worldPosition(spawnX, spawnY, spawnZ),
      yawRadians,
      pitchRadians,
    }

    const world = yield* makeWorldWithStore<S>(chunkStore, {
      spawnPose,
      ...(Object.hasOwn(options, 'dimension') ? { dimension: options.dimension } : {}),
      ...(Object.hasOwn(options, 'inventory') ? { inventory: options.inventory } : {}),
      ...(Object.hasOwn(options, 'vitals') ? { vitals: options.vitals } : {}),
    })

    return { ...world, worldgenChunkStore: worldgenStore }
  })

/**
 * Is this cell something a body cannot pass through?
 *
 * BOUND TO A STORE rather than taking one per call, so a host wires it once and
 * `resolvePlayerMovement` gets the predicate shape it wants.
 *
 * AN UNLOADED CHUNK ANSWERS SOLID. `@nerima-games/mc-worldgen` reports
 * `ChunkNotLoaded` rather than air precisely so a caller can choose, and for
 * COLLISION the safe choice is solid: treating the edge of the loaded world as
 * air lets a player walk off it and fall forever. `mc-meshing` makes the
 * opposite choice for the same reading and is also right — an unloaded
 * neighbour should mesh as open sky rather than as a black wall. The two
 * choices are the reason the reading is three-valued.
 */
export const solidityFromStore =
  (store: ChunkStoreApi) =>
  (position: { readonly x: number; readonly y: number; readonly z: number }): Result.Result<boolean, EntityWorldQueryFailure> => {
    const x = Result.getOrUndefined(BlockAxis.result(Math.floor(position.x)))
    const y = Result.getOrUndefined(BlockAxis.result(Math.floor(position.y)))
    const z = Result.getOrUndefined(BlockAxis.result(Math.floor(position.z)))
    if (x === undefined || y === undefined || z === undefined) return Result.succeed(true)
    const cell = blockPosition(x, y, z)
    const reading = Effect.runSync(store.getBlock(cell))
    if (reading._tag !== 'Block') return Result.succeed(true)
    const data = entityWorldBlockDataAt(cell, reading.block)
    if (Result.isFailure(data)) return Result.fail(data.failure)
    return Result.succeed(!data.success.capabilities.passable)
  }

/** Only loaded, non-air cells can be selected by a player interaction ray. */
export const targetabilityFromStore =
  (store: ChunkStoreApi) =>
  (x: number, y: number, z: number): boolean => {
    const blockX = Result.getOrUndefined(BlockAxis.result(x))
    const blockY = Result.getOrUndefined(BlockAxis.result(y))
    const blockZ = Result.getOrUndefined(BlockAxis.result(z))
    if (blockX === undefined || blockY === undefined || blockZ === undefined) return false
    const reading = Effect.runSync(store.getBlock(blockPosition(blockX, blockY, blockZ)))
    return reading._tag === 'Block' && reading.block !== 0
  }
