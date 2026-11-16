import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Ref, Result, Schema, Stream } from 'effect'
import { DeltaTimeSecs, StackCount, blockIdOf, enchantmentsComponent, itemComponents, BlockId, WorldRevisionSchema, textComponent, type BlockPosition } from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  EntityId,
  HotbarService,
  InventoryService,
  LegacyItemStackSchema,
  PlayerStorageSnapshotSchema,
  TimeService,
  WorldCommitCoordinator,
  itemStack,
  makeHotbarService,
  makeTimeService,
  type ItemStack,
  type PlayerPose,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { ChunkStore, type Dimension } from '@nerima-games/mc-worldgen'
import {
  drainDroppedItemPickupExecutions,
  makeGameplayFrameStateForOwner,
  requestDropSelectedItem,
  requestDroppedItemPickup,
} from '../src/index.js'
import { entityManagerTag } from '../src/stages/registration-core.js'
import { makeGameplayStagesWithState } from '../src/stages/gameplay-stage-composition.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import {
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations.js'
import {
  DroppedItemOwnerSnapshotSchema,
  type DroppedItemOwnerSnapshot,
} from '../src/domain/entities/dropped-item.js'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { world } from './support/chunk-store-double.js'
import { makeEntityManagerDouble } from './support/entity-manager-double.js'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double.js'
import { injectRawBlockId, makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { runFrame } from './support/frame-runner.js'
import { blockPosition, position } from './support/coordinate-fixtures.js'

const pose: PlayerPose = {
  feetPosition: position(8, 64, 8),
  yawRadians: 0,
  pitchRadians: 0,
}

const thrownRecord = (
  id: string,
  at: ReturnType<typeof position>,
  velocity: Readonly<{ x: number; y: number; z: number }>,
  dimension: Dimension = 'overworld',
): DroppedItemOwnerSnapshot['items'][number] => ({
  id: EntityId(id), feetPosition: at, dimension, velocity,
  stack: Result.getOrThrow(itemStack('stone', 1)),
  behaviour: { _tag: 'DroppedItem', item: 'stone', count: StackCount(1), durability: null },
})

const makeSlice = (options: Readonly<{
  pose?: PlayerPose
  held?: ItemStack
  drops?: DroppedItemOwnerSnapshot
  blocks?: ReturnType<typeof world>
  loaded?: ReadonlyArray<string>
  slots?: ReturnType<typeof emptySlots>
  coordinator?: (coordinator: WorldCommitCoordinatorApi) => WorldCommitCoordinatorApi
}> = {}) => Effect.gen(function* () {
  const store = yield* makeTransactionalChunkStoreDouble(
    options.blocks === undefined ? world([]) : options.blocks,
    options.loaded === undefined ? ['0,0'] : options.loaded,
  )
  const slots = [...emptySlots()]
  slots[27] = options.held === undefined ? Result.getOrThrow(itemStack('stone', 3)) : options.held
  const inventory = yield* makeInventoryDouble(options.slots === undefined ? slots : options.slots)
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const time = yield* makeTimeService()
  const hotbar = yield* makeHotbarService().pipe(Effect.provideService(InventoryService, inventory.api))
  const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
    playerPose: options.pose === undefined ? pose : options.pose,
    ...(options.drops === undefined ? {} : { droppedItems: options.drops }),
  })
  const coordinator = options.coordinator === undefined ? commit.coordinator : options.coordinator(commit.coordinator)
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const stages = yield* makeGameplayStagesWithState(state).pipe(
    Effect.provideService(ChunkStore, store.api),
    Effect.provideService(entityManagerTag<MobBehaviour>(), roster.api),
    Effect.provideService(TimeService, time),
    Effect.provideService(WorldCommitCoordinator, coordinator),
    Effect.provideService(DomainEventBus, { publish: () => Effect.void, events: Stream.empty }),
    Effect.provideService(HotbarService, hotbar),
  )
  const interactions = stages.filter((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
  const entities = stages.filter((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
  expect(interactions).toHaveLength(1)
  expect(entities).toHaveLength(1)
  return {
    state,
    store: store.api,
    storeCalls: store.calls,
    drop: () => Effect.andThen(
      requestDropSelectedItem(state, 'throw', 'one'),
      runFrame(interactions),
    ),
    step: (seconds = 0.05) => runFrame(entities, DeltaTimeSecs(seconds)),
    snapshot: () => commit.coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
    storage: () => commit.coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
  }
})

describe('persisted thrown-item owner validation', () => {
  const record = {
    id: EntityId('persisted-throw'),
    feetPosition: position(8, 65, 8),
    dimension: 'overworld',
    velocity: { x: 1, y: 2, z: 3 },
    stack: Schema.encodeSync(LegacyItemStackSchema)(Result.getOrThrow(itemStack('stone', 1))),
    behaviour: { _tag: 'DroppedItem', item: 'stone', count: StackCount(1), durability: null },
  }
  const { dimension: _dimension, ...withoutDimension } = record
  const cases: ReadonlyArray<Readonly<{ name: string; record: unknown }>> = [
    { name: 'velocity without dimension', record: withoutDimension },
    {
      name: 'stack item differs from behaviour',
      record: {
        ...record,
        stack: Schema.encodeSync(LegacyItemStackSchema)(Result.getOrThrow(itemStack('dirt', 1))),
      },
    },
    {
      name: 'stack count differs from behaviour',
      record: {
        ...record,
        stack: Schema.encodeSync(LegacyItemStackSchema)(Result.getOrThrow(itemStack('stone', 2))),
      },
    },
    { name: 'explicit undefined velocity', record: { ...record, velocity: undefined } },
    { name: 'explicit undefined dimension', record: { ...record, dimension: undefined } },
    { name: 'explicit undefined stack', record: { ...record, stack: undefined } },
  ]
  for (const scenario of cases) {
    it(`rejects ${scenario.name} without substituting defaults`, () => {
      expect(Result.isSuccess(Schema.decodeUnknownResult(DroppedItemOwnerSnapshotSchema)({
        items: [record],
      }))).toBe(true)
      const decoded = Schema.decodeUnknownResult(DroppedItemOwnerSnapshotSchema)({ items: [scenario.record] })
      expect(Result.isFailure(decoded)).toBe(true)
      if (Result.isSuccess(decoded)) throw new Error('malformed persisted throw was accepted')
      expect(decoded.failure._tag).toBe('SchemaError')
    })
  }
})

describe('held-item throwing through entity frame processing', () => {
  const overBudgetSegments = [
    { name: 'huge X velocity', at: position(8, 65, 8), velocity: { x: 1e6, y: 0, z: 0 } },
    { name: 'huge Y velocity', at: position(8, 65, 8), velocity: { x: 0, y: 1e6, z: 0 } },
    { name: 'huge Z velocity', at: position(8, 65, 8), velocity: { x: 0, y: 0, z: 1e6 } },
    { name: 'unsafe starting cell', at: position(1e16, 65, 8), velocity: { x: 0, y: 0, z: 0 } },
    { name: 'unsafe ending cell', at: position(Number.MAX_SAFE_INTEGER - 1, 65, 8), velocity: { x: 64, y: 0, z: 0 } },
    { name: 'seventeen-cell span', at: position(8, 65, 8), velocity: { x: 340, y: 0, z: 0 } },
  ]
  for (const scenario of overBudgetSegments) {
    it.effect(`rejects ${scenario.name} before querying chunks or changing the stored stack`, () =>
      Effect.gen(function* () {
        const drop = thrownRecord('over-budget-motion', scenario.at, scenario.velocity)
        const slice = yield* makeSlice({ drops: { items: [drop] } })
        yield* Ref.set(slice.state.passiveInitialSpawnPending, false)
        const ownerBefore = yield* slice.snapshot()
        const worldBefore = yield* slice.storeCalls
        yield* slice.step()
        const ownerAfter = yield* slice.snapshot()
        expect(ownerAfter.state).toEqual(ownerBefore.state)
        expect(ownerAfter.revision).toBe(ownerBefore.revision)
        expect(yield* slice.storeCalls).toEqual(worldBefore)
        expect(yield* Ref.get(slice.state.operationFailures)).toContainEqual(expect.objectContaining({
          subject: 'DroppedItem', operation: 'CandidateBuild',
          error: { _tag: 'DroppedItemMotionFailure', reason: 'SegmentBudgetExceeded' },
        }))
      }),
    )
  }

  it.effect('allows an exact sixteen-cell segment and advances through its loaded chunks', () =>
    Effect.gen(function* () {
      const drop = thrownRecord('maximum-budget-motion', position(8, 65, 8), { x: 320, y: 0, z: 0 })
      const slice = yield* makeSlice({ drops: { items: [drop] }, loaded: ['0,0', '1,0'] })
      yield* Ref.set(slice.state.passiveInitialSpawnPending, false)
      const before = yield* slice.storeCalls
      yield* slice.step()
      expect((yield* slice.snapshot()).state.items[0]?.feetPosition.x).toBeCloseTo(23.68)
      expect((yield* slice.storeCalls).peeks).toBeGreaterThan(before.peeks)
      expect(yield* Ref.get(slice.state.operationFailures)).toEqual([])
    }),
  )

  it.effect('retains a component-bearing root stack after a partial pickup into a nearly full inventory', () =>
    Effect.gen(function* () {
      const customName = Result.getOrThrow(textComponent({ text: 'Named stone' }))
      const components = Result.getOrThrow(itemComponents('stone', { customName }))
      const stored = Result.getOrThrow(itemStack('stone', 63, { components }))
      const dropped = Result.getOrThrow(itemStack('stone', 64, { components }))
      const slots = emptySlots().map(() => Result.getOrThrow(itemStack('dirt', 64)))
      slots[0] = stored
      const drops: DroppedItemOwnerSnapshot = { items: [{
        id: EntityId('partial-component-stack'),
        feetPosition: position(8, 65, 8),
        dimension: 'overworld',
        stack: dropped,
        behaviour: { _tag: 'DroppedItem', item: 'stone', count: StackCount(64), durability: null },
      }] }
      const slice = yield* makeSlice({ slots, drops })
      yield* requestDroppedItemPickup(slice.state, {
        actor: EntityId('partial-picker'), tick: 1, currentFrame: 40,
        position: position(8, 65, 8), radius: 2,
      })
      yield* slice.step(0)
      expect((yield* slice.storage()).state.inventory.slots[0])
        .toEqual(Result.getOrThrow(itemStack('stone', 64, { components })))
      const remainder = (yield* slice.snapshot()).state.items[0]
      expect(remainder?.behaviour.count).toBe(63)
      expect(remainder?.stack).toEqual(Result.getOrThrow(itemStack('stone', 63, { components })))
      expect(yield* drainDroppedItemPickupExecutions(slice.state)).toMatchObject([{
        outcome: { _tag: 'Completed', result: [{ accepted: 1 }] },
      }])
    }),
  )

  it.effect('keeps legacy and other-dimension records unchanged while advancing an active thrown item', () =>
    Effect.gen(function* () {
      const legacy: DroppedItemOwnerSnapshot['items'][number] = {
        id: EntityId('mixed-legacy'),
        feetPosition: position(8, 65, 8),
        behaviour: { _tag: 'DroppedItem', item: 'stone', count: StackCount(1), durability: null },
      }
      const remote = thrownRecord('mixed-nether', position(8, 65, 8), { x: 1, y: 2, z: 3 }, 'nether')
      const active = thrownRecord('mixed-active', position(8, 65, 8), { x: 1, y: 2, z: 3 })
      const slice = yield* makeSlice({ drops: { items: [legacy, remote, active] } })
      yield* slice.step()
      const after = (yield* slice.snapshot()).state.items
      expect(after[0]).toEqual(legacy)
      expect(after[1]).toEqual(remote)
      expect(after[2]?.feetPosition).not.toEqual(active.feetPosition)
      expect(after[2]?.behaviour.count).toBe(1)
    }),
  )

  it.effect('does not commit a motion update when every thrown item belongs to another dimension', () =>
    Effect.gen(function* () {
      const remote = thrownRecord('only-nether', position(8, 65, 8), { x: 1, y: 2, z: 3 }, 'nether')
      const slice = yield* makeSlice({ drops: { items: [remote] } })
      const before = yield* slice.snapshot()
      yield* slice.step()
      const after = yield* slice.snapshot()
      expect(after.state).toEqual(before.state)
      expect(after.revision).toBe(before.revision)
      expect(yield* Ref.get(slice.state.operationFailures)).toEqual([])
    }),
  )

  it.effect('rejects inconsistent player and dropped-owner revisions without changing a thrown item', () =>
    Effect.gen(function* () {
      const drop = thrownRecord('stale-motion-owner', position(8, 65, 8), { x: 1, y: 2, z: 3 })
      const slice = yield* makeSlice({
        drops: { items: [drop] },
        coordinator: (coordinator) => ({
          ...coordinator,
          snapshot: (ownerId, schema) => Effect.flatMap(coordinator.revision, (revision) =>
            Effect.map(coordinator.snapshot(ownerId, schema), (snapshot) =>
              ownerId === GAMEPLAY_DROPPED_ITEMS_OWNER_ID ? {
                ...snapshot,
                revision: Schema.decodeUnknownSync(WorldRevisionSchema)(revision + 1),
              } : snapshot)),

        }),
      })
      yield* slice.step()
      expect((yield* slice.snapshot()).state.items).toEqual([drop])
      expect(yield* Ref.get(slice.state.operationFailures)).toContainEqual(expect.objectContaining({
        subject: 'DroppedItem', operation: 'OwnerSnapshot',
        error: expect.objectContaining({ _tag: 'WorldRevisionConflict' }),
      }))
    }),
  )

  it.effect('pauses motion and reports a typed world-data fault for a corrupt block cell', () =>
    Effect.gen(function* () {
      const drop = thrownRecord('corrupt-cell-motion', position(8.5, 65.5, 8.5), { x: 1, y: 2, z: 3 })
      const slice = yield* makeSlice({ drops: { items: [drop] } })
      yield* injectRawBlockId(slice.store, blockPosition(8, 65, 8), BlockId(60_000))
      yield* slice.step()
      expect((yield* slice.snapshot()).state.items).toEqual([drop])
      expect((yield* Ref.get(slice.state.entityStageFaults)).pending).toContainEqual(expect.objectContaining({
        _tag: 'EntityWorldDataFault', source: 'DroppedItemMotion',
      }))
    }),
  )

  it.effect('pauses a thrown item when its swept path crosses an unloaded cell', () =>
    Effect.gen(function* () {
      const drop = thrownRecord('unloaded-motion', position(8, 65, 8), { x: 1, y: 2, z: 3 })
      const slice = yield* makeSlice({ drops: { items: [drop] }, loaded: [] })
      const before = yield* slice.snapshot()
      yield* slice.step()
      const after = yield* slice.snapshot()
      expect(after.state).toEqual(before.state)
      expect(after.revision).toBe(before.revision)
    }),
  )

  it.effect('reports a typed world-bounds motion failure without discarding the stored stack', () =>
    Effect.gen(function* () {
      const drop = thrownRecord('world-bounds-motion', position(8, 255.9, 8), { x: 0, y: 10, z: 0 })
      const slice = yield* makeSlice({ drops: { items: [drop] } })
      yield* slice.step()
      expect((yield* slice.snapshot()).state.items).toEqual([drop])
      expect(yield* Ref.get(slice.state.operationFailures)).toContainEqual(expect.objectContaining({
        subject: 'DroppedItem', operation: 'CandidateBuild',
        error: expect.objectContaining({ _tag: 'DroppedItemMotionFailure' }),
      }))
    }),
  )

  it.effect('reports an embedded initial contact without fabricating a face or losing the stack', () =>
    Effect.gen(function* () {
      const drop = thrownRecord('embedded-motion', position(8.5, 64.5, 8.5), { x: 6, y: 0, z: 0 })
      const slice = yield* makeSlice({
        drops: { items: [drop] },
        blocks: world([[blockPosition(8, 64, 8), Option.getOrThrow(blockIdOf('stone'))]]),
      })
      yield* slice.step()
      expect((yield* slice.snapshot()).state.items).toEqual([drop])
      expect(yield* Ref.get(slice.state.operationFailures)).toContainEqual(expect.objectContaining({
        subject: 'DroppedItem', operation: 'CandidateBuild',
        error: { _tag: 'DroppedItemMotionFailure', reason: 'InitialContactFaceUnavailable' },
      }))
    }),
  )

  it.effect('bounces off an X-facing wall while retaining the stack and tangential velocity', () =>
    Effect.gen(function* () {
      const drop = thrownRecord('x-wall-motion', position(8, 65.5, 8.5), { x: -6, y: 2, z: 1 })
      const slice = yield* makeSlice({
        drops: { items: [drop] },
        blocks: world([[blockPosition(7, 65, 8), Option.getOrThrow(blockIdOf('stone'))]]),
      })
      yield* slice.step()
      const after = (yield* slice.snapshot()).state.items[0]
      expect(after?.velocity?.x).toBeGreaterThan(0)
      expect(after?.velocity?.z).toBe(1)
      expect(after?.feetPosition.x).toBeGreaterThan(8)
      expect(after?.behaviour.count).toBe(1)
    }),
  )

  const directions: ReadonlyArray<Readonly<{
    name: string
    yaw: number
    pitch: number
    x: number
    z: number
  }>> = [
    { name: 'north', yaw: 0, pitch: 0, x: 0, z: -6 },
    { name: 'west', yaw: Math.PI / 2, pitch: 0, x: -6, z: 0 },
    { name: 'south', yaw: Math.PI, pitch: 0, x: 0, z: 6 },
    { name: 'upward', yaw: 0, pitch: Math.PI / 6, x: 0, z: -6 * Math.cos(Math.PI / 6) },
  ]
  for (const direction of directions) {
    it.effect(`throws ${direction.name} from the player's current look and advances the owner position`, () =>
      Effect.gen(function* () {
        const slice = yield* makeSlice({
          pose: { ...pose, yawRadians: direction.yaw, pitchRadians: direction.pitch },
        })
        yield* slice.drop()
        const before = (yield* slice.snapshot()).state.items[0]
        expect(before).toBeDefined()
        if (before === undefined) throw new Error('drop request produced no entity')
        expect(before.feetPosition).toEqual(position(8, 65.32, 8))
        expect(before.velocity?.x).toBeCloseTo(direction.x)
        expect(before.velocity?.z).toBeCloseTo(direction.z)
        expect(before.velocity?.y).toBeCloseTo(2 + Math.sin(direction.pitch) * 6)
        expect(before.dimension).toBe('overworld')
        expect(before.stack).toEqual(Result.getOrThrow(itemStack('stone', 1)))
        yield* slice.step()
        const after = (yield* slice.snapshot()).state.items[0]
        expect(after).toBeDefined()
        if (after === undefined) throw new Error('entity frame lost the dropped stack')
        expect(after.id).toBe(before.id)
        expect(after.behaviour.count).toBe(1)
        expect(after.feetPosition.y).toBeGreaterThan(before.feetPosition.y)
        if (direction.x < -1) expect(after.feetPosition.x).toBeLessThan(before.feetPosition.x)
        if (direction.z < -1) expect(after.feetPosition.z).toBeLessThan(before.feetPosition.z)
        if (direction.z > 1) expect(after.feetPosition.z).toBeGreaterThan(before.feetPosition.z)
        expect(yield* Ref.get(slice.state.operationFailures)).toEqual([])
      }),
    )
  }

  it.effect('preserves component-bearing tool metadata and durability through drop and pickup', () =>
    Effect.gen(function* () {
      const enchantments = Result.getOrThrow(enchantmentsComponent({ 'minecraft:mending': 1 }))
      const components = Result.getOrThrow(itemComponents('diamond_pickaxe', { enchantments }))
      const held = Result.getOrThrow(itemStack('diamond_pickaxe', 1, { components }))
      const slice = yield* makeSlice({ held })
      const before = (yield* slice.storage()).state.inventoryDurability[27]
      yield* slice.drop()
      const drop = (yield* slice.snapshot()).state.items[0]
      expect(drop).toBeDefined()
      if (drop === undefined) throw new Error('component-bearing drop is missing')
      expect(drop.stack).toEqual(held)
      expect(drop.behaviour.durability).toEqual(before)
      yield* requestDroppedItemPickup(slice.state, {
        actor: EntityId('metadata-picker'), tick: 1,
        position: drop.feetPosition, radius: 2, currentFrame: 40,
      })
      yield* slice.step(0)
      const after = (yield* slice.storage()).state
      expect(after.inventory.slots.find((stored) => stored !== undefined)).toEqual(held)
      const returnedIndex = after.inventory.slots.findIndex((stored) => stored?.item === 'diamond_pickaxe')
      expect(after.inventoryDurability[returnedIndex]).toEqual(before)
      expect((yield* slice.snapshot()).state.items).toEqual([])
    }),
  )

  it.effect('restores velocity and stack metadata from the dropped owner snapshot before the next frame', () =>
    Effect.gen(function* () {
      const slice = yield* makeSlice({ pose: { ...pose, yawRadians: 0.2, pitchRadians: 0.1 } })
      yield* slice.drop()
      yield* slice.step()
      const saved = (yield* slice.snapshot()).state
      const restored = Schema.decodeUnknownSync(DroppedItemOwnerSnapshotSchema)(
        JSON.parse(JSON.stringify(Schema.encodeSync(DroppedItemOwnerSnapshotSchema)(saved))),
      )
      expect(restored).toEqual(saved)
      const resumed = yield* makeSlice({ drops: restored })
      yield* resumed.step()
      const next = (yield* resumed.snapshot()).state.items[0]
      const previous = saved.items[0]
      expect(next).toBeDefined()
      expect(previous).toBeDefined()
      if (next === undefined || previous === undefined) throw new Error('persisted drop is missing')
      expect(next.id).toBe(previous.id)
      expect(next.feetPosition.z).toBeLessThan(previous.feetPosition.z)
      expect(next.stack).toEqual(previous.stack)
      expect(next.behaviour).toEqual(previous.behaviour)
    }),
  )

  it.effect('prevents pickup until the existing frame delay expires, then collects exactly once', () =>
    Effect.gen(function* () {
      const slice = yield* makeSlice()
      yield* slice.drop()
      const drop = (yield* slice.snapshot()).state.items[0]
      expect(drop).toBeDefined()
      if (drop === undefined) throw new Error('drop request produced no entity')
      const eligible = drop.behaviour.eligibleFromFrame
      expect(eligible).toBe(40)
      if (eligible === undefined) throw new Error('throw has no pickup delay')
      const pickup = {
        actor: EntityId('throw-picker'),
        tick: 1,
        position: drop.feetPosition,
        radius: 2,
      }
      yield* Ref.set(slice.state.tickCount, eligible - 1)
      yield* requestDroppedItemPickup(slice.state, pickup)
      yield* slice.step(0)
      expect((yield* slice.snapshot()).state.items).toHaveLength(1)
      expect((yield* slice.storage()).state.inventory.slots[27]?.count).toBe(2)
      expect(yield* drainDroppedItemPickupExecutions(slice.state)).toMatchObject([{
        outcome: { _tag: 'Completed', result: [] },
      }])
      yield* Ref.set(slice.state.tickCount, eligible)
      yield* requestDroppedItemPickup(slice.state, { ...pickup, tick: 2 })
      yield* slice.step(0)
      expect((yield* slice.snapshot()).state.items).toEqual([])
      const total = (yield* slice.storage()).state.inventory.slots.reduce(
        (sum, stored) => sum + (stored === undefined ? 0 : stored.count), 0,
      )
      expect(total).toBe(3)
      expect(yield* drainDroppedItemPickupExecutions(slice.state)).toMatchObject([{
        outcome: { _tag: 'Completed', result: [{ accepted: 1 }] },
      }])
      yield* requestDroppedItemPickup(slice.state, { ...pickup, tick: 3, currentFrame: eligible + 1 })
      yield* slice.step(0)
      expect((yield* slice.snapshot()).state.items).toEqual([])
      expect((yield* slice.storage()).state.inventory.slots.reduce(
        (sum, stored) => sum + (stored === undefined ? 0 : stored.count), 0,
      )).toBe(3)
    }),
  )

  it.effect('bounces away from a side wall and continues falling without losing its stack', () =>
    Effect.gen(function* () {
      const slice = yield* makeSlice({
        blocks: world([[blockPosition(8, 65, 7), Option.getOrThrow(blockIdOf('stone'))]]),
      })
      yield* slice.drop()
      yield* slice.step()
      const stopped = (yield* slice.snapshot()).state.items[0]
      expect(stopped).toBeDefined()
      if (stopped === undefined) throw new Error('colliding drop is missing')
      expect(stopped.feetPosition.z).toBeGreaterThanOrEqual(8)
      expect(stopped.behaviour.count).toBe(1)
      for (let frame = 0; frame < 10; frame += 1) yield* slice.step()
      const falling = (yield* slice.snapshot()).state.items[0]
      expect(falling).toBeDefined()
      if (falling === undefined) throw new Error('colliding drop lost its stack')
      expect(falling.feetPosition.z).toBeGreaterThanOrEqual(8)
      expect(falling.feetPosition.y).toBeLessThan(stopped.feetPosition.y)
      expect(falling.behaviour.count).toBe(1)
    }),
  )

  it.effect('settles an item already on a floor with zero vertical velocity after gravity contact', () =>
    Effect.gen(function* () {
      const drops: DroppedItemOwnerSnapshot = {
        items: [{
          id: EntityId('floor-initial-contact'),
          feetPosition: position(8.5, 64, 8.5),
          dimension: 'overworld',
          velocity: { x: 0, y: 0, z: 0 },
          stack: Result.getOrThrow(itemStack('stone', 1)),
          behaviour: { _tag: 'DroppedItem', item: 'stone', count: StackCount(1), durability: null },
        }],
      }
      const slice = yield* makeSlice({
        drops,
        blocks: world([[blockPosition(8, 63, 8), Option.getOrThrow(blockIdOf('stone'))]]),
      })
      yield* slice.step()
      const resting = (yield* slice.snapshot()).state.items[0]
      expect(resting).toBeDefined()
      if (resting === undefined) throw new Error('initial floor contact lost its stack')
      expect(resting.feetPosition.y).toBeGreaterThanOrEqual(64)
      expect(resting.velocity).toBeUndefined()
      for (let frame = 0; frame < 10; frame += 1) yield* slice.step()
      expect((yield* slice.snapshot()).state.items[0]).toEqual(resting)
      expect(yield* Ref.get(slice.state.operationFailures)).toEqual([])
    }),
  )

  it.effect('recovers the touched wall face instead of an unrelated swept box sharing its coordinate', () =>
    Effect.gen(function* () {
      const drops: DroppedItemOwnerSnapshot = {
        items: [{
          id: EntityId('wall-face-disambiguation'),
          feetPosition: position(8 + 1e-10, 64.5, 8),
          dimension: 'overworld',
          velocity: { x: -6, y: 2, z: -20 },
          stack: Result.getOrThrow(itemStack('stone', 1)),
          behaviour: { _tag: 'DroppedItem', item: 'stone', count: StackCount(1), durability: null },
        }],
      }
      const slice = yield* makeSlice({
        drops,
        blocks: world([
          [blockPosition(7, 64, 6), Option.getOrThrow(blockIdOf('stone'))],
          [blockPosition(8, 64, 7), Option.getOrThrow(blockIdOf('stone'))],
        ]),
      })
      yield* slice.step(0.2)
      const bounced = (yield* slice.snapshot()).state.items[0]
      expect(bounced).toBeDefined()
      if (bounced === undefined) throw new Error('wall contact lost its stack')
      expect(bounced.velocity?.x).toBeLessThan(0)
      expect(bounced.velocity?.z).toBeGreaterThan(0)
      expect(bounced.feetPosition.z).toBeGreaterThan(8)
      expect(yield* Ref.get(slice.state.operationFailures)).toEqual([])
    }),
  )

  it.effect('lands on a solid floor and settles without dropping the stack through it', () =>
    Effect.gen(function* () {
      const floor = world(Array.from(
        { length: 16 },
        (_, z): readonly [BlockPosition, BlockId] =>
          [blockPosition(8, 63, z), Option.getOrThrow(blockIdOf('stone'))],
      ))
      const slice = yield* makeSlice({ blocks: floor })
      yield* slice.drop()
      for (let frame = 0; frame < 80; frame += 1) yield* slice.step()
      const resting = (yield* slice.snapshot()).state.items[0]
      expect(resting).toBeDefined()
      if (resting === undefined) throw new Error('landed drop is missing')
      expect(resting.feetPosition.y).toBeCloseTo(64)
      expect(resting.behaviour.count).toBe(1)
      for (let frame = 0; frame < 10; frame += 1) yield* slice.step()
      expect((yield* slice.snapshot()).state.items[0]?.feetPosition).toEqual(resting.feetPosition)
    }),
  )

  it.effect('keeps a preexisting drop without throw velocity at its original position', () =>
    Effect.gen(function* () {
      const drops: DroppedItemOwnerSnapshot = {
        items: [{
          id: EntityId('legacy-drop'),
          feetPosition: position(8, 65, 8),
          behaviour: { _tag: 'DroppedItem', item: 'stone', count: StackCount(2), durability: null },
        }],
      }
      const slice = yield* makeSlice({ drops })
      yield* slice.step()
      yield* slice.step()
      expect((yield* slice.snapshot()).state).toEqual(drops)
    }),
  )
})
