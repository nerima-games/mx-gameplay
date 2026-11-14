import { Effect, Ref, Result, Schema } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  BlockAxis,
  DeltaTimeSecs,
  EntityHealthPoints,
  EntitySerial,
  InterpolationFraction,
  PositionAxis,
  WorldIdSchema,
  blockPosition,
  position,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  WorldCommitCoordinator,
  makeEntityManager,
  makeTimeService,
  makeTntService,
  makeWorldCommitCoordinator,
  TNT_REPLICATED_OWNER_ID,
  type PlayerPose,
} from '@nerima-games/mc-sim'
import { CREEPER_KIND, hostileMobSnapshot, type MobBehaviour, type MobEntity } from '../src/domain/entities/mob-frame.js'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat.js'
import { makeGameplayFrameState, type GameplayStageContext } from '../src/stages/registration-core.js'
import { drainGameplayEntityStageFaults } from '../src/stages/registration.js'
import {
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_TNT_SOURCES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'
import { makeEntitiesStage } from '../src/stages/entities-stage.js'
import { INITIAL_PLAYER_POSE } from '../src/domain/in-memory-player.js'
import { FrameServicesLayer } from './support/frame-services.js'
import { STONE, world } from './support/chunk-store-double.js'
import { makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'

const resistsExplosionSpy = vi.hoisted(() => vi.fn())

vi.mock('@nerima-games/mc-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mc-kernel')>()
  return { ...actual, resistsExplosion: resistsExplosionSpy }
})

const worldId = Schema.decodeUnknownSync(WorldIdSchema)('entities-stage-resistance-failure')
const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))

const makeHarness = () => Effect.gen(function* () {
  const playerPose: PlayerPose = {
    ...INITIAL_PLAYER_POSE,
    feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
  }
  const creeper: MobEntity = {
    id: EntityId('test:resistance-creeper'),
    kind: CREEPER_KIND,
    feetPosition: playerPose.feetPosition,
    healthPoints: EntityHealthPoints(20),
    behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
  }
  const zombie: MobEntity = {
    id: EntityId('test:resistance-zombie'),
    kind: ZOMBIE_KIND,
    feetPosition: position(PositionAxis(1), PositionAxis(64), PositionAxis(0)),
    healthPoints: EntityHealthPoints(20),
    behaviour: hostileMobSnapshot(undefined),
  }
  const entities = [creeper, zombie]
  const store = yield* makeTransactionalChunkStoreDouble(world([[centre, STONE]]), ['0,0'])
  const coordinator = yield* makeWorldCommitCoordinator({
    world: worldId,
    owners: gameplayOwnerRegistrations({
      playerPose,
      entities: { entities, nextSerial: EntitySerial(entities.length) },
    }),
    chunkStores: { forDimension: () => store.api },
  })
  const state = yield* makeGameplayFrameState
  const roster = yield* makeEntityManager<MobBehaviour>()
  const time = yield* makeTimeService()
  yield* time.setTimeOfDay(InterpolationFraction(0.9))
  const tntService = yield* makeTntService(TNT_REPLICATED_OWNER_ID).pipe(
    Effect.provideService(WorldCommitCoordinator, coordinator),
  )
  const context: GameplayStageContext = {
    state,
    store: store.api,
    roster,
    time,
    vehicleService: undefined,
    vehicleEnvironment: undefined,
    options: {},
    commit: {
      coordinator,
      playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
      playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
      tntSourcesOwnerId: GAMEPLAY_TNT_SOURCES_OWNER_ID,
      tntOwnerId: TNT_REPLICATED_OWNER_ID,
      tntService,
    },
  }
  return { state, store, stage: makeEntitiesStage(context) }
})

describe('entities stage explosion resistance failures', () => {
  it('records a registry fault for the queried block and leaves it unchanged', async () => {
    const registryFailure = {
      _tag: 'BlockPropertyFailure' as const,
      reason: 'type' as const,
      message: 'registry property resolution failed',
    }
    resistsExplosionSpy.mockReturnValue(Result.fail(registryFailure))
    const harness = await Effect.runPromise(makeHarness())

    const exit = await Effect.runPromiseExit(
      harness.stage.run(DeltaTimeSecs(0.02)).pipe(Effect.provide(FrameServicesLayer)),
    )
    const faults = await Effect.runPromise(drainGameplayEntityStageFaults(harness.state))

    expect(exit._tag).toBe('Success')
    expect(resistsExplosionSpy).toHaveBeenCalledWith(STONE, expect.any(Number))
    expect(faults).toContainEqual({
      _tag: 'EntityWorldDataFault',
      source: 'TntExplosion',
      target: { _tag: 'Cell', cell: centre },
      failure: {
        _tag: 'EntityWorldRegistryFailure',
        cell: centre,
        failure: registryFailure,
      },
    })
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toStrictEqual([])
  })
})
