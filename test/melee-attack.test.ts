import { describe, expect, it } from '@effect/vitest'
import { meleeDamageForItem } from '../domain/interactions/melee-attack'

describe('melee attack damage', () => {
  it('uses unarmed damage for empty hands and non-swords', () => {
    expect(meleeDamageForItem(undefined)).toBe(1)
    expect(meleeDamageForItem(null)).toBe(1)
    expect(meleeDamageForItem('bow')).toBe(1)
    expect(meleeDamageForItem('diamond_pickaxe')).toBe(1)
  })

  it('maps each sword tier to its melee damage', () => {
    expect(meleeDamageForItem('wooden_sword')).toBe(4)
    expect(meleeDamageForItem('stone_sword')).toBe(5)
    expect(meleeDamageForItem('iron_sword')).toBe(6)
    expect(meleeDamageForItem('diamond_sword')).toBe(7)
  })
})
