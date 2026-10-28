import { describe, expect, it } from '@effect/vitest'
import { position as atPosition } from './support/coordinate-fixtures'
import * as FastCheck from 'fast-check'
import {
  durabilityForItem,
  emptyPlayerStorage,
  makeEntityManager,
  makeReplicatedOwnerId,
  makeWorldCommitCoordinator,
  PlayerStorageSnapshotSchema,
  type InventoryServiceApi,
  type ReplicatedOwnerUnknown,
  type ReplicatedSnapshot,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Result, Schema } from 'effect'
import { DomainEventSchema, EntityHealthPoints, itemIdOf, itemStack, StackCount, WorldIdSchema, WorldRevisionSchema } from '@nerima-games/mc-kernel'
import { EntityId, EntityKind, WorldRevisionConflict } from '@nerima-games/mc-sim'
import {
  CREEPER_KIND,
  DROPPED_ITEM_KIND,
  isDroppedItemBehaviour,
  repairMobBehaviour,
  type MobBehaviour,
} from '../src/domain/entities/mob-frame'
import {
  DroppedItemOwnerSnapshotSchema,
  DroppedItemPickupCommitIncompleteSchema,
  DroppedItemPickupRequestSchema,
  DroppedItemPickupSchema,
  DroppedItemPickupResultSchema,
  droppedItemPickupOwnerRegistrations,
  pickupDroppedItemsCommitted,
  pickupDroppedItems,
  spawnDroppedItem,
  spawnMobDrop,
} from '../src/domain/entities/dropped-item'
import { meleeTarget, meleeTargetBeforeBlock } from '../src/domain/interactions/melee-attack'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import {
  emptySlots,
  makeInventoryDouble,
} from './support/inventory-service-double'

const origin = atPosition(0, 0, 0 )
const dropSource = EntityId('source')
const pickupActor = EntityId('player:pickup')
const committedPickupOwners = {
  playerStorage: makeReplicatedOwnerId('player-storage:pickup-test'),
  droppedItems: makeReplicatedOwnerId('dropped-items:pickup-test'),
}

const committedDroppedItem = (count: number) => ({
  id: dropSource,
  feetPosition: atPosition(0, 0, 0),
  behaviour: {
    _tag: 'DroppedItem' as const,
    item: 'gunpowder' as const,
    count: StackCount(count),
    durability: null,
  },
})

const makePickupCoordinator = (
  playerStorage: ReturnType<typeof emptyPlayerStorage>,
  droppedItems: ReturnType<typeof committedDroppedItem>[],
) =>
  makeWorldCommitCoordinator({
    world: Schema.decodeUnknownSync(WorldIdSchema)('dropped-item-pickup-tests'),
    owners: droppedItemPickupOwnerRegistrations(committedPickupOwners, playerStorage, {
      items: droppedItems,
    }),
  })

describe('dropped item entities', () => {
  it.effect('spawns and recognises plant items added by the kernel vocabulary', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()

      const spawned = yield* spawnDroppedItem(roster.api, {
        item: 'cactus',
        count: 1,
        at: origin,
      })

      expect(isDroppedItemBehaviour(spawned.behaviour)).toBe(true)
      expect(spawned.behaviour).toStrictEqual({
        _tag: 'DroppedItem',
        item: 'cactus',
        count: 1,
        durability: null,
      })
    }),
  )

  it.effect('preserves the item stack in snapshots and despawns it after a full pickup', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()

      const spawned = yield* spawnMobDrop(roster.api, {
        source: dropSource,
        kind: CREEPER_KIND,
        item: 'gunpowder',
        count: 3,
        at: origin,
      })
      expect(spawned.kind).toBe(DROPPED_ITEM_KIND)
      expect(spawned.behaviour).toStrictEqual({
        _tag: 'DroppedItem',
        item: 'gunpowder',
        count: 3,
        durability: null,
      })
      expect((yield* roster.api.snapshot).entities[0]?.behaviour).toStrictEqual(spawned.behaviour)

      yield* pickupDroppedItems(roster.api, inventory.api, origin)

      expect(yield* roster.api.count).toBe(0)
      expect(yield* inventory.deposits).toStrictEqual([
        { item: 'gunpowder', count: 3, leftover: 0 },
      ])
    }),
  )

  it.effect('leaves an overflowing stack on the ground with its full remaining count', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const fullInventory = emptySlots().map(() => Result.getOrThrow(itemStack('stone', StackCount(64))))
      const inventory = yield* makeInventoryDouble(fullInventory)
      yield* spawnMobDrop(roster.api, {
        source: dropSource,
        kind: CREEPER_KIND,
        item: 'gunpowder',
        count: 5,
        at: origin,
      })

      yield* pickupDroppedItems(roster.api, inventory.api, origin)

      const [remaining] = yield* roster.api.entities
      expect(remaining?.kind).toBe(DROPPED_ITEM_KIND)
      expect(remaining?.behaviour).toStrictEqual({
        _tag: 'DroppedItem',
        item: 'gunpowder',
        count: 5,
        durability: null,
      })
    }),
  )

  it.effect('preserves a restored non-dropped entity after inventory leaves a stack over', () =>
    Effect.gen(function* () {
      const roster = yield* Effect.orDie(
        makeEntityManager<MobBehaviour>(undefined, repairMobBehaviour),
      )
      const spawned = yield* spawnDroppedItem(roster, {
        item: 'gunpowder',
        count: 1,
        at: origin,
      })
      const fullInventory = emptySlots().map(() =>
        Result.getOrThrow(itemStack('stone', StackCount(64))),
      )
      const inventory = yield* makeInventoryDouble(fullInventory)
      const restoringInventory: InventoryServiceApi = {
        ...inventory.api,
        addStoredStack: (stack) =>
          Effect.gen(function* () {
            const result = yield* inventory.api.addStoredStack(stack)
            const snapshot = yield* roster.snapshot
            yield* Effect.orDie(
              roster.restore({
                ...snapshot,
                entities: snapshot.entities.map((entity) =>
                  entity.id === spawned.id
                    ? { ...entity, behaviour: undefined }
                    : entity,
                ),
              }),
            )
            return result
          }),
      }

      yield* pickupDroppedItems(roster, restoringInventory, origin)

      expect(yield* roster.find(spawned.id)).toStrictEqual({
        ...spawned,
        behaviour: undefined,
      })
      expect(yield* inventory.deposits).toStrictEqual([
        { item: 'gunpowder', count: 1, leftover: 1 },
      ])
    }),
  )

  it.effect('does nothing without a player position, and rejects an invalid radius', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      yield* spawnDroppedItem(roster.api, { item: 'gunpowder', count: 1, at: origin })

      yield* pickupDroppedItems(roster.api, inventory.api, undefined)
      yield* pickupDroppedItems(roster.api, inventory.api, origin, Number.NaN)
      yield* pickupDroppedItems(roster.api, inventory.api, origin, -1)

      expect(yield* roster.api.count).toBe(1)
      expect(yield* inventory.deposits).toStrictEqual([])
    }),
  )

  it.effect('leaves an out-of-radius dropped item untouched while a nearer one is picked up', () =>
    Effect.gen(function* () {
      // The near item is the only one with a `leftovers` entry; the far one is
      // swept over anyway (`sweep` visits every entity) and must be reported
      // as UNCHANGED rather than mistaken for one of the processed drops.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      yield* spawnDroppedItem(roster.api, { item: 'gunpowder', count: 1, at: origin })
      const far = yield* spawnDroppedItem(roster.api, {
        item: 'stick',
        count: 1,
        at: atPosition(100, 0, 100 ),
      })

      yield* pickupDroppedItems(roster.api, inventory.api, origin)

      expect(yield* roster.api.count).toBe(1)
      const [remaining] = yield* roster.api.entities
      expect(remaining).toStrictEqual(far)
      expect(yield* inventory.deposits).toStrictEqual([
        { item: 'gunpowder', count: 1, leftover: 0 },
      ])
    }),
  )

  it.effect('defaults durable drops to maximum durability and copies explicit input', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inputDurability = { current: 12, max: 59 }

      const defaulted = yield* spawnDroppedItem(roster.api, {
        item: 'wooden_pickaxe',
        count: 1,
        at: origin,
      })
      const explicit = yield* spawnDroppedItem(roster.api, {
        item: 'wooden_pickaxe',
        count: 1,
        durability: inputDurability,
        at: origin,
      })

      if (
        !isDroppedItemBehaviour(defaulted.behaviour) ||
        !isDroppedItemBehaviour(explicit.behaviour)
      ) return
      expect(defaulted.behaviour.durability).toStrictEqual(durabilityForItem('wooden_pickaxe'))
      expect(explicit.behaviour.durability).toStrictEqual(inputDurability)
      expect(explicit.behaviour.durability).not.toBe(inputDurability)
      inputDurability.current = 1
      expect(explicit.behaviour.durability).toStrictEqual({ current: 12, max: 59 })
    }),
  )

  it.effect('rejects invalid stack and durability combinations before spawning', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const invalidDrops = [
        { item: 'gunpowder' as const, count: 0 },
        { item: 'wooden_pickaxe' as const, count: 1, durability: null },
        {
          item: 'wooden_pickaxe' as const,
          count: 1,
          durability: { current: 0, max: 59 },
        },
        {
          item: 'wooden_pickaxe' as const,
          count: 1,
          durability: { current: 12, max: 60 },
        },
        {
          item: 'wooden_pickaxe' as const,
          count: 1,
          durability: { current: 60, max: 59 },
        },
        { item: 'wooden_pickaxe' as const, count: 2 },
        { item: 'gunpowder' as const, count: 1, durability: { current: 1, max: 1 } },
      ]

      for (const drop of invalidDrops) {
        const error = yield* Effect.flip(spawnDroppedItem(roster.api, { ...drop, at: origin }))
        expect(error).toStrictEqual({ _tag: 'InvalidStack' })
      }
      expect(yield* roster.api.count).toBe(0)
    }),
  )

  it.effect('preserves durable stacks through complete and refused pickups', () =>
    Effect.gen(function* () {
      const durability = { current: 12, max: 59 }
      const acceptedRoster = yield* makeEntityManagerDouble<MobBehaviour>()
      const acceptedInventory = yield* makeInventoryDouble()
      yield* spawnDroppedItem(acceptedRoster.api, {
        item: 'wooden_pickaxe',
        count: 1,
        durability,
        at: origin,
      })

      yield* pickupDroppedItems(acceptedRoster.api, acceptedInventory.api, origin)

      expect(yield* acceptedRoster.api.count).toBe(0)
      const acceptedStorage = yield* acceptedInventory.api.storageSnapshot
      expect(acceptedStorage.inventory.slots[0]).toStrictEqual(
        Result.getOrThrow(itemStack('wooden_pickaxe', StackCount(1))),
      )
      expect(acceptedStorage.inventoryDurability[0]).toStrictEqual(durability)
      expect(acceptedStorage.inventoryDurability[0]).not.toBe(durability)

      const fullInventory = emptySlots().map(() => Result.getOrThrow(itemStack('stone', StackCount(64))))
      const refusedRoster = yield* makeEntityManagerDouble<MobBehaviour>()
      const refusedInventory = yield* makeInventoryDouble(fullInventory)
      yield* spawnDroppedItem(refusedRoster.api, {
        item: 'wooden_pickaxe',
        count: 1,
        durability,
        at: origin,
      })

      yield* pickupDroppedItems(refusedRoster.api, refusedInventory.api, origin)

      const [remaining] = yield* refusedRoster.api.entities
      expect(remaining?.behaviour).toStrictEqual({
        _tag: 'DroppedItem',
        item: 'wooden_pickaxe',
        count: 1,
        durability,
      })
      if (remaining !== undefined && isDroppedItemBehaviour(remaining.behaviour)) {
        expect(remaining.behaviour.durability).not.toBe(durability)
      }
    }),
  )

  it.effect('leaves an entity behind whose stored behaviour is invalid, rather than crediting it', () =>
    Effect.gen(function* () {
      // `spawnDroppedItem` validates before spawning, so an entity with an
      // invalid durability normally cannot exist. Reached here by spawning
      // through the roster double directly, bypassing that guard — proving
      // `pickupDroppedItems`'s own `isDroppedItemBehaviour` filter, not
      // `spawnDroppedItem`'s, is what keeps such an entity from being
      // credited.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      const spawned = yield* roster.api.spawn({
        kind: DROPPED_ITEM_KIND,
        feetPosition: origin,
        healthPoints: EntityHealthPoints(1),
        behaviour: {
          _tag: 'DroppedItem',
          item: 'wooden_pickaxe',
          count: StackCount(1),
          durability: { current: 0, max: 59 },
        },
      })

      yield* pickupDroppedItems(roster.api, inventory.api, origin)

      const remaining = yield* roster.api.entities
      expect(remaining.map((entity) => entity.id)).toStrictEqual([spawned.id])
      const storage = yield* inventory.api.storageSnapshot
      expect(storage.inventory.slots.every((slot) => slot === undefined)).toBe(true)
    }),
  )

  it.effect('leaves stacks with unsafe counts or overstacked items untouched', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      for (const [item, count] of [
        ['gunpowder', 1e30],
        ['stone', 65],
      ] as const) {
        yield* roster.api.spawn({
          kind: DROPPED_ITEM_KIND,
          feetPosition: origin,
          healthPoints: EntityHealthPoints(1),
          behaviour: { _tag: 'DroppedItem', item, count, durability: null },
        })
      }

      yield* pickupDroppedItems(roster.api, inventory.api, origin)

      expect(yield* roster.api.count).toBe(2)
      expect(yield* inventory.deposits).toStrictEqual([])
    }),
  )

  it.effect('defers a frame-gated drop until its eligible frame', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      yield* spawnDroppedItem(roster.api, {
        item: 'gunpowder',
        count: 2,
        at: origin,
        eligibleFromFrame: 8,
      })

      yield* pickupDroppedItems(roster.api, inventory.api, origin, undefined, 7)

      expect(yield* roster.api.count).toBe(1)
      expect(yield* inventory.deposits).toStrictEqual([])

      yield* pickupDroppedItems(roster.api, inventory.api, origin, undefined, 8)

      expect(yield* roster.api.count).toBe(0)
      expect(yield* inventory.deposits).toStrictEqual([
        { item: 'gunpowder', count: 2, leftover: 0 },
      ])
    }),
  )

  it.effect('serializes concurrent pickups so one entity is stored once', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      yield* spawnDroppedItem(roster.api, {
        item: 'gunpowder',
        count: 1,
        at: origin,
      })
      const delayedInventory = {
        ...inventory.api,
        addStoredStack: (stack) =>
          Effect.andThen(Effect.yieldNow, inventory.api.addStoredStack(stack)),
      } satisfies InventoryServiceApi

      yield* Effect.all(
        [
          pickupDroppedItems(roster.api, delayedInventory, origin),
          pickupDroppedItems(roster.api, delayedInventory, origin),
        ],
        { concurrency: 'unbounded' },
      )

      expect(yield* inventory.api.countOf('gunpowder')).toBe(1)
      expect(yield* inventory.deposits).toStrictEqual([
        { item: 'gunpowder', count: 1, leftover: 0 },
      ])
      expect(yield* roster.api.count).toBe(0)
    }),
  )

  it.effect('commits player storage and dropped items together before emitting pickup events', () =>
    Effect.gen(function* () {
      const coordinator = yield* makePickupCoordinator(emptyPlayerStorage(), [
        committedDroppedItem(3),
      ])

      const pickups = yield* pickupDroppedItemsCommitted(coordinator, committedPickupOwners, {
        actor: pickupActor,
        tick: 4,
        position: origin,
      })
      const playerSnapshot = yield* coordinator.snapshot(
        committedPickupOwners.playerStorage,
        PlayerStorageSnapshotSchema,
      )
      const droppedItemsSnapshot = yield* coordinator.snapshot(
        committedPickupOwners.droppedItems,
        DroppedItemOwnerSnapshotSchema,
      )

      expect(pickups).toHaveLength(1)
      expect(pickups[0]).toMatchObject({
        actor: pickupActor,
        source: dropSource,
        item: 'gunpowder',
        accepted: 3,
        event: {
          _tag: 'ItemPickedUp',
          tick: 4,
          actor: pickupActor,
          source: { _tag: 'DroppedItem', id: dropSource },
          count: 3,
        },
      })
      expect(Result.isSuccess(Schema.decodeUnknownResult(DomainEventSchema)(pickups[0]?.event))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(DroppedItemPickupResultSchema)(pickups))).toBe(true)
      expect(Result.isFailure(
        Schema.decodeUnknownResult(DroppedItemPickupResultSchema)([
          { ...pickups[0], unexpected: true },
        ]),
      )).toBe(true)
      expect(playerSnapshot.revision).toBe(1)
      expect(droppedItemsSnapshot.revision).toBe(1)
      expect(playerSnapshot.state.inventory.slots.some(
        (slot) => slot?.item === 'gunpowder' && slot.count === 3,
      )).toBe(true)
      expect(droppedItemsSnapshot.state.items).toStrictEqual([])
    }),
  )

  it.effect('reports only the amount accepted by the committed inventory', () =>
    Effect.gen(function* () {
      const emptyStorage = emptyPlayerStorage()
      const slots = emptySlots().map(() =>
        Result.getOrThrow(itemStack('stone', StackCount(64))),
      )
      slots[0] = Result.getOrThrow(itemStack('gunpowder', StackCount(63)))
      const almostFullStorage = {
        ...emptyStorage,
        inventory: { slots },
      }
      const coordinator = yield* makePickupCoordinator(almostFullStorage, [
        committedDroppedItem(5),
      ])

      const pickups = yield* pickupDroppedItemsCommitted(coordinator, committedPickupOwners, {
        actor: pickupActor,
        tick: 5,
        position: origin,
      })
      const playerSnapshot = yield* coordinator.snapshot(
        committedPickupOwners.playerStorage,
        PlayerStorageSnapshotSchema,
      )
      const droppedItemsSnapshot = yield* coordinator.snapshot(
        committedPickupOwners.droppedItems,
        DroppedItemOwnerSnapshotSchema,
      )

      expect(pickups).toHaveLength(1)
      expect(pickups[0]?.accepted).toBe(1)
      expect(pickups[0]?.event).toMatchObject({ _tag: 'ItemPickedUp', count: 1 })
      expect(playerSnapshot.state.inventory.slots[0]?.count).toBe(64)
      expect(droppedItemsSnapshot.state.items[0]?.behaviour.count).toBe(4)
      expect(playerSnapshot.revision).toBe(1)
      expect(droppedItemsSnapshot.revision).toBe(1)
    }),
  )

  it.effect('does not commit or emit when the inventory accepts nothing', () =>
    Effect.gen(function* () {
      const emptyStorage = emptyPlayerStorage()
      const fullStorage = {
        ...emptyStorage,
        inventory: {
          slots: emptySlots().map(() =>
            Result.getOrThrow(itemStack('stone', StackCount(64))),
          ),
        },
      }
      const coordinator = yield* makePickupCoordinator(fullStorage, [committedDroppedItem(2)])

      const pickups = yield* pickupDroppedItemsCommitted(coordinator, committedPickupOwners, {
        actor: pickupActor,
        tick: 6,
        position: origin,
      })
      const playerSnapshot = yield* coordinator.snapshot(
        committedPickupOwners.playerStorage,
        PlayerStorageSnapshotSchema,
      )
      const droppedItemsSnapshot = yield* coordinator.snapshot(
        committedPickupOwners.droppedItems,
        DroppedItemOwnerSnapshotSchema,
      )

      expect(pickups).toStrictEqual([])
      expect(playerSnapshot.revision).toBe(0)
      expect(droppedItemsSnapshot.revision).toBe(0)
      expect(droppedItemsSnapshot.state.items[0]?.behaviour.count).toBe(2)
    }),
  )

  it.effect('returns no committed pickups without a position and preserves deferred or distant drops', () =>
    Effect.gen(function* () {
      const deferred = {
        ...committedDroppedItem(2),
        behaviour: {
          ...committedDroppedItem(2).behaviour,
          eligibleFromFrame: 8,
        },
      }
      const distant = {
        ...committedDroppedItem(1),
        id: EntityId('source:distant'),
        feetPosition: atPosition(100, 0, 100),
      }
      const coordinator = yield* makePickupCoordinator(emptyPlayerStorage(), [deferred, distant])

      const noPosition = yield* pickupDroppedItemsCommitted(coordinator, committedPickupOwners, {
        actor: pickupActor,
        tick: 8,
        position: undefined,
      })
      const ineligible = yield* pickupDroppedItemsCommitted(coordinator, committedPickupOwners, {
        actor: pickupActor,
        tick: 8,
        position: origin,
        currentFrame: 7,
      })
      const snapshot = yield* coordinator.snapshot(
        committedPickupOwners.droppedItems,
        DroppedItemOwnerSnapshotSchema,
      )

      expect(noPosition).toStrictEqual([])
      expect(ineligible).toStrictEqual([])
      expect(snapshot.state.items.map(({ id }) => id)).toStrictEqual([
        dropSource,
        EntityId('source:distant'),
      ])
      expect(snapshot.revision).toBe(0)
    }),
  )

  it.effect('rejects a coordinator commit response that omits an owner update', () =>
    Effect.gen(function* () {
      const coordinator = yield* makePickupCoordinator(emptyPlayerStorage(), [
        committedDroppedItem(2),
      ])
      const incompleteCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        commit: (request) => Effect.map(coordinator.commit(request), (delta) => ({
          ...delta,
          changes: delta.changes.filter(({ owner }) => owner !== committedPickupOwners.droppedItems),
        })),
      }

      const failure = yield* Effect.flip(pickupDroppedItemsCommitted(
        incompleteCoordinator,
        committedPickupOwners,
        { actor: pickupActor, tick: 9, position: origin },
      ))

      expect(failure._tag).toBe('DroppedItemPickupCommitIncomplete')
      expect(failure).toMatchObject({ missingOwners: [committedPickupOwners.droppedItems] })
    }),
  )

  it.effect('does not report a pickup when committed counts imply no accepted stack count', () =>
    Effect.gen(function* () {
      const coordinator = yield* makePickupCoordinator(emptyPlayerStorage(), [
        committedDroppedItem(2),
      ])
      const inconsistentResponseCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        commit: (request) => Effect.map(coordinator.commit(request), (delta) => ({
          ...delta,
          changes: delta.changes.map((change) => change.owner === committedPickupOwners.droppedItems
            ? { ...change, state: { items: [committedDroppedItem(2)] } }
            : change),
        })),
      }

      const pickups = yield* pickupDroppedItemsCommitted(
        inconsistentResponseCoordinator,
        committedPickupOwners,
        { actor: pickupActor, tick: 10, position: origin },
      )

      expect(pickups).toStrictEqual([])
    }),
  )

  it.effect('rejects mixed owner snapshots before committing either pickup candidate', () =>
    Effect.gen(function* () {
      const coordinator = yield* makePickupCoordinator(emptyPlayerStorage(), [
        committedDroppedItem(2),
      ])
      type SnapshotCodec = Parameters<WorldCommitCoordinatorApi['snapshot']>[1]
      type SnapshotOwnerId = Parameters<WorldCommitCoordinatorApi['snapshot']>[0]
      let injectedConcurrentCommit = false
      const interleavingCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        snapshot: <Codec extends SnapshotCodec>(
          ownerId: SnapshotOwnerId,
          schema: Codec,
        ): Effect.Effect<
          ReplicatedSnapshot<Codec>,
          Schema.SchemaError | ReplicatedOwnerUnknown,
          Schema.Codec.DecodingServices<Codec>
        > =>
          Effect.gen(function* () {
            const snapshot = yield* coordinator.snapshot(ownerId, schema)
            if (!injectedConcurrentCommit) {
              injectedConcurrentCommit = true
              const playerSnapshot = yield* coordinator.snapshot(
                committedPickupOwners.playerStorage,
                PlayerStorageSnapshotSchema,
              )
              const concurrentCommit = yield* Effect.result(coordinator.commit({
                expectedRevision: playerSnapshot.revision,
                expectedDimensions: [],
                changes: [{
                  ownerId: committedPickupOwners.playerStorage,
                  state: playerSnapshot.state,
                }],
              }))
              if (Result.isFailure(concurrentCommit)) return snapshot
            }
            return snapshot
          }),
      }

      const outcome = yield* Effect.result(pickupDroppedItemsCommitted(
        interleavingCoordinator,
        committedPickupOwners,
        { actor: pickupActor, tick: 7, position: origin },
      ))
      const playerSnapshot = yield* coordinator.snapshot(
        committedPickupOwners.playerStorage,
        PlayerStorageSnapshotSchema,
      )
      const droppedItemsSnapshot = yield* coordinator.snapshot(
        committedPickupOwners.droppedItems,
        DroppedItemOwnerSnapshotSchema,
      )

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure).toMatchObject({ _tag: 'WorldRevisionConflict' })
      }
      expect(playerSnapshot.revision).toBe(1)
      expect(droppedItemsSnapshot.revision).toBe(1)
      expect(playerSnapshot.state.inventory.slots.every((slot) => slot === undefined)).toBe(true)
      expect(droppedItemsSnapshot.state.items[0]?.behaviour.count).toBe(2)
    }),
  )

  for (const seed of [70301, 70302]) {
    it(`commits a successful pickup once and conserves item counts (seed ${seed})`, () => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 1, max: 64 }),
          (count) => {
            const storage = emptyPlayerStorage()
            const slots = emptySlots().map(() =>
              Result.getOrThrow(itemStack('stone', StackCount(64))),
            )
            slots[0] = Result.getOrThrow(itemStack('gunpowder', StackCount(63)))
            const coordinator = Effect.runSync(makePickupCoordinator(
              { ...storage, inventory: { slots } },
              [committedDroppedItem(count)],
            ))

            let commitCalls = 0
            let committedOwnerCount = 0
            let requestHasBlockWrite = true
            const countingCoordinator: WorldCommitCoordinatorApi = {
              ...coordinator,
              commit: (request) => {
                commitCalls += 1
                committedOwnerCount = request.changes.length
                requestHasBlockWrite = request.blockWrite !== undefined
                return coordinator.commit(request)
              },
            }
            const pickups = Effect.runSync(pickupDroppedItemsCommitted(countingCoordinator, committedPickupOwners, {
              actor: pickupActor,
              tick: 5,
              position: origin,
            }))
            const playerSnapshot = Effect.runSync(coordinator.snapshot(
              committedPickupOwners.playerStorage,
              PlayerStorageSnapshotSchema,
            ))
            const droppedItemsSnapshot = Effect.runSync(coordinator.snapshot(
              committedPickupOwners.droppedItems,
              DroppedItemOwnerSnapshotSchema,
            ))
            const storedAfter = playerSnapshot.state.inventory.slots
              .filter((slot) => slot?.item === 'gunpowder')
              .reduce((total, slot) => total + (slot?.count ?? 0), 0)
            const remaining = droppedItemsSnapshot.state.items
              .filter(({ behaviour }) => behaviour.item === 'gunpowder')
              .reduce((total, { behaviour }) => total + behaviour.count, 0)
            const accepted = pickups.reduce((total, pickup) => total + pickup.accepted, 0)

            return storedAfter - 63 + remaining === count &&
              accepted === storedAfter - 63 &&
              commitCalls === 1 &&
              committedOwnerCount === 2 &&
              !requestHasBlockWrite &&
              playerSnapshot.revision === 1 &&
              droppedItemsSnapshot.revision === 1
          },
        ),
        { numRuns: 50, seed },
      )
    })
  }

  it('keeps both owners and revision unchanged when a pickup commit fails', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 64 }),
        (count) => {
          const coordinator = Effect.runSync(makePickupCoordinator(emptyPlayerStorage(), [
            committedDroppedItem(count),
          ]))
          let commitCalls = 0
          let requestHasBlockWrite = true
          const rejectingCoordinator: WorldCommitCoordinatorApi = {
            ...coordinator,
            commit: (request) => {
              commitCalls += 1
              requestHasBlockWrite = request.blockWrite !== undefined
              return Effect.fail(new WorldRevisionConflict({
                expected: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
                actual: Schema.decodeUnknownSync(WorldRevisionSchema)(1),
              }))
            },
          }
          const playerBefore = Effect.runSync(coordinator.snapshot(
            committedPickupOwners.playerStorage,
            PlayerStorageSnapshotSchema,
          ))
          const itemsBefore = Effect.runSync(coordinator.snapshot(
            committedPickupOwners.droppedItems,
            DroppedItemOwnerSnapshotSchema,
          ))
          const outcome = Effect.runSync(Effect.result(pickupDroppedItemsCommitted(
            rejectingCoordinator,
            committedPickupOwners,
            { actor: pickupActor, tick: 5, position: origin },
          )))
          const playerAfter = Effect.runSync(coordinator.snapshot(
            committedPickupOwners.playerStorage,
            PlayerStorageSnapshotSchema,
          ))
          const itemsAfter = Effect.runSync(coordinator.snapshot(
            committedPickupOwners.droppedItems,
            DroppedItemOwnerSnapshotSchema,
          ))

          return Result.isFailure(outcome) &&
            commitCalls === 1 &&
            !requestHasBlockWrite &&
            playerAfter.revision === playerBefore.revision &&
            itemsAfter.revision === itemsBefore.revision &&
            JSON.stringify(playerAfter.state) === JSON.stringify(playerBefore.state) &&
            JSON.stringify(itemsAfter.state) === JSON.stringify(itemsBefore.state)
        },
      ),
      { numRuns: 50, seed: 70303 },
    )
  })

  it('strictly validates the replicated dropped-item owner with its public schema', () => {
    const validSnapshot = { items: [committedDroppedItem(1)] }

    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 64 }),
        (count) => Result.isSuccess(Schema.decodeUnknownResult(DroppedItemOwnerSnapshotSchema)({
          items: [committedDroppedItem(count)],
        })),
      ),
      { numRuns: 100 },
    )
    expect(Result.isSuccess(
      Schema.decodeUnknownResult(DroppedItemOwnerSnapshotSchema)(validSnapshot),
    )).toBe(true)
    expect(Result.isFailure(
      Schema.decodeUnknownResult(DroppedItemOwnerSnapshotSchema)({
        ...validSnapshot,
        unexpected: true,
      }),
    )).toBe(true)
    expect(Result.isFailure(
      Schema.decodeUnknownResult(DroppedItemOwnerSnapshotSchema)({
        items: [{ ...committedDroppedItem(1), unexpected: true }],
      }),
    )).toBe(true)
    const invalidUnstackableDrop = committedDroppedItem(2)
    expect(Result.isFailure(
      Schema.decodeUnknownResult(DroppedItemOwnerSnapshotSchema)({
        items: [{
          ...invalidUnstackableDrop,
          behaviour: { ...invalidUnstackableDrop.behaviour, item: 'iron_sword' },
        }],
      }),
    )).toBe(true)
  })

  it('rejects missing required owner and result fields and null for every public pickup schema', () => {
    const pickupEvent = {
      _tag: 'ItemPickedUp' as const,
      tick: 4,
      actor: pickupActor,
      source: { _tag: 'DroppedItem' as const, id: dropSource },
      item: itemIdOf('gunpowder'),
      count: 1,
    }
    const validPickup = {
      actor: pickupActor,
      source: dropSource,
      item: 'gunpowder' as const,
      accepted: StackCount(1),
      event: pickupEvent,
    }
    const cases = [
      {
        schema: DroppedItemOwnerSnapshotSchema,
        valid: { items: [committedDroppedItem(1)] },
        missing: 'items',
      },
      {
        schema: DroppedItemPickupRequestSchema,
        valid: { actor: pickupActor, tick: 4, position: origin },
        missing: 'actor',
      },
      {
        schema: DroppedItemPickupCommitIncompleteSchema,
        valid: { _tag: 'DroppedItemPickupCommitIncomplete', missingOwners: [committedPickupOwners.droppedItems] },
        missing: 'missingOwners',
      },
      {
        schema: DroppedItemPickupSchema,
        valid: validPickup,
        missing: 'actor',
      },
      {
        schema: DroppedItemPickupResultSchema,
        valid: [validPickup],
        missing: undefined,
      },
    ] as const

    for (const { schema, valid, missing } of cases) {
      expect(Result.isFailure(Schema.decodeUnknownResult(schema)(null))).toBe(true)
      if (missing !== undefined) {
        const partial = Object.fromEntries(
          Object.entries(valid).filter(([key]) => key !== missing),
        )
        expect(Result.isFailure(Schema.decodeUnknownResult(schema)(partial))).toBe(true)
      }
    }
  })
})

describe('melee targeting', () => {
  it.effect('selects the nearest hostile on the aim ray and ignores passive entities', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: EntityKind('pig'),
        feetPosition: atPosition(1, 0, 0 ),
        healthPoints: EntityHealthPoints(10),
        behaviour: undefined,
      })
      const near = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: atPosition(2, 0, 0 ),
        healthPoints: EntityHealthPoints(10),
        behaviour: undefined,
      })
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: atPosition(3, 0, 0 ),
        healthPoints: EntityHealthPoints(10),
        behaviour: undefined,
      })
      const candidates = yield* roster.api.entities
      const request = {
        origin: atPosition(0, 0.9, 0 ),
        direction: atPosition(1, 0, 0 ),
        reach: 4,
        damage: 4,
      }

      expect(meleeTarget(candidates, request)?.id).toBe(near.id)
      expect(meleeTargetBeforeBlock(candidates, request, 1.5)).toBeUndefined()
      expect(meleeTargetBeforeBlock(candidates, request, 2.5)?.id).toBe(near.id)
    }),
  )

  it.effect('rejects a non-finite or negative hitDistance rather than treating it as unblocked', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: atPosition(2, 0, 0 ),
        healthPoints: EntityHealthPoints(10),
        behaviour: undefined,
      })
      const candidates = yield* roster.api.entities
      const request = {
        origin: atPosition(0, 0.9, 0 ),
        direction: atPosition(1, 0, 0 ),
        reach: 4,
        damage: 4,
      }

      expect(meleeTarget(candidates, { ...request, hitDistance: Number.NaN })).toBeUndefined()
      expect(meleeTarget(candidates, { ...request, hitDistance: -1 })).toBeUndefined()
    }),
  )
})
