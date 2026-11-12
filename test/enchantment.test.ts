import { describe, expect, it } from '@effect/vitest'
import { durabilityForItem } from '@nerima-games/mc-sim'
import { RandomSeed } from '@nerima-games/mc-kernel'
import {
  SUPPORTED_VANILLA_ENCHANTMENT_IDS,
  SUPPORTED_VANILLA_ENCHANTMENT_RULES,
} from '@nerima-games/mc-kernel/domain/enchantment'
import {
  isEnchantmentsComponent,
  type EnchantmentsComponent,
} from '@nerima-games/mc-kernel/domain/item-enchantments'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'

import {
  ENCHANTMENT_IDS,
  ENCHANTMENT_REGISTRY,
  applyEnchantmentOffer,
  armorDamageWithEnchantments,
  aquaAffinityEnabled,
  bindingCurseBlocksRemoval,
  bowDamageWithEnchantments,
  decodeEnchantedItem,
  decodeEnchantedItemSnapshot,
  depthStriderLevel,
  durabilityWearWithEnchantments,
  enchantmentComponentOf,
  enchantmentAppliesTo,
  enchantmentLevel,
  enchantmentOffer,
  enchantmentOffers,
  enchantmentProtectionFactor,
  enchantmentTableResultItemOf,
  enchantmentsConflict,
  encodeEnchantedItem,
  fireAspectDurationTicks,
  flameDurationTicks,
  fortuneDropCountWithEnchantments,
  frostWalkerFreezeRadius,
  EnchantmentBookshelfCountSchema,
  generateEnchantmentTableOffersForItem,
  infinityPreventsArrowConsumption,
  lootingLevel,
  luckOfTheSeaLevel,
  lureWaitReductionTicks,
  mendOneItemFromExperience,
  mendingDurabilityRepairPoints,
  meleeDamageWithEnchantments,
  miningSpeedWithEnchantments,
  knockbackLevel,
  punchKnockbackBonus,
  respirationAirConsumptionChance,
  respirationBonusAirTicks,
  rerollEnchantmentSeed,
  silkTouchEnabled,
  snapshotEnchantedItem,
  sweepingEdgeDamageMultiplier,
  soulSpeedLevel,
  swiftSneakLevel,
  thornsRetaliationChance,
  vanishingCurseRemovesOnDeath,
  validateEnchantedItem,
  type EnchantedItem,
  type EnchantmentId,
  type EnchantmentOffer,
  type MendingRepairCandidate,
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

const component = (
  entries: ReadonlyArray<readonly [EnchantmentId, number]>,
): EnchantmentsComponent =>
  Object.fromEntries(entries.map(([id, level]) => [`minecraft:${id}`, level])) as unknown as EnchantmentsComponent

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

const conflictingOfferFor = (
  item: EnchantedItem['item'],
  existingId: EnchantmentId,
): EnchantmentOffer => {
  for (let seed = 0; seed < 10_000; seed += 1) {
    for (const offer of enchantmentOffers(seed, 15)) {
      if (
        enchantmentAppliesTo(offer.enchantment.id, item) &&
        enchantmentsConflict(offer.enchantment.id, existingId)
      ) {
        return offer
      }
    }
  }
  throw new Error(`no conflicting offer for ${item} and ${existingId}`)
}

describe('enchantment registry', () => {
  it('represents every shared 26.3 enchantment rule and preserves exact applicability', () => {
    expect(ENCHANTMENT_IDS).toHaveLength(43)
    expect(Object.keys(ENCHANTMENT_REGISTRY).sort()).toEqual([...SUPPORTED_VANILLA_ENCHANTMENT_IDS].sort())
    expect(
      SUPPORTED_VANILLA_ENCHANTMENT_RULES.every(
        (rule) => ENCHANTMENT_REGISTRY[rule.id].maxLevel === rule.maxLevel,
      ),
    ).toBe(true)
    for (const rule of SUPPORTED_VANILLA_ENCHANTMENT_RULES) {
      for (const item of rule.applicableItems) expect(enchantmentAppliesTo(rule.id, item)).toBe(true)
    }
    expect(ENCHANTMENT_REGISTRY.breach.applicableItems).toEqual([])
    expect(enchantmentAppliesTo('breach', 'iron_sword')).toBe(false)
    expect(ENCHANTMENT_REGISTRY.impaling.applicableItems).toEqual([])
    expect(enchantmentAppliesTo('impaling', 'iron_sword')).toBe(false)
    expect(
      decodeEnchantedItem({
        item: 'iron_sword',
        durability: durabilityForItem('iron_sword'),
        enchantments: [{ id: 'breach', level: 1 }],
      }),
    ).toEqual({
      ok: false,
      issues: [{ path: 'enchantments.0.id', reason: 'does not apply to this item' }],
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
    expect(enchantmentsConflict('mending', 'infinity')).toBe(true)
    expect(enchantmentsConflict('depth_strider', 'frost_walker')).toBe(true)
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
          { id: 'fortune', level: 3 },
          { id: 'unbreaking', level: 3 },
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
      { item: 'bow', durability: durabilityForItem('bow'), enchantments: [{ id: 'power', level: 0 }] },
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
    [
      { item: 'iron_sword', durability: durabilityForItem('iron_sword'), enchantments: [{ id: 'breach', level: 1 }] },
      'enchantments.0.id',
    ],
    [
      {
        item: 'bow',
        durability: durabilityForItem('bow'),
        enchantments: [
          { id: 'mending', level: 1 },
          { id: 'infinity', level: 1 },
        ],
      },
      'enchantments.1.id',
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
  it('uses mc-sim enchantment-table rules with a repeatable gameplay seed', () => {
    const seed = RandomSeed(1234)
    const bookshelfCount = Schema.decodeUnknownSync(EnchantmentBookshelfCountSchema)(15)
    const offers = generateEnchantmentTableOffersForItem('diamond_pickaxe', seed, bookshelfCount)
    const repeated = generateEnchantmentTableOffersForItem('diamond_pickaxe', seed, bookshelfCount)

    expect(offers._tag).toBe('Success')
    expect(repeated).toEqual(offers)
    if (offers._tag !== 'Success') return

    expect(offers.success.map((offer) => offer?.lapisCost)).toEqual([1, 2, 3])
    expect(offers.success.every((offer) => offer !== undefined)).toBe(true)
    expect(enchantmentTableResultItemOf('book')).toBe('enchanted_book')
  })

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

  it('rejects a mutually exclusive offer without changing the item or resources', () => {
    const offer = conflictingOfferFor('diamond_sword', 'sharpness')
    const state = {
      seed: offer.seed,
      bookshelfCount: offer.bookshelfCount,
      playerLevel: 30,
      lapis: 3,
      item: enchantedItem('diamond_sword', 'sharpness', 1),
    }
    expect(applyEnchantmentOffer(state, offer)).toEqual({
      ok: false,
      state,
      reason: 'conflicting_enchantment',
    })
  })
})

describe('enchantment derivations', () => {
  // These independent arithmetic expectations are for Vanilla Java Edition 26.3.
  // Sources: Sharpness/Smite/Bane https://minecraft.wiki/w/Attack_cooldown#Enchanted_values
  // Power https://minecraft.wiki/w/Power; protection EPF https://minecraft.wiki/w/Armor#Protection_enchantments
  // Efficiency https://minecraft.wiki/w/Breaking; Unbreaking https://minecraft.wiki/w/Unbreaking
  // Fortune https://minecraft.wiki/w/Fortune; Mending https://minecraft.wiki/w/Mending
  // Sweeping Edge https://minecraft.wiki/w/Sweeping_Edge; other utility effects:
  // https://minecraft.wiki/w/Fire_Aspect https://minecraft.wiki/w/Respiration
  // https://minecraft.wiki/w/Frost_Walker https://minecraft.wiki/w/Lure
  // https://minecraft.wiki/w/Thorns https://minecraft.wiki/w/Curse_of_Binding
  // https://minecraft.wiki/w/Curse_of_Vanishing https://minecraft.wiki/w/Depth_Strider
  // https://minecraft.wiki/w/Soul_Speed https://minecraft.wiki/w/Swift_Sneak
  it('applies sharpness and power with inert invalid bases', () => {
    expect(meleeDamageWithEnchantments(7, enchantedItem('diamond_sword', 'sharpness', 5))).toBe(
      7 + 0.5 * 5 + 0.5,
    )
    expect(meleeDamageWithEnchantments(Number.NaN, enchantedItem('diamond_sword', 'sharpness', 1))).toBe(1)
    expect(meleeDamageWithEnchantments(5, enchantedItem('diamond_sword'))).toBe(5)
    expect(bowDamageWithEnchantments(9, enchantedItem('bow', 'power', 5))).toBe(
      Math.ceil(9 * (1 + 0.25 * (5 + 1))),
    )
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
    // At ten damage, fifteen armor points with zero toughness leave six
    // damage; Protection IV on four pieces then reduces that by 64%.
    expect(armorDamageWithEnchantments({ amount: 10, cause: 'mob' }, 15, armor)).toEqual({
      amount: 2.16,
      cause: 'mob',
    })
    expect(
      armorDamageWithEnchantments({ amount: 10, cause: 'mob' }, 0, [...armor, ...armor]).amount,
    ).toBeCloseTo(2)
    expect(
      enchantmentProtectionFactor(
        [...armor, enchantedItem('iron_helmet', 'protection', 4)],
        'generic',
      ),
    ).toBe(1 - 20 / 25)
    // Unenchanted armour must contribute zero protection each, not zero
    // total by coincidence — every armour piece above carries protection 4,
    // so a per-item fallback of "no protection reads as level 1" would still
    // pass those two assertions. An unenchanted four-piece set isolates it:
    // any positive contribution per unenchanted piece changes this amount.
    const unenchantedArmor = armor.map((item) => ({ ...item, enchantments: [] }))
    expect(
      armorDamageWithEnchantments({ amount: 10, cause: 'mob' }, 15, unenchantedArmor),
    ).toEqual({ amount: 6, cause: 'mob' })
    expect(enchantmentProtectionFactor(armor, 'generic')).toBe(1 - 16 / 25)
    expect(
      enchantmentProtectionFactor(
        [enchantedItem('iron_chestplate', 'fire_protection', 4)],
        'fire',
      ),
    ).toBe(1 - 8 / 25)
    expect(
      enchantmentProtectionFactor(
        [enchantedItem('iron_chestplate', 'blast_protection', 3)],
        'explosion',
      ),
    ).toBe(1 - 6 / 25)
    expect(
      enchantmentProtectionFactor(
        [enchantedItem('iron_chestplate', 'projectile_protection', 4)],
        'projectile',
      ),
    ).toBe(1 - 8 / 25)
    expect(
      enchantmentProtectionFactor(
        [enchantedItem('iron_boots', 'feather_falling', 4)],
        'fall',
      ),
    ).toBe(1 - 12 / 25)
    expect(
      armorDamageWithEnchantments({ amount: 10, cause: 'fall' }, 15, [
        enchantedItem('iron_boots', 'feather_falling', 4),
      ]),
    ).toEqual({ amount: 5.2, cause: 'fall' })
    expect(enchantmentProtectionFactor(armor, 'unprotected')).toBe(1)
  })

  it('applies efficiency and clamps invalid mining bases', () => {
    const tool = enchantedItem('diamond_pickaxe', 'efficiency', 5)
    expect(miningSpeedWithEnchantments(8, tool)).toBe(34)
    expect(miningSpeedWithEnchantments(Number.NaN, tool)).toBe(27)
    expect(miningSpeedWithEnchantments(8, tool, false)).toBe(8)
    expect(miningSpeedWithEnchantments(8, enchantedItem('diamond_pickaxe'))).toBe(8)
  })

  it('uses one injected roll per durability point and conservatively applies missing or invalid rolls', () => {
    const tool = enchantedItem('diamond_pickaxe', 'unbreaking', 3)
    expect(durabilityWearWithEnchantments(5, tool, [0, 0.74, 0.75, 0.99, Number.NaN])).toBe(3)
    const armor = enchantedItem('iron_chestplate', 'unbreaking', 3)
    expect(durabilityWearWithEnchantments(3, armor, [0, 0.299, 0.3])).toBe(1)
    expect(durabilityWearWithEnchantments(1, tool, [-Number.EPSILON])).toBe(1)
    expect(durabilityWearWithEnchantments(1, tool, [1])).toBe(1)
    expect(durabilityWearWithEnchantments(-1, tool, [])).toBe(0)
    expect(durabilityWearWithEnchantments(3, enchantedItem('diamond_pickaxe'), [])).toBe(3)
    expect(durabilityWearWithEnchantments(Number.NaN, tool, [])).toBe(0)
  })

  it('uses deterministic Fortune rolls and clamps invalid base counts', () => {
    const tool = enchantedItem('diamond_pickaxe', 'fortune', 3)
    expect(fortuneDropCountWithEnchantments(1, tool, 0)).toBe(1)
    expect(fortuneDropCountWithEnchantments(1, tool, 0.399999999)).toBe(1)
    expect(fortuneDropCountWithEnchantments(1, tool, 0.4)).toBe(2)
    expect(fortuneDropCountWithEnchantments(1, tool, 0.6)).toBe(3)
    expect(fortuneDropCountWithEnchantments(1, tool, 0.8)).toBe(4)
    expect(fortuneDropCountWithEnchantments(2, tool, 0.8)).toBe(8)
    expect(fortuneDropCountWithEnchantments(1, tool, -Number.EPSILON)).toBe(1)
    expect(fortuneDropCountWithEnchantments(1, tool, 1)).toBe(1)
    expect(fortuneDropCountWithEnchantments(Number.NaN, tool, 0)).toBe(0)
    expect(fortuneDropCountWithEnchantments(2.9, enchantedItem('diamond_pickaxe'), 0)).toBe(2)
  })

  it('resolves matching damage enchantments and ignores mismatched mob categories', () => {
    const smite = enchantedItem('diamond_sword', 'smite', 3)
    const bane = enchantedItem('diamond_sword', 'bane_of_arthropods', 2)
    expect(meleeDamageWithEnchantments(7, smite, 'undead')).toBe(7 + 2.5 * 3)
    expect(meleeDamageWithEnchantments(7, smite, 'arthropod')).toBe(7)
    expect(meleeDamageWithEnchantments(7, bane, 'arthropod')).toBe(7 + 2.5 * 2)
    expect(meleeDamageWithEnchantments(7, bane, 'undead')).toBe(7)
  })

  it('reads short ids and namespaced kernel component keys', () => {
    const item = enchantedItem('bow', 'power', 2)
    const kernelComponent = Result.getOrThrow(enchantmentComponentOf(item))
    expect(kernelComponent).toEqual({ 'minecraft:power': 2 })
    expect(enchantmentLevel(kernelComponent, 'power')).toBe(2)
    expect(enchantmentLevel(component([['power', 2]]), 'power')).toBe(2)
    expect(enchantmentLevel(component([['power', 0]]), 'power')).toBe(0)
    expect(enchantmentLevel(component([['power', 255]]), 'power')).toBe(255)
    expect(
      enchantmentLevel({ 'minecraft:power': 256 } as unknown as EnchantmentsComponent, 'power'),
    ).toBe(0)
  })

  it('builds kernel components through the checked enchantment constructor', () => {
    const componentOfLevel = (level: number) =>
      enchantmentComponentOf({
        item: 'bow',
        durability: durabilityForItem('bow'),
        enchantments: [{ id: 'power', level }],
      })

    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: -1, max: 256 }), (level) => {
        const result = componentOfLevel(level)
        const withinKernelRange = level >= 0 && level <= 255
        return Result.isFailure(result)
          ? !withinKernelRange
          : withinKernelRange && isEnchantmentsComponent(result.success)
      }),
    )

    expect(Result.isSuccess(componentOfLevel(0))).toBe(true)
    expect(Result.isSuccess(componentOfLevel(255))).toBe(true)
    expect(Result.isFailure(componentOfLevel(-1))).toBe(true)
    expect(Result.isFailure(componentOfLevel(256))).toBe(true)
  })

  it('provides vanilla effect inputs for weapon, fishing, underwater, and utility consumers', () => {
    const sword = component([
      ['fire_aspect', 2],
      ['looting', 3],
      ['knockback', 2],
      ['sweeping_edge', 2],
    ])
    const bow = component([['flame', 1], ['punch', 2], ['infinity', 1]])
    const helmet = component([['respiration', 3], ['aqua_affinity', 1]])
    const boots = component([['frost_walker', 2]])
    const rod = component([['luck_of_the_sea', 3], ['lure', 2]])
    const silkTool = component([['silk_touch', 1]])
    const leggings = component([['swift_sneak', 3], ['binding_curse', 1]])
    const bootsWithMovement = component([['depth_strider', 3], ['soul_speed', 2]])
    const thornsArmor = component([['thorns', 2], ['vanishing_curse', 1]])

    expect(fireAspectDurationTicks(sword)).toBe(2 * 80)
    expect(lootingLevel(sword)).toBe(3)
    expect(knockbackLevel(sword)).toBe(2)
    expect(sweepingEdgeDamageMultiplier(sword)).toBe(2 / 3)
    expect(flameDurationTicks(bow)).toBe(100)
    expect(punchKnockbackBonus(bow)).toBe(3 * 2)
    expect(infinityPreventsArrowConsumption(bow)).toBe(true)
    expect(respirationAirConsumptionChance(helmet)).toBe(1 / 4)
    expect(respirationBonusAirTicks(helmet)).toBe(3 * 300)
    expect(aquaAffinityEnabled(helmet)).toBe(true)
    expect(frostWalkerFreezeRadius(boots)).toBe(2 + 2)
    expect(luckOfTheSeaLevel(rod)).toBe(3)
    expect(lureWaitReductionTicks(rod)).toBe(2 * 100)
    expect(silkTouchEnabled(silkTool)).toBe(true)
    expect(depthStriderLevel(bootsWithMovement)).toBe(3)
    expect(soulSpeedLevel(bootsWithMovement)).toBe(2)
    expect(swiftSneakLevel(leggings)).toBe(3)
    expect(thornsRetaliationChance(thornsArmor)).toBe(0.15 * 2)
    expect(bindingCurseBlocksRemoval(leggings)).toBe(true)
    expect(vanishingCurseRemovesOnDeath(thornsArmor)).toBe(true)
  })

  it('selects one Mending candidate, repairs at two durability per XP and returns unused XP', () => {
    const candidates: ReadonlyArray<MendingRepairCandidate> = [
      {
        slot: 'main_hand',
        durability: { current: 90, max: 100 },
        enchantments: component([['mending', 1]]),
      },
      {
        slot: 'chest',
        durability: { current: 96, max: 100 },
        enchantments: component([['mending', 1]]),
      },
      {
        slot: 'feet',
        durability: { current: 50, max: 100 },
        enchantments: component([['unbreaking', 3]]),
      },
    ]
    const result = mendOneItemFromExperience(candidates, 3, 0.5)
    expect(result).toEqual({
      repairedCandidate: {
        ...candidates[1],
        durability: { current: 100, max: 100 },
      },
      selectedSlot: 'chest',
      xpConsumed: 2,
      xpRemaining: 1,
    })
    expect(candidates[1]?.durability).toEqual({ current: 96, max: 100 })
    expect(mendingDurabilityRepairPoints(3)).toBe(6)
  })

  it('keeps Mending roll bounds half-open and leaves XP untouched without eligible items', () => {
    const eligible: MendingRepairCandidate = {
      slot: 'main_hand',
      durability: { current: 0, max: 10 },
      enchantments: component([['mending', 1]]),
    }
    expect(mendOneItemFromExperience([eligible], 3, 0).selectedSlot).toBe('main_hand')
    expect(mendOneItemFromExperience([eligible], 3, 1 - Number.EPSILON).selectedSlot).toBe(
      'main_hand',
    )
    expect(mendOneItemFromExperience([eligible], 3, -Number.EPSILON)).toEqual({
      repairedCandidate: undefined,
      selectedSlot: undefined,
      xpConsumed: 0,
      xpRemaining: 3,
    })
    expect(mendOneItemFromExperience([eligible], 3, 1)).toEqual({
      repairedCandidate: undefined,
      selectedSlot: undefined,
      xpConsumed: 0,
      xpRemaining: 3,
    })
    expect(mendOneItemFromExperience([], 3, 0)).toEqual({
      repairedCandidate: undefined,
      selectedSlot: undefined,
      xpConsumed: 0,
      xpRemaining: 3,
    })
  })

  it('satisfies independent fast-check properties for public calculations', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: 255 }), (level) => {
        expect(enchantmentLevel(component([['power', level]]), 'power')).toBe(level)
      }),
    )
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 100 }),
        FastCheck.integer({ min: 1, max: 5 }),
        (base, level) => {
          expect(meleeDamageWithEnchantments(base, enchantedItem('diamond_sword', 'sharpness', level))).toBe(
            base + 0.5 * level + 0.5,
          )
        },
      ),
    )
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 100 }),
        FastCheck.integer({ min: 0, max: 5 }),
        (base, level) => {
          const expected = level === 0 ? base : Math.ceil(base * (1 + 0.25 * (level + 1)))
          expect(bowDamageWithEnchantments(base, enchantedItem('bow', level === 0 ? undefined : 'power', level))).toBe(
            expected,
          )
        },
      ),
    )
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 40 }),
        FastCheck.integer({ min: 1, max: 5 }),
        (base, level) => {
          expect(miningSpeedWithEnchantments(base, enchantedItem('diamond_pickaxe', 'efficiency', level))).toBe(
            (base > 0 ? base : 1) + level * level + 1,
          )
          expect(miningSpeedWithEnchantments(base, enchantedItem('diamond_pickaxe', 'efficiency', level), false)).toBe(
            base > 0 ? base : 1,
          )
        },
      ),
    )
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 3 }),
        FastCheck.double({ min: 0, max: 0.999999, noNaN: true }),
        FastCheck.integer({ min: 1, max: 32 }),
        (level, roll, base) => {
          const drops = fortuneDropCountWithEnchantments(
            base,
            enchantedItem('diamond_pickaxe', 'fortune', level),
            roll,
          )
          expect(drops).toBeGreaterThanOrEqual(base)
          expect(drops).toBeLessThanOrEqual(base * (level + 1))
          expect(drops % base).toBe(0)
        },
      ),
    )
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 3 }),
        FastCheck.array(FastCheck.double({ min: 0, max: 0.999999, noNaN: true }), {
          minLength: 0,
          maxLength: 20,
        }),
        (level, rolls) => {
          const threshold = 0.4 * (level / (level + 1))
          const expectedWear = rolls.filter((roll) => roll >= threshold).length
          const armor = enchantedItem('iron_chestplate', 'unbreaking', level)
          expect(durabilityWearWithEnchantments(rolls.length, armor, rolls, 'armor')).toBe(expectedWear)
        },
      ),
    )
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 80 }),
        FastCheck.integer({ min: 0, max: 100 }),
        FastCheck.integer({ min: 1, max: 40 }),
        (missing, current, xp) => {
          const candidate: MendingRepairCandidate = {
            slot: 'main_hand',
            durability: { current, max: current + missing },
            enchantments: component([['mending', 1]]),
          }
          const repaired = Math.min(missing, xp * 2)
          const used = Math.ceil(repaired / 2)
          const result = mendOneItemFromExperience([candidate], xp, 0)
          expect(result.repairedCandidate?.durability?.current).toBe(current + repaired)
          expect(result.xpConsumed).toBe(used)
          expect(result.xpRemaining).toBe(xp - used)
        },
      ),
    )
  })
})
