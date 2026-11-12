import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Option, Result } from 'effect'
import {
  BlockAxis,
  BlockId,
  adjacentBlockPosition,
  blockIdOf,
  blockPosition,
  DeltaTimeSecs,
  defaultBlockState,
  type BlockFace,
  type BlockPosition,
  type BlockStateValues,
  type BlockType,
} from '@nerima-games/mc-kernel'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import {
  applyBlockStateRule,
  blockStateWorldPortForChunkStore,
  cropAgeAfterBoneMeal,
  cropAgeAfterRandomTick,
  cropGrowthProbability,
  doorOpenAfterToggle,
  doorPlacementState,
  netherWartAgeAfterRandomTick,
  saplingStageAfterBoneMeal,
  saplingStageAfterGrowthAttempt,
  stairPlacementState,
  type BlockStateEdit,
  type BlockStateCell,
  type BlockStateRead,
  type BlockStateRuleRequest,
  type BlockStateWorldPort,
  type BlockStateWrite,
  type HorizontalBlockStateFacing,
} from '../src/domain/interactions/block-state-rules.js'
import { makeBlockStateRulesStage } from '../src/stages/block-state-rules-stage.js'
import { FrameServicesLayer } from './support/frame-services.js'
import {
  drainBlockStateRuleResults,
  makeGameplayFrameState,
  requestBlockStateRule,
} from '../src/stages/registration.js'
import { blockPosition as fixtureBlockPosition } from './support/coordinate-fixtures.js'

const position = fixtureBlockPosition(3, 64, -2)
const keyOf = (cell: BlockPosition): string => `${cell.x},${cell.y},${cell.z}`
const blockId = (type: BlockType) => Option.getOrThrow(blockIdOf(type))
const stateOf = (type: BlockType): BlockStateValues =>
  Result.getOrThrow(defaultBlockState(blockId(type)))

const memoryWorld = (initial: ReadonlyArray<readonly [BlockPosition, BlockStateCell]>): {
  port: BlockStateWorldPort
  cells: Map<string, BlockStateCell>
  writes: Array<ReadonlyArray<BlockStateEdit>>
} => {
  const cells = new Map(initial.map(([at, cell]) => [keyOf(at), cell]))
  const writes: Array<ReadonlyArray<BlockStateEdit>> = []
  const port: BlockStateWorldPort = {
    read: (at) => Effect.sync(() => ({
      _tag: 'Found',
      cell: cells.get(keyOf(at)) ?? { block: blockId('air'), state: {} },
    })),
    write: (edits) => Effect.sync(() => {
      writes.push(edits)
      for (const edit of edits) cells.set(keyOf(edit.position), { block: edit.block, state: edit.state })
      return { _tag: 'Written' }
    }),
  }
  return { port, cells, writes }
}

const scriptedWorld = (
  readings: ReadonlyArray<BlockStateRead>,
  writeResult: BlockStateWrite = { _tag: 'Written' },
): Readonly<{
  port: BlockStateWorldPort
  reads: () => number
  writes: Array<ReadonlyArray<BlockStateEdit>>
}> => {
  let readIndex = 0
  const writes: Array<ReadonlyArray<BlockStateEdit>> = []
  const port: BlockStateWorldPort = {
    read: () => Effect.sync(() => readings[readIndex++] ?? { _tag: 'Unavailable', reason: 'ChunkNotLoaded' }),
    write: (edits) => Effect.sync(() => {
      writes.push(edits)
      return writeResult
    }),
  }
  return { port, reads: () => readIndex, writes }
}

const above = (at: BlockPosition): BlockPosition => blockPosition(
  BlockAxis(at.x),
  BlockAxis(at.y + 1),
  BlockAxis(at.z),
)

const doorCell = (
  half: 'lower' | 'upper',
  block: 'door' | 'door_open' = 'door',
  state: BlockStateValues = { facing: 'north', hinge: 'left', half, open: false },
): BlockStateCell => ({ block: blockId(block), state })

const applyRuleAt = (
  port: BlockStateWorldPort,
  operation: BlockStateRuleRequest['operation'],
  at: BlockPosition = position,
) => applyBlockStateRule(port, { requestId: 'test-rule', position: at, operation })

const runRuleAtRegisteredStage = (
  port: BlockStateWorldPort,
  operation: BlockStateRuleRequest['operation'],
  at: BlockPosition = position,
  requestId = 'registered-state-rule',
) => Effect.gen(function* () {
  const state = yield* makeGameplayFrameState
  const stage = makeBlockStateRulesStage(state, {} as ChunkStoreApi, port)
  yield* requestBlockStateRule(state, { requestId, position: at, operation })
  yield* stage.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
  return yield* drainBlockStateRuleResults(state)
})

const offset = (at: BlockPosition, x: number, y = 0, z = 0): BlockPosition => blockPosition(
  BlockAxis(at.x + x),
  BlockAxis(at.y + y),
  BlockAxis(at.z + z),
)

const step = (at: BlockPosition, facing: HorizontalBlockStateFacing): BlockPosition =>
  Result.getOrThrow(adjacentBlockPosition(at, facing))

const stairCell = (
  facing: HorizontalBlockStateFacing,
  half: 'top' | 'bottom',
  shape: BlockStateValues['shape'] = 'straight',
  block: 'oak_stairs' | 'purpur_stairs' = 'oak_stairs',
  extra: Partial<BlockStateValues> = {},
): BlockStateCell => ({
  block: blockId(block),
  state: { ...stateOf(block), ...extra, facing, half, shape },
})

describe('block state rules', () => {
  it.effect('crop random tick probability follows the wiki speed-level expression', () =>
    Effect.sync(() => {
      FastCheck.assert(FastCheck.property(
        FastCheck.integer({ min: 10, max: 100 }).map((tenths) => tenths / 10),
        FastCheck.integer({ min: 0, max: 999 }).map((thousandths) => thousandths / 1000),
        (speedLevel, roll) => {
          const expectedProbability = 1 / (Math.floor(25 / speedLevel) + 1)
          const transition = cropAgeAfterRandomTick(2, 7, speedLevel, roll)
          expect(cropGrowthProbability(speedLevel)).toBe(expectedProbability)
          expect(transition).toStrictEqual(roll < expectedProbability
            ? { _tag: 'Grew', age: 3 }
            : { _tag: 'NoChange', reason: 'growthMiss' })
        },
      ))
    }),
  )

  it.effect('crop growth stays within age bounds and rejects invalid rolls and speeds', () =>
    Effect.sync(() => {
      expect(cropAgeAfterRandomTick(7, 7, 10, 0)).toStrictEqual({ _tag: 'NoChange', reason: 'mature' })
      expect(cropAgeAfterRandomTick(0, 7, 0.99, 0)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterRandomTick(0, 7, 10.01, 0)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterRandomTick(0, 7, 10, 1)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterRandomTick(-1, 7, 10, 0)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterRandomTick(8, 7, 10, 0)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterRandomTick(0, 26, 10, 0)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterRandomTick(0, 7, 10, 0)).toStrictEqual({ _tag: 'Grew', age: 1 })
      expect(cropAgeAfterRandomTick(0, 7, 1, 1 / (Math.floor(25 / 1) + 1)))
        .toStrictEqual({ _tag: 'NoChange', reason: 'growthMiss' })
    }),
  )

  it.effect('nether wart grows on a fixed 10% random-tick chance independent of crop speed', () =>
    Effect.gen(function* () {
      const expectedChance = 10 / 100
      FastCheck.assert(FastCheck.property(
        FastCheck.integer({ min: 0, max: 2 }),
        FastCheck.integer({ min: 0, max: 9999 }).map((value) => value / 10000),
        (age, roll) => {
          expect(netherWartAgeAfterRandomTick(age, roll)).toStrictEqual(roll < expectedChance
            ? { _tag: 'Grew', age: age + 1 }
            : { _tag: 'NoChange', reason: 'growthMiss' })
        },
      ))
      expect(netherWartAgeAfterRandomTick(0, 0.099)).toStrictEqual({ _tag: 'Grew', age: 1 })
      expect(netherWartAgeAfterRandomTick(0, 0.1)).toStrictEqual({ _tag: 'NoChange', reason: 'growthMiss' })
      expect(netherWartAgeAfterRandomTick(3, 0)).toStrictEqual({ _tag: 'NoChange', reason: 'mature' })
      expect(netherWartAgeAfterRandomTick(4, 0)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(netherWartAgeAfterRandomTick(0, -0.01)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(netherWartAgeAfterRandomTick(0, 1)).toStrictEqual({ _tag: 'InvalidInput' })

      const netherWartWorld = memoryWorld([[position, {
        block: blockId('nether_wart_crop'),
        state: { age: 0 },
      }]])
      expect(yield* applyBlockStateRule(netherWartWorld.port, {
        requestId: 'nether-wart-random-tick',
        position,
        operation: { _tag: 'CropRandomTick', roll: 0.05 },
      })).toMatchObject({ _tag: 'Applied' })
      expect(netherWartWorld.cells.get(keyOf(position))?.state.age).toBe(1)

      const slowSpeedWorld = memoryWorld([[position, {
        block: blockId('nether_wart_crop'),
        state: { age: 0 },
      }]])
      expect(yield* applyBlockStateRule(slowSpeedWorld.port, {
        requestId: 'nether-wart-random-tick-with-slow-speed',
        position,
        operation: { _tag: 'CropRandomTick', speedLevel: 0, roll: 0.05 },
      })).toMatchObject({ _tag: 'Applied' })
      expect(slowSpeedWorld.cells.get(keyOf(position))?.state.age).toBe(1)

      const fastSpeedWorld = memoryWorld([[position, {
        block: blockId('nether_wart_crop'),
        state: { age: 0 },
      }]])
      expect(yield* applyBlockStateRule(fastSpeedWorld.port, {
        requestId: 'nether-wart-random-tick-with-fast-speed',
        position,
        operation: { _tag: 'CropRandomTick', speedLevel: 10, roll: 0.2 },
      })).toMatchObject({ _tag: 'NoChange', reason: 'growthMiss' })
      expect(fastSpeedWorld.cells.get(keyOf(position))?.state.age).toBe(0)
    }),
  )

  it.effect('crop random ticks distinguish unavailable reads, non-crops, and invalid cell data', () =>
    Effect.gen(function* () {
      const unavailable = scriptedWorld([{ _tag: 'Unavailable', reason: 'ChunkNotLoaded' }])
      expect(yield* applyRuleAt(unavailable.port, {
        _tag: 'CropRandomTick', speedLevel: 10, roll: 0,
      })).toStrictEqual({ _tag: 'Unavailable', position, reason: 'ChunkNotLoaded' })

      const unknownBlock = memoryWorld([[position, { block: BlockId(65_535), state: {} }]])
      expect(yield* applyRuleAt(unknownBlock.port, {
        _tag: 'CropRandomTick', speedLevel: 10, roll: 0,
      })).toStrictEqual({ _tag: 'NotApplicable', block: undefined })

      const stone = memoryWorld([[position, { block: blockId('stone'), state: {} }]])
      expect(yield* applyRuleAt(stone.port, {
        _tag: 'CropRandomTick', speedLevel: 10, roll: 0,
      })).toStrictEqual({ _tag: 'NotApplicable', block: 'stone' })

      const missingAge = memoryWorld([[position, { block: blockId('wheat_crop'), state: {} }]])
      expect(yield* applyRuleAt(missingAge.port, {
        _tag: 'CropRandomTick', speedLevel: 10, roll: 0,
      })).toStrictEqual({ _tag: 'InvalidState', position })

      const missingSpeed = memoryWorld([[position, { block: blockId('wheat_crop'), state: { age: 0 } }]])
      expect(yield* applyRuleAt(missingSpeed.port, { _tag: 'CropRandomTick', roll: 0 })).toStrictEqual({
        _tag: 'InvalidInput', reason: 'cropSpeedLevel',
      })

      const invalidSpeed = memoryWorld([[position, { block: blockId('wheat_crop'), state: { age: 0 } }]])
      expect(yield* applyRuleAt(invalidSpeed.port, {
        _tag: 'CropRandomTick', speedLevel: 0, roll: 0,
      })).toStrictEqual({ _tag: 'InvalidInput', reason: 'cropSpeedLevel' })

      for (const roll of [Number.NaN, -0.01, 1]) {
        const invalidRoll = memoryWorld([[position, { block: blockId('wheat_crop'), state: { age: 0 } }]])
        expect(yield* applyRuleAt(invalidRoll.port, {
          _tag: 'CropRandomTick', speedLevel: 10, roll,
        })).toStrictEqual({ _tag: 'InvalidInput', reason: 'randomRoll' })
      }

      const invalidAge = memoryWorld([[position, { block: blockId('wheat_crop'), state: { age: 8 } }]])
      expect(yield* applyRuleAt(invalidAge.port, {
        _tag: 'CropRandomTick', speedLevel: 10, roll: 0,
      })).toStrictEqual({ _tag: 'InvalidInput', reason: 'cropAge' })
    }),
  )

  it.effect('bone meal advances crop age by 2–5 stages and clamps at maturity', () =>
    Effect.sync(() => {
      FastCheck.assert(FastCheck.property(
        FastCheck.integer({ min: 0, max: 7 }),
        FastCheck.integer({ min: 2, max: 5 }),
        (age, stages) => {
          const transition = cropAgeAfterBoneMeal(age, 7, stages)
          expect(transition).toStrictEqual(age === 7
            ? { _tag: 'NoChange', reason: 'mature' }
            : { _tag: 'Grew', age: Math.min(7, age + stages) })
        },
      ))
      expect(cropAgeAfterBoneMeal(0, 7, 1)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterBoneMeal(0, 7, 6)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterBoneMeal(-1, 7, 2)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterBoneMeal(8, 7, 2)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(cropAgeAfterBoneMeal(2, 3, 5)).toStrictEqual({ _tag: 'Grew', age: 3 })
    }),
  )

  it.effect('door toggle inverts open state and preserves the two-half state', () =>
    Effect.gen(function* () {
      FastCheck.assert(FastCheck.property(FastCheck.boolean(), (open) => {
        expect(doorOpenAfterToggle(open)).toBe(!open)
      }))
      const bottom = doorPlacementState('east', 'right', 'lower')
      const top = doorPlacementState('east', 'right', 'upper')
      const world = memoryWorld([
        [position, { block: blockId('door'), state: bottom }],
        [above(position), { block: blockId('door'), state: top }],
      ])
      const request = { requestId: 'door-toggle', position, operation: { _tag: 'ToggleDoor' } } as const
      expect(yield* applyBlockStateRule(world.port, request)).toMatchObject({ _tag: 'Applied' })
      expect(world.cells.get(keyOf(position))?.state.open).toBe(true)
      expect(world.cells.get(keyOf(above(position)))?.state).toMatchObject({ half: 'upper', open: true })
      expect(yield* applyBlockStateRule(world.port, request)).toMatchObject({ _tag: 'Applied' })
      expect(world.cells.get(keyOf(position))?.state.open).toBe(false)
      expect(world.cells.get(keyOf(above(position)))?.state.open).toBe(false)

      const malformedPair = memoryWorld([
        [position, { block: blockId('door'), state: bottom }],
        [above(position), { block: blockId('door'), state: { facing: 'east', hinge: 'right' } }],
      ])
      expect(yield* applyBlockStateRule(malformedPair.port, request)).toStrictEqual({
        _tag: 'InvalidState', position: above(position),
      })
    }),
  )

  it.effect('door toggle rejects non-doors, unavailable halves, and malformed paired states', () =>
    Effect.gen(function* () {
      const upperPosition = above(position)
      const toggleAt = (port: BlockStateWorldPort, at = position) => applyBlockStateRule(port, {
        requestId: 'toggle-door-validation', position: at, operation: { _tag: 'ToggleDoor' },
      })
      const stone = blockId('stone')

      const nonDoor = memoryWorld([[position, { block: stone, state: {} }]])
      expect(yield* toggleAt(nonDoor.port)).toStrictEqual({ _tag: 'NotApplicable', block: 'stone' })

      const invalidHalf = memoryWorld([[position, doorCell('lower', 'door', {
        facing: 'north', hinge: 'left', half: 'top',
      })]])
      expect(yield* toggleAt(invalidHalf.port)).toStrictEqual({ _tag: 'InvalidState', position })

      const upperBoundary = fixtureBlockPosition(3, Number.MAX_SAFE_INTEGER, -2)
      const boundaryDoor = memoryWorld([[upperBoundary, doorCell('lower')]])
      expect(yield* toggleAt(boundaryDoor.port, upperBoundary)).toStrictEqual({
        _tag: 'InvalidState', position: upperBoundary,
      })

      const unavailableSecondRead = scriptedWorld([
        { _tag: 'Found', cell: doorCell('lower') },
        { _tag: 'Unavailable', reason: 'ChunkNotLoaded' },
      ])
      expect(yield* toggleAt(unavailableSecondRead.port)).toStrictEqual({
        _tag: 'Unavailable', position: upperPosition, reason: 'ChunkNotLoaded',
      })

      const wrongBlock = memoryWorld([
        [position, doorCell('lower')],
        [upperPosition, { block: stone, state: {} }],
      ])
      expect(yield* toggleAt(wrongBlock.port)).toStrictEqual({ _tag: 'InvalidState', position: upperPosition })

      const wrongHalf = memoryWorld([
        [position, doorCell('lower')],
        [upperPosition, doorCell('lower')],
      ])
      expect(yield* toggleAt(wrongHalf.port)).toStrictEqual({ _tag: 'InvalidState', position: upperPosition })

      const invalidLowerStates: ReadonlyArray<BlockStateValues> = [
        { half: 'lower', hinge: 'left' },
        { half: 'lower', facing: 'north' },
        { half: 'lower', facing: 'up', hinge: 'left' },
        { half: 'lower', facing: 'down', hinge: 'left' },
      ]
      for (const state of invalidLowerStates) {
        const paired = memoryWorld([
          [position, { block: blockId('door'), state }],
          [upperPosition, { block: blockId('door'), state: { ...state, half: 'upper' } }],
        ])
        expect(yield* toggleAt(paired.port)).toStrictEqual({ _tag: 'InvalidState', position })
      }

      const wrongFacing = memoryWorld([
        [position, doorCell('lower')],
        [upperPosition, doorCell('upper', 'door', { facing: 'south', hinge: 'left', half: 'upper' })],
      ])
      expect(yield* toggleAt(wrongFacing.port)).toStrictEqual({ _tag: 'InvalidState', position: upperPosition })

      const wrongHinge = memoryWorld([
        [position, doorCell('lower')],
        [upperPosition, doorCell('upper', 'door', { facing: 'north', hinge: 'right', half: 'upper' })],
      ])
      expect(yield* toggleAt(wrongHinge.port)).toStrictEqual({ _tag: 'InvalidState', position: upperPosition })

      const openedDoor = memoryWorld([
        [position, doorCell('lower', 'door_open', { facing: 'east', hinge: 'right', half: 'lower', open: false })],
        [upperPosition, doorCell('upper', 'door_open', { facing: 'east', hinge: 'right', half: 'upper', open: false })],
      ])
      expect(yield* toggleAt(openedDoor.port, upperPosition)).toMatchObject({ _tag: 'Applied' })
      expect(openedDoor.cells.get(keyOf(position))?.state.open).toBe(false)
      expect(openedDoor.cells.get(keyOf(upperPosition))?.state.open).toBe(false)
      expect(openedDoor.cells.get(keyOf(position))?.block).toBe(blockId('door'))
      expect(openedDoor.cells.get(keyOf(upperPosition))?.block).toBe(blockId('door'))
    }),
  )

  it.effect('door placement writes both halves with the requested facing and hinge', () =>
    Effect.gen(function* () {
      const facings: ReadonlyArray<HorizontalBlockStateFacing> = ['north', 'east', 'south', 'west']
      const hinges = ['left', 'right'] as const
      const halves = ['lower', 'upper'] as const
      FastCheck.assert(FastCheck.property(
        FastCheck.constantFrom(...facings),
        FastCheck.constantFrom(...hinges),
        FastCheck.constantFrom(...halves),
        (facing, hinge, half) => {
          expect(doorPlacementState(facing, hinge, half)).toStrictEqual({
            facing, hinge, half, open: false, powered: false,
          })
        },
      ))
      const world = memoryWorld([])
      const outcome = yield* applyBlockStateRule(world.port, {
        requestId: 'door-place',
        position,
        operation: { _tag: 'PlaceDoor', facing: 'south', hinge: 'left' },
      })
      expect(outcome).toMatchObject({ _tag: 'Applied' })
      expect(world.cells.get(keyOf(position))?.state).toMatchObject({
        facing: 'south', hinge: 'left', half: 'lower', open: false,
      })
      expect(world.cells.get(keyOf(above(position)))?.state).toMatchObject({
        facing: 'south', hinge: 'left', half: 'upper', open: false,
      })
    }),
  )

  it.effect('door placement rejects overflow, occupied cells, failed reads, and unsupported writes', () =>
    Effect.gen(function* () {
      const upperPosition = above(position)
      const placeAt = (port: BlockStateWorldPort, at = position) => applyBlockStateRule(port, {
        requestId: 'place-door-validation',
        position: at,
        operation: { _tag: 'PlaceDoor', facing: 'east', hinge: 'right' },
      })
      const air = { block: blockId('air'), state: stateOf('air') }
      const stone = { block: blockId('stone'), state: stateOf('stone') }

      const upperBoundary = fixtureBlockPosition(3, Number.MAX_SAFE_INTEGER, -2)
      expect(yield* placeAt(memoryWorld([]).port, upperBoundary)).toStrictEqual({
        _tag: 'InvalidState', position: upperBoundary,
      })

      const unavailableLower = scriptedWorld([{ _tag: 'Unavailable', reason: 'OutOfWorld' }])
      expect(yield* placeAt(unavailableLower.port)).toStrictEqual({
        _tag: 'Unavailable', position, reason: 'OutOfWorld',
      })

      const unsupportedUpperRead = scriptedWorld([
        { _tag: 'Found', cell: air },
        { _tag: 'Unsupported', operation: 'readState' },
      ])
      expect(yield* placeAt(unsupportedUpperRead.port)).toStrictEqual({
        _tag: 'Unsupported', operation: 'readState', position: upperPosition,
      })

      const occupiedLower = memoryWorld([[position, stone], [upperPosition, air]])
      expect(yield* placeAt(occupiedLower.port)).toStrictEqual({ _tag: 'InvalidState', position })

      const occupiedUpper = memoryWorld([[position, air], [upperPosition, stone]])
      expect(yield* placeAt(occupiedUpper.port)).toStrictEqual({ _tag: 'InvalidState', position })

      const unsupportedWrite = scriptedWorld([
        { _tag: 'Found', cell: air },
        { _tag: 'Found', cell: air },
      ], { _tag: 'Unsupported', operation: 'writeState' })
      expect(yield* placeAt(unsupportedWrite.port)).toStrictEqual({
        _tag: 'Unsupported', operation: 'writeState', position,
      })
    }),
  )

  it.effect('stair halves follow the clicked face and fixed side-height cases', () =>
    Effect.sync(() => {
      const facings: ReadonlyArray<HorizontalBlockStateFacing> = ['north', 'east', 'south', 'west']
      const placements: ReadonlyArray<Readonly<{
        hitFace: BlockFace
        hitY: number
        half: 'top' | 'bottom'
      }>> = [
        { hitFace: 'up', hitY: 0, half: 'bottom' },
        { hitFace: 'up', hitY: 1, half: 'bottom' },
        { hitFace: 'down', hitY: 0, half: 'top' },
        { hitFace: 'down', hitY: 1, half: 'top' },
        { hitFace: 'north', hitY: 0.49, half: 'bottom' },
        { hitFace: 'north', hitY: 0.5, half: 'bottom' },
        { hitFace: 'north', hitY: 0.51, half: 'top' },
        { hitFace: 'south', hitY: 0.49, half: 'bottom' },
        { hitFace: 'south', hitY: 0.5, half: 'bottom' },
        { hitFace: 'south', hitY: 0.51, half: 'top' },
        { hitFace: 'east', hitY: 0.49, half: 'bottom' },
        { hitFace: 'east', hitY: 0.5, half: 'bottom' },
        { hitFace: 'east', hitY: 0.51, half: 'top' },
        { hitFace: 'west', hitY: 0.49, half: 'bottom' },
        { hitFace: 'west', hitY: 0.5, half: 'bottom' },
        { hitFace: 'west', hitY: 0.51, half: 'top' },
      ]
      for (const facing of facings) {
        for (const { hitFace, hitY, half } of placements) {
          expect(stairPlacementState(facing, hitFace, hitY)).toStrictEqual({
            facing,
            half,
          })
        }
      }
      expect(stairPlacementState('west', 'east', Number.NaN)).toBeUndefined()
      expect(stairPlacementState('west', 'east', -0.01)).toBeUndefined()
      expect(stairPlacementState('west', 'east', 1.01)).toBeUndefined()
      expect(stairPlacementState('west', 'east', Number.POSITIVE_INFINITY)).toBeUndefined()
    }),
  )

  it.effect('the registered stage derives all four stair values from vanilla corner rules', () =>
    Effect.gen(function* () {
      const north = offset(position, 0, 0, -1)
      const south = offset(position, 0, 0, 1)
      const cases: ReadonlyArray<Readonly<{
        name: string
        neighbors: ReadonlyArray<readonly [BlockPosition, BlockStateCell]>
        expectedShape: 'straight' | 'outer_left' | 'outer_right' | 'inner_left' | 'inner_right'
      }>> = [
        { name: 'front left', neighbors: [[north, stairCell('west', 'bottom')]], expectedShape: 'outer_left' },
        { name: 'front right', neighbors: [[north, stairCell('east', 'bottom')]], expectedShape: 'outer_right' },
        { name: 'back left', neighbors: [[south, stairCell('west', 'bottom')]], expectedShape: 'inner_left' },
        { name: 'back right', neighbors: [[south, stairCell('east', 'bottom')]], expectedShape: 'inner_right' },
        {
          name: 'front outer shape precedes a back inner shape',
          neighbors: [
            [north, stairCell('west', 'bottom')],
            [south, stairCell('east', 'bottom')],
          ],
          expectedShape: 'outer_left',
        },
        { name: 'opposite half does not make a corner', neighbors: [[north, stairCell('west', 'top')]], expectedShape: 'straight' },
      ]

      for (const testCase of cases) {
        const world = memoryWorld(testCase.neighbors)
        const results = yield* runRuleAtRegisteredStage(world.port, {
          _tag: 'PlaceStairs', block: 'oak_stairs', facing: 'north', hitFace: 'up', hitY: 0.5,
        }, position, `place-stairs-${testCase.name}`)
        expect(results, testCase.name).toMatchObject([{ outcome: { _tag: 'Applied' } }])
        expect(world.cells.get(keyOf(position))?.state, testCase.name).toMatchObject({
          facing: 'north', half: 'bottom', shape: testCase.expectedShape, waterlogged: false,
        })
      }

      const rotatedOuterLeftCases: ReadonlyArray<Readonly<{
        facing: HorizontalBlockStateFacing
        candidateFacing: HorizontalBlockStateFacing
      }>> = [
        { facing: 'east', candidateFacing: 'north' },
        { facing: 'south', candidateFacing: 'east' },
        { facing: 'west', candidateFacing: 'south' },
      ]
      for (const testCase of rotatedOuterLeftCases) {
        const world = memoryWorld([[step(position, testCase.facing), stairCell(testCase.candidateFacing, 'bottom')]])
        const results = yield* runRuleAtRegisteredStage(world.port, {
          _tag: 'PlaceStairs', block: 'purpur_stairs', facing: testCase.facing, hitFace: 'up', hitY: 0.5,
        }, position, `place-stairs-${testCase.facing}-outer-left`)
        expect(results).toMatchObject([{ outcome: { _tag: 'Applied' } }])
        expect(world.cells.get(keyOf(position))?.state).toMatchObject({
          facing: testCase.facing, half: 'bottom', shape: 'outer_left', waterlogged: false,
        })
      }

      const frontBlocked = memoryWorld([
        [north, stairCell('west', 'bottom')],
        [offset(position, 1), stairCell('north', 'bottom')],
        [south, stairCell('west', 'bottom')],
      ])
      const blockedResults = yield* runRuleAtRegisteredStage(frontBlocked.port, {
        _tag: 'PlaceStairs', block: 'oak_stairs', facing: 'north', hitFace: 'up', hitY: 0.5,
      }, position, 'place-stairs-front-blocked')
      expect(blockedResults).toMatchObject([{ outcome: { _tag: 'Applied' } }])
      expect(frontBlocked.cells.get(keyOf(position))?.state.shape).toBe('inner_left')

      const oppositeHalfBlocker = memoryWorld([
        [north, stairCell('west', 'bottom')],
        [offset(position, 1), stairCell('north', 'top')],
      ])
      const oppositeBlockerResults = yield* runRuleAtRegisteredStage(oppositeHalfBlocker.port, {
        _tag: 'PlaceStairs', block: 'oak_stairs', facing: 'north', hitFace: 'up', hitY: 0.5,
      }, position, 'place-stairs-opposite-half-blocker')
      expect(oppositeBlockerResults).toMatchObject([{ outcome: { _tag: 'Applied' } }])
      expect(oppositeHalfBlocker.cells.get(keyOf(position))?.state.shape).toBe('outer_left')

      const backBlocked = memoryWorld([
        [south, stairCell('east', 'bottom')],
        [offset(position, 1), stairCell('north', 'bottom')],
      ])
      const backBlockedResults = yield* runRuleAtRegisteredStage(backBlocked.port, {
        _tag: 'PlaceStairs', block: 'oak_stairs', facing: 'north', hitFace: 'up', hitY: 0.5,
      }, position, 'place-stairs-back-blocked')
      expect(backBlockedResults).toMatchObject([{ outcome: { _tag: 'Applied' } }])
      expect(backBlocked.cells.get(keyOf(position))?.state.shape).toBe('straight')
    }),
  )

  it.effect('source water waterlogs placed stairs while flowing water does not', () =>
    Effect.gen(function* () {
      for (const testCase of [
        { level: 0, waterlogged: true },
        { level: 6, waterlogged: false },
      ] as const) {
        const world = memoryWorld([[position, { block: blockId('water'), state: { level: testCase.level } }]])
        const results = yield* runRuleAtRegisteredStage(world.port, {
          _tag: 'PlaceStairs', block: 'purpur_stairs', facing: 'west', hitFace: 'up', hitY: 0.5,
        }, position, `place-waterlogged-${testCase.level}`)
        expect(results).toMatchObject([{ outcome: { _tag: 'Applied' } }])
        expect(world.cells.get(keyOf(position))?.state).toMatchObject({
          facing: 'west', half: 'bottom', shape: 'straight', waterlogged: testCase.waterlogged,
        })
      }
    }),
  )

  it.effect('placing a stair refreshes a same-half adjacent stair in one write and preserves its waterlogged state', () =>
    Effect.gen(function* () {
      const oldStair = offset(position, 0, 0, 1)
      const world = memoryWorld([[oldStair, stairCell('north', 'bottom', 'straight', 'oak_stairs', { waterlogged: true })]])
      const results = yield* runRuleAtRegisteredStage(world.port, {
        _tag: 'PlaceStairs', block: 'purpur_stairs', facing: 'east', hitFace: 'up', hitY: 0.5,
      }, position, 'place-next-to-stair')

      expect(results).toMatchObject([{ outcome: { _tag: 'Applied' } }])
      expect(world.cells.get(keyOf(position))?.state).toMatchObject({
        facing: 'east', half: 'bottom', shape: 'straight', waterlogged: false,
      })
      expect(world.cells.get(keyOf(oldStair))?.state).toMatchObject({
        facing: 'north', half: 'bottom', shape: 'outer_right', waterlogged: true,
      })
      expect(world.writes).toHaveLength(1)
      expect(world.writes[0]?.map(({ position: editPosition }) => keyOf(editPosition))).toStrictEqual([
        keyOf(position), keyOf(oldStair),
      ])
    }),
  )

  it.effect('refreshing after a stair removal restores straight shape and preserves its other state', () =>
    Effect.gen(function* () {
      const oldStair = offset(position, 0, 0, 1)
      const world = memoryWorld([[oldStair, stairCell('north', 'bottom', 'outer_right', 'oak_stairs', { waterlogged: true })]])
      const results = yield* runRuleAtRegisteredStage(world.port, {
        _tag: 'RefreshStairShapes',
      }, position, 'remove-neighbor-stair')
      expect(results).toMatchObject([{ outcome: { _tag: 'Applied' } }])
      expect(world.cells.get(keyOf(oldStair))?.state).toMatchObject({
        facing: 'north', half: 'bottom', shape: 'straight', waterlogged: true,
      })
      expect(world.writes).toHaveLength(1)

      const noStairs = memoryWorld([])
      expect(yield* runRuleAtRegisteredStage(noStairs.port, {
        _tag: 'RefreshStairShapes',
      }, position, 'refresh-without-stairs')).toStrictEqual([{
        requestId: 'refresh-without-stairs',
        outcome: { _tag: 'NoChange', reason: 'unchanged' },
      }])
      expect(noStairs.writes).toHaveLength(0)
    }),
  )

  it.effect('stair rules return typed results for invalid input and state-port failures', () =>
    Effect.gen(function* () {
      const placeOperation = {
        _tag: 'PlaceStairs', block: 'oak_stairs', facing: 'north', hitFace: 'up', hitY: 0.5,
      } as const
      expect(yield* runRuleAtRegisteredStage(memoryWorld([]).port, {
        ...placeOperation, hitY: 1.01,
      }, position, 'stairs-invalid-hit')).toStrictEqual([{ requestId: 'stairs-invalid-hit', outcome: {
        _tag: 'InvalidInput', reason: 'stairPlacement',
      } }])

      const unsupportedTarget = scriptedWorld([{ _tag: 'Unsupported', operation: 'readState' }])
      expect(yield* runRuleAtRegisteredStage(unsupportedTarget.port, placeOperation, position, 'stairs-read-unsupported'))
        .toStrictEqual([{ requestId: 'stairs-read-unsupported', outcome: {
          _tag: 'Unsupported', operation: 'readState', position,
        } }])
      const unavailableTarget = scriptedWorld([{ _tag: 'Unavailable', reason: 'OutOfWorld' }])
      expect(yield* runRuleAtRegisteredStage(unavailableTarget.port, placeOperation, position, 'stairs-read-unavailable'))
        .toStrictEqual([{ requestId: 'stairs-read-unavailable', outcome: {
          _tag: 'Unavailable', position, reason: 'OutOfWorld',
        } }])

      const north = offset(position, 0, 0, -1)
      const unsupportedCandidate = scriptedWorld([
        { _tag: 'Found', cell: { block: blockId('air'), state: {} } },
        { _tag: 'Unsupported', operation: 'readState' },
      ])
      expect(yield* runRuleAtRegisteredStage(unsupportedCandidate.port, placeOperation, position, 'stairs-candidate-unsupported'))
        .toStrictEqual([{ requestId: 'stairs-candidate-unsupported', outcome: {
          _tag: 'Unsupported', operation: 'readState', position: north,
        } }])

      const south = offset(position, 0, 0, 1)
      const unsupportedBackCandidate = scriptedWorld([
        { _tag: 'Found', cell: { block: blockId('air'), state: {} } },
        { _tag: 'Found', cell: { block: blockId('air'), state: {} } },
        { _tag: 'Unsupported', operation: 'readState' },
      ])
      expect(yield* runRuleAtRegisteredStage(unsupportedBackCandidate.port, placeOperation, position, 'stairs-back-unsupported'))
        .toStrictEqual([{ requestId: 'stairs-back-unsupported', outcome: {
          _tag: 'Unsupported', operation: 'readState', position: south,
        } }])

      const east = offset(position, 1)
      const unsupportedCheckedSide = scriptedWorld([
        { _tag: 'Found', cell: { block: blockId('air'), state: {} } },
        { _tag: 'Found', cell: stairCell('west', 'bottom') },
        { _tag: 'Unsupported', operation: 'readState' },
      ])
      expect(yield* runRuleAtRegisteredStage(unsupportedCheckedSide.port, placeOperation, position, 'stairs-side-unsupported'))
        .toStrictEqual([{ requestId: 'stairs-side-unsupported', outcome: {
          _tag: 'Unsupported', operation: 'readState', position: east,
        } }])

      const malformedCandidate = memoryWorld([[north, {
        block: blockId('oak_stairs'), state: { facing: 'up', half: 'bottom' },
      }]])
      expect(yield* runRuleAtRegisteredStage(malformedCandidate.port, placeOperation, position, 'stairs-invalid-neighbor'))
        .toStrictEqual([{ requestId: 'stairs-invalid-neighbor', outcome: { _tag: 'InvalidState', position: north } }])

      const malformedBlocker = memoryWorld([
        [north, stairCell('west', 'bottom')],
        [east, { block: blockId('oak_stairs'), state: { facing: 'up', half: 'bottom' } }],
      ])
      expect(yield* runRuleAtRegisteredStage(malformedBlocker.port, placeOperation, position, 'stairs-invalid-blocker'))
        .toStrictEqual([{ requestId: 'stairs-invalid-blocker', outcome: { _tag: 'InvalidState', position: east } }])

      const malformedAdjacent = memoryWorld([[east, {
        block: blockId('purpur_stairs'), state: { facing: 'north' },
      }]])
      expect(yield* runRuleAtRegisteredStage(malformedAdjacent.port, placeOperation, position, 'stairs-invalid-adjacent'))
        .toStrictEqual([{ requestId: 'stairs-invalid-adjacent', outcome: { _tag: 'InvalidState', position: east } }])

      const edge = blockPosition(BlockAxis(Number.MAX_SAFE_INTEGER), BlockAxis(64), BlockAxis(0))
      const edgeCandidate = yield* runRuleAtRegisteredStage(memoryWorld([]).port, {
        ...placeOperation, facing: 'east',
      }, edge, 'stairs-edge-candidate')
      expect(edgeCandidate).toStrictEqual([{ requestId: 'stairs-edge-candidate', outcome: { _tag: 'InvalidState', position: edge } }])

      const edgeNorth = step(edge, 'north')
      const edgeCheckedSide = memoryWorld([[edgeNorth, stairCell('west', 'bottom')]])
      expect(yield* runRuleAtRegisteredStage(edgeCheckedSide.port, placeOperation, edge, 'stairs-edge-checked-side'))
        .toStrictEqual([{ requestId: 'stairs-edge-checked-side', outcome: { _tag: 'InvalidState', position: edge } }])

      const edgeNeighborScan = yield* runRuleAtRegisteredStage(memoryWorld([]).port, placeOperation, edge, 'stairs-edge-neighbor-scan')
      expect(edgeNeighborScan).toStrictEqual([{ requestId: 'stairs-edge-neighbor-scan', outcome: { _tag: 'InvalidState', position: edge } }])

      const eastStair = step(position, 'east')
      const diagonal = step(eastStair, 'north')
      const stairWithUnreadableShapeCandidate = memoryWorld([[eastStair, stairCell('north', 'bottom')]])
      const unreadableShapePort: BlockStateWorldPort = {
        ...stairWithUnreadableShapeCandidate.port,
        read: (at) => keyOf(at) === keyOf(diagonal)
          ? Effect.succeed({ _tag: 'Unsupported', operation: 'readState' })
          : stairWithUnreadableShapeCandidate.port.read(at),
      }
      expect(yield* runRuleAtRegisteredStage(unreadableShapePort, placeOperation, position, 'stairs-neighbor-shape-unsupported'))
        .toStrictEqual([{ requestId: 'stairs-neighbor-shape-unsupported', outcome: {
          _tag: 'Unsupported', operation: 'readState', position: diagonal,
        } }])

      const occupiedTarget = memoryWorld([[position, { block: blockId('stone'), state: {} }]])
      expect(yield* runRuleAtRegisteredStage(occupiedTarget.port, placeOperation, position, 'stairs-occupied-target'))
        .toStrictEqual([{ requestId: 'stairs-occupied-target', outcome: { _tag: 'InvalidState', position } }])

      const unsupportedWrite = memoryWorld([])
      const noWritePort: BlockStateWorldPort = {
        ...unsupportedWrite.port,
        write: () => Effect.succeed({ _tag: 'Unsupported', operation: 'writeState' }),
      }
      expect(yield* runRuleAtRegisteredStage(noWritePort, placeOperation, position, 'stairs-write-unsupported'))
        .toStrictEqual([{ requestId: 'stairs-write-unsupported', outcome: {
          _tag: 'Unsupported', operation: 'writeState', position,
        } }])

      const refreshReadFailure = scriptedWorld([{ _tag: 'Unavailable', reason: 'ChunkNotLoaded' }])
      expect(yield* runRuleAtRegisteredStage(refreshReadFailure.port, {
        _tag: 'RefreshStairShapes',
      }, position, 'stairs-refresh-read-unavailable')).toStrictEqual([{ requestId: 'stairs-refresh-read-unavailable', outcome: {
        _tag: 'Unavailable', position: offset(position, 0, 0, -1), reason: 'ChunkNotLoaded',
      } }])

      const refreshWriteFailure = memoryWorld([[south, stairCell('north', 'bottom', 'outer_right')]])
      const noRefreshWritePort: BlockStateWorldPort = {
        ...refreshWriteFailure.port,
        write: () => Effect.succeed({ _tag: 'Unsupported', operation: 'writeState' }),
      }
      expect(yield* runRuleAtRegisteredStage(noRefreshWritePort, {
        _tag: 'RefreshStairShapes',
      }, position, 'stairs-refresh-write-unsupported')).toStrictEqual([{ requestId: 'stairs-refresh-write-unsupported', outcome: {
        _tag: 'Unsupported', operation: 'writeState', position,
      } }])
    }),
  )

  it.effect('sapling stages advance once before tree placement, and bone meal succeeds 45% of the time', () =>
    Effect.sync(() => {
      FastCheck.assert(FastCheck.property(
        FastCheck.integer({ min: 0, max: 1 }),
        FastCheck.integer({ min: 0, max: 9999 }).map((value) => value / 10000),
        FastCheck.boolean(),
        (stage, roll, treeSpaceAvailable) => {
          const chance = 1 / 7
          const expected = roll >= chance
            ? { _tag: 'NoChange', reason: 'growthMiss' }
            : stage === 0
              ? { _tag: 'Advanced', stage: 1 }
              : treeSpaceAvailable
                ? { _tag: 'TreeRequired' }
                : { _tag: 'NoChange', reason: 'blocked' }
          expect(saplingStageAfterGrowthAttempt(stage, roll, treeSpaceAvailable)).toStrictEqual(expected)
        },
      ))
      FastCheck.assert(FastCheck.property(
        FastCheck.integer({ min: 0, max: 1 }),
        FastCheck.integer({ min: 0, max: 9999 }).map((value) => value / 10000),
        FastCheck.boolean(),
        (stage, roll, treeSpaceAvailable) => {
          const expected = roll >= 0.45
            ? { _tag: 'NoChange', reason: 'growthMiss' }
            : stage === 0
              ? { _tag: 'Advanced', stage: 1 }
              : treeSpaceAvailable
                ? { _tag: 'TreeRequired' }
                : { _tag: 'NoChange', reason: 'blocked' }
          expect(saplingStageAfterBoneMeal(stage, roll, treeSpaceAvailable)).toStrictEqual(expected)
        },
      ))
      const naturalGrowthChance = 1 / 7
      expect(saplingStageAfterGrowthAttempt(0, naturalGrowthChance - Number.EPSILON, true))
        .toStrictEqual({ _tag: 'Advanced', stage: 1 })
      expect(saplingStageAfterGrowthAttempt(0, naturalGrowthChance, true))
        .toStrictEqual({ _tag: 'NoChange', reason: 'growthMiss' })
      expect(saplingStageAfterBoneMeal(0, 0.4499, true)).toStrictEqual({ _tag: 'Advanced', stage: 1 })
      expect(saplingStageAfterBoneMeal(0, 0.45, true)).toStrictEqual({ _tag: 'NoChange', reason: 'growthMiss' })
      expect(saplingStageAfterGrowthAttempt(1, 0, false)).toStrictEqual({ _tag: 'NoChange', reason: 'blocked' })
      expect(saplingStageAfterGrowthAttempt(1, 0, true)).toStrictEqual({ _tag: 'TreeRequired' })
      expect(saplingStageAfterGrowthAttempt(2, 0, true)).toStrictEqual({ _tag: 'InvalidState' })
      expect(saplingStageAfterGrowthAttempt(0, -0.01, true)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(saplingStageAfterGrowthAttempt(0, 1, true)).toStrictEqual({ _tag: 'InvalidInput' })
      expect(saplingStageAfterBoneMeal(2, 0, true)).toStrictEqual({ _tag: 'InvalidState' })
      expect(saplingStageAfterBoneMeal(0, -0.01, true)).toStrictEqual({ _tag: 'InvalidInput' })
    }),
  )

  it.effect('the state port advances crops and saplings, rejects nether wart bone meal, and refuses vegetation spread', () =>
    Effect.gen(function* () {
      const netherWartPosition = fixtureBlockPosition(3, 64, -3)
      const world = memoryWorld([
        [position, { block: blockId('wheat_crop'), state: { age: 0 } }],
        [fixtureBlockPosition(4, 64, -2), { block: blockId('sapling'), state: { stage: 0 } }],
        [fixtureBlockPosition(5, 64, -2), { block: blockId('grass_block'), state: stateOf('grass_block') }],
        [netherWartPosition, { block: blockId('nether_wart_crop'), state: { age: 0 } }],
      ])
      const cropOutcome = yield* applyBlockStateRule(world.port, {
        requestId: 'crop-tick', position,
        operation: { _tag: 'CropRandomTick', speedLevel: 10, roll: 0 },
      })
      expect(cropOutcome).toMatchObject({ _tag: 'Applied' })
      expect(world.cells.get(keyOf(position))?.state.age).toBe(1)

      const saplingPosition = fixtureBlockPosition(4, 64, -2)
      const saplingOutcome = yield* applyBlockStateRule(world.port, {
        requestId: 'sapling-tick', position: saplingPosition,
        operation: { _tag: 'SaplingGrowthAttempt', roll: 0, treeSpaceAvailable: true },
      })
      expect(saplingOutcome).toMatchObject({ _tag: 'Applied' })
      expect(world.cells.get(keyOf(saplingPosition))?.state.stage).toBe(1)

      expect(yield* applyBlockStateRule(world.port, {
        requestId: 'nether-wart-bone-meal', position: netherWartPosition,
        operation: { _tag: 'BoneMeal', cropStages: 2, saplingRoll: 0, treeSpaceAvailable: true },
      })).toStrictEqual({ _tag: 'NotApplicable', block: 'nether_wart_crop' })
      expect(world.cells.get(keyOf(netherWartPosition))?.state.age).toBe(0)

      const grassPosition = fixtureBlockPosition(5, 64, -2)
      const grassOutcome = yield* applyBlockStateRule(world.port, {
        requestId: 'grass-bone-meal', position: grassPosition,
        operation: { _tag: 'BoneMeal', cropStages: 2, saplingRoll: 0, treeSpaceAvailable: true },
      })
      expect(grassOutcome).toStrictEqual({
        _tag: 'Unsupported', operation: 'vegetationSpread', position: grassPosition,
      })
    }),
  )

  it.effect('sapling growth attempts report every state transition through the rule port', () =>
    Effect.gen(function* () {
      const saplingAtStage = (stage: 0 | 1) => memoryWorld([[position, {
        block: blockId('sapling'), state: { stage },
      }]])

      const growthMiss = saplingAtStage(0)
      expect(yield* applyRuleAt(growthMiss.port, {
        _tag: 'SaplingGrowthAttempt', roll: 1 / 7, treeSpaceAvailable: true,
      })).toStrictEqual({ _tag: 'NoChange', reason: 'growthMiss' })

      const blockedAtStageOne = saplingAtStage(1)
      expect(yield* applyRuleAt(blockedAtStageOne.port, {
        _tag: 'SaplingGrowthAttempt', roll: 0, treeSpaceAvailable: false,
      })).toStrictEqual({ _tag: 'NoChange', reason: 'blocked' })

      const treeRequired = saplingAtStage(1)
      expect(yield* applyRuleAt(treeRequired.port, {
        _tag: 'SaplingGrowthAttempt', roll: 0, treeSpaceAvailable: true,
      })).toStrictEqual({ _tag: 'Unsupported', operation: 'treePlacement', position })

      const invalidRoll = saplingAtStage(0)
      expect(yield* applyRuleAt(invalidRoll.port, {
        _tag: 'SaplingGrowthAttempt', roll: Number.NaN, treeSpaceAvailable: true,
      })).toStrictEqual({ _tag: 'InvalidInput', reason: 'randomRoll' })

      const missingStage = memoryWorld([[position, { block: blockId('sapling'), state: {} }]])
      expect(yield* applyRuleAt(missingStage.port, {
        _tag: 'SaplingGrowthAttempt', roll: 0, treeSpaceAvailable: true,
      })).toStrictEqual({ _tag: 'InvalidState', position })

      const notSapling = memoryWorld([[position, { block: blockId('stone'), state: {} }]])
      expect(yield* applyRuleAt(notSapling.port, {
        _tag: 'SaplingGrowthAttempt', roll: 0, treeSpaceAvailable: true,
      })).toStrictEqual({ _tag: 'NotApplicable', block: 'stone' })

      const unknownBlock = memoryWorld([[position, { block: BlockId(65_535), state: {} }]])
      expect(yield* applyRuleAt(unknownBlock.port, {
        _tag: 'SaplingGrowthAttempt', roll: 0, treeSpaceAvailable: true,
      })).toStrictEqual({ _tag: 'NotApplicable', block: undefined })
    }),
  )

  it.effect('bone meal validates inputs and handles supported crop and sapling states', () =>
    Effect.gen(function* () {
      const applyBoneMealAt = (port: BlockStateWorldPort, cropStages = 2, saplingRoll = 0) =>
        applyRuleAt(port, {
          _tag: 'BoneMeal', cropStages, saplingRoll, treeSpaceAvailable: true,
        })

      for (const cropStages of [1, 2.5, 6]) {
        expect(yield* applyBoneMealAt(memoryWorld([]).port, cropStages)).toStrictEqual({
          _tag: 'InvalidInput', reason: 'boneMealGrowth',
        })
      }
      for (const saplingRoll of [Number.NaN, -0.01, 1]) {
        expect(yield* applyBoneMealAt(memoryWorld([]).port, 2, saplingRoll)).toStrictEqual({
          _tag: 'InvalidInput', reason: 'randomRoll',
        })
      }

      const unavailable = scriptedWorld([{ _tag: 'Unavailable', reason: 'OutOfWorld' }])
      expect(yield* applyBoneMealAt(unavailable.port)).toStrictEqual({
        _tag: 'Unavailable', position, reason: 'OutOfWorld',
      })

      const missingSaplingStage = memoryWorld([[position, { block: blockId('sapling'), state: {} }]])
      expect(yield* applyBoneMealAt(missingSaplingStage.port)).toStrictEqual({ _tag: 'InvalidState', position })

      const advancedSapling = memoryWorld([[position, { block: blockId('sapling'), state: { stage: 0 } }]])
      expect(yield* applyBoneMealAt(advancedSapling.port)).toMatchObject({ _tag: 'Applied' })
      expect(advancedSapling.cells.get(keyOf(position))?.state.stage).toBe(1)

      const missedSapling = memoryWorld([[position, { block: blockId('sapling'), state: { stage: 1 } }]])
      expect(yield* applyRuleAt(missedSapling.port, {
        _tag: 'BoneMeal', cropStages: 2, saplingRoll: 0.45, treeSpaceAvailable: true,
      })).toStrictEqual({ _tag: 'NoChange', reason: 'growthMiss' })

      const blockedSapling = memoryWorld([[position, { block: blockId('sapling'), state: { stage: 1 } }]])
      expect(yield* applyRuleAt(blockedSapling.port, {
        _tag: 'BoneMeal', cropStages: 2, saplingRoll: 0, treeSpaceAvailable: false,
      })).toStrictEqual({ _tag: 'NoChange', reason: 'blocked' })

      const treeRequiredSapling = memoryWorld([[position, { block: blockId('sapling'), state: { stage: 1 } }]])
      expect(yield* applyBoneMealAt(treeRequiredSapling.port)).toStrictEqual({
        _tag: 'Unsupported', operation: 'treePlacement', position,
      })

      const missingCropAge = memoryWorld([[position, { block: blockId('wheat_crop'), state: {} }]])
      expect(yield* applyBoneMealAt(missingCropAge.port)).toStrictEqual({ _tag: 'InvalidState', position })

      const invalidCropAge = memoryWorld([[position, { block: blockId('wheat_crop'), state: { age: 8 } }]])
      expect(yield* applyBoneMealAt(invalidCropAge.port)).toStrictEqual({
        _tag: 'InvalidInput', reason: 'cropAge',
      })

      const matureCrop = memoryWorld([[position, { block: blockId('wheat_crop'), state: { age: 7 } }]])
      expect(yield* applyBoneMealAt(matureCrop.port)).toStrictEqual({ _tag: 'NoChange', reason: 'mature' })

      const grownCrop = memoryWorld([[position, { block: blockId('wheat_crop'), state: { age: 0 } }]])
      expect(yield* applyRuleAt(grownCrop.port, {
        _tag: 'BoneMeal', cropStages: 3, saplingRoll: 0, treeSpaceAvailable: false,
      })).toMatchObject({ _tag: 'Applied' })
      expect(grownCrop.cells.get(keyOf(position))?.state.age).toBe(3)

      const unknownBlock = memoryWorld([[position, { block: BlockId(65_535), state: {} }]])
      expect(yield* applyBoneMealAt(unknownBlock.port)).toStrictEqual({ _tag: 'NotApplicable', block: undefined })
    }),
  )

  it.effect('the registered stage routes every state operation to a typed unsupported result without id-only writes', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      let idOnlyWrites = 0
      const store = {
        getBlock: () => Effect.succeed({ _tag: 'Block', block: blockId('door') } as const),
        setBlock: () => Effect.sync(() => { idOnlyWrites += 1; return { _tag: 'Written' } }),
      } as unknown as ChunkStoreApi
      const stage = makeBlockStateRulesStage(state, store)
      yield* requestBlockStateRule(state, {
        requestId: 'door-unsupported',
        position,
        operation: { _tag: 'ToggleDoor' },
      })
      yield* requestBlockStateRule(state, {
        requestId: 'door-place-unsupported',
        position,
        operation: { _tag: 'PlaceDoor', facing: 'north', hinge: 'left' },
      })
      yield* requestBlockStateRule(state, {
        requestId: 'stair-place-unsupported',
        position,
        operation: { _tag: 'PlaceStairs', block: 'oak_stairs', facing: 'east', hitFace: 'up', hitY: 0.5 },
      })
      yield* requestBlockStateRule(state, {
        requestId: 'crop-tick-unsupported',
        position,
        operation: { _tag: 'CropRandomTick', speedLevel: 10, roll: 0 },
      })
      yield* requestBlockStateRule(state, {
        requestId: 'sapling-tick-unsupported',
        position,
        operation: { _tag: 'SaplingGrowthAttempt', roll: 0, treeSpaceAvailable: true },
      })
      yield* requestBlockStateRule(state, {
        requestId: 'bone-meal-unsupported',
        position,
        operation: { _tag: 'BoneMeal', cropStages: 2, saplingRoll: 0, treeSpaceAvailable: true },
      })
      yield* stage.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* drainBlockStateRuleResults(state)).toStrictEqual([{
        requestId: 'door-unsupported',
        outcome: { _tag: 'Unsupported', operation: 'readState', position },
      }, {
        requestId: 'door-place-unsupported',
        outcome: { _tag: 'Unsupported', operation: 'readState', position },
      }, {
        requestId: 'stair-place-unsupported',
        outcome: { _tag: 'Unsupported', operation: 'readState', position },
      }, {
        requestId: 'crop-tick-unsupported',
        outcome: { _tag: 'Unsupported', operation: 'readState', position },
      }, {
        requestId: 'sapling-tick-unsupported',
        outcome: { _tag: 'Unsupported', operation: 'readState', position },
      }, {
        requestId: 'bone-meal-unsupported',
        outcome: { _tag: 'Unsupported', operation: 'readState', position },
      }])
      expect(idOnlyWrites).toBe(0)
    }),
  )

  it.effect('the worldgen adapter exposes the missing write as a typed result', () =>
    Effect.gen(function* () {
      const store = {
        getBlock: () => Effect.succeed({ _tag: 'Block', block: blockId('oak_stairs') } as const),
      } as unknown as ChunkStoreApi
      const port = blockStateWorldPortForChunkStore(store)
      expect(yield* port.read(position)).toStrictEqual({
        _tag: 'Unsupported', operation: 'readState', block: blockId('oak_stairs'),
      })
      expect(yield* port.write([{ position, block: blockId('oak_stairs'), state: stateOf('oak_stairs') }]))
        .toStrictEqual({ _tag: 'Unsupported', operation: 'writeState' })
    }),
  )

  it.effect('the registered state stage reports an out-of-world read as unavailable', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = {
        getBlock: () => Effect.succeed({ _tag: 'OutOfWorld' } as const),
      } as unknown as ChunkStoreApi
      const stage = makeBlockStateRulesStage(state, store)
      yield* requestBlockStateRule(state, {
        requestId: 'out-of-world-state-read',
        position,
        operation: { _tag: 'ToggleDoor' },
      })

      yield* stage.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainBlockStateRuleResults(state)).toStrictEqual([{
        requestId: 'out-of-world-state-read',
        outcome: { _tag: 'Unavailable', position, reason: 'OutOfWorld' },
      }])
    }),
  )
})
