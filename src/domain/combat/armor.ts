import { DamageAmountSchema } from '@nerima-games/mc-kernel'
import type { Equipment, EquipmentSlot } from '@nerima-games/mc-sim'
import { Result, Schema } from 'effect'
import type { Damage, DeathCause } from '../death-cause.js'
import { enchantmentProtectionFactor, type EnchantmentDamageCategory, type EnchantmentSource } from '../enchantment.js'
import { applyArmorPointsToDamage, type ArmorPoints } from './armor-mitigation.js'

const WORN_ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const
// Compile-time-only validation, kept off the declaration above: line 54 below
// reads `(typeof WORN_ARMOR_SLOTS)[number]` for its narrow 4-member union, and
// an explicit `: ReadonlyArray<EquipmentSlot>` annotation would widen it.
WORN_ARMOR_SLOTS satisfies ReadonlyArray<EquipmentSlot>

const ARMOR_ITEMS = {
  iron: {
    head: { item: 'iron_helmet', points: 2, toughness: 0 },
    chest: { item: 'iron_chestplate', points: 6, toughness: 0 },
    legs: { item: 'iron_leggings', points: 5, toughness: 0 },
    feet: { item: 'iron_boots', points: 2, toughness: 0 },
  },
  diamond: {
    head: { item: 'diamond_helmet', points: 3, toughness: 2 },
    chest: { item: 'diamond_chestplate', points: 8, toughness: 2 },
    legs: { item: 'diamond_leggings', points: 6, toughness: 2 },
    feet: { item: 'diamond_boots', points: 3, toughness: 2 },
  },
  netherite: {
    head: { item: 'netherite_helmet', points: 3, toughness: 3 },
    chest: { item: 'netherite_chestplate', points: 8, toughness: 3 },
    legs: { item: 'netherite_leggings', points: 6, toughness: 3 },
    feet: { item: 'netherite_boots', points: 3, toughness: 3 },
  },
} as const

const armorTier = (item: string): 'iron' | 'diamond' | 'netherite' | undefined => {
  if (item.startsWith('iron_')) return 'iron'
  if (item.startsWith('diamond_')) return 'diamond'
  if (item.startsWith('netherite_')) return 'netherite'
  return undefined
}

const protectionCategoryForCause = (cause: DeathCause): EnchantmentDamageCategory => {
  switch (cause) {
    case 'lava':
    case 'in_fire':
    case 'on_fire':
      return 'fire'
    case 'explosion':
      return 'explosion'
    case 'projectile':
      return 'projectile'
    case 'fall':
    case 'ender_pearl':
      return 'fall'
    case 'starvation':
    case 'void':
    case 'generic':
      return 'unprotected'
    default:
      return 'generic'
  }
}

const enchantmentSourcesForEquipment = (equipment: Equipment): ReadonlyArray<EnchantmentSource> =>
  WORN_ARMOR_SLOTS.flatMap((slot) => {
    const source = equipment.slots[slot]?.components?.enchantments
    return source === undefined ? [] : [source]
  })

/** Sum the protection supplied by correctly slotted iron, diamond, and netherite armour. */
export const armorPointsForEquipment = (equipment: Equipment): ArmorPoints => {
  let points = 0

  for (const slot of WORN_ARMOR_SLOTS) {
    const equipped = equipment.slots[slot]
    if (equipped === null) continue
    const tier = armorTier(equipped.item)
    const rule = tier === undefined ? undefined : ARMOR_ITEMS[tier][slot]
    if (rule !== undefined && equipped.item === rule.item) points += rule.points
  }

  return points as ArmorPoints
}

/** Sum armor toughness from correctly slotted diamond and netherite pieces. */
export const armorToughnessForEquipment = (equipment: Equipment): number => {
  let toughness = 0
  for (const slot of WORN_ARMOR_SLOTS) {
    const equipped = equipment.slots[slot]
    if (equipped === null) continue
    const tier = armorTier(equipped.item)
    const rule = tier === undefined ? undefined : ARMOR_ITEMS[tier][slot]
    if (rule !== undefined && equipped.item === rule.item) toughness += rule.toughness
  }
  return toughness
}

/** Apply Java Edition's armor and toughness damage formula. */
export const applyArmorToDamage = (
  damage: Damage,
  armorPoints: number,
  toughness = 0,
  enchantmentSources: ReadonlyArray<EnchantmentSource> = [],
  damageMultiplier = 1,
): Damage => {
  const afterArmor = applyArmorPointsToDamage(damage, armorPoints as ArmorPoints, toughness)
  const afterEnchantments = afterArmor.amount * enchantmentProtectionFactor(
    enchantmentSources,
    protectionCategoryForCause(damage.cause),
  )
  return {
    amount: afterEnchantments * Math.max(0, Math.min(1, damageMultiplier)),
    cause: damage.cause,
  }
}

/**
 * Return armour durability wear for one hit from its pre-mitigation damage amount.
 * The damage cause does not affect this rule.
 */
export const armorDurabilityWearFromPreMitigationDamage = (damage: Damage): number => {
  if (!Number.isFinite(damage.amount) || damage.amount <= 0) return 0

  return Math.max(1, Math.floor(damage.amount / 4))
}

export type ArmorHitResolution = {
  readonly damage: Damage
  readonly durabilityWear: number
  readonly wornSlots: ReadonlyArray<(typeof WORN_ARMOR_SLOTS)[number]>
}

export const ArmorHitResolutionSchema: Schema.ConstraintDecoder<ArmorHitResolution> = Schema.Struct({
  damage: Schema.Struct({
    amount: DamageAmountSchema,
    cause: Schema.Literals([
      'fall', 'lava', 'cactus', 'in_fire', 'on_fire', 'drowning', 'suffocation',
      'starvation', 'mob', 'projectile', 'explosion', 'void', 'ender_pearl', 'poison', 'generic',
    ]),
  }),
  durabilityWear: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  wornSlots: Schema.Array(Schema.Literals(WORN_ARMOR_SLOTS)),
})

export type ArmorHitPreparation = Result.Result<ArmorHitResolution, 'invalid-damage' | 'invalid-armor'>

/** Validate and prepare one armor hit without mutating equipment or health. */
export const prepareArmorHit = (
  equipment: Equipment,
  damage: Damage,
  damageMultiplier = 1,
): ArmorHitPreparation => {
  if (!Number.isFinite(damage.amount) || damage.amount <= 0) return Result.fail('invalid-damage')
  if (!Number.isFinite(damageMultiplier) || damageMultiplier <= 0 || damageMultiplier > 1) {
    return Result.fail('invalid-damage')
  }
  const resolved = {
    damage: applyArmorToDamage(
      damage,
      armorPointsForEquipment(equipment),
      armorToughnessForEquipment(equipment),
      enchantmentSourcesForEquipment(equipment),
      damageMultiplier,
    ),
    durabilityWear: armorDurabilityWearFromPreMitigationDamage(damage),
    wornSlots: WORN_ARMOR_SLOTS.filter((slot) => equipment.slots[slot] !== null),
  }
  const decoded = Schema.decodeUnknownResult(ArmorHitResolutionSchema, {
    onExcessProperty: 'error',
  })(resolved)
  return Result.isFailure(decoded) ? Result.fail('invalid-armor') : Result.succeed(decoded.success)
}

/** Resolve one hit against the equipment snapshot that exists before that hit. */
export const resolveArmorHit = (equipment: Equipment, damage: Damage): ArmorHitResolution => ({
  damage: applyArmorToDamage(
    damage,
    armorPointsForEquipment(equipment),
    armorToughnessForEquipment(equipment),
    enchantmentSourcesForEquipment(equipment),
  ),
  durabilityWear: armorDurabilityWearFromPreMitigationDamage(damage),
  wornSlots: WORN_ARMOR_SLOTS.filter((slot) => equipment.slots[slot] !== null),
})
