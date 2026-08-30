import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { blockIdOf } from '@nerima-games/mc-kernel'
import type { BlockPosition } from '../src/domain/chunk-store-port'
import { cellKey, chunkKey, chunkOf } from '../src/domain/in-memory-chunk-store'
import { makeInMemoryWorld } from '../src/domain/in-memory-world'
import { targetedRightClickRoute } from '../src/stages/targeted-right-click-route'

const TARGET = { x: 0, y: 1, z: 0 }
const BEHIND_TARGET = { x: 0, y: 1, z: -1 }
const SPAWN_POSE = {
  feetPosition: { x: 0.5, y: 0, z: 2.5 },
  yawRadians: 0,
  pitchRadians: 0,
}
const CRAFTING_TABLE_ID = blockIdOf('crafting_table') ?? -1
const CHEST_ID = blockIdOf('chest') ?? -1
const SHULKER_BOX_ID = blockIdOf('shulker_box') ?? -1
const DIRT_ID = blockIdOf('dirt') ?? -1
const UNKNOWN_BLOCK_ID = 999_999

const makeTargetedWorld = (block: number, loaded: boolean = true) =>
  makeInMemoryWorld({
    world: {
      blocks: new Map([[cellKey(TARGET), block]]),
      loaded: loaded ? [chunkKey(chunkOf(TARGET))] : [],
    },
    spawnPose: SPAWN_POSE,
  })

describe('targetedRightClickRoute', () => {
  it.effect('resolves a crafting-table route from player targeting state', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(CRAFTING_TABLE_ID)
      const route = yield* targetedRightClickRoute(world.chunkStore, world.player)

      expect(route).toEqual({ kind: 'craftingTable', at: TARGET })
    }),
  )

  it.effect('preserves chest identity through targeting and routing', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(CHEST_ID)

      expect(yield* targetedRightClickRoute(world.chunkStore, world.player)).toEqual({
        kind: 'storage',
        at: TARGET,
        block: 'chest',
      })
    }),
  )

  it.effect('preserves shulker-box identity through targeting and routing', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(SHULKER_BOX_ID)

      expect(yield* targetedRightClickRoute(world.chunkStore, world.player)).toEqual({
        kind: 'storage',
        at: TARGET,
        block: 'shulker_box',
      })
    }),
  )

  it.effect('returns undefined when the targeted block has no right-click route', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(DIRT_ID)
      const route = yield* targetedRightClickRoute(world.chunkStore, world.player)

      expect(route).toBeUndefined()
    }),
  )

  it.effect('honors a shorter maximum targeting distance', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(CRAFTING_TABLE_ID)
      const route = yield* targetedRightClickRoute(
        world.chunkStore,
        world.player,
        0.5,
      )

      expect(route).toBeUndefined()
    }),
  )

  it.effect('supports asynchronous block reads without reading a coordinate twice', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(CRAFTING_TABLE_ID)
      const readCounts = new Map<string, number>()
      const store = {
        ...world.chunkStore,
        getBlock: (position: BlockPosition) =>
          Effect.promise(async () => {
            const key = cellKey(position)
            readCounts.set(key, (readCounts.get(key) ?? 0) + 1)
            return Effect.runSync(world.chunkStore.getBlock(position))
          }),
      }

      const route = yield* targetedRightClickRoute(store, world.player)

      expect(route).toEqual({ kind: 'craftingTable', at: TARGET })
      expect(readCounts.get(cellKey(TARGET))).toBe(1)
      expect(readCounts.has(cellKey(BEHIND_TARGET))).toBe(false)
      expect([...readCounts.values()].every((count) => count === 1)).toBe(true)
    }),
  )

  it.effect('returns undefined when the ray crosses only air', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(0)

      expect(
        yield* targetedRightClickRoute(world.chunkStore, world.player),
      ).toBeUndefined()
    }),
  )

  it.effect('returns undefined when the target chunk is not loaded', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(CRAFTING_TABLE_ID, false)

      expect(
        yield* targetedRightClickRoute(world.chunkStore, world.player),
      ).toBeUndefined()
    }),
  )

  it.effect('returns undefined for an unknown non-air block id', () =>
    Effect.gen(function* () {
      const world = yield* makeTargetedWorld(UNKNOWN_BLOCK_ID)

      expect(
        yield* targetedRightClickRoute(world.chunkStore, world.player),
      ).toBeUndefined()
    }),
  )
})
