import {
  AttackRangeDistance,
  AIR_BLOCK_ID,
  BlockId,
  EntityId,
  PositionAxis,
  position,
} from '@nerima-games/mc-kernel'
import {
  EYE_LEVEL_OFFSET,
  HungerPoints,
  emptyFurnaceState,
  itemStack,
  type FurnaceState,
} from '@nerima-games/mc-sim'
import { Effect, Result } from 'effect'
import { applyFurnaceAdvance } from '../../../src/domain/interactions/advance-furnace.js'
import { CREEPER_KIND, type MobSpawnAttempt } from '../../../src/domain/entities/mob-frame.js'
import { meleeDamageForItem } from '../../../src/domain/interactions/melee-attack.js'
import type { PlayerDamageEvent } from '../../../src/domain/mob/hostile-combat.js'
import {
  drainBowShotResults,
  drainItemUseResults,
  drainMeleeAttackResults,
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

const observeInventory = (site: Site): ScenarioObservation => ({
  equipment: Effect.runSync(site.inventoryService.api.equipmentSnapshot),
  hotbar: Effect.runSync(site.inventoryService.api.getHotbarSlots),
})

const observeMob = (site: Site, id: string) => {
  for (const mob of Effect.runSync(site.observeMobs())) {
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
          const vitals = Effect.runSync(site.state.survivalHunger.snapshot).vitals
          Effect.runSync(requestFoodUse(site.state, requestId, 'potato', {
            healthPoints: vitals.healthPoints,
            hungerPoints: vitals.hungerPoints,
            maxHungerPoints: vitals.maxHungerPoints,
          }))
          Effect.runSync(stepFrame(site))
          const result = Effect.runSync(drainItemUseResults(site.state)).find((entry) =>
            'action' in entry && entry.action === 'EatFood' && entry.requestId === requestId,
          )
          if (result === undefined || !('action' in result) || result.action !== 'EatFood' ||
            !result.success || result.consumedCount !== 1) {
            throw new Error(`potato use did not consume one item for ${requestId}`)
          }
          const removed = Effect.runSync(site.inventoryService.api.remove('potato', result.consumedCount))
          if (removed !== result.consumedCount) throw new Error(`potato inventory projection was stale for ${requestId}`)
          Effect.runSync(stepFrame(site))
        },
      }],
      observe: observeInventory,
    })
    mounted.setInventory([['potato', 1]])
    const survival = Effect.runSync(mounted.site.state.survivalHunger.snapshot)
    Effect.runSync(mounted.site.state.survivalHunger.restore({
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
          Effect.runSync(requestBowShot(site.state, requestId, {
            origin: position(PositionAxis(0), PositionAxis(64 + EYE_LEVEL_OFFSET), PositionAxis(0)),
            dirX: 1,
            dirY: 0,
            dirZ: 0,
            chargeSecs: 1,
            inventory: { mode: 'survival', slotIndex: 0 },
          }))
          Effect.runSync(stepFrame(site))
          const result = Effect.runSync(drainBowShotResults(site.state)).find((entry) => entry.requestId === requestId)
          if (result === undefined || !result.success || result.outcome !== 'Fired') {
            throw new Error(`bow shot did not fire for ${requestId}: ${result?.outcome ?? 'missing result'}`)
          }
          const removed = Effect.runSync(site.inventoryService.api.remove('arrow', 1))
          if (removed !== 1) throw new Error(`arrow inventory projection was stale for ${requestId}`)
          Effect.runSync(stepFrame(site))
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
    const mounted = mountGameplayScenario(context, {
      world: EMPTY_WORLD,
      bounds: BOUNDS,
      unsupported: [
        'The Site registers the fishing owner but does not provide FishingService to gameplayStages. Fishing requests are therefore reported as Unsupported/Fishing with OwnerRegistrationUnavailable, so this scenario has no action.',
      ],
      observe: observeInventory,
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
          let target = Effect.runSync(site.observeMobs()).find((mob) => mob.kind === CREEPER_KIND)
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
            Effect.runSync(requestMobSpawn(site.state, spawnAttempt))
            Effect.runSync(stepFrame(site))
            target = Effect.runSync(site.observeMobs()).find((mob) => mob.kind === CREEPER_KIND)
          }
          if (target === undefined) throw new Error('melee scenario could not spawn a creeper')

          for (let frame = 0; frame < 600; frame += 1) {
            const dx = target.position.x
            const dz = target.position.z
            const distance = Math.hypot(dx, dz)
            if (distance <= 4) {
              const requestId = `melee-${String(site.frame)}-${String(frame)}`
              const directionLength = Math.hypot(dx, dz)
              Effect.runSync(requestMeleeAttack(site.state, {
                requestId,
                origin: position(PositionAxis(0), PositionAxis(64 + EYE_LEVEL_OFFSET), PositionAxis(0)),
                direction: position(PositionAxis(dx / directionLength), PositionAxis(0), PositionAxis(dz / directionLength)),
                reach: AttackRangeDistance(3),
                damage: meleeDamageForItem('iron_sword'),
              }))
              Effect.runSync(stepFrame(site))
              const results = Effect.runSync(drainMeleeAttackResults(site.state))
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
              Effect.runSync(stepFrame(site))
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
        const mobs = Effect.runSync(site.observeMobs())
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
          Effect.runSync(requestFurnaceAdvance(site.state, requestId, furnace, 10))
          Effect.runSync(stepFrame(site))
          const result = Effect.runSync(drainItemUseResults(site.state)).find((entry) => entry.requestId === requestId)
          if (result === undefined || !('plan' in result)) {
            throw new Error(`missing furnace plan for ${requestId}`)
          }
          const applied = applyFurnaceAdvance(furnace, result.plan)
          if (applied._tag !== 'Applied') throw new Error(`stale furnace plan for ${requestId}`)
          furnace = applied.state
          if (result.plan.fuelConsumed > 0) {
            Effect.runSync(site.inventoryService.api.remove('coal', result.plan.fuelConsumed))
          }
          if (result.plan.smeltedCount > 0) {
            const inputItem = result.plan.before.input?.item
            const outputItem = result.plan.after.output?.item
            if (inputItem !== undefined) {
              Effect.runSync(site.inventoryService.api.remove(inputItem, result.plan.smeltedCount))
            }
            if (outputItem !== undefined) {
              Effect.runSync(site.inventoryService.api.add(outputItem, result.plan.smeltedCount))
            }
          }
          Effect.runSync(stepFrame(site))
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
          const [resolved] = Effect.runSync(resolveArmoredPlayerDamages(site.inventoryService.api, [hit]))
          if (resolved === undefined) throw new Error('missing armored damage result')
          Effect.runSync(site.state.survivalHunger.damage(resolved.damage))
          Effect.runSync(stepFrame(site))
        },
      }],
      observe: observeInventory,
    })
    mounted.setInventory([['iron_chestplate', 1]])
    Effect.runSync(mounted.site.inventoryService.api.equipFromInventory(0, 'chest'))
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
