import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { Result } from 'effect'
import { AIR_BLOCK_ID, EntitySerial } from '@nerima-games/mc-kernel'
import type { EntityRoster } from '@nerima-games/mc-sim'
import { CREEPER_KIND, type MobBehaviour, planSpawnAttemptsOnRoster } from '../../src/domain/entities/mob-frame'
import {
  hostileSpawnSearchDue,
  canHostileSpawnAt,
  HOSTILE_SPAWN_SETTINGS,
  MOB_BIOME_SPAWN_TABLE,
  type SpawnCandidate,
} from '../../src/domain/mob/hostile-spawn'
import type { HostileDifficulty } from '../../src/domain/mob/hostile-despawn'
import { STONE } from '../support/chunk-store-double'
import { position } from '../support/coordinate-fixtures'

const validCandidate: SpawnCandidate = {
  groundBlock: STONE,
  footBlock: AIR_BLOCK_ID,
  headBlock: AIR_BLOCK_ID,
  blockLight: 0,
  skyLight: 0,
  biome: 'PLAINS',
  timeOfDay: 0.9,
  distanceToPlayerBlocksXZ: 30,
}

const difficulties: ReadonlyArray<HostileDifficulty> = ['peaceful', 'easy', 'normal', 'hard']
const biomes = Object.keys(MOB_BIOME_SPAWN_TABLE) as ReadonlyArray<SpawnCandidate['biome']>

describe('hostile spawn properties', () => {
  it('returns a verdict for arbitrary finite spawn measurements', () => {
    fc.assert(
      fc.property(
        fc.record({
          blockLight: fc.double({ noNaN: true, noDefaultInfinity: true }),
          skyLight: fc.double({ noNaN: true, noDefaultInfinity: true }),
          timeOfDay: fc.double({ noNaN: true, noDefaultInfinity: true }),
          distanceToPlayerBlocksXZ: fc.double({ noNaN: true, noDefaultInfinity: true }),
          biome: fc.constantFrom(...biomes),
        }),
        (measurements) => {
          const verdict = canHostileSpawnAt({ ...validCandidate, ...measurements })
          expect(verdict._tag === 'Spawn' || verdict._tag === 'Refused').toBe(true)
        },
      ),
    )
  })

  it('rejects non-finite and out-of-range light readings as unmeasurable', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: false, noDefaultInfinity: false }),
        fc.constantFrom('blockLight' as const, 'skyLight' as const),
        (reading, field) => {
          const verdict = canHostileSpawnAt({ ...validCandidate, [field]: reading })
          if (!Number.isInteger(reading) || reading < 0 || reading > 15) {
            expect(verdict).toStrictEqual({ _tag: 'Refused', reason: 'unmeasurable' })
          }
        },
      ),
    )
  })

  it('returns a typed failure or a boolean due result for arbitrary ticks', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: false, noDefaultInfinity: false }),
        fc.double({ noNaN: false, noDefaultInfinity: false }),
        fc.constantFrom(...difficulties),
        (currentTick, lastSpawnTick, difficulty) => {
          const result = hostileSpawnSearchDue(currentTick, lastSpawnTick, difficulty)
          if (Result.isFailure(result)) {
            expect(result.failure).toStrictEqual({ _tag: 'InvalidSpawnTick' })
          } else {
            expect(typeof result.success).toBe('boolean')
          }
        },
      ),
    )
  })

  it('starts the next search exactly at each difficulty interval boundary', () => {
    for (const difficulty of difficulties) {
      const interval = HOSTILE_SPAWN_SETTINGS[difficulty].intervalTicks
      expect(Result.getOrThrow(hostileSpawnSearchDue(interval - 1, 0, difficulty))).toBe(false)
      expect(Result.getOrThrow(hostileSpawnSearchDue(interval, 0, difficulty))).toBe(true)
      expect(Result.getOrThrow(hostileSpawnSearchDue(interval + 1, 0, difficulty))).toBe(true)
    }
  })

  it('never exceeds the difficulty population cap for arbitrary attempt counts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 80 }),
        fc.constantFrom(...difficulties),
        (count, difficulty) => {
          const initial: EntityRoster<MobBehaviour> = {
            entities: [],
            nextSerial: EntitySerial(0),
          }
          const attempts = Array.from({ length: count }, () => ({
            candidate: validCandidate,
            kind: CREEPER_KIND,
            feetPosition: position(30.5, 64, 0.5),
          }))
          const result = planSpawnAttemptsOnRoster(initial, attempts, difficulty)
          expect(Result.isSuccess(result)).toBe(true)
          if (Result.isSuccess(result)) {
            expect(result.success.roster.entities.length).toBeLessThanOrEqual(
              HOSTILE_SPAWN_SETTINGS[difficulty].maxPopulation,
            )
          }
        },
      ),
    )
  })
})
