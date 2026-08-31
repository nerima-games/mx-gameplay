import { describe, expect, it } from '@effect/vitest'
import { createItemMetadataStore, type ItemMetadataStore } from '../src/domain/item-metadata'
import type { EnchantedItem } from '../src/domain/enchantment'

const enchantedPickaxe: EnchantedItem = {
  item: 'wooden_pickaxe',
  durability: { current: 59, max: 59 },
  enchantments: [{ id: 'unbreaking', level: 1 }],
}

describe('key builders', () => {
  it('droppedItemMetadataKey joins dimension and entity id', () => {
    const store = createItemMetadataStore()
    expect(store.droppedItemMetadataKey('overworld', 'entity-1')).toBe('overworld:entity-1')
  })

  it('equipmentMetadataKey matches the deathDropsFromPlayerStorage convention', () => {
    const store = createItemMetadataStore()
    expect(store.equipmentMetadataKey('head')).toBe('equipment:head')
  })

  describe('containerMetadataKey / containerMetadataLocation round-trip', () => {
    it('round-trips an ordinary container id and slot', () => {
      const store = createItemMetadataStore()
      const key = store.containerMetadataKey('chest-42', 7)
      expect(key).toBe('container:chest-42:7')
      expect(store.containerMetadataLocation(key)).toStrictEqual({ containerId: 'chest-42', slot: 7 })
    })

    it('round-trips a container id that itself contains a colon, anchored on the LAST separator', () => {
      const store = createItemMetadataStore()
      const key = store.containerMetadataKey('overworld:chest-42', 3)
      expect(store.containerMetadataLocation(key)).toStrictEqual({
        containerId: 'overworld:chest-42', slot: 3,
      })
    })

    it('rejects a key with no container prefix', () => {
      const store = createItemMetadataStore()
      expect(store.containerMetadataLocation('equipment:head')).toBeUndefined()
      expect(store.containerMetadataLocation('0')).toBeUndefined()
    })

    it('rejects a container key with no slot separator at all', () => {
      const store = createItemMetadataStore()
      expect(store.containerMetadataLocation('container:onlyid')).toBeUndefined()
    })

    it('rejects a non-integer or negative slot', () => {
      const store = createItemMetadataStore()
      expect(store.containerMetadataLocation('container:chest:abc')).toBeUndefined()
      expect(store.containerMetadataLocation('container:chest:-1')).toBeUndefined()
      expect(store.containerMetadataLocation('container:chest:1.5')).toBeUndefined()
    })
  })
})

describe('sameItemMetadata', () => {
  it('is true for two keys with no metadata at all', () => {
    const store = createItemMetadataStore()
    expect(store.sameItemMetadata('0', '1')).toBe(true)
  })

  it('is true when both keys share the same custom name and enchantments', () => {
    const store = createItemMetadataStore()
    store.customNames.set('0', 'Old Faithful')
    store.customNames.set('1', 'Old Faithful')
    store.enchantedItems.set('0', enchantedPickaxe)
    store.enchantedItems.set('1', { ...enchantedPickaxe })
    expect(store.sameItemMetadata('0', '1')).toBe(true)
  })

  it('is false when only one key has a custom name', () => {
    const store = createItemMetadataStore()
    store.customNames.set('0', 'Old Faithful')
    expect(store.sameItemMetadata('0', '1')).toBe(false)
  })

  it('is false when the enchantments differ', () => {
    const store = createItemMetadataStore()
    store.enchantedItems.set('0', enchantedPickaxe)
    store.enchantedItems.set('1', { ...enchantedPickaxe, enchantments: [] })
    expect(store.sameItemMetadata('0', '1')).toBe(false)
  })
})

describe('copyItemMetadata / moveItemMetadata / deleteItemMetadata', () => {
  const seeded = (): ItemMetadataStore => {
    const store = createItemMetadataStore()
    store.customNames.set('0', 'Old Faithful')
    store.enchantedItems.set('0', enchantedPickaxe)
    return store
  }

  it('copies both a present name and present enchantments onto the target', () => {
    const store = seeded()
    store.copyItemMetadata('0', '1')
    expect(store.customNames.get('1')).toBe('Old Faithful')
    expect(store.enchantedItems.get('1')).toStrictEqual(enchantedPickaxe)
    // Source is untouched by a copy.
    expect(store.customNames.get('0')).toBe('Old Faithful')
  })

  it('copying an EMPTY source clears whatever metadata the target had', () => {
    const store = seeded()
    store.customNames.set('1', 'Stale Name')
    store.enchantedItems.set('1', enchantedPickaxe)
    store.copyItemMetadata('empty-source', '1')
    expect(store.customNames.has('1')).toBe(false)
    expect(store.enchantedItems.has('1')).toBe(false)
  })

  it('moveItemMetadata copies onto the target and clears the source', () => {
    const store = seeded()
    store.moveItemMetadata('0', '1')
    expect(store.customNames.get('1')).toBe('Old Faithful')
    expect(store.enchantedItems.get('1')).toStrictEqual(enchantedPickaxe)
    expect(store.customNames.has('0')).toBe(false)
    expect(store.enchantedItems.has('0')).toBe(false)
  })

  it('deleteItemMetadata clears both maps for exactly one key', () => {
    const store = seeded()
    store.customNames.set('1', 'Untouched')
    store.deleteItemMetadata('0')
    expect(store.customNames.has('0')).toBe(false)
    expect(store.enchantedItems.has('0')).toBe(false)
    expect(store.customNames.get('1')).toBe('Untouched')
  })
})

describe('deleteContainerMetadata', () => {
  it('drops every slot of the named container and leaves other containers and plain slots alone', () => {
    const store = createItemMetadataStore()
    const a0 = store.containerMetadataKey('chest-a', 0)
    const a1 = store.containerMetadataKey('chest-a', 1)
    const b0 = store.containerMetadataKey('chest-b', 0)
    store.customNames.set(a0, 'A0')
    store.enchantedItems.set(a1, enchantedPickaxe)
    store.customNames.set(b0, 'B0')
    store.customNames.set('0', 'Inventory Slot 0')

    store.deleteContainerMetadata('chest-a')

    expect(store.customNames.has(a0)).toBe(false)
    expect(store.enchantedItems.has(a1)).toBe(false)
    expect(store.customNames.get(b0)).toBe('B0')
    expect(store.customNames.get('0')).toBe('Inventory Slot 0')
  })

  it('is a no-op for a container with no recorded metadata', () => {
    const store = createItemMetadataStore()
    store.customNames.set('0', 'Untouched')
    store.deleteContainerMetadata('nonexistent')
    expect(store.customNames.get('0')).toBe('Untouched')
  })
})

describe('droppedItemMetadata', () => {
  it('is an independent map from the equipment/inventory/container metadata', () => {
    const store = createItemMetadataStore()
    const key = store.droppedItemMetadataKey('overworld', 'entity-1')
    store.droppedItemMetadata.set(key, { customName: 'Old Faithful' })
    expect(store.droppedItemMetadata.get(key)).toStrictEqual({ customName: 'Old Faithful' })
    expect(store.customNames.has(key)).toBe(false)
  })
})
