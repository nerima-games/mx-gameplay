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
 * `@nerima-games/mc-sim` and `./chunk-store-port.ts` are MIRRORS, and this
 * organisation keeps mirrors out of the barrel on purpose: fourteen of fifteen
 * repositories do it, `test/chunk-store-mirror.test.ts` pins it with
 * `expect(Object.keys(barrel)).not.toContain('ChunkStore')`, and the reason is
 * that the day mc-sim publishes, these files are deleted — a consumer that had
 * imported the tag from here would break, where one that never could does not.
 *
 * So the handles are handed over directly. The tag stays private, the barrel
 * stays clean, and the host gets what it needs without naming a mirrored
 * symbol.
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
import { Effect, Layer } from 'effect'
import {
  BlockId as WorldgenBlockId,
  blockPosition as worldgenBlockPosition,
  capabilityOfBlockId,
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
  chunkCoord as worldgenChunkCoord,
  generatedChunkSource,
  makeChunkStore,
  surfaceHeightAt,
  type ChunkSource,
  type ChunkStoreApi as WorldgenChunkStoreApi,
} from '@nerima-games/mc-worldgen'
import { ChunkStore, type ChunkStoreApi } from './chunk-store-port.js'
import { entityManagerTag, type EntityManager, type EntityManagerApi } from '@nerima-games/mc-sim'
import { PlayerService, type PlayerPose, type PlayerServiceApi } from '@nerima-games/mc-sim'
import { makeInMemoryChunkStore, type WorldContents } from './in-memory-chunk-store.js'
import { makeInMemoryEntityManager } from './in-memory-entity-manager.js'
import { makeInMemoryInventory } from './in-memory-inventory.js'
import { makeInMemoryPlayer } from './in-memory-player.js'
import { makeInMemoryVitals, type InMemoryVitalsApi, type PlayerVitals } from './in-memory-vitals.js'
import type { Dimension } from '@nerima-games/mc-worldgen'

/** What a host supplies to stand a world up. */
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

/** A generated world plus its typed store for meshing and rendering adapters. */
export type GeneratedWorld<S> = InMemoryWorld<S> & {
  readonly worldgenChunkStore: WorldgenChunkStoreApi
}

/**
 * Adapt the published branded worldgen boundary to gameplay's temporary,
 * deliberately unbranded mirror. The returned methods still operate on the
 * same underlying store; no chunks or dirty queues are copied.
 */
export const adaptGeneratedChunkStore = (store: WorldgenChunkStoreApi): ChunkStoreApi => ({
  load: (coord) => store.load(worldgenChunkCoord(coord.cx, coord.cz)).pipe(Effect.orDie),
  peek: (coord) => store.peek(worldgenChunkCoord(coord.cx, coord.cz)),
  snapshot: (coord) => store.snapshot(worldgenChunkCoord(coord.cx, coord.cz)),
  isLoaded: (coord) => store.isLoaded(worldgenChunkCoord(coord.cx, coord.cz)),
  loadedCoords: store.loadedCoords,
  neighbours: (coord) => store.neighbours(worldgenChunkCoord(coord.cx, coord.cz)),
  unload: (coord) => store.unload(worldgenChunkCoord(coord.cx, coord.cz)).pipe(Effect.orDie),
  getBlock: (position) => store.getBlock(worldgenBlockPosition(position.x, position.y, position.z)),
  setBlock: (position, block) =>
    store.setBlock(
      worldgenBlockPosition(position.x, position.y, position.z),
      WorldgenBlockId(block),
    ),
  getLight: (position) => store.getLight(worldgenBlockPosition(position.x, position.y, position.z)),
  subscribeDirty: store.subscribeDirty,
  subscribeDirtyScoped: store.subscribeDirtyScoped,
  reset: store.reset,
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
  Effect.gen(function* () {
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
export const makeInMemoryWorld = <S>(
  options: InMemoryWorldOptions = {},
): Effect.Effect<InMemoryWorld<S>> =>
  Effect.gen(function* () {
    const chunkStore = yield* makeInMemoryChunkStore(options.world)
    return yield* makeWorldWithStore<S>(chunkStore, options)
  })

/** Stand up a deterministic generated world backed by mc-worldgen's real store. */
export const makeGeneratedWorld = <S>(
  options: GeneratedWorldOptions = {},
): Effect.Effect<GeneratedWorld<S>> =>
  Effect.gen(function* () {
    const seed = options.seed ?? 8675309
    const spawnX = options.spawnX ?? 0.5
    const spawnZ = options.spawnZ ?? 0.5
    const worldgenStore = yield* makeChunkStore(options.chunkSource ?? generatedChunkSource(seed))
    const chunkStore = adaptGeneratedChunkStore(worldgenStore)
    const spawnPose: PlayerPose = {
      feetPosition: {
        x: spawnX,
        y: surfaceHeightAt(seed, Math.floor(spawnX), Math.floor(spawnZ)) + 1,
        z: spawnZ,
      },
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
  })

/**
 * Is this cell something a body cannot pass through?
 *
 * BOUND TO A STORE rather than taking one per call, so a host wires it once and
 * `resolvePlayerMovement` gets the predicate shape it wants.
 *
 * AN UNLOADED CHUNK ANSWERS SOLID. `./chunk-store-port.ts` reports
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
    const reading = Effect.runSync(store.getBlock(position))
    switch (reading._tag) {
      case 'Block':
        return !capabilityOfBlockId(reading.block, 'passable')
      case 'ChunkNotLoaded':
        return true
      case 'OutOfWorld':
        // Below bedrock or above the build limit. Solid at the bottom stops a
        // fall; solid at the top is harmless because nothing reaches it.
        return true
      // exhaustiveness arm over BlockReading, a closed three-tag union
      // (chunk-store-port.ts's BlockReading); 'Block', 'ChunkNotLoaded' and
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
    const reading = Effect.runSync(store.getBlock({ x, y, z }))
    return reading._tag === 'Block' && reading.block !== 0
  }
