/// <reference lib="dom" />

import { describe, expect, it } from '@effect/vitest'
import { AIR_BLOCK_ID, BlockAxis, InterpolationFraction, PositionAxis, blockPosition, position } from '@nerima-games/mc-kernel'
import { EntityId } from '@nerima-games/mc-sim'
import { Effect, Ref, Result } from 'effect'
import { createExperienceOrbValue } from '../src/domain/entities/xp-orb'
import { TNT_BLOCK_ID } from '../src/domain/interactions/ignite-tnt'
import { CREEPER_KIND, type MobSpawnAttempt } from '../src/domain/entities/mob-frame'
import {
  drainExperienceOrbAbsorptionExecutions,
  drainItemUseResults,
  requestExperienceOrbAbsorption,
  requestMobSpawn,
} from '../src/stages/registration'
import { STONE, type WorldSpec } from '../apps/preview-mining-site/world'
import { requestItemUse } from '../apps/preview-mining-site/site'
import { mountGameplayScenario, type ScenarioSetup } from '../apps/browser-debug/contract'
import { parseUrlState } from '../apps/browser-debug/url-state'

const world: WorldSpec = { cells: [], loadedChunks: ['0,0', '1,0'], z: 0 }
const bounds = { width: 32, height: 12 }

const mountScenario = (
  scenarioId: string,
  scenarioWorld: WorldSpec = world,
  observe?: ScenarioSetup['observe'],
  time = 12_000,
) =>
  mountGameplayScenario(
    {
      root: { replaceChildren: () => undefined } as unknown as HTMLElement,
      scenarioId,
      seed: 17,
      time,
      weather: 'clear',
    },
    {
      world: scenarioWorld,
      bounds,
      ...(observe === undefined ? {} : { observe }),
    },
  )

describe('browser debug Site contract', () => {
  it('negative control: the URL default tick count cannot pass directly as an interpolation fraction', () => {
    const urlDefault = parseUrlState('', [], 'contract-clock').state

    expect(urlDefault.time).toBe(6000)
    expect(() => InterpolationFraction(urlDefault.time)).toThrow(/InterpolationFraction/)
  })

  it.effect('sets the gameplay TimeService clock while retaining the previous snapshot shape', () =>
    Effect.gen(function* () {
      const mount = mountScenario('contract-clock')

      expect(yield* mount.site.time.timeOfDay).toBe(0.5)
      expect(yield* Ref.get(mount.site.state.timeOfDay)).toBe(0.5)
      expect(Object.hasOwn(mount.snapshot(), 'mobs')).toBe(false)

      mount.setTime(6000)

      expect(yield* mount.site.time.timeOfDay).toBe(0.25)
      expect(yield* Ref.get(mount.site.state.timeOfDay)).toBe(0.25)
      expect(mount.snapshot().timeOfDay).toBe(6000)
      mount.dispose()
    }),
  )

  it.effect('mounts URL defaults and normalizes boundary tick values for both gameplay clocks', () =>
    Effect.gen(function* () {
      const urlDefaultTime = parseUrlState('', [], 'contract-url-default').state.time
      const defaultMount = mountScenario('contract-url-default', world, undefined, urlDefaultTime)

      expect(defaultMount.snapshot().timeOfDay).toBe(6000)
      expect(yield* defaultMount.site.time.timeOfDay).toBe(0.25)
      expect(yield* Ref.get(defaultMount.site.state.timeOfDay)).toBe(0.25)
      defaultMount.dispose()

      for (const [input, expectedTicks] of [[0, 0], [23999, 23997], [24000, 0], [-1, 23997]] as const) {
        const mount = mountScenario(`contract-time-${String(input)}`, world, undefined, input)
        const expectedFraction = expectedTicks / 24_000

        expect(mount.snapshot().timeOfDay).toBe(expectedTicks)
        expect(yield* mount.site.time.timeOfDay).toBe(expectedFraction)
        expect(yield* Ref.get(mount.site.state.timeOfDay)).toBe(expectedFraction)
        mount.dispose()
      }
    }),
  )

  it.effect('sets player storage for successful fire charge TNT ignition through gameplay stages', () =>
    Effect.gen(function* () {
      const tntWorld: WorldSpec = {
        cells: [[0, 64, TNT_BLOCK_ID]],
        loadedChunks: ['0,0', '1,0'],
        z: 0,
      }
      const mount = mountScenario('contract-inventory', tntWorld)
      const target = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))

      mount.setInventory([['fire_charge', 1]])
      yield* requestItemUse(mount.site, target, 'fire_charge')
      mount.advance()

      expect(yield* mount.site.world.api.getBlock(target)).toMatchObject({ _tag: 'Block', block: AIR_BLOCK_ID })
      expect(yield* Ref.get(mount.site.state.usedItems)).toStrictEqual(['fire_charge'])
      expect(yield* drainItemUseResults(mount.site.state)).toMatchObject([{
        heldItem: 'fire_charge',
        success: true,
        outcome: { _tag: 'Tnt', outcome: { _tag: 'Lit' } },
      }])
      mount.dispose()
    }),
  )

  it.effect('keeps an empty player storage owner unsupported for item use', () =>
    Effect.gen(function* () {
      const mount = mountScenario('contract-empty-inventory')
      const target = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))

      mount.setInventory([])
      yield* requestItemUse(mount.site, target, 'fire_charge')
      mount.advance()

      const unsupported = yield* Ref.get(mount.site.state.unsupportedOperations)
      expect(unsupported).toMatchObject([
        { action: 'IgniteTnt', reason: 'OwnerRegistrationUnavailable' },
      ])
      mount.dispose()
    }),
  )

  it.effect('observes the identity and position of a gameplay-spawned Mob on demand', () =>
    Effect.gen(function* () {
      const mobWorld: WorldSpec = {
        cells: [[16, 63, STONE]],
        loadedChunks: ['0,0', '1,0'],
        z: 0,
      }
      const attempt: MobSpawnAttempt = {
        candidate: {
          dimension: 'overworld',
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          timeOfDay: 0.9,
          distanceToPlayerBlocksXZ: Math.hypot(16.5, 0.5),
        },
        kind: CREEPER_KIND,
        feetPosition: position(PositionAxis(16.5), PositionAxis(64), PositionAxis(0.5)),
      }
      const mount = mountScenario('contract-mob-observation', mobWorld, (site) => ({
        mobs: Effect.runSync(site.observeMobs()),
      }))

      yield* requestMobSpawn(mount.site.state, attempt)
      mount.advance()

      const mobs = mount.snapshot().mobs
      expect(mobs).toHaveLength(1)
      expect(mobs?.[0]).toMatchObject({
        kind: CREEPER_KIND,
        position: { y: 64 },
      })
      expect(mobs?.[0]?.id).toEqual(expect.any(String))
      expect(Math.abs((mobs?.[0]?.position.x ?? Number.NaN) - 16.5)).toBeLessThanOrEqual(0.1)
      expect(Math.abs((mobs?.[0]?.position.z ?? Number.NaN) - 0.5)).toBeLessThanOrEqual(0.1)
      mount.dispose()
    }),
  )

  it.effect('lets the gameplay stage consume a seeded XP orb', () =>
    Effect.gen(function* () {
      const mount = mountScenario('contract-xp-orb')
      const orb = EntityId('browser-debug:contract-orb')
      const actor = EntityId('browser-debug:contract-player')
      const request = {
        actor,
        orb,
        tick: 0,
        position: { dimension: 'overworld' as const, x: 0, y: 64, z: 0 },
      }

      mount.seedExperienceOrbs([{ id: orb, value: Result.getOrThrow(createExperienceOrbValue(7)) }])
      yield* requestExperienceOrbAbsorption(mount.site.state, request)
      mount.advance()

      const executions = yield* drainExperienceOrbAbsorptionExecutions(mount.site.state)
      expect(executions).toHaveLength(1)
      expect(executions[0]?.outcome).toMatchObject({
        _tag: 'Completed',
        result: expect.arrayContaining([
          expect.objectContaining({ _tag: 'ExperienceCollected', orb, amount: 7 }),
        ]),
      })
      mount.dispose()
    }),
  )
})
