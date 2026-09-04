import type { Equipment, EquipmentSlot } from '@nerima-games/mc-sim'
import type { Damage, DeathCause } from '../death-cause.js'

const MAX_ARMOR_POINTS = 20
const DAMAGE_REDUCTION_PER_ARMOR_POINT = 0.04

/**
 * `DeathCause`s whose damage ignores armour's per-point mitigation entirely,
 * matching vanilla's bypasses-armor damage-type tag. This is a narrower list
 * than "environmental": touching a damaging block (lava, cactus, `in_fire`) IS
 * mitigated by armour, same as a sword hit — only these are the exception, and
 * each was checked individually rather than inferred from a shared "not
 * combat" theme.
 *
 * `in_fire` and `on_fire` used to be one undifferentiated `'fire'` cause,
 * produced by both standing-in-the-fire-block contact (armour-mitigated in
 * vanilla) and the burning-over-time tick after leaving it (armour-bypassing
 * in vanilla). `fire-lifecycle.ts`'s `advanceBurningActors` now assigns the
 * cause per tick from whether the actor is still inside a fire cell, so
 * `on_fire` belongs here and `in_fire` does not.
 */
const CAUSES_BYPASSING_ARMOR: ReadonlySet<DeathCause> = new Set<DeathCause>([
  'fall',
  'drowning',
  'suffocation',
  'starvation',
  'void',
  'ender_pearl',
  'poison',
  'on_fire',
  'generic',
])

const WORN_ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const
// Compile-time-only validation, kept off the declaration above: line 54 below
// reads `(typeof WORN_ARMOR_SLOTS)[number]` for its narrow 4-member union, and
// an explicit `: ReadonlyArray<EquipmentSlot>` annotation would widen it.
WORN_ARMOR_SLOTS satisfies ReadonlyArray<EquipmentSlot>

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
  if (CAUSES_BYPASSING_ARMOR.has(damage.cause)) return damage

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
