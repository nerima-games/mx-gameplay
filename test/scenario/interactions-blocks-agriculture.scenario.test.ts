import { describe, expect, it } from '@effect/vitest'
import {
  DeltaTimeSecs,
  StackCount,
  blockIdOf,
} from '@nerima-games/mc-kernel'
import {
  CropSnapshotSchema,
  DomainEventBus,
  POTATO_MATURITY_SECS,
  PlayerStorageSnapshotSchema,
  TNT_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  makeBrewingService,
  makeFishingService,
  makeProjectileService,
  makeTntService,
  makeTimeService,
  itemStack as makeItemStack,
  type DomainEventBusApi,
} from '@nerima-games/mc-sim'
import { Effect, Option, Result, Stream } from 'effect'
import {
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../../src/stages/gameplay-owner-registrations'
import {
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestBoneMeal,
  requestPotatoHarvest,
  requestPotatoPlanting,
  requestSoilTill,
} from '../../src/stages/registration'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from '../support/inventory-service-double'
import { makePlayerServiceDouble } from '../support/player-service-double'
import { runFrame } from '../support/frame-runner'
import { blockPosition } from '../support/coordinate-fixtures'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from '../support/transactional-stage-doubles'
import { world } from '../support/chunk-store-double'

const soil = blockPosition(8, 64, 8)
const crop = blockPosition(8, 65, 8)
const DIRT = Option.getOrThrow(blockIdOf('dirt'))
const FARMLAND = Option.getOrThrow(blockIdOf('farmland'))
const POTATO_CROP = Option.getOrThrow(blockIdOf('potato_crop'))

const itemStack = (item: Parameters<typeof makeItemStack>[0]) =>
  Result.getOrThrow(makeItemStack(item, StackCount(1)))

const makeScenario = () =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(world([[soil, DIRT]]), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const slots = [...emptySlots()]
    slots[0] = itemStack('wooden_hoe')
    slots[1] = itemStack('potato')
    slots[2] = itemStack('bone_meal')
    const inventory = yield* makeInventoryDouble(slots)
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const commitServices = yield* makeGameplayCommitServices(store.api, inventory.api)
    const eventBus: DomainEventBusApi = { publish: () => Effect.void, events: Stream.empty }
    const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, commitServices.coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const projectileService = yield* makeProjectileService().pipe(
      Effect.provideService(WorldCommitCoordinator, commitServices.coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const brewingService = yield* makeBrewingService(GAMEPLAY_BREWING_OWNER_ID)
    const tntService = yield* makeTntService(TNT_REPLICATED_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, commitServices.coordinator),
    )
    const commit = { ...commitServices, fishingService, projectileService, brewingService, tntService, eventBus }
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })

    return {
      store,
      state,
      commit,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time, undefined, undefined, {}, commit),
    }
  })

describe('farming through registered gameplay stages', () => {
  it.effect('tills and plants, reports unsupported bone meal state, then harvests timed growth through frames', () =>
    Effect.gen(function* () {
      const { store, state, commit, stages } = yield* makeScenario()

      yield* requestSoilTill(state, 'till-potato-soil', soil, 'wooden_hoe')
      yield* runFrame(stages)
      expect(yield* store.blockAt(soil)).toBe(FARMLAND)
      expect(yield* drainItemUseResults(state)).toMatchObject([
        { action: 'TillSoil', requestId: 'till-potato-soil', success: true, outcome: { _tag: 'tilled', at: soil } },
      ])

      yield* requestPotatoPlanting(state, 'plant-potato', soil)
      yield* runFrame(stages, DeltaTimeSecs(0))
      expect(yield* store.blockAt(crop)).toBe(POTATO_CROP)
      expect(yield* drainItemUseResults(state)).toMatchObject([
        { action: 'PlantPotato', requestId: 'plant-potato', success: true, consumedCount: 1 },
      ])

      yield* requestBoneMeal(state, 'bone-meal-potato', crop)
      yield* runFrame(stages, DeltaTimeSecs(0))
      expect(yield* drainItemUseResults(state)).toMatchObject([
        {
          action: 'ApplyBoneMeal',
          requestId: 'bone-meal-potato',
          success: false,
          consumedCount: 0,
          outcome: { _tag: 'stateUnsupported', block: 'potato_crop', operation: 'readState' },
        },
      ])
      const afterBoneMeal = yield* commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      expect(afterBoneMeal.state.crops[0]?.growthSecs).toBe(0)

      yield* runFrame(stages, DeltaTimeSecs(POTATO_MATURITY_SECS))
      const mature = yield* commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      expect(mature.state.crops[0]?.growthSecs).toBe(POTATO_MATURITY_SECS)

      yield* requestPotatoHarvest(state, 'harvest-potato', crop, 0.5)
      yield* runFrame(stages, DeltaTimeSecs(0))
      expect(yield* store.blockAt(soil)).toBe(FARMLAND)
      expect(yield* store.blockAt(crop)).toBeUndefined()
      expect(yield* drainItemUseResults(state)).toMatchObject([
        {
          action: 'HarvestPotato',
          requestId: 'harvest-potato',
          success: true,
          outcome: { _tag: 'drops', drops: [{ item: 'potato', count: 4 }] },
        },
      ])

      const cropOwner = yield* commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      expect(cropOwner.state.crops).toStrictEqual([])
      const storageOwner = yield* commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(storageOwner.state.inventory.slots[2]?.item).toBe('bone_meal')
      const harvestedPotatoes = storageOwner.state.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'potato' ? slot.count : 0),
        0,
      )
      expect(harvestedPotatoes).toBe(4)
    }),
  )
})
