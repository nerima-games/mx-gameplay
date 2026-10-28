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
import { ITEM_TYPES } from '@nerima-games/mc-kernel'
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
import type { Dimension } from '@nerima-games/mc-worldgen'
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
  type MobBehaviour,
} from '../domain/entities/mob-frame.js'
import { repairEcosystemMobState } from '../domain/mob/mob-ecosystem.js'
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

const isEcosystemState = (value: unknown): boolean =>
  isRecord(value) &&
    hasOnlyKeys(value, ['_tag', 'attackCooldownSecs', 'motionPhase', 'provoked']) &&
    value['_tag'] === 'EcosystemMob' &&
    typeof value['attackCooldownSecs'] === 'number' &&
    Number.isFinite(value['attackCooldownSecs']) &&
    value['attackCooldownSecs'] >= 0 &&
    typeof value['motionPhase'] === 'number' &&
    Number.isFinite(value['motionPhase']) &&
    typeof value['provoked'] === 'boolean' &&
    repairEcosystemMobState(value) !== undefined

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
  if (value['_tag'] === 'HostileMob') {
    return isHostileMobSnapshot(value) &&
      hasOnlyKeys(value, ['_tag', 'behaviour', 'ageTicks', 'persistent', 'named', 'tamed']) &&
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

export const GameplayMobBehaviourSchema = Schema.declare<MobBehaviour>(isMobBehaviour)

export const GameplayEntityRosterSchema: Schema.Codec<EntityRoster<MobBehaviour>, unknown> = strictCodec(
  EntityRosterSchema(GameplayMobBehaviourSchema),
)

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
  entities?: EntityRoster<MobBehaviour>
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

export const gameplayOwnerRegistrations = (
  initial: GameplayOwnerInitialState = {},
): ReadonlyArray<ReplicatedOwnerRegistration> => [
  {
    ownerId: GAMEPLAY_PLAYER_OWNER_ID,
    schema: PlayerServiceSnapshotSchema,
    initialState: playerOwnerState(
      initial.playerPose ?? INITIAL_PLAYER_POSE,
      initial.dimension ?? INITIAL_DIMENSION,
    ),
  },
  playerStorageOwnerRegistration(
    GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    initial.playerStorage ?? emptyPlayerStorage(),
  ),
  {
    ownerId: GAMEPLAY_CROPS_OWNER_ID,
    schema: CropSnapshotSchema,
    initialState: initial.crops ?? { crops: [] },
  },
  droppedItemOwnerRegistration(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, initial.droppedItems ?? { items: [] }),
  vitalsOwnerRegistration(GAMEPLAY_VITALS_OWNER_ID, { vitals: initial.vitals ?? SPAWN_VITALS }),
  experienceOrbOwnerRegistration(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, initial.experienceOrbs ?? { orbs: [] }),
  {
    ownerId: GAMEPLAY_BREWING_OWNER_ID,
    schema: BrewingServiceStateSchema,
    initialState: initial.brewing ?? Result.getOrThrow(emptyBrewingState()),
  },
  {
    ownerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
    schema: GameplayVillagerTradeSnapshotSchema,
    initialState: initial.villagerTrades ?? { villagers: [], restockElapsedSecs: 0 },
  },
  {
    ...fishingOwnerRegistration(GAMEPLAY_FISHING_OWNER_ID),
    initialState: initial.fishing ?? emptyFishingState(),
  },
  {
    ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
    schema: GameplayEntityRosterSchema,
    initialState: initial.entities ?? { entities: [], nextSerial: EntitySerial(0) },
  },
  {
    ownerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    schema: strictCodec(StatusEffectStateSchema),
    initialState: initial.statusEffects ?? emptyStatusEffectState(),
  },
  {
    ownerId: PROJECTILE_REPLICATED_OWNER_ID,
    schema: ProjectileServiceSnapshotSchema,
    initialState: initial.projectiles ?? INITIAL_PROJECTILE_SERVICE_SNAPSHOT,
  },
  tntOwnerRegistration(TNT_REPLICATED_OWNER_ID, initial.tnt ?? INITIAL_TNT_SERVICE_SNAPSHOT),
]

export const GAMEPLAY_OWNER_REGISTRATIONS: ReadonlyArray<ReplicatedOwnerRegistration> =
  gameplayOwnerRegistrations()
