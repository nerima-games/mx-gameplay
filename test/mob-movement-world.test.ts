import { describe, expect, it } from '@effect/vitest'
import { Brand, Effect, Option, Result, Schema } from 'effect'
import { BlockAxis, BlockId, BlockStateIndex, BlockStateLength, blockIdOf, blockPosition, ChunkAxis, chunkCoord, EntityHealthPoints, EntitySerial, SimulationTick, type BlockType, position, PositionAxis } from '@nerima-games/mc-kernel'
import { EntityId, EntityKind, MobMovementStateSchema, MobPathProfileSchema, planMobPathsForTick } from '@nerima-games/mc-sim'
import { openChunkWindow, UNREADABLE_BLOCK, type ChunkWindow } from '../src/domain/chunk-window'
import {
  entityWorldBlockDataAt,
  entityWorldCellAt,
} from '../src/domain/entities/entity-world-cell'
import {
  initialMobMovementState,
  mobMovementCell,
  mobMovementPhysicsSampleForCell,
  mobMovementWorldFromChunkWindow,
  movementFeetPosition,
  movementStateForGoal,
} from '../src/domain/entities/mob-movement-world'
import { ENDERMAN_KIND, PIG_KIND, SPIDER_KIND, initialEcosystemMobState } from '../src/domain/mob/mob-ecosystem'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import { repairMobBehaviour, STEADY_ENDERMAN, hasMobMovementCandidates, planMobMovementRoster, type MobRoster } from '../src/domain/entities/mob-frame'
import { makeChunkStoreDouble, world, STONE } from './support/chunk-store-double'

const block = (x: number, y: number, z: number) => blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))
const at = (x: number, y: number, z: number) => position(PositionAxis(x), PositionAxis(y), PositionAxis(z))
const blockId = (type: BlockType) => Option.getOrThrow(blockIdOf(type))

const makeWorldPort = (entries: ReadonlyArray<readonly [ReturnType<typeof block>, ReturnType<typeof blockId>]>, loaded = ['0,0']) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(world(entries), loaded)
    const coords = loaded.map((value) => {
      const [x, z] = value.split(',')
      if (x === undefined || z === undefined) throw new Error('chunk coordinates must be comma-separated')
      return chunkCoord(ChunkAxis(Number(x)), ChunkAxis(Number(z)))
    })
    const window = yield* openChunkWindow(store.api, coords)
    const port = mobMovementWorldFromChunkWindow(window)
    if (port === undefined) throw new Error('the kernel registry must resolve bedrock as the fail-closed block')
    return port
  })

describe('SM3 mob movement world', () => {
  it('initializes an omitted ecosystem state with its vanilla zero-state values', () => {
    expect(repairMobBehaviour(PIG_KIND, undefined)).toMatchObject({
      _tag: 'HostileMob',
      behaviour: {
        _tag: 'EcosystemMob',
        attackCooldownTicks: 0,
        motionPhase: 0,
        provoked: false,
        hasHeadProtection: false,
        burningTicks: 0,
      },
    })
  })

  it('returns typed failures for unavailable windows and out-of-range block ids', () => {
    const cell = { x: BlockAxis(0), y: BlockAxis(64), z: BlockAxis(0) }
    const legacyWindow: ChunkWindow = {
      blockAt: () => UNREADABLE_BLOCK,
      unreadableProbes: () => 0,
    }
    const unavailable = entityWorldCellAt(legacyWindow, cell)
    const invalidBlockId = Brand.nominal<BlockId>()(65_536)
    const invalidLookup = entityWorldBlockDataAt(cell, invalidBlockId)

    expect(unavailable).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'EntityWorldWindowUnavailable', cell },
    })
    expect(invalidLookup).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'EntityWorldRegistryFailure', cell },
    })
  })

  it.effect('rejects an unregistered id read from a loaded chunk buffer', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const unregisteredIdStore = {
        ...store.api,
        peek: (coord: Parameters<typeof store.api.peek>[0]) => Effect.map(store.api.peek(coord), (chunk) =>
          chunk === undefined
            ? undefined
            : { ...chunk, blocks: Uint16Array.from(chunk.blocks, () => 65_535) },
        ),
      }
      const window = yield* openChunkWindow(unregisteredIdStore, [chunkCoord(ChunkAxis(0), ChunkAxis(0))])
      const cell = { x: BlockAxis(0), y: BlockAxis(64), z: BlockAxis(0) }

      expect(entityWorldCellAt(window, cell)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'EntityWorldUnregisteredBlockId', cell, blockId: 65_535 },
      })
    }),
  )

  it('keeps registry failures on SM3 physics results and above-world air lookups', () => {
    const cell = { x: BlockAxis(0), y: BlockAxis(64), z: BlockAxis(0) }
    const registryFailure = {
      _tag: 'EntityWorldRegistryFailure' as const,
      cell,
      failure: {
        _tag: 'BlockPropertyFailure' as const,
        reason: 'type' as const,
        message: 'property columns could not be resolved',
      },
    }

    const fromRegistryFailure = mobMovementPhysicsSampleForCell(
      Result.fail(registryFailure),
      () => Result.fail(registryFailure),
    )
    expect(fromRegistryFailure.sample).toStrictEqual(Result.fail(registryFailure.failure))
    expect(fromRegistryFailure.queryFailure).toMatchObject({
      _tag: 'EntityWorldRegistryFailure',
      cell,
      failure: registryFailure.failure,
    })

    const fromAboveWorldAirFailure = mobMovementPhysicsSampleForCell(
      Result.succeed({ _tag: 'AboveWorld' }),
      () => Result.fail(registryFailure),
    )
    expect(fromAboveWorldAirFailure.sample).toStrictEqual(Result.fail(registryFailure.failure))
    expect(fromAboveWorldAirFailure.queryFailure).toMatchObject({
      _tag: 'EntityWorldRegistryFailure',
      cell,
      failure: registryFailure.failure,
    })

    const unregisteredAir = {
      _tag: 'EntityWorldUnregisteredBlockId' as const,
      cell,
      blockId: BlockId(65_535),
    }
    const fromAboveWorldUnregisteredAir = mobMovementPhysicsSampleForCell(
      Result.succeed({ _tag: 'AboveWorld' }),
      () => Result.fail(unregisteredAir),
    )
    expect(fromAboveWorldUnregisteredAir.sample).toStrictEqual(Result.succeed(null))
    expect(fromAboveWorldUnregisteredAir.queryFailure).toStrictEqual(unregisteredAir)
  })

  it.effect('reads air as passable, blocks as solid, and exposes support and hazards', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([
        [block(0, 63, 0), STONE],
        [block(5, 64, 0), STONE],
        [block(2, 64, 0), blockId('cactus')],
        [block(3, 64, 0), blockId('fire')],
        [block(4, 64, 0), blockId('water')],
      ])
      const air = mobMovementCell(at(1, 64, 0))!
      const standing = mobMovementCell(at(0, 64, 0))!
      const floor = mobMovementCell(at(0, 63, 0))!
      const solid = mobMovementCell(at(5, 64, 0))!
      const cactus = mobMovementCell(at(2, 64, 0))!
      const fire = mobMovementCell(at(3, 64, 0))!
      const water = mobMovementCell(at(4, 64, 0))!

      expect(port.isPassable(air)).toBe(true)
      expect(port.isPassable(standing)).toBe(true)
      expect(port.isPassable(solid)).toBe(false)
      expect(port.hasSupport(floor)).toBe(true)
      expect(port.hasSupport(standing)).toBe(false)
      expect(port.hasSupport(air)).toBe(false)
      expect(port.hazardAt(cactus)).toBe('cactus')
      expect(port.hazardAt(fire)).toBe('fire')
      expect(port.hazardAt(water)).toBe('water')
    }),
  )

  it.effect('maps kernel collision categories to block-local physical shapes', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([
        [block(0, 64, 0), STONE],
        [block(1, 64, 0), blockId('stone_slab')],
        [block(2, 64, 0), blockId('cactus')],
        [block(3, 64, 0), blockId('pressure_plate')],
      ])
      const shapeAt = port.physics.blockShapeAt
      if (shapeAt === undefined) throw new Error('SM3 physics requires block shape queries')
      const shape = (x: number) => shapeAt(BlockAxis(x), BlockAxis(64), BlockAxis(0))

      expect(shape(0)).toMatchObject({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 })
      expect(shape(1)).toMatchObject({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 })
      expect(shape(2)).toMatchObject({ minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: 1, maxZ: 15 / 16 })
      expect(shape(3)).toMatchObject({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1 / 16, maxZ: 1 })
      expect(shapeAt(BlockAxis(4), BlockAxis(64), BlockAxis(0))).toBeNull()
      expect(port.physics.environment.blockShapeAt?.(BlockAxis(1), BlockAxis(64), BlockAxis(0))).toEqual(shape(1))
    }),
  )

  it.effect('keeps unloaded cells distinct and refuses paths without inventing a collision shape', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([], [])
      const cell = mobMovementCell(at(0, 64, 0))!
      const movement = initialMobMovementState(EntityId('mob:unloaded-overlap'), PIG_KIND, at(0.5, 64, 0.5), at(2.5, 64, 0.5))
      const blockSample = port.physics.environment.blockAt(BlockAxis(0), BlockAxis(64), BlockAxis(0))
      const blockShape = port.physics.blockShapeAt?.(BlockAxis(0), BlockAxis(64), BlockAxis(0))

      expect(movement).toBeDefined()
      if (movement === undefined) return
      expect(port.isPassable(cell)).toBe(false)
      expect(port.hasSupport(cell)).toBe(false)
      expect(port.hazardAt(cell)).toBeNull()
      expect(port.physics.blockPropertiesAt(BlockAxis(0), BlockAxis(64), BlockAxis(0))).toStrictEqual(Result.succeed(null))
      expect(blockSample._tag).toBe('Success')
      if (blockSample._tag === 'Success') {
        expect(blockSample.success).toBeNull()
      }
      expect(blockShape).toBeNull()
      expect(port.bodyOverlapsUnloadedCell(movement)).toStrictEqual(Result.succeed(true))
      expect(port.queryFailure()).toBeUndefined()
    }),
  )

  it.effect('propagates a corrupt chunk buffer through every movement-world query', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const corruptStore = {
        ...store.api,
        peek: (coord: Parameters<typeof store.api.peek>[0]) => Effect.map(store.api.peek(coord), (chunk) =>
          chunk === undefined ? undefined : { ...chunk, blocks: Uint16Array.from(chunk.blocks).subarray(0, 1) },
        ),
      }
      const window = yield* openChunkWindow(corruptStore, [chunkCoord(ChunkAxis(0), ChunkAxis(0))])
      const port = mobMovementWorldFromChunkWindow(window)
      const cell = mobMovementCell(at(0.5, 64, 0.5))!
      const coordinates = [BlockAxis(0), BlockAxis(64), BlockAxis(0)] as const
      const movement = initialMobMovementState(EntityId('mob:corrupt-overlap'), PIG_KIND, at(0.5, 64, 0.5), at(2.5, 64, 0.5))

      expect(movement).toBeDefined()
      if (movement === undefined) return
      expect(port.cellAt(cell)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'EntityWorldCorruptBuffer', cell: { x: 0, y: 64, z: 0 } },
      })
      expect(port.isPassable(cell)).toBe(false)
      expect(port.hasSupport(cell)).toBe(false)
      expect(port.hazardAt(cell)).toBeNull()
      expect(port.physics.environment.blockAt(...coordinates)).toStrictEqual(Result.succeed(null))
      expect(port.physics.blockPropertiesAt(...coordinates)).toStrictEqual(Result.succeed(null))
      expect(port.physics.blockShapeAt?.(...coordinates)).toBeNull()
      expect(port.bodyOverlapsUnloadedCell(movement)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'EntityWorldCorruptBuffer' },
      })
      expect(port.queryFailure()).toMatchObject({ _tag: 'EntityWorldCorruptBuffer' })
      port.resetQueryFailure()
      expect(port.queryFailure()).toBeUndefined()
    }),
  )

  it.effect('treats above-world as air and below-world as the non-colliding void', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([])
      const above = mobMovementCell(at(0, 256, 0))!
      const below = mobMovementCell(at(0, -1, 0))!
      const abovePhysics = port.physics.environment.blockAt(BlockAxis(0), BlockAxis(256), BlockAxis(0))
      const belowPhysics = port.physics.environment.blockAt(BlockAxis(0), BlockAxis(-1), BlockAxis(0))

      expect(port.cellAt(above)).toMatchObject({ _tag: 'Success', success: { _tag: 'AboveWorld' } })
      expect(port.cellAt(below)).toMatchObject({ _tag: 'Success', success: { _tag: 'BelowWorld' } })
      expect(port.isPassable(above)).toBe(true)
      expect(port.isPassable(below)).toBe(true)
      expect(abovePhysics).toMatchObject({ _tag: 'Success', success: { properties: { collisionShape: 'none' } } })
      expect(belowPhysics).toMatchObject({ _tag: 'Success', success: null })
      expect(port.physics.blockPropertiesAt(BlockAxis(0), BlockAxis(-1), BlockAxis(0))).toStrictEqual(Result.succeed(null))
      expect(port.physics.blockShapeAt?.(BlockAxis(0), BlockAxis(256), BlockAxis(0))).toBeNull()
      expect(port.physics.blockShapeAt?.(BlockAxis(0), BlockAxis(-1), BlockAxis(0))).toBeNull()
    }),
  )

  it('round-trips feet coordinates through the branded SM3 body and resets paths for a new goal', () => {
    const feet = at(2.5, 64, 3.5)
    const firstGoal = at(8.5, 64, 3.5)
    const nextGoal = at(9.5, 64, 3.5)
    const initial = initialMobMovementState(EntityId('mob:movement-world'), SPIDER_KIND, feet, firstGoal)

    expect(initial).toBeDefined()
    if (initial === undefined) return

    expect(movementFeetPosition(initial)).toEqual(feet)
    const unchangedGoal = movementStateForGoal(initial, firstGoal)
    expect(unchangedGoal).toBe(initial)

    const changedGoal = movementStateForGoal(initial, nextGoal)
    expect(changedGoal).toMatchObject({
      goal: { x: 9, y: 64, z: 3 },
      path: [],
      pathIndex: 0,
      stuckTicks: 0,
    })
    expect(initialMobMovementState(EntityId('mob:spider'), SPIDER_KIND, feet, firstGoal)?.movementSpeed).toBe(3)
    expect(initialMobMovementState(EntityId('mob:blaze'), EntityKind('blaze'), feet, firstGoal)).toMatchObject({
      profile: { kind: 'ground' },
      goal: { x: 8, y: 64, z: 3 },
    })
  })

  it('rejects finite positions whose floored coordinates cannot be path cells', () => {
    const outsidePathGrid = at(Number.MAX_SAFE_INTEGER + 1, 64, 0)
    const spider = initialMobMovementState(
      EntityId('mob:outside-path-grid'),
      SPIDER_KIND,
      at(0.5, 64, 0.5),
      outsidePathGrid,
    )
    const ordinary = initialMobMovementState(
      EntityId('mob:ordinary-path-grid'),
      SPIDER_KIND,
      at(0.5, 64, 0.5),
      at(4.5, 64, 0.5),
    )

    expect(mobMovementCell(outsidePathGrid)).toBeUndefined()
    expect(spider).toBeUndefined()
    expect(ordinary).toBeDefined()
    if (ordinary === undefined) return
    expect(movementStateForGoal(ordinary, outsidePathGrid)).toBeUndefined()
  })

  it.effect('keeps an unregistered block id as a typed world query fault', () =>
    Effect.gen(function* () {
      const unresolvedBlockId = BlockId(65535)
      const port = yield* makeWorldPort([[block(0, 64, 0), unresolvedBlockId]])
      const cell = mobMovementCell(at(0.5, 64, 0.5))!

      expect(port.isPassable(cell)).toBe(false)
      expect(port.queryFailure()).toMatchObject({
        _tag: 'EntityWorldUnregisteredBlockId',
        cell: { x: 0, y: 64, z: 0 },
        blockId: 65_535,
      })
    }),
  )

  it.effect('moves a distant Blaze toward its ranged band with SM3 physics', () =>
    Effect.gen(function* () {
      const floor = Array.from({ length: 32 }, (_value, x) => [block(x, 63, 0), STONE] as const)
      const port = yield* makeWorldPort(floor, ['0,0', '1,0'])
      const blaze = {
        id: EntityId('mob:blaze'),
        kind: EntityKind('blaze'),
        feetPosition: at(30.5, 64, 0.5),
        healthPoints: EntityHealthPoints(20),
        behaviour: initialEcosystemMobState(),
        dimension: 'nether' as const,
      }
      const roster = { entities: [blaze], nextSerial: EntitySerial(1) }
      const stationaryBlaze = {
        ...blaze,
        feetPosition: at(10.5, 64, 0.5),
      }
      expect(hasMobMovementCandidates(
        { entities: [stationaryBlaze], nextSerial: EntitySerial(1) },
        'nether',
        at(0.5, 64, 0.5),
      )).toBe(false)
      expect(hasMobMovementCandidates(roster, 'nether', at(0.5, 64, 0.5))).toBe(true)
      let current: MobRoster = roster
      for (let tick = 1; tick <= 4; tick += 1) {
        const planned = planMobMovementRoster(current, at(0.5, 64, 0.5), port, SimulationTick(tick), 'nether')
        expect(Result.isSuccess(planned)).toBe(true)
        if (Result.isFailure(planned)) return
        current = planned.success.roster
      }
      expect(current.entities[0]?.feetPosition.x).toBeLessThan(blaze.feetPosition.x)
    }),
  )

  it.effect('excludes movement candidates and steps assigned to another dimension', () =>
    Effect.gen(function* () {
      const floor = Array.from({ length: 8 }, (_value, x) => [block(x, 63, 0), STONE] as const)
      const port = yield* makeWorldPort(floor)
      const pig = {
        id: EntityId('mob:other-dimension'),
        kind: PIG_KIND,
        feetPosition: at(5.5, 64, 0.5),
        healthPoints: EntityHealthPoints(10),
        behaviour: initialEcosystemMobState(),
        dimension: 'nether' as const,
      }
      const roster: MobRoster = { entities: [pig], nextSerial: EntitySerial(1) }

      expect(hasMobMovementCandidates(roster, 'overworld', at(0.5, 64, 0.5))).toBe(false)

      const planned = planMobMovementRoster(roster, at(0.5, 64, 0.5), port, SimulationTick(1), 'overworld')
      expect(planned).toMatchObject({ _tag: 'Success', success: { faults: [] } })
      if (Result.isFailure(planned)) return
      expect(planned.success.roster.entities[0]).toBe(pig)
    }),
  )

  it.effect('reports a typed step failure for a persisted finite body outside the path grid', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([[block(0, 63, 0), STONE]])
      const id = EntityId('mob:outside-path-grid-body')
      const initial = initialMobMovementState(id, PIG_KIND, at(0.5, 64, 0.5), at(2.5, 64, 0.5))
      if (initial === undefined) throw new Error('the in-range movement goal must decode')
      const movement = Schema.decodeUnknownSync(MobMovementStateSchema)({
        ...initial,
        body: { ...initial.body, x: Number.MAX_SAFE_INTEGER + 1 },
      })
      const roster: MobRoster = {
        entities: [{
          id,
          kind: PIG_KIND,
          feetPosition: at(0.5, 64, 0.5),
          healthPoints: EntityHealthPoints(10),
          behaviour: { ...initialEcosystemMobState(), movement },
          dimension: 'overworld',
        }],
        nextSerial: EntitySerial(1),
      }

      const planned = planMobMovementRoster(roster, at(10.5, 64, 0.5), port, SimulationTick(1), 'overworld')

      expect(planned).toMatchObject({
        _tag: 'Success',
        success: {
          roster,
          faults: [{
            _tag: 'MobMovementRosterFailure',
            reason: 'step-failed',
            entityId: id,
            failure: { _tag: 'MobMovementPhysicsFailure', reason: 'invalid-body' },
          }],
        },
      })
    }),
  )

  it.effect('keeps malformed persisted movement state typed and isolates invalid goals', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([])
      const malformed = repairMobBehaviour(PIG_KIND, {
        _tag: 'EcosystemMob',
        attackCooldownTicks: 0,
        motionPhase: 0,
        provoked: false,
        hasHeadProtection: false,
        burningTicks: 161,
      })
      const malformedId = EntityId('mob:malformed-ecosystem-state')
      const malformedRoster: MobRoster = {
        entities: [{
          id: malformedId,
          kind: PIG_KIND,
          feetPosition: at(0.5, 64, 0.5),
          healthPoints: EntityHealthPoints(10),
          behaviour: malformed,
          dimension: 'overworld',
        }],
        nextSerial: EntitySerial(1),
      }
      const malformedPlan = planMobMovementRoster(
        malformedRoster,
        at(10.5, 64, 0.5),
        port,
        SimulationTick(1),
        'overworld',
      )
      expect(malformedPlan).toMatchObject({
        _tag: 'Success',
        success: {
          faults: [{
            _tag: 'MobMovementRosterFailure',
            reason: 'invalid-state',
            entityId: malformedId,
            repairFailure: { _tag: 'EcosystemMobStateRepairFailure', field: '_tag' },
          }],
        },
      })

      const feet = at(Number.MAX_SAFE_INTEGER - 10, 64, 0)
      const invalidTarget = at(Number.MAX_SAFE_INTEGER + 1, 64, 0)
      expect(mobMovementCell(feet)).toBeDefined()
      expect(mobMovementCell(invalidTarget)).toBeUndefined()
      const movingId = EntityId('mob:invalid-saved-goal')
      const priorMovement = initialMobMovementState(
        movingId,
        ZOMBIE_KIND,
        feet,
        at(Number.MAX_SAFE_INTEGER - 8, 64, 0),
      )
      if (priorMovement === undefined) throw new Error('the in-range movement state must decode')
      const goalRoster: MobRoster = {
        entities: [
          {
            id: EntityId('mob:invalid-initial-goal'),
            kind: ZOMBIE_KIND,
            feetPosition: feet,
            healthPoints: EntityHealthPoints(10),
            behaviour: initialEcosystemMobState(),
            dimension: 'overworld',
          },
          {
            id: movingId,
            kind: ZOMBIE_KIND,
            feetPosition: feet,
            healthPoints: EntityHealthPoints(10),
            behaviour: { ...initialEcosystemMobState(), movement: priorMovement },
            dimension: 'overworld',
          },
        ],
        nextSerial: EntitySerial(2),
      }
      const goalPlan = planMobMovementRoster(
        goalRoster,
        invalidTarget,
        port,
        SimulationTick(1),
        'overworld',
      )
      expect(Result.isSuccess(goalPlan)).toBe(true)
      if (Result.isFailure(goalPlan)) return
      expect(goalPlan.success.roster).toStrictEqual(goalRoster)
      expect(goalPlan.success.faults).toEqual([
        { _tag: 'MobMovementRosterFailure', reason: 'invalid-state', entityId: EntityId('mob:invalid-initial-goal') },
        { _tag: 'MobMovementRosterFailure', reason: 'invalid-goal', entityId: movingId },
      ])
    }),
  )

  it.effect('defers remaining mobs when one tick reaches its bounded search budget', () =>
    Effect.gen(function* () {
      const floor = Array.from({ length: 16 }, (_unused, x) => [block(x, 63, 0), STONE] as const)
      const port = yield* makeWorldPort(floor)
      const entities = Array.from({ length: 9 }, (_unused, index) => ({
        id: EntityId(`mob:search-budget-${index}`),
        kind: PIG_KIND,
        feetPosition: at(index + 1.5, 64, 0.5),
        healthPoints: EntityHealthPoints(10),
        behaviour: { ...initialEcosystemMobState(), movementGoal: at(12.5, 64, 0.5) },
        dimension: 'overworld' as const,
      }))
      const roster: MobRoster = { entities, nextSerial: EntitySerial(entities.length) }

      const planned = planMobMovementRoster(roster, undefined, port, SimulationTick(1), 'overworld')

      expect(Result.isSuccess(planned)).toBe(true)
      if (Result.isFailure(planned)) return
      expect(planned.success.faults).toStrictEqual([])
      expect(planned.success.roster.entities[0]?.feetPosition).toStrictEqual(entities[0]?.feetPosition)
    }),
  )

  it.effect('holds a mob when a real path search exhausts its node budget', () =>
    Effect.gen(function* () {
      const floor = Array.from({ length: 32 * 32 }, (_unused, index) => [
        block(index % 32, 63, Math.floor(index / 32)),
        STONE,
      ] as const)
      const wall = Array.from({ length: 32 }, (_unused, z) => [
        block(16, 64, z),
        STONE,
      ] as const)
      const ceiling = Array.from({ length: 32 }, (_unused, z) => [
        block(16, 65, z),
        STONE,
      ] as const)
      const port = yield* makeWorldPort(
        [...floor, ...wall, ...ceiling],
        ['0,0', '1,0', '0,1', '1,1'],
      )
      const pig = {
        id: EntityId('mob:node-budget'),
        kind: PIG_KIND,
        feetPosition: at(1.5, 64, 15.5),
        healthPoints: EntityHealthPoints(10),
        behaviour: { ...initialEcosystemMobState(), movementGoal: at(30.5, 64, 15.5) },
        dimension: 'overworld' as const,
      }
      const roster: MobRoster = { entities: [pig], nextSerial: EntitySerial(1) }

      const planned = planMobMovementRoster(roster, undefined, port, SimulationTick(1), 'overworld')

      expect(Result.isSuccess(planned)).toBe(true)
      if (Result.isFailure(planned)) return
      expect(planned.success.faults).toStrictEqual([])
      expect(planned.success.roster.entities[0]?.feetPosition).toStrictEqual(pig.feetPosition)
    }),
  )

  it.effect('returns the typed failure when a mob body overlaps an invalid world cell', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([])
      const movement = initialMobMovementState(
        EntityId('mob:invalid-overlap-cell'),
        PIG_KIND,
        at(0.5, 64, 0.5),
        at(2.5, 64, 0.5),
      )
      if (movement === undefined) throw new Error('the in-range movement state must decode')
      const outside = Schema.decodeUnknownSync(MobMovementStateSchema)({
        ...movement,
        body: { ...movement.body, x: 2 ** 53 + 2 },
      })
      const invalidXCell = BlockAxis.result(Math.floor(outside.body.x - outside.profile.width / 2))

      const overlap = port.bodyOverlapsUnloadedCell(outside)

      expect(Number.isSafeInteger(outside.body.x)).toBe(false)
      expect(Result.isFailure(invalidXCell)).toBe(true)
      expect(overlap).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'EntityWorldInvalidCell' },
      })
    }),
  )

  it.effect('propagates typed overlap-query failures from the movement roster', () =>
    Effect.gen(function* () {
      const floor = Array.from({ length: 32 }, (_value, x) => [block(x, 63, 0), STONE] as const)
      const port = yield* makeWorldPort(floor, ['0,0', '1,0'])
      const failure = {
        _tag: 'EntityWorldCorruptBuffer' as const,
        cell: { x: BlockAxis(6), y: BlockAxis(64), z: BlockAxis(0) },
        index: BlockStateIndex(1_024),
        length: BlockStateLength(1),
      }
      const failingWorld = {
        ...port,
        bodyOverlapsUnloadedCell: () => Result.fail(failure),
      }
      const pig = {
        id: EntityId('mob:overlap-query-failure'),
        kind: PIG_KIND,
        feetPosition: at(5.5, 64, 0.5),
        healthPoints: EntityHealthPoints(10),
        behaviour: initialEcosystemMobState(),
        dimension: 'overworld' as const,
      }
      const planned = planMobMovementRoster(
        { entities: [pig], nextSerial: EntitySerial(1) },
        at(0.5, 64, 0.5),
        failingWorld,
        SimulationTick(1),
        'overworld',
      )

      expect(planned).toMatchObject({
        _tag: 'Success',
        success: {
          roster: { entities: [pig] },
          faults: [{
            _tag: 'MobMovementRosterFailure',
            reason: 'world-query-failed',
            entityId: pig.id,
            worldFailure: failure,
          }],
        },
      })
    }),
  )

  it.effect('records a simulator rejection against the affected mob when the movement world is malformed', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([[block(0, 63, 0), STONE]])
      const malformedWorld = new Proxy(port, {
        get(target, property, receiver) {
          if (property === 'isPassable') return undefined
          return Reflect.get(target, property, receiver)
        },
      })
      const roster: MobRoster = {
        entities: [{
          id: EntityId('mob:rejected-world'),
          kind: PIG_KIND,
          feetPosition: at(0.5, 64, 0.5),
          healthPoints: EntityHealthPoints(10),
          behaviour: initialEcosystemMobState(),
          dimension: 'overworld',
        }],
        nextSerial: EntitySerial(1),
      }

      const planned = planMobMovementRoster(roster, at(10.5, 64, 0.5), malformedWorld, SimulationTick(1), 'overworld')

      expect(planned).toMatchObject({
        _tag: 'Success',
        success: {
          roster,
          faults: [{
            _tag: 'MobMovementRosterFailure',
            reason: 'simulation-rejected',
            entityId: roster.entities[0]?.id,
            failure: expect.objectContaining({ _tag: expect.any(String) }),
          }],
        },
      })
    }),
  )

  it('does not create movement work for unruled kinds or mismatched behavior tags', () => {
    const roster = {
      entities: [
        {
          id: EntityId('mob:enderman'),
          kind: ENDERMAN_KIND,
          feetPosition: at(0.5, 64, 0.5),
          healthPoints: EntityHealthPoints(40),
          behaviour: STEADY_ENDERMAN,
          dimension: 'overworld' as const,
        },
        {
          id: EntityId('mob:pig-mismatch'),
          kind: PIG_KIND,
          feetPosition: at(1.5, 64, 0.5),
          healthPoints: EntityHealthPoints(10),
          behaviour: STEADY_ENDERMAN,
          dimension: 'overworld' as const,
        },
      ],
      nextSerial: EntitySerial(2),
    }

    expect(hasMobMovementCandidates(roster, 'overworld')).toBe(false)
  })

  it.effect('finds a spider climb path up a full-height wall', () =>
    Effect.gen(function* () {
      // Vanilla oracle: Java Edition 26.3 spiders climb vertical walls when their path is blocked.
      // https://minecraft.wiki/w/Spider#Behavior
      const floor = Array.from({ length: 32 }, (_z, zIndex) =>
        Array.from({ length: 9 }, (_x, xIndex) => [
          block(-2 + xIndex, 63, -16 + zIndex),
          STONE,
        ] as const),
      ).flat()
      const wall = Array.from({ length: 6 }, (_y, yIndex) =>
        Array.from({ length: 32 }, (_z, zIndex) => [
          block(2, 64 + yIndex, -16 + zIndex),
          STONE,
        ] as const),
      ).flat()
      const port = yield* makeWorldPort([...floor, ...wall], ['-1,-1', '-1,0', '0,-1', '0,0'])
      const profile = Schema.decodeUnknownSync(MobPathProfileSchema)({
        kind: 'spider', width: 1.4, height: 0.9,
      })
      expect([-1, 0, 1].map((x) => port.isPassable(mobMovementCell(at(x + 0.5, 64, 0.5))!))).toEqual([true, true, true])
      expect(port.isPassable(mobMovementCell(at(2.5, 65, 0.5))!)).toBe(false)
      expect(port.hasSupport(mobMovementCell(at(2.5, 65, 0.5))!)).toBe(true)
      const result = planMobPathsForTick({
        requests: [{
          start: mobMovementCell(at(0.5, 64, 0.5))!,
          goal: mobMovementCell(at(0.5, 70, 0.5))!,
          profile,
        }],
        world: port,
      })

      expect(result._tag).toBe('MobPathsPlanned')
      if (result._tag === 'MobPathsPlanned') {
        const outcome = result.outcomes[0]
        expect(outcome?._tag, JSON.stringify(outcome)).toBe('PathFound')
        if (outcome?._tag === 'PathFound') {
          expect(outcome.path.some(({ action }) => action === 'climb')).toBe(true)
        }
      }
    }),
  )
})
