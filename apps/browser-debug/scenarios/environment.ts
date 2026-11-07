import { BlockAxis, blockIdOf, blockPosition, blockPositionKeyOf } from '@nerima-games/mc-kernel'
import { Effect, Option, Ref } from 'effect'
import {
  DEFAULT_FLUID_FRONTIER_BUDGET,
  DEFAULT_FLUID_HORIZONTAL_RANGE,
} from '../../../src/domain/fluid-frontier.js'
import {
  FIRE_FRAME_TICK_BUDGET,
  FIRE_TICK_INTERVAL_SECS,
  FIRE_WORK_BUDGET,
  makeFireLifecycleState,
} from '../../../src/domain/fire-lifecycle.js'
import { FRAME_DELTA, requestBreak, stepFrame } from '../../preview-mining-site/site.js'
import { FIRE, SAND, STONE, WATER, type WorldSpec } from '../../preview-mining-site/world.js'
import { mountGameplayScenario, type ScenarioDefinition } from '../contract.js'

type Cell = WorldSpec['cells'][number]

const DIRT = Option.getOrThrow(blockIdOf('dirt'))

const position = (x: number, y: number, z = 0) =>
  blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

const cell = (x: number, y: number, block: Cell[2]): Cell => [x, y, block]

const world = (
  cells: ReadonlyArray<Cell>,
  z = 0,
  loadedChunks: ReadonlyArray<string> = ['0,0'],
): WorldSpec => ({ cells, z, loadedChunks })

const floor = (x0: number, x1: number, y: number): Array<Cell> =>
  Array.from({ length: x1 - x0 + 1 }, (_, index) => cell(x0 + index, y, STONE))

const advanceFireTick = (site: Parameters<typeof requestBreak>[0]): void => {
  const frames = Math.ceil(FIRE_TICK_INTERVAL_SECS / FRAME_DELTA)
  for (let frame = 0; frame < frames; frame += 1) Effect.runSync(stepFrame(site))
}

export const environmentScenarios: ReadonlyArray<ScenarioDefinition> = [
  {
    id: 'environment-fluid',
    title: 'Fluid frontier and per-frame budget',
    area: 'environment',
    isDefault: false,
    mount: (context) => {
      const source = position(14, 0, 15)
      const barrier = position(15, 0, 15)
      const mounted = mountGameplayScenario(context, {
        world: world([cell(14, 0, WATER), cell(15, 0, DIRT)], 15),
        bounds: { width: 16, height: 8 },
        actions: [
          {
            id: 'break-fluid-barrier',
            label: 'Break the flow barrier',
            perform: (site) => {
              Effect.runSync(requestBreak(site, barrier))
              Effect.runSync(stepFrame(site))
            },
          },
        ],
        unsupported: [
          `Bounded fixture: one resident 16 × 16 chunk; water range ${String(DEFAULT_FLUID_HORIZONTAL_RANGE.water)} blocks; frontier budget ${String(DEFAULT_FLUID_FRONTIER_BUDGET)} cells per frame.`,
          'Fluid outside the resident chunk remains unreadable and is retained as deferred frontier work.',
        ],
      })
      Effect.runSync(Ref.set(mounted.site.state.fluidFrontier, [{
        key: blockPositionKeyOf(source),
        kind: 'water',
        level: 0,
        source: true,
      }]))
      return mounted
    },
  },
  {
    id: 'environment-falling-block',
    title: 'Falling block queue',
    area: 'environment',
    isDefault: false,
    mount: (context) => {
      const support = position(8, 61)
      return mountGameplayScenario(context, {
        world: world([
          ...floor(0, 15, 60),
          cell(8, 61, DIRT),
          cell(8, 62, SAND),
        ]),
        bounds: { width: 16, height: 64 },
        actions: [
          {
            id: 'break-sand-support',
            label: 'Break the sand support',
            perform: (site) => {
              Effect.runSync(requestBreak(site, support))
              Effect.runSync(stepFrame(site))
            },
          },
        ],
      })
    },
  },
  {
    id: 'environment-fire',
    title: 'Fire lifecycle and bounded work',
    area: 'environment',
    isDefault: false,
    mount: (context) => {
      const fire = position(8, 63)
      const support = position(8, 62)
      const mounted = mountGameplayScenario(context, {
        world: world([cell(8, 62, DIRT), cell(8, 63, FIRE)]),
        bounds: { width: 16, height: 66 },
        actions: [
          {
            id: 'break-fire-support',
            label: 'Break the fire support',
            perform: (site) => {
              Effect.runSync(requestBreak(site, support))
              advanceFireTick(site)
            },
          },
        ],
        unsupported: [
          `Bounded fixture: one active fire cell with no spread fuel; runtime limits ${String(FIRE_WORK_BUDGET)} work items and ${String(FIRE_FRAME_TICK_BUDGET)} fire ticks per frame.`,
          'The Site cannot update its replicated player-storage owner, so fire-charge ignition is unavailable. This action removes support to exercise the fire lifecycle.',
        ],
      })
      Effect.runSync(Ref.set(
        mounted.site.state.fireLifecycle,
        makeFireLifecycleState([fire], context.seed),
      ))
      return mounted
    },
  },
  {
    id: 'environment-day-night',
    title: 'Day and night clock boundary',
    area: 'environment',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, {
      world: world(floor(0, 15, 63)),
      bounds: { width: 16, height: 66 },
      unsupported: [
        'The displayed time input is the preview compatibility value. Gameplay spawning reads mc-sim TimeService, which this scenario contract does not expose, so no day/night gameplay effect is claimed.',
      ],
    }),
  },
  {
    id: 'environment-weather',
    title: 'Weather and exposed fire',
    area: 'environment',
    isDefault: false,
    mount: (context) => {
      const fire = position(8, 63)
      const roof = position(8, 65)
      const mounted = mountGameplayScenario(context, {
        world: world([
          cell(8, 62, DIRT),
          cell(8, 63, FIRE),
          cell(8, 65, DIRT),
        ]),
        bounds: { width: 16, height: 66 },
        actions: [
          {
            id: 'expose-fire-to-weather',
            label: 'Break the fire roof',
            perform: (site) => {
              Effect.runSync(requestBreak(site, roof))
              advanceFireTick(site)
            },
          },
        ],
        unsupported: [
          `The fixture tracks one fire cell; fire runtime limits ${String(FIRE_WORK_BUDGET)} work items and ${String(FIRE_FRAME_TICK_BUDGET)} fire ticks per frame. Select rain or thunder to observe weather extinguishing the exposed fire.`,
        ],
      })
      Effect.runSync(Ref.set(
        mounted.site.state.fireLifecycle,
        makeFireLifecycleState([fire], context.seed),
      ))
      return mounted
    },
  },
  {
    id: 'environment-chunk-window',
    title: 'Resident and unloaded chunk edge',
    area: 'environment',
    isDefault: false,
    mount: (context) => {
      const residentBlock = position(15, 64)
      const unloadedBlock = position(16, 64)
      return mountGameplayScenario(context, {
        world: world([
          ...floor(0, 15, 63),
          cell(15, 64, SAND),
          cell(16, 64, SAND),
        ]),
        bounds: { width: 32, height: 66 },
        observedChunks: ['1,0'],
        actions: [
          {
            id: 'break-resident-edge-block',
            label: 'Break block in resident chunk',
            perform: (site) => {
              Effect.runSync(requestBreak(site, residentBlock))
              Effect.runSync(stepFrame(site))
            },
          },
          {
            id: 'break-unloaded-edge-block',
            label: 'Request break in unloaded chunk',
            perform: (site) => {
              Effect.runSync(requestBreak(site, unloadedBlock))
              Effect.runSync(stepFrame(site))
            },
          },
        ],
        unsupported: [
          'Chunk residency is fixed to chunk 0,0. Chunk 1,0 is intentionally unloaded and the preview does not auto-load it.',
        ],
      })
    },
  },
]
