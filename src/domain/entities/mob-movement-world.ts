import {
  BlockAxis,
  type CollisionShape,
  type BlockId,
  PositionAxis,
  blockIdOf,
  position,
  resolvedBlockOfId,
  type Position,
} from '@nerima-games/mc-kernel'
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
import { Option, Result, Schema } from 'effect'
import { UNREADABLE_BLOCK, type ChunkWindow } from '../chunk-window.js'
import {
  CHICKEN_KIND,
  COW_KIND,
  PIG_KIND,
  PASSIVE_MOB_KINDS,
  SHEEP_KIND,
  SPIDER_KIND,
} from '../mob/mob-ecosystem.js'
import { ZOMBIE_KIND } from '../mob/hostile-combat.js'

// Bedrock is part of the kernel registry; this module uses it as the unreadable-cell fallback.
const BEDROCK_BLOCK = Result.getOrThrow(resolvedBlockOfId(Option.getOrThrow(blockIdOf('bedrock'))))!

type PhysicsBlockShapeAt = NonNullable<MobMovementWorldPort['physics']['blockShapeAt']>
type PhysicsBlockShapeResult = ReturnType<PhysicsBlockShapeAt>
type PhysicsBlockShape = Exclude<PhysicsBlockShapeResult, null>

const localBox = (
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): PhysicsBlockShape => ({
  minX: PositionAxis(minX),
  minY: PositionAxis(minY),
  minZ: PositionAxis(minZ),
  maxX: PositionAxis(maxX),
  maxY: PositionAxis(maxY),
  maxZ: PositionAxis(maxZ),
})

const PHYSICS_BLOCK_SHAPES: Record<CollisionShape, PhysicsBlockShapeResult> = {
  full: localBox(0, 0, 0, 1, 1, 1),
  slab: localBox(0, 0, 0, 1, 0.5, 1),
  cactus: localBox(1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16),
  pressurePlate: localBox(0, 0, 0, 1, 1 / 16, 1),
  none: null,
}

const blockShape = (shape: CollisionShape): PhysicsBlockShapeResult => PHYSICS_BLOCK_SHAPES[shape]

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

const rawBlockAt = (window: ChunkWindow, x: BlockAxis, y: BlockAxis, z: BlockAxis): BlockId | undefined => {
  const id = window.blockAt(x, y, z)
  return id === UNREADABLE_BLOCK ? undefined : id
}

const resolvedAt = (window: ChunkWindow, x: BlockAxis, y: BlockAxis, z: BlockAxis) => {
  const id = rawBlockAt(window, x, y, z)
  return id === undefined ? undefined : Result.getOrUndefined(resolvedBlockOfId(id))
}

const supportAt = (window: ChunkWindow, cell: MobPathCell): boolean => {
  const block = resolvedAt(window, cell.x, cell.y, cell.z)
  return block !== undefined && block.properties.collisionShape !== 'none'
}

const hazardsAt = (window: ChunkWindow, cell: MobPathCell): 'water' | 'lava' | 'cactus' | 'fire' | null => {
  const block = resolvedAt(window, cell.x, cell.y, cell.z)
  if (block === undefined) return null
  if (block.properties.fluid === 'water' || block.properties.fluid === 'lava') return block.properties.fluid
  if (block.type === 'cactus') return 'cactus'
  if (block.type === 'fire') return 'fire'
  return null
}

/** Build an SM3 world over loaded chunks. Unreadable cells block movement and collision. */
export const mobMovementWorldFromChunkWindow = (
  window: ChunkWindow,
): MobMovementWorldPort => {
  const solidFallback = BEDROCK_BLOCK
  const blockAt = (x: BlockAxis, y: BlockAxis, z: BlockAxis) => {
    const block = resolvedAt(window, x, y, z) ?? solidFallback
    return Result.succeed({ properties: block.properties, capabilities: block.capabilities })
  }
  const blockPropertiesAt = (x: BlockAxis, y: BlockAxis, z: BlockAxis) =>
    Result.succeed((resolvedAt(window, x, y, z) ?? solidFallback).properties)
  const blockShapeAt = (x: BlockAxis, y: BlockAxis, z: BlockAxis) =>
    blockShape((resolvedAt(window, x, y, z) ?? solidFallback).properties.collisionShape)
  const passable = (cell: MobPathCell): boolean => {
    const id = rawBlockAt(window, cell.x, cell.y, cell.z)
    if (id === undefined) return false
    const shape = Result.getOrUndefined(resolvedBlockOfId(id))?.properties.collisionShape
    return shape !== undefined && shape === 'none'
  }
  return {
    isPassable: passable,
    hasSupport: (cell) => supportAt(window, cell),
    hazardAt: (cell) => hazardsAt(window, cell),
    physics: {
      environment: { blockAt, blockShapeAt },
      blockPropertiesAt,
      blockShapeAt,
    },
  }
}

export const mobMovementCell = (value: Position): MobPathCell | undefined => pathCellAt(value)
