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
  type BlockRegistryResolutionFailure,
  type BlockPosition,
  type BlockStateAge,
  type BlockStateFacing,
  type BlockStateHalf,
  type BlockStateHinge,
  type BlockStateShape,
  type BlockStateStage,
  type BlockStateValues,
  type BlockType,
} from '@nerima-games/mc-kernel'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import type { ReplicatedOwnerCandidate } from '@nerima-games/mc-sim'

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
  write: (
    edits: ReadonlyArray<BlockStateEdit>,
    ownerChanges?: ReadonlyArray<ReplicatedOwnerCandidate>,
  ) => Effect.Effect<BlockStateWrite>
}>

// ChunkStoreApi stores block IDs only, so this adapter cannot return a stateful cell.
type ChunkStoreBlockStateRead = Exclude<BlockStateRead, Readonly<{ _tag: 'Found' }>>

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
    | Readonly<{ _tag: 'RefreshStairShapes' }>
    | Readonly<{ _tag: 'CropRandomTick'; speedLevel?: number; roll: number }>
    | Readonly<{
        /** Sampled roll for a light-eligible random tick; the caller handles the light gate. */
        _tag: 'SaplingGrowthAttempt'
        roll: number
        treeSpace: SaplingTreeSpaceResult
      }>
    | Readonly<{
        _tag: 'BoneMeal'
        cropStages: number
        saplingRoll: number
        treeSpaceAvailable: boolean
      }>
}>

type PlaceDoorOperation = Extract<BlockStateRuleRequest['operation'], { _tag: 'PlaceDoor' }>
type PlaceStairsOperation = Extract<BlockStateRuleRequest['operation'], { _tag: 'PlaceStairs' }>
type BoneMealOperation = Extract<BlockStateRuleRequest['operation'], { _tag: 'BoneMeal' }>

export type BlockStateRuleFailure = Readonly<{
  _tag: 'Unsupported'
  operation: 'readState' | 'writeState' | 'treePlacement' | 'vegetationSpread'
  position: BlockPosition
}> | Readonly<{
  _tag: 'PortUnavailable'
  position: BlockPosition
}> | Readonly<{
  _tag: 'Unavailable'
  position: BlockPosition
  reason: 'ChunkNotLoaded' | 'OutOfWorld'
}> | Readonly<{
  _tag: 'InvalidInput'
  reason: 'cropSpeedLevel' | 'cropAge' | 'randomRoll' | 'boneMealGrowth' | 'stairPlacement'
}> | Readonly<{
  _tag: 'InvalidState'
  position: BlockPosition
}> | BlockIdDecodeFailure

export type BlockIdDecodeFailure = Readonly<{
  _tag: 'BlockTypeDecodeFailed'
  position: BlockPosition
  block: BlockId
  failure: BlockRegistryResolutionFailure | Readonly<{ _tag: 'UnregisteredBlockId' }>
}>

export type SaplingTreeSpaceStatus = Readonly<
  | { _tag: 'Available' }
  | { _tag: 'Blocked' }
  | { _tag: 'OutOfWorld' }
  | { _tag: 'ChunkNotLoaded' }
>

export type SaplingTreeSpaceResult = SaplingTreeSpaceStatus | BlockIdDecodeFailure

export type BlockStateRuleOutcome =
  | Readonly<{ _tag: 'Applied'; edits: ReadonlyArray<BlockStateEdit> }>
  | Readonly<{
      _tag: 'NoChange'
      reason: 'growthMiss' | 'mature' | 'blocked' | 'outOfWorld' | 'chunkNotLoaded' | 'unchanged'
    }>
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
const SAPLING_STAGE_ONE = Schema.decodeUnknownSync(BlockStateStageSchema)(1)

const cropAge = (value: number): BlockStateAge | undefined =>
  Result.getOrUndefined(Schema.decodeUnknownResult(BlockStateAgeSchema)(value))

const validCropAgeRange = (age: number, maximumAge: number): boolean =>
  cropAge(age) !== undefined && cropAge(maximumAge) !== undefined && age <= maximumAge

const typeOf = (block: BlockId): BlockType | undefined =>
  Result.getOrUndefined(blockTypeOfId(block))

type BlockStateAccess =
  | Readonly<{ _tag: 'Found'; cell: BlockStateCell }>
  | Readonly<{ _tag: 'Failed'; failure: BlockStateRuleFailure }>

const readAccess = (position: BlockPosition, reading: BlockStateRead): BlockStateAccess => {
  if (reading._tag === 'Found') return { _tag: 'Found', cell: reading.cell }
  if (reading._tag === 'Unsupported') {
    return { _tag: 'Failed', failure: { _tag: 'Unsupported', operation: reading.operation, position } }
  }
  return { _tag: 'Failed', failure: { _tag: 'Unavailable', position, reason: reading.reason } }
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

export const blockStateWorldPortForChunkStore = (store: ChunkStoreApi): Readonly<{
  read: (position: BlockPosition) => Effect.Effect<ChunkStoreBlockStateRead>
  write: BlockStateWorldPort['write']
}> => ({
  read: (position) => Effect.map(store.getBlock(position), (reading): ChunkStoreBlockStateRead =>
    reading._tag === 'Block'
      ? { _tag: 'Unsupported', operation: 'readState', block: reading.block }
      : { _tag: 'Unavailable', reason: reading._tag },
  ),
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
): Readonly<{ _tag: 'Grew'; age: BlockStateAge } | { _tag: 'NoChange'; reason: 'growthMiss' | 'mature' } | { _tag: 'InvalidInput' }> => {
  const probability = cropGrowthProbability(speedLevel)
  if (probability === undefined || !Number.isFinite(roll) || roll < 0 || roll >= 1) return { _tag: 'InvalidInput' }
  if (!validCropAgeRange(age, maximumAge)) return { _tag: 'InvalidInput' }
  if (age >= maximumAge) return { _tag: 'NoChange', reason: 'mature' }
  return roll < probability
    ? { _tag: 'Grew', age: Schema.decodeUnknownSync(BlockStateAgeSchema)(age + 1) }
    : { _tag: 'NoChange', reason: 'growthMiss' }
}

export const netherWartAgeAfterRandomTick = (
  age: number,
  roll: number,
): Readonly<{
  _tag: 'Grew'
  age: BlockStateAge
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
    ? { _tag: 'Grew', age: Schema.decodeUnknownSync(BlockStateAgeSchema)(age + 1) }
    : { _tag: 'NoChange', reason: 'growthMiss' }
}

export const cropAgeAfterBoneMeal = (
  age: number,
  maximumAge: number,
  stages: number,
): Readonly<{ _tag: 'Grew'; age: BlockStateAge } | { _tag: 'NoChange'; reason: 'mature' } | { _tag: 'InvalidInput' }> => {
  if (!Number.isInteger(stages) || stages < 2 || stages > 5) return { _tag: 'InvalidInput' }
  if (!validCropAgeRange(age, maximumAge)) return { _tag: 'InvalidInput' }
  if (age >= maximumAge) return { _tag: 'NoChange', reason: 'mature' }
  return { _tag: 'Grew', age: Schema.decodeUnknownSync(BlockStateAgeSchema)(Math.min(maximumAge, age + stages)) }
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

type StairHalf = Extract<BlockStateHalf, 'top' | 'bottom'>
type StairState = Readonly<{ facing: HorizontalBlockStateFacing; half: StairHalf }>
type StairCellState =
  | Readonly<{ _tag: 'NotStair' }>
  | Readonly<{ _tag: 'Stair'; facing: HorizontalBlockStateFacing; half: StairHalf }>
  | Readonly<{ _tag: 'Invalid'; position: BlockPosition }>

const CARDINAL_FACINGS: ReadonlyArray<HorizontalBlockStateFacing> = ['north', 'east', 'south', 'west']

const OPPOSITE_FACING = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
} as const satisfies Readonly<Record<HorizontalBlockStateFacing, HorizontalBlockStateFacing>>

const COUNTER_CLOCKWISE_FACING = {
  north: 'west',
  east: 'north',
  south: 'east',
  west: 'south',
} as const satisfies Readonly<Record<HorizontalBlockStateFacing, HorizontalBlockStateFacing>>

const oppositeFacing = (facing: HorizontalBlockStateFacing): HorizontalBlockStateFacing => OPPOSITE_FACING[facing]

const counterClockwiseFacing = (facing: HorizontalBlockStateFacing): HorizontalBlockStateFacing =>
  COUNTER_CLOCKWISE_FACING[facing]

const isHorizontalFacing = (facing: BlockStateFacing | undefined): facing is HorizontalBlockStateFacing =>
  facing === 'north' || facing === 'east' || facing === 'south' || facing === 'west'

const isStairType = (block: BlockType | undefined): boolean =>
  block === 'oak_stairs' || block === 'purpur_stairs'

const stairCellState = (position: BlockPosition, cell: BlockStateCell): StairCellState => {
  if (!isStairType(typeOf(cell.block))) return { _tag: 'NotStair' }
  const facing = cell.state.facing
  const half = cell.state.half
  return isHorizontalFacing(facing) && (half === 'top' || half === 'bottom')
    ? { _tag: 'Stair', facing, half }
    : { _tag: 'Invalid', position }
}

const positionKey = (position: BlockPosition): string => `${position.x},${position.y},${position.z}`

const adjacent = (
  position: BlockPosition,
  facing: HorizontalBlockStateFacing,
): BlockPosition | undefined => Result.getOrUndefined(adjacentBlockPosition(position, facing))

const readFromSnapshot = (
  port: BlockStateWorldPort,
  snapshot: Map<string, BlockStateCell>,
  position: BlockPosition,
): Effect.Effect<BlockStateAccess> => Effect.gen(function* () {
  const cached = snapshot.get(positionKey(position))
  if (cached !== undefined) return { _tag: 'Found', cell: cached }
  const access = readAccess(position, yield* port.read(position))
  if (access._tag === 'Found') snapshot.set(positionKey(position), access.cell)
  return access
})

type StairCornerResult =
  | Readonly<{ _tag: 'Skip' }>
  | Readonly<{ _tag: 'Blocked' }>
  | Readonly<{ _tag: 'Shape'; shape: BlockStateShape }>
  | Readonly<{ _tag: 'Failed'; failure: BlockStateRuleFailure }>

const stairCornerAt = (
  port: BlockStateWorldPort,
  snapshot: Map<string, BlockStateCell>,
  position: BlockPosition,
  subject: StairState,
  side: 'front' | 'back',
): Effect.Effect<StairCornerResult> => Effect.gen(function* () {
  const direction = side === 'front' ? subject.facing : oppositeFacing(subject.facing)
  const candidatePosition = adjacent(position, direction)
  if (candidatePosition === undefined) {
    return { _tag: 'Failed', failure: { _tag: 'InvalidState', position } }
  }
  const candidateAccess = yield* readFromSnapshot(port, snapshot, candidatePosition)
  if (candidateAccess._tag === 'Failed') return { _tag: 'Failed', failure: candidateAccess.failure }
  const candidate = stairCellState(candidatePosition, candidateAccess.cell)
  if (candidate._tag === 'Invalid') {
    return { _tag: 'Failed', failure: { _tag: 'InvalidState', position: candidate.position } }
  }
  if (candidate._tag !== 'Stair' || candidate.half !== subject.half ||
      candidate.facing === subject.facing || candidate.facing === oppositeFacing(subject.facing)) {
    return { _tag: 'Skip' }
  }

  const checkedSideDirection = side === 'front' ? oppositeFacing(candidate.facing) : candidate.facing
  const checkedSidePosition = adjacent(position, checkedSideDirection)
  if (checkedSidePosition === undefined) {
    return { _tag: 'Failed', failure: { _tag: 'InvalidState', position } }
  }
  const checkedSideAccess = yield* readFromSnapshot(port, snapshot, checkedSidePosition)
  if (checkedSideAccess._tag === 'Failed') return { _tag: 'Failed', failure: checkedSideAccess.failure }
  const checkedSide = stairCellState(checkedSidePosition, checkedSideAccess.cell)
  if (checkedSide._tag === 'Invalid') {
    return { _tag: 'Failed', failure: { _tag: 'InvalidState', position: checkedSide.position } }
  }
  if (checkedSide._tag === 'Stair' && checkedSide.facing === subject.facing && checkedSide.half === subject.half) {
    return { _tag: 'Blocked' }
  }

  const left = candidate.facing === counterClockwiseFacing(subject.facing)
  const shape: BlockStateShape = side === 'front'
    ? left ? 'outer_left' : 'outer_right'
    : left ? 'inner_left' : 'inner_right'
  return { _tag: 'Shape', shape }
})

const stairShapeAt = (
  port: BlockStateWorldPort,
  snapshot: Map<string, BlockStateCell>,
  position: BlockPosition,
  subject: StairState,
): Effect.Effect<BlockStateShape | BlockStateRuleFailure> => Effect.gen(function* () {
  const front = yield* stairCornerAt(port, snapshot, position, subject, 'front')
  if (front._tag === 'Failed') return front.failure
  if (front._tag === 'Shape') return front.shape

  const back = yield* stairCornerAt(port, snapshot, position, subject, 'back')
  if (back._tag === 'Failed') return back.failure
  if (back._tag === 'Shape') return back.shape
  return 'straight'
})

type AdjacentStairEdits =
  | Readonly<{ _tag: 'Ready'; edits: ReadonlyArray<BlockStateEdit> }>
  | Readonly<{ _tag: 'Failed'; failure: BlockStateRuleFailure }>

const adjacentStairShapeEdits = (
  port: BlockStateWorldPort,
  snapshot: Map<string, BlockStateCell>,
  position: BlockPosition,
): Effect.Effect<AdjacentStairEdits> => Effect.gen(function* () {
  const edits: Array<BlockStateEdit> = []
  for (const facing of CARDINAL_FACINGS) {
    const neighborPosition = adjacent(position, facing)
    if (neighborPosition === undefined) {
      return { _tag: 'Failed', failure: { _tag: 'InvalidState', position } }
    }
    const access = yield* readFromSnapshot(port, snapshot, neighborPosition)
    if (access._tag === 'Failed') return { _tag: 'Failed', failure: access.failure }
    const stair = stairCellState(neighborPosition, access.cell)
    if (stair._tag === 'Invalid') {
      return { _tag: 'Failed', failure: { _tag: 'InvalidState', position: stair.position } }
    }
    if (stair._tag === 'NotStair') continue

    const shape = yield* stairShapeAt(port, snapshot, neighborPosition, stair)
    if (typeof shape !== 'string') return { _tag: 'Failed', failure: shape }
    if (access.cell.state.shape !== shape) {
      edits.push({
        position: neighborPosition,
        block: access.cell.block,
        state: { ...access.cell.state, shape },
      })
    }
  }
  return { _tag: 'Ready', edits }
})

type SaplingStageTransition = Readonly<
  | { _tag: 'Advanced'; stage: BlockStateStage }
  | { _tag: 'TreeRequired' }
  | { _tag: 'NoChange'; reason: 'growthMiss' | 'blocked' | 'outOfWorld' | 'chunkNotLoaded' }
  | { _tag: 'InvalidInput' }
  | { _tag: 'InvalidState' }
>
type SaplingTransitionAfterValidatedStage = Exclude<SaplingStageTransition, { _tag: 'InvalidState' }>

export function saplingStageAfterGrowthAttempt(
  stage: BlockStateStage,
  roll: number,
  treeSpace: SaplingTreeSpaceStatus,
): SaplingTransitionAfterValidatedStage
export function saplingStageAfterGrowthAttempt(
  stage: number,
  roll: number,
  treeSpace: SaplingTreeSpaceStatus,
): SaplingStageTransition
export function saplingStageAfterGrowthAttempt(
  stage: number,
  roll: number,
  treeSpace: SaplingTreeSpaceStatus,
): SaplingStageTransition {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return { _tag: 'InvalidInput' }
  if (stage !== 0 && stage !== 1) return { _tag: 'InvalidState' }
  if (treeSpace._tag === 'OutOfWorld') return { _tag: 'NoChange', reason: 'outOfWorld' }
  if (treeSpace._tag === 'ChunkNotLoaded') return { _tag: 'NoChange', reason: 'chunkNotLoaded' }
  if (roll >= 1 / 7) return { _tag: 'NoChange', reason: 'growthMiss' }
  if (stage === 0) return { _tag: 'Advanced', stage: SAPLING_STAGE_ONE }
  switch (treeSpace._tag) {
    case 'Available': return { _tag: 'TreeRequired' }
    case 'Blocked': return { _tag: 'NoChange', reason: 'blocked' }
  }
}

export function saplingStageAfterBoneMeal(
  stage: BlockStateStage,
  roll: number,
  treeSpaceAvailable: boolean,
): SaplingTransitionAfterValidatedStage
export function saplingStageAfterBoneMeal(
  stage: number,
  roll: number,
  treeSpaceAvailable: boolean,
): SaplingStageTransition
export function saplingStageAfterBoneMeal(
  stage: number,
  roll: number,
  treeSpaceAvailable: boolean,
): SaplingStageTransition {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return { _tag: 'InvalidInput' }
  if (stage !== 0 && stage !== 1) return { _tag: 'InvalidState' }
  if (roll >= 0.45) return { _tag: 'NoChange', reason: 'growthMiss' }
  if (stage === 0) return { _tag: 'Advanced', stage: SAPLING_STAGE_ONE }
  return treeSpaceAvailable ? { _tag: 'TreeRequired' } : { _tag: 'NoChange', reason: 'blocked' }
}

const outcomeForSapling = (
  port: BlockStateWorldPort,
  position: BlockPosition,
  cell: BlockStateCell,
  transition: SaplingTransitionAfterValidatedStage,
): Effect.Effect<BlockStateRuleOutcome> => {
  if (transition._tag === 'Advanced') {
    return writeEdits(port, [{ position, block: cell.block, state: { ...cell.state, stage: transition.stage } }], position)
  }
  if (transition._tag === 'TreeRequired') {
    return Effect.succeed({ _tag: 'Unsupported', operation: 'treePlacement', position })
  }
  if (transition._tag === 'NoChange') return Effect.succeed({ _tag: 'NoChange', reason: transition.reason })
  return Effect.succeed({ _tag: 'InvalidInput', reason: 'randomRoll' })
}

const toggleDoor = (
  port: BlockStateWorldPort,
  position: BlockPosition,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    const lowerRead = yield* port.read(position)
    const lowerAccess = readAccess(position, lowerRead)
    if (lowerAccess._tag === 'Failed') return lowerAccess.failure
    const lowerCell = lowerAccess.cell
    const blockType = typeOf(lowerCell.block)
    if (blockType !== 'door' && blockType !== 'door_open') return { _tag: 'NotApplicable', block: blockType }

    const half = lowerCell.state.half
    if (half !== 'lower' && half !== 'upper') return { _tag: 'InvalidState', position }
    const otherPosition = Result.getOrUndefined(adjacentBlockPosition(position, half === 'lower' ? 'up' : 'down'))
    if (otherPosition === undefined) return { _tag: 'InvalidState', position }
    const otherRead = yield* port.read(otherPosition)
    const otherAccess = readAccess(otherPosition, otherRead)
    if (otherAccess._tag === 'Failed') return otherAccess.failure
    const otherCell = otherAccess.cell

    const otherType = typeOf(otherCell.block)
    const otherHalf = otherCell.state.half
    const expectedOtherHalf = half === 'lower' ? 'upper' : 'lower'
    if ((otherType !== 'door' && otherType !== 'door_open') || otherHalf !== expectedOtherHalf) {
      return { _tag: 'InvalidState', position: otherPosition }
    }
    const facing = lowerCell.state.facing
    const hinge = lowerCell.state.hinge
    if (facing === undefined || hinge === undefined || facing === 'up' || facing === 'down') {
      return { _tag: 'InvalidState', position }
    }
    if (otherCell.state.facing !== facing || otherCell.state.hinge !== hinge) {
      return { _tag: 'InvalidState', position: otherPosition }
    }

    const doorId = Option.getOrThrow(blockIdOf('door'))
    const open = blockType === 'door_open' || lowerCell.state.open === true
    const nextOpen = doorOpenAfterToggle(open)
    const edits = [lowerCell, otherCell].map((cell): BlockStateEdit => ({
      position: cell === lowerCell ? position : otherPosition,
      block: doorId,
      state: { ...cell.state, open: nextOpen },
    }))
    return yield* writeEdits(port, edits, position)
  })

const placeDoor = (
  port: BlockStateWorldPort,
  position: BlockPosition,
  operation: PlaceDoorOperation,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    const upper = Result.getOrUndefined(adjacentBlockPosition(position, 'up'))
    if (upper === undefined) return { _tag: 'InvalidState', position }
    const lowerRead = yield* port.read(position)
    const lowerAccess = readAccess(position, lowerRead)
    if (lowerAccess._tag === 'Failed') return lowerAccess.failure
    const upperRead = yield* port.read(upper)
    const upperAccess = readAccess(upper, upperRead)
    if (upperAccess._tag === 'Failed') return upperAccess.failure
    if (typeOf(lowerAccess.cell.block) !== 'air' || typeOf(upperAccess.cell.block) !== 'air') {
      return { _tag: 'InvalidState', position }
    }
    const door = Option.getOrThrow(blockIdOf('door'))
    return yield* writeEdits(port, [
      {
        position,
        block: door,
        state: doorPlacementState(operation.facing, operation.hinge, 'lower'),
      },
      {
        position: upper,
        block: door,
        state: doorPlacementState(operation.facing, operation.hinge, 'upper'),
      },
    ], position)
  })

const placeStairs = (
  port: BlockStateWorldPort,
  position: BlockPosition,
  operation: PlaceStairsOperation,
): Effect.Effect<BlockStateRuleOutcome> => Effect.gen(function* () {
  const placement = stairPlacementState(operation.facing, operation.hitFace, operation.hitY)
  if (placement === undefined) return { _tag: 'InvalidInput', reason: 'stairPlacement' }
  const block = Option.getOrThrow(blockIdOf(operation.block))
  const defaults = Result.getOrThrow(defaultBlockState(block))

  const snapshot = new Map<string, BlockStateCell>()
  const targetAccess = yield* readFromSnapshot(port, snapshot, position)
  if (targetAccess._tag === 'Failed') return targetAccess.failure
  const targetType = typeOf(targetAccess.cell.block)
  if (targetType !== 'air' && targetType !== 'water') return { _tag: 'InvalidState', position }

  const initialState: BlockStateValues = {
    ...defaults,
    ...placement,
    shape: 'straight',
    waterlogged: targetType === 'water' && targetAccess.cell.state.level === 0,
  }
  const placedCell: BlockStateCell = { block, state: initialState }
  snapshot.set(positionKey(position), placedCell)

  const shape = yield* stairShapeAt(port, snapshot, position, placement)
  if (typeof shape !== 'string') return shape
  const placedState = { ...initialState, shape }
  snapshot.set(positionKey(position), { block, state: placedState })

  const adjacentEdits = yield* adjacentStairShapeEdits(port, snapshot, position)
  if (adjacentEdits._tag === 'Failed') return adjacentEdits.failure
  return yield* writeEdits(port, [{
    position,
    block,
    state: placedState,
  }, ...adjacentEdits.edits], position)
})

const refreshStairShapes = (
  port: BlockStateWorldPort,
  position: BlockPosition,
): Effect.Effect<BlockStateRuleOutcome> => Effect.gen(function* () {
  const edits = yield* adjacentStairShapeEdits(port, new Map(), position)
  if (edits._tag === 'Failed') return edits.failure
  if (edits.edits.length === 0) return { _tag: 'NoChange', reason: 'unchanged' }
  return yield* writeEdits(port, edits.edits, position)
})

const growCrop = (
  port: BlockStateWorldPort,
  position: BlockPosition,
  speedLevel: number | undefined,
  roll: number,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    const reading = yield* port.read(position)
    const access = readAccess(position, reading)
    if (access._tag === 'Failed') return access.failure
    const cell = access.cell
    const block = typeOf(cell.block)
    const isNetherWart = block === 'nether_wart_crop'
    const maximumAge = isNetherWart
      ? NETHER_WART_MAX_AGE
      : block === undefined ? undefined : CROP_MAX_AGE[block]
    if (maximumAge === undefined) return { _tag: 'NotApplicable', block }
    const age = cell.state.age
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
    return yield* writeEdits(port, [{
      position,
      block: cell.block,
      state: { ...cell.state, age: transition.age },
    }], position)
  })

const applyBoneMeal = (
  port: BlockStateWorldPort,
  position: BlockPosition,
  operation: BoneMealOperation,
): Effect.Effect<BlockStateRuleOutcome> =>
  Effect.gen(function* () {
    const { cropStages, saplingRoll, treeSpaceAvailable } = operation
    if (!Number.isInteger(cropStages) || cropStages < 2 || cropStages > 5) {
      return { _tag: 'InvalidInput', reason: 'boneMealGrowth' }
    }
    if (!Number.isFinite(saplingRoll) || saplingRoll < 0 || saplingRoll >= 1) {
      return { _tag: 'InvalidInput', reason: 'randomRoll' }
    }
    const reading = yield* port.read(position)
    const access = readAccess(position, reading)
    if (access._tag === 'Failed') return access.failure
    const cell = access.cell
    const block = typeOf(cell.block)

    if (block === 'sapling') {
      const stage = cell.state.stage
      if (stage === undefined) return { _tag: 'InvalidState', position }
      return yield* outcomeForSapling(
        port,
        position,
        cell,
        saplingStageAfterBoneMeal(stage, saplingRoll, treeSpaceAvailable),
      )
    }

    const maximumAge = block === undefined ? undefined : CROP_MAX_AGE[block]
    if (maximumAge !== undefined) {
      const age = cell.state.age
      if (age === undefined) return { _tag: 'InvalidState', position }
      const transition = cropAgeAfterBoneMeal(age, maximumAge, cropStages)
      if (transition._tag === 'NoChange') return { _tag: 'NoChange', reason: transition.reason }
      if (transition._tag === 'InvalidInput') {
        return { _tag: 'InvalidInput', reason: 'cropAge' }
      }
      return yield* writeEdits(port, [{
        position,
        block: cell.block,
        state: { ...cell.state, age: transition.age },
      }], position)
    }

    if (block === 'grass_block') {
      return { _tag: 'Unsupported', operation: 'vegetationSpread', position }
    }
    return { _tag: 'NotApplicable', block }
  })

export const applyBlockStateRule = (
  port: BlockStateWorldPort,
  request: BlockStateRuleRequest,
): Effect.Effect<BlockStateRuleOutcome> => {
  const { operation } = request
  if (operation._tag === 'ToggleDoor') return toggleDoor(port, request.position)
  if (operation._tag === 'PlaceDoor') return placeDoor(port, request.position, operation)
  if (operation._tag === 'PlaceStairs') return placeStairs(port, request.position, operation)
  if (operation._tag === 'RefreshStairShapes') return refreshStairShapes(port, request.position)
  if (operation._tag === 'CropRandomTick') {
    return growCrop(port, request.position, operation.speedLevel, operation.roll)
  }
  if (operation._tag === 'SaplingGrowthAttempt') {
    const { roll, treeSpace } = operation
    if (treeSpace._tag === 'BlockTypeDecodeFailed') return Effect.succeed(treeSpace)
    return Effect.gen(function* () {
      const reading = yield* port.read(request.position)
      const access = readAccess(request.position, reading)
      if (access._tag === 'Failed') return access.failure
      const cell = access.cell
      if (typeOf(cell.block) !== 'sapling') return { _tag: 'NotApplicable', block: typeOf(cell.block) }
      const stage = cell.state.stage
      if (stage === undefined) return { _tag: 'InvalidState', position: request.position }
      return yield* outcomeForSapling(
        port,
        request.position,
        cell,
        saplingStageAfterGrowthAttempt(stage, roll, treeSpace),
      )
    })
  }
  return applyBoneMeal(port, request.position, operation)
}
