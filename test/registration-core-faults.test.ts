import { describe, expect, it } from '@effect/vitest'
import { CHUNK_HEIGHT, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { PlayerServiceSnapshotSchema, makeTimeService } from '@nerima-games/mc-sim'
import {
  BlockId,
  BlockAxis,
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
import { Effect, Option, Ref, Result } from 'effect'
import {
  drainFluidUpdates,
  drainGameplayEntityStageFaults,
  drainPortalTravels,
  drainBlockUseResults,
  gameplayStages,
  makeGameplayFrameState,
  requestTargetedPrimaryAttack,
  resolveTargetedPrimaryAttack,
  requestBowShot,
  requestBlockBreak,
  requestBlockUse,
  validateBlockPlacementCommand,
} from '../src/stages/registration'
import type { FluidWorkItem } from '../src/domain/fluid-frontier'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import {
  recordGameplayEntityStageFault,
  recordGameplayRequestFault,
  recordGameplayEntityWorldDataFault,
  type EntityStageFault,
  type TargetedPrimaryAttackOptions,
} from '../src/stages/registration-core'
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
  it.effect('records distinct uncorrelated malformed position keys and keeps each deduplicated after draining', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]))
      const firstKey = 'malformed-position-a' as ReturnType<typeof blockPositionKeyOf>
      const secondKey = 'malformed-position-b' as ReturnType<typeof blockPositionKeyOf>
      const keys = [firstKey, secondKey] as const
      const requests = keys.map((positionKey) => ({ positionKey, heldItem: 'stone' as const }))
      const interactions = stageFor(harness, GAMEPLAY_STAGE_IDS.interactions)
      yield* Ref.set(harness.state.pendingPlacements, requests)
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual(keys.map((positionKey) => ({
        _tag: 'GameplayRequestFault', source: 'ItemUse', reason: 'InvalidBlockPositionKey', positionKey,
      })))

      yield* Ref.set(harness.state.pendingPlacements, [...requests].reverse())
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([])
      yield* recordGameplayRequestFault(harness.state, 'ItemUse', 'same-request', 'InvalidBlockPositionKey', firstKey)
      yield* recordGameplayRequestFault(harness.state, 'ItemUse', 'same-request', 'InvalidBlockPositionKey', secondKey)
      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([{
        _tag: 'GameplayRequestFault', source: 'ItemUse', requestId: 'same-request', reason: 'InvalidBlockPositionKey',
      }])
      expect(yield* harness.commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('records an unrepresentable player grid position once and continues unrelated requests', () =>
    Effect.gen(function* () {
      const playerPose = { ...SPAWN_POSE, feetPosition: { ...SPAWN_POSE.feetPosition, x: PositionAxis(Number.MAX_VALUE) } }
      const harness = yield* makeHarness(world([]), { playerPose })
      const interactions = stageFor(harness, GAMEPLAY_STAGE_IDS.interactions)
      yield* requestBlockUse(harness.state, 'after-portal-fault', blockPosition(0, 64, 0))
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      const invalidPosition = { x: playerPose.feetPosition.x, y: playerPose.feetPosition.y, z: playerPose.feetPosition.z }
      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([{
        _tag: 'EntityWorldDataFault', source: 'Portal', target: { _tag: 'Position', position: invalidPosition },
        failure: { _tag: 'EntityWorldInvalidCell', reason: 'not-block-coordinate', position: invalidPosition },
      }])
      expect(yield* drainBlockUseResults(harness.state)).toMatchObject([{ requestId: 'after-portal-fault', success: false }])
      yield* interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([])
      expect(yield* harness.commit.coordinator.revision).toBe(0)
    }),
  )

  for (const cell of [blockPosition(0, Number.MIN_SAFE_INTEGER, 0), blockPosition(Number.MAX_SAFE_INTEGER, 64, 0)]) {
    it.effect(`records fluid neighbor overflow at ${cell.x},${cell.y},${cell.z} and still processes later work`, () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness(world([]))
        const invalidNeighbour: FluidWorkItem = { key: blockPositionKeyOf(cell), kind: 'water' }
        const later: FluidWorkItem = { key: blockPositionKeyOf(blockPosition(1, 64, 1)), kind: 'water' }
        yield* Ref.set(harness.state.fluidFrontier, [invalidNeighbour, later])
        yield* stageFor(harness, GAMEPLAY_STAGE_IDS.fluids).run(DeltaTimeSecs(0.016)).pipe(Effect.provide(FrameServicesLayer))
        expect(yield* drainGameplayEntityStageFaults(harness.state)).toStrictEqual([{
          _tag: 'FluidNeighbourPositionFault', cell, reason: 'coordinate-overflow',
        }])
        expect(yield* drainFluidUpdates(harness.state)).toStrictEqual([invalidNeighbour, later])
        expect(yield* Ref.get(harness.state.fluidFrontier)).toContainEqual({
          ...invalidNeighbour, level: 0, source: true, falling: false, deferred: 1,
        })
        expect(yield* harness.commit.coordinator.revision).toBe(0)
      }),
    )
  }

  it.effect('records distinct reasons once across fault families and preserves deduplication after draining', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const entityId = EntityId('fault-families')
      const cell = blockPosition(0, 64, 0)
      const invalidAxisFailure = Result.getOrThrow(Result.flip(BlockAxis.result(Number.NaN)))
      const faults: ReadonlyArray<EntityStageFault> = [
        { _tag: 'FluidNeighbourPositionFault', cell, reason: 'coordinate-overflow' },
        { _tag: 'FluidNeighbourPositionFault', cell, reason: 'unknown-face' },
        { _tag: 'MobFrameRuleFault', entityId, failure: { _tag: 'InvalidFrameRollInput', field: 'seed' } },
        { _tag: 'MobFrameRuleFault', entityId, failure: { _tag: 'InvalidFrameRollInput', field: 'count' } },
        { _tag: 'MobRosterDamageFault', entityId, failure: { _tag: 'InvalidDamageApplicationInput', field: 'damage.amount' } },
        { _tag: 'MobRosterDamageFault', entityId, failure: { _tag: 'InvalidDamageApplicationInput', field: 'damage.cause' } },
        {
          _tag: 'EntityWorldDataFault', source: 'ItemUse', target: { _tag: 'Cell', cell },
          failure: { _tag: 'EntityWorldRegistryFailure', cell, failure: invalidAxisFailure },
        },
      ]
      for (const fault of faults) {
        yield* recordGameplayEntityStageFault(state, fault)
        yield* recordGameplayEntityStageFault(state, fault)
      }
      yield* recordGameplayRequestFault(state, 'Fluid')
      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual([
        ...faults, { _tag: 'GameplayRequestFault', source: 'Fluid', reason: 'InvalidBlockPositionKey' },
      ])
      for (const fault of faults) yield* recordGameplayEntityStageFault(state, fault)
      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual([])
    }),
  )

  it.effect('records an invalid world position without inventing an entity identifier', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const failure = {
        _tag: 'EntityWorldInvalidCell' as const, reason: 'not-block-coordinate' as const,
        position: position(PositionAxis(0.5), PositionAxis(64), PositionAxis(0)),
      }
      yield* recordGameplayEntityWorldDataFault(state, 'MobMovement', failure)
      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual([{
        _tag: 'EntityWorldDataFault', source: 'MobMovement', target: { _tag: 'Position', position: failure.position }, failure,
      }])
    }),
  )

  it.effect('rejects a mining context with a custom prototype before queueing', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const malformed = Object.create({ fortuneLevel: 1 }) as NonNullable<Parameters<typeof requestBlockBreak>[2]>
      yield* requestBlockBreak(state, blockPosition(0, 64, 0), malformed)
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
      expect(yield* drainGameplayEntityStageFaults(state)).toMatchObject([{
        _tag: 'GameplayRequestFault', source: 'Mining', reason: 'InvalidBlockLootContext',
      }])
    }),
  )

  it('rejects malformed placement roots', () => {
    for (const command of [null, undefined, false]) {
      expect(validateBlockPlacementCommand(command)).toStrictEqual(Result.fail({
        _tag: 'InvalidBlockPlacementCommand', field: 'requestId',
      }))
    }
  })

  it.effect('refuses an invalid legacy bow release before queueing', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      yield* requestBowShot(state, {
        origin: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)), dirX: 0, dirY: 0, dirZ: 1,
        chargeSecs: -1, inventory: { mode: 'creative', slotIndex: 0 },
      })
      expect(yield* Ref.get(state.pendingBowShots)).toStrictEqual([])
      expect(yield* drainGameplayEntityStageFaults(state)).toStrictEqual([{
        _tag: 'GameplayRequestFault', source: 'ItemUse', reason: 'InvalidBowChargeSecs',
      }])
    }),
  )

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

          expect(resolved).toMatchObject({ _tag: 'SchemaError' })
          expect(requested).toMatchObject({ _tag: 'SchemaError' })
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
