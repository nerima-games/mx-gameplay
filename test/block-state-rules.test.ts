import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Option, Result } from 'effect'
import {
  BlockAxis,
  blockIdOf,
  blockPosition,
  DeltaTimeSecs,
  defaultBlockState,
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
  saplingStageAfterBoneMeal,
  saplingStageAfterGrowthAttempt,
  stairPlacementState,
  type BlockStateCell,
  type BlockStateWorldPort,
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
} => {
  const cells = new Map(initial.map(([at, cell]) => [keyOf(at), cell]))
  const port: BlockStateWorldPort = {
    read: (at) => Effect.sync(() => ({
      _tag: 'Found',
      cell: cells.get(keyOf(at)) ?? { block: blockId('air'), state: {} },
    })),
    write: (edits) => Effect.sync(() => {
      for (const edit of edits) cells.set(keyOf(edit.position), { block: edit.block, state: edit.state })
      return { _tag: 'Written' }
    }),
  }
  return { port, cells }
}

const above = (at: BlockPosition): BlockPosition => blockPosition(
  BlockAxis(at.x),
  BlockAxis(at.y + 1),
  BlockAxis(at.z),
)

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

  it.effect('stairs face the chosen horizontal direction and use the clicked half boundary', () =>
    Effect.sync(() => {
      const facings: ReadonlyArray<HorizontalBlockStateFacing> = ['north', 'east', 'south', 'west']
      FastCheck.assert(FastCheck.property(
        FastCheck.constantFrom(...facings),
        FastCheck.integer({ min: 0, max: 100 }).map((percent) => percent / 100),
        (facing, hitY) => {
          expect(stairPlacementState(facing, hitY)).toStrictEqual({
            facing,
            half: hitY >= 0.5 ? 'top' : 'bottom',
          })
        },
      ))
      expect(stairPlacementState('west', 0.49)?.half).toBe('bottom')
      expect(stairPlacementState('west', 0.5)?.half).toBe('top')
      expect(stairPlacementState('west', 1.01)).toBeUndefined()
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
        operation: { _tag: 'PlaceStairs', block: 'oak_stairs', facing: 'east', hitY: 0.5 },
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
        outcome: { _tag: 'Unsupported', operation: 'writeState', position },
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
})
