import { Brand, Schema } from 'effect'
import type { Damage } from '../death-cause.js'

const MAX_ARMOR_POINTS = 20

export type ArmorPoints = number & Brand.Brand<'ArmorPoints'>
export const ArmorPointsSchema: Schema.Codec<ArmorPoints, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_ARMOR_POINTS }),
).pipe(Schema.brand('ArmorPoints'))

/**
 * These damage causes bypass armor's per-point mitigation entirely. Environmental
 * contact such as lava and cactus remains mitigated; burning after leaving fire
 * is represented by `on_fire` and bypasses armor.
 */
const CAUSES_BYPASSING_ARMOR: ReadonlySet<Damage['cause']> = new Set([
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

/** Apply Java Edition's armor and toughness damage formula. */
export const applyArmorPointsToDamage = (
  damage: Damage,
  armorPoints: ArmorPoints,
  toughness = 0,
): Damage => {
  const normalizedPoints = Number.isNaN(armorPoints) ? 0 : Math.max(0, armorPoints)
  const normalizedToughness = Number.isNaN(toughness)
    ? 0
    : Math.min(MAX_ARMOR_POINTS, Math.max(0, toughness))
  const effectiveArmor = CAUSES_BYPASSING_ARMOR.has(damage.cause)
    ? 0
    : Math.min(
      MAX_ARMOR_POINTS,
      Math.max(normalizedPoints / 5, normalizedPoints - 4 * damage.amount / (normalizedToughness + 8)),
    )

  return {
    amount: damage.amount * (1 - effectiveArmor / 25),
    cause: damage.cause,
  }
}
