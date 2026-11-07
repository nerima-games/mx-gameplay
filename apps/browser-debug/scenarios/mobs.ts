import { AIR_BLOCK_ID, BlockId, PositionAxis, position } from '@nerima-games/mc-kernel'
import { EntityId } from '@nerima-games/mc-sim'
import { Effect, Ref, Result } from 'effect'
import { EYE_LEVEL_OFFSET } from '@nerima-games/mc-sim'
import { createExperienceOrbValue } from '../../../src/domain/entities/xp-orb.js'
import { CREEPER_KIND, ENDERMAN_KIND, type MobSpawnAttempt } from '../../../src/domain/entities/mob-frame.js'
import { ZOMBIE_KIND } from '../../../src/domain/mob/hostile-combat.js'
import { COW_KIND } from '../../../src/domain/mob/mob-ecosystem.js'
import {
  requestBowShot,
  requestEnderPearlThrow,
  requestExperienceOrbAbsorption,
  requestMobSpawn,
} from '../../../src/stages/registration.js'
import type { Site } from '../../preview-mining-site/site.js'
import type { WorldSpec } from '../../preview-mining-site/world.js'
import {
  mountGameplayScenario,
  type ScenarioDefinition,
  type ScenarioMount,
  type ScenarioMountContext,
  type ScenarioSetup,
} from '../contract.js'

const STONE = BlockId(2)
const world: WorldSpec = {
  cells: Array.from({ length: 32 }, (_, x) => [x, 63, STONE] as const),
  loadedChunks: ['0,0', '1,0'],
  z: 0,
}
const bounds = { width: 32, height: 8 }

const spawnAttempt = (site: Site, kind: MobSpawnAttempt['kind'], x: number): MobSpawnAttempt => {
  const mobX = x + 0.5
  const mobZ = 0.5
  return {
    candidate: {
      dimension: 'overworld',
      groundBlock: STONE,
      footBlock: AIR_BLOCK_ID,
      headBlock: AIR_BLOCK_ID,
      blockLight: 0,
      timeOfDay: Effect.runSync(site.time.timeOfDay),
      distanceToPlayerBlocksXZ: Math.hypot(mobX, mobZ),
    },
    kind,
    feetPosition: position(PositionAxis(mobX), PositionAxis(64), PositionAxis(mobZ)),
  }
}

const mountAtTime = (
  context: ScenarioMountContext,
  setup: ScenarioSetup,
  timeTicks: number,
): ScenarioMount => {
  const mounted = mountGameplayScenario(context, setup)
  mounted.setTime(timeTicks)
  return mounted
}

const NIGHT_TIME_TICKS = 21_000
const DAY_TIME_TICKS = 6_000

const queueCreeperShots = (site: Site): void => {
  const handled = Effect.runSync(Ref.get(site.state.handledBowShotRequestIds)).size
  const pending = Effect.runSync(Ref.get(site.state.pendingBowShots)).length
  const firstShot = handled + pending + 1
  for (let shot = 0; shot < 4; shot += 1) {
    Effect.runSync(requestBowShot(site.state, `browser-debug-mob-arrow-${String(firstShot + shot)}`, {
      origin: position(PositionAxis(0), PositionAxis(64 + EYE_LEVEL_OFFSET), PositionAxis(0.5)),
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      chargeSecs: 1,
      inventory: { mode: 'survival', slotIndex: 0 },
    }))
  }
}

const observeMobs = (root: HTMLElement) => {
  const heading = document.createElement('h2')
  heading.textContent = 'Observed gameplay mobs'
  const details = document.createElement('pre')
  details.setAttribute('aria-label', 'Observed gameplay mob identities and positions')
  root.append(heading, details)

  return (site: Site) => {
    const mobs = Effect.runSync(site.observeMobs())
    details.textContent = JSON.stringify(mobs, null, 2)
    return { mobs }
  }
}

const observeExperienceOrbExecutions = (root: HTMLElement) => {
  const heading = document.createElement('h2')
  heading.textContent = 'Experience orb stage executions'
  const details = document.createElement('pre')
  details.setAttribute('aria-label', 'Experience orb absorption results')
  root.append(heading, details)

  return (site: Site) => {
    const executions = Effect.runSync(Ref.get(site.state.experienceOrbAbsorptionExecutions))
    details.textContent = JSON.stringify(executions, null, 2)
    return {}
  }
}

const observeEnderPearlOutcomes = (root: HTMLElement) => {
  const heading = document.createElement('h2')
  heading.textContent = 'Ender Pearl stage outcomes'
  const details = document.createElement('pre')
  details.setAttribute('aria-label', 'Ender Pearl displacement and damage results')
  root.append(heading, details)

  return (site: Site) => {
    const outcomes = Effect.runSync(Ref.get(site.state.enderPearlOutcomes))
    details.textContent = JSON.stringify(outcomes, null, 2)
    return {}
  }
}

const EXPERIENCE_ORB_ID = EntityId('browser-debug:mobs-experience-orb')
const PLAYER_ID = EntityId('browser-debug:mobs-player')
const ENDER_PEARL_REQUEST_ID = 'browser-debug:mobs-ender-pearl'

const creeperScenario: ScenarioDefinition = {
  id: 'mobs-creeper-explosion',
  title: 'Mob: creeper explosion damages the player',
  area: 'mobs',
  isDefault: false,
  mount: (context) => mountAtTime(context, {
    world,
    bounds,
    actions: [{
      id: 'creeper-explosion',
      label: 'Spawn creeper, then press Play or Step',
      perform: (site) => Effect.runSync(requestMobSpawn(site.state, spawnAttempt(site, CREEPER_KIND, 16))),
    }],
    observe: observeMobs(context.root),
  }, NIGHT_TIME_TICKS),
}

const passiveMobScenario: ScenarioDefinition = {
  id: 'mobs-passive',
  title: 'Mob: passive animals',
  area: 'mobs',
  isDefault: false,
  mount: (context) => mountAtTime(context, {
    world,
    bounds,
    actions: [{
      id: 'spawn-cow',
      label: 'Spawn cow, then press Play or Step',
      perform: (site) => Effect.runSync(requestMobSpawn(site.state, spawnAttempt(site, COW_KIND, 16))),
    }],
    observe: observeMobs(context.root),
  }, DAY_TIME_TICKS),
}

const hostileMobScenario: ScenarioDefinition = {
  id: 'mobs-hostile-contact',
  title: 'Mob: zombie contact damage',
  area: 'mobs',
  isDefault: false,
  mount: (context) => mountAtTime(context, {
    world,
    bounds,
    actions: [{
      id: 'zombie-contact',
      label: 'Spawn zombie, then press Play or Step',
      perform: (site) => Effect.runSync(requestMobSpawn(site.state, spawnAttempt(site, ZOMBIE_KIND, 18))),
    }],
    observe: observeMobs(context.root),
  }, NIGHT_TIME_TICKS),
}

const projectileDropExperienceScenario: ScenarioDefinition = {
  id: 'mobs-bow-drop-experience',
  title: 'Mob: bow kill, gunpowder drop and experience',
  area: 'mobs',
  isDefault: false,
  mount: (context) => {
    const mounted = mountAtTime(context, {
      world,
      bounds,
      actions: [
        {
          id: 'spawn-creeper',
          label: 'Spawn creeper, then Step once',
          perform: (site) => Effect.runSync(requestMobSpawn(site.state, spawnAttempt(site, CREEPER_KIND, 16))),
        },
        {
          id: 'shoot-creeper',
          label: 'After one Step, fire four survival bow shots; then Step again',
          perform: queueCreeperShots,
        },
      ],
      observe: observeMobs(context.root),
      unsupported: [
        'Bow shots are hitscan requests. This Site has no moving arrow entity or projectile renderer.',
      ],
    }, NIGHT_TIME_TICKS)
    mounted.setInventory([['bow', 1], ['arrow', 4]])
    return mounted
  },
}

const enderPearlScenario: ScenarioDefinition = {
  id: 'mobs-ender-pearl',
  title: 'Projectile: Ender Pearl displacement and damage',
  area: 'mobs',
  isDefault: false,
  mount: (context) => {
    const mounted = mountAtTime(context, {
      world,
      bounds,
      actions: [{
        id: 'throw-ender-pearl',
        label: 'Throw the seeded survival Ender Pearl, then Step',
        perform: (site) => Effect.runSync(requestEnderPearlThrow(site.state, {
          requestId: ENDER_PEARL_REQUEST_ID,
          dirX: 0,
          dirY: 0,
          dirZ: 1,
          inventory: { mode: 'survival', slotIndex: 0 },
        })),
      }],
      observe: observeEnderPearlOutcomes(context.root),
      unsupported: [
        'The interaction stage commits displacement and survival damage, but the browser debug view does not render the pearl flight path.',
      ],
    }, DAY_TIME_TICKS)
    mounted.setInventory([['ender_pearl', 1]])
    return mounted
  },
}

const endermanScenario: ScenarioDefinition = {
  id: 'mobs-enderman',
  title: 'Mob: Enderman',
  area: 'mobs',
  isDefault: false,
  mount: (context) => mountAtTime(context, {
    world,
    bounds,
    actions: [{
      id: 'spawn-enderman',
      label: 'Spawn Enderman, then press Play or Step',
      perform: (site) => Effect.runSync(requestMobSpawn(site.state, spawnAttempt(site, ENDERMAN_KIND, 16))),
    }],
    observe: observeMobs(context.root),
  }, NIGHT_TIME_TICKS),
}

const shulkerWitherScenario: ScenarioDefinition = {
  id: 'mobs-shulker-wither',
  title: 'Mob: Shulker and Wither support',
  area: 'mobs',
  isDefault: false,
  mount: (context) => mountGameplayScenario(context, {
    world,
    bounds,
    unsupported: [
      'Shulker shell rules have no gameplay mob state or projectile-stage caller.',
      'Wither domain rules have no gameplay stage caller in this host.',
    ],
  }),
}

const enderDragonScenario: ScenarioDefinition = {
  id: 'mobs-ender-dragon',
  title: 'Mob: Ender Dragon encounter',
  area: 'mobs',
  isDefault: false,
  mount: (context) => mountGameplayScenario(context, {
    world,
    bounds,
    unsupported: [
      'The encounter stage advances only in the End dimension. The Site creates a fixed Overworld player and exposes no dimension setup, so the encounter cannot progress in this scenario.',
    ],
  }),
}

const experienceOrbScenario: ScenarioDefinition = {
  id: 'mobs-xp-orb',
  title: 'Mob: absorb a physical XP orb',
  area: 'mobs',
  isDefault: false,
  mount: (context) => {
    const mounted = mountGameplayScenario(context, {
      world,
      bounds,
      actions: [{
        id: 'absorb-experience-orb',
        label: 'Queue XP orb absorption, then Step',
        perform: (site) => Effect.runSync(requestExperienceOrbAbsorption(site.state, {
          actor: PLAYER_ID,
          orb: EXPERIENCE_ORB_ID,
          tick: site.frame,
          position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
        })),
      }],
      observe: observeExperienceOrbExecutions(context.root),
    })
    mounted.seedExperienceOrbs([{
      id: EXPERIENCE_ORB_ID,
      value: Result.getOrThrow(createExperienceOrbValue(7)),
    }])
    return mounted
  },
}

export const mobScenarios: ReadonlyArray<ScenarioDefinition> = [
  creeperScenario,
  passiveMobScenario,
  hostileMobScenario,
  projectileDropExperienceScenario,
  enderPearlScenario,
  endermanScenario,
  shulkerWitherScenario,
  enderDragonScenario,
  experienceOrbScenario,
]
