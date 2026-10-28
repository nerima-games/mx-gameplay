import {
  EntityHealthPoints,
  EntityId,
  EntityIdSchema,
  DomainEventSchema,
  ITEM_TYPES,
  MAX_STACK_COUNT,
  maxStackCountForItem,
  SimulationTickSchema,
  itemIdOf,
  itemStack,
  type ItemStackFailure,
  type ItemType,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  addStoredStack as addStorageStoredStack,
  durabilityForItem,
  DurabilitySchema,
  emptyPlayerStorage,
  EQUIPMENT_SLOTS,
  PlayerStorageSnapshotSchema,
  playerStorageOwnerRegistration,
  ReplicatedOwnerIdSchema,
  WorldRevisionConflict,
  type AddStoredStackResult,
  type EntitySerialExhausted,
  type Durability,
  type InventoryServiceApi,
  type PlayerStorage,
  type ReplicatedOwnerId,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Result, Schema, SchemaParser, Semaphore } from 'effect'
import { changed, DESPAWNED, UNCHANGED, type Entity, type EntityManagerApi } from '@nerima-games/mc-sim'
import { StackCount } from '@nerima-games/mc-kernel'
import { decodeEnchantedItem, type Enchantment, type EnchantedItem } from '../enchantment.js'
import {
  DROPPED_ITEM_KIND,
  isDroppedItemBehaviour,
  type MobBehaviour,
  type MobDropEvent,
} from './mob-frame.js'

export const DROPPED_ITEM_PICKUP_RADIUS = 1.5

export type DroppedItemSpawn = {
  readonly item: ItemType
  readonly count: number
  readonly at: Position
  readonly durability?: Durability | null
  readonly eligibleFromFrame?: number
  readonly customName?: string
  readonly enchantments?: ReadonlyArray<Enchantment>
}

export type DroppedItemSpawnError = Extract<
  AddStoredStackResult,
  { readonly _tag: 'InvalidStack' | 'ItemStackFailure' }
> | EntitySerialExhausted

const copyDurability = (durability: Durability | null): Durability | null =>
  durability === null ? null : { ...durability }

export const spawnDroppedItem = (
  roster: EntityManagerApi<MobBehaviour>,
  drop: DroppedItemSpawn,
): Effect.Effect<Entity<MobBehaviour>, DroppedItemSpawnError> => {
  const durability =
    drop.durability === undefined ? durabilityForItem(drop.item) : drop.durability
  const count = Result.getOrUndefined(StackCount.result(drop.count))
  if (count === undefined) return Effect.fail({ _tag: 'InvalidStack' })
  const stackItem = Result.getOrUndefined(itemStack(drop.item, count))
  if (stackItem === undefined) return Effect.fail({ _tag: 'InvalidStack' })
  const stack = { ...stackItem, durability: copyDurability(durability) }
  const validation = addStorageStoredStack(emptyPlayerStorage(), stack).result
  if (validation._tag !== 'Added') return Effect.fail(validation)

  return roster.spawn({
    kind: DROPPED_ITEM_KIND,
    feetPosition: drop.at,
    healthPoints: EntityHealthPoints(1),
    behaviour: {
      _tag: 'DroppedItem',
      item: stack.item,
      count: stack.count,
      durability: stack.durability,
      ...(drop.eligibleFromFrame === undefined
        ? {}
        : { eligibleFromFrame: drop.eligibleFromFrame }),
      ...(drop.customName === undefined ? {} : { customName: drop.customName }),
      ...(drop.enchantments === undefined ? {} : { enchantments: drop.enchantments.map((e) => ({ ...e })) }),
    },
  })
}

export const spawnDroppedItems = (
  roster: EntityManagerApi<MobBehaviour>,
  drops: ReadonlyArray<DroppedItemSpawn>,
): Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>, DroppedItemSpawnError> =>
  Effect.forEach(drops, (drop) => spawnDroppedItem(roster, drop))

export const spawnMobDrop = (
  roster: EntityManagerApi<MobBehaviour>,
  drop: MobDropEvent,
): Effect.Effect<Entity<MobBehaviour>, DroppedItemSpawnError> => spawnDroppedItem(roster, drop)

export const spawnMobDrops = (
  roster: EntityManagerApi<MobBehaviour>,
  drops: ReadonlyArray<MobDropEvent>,
): Effect.Effect<ReadonlyArray<Entity<MobBehaviour>>, DroppedItemSpawnError> =>
  spawnDroppedItems(roster, drops)

type PickupCoordinates = Readonly<{ x: number; y: number; z: number }>

const distanceSquared = (left: PickupCoordinates, right: PickupCoordinates): number => {
  const dx = left.x - right.x
  const dy = left.y - right.y
  const dz = left.z - right.z
  return dx * dx + dy * dy + dz * dz
}

const pickupLocks = new WeakMap<
  EntityManagerApi<MobBehaviour>,
  Semaphore.Semaphore
>()

const pickupLockFor = (roster: EntityManagerApi<MobBehaviour>): Semaphore.Semaphore => {
  const existing = pickupLocks.get(roster)
  if (existing !== undefined) return existing
  const created = Semaphore.makeUnsafe(1)
  pickupLocks.set(roster, created)
  return created
}

/** Has an item that landed on frame `eligibleFromFrame` sat long enough to be picked up on `currentFrame`? */
export const isDroppedItemPickupEligible = (
  currentFrame: number,
  eligibleFromFrame: number | undefined,
): boolean => eligibleFromFrame === undefined || currentFrame >= eligibleFromFrame

export const pickupDroppedItems = (
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  playerPosition: Position | undefined,
  radius: number = DROPPED_ITEM_PICKUP_RADIUS,
  currentFrame?: number,
): Effect.Effect<void> =>
  pickupLockFor(roster).withPermits(1)(
    Effect.gen(function* () {
      if (playerPosition === undefined || !Number.isFinite(radius) || radius < 0) return

      const leftovers = new Map<
        string,
        { readonly count: number; readonly durability: Durability | null } | null
      >()
      const radiusSquared = radius * radius
      for (const entity of yield* roster.entities) {
        if (
          entity.kind !== DROPPED_ITEM_KIND ||
          !isDroppedItemBehaviour(entity.behaviour) ||
          (currentFrame !== undefined &&
            !isDroppedItemPickupEligible(currentFrame, entity.behaviour.eligibleFromFrame)) ||
          distanceSquared(entity.feetPosition, playerPosition) > radiusSquared
        ) continue

        const count = Result.getOrUndefined(StackCount.result(entity.behaviour.count))
        if (count === undefined) continue
        const stack = Result.getOrUndefined(itemStack(entity.behaviour.item, count))
        if (stack === undefined) continue
        // The prefilter and constructors validate the same item/count/durability
        // shape as mc-sim storage. If that validation diverges, leave the entity
        // unchanged so an unexpected result cannot silently consume the dropped stack.
        const result = yield* inventory.addStoredStack({
          ...stack,
          durability: copyDurability(entity.behaviour.durability),
        })
        if (result._tag === 'Added') leftovers.set(entity.id, result.leftover)
      }

      if (leftovers.size === 0) return
      yield* roster.sweep<never>((entity) => {
        const leftover = leftovers.get(entity.id)
        if (leftover === undefined) return { transition: UNCHANGED, emit: undefined }
        if (leftover === null) return { transition: DESPAWNED, emit: undefined }
        const behaviour = entity.behaviour
        // Inventory storage is effectful, so a roster restore can replace this
        // entity between enumeration and this sweep. Do not apply a stale pickup
        // result to a restored entity whose behaviour is no longer a dropped item.
        if (!isDroppedItemBehaviour(behaviour)) return { transition: UNCHANGED, emit: undefined }
        return {
          transition: changed({
            feetPosition: entity.feetPosition,
            healthPoints: entity.healthPoints,
            behaviour: {
              ...behaviour,
              count: leftover.count,
              durability: copyDurability(leftover.durability),
            },
          }),
          emit: undefined,
        }
      })
    })
  )

const strictCodec = <A, I>(schema: Schema.Codec<A, I>): Schema.Codec<A, I> =>
  Schema.declareConstructor<A, I>()([schema], ([inner]) =>
    (input, _ast, options) =>
      SchemaParser.decodeUnknownEffect(inner)(input, {
        ...options,
        onExcessProperty: 'error',
      }),
  )

const NonNegativeIntegerSchema: Schema.Codec<number, number> = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
)
const NonNegativeFiniteSchema: Schema.Codec<number, number> = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
)
const DroppedItemStackCountSchema: Schema.Codec<StackCount, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_STACK_COUNT }),
).pipe(Schema.brand('StackCount'))

type DroppedItemPositionEncoded = Readonly<{ x: number; y: number; z: number }>
const DroppedItemPositionSchema: Schema.Codec<Position, DroppedItemPositionEncoded> = strictCodec(
  Schema.Struct({
    x: Schema.Finite.pipe(Schema.brand('PositionAxis')),
    y: Schema.Finite.pipe(Schema.brand('PositionAxis')),
    z: Schema.Finite.pipe(Schema.brand('PositionAxis')),
  }),
)

type DroppedItemEnchantmentEncoded = Readonly<{ id: Enchantment['id']; level: number }>
const DroppedItemEnchantmentSchema: Schema.Codec<Enchantment, DroppedItemEnchantmentEncoded> = strictCodec(
  Schema.Struct({
    id: Schema.Literals(['protection', 'sharpness', 'efficiency', 'unbreaking', 'fortune', 'power']),
    level: Schema.Int,
  }),
)

type DroppedItemSnapshotBehaviour = Readonly<{
  _tag: 'DroppedItem'
  item: ItemType
  count: StackCount
  durability: Durability | null
  eligibleFromFrame?: number | undefined
  customName?: string | undefined
  enchantments?: ReadonlyArray<Enchantment> | undefined
}>
const DroppedItemBehaviourSnapshotSchema: Schema.Codec<DroppedItemSnapshotBehaviour, unknown> = strictCodec(
  Schema.Struct({
    _tag: Schema.Literal('DroppedItem'),
    item: Schema.Literals(ITEM_TYPES),
    count: DroppedItemStackCountSchema,
    durability: strictCodec(Schema.NullOr(DurabilitySchema)),
    eligibleFromFrame: Schema.optional(NonNegativeIntegerSchema),
    customName: Schema.optional(Schema.String),
    enchantments: Schema.optional(Schema.Array(DroppedItemEnchantmentSchema)),
  }),
).check(Schema.makeFilter((value) =>
  isDroppedItemBehaviour(value) &&
  value.count <= maxStackCountForItem(value.item),
))

type DroppedItemRecord = Readonly<{
  id: Schema.Schema.Type<typeof EntityIdSchema>
  feetPosition: Position
  behaviour: DroppedItemSnapshotBehaviour
}>
const DroppedItemRecordSchema: Schema.Codec<DroppedItemRecord, unknown> = strictCodec(
  Schema.Struct({
    id: EntityIdSchema,
    feetPosition: DroppedItemPositionSchema,
    behaviour: DroppedItemBehaviourSnapshotSchema,
  }),
)

const DroppedItemOwnerSnapshotFields: {
  readonly items: Schema.$Array<typeof DroppedItemRecordSchema>
} = {
  items: Schema.Array(DroppedItemRecordSchema),
}
export type DroppedItemOwnerSnapshot = Schema.Struct.Type<
  typeof DroppedItemOwnerSnapshotFields
>
export const DroppedItemOwnerSnapshotSchema: Schema.Codec<
  DroppedItemOwnerSnapshot,
  unknown
> = strictCodec(Schema.Struct(DroppedItemOwnerSnapshotFields)).check(
  Schema.makeFilter(({ items }) => {
    const ids = new Set(items.map(({ id }) => id))
    return ids.size === items.length
  }),
)

export type DroppedItemPickupOwners = Readonly<{
  playerStorage: ReplicatedOwnerId
  droppedItems: ReplicatedOwnerId
}>

export const droppedItemOwnerRegistration = (
  ownerId: ReplicatedOwnerId,
  initialState: DroppedItemOwnerSnapshot = { items: [] },
): ReplicatedOwnerRegistration<typeof DroppedItemOwnerSnapshotSchema> => ({
  ownerId,
  schema: DroppedItemOwnerSnapshotSchema,
  initialState,
})

export const appendDroppedItemSpawns = (
  snapshot: DroppedItemOwnerSnapshot,
  drops: ReadonlyArray<DroppedItemSpawn>,
  expectedRevision: number,
): Result.Result<DroppedItemOwnerSnapshot, Schema.SchemaError | DroppedItemSpawnError> => {
  const items = [...snapshot.items]
  const ids = new Set(items.map(({ id }) => id))
  let serial = 0

  for (const drop of drops) {
    const requested = StackCount.result(drop.count)
    if (Result.isFailure(requested)) return Result.fail({ _tag: 'InvalidStack' })
    let remaining: number = requested.success
    while (remaining > 0) {
      const count = Math.min(maxStackCountForItem(drop.item), remaining)
      const stackCount = StackCount.result(count)
      if (Result.isFailure(stackCount)) return Result.fail({ _tag: 'InvalidStack' })
      const id = EntityId(`mx-gameplay-drop:${String(expectedRevision)}:${String(serial)}`)
      serial += 1
      if (ids.has(id)) continue
      ids.add(id)
      items.push({
        id,
        feetPosition: drop.at,
        behaviour: {
          _tag: 'DroppedItem',
          item: drop.item,
          count: stackCount.success,
          durability: copyDurability(
            drop.durability === undefined ? durabilityForItem(drop.item) : drop.durability,
          ),
          ...(drop.eligibleFromFrame === undefined
            ? {}
            : { eligibleFromFrame: drop.eligibleFromFrame }),
          ...(drop.customName === undefined ? {} : { customName: drop.customName }),
          ...(drop.enchantments === undefined
            ? {}
            : { enchantments: drop.enchantments.map((enchantment) => ({ ...enchantment })) }),
        },
      })
      remaining -= count
    }
  }

  return Schema.decodeUnknownResult(DroppedItemOwnerSnapshotSchema)({ items })
}

export const droppedItemPickupOwnerRegistrations = (
  owners: DroppedItemPickupOwners,
  playerStorage: PlayerStorage,
  droppedItems: DroppedItemOwnerSnapshot = { items: [] },
): readonly [
  ReplicatedOwnerRegistration<typeof PlayerStorageSnapshotSchema>,
  ReplicatedOwnerRegistration<typeof DroppedItemOwnerSnapshotSchema>,
] => [
  playerStorageOwnerRegistration(owners.playerStorage, playerStorage),
  droppedItemOwnerRegistration(owners.droppedItems, droppedItems),
]

const DroppedItemPickupRequestFields: {
  readonly actor: typeof EntityIdSchema
  readonly tick: typeof SimulationTickSchema
  readonly position: Schema.optional<typeof DroppedItemPositionSchema>
  readonly radius: Schema.optional<typeof NonNegativeFiniteSchema>
  readonly currentFrame: Schema.optional<typeof NonNegativeIntegerSchema>
} = {
  actor: EntityIdSchema,
  tick: SimulationTickSchema,
  position: Schema.optional(DroppedItemPositionSchema),
  radius: Schema.optional(NonNegativeFiniteSchema),
  currentFrame: Schema.optional(NonNegativeIntegerSchema),
}
export const DroppedItemPickupRequestSchema: Schema.Codec<
  Schema.Struct.Type<typeof DroppedItemPickupRequestFields>,
  unknown
> = strictCodec(Schema.Struct(DroppedItemPickupRequestFields))

export type DroppedItemPickupRequest = Readonly<{
  actor: Schema.Codec.Encoded<typeof EntityIdSchema>
  tick: Schema.Codec.Encoded<typeof SimulationTickSchema>
  position?: Schema.Codec.Encoded<typeof DroppedItemPositionSchema> | undefined
  radius?: Schema.Codec.Encoded<typeof NonNegativeFiniteSchema> | undefined
  currentFrame?: Schema.Codec.Encoded<typeof NonNegativeIntegerSchema> | undefined
}>

const DroppedItemPickupCommitIncompleteFields: {
  readonly _tag: Schema.Literal<'DroppedItemPickupCommitIncomplete'>
  readonly missingOwners: Schema.$Array<typeof ReplicatedOwnerIdSchema>
} = {
  _tag: Schema.Literal('DroppedItemPickupCommitIncomplete'),
  missingOwners: Schema.Array(ReplicatedOwnerIdSchema),
}
export type DroppedItemPickupCommitIncomplete = Schema.Struct.Type<
  typeof DroppedItemPickupCommitIncompleteFields
>
export const DroppedItemPickupCommitIncompleteSchema: Schema.Codec<
  DroppedItemPickupCommitIncomplete,
  unknown
> = strictCodec(Schema.Struct(DroppedItemPickupCommitIncompleteFields))

const DroppedItemPickupFields: {
  readonly actor: typeof EntityIdSchema
  readonly source: typeof EntityIdSchema
  readonly item: Schema.Literals<typeof ITEM_TYPES>
  readonly accepted: typeof DroppedItemStackCountSchema
  readonly event: typeof DomainEventSchema
} = {
  actor: EntityIdSchema,
  source: EntityIdSchema,
  item: Schema.Literals(ITEM_TYPES),
  accepted: DroppedItemStackCountSchema,
  event: DomainEventSchema,
}
export const DroppedItemPickupSchema: Schema.Codec<
  Schema.Struct.Type<typeof DroppedItemPickupFields>,
  unknown
> = strictCodec(Schema.Struct(DroppedItemPickupFields)).check(
  Schema.makeFilter(({ actor, source, item, accepted, event }) =>
    event._tag === 'ItemPickedUp' &&
    event.actor === actor &&
    event.source._tag === 'DroppedItem' &&
    event.source.id === source &&
    event.item === itemIdOf(item) &&
    event.count === accepted &&
    accepted <= maxStackCountForItem(item),
  ),
)

export type DroppedItemPickup = Schema.Struct.Type<typeof DroppedItemPickupFields>

export type DroppedItemPickupResult = ReadonlyArray<DroppedItemPickup>
export const DroppedItemPickupResultSchema: Schema.Codec<
  DroppedItemPickupResult,
  unknown
> = strictCodec(Schema.Array(DroppedItemPickupSchema))

type DroppedItemPickupStorageFailure = Extract<
  AddStoredStackResult,
  { readonly _tag: 'InvalidStack' | 'ItemStackFailure' }
>

export type DroppedItemPickupFailure =
  | Brand.BrandError
  | ItemStackFailure
  | DroppedItemPickupStorageFailure
  | Schema.SchemaError
  | WorldCommitCoordinatorError
  | Schema.Schema.Type<typeof DroppedItemPickupCommitIncompleteSchema>

type PlannedDroppedItemPickup = Readonly<{
  source: Schema.Schema.Type<typeof EntityIdSchema>
  item: ItemType
  countBefore: number
}>

/**
 * Atomically applies a host-owned pickup candidate to replicated player and
 * dropped-item owners. EntityManager integration remains the host's Stage 8 task.
 */
export const pickupDroppedItemsCommitted = (
  coordinator: WorldCommitCoordinatorApi,
  owners: DroppedItemPickupOwners,
  input: DroppedItemPickupRequest,
): Effect.Effect<DroppedItemPickupResult, DroppedItemPickupFailure> =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknownEffect(DroppedItemPickupRequestSchema)(input)
    if (request.position === undefined) {
      return yield* Schema.decodeUnknownEffect(DroppedItemPickupResultSchema)([])
    }

    const playerSnapshot = yield* coordinator.snapshot(
      owners.playerStorage,
      PlayerStorageSnapshotSchema,
    )
    const droppedItemsSnapshot = yield* coordinator.snapshot(
      owners.droppedItems,
      DroppedItemOwnerSnapshotSchema,
    )
    if (playerSnapshot.revision !== droppedItemsSnapshot.revision) {
      return yield* Effect.fail(new WorldRevisionConflict({
        expected: playerSnapshot.revision,
        actual: droppedItemsSnapshot.revision,
      }))
    }

    const radius = request.radius ?? DROPPED_ITEM_PICKUP_RADIUS
    const radiusSquared = radius * radius
    let storage = playerSnapshot.state
    const nextItems: Array<DroppedItemOwnerSnapshot['items'][number]> = []
    const planned: Array<PlannedDroppedItemPickup> = []

    for (const droppedItem of droppedItemsSnapshot.state.items) {
      if (
        (request.currentFrame !== undefined &&
          !isDroppedItemPickupEligible(
            request.currentFrame,
            droppedItem.behaviour.eligibleFromFrame,
          )) ||
        distanceSquared(droppedItem.feetPosition, request.position) > radiusSquared
      ) {
        nextItems.push(droppedItem)
        continue
      }

      const stack = yield* Effect.fromResult(
        itemStack(droppedItem.behaviour.item, droppedItem.behaviour.count),
      )
      const outcome = addStorageStoredStack(storage, {
        ...stack,
        durability: copyDurability(droppedItem.behaviour.durability),
      })
      if (outcome.result._tag !== 'Added') return yield* Effect.fail(outcome.result)
      if (outcome.result.added === 0) {
        nextItems.push(droppedItem)
        continue
      }

      storage = outcome.storage
      planned.push({
        source: droppedItem.id,
        item: droppedItem.behaviour.item,
        countBefore: droppedItem.behaviour.count,
      })
      if (outcome.result.leftover !== null) {
        nextItems.push({
          ...droppedItem,
          behaviour: {
            ...droppedItem.behaviour,
            count: outcome.result.leftover.count,
            durability: copyDurability(outcome.result.leftover.durability),
          },
        })
      }
    }

    if (planned.length === 0) {
      return yield* Schema.decodeUnknownEffect(DroppedItemPickupResultSchema)([])
    }

    const delta = yield* coordinator.commit({
      expectedRevision: playerSnapshot.revision,
      expectedDimensions: [],
      changes: [
        { ownerId: owners.playerStorage, state: storage },
        { ownerId: owners.droppedItems, state: { items: nextItems } },
      ],
    })
    const committedPlayerState = delta.changes.find(({ owner }) => owner === owners.playerStorage)
    const committedDroppedItemsState = delta.changes.find(({ owner }) => owner === owners.droppedItems)
    if (committedPlayerState === undefined || committedDroppedItemsState === undefined) {
      const missingOwners = [
        ...(committedPlayerState === undefined ? [owners.playerStorage] : []),
        ...(committedDroppedItemsState === undefined ? [owners.droppedItems] : []),
      ]
      return yield* Effect.fail(yield* Schema.decodeUnknownEffect(
        DroppedItemPickupCommitIncompleteSchema,
      )({
        _tag: 'DroppedItemPickupCommitIncomplete',
        missingOwners,
      }))
    }

    const committedDroppedItems = yield* Schema.decodeUnknownEffect(
      DroppedItemOwnerSnapshotSchema,
    )(committedDroppedItemsState.state)
    const committedCounts = new Map(
      committedDroppedItems.items.map(({ id, behaviour }) => [id, behaviour.count]),
    )
    const pickups: Array<DroppedItemPickup> = []

    for (const pickup of planned) {
      const acceptedCount = pickup.countBefore - (committedCounts.get(pickup.source) ?? 0)
      const accepted = Result.getOrUndefined(Schema.decodeUnknownResult(DroppedItemStackCountSchema)(acceptedCount))
      if (accepted === undefined) continue
      const event = yield* Schema.decodeUnknownEffect(DomainEventSchema)({
        _tag: 'ItemPickedUp',
        tick: request.tick,
        actor: request.actor,
        source: { _tag: 'DroppedItem', id: pickup.source },
        item: itemIdOf(pickup.item),
        count: accepted,
      })
      pickups.push({
        actor: request.actor,
        source: pickup.source,
        item: pickup.item,
        accepted,
        event,
      })
    }

    return yield* Schema.decodeUnknownEffect(DroppedItemPickupResultSchema)(pickups)
  })

export type DroppedItemMetadata = {
  readonly customName?: string
  readonly enchantedItem?: EnchantedItem
}

/**
 * The anvil-rename and enchantment facts an entity's `behaviour` carries once it
 * passes `isDroppedItemBehaviour`. Re-decoded through `decodeEnchantedItem`
 * rather than read off the trusted fields directly, so an item/durability/
 * enchantment combination this repository's own rules could not have produced
 * (a corrupt save, a hand-edited fixture) surfaces as "no enchantment metadata"
 * instead of a value nothing validated. Absent `enchantments` (never dropped
 * with any) and empty `enchantments` (dropped with zero, known) are different
 * facts: only the latter decodes and appears as `enchantedItem`.
 */
export const droppedItemMetadataFromBehaviour = (behaviour: unknown): DroppedItemMetadata => {
  if (!isDroppedItemBehaviour(behaviour)) return {}
  const enchantedItem = decodeEnchantedItem({
    item: behaviour.item,
    durability: behaviour.durability,
    enchantments: behaviour.enchantments,
  })
  return {
    ...(behaviour.customName === undefined ? {} : { customName: behaviour.customName }),
    ...(enchantedItem.ok ? { enchantedItem: enchantedItem.value } : {}),
  }
}

/** How long a dropped item sits before despawning, absent a beacon or other rule that extends it. */
export const DROPPED_ITEM_LIFETIME_SECS = 300

export type DroppedItemLifetimeTracker = {
  readonly elapsed: (dimension: string, entityId: string) => number
  readonly restore: (
    dimension: string,
    entries: ReadonlyArray<{ readonly entityId: string; readonly elapsedSecs: number }>,
  ) => void
  readonly advance: (
    dimension: string,
    deltaSecs: number,
    entityIds: ReadonlyArray<string>,
  ) => ReadonlyArray<string>
}

/**
 * Per-dimension elapsed-lifetime bookkeeping for dropped items, keyed by entity
 * id rather than carried on `DroppedItemBehaviour` itself: the roster only ever
 * holds the entities currently alive, so `advance` uses the frame's live id set
 * to both age existing entries and drop stale ones (an id that despawned or was
 * picked up by another path) in the same pass — a fact no per-entity field can
 * express on its own.
 */
export const createDroppedItemLifetimeTracker = (
  lifetimeSecs: number = DROPPED_ITEM_LIFETIME_SECS,
): DroppedItemLifetimeTracker => {
  const elapsedByDimension = new Map<string, Map<string, number>>()

  return {
    elapsed: (dimension, entityId) => elapsedByDimension.get(dimension)?.get(entityId) ?? 0,
    restore: (dimension, entries) => {
      elapsedByDimension.set(
        dimension,
        new Map(entries.map(({ entityId, elapsedSecs }) => [entityId, Math.max(0, elapsedSecs)])),
      )
    },
    advance: (dimension, deltaSecs, entityIds) => {
      const elapsedByEntity = elapsedByDimension.get(dimension) ?? new Map<string, number>()
      elapsedByDimension.set(dimension, elapsedByEntity)
      const present = new Set(entityIds)
      for (const entityId of elapsedByEntity.keys()) {
        if (!present.has(entityId)) elapsedByEntity.delete(entityId)
      }

      const expired: string[] = []
      for (const entityId of present) {
        const elapsedSecs = (elapsedByEntity.get(entityId) ?? 0) + deltaSecs
        if (elapsedSecs >= lifetimeSecs) {
          elapsedByEntity.delete(entityId)
          expired.push(entityId)
        } else {
          elapsedByEntity.set(entityId, elapsedSecs)
        }
      }
      return expired
    },
  }
}

/**
 * A dying player's custom names and enchantments, keyed the way the caller's
 * own metadata store keys them: an inventory slot by its index (as a string)
 * and an equipment slot by `equipment:<slot>` — this file makes no claim
 * about that store's shape beyond the two lookups it needs, so it takes them
 * as a plain record rather than importing the store itself.
 */
export type PlayerSlotMetadata = {
  readonly customNames: Readonly<Record<string, string>>
  readonly enchantedItems: Readonly<Record<string, EnchantedItem>>
}

const deathDropMetadataForSlot = (
  key: string,
  item: ItemType,
  metadata: PlayerSlotMetadata | undefined,
): Pick<DroppedItemSpawn, 'customName' | 'enchantments'> => {
  if (metadata === undefined) return {}
  const customName = metadata.customNames[key]
  const enchantedItem = metadata.enchantedItems[key]
  // A metadata entry whose `item` no longer matches is stale (the slot was
  // refilled with something else since the entry was recorded) and is
  // dropped rather than attached to the wrong stack.
  const enchantments = enchantedItem?.item === item
    ? enchantedItem.enchantments.map((enchantment) => ({ ...enchantment }))
    : undefined
  return {
    ...(customName === undefined ? {} : { customName }),
    ...(enchantments === undefined ? {} : { enchantments }),
  }
}

/**
 * Everything a dying player's inventory and equipment spill onto the ground,
 * as spawn requests ready for `spawnDroppedItems` — one per occupied slot,
 * empty slots contributing nothing. `keepInventory` (whether to call this at
 * all) is the caller's game-rule decision, not this rule's.
 */
export const deathDropsFromPlayerStorage = (
  storage: PlayerStorage,
  at: Position,
  metadata?: PlayerSlotMetadata,
): ReadonlyArray<DroppedItemSpawn> => {
  const drops: Array<DroppedItemSpawn> = []

  storage.inventory.slots.forEach((stack, index) => {
    if (stack === undefined) return
    const durability = storage.inventoryDurability[index] ?? null
    drops.push({
      item: stack.item,
      count: stack.count,
      at,
      durability: copyDurability(durability),
      ...deathDropMetadataForSlot(String(index), stack.item, metadata),
    })
  })

  for (const slot of EQUIPMENT_SLOTS) {
    const stack = storage.equipment.slots[slot]
    if (stack === null) continue
    drops.push({
      item: stack.item,
      count: stack.count,
      at,
      durability: copyDurability(stack.durability),
      ...deathDropMetadataForSlot(`equipment:${slot}`, stack.item, metadata),
    })
  }

  return drops
}
