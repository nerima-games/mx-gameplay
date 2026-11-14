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
  type WorldRevision,
} from '@nerima-games/mc-kernel'
import {
  addStoredStack as addStorageStoredStack,
  ContainerStoredStackSchema,
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
  type PlayerStorageFailure,
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
> | EntitySerialExhausted | Schema.SchemaError | Readonly<{
  _tag: 'InvalidDroppedItemSpawnField'
  field: 'durability' | 'eligibleFromFrame' | 'customName' | 'enchantments'
}>

const copyDurability = (durability: Durability | null): Durability | null =>
  durability === null ? null : { ...durability }

export const spawnDroppedItem = (
  roster: EntityManagerApi<MobBehaviour>,
  drop: DroppedItemSpawn,
): Effect.Effect<Entity<MobBehaviour>, DroppedItemSpawnError> => {
  const details = resolveDroppedItemSpawn(drop)
  if (Result.isFailure(details)) return Effect.fail(details.failure)
  const count = Result.getOrUndefined(StackCount.result(drop.count))
  if (count === undefined) return Effect.fail({ _tag: 'InvalidStack' })
  const stackItem = Result.getOrUndefined(itemStack(drop.item, count))
  if (stackItem === undefined) return Effect.fail({ _tag: 'InvalidStack' })
  const stack = { ...stackItem, durability: copyDurability(details.success.durability) }
  const validation = addStorageStoredStack(emptyPlayerStorage(), stack).result
  if (validation._tag !== 'Added') return Effect.fail(validation)

  const behaviour = Schema.decodeUnknownResult(DroppedItemBehaviourSnapshotSchema)({
    _tag: 'DroppedItem',
    item: stack.item,
    count: stack.count,
    durability: stack.durability,
    ...(details.success.eligibleFromFrame === undefined
      ? {}
      : { eligibleFromFrame: details.success.eligibleFromFrame }),
    ...(details.success.customName === undefined ? {} : { customName: details.success.customName }),
    ...(details.success.enchantments === undefined
      ? {}
      : { enchantments: details.success.enchantments }),
  })
  if (Result.isFailure(behaviour)) return Effect.fail(behaviour.failure)

  return roster.spawn({
    kind: DROPPED_ITEM_KIND,
    feetPosition: drop.at,
    healthPoints: EntityHealthPoints(1),
    behaviour: {
      ...behaviour.success,
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

export type DroppedItemPickupRadiusFailure = Readonly<{ _tag: 'InvalidDroppedItemPickupRadius' }>

export function pickupDroppedItems(
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  playerPosition: Position | undefined,
): Effect.Effect<void, DroppedItemPickupRadiusFailure>
export function pickupDroppedItems(
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  playerPosition: Position | undefined,
  radius: number,
  currentFrame?: number,
): Effect.Effect<void, DroppedItemPickupRadiusFailure>
export function pickupDroppedItems(
  roster: EntityManagerApi<MobBehaviour>,
  inventory: InventoryServiceApi,
  playerPosition: Position | undefined,
  radius?: number,
  currentFrame?: number,
): Effect.Effect<void, DroppedItemPickupRadiusFailure> {
  const pickupRadius = arguments.length < 4 ? DROPPED_ITEM_PICKUP_RADIUS : radius
  return pickupLockFor(roster).withPermits(1)(
    Effect.gen(function* () {
      if (pickupRadius === undefined || !Number.isFinite(pickupRadius) || pickupRadius < 0) {
        return yield* Effect.fail({ _tag: 'InvalidDroppedItemPickupRadius' })
      }
      if (playerPosition === undefined) return

      const leftovers = new Map<
        string,
        { readonly count: number; readonly durability: Durability | null } | null
      >()
      const radiusSquared = pickupRadius * pickupRadius
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
}

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
type AddedStoredStackResult = Extract<AddStoredStackResult, { readonly _tag: 'Added' }>
const AddedStoredStackResultSchema: Schema.Codec<AddedStoredStackResult, unknown> = strictCodec(
  Schema.Struct({
    _tag: Schema.Literal('Added'),
    added: NonNegativeIntegerSchema,
    leftover: Schema.NullOr(ContainerStoredStackSchema),
  }),
)

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

type ResolvedDroppedItemSpawn = Readonly<{
  durability: Durability | null
  eligibleFromFrame?: number
  customName?: string
  enchantments?: ReadonlyArray<Enchantment>
}>

const resolveDroppedItemSpawn = (
  drop: DroppedItemSpawn,
): Result.Result<ResolvedDroppedItemSpawn, DroppedItemSpawnError> => {
  if (Object.hasOwn(drop, 'durability') && drop.durability === undefined) {
    return Result.fail({ _tag: 'InvalidDroppedItemSpawnField', field: 'durability' })
  }
  if (Object.hasOwn(drop, 'eligibleFromFrame') && drop.eligibleFromFrame === undefined) {
    return Result.fail({ _tag: 'InvalidDroppedItemSpawnField', field: 'eligibleFromFrame' })
  }
  if (Object.hasOwn(drop, 'customName') && drop.customName === undefined) {
    return Result.fail({ _tag: 'InvalidDroppedItemSpawnField', field: 'customName' })
  }
  if (Object.hasOwn(drop, 'enchantments') && drop.enchantments === undefined) {
    return Result.fail({ _tag: 'InvalidDroppedItemSpawnField', field: 'enchantments' })
  }

  const durability = Object.hasOwn(drop, 'durability')
    ? drop.durability
    : durabilityForItem(drop.item)
  if (durability === undefined) {
    return Result.fail({ _tag: 'InvalidDroppedItemSpawnField', field: 'durability' })
  }
  const decodedDurability = Schema.decodeUnknownResult(Schema.NullOr(DurabilitySchema))(durability)
  if (Result.isFailure(decodedDurability)) return Result.fail(decodedDurability.failure)

  if (Object.hasOwn(drop, 'eligibleFromFrame')) {
    const decoded = Schema.decodeUnknownResult(NonNegativeIntegerSchema)(drop.eligibleFromFrame)
    if (Result.isFailure(decoded)) return Result.fail(decoded.failure)
  }
  if (Object.hasOwn(drop, 'customName')) {
    const decoded = Schema.decodeUnknownResult(Schema.String)(drop.customName)
    if (Result.isFailure(decoded)) return Result.fail(decoded.failure)
  }
  if (Object.hasOwn(drop, 'enchantments')) {
    const decoded = Schema.decodeUnknownResult(Schema.Array(DroppedItemEnchantmentSchema))(drop.enchantments)
    if (Result.isFailure(decoded)) return Result.fail(decoded.failure)
  }

  return Result.succeed({
    durability: decodedDurability.success,
    ...(Object.hasOwn(drop, 'eligibleFromFrame') && drop.eligibleFromFrame !== undefined
      ? { eligibleFromFrame: drop.eligibleFromFrame }
      : {}),
    ...(Object.hasOwn(drop, 'customName') && drop.customName !== undefined
      ? { customName: drop.customName }
      : {}),
    ...(Object.hasOwn(drop, 'enchantments') && drop.enchantments !== undefined
      ? { enchantments: drop.enchantments.map((enchantment) => ({ ...enchantment })) }
      : {}),
  })
}

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
  expectedRevision: WorldRevision,
): Result.Result<DroppedItemOwnerSnapshot, Schema.SchemaError | DroppedItemSpawnError> => {
  const items = [...snapshot.items]
  const ids = new Set(items.map(({ id }) => id))
  let serial = 0

  for (const drop of drops) {
    const details = resolveDroppedItemSpawn(drop)
    if (Result.isFailure(details)) return Result.fail(details.failure)
    const requested = StackCount.result(drop.count)
    if (Result.isFailure(requested)) return Result.fail({ _tag: 'InvalidStack' })
    let remaining: number = requested.success
    while (remaining > 0) {
      const count = Math.min(maxStackCountForItem(drop.item), remaining)
      // Kernel item stack limits are 1, 16, or 64, so this is always a valid StackCount.
      const stackCount = StackCount(count)
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
          count: stackCount,
          durability: copyDurability(details.success.durability),
          ...(details.success.eligibleFromFrame === undefined
            ? {}
            : { eligibleFromFrame: details.success.eligibleFromFrame }),
          ...(details.success.customName === undefined ? {} : { customName: details.success.customName }),
          ...(details.success.enchantments === undefined
            ? {}
            : { enchantments: details.success.enchantments }),
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

export type DroppedItemPickupFailure =
  | Brand.BrandError
  | ItemStackFailure
  | Schema.SchemaError
  | WorldCommitCoordinatorError
  | DroppedItemPickupRadiusFailure
  | Readonly<{
      _tag: 'InvalidDroppedItemPickupField'
      field: 'position' | 'currentFrame'
    }>
  | Schema.Schema.Type<typeof DroppedItemPickupCommitIncompleteSchema>

export type PlannedDroppedItemPickup = Readonly<{
  source: Schema.Schema.Type<typeof EntityIdSchema>
  item: ItemType
  countBefore: number
}>

export type DroppedItemPickupPlan = Readonly<{
  request: Schema.Schema.Type<typeof DroppedItemPickupRequestSchema>
  playerStorage: PlayerStorage
  droppedItems: DroppedItemOwnerSnapshot
  planned: ReadonlyArray<PlannedDroppedItemPickup>
}>

/**
 * Builds an owner candidate without committing it. The stage owns the snapshot
 * and atomic commit boundary.
 */
export const planDroppedItemPickup = (
  input: DroppedItemPickupRequest,
  playerStorage: PlayerStorage,
  droppedItems: DroppedItemOwnerSnapshot,
): Effect.Effect<DroppedItemPickupPlan, DroppedItemPickupFailure> =>
  Effect.gen(function* () {
    if (Object.hasOwn(input, 'position') && input.position === undefined) {
      return yield* Effect.fail({ _tag: 'InvalidDroppedItemPickupField', field: 'position' })
    }
    if (Object.hasOwn(input, 'currentFrame') && input.currentFrame === undefined) {
      return yield* Effect.fail({ _tag: 'InvalidDroppedItemPickupField', field: 'currentFrame' })
    }
    if (Object.hasOwn(input, 'radius') && input.radius === undefined) {
      return yield* Effect.fail({ _tag: 'InvalidDroppedItemPickupRadius' })
    }
    const request = yield* Schema.decodeUnknownEffect(DroppedItemPickupRequestSchema)(input)
    if (request.position === undefined) {
      return {
        request,
        playerStorage,
        droppedItems,
        planned: [],
      }
    }

    const radius = Object.hasOwn(input, 'radius')
      ? request.radius
      : DROPPED_ITEM_PICKUP_RADIUS
    if (radius === undefined) return yield* Effect.fail({ _tag: 'InvalidDroppedItemPickupRadius' })
    const radiusSquared = radius * radius
    let storage = playerStorage
    const nextItems: Array<DroppedItemOwnerSnapshot['items'][number]> = []
    const planned: Array<PlannedDroppedItemPickup> = []

    for (const droppedItem of droppedItems.items) {
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
      const result = yield* Schema.decodeUnknownEffect(AddedStoredStackResultSchema)(outcome.result)
      if (result.added === 0) {
        nextItems.push(droppedItem)
        continue
      }

      storage = outcome.storage
      planned.push({
        source: droppedItem.id,
        item: droppedItem.behaviour.item,
        countBefore: droppedItem.behaviour.count,
      })
      if (result.leftover !== null) {
        nextItems.push({
          ...droppedItem,
          behaviour: {
            ...droppedItem.behaviour,
            count: result.leftover.count,
            durability: copyDurability(result.leftover.durability),
          },
        })
      }
    }

    const candidate = yield* Schema.decodeUnknownEffect(DroppedItemOwnerSnapshotSchema)({
      items: nextItems,
    })
    const decodedStorage = yield* Schema.decodeUnknownEffect(PlayerStorageSnapshotSchema)(storage)
    return {
      request,
      playerStorage: decodedStorage,
      droppedItems: candidate,
      planned,
    }
  })

export const droppedItemPickupResultAfterCommit = (
  plan: DroppedItemPickupPlan,
  committedDroppedItems: DroppedItemOwnerSnapshot,
): Effect.Effect<DroppedItemPickupResult, DroppedItemPickupFailure> =>
  Effect.gen(function* () {
    const committedCounts = new Map(
      committedDroppedItems.items.map(({ id, behaviour }) => [id, behaviour.count]),
    )
    const pickups: Array<DroppedItemPickup> = []
    for (const pickup of plan.planned) {
      const committedCount = committedCounts.get(pickup.source)
      // A missing committed source means the full stack was consumed.
      const acceptedCount = pickup.countBefore - (committedCount === undefined ? 0 : committedCount)
      const accepted = Result.getOrUndefined(
        Schema.decodeUnknownResult(DroppedItemStackCountSchema)(acceptedCount),
      )
      if (accepted === undefined) continue
      const event = yield* Schema.decodeUnknownEffect(DomainEventSchema)({
        _tag: 'ItemPickedUp',
        tick: plan.request.tick,
        actor: plan.request.actor,
        source: { _tag: 'DroppedItem', id: pickup.source },
        item: itemIdOf(pickup.item),
        count: accepted,
      })
      pickups.push({
        actor: plan.request.actor,
        source: pickup.source,
        item: pickup.item,
        accepted,
        event,
      })
    }
    return yield* Schema.decodeUnknownEffect(DroppedItemPickupResultSchema)(pickups)
  })

/** Convenience adapter for domain callers that own the WCC boundary themselves. */
export const pickupDroppedItemsCommitted = (
  coordinator: WorldCommitCoordinatorApi,
  owners: DroppedItemPickupOwners,
  input: DroppedItemPickupRequest,
): Effect.Effect<DroppedItemPickupResult, DroppedItemPickupFailure> =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknownEffect(DroppedItemPickupRequestSchema)(input)
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
    const plan = yield* planDroppedItemPickup(
      request,
      playerSnapshot.state,
      droppedItemsSnapshot.state,
    )
    if (plan.planned.length === 0) {
      return yield* Schema.decodeUnknownEffect(DroppedItemPickupResultSchema)([])
    }
    const delta = yield* coordinator.commit({
      expectedRevision: playerSnapshot.revision,
      expectedDimensions: [],
      changes: [
        { ownerId: owners.playerStorage, state: plan.playerStorage },
        { ownerId: owners.droppedItems, state: plan.droppedItems },
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
    return yield* droppedItemPickupResultAfterCommit(plan, committedDroppedItems)
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
  ) => Result.Result<void, DroppedItemLifetimeFailure>
  readonly advance: (
    dimension: string,
    deltaSecs: number,
    entityIds: ReadonlyArray<string>,
  ) => Result.Result<ReadonlyArray<string>, DroppedItemLifetimeFailure>
}

export type DroppedItemLifetimeFailure = Readonly<{
  _tag: 'InvalidDroppedItemLifetimeInput'
  field: 'lifetimeSecs' | 'elapsedSecs' | 'deltaSecs' | 'entityIds'
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Per-dimension elapsed-lifetime bookkeeping for dropped items, keyed by entity
 * id rather than carried on `DroppedItemBehaviour` itself: the roster only ever
 * holds the entities currently alive, so `advance` uses the frame's live id set
 * to both age existing entries and drop stale ones (an id that despawned or was
 * picked up by another path) in the same pass — a fact no per-entity field can
 * express on its own.
 */
export function createDroppedItemLifetimeTracker(): DroppedItemLifetimeTracker
export function createDroppedItemLifetimeTracker(lifetimeSecs: number): Result.Result<
  DroppedItemLifetimeTracker,
  DroppedItemLifetimeFailure
>
export function createDroppedItemLifetimeTracker(
  lifetimeSecs?: number,
): DroppedItemLifetimeTracker | Result.Result<DroppedItemLifetimeTracker, DroppedItemLifetimeFailure> {
  const suppliedLifetime = arguments.length > 0
  const resolvedLifetime = suppliedLifetime ? lifetimeSecs : DROPPED_ITEM_LIFETIME_SECS
  if (
    resolvedLifetime === undefined ||
    !Number.isFinite(resolvedLifetime) ||
    resolvedLifetime < 0
  ) return Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'lifetimeSecs' })
  const lifetime = resolvedLifetime

  const elapsedByDimension = new Map<string, Map<string, number>>()

  const tracker: DroppedItemLifetimeTracker = {
    elapsed: (dimension, entityId) => {
      const elapsedByEntity = elapsedByDimension.get(dimension)
      if (elapsedByEntity === undefined) return 0
      const elapsedSecs = elapsedByEntity.get(entityId)
      return elapsedSecs === undefined ? 0 : elapsedSecs
    },
    restore: (dimension, entries) => {
      if (!Array.isArray(entries)) {
        return Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'elapsedSecs' })
      }
      const restored = new Map<string, number>()
      for (const entry of entries) {
        if (
          !isRecord(entry) ||
          !Object.hasOwn(entry, 'entityId') ||
          !Object.hasOwn(entry, 'elapsedSecs') ||
          typeof entry.entityId !== 'string' ||
          !Number.isFinite(entry.elapsedSecs) ||
          entry.elapsedSecs < 0
        ) return Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'elapsedSecs' })
        restored.set(entry.entityId, entry.elapsedSecs)
      }
      elapsedByDimension.set(dimension, restored)
      return Result.succeed(undefined)
    },
    advance: (dimension, deltaSecs, entityIds) => {
      if (!Number.isFinite(deltaSecs) || deltaSecs < 0) {
        return Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'deltaSecs' })
      }
      if (!Array.isArray(entityIds) || entityIds.some((entityId) => typeof entityId !== 'string')) {
        return Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'entityIds' })
      }
      const elapsedByEntity = elapsedByDimension.get(dimension)
      const present = new Set(entityIds)
      const next = new Map<string, number>()
      const expired: string[] = []
      for (const entityId of present) {
        const previous = elapsedByEntity?.get(entityId)
        const elapsedSecs = (previous === undefined ? 0 : previous) + deltaSecs
        if (!Number.isFinite(elapsedSecs)) {
          return Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'deltaSecs' })
        }
        if (elapsedSecs >= lifetime) {
          expired.push(entityId)
        } else {
          next.set(entityId, elapsedSecs)
        }
      }
      elapsedByDimension.set(dimension, next)
      return Result.succeed(expired)
    },
  }
  return suppliedLifetime ? Result.succeed(tracker) : tracker
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
): Result.Result<
  Pick<DroppedItemSpawn, 'customName' | 'enchantments'>,
  DeathDropsFromPlayerStorageFailure
> => {
  if (metadata === undefined) return Result.succeed({})
  if (
    !isRecord(metadata) ||
    !isRecord(metadata.customNames) ||
    !isRecord(metadata.enchantedItems)
  ) return Result.fail({ _tag: 'InvalidPlayerSlotMetadata', field: 'metadata' })

  const hasCustomName = Object.hasOwn(metadata.customNames, key)
  const customName = metadata.customNames[key]
  if (hasCustomName && typeof customName !== 'string') {
    return Result.fail({ _tag: 'InvalidPlayerSlotMetadata', field: 'customName' })
  }
  const hasEnchantedItem = Object.hasOwn(metadata.enchantedItems, key)
  const enchantedItem = metadata.enchantedItems[key]
  if (hasEnchantedItem && enchantedItem === undefined) {
    return Result.fail({ _tag: 'InvalidPlayerSlotMetadata', field: 'enchantedItem' })
  }
  // A metadata entry whose `item` no longer matches is stale (the slot was
  // refilled with something else since the entry was recorded) and is
  // dropped rather than attached to the wrong stack.
  const decodedEnchantedItem = hasEnchantedItem ? decodeEnchantedItem(enchantedItem) : undefined
  if (decodedEnchantedItem !== undefined && !decodedEnchantedItem.ok) {
    return Result.fail({ _tag: 'InvalidPlayerSlotMetadata', field: 'enchantedItem' })
  }
  const enchantments = decodedEnchantedItem?.ok === true && decodedEnchantedItem.value.item === item
    ? decodedEnchantedItem.value.enchantments.map((enchantment) => ({ ...enchantment }))
    : undefined
  return Result.succeed({
    ...(customName === undefined ? {} : { customName }),
    ...(enchantments === undefined ? {} : { enchantments }),
  })
}

/**
 * Everything a dying player's inventory and equipment spill onto the ground,
 * as spawn requests ready for `spawnDroppedItems` — one per occupied slot,
 * empty slots contributing nothing. `keepInventory` (whether to call this at
 * all) is the caller's game-rule decision, not this rule's.
 */
export type DeathDropsFromPlayerStorageFailure = Extract<
  PlayerStorageFailure,
  { readonly _tag: 'InvalidInventoryDurability' }
> | Readonly<{
  _tag: 'InvalidPlayerSlotMetadata'
  field: 'metadata' | 'customName' | 'enchantedItem'
}>

export const deathDropsFromPlayerStorage = (
  storage: PlayerStorage,
  at: Position,
  metadata?: PlayerSlotMetadata,
): Result.Result<ReadonlyArray<DroppedItemSpawn>, DeathDropsFromPlayerStorageFailure> => {
  const drops: Array<DroppedItemSpawn> = []

  for (const [index, stack] of storage.inventory.slots.entries()) {
    if (stack === undefined) continue
    const durability = storage.inventoryDurability[index]
    if (durability === undefined) {
      return Result.fail({ _tag: 'InvalidInventoryDurability', slotIndex: index, item: stack.item })
    }
    const metadataForDrop = deathDropMetadataForSlot(String(index), stack.item, metadata)
    if (Result.isFailure(metadataForDrop)) return Result.fail(metadataForDrop.failure)
    drops.push({
      item: stack.item,
      count: stack.count,
      at,
      durability: copyDurability(durability),
      ...metadataForDrop.success,
    })
  }

  for (const slot of EQUIPMENT_SLOTS) {
    const stack = storage.equipment.slots[slot]
    if (stack === null) continue
    const metadataForDrop = deathDropMetadataForSlot(`equipment:${slot}`, stack.item, metadata)
    if (Result.isFailure(metadataForDrop)) return Result.fail(metadataForDrop.failure)
    drops.push({
      item: stack.item,
      count: stack.count,
      at,
      durability: copyDurability(stack.durability),
      ...metadataForDrop.success,
    })
  }

  return Result.succeed(drops)
}
