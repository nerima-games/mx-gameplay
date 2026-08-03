import type { Equipment, EquipmentSlot } from '@nerima-games/mc-sim'
import type { Damage } from '../death-cause'

const MAX_ARMOR_POINTS = 20
const DAMAGE_REDUCTION_PER_ARMOR_POINT = 0.04

const WORN_ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const satisfies ReadonlyArray<EquipmentSlot>

const IRON_ARMOR_POINTS = {
  head: { item: 'iron_helmet', points: 2 },
  chest: { item: 'iron_chestplate', points: 6 },
  legs: { item: 'iron_leggings', points: 5 },
  feet: { item: 'iron_boots', points: 2 },
} as const

/** Sum the protection supplied by correctly slotted iron armour. */
export const armorPointsForEquipment = (equipment: Equipment): number => {
  let points = 0

  for (const slot of Object.keys(IRON_ARMOR_POINTS) as Array<keyof typeof IRON_ARMOR_POINTS>) {
    const equipped = equipment.slots[slot]
    const rule = IRON_ARMOR_POINTS[slot]
    if (equipped?.item === rule.item) points += rule.points
  }

  return points
}

/** Apply the vanilla-style four-percent reduction per armour point. */
export const applyArmorToDamage = (damage: Damage, armorPoints: number): Damage => {
  const normalizedPoints = Number.isNaN(armorPoints)
    ? 0
    : Math.min(MAX_ARMOR_POINTS, Math.max(0, armorPoints))

  return {
    amount: damage.amount * (1 - normalizedPoints * DAMAGE_REDUCTION_PER_ARMOR_POINT),
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

/** Resolve one hit against the equipment snapshot that exists before that hit. */
export const resolveArmorHit = (equipment: Equipment, damage: Damage): ArmorHitResolution => ({
  damage: applyArmorToDamage(damage, armorPointsForEquipment(equipment)),
  durabilityWear: armorDurabilityWearFromPreMitigationDamage(damage),
  wornSlots: WORN_ARMOR_SLOTS.filter((slot) => equipment.slots[slot] !== null),
})
