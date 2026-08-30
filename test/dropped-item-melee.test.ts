import { describe, expect, it } from '@effect/vitest'
import { durabilityForItem, type InventoryServiceApi } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import { StackCount } from '../src/domain/frame-contract'
import { EntityId, EntityKind } from '@nerima-games/mc-sim'
import {
  CREEPER_KIND,
  DROPPED_ITEM_KIND,
  isDroppedItemBehaviour,
  type MobBehaviour,
} from '../src/domain/entities/mob-frame'
import {
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

const origin = { x: 0, y: 0, z: 0 }
const dropSource = EntityId('source')

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
      const fullInventory = emptySlots().map(() => ({
        item: 'stone' as const,
        count: StackCount(64),
      }))
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
        at: { x: 100, y: 0, z: 100 },
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
      expect(acceptedStorage.inventory.slots[0]).toStrictEqual({
        item: 'wooden_pickaxe',
        count: StackCount(1),
      })
      expect(acceptedStorage.inventoryDurability[0]).toStrictEqual(durability)
      expect(acceptedStorage.inventoryDurability[0]).not.toBe(durability)

      const fullInventory = emptySlots().map(() => ({
        item: 'stone' as const,
        count: StackCount(64),
      }))
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
        healthPoints: 1,
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
          Effect.zipRight(Effect.yieldNow(), inventory.api.addStoredStack(stack)),
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
})

describe('melee targeting', () => {
  it.effect('selects the nearest hostile on the aim ray and ignores passive entities', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: EntityKind('pig'),
        feetPosition: { x: 1, y: 0, z: 0 },
        healthPoints: 10,
        behaviour: undefined,
      })
      const near = yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: 2, y: 0, z: 0 },
        healthPoints: 10,
        behaviour: undefined,
      })
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: { x: 3, y: 0, z: 0 },
        healthPoints: 10,
        behaviour: undefined,
      })
      const candidates = yield* roster.api.entities
      const request = {
        origin: { x: 0, y: 0.9, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
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
        feetPosition: { x: 2, y: 0, z: 0 },
        healthPoints: 10,
        behaviour: undefined,
      })
      const candidates = yield* roster.api.entities
      const request = {
        origin: { x: 0, y: 0.9, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        reach: 4,
        damage: 4,
      }

      expect(meleeTarget(candidates, { ...request, hitDistance: Number.NaN })).toBeUndefined()
      expect(meleeTarget(candidates, { ...request, hitDistance: -1 })).toBeUndefined()
    }),
  )
})
