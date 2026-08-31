import type { ItemType } from '@nerima-games/mc-kernel'
import {
  addStoredStack as addStorageStoredStack,
  durabilityForItem,
  emptyPlayerStorage,
  EQUIPMENT_SLOTS,
  type AddStoredStackResult,
  type Durability,
  type InventoryServiceApi,
  type PlayerStorage,
} from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'
import { changed, DESPAWNED, UNCHANGED, type Entity, type EntityManagerApi } from '@nerima-games/mc-sim'
import { StackCount } from '@nerima-games/mc-kernel'
import { decodeEnchantedItem, type Enchantment, type EnchantedItem } from '../enchantment.js'
import {
  DROPPED_ITEM_KIND,
  isDroppedItemBehaviour,
  type MobBehaviour,
  type MobDropEvent,
} from './mob-frame.js'

export const DROPPED_ITEM_PICKUP_RADIUS = 1.5

export type DroppedItemSpawn = {
  readonly item: ItemType
  readonly count: number
  readonly at: Position
  readonly durability?: Durability | null
  readonly eligibleFromFrame?: number
  readonly customName?: string
  readonly enchantments?: ReadonlyArray<Enchantment>
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
      ...(drop.customName === undefined ? {} : { customName: drop.customName }),
      ...(drop.enchantments === undefined ? {} : { enchantments: drop.enchantments.map((e) => ({ ...e })) }),
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

/** Has an item that landed on frame `eligibleFromFrame` sat long enough to be picked up on `currentFrame`? */
export const isDroppedItemPickupEligible = (
  currentFrame: number,
  eligibleFromFrame: number | undefined,
): boolean => eligibleFromFrame === undefined || currentFrame >= eligibleFromFrame

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
            !isDroppedItemPickupEligible(currentFrame, entity.behaviour.eligibleFromFrame)) ||
          distanceSquared(entity.feetPosition, playerPosition) > radiusSquared
        ) continue

        // `result._tag` is always `'Added'`, never asserted on: mc-sim's
        // `addStoredStack` and this file's own `isDroppedItemBehaviour` run the
        // IDENTICAL validation (damageable: count === 1 and a valid durability;
        // otherwise durability === null — `player-storage.js`'s
        // `isValidStoredStack`), and the `continue` guard above already ran
        // `isDroppedItemBehaviour` on this entity. A stack that failed here
        // would have failed there first.
        const result = (yield* inventory.addStoredStack({
          item: entity.behaviour.item,
          count: StackCount(entity.behaviour.count),
          durability: copyDurability(entity.behaviour.durability),
        })) as Extract<AddStoredStackResult, { readonly _tag: 'Added' }>
        leftovers.set(entity.id, result.leftover)
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

export type DroppedItemMetadata = {
  readonly customName?: string
  readonly enchantedItem?: EnchantedItem
}

/**
 * The anvil-rename and enchantment facts an entity's `behaviour` carries once it
 * passes `isDroppedItemBehaviour`. Re-decoded through `decodeEnchantedItem`
 * rather than read off the trusted fields directly, so an item/durability/
 * enchantment combination this repository's own rules could not have produced
 * (a corrupt save, a hand-edited fixture) surfaces as "no enchantment metadata"
 * instead of a value nothing validated. Absent `enchantments` (never dropped
 * with any) and empty `enchantments` (dropped with zero, known) are different
 * facts: only the latter decodes and appears as `enchantedItem`.
 */
export const droppedItemMetadataFromBehaviour = (behaviour: unknown): DroppedItemMetadata => {
  if (!isDroppedItemBehaviour(behaviour)) return {}
  const enchantedItem = decodeEnchantedItem({
    item: behaviour.item,
    durability: behaviour.durability,
    enchantments: behaviour.enchantments,
  })
  return {
    ...(behaviour.customName === undefined ? {} : { customName: behaviour.customName }),
    ...(enchantedItem.ok ? { enchantedItem: enchantedItem.value } : {}),
  }
}

/** How long a dropped item sits before despawning, absent a beacon or other rule that extends it. */
export const DROPPED_ITEM_LIFETIME_SECS = 300

export type DroppedItemLifetimeTracker = {
  readonly elapsed: (dimension: string, entityId: string) => number
  readonly restore: (
    dimension: string,
    entries: ReadonlyArray<{ readonly entityId: string; readonly elapsedSecs: number }>,
  ) => void
  readonly advance: (
    dimension: string,
    deltaSecs: number,
    entityIds: ReadonlyArray<string>,
  ) => ReadonlyArray<string>
}

/**
 * Per-dimension elapsed-lifetime bookkeeping for dropped items, keyed by entity
 * id rather than carried on `DroppedItemBehaviour` itself: the roster only ever
 * holds the entities currently alive, so `advance` uses the frame's live id set
 * to both age existing entries and drop stale ones (an id that despawned or was
 * picked up by another path) in the same pass — a fact no per-entity field can
 * express on its own.
 */
export const createDroppedItemLifetimeTracker = (
  lifetimeSecs: number = DROPPED_ITEM_LIFETIME_SECS,
): DroppedItemLifetimeTracker => {
  const elapsedByDimension = new Map<string, Map<string, number>>()

  return {
    elapsed: (dimension, entityId) => elapsedByDimension.get(dimension)?.get(entityId) ?? 0,
    restore: (dimension, entries) => {
      elapsedByDimension.set(
        dimension,
        new Map(entries.map(({ entityId, elapsedSecs }) => [entityId, Math.max(0, elapsedSecs)])),
      )
    },
    advance: (dimension, deltaSecs, entityIds) => {
      const elapsedByEntity = elapsedByDimension.get(dimension) ?? new Map<string, number>()
      elapsedByDimension.set(dimension, elapsedByEntity)
      const present = new Set(entityIds)
      for (const entityId of elapsedByEntity.keys()) {
        if (!present.has(entityId)) elapsedByEntity.delete(entityId)
      }

      const expired: string[] = []
      for (const entityId of present) {
        const elapsedSecs = (elapsedByEntity.get(entityId) ?? 0) + deltaSecs
        if (elapsedSecs >= lifetimeSecs) {
          elapsedByEntity.delete(entityId)
          expired.push(entityId)
        } else {
          elapsedByEntity.set(entityId, elapsedSecs)
        }
      }
      return expired
    },
  }
}

/**
 * A dying player's custom names and enchantments, keyed the way the caller's
 * own metadata store keys them: an inventory slot by its index (as a string)
 * and an equipment slot by `equipment:<slot>` — this file makes no claim
 * about that store's shape beyond the two lookups it needs, so it takes them
 * as a plain record rather than importing the store itself.
 */
export type PlayerSlotMetadata = {
  readonly customNames: Readonly<Record<string, string>>
  readonly enchantedItems: Readonly<Record<string, EnchantedItem>>
}

const deathDropMetadataForSlot = (
  key: string,
  item: ItemType,
  metadata: PlayerSlotMetadata | undefined,
): Pick<DroppedItemSpawn, 'customName' | 'enchantments'> => {
  if (metadata === undefined) return {}
  const customName = metadata.customNames[key]
  const enchantedItem = metadata.enchantedItems[key]
  // A metadata entry whose `item` no longer matches is stale (the slot was
  // refilled with something else since the entry was recorded) and is
  // dropped rather than attached to the wrong stack.
  const enchantments = enchantedItem?.item === item
    ? enchantedItem.enchantments.map((enchantment) => ({ ...enchantment }))
    : undefined
  return {
    ...(customName === undefined ? {} : { customName }),
    ...(enchantments === undefined ? {} : { enchantments }),
  }
}

/**
 * Everything a dying player's inventory and equipment spill onto the ground,
 * as spawn requests ready for `spawnDroppedItems` — one per occupied slot,
 * empty slots contributing nothing. `keepInventory` (whether to call this at
 * all) is the caller's game-rule decision, not this rule's.
 */
export const deathDropsFromPlayerStorage = (
  storage: PlayerStorage,
  at: Position,
  metadata?: PlayerSlotMetadata,
): ReadonlyArray<DroppedItemSpawn> => {
  const drops: Array<DroppedItemSpawn> = []

  storage.inventory.slots.forEach((stack, index) => {
    if (stack === undefined) return
    const durability = storage.inventoryDurability[index] ?? null
    drops.push({
      item: stack.item,
      count: stack.count,
      at,
      durability: copyDurability(durability),
      ...deathDropMetadataForSlot(String(index), stack.item, metadata),
    })
  })

  for (const slot of EQUIPMENT_SLOTS) {
    const stack = storage.equipment.slots[slot]
    if (stack === null) continue
    drops.push({
      item: stack.item,
      count: stack.count,
      at,
      durability: copyDurability(stack.durability),
      ...deathDropMetadataForSlot(`equipment:${slot}`, stack.item, metadata),
    })
  }

  return drops
}
