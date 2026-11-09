import { Effect, Option, Result, Schema } from 'effect'
import {
  BlockStateAgeSchema,
  BlockStateStageSchema,
  adjacentBlockPosition,
  blockIdOf,
  blockTypeOfId,
  defaultBlockState,
  type BlockFace,
  type BlockId,
  type BlockPosition,
  type BlockStateAge,
  type BlockStateFacing,
  type BlockStateHalf,
  type BlockStateHinge,
  type BlockStateStage,
  type BlockStateValues,
  type BlockType,
} from '@nerima-games/mc-kernel'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'

export type BlockStateCell = Readonly<{
  block: BlockId
  state: BlockStateValues
}>

export type BlockStateEdit = Readonly<{
  position: BlockPosition
  block: BlockId
  state: BlockStateValues
}>

export type BlockStateRead =
  | Readonly<{ _tag: 'Found'; cell: BlockStateCell }>
  | Readonly<{ _tag: 'Unavailable'; reason: 'ChunkNotLoaded' | 'OutOfWorld' }>
  | Readonly<{ _tag: 'Unsupported'; operation: 'readState'; block?: BlockId }>

export type BlockStateWrite =
  | Readonly<{ _tag: 'Written' }>
  | Readonly<{ _tag: 'Unsupported'; operation: 'writeState' }>

export type BlockStateWorldPort = Readonly<{
  read: (position: BlockPosition) => Effect.Effect<BlockStateRead>
  write: (edits: ReadonlyArray<BlockStateEdit>) => Effect.Effect<BlockStateWrite>
}>

export type BlockStateRuleRequest = Readonly<{
  requestId: string
  position: BlockPosition
  operation:
    | Readonly<{ _tag: 'ToggleDoor' }>
    | Readonly<{
        _tag: 'PlaceDoor'
        facing: HorizontalBlockStateFacing
        hinge: BlockStateHinge
      }>
    | Readonly<{
        _tag: 'PlaceStairs'
        block: 'oak_stairs' | 'purpur_stairs'
        facing: HorizontalBlockStateFacing
        hitFace: BlockFace
        hitY: number
      }>
    | Readonly<{ _tag: 'CropRandomTick'; speedLevel?: number; roll: number }>
    | Readonly<{
        /** Sampled roll for a light-eligible random tick; the caller handles the light gate. */
        _tag: 'SaplingGrowthAttempt'
        roll: number
        treeSpaceAvailable: boolean
      }>
    | Readonly<{
        _tag: 'BoneMeal'
        cropStages: number
        saplingRoll: number
        treeSpaceAvailable: boolean
      }>
}>

export type BlockStateRuleFailure = Readonly<{
  _tag: 'Unsupported'
  operation: 'readState' | 'writeState' | 'treePlacement' | 'vegetationSpread'
  position: BlockPosition
}> | Readonly<{
  _tag: 'Unavailable'
  position: BlockPosition
  reason: 'ChunkNotLoaded' | 'OutOfWorld'
}> | Readonly<{
  _tag: 'InvalidInput'
  reason: 'cropSpeedLevel' | 'cropAge' | 'randomRoll' | 'boneMealGrowth' | 'stairPlacement' | 'ruleOperation'
}> | Readonly<{
  _tag: 'InvalidState'
  position: BlockPosition
}>

export type BlockStateRuleOutcome =
  | Readonly<{ _tag: 'Applied'; edits: ReadonlyArray<BlockStateEdit> }>
  | Readonly<{ _tag: 'NoChange'; reason: 'growthMiss' | 'mature' | 'blocked' }>
  | Readonly<{ _tag: 'NotApplicable'; block: BlockType | undefined }>
  | BlockStateRuleFailure

export type BlockStateRuleResult = Readonly<{
  requestId: string
  outcome: BlockStateRuleOutcome
}>

export type HorizontalBlockStateFacing = Extract<BlockStateFacing, 'north' | 'east' | 'south' | 'west'>

const CROP_MAX_AGE: Readonly<Partial<Record<BlockType, number>>> = {
  wheat_crop: 7,
  potato_crop: 7,
}
const NETHER_WART_MAX_AGE = 3
const NETHER_WART_RANDOM_TICK_CHANCE = 10 / 100
const BONE_MEAL_CROP_TYPES: ReadonlySet<BlockType> = new Set(['wheat_crop', 'potato_crop'])

const cropAge = (value: number): BlockStateAge | undefined =>
  Result.getOrUndefined(Schema.decodeUnknownResult(BlockStateAgeSchema)(value))

const validCropAgeRange = (age: number, maximumAge: number): boolean =>
  cropAge(age) !== undefined && cropAge(maximumAge) !== undefined && age <= maximumAge

const saplingStage = (value: number): BlockStateStage | undefined =>
  Result.getOrUndefined(Schema.decodeUnknownResult(BlockStateStageSchema)(value))

const typeOf = (block: BlockId): BlockType | undefined =>
  Result.getOrUndefined(blockTypeOfId(block))

const idOf = (block: BlockType): BlockId | undefined =>
  Option.getOrUndefined(blockIdOf(block))

const stateDefault = (block: BlockType): BlockStateValues | undefined => {
  const id = idOf(block)
  return id === undefined ? undefined : Result.getOrUndefined(defaultBlockState(id))
}

const accessFailure = (position: BlockPosition, reading: BlockStateRead): BlockStateRuleFailure | undefined => {
  switch (reading._tag) {
    case 'Found': return undefined
    case 'Unsupported': return { _tag: 'Unsupported', operation: reading.operation, position }
    case 'Unavailable': return { _tag: 'Unavailable', position, reason: reading.reason }
    default: {
      const exhaustive: never = reading
      void exhaustive
      return { _tag: 'Unsupported', operation: 'readState', position }
    }
  }
}

const writeEdits = (
  port: BlockStateWorldPort,
  edits: ReadonlyArray<BlockStateEdit>,
  position: BlockPosition,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.map(port.write(edits), (result) => result._tag === 'Written'
    ? { _tag: 'Applied', edits }
    : { _tag: 'Unsupported', operation: result.operation, position },
  )

export const blockStateWorldPortForChunkStore = (store: ChunkStoreApi): BlockStateWorldPort => ({
  read: (position) => Effect.map(store.getBlock(position), (reading): BlockStateRead => {
    switch (reading._tag) {
      case 'Block':
        return { _tag: 'Unsupported', operation: 'readState', block: reading.block }
      case 'ChunkNotLoaded':
        return { _tag: 'Unavailable', reason: 'ChunkNotLoaded' }
      case 'OutOfWorld':
        return { _tag: 'Unavailable', reason: 'OutOfWorld' }
      default: {
        const exhaustive: never = reading
        void exhaustive
        return { _tag: 'Unsupported', operation: 'readState' }
      }
    }
  }),
  write: () => Effect.succeed({ _tag: 'Unsupported', operation: 'writeState' }),
})

export const cropGrowthProbability = (speedLevel: number): number | undefined => {
  if (!Number.isFinite(speedLevel) || speedLevel < 1 || speedLevel > 10) return undefined
  return 1 / (Math.floor(25 / speedLevel) + 1)
}

export const cropAgeAfterRandomTick = (
  age: number,
  maximumAge: number,
  speedLevel: number,
  roll: number,
): Readonly<{ _tag: 'Grew'; age: number } | { _tag: 'NoChange'; reason: 'growthMiss' | 'mature' } | { _tag: 'InvalidInput' }> => {
  const probability = cropGrowthProbability(speedLevel)
  if (probability === undefined || !Number.isFinite(roll) || roll < 0 || roll >= 1) return { _tag: 'InvalidInput' }
  if (!validCropAgeRange(age, maximumAge)) return { _tag: 'InvalidInput' }
  if (age >= maximumAge) return { _tag: 'NoChange', reason: 'mature' }
  return roll < probability
    ? { _tag: 'Grew', age: age + 1 }
    : { _tag: 'NoChange', reason: 'growthMiss' }
}

export const netherWartAgeAfterRandomTick = (
  age: number,
  roll: number,
): Readonly<{
  _tag: 'Grew'
  age: number
} | {
  _tag: 'NoChange'
  reason: 'growthMiss' | 'mature'
} | {
  _tag: 'InvalidInput'
}> => {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return { _tag: 'InvalidInput' }
  if (!validCropAgeRange(age, NETHER_WART_MAX_AGE)) return { _tag: 'InvalidInput' }
  if (age >= NETHER_WART_MAX_AGE) return { _tag: 'NoChange', reason: 'mature' }
  return roll < NETHER_WART_RANDOM_TICK_CHANCE
    ? { _tag: 'Grew', age: age + 1 }
    : { _tag: 'NoChange', reason: 'growthMiss' }
}

export const cropAgeAfterBoneMeal = (
  age: number,
  maximumAge: number,
  stages: number,
): Readonly<{ _tag: 'Grew'; age: number } | { _tag: 'NoChange'; reason: 'mature' } | { _tag: 'InvalidInput' }> => {
  if (!Number.isInteger(stages) || stages < 2 || stages > 5) return { _tag: 'InvalidInput' }
  if (!validCropAgeRange(age, maximumAge)) return { _tag: 'InvalidInput' }
  if (age >= maximumAge) return { _tag: 'NoChange', reason: 'mature' }
  return { _tag: 'Grew', age: Math.min(maximumAge, age + stages) }
}

export const doorOpenAfterToggle = (open: boolean): boolean => !open

export const doorPlacementState = (
  facing: HorizontalBlockStateFacing,
  hinge: BlockStateHinge,
  half: Extract<BlockStateHalf, 'lower' | 'upper'>,
): BlockStateValues => ({ facing, hinge, half, open: false, powered: false })

export const stairPlacementState = (
  facing: HorizontalBlockStateFacing,
  hitFace: BlockFace,
  hitY: number,
): Readonly<{ facing: HorizontalBlockStateFacing; half: Extract<BlockStateHalf, 'top' | 'bottom'> }> | undefined => {
  if (!Number.isFinite(hitY) || hitY < 0 || hitY > 1) return undefined
  const half = hitFace === 'down'
    ? 'top'
    : hitFace === 'up'
      ? 'bottom'
      : hitY > 0.5
        ? 'top'
        : 'bottom'
  return { facing, half }
}

export const saplingStageAfterGrowthAttempt = (
  stage: number,
  roll: number,
  treeSpaceAvailable: boolean,
): Readonly<{ _tag: 'Advanced'; stage: 1 } | { _tag: 'TreeRequired' } | { _tag: 'NoChange'; reason: 'growthMiss' | 'blocked' } | { _tag: 'InvalidInput' | 'InvalidState' }> => {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return { _tag: 'InvalidInput' }
  if (stage !== 0 && stage !== 1) return { _tag: 'InvalidState' }
  if (roll >= 1 / 7) return { _tag: 'NoChange', reason: 'growthMiss' }
  if (stage === 0) return { _tag: 'Advanced', stage: 1 }
  return treeSpaceAvailable ? { _tag: 'TreeRequired' } : { _tag: 'NoChange', reason: 'blocked' }
}

export const saplingStageAfterBoneMeal = (
  stage: number,
  roll: number,
  treeSpaceAvailable: boolean,
): Readonly<{ _tag: 'Advanced'; stage: 1 } | { _tag: 'TreeRequired' } | { _tag: 'NoChange'; reason: 'growthMiss' | 'blocked' } | { _tag: 'InvalidInput' | 'InvalidState' }> => {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return { _tag: 'InvalidInput' }
  if (stage !== 0 && stage !== 1) return { _tag: 'InvalidState' }
  if (roll >= 0.45) return { _tag: 'NoChange', reason: 'growthMiss' }
  if (stage === 0) return { _tag: 'Advanced', stage: 1 }
  return treeSpaceAvailable ? { _tag: 'TreeRequired' } : { _tag: 'NoChange', reason: 'blocked' }
}

const outcomeForSapling = (
  port: BlockStateWorldPort,
  position: BlockPosition,
  cell: BlockStateCell,
  transition: ReturnType<typeof saplingStageAfterGrowthAttempt> | ReturnType<typeof saplingStageAfterBoneMeal>,
): Effect.Effect<BlockStateRuleOutcome> => {
  switch (transition._tag) {
    case 'Advanced': {
      const stage = saplingStage(transition.stage)
      return stage === undefined
        ? Effect.succeed({ _tag: 'InvalidState', position })
        : writeEdits(port, [{ position, block: cell.block, state: { ...cell.state, stage } }], position)
    }
    case 'TreeRequired':
      return Effect.succeed({ _tag: 'Unsupported', operation: 'treePlacement', position })
    case 'NoChange':
      return Effect.succeed({ _tag: 'NoChange', reason: transition.reason })
    case 'InvalidInput':
      return Effect.succeed({ _tag: 'InvalidInput', reason: 'randomRoll' })
    case 'InvalidState':
      return Effect.succeed({ _tag: 'InvalidState', position })
    default: {
      const exhaustive: never = transition
      void exhaustive
      return Effect.succeed({ _tag: 'InvalidState', position })
    }
  }
}

const toggleDoor = (
  port: BlockStateWorldPort,
  position: BlockPosition,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    const lowerRead = yield* port.read(position)
    const lowerFailure = accessFailure(position, lowerRead)
    if (lowerFailure !== undefined) return lowerFailure
    if (lowerRead._tag !== 'Found') return { _tag: 'InvalidState', position }
    const blockType = typeOf(lowerRead.cell.block)
    if (blockType !== 'door' && blockType !== 'door_open') return { _tag: 'NotApplicable', block: blockType }

    const half = lowerRead.cell.state.half
    if (half !== 'lower' && half !== 'upper') return { _tag: 'InvalidState', position }
    const otherPosition = Result.getOrUndefined(adjacentBlockPosition(position, half === 'lower' ? 'up' : 'down'))
    if (otherPosition === undefined) return { _tag: 'InvalidState', position }
    const otherRead = yield* port.read(otherPosition)
    const otherFailure = accessFailure(otherPosition, otherRead)
    if (otherFailure !== undefined) return otherFailure
    if (otherRead._tag !== 'Found') return { _tag: 'InvalidState', position: otherPosition }

    const otherType = typeOf(otherRead.cell.block)
    const otherHalf = otherRead.cell.state.half
    const expectedOtherHalf = half === 'lower' ? 'upper' : 'lower'
    if ((otherType !== 'door' && otherType !== 'door_open') || otherHalf !== expectedOtherHalf) {
      return { _tag: 'InvalidState', position: otherPosition }
    }
    const facing = lowerRead.cell.state.facing
    const hinge = lowerRead.cell.state.hinge
    if (facing === undefined || hinge === undefined || facing === 'up' || facing === 'down') {
      return { _tag: 'InvalidState', position }
    }
    if (otherRead.cell.state.facing !== facing || otherRead.cell.state.hinge !== hinge) {
      return { _tag: 'InvalidState', position: otherPosition }
    }

    const doorId = idOf('door')
    if (doorId === undefined) return { _tag: 'InvalidState', position }
    const open = blockType === 'door_open' || lowerRead.cell.state.open === true
    const nextOpen = doorOpenAfterToggle(open)
    const edits = [lowerRead.cell, otherRead.cell].map((cell): BlockStateEdit => ({
      position: cell === lowerRead.cell ? position : otherPosition,
      block: doorId,
      state: { ...cell.state, open: nextOpen },
    }))
    return yield* writeEdits(port, edits, position)
  })

const placeDoor = (
  port: BlockStateWorldPort,
  request: BlockStateRuleRequest,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    if (request.operation._tag !== 'PlaceDoor') return { _tag: 'InvalidState', position: request.position }
    const upper = Result.getOrUndefined(adjacentBlockPosition(request.position, 'up'))
    if (upper === undefined) return { _tag: 'InvalidState', position: request.position }
    const lowerRead = yield* port.read(request.position)
    const lowerFailure = accessFailure(request.position, lowerRead)
    if (lowerFailure !== undefined) return lowerFailure
    const upperRead = yield* port.read(upper)
    const upperFailure = accessFailure(upper, upperRead)
    if (upperFailure !== undefined) return upperFailure
    if (lowerRead._tag !== 'Found' || upperRead._tag !== 'Found') return { _tag: 'InvalidState', position: request.position }
    if (typeOf(lowerRead.cell.block) !== 'air' || typeOf(upperRead.cell.block) !== 'air') {
      return { _tag: 'InvalidState', position: request.position }
    }
    const door = idOf('door')
    if (door === undefined) return { _tag: 'InvalidState', position: request.position }
    return yield* writeEdits(port, [
      {
        position: request.position,
        block: door,
        state: doorPlacementState(request.operation.facing, request.operation.hinge, 'lower'),
      },
      {
        position: upper,
        block: door,
        state: doorPlacementState(request.operation.facing, request.operation.hinge, 'upper'),
      },
    ], request.position)
  })

const growCrop = (
  port: BlockStateWorldPort,
  position: BlockPosition,
  speedLevel: number | undefined,
  roll: number,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    const reading = yield* port.read(position)
    const failure = accessFailure(position, reading)
    if (failure !== undefined) return failure
    if (reading._tag !== 'Found') return { _tag: 'InvalidState', position }
    const block = typeOf(reading.cell.block)
    const isNetherWart = block === 'nether_wart_crop'
    const maximumAge = isNetherWart
      ? NETHER_WART_MAX_AGE
      : block === undefined ? undefined : CROP_MAX_AGE[block]
    if (maximumAge === undefined) return { _tag: 'NotApplicable', block }
    const age = reading.cell.state.age
    if (age === undefined) return { _tag: 'InvalidState', position }
    const transition = isNetherWart
      ? netherWartAgeAfterRandomTick(age, roll)
      : speedLevel === undefined
        ? { _tag: 'InvalidInput' as const }
        : cropAgeAfterRandomTick(age, maximumAge, speedLevel, roll)
    if (transition._tag === 'InvalidInput') {
      const reason = !isNetherWart && (speedLevel === undefined || cropGrowthProbability(speedLevel) === undefined)
        ? 'cropSpeedLevel'
        : !Number.isFinite(roll) || roll < 0 || roll >= 1
          ? 'randomRoll'
          : 'cropAge'
      return { _tag: 'InvalidInput', reason }
    }
    if (transition._tag === 'NoChange') return { _tag: 'NoChange', reason: transition.reason }
    const nextAge = cropAge(transition.age)
    if (nextAge === undefined) return { _tag: 'InvalidState', position }
    return yield* writeEdits(port, [{
      position,
      block: reading.cell.block,
      state: { ...reading.cell.state, age: nextAge },
    }], position)
  })

const applyBoneMeal = (
  port: BlockStateWorldPort,
  request: BlockStateRuleRequest,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    if (request.operation._tag !== 'BoneMeal') return { _tag: 'InvalidState', position: request.position }
    const { cropStages, saplingRoll, treeSpaceAvailable } = request.operation
    if (!Number.isInteger(cropStages) || cropStages < 2 || cropStages > 5) {
      return { _tag: 'InvalidInput', reason: 'boneMealGrowth' }
    }
    if (!Number.isFinite(saplingRoll) || saplingRoll < 0 || saplingRoll >= 1) {
      return { _tag: 'InvalidInput', reason: 'randomRoll' }
    }
    const reading = yield* port.read(request.position)
    const failure = accessFailure(request.position, reading)
    if (failure !== undefined) return failure
    if (reading._tag !== 'Found') return { _tag: 'InvalidState', position: request.position }
    const block = typeOf(reading.cell.block)

    if (block === 'sapling') {
      const stage = reading.cell.state.stage
      if (stage === undefined) return { _tag: 'InvalidState', position: request.position }
      return yield* outcomeForSapling(
        port,
        request.position,
        reading.cell,
        saplingStageAfterBoneMeal(stage, saplingRoll, treeSpaceAvailable),
      )
    }

    const maximumAge = block === undefined ? undefined : CROP_MAX_AGE[block]
    if (maximumAge !== undefined) {
      if (block === undefined || !BONE_MEAL_CROP_TYPES.has(block)) {
        return { _tag: 'NotApplicable', block }
      }
      const age = reading.cell.state.age
      if (age === undefined) return { _tag: 'InvalidState', position: request.position }
      const transition = cropAgeAfterBoneMeal(age, maximumAge, cropStages)
      if (transition._tag === 'NoChange') return { _tag: 'NoChange', reason: transition.reason }
      if (transition._tag === 'InvalidInput') {
        return { _tag: 'InvalidInput', reason: validCropAgeRange(age, maximumAge) ? 'boneMealGrowth' : 'cropAge' }
      }
      const nextAge = cropAge(transition.age)
      if (nextAge === undefined) return { _tag: 'InvalidState', position: request.position }
      return yield* writeEdits(port, [{
        position: request.position,
        block: reading.cell.block,
        state: { ...reading.cell.state, age: nextAge },
      }], request.position)
    }

    if (block === 'grass_block') {
      return { _tag: 'Unsupported', operation: 'vegetationSpread', position: request.position }
    }
    return { _tag: 'NotApplicable', block }
  })

export const applyBlockStateRule = (
  port: BlockStateWorldPort,
  request: BlockStateRuleRequest,
): Effect.Effect<BlockStateRuleOutcome> => {
  switch (request.operation._tag) {
    case 'ToggleDoor':
      return toggleDoor(port, request.position)
    case 'PlaceDoor':
      return placeDoor(port, request)
    case 'PlaceStairs': {
      const state = stairPlacementState(request.operation.facing, request.operation.hitFace, request.operation.hitY)
      if (state === undefined) return Effect.succeed({ _tag: 'InvalidInput', reason: 'stairPlacement' })
      const defaults = stateDefault(request.operation.block)
      const block = idOf(request.operation.block)
      if (defaults === undefined || block === undefined) return Effect.succeed({ _tag: 'InvalidState', position: request.position })
      return writeEdits(port, [{
        position: request.position,
        block,
        state: { ...defaults, ...state },
      }], request.position)
    }
    case 'CropRandomTick':
      return growCrop(port, request.position, request.operation.speedLevel, request.operation.roll)
    case 'SaplingGrowthAttempt': {
      const { roll, treeSpaceAvailable } = request.operation
      return Effect.gen(function* () {
        const reading = yield* port.read(request.position)
        const failure = accessFailure(request.position, reading)
        if (failure !== undefined) return failure
        if (reading._tag !== 'Found') return { _tag: 'InvalidState', position: request.position }
        if (typeOf(reading.cell.block) !== 'sapling') return { _tag: 'NotApplicable', block: typeOf(reading.cell.block) }
        const stage = reading.cell.state.stage
        if (stage === undefined) return { _tag: 'InvalidState', position: request.position }
        return yield* outcomeForSapling(
          port,
          request.position,
          reading.cell,
          saplingStageAfterGrowthAttempt(stage, roll, treeSpaceAvailable),
        )
      })
    }
    case 'BoneMeal':
      return applyBoneMeal(port, request)
    default: {
      const exhaustive: never = request.operation
      void exhaustive
      return Effect.succeed({ _tag: 'InvalidInput', reason: 'ruleOperation' })
    }
  }
}
