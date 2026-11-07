/// <reference lib="dom" />

import { describe, expect, it } from '@effect/vitest'
import { AngleRadians, AIR_BLOCK_ID, BlockAxis, DimensionIdSchema, InterpolationFraction, PositionAxis, ProjectileIdSchema, SimulationTickSchema, blockIdOf, blockPosition, position, position as kernelPosition } from '@nerima-games/mc-kernel'
import { BREWING_FUEL_CHARGES, EntityId, SNOWBALL_PROFILE, type ProjectileLaunch } from '@nerima-games/mc-sim'
import { Brand, Effect, Option, Ref, Result, Schema } from 'effect'
import { createExperienceOrbValue } from '../src/domain/entities/xp-orb'
import { TNT_BLOCK_ID } from '../src/domain/interactions/ignite-tnt'
import { CREEPER_KIND, type MobSpawnAttempt } from '../src/domain/entities/mob-frame'
import {
  drainExperienceOrbAbsorptionExecutions,
  drainItemUseResults,
  GameplayBrewingItemUseResultSchema,
  GameplayFishingItemUseResultSchema,
  requestExperienceOrbAbsorption,
  requestMobSpawn,
} from '../src/stages/registration'
import { STONE, type WorldSpec } from '../apps/preview-mining-site/world'
import { requestItemUse } from '../apps/preview-mining-site/site'
import { mountGameplayScenario, type ScenarioSetup } from '../apps/browser-debug/contract'
import { parseUrlState } from '../apps/browser-debug/url-state'
import { BOAT_ACCELERATION, MINECART_POWERED_ACCELERATION } from '../src/domain/vehicle/vehicle-motion'

const world: WorldSpec = { cells: [], loadedChunks: ['0,0', '1,0'], z: 0 }
const bounds = { width: 32, height: 12 }
const POWERED_RAIL = Option.getOrThrow(blockIdOf('powered_rail'))
const WATER = Option.getOrThrow(blockIdOf('water'))

const contractActor = EntityId('browser-debug:contract-fisher')
const contractBobber = Schema.decodeUnknownSync(ProjectileIdSchema)('browser-debug:contract-bobber')
const contractLaunchSpeed = Brand.nominal<ProjectileLaunch['speed']>()(1)
const contractFishingLaunch: ProjectileLaunch = {
  position: kernelPosition(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: contractLaunchSpeed,
}

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

  it.effect('settles fishing casts and brewing stand setup through real Site services', () =>
    Effect.gen(function* () {
      const mount = mountScenario('contract-fishing-brewing')
      mount.setInventory([['blaze_powder', 1], ['water_bottle', 1], ['nether_wart', 1]])

      mount.requestFishingCast({
        requestId: 'contract-fishing-cast',
        actor: contractActor,
        bobber: contractBobber,
        tick: Schema.decodeUnknownSync(SimulationTickSchema)(0),
        dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'),
        launch: contractFishingLaunch,
        profile: SNOWBALL_PROFILE,
        rod: null,
        environment: { hasWater: true, hasSkyAccess: true, isRaining: false, isOpenWater: true },
      })
      mount.advance()

      expect(mount.observeFishingState().rods).toMatchObject([
        { actor: contractActor, bobber: contractBobber, phase: 'cast' },
      ])
      expect(mount.drainItemUseResults().map((result) =>
        Schema.decodeUnknownSync(GameplayFishingItemUseResultSchema)(result),
      )).toStrictEqual([{
        action: 'CastFishing', requestId: 'contract-fishing-cast', success: true, outcome: undefined,
      }])

      mount.insertBrewingFuel('contract-brewing-fuel')
      mount.advance()
      mount.insertBrewingBottle('contract-brewing-bottle', 0, 'water_bottle')
      mount.advance()
      mount.insertBrewingIngredient('contract-brewing-ingredient', 'nether_wart')
      mount.advance()

      const brewingState = mount.observeBrewingState()
      expect(brewingState.fuelCharges).toBe(BREWING_FUEL_CHARGES)
      expect(brewingState.bottles[0]).toMatchObject({ item: 'water_bottle', count: 1 })
      expect(brewingState.ingredient).toMatchObject({ item: 'nether_wart', count: 1 })
      expect(mount.drainItemUseResults().map((result) =>
        Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)(result),
      )).toStrictEqual([
        { action: 'InsertBrewingFuel', requestId: 'contract-brewing-fuel', success: true, outcome: undefined },
        { action: 'InsertBrewingBottle', requestId: 'contract-brewing-bottle', success: true, outcome: undefined },
        { action: 'InsertBrewingIngredient', requestId: 'contract-brewing-ingredient', success: true, outcome: undefined },
      ])
      mount.dispose()

      const emptyMount = mountScenario('contract-brewing-negative')
      emptyMount.insertBrewingFuel('contract-brewing-no-fuel')
      emptyMount.advance()
      expect(emptyMount.observeBrewingState().fuelCharges).toBe(0)
      expect(emptyMount.drainItemUseResults().map((result) =>
        Schema.decodeUnknownSync(GameplayBrewingItemUseResultSchema)(result),
      )).toStrictEqual([{
        action: 'InsertBrewingFuel', requestId: 'contract-brewing-no-fuel', success: false, failure: 'MissingItem',
      }])
      emptyMount.dispose()
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

  it.effect('moves a mounted minecart on powered rail according to the acceleration rule', () =>
    Effect.gen(function* () {
      const track: WorldSpec = {
        cells: [[0, 64, POWERED_RAIL]],
        loadedChunks: ['0,0'],
        z: 0,
      }
      const railPosition = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
      const mount = mountScenario('contract-powered-minecart', track)
      const cart = mount.spawnVehicle(
        'minecart',
        'overworld',
        position(PositionAxis(0.5), PositionAxis(64), PositionAxis(0.5)),
      )
      mount.mountVehicle(cart.id, 'contract:minecart-rider')
      mount.setPoweredRailAt(railPosition, true)

      let expectedZ = 0.5
      let expectedVelocity = 0
      for (let frame = 0; frame < 12; frame += 1) {
        expectedVelocity -= MINECART_POWERED_ACCELERATION / 60
        expectedZ += expectedVelocity / 60
        mount.advance()
        const observed = mount.observeVehicles()[0]

        expect(observed?.position.z).toBeCloseTo(expectedZ, 8)
        expect(observed?.velocity.z).toBeCloseTo(expectedVelocity, 8)
      }
      expect(mount.observeVehicles()[0]?.occupant).toBe('contract:minecart-rider')
      mount.dispose()
    }),
  )

  it.effect('moves a mounted boat on water according to the acceleration and drag rules', () =>
    Effect.gen(function* () {
      const waterWorld: WorldSpec = {
        cells: [[0, 64, WATER]],
        loadedChunks: ['0,0'],
        z: 0,
      }
      const mount = mountScenario('contract-boat', waterWorld)
      const boat = mount.spawnVehicle(
        'boat',
        'overworld',
        position(PositionAxis(0.5), PositionAxis(64), PositionAxis(0.5)),
      )
      mount.mountVehicle(boat.id, 'contract:boat-rider')
      mount.setVehicleControls(boat.id, { throttle: 1, steering: 0 })

      const dt = 1 / 60
      const waterDrag = Math.pow(0.9, dt * 20)
      let expectedZ = 0.5
      let expectedVelocity = 0
      for (let frame = 0; frame < 5; frame += 1) {
        expectedVelocity = (expectedVelocity - BOAT_ACCELERATION * dt) * waterDrag
        expectedZ += expectedVelocity * dt
        mount.advance()
        const observed = mount.observeVehicles()[0]

        expect(observed?.position.z).toBeCloseTo(expectedZ, 8)
        expect(observed?.velocity.z).toBeCloseTo(expectedVelocity, 8)
      }
      expect(mount.observeVehicles()[0]?.occupant).toBe('contract:boat-rider')
      mount.dispose()
    }),
  )

  it.effect('keeps a mounted minecart still on an unpowered control rail', () =>
    Effect.gen(function* () {
      const track: WorldSpec = {
        cells: [[0, 64, POWERED_RAIL]],
        loadedChunks: ['0,0'],
        z: 0,
      }
      const railPosition = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
      const mount = mountScenario('contract-unpowered-minecart', track)
      const cart = mount.spawnVehicle(
        'minecart',
        'overworld',
        position(PositionAxis(0.5), PositionAxis(64), PositionAxis(0.5)),
      )
      mount.mountVehicle(cart.id, 'contract:unpowered-rider')
      mount.setPoweredRailAt(railPosition, false)
      for (let frame = 0; frame < 12; frame += 1) mount.advance()

      const observed = mount.observeVehicles()[0]
      expect(observed?.position.z).toBe(0.5)
      expect(observed?.velocity.z).toBe(0)
      mount.dispose()
    }),
  )
})
