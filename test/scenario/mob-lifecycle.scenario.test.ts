import { describe, expect, it } from '@effect/vitest'
import {
  AIR_BLOCK_ID,
  DeltaTimeSecs,
  InterpolationFraction,
} from '@nerima-games/mc-kernel'
import {
  PlayerServiceSnapshotSchema,
  makeTimeService,
  type PlayerServiceApi,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Ref, Schema } from 'effect'
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  maxHealthOfKind,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../../src/domain/entities/mob-frame'
import { PASSIVE_MOB_KINDS } from '../../src/domain/mob/mob-ecosystem'
import {
  gameplayStages,
  makeGameplayFrameState,
  requestMobSpawn,
} from '../../src/stages/registration'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../../src/stages/gameplay-owner-registrations'
import {
  makeGameplayCommitServices,
  makeTransactionalChunkStoreDouble,
} from '../support/transactional-stage-doubles'
import { STONE, world } from '../support/chunk-store-double'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { makeInventoryDouble } from '../support/inventory-service-double'
import { makePlayerServiceDouble, SPAWN_POSE } from '../support/player-service-double'
import { blockPosition, position } from '../support/coordinate-fixtures'
import { runFrame } from '../support/frame-runner'

const makeHarness = (
  playerPosition = position(0.5, 64, 0.5),
  initialWorld = world([[blockPosition(5, 63, 5), STONE]]),
  loadedChunks: ReadonlyArray<string> = ['0,0'],
) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(initialWorld, loadedChunks)
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble()
    const player = yield* makePlayerServiceDouble({
      ...SPAWN_POSE,
      feetPosition: playerPosition,
    })
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      playerPose: yield* player.api.pose,
      dimension: yield* player.api.dimension,
    })
    const stages = gameplayStages(
      state,
      store.api,
      roster.api,
      inventory.api,
      player.api,
      time,
      undefined,
      undefined,
      {},
      commit,
    )
    return { commit, inventory, player, roster, stages, state, store, time }
  })

const mobEntities = (coordinator: WorldCommitCoordinatorApi) =>
  Effect.map(
    coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
    (snapshot) => Schema.decodeUnknownSync(GameplayEntityRosterSchema)(snapshot.state).entities,
  )

const syncPlayerOwner = (coordinator: WorldCommitCoordinatorApi, player: PlayerServiceApi) =>
  Effect.gen(function* () {
    const current = yield* coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema)
    const [pose, dimension] = yield* Effect.all([player.pose, player.dimension])
    const state = Schema.decodeUnknownSync(PlayerServiceSnapshotSchema)({
      ...current.state,
      pose: {
        ...current.state.pose,
        feetPosition: { dimension, ...pose.feetPosition },
        yawRadians: pose.yawRadians,
        pitchRadians: pose.pitchRadians,
      },
    })
    yield* coordinator.commit({
      expectedRevision: current.revision,
      expectedDimensions: [],
      changes: [{ ownerId: GAMEPLAY_PLAYER_OWNER_ID, state }],
    })
  })

describe('mob lifecycle gameplay scenarios', () => {
  it.effect('spawns a queued passive mob and advances it toward the player', () =>
    Effect.gen(function* () {
      const mobPosition = position(20.5, 64, 0.5)
      const harness = yield* makeHarness(
        position(0.5, 64, 0.5),
        world([[blockPosition(20, 63, 0), STONE]]),
        ['0,0', '1,0'],
      )
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* requestMobSpawn(harness.state, {
        candidate: {
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          timeOfDay: 0.5,
          distanceToPlayerBlocksXZ: 20,
          dimension: 'overworld',
        },
        kind: PASSIVE_MOB_KINDS[0],
        feetPosition: mobPosition,
      })

      yield* runFrame(harness.stages, DeltaTimeSecs(0))
      const spawned = yield* mobEntities(harness.commit.coordinator)
      expect(spawned).toHaveLength(1)
      expect(PASSIVE_MOB_KINDS).toContain(spawned[0]?.kind)
      expect(spawned[0]?.healthPoints).toBe(maxHealthOfKind(spawned[0]!.kind))
      expect(spawned[0]?.feetPosition).toStrictEqual(mobPosition)

      yield* runFrame(harness.stages, DeltaTimeSecs(1 / 60))
      const advanced = yield* mobEntities(harness.commit.coordinator)
      expect(advanced).toHaveLength(1)
      expect(advanced[0]?.id).toBe(spawned[0]?.id)
      expect(advanced[0]?.feetPosition).not.toStrictEqual(mobPosition)
    }),
  )

  it.effect('spawns a hostile creeper, then detonates once after the player approaches', () =>
    Effect.gen(function* () {
      const playerStart = position(25.5, 64, 5.5)
      const creeperPosition = position(5.5, 64, 5.5)
      const harness = yield* makeHarness(playerStart)
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.9))

      const attempt: MobSpawnAttempt = {
        candidate: {
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          timeOfDay: 0.9,
          distanceToPlayerBlocksXZ: 20,
          dimension: 'overworld',
        },
        kind: CREEPER_KIND,
        feetPosition: creeperPosition,
      }
      yield* requestMobSpawn(harness.state, attempt)
      yield* runFrame(harness.stages, DeltaTimeSecs(0))

      const spawned = yield* mobEntities(harness.commit.coordinator)
      expect(spawned).toHaveLength(1)
      expect(spawned[0]?.kind).toBe(CREEPER_KIND)
      expect(spawned[0]?.healthPoints).toBe(CREEPER_MAX_HEALTH)
      expect(spawned[0]?.behaviour).toMatchObject({ _tag: 'HostileMob', behaviour: { _tag: 'Dormant' } })

      yield* harness.player.api.moveTo(position(7.5, 64, 5.5))
      yield* syncPlayerOwner(harness.commit.coordinator, harness.player.api)
      yield* harness.time.setTimeOfDay(InterpolationFraction(0.5))
      yield* runFrame(harness.stages, DeltaTimeSecs(1.5))

      const damages = yield* Ref.get(harness.state.playerDamages)
      expect(damages).toHaveLength(1)
      expect(damages[0]).toMatchObject({
        _tag: 'Explosion',
        kind: CREEPER_KIND,
        explosion: { source: 'creeper' },
      })
      expect(damages[0]?.damage.amount).toBeGreaterThan(0)
      expect(yield* mobEntities(harness.commit.coordinator)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.mobDrops)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.mobExperience)).toStrictEqual([])
      expect(yield* harness.store.blockAt(blockPosition(5, 63, 5))).toBeUndefined()
    }),
  )
})
