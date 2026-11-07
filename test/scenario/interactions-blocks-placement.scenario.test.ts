import { describe, expect, it } from '@effect/vitest'
import { makeTimeService, PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import { Effect, Result, Schema } from 'effect'
import { blockPositionKeyOf, itemStack, StackCount, type BlockPosition } from '@nerima-games/mc-kernel'
import {
  drainBlockPlacementResults,
  gameplayStages,
  makeGameplayFrameState,
  requestBlockBreak,
  requestBlockPlacementCommand,
} from '../../src/stages/registration'
import { NO_TOOL } from '../../src/domain/interactions/block-loot'
import { SAND, STONE, world } from '../support/chunk-store-double'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { makePlayerServiceDouble } from '../support/player-service-double'
import { emptySlots, makeInventoryDouble } from '../support/inventory-service-double'
import { blockPosition } from '../support/coordinate-fixtures'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { runFrame } from '../support/frame-runner'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from '../support/transactional-stage-doubles'

const target: BlockPosition = blockPosition(2, 64, 3)
const support: BlockPosition = blockPosition(2, 63, 3)

const placementSlice = () =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(world([[support, STONE]]), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const player = yield* makePlayerServiceDouble()
    const slots = [...emptySlots()]
    slots[0] = Result.getOrThrow(itemStack('sand', StackCount(1)))
    const inventory = yield* makeInventoryDouble(slots)
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      playerPose: yield* player.api.pose,
      dimension: yield* player.api.dimension,
    })

    return {
      store,
      state,
      commit,
      stages: gameplayStages(
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
      ),
    }
  })

const countOwnerItem = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: string,
): number =>
  storage.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

describe('block placement gameplay scenarios', () => {
  it.effect('places supported sand, then mines it back into the player inventory', () =>
    Effect.gen(function* () {
      const { store, state, commit, stages } = yield* placementSlice()

      yield* requestBlockPlacementCommand(state, {
        requestId: 'placement-round-trip',
        positionKey: blockPositionKeyOf(target),
        heldItem: 'sand',
      })
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBe(SAND)
      expect(yield* drainBlockPlacementResults(state)).toMatchObject([
        {
          requestId: 'placement-round-trip',
          success: true,
          consumed: true,
          outcome: { _tag: 'Placed', consumed: 'sand' },
        },
      ])
      const afterPlacement = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(countOwnerItem(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(afterPlacement.state), 'sand')).toBe(0)

      yield* requestBlockBreak(state, target, NO_TOOL)
      yield* runFrame(stages)

      expect(yield* store.blockAt(target)).toBeUndefined()
      const afterMining = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(countOwnerItem(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(afterMining.state), 'sand')).toBe(1)
    }),
  )
})
