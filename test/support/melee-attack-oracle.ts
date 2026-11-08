type ExpectedMeleeDamageState = {
  lastDamageTick: number
  lastDamageAmount: number
}

const WEAPON_DAMAGE: Readonly<Record<string, number>> = {
  wooden_sword: 4,
  gold_sword: 4,
  stone_sword: 5,
  iron_sword: 6,
  diamond_sword: 7,
  netherite_sword: 8,
  wooden_axe: 7,
  gold_axe: 7,
  stone_axe: 9,
  iron_axe: 9,
  diamond_axe: 9,
  netherite_axe: 10,
  wooden_pickaxe: 2,
  gold_pickaxe: 2,
  stone_pickaxe: 3,
  iron_pickaxe: 4,
  diamond_pickaxe: 5,
  netherite_pickaxe: 6,
  wooden_shovel: 2.5,
  gold_shovel: 2.5,
  stone_shovel: 3.5,
  iron_shovel: 4.5,
  diamond_shovel: 5.5,
  netherite_shovel: 6.5,
  wooden_hoe: 1,
  gold_hoe: 1,
  stone_hoe: 1,
  iron_hoe: 1,
  diamond_hoe: 1,
  netherite_hoe: 1,
}

const WEAPON_ATTACK_SPEED: Readonly<Record<string, number>> = {
  wooden_sword: 1.6,
  gold_sword: 1.6,
  stone_sword: 1.6,
  iron_sword: 1.6,
  diamond_sword: 1.6,
  netherite_sword: 1.6,
  wooden_axe: 0.8,
  gold_axe: 1,
  stone_axe: 0.8,
  iron_axe: 0.9,
  diamond_axe: 1,
  netherite_axe: 1,
  wooden_pickaxe: 1.2,
  gold_pickaxe: 1.2,
  stone_pickaxe: 1.2,
  iron_pickaxe: 1.2,
  diamond_pickaxe: 1.2,
  netherite_pickaxe: 1.2,
  wooden_shovel: 1,
  gold_shovel: 1,
  stone_shovel: 1,
  iron_shovel: 1,
  diamond_shovel: 1,
  netherite_shovel: 1,
  wooden_hoe: 1,
  gold_hoe: 1,
  stone_hoe: 2,
  iron_hoe: 3,
  diamond_hoe: 4,
  netherite_hoe: 4,
}

export const expectedMeleeAttack = ({
  heldItem,
  ticksSinceLastAttack,
  critical,
  tick,
  targetDamageState,
}: {
  heldItem: string | null
  ticksSinceLastAttack: number
  critical: boolean
  tick: number
  targetDamageState: { lastDamageTick: number; lastDamageAmount: number } | null
}): {
  appliedAmount: number
  targetDamageState: ExpectedMeleeDamageState
} | null => {
  if (
    !Number.isSafeInteger(ticksSinceLastAttack) || ticksSinceLastAttack < 0 ||
    !Number.isSafeInteger(tick) || tick < 0
  ) return null

  const baseDamage = heldItem === null ? 1 : WEAPON_DAMAGE[heldItem]
  const attackSpeed = heldItem === null ? 4 : WEAPON_ATTACK_SPEED[heldItem]
  if (baseDamage === undefined || attackSpeed === undefined) return null

  const attackStrength = Math.min(1, (ticksSinceLastAttack + 0.5) * attackSpeed / 20)
  const criticalMultiplier = critical && attackStrength >= 0.848 ? 1.5 : 1
  const damage = baseDamage * (0.2 + 0.8 * attackStrength ** 2) * criticalMultiplier

  if (targetDamageState !== null) {
    if (
      !Number.isSafeInteger(targetDamageState.lastDamageTick) || targetDamageState.lastDamageTick < 0 ||
      targetDamageState.lastDamageTick > tick || !Number.isFinite(targetDamageState.lastDamageAmount) ||
      targetDamageState.lastDamageAmount <= 0
    ) return null

    if (tick - targetDamageState.lastDamageTick < 10) {
      const appliedAmount = damage > targetDamageState.lastDamageAmount
        ? damage - targetDamageState.lastDamageAmount
        : 0
      return appliedAmount > 0
        ? {
            appliedAmount,
            targetDamageState: { ...targetDamageState, lastDamageAmount: damage },
          }
        : null
    }
  }

  return {
    appliedAmount: damage,
    targetDamageState: { lastDamageTick: tick, lastDamageAmount: damage },
  }
}
