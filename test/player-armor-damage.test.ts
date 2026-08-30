import { describe, expect, it } from '@effect/vitest'
import type { Slot } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import { StackCount } from '../src/domain/frame-contract'
import { EntityId } from '@nerima-games/mc-sim'
import { ZOMBIE_KIND, type PlayerDamageEvent } from '../src/domain/mob/hostile-combat'
import { resolveArmoredPlayerDamages } from '../src/stages/registration'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'

const contactDamage = (amount: number): PlayerDamageEvent => ({
  _tag: 'HostileContact',
  source: EntityId('zombie-1'),
  kind: ZOMBIE_KIND,
  at: { x: 0, y: 0, z: 0 },
  damage: { amount, cause: 'mob' },
})

describe('player armour damage integration', () => {
  it.effect('spends no durability for a zero-amount damage event', () =>
    Effect.gen(function* () {
      // `armorDurabilityWearFromPreMitigationDamage` returns 0 only for a
      // non-finite or non-positive `damage.amount` — every other test here
      // uses a positive amount, so `resolveArmorHit`'s `durabilityWear > 0`
      // guard had only ever seen a wear amount above zero.
      const inventory = yield* makeInventoryDouble()

      const damages = yield* resolveArmoredPlayerDamages(inventory.api, [contactDamage(0)])

      expect(damages[0]?.damage.amount).toBe(0)
      expect((yield* inventory.api.storageSnapshot).inventoryDurability.every((slot) => slot === null)).toBe(
        true,
      )
    }),
  )

  it.effect('uses the latest equipment after armour breaks between queued hits', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[0] = { item: 'iron_helmet', count: StackCount(1) } satisfies Slot
      const inventory = yield* makeInventoryDouble(slots)

      yield* inventory.api.equipFromInventory(0, 'head')
      yield* inventory.api.damageAt({ _tag: 'Equipment', slot: 'head' }, 164)

      const damages = yield* resolveArmoredPlayerDamages(inventory.api, [
        contactDamage(8),
        contactDamage(8),
      ])

      expect(damages[0]?.damage.amount).toBeCloseTo(7.36)
      expect(damages[1]?.damage.amount).toBe(8)
      expect((yield* inventory.api.equipmentSnapshot).slots.head).toBeNull()
    }),
  )
})
