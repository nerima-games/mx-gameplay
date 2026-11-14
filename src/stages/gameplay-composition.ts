import {
  ChunkStore,
  TimeService,
  entityManagerTag,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  makeGameplayFrameStateForOwner,
} from './registration-core.js'
import type { EntityManager, GameplayFrameState, MobBehaviour } from './registration-core.js'
import {
  DomainEventBus,
  WorldCommitCoordinator,
  makeBrewingService,
  makeFishingService,
  makeProjectileService,
  makeTntService,
  PROJECTILE_REPLICATED_OWNER_ID,
  TNT_REPLICATED_OWNER_ID,
} from '@nerima-games/mc-sim'
import type { StageRegistration } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import { GameplayBlockStateWorld } from './gameplay-block-state-world.js'
import { makeBrewingAdvanceStage } from './brewing-advance-stage.js'
import {
  GAMEPLAY_PLAYER_OWNER_ID,
  GAMEPLAY_CROPS_OWNER_ID,
  GAMEPLAY_BREWING_OWNER_ID,
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
  GAMEPLAY_TNT_SOURCES_OWNER_ID,
} from './gameplay-owner-registrations.js'
import type { gameplayStages } from './registration.js'

export type GameplayComposition = Readonly<{
  state: GameplayFrameState
  stages: ReadonlyArray<StageRegistration>
}>

/**
 * Build the module's state and its stages together.
 *
 * This is the composition used by `GameModule.frameStages` in
 * `stages/registration.ts`. The registration services are the reason that
 * field is an Effect: this is the one moment at which a module may acquire
 * services in order to BUILD stages, rather than in order to run them.
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
 *
 * `gameplayStages` is a type-only dependency so the registration module can
 * supply its stage factory without creating a runtime import cycle.
 */
export const makeGameplayComposition = (
  buildStages: typeof gameplayStages,
): Effect.Effect<
  GameplayComposition,
  never,
  ChunkStore | EntityManager | TimeService | WorldCommitCoordinator | DomainEventBus | GameplayBlockStateWorld
> => Effect.gen(function* () {
  const store = yield* ChunkStore
  const roster = yield* entityManagerTag<MobBehaviour>()
  const time = yield* TimeService
  const coordinator = yield* WorldCommitCoordinator
  const eventBus = yield* DomainEventBus
  const blockStateWorld = yield* GameplayBlockStateWorld
  const brewingService = yield* makeBrewingService(GAMEPLAY_BREWING_OWNER_ID)
  const fishingService = yield* makeFishingService(GAMEPLAY_FISHING_OWNER_ID)
  const projectileService = yield* makeProjectileService()
  const tntService = yield* makeTntService(TNT_REPLICATED_OWNER_ID)
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })

  const stages = buildStages(state, store, roster, undefined, undefined, time, undefined, undefined, {}, {
    coordinator,
    playerOwnerId: GAMEPLAY_PLAYER_OWNER_ID,
    playerStorageOwnerId: GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
    cropOwnerId: GAMEPLAY_CROPS_OWNER_ID,
    droppedItemsOwnerId: GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    experienceOrbsOwnerId: GAMEPLAY_EXPERIENCE_ORBS_OWNER_ID,
    villagerTradesOwnerId: GAMEPLAY_VILLAGER_TRADES_OWNER_ID,
    brewingOwnerId: GAMEPLAY_BREWING_OWNER_ID,
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
  }, blockStateWorld)
  const brewingAdvance = yield* makeBrewingAdvanceStage(brewingService, coordinator)
  return { state, stages: [...stages, brewingAdvance.stage] }
})
