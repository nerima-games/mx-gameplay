import { describe, expect, it } from '@effect/vitest'
import { BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import { PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import { Effect, Option, Schema } from 'effect'
import { makeInMemoryWorld, cellKey, chunkKey, chunkOf } from '../../src/domain/in-memory-world'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { gameplayStages, makeGameplayFrameState, requestBlockBreak } from '../../src/stages/registration'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { runFrame } from '../support/frame-runner'
import { blockPosition } from '../support/coordinate-fixtures'

describe('block loot gameplay scenarios', () => {
  it.effect('mines glass with Silk Touch and commits the block item to player storage', () =>
    Effect.gen(function* () {
      const position = blockPosition(3, 64, 7)
      const glass = Option.getOrThrow(blockIdOf('glass'))
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: {
          blocks: new Map([[cellKey(position), glass]]),
          loaded: [chunkKey(chunkOf(position))],
        },
      })
      const state = yield* makeGameplayFrameState
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
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

      yield* requestBlockBreak(state, position, { silkTouch: true })
      yield* runFrame(stages)

      expect(yield* world.chunkStore.getBlock(position)).toStrictEqual({
        _tag: 'Block',
        block: BlockId(0),
      })
      const storageSnapshot = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const storage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storageSnapshot.state)
      const glassCount = storage.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'glass' ? slot.count : 0),
        0,
      )
      expect(glassCount).toBe(1)
    }),
  )
})
