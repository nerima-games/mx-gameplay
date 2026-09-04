import { describe, expect, it } from '@effect/vitest'
import { durabilityForItem } from '@nerima-games/mc-sim'

import {
  ENCHANTMENT_REGISTRY,
  applyEnchantmentOffer,
  armorDamageWithEnchantments,
  bowDamageWithEnchantments,
  decodeEnchantedItem,
  decodeEnchantedItemSnapshot,
  durabilityWearWithEnchantments,
  enchantmentAppliesTo,
  enchantmentOffer,
  enchantmentOffers,
  enchantmentsConflict,
  encodeEnchantedItem,
  fortuneDropCountWithEnchantments,
  meleeDamageWithEnchantments,
  miningSpeedWithEnchantments,
  rerollEnchantmentSeed,
  snapshotEnchantedItem,
  validateEnchantedItem,
  type EnchantedItem,
  type EnchantmentId,
  type EnchantmentOffer,
} from '../src/domain/enchantment'

const enchantedItem = (
  item: EnchantedItem['item'],
  id?: EnchantmentId,
  level = 1,
): EnchantedItem => ({
  item,
  durability: durabilityForItem(item),
  enchantments: id === undefined ? [] : [{ id, level }],
})

const compatibleOffer = (item: EnchantedItem['item']): EnchantmentOffer => {
  for (let seed = 0; seed < 10_000; seed += 1) {
    for (const offer of enchantmentOffers(seed, 15)) {
      if (enchantmentAppliesTo(offer.enchantment.id, item)) return offer
    }
  }
  throw new Error(`no compatible offer for ${item}`)
}

const compatibleOfferExcluding = (
  item: EnchantedItem['item'],
  excludedId: EnchantmentId,
): EnchantmentOffer => {
  for (let seed = 0; seed < 10_000; seed += 1) {
    for (const offer of enchantmentOffers(seed, 15)) {
      if (offer.enchantment.id !== excludedId && enchantmentAppliesTo(offer.enchantment.id, item)) {
        return offer
      }
    }
  }
  throw new Error(`no compatible offer for ${item} excluding ${excludedId}`)
}

describe('enchantment registry', () => {
  it('defines caps, targets and vanilla conflicts', () => {
    expect(Object.fromEntries(Object.entries(ENCHANTMENT_REGISTRY).map(([id, entry]) => [id, entry.maxLevel]))).toEqual({
      protection: 4,
      sharpness: 5,
      efficiency: 5,
      unbreaking: 3,
      fortune: 3,
      power: 5,
    })
    expect(enchantmentAppliesTo('protection', 'iron_chestplate')).toBe(true)
    expect(enchantmentAppliesTo('sharpness', 'diamond_sword')).toBe(true)
    expect(enchantmentAppliesTo('efficiency', 'iron_pickaxe')).toBe(true)
    expect(enchantmentAppliesTo('fortune', 'diamond_hoe')).toBe(true)
    expect(enchantmentAppliesTo('power', 'bow')).toBe(true)
    expect(enchantmentAppliesTo('unbreaking', 'flint_and_steel')).toBe(true)
    expect(enchantmentAppliesTo('power', 'iron_sword')).toBe(false)
    expect(enchantmentsConflict('protection', 'fire_protection')).toBe(true)
    expect(enchantmentsConflict('sharpness', 'smite')).toBe(true)
    expect(enchantmentsConflict('fortune', 'silk_touch')).toBe(true)
    expect(enchantmentsConflict('efficiency', 'fortune')).toBe(false)
    expect(enchantmentsConflict('protection', 'protection')).toBe(false)
    expect(enchantmentsConflict('fire_protection', 'protection')).toBe(true)
  })
})

describe('enchanted item codec', () => {
  it('canonicalizes order and round-trips item, durability and enchantments', () => {
    const input = {
      item: 'diamond_pickaxe',
      durability: durabilityForItem('diamond_pickaxe'),
      enchantments: [
        { id: 'fortune', level: 3 },
        { id: 'efficiency', level: 5 },
        { id: 'unbreaking', level: 3 },
      ],
    } as const
    const snapshot = snapshotEnchantedItem(input)
    expect(snapshot).toEqual({
      ok: true,
      value: {
        ...input,
        enchantments: [
          { id: 'efficiency', level: 5 },
          { id: 'unbreaking', level: 3 },
          { id: 'fortune', level: 3 },
        ],
      },
    })
    if (!snapshot.ok) throw new Error('expected valid snapshot')
    const encoded = encodeEnchantedItem(snapshot.value)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) throw new Error('expected encoded item')
    expect(decodeEnchantedItemSnapshot(encoded.encoded)).toEqual(snapshot)
  })

  it.each([
    [{ item: 'missing', durability: null, enchantments: [] }, 'item'],
    [{ item: 'bow', durability: null, enchantments: [] }, 'durability'],
    [{ item: 'stick', durability: { current: 1, max: 1 }, enchantments: [] }, 'durability'],
    [{ item: 'bow', enchantments: [] }, 'durability'],
    // A durability RECORD whose `current`/`max` are not both numbers — distinct
    // from the case above, where `durability` is absent entirely. `isRecord`
    // passes but the object shape inside it does not.
    [{ item: 'bow', durability: { current: 'x', max: 10 }, enchantments: [] }, 'durability'],
    [{ item: 'bow', durability: durabilityForItem('bow'), enchantments: 'nope' }, 'enchantments'],
    [{ item: 'bow', durability: durabilityForItem('bow'), enchantments: [null] }, 'enchantments.0'],
    [
      { item: 'bow', durability: durabilityForItem('bow'), enchantments: [{ id: 'bogus', level: 1 }] },
      'enchantments.0.id',
    ],
    [
      { item: 'bow', durability: durabilityForItem('bow'), enchantments: [{ id: 'power', level: 6 }] },
      'enchantments.0.level',
    ],
    [
      {
        item: 'bow',
        durability: durabilityForItem('bow'),
        enchantments: [
          { id: 'power', level: 1 },
          { id: 'power', level: 2 },
        ],
      },
      'enchantments.1.id',
    ],
    [
      { item: 'bow', durability: durabilityForItem('bow'), enchantments: [{ id: 'fortune', level: 1 }] },
      'enchantments.0.id',
    ],
  ])('rejects invalid payload %#', (value, path) => {
    const result = decodeEnchantedItem(value)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected invalid item')
    expect(result.issues.map((issue) => issue.path)).toContain(path)
  })

  it('rejects malformed snapshot JSON without throwing', () => {
    expect(decodeEnchantedItemSnapshot('{')).toEqual({
      ok: false,
      issues: [{ path: '$', reason: 'must be valid JSON' }],
    })
  })

  it('rejects a non-record top-level value, and validateEnchantedItem mirrors decode as a type guard', () => {
    expect(decodeEnchantedItem(null)).toEqual({
      ok: false,
      issues: [{ path: '$', reason: 'must be an object' }],
    })
    expect(validateEnchantedItem(null)).toBe(false)
    expect(
      validateEnchantedItem({
        item: 'diamond_pickaxe',
        durability: durabilityForItem('diamond_pickaxe'),
        enchantments: [],
      }),
    ).toBe(true)
  })

  it('round-trips a non-damageable item with null durability', () => {
    expect(decodeEnchantedItem({ item: 'stick', durability: null, enchantments: [] })).toEqual({
      ok: true,
      value: { item: 'stick', durability: null, enchantments: [] },
    })
  })

  it('surfaces snapshot issues through encodeEnchantedItem instead of encoding', () => {
    const encoded = encodeEnchantedItem({ item: 'diamond_sword', durability: null, enchantments: [] })
    expect(encoded.ok).toBe(false)
    if (encoded.ok) throw new Error('expected encode failure')
    expect(encoded.issues.map((issue) => issue.path)).toContain('durability')
  })
})

describe('enchantment table offers and transaction', () => {
  it('derives deterministic offers from normalized seed, shelves and slot', () => {
    expect(enchantmentOffers(1234, 15)).toEqual(enchantmentOffers(1234, 15))
    expect(enchantmentOffer(1234, 99, 2)).toEqual(enchantmentOffer(1234, 15, 2))
    expect(enchantmentOffer(1234, -1, 0)).toEqual(enchantmentOffer(1234, 0, 0))
    expect(enchantmentOffers(1234, 15).map((offer) => offer.lapisCost)).toEqual([1, 2, 3])
    expect(enchantmentOffers(1234, 15).map((offer) => offer.slot)).toEqual([0, 1, 2])
    expect(rerollEnchantmentSeed(1234)).toBe(rerollEnchantmentSeed(1234))
    expect(rerollEnchantmentSeed(1234)).not.toBe(1234)
    expect(enchantmentOffer(Number.NaN, 15, 0).seed).toBe(0)
    expect(enchantmentOffer(1234, Number.NaN, 0).bookshelfCount).toBe(0)
  })

  it('atomically consumes levels and lapis, enchants the item and rerolls the seed', () => {
    const offer = compatibleOffer('diamond_sword')
    const state = {
      seed: offer.seed,
      bookshelfCount: offer.bookshelfCount,
      playerLevel: 30,
      lapis: 3,
      item: enchantedItem('diamond_sword'),
    } as const
    const result = applyEnchantmentOffer(state, offer)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected successful transaction')
    expect(result.state.playerLevel).toBe(30 - offer.lapisCost)
    expect(result.state.lapis).toBe(3 - offer.lapisCost)
    expect(result.state.seed).toBe(rerollEnchantmentSeed(offer.seed))
    expect(result.state.item?.enchantments).toContainEqual(offer.enchantment)
    expect(state.item.enchantments).toEqual([])
  })

  it('rejects no item, forged offers, incompatible items and insufficient resources without mutation', () => {
    const swordOffer = compatibleOffer('diamond_sword')
    const base = {
      seed: swordOffer.seed,
      bookshelfCount: swordOffer.bookshelfCount,
      playerLevel: 30,
      lapis: 3,
      item: enchantedItem('diamond_sword'),
    }
    const cases = [
      [{ ...base, item: null }, swordOffer, 'no_item'],
      [base, { ...swordOffer, requiredPlayerLevel: swordOffer.requiredPlayerLevel + 1 }, 'invalid_offer'],
      [{ ...base, item: enchantedItem('bow') }, swordOffer, 'incompatible_item'],
      [{ ...base, playerLevel: swordOffer.requiredPlayerLevel - 1 }, swordOffer, 'insufficient_level'],
      [{ ...base, lapis: swordOffer.lapisCost - 1 }, swordOffer, 'insufficient_lapis'],
    ] as const
    for (const [state, offer, reason] of cases) {
      const before = JSON.stringify(state)
      const result = applyEnchantmentOffer(state, offer)
      expect(result).toEqual({ ok: false, state, reason })
      expect(result.state).toBe(state)
      expect(JSON.stringify(state)).toBe(before)
    }
  })

  it('rejects invalid resources and invalid item payloads without mutation', () => {
    const offer = compatibleOffer('diamond_sword')
    const invalidState = {
      seed: offer.seed,
      bookshelfCount: 15,
      playerLevel: Number.NaN,
      lapis: 3,
      item: enchantedItem('diamond_sword'),
    }
    expect(applyEnchantmentOffer(invalidState, offer)).toEqual({
      ok: false,
      state: invalidState,
      reason: 'invalid_state',
    })
    const invalidItemState = {
      ...invalidState,
      playerLevel: 30,
      item: { ...enchantedItem('diamond_sword'), durability: null },
    }
    expect(applyEnchantmentOffer(invalidItemState, offer)).toEqual({
      ok: false,
      state: invalidItemState,
      reason: 'invalid_item',
    })
  })

  it('rejects an offer forged with an out-of-range slot without regenerating the expected offer', () => {
    const swordOffer = compatibleOffer('diamond_sword')
    const base = {
      seed: swordOffer.seed,
      bookshelfCount: swordOffer.bookshelfCount,
      playerLevel: 30,
      lapis: 3,
      item: enchantedItem('diamond_sword'),
    }
    const forgedSlotOffer = { ...swordOffer, slot: 5 } as unknown as EnchantmentOffer
    expect(applyEnchantmentOffer(base, forgedSlotOffer)).toEqual({
      ok: false,
      state: base,
      reason: 'invalid_offer',
    })
  })

  it('adds a second compatible enchantment to an item that already carries one', () => {
    const offer = compatibleOfferExcluding('diamond_sword', 'unbreaking')
    const state = {
      seed: offer.seed,
      bookshelfCount: offer.bookshelfCount,
      playerLevel: 30,
      lapis: 3,
      item: enchantedItem('diamond_sword', 'unbreaking', 3),
    }
    const result = applyEnchantmentOffer(state, offer)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected successful transaction')
    expect(result.state.item?.enchantments).toContainEqual({ id: 'unbreaking', level: 3 })
    expect(result.state.item?.enchantments).toContainEqual(offer.enchantment)
  })
})

describe('enchantment derivations', () => {
  it('applies sharpness and power with inert invalid bases', () => {
    expect(meleeDamageWithEnchantments(7, enchantedItem('diamond_sword', 'sharpness', 5))).toBe(10)
    expect(meleeDamageWithEnchantments(Number.NaN, enchantedItem('diamond_sword', 'sharpness', 1))).toBe(1)
    expect(meleeDamageWithEnchantments(5, enchantedItem('diamond_sword'))).toBe(5)
    expect(bowDamageWithEnchantments(9, enchantedItem('bow', 'power', 5))).toBe(23)
    expect(bowDamageWithEnchantments(-10, enchantedItem('bow', 'power', 5))).toBe(0)
    // An unenchanted bow must agree with the plain base damage — unlike
    // sharpness and efficiency above, this had no test of its own, and a
    // zero level being read as "at least level 1" (e.g. `level || 1`) would
    // give every unenchanted bow shot a silent 1.5x Power I bonus.
    expect(bowDamageWithEnchantments(9, enchantedItem('bow'))).toBe(9)
  })

  it('stacks armor then clamps protection to twenty levels', () => {
    const armor = [
      enchantedItem('iron_helmet', 'protection', 4),
      enchantedItem('iron_chestplate', 'protection', 4),
      enchantedItem('iron_leggings', 'protection', 4),
      enchantedItem('iron_boots', 'protection', 4),
    ]
    expect(armorDamageWithEnchantments({ amount: 10, cause: 'mob' }, 15, armor)).toEqual({
      amount: 1.44,
      cause: 'mob',
    })
    expect(
      armorDamageWithEnchantments({ amount: 10, cause: 'mob' }, 0, [...armor, ...armor]).amount,
    ).toBeCloseTo(2)
    // Unenchanted armour must contribute zero protection each, not zero
    // total by coincidence — every armour piece above carries protection 4,
    // so a per-item fallback of "no protection reads as level 1" would still
    // pass those two assertions. An unenchanted four-piece set isolates it:
    // any positive contribution per unenchanted piece changes this amount.
    const unenchantedArmor = armor.map((item) => ({ ...item, enchantments: [] }))
    expect(
      armorDamageWithEnchantments({ amount: 10, cause: 'mob' }, 15, unenchantedArmor),
    ).toEqual({ amount: 4, cause: 'mob' })
  })

  it('applies efficiency and clamps invalid mining bases', () => {
    const tool = enchantedItem('diamond_pickaxe', 'efficiency', 5)
    expect(miningSpeedWithEnchantments(8, tool)).toBe(34)
    expect(miningSpeedWithEnchantments(Number.NaN, tool)).toBe(27)
    expect(miningSpeedWithEnchantments(8, enchantedItem('diamond_pickaxe'))).toBe(8)
  })

  it('uses one injected roll per durability point and conservatively applies missing or invalid rolls', () => {
    const tool = enchantedItem('diamond_pickaxe', 'unbreaking', 3)
    expect(durabilityWearWithEnchantments(5, tool, [0, 0.74, 0.75, 0.99, Number.NaN])).toBe(3)
    expect(durabilityWearWithEnchantments(-1, tool, [])).toBe(0)
    expect(durabilityWearWithEnchantments(3, enchantedItem('diamond_pickaxe'), [])).toBe(3)
    expect(durabilityWearWithEnchantments(Number.NaN, tool, [])).toBe(0)
  })

  it('uses deterministic Fortune rolls and clamps invalid base counts', () => {
    const tool = enchantedItem('diamond_pickaxe', 'fortune', 3)
    expect(fortuneDropCountWithEnchantments(1, tool, 0.1)).toBe(3)
    expect(fortuneDropCountWithEnchantments(1, tool, 0.9)).toBe(2)
    expect(fortuneDropCountWithEnchantments(Number.NaN, tool, 0)).toBe(0)
    expect(fortuneDropCountWithEnchantments(2.9, enchantedItem('diamond_pickaxe'), 0)).toBe(2)
  })
})
