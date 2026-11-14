import type { Damage } from './death-cause.js'
import { Result } from 'effect'

export const ENVIRONMENTAL_CONTACT_DAMAGE_CADENCE_SECS = 0.5

export type EnvironmentalContactBlock = 'lava' | 'cactus'

/** A contacted cell with its resolved mc-kernel `contactDamage` property. */
export type EnvironmentalContact = {
  readonly block: EnvironmentalContactBlock
  readonly contactDamage: number
}

export type EnvironmentalContactDamageState = {
  readonly lastDamageElapsedSecs: number | undefined
}

export type EnvironmentalContactDamageStep = {
  readonly state: EnvironmentalContactDamageState
  readonly damages: ReadonlyArray<Damage>
}

export type EnvironmentalContactDamageFailure = Readonly<{
  _tag: 'InvalidEnvironmentalContactDamageInput'
  field: 'contacts' | 'contacts.block' | 'contacts.contactDamage' | 'state.lastDamageElapsedSecs' | 'simulationElapsedSecs'
}>

export const INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE: EnvironmentalContactDamageState = {
  lastDamageElapsedSecs: undefined,
}

const strongestContact = (
  contacts: ReadonlyArray<EnvironmentalContact>,
): Result.Result<EnvironmentalContact | undefined, EnvironmentalContactDamageFailure> => {
  let strongest: EnvironmentalContact | undefined

  for (const contact of contacts) {
    if (typeof contact !== 'object' || contact === null) {
      return Result.fail({ _tag: 'InvalidEnvironmentalContactDamageInput', field: 'contacts' })
    }
    if (contact.block !== 'lava' && contact.block !== 'cactus') {
      return Result.fail({ _tag: 'InvalidEnvironmentalContactDamageInput', field: 'contacts.block' })
    }
    if (!Number.isFinite(contact.contactDamage) || contact.contactDamage < 0) {
      return Result.fail({ _tag: 'InvalidEnvironmentalContactDamageInput', field: 'contacts.contactDamage' })
    }
    if (contact.contactDamage === 0) continue

    if (
      strongest === undefined ||
      contact.contactDamage > strongest.contactDamage ||
      (contact.contactDamage === strongest.contactDamage &&
        contact.block === 'lava' &&
        strongest.block === 'cactus')
    ) {
      strongest = contact
    }
  }

  return Result.succeed(strongest)
}

/**
 * Resolve environmental contact at an absolute simulation time.
 *
 * Contact starts with one immediate hit. Continuous contact can then emit at
 * most one hit per cadence, even when the simulation clock jumps across
 * several cadence intervals. Leaving every damaging cell resets the cycle.
 */
export const resolveEnvironmentalContactDamage = (
  state: EnvironmentalContactDamageState,
  contacts: ReadonlyArray<EnvironmentalContact>,
  simulationElapsedSecs: number,
): Result.Result<EnvironmentalContactDamageStep, EnvironmentalContactDamageFailure> => {
  if (typeof state !== 'object' || state === null) {
    return Result.fail({ _tag: 'InvalidEnvironmentalContactDamageInput', field: 'state.lastDamageElapsedSecs' })
  }
  if (!Array.isArray(contacts)) {
    return Result.fail({ _tag: 'InvalidEnvironmentalContactDamageInput', field: 'contacts' })
  }
  if (!Number.isFinite(simulationElapsedSecs) || simulationElapsedSecs < 0) {
    return Result.fail({ _tag: 'InvalidEnvironmentalContactDamageInput', field: 'simulationElapsedSecs' })
  }
  const lastDamageElapsedSecs = state.lastDamageElapsedSecs
  if (
    lastDamageElapsedSecs !== undefined &&
    (!Number.isFinite(lastDamageElapsedSecs) || lastDamageElapsedSecs < 0)
  ) {
    return Result.fail({ _tag: 'InvalidEnvironmentalContactDamageInput', field: 'state.lastDamageElapsedSecs' })
  }
  const selected = strongestContact(contacts)
  if (Result.isFailure(selected)) return Result.fail(selected.failure)
  const strongest = selected.success

  if (strongest === undefined) {
    return Result.succeed({ state: INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE, damages: [] })
  }

  const contactStarted = lastDamageElapsedSecs === undefined
  const clockRewound = lastDamageElapsedSecs !== undefined && simulationElapsedSecs < lastDamageElapsedSecs
  const cadenceElapsed =
    lastDamageElapsedSecs !== undefined &&
    simulationElapsedSecs - lastDamageElapsedSecs >= ENVIRONMENTAL_CONTACT_DAMAGE_CADENCE_SECS

  if (!contactStarted && !clockRewound && !cadenceElapsed) {
    return Result.succeed({ state, damages: [] })
  }

  return Result.succeed({
    state: { lastDamageElapsedSecs: simulationElapsedSecs },
    damages: [{ amount: strongest.contactDamage, cause: strongest.block }],
  })
}
