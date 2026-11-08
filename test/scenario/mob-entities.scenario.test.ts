import { describe, expect, it } from '@effect/vitest'
import { SkyLightLevel } from '../../src/domain/mob/hostile-spawn'
import {
  AIR_BLOCK_ID,
  AngleRadians,
  DeltaTimeSecs,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTick,
  StackCount,
  position as makePosition,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  EntityId,
  ProjectileServiceSnapshotSchema,
  FishingStateSchema,
  PlayerStorageSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  makeFishingService,
  SNOWBALL_PROFILE,
  type DomainEventBusApi,
  type ProjectileLaunch,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Ref, Result, Schema, Stream } from 'effect'
import {
  createExperienceOrbValue,
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
} from '../../src/domain/entities/xp-orb'
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  type MobBehaviour,
  type MobSpawnAttempt,
} from '../../src/domain/entities/mob-frame'
import {
  gameplayStages,
  makeGameplayFrameState,
  requestDroppedItemPickup,
  requestExperienceOrbAbsorption,
  requestFishingCast,
  requestMobSpawn,
} from '../../src/stages/registration'
import {
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../../src/stages/gameplay-owner-registrations'
import { DroppedItemOwnerSnapshotSchema } from '../../src/domain/entities/dropped-item'
import { makeInMemoryWorld } from '../../src/domain/in-memory-world'
import { STONE } from '../support/chunk-store-double'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { runFrame } from '../support/frame-runner'

const ORB_ID = EntityId('mob-entities-scenario-xp')
const DROP_ID = EntityId('mob-entities-scenario-drop')
const ACTOR_ID = EntityId('mob-entities-scenario-player')
const BOBBER_ID = 'mob-entities-scenario-bobber'

describe('mob entity gameplay scenarios', () => {
  it.effect('casts a projectile, picks up its drop, and absorbs XP in one gameplay frame', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map([['5,63,5', STONE]]), loaded: ['0,0'] },
      })
      const state = yield* makeGameplayFrameState
      const playerPose = yield* world.player.pose
      const dimension = yield* world.player.dimension
      const position = playerPose.feetPosition
      const actor = ACTOR_ID
      const bobber = Schema.decodeUnknownSync(ProjectileIdSchema)(BOBBER_ID)
      const orbId = ORB_ID
      const droppedItemId = DROP_ID
      const baseCommit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, {
        playerPose,
        dimension,
        droppedItems: {
          items: [{
            id: droppedItemId,
            feetPosition: position,
            behaviour: {
              _tag: 'DroppedItem',
              item: 'gunpowder',
              count: StackCount(3),
              durability: null,
              eligibleFromFrame: 0,
            },
          }],
        },
        experienceOrbs: {
          orbs: [{ id: orbId, value: Result.getOrThrow(createExperienceOrbValue(5)) }],
        },
      })
      const eventBus: DomainEventBusApi = { publish: () => Effect.void, events: Stream.empty }
      const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
        Effect.provideService(WorldCommitCoordinator, baseCommit.coordinator),
        Effect.provideService(DomainEventBus, eventBus),
      )
      const commit = { ...baseCommit, fishingService, eventBus }
      const stages = gameplayStages(
        state,
        world.chunkStore,
        world.entities,
        world.inventory,
        world.player,
        world.time,
        undefined,
        undefined,
        {},
        commit,
      )
      const revisionBefore = yield* commit.coordinator.revision
      const vitalsBefore = yield* commit.coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      const launchSpeed = Brand.nominal<ProjectileLaunch['speed']>()(1)
      const creeperPosition = makePosition(PositionAxis(5.5), PositionAxis(64), PositionAxis(5.5))
      const attempt: MobSpawnAttempt = {
        candidate: {
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          skyLight: SkyLightLevel(0),
          biome: 'PLAINS',
          timeOfDay: 0.9,
          distanceToPlayerBlocksXZ: 30,
          dimension,
        },
        kind: CREEPER_KIND,
        feetPosition: creeperPosition,
      }

      yield* requestFishingCast(state, {
        requestId: 'mob-entities-scenario-cast',
        actor,
        bobber,
        tick: SimulationTick(0),
        dimension,
        launch: {
          position,
          yawRadians: AngleRadians(0),
          pitchRadians: AngleRadians(0),
          speed: launchSpeed,
        },
        profile: SNOWBALL_PROFILE,
        rod: null,
        environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
      })
      yield* requestDroppedItemPickup(state, { actor, tick: SimulationTick(0), position })
      yield* requestExperienceOrbAbsorption(state, {
        actor,
        orb: orbId,
        tick: SimulationTick(0),
        position: { dimension, x: position.x, y: position.y, z: position.z },
      })
      yield* requestMobSpawn(state, attempt)

      yield* runFrame(stages, DeltaTimeSecs(0))

      const [fishing, projectiles, storage, drops, vitals, orbs, entities] = yield* Effect.all([
        commit.coordinator.snapshot(GAMEPLAY_FISHING_OWNER_ID, FishingStateSchema),
        commit.coordinator.snapshot(PROJECTILE_REPLICATED_OWNER_ID, ProjectileServiceSnapshotSchema),
        commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        commit.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
        commit.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        commit.coordinator.snapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, ExperienceOrbOwnerSnapshotSchema),
        commit.coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema),
      ])
      const gunpowderCount = storage.state.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'gunpowder' ? slot.count : 0),
        0,
      )
      const [castResult] = yield* Ref.get(state.itemUseResults)
      const [pickupExecution] = yield* Ref.get(state.droppedItemPickupExecutions)
      const [absorptionExecution] = yield* Ref.get(state.experienceOrbAbsorptionExecutions)

      expect(castResult).toMatchObject({
        action: 'CastFishing',
        requestId: 'mob-entities-scenario-cast',
        success: true,
      })
      expect(fishing.state.rods).toMatchObject([{ actor, bobber, phase: 'cast' }])
      expect(projectiles.state.projectiles).toMatchObject([{ id: bobber, shooter: actor, kind: 'projectile' }])
      expect(gunpowderCount).toBe(3)
      expect(drops.state.items).toStrictEqual([])
      expect(pickupExecution?.outcome).toMatchObject({
        _tag: 'Completed',
        result: [{ event: { _tag: 'ItemPickedUp', count: 3 } }],
      })
      expect(vitals.state.vitals.totalExperience).toBe(vitalsBefore.state.vitals.totalExperience + 5)
      expect(orbs.state.orbs).toStrictEqual([])
      expect(absorptionExecution?.outcome).toMatchObject({
        _tag: 'Completed',
        result: [{ _tag: 'ExperienceCollected', amount: 5, orb: orbId }],
      })
      expect(entities.state.entities).toMatchObject([{
        kind: CREEPER_KIND,
        feetPosition: creeperPosition,
        healthPoints: CREEPER_MAX_HEALTH,
      }])
      expect(new Set(entities.state.entities.map(({ id }) => id)).size).toBe(entities.state.entities.length)
      expect(yield* commit.coordinator.revision).toBeGreaterThan(revisionBefore)
    }),
  )
})
