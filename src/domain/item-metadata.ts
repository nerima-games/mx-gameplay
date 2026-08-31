/**
 * Where an item's name and enchantments live, independent of the physical
 * stack that carries them.
 *
 * Lowered from the composing app's `item-metadata-store.ts`. `mc-sim`'s
 * `ItemStack` is `{ item, count }` and nothing else — no room for a custom
 * name or an enchantment list — so a host that wants either has always had to
 * keep them beside the stack rather than on it. This file is that side table
 * and the four location kinds it has to address: a plain inventory slot (keyed
 * by its bare index), an equipment slot, a container slot, and a dropped
 * item's entity id. `entities/dropped-item.ts` already owns the shape of a
 * dropped item's own metadata (`DroppedItemMetadata`) and this file imports it
 * rather than repeating it; the difference between the two is that a dropped
 * item's metadata is read off its `MobBehaviour` directly once spawned, while
 * everything else in this table exists because inventory and container slots
 * carry no behaviour of their own to read it off.
 *
 * `EquipmentSlot` is `@nerima-games/mc-sim`'s (`domain/equipment.ts`), not
 * `mx-ui`'s. Both name the same five slots — `mx-ui`'s copy lives in its
 * `application/inventory-actions.ts`, bundled with click/drag interaction
 * types, i.e. UI presentation vocabulary, not domain vocabulary — but this
 * repository already depends on mc-sim for equipment (`entities/dropped-item.ts`'s
 * `deathDropsFromPlayerStorage` reads `mc-sim`'s `EQUIPMENT_SLOTS` already), so
 * taking the type from there costs no new dependency. Taking it from `mx-ui`
 * would have been a gameplay→ui edge between two Tier-3 siblings for a fact
 * this repository can already name for free.
 */
import type { Dimension } from '@nerima-games/mc-worldgen'
import type { EquipmentSlot } from '@nerima-games/mc-sim'
import type { EnchantedItem } from './enchantment.js'
import type { DroppedItemMetadata } from './entities/dropped-item.js'

export type ItemMetadataStore = {
  readonly customNames: Map<string, string>
  readonly enchantedItems: Map<string, EnchantedItem>
  readonly droppedItemMetadata: Map<string, DroppedItemMetadata>
  readonly droppedItemMetadataKey: (dimension: Dimension, entityId: string) => string
  readonly equipmentMetadataKey: (slot: EquipmentSlot) => string
  readonly containerMetadataKey: (containerId: string, slot: number) => string
  readonly containerMetadataLocation: (
    key: string,
  ) => { readonly containerId: string; readonly slot: number } | undefined
  readonly sameItemMetadata: (left: string, right: string) => boolean
  readonly copyItemMetadata: (source: string, target: string) => void
  readonly deleteItemMetadata: (key: string) => void
  readonly deleteContainerMetadata: (containerId: string) => void
  readonly moveItemMetadata: (source: string, target: string) => void
}

const CONTAINER_KEY_PREFIX = 'container:'

export const createItemMetadataStore = (): ItemMetadataStore => {
  const customNames = new Map<string, string>()
  const enchantedItems = new Map<string, EnchantedItem>()
  const droppedItemMetadata = new Map<string, DroppedItemMetadata>()

  const droppedItemMetadataKey = (dimension: Dimension, entityId: string): string =>
    `${dimension}:${entityId}`
  const equipmentMetadataKey = (slot: EquipmentSlot): string => `equipment:${slot}`
  const containerMetadataKey = (containerId: string, slot: number): string =>
    `${CONTAINER_KEY_PREFIX}${containerId}:${String(slot)}`

  /**
   * The inverse of `containerMetadataKey`. Splits on the LAST `:`, so a
   * `containerId` that itself contains `:` still round-trips — only the slot
   * number, which is known to never contain one, is anchored to the tail.
   */
  const containerMetadataLocation = (
    key: string,
  ): { readonly containerId: string; readonly slot: number } | undefined => {
    if (!key.startsWith(CONTAINER_KEY_PREFIX)) return undefined
    const separator = key.lastIndexOf(':')
    const slot = Number(key.slice(separator + 1))
    if (separator <= CONTAINER_KEY_PREFIX.length || !Number.isInteger(slot) || slot < 0) {
      return undefined
    }
    return { containerId: key.slice(CONTAINER_KEY_PREFIX.length, separator), slot }
  }

  /** Same displayed name and same enchantments — the two facts a stack-merge or a swap must not silently discard. */
  const sameItemMetadata = (left: string, right: string): boolean =>
    customNames.get(left) === customNames.get(right)
    && JSON.stringify(enchantedItems.get(left) ?? null) === JSON.stringify(enchantedItems.get(right) ?? null)

  /**
   * Copies `source`'s metadata onto `target`, INCLUDING copying absence: a
   * `target` that previously had a custom name loses it if `source` does not
   * have one, which is what a slot fully taking on another slot's identity
   * means. `moveItemMetadata` relies on this to also clear the vacated slot.
   */
  const copyItemMetadata = (source: string, target: string): void => {
    const enchantedItem = enchantedItems.get(source)
    const customName = customNames.get(source)
    if (enchantedItem === undefined) enchantedItems.delete(target)
    else enchantedItems.set(target, enchantedItem)
    if (customName === undefined) customNames.delete(target)
    else customNames.set(target, customName)
  }

  const deleteItemMetadata = (key: string): void => {
    enchantedItems.delete(key)
    customNames.delete(key)
  }

  /** Every slot's metadata in one container, dropped together — closing a chest destroys no fewer of them than closing it one slot at a time would. */
  const deleteContainerMetadata = (containerId: string): void => {
    const prefix = `${CONTAINER_KEY_PREFIX}${containerId}:`
    for (const key of [...customNames.keys(), ...enchantedItems.keys()]) {
      if (key.startsWith(prefix)) deleteItemMetadata(key)
    }
  }

  const moveItemMetadata = (source: string, target: string): void => {
    copyItemMetadata(source, target)
    deleteItemMetadata(source)
  }

  return {
    customNames,
    enchantedItems,
    droppedItemMetadata,
    droppedItemMetadataKey,
    equipmentMetadataKey,
    containerMetadataKey,
    containerMetadataLocation,
    sameItemMetadata,
    copyItemMetadata,
    deleteItemMetadata,
    deleteContainerMetadata,
    moveItemMetadata,
  }
}
