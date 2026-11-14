import { describe, expect, it } from '@effect/vitest'
import { CHUNK_HEIGHT, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { PlayerServiceSnapshotSchema, makeTimeService } from '@nerima-games/mc-sim'
import {
  BlockId,
  DeltaTimeSecs,
  EntityHealthPoints,
  EntityId,
  EntityKind,
  EntitySerial,
  PositionAxis,
  blockIdOf,
  blockPositionKeyOf,
  position,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import { Effect, Option, Ref } from 'effect'
import {
  drainFluidUpdates,
  drainGameplayEntityStageFaults,
  drainPortalTravels,
  gameplayStages,
  makeGameplayFrameState,
  requestTargetedPrimaryAttack,
  resolveTargetedPrimaryAttack,
} from '../src/stages/registration'
import type { FluidWorkItem } from '../src/domain/fluid-frontier'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { recordGameplayEntityStageFault, type TargetedPrimaryAttackOptions } from '../src/stages/registration-core'
import type { GameplayOwnerInitialState } from '../src/stages/gameplay-owner-registrations'
import { FrameServicesLayer } from './support/frame-services'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles'
import { world } from './support/chunk-store-double'
import { blockPosition } from './support/coordinate-fixtures'
import { makePlayerServiceDouble, SPAWN_POSE } from './support/player-service-double'

const makeHarness = (
  initial: ReadonlyMap<string, BlockId>,
  ownerInitial: GameplayOwnerInitialState = {},
) =>
  Effect.gen(function* () {
    const state = yield* makeGameplayFrameState
    const store = yield* makeTransactionalChunkStoreDouble(initial, ['0,0', '-1,0', '0,-1', '-1,-1'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(emptySlots())
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      playerPose: SPAWN_POSE,
      ...ownerInitial,
    })
    return { state, store, roster, inventory, player, time, commit }
  })

type Harness = Effect.Success<ReturnType<typeof makeHarness>>

const stageFor = (harness: Harness, id: string, store: ChunkStoreApi = harness.store.api) => {
  const stage = gameplayStages(
    harness.state,
    store,
    harness.roster.api,
    harness.inventory.api,
    harness.player.api,
    harness.time,
    undefined,
    undefined,
    {},
    harness.commit,
  ).find((candidate) => candidate.id === id)
  if (stage === undefined) throw new Error(`gameplay stage was not registered: ${id}`)
  return stage
}

const sameCell = (left: BlockPosition, right: BlockPosition): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

const unknownBlockId = BlockId(65_535)

describe('registration-core typed world faults', () => {
  for (const field of ['blockReach', 'meleeReach', 'meleeDamage'] as const) {
    for (const value of [undefined, null]) {
      it.effect(`rejects explicitly ${String(value)} ${field} without enqueuing a primary attack`, () =>
        Effect.gen(function* () {
          const harness = yield* makeHarness(world([]))
          const targeting = {
            coordinator: harness.commit.coordinator,
            playerOwnerId: harness.commit.playerOwnerId,
            entitiesOwnerId: harness.commit.entitiesOwnerId!,
          }
          const options = { [field]: value } as unknown as TargetedPrimaryAttackOptions
          const resolved = yield* Effect.flip(resolveTargetedPrimaryAttack(harness.store.api, targeting, options))
          const requested = yield* Effect.flip(requestTargetedPrimaryAttack(harness.state, harness.store.api, targeting, options))

          expect(resolved._tag).toBe('SchemaError')
          expect(requested._tag).toBe('SchemaError')
          expect(yield* Ref.get(harness.state.pendingBreaks)).toStrictEqual([])
          expect(yield* Ref.get(harness.state.pendingMeleeAttacks)).toStrictEqual([])
          expect(yield* harness.commit.coordinator.revision).toBe(0)
        }),
      )
    }
  }

  it.effect('uses primary attack defaults only when numeric options are omitted', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]))
      const targeting = {
        coordinator: harness.commit.coordinator,
        playerOwnerId: harness.commit.playerOwnerId,
        entitiesOwnerId: harness.commit.entitiesOwnerId!,
      }
      expect(yield* resolveTargetedPrimaryAttack(harness.store.api, targeting)).toStrictEqual({ _tag: 'None' })
      expect(yield* requestTargetedPrimaryAttack(harness.state, harness.store.api, targeting, {})).toStrictEqual({ _tag: 'None' })
    }),
  )

  it.effect('keeps registry faults with different inner reasons distinct', () =>
    Effect.gen(function* () {
      const cell = blockPosition(0, 64, 0)
      const fault = (reason: 'type' | 'range') => ({
        _tag: 'EntityWorldDataFault' as const,
        source: 'ItemUse' as const,
        target: { _tag: 'Cell' as const, cell },
        failure: {
          _tag: 'EntityWorldRegistryFailure' as const,
          cell,
          failure: { _tag: 'BlockPropertyFailure' as const, reason, message: 'property decode failed' },
        },
      })
      const harness = yield* makeHarness(world([]))

      yield* recordGameplayEntityStageFault(harness.state, fault('type'))
      yield* recordGameplayEntityStageFault(harness.state, fault('range'))

      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([
        fault('type'),
        fault('range'),
      ])
    }),
  )

  it.effect('records a typed fault on the portal recheck and retries the crossing next frame', () =>
    Effect.gen(function* () {
      const portalCell = blockPosition(0, 64, 0)
      const portal = Option.getOrThrow(blockIdOf('nether_portal'))
      const harness = yield* makeHarness(world([[portalCell, portal]]))
      let portalCellReads = 0
      const store: ChunkStoreApi = {
        ...harness.store.api,
        getBlock: (queryPosition) => {
          if (sameCell(queryPosition, portalCell)) {
            portalCellReads += 1
            if (portalCellReads === 2) {
              return Effect.succeed({ _tag: 'Block', block: unknownBlockId })
            }
          }
          return harness.store.api.getBlock(queryPosition)
        },
      }
      const interactions = stageFor(harness, GAMEPLAY_STAGE_IDS.interactions, store)

      yield* interactions.run(DeltaTimeSecs(5)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([{
        _tag: 'EntityWorldDataFault',
        source: 'Portal',
        target: { _tag: 'Cell', cell: portalCell },
        failure: { _tag: 'EntityWorldUnregisteredBlockId', cell: portalCell, blockId: unknownBlockId },
      }])
      expect(yield* drainPortalTravels(harness.state)).toStrictEqual([])
      expect((yield* harness.commit.coordinator.snapshot(
        harness.commit.playerOwnerId,
        PlayerServiceSnapshotSchema,
      )).state.pose.feetPosition.dimension).toBe('overworld')

      yield* interactions.run(DeltaTimeSecs(0.016)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainPortalTravels(harness.state)).toHaveLength(1)
      expect((yield* harness.commit.coordinator.snapshot(
        harness.commit.playerOwnerId,
        PlayerServiceSnapshotSchema,
      )).state.pose.feetPosition.dimension).toBe('nether')
      expect(portalCellReads).toBe(4)
    }),
  )

  it.effect('records a fluid current-cell fault, keeps the evaluated work, and queues a retry', () =>
    Effect.gen(function* () {
      const fluidCell = blockPosition(0, 64, 0)
      const harness = yield* makeHarness(world([]))
      const work: FluidWorkItem = {
        key: blockPositionKeyOf(fluidCell),
        kind: 'water',
        level: 0,
        source: true,
        falling: false,
      }
      yield* Ref.set(harness.state.fluidFrontier, [work])
      const store: ChunkStoreApi = {
        ...harness.store.api,
        getBlock: (queryPosition) => sameCell(queryPosition, fluidCell)
          ? Effect.succeed({ _tag: 'Block', block: unknownBlockId })
          : harness.store.api.getBlock(queryPosition),
      }

      yield* stageFor(harness, GAMEPLAY_STAGE_IDS.fluids, store)
        .run(DeltaTimeSecs(0.016))
        .pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([{
        _tag: 'EntityWorldDataFault',
        source: 'Fluid',
        target: { _tag: 'Cell', cell: fluidCell },
        failure: { _tag: 'EntityWorldUnregisteredBlockId', cell: fluidCell, blockId: unknownBlockId },
      }])
      expect(yield* Ref.get(harness.state.fluidFrontier)).toStrictEqual([{ ...work, deferred: 1 }])
      expect(yield* drainFluidUpdates(harness.state)).toStrictEqual([work])
    }),
  )

  it.effect('records a fluid current-cell fault without requeueing after the retry limit', () =>
    Effect.gen(function* () {
      const fluidCell = blockPosition(0, 64, 0)
      const harness = yield* makeHarness(world([]))
      const work: FluidWorkItem = {
        key: blockPositionKeyOf(fluidCell),
        kind: 'water',
        level: 0,
        source: true,
        falling: false,
        deferred: 8,
      }
      yield* Ref.set(harness.state.fluidFrontier, [work])
      const store: ChunkStoreApi = {
        ...harness.store.api,
        getBlock: (queryPosition) => sameCell(queryPosition, fluidCell)
          ? Effect.succeed({ _tag: 'Block', block: unknownBlockId })
          : harness.store.api.getBlock(queryPosition),
      }

      yield* stageFor(harness, GAMEPLAY_STAGE_IDS.fluids, store)
        .run(DeltaTimeSecs(0.016))
        .pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([{
        _tag: 'EntityWorldDataFault',
        source: 'Fluid',
        target: { _tag: 'Cell', cell: fluidCell },
        failure: { _tag: 'EntityWorldUnregisteredBlockId', cell: fluidCell, blockId: unknownBlockId },
      }])
      expect(yield* Ref.get(harness.state.fluidFrontier)).toStrictEqual([])
      expect(yield* drainFluidUpdates(harness.state)).toStrictEqual([work])
    }),
  )

  it.effect('retries a fluid cell after neighbor faults and still probes the other neighbors', () =>
    Effect.gen(function* () {
      const fluidCell = blockPosition(0, 64, 0)
      const belowCell = blockPosition(0, 63, 0)
      const horizontalCell = blockPosition(1, 64, 0)
      const fluid = Option.getOrThrow(blockIdOf('water'))
      const harness = yield* makeHarness(world([[fluidCell, fluid]]))
      const work: FluidWorkItem = {
        key: blockPositionKeyOf(fluidCell),
        kind: 'water',
        level: 0,
        source: true,
        falling: false,
      }
      yield* Ref.set(harness.state.fluidFrontier, [work])
      const reads = yield* Ref.make<ReadonlyArray<BlockPosition>>([])
      const store: ChunkStoreApi = {
        ...harness.store.api,
        getBlock: (queryPosition) => Effect.flatMap(
          Ref.update(reads, (current) => [...current, queryPosition]),
          () => sameCell(queryPosition, belowCell) || sameCell(queryPosition, horizontalCell)
            ? Effect.succeed({ _tag: 'Block', block: unknownBlockId })
            : harness.store.api.getBlock(queryPosition),
        ),
      }

      yield* stageFor(harness, GAMEPLAY_STAGE_IDS.fluids, store)
        .run(DeltaTimeSecs(0.016))
        .pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([
        {
          _tag: 'EntityWorldDataFault',
          source: 'Fluid',
          target: { _tag: 'Cell', cell: belowCell },
          failure: { _tag: 'EntityWorldUnregisteredBlockId', cell: belowCell, blockId: unknownBlockId },
        },
        {
          _tag: 'EntityWorldDataFault',
          source: 'Fluid',
          target: { _tag: 'Cell', cell: horizontalCell },
          failure: { _tag: 'EntityWorldUnregisteredBlockId', cell: horizontalCell, blockId: unknownBlockId },
        },
      ])
      expect(yield* Ref.get(harness.state.fluidFrontier)).toStrictEqual([{ ...work, deferred: 1 }])
      expect(yield* drainFluidUpdates(harness.state)).toStrictEqual([work])
      const readPositions = yield* Ref.get(reads)
      expect(readPositions).toContainEqual(fluidCell)
      expect(readPositions).toContainEqual(belowCell)
      expect(readPositions).toContainEqual(blockPosition(-1, 64, 0))
      expect(readPositions).toContainEqual(blockPosition(1, 64, 0))
      expect(readPositions).toContainEqual(blockPosition(0, 64, -1))
      expect(readPositions).toContainEqual(blockPosition(0, 64, 1))
    }),
  )

  it.effect('spreads a supported water source into its open horizontal neighbors', () =>
    Effect.gen(function* () {
      const fluidCell = blockPosition(0, 64, 0)
      const supportCell = blockPosition(0, 63, 0)
      const water = Option.getOrThrow(blockIdOf('water'))
      const stone = Option.getOrThrow(blockIdOf('stone'))
      const harness = yield* makeHarness(world([
        [fluidCell, water],
        [supportCell, stone],
      ]))
      const work: FluidWorkItem = {
        key: blockPositionKeyOf(fluidCell),
        kind: 'water',
        level: 0,
        source: true,
        falling: false,
      }
      yield* Ref.set(harness.state.fluidFrontier, [work])

      yield* stageFor(harness, GAMEPLAY_STAGE_IDS.fluids)
        .run(DeltaTimeSecs(0.016))
        .pipe(Effect.provide(FrameServicesLayer))

      for (const neighbor of [
        blockPosition(-1, 64, 0),
        blockPosition(1, 64, 0),
        blockPosition(0, 64, -1),
        blockPosition(0, 64, 1),
      ]) {
        expect(yield* harness.store.blockAt(neighbor)).toBe(water)
      }
      expect(yield* harness.store.blockAt(fluidCell)).toBe(water)
      expect(yield* harness.store.blockAt(supportCell)).toBe(stone)
      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([])
      expect(yield* drainFluidUpdates(harness.state)).toStrictEqual([work])
    }),
  )

  it.effect('records malformed persisted mob behaviour with its typed repair kind', () =>
    Effect.gen(function* () {
      const entityId = EntityId('test:malformed-creeper-state')
      const entityKind = EntityKind('creeper')
      const repairFailure = { _tag: 'MobBehaviourStateRepairFailure', kind: 'creeper' } as const
      const behaviour: MobBehaviour = { _tag: 'MobBehaviourRepairFault', failure: repairFailure }
      const harness = yield* makeHarness(world([]), {
        entities: {
          entities: [{
            id: entityId,
            kind: entityKind,
            feetPosition: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
            healthPoints: EntityHealthPoints(20),
            behaviour,
          }],
          nextSerial: EntitySerial(1),
        },
      })

      yield* stageFor(harness, GAMEPLAY_STAGE_IDS.entities)
        .run(DeltaTimeSecs(0.016))
        .pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([{
        _tag: 'MobBehaviourRepairFault',
        entityId,
        entityKind,
        failure: repairFailure,
      }])
      expect(yield* Ref.get(harness.state.operationFailures)).toStrictEqual([])
    }),
  )

  it.effect('treats an above-world fire snapshot cell as air and advances the supported fire', () =>
    Effect.gen(function* () {
      const fireCell = blockPosition(0, CHUNK_HEIGHT - 1, 0)
      const aboveWorldCell = blockPosition(0, CHUNK_HEIGHT, 0)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const supportBlock = Option.getOrThrow(blockIdOf('stone'))
      const harness = yield* makeHarness(world([
        [blockPosition(0, CHUNK_HEIGHT - 2, 0), supportBlock],
        [fireCell, fireBlock],
      ]))
      const aboveRead = yield* Ref.make({ count: 0, returnedOutOfWorld: false })
      const store: ChunkStoreApi = {
        ...harness.store.api,
        getBlock: (queryPosition) => Effect.tap(
          harness.store.api.getBlock(queryPosition),
          (reading) => sameCell(queryPosition, aboveWorldCell)
            ? Ref.update(aboveRead, (current) => ({
                count: current.count + 1,
                returnedOutOfWorld: reading._tag === 'OutOfWorld' || current.returnedOutOfWorld,
              }))
            : Effect.void,
        ),
      }
      yield* Ref.set(harness.state.fireLifecycle, { fires: [{ position: fireCell, ageTicks: 0 }], seed: 17 })

      yield* stageFor(harness, GAMEPLAY_STAGE_IDS.fire, store)
        .run(DeltaTimeSecs(1 / 20))
        .pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(aboveRead)).toStrictEqual({ count: 1, returnedOutOfWorld: true })
      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([])
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toStrictEqual([
        { position: fireCell, ageTicks: 1 },
      ])
      expect(yield* harness.store.blockAt(fireCell)).toBe(fireBlock)
    }),
  )
})
