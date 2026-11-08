import {
  AIR_BLOCK_ID,
  AngleRadians,
  BlockAxis,
  CHUNK_SIZE_XZ,
  DimensionIdSchema,
  InterpolationFraction,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTickSchema,
  blockIdOf,
  blockPosition,
  type ChunkCoord,
  maxStackCountForItem,
  position,
  type BlockId,
  type BlockPosition,
  type ItemType,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  FishingElapsedTicksSchema,
  FishingWaitTicksSchema,
  SNOWBALL_PROFILE,
  type ProjectileLaunch,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Option, Ref, Schema } from 'effect'
import { runBrowserDebugEffect } from '../entrypoint.js'
import { CHUNK_VOLUME, blockIndex, type Chunk, type ReadonlyChunk } from '@nerima-games/mc-worldgen'
import { chunkCoordsAround } from '../../../src/domain/chunk-window.js'
import { PORTAL_WINDOW_RADIUS } from '../../../src/domain/interactions/ignite-portal.js'
import { CREEPER_KIND, type MobSpawnAttempt } from '../../../src/domain/entities/mob-frame.js'
import { SkyLightLevel } from '../../../src/domain/mob/hostile-spawn.js'
import { ZOMBIE_KIND } from '../../../src/domain/mob/hostile-combat.js'
import { requestMobSpawn } from '../../../src/stages/registration.js'
import {
  requestBucketUse,
  requestDroppedItemPickup,
  requestFoodUse,
  requestStatusEffect,
  setPortalCandidates,
} from '../../../src/stages/registration-core.js'
import {
  FRAME_DELTA,
  requestBreak,
  requestItemUse,
  stepFrame,
  type Site,
} from '../../preview-mining-site/site.js'
import { FIRE, SAND, STONE, type WorldSpec } from '../../preview-mining-site/world.js'
import { INVENTORY_SLOT_COUNT } from '../../preview-mining-site/inventory.js'
import { PORTAL_ACTIVATION_SECS, PORTAL_REENTRY_COOLDOWN_SECS } from '../../../src/domain/portal-dwell.js'
import {
  mountGameplayScenario,
  type ScenarioDefinition,
  type ScenarioMount,
  type ScenarioSetup,
} from '../contract.js'

const block = (name: Parameters<typeof blockIdOf>[0]): BlockId => Option.getOrThrow(blockIdOf(name))
const DIRT = block('dirt')
const LAVA = block('lava')
const WATER = block('water')
const OBSIDIAN = block('obsidian')
const NETHER_PORTAL = block('nether_portal')
const TICKS_PER_DAY = 24_000

const at = (x: number, y: number, z = 0): BlockPosition =>
  blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

const point = (x: number, y: number, z = 0) =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))

const row = (start: number, end: number, y: number, blockId: BlockId): WorldSpec['cells'] =>
  Array.from(
    { length: end - start + 1 },
    (_, index): WorldSpec['cells'][number] => [start + index, y, blockId],
  )

const world = (cells: WorldSpec['cells'], loadedChunks: ReadonlyArray<string> = ['0,0']): WorldSpec => ({
  cells,
  loadedChunks,
  z: 0,
})

const frame = (site: Site): void => {
  runBrowserDebugEffect(stepFrame(site))
}

const advanceFrames = (site: Site, count: number): void => {
  for (let index = 0; index < count; index += 1) frame(site)
}

const advanceUntil = (
  site: Site,
  complete: () => boolean,
  operation: string,
  maxFrames = 600,
): void => {
  let elapsed = 0
  while (!complete() && elapsed < maxFrames) {
    frame(site)
    elapsed += 1
  }
  if (!complete()) throw new Error(`browser-debug: ${operation} did not complete within ${String(maxFrames)} frames`)
}

const inventoryCount = (site: Site, item: ItemType): number =>
  runBrowserDebugEffect(site.observePlayerStorage()).inventory.slots.reduce(
    (count, slot) => count + (slot?.item === item ? slot.count : 0),
    0,
  )

const setTime = (site: Site, ticks: number): void => {
  const fraction = InterpolationFraction(ticks / TICKS_PER_DAY)
  runBrowserDebugEffect(site.time.setTimeOfDay(fraction))
  runBrowserDebugEffect(Ref.set(site.state.timeOfDay, fraction))
}

const x01Support = at(0, 63)
const x01SandTop = at(0, 64)
const x01SandRest = at(0, 63)
const x01Phases = new WeakMap<Site, string>()

const x01Setup: ScenarioSetup = {
  world: world([...row(0, 4, 62, STONE), [0, 63, DIRT], [0, 64, SAND]]),
  bounds: { width: 5, height: 66 },
  actions: [
    {
      id: 'x01-mine-support',
      label: 'Mine the dirt support and expose the falling sand and drop',
      perform: (site) => {
        const fullStackCount = maxStackCountForItem('stone') * INVENTORY_SLOT_COUNT
        runBrowserDebugEffect(site.setInventory([['stone', fullStackCount]]))
        runBrowserDebugEffect(requestBreak(site, x01Support))
        advanceFrames(site, 3)
        const support = site.world.peekBlock(x01Support)
        const sandTop = site.world.peekBlock(x01SandTop)
        const drops = runBrowserDebugEffect(site.observeDroppedItems())
        if (support !== SAND || sandTop !== AIR_BLOCK_ID || drops[0]?.item !== 'dirt') {
          throw new Error('browser-debug: mining did not drop dirt and settle the sand into its support cell')
        }
        x01Phases.set(site, 'support mined; sand settled; dirt drop is on the ground')
      },
    },
    {
      id: 'x01-pick-up-drop',
      label: 'Free one slot and pick up the dirt drop',
      perform: (site) => {
        runBrowserDebugEffect(site.setInventory([['stone', 1]]))
        const pose = runBrowserDebugEffect(site.observePlayerPose())
        runBrowserDebugEffect(requestDroppedItemPickup(site.state, {
          actor: EntityId('browser-debug:x01-player'),
          tick: Schema.decodeUnknownSync(SimulationTickSchema)(0),
          position: {
            x: pose.position.x,
            y: pose.position.y,
            z: pose.position.z,
          },
        }))
        advanceFrames(site, 4)
        const drops = runBrowserDebugEffect(site.observeDroppedItems())
        if (inventoryCount(site, 'dirt') !== 1 || drops.length !== 0) {
          throw new Error('browser-debug: dirt drop did not move into player storage')
        }
        x01Phases.set(site, 'dirt is in player storage; crafting remains unsupported')
      },
    },
  ],
  unsupported: [
    'Crafting is unsupported: no craft request is called from the gameplay stages and the Site contract has no craft API. Evidence: src/stages/interactions-stage.ts:2066-2112; `rg -n \'craft\' src/stages` exited 1 (T-X report, X-01).',
  ],
  observe: (site) => ({
    droppedItems: runBrowserDebugEffect(site.observeDroppedItems()),
    equipment: {
      phase: x01Phases.get(site) ?? 'ready to mine',
      supportBlock: String(site.world.peekBlock(x01Support)),
      fallingBlockCell: String(site.world.peekBlock(x01SandTop)),
      settledSandCell: String(site.world.peekBlock(x01SandRest)),
      dirtInPlayerStorage: inventoryCount(site, 'dirt'),
    },
  }),
}

const x02Support = at(23, 64)
const x02Sand = at(23, 65)
const x02Phases = new WeakMap<Site, string>()
const x02CreeperAttempt = (site: Site): MobSpawnAttempt => ({
  candidate: {
    dimension: 'overworld',
    groundBlock: STONE,
    footBlock: AIR_BLOCK_ID,
    headBlock: AIR_BLOCK_ID,
    blockLight: 0,
    skyLight: SkyLightLevel(15),
    biome: 'PLAINS',
    timeOfDay: Number(runBrowserDebugEffect(site.time.timeOfDay)),
    distanceToPlayerBlocksXZ: 24,
  },
  kind: CREEPER_KIND,
  feetPosition: point(24, 64, 0),
})
const x02ZombieAttempt = (site: Site): MobSpawnAttempt => ({
  candidate: {
    dimension: 'overworld',
    groundBlock: STONE,
    footBlock: AIR_BLOCK_ID,
    headBlock: AIR_BLOCK_ID,
    blockLight: 0,
    skyLight: SkyLightLevel(15),
    biome: 'PLAINS',
    timeOfDay: Number(runBrowserDebugEffect(site.time.timeOfDay)),
    distanceToPlayerBlocksXZ: 25,
  },
  kind: ZOMBIE_KIND,
  feetPosition: point(25, 64, 0),
})

const x02Setup: ScenarioSetup = {
  world: world([...row(0, 26, 63, STONE), [23, 64, STONE], [23, 65, SAND]], ['0,0', '1,0']),
  bounds: { width: 27, height: 68 },
  actions: [
    {
      id: 'x02-spawn-mobs',
      label: 'Spawn a creeper and zombie, then inspect the intact sand pillar',
      perform: (site) => {
        runBrowserDebugEffect(Ref.set(site.state.rollSeed, 3))
        runBrowserDebugEffect(requestMobSpawn(site.state, x02CreeperAttempt(site)))
        runBrowserDebugEffect(requestMobSpawn(site.state, x02ZombieAttempt(site)))
        frame(site)
        const mobs = runBrowserDebugEffect(site.observeMobs())
        if (
          mobs.length < 2 ||
          !mobs.some(({ kind }) => kind === CREEPER_KIND) ||
          !mobs.some(({ kind }) => kind === ZOMBIE_KIND) ||
          site.world.peekBlock(x02Support) !== STONE ||
          site.world.peekBlock(x02Sand) !== SAND
        ) {
          throw new Error(`browser-debug: Creeper and Zombie did not spawn before the sand pillar blast; time=${String(runBrowserDebugEffect(site.time.timeOfDay))}; mobs=${JSON.stringify(mobs)}`)
        }
        x02Phases.set(site, 'Creeper and Zombie spawned; sand pillar is intact before the blast')
      },
    },
    {
      id: 'x02-explode-pillar',
      label: 'Advance until the creeper blast drops rotten flesh and settles the sand',
      perform: (site) => {
        runBrowserDebugEffect(site.movePlayerTo(point(23, 65, 0)))
        try {
          advanceUntil(
            site,
            () => site.world.peekBlock(x02Support) === SAND &&
              runBrowserDebugEffect(site.observeDroppedItems()).some(({ item }) => item === 'rotten_flesh'),
            'creeper blast, Mob loot, and falling sand',
          )
        } catch (error) {
          const mobs = runBrowserDebugEffect(site.observeMobs())
          const droppedItems = runBrowserDebugEffect(site.observeDroppedItems())
          const player = runBrowserDebugEffect(site.observePlayerPose())
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`${message}; player=${JSON.stringify(player)}; mobs=${JSON.stringify(mobs)}; drops=${JSON.stringify(droppedItems)}; support=${String(site.world.peekBlock(x02Support))}; sand=${String(site.world.peekBlock(x02Sand))}`)
        }
        advanceFrames(site, 2)
        const drops = runBrowserDebugEffect(site.observeDroppedItems())
        if (
          site.world.peekBlock(x02Support) !== SAND ||
          site.world.peekBlock(x02Sand) !== AIR_BLOCK_ID ||
          !drops.some(({ item, count }) => item === 'rotten_flesh' && count === 2)
        ) {
          throw new Error('browser-debug: explosion did not produce rotten flesh and settle the falling sand')
        }
        x02Phases.set(site, 'creeper blast committed; Mob loot is on the ground; sand settled')
      },
    },
  ],
  observe: (site) => ({
    droppedItems: runBrowserDebugEffect(site.observeDroppedItems()),
    mobs: runBrowserDebugEffect(site.observeMobs()),
    equipment: {
      phase: x02Phases.get(site) ?? 'sand pillar and Mob are staged for the blast',
      supportCell: String(site.world.peekBlock(x02Support)),
      sandAtOriginalCell: String(site.world.peekBlock(x02Sand)),
      sandSettledAtSupport: site.world.peekBlock(x02Support) === SAND,
      note: 'Sand blocks do not create loot; the observed drop is Mob loot.',
    },
  }),
}

const x03WaterAt = at(0, 64)
const x03LavaAt = at(1, 64)
const x03Phases = new WeakMap<Site, string>()

const x03Setup: ScenarioSetup = {
  world: world([...row(0, 4, 63, STONE), [1, 64, LAVA]]),
  bounds: { width: 5, height: 66 },
  actions: [
    {
      id: 'x03-load-water-bucket',
      label: 'Prepare a water bucket and inspect the unchanged lava source',
      perform: (site) => {
        runBrowserDebugEffect(site.setInventory([['water_bucket', 1]]))
        frame(site)
        if (
          site.world.peekBlock(x03WaterAt) !== undefined ||
          site.world.peekBlock(x03LavaAt) !== LAVA ||
          inventoryCount(site, 'water_bucket') !== 1
        ) {
          throw new Error('browser-debug: water bucket setup changed lava before use')
        }
        x03Phases.set(site, 'water bucket ready; lava source remains unchanged')
      },
    },
    {
      id: 'x03-pour-water-bucket',
      label: 'Pour the prepared water bucket beside the lava source',
      perform: (site) => {
        runBrowserDebugEffect(requestBucketUse(site.state, 'browser-debug:x03-water-bucket', x03WaterAt, 'water_bucket', 'overworld'))
        frame(site)
        if (site.world.peekBlock(x03WaterAt) !== WATER || site.world.peekBlock(x03LavaAt) !== OBSIDIAN) {
          throw new Error('browser-debug: water bucket did not convert adjacent lava to obsidian')
        }
        if (inventoryCount(site, 'bucket') !== 1) {
          throw new Error('browser-debug: water bucket did not return an empty bucket')
        }
        x03Phases.set(site, 'water placed; lava source became obsidian; empty bucket returned')
      },
    },
  ],
  observe: (site) => ({
    equipment: {
      phase: x03Phases.get(site) ?? 'lava source awaits a water bucket',
      waterCell: String(site.world.peekBlock(x03WaterAt)),
      lavaCell: String(site.world.peekBlock(x03LavaAt)),
      waterBuckets: inventoryCount(site, 'water_bucket'),
      emptyBuckets: inventoryCount(site, 'bucket'),
    },
  }),
}

export const crossAreaNoWaterSetup: ScenarioSetup = {
  world: x03Setup.world,
  bounds: x03Setup.bounds,
  actions: [{
    id: 'x03-no-bucket-control',
    label: 'Advance without a bucket input',
    perform: (site) => {
      frame(site)
      if (site.world.peekBlock(x03WaterAt) !== undefined || site.world.peekBlock(x03LavaAt) !== LAVA) {
        throw new Error('browser-debug: lava changed without the water-bucket request')
      }
    },
  }],
  observe: (site) => ({
    equipment: {
      control: 'no bucket request was submitted',
      waterCell: String(site.world.peekBlock(x03WaterAt)),
      lavaRemains: site.world.peekBlock(x03LavaAt) === LAVA,
    },
  }),
}

const x04FireAt = at(0, 64)
const x04VehicleIds = new WeakMap<Site, string>()
const x04Phases = new WeakMap<Site, string>()
const x04PortalWindowChunks = chunkCoordsAround(x04FireAt, PORTAL_WINDOW_RADIUS)
const x04PortalWindowKeys = x04PortalWindowChunks.map(({ cx, cz }) => `${String(cx)},${String(cz)}`)

const installX04ChunkWindow = (site: Site): void => {
  const chunks = new Map<string, Chunk>()
  for (const coord of x04PortalWindowChunks) {
    const blocks = new Uint16Array(CHUNK_VOLUME)
    blocks.fill(AIR_BLOCK_ID)
    chunks.set(`${String(coord.cx)},${String(coord.cz)}`, {
      coord,
      blocks,
      biomes: Array.from(
        { length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ },
        (): Chunk['biomes'][number] => 'PLAINS',
      ),
    })
  }
  for (const [x, y, blockId] of site.spec.cells) {
    const chunkX = Math.floor(x / CHUNK_SIZE_XZ)
    const chunkZ = Math.floor(site.spec.z / CHUNK_SIZE_XZ)
    const chunk = chunks.get(`${String(chunkX)},${String(chunkZ)}`)
    if (chunk === undefined) throw new Error('browser-debug: fire fixture cell is outside its portal chunk window')
    chunk.blocks[blockIndex(
      x - chunkX * CHUNK_SIZE_XZ,
      y,
      site.spec.z - chunkZ * CHUNK_SIZE_XZ,
    )] = blockId
  }
  const peek = (coord: ChunkCoord): Effect.Effect<ReadonlyChunk | undefined> =>
    Effect.succeed(chunks.get(`${String(coord.cx)},${String(coord.cz)}`))
  Object.defineProperty(site.world.api, 'peek', {
    configurable: true,
    writable: true,
    value: peek,
  })
}

const x04Setup: ScenarioSetup = {
  world: world([...row(0, 2, 63, STONE), [1, 64, block('oak_planks')]], x04PortalWindowKeys),
  bounds: { width: 4, height: 66 },
  actions: [
    {
      id: 'x04-place-vehicle',
      label: 'Place a minecart on the fire contact cell',
      perform: (site) => {
        const vehicle = runBrowserDebugEffect(site.spawnVehicle('minecart', 'overworld', point(0, 64, 0)))
        x04VehicleIds.set(site, vehicle.id)
        x04Phases.set(site, 'minecart occupies the intended fire contact cell')
      },
    },
    {
      id: 'x04-ignite-fire',
      label: 'Ignite the cell and advance a real gameplay frame',
      perform: (site) => {
        installX04ChunkWindow(site)
        runBrowserDebugEffect(site.setInventory([['fire_charge', 1]]))
        runBrowserDebugEffect(requestItemUse(site, x04FireAt, 'fire_charge'))
        frame(site)
        const vehicleId = x04VehicleIds.get(site)
        const vehicles = runBrowserDebugEffect(site.observeVehicles())
        if (site.world.peekBlock(x04FireAt) !== FIRE || vehicleId === undefined || !vehicles.some(({ id }) => id === vehicleId)) {
          throw new Error('browser-debug: fire did not commit beside the observed vehicle')
        }
        if (inventoryCount(site, 'fire_charge') !== 0) {
          throw new Error('browser-debug: successful fire-charge use did not consume the charge')
        }
        x04Phases.set(site, 'fire committed; vehicle remains observable; vehicle contact damage is unsupported')
      },
    },
  ],
  unsupported: [
    'Fire contact with vehicles is unsupported: the registered fire lifecycle contacts burning actors and gameplay entities but does not wire vehicle contact. Evidence: src/domain/fire-lifecycle.ts:39-45,198-263 (T-X report, X-04).',
  ],
  observe: (site) => ({
    vehicles: runBrowserDebugEffect(site.observeVehicles()),
    equipment: {
      phase: x04Phases.get(site) ?? 'place the vehicle before igniting fire',
      fireCell: String(site.world.peekBlock(x04FireAt)),
      fireChargeRemaining: inventoryCount(site, 'fire_charge'),
    },
  }),
}

const x05Phases = new WeakMap<Site, string>()
const x05SpawnedMobIds = new WeakMap<Site, string>()
const x05SpawnAttempt = (site: Site): MobSpawnAttempt => ({
  candidate: {
    dimension: 'overworld',
    groundBlock: STONE,
    footBlock: AIR_BLOCK_ID,
    headBlock: AIR_BLOCK_ID,
    blockLight: 0,
    skyLight: SkyLightLevel(15),
    biome: 'PLAINS',
    timeOfDay: Number(runBrowserDebugEffect(site.time.timeOfDay)),
    distanceToPlayerBlocksXZ: Math.hypot(30.5, 0.5),
  },
  kind: CREEPER_KIND,
  feetPosition: point(30.5, 64, 0.5),
})

const x05Setup: ScenarioSetup = {
  world: world(row(0, 31, 63, STONE), ['0,0', '1,0']),
  bounds: { width: 32, height: 68 },
  actions: [
    {
      id: 'x05-spawn-at-night',
      label: 'Spawn a hostile Mob during night and advance one frame',
      perform: (site) => {
        runBrowserDebugEffect(requestMobSpawn(site.state, x05SpawnAttempt(site)))
        frame(site)
        const mob = runBrowserDebugEffect(site.observeMobs()).find(({ kind }) => kind === CREEPER_KIND)
        if (mob === undefined) throw new Error('browser-debug: night spawn did not produce a creeper')
        x05SpawnedMobIds.set(site, mob.id)
        x05Phases.set(site, 'hostile Mob spawned at night')
      },
    },
    {
      id: 'x05-advance-to-daylight',
      label: 'Set daylight, run a real frame, and observe the same Mob',
      perform: (site) => {
        const mobId = x05SpawnedMobIds.get(site)
        if (mobId === undefined) throw new Error('browser-debug: spawn the night Mob before advancing daylight')
        setTime(site, 6_000)
        frame(site)
        const mob = runBrowserDebugEffect(site.observeMobs()).find(({ id }) => id === mobId)
        if (mob === undefined) throw new Error('browser-debug: expected Mob remains present after daylight')
        x05Phases.set(site, 'same hostile Mob remains after daylight; dawn despawn is unsupported')
      },
    },
  ],
  unsupported: [
    'Dawn-triggered despawn is unsupported: the despawn verdict has no time-of-day condition. Evidence: src/domain/entities/mob-frame.ts:1293-1330 (T-X report, X-05).',
  ],
  observe: (site) => ({
    mobs: runBrowserDebugEffect(site.observeMobs()),
    equipment: {
      phase: x05Phases.get(site) ?? 'set night, then spawn a hostile Mob',
      timeOfDay: Math.round(Number(runBrowserDebugEffect(site.time.timeOfDay)) * TICKS_PER_DAY),
      spawnedMobId: x05SpawnedMobIds.get(site),
    },
  }),
}

const x06Water = block('water')
const x06FishingActor = EntityId('browser-debug:x06-angler')
const x06FishingBobber = Schema.decodeUnknownSync(ProjectileIdSchema)('browser-debug:x06-bobber')
const x06FishingLaunch: ProjectileLaunch = {
  position: point(0, 64, 0),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: Brand.nominal<ProjectileLaunch['speed']>()(1),
}
const x06Phases = new WeakMap<Site, string>()
const x06WaitTicks = new WeakMap<Site, number>()

const x06Setup: ScenarioSetup = {
  world: world([...row(0, 7, 63, STONE), [2, 64, x06Water]]),
  bounds: { width: 8, height: 66 },
  actions: [
    {
      id: 'x06-cast-in-rain',
      label: 'Cast into open water while rain is active',
      perform: (site) => {
        runBrowserDebugEffect(site.setInventory([['fishing_rod', 1]]))
        runBrowserDebugEffect(site.requestFishingCast({
          requestId: 'browser-debug:x06-cast',
          actor: x06FishingActor,
          bobber: x06FishingBobber,
          tick: Schema.decodeUnknownSync(SimulationTickSchema)(0),
          dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'),
          launch: x06FishingLaunch,
          profile: SNOWBALL_PROFILE,
          rod: null,
          environment: { hasWater: true, hasSkyAccess: true, isRaining: true, isOpenWater: true },
        }))
        frame(site)
        const rod = runBrowserDebugEffect(site.observeFishingState()).rods.find(({ actor }) => actor === x06FishingActor)
        if (rod?.phase !== 'cast' || rod.bobber !== x06FishingBobber) {
          throw new Error('browser-debug: rain fishing cast was not observed')
        }
        x06Phases.set(site, 'rod is cast in rain; rain-shortened wait remains unsupported')
      },
    },
    {
      id: 'x06-advance-with-explicit-wait',
      label: 'Advance using the explicit fishing wait request',
      perform: (site) => {
        const waitTicks = 100
        runBrowserDebugEffect(site.requestFishingAdvance({
          requestId: 'browser-debug:x06-advance',
          actor: x06FishingActor,
          elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(120),
          waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(waitTicks),
          approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
          biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
          environment: { hasWater: true },
        }))
        frame(site)
        const rod = runBrowserDebugEffect(site.observeFishingState()).rods.find(({ actor }) => actor === x06FishingActor)
        if (rod?.phase !== 'bite') throw new Error('browser-debug: explicit fishing wait did not reach a bite')
        x06WaitTicks.set(site, waitTicks)
        x06Phases.set(site, 'bite reached after an explicit wait; no automatic rain adjustment was applied')
      },
    },
    {
      id: 'x06-reel-catch',
      label: 'Reel in and observe the caught item',
      perform: (site) => {
        runBrowserDebugEffect(site.requestFishingReel('browser-debug:x06-reel', x06FishingActor))
        frame(site)
        const rodCount = runBrowserDebugEffect(site.observeFishingState()).rods.length
        const storage = runBrowserDebugEffect(site.observePlayerStorage())
        const caughtItems = storage.inventory.slots.filter((slot) => slot !== undefined && slot.item !== 'fishing_rod')
        if (rodCount !== 0 || caughtItems.length === 0) {
          throw new Error('browser-debug: fishing reel did not settle a catch into player storage')
        }
        x06Phases.set(site, 'catch committed to player storage; rain wait shortening remains unsupported')
      },
    },
  ],
  unsupported: [
    'Rain shortening is unsupported: the fishing advance stage forwards water availability but not weather or raining state to the fishing service. Evidence: src/stages/interactions-stage.ts:748-752,812-821 (T-X report, X-06).',
  ],
  observe: (site) => ({
    equipment: {
      phase: x06Phases.get(site) ?? 'set rain, then cast into open water',
      weather: site.weather.weather,
      fishing: runBrowserDebugEffect(site.observeFishingState()),
      explicitlyRequestedWaitTicks: x06WaitTicks.get(site),
      catchInPlayerStorage: runBrowserDebugEffect(site.observePlayerStorage()).inventory.slots
        .filter((slot) => slot !== undefined && slot.item !== 'fishing_rod'),
    },
  }),
}

const x07OverworldPortal = at(0, 64)
const x07NetherPortal = at(1, 64)
const x07ActivationFrames = Math.ceil(PORTAL_ACTIVATION_SECS / Number(FRAME_DELTA)) + 1
const x07CooldownFrames = Math.ceil(PORTAL_REENTRY_COOLDOWN_SECS / Number(FRAME_DELTA))
const x07Phases = new WeakMap<Site, string>()

const x07Setup: ScenarioSetup = {
  world: world([...row(-1, 2, 63, STONE), [0, 64, NETHER_PORTAL], [1, 64, NETHER_PORTAL]]),
  bounds: { width: 4, height: 70 },
  actions: [
    {
      id: 'x07-configure-portals',
      label: 'Provide the overworld and Nether portal candidates',
      perform: (site) => {
        runBrowserDebugEffect(setPortalCandidates(site.state, 'nether', [x07NetherPortal]))
        runBrowserDebugEffect(setPortalCandidates(site.state, 'overworld', [x07OverworldPortal]))
        frame(site)
        x07Phases.set(site, 'both portal candidates are registered; player remains in the overworld')
      },
    },
    {
      id: 'x07-travel-to-nether',
      label: 'Stand in the overworld portal for its activation interval',
      perform: (site) => {
        advanceFrames(site, x07ActivationFrames)
        const pose = runBrowserDebugEffect(site.observePlayerPose())
        if (pose.dimension !== 'nether') throw new Error('browser-debug: portal did not change the player to Nether')
        x07Phases.set(site, 'portal travel reached Nether; observed player pose and source portal')
      },
    },
    {
      id: 'x07-return-overworld',
      label: 'Wait through portal cooldown and return to the overworld',
      perform: (site) => {
        advanceFrames(site, x07CooldownFrames + x07ActivationFrames)
        const pose = runBrowserDebugEffect(site.observePlayerPose())
        if (pose.dimension !== 'overworld') throw new Error('browser-debug: portal did not return the player to Overworld')
        x07Phases.set(site, 'round trip complete; chunk-window refresh is unsupported')
      },
    },
  ],
  unsupported: [
    'Chunk-window travel cannot be verified: the Site exposes only the initial chunk snapshot and has no `observeChunkWindow` API for a portal-triggered refresh. The portal stage applies player pose and dimension without a chunk-window update. Evidence: src/stages/registration-core.ts:2164-2193,2240-2297 (T-X report, X-07).',
  ],
  observe: (site) => {
    const playerPose = runBrowserDebugEffect(site.observePlayerPose())
    return {
      playerPose,
      playerPosition: `${playerPose.dimension} ${String(playerPose.position.x)}, ${String(playerPose.position.y)}, ${String(playerPose.position.z)}`,
      equipment: {
      phase: x07Phases.get(site) ?? 'player starts at the overworld portal',
      overworldPortal: String(site.world.peekBlock(x07OverworldPortal)),
      netherPortal: String(site.world.peekBlock(x07NetherPortal)),
      initialChunkSnapshot: site.world.loadedChunkKeys(),
      },
    }
  },
}

const x08Phases = new WeakMap<Site, string>()
const x08Health = new WeakMap<Site, Readonly<{ beforePulse: number; afterPulse: number }>>()
const x08FoodHunger = new WeakMap<Site, Readonly<{ beforeUse: number; afterFood: number }>>()

const x08Setup: ScenarioSetup = {
  world: world(row(0, 4, 63, STONE)),
  bounds: { width: 5, height: 66 },
  actions: [
    {
      id: 'x08-apply-poison',
      label: 'Apply poison and advance one real frame',
      perform: (site) => {
        runBrowserDebugEffect(requestStatusEffect(site.state, { type: 'poison', durationSecs: 5 }))
        frame(site)
        x08Phases.set(site, 'poison request accepted by the status-effect stage')
      },
    },
    {
      id: 'x08-eat-cod',
      label: 'Reduce hunger, then use cod while poisoned',
      perform: (site) => {
        runBrowserDebugEffect(site.setInventory([['cod', 1]]))
        runBrowserDebugEffect(site.state.survivalHunger.addExhaustion(40))
        const before = runBrowserDebugEffect(site.state.survivalHunger.snapshot).vitals
        runBrowserDebugEffect(requestFoodUse(site.state, 'browser-debug:x08-cod', 'cod', {
          healthPoints: before.healthPoints,
          hungerPoints: before.hungerPoints,
          maxHungerPoints: before.maxHungerPoints,
        }))
        frame(site)
        const afterFood = runBrowserDebugEffect(site.state.survivalHunger.snapshot).vitals
        if (inventoryCount(site, 'cod') !== 0 || Number(afterFood.hungerPoints) <= Number(before.hungerPoints)) {
          throw new Error('browser-debug: food use did not consume cod and restore hunger')
        }
        x08FoodHunger.set(site, {
          beforeUse: Number(before.hungerPoints),
          afterFood: Number(afterFood.hungerPoints),
        })
        x08Health.set(site, {
          beforePulse: Number(afterFood.healthPoints),
          afterPulse: Number(afterFood.healthPoints),
        })
        x08Phases.set(site, 'cod consumed; hunger increased while poison remained active')
      },
    },
    {
      id: 'x08-observe-poison-pulse',
      label: 'Advance one second of real frames and observe the poison damage pulse',
      perform: (site) => {
        const before = x08Health.get(site)
        if (before === undefined) throw new Error('browser-debug: eat cod before observing the poison pulse')
        advanceFrames(site, 60)
        const afterPulse = Number(runBrowserDebugEffect(site.state.survivalHunger.snapshot).vitals.healthPoints)
        if (afterPulse >= before.beforePulse) throw new Error('browser-debug: poison pulse did not reduce health')
        x08Health.set(site, { ...before, afterPulse })
        x08Phases.set(site, 'food changed hunger and inventory; poison pulse reduced health afterward')
      },
    },
  ],
  observe: (site) => ({
    statusEffects: {
      pendingApplications: runBrowserDebugEffect(Ref.get(site.state.pendingStatusEffects)),
      poisonPulse: x08Health.get(site),
    },
    equipment: {
      phase: x08Phases.get(site) ?? 'apply poison, then use food',
      codRemaining: inventoryCount(site, 'cod'),
      foodHunger: x08FoodHunger.get(site),
      vitals: runBrowserDebugEffect(site.state.survivalHunger.snapshot).vitals,
    },
  }),
}

export type CrossAreaSetupId = 'x01' | 'x02' | 'x03' | 'x04' | 'x05' | 'x06' | 'x07' | 'x08'

export const crossAreaSetups: Readonly<Record<CrossAreaSetupId, ScenarioSetup>> = {
  x01: x01Setup,
  x02: x02Setup,
  x03: x03Setup,
  x04: x04Setup,
  x05: x05Setup,
  x06: x06Setup,
  x07: x07Setup,
  x08: x08Setup,
}

const mountAtNight = (context: Parameters<ScenarioDefinition['mount']>[0], setup: ScenarioSetup): ScenarioMount => {
  const mounted = mountGameplayScenario(context, setup)
  mounted.setTime(21_600)
  return mounted
}

export const crossAreaScenarios: ReadonlyArray<ScenarioDefinition> = [
  {
    id: 'cross-area-x-01',
    title: 'X-01: mine support, fall sand, pick up the drop, and show the craft gap',
    area: 'cross-area',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, crossAreaSetups.x01),
  },
  {
    id: 'cross-area-x-02',
    title: 'X-02: explode a sand pillar and observe Mob loot',
    area: 'cross-area',
    isDefault: false,
    mount: (context) => mountAtNight(context, crossAreaSetups.x02),
  },
  {
    id: 'cross-area-x-03',
    title: 'X-03: pour bucket water beside lava',
    area: 'cross-area',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, crossAreaSetups.x03),
  },
  {
    id: 'cross-area-x-04',
    title: 'X-04: fire and vehicle contact gap',
    area: 'cross-area',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, crossAreaSetups.x04),
  },
  {
    id: 'cross-area-x-05',
    title: 'X-05: hostile Mob at night and daylight despawn gap',
    area: 'cross-area',
    isDefault: false,
    mount: (context) => mountAtNight(context, crossAreaSetups.x05),
  },
  {
    id: 'cross-area-x-06',
    title: 'X-06: rain fishing and wait-shortening gap',
    area: 'cross-area',
    isDefault: false,
    mount: (context) => {
      const mounted = mountGameplayScenario(context, crossAreaSetups.x06)
      mounted.setWeather('rain')
      return mounted
    },
  },
  {
    id: 'cross-area-x-07',
    title: 'X-07: Nether round trip and chunk-window gap',
    area: 'cross-area',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, crossAreaSetups.x07),
  },
  {
    id: 'cross-area-x-08',
    title: 'X-08: food while poisoned and player state changes',
    area: 'cross-area',
    isDefault: false,
    mount: (context) => mountGameplayScenario(context, crossAreaSetups.x08),
  },
]
