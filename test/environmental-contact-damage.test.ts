import { blockIdOf, propertyOfBlockId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { applyDamage, deathMessage, fullHealth } from '../src/domain/death-cause'
import {
  ENVIRONMENTAL_CONTACT_DAMAGE_CADENCE_SECS,
  INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
  resolveEnvironmentalContactDamage,
  type EnvironmentalContact,
} from '../src/domain/environmental-contact-damage'

const contact = (block: EnvironmentalContact['block']): EnvironmentalContact => ({
  block,
  contactDamage: propertyOfBlockId(blockIdOf(block), 'contactDamage'),
})

describe('environmental contact damage', () => {
  it('hits immediately, then follows elapsed simulation time instead of render frames', () => {
    const first = resolveEnvironmentalContactDamage(
      INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      [contact('cactus')],
      10.49,
    )
    expect(first.damages).toStrictEqual([{ amount: 1, cause: 'cactus' }])

    const nextFrame = resolveEnvironmentalContactDamage(first.state, [contact('cactus')], 10.5)
    expect(nextFrame.damages).toStrictEqual([])

    const nextCadence = resolveEnvironmentalContactDamage(
      nextFrame.state,
      [contact('cactus')],
      10.49 + ENVIRONMENTAL_CONTACT_DAMAGE_CADENCE_SECS,
    )
    expect(nextCadence.damages).toStrictEqual([{ amount: 1, cause: 'cactus' }])
  })

  it('uses the strongest contacted cell without stacking duplicate cells', () => {
    const result = resolveEnvironmentalContactDamage(
      INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      [contact('cactus'), contact('lava'), contact('lava')],
      1,
    )

    expect(result.damages).toStrictEqual([{ amount: 4, cause: 'lava' }])
  })

  it('emits at most once after a long clock jump instead of a catch-up burst', () => {
    const first = resolveEnvironmentalContactDamage(
      INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      [contact('lava')],
      0,
    )
    const jumped = resolveEnvironmentalContactDamage(first.state, [contact('lava')], 30)

    expect(jumped.damages).toStrictEqual([{ amount: 4, cause: 'lava' }])
    expect(resolveEnvironmentalContactDamage(jumped.state, [contact('lava')], 30).damages).toStrictEqual([])
  })

  it('resets after leaving damaging cells and starts immediately on re-entry', () => {
    const first = resolveEnvironmentalContactDamage(
      INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      [contact('cactus')],
      2,
    )
    const clear = resolveEnvironmentalContactDamage(first.state, [], 2.1)
    const reentered = resolveEnvironmentalContactDamage(clear.state, [contact('cactus')], 2.2)

    expect(clear.state).toStrictEqual(INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE)
    expect(clear.damages).toStrictEqual([])
    expect(reentered.damages).toStrictEqual([{ amount: 1, cause: 'cactus' }])
  })

  it('starts a new cycle on clock rewind and rejects non-finite elapsed time', () => {
    const first = resolveEnvironmentalContactDamage(
      INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      [contact('lava')],
      5,
    )
    const rewound = resolveEnvironmentalContactDamage(first.state, [contact('lava')], 1)
    const invalid = resolveEnvironmentalContactDamage(rewound.state, [contact('lava')], Number.NaN)

    expect(rewound.damages).toStrictEqual([{ amount: 4, cause: 'lava' }])
    expect(resolveEnvironmentalContactDamage(rewound.state, [contact('lava')], 1).damages).toStrictEqual([])
    expect(invalid).toStrictEqual({
      state: INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      damages: [],
    })
  })

  it('ignores a contact whose resolved damage is non-finite or non-positive', () => {
    const zeroed = resolveEnvironmentalContactDamage(
      INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      [
        { block: 'cactus', contactDamage: 0 },
        { block: 'lava', contactDamage: Number.NaN },
      ],
      0,
    )
    expect(zeroed.damages).toStrictEqual([])

    const mixed = resolveEnvironmentalContactDamage(
      INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      [
        { block: 'cactus', contactDamage: -5 },
        { block: 'lava', contactDamage: 4 },
      ],
      0,
    )
    expect(mixed.damages).toStrictEqual([{ amount: 4, cause: 'lava' }])
  })

  it('preserves cactus as the fatal cause through applyDamage', () => {
    const damage = resolveEnvironmentalContactDamage(
      INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
      [{ block: 'cactus', contactDamage: 20 }],
      0,
    ).damages[0]

    if (damage === undefined) {
      throw new Error('expected immediate cactus damage')
    }

    expect(deathMessage(applyDamage(fullHealth, damage))).toBe('You were pricked to death.')
  })
})
