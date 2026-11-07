import { Effect, Ref } from 'effect'
import { BlockAxis, blockPosition } from '@nerima-games/mc-kernel'
import type { Weather } from '../../src/domain/weather.js'
import { makeSite, stepFrame, type FrameRow, type Site } from '../preview-mining-site/site.js'
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

export type ScenarioMountContext = {
  readonly root: HTMLElement
  readonly scenarioId: string
  readonly seed: number
  readonly time: number
  readonly weather: Weather
}

export type ScenarioAction = {
  readonly id: string
  readonly label: string
  readonly perform: (site: Site) => void
}

export type ScenarioObservation = {
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
  readonly audioCueIds: ReadonlyArray<string>
  readonly unsupported: ReadonlyArray<string>
  readonly trace: ReadonlyArray<FrameRow>
}

export type ScenarioMount = {
  readonly site: Site
  readonly actions: ReadonlyArray<ScenarioAction>
  readonly advance: () => FrameRow
  readonly snapshot: () => ScenarioSnapshot
  readonly setTime: (time: number) => void
  readonly setWeather: (weather: Weather) => void
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
  Effect.runSync(Ref.set(site.state.timeOfDay, context.time))
  site.weather = { weather: context.weather, remainingSecs: site.weather.remainingSecs }
  Effect.runSync(Ref.set(site.state.weather, site.weather))

  const initialChunks = new Set([
    ...setup.world.loadedChunks,
    ...(setup.observedChunks ?? []),
    ...setup.world.cells.map(([x]) => `${Math.floor(x / 16)},${Math.floor(setup.world.z / 16)}`),
  ])

  const actions = setup.actions ?? []
  const dispose = (): void => context.root.replaceChildren()

  return {
    site,
    actions,
    advance: () => Effect.runSync(stepFrame(site)),
    setTime: (time) => Effect.runSync(Ref.set(site.state.timeOfDay, time)),
    setWeather: (weather) => {
      site.weather = { weather, remainingSecs: site.weather.remainingSecs }
      Effect.runSync(Ref.set(site.state.weather, site.weather))
    },
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
        timeOfDay: Effect.runSync(Ref.get(site.state.timeOfDay)),
        weather: site.weather.weather,
        stageNames: site.stages.map((stage) => String(stage.id)),
        entities: entities.map((entity) => JSON.stringify(entity) ?? String(entity)),
        inventory: [...site.inventory.entries()],
        vitals,
        experience: site.experience,
        playerPosition: observation.playerPosition ?? '0, 64, 0 (preview spawn)',
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
