/**
 * A test double typed directly by mc-sim's `InventoryService`.
 *
 * ---------------------------------------------------------------------------
 * Why a double at all, and what makes it meaningful
 * ---------------------------------------------------------------------------
 *
 * The double is intentionally typed directly by mc-sim's published interface.
 * mx-gameplay supplies the service at its composition boundary while mc-sim
 * remains the owner of inventory transitions; this keeps gameplay tests
 * deterministic without creating a second inventory implementation.
 *
 * ---------------------------------------------------------------------------
 * IT IS A REAL INVENTORY, AND `./roster.ts`'s REFUSAL IS THE REASON IT MAY BE
 * ---------------------------------------------------------------------------
 *
 * `apps/preview-mining-site/roster.ts` refuses to implement mc-sim's roster and
 * states the test it applied: a working one would be A SECOND IMPLEMENTATION OF
 * MC-SIM'S SERVICE living in mx-gameplay, and nothing there is under test. The
 * store double answers the same question the other way — it implements a real
 * store 「because the rules under test read and write blocks and a store that
 * refused would test nothing」.
 *
 * The inventory is now on the second side of that line. `gameplay:interactions`
 * deposits every mined item through `add` and READS THE NUMBER BACK, so a
 * double that refused, or that always answered `0`, would make the leftover
 * path untestable — and the leftover path is the one that loses items.
 *
 * ---------------------------------------------------------------------------
 * THE THREE PROPERTIES IT REPRODUCES, AND WHY IT MUST
 * ---------------------------------------------------------------------------
 *
 * All three come from `mc-sim/domain/inventory.ts`'s public `addItem`, which
 * this double delegates to. They all change the LEFTOVER — the only number this
 * repository reads:
 *
 *   - PARTIAL STACKS ARE TOPPED UP BEFORE EMPTY SLOTS ARE OPENED. Filling empty
 *     slots first fragments an inventory into many partial stacks of one item
 *     and the player finds 36 slots full while holding barely any material. A
 *     double that opened a new slot per `add` would report leftover 0 for a
 *     working inventory and for a broken one alike.
 *   - A STACK CAPS AT `MAX_STACK_COUNT`, and a full inventory is 36 x 64 of one
 *     item and not 36 x infinity. Without the cap nothing ever overflows and
 *     `stages/registration.ts`'s leftover branch is dead code no test reaches.
 *   - A QUANTITY THAT IS NOT A QUANTITY LEAVES NOTHING BEHIND. mc-sim reports a
 *     rejected `count` as leftover — 2.5 items asked for is 2.5 not placed —
 *     EXCEPT when it is not finite, because a `NaN` leftover is a number every
 *     caller downstream would believe. That asymmetry is transcribed rather
 *     than simplified: it is the preview's finding F5 in mc-sim's handwriting.
 *
 * ---------------------------------------------------------------------------
 * What it counts, and what it refuses
 * ---------------------------------------------------------------------------
 *
 * `deposits` is the log of successful `add` calls, in order, each with what came back.
 * That is not decoration: 「one `add` per mined stack, and the loot folded into
 * ONE stack rather than emitted twice」 is a claim about the number of CALLS,
 * and asserting it on the resulting slots instead would pass for a stage that
 * called `add(item, 1)` three times.
 *
 * The three crafting members die rather than answering plausibly, following the
 * store double's rule for `load`: no rule in this repository crafts, mc-sim's
 * recipe resolution is pinned by mc-sim's own tests, and a double that
 * half-implemented `matchRecipe` would let a test here assert a match nobody
 * computes. The persistence members use mc-sim's own validation and storage
 * transitions so inventory, equipment, and durability cannot drift apart.
 */
import { Effect, Layer, Ref, Result } from 'effect'
import { MAX_STACK_COUNT, StackCount } from '@nerima-games/mc-kernel'
import {
  addItem as addInventoryItems,
  addStoredStack as addStorageStoredStack,
  consumeAndDamageAt as consumeAndDamageStorageAt,
  damageAt as damageStorageAt,
  durabilityForItem,
  emptyPlayerStorage,
  equipFromInventory as equipStorageFromInventory,
  InventoryService,
  isEquippableItemType,
  isValidDurabilityForItem,
  maxStackCountForItem,
  removeItem as removeInventoryItems,
  removeItemAt as removeInventoryItemAt,
  storageFromInventory,
  unequipToInventory as unequipStorageToInventory,
  validatePlayerStorageSnapshot,
  withInventory,
  type Inventory,
  type InventoryClick,
  type InventoryClickResult,
  type InventoryServiceApi,
  type ItemStackFailure,
  type PlayerStorage,
  type PlayerStorageFailure,
  type RemoveAtResult,
  type Slot,
} from '@nerima-games/mc-sim'

type ItemType = Parameters<InventoryServiceApi['add']>[0]

/** mc-sim's `INVENTORY_SLOT_COUNT`, transcribed. The number that makes overflow reachable. */
export const INVENTORY_SLOT_COUNT = 36

/** One `add` call and the number that came back. */
export type Deposit = {
  readonly item: ItemType
  readonly count: number
  /** What did NOT fit. `0` is the ordinary answer. */
  readonly leftover: number
}

/** One `remove` call and the number that came back. */
export type Withdrawal = {
  readonly item: ItemType
  readonly count: number
  /** What was ACTUALLY TAKEN — the opposite polarity to `Deposit.leftover`. */
  readonly removed: number
}

export type InventoryDouble = {
  /** Handed straight to `gameplayStages`, which takes the API rather than the tag. */
  readonly api: InventoryServiceApi
  /** For the `makeGameplayStages` path, which acquires the tag itself. */
  readonly layer: Layer.Layer<InventoryService>
  readonly deposits: Effect.Effect<ReadonlyArray<Deposit>>
  readonly withdrawals: Effect.Effect<ReadonlyArray<Withdrawal>>
}

type Doubles = {
  storage: PlayerStorage
  deposits: ReadonlyArray<Deposit>
  withdrawals: ReadonlyArray<Withdrawal>
}

/** An empty inventory of the right width. mc-sim's `emptyInventory`. */
export const emptySlots = (): ReadonlyArray<Slot> =>
  Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined)

const totalOf = (slots: ReadonlyArray<Slot>, item: ItemType): number =>
  slots.reduce(
    (running, slot) =>
      slot !== undefined && slot.item === item ? running + slot.count : running,
    0,
  )

type ClickOutcome = {
  readonly slots: ReadonlyArray<Slot>
  readonly result: InventoryClickResult
}

const validCarried = (carried: InventoryClick['carried']): boolean =>
  carried === undefined ||
  (Number.isInteger(carried.count) &&
    carried.count > 0 &&
    carried.count <= maxStackCountForItem(carried.item) &&
    (isEquippableItemType(carried.item)
      ? carried.durability === undefined ||
        isValidDurabilityForItem(carried.item, carried.durability)
      : carried.durability === undefined))

const clickSlot = (slots: ReadonlyArray<Slot>, click: InventoryClick): ClickOutcome => {
  if (!Number.isInteger(click.slotIndex) || click.slotIndex < 0 || click.slotIndex >= slots.length) {
    return { slots, result: { _tag: 'InvalidSlot', carried: click.carried } }
  }
  if (!validCarried(click.carried)) {
    return { slots, result: { _tag: 'InvalidCount', carried: click.carried } }
  }

  const slot = slots[click.slotIndex]
  const maxStackCount =
    click.carried === undefined ? MAX_STACK_COUNT : maxStackCountForItem(click.carried.item)
  if (click._tag === 'LeftClick') {
    if (click.carried === undefined) {
      if (slot === undefined) {
        return { slots, result: { _tag: 'NoChange', carried: undefined } }
      }
      const next = [...slots]
      next[click.slotIndex] = undefined
      return { slots: next, result: { _tag: 'PickedUp', carried: slot } }
    }
    if (slot === undefined) {
      const next = [...slots]
      next[click.slotIndex] = {
        item: click.carried.item,
        count: click.carried.count,
        components: click.carried.components,
      }
      return { slots: next, result: { _tag: 'Placed', carried: undefined } }
    }
    if (slot.item !== click.carried.item) {
      const next = [...slots]
      next[click.slotIndex] = {
        item: click.carried.item,
        count: click.carried.count,
        components: click.carried.components,
      }
      return { slots: next, result: { _tag: 'Swapped', carried: slot } }
    }

    const accepted = Math.min(maxStackCount - slot.count, click.carried.count)
    if (accepted <= 0) {
      return { slots, result: { _tag: 'NoChange', carried: click.carried } }
    }
    const next = [...slots]
    next[click.slotIndex] = {
      item: slot.item,
      count: StackCount(slot.count + accepted),
      components: slot.components,
    }
    const remaining = click.carried.count - accepted
    return {
      slots: next,
      result: {
        _tag: 'Merged',
        carried:
          remaining === 0
            ? undefined
            : {
                item: click.carried.item,
                count: StackCount(remaining),
                components: click.carried.components,
              },
      },
    }
  }

  if (click.carried === undefined) {
    if (slot === undefined) {
      return { slots, result: { _tag: 'NoChange', carried: undefined } }
    }
    const pickedUp = Math.ceil(slot.count / 2)
    const remaining = slot.count - pickedUp
    const next = [...slots]
    next[click.slotIndex] =
      remaining === 0
        ? undefined
        : { item: slot.item, count: StackCount(remaining), components: slot.components }
    return {
      slots: next,
      result: {
        _tag: 'PickedUp',
        carried: { item: slot.item, count: StackCount(pickedUp), components: slot.components },
      },
    }
  }

  if (slot !== undefined && (slot.item !== click.carried.item || slot.count >= maxStackCount)) {
    return { slots, result: { _tag: 'NoChange', carried: click.carried } }
  }
  const next = [...slots]
  next[click.slotIndex] = {
    item: click.carried.item,
    count: StackCount((slot?.count ?? 0) + 1),
    components: click.carried.components,
  }
  const remaining = click.carried.count - 1
  return {
    slots: next,
    result: {
      _tag: slot === undefined ? 'Placed' : 'Merged',
      carried:
        remaining === 0
          ? undefined
          : {
              item: click.carried.item,
              count: StackCount(remaining),
              components: click.carried.components,
            },
    },
  }
}

const refuse = <A>(what: string): Effect.Effect<A> =>
  Effect.die(
    `inventory-service-double: ${what} — not exercised by this repository's slice. See test/support/inventory-service-double.ts.`,
  )

export const makeInventoryDouble = (
  initial: ReadonlyArray<Slot> = emptySlots(),
): Effect.Effect<InventoryDouble> =>
  Effect.map(
    Ref.make<Doubles>({
      storage: storageFromInventory({ slots: initial }),
      deposits: [],
      withdrawals: [],
    }),
    (state) => {
      const api: InventoryServiceApi = {
        // `Ref.modify` and not get-then-set, which is mc-sim's own convention
        // and its reason (DN-07): two mining stages, a network item-sync and an
        // autosave read can all be in flight at once, and a read-modify-write
        // split across two Effects loses one of them.
        add: (item, count) =>
          Effect.flatMap(
            Ref.modify<
              Doubles,
              Result.Result<number, ItemStackFailure | PlayerStorageFailure>
            >(state, (doubles) => {
              const outcome = addInventoryItems(doubles.storage.inventory, item, count)
              if (Result.isFailure(outcome)) {
                return [Result.fail(outcome.failure), doubles] as const
              }
              const updated = withInventory(doubles.storage, outcome.success.inventory)
              if (Result.isFailure(updated)) return [Result.fail(updated.failure), doubles] as const
              return [
                Result.succeed(outcome.success.leftover),
                {
                  ...doubles,
                  storage: updated.success,
                  deposits: [
                    ...doubles.deposits,
                    { item, count, leftover: outcome.success.leftover },
                  ],
                },
              ] as const
            }),
            Effect.fromResult,
          ),

        addStoredStack: (stack) =>
          Ref.modify(state, (doubles) => {
            const outcome = addStorageStoredStack(doubles.storage, stack)
            const leftover =
              outcome.result._tag === 'Added' ? (outcome.result.leftover?.count ?? 0) : stack.count
            return [
              outcome.result,
              {
                ...doubles,
                storage: outcome.storage,
                deposits: [
                  ...doubles.deposits,
                  { item: stack.item, count: stack.count, leftover },
                ],
              },
            ] as const
          }),

        remove: (item, count) =>
          Effect.flatMap(
            Ref.modify<
              Doubles,
              Result.Result<number, ItemStackFailure | PlayerStorageFailure>
            >(state, (doubles) => {
              const outcome = removeInventoryItems(doubles.storage.inventory, item, count)
              if (Result.isFailure(outcome)) {
                return [Result.fail(outcome.failure), doubles] as const
              }
              const updated = withInventory(doubles.storage, outcome.success.inventory)
              if (Result.isFailure(updated)) return [Result.fail(updated.failure), doubles] as const
              return [
                Result.succeed(outcome.success.removed),
                {
                  ...doubles,
                  storage: updated.success,
                  withdrawals: [
                    ...doubles.withdrawals,
                    { item, count, removed: outcome.success.removed },
                  ],
                },
              ] as const
            }),
            Effect.fromResult,
          ),

        removeAt: (slotIndex, expectedItem, count) =>
          Effect.flatMap(
            Ref.modify<Doubles, Result.Result<RemoveAtResult, ItemStackFailure | PlayerStorageFailure>>(
              state,
              (doubles) => {
                const outcome = removeInventoryItemAt(
                  doubles.storage.inventory,
                  slotIndex,
                  expectedItem,
                  count,
                )
                if (Result.isFailure(outcome)) {
                  return [Result.fail(outcome.failure), doubles] as const
                }
                const updated = withInventory(doubles.storage, outcome.success.inventory)
                if (Result.isFailure(updated)) {
                  return [Result.fail(updated.failure), doubles] as const
                }
                const result = outcome.success.result
                return [
                  Result.succeed(result),
                  {
                    ...doubles,
                    storage: updated.success,
                    withdrawals:
                      result._tag === 'Removed'
                        ? [
                            ...doubles.withdrawals,
                            { item: expectedItem, count, removed: result.removed },
                          ]
                        : doubles.withdrawals,
                  },
                ] as const
              },
            ),
            Effect.fromResult,
          ),

        click: (click) =>
          Effect.flatMap(
            Ref.modify<Doubles, Result.Result<InventoryClickResult, PlayerStorageFailure>>(
              state,
              (doubles) => {
                const beforeDurability = doubles.storage.inventoryDurability[click.slotIndex]
                const outcome = clickSlot(doubles.storage.inventory.slots, click)
                const updated = withInventory(doubles.storage, { slots: outcome.slots })
                if (Result.isFailure(updated)) {
                  return [Result.fail(updated.failure), doubles] as const
                }
                let storage = updated.success
                if (
                  (outcome.result._tag === 'Placed' ||
                    outcome.result._tag === 'Swapped' ||
                    outcome.result._tag === 'Merged') &&
                  click.carried !== undefined &&
                  isEquippableItemType(click.carried.item)
                ) {
                  const durability =
                    click.carried.durability ?? durabilityForItem(click.carried.item)
                  const values = [...storage.inventoryDurability]
                  values[click.slotIndex] = durability === null ? null : { ...durability }
                  storage = { ...storage, inventoryDurability: values }
                }
                const result =
                  (outcome.result._tag === 'PickedUp' || outcome.result._tag === 'Swapped') &&
                  isEquippableItemType(outcome.result.carried.item) &&
                  beforeDurability !== null &&
                  beforeDurability !== undefined
                    ? {
                        ...outcome.result,
                        carried: { ...outcome.result.carried, durability: beforeDurability },
                      }
                    : outcome.result
                return [
                  Result.succeed(result),
                  {
                    ...doubles,
                    storage,
                  },
                ] as const
              },
            ),
            Effect.fromResult,
          ),

        getSlot: () => refuse('getSlot'),
        // mc-sim 0.2.1 (dist release, Wave 0 toolchain freeze). Not exercised by
        // this repository's slice — same `refuse` convention as `getSlot`.
        getHotbarSlots: refuse('getHotbarSlots'),
        setSlot: () => refuse('setSlot'),
        moveStack: () => refuse('moveStack'),
        quickMove: () => refuse('quickMove'),
        sortInventory: refuse('sortInventory'),

        countOf: (item) =>
          Effect.map(Ref.get(state), (doubles) => totalOf(doubles.storage.inventory.slots, item)),

        snapshot: Effect.map(Ref.get(state), (doubles): Inventory => doubles.storage.inventory),
        equipmentSnapshot: Effect.map(Ref.get(state), (doubles) => doubles.storage.equipment),
        storageSnapshot: Effect.map(Ref.get(state), (doubles) => doubles.storage),

        restoreStorage: (snapshot) => {
          const validated = validatePlayerStorageSnapshot(snapshot)
          switch (validated._tag) {
            case 'Valid':
              return Ref.update(state, (doubles) => ({ ...doubles, storage: validated.storage }))
            case 'Invalid':
            case 'ItemStackFailure':
              return Effect.fail(validated.error)
            default: {
              const exhaustive: never = validated
              return Effect.die(exhaustive)
            }
          }
        },

        equipFromInventory: (inventorySlot, equipmentSlot) =>
          Ref.modify(state, (doubles) => {
            const outcome = equipStorageFromInventory(
              doubles.storage,
              inventorySlot,
              equipmentSlot,
            )
            return [outcome.result, { ...doubles, storage: outcome.storage }] as const
          }),

        unequipToInventory: (equipmentSlot, inventorySlot) =>
          Ref.modify(state, (doubles) => {
            const outcome = unequipStorageToInventory(
              doubles.storage,
              equipmentSlot,
              inventorySlot,
            )
            return [outcome.result, { ...doubles, storage: outcome.storage }] as const
          }),

        damageAt: (location, amount) =>
          Ref.modify(state, (doubles) => {
            const outcome = damageStorageAt(doubles.storage, location, amount)
            return [outcome.result, { ...doubles, storage: outcome.storage }] as const
          }),

        consumeAndDamageAt: (request) =>
          Ref.modify(state, (doubles) => {
            const outcome = consumeAndDamageStorageAt(doubles.storage, request)
            return [outcome.result, { ...doubles, storage: outcome.storage }] as const
          }),
        createContainer: () => refuse('createContainer'),
        // mc-sim 0.2.1 (dist release, Wave 0 toolchain freeze). Same `refuse`
        // convention as the world-container methods above and below it.
        createContainerAt: () => refuse('createContainerAt'),
        containerSnapshot: () => refuse('containerSnapshot'),
        containerSnapshotAt: () => refuse('containerSnapshotAt'),
        containerStorageSnapshot: refuse('containerStorageSnapshot'),
        restoreContainerStorage: () => refuse('restoreContainerStorage'),
        transferContainerItem: () => refuse('transferContainerItem'),
        extractContainerItem: () => refuse('extractContainerItem'),
        extractOneContainerItemAt: () => refuse('extractOneContainerItemAt'),
        moveContainerItem: () => refuse('moveContainerItem'),
        moveOneContainerItemAt: () => refuse('moveOneContainerItemAt'),
        drainContainer: () => refuse('drainContainer'),

        reset: Ref.update(state, (doubles) => ({ ...doubles, storage: emptyPlayerStorage() })),

        // Not exercised by this repository's slice. See the module header.
        restore: () => refuse('restore'),
        recipes: refuse('recipes'),
        previewCraft: () => refuse('previewCraft'),
        craft: () => refuse('craft'),
      }

      return {
        api,
        layer: Layer.succeed(InventoryService, api),
        deposits: Effect.map(Ref.get(state), (doubles) => doubles.deposits),
        withdrawals: Effect.map(Ref.get(state), (doubles) => doubles.withdrawals),
      }
    },
  )

/**
 * An empty inventory as a Layer, for the tests that are about the SHAPE of the
 * registration rather than about any item.
 *
 * Declared after the factory it calls because it evaluates at module load — the
 * same note `chunk-store-double.ts`'s `emptyWorldStoreLayer` carries.
 */
export const emptyInventoryLayer: Layer.Layer<InventoryService> = Layer.effect(
  InventoryService,
  Effect.map(makeInventoryDouble(), (double) => double.api),
)

/**
 * Slots pre-filled so that ONE more of `item` will not fit.
 *
 * Every slot holds a full stack, which is the only arrangement in which `add`
 * overflows — 36 x 64 of one item. Built through the published `addItem`
 * transition rather than written out, so this matches what the service means.
 */
export const brimming = (item: ItemType): ReadonlyArray<Slot> => {
  const outcome = addInventoryItems(
    { slots: emptySlots() },
    item,
    INVENTORY_SLOT_COUNT * MAX_STACK_COUNT,
  )
  return Result.getOrThrow(outcome).inventory.slots
}
