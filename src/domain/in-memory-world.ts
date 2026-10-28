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
  type BlockId,
  type BlockPosition,
  type ChunkCoord,
  blockPosition,
  capabilityOfBlockId,
  position,
} from '@nerima-games/mc-kernel'
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
  readonly blocks: ReadonlyMap<string, BlockId>
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

  return chunkCoord(ChunkAxis(cx), ChunkAxis(cz))
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

/**
 * `ChunkStoreApi` is `@nerima-games/mc-worldgen`'s real type now — no
 * coordinate or block-id branding conversion is needed here any more. The one
 * thing this repository still cannot take unmodified is `load`/`unload`'s
 * `ChunkPersistenceError` channel: nothing downstream of `ChunkStore` in this
 * repository is written to handle it, so it is turned into a defect at this
 * boundary, same as `WorldgenChunkStoreApi` used to be adapted for branding.
 * `worldgenChunkStore` on `GeneratedWorld` keeps the raw, un-widened store for
 * a consumer (mc-render, mc-meshing) that wants the real error channel.
 */
export const adaptGeneratedChunkStore = (store: ChunkStoreApi): ChunkStoreApi => ({
  ...store,
  load: (coord) => store.load(coord).pipe(Effect.orDie),
  unload: (coord) => store.unload(coord).pipe(Effect.orDie),
})

const makeWorldWithStore = <S>(
  chunkStore: ChunkStoreApi,
  options: {
    readonly spawnPose?: PlayerPose | undefined
    readonly dimension?: Dimension | undefined
    readonly inventory?: ReadonlyArray<Slot> | undefined
    readonly vitals?: PlayerVitals | undefined
  },
): Effect.Effect<InMemoryWorld<S>> =>
  Effect.orDie(Effect.gen(function* () {
    const inventory = yield* Effect.orDie(makeInMemoryInventory(options.inventory))
    const player = yield* makeInMemoryPlayer(options.spawnPose, options.dimension)
    const entities = yield* Effect.orDie(makeInMemoryEntityManager<S>())
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
  }))

/**
 * Stand up a world.
 *
 * `S` is the entity behaviour type the host instantiates — the same parameter
 * `entityManagerTag` takes, and the reason `EntityManager` is one requirement
 * whatever a consumer chooses.
 */
const makeWorldChunkSource = (
  world: WorldContents,
): { readonly source: ChunkSource; readonly loaded: ReadonlyArray<ChunkCoord> } => {
  const chunks = new Map<string, Uint16Array>()

  for (const [cell, block] of world.blocks) {
    const coordinates = parseCellKey(cell)
    if (coordinates === undefined) continue
    const [x, y, z] = coordinates
    if (y < 0 || y >= CHUNK_HEIGHT) continue

    const coord = chunkCoord(
      ChunkAxis(Math.floor(x / CHUNK_SIZE_XZ)),
      ChunkAxis(Math.floor(z / CHUNK_SIZE_XZ)),
    )
    const coordKey = chunkKey(coord)
    let blocks = chunks.get(coordKey)
    if (blocks === undefined) {
      blocks = new Uint16Array(CHUNK_VOLUME)
      chunks.set(coordKey, blocks)
    }

    const localX = ((x % CHUNK_SIZE_XZ) + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
    const localZ = ((z % CHUNK_SIZE_XZ) + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
    blocks[blockIndex(localX, y, localZ)] = block
  }

  const loaded = [...world.loaded]
    .map(parseChunkKey)
    .filter((coord): coord is ChunkCoord => coord !== undefined)

  const source: ChunkSource = (coord) => {
    const resident = chunks.get(chunkKey(coord))
    const blocks =
      resident === undefined
        ? new Uint16Array(CHUNK_VOLUME)
        : new Uint16Array(resident)

    const chunk: Chunk = { coord, blocks, biomes: [] }
    return Effect.succeed(chunk)
  }

  return { source, loaded }
}
export const makeInMemoryWorld = <S>(
  options: InMemoryWorldOptions = {},
): Effect.Effect<InMemoryWorld<S>> =>
  Effect.orDie(
    Effect.gen(function* () {
      const { source, loaded } = makeWorldChunkSource(options.world ?? EMPTY_WORLD)
      const context = yield* Effect.scoped(
        Layer.build(ChunkStoreLayer(source, ChunkCapacity(Number.MAX_SAFE_INTEGER))),
      )
      const chunkStore = Context.get(context, ChunkStore)

      for (const coord of loaded) {
        yield* chunkStore.load(coord)
      }

      return yield* makeWorldWithStore<S>(chunkStore, options)
    }),
  )

/** Stand up a deterministic generated world backed by mc-worldgen's real store. */
export const makeGeneratedWorld = <S>(
  options: GeneratedWorldOptions = {},
): Effect.Effect<GeneratedWorld<S>> =>
  Effect.orDie(Effect.gen(function* () {
    const seed = yield* Effect.fromResult(NoiseSeed.result(options.seed ?? 8675309))
    const spawnX = yield* Effect.fromResult(PositionAxis.result(options.spawnX ?? 0.5))
    const spawnZ = yield* Effect.fromResult(PositionAxis.result(options.spawnZ ?? 0.5))
    const blockX = yield* Effect.fromResult(BlockAxis.result(Math.floor(spawnX)))
    const blockZ = yield* Effect.fromResult(BlockAxis.result(Math.floor(spawnZ)))
    const spawnY = yield* Effect.fromResult(
      PositionAxis.result(surfaceHeightAt(seed, blockX, blockZ) + 1),
    )
    const worldgenStore = yield* makeChunkStore(
      options.chunkSource ?? generatedChunkSource(seed),
      GENERATED_WORLD_CHUNK_CAPACITY,
    )
    const chunkStore = adaptGeneratedChunkStore(worldgenStore)
    const spawnPose: PlayerPose = {
      feetPosition: position(spawnX, spawnY, spawnZ),
      yawRadians: options.yawRadians ?? 0,
      pitchRadians: options.pitchRadians ?? 0,
    }

    const world = yield* makeWorldWithStore<S>(chunkStore, {
      spawnPose,
      dimension: options.dimension,
      inventory: options.inventory,
      vitals: options.vitals,
    })

    return { ...world, worldgenChunkStore: worldgenStore }
  }))

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
  (position: { readonly x: number; readonly y: number; readonly z: number }): boolean => {
    const x = Result.getOrUndefined(BlockAxis.result(Math.floor(position.x)))
    const y = Result.getOrUndefined(BlockAxis.result(Math.floor(position.y)))
    const z = Result.getOrUndefined(BlockAxis.result(Math.floor(position.z)))
    if (x === undefined || y === undefined || z === undefined) return true
    const reading = Effect.runSync(store.getBlock(blockPosition(x, y, z)))
    switch (reading._tag) {
      case 'Block':
        return Result.getOrUndefined(capabilityOfBlockId(reading.block, 'passable')) !== true
      case 'ChunkNotLoaded':
        return true
      case 'OutOfWorld':
        // Below bedrock or above the build limit. Solid at the bottom stops a
        // fall; solid at the top is harmless because nothing reaches it.
        return true
      // exhaustiveness arm over BlockReading, a closed three-tag union
      // (mc-worldgen's chunk-store-state.d.ts); 'Block', 'ChunkNotLoaded' and
      // 'OutOfWorld' are the only reachable tags and all three are covered
      // above, so no input can reach this arm.
      /* v8 ignore start */
      default: {
        const exhaustive: never = reading
        return exhaustive
      }
      /* v8 ignore stop */
    }
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
