import { describe, expect, it } from '@effect/vitest'
import { CHUNK_HEIGHT, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { PlayerServiceSnapshotSchema, makeTimeService } from '@nerima-games/mc-sim'
import {
  BlockId,
  DeltaTimeSecs,
  blockIdOf,
  blockPositionKeyOf,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import { Effect, Option, Ref } from 'effect'
import {
  drainFluidUpdates,
  drainGameplayEntityStageFaults,
  drainPortalTravels,
  gameplayStages,
  makeGameplayFrameState,
} from '../src/stages/registration'
import type { FluidWorkItem } from '../src/domain/fluid-frontier'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { FrameServicesLayer } from './support/frame-services'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles'
import { world } from './support/chunk-store-double'
import { fixtureBlockPosition } from './support/coordinate-fixtures'
import { makePlayerServiceDouble, SPAWN_POSE } from './support/player-service-double'

const makeHarness = (initial: ReadonlyMap<string, BlockId>) =>
  Effect.gen(function* () {
    const state = yield* makeGameplayFrameState
    const store = yield* makeTransactionalChunkStoreDouble(initial, ['0,0', '-1,0', '0,-1', '-1,-1'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(emptySlots())
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, { playerPose: SPAWN_POSE })
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
  it.effect('records a typed fault on the portal recheck and retries the crossing next frame', () =>
    Effect.gen(function* () {
      const portalCell = fixtureBlockPosition(0, 64, 0)
      const portal = Option.getOrThrow(blockIdOf('nether_portal'))
      const harness = yield* makeHarness(world([[portalCell, portal]]))
      let portalCellReads = 0
      const store: ChunkStoreApi = {
        ...harness.store.api,
        getBlock: (position) => {
          if (sameCell(position, portalCell)) {
            portalCellReads += 1
            if (portalCellReads === 2) {
              return Effect.succeed({ _tag: 'Block', block: unknownBlockId })
            }
          }
          return harness.store.api.getBlock(position)
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
      const fluidCell = fixtureBlockPosition(0, 64, 0)
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
        getBlock: (position) => sameCell(position, fluidCell)
          ? Effect.succeed({ _tag: 'Block', block: unknownBlockId })
          : harness.store.api.getBlock(position),
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

  it.effect('retries a fluid cell after a neighbor fault and still probes the other neighbors', () =>
    Effect.gen(function* () {
      const fluidCell = fixtureBlockPosition(0, 64, 0)
      const belowCell = fixtureBlockPosition(0, 63, 0)
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
        getBlock: (position) => Effect.flatMap(
          Ref.update(reads, (current) => [...current, position]),
          () => sameCell(position, belowCell)
            ? Effect.succeed({ _tag: 'Block', block: unknownBlockId })
            : harness.store.api.getBlock(position),
        ),
      }

      yield* stageFor(harness, GAMEPLAY_STAGE_IDS.fluids, store)
        .run(DeltaTimeSecs(0.016))
        .pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([{
        _tag: 'EntityWorldDataFault',
        source: 'Fluid',
        target: { _tag: 'Cell', cell: belowCell },
        failure: { _tag: 'EntityWorldUnregisteredBlockId', cell: belowCell, blockId: unknownBlockId },
      }])
      expect(yield* Ref.get(harness.state.fluidFrontier)).toStrictEqual([{ ...work, deferred: 1 }])
      expect(yield* drainFluidUpdates(harness.state)).toStrictEqual([work])
      const readPositions = yield* Ref.get(reads)
      expect(readPositions).toContainEqual(fluidCell)
      expect(readPositions).toContainEqual(belowCell)
      expect(readPositions).toContainEqual(fixtureBlockPosition(-1, 64, 0))
      expect(readPositions).toContainEqual(fixtureBlockPosition(1, 64, 0))
      expect(readPositions).toContainEqual(fixtureBlockPosition(0, 64, -1))
      expect(readPositions).toContainEqual(fixtureBlockPosition(0, 64, 1))
    }),
  )

  it.effect('treats an above-world fire snapshot cell as air and advances the supported fire', () =>
    Effect.gen(function* () {
      const fireCell = fixtureBlockPosition(0, CHUNK_HEIGHT - 1, 0)
      const aboveWorldCell = fixtureBlockPosition(0, CHUNK_HEIGHT, 0)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const supportBlock = Option.getOrThrow(blockIdOf('stone'))
      const harness = yield* makeHarness(world([
        [fixtureBlockPosition(0, CHUNK_HEIGHT - 2, 0), supportBlock],
        [fireCell, fireBlock],
      ]))
      const aboveRead = yield* Ref.make({ count: 0, returnedOutOfWorld: false })
      const store: ChunkStoreApi = {
        ...harness.store.api,
        getBlock: (position) => Effect.tap(
          harness.store.api.getBlock(position),
          (reading) => sameCell(position, aboveWorldCell)
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
