import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { CREEPER_KIND, type MobBehaviour } from '../domain/entities/mob-frame'
import { meleeDamageForItem } from '../domain/interactions/melee-attack'
import {
  type GameplayFrameState,
  makeGameplayFrameState,
  requestTargetedPrimaryAttack,
  resolveTargetedPrimaryAttack,
} from '../stages/registration'
import { makeChunkStoreDouble, STONE, world } from './support/chunk-store-double'
import {
  makeEntityManagerDouble,
  type EntityManagerDouble,
} from './support/entity-manager-double'
import { makePlayerServiceDouble } from './support/player-service-double'

const PLAYER_POSE = {
  feetPosition: { x: 0.5, y: 64, z: 5.5 },
  yawRadians: 0,
  pitchRadians: 0,
}

const makeContext = (blockZ?: number) =>
  Effect.gen(function* () {
    const state = yield* makeGameplayFrameState
    const store = yield* makeChunkStoreDouble(
      blockZ === undefined ? world([]) : world([[{ x: 0, y: 65, z: blockZ }, STONE]]),
      ['0,0'],
    )
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const player = yield* makePlayerServiceDouble(PLAYER_POSE)
    return { state, store, roster, player }
  })

const spawnHostile = (roster: EntityManagerDouble<MobBehaviour>, z: number) =>
  roster.api.spawn({
    kind: CREEPER_KIND,
    feetPosition: { x: 0.5, y: 64.72, z },
    healthPoints: 20,
    behaviour: undefined,
  })

const inboxSizes = (state: GameplayFrameState) =>
  Effect.all({
    breaks: Effect.map(Ref.get(state.pendingBreaks), (pending) => pending.length),
    melee: Effect.map(Ref.get(state.pendingMeleeAttacks), (pending) => pending.length),
  })

describe('targeted primary attack', () => {
  it.effect('resolves the full melee request without writing either inbox', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      const enemy = yield* spawnHostile(context.roster, 4)

      const resolution = yield* resolveTargetedPrimaryAttack(
        context.store.api,
        context.roster.api,
        context.player.api,
      )

      expect(resolution._tag).toBe('Melee')
      if (resolution._tag === 'Melee') {
        expect(resolution.target.id).toBe(enemy.id)
        expect(resolution.request.origin).toStrictEqual({ x: 0.5, y: 65.62, z: 5.5 })
        expect(resolution.request.direction.x).toBeCloseTo(0)
        expect(resolution.request.direction.y).toBeCloseTo(0)
        expect(resolution.request.direction.z).toBeCloseTo(-1)
        expect(resolution.request.reach).toBe(3)
        expect(resolution.request.damage).toBe(1)
        expect(resolution.request).not.toHaveProperty('hitDistance')
      }
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 0 })
      expect(yield* Ref.get(context.state.meleeAttackResults)).toStrictEqual([])
    }),
  )

  it.effect('carries the selected melee damage into the queued request', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      yield* spawnHostile(context.roster, 4)

      const resolution = yield* resolveTargetedPrimaryAttack(
        context.store.api,
        context.roster.api,
        context.player.api,
        { meleeDamage: meleeDamageForItem('diamond_sword') },
      )

      expect(resolution._tag).toBe('Melee')
      if (resolution._tag === 'Melee') expect(resolution.request.damage).toBe(7)
      expect(yield* Ref.get(context.state.meleeAttackResults)).toStrictEqual([])
    }),
  )

  it.effect('keeps block priority at the exact resolver distance boundary without enqueueing', () =>
    Effect.gen(function* () {
      const context = yield* makeContext(4)
      yield* spawnHostile(context.roster, 5)

      const resolution = yield* resolveTargetedPrimaryAttack(
        context.store.api,
        context.roster.api,
        context.player.api,
      )

      expect(resolution._tag).toBe('Block')
      if (resolution._tag === 'Block') {
        expect(resolution.target.position).toStrictEqual({ x: 0, y: 65, z: 4 })
      }
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 0 })
    }),
  )

  it.effect('wraps a melee resolution with exactly one enqueue and hides its request', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      const enemy = yield* spawnHostile(context.roster, 4)

      const result = yield* requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.roster.api,
        context.player.api,
      )

      expect(result._tag).toBe('Melee')
      if (result._tag === 'Melee') expect(result.target.id).toBe(enemy.id)
      expect(result).not.toHaveProperty('request')
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 1 })
    }),
  )

  it.effect('prefers a hostile before the aimed block and enqueues only melee', () =>
    Effect.gen(function* () {
      const context = yield* makeContext(2)
      const enemy = yield* spawnHostile(context.roster, 4)

      const result = yield* requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.roster.api,
        context.player.api,
      )

      expect(result._tag).toBe('Melee')
      if (result._tag === 'Melee') expect(result.target.id).toBe(enemy.id)
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 1 })
    }),
  )

  it.effect('prefers a block when the nearest hostile is at or behind the wall', () =>
    Effect.gen(function* () {
      const context = yield* makeContext(4)
      yield* spawnHostile(context.roster, 3.5)

      const result = yield* requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.roster.api,
        context.player.api,
      )

      expect(result._tag).toBe('Block')
      if (result._tag === 'Block') expect(result.target.position).toStrictEqual({ x: 0, y: 65, z: 4 })
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 1, melee: 0 })
    }),
  )

  it.effect('prefers a block when the nearest hostile is exactly as far as the wall', () =>
    Effect.gen(function* () {
      const context = yield* makeContext(4)
      yield* spawnHostile(context.roster, 5)

      const result = yield* requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.roster.api,
        context.player.api,
      )

      expect(result._tag).toBe('Block')
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 1, melee: 0 })
    }),
  )

  it.effect('returns the nearest hostile and enqueues one melee request', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      yield* spawnHostile(context.roster, 3)
      const nearest = yield* spawnHostile(context.roster, 4)

      const result = yield* requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.roster.api,
        context.player.api,
      )

      expect(result._tag).toBe('Melee')
      if (result._tag === 'Melee') expect(result.target.id).toBe(nearest.id)
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 1 })
    }),
  )

  it.effect('returns none and leaves both inboxes empty when the ray misses', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()

      const result = yield* requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.roster.api,
        context.player.api,
      )

      expect(result).toStrictEqual({ _tag: 'None' })
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 0 })
    }),
  )

  it.effect('uses the pure melee rule for invalid reach', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      yield* spawnHostile(context.roster, 4)

      const result = yield* requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.roster.api,
        context.player.api,
        { meleeReach: Number.NaN },
      )

      expect(result).toStrictEqual({ _tag: 'None' })
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 0 })
    }),
  )
})
