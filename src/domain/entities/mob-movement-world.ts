import {
  BlockAxis,
  PositionAxis,
  position,
  type Position,
} from '@nerima-games/mc-kernel'
import { COLLISION_SHAPE_AABBS } from '@nerima-games/mc-physics'
import {
  MobMovementStateSchema,
  MobPathCellSchema,
  MobPathProfileSchema,
  type EntityId,
  type EntityKind,
  type MobMovementState,
  type MobMovementWorldPort,
  type MobPathCell,
  type MobPathProfile,
} from '@nerima-games/mc-sim'
import { Result, Schema } from 'effect'
import type { ChunkWindow } from '../chunk-window.js'
import {
  entityWorldAirBlockDataAt,
  entityWorldCellAt,
  type EntityWorldCell,
  type EntityWorldQueryFailure,
} from './entity-world-cell.js'
import {
  CHICKEN_KIND,
  COW_KIND,
  PIG_KIND,
  PASSIVE_MOB_KINDS,
  SHEEP_KIND,
  SPIDER_KIND,
} from '../mob/mob-ecosystem.js'
import { ZOMBIE_KIND } from '../mob/hostile-combat.js'

export type MobMovementWorldFailure = EntityWorldQueryFailure

export type MobMovementWorldCell = EntityWorldCell

export type MobMovementWorldAdapter = MobMovementWorldPort & Readonly<{
  readonly cellAt: (cell: MobPathCell) => Result.Result<MobMovementWorldCell, MobMovementWorldFailure>
  readonly queryFailure: () => MobMovementWorldFailure | undefined
  readonly resetQueryFailure: () => void
  readonly bodyOverlapsUnloadedCell: (state: MobMovementState) => Result.Result<boolean, MobMovementWorldFailure>
}>

type MovementPhysicsBlock = ReturnType<MobMovementWorldPort['physics']['environment']['blockAt']>
type LoadedMovementCell = Extract<MobMovementWorldCell, { _tag: 'Loaded' }>
type RegistryCellFailure = Extract<MobMovementWorldFailure, { _tag: 'EntityWorldRegistryFailure' | 'EntityWorldUnregisteredBlockId' }>

export const mobMovementPhysicsSampleForCell = (
  result: Result.Result<MobMovementWorldCell, MobMovementWorldFailure>,
  airAt: () => Result.Result<LoadedMovementCell, RegistryCellFailure>,
): Readonly<{ sample: MovementPhysicsBlock; queryFailure: MobMovementWorldFailure | undefined }> => {
  if (Result.isFailure(result)) {
    return {
      sample: result.failure._tag === 'EntityWorldRegistryFailure'
        ? Result.fail(result.failure.failure)
        : Result.succeed(null),
      queryFailure: result.failure,
    }
  }
  switch (result.success._tag) {
    case 'Loaded':
      return {
        sample: Result.succeed({ properties: result.success.properties, capabilities: result.success.capabilities }),
        queryFailure: undefined,
      }
    case 'Unloaded':
    case 'BelowWorld':
      return { sample: Result.succeed(null), queryFailure: undefined }
    case 'AboveWorld': {
      const air = airAt()
      if (Result.isFailure(air)) {
        return {
          sample: air.failure._tag === 'EntityWorldRegistryFailure'
            ? Result.fail(air.failure.failure)
            : Result.succeed(null),
          queryFailure: air.failure,
        }
      }
      return {
        sample: Result.succeed({ properties: air.success.properties, capabilities: air.success.capabilities }),
        queryFailure: undefined,
      }
    }
    /* v8 ignore start */
    default: {
      const exhaustive: never = result.success
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

const profileForKind = (kind: EntityKind): MobPathProfile => {
  const [width, height] = kind === SPIDER_KIND
    ? [1.4, 0.9]
    : kind === CHICKEN_KIND
      ? [0.4, 0.7]
      : kind === COW_KIND || kind === SHEEP_KIND
        ? [0.9, 1.4]
        : kind === PIG_KIND
          ? [0.9, 0.9]
          : kind === ZOMBIE_KIND || kind === 'skeleton' || kind === 'zombified_piglin'
            ? [0.6, 1.95]
            : [0.6, 1.8]
  const raw = kind === SPIDER_KIND
    ? { kind: 'spider', width, height }
    : { kind: 'ground', width, height, canJump: true }
  return Schema.decodeUnknownSync(MobPathProfileSchema)(raw)
}

const pathCellAt = (value: Position): MobPathCell | undefined => {
  const decoded = Schema.decodeUnknownResult(MobPathCellSchema)({
    x: Math.floor(value.x),
    y: Math.floor(value.y),
    z: Math.floor(value.z),
  })
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

export const initialMobMovementState = (
  id: EntityId,
  kind: EntityKind,
  feet: Position,
  goal: Position,
): MobMovementState | undefined => {
  const profile = profileForKind(kind)
  const goalCell = pathCellAt(goal)
  if (goalCell === undefined) return undefined
  const speed = kind === SPIDER_KIND
    ? 3
    : PASSIVE_MOB_KINDS.some((passiveKind) => passiveKind === kind)
      ? 1.25
      : 2.5
  return Schema.decodeUnknownSync(MobMovementStateSchema)({
    id,
    body: {
      kind: 'dynamic',
      x: feet.x,
      y: feet.y + profile.height / 2,
      z: feet.z,
      vx: 0,
      vy: 0,
      vz: 0,
    },
    profile,
    goal: goalCell,
    path: [],
    pathIndex: 0,
    stuckTicks: 0,
    isGrounded: false,
    movementSpeed: speed,
  })
}

export const movementStateForGoal = (
  state: MobMovementState,
  goal: Position,
): MobMovementState | undefined => {
  const goalCell = pathCellAt(goal)
  if (goalCell === undefined) return undefined
  if (state.goal.x === goalCell.x && state.goal.y === goalCell.y && state.goal.z === goalCell.z) return state
  return Schema.decodeUnknownSync(MobMovementStateSchema)({
    ...state,
    goal: goalCell,
    path: [],
    pathIndex: 0,
    stuckTicks: 0,
  })
}

export const movementFeetPosition = (state: MobMovementState): Position => {
  return position(
    PositionAxis(state.body.x),
    PositionAxis(state.body.y - state.profile.height / 2),
    PositionAxis(state.body.z),
  )
}

export const mobMayEnterMovementCell = (cell: MobMovementWorldCell): boolean => {
  switch (cell._tag) {
    case 'Loaded': return cell.properties.collisionShape === 'none'
    case 'Unloaded': return false
    case 'AboveWorld': return true
    case 'BelowWorld': return true
    /* v8 ignore start */
    default: {
      const exhaustive: never = cell
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

const cellIsSupport = (cell: MobMovementWorldCell): boolean =>
  cell._tag === 'Loaded' && cell.properties.collisionShape !== 'none'

const hazardInCell = (cell: MobMovementWorldCell): 'water' | 'lava' | 'cactus' | 'fire' | null => {
  if (cell._tag !== 'Loaded') return null
  if (cell.properties.fluid === 'water' || cell.properties.fluid === 'lava') return cell.properties.fluid
  if (cell.block?.type === 'cactus') return 'cactus'
  if (cell.block?.type === 'fire') return 'fire'
  return null
}

/** Build an SM3 world that keeps unloaded, world-boundary, and corrupt cells distinct. */
export const mobMovementWorldFromChunkWindow = (
  window: ChunkWindow,
): MobMovementWorldAdapter => {
  let firstFailure: MobMovementWorldFailure | undefined
  const rememberFailure = (failure: MobMovementWorldFailure): void => {
    firstFailure ??= failure
  }
  const cells = new Map<string, Result.Result<MobMovementWorldCell, MobMovementWorldFailure>>()
  const cellAt: MobMovementWorldAdapter['cellAt'] = (cell) => {
    const key = `${Number(cell.x)},${Number(cell.y)},${Number(cell.z)}`
    const cached = cells.get(key)
    if (cached !== undefined) return cached
    const result = entityWorldCellAt(window, cell)
    if (Result.isSuccess(result)) cells.set(key, result)
    return result
  }
  const queryAt = (x: BlockAxis, y: BlockAxis, z: BlockAxis) => cellAt({ x, y, z })
  const rememberQueryFailure = <A>(result: Result.Result<A, MobMovementWorldFailure>): A | undefined => {
    if (Result.isFailure(result)) {
      rememberFailure(result.failure)
      return undefined
    }
    return result.success
  }
  const physicsSampleAt = (
    x: BlockAxis,
    y: BlockAxis,
    z: BlockAxis,
  ): ReturnType<MobMovementWorldPort['physics']['environment']['blockAt']> => {
    const cell: MobPathCell = { x, y, z }
    const sample = mobMovementPhysicsSampleForCell(queryAt(x, y, z), () => entityWorldAirBlockDataAt(cell))
    if (sample.queryFailure !== undefined) rememberFailure(sample.queryFailure)
    return sample.sample
  }
  const blockAt: MobMovementWorldPort['physics']['environment']['blockAt'] = (x, y, z) =>
    physicsSampleAt(x, y, z)
  const blockPropertiesAt: MobMovementWorldPort['physics']['blockPropertiesAt'] = (x, y, z) =>
    Result.map(physicsSampleAt(x, y, z), (sample) => sample?.properties ?? null)
  const blockShapeAt: NonNullable<MobMovementWorldPort['physics']['blockShapeAt']> = (x, y, z) => {
    const cell = rememberQueryFailure(queryAt(x, y, z))
    if (cell === undefined) return null
    switch (cell._tag) {
      case 'Loaded': return COLLISION_SHAPE_AABBS[cell.properties.collisionShape]
      case 'Unloaded': return null
      case 'AboveWorld': return null
      case 'BelowWorld': return null
      /* v8 ignore start */
      default: {
        const exhaustive: never = cell
        return exhaustive
      }
      /* v8 ignore stop */
    }
  }
  const movementCellAt = (cell: MobPathCell): MobMovementWorldCell | undefined => rememberQueryFailure(cellAt(cell))
  const bodyOverlapsUnloadedCell: MobMovementWorldAdapter['bodyOverlapsUnloadedCell'] = (state) => {
    const { x, y, z } = state.body
    const halfWidth = state.profile.width / 2
    const halfHeight = state.profile.height / 2
    const minX = Math.floor(x - halfWidth)
    const maxX = Math.ceil(x + halfWidth) - 1
    const minY = Math.floor(y - halfHeight)
    const maxY = Math.ceil(y + halfHeight) - 1
    const minZ = Math.floor(z - halfWidth)
    const maxZ = Math.ceil(z + halfWidth) - 1
    if (![minX, maxX, minY, maxY, minZ, maxZ].every(Number.isSafeInteger)) {
      return Result.fail({
        _tag: 'EntityWorldInvalidCell',
        reason: 'not-block-coordinate',
        position: position(PositionAxis(x), PositionAxis(y), PositionAxis(z)),
      })
    }
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
          const cell = cellAt({ x: BlockAxis(cellX), y: BlockAxis(cellY), z: BlockAxis(cellZ) })
          if (Result.isFailure(cell)) return Result.fail(cell.failure)
          if (cell.success._tag === 'Unloaded') return Result.succeed(true)
        }
      }
    }
    return Result.succeed(false)
  }
  return {
    isPassable: (cell) => {
      const worldCell = movementCellAt(cell)
      return worldCell === undefined ? false : mobMayEnterMovementCell(worldCell)
    },
    hasSupport: (cell) => {
      const worldCell = movementCellAt(cell)
      return worldCell === undefined ? false : cellIsSupport(worldCell)
    },
    hazardAt: (cell) => {
      const worldCell = movementCellAt(cell)
      return worldCell === undefined ? null : hazardInCell(worldCell)
    },
    cellAt,
    queryFailure: () => firstFailure,
    resetQueryFailure: () => { firstFailure = undefined },
    bodyOverlapsUnloadedCell,
    physics: {
      environment: { blockAt, blockShapeAt },
      blockPropertiesAt,
      blockShapeAt,
    },
  }
}

export const mobMovementCell = (value: Position): MobPathCell | undefined => pathCellAt(value)
