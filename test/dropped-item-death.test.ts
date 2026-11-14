/**
 * `deathDropsFromPlayerStorage` — lowered from the composing app's
 * `player-death.ts` into `domain/entities/dropped-item.ts`, since it builds
 * exactly this file's own `DroppedItemSpawn` records (which already carry the
 * optional `customName`/`enchantments` fields this function needs — see the
 * dropped-item-metadata tests for where those two joined).
 */
import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import * as FastCheck from 'fast-check'
import { position as atPosition } from './support/coordinate-fixtures'
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

const makeItemStack = (item: Parameters<typeof itemStack>[0], count: number): ItemStack =>
  Result.getOrThrow(itemStack(item, count))
const equipmentItemOrThrow = (stack: ItemStack) => Result.getOrThrow(equipmentItem(stack))
const equipState = (...args: Parameters<typeof equip>) => equip(...args).equipment

const at = atPosition(1, 2, 3 )

const storageWith = (
  slots: Inventory['slots'],
  equipItem?: { readonly slot: 'head'; readonly item: ItemStack },
): PlayerStorage => {
  const base = Result.getOrThrow(withInventory(emptyPlayerStorage(), { slots }))
  if (equipItem === undefined) return base
  const equipment = equipState(emptyEquipment(), equipItem.slot, equipmentItemOrThrow(equipItem.item))
  return { ...base, equipment }
}

describe('deathDropsFromPlayerStorage', () => {
  it('is empty for empty inventory and equipment', () => {
    expect(deathDropsFromPlayerStorage(emptyPlayerStorage(), at)).toStrictEqual(Result.succeed([]))
  })

  it('drops one entry per occupied inventory slot, skipping empty ones', () => {
    const slots: Inventory['slots'] = [makeItemStack('gunpowder', 3), undefined, makeItemStack('stick', 1)]
    const drops = Result.getOrThrow(deathDropsFromPlayerStorage(storageWith(slots), at))

    expect(drops).toStrictEqual([
      { item: 'gunpowder', count: 3, at, durability: null },
      { item: 'stick', count: 1, at, durability: null },
    ])
  })

  it('drops equipped items, and leaves an empty equipment slot uncounted', () => {
    const drops = Result.getOrThrow(deathDropsFromPlayerStorage(
      storageWith([], { slot: 'head', item: makeItemStack('iron_helmet', 1) }),
      at,
    ))

    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({ item: 'iron_helmet', count: 1, at })
    expect(drops[0]?.durability).not.toBeNull()
  })

  it('drops every occupied equipment slot, not only head', () => {
    // The prior case only ever equips 'head', so a mutant that iterated a
    // single slot (or the wrong subset of EQUIPMENT_SLOTS) still passed the
    // whole suite — chest/legs/feet/offhand items would silently stay on the
    // corpse. This fills all five and checks each survives to a drop.
    let equipment = emptyEquipment()
    equipment = equipState(equipment, 'head', equipmentItemOrThrow(makeItemStack('iron_helmet', 1)))
    equipment = equipState(equipment, 'chest', equipmentItemOrThrow(makeItemStack('iron_chestplate', 1)))
    equipment = equipState(equipment, 'legs', equipmentItemOrThrow(makeItemStack('iron_leggings', 1)))
    equipment = equipState(equipment, 'feet', equipmentItemOrThrow(makeItemStack('iron_boots', 1)))
    equipment = equipState(equipment, 'offhand', equipmentItemOrThrow(makeItemStack('shears', 1)))
    const storage: PlayerStorage = { ...emptyPlayerStorage(), equipment }

    const drops = Result.getOrThrow(deathDropsFromPlayerStorage(storage, at))

    expect(drops.map((drop) => drop.item).sort()).toStrictEqual(
      ['iron_boots', 'iron_chestplate', 'iron_helmet', 'iron_leggings', 'shears'].sort(),
    )
  })

  it('attaches a matching custom name and enchantment from the slot metadata', () => {
    const slots: Inventory['slots'] = [makeItemStack('wooden_pickaxe', 1)]
    const metadata: PlayerSlotMetadata = {
      customNames: { '0': 'Old Faithful' },
      enchantedItems: {
        '0': { item: 'wooden_pickaxe', durability: null, enchantments: [{ id: 'unbreaking', level: 1 }] },
      },
    }

    const drops = Result.getOrThrow(deathDropsFromPlayerStorage(storageWith(slots), at, metadata))

    expect(drops[0]).toMatchObject({
      customName: 'Old Faithful',
      enchantments: [{ id: 'unbreaking', level: 1 }],
    })
  })

  it('drops stale metadata whose recorded item no longer matches the slot', () => {
    const slots: Inventory['slots'] = [makeItemStack('stick', 1)]
    const metadata: PlayerSlotMetadata = {
      customNames: {},
      enchantedItems: {
        '0': { item: 'wooden_pickaxe', durability: null, enchantments: [{ id: 'unbreaking', level: 1 }] },
      },
    }

    const drops = Result.getOrThrow(deathDropsFromPlayerStorage(storageWith(slots), at, metadata))

    expect(drops[0]?.enchantments).toBeUndefined()
  })

  it('returns typed failures for explicit undefined player metadata entries', () => {
    const slots: Inventory['slots'] = [makeItemStack('stick', 1)]
    const metadata = {
      customNames: { '0': undefined },
      enchantedItems: {},
    } as unknown as PlayerSlotMetadata

    expect(deathDropsFromPlayerStorage(storageWith(slots), at, metadata)).toStrictEqual(Result.fail({
      _tag: 'InvalidPlayerSlotMetadata',
      field: 'customName',
    }))
  })

  it('distinguishes an omitted optional metadata argument from explicit undefined', () => {
    expect(deathDropsFromPlayerStorage(emptyPlayerStorage(), at)).toStrictEqual(Result.succeed([]))
    expect(deathDropsFromPlayerStorage(emptyPlayerStorage(), at, undefined)).toStrictEqual(Result.fail({
      _tag: 'InvalidPlayerSlotMetadata',
      field: 'metadata',
    }))
  })

  it('keys equipment metadata as `equipment:<slot>`, distinct from inventory index keys', () => {
    const metadata: PlayerSlotMetadata = {
      customNames: { 'equipment:head': 'Old Faithful', '0': 'Wrong Slot' },
      enchantedItems: {},
    }

    const drops = Result.getOrThrow(deathDropsFromPlayerStorage(
      storageWith([], { slot: 'head', item: makeItemStack('iron_helmet', 1) }),
      at,
      metadata,
    ))

    expect(drops[0]?.customName).toBe('Old Faithful')
  })

  it('returns a typed failure when an occupied slot has no durability entry', () => {
    const stack = makeItemStack('iron_sword', 1)
    const storage: PlayerStorage = {
      ...storageWith([stack]),
      inventoryDurability: [],
    }

    expect(deathDropsFromPlayerStorage(storage, at)).toStrictEqual(Result.fail({
      _tag: 'InvalidInventoryDurability',
      slotIndex: 0,
      item: stack.item,
    }))
  })

  it('returns typed outcomes for arbitrary inventory durability prefixes', () => {
    const stack = makeItemStack('iron_sword', 1)
    const base = storageWith([stack])

    FastCheck.assert(
      FastCheck.property(FastCheck.array(FastCheck.constant(null)), (inventoryDurability) => {
        const storage: PlayerStorage = { ...base, inventoryDurability }
        const result = deathDropsFromPlayerStorage(storage, at)
        return inventoryDurability.length === 0
          ? Result.isFailure(result) && result.failure._tag === 'InvalidInventoryDurability'
          : Result.isSuccess(result) && result.success.length === 1
      }),
      { numRuns: 100, seed: 70403 },
    )
  })
})
