import { describe, expect, it } from '@effect/vitest'
import {
  AIR_BLOCK_ID,
  blockIdOf,
  blockPositionKeyOf,
  itemStack,
  StackCount,
  type BlockId,
  type BlockPosition,
  type StageRegistration,
  DeltaTimeSecs,
} from '@nerima-games/mc-kernel'
import {
  makeTimeService,
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  TntServiceSnapshotSchema,
} from '@nerima-games/mc-sim'
import { Effect, Option, Ref, Result } from 'effect'
import { ENDER_PEARL_DAMAGE } from '../src/domain/interactions/throw-ender-pearl'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../src/domain/entities/xp-orb'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import {
  drainBlockPlacementResults,
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestBlockPlacementCommand,
  requestEnderPearlThrow,
  requestItemUse,
} from '../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { GAMEPLAY_VITALS_OWNER_ID } from '../src/stages/gameplay-owner-registrations'
import type { GameplayStageCommitServices } from '../src/stages/registration-core'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { FrameServicesLayer } from './support/frame-services'
import { blockPosition } from './support/coordinate-fixtures'
import { makePlayerServiceDouble, SPAWN_POSE } from './support/player-service-double'
import { world } from './support/chunk-store-double'
import {
  makeGameplayCommitServices,
  makeTransactionalChunkStoreDouble,
} from './support/transactional-stage-doubles'

type CommitRequest = Parameters<GameplayStageCommitServices['coordinator']['commit']>[0]

const blockId = (name: Parameters<typeof blockIdOf>[0]): BlockId => Option.getOrThrow(blockIdOf(name))

const inventoryWith = (item: Parameters<typeof itemStack>[0]) => {
  const stack = Result.getOrThrow(itemStack(item, StackCount(1)))
  return emptySlots().map((slot, index) => index === 0 ? stack : slot)
}

const makeHarness = (
  entries: ReadonlyArray<readonly [BlockPosition, BlockId]>,
  heldItem: Parameters<typeof itemStack>[0],
) => Effect.gen(function* () {
  const store = yield* makeTransactionalChunkStoreDouble(world(entries), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const inventory = yield* makeInventoryDouble(inventoryWith(heldItem))
  const player = yield* makePlayerServiceDouble(SPAWN_POSE)
  const time = yield* makeTimeService()
  const baseCommit = yield* makeGameplayCommitServices(store.api, inventory.api, {
    playerPose: yield* player.api.pose,
    dimension: yield* player.api.dimension,
  })
  const requests: Array<CommitRequest> = []
  const coordinator: GameplayStageCommitServices['coordinator'] = {
    ...baseCommit.coordinator,
    commit: (request) => {
      requests.push(request)
      return baseCommit.coordinator.commit(request)
    },
  }
  const commit: GameplayStageCommitServices = { ...baseCommit, coordinator }
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator: baseCommit.coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const interactions = gameplayStages(
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
  ).find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
  if (interactions === undefined) throw new Error('interactions stage was not registered')
  return { commit, interactions, inventory, requests, state, store }
})


const runInteractions = (stage: StageRegistration) =>
  stage.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

describe('owner-backed movement and item interactions through gameplay registration', () => {
  it.effect('commits vertical pearl travel, pearl consumption, and damage in one owner revision', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([], 'ender_pearl')
      const { commit } = harness
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestEnderPearlThrow(harness.state, {
        requestId: 'vertical-pearl-travel',
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        hitDistance: 4,
        inventory: { mode: 'survival', slotIndex: 0 },
      })
      yield* runInteractions(harness.interactions)

      const player = yield* commit.coordinator.snapshot(commit.playerOwnerId, PlayerServiceSnapshotSchema)
      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const vitals = yield* commit.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)
      const [request] = harness.requests

      expect(yield* Ref.get(harness.state.enderPearlOutcomes)).toStrictEqual([{
        displacement: { x: 0, y: 4, z: 0 },
        damage: { amount: ENDER_PEARL_DAMAGE, cause: 'ender_pearl' },
      }])
      expect(player.state.pose.feetPosition.y).toBe(SPAWN_POSE.feetPosition.y + 4)
      expect(storage.state.inventory.slots[0]).toBeUndefined()
      expect(vitals.state.vitals.healthPoints).toBe(20 - ENDER_PEARL_DAMAGE)
      expect(harness.requests).toHaveLength(1)
      expect(request?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
        commit.playerOwnerId,
        commit.playerStorageOwnerId,
        GAMEPLAY_VITALS_OWNER_ID,
      ]))
      expect(player.revision).toBe(revisionBefore + 1)
      expect(storage.revision).toBe(revisionBefore + 1)
      expect(vitals.revision).toBe(revisionBefore + 1)
      expect(yield* commit.coordinator.revision).toBe(revisionBefore + 1)
    }),
  )

  it.effect('commits survival block placement and storage consumption together once', () =>
    Effect.gen(function* () {
      const target = blockPosition(2, 64, 2)
      const support = blockPosition(2, 63, 2)
      const sand = blockId('sand')
      const harness = yield* makeHarness([[support, blockId('stone')]], 'sand')
      const { commit } = harness
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestBlockPlacementCommand(harness.state, {
        requestId: 'atomic-sand-placement',
        positionKey: blockPositionKeyOf(target),
        heldItem: 'sand',
        mode: 'survival',
      })
      yield* runInteractions(harness.interactions)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const [request] = harness.requests

      expect(yield* harness.store.blockAt(target)).toBe(sand)
      expect(storage.state.inventory.slots[0]).toBeUndefined()
      expect(yield* drainBlockPlacementResults(harness.state)).toMatchObject([{
        requestId: 'atomic-sand-placement',
        success: true,
        consumed: true,
        replayed: false,
        outcome: { _tag: 'Placed' },
      }])
      expect(harness.requests).toHaveLength(1)
      expect(request?.expectedRevision).toBe(revisionBefore)
      expect(request?.changes.map(({ ownerId }) => ownerId)).toStrictEqual([commit.playerStorageOwnerId])
      expect(request?.blockWrite?.edits).toMatchObject([{ position: target, block: sand }])
      expect(storage.revision).toBe(revisionBefore + 1)
      expect(yield* commit.coordinator.revision).toBe(revisionBefore + 1)
    }),
  )

  it.effect('primes TNT with one fire charge and one atomic storage-and-block commit', () =>
    Effect.gen(function* () {
      const target = blockPosition(2, 64, 2)
      const tnt = blockId('tnt')
      const harness = yield* makeHarness([[target, tnt]], 'fire_charge')
      const { commit } = harness
      const tntOwnerId = commit.tntOwnerId
      if (tntOwnerId === undefined) throw new Error('TNT owner was not registered')
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestItemUse(harness.state, 'ignite-tnt-with-charge', target, 'fire_charge')
      yield* runInteractions(harness.interactions)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const tnts = yield* commit.coordinator.snapshot(tntOwnerId, TntServiceSnapshotSchema)
      const [request] = harness.requests

      expect(yield* drainItemUseResults(harness.state)).toStrictEqual([{
        requestId: 'ignite-tnt-with-charge',
        heldItem: 'fire_charge',
        success: true,
        outcome: { _tag: 'Tnt', outcome: { _tag: 'Lit' } },
      }])
      expect(yield* Ref.get(harness.state.usedItems)).toStrictEqual(['fire_charge'])
      expect(yield* harness.store.blockAt(target)).toBeUndefined()
      expect(storage.state.inventory.slots[0]).toBeUndefined()
      expect(tnts.state.tnts).toHaveLength(1)
      expect(tnts.state.tnts[0]?.state.kind).toBe('primed')
      expect(harness.requests).toHaveLength(1)
      expect(request?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
        tntOwnerId,
        commit.playerStorageOwnerId,
      ]))
      expect(request?.blockWrite?.edits).toMatchObject([{ position: target, block: AIR_BLOCK_ID }])
      expect(storage.revision).toBe(revisionBefore + 1)
      expect(tnts.revision).toBe(revisionBefore + 1)
      expect(yield* commit.coordinator.revision).toBe(revisionBefore + 1)
    }),
  )

  it.effect('primes TNT with flint-and-steel and damages the held item in the same commit', () =>
    Effect.gen(function* () {
      const target = blockPosition(2, 64, 2)
      const tnt = blockId('tnt')
      const harness = yield* makeHarness([[target, tnt]], 'flint_and_steel')
      const { commit } = harness
      const tntOwnerId = commit.tntOwnerId
      if (tntOwnerId === undefined) throw new Error('TNT owner was not registered')
      const before = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const durabilityBefore = before.state.inventoryDurability[0]
      if (durabilityBefore === null || durabilityBefore === undefined) {
        throw new Error('flint-and-steel durability was not initialized')
      }
      const revisionBefore = yield* commit.coordinator.revision

      yield* requestItemUse(harness.state, 'ignite-tnt-with-flint', target, 'flint_and_steel')
      yield* runInteractions(harness.interactions)

      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      const tnts = yield* commit.coordinator.snapshot(tntOwnerId, TntServiceSnapshotSchema)
      const [request] = harness.requests
      const durabilityAfter = storage.state.inventoryDurability[0]

      expect(yield* drainItemUseResults(harness.state)).toMatchObject([{
        requestId: 'ignite-tnt-with-flint',
        heldItem: 'flint_and_steel',
        success: true,
        outcome: { _tag: 'Tnt', outcome: { _tag: 'Lit' } },
      }])
      expect(yield* harness.store.blockAt(target)).toBeUndefined()
      expect(storage.state.inventory.slots[0]?.item).toBe('flint_and_steel')
      expect(durabilityAfter?.current).toBe(durabilityBefore.current - 1)
      expect(tnts.state.tnts[0]?.state.kind).toBe('primed')
      expect(harness.requests).toHaveLength(1)
      expect(request?.changes.map(({ ownerId }) => ownerId)).toEqual(expect.arrayContaining([
        tntOwnerId,
        commit.playerStorageOwnerId,
      ]))
      expect(request?.blockWrite?.edits).toMatchObject([{ position: target, block: AIR_BLOCK_ID }])
      expect(storage.revision).toBe(revisionBefore + 1)
      expect(tnts.revision).toBe(revisionBefore + 1)
      expect(yield* commit.coordinator.revision).toBe(revisionBefore + 1)
    }),
  )
})
