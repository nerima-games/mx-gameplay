/**
 * The break loop, end to end, against the real services.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST IS HERE AND NOT IN A BROWSER
 * ---------------------------------------------------------------------------
 *
 * mc-compose wires a left click to `requestTargetedBlockBreak`, and that wiring cannot
 * be exercised by Playwright: mc-render's `InputService` treats a click as a
 * GAME action only while the pointer is LOCKED — the closed-world predicate
 * that stops a HUD click stealing the pointer — and plan.md §3.10 records that
 * Playwright on SwiftShader cannot do pointer lock at all. mc-render's
 * `apps/preview-render` exists because of the same limit.
 *
 * Everything BELOW the click is reachable here, including aim resolution: the same
 * public door the host calls, the real `gameplay:interactions` stage, the real
 * in-memory `ChunkStore` and `InventoryService`. What is not covered is one
 * mouse event, and that is named rather than faked.
 *
 * IT IS AN INTEGRATION TEST ON PURPOSE. `test/rules.test.ts` covers
 * `breakBlock` as a rule; this covers the INBOX -> STAGE -> STORE -> INVENTORY
 * path, which is the part that was 「callable but unreachable」 until a host
 * filled the inbox. A rule with a green test file and no call site passes every
 * test that only checks the rule.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  drainBlockUseResults,
  gameplayStages,
  makeGameplayFrameState,
  requestBlockBreak,
  requestTargetedBlockBreak,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
} from '../src/stages/registration'
import type {
  GameplayStageCommitServices,
  GameplayTargetingSnapshotContext,
} from '../src/stages/registration-core.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { cellKey, chunkKey, chunkOf, makeInMemoryWorld, type InMemoryWorld } from '../src/domain/in-memory-world.js'
import {
  BlockIdSchema,
  BlockPositionSchema,
  DeltaTimeSecs,
  DimensionIdSchema,
  StackCount,
  itemStack,
} from '@nerima-games/mc-kernel'
import type { BlockPosition, Dimension } from '@nerima-games/mc-kernel'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { DroppedItemOwnerSnapshotSchema } from '../src/domain/entities/dropped-item.js'
import { BlockId, blockIdOf, blockPositionKeyOf } from '@nerima-games/mc-kernel'
import { NO_TOOL } from '../src/domain/interactions/block-loot'
import {
  PlayerStorageSnapshotSchema,
  type ReplicatedOwnerId,
  WorldCommitChunkStoreUnavailable,
  WorldCommitCoordinatorErrorSchema,
  type WorldCommitCoordinatorApi,
  makeWorldCommitCoordinator,
} from '@nerima-games/mc-sim'
import { BreakTransactionResultSchema, breakBlock } from '../src/domain/interactions/break-block.js'
import { makeGameplayCommitServices } from './support/transactional-stage-doubles.js'
import { blockPosition, position as fixturePosition } from './support/coordinate-fixtures.js'
import {
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'

/**
 * DIRT, and the id took two corrections that are worth recording because both
 * looked like defects in the drop path and neither was.
 *
 * The first cut used id 1, which is BEDROCK — it drops nothing, correctly. The
 * second used 2, which is STONE — bare hands cannot harvest it, also correctly,
 * because `satisfiesHarvestTier` gates the drop on a pickaxe.
 *
 * Dirt is the block that drops for a player holding nothing, which is what this
 * file needs: the inventory assertion is about the LOOP reaching the inventory,
 * not about the tier rule, and picking a block that legitimately drops nothing
 * would have made the loop untestable while looking like a bug.
 */
const DIRT_ID = BlockId(3)
const OVERWORLD = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const LEVER_ID = Option.getOrThrow(blockIdOf('lever'))
const DOOR_ID = Option.getOrThrow(blockIdOf('door'))
const AT: BlockPosition = blockPosition(3, 64, 7)
const ABOVE_AT: BlockPosition = blockPosition(3, 65, 7)
const BESIDE_AT: BlockPosition = blockPosition(4, 64, 7)
const IN_SIGHT: BlockPosition = blockPosition(0, 1, 0)

const lookingAtBlockWorld = (loaded: boolean, block: BlockId = DIRT_ID) =>
  makeInMemoryWorld<MobBehaviour>({
    spawnPose: {
      feetPosition: fixturePosition(0.5, 0, 2.5),
      yawRadians: 0,
      pitchRadians: 0,
    },
    world: {
      blocks: new Map([[cellKey(IN_SIGHT), block]]),
      loaded: loaded ? [chunkKey(chunkOf(IN_SIGHT))] : [],
    },
  })

/** A world with one block, in a loaded chunk. */
const oneBlockWorld = (block: BlockId = DIRT_ID) =>
  makeInMemoryWorld<MobBehaviour>({
    world: {
      blocks: new Map([[cellKey(AT), block]]),
      loaded: [chunkKey(chunkOf(AT))],
    },
  })

const twoBlockWorld = (block: BlockId) =>
  makeInMemoryWorld<MobBehaviour>({
    world: {
      blocks: new Map([
        [cellKey(AT), block],
        [cellKey(BESIDE_AT), block],
      ]),
      loaded: [chunkKey(chunkOf(AT))],
    },
  })

const doorWorld = () =>
  makeInMemoryWorld<MobBehaviour>({
    world: {
      blocks: new Map([
        [cellKey(AT), DOOR_ID],
        [cellKey(ABOVE_AT), DOOR_ID],
      ]),
      loaded: [chunkKey(chunkOf(AT))],
    },
  })

const runInteractions = (
  stages: ReadonlyArray<{ readonly id: string; readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, never> }>,
) => {
  const stage = stages.find((candidate) => candidate.id === GAMEPLAY_STAGE_IDS.interactions)
  if (stage === undefined) {
    throw new Error('the interactions stage is not registered')
  }
  return stage.run(DeltaTimeSecs(0.016))
}

const const gameplayStagesWithOwners = (
  state: Parameters<typeof gameplayStages>[0],
  world: InMemoryWorld<MobBehaviour>,
  store = world.chunkStore,
) =>
  Effect.gen(function* () {
    const playerPose = yield* world.player.pose
    const dimension = yield* world.player.dimension
    const services = yield* makeGameplayCommitServices(store, world.inventory, {
      playerPose,
      dimension,
    })
    const commitRequests: Array<Parameters<WorldCommitCoordinatorApi['commit']>[0]> = []
    const coordinator: WorldCommitCoordinatorApi = {
      ...services.coordinator,
      commit: (request) => {
        commitRequests.push(request)
        return services.coordinator.commit(request)
      },
    }
    const commit = { ...services, coordinator }
    return {
      stages: gameplayStages(
        state,
        store,
        world.entities,
        world.inventory,
        world.player,
        world.time,
        undefined,
        undefined,
        {},
        commit,
      ),
      commit,
      commitRequests,
    }
  })

const targetingContextFor = (
  commit: GameplayStageCommitServices,
): GameplayTargetingSnapshotContext => {
  const entitiesOwnerId = commit.entitiesOwnerId
  if (entitiesOwnerId === undefined) throw new Error('the entity owner must be registered for targeting')
  return {
    coordinator: commit.coordinator,
    playerOwnerId: commit.playerOwnerId,
    entitiesOwnerId,
  }
}

const storedItemCount = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: string,
): number => storage.inventory.slots.reduce(
  (count, slot) => count + (slot?.item === item ? slot.count : 0),
  0,
)

describe('the break loop', () => {
  it.effect('keeps the two-argument rule call compatible with BreakOutcome', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()

      expect(yield* breakBlock(world.chunkStore, AT)).toStrictEqual({
        _tag: 'Broken',
        yielded: DIRT_ID,
        chunk: chunkOf(AT),
      })
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('keeps unreadable legacy break results distinct from empty air', () =>
    Effect.gen(function* () {
      const loadedAir = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: [chunkKey(chunkOf(AT))] },
      })
      const unloaded = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: [] },
      })

      expect(yield* breakBlock(loadedAir.chunkStore, AT)).toStrictEqual({ _tag: 'NothingThere' })
      expect(yield* breakBlock(unloaded.chunkStore, AT)).toStrictEqual({ _tag: 'ChunkNotLoaded' })
      expect(yield* breakBlock(loadedAir.chunkStore, blockPosition(AT.x, -1, AT.z))).toStrictEqual({
        _tag: 'OutOfWorld',
      })
    }),
  )

  it.effect('transactional breaks reject invalid captured tool locations', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      const context = {
        coordinator: commit.coordinator,
        dimension: OVERWORLD,
        ownerId: commit.playerStorageOwnerId,
        toolLocation: { _tag: 'Inventory' as const, slotIndex: -1 },
      }

      const invalidToolLocation = yield* breakBlock(world.chunkStore, AT, {
        ...context,
      })

      expect(invalidToolLocation).toStrictEqual({
        _tag: 'TransactionFailure',
        failure: { _tag: 'ToolDamageRejected', reason: 'InvalidLocation' },
      })
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: DIRT_ID })
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('accepts empty and non-damageable slots and breaks a tool on its last use', () =>
    Effect.gen(function* () {
      const position = Schema.decodeUnknownSync(BlockPositionSchema)({
        x: AT.x,
        y: AT.y,
        z: AT.z,
      })
      const dirt = Schema.decodeUnknownSync(BlockIdSchema)(DIRT_ID)
      // Dirt drops itself when broken: https://minecraft.wiki/w/Dirt
      // Iron pickaxes lose one durability point per block: https://minecraft.wiki/w/Iron_Pickaxe
      const emptyWorld = yield* makeInMemoryWorld<MobBehaviour>({
        world: {
          blocks: new Map([[cellKey(position), dirt]]),
          loaded: [chunkKey(chunkOf(position))],
        },
      })
      const emptyCommit = yield* makeGameplayCommitServices(emptyWorld.chunkStore, emptyWorld.inventory)
      const emptyBefore = yield* emptyCommit.coordinator.snapshot(
        emptyCommit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const emptyResult = Schema.decodeUnknownSync(BreakTransactionResultSchema)(
        yield* breakBlock(emptyWorld.chunkStore, position, {
          coordinator: emptyCommit.coordinator,
          dimension: OVERWORLD,
          ownerId: emptyCommit.playerStorageOwnerId,
          toolLocation: { _tag: 'Inventory', slotIndex: 0 },
        }),
      )
      const emptyAfter = yield* emptyCommit.coordinator.snapshot(
        emptyCommit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(emptyResult._tag).toBe('CommittedCascade')
      expect(emptyAfter.state).toEqual(emptyBefore.state)

      const dirtStack = Result.getOrThrow(itemStack('dirt', StackCount(1)))
      const nonDamageableWorld = yield* makeInMemoryWorld<MobBehaviour>({
        inventory: [dirtStack],
        world: {
          blocks: new Map([[cellKey(position), dirt]]),
          loaded: [chunkKey(chunkOf(position))],
        },
      })
      const nonDamageableCommit = yield* makeGameplayCommitServices(
        nonDamageableWorld.chunkStore,
        nonDamageableWorld.inventory,
      )
      const nonDamageableBefore = yield* nonDamageableCommit.coordinator.snapshot(
        nonDamageableCommit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const nonDamageableResult = Schema.decodeUnknownSync(BreakTransactionResultSchema)(
        yield* breakBlock(nonDamageableWorld.chunkStore, position, {
          coordinator: nonDamageableCommit.coordinator,
          dimension: OVERWORLD,
          ownerId: nonDamageableCommit.playerStorageOwnerId,
          toolLocation: { _tag: 'Inventory', slotIndex: 0 },
        }),
      )
      const nonDamageableAfter = yield* nonDamageableCommit.coordinator.snapshot(
        nonDamageableCommit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(nonDamageableResult._tag).toBe('CommittedCascade')
      expect(nonDamageableAfter.state).toEqual(nonDamageableBefore.state)

      const ironPickaxe = Result.getOrThrow(itemStack('iron_pickaxe', StackCount(1)))
      const lastUseWorld = yield* makeInMemoryWorld<MobBehaviour>({
        inventory: [ironPickaxe],
        world: {
          blocks: new Map([[cellKey(position), dirt]]),
          loaded: [chunkKey(chunkOf(position))],
        },
      })
      const initialStorage = yield* lastUseWorld.inventory.storageSnapshot
      const durability = initialStorage.inventoryDurability[0]
      if (durability === undefined || durability === null) throw new Error('the iron pickaxe has no durability')
      const lastUseStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)({
        ...initialStorage,
        inventoryDurability: initialStorage.inventoryDurability.map((current, index) =>
          index === 0 ? { current: 1, max: durability.max } : current,
        ),
      })
      yield* lastUseWorld.inventory.restoreStorage(lastUseStorage)
      const lastUseCommit = yield* makeGameplayCommitServices(lastUseWorld.chunkStore, lastUseWorld.inventory)
      const lastUseResult = Schema.decodeUnknownSync(BreakTransactionResultSchema)(
        yield* breakBlock(lastUseWorld.chunkStore, position, {
          coordinator: lastUseCommit.coordinator,
          dimension: OVERWORLD,
          ownerId: lastUseCommit.playerStorageOwnerId,
          toolLocation: { _tag: 'Inventory', slotIndex: 0 },
        }),
      )
      const lastUseOwner = yield* lastUseCommit.coordinator.snapshot(
        lastUseCommit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      expect(lastUseResult._tag).toBe('CommittedCascade')
      expect(lastUseOwner.state.inventory.slots[0]).toBeUndefined()
      expect(lastUseOwner.state.inventoryDurability[0]).toBeNull()
      expect(yield* lastUseWorld.inventory.storageSnapshot).toEqual(lastUseStorage)
    }),
  )

  it.effect('transactional breaks reject incomplete observations and missing contexts', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      const coordinator: WorldCommitCoordinatorApi = {
        ...commit.coordinator,
        observe: <Codec extends Schema.Codec<any, any>>(
          ownerId: ReplicatedOwnerId,
          schema: Codec,
          reads: ReadonlyArray<Readonly<{ dimension: Dimension; position: BlockPosition }>>,
        ) => Effect.map(
          commit.coordinator.observe(ownerId, schema, reads),
          (snapshot) => 'blocks' in snapshot ? { ...snapshot, blocks: [] } : snapshot,
        ),
      }
      const context = {
        coordinator,
        dimension: OVERWORLD,
        ownerId: commit.playerStorageOwnerId,
        toolLocation: undefined,
      }

      expect(yield* breakBlock(world.chunkStore, AT, context)).toStrictEqual({
        _tag: 'TransactionFailure',
        failure: { _tag: 'ObservationIncomplete', position: AT },
      })
      expect(yield* breakBlock(world.chunkStore, AT, undefined)).toStrictEqual({
        _tag: 'TransactionFailure',
        failure: { _tag: 'MissingTransactionContext' },
      })
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: DIRT_ID })
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('transactional breaks refuse an incomplete later-wave observation', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      let observations = 0
      const coordinator: WorldCommitCoordinatorApi = {
        ...commit.coordinator,
        observe: <Codec extends Schema.Codec<any, any>>(
          ownerId: ReplicatedOwnerId,
          schema: Codec,
          reads: ReadonlyArray<Readonly<{ dimension: Dimension; position: BlockPosition }>>,
        ) => Effect.map(
          commit.coordinator.observe(ownerId, schema, reads),
          (snapshot) => {
            observations += 1
            if (observations === 1 || !('blocks' in snapshot)) return snapshot
            return { ...snapshot, blocks: [] }
          },
        ),
      }

      expect(yield* breakBlock(world.chunkStore, AT, {
        coordinator,
        dimension: OVERWORLD,
        ownerId: commit.playerStorageOwnerId,
        toolLocation: undefined,
      })).toStrictEqual({
        _tag: 'TransactionFailure',
        failure: { _tag: 'ObservationIncomplete', position: ABOVE_AT },
      })
      expect(observations).toBe(2)
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: DIRT_ID })
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('transactional breaks report an initial coordinator observation failure', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      const observationFailure = new WorldCommitChunkStoreUnavailable({ dimension: 'overworld' })
      let observations = 0
      const coordinator: WorldCommitCoordinatorApi = {
        ...commit.coordinator,
        observe: () => {
          observations += 1
          return Effect.fail(observationFailure)
        },
      }
      const context = {
        coordinator,
        dimension: OVERWORLD,
        ownerId: commit.playerStorageOwnerId,
        toolLocation: undefined,
      }

      expect(yield* breakBlock(world.chunkStore, AT, context)).toMatchObject({
        _tag: 'TransactionFailure',
        failure: {
          _tag: 'ObservationFailed',
          error: { _tag: 'WorldCommitChunkStoreUnavailable', dimension: 'overworld' },
        },
      })
      expect(observations).toBe(1)
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: DIRT_ID })
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('transactional breaks report a later coordinator observation failure', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      const observationFailure = new WorldCommitChunkStoreUnavailable({ dimension: 'overworld' })
      let observations = 0
      const coordinator: WorldCommitCoordinatorApi = {
        ...commit.coordinator,
        observe: (...args) => {
          observations += 1
          return observations === 2
            ? Effect.fail(observationFailure)
            : commit.coordinator.observe(...args)
        },
      }

      expect(yield* breakBlock(world.chunkStore, AT, {
        coordinator,
        dimension: OVERWORLD,
        ownerId: commit.playerStorageOwnerId,
        toolLocation: undefined,
      })).toMatchObject({
        _tag: 'TransactionFailure',
        failure: {
          _tag: 'ObservationFailed',
          error: { _tag: 'WorldCommitChunkStoreUnavailable', dimension: 'overworld' },
        },
      })
      expect(observations).toBe(2)
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: DIRT_ID })
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('a later chunk unload aborts a transactional support cascade', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      let observations = 0
      const coordinator: WorldCommitCoordinatorApi = {
        ...commit.coordinator,
        observe: <Codec extends Schema.Codec<any, any>>(
          ownerId: ReplicatedOwnerId,
          schema: Codec,
          reads: ReadonlyArray<Readonly<{ dimension: Dimension; position: BlockPosition }>>,
        ) => Effect.map(commit.coordinator.observe(ownerId, schema, reads), (snapshot) => {
          observations += 1
          if (observations === 1 || !('blocks' in snapshot)) {
            return snapshot
          }
          return {
            ...snapshot,
            blocks: snapshot.blocks.map((block) => ({
              ...block,
              reading: { _tag: 'ChunkNotLoaded' as const },
            })),
          }
        }),
      }

      expect(yield* breakBlock(world.chunkStore, AT, {
        coordinator,
        dimension: OVERWORLD,
        ownerId: commit.playerStorageOwnerId,
        toolLocation: undefined,
      })).toStrictEqual({
        _tag: 'TransactionFailure',
        failure: { _tag: 'BlockUnavailable', reason: 'chunk-not-loaded' },
      })
      expect(observations).toBe(2)
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: DIRT_ID })
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('transactional breaks preserve air, unloaded, and out-of-world refusals', () =>
    Effect.gen(function* () {
      const airWorld = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: [chunkKey(chunkOf(AT))] },
      })
      const airCommit = yield* makeGameplayCommitServices(airWorld.chunkStore, airWorld.inventory)
      const context = {
        coordinator: airCommit.coordinator,
        dimension: OVERWORLD,
        ownerId: airCommit.playerStorageOwnerId,
        toolLocation: undefined,
      }
      const unloadedWorld = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: [] },
      })
      const unloadedCommit = yield* makeGameplayCommitServices(unloadedWorld.chunkStore, unloadedWorld.inventory)
      const unloadedContext = {
        coordinator: unloadedCommit.coordinator,
        dimension: OVERWORLD,
        ownerId: unloadedCommit.playerStorageOwnerId,
        toolLocation: undefined,
      }

      expect((yield* breakBlock(airWorld.chunkStore, AT, context))).toStrictEqual({
        _tag: 'TransactionFailure',
        failure: { _tag: 'BlockUnavailable', reason: 'air' },
      })
      expect((yield* breakBlock(unloadedWorld.chunkStore, AT, unloadedContext))).toStrictEqual({
        _tag: 'TransactionFailure',
        failure: { _tag: 'BlockUnavailable', reason: 'chunk-not-loaded' },
      })
      expect((yield* breakBlock(
        unloadedWorld.chunkStore,
        blockPosition(AT.x, -1, AT.z),
        unloadedContext,
      ))).toStrictEqual({
        _tag: 'TransactionFailure',
        failure: { _tag: 'BlockUnavailable', reason: 'out-of-world' },
      })
      expect(yield* airCommit.coordinator.revision).toBe(0)
      expect(yield* unloadedCommit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('uses a targeted lever instead of placing the held item', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true, LEVER_ID)
      const state = yield* makeGameplayFrameState
      const { stages } = yield* gameplayStagesWithOwners(state, world)

      yield* requestTargetedBlockUse(
        state,
        world.chunkStore,
        world.player,
        'lever-use-1',
        'redstone_dust',
      )

      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([
        { requestId: 'lever-use-1', positionKey: '0,1,0' },
      ])
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([])

      yield* runInteractions(stages as never)
      expect(yield* drainBlockUseResults(state)).toStrictEqual([
        {
          requestId: 'lever-use-1',
          success: true,
          outcome: { _tag: 'ToggleLever', position: IN_SIGHT },
        },
      ])
      expect(yield* world.chunkStore.getBlock(IN_SIGHT)).toStrictEqual({
        _tag: 'Block',
        block: LEVER_ID,
      })
    }),
  )

  it.effect('falls back to adjacent placement when the target is not a lever', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true)
      const state = yield* makeGameplayFrameState

      yield* requestTargetedBlockUse(
        state,
        world.chunkStore,
        world.player,
        'ordinary-use',
        'redstone_dust',
      )

      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([
        { positionKey: '0,1,1', heldItem: 'redstone_dust' },
      ])
    }),
  )

  it.effect('correlates a failed lever use when the target changes before the stage runs', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true, LEVER_ID)
      const state = yield* makeGameplayFrameState
      const { stages } = yield* gameplayStagesWithOwners(state, world)

      yield* requestTargetedBlockUse(
        state,
        world.chunkStore,
        world.player,
        'stale-lever-use',
        'sand',
      )
      yield* world.chunkStore.setBlock(IN_SIGHT, DIRT_ID)
      yield* runInteractions(stages as never)

      expect(yield* drainBlockUseResults(state)).toStrictEqual([
        {
          requestId: 'stale-lever-use',
          success: false,
          outcome: { _tag: 'NotLever', position: IN_SIGHT, existing: DIRT_ID },
        },
      ])
      expect(yield* drainBlockUseResults(state)).toStrictEqual([])
    }),
  )

  it.effect('targets the adjacent cell for placement and preserves the held item', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true)
      const state = yield* makeGameplayFrameState

      const target = yield* requestTargetedBlockPlacement(
        state,
        world.chunkStore,
        world.player,
        'sand',
      )

      expect(Option.getOrUndefined(target)?.position).toStrictEqual(IN_SIGHT)
      expect(Option.getOrUndefined(target)?.adjacentPosition).toStrictEqual({ x: 0, y: 1, z: 1 })
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([
        { positionKey: '0,1,1', heldItem: 'sand' },
      ])
    }),
  )

  it.effect('targets the first block under the crosshair and breaks it through the inbox', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true)
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      const target = yield* requestTargetedBlockBreak(
        state,
        world.chunkStore,
        targetingContextFor(commit),
      )
      expect(Option.getOrUndefined(target)?.position).toStrictEqual(IN_SIGHT)

      yield* runInteractions(stages as never)
      expect(yield* world.chunkStore.getBlock(IN_SIGHT)).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('does not target stored block data from an unloaded chunk', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(false)
      const state = yield* makeGameplayFrameState
      const { commit } = yield* gameplayStagesWithOwners(state, world)

      const target = yield* requestTargetedBlockBreak(
        state,
        world.chunkStore,
        targetingContextFor(commit),
      )

      expect(Option.isNone(target)).toBe(true)
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
    }),
  )

  it.effect('commits the captured tool wear and both door halves through one coordinator write', () =>
    Effect.gen(function* () {
      const ironPickaxe = Result.getOrThrow(itemStack('iron_pickaxe', StackCount(1)))
      const diamondPickaxe = Result.getOrThrow(itemStack('diamond_pickaxe', StackCount(1)))
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        inventory: [ironPickaxe, diamondPickaxe],
        world: {
          blocks: new Map([
            [cellKey(AT), DOOR_ID],
            [cellKey(ABOVE_AT), DOOR_ID],
          ]),
          loaded: [chunkKey(chunkOf(AT))],
        },
      })
      let directWrites = 0
      const store = {
        ...world.chunkStore,
        setBlock: (position: BlockPosition, block: BlockId) => {
          directWrites += 1
          return world.chunkStore.setBlock(position, block)
        },
      }
      const commit = yield* makeGameplayCommitServices(store, world.inventory)
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(
        state,
        store,
        world.entities,
        world.inventory,
        world.player,
        world.time,
        undefined,
        undefined,
        {},
        commit,
      )
      const initial = yield* world.inventory.storageSnapshot
      const initialIron = initial.inventoryDurability[0]
      const initialDiamond = initial.inventoryDurability[1]
      if (initialIron === undefined || initialIron === null) throw new Error('the iron pickaxe has no durability')
      if (initialDiamond === undefined || initialDiamond === null) throw new Error('the diamond pickaxe has no durability')
      const dimensionRevision = yield* commit.coordinator.dimensionRevision('overworld')

      yield* requestBlockBreak(state, AT, NO_TOOL, {
        dimension: 'overworld',
        toolLocation: { _tag: 'Inventory', slotIndex: 1 },
      })
      yield* runInteractions(stages as never)

      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: 0 })
      expect(yield* world.chunkStore.getBlock(ABOVE_AT)).toStrictEqual({ _tag: 'Block', block: 0 })
      expect(yield* commit.coordinator.dimensionRevision('overworld')).toBe(dimensionRevision + 1)
      expect(directWrites).toBe(0)

      const local = yield* world.inventory.storageSnapshot
      const owner = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const ironAfter = owner.state.inventoryDurability[0]
      const diamondAfter = owner.state.inventoryDurability[1]
      if (ironAfter === undefined || ironAfter === null) throw new Error('the iron pickaxe disappeared')
      if (diamondAfter === undefined || diamondAfter === null) throw new Error('the diamond pickaxe disappeared')
      expect(ironAfter).toEqual(initialIron)
      expect(diamondAfter.current).toBe(initialDiamond.current - 1)
      expect(local).toEqual(initial)
    }),
  )

  it.effect('keeps loot in the coordinator owner across consecutive transactional breaks', () =>
    Effect.gen(function* () {
      const ironPickaxe = Result.getOrThrow(itemStack('iron_pickaxe', StackCount(1)))
      const diamondPickaxe = Result.getOrThrow(itemStack('diamond_pickaxe', StackCount(1)))
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        inventory: [ironPickaxe, diamondPickaxe],
        world: {
          blocks: new Map([
            [cellKey(AT), DIRT_ID],
            [cellKey(BESIDE_AT), DIRT_ID],
          ]),
          loaded: [chunkKey(chunkOf(AT))],
        },
      })
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(
        state,
        world.chunkStore,
        world.entities,
        world.inventory,
        world.player,
        world.time,
        undefined,
        undefined,
        {},
        commit,
      )
      const initial = yield* world.inventory.storageSnapshot
      const initialDiamond = initial.inventoryDurability[1]
      if (initialDiamond === undefined || initialDiamond === null) throw new Error('the diamond pickaxe has no durability')

      yield* requestBlockBreak(state, AT, NO_TOOL, {
        dimension: 'overworld',
        toolLocation: { _tag: 'Inventory', slotIndex: 1 },
      })
      yield* requestBlockBreak(state, BESIDE_AT, NO_TOOL, {
        dimension: 'overworld',
        toolLocation: { _tag: 'Inventory', slotIndex: 1 },
      })
      yield* runInteractions(stages as never)

      expect(yield* commit.coordinator.dimensionRevision('overworld')).toBe(2)
      const local = yield* world.inventory.storageSnapshot
      const owner = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const diamondAfter = owner.state.inventoryDurability[1]
      if (diamondAfter === undefined || diamondAfter === null) throw new Error('the diamond pickaxe disappeared')
      expect(diamondAfter.current).toBe(initialDiamond.current - 2)
      const dirtCount = owner.state.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'dirt' ? slot.count : 0),
        0,
      )
      expect(dirtCount).toBe(2)
      expect(local).toEqual(initial)
    }),
  )

  it.effect('a requested break removes the block from the store', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()
      const state = yield* makeGameplayFrameState
      const { stages } = yield* gameplayStagesWithOwners(state, world)

      expect((yield* world.chunkStore.getBlock(AT))._tag).toBe('Block')

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      const after = yield* world.chunkStore.getBlock(AT)
      expect(after).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('ignores a break request whose queue slot no longer holds its position', () =>
    Effect.gen(function* () {
      // The `publicQueueIndex` snapshot lets `requestBlockBreak`'s two Refs
      // (`state.pendingBreaks` and the queue's own `requests`) drift apart if
      // something else writes `pendingBreaks` directly (a restore, a test, a
      // future caller outside the queue's mutex) between the request and the
      // drain. Every other break test in this file goes through
      // `requestBlockBreak` alone, so `drainedBreaks[index] ===
      // request.positionKey` had only ever been true.
      const world = yield* oneBlockWorld()
      const state = yield* makeGameplayFrameState
      const { stages } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      // Simulate the drift: the public inbox now names a different cell at
      // slot 0 than the one the request snapshot recorded.
      yield* Ref.set(state.pendingBreaks, [blockPositionKeyOf(blockPosition(99, 64, 99))])

      yield* runInteractions(stages as never)

      // The stale request was dropped rather than breaking the wrong (or any)
      // cell: the original block survives untouched.
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: DIRT_ID })
    }),
  )

  it.effect('removes the upper half when a door lower half is broken', () =>
    Effect.gen(function* () {
      const world = yield* doorWorld()
      const state = yield* makeGameplayFrameState
      const { stages } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: 0 })
      expect(yield* world.chunkStore.getBlock(ABOVE_AT)).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('does not record a disturbance when the door-above write reports no change', () =>
    Effect.gen(function* () {
      // The test above always sees the upper-half write succeed as `Written`.
      // `doorUpperBreakCell` reads the upper cell moments earlier in the same
      // fiber, so nothing in THIS repository can make its answer disagree
      // with the write that follows — but a real store is not required to
      // agree with itself between two calls (another system, or the world
      // generator's own async boundary, could have already cleared that
      // cell). Intercepting the write is the same technique
      // `test/stage-registration.test.ts`'s "a blocked horizontal PlaceFluid
      // write..." test uses for the same reason.
      const world = yield* doorWorld()
      const state = yield* makeGameplayFrameState
      const interceptedStore = {
        ...world.chunkStore,
        setBlock: (position: BlockPosition, block: BlockId) =>
          cellKey(position) === cellKey(ABOVE_AT) && block === 0
            ? Effect.succeed({ _tag: 'Unchanged' as const, previous: BlockId(0) })
            : world.chunkStore.setBlock(position, block),
      }
      const { stages } = yield* gameplayStagesWithOwners(state, world, interceptedStore)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      // The lower half still broke; the upper-half write was intercepted as
      // `Unchanged`, so no disturbance was queued for it and nothing crashed.
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('keeps the wooden tool context captured when the break was requested', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(Option.getOrThrow(blockIdOf('stone')))
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT, { heldTier: 'wooden' })
      yield* Ref.set(state.heldTool, NO_TOOL)
      yield* runInteractions(stages as never)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(storedItemCount(storage.state, 'cobblestone')).toBe(1)
    }),
  )

  it.effect('copies the tool context when the break was requested', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(Option.getOrThrow(blockIdOf('stone')))
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)
      const lootContext: { heldTier: 'wooden' | 'none' } = { heldTier: 'wooden' }

      yield* requestBlockBreak(state, AT, lootContext)
      lootContext.heldTier = 'none'
      yield* runInteractions(stages as never)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(storedItemCount(storage.state, 'cobblestone')).toBe(1)
    }),
  )

  it.effect('keeps the bare-hand context captured when the break was requested', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(Option.getOrThrow(blockIdOf('stone')))
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT, NO_TOOL)
      yield* Ref.set(state.heldTool, { heldTier: 'wooden' })
      yield* runInteractions(stages as never)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(storedItemCount(storage.state, 'cobblestone')).toBe(0)
    }),
  )

  it.effect('does not let a legacy break steal a later wooden snapshot at the same position', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(Option.getOrThrow(blockIdOf('stone')))
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* Ref.update(state.pendingBreaks, (pending) => [...pending, blockPositionKeyOf(AT)])
      yield* requestBlockBreak(state, AT, { heldTier: 'wooden' })
      yield* Ref.set(state.heldTool, NO_TOOL)
      yield* runInteractions(stages as never)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(storedItemCount(storage.state, 'cobblestone')).toBe(0)
    }),
  )

  it.effect('does not let a legacy break lose its wooden fallback to a later bare-hand snapshot', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(Option.getOrThrow(blockIdOf('stone')))
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* Ref.update(state.pendingBreaks, (pending) => [...pending, blockPositionKeyOf(AT)])
      yield* requestBlockBreak(state, AT, NO_TOOL)
      yield* Ref.set(state.heldTool, { heldTier: 'wooden' })
      yield* runInteractions(stages as never)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(storedItemCount(storage.state, 'cobblestone')).toBe(1)
    }),
  )

  it.effect('keeps request and snapshot paired across concurrent helper fibers', () =>
    Effect.gen(function* () {
      const world = yield* twoBlockWorld(Option.getOrThrow(blockIdOf('stone')))
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* Effect.all(
        [
          requestBlockBreak(state, AT, { heldTier: 'wooden' }),
          requestBlockBreak(state, BESIDE_AT, NO_TOOL),
        ],
        { concurrency: 'unbounded' },
      )
      yield* Ref.set(state.heldTool, NO_TOOL)
      yield* runInteractions(stages as never)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(storedItemCount(storage.state, 'cobblestone')).toBe(1)
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
    }),
  )

  it.effect('keeps the legacy two-argument request as a raw position key', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      yield* requestBlockBreak(state, AT)

      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual(['3,64,7'])
    }),
  )

  it.effect('and the mined block lands in the inventory', () =>
    Effect.gen(function* () {
      // THE HALF A STORE ASSERTION MISSES. A break that removed the block and
      // dropped nothing looks identical in the world and costs the player the
      // item — which is the whole reason `breakBlock` returns what it yielded
      // rather than a boolean.
      const world = yield* oneBlockWorld()
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      const inventory = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const carried = inventory.state.inventory.slots.filter((slot) => slot !== undefined)
      expect(carried.length).toBeGreaterThan(0)
    }),
  )

  it.effect('spawns a mined drop when every inventory slot is full', () =>
    Effect.gen(function* () {
      const fullInventory = Array.from(
        { length: 36 },
        () => Result.getOrThrow(itemStack('stone', StackCount(64))),
      )
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        inventory: fullInventory,
        world: {
          blocks: new Map([[cellKey(AT), DIRT_ID]]),
          loaded: [chunkKey(chunkOf(AT))],
        },
      })
      const state = yield* makeGameplayFrameState
      const { stages, commit, commitRequests } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(storedItemCount(storage.state, 'dirt')).toBe(0)
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: 0 })
      const droppedItems = yield* commit.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema)
      expect(droppedItems.state.items).toHaveLength(1)
      expect(droppedItems.state.items[0]?.behaviour._tag).toBe('DroppedItem')
      expect(commitRequests).toHaveLength(1)
      expect(commitRequests[0]?.blockWrite).toBeDefined()
      expect(commitRequests[0]?.changes.map(({ ownerId }) => ownerId)).toEqual(
        expect.arrayContaining([
          commit.playerStorageOwnerId,
          GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        ]),
      )
    }),
  )

  it('keeps mined loot as a world drop when the owner snapshot changes before deposit', async () => {
    await FastCheck.assert(
      FastCheck.asyncProperty(FastCheck.integer({ min: 0, max: 35 }), async (changedSlot) => {
        const fullInventory = Array.from(
          { length: 36 },
          () => Result.getOrThrow(itemStack('stone', StackCount(64))),
        )
        const world = await Effect.runPromise(makeInMemoryWorld<MobBehaviour>({
          inventory: fullInventory,
          world: {
            blocks: new Map([[cellKey(AT), DIRT_ID]]),
            loaded: [chunkKey(chunkOf(AT))],
          },
        }))
        const commit = await Effect.runPromise(
          makeGameplayCommitServices(world.chunkStore, world.inventory),
        )
        const initialStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(
          await Effect.runPromise(world.inventory.storageSnapshot),
        )
        const registeredCoordinator = commit.coordinator
        const stageRequests: Array<Parameters<WorldCommitCoordinatorApi['commit']>[0]> = []
        const stageCommitResults: Array<'Rejected' | 'Committed'> = []
        let injectedOwnerChange = false
        const coordinator: WorldCommitCoordinatorApi = {
          ...registeredCoordinator,
          commit: (request) =>
            Effect.gen(function* () {
              stageRequests.push(request)
              if (!injectedOwnerChange) {
                injectedOwnerChange = true
                const beforeChange = yield* registeredCoordinator.snapshot(
                  commit.playerStorageOwnerId,
                  PlayerStorageSnapshotSchema,
                )
                const replacement = Result.getOrThrow(itemStack('cobblestone', StackCount(64)))
                const changedStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)({
                  ...beforeChange.state,
                  inventory: {
                    slots: beforeChange.state.inventory.slots.map((slot, index) =>
                      index === changedSlot ? replacement : slot,
                    ),
                  },
                })
                const ownerChange = yield* Effect.result(registeredCoordinator.commit({
                  expectedRevision: beforeChange.revision,
                  expectedDimensions: [],
                  changes: [{
                    ownerId: commit.playerStorageOwnerId,
                    state: changedStorage,
                  }],
                }))
                if (Result.isFailure(ownerChange)) {
                  throw new Error('the concurrent player-storage update was rejected')
                }
              }

              const attempt = yield* Effect.result(registeredCoordinator.commit(request))
              if (Result.isFailure(attempt)) {
                stageCommitResults.push('Rejected')
                return yield* Effect.fail(attempt.failure)
              }
              stageCommitResults.push('Committed')
              return attempt.success
            }),
        }
        const state = await Effect.runPromise(makeGameplayFrameState)
        const stages = gameplayStages(
          state,
          world.chunkStore,
          world.entities,
          world.inventory,
          world.player,
          world.time,
          undefined,
          undefined,
          {},
          { ...commit, coordinator },
        )
        const initialRollSeed = await Effect.runPromise(Ref.get(state.rollSeed))

        await Effect.runPromise(requestBlockBreak(state, AT, NO_TOOL, {
          dimension: OVERWORLD,
          toolLocation: undefined,
        }))
        await Effect.runPromise(runInteractions(stages as never))

        expect(injectedOwnerChange).toBe(true)
        expect(stageRequests).toHaveLength(1)
        expect(stageCommitResults).toStrictEqual(['Rejected'])
        expect(stageRequests[0]?.expectedRevision).toBe(0)
        expect(stageRequests[0]?.blockWrite).toBeDefined()
        expect(stageRequests[0]?.changes.map(({ ownerId }) => ownerId)).toEqual(
          expect.arrayContaining([
            commit.playerStorageOwnerId,
            GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
          ]),
        )

        const miningFailure = (await Effect.runPromise(Ref.get(state.operationFailures))).find(
          (failure) => failure.operation === 'WorldCommit' && failure.subject === 'Mining',
        )
        if (miningFailure === undefined) throw new Error('the conflicting mining commit was not recorded')
        expect(Schema.decodeUnknownSync(WorldCommitCoordinatorErrorSchema)(miningFailure.error)).toMatchObject({
          _tag: 'WorldRevisionConflict',
          expected: 0,
          actual: 1,
        })
        expect(await Effect.runPromise(Ref.get(state.pendingBreaks))).toStrictEqual([blockPositionKeyOf(AT)])
        expect(await Effect.runPromise(Ref.get(state.rollSeed))).toBe(initialRollSeed)
        expect(await Effect.runPromise(world.chunkStore.getBlock(AT))).toStrictEqual({
          _tag: 'Block',
          block: DIRT_ID,
        })

        const storageAfterRejection = await Effect.runPromise(registeredCoordinator.snapshot(
          commit.playerStorageOwnerId,
          PlayerStorageSnapshotSchema,
        ))
        const decodedStorageAfterRejection = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(
          storageAfterRejection.state,
        )
        expect(storageAfterRejection.revision).toBe(1)
        expect(decodedStorageAfterRejection.inventory.slots[changedSlot]).toMatchObject({
          item: 'cobblestone',
          count: 64,
        })
        const droppedAfterRejection = await Effect.runPromise(registeredCoordinator.snapshot(
          GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
          DroppedItemOwnerSnapshotSchema,
        ))
        expect(droppedAfterRejection.revision).toBe(1)
        expect(Schema.decodeUnknownSync(DroppedItemOwnerSnapshotSchema)(
          droppedAfterRejection.state,
        ).items).toStrictEqual([])
        expect(await Effect.runPromise(registeredCoordinator.revision)).toBe(1)
        expect(await Effect.runPromise(registeredCoordinator.dimensionRevision(OVERWORLD))).toBe(0)

        await Effect.runPromise(runInteractions(stages as never))

        expect(await Effect.runPromise(Ref.get(state.pendingBreaks))).toStrictEqual([])
        expect(stageRequests).toHaveLength(2)
        expect(stageCommitResults).toStrictEqual(['Rejected', 'Committed'])
        expect(stageRequests[1]?.expectedRevision).toBe(1)
        expect(stageRequests[1]?.blockWrite).toBeDefined()
        expect(stageRequests[1]?.changes.map(({ ownerId }) => ownerId)).toEqual(
          expect.arrayContaining([
            commit.playerStorageOwnerId,
            GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
          ]),
        )
        expect(await Effect.runPromise(Ref.get(state.rollSeed))).not.toBe(initialRollSeed)
        expect(await Effect.runPromise(world.chunkStore.getBlock(AT))).toStrictEqual({
          _tag: 'Block',
          block: 0,
        })
        expect(await Effect.runPromise(world.inventory.storageSnapshot)).toStrictEqual(initialStorage)

        const finalDrops = await Effect.runPromise(registeredCoordinator.snapshot(
          GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
          DroppedItemOwnerSnapshotSchema,
        ))
        const decodedDrops = Schema.decodeUnknownSync(DroppedItemOwnerSnapshotSchema)(finalDrops.state)
        expect(finalDrops.revision).toBe(2)
        expect(decodedDrops.items).toHaveLength(1)
        const drop = decodedDrops.items[0]
        if (drop === undefined) throw new Error('the mined stack was not committed to the dropped-item owner')
        expect(drop.behaviour).toMatchObject({ _tag: 'DroppedItem', item: 'dirt', count: 1 })
        expect(drop.feetPosition).toMatchObject({ x: AT.x, y: AT.y, z: AT.z })
        expect(await Effect.runPromise(registeredCoordinator.revision)).toBe(2)
        expect(await Effect.runPromise(registeredCoordinator.dimensionRevision(OVERWORLD))).toBe(1)
        expect((await Effect.runPromise(world.entities.snapshot)).entities).toHaveLength(0)
      }),
      { numRuns: 4, seed: 41821, examples: [[0], [35]] },
    )
  })

  it.effect('keeps a block untouched when its owner changes before the atomic break commit', () =>
    Effect.gen(function* () {
      const ironPickaxe = Result.getOrThrow(itemStack('iron_pickaxe', StackCount(1)))
      const stone = Option.getOrThrow(blockIdOf('stone'))
      // Stone drops cobblestone with a pickaxe: https://minecraft.wiki/w/Stone
      // Iron pickaxes lose one durability point per block: https://minecraft.wiki/w/Iron_Pickaxe
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        inventory: [ironPickaxe],
        world: {
          blocks: new Map([[cellKey(AT), stone]]),
          loaded: [chunkKey(chunkOf(AT))],
        },
      })
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      let injected = false
      const localStorageBefore = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(
        yield* world.inventory.storageSnapshot,
      )
      const initialDurability = localStorageBefore.inventoryDurability[0]
      if (initialDurability === undefined || initialDurability === null) {
        throw new Error('the iron pickaxe has no durability')
      }
      const registeredCoordinator = yield* makeWorldCommitCoordinator({
        world: commit.coordinator.worldId,
        owners: gameplayOwnerRegistrations({ playerStorage: localStorageBefore }),
        chunkStores: { forDimension: () => world.chunkStore },
      })
      const stageRequests: Array<Parameters<WorldCommitCoordinatorApi['commit']>[0]> = []
      const coordinator: WorldCommitCoordinatorApi = {
        ...registeredCoordinator,
        commit: (request) => {
          stageRequests.push(request)
          return registeredCoordinator.commit(request)
        },
        dimensionRevision: (dimension) =>
          Effect.gen(function* () {
            const dimensionRevision = yield* Effect.orDie(registeredCoordinator.dimensionRevision(dimension))
            if (!injected) {
              injected = true
              const snapshot = yield* Effect.orDie(
                registeredCoordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema),
              )
              const dirtStack = Result.getOrThrow(itemStack('dirt', StackCount(1)))
              const changedStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)({
                ...snapshot.state,
                inventory: {
                  slots: snapshot.state.inventory.slots.map((slot, index) => index === 1 ? dirtStack : slot),
                },
              })
              yield* Effect.orDie(
                registeredCoordinator.commit({
                  expectedRevision: snapshot.revision,
                  expectedDimensions: [],
                  changes: [{ ownerId: commit.playerStorageOwnerId, state: changedStorage }],
                }),
              )
            }
            return dimensionRevision
          }),
      }
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(
        state,
        world.chunkStore,
        world.entities,
        world.inventory,
        world.player,
        world.time,
        undefined,
        undefined,
        {},
        { ...commit, coordinator, playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID },
      )

      yield* requestBlockBreak(state, AT, { heldTier: 'iron' }, {
        dimension: 'overworld',
        toolLocation: { _tag: 'Inventory', slotIndex: 0 },
      })
      yield* runInteractions(stages as never)

      expect(injected).toBe(true)
      expect(stageRequests).toHaveLength(1)
      const miningFailure = (yield* Ref.get(state.operationFailures)).find(
        (failure) => failure.operation === 'WorldCommit' && failure.subject === 'Mining',
      )
      if (miningFailure === undefined) throw new Error('the conflicting mining commit was not recorded')
      expect(Schema.decodeUnknownSync(WorldCommitCoordinatorErrorSchema)(miningFailure.error)).toMatchObject({
        _tag: 'WorldRevisionConflict',
        expected: 0,
        actual: 1,
      })
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([blockPositionKeyOf(AT)])
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: stone })
      expect(yield* world.inventory.storageSnapshot).toEqual(localStorageBefore)
      const ownerAfterConflict = yield* registeredCoordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(ownerAfterConflict.state.inventory.slots[0]).toMatchObject({ item: 'iron_pickaxe', count: 1 })
      expect(ownerAfterConflict.state.inventory.slots[1]).toMatchObject({ item: 'dirt', count: 1 })
      expect(yield* registeredCoordinator.revision).toBe(1)
      expect(yield* registeredCoordinator.dimensionRevision('overworld')).toBe(0)

      yield* Ref.set(state.heldTool, NO_TOOL)
      yield* runInteractions(stages as never)

      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
      expect(stageRequests).toHaveLength(2)
      const retriedRequest = stageRequests[1]
      if (retriedRequest === undefined) throw new Error('the queued mining request was not retried')
      expect(retriedRequest.expectedRevision).toBe(1)
      expect(retriedRequest.blockWrite).toBeDefined()
      expect(retriedRequest.changes).toEqual(
        expect.arrayContaining([expect.objectContaining({ ownerId: commit.playerStorageOwnerId })]),
      )
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: 0 })
      const finalStorage = yield* registeredCoordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const finalDurability = finalStorage.state.inventoryDurability[0]
      if (finalDurability === undefined || finalDurability === null) {
        throw new Error('the iron pickaxe disappeared after retry')
      }
      expect(finalDurability.current).toBe(initialDurability.current - 1)
      const dirtCount = finalStorage.state.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'dirt' ? slot.count : 0),
        0,
      )
      const cobblestoneCount = finalStorage.state.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'cobblestone' ? slot.count : 0),
        0,
      )
      expect(dirtCount).toBe(1)
      expect(cobblestoneCount).toBe(1)
      expect(yield* world.inventory.storageSnapshot).toEqual(localStorageBefore)
      expect(yield* registeredCoordinator.revision).toBe(2)
      expect(yield* registeredCoordinator.dimensionRevision('overworld')).toBe(1)
      const roster = yield* world.entities.snapshot
      expect(roster.entities).toHaveLength(0)
    }),
  )

  it.effect('breaking redstone wire drops redstone dust', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(Option.getOrThrow(blockIdOf('redstone_wire')))
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(storedItemCount(storage.state, 'redstone_dust')).toBe(1)
    }),
  )

  it.effect('the inbox is DRAINED, so one click breaks one block', () =>
    Effect.gen(function* () {
      // `getAndSet` rather than get-then-set, per DN-GP-10. A stage that read
      // without clearing would re-break the same cell every frame — invisible
      // once the cell is air, and a duplicate drop every frame until it is.
      const world = yield* oneBlockWorld()
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)
      const afterFirst = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)

      yield* runInteractions(stages as never)
      const afterSecond = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)

      expect(afterSecond).toStrictEqual(afterFirst)
    }),
  )

  it.effect('breaking a cell that is already air yields nothing', () =>
    Effect.gen(function* () {
      // `NothingThere`. A player swinging at empty space is legal, and treating
      // it as a break would drop air into the inventory and re-mesh the chunk
      // every frame the button is held.
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: [chunkKey(chunkOf(AT))] },
      })
      const state = yield* makeGameplayFrameState
      const { stages, commit } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      const inventory = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(inventory.state.inventory.slots.every((slot) => slot === undefined)).toBe(true)
    }),
  )

  it.effect('breaking in an UNLOADED chunk changes nothing', () =>
    Effect.gen(function* () {
      // `ChunkNotLoaded` is not air. A store that answered air here would let a
      // player mine a chunk nobody has loaded, and the chunk that eventually
      // loads would overwrite the hole.
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: [] },
      })
      const state = yield* makeGameplayFrameState
      const { stages } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      expect((yield* world.chunkStore.getBlock(AT))._tag).toBe('ChunkNotLoaded')
    }),
  )

  it.effect('the break dirties the chunk, so a renderer is told to re-mesh', () =>
    Effect.gen(function* () {
      // The half that makes it VISIBLE. A break that changed the store and
      // notified nobody leaves the block on screen until something else happens
      // to dirty that chunk — which reads as "mining sometimes does not work".
      const world = yield* oneBlockWorld()
      const subscription = yield* world.chunkStore.subscribeDirty
      const state = yield* makeGameplayFrameState
      const { stages } = yield* gameplayStagesWithOwners(state, world)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      expect((yield* subscription.drain).changed).toStrictEqual([chunkOf(AT)])
    }),
  )
})
