import { describe, expect, it } from '@effect/vitest'
import {
  AIR_BLOCK_ID,
  BlockAxis,
  DeltaTimeSecs,
  StackCount,
  WorldWriteBatchSchema,
  blockIdOf,
  blockPosition,
  itemStack,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  makeReplicatedOwnerId,
  makeTimeService,
  PlayerStorageSnapshotSchema,
  TntServiceSnapshotSchema,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import { TNT_EXPLOSION_POWER } from '../src/domain/mob/explosion'
import {
  FRESH_PRIMED_TNT,
  PRIMED_TNT_FUSE_SECS,
  isPrimedTnt,
  stepPrimedTnt,
} from '../src/domain/mob/primed-tnt'
import {
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestItemUse,
} from '../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { GAMEPLAY_VITALS_OWNER_ID } from '../src/stages/gameplay-owner-registrations'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import type { GameplayStageCommitServices } from '../src/stages/registration-core'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { FrameServicesLayer } from './support/frame-services'
import { makePlayerServiceDouble, SPAWN_POSE } from './support/player-service-double'
import { world } from './support/chunk-store-double'
import {
  makeGameplayCommitServices,
  makeTransactionalChunkStoreDouble,
} from './support/transactional-stage-doubles'

const TNT_TARGET = blockPosition(BlockAxis(2), BlockAxis(64), BlockAxis(2))
const TNT_BLOCK = Option.getOrThrow(blockIdOf('tnt'))

const makeTntItemUseHarness = (
  inventoryItem: 'empty' | 'fire_charge' | 'flint_and_steel' = 'fire_charge',
) =>
  Effect.gen(function* () {
    const slots = emptySlots()
    if (inventoryItem !== 'empty') {
      slots[0] = Result.getOrThrow(itemStack(inventoryItem, StackCount(1)))
    }
    const store = yield* makeTransactionalChunkStoreDouble(world([[TNT_TARGET, TNT_BLOCK]]), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(slots)
    const player = yield* makePlayerServiceDouble(SPAWN_POSE)
    const time = yield* makeTimeService()
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      playerPose: yield* player.api.pose,
      dimension: yield* player.api.dimension,
    })
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    const run = (overrides: Partial<GameplayStageCommitServices> = {}) => {
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
        { ...commit, ...overrides },
      )
      const interactions = stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions)
      if (interactions === undefined) throw new Error('interactions stage was not registered')
      return interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
    }
    return { commit, inventory, player, run, state, store }
  })

describe('primed TNT', () => {
  it('returns the same fuse object when no elapsed time changes it', () => {
    expect(stepPrimedTnt(FRESH_PRIMED_TNT, DeltaTimeSecs(0))).toStrictEqual({ tnt: FRESH_PRIMED_TNT })
  })

  it('preserves the fuse until four seconds have elapsed', () => {
    const waiting = stepPrimedTnt(FRESH_PRIMED_TNT, DeltaTimeSecs(PRIMED_TNT_FUSE_SECS - 0.01))
    expect(waiting.explosion).toBeUndefined()

    const exploded = stepPrimedTnt(waiting.tnt, DeltaTimeSecs(0.01))
    expect(exploded.explosion).toStrictEqual({ source: 'tnt', power: TNT_EXPLOSION_POWER })
  })

  it('rejects invalid persisted fuse state', () => {
    expect(isPrimedTnt({ _tag: 'PrimedTnt', burnedSecs: Number.NaN })).toBe(false)
    expect(isPrimedTnt({ _tag: 'PrimedTnt', burnedSecs: -1 })).toBe(false)
    expect(isPrimedTnt(FRESH_PRIMED_TNT)).toBe(true)
  })
})

describe('TNT item use through the interactions stage', () => {
  it.effect('records a typed TNT-owner observation failure without consuming the item or changing the block', () =>
    Effect.gen(function* () {
      const harness = yield* makeTntItemUseHarness()
      const tntOwnerId = harness.commit.tntOwnerId
      if (tntOwnerId === undefined) throw new Error('TNT owner was not registered')
      const tntBefore = yield* harness.commit.coordinator.snapshot(tntOwnerId, TntServiceSnapshotSchema)
      const storageBefore = yield* harness.commit.coordinator.snapshot(
        harness.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      yield* requestItemUse(harness.state, 'missing-tnt-owner', TNT_TARGET, 'fire_charge')
      yield* harness.run({ tntOwnerId: makeReplicatedOwnerId('test:unregistered-tnt-owner') })

      expect((yield* Ref.get(harness.state.operationFailures)).at(-1)).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'ItemUse',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })
      expect(yield* drainItemUseResults(harness.state)).toStrictEqual([])
      expect(yield* harness.store.blockAt(TNT_TARGET)).toBe(TNT_BLOCK)
      expect((yield* harness.commit.coordinator.snapshot(tntOwnerId, TntServiceSnapshotSchema)))
        .toStrictEqual(tntBefore)
      expect((yield* harness.commit.coordinator.snapshot(
        harness.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      ))).toStrictEqual(storageBefore)
    }),
  )

  it.effect('records a typed player-storage observation failure after the TNT observation succeeds', () =>
    Effect.gen(function* () {
      const harness = yield* makeTntItemUseHarness()
      const tntOwnerId = harness.commit.tntOwnerId
      if (tntOwnerId === undefined) throw new Error('TNT owner was not registered')
      const tntBefore = yield* harness.commit.coordinator.snapshot(tntOwnerId, TntServiceSnapshotSchema)
      const storageBefore = yield* harness.commit.coordinator.snapshot(
        harness.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      yield* requestItemUse(harness.state, 'missing-storage-owner', TNT_TARGET, 'fire_charge')
      yield* harness.run({ playerStorageOwnerId: makeReplicatedOwnerId('test:unregistered-player-storage') })

      expect((yield* Ref.get(harness.state.operationFailures)).at(-1)).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'ItemUse',
        error: { _tag: 'ReplicatedOwnerUnknown' },
      })
      expect(yield* drainItemUseResults(harness.state)).toStrictEqual([])
      expect(yield* harness.store.blockAt(TNT_TARGET)).toBe(TNT_BLOCK)
      expect((yield* harness.commit.coordinator.snapshot(tntOwnerId, TntServiceSnapshotSchema)))
        .toStrictEqual(tntBefore)
      expect((yield* harness.commit.coordinator.snapshot(
        harness.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      ))).toStrictEqual(storageBefore)
    }),
  )

  it.effect('reports an owner revision conflict when a valid TNT transaction lands between observations', () =>
    Effect.gen(function* () {
      const harness = yield* makeTntItemUseHarness()
      const tntOwnerId = harness.commit.tntOwnerId
      if (tntOwnerId === undefined) throw new Error('TNT owner was not registered')
      const base = harness.commit.coordinator
      const dimension = yield* harness.player.api.dimension
      let raced = false
      const coordinator: WorldCommitCoordinatorApi = {
        ...base,
        observe: (ownerId, schema, reads) => Effect.gen(function* () {
          const observed = yield* base.observe(ownerId, schema, reads)
          if (ownerId === tntOwnerId && !raced) {
            raced = true
            const current = yield* base.snapshot(tntOwnerId, TntServiceSnapshotSchema)
            yield* base.commit({
              expectedRevision: current.revision,
              expectedDimensions: [],
              changes: [{
                ownerId: tntOwnerId,
                state: {
                  tnts: [...current.state.tnts, {
                    id: EntityId('test:concurrent-tnt'),
                    dimension,
                    center: { x: 20.5, y: 64.5, z: 20.5 },
                    state: { kind: 'primed', remainingFuseSecs: 4 },
                  }],
                },
              }],
            })
          }
          return observed
        }),
      }

      yield* requestItemUse(harness.state, 'tnt-revision-race', TNT_TARGET, 'fire_charge')
      yield* harness.run({ coordinator })

      expect((yield* Ref.get(harness.state.operationFailures)).at(-1)).toMatchObject({
        _tag: 'Failed',
        operation: 'OwnerSnapshot',
        subject: 'ItemUse',
        error: { _tag: 'WorldRevisionConflict', expected: 0, actual: 1 },
      })
      expect(yield* drainItemUseResults(harness.state)).toStrictEqual([])
      expect(yield* harness.store.blockAt(TNT_TARGET)).toBe(TNT_BLOCK)
      expect((yield* base.snapshot(tntOwnerId, TntServiceSnapshotSchema)).state.tnts)
        .toHaveLength(1)
      expect((yield* base.snapshot(
        harness.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )).state.inventory.slots[0]?.item).toBe('fire_charge')
    }),
  )

  it.effect('skips ignition when a valid concurrent world commit removes the observed TNT block', () =>
    Effect.gen(function* () {
      const harness = yield* makeTntItemUseHarness()
      const tntOwnerId = harness.commit.tntOwnerId
      if (tntOwnerId === undefined) throw new Error('TNT owner was not registered')
      const base = harness.commit.coordinator
      const dimension = yield* harness.player.api.dimension
      let removed = false
      const coordinator: WorldCommitCoordinatorApi = {
        ...base,
        observe: (ownerId, schema, reads) => Effect.gen(function* () {
          if (ownerId === tntOwnerId && !removed) {
            removed = true
            const expectedRevision = yield* base.revision
            const expectedDimensionRevision = yield* base.dimensionRevision(dimension)
            const blockWrite = Schema.decodeUnknownSync(WorldWriteBatchSchema)({
              world: base.worldId,
              expectedWorldRevision: expectedRevision,
              dimension,
              expectedDimensionRevision,
              edits: [{ position: TNT_TARGET, block: AIR_BLOCK_ID }],
            })
            yield* base.commit({
              expectedRevision,
              expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
              changes: [],
              blockWrite,
            })
          }
          return yield* base.observe(ownerId, schema, reads)
        }),
      }

      yield* requestItemUse(harness.state, 'tnt-block-race', TNT_TARGET, 'fire_charge')
      yield* harness.run({ coordinator })

      expect(yield* harness.store.blockAt(TNT_TARGET)).toBeUndefined()
      expect((yield* base.snapshot(tntOwnerId, TntServiceSnapshotSchema)).state.tnts).toStrictEqual([])
      expect((yield* base.snapshot(
        harness.commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )).state.inventory.slots[0]?.item).toBe('fire_charge')
      expect(yield* drainItemUseResults(harness.state)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.operationFailures)).toStrictEqual([])
    }),
  )

  it.effect('returns NotTnt when the requested ignition item is absent from the valid storage snapshot', () =>
    Effect.gen(function* () {
      const harness = yield* makeTntItemUseHarness('empty')
      const tntOwnerId = harness.commit.tntOwnerId
      if (tntOwnerId === undefined) throw new Error('TNT owner was not registered')
      const revisionBefore = yield* harness.commit.coordinator.revision

      yield* requestItemUse(harness.state, 'item-no-longer-held', TNT_TARGET, 'fire_charge')
      yield* harness.run()

      expect(yield* drainItemUseResults(harness.state)).toStrictEqual([{
        requestId: 'item-no-longer-held',
        heldItem: 'fire_charge',
        success: false,
        outcome: { _tag: 'Tnt', outcome: { _tag: 'NotTnt' } },
      }])
      expect(yield* harness.store.blockAt(TNT_TARGET)).toBe(TNT_BLOCK)
      expect((yield* harness.commit.coordinator.snapshot(tntOwnerId, TntServiceSnapshotSchema)).state.tnts)
        .toStrictEqual([])
      expect(yield* harness.commit.coordinator.revision).toBe(revisionBefore)
      expect(yield* Ref.get(harness.state.usedItems)).toStrictEqual([])
    }),
  )
})
