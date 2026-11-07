import { describe, expect, it } from '@effect/vitest'
import { AngleRadians, DeltaTimeSecs, DimensionIdSchema, PositionAxis, ProjectileIdSchema, SimulationTickSchema, position as kernelPosition, type ItemType } from '@nerima-games/mc-kernel'
import {
  BrewingServiceStateSchema,
  DomainEventBus,
  FishingStateSchema,
  PlayerStorageSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  PROJECTILE_REPLICATED_OWNER_ID,
  SNOWBALL_PROFILE,
  TNT_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  itemStack as makeItemStack,
  makeBrewingService,
  makeFishingService,
  makeProjectileService,
  makeTntService,
  type DomainEventBusApi,
  type ProjectileLaunch,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Ref, Result, Schema, Stream } from 'effect'
import { makeInMemoryWorld } from '../../src/domain/in-memory-world'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { makeVillager, type VillagerTradeState } from '../../src/domain/villager-trade'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { emptySlots } from '../support/inventory-service-double'
import { runFrame } from '../support/frame-runner'
import {
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayVillagerTradeSnapshotSchema,
} from '../../src/stages/gameplay-owner-registrations'
import {
  drainItemUseResults,
  drainVillagerTradeResults,
  GameplayBrewingItemUseResultSchema,
  GameplayFishingItemUseResultSchema,
  gameplayStages,
  getPlayerMovementSpeedMultiplier,
  insertBrewingBottle,
  insertBrewingFuel,
  insertBrewingIngredient,
  makeGameplayFrameStateForOwner,
  requestFishingAdvance,
  requestFishingCast,
  requestFishingReel,
  requestStatusEffect,
  requestVillagerTrade,
  snapshotStatusEffects,
} from '../../src/stages/registration'

const itemStack = (item: ItemType, count: number) => Result.getOrThrow(makeItemStack(item, count))

const withItems = (...items: ReadonlyArray<readonly [ItemType, number]>) => {
  const slots = [...emptySlots()]
  for (const [index, [item, count]] of items.entries()) slots[index] = itemStack(item, count)
  return slots
}

const storedCount = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: ItemType,
): number => storage.inventory.slots.reduce(
  (count, slot) => count + (slot?.item === item ? slot.count : 0),
  0,
)

const makePlayerSystemsSlice = (options: Readonly<{
  readonly inventory?: ReadonlyArray<ReturnType<typeof itemStack> | undefined>
  readonly villagerTrades?: VillagerTradeState
}> = {}) => Effect.gen(function* () {
  const world = yield* makeInMemoryWorld<MobBehaviour>({ inventory: options.inventory })
  const baseCommit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, {
    ...(options.villagerTrades === undefined ? {} : { villagerTrades: options.villagerTrades }),
  })
  const eventBus: DomainEventBusApi = {
    publish: () => Effect.void,
    events: Stream.empty,
  }
  const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
    Effect.provideService(WorldCommitCoordinator, baseCommit.coordinator),
    Effect.provideService(DomainEventBus, eventBus),
  )
  const projectileService = yield* makeProjectileService().pipe(
    Effect.provideService(WorldCommitCoordinator, baseCommit.coordinator),
    Effect.provideService(DomainEventBus, eventBus),
  )
  const tntService = yield* makeTntService(TNT_REPLICATED_OWNER_ID).pipe(
    Effect.provideService(WorldCommitCoordinator, baseCommit.coordinator),
  )
  const brewingService = yield* makeBrewingService(GAMEPLAY_BREWING_OWNER_ID)
  const commit = {
    ...baseCommit,
    brewingOwnerId: GAMEPLAY_BREWING_OWNER_ID,
    fishingOwnerId: GAMEPLAY_FISHING_OWNER_ID,
    projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID,
    tntOwnerId: TNT_REPLICATED_OWNER_ID,
    statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
    brewingService,
    fishingService,
    projectileService,
    tntService,
    eventBus,
  }
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator: baseCommit.coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
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

  return { state, stages, commit }
})

const fishingActor = Brand.nominal<Parameters<typeof requestFishingCast>[1]['actor']>()('player-fisher')
const fishingBobber = Schema.decodeUnknownSync(ProjectileIdSchema)('player-systems-bobber')
const projectileSpeed = Brand.nominal<ProjectileLaunch['speed']>()
const fishingLaunch: ProjectileLaunch = {
  position: kernelPosition(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: projectileSpeed(1),
}

describe('player systems gameplay scenarios', () => {
  it.effect('applies and expires a requested status effect across complete gameplay frames', () =>
    Effect.gen(function* () {
      const slice = yield* makePlayerSystemsSlice()

      yield* requestStatusEffect(slice.state, { type: 'speed', durationSecs: 2 })
      yield* runFrame(slice.stages, DeltaTimeSecs(0))

      expect((yield* snapshotStatusEffects(slice.state, slice.commit)).effects).toStrictEqual([
        { type: 'speed', remainingSecs: 2, pulseClockSecs: 0, amplifier: 0 },
      ])
      expect(yield* getPlayerMovementSpeedMultiplier(slice.state)).toBe(1.2)

      yield* runFrame(slice.stages, DeltaTimeSecs(1.5))
      expect((yield* snapshotStatusEffects(slice.state, slice.commit)).effects[0]?.remainingSecs).toBe(0.5)
      expect(yield* getPlayerMovementSpeedMultiplier(slice.state)).toBe(1.2)

      yield* runFrame(slice.stages, DeltaTimeSecs(0.5))
      expect((yield* snapshotStatusEffects(slice.state, slice.commit)).effects).toStrictEqual([])
      expect(yield* getPlayerMovementSpeedMultiplier(slice.state)).toBe(1)
    }),
  )

  it.effect('consumes brewing inputs through registered stages and commits the stand state', () =>
    Effect.gen(function* () {
      const slice = yield* makePlayerSystemsSlice({
        inventory: withItems(
          ['blaze_powder', 1],
          ['water_bottle', 1],
          ['nether_wart', 1],
        ),
      })

      yield* insertBrewingFuel(slice.state, 'player-systems-fuel')
      yield* runFrame(slice.stages, DeltaTimeSecs(0))
      yield* insertBrewingBottle(slice.state, 'player-systems-bottle', 0, 'water_bottle')
      yield* runFrame(slice.stages, DeltaTimeSecs(0))
      yield* insertBrewingIngredient(slice.state, 'player-systems-ingredient', 'nether_wart')
      yield* runFrame(slice.stages, DeltaTimeSecs(0))

      const results = (yield* drainItemUseResults(slice.state)).map((result) =>
        Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)(result),
      )
      expect(results).toStrictEqual([
        { action: 'InsertBrewingFuel', requestId: 'player-systems-fuel', success: true, outcome: undefined },
        { action: 'InsertBrewingBottle', requestId: 'player-systems-bottle', success: true, outcome: undefined },
        { action: 'InsertBrewingIngredient', requestId: 'player-systems-ingredient', success: true, outcome: undefined },
      ])

      const brewing = yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_BREWING_OWNER_ID,
        BrewingServiceStateSchema,
      )
      const storage = yield* slice.commit.coordinator.snapshot(
        slice.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(brewing.state.fuelCharges).toBeGreaterThan(0)
      expect(brewing.state.bottles[0]).toMatchObject({ item: 'water_bottle', count: 1 })
      expect(brewing.state.ingredient).toMatchObject({ item: 'nether_wart', count: 1 })
      expect(storage.state.inventory.slots.slice(0, 3)).toStrictEqual([undefined, undefined, undefined])
    }),
  )

  it.effect('settles a villager trade into player storage and offer stock in one gameplay frame', () =>
    Effect.gen(function* () {
      const villager = makeVillager('player-systems-farmer', 'farmer')
      const offer = villager.offers.find((candidate) => candidate.input.item === 'wheat')
      if (offer === undefined) throw new Error('Farmer fixture must include a wheat offer')
      const slice = yield* makePlayerSystemsSlice({
        inventory: withItems(['wheat', offer.input.count]),
        villagerTrades: { villagers: [villager], restockElapsedSecs: 0 },
      })
      const request = {
        requestId: 'player-systems-trade',
        villagerId: villager.id,
        offerId: offer.id,
      }
      const before = yield* slice.commit.coordinator.snapshot(
        slice.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      yield* requestVillagerTrade(slice.state, request)
      yield* runFrame(slice.stages, DeltaTimeSecs(0))

      expect(yield* drainVillagerTradeResults(slice.state)).toStrictEqual([
        { ...request, _tag: 'Traded' },
      ])
      const after = yield* slice.commit.coordinator.snapshot(
        slice.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const trades = yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
        GameplayVillagerTradeSnapshotSchema,
      )
      expect(storedCount(before.state, 'wheat') - storedCount(after.state, 'wheat')).toBe(offer.input.count)
      expect(storedCount(after.state, 'emerald') - storedCount(before.state, 'emerald')).toBe(offer.output.count)
      expect(trades.state.villagers[0]?.offers.find((entry) => entry.id === offer.id)?.uses).toBe(1)
    }),
  )

  it.effect('casts, reaches a bite, and reels a catch into player storage through gameplay stages', () =>
    Effect.gen(function* () {
      const slice = yield* makePlayerSystemsSlice()
      const before = yield* slice.commit.coordinator.snapshot(
        slice.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')

      yield* requestFishingCast(slice.state, {
        requestId: 'player-systems-cast',
        actor: fishingActor,
        bobber: fishingBobber,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(0),
        dimension,
        launch: fishingLaunch,
        profile: SNOWBALL_PROFILE,
        rod: null,
        environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
      })
      yield* runFrame(slice.stages, DeltaTimeSecs(0))

      const castFishing = yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_FISHING_OWNER_ID,
        FishingStateSchema,
      )
      const castProjectiles = yield* slice.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(castFishing.state.rods).toMatchObject([{ actor: fishingActor, bobber: fishingBobber, phase: 'cast' }])
      expect(castProjectiles.state.projectiles.map(({ id }) => id)).toContain(fishingBobber)

      yield* requestFishingAdvance(slice.state, {
        requestId: 'player-systems-advance',
        actor: fishingActor,
        elapsedTicks: 120,
        waitTicks: 100,
        approachTicks: 20,
        biteWindowTicks: 20,
        environment: { hasWater: true },
      })
      yield* runFrame(slice.stages, DeltaTimeSecs(0))
      const atBite = yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_FISHING_OWNER_ID,
        FishingStateSchema,
      )
      expect(atBite.state.rods[0]?.phase).toBe('bite')

      yield* Ref.set(slice.state.tickCount, Schema.decodeUnknownSync(SimulationTickSchema)(7))
      yield* requestFishingReel(slice.state, 'player-systems-reel', fishingActor)
      yield* runFrame(slice.stages, DeltaTimeSecs(0))

      const results = (yield* drainItemUseResults(slice.state)).map((result) =>
        Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(result),
      )
      const reel = results.find((result) => result.action === 'ReelFishing')
      expect(results.map((result) => result.action)).toStrictEqual([
        'CastFishing',
        'AdvanceFishing',
        'ReelFishing',
      ])
      expect(reel).toMatchObject({ action: 'ReelFishing', success: true, outcome: { _tag: 'Caught' } })
      if (reel?.action !== 'ReelFishing' || reel.outcome._tag !== 'Caught') {
        throw new Error('Reeling at the bite phase must produce the deterministic catch')
      }

      const after = yield* slice.commit.coordinator.snapshot(
        slice.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const fishing = yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_FISHING_OWNER_ID,
        FishingStateSchema,
      )
      const projectiles = yield* slice.commit.coordinator.snapshot(
        PROJECTILE_REPLICATED_OWNER_ID,
        ProjectileServiceSnapshotSchema,
      )
      expect(storedCount(after.state, reel.outcome.item) - storedCount(before.state, reel.outcome.item)).toBe(1)
      expect(fishing.state.rods).toStrictEqual([])
      expect(projectiles.state.projectiles.map(({ id }) => id)).not.toContain(fishingBobber)
    }),
  )
})
