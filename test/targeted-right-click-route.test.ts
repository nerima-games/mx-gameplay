import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'

import { BlockId, blockIdOf, type BlockPosition } from '@nerima-games/mc-kernel'
import { cellKey, chunkKey, chunkOf, makeInMemoryWorld } from '../src/domain/in-memory-world.js'
import { targetedRightClickRoute } from '../src/stages/targeted-right-click-route'
import { blockPosition, position } from './support/coordinate-fixtures.js'

const TARGET = blockPosition(0, 1, 0)
const BEHIND_TARGET = blockPosition(0, 1, -1)
const SPAWN_POSE = {
  feetPosition: position(0.5, 0, 2.5),
  yawRadians: 0,
  pitchRadians: 0,
}
const CRAFTING_TABLE_ID = Option.getOrThrow(blockIdOf('crafting_table'))
const CHEST_ID = Option.getOrThrow(blockIdOf('chest'))
const SHULKER_BOX_ID = Option.getOrThrow(blockIdOf('shulker_box'))
const DIRT_ID = Option.getOrThrow(blockIdOf('dirt'))
// 60_000: inside kernel's `BlockId` brand range ([0, 65535], a storage bound)
// but far outside its registry (~120 rows), so it is genuinely unregistered
// rather than out-of-range-invalid — `999_999` used to stand in for this
// before the mirror's unbranded `BlockId` was repointed to kernel's real,
// range-validated one.
const UNKNOWN_BLOCK_ID = 60_000

const makeTargetedWorld = (block: number, loaded: boolean = true) =>
  makeInMemoryWorld({
    world: {
      blocks: new Map([[cellKey(TARGET), BlockId(block)]]),
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
