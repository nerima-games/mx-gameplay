import { END_PORTAL_BLOCK } from '@nerima-games/mc-worldgen'
import { BlockAxis, blockIdOf, blockPosition, type BlockId } from '@nerima-games/mc-kernel'
import { Effect, Option, Ref } from 'effect'
import { mountGameplayScenario, type ScenarioDefinition, type ScenarioObservation } from '../contract.js'
import { requestBreak, stepFrame, type Site } from '../../preview-mining-site/site.js'
import { STONE, WATER, type WorldSpec } from '../../preview-mining-site/world.js'

const block = (name: Parameters<typeof blockIdOf>[0]): BlockId => Option.getOrThrow(blockIdOf(name))

const at = (x: number, y: number, z = 0) =>
  blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

const row = (start: number, end: number, y: number, blockId: BlockId): WorldSpec['cells'] =>
  Array.from({ length: end - start + 1 }, (_, index) => [start + index, y, blockId] as const)

const world = (cells: WorldSpec['cells']): WorldSpec => ({
  cells,
  loadedChunks: ['0,0'],
  z: 0,
})

const trackWorld = (rail: BlockId): WorldSpec => world([
  ...row(-1, 7, 63, STONE),
  ...row(0, 6, 64, rail),
])

const breakBlockAction = (id: string, label: string, x: number) => ({
  id,
  label,
  perform: (site: Site): void => {
    Effect.runSync(requestBreak(site, at(x, 64)))
    Effect.runSync(stepFrame(site))
  },
})

const vehicleUnsupported =
  'Vehicle movement is unavailable in this preview: makeSite does not provide a VehicleService or vehicle environment to the registered vehicle stage.'

const playerPoseUnsupported =
  'The live player pose is not exposed by Site; a completed portal travel event supplies its destination after crossing.'

const portalWorldUnsupported =
  'Site has one preview world store and does not materialize the destination portal plan or dimension world.'

const portalPosition = (
  source: 'nether' | 'end',
): ((site: Site) => ScenarioObservation) => (site) => {
  if (source === 'nether') {
    const travel = Effect.runSync(Ref.get(site.state.portalTravels)).at(-1)
    if (travel === undefined) return {}
    const { destination } = travel.plan
    return {
      playerPosition: `${travel.plan.toDimension} ${String(destination.x)}, ${String(destination.y)}, ${String(destination.z)}`,
    }
  }

  const travel = Effect.runSync(Ref.get(site.state.endPortalTravels)).at(-1)
  if (travel === undefined) return {}
  const { destination } = travel
  return {
    playerPosition: `${travel.toDimension} ${String(destination.x)}, ${String(destination.y)}, ${String(destination.z)}`,
  }
}

export const vehiclePortalScenarios: ReadonlyArray<ScenarioDefinition> = [
  {
    id: 'rail-route',
    title: 'Rail route',
    area: 'vehicles-portals',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, {
      world: trackWorld(block('rail')),
      bounds: { width: 8, height: 70 },
      actions: [breakBlockAction('break-rail', 'Break rail segment', 3)],
      unsupported: [vehicleUnsupported],
    }),
  },
  {
    id: 'minecart-route',
    title: 'Minecart route',
    area: 'vehicles-portals',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, {
      world: trackWorld(block('powered_rail')),
      bounds: { width: 8, height: 70 },
      actions: [breakBlockAction('break-powered-rail', 'Break powered rail', 3)],
      unsupported: [vehicleUnsupported],
    }),
  },
  {
    id: 'boat-waterway',
    title: 'Boat waterway',
    area: 'vehicles-portals',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, {
      world: world([
        ...row(-1, 7, 63, STONE),
        ...row(1, 4, 64, WATER),
        [2, 64, STONE],
      ]),
      bounds: { width: 8, height: 70 },
      actions: [breakBlockAction('clear-waterway', 'Break waterway barrier', 2)],
      unsupported: [vehicleUnsupported],
    }),
  },
  {
    id: 'nether-portal-travel',
    title: 'Nether portal travel',
    area: 'vehicles-portals',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, {
      world: world([[0, 64, block('nether_portal')], [-1, 63, STONE]]),
      bounds: { width: 3, height: 70 },
      unsupported: [playerPoseUnsupported, portalWorldUnsupported],
      observe: portalPosition('nether'),
    }),
  },
  {
    id: 'end-portal-travel',
    title: 'End portal travel',
    area: 'vehicles-portals',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, {
      world: world([[0, 64, END_PORTAL_BLOCK.PORTAL], [-1, 63, STONE]]),
      bounds: { width: 3, height: 70 },
      unsupported: [playerPoseUnsupported, portalWorldUnsupported],
      observe: portalPosition('end'),
    }),
  },
]
