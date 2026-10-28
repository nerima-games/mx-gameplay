import {
  PLAYER_REPLICATED_OWNER_ID,
  PlayerServiceSnapshotSchema,
  emptyPlayerStorage,
  makeReplicatedOwnerId,
  playerStorageOwnerRegistration,
  SPAWN_VITALS,
  type PlayerStorage,
  type ReplicatedOwnerRegistration,
  type Vitals,
} from '@nerima-games/mc-sim'
import { Schema } from 'effect'
import {
  droppedItemOwnerRegistration,
  type DroppedItemOwnerSnapshot,
} from '../domain/entities/dropped-item.js'
import {
  experienceOrbOwnerRegistration,
  vitalsOwnerRegistration,
  type ExperienceOrbOwnerSnapshot,
} from '../domain/entities/xp-orb.js'
import { INITIAL_DIMENSION, INITIAL_PLAYER_POSE, type PlayerPose } from '../domain/in-memory-player.js'
import type { Dimension } from '@nerima-games/mc-worldgen'

export const GAMEPLAY_PLAYER_STORAGE_OWNER_ID = makeReplicatedOwnerId('mx-gameplay-player-storage')
export const GAMEPLAY_PLAYER_OWNER_ID = PLAYER_REPLICATED_OWNER_ID
export const GAMEPLAY_DROPPED_ITEMS_OWNER_ID = makeReplicatedOwnerId('mx-gameplay-dropped-items')
export const GAMEPLAY_VITALS_OWNER_ID = makeReplicatedOwnerId('mx-gameplay-vitals')
export const GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID = makeReplicatedOwnerId('mx-gameplay-experience-orbs')

export type GameplayOwnerInitialState = Readonly<{
  playerPose?: PlayerPose
  dimension?: Dimension
  playerStorage?: PlayerStorage
  droppedItems?: DroppedItemOwnerSnapshot
  vitals?: Vitals
  experienceOrbs?: ExperienceOrbOwnerSnapshot
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
  droppedItemOwnerRegistration(GAMEPLAY_DROPPED_ITEMS_OWNER_ID, initial.droppedItems ?? { items: [] }),
  vitalsOwnerRegistration(GAMEPLAY_VITALS_OWNER_ID, { vitals: initial.vitals ?? SPAWN_VITALS }),
  experienceOrbOwnerRegistration(GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID, initial.experienceOrbs ?? { orbs: [] }),
]

export const GAMEPLAY_OWNER_REGISTRATIONS = gameplayOwnerRegistrations()
