import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import {
  applyDamage,
  type DeathCause,
  type Vitals,
} from '../../src/domain/death-cause'
import {
  INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
  resolveEnvironmentalContactDamage,
  type EnvironmentalContact,
} from '../../src/domain/environmental-contact-damage'

const deathCauses: ReadonlyArray<DeathCause> = [
  'fall',
  'lava',
  'cactus',
  'in_fire',
  'on_fire',
  'drowning',
  'suffocation',
  'starvation',
  'mob',
  'projectile',
  'explosion',
  'void',
  'ender_pearl',
  'poison',
  'generic',
]

const validContacts: ReadonlyArray<EnvironmentalContact> = [
  { block: 'cactus', contactDamage: 1 },
  { block: 'lava', contactDamage: 4 },
]

describe('player damage properties', () => {
  it('records only the cause that reduces health to zero and preserves it afterward', () => {
    // Fails if a nonlethal hit records a cause, a fatal hit loses it, or a later hit rewrites it.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 1, max: 20 }),
        FastCheck.integer({ min: 0, max: deathCauses.length - 1 }),
        FastCheck.integer({ min: 0, max: deathCauses.length - 1 }),
        (startingHealth, lethalIndex, laterIndex) => {
          const lethalCause = deathCauses[lethalIndex]
          const laterCause = deathCauses[laterIndex]
          if (lethalCause === undefined || laterCause === undefined) return false

          const alive: Vitals = { healthPoints: startingHealth, lastDeathCause: undefined }
          const nonlethal = applyDamage(alive, {
            amount: startingHealth - 1,
            cause: 'lava',
          })
          const dead = applyDamage(nonlethal, {
            amount: nonlethal.healthPoints,
            cause: lethalCause,
          })
          const afterCorpseHit = applyDamage(dead, { amount: 1, cause: laterCause })

          return nonlethal.healthPoints > 0 &&
            nonlethal.lastDeathCause === undefined &&
            dead.healthPoints === 0 &&
            dead.lastDeathCause === lethalCause &&
            afterCorpseHit.healthPoints === dead.healthPoints &&
            afterCorpseHit.lastDeathCause === dead.lastDeathCause
        },
      ),
    )
  })

  it('emits one damage using the strongest valid contacted block', () => {
    // Fails if overlapping damaging cells stack hits or a weaker cell wins over the stronger one.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.array(FastCheck.constantFrom(...validContacts), { minLength: 1, maxLength: 12 }),
        (contacts) => {
          const strongestDamage = Math.max(...contacts.map((contact) => contact.contactDamage))
          const expectedBlock =
            contacts.find(
              (contact) => contact.contactDamage === strongestDamage && contact.block === 'lava',
            )?.block ??
            contacts.find((contact) => contact.contactDamage === strongestDamage)?.block
          if (expectedBlock === undefined) return false

          const result = resolveEnvironmentalContactDamage(
            INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
            contacts,
            0,
          )
          const [damage] = result.damages

          return result.damages.length === 1 &&
            damage?.amount === strongestDamage &&
            damage.cause === expectedBlock
        },
      ),
    )
  })
})
