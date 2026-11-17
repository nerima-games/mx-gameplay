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
import type { GameplayBlockStateWorldApi } from './gameplay-block-state-world.js'
import {
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_FISHING_ENCHANTMENTS_OWNER_ID,
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

/**
 * Build the production stage list for a host-owned gameplay frame state.
 *
 * `makeGameplayStages` in `stages/registration.ts` reaches this through
 * `makeGameplayStagesWithState`, so this is where `GameModule.frameStages`
 * acquires the services it needs to BUILD stages, rather than to run them.
 *
 * ---------------------------------------------------------------------------
 * `MobBehaviour` IS NAMED HERE, AND THAT IS THE POINT OF FAILURE TO KNOW ABOUT
 * ---------------------------------------------------------------------------
 *
 * `entityManagerTag<MobBehaviour>()` and `EntityManagerLayer<MobBehaviour>()`
 * must agree, and NO COMPILER CAN CHECK THAT THEY DO: mc-sim's Layer has result
 * type `Layer.Layer<EntityManager>` with the behaviour parameter appearing
 * nowhere in it, because the context identity is unparameterised while the
 * service value type is not (`docs/public-api.md` §7-1 of that repository). A
 * host that instantiates the roster at some other `S` gets a Layer that
 * satisfies this requirement and a `behaviour` field that is not what the line
 * below says it is.
 *
 * The mitigation is that exactly one repository names the type and the host
 * imports that name: `MobBehaviour` and `repairMobBehaviour` are both exported
 * from `index.ts` for this reason. The host's two lines are
 *
 *     const world = Layer.merge(
 *       simModule.layers,
 *       EntityManagerLayer<MobBehaviour>(undefined, repairMobBehaviour),
 *     )
 *
 * and taking `gameplayModule.frameStages` from inside that same `Effect.provide`.
 * See `docs/public-api.md` for why `simModule` should not grow a type parameter
 * to try to do this for the host.
 */
const makeGameplayStageRegistrations = (
  state: GameplayFrameState,
  blockStateWorld: GameplayBlockStateWorldApi | undefined,
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

  const stages = gameplayStages(state, store, roster, undefined, undefined, time, undefined, {}, {
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
    fishingEnchantmentsOwnerId: GAMEPLAY_FISHING_ENCHANTMENTS_OWNER_ID,
    entitiesOwnerId: GAMEPLAY_ENTITIES_OWNER_ID,
    projectileOwnerId: PROJECTILE_REPLICATED_OWNER_ID,
    tntOwnerId: TNT_REPLICATED_OWNER_ID,
    tntSourcesOwnerId: GAMEPLAY_TNT_SOURCES_OWNER_ID,
    brewingService,
    fishingService,
    projectileService,
    tntService,
    eventBus,
  }, blockStateWorld)
  const brewingAdvance = yield* makeBrewingAdvanceStage(brewingService, coordinator)
  return [...stages, brewingAdvance.stage]
})

/** Shared production composition for a host-owned gameplay frame state. */
export const makeGameplayStagesWithState = (
  state: GameplayFrameState,
  blockStateWorld?: GameplayBlockStateWorldApi,
): Effect.Effect<
  ReadonlyArray<StageRegistration>,
  never,
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus
> => makeGameplayStageRegistrations(state, blockStateWorld)
