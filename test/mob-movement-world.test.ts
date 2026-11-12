import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Result, Schema } from 'effect'
import { BlockAxis, BlockId, blockIdOf, blockPosition, ChunkAxis, chunkCoord, EntityHealthPoints, EntitySerial, SimulationTick, type BlockType, position, PositionAxis } from '@nerima-games/mc-kernel'
import { EntityId, EntityKind, MobMovementStateSchema, MobPathProfileSchema, planMobPathsForTick } from '@nerima-games/mc-sim'
import { openChunkWindow } from '../src/domain/chunk-window'
import {
  initialMobMovementState,
  mobMovementCell,
  mobMovementWorldFromChunkWindow,
  movementFeetPosition,
  movementStateForGoal,
} from '../src/domain/entities/mob-movement-world'
import { ENDERMAN_KIND, PIG_KIND, SPIDER_KIND, initialEcosystemMobState } from '../src/domain/mob/mob-ecosystem'
import { STEADY_ENDERMAN, hasMobMovementCandidates, planMobMovementRoster, type MobRoster } from '../src/domain/entities/mob-frame'
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

  it.effect('treats cells outside the resident window as blocked for paths and physics', () =>
    Effect.gen(function* () {
      const port = yield* makeWorldPort([], [])
      const cell = mobMovementCell(at(0, 64, 0))!
      const blockSample = port.physics.environment.blockAt(BlockAxis(0), BlockAxis(64), BlockAxis(0))

      expect(port.isPassable(cell)).toBe(false)
      expect(port.hasSupport(cell)).toBe(false)
      expect(port.hazardAt(cell)).toBeNull()
      expect(blockSample._tag).toBe('Success')
      if (blockSample._tag === 'Success') {
        expect(blockSample.success).not.toBeNull()
        if (blockSample.success !== null) expect(blockSample.success.properties.collisionShape).toBe('full')
      }
      expect(port.physics.blockShapeAt?.(BlockAxis(0), BlockAxis(64), BlockAxis(0))).toMatchObject({
        minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1,
      })
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

  it.effect('treats unresolved block ids as blocking and keeps physics on the solid fallback', () =>
    Effect.gen(function* () {
      const unresolvedBlockId = BlockId(65535)
      const port = yield* makeWorldPort([[block(0, 64, 0), unresolvedBlockId]])
      const cell = mobMovementCell(at(0.5, 64, 0.5))!

      expect(port.isPassable(cell)).toBe(false)
      expect(port.hasSupport(cell)).toBe(false)
      expect(port.hazardAt(cell)).toBeNull()
      expect(port.physics.blockPropertiesAt(BlockAxis(0), BlockAxis(64), BlockAxis(0))._tag).toBe('Success')
      expect(port.physics.blockShapeAt?.(BlockAxis(0), BlockAxis(64), BlockAxis(0))).toMatchObject({
        minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1,
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

      expect(Result.isFailure(planned)).toBe(true)
      if (Result.isSuccess(planned)) return
      expect(planned.failure).toMatchObject({
        _tag: 'MobMovementRosterFailure',
        reason: 'step-failed',
        entityId: id,
      })
    }),
  )

  it.effect('returns the simulator rejection when a supplied movement world is malformed', () =>
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

      expect(Result.isFailure(planned)).toBe(true)
      if (Result.isSuccess(planned)) return
      expect(planned.failure).toMatchObject({
        _tag: 'MobMovementRosterFailure',
        reason: 'simulation-rejected',
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
