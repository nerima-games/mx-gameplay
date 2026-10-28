import { describe, expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  equipmentItem,
  itemStack,
  type Equipment,
  type EquipmentItem,
  type EquipmentSlot,
} from '@nerima-games/mc-sim'
import {
  applyArmorToDamage,
  ArmorHitResolutionSchema,
  armorDurabilityWearFromPreMitigationDamage,
  armorToughnessForEquipment,
  armorPointsForEquipment,
  prepareArmorHit,
  resolveArmorHit,
} from '../src/domain/combat/armor'

const armourItem = (item: EquipmentItem['item']): EquipmentItem =>
  Result.getOrThrow(equipmentItem(Result.getOrThrow(itemStack(item, 1))))

const equipmentWith = (
  items: Partial<Record<EquipmentSlot, EquipmentItem>> = {},
): Equipment => ({
  slots: {
    head: items.head ?? null,
    chest: items.chest ?? null,
    legs: items.legs ?? null,
    feet: items.feet ?? null,
    offhand: items.offhand ?? null,
  },
})

const ARMOR_SOURCE = 'https://minecraft.wiki/w/Armor'
const ARMOR_EDITION = 'Java Edition 26.3'

describe('armor damage reduction', () => {
  it('assigns no points when no armour is equipped', () => {
    expect(armorPointsForEquipment(equipmentWith())).toBe(0)
  })

  it.each([
    ['head', 'iron_helmet', 2],
    ['chest', 'iron_chestplate', 6],
    ['legs', 'iron_leggings', 5],
    ['feet', 'iron_boots', 2],
  ] as const)('assigns iron armour points for the %s slot', (slot, item, points) => {
    expect(armorPointsForEquipment(equipmentWith({ [slot]: armourItem(item) }))).toBe(points)
  })

  it(`matches the Java Edition armor formula (${ARMOR_SOURCE}, ${ARMOR_EDITION})`, () => {
    const equipment = equipmentWith({
      head: armourItem('iron_helmet'),
      chest: armourItem('iron_chestplate'),
      legs: armourItem('iron_leggings'),
      feet: armourItem('iron_boots'),
    })

    expect(armorPointsForEquipment(equipment)).toBe(15)
    expect(applyArmorToDamage({ amount: 10, cause: 'mob' }, 15)).toEqual({
      amount: 6,
      cause: 'mob',
    })
  })

  it('ignores iron armour in the offhand', () => {
    const equipmentWithInvalidOffhand = equipmentWith({
      offhand: armourItem('iron_helmet'),
    })

    expect(armorPointsForEquipment(equipmentWithInvalidOffhand)).toBe(0)
  })

  it.each([
    ['head', 'iron_boots'],
    ['chest', 'iron_helmet'],
    ['legs', 'iron_chestplate'],
    ['feet', 'iron_leggings'],
  ] as const)('ignores iron armour placed in the wrong %s slot', (slot, item) => {
    expect(armorPointsForEquipment(equipmentWith({ [slot]: armourItem(item) }))).toBe(0)
  })

  it('caps effective armor points at 20', () => {
    const atCap = applyArmorToDamage({ amount: 10, cause: 'explosion' }, 20)
    const aboveCap = applyArmorToDamage({ amount: 10, cause: 'explosion' }, 200)

    expect(atCap.amount).toBeCloseTo(4)
    expect(atCap.cause).toBe('explosion')
    expect(aboveCap.amount).toBeCloseTo(2)
    expect(aboveCap.cause).toBe('explosion')
  })

  it.each([
    [0, 10],
    [Number.POSITIVE_INFINITY, 2],
  ] as const)('clamps armour points %s to the supported boundary', (points, expectedAmount) => {
    const result = applyArmorToDamage({ amount: 10, cause: 'projectile' }, points)

    expect(result.amount).toBeCloseTo(expectedAmount)
    expect(result.cause).toBe('projectile')
  })

  it.each([Number.NaN, -1, Number.NEGATIVE_INFINITY])(
    'treats invalid armour points %s as no protection',
    (points) => {
      expect(applyArmorToDamage({ amount: 7, cause: 'mob' }, points)).toEqual({
        amount: 7,
        cause: 'mob',
      })
    },
  )

  it('preserves the damage cause', () => {
    expect(applyArmorToDamage({ amount: 5, cause: 'lava' }, 2).cause).toBe('lava')
  })
})

describe('armour mitigation by damage cause', () => {
  it.each([
    'fall',
    'drowning',
    'suffocation',
    'starvation',
    'void',
    'ender_pearl',
    'poison',
    'on_fire',
    'generic',
  ] as const)('leaves %s damage unmitigated by full iron armour', (cause) => {
    expect(applyArmorToDamage({ amount: 10, cause }, 15)).toEqual({ amount: 10, cause })
  })

  it.each(['mob', 'projectile', 'explosion', 'in_fire'] as const)(
    'still mitigates %s damage with full iron armour',
    (cause) => {
      const result = applyArmorToDamage({ amount: 10, cause }, 15)
      expect(result.amount).toBeCloseTo(6)
      expect(result.cause).toBe(cause)
    },
  )

  it.each(['cactus', 'lava'] as const)(
    'mitigates %s contact damage exactly like a combat hit, not exempted as environmental',
    (cause) => {
      const result = applyArmorToDamage({ amount: 10, cause }, 15)
      expect(result.amount).toBeCloseTo(6)
      expect(result.cause).toBe(cause)
    },
  )
})

describe('armour mitigation is monotonic in armour points', () => {
  it('resulting damage never increases as armour points increase, for every mitigated cause', () => {
    // A property no fixed table of examples states: whatever the exact curve,
    // more armour must never leave a player worse off. Swept across both the
    // full valid range and past it, for every cause armour actually mitigates.
    for (const cause of ['mob', 'projectile', 'explosion', 'in_fire', 'cactus', 'lava'] as const) {
      let previous = applyArmorToDamage({ amount: 20, cause }, 0).amount
      for (let points = 1; points <= 25; points += 1) {
        const current = applyArmorToDamage({ amount: 20, cause }, points).amount
        expect(current).toBeLessThanOrEqual(previous)
        previous = current
      }
    }
  })
})

describe('armour durability wear from pre-mitigation damage', () => {
  it.each([
    [0, 0],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [0.1, 1],
    [3.99, 1],
    [4, 1],
    [7.99, 1],
    [8, 2],
  ] as const)(
    'returns the expected wear for pre-mitigation amount %s',
    (amount, expectedWear) => {
      expect(armorDurabilityWearFromPreMitigationDamage({ amount, cause: 'mob' })).toBe(
        expectedWear,
      )
    },
  )

  it('does not use the damage cause', () => {
    expect(armorDurabilityWearFromPreMitigationDamage({ amount: 8, cause: 'fall' })).toBe(
      armorDurabilityWearFromPreMitigationDamage({ amount: 8, cause: 'lava' }),
    )
  })
})

describe('armour hit resolution', () => {
  it('returns mitigated damage and wear for every occupied armour slot', () => {
    const equipment = equipmentWith({
      head: armourItem('iron_helmet'),
      chest: armourItem('iron_chestplate'),
    })

    const resolved = resolveArmorHit(equipment, { amount: 8, cause: 'mob' })

    expect(resolved.damage.amount).toBeCloseTo(6.72)
    expect({ ...resolved, damage: { ...resolved.damage, amount: 6.72 } }).toStrictEqual({
      damage: { amount: 6.72, cause: 'mob' },
      durabilityWear: 2,
      wornSlots: ['head', 'chest'],
    })
  })

  it('does not report the offhand as armour durability', () => {
    expect(
      resolveArmorHit(equipmentWith({ offhand: armourItem('iron_helmet') }), {
        amount: 3,
        cause: 'mob',
      }),
    ).toStrictEqual({
      damage: { amount: 3, cause: 'mob' },
      durabilityWear: 1,
      wornSlots: [],
    })
  })
})

describe('diamond and netherite armor', () => {
  it(`uses Java Edition armor values (${ARMOR_SOURCE}, ${ARMOR_EDITION})`, () => {
    const diamond = equipmentWith({
      head: armourItem('diamond_helmet'),
      chest: armourItem('diamond_chestplate'),
      legs: armourItem('diamond_leggings'),
      feet: armourItem('diamond_boots'),
    })
    const netherite = equipmentWith({
      head: armourItem('netherite_helmet'),
      chest: armourItem('netherite_chestplate'),
      legs: armourItem('netherite_leggings'),
      feet: armourItem('netherite_boots'),
    })

    expect(armorPointsForEquipment(diamond)).toBe(20)
    expect(armorToughnessForEquipment(diamond)).toBe(8)
    expect(armorPointsForEquipment(netherite)).toBe(20)
    expect(armorToughnessForEquipment(netherite)).toBe(12)
    expect(applyArmorToDamage({ amount: 10, cause: 'mob' }, 20, 8).amount).toBeCloseTo(3)
  })
})

describe('validated armor hit preparation', () => {
  it('decodes every successful result with the public strict schema', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: -1e6, max: 1e6, noNaN: false, noDefaultInfinity: false }),
        (amount) => {
          const result = prepareArmorHit(equipmentWith(), { amount, cause: 'mob' })
          if (Result.isFailure(result)) return true
          const decoded = Schema.decodeUnknownResult(ArmorHitResolutionSchema, {
            onExcessProperty: 'error',
          })(result.success)
          return Result.isSuccess(decoded) &&
            Number.isFinite(decoded.success.damage.amount) &&
            decoded.success.damage.amount > 0 &&
            decoded.success.durabilityWear >= 0
        },
      ),
      { numRuns: 250 },
    )
  })

  it('leaves the equipment snapshot unchanged on invalid input', () => {
    const equipment = equipmentWith({ head: armourItem('iron_helmet') })
    const before = JSON.stringify(equipment)
    const result = prepareArmorHit(equipment, { amount: Number.NaN, cause: 'mob' })

    expect(Result.isFailure(result)).toBe(true)
    expect(JSON.stringify(equipment)).toBe(before)
  })
})
