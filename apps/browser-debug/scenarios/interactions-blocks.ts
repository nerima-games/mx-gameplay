import {
  AIR_BLOCK_ID,
  BlockAxis,
  PositionAxis,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  maxStackCountForItem,
  position,
  type ItemType,
  type BlockId,
} from '@nerima-games/mc-kernel'
import { CREEPER_KIND, type MobSpawnAttempt } from '../../../src/domain/entities/mob-frame.js'
import { blockLoot } from '../../../src/domain/interactions/block-loot.js'
import {
  requestBlockPlacementCommand,
  requestMobSpawn,
  requestPotatoPlanting,
  requestSoilTill,
} from '../../../src/stages/registration.js'
import { Option } from 'effect'
import { runBrowserDebugEffect } from '../entrypoint.js'
import { mountGameplayScenario, type ScenarioDefinition, type ScenarioMount } from '../contract.js'
import { requestBreak, stepFrame, type Site } from '../../preview-mining-site/site.js'
import { SAND, STONE, type WorldSpec } from '../../preview-mining-site/world.js'
import { INVENTORY_SLOT_COUNT } from '../../preview-mining-site/inventory.js'

const DIRT: BlockId = Option.getOrThrow(blockIdOf('dirt'))
const FARMLAND: BlockId = Option.getOrThrow(blockIdOf('farmland'))
const POTATO_CROP: BlockId = Option.getOrThrow(blockIdOf('potato_crop'))

const at = (x: number, y: number) => blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(0))

const dirtDropFromLootRules = () => {
  const drop = blockLoot(DIRT).find(({ item }) => item === 'dirt')
  if (drop === undefined) throw new Error('browser-debug: dirt loot rule does not yield dirt')
  return drop
}

const assertDirtInPlayerStorage = (site: Site): void => {
  const expected = dirtDropFromLootRules()
  const storage = runBrowserDebugEffect(site.observePlayerStorage())
  const actualCount = storage.inventory.slots.reduce(
    (count, slot) => count + (slot?.item === expected.item ? slot.count : 0),
    0,
  )
  if (actualCount !== expected.count) {
    throw new Error(`browser-debug: expected ${String(expected.count)} ${expected.item}, observed ${String(actualCount)}`)
  }
}

const assertDirtDropAt = (site: Site, target: ReturnType<typeof at>): void => {
  const expected = dirtDropFromLootRules()
  const observed = runBrowserDebugEffect(site.observeDroppedItems()).some((drop) =>
    drop.item === expected.item &&
    drop.count === expected.count &&
    Number(drop.position.x) === Number(target.x) &&
    Number(drop.position.y) === Number(target.y) &&
    Number(drop.position.z) === Number(target.z),
  )
  if (!observed) {
    throw new Error(`browser-debug: expected ${String(expected.count)} ${expected.item} drop at ${String(target.x)},${String(target.y)},${String(target.z)}`)
  }
}

const row = (
  startX: number,
  endX: number,
  y: number,
  block: BlockId,
): ReadonlyArray<readonly [number, number, BlockId]> =>
  Array.from({ length: endX - startX + 1 }, (_, index) => [startX + index, y, block] as const)

const world = (
  cells: ReadonlyArray<readonly [number, number, BlockId]>,
  loadedChunks: ReadonlyArray<string> = ['0,0'],
): WorldSpec => ({ cells, loadedChunks, z: 0 })

const seedInventory = (mounted: ScenarioMount, items: ReadonlyArray<readonly [ItemType, number]>): void => {
  mounted.setInventory(items)
  runBrowserDebugEffect(mounted.site.inventoryService.takeDepositLog)
  mounted.site.inventory = runBrowserDebugEffect(mounted.site.inventoryService.held)
}

const fillInventoryWithStone = (mounted: ScenarioMount): void => {
  const count = maxStackCountForItem('stone') * INVENTORY_SLOT_COUNT
  seedInventory(mounted, [['stone', count]])
}

const advanceUntil = (
  site: Site,
  isComplete: () => boolean,
  operation: string,
  maxFrames = 120,
): void => {
  let frames = 0
  while (!isComplete() && frames < maxFrames) {
    runBrowserDebugEffect(stepFrame(site))
    frames += 1
  }
  if (!isComplete()) {
    throw new Error(`browser-debug: ${operation} did not complete within ${String(maxFrames)} frames`)
  }
}

const spawnCreeperAttempt: MobSpawnAttempt = {
  candidate: {
    dimension: 'overworld',
    groundBlock: STONE,
    footBlock: AIR_BLOCK_ID,
    headBlock: AIR_BLOCK_ID,
    blockLight: 0,
    timeOfDay: 0,
    distanceToPlayerBlocksXZ: 16,
  },
  kind: CREEPER_KIND,
  feetPosition: position(PositionAxis(16), PositionAxis(64), PositionAxis(0)),
}

export const interactionsBlockScenarios: ReadonlyArray<ScenarioDefinition> = [
  {
    id: 'block-mining',
    title: 'Break dirt and collect its drop',
    area: 'interactions-blocks',
    isDefault: false,
    mount: (context) =>
      mountGameplayScenario(context, {
        world: world([...row(0, 7, 63, STONE), [2, 64, DIRT]]),
        bounds: { width: 8, height: 66 },
        actions: [
          {
            id: 'mine-dirt',
            label: 'Break dirt',
            perform: (site) => {
              const target = at(2, 64)
              runBrowserDebugEffect(requestBreak(site, target))
              advanceUntil(site, () => site.world.peekBlock(target) === AIR_BLOCK_ID, 'dirt mining')
              assertDirtInPlayerStorage(site)
            },
          },
        ],
      }),
  },
  {
    id: 'block-placement',
    title: 'Place sand onto a supported block',
    area: 'interactions-blocks',
    isDefault: false,
    mount: (context) => {
      const mounted = mountGameplayScenario(context, {
        world: world([[3, 63, STONE]]),
        bounds: { width: 8, height: 66 },
        actions: [
          {
            id: 'place-sand',
            label: 'Place sand (Survival mode)',
            perform: (site) => {
              const target = at(3, 64)
              runBrowserDebugEffect(requestBlockPlacementCommand(site.state, {
                requestId: 'browser-debug-place-sand',
                positionKey: blockPositionKeyOf(target),
                heldItem: 'sand',
                mode: 'survival',
              }))
              advanceUntil(site, () => site.world.peekBlock(target) === SAND, 'sand placement')
            },
          },
        ],
      })
      seedInventory(mounted, [['sand', 1]])
      return mounted
    },
  },
  {
    id: 'block-drop-overflow',
    title: 'Mine a block with a full inventory',
    area: 'interactions-blocks',
    isDefault: false,
    mount: (context) => {
      const mounted = mountGameplayScenario(context, {
        world: world([...row(0, 7, 63, STONE), [3, 64, DIRT]]),
        bounds: { width: 8, height: 66 },
        actions: [
          {
            id: 'mine-with-full-inventory',
            label: 'Break dirt with a full inventory',
            perform: (site) => {
              const target = at(3, 64)
              runBrowserDebugEffect(requestBreak(site, target))
              advanceUntil(site, () => site.world.peekBlock(target) === AIR_BLOCK_ID, 'overflow dirt mining')
              assertDirtDropAt(site, target)
            },
          },
        ],
        unsupported: [
          'The visible Drops row reads the preview roster. This scenario asserts the authoritative dropped-item owner directly.',
        ],
        observe: (site) => ({ droppedItems: runBrowserDebugEffect(site.observeDroppedItems()) }),
      })
      fillInventoryWithStone(mounted)
      return mounted
    },
  },
  {
    id: 'block-agriculture',
    title: 'Till soil and plant a potato',
    area: 'interactions-blocks',
    isDefault: false,
    mount: (context) => {
      const soil = at(4, 64)
      const crop = at(4, 65)
      const mounted = mountGameplayScenario(context, {
        world: world([...row(0, 7, 63, STONE), [4, 64, DIRT]]),
        bounds: { width: 8, height: 66 },
        actions: [
          {
            id: 'till-soil',
            label: 'Till dirt with a wooden hoe',
            perform: (site) => {
              runBrowserDebugEffect(requestSoilTill(site.state, 'browser-debug-till-soil', soil, 'wooden_hoe'))
              advanceUntil(site, () => site.world.peekBlock(soil) === FARMLAND, 'soil tilling')
            },
          },
          {
            id: 'plant-potato',
            label: 'Plant a potato',
            perform: (site) => {
              runBrowserDebugEffect(requestPotatoPlanting(site.state, 'browser-debug-plant-potato', soil))
              advanceUntil(site, () => site.world.peekBlock(crop) === POTATO_CROP, 'potato planting')
            },
          },
        ],
      })
      seedInventory(mounted, [['wooden_hoe', 1], ['potato', 2]])
      return mounted
    },
  },
  {
    id: 'explosion-creeper-crater',
    title: 'Spawn a creeper with a nighttime candidate, then advance frames until its crater is carved',
    area: 'interactions-blocks',
    isDefault: false,
    mount: (context) =>
      mountGameplayScenario(context, {
        world: world([
          ...row(0, 21, 60, STONE),
          ...row(0, 21, 61, STONE),
          ...row(0, 21, 62, STONE),
          ...row(0, 21, 63, STONE),
        ], ['0,0', '1,0']),
        bounds: { width: 22, height: 68 },
        actions: [
          {
            id: 'spawn-creeper',
            label: 'Spawn a nighttime creeper and wait for its crater',
            perform: (site) => {
              const stoneBefore = site.world.census().get(STONE) ?? 0
              runBrowserDebugEffect(requestMobSpawn(site.state, spawnCreeperAttempt))
              advanceUntil(
                site,
                () => (site.world.census().get(STONE) ?? 0) < stoneBefore,
                'creeper crater',
                600,
              )
            },
          },
        ],
        unsupported: [
          'TNT priming is unavailable because the preview site does not provide TntService. This scenario uses the registered creeper simulation to carve the crater.',
        ],
      }),
  },
]
