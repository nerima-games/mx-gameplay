import { describe, expect, it } from '@effect/vitest'
import { AIR_BLOCK_ID, blockIdOf, DeltaTimeSecs, itemStack, StackCount } from '@nerima-games/mc-kernel'
import { itemComponents } from '@nerima-games/mc-kernel/domain/item-components'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import { cellKey, chunkKey, chunkOf, makeInMemoryWorld } from '../../src/domain/in-memory-world.js'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import {
  gameplayStages,
  getMiningProgressFraction,
  makeGameplayFrameState,
  requestBlockMining,
  requestStatusEffect,
  requestTargetedBlockBreak,
} from '../../src/stages/registration'
import { PlayerStorageSnapshotSchema, storageFromInventory } from '@nerima-games/mc-sim'
import { runFrame } from '../support/frame-runner'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { blockPosition, position as fixturePosition } from '../support/coordinate-fixtures'
import { emptySlots } from '../support/inventory-service-double'

const TARGET = blockPosition(0, 1, 0)
const DIRT_ID = Option.getOrThrow(blockIdOf('dirt'))
const STONE_ID = Option.getOrThrow(blockIdOf('stone'))
const PICKAXE_SLOT = { _tag: 'Inventory' as const, slotIndex: 0 }
const SERVER_TICK = DeltaTimeSecs(1 / 20)
const PINNED_STONE_HARDNESS = 25
const HASTE_I_MINING_SPEED_MULTIPLIER = 1.2
const EFFICIENCY_I_WOOD_PICKAXE_SPEED = 2 + 1 + 1 ** 2
const EXPECTED_EFFICIENCY_I_STONE_TICKS = 188 // ceil(25 hardness × 30 / speed 4)
const EXPECTED_PROGRESS_BEFORE_EFFICIENCY_I_STONE_BREAK =
  (EFFICIENCY_I_WOOD_PICKAXE_SPEED * (EXPECTED_EFFICIENCY_I_STONE_TICKS - 1)) /
  (PINNED_STONE_HARDNESS * 30)

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

  it.effect('applies Efficiency I to held pickaxe mining at the vanilla tick boundary', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        spawnPose: {
          feetPosition: fixturePosition(0.5, 0, 2.5),
          yawRadians: 0,
          pitchRadians: 0,
        },
        world: {
          blocks: new Map([[cellKey(TARGET), STONE_ID]]),
          loaded: [chunkKey(chunkOf(TARGET))],
        },
      })
      const state = yield* makeGameplayFrameState
      const playerPose = yield* world.player.pose
      const dimension = yield* world.player.dimension
      const slots = [...emptySlots()]
      const components = Result.getOrThrow(itemComponents('wooden_pickaxe', {
        enchantments: { 'minecraft:efficiency': 1 },
      }))
      slots[PICKAXE_SLOT.slotIndex] = Result.getOrThrow(itemStack('wooden_pickaxe', StackCount(1), {
        components,
      }))
      const playerStorage = storageFromInventory({ slots })
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, {
        playerPose,
        dimension,
        playerStorage,
      })
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

      for (let tick = 0; tick < EXPECTED_EFFICIENCY_I_STONE_TICKS - 1; tick += 1) {
        yield* requestBlockMining(state, { position: TARGET, dimension, toolLocation: PICKAXE_SLOT })
        yield* runFrame(stages, SERVER_TICK)
      }
      expect(yield* world.chunkStore.getBlock(TARGET)).toStrictEqual({
        _tag: 'Block',
        block: STONE_ID,
      })
      expect(yield* getMiningProgressFraction(state)).toBeCloseTo(
        EXPECTED_PROGRESS_BEFORE_EFFICIENCY_I_STONE_BREAK,
      )

      yield* requestBlockMining(state, { position: TARGET, dimension, toolLocation: PICKAXE_SLOT })
      yield* runFrame(stages, SERVER_TICK)

      expect(yield* world.chunkStore.getBlock(TARGET)).toStrictEqual({
        _tag: 'Block',
        block: AIR_BLOCK_ID,
      })
      const after = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(storedItemCount(after.state, 'cobblestone')).toBe(1)
    }),
  )

  it.effect('applies Haste I to mining progress after the status-effect tick', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        spawnPose: {
          feetPosition: fixturePosition(0.5, 0, 2.5),
          yawRadians: 0,
          pitchRadians: 0,
        },
        world: {
          blocks: new Map([[cellKey(TARGET), STONE_ID]]),
          loaded: [chunkKey(chunkOf(TARGET))],
        },
      })
      const state = yield* makeGameplayFrameState
      const playerPose = yield* world.player.pose
      const dimension = yield* world.player.dimension
      const slots = [...emptySlots()]
      slots[PICKAXE_SLOT.slotIndex] = Result.getOrThrow(itemStack(
        'wooden_pickaxe',
        StackCount(1),
      ))
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, {
        playerPose,
        dimension,
        playerStorage: storageFromInventory({ slots }),
      })
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

      yield* requestStatusEffect(state, { type: 'haste', durationSecs: 60 })
      yield* requestBlockMining(state, { position: TARGET, dimension, toolLocation: PICKAXE_SLOT })
      yield* runFrame(stages, DeltaTimeSecs(1))

      expect(yield* getMiningProgressFraction(state)).toBeCloseTo(
        (20 * 2 * HASTE_I_MINING_SPEED_MULTIPLIER) / (PINNED_STONE_HARDNESS * 30),
      )
      expect(yield* world.chunkStore.getBlock(TARGET)).toStrictEqual({
        _tag: 'Block',
        block: STONE_ID,
      })
    }),
  )
})
