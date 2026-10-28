import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  DomainEventSchema,
} from '@nerima-games/mc-kernel'
import {
  ExperienceDelta,
  ExperienceLevel,
  TotalExperience,
  experienceCostOfLevel,
  levelForTotalExperience,
  makeVitalsService,
  totalExperienceAtLevel,
} from '@nerima-games/mc-sim'
import {
  ExperienceOrbAbsorptionSchema,
  ExperienceOrbValueSchema,
  absorbExperienceOrb,
  createExperienceOrbValue,
  type ExperienceOrbAbsorptionContext,
} from '../src/domain/entities/xp-orb.js'

const VANILLA_XP_FIXTURE = {
  source: 'https://minecraft.wiki/w/Experience',
  edition: 'Java Edition 26.3',
  nextLevelCosts: [
    { level: 0, points: 7 },
    { level: 15, points: 37 },
    { level: 16, points: 42 },
    { level: 30, points: 112 },
    { level: 31, points: 121 },
  ],
  totalAtLevel: [
    { level: 16, points: 352 },
    { level: 17, points: 394 },
    { level: 31, points: 1507 },
    { level: 32, points: 1628 },
  ],
} as const

const PICKUP_CONTEXT: ExperienceOrbAbsorptionContext = {
  actor: 'player:1',
  orb: 'xp-orb:1',
  tick: 4,
  position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
}

describe('experience orb values', () => {
  it('creates only finite nonnegative values accepted by the public schema', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.oneof(
          FastCheck.integer({ min: 1, max: 1_000_000 }),
          FastCheck.double(),
        ),
        (points) => {
          const created = createExperienceOrbValue(points)
          if (Result.isFailure(created)) return true

          const decoded = Schema.decodeUnknownResult(ExperienceOrbValueSchema)(created.success)
          return Result.isSuccess(decoded) &&
            Number.isFinite(decoded.success) &&
            decoded.success >= 0
        },
      ),
      { numRuns: 250 },
    )
  })

  it('rejects values that are not positive safe integer XP points', () => {
    for (const points of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Result.isFailure(createExperienceOrbValue(points))).toBe(true)
    }
  })

  it('matches the vanilla level cost and total XP fixture through mc-sim', () => {
    expect(VANILLA_XP_FIXTURE.source).toBe('https://minecraft.wiki/w/Experience')
    expect(VANILLA_XP_FIXTURE.edition).toBe('Java Edition 26.3')

    for (const { level, points } of VANILLA_XP_FIXTURE.nextLevelCosts) {
      expect(experienceCostOfLevel(ExperienceLevel(level))).toBe(points)
    }

    for (const { level, points } of VANILLA_XP_FIXTURE.totalAtLevel) {
      const total = totalExperienceAtLevel(ExperienceLevel(level))
      expect(total).toBe(points)
      expect(levelForTotalExperience(TotalExperience(points))).toBe(level)
    }
  })

  it.effect('awards an orb through VitalsService and returns strict event candidates', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()
      const threshold = totalExperienceAtLevel(ExperienceLevel(16))
      const initialExperience = yield* Effect.fromResult(ExperienceDelta.result(threshold))
      yield* vitals.addExperience(initialExperience)
      const orb = yield* Effect.fromResult(createExperienceOrbValue(42))

      const events = yield* absorbExperienceOrb(vitals, orb, PICKUP_CONTEXT)

      expect((yield* vitals.snapshot).totalExperience).toBe(394)
      expect(events.map(({ _tag }) => _tag)).toEqual(['ExperienceCollected', 'LevelUp'])
      expect(events[1]).toMatchObject({
        _tag: 'LevelUp',
        entity: PICKUP_CONTEXT.actor,
        position: PICKUP_CONTEXT.position,
        level: 17,
      })

      for (const event of events) {
        expect(Result.isSuccess(Schema.decodeUnknownResult(DomainEventSchema)(event))).toBe(true)
      }
      expect(Result.isSuccess(
        Schema.decodeUnknownResult(ExperienceOrbAbsorptionSchema)(events),
      )).toBe(true)

      const withExtraField = {
        _tag: 'ExperienceCollected',
        tick: PICKUP_CONTEXT.tick,
        player: PICKUP_CONTEXT.actor,
        orb: PICKUP_CONTEXT.orb,
        amount: orb,
        unexpected: true,
      }
      expect(Result.isFailure(Schema.decodeUnknownResult(DomainEventSchema)(withExtraField))).toBe(true)
    }),
  )

  it.effect('returns no LevelUp candidate when absorption does not cross a level', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()
      const orb = yield* Effect.fromResult(createExperienceOrbValue(1))
      const events = yield* absorbExperienceOrb(vitals, orb, PICKUP_CONTEXT)

      expect(events.map(({ _tag }) => _tag)).toEqual(['ExperienceCollected'])
    }),
  )
})
