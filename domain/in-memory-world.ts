/**
 * The four in-memory services, built together, with handles AND a Layer.
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
 * `./player-port.ts` and `./chunk-store-port.ts` are MIRRORS, and this
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
import { ChunkStore, type ChunkStoreApi } from './chunk-store-port'
import { entityManagerTag, type EntityManager, type EntityManagerApi } from './entity-manager-port'
import { InventoryService, type InventoryServiceApi, type Slot } from './inventory-port'
import { PlayerService, type PlayerPose, type PlayerServiceApi } from './player-port'
import { makeInMemoryChunkStore, type WorldContents } from './in-memory-chunk-store'
import { makeInMemoryEntityManager } from './in-memory-entity-manager'
import { makeInMemoryInventory } from './in-memory-inventory'
import { makeInMemoryPlayer } from './in-memory-player'
import type { Dimension } from './nether-travel-port'

/** What a host supplies to stand a world up. */
export type InMemoryWorldOptions = {
  readonly world?: WorldContents
  readonly spawnPose?: PlayerPose
  readonly dimension?: Dimension
  readonly inventory?: ReadonlyArray<Slot>
}

/**
 * The four services, plus the Layer that provides exactly them.
 *
 * `layer` is what `registerModule` is provided from; the four handles are for
 * a host loop that drives them directly. They are the SAME objects — see the
 * header on why that matters more than it looks.
 */
export type InMemoryWorld<S> = {
  readonly layer: Layer.Layer<ChunkStore | EntityManager | InventoryService | PlayerService>
  readonly chunkStore: ChunkStoreApi
  readonly inventory: InventoryServiceApi
  readonly player: PlayerServiceApi
  readonly entities: EntityManagerApi<S>
}

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
    const inventory = yield* makeInMemoryInventory(options.inventory)
    const player = yield* makeInMemoryPlayer(options.spawnPose, options.dimension)
    const entities = yield* makeInMemoryEntityManager<S>()

    // `Layer.succeed` over the instances just built — NOT `Layer.effect` over
    // the constructors, which would build a second set the moment it is
    // provided. See the header.
    const layer = Layer.mergeAll(
      Layer.succeed(ChunkStore, chunkStore),
      Layer.succeed(InventoryService, inventory),
      Layer.succeed(PlayerService, player),
      Layer.succeed(entityManagerTag<S>(), entities),
    )

    return { layer, chunkStore, inventory, player, entities }
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
        return reading.block !== 0
      case 'ChunkNotLoaded':
        return true
      case 'OutOfWorld':
        // Below bedrock or above the build limit. Solid at the bottom stops a
        // fall; solid at the top is harmless because nothing reaches it.
        return true
    }
  }

/** Only loaded, non-air cells can be selected by a player interaction ray. */
export const targetabilityFromStore =
  (store: ChunkStoreApi) =>
  (x: number, y: number, z: number): boolean => {
    const reading = Effect.runSync(store.getBlock({ x, y, z }))
    return reading._tag === 'Block' && reading.block !== 0
  }
