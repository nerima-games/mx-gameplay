import { describe, expect, it } from '@effect/vitest'
import {
  AIR_BLOCK_ID,
  AngleRadians,
  BlockAxis,
  DimensionIdSchema,
  EntityId,
  ProjectileIdSchema,
  SimulationTickSchema,
  StackCount,
  blockPosition,
  enchantmentsComponent,
  itemComponents,
  itemStack,
  type BlockId,
} from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  FishingElapsedTicksSchema,
  FishingStateSchema,
  FishingWaitTicksSchema,
  ProjectileServiceSnapshotSchema,
  SNOWBALL_PROFILE,
  WorldCommitCoordinator,
  equipmentItem,
  launchProjectile,
  makeFishingService,
  makeReplicatedOwnerId,
  makeTimeService,
  storageFromInventory,
  type DomainEventBusApi,
  type EquipmentItem,
  type FishingState,
  type PlayerStorage,
  type ProjectileLaunch,
  type ReplicatedOwnerId,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Ref, Result, Schema, Stream } from 'effect'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { blockKey, makeChunkStoreDouble, WATER } from './support/chunk-store-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makeGameplayCommitServices } from './support/transactional-stage-doubles'
import { makePlayerServiceDouble } from './support/player-service-double'
import { position as atPosition } from './support/coordinate-fixtures'
import { runFrame } from './support/frame-runner'
import {
  drainGameplayStageFailures,
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestFishingAdvance,
  requestFishingCancel,
  requestFishingCast,
  requestFishingReel,
} from '../src/stages/registration'
import type { GameplayStageCommitServices } from '../src/stages/registration-core'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import {
  GAMEPLAY_FISHING_ENCHANTMENTS_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayFishingEnchantmentsSnapshotSchema,
  type GameplayFishingEnchantmentsSnapshot,
} from '../src/stages/gameplay-owner-registrations'
import { nextRoll } from '../src/domain/frame-rolls'

const FISHER = EntityId('fishing-record-actor')
const BOBBER = Schema.decodeUnknownSync(ProjectileIdSchema)('fishing-record-bobber')
const DIMENSION = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
// Base roll 0.887: junk without Luck of the Sea, treasure (name tag) with level III in open water.
const LUCK_SAMPLE_SEED = 113_335
const ENCHANTED_ROD_SLOT = { _tag: 'Inventory', slotIndex: 0 } as const
const PLAIN_ROD_SLOT = { _tag: 'Inventory', slotIndex: 1 } as const
const OPEN_WATER_BOBBER = atPosition(8.5, 62.2, 8.5)
const CHUNK_EDGE_BOBBER = atPosition(0.5, 62.2, 8.5)
const FISHING_LAUNCH: ProjectileLaunch = {
  position: atPosition(8.5, 64, 8.5),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: Brand.nominal<ProjectileLaunch['speed']>()(1),
}
const WATER_ENVIRONMENT = { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true }

const at = (x: number, y: number, z: number) => blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

/** Water at y 61..62 and air above, covering the 5x4x5 region around OPEN_WATER_BOBBER. */
const openWaterWorld = (): Map<string, BlockId> => {
  const blocks = new Map<string, BlockId>()
  for (let x = 6; x <= 10; x++) {
    for (let z = 6; z <= 10; z++) {
      blocks.set(blockKey(at(x, 61, z)), WATER)
      blocks.set(blockKey(at(x, 62, z)), WATER)
      blocks.set(blockKey(at(x, 63, z)), AIR_BLOCK_ID)
    }
  }
  return blocks
}

const enchantedRodStack = (lure: number, luckOfTheSea: number) => {
  const enchantments = Result.getOrThrow(enchantmentsComponent({
    'minecraft:lure': lure,
    'minecraft:luck_of_the_sea': luckOfTheSea,
  }))
  const components = Result.getOrThrow(itemComponents('fishing_rod', { enchantments }))
  return Result.getOrThrow(itemStack('fishing_rod', StackCount(1), { components }))
}

const storageWithRods = (
  enchanted: ReturnType<typeof enchantedRodStack> | undefined,
): { storage: PlayerStorage; rod: EquipmentItem | null } => {
  const slots = [...emptySlots()]
  if (enchanted !== undefined) slots[ENCHANTED_ROD_SLOT.slotIndex] = enchanted
  slots[PLAIN_ROD_SLOT.slotIndex] = Result.getOrThrow(itemStack('fishing_rod', StackCount(1)))
  return {
    storage: storageFromInventory({ slots }),
    rod: enchanted === undefined ? null : Result.getOrThrow(equipmentItem(enchanted)),
  }
}

const bobberProjectiles = (position: ProjectileLaunch['position']) =>
  Schema.decodeUnknownSync(ProjectileServiceSnapshotSchema)({
    projectiles: [{
      id: BOBBER,
      dimension: DIMENSION,
      shooter: FISHER,
      kind: 'projectile',
      profile: SNOWBALL_PROFILE,
      projectile: launchProjectile({ ...FISHING_LAUNCH, position, shooterId: FISHER }),
    }],
  })

const activeBite: FishingState = Schema.decodeUnknownSync(FishingStateSchema)({
  rods: [{ actor: FISHER, bobber: BOBBER, phase: 'bite' }],
})

type SceneOptions = Readonly<{
  storage: PlayerStorage
  blocks?: Map<string, BlockId>
  fishing?: FishingState
  bobber?: ProjectileLaunch['position']
  records?: GameplayFishingEnchantmentsSnapshot['records']
  // Owner ids in the services handed to the stage; the coordinator keeps every registration.
  stageProjectileOwnerId?: ReplicatedOwnerId | 'omitted'
  stageRecordsOwnerId?: ReplicatedOwnerId
}>

const scene = (options: SceneOptions) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(options.blocks ?? new Map<string, BlockId>(), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(options.storage.inventory.slots)
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const baseCommit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      fishing: options.fishing ?? Schema.decodeUnknownSync(FishingStateSchema)({ rods: [] }),
      playerStorage: options.storage,
      projectiles: options.bobber === undefined ? { projectiles: [] } : bobberProjectiles(options.bobber),
      fishingEnchantments: { records: options.records ?? [] },
    })
    const eventBus: DomainEventBusApi = { publish: () => Effect.void, events: Stream.empty }
    const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID).pipe(
      Effect.provideService(WorldCommitCoordinator, baseCommit.coordinator),
      Effect.provideService(DomainEventBus, eventBus),
    )
    const commit: GameplayStageCommitServices = { ...baseCommit, fishingService, eventBus }
    const { projectileOwnerId, ...withoutProjectileOwnerId } = commit
    const stageProjectileOwnerId = options.stageProjectileOwnerId ?? projectileOwnerId
    const stageCommit: GameplayStageCommitServices = {
      ...withoutProjectileOwnerId,
      ...(stageProjectileOwnerId === undefined || stageProjectileOwnerId === 'omitted'
        ? {}
        : { projectileOwnerId: stageProjectileOwnerId }),
      ...(options.stageRecordsOwnerId === undefined ? {} : { fishingEnchantmentsOwnerId: options.stageRecordsOwnerId }),
    }
    // A fresh frame state and stage list over the same coordinator: nothing survives in memory.
    const stageInstance = Effect.gen(function* () {
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
        stageCommit,
      )
      return { state, stages }
    })
    return { commit, stageInstance }
  })

const runInteractions = (stages: ReturnType<typeof gameplayStages>) =>
  runFrame(stages.filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions))

const projectileOwnerIdOf = (commit: GameplayStageCommitServices) => {
  if (commit.projectileOwnerId === undefined) throw new Error('The test commit services name the projectile owner.')
  return commit.projectileOwnerId
}

const observeOwners = (commit: GameplayStageCommitServices) =>
  Effect.gen(function* () {
    const records = yield* commit.coordinator.observe(
      GAMEPLAY_FISHING_ENCHANTMENTS_OWNER_ID,
      GameplayFishingEnchantmentsSnapshotSchema,
      [],
    )
    const fishing = yield* commit.coordinator.observe(GAMEPLAY_FISHING_OWNER_ID, FishingStateSchema, [])
    const projectiles = yield* commit.coordinator.observe(
      projectileOwnerIdOf(commit),
      ProjectileServiceSnapshotSchema,
      [],
    )
    return {
      revision: yield* commit.coordinator.revision,
      records: records.state.records,
      rods: fishing.state.rods,
      projectileIds: projectiles.state.projectiles.map(({ id }) => id),
    }
  })

const castRequest = (requestId: string, rod: EquipmentItem | null) => ({
  requestId,
  actor: FISHER,
  bobber: BOBBER,
  tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
  dimension: DIMENSION,
  launch: FISHING_LAUNCH,
  profile: SNOWBALL_PROFILE,
  rod,
  environment: WATER_ENVIRONMENT,
})

const advanceRequest = (requestId: string, elapsedTicks: number) => ({
  requestId,
  actor: FISHER,
  elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(elapsedTicks),
  waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
  approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
  biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
  environment: { hasWater: true },
})

const rebuildFailure = (requestId: string, reason: string) => ({
  _tag: 'Failed',
  operation: 'CandidateBuild',
  subject: 'Fishing',
  requestId,
  error: {
    _tag: 'GameplayStageExecutionFailure',
    cause: { _tag: 'FishingEnchantmentRebuildFailure', actor: FISHER, reason },
  },
})

describe('fishing enchantment record owner', () => {
  it.effect('records cast-time Lure, Luck of the Sea and open water in the cast commit and drops them on cancel', () =>
    Effect.gen(function* () {
      const { storage, rod } = storageWithRods(enchantedRodStack(2, 1))
      const { commit, stageInstance } = yield* scene({ storage })
      const { state, stages } = yield* stageInstance
      const before = yield* observeOwners(commit)

      yield* requestFishingCast(state, castRequest('cast-record', rod))
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toMatchObject([{ action: 'CastFishing', success: true }])
      const cast = yield* observeOwners(commit)
      expect(cast.revision).toBe(before.revision + 1)
      expect(cast.rods).toStrictEqual([{ actor: FISHER, bobber: BOBBER, phase: 'cast' }])
      expect(cast.records).toStrictEqual([
        { actor: FISHER, lureLevel: 2, luckOfTheSeaLevel: 1, openWater: true },
      ])

      yield* requestFishingCancel(state, 'cancel-record', FISHER)
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toMatchObject([{ action: 'CancelFishing', success: true }])
      const cancelled = yield* observeOwners(commit)
      expect(cancelled.revision).toBe(cast.revision + 1)
      expect(cancelled.rods).toStrictEqual([])
      expect(cancelled.records).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }),
  )

  it.effect('uses the recorded levels after a stage rebuild even when a plain rod is held at reel time', () =>
    Effect.gen(function* () {
      const { storage, rod } = storageWithRods(enchantedRodStack(1, 3))
      const { commit, stageInstance } = yield* scene({ storage })
      const first = yield* stageInstance

      yield* requestFishingCast(first.state, castRequest('cast-before-rebuild', rod))
      yield* runInteractions(first.stages)
      expect(yield* drainItemUseResults(first.state)).toMatchObject([{ action: 'CastFishing', success: true }])

      const second = yield* stageInstance
      yield* requestFishingAdvance(second.state, advanceRequest('advance-after-rebuild', 0))
      yield* runInteractions(second.stages)
      // Lure I removes 100 of the 100 wait ticks, so the fish is already approaching.
      expect(yield* drainItemUseResults(second.state)).toMatchObject([{
        action: 'AdvanceFishing',
        success: true,
        outcome: { _tag: 'Approaching', remainingTicks: 20 },
      }])
      yield* requestFishingAdvance(second.state, advanceRequest('bite-after-rebuild', 20))
      yield* runInteractions(second.stages)
      expect(yield* drainItemUseResults(second.state)).toMatchObject([{
        action: 'AdvanceFishing',
        success: true,
        outcome: { _tag: 'Bite' },
      }])

      yield* Ref.set(second.state.rollSeed, LUCK_SAMPLE_SEED)
      expect(nextRoll(LUCK_SAMPLE_SEED).roll).toBeCloseTo(0.88700156, 8)
      const beforeReel = yield* observeOwners(commit)
      yield* requestFishingReel(second.state, 'reel-plain-rod', FISHER, PLAIN_ROD_SLOT)
      yield* runInteractions(second.stages)

      expect(yield* drainItemUseResults(second.state)).toMatchObject([{
        action: 'ReelFishing',
        success: true,
        outcome: { _tag: 'Caught', item: 'name_tag' },
      }])
      const reeled = yield* observeOwners(commit)
      expect(reeled.revision).toBe(beforeReel.revision + 1)
      expect(reeled.rods).toStrictEqual([])
      expect(reeled.records).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(second.state)).toStrictEqual([])
    }),
  )

  it.effect('rebuilds a missing record from the held rod and the open water around the bobber', () =>
    Effect.gen(function* () {
      const { storage } = storageWithRods(enchantedRodStack(0, 3))
      const { commit, stageInstance } = yield* scene({
        storage,
        blocks: openWaterWorld(),
        fishing: activeBite,
        bobber: OPEN_WATER_BOBBER,
      })
      const { state, stages } = yield* stageInstance
      const before = yield* observeOwners(commit)
      expect(before.records).toStrictEqual([])

      yield* Ref.set(state.rollSeed, LUCK_SAMPLE_SEED)
      yield* requestFishingReel(state, 'reel-rebuilt', FISHER, ENCHANTED_ROD_SLOT)
      yield* runInteractions(stages)

      // Treasure needs both Luck of the Sea III from the rod and open water from the world.
      expect(yield* drainItemUseResults(state)).toMatchObject([{
        action: 'ReelFishing',
        success: true,
        outcome: { _tag: 'Caught', item: 'name_tag' },
      }])
      const after = yield* observeOwners(commit)
      expect(after.revision).toBe(before.revision + 1)
      expect(after.rods).toStrictEqual([])
      expect(after.projectileIds).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }),
  )

  it.effect('records a typed fault and skips only the request when no rod is held for a rebuild', () =>
    Effect.gen(function* () {
      const { storage } = storageWithRods(undefined)
      const { commit, stageInstance } = yield* scene({
        storage,
        blocks: openWaterWorld(),
        fishing: activeBite,
        bobber: OPEN_WATER_BOBBER,
      })
      const { state, stages } = yield* stageInstance
      const before = yield* observeOwners(commit)

      yield* requestFishingReel(state, 'reel-without-rod', FISHER)
      yield* requestFishingAdvance(state, advanceRequest('advance-without-rod', 0))
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([
        { ...rebuildFailure('reel-without-rod', 'RodNotHeld'), occurrences: 1 },
        { ...rebuildFailure('advance-without-rod', 'RodNotHeld'), occurrences: 1 },
      ])
      expect(yield* observeOwners(commit)).toStrictEqual(before)
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])

      yield* requestFishingCancel(state, 'cancel-after-fault', FISHER)
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toMatchObject([{ action: 'CancelFishing', success: true }])
      const cancelled = yield* observeOwners(commit)
      expect(cancelled.rods).toStrictEqual([])
      expect(cancelled.projectileIds).toStrictEqual([])
    }),
  )

  it.effect('records a typed fault and skips the request when the bobber region cannot be read', () =>
    Effect.gen(function* () {
      const { storage } = storageWithRods(enchantedRodStack(0, 3))
      const { commit, stageInstance } = yield* scene({
        storage,
        blocks: openWaterWorld(),
        fishing: activeBite,
        bobber: CHUNK_EDGE_BOBBER,
      })
      const { state, stages } = yield* stageInstance
      const before = yield* observeOwners(commit)

      yield* requestFishingReel(state, 'reel-unreadable-water', FISHER, ENCHANTED_ROD_SLOT)
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      const failure = rebuildFailure('reel-unreadable-water', 'OpenWaterUnreadable')
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([{
        ...failure,
        error: {
          ...failure.error,
          cause: {
            ...failure.error.cause,
            openWater: {
              _tag: 'FishingOpenWaterReadFailure',
              position: { x: -2, y: 61, z: 6 },
              reason: 'ChunkNotLoaded',
            },
          },
        },
        occurrences: 1,
      }])
      expect(yield* observeOwners(commit)).toStrictEqual(before)
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
    }),
  )

  it.effect('keeps other actors\' records when a cast adds its own', () =>
    Effect.gen(function* () {
      const other = Schema.decodeUnknownSync(GameplayFishingEnchantmentsSnapshotSchema)({
        records: [{ actor: 'other-fisher', lureLevel: 3, luckOfTheSeaLevel: 0, openWater: false }],
      }).records
      const { storage, rod } = storageWithRods(enchantedRodStack(2, 1))
      const { commit, stageInstance } = yield* scene({ storage, records: other })
      const { state, stages } = yield* stageInstance

      yield* requestFishingCast(state, castRequest('cast-beside-other', rod))
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toMatchObject([{ action: 'CastFishing', success: true }])
      expect((yield* observeOwners(commit)).records).toStrictEqual([
        { actor: EntityId('other-fisher'), lureLevel: 3, luckOfTheSeaLevel: 0, openWater: false },
        { actor: FISHER, lureLevel: 2, luckOfTheSeaLevel: 1, openWater: true },
      ])
    }),
  )

  it.effect('rebuilds through the default projectile owner when the stage services omit its id', () =>
    Effect.gen(function* () {
      const { storage } = storageWithRods(enchantedRodStack(0, 3))
      const { commit, stageInstance } = yield* scene({
        storage,
        blocks: openWaterWorld(),
        fishing: activeBite,
        bobber: OPEN_WATER_BOBBER,
        stageProjectileOwnerId: 'omitted',
      })
      const { state, stages } = yield* stageInstance

      yield* Ref.set(state.rollSeed, LUCK_SAMPLE_SEED)
      yield* requestFishingReel(state, 'reel-default-projectile-owner', FISHER, ENCHANTED_ROD_SLOT)
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toMatchObject([{
        action: 'ReelFishing',
        success: true,
        outcome: { _tag: 'Caught', item: 'name_tag' },
      }])
      expect((yield* observeOwners(commit)).projectileIds).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([])
    }),
  )

  it.effect('records a typed fault and skips the request when the bobber projectile is missing', () =>
    Effect.gen(function* () {
      const { storage } = storageWithRods(enchantedRodStack(0, 3))
      const { commit, stageInstance } = yield* scene({ storage, blocks: openWaterWorld(), fishing: activeBite })
      const { state, stages } = yield* stageInstance
      const before = yield* observeOwners(commit)

      yield* requestFishingReel(state, 'reel-missing-bobber', FISHER, ENCHANTED_ROD_SLOT)
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toStrictEqual([
        { ...rebuildFailure('reel-missing-bobber', 'BobberUnavailable'), occurrences: 1 },
      ])
      expect(yield* observeOwners(commit)).toStrictEqual(before)
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
    }),
  )

  it.effect('records an owner snapshot fault when the rebuild cannot read the projectile owner', () =>
    Effect.gen(function* () {
      const { storage } = storageWithRods(enchantedRodStack(0, 3))
      const { commit, stageInstance } = yield* scene({
        storage,
        blocks: openWaterWorld(),
        fishing: activeBite,
        bobber: OPEN_WATER_BOBBER,
        stageProjectileOwnerId: makeReplicatedOwnerId('unregistered-projectiles'),
      })
      const { state, stages } = yield* stageInstance
      const before = yield* observeOwners(commit)

      yield* requestFishingReel(state, 'reel-projectiles-unreadable', FISHER, ENCHANTED_ROD_SLOT)
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toMatchObject([{
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Fishing',
        error: { _tag: 'ReplicatedOwnerUnknown' },
        occurrences: 1,
      }])
      expect(yield* observeOwners(commit)).toStrictEqual(before)
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
    }),
  )

  it.effect('records an owner snapshot fault and commits nothing when the record owner is unreadable', () =>
    Effect.gen(function* () {
      const { storage, rod } = storageWithRods(enchantedRodStack(2, 1))
      const { commit, stageInstance } = yield* scene({
        storage,
        stageRecordsOwnerId: makeReplicatedOwnerId('unregistered-fishing-records'),
      })
      const { state, stages } = yield* stageInstance
      const before = yield* observeOwners(commit)

      yield* requestFishingCast(state, castRequest('cast-records-unreadable', rod))
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toMatchObject([{
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'Fishing',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      }])
      expect(yield* observeOwners(commit)).toStrictEqual(before)
    }),
  )

  it.effect('leaves wait and loot unadjusted and reports the plan failure when no cast is active', () =>
    Effect.gen(function* () {
      const { storage } = storageWithRods(enchantedRodStack(1, 3))
      const { commit, stageInstance } = yield* scene({ storage })
      const { state, stages } = yield* stageInstance
      const before = yield* observeOwners(commit)

      yield* requestFishingAdvance(state, advanceRequest('advance-inactive', 0))
      yield* requestFishingReel(state, 'reel-inactive', FISHER, ENCHANTED_ROD_SLOT)
      yield* runInteractions(stages)

      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* drainGameplayStageFailures(state)).toMatchObject([
        {
          _tag: 'Failed',
          operation: 'PlanBuild',
          subject: 'Fishing',
          error: { _tag: 'FishingInvalidState', operation: 'advance', reason: 'rod-not-active' },
        },
        {
          _tag: 'Failed',
          operation: 'PlanBuild',
          subject: 'Fishing',
          error: { _tag: 'FishingInvalidState', operation: 'reel', reason: 'rod-not-active' },
        },
      ])
      expect(yield* observeOwners(commit)).toStrictEqual(before)
    }),
  )
})
