import type { ItemType } from '@nerima-games/mc-kernel'
import {
  addStoredStack as addStorageStoredStack,
  durabilityForItem,
  emptyPlayerStorage,
  type AddStoredStackResult,
  type Durability,
  type InventoryServiceApi,
} from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'
import { changed, DESPAWNED, UNCHANGED, type Entity, type EntityManagerApi } from '@nerima-games/mc-sim'
import { StackCount } from '../frame-contract'
import {
  DROPPED_ITEM_KIND,
  isDroppedItemBehaviour,
  type MobBehaviour,
  type MobDropEvent,
} from './mob-frame'

export const DROPPED_ITEM_PICKUP_RADIUS = 1.5

export type DroppedItemSpawn = {
  readonly item: ItemType
  readonly count: number
  readonly at: Position
  readonly durability?: Durability | null
  readonly eligibleFromFrame?: number
}

export type DroppedItemSpawnError = Extract<
  AddStoredStackResult,
  { readonly _tag: 'InvalidStack' }
>

const copyDurability = (durability: Durability | null): Durability | null =>
  durability === null ? null : { ...durability }

export const spawnDroppedItem = (
  roster: EntityManagerApi<MobBehaviour>,
  drop: DroppedItemSpawn,
): Effect.Effect<Entity<MobBehaviour>, DroppedItemSpawnError> => {
  const durability =
    drop.durability === undefined ? durabilityForItem(drop.item) : drop.durability
  const stack = {
    item: drop.item,
    count: drop.count as StackCount,
    durability: copyDurability(durability),
  }
  const validation = addStorageStoredStack(emptyPlayerStorage(), stack).result
  if (validation._tag === 'InvalidStack') return Effect.fail(validation)

  return roster.spawn({
    kind: DROPPED_ITEM_KIND,
    feetPosition: drop.at,
    healthPoints: 1,
    behaviour: {
      _tag: 'DroppedItem',
      item: stack.item,
      count: stack.count,
      durability: stack.durability,
      ...(drop.eligibleFromFrame === undefined
        ? {}
        : { eligibleFromFrame: drop.eligibleFromFrame }),
    },
  })
}

export const spawnDroppedItems = (
  roster: EntityManagerApi<MobBehaviour>,
  drops: ReadonlyArray<DroppedItemSpawn>,
): Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>, DroppedItemSpawnError> =>
  Effect.forEach(drops, (drop) => spawnDroppedItem(roster, drop))

export const spawnMobDrop = (
  roster: EntityManagerApi<MobBehaviour>,
  drop: MobDropEvent,
): Effect.Effect<Entity<MobBehaviour>, DroppedItemSpawnError> => spawnDroppedItem(roster, drop)

export const spawnMobDrops = (
  roster: EntityManagerApi<MobBehaviour>,
  drops: ReadonlyArray<MobDropEvent>,
): Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>, DroppedItemSpawnError> =>
  spawnDroppedItems(roster, drops)

const distanceSquared = (left: Position, right: Position): number => {
  const dx = left.x - right.x
  const dy = left.y - right.y
  const dz = left.z - right.z
  return dx * dx + dy * dy + dz * dz
}

const pickupLocks = new WeakMap<
  EntityManagerApi<MobBehaviour>,
  Effect.Semaphore
>()

const pickupLockFor = (roster: EntityManagerApi<MobBehaviour>): Effect.Semaphore => {
  const existing = pickupLocks.get(roster)
  if (existing !== undefined) return existing
  const created = Effect.unsafeMakeSemaphore(1)
  pickupLocks.set(roster, created)
  return created
}

export const pickupDroppedItems = (
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  playerPosition: Position | undefined,
  radius: number = DROPPED_ITEM_PICKUP_RADIUS,
  currentFrame?: number,
): Effect.Effect<void> =>
  pickupLockFor(roster).withPermits(1)(
    Effect.gen(function* () {
      if (playerPosition === undefined || !Number.isFinite(radius) || radius < 0) return

      const leftovers = new Map<
        string,
        { readonly count: number; readonly durability: Durability | null } | null
      >()
      const radiusSquared = radius * radius
      for (const entity of yield* roster.entities) {
        if (
          entity.kind !== DROPPED_ITEM_KIND ||
          !isDroppedItemBehaviour(entity.behaviour) ||
          (currentFrame !== undefined &&
            entity.behaviour.eligibleFromFrame !== undefined &&
            currentFrame < entity.behaviour.eligibleFromFrame) ||
          distanceSquared(entity.feetPosition, playerPosition) > radiusSquared
        ) continue

        const result = yield* inventory.addStoredStack({
          item: entity.behaviour.item,
          count: StackCount(entity.behaviour.count),
          durability: copyDurability(entity.behaviour.durability),
        })
        if (result._tag === 'Added') {
          leftovers.set(entity.id, result.leftover)
        }
      }

      if (leftovers.size === 0) return
      yield* roster.sweep<never>((entity) => {
        const leftover = leftovers.get(entity.id)
        if (leftover === undefined) return { transition: UNCHANGED, emit: undefined }
        if (leftover === null) return { transition: DESPAWNED, emit: undefined }
        const behaviour = entity.behaviour
        /* v8 ignore start -- unreachable while entity ids are unique for a
         * roster's lifetime, which `spawn`'s ever-incrementing serial guarantees
         * (see `test/support/entity-manager-double.ts`'s header) and no caller in
         * this repository's slice violates: `leftover` is only set, above, for an
         * id whose entity already passed `isDroppedItemBehaviour`, and the same
         * id cannot name a second, differently-shaped entity by the time this
         * sweep runs. */
        if (!isDroppedItemBehaviour(behaviour)) return { transition: UNCHANGED, emit: undefined }
        /* v8 ignore stop */
        return {
          transition: changed({
            feetPosition: entity.feetPosition,
            healthPoints: entity.healthPoints,
            behaviour: {
              ...behaviour,
              count: leftover.count,
              durability: copyDurability(leftover.durability),
            },
          }),
          emit: undefined,
        }
      })
    })
  )
