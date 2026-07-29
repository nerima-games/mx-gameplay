import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { StackCount } from '../domain/frame-contract'
import { EntityId, EntityKind } from '../domain/entity-manager-port'
import {
  CREEPER_KIND,
  DROPPED_ITEM_KIND,
  type MobBehaviour,
} from '../domain/entities/mob-frame'
import {
  pickupDroppedItems,
  spawnDroppedItem,
  spawnMobDrop,
} from '../domain/entities/dropped-item'
import { meleeTarget, meleeTargetBeforeBlock } from '../domain/interactions/melee-attack'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import {
  emptySlots,
  makeInventoryDouble,
} from './support/inventory-service-double'

const origin = { x: 0, y: 0, z: 0 }
const dropSource = EntityId('source')

describe('dropped item entities', () => {
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
      })
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
})
