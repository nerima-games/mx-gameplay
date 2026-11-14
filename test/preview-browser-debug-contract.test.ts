/// <reference lib="dom" />

import { describe, expect, it } from '@effect/vitest'
import { AngleRadians, AIR_BLOCK_ID, AttackRangeDistance, BlockAxis, DimensionIdSchema, InterpolationFraction, PositionAxis, ProjectileIdSchema, SimulationTick, SimulationTickSchema, blockIdOf, blockPosition, maxStackCountForItem, position, position as kernelPosition } from '@nerima-games/mc-kernel'
import { endArrivalDescriptor } from '@nerima-games/mc-worldgen'
import {
  BREWING_FUEL_CHARGES,
  BREWING_TIME_SECS,
  EntityId,
  SNOWBALL_PROFILE,
  type ProjectileLaunch,
} from '@nerima-games/mc-sim'
import { Brand, Effect, Option, Ref, Result, Schema } from 'effect'
import { createExperienceOrbValue } from '../src/domain/entities/xp-orb'
import { SkyLightLevel } from '../src/domain/mob/hostile-spawn'
import { makeVillager } from '../src/domain/villager-trade.js'
import { TNT_BLOCK_ID } from '../src/domain/interactions/ignite-tnt'
import { blockLoot as resolveBlockLoot, NO_TOOL } from '../src/domain/interactions/block-loot'
import { CREEPER_KIND, type MobSpawnAttempt } from '../src/domain/entities/mob-frame'
import { END_ARRIVAL_ORIGIN } from '../src/domain/end-portal-travel'
import { PORTAL_ACTIVATION_SECS } from '../src/domain/portal-dwell'
import {
  drainExperienceOrbAbsorptionExecutions,
  drainItemUseResults,
  GameplayBrewingItemUseResultSchema,
  GameplayFishingItemUseResultSchema,
  requestExperienceOrbAbsorption,
  requestMobSpawn,
} from '../src/stages/registration'
import { STONE, type WorldSpec } from '../apps/preview-mining-site/world'
import { FRAME_DELTA, requestBreak, requestItemUse } from '../apps/preview-mining-site/site'
import { mountGameplayScenario, type ScenarioSetup } from '../apps/browser-debug/contract'
import { parseUrlState } from '../apps/browser-debug/url-state'
import { BOAT_ACCELERATION, MINECART_POWERED_ACCELERATION } from '../src/domain/vehicle/vehicle-motion'

const world: WorldSpec = { cells: [], loadedChunks: ['0,0', '1,0'], z: 0 }
const bounds = { width: 32, height: 12 }
const POWERED_RAIL = Option.getOrThrow(blockIdOf('powered_rail'))
const WATER = Option.getOrThrow(blockIdOf('water'))
const DIRT_BLOCK = Option.getOrThrow(blockIdOf('dirt'))
const END_PORTAL = Option.getOrThrow(blockIdOf('end_portal'))
const blockLoot = (...args: Parameters<typeof resolveBlockLoot>) => Result.getOrThrow(resolveBlockLoot(...args))

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
  time = 21_600,
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
      const mount = mountScenario('contract-clock', world, undefined, 12_000)

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

  it.effect('brews an awkward potion through real frames and keeps a no-fuel stand unchanged', () =>
    Effect.gen(function* () {
      const brewFrames = Math.ceil(BREWING_TIME_SECS)
      const mount = mountScenario('contract-brewing-advance')
      mount.setInventory([['blaze_powder', 1], ['water_bottle', 1], ['nether_wart', 1]])
      mount.insertBrewingFuel('contract-brewing-advance-fuel')
      mount.advance()
      mount.insertBrewingBottle('contract-brewing-advance-bottle', 0, 'water_bottle')
      mount.advance()
      mount.insertBrewingIngredient('contract-brewing-advance-ingredient', 'nether_wart')
      mount.advance()

      expect(mount.observePlayerStorage().inventory.slots.every((slot) => slot === undefined)).toBe(true)
      expect(mount.observeBrewingState()).toMatchObject({
        fuelCharges: BREWING_FUEL_CHARGES,
        bottles: [{ item: 'water_bottle', count: 1 }, undefined, undefined],
        ingredient: { item: 'nether_wart', count: 1 },
      })

      expect(() => mount.requestBrewingAdvance('contract-brewing-invalid-delta', Number.NaN)).toThrow()

      for (let frame = 0; frame < brewFrames; frame += 1) {
        mount.requestBrewingAdvance(
          `contract-brewing-advance-${String(frame)}`,
          Math.min(1, BREWING_TIME_SECS - frame),
        )
        mount.advance()
      }

      const executions = mount.drainBrewingAdvanceResults()
      expect(executions).toHaveLength(brewFrames)
      expect(executions.map(({ requestId }) => requestId)).toStrictEqual(
        Array.from({ length: brewFrames }, (_, frame) => `contract-brewing-advance-${String(frame)}`),
      )
      const finalExecution = executions.at(-1)
      expect(finalExecution).toBeDefined()
      if (finalExecution === undefined) throw new Error('Expected the final brewing advance result')
      expect(Result.isSuccess(finalExecution.result)).toBe(true)
      if (Result.isFailure(finalExecution.result)) throw new Error('Expected the brew service to complete')
      const completed = finalExecution.result.success
      expect(completed.brewed).toBe(1)
      expect(completed.state.bottles[0]).toMatchObject({ item: 'awkward_potion', count: 1 })
      expect(completed.state.ingredient).toBeUndefined()
      expect(completed.state.fuelCharges).toBe(BREWING_FUEL_CHARGES - 1)
      expect(mount.observeBrewingState()).toStrictEqual(completed.state)
      mount.dispose()

      const noFuelMount = mountScenario('contract-brewing-advance-negative')
      noFuelMount.setInventory([['water_bottle', 1], ['nether_wart', 1]])
      noFuelMount.insertBrewingBottle('contract-brewing-negative-bottle', 0, 'water_bottle')
      noFuelMount.advance()
      noFuelMount.insertBrewingIngredient('contract-brewing-negative-ingredient', 'nether_wart')
      noFuelMount.advance()

      for (let frame = 0; frame < brewFrames; frame += 1) {
        noFuelMount.requestBrewingAdvance(
          `contract-brewing-negative-${String(frame)}`,
          Math.min(1, BREWING_TIME_SECS - frame),
        )
        noFuelMount.advance()
      }

      const noFuelState = noFuelMount.observeBrewingState()
      const noFuelExecutions = noFuelMount.drainBrewingAdvanceResults()
      expect(noFuelExecutions).toHaveLength(brewFrames)
      expect(noFuelExecutions.every(({ result }) =>
        Result.isSuccess(result) && result.success.brewed === 0,
      )).toBe(true)
      expect(noFuelState).toMatchObject({
        fuelCharges: 0,
        bottles: [{ item: 'water_bottle', count: 1 }, undefined, undefined],
        ingredient: { item: 'nether_wart', count: 1 },
        brewProgressSecs: 0,
      })
      noFuelMount.dispose()
    }),
  )

  it.effect('applies enchantment offers and trades through their real owners', () =>
    Effect.gen(function* () {
      const enchantMount = mountScenario('contract-enchanting')
      enchantMount.setInventory([['book', 1], ['lapis_lazuli', 1]])
      const orb = EntityId('browser-debug:enchanting-xp')
      const actor = EntityId('browser-debug:enchanting-player')
      enchantMount.seedExperienceOrbs([{ id: orb, value: Result.getOrThrow(createExperienceOrbValue(1_000)) }])
      yield* requestExperienceOrbAbsorption(enchantMount.site.state, {
        actor,
        orb,
        tick: 0,
        position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
      })
      enchantMount.advance()

      const enchantment = enchantMount.requestEnchantmentTableApply({
        itemSlot: 0,
        lapisSlot: 1,
        tableSlot: 0,
        offer: { levelCost: 1, lapisCost: 1, enchantments: [{ id: 'efficiency', level: 1 }] },
      })
      enchantMount.advance()
      expect(enchantment.item).toMatchObject({
        item: 'enchanted_book',
        count: 1,
        components: { storedEnchantments: { 'minecraft:efficiency': 1 } },
      })
      expect(enchantMount.itemMetadata.enchantedItems).toBeInstanceOf(Map)
      enchantMount.dispose()

      const noLapisMount = mountScenario('contract-enchanting-negative')
      noLapisMount.setInventory([['book', 1]])
      const noLapisOrb = EntityId('browser-debug:enchanting-no-lapis-xp')
      yield* requestExperienceOrbAbsorption(noLapisMount.site.state, {
        actor,
        orb: noLapisOrb,
        tick: 0,
        position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
      })
      noLapisMount.seedExperienceOrbs([{ id: noLapisOrb, value: Result.getOrThrow(createExperienceOrbValue(1_000)) }])
      noLapisMount.advance()
      const rejectedEnchantment = yield* Effect.result(noLapisMount.site.requestEnchantmentTableApply({
        itemSlot: 0,
        lapisSlot: 1,
        tableSlot: 0,
        offer: { levelCost: 1, lapisCost: 1, enchantments: [{ id: 'efficiency', level: 1 }] },
      }))
      expect(rejectedEnchantment).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'EnchantmentTableApplyFailure', reason: 'insufficient-lapis' },
      })
      noLapisMount.dispose()

      const farmer = makeVillager('contract-farmer', 'farmer')
      const wheatOffer = farmer.offers.find((offer) => offer.input.item === 'wheat')
      if (wheatOffer === undefined) throw new Error('Farmer fixture must expose its wheat offer')
      const tradeMount = mountScenario('contract-trade')
      tradeMount.setInventory([['wheat', wheatOffer.input.count]])
      tradeMount.setVillagerTrades({ villagers: [farmer], restockElapsedSecs: 0 })
      tradeMount.requestVillagerTrade({
        requestId: 'contract-farmer-trade',
        villagerId: farmer.id,
        offerId: wheatOffer.id,
      })
      tradeMount.advance()
      expect(tradeMount.drainVillagerTradeResults()).toStrictEqual([{
        requestId: 'contract-farmer-trade',
        villagerId: farmer.id,
        offerId: wheatOffer.id,
        _tag: 'Traded',
      }])
      expect(tradeMount.observeVillagerTrades().villagers[0]?.offers.find((offer) => offer.id === wheatOffer.id)?.uses).toBe(1)
      tradeMount.dispose()

      const noWheatMount = mountScenario('contract-trade-negative')
      noWheatMount.setVillagerTrades({ villagers: [farmer], restockElapsedSecs: 0 })
      noWheatMount.requestVillagerTrade({
        requestId: 'contract-farmer-no-wheat',
        villagerId: farmer.id,
        offerId: wheatOffer.id,
      })
      noWheatMount.advance()
      expect(noWheatMount.drainVillagerTradeResults()).toMatchObject([{
        requestId: 'contract-farmer-no-wheat',
        _tag: 'Rejected',
        reason: 'InsufficientItems',
      }])
      expect(noWheatMount.observeVillagerTrades().villagers[0]?.offers.find((offer) => offer.id === wheatOffer.id)?.uses).toBe(0)
      noWheatMount.dispose()
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
        cells: [[25, 63, STONE]],
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
          skyLight: SkyLightLevel(0),
          biome: 'PLAINS',
          timeOfDay: 0.9,
          distanceToPlayerBlocksXZ: Math.hypot(25.5, 0.5),
        },
        kind: CREEPER_KIND,
        feetPosition: position(PositionAxis(25.5), PositionAxis(64), PositionAxis(0.5)),
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
      expect(Math.abs((mobs?.[0]?.position.x ?? Number.NaN) - 25.5)).toBeLessThanOrEqual(0.1)
      expect(Math.abs((mobs?.[0]?.position.z ?? Number.NaN) - 0.5)).toBeLessThanOrEqual(0.1)
      mount.dispose()
    }),
  )

  it.effect('projects mined dirt from player storage and observes overflow drops', () =>
    Effect.gen(function* () {
      const dirtPosition = blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0))
      const dirtWorld: WorldSpec = {
        cells: [[0, 64, DIRT_BLOCK]],
        loadedChunks: ['0,0'],
        z: 0,
      }
      const expectedLoot = blockLoot(DIRT_BLOCK, NO_TOOL)
      expect(expectedLoot).toStrictEqual([{ item: 'dirt', count: 1 }])

      const emptyMount = mountScenario('contract-mine-dirt-empty', dirtWorld)
      emptyMount.setInventory([])
      yield* requestBreak(emptyMount.site, dirtPosition)
      const emptyFrame = emptyMount.advance()
      const playerStorage = emptyMount.observePlayerStorage()
      const dirtCount = playerStorage.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'dirt' ? slot.count : 0),
        0,
      )
      expect(dirtCount, JSON.stringify({ playerStorage: playerStorage.inventory, frame: emptyFrame })).toBe(1)
      expect(emptyMount.site.inventory.get('dirt')).toBe(1)
      emptyMount.dispose()

      const fullMount = mountScenario('contract-mine-dirt-full', dirtWorld)
      const slotCount = fullMount.observePlayerStorage().inventory.slots.length
      const stoneStackSize = maxStackCountForItem('stone')
      fullMount.setInventory([['stone', slotCount * stoneStackSize]])
      const fullStorage = fullMount.observePlayerStorage()
      expect(fullStorage.inventory.slots.every((slot) => slot?.count === stoneStackSize)).toBe(true)
      yield* requestBreak(fullMount.site, dirtPosition)
      fullMount.advance()

      const droppedItems = fullMount.observeDroppedItems()
      expect(droppedItems).toHaveLength(expectedLoot.length)
      expect(droppedItems[0]).toMatchObject({
        item: expectedLoot[0]?.item,
        count: expectedLoot[0]?.count,
        position: { x: 0, y: 64, z: 0 },
      })
      fullMount.dispose()
    }),
  )

  it.effect('enforces server melee reach after targeting and reads the live player pose after portal travel', () =>
    Effect.gen(function* () {
      const mobWorld: WorldSpec = {
        cells: [[0, 63, STONE]],
        loadedChunks: ['0,-2'],
        z: -25,
      }
      const attemptAt = (z: number): MobSpawnAttempt => ({
        candidate: {
          dimension: 'overworld',
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          skyLight: SkyLightLevel(0),
          biome: 'PLAINS',
          timeOfDay: 0.9,
          distanceToPlayerBlocksXZ: Math.hypot(0.5, z + 0.5),
        },
        kind: CREEPER_KIND,
        feetPosition: position(PositionAxis(0.5), PositionAxis(64), PositionAxis(z + 0.5)),
      })
      const mount = mountScenario('contract-targeted-melee', mobWorld)
      yield* requestMobSpawn(mount.site.state, attemptAt(-25))
      mount.advance()
      const beforeMob = mount.observeMobs()[0]
      expect(beforeMob).toBeDefined()
      const selected = mount.requestTargetedPrimaryAttack({ meleeReach: AttackRangeDistance(30) })
      expect(selected._tag).toBe('Melee')
      if (selected._tag !== 'Melee' || beforeMob === undefined) {
        throw new Error('Expected the targeted primary attack to select the spawned Mob')
      }
      expect(selected.target.id).toBe(beforeMob.id)
      mount.advance()
      const afterMob = mount.observeMobs().find(({ id }) => id === beforeMob.id)
      expect(afterMob?.healthPoints).toBe(beforeMob.healthPoints)
      mount.dispose()

      const behindMount = mountScenario('contract-targeted-melee-negative', {
        cells: [[0, 63, STONE]],
        loadedChunks: ['0,1'],
        z: 24,
      })
      yield* requestMobSpawn(behindMount.site.state, attemptAt(24))
      behindMount.advance()
      const behindMob = behindMount.observeMobs()[0]
      expect(behindMob).toBeDefined()
      if (behindMob === undefined) throw new Error('Expected the negative-control Mob to spawn')
      expect(behindMount.requestTargetedPrimaryAttack({ meleeReach: AttackRangeDistance(30) }))
        .toStrictEqual({ _tag: 'None' })
      behindMount.advance()
      expect(behindMount.observeMobs().find(({ id }) => id === behindMob.id)?.healthPoints)
        .toBe(behindMob.healthPoints)
      behindMount.dispose()
    }),
  )

  it.effect('reads the live player pose after portal travel', () =>
    Effect.gen(function* () {
      const portalMount = mountScenario('contract-live-player-pose', {
        cells: [[0, 64, END_PORTAL]],
        loadedChunks: ['0,0'],
        z: 0,
      }, (site) => ({ playerPose: Effect.runSync(site.observePlayerPose()) }))
      const initialPose = portalMount.observePlayerPose()
      expect(initialPose).toMatchObject({ dimension: 'overworld', position: { x: 0, y: 64, z: 0 } })
      const activationFrames = Math.ceil(PORTAL_ACTIVATION_SECS / FRAME_DELTA) + 1
      for (let frame = 0; frame < activationFrames; frame += 1) {
        const tick = Effect.runSync(Ref.get(portalMount.site.state.tickCount))
        Effect.runSync(Ref.set(portalMount.site.state.lastHostileSpawnTick, SimulationTick(tick)))
        portalMount.advance()
      }
      const expectedArrival = endArrivalDescriptor(END_ARRIVAL_ORIGIN).spawn
      const arrivedPose = portalMount.observePlayerPose()
      expect(arrivedPose).toStrictEqual({ dimension: 'end', position: expectedArrival })
      expect(portalMount.snapshot().playerDimension).toBe('end')
      expect(portalMount.snapshot().playerPose).toStrictEqual(arrivedPose)
      portalMount.dispose()

      const noPortalMount = mountScenario('contract-live-player-pose-negative')
      for (let frame = 0; frame < activationFrames; frame += 1) {
        const tick = Effect.runSync(Ref.get(noPortalMount.site.state.tickCount))
        Effect.runSync(Ref.set(noPortalMount.site.state.lastHostileSpawnTick, SimulationTick(tick)))
        noPortalMount.advance()
      }
      expect(noPortalMount.observePlayerPose()).toStrictEqual(initialPose)
      noPortalMount.dispose()
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
