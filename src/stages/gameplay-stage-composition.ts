import type { StageRegistration } from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  WorldCommitCoordinator,
  makeBrewingService,
  makeEnchantmentTableService,
  makeFishingService,
  makeProjectileService,
  makeTntService,
  PROJECTILE_REPLICATED_OWNER_ID,
  TNT_REPLICATED_OWNER_ID,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Schema } from 'effect'
import { ChunkStore, TimeService, entityManagerTag } from './registration-core.js'
import type { EntityManager, GameplayFrameState, MobBehaviour } from './registration-core.js'
import { makeBrewingAdvanceStage } from './brewing-advance-stage.js'
import { bindEnchantmentTableService } from './interactions-stage.js'
import { gameplayStages } from './gameplay-stages.js'
import {
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  GAMEPLAY_TNT_SOURCES_OWNER_ID,
} from './gameplay-owner-registrations.js'

import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../domain/entities/xp-orb.js'

const enchantmentTableCoordinator = (
  coordinator: WorldCommitCoordinatorApi,
): WorldCommitCoordinatorApi => {
  const snapshot: WorldCommitCoordinatorApi['snapshot'] = (ownerId, schema) => {
    if (ownerId !== GAMEPLAY_VITALS_OWNER_ID) return coordinator.snapshot(ownerId, schema)
    return Effect.gen(function* () {
      const wrapped = yield* coordinator.snapshot(ownerId, ExperienceOrbVitalsOwnerSnapshotSchema)
      const state = yield* Schema.decodeUnknownEffect(schema)(wrapped.state.vitals)
      return { ...wrapped, state }
    })
  }
  const commit: WorldCommitCoordinatorApi['commit'] = (request) => coordinator.commit({
    ...request,
    changes: request.changes.map((change) => change.ownerId === GAMEPLAY_VITALS_OWNER_ID
      ? { ...change, state: { vitals: change.state } }
      : change),
  })
  return { ...coordinator, snapshot, commit }
}

const makeGameplayStageRegistrations = (
  state: GameplayFrameState,
): Effect.Effect<
  ReadonlyArray<StageRegistration>,
  never,
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus
> => Effect.gen(function* () {
  const store = yield* ChunkStore
  const roster = yield* entityManagerTag<MobBehaviour>()
  const time = yield* TimeService
  const coordinator = yield* WorldCommitCoordinator
  const eventBus = yield* DomainEventBus
  const enchantmentTableService = yield* makeEnchantmentTableService().pipe(
    Effect.provideService(WorldCommitCoordinator, enchantmentTableCoordinator(coordinator)),
  )
  const brewingService = yield* makeBrewingService(GAMEPLAY_BREWING_OWNER_ID)
  const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID)
  const projectileService = yield* makeProjectileService()
  const tntService = yield* makeTntService(TNT_REPLICATED_OWNER_ID)
  bindEnchantmentTableService(state, enchantmentTableService)

  const stages = gameplayStages(state, store, roster, undefined, undefined, time, undefined, undefined, {}, {
    coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    cropOwnerId: GAMEPLAY_CROPS_OWNER_ID,
    droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
    villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
    brewingOwnerId: GAMEPLAY_BREWING_OWNER_ID,
    statusEffectsOwnerId: GAMEPLAY_STATUS_EFFECTS_OWNER_ID,
    fishingOwnerId: GAMEPLAY_FISHING_OWNER_ID,
    entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
    projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID,
    tntOwnerId: TNT_REPLICATED_OWNER_ID,
    tntSourcesOwnerId: GAMEPLAY_TNT_SOURCES_OWNER_ID,
    brewingService,
    fishingService,
    projectileService,
    tntService,
    eventBus,
  })
  const brewingAdvance = yield* makeBrewingAdvanceStage(brewingService, coordinator)
  return [...stages, brewingAdvance.stage]
})

/** Shared production composition for a host-owned gameplay frame state. */
export const makeGameplayStagesWithState = (
  state: GameplayFrameState,
): Effect.Effect<
  ReadonlyArray<StageRegistration>,
  never,
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus
> => makeGameplayStageRegistrations(state)
