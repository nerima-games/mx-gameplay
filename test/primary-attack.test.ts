import { describe, expect, it } from '@effect/vitest'
import { Brand, Effect, Ref, Schema } from 'effect'
import { AttackRangeDistance, EntityHealthPoints, WorldIdSchema } from '@nerima-games/mc-kernel'
import { CREEPER_KIND, type MobBehaviour } from '../src/domain/entities/mob-frame'
import { meleeDamageForItem } from '../src/domain/interactions/melee-attack'
import {
  type GameplayFrameState,
  makeGameplayFrameState,
  requestTargetedPrimaryAttack,
  resolveTargetedPrimaryAttack,
} from '../src/stages/registration'
import { makeChunkStoreDouble, STONE, world } from './support/chunk-store-double'
import {
  makeEntityManagerDouble,
  type EntityManagerDouble,
} from './support/entity-manager-double'
import {
  makeWorldCommitCoordinator,
  PlayerServiceSnapshotSchema,
  type ReplicatedOwnerUnknown,
  type ReplicatedSnapshot,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GameplayEntityRosterSchema,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'
import type { GameplayTargetingSnapshotContext } from '../src/stages/registration-core.js'
import { blockPosition, position } from './support/coordinate-fixtures'

const PLAYER_POSE = {
  feetPosition: position(0.5, 64, 5.5),
  yawRadians: 0,
  pitchRadians: 0,
}

const makeContext = (blockZ?: number) =>
  Effect.gen(function* () {
    const state = yield* makeGameplayFrameState
    const store = yield* makeChunkStoreDouble(
      blockZ === undefined ? world([]) : world([[blockPosition(0, 65, blockZ), STONE]]),
      ['0,0'],
    )
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const coordinator = yield* Effect.orDie(makeWorldCommitCoordinator({
      world: Schema.decodeUnknownSync(WorldIdSchema)('primary-attack-tests'),
      owners: gameplayOwnerRegistrations({ playerPose: PLAYER_POSE }),
    }))
    const targeting: GameplayTargetingSnapshotContext = {
      coordinator,
      playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
      entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
    }
    return { state, store, roster, targeting }
  })

const spawnHostile = (
  roster: EntityManagerDouble<MobBehaviour>,
  targeting: GameplayTargetingSnapshotContext,
  z: number,
) =>
  Effect.gen(function* () {
    const enemy = yield* roster.api.spawn({
      kind: CREEPER_KIND,
      feetPosition: position(0.5, 64.72, z),
      healthPoints: EntityHealthPoints(20),
      behaviour: undefined,
    })
    const state = yield* roster.api.snapshot
    const expectedRevision = yield* targeting.coordinator.revision
    yield* targeting.coordinator.commit({
      expectedRevision,
      expectedDimensions: [],
      changes: [{ ownerId: targeting.entitiesOwnerId, state }],
    })
    return enemy
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
      const enemy = yield* spawnHostile(context.roster, context.targeting, 4)

      const resolution = yield* Effect.orDie(resolveTargetedPrimaryAttack(
        context.store.api,
        context.targeting,
      ))

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
      yield* spawnHostile(context.roster, context.targeting, 4)

      const resolution = yield* Effect.orDie(resolveTargetedPrimaryAttack(
        context.store.api,
        context.targeting,
        { meleeDamage: meleeDamageForItem('diamond_sword') },
      ))

      expect(resolution._tag).toBe('Melee')
      if (resolution._tag === 'Melee') expect(resolution.request.damage).toBe(7)
      expect(yield* Ref.get(context.state.meleeAttackResults)).toStrictEqual([])
    }),
  )

  it.effect('keeps block priority at the exact resolver distance boundary without enqueueing', () =>
    Effect.gen(function* () {
      const context = yield* makeContext(4)
      yield* spawnHostile(context.roster, context.targeting, 5)

      const resolution = yield* Effect.orDie(resolveTargetedPrimaryAttack(
        context.store.api,
        context.targeting,
      ))

      expect(resolution._tag).toBe('Block')
      if (resolution._tag === 'Block') {
        expect(resolution.target.position).toStrictEqual({ x: 0, y: 65, z: 4 })
      }
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 0 })
    }),
  )

  it.effect('retries targeting when player and entity snapshots span revisions', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      const store = yield* makeChunkStoreDouble(
        world([
          [blockPosition(0, 65, 4), STONE],
          [blockPosition(0, 65, 9), STONE],
        ]),
        ['0,0'],
      )
      const coordinator = context.targeting.coordinator
      let injectConcurrentCommit = true
      let playerSnapshotCount = 0
      let entitySnapshotCount = 0
      type SnapshotCodec = Parameters<WorldCommitCoordinatorApi['snapshot']>[1]
      type SnapshotOwnerId = Parameters<WorldCommitCoordinatorApi['snapshot']>[0]
      const racingCoordinator: WorldCommitCoordinatorApi = {
        ...coordinator,
        snapshot: <Codec extends SnapshotCodec>(
          ownerId: SnapshotOwnerId,
          schema: Codec,
        ): Effect.Effect<
          ReplicatedSnapshot<Codec>,
          Schema.SchemaError | ReplicatedOwnerUnknown,
          Schema.Codec.DecodingServices<Codec>
        > => Effect.gen(function* () {
          const snapshot = yield* coordinator.snapshot(ownerId, schema)
          if (ownerId === GAMEPLAY_PLAYER_OWNER_ID) playerSnapshotCount += 1
          if (ownerId === GAMEPLAY_ENTITIES_OWNER_ID) entitySnapshotCount += 1
          if (ownerId === GAMEPLAY_PLAYER_OWNER_ID && injectConcurrentCommit) {
            injectConcurrentCommit = false
            const player = yield* coordinator.snapshot(
              GAMEPLAY_PLAYER_OWNER_ID,
              PlayerServiceSnapshotSchema,
            )
            yield* coordinator.commit({
              expectedRevision: player.revision,
              expectedDimensions: [],
              changes: [{
                ownerId: GAMEPLAY_PLAYER_OWNER_ID,
                state: {
                  ...player.state,
                  pose: {
                    ...player.state.pose,
                    feetPosition: {
                      ...player.state.pose.feetPosition,
                      ...position(0.5, 64, 10.5),
                    },
                  },
                },
              }],
            })
          }
          return snapshot
        }),
      }
      const resolution = yield* Effect.orDie(resolveTargetedPrimaryAttack(
        store.api,
        { ...context.targeting, coordinator: racingCoordinator },
      ))

      expect(resolution._tag).toBe('Block')
      if (resolution._tag === 'Block') {
        expect(resolution.target.position).toStrictEqual({ x: 0, y: 65, z: 9 })
      }
      expect(playerSnapshotCount).toBe(2)
      expect(entitySnapshotCount).toBe(2)
    }),
  )

  it.effect('preserves invalid block reach as a typed failure', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()

      const resolutionFailure = yield* Effect.flip(
        resolveTargetedPrimaryAttack(
          context.store.api,
          context.targeting,
          { blockReach: Number.NaN },
        ),
      )
      expect(resolutionFailure).toBeInstanceOf(Brand.BrandError)

      const requestFailure = yield* Effect.flip(
        requestTargetedPrimaryAttack(
          context.state,
          context.store.api,
          context.targeting,
          { blockReach: Number.NaN },
        ),
      )
      expect(requestFailure).toBeInstanceOf(Brand.BrandError)
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 0 })
    }),
  )

  it.effect('wraps a melee resolution with exactly one enqueue and hides its request', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      const enemy = yield* spawnHostile(context.roster, context.targeting, 4)

      const result = yield* Effect.orDie(requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.targeting,
      ))

      expect(result._tag).toBe('Melee')
      if (result._tag === 'Melee') expect(result.target.id).toBe(enemy.id)
      expect(result).not.toHaveProperty('request')
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 1 })
    }),
  )

  it.effect('prefers a hostile before the aimed block and enqueues only melee', () =>
    Effect.gen(function* () {
      const context = yield* makeContext(2)
      const enemy = yield* spawnHostile(context.roster, context.targeting, 4)

      const result = yield* Effect.orDie(requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.targeting,
      ))

      expect(result._tag).toBe('Melee')
      if (result._tag === 'Melee') expect(result.target.id).toBe(enemy.id)
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 1 })
    }),
  )

  it.effect('prefers a block when the nearest hostile is at or behind the wall', () =>
    Effect.gen(function* () {
      const context = yield* makeContext(4)
      yield* spawnHostile(context.roster, context.targeting, 3.5)

      const result = yield* Effect.orDie(requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.targeting,
      ))

      expect(result._tag).toBe('Block')
      if (result._tag === 'Block') expect(result.target.position).toStrictEqual({ x: 0, y: 65, z: 4 })
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 1, melee: 0 })
    }),
  )

  it.effect('prefers a block when the nearest hostile is exactly as far as the wall', () =>
    Effect.gen(function* () {
      const context = yield* makeContext(4)
      yield* spawnHostile(context.roster, context.targeting, 5)

      const result = yield* Effect.orDie(requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.targeting,
      ))

      expect(result._tag).toBe('Block')
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 1, melee: 0 })
    }),
  )

  it.effect('returns the nearest hostile and enqueues one melee request', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      yield* spawnHostile(context.roster, context.targeting, 3)
      const nearest = yield* spawnHostile(context.roster, context.targeting, 4)

      const result = yield* Effect.orDie(requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.targeting,
      ))

      expect(result._tag).toBe('Melee')
      if (result._tag === 'Melee') expect(result.target.id).toBe(nearest.id)
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 1 })
    }),
  )

  it.effect('returns none and leaves both inboxes empty when the ray misses', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()

      const result = yield* Effect.orDie(requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.targeting,
      ))

      expect(result).toStrictEqual({ _tag: 'None' })
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 0 })
    }),
  )

  it.effect('uses the configured melee reach', () =>
    Effect.gen(function* () {
      const context = yield* makeContext()
      yield* spawnHostile(context.roster, context.targeting, 4)

      const result = yield* Effect.orDie(requestTargetedPrimaryAttack(
        context.state,
        context.store.api,
        context.targeting,
        { meleeReach: AttackRangeDistance(0.5) },
      ))

      expect(result).toStrictEqual({ _tag: 'None' })
      expect(yield* inboxSizes(context.state)).toStrictEqual({ breaks: 0, melee: 0 })
    }),
  )
})
