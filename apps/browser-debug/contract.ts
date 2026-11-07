import { Effect, Ref } from 'effect'
import {
  BlockAxis,
  InterpolationFraction,
  blockPosition,
  type ItemType,
  type Position,
} from '@nerima-games/mc-kernel'
import { type EnchantmentTableApplyResult, type Vehicle } from '@nerima-games/mc-sim'
import type { Dimension } from '@nerima-games/mc-worldgen'
import type { Weather } from '../../src/domain/weather.js'
import type { ExperienceOrbRecord } from '../../src/domain/entities/xp-orb.js'
import type { VehicleControlInput } from '../../src/domain/vehicle/vehicle-frame.js'
import type { ItemUseResult } from '../../src/stages/registration-core.js'
import type { VillagerTradeState } from '../../src/domain/villager-trade.js'
import type { VillagerTradeRequest, VillagerTradeResult } from '../../src/stages/registration-core.js'
import {
  makeSite,
  stepFrame,
  type FrameRow,
  type ObservedGameplayMob,
  type ObservedGameplayPlayerPose,
  type Site,
} from '../preview-mining-site/site.js'
import type { WorldSpec } from '../preview-mining-site/world.js'

export type ScenarioArea =
  | 'interactions-blocks'
  | 'interactions-items'
  | 'mobs'
  | 'vehicles-portals'
  | 'player-systems'
  | 'environment'
  | 'cross-area'
  | 'preview'

/** Browser-debug scenario times use ticks in a 24,000-tick day. */
export type ScenarioMountContext = {
  readonly root: HTMLElement
  readonly scenarioId: string
  readonly seed: number
  /** Time of day in ticks within a 24,000-tick day; normalized at the Site boundary. */
  readonly time: number
  readonly weather: Weather
}

export type ScenarioAction = {
  readonly id: string
  readonly label: string
  readonly perform: (site: Site) => void
}

export type ScenarioObservation = {
  readonly mobs?: ReadonlyArray<ObservedGameplayMob>
  readonly vehicles?: ReadonlyArray<Vehicle>
  readonly playerPose?: ObservedGameplayPlayerPose
  readonly playerPosition?: string
  readonly equipment?: unknown
  readonly hotbar?: unknown
  readonly statusEffects?: unknown
  readonly deathCauses?: ReadonlyArray<string>
  readonly audioCueIds?: ReadonlyArray<string>
  readonly unsupported?: ReadonlyArray<string>
}

export type ScenarioSetup = {
  readonly world: WorldSpec
  readonly bounds: { readonly width: number; readonly height: number }
  readonly actions?: ReadonlyArray<ScenarioAction>
  readonly observedChunks?: ReadonlyArray<string>
  readonly unsupported?: ReadonlyArray<string>
  readonly observe?: (site: Site) => ScenarioObservation
}

export type ScenarioSnapshot = {
  readonly frame: number
  /** Time of day in ticks within a 24,000-tick day. */
  readonly timeOfDay: number
  readonly weather: Weather
  readonly stageNames: ReadonlyArray<string>
  readonly entities: ReadonlyArray<string>
  readonly inventory: ReadonlyArray<readonly [string, number]>
  readonly vitals: unknown
  readonly experience: number
  readonly playerPosition: string
  readonly equipment?: unknown
  readonly hotbar?: unknown
  readonly statusEffects?: unknown
  readonly chunks: ReadonlyArray<{ readonly key: string; readonly loaded: boolean }>
  readonly drops: ReadonlyArray<string>
  readonly deathCauses: ReadonlyArray<string>
  readonly mobs?: ReadonlyArray<ObservedGameplayMob>
  readonly vehicles?: ReadonlyArray<Vehicle>
  readonly playerPose?: ObservedGameplayPlayerPose
  readonly playerDimension?: Dimension
  readonly audioCueIds: ReadonlyArray<string>
  readonly unsupported: ReadonlyArray<string>
  readonly trace: ReadonlyArray<FrameRow>
}

export type ScenarioMount = {
  readonly site: Site
  readonly actions: ReadonlyArray<ScenarioAction>
  readonly advance: () => FrameRow
  readonly snapshot: () => ScenarioSnapshot
  /** Sets time of day in ticks within a 24,000-tick day. */
  readonly setTime: (time: number) => void
  readonly setWeather: (weather: Weather) => void
  readonly setInventory: (items: ReadonlyArray<readonly [ItemType, number]>) => void
  readonly observeMobs: () => ReadonlyArray<ObservedGameplayMob>
  /** Spawn a real gameplay vehicle into the preview Site. */
  readonly spawnVehicle: (
    type: Vehicle['type'],
    dimension: Dimension,
    position: Position,
    yawRadians?: number,
  ) => Vehicle
  readonly mountVehicle: (id: Vehicle['id'], occupant: string) => void
  readonly setVehicleVelocity: (
    id: Vehicle['id'],
    velocity: Readonly<{ x: number; y: number; z: number }>,
  ) => void
  readonly setVehicleControls: (id: Vehicle['id'], controls: VehicleControlInput) => void
  readonly setPoweredRailAt: (position: Parameters<Site['setPoweredRailAt']>[0], powered: boolean) => void
  /** Read real vehicle position and velocity only when called. */
  readonly observeVehicles: () => ReadonlyArray<Vehicle>
  /** Read the authoritative player pose only when called. */
  readonly observePlayerPose: () => ObservedGameplayPlayerPose
  /** Queue a fishing cast to be settled by a real gameplay frame. */
  readonly requestFishingCast: (intent: Parameters<Site['requestFishingCast']>[0]) => void
  readonly requestFishingAdvance: (intent: Parameters<Site['requestFishingAdvance']>[0]) => void
  readonly requestFishingCancel: (requestId: string, actor: Parameters<Site['requestFishingCancel']>[1]) => void
  readonly requestFishingReel: (requestId: string, actor: Parameters<Site['requestFishingReel']>[1]) => void
  /** Read fishing state only when called. */
  readonly observeFishingState: () => import('@nerima-games/mc-sim').FishingState
  readonly insertBrewingFuel: (requestId: string) => void
  readonly insertBrewingBottle: (
    requestId: string,
    bottleIndex: number,
    bottle: Parameters<Site['insertBrewingBottle']>[2],
  ) => void
  readonly insertBrewingIngredient: (
    requestId: string,
    ingredient: Parameters<Site['insertBrewingIngredient']>[1],
  ) => void
  /** Read brewing state only when called. */
  readonly observeBrewingState: () => import('@nerima-games/mc-sim').BrewingState
  /** Consume completed item-use results only when called. */
  readonly drainItemUseResults: () => ReadonlyArray<ItemUseResult>
  /** Apply a table offer through mc-sim and return its committed result. */
  readonly requestEnchantmentTableApply: (
    request: Parameters<Site['requestEnchantmentTableApply']>[0],
  ) => EnchantmentTableApplyResult
  readonly itemMetadata: Site['itemMetadata']
  readonly setVillagerTrades: (trades: VillagerTradeState) => void
  /** Read villager offers and stock only when called. */
  readonly observeVillagerTrades: () => VillagerTradeState
  readonly requestVillagerTrade: (request: VillagerTradeRequest) => void
  /** Consume completed trade results only when called. */
  readonly drainVillagerTradeResults: () => ReadonlyArray<VillagerTradeResult>
  readonly seedExperienceOrbs: (orbs: ReadonlyArray<ExperienceOrbRecord>) => void
  readonly dispose: () => void
}

export type ScenarioDefinition = {
  readonly id: string
  readonly title: string
  readonly area: ScenarioArea
  readonly isDefault: boolean
  readonly mount: (context: ScenarioMountContext) => ScenarioMount
}

export const mountGameplayScenario = (
  context: ScenarioMountContext,
  setup: ScenarioSetup,
): ScenarioMount => {
  const site = Effect.runSync(makeSite(setup.world, setup.bounds, context.scenarioId))
  Effect.runSync(Ref.set(site.state.rollSeed, context.seed))
  const ticksPerDay = 24_000
  const setTime = (timeTicks: number): void => {
    const normalizedTicks = ((timeTicks % ticksPerDay) + ticksPerDay) % ticksPerDay
    const timeFraction = normalizedTicks / ticksPerDay
    Effect.runSync(site.time.setTimeOfDay(InterpolationFraction(timeFraction)))
    const appliedTimeFraction = Effect.runSync(site.time.timeOfDay)
    Effect.runSync(Ref.set(site.state.timeOfDay, appliedTimeFraction))
  }
  setTime(context.time)
  site.weather = { weather: context.weather, remainingSecs: site.weather.remainingSecs }
  Effect.runSync(Ref.set(site.state.weather, site.weather))

  const initialChunks = new Set([
    ...setup.world.loadedChunks,
    ...(setup.observedChunks ?? []),
    ...setup.world.cells.map(([x]) => `${Math.floor(x / 16)},${Math.floor(setup.world.z / 16)}`),
  ])

  const actions = setup.actions ?? []
  const dispose = (): void => {
    Effect.runSync(site.dispose())
    context.root.replaceChildren()
  }

  return {
    site,
    actions,
    advance: () => Effect.runSync(stepFrame(site)),
    setTime,
    setWeather: (weather) => {
      site.weather = { weather, remainingSecs: site.weather.remainingSecs }
      Effect.runSync(Ref.set(site.state.weather, site.weather))
    },
    setInventory: (items) => Effect.runSync(site.setInventory(items)),
    observeMobs: () => Effect.runSync(site.observeMobs()),
    spawnVehicle: (type, dimension, position, yawRadians = 0) =>
      Effect.runSync(site.spawnVehicle(type, dimension, position, yawRadians)),
    mountVehicle: (id, occupant) => Effect.runSync(site.mountVehicle(id, occupant)),
    setVehicleVelocity: (id, velocity) => Effect.runSync(site.setVehicleVelocity(id, velocity)),
    setVehicleControls: (id, controls) => site.setVehicleControls(id, controls),
    setPoweredRailAt: (position, powered) => site.setPoweredRailAt(position, powered),
    observeVehicles: () => Effect.runSync(site.observeVehicles()),
    observePlayerPose: () => Effect.runSync(site.observePlayerPose()),
    requestFishingCast: (intent) => Effect.runSync(site.requestFishingCast(intent)),
    requestFishingAdvance: (intent) => Effect.runSync(site.requestFishingAdvance(intent)),
    requestFishingCancel: (requestId, actor) => Effect.runSync(site.requestFishingCancel(requestId, actor)),
    requestFishingReel: (requestId, actor) => Effect.runSync(site.requestFishingReel(requestId, actor)),
    observeFishingState: () => Effect.runSync(site.observeFishingState()),
    insertBrewingFuel: (requestId) => Effect.runSync(site.insertBrewingFuel(requestId)),
    insertBrewingBottle: (requestId, bottleIndex, bottle) =>
      Effect.runSync(site.insertBrewingBottle(requestId, bottleIndex, bottle)),
    insertBrewingIngredient: (requestId, ingredient) =>
      Effect.runSync(site.insertBrewingIngredient(requestId, ingredient)),
    observeBrewingState: () => Effect.runSync(site.observeBrewingState()),
    drainItemUseResults: () => Effect.runSync(site.drainItemUseResults()),
    requestEnchantmentTableApply: (request) => Effect.runSync(site.requestEnchantmentTableApply(request)),
    itemMetadata: site.itemMetadata,
    setVillagerTrades: (trades) => Effect.runSync(site.setVillagerTrades(trades)),
    observeVillagerTrades: () => Effect.runSync(site.observeVillagerTrades()),
    requestVillagerTrade: (request) => Effect.runSync(site.requestVillagerTrade(request)),
    drainVillagerTradeResults: () => Effect.runSync(site.drainVillagerTradeResults()),
    seedExperienceOrbs: (orbs) => Effect.runSync(site.seedExperienceOrbs(orbs)),
    snapshot: () => {
      const observation = setup.observe?.(site) ?? {}
      const entities = Effect.runSync(site.roster.entities)
      const vitals = Effect.runSync(site.state.survivalHunger.snapshot).vitals
      const chunks = [...initialChunks].sort().map((key) => {
        const [chunkXText, chunkZText] = key.split(',')
        const chunkX = Number(chunkXText ?? '0')
        const chunkZ = Number(chunkZText ?? '0')
        return {
          key,
          loaded: site.world.isResident(blockPosition(BlockAxis(chunkX * 16), BlockAxis(0), BlockAxis(chunkZ * 16))),
        }
      })

      return {
        frame: site.frame,
        timeOfDay: Math.round(Effect.runSync(site.time.timeOfDay) * ticksPerDay),
        weather: site.weather.weather,
        stageNames: site.stages.map((stage) => String(stage.id)),
        entities: entities.map((entity) => JSON.stringify(entity) ?? String(entity)),
        inventory: [...site.inventory.entries()],
        vitals,
        experience: site.experience,
        playerPosition: observation.playerPosition ?? '0, 64, 0 (preview spawn)',
        ...(observation.mobs === undefined ? {} : { mobs: observation.mobs }),
        ...(observation.vehicles === undefined ? {} : { vehicles: observation.vehicles }),
        ...(observation.playerPose === undefined
          ? {}
          : {
              playerPose: observation.playerPose,
              playerDimension: observation.playerPose.dimension,
            }),
        equipment: observation.equipment,
        hotbar: observation.hotbar,
        statusEffects: observation.statusEffects,
        chunks,
        drops: (site.trace.at(-1)?.dropped ?? []).map(({ item, count }) => `${String(item)} × ${String(count)}`),
        deathCauses: observation.deathCauses ?? [],
        audioCueIds: observation.audioCueIds ?? [],
        unsupported: [...(setup.unsupported ?? []), ...(observation.unsupported ?? [])],
        trace: site.trace,
      }
    },
    dispose,
  }
}
