/**
 * `deathDropsFromPlayerStorage` — lowered from the composing app's
 * `player-death.ts` into `domain/entities/dropped-item.ts`, since it builds
 * exactly this file's own `DroppedItemSpawn` records (which already carry the
 * optional `customName`/`enchantments` fields this function needs — see the
 * dropped-item-metadata tests for where those two joined).
 */
import { describe, expect, it } from '@effect/vitest'
import {
  emptyEquipment,
  emptyPlayerStorage,
  equip,
  equipmentItem,
  itemStack,
  withInventory,
  type Inventory,
  type ItemStack,
  type PlayerStorage,
} from '@nerima-games/mc-sim'
import { deathDropsFromPlayerStorage, type PlayerSlotMetadata } from '../src/domain/entities/dropped-item'

const at = { x: 1, y: 2, z: 3 }

const storageWith = (
  slots: Inventory['slots'],
  equipItem?: { readonly slot: 'head'; readonly item: ItemStack },
): PlayerStorage => {
  const base = withInventory(emptyPlayerStorage(), { slots })
  if (equipItem === undefined) return base
  const equipped = equip(emptyEquipment(), equipItem.slot, equipmentItem(equipItem.item))
  return { ...base, equipment: equipped.equipment }
}

describe('deathDropsFromPlayerStorage', () => {
  it('is empty for empty inventory and equipment', () => {
    expect(deathDropsFromPlayerStorage(emptyPlayerStorage(), at)).toStrictEqual([])
  })

  it('drops one entry per occupied inventory slot, skipping empty ones', () => {
    const slots: Inventory['slots'] = [itemStack('gunpowder', 3), undefined, itemStack('stick', 1)]
    const drops = deathDropsFromPlayerStorage(storageWith(slots), at)

    expect(drops).toStrictEqual([
      { item: 'gunpowder', count: 3, at, durability: null },
      { item: 'stick', count: 1, at, durability: null },
    ])
  })

  it('drops equipped items, and leaves an empty equipment slot uncounted', () => {
    const drops = deathDropsFromPlayerStorage(
      storageWith([], { slot: 'head', item: itemStack('iron_helmet', 1) }),
      at,
    )

    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({ item: 'iron_helmet', count: 1, at })
    expect(drops[0]?.durability).not.toBeNull()
  })

  it('attaches a matching custom name and enchantment from the slot metadata', () => {
    const slots: Inventory['slots'] = [itemStack('wooden_pickaxe', 1)]
    const metadata: PlayerSlotMetadata = {
      customNames: { '0': 'Old Faithful' },
      enchantedItems: {
        '0': { item: 'wooden_pickaxe', durability: null, enchantments: [{ id: 'unbreaking', level: 1 }] },
      },
    }

    const drops = deathDropsFromPlayerStorage(storageWith(slots), at, metadata)

    expect(drops[0]).toMatchObject({
      customName: 'Old Faithful',
      enchantments: [{ id: 'unbreaking', level: 1 }],
    })
  })

  it('drops stale metadata whose recorded item no longer matches the slot', () => {
    const slots: Inventory['slots'] = [itemStack('stick', 1)]
    const metadata: PlayerSlotMetadata = {
      customNames: {},
      enchantedItems: {
        '0': { item: 'wooden_pickaxe', durability: null, enchantments: [{ id: 'unbreaking', level: 1 }] },
      },
    }

    const drops = deathDropsFromPlayerStorage(storageWith(slots), at, metadata)

    expect(drops[0]?.enchantments).toBeUndefined()
  })

  it('keys equipment metadata as `equipment:<slot>`, distinct from inventory index keys', () => {
    const metadata: PlayerSlotMetadata = {
      customNames: { 'equipment:head': 'Old Faithful', '0': 'Wrong Slot' },
      enchantedItems: {},
    }

    const drops = deathDropsFromPlayerStorage(
      storageWith([], { slot: 'head', item: itemStack('iron_helmet', 1) }),
      at,
      metadata,
    )

    expect(drops[0]?.customName).toBe('Old Faithful')
  })
})
