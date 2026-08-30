import type { Damage } from './death-cause.js'

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

export const INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE: EnvironmentalContactDamageState = {
  lastDamageElapsedSecs: undefined,
}

const strongestContact = (
  contacts: ReadonlyArray<EnvironmentalContact>,
): EnvironmentalContact | undefined => {
  let strongest: EnvironmentalContact | undefined

  for (const contact of contacts) {
    if (!Number.isFinite(contact.contactDamage) || contact.contactDamage <= 0) {
      continue
    }

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

  return strongest
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
): EnvironmentalContactDamageStep => {
  const strongest = strongestContact(contacts)

  if (strongest === undefined || !Number.isFinite(simulationElapsedSecs) || simulationElapsedSecs < 0) {
    return { state: INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE, damages: [] }
  }

  const lastDamageElapsedSecs = state.lastDamageElapsedSecs
  const contactStarted = lastDamageElapsedSecs === undefined
  const clockRewound = lastDamageElapsedSecs !== undefined && simulationElapsedSecs < lastDamageElapsedSecs
  const cadenceElapsed =
    lastDamageElapsedSecs !== undefined &&
    simulationElapsedSecs - lastDamageElapsedSecs >= ENVIRONMENTAL_CONTACT_DAMAGE_CADENCE_SECS

  if (!contactStarted && !clockRewound && !cadenceElapsed) {
    return { state, damages: [] }
  }

  return {
    state: { lastDamageElapsedSecs: simulationElapsedSecs },
    damages: [{ amount: strongest.contactDamage, cause: strongest.block }],
  }
}
