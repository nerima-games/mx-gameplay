import {
  AIR_BLOCK_ID,
  BlockAxis,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  CHUNK_SIZE_XZ,
  type ChunkCoord,
} from '@nerima-games/mc-kernel'
import { Effect, Option, Ref } from 'effect'
import { runBrowserDebugEffect } from '../entrypoint.js'
import { CHUNK_VOLUME, blockIndex, type Chunk, type ReadonlyChunk } from '@nerima-games/mc-worldgen'
import { HOSTILE_KINDS } from '../../../src/domain/entities/mob-frame.js'
import { chunkCoordsAround } from '../../../src/domain/chunk-window.js'
import { isNight } from '../../../src/domain/day-night.js'
import {
  DEFAULT_FLUID_FRONTIER_BUDGET,
  DEFAULT_FLUID_HORIZONTAL_RANGE,
} from '../../../src/domain/fluid-frontier.js'
import { PASSIVE_MOB_KINDS } from '../../../src/domain/mob/mob-ecosystem.js'
import {
  FIRE_FRAME_TICK_BUDGET,
  FIRE_TICK_INTERVAL_SECS,
  FIRE_WORK_BUDGET,
  makeFireLifecycleState,
} from '../../../src/domain/fire-lifecycle.js'
import { PORTAL_WINDOW_RADIUS } from '../../../src/domain/interactions/ignite-portal.js'
import { FRAME_DELTA, requestBreak, requestItemUse, stepFrame } from '../../preview-mining-site/site.js'
import { FIRE, SAND, STONE, WATER, type WorldSpec } from '../../preview-mining-site/world.js'
import { HOSTILE_SPAWN_INTERVAL_SECS } from '../../../src/stages/registration.js'
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

const residentSpawnChunks = (): Array<string> => {
  const chunks: Array<string> = []
  for (let chunkX = -3; chunkX <= 3; chunkX += 1) {
    for (let chunkZ = -3; chunkZ <= 3; chunkZ += 1) {
      chunks.push(`${String(chunkX)},${String(chunkZ)}`)
    }
  }
  return chunks
}

const advanceFireTick = (site: Parameters<typeof requestBreak>[0]): void => {
  const frames = Math.ceil(FIRE_TICK_INTERVAL_SECS / FRAME_DELTA)
  for (let frame = 0; frame < frames; frame += 1) runBrowserDebugEffect(stepFrame(site))
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
              runBrowserDebugEffect(requestBreak(site, barrier))
              runBrowserDebugEffect(stepFrame(site))
            },
          },
        ],
        unsupported: [
          `Bounded fixture: one resident 16 × 16 chunk; water range ${String(DEFAULT_FLUID_HORIZONTAL_RANGE.water)} blocks; frontier budget ${String(DEFAULT_FLUID_FRONTIER_BUDGET)} cells per frame.`,
          'Fluid outside the resident chunk remains unreadable and is retained as deferred frontier work.',
        ],
      })
      runBrowserDebugEffect(Ref.set(mounted.site.state.fluidFrontier, [{
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
              runBrowserDebugEffect(requestBreak(site, support))
              runBrowserDebugEffect(stepFrame(site))
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
      const planks = Option.getOrThrow(blockIdOf('oak_planks'))
      const portalWindowChunks = chunkCoordsAround(fire, PORTAL_WINDOW_RADIUS)
      const portalWindowKeys = portalWindowChunks.map(({ cx, cz }) =>
        `${String(cx)},${String(cz)}`,
      )
      const mounted = mountGameplayScenario(context, {
        world: world([cell(9, 63, planks)], 0, portalWindowKeys),
        bounds: { width: 16, height: 66 },
        actions: [
          {
            id: 'ignite-fire-charge',
            label: 'Ignite with fire charge',
            perform: (site) => {
              runBrowserDebugEffect(site.setInventory([['fire_charge', 1]]))
              runBrowserDebugEffect(site.inventoryService.takeDepositLog)
              const usedBefore = runBrowserDebugEffect(Ref.get(site.state.usedItems)).length
              const resultsBefore = runBrowserDebugEffect(Ref.get(site.state.itemUseResults)).length
              runBrowserDebugEffect(requestItemUse(site, fire, 'fire_charge'))
              const frame = runBrowserDebugEffect(stepFrame(site))
              const used = runBrowserDebugEffect(Ref.get(site.state.usedItems)).slice(usedBefore)
              const itemUseResults = runBrowserDebugEffect(Ref.get(site.state.itemUseResults)).slice(resultsBefore)
              const fireBlock = runBrowserDebugEffect(site.world.api.getBlock(fire))
              const fireChargeConsumed = used.includes('fire_charge') && itemUseResults.some(
                (result) => 'heldItem' in result &&
                  result.heldItem === 'fire_charge' &&
                  'success' in result &&
                  result.success,
              )
              if (frame.requested !== 1 ||
                fireBlock._tag !== 'Block' ||
                fireBlock.block !== FIRE ||
                !fireChargeConsumed) {
                throw new Error('browser-debug: fire-charge ignition did not commit and consume its item')
              }
              runBrowserDebugEffect(site.setInventory([]))
              runBrowserDebugEffect(stepFrame(site))
              if ((site.inventory.get('fire_charge') ?? 0) !== 0) {
                throw new Error('browser-debug: consumed fire charge remains in the preview inventory')
              }
            },
          },
        ],
        unsupported: [
          `Bounded fixture: one ignition cell and one adjacent flammable block; runtime limits ${String(FIRE_WORK_BUDGET)} work items and ${String(FIRE_FRAME_TICK_BUDGET)} fire ticks per frame.`,
        ],
      })
      const chunkSnapshots = new Map<string, Chunk>()
      for (const coord of portalWindowChunks) {
        const blocks = new Uint16Array(CHUNK_VOLUME)
        blocks.fill(AIR_BLOCK_ID)
        chunkSnapshots.set(`${String(coord.cx)},${String(coord.cz)}`, {
          coord,
          blocks,
          biomes: Array.from(
            { length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ },
            (): Chunk['biomes'][number] => 'PLAINS',
          ),
        })
      }
      for (const [x, y, block] of mounted.site.spec.cells) {
        const chunkX = Math.floor(x / CHUNK_SIZE_XZ)
        const chunkZ = Math.floor(mounted.site.spec.z / CHUNK_SIZE_XZ)
        const chunk = chunkSnapshots.get(`${String(chunkX)},${String(chunkZ)}`)
        if (chunk === undefined) {
          throw new Error('browser-debug: fire fixture cell is outside its portal chunk window')
        }
        chunk.blocks[blockIndex(
          x - chunkX * CHUNK_SIZE_XZ,
          y,
          mounted.site.spec.z - chunkZ * CHUNK_SIZE_XZ,
        )] = block
      }
      const peek = (coord: ChunkCoord): Effect.Effect<ReadonlyChunk | undefined> =>
        Effect.succeed(chunkSnapshots.get(`${String(coord.cx)},${String(coord.cz)}`))
      // Portal detection reads chunks directly; the preview store leaves `peek` unimplemented.
      Object.defineProperty(mounted.site.world.api, 'peek', {
        configurable: true,
        writable: true,
        value: peek,
      })
      return mounted
    },
  },
  {
    id: 'environment-day-night',
    title: 'Day and night clock boundary',
    area: 'environment',
    isDefault: false,
    mount: (context) => {
      const document = context.root.ownerDocument
      const section = document.createElement('section')
      section.setAttribute('aria-label', 'Day and night mob observation')
      const heading = document.createElement('h2')
      heading.textContent = 'Observed day and night mobs'
      const details = document.createElement('pre')
      details.setAttribute('aria-label', 'Mob kinds observed after the spawn interval')
      details.setAttribute('aria-live', 'polite')
      details.textContent = 'No spawn search has run.'
      section.append(heading, details)
      context.root.append(section)

      const frameCount = Math.ceil(HOSTILE_SPAWN_INTERVAL_SECS / FRAME_DELTA)
      const mounted = mountGameplayScenario(context, {
        world: world([], 0, residentSpawnChunks()),
        bounds: { width: 96, height: 96 },
        actions: [{
          id: 'observe-time-gated-mobs',
          label: `Advance ${String(frameCount)} frames and observe mobs`,
          perform: (site) => {
            for (let frame = 0; frame < frameCount; frame += 1) {
              runBrowserDebugEffect(stepFrame(site))
            }

            const timeOfDay = runBrowserDebugEffect(site.time.timeOfDay)
            const night = isNight(timeOfDay)
            const phase = night ? 'night' : 'day'
            const mobs = runBrowserDebugEffect(site.observeMobs())
            details.textContent = JSON.stringify({ phase, timeOfDay, mobs }, null, 2)
            const expectedKinds = night ? HOSTILE_KINDS : PASSIVE_MOB_KINDS
            if (mobs.length === 0 || !mobs.every(({ kind }) =>
              expectedKinds.some((expectedKind) => expectedKind === kind))) {
              throw new Error(`browser-debug: ${phase} spawn interval produced no matching mobs`)
            }
          },
        }],
        observe: (site) => ({ mobs: runBrowserDebugEffect(site.observeMobs()) }),
      })
      for (let x = -48; x <= 47; x += 1) {
        for (let z = -48; z <= 47; z += 1) {
          mounted.site.world.poke(position(x, 63, z), STONE)
        }
      }
      return mounted
    },
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
              runBrowserDebugEffect(requestBreak(site, roof))
              advanceFireTick(site)
            },
          },
        ],
        unsupported: [
          `The fixture tracks one fire cell; fire runtime limits ${String(FIRE_WORK_BUDGET)} work items and ${String(FIRE_FRAME_TICK_BUDGET)} fire ticks per frame. Select rain or thunder to observe weather extinguishing the exposed fire.`,
        ],
      })
      runBrowserDebugEffect(Ref.set(
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
              runBrowserDebugEffect(requestBreak(site, residentBlock))
              runBrowserDebugEffect(stepFrame(site))
            },
          },
          {
            id: 'break-unloaded-edge-block',
            label: 'Request break in unloaded chunk',
            perform: (site) => {
              runBrowserDebugEffect(requestBreak(site, unloadedBlock))
              runBrowserDebugEffect(stepFrame(site))
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
