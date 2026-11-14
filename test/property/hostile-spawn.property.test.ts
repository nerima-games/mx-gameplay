import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { Result } from 'effect'
import { AIR_BLOCK_ID, EntitySerial, SimulationTick } from '@nerima-games/mc-kernel'
import { EntityId, type EntityRoster } from '@nerima-games/mc-sim'
import {
  CREEPER_KIND,
  initialBehaviourOfKind,
  maxHealthOfKind,
  type MobBehaviour,
  planSpawnAttemptsOnRoster,
} from '../../src/domain/entities/mob-frame'
import {
  hostileSpawnSearchDue,
  canMobSpawnAt,
  SkyLightLevel,
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
  skyLight: SkyLightLevel(0),
  biome: 'PLAINS',
  timeOfDay: 0.9,
  distanceToPlayerBlocksXZ: 30,
}

const difficulties: ReadonlyArray<HostileDifficulty> = ['peaceful', 'easy', 'normal', 'hard']
const EXPECTED_HOSTILE_SPAWN_RULES = {
  peaceful: { maxPopulation: 0, intervalTicks: 40 },
  easy: { maxPopulation: 6, intervalTicks: 40 },
  normal: { maxPopulation: 9, intervalTicks: 30 },
  hard: { maxPopulation: 14, intervalTicks: 20 },
} satisfies Readonly<Record<HostileDifficulty, {
  readonly maxPopulation: number
  readonly intervalTicks: number
}>>

const generatedBiomes = [
  'PLAINS',
  'DESERT',
  'FOREST',
  'FLOWER_FOREST',
  'OCEAN',
  'MOUNTAINS',
  'SNOW',
  'SWAMP',
  'JUNGLE',
  'BEACH',
  'RIVER',
  'TAIGA',
  'SAVANNA',
  'NETHER',
  'END',
] as const satisfies ReadonlyArray<SpawnCandidate['biome']>

const creeperSpawnBiomes: ReadonlySet<SpawnCandidate['biome']> = new Set([
  'PLAINS',
  'DESERT',
  'FOREST',
  'FLOWER_FOREST',
  'OCEAN',
  'MOUNTAINS',
  'SNOW',
  'SWAMP',
  'JUNGLE',
  'BEACH',
  'RIVER',
  'TAIGA',
  'SAVANNA',
])

type CandidateFacts = {
  readonly offsetX: number
  readonly offsetZ: number
  readonly feetY: number
  readonly blockLight: number
  readonly skyLight: number
  readonly timeOfDay: number
  readonly biome: SpawnCandidate['biome']
}

const playerPosition = position(0.5, 64, 0.5)

const candidateArbitrary = fc.record({
  offsetX: fc.integer({ min: -42, max: 42 }),
  offsetZ: fc.integer({ min: -42, max: 42 }),
  feetY: fc.integer({ min: 1, max: 254 }),
  blockLight: fc.integer({ min: 0, max: 15 }),
  skyLight: fc.integer({ min: 0, max: 15 }),
  timeOfDay: fc.oneof(
    fc.constantFrom(0.54, 0.55, 0.95, 0.96),
    fc.double({ min: 0, max: 0.999999, noNaN: true, noDefaultInfinity: true }),
  ),
  biome: fc.constantFrom(...generatedBiomes),
})

const makeAttempt = (facts: CandidateFacts) => {
  const feetPosition = position(facts.offsetX + 0.5, facts.feetY, facts.offsetZ + 0.5)
  const distanceToPlayerBlocksXZ = Math.hypot(
    feetPosition.x - playerPosition.x,
    feetPosition.z - playerPosition.z,
  )
  const candidate: SpawnCandidate = {
    ...validCandidate,
    blockLight: facts.blockLight,
    skyLight: SkyLightLevel(facts.skyLight),
    biome: facts.biome,
    timeOfDay: facts.timeOfDay,
    distanceToPlayerBlocksXZ,
  }

  return { candidate, kind: CREEPER_KIND, feetPosition }
}

const independentlyAllowsCreeper = (attempt: ReturnType<typeof makeAttempt>): boolean => {
  const { candidate, feetPosition } = attempt
  const distance = Math.hypot(
    feetPosition.x - playerPosition.x,
    feetPosition.z - playerPosition.z,
  )
  const night = candidate.timeOfDay >= 0.55 && candidate.timeOfDay <= 0.95
  return creeperSpawnBiomes.has(candidate.biome) &&
    distance >= 24 && distance <= 40 &&
    (night || candidate.skyLight <= 7) && candidate.blockLight === 0
}

const seededHostiles = (count: number): EntityRoster<MobBehaviour> => ({
  entities: Array.from({ length: count }, (_, index) => ({
    id: EntityId(`property-seed-${String(index)}`),
    kind: CREEPER_KIND,
    feetPosition: position(0.5, 64 + index, 0.5),
    healthPoints: maxHealthOfKind(CREEPER_KIND),
    behaviour: initialBehaviourOfKind(CREEPER_KIND),
  })),
  nextSerial: EntitySerial(count),
})

describe('hostile spawn properties', () => {
  it('matches an independent spawn oracle and cap for generated candidates and initial populations', () => {
    fc.assert(
      fc.property(
        fc.array(candidateArbitrary, { minLength: 1, maxLength: 80 }),
        fc.integer({ min: 0, max: 18 }),
        fc.constantFrom(...difficulties),
        (facts, initialMobCount, difficulty) => {
          const attempts = facts.map(makeAttempt)
          const expectedSpawnable = attempts.map(independentlyAllowsCreeper)
          const expectedSpawnableCount = expectedSpawnable.filter(Boolean).length
          const populationCap = EXPECTED_HOSTILE_SPAWN_RULES[difficulty].maxPopulation
          let expectedPopulation = initialMobCount
          const expectedOutcomes = expectedSpawnable.map((spawnable) => {
            if (!spawnable) return 'Refused'
            if (expectedPopulation >= populationCap) return 'AtCapacity'
            expectedPopulation += 1
            return 'Spawned'
          })
          const result = planSpawnAttemptsOnRoster(
            seededHostiles(initialMobCount),
            attempts,
            difficulty,
          )

          expect(Result.isSuccess(result)).toBe(true)
          if (Result.isFailure(result)) return

          const outcomes = result.success.outcomes
          expect(outcomes).toHaveLength(facts.length)
          expect(outcomes.map(({ _tag }) => _tag)).toStrictEqual(expectedOutcomes)
          expect(outcomes.filter(({ _tag }) => _tag !== 'Refused')).toHaveLength(expectedSpawnableCount)
          const expectedNewMobs = Math.min(
            expectedSpawnableCount,
            Math.max(0, populationCap - initialMobCount),
          )
          expect(outcomes.filter(({ _tag }) => _tag === 'Spawned')).toHaveLength(expectedNewMobs)
          expect(result.success.roster.entities).toHaveLength(initialMobCount + expectedNewMobs)

          for (const [index, attempt] of attempts.entries()) {
            const verdict = canMobSpawnAt(attempt.kind, attempt.candidate)
            expect(verdict._tag === 'Spawn').toBe(expectedSpawnable[index])
          }
        },
      ),
    )
  })

  it('returns typed failures for malformed measurements across their full numeric domain', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: false, noDefaultInfinity: false }),
        fc.constantFrom(
          'distanceToPlayerBlocksXZ' as const,
          'blockLight' as const,
          'skyLight' as const,
          'timeOfDay' as const,
        ),
        (reading, field) => {
          const verdict = canMobSpawnAt(CREEPER_KIND, { ...validCandidate, [field]: reading })
          const valid = field === 'timeOfDay'
            ? Number.isFinite(reading)
            : field === 'distanceToPlayerBlocksXZ'
            ? Number.isFinite(reading) && reading >= 0
            : Number.isInteger(reading) && reading >= 0 && reading <= 15
          if (!valid) {
            expect(verdict).toStrictEqual(field === 'timeOfDay'
              ? { _tag: 'InvalidDayNightInput', field: 'timeOfDay' }
              : { _tag: 'InvalidSpawnCandidate', field })
          } else {
            expect(verdict._tag).not.toBe('InvalidSpawnCandidate')
            expect(verdict._tag).not.toBe('InvalidDayNightInput')
          }
        },
      ),
    )
  })

  it('keeps an absent player distance as the named unmeasurable refusal', () => {
    const candidate = { ...validCandidate }
    delete (candidate as Partial<SpawnCandidate>).distanceToPlayerBlocksXZ
    expect(canMobSpawnAt(CREEPER_KIND, candidate as SpawnCandidate)).toStrictEqual({
      _tag: 'Refused',
      reason: 'unmeasurable',
    })
  })

  it('returns a typed failure or a boolean due result for arbitrary valid ticks', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.constantFrom(...difficulties),
        (currentTick, lastSpawnTick, difficulty) => {
          const result = hostileSpawnSearchDue(
            SimulationTick(currentTick),
            SimulationTick(lastSpawnTick),
            difficulty,
          )
          if (Result.isFailure(result)) {
            expect(result.failure).toStrictEqual({ _tag: 'InvalidSpawnTick' })
          } else {
            expect(typeof result.success).toBe('boolean')
          }
        },
      ),
    )
  })

  it('returns a typed failure when the current tick precedes the last spawn tick', () => {
    const result = hostileSpawnSearchDue(SimulationTick(0), SimulationTick(1), 'normal')
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure).toStrictEqual({ _tag: 'InvalidSpawnTick' })
  })

  it('starts the next search exactly at each difficulty interval boundary', () => {
    for (const difficulty of difficulties) {
      const interval = EXPECTED_HOSTILE_SPAWN_RULES[difficulty].intervalTicks
      expect(Result.getOrThrow(hostileSpawnSearchDue(SimulationTick(interval - 1), SimulationTick(0), difficulty))).toBe(false)
      expect(Result.getOrThrow(hostileSpawnSearchDue(SimulationTick(interval), SimulationTick(0), difficulty))).toBe(true)
      expect(Result.getOrThrow(hostileSpawnSearchDue(SimulationTick(interval + 1), SimulationTick(0), difficulty))).toBe(true)
    }
  })
})
