import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { Effect, Ref, Result, Schema, Stream } from 'effect'
import { WorldRevisionSchema, enchantmentsComponent, itemComponents } from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  PlayerStorageSnapshotSchema,
  TimeService,
  WorldCommitCoordinator,
  itemStack,
  durabilityForItem,
  equipmentItem,
  storageFromInventory,
  type PlayerStorage,
  type Slot,
  makeTimeService,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { ChunkStore } from '@nerima-games/mc-worldgen'
import {
  drainItemUseResults,
  makeGameplayFrameStateForOwner,
  gameplayStages,
  requestDropSelectedItem,
  requestPickBlock,
  GameplayDropSelectedItemResultSchema,
  GameplayPickBlockResultSchema,
  GameplayHotbarItemUseResultSchema,
  GameplayPickBlockTargetSchema,
  type InteractionInventoryContext,
  type PickBlockTarget,
} from '../src/index.js'
import { drainGameplayUnsupportedOperations, entityManagerTag } from '../src/stages/registration-core.js'
import { makeGameplayStagesWithState } from '../src/stages/gameplay-stage-composition.js'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids.js'
import {
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations.js'
import { DroppedItemOwnerSnapshotSchema, type DroppedItemOwnerSnapshot } from '../src/domain/entities/dropped-item.js'
import type { MobBehaviour } from '../src/domain/entities/mob-frame.js'
import { world } from './support/chunk-store-double.js'
import { makeEntityManagerDouble } from './support/entity-manager-double.js'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double.js'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles.js'
import { makePlayerServiceDouble } from './support/player-service-double.js'
import { runFrame } from './support/frame-runner.js'

const stack = (item: Parameters<typeof itemStack>[0], count: number) =>
  Result.getOrThrow(itemStack(item, count))

const totalStorageCount = (storage: PlayerStorage): number =>
  storage.inventory.slots.reduce((sum, item) => sum + (item === undefined ? 0 : item.count), 0) +
  Object.values(storage.equipment.slots).reduce((sum, item) => sum + (item === null ? 0 : item.count), 0)

const makeSlice = (
  slots = emptySlots(),
  selected = 0,
  options: Readonly<{
    storage?: PlayerStorage
    drops?: DroppedItemOwnerSnapshot
    legacyCommit?: 'none' | 'without-drops'
    coordinator?: (coordinator: WorldCommitCoordinatorApi) => WorldCommitCoordinatorApi
  }> = {},
) => Effect.gen(function* () {
  const store = yield* makeTransactionalChunkStoreDouble(world([]), ['0,0'])
  const inventory = yield* makeInventoryDouble(slots)
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const time = yield* makeTimeService()
  const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
    ...(options.storage === undefined ? {} : { playerStorage: options.storage }),
    ...(options.drops === undefined ? {} : { droppedItems: options.drops }),
  })
  const coordinator = options.coordinator === undefined
    ? commit.coordinator
    : options.coordinator(commit.coordinator)
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const registered = makeGameplayStagesWithState(state).pipe(
    Effect.provideService(ChunkStore, store.api),
    Effect.provideService(entityManagerTag<MobBehaviour>(), roster.api),
    Effect.provideService(TimeService, time),
    Effect.provideService(WorldCommitCoordinator, coordinator),
    Effect.provideService(DomainEventBus, { publish: () => Effect.void, events: Stream.empty }),
  )
  const productionStages = yield* registered
  const player = yield* makePlayerServiceDouble()
  const { droppedItemsOwnerId: _droppedOwner, ...withoutDrops } = commit
  const stages = options.legacyCommit === undefined
    ? productionStages
    : gameplayStages(
        state, store.api, roster.api, inventory.api, player.api, time, undefined, {},
        options.legacyCommit === 'none' ? undefined : { ...withoutDrops, coordinator },
      )
  const interactions = stages.filter((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
  expect(interactions).toHaveLength(1)
  return {
    state,
    inventory: { mode: 'survival', slotIndex: 27 + selected } satisfies InteractionInventoryContext,
    run: () => runFrame(interactions),
    storage: () => coordinator.snapshot(GAMEPLAY_PLAYER_STORAGE_OWNER_ID, PlayerStorageSnapshotSchema),
    drops: () => coordinator.snapshot(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, DroppedItemOwnerSnapshotSchema),
  }
})

describe('public selected-item drop requests', () => {
  for (const capability of ['none', 'without-drops']) {
    it.effect(`reports unavailable ${capability} commit capability without changing either owner`, () =>
      Effect.gen(function* () {
        const slots = [...emptySlots()]
        slots[27] = stack('stone', 3)
        const slice = yield* makeSlice(slots, 0, {
          legacyCommit: capability === 'none' ? 'none' : 'without-drops',
        })
        const before = (yield* slice.storage()).state
        yield* requestDropSelectedItem(slice.state, 'missing-capability', 'one', slice.inventory)
        yield* slice.run()
        expect((yield* slice.storage()).state).toEqual(before)
        expect((yield* slice.drops()).state.items).toEqual([])
        expect(yield* drainGameplayUnsupportedOperations(slice.state)).toMatchObject([{
          _tag: 'Unsupported', action: 'DropSelectedItem', requestId: 'missing-capability',
          reason: capability === 'none' ? 'WorldCommitCoordinatorUnavailable' : 'OwnerRegistrationUnavailable',
        }])
      }),
    )
  }

  for (const owner of [GAMEPLAY_DROPPED_ITEMS_OWNER_ID, GAMEPLAY_PLAYER_OWNER_ID]) {
    it.effect(`rejects a stale ${owner} observation before removing or spawning the selected stack`, () =>
      Effect.gen(function* () {
        const slots = [...emptySlots()]
        slots[27] = stack('stone', 4)
        const slice = yield* makeSlice(slots, 0, {
          coordinator: (coordinator) => ({
            ...coordinator,
            snapshot: (ownerId, schema) => Effect.flatMap(coordinator.revision, (revision) =>
              Effect.map(coordinator.snapshot(ownerId, schema), (snapshot) =>
                ownerId === owner ? {
                  ...snapshot,
                  revision: Schema.decodeUnknownSync(WorldRevisionSchema)(revision + 1),
                } : snapshot)),

          }),
        })
        const before = (yield* slice.storage()).state
        yield* requestDropSelectedItem(slice.state, 'stale-owner', 'stack', slice.inventory)
        yield* slice.run()
        expect((yield* slice.storage()).state).toEqual(before)
        expect((yield* slice.drops()).state.items).toEqual([])
        expect(yield* Ref.get(slice.state.operationFailures)).toMatchObject([{
          subject: 'ItemUse', operation: 'OwnerSnapshot', requestId: 'stale-owner',
          error: { _tag: 'WorldRevisionConflict' },
        }])
        expect(yield* Ref.get(slice.state.pendingItemUses)).toEqual([])
      }),
    )
  }

  it.effect('preserves preexisting dropped records when appending the newly removed stack', () =>
    Effect.gen(function* () {
      const drops = Schema.decodeUnknownSync(DroppedItemOwnerSnapshotSchema)({
        items: [{
          id: 'preexisting-drop',
          feetPosition: { x: 3, y: 65, z: 3 },
          behaviour: { _tag: 'DroppedItem', item: 'dirt', count: 6, durability: null },
        }],
      })
      const slots = [...emptySlots()]
      slots[27] = stack('stone', 4)
      const slice = yield* makeSlice(slots, 0, { drops })
      yield* requestDropSelectedItem(slice.state, 'append', 'one', slice.inventory)
      yield* slice.run()
      const after = (yield* slice.drops()).state.items
      expect(after).toHaveLength(2)
      expect(after[0]).toEqual(drops.items[0])
      expect(after[1]?.behaviour).toMatchObject({ item: 'stone', count: 1 })
      expect((yield* slice.storage()).state.inventory.slots[27]?.count).toBe(3)
    }),
  )

  it.effect('drops one from the actual selected hotbar slot through production composition', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[0] = stack('dirt', 9)
      slots[27] = stack('dirt', 12)
      slots[30] = stack('stone', 4)
      const slice = yield* makeSlice(slots, 3)
      yield* requestDropSelectedItem(slice.state, 'one', 'one', slice.inventory)
      expect((yield* slice.storage()).state.inventory.slots[30]?.count).toBe(4)
      expect((yield* slice.drops()).state.items).toHaveLength(0)
      yield* slice.run()
      const after = (yield* slice.storage()).state.inventory.slots
      expect(after[0]?.count).toBe(9)
      expect(after[27]?.count).toBe(12)
      expect(after[30]?.count).toBe(3)
      expect((yield* slice.drops()).state.items).toMatchObject([{ behaviour: { item: 'stone', count: 1 } }])
      expect(yield* drainItemUseResults(slice.state)).toEqual([{
        action: 'DropSelectedItem', requestId: 'one', success: true, outcome: 'Dropped', count: 1,
      }])
      yield* slice.run()
      expect((yield* slice.drops()).state.items).toHaveLength(1)
      expect(yield* drainItemUseResults(slice.state)).toEqual([])
    }),
  )

  for (const amount of ['one', 'stack']) {
    it.effect(`clears the last item for ${amount} without affecting other slots`, () =>
      Effect.gen(function* () {
        const slots = [...emptySlots()]
        slots[27] = stack('stone', 1)
        const slice = yield* makeSlice(slots)
        yield* requestDropSelectedItem(slice.state, 'last', amount === 'one' ? 'one' : 'stack', slice.inventory)
        yield* slice.run()
        expect((yield* slice.storage()).state.inventory.slots[27]).toBeUndefined()
        expect((yield* slice.drops()).state.items).toMatchObject([{ behaviour: { item: 'stone', count: 1 } }])
      }),
    )
  }

  it.effect('drops the entire selected stack even when every inventory slot is occupied', () =>
    Effect.gen(function* () {
      const slots = emptySlots().map(() => stack('dirt', 64))
      slots[35] = stack('stone', 37)
      const slice = yield* makeSlice(slots, 8)
      yield* requestDropSelectedItem(slice.state, 'whole', 'stack', slice.inventory)
      yield* slice.run()
      const after = (yield* slice.storage()).state.inventory.slots
      expect(after[35]).toBeUndefined()
      expect(after.slice(0, 35)).toEqual(slots.slice(0, 35))
      expect((yield* slice.drops()).state.items).toMatchObject([{ behaviour: { item: 'stone', count: 37 } }])
    }),
  )

  it.effect('treats an empty selected slot as a no-op despite items in other slots', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[0] = stack('stone', 64)
      const slice = yield* makeSlice(slots)
      const before = yield* slice.storage()
      yield* requestDropSelectedItem(slice.state, 'empty', 'stack', slice.inventory)
      yield* slice.run()
      expect((yield* slice.storage()).state).toEqual(before.state)
      expect((yield* slice.drops()).state.items).toEqual([])
      expect(yield* drainItemUseResults(slice.state)).toEqual([{
        action: 'DropSelectedItem', requestId: 'empty', success: false, failure: 'EmptySlot',
      }])
    }),
  )

  it.effect('keeps storage and dropped entities unchanged when the atomic commit is rejected', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[27] = stack('stone', 6)
      const slice = yield* makeSlice(slots, 0, {
        coordinator: (coordinator) => ({
          ...coordinator,
          commit: (request) => coordinator.commit({
            ...request,
            expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(999),
          }),
        }),
      })
      const storageBefore = yield* slice.storage()
      const dropsBefore = yield* slice.drops()
      yield* requestDropSelectedItem(slice.state, 'rejected', 'stack', slice.inventory)
      yield* slice.run()
      expect((yield* slice.storage()).state).toEqual(storageBefore.state)
      expect((yield* slice.drops()).state).toEqual(dropsBefore.state)
      expect(yield* drainItemUseResults(slice.state)).toEqual([])
      expect(yield* Ref.get(slice.state.pendingItemUses)).toMatchObject([{ requestId: 'rejected' }])
      expect(yield* Ref.get(slice.state.operationFailures)).toMatchObject([{
        _tag: 'Failed', subject: 'ItemUse', operation: 'WorldCommit', requestId: 'rejected',
        error: { _tag: 'WorldRevisionConflict' },
      }])
    }),
  )

  it('conserves total storage plus dropped counts for survival drops', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 64 }),
      fc.integer({ min: 0, max: 8 }),
      fc.boolean(),
      fc.array(fc.integer({ min: 0, max: 64 }), { minLength: 36, maxLength: 36 }),
      async (heldCount, selected, wholeStack, counts) => {
        await Effect.runPromise(Effect.gen(function* () {
          const slots = counts.map((count) => count === 0 ? undefined : stack('dirt', count))
          slots[27 + selected] = heldCount === 0 ? undefined : stack('stone', heldCount)
          const storage = storageFromInventory({ slots })
          const helmet = Result.getOrThrow(equipmentItem(
            stack('iron_helmet', 1), durabilityForItem('iron_helmet'),
          ))
          const slice = yield* makeSlice(slots, selected, {
            storage: {
              ...storage,
              equipment: { slots: { ...storage.equipment.slots, head: helmet } },
            },
          })
          const before = totalStorageCount((yield* slice.storage()).state)
          yield* requestDropSelectedItem(slice.state, 'property', wholeStack ? 'stack' : 'one', slice.inventory)
          yield* slice.run()
          const stored = totalStorageCount((yield* slice.storage()).state)
          const items = (yield* slice.drops()).state.items
          const dropped = items.reduce((sum, item) => sum + item.behaviour.count, 0)
          expect(stored + dropped).toBe(before)
          expect(items).toHaveLength(heldCount === 0 ? 0 : 1)
          expect(dropped).toBe(wholeStack ? heldCount : Math.min(heldCount, 1))
        }))
      },
    ), { numRuns: 100 })
  })
})

describe('public pick-block requests', () => {
  it.effect('swaps the displaced tool components and durability into the source inventory slot', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      const enchantments = Result.getOrThrow(enchantmentsComponent({ 'minecraft:mending': 1 }))
      const components = Result.getOrThrow(itemComponents('diamond_pickaxe', { enchantments }))
      const tool = Result.getOrThrow(itemStack('diamond_pickaxe', 1, { components }))
      for (let index = 27; index < 36; index++) slots[index] = stack('dirt', 1)
      slots[5] = stack('stone', 17)
      slots[29] = tool
      const slice = yield* makeSlice(slots, 2)
      const before = (yield* slice.storage()).state
      yield* requestPickBlock(slice.state, 'swap-metadata', { block: 'stone' }, { ...slice.inventory, mode: 'survival' })
      yield* slice.run()
      const after = (yield* slice.storage()).state
      expect(after.inventory.slots[5]).toEqual(tool)
      expect(after.inventoryDurability[5]).toEqual(before.inventoryDurability[29])
      expect(after.inventory.slots[29]).toEqual(slots[5])
      expect(after.inventoryDurability[29]).toBeNull()
    }),
  )

  it.effect('uses the existing redstone-wire to redstone-dust block item mapping', () =>
    Effect.gen(function* () {
      const slice = yield* makeSlice()
      yield* requestPickBlock(slice.state, 'mapped', { block: 'redstone_wire' }, { ...slice.inventory, mode: 'creative' })
      yield* slice.run()
      expect((yield* slice.storage()).state.inventory.slots[27]).toEqual(stack('redstone_dust', 1))
      expect(yield* drainItemUseResults(slice.state)).toMatchObject([{
        action: 'PickBlock', success: true, outcome: 'Created',
      }])
    }),
  )
  for (const mode of ['survival', 'creative']) {
    it.effect(`selects a matching hotbar item before a main inventory match in ${mode}`, () =>
      Effect.gen(function* () {
        const slots = [...emptySlots()]
        slots[2] = stack('stone', 12)
        slots[31] = stack('stone', 3)
        slots[27] = stack('dirt', 8)
        const slice = yield* makeSlice(slots)
        const before = (yield* slice.storage()).state
        yield* requestPickBlock(slice.state, 'select', { block: 'stone' }, { ...slice.inventory, mode: mode === 'survival' ? 'survival' : 'creative' })
        yield* slice.run()
        expect(yield* Ref.get(slice.state.itemUseResults)).toMatchObject([{ selectedSlot: 4 }])
        expect((yield* slice.storage()).state).toEqual(before)
        expect(yield* drainItemUseResults(slice.state)).toMatchObject([{
          action: 'PickBlock', requestId: 'select', success: true, outcome: 'Selected', selectedSlot: 4,
        }])
      }),
    )

    it.effect(`swaps a main inventory match with the occupied selected slot in ${mode} and full inventory`, () =>
      Effect.gen(function* () {
        const slots = emptySlots().map(() => stack('dirt', 64))
        slots[5] = stack('stone', 17)
        slots[29] = stack('cobblestone', 6)
        const slice = yield* makeSlice(slots, 2)
        yield* requestPickBlock(slice.state, 'swap', { block: 'stone' }, { ...slice.inventory, mode: mode === 'survival' ? 'survival' : 'creative' })
        yield* slice.run()
        const after = (yield* slice.storage()).state.inventory.slots
        expect(after[29]).toEqual(slots[5])
        expect(after[5]).toEqual(slots[29])
        expect(after.filter((_, index) => index !== 5 && index !== 29))
          .toEqual(slots.filter((_, index) => index !== 5 && index !== 29))
        expect(yield* Ref.get(slice.state.itemUseResults)).toMatchObject([{ selectedSlot: 2 }])
        expect(yield* drainItemUseResults(slice.state)).toMatchObject([{
          action: 'PickBlock', success: true, outcome: 'Swapped', selectedSlot: 2,
        }])
      }),
    )

    it.effect(`does nothing for a block without item form in ${mode}`, () =>
      Effect.gen(function* () {
        const slots = [...emptySlots()]
        slots[27] = stack('stone', 4)
        const slice = yield* makeSlice(slots)
        const before = (yield* slice.storage()).state
        yield* requestPickBlock(slice.state, 'no-item', { block: 'air' }, { ...slice.inventory, mode: mode === 'survival' ? 'survival' : 'creative' })
        yield* slice.run()
        expect((yield* slice.storage()).state).toEqual(before)
        expect(yield* drainItemUseResults(slice.state)).toMatchObject([{
          action: 'PickBlock', success: false, failure: 'NoItemForm',
        }])
      }),
    )
  }

  it.effect('moves a main-inventory match into an empty selected slot in survival', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[3] = stack('stone', 11)
      const slice = yield* makeSlice(slots, 7)
      yield* requestPickBlock(slice.state, 'empty-target', { block: 'stone' }, { ...slice.inventory, mode: 'survival' })
      yield* slice.run()
      expect((yield* slice.storage()).state.inventory.slots[34]).toEqual(slots[3])
      expect((yield* slice.storage()).state.inventory.slots[3]).toBeUndefined()
      expect(yield* Ref.get(slice.state.itemUseResults)).toMatchObject([{ selectedSlot: 7 }])
    }),
  )

  it.effect('leaves a full survival inventory unchanged when the item is absent', () =>
    Effect.gen(function* () {
      const slots = emptySlots().map(() => stack('dirt', 64))
      const slice = yield* makeSlice(slots, 5)
      const before = (yield* slice.storage()).state
      yield* requestPickBlock(slice.state, 'missing', { block: 'stone' }, { ...slice.inventory, mode: 'survival' })
      yield* slice.run()
      expect((yield* slice.storage()).state).toEqual(before)
      expect(yield* drainItemUseResults(slice.state)).toMatchObject([{
        action: 'PickBlock', success: false, failure: 'MissingItem',
      }])
    }),
  )

  it.effect('creates one item in the empty selected creative slot', () =>
    Effect.gen(function* () {
      const slice = yield* makeSlice(emptySlots(), 6)
      yield* requestPickBlock(slice.state, 'create-selected', { block: 'stone' }, { ...slice.inventory, mode: 'creative' })
      yield* slice.run()
      expect((yield* slice.storage()).state.inventory.slots[33]).toEqual(stack('stone', 1))
      expect(yield* Ref.get(slice.state.itemUseResults)).toMatchObject([{ selectedSlot: 6 }])
      expect(yield* drainItemUseResults(slice.state)).toMatchObject([{
        action: 'PickBlock', success: true, outcome: 'Created', selectedSlot: 6,
      }])
    }),
  )

  it.effect('preserves an occupied selected creative slot and selects the first empty hotbar slot', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[27] = stack('dirt', 7)
      slots[30] = stack('cobblestone', 8)
      const slice = yield* makeSlice(slots, 3)
      yield* requestPickBlock(slice.state, 'create-empty', { block: 'stone' }, { ...slice.inventory, mode: 'creative' })
      yield* slice.run()
      const after = (yield* slice.storage()).state.inventory.slots
      expect(after[30]).toEqual(slots[30])
      expect(after[27]).toEqual(slots[27])
      expect(after[31]).toEqual(stack('stone', 1))
      expect(yield* Ref.get(slice.state.itemUseResults)).toMatchObject([{ selectedSlot: 4 }])
    }),
  )

  it.effect('replaces the selected creative slot when the hotbar is full', () =>
    Effect.gen(function* () {
      const slots = emptySlots().map(() => stack('dirt', 64))
      const slice = yield* makeSlice(slots, 8)
      yield* requestPickBlock(slice.state, 'create-full', { block: 'stone' }, { ...slice.inventory, mode: 'creative' })
      yield* slice.run()
      const after = (yield* slice.storage()).state.inventory.slots
      expect(after[35]).toEqual(stack('stone', 1))
      expect(after.slice(0, 35)).toEqual(slots.slice(0, 35))
      expect(yield* Ref.get(slice.state.itemUseResults)).toMatchObject([{ selectedSlot: 8 }])
    }),
  )
})

describe('pick inventory placement and canonical components', () => {
  for (const mode of ['survival', 'creative']) {
    it.effect(`uses the next cyclic empty hotbar slot for a main match in ${mode}`, () =>
      Effect.gen(function* () {
        const slots = [...emptySlots()]
        slots[4] = stack('stone', 8)
        slots[29] = stack('dirt', 9)
        const slice = yield* makeSlice(slots, 2)
        yield* requestPickBlock(slice.state, 'main-empty', { block: 'stone' }, {
          ...slice.inventory, mode: mode === 'survival' ? 'survival' : 'creative',
        })
        yield* slice.run()
        const after = (yield* slice.storage()).state.inventory.slots
        expect(after[29]).toEqual(slots[29])
        expect(after[30]).toEqual(slots[4])
        expect(after[4]).toBeUndefined()
        expect(yield* drainItemUseResults(slice.state)).toEqual([{
          action: 'PickBlock', requestId: 'main-empty', success: true,
          outcome: 'Swapped', selectedSlot: 3,
        }])
      }),
    )
  }

  it.effect('wraps empty hotbar search from the last selected slot', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      slots[35] = stack('dirt', 1)
      const slice = yield* makeSlice(slots, 8)
      yield* requestPickBlock(slice.state, 'wrap', { block: 'stone' }, {
        ...slice.inventory, mode: 'creative',
      })
      yield* slice.run()
      expect((yield* slice.storage()).state.inventory.slots[27]).toEqual(stack('stone', 1))
      expect(yield* drainItemUseResults(slice.state)).toMatchObject([{ selectedSlot: 0 }])
    }),
  )

  it.effect('preserves a displaced enchanted tool and its durability in the first empty main slot', () =>
    Effect.gen(function* () {
      const slots: Array<Slot> = emptySlots().map(() => stack('dirt', 1))
      slots[3] = undefined
      slots[5] = undefined
      const enchantments = Result.getOrThrow(enchantmentsComponent({ 'minecraft:mending': 1 }))
      const components = Result.getOrThrow(itemComponents('diamond_pickaxe', { enchantments }))
      const tool = Result.getOrThrow(itemStack('diamond_pickaxe', 1, { components }))
      slots[31] = tool
      const slice = yield* makeSlice(slots, 4)
      const before = (yield* slice.storage()).state
      yield* requestPickBlock(slice.state, 'preserve', { block: 'stone' }, {
        ...slice.inventory, mode: 'creative',
      })
      yield* slice.run()
      const after = (yield* slice.storage()).state
      expect(after.inventory.slots[31]).toEqual(stack('stone', 1))
      expect(after.inventory.slots[3]).toEqual(tool)
      expect(after.inventoryDurability[3]).toEqual(before.inventoryDurability[31])
      expect(after.inventoryDurability[31]).toBeNull()
      expect(after.inventory.slots[5]).toBeUndefined()
      expect(totalStorageCount(after)).toBe(totalStorageCount(before) + 1)
    }),
  )

  it.effect('ignores component-distinct hotbar and main stacks when picking an ordinary block', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      const enchantments = Result.getOrThrow(enchantmentsComponent({ 'minecraft:mending': 1 }))
      const components = Result.getOrThrow(itemComponents('stone', { enchantments }))
      const decorated = Result.getOrThrow(itemStack('stone', 3, { components }))
      slots[27] = decorated
      slots[0] = decorated
      const slice = yield* makeSlice(slots)
      yield* requestPickBlock(slice.state, 'components', { block: 'stone' }, {
        ...slice.inventory, mode: 'creative',
      })
      yield* slice.run()
      const after = (yield* slice.storage()).state.inventory.slots
      expect(after[27]).toEqual(decorated)
      expect(after[0]).toEqual(decorated)
      expect(after[28]).toEqual(stack('stone', 1))
      expect(yield* drainItemUseResults(slice.state)).toMatchObject([{
        outcome: 'Created', selectedSlot: 1,
      }])
    }),
  )

  it.effect('does not select a renamed stack for an ordinary survival world pick', () =>
    Effect.gen(function* () {
      const slots = [...emptySlots()]
      const components = Result.getOrThrow(itemComponents('stone', { customName: 'Named stone' }))
      const named = Result.getOrThrow(itemStack('stone', 2, { components }))
      slots[27] = named
      slots[1] = named
      const slice = yield* makeSlice(slots)
      const before = (yield* slice.storage()).state
      yield* requestPickBlock(slice.state, 'named', { block: 'stone' }, slice.inventory)
      yield* slice.run()
      expect((yield* slice.storage()).state).toEqual(before)
      expect(yield* drainItemUseResults(slice.state)).toEqual([{
        action: 'PickBlock', requestId: 'named', success: false, failure: 'MissingItem',
      }])
    }),
  )

  const mappings: ReadonlyArray<Readonly<{
    target: PickBlockTarget
    item: Parameters<typeof itemStack>[0]
  }>> = [
    { target: { block: 'door_open' }, item: 'door' },
    { target: { block: 'redstone_lamp_lit' }, item: 'redstone_lamp' },
    { target: { block: 'redstone_wall_torch' }, item: 'redstone_torch' },
    { target: { block: 'wheat_crop' }, item: 'wheat_seeds' },
    { target: { block: 'potato_crop' }, item: 'potato' },
    { target: { block: 'nether_wart_crop' }, item: 'nether_wart' },
    { target: { block: 'piston_head', pistonHeadType: 'normal' }, item: 'piston' },
    { target: { block: 'piston_head', pistonHeadType: 'sticky' }, item: 'sticky_piston' },
  ]
  for (const { target, item } of mappings) {
    it.effect(`maps ${JSON.stringify(target)} to its picked item`, () =>
      Effect.gen(function* () {
        const slice = yield* makeSlice()
        yield* requestPickBlock(slice.state, 'alias', target, {
          ...slice.inventory, mode: 'creative',
        })
        yield* slice.run()
        expect((yield* slice.storage()).state.inventory.slots[27]).toEqual(stack(item, 1))
      }),
    )
  }
})

describe('public drop and pick schemas and request boundaries', () => {
  it('decodes each result variant through its individual and combined schemas', () => {
    const dropped = { action: 'DropSelectedItem', requestId: 'schema', success: true, outcome: 'Dropped', count: 1 }
    const empty = { action: 'DropSelectedItem', requestId: 'schema', success: false, failure: 'EmptySlot' }
    for (const value of [dropped, empty]) {
      expect(Schema.decodeUnknownSync(GameplayDropSelectedItemResultSchema)(value)).toEqual(value)
      expect(Schema.decodeUnknownSync(GameplayHotbarItemUseResultSchema)(value)).toEqual(value)
    }
    for (const outcome of ['Selected', 'Swapped', 'Created']) {
      const value = { action: 'PickBlock', requestId: 'schema', success: true, outcome, selectedSlot: 8 }
      expect(Schema.decodeUnknownSync(GameplayPickBlockResultSchema)(value)).toEqual(value)
      expect(Schema.decodeUnknownSync(GameplayHotbarItemUseResultSchema)(value)).toEqual(value)
    }
    for (const failure of ['MissingItem', 'NoItemForm']) {
      const value = { action: 'PickBlock', requestId: 'schema', success: false, failure }
      expect(Schema.decodeUnknownSync(GameplayPickBlockResultSchema)(value)).toEqual(value)
      expect(Schema.decodeUnknownSync(GameplayHotbarItemUseResultSchema)(value)).toEqual(value)
    }
  })

  for (const value of [
    { action: 'DropSelectedItem', requestId: 'bad', success: true, failure: 'EmptySlot' },
    { action: 'DropSelectedItem', requestId: 'bad', success: false, failure: 'EmptySlot', count: 0 },
    { action: 'DropSelectedItem', requestId: 'bad', success: true, outcome: 'Dropped', count: 0 },
    { action: 'PickBlock', requestId: 'bad', success: true, outcome: 'Selected', selectedSlot: 9 },
    { action: 'PickBlock', requestId: 'bad', success: false, failure: 'MissingItem', selectedSlot: 0 },
    { action: 'PickBlock', requestId: 'bad', success: false, outcome: 'NoItemForm' },
  ]) {
    it(`rejects impossible result shape ${JSON.stringify(value)}`, () => {
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayHotbarItemUseResultSchema)(value))).toBe(true)
    })
  }

  for (const target of [
    { block: 'piston_head' },
    { block: 'piston_head', pistonHeadType: 'unknown' },
    { block: 'stone', pistonHeadType: 'sticky' },
  ]) {
    it(`rejects missing or unrelated piston state ${JSON.stringify(target)}`, () => {
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayPickBlockTargetSchema)(target))).toBe(true)
    })
  }

  it.effect('rejects non-hotbar request context before queueing either request', () =>
    Effect.gen(function* () {
      const slice = yield* makeSlice()
      for (const slotIndex of [-1, 0, 26, 36, 27.5]) {
        const inventory = { mode: 'survival', slotIndex } satisfies InteractionInventoryContext
        expect(Result.isFailure(yield* Effect.result(
          requestDropSelectedItem(slice.state, 'invalid-drop', 'one', inventory),
        ))).toBe(true)
        expect(Result.isFailure(yield* Effect.result(
          requestPickBlock(slice.state, 'invalid-pick', { block: 'stone' }, inventory),
        ))).toBe(true)
      }
      expect(yield* Ref.get(slice.state.pendingItemUses)).toEqual([])
    }),
  )

  for (const capability of ['none', 'without-drops']) {
    it.effect(`reports missing ${capability} support even when the selected hand is empty`, () =>
      Effect.gen(function* () {
        const slice = yield* makeSlice(emptySlots(), 0, {
          legacyCommit: capability === 'none' ? 'none' : 'without-drops',
        })
        yield* requestDropSelectedItem(slice.state, 'empty-unsupported', 'one', slice.inventory)
        yield* slice.run()
        expect(yield* drainItemUseResults(slice.state)).toEqual([])
        expect(yield* drainGameplayUnsupportedOperations(slice.state)).toMatchObject([{
          action: 'DropSelectedItem',
          reason: capability === 'none' ? 'WorldCommitCoordinatorUnavailable' : 'OwnerRegistrationUnavailable',
        }])
      }),
    )
  }
})
