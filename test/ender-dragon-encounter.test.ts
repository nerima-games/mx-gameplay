import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  ENDER_DRAGON_CONTACT_DAMAGE,
  ENDER_DRAGON_DEATH_XP,
  ENDER_DRAGON_MAX_HEALTH,
  ENDER_DRAGON_PHASE_DURATION_SECS,
  advanceEnderDragonEncounter,
  damageEnderDragonByPlayer,
  initialEnderDragonEncounter,
  makeEnderDragonEncounterStage,
} from '../src'
import { DeltaTimeSecs } from '../src/domain/frame-contract'

describe('Ender Dragon encounter domain', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '10', undefined])(
    'rejects invalid player damage %s without changing state',
    (damage) => {
      const state = initialEnderDragonEncounter()
      expect(damageEnderDragonByPlayer(state, damage)).toStrictEqual({
        _tag: 'Rejected',
        reason: 'invalid-damage',
      })
      expect(state.health).toBe(ENDER_DRAGON_MAX_HEALTH)
    },
  )

  it('accepts boundary damage and emits death rewards exactly once', () => {
    const initial = initialEnderDragonEncounter()
    const first = damageEnderDragonByPlayer(initial, ENDER_DRAGON_MAX_HEALTH)
    expect(first._tag).toBe('Applied')
    if (first._tag !== 'Applied') return

    expect(first.state).toStrictEqual({ phase: 'dead', phaseTimerSecs: 0, health: 0, rewardEmitted: true })
    expect(first.events.map((event) => event._tag)).toStrictEqual([
      'DragonDamagedByPlayer',
      'ExperienceRewarded',
      'ExitPortalMaterializationRequested',
      'DragonEggRewarded',
    ])
    expect(first.events).toContainEqual({ _tag: 'ExperienceRewarded', amount: ENDER_DRAGON_DEATH_XP })
    expect(damageEnderDragonByPlayer(first.state, 1)).toStrictEqual({
      _tag: 'Rejected',
      reason: 'dragon-defeated',
    })
  })

  it('advances circling, perching and charging deterministically across chunked ticks', () => {
    const total = ENDER_DRAGON_PHASE_DURATION_SECS.circling + ENDER_DRAGON_PHASE_DURATION_SECS.perching
    const [once, onceEvents] = advanceEnderDragonEncounter(initialEnderDragonEncounter(), total)
    const [half] = advanceEnderDragonEncounter(initialEnderDragonEncounter(), total / 2)
    const [chunked, chunkedEvents] = advanceEnderDragonEncounter(half, total / 2)

    expect(chunked).toStrictEqual(once)
    expect(chunkedEvents).toStrictEqual(onceEvents)
    expect(once).toMatchObject({ phase: 'charging', phaseTimerSecs: 0 })
    expect(onceEvents).toStrictEqual([{ _tag: 'PlayerDamaged', amount: ENDER_DRAGON_CONTACT_DAMAGE }])

    const [cycled] = advanceEnderDragonEncounter(once, ENDER_DRAGON_PHASE_DURATION_SECS.charging)
    expect(cycled).toMatchObject({ phase: 'circling', phaseTimerSecs: 0 })
  })
})

describe('Ender Dragon encounter stage', () => {
  it.effect('constructs only in the End and exposes an executable stage registration', () =>
    Effect.gen(function* () {
      expect(yield* makeEnderDragonEncounterStage('overworld')).toBeUndefined()
      const runtime = yield* makeEnderDragonEncounterStage('end')
      expect(runtime?.stage.id).toBe('gameplay:ender-dragon')
      expect(runtime?.stage.after).toStrictEqual(['gameplay:entities'])
    }),
  )

  it.effect('restores phase, timer and health with identical subsequent behaviour', () =>
    Effect.gen(function* () {
      const source = yield* makeEnderDragonEncounterStage('end')
      const restored = yield* makeEnderDragonEncounterStage('end')
      if (source === undefined || restored === undefined) return

      yield* source.stage.run(DeltaTimeSecs(11.5))
      yield* source.damageByPlayer(25)
      const snapshot = yield* source.snapshot
      yield* source.drainEvents
      expect(yield* restored.restore(snapshot)).toBe(true)
      expect(yield* restored.snapshot).toStrictEqual(snapshot)

      yield* source.stage.run(DeltaTimeSecs(2.5))
      yield* restored.stage.run(DeltaTimeSecs(2.5))
      expect(yield* restored.snapshot).toStrictEqual(yield* source.snapshot)
      expect(yield* restored.drainEvents).toStrictEqual(yield* source.drainEvents)
    }),
  )

  it.effect('rejects inconsistent snapshots and never re-emits rewards after restoring death', () =>
    Effect.gen(function* () {
      const runtime = yield* makeEnderDragonEncounterStage('end')
      if (runtime === undefined) return

      expect(yield* runtime.restore({
        phase: 'dead',
        phaseTimerSecs: 0,
        health: 0,
        rewardEmitted: false,
      })).toBe(false)

      // Distinct from the case above: this object never reaches the
      // consistency check at all — `phase` fails the schema's own decoding,
      // which is a different failure than a schema-shaped value whose fields
      // disagree with each other.
      expect(yield* runtime.restore({
        phase: 'not-a-real-phase',
        phaseTimerSecs: 0,
        health: ENDER_DRAGON_MAX_HEALTH,
        rewardEmitted: false,
      })).toBe(false)

      yield* runtime.damageByPlayer(ENDER_DRAGON_MAX_HEALTH)
      const firstEvents = yield* runtime.drainEvents
      expect(firstEvents.filter((event) => event._tag === 'ExperienceRewarded')).toHaveLength(1)
      expect(firstEvents.filter((event) => event._tag === 'ExitPortalMaterializationRequested')).toHaveLength(1)
      expect(firstEvents.filter((event) => event._tag === 'DragonEggRewarded')).toHaveLength(1)

      const dead = yield* runtime.snapshot
      expect(yield* runtime.restore(dead)).toBe(true)
      yield* runtime.stage.run(DeltaTimeSecs(100))
      yield* runtime.damageByPlayer(1)
      expect(yield* runtime.drainEvents).toStrictEqual([])
      expect(yield* runtime.snapshot).toStrictEqual(dead)
    }),
  )
})
