import { describe, expect, it } from '@effect/vitest'
import { AIR_BLOCK_ID, blockIdOf } from '@nerima-games/mc-kernel'
import { Effect, Option, Ref, Schema } from 'effect'
import { cellKey, chunkKey, chunkOf, makeInMemoryWorld } from '../../src/domain/in-memory-world.js'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import {
  gameplayStages,
  makeGameplayFrameState,
  requestTargetedBlockBreak,
} from '../../src/stages/registration'
import { PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import { runFrame } from '../support/frame-runner'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { blockPosition, position as fixturePosition } from '../support/coordinate-fixtures'

const TARGET = blockPosition(0, 1, 0)
const DIRT_ID = Option.getOrThrow(blockIdOf('dirt'))

const storedItemCount = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: string,
): number => storage.inventory.slots.reduce(
  (count, slot) => count + (slot?.item === item ? slot.count : 0),
  0,
)

describe('mining gameplay scenario', () => {
  it.effect('aims at a block, runs all gameplay stages, and commits its removal and drop', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        spawnPose: {
          feetPosition: fixturePosition(0.5, 0, 2.5),
          yawRadians: 0,
          pitchRadians: 0,
        },
        world: {
          blocks: new Map([[cellKey(TARGET), DIRT_ID]]),
          loaded: [chunkKey(chunkOf(TARGET))],
        },
      })
      const state = yield* makeGameplayFrameState
      const playerPose = yield* world.player.pose
      const dimension = yield* world.player.dimension
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, {
        playerPose,
        dimension,
      })
      const entitiesOwnerId = commit.entitiesOwnerId
      if (entitiesOwnerId === undefined) throw new Error('the entity owner must be registered for targeting')
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
      const before = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      const target = yield* requestTargetedBlockBreak(state, world.chunkStore, {
        coordinator: commit.coordinator,
        playerOwnerId: commit.playerOwnerId,
        entitiesOwnerId,
      })
      expect(Option.getOrUndefined(target)?.position).toStrictEqual(TARGET)

      yield* runFrame(stages)

      expect(yield* world.chunkStore.getBlock(TARGET)).toStrictEqual({
        _tag: 'Block',
        block: AIR_BLOCK_ID,
      })
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
      const after = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(storedItemCount(after.state, 'dirt') - storedItemCount(before.state, 'dirt')).toBe(1)
    }),
  )
})
