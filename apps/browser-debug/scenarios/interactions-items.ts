import {
  AngleRadians,
  AttackRangeDistance,
  AIR_BLOCK_ID,
  BlockId,
  DimensionIdSchema,
  EntityId,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTickSchema,
  position,
} from '@nerima-games/mc-kernel'
import {
  EYE_LEVEL_OFFSET,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  FishingElapsedTicksSchema,
  FishingWaitTicksSchema,
  HungerPoints,
  SNOWBALL_PROFILE,
  emptyFurnaceState,
  itemStack,
  type FurnaceState,
  type ProjectileLaunch,
} from '@nerima-games/mc-sim'
import { Brand, Result, Schema } from 'effect'
import { runBrowserDebugEffect } from '../entrypoint.js'
import { applyFurnaceAdvance } from '../../../src/domain/interactions/advance-furnace.js'
import { CREEPER_KIND, type MobSpawnAttempt } from '../../../src/domain/entities/mob-frame.js'
import { meleeDamageForItem } from '../../../src/domain/interactions/melee-attack.js'
import type { PlayerDamageEvent } from '../../../src/domain/mob/hostile-combat.js'
import {
  drainBowShotResults,
  drainItemUseResults,
  drainMeleeAttackResults,
  requestFishingAdvance,
  requestFishingCast,
  requestFishingReel,
  requestBowShot,
  requestFoodUse,
  requestFurnaceAdvance,
  requestMeleeAttack,
  requestMobSpawn,
  resolveArmoredPlayerDamages,
} from '../../../src/stages/registration.js'
import { stepFrame, type Site } from '../../preview-mining-site/site.js'
import type { WorldSpec } from '../../preview-mining-site/world.js'
import {
  mountGameplayScenario,
  type ScenarioDefinition,
  type ScenarioObservation,
} from '../contract.js'

const EMPTY_WORLD: WorldSpec = { cells: [], loadedChunks: ['0,0'], z: 0 }
const STONE = BlockId(2)
const MELEE_WORLD: WorldSpec = {
  cells: Array.from({ length: 32 }, (_, x) => [x, 63, STONE] as const),
  loadedChunks: ['0,0', '1,0'],
  z: 0,
}
const BOUNDS = { width: 8, height: 8 }
const MELEE_BOUNDS = { width: 32, height: 68 }
const FISHING_ACTOR = EntityId('browser-debug:fishing-angler')
const FISHING_BOBBER = Schema.decodeUnknownSync(ProjectileIdSchema)('browser-debug:fishing-bobber')
const FISHING_LAUNCH_SPEED = Brand.nominal<ProjectileLaunch['speed']>()(1)
const FISHING_LAUNCH: ProjectileLaunch = {
  position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: FISHING_LAUNCH_SPEED,
}

const observeInventory = (site: Site): ScenarioObservation => ({
  equipment: runBrowserDebugEffect(site.inventoryService.api.equipmentSnapshot),
  hotbar: runBrowserDebugEffect(site.inventoryService.api.getHotbarSlots),
})

const observeMob = (site: Site, id: string) => {
  for (const mob of runBrowserDebugEffect(site.observeMobs())) {
    if (mob.id === id) return mob
  }
  return undefined
}

const itemUseScenario: ScenarioDefinition = {
  id: 'item-food-use',
  title: 'Item use: eat food',
  area: 'interactions-items',
  isDefault: false,
  mount: (context) => {
    const mounted = mountGameplayScenario(context, {
      world: EMPTY_WORLD,
      bounds: BOUNDS,
      actions: [{
        id: 'eat-potato',
        label: 'Eat potato',
        perform: (site) => {
          const requestId = `food-${String(site.frame)}`
          const vitals = runBrowserDebugEffect(site.state.survivalHunger.snapshot).vitals
          runBrowserDebugEffect(requestFoodUse(site.state, requestId, 'potato', {
            healthPoints: vitals.healthPoints,
            hungerPoints: vitals.hungerPoints,
            maxHungerPoints: vitals.maxHungerPoints,
          }))
          runBrowserDebugEffect(stepFrame(site))
          const result = runBrowserDebugEffect(drainItemUseResults(site.state)).find((entry) =>
            'action' in entry && entry.action === 'EatFood' && entry.requestId === requestId,
          )
          if (result === undefined || !('action' in result) || result.action !== 'EatFood' ||
            !result.success || result.consumedCount !== 1) {
            throw new Error(`potato use did not consume one item for ${requestId}`)
          }
          const removed = runBrowserDebugEffect(site.inventoryService.api.remove('potato', result.consumedCount))
          if (removed !== result.consumedCount) throw new Error(`potato inventory projection was stale for ${requestId}`)
          runBrowserDebugEffect(stepFrame(site))
        },
      }],
      observe: observeInventory,
    })
    mounted.setInventory([['potato', 1]])
    const survival = runBrowserDebugEffect(mounted.site.state.survivalHunger.snapshot)
    runBrowserDebugEffect(mounted.site.state.survivalHunger.restore({
      ...survival,
      vitals: { ...survival.vitals, hungerPoints: HungerPoints(10) },
    }))
    mounted.advance()
    return mounted
  },
}

const bowScenario: ScenarioDefinition = {
  id: 'bow-shot',
  title: 'Bow: fire an arrow',
  area: 'interactions-items',
  isDefault: false,
  mount: (context) => {
    const mounted = mountGameplayScenario(context, {
      world: EMPTY_WORLD,
      bounds: BOUNDS,
      actions: [{
        id: 'fire-arrow',
        label: 'Fire bow',
        perform: (site) => {
          const requestId = `bow-${String(site.frame)}`
          runBrowserDebugEffect(requestBowShot(site.state, requestId, {
            origin: position(PositionAxis(0), PositionAxis(64 + EYE_LEVEL_OFFSET), PositionAxis(0)),
            dirX: 1,
            dirY: 0,
            dirZ: 0,
            chargeSecs: 1,
            inventory: { mode: 'survival', slotIndex: 0 },
          }))
          runBrowserDebugEffect(stepFrame(site))
          const result = runBrowserDebugEffect(drainBowShotResults(site.state)).find((entry) => entry.requestId === requestId)
          if (result === undefined || !result.success || result.outcome !== 'Fired') {
            throw new Error(`bow shot did not fire for ${requestId}: ${result?.outcome ?? 'missing result'}`)
          }
          const removed = runBrowserDebugEffect(site.inventoryService.api.remove('arrow', 1))
          if (removed !== 1) throw new Error(`arrow inventory projection was stale for ${requestId}`)
          runBrowserDebugEffect(stepFrame(site))
        },
      }],
      unsupported: [
        'The Site inventory projection shows the consumed arrow, but it does not mirror bow durability changes from the replicated player-storage owner.',
      ],
      observe: observeInventory,
    })
    mounted.setInventory([['bow', 1], ['arrow', 1]])
    mounted.advance()
    return mounted
  },
}

const fishingScenario: ScenarioDefinition = {
  id: 'fishing-rod',
  title: 'Fishing rod: cast and reel',
  area: 'interactions-items',
  isDefault: false,
  mount: (context) => {
    const root = context.root.ownerDocument
    const fishingSection = root.createElement('section')
    fishingSection.className = 'fishing-observation'
    fishingSection.setAttribute('aria-label', 'Fishing result observation')
    const fishingHeading = root.createElement('h2')
    fishingHeading.textContent = 'Fishing result'
    const fishingDetails = root.createElement('pre')
    fishingSection.append(fishingHeading, fishingDetails)
    context.root.append(fishingSection)

    let lastFishingResult: unknown = null
    const mounted = mountGameplayScenario(context, {
      world: EMPTY_WORLD,
      bounds: BOUNDS,
      actions: [{
        id: 'fish-and-reel',
        label: 'Cast, wait, and reel',
        perform: (site) => {
          const castRequestId = `fishing-cast-${String(site.frame)}`
          runBrowserDebugEffect(requestFishingCast(site.state, {
            requestId: castRequestId,
            actor: FISHING_ACTOR,
            bobber: FISHING_BOBBER,
            tick: Schema.decodeUnknownSync(SimulationTickSchema)(site.frame),
            dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'),
            launch: FISHING_LAUNCH,
            profile: SNOWBALL_PROFILE,
            rod: null,
            environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
          }))
          runBrowserDebugEffect(stepFrame(site))
          const castResult = runBrowserDebugEffect(drainItemUseResults(site.state)).find((entry) =>
            'action' in entry && entry.action === 'CastFishing' && entry.requestId === castRequestId,
          )
          if (castResult === undefined || !('action' in castResult) ||
            castResult.action !== 'CastFishing' || !castResult.success) {
            throw new Error(`fishing cast did not succeed for ${castRequestId}`)
          }
          const castRod = runBrowserDebugEffect(site.observeFishingState()).rods.find((rod) => rod.actor === FISHING_ACTOR)
          if (castRod?.bobber !== FISHING_BOBBER || castRod.phase !== 'cast') {
            throw new Error('fishing cast was not observed in the Site fishing state')
          }

          const advanceRequestId = `fishing-advance-${String(site.frame)}`
          runBrowserDebugEffect(requestFishingAdvance(site.state, {
            requestId: advanceRequestId,
            actor: FISHING_ACTOR,
            elapsedTicks: Schema.decodeUnknownSync(FishingElapsedTicksSchema)(120),
            waitTicks: Schema.decodeUnknownSync(FishingWaitTicksSchema)(100),
            approachTicks: Schema.decodeUnknownSync(FishingApproachTicksSchema)(20),
            biteWindowTicks: Schema.decodeUnknownSync(FishingBiteWindowTicksSchema)(20),
            environment: { hasWater: true },
          }))
          runBrowserDebugEffect(stepFrame(site))
          const advanceResult = runBrowserDebugEffect(drainItemUseResults(site.state)).find((entry) =>
            'action' in entry && entry.action === 'AdvanceFishing' && entry.requestId === advanceRequestId,
          )
          if (advanceResult === undefined || !('action' in advanceResult) ||
            advanceResult.action !== 'AdvanceFishing' || !advanceResult.success ||
            advanceResult.outcome._tag !== 'Bite') {
            throw new Error(`fishing did not reach a bite for ${advanceRequestId}`)
          }
          const biteRod = runBrowserDebugEffect(site.observeFishingState()).rods.find((rod) => rod.actor === FISHING_ACTOR)
          if (biteRod?.bobber !== FISHING_BOBBER || biteRod.phase !== 'bite') {
            throw new Error('fishing bite was not observed in the Site fishing state')
          }

          const reelRequestId = `fishing-reel-${String(site.frame)}`
          runBrowserDebugEffect(requestFishingReel(site.state, reelRequestId, FISHING_ACTOR))
          runBrowserDebugEffect(stepFrame(site))
          const reelResult = runBrowserDebugEffect(drainItemUseResults(site.state)).find((entry) =>
            'action' in entry && entry.action === 'ReelFishing' && entry.requestId === reelRequestId,
          )
          if (reelResult === undefined || !('action' in reelResult) ||
            reelResult.action !== 'ReelFishing' || !reelResult.success ||
            reelResult.outcome._tag !== 'Caught') {
            throw new Error(`fishing reel did not catch an item for ${reelRequestId}`)
          }
          const finalState = runBrowserDebugEffect(site.observeFishingState())
          if (finalState.rods.length !== 0) throw new Error('fishing rod remained active after a successful catch')
          lastFishingResult = { castResult, advanceResult, fishingStateAtBite: biteRod, reelResult, finalState }
          fishingDetails.textContent = JSON.stringify(lastFishingResult, null, 2) ?? String(lastFishingResult)
        },
      }],
      observe: (site) => {
        const fishingState = runBrowserDebugEffect(site.observeFishingState())
        fishingDetails.textContent = JSON.stringify({ fishingState, lastFishingResult }, null, 2) ?? String(lastFishingResult)
        return observeInventory(site)
      },
    })
    mounted.setInventory([['fishing_rod', 1]])
    mounted.advance()
    return mounted
  },
}

const meleeScenario: ScenarioDefinition = {
  id: 'melee-attack',
  title: 'Melee: hit a creeper',
  area: 'interactions-items',
  isDefault: false,
  mount: (context) => {
    const root = context.root.ownerDocument
    const mobSection = root.createElement('section')
    mobSection.className = 'melee-observation'
    mobSection.setAttribute('aria-label', 'Melee target observation')
    const mobHeading = root.createElement('h2')
    mobHeading.textContent = 'Melee target'
    const mobDetails = root.createElement('pre')
    mobSection.append(mobHeading, mobDetails)
    context.root.append(mobSection)

    let lastAttack: unknown = null
    const mounted = mountGameplayScenario(context, {
      world: MELEE_WORLD,
      bounds: MELEE_BOUNDS,
      actions: [{
        id: 'spawn-and-hit-creeper',
        label: 'Spawn and hit creeper with iron sword',
        perform: (site) => {
          let target = runBrowserDebugEffect(site.observeMobs()).find((mob) => mob.kind === CREEPER_KIND)
          if (target === undefined) {
            const mobX = 16.5
            const mobZ = 0.5
            const spawnAttempt: MobSpawnAttempt = {
              candidate: {
                dimension: 'overworld',
                groundBlock: STONE,
                footBlock: AIR_BLOCK_ID,
                headBlock: AIR_BLOCK_ID,
                blockLight: 0,
                timeOfDay: 0.9,
                distanceToPlayerBlocksXZ: Math.hypot(mobX, mobZ),
              },
              kind: CREEPER_KIND,
              feetPosition: position(PositionAxis(mobX), PositionAxis(64), PositionAxis(mobZ)),
            }
            runBrowserDebugEffect(requestMobSpawn(site.state, spawnAttempt))
            runBrowserDebugEffect(stepFrame(site))
            target = runBrowserDebugEffect(site.observeMobs()).find((mob) => mob.kind === CREEPER_KIND)
          }
          if (target === undefined) throw new Error('melee scenario could not spawn a creeper')

          for (let frame = 0; frame < 600; frame += 1) {
            const dx = target.position.x
            const dz = target.position.z
            const distance = Math.hypot(dx, dz)
            if (distance <= 4) {
              const requestId = `melee-${String(site.frame)}-${String(frame)}`
              const directionLength = Math.hypot(dx, dz)
              runBrowserDebugEffect(requestMeleeAttack(site.state, {
                requestId,
                origin: position(PositionAxis(0), PositionAxis(64 + EYE_LEVEL_OFFSET), PositionAxis(0)),
                direction: position(PositionAxis(dx / directionLength), PositionAxis(0), PositionAxis(dz / directionLength)),
                reach: AttackRangeDistance(3),
                damage: meleeDamageForItem('iron_sword'),
              }))
              runBrowserDebugEffect(stepFrame(site))
              const results = runBrowserDebugEffect(drainMeleeAttackResults(site.state))
              let result: (typeof results)[number] | undefined
              for (const entry of results) {
                if (entry.requestId === requestId) {
                  result = entry
                  break
                }
              }
              if (result?.success) {
                lastAttack = result
                return
              }
            } else {
              runBrowserDebugEffect(stepFrame(site))
            }
            target = observeMob(site, target.id)
            if (target === undefined) throw new Error('melee target disappeared before it could be hit')
          }
          throw new Error('creeper did not enter melee reach within 600 gameplay frames')
        },
      }],
      unsupported: [
        'The gameplay melee request applies an iron-sword hit, but this interaction path does not consume or damage the held sword.',
      ],
      observe: (site) => {
        const mobs = runBrowserDebugEffect(site.observeMobs())
        mobDetails.textContent = JSON.stringify({ mobs, lastAttack }, null, 2) ?? String(lastAttack)
        return { mobs, ...observeInventory(site) }
      },
    })
    mounted.setInventory([['iron_sword', 1]])
    mounted.advance()
    return mounted
  },
}

const furnaceScenario: ScenarioDefinition = {
  id: 'furnace-smelt',
  title: 'Furnace: smelt iron',
  area: 'interactions-items',
  isDefault: false,
  mount: (context) => {
    let furnace: FurnaceState = {
      ...Result.getOrThrow(emptyFurnaceState()),
      input: Result.getOrThrow(itemStack('raw_iron', 3)),
      fuel: Result.getOrThrow(itemStack('coal', 1)),
    }
    const mounted = mountGameplayScenario(context, {
      world: EMPTY_WORLD,
      bounds: BOUNDS,
      actions: [{
        id: 'smelt-iron',
        label: 'Advance furnace',
        perform: (site) => {
          const requestId = `furnace-${String(site.frame)}`
          runBrowserDebugEffect(requestFurnaceAdvance(site.state, requestId, furnace, 10))
          runBrowserDebugEffect(stepFrame(site))
          const result = runBrowserDebugEffect(drainItemUseResults(site.state)).find((entry) => entry.requestId === requestId)
          if (result === undefined || !('plan' in result)) {
            throw new Error(`missing furnace plan for ${requestId}`)
          }
          const applied = applyFurnaceAdvance(furnace, result.plan)
          if (applied._tag !== 'Applied') throw new Error(`stale furnace plan for ${requestId}`)
          furnace = applied.state
          if (result.plan.fuelConsumed > 0) {
            runBrowserDebugEffect(site.inventoryService.api.remove('coal', result.plan.fuelConsumed))
          }
          if (result.plan.smeltedCount > 0) {
            const inputItem = result.plan.before.input?.item
            const outputItem = result.plan.after.output?.item
            if (inputItem !== undefined) {
              runBrowserDebugEffect(site.inventoryService.api.remove(inputItem, result.plan.smeltedCount))
            }
            if (outputItem !== undefined) {
              runBrowserDebugEffect(site.inventoryService.api.add(outputItem, result.plan.smeltedCount))
            }
          }
          runBrowserDebugEffect(stepFrame(site))
        },
      }],
      observe: observeInventory,
    })
    mounted.setInventory([['raw_iron', 3], ['coal', 1]])
    mounted.advance()
    return mounted
  },
}

const armorScenario: ScenarioDefinition = {
  id: 'armor-durability',
  title: 'Armor: absorb damage',
  area: 'interactions-items',
  isDefault: false,
  mount: (context) => {
    const mounted = mountGameplayScenario(context, {
      world: EMPTY_WORLD,
      bounds: BOUNDS,
      actions: [{
        id: 'take-armored-hit',
        label: 'Take armored hit',
        perform: (site) => {
          const hit: PlayerDamageEvent = {
            _tag: 'HostileContact',
            source: EntityId('browser-debug-attacker'),
            kind: CREEPER_KIND,
            at: position(PositionAxis(0), PositionAxis(64), PositionAxis(2)),
            damage: { amount: 8, cause: 'mob' },
          }
          const [resolved] = runBrowserDebugEffect(resolveArmoredPlayerDamages(site.inventoryService.api, [hit]))
          if (resolved === undefined) throw new Error('missing armored damage result')
          runBrowserDebugEffect(site.state.survivalHunger.damage(resolved.damage))
          runBrowserDebugEffect(stepFrame(site))
        },
      }],
      observe: observeInventory,
    })
    mounted.setInventory([['iron_chestplate', 1]])
    runBrowserDebugEffect(mounted.site.inventoryService.api.equipFromInventory(0, 'chest'))
    mounted.advance()
    return mounted
  },
}

export const interactionsItemScenarios: ReadonlyArray<ScenarioDefinition> = [
  itemUseScenario,
  bowScenario,
  fishingScenario,
  meleeScenario,
  furnaceScenario,
  armorScenario,
]
