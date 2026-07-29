import type { InventoryServiceApi } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import { changed, DESPAWNED, UNCHANGED, type Entity, type EntityManagerApi, type Position } from '../entity-manager-port'
import {
  DROPPED_ITEM_KIND,
  isDroppedItemBehaviour,
  type MobBehaviour,
  type MobDropEvent,
} from './mob-frame'

export const DROPPED_ITEM_PICKUP_RADIUS = 1.5

export const spawnMobDrop = (
  roster: EntityManagerApi<MobBehaviour>,
  drop: MobDropEvent,
): Effect.Effect<Entity<MobBehaviour>> =>
  roster.spawn({
    kind: DROPPED_ITEM_KIND,
    feetPosition: drop.at,
    healthPoints: 1,
    behaviour: { _tag: 'DroppedItem', item: drop.item, count: drop.count },
  })

export const spawnMobDrops = (
  roster: EntityManagerApi<MobBehaviour>,
  drops: ReadonlyArray<MobDropEvent>,
): Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>> =>
  Effect.forEach(drops, (drop) => spawnMobDrop(roster, drop))

const distanceSquared = (left: Position, right: Position): number => {
  const dx = left.x - right.x
  const dy = left.y - right.y
  const dz = left.z - right.z
  return dx * dx + dy * dy + dz * dz
}

export const pickupDroppedItems = (
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  playerPosition: Position | undefined,
  radius: number = DROPPED_ITEM_PICKUP_RADIUS,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (playerPosition === undefined || !Number.isFinite(radius) || radius < 0) return

    const leftovers = new Map<string, number>()
    const radiusSquared = radius * radius
    for (const entity of yield* roster.entities) {
      if (
        entity.kind !== DROPPED_ITEM_KIND ||
        !isDroppedItemBehaviour(entity.behaviour) ||
        distanceSquared(entity.feetPosition, playerPosition) > radiusSquared
      ) continue

      leftovers.set(entity.id, yield* inventory.add(entity.behaviour.item, entity.behaviour.count))
    }

    if (leftovers.size === 0) return
    yield* roster.sweep<never>((entity) => {
      const leftover = leftovers.get(entity.id)
      if (leftover === undefined) return { transition: UNCHANGED, emit: undefined }
      if (leftover === 0) return { transition: DESPAWNED, emit: undefined }
      const behaviour = entity.behaviour
      if (!isDroppedItemBehaviour(behaviour)) return { transition: UNCHANGED, emit: undefined }
      return {
        transition: changed({
          feetPosition: entity.feetPosition,
          healthPoints: entity.healthPoints,
          behaviour: { ...behaviour, count: leftover },
        }),
        emit: undefined,
      }
    })
  })
