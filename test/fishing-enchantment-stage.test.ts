import { describe, expect, it } from '@effect/vitest'
import {
  AngleRadians,
  DimensionIdSchema,
  EntityId,
  ProjectileIdSchema,
  SimulationTickSchema,
  StackCount,
  enchantmentsComponent,
  itemComponents,
  itemStack,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  FishingElapsedTicksSchema,
  FishingStateSchema,
  FishingWaitTicksSchema,
  SNOWBALL_PROFILE,
  WorldCommitCoordinator,
  equipmentItem,
  makeFishingService,
  makeTimeService,
  storageFromInventory,
  type BlockId,
  type DomainEventBusApi,
  type EquipmentItem,
  type ProjectileLaunch,
  type PlayerStorage,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Ref, Result, Schema, Stream } from 'effect'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { makeChunkStoreDouble } from './support/chunk-store-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makeGameplayCommitServices } from './support/transactional-stage-doubles'
import { makePlayerServiceDouble } from './support/player-service-double'
import { position as atPosition } from './support/coordinate-fixtures'
import { runFrame } from './support/frame-runner'
import {
  drainItemUseResults,
  GameplayFishingItemUseResultSchema,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestFishingAdvance,
  requestFishingCast,
  requestFishingReel,
} from '../src/stages/registration'
import type { GameplayStageCommitServices } from '../src/stages/registration-core'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import {
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations'
import { nextRoll } from '../src/domain/frame-rolls'

const FISHER = EntityId('fishing-enchantment-actor')
const BOBBER = Schema.decodeUnknownSync(ProjectileIdSchema)('fishing-enchantment-bobber')
const DIMENSION = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const LUCK_SAMPLE_SEED = 113_335
const HELD_ROD_SLOT = 0
const FISHING_LAUNCH: ProjectileLaunch = {
  position: atPosition(0, 64, 0),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: Brand.nominal<ProjectileLaunch['speed']>()(1),
}

const playerStorageWithEnchantedRod = (): { storage: PlayerStorage; rod: EquipmentItem } => {
  const slots = [...emptySlots()]
  const enchantments = Result.getOrThrow(enchantmentsComponent({
    'minecraft:lure': 1,
    'minecraft:luck_of_the_sea': 3,
  }))
  const components = Result.getOrThrow(itemComponents('fishing_rod', { enchantments }))
  const stack = Result.getOrThrow(itemStack('fishing_rod', StackCount(1), { components }))
  slots[HELD_ROD_SLOT] = stack
  return {
    storage: storageFromInventory({ slots }),
    rod: Result.getOrThrow(equipmentItem(stack)),
  }
}

const fishingStageHarness = (playerStorage: PlayerStorage) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(new Map<string, BlockId>(), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(playerStorage.inventory.slots)
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const baseCommit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      fishing: Schema.decodeUnknownSync(FishingStateSchema)({ rods: [] }),
      playerStorage,
      projectiles: { projectiles: [] },
    })
    const eventBus: DomainEventBusApi = { publish: () => Effect.void, events: Stream.empty }
    const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, baseCommit.coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const commit: GameplayStageCommitServices = { ...baseCommit, fishingService, eventBus }
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
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
    return { state, stages }
  })

const runInteractions = (stages: ReturnType<typeof gameplayStages>) =>
  runFrame(stages.filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions))

describe('fishing enchantments in the interactions stage', () => {
  it.effect('uses equipped Lure for the wait path and Luck of the Sea for the reel loot path', () =>
    Effect.gen(function* () {
      const { storage, rod } = playerStorageWithEnchantedRod()
      const { state, stages } = yield* fishingStageHarness(storage)

      yield* requestFishingCast(state, {
        requestId: 'cast-enchanted-rod',
        actor: FISHER,
        bobber: BOBBER,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
        dimension: DIMENSION,
        launch: FISHING_LAUNCH,
        profile: SNOWBALL_PROFILE,
        rod,
        environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
      })
      yield* runInteractions(stages)

      const [cast] = yield* drainItemUseResults(state)
      expect(cast).toMatchObject({ action: 'CastFishing', success: true })

      yield* requestFishingAdvance(state, {
        requestId: 'advance-lure-wait',
        actor: FISHER,
        elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(0),
        waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
        approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
        biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
        environment: { hasWater: true },
      })
      yield* runInteractions(stages)

      const [advance] = yield* drainItemUseResults(state)
      expect(advance).toMatchObject({
        action: 'AdvanceFishing',
        success: true,
        outcome: { _tag: 'Approaching', remainingTicks: 20 },
      })

      yield* requestFishingAdvance(state, {
        requestId: 'advance-lure-bite',
        actor: FISHER,
        elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(20),
        waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
        approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
        biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
        environment: { hasWater: true },
      })
      yield* runInteractions(stages)
      const [bite] = yield* drainItemUseResults(state)
      expect(bite).toMatchObject({ action: 'AdvanceFishing', success: true, outcome: { _tag: 'Bite' } })

      yield* Ref.set(state.rollSeed, LUCK_SAMPLE_SEED)
      expect(nextRoll(LUCK_SAMPLE_SEED).roll).toBeCloseTo(0.88700156, 8)
      yield* requestFishingReel(state, 'reel-luck-of-the-sea', FISHER)
      yield* runInteractions(stages)

      const [rawReel] = yield* drainItemUseResults(state)
      if (rawReel === undefined) throw new Error('Expected a fishing reel result.')
      const reel = Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(rawReel)
      expect(reel).toMatchObject({
        action: 'ReelFishing',
        success: true,
        outcome: { _tag: 'Caught', item: 'name_tag' },
      })
    }),
  )
})
