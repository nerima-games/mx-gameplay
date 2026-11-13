import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import { MIN_SPAWN_DISTANCE_BLOCKS, SkyLightLevel } from '../src/domain/mob/hostile-spawn'
import { SPAWN_RING_ANGLES, SPAWN_RING_RADIUS_INSET_BLOCKS } from '../src/domain/entities/mob-spawn-search'
import {
  BlockAxis,
  AIR_BLOCK_ID,
  DeltaTimeSecs as makeDeltaTimeSecs,
  DimensionIdSchema,
  EntityHealthPoints,
  EntitySerial,
  InterpolationFraction,
  PositionAxis,
  RandomSeed,
  SimulationTick,
  StackCount,
  WorldPositionSchema,
  WorldRevisionSchema,
  WorldIdSchema,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  enchantmentsComponent,
  itemComponents,
  position,
  type DeltaTimeSecs,
  type BlockId,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  EntityKind,
  emptyPlayerStorage,
  equipmentItem,
  makeEntityManager,
  makeReplicatedOwnerId,
  makeTntService,
  makeTimeService,
  makeWorldCommitCoordinator,
  durability,
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  TntServiceSnapshotSchema,
  TNT_REPLICATED_OWNER_ID,
  WorldCommitCoordinator,
  WorldRevisionConflict,
  SPAWN_VITALS,
  itemStack,
  type PlayerPose,
  type PlayerStorage,
  type TntServiceSnapshot,
  type Vitals,
  type WorldCommitCoordinatorApi,
  type WorldCommitRequest,
} from '@nerima-games/mc-sim'
import { makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { SAND, STONE, world } from './support/chunk-store-double.js'
import { disturb } from '../src/domain/falling-block.js'
import {
  drainGameplayUnsupportedOperations,
  makeGameplayFrameState,
  requestShieldBlocking,
  requestDroppedItemPickup,
  requestExperienceOrbAbsorption,
  HOSTILE_SPAWN_INTERVAL_TICKS,
  requestMobSpawn,
} from '../src/stages/registration-core.js'
import { INITIAL_DIMENSION, INITIAL_PLAYER_POSE } from '../src/domain/in-memory-player.js'
import {
  DroppedItemOwnerSnapshotSchema,
  type DroppedItemOwnerSnapshot,
} from '../src/domain/entities/dropped-item.js'
import {
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
  ExperienceOrbCountSchema,
  createExperienceOrbValue,
  type ExperienceOrbOwnerSnapshot,
} from '../src/domain/entities/xp-orb.js'
import { makeEntitiesStage } from '../src/stages/entities-stage.js'
import { nextRoll } from '../src/domain/frame-rolls.js'
import {
  CREEPER_KIND,
  initialBehaviourOfKind,
  hostileMobSnapshot,
  type MobBehaviour,
  type MobEntity,
  planMobBlastRoster,
  planMobRosterSweep,
  rollCasualtyDrops,
} from '../src/domain/entities/mob-frame.js'
import { BLAZE_KIND, initialEcosystemMobState, SKELETON_KIND, SPIDER_KIND } from '../src/domain/mob/mob-ecosystem.js'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat.js'
import { COW_KIND } from '../src/domain/mob/mob-ecosystem.js'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_TNT_SOURCES_OWNER_ID,
  GameplayEntityRosterSchema,
  GameplayTntSourcesSnapshotSchema,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'
import type { GameplayStageContext } from '../src/stages/registration-core.js'
import { FrameServicesLayer } from './support/frame-services.js'

const worldId = Schema.decodeUnknownSync(WorldIdSchema)('entities-stage-owner-tests')

const creeperAt = (x: number, y = 0): MobEntity => ({
  id: EntityId('test:creeper'),
  kind: CREEPER_KIND,
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: { _tag: 'Dormant' as const },
})

const zombieAt = (x: number, y: number): MobEntity => ({
  id: EntityId('test:zombie'),
  kind: ZOMBIE_KIND,
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: hostileMobSnapshot(undefined),
})

const beeAt = (x: number, y: number, health: number): MobEntity => ({
  id: EntityId('test:bee'),
  kind: EntityKind('bee'),
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(health),
  behaviour: undefined,
})

const ecosystemMobAt = (id: string, kind: typeof BLAZE_KIND | typeof SKELETON_KIND, x: number, y: number): MobEntity => ({
  id: EntityId(id),
  kind,
  feetPosition: position(PositionAxis(x), PositionAxis(y), PositionAxis(0)),
  healthPoints: EntityHealthPoints(20),
  behaviour: hostileMobSnapshot(initialEcosystemMobState()),
})

const equippedIronHelmetStorage = (): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1))),
  ))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const nearlyBrokenIronHelmetStorage = (): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1))),
    Result.getOrThrow(durability(1, 165)),
  ))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const mendingIronHelmetStorage = (currentDurability = 163): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const components = Result.getOrThrow(itemComponents('iron_helmet', {
    enchantments: Result.getOrThrow(enchantmentsComponent({ 'minecraft:mending': 1 })),
  }))
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1), { components })),
    Result.getOrThrow(durability(currentDurability, 165)),
  ))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const mendingIronPickaxeStorage = (currentDurability = 244): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const components = Result.getOrThrow(itemComponents('iron_pickaxe', {
    enchantments: Result.getOrThrow(enchantmentsComponent({ 'minecraft:mending': 1 })),
  }))
  const pickaxe = Result.getOrThrow(itemStack('iron_pickaxe', StackCount(1), { components }))
  const inventoryDurability = [...storage.inventoryDurability]
  inventoryDurability[0] = Result.getOrThrow(durability(currentDurability, 250))
  return {
    ...storage,
    inventory: {
      ...storage.inventory,
      slots: [pickaxe, ...storage.inventory.slots.slice(1)],
    },
    inventoryDurability,
  }
}

const thornsIronHelmetStorage = (): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const components = Result.getOrThrow(itemComponents('iron_helmet', {
    enchantments: Result.getOrThrow(enchantmentsComponent({ 'minecraft:thorns': 1 })),
  }))
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1), { components })),
    Result.getOrThrow(durability(100, 165)),
  ))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const nearlyBrokenThornsIronHelmetStorage = (): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const components = Result.getOrThrow(itemComponents('iron_helmet', {
    enchantments: Result.getOrThrow(enchantmentsComponent({ 'minecraft:thorns': 1 })),
  }))
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1), { components })),
    Result.getOrThrow(durability(1, 165)),
  ))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const plainDurableIronHelmetStorage = (): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const helmet = Result.getOrThrow(equipmentItem(
    Result.getOrThrow(itemStack('iron_helmet', StackCount(1))),
    Result.getOrThrow(durability(100, 165)),
  ))
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: { ...storage.equipment.slots, head: helmet },
    },
  }
}

const makeHarness = (options: Readonly<{
  readonly entity?: MobEntity | null
  readonly entities?: ReadonlyArray<MobEntity>
  readonly onLightRead?: (position: Readonly<{ x: number; y: number; z: number }>) => void
  readonly tntSources?: Schema.Schema.Type<typeof GameplayTntSourcesSnapshotSchema>
  readonly block?: Readonly<{ position: ReturnType<typeof blockPosition>; id: BlockId }>
  readonly blocks?: ReadonlyArray<readonly [ReturnType<typeof blockPosition>, BlockId]>
  readonly loadedChunks?: ReadonlyArray<string>
  readonly dimension?: Schema.Schema.Type<typeof DimensionIdSchema>
  readonly rejectCommit?: boolean
  readonly rejectTntSnapshotCommit?: boolean
  readonly provideTntService?: boolean
  readonly playerPose?: PlayerPose
  readonly playerStorage?: PlayerStorage
  readonly synthesizeShieldStorageSnapshot?: boolean
  readonly shieldDurability?: number
  readonly droppedItems?: DroppedItemOwnerSnapshot
  readonly vitals?: Vitals
  readonly experienceOrbs?: ExperienceOrbOwnerSnapshot
  readonly tnt?: TntServiceSnapshot
}> = {}) => Effect.gen(function* () {
  const entities = options.entities ?? (options.entity === null ? [] : [options.entity ?? creeperAt(3)])
  const playerPose = options.playerPose ?? (entities[0]?.feetPosition.y === 64
    ? { ...INITIAL_PLAYER_POSE, feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)) }
    : INITIAL_PLAYER_POSE)
  const entries = options.blocks ?? (options.block === undefined
    ? []
    : [[options.block.position, options.block.id] as const])
  const store = yield* makeTransactionalChunkStoreDouble(world(entries), options.loadedChunks ?? ['0,0'])
  const observedStoreApi = options.onLightRead === undefined
    ? store.api
    : {
        ...store.api,
        getLight: (lightPosition: Parameters<typeof store.api.getLight>[0]) => {
          options.onLightRead?.(lightPosition)
          return store.api.getLight(lightPosition)
        },
      }
  const baseCoordinator = yield* makeWorldCommitCoordinator({
    world: worldId,
    owners: gameplayOwnerRegistrations({
      playerPose,
      ...(options.dimension === undefined ? {} : { dimension: options.dimension }),
      ...(options.playerStorage === undefined ? {} : { playerStorage: options.playerStorage }),
      ...(options.droppedItems === undefined ? {} : { droppedItems: options.droppedItems }),
      ...(options.vitals === undefined ? {} : { vitals: options.vitals }),
      ...(options.experienceOrbs === undefined ? {} : { experienceOrbs: options.experienceOrbs }),
      entities: { entities, nextSerial: EntitySerial(entities.length) },
      ...(options.tntSources === undefined ? {} : { tntSources: options.tntSources }),
      ...(options.tnt === undefined ? {} : { tnt: options.tnt }),
    }),
    chunkStores: { forDimension: () => observedStoreApi },
  })
  let commits = 0
  let rejectCommits = options.rejectCommit === true
  let tntCommits = 0
  let tntSnapshotCommits = 0
  let lastRequest: WorldCommitRequest | undefined
  let mismatchNextSnapshotOwnerId: ReturnType<typeof makeReplicatedOwnerId> | undefined
  let mismatchedSnapshots = 0
  const coordinator: WorldCommitCoordinatorApi = {
    ...baseCoordinator,
    snapshot: <Codec extends Schema.Codec<any, any>>(ownerId: ReturnType<typeof makeReplicatedOwnerId>, schema: Codec) =>
      baseCoordinator.snapshot(ownerId, schema).pipe(Effect.flatMap((snapshot) => {
        if (
          options.synthesizeShieldStorageSnapshot === true &&
          ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID &&
          schema === PlayerStorageSnapshotSchema &&
          'state' in snapshot
        ) {
          // Installed mc-sim/mc-kernel catalogs cannot represent shield equipment yet.
          const shield = {
            ...Result.getOrThrow(itemStack('shield', StackCount(1))),
            durability: { current: options.shieldDurability ?? 336, max: 336 },
          }
          const storage = snapshot.state as PlayerStorage
          return Effect.succeed({
            ...snapshot,
            state: {
              ...storage,
              equipment: {
                ...storage.equipment,
                slots: { ...storage.equipment.slots, offhand: shield },
              },
            } as typeof snapshot.state,
          })
        }
        if (ownerId !== mismatchNextSnapshotOwnerId) {
          return Effect.succeed(snapshot)
        }
        mismatchNextSnapshotOwnerId = undefined
        mismatchedSnapshots += 1
        const snapshotSchema = Schema.Struct({
          world: WorldIdSchema,
          revision: WorldRevisionSchema,
          state: schema,
        })
        return baseCoordinator.revision.pipe(Effect.map((revision) =>
          Schema.decodeUnknownSync(snapshotSchema)({
            ...snapshot,
            revision: revision + 1,
          }),
        ))
      })),
    commit: (request) => {
      commits += 1
      lastRequest = request
      return rejectCommits
        ? Effect.fail(new WorldRevisionConflict({
            expected: request.expectedRevision,
            actual: request.expectedRevision,
          }))
        : baseCoordinator.commit(request)
    },
    commitFromSnapshot: (ownerId, schema, buildRequest) => {
      tntSnapshotCommits += 1
      return options.rejectTntSnapshotCommit === true
        ? Effect.fail(new WorldRevisionConflict({ expected: revision, actual: revision }))
        : baseCoordinator.commitFromSnapshot(ownerId, schema, buildRequest)
    },
  }
  const state = yield* makeGameplayFrameState
  const roster = yield* makeEntityManager<MobBehaviour>()
  const time = yield* makeTimeService()
  yield* time.setTimeOfDay(InterpolationFraction(0.9))
  const tntServiceBase = yield* makeTntService(TNT_REPLICATED_OWNER_ID).pipe(
    Effect.provideService(WorldCommitCoordinator, coordinator),
  )
  const revision = yield* coordinator.revision
  const tntService = {
    ...tntServiceBase,
    commitDetonation: (
      reference: Parameters<typeof tntServiceBase.commitDetonation>[0],
      affectedEntityChanges?: Parameters<typeof tntServiceBase.commitDetonation>[1],
    ) => {
      tntCommits += 1
      return tntServiceBase.commitDetonation(reference, affectedEntityChanges)
    },
  }
  const context: GameplayStageContext = {
    state,
    store: observedStoreApi,
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
      ...(options.provideTntService === false ? {} : { tntService }),
    },
  }
  return {
    context,
    state,
    store,
    coordinator,
    stage: makeEntitiesStage(context),
    commits: () => commits,
    rejectCommits: (reject: boolean) => { rejectCommits = reject },
    mismatchNextSnapshot: (ownerId: ReturnType<typeof makeReplicatedOwnerId>) => {
      mismatchNextSnapshotOwnerId = ownerId
    },
    mismatchedSnapshots: () => mismatchedSnapshots,
    tntCommits: () => tntCommits,
    tntSnapshotCommits: () => tntSnapshotCommits,
    lastRequest: () => lastRequest,
    run: (dt: DeltaTimeSecs) =>
      Effect.runPromise(makeEntitiesStage(context).run(dt).pipe(Effect.provide(FrameServicesLayer))),
  }
})

const makeMobBlastHarness = async () => {
  const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
  const creeper = {
    ...creeperAt(0, 64),
    behaviour: { _tag: 'Lit' as const, burnedSecs: 1.49 },
  }
  const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
  const playerPose = {
    ...INITIAL_PLAYER_POSE,
    feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
  }
  const harness = await Effect.runPromise(makeHarness({
    entity: null,
    entities: [creeper, zombie],
    playerPose,
    block: { position: centre, id: STONE },
  }))
  await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
  return { harness, zombie, centre }
}

const strictRoster = (coordinator: WorldCommitCoordinatorApi) =>
  coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)

describe('entities stage owner-backed MobSimulation', () => {
  it('commits the registered entity owner exactly once across generated frame deltas', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (ticks) => {
        const harness = await Effect.runPromise(makeHarness())
        const before = await Effect.runPromise(strictRoster(harness.coordinator))
        const initial = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(before.state)
        const dt = (ticks * 0.05) as Parameters<typeof harness.stage.run>[0]
        await harness.run(dt)
        const after = await Effect.runPromise(strictRoster(harness.coordinator))
        const decoded = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(after.state)

        expect(harness.commits()).toBe(1)
        expect(decoded.entities[0]?.behaviour).not.toStrictEqual(initial.entities[0]?.behaviour)
        expect(after.revision).toBe(before.revision + 1)
      }),
      { numRuns: 12 },
    )
  })

  it('commits registered mob-contact damage and the mob roster in one owner request', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
    }))
    const beforeVitals = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
    )
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(0.25 as DeltaTimeSecs)

    const afterRoster = await Effect.runPromise(strictRoster(harness.coordinator))
    const afterVitals = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
    )
    const decodedRoster = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(afterRoster.state)
    const decodedVitals = Schema.decodeUnknownSync(ExperienceOrbVitalsOwnerSnapshotSchema)(afterVitals.state)
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))

    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_ENTITIES_OWNER_ID)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_VITALS_OWNER_ID)
    expect(afterRoster.revision).toBe(revisionBefore + 1)
    expect(decodedRoster.entities[0]?.behaviour).toMatchObject({ ageTicks: 5 })
    expect(decodedVitals.vitals.healthPoints).toBeLessThan(beforeVitals.state.vitals.healthPoints)
    expect(damages).toMatchObject([{
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      damage: { amount: 3, cause: 'mob' },
    }])
  })

  it('retaliates with Thorns across the 15 percent boundary without changing player damage', async () => {
    // Java Edition 26.3 gives Thorns I a 15% chance per armor piece and 1–5 damage.
    // https://minecraft.wiki/w/Thorns
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const run = async (seed: number, playerStorage: PlayerStorage) => {
      const harness = await Effect.runPromise(makeHarness({
        entity: zombieAt(1, 64),
        playerPose,
        playerStorage,
      }))
      await Effect.runPromise(Ref.set(harness.state.rollSeed, seed))
      await harness.run(makeDeltaTimeSecs(0.25))
      const [roster, vitals, storage, playerDamages] = await Effect.runPromise(Effect.all([
        strictRoster(harness.coordinator),
        harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        harness.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
        Ref.get(harness.state.playerDamages),
      ]))
      return {
        harness,
        zombieHealth: Number(roster.state.entities.find(({ id }) => id === EntityId('test:zombie'))?.healthPoints),
        playerHealth: Number(vitals.state.vitals.healthPoints),
        helmetDurability: storage.state.equipment.slots.head?.durability?.current,
        playerDamages,
      }
    }

    const successSeed = 146_939
    const failureSeed = 785_805
    const successRoll = nextRoll(successSeed)
    const failureRoll = nextRoll(failureSeed)
    expect(successRoll.roll).toBe(0.14999887214507854)
    expect(failureRoll.roll).toBe(0.15000009543728088)
    const expectedRetaliationDamage = 1.1242078729552254

    const retaliating = await run(successSeed, thornsIronHelmetStorage())
    const noThorns = await run(successSeed, plainDurableIronHelmetStorage())
    const outsideChance = await run(failureSeed, thornsIronHelmetStorage())

    expect(retaliating.zombieHealth).toBeCloseTo(20 - expectedRetaliationDamage, 10)
    expect(noThorns.zombieHealth).toBe(20)
    expect(outsideChance.zombieHealth).toBe(20)
    expect(retaliating.playerDamages).toStrictEqual(noThorns.playerDamages)
    expect(outsideChance.playerDamages).toStrictEqual(noThorns.playerDamages)
    expect(retaliating.playerHealth).toBe(noThorns.playerHealth)
    expect(outsideChance.playerHealth).toBe(noThorns.playerHealth)
    expect(retaliating.helmetDurability).toBe((noThorns.helmetDurability ?? 0) - 2)
    expect(outsideChance.helmetDurability).toBe(noThorns.helmetDurability)
    expect(retaliating.harness.commits()).toBe(1)
    expect(retaliating.harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toEqual(
      expect.arrayContaining([GAMEPLAY_ENTITIES_OWNER_ID, GAMEPLAY_PLAYER_STORAGE_OWNER_ID, GAMEPLAY_VITALS_OWNER_ID]),
    )
  })

  it('does not reuse a Thorns helmet after an earlier contact breaks it in the same frame', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const spider = ecosystemMobAt('test:spider-before-zombie', SPIDER_KIND, 1, 64)
    const zombie = zombieAt(1.4, 64)
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [spider, zombie],
      playerPose,
      playerStorage: nearlyBrokenThornsIronHelmetStorage(),
    }))
    const seed = 19_166
    const firstThornsRoll = nextRoll(seed)
    const staleSnapshotSecondRoll = nextRoll(firstThornsRoll.seed)
    expect(firstThornsRoll.roll).toBeGreaterThanOrEqual(0.15)
    expect(staleSnapshotSecondRoll.roll).toBeLessThan(0.15)
    await Effect.runPromise(Ref.set(harness.state.rollSeed, seed))

    await harness.run(makeDeltaTimeSecs(0.25))

    const [roster, storage, playerDamages] = await Effect.runPromise(Effect.all([
      strictRoster(harness.coordinator),
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
      Ref.get(harness.state.playerDamages),
    ]))
    const spiderAfter = roster.state.entities.find(({ id }) => id === spider.id)
    const zombieAfter = roster.state.entities.find(({ id }) => id === zombie.id)

    expect(playerDamages).toMatchObject([
      { _tag: 'HostileContact', source: spider.id },
      { _tag: 'HostileContact', source: zombie.id },
    ])
    expect(playerDamages.map(({ damage }) => damage.amount)).toStrictEqual([1.92, 1])
    expect(Number(spiderAfter?.healthPoints)).toBe(20)
    expect(Number(zombieAfter?.healthPoints)).toBe(20)
    expect(storage.state.equipment.slots.head).toBeNull()
    expect(harness.commits()).toBe(1)
  })

  it('routes AI attacks, contact, and explosions through Peaceful damage resolution', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const creeper = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit' as const, burnedSecs: 1.49 },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, zombieAt(1, 64), ecosystemMobAt('test:skeleton', SKELETON_KIND, 8, 64)],
      playerPose,
      block: { position: blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0)), id: STONE },
    }))
    await Effect.runPromise(harness.state.survivalHunger.setDifficulty('peaceful'))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(0.25 as DeltaTimeSecs)

    const after = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    expect(after.state.vitals.healthPoints).toBe(before.state.vitals.healthPoints)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toEqual([])
  })

  it('applies Hard difficulty to an AI attack before storing hurt resistance', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [ecosystemMobAt('test:skeleton', SKELETON_KIND, 8, 64)],
      playerPose,
    }))
    await Effect.runPromise(harness.state.survivalHunger.setDifficulty('hard'))

    await harness.run(0.05 as DeltaTimeSecs)

    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toMatchObject([{
      damage: { amount: 4.5, cause: 'mob' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.damageImmunity))).toMatchObject({
      lastDamageAmount: 4.5,
    })
  })

  it('routes shielded contact through the stage-held shield state', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      yawRadians: -Math.PI / 2 as typeof INITIAL_PLAYER_POSE.yawRadians,
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      synthesizeShieldStorageSnapshot: true,
    }))
    await Effect.runPromise(harness.state.survivalHunger.setDifficulty('easy'))
    await Effect.runPromise(Ref.set(harness.state.hostileContactCooldowns, new Map([
      [EntityId('test:zombie'), SimulationTick(0)],
    ])))
    const actor = EntityId('mx-gameplay:player-avatar')
    await Effect.runPromise(requestShieldBlocking(harness.state, {
      _tag: 'SetShieldBlocking',
      actor,
      blocking: true,
    }))

    await Effect.runPromise(Effect.forEach(
      Array.from({ length: 20 }, (_, index) => index + 1),
      (tick) => Effect.gen(function* () {
        yield* Ref.set(harness.state.tickCount, SimulationTick(tick))
        yield* Effect.promise(() => harness.run(0.05 as DeltaTimeSecs))
      }),
      { concurrency: 1 },
    ))

    expect(await Effect.runPromise(Ref.get(harness.state.shieldBlocking))).toMatchObject({ actor })
    expect(await Effect.runPromise(Ref.get(harness.state.damageImmunity))).toBeNull()
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toEqual([])
    const contactCooldowns = await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))
    expect(contactCooldowns.get(EntityId('test:zombie'))).toBe(SimulationTick(20))
  })

  it('damages or breaks a shield after a blocked hard contact', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      yawRadians: -Math.PI / 2 as typeof INITIAL_PLAYER_POSE.yawRadians,
    }
    const runBlockedContact = async (shieldDurability: number) => {
      const harness = await Effect.runPromise(makeHarness({
        entity: zombieAt(1, 64),
        playerPose,
        synthesizeShieldStorageSnapshot: true,
        shieldDurability,
      }))
      await Effect.runPromise(harness.state.survivalHunger.setDifficulty('hard'))
      await Effect.runPromise(Ref.set(harness.state.hostileContactCooldowns, new Map([
        [EntityId('test:zombie'), SimulationTick(0)],
      ])))
      await Effect.runPromise(requestShieldBlocking(harness.state, {
        _tag: 'SetShieldBlocking',
        actor: EntityId('mx-gameplay:player-avatar'),
        blocking: true,
      }))

      await Effect.runPromise(Effect.forEach(
        Array.from({ length: 19 }, (_, index) => index + 1),
        (tick) => Effect.gen(function* () {
          yield* Ref.set(harness.state.tickCount, SimulationTick(tick))
          yield* Effect.promise(() => harness.run(0.05 as DeltaTimeSecs))
        }),
        { concurrency: 1 },
      ))
      await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(20)))
      harness.rejectCommits(true)
      const exit = await Effect.runPromiseExit(
        harness.stage.run(0.05 as DeltaTimeSecs).pipe(Effect.provide(FrameServicesLayer)),
      )
      const storageChange = harness.lastRequest()?.changes.find(({ ownerId }) =>
        ownerId === GAMEPLAY_PLAYER_STORAGE_OWNER_ID
      )
      return { exit, storageCandidate: storageChange?.state }
    }

    const damaged = await runBlockedContact(336)
    const broken = await runBlockedContact(1)

    expect(damaged.exit._tag).toBe('Failure')
    expect(damaged.storageCandidate).toMatchObject({
      equipment: { slots: { offhand: { durability: { current: 331 } } } },
    })
    expect(broken.exit._tag).toBe('Failure')
    expect(broken.storageCandidate).toMatchObject({
      equipment: { slots: { offhand: null } },
    })
  })

  it('rejects shield-block requests from the wrong actor and without a shield', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    await Effect.runPromise(requestShieldBlocking(harness.state, {
      _tag: 'SetShieldBlocking',
      actor: EntityId('test:zombie'),
      blocking: true,
    }))
    await Effect.runPromise(requestShieldBlocking(harness.state, {
      _tag: 'SetShieldBlocking',
      actor: EntityId('mx-gameplay:player-avatar'),
      blocking: true,
    }))
    await Effect.runPromise(requestShieldBlocking(harness.state, {
      _tag: 'SetShieldBlocking',
      actor: EntityId('mx-gameplay:player-avatar'),
      blocking: false,
    }))

    await harness.run(0.05 as DeltaTimeSecs)

    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toContainEqual(
      expect.objectContaining({
        operation: 'CandidateBuild',
        subject: 'Player',
        error: { _tag: 'ShieldBlockingPreparation', reason: 'invalid-authoritative-state' },
      }),
    )
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toContainEqual(
      expect.objectContaining({
        operation: 'CandidateBuild',
        subject: 'Player',
        error: { _tag: 'ShieldBlockingPreparation', reason: 'shield-not-equipped' },
      }),
    )
  })

  it('suppresses weaker contact during the ten-tick hurt-resistance window', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [ecosystemMobAt('test:blaze', BLAZE_KIND, 8, 64), zombieAt(2, 64)],
      playerPose,
    }))
    await harness.run(0.05 as DeltaTimeSecs)
    expect(await Effect.runPromise(Ref.get(harness.state.damageImmunity))).toMatchObject({
      lastDamageTick: 0,
      lastDamageAmount: 6,
    })

    await Effect.runPromise(Effect.forEach(
      Array.from({ length: 9 }, (_, index) => index + 1),
      (tick) => Effect.gen(function* () {
        yield* Ref.set(harness.state.tickCount, SimulationTick(tick))
        yield* Effect.promise(() => harness.run(0.05 as DeltaTimeSecs))
      }),
      { concurrency: 1 },
    ))

    expect(await Effect.runPromise(Ref.get(harness.state.damageImmunity))).toMatchObject({
      lastDamageTick: 0,
      lastDamageAmount: 6,
    })
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toHaveLength(1)
  })

  it('keeps same logical tick contact counts and cooldown ticks independent of dt', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const runSchedule = async (secondDeltaSecs: number) => {
      const zombieId = EntityId('test:zombie')
      const harness = await Effect.runPromise(makeHarness({
        entity: zombieAt(1, 64),
        playerPose,
      }))

      await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(0)))
      await harness.run(makeDeltaTimeSecs(0.05))
      const firstDamages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
      const firstCooldowns = await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))
      await Effect.runPromise(Ref.set(harness.state.playerDamages, []))

      await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(10)))
      // A recent hostile search keeps this contact-cooldown check independent of spawn cadence.
      await Effect.runPromise(Ref.set(harness.state.lastHostileSpawnTick, SimulationTick(10)))
      await harness.run(makeDeltaTimeSecs(secondDeltaSecs))
      const secondDamages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
      const secondCooldowns = await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))

      return {
        firstDamage: firstDamages[0],
        damageCounts: [firstDamages.length, secondDamages.length],
        contactCounts: [firstCooldowns.size, secondCooldowns.size],
        contactTicks: [firstCooldowns.get(zombieId), secondCooldowns.get(zombieId)],
      }
    }

    const shortDelta = await runSchedule(0.05)
    const longDelta = await runSchedule(1)

    expect(shortDelta.firstDamage).toMatchObject({
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      kind: ZOMBIE_KIND,
      damage: { amount: 3, cause: 'mob' },
    })
    expect(longDelta.firstDamage).toMatchObject({
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      kind: ZOMBIE_KIND,
      damage: { amount: 3, cause: 'mob' },
    })
    expect(shortDelta.damageCounts).toStrictEqual([1, 0])
    expect(longDelta.damageCounts).toStrictEqual([1, 0])
    expect(shortDelta.contactCounts).toStrictEqual([1, 1])
    expect(longDelta.contactCounts).toStrictEqual([1, 1])
    expect(shortDelta.contactTicks).toStrictEqual([SimulationTick(0), SimulationTick(0)])
    expect(longDelta.contactTicks).toStrictEqual([SimulationTick(0), SimulationTick(0)])
  })

  it('fails closed when the entities stage tick is behind a stored contact tick', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: zombieAt(1, 64) }))
    const previousCooldowns = new Map([[EntityId('test:zombie'), SimulationTick(10)]])
    await Effect.runPromise(Ref.set(harness.state.hostileContactCooldowns, previousCooldowns))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(9)))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.hostileContactCooldowns))).toStrictEqual(previousCooldowns)
  })

  it('keeps dead-player vitals unchanged while recording a valid mob-contact hit', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      vitals: { ...SPAWN_VITALS, healthPoints: EntityHealthPoints(0) },
    }))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.25))

    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
    expect(harness.commits()).toBe(1)
    expect(vitalsAfter.state).toStrictEqual(vitalsBefore.state)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).not.toContain(
      GAMEPLAY_VITALS_OWNER_ID,
    )
    expect(damages).toMatchObject([{
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      damage: { amount: 3, cause: 'mob' },
    }])
  })

  it('commits equipped armor wear with mob-contact damage', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      playerStorage: equippedIronHelmetStorage(),
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.25))

    const after = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    )
    expect(after.state.equipment.slots.head?.durability?.current).toBeLessThan(
      before.state.equipment.slots.head?.durability?.current ?? Number.MAX_SAFE_INTEGER,
    )
  })

  it('breaks the last armor point with mob-contact damage', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      playerStorage: nearlyBrokenIronHelmetStorage(),
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.25))

    const after = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    )
    expect(before.state.equipment.slots.head?.durability?.current).toBe(1)
    expect(after.state.equipment.slots.head).toBeNull()
    expect(damages).toMatchObject([{
      _tag: 'HostileContact',
      source: EntityId('test:zombie'),
      damage: { cause: 'mob' },
    }])
    expect(damages[0]?.damage.amount).toBeGreaterThan(0)
  })

  it('commits mob blast casualties, loot, damage, and block edits together', async () => {
    const { harness, zombie, centre } = await makeMobBlastHarness()

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedItems = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const outputs = await Effect.runPromise(Effect.all({
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      damages: Ref.get(harness.state.playerDamages),
    }))
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(
      GAMEPLAY_ENTITIES_OWNER_ID,
    )
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    )
    expect(harness.lastRequest()?.blockWrite?.edits.length).toBeGreaterThan(0)
    expect(roster.state.entities.some(({ id }) => id === zombie.id)).toBe(false)
    expect(droppedItems.state.items[0]?.behaviour).toMatchObject({
      _tag: 'DroppedItem',
      item: 'rotten_flesh',
      count: 1,
    })
    expect(outputs.drops).toMatchObject([{ item: 'rotten_flesh', count: 1 }])
    expect(outputs.experience).toStrictEqual([])
    expect(outputs.damages.length).toBeGreaterThan(0)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBeUndefined()
  })

  it('reports unknown mob loot and XP after a successful mob blast commit', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const creeper = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit' as const, burnedSecs: 1.49 },
    }
    const unknownMob = {
      ...zombieAt(1, 64),
      id: EntityId('test:unknown-blast-casualty'),
      kind: EntityKind('unregistered'),
      healthPoints: EntityHealthPoints(1),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, unknownMob],
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
      block: { position: centre, id: STONE },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))

    await harness.run(makeDeltaTimeSecs(0.02))

    expect(harness.commits()).toBe(1)
    expect((await Effect.runPromise(strictRoster(harness.coordinator))).state.entities).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.unsupportedOperations))).toEqual(expect.arrayContaining([
      {
        _tag: 'Unsupported',
        action: 'MobDrop',
        reason: 'UnknownMobKind',
        mobKind: 'unregistered',
      },
      {
        _tag: 'Unsupported',
        action: 'MobExperience',
        reason: 'UnknownMobKind',
        mobKind: 'unregistered',
      },
    ]))
    expect(await Effect.runPromise(Ref.get(harness.state.mobDrops))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.mobExperience))).toStrictEqual([])
  })

  it('commits a mob blast casualty and stacks its XP reward in the registered owner', async () => {
    const creeper: MobEntity = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
    }
    const zombie: MobEntity = {
      ...zombieAt(1, 64),
      healthPoints: EntityHealthPoints(1),
      killCredit: 'player',
      lastHitTick: SimulationTick(0),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, zombie],
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(1), PositionAxis(64), PositionAxis(0)),
      },
      experienceOrbs: {
        orbs: [{
          id: EntityId('test:existing-experience-orb-stack'),
          value: Result.getOrThrow(createExperienceOrbValue(3)),
          position: Schema.decodeUnknownSync(WorldPositionSchema)({
            dimension: INITIAL_DIMENSION,
            ...position(PositionAxis(1), PositionAxis(64), PositionAxis(0)),
          }),
          spawnedAt: SimulationTick(0),
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.lastExperienceOrbPickupTick, SimulationTick(0)))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const experienceOrbs = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    expect(harness.commits()).toBe(2)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID)
    expect(roster.state.entities).toStrictEqual([])
    // Java Edition 26.3 splits 5 XP as 3+1+1; same-value orbs at one position stack by count.
    // https://minecraft.wiki/w/Experience#Experience_orbs
    expect(experienceOrbs.state.orbs.map(({ value, count }) => [Number(value), count ?? 1]))
      .toStrictEqual([[3, 2], [1, 2]])
    expect(experienceOrbs.state.orbs[0]?.position).toMatchObject({ x: zombie.feetPosition.x, y: zombie.feetPosition.y, z: zombie.feetPosition.z })
  })

  it('does not commit mob blast casualties when the dropped-item owner revision differs', async () => {
    const { harness, centre } = await makeMobBlastHarness()
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const outputsBefore = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      damages: Ref.get(harness.state.playerDamages),
      fallingBlocks: Ref.get(harness.state.fallingBlocks),
    }))
    harness.mismatchNextSnapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.02)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      damages: Ref.get(harness.state.playerDamages),
      fallingBlocks: Ref.get(harness.state.fallingBlocks),
    }))).toStrictEqual(outputsBefore)
  })

  it('deduplicates block edits shared by overlapping mob blasts', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const harness = await Effect.runPromise(makeHarness({
      entities: [
        {
          ...creeperAt(0, 64),
          id: EntityId('test:creeper-first-blast'),
          behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
        },
        {
          ...creeperAt(1, 64),
          id: EntityId('test:creeper-second-blast'),
          behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
        },
      ],
      block: { position: centre, id: STONE },
    }))

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const edits = harness.lastRequest()?.blockWrite?.edits ?? []
    expect(harness.commits()).toBe(1)
    expect(roster.state.entities).toStrictEqual([])
    const centreKey = blockPositionKeyOf(centre)
    expect(edits.filter(({ position: editPosition }) =>
      blockPositionKeyOf(editPosition) === centreKey,
    )).toHaveLength(1)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBeUndefined()
  })

  it('keeps mob casualty drops unsupported when their owner is not registered', async () => {
    const { harness, centre } = await makeMobBlastHarness()
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const { droppedItemsOwnerId: _omittedDroppedOwner, ...commitWithoutDroppedOwner } = harness.context.commit!
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutDroppedOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.02)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('fails without committing when the player snapshot revision differs from the entity roster', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: zombieAt(1, 64) }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_PLAYER_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.25)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))).toStrictEqual(playerBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('fails without committing mob damage when the vitals snapshot revision differs', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
    }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_VITALS_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.25)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('fails without committing mob damage when the storage snapshot revision differs', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
    }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.25)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('records unavailable player damage owners without committing a mob contact candidate', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: zombieAt(1, 64) }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const { vitalsOwnerId: omittedVitalsOwner, ...commitWithoutVitalsOwner } = harness.context.commit!
    void omittedVitalsOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutVitalsOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.25)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).state).toStrictEqual(vitalsBefore.state)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('leaves registered mob owners and frame outputs unchanged when the owner commit is rejected', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombieAt(1, 64),
      playerPose,
      rejectCommit: true,
    }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const localBefore = await Effect.runPromise(Effect.all({
      damages: Ref.get(harness.state.playerDamages),
      cooldowns: Ref.get(harness.state.hostileContactCooldowns),
      lastHostileSpawnTick: Ref.get(harness.state.lastHostileSpawnTick),
      lastPassiveSpawnTick: Ref.get(harness.state.lastPassiveSpawnTick),
      passiveInitialSpawnPending: Ref.get(harness.state.passiveInitialSpawnPending),
    }))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(0.25 as DeltaTimeSecs).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_ENTITIES_OWNER_ID,
      GAMEPLAY_VITALS_OWNER_ID,
    ])
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Effect.all({
      damages: Ref.get(harness.state.playerDamages),
      cooldowns: Ref.get(harness.state.hostileContactCooldowns),
      lastHostileSpawnTick: Ref.get(harness.state.lastHostileSpawnTick),
      lastPassiveSpawnTick: Ref.get(harness.state.lastPassiveSpawnTick),
      passiveInitialSpawnPending: Ref.get(harness.state.passiveInitialSpawnPending),
    }))).toStrictEqual(localBefore)
  })

  it('pins the fuse ignition threshold at 3 blocks, including the just-outside case', async () => {
    const boundary = await Effect.runPromise(makeHarness({ entity: creeperAt(3) }))
    await boundary.run(0 as DeltaTimeSecs)
    const lit = await Effect.runPromise(strictRoster(boundary.coordinator))
    expect(lit.state.entities[0]?.behaviour).toMatchObject({ _tag: 'Lit', burnedSecs: 0 })
    expect(boundary.commits()).toBe(1)

    const outside = await Effect.runPromise(makeHarness({ entity: creeperAt(3.0001) }))
    const before = await Effect.runPromise(strictRoster(outside.coordinator))
    await outside.run(0 as DeltaTimeSecs)
    const after = await Effect.runPromise(strictRoster(outside.coordinator))
    expect(after.state).toStrictEqual(before.state)
    expect(outside.commits()).toBe(0)
  })

  it('runs passive and hostile spawn searches on the cadence with their distinct seed rules', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const initialSeed = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.5)))

    await harness.run(makeDeltaTimeSecs(0))

    const passiveSeed = await Effect.runPromise(Ref.get(harness.state.rollSeed))
    const initialPending = await Effect.runPromise(Ref.get(harness.state.passiveInitialSpawnPending))
    const passiveCalls = await Effect.runPromise(harness.store.calls)
    expect(passiveSeed).not.toBe(initialSeed)
    expect(initialPending).toBe(false)
    expect(passiveCalls.peeks).toBeGreaterThan(0)

    await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.9)))
    await Effect.runPromise(Ref.set(harness.state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS - 1))
    await harness.run(makeDeltaTimeSecs(0))

    expect(await Effect.runPromise(Ref.get(harness.state.rollSeed))).not.toBe(passiveSeed)
    expect(await Effect.runPromise(Ref.get(harness.state.lastHostileSpawnTick))).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
  })

  it('commits casualty drops, XP orbs, and a passive spawn in the same simulation tick', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const creeper: MobEntity = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
    }
    const zombie: MobEntity = {
      ...zombieAt(1, 64),
      healthPoints: EntityHealthPoints(1),
      killCredit: 'player',
      lastHitTick: SimulationTick(0),
    }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [creeper, zombie],
      playerPose,
      block: { position: centre, id: STONE },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
    await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.5)))
    await Effect.runPromise(requestMobSpawn(harness.state, {
      candidate: {
        groundBlock: STONE,
        footBlock: AIR_BLOCK_ID,
        headBlock: AIR_BLOCK_ID,
        blockLight: 0,
        skyLight: SkyLightLevel(0),
        biome: 'PLAINS',
        timeOfDay: 0.5,
        distanceToPlayerBlocksXZ: 30,
      },
      kind: COW_KIND,
      feetPosition: position(PositionAxis(30), PositionAxis(64), PositionAxis(0)),
    }))

    await harness.run(makeDeltaTimeSecs(0.02))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    const experienceOrbs = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const outputs = await Effect.runPromise(Effect.all({
      drops: Ref.get(harness.state.mobDrops),
      lastPassiveSpawnTick: Ref.get(harness.state.lastPassiveSpawnTick),
      passiveInitialSpawnPending: Ref.get(harness.state.passiveInitialSpawnPending),
    }))
    expect(harness.commits()).toBe(2)
    expect(roster.state.entities.some(({ kind }) =>
      kind === 'cow' || kind === 'pig' || kind === 'sheep' || kind === 'chicken',
    )).toBe(true)
    expect(roster.state.entities.some(({ id }) => id === zombie.id)).toBe(false)
    expect(outputs.drops).toMatchObject([{ item: 'rotten_flesh', count: 1 }])
    expect(experienceOrbs.state.orbs.map(({ value, count }) => [Number(value), count ?? 1]))
      .toStrictEqual([[3, 1], [1, 2]])
    expect(outputs.lastPassiveSpawnTick).toBe(1)
    expect(outputs.passiveInitialSpawnPending).toBe(false)
  })

  it('feeds a variable casualty XP roll into the same-tick hostile spawn seed', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const detonatingCreeper: MobEntity = {
      ...creeperAt(0, 64),
      behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
    }
    const bee = {
      ...beeAt(3, 64, 1),
      killCredit: 'player' as const,
      lastHitTick: SimulationTick(0),
    }
    const deadSearchLightPositions: Array<string> = []
    const livingSearchLightPositions: Array<string> = []
    const spawnFloor = Array.from({ length: 16 * 16 }, (_, index) => {
      const x = 16 + index % 16
      const z = Math.floor(index / 16)
      return [blockPosition(BlockAxis(x), BlockAxis(63), BlockAxis(z)), STONE] as const
    })
    const creditedDeath = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [detonatingCreeper, bee],
      playerPose,
      blocks: spawnFloor,
      loadedChunks: ['1,0'],
      onLightRead: ({ x, y, z }) => deadSearchLightPositions.push(`${String(x)},${String(y)},${String(z)}`),
    }))
    const survivingBee = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [detonatingCreeper, { ...bee, healthPoints: EntityHealthPoints(20) }],
      playerPose,
      blocks: spawnFloor,
      loadedChunks: ['1,0'],
      onLightRead: ({ x, y, z }) => livingSearchLightPositions.push(`${String(x)},${String(y)},${String(z)}`),
    }))
    const initialRoster = await Effect.runPromise(strictRoster(creditedDeath.coordinator))
    const expectedHostileSearchPosition = (seed: number): string => {
      const rotation = nextRoll(seed).roll
      const firstRadius = MIN_SPAWN_DISTANCE_BLOCKS + SPAWN_RING_RADIUS_INSET_BLOCKS
      const angle = rotation / SPAWN_RING_ANGLES * 2 * Math.PI
      const x = Math.floor(playerPose.feetPosition.x + firstRadius * Math.cos(angle))
      const z = Math.floor(playerPose.feetPosition.z + firstRadius * Math.sin(angle))
      return `${String(x)},64,${String(z)}`
    }
    const expectedSeedFlowFor = (frameSeed: number) => {
      const sweep = planMobRosterSweep(initialRoster.state, {
        target: playerPose.feetPosition,
        dt: makeDeltaTimeSecs(0.02),
      }, RandomSeed(frameSeed))
      const blast = planMobBlastRoster(
        sweep.roster,
        sweep.blasts,
        SimulationTick(HOSTILE_SPAWN_INTERVAL_TICKS),
      )
      const drops = rollCasualtyDrops(blast.casualties, sweep.seed)
      const experienceRoll = nextRoll(drops.seed)
      return {
        frameSeed,
        casualties: blast.casualties,
        experienceRoll,
        expectedSearchPosition: expectedHostileSearchPosition(experienceRoll.seed),
        searchPositionWithoutExperienceRoll: expectedHostileSearchPosition(drops.seed),
      }
    }
    let seedFixture: ReturnType<typeof expectedSeedFlowFor> | undefined
    for (let frameSeed = 3; frameSeed < 131; frameSeed += 1) {
      const candidate = expectedSeedFlowFor(frameSeed)
      if (
        candidate.casualties.length === 1 && candidate.casualties[0]?.id === bee.id &&
        candidate.expectedSearchPosition !== candidate.searchPositionWithoutExperienceRoll
      ) {
        seedFixture = candidate
        break
      }
    }
    expect(seedFixture).toBeDefined()
    if (seedFixture === undefined) return
    const {
      frameSeed,
      casualties,
      experienceRoll: expectedExperienceRoll,
      expectedSearchPosition,
      searchPositionWithoutExperienceRoll,
    } = seedFixture
    expect(casualties.map(({ id }) => id)).toStrictEqual([bee.id])
    const runHostileSearchTick = async (harness: typeof creditedDeath) => {
      await Effect.runPromise(Ref.set(harness.state.rollSeed, frameSeed))
      await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.9)))
      await Effect.runPromise(Ref.set(harness.state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS - 1))
      await harness.run(makeDeltaTimeSecs(0.02))
    }
    await runHostileSearchTick(creditedDeath)
    await runHostileSearchTick(survivingBee)

    const deadRoster = await Effect.runPromise(strictRoster(creditedDeath.coordinator))
    const livingRoster = await Effect.runPromise(strictRoster(survivingBee.coordinator))
    const deadOrbs = await Effect.runPromise(creditedDeath.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const livingOrbs = await Effect.runPromise(survivingBee.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const outputs = await Effect.runPromise(Effect.all({
      deadSeed: Ref.get(creditedDeath.state.rollSeed),
      livingSeed: Ref.get(survivingBee.state.rollSeed),
      deadHostileTick: Ref.get(creditedDeath.state.lastHostileSpawnTick),
      livingHostileTick: Ref.get(survivingBee.state.lastHostileSpawnTick),
    }))
    const deadSearchCalls = await Effect.runPromise(creditedDeath.store.calls)
    const livingSearchCalls = await Effect.runPromise(survivingBee.store.calls)

    expect(deadOrbs.state.orbs.reduce((total, { value, count }) => total + Number(value) * (count ?? 1), 0)).toBe(
      1 + Math.floor(expectedExperienceRoll.roll * 3),
    )
    expect(livingOrbs.state.orbs).toStrictEqual([])
    expect(outputs.deadSeed).toBe(nextRoll(outputs.livingSeed).seed)
    expect(outputs.deadHostileTick).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
    expect(outputs.livingHostileTick).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
    expect(deadSearchCalls.peeks).toBeGreaterThan(0)
    expect(livingSearchCalls.peeks).toBeGreaterThan(0)
    expect(deadSearchLightPositions[0]).toBe(expectedSearchPosition)
    expect(deadSearchLightPositions[0]).not.toBe(searchPositionWithoutExperienceRoll)
    expect(livingSearchLightPositions[0]).toBeDefined()
    expect(deadRoster.state.entities.some(({ id }) => id === bee.id)).toBe(false)
    expect(livingRoster.state.entities.some(({ id }) => id === bee.id)).toBe(true)
  })

  it('merges an offered spawn ahead of the cadence search and drains the offered attempt', async () => {
    const ground: Array<readonly [ReturnType<typeof blockPosition>, BlockId]> = []
    const loadedChunks = new Set<string>()
    // The stage advances the seed as it sweeps the roster; floor the full 24-to-40
    // band so the search result does not depend on the cursor's resulting angle.
    for (let x = -48; x <= 47; x += 1) {
      for (let z = -48; z <= 47; z += 1) {
        ground.push([blockPosition(BlockAxis(x), BlockAxis(63), BlockAxis(z)), STONE])
      }
    }
    for (let chunkX = -3; chunkX <= 2; chunkX += 1) {
      for (let chunkZ = -3; chunkZ <= 2; chunkZ += 1) {
        loadedChunks.add(`${String(chunkX)},${String(chunkZ)}`)
      }
    }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      blocks: ground,
      loadedChunks: [...loadedChunks],
    }))
    const offered = {
      candidate: {
        groundBlock: STONE,
        footBlock: AIR_BLOCK_ID,
        headBlock: AIR_BLOCK_ID,
        blockLight: 0,
        skyLight: SkyLightLevel(0),
        biome: 'PLAINS' as const,
        timeOfDay: 0.9,
        distanceToPlayerBlocksXZ: 30,
      },
      kind: CREEPER_KIND,
      feetPosition: position(PositionAxis(30), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(harness.context.time.setTimeOfDay(InterpolationFraction(0.9)))
    await Effect.runPromise(requestMobSpawn(harness.state, offered))

    await Effect.runPromise(Ref.set(harness.state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS - 1))
    await harness.run(makeDeltaTimeSecs(0))

    const roster = await Effect.runPromise(strictRoster(harness.coordinator))
    expect(roster.state.entities).toHaveLength(2)
    expect(roster.state.entities[0]?.feetPosition).toStrictEqual(offered.feetPosition)
    expect(await Effect.runPromise(Ref.get(harness.state.spawnAttempts))).toStrictEqual([])
    expect(harness.commits()).toBe(1)
  })

  it('keeps an offered spawn queued when the valid owner serial is exhausted', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    await Effect.runPromise(harness.coordinator.commit({
      expectedRevision: rosterBefore.revision,
      expectedDimensions: [],
      changes: [{
        ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
        state: { ...rosterBefore.state, nextSerial: EntitySerial(Number.MAX_SAFE_INTEGER) },
      }],
    }))
    const exhaustedRoster = await Effect.runPromise(strictRoster(harness.coordinator))
    const offered = {
      candidate: {
        groundBlock: STONE,
        footBlock: AIR_BLOCK_ID,
        headBlock: AIR_BLOCK_ID,
        blockLight: 0,
        skyLight: SkyLightLevel(0),
        biome: 'PLAINS' as const,
        timeOfDay: 0.9,
        distanceToPlayerBlocksXZ: 30,
      },
      kind: CREEPER_KIND,
      feetPosition: position(PositionAxis(30), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestMobSpawn(harness.state, offered))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(1)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(exhaustedRoster)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(exhaustedRoster.revision)
    expect(await Effect.runPromise(Ref.get(harness.state.spawnAttempts))).toStrictEqual([offered])
    expect(await Effect.runPromise(Ref.get(harness.state.lastHostileSpawnTick))).toBe(0)
  })

  it('skips block edits when a valid finite mob position exceeds the block-axis range', async () => {
    const outsideSafeInteger = Number.MAX_SAFE_INTEGER + 1
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(outsideSafeInteger), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: {
        ...creeperAt(outsideSafeInteger, 64),
        behaviour: { _tag: 'Lit', burnedSecs: 1.49 },
      },
      playerPose,
    }))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.02))

    const rosterAfter = await Effect.runPromise(strictRoster(harness.coordinator))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
    expect(harness.commits()).toBe(1)
    expect(rosterAfter.state.entities).toStrictEqual([])
    expect(vitalsAfter.state.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
    expect(damages).toMatchObject([{ _tag: 'Explosion', source: EntityId('test:creeper') }])
    expect(harness.lastRequest()?.blockWrite).toBeUndefined()
    expect((await Effect.runPromise(harness.store.calls)).reads).toBe(0)
  })

  it('requeues the lower destination after a falling block moves', async () => {
    const target = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const source = blockPosition(BlockAxis(0), BlockAxis(65), BlockAxis(0))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      block: { position: source, id: SAND },
    }))
    await Effect.runPromise(Ref.update(harness.state.fallingBlocks, (queue) =>
      disturb(queue, [blockPositionKeyOf(target)]),
    ))

    await harness.run(makeDeltaTimeSecs(0))

    expect(await Effect.runPromise(harness.store.blockAt(target))).toBe(SAND)
    expect(await Effect.runPromise(harness.store.api.getBlock(source))).toStrictEqual({
      _tag: 'Block',
      block: AIR_BLOCK_ID,
    })
    expect([...((await Effect.runPromise(Ref.get(harness.state.fallingBlocks))).pending)]).toStrictEqual([
      blockPositionKeyOf(blockPosition(BlockAxis(0), BlockAxis(63), BlockAxis(0))),
      blockPositionKeyOf(source),
    ])
  })

  it('keeps entity, block, revision, and output state unchanged when a combined blast commit fails', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const harness = await Effect.runPromise(makeHarness({
      entity: { ...creeperAt(0, 64), behaviour: { _tag: 'Lit', burnedSecs: 1.49 } },
      block: { position: centre, id: STONE },
      rejectCommit: true,
    }))
    const ownerBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const playerBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const localBefore = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      cooldowns: Ref.get(harness.state.hostileContactCooldowns),
      attempts: Ref.get(harness.state.spawnAttempts),
    }))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(0.02 as DeltaTimeSecs).pipe(Effect.provide(FrameServicesLayer)),
    )
    const ownerAfter = await Effect.runPromise(strictRoster(harness.coordinator))
    const revisionAfter = await Effect.runPromise(harness.coordinator.revision)
    const playerAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const localAfter = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      cooldowns: Ref.get(harness.state.hostileContactCooldowns),
      attempts: Ref.get(harness.state.spawnAttempts),
    }))

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.blockWrite?.edits.length).toBeGreaterThan(0)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_ENTITIES_OWNER_ID)
    expect(ownerAfter).toStrictEqual(ownerBefore)
    expect(playerAfter.state).toStrictEqual(playerBefore.state)
    expect(revisionAfter).toBe(revisionBefore)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(localAfter).toStrictEqual(localBefore)
  })

  it('detonates registered TNT through one service commit with entity, player, and block candidates', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (fuseTicks) => {
        const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
        const tntId = EntityId('test:tnt')
        const harness = await Effect.runPromise(makeHarness({
          entity: creeperAt(0, 64),
          block: { position: centre, id: STONE },
          tnt: {
            tnts: [{
              id: tntId,
              dimension: INITIAL_DIMENSION,
              center: { x: 0, y: 64, z: 0 },
              state: { kind: 'primed', remainingFuseSecs: fuseTicks / 100 },
            }],
          },
        }))
        const tntBefore = await Effect.runPromise(
          harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
        )
        const entityBefore = await Effect.runPromise(strictRoster(harness.coordinator))
        const vitalsBefore = await Effect.runPromise(
          harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        )
        const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

        await harness.run(0.05 as DeltaTimeSecs)

        const tntAfter = await Effect.runPromise(
          harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
        )
        const entityAfter = await Effect.runPromise(strictRoster(harness.coordinator))
        const vitalsAfter = await Effect.runPromise(
          harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
        )
        const decodedTnt = Schema.decodeUnknownSync(TntServiceSnapshotSchema)(tntAfter.state)
        const decodedEntity = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(entityAfter.state)
        const revisionAfter = await Effect.runPromise(harness.coordinator.revision)
        const outputs = await Effect.runPromise(Effect.all({
          damages: Ref.get(harness.state.playerDamages),
          drops: Ref.get(harness.state.mobDrops),
          experience: Ref.get(harness.state.mobExperience),
        }))

        expect(harness.commits()).toBe(0)
        expect(harness.tntCommits()).toBe(1)
        expect(revisionAfter).toBe(revisionBefore + 1)
        expect(decodedTnt.tnts[0]?.state).toStrictEqual({ kind: 'detonated' })
        expect(decodedEntity.entities).toStrictEqual([])
        expect(vitalsAfter.state.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
        expect(await Effect.runPromise(harness.store.blockAt(centre))).toBeUndefined()
        expect(outputs.damages).toHaveLength(1)
        expect(Schema.decodeUnknownSync(GameplayEntityRosterSchema)(entityBefore.state).entities).toHaveLength(1)
        expect(Schema.decodeUnknownSync(TntServiceSnapshotSchema)(tntBefore.state).tnts[0]?.state.kind).toBe('primed')
      }),
      { numRuns: 8 },
    )
  })

  it('rolls player-triggered TNT cow experience from the frame seed and replays it', async () => {
    const tntId = EntityId('test:tnt-cow-xp')
    const cowId = EntityId('test:cow-xp')
    const run = async () => {
      const harness = await Effect.runPromise(makeHarness({
        entity: null,
        entities: [{
          id: cowId,
          kind: COW_KIND,
          feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
          healthPoints: EntityHealthPoints(1),
          behaviour: initialBehaviourOfKind(COW_KIND),
        }],
        block: { position: blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0)), id: STONE },
        tntSources: { sources: [{ tntId, killCredit: 'player-triggered-tnt' }] },
        tnt: {
          tnts: [{
            id: tntId,
          dimension: INITIAL_DIMENSION,
            center: { x: 0, y: 64, z: 0 },
            state: { kind: 'primed', remainingFuseSecs: 0.01 },
          }],
        },
      }))
      await Effect.runPromise(Ref.set(harness.state.rollSeed, 133))
      await harness.run(0.05 as DeltaTimeSecs)
      const { drops, experienceOrbs, seed } = await Effect.runPromise(Effect.all({
        drops: Ref.get(harness.state.mobDrops),
        experienceOrbs: harness.coordinator.snapshot(
          GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
          ExperienceOrbOwnerSnapshotSchema,
        ),
        seed: Ref.get(harness.state.rollSeed),
      }))
      return { drops, experience: experienceOrbs.state.orbs.map(({ value }) => Number(value)), seed }
    }

    const first = await run()
    const replay = await run()
    expect(first.drops).toContainEqual(expect.objectContaining({
      source: cowId,
      kind: COW_KIND,
      item: 'beef',
    }))
    expect(first.experience).toStrictEqual([3])
    expect(replay).toStrictEqual(first)
    expect(first.seed).not.toBe(133)
  })

  it('wears equipped armor in the same owner revision as TNT blast damage', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      playerStorage: equippedIronHelmetStorage(),
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-armor-wear'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(makeDeltaTimeSecs(0.05))

    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    expect(harness.tntCommits()).toBe(1)
    expect(storageAfter.revision).toBe(revisionBefore + 1)
    expect(storageAfter.state.equipment.slots.head?.durability?.current).toBeLessThan(
      storageBefore.state.equipment.slots.head?.durability?.current ?? Number.MAX_SAFE_INTEGER,
    )
  })

  it('breaks the final helmet point and applies a TNT blast with z-only knockback', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(63.1), PositionAxis(2)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      playerStorage: nearlyBrokenIronHelmetStorage(),
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-z-knockback'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.05))

    const playerAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    expect(harness.tntCommits()).toBe(1)
    expect(playerAfter.state.pose.feetPosition).toMatchObject({ x: 0, y: 63.1 })
    expect(playerAfter.state.pose.feetPosition.z).toBeGreaterThan(2)
    expect(storageBefore.state.equipment.slots.head?.durability?.current).toBe(1)
    expect(storageAfter.state.equipment.slots.head).toBeNull()
    expect(vitalsAfter.state.vitals.healthPoints).toBeLessThan(vitalsBefore.state.vitals.healthPoints)
  })

  it('keeps a player at the blast center and preserves depleted vitals', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(63.1), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      vitals: { ...SPAWN_VITALS, healthPoints: EntityHealthPoints(0) },
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-centered-on-depleted-player'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.05))

    const playerAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const damages = await Effect.runPromise(Ref.get(harness.state.playerDamages))
    expect(harness.tntCommits()).toBe(1)
    expect(playerAfter.state).toStrictEqual(playerBefore.state)
    expect(vitalsAfter.state).toStrictEqual(vitalsBefore.state)
    expect(damages).toMatchObject([{
      _tag: 'Explosion',
      damage: { cause: 'explosion' },
    }])
    expect(damages[0]?.damage.amount).toBeGreaterThan(0)
  })

  it('leaves the falling-block queue alone when a TNT blast destroys no blocks', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const bedrock = Option.getOrThrow(blockIdOf('bedrock'))
    const blocks: Array<readonly [ReturnType<typeof blockPosition>, BlockId]> = []
    for (let x = -3; x <= 3; x += 1) {
      for (let y = 61; y <= 67; y += 1) {
        for (let z = -3; z <= 3; z += 1) {
          blocks.push([blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z)), bedrock])
        }
      }
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      blocks,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-no-destroyed-blocks'),
          dimension: INITIAL_DIMENSION,
          center: { x: centre.x, y: centre.y, z: centre.z },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const fallingBefore = await Effect.runPromise(Ref.get(harness.state.fallingBlocks))

    await harness.run(makeDeltaTimeSecs(0.05))

    const current = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const calls = await Effect.runPromise(harness.store.calls)
    expect(harness.tntCommits()).toBe(1)
    expect(current.state.tnts[0]?.state).toStrictEqual({ kind: 'detonated' })
    expect(calls.writes).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.fallingBlocks))).toStrictEqual(fallingBefore)
  })

  it('fails TNT planning at either unsafe block-axis boundary before committing', async () => {
    const assertBoundaryFailure = async (x: number) => {
      const harness = await Effect.runPromise(makeHarness({
        entity: null,
        tnt: {
          tnts: [{
            id: EntityId(`test:tnt-boundary-${x}`),
            dimension: INITIAL_DIMENSION,
            center: { x, y: 64, z: 0 },
            state: { kind: 'primed', remainingFuseSecs: 0 },
          }],
        },
      }))
      const before = await Effect.runPromise(harness.coordinator.snapshot(
        TNT_REPLICATED_OWNER_ID,
        TntServiceSnapshotSchema,
      ))

      const exit = await Effect.runPromiseExit(
        harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
      )

      expect(exit._tag).toBe('Failure')
      expect(harness.commits()).toBe(0)
      expect(harness.tntCommits()).toBe(0)
      expect(await Effect.runPromise(harness.coordinator.snapshot(
        TNT_REPLICATED_OWNER_ID,
        TntServiceSnapshotSchema,
      ))).toStrictEqual(before)
    }
    await Promise.all([
      Number.MAX_SAFE_INTEGER + 10,
      Number.MAX_SAFE_INTEGER,
    ].map(assertBoundaryFailure))
  })

  it('does not include or damage a player in a different dimension during TNT detonation', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      dimension: Schema.decodeUnknownSync(DimensionIdSchema)('nether'),
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-other-dimension'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(makeDeltaTimeSecs(0.05))

    expect(harness.tntCommits()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).state).toStrictEqual(vitalsBefore.state)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('does not damage a mob in another dimension at the same coordinates during TNT detonation', async () => {
    const overworldDimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
    const netherDimension = Schema.decodeUnknownSync(DimensionIdSchema)('nether')
    const overworldMob: MobEntity = {
      ...zombieAt(1, 64),
      id: EntityId('test:overworld-mob'),
      healthPoints: EntityHealthPoints(100),
      dimension: overworldDimension,
    }
    const netherMob: MobEntity = {
      ...zombieAt(1, 64),
      id: EntityId('test:nether-mob'),
      healthPoints: EntityHealthPoints(100),
      dimension: netherDimension,
    }
    const harness = await Effect.runPromise(makeHarness({
      entities: [overworldMob, netherMob],
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(20), PositionAxis(64), PositionAxis(0)),
      },
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-dimension-filter'),
          dimension: overworldDimension,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))

    await harness.run(makeDeltaTimeSecs(0.05))

    const final = await Effect.runPromise(strictRoster(harness.coordinator))
    const sameDimensionMob = final.state.entities.find(({ id }) => id === overworldMob.id)
    const otherDimensionMob = final.state.entities.find(({ id }) => id === netherMob.id)
    expect(sameDimensionMob?.healthPoints).toBeLessThan(EntityHealthPoints(100))
    expect(otherDimensionMob?.healthPoints).toBe(EntityHealthPoints(100))
    expect(otherDimensionMob?.dimension).toBe(netherDimension)
  })

  it('keeps a schema-valid blast-immune block intact during TNT detonation', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const bedrock = Option.getOrThrow(blockIdOf('bedrock'))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      block: { position: centre, id: bedrock },
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-bedrock'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))

    await harness.run(makeDeltaTimeSecs(0.05))

    expect(harness.tntCommits()).toBe(1)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(bedrock)
  })

  it('fails TNT detonation before planning when the owner snapshots have different revisions', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-revision-mismatch'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_PLAYER_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(tntBefore)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
  })

  it('uses the entity observation revision when that snapshot races another owner transaction', async () => {
    const tntId = EntityId('test:tnt-roster-observation-race')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    let injected = false
    const coordinator: WorldCommitCoordinatorApi = {
      ...harness.coordinator,
      observe: (...args) => Effect.gen(function* () {
        if (!injected) {
          injected = true
          const player = yield* harness.coordinator.snapshot(
            GAMEPLAY_PLAYER_OWNER_ID,
            PlayerServiceSnapshotSchema,
          )
          yield* Effect.orDie(harness.coordinator.commit({
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
                    x: player.state.pose.feetPosition.x + 1,
                  },
                },
              },
            }],
          }))
        }
        return yield* harness.coordinator.observe(...args)
      }),
    }
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, coordinator },
    }

    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(injected).toBe(true)
    expect(harness.commits()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).state).toStrictEqual(tntBefore.state)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))).state.pose.feetPosition.x).toBe(playerBefore.state.pose.feetPosition.x + 1)
  })

  it.each([
    ['player storage', GAMEPLAY_PLAYER_STORAGE_OWNER_ID],
    ['vitals', GAMEPLAY_VITALS_OWNER_ID],
  ] as const)('does not commit TNT when the %s snapshot revision differs', async (_label, ownerId) => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-owner-revision-mismatch'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(ownerId)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).state).toStrictEqual(tntBefore.state)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('uses the observed revision when a valid player transaction races TNT owner observation', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-observation-race'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const playerBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    let injected = false
    const coordinator: WorldCommitCoordinatorApi = {
      ...harness.coordinator,
      dimensionRevision: (dimension) => Effect.orDie(Effect.gen(function* () {
        const dimensionRevision = yield* harness.coordinator.dimensionRevision(dimension)
        if (!injected) {
          injected = true
          const player = yield* harness.coordinator.snapshot(
            GAMEPLAY_PLAYER_OWNER_ID,
            PlayerServiceSnapshotSchema,
          )
          yield* harness.coordinator.commit({
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
                    x: player.state.pose.feetPosition.x + 1,
                  },
                },
              },
            }],
          })
        }
        return dimensionRevision
      })),
    }
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, coordinator },
    }

    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(injected).toBe(true)
    expect(harness.commits()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore + 1)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_OWNER_ID,
      PlayerServiceSnapshotSchema,
    ))).state.pose.feetPosition.x).toBe(playerBefore.state.pose.feetPosition.x + 1)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).state).toStrictEqual(tntBefore.state)
  })

  it('records TNT as unsupported when its blast affects a player without a registered vitals owner', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-missing-vitals-owner'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const { vitalsOwnerId: _omittedVitalsOwner, ...commitWithoutVitalsOwner } = harness.context.commit!
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutVitalsOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(tntBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.playerDamages))).toStrictEqual([])
  })

  it('commits blast loot without XP when TNT has no player ignition credit', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const tntId = EntityId('test:tnt-with-loot')
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const unknownMob = {
      ...zombieAt(1, 64),
      id: EntityId('test:tnt-unknown-mob'),
      kind: EntityKind('unregistered'),
      healthPoints: EntityHealthPoints(1),
    }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(2), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      entities: [zombie, unknownMob],
      playerPose,
      block: { position: centre, id: STONE },
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))

    await harness.run(0.02 as DeltaTimeSecs)

    const entities = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedItems = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
    )
    const player = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const outputs = await Effect.runPromise(Effect.all({
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      unsupported: Ref.get(harness.state.unsupportedOperations),
    }))

    expect(harness.tntCommits()).toBe(1)
    expect(entities.state.entities).toStrictEqual([])
    expect(droppedItems.state.items).toHaveLength(1)
    expect(droppedItems.state.items[0]?.behaviour).toMatchObject({
      _tag: 'DroppedItem',
      item: 'rotten_flesh',
      count: 1,
    })
    expect(player.state.pose.feetPosition.x).not.toBe(playerPose.feetPosition.x)
    expect(outputs.drops).toMatchObject([{ item: 'rotten_flesh', count: 1 }])
    expect(outputs.experience).toStrictEqual([])
    expect(outputs.unsupported).toContainEqual({
      _tag: 'Unsupported',
      action: 'MobExperience',
      reason: 'UnknownMobKind',
      mobKind: 'unregistered',
    })
  })

  it('awards XP only for TNT with player ignition provenance and consumes that provenance', async () => {
    const tntId = EntityId('test:player-triggered-tnt')
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombie,
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(20), PositionAxis(64), PositionAxis(0)),
      },
      tntSources: {
        sources: [{ tntId, killCredit: 'player-triggered-tnt' }],
      },
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))

    await harness.run(makeDeltaTimeSecs(0.05))

    const experienceOrbs = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const sources = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_TNT_SOURCES_OWNER_ID,
      GameplayTntSourcesSnapshotSchema,
    ))
    expect(experienceOrbs.state.orbs.reduce((total, { value, count }) => total + Number(value) * (count ?? 1), 0))
      .toBe(5)
    expect(sources.state.sources).toStrictEqual([])
    expect(harness.tntCommits()).toBe(1)
  })

  it('keeps TNT casualty loot unsupported when the dropped-item owner is absent', async () => {
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(20), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombie,
      playerPose,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-with-unregistered-loot-owner'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const { droppedItemsOwnerId: _omittedOwner, ...commitWithoutDroppedOwner } = harness.context.commit!
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutDroppedOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.02)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).not.toContain(
      TNT_REPLICATED_OWNER_ID,
    )
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).state).toStrictEqual(tntBefore.state)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('does not commit TNT loot when the dropped-item owner snapshot revision differs', async () => {
    const zombie = { ...zombieAt(1, 64), healthPoints: EntityHealthPoints(1) }
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(2), PositionAxis(64), PositionAxis(0)),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: zombie,
      playerPose,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-dropped-owner-revision-mismatch'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.rollSeed, 3))
    const tntBefore = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const rosterBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const outputsBefore = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
    }))
    harness.mismatchNextSnapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID)

    const exit = await Effect.runPromiseExit(
      harness.stage.run(makeDeltaTimeSecs(0.02)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(tntBefore)
    expect(await Effect.runPromise(strictRoster(harness.coordinator))).toStrictEqual(rosterBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
    }))).toStrictEqual(outputsBefore)
  })

  it('advances a live TNT fuse with the service-owned single commit', async () => {
    const tntId = EntityId('test:tnt')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 1 },
        }],
      },
    }))
    const before = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(0.1 as DeltaTimeSecs)

    const after = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const decoded = Schema.decodeUnknownSync(TntServiceSnapshotSchema)(after.state)
    expect(harness.commits()).toBe(1)
    expect(harness.tntCommits()).toBe(0)
    expect(after.revision).toBe(revisionBefore + 1)
    expect(decoded.tnts[0]?.state).toStrictEqual({ kind: 'primed', remainingFuseSecs: 0.9 })
    expect(Schema.decodeUnknownSync(TntServiceSnapshotSchema)(before.state).tnts[0]?.state.kind).toBe('primed')
  })

  it('does not report a missing TNT service when its registered owner has no primed record', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      provideTntService: false,
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))

    await harness.run(makeDeltaTimeSecs(0.05))

    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(before)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
    expect(harness.commits()).toBe(0)
  })

  it('reports an unregistered TNT service owner as unsupported', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const tntService = await Effect.runPromise(makeTntService(
      makeReplicatedOwnerId('test:unregistered-tnt-service-owner'),
    ).pipe(Effect.provideService(WorldCommitCoordinator, harness.coordinator)))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, tntService },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('propagates a schema mismatch when the registered TNT owner id names another owner', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, provideTntService: false }))
    const { tntService: _tntService, ...commitWithoutService } = harness.context.commit!
    void _tntService
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...commitWithoutService,
        tntOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
      },
    }

    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
  })

  it('propagates a schema mismatch from a TNT service bound to another registered owner', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const tntService = await Effect.runPromise(makeTntService(
      GAMEPLAY_ENTITIES_OWNER_ID,
    ).pipe(Effect.provideService(WorldCommitCoordinator, harness.coordinator)))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, tntService },
    }

    const exit = await Effect.runPromiseExit(
      makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(Effect.provide(FrameServicesLayer)),
    )

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
  })

  it('skips a primed TNT record already advanced by another owner transaction', async () => {
    const tntId = EntityId('test:tnt-raced-detonation')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    const tntService = harness.context.commit!.tntService!
    let snapshotReads = 0
    const interleavedService = {
      ...tntService,
      snapshot: Effect.suspend(() => Effect.gen(function* () {
        const snapshot = yield* tntService.snapshot
        snapshotReads += 1
        if (snapshotReads === 1) {
          const state: TntServiceSnapshot = {
            tnts: snapshot.state.tnts.map((record) => record.id === tntId
              ? { ...record, state: { kind: 'detonated' as const } }
              : record),
          }
          yield* harness.coordinator.commit({
            expectedRevision: snapshot.revision,
            expectedDimensions: [],
            changes: [{ ownerId: TNT_REPLICATED_OWNER_ID, state }],
          })
        }
        return snapshot
      })),
    }
    const context: GameplayStageContext = {
      ...harness.context,
      commit: { ...harness.context.commit!, tntService: interleavedService },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.02)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    const current = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    expect(snapshotReads).toBe(2)
    expect(current.state.tnts[0]?.state).toStrictEqual({ kind: 'detonated' })
    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      TNT_REPLICATED_OWNER_ID,
    ])
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toStrictEqual([])
  })

  it('reports the missing TNT service when the registered TNT owner has a primed record', async () => {
    const tntId = EntityId('test:tnt')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      provideTntService: false,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 1 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )

    await harness.run(0.1 as DeltaTimeSecs)

    const tntAfter = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const unsupported = await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))

    expect(unsupported).toContainEqual(expect.objectContaining({
      action: 'MobSimulation',
      reason: 'TntServiceUnavailable',
    }))
    expect(tntAfter).toStrictEqual(tntBefore)
    expect(harness.commits()).toBe(0)
  })

  it('records an unavailable TNT owner when the host supplies an unknown owner id', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null, provideTntService: false }))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        tntOwnerId: makeReplicatedOwnerId('test:unknown-tnt-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.1)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('reports a missing TNT owner id before advancing a registered primed TNT', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-without-owner-id'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 1 },
        }],
      },
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const { tntOwnerId: omittedTntOwner, ...commitWithoutTntOwner } = harness.context.commit!
    void omittedTntOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutTntOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.1)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(before)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('requires the TNT provenance owner before planning a due detonation', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-without-provenance-owner'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const { tntSourcesOwnerId: omittedTntSourcesOwner, ...commitWithoutTntSourcesOwner } =
      harness.context.commit!
    void omittedTntSourcesOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutTntSourcesOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(before)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'OwnerRegistrationUnavailable' }),
    )
  })

  it('does not plan TNT detonation without a registered entity roster owner', async () => {
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      tnt: {
        tnts: [{
          id: EntityId('test:tnt-without-roster-owner'),
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0 },
        }],
      },
    }))
    const before = await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))
    const { entitiesOwnerId: omittedEntitiesOwner, ...commitWithoutEntitiesOwner } = harness.context.commit!
    void omittedEntitiesOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutEntitiesOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0.05)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.tntCommits()).toBe(0)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      TNT_REPLICATED_OWNER_ID,
      TntServiceSnapshotSchema,
    ))).toStrictEqual(before)
    expect(await Effect.runPromise(drainGameplayUnsupportedOperations(harness.state))).toContainEqual(
      expect.objectContaining({ action: 'MobSimulation', reason: 'EntityRosterOwnerUnavailable' }),
    )
  })

  it('keeps owners, blocks, revision, and output queues unchanged when TNT commit fails', async () => {
    const centre = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
    const tntId = EntityId('test:tnt')
    const harness = await Effect.runPromise(makeHarness({
      entity: creeperAt(0, 64),
      block: { position: centre, id: STONE },
      rejectTntSnapshotCommit: true,
      tnt: {
        tnts: [{
          id: tntId,
          dimension: INITIAL_DIMENSION,
          center: { x: 0, y: 64, z: 0 },
          state: { kind: 'primed', remainingFuseSecs: 0.01 },
        }],
      },
    }))
    const tntBefore = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const entityBefore = await Effect.runPromise(strictRoster(harness.coordinator))
    const playerBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const storageBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
    )
    const vitalsBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
    )
    const droppedBefore = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
    )
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const outputsBefore = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      fallingBlocks: Ref.get(harness.state.fallingBlocks),
      unsupported: Ref.get(harness.state.unsupportedOperations),
    }))

    const exit = await Effect.runPromiseExit(
      harness.stage.run(0.02 as DeltaTimeSecs).pipe(Effect.provide(FrameServicesLayer)),
    )

    const tntAfter = await Effect.runPromise(
      harness.coordinator.snapshot(TNT_REPLICATED_OWNER_ID, TntServiceSnapshotSchema),
    )
    const entityAfter = await Effect.runPromise(strictRoster(harness.coordinator))
    const playerAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_OWNER_ID, PlayerServiceSnapshotSchema),
    )
    const storageAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
    )
    const vitalsAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema),
    )
    const droppedAfter = await Effect.runPromise(
      harness.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
    )
    const revisionAfter = await Effect.runPromise(harness.coordinator.revision)
    const outputsAfter = await Effect.runPromise(Effect.all({
      seed: Ref.get(harness.state.rollSeed),
      damages: Ref.get(harness.state.playerDamages),
      drops: Ref.get(harness.state.mobDrops),
      experience: Ref.get(harness.state.mobExperience),
      fallingBlocks: Ref.get(harness.state.fallingBlocks),
      unsupported: Ref.get(harness.state.unsupportedOperations),
    }))

    expect(exit._tag).toBe('Failure')
    expect(harness.commits()).toBe(0)
    expect(harness.tntCommits()).toBe(1)
    expect(harness.tntSnapshotCommits()).toBe(1)
    expect(tntAfter).toStrictEqual(tntBefore)
    expect(entityAfter).toStrictEqual(entityBefore)
    expect(playerAfter).toStrictEqual(playerBefore)
    expect(storageAfter).toStrictEqual(storageBefore)
    expect(vitalsAfter).toStrictEqual(vitalsBefore)
    expect(droppedAfter).toStrictEqual(droppedBefore)
    expect(revisionAfter).toBe(revisionBefore)
    expect(await Effect.runPromise(harness.store.blockAt(centre))).toBe(STONE)
    expect(outputsAfter).toStrictEqual(outputsBefore)
  })

  it('commits registered dropped-item pickup owners once and publishes its event afterward', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item'),
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(3),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 1,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const beforeStorage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const beforeDropped = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))

    await harness.run(0 as DeltaTimeSecs)

    const afterStorage = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const afterDropped = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const executions = await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))

    expect(harness.commits()).toBe(1)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    ])
    expect(harness.lastRequest()?.blockWrite).toBeUndefined()
    expect(afterStorage.revision).toBe(beforeStorage.revision + 1)
    expect(afterDropped.revision).toBe(beforeDropped.revision + 1)
    expect(afterStorage.state.inventory.slots.some(
      (slot) => slot?.item === 'gunpowder' && slot.count === 3,
    )).toBe(true)
    expect(afterDropped.state.items).toStrictEqual([])
    expect(executions).toHaveLength(1)
    expect(executions[0]?.outcome).toMatchObject({
      _tag: 'Completed',
      result: [{
        event: {
          _tag: 'ItemPickedUp',
          source: { _tag: 'DroppedItem', id: droppedItem.id },
          count: 3,
        },
      }],
    })
  })

  it('records an unknown registered dropped-item snapshot as a typed failure without committing', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item-missing-owner'),
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(2),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 10,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        droppedItemsOwnerId: makeReplicatedOwnerId('test:unknown-dropped-items-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Failed', error: { _tag: 'ReplicatedOwnerUnknown' } } },
    ])
  })

  it('keeps dropped-item pickup typed when its host owner is not registered', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const request = {
      actor: EntityId('test:player'),
      tick: 1,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const { droppedItemsOwnerId: omittedOwner, ...commitWithoutDroppedOwner } = harness.context.commit!
    void omittedOwner
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutDroppedOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' } },
    ])
  })

  it('keeps queued pickup and XP requests typed when the host has no commit coordinator', async () => {
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const pickupRequest = {
      actor: EntityId('test:player'),
      tick: 11,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const absorptionRequest = {
      actor: EntityId('test:player'),
      orb: EntityId('test:xp-orb-without-coordinator'),
      tick: 12,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, pickupRequest))
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, absorptionRequest))
    const context: GameplayStageContext = { ...harness.context, commit: undefined }

    await Effect.runPromise(makeEntitiesStage(context).run(makeDeltaTimeSecs(0)).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request: pickupRequest, outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' } },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request: absorptionRequest, outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' } },
    ])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
  })

  it('completes a registered dropped-item pickup with no nearby eligible item without committing', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item-out-of-range'),
      feetPosition: position(PositionAxis(10), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(2),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 4,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Completed', result: [] } },
    ])
  })

  it('requeues the complete dropped-item pickup after commit rejection without changing owners or output', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item-retry'),
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(2),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      rejectCommit: true,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 2,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(0 as DeltaTimeSecs)

    const storageAfterFailure = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedAfterFailure = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    expect(harness.commits()).toBe(1)
    expect(storageAfterFailure).toStrictEqual(storageBefore)
    expect(droppedAfterFailure).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toHaveLength(1)
    expect((await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups)))[0]).toBe(request)
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toStrictEqual([])

    harness.rejectCommits(false)
    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(2)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Completed' } },
    ])
  })

  it('requeues dropped-item pickup after a valid snapshot revision mismatch', async () => {
    const droppedItem = {
      id: EntityId('test:dropped-item-revision-mismatch'),
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      behaviour: {
        _tag: 'DroppedItem' as const,
        item: 'gunpowder' as const,
        count: StackCount(2),
        durability: null,
      },
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      droppedItems: { items: [droppedItem] },
    }))
    const request = {
      actor: EntityId('test:player'),
      tick: 8,
      position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    await Effect.runPromise(requestDroppedItemPickup(harness.state, request))
    const storageBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const droppedBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID)

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))).toStrictEqual(storageBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
      DroppedItemOwnerSnapshotSchema,
    ))).toStrictEqual(droppedBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingDroppedItemPickups))).toStrictEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.droppedItemPickupExecutions))).toStrictEqual([])
  })

  it('removes an expired XP orb through the registered entities stage', async () => {
    const orbId = EntityId('test:expired-unpositioned-xp-orb')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: {
        orbs: [{
          id: orbId,
          value: Result.getOrThrow(createExperienceOrbValue(2)),
          spawnedAt: SimulationTick(0),
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(6001)))

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(1)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).state.orbs).toStrictEqual([])
  })

  it('keeps an in-range XP orb stationary and uncollected during its pickup cooldown', async () => {
    const orbId = EntityId('test:cooldown-stationary-xp-orb')
    const orb = {
      id: orbId,
      value: Result.getOrThrow(createExperienceOrbValue(2)),
      position: Schema.decodeUnknownSync(WorldPositionSchema)({
        dimension: INITIAL_DIMENSION,
        ...position(PositionAxis(0.5), PositionAxis(64), PositionAxis(0)),
      }),
      spawnedAt: SimulationTick(0),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
      experienceOrbs: { orbs: [orb] },
    }))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(1)))
    await Effect.runPromise(Ref.set(harness.state.lastExperienceOrbPickupTick, SimulationTick(1)))

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(0)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).state.orbs).toStrictEqual([orb])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
  })

  it('leaves a positioned XP orb outside the attraction radius untouched', async () => {
    const orb = {
      id: EntityId('test:out-of-range-xp-orb'),
      value: Result.getOrThrow(createExperienceOrbValue(2)),
      position: Schema.decodeUnknownSync(WorldPositionSchema)({
        dimension: INITIAL_DIMENSION,
        ...position(PositionAxis(12), PositionAxis(64), PositionAxis(0)),
      }),
      spawnedAt: SimulationTick(0),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
      experienceOrbs: { orbs: [orb] },
    }))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(1)))

    await harness.run(makeDeltaTimeSecs(0.05))

    expect(harness.commits()).toBe(0)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).state.orbs).toStrictEqual([orb])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
  })

  it('records a rejected owner commit when moving an attracted XP orb', async () => {
    const orb = {
      id: EntityId('test:xp-orb-movement-commit-rejected'),
      value: Result.getOrThrow(createExperienceOrbValue(2)),
      position: Schema.decodeUnknownSync(WorldPositionSchema)({
        dimension: INITIAL_DIMENSION,
        ...position(PositionAxis(5), PositionAxis(64), PositionAxis(0)),
      }),
      spawnedAt: SimulationTick(0),
    }
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      rejectCommit: true,
      playerPose: {
        ...INITIAL_PLAYER_POSE,
        feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      },
      experienceOrbs: { orbs: [orb] },
    }))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(1)))

    await harness.run(makeDeltaTimeSecs(0.05))

    expect(harness.commits()).toBe(1)
    expect((await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).state.orbs).toStrictEqual([orb])
    expect(await Effect.runPromise(Ref.get(harness.state.operationFailures))).toMatchObject([{
      _tag: 'Failed',
      operation: 'WorldCommit',
      subject: 'ExperienceOrb',
      error: { _tag: 'WorldRevisionConflict' },
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
  })

  it('attracts and automatically picks up an XP orb, mending an equipped helmet before crediting leftover XP', async () => {
    // Java Edition 26.3 Mending repairs 2 durability per XP: https://minecraft.wiki/w/Mending
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const orbId = EntityId('test:mending-xp-orb')
    const orbValue = Result.getOrThrow(createExperienceOrbValue(5))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      playerStorage: mendingIronHelmetStorage(),
      vitals: SPAWN_VITALS,
      experienceOrbs: {
        orbs: [{
          id: EntityId('test:legacy-unpositioned-experience-orb'),
          value: Result.getOrThrow(createExperienceOrbValue(1)),
        }, {
          id: orbId,
          value: orbValue,
          position: Schema.decodeUnknownSync(WorldPositionSchema)({
            dimension: INITIAL_DIMENSION,
            ...position(PositionAxis(1.02), PositionAxis(64), PositionAxis(0)),
          }),
          spawnedAt: SimulationTick(0),
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(1)))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(makeDeltaTimeSecs(0.05))

    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const executions = await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))
    const helmet = storageAfter.state.equipment.slots.head

    expect(harness.commits()).toBe(2)
    expect(storageAfter.revision).toBe(revisionBefore + 2)
    expect(vitalsAfter.revision).toBe(revisionBefore + 2)
    expect(orbsAfter.revision).toBe(revisionBefore + 2)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_PLAYER_STORAGE_OWNER_ID)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_VITALS_OWNER_ID)
    expect(harness.lastRequest()?.changes.map(({ ownerId }) => ownerId)).toContain(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID)
    expect(helmet?.durability).toStrictEqual({ current: 165, max: 165 })
    expect(vitalsAfter.state.vitals.totalExperience).toBe(4)
    expect(orbsAfter.state.orbs).toStrictEqual([{
      id: EntityId('test:legacy-unpositioned-experience-orb'),
      value: Result.getOrThrow(createExperienceOrbValue(1)),
    }])
    expect(await Effect.runPromise(Ref.get(harness.state.lastExperienceOrbPickupTick))).toBe(SimulationTick(1))
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
    expect(executions).toMatchObject([{
      request: {
        actor: EntityId('mx-gameplay:player-avatar'),
        orb: orbId,
        tick: SimulationTick(1),
      },
      outcome: { _tag: 'Completed' },
    }])
  })

  it('consumes an XP orb completely when Mending repairs exactly its full durability value', async () => {
    // Java Edition 26.3 Mending repairs 2 durability per XP; a 5-XP orb repairs
    // this helmet's 10 missing durability and leaves no XP to credit.
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const orbId = EntityId('test:mending-full-consumption-orb')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      playerStorage: mendingIronHelmetStorage(155),
      vitals: SPAWN_VITALS,
      experienceOrbs: {
        orbs: [{
          id: orbId,
          value: Result.getOrThrow(createExperienceOrbValue(5)),
          position: Schema.decodeUnknownSync(WorldPositionSchema)({
            dimension: INITIAL_DIMENSION,
            ...position(PositionAxis(1.02), PositionAxis(64), PositionAxis(0)),
          }),
          spawnedAt: SimulationTick(0),
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(1)))

    await harness.run(makeDeltaTimeSecs(0.05))

    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))

    expect(storageAfter.state.equipment.slots.head?.durability).toStrictEqual({ current: 165, max: 165 })
    expect(vitalsAfter.state.vitals.totalExperience).toBe(0)
    expect(orbsAfter.state.orbs).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([{
      request: { orb: orbId },
      outcome: { _tag: 'Completed', result: [{ _tag: 'ExperienceCollected', amount: 5, orb: orbId }] },
    }])
  })

  it('absorbs one orb from a stacked XP orb and keeps the remaining count', async () => {
    const orbId = EntityId('test:stacked-xp-orb')
    const orbValue = Result.getOrThrow(createExperienceOrbValue(5))
    const orbCount = Result.getOrThrow(Schema.decodeUnknownResult(ExperienceOrbCountSchema)(2))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: orbValue, count: orbCount }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 4,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))

    await harness.run(0 as DeltaTimeSecs)

    const orbsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    expect(orbsAfter.state.orbs).toStrictEqual([{ id: orbId, value: orbValue, count: 1 }])
    expect(vitalsAfter.state.vitals.totalExperience).toBe(5)
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([{
      request,
      outcome: { _tag: 'Completed', result: [{ _tag: 'ExperienceCollected', amount: 5, orb: orbId }] },
    }])
  })

  it('commits registered XP-orb absorption once and requeues after an atomic rejection', async () => {
    const orbId = EntityId('test:xp-orb')
    const orbValue = Result.getOrThrow(createExperienceOrbValue(5))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      rejectCommit: true,
      experienceOrbs: { orbs: [{ id: orbId, value: orbValue }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 3,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(1)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).toStrictEqual(orbsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toStrictEqual([])

    harness.rejectCommits(false)
    await harness.run(0 as DeltaTimeSecs)

    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const executions = await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))
    expect(harness.commits()).toBe(2)
    expect(vitalsAfter.state.vitals.totalExperience).toBe(5)
    expect(orbsAfter.state.orbs).toStrictEqual([])
    expect(vitalsAfter.revision).toBe(revisionBefore + 1)
    expect(orbsAfter.revision).toBe(revisionBefore + 1)
    expect(executions).toMatchObject([{
      request,
      outcome: {
        _tag: 'Completed',
        result: [{ _tag: 'ExperienceCollected', amount: 5, orb: orbId }],
      },
    }])
  })

  it('requeues XP-orb absorption after a valid snapshot revision mismatch', async () => {
    const orbId = EntityId('test:xp-orb-revision-mismatch')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: Result.getOrThrow(createExperienceOrbValue(4)) }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 9,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID)

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).toStrictEqual(orbsBefore)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toStrictEqual([])
  })

  it('requeues XP-orb absorption when the player-storage snapshot races, then retries successfully', async () => {
    const orbId = EntityId('test:xp-orb-storage-revision-mismatch')
    const orbValue = Result.getOrThrow(createExperienceOrbValue(4))
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: orbValue }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 10,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const revisionBefore = await Effect.runPromise(harness.coordinator.revision)
    harness.mismatchNextSnapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID)

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.mismatchedSnapshots()).toBe(1)
    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.revision)).toBe(revisionBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([request])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toStrictEqual([])

    await harness.run(0 as DeltaTimeSecs)

    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))
    expect(harness.commits()).toBe(1)
    expect(vitalsAfter.state.vitals.totalExperience).toBe(4)
    expect(orbsAfter.state.orbs).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([{
      request,
      outcome: { _tag: 'Completed', result: [{ _tag: 'ExperienceCollected', amount: 4, orb: orbId }] },
    }])
  })

  it('keeps XP-orb absorption typed when its owner is not registered', async () => {
    const orbId = EntityId('test:xp-orb-unregistered')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: Result.getOrThrow(createExperienceOrbValue(3)) }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 5,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const { experienceOrbsOwnerId: _omittedOwner, ...commitWithoutOrbOwner } = harness.context.commit!
    const context: GameplayStageContext = {
      ...harness.context,
      commit: commitWithoutOrbOwner,
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' } },
    ])
  })

  it('uses Mending on a damaged main-hand pickaxe before crediting the remaining XP', async () => {
    const playerPose = {
      ...INITIAL_PLAYER_POSE,
      feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
    }
    const orbId = EntityId('test:mending-main-hand-xp-orb')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      playerPose,
      playerStorage: mendingIronPickaxeStorage(),
      vitals: SPAWN_VITALS,
      experienceOrbs: {
        orbs: [{
          id: orbId,
          value: Result.getOrThrow(createExperienceOrbValue(3)),
          position: Schema.decodeUnknownSync(WorldPositionSchema)({
            dimension: INITIAL_DIMENSION,
            ...position(PositionAxis(1.02), PositionAxis(64), PositionAxis(0)),
          }),
          spawnedAt: SimulationTick(0),
        }],
      },
    }))
    await Effect.runPromise(Ref.set(harness.state.tickCount, SimulationTick(1)))

    await harness.run(makeDeltaTimeSecs(0.05))

    const storageAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
      PlayerStorageSnapshotSchema,
    ))
    const vitalsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsAfter = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))

    expect(storageAfter.state.inventoryDurability[0]).toStrictEqual({ current: 250, max: 250 })
    expect(vitalsAfter.state.vitals.totalExperience).toBe(0)
    expect(orbsAfter.state.orbs).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([{
      request: { orb: orbId },
      outcome: { _tag: 'Completed', result: [{ _tag: 'ExperienceCollected', amount: 3, orb: orbId }] },
    }])
  })

  it('records an unknown registered-orb snapshot as a typed failure without consuming the request', async () => {
    const orbId = EntityId('test:xp-orb-missing-owner')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: Result.getOrThrow(createExperienceOrbValue(3)) }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 6,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        experienceOrbsOwnerId: makeReplicatedOwnerId('test:unknown-experience-orbs-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Failed', error: { _tag: 'ReplicatedOwnerUnknown' } } },
    ])
  })

  it('records player-storage snapshot failure for a registered XP-orb absorption', async () => {
    const orbId = EntityId('test:xp-orb-storage-snapshot-failure')
    const harness = await Effect.runPromise(makeHarness({
      entity: null,
      experienceOrbs: { orbs: [{ id: orbId, value: Result.getOrThrow(createExperienceOrbValue(3)) }] },
    }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 11,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const context: GameplayStageContext = {
      ...harness.context,
      commit: {
        ...harness.context.commit!,
        playerStorageOwnerId: makeReplicatedOwnerId('test:unregistered-player-storage-owner'),
      },
    }

    await Effect.runPromise(makeEntitiesStage(context).run(0 as DeltaTimeSecs).pipe(
      Effect.provide(FrameServicesLayer),
    ))

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(Ref.get(harness.state.pendingExperienceOrbAbsorptions))).toStrictEqual([])
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([{
      request,
      outcome: { _tag: 'Failed', error: { _tag: 'ReplicatedOwnerUnknown' } },
    }])
  })

  it('reports a requested XP orb missing from the registered owner without committing', async () => {
    const orbId = EntityId('test:xp-orb-not-in-owner')
    const harness = await Effect.runPromise(makeHarness({ entity: null }))
    const request = {
      actor: EntityId('test:player'),
      orb: orbId,
      tick: 7,
      position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
    }
    await Effect.runPromise(requestExperienceOrbAbsorption(harness.state, request))
    const vitalsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))
    const orbsBefore = await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))

    await harness.run(0 as DeltaTimeSecs)

    expect(harness.commits()).toBe(0)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_VITALS_OWNER_ID,
      ExperienceOrbVitalsOwnerSnapshotSchema,
    ))).toStrictEqual(vitalsBefore)
    expect(await Effect.runPromise(harness.coordinator.snapshot(
      GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
      ExperienceOrbOwnerSnapshotSchema,
    ))).toStrictEqual(orbsBefore)
    expect(await Effect.runPromise(Ref.get(harness.state.experienceOrbAbsorptionExecutions))).toMatchObject([
      { request, outcome: { _tag: 'Failed', error: { _tag: 'ExperienceOrbUnavailable', reason: 'missing-orb', orb: orbId } } },
    ])
  })
})
