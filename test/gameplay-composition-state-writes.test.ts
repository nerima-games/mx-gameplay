import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Ref, Result, Schema, Stream } from 'effect'
import {
  AIR_BLOCK_ID,
  BlockId,
  DimensionIdSchema,
  DeltaTimeSecs,
  DimensionRevisionSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  WorldWritePort,
  WorldWriteBatchSchema,
  defaultBlockState,
  blockIdOf,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'
import type { BlockPosition, BlockType, BlockStateValues, Dimension, WorldRevision, WorldWriteBatch, WorldWriteCommit } from '@nerima-games/mc-kernel'
import { ChunkStore, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import {
  DomainEventBus,
  TimeService,
  WorldCommitCoordinator,
  makeReplicatedOwnerId,
  makeTimeService,
  itemStack as makeItemStack,
  CropSnapshotSchema,
  type DomainEventBusApi,
  type ReplicatedOwnerCandidate,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import type { BlockStateCell, BlockStateEdit, BlockStateWorldPort } from '../src/domain/interactions/block-state-rules.js'
import { GameplayBlockStateWorld } from '../src/stages/gameplay-block-state-world.js'
import type { GameplayBlockStateWorldApi } from '../src/stages/gameplay-block-state-world.js'
import { makeGameplayComposition } from '../src/stages/gameplay-composition.js'
import {
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations.js'
import {
  gameplayStages,
  requestBlockPlacementCommand,
  requestBlockUse,
  drainBlockUseResults,
  setPlayerDead,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
} from '../src/stages/registration.js'
import type { GameplayTargetingSnapshotContext } from '../src/stages/registration-core.js'
import { blockKey, world } from './support/chunk-store-double.js'
import { makeEntityManagerDouble } from './support/entity-manager-double.js'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double.js'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import {
  position as fixturePosition,
  blockPosition as fixtureBlockPosition,
  chunkCoord as fixtureChunkCoord,
} from './support/coordinate-fixtures.js'
import { FRAME_DELTA, runFrames } from './support/frame-runner.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import type { CropSnapshot, Slot } from '@nerima-games/mc-sim'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'

const AIMING_POSE = {
  feetPosition: fixturePosition(0.5, 0, 2.5),
  yawRadians: 0,
  pitchRadians: 0,
}

const blockId = (type: BlockType) => Option.getOrThrow(blockIdOf(type))
const cell = (type: BlockType, state: BlockStateValues): BlockStateCell => ({ block: blockId(type), state })

const stateFor = (type: BlockType): BlockStateValues =>
  Result.getOrThrow(defaultBlockState(blockId(type)))

type AdapterWrite = Readonly<{
  dimension: Dimension
  ownerChanges?: ReadonlyArray<ReplicatedOwnerCandidate>
  expectedWorldRevision?: WorldRevision
  edits: ReadonlyArray<BlockStateEdit>
}>

const makeStateWorld = (
  store: import('@nerima-games/mc-worldgen').ChunkStoreApi,
  initial: ReadonlyArray<readonly [BlockPosition, BlockStateCell]>,
  portOverrides: Partial<Pick<BlockStateWorldPort, 'read' | 'write'>> = {},
) => {
  const cells = new Map(initial.map(([position, value]) => [blockKey(position), value]))
  const batches: Array<WorldWriteBatch> = []
  const adapterWrites: Array<AdapterWrite> = []
  let worldRevision = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
  let dimensionRevision = Schema.decodeUnknownSync(DimensionRevisionSchema)(0)

  const c7Port: WorldWritePort['Service'] = {
    applyBatch: (batch) => Effect.gen(function* () {
      const decoded = Schema.decodeUnknownSync(WorldWriteBatchSchema)(batch)
      batches.push(decoded)
      for (const edit of decoded.edits) {
        expect(edit.state).toBeDefined()
        cells.set(blockKey(edit.position), { block: edit.block, state: edit.state! })
        yield* store.setBlock(edit.position, edit.block)
      }
      worldRevision = Schema.decodeUnknownSync(WorldRevisionSchema)(Number(worldRevision) + 1)
      dimensionRevision = Schema.decodeUnknownSync(DimensionRevisionSchema)(Number(dimensionRevision) + 1)
      const committed: WorldWriteCommit = { worldRevision, dimensionRevision }
      return committed
    }),
  }

  const api: GameplayBlockStateWorldApi = {
    forDimension: (dimension, ownerChanges, expectedWorldRevision): BlockStateWorldPort => ({
      read: portOverrides.read ?? ((position) => Effect.succeed({
        _tag: 'Found',
        cell: cells.get(blockKey(position)) ?? { block: AIR_BLOCK_ID, state: stateFor('air') },
      })),
      write: portOverrides.write ?? ((edits) => {
        adapterWrites.push({
          dimension,
          ...(ownerChanges === undefined ? {} : { ownerChanges }),
          ...(expectedWorldRevision === undefined ? {} : { expectedWorldRevision }),
          edits,
        })
        const batch: WorldWriteBatch = {
          world: Schema.decodeUnknownSync(WorldIdSchema)('gp1-composition-test'),
          expectedWorldRevision: expectedWorldRevision ?? worldRevision,
          dimension: Schema.decodeUnknownSync(DimensionIdSchema)(dimension),
          expectedDimensionRevision: dimensionRevision,
          edits,
        }
        return Effect.match(c7Port.applyBatch(batch), {
          onFailure: () => ({ _tag: 'Unsupported' as const, operation: 'writeState' as const }),
          onSuccess: () => ({ _tag: 'Written' as const }),
        })
      }),
    }),
  }

  return { api, cells, batches, adapterWrites }
}

const eventBus: DomainEventBusApi = {
  publish: () => Effect.void,
  events: Stream.empty,
}

const makeProductionComposition = (
  initial: ReadonlyArray<readonly [BlockPosition, BlockStateCell]>,
  slots: ReadonlyArray<Slot | undefined> = emptySlots(),
  crops: CropSnapshot = { crops: [] },
  portOverrides: Partial<Pick<BlockStateWorldPort, 'read' | 'write'>> = {},
  storeOverrides: Partial<Pick<ChunkStoreApi, 'getBlock' | 'getLight' | 'peek'>> = {},
  coordinatorOverride?: (coordinator: WorldCommitCoordinatorApi) => WorldCommitCoordinatorApi,
) => Effect.gen(function* () {
  const initialBlocks = world(initial.map(([position, value]) => [position, value.block] as const))
  const store = yield* makeTransactionalChunkStoreDouble(initialBlocks, ['0,0'])
  const storeApi: ChunkStoreApi = { ...store.api, ...storeOverrides }
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const inventory = yield* makeInventoryDouble(slots)
  const time = yield* makeTimeService()
  const commit = yield* makeGameplayCommitServices(storeApi, inventory.api, {
    playerPose: AIMING_POSE,
    crops,
  })
  const coordinator = coordinatorOverride?.(commit.coordinator) ?? commit.coordinator
  const stateWorld = makeStateWorld(storeApi, initial, portOverrides)
  const services = Layer.mergeAll(
    Layer.succeed(ChunkStore, storeApi),
    roster.layer,
    Layer.succeed(TimeService, time),
    Layer.succeed(WorldCommitCoordinator, coordinator),
    Layer.succeed(DomainEventBus, eventBus),
    Layer.succeed(GameplayBlockStateWorld, stateWorld.api),
  )
  const composition = yield* Effect.provide(makeGameplayComposition(gameplayStages), services)
  const targeting: GameplayTargetingSnapshotContext = {
    coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
  }
  return { ...composition, commit, store: { ...store, api: storeApi }, inventory, stateWorld, targeting }
})

describe('the registered production composition reaches the C7 state writer', () => {
  it.effect('opens and closes a targeted door through the ordered interactions and state-rule stages', () =>
    Effect.gen(function* () {
      const lower = fixtureBlockPosition(0, 1, 0)
      const upper = fixtureBlockPosition(0, 2, 0)
      const lowerCell = cell('door', { facing: 'north', hinge: 'left', half: 'lower', open: false, powered: false })
      const upperCell = cell('door', { facing: 'north', hinge: 'left', half: 'upper', open: false, powered: false })
      const composition = yield* makeProductionComposition([[lower, lowerCell], [upper, upperCell]])
      const interactions = composition.stages.findIndex((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      const stateRules = composition.stages.findIndex((stage) => stage.id === GAMEPLAY_STAGE_IDS.blockStateRules)
      expect(interactions).toBeGreaterThanOrEqual(0)
      expect(stateRules).toBeGreaterThan(interactions)

      const opened = yield* requestTargetedBlockUse(composition.state, composition.store.api, composition.targeting, 'door-open', 'door')
      expect(Option.isSome(opened)).toBe(true)
      yield* runFrames(composition.stages, 1, FRAME_DELTA)
      yield* requestTargetedBlockUse(composition.state, composition.store.api, composition.targeting, 'door-close', 'door')
      yield* runFrames(composition.stages, 1, FRAME_DELTA)

      expect(composition.stateWorld.batches).toHaveLength(2)
      expect(composition.stateWorld.batches.map((batch) => batch.edits.map((edit) => edit.state?.open))).toStrictEqual([
        [true, true],
        [false, false],
      ])
      expect(composition.stateWorld.cells.get(blockKey(lower))?.state.open).toBe(false)
      expect(composition.stateWorld.cells.get(blockKey(upper))?.state.open).toBe(false)
    }),
  )

  it.effect('returns a typed door-use failure when the production player snapshot is unavailable', () =>
    Effect.gen(function* () {
      const lower = fixtureBlockPosition(0, 1, 0)
      const upper = fixtureBlockPosition(0, 2, 0)
      const stonePosition = fixtureBlockPosition(1, 1, 0)
      const missingPlayer = makeReplicatedOwnerId('gp1:missing-player-snapshot')
      let failNextPlayerSnapshot = false
      const composition = yield* makeProductionComposition(
        [
          [lower, cell('door', { facing: 'north', hinge: 'left', half: 'lower', open: false, powered: false })],
          [upper, cell('door', { facing: 'north', hinge: 'left', half: 'upper', open: false, powered: false })],
          [stonePosition, cell('stone', stateFor('stone'))],
        ],
        emptySlots(),
        { crops: [] },
        {},
        {},
        (coordinator) => ({
          ...coordinator,
          snapshot: (ownerId, schema) => {
            if (ownerId === GAMEPLAY_PLAYER_OWNER_ID && failNextPlayerSnapshot) {
              failNextPlayerSnapshot = false
              return coordinator.snapshot(missingPlayer, schema)
            }
            return coordinator.snapshot(ownerId, schema)
          },
        }),
      )
      yield* requestBlockUse(composition.state, 'door-without-player-snapshot', lower)
      yield* requestBlockUse(composition.state, 'stone-without-player-snapshot', stonePosition)

      failNextPlayerSnapshot = true
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(0))

      expect(yield* drainBlockUseResults(composition.state)).toStrictEqual([{
        requestId: 'door-without-player-snapshot',
        success: false,
        outcome: 'PlayerStateUnavailable',
      }, {
        requestId: 'stone-without-player-snapshot',
        success: false,
        outcome: {
          _tag: 'NotLever',
          position: stonePosition,
          existing: blockId('stone'),
        },
      }])
      expect(yield* Ref.get(composition.state.pendingBlockUses)).toStrictEqual([])
      expect(composition.stateWorld.batches).toHaveLength(0)

      yield* setPlayerDead(composition.state, true)
      yield* requestBlockUse(composition.state, 'dead-door-without-player-snapshot', lower)
      failNextPlayerSnapshot = true
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(0))

      expect(yield* drainBlockUseResults(composition.state)).toStrictEqual([{
        requestId: 'dead-door-without-player-snapshot',
        success: false,
        outcome: 'PlayerDead',
      }])
      expect(yield* Ref.get(composition.state.pendingBlockUses)).toStrictEqual([])
      expect(composition.stateWorld.batches).toHaveLength(0)
    }),
  )

  it.effect('places a targeted door as a two-cell stateful C7 edit', () =>
    Effect.gen(function* () {
      const support = fixtureBlockPosition(0, 1, 0)
      const lower = fixtureBlockPosition(0, 1, 1)
      const upper = fixtureBlockPosition(0, 2, 1)
      const slots = [...emptySlots()]
      slots[0] = Result.getOrThrow(makeItemStack('door', 1))
      const composition = yield* makeProductionComposition([
        [support, cell('stone', stateFor('stone'))],
      ], slots)

      const target = yield* requestTargetedBlockPlacement(
        composition.state,
        composition.store.api,
        composition.targeting,
        'door',
      )
      expect(Option.getOrUndefined(target)?.adjacentPosition).toStrictEqual(lower)
      yield* runFrames(composition.stages, 1, FRAME_DELTA)

      const [batch] = composition.stateWorld.batches
      expect(composition.stateWorld.batches).toHaveLength(1)
      expect(batch?.edits).toHaveLength(2)
      expect(batch?.edits).toMatchObject([
        { position: lower, block: blockId('door'), state: { facing: 'north', hinge: 'left', half: 'lower', open: false } },
        { position: upper, block: blockId('door'), state: { facing: 'north', hinge: 'left', half: 'upper', open: false } },
      ])
      expect(yield* Ref.get(composition.state.consumedItems)).toStrictEqual(['door'])
    }),
  )

  it.effect('writes a creative door placement through C7 without an inventory owner candidate', () =>
    Effect.gen(function* () {
      const support = fixtureBlockPosition(0, 1, 0)
      const lower = fixtureBlockPosition(0, 1, 1)
      const upper = fixtureBlockPosition(0, 2, 1)
      const composition = yield* makeProductionComposition([[support, cell('stone', stateFor('stone'))]])
      yield* requestBlockPlacementCommand(composition.state, {
        requestId: 'creative-door-placement',
        positionKey: blockPositionKeyOf(lower),
        heldItem: 'door',
        mode: 'creative',
        targeting: { facing: 'north', hitFace: 'south', hitY: 0.62 },
      })
      yield* runFrames(composition.stages, 1, FRAME_DELTA)

      expect(composition.stateWorld.batches).toHaveLength(1)
      expect(composition.stateWorld.batches[0]?.edits).toMatchObject([
        { position: lower, block: blockId('door'), state: { half: 'lower', facing: 'north' } },
        { position: upper, block: blockId('door'), state: { half: 'upper', facing: 'north' } },
      ])
      expect(composition.stateWorld.adapterWrites[0]?.ownerChanges).toBeUndefined()
      expect(yield* Ref.get(composition.state.consumedItems)).toStrictEqual([])
    }),
  )

  it.effect('places a stair from the aimed block and updates the existing neighbor in the same C7 batch', () =>
    Effect.gen(function* () {
      const neighbor = fixtureBlockPosition(0, 1, 0)
      const affectedNeighbor = fixtureBlockPosition(-1, 1, 1)
      const placed = fixtureBlockPosition(0, 1, 1)
      const neighborCell = cell('oak_stairs', {
        facing: 'west', half: 'top', shape: 'straight', waterlogged: false,
      })
      const affectedNeighborCell = cell('oak_stairs', {
        facing: 'east', half: 'top', shape: 'straight', waterlogged: false,
      })
      const slots = [...emptySlots()]
      slots[0] = Result.getOrThrow(makeItemStack('oak_stairs', 1))
      const composition = yield* makeProductionComposition([
        [neighbor, neighborCell],
        [affectedNeighbor, affectedNeighborCell],
      ], slots)

      const target = yield* requestTargetedBlockPlacement(
        composition.state,
        composition.store.api,
        composition.targeting,
        'oak_stairs',
      )
      expect(Option.getOrUndefined(target)?.adjacentPosition).toStrictEqual(placed)
      yield* runFrames(composition.stages, 1, FRAME_DELTA)

      const [batch] = composition.stateWorld.batches
      expect(composition.stateWorld.batches).toHaveLength(1)
      expect(batch?.edits).toHaveLength(2)
      expect(batch?.edits.find((edit) => blockKey(edit.position) === blockKey(placed))).toMatchObject({
        block: blockId('oak_stairs'),
        state: { facing: 'north', half: 'top', shape: 'outer_left', waterlogged: false },
      })
      expect(batch?.edits.find((edit) => blockKey(edit.position) === blockKey(affectedNeighbor))).toMatchObject({
        state: { facing: 'east', half: 'top', shape: 'outer_left', waterlogged: false },
      })
      expect(batch?.edits.find((edit) => blockKey(edit.position) === blockKey(neighbor))).toBeUndefined()
      expect(composition.stateWorld.cells.get(blockKey(affectedNeighbor))?.state).toMatchObject({
        facing: 'east', half: 'top', shape: 'outer_left', waterlogged: false,
      })
      expect(composition.stateWorld.adapterWrites[0]?.ownerChanges?.map(({ ownerId }) => ownerId))
        .toContain(GAMEPLAY_PLAYER_STORAGE_OWNER_ID)
      expect(yield* Ref.get(composition.state.consumedItems)).toStrictEqual(['oak_stairs'])
    }),
  )

  it.effect('projects CropOwner time to crop age once and attempts sapling growth from interactions ticks', () =>
    Effect.gen(function* () {
      const cropPosition = fixtureBlockPosition(2, 64, 2)
      const wartPosition = fixtureBlockPosition(3, 64, 2)
      const crop = {
        dimension: 'overworld' as const,
        position: cropPosition,
        crop: 'wheat_crop' as const,
        growthSecs: 0,
      }
      const wart = {
        dimension: 'overworld' as const,
        position: wartPosition,
        crop: 'nether_wart_crop' as const,
        growthSecs: 0,
      }
      const cropComposition = yield* makeProductionComposition([
        [cropPosition, cell('wheat_crop', stateFor('wheat_crop'))],
        [wartPosition, cell('nether_wart_crop', stateFor('nether_wart_crop'))],
      ], emptySlots(), { crops: [crop, wart] })
      yield* runFrames(cropComposition.stages, 1, DeltaTimeSecs(160))

      expect(cropComposition.stateWorld.batches).toHaveLength(3)
      expect(cropComposition.stateWorld.batches.flatMap((batch) => batch.edits)).toMatchObject([
        { position: cropPosition, block: blockId('wheat_crop'), state: { age: 1 } },
        { position: cropPosition, block: blockId('wheat_crop'), state: { age: 2 } },
        { position: wartPosition, block: blockId('nether_wart_crop'), state: { age: 1 } },
      ])
      const cropOwnerWrites = cropComposition.stateWorld.adapterWrites.flatMap((write) =>
        write.ownerChanges?.filter(({ ownerId }) => ownerId === GAMEPLAY_CROPS_OWNER_ID) ?? [],
      )
      expect(cropOwnerWrites).toHaveLength(1)
      expect(cropOwnerWrites[0]?.state).toMatchObject({
        crops: [
          { dimension: 'overworld', position: cropPosition, crop: 'wheat_crop', growthSecs: 160 },
          { dimension: 'overworld', position: wartPosition, crop: 'nether_wart_crop', growthSecs: 160 },
        ],
      })
      yield* runFrames(cropComposition.stages, 1, DeltaTimeSecs(0))
      expect(cropComposition.stateWorld.batches).toHaveLength(3)
      expect(cropComposition.stateWorld.adapterWrites.flatMap((write) =>
        write.ownerChanges?.filter(({ ownerId }) => ownerId === GAMEPLAY_CROPS_OWNER_ID) ?? [],
      )).toHaveLength(1)

      const saplingPosition = fixtureBlockPosition(4, 64, 4)
      const saplingComposition = yield* makeProductionComposition([
        [saplingPosition, cell('sapling', stateFor('sapling'))],
      ])
      yield* Ref.set(saplingComposition.state.rollSeed, 1)
      yield* runFrames(saplingComposition.stages, 1, DeltaTimeSecs(1))
      expect(saplingComposition.stateWorld.cells.get(blockKey(saplingPosition))?.state.stage).toBe(1)
      expect(saplingComposition.stateWorld.batches.flatMap((batch) => batch.edits).filter((edit) =>
        blockKey(edit.position) === blockKey(saplingPosition),
      )).toHaveLength(1)
      yield* runFrames(saplingComposition.stages, 1, DeltaTimeSecs(1))
      expect(saplingComposition.stateWorld.cells.get(blockKey(saplingPosition))?.state.stage).toBe(1)
      expect(saplingComposition.stateWorld.batches.flatMap((batch) => batch.edits).filter((edit) =>
        blockKey(edit.position) === blockKey(saplingPosition),
      )).toHaveLength(1)
      expect(yield* Ref.get(saplingComposition.state.blockStateRuleResults)).toMatchObject([
        { outcome: { _tag: 'Applied', edits: [{ state: { stage: 1 } }] } },
        { outcome: { _tag: 'NoChange', reason: 'growthMiss' } },
      ])
      yield* saplingComposition.store.api.unload(fixtureChunkCoord(0, 0))
      yield* runFrames(saplingComposition.stages, 1, DeltaTimeSecs(1))
      expect(saplingComposition.stateWorld.batches).toHaveLength(1)
    }),
  )

  it.effect('keeps CropOwner as the clock when state projection races an unload or cannot write', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(2, 64, 2)
      const crop = { dimension: 'overworld' as const, position, crop: 'wheat_crop' as const, growthSecs: 0 }
      let reads = 0
      const recovered = yield* makeProductionComposition(
        [[position, cell('wheat_crop', stateFor('wheat_crop'))]],
        emptySlots(),
        { crops: [crop] },
        {
          read: () => Effect.sync(() => {
            reads += 1
            return reads === 1
              ? { _tag: 'Unavailable' as const, reason: 'ChunkNotLoaded' as const }
              : { _tag: 'Found' as const, cell: cell('wheat_crop', { age: 0 }) }
          }),
        },
      )
      yield* runFrames(recovered.stages, 1, DeltaTimeSecs(69))

      expect(reads).toBe(2)
      expect(recovered.stateWorld.batches.flatMap((batch) => batch.edits)).toMatchObject([
        { position, state: { age: 1 } },
      ])
      expect(recovered.stateWorld.adapterWrites[0]?.ownerChanges?.map(({ ownerId }) => ownerId))
        .toContain(GAMEPLAY_CROPS_OWNER_ID)
      expect(yield* Ref.get(recovered.state.blockStateRuleResults)).toMatchObject([
        { outcome: { _tag: 'Applied', edits: [{ state: { age: 1 } }] } },
      ])

      const rejectedWrite = yield* makeProductionComposition(
        [[position, cell('wheat_crop', stateFor('wheat_crop'))]],
        emptySlots(),
        { crops: [crop] },
        { write: () => Effect.succeed({ _tag: 'Unsupported' as const, operation: 'writeState' as const }) },
      )
      yield* runFrames(rejectedWrite.stages, 1, DeltaTimeSecs(69))

      expect(rejectedWrite.stateWorld.batches).toHaveLength(0)
      expect(yield* Ref.get(rejectedWrite.state.blockStateRuleResults)).toMatchObject([
        { outcome: { _tag: 'Unsupported', operation: 'writeState', position } },
      ])
      const owner = yield* rejectedWrite.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      expect(owner.state.crops).toMatchObject([{ growthSecs: 69 }])

      const unavailableRead = yield* makeProductionComposition(
        [[position, cell('wheat_crop', stateFor('wheat_crop'))]],
        emptySlots(),
        { crops: [crop] },
        { read: () => Effect.succeed({ _tag: 'Unavailable' as const, reason: 'ChunkNotLoaded' as const }) },
      )
      yield* runFrames(unavailableRead.stages, 1, DeltaTimeSecs(69))

      expect(unavailableRead.stateWorld.batches).toHaveLength(0)
      expect(yield* Ref.get(unavailableRead.state.blockStateRuleResults)).toMatchObject([
        { outcome: { _tag: 'Unavailable', reason: 'ChunkNotLoaded', position } },
      ])
      const unavailableOwner = yield* unavailableRead.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      expect(unavailableOwner.state.crops).toMatchObject([{ growthSecs: 69 }])

      const missingAge = yield* makeProductionComposition(
        [[position, cell('wheat_crop', stateFor('wheat_crop'))]],
        emptySlots(),
        { crops: [crop] },
        { read: () => Effect.succeed({ _tag: 'Found' as const, cell: cell('wheat_crop', {}) }) },
      )
      yield* runFrames(missingAge.stages, 1, DeltaTimeSecs(69))

      expect(missingAge.stateWorld.batches).toHaveLength(0)
      expect(yield* Ref.get(missingAge.state.blockStateRuleResults)).toMatchObject([
        { outcome: { _tag: 'InvalidState', position } },
      ])
      const missingAgeOwner = yield* missingAge.commit.coordinator.snapshot(GAMEPLAY_CROPS_OWNER_ID, CropSnapshotSchema)
      expect(missingAgeOwner.state.crops).toMatchObject([{ growthSecs: 69 }])
    }),
  )

  it.effect('does not rewrite a crop whose state age already matches its mature CropOwner clock', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(2, 64, 2)
      const mature = { dimension: 'overworld' as const, position, crop: 'wheat_crop' as const, growthSecs: 480 }
      const composition = yield* makeProductionComposition(
        [[position, cell('wheat_crop', { ...stateFor('wheat_crop'), age: 7 })]],
        emptySlots(),
        { crops: [mature] },
      )
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(1))

      expect(composition.stateWorld.batches).toHaveLength(0)
      expect(yield* Ref.get(composition.state.blockStateRuleResults)).toStrictEqual([])
    }),
  )

  it.effect('skips saplings when light is unavailable or below the growth threshold', () =>
    Effect.gen(function* () {
      const first = fixtureBlockPosition(4, 64, 4)
      const second = fixtureBlockPosition(5, 64, 4)
      let reads = 0
      const composition = yield* makeProductionComposition([
        [first, cell('sapling', stateFor('sapling'))],
        [second, cell('sapling', stateFor('sapling'))],
      ], emptySlots(), { crops: [] }, {}, {
        getLight: () => Effect.sync(() => {
          reads += 1
          return reads === 1
            ? { _tag: 'ChunkNotLoaded' as const }
            : { _tag: 'Light' as const, sky: 8, block: 0 }
        }),
      })
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(1))

      expect(reads).toBe(2)
      expect(composition.stateWorld.batches).toHaveLength(0)
      expect(yield* Ref.get(composition.state.blockStateRuleResults)).toStrictEqual([])
    }),
  )

  it.effect('checks the vertical world boundary before attempting sapling tree growth', () =>
    Effect.gen(function* () {
      const topSapling = fixtureBlockPosition(4, 255, 4)
      const nearTopSapling = fixtureBlockPosition(5, 254, 4)
      const composition = yield* makeProductionComposition(
        [
          [topSapling, cell('sapling', { stage: 1 })],
          [nearTopSapling, cell('sapling', { stage: 1 })],
        ],
        emptySlots(),
        { crops: [] },
        {},
        { getLight: () => Effect.succeed({ _tag: 'Light', sky: 15, block: 0 }) },
      )
      yield* Ref.set(composition.state.rollSeed, 1)
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(1))

      expect(yield* Ref.get(composition.state.blockStateRuleResults)).toMatchObject([
        { outcome: { _tag: 'NoChange', reason: 'outOfWorld' } },
        { outcome: { _tag: 'NoChange', reason: 'outOfWorld' } },
      ])
      expect(composition.stateWorld.batches).toHaveLength(0)
      expect(composition.stateWorld.cells.get(blockKey(topSapling))?.state.stage).toBe(1)
      expect(composition.stateWorld.cells.get(blockKey(nearTopSapling))?.state.stage).toBe(1)
    }),
  )

  it.effect('discards an indexed sapling chunk when a concurrent peek observes it unloaded', () =>
    Effect.gen(function* () {
      const position = fixtureBlockPosition(4, 64, 4)
      const composition = yield* makeProductionComposition(
        [[position, cell('sapling', stateFor('sapling'))]],
        emptySlots(),
        { crops: [] },
        {},
        { peek: () => Effect.succeed(undefined) },
      )
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(1))

      expect(composition.stateWorld.batches).toHaveLength(0)
      expect(yield* Ref.get(composition.state.blockStateRuleResults)).toStrictEqual([])
    }),
  )

  it.effect('keeps sapling growth untried when a tree-space read reports an unloaded chunk', () =>
    Effect.gen(function* () {
      const saplingPosition = fixtureBlockPosition(4, 64, 4)
      const composition = yield* makeProductionComposition(
        [[saplingPosition, cell('sapling', { stage: 1 })]],
        emptySlots(),
        { crops: [] },
        {},
        {
          getBlock: () => Effect.succeed({ _tag: 'ChunkNotLoaded' as const }),
          getLight: () => Effect.succeed({ _tag: 'Light', sky: 15, block: 0 }),
        },
      )
      yield* Ref.set(composition.state.rollSeed, 1)
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(1))

      expect(yield* Ref.get(composition.state.blockStateRuleResults)).toMatchObject([
        { outcome: { _tag: 'NoChange', reason: 'chunkNotLoaded' } },
      ])
      expect(composition.stateWorld.batches).toHaveLength(0)
      expect(composition.stateWorld.cells.get(blockKey(saplingPosition))?.state.stage).toBe(1)
    }),
  )

  it.effect('reports block type resolution failures from tree-space reads through the registered stage', () =>
    Effect.gen(function* () {
      const malformedSapling = fixtureBlockPosition(4, 64, 4)
      const unregisteredSapling = fixtureBlockPosition(5, 64, 4)
      const malformedSpace = fixtureBlockPosition(4, 65, 4)
      const unregisteredSpace = fixtureBlockPosition(5, 65, 4)
      // This models corrupt chunk data crossing the ChunkStore boundary.
      const malformedBlock = -1 as BlockId
      const unregisteredBlock = BlockId(65_535)
      const composition = yield* makeProductionComposition(
        [
          [malformedSapling, cell('sapling', { stage: 1 })],
          [unregisteredSapling, cell('sapling', { stage: 1 })],
        ],
        emptySlots(),
        { crops: [] },
        {},
        {
          getBlock: (position) => {
            if (position.x === 4 && position.y === 65) {
              return Effect.succeed({ _tag: 'Block', block: malformedBlock })
            }
            if (position.x === 5 && position.y === 65) {
              return Effect.succeed({ _tag: 'Block', block: unregisteredBlock })
            }
            return Effect.succeed({ _tag: 'Block', block: AIR_BLOCK_ID })
          },
          getLight: () => Effect.succeed({ _tag: 'Light', sky: 15, block: 0 }),
        },
      )
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(1))

      expect(yield* Ref.get(composition.state.blockStateRuleResults)).toMatchObject([
        {
          outcome: {
            _tag: 'BlockTypeDecodeFailed',
            position: malformedSpace,
            block: malformedBlock,
            failure: { _tag: 'BrandError' },
          },
        },
        {
          outcome: {
            _tag: 'BlockTypeDecodeFailed',
            position: unregisteredSpace,
            block: unregisteredBlock,
            failure: { _tag: 'UnregisteredBlockId' },
          },
        },
      ])
      expect(composition.stateWorld.batches).toHaveLength(0)
      expect(composition.stateWorld.cells.get(blockKey(malformedSapling))?.state.stage).toBe(1)
      expect(composition.stateWorld.cells.get(blockKey(unregisteredSapling))?.state.stage).toBe(1)
    }),
  )

  it.effect('distinguishes blocked tree space from an unloaded second tree cell', () =>
    Effect.gen(function* () {
      const blockedSapling = fixtureBlockPosition(4, 64, 4)
      const unloadedSapling = fixtureBlockPosition(5, 64, 4)
      const composition = yield* makeProductionComposition(
        [
          [blockedSapling, cell('sapling', { stage: 1 })],
          [unloadedSapling, cell('sapling', { stage: 1 })],
        ],
        emptySlots(),
        { crops: [] },
        {},
        {
          getBlock: (position) => {
            if (position.x === 4 && position.y === 65) {
              return Effect.succeed({ _tag: 'Block', block: blockId('stone') })
            }
            if (position.x === 5 && position.y === 65) {
              return Effect.succeed({ _tag: 'Block', block: AIR_BLOCK_ID })
            }
            if (position.x === 5 && position.y === 66) return Effect.succeed({ _tag: 'ChunkNotLoaded' })
            return Effect.succeed({ _tag: 'Block', block: AIR_BLOCK_ID })
          },
          getLight: () => Effect.succeed({ _tag: 'Light', sky: 15, block: 0 }),
        },
      )
      yield* Ref.set(composition.state.rollSeed, 1)
      yield* runFrames(composition.stages, 1, DeltaTimeSecs(1))

      expect(yield* Ref.get(composition.state.blockStateRuleResults)).toMatchObject([
        { outcome: { _tag: 'NoChange', reason: 'blocked' } },
        { outcome: { _tag: 'NoChange', reason: 'chunkNotLoaded' } },
      ])
      expect(composition.stateWorld.batches).toHaveLength(0)
      expect(composition.stateWorld.cells.get(blockKey(blockedSapling))?.state.stage).toBe(1)
      expect(composition.stateWorld.cells.get(blockKey(unloadedSapling))?.state.stage).toBe(1)
    }),
  )
})
