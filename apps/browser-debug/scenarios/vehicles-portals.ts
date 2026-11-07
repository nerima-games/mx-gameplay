import { END_PORTAL_BLOCK } from '@nerima-games/mc-worldgen'
import { BlockAxis, PositionAxis, blockIdOf, blockPosition, position, type BlockId } from '@nerima-games/mc-kernel'
import type { Vehicle } from '@nerima-games/mc-sim'
import { Option, Ref } from 'effect'
import { runBrowserDebugEffect } from '../entrypoint.js'
import { mountGameplayScenario, type ScenarioDefinition, type ScenarioObservation } from '../contract.js'
import type { ObservedGameplayPlayerPose, Site } from '../../preview-mining-site/site.js'
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
  ...row(-1, 8, 63, STONE),
  ...row(0, 6, 64, rail),
])

const waterwayWorld = (): WorldSpec => world([
  ...row(-1, 8, 63, STONE),
  ...row(0, 7, 64, WATER),
])

type VehicleMotion = Readonly<{
  position: Readonly<{ x: number; y: number; z: number }>
  velocity: Readonly<{ x: number; y: number; z: number }>
}>

const vehicleMotion = (vehicle: Vehicle): VehicleMotion => ({
  position: { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z },
  velocity: { x: vehicle.velocity.x, y: vehicle.velocity.y, z: vehicle.velocity.z },
})

const vehicleObserver = (
  root: HTMLElement,
  type: Vehicle['type'],
  condition: string,
): Readonly<{
  setInitial: (vehicle: Vehicle) => void
  observe: (site: Site) => ScenarioObservation
}> => {
  const document = root.ownerDocument
  const section = document.createElement('section')
  section.setAttribute('aria-label', 'Vehicle movement observation')
  const heading = document.createElement('h2')
  heading.textContent = 'Vehicle movement'
  const details = document.createElement('pre')
  details.setAttribute('aria-label', 'Observed vehicle state')
  section.append(heading, details)
  root.append(section)

  let vehicleId: Vehicle['id'] | undefined
  let initial: VehicleMotion | undefined

  return {
    setInitial: (vehicle) => {
      vehicleId = vehicle.id
      initial = vehicleMotion(vehicle)
    },
    observe: (site) => {
      const vehicles = runBrowserDebugEffect(site.observeVehicles())
      const vehicle = vehicles.find((candidate) => candidate.id === vehicleId)
      if (vehicle === undefined || initial === undefined) {
        details.textContent = JSON.stringify({ type, condition, status: 'Vehicle not observed' }, null, 2)
        return { vehicles }
      }

      const current = vehicleMotion(vehicle)
      details.textContent = JSON.stringify({
        type,
        condition,
        frame: site.frame,
        occupant: vehicle.occupant ?? null,
        initial,
        current,
        delta: {
          position: {
            x: current.position.x - initial.position.x,
            y: current.position.y - initial.position.y,
            z: current.position.z - initial.position.z,
          },
          velocity: {
            x: current.velocity.x - initial.velocity.x,
            y: current.velocity.y - initial.velocity.y,
            z: current.velocity.z - initial.velocity.z,
          },
        },
      }, null, 2)
      return { vehicles: [vehicle] }
    },
  }
}

const mountVehicleScenario = (
  context: Parameters<ScenarioDefinition['mount']>[0],
  setup: Readonly<{
    type: Vehicle['type']
    world: WorldSpec
    condition: string
    poweredRail?: boolean
    controls?: Readonly<{ throttle: number; steering: number }>
  }>,
) => {
  const observer = vehicleObserver(context.root, setup.type, setup.condition)
  const mounted = mountGameplayScenario(context, {
    world: setup.world,
    bounds: { width: 10, height: 70 },
    observe: observer.observe,
  })

  if (setup.poweredRail !== undefined) {
    for (let x = 0; x <= 6; x += 1) mounted.setPoweredRailAt(at(x, 64), setup.poweredRail)
  }

  const vehicle = mounted.spawnVehicle(
    setup.type,
    'overworld',
    position(PositionAxis(0.5), PositionAxis(64), PositionAxis(0.5)),
    -Math.PI / 2,
  )
  mounted.mountVehicle(vehicle.id, `${context.scenarioId}:rider`)
  if (setup.controls !== undefined) mounted.setVehicleControls(vehicle.id, setup.controls)
  observer.setInitial(vehicle)
  return mounted
}

const formatPlayerPosition = (pose: ObservedGameplayPlayerPose): string =>
  `${pose.dimension} ${String(pose.position.x)}, ${String(pose.position.y)}, ${String(pose.position.z)}`

type PortalDestination = Readonly<{
  dimension: string
  position: Readonly<{ x: number; y: number; z: number }>
}>

const portalWorldUnsupported =
  'The preview Site uses one world store and does not materialize destination-dimension blocks.'

const portalObserver = (
  root: HTMLElement,
  source: 'nether' | 'end',
  expectedDimension: 'nether' | 'end',
): ((site: Site) => ScenarioObservation) => {
  const document = root.ownerDocument
  const section = document.createElement('section')
  section.setAttribute('aria-label', 'Portal travel observation')
  const heading = document.createElement('h2')
  heading.textContent = 'Portal travel'
  const details = document.createElement('pre')
  details.setAttribute('aria-label', 'Portal event and authoritative player pose')
  section.append(heading, details)
  root.append(section)

  return (site) => {
    let eventDestination: PortalDestination | undefined
    if (source === 'nether') {
      const travel = runBrowserDebugEffect(Ref.get(site.state.portalTravels)).at(-1)
      if (travel !== undefined) {
        eventDestination = {
          dimension: travel.plan.toDimension,
          position: {
            x: travel.plan.destination.x,
            y: travel.plan.destination.y,
            z: travel.plan.destination.z,
          },
        }
      }
    } else {
      const travel = runBrowserDebugEffect(Ref.get(site.state.endPortalTravels)).at(-1)
      if (travel !== undefined) {
        eventDestination = {
          dimension: travel.toDimension,
          position: { x: travel.destination.x, y: travel.destination.y, z: travel.destination.z },
        }
      }
    }

    const playerPose = runBrowserDebugEffect(site.observePlayerPose())
    const playerTravelApplied = eventDestination !== undefined
      && eventDestination.dimension === expectedDimension
      && playerPose.dimension === eventDestination.dimension
      && playerPose.position.x === eventDestination.position.x
      && playerPose.position.y === eventDestination.position.y
      && playerPose.position.z === eventDestination.position.z
    const unsupported = eventDestination !== undefined && !playerTravelApplied
      ? [`The ${source} portal event targets ${eventDestination.dimension} ${eventDestination.position.x}, ${eventDestination.position.y}, ${eventDestination.position.z}, but the authoritative player pose is ${formatPlayerPosition(playerPose)}.`]
      : undefined
    details.textContent = JSON.stringify({
      portalTravelEvent: eventDestination ?? null,
      authoritativePlayerPose: playerPose,
      playerTravelApplied,
    }, null, 2)

    return {
      playerPose,
      playerPosition: formatPlayerPosition(playerPose),
      ...(unsupported === undefined ? {} : { unsupported }),
    }
  }
}

const portalScenario = (
  source: 'nether' | 'end',
  portalBlock: BlockId,
): ScenarioDefinition => ({
  id: `${source}-portal-travel`,
  title: `${source === 'nether' ? 'Nether' : 'End'} portal travel`,
  area: 'vehicles-portals',
  isDefault: false,
  mount: (context) => mountGameplayScenario(context, {
    world: world([[0, 64, portalBlock], [-1, 63, STONE]]),
    bounds: { width: 3, height: 70 },
    unsupported: [portalWorldUnsupported],
    observe: portalObserver(context.root, source, source),
  }),
})

export const vehiclePortalScenarios: ReadonlyArray<ScenarioDefinition> = [
  {
    id: 'rail-route',
    title: 'Unpowered rail',
    area: 'vehicles-portals',
    isDefault: false,
    mount: (context) => mountVehicleScenario(context, {
      type: 'minecart',
      world: trackWorld(block('powered_rail')),
      condition: 'powered rail explicitly off; the minecart should remain still',
      poweredRail: false,
    }),
  },
  {
    id: 'minecart-route',
    title: 'Minecart on powered rail',
    area: 'vehicles-portals',
    isDefault: false,
    mount: (context) => mountVehicleScenario(context, {
      type: 'minecart',
      world: trackWorld(block('powered_rail')),
      condition: 'powered rail explicitly on; expected motion is +X',
      poweredRail: true,
    }),
  },
  {
    id: 'boat-waterway',
    title: 'Boat on water',
    area: 'vehicles-portals',
    isDefault: false,
    mount: (context) => mountVehicleScenario(context, {
      type: 'boat',
      world: waterwayWorld(),
      condition: 'throttle 1 on a waterway; expected motion is +X',
      controls: { throttle: 1, steering: 0 },
    }),
  },
  portalScenario('nether', block('nether_portal')),
  portalScenario('end', END_PORTAL_BLOCK.PORTAL),
]
