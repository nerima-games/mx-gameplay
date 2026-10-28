import { DamageAmountSchema } from '@nerima-games/mc-kernel'
import type { Equipment, EquipmentSlot } from '@nerima-games/mc-sim'
import { Result, Schema } from 'effect'
import type { Damage, DeathCause } from '../death-cause.js'

const MAX_ARMOR_POINTS = 20

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

/** Sum the protection supplied by correctly slotted iron, diamond, and netherite armour. */
export const armorPointsForEquipment = (equipment: Equipment): number => {
  let points = 0

  for (const slot of WORN_ARMOR_SLOTS) {
    const equipped = equipment.slots[slot]
    if (equipped === null) continue
    const tier = armorTier(equipped.item)
    const rule = tier === undefined ? undefined : ARMOR_ITEMS[tier][slot]
    if (rule !== undefined && equipped.item === rule.item) points += rule.points
  }

  return points
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
export const applyArmorToDamage = (damage: Damage, armorPoints: number, toughness = 0): Damage => {
  if (CAUSES_BYPASSING_ARMOR.has(damage.cause)) return damage

  const normalizedPoints = Number.isNaN(armorPoints) ? 0 : Math.max(0, armorPoints)
  const normalizedToughness = Number.isNaN(toughness)
    ? 0
    : Math.min(MAX_ARMOR_POINTS, Math.max(0, toughness))
  const effectiveArmor = Math.min(
    MAX_ARMOR_POINTS,
    Math.max(normalizedPoints / 5, normalizedPoints - 4 * damage.amount / (normalizedToughness + 8)),
  )

  return {
    amount: damage.amount * (1 - effectiveArmor / 25),
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
): ArmorHitPreparation => {
  if (!Number.isFinite(damage.amount) || damage.amount <= 0) return Result.fail('invalid-damage')
  const resolved = {
    damage: applyArmorToDamage(damage, armorPointsForEquipment(equipment), armorToughnessForEquipment(equipment)),
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
  damage: applyArmorToDamage(damage, armorPointsForEquipment(equipment), armorToughnessForEquipment(equipment)),
  durabilityWear: armorDurabilityWearFromPreMitigationDamage(damage),
  wornSlots: WORN_ARMOR_SLOTS.filter((slot) => equipment.slots[slot] !== null),
})
