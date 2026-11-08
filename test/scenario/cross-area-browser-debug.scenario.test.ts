/// <reference lib="dom" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AIR_BLOCK_ID, blockIdOf, type ItemType } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import type { ScenarioSnapshot } from '../../apps/browser-debug/contract.js'
import type { CrossAreaSetupId } from '../../apps/browser-debug/scenarios/cross-area.js'
import { FIRE, SAND, STONE } from '../../apps/preview-mining-site/world.js'

type ScenarioStep = {
  readonly frame: number
  readonly timeOfDay: number
  readonly weather: string
  readonly inventory: ReadonlyArray<readonly [string, number]>
  readonly vitals: unknown
  readonly statusEffects: unknown
  readonly droppedItems: unknown
  readonly mobs: unknown
  readonly vehicles: unknown
  readonly playerPose: unknown
  readonly chunks: unknown
  readonly unsupported: ReadonlyArray<string>
  readonly equipment: unknown
  readonly spawnedMobPresent: boolean
}

type ScenarioId = CrossAreaSetupId
type ActionId =
  | 'x01-mine-support'
  | 'x01-pick-up-drop'
  | 'x02-spawn-mobs'
  | 'x02-explode-pillar'
  | 'x03-load-water-bucket'
  | 'x03-pour-water-bucket'
  | 'x04-place-vehicle'
  | 'x04-ignite-fire'
  | 'x05-spawn-at-night'
  | 'x05-advance-to-daylight'
  | 'x06-cast-in-rain'
  | 'x06-advance-with-explicit-wait'
  | 'x06-reel-catch'
  | 'x07-configure-portals'
  | 'x07-travel-to-nether'
  | 'x07-return-overworld'
  | 'x08-apply-poison'
  | 'x08-eat-cod'
  | 'x08-observe-poison-pulse'

type ScenarioRunInput = {
  readonly setupId: ScenarioId
  readonly actionIds: ReadonlyArray<ActionId>
  readonly setNight: boolean
  readonly setRain: boolean
}

let devServer: ViteDevServer | undefined
let browser: Browser | undefined
let page: Page | undefined

const itemCount = (inventory: ScenarioSnapshot['inventory'], item: ItemType): number =>
  inventory.reduce((total, [candidate, amount]) => total + (candidate === item ? amount : 0), 0)

const readProperty = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    throw new Error(`scenario evidence is missing ${key}`)
  }
  return Reflect.get(value, key)
}

const readOptionalProperty = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null) throw new Error('scenario evidence is not an object')
  return key in value ? Reflect.get(value, key) : undefined
}

const readNumber = (value: unknown, key: string): number => {
  const candidate = readProperty(value, key)
  if (typeof candidate !== 'number') throw new Error(`scenario evidence ${key} is not numeric`)
  return candidate
}

const readString = (value: unknown, key: string): string => {
  const candidate = readProperty(value, key)
  if (typeof candidate !== 'string') throw new Error(`scenario evidence ${key} is not text`)
  return candidate
}

const readBoolean = (value: unknown, key: string): boolean => {
  const candidate = readProperty(value, key)
  if (typeof candidate !== 'boolean') throw new Error(`scenario evidence ${key} is not boolean`)
  return candidate
}

const readInventory = (value: unknown): ScenarioStep['inventory'] => {
  if (!Array.isArray(value)) throw new Error('scenario evidence inventory is not an array')
  return value.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('scenario inventory entry is not a pair')
    const [item, count] = entry
    if (typeof item !== 'string' || typeof count !== 'number') {
      throw new Error('scenario inventory pair has invalid values')
    }
    const pair: readonly [string, number] = [item, count]
    return pair
  })
}

const readStringArray = (value: unknown, key: string): ReadonlyArray<string> => {
  const candidate = readProperty(value, key)
  if (!Array.isArray(candidate)) throw new Error(`scenario evidence ${key} is not a text array`)
  return candidate.map((entry: unknown) => {
    if (typeof entry !== 'string') throw new Error(`scenario evidence ${key} contains non-text`)
    return entry
  })
}

const decodeScenarioStep = (value: unknown): ScenarioStep => ({
  frame: readNumber(value, 'frame'),
  timeOfDay: readNumber(value, 'timeOfDay'),
  weather: readString(value, 'weather'),
  inventory: readInventory(readProperty(value, 'inventory')),
  vitals: readProperty(value, 'vitals'),
  statusEffects: readOptionalProperty(value, 'statusEffects'),
  droppedItems: readOptionalProperty(value, 'droppedItems'),
  mobs: readOptionalProperty(value, 'mobs'),
  vehicles: readOptionalProperty(value, 'vehicles'),
  playerPose: readOptionalProperty(value, 'playerPose'),
  chunks: readProperty(value, 'chunks'),
  unsupported: readStringArray(value, 'unsupported'),
  equipment: readOptionalProperty(value, 'equipment'),
  spawnedMobPresent: readBoolean(value, 'spawnedMobPresent'),
})

const decodeScenarioSteps = (value: unknown): ReadonlyArray<ScenarioStep> => {
  if (!Array.isArray(value)) throw new Error('browser scenario runner did not return steps')
  return value.map(decodeScenarioStep)
}

const blockString = (name: Parameters<typeof blockIdOf>[0]): string => {
  return String(Option.getOrThrow(blockIdOf(name)))
}

const currentPage = (): Page => {
  if (page === undefined) throw new Error('cross-area browser page was not initialized')
  return page
}

const browserRunnerKey = 'mx-gameplay.cross-area-runner'

const browserRunnerScript = `
import { mountGameplayScenario } from '/contract.ts'
import { crossAreaNoWaterSetup, crossAreaSetups } from '/scenarios/cross-area.ts'

const capture = (mount) => {
  const snapshot = mount.snapshot()
  const equipment = snapshot.equipment
  const spawnedMobId = equipment && typeof equipment === 'object' && 'spawnedMobId' in equipment
    ? equipment.spawnedMobId
    : undefined
  return {
    frame: snapshot.frame,
    timeOfDay: snapshot.timeOfDay,
    weather: snapshot.weather,
    inventory: snapshot.inventory,
    vitals: snapshot.vitals,
    statusEffects: snapshot.statusEffects,
    droppedItems: snapshot.droppedItems,
    mobs: snapshot.mobs,
    vehicles: snapshot.vehicles,
    playerPose: snapshot.playerPose,
    chunks: snapshot.chunks,
    unsupported: snapshot.unsupported,
    equipment: snapshot.equipment,
    spawnedMobPresent: typeof spawnedMobId === 'string' &&
      (snapshot.mobs?.some(({ id }) => id === spawnedMobId) ?? false),
  }
}

const runScenario = async ({ setupId, actionIds, setNight, setRain }) => {
  const context = {
    root: document.createElement('div'),
    scenarioId: 'cross-area-test-' + setupId,
    seed: 1,
    time: 6000,
    weather: 'clear',
  }
  const mount = mountGameplayScenario(context, crossAreaSetups[setupId])
  try {
    if (setNight) mount.setTime(21_600)
    if (setRain) mount.setWeather('rain')
    const steps = [capture(mount)]
    for (const actionId of actionIds) {
      const action = mount.actions.find((candidate) => candidate.id === actionId)
      if (action === undefined) throw new Error('missing Browser Debug action ' + actionId)
      action.perform(mount.site)
      steps.push(capture(mount))
    }
    return steps
  } finally {
    mount.dispose()
  }
}

const runNoWaterControl = async () => {
  const context = {
    root: document.createElement('div'),
    scenarioId: 'cross-area-x03-no-water-control',
    seed: 1,
    time: 6000,
    weather: 'clear',
  }
  const mount = mountGameplayScenario(context, crossAreaNoWaterSetup)
  try {
    const action = mount.actions.find((candidate) => candidate.id === 'x03-no-bucket-control')
    if (action === undefined) throw new Error('missing X-03 no-bucket control action')
    action.perform(mount.site)
    return capture(mount)
  } finally {
    mount.dispose()
  }
}

const runnerKey = Symbol.for('${browserRunnerKey}')
Object.defineProperty(globalThis, runnerKey, {
  value: async (mode, input) => mode === 'control' ? runNoWaterControl() : runScenario(input),
  configurable: true,
})
`

const invokeBrowserRunner = async (mode: 'scenario' | 'control', input: unknown): Promise<unknown> =>
  currentPage().evaluate(
    async (args: Readonly<{ mode: string; input: unknown }>): Promise<unknown> => {
      const runner: unknown = Reflect.get(globalThis, Symbol.for('mx-gameplay.cross-area-runner'))
      if (typeof runner !== 'function') throw new Error('cross-area browser runner was not installed')
      const result: unknown = await Reflect.apply(runner, globalThis, [args.mode, args.input])
      return result
    },
    { mode, input },
  )

const runScenario = async (
  setupId: ScenarioId,
  actionIds: ReadonlyArray<ActionId>,
  adjustments: Readonly<{ setNight?: boolean; setRain?: boolean }> = {},
): Promise<ReadonlyArray<ScenarioStep>> => decodeScenarioSteps(await invokeBrowserRunner('scenario', {
  setupId,
  actionIds,
  setNight: adjustments.setNight ?? false,
  setRain: adjustments.setRain ?? false,
} satisfies ScenarioRunInput))

const runNoWaterControl = async (): Promise<ScenarioStep> =>
  decodeScenarioStep(await invokeBrowserRunner('control', undefined))

beforeAll(async () => {
  devServer = await createServer({
    configFile: 'apps/browser-debug/vite.config.ts',
    logLevel: 'silent',
    server: { port: 0, strictPort: false },
  })
  await devServer.listen()
  const appUrl = devServer.resolvedUrls?.local?.[0]
  if (appUrl === undefined) throw new Error('Vite did not expose an ephemeral local URL')
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  await page.goto(appUrl)
  await page.addScriptTag({ content: browserRunnerScript, type: 'module' })
})

afterAll(async () => {
  try {
    if (browser !== undefined) await browser.close()
  } finally {
    if (devServer !== undefined) await devServer.close()
  }
})

describe('cross-area Browser Debug scenarios', () => {
  // Catches support mining that skips falling sand, dirt drops, or pickup.
  it('X-01 mines support, settles sand, picks up dirt, and preserves the craft gap', async () => {
    const steps = await runScenario('x01', ['x01-mine-support', 'x01-pick-up-drop'])
    expect(steps).toHaveLength(3)
    expect(steps[0]?.equipment).toMatchObject({ phase: 'ready to mine', dirtInPlayerStorage: 0 })
    expect(steps[1]?.equipment).toMatchObject({
      phase: 'support mined; sand settled; dirt drop is on the ground',
      supportBlock: String(SAND),
      fallingBlockCell: String(AIR_BLOCK_ID),
    })
    expect(steps[1]?.droppedItems).toMatchObject([{ item: 'dirt', count: 1 }])
    expect(itemCount(steps[2]?.inventory ?? [], 'dirt')).toBe(1)
    expect(steps[2]?.droppedItems).toStrictEqual([])
    expect(steps[2]?.unsupported).toEqual(expect.arrayContaining([
      expect.stringContaining('src/stages/interactions-stage.ts:2066-2112'),
    ]))
  })

  // Catches blasts that lose Mob loot or leave unsupported sand in its old cell.
  it('X-02 explodes the support, records Mob loot, and observes settled sand', async () => {
    const steps = await runScenario('x02', ['x02-spawn-mobs', 'x02-explode-pillar'], { setNight: true })
    expect(steps).toHaveLength(3)
    expect(steps[1]?.mobs).toHaveLength(2)
    expect(steps[1]?.droppedItems).toStrictEqual([])
    expect(steps[1]?.equipment).toMatchObject({
      phase: 'Creeper and Zombie spawned; sand pillar is intact before the blast',
      supportCell: String(STONE),
      sandAtOriginalCell: String(SAND),
      sandSettledAtSupport: false,
    })
    expect(steps[2]?.equipment).toMatchObject({
      phase: 'creeper blast committed; Mob loot is on the ground; sand settled',
      supportCell: String(SAND),
      sandAtOriginalCell: String(AIR_BLOCK_ID),
      sandSettledAtSupport: true,
    })
    expect(steps[2]?.droppedItems).toMatchObject([{ item: 'rotten_flesh', count: 2 }])
    expect(steps[2]?.mobs).toBeDefined()
  })

  // Catches bucket placement that fails to turn adjacent lava into obsidian.
  it('X-03 places water, converts lava, and returns the empty bucket', async () => {
    const steps = await runScenario('x03', ['x03-load-water-bucket', 'x03-pour-water-bucket'])
    expect(steps).toHaveLength(3)
    expect(itemCount(steps[1]?.inventory ?? [], 'water_bucket')).toBe(1)
    expect(steps[1]?.equipment).toMatchObject({
      phase: 'water bucket ready; lava source remains unchanged',
      waterCell: 'undefined',
      lavaCell: blockString('lava'),
      waterBuckets: 1,
    })
    const final = steps[2]
    expect(final?.equipment).toMatchObject({
      phase: 'water placed; lava source became obsidian; empty bucket returned',
      waterCell: blockString('water'),
      lavaCell: blockString('obsidian'),
      emptyBuckets: 1,
    })
    expect(itemCount(final?.inventory ?? [], 'bucket')).toBe(1)
    expect(itemCount(final?.inventory ?? [], 'water_bucket')).toBe(0)
  })

  // Catches scenarios that claim fire contact damaged a vehicle without support.
  it('X-04 observes fire beside a vehicle and names the unsupported contact', async () => {
    const steps = await runScenario('x04', ['x04-place-vehicle', 'x04-ignite-fire'])
    expect(steps).toHaveLength(3)
    expect(steps[1]?.vehicles).toHaveLength(1)
    expect(steps[2]?.equipment).toMatchObject({
      phase: 'fire committed; vehicle remains observable; vehicle contact damage is unsupported',
      fireCell: String(FIRE),
      fireChargeRemaining: 0,
    })
    expect(steps[2]?.vehicles).toHaveLength(1)
    expect(steps[2]?.unsupported).toEqual(expect.arrayContaining([
      expect.stringContaining('src/domain/fire-lifecycle.ts:39-45'),
    ]))
  })

  // Catches daylight incorrectly removing a hostile Mob when no dawn rule exists.
  it('X-05 observes the night spawn still present after daylight', async () => {
    const steps = await runScenario('x05', ['x05-spawn-at-night', 'x05-advance-to-daylight'], { setNight: true })
    expect(steps).toHaveLength(3)
    expect(steps[1]?.timeOfDay).toBe(21_600)
    expect(steps[1]?.mobs).toHaveLength(1)
    expect(steps[2]?.timeOfDay).toBe(6_000)
    expect(steps[2]?.spawnedMobPresent).toBe(true)
    expect(steps[2]?.equipment).toMatchObject({
      phase: 'same hostile Mob remains after daylight; dawn despawn is unsupported',
      timeOfDay: 6_000,
    })
    expect(steps[2]?.unsupported).toEqual(expect.arrayContaining([
      expect.stringContaining('src/domain/entities/mob-frame.ts:1293-1330'),
    ]))
  })

  // Catches rain being falsely credited with shortening the explicit fishing wait.
  it('X-06 fishes in rain using the explicit wait and observes the catch', async () => {
    const steps = await runScenario(
      'x06',
      ['x06-cast-in-rain', 'x06-advance-with-explicit-wait', 'x06-reel-catch'],
      { setRain: true },
    )
    expect(steps).toHaveLength(4)
    expect(steps[1]?.weather).toBe('rain')
    expect(steps[1]?.equipment).toMatchObject({ phase: 'rod is cast in rain; rain-shortened wait remains unsupported' })
    expect(steps[2]?.equipment).toMatchObject({
      phase: 'bite reached after an explicit wait; no automatic rain adjustment was applied',
      explicitlyRequestedWaitTicks: 100,
    })
    expect(steps[2]?.equipment).toMatchObject({ fishing: { rods: [{ phase: 'bite' }] } })
    expect(steps[3]?.equipment).toMatchObject({
      phase: 'catch committed to player storage; rain wait shortening remains unsupported',
    })
    expect(readProperty(steps[3]?.equipment, 'catchInPlayerStorage')).not.toHaveLength(0)
    expect(steps[3]?.unsupported).toEqual(expect.arrayContaining([
      expect.stringContaining('src/stages/interactions-stage.ts:748-752'),
    ]))
  })

  // Catches false claims that portal travel refreshed a chunk window.
  it('X-07 returns from Nether and keeps the chunk-window gap explicit', async () => {
    const steps = await runScenario(
      'x07',
      ['x07-configure-portals', 'x07-travel-to-nether', 'x07-return-overworld'],
    )
    expect(steps).toHaveLength(4)
    expect(readProperty(steps[1]?.playerPose, 'dimension')).toBe('overworld')
    expect(readProperty(steps[2]?.playerPose, 'dimension')).toBe('nether')
    expect(readProperty(steps[3]?.playerPose, 'dimension')).toBe('overworld')
    expect(steps[3]?.equipment).toMatchObject({
      phase: 'round trip complete; chunk-window refresh is unsupported',
      overworldPortal: blockString('nether_portal'),
      netherPortal: blockString('nether_portal'),
      initialChunkSnapshot: ['0,0'],
    })
    expect(steps[3]?.unsupported).toEqual(expect.arrayContaining([
      expect.stringContaining('observeChunkWindow'),
    ]))
  })

  // Catches food that fails to restore hunger or poison that stops reducing health.
  it('X-08 consumes cod, raises hunger, and observes a later poison pulse', async () => {
    const steps = await runScenario('x08', ['x08-apply-poison', 'x08-eat-cod', 'x08-observe-poison-pulse'])
    expect(steps).toHaveLength(4)
    expect(itemCount(steps[2]?.inventory ?? [], 'cod')).toBe(0)
    const foodHunger = readProperty(steps[2]?.equipment, 'foodHunger')
    expect(readNumber(foodHunger, 'afterFood')).toBeGreaterThan(readNumber(foodHunger, 'beforeUse'))
    expect(steps[2]?.equipment).toMatchObject({ phase: 'cod consumed; hunger increased while poison remained active' })
    const poisonPulse = steps[3]?.statusEffects
    const healthPulse = readProperty(poisonPulse, 'poisonPulse')
    expect(readNumber(healthPulse, 'afterPulse')).toBeLessThan(readNumber(healthPulse, 'beforePulse'))
    expect(steps[3]?.equipment).toMatchObject({ codRemaining: 0 })
  })

  // Negative control catches lava conversion without the bucket request.
  it('X-03 control leaves lava untouched when no bucket request is submitted', async () => {
    const step = await runNoWaterControl()
    expect(step.equipment).toMatchObject({
      control: 'no bucket request was submitted',
      waterCell: 'undefined',
      lavaRemains: true,
    })
    expect(step.inventory).toStrictEqual([])
  })
})
