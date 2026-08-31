/**
 * The break loop, end to end, against the real services.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST IS HERE AND NOT IN A BROWSER
 * ---------------------------------------------------------------------------
 *
 * mc-compose wires a left click to `requestTargetedBlockBreak`, and that wiring cannot
 * be exercised by Playwright: mc-render's `InputService` treats a click as a
 * GAME action only while the pointer is LOCKED — the closed-world predicate
 * that stops a HUD click stealing the pointer — and plan.md §3.10 records that
 * Playwright on SwiftShader cannot do pointer lock at all. mc-render's
 * `apps/preview-render` exists because of the same limit.
 *
 * Everything BELOW the click is reachable here, including aim resolution: the same
 * public door the host calls, the real `gameplay:interactions` stage, the real
 * in-memory `ChunkStore` and `InventoryService`. What is not covered is one
 * mouse event, and that is named rather than faked.
 *
 * IT IS AN INTEGRATION TEST ON PURPOSE. `test/rules.test.ts` covers
 * `breakBlock` as a rule; this covers the INBOX -> STAGE -> STORE -> INVENTORY
 * path, which is the part that was 「callable but unreachable」 until a host
 * filled the inbox. A rule with a green test file and no call site passes every
 * test that only checks the rule.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Ref } from 'effect'
import { BlockPositionKey as positionKey } from '@nerima-games/mc-kernel'
import {
  drainBlockUseResults,
  gameplayStages,
  makeGameplayFrameState,
  requestBlockBreak,
  requestTargetedBlockBreak,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
} from '../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { makeInMemoryWorld } from '../src/domain/in-memory-world'
import { cellKey, chunkKey, chunkOf } from '../src/domain/in-memory-chunk-store'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import type { BlockPosition } from '@nerima-games/mc-kernel'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { BlockId, blockIdOf, blockPosition } from '@nerima-games/mc-kernel'
import { NO_TOOL } from '../src/domain/interactions/block-loot'

/**
 * DIRT, and the id took two corrections that are worth recording because both
 * looked like defects in the drop path and neither was.
 *
 * The first cut used id 1, which is BEDROCK — it drops nothing, correctly. The
 * second used 2, which is STONE — bare hands cannot harvest it, also correctly,
 * because `satisfiesHarvestTier` gates the drop on a pickaxe.
 *
 * Dirt is the block that drops for a player holding nothing, which is what this
 * file needs: the inventory assertion is about the LOOP reaching the inventory,
 * not about the tier rule, and picking a block that legitimately drops nothing
 * would have made the loop untestable while looking like a bug.
 */
const DIRT_ID = BlockId(3)
const LEVER_ID = blockIdOf('lever') ?? BlockId(-1)
const DOOR_ID = blockIdOf('door') ?? BlockId(-1)
const AT: BlockPosition = blockPosition(3, 64, 7)
const ABOVE_AT: BlockPosition = blockPosition(3, 65, 7)
const BESIDE_AT: BlockPosition = blockPosition(4, 64, 7)
const IN_SIGHT: BlockPosition = blockPosition(0, 1, 0)

const lookingAtBlockWorld = (loaded: boolean, block: BlockId = DIRT_ID) =>
  makeInMemoryWorld<MobBehaviour>({
    spawnPose: {
      feetPosition: { x: 0.5, y: 0, z: 2.5 },
      yawRadians: 0,
      pitchRadians: 0,
    },
    world: {
      blocks: new Map([[cellKey(IN_SIGHT), block]]),
      loaded: loaded ? [chunkKey(chunkOf(IN_SIGHT))] : [],
    },
  })

/** A world with one block, in a loaded chunk. */
const oneBlockWorld = (block: BlockId = DIRT_ID) =>
  makeInMemoryWorld<MobBehaviour>({
    world: {
      blocks: new Map([[cellKey(AT), block]]),
      loaded: [chunkKey(chunkOf(AT))],
    },
  })

const twoBlockWorld = (block: BlockId) =>
  makeInMemoryWorld<MobBehaviour>({
    world: {
      blocks: new Map([
        [cellKey(AT), block],
        [cellKey(BESIDE_AT), block],
      ]),
      loaded: [chunkKey(chunkOf(AT))],
    },
  })

const doorWorld = () =>
  makeInMemoryWorld<MobBehaviour>({
    world: {
      blocks: new Map([
        [cellKey(AT), DOOR_ID],
        [cellKey(ABOVE_AT), DOOR_ID],
      ]),
      loaded: [chunkKey(chunkOf(AT))],
    },
  })

const runInteractions = (
  stages: ReadonlyArray<{ readonly id: string; readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, never> }>,
) => {
  const stage = stages.find((candidate) => candidate.id === GAMEPLAY_STAGE_IDS.interactions)
  if (stage === undefined) {
    throw new Error('the interactions stage is not registered')
  }
  return stage.run(DeltaTimeSecs(0.016))
}

describe('the break loop', () => {
  it.effect('uses a targeted lever instead of placing the held item', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true, LEVER_ID)
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestTargetedBlockUse(
        state,
        world.chunkStore,
        world.player,
        'lever-use-1',
        'redstone_dust',
      )

      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([
        { requestId: 'lever-use-1', positionKey: '0,1,0' },
      ])
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([])

      yield* runInteractions(stages as never)
      expect(yield* drainBlockUseResults(state)).toStrictEqual([
        {
          requestId: 'lever-use-1',
          success: true,
          outcome: { _tag: 'ToggleLever', position: IN_SIGHT },
        },
      ])
      expect(yield* world.chunkStore.getBlock(IN_SIGHT)).toStrictEqual({
        _tag: 'Block',
        block: LEVER_ID,
      })
    }),
  )

  it.effect('falls back to adjacent placement when the target is not a lever', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true)
      const state = yield* makeGameplayFrameState

      yield* requestTargetedBlockUse(
        state,
        world.chunkStore,
        world.player,
        'ordinary-use',
        'redstone_dust',
      )

      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([
        { positionKey: '0,1,1', heldItem: 'redstone_dust' },
      ])
    }),
  )

  it.effect('correlates a failed lever use when the target changes before the stage runs', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true, LEVER_ID)
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestTargetedBlockUse(
        state,
        world.chunkStore,
        world.player,
        'stale-lever-use',
        'sand',
      )
      yield* world.chunkStore.setBlock(IN_SIGHT, DIRT_ID)
      yield* runInteractions(stages as never)

      expect(yield* drainBlockUseResults(state)).toStrictEqual([
        {
          requestId: 'stale-lever-use',
          success: false,
          outcome: { _tag: 'NotLever', position: IN_SIGHT, existing: DIRT_ID },
        },
      ])
      expect(yield* drainBlockUseResults(state)).toStrictEqual([])
    }),
  )

  it.effect('targets the adjacent cell for placement and preserves the held item', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true)
      const state = yield* makeGameplayFrameState

      const target = yield* requestTargetedBlockPlacement(
        state,
        world.chunkStore,
        world.player,
        'sand',
      )

      expect(Option.getOrUndefined(target)?.position).toStrictEqual(IN_SIGHT)
      expect(Option.getOrUndefined(target)?.adjacentPosition).toStrictEqual({ x: 0, y: 1, z: 1 })
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([
        { positionKey: '0,1,1', heldItem: 'sand' },
      ])
    }),
  )

  it.effect('targets the first block under the crosshair and breaks it through the inbox', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(true)
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      const target = yield* requestTargetedBlockBreak(state, world.chunkStore, world.player)
      expect(Option.getOrUndefined(target)?.position).toStrictEqual(IN_SIGHT)

      yield* runInteractions(stages as never)
      expect(yield* world.chunkStore.getBlock(IN_SIGHT)).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('does not target stored block data from an unloaded chunk', () =>
    Effect.gen(function* () {
      const world = yield* lookingAtBlockWorld(false)
      const state = yield* makeGameplayFrameState

      const target = yield* requestTargetedBlockBreak(state, world.chunkStore, world.player)

      expect(Option.isNone(target)).toBe(true)
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
    }),
  )

  it.effect('a requested break removes the block from the store', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      expect((yield* world.chunkStore.getBlock(AT))._tag).toBe('Block')

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      const after = yield* world.chunkStore.getBlock(AT)
      expect(after).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('ignores a break request whose queue slot no longer holds its position', () =>
    Effect.gen(function* () {
      // The `publicQueueIndex` snapshot lets `requestBlockBreak`'s two Refs
      // (`state.pendingBreaks` and the queue's own `requests`) drift apart if
      // something else writes `pendingBreaks` directly (a restore, a test, a
      // future caller outside the queue's mutex) between the request and the
      // drain. Every other break test in this file goes through
      // `requestBlockBreak` alone, so `drainedBreaks[index] ===
      // request.positionKey` had only ever been true.
      const world = yield* oneBlockWorld()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      // Simulate the drift: the public inbox now names a different cell at
      // slot 0 than the one the request snapshot recorded.
      yield* Ref.set(state.pendingBreaks, [positionKey('99,64,99')])

      yield* runInteractions(stages as never)

      // The stale request was dropped rather than breaking the wrong (or any)
      // cell: the original block survives untouched.
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: DIRT_ID })
    }),
  )

  it.effect('removes the upper half when a door lower half is broken', () =>
    Effect.gen(function* () {
      const world = yield* doorWorld()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: 0 })
      expect(yield* world.chunkStore.getBlock(ABOVE_AT)).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('does not record a disturbance when the door-above write reports no change', () =>
    Effect.gen(function* () {
      // The test above always sees the upper-half write succeed as `Written`.
      // `doorUpperBreakCell` reads the upper cell moments earlier in the same
      // fiber, so nothing in THIS repository can make its answer disagree
      // with the write that follows — but a real store is not required to
      // agree with itself between two calls (another system, or the world
      // generator's own async boundary, could have already cleared that
      // cell). Intercepting the write is the same technique
      // `test/stage-registration.test.ts`'s "a blocked horizontal PlaceFluid
      // write..." test uses for the same reason.
      const world = yield* doorWorld()
      const state = yield* makeGameplayFrameState
      const interceptedStore = {
        ...world.chunkStore,
        setBlock: (position: BlockPosition, block: BlockId) =>
          cellKey(position) === cellKey(ABOVE_AT) && block === 0
            ? Effect.succeed({ _tag: 'Unchanged' as const, previous: BlockId(0) })
            : world.chunkStore.setBlock(position, block),
      }
      const stages = gameplayStages(state, interceptedStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      // The lower half still broke; the upper-half write was intercepted as
      // `Unchanged`, so no disturbance was queued for it and nothing crashed.
      expect(yield* world.chunkStore.getBlock(AT)).toStrictEqual({ _tag: 'Block', block: 0 })
    }),
  )

  it.effect('keeps the wooden tool context captured when the break was requested', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(blockIdOf('stone'))
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT, { heldTier: 'wooden' })
      yield* Ref.set(state.heldTool, NO_TOOL)
      yield* runInteractions(stages as never)

      expect(yield* world.inventory.countOf('cobblestone')).toBe(1)
    }),
  )

  it.effect('copies the tool context when the break was requested', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(blockIdOf('stone'))
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)
      const lootContext: { heldTier: 'wooden' | 'none' } = { heldTier: 'wooden' }

      yield* requestBlockBreak(state, AT, lootContext)
      lootContext.heldTier = 'none'
      yield* runInteractions(stages as never)

      expect(yield* world.inventory.countOf('cobblestone')).toBe(1)
    }),
  )

  it.effect('keeps the bare-hand context captured when the break was requested', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(blockIdOf('stone'))
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT, NO_TOOL)
      yield* Ref.set(state.heldTool, { heldTier: 'wooden' })
      yield* runInteractions(stages as never)

      expect(yield* world.inventory.countOf('cobblestone')).toBe(0)
    }),
  )

  it.effect('does not let a legacy break steal a later wooden snapshot at the same position', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(blockIdOf('stone'))
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* Ref.update(state.pendingBreaks, (pending) => [...pending, positionKey('3,64,7')])
      yield* requestBlockBreak(state, AT, { heldTier: 'wooden' })
      yield* Ref.set(state.heldTool, NO_TOOL)
      yield* runInteractions(stages as never)

      expect(yield* world.inventory.countOf('cobblestone')).toBe(0)
    }),
  )

  it.effect('does not let a legacy break lose its wooden fallback to a later bare-hand snapshot', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(blockIdOf('stone'))
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* Ref.update(state.pendingBreaks, (pending) => [...pending, positionKey('3,64,7')])
      yield* requestBlockBreak(state, AT, NO_TOOL)
      yield* Ref.set(state.heldTool, { heldTier: 'wooden' })
      yield* runInteractions(stages as never)

      expect(yield* world.inventory.countOf('cobblestone')).toBe(1)
    }),
  )

  it.effect('keeps request and snapshot paired across concurrent helper fibers', () =>
    Effect.gen(function* () {
      const world = yield* twoBlockWorld(blockIdOf('stone') ?? BlockId(-1))
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* Effect.all(
        [
          requestBlockBreak(state, AT, { heldTier: 'wooden' }),
          requestBlockBreak(state, BESIDE_AT, NO_TOOL),
        ],
        { concurrency: 'unbounded' },
      )
      yield* Ref.set(state.heldTool, NO_TOOL)
      yield* runInteractions(stages as never)

      expect(yield* world.inventory.countOf('cobblestone')).toBe(1)
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
    }),
  )

  it.effect('keeps the legacy two-argument request as a raw position key', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      yield* requestBlockBreak(state, AT)

      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual(['3,64,7'])
    }),
  )

  it.effect('and the mined block lands in the inventory', () =>
    Effect.gen(function* () {
      // THE HALF A STORE ASSERTION MISSES. A break that removed the block and
      // dropped nothing looks identical in the world and costs the player the
      // item — which is the whole reason `breakBlock` returns what it yielded
      // rather than a boolean.
      const world = yield* oneBlockWorld()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      const inventory = yield* world.inventory.snapshot
      const carried = inventory.slots.filter((slot) => slot !== undefined)
      expect(carried.length).toBeGreaterThan(0)
    }),
  )

  it.effect('breaking redstone wire drops redstone dust', () =>
    Effect.gen(function* () {
      const world = yield* oneBlockWorld(blockIdOf('redstone_wire') ?? BlockId(-1))
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      expect(yield* world.inventory.countOf('redstone_dust')).toBe(1)
    }),
  )

  it.effect('the inbox is DRAINED, so one click breaks one block', () =>
    Effect.gen(function* () {
      // `getAndSet` rather than get-then-set, per DN-GP-10. A stage that read
      // without clearing would re-break the same cell every frame — invisible
      // once the cell is air, and a duplicate drop every frame until it is.
      const world = yield* oneBlockWorld()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)
      const afterFirst = yield* world.inventory.snapshot

      yield* runInteractions(stages as never)
      const afterSecond = yield* world.inventory.snapshot

      expect(afterSecond).toStrictEqual(afterFirst)
    }),
  )

  it.effect('breaking a cell that is already air yields nothing', () =>
    Effect.gen(function* () {
      // `NothingThere`. A player swinging at empty space is legal, and treating
      // it as a break would drop air into the inventory and re-mesh the chunk
      // every frame the button is held.
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: [chunkKey(chunkOf(AT))] },
      })
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      const inventory = yield* world.inventory.snapshot
      expect(inventory.slots.every((slot) => slot === undefined)).toBe(true)
    }),
  )

  it.effect('breaking in an UNLOADED chunk changes nothing', () =>
    Effect.gen(function* () {
      // `ChunkNotLoaded` is not air. A store that answered air here would let a
      // player mine a chunk nobody has loaded, and the chunk that eventually
      // loads would overwrite the hole.
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: [] },
      })
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      expect((yield* world.chunkStore.getBlock(AT))._tag).toBe('ChunkNotLoaded')
    }),
  )

  it.effect('the break dirties the chunk, so a renderer is told to re-mesh', () =>
    Effect.gen(function* () {
      // The half that makes it VISIBLE. A break that changed the store and
      // notified nobody leaves the block on screen until something else happens
      // to dirty that chunk — which reads as "mining sometimes does not work".
      const world = yield* oneBlockWorld()
      const subscription = yield* world.chunkStore.subscribeDirty
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, world.chunkStore, world.entities, world.inventory, world.player, world.time)

      yield* requestBlockBreak(state, AT)
      yield* runInteractions(stages as never)

      expect((yield* subscription.drain).changed).toStrictEqual([chunkOf(AT)])
    }),
  )
})
