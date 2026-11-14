import {
  PLAYER_REPLICATED_OWNER_ID,
  CropSnapshotSchema,
  PlayerServiceSnapshotSchema,
  BrewingServiceStateSchema,
  INITIAL_PROJECTILE_SERVICE_SNAPSHOT,
  PROJECTILE_REPLICATED_OWNER_ID,
  ProjectileServiceSnapshotSchema,
  TNT_REPLICATED_OWNER_ID,
  INITIAL_TNT_SERVICE_SNAPSHOT,
  tntOwnerRegistration,
  EntityRosterSchema,
  EntitySchema,
  EntitySerial,
  emptyBrewingState,
  emptyFishingState,
  emptyPlayerStorage,
  fishingOwnerRegistration,
  makeReplicatedOwnerId,
  playerStorageOwnerRegistration,
  SPAWN_VITALS,
  type CropSnapshot,
  type BrewingState,
  type EntityRoster,
  type FishingState,
  type PlayerStorage,
  type ProjectileServiceSnapshot,
  type TntServiceSnapshot,
  type ReplicatedOwnerId,
  type ReplicatedOwnerRegistration,
  type Vitals,
} from '@nerima-games/mc-sim'
import { Schema, SchemaParser } from 'effect'
import { Result } from 'effect'
import {
  DimensionIdSchema,
  EntityIdSchema,
  ProjectileIdSchema,
  WorldPositionSchema,
  ITEM_TYPES,
  SimulationTickSchema,
  type Dimension,
  type EntityId,
  type ProjectileId,
} from '@nerima-games/mc-kernel'
import {
  droppedItemOwnerRegistration,
  type DroppedItemOwnerSnapshot,
} from '../domain/entities/dropped-item.js'
import {
  experienceOrbOwnerRegistration,
  vitalsOwnerRegistration,
  type ExperienceOrbOwnerSnapshot,
} from '../domain/entities/xp-orb.js'
import { INITIAL_DIMENSION, INITIAL_PLAYER_POSE } from '../domain/in-memory-player.js'

import type { PlayerPose } from '@nerima-games/mc-sim'
import {
  isValidVillagerTradeState,
  type VillagerTradeState,
} from '../domain/villager-trade.js'
import {
  emptyStatusEffectState,
  StatusEffectStateSchema,
  type StatusEffectState,
} from '../domain/status-effect.js'
import {
  isDroppedItemBehaviour,
  isHostileMobSnapshot,
  isMobBehaviourRepairFault,
  type MobBehaviour,
  type MobEntity,
  type MobKillCredit,
  type MobProjectilePendingImpact,
  type MobRoster,
} from '../domain/entities/mob-frame.js'
import { BLAZE_KIND, SKELETON_KIND, repairEcosystemMobState } from '../domain/mob/mob-ecosystem.js'
import { isPrimedTnt } from '../domain/mob/primed-tnt.js'

export const GAMEPLAY_PLAYER_STORAGE_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-player-storage')
export const GAMEPLAY_CROPS_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-crops')
export const GAMEPLAY_PLAYER_OWNER_ID: ReplicatedOwnerId = PLAYER_REPLICATED_OWNER_ID
export const GAMEPLAY_DROPPED_ITEMS_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-dropped-items')
export const GAMEPLAY_VITALS_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-vitals')
export const GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-experience-orbs')
export const GAMEPLAY_BREWING_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-brewing')
export const GAMEPLAY_VILLAGER_TRADES_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-villager-trades')
export const GAMEPLAY_FISHING_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-fishing')
export const GAMEPLAY_ENTITIES_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-entities')
export const GAMEPLAY_TNT_SOURCES_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-tnt-sources')
export const GAMEPLAY_STATUS_EFFECTS_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('mx-gameplay-status-effects')

const strictCodec = <A, I>(schema: Schema.Codec<A, I>): Schema.Codec<A, I> =>
  Schema.declareConstructor<A, I>()([schema], ([inner]) =>
    (input, _ast, options) =>
      SchemaParser.decodeUnknownEffect(inner)(input, {
        ...options,
        onExcessProperty: 'error',
      }),
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: unknown, allowed: ReadonlyArray<string>): boolean =>
  isRecord(value) && Object.keys(value).every((key) => allowed.includes(key))

const isCreeperFuse = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  if (value['_tag'] === 'Dormant' || value['_tag'] === 'Detonated') {
    return hasOnlyKeys(value, ['_tag'])
  }
  return value['_tag'] === 'Lit' &&
    hasOnlyKeys(value, ['_tag', 'burnedSecs']) &&
    typeof value['burnedSecs'] === 'number' &&
    Number.isFinite(value['burnedSecs']) &&
    value['burnedSecs'] >= 0
}

const isEndermanFlinch = (value: unknown): boolean =>
  isRecord(value) &&
    hasOnlyKeys(value, ['_tag']) &&
    (value['_tag'] === 'Steady' || value['_tag'] === 'Struck')

const isEcosystemState = (value: unknown): boolean => {
  if (!isRecord(value) || value['_tag'] !== 'EcosystemMob') return false
  const ecosystemKeys = [
    '_tag', 'attackCooldownTicks', 'attackCooldownSecs', 'motionPhase', 'provoked',
    'movementGoal', 'movement', 'hasHeadProtection', 'burningTicks',
  ]
  const repaired = repairEcosystemMobState(value)
  return hasOnlyKeys(value, ecosystemKeys) && Result.isSuccess(repaired) && repaired.success !== undefined
}

const isStrictDroppedItem = (value: unknown): boolean => {
  if (!isDroppedItemBehaviour(value) || !hasOnlyKeys(value, [
    '_tag', 'item', 'count', 'durability', 'eligibleFromFrame', 'customName', 'enchantments',
  ])) return false
  return value.enchantments === undefined || value.enchantments.every((enchantment) =>
    hasOnlyKeys(enchantment, ['id', 'level']),
  )
}

const isMobBehaviour = (value: unknown): value is MobBehaviour => {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  if (value['_tag'] === 'MobBehaviourRepairFault') {
    return isMobBehaviourRepairFault(value) && hasOnlyKeys(value, ['_tag', 'failure'])
  }
  if (value['_tag'] === 'HostileMob') {
    return isHostileMobSnapshot(value) &&
      hasOnlyKeys(value, ['_tag', 'behaviour', 'movement', 'ageTicks', 'persistent', 'named', 'tamed']) &&
      (value['behaviour'] === undefined ||
        isCreeperFuse(value['behaviour']) ||
        isEndermanFlinch(value['behaviour']) ||
        isEcosystemState(value['behaviour']))
  }
  if (value['_tag'] === 'PrimedTnt') {
    return isPrimedTnt(value) && hasOnlyKeys(value, ['_tag', 'burnedSecs'])
  }
  return isCreeperFuse(value) || isEndermanFlinch(value) || isEcosystemState(value) || isStrictDroppedItem(value)
}

export const GameplayMobBehaviourSchema: Schema.Codec<MobBehaviour, unknown> =
  Schema.declare<MobBehaviour>(isMobBehaviour)

export type GameplayEntity = MobEntity & Readonly<{ dimension: Dimension }>
export type GameplayEntityRoster = Omit<EntityRoster<MobBehaviour>, 'entities'> & Readonly<{
  entities: ReadonlyArray<GameplayEntity>
  resolvedMobProjectileIds?: ReadonlyArray<ProjectileId>
  pendingMobProjectileImpacts?: ReadonlyArray<MobProjectilePendingImpact>
}>

export type GameplayEntityMetadataFailure = Readonly<{
  _tag: 'InvalidGameplayEntityMetadata'
  field:
    | 'entities'
    | 'resolvedMobProjectileIds'
    | 'pendingMobProjectileImpacts'
    | 'dimension'
    | 'killCredit'
    | 'lastHitTick'
}> | Readonly<{
  _tag: 'InvalidGameplayEntityRoster'
  error: Schema.SchemaError
}>

const GameplayMobEntityBaseSchema = EntitySchema(GameplayMobBehaviourSchema)
const GameplayMobRosterBaseSchema = EntityRosterSchema(GameplayMobBehaviourSchema)

export const GameplayEntityRosterSchema: Schema.Codec<GameplayEntityRoster, unknown> = strictCodec(
  Schema.Struct({
    entities: Schema.Array(Schema.Struct({
      ...GameplayMobEntityBaseSchema.fields,
      dimension: DimensionIdSchema,
      killCredit: Schema.optionalKey(Schema.Literals(['player', 'player-triggered-tnt'])),
      lastHitTick: Schema.optionalKey(SimulationTickSchema),
    })),
    nextSerial: GameplayMobRosterBaseSchema.fields.nextSerial,
    resolvedMobProjectileIds: Schema.optionalKey(Schema.Array(ProjectileIdSchema)),
    pendingMobProjectileImpacts: Schema.optionalKey(Schema.Array(Schema.Struct({
      id: ProjectileIdSchema,
      source: EntityIdSchema,
      kind: Schema.Literals([SKELETON_KIND, BLAZE_KIND]),
      hit: Schema.Union([
        Schema.Struct({
          kind: Schema.Literals(['entity']),
          entityId: EntityIdSchema,
          point: WorldPositionSchema,
        }),
        Schema.Struct({
          kind: Schema.Literals(['block']),
          point: WorldPositionSchema,
        }),
      ]),
    }))),
  }),
)

export const restoreGameplayEntityMetadata = (
  roster: MobRoster & Readonly<{
    resolvedMobProjectileIds?: ReadonlyArray<ProjectileId>
    pendingMobProjectileImpacts?: ReadonlyArray<MobProjectilePendingImpact>
  }>,
  previous: MobRoster & Readonly<{
    resolvedMobProjectileIds?: ReadonlyArray<ProjectileId>
    pendingMobProjectileImpacts?: ReadonlyArray<MobProjectilePendingImpact>
  }>,
  fallbackDimension: Dimension,
): Result.Result<GameplayEntityRoster, GameplayEntityMetadataFailure> => {
  const optionalFields = [
    'resolvedMobProjectileIds',
    'pendingMobProjectileImpacts',
  ] as const
  for (const value of [roster, previous]) {
    if (!isRecord(value) || !Array.isArray(value.entities)) {
      return Result.fail({ _tag: 'InvalidGameplayEntityMetadata', field: 'entities' })
    }
    for (const field of optionalFields) {
      if (Object.hasOwn(value, field) && value[field] === undefined) {
        return Result.fail({ _tag: 'InvalidGameplayEntityMetadata', field })
      }
    }
    for (const entity of value.entities) {
      if (!isRecord(entity)) {
        return Result.fail({ _tag: 'InvalidGameplayEntityMetadata', field: 'entities' })
      }
      for (const field of ['dimension', 'killCredit', 'lastHitTick'] as const) {
        if (Object.hasOwn(entity, field) && entity[field] === undefined) {
          return Result.fail({ _tag: 'InvalidGameplayEntityMetadata', field })
        }
      }
    }
  }
  const previousById = new Map(previous.entities.map((entity) => [entity.id, entity]))
  const resolvedMobProjectileIds = Object.hasOwn(roster, 'resolvedMobProjectileIds')
    ? roster.resolvedMobProjectileIds
    : Object.hasOwn(previous, 'resolvedMobProjectileIds')
    ? previous.resolvedMobProjectileIds
    : undefined
  const pendingMobProjectileImpacts = Object.hasOwn(roster, 'pendingMobProjectileImpacts')
    ? roster.pendingMobProjectileImpacts
    : Object.hasOwn(previous, 'pendingMobProjectileImpacts')
    ? previous.pendingMobProjectileImpacts
    : undefined
  const decoded = Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
    ...roster,
    ...(resolvedMobProjectileIds === undefined ? {} : { resolvedMobProjectileIds }),
    ...(pendingMobProjectileImpacts === undefined ? {} : { pendingMobProjectileImpacts }),
    entities: roster.entities.map((entity) => {
      const prior = previousById.get(entity.id)
      let dimension = fallbackDimension
      if (Object.hasOwn(entity, 'dimension')) dimension = entity.dimension!
      else if (prior !== undefined && Object.hasOwn(prior, 'dimension')) dimension = prior.dimension!
      const killCredit = Object.hasOwn(entity, 'killCredit')
        ? entity.killCredit
        : prior !== undefined && Object.hasOwn(prior, 'killCredit')
        ? prior.killCredit
        : undefined
      const lastHitTick = Object.hasOwn(entity, 'lastHitTick')
        ? entity.lastHitTick
        : prior !== undefined && Object.hasOwn(prior, 'lastHitTick')
        ? prior.lastHitTick
        : undefined
      return {
        ...entity,
        dimension,
        ...(killCredit === undefined ? {} : { killCredit }),
        ...(lastHitTick === undefined ? {} : { lastHitTick }),
      }
    }),
  })
  return Result.isFailure(decoded)
    ? Result.fail({ _tag: 'InvalidGameplayEntityRoster', error: decoded.failure })
    : Result.succeed(decoded.success)
}

export type GameplayTntSource = Readonly<{
  tntId: EntityId
  killCredit: Extract<MobKillCredit, 'player-triggered-tnt'>
}>
export type GameplayTntSourcesSnapshot = Readonly<{
  sources: ReadonlyArray<GameplayTntSource>
}>
export const GameplayTntSourcesSnapshotSchema: Schema.Codec<GameplayTntSourcesSnapshot, unknown> =
  strictCodec(Schema.Struct({
    sources: Schema.Array(Schema.Struct({
      tntId: EntityIdSchema,
      killCredit: Schema.Literals(['player-triggered-tnt']),
    })),
  }))

const positiveCount: Schema.Codec<number, number> = Schema.Int.check(Schema.isGreaterThan(0))

export const GameplayVillagerTradeSnapshotSchema: Schema.Codec<VillagerTradeState, unknown> = Schema.Struct({
  villagers: Schema.Array(Schema.Struct({
    id: Schema.String,
    profession: Schema.Literals(['farmer', 'toolsmith']),
    offers: Schema.Array(Schema.Struct({
      id: Schema.String,
      input: Schema.Struct({ item: Schema.Literals(ITEM_TYPES), count: positiveCount }),
      output: Schema.Struct({ item: Schema.Literals(ITEM_TYPES), count: positiveCount }),
      uses: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      maxUses: positiveCount,
    })),
  })),
  restockElapsedSecs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
}).check(Schema.makeFilter((state) => isValidVillagerTradeState(state)))

export type GameplayOwnerInitialState = Readonly<{
  playerPose?: PlayerPose
  dimension?: Dimension
  playerStorage?: PlayerStorage
  crops?: CropSnapshot
  droppedItems?: DroppedItemOwnerSnapshot
  vitals?: Vitals
  experienceOrbs?: ExperienceOrbOwnerSnapshot
  brewing?: BrewingState
  villagerTrades?: VillagerTradeState
  fishing?: FishingState
  entities?: MobRoster
  tntSources?: GameplayTntSourcesSnapshot
  statusEffects?: StatusEffectState
  projectiles?: ProjectileServiceSnapshot
  tnt?: TntServiceSnapshot
}>

const playerOwnerState = (
  pose: PlayerPose,
  dimension: Dimension,
) => Schema.decodeUnknownSync(PlayerServiceSnapshotSchema)({
  pose: {
    feetPosition: { dimension, ...pose.feetPosition },
    yawRadians: pose.yawRadians,
    pitchRadians: pose.pitchRadians,
  },
})

export type GameplayOwnerRegistrationFailure =
  | Readonly<{
      _tag: 'ExplicitUndefinedGameplayOwnerInitialState'
      field: keyof GameplayOwnerInitialState | 'initial'
    }>
  | Readonly<{
      _tag: 'InvalidGameplayOwnerInitialState'
      field: keyof GameplayOwnerInitialState | 'initial'
    }>
  | GameplayEntityMetadataFailure
  | Readonly<{
      _tag: 'InvalidGameplayOwnerRegistration'
      ownerId: ReplicatedOwnerId
      error: Schema.SchemaError
    }>

type PlayerOwnerState = Schema.Schema.Type<typeof PlayerServiceSnapshotSchema>

const ownerInitialValue = <K extends keyof GameplayOwnerInitialState>(
  initial: GameplayOwnerInitialState,
  field: K,
  fallback: NonNullable<GameplayOwnerInitialState[K]>,
): NonNullable<GameplayOwnerInitialState[K]> =>
  Object.hasOwn(initial, field)
    ? initial[field] as NonNullable<GameplayOwnerInitialState[K]>
    : fallback

const gameplayOwnerRegistrationValues = (
  initial: GameplayOwnerInitialState,
  playerState: PlayerOwnerState,
  entityState: GameplayEntityRoster,
): ReadonlyArray<ReplicatedOwnerRegistration> => [
  {
    ownerId: GAMEPLAY_PLAYER_OWNER_ID,
    schema: PlayerServiceSnapshotSchema,
    initialState: playerState,
  },
  playerStorageOwnerRegistration(
    GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    ownerInitialValue(initial, 'playerStorage', emptyPlayerStorage()),
  ),
  {
    ownerId: GAMEPLAY_CROPS_OWNER_ID,
    schema: CropSnapshotSchema,
    initialState: ownerInitialValue(initial, 'crops', { crops: [] }),
  },
  droppedItemOwnerRegistration(
    GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    ownerInitialValue(initial, 'droppedItems', { items: [] }),
  ),
  vitalsOwnerRegistration(
    GAMEPLAY_VITALS_OWNER_ID,
    { vitals: ownerInitialValue(initial, 'vitals', SPAWN_VITALS) },
  ),
  experienceOrbOwnerRegistration(
    GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
    ownerInitialValue(initial, 'experienceOrbs', { orbs: [] }),
  ),
  {
    ownerId: GAMEPLAY_BREWING_OWNER_ID,
    schema: BrewingServiceStateSchema,
    initialState: ownerInitialValue(initial, 'brewing', Result.getOrThrow(emptyBrewingState())),
  },
  {
    ownerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
    schema: GameplayVillagerTradeSnapshotSchema,
    initialState: ownerInitialValue(initial, 'villagerTrades', { villagers: [], restockElapsedSecs: 0 }),
  },
  {
    ...fishingOwnerRegistration(GAMEPLAY_FISHING_OWNER_ID),
    initialState: ownerInitialValue(initial, 'fishing', emptyFishingState()),
  },
  {
    ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
    schema: GameplayEntityRosterSchema,
    initialState: entityState,
  },
  {
    ownerId: GAMEPLAY_TNT_SOURCES_OWNER_ID,
    schema: GameplayTntSourcesSnapshotSchema,
    initialState: ownerInitialValue(initial, 'tntSources', { sources: [] }),
  },
  {
    ownerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    schema: strictCodec(StatusEffectStateSchema),
    initialState: ownerInitialValue(initial, 'statusEffects', emptyStatusEffectState()),
  },
  {
    ownerId: PROJECTILE_REPLICATED_OWNER_ID,
    schema: ProjectileServiceSnapshotSchema,
    initialState: ownerInitialValue(initial, 'projectiles', INITIAL_PROJECTILE_SERVICE_SNAPSHOT),
  },
  tntOwnerRegistration(
    TNT_REPLICATED_OWNER_ID,
    ownerInitialValue(initial, 'tnt', INITIAL_TNT_SERVICE_SNAPSHOT),
  ),
]

export function gameplayOwnerRegistrations(): ReadonlyArray<ReplicatedOwnerRegistration>
export function gameplayOwnerRegistrations(
  initial: GameplayOwnerInitialState | undefined,
): Result.Result<ReadonlyArray<ReplicatedOwnerRegistration>, GameplayOwnerRegistrationFailure>
export function gameplayOwnerRegistrations(
  initial?: GameplayOwnerInitialState,
): ReadonlyArray<ReplicatedOwnerRegistration> | Result.Result<
  ReadonlyArray<ReplicatedOwnerRegistration>,
  GameplayOwnerRegistrationFailure
> {
  const emptyEntities: GameplayEntityRoster = { entities: [], nextSerial: EntitySerial(0) }
  if (arguments.length === 0) {
    return gameplayOwnerRegistrationValues(
      {},
      playerOwnerState(INITIAL_PLAYER_POSE, INITIAL_DIMENSION),
      emptyEntities,
    )
  }
  if (initial === undefined) {
    return Result.fail({ _tag: 'ExplicitUndefinedGameplayOwnerInitialState', field: 'initial' })
  }
  if (!isRecord(initial)) {
    return Result.fail({ _tag: 'InvalidGameplayOwnerInitialState', field: 'initial' })
  }
  const fields: ReadonlyArray<keyof GameplayOwnerInitialState> = [
    'playerPose', 'dimension', 'playerStorage', 'crops', 'droppedItems', 'vitals',
    'experienceOrbs', 'brewing', 'villagerTrades', 'fishing', 'entities', 'tntSources',
    'statusEffects', 'projectiles', 'tnt',
  ]
  if (!hasOnlyKeys(initial, fields)) {
    return Result.fail({ _tag: 'InvalidGameplayOwnerInitialState', field: 'initial' })
  }
  for (const field of fields) {
    if (Object.hasOwn(initial, field) && initial[field] === undefined) {
      return Result.fail({ _tag: 'ExplicitUndefinedGameplayOwnerInitialState', field })
    }
  }

  const pose = ownerInitialValue(initial, 'playerPose', INITIAL_PLAYER_POSE)
  const dimension = ownerInitialValue(initial, 'dimension', INITIAL_DIMENSION)
  const playerCandidate: unknown = isRecord(pose) && isRecord(pose['feetPosition'])
    ? {
        pose: {
          feetPosition: { dimension, ...pose['feetPosition'] },
          yawRadians: pose['yawRadians'],
          pitchRadians: pose['pitchRadians'],
        },
      }
    : { pose }
  const playerState = Schema.decodeUnknownResult(PlayerServiceSnapshotSchema)(playerCandidate)
  if (Result.isFailure(playerState)) {
    return Result.fail({
      _tag: 'InvalidGameplayOwnerRegistration',
      ownerId: GAMEPLAY_PLAYER_OWNER_ID,
      error: playerState.failure,
    })
  }

  const entityState = restoreGameplayEntityMetadata(
    ownerInitialValue(initial, 'entities', { entities: [], nextSerial: EntitySerial(0) }),
    { entities: [], nextSerial: EntitySerial(0) },
    dimension,
  )
  if (Result.isFailure(entityState)) return Result.fail(entityState.failure)

  const registrations = gameplayOwnerRegistrationValues(initial, playerState.success, entityState.success)
  for (const registration of registrations) {
    const decoded = Schema.decodeUnknownResult(registration.schema)(registration.initialState)
    if (Result.isFailure(decoded)) {
      return Result.fail({
        _tag: 'InvalidGameplayOwnerRegistration',
        ownerId: registration.ownerId,
        error: decoded.failure,
      })
    }
  }
  return Result.succeed(registrations)
}

export const GAMEPLAY_OWNER_REGISTRATIONS: ReadonlyArray<ReplicatedOwnerRegistration> =
  gameplayOwnerRegistrations()
