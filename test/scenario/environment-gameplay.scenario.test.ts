import { describe, expect, it } from '@effect/vitest'
import {
  CHUNK_SIZE_XZ,
  DeltaTimeSecs,
  InterpolationFraction,
  PortalHeight,
  PortalWidth,
  StackCount,
  blockIdOf,
  blockPositionKeyOf,
  type BlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import {
  itemStack as makeItemStack,
  makeTimeService,
  PlayerStorageSnapshotSchema,
  type Slot,
} from '@nerima-games/mc-sim'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import { generatePortalLayout, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { FIRE_TICK_INTERVAL_SECS } from '../../src/domain/fire-lifecycle'
import { PASSIVE_MOB_KINDS } from '../../src/domain/mob/mob-ecosystem'
import { HOSTILE_KINDS } from '../../src/domain/entities/mob-frame'
import { chunkCoordsAround } from '../../src/domain/chunk-window'
import { PORTAL_WINDOW_RADIUS } from '../../src/domain/interactions/ignite-portal'
import {
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestBlockBreak,
  requestItemUse,
  restoreFireLifecycle,
  snapshotFireLifecycle,
} from '../../src/stages/registration'
import { HOSTILE_SPAWN_INTERVAL_TICKS } from '../../src/stages/registration-core'
import { GAMEPLAY_STAGE_IDS } from '../../src/stages/stage-ids'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../../src/stages/gameplay-owner-registrations'
import { SAND, STONE, WATER, world } from '../support/chunk-store-double'
import { blockPosition } from '../support/coordinate-fixtures'
import { runFrame, runFrames } from '../support/frame-runner'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from '../support/inventory-service-double'
import { makePlayerServiceDouble } from '../support/player-service-double'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from '../support/transactional-stage-doubles'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { WEATHER_DURATION_RANGES, type WeatherState } from '../../src/domain/weather'

type StoreOverride = (store: ChunkStoreApi) => ChunkStoreApi

const stack = (item: Parameters<typeof makeItemStack>[0]) =>
  Result.getOrThrow(makeItemStack(item, StackCount(1)))

const oneItem = (item: Parameters<typeof makeItemStack>[0]): ReadonlyArray<Slot> =>
  emptySlots().map((_, index) => (index === 0 ? stack(item) : undefined))

const environmentSlice = (
  blocks: ReadonlyMap<string, BlockId>,
  loaded: ReadonlyArray<string> = ['0,0'],
  inventorySlots: ReadonlyArray<Slot> = emptySlots(),
  overrideStore?: StoreOverride,
) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(blocks, loaded)
    const storeApi = overrideStore?.(store.api) ?? store.api
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(inventorySlots)
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const commit = yield* makeGameplayCommitServices(storeApi, inventory.api, {
      playerPose: yield* player.api.pose,
      dimension: yield* player.api.dimension,
    })
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    const stages = gameplayStages(
      state,
      storeApi,
      roster.api,
      inventory.api,
      player.api,
      time,
      undefined,
      undefined,
      {},
      commit,
    )
    return { store, state, time, commit, stages }
  })

const spawnSearchWorld = (() => {
  const cells: Array<readonly [BlockPosition, BlockId]> = []
  const loaded = new Set<string>()
  for (let x = -48; x <= 47; x += 1) {
    for (let z = -48; z <= 47; z += 1) {
      cells.push([blockPosition(x, 63, z), STONE])
    }
  }
  for (let chunkX = -3; chunkX <= 2; chunkX += 1) {
    for (let chunkZ = -3; chunkZ <= 2; chunkZ += 1) {
      loaded.add(`${String(chunkX)},${String(chunkZ)}`)
    }
  }
  return { blocks: world(cells), loaded: [...loaded] }
})()

const sameBlock = (left: BlockPosition, right: BlockPosition): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

describe('environment gameplay scenarios through registered stages', () => {
  it.effect('flows water downward through the fluid stage before it spreads sideways', () =>
    Effect.gen(function* () {
      const origin = blockPosition(0, 64, 0)
      const { state, store, stages } = yield* environmentSlice(
        world([[origin, WATER]]),
      )
      const fluidStages = stages.filter((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)

      yield* Ref.set(state.fluidFrontier, [{ key: blockPositionKeyOf(origin), kind: 'water' }])
      yield* runFrame(fluidStages)

      expect(yield* store.blockAt(blockPosition(0, 63, 0))).toBe(WATER)
      expect(yield* store.blockAt(blockPosition(-1, 64, 0))).toBeUndefined()
      expect(yield* store.blockAt(blockPosition(1, 64, 0))).toBeUndefined()
      expect(yield* Ref.get(state.fluidFrontier)).toContainEqual({
        key: blockPositionKeyOf(blockPosition(0, 63, 0)),
        kind: 'water',
        level: 0,
        source: false,
        parent: blockPositionKeyOf(origin),
        falling: true,
      })
    }),
  )

  it.effect('breaking support moves sand through the entities stage and lands it above the floor', () =>
    Effect.gen(function* () {
      const floor = blockPosition(2, 62, 3)
      const support = blockPosition(2, 63, 3)
      const sand = blockPosition(2, 64, 3)
      const { state, store, stages } = yield* environmentSlice(
        world([
          [floor, STONE],
          [support, STONE],
          [sand, SAND],
        ]),
        ['0,0'],
        oneItem('wooden_pickaxe'),
      )

      yield* requestBlockBreak(
        state,
        support,
        { heldTier: 'wooden' },
        { dimension: 'overworld', toolLocation: { _tag: 'Inventory', slotIndex: 0 } },
      )
      yield* runFrames(stages, 3)

      expect(yield* store.blockAt(support)).toBe(SAND)
      expect(yield* store.blockAt(sand)).toBeUndefined()
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(0)
    }),
  )

  it.effect('uses the TimeService day phase to choose hostile night spawns and passive daylight spawns', () =>
    Effect.gen(function* () {
      const spawnAt = (fraction: number) =>
        Effect.gen(function* () {
          const { state, time, stages, commit } = yield* environmentSlice(
            spawnSearchWorld.blocks,
            spawnSearchWorld.loaded,
          )
          yield* time.setTimeOfDay(InterpolationFraction(fraction))
          yield* Ref.set(state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS)
          yield* runFrame(stages, DeltaTimeSecs(0))
          const snapshot = yield* commit.coordinator.snapshot(
            GAMEPLAY_ENTITIES_OWNER_ID,
            GameplayEntityRosterSchema,
          )
          return Schema.decodeUnknownSync(GameplayEntityRosterSchema)(snapshot.state).entities
        })

      const night = yield* spawnAt(0.9)
      const daylight = yield* spawnAt(0.5)

      expect(night.length).toBeGreaterThan(0)
      expect(night.every(({ kind }) => HOSTILE_KINDS.includes(kind))).toBe(true)
      expect(daylight.length).toBeGreaterThan(0)
      expect(daylight.every(({ kind }) => PASSIVE_MOB_KINDS.includes(kind))).toBe(true)
    }),
  )

  it.effect('lights fire from an item, spreads to fuel, then rain extinguishes exposed flames', () =>
    Effect.gen(function* () {
      const origin = blockPosition(0, 64, 0)
      const fuel = blockPosition(1, 64, 0)
      const fire = Option.getOrThrow(blockIdOf('fire'))
      const planks = Option.getOrThrow(blockIdOf('oak_planks'))
      const exposed = (position: BlockPosition): boolean =>
        sameBlock(position, origin) || sameBlock(position, fuel)
      const exposeFireToSky: StoreOverride = (store) => ({
        ...store,
        getLight: (position) =>
          exposed(position)
            ? Effect.succeed({ _tag: 'Light', sky: 15, block: 0 })
            : store.getLight(position),
      })
      const residentChunks = chunkCoordsAround(origin, PORTAL_WINDOW_RADIUS).map(
        ({ cx, cz }) => `${String(cx)},${String(cz)}`,
      )
      const { state, store, stages } = yield* environmentSlice(
        world([[fuel, planks]]),
        residentChunks,
        oneItem('fire_charge'),
        exposeFireToSky,
      )

      yield* requestItemUse(state, 'ignite-environment', origin, 'fire_charge')
      yield* runFrame(stages)
      const ignitionResults = yield* drainItemUseResults(state)
      expect(ignitionResults).toMatchObject([
        { requestId: 'ignite-environment', success: true, outcome: { _tag: 'Fire' } },
      ])
      const started = yield* snapshotFireLifecycle(state)
      expect(started.fires).toContainEqual({ position: origin, ageTicks: 0 })
      yield* restoreFireLifecycle(state, { ...started, seed: 1 })
      yield* runFrame(stages, DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS))

      expect(yield* store.blockAt(fuel)).toBe(fire)
      expect((yield* snapshotFireLifecycle(state)).fires).toContainEqual({
        position: fuel,
        ageTicks: 0,
      })

      yield* Ref.set(state.weather, { weather: 'rain', remainingSecs: 600 } satisfies WeatherState)
      yield* runFrame(stages, DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS))

      expect(yield* store.blockAt(origin)).toBeUndefined()
      expect(yield* store.blockAt(fuel)).toBeUndefined()
    }),
  )

  it.effect('advances an expired weather state into another legal stretch without changing the host inbox', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* environmentSlice(world([]))
      const initial: WeatherState = { weather: 'clear', remainingSecs: 1 }
      yield* Ref.set(state.weather, initial)
      yield* runFrame(
        stages.filter((stage) => stage.id === GAMEPLAY_STAGE_IDS.timeWeather),
        DeltaTimeSecs(1),
      )

      const advanced = yield* Ref.get(state.weatherAdvanced)
      expect(advanced).toBeDefined()
      if (advanced === undefined) throw new Error('the time-weather stage produced no next state')
      expect(advanced.weather).not.toBe(initial.weather)
      const range = WEATHER_DURATION_RANGES[advanced.weather]
      expect(advanced.remainingSecs).toBeGreaterThanOrEqual(range.min)
      expect(advanced.remainingSecs).toBeLessThanOrEqual(range.max)
      expect(yield* Ref.get(state.weather)).toStrictEqual(initial)
    }),
  )

  it.effect('rebuilds the portal chunk window when ignition moves into and back from an unloaded chunk', () =>
    Effect.gen(function* () {
      const first = blockPosition(0, 64, 0)
      // This four-wide portal frame reaches from chunk 1 into chunk 2.
      const acrossBoundary = blockPosition(28, 64, 0)
      const backInside = blockPosition(0, 64, 1)
      const obsidian = Option.getOrThrow(blockIdOf('obsidian'))
      const frame = generatePortalLayout(
        acrossBoundary,
        'x',
        PortalWidth(4),
        PortalHeight(3),
      ).frame
      const visibleFrameBlock = frame.find(({ x }) => Math.floor(x / CHUNK_SIZE_XZ) === 1)
      const unreadableFrameBlock = frame.find(({ x }) => Math.floor(x / CHUNK_SIZE_XZ) === 2)
      if (visibleFrameBlock === undefined) throw new Error('the portal frame did not cross chunk 1')
      if (unreadableFrameBlock === undefined) throw new Error('the portal frame did not enter chunk 2')
      const loadedChunks = chunkCoordsAround(first, PORTAL_WINDOW_RADIUS).map(
        ({ cx, cz }) => `${String(cx)},${String(cz)}`,
      )
      const loadedSet = new Set(loadedChunks)
      const unreadableFrameChunk = [
        Math.floor(unreadableFrameBlock.x / CHUNK_SIZE_XZ),
        Math.floor(unreadableFrameBlock.z / CHUNK_SIZE_XZ),
      ].join(',')
      expect(loadedSet.has(unreadableFrameChunk)).toBe(false)
      const crossesIntoUnloadedChunk = chunkCoordsAround(acrossBoundary, PORTAL_WINDOW_RADIUS).some(
        ({ cx, cz }) => !loadedSet.has(`${String(cx)},${String(cz)}`),
      )
      expect(crossesIntoUnloadedChunk).toBe(true)

      const { state, store, commit, stages } = yield* environmentSlice(
        world(frame.map((position) => [position, obsidian] as const)),
        loadedChunks,
        oneItem('flint_and_steel'),
      )
      const interactions = stages.filter((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)

      yield* requestItemUse(state, 'window-before-boundary', first, 'flint_and_steel')
      yield* runFrame(interactions)
      expect(yield* drainItemUseResults(state)).toMatchObject([
        { requestId: 'window-before-boundary', success: true, outcome: { _tag: 'Fire' } },
      ])

      const ownerBeforeUnreadableWindow = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      yield* requestItemUse(state, 'window-enters-unloaded-chunk', acrossBoundary, 'flint_and_steel')
      yield* runFrame(interactions)
      expect(yield* drainItemUseResults(state)).toMatchObject([
        {
          requestId: 'window-enters-unloaded-chunk',
          success: false,
          outcome: { _tag: 'Portal', outcome: { _tag: 'ChunkNotLoaded' } },
        },
      ])
      const ownerAfterUnreadableWindow = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect(ownerAfterUnreadableWindow.state).toStrictEqual(ownerBeforeUnreadableWindow.state)
      expect(ownerAfterUnreadableWindow.revision).toBe(ownerBeforeUnreadableWindow.revision)

      yield* requestItemUse(state, 'window-exits-unloaded-chunk', backInside, 'flint_and_steel')
      yield* runFrame(interactions)
      expect(yield* drainItemUseResults(state)).toMatchObject([
        { requestId: 'window-exits-unloaded-chunk', success: true, outcome: { _tag: 'Fire' } },
      ])
      expect((yield* store.calls).peeks).toBeGreaterThan(loadedChunks.length)
      const fire = Option.getOrThrow(blockIdOf('fire'))
      expect(yield* store.blockAt(first)).toBe(fire)
      expect(yield* store.blockAt(visibleFrameBlock)).toBe(obsidian)
      expect(yield* store.blockAt(backInside)).toBe(fire)
    }),
  )

  it.effect('reports an unloaded chunk during portal ignition without consuming flint and steel', () =>
    Effect.gen(function* () {
      const origin = blockPosition(14, 64, 20)
      const obsidian = Option.getOrThrow(blockIdOf('obsidian'))
      const frame = generatePortalLayout(origin, 'x', PortalWidth(4), PortalHeight(3)).frame
      const visibleFrameBlock = frame.find(({ x, z }) =>
        Math.floor(x / 16) === 0 && Math.floor(z / 16) === 1,
      )
      if (visibleFrameBlock === undefined) throw new Error('the portal frame did not intersect the loaded chunk')
      const { state, store, commit, stages } = yield* environmentSlice(
        world(frame.map((position) => [position, obsidian] as const)),
        ['0,1'],
        oneItem('flint_and_steel'),
      )
      const ownerBefore = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      yield* requestItemUse(state, 'portal-at-window-edge', origin, 'flint_and_steel')
      yield* runFrame(stages.filter((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions))

      const ownerAfter = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      expect((yield* store.calls).peeks).toBeGreaterThan(0)
      expect(yield* store.blockAt(visibleFrameBlock)).toBe(obsidian)
      expect(ownerAfter.state).toStrictEqual(ownerBefore.state)
      expect(ownerAfter.revision).toBe(ownerBefore.revision)
      expect(yield* Ref.get(state.usedItems)).toStrictEqual([])
      expect(yield* drainItemUseResults(state)).toMatchObject([
        {
          requestId: 'portal-at-window-edge',
          heldItem: 'flint_and_steel',
          success: false,
          outcome: { _tag: 'Portal', outcome: { _tag: 'ChunkNotLoaded' } },
        },
      ])
    }),
  )
})
